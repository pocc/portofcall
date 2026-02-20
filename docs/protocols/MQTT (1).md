# MQTT Protocol Implementation Plan

## Overview

**Protocol:** MQTT (Message Queuing Telemetry Transport)
**Port:** 1883 (unencrypted), 8883 (TLS)
**Specification:** [MQTT 3.1.1](http://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html), [MQTT 5.0](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html)
**Complexity:** Medium
**Purpose:** Lightweight pub/sub messaging for IoT

MQTT is the **de facto standard** for IoT messaging. A browser-based MQTT client enables real-time monitoring dashboards, device control panels, and message debugging.

### Use Cases
- IoT device monitoring dashboards
- Smart home control panels
- Industrial sensor visualization
- MQTT broker debugging
- Pub/sub message inspection
- Real-time data streaming

## Protocol Specification

### MQTT Basics

MQTT is a **publish/subscribe** protocol:

```
┌─────────┐         ┌─────────┐         ┌─────────┐
│Publisher│────────>│ Broker  │────────>│Subscriber│
│         │  PUB    │         │  SUB    │         │
└─────────┘         └─────────┘         └─────────┘
```

### Message Types

| Type | Value | Direction | Description |
|------|-------|-----------|-------------|
| CONNECT | 1 | C→S | Client connects |
| CONNACK | 2 | S→C | Connection acknowledgment |
| PUBLISH | 3 | C↔S | Publish message |
| PUBACK | 4 | C↔S | Publish acknowledgment (QoS 1) |
| SUBSCRIBE | 8 | C→S | Subscribe to topics |
| SUBACK | 9 | S→C | Subscribe acknowledgment |
| UNSUBSCRIBE | 10 | C→S | Unsubscribe from topics |
| UNSUBACK | 11 | S→C | Unsubscribe acknowledgment |
| PINGREQ | 12 | C→S | Ping request (keepalive) |
| PINGRESP | 13 | S→C | Ping response |
| DISCONNECT | 14 | C→S | Disconnect |

### Packet Format

```
┌────────────────────────────────┐
│  Fixed Header (2-5 bytes)       │
│  - Message Type (4 bits)        │
│  - Flags (4 bits)               │
│  - Remaining Length (1-4 bytes) │
├────────────────────────────────┤
│  Variable Header                │
│  - Packet-specific fields       │
├────────────────────────────────┤
│  Payload                        │
│  - Message content              │
└────────────────────────────────┘
```

### Quality of Service (QoS)

| Level | Name | Description |
|-------|------|-------------|
| 0 | At most once | Fire and forget |
| 1 | At least once | Acknowledged delivery |
| 2 | Exactly once | Two-phase commit |

### Topic Format

Topics use `/` as separator:

```
home/livingroom/temperature
sensors/outdoor/humidity
devices/light-01/status
```

Wildcards:
- `+` = single level wildcard (`sensors/+/temperature`)
- `#` = multi-level wildcard (`home/#`)

## Worker Implementation

### MQTT Client Library

Use existing TypeScript MQTT library:

```bash
npm install mqtt
```

```typescript
// src/worker/protocols/mqtt/client.ts

import mqtt from 'mqtt';
import { connect as tcpConnect } from 'cloudflare:sockets';

export interface MQTTConfig {
  host: string;
  port: number;
  clientId?: string;
  username?: string;
  password?: string;
  keepalive?: number;
  clean?: boolean;
}

export interface MQTTMessage {
  topic: string;
  payload: string | Buffer;
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
}

export class MQTTClient {
  private client: mqtt.MqttClient;
  private messages: MQTTMessage[] = [];

  constructor(private config: MQTTConfig) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Create TCP socket
      const socket = tcpConnect(`${this.config.host}:${this.config.port}`);

      this.client = mqtt.connect({
        stream: socket as any, // Use our TCP socket
        clientId: this.config.clientId || `portofcall-${Math.random().toString(36).substr(2, 9)}`,
        username: this.config.username,
        password: this.config.password,
        keepalive: this.config.keepalive || 60,
        clean: this.config.clean !== false,
      });

      this.client.on('connect', () => resolve());
      this.client.on('error', reject);

      // Collect messages
      this.client.on('message', (topic, payload, packet) => {
        this.messages.push({
          topic,
          payload: payload.toString(),
          qos: packet.qos,
          retain: packet.retain,
          timestamp: Date.now(),
        });
      });
    });
  }

  async subscribe(topic: string, qos: 0 | 1 | 2 = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.subscribe(topic, { qos }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async unsubscribe(topic: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.unsubscribe(topic, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async publish(
    topic: string,
    message: string,
    options?: { qos?: 0 | 1 | 2; retain?: boolean }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(topic, message, options || {}, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  getMessages(): MQTTMessage[] {
    return this.messages;
  }

  clearMessages(): void {
    this.messages = [];
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      this.client.end(false, {}, () => resolve());
    });
  }
}
```

### WebSocket MQTT Tunnel

```typescript
// src/worker/protocols/mqtt/tunnel.ts

export async function mqttTunnel(
  request: Request,
  config: MQTTConfig
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  (async () => {
    try {
      const mqtt = new MQTTClient(config);
      await mqtt.connect();

      server.send(JSON.stringify({ type: 'connected' }));

      // Handle commands from browser
      server.addEventListener('message', async (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'subscribe':
              await mqtt.subscribe(msg.topic, msg.qos);
              server.send(JSON.stringify({
                type: 'subscribed',
                topic: msg.topic,
              }));
              break;

            case 'unsubscribe':
              await mqtt.unsubscribe(msg.topic);
              server.send(JSON.stringify({
                type: 'unsubscribed',
                topic: msg.topic,
              }));
              break;

            case 'publish':
              await mqtt.publish(msg.topic, msg.message, {
                qos: msg.qos,
                retain: msg.retain,
              });
              server.send(JSON.stringify({
                type: 'published',
                topic: msg.topic,
              }));
              break;

            case 'getMessages':
              const messages = mqtt.getMessages();
              server.send(JSON.stringify({
                type: 'messages',
                messages,
              }));
              mqtt.clearMessages();
              break;
          }
        } catch (error) {
          server.send(JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          }));
        }
      });

      // Poll for messages every 500ms
      const interval = setInterval(() => {
        const messages = mqtt.getMessages();
        if (messages.length > 0) {
          server.send(JSON.stringify({
            type: 'messages',
            messages,
          }));
          mqtt.clearMessages();
        }
      }, 500);

      server.addEventListener('close', () => {
        clearInterval(interval);
        mqtt.disconnect();
      });

    } catch (error) {
      server.send(JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'Connection failed',
      }));
      server.close();
    }
  })();

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
```

### API Endpoints

```typescript
// Add to src/worker/index.ts

// MQTT WebSocket connection
if (url.pathname === '/api/mqtt/connect') {
  const config = await request.json();
  return mqttTunnel(request, config);
}

// Quick publish (no persistent connection)
if (url.pathname === '/api/mqtt/publish' && request.method === 'POST') {
  const { host, port, username, password, topic, message } = await request.json();

  const mqtt = new MQTTClient({ host, port, username, password });
  await mqtt.connect();
  await mqtt.publish(topic, message);
  await mqtt.disconnect();

  return Response.json({ success: true });
}
```

## Web UI Design

### MQTT Dashboard Component

```typescript
// src/components/MQTTDashboard.tsx

import { useState, useEffect, useRef } from 'react';

interface MQTTMessage {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
  timestamp: number;
}

export function MQTTDashboard() {
  const [host, setHost] = useState('test.mosquitto.org');
  const [port, setPort] = useState(1883);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);

  const [subscriptions, setSubscriptions] = useState<string[]>([]);
  const [messages, setMessages] = useState<MQTTMessage[]>([]);

  const [subTopic, setSubTopic] = useState('');
  const [pubTopic, setPubTopic] = useState('');
  const [pubMessage, setPubMessage] = useState('');

  const ws = useRef<WebSocket | null>(null);

  const connect = () => {
    ws.current = new WebSocket('/api/mqtt/connect');

    ws.current.onopen = () => {
      ws.current?.send(JSON.stringify({
        host,
        port,
        username,
        password,
      }));
    };

    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'connected':
          setConnected(true);
          break;

        case 'subscribed':
          setSubscriptions(prev => [...prev, msg.topic]);
          break;

        case 'unsubscribed':
          setSubscriptions(prev => prev.filter(t => t !== msg.topic));
          break;

        case 'messages':
          setMessages(prev => [...prev, ...msg.messages].slice(-100)); // Keep last 100
          break;

        case 'error':
          console.error('MQTT error:', msg.error);
          break;
      }
    };

    ws.current.onclose = () => {
      setConnected(false);
    };
  };

  const disconnect = () => {
    ws.current?.close();
  };

  const subscribe = (topic: string) => {
    ws.current?.send(JSON.stringify({
      type: 'subscribe',
      topic,
      qos: 0,
    }));
    setSubTopic('');
  };

  const unsubscribe = (topic: string) => {
    ws.current?.send(JSON.stringify({
      type: 'unsubscribe',
      topic,
    }));
  };

  const publish = () => {
    ws.current?.send(JSON.stringify({
      type: 'publish',
      topic: pubTopic,
      message: pubMessage,
      qos: 0,
      retain: false,
    }));
    setPubMessage('');
  };

  return (
    <div className="mqtt-dashboard">
      <div className="connection-panel">
        <h2>MQTT Dashboard</h2>

        {!connected ? (
          <div className="connection-form">
            <input
              type="text"
              placeholder="Broker Host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
            <input
              type="number"
              placeholder="Port"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
            <input
              type="text"
              placeholder="Username (optional)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password (optional)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button onClick={connect}>Connect</button>
          </div>
        ) : (
          <div className="connected-status">
            <span className="status-indicator connected">●</span>
            Connected to {host}:{port}
            <button onClick={disconnect}>Disconnect</button>
          </div>
        )}
      </div>

      {connected && (
        <div className="mqtt-controls">
          <div className="subscribe-panel">
            <h3>Subscriptions</h3>
            <div className="subscribe-form">
              <input
                type="text"
                placeholder="Topic (e.g., sensors/+/temperature)"
                value={subTopic}
                onChange={(e) => setSubTopic(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && subTopic) {
                    subscribe(subTopic);
                  }
                }}
              />
              <button onClick={() => subscribe(subTopic)} disabled={!subTopic}>
                Subscribe
              </button>
            </div>

            <div className="subscription-list">
              {subscriptions.map(topic => (
                <div key={topic} className="subscription-item">
                  <span>{topic}</span>
                  <button onClick={() => unsubscribe(topic)}>×</button>
                </div>
              ))}
            </div>
          </div>

          <div className="publish-panel">
            <h3>Publish</h3>
            <input
              type="text"
              placeholder="Topic"
              value={pubTopic}
              onChange={(e) => setPubTopic(e.target.value)}
            />
            <textarea
              placeholder="Message"
              value={pubMessage}
              onChange={(e) => setPubMessage(e.target.value)}
            />
            <button onClick={publish} disabled={!pubTopic || !pubMessage}>
              Publish
            </button>
          </div>

          <div className="messages-panel">
            <h3>Messages ({messages.length})</h3>
            <div className="message-list">
              {messages.slice().reverse().map((msg, i) => (
                <div key={i} className="message-item">
                  <div className="message-header">
                    <span className="topic">{msg.topic}</span>
                    <span className="timestamp">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`qos qos-${msg.qos}`}>QoS {msg.qos}</span>
                    {msg.retain && <span className="retain">RETAIN</span>}
                  </div>
                  <div className="message-payload">
                    {msg.payload}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Topic Explorer Component

```typescript
// src/components/MQTTTopicExplorer.tsx

export function MQTTTopicExplorer() {
  const [topics, setTopics] = useState<Map<string, number>>(new Map());

  const buildTopicTree = (topics: Map<string, number>) => {
    // Build hierarchical tree from flat topics
    const tree: any = {};

    for (const [topic, count] of topics.entries()) {
      const parts = topic.split('/');
      let node = tree;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!node[part]) {
          node[part] = i === parts.length - 1 ? { __count: count } : {};
        }
        node = node[part];
      }
    }

    return tree;
  };

  const renderTree = (node: any, path: string = '') => {
    return Object.entries(node).map(([key, value]) => {
      if (key === '__count') return null;

      const currentPath = path ? `${path}/${key}` : key;
      const count = (value as any).__count;

      return (
        <div key={currentPath} className="topic-node">
          <div className="topic-name">
            {key} {count && <span className="count">({count})</span>}
          </div>
          {typeof value === 'object' && Object.keys(value).length > 1 && (
            <div className="topic-children">
              {renderTree(value, currentPath)}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="topic-explorer">
      <h3>Topic Hierarchy</h3>
      <div className="topic-tree">
        {renderTree(buildTopicTree(topics))}
      </div>
    </div>
  );
}
```

## Data Flow

```
┌─────────┐         ┌──────────┐         ┌──────────────┐
│ Browser │         │  Worker  │         │ MQTT Broker  │
└────┬────┘         └────┬─────┘         └──────┬───────┘
     │                   │                       │
     │ WS: Connect + creds                       │
     ├──────────────────>│                       │
     │                   │ MQTT CONNECT          │
     │                   ├──────────────────────>│
     │                   │ CONNACK               │
     │ {type:"connected"}│<──────────────────────┤
     │<──────────────────┤                       │
     │                   │                       │
     │ {type:"subscribe", topic:"sensors/#"}     │
     ├──────────────────>│                       │
     │                   │ MQTT SUBSCRIBE        │
     │                   ├──────────────────────>│
     │                   │ SUBACK                │
     │{type:"subscribed"}│<──────────────────────┤
     │<──────────────────┤                       │
     │                   │                       │
     │                   │ MQTT PUBLISH (from device)
     │                   │<──────────────────────┤
     │{type:"messages", messages:[...]}          │
     │<──────────────────┤                       │
     │                   │                       │
     │ {type:"publish", topic:"cmd/light", msg:"on"}
     ├──────────────────>│                       │
     │                   │ MQTT PUBLISH          │
     │                   ├──────────────────────>│
     │                   │ PUBACK (if QoS>0)     │
     │                   │<──────────────────────┤
     │{type:"published"} │                       │
     │<──────────────────┤                       │
     │                   │                       │
```

## Security

### Broker Authentication

```typescript
// Always use credentials for production brokers
if (!username || !password) {
  console.warn('Connecting without authentication');
}
```

### TLS/SSL

```typescript
// Use port 8883 for encrypted connections
const secure = port === 8883;

// Note: TLS may require special handling in Workers
```

### Topic Validation

```typescript
function validateTopic(topic: string): boolean {
  // No wildcards in publish topics
  if (topic.includes('#') || topic.includes('+')) {
    return false;
  }

  // Reasonable length
  if (topic.length > 256) {
    return false;
  }

  return true;
}
```

## Testing

### Public MQTT Brokers

Test brokers (no auth required):

```
test.mosquitto.org:1883
broker.hivemq.com:1883
mqtt.eclipseprojects.io:1883
```

### Local Broker

```bash
# Mosquitto MQTT broker
docker run -d -p 1883:1883 -p 9001:9001 eclipse-mosquitto
```

### Unit Tests

```typescript
// tests/mqtt.test.ts

describe('MQTT Client', () => {
  it('should connect to broker', async () => {
    const mqtt = new MQTTClient({
      host: 'test.mosquitto.org',
      port: 1883,
    });

    await mqtt.connect();
    await mqtt.disconnect();
  });

  it('should publish and subscribe', async () => {
    const mqtt = new MQTTClient({
      host: 'test.mosquitto.org',
      port: 1883,
    });

    await mqtt.connect();
    await mqtt.subscribe('test/portofcall');

    await new Promise(resolve => setTimeout(resolve, 100));

    await mqtt.publish('test/portofcall', 'Hello MQTT');

    await new Promise(resolve => setTimeout(resolve, 500));

    const messages = mqtt.getMessages();
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].payload).toBe('Hello MQTT');

    await mqtt.disconnect();
  });
});
```

## Resources

- **MQTT.org**: [Official MQTT Site](https://mqtt.org/)
- **MQTT 3.1.1 Spec**: [OASIS Standard](http://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html)
- **MQTT.js**: [JavaScript client library](https://github.com/mqttjs/MQTT.js)
- **HiveMQ**: [MQTT Guide](https://www.hivemq.com/mqtt-essentials/)
- **Mosquitto**: [Open source broker](https://mosquitto.org/)

## Next Steps

1. Integrate MQTT.js library
2. Implement WebSocket tunnel
3. Build dashboard UI with subscribe/publish
4. Add topic explorer with hierarchy visualization
5. Create message filtering and search
6. Add QoS 1/2 support
7. Build IoT device simulator for testing
8. Add retained message viewer
9. Implement message charting (time-series visualization)

## Notes

- MQTT is perfect for **real-time dashboards**
- Low bandwidth usage makes it ideal for IoT
- Pub/sub model scales well
- Consider adding MQTT over WebSocket (native protocol) as alternative
- Wildcard subscriptions enable powerful monitoring
- QoS levels trade reliability for performance
