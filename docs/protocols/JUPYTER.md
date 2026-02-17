# Jupyter REST API Protocol Implementation

## Overview

**Protocol:** Jupyter Notebook/JupyterLab REST API (HTTP over TCP)
**Port:** 8888 (default)
**Specification:** [Jupyter Server REST API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html)
**Complexity:** Low–Medium
**Purpose:** Interactive computing, notebook management, kernel orchestration

Jupyter exposes a JSON REST API for managing notebooks, kernels, sessions, and terminal processes. This implementation uses raw HTTP/1.1 over TCP sockets, mirroring the Docker and etcd protocol implementations.

### Use Cases
- Jupyter server health monitoring
- Kernel and session enumeration
- Notebook file listing
- Server version detection
- CI/CD connectivity testing for data science infrastructure

## Protocol Specification

### REST Endpoints

```
GET  /api              → {"version": "7.x.y"}
GET  /api/status       → {kernel_connections, last_activity, msg_rate, started}
GET  /api/kernelspecs  → {default, kernelspecs: {name: spec}}
GET  /api/kernels      → [{id, name, connections, execution_state}]
GET  /api/sessions     → [{id, path, name, type, kernel}]
GET  /api/contents     → file/directory listing (root by default)
GET  /api/terminals    → [{name, last_activity}]
GET  /api/nbformat     → {minimum_minor_version, current_minor_version}
```

### Authentication

Token passed via HTTP header:
```
Authorization: token <TOKEN>
```

Or as a query parameter:
```
GET /api?token=<TOKEN>
```

Without a token, unauthenticated servers accept all requests. Servers with tokens configured return HTTP 401 for unauthorized requests.

## Worker Implementation

The worker at `src/worker/jupyter.ts` provides two handlers:

### `handleJupyterHealth`

Endpoint: `POST /api/jupyter/health`

Performs three parallel checks:
1. `GET /api` — API version info
2. `GET /api/status` — server status and activity metrics
3. `GET /api/kernelspecs` — available kernel names

Request body:
```json
{
  "host": "localhost",
  "port": 8888,
  "token": "optional-auth-token",
  "timeout": 15000
}
```

Response:
```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 42,
  "parsed": {
    "api": {"version": "7.0.2"},
    "status": {
      "kernel_connections": 1,
      "last_activity": "2024-01-01T00:00:00.000Z",
      "msg_rate": 0,
      "started": "2024-01-01T00:00:00.000Z"
    },
    "kernelspecs": {
      "default": "python3",
      "kernelNames": ["python3", "ir", "bash"]
    },
    "requiresAuth": false
  }
}
```

### `handleJupyterQuery`

Endpoint: `POST /api/jupyter/query`

Sends an arbitrary HTTP request to the Jupyter REST API.

Request body:
```json
{
  "host": "localhost",
  "port": 8888,
  "token": "optional-auth-token",
  "method": "GET",
  "path": "/api/kernels",
  "body": null,
  "timeout": 15000
}
```

## Security Considerations

- **SSRF**: Cloudflare-protected hosts are blocked via the shared `cloudflare-detector` module
- **Input validation**: Host is required; method is validated against an allow list
- **No credential exposure**: Tokens are sent as HTTP headers, never logged
- **Read-oriented**: No kernel execution or notebook modification endpoints are exposed

## Starting Jupyter for Testing

```bash
# Classic Notebook (token displayed at startup)
jupyter notebook --no-browser --port=8888

# JupyterLab
jupyter lab --no-browser --port=8888

# Disable token (testing only, never in production)
jupyter notebook --no-browser --NotebookApp.token=''

# Pass token explicitly
jupyter notebook --no-browser --NotebookApp.token='mytoken'
```

## Common Ports

| Port | Use                        |
|------|----------------------------|
| 8888 | Default (Notebook/Lab)     |
| 8889 | Alternative instance       |
| 8080 | Reverse proxy / JupyterHub |

## Implementation Notes

- The Jupyter API follows REST conventions with JSON responses
- HTTP chunked transfer encoding is supported via the shared `decodeChunked` helper
- The health check makes up to 3 sequential requests; partial failures are tolerated
- A 401/403 response is surfaced as `requiresAuth: true` rather than an error
