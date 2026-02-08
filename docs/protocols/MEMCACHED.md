# Memcached Protocol Implementation Plan

## Overview

**Protocol:** Memcached
**Port:** 11211
**Specification:** [Memcached Protocol](https://github.com/memcached/memcached/blob/master/doc/protocol.txt)
**Complexity:** Low
**Purpose:** Distributed memory caching

Memcached is a **high-performance distributed cache**. A browser-based client enables cache inspection, key management, and performance monitoring.

### Use Cases
- Cache monitoring and debugging
- Key inspection and management
- Performance testing
- Cache warming
- Educational - learn caching strategies

## Protocol Specification

### Text Protocol Commands

```
get <key>
set <key> <flags> <exptime> <bytes>
add <key> <flags> <exptime> <bytes>
delete <key>
incr <key> <value>
decr <key> <value>
flush_all
stats
```

### Example Session

```
Client: set mykey 0 3600 11
Client: hello world
Server: STORED

Client: get mykey
Server: VALUE mykey 0 11
Server: hello world
Server: END

Client: delete mykey
Server: DELETED
```

## Worker Implementation

### Memcached Client

```typescript
// src/worker/protocols/memcached/client.ts

import { connect } from 'cloudflare:sockets';

export interface MemcachedConfig {
  host: string;
  port: number;
}

export class MemcachedClient {
  private socket: Socket;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(private config: MemcachedConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;
  }

  async get(key: string): Promise<string | null> {
    await this.send(`get ${key}`);
    const response = await this.readResponse();

    if (response.startsWith('VALUE')) {
      const lines = response.split('\r\n');
      return lines[1] || null;
    }

    return null;
  }

  async set(
    key: string,
    value: string,
    exptime: number = 0,
    flags: number = 0
  ): Promise<boolean> {
    const bytes = this.encoder.encode(value).length;
    await this.send(`set ${key} ${flags} ${exptime} ${bytes}`);
    await this.send(value);

    const response = await this.readResponse();
    return response.startsWith('STORED');
  }

  async add(
    key: string,
    value: string,
    exptime: number = 0
  ): Promise<boolean> {
    const bytes = this.encoder.encode(value).length;
    await this.send(`add ${key} 0 ${exptime} ${bytes}`);
    await this.send(value);

    const response = await this.readResponse();
    return response.startsWith('STORED');
  }

  async delete(key: string): Promise<boolean> {
    await this.send(`delete ${key}`);
    const response = await this.readResponse();
    return response.startsWith('DELETED');
  }

  async incr(key: string, value: number = 1): Promise<number | null> {
    await this.send(`incr ${key} ${value}`);
    const response = await this.readResponse();

    if (response.startsWith('NOT_FOUND')) return null;

    return parseInt(response.trim());
  }

  async decr(key: string, value: number = 1): Promise<number | null> {
    await this.send(`decr ${key} ${value}`);
    const response = await this.readResponse();

    if (response.startsWith('NOT_FOUND')) return null;

    return parseInt(response.trim());
  }

  async stats(): Promise<Map<string, string>> {
    await this.send('stats');
    const response = await this.readResponse();

    const stats = new Map<string, string>();
    const lines = response.split('\r\n');

    for (const line of lines) {
      if (line.startsWith('STAT ')) {
        const parts = line.substring(5).split(' ');
        stats.set(parts[0], parts.slice(1).join(' '));
      }
    }

    return stats;
  }

  async flushAll(): Promise<void> {
    await this.send('flush_all');
    await this.readResponse();
  }

  private async send(data: string): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(this.encoder.encode(data + '\r\n'));
    writer.releaseLock();
  }

  private async readResponse(): Promise<string> {
    const reader = this.socket.readable.getReader();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += this.decoder.decode(value, { stream: true });

      if (buffer.includes('END\r\n') ||
          buffer.includes('STORED\r\n') ||
          buffer.includes('DELETED\r\n') ||
          buffer.includes('NOT_FOUND\r\n') ||
          /^\d+\r\n/.test(buffer)) {
        reader.releaseLock();
        return buffer;
      }
    }

    reader.releaseLock();
    return buffer;
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/MemcachedClient.tsx

export function MemcachedClient() {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<string>('');
  const [stats, setStats] = useState<Map<string, string>>(new Map());

  const get = async () => {
    const response = await fetch('/api/memcached/get', {
      method: 'POST',
      body: JSON.stringify({ host, port, key }),
    });
    const data = await response.json();
    setResult(data.value || 'Not found');
  };

  const set = async () => {
    await fetch('/api/memcached/set', {
      method: 'POST',
      body: JSON.stringify({ host, port, key, value }),
    });
    setResult('Stored');
  };

  return (
    <div className="memcached-client">
      <h2>Memcached Client</h2>

      <div className="operations">
        <input
          type="text"
          placeholder="Key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <input
          type="text"
          placeholder="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button onClick={get}>GET</button>
        <button onClick={set}>SET</button>
      </div>

      {result && <div className="result">{result}</div>}

      <MemcachedStats stats={stats} />
    </div>
  );
}
```

## Testing

```bash
# Docker Memcached
docker run -d -p 11211:11211 memcached

# Test with telnet
telnet localhost 11211
set test 0 0 5
hello
get test
```

## Resources

- **Memcached Protocol**: [GitHub Docs](https://github.com/memcached/memcached/blob/master/doc/protocol.txt)
- **Memcached Wiki**: [memcached.org](https://memcached.org/)

## Notes

- Text protocol is simple and human-readable
- Similar to Redis but more focused on caching
- No persistence - data is in-memory only
- Binary protocol exists but text is easier
