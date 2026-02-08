# RabbitMQ Protocol Implementation Plan

## Overview

**Protocol:** AMQP 0-9-1 (Advanced Message Queuing Protocol)
**Port:** 5672 (AMQP), 15672 (HTTP Management), 61613 (STOMP), 15674 (WebSockets)
**Specification:** [AMQP 0-9-1](https://www.rabbitmq.com/resources/specs/amqp0-9-1.pdf)
**Complexity:** Very High
**Purpose:** Message broker and queue system

RabbitMQ enables **reliable message queuing** - publish/subscribe patterns, work queues, and asynchronous communication from the browser.

### Use Cases
- Asynchronous task processing
- Microservices communication
- Event-driven architectures
- Work queue distribution
- Real-time messaging
- Decoupling application components

## Protocol Specification

### AMQP Frame Format

```
┌─────────────┬───────────┬──────────┬─────────┬─────────┐
│ Frame Type  │ Channel   │ Frame    │ Payload │ End     │
│ (1 byte)    │ (2 bytes) │ Size     │         │ (0xCE)  │
│             │           │ (4 bytes)│         │         │
└─────────────┴───────────┴──────────┴─────────┴─────────┘
```

### Frame Types

| Type | Value | Description |
|------|-------|-------------|
| METHOD | 1 | Method frame |
| HEADER | 2 | Content header |
| BODY | 3 | Content body |
| HEARTBEAT | 8 | Heartbeat |

### Connection Flow

```
Client → Server: Protocol Header (AMQP\x00\x00\x09\x01)
Server → Client: Connection.Start
Client → Server: Connection.StartOk
Server → Client: Connection.Tune
Client → Server: Connection.TuneOk
Client → Server: Connection.Open
Server → Client: Connection.OpenOk
```

### AMQP Methods

**Connection**: Start, StartOk, Secure, SecureOk, Tune, TuneOk, Open, OpenOk, Close, CloseOk

**Channel**: Open, OpenOk, Flow, FlowOk, Close, CloseOk

**Exchange**: Declare, DeclareOk, Delete, DeleteOk, Bind, BindOk, Unbind, UnbindOk

**Queue**: Declare, DeclareOk, Bind, BindOk, Purge, PurgeOk, Delete, DeleteOk, Unbind, UnbindOk

**Basic**: Qos, QosOk, Consume, ConsumeOk, Cancel, CancelOk, Publish, Return, Deliver, Get, GetOk, GetEmpty, Ack, Reject, RecoverAsync, Recover, RecoverOk, Nack

## Worker Implementation

### Use STOMP over WebSockets (Simpler than AMQP)

```typescript
// src/worker/protocols/rabbitmq/client.ts

export interface RabbitMQConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  vhost?: string;
}

export interface Message {
  body: string | Uint8Array;
  properties?: MessageProperties;
}

export interface MessageProperties {
  contentType?: string;
  contentEncoding?: string;
  headers?: Record<string, any>;
  deliveryMode?: 1 | 2; // 1 = non-persistent, 2 = persistent
  priority?: number;
  correlationId?: string;
  replyTo?: string;
  expiration?: string;
  messageId?: string;
  timestamp?: Date;
  type?: string;
  userId?: string;
  appId?: string;
}

export interface ConsumeCallback {
  (message: Message, deliveryTag: string): Promise<void>;
}

// Use HTTP Management API (simpler than AMQP binary protocol)

export class RabbitMQClient {
  private baseUrl: string;
  private amqpUrl: string;
  private headers: HeadersInit;

  constructor(private config: RabbitMQConfig) {
    // HTTP Management API (port 15672)
    this.baseUrl = `http://${config.host}:15672/api`;

    // AMQP URL for publishing
    this.amqpUrl = `amqp://${config.username}:${config.password}@${config.host}:${config.port}`;

    const auth = btoa(`${config.username}:${config.password}`);
    this.headers = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    };
  }

  async listQueues(): Promise<Array<{
    name: string;
    messages: number;
    consumers: number;
  }>> {
    const vhost = this.config.vhost || '%2F'; // '/' encoded

    const response = await fetch(`${this.baseUrl}/queues/${vhost}`, {
      headers: this.headers,
    });

    const queues = await response.json();

    return queues.map((q: any) => ({
      name: q.name,
      messages: q.messages || 0,
      consumers: q.consumers || 0,
    }));
  }

  async declareQueue(
    queue: string,
    options: {
      durable?: boolean;
      autoDelete?: boolean;
      exclusive?: boolean;
      arguments?: Record<string, any>;
    } = {}
  ): Promise<void> {
    const vhost = this.config.vhost || '%2F';

    await fetch(`${this.baseUrl}/queues/${vhost}/${queue}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({
        durable: options.durable ?? true,
        auto_delete: options.autoDelete ?? false,
        arguments: options.arguments || {},
      }),
    });
  }

  async deleteQueue(queue: string): Promise<void> {
    const vhost = this.config.vhost || '%2F';

    await fetch(`${this.baseUrl}/queues/${vhost}/${queue}`, {
      method: 'DELETE',
      headers: this.headers,
    });
  }

  async publish(
    exchange: string,
    routingKey: string,
    message: Message
  ): Promise<void> {
    const vhost = this.config.vhost || '%2F';

    const body = typeof message.body === 'string'
      ? message.body
      : new TextDecoder().decode(message.body);

    await fetch(`${this.baseUrl}/exchanges/${vhost}/${exchange}/publish`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        routing_key: routingKey,
        payload: body,
        payload_encoding: 'string',
        properties: message.properties || {},
      }),
    });
  }

  async publishToQueue(queue: string, message: Message): Promise<void> {
    // Publish to default exchange with routing key = queue name
    await this.publish('', queue, message);
  }

  async getMessage(queue: string, ack: boolean = true): Promise<Message | null> {
    const vhost = this.config.vhost || '%2F';

    const response = await fetch(`${this.baseUrl}/queues/${vhost}/${queue}/get`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        count: 1,
        ackmode: ack ? 'ack_requeue_false' : 'ack_requeue_true',
        encoding: 'auto',
      }),
    });

    const messages = await response.json();

    if (messages.length === 0) return null;

    const msg = messages[0];

    return {
      body: msg.payload,
      properties: msg.properties,
    };
  }

  async purgeQueue(queue: string): Promise<number> {
    const vhost = this.config.vhost || '%2F';

    const response = await fetch(`${this.baseUrl}/queues/${vhost}/${queue}/contents`, {
      method: 'DELETE',
      headers: this.headers,
    });

    const data = await response.json();
    return data.message_count || 0;
  }

  async declareExchange(
    exchange: string,
    type: 'direct' | 'fanout' | 'topic' | 'headers',
    options: {
      durable?: boolean;
      autoDelete?: boolean;
      internal?: boolean;
      arguments?: Record<string, any>;
    } = {}
  ): Promise<void> {
    const vhost = this.config.vhost || '%2F';

    await fetch(`${this.baseUrl}/exchanges/${vhost}/${exchange}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({
        type,
        durable: options.durable ?? true,
        auto_delete: options.autoDelete ?? false,
        internal: options.internal ?? false,
        arguments: options.arguments || {},
      }),
    });
  }

  async bindQueue(
    queue: string,
    exchange: string,
    routingKey: string = ''
  ): Promise<void> {
    const vhost = this.config.vhost || '%2F';

    await fetch(`${this.baseUrl}/bindings/${vhost}/e/${exchange}/q/${queue}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        routing_key: routingKey,
      }),
    });
  }

  async getQueueStats(queue: string): Promise<{
    messages: number;
    messagesReady: number;
    messagesUnacknowledged: number;
    consumers: number;
  }> {
    const vhost = this.config.vhost || '%2F';

    const response = await fetch(`${this.baseUrl}/queues/${vhost}/${queue}`, {
      headers: this.headers,
    });

    const data = await response.json();

    return {
      messages: data.messages || 0,
      messagesReady: data.messages_ready || 0,
      messagesUnacknowledged: data.messages_unacknowledged || 0,
      consumers: data.consumers || 0,
    };
  }

  // WebSocket consumer (for real-time consumption)
  async consume(
    queue: string,
    callback: ConsumeCallback
  ): Promise<() => void> {
    // Use STOMP over WebSocket (port 15674)
    const ws = new WebSocket(`ws://${this.config.host}:15674/ws`);

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    // STOMP CONNECT frame
    ws.send(`CONNECT\nlogin:${this.config.username}\npasscode:${this.config.password}\n\n\0`);

    // SUBSCRIBE frame
    ws.send(`SUBSCRIBE\nid:sub-0\ndestination:/queue/${queue}\nack:client\n\n\0`);

    ws.onmessage = async (event) => {
      const frame = event.data;

      // Parse STOMP frame
      if (frame.startsWith('MESSAGE')) {
        const lines = frame.split('\n');
        const headers: Record<string, string> = {};

        let i = 1;
        while (lines[i] && lines[i] !== '') {
          const [key, value] = lines[i].split(':');
          headers[key] = value;
          i++;
        }

        const body = lines.slice(i + 1).join('\n').replace(/\0$/, '');

        const deliveryTag = headers['message-id'] || '';

        await callback({ body }, deliveryTag);

        // ACK frame
        ws.send(`ACK\nid:${deliveryTag}\n\n\0`);
      }
    };

    // Return unsubscribe function
    return () => {
      ws.send(`UNSUBSCRIBE\nid:sub-0\n\n\0`);
      ws.close();
    };
  }
}

// Work Queue Pattern

export class WorkQueue {
  constructor(
    private client: RabbitMQClient,
    private queueName: string
  ) {}

  async initialize(): Promise<void> {
    await this.client.declareQueue(this.queueName, {
      durable: true,
    });
  }

  async addTask(task: any): Promise<void> {
    await this.client.publishToQueue(this.queueName, {
      body: JSON.stringify(task),
      properties: {
        deliveryMode: 2, // Persistent
        contentType: 'application/json',
      },
    });
  }

  async processTask(handler: (task: any) => Promise<void>): Promise<() => void> {
    return await this.client.consume(this.queueName, async (message) => {
      const task = JSON.parse(message.body as string);
      await handler(task);
    });
  }
}

// Pub/Sub Pattern

export class PubSub {
  private exchangeName: string;

  constructor(
    private client: RabbitMQClient,
    topic: string
  ) {
    this.exchangeName = `topic.${topic}`;
  }

  async initialize(): Promise<void> {
    await this.client.declareExchange(this.exchangeName, 'fanout', {
      durable: false,
    });
  }

  async publish(message: any): Promise<void> {
    await this.client.publish(this.exchangeName, '', {
      body: JSON.stringify(message),
      properties: {
        contentType: 'application/json',
      },
    });
  }

  async subscribe(callback: (message: any) => Promise<void>): Promise<() => void> {
    // Create temporary queue
    const queueName = `temp.${Math.random().toString(36)}`;
    await this.client.declareQueue(queueName, {
      durable: false,
      autoDelete: true,
      exclusive: true,
    });

    // Bind to exchange
    await this.client.bindQueue(queueName, this.exchangeName);

    // Consume messages
    return await this.client.consume(queueName, async (msg) => {
      const message = JSON.parse(msg.body as string);
      await callback(message);
    });
  }
}
```

## Web UI Design

```typescript
// src/components/RabbitMQClient.tsx

export function RabbitMQClient() {
  const [queues, setQueues] = useState<any[]>([]);
  const [selectedQueue, setSelectedQueue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');

  const loadQueues = async () => {
    const response = await fetch('/api/rabbitmq/queues');
    const data = await response.json();
    setQueues(data);
  };

  const sendMessage = async () => {
    await fetch('/api/rabbitmq/publish', {
      method: 'POST',
      body: JSON.stringify({
        queue: selectedQueue,
        message: newMessage,
      }),
    });

    setNewMessage('');
    alert('Message sent');
  };

  const consumeMessage = async () => {
    const response = await fetch('/api/rabbitmq/get', {
      method: 'POST',
      body: JSON.stringify({ queue: selectedQueue }),
    });

    const message = await response.json();
    if (message) {
      setMessages([...messages, message]);
    }
  };

  const startConsumer = () => {
    const ws = new WebSocket(`/api/rabbitmq/consume?queue=${selectedQueue}`);

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      setMessages(prev => [...prev, message]);
    };
  };

  return (
    <div className="rabbitmq-client">
      <h2>RabbitMQ Message Broker</h2>

      <div className="sidebar">
        <h3>Queues</h3>
        <button onClick={loadQueues}>Refresh</button>
        <ul>
          {queues.map(q => (
            <li
              key={q.name}
              className={selectedQueue === q.name ? 'selected' : ''}
              onClick={() => setSelectedQueue(q.name)}
            >
              📬 {q.name} ({q.messages} messages, {q.consumers} consumers)
            </li>
          ))}
        </ul>
      </div>

      <div className="main-panel">
        <div className="publisher">
          <h3>Publish to {selectedQueue}</h3>
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            rows={3}
            placeholder="Message body..."
          />
          <button onClick={sendMessage} disabled={!selectedQueue}>
            Send Message
          </button>
        </div>

        <div className="consumer">
          <h3>Consume from {selectedQueue}</h3>
          <button onClick={consumeMessage} disabled={!selectedQueue}>
            Get One Message
          </button>
          <button onClick={startConsumer} disabled={!selectedQueue}>
            Start Consumer
          </button>

          <div className="messages">
            {messages.map((msg, i) => (
              <div key={i} className="message">
                <pre>{JSON.stringify(msg, null, 2)}</pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

## Security

### Authentication

```typescript
// User permissions
rabbitmqctl add_user myuser mypassword
rabbitmqctl set_permissions -p / myuser ".*" ".*" ".*"
```

### SSL/TLS

```typescript
// Enable SSL on port 5671
const config = {
  host: 'rabbitmq.example.com',
  port: 5671,
  username: 'user',
  password: 'pass',
  ssl: true,
};
```

## Testing

```bash
# Docker RabbitMQ
docker run -d \
  -p 5672:5672 \
  -p 15672:15672 \
  -p 15674:15674 \
  -e RABBITMQ_DEFAULT_USER=admin \
  -e RABBITMQ_DEFAULT_PASS=admin \
  --hostname rabbitmq \
  rabbitmq:3-management

# Enable STOMP plugin
docker exec rabbitmq rabbitmq-plugins enable rabbitmq_web_stomp

# Management UI
open http://localhost:15672
```

## Resources

- **RabbitMQ Docs**: [Documentation](https://www.rabbitmq.com/documentation.html)
- **AMQP 0-9-1**: [Protocol Spec](https://www.rabbitmq.com/resources/specs/amqp0-9-1.pdf)
- **Management HTTP API**: [API Docs](https://www.rabbitmq.com/management.html#http-api)

## Common Patterns

### Work Queue
```typescript
const queue = new WorkQueue(client, 'tasks');
await queue.addTask({ type: 'email', to: 'user@example.com' });
```

### Pub/Sub
```typescript
const pubsub = new PubSub(client, 'events');
await pubsub.publish({ type: 'user.created', userId: 123 });
```

### Topic Routing
```typescript
await client.declareExchange('logs', 'topic');
await client.publish('logs', 'error.database', { message: 'Connection failed' });
```

## Notes

- **AMQP binary protocol** is very complex
- **HTTP Management API** is easier for web clients
- **STOMP over WebSocket** for real-time consumption
- **Exchanges** route messages to queues
- **Durable** queues survive restarts
- **Persistent** messages survive restarts
- **Acknowledgments** ensure message delivery
- Industry standard for **enterprise messaging**
