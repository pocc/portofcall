# HashiCorp Nomad Protocol (Port 4646)

## Overview
HashiCorp Nomad is a workload orchestrator that provides job scheduling, cluster management, and multi-region deployment via a RESTful HTTP API. Port 4646 is the default HTTP API port.

- **Default Port:** 4646
- **Transport:** TCP (HTTP/1.1 JSON API)
- **Authentication:** Optional ACL token via `X-Nomad-Token` header
- **Status:** Active — widely used for container orchestration alongside Kubernetes

## Protocol Flow

```
Client                          Nomad Server (port 4646)
  |                                |
  | --- TCP connect -------------> |
  |                                |
  | GET /v1/agent/self HTTP/1.1    |
  | Host: nomad:4646               |
  | X-Nomad-Token: <token>         |
  | Accept: application/json       |
  | Connection: close              |
  | --------------------------->   |
  |                                |
  | <-- 200 OK + JSON agent info   |
  |                                |
  | GET /v1/jobs HTTP/1.1          |
  | --------------------------->   |
  | <-- 200 OK + JSON job list     |
```

## Implementation Details

### Worker Endpoints

#### `POST /api/nomad/health`
Connect to Nomad and retrieve agent health and cluster info.

**Request Body:**
```json
{
  "host": "nomad.example.com",
  "port": 4646,
  "token": "optional-acl-token",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "nomad.example.com",
  "port": 4646,
  "rtt": 45,
  "version": "1.7.3",
  "region": "global",
  "datacenter": "dc1",
  "nodeName": "nomad-server-1",
  "server": true,
  "leader": "10.0.0.1:4647",
  "raftPeers": "3",
  "protocol": "Nomad"
}
```

#### `POST /api/nomad/jobs`
List all registered jobs.

**Request Body:**
```json
{
  "host": "nomad.example.com",
  "port": 4646,
  "token": "optional-acl-token",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "nomad.example.com",
  "port": 4646,
  "rtt": 35,
  "jobs": [
    { "id": "webapp", "name": "webapp", "type": "service", "status": "running", "priority": 50 },
    { "id": "batch-job", "name": "batch-job", "type": "batch", "status": "dead", "priority": 10 }
  ],
  "jobCount": 2
}
```

#### `POST /api/nomad/nodes`
List all nodes in the cluster.

**Request Body:**
```json
{
  "host": "nomad.example.com",
  "port": 4646,
  "token": "optional-acl-token",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "nomad.example.com",
  "port": 4646,
  "rtt": 30,
  "nodes": [
    { "id": "a1b2c3d4...", "name": "worker-1", "datacenter": "dc1", "status": "ready", "drain": false }
  ],
  "nodeCount": 1
}
```

### Nomad API Paths Used

| Path | Description |
|------|-------------|
| `/v1/agent/self` | Agent info, version, config |
| `/v1/status/leader` | Current Raft leader address |
| `/v1/jobs` | List all jobs |
| `/v1/nodes` | List all cluster nodes |

### HashiCorp Stack Ports

| Product | Port | Protocol |
|---------|------|----------|
| **Nomad** | 4646 | HTTP API |
| **Nomad** | 4647 | RPC (internal) |
| **Nomad** | 4648 | Serf gossip |
| **Consul** | 8500 | HTTP API |
| **Vault** | 8200 | HTTP API |
| **Boundary** | 9200 | HTTP API |

### Authentication
- ACL tokens passed via `X-Nomad-Token` HTTP header
- The `/v1/agent/self` endpoint may be accessible without authentication
- Job and node listings typically require `node:read` and `job:read` policies
