# Consul Protocol Implementation Plan

## Overview

**Protocol:** Consul HTTP/RPC API
**Port:** 8500 (HTTP API), 8600 (DNS), 8300 (Server RPC), 8301/8302 (Serf LAN/WAN)
**Documentation:** [Consul API](https://www.consul.io/api-docs)
**Complexity:** Medium
**Purpose:** Service discovery and configuration

Consul provides **distributed service discovery** - register services, health checks, key-value storage, and multi-datacenter support with a REST API and DNS interface.

### Use Cases
- Service discovery and registry
- Health checking and monitoring
- Key-value configuration storage
- Multi-datacenter service mesh
- Distributed locking and leader election
- Service segmentation via Connect

## Protocol Specification

### HTTP API Endpoints

Consul primarily uses HTTP/JSON for client communication:

```
GET  /v1/catalog/services                    # List all services
GET  /v1/catalog/service/:service            # Get service instances
GET  /v1/health/service/:service             # Health check query
PUT  /v1/agent/service/register              # Register service
PUT  /v1/agent/service/deregister/:service   # Deregister service
GET  /v1/kv/:key                             # Get key-value
PUT  /v1/kv/:key                             # Set key-value
DELETE /v1/kv/:key                           # Delete key-value
GET  /v1/session/create                      # Create session (locking)
PUT  /v1/kv/:key?acquire=:session            # Acquire lock
PUT  /v1/kv/:key?release=:session            # Release lock
```

### Service Registration Format

```json
{
  "ID": "redis-1",
  "Name": "redis",
  "Tags": ["primary", "v1"],
  "Address": "192.168.1.100",
  "Port": 6379,
  "Meta": {
    "version": "6.2.0"
  },
  "Check": {
    "HTTP": "http://192.168.1.100:6379/health",
    "Interval": "10s",
    "Timeout": "5s"
  }
}
```

### Health Check Response

```json
[
  {
    "Node": {
      "Node": "node1",
      "Address": "192.168.1.10"
    },
    "Service": {
      "ID": "redis-1",
      "Service": "redis",
      "Tags": ["primary"],
      "Address": "192.168.1.100",
      "Port": 6379
    },
    "Checks": [
      {
        "CheckID": "service:redis-1",
        "Status": "passing",
        "Output": "HTTP GET http://192.168.1.100:6379/health: 200 OK"
      }
    ]
  }
]
```

## Worker Implementation

```typescript
// src/worker/protocols/consul/client.ts

import { connect } from 'cloudflare:sockets';

export interface ConsulConfig {
  host: string;
  port?: number;
  token?: string;
  datacenter?: string;
  namespace?: string;
}

export interface Service {
  ID: string;
  Name: string;
  Tags?: string[];
  Address: string;
  Port: number;
  Meta?: Record<string, string>;
}

export interface ServiceRegistration extends Service {
  Check?: HealthCheck;
  Checks?: HealthCheck[];
}

export interface HealthCheck {
  HTTP?: string;
  TCP?: string;
  Script?: string;
  Interval: string;
  Timeout?: string;
  DeregisterCriticalServiceAfter?: string;
}

export interface ServiceInstance {
  Node: {
    Node: string;
    Address: string;
    Datacenter: string;
  };
  Service: Service;
  Checks: CheckStatus[];
}

export interface CheckStatus {
  CheckID: string;
  Name: string;
  Status: 'passing' | 'warning' | 'critical';
  Output: string;
}

export interface KVPair {
  Key: string;
  Value: string;
  Flags?: number;
  Session?: string;
  CreateIndex: number;
  ModifyIndex: number;
  LockIndex: number;
}

export class ConsulClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(private config: ConsulConfig) {
    const port = config.port || 8500;
    this.baseUrl = `http://${config.host}:${port}/v1`;

    this.headers = {
      'Content-Type': 'application/json',
    };

    if (config.token) {
      this.headers['X-Consul-Token'] = config.token;
    }
  }

  // Service Discovery

  async listServices(): Promise<Record<string, string[]>> {
    const url = this.buildUrl('/catalog/services');
    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      throw new Error(`Consul API error: ${response.status}`);
    }

    return await response.json();
  }

  async getService(name: string, options?: {
    tag?: string;
    passing?: boolean;
  }): Promise<ServiceInstance[]> {
    let url = this.buildUrl(`/health/service/${name}`);

    const params = new URLSearchParams();
    if (options?.tag) params.append('tag', options.tag);
    if (options?.passing) params.append('passing', 'true');

    if (params.toString()) {
      url += '?' + params.toString();
    }

    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      throw new Error(`Consul API error: ${response.status}`);
    }

    return await response.json();
  }

  async registerService(service: ServiceRegistration): Promise<void> {
    const url = this.buildUrl('/agent/service/register');

    const response = await fetch(url, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(service),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to register service: ${error}`);
    }
  }

  async deregisterService(serviceId: string): Promise<void> {
    const url = this.buildUrl(`/agent/service/deregister/${serviceId}`);

    const response = await fetch(url, {
      method: 'PUT',
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to deregister service: ${response.status}`);
    }
  }

  // Key-Value Store

  async kvGet(key: string, options?: {
    recurse?: boolean;
    raw?: boolean;
  }): Promise<KVPair[] | string | null> {
    let url = this.buildUrl(`/kv/${key}`);

    const params = new URLSearchParams();
    if (options?.recurse) params.append('recurse', 'true');
    if (options?.raw) params.append('raw', 'true');

    if (params.toString()) {
      url += '?' + params.toString();
    }

    const response = await fetch(url, { headers: this.headers });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Consul KV error: ${response.status}`);
    }

    if (options?.raw) {
      return await response.text();
    }

    const pairs: KVPair[] = await response.json();

    // Decode base64 values
    return pairs.map(pair => ({
      ...pair,
      Value: atob(pair.Value),
    }));
  }

  async kvPut(key: string, value: string, options?: {
    flags?: number;
    acquire?: string; // Session ID for locking
    release?: string; // Session ID to release
  }): Promise<boolean> {
    let url = this.buildUrl(`/kv/${key}`);

    const params = new URLSearchParams();
    if (options?.flags !== undefined) params.append('flags', String(options.flags));
    if (options?.acquire) params.append('acquire', options.acquire);
    if (options?.release) params.append('release', options.release);

    if (params.toString()) {
      url += '?' + params.toString();
    }

    const response = await fetch(url, {
      method: 'PUT',
      headers: this.headers,
      body: value,
    });

    if (!response.ok) {
      throw new Error(`Consul KV error: ${response.status}`);
    }

    return await response.json(); // Returns true/false
  }

  async kvDelete(key: string, recurse: boolean = false): Promise<void> {
    let url = this.buildUrl(`/kv/${key}`);

    if (recurse) {
      url += '?recurse=true';
    }

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Consul KV error: ${response.status}`);
    }
  }

  // Sessions (for distributed locking)

  async createSession(options?: {
    Name?: string;
    TTL?: string;
    LockDelay?: string;
    Behavior?: 'release' | 'delete';
  }): Promise<string> {
    const url = this.buildUrl('/session/create');

    const response = await fetch(url, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(options || {}),
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`);
    }

    const data = await response.json();
    return data.ID;
  }

  async destroySession(sessionId: string): Promise<void> {
    const url = this.buildUrl(`/session/destroy/${sessionId}`);

    const response = await fetch(url, {
      method: 'PUT',
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to destroy session: ${response.status}`);
    }
  }

  async renewSession(sessionId: string): Promise<void> {
    const url = this.buildUrl(`/session/renew/${sessionId}`);

    const response = await fetch(url, {
      method: 'PUT',
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to renew session: ${response.status}`);
    }
  }

  // Watch for changes (blocking query)

  async watch<T>(
    endpoint: string,
    index: number = 0,
    timeout: string = '5m'
  ): Promise<{ data: T; index: number }> {
    let url = this.baseUrl + endpoint;
    url += `?index=${index}&wait=${timeout}`;

    const response = await fetch(url, { headers: this.headers });

    if (!response.ok) {
      throw new Error(`Consul watch error: ${response.status}`);
    }

    const consulIndex = response.headers.get('X-Consul-Index');
    const data = await response.json();

    return {
      data,
      index: consulIndex ? parseInt(consulIndex) : index,
    };
  }

  private buildUrl(path: string): string {
    let url = this.baseUrl + path;

    if (this.config.datacenter) {
      const separator = path.includes('?') ? '&' : '?';
      url += `${separator}dc=${this.config.datacenter}`;
    }

    if (this.config.namespace) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}ns=${this.config.namespace}`;
    }

    return url;
  }
}

// Distributed Lock Pattern

export class ConsulLock {
  private sessionId?: string;
  private locked: boolean = false;

  constructor(
    private client: ConsulClient,
    private key: string,
    private value: string = 'locked'
  ) {}

  async acquire(ttl: string = '15s'): Promise<boolean> {
    // Create session
    this.sessionId = await this.client.createSession({
      Name: `lock-${this.key}`,
      TTL: ttl,
      Behavior: 'delete',
    });

    // Try to acquire lock
    this.locked = await this.client.kvPut(this.key, this.value, {
      acquire: this.sessionId,
    });

    return this.locked;
  }

  async release(): Promise<void> {
    if (!this.sessionId || !this.locked) {
      return;
    }

    await this.client.kvPut(this.key, this.value, {
      release: this.sessionId,
    });

    await this.client.destroySession(this.sessionId);
    this.locked = false;
  }

  async renew(): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session to renew');
    }

    await this.client.renewSession(this.sessionId);
  }

  isLocked(): boolean {
    return this.locked;
  }
}

// Service Watcher Pattern

export class ServiceWatcher {
  private watching: boolean = false;
  private index: number = 0;

  constructor(
    private client: ConsulClient,
    private serviceName: string,
    private callback: (instances: ServiceInstance[]) => void
  ) {}

  async start(): Promise<void> {
    this.watching = true;

    while (this.watching) {
      try {
        const result = await this.client.watch<ServiceInstance[]>(
          `/health/service/${this.serviceName}`,
          this.index
        );

        this.index = result.index;
        this.callback(result.data);
      } catch (error) {
        console.error('Watch error:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  stop(): void {
    this.watching = false;
  }
}
```

## Web UI Design

```typescript
// src/components/ConsulClient.tsx

import { useState, useEffect } from 'react';

export function ConsulClient() {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(8500);
  const [connected, setConnected] = useState(false);
  const [services, setServices] = useState<Record<string, string[]>>({});
  const [selectedService, setSelectedService] = useState<string>('');
  const [instances, setInstances] = useState<any[]>([]);
  const [kvKey, setKvKey] = useState('');
  const [kvValue, setKvValue] = useState('');
  const [kvData, setKvData] = useState<any[]>([]);

  const connect = async () => {
    try {
      const response = await fetch('/api/consul/connect', {
        method: 'POST',
        body: JSON.stringify({ host, port }),
      });

      if (response.ok) {
        setConnected(true);
        await loadServices();
      }
    } catch (error) {
      alert(`Connection failed: ${error.message}`);
    }
  };

  const loadServices = async () => {
    const response = await fetch('/api/consul/services');
    const data = await response.json();
    setServices(data);
  };

  const loadServiceInstances = async (serviceName: string) => {
    const response = await fetch(`/api/consul/service/${serviceName}?passing=true`);
    const data = await response.json();
    setInstances(data);
    setSelectedService(serviceName);
  };

  const registerService = async () => {
    const service = {
      ID: `web-${Date.now()}`,
      Name: 'web',
      Address: '127.0.0.1',
      Port: 8080,
      Tags: ['production'],
      Check: {
        HTTP: 'http://127.0.0.1:8080/health',
        Interval: '10s',
      },
    };

    await fetch('/api/consul/register', {
      method: 'POST',
      body: JSON.stringify(service),
    });

    await loadServices();
  };

  const kvGet = async () => {
    const response = await fetch(`/api/consul/kv/${encodeURIComponent(kvKey)}`);
    const data = await response.json();
    setKvData(data || []);
  };

  const kvPut = async () => {
    await fetch(`/api/consul/kv/${encodeURIComponent(kvKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ value: kvValue }),
    });

    setKvValue('');
    await kvGet();
  };

  return (
    <div className="consul-client">
      <h2>Consul Service Discovery</h2>

      {!connected ? (
        <div className="connection">
          <input
            type="text"
            placeholder="Consul Host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
          <input
            type="number"
            placeholder="Port"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
          <button onClick={connect}>Connect</button>
        </div>
      ) : (
        <>
          <div className="services">
            <h3>Services</h3>
            <button onClick={registerService}>Register Test Service</button>
            <ul>
              {Object.entries(services).map(([name, tags]) => (
                <li key={name} onClick={() => loadServiceInstances(name)}>
                  <strong>{name}</strong>
                  {tags.length > 0 && <span className="tags"> [{tags.join(', ')}]</span>}
                </li>
              ))}
            </ul>
          </div>

          {selectedService && (
            <div className="instances">
              <h3>Instances: {selectedService}</h3>
              {instances.map((instance, i) => (
                <div key={i} className="instance">
                  <div className="node">
                    <strong>{instance.Node.Node}</strong> ({instance.Node.Address})
                  </div>
                  <div className="service">
                    {instance.Service.Address}:{instance.Service.Port}
                    {instance.Service.Tags && (
                      <span className="tags"> [{instance.Service.Tags.join(', ')}]</span>
                    )}
                  </div>
                  <div className="checks">
                    {instance.Checks.map((check: any, j: number) => (
                      <div key={j} className={`check ${check.Status}`}>
                        {check.Status}: {check.Output}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="kv-store">
            <h3>Key-Value Store</h3>
            <div className="kv-input">
              <input
                type="text"
                placeholder="Key"
                value={kvKey}
                onChange={(e) => setKvKey(e.target.value)}
              />
              <input
                type="text"
                placeholder="Value"
                value={kvValue}
                onChange={(e) => setKvValue(e.target.value)}
              />
              <button onClick={kvGet}>Get</button>
              <button onClick={kvPut}>Put</button>
            </div>

            {kvData.length > 0 && (
              <div className="kv-results">
                {kvData.map((pair, i) => (
                  <div key={i} className="kv-pair">
                    <strong>{pair.Key}</strong>: {pair.Value}
                    <span className="meta"> (Index: {pair.ModifyIndex})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="info">
        <h3>About Consul</h3>
        <ul>
          <li>Service discovery and health checking</li>
          <li>Key-value configuration store</li>
          <li>Multi-datacenter support</li>
          <li>Service mesh with Consul Connect</li>
          <li>Distributed locking and leader election</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### ACL Tokens

```typescript
// Token-based authentication
const client = new ConsulClient({
  host: 'consul.example.com',
  port: 8500,
  token: 'your-acl-token-here',
});
```

### TLS Configuration

```bash
# Enable TLS on Consul
consul agent \
  -config-dir=/etc/consul.d \
  -encrypt="base64-gossip-key" \
  -ca-file=/path/to/ca.pem \
  -cert-file=/path/to/consul.pem \
  -key-file=/path/to/consul-key.pem
```

### Access Control

```hcl
# ACL policy example
service "web" {
  policy = "write"
}

service_prefix "" {
  policy = "read"
}

key_prefix "config/" {
  policy = "write"
}
```

## Testing

```bash
# Docker Consul (single node)
docker run -d \
  -p 8500:8500 \
  -p 8600:8600/udp \
  --name consul \
  consul:latest agent -dev -ui -client=0.0.0.0

# Access UI
open http://localhost:8500/ui

# CLI tests
consul members
consul catalog services
consul kv put config/app/port 8080
consul kv get config/app/port

# Register service via API
curl -X PUT http://localhost:8500/v1/agent/service/register \
  -d '{
    "Name": "web",
    "Port": 8080,
    "Check": {
      "HTTP": "http://localhost:8080/health",
      "Interval": "10s"
    }
  }'

# Query service
curl http://localhost:8500/v1/health/service/web?passing=true
```

## Resources

- **Consul Docs**: [Documentation](https://www.consul.io/docs)
- **HTTP API**: [API Reference](https://www.consul.io/api-docs)
- **Consul CLI**: [Commands](https://www.consul.io/commands)
- **Tutorials**: [Learn Consul](https://learn.hashicorp.com/consul)

## Common Patterns

### Service Discovery

```typescript
// Watch for service changes
const watcher = new ServiceWatcher(client, 'web', (instances) => {
  console.log('Service instances updated:', instances.length);
  instances.forEach(inst => {
    console.log(`- ${inst.Service.Address}:${inst.Service.Port}`);
  });
});

await watcher.start();
```

### Distributed Locking

```typescript
const lock = new ConsulLock(client, 'jobs/process-queue', 'worker-1');

if (await lock.acquire('30s')) {
  try {
    // Do work while holding lock
    console.log('Lock acquired, processing...');

    // Renew if needed
    await lock.renew();
  } finally {
    await lock.release();
  }
} else {
  console.log('Failed to acquire lock');
}
```

### Configuration Management

```typescript
// Store configuration
await client.kvPut('config/database/host', 'db.example.com');
await client.kvPut('config/database/port', '5432');
await client.kvPut('config/database/name', 'myapp');

// Retrieve configuration
const host = await client.kvGet('config/database/host', { raw: true });
const dbConfig = await client.kvGet('config/database/', { recurse: true });
```

## Notes

- **HTTP/JSON API** - RESTful interface, easy to implement
- **Blocking queries** - Long polling for real-time updates
- **Service health** - Built-in health checking
- **Multi-datacenter** - Replicate across datacenters
- **Gossip protocol** - Uses Serf for cluster membership
- **Raft consensus** - Strong consistency for critical data
- **DNS interface** - Service discovery via DNS (port 8600)
- **Watches** - React to changes in services/keys
- **Sessions** - TTL-based sessions for distributed locks
- **Connect** - Built-in service mesh with mutual TLS
- **Namespaces** - Multi-tenancy (Enterprise feature)
- Perfect for **microservices** architectures
