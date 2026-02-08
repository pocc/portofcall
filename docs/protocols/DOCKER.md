# Docker API Protocol Implementation Plan

## Overview

**Protocol:** Docker Engine API (HTTP over TCP socket)
**Port:** 2375 (HTTP), 2376 (HTTPS)
**Specification:** [Docker Engine API](https://docs.docker.com/engine/api/)
**Complexity:** Medium
**Purpose:** Container management and orchestration

Docker API enables **browser-based container management** - start/stop containers, view logs, manage images, all without Docker CLI.

### Use Cases
- Container management dashboard
- Remote Docker administration
- Container logs viewing
- Image management
- Resource monitoring
- Educational - learn containerization

## Protocol Specification

### Docker API is HTTP/REST

```
GET /containers/json - List containers
POST /containers/create - Create container
POST /containers/{id}/start - Start container
POST /containers/{id}/stop - Stop container
GET /containers/{id}/logs - Get logs
GET /images/json - List images
```

### API Versioning

```
GET /v1.43/containers/json
```

## Worker Implementation

```typescript
// src/worker/protocols/docker/client.ts

export interface DockerConfig {
  host: string;
  port: number;
  version?: string;
}

export interface Container {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
}

export class DockerClient {
  private baseUrl: string;

  constructor(private config: DockerConfig) {
    const version = config.version || 'v1.43';
    this.baseUrl = `http://${config.host}:${config.port}/${version}`;
  }

  async listContainers(all: boolean = false): Promise<Container[]> {
    const url = `${this.baseUrl}/containers/json${all ? '?all=1' : ''}`;
    const response = await fetch(url);
    return response.json();
  }

  async inspectContainer(id: string): Promise<any> {
    const url = `${this.baseUrl}/containers/${id}/json`;
    const response = await fetch(url);
    return response.json();
  }

  async startContainer(id: string): Promise<void> {
    const url = `${this.baseUrl}/containers/${id}/start`;
    await fetch(url, { method: 'POST' });
  }

  async stopContainer(id: string): Promise<void> {
    const url = `${this.baseUrl}/containers/${id}/stop`;
    await fetch(url, { method: 'POST' });
  }

  async removeContainer(id: string, force: boolean = false): Promise<void> {
    const url = `${this.baseUrl}/containers/${id}${force ? '?force=1' : ''}`;
    await fetch(url, { method: 'DELETE' });
  }

  async getLogs(id: string, tail: number = 100): Promise<string> {
    const url = `${this.baseUrl}/containers/${id}/logs?stdout=1&stderr=1&tail=${tail}`;
    const response = await fetch(url);
    return response.text();
  }

  async listImages(): Promise<any[]> {
    const url = `${this.baseUrl}/images/json`;
    const response = await fetch(url);
    return response.json();
  }

  async pullImage(name: string): Promise<void> {
    const url = `${this.baseUrl}/images/create?fromImage=${name}`;
    await fetch(url, { method: 'POST' });
  }

  async getStats(id: string): Promise<any> {
    const url = `${this.baseUrl}/containers/${id}/stats?stream=false`;
    const response = await fetch(url);
    return response.json();
  }
}
```

## Web UI Design

```typescript
// src/components/DockerDashboard.tsx

export function DockerDashboard() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>('');

  const loadContainers = async () => {
    const response = await fetch('/api/docker/containers');
    const data = await response.json();
    setContainers(data);
  };

  const startContainer = async (id: string) => {
    await fetch(`/api/docker/containers/${id}/start`, { method: 'POST' });
    loadContainers();
  };

  const stopContainer = async (id: string) => {
    await fetch(`/api/docker/containers/${id}/stop`, { method: 'POST' });
    loadContainers();
  };

  return (
    <div className="docker-dashboard">
      <h2>Docker Container Manager</h2>

      <button onClick={loadContainers}>Refresh</button>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Image</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {containers.map(container => (
            <tr key={container.Id}>
              <td>{container.Names[0].replace('/', '')}</td>
              <td>{container.Image}</td>
              <td>
                <span className={`status ${container.State}`}>
                  {container.State}
                </span>
              </td>
              <td>
                {container.State === 'running' ? (
                  <button onClick={() => stopContainer(container.Id)}>
                    Stop
                  </button>
                ) : (
                  <button onClick={() => startContainer(container.Id)}>
                    Start
                  </button>
                )}
                <button onClick={() => setSelectedContainer(container.Id)}>
                  Logs
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedContainer && (
        <div className="logs-panel">
          <h3>Container Logs</h3>
          <pre>{logs}</pre>
        </div>
      )}
    </div>
  );
}
```

## Security

### Critical Security Note

```typescript
// ⚠️ Docker API without TLS is a MASSIVE security risk
// Anyone can execute arbitrary code in containers
// ALWAYS use TLS (port 2376) in production

// Check TLS certificate
const config = {
  host: 'docker.example.com',
  port: 2376,
  tlsVerify: true,
  tlsCert: certPath,
  tlsKey: keyPath,
  tlsCa: caPath,
};
```

## Testing

```bash
# Enable Docker API (INSECURE - local only)
dockerd -H tcp://127.0.0.1:2375

# Test with curl
curl http://localhost:2375/v1.43/containers/json
```

## Resources

- **Docker Engine API**: [Official Docs](https://docs.docker.com/engine/api/)
- **Docker SDK**: [Node.js Dockerode](https://github.com/apocas/dockerode)

## Notes

- Docker API is **HTTP-based** (not custom binary protocol)
- **Extremely dangerous** without TLS
- Can execute **arbitrary code** via containers
- Perfect for **DevOps dashboards**
