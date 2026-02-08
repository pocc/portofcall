# etcd Protocol Implementation Plan

## Overview

**Protocol:** etcd gRPC API (HTTP/2)
**Port:** 2379 (client), 2380 (peer)
**Specification:** [etcd API Documentation](https://etcd.io/docs/v3.5/learning/api/)
**Complexity:** High
**Purpose:** Distributed key-value store and service discovery

etcd enables **distributed configuration management** - store and watch configuration data, implement service discovery, and coordinate distributed systems from the browser.

### Use Cases
- Service discovery and registration
- Distributed configuration management
- Leader election
- Distributed locking
- Metadata storage for Kubernetes
- Feature flags and A/B testing

## Protocol Specification

### gRPC API (v3)

etcd v3 uses gRPC over HTTP/2, but also provides an HTTP/JSON gateway.

### HTTP/JSON Gateway Endpoints

```
PUT    /v3/kv/put        - Store key-value
POST   /v3/kv/range      - Get key-value
POST   /v3/kv/deleterange - Delete key-value
POST   /v3/watch         - Watch for changes
POST   /v3/lease/grant   - Grant lease
POST   /v3/lease/revoke  - Revoke lease
POST   /v3/lease/keepalive - Keep lease alive
POST   /v3/lock/lock     - Acquire lock
POST   /v3/lock/unlock   - Release lock
```

### Key Format

Keys are arbitrary byte sequences (UTF-8 strings work well):
```
/services/api/node1
/config/database/connection_string
/locks/resource-123
```

## Worker Implementation

```typescript
// src/worker/protocols/etcd/client.ts

export interface EtcdConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface KeyValue {
  key: string;
  value: string;
  createRevision: number;
  modRevision: number;
  version: number;
  lease?: number;
}

export interface WatchEvent {
  type: 'PUT' | 'DELETE';
  kv: KeyValue;
  prevKv?: KeyValue;
}

export class EtcdClient {
  private baseUrl: string;
  private headers: HeadersInit;

  constructor(private config: EtcdConfig) {
    this.baseUrl = `http://${config.host}:${config.port}`;
    this.headers = {
      'Content-Type': 'application/json',
    };

    if (config.username && config.password) {
      const auth = btoa(`${config.username}:${config.password}`);
      this.headers['Authorization'] = `Basic ${auth}`;
    }
  }

  async put(key: string, value: string, options: {
    lease?: number;
    prevKv?: boolean;
  } = {}): Promise<{ prevKv?: KeyValue }> {
    const response = await fetch(`${this.baseUrl}/v3/kv/put`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        key: this.encodeKey(key),
        value: this.encodeValue(value),
        lease: options.lease,
        prev_kv: options.prevKv,
      }),
    });

    const data = await response.json();

    return {
      prevKv: data.prev_kv ? this.decodeKeyValue(data.prev_kv) : undefined,
    };
  }

  async get(key: string, options: {
    prefix?: boolean;
    limit?: number;
    keysOnly?: boolean;
  } = {}): Promise<KeyValue[]> {
    const rangeEnd = options.prefix ? this.getRangeEnd(key) : undefined;

    const response = await fetch(`${this.baseUrl}/v3/kv/range`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        key: this.encodeKey(key),
        range_end: rangeEnd ? this.encodeKey(rangeEnd) : undefined,
        limit: options.limit,
        keys_only: options.keysOnly,
      }),
    });

    const data = await response.json();

    if (!data.kvs) return [];

    return data.kvs.map((kv: any) => this.decodeKeyValue(kv));
  }

  async delete(key: string, options: {
    prefix?: boolean;
    prevKv?: boolean;
  } = {}): Promise<{ deleted: number; prevKvs?: KeyValue[] }> {
    const rangeEnd = options.prefix ? this.getRangeEnd(key) : undefined;

    const response = await fetch(`${this.baseUrl}/v3/kv/deleterange`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        key: this.encodeKey(key),
        range_end: rangeEnd ? this.encodeKey(rangeEnd) : undefined,
        prev_kv: options.prevKv,
      }),
    });

    const data = await response.json();

    return {
      deleted: parseInt(data.deleted || '0'),
      prevKvs: data.prev_kvs ? data.prev_kvs.map(this.decodeKeyValue) : undefined,
    };
  }

  async watch(
    key: string,
    options: {
      prefix?: boolean;
      startRevision?: number;
      progressNotify?: boolean;
    } = {}
  ): Promise<AsyncGenerator<WatchEvent>> {
    const rangeEnd = options.prefix ? this.getRangeEnd(key) : undefined;

    const watchId = Math.random().toString(36);

    const createRequest = {
      create_request: {
        key: this.encodeKey(key),
        range_end: rangeEnd ? this.encodeKey(rangeEnd) : undefined,
        start_revision: options.startRevision,
        progress_notify: options.progressNotify,
      },
    };

    // In a real implementation, this would use streaming
    // For Workers, we'd use WebSocket or Server-Sent Events

    return this.watchStream(watchId, createRequest);
  }

  private async *watchStream(
    watchId: string,
    createRequest: any
  ): AsyncGenerator<WatchEvent> {
    // Simplified watch implementation
    // In production, use WebSocket for bi-directional streaming

    const response = await fetch(`${this.baseUrl}/v3/watch`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(createRequest),
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);

          if (data.result?.events) {
            for (const event of data.result.events) {
              yield {
                type: event.type === 'DELETE' ? 'DELETE' : 'PUT',
                kv: this.decodeKeyValue(event.kv),
                prevKv: event.prev_kv ? this.decodeKeyValue(event.prev_kv) : undefined,
              };
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  }

  async grantLease(ttl: number): Promise<number> {
    const response = await fetch(`${this.baseUrl}/v3/lease/grant`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ TTL: ttl }),
    });

    const data = await response.json();
    return parseInt(data.ID);
  }

  async revokeLease(leaseId: number): Promise<void> {
    await fetch(`${this.baseUrl}/v3/lease/revoke`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ ID: leaseId }),
    });
  }

  async keepAlive(leaseId: number): Promise<void> {
    await fetch(`${this.baseUrl}/v3/lease/keepalive`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ ID: leaseId }),
    });
  }

  async lock(name: string, lease: number): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v3/lock/lock`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        name: this.encodeKey(name),
        lease,
      }),
    });

    const data = await response.json();
    return this.decodeValue(data.key);
  }

  async unlock(key: string): Promise<void> {
    await fetch(`${this.baseUrl}/v3/lock/unlock`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        key: this.encodeKey(key),
      }),
    });
  }

  async transaction(
    compare: Array<{
      key: string;
      target: 'VERSION' | 'CREATE' | 'MOD' | 'VALUE';
      result: 'EQUAL' | 'GREATER' | 'LESS' | 'NOT_EQUAL';
      value?: any;
    }>,
    success: Array<{ requestPut?: any; requestDeleteRange?: any }>,
    failure: Array<{ requestPut?: any; requestDeleteRange?: any }>
  ): Promise<{ succeeded: boolean; responses: any[] }> {
    const response = await fetch(`${this.baseUrl}/v3/kv/txn`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        compare,
        success,
        failure,
      }),
    });

    const data = await response.json();

    return {
      succeeded: data.succeeded,
      responses: data.responses || [],
    };
  }

  private encodeKey(key: string): string {
    return btoa(key);
  }

  private encodeValue(value: string): string {
    return btoa(value);
  }

  private decodeKey(encoded: string): string {
    return atob(encoded);
  }

  private decodeValue(encoded: string): string {
    return atob(encoded);
  }

  private decodeKeyValue(kv: any): KeyValue {
    return {
      key: this.decodeKey(kv.key),
      value: this.decodeValue(kv.value),
      createRevision: parseInt(kv.create_revision || '0'),
      modRevision: parseInt(kv.mod_revision || '0'),
      version: parseInt(kv.version || '0'),
      lease: kv.lease ? parseInt(kv.lease) : undefined,
    };
  }

  private getRangeEnd(key: string): string {
    // For prefix queries, increment last byte
    const bytes = new TextEncoder().encode(key);
    const rangeEnd = new Uint8Array(bytes.length);
    rangeEnd.set(bytes);
    rangeEnd[rangeEnd.length - 1]++;
    return new TextDecoder().decode(rangeEnd);
  }
}

// Service Discovery Pattern

export class ServiceRegistry {
  private leaseId?: number;

  constructor(private client: EtcdClient) {}

  async register(
    serviceName: string,
    serviceId: string,
    endpoint: string,
    ttl: number = 60
  ): Promise<void> {
    // Grant lease
    this.leaseId = await this.client.grantLease(ttl);

    // Register service
    const key = `/services/${serviceName}/${serviceId}`;
    await this.client.put(key, endpoint, { lease: this.leaseId });

    // Keep alive in background
    this.startKeepAlive(ttl);
  }

  async deregister(serviceName: string, serviceId: string): Promise<void> {
    if (this.leaseId) {
      await this.client.revokeLease(this.leaseId);
    }

    const key = `/services/${serviceName}/${serviceId}`;
    await this.client.delete(key);
  }

  async discover(serviceName: string): Promise<Array<{ id: string; endpoint: string }>> {
    const key = `/services/${serviceName}/`;
    const kvs = await this.client.get(key, { prefix: true });

    return kvs.map(kv => ({
      id: kv.key.split('/').pop() || '',
      endpoint: kv.value,
    }));
  }

  private startKeepAlive(ttl: number): void {
    if (!this.leaseId) return;

    const interval = (ttl * 1000) / 3; // Refresh at 1/3 of TTL

    setInterval(async () => {
      if (this.leaseId) {
        await this.client.keepAlive(this.leaseId);
      }
    }, interval);
  }
}

// Distributed Lock Pattern

export class DistributedLock {
  private lockKey?: string;
  private leaseId?: number;

  constructor(private client: EtcdClient, private name: string) {}

  async acquire(ttl: number = 60): Promise<boolean> {
    try {
      this.leaseId = await this.client.grantLease(ttl);
      this.lockKey = await this.client.lock(this.name, this.leaseId);
      return true;
    } catch {
      return false;
    }
  }

  async release(): Promise<void> {
    if (this.lockKey) {
      await this.client.unlock(this.lockKey);
      this.lockKey = undefined;
    }

    if (this.leaseId) {
      await this.client.revokeLease(this.leaseId);
      this.leaseId = undefined;
    }
  }
}
```

## Web UI Design

```typescript
// src/components/EtcdClient.tsx

export function EtcdClient() {
  const [keys, setKeys] = useState<KeyValue[]>([]);
  const [watchEvents, setWatchEvents] = useState<WatchEvent[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const loadKeys = async (prefix: string = '/') => {
    const response = await fetch('/api/etcd/get', {
      method: 'POST',
      body: JSON.stringify({ key: prefix, prefix: true }),
    });

    const data = await response.json();
    setKeys(data);
  };

  const putKey = async () => {
    await fetch('/api/etcd/put', {
      method: 'POST',
      body: JSON.stringify({ key: newKey, value: newValue }),
    });

    loadKeys();
  };

  const deleteKey = async (key: string) => {
    await fetch('/api/etcd/delete', {
      method: 'POST',
      body: JSON.stringify({ key }),
    });

    loadKeys();
  };

  const startWatch = async (key: string) => {
    const ws = new WebSocket(`/api/etcd/watch?key=${encodeURIComponent(key)}`);

    ws.onmessage = (event) => {
      const watchEvent = JSON.parse(event.data);
      setWatchEvents(prev => [...prev, watchEvent]);
    };
  };

  return (
    <div className="etcd-client">
      <h2>etcd Distributed Key-Value Store</h2>

      <div className="key-input">
        <input
          type="text"
          placeholder="Key (e.g., /config/app/name)"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <input
          type="text"
          placeholder="Value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
        />
        <button onClick={putKey}>Put</button>
      </div>

      <div className="keys-list">
        <h3>Keys</h3>
        <button onClick={() => loadKeys()}>Refresh</button>

        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
              <th>Version</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map(kv => (
              <tr key={kv.key}>
                <td>{kv.key}</td>
                <td>{kv.value}</td>
                <td>{kv.version}</td>
                <td>
                  <button onClick={() => deleteKey(kv.key)}>Delete</button>
                  <button onClick={() => startWatch(kv.key)}>Watch</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="watch-events">
        <h3>Watch Events</h3>
        {watchEvents.map((event, i) => (
          <div key={i} className={`event ${event.type}`}>
            <strong>{event.type}</strong>: {event.kv.key} = {event.kv.value}
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Security

### Authentication

```typescript
// Enable authentication on etcd server
etcdctl user add root
etcdctl auth enable

// Use in client
const client = new EtcdClient({
  host: 'localhost',
  port: 2379,
  username: 'root',
  password: 'password',
});
```

## Testing

```bash
# Docker etcd
docker run -d \
  -p 2379:2379 \
  -p 2380:2380 \
  --name etcd \
  quay.io/coreos/etcd:latest \
  /usr/local/bin/etcd \
  --advertise-client-urls http://0.0.0.0:2379 \
  --listen-client-urls http://0.0.0.0:2379

# Test
curl http://localhost:2379/v3/kv/put \
  -X POST \
  -d '{"key":"Zm9v","value":"YmFy"}' # base64(foo) = Zm9v, base64(bar) = YmFy
```

## Resources

- **etcd Docs**: [Documentation](https://etcd.io/docs/)
- **API Reference**: [gRPC API](https://etcd.io/docs/v3.5/learning/api/)
- **Kubernetes**: [How Kubernetes uses etcd](https://kubernetes.io/docs/concepts/overview/components/)

## Common Patterns

### Service Discovery
```typescript
const registry = new ServiceRegistry(client);
await registry.register('api', 'node1', 'http://10.0.0.1:8080', 60);
const services = await registry.discover('api');
```

### Distributed Locking
```typescript
const lock = new DistributedLock(client, '/locks/resource-123');
if (await lock.acquire()) {
  try {
    // Critical section
  } finally {
    await lock.release();
  }
}
```

### Configuration Management
```typescript
await client.put('/config/database/url', 'postgres://...');
const configs = await client.get('/config/', { prefix: true });
```

## Notes

- **Distributed** - Raft consensus for strong consistency
- **Watch API** - Real-time notifications of changes
- **Leases** - Automatic key expiration (TTL)
- **Transactions** - Atomic compare-and-swap operations
- **Used by Kubernetes** for cluster coordination
- **gRPC-based** - efficient binary protocol
- **HTTP/JSON gateway** - easier for web clients
