# STOMP Protocol Implementation Plan

## Overview

**Protocol:** STOMP (Simple Text Oriented Messaging Protocol)
**Port:** 61613 (TCP), 61614 (SSL/TLS), 15674 (RabbitMQ WebSocket)
**Specification:** [STOMP 1.2](https://stomp.github.io/stomp-specification-1.2.html)
**Complexity:** Low
**Purpose:** Simple messaging protocol for message brokers

STOMP enables **message broker communication** - publish/subscribe messaging, queue operations, and broker interactions with a simple text protocol from the browser.

### Use Cases
- Message queue access
- Pub/sub messaging
- WebSocket messaging
- Event-driven architectures
- Real-time notifications
- Microservices communication

## Protocol Specification

### Frame Format

STOMP uses newline-delimited text frames:

```
COMMAND
header1:value1
header2:value2

Body^@
```

Where `^@` is the NULL byte (0x00).

### Frame Structure

1. **Command** - Action to perform
2. **Headers** - Key-value pairs
3. **Blank line** - Separates headers from body
4. **Body** - Message content
5. **NULL** - Frame terminator

### Client Commands

| Command | Description |
|---------|-------------|
| CONNECT | Connect to broker |
| STOMP | Alternative to CONNECT (STOMP 1.1+) |
| SEND | Send message |
| SUBSCRIBE | Subscribe to destination |
| UNSUBSCRIBE | Unsubscribe from destination |
| BEGIN | Start transaction |
| COMMIT | Commit transaction |
| ABORT | Abort transaction |
| ACK | Acknowledge message |
| NACK | Negative acknowledge (STOMP 1.1+) |
| DISCONNECT | Disconnect from broker |

### Server Frames

| Frame | Description |
|-------|-------------|
| CONNECTED | Connection successful |
| MESSAGE | Message delivery |
| RECEIPT | Receipt confirmation |
| ERROR | Error occurred |

### Example: Connect

```
CONNECT
accept-version:1.2
host:broker.example.com
login:guest
passcode:guest

^@
```

### Example: Subscribe

```
SUBSCRIBE
id:sub-0
destination:/queue/test
ack:client

^@
```

### Example: Send Message

```
SEND
destination:/queue/test
content-type:text/plain

Hello, STOMP!^@
```

### Example: Message Receipt

```
MESSAGE
subscription:sub-0
message-id:123
destination:/queue/test
content-type:text/plain
content-length:13

Hello, STOMP!^@
```

## Worker Implementation

```typescript
// src/worker/protocols/stomp/client.ts

import { connect } from 'cloudflare:sockets';

export interface STOMPConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  vhost?: string;
}

export interface STOMPMessage {
  command: string;
  headers: Record<string, string>;
  body: string;
}

export interface Subscription {
  id: string;
  destination: string;
  callback: (message: STOMPMessage) => void;
}

export class STOMPClient {
  private socket: any;
  private connected = false;
  private subscriptions = new Map<string, Subscription>();
  private nextSubId = 0;

  constructor(private config: STOMPConfig) {}

  async connect(): Promise<void> {
    const port = this.config.port || 61613;
    this.socket = connect(`${this.config.host}:${port}`);
    await this.socket.opened;

    // Start reading frames
    this.readLoop();

    // Send CONNECT frame
    const connectFrame: STOMPMessage = {
      command: 'CONNECT',
      headers: {
        'accept-version': '1.2',
        'host': this.config.vhost || this.config.host,
      },
      body: '',
    };

    if (this.config.username && this.config.password) {
      connectFrame.headers['login'] = this.config.username;
      connectFrame.headers['passcode'] = this.config.password;
    }

    await this.sendFrame(connectFrame);

    // Wait for CONNECTED
    await this.waitForConnected();
  }

  async send(destination: string, body: string, headers: Record<string, string> = {}): Promise<void> {
    const frame: STOMPMessage = {
      command: 'SEND',
      headers: {
        destination,
        'content-type': 'text/plain',
        'content-length': String(body.length),
        ...headers,
      },
      body,
    };

    await this.sendFrame(frame);
  }

  async subscribe(
    destination: string,
    callback: (message: STOMPMessage) => void,
    options: { ack?: 'auto' | 'client' | 'client-individual' } = {}
  ): Promise<string> {
    const id = `sub-${this.nextSubId++}`;

    const frame: STOMPMessage = {
      command: 'SUBSCRIBE',
      headers: {
        id,
        destination,
        ack: options.ack || 'auto',
      },
      body: '',
    };

    this.subscriptions.set(id, { id, destination, callback });

    await this.sendFrame(frame);

    return id;
  }

  async unsubscribe(id: string): Promise<void> {
    const frame: STOMPMessage = {
      command: 'UNSUBSCRIBE',
      headers: { id },
      body: '',
    };

    await this.sendFrame(frame);
    this.subscriptions.delete(id);
  }

  async ack(messageId: string, subscription: string): Promise<void> {
    const frame: STOMPMessage = {
      command: 'ACK',
      headers: {
        id: messageId,
        subscription,
      },
      body: '',
    };

    await this.sendFrame(frame);
  }

  async nack(messageId: string, subscription: string): Promise<void> {
    const frame: STOMPMessage = {
      command: 'NACK',
      headers: {
        id: messageId,
        subscription,
      },
      body: '',
    };

    await this.sendFrame(frame);
  }

  async begin(transaction: string): Promise<void> {
    const frame: STOMPMessage = {
      command: 'BEGIN',
      headers: { transaction },
      body: '',
    };

    await this.sendFrame(frame);
  }

  async commit(transaction: string): Promise<void> {
    const frame: STOMPMessage = {
      command: 'COMMIT',
      headers: { transaction },
      body: '',
    };

    await this.sendFrame(frame);
  }

  async abort(transaction: string): Promise<void> {
    const frame: STOMPMessage = {
      command: 'ABORT',
      headers: { transaction },
      body: '',
    };

    await this.sendFrame(frame);
  }

  private async sendFrame(frame: STOMPMessage): Promise<void> {
    let message = frame.command + '\n';

    for (const [key, value] of Object.entries(frame.headers)) {
      message += `${key}:${value}\n`;
    }

    message += '\n';
    message += frame.body;
    message += '\x00'; // NULL terminator

    const writer = this.socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(message));
    writer.releaseLock();
  }

  private async readLoop(): Promise<void> {
    const reader = this.socket.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete frames (terminated by NULL)
      while (buffer.includes('\x00')) {
        const nullIndex = buffer.indexOf('\x00');
        const frameText = buffer.substring(0, nullIndex);
        buffer = buffer.substring(nullIndex + 1);

        const frame = this.parseFrame(frameText);
        this.handleFrame(frame);
      }
    }
  }

  private parseFrame(text: string): STOMPMessage {
    const lines = text.split('\n');
    const command = lines[0];

    const headers: Record<string, string> = {};
    let bodyStartIndex = 1;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (line === '') {
        bodyStartIndex = i + 1;
        break;
      }

      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex);
        const value = line.substring(colonIndex + 1);
        headers[key] = value;
      }
    }

    const body = lines.slice(bodyStartIndex).join('\n');

    return { command, headers, body };
  }

  private handleFrame(frame: STOMPMessage): void {
    switch (frame.command) {
      case 'CONNECTED':
        this.connected = true;
        console.log('STOMP connected');
        break;

      case 'MESSAGE':
        this.handleMessage(frame);
        break;

      case 'RECEIPT':
        console.log('Receipt:', frame.headers['receipt-id']);
        break;

      case 'ERROR':
        console.error('STOMP error:', frame.body);
        break;
    }
  }

  private handleMessage(frame: STOMPMessage): void {
    const subscriptionId = frame.headers['subscription'];
    const subscription = this.subscriptions.get(subscriptionId);

    if (subscription) {
      subscription.callback(frame);
    }
  }

  private async waitForConnected(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.connected) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 10);
    });
  }

  async disconnect(): Promise<void> {
    const frame: STOMPMessage = {
      command: 'DISCONNECT',
      headers: {},
      body: '',
    };

    await this.sendFrame(frame);

    if (this.socket) {
      await this.socket.close();
    }
  }
}

// WebSocket STOMP Client (common in browsers)

export class WebSocketSTOMPClient {
  private ws?: WebSocket;
  private connected = false;
  private subscriptions = new Map<string, Subscription>();
  private nextSubId = 0;

  constructor(private url: string) {}

  async connect(username?: string, password?: string): Promise<void> {
    this.ws = new WebSocket(this.url);

    return new Promise((resolve, reject) => {
      this.ws!.onopen = () => {
        const connectFrame = this.buildFrame('CONNECT', {
          'accept-version': '1.2',
          'heart-beat': '0,0',
          ...(username && password ? { login: username, passcode: password } : {}),
        });

        this.ws!.send(connectFrame);
      };

      this.ws!.onmessage = (event) => {
        const frame = this.parseFrame(event.data);

        if (frame.command === 'CONNECTED') {
          this.connected = true;
          resolve();
        } else {
          this.handleFrame(frame);
        }
      };

      this.ws!.onerror = reject;
    });
  }

  send(destination: string, body: string, headers: Record<string, string> = {}): void {
    const frame = this.buildFrame('SEND', {
      destination,
      'content-type': 'text/plain',
      ...headers,
    }, body);

    this.ws!.send(frame);
  }

  subscribe(destination: string, callback: (message: STOMPMessage) => void): string {
    const id = `sub-${this.nextSubId++}`;

    const frame = this.buildFrame('SUBSCRIBE', {
      id,
      destination,
      ack: 'auto',
    });

    this.subscriptions.set(id, { id, destination, callback });
    this.ws!.send(frame);

    return id;
  }

  unsubscribe(id: string): void {
    const frame = this.buildFrame('UNSUBSCRIBE', { id });
    this.ws!.send(frame);
    this.subscriptions.delete(id);
  }

  private buildFrame(command: string, headers: Record<string, string>, body: string = ''): string {
    let frame = command + '\n';

    for (const [key, value] of Object.entries(headers)) {
      frame += `${key}:${value}\n`;
    }

    frame += '\n';
    frame += body;
    frame += '\x00';

    return frame;
  }

  private parseFrame(text: string): STOMPMessage {
    const lines = text.split('\n');
    const command = lines[0];

    const headers: Record<string, string> = {};
    let bodyStartIndex = 1;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (line === '') {
        bodyStartIndex = i + 1;
        break;
      }

      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex);
        const value = line.substring(colonIndex + 1);
        headers[key] = value;
      }
    }

    const body = lines.slice(bodyStartIndex).join('\n').replace(/\x00$/, '');

    return { command, headers, body };
  }

  private handleFrame(frame: STOMPMessage): void {
    if (frame.command === 'MESSAGE') {
      const subscriptionId = frame.headers['subscription'];
      const subscription = this.subscriptions.get(subscriptionId);

      if (subscription) {
        subscription.callback(frame);
      }
    }
  }

  disconnect(): void {
    const frame = this.buildFrame('DISCONNECT', {});
    this.ws!.send(frame);
    this.ws!.close();
  }
}
```

## Web UI Design

```typescript
// src/components/STOMPClient.tsx

export function STOMPClient() {
  const [connected, setConnected] = useState(false);
  const [destination, setDestination] = useState('/queue/test');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<STOMPMessage[]>([]);
  const [subscriptionId, setSubscriptionId] = useState<string>('');

  const client = useRef<WebSocketSTOMPClient>();

  const connect = async () => {
    client.current = new WebSocketSTOMPClient('ws://localhost:15674/ws');

    await client.current.connect('guest', 'guest');
    setConnected(true);
  };

  const subscribe = () => {
    if (!client.current) return;

    const id = client.current.subscribe(destination, (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    setSubscriptionId(id);
  };

  const send = () => {
    if (!client.current) return;

    client.current.send(destination, message);
    setMessage('');
  };

  const unsubscribe = () => {
    if (!client.current || !subscriptionId) return;

    client.current.unsubscribe(subscriptionId);
    setSubscriptionId('');
  };

  const disconnect = () => {
    if (!client.current) return;

    client.current.disconnect();
    setConnected(false);
  };

  return (
    <div className="stomp-client">
      <h2>STOMP Messaging Client</h2>

      {!connected ? (
        <button onClick={connect}>Connect to Broker</button>
      ) : (
        <>
          <div className="controls">
            <input
              type="text"
              placeholder="Destination (/queue/name or /topic/name)"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
            {!subscriptionId ? (
              <button onClick={subscribe}>Subscribe</button>
            ) : (
              <button onClick={unsubscribe}>Unsubscribe</button>
            )}
          </div>

          <div className="send">
            <input
              type="text"
              placeholder="Message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && send()}
            />
            <button onClick={send}>Send</button>
          </div>

          <div className="messages">
            <h3>Received Messages</h3>
            {messages.map((msg, i) => (
              <div key={i} className="message">
                <div className="header">
                  <strong>From:</strong> {msg.headers['destination']}
                </div>
                <div className="body">{msg.body}</div>
              </div>
            ))}
          </div>

          <button onClick={disconnect}>Disconnect</button>
        </>
      )}

      <div className="info">
        <h3>About STOMP</h3>
        <ul>
          <li>Simple Text Oriented Messaging Protocol</li>
          <li>Works with RabbitMQ, ActiveMQ, Apollo, etc.</li>
          <li>Text-based, easy to debug</li>
          <li>Supports queues and topics (pub/sub)</li>
          <li>WebSocket support for browsers</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### Authentication

```
CONNECT
login:username
passcode:password
```

### TLS/SSL

```
Port: 61614 (STOMP over TLS)
Or use wss:// for WebSocket STOMP
```

## Testing

### RabbitMQ with STOMP

```bash
# RabbitMQ with STOMP plugin
docker run -d \
  -p 5672:5672 \
  -p 15672:15672 \
  -p 61613:61613 \
  -p 15674:15674 \
  --name rabbitmq \
  rabbitmq:3-management

# Enable STOMP plugins
docker exec rabbitmq rabbitmq-plugins enable rabbitmq_stomp
docker exec rabbitmq rabbitmq-plugins enable rabbitmq_web_stomp

# Management UI
open http://localhost:15672
# Login: guest/guest
```

### ActiveMQ

```bash
# ActiveMQ with STOMP
docker run -d \
  -p 61613:61613 \
  -p 8161:8161 \
  --name activemq \
  rmohr/activemq

# Web console
open http://localhost:8161
# Login: admin/admin
```

### Test with Telnet

```bash
# Connect
telnet localhost 61613

# Send frames
CONNECT
accept-version:1.2
host:/

^@

SEND
destination:/queue/test
content-type:text/plain

Hello STOMP!^@
```

## Resources

- **STOMP Specification**: [stomp.github.io](https://stomp.github.io/)
- **RabbitMQ STOMP**: [RabbitMQ Documentation](https://www.rabbitmq.com/stomp.html)
- **ActiveMQ**: [Apache ActiveMQ](https://activemq.apache.org/)

## Common Headers

| Header | Description |
|--------|-------------|
| destination | Queue or topic name |
| content-type | Message content type |
| content-length | Body length in bytes |
| receipt | Request receipt confirmation |
| transaction | Transaction ID |
| ack | Acknowledgment mode |
| id | Subscription ID |
| message-id | Unique message ID |

## Destination Types

### Queues (Point-to-Point)

```
/queue/myqueue
```

- One consumer receives each message
- Load balancing across consumers

### Topics (Publish/Subscribe)

```
/topic/mytopic
```

- All subscribers receive messages
- Broadcast pattern

## Acknowledgment Modes

| Mode | Description |
|------|-------------|
| auto | Automatic (default) |
| client | Manual per subscription |
| client-individual | Manual per message |

## Notes

- **Text-based** - easy to debug and understand
- **Simple** - minimal protocol overhead
- **Broker-agnostic** - works with many message brokers
- **WebSocket support** - perfect for browsers
- **Reliable** - supports transactions and acknowledgments
- **Flexible** - queues and topics
- **Heartbeats** - keep-alive mechanism
- **Receipts** - confirmation of command processing
- Alternative to **AMQP** (simpler, less features)
