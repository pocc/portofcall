# Docker Engine API — Port of Call Reference

**Spec:** [Docker Engine API](https://docs.docker.com/engine/api/v1.43/)
**Default ports:** 2375 (HTTP, plaintext), 2376 (HTTPS, TLS)
**Source:** `src/worker/docker.ts`
**Tests:** `tests/docker.test.ts` (14 passing)

---

## Architecture: why two transport paths

The Docker Engine API is REST over HTTP. Port of Call implements two transport paths:

| Port | Transport | Why |
|---|---|---|
| 2375 | Raw TCP → hand-crafted HTTP/1.1 | Cloudflare Workers `fetch()` can't reach non-Cloudflare HTTP on arbitrary ports; `connect()` from `cloudflare:sockets` is used instead |
| 2376 | Native `fetch()` over HTTPS | Workers can `fetch()` any HTTPS URL; standard TLS via the Cloudflare edge |

The TCP path includes its own chunked transfer encoding decoder. The HTTPS path delegates to the Workers runtime.

**No API version prefix is added automatically.** To use versioned paths, include the prefix in `path`: `/v1.43/containers/json`.

---

## Endpoints

### `POST /api/docker/health` — Daemon health check

Sends `GET /_ping`, `GET /version`, and `GET /info` in sequence. All three use the TCP socket path (port 2375 by default).

**Request:**

```json
{
  "host": "docker.internal",
  "port": 2375,
  "timeout": 15000
}
```

| Field | Default | Notes |
|---|---|---|
| `host` | required | Hostname or IP of Docker daemon |
| `port` | `2375` | |
| `timeout` | `15000` | Single wall-clock budget for all three requests combined |

**Response (success):**

```json
{
  "success": true,
  "statusCode": 200,
  "parsed": {
    "ping": "OK",
    "version": {
      "Version": "24.0.5",
      "ApiVersion": "1.43",
      "MinAPIVersion": "1.12",
      "GitCommit": "ced0996",
      "GoVersion": "go1.20.6",
      "Os": "linux",
      "Arch": "amd64",
      "KernelVersion": "5.15.0",
      "BuildTime": "2023-07-24T..."
    },
    "system": {
      "Containers": 12,
      "ContainersRunning": 4,
      "ContainersPaused": 0,
      "ContainersStopped": 8,
      "Images": 31,
      "ServerVersion": "24.0.5",
      "OperatingSystem": "Ubuntu 22.04.3 LTS",
      "OSType": "linux",
      "Architecture": "x86_64",
      "NCPU": 8,
      "MemTotal": 16742854656,
      "Name": "docker-host",
      "KernelVersion": "5.15.0-82-generic",
      "Driver": "overlay2"
    }
  },
  "latencyMs": 42
}
```

`parsed.system` is a trimmed view of `/info` — only the 13 fields listed above are included. The full `/info` payload (often 5–15 KB) is not returned. If `/version` fails, `version` and `system` are both `null`. If `/info` fails after a successful `/version`, only `system` is `null`.

`success` reflects the `/_ping` status code (200). It can be `true` even if `version` or `system` are null.

---

### `POST /api/docker/query` — Arbitrary Docker API request (HTTP/2375)

Sends any HTTP request to the Docker daemon via raw TCP socket.

**Request:**

```json
{
  "host": "docker.internal",
  "port": 2375,
  "method": "GET",
  "path": "/containers/json?all=true",
  "body": null,
  "timeout": 15000
}
```

| Field | Default | Notes |
|---|---|---|
| `host` | required | |
| `port` | `2375` | |
| `method` | `"GET"` | One of: `GET`, `POST`, `PUT`, `DELETE`, `HEAD` (PATCH not supported) |
| `path` | `"/version"` | Auto-prefixed with `/` if missing. Include query string here. |
| `body` | `null` | JSON string. Sets `Content-Type: application/json` when non-null. |
| `timeout` | `15000` | |

**Response:**

```json
{
  "success": true,
  "statusCode": 200,
  "headers": {
    "content-type": "application/json",
    "api-version": "1.43",
    "server": "Docker/24.0.5 (linux)",
    "date": "...",
    "content-length": "1234"
  },
  "body": "[{\"Id\":\"abc123\",...}]",
  "parsed": [{"Id": "abc123", "Names": ["/web"], "Image": "nginx", "State": "running", "Status": "Up 2 hours"}],
  "latencyMs": 18
}
```

`success` is `true` for HTTP 200–399. `parsed` is `JSON.parse(body)` or `null`. `body` is the raw response text; truncated at 512 KB.

**Key limits:**
- Response buffer: **512 KB** max (`sendHttpRequest` reads up to 512,000 bytes total). Large responses (e.g., `/images/json` with many layers) will be silently truncated.
- Chunked transfer encoding is decoded automatically.

---

### `POST /api/docker/tls` — Arbitrary Docker API request (HTTPS/2376)

Identical request shape to `/api/docker/query`. Uses `fetch()` over HTTPS instead of raw TCP. Default port is `2376`.

```json
{
  "host": "docker.example.com",
  "port": 2376,
  "method": "GET",
  "path": "/containers/json",
  "timeout": 15000
}
```

The TLS certificate is validated by the Cloudflare Workers runtime. There is no mTLS client certificate support — this is connectivity testing only, not a full Docker client.

---

### `POST /api/docker/container/create` — Create a container

**Request:**

```json
{
  "host": "docker.internal",
  "port": 2375,
  "image": "nginx:latest",
  "name": "my-nginx",
  "cmd": ["nginx", "-g", "daemon off;"],
  "env": ["NGINX_HOST=example.com", "NGINX_PORT=80"],
  "https": false,
  "timeout": 15000
}
```

| Field | Default | Notes |
|---|---|---|
| `image` | required | Docker image name:tag |
| `name` | (Docker-generated) | Container name |
| `cmd` | (image default) | Override entrypoint command, as array |
| `env` | `[]` | Environment variables as `KEY=VALUE` strings |
| `https` | `false` | If `true`, uses port 2376 and HTTPS |

Port defaults: 2375 if `https: false`, 2376 if `https: true`, unless `port` is set explicitly.

**Response (success):**

```json
{
  "success": true,
  "statusCode": 201,
  "containerId": "a1b2c3d4e5f6...",
  "body": "{\"Id\":\"a1b2c3d4...\",\"Warnings\":[]}",
  "parsed": {"Id": "a1b2c3d4...", "Warnings": []},
  "latencyMs": 120
}
```

HTTP 201 = created. `containerId` is extracted from `parsed.Id`. `Warnings` is typically empty but may contain non-fatal notes about the image or configuration.

---

### `POST /api/docker/container/start` — Start a container

**Request:**

```json
{
  "host": "docker.internal",
  "containerId": "a1b2c3d4e5f6",
  "https": false,
  "timeout": 15000
}
```

**Response:**

```json
{
  "success": true,
  "statusCode": 204,
  "started": true,
  "alreadyRunning": false,
  "body": null,
  "latencyMs": 45
}
```

**Status code semantics:**

| HTTP status | Meaning | `success` | `started` | `alreadyRunning` |
|---|---|---|---|---|
| 204 | Container started | `true` | `true` | `false` |
| 304 | Already running (not modified) | `true` | `false` | `true` |
| 404 | Container not found | `false` | — | — |
| 409 | Conflict (e.g., starting a paused container) | `false` | — | — |
| 500 | Daemon error | `false` | — | — |

Both 204 and 304 set `success: true`. 404, 409, and 500 set `success: false`.

---

### `POST /api/docker/container/logs` — Fetch container logs

**Request:**

```json
{
  "host": "docker.internal",
  "containerId": "a1b2c3d4e5f6",
  "tail": 100,
  "https": false,
  "timeout": 15000
}
```

| Field | Default | Notes |
|---|---|---|
| `tail` | `100` | Number of lines from the end. Pass `0` for all logs (may be very large). |

**Response:**

```json
{
  "success": true,
  "statusCode": 200,
  "containerId": "a1b2c3d4e5f6",
  "tail": 100,
  "stdout": ["Starting nginx...", "nginx: ready"],
  "stderr": ["Warning: ..."],
  "combined": ["[stdout] Starting nginx...", "[stdout] nginx: ready", "[stderr] Warning: ..."],
  "lineCount": 3,
  "latencyMs": 38
}
```

**Docker log multiplexing format**

When a container does not use a TTY (`-t` flag), Docker frames log output in a binary multiplexing format:

```
Offset  Bytes  Field
0       1      Stream type: 1=stdout, 2=stderr, 0=stdin (rare)
1–3     3      Padding zeros
4–7     4      Payload size (big-endian uint32)
8+      N      Payload bytes (one log line, possibly with newline)
```

The implementation reads raw bytes, finds the HTTP header boundary, strips HTTP framing (including chunked TE), then walks the binary payload 8 bytes at a time.

Any `streamType` other than 1 or 2 is appended to `combined` without a `[stdout]`/`[stderr]` prefix.

**TTY containers** (`docker run -t ...`) do not use this framing — their logs are raw text. In that case the binary parser will produce garbled output or an empty result. Use the `/api/docker/query` endpoint with `path: "/containers/{id}/logs?stdout=true&stderr=true&tail=100"` to get the raw text.

**TCP path buffer limit:** 1 MB (1,048,576 bytes). The HTTPS path has no explicit limit (bounded by Workers memory).

---

### `POST /api/docker/exec` — Execute a command in a running container

Two-step operation: create exec instance, then start it and collect output.

**Request:**

```json
{
  "host": "docker.internal",
  "containerId": "a1b2c3d4e5f6",
  "cmd": ["sh", "-c", "cat /etc/hostname && whoami"],
  "https": false,
  "timeout": 30000
}
```

| Field | Default | Notes |
|---|---|---|
| `cmd` | required | Array of strings. This is **not** a shell string — for shell features use `["sh", "-c", "..."]`. |
| `timeout` | `30000` | Applies to the total of both steps combined. |

**Response:**

```json
{
  "success": true,
  "statusCode": 200,
  "execId": "x9y8z7...",
  "containerId": "a1b2c3d4e5f6",
  "cmd": ["sh", "-c", "cat /etc/hostname && whoami"],
  "stdout": ["a1b2c3d4e5f6", "root"],
  "stderr": [],
  "combined": ["[stdout] a1b2c3d4e5f6", "[stdout] root"],
  "latencyMs": 215
}
```

**Exec two-step protocol:**

```
Step 1: POST /containers/{id}/exec
  Body: { AttachStdout: true, AttachStderr: true, Cmd: [...] }
  Expect: HTTP 201 → { Id: "<execId>" }

Step 2: POST /exec/{execId}/start
  Body: { Detach: false, Tty: false }
  Expect: HTTP 200 (with multiplexed output body) or 204 (no output)
```

If step 1 returns anything other than 201, the endpoint returns immediately with `success: false` and the error body.

Output from step 2 is parsed with the same Docker log multiplexing parser used for container logs (`Tty: false` ensures framing is present). `success` is `true` for HTTP 200 or 204.

**Limitations:**
- No stdin — exec is one-shot, output only
- No exit code — Docker's `exec/inspect` endpoint would be needed for that, not implemented
- TCP path buffer: 512 KB (uses `sendHttpRequest`)
- Container must be running; exec on a stopped container returns 409

---

## Common Docker API paths

Use these with `/api/docker/query` or `/api/docker/tls`:

| Path | Method | Notes |
|---|---|---|
| `/_ping` | GET | Health check; returns `"OK"` |
| `/version` | GET | Engine version, API version, OS, architecture |
| `/info` | GET | Full system info (~5–15 KB) |
| `/containers/json` | GET | Running containers |
| `/containers/json?all=true` | GET | All containers including stopped |
| `/containers/{id}/json` | GET | Full container inspect |
| `/containers/{id}/stop` | POST | Stop container (sends SIGTERM, then SIGKILL after 10 s) |
| `/containers/{id}/kill` | POST | Immediate SIGKILL |
| `/containers/{id}/pause` | POST | Pause container (SIGSTOP cgroup freeze) |
| `/containers/{id}/unpause` | POST | Unpause |
| `/containers/{id}/restart` | POST | Restart |
| `/containers/{id}/stats?stream=false` | GET | CPU/mem/network stats snapshot |
| `/containers/{id}/top` | GET | Running processes (ps) |
| `/images/json` | GET | All images |
| `/images/{id}/json` | GET | Image inspect |
| `/networks` | GET | List networks |
| `/volumes` | GET | List volumes |
| `/events?since=0&until=now` | GET | Event stream snapshot |
| `/v1.43/containers/json` | GET | Versioned path (explicit API version) |

---

## Quick reference — curl

```bash
BASE=https://portofcall.ross.gg

# Health check
curl -s -X POST $BASE/api/docker/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker.internal"}' | jq '.parsed.system | {Containers,ContainersRunning,ServerVersion}'

# List all containers (including stopped)
curl -s -X POST $BASE/api/docker/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker.internal","path":"/containers/json?all=true"}' | jq '.parsed[] | {Id:.Id[:12],Names,State,Image}'

# Inspect a specific container
curl -s -X POST $BASE/api/docker/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker.internal","path":"/containers/my-nginx/json"}' | jq '.parsed | {State:.State.Status,Pid:.State.Pid,Started:.State.StartedAt}'

# Get stats snapshot
curl -s -X POST $BASE/api/docker/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker.internal","path":"/containers/my-nginx/stats?stream=false"}' | jq '.parsed | {memory_mb:(.memory_stats.usage/1048576|round),cpu_percent:0}'

# Create container
curl -s -X POST $BASE/api/docker/container/create \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker.internal","image":"alpine:latest","name":"test","cmd":["sleep","3600"]}' | jq '.containerId'

# Start container
curl -s -X POST $BASE/api/docker/container/start \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker.internal","containerId":"<id>"}' | jq '{success,started,alreadyRunning}'

# Fetch last 50 log lines
curl -s -X POST $BASE/api/docker/container/logs \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker.internal","containerId":"<id>","tail":50}' | jq '.combined[]'

# Exec command
curl -s -X POST $BASE/api/docker/exec \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker.internal","containerId":"<id>","cmd":["df","-h"]}' | jq '.stdout[]'

# Stop a container
curl -s -X POST $BASE/api/docker/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker.internal","method":"POST","path":"/containers/my-nginx/stop"}' | jq '.statusCode'

# Via HTTPS/2376
curl -s -X POST $BASE/api/docker/tls \
  -H 'Content-Type: application/json' \
  -d '{"host":"docker.example.com","port":2376,"path":"/containers/json?all=true"}' | jq '.parsed[].Names'
```

---

## Local setup for testing

```bash
# Expose Docker daemon on TCP 2375 (INSECURE — local only)
# Option 1: Override systemd unit
sudo mkdir -p /etc/systemd/system/docker.service.d
cat | sudo tee /etc/systemd/system/docker.service.d/override.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:2375
EOF
sudo systemctl daemon-reload && sudo systemctl restart docker

# Option 2: One-shot for testing (kill with Ctrl-C)
sudo dockerd -H tcp://0.0.0.0:2375

# Verify
curl -s http://localhost:2375/version | jq .ApiVersion
```

---

## Implementation notes

### Response size limits

| Endpoint | Path | Max read |
|---|---|---|
| `/api/docker/health` | TCP | 512 KB per request (3 requests) |
| `/api/docker/query` | TCP | 512 KB |
| `/api/docker/tls` | HTTPS fetch | Workers runtime limit |
| `/api/docker/container/logs` (TCP) | TCP | 1 MB |
| `/api/docker/container/logs` (HTTPS) | HTTPS fetch | Workers runtime limit |
| `/api/docker/exec` (TCP step 2) | TCP | 512 KB |

Large responses are silently truncated. `/images/json` with many pulled images commonly exceeds 512 KB — use `GET /images/json?filters={"reference":["nginx*"]}` to narrow the result.

### Chunked transfer encoding

Docker commonly uses chunked TE for list responses. The TCP path decodes chunks via `decodeChunked` (text mode) or `decodeChunkedBytes` (binary mode for logs/exec). Chunk extension fields (`;name=value` after the chunk size) are tolerated — the `parseInt(..., 16)` parse strips them.

### HTTP method restriction

`/api/docker/query` and `/api/docker/tls` allow GET, POST, PUT, DELETE, HEAD only. PATCH is not supported. Many Docker API operations that look like "partial updates" (e.g., network connect) use POST, not PATCH.

### `https` flag on container operations

`create`, `start`, `logs`, `exec` all accept an `https: boolean` field. When true, the request uses `fetch()` over HTTPS. When the TLS certificate is self-signed (common in local Docker TLS setups), the Workers runtime will reject the connection — there is no `insecureSkipVerify` option.

### Security

Docker's HTTP API grants **unrestricted daemon access** — any caller can create containers, mount host paths, and run arbitrary code. Port 2375 should never be exposed on a public interface. Use Cloudflare Access or mTLS (port 2376) to gate access.

---

## What is NOT implemented

- **API version prefix** — not auto-added; include `/v1.43/` in `path` if needed
- **Docker log timestamps** — `timestamps=true` query param works via `/api/docker/query`, but the logs parser does not strip the timestamp prefix from `stdout`/`stderr` lines
- **TTY container logs** — binary log framing is absent for TTY containers; use `/api/docker/query` for raw text
- **Exec exit code** — requires `GET /exec/{id}/json` after the start step; not implemented
- **Streaming** — logs and events endpoints support `?stream=true` but the response reader reads to completion; real-time streaming requires WebSocket
- **mTLS client certificates** — `/api/docker/tls` connects with no client cert; mutual TLS auth is not supported
- **Image operations** — pull, tag, push, remove are not implemented as dedicated endpoints (use `/api/docker/query`)
- **Volume/network CRUD** — query endpoint only
