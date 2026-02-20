# NATS Protocol Implementation Plan

## Overview

**Protocol:** NATS (Neural Autonomic Transport System)
**Port:** 4222 (client), 6222 (cluster), 8222 (HTTP monitoring)
**Specification:** [NATS Protocol](https://docs.nats.io/reference/reference-protocols/nats-protocol)
**Complexity:** Low
**Purpose:** Lightweight publish-subscribe messaging

NATS enables **ultra-fast messaging** - pub/sub, request/reply, and queue groups with a simple text-based protocol from the browser.

### Use Cases
- Microservices communication
- Real-time data streaming
- IoT telemetry
- Event-driven architectures
- Service mesh data plane
- Cloud-native applications

## Protocol Specification

### Text-Based Protocol

NATS uses newline-delimited text commands:

```
CONNECT {json}\r\n
PUB subject [reply-to] #bytes\r\n[payload]\r\n
SUB subject [queue] sid\r\n
UNSUB sid [max_msgs]\r\n
MSG subject sid [reply-to] #bytes\r\n[payload]\r\n
PING\r\n
PONG\r\n
+OK\r\n
-ERR 'error message'\r\n
```

### Connection Flow

```
Server → Client: INFO {...}\r\n
Client → Server: CONNECT {...}\r\n
Server → Client: +OK\r\n
Client ↔ Server: Messages
```

### INFO Message (Server → Client)

```json
{
  "server_id": "...",
  "version": "2.9.0",
  "go": "go1.19",
  "host": "0.0.0.0",
  "port": 4222,
  "max_payload": 1048576,
  "proto": 1
}
```

### CONNECT Message (Client → Server)

```json
{
  "verbose": false,
  "pedantic": false,
  "tls_required": false,
  "auth_token": "",
  "user": "",
  "pass": "",
  "name": "my-client",
  "lang": "javascript",
  "version": "1.0.0",
  "protocol": 1
}
```

## Worker Implementation

```typescript
// src/worker/protocols/nats/client.ts

import { connect } from 'cloudflare:sockets';

export interface NatsConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  token?: string;
  name?: string;
}

export interface Message {
  subject: string;
  data: Uint8Array;
  reply?: string;
}

export interface Subscription {
  sid: number;
  subject: string;
  callback: (msg: Message) => void;
  queue?: string;
}

export class NatsClient {
  private socket: any;
  private subscriptions = new Map<number, Subscription>();
  private nextSid = 1;
  private serverInfo: any;

  constructor(private config: NatsConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Read INFO from server
    this.serverInfo = await this.readInfo();

    // Send CONNECT
    await this.sendConnect();

    // Start reading messages
    this.readLoop();
  }

  private async readInfo(): Promise<any> {
    const reader = this.socket.readable.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    const line = new TextDecoder().decode(value).trim();

    if (!line.startsWith('INFO ')) {
      throw new Error('Expected INFO from server');
    }

    return JSON.parse(line.substring(5));
  }

  private async sendConnect(): Promise<void> {
    const connectInfo: any = {
      verbose: false,
      pedantic: false,
      tls_required: false,
      name: this.config.name || 'nats-client',
      lang: 'javascript',
      version: '1.0.0',
      protocol: 1,
    };

    if (this.config.token) {
      connectInfo.auth_token = this.config.token;
    } else if (this.config.user && this.config.pass) {
      connectInfo.user = this.config.user;
      connectInfo.pass = this.config.pass;
    }

    const command = `CONNECT ${JSON.stringify(connectInfo)}\r\n`;
    await this.send(command);

    // Wait for +OK
    await this.waitForOk();
  }

  async publish(subject: string, data: string | Uint8Array, reply?: string): Promise<void> {
    const payload = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data;

    let command = `PUB ${subject} `;
    if (reply) {
      command += `${reply} `;
    }
    command += `${payload.length}\r\n`;

    const encoder = new TextEncoder();
    const header = encoder.encode(command);
    const trailer = encoder.encode('\r\n');

    const frame = new Uint8Array(header.length + payload.length + trailer.length);
    frame.set(header);
    frame.set(payload, header.length);
    frame.set(trailer, header.length + payload.length);

    await this.send(frame);
  }

  async subscribe(
    subject: string,
    callback: (msg: Message) => void,
    opts?: { queue?: string }
  ): Promise<number> {
    const sid = this.nextSid++;

    this.subscriptions.set(sid, {
      sid,
      subject,
      callback,
      queue: opts?.queue,
    });

    let command = `SUB ${subject} `;
    if (opts?.queue) {
      command += `${opts.queue} `;
    }
    command += `${sid}\r\n`;

    await this.send(command);

    return sid;
  }

  async unsubscribe(sid: number, maxMsgs?: number): Promise<void> {
    let command = `UNSUB ${sid}`;
    if (maxMsgs !== undefined) {
      command += ` ${maxMsgs}`;
    }
    command += '\r\n';

    await this.send(command);

    if (maxMsgs === undefined) {
      this.subscriptions.delete(sid);
    }
  }

  async request(subject: string, data: string | Uint8Array, timeout: number = 5000): Promise<Message> {
    return new Promise(async (resolve, reject) => {
      const inbox = `_INBOX.${this.generateNuid()}`;

      const timer = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, timeout);

      const sid = await this.subscribe(inbox, (msg) => {
        clearTimeout(timer);
        this.unsubscribe(sid);
        resolve(msg);
      });

      await this.publish(subject, data, inbox);
    });
  }

  private async send(data: string | Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();

    if (typeof data === 'string') {
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(data));
    } else {
      await writer.write(data);
    }

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

      // Process complete lines
      while (true) {
        const lineEnd = buffer.indexOf('\r\n');
        if (lineEnd === -1) break;

        const line = buffer.substring(0, lineEnd);
        buffer = buffer.substring(lineEnd + 2);

        await this.processLine(line, reader);
      }
    }
  }

  private async processLine(line: string, reader: any): Promise<void> {
    const parts = line.split(' ');
    const verb = parts[0];

    switch (verb) {
      case 'MSG': {
        // MSG subject sid [reply-to] #bytes
        const subject = parts[1];
        const sid = parseInt(parts[2]);

        let replyTo: string | undefined;
        let bytes: number;

        if (parts.length === 4) {
          bytes = parseInt(parts[3]);
        } else {
          replyTo = parts[3];
          bytes = parseInt(parts[4]);
        }

        // Read payload
        const payload = await this.readExact(reader, bytes);

        // Read trailing \r\n
        await this.readExact(reader, 2);

        // Deliver to subscription
        const sub = this.subscriptions.get(sid);
        if (sub) {
          sub.callback({
            subject,
            data: payload,
            reply: replyTo,
          });
        }

        break;
      }

      case 'PING':
        await this.send('PONG\r\n');
        break;

      case 'PONG':
        // Ignore
        break;

      case '+OK':
        // Ignore
        break;

      case '-ERR':
        console.error('NATS error:', line);
        break;

      default:
        console.warn('Unknown NATS command:', verb);
    }
  }

  private async readExact(reader: any, length: number): Promise<Uint8Array> {
    const buffer = new Uint8Array(length);
    let offset = 0;

    while (offset < length) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = length - offset;
      const toCopy = Math.min(remaining, value.length);
      buffer.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    return buffer;
  }

  private async waitForOk(): Promise<void> {
    const reader = this.socket.readable.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    const line = new TextDecoder().decode(value).trim();

    if (!line.startsWith('+OK')) {
      throw new Error(`Expected +OK, got: ${line}`);
    }
  }

  private generateNuid(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 22; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async flush(): Promise<void> {
    // Send PING and wait for PONG
    await this.send('PING\r\n');

    return new Promise((resolve) => {
      // Simplified - in real implementation, track PINGs
      setTimeout(resolve, 100);
    });
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}

// Request/Reply Pattern

export class RequestReply {
  constructor(private client: NatsClient) {}

  async serve(subject: string, handler: (data: string) => Promise<string>): Promise<number> {
    return await this.client.subscribe(subject, async (msg) => {
      if (!msg.reply) return;

      try {
        const response = await handler(new TextDecoder().decode(msg.data));
        await this.client.publish(msg.reply, response);
      } catch (error) {
        await this.client.publish(msg.reply, JSON.stringify({ error: error.message }));
      }
    });
  }

  async request(subject: string, data: string, timeout?: number): Promise<string> {
    const response = await this.client.request(subject, data, timeout);
    return new TextDecoder().decode(response.data);
  }
}

// Queue Groups Pattern

export class QueueGroup {
  constructor(
    private client: NatsClient,
    private subject: string,
    private queueName: string
  ) {}

  async worker(handler: (data: string) => Promise<void>): Promise<number> {
    return await this.client.subscribe(
      this.subject,
      async (msg) => {
        const data = new TextDecoder().decode(msg.data);
        await handler(data);
      },
      { queue: this.queueName }
    );
  }

  async publish(data: string): Promise<void> {
    await this.client.publish(this.subject, data);
  }
}
```

## Web UI Design

```typescript
// src/components/NatsClient.tsx

export function NatsClient() {
  const [connected, setConnected] = useState(false);
  const [subject, setSubject] = useState('test.subject');
  const [message, setMessage] = useState('Hello, NATS!');
  const [messages, setMessages] = useState<Message[]>([]);
  const [subscriptions, setSubscriptions] = useState<number[]>([]);

  const publish = async () => {
    await fetch('/api/nats/publish', {
      method: 'POST',
      body: JSON.stringify({ subject, message }),
    });
  };

  const subscribe = async () => {
    const response = await fetch('/api/nats/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subject }),
    });

    const { sid } = await response.json();
    setSubscriptions([...subscriptions, sid]);

    // Open WebSocket for receiving messages
    const ws = new WebSocket(`/api/nats/messages?sid=${sid}`);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      setMessages(prev => [...prev, msg]);
    };
  };

  const request = async () => {
    const response = await fetch('/api/nats/request', {
      method: 'POST',
      body: JSON.stringify({ subject, message }),
    });

    const reply = await response.json();
    alert(`Reply: ${reply.data}`);
  };

  return (
    <div className="nats-client">
      <h2>NATS Messaging</h2>

      <div className="publisher">
        <h3>Publish</h3>
        <input
          type="text"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <input
          type="text"
          placeholder="Message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button onClick={publish}>Publish</button>
        <button onClick={request}>Request (with reply)</button>
      </div>

      <div className="subscriber">
        <h3>Subscribe</h3>
        <button onClick={subscribe}>Subscribe to {subject}</button>

        <div className="subscriptions">
          <p>Active subscriptions: {subscriptions.length}</p>
        </div>
      </div>

      <div className="messages">
        <h3>Received Messages</h3>
        {messages.map((msg, i) => (
          <div key={i} className="message">
            <strong>{msg.subject}</strong>: {new TextDecoder().decode(msg.data)}
          </div>
        ))}
      </div>

      <div className="examples">
        <h3>Subject Patterns</h3>
        <button onClick={() => setSubject('foo.bar')}>Simple</button>
        <button onClick={() => setSubject('foo.*')}>Wildcard (*)</button>
        <button onClick={() => setSubject('foo.>')}>Full Wildcard (&gt;)</button>
      </div>
    </div>
  );
}
```

## Security

### Authentication

```typescript
// Token authentication
const client = new NatsClient({
  host: 'nats.example.com',
  port: 4222,
  token: 'my-secret-token',
});

// Username/password
const client = new NatsClient({
  host: 'nats.example.com',
  port: 4222,
  user: 'myuser',
  pass: 'mypass',
});
```

### TLS

```bash
# Enable TLS on NATS server
nats-server --tls \
  --tlscert=/path/to/cert.pem \
  --tlskey=/path/to/key.pem
```

## Testing

```bash
# Docker NATS
docker run -d \
  -p 4222:4222 \
  -p 6222:6222 \
  -p 8222:8222 \
  --name nats \
  nats:latest

# Test with nats CLI
nats pub test.subject "Hello World"
nats sub test.subject

# Monitor
open http://localhost:8222
```

## Resources

- **NATS Docs**: [Documentation](https://docs.nats.io/)
- **Protocol Spec**: [NATS Protocol](https://docs.nats.io/reference/reference-protocols/nats-protocol)
- **nats.js**: [JavaScript client](https://github.com/nats-io/nats.js)

## Common Patterns

### Pub/Sub
```typescript
await client.subscribe('news.sports', (msg) => {
  console.log('Sport news:', msg.data);
});

await client.publish('news.sports', 'Team wins championship!');
```

### Request/Reply
```typescript
const rr = new RequestReply(client);

// Server
await rr.serve('math.add', async (data) => {
  const { a, b } = JSON.parse(data);
  return JSON.stringify({ result: a + b });
});

// Client
const response = await rr.request('math.add', JSON.stringify({ a: 5, b: 3 }));
```

### Queue Groups
```typescript
const queue = new QueueGroup(client, 'work.tasks', 'workers');

// Worker 1
await queue.worker(async (data) => {
  console.log('Worker 1 processing:', data);
});

// Worker 2
await queue.worker(async (data) => {
  console.log('Worker 2 processing:', data);
});

// Publisher
await queue.publish('Task 1');
```

## Notes

- **Extremely simple** text protocol
- **Very fast** - millions of messages per second
- **Lightweight** - minimal overhead
- **Subject-based** addressing with wildcards
- `*` matches one token: `foo.*` matches `foo.bar` but not `foo.bar.baz`
- `>` matches multiple tokens: `foo.>` matches `foo.bar.baz`
- **Queue groups** for load balancing
- **Request/reply** with inbox subjects
- No message persistence (use JetStream for persistence)
- Perfect for **cloud-native** microservices
