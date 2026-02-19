# Rsync Daemon Protocol — Power-User Reference

**Port:** 873 (rsync daemon)
**Source:** `src/worker/rsync.ts`
**Routes:** `src/worker/index.ts` (3 endpoints)
**Spec:** Rsync daemon protocol (text handshake phase only)

This implementation covers the rsync daemon's text-based handshake layer: version negotiation, module listing, module probing, and MD4 challenge-response authentication. It does **not** implement the binary delta-transfer protocol (file list exchange, rolling checksums, block transfer). Think of it as `rsync rsync://host/` and `rsync rsync://user@host/module/` — the parts that happen before any file data flows.

---

## Endpoints

### 1. `POST /api/rsync/connect`

Version exchange + module listing. rsync CLI equivalent: `rsync rsync://host/`

**Request:**
```json
{ "host": "mirror.example.com", "port": 873, "timeout": 10000 }
```

| Field | Type | Default | Required | Notes |
|-------|------|---------|----------|-------|
| `host` | string | — | yes | Hostname or IP |
| `port` | number | 873 | no | Validated 1–65535 |
| `timeout` | number | 10000 | no | ms; module read capped at min(timeout, 5000) |

**Response (200):**
```json
{
  "success": true,
  "host": "mirror.example.com",
  "port": 873,
  "rtt": 245,
  "connectTime": 82,
  "serverVersion": "31.0",
  "clientVersion": "30.0",
  "greeting": "@RSYNCD: 31.0",
  "motd": "Welcome to the public mirror",
  "modules": [
    { "name": "pub", "description": "Public files" },
    { "name": "iso", "description": "ISO images" }
  ],
  "moduleCount": 2
}
```

**Wire exchange:**
```
Server → Client: @RSYNCD: 31.0\n
Client → Server: @RSYNCD: 30.0\n
Client → Server: \n                          (empty = list modules)
Server → Client: pub\tPublic files\n
Server → Client: iso\tISO images\n
Server → Client: @RSYNCD: EXIT\n
```

**Cloudflare detection:** Yes (returns 403 with `isCloudflare: true`).

**Conditional response fields** — these are omitted (not `null`) when empty:
- `motd` — only present when at least one non-module, non-directive line appears before the first module entry
- `modules[].description` — always present (empty string if no tab-separated description)

**curl:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/rsync/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"rsync.example.com"}' | jq .
```

---

### 2. `POST /api/rsync/module`

Probe a specific module — determines whether it exists, requires auth, or returns an error. rsync CLI equivalent: `rsync rsync://host/module/` (the first exchange before any file listing).

**Request:**
```json
{ "host": "mirror.example.com", "port": 873, "module": "pub", "timeout": 10000 }
```

| Field | Type | Default | Required | Notes |
|-------|------|---------|----------|-------|
| `host` | string | — | yes | |
| `port` | number | 873 | no | Validated 1–65535 |
| `module` | string | — | yes | Module name to probe |
| `timeout` | number | 10000 | no | Module read capped at min(timeout, 5000) |

**Response (200):**
```json
{
  "success": true,
  "host": "mirror.example.com",
  "port": 873,
  "module": "pub",
  "rtt": 190,
  "serverVersion": "31.0",
  "moduleOk": true,
  "authRequired": false,
  "response": "Welcome to the pub mirror"
}
```

When the module requires auth:
```json
{
  "success": true,
  "moduleOk": false,
  "authRequired": true
}
```

**Wire exchange:**
```
Server → Client: @RSYNCD: 31.0\n
Client → Server: @RSYNCD: 30.0\n
Client → Server: pub\n
Server → Client: @RSYNCD: OK\n             (or @RSYNCD: AUTHREQD <challenge>)
```

**Conditional response fields** — omitted when empty:
- `error` — only present when `@ERROR` received
- `response` — only present when non-directive text lines exist

**Cloudflare detection:** No (unlike `/connect`, this endpoint skips the CF check).

**curl:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/rsync/module \
  -H 'Content-Type: application/json' \
  -d '{"host":"rsync.example.com","module":"pub"}' | jq .
```

---

### 3. `POST /api/rsync/auth`

Authenticate to a module using MD4 challenge-response. rsync CLI equivalent: `rsync rsync://user@host/module/` when the module has `auth users` set.

**Request:**
```json
{
  "host": "backup.example.com",
  "port": 873,
  "module": "backup",
  "username": "backupuser",
  "password": "s3cret",
  "timeout": 10000
}
```

| Field | Type | Default | Required | Notes |
|-------|------|---------|----------|-------|
| `host` | string | — | yes | |
| `port` | number | 873 | no | **Not validated** (see quirks) |
| `module` | string | — | yes | |
| `username` | string | — | yes | |
| `password` | string | — | yes | |
| `timeout` | number | 10000 | no | Single shared timeout for entire flow |

**Response (200):**
```json
{
  "success": true,
  "host": "backup.example.com",
  "port": 873,
  "module": "backup",
  "username": "backupuser",
  "serverVersion": "31.0",
  "authenticated": true,
  "authRequired": true,
  "challenge": "f8a2b9c1d4e5f6a7",
  "motd": "Authorized access only",
  "rtt": 310
}
```

`success` equals `authenticated` — if auth fails, `success: false`.

**Wire exchange:**
```
Server → Client: @RSYNCD: 31.0\n
Client → Server: @RSYNCD: 30.0\n
Client → Server: backup\n
Server → Client: Welcome MOTD line\n
Server → Client: @RSYNCD: AUTHREQD f8a2b9c1d4e5f6a7\n
Client → Server: backupuser 0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d\n
Server → Client: @RSYNCD: OK\n
```

**Conditional response fields** — omitted when empty:
- `challenge` — only present when `AUTHREQD` received (omitted for modules with no auth)
- `motd` — only present when non-directive text lines exist before a decisive directive
- `error` — only present on auth failure or `@ERROR`

**Cloudflare detection:** No.

**curl:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/rsync/auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"backup.example.com","module":"backup","username":"user","password":"pass"}' | jq .
```

---

## Cross-Endpoint Comparison

| Aspect | `/connect` | `/module` | `/auth` |
|--------|-----------|----------|--------|
| Purpose | List modules | Probe single module | Authenticate |
| CF detection | Yes | **No** | **No** |
| Port validation | 1–65535 | 1–65535 | **None** |
| Host validation | `!host` (falsy) | `!host` (falsy) | `!host` (falsy) |
| Module required | No (sends `\n`) | Yes | Yes |
| Greeting read | Single `reader.read()` | Single `reader.read()` | Line-buffered `readLine()` |
| Module-read timeout | min(timeout, 5000ms) | min(timeout, 5000ms) | Full timeout |
| HTTP status on error | 500 | 500 | 500 |
| `success` meaning | Connection worked | Always `true` | `authenticated` |

---

## MD4 Authentication

The rsync daemon uses MD4-based challenge-response auth (not Web Crypto compatible, so a pure-TypeScript MD4 implementation is included in `rsync.ts`).

**Algorithm:**
```
token = MD4("\0" + password + challenge)
```

The `\0` (null byte) is prepended to the password before the challenge is appended. The result is a 16-byte MD4 digest, sent as 32-character lowercase hex.

**Wire format:** `username hexhash\n` (space-separated, newline-terminated).

This matches the rsync daemon protocol: the server sends `@RSYNCD: AUTHREQD <challenge>` and the client responds with the username and hash on one line.

---

## Quirks and Known Limitations

1. **`/module` always returns `success: true`** — Even when the module returns `@ERROR` or `@RSYNCD: EXIT`, the HTTP response is 200 with `success: true`. The `moduleOk` field is `false` and the error text is in `error`, but `success` doesn't reflect failure. Contrast with `/auth` where `success` equals `authenticated`.

2. **Single-read greeting in `/connect` and `/module`** — Both endpoints read the server banner with a single `reader.read()` call. If the greeting is split across multiple TCP segments (unlikely but possible), only the first segment is parsed. `/auth` uses a proper line-buffered reader that handles segment splitting correctly.

3. **No port validation in `/auth`** — `/connect` and `/module` both validate port is 1–65535. `/auth` does not validate port at all — any value (including negative, 0, or >65535) is passed directly to `connect()`.

4. **Client version hardcoded to `30.0`** — All three endpoints send `@RSYNCD: 30.0` regardless of what the server advertises. The server may support newer features at higher protocol versions. The client version is not configurable via the API.

5. **MOTD classification in `/connect`** — Lines without tabs that appear *before* the first module entry are classified as MOTD. Lines without tabs *after* modules are silently ignored (the `modules.length === 0` guard prevents them from being appended to `motd`).

6. **No method check, but POST required in practice** — The route matching in `index.ts` does not filter by HTTP method. However, all three handlers call `request.json()` immediately, which throws on bodyless methods (GET, HEAD, DELETE without body). The error is caught and returned as `{ success: false, error: "..." }` with HTTP 500. Use POST.

7. **Module-read timeout capped at 5 seconds** — `/connect` and `/module` use `Math.min(timeout, 5000)` for `readAllLines()`. Even if you pass `timeout: 30000`, module listing only waits 5 seconds for data. `/auth` uses the full timeout value.

8. **64 KB module-list cap** — `readAllLines()` stops at 64 KB of total data. Servers with very large module lists may be truncated.

9. **No host regex validation** — Unlike many other Port of Call workers, rsync accepts any string as `host` (no pattern validation). Only falsy values are rejected.

10. **`/module` response lines are unlabeled** — Text lines from the server before a directive (`@RSYNCD:` or `@ERROR`) are collected in `response` as a joined string, but aren't distinguished as MOTD vs other output.

11. **No delta transfer** — The implementation covers only the daemon handshake protocol. File listing (`--list-only`), file transfer (rolling checksums, block matching), and file metadata operations are not implemented.

12. **Auth challenge format** — The challenge is extracted by splitting on spaces: `@RSYNCD: AUTHREQD <challenge>`. If a challenge contains spaces, the full challenge (including spaces) is preserved via `parts.slice(2).join(' ')`.

---

## Server Directives Reference

| Directive | Meaning | Where Handled |
|-----------|---------|---------------|
| `@RSYNCD: <version>` | Protocol version announcement | All 3 endpoints |
| `@RSYNCD: OK` | Module ready / auth success | All 3 endpoints |
| `@RSYNCD: AUTHREQD <challenge>` | Auth required, challenge follows | `/module`, `/auth` |
| `@RSYNCD: EXIT` | Server closing connection | All 3 endpoints |
| `@ERROR` or `@ERROR: <msg>` | Server-side error | `/connect`, `/module`, `/auth` |

---

## Failure Modes

| Scenario | HTTP Status | `success` | Error field |
|----------|-------------|-----------|-------------|
| Missing `host` | 400 | `false` | `"Host is required"` |
| Invalid port (0, >65535) | 400 | `false` | `"Port must be between 1 and 65535"` (not `/auth`) |
| Missing `module` (for `/module`, `/auth`) | 400 | `false` | `"Module name is required"` |
| Missing `username`/`password` (`/auth`) | 400 | `false` | `"username and password are required"` |
| Cloudflare-protected host (`/connect` only) | 403 | `false` | Cloudflare error message + `isCloudflare: true` |
| TCP connection refused | 500 | `false` | `"Connection failed"` or socket error |
| Connection timeout | 500 | `false` | `"Connection timeout"` |
| Non-rsync server greeting | 500 | `false` | `"Unexpected server greeting: ..."` (truncated at 100 chars) |
| Module `@ERROR` via `/module` | 200 | **`true`** | Error text in `error` field |
| Auth rejected via `/auth` | 200 | `false` | `"Authentication rejected by server"` |
| No JSON body (GET request) | 500 | `false` | JSON parse error |

---

## Local Testing

```bash
# Docker: rsyncd with anonymous module
docker run --rm -d -p 873:873 \
  -v /tmp/rsync-test:/data \
  --name rsyncd \
  vimagick/rsyncd

# Or manual rsyncd.conf:
cat > /tmp/rsyncd.conf << 'EOF'
[pub]
path = /tmp/rsync-test
comment = Public test module
read only = yes
list = yes

[private]
path = /tmp/rsync-private
comment = Auth-required module
auth users = testuser
secrets file = /tmp/rsyncd.secrets
read only = yes
list = yes
EOF

echo "testuser:testpass" > /tmp/rsyncd.secrets
chmod 600 /tmp/rsyncd.secrets
rsync --daemon --config=/tmp/rsyncd.conf --no-detach

# Verify with CLI:
rsync rsync://localhost/         # list modules
rsync rsync://localhost/pub/     # browse module
rsync rsync://testuser@localhost/private/  # auth prompt
```
