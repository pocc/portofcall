# Jupyter REST API -- Port of Call Reference

**Spec:** [Jupyter Server REST API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html)
**Default port:** 8888
**Source:** `src/worker/jupyter.ts`
**Tests:** `tests/jupyter.test.ts`

---

## Architecture: two transport paths

Like the Docker implementation, Jupyter's REST API is HTTP/JSON. Port of Call uses two transport mechanisms:

| Handler | Transport | Why |
|---|---|---|
| `handleJupyterHealth`, `handleJupyterQuery` | Raw TCP via `cloudflare:sockets` with hand-crafted HTTP/1.1 | Cloudflare Workers `fetch()` cannot reach arbitrary HTTP ports; `connect()` bypasses this restriction |
| `handleJupyterKernelCreate`, `handleJupyterKernelList`, `handleJupyterKernelDelete`, `handleJupyterNotebooks`, `handleJupyterNotebookGet` | Native `fetch()` over HTTP | Simpler for CRUD endpoints; assumes the target port is reachable |

The TCP path includes its own HTTP/1.1 response parser with chunked transfer encoding support.

---

## Authentication

Jupyter supports token-based authentication. Tokens are generated at server startup and printed to stdout:

```
http://localhost:8888/?token=abc123def456...
```

### Header format

```
Authorization: token <TOKEN>
```

This is **not** `Bearer` -- Jupyter uses a custom `token` scheme. The implementation correctly uses this format in both the raw TCP path (`sendHttpRequest`) and the `fetch()` path (`jupyterHeaders`).

### Query parameter alternative

Jupyter also accepts `?token=<TOKEN>` as a URL query parameter. The implementation does **not** use query parameter auth -- all authentication goes through the `Authorization` header, which is the preferred approach.

### Auth detection

When the server returns HTTP 401 or 403 to `GET /api`, the health check sets `requiresAuth: true` in the response rather than returning an error. This allows the client to prompt for a token.

---

## Jupyter REST API endpoints (upstream)

These are the Jupyter server endpoints the implementation targets:

| Method | Path | Purpose | Response |
|---|---|---|---|
| GET | `/api` | Server version and identity | `{"version": "7.x.y"}` |
| GET | `/api/status` | Server status, kernel connections, uptime | `{started, last_activity, kernel_connections, msg_rate}` |
| GET | `/api/kernelspecs` | Available kernel specifications | `{default, kernelspecs: {name: {name, spec, resources}}}` |
| GET | `/api/kernels` | List running kernels | `[{id, name, last_activity, execution_state, connections}]` |
| POST | `/api/kernels` | Start a new kernel | `{id, name, last_activity, execution_state, connections}` |
| DELETE | `/api/kernels/{kernel_id}` | Shut down a kernel | 204 No Content |
| GET | `/api/sessions` | List active sessions | `[{id, path, name, type, kernel}]` |
| GET | `/api/contents/{path}` | List directory or get file metadata | `{name, path, type, content, ...}` |
| GET | `/api/contents/{path}?content=1` | Get file content (notebook cells, text) | Same as above with full `content` field |
| PUT | `/api/contents/{path}` | Create or overwrite a file | Content model |
| GET | `/api/terminals` | List running terminal sessions | `[{name, last_activity}]` |
| GET | `/api/nbformat` | Notebook format version info | `{minimum_minor_version, current_minor_version}` |

### Contents API path encoding

The Contents API uses filesystem-style paths: `/api/contents/folder/subfolder/notebook.ipynb`. Each path segment is separated by literal `/` characters -- the path is **not** URL-encoded as a single component. Individual segments with special characters (spaces, unicode) must be percent-encoded per-segment.

Correct: `/api/contents/my%20folder/notebook.ipynb`
Wrong: `/api/contents/my%20folder%2Fnotebook.ipynb`

The implementation uses `encodeContentsPath()` to handle this correctly.

---

## Worker endpoints

### `POST /api/jupyter/health` -- Server health check

Sends three sequential requests via raw TCP:

1. `GET /api` -- API version
2. `GET /api/status` -- server status metrics
3. `GET /api/kernelspecs` -- available kernels

Requests 2 and 3 are fault-tolerant: if either fails, the health check still succeeds with partial data.

**Request body:**

```json
{
  "host": "jupyter.example.com",
  "port": 8888,
  "token": "abc123...",
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | Hostname or IP |
| `port` | number | `8888` | |
| `token` | string | (none) | Omit for unauthenticated servers |
| `timeout` | number | `15000` | Milliseconds, shared across all three requests |

**Response (success):**

```json
{
  "success": true,
  "statusCode": 200,
  "latencyMs": 85,
  "parsed": {
    "api": {
      "version": "7.0.2"
    },
    "status": {
      "started": "2025-01-15T10:00:00.000Z",
      "last_activity": "2025-01-15T12:30:00.000Z",
      "kernel_connections": 3,
      "msg_rate": 0.5
    },
    "kernelspecs": {
      "default": "python3",
      "kernelNames": ["python3", "ir", "julia-1.9"]
    },
    "requiresAuth": false
  }
}
```

**Response (auth required):**

```json
{
  "success": true,
  "statusCode": 403,
  "latencyMs": 22,
  "parsed": {
    "api": null,
    "status": null,
    "kernelspecs": null,
    "requiresAuth": true
  }
}
```

Note: `success` is `true` when the server responds (even with 403), because the connection itself succeeded. The `requiresAuth` flag tells the client to prompt for a token.

---

### `POST /api/jupyter/query` -- Arbitrary API request

Sends any HTTP method to any Jupyter REST API path via raw TCP.

**Request body:**

```json
{
  "host": "jupyter.example.com",
  "port": 8888,
  "token": "abc123...",
  "method": "GET",
  "path": "/api/sessions",
  "body": null,
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `8888` | |
| `token` | string | (none) | |
| `method` | string | `"GET"` | One of: GET, POST, PUT, DELETE, PATCH |
| `path` | string | `"/api"` | Jupyter API path; leading `/` is added if missing |
| `body` | string | (none) | JSON string for POST/PUT/PATCH |
| `timeout` | number | `15000` | |

**Response:**

```json
{
  "success": true,
  "statusCode": 200,
  "headers": {
    "content-type": "application/json",
    "server": "TornadoServer/6.4"
  },
  "body": "[{\"id\":\"...\",\"path\":\"Untitled.ipynb\",...}]",
  "parsed": [
    {
      "id": "abc123",
      "path": "Untitled.ipynb",
      "name": "",
      "type": "notebook",
      "kernel": {
        "id": "def456",
        "name": "python3",
        "execution_state": "idle"
      }
    }
  ],
  "latencyMs": 42
}
```

Both `body` (raw string) and `parsed` (JSON-parsed) are included. If the response is not valid JSON, `parsed` is `null`.

---

### `POST /api/jupyter/kernels` -- Create kernel

Starts a new kernel on the Jupyter server.

**Request body:**

```json
{
  "host": "jupyter.example.com",
  "port": 8888,
  "token": "abc123...",
  "kernelName": "python3"
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `8888` | |
| `token` | string | (none) | |
| `kernelName` | string | `"python3"` | Must match a name from `/api/kernelspecs` |

**Response:**

```json
{
  "success": true,
  "statusCode": 201,
  "host": "jupyter.example.com",
  "port": 8888,
  "kernel": {
    "id": "abc123-def456-...",
    "name": "python3",
    "last_activity": "2025-01-15T12:00:00.000Z",
    "execution_state": "starting",
    "connections": 0
  },
  "latencyMs": 1200
}
```

---

### `GET /api/jupyter/kernels` -- List running kernels

Parameters are passed as query string (this is a GET endpoint).

**Query parameters:**

| Param | Required | Default | Notes |
|---|---|---|---|
| `host` | yes | | |
| `port` | no | `8888` | |
| `token` | no | | |

**Example:** `GET /api/jupyter/kernels?host=jupyter.example.com&token=abc123`

**Response:**

```json
{
  "success": true,
  "statusCode": 200,
  "host": "jupyter.example.com",
  "port": 8888,
  "count": 2,
  "kernels": [
    {
      "id": "abc123-def456-...",
      "name": "python3",
      "last_activity": "2025-01-15T12:30:00.000Z",
      "execution_state": "idle",
      "connections": 1
    }
  ],
  "latencyMs": 35
}
```

---

### `DELETE /api/jupyter/kernels/{id}` -- Shut down a kernel

Despite the URL pattern, the kernel ID is passed in the request body (the URL path is matched but not parsed for the ID).

**Request body:**

```json
{
  "host": "jupyter.example.com",
  "port": 8888,
  "token": "abc123...",
  "kernelId": "abc123-def456-..."
}
```

**Response:**

```json
{
  "success": true,
  "statusCode": 204,
  "host": "jupyter.example.com",
  "port": 8888,
  "kernelId": "abc123-def456-...",
  "latencyMs": 150
}
```

Jupyter returns 204 No Content on successful kernel shutdown. The handler treats both 204 and any 2xx as success.

---

### `GET /api/jupyter/notebooks` -- List files and directories

Lists the contents of a directory on the Jupyter server.

**Query parameters:**

| Param | Required | Default | Notes |
|---|---|---|---|
| `host` | yes | | |
| `port` | no | `8888` | |
| `token` | no | | |
| `path` | no | `""` (root) | Directory path, e.g. `my-project/notebooks` |

**Response:**

```json
{
  "success": true,
  "statusCode": 200,
  "host": "jupyter.example.com",
  "port": 8888,
  "path": "",
  "count": 3,
  "items": [
    {
      "name": "Untitled.ipynb",
      "path": "Untitled.ipynb",
      "type": "notebook",
      "last_modified": "2025-01-15T12:00:00.000Z",
      "size": null
    },
    {
      "name": "data",
      "path": "data",
      "type": "directory",
      "last_modified": "2025-01-14T10:00:00.000Z",
      "size": null
    }
  ],
  "latencyMs": 28
}
```

---

### `GET /api/jupyter/notebook` -- Get notebook content

Retrieves the full content of a notebook including all cells and outputs.

**Query parameters:**

| Param | Required | Default | Notes |
|---|---|---|---|
| `host` | yes | | |
| `port` | no | `8888` | |
| `token` | no | | |
| `path` | yes | | Full path to notebook, e.g. `folder/analysis.ipynb` |

Internally sends `GET /api/contents/{path}?content=1` to the Jupyter server.

**Response:**

```json
{
  "success": true,
  "statusCode": 200,
  "host": "jupyter.example.com",
  "port": 8888,
  "path": "analysis.ipynb",
  "name": "analysis.ipynb",
  "type": "notebook",
  "content": {
    "cells": [
      {
        "cell_type": "code",
        "source": "import pandas as pd\ndf = pd.read_csv('data.csv')",
        "metadata": {},
        "outputs": [],
        "execution_count": 1
      }
    ],
    "metadata": {
      "kernelspec": {
        "display_name": "Python 3",
        "language": "python",
        "name": "python3"
      }
    },
    "nbformat": 4,
    "nbformat_minor": 5
  },
  "latencyMs": 55
}
```

---

## Security

### SSRF protection

All seven handlers check the target host against Cloudflare's IP ranges via the shared `cloudflare-detector` module. Cloudflare-proxied hosts are rejected with HTTP 403 and `isCloudflare: true` in the response body.

### Input validation

- `host` is required on all endpoints
- `method` is validated against an allowlist: GET, POST, PUT, DELETE, PATCH
- `kernelId` is required for the delete endpoint
- `path` is required for the notebook-get endpoint
- Paths are normalized (leading `/` ensured, per-segment encoding for Contents API)

### No credential exposure

Tokens are sent only as HTTP `Authorization` headers to the target Jupyter server. They are never logged, returned in responses, or stored.

---

## Quick queries (client UI)

The frontend client (`src/components/JupyterClient.tsx`) provides one-click quick queries:

| Label | Method | Path |
|---|---|---|
| Version | GET | `/api` |
| Status | GET | `/api/status` |
| Kernel specs | GET | `/api/kernelspecs` |
| Running kernels | GET | `/api/kernels` |
| Sessions | GET | `/api/sessions` |
| Root contents | GET | `/api/contents` |
| Terminals | GET | `/api/terminals` |
| Notebook format | GET | `/api/nbformat` |

---

## Starting Jupyter for testing

```bash
# Classic Notebook (token printed at startup)
jupyter notebook --no-browser --port=8888

# JupyterLab
jupyter lab --no-browser --port=8888

# Disable token (testing only, never in production)
jupyter notebook --no-browser --NotebookApp.token=''

# JupyterLab equivalent
jupyter lab --no-browser --ServerApp.token=''

# Specify a fixed token
jupyter notebook --no-browser --NotebookApp.token='mytoken'
jupyter lab --no-browser --ServerApp.token='mytoken'

# Allow remote connections (needed for non-localhost testing)
jupyter lab --no-browser --ServerApp.ip='0.0.0.0' --ServerApp.token='mytoken'
```

Note: Classic Notebook uses `--NotebookApp.*` flags; JupyterLab / jupyter-server uses `--ServerApp.*` flags.

---

## Common ports

| Port | Use |
|---|---|
| 8888 | Default (Notebook/Lab) |
| 8889 | Second instance / alternative |
| 8080 | Behind reverse proxy / JupyterHub |
| 443 | JupyterHub with TLS |

---

## Chunked transfer encoding

Jupyter (via Tornado) may use chunked transfer encoding for responses. The raw TCP path includes a `decodeChunked()` function that parses the `Transfer-Encoding: chunked` format:

```
<hex-size>\r\n
<chunk-data>\r\n
...
0\r\n
\r\n
```

This is detected automatically by checking the `transfer-encoding` response header.

---

## Implementation notes

- The health check makes three **sequential** requests to the same server (not parallel), sharing a single wall-clock timeout budget. If the first request fails, the second and third are still attempted independently.
- The raw TCP path sets `Connection: close` so the server closes the connection after each response, avoiding HTTP keep-alive complexity.
- A 401/403 from `GET /api` is surfaced as `requiresAuth: true` rather than a failure, allowing the client to present a token prompt rather than an error.
- The `Content-Length` header in the raw TCP path is calculated from the UTF-8 byte length of the body, not the string length -- this is correct for multi-byte characters.
- Kernel IDs are UUIDs (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`) and are safe to pass through `encodeURIComponent`.
- Response body size is capped at 512 KB in the raw TCP path to prevent memory exhaustion.
