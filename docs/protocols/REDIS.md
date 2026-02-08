# Redis Protocol Implementation Plan

## Overview

**Protocol:** RESP (REdis Serialization Protocol)
**Port:** 6379
**RFC:** None (proprietary but open spec)
**Complexity:** Low-Medium
**Purpose:** Key-value store, caching, pub/sub messaging

Redis is one of the **highest-value, lowest-complexity** protocols to implement. The RESP protocol is human-readable and well-documented, making it perfect for a web-based client.

### Use Cases
- Database administration and querying
- Cache management and monitoring
- Real-time pub/sub messaging dashboard
- Development/debugging tool
- Educational - learn Redis commands interactively

## Protocol Specification

### RESP Protocol Basics

Redis uses RESP (Redis Serialization Protocol) - a simple text-based protocol.

#### Data Types

| Type | Prefix | Example |
|------|--------|---------|
| Simple String | `+` | `+OK\r\n` |
| Error | `-` | `-ERR unknown command\r\n` |
| Integer | `:` | `:1000\r\n` |
| Bulk String | `$` | `$5\r\nhello\r\n` |
| Array | `*` | `*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n` |

#### Command Format

Commands are sent as arrays of bulk strings:

```
*<number of arguments>\r\n
$<length of arg1>\r\n
<arg1>\r\n
$<length of arg2>\r\n
<arg2>\r\n
...
```

### Example Session

```
Client: *1\r\n$4\r\nPING\r\n
Server: +PONG\r\n

Client: *3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n
Server: +OK\r\n

Client: *2\r\n$3\r\nGET\r\n$3\r\nkey\r\n
Server: $5\r\nvalue\r\n

Client: *2\r\n$4\r\nKEYS\r\n$1\r\n*\r\n
Server: *3\r\n$4\r\nkey1\r\n$4\r\nkey2\r\n$4\r\nkey3\r\n
```

## Worker Implementation

### RESP Parser/Serializer

```typescript
// src/worker/protocols/redis/resp.ts

export type RESPValue =
  | { type: 'simple-string'; value: string }
  | { type: 'error'; value: string }
  | { type: 'integer'; value: number }
  | { type: 'bulk-string'; value: string | null }
  | { type: 'array'; value: RESPValue[] };

/**
 * Serialize a Redis command to RESP format
 */
export function serializeCommand(...args: string[]): Uint8Array {
  const encoder = new TextEncoder();
  let result = `*${args.length}\r\n`;

  for (const arg of args) {
    const bytes = encoder.encode(arg);
    result += `$${bytes.length}\r\n${arg}\r\n`;
  }

  return encoder.encode(result);
}

/**
 * Parse RESP response
 */
export class RESPParser {
  private buffer: string = '';
  private decoder = new TextDecoder();

  append(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
  }

  parse(): RESPValue | null {
    if (this.buffer.length === 0) return null;

    const firstChar = this.buffer[0];

    switch (firstChar) {
      case '+':
        return this.parseSimpleString();
      case '-':
        return this.parseError();
      case ':':
        return this.parseInteger();
      case '$':
        return this.parseBulkString();
      case '*':
        return this.parseArray();
      default:
        throw new Error(`Unknown RESP type: ${firstChar}`);
    }
  }

  private parseSimpleString(): RESPValue | null {
    const idx = this.buffer.indexOf('\r\n');
    if (idx === -1) return null;

    const value = this.buffer.substring(1, idx);
    this.buffer = this.buffer.substring(idx + 2);

    return { type: 'simple-string', value };
  }

  private parseError(): RESPValue | null {
    const idx = this.buffer.indexOf('\r\n');
    if (idx === -1) return null;

    const value = this.buffer.substring(1, idx);
    this.buffer = this.buffer.substring(idx + 2);

    return { type: 'error', value };
  }

  private parseInteger(): RESPValue | null {
    const idx = this.buffer.indexOf('\r\n');
    if (idx === -1) return null;

    const value = parseInt(this.buffer.substring(1, idx), 10);
    this.buffer = this.buffer.substring(idx + 2);

    return { type: 'integer', value };
  }

  private parseBulkString(): RESPValue | null {
    const firstLineEnd = this.buffer.indexOf('\r\n');
    if (firstLineEnd === -1) return null;

    const length = parseInt(this.buffer.substring(1, firstLineEnd), 10);

    if (length === -1) {
      // Null bulk string
      this.buffer = this.buffer.substring(firstLineEnd + 2);
      return { type: 'bulk-string', value: null };
    }

    const contentStart = firstLineEnd + 2;
    const contentEnd = contentStart + length;

    if (this.buffer.length < contentEnd + 2) return null; // Not enough data

    const value = this.buffer.substring(contentStart, contentEnd);
    this.buffer = this.buffer.substring(contentEnd + 2);

    return { type: 'bulk-string', value };
  }

  private parseArray(): RESPValue | null {
    const firstLineEnd = this.buffer.indexOf('\r\n');
    if (firstLineEnd === -1) return null;

    const count = parseInt(this.buffer.substring(1, firstLineEnd), 10);
    this.buffer = this.buffer.substring(firstLineEnd + 2);

    if (count === -1) {
      return { type: 'array', value: [] };
    }

    const elements: RESPValue[] = [];
    for (let i = 0; i < count; i++) {
      const element = this.parse();
      if (element === null) return null; // Not enough data
      elements.push(element);
    }

    return { type: 'array', value: elements };
  }
}
```

### Redis Client

```typescript
// src/worker/protocols/redis/client.ts

import { connect } from 'cloudflare:sockets';
import { serializeCommand, RESPParser, RESPValue } from './resp';

export class RedisClient {
  private socket: Socket;
  private parser = new RESPParser();
  private connected = false;

  constructor(
    private host: string,
    private port: number
  ) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.host}:${this.port}`);
    await this.socket.opened;
    this.connected = true;

    // Start reading responses
    this.readResponses();
  }

  private async readResponses(): Promise<void> {
    const reader = this.socket.readable.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.parser.append(value);
      }
    } catch (error) {
      console.error('Redis read error:', error);
    } finally {
      reader.releaseLock();
    }
  }

  async command(...args: string[]): Promise<RESPValue> {
    if (!this.connected) throw new Error('Not connected');

    const writer = this.socket.writable.getWriter();
    await writer.write(serializeCommand(...args));
    writer.releaseLock();

    // Wait for response
    while (true) {
      const response = this.parser.parse();
      if (response !== null) return response;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  async close(): Promise<void> {
    await this.socket.close();
    this.connected = false;
  }

  // Convenience methods
  async ping(): Promise<string> {
    const result = await this.command('PING');
    return result.type === 'simple-string' ? result.value : '';
  }

  async get(key: string): Promise<string | null> {
    const result = await this.command('GET', key);
    return result.type === 'bulk-string' ? result.value : null;
  }

  async set(key: string, value: string): Promise<string> {
    const result = await this.command('SET', key, value);
    return result.type === 'simple-string' ? result.value : '';
  }

  async keys(pattern: string = '*'): Promise<string[]> {
    const result = await this.command('KEYS', pattern);
    if (result.type !== 'array') return [];

    return result.value
      .filter(v => v.type === 'bulk-string' && v.value !== null)
      .map(v => (v.type === 'bulk-string' && v.value) || '');
  }

  async info(section?: string): Promise<string> {
    const args = section ? ['INFO', section] : ['INFO'];
    const result = await this.command(...args);
    return result.type === 'bulk-string' && result.value ? result.value : '';
  }
}
```

### WebSocket Tunnel

```typescript
// src/worker/protocols/redis/tunnel.ts

export async function redisTunnel(
  request: Request,
  host: string,
  port: number,
  password?: string
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  try {
    const redis = new RedisClient(host, port);
    await redis.connect();

    // Authenticate if password provided
    if (password) {
      await redis.command('AUTH', password);
    }

    // Handle commands from browser
    server.addEventListener('message', async (event) => {
      try {
        const { command, args } = JSON.parse(event.data);
        const result = await redis.command(command, ...args);

        server.send(JSON.stringify({
          type: 'response',
          result,
        }));
      } catch (error) {
        server.send(JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
    });

    // Handle close
    server.addEventListener('close', () => {
      redis.close();
    });

  } catch (error) {
    server.send(JSON.stringify({
      type: 'error',
      error: error instanceof Error ? error.message : 'Connection failed',
    }));
    server.close();
  }

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
```

### API Endpoints

```typescript
// Add to src/worker/index.ts

// Quick command execution
if (url.pathname === '/api/redis/exec' && request.method === 'POST') {
  const { host, port, password, command, args } = await request.json();

  const client = new RedisClient(host, port);
  await client.connect();

  if (password) {
    await client.command('AUTH', password);
  }

  const result = await client.command(command, ...args);
  await client.close();

  return Response.json({ result });
}

// WebSocket tunnel for interactive session
if (url.pathname === '/api/redis/connect') {
  const { host, port, password } = await request.json();
  return redisTunnel(request, host, port, password);
}
```

## Web UI Design

### Main Redis Client Component

```typescript
// src/components/RedisClient.tsx

import { useState, useEffect, useRef } from 'react';

interface RedisCommand {
  command: string;
  args: string[];
  result?: any;
  error?: string;
  timestamp: number;
}

export function RedisClient() {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(6379);
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);
  const [commandHistory, setCommandHistory] = useState<RedisCommand[]>([]);
  const [currentCommand, setCurrentCommand] = useState('');

  const ws = useRef<WebSocket | null>(null);

  const connect = async () => {
    ws.current = new WebSocket('/api/redis/connect');

    ws.current.onopen = () => {
      // Send connection params
      ws.current?.send(JSON.stringify({ host, port, password }));
      setConnected(true);
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'response') {
        setCommandHistory(prev => [
          ...prev.slice(0, -1),
          { ...prev[prev.length - 1], result: data.result },
        ]);
      } else if (data.type === 'error') {
        setCommandHistory(prev => [
          ...prev.slice(0, -1),
          { ...prev[prev.length - 1], error: data.error },
        ]);
      }
    };

    ws.current.onclose = () => {
      setConnected(false);
    };
  };

  const executeCommand = (cmdString: string) => {
    const parts = cmdString.trim().split(/\s+/);
    const command = parts[0].toUpperCase();
    const args = parts.slice(1);

    const entry: RedisCommand = {
      command,
      args,
      timestamp: Date.now(),
    };

    setCommandHistory(prev => [...prev, entry]);

    ws.current?.send(JSON.stringify({ command, args }));
    setCurrentCommand('');
  };

  return (
    <div className="redis-client">
      <div className="connection-panel">
        <h2>Redis Client</h2>

        {!connected ? (
          <div className="connection-form">
            <input
              type="text"
              placeholder="Host"
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
              type="password"
              placeholder="Password (optional)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button onClick={connect}>Connect</button>
          </div>
        ) : (
          <div className="connected-status">
            <span className="status-indicator">●</span>
            Connected to {host}:{port}
          </div>
        )}
      </div>

      {connected && (
        <>
          <div className="command-input">
            <span className="prompt">redis&gt;</span>
            <input
              type="text"
              value={currentCommand}
              onChange={(e) => setCurrentCommand(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && currentCommand) {
                  executeCommand(currentCommand);
                }
              }}
              placeholder="Enter Redis command (e.g., GET mykey)"
              autoFocus
            />
          </div>

          <div className="command-history">
            {commandHistory.map((cmd, i) => (
              <div key={i} className="command-entry">
                <div className="command-line">
                  <span className="timestamp">
                    {new Date(cmd.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="command">
                    {cmd.command} {cmd.args.join(' ')}
                  </span>
                </div>

                {cmd.result && (
                  <div className="result">
                    <RedisValueDisplay value={cmd.result} />
                  </div>
                )}

                {cmd.error && (
                  <div className="error">Error: {cmd.error}</div>
                )}
              </div>
            ))}
          </div>

          <CommandSuggestions onSelect={executeCommand} />
        </>
      )}
    </div>
  );
}

function RedisValueDisplay({ value }: { value: any }) {
  if (value.type === 'simple-string') {
    return <span className="simple-string">{value.value}</span>;
  }

  if (value.type === 'integer') {
    return <span className="integer">(integer) {value.value}</span>;
  }

  if (value.type === 'bulk-string') {
    return value.value === null
      ? <span className="null">(nil)</span>
      : <span className="bulk-string">"{value.value}"</span>;
  }

  if (value.type === 'array') {
    return (
      <div className="array">
        {value.value.map((item: any, i: number) => (
          <div key={i} className="array-item">
            {i + 1}) <RedisValueDisplay value={item} />
          </div>
        ))}
      </div>
    );
  }

  if (value.type === 'error') {
    return <span className="error">(error) {value.value}</span>;
  }

  return <span>{JSON.stringify(value)}</span>;
}

function CommandSuggestions({ onSelect }: { onSelect: (cmd: string) => void }) {
  const commonCommands = [
    'PING',
    'KEYS *',
    'INFO',
    'GET mykey',
    'SET mykey myvalue',
    'DEL mykey',
    'INCR counter',
    'LPUSH mylist value',
    'LRANGE mylist 0 -1',
    'HGETALL myhash',
  ];

  return (
    <div className="suggestions">
      <h3>Common Commands</h3>
      <div className="suggestion-buttons">
        {commonCommands.map(cmd => (
          <button
            key={cmd}
            onClick={() => onSelect(cmd)}
            className="suggestion"
          >
            {cmd}
          </button>
        ))}
      </div>
    </div>
  );
}
```

### Key Browser Component

```typescript
// src/components/RedisKeyBrowser.tsx

export function RedisKeyBrowser({ ws }: { ws: WebSocket }) {
  const [keys, setKeys] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState<any>(null);

  const loadKeys = () => {
    ws.send(JSON.stringify({ command: 'KEYS', args: ['*'] }));
  };

  const loadKey = (key: string) => {
    setSelectedKey(key);
    ws.send(JSON.stringify({ command: 'GET', args: [key] }));
  };

  return (
    <div className="key-browser">
      <div className="key-list">
        <button onClick={loadKeys}>Refresh Keys</button>
        <ul>
          {keys.map(key => (
            <li
              key={key}
              onClick={() => loadKey(key)}
              className={selectedKey === key ? 'selected' : ''}
            >
              {key}
            </li>
          ))}
        </ul>
      </div>

      {selectedKey && (
        <div className="key-detail">
          <h3>{selectedKey}</h3>
          <pre>{JSON.stringify(keyValue, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

## Data Flow

```
┌─────────┐         ┌──────────┐         ┌──────────┐
│ Browser │         │  Worker  │         │  Redis   │
└────┬────┘         └────┬─────┘         └────┬─────┘
     │                   │                     │
     │ WS: Connect       │                     │
     ├──────────────────>│                     │
     │                   │ TCP Connect         │
     │                   ├────────────────────>│
     │ <── WS Accept ──> │<── TCP Handshake ──>│
     │                   │                     │
     │ {command: "GET", args: ["key"]}        │
     ├──────────────────>│                     │
     │                   │ *2\r\n$3\r\nGET\r\n$3\r\nkey\r\n
     │                   ├────────────────────>│
     │                   │                     │
     │                   │ $5\r\nvalue\r\n     │
     │                   │<────────────────────┤
     │ {type: "response", result: ...}        │
     │<──────────────────┤                     │
     │                   │                     │
```

## Security

### Authentication

```typescript
// Always authenticate if password is provided
if (password) {
  const authResult = await redis.command('AUTH', password);
  if (authResult.type === 'error') {
    throw new Error('Authentication failed');
  }
}
```

### Dangerous Commands

Block potentially dangerous commands:

```typescript
const DANGEROUS_COMMANDS = [
  'FLUSHDB',
  'FLUSHALL',
  'SHUTDOWN',
  'CONFIG',
  'DEBUG',
  'BGSAVE',
  'BGREWRITEAOF',
];

function validateCommand(command: string): boolean {
  return !DANGEROUS_COMMANDS.includes(command.toUpperCase());
}
```

### Rate Limiting

```typescript
// Limit commands per connection
const COMMAND_RATE_LIMIT = 100; // per minute
```

## Testing

### Test Setup

Use Docker for local Redis:

```bash
docker run -d -p 6379:6379 redis:latest
```

### Unit Tests

```typescript
// tests/redis.test.ts

describe('RESP Parser', () => {
  it('should parse simple string', () => {
    const parser = new RESPParser();
    parser.append(new TextEncoder().encode('+OK\r\n'));
    const result = parser.parse();
    expect(result).toEqual({ type: 'simple-string', value: 'OK' });
  });

  it('should parse bulk string', () => {
    const parser = new RESPParser();
    parser.append(new TextEncoder().encode('$5\r\nhello\r\n'));
    const result = parser.parse();
    expect(result).toEqual({ type: 'bulk-string', value: 'hello' });
  });
});
```

## Resources

- **Protocol Spec**: [Redis Protocol](https://redis.io/docs/reference/protocol-spec/)
- **Commands Reference**: [Redis Commands](https://redis.io/commands/)
- **RESP3**: [New protocol version](https://github.com/redis/redis-specifications/blob/master/protocol/RESP3.md)
- **Node.js Client**: [ioredis](https://github.com/luin/ioredis) (reference implementation)

## Next Steps

1. Implement RESP parser/serializer
2. Create RedisClient class
3. Add WebSocket tunnel
4. Build React UI with command history
5. Add key browser component
6. Implement pub/sub visualization
7. Add monitoring dashboard (INFO command parsing)
