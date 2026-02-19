# Perforce (Helix Core) -- Power User Reference

**Port:** 1666/TCP | **Source:** `src/worker/perforce.ts`

Port of Call implements four Perforce endpoints for the proprietary Helix Core version control system: probe, login, server info query, changelist listing, and changelist describe. All operations use the binary tagged wire protocol on port 1666 (plain TCP, no TLS support).

**Compatible servers:** Perforce Helix Core Server (p4d) versions 2012.1+. The protocol is proprietary and not publicly documented; this implementation is based on protocol analysis and community research.

---

## Default Ports

| Port | Protocol | Notes |
|------|----------|-------|
| 1666 | Perforce tagged wire (TCP) | Default p4d server port |
| 1667 | Perforce SSL/TLS | Not implemented |

---

## API Endpoints

### `POST /api/perforce/probe` -- Protocol handshake probe

Opens a TCP connection to port 1666 and sends a `protocol` function call to negotiate protocol version and retrieve server capabilities. This is the first step in any Perforce client-server interaction.

**Request:**

| Field     | Type   | Default | Notes                              |
|-----------|--------|---------|------------------------------------|
| `host`    | string | required | Validated: `[a-zA-Z0-9._-]+`      |
| `port`    | number | `1666`  | TCP port                           |
| `timeout` | number | `10000` | ms, applies to TCP connect + read  |

**Success (200):**

```json
{
  "success": true,
  "host": "p4.example.com",
  "port": 1666,
  "tcpLatency": 23,
  "isPerforceServer": true,
  "serverVersion": "P4D/LINUX26X86_64/2023.1/2468153",
  "serverInfo": {
    "server2": "P4D/LINUX26X86_64/2023.1/2468153",
    "xfiles": "3",
    "security": "3",
    "maxcommitsperfile": "10",
    "unicode": "1",
    "case": "0"
  },
  "note": "Perforce Helix Core is a proprietary VCS popular in game development. Full client operations require authentication and a licensed p4 client."
}
```

**Protocol details:**

The probe sends a tagged message with `func=protocol` and the following negotiation parameters:

```
func\0protocol\0
xfiles\03\0
server\02\0
api\099999\0
enableStreams\0\0
enableGraph\0\0
expandAndmaps\0\0
\0\0
```

- `xfiles: 3` — Request extended file metadata
- `server: 2` — Protocol version (server will respond with min of client and server version)
- `api: 99999` — High version number to receive all available server info
- `enableStreams` — Request streams support (Perforce streams feature)
- `enableGraph` — Request graph depot support (Git-like repos in Perforce)
- `expandAndmaps` — Request andmap expansion (advanced file mapping)

**Server detection:** If the server responds with `server2`, `xfiles`, `security`, or `maxcommitsperfile` keys, or if the raw response contains "Perforce" or "p4d", `isPerforceServer: true`.

**Non-Perforce hosts:** Returns `isPerforceServer: false` with `serverInfo: undefined`.

---

### `POST /api/perforce/login` -- Authenticated login

Performs the full login flow: protocol negotiation, login with username/password, and retrieval of server metadata via `user-info`.

**Request:**

| Field      | Type   | Default | Notes                         |
|------------|--------|---------|-------------------------------|
| `host`     | string | required |                              |
| `port`     | number | `1666`  |                              |
| `timeout`  | number | `12000` | ms                           |
| `username` | string | required |                              |
| `password` | string | required | Sent as plaintext tag (no encryption) |
| `client`   | string | --      | Perforce client workspace name |

**Success (200):**

```json
{
  "success": true,
  "host": "p4.example.com",
  "port": 1666,
  "authenticated": true,
  "serverVersion": "P4D/LINUX26X86_64/2023.1/2468153",
  "serverDate": "2024/12/15 10:23:45 -0800 PST",
  "serverRoot": "/opt/perforce/root",
  "serverId": "master",
  "serverAddress": "p4.example.com:1666",
  "rtt": 145
}
```

**Authentication failure (200):**

```json
{
  "success": true,
  "host": "p4.example.com",
  "port": 1666,
  "authenticated": false,
  "rtt": 78
}
```

**Protocol flow:**

1. **Protocol negotiation:** Sends `func=protocol` with xfiles/server/api flags (same as `/probe`)
2. **Login:** Sends `func=login` with `user={username}`, `password={password}`, and optional `client={client}`
3. **Error detection:** Searches response for "invalid password", "password invalid", "access denied", "login failed", or `func=client-Message` with "invalid" in data field
4. **User info (if authenticated):** Sends `func=user-info` with `user={username}` and `tag=` (empty) to retrieve server metadata

**Password handling:** The password is sent as a tagged field in plaintext. Perforce protocol does not encrypt credentials at the wire level unless using SSL/TLS (port 1667, not implemented).

**Ticket-based auth:** Real Perforce clients receive a ticket after successful login and use it for subsequent commands. This implementation does not persist tickets; each request is a fresh login.

---

### `POST /api/perforce/info` -- Server info query

Queries server information without authentication using the `user-info` function. This does not require valid credentials but may return less information than an authenticated query.

**Request:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | required |      |
| `port`    | number | `1666`  |      |
| `timeout` | number | `10000` | ms   |

**Success (200):**

```json
{
  "success": true,
  "host": "p4.example.com",
  "port": 1666,
  "tcpLatency": 18,
  "isPerforceServer": true,
  "serverVersion": "P4D/LINUX26X86_64/2023.1/2468153",
  "serverAddress": "p4.example.com:1666",
  "serverDate": "2024/12/15 10:23:45 -0800 PST",
  "serverLicense": "Perforce Software Inc.",
  "serverRoot": "/opt/perforce/root",
  "caseHandling": "insensitive",
  "rawInfo": { ... }
}
```

**Protocol sequence:**

1. Protocol negotiation (`func=protocol`)
2. 100ms delay (allow server to send any unsolicited messages)
3. Info query (`func=user-info` with `tag=` empty)

**Permissions:** Some servers may restrict `user-info` to authenticated users. If the server returns no data, `isPerforceServer: false` is returned.

---

### `POST /api/perforce/changes` -- List changelists

Authenticates and retrieves a list of changelists (Perforce's equivalent of commits) using `p4 changes`.

**Request:**

| Field      | Type   | Default     | Notes                                    |
|------------|--------|-------------|------------------------------------------|
| `host`     | string | required    |                                          |
| `port`     | number | `1666`      |                                          |
| `timeout`  | number | `15000`     | ms                                       |
| `username` | string | required    |                                          |
| `password` | string | required    |                                          |
| `client`   | string | --          | Filter changelists by client workspace   |
| `max`      | number | `10`        | Capped at 50                             |
| `status`   | string | --          | `submitted`, `pending`, or `shelved`     |

**Success (200):**

```json
{
  "success": true,
  "host": "p4.example.com",
  "port": 1666,
  "username": "alice",
  "changelists": [
    {
      "change": "12345",
      "time": "1702650225",
      "user": "alice",
      "client": "alice-workstation",
      "status": "submitted",
      "desc": "Fix crash in renderer"
    },
    {
      "change": "12344",
      "time": "1702636825",
      "user": "bob",
      "client": "bob-laptop",
      "status": "submitted",
      "desc": "Add new shaders"
    }
  ],
  "count": 2,
  "rtt": 234
}
```

**Protocol flow:**

1. Protocol negotiation (`func=protocol`)
2. Login (`func=login` with username/password)
3. Changes query (`func=changes` with `maxResults={max}`, optional `status={status}` and `client={client}`)

**Response parsing:** The server sends one record per changelist. Records are separated by `func=client-Message` markers. Each record contains `change`, `time` (Unix timestamp), `user`, `client`, `status`, and `desc` (description) fields.

**Max results:** The `max` parameter is clamped to 50 to prevent excessive data transfer. Perforce servers can have millions of changelists.

---

### `POST /api/perforce/describe` -- Describe a changelist

Authenticates and retrieves detailed information about a specific changelist, including the list of affected files (equivalent to `p4 describe -s <change>`).

**Request:**

| Field      | Type   | Default | Notes                         |
|------------|--------|---------|-------------------------------|
| `host`     | string | required |                              |
| `port`     | number | `1666`  |                              |
| `timeout`  | number | `15000` | ms                           |
| `username` | string | required |                              |
| `password` | string | required |                              |
| `client`   | string | --      |                              |
| `change`   | number | required | Changelist number            |

**Success (200):**

```json
{
  "success": true,
  "host": "p4.example.com",
  "port": 1666,
  "change": 12345,
  "description": "Fix crash in renderer when loading high-poly models",
  "user": "alice",
  "client": "alice-workstation",
  "status": "submitted",
  "time": "2024-12-15T18:23:45.000Z",
  "files": [
    {
      "path": "//depot/engine/src/renderer.cpp",
      "action": "edit"
    },
    {
      "path": "//depot/engine/tests/renderer_test.cpp",
      "action": "edit"
    },
    {
      "path": "//depot/docs/CHANGELOG.md",
      "action": "edit"
    }
  ],
  "fileCount": 3,
  "rtt": 189
}
```

**Protocol flow:**

1. Protocol negotiation (`func=protocol`)
2. Login (`func=login` with username/password)
3. Describe query (`func=describe` with `change={change}`, `shortDesc=1`)

**Short describe:** The `shortDesc=1` flag (`-s` in CLI) omits file diffs, returning only file paths and actions (edit, add, delete, integrate, branch, move/add, move/delete).

**File parsing:** The server returns files as indexed fields: `depotFile0`, `depotFile1`, ..., `action0`, `action1`, .... The implementation iterates until no more `depotFile{n}` keys are found.

**Time format:** The `time` field is a Unix timestamp (seconds since epoch) returned as a string. The response converts it to ISO 8601 format.

---

## Perforce Tagged Wire Protocol

### Message Format

All messages are null-terminated key-value pairs, terminated by a double-null:

```
key1\0value1\0key2\0value2\0...\0\0
```

**Parsing:** Split on null bytes, filter empty strings, iterate in pairs. Orphaned keys (odd number of parts) are logged as malformed but do not cause errors.

**Building:** Join key-value pairs with null separators, append double-null terminator.

### Common Functions (func= tag)

| Function     | Direction       | Purpose                                    |
|--------------|-----------------|--------------------------------------------|
| `protocol`   | Client → Server | Negotiate protocol version and capabilities |
| `login`      | Client → Server | Authenticate with username/password         |
| `user-info`  | Client → Server | Query server metadata                       |
| `changes`    | Client → Server | List changelists                            |
| `describe`   | Client → Server | Describe a specific changelist              |

### Protocol Negotiation Tags

| Tag              | Type   | Example | Notes                                      |
|------------------|--------|---------|--------------------------------------------|
| `func`           | string | `protocol` | Function name (required in all messages) |
| `xfiles`         | string | `3`     | Extended file metadata version             |
| `server`         | string | `2`     | Protocol version (server responds with min)|
| `api`            | string | `99999` | API version (high value = request all info)|
| `enableStreams`  | string | `` (empty) | Enable streams feature                  |
| `enableGraph`    | string | `` (empty) | Enable graph depot feature              |
| `expandAndmaps`  | string | `` (empty) | Enable andmap expansion                 |

### Login Tags

| Tag        | Type   | Example    | Notes                                 |
|------------|--------|------------|---------------------------------------|
| `func`     | string | `login`    |                                       |
| `user`     | string | `alice`    | Username                              |
| `password` | string | `secret123`| Plaintext password (no encryption)    |
| `client`   | string | `workstation` | Client workspace name (optional)   |

### Server Response Tags

| Tag                | Type   | Example                          | Notes                              |
|--------------------|--------|----------------------------------|------------------------------------|
| `server2`          | string | `P4D/LINUX26X86_64/2023.1/...`   | Server version string              |
| `xfiles`           | string | `3`                              | Negotiated xfiles version          |
| `security`         | string | `3`                              | Security level (0=none, 3=high)    |
| `maxcommitsperfile`| string | `10`                             | Max commits per file               |
| `unicode`          | string | `1`                              | Unicode mode (0=off, 1=on)         |
| `case`             | string | `0`                              | Case sensitivity (0=insensitive)   |
| `serverDate`       | string | `2024/12/15 10:23:45 -0800 PST`  | Server date/time                   |
| `serverRoot`       | string | `/opt/perforce/root`             | Server root directory              |
| `serverId`         | string | `master`                         | Server ID                          |
| `serverAddress`    | string | `p4.example.com:1666`            | Server address                     |

---

## Known Limitations

**No TLS/SSL support.** The implementation uses plain TCP on port 1666. Encrypted connections (port 1667, SSL/TLS) are not supported. All data, including passwords, is transmitted in plaintext.

**No ticket persistence.** Perforce uses ticket-based authentication after the initial login. This implementation does not persist tickets; each request performs a fresh login with username/password.

**Password sent in plaintext.** The `login` function sends the password as a tagged field without encryption. This is standard for plain TCP Perforce but insecure. Use TLS (port 1667) in production.

**No client workspace sync.** The `/changes` and `/describe` endpoints do not sync files to a local workspace. They only query metadata.

**No diff support.** The `/describe` endpoint uses `shortDesc=1` to omit file diffs. Full diffs (like `p4 describe -d`) are not supported.

**Max results capped at 50.** The `/changes` endpoint caps `maxResults` at 50 regardless of the `max` parameter to prevent excessive data transfer.

**No pagination.** The `/changes` endpoint does not support pagination. To retrieve more than 50 changelists, make multiple requests with different filters (e.g., date range, user).

**No advanced queries.** Complex queries like `p4 changes -m 100 -s submitted -u alice @2024/01/01,@now` are not supported. Only basic filtering by status and client.

**No Unicode validation.** The implementation assumes UTF-8 encoding for all text. Servers in legacy (non-Unicode) mode may return corrupted characters.

**No IPv6 support.** The host regex `[a-zA-Z0-9._-]+` rejects IPv6 addresses (with or without brackets).

**No hostname validation for underscores.** Hostnames with underscores are rejected by the regex, even though they are technically valid (though non-standard).

**Timeout applies to full request.** The `timeout` parameter applies to the entire request (TCP connect + all reads). Long-running operations (e.g., describing a changelist with thousands of files) may timeout.

**No server fingerprint verification.** The implementation does not verify the server's SSL/TLS certificate (N/A for plain TCP, but relevant if TLS support is added).

**Cloudflare Workers restriction.** The Cloudflare Workers environment restricts outbound TCP connections to certain ports and destinations. Some corporate Perforce servers behind firewalls may be unreachable.

**No `p4 sync`, `p4 submit`, `p4 edit` support.** The implementation is read-only (probe, login, info, changes, describe). Workspace operations are not implemented.

**No file content retrieval.** `p4 print` (retrieve file content at a specific revision) is not implemented.

**No branch/stream support.** Queries do not filter by branch, stream, or depot path. All changelists from all depots are returned (subject to permissions).

**Authentication errors return 200.** Login failures return `{ success: true, authenticated: false }` with HTTP 200, not 401. This is a design choice for consistent error handling.

**Malformed messages logged but not rejected.** If the server response has an odd number of null-separated parts (orphaned key), the implementation logs a warning but continues parsing. This may mask protocol errors.

---

## curl Examples

```bash
# Probe a Perforce server
curl -s -X POST https://portofcall.ross.gg/api/perforce/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"p4.example.com"}' \
  | jq '{isPerforceServer, serverVersion}'

# Probe with custom port and timeout
curl -s -X POST https://portofcall.ross.gg/api/perforce/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"p4.example.com","port":1666,"timeout":5000}' \
  | jq .

# Login and retrieve server info
curl -s -X POST https://portofcall.ross.gg/api/perforce/login \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "p4.example.com",
    "username": "alice",
    "password": "secret123"
  }' | jq '{authenticated, serverVersion, serverDate}'

# Login with client workspace
curl -s -X POST https://portofcall.ross.gg/api/perforce/login \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "p4.example.com",
    "username": "alice",
    "password": "secret123",
    "client": "alice-workstation"
  }' | jq .

# Query server info (no auth)
curl -s -X POST https://portofcall.ross.gg/api/perforce/info \
  -H 'Content-Type: application/json' \
  -d '{"host":"p4.example.com"}' \
  | jq '{serverVersion, serverAddress, caseHandling}'

# List recent changelists
curl -s -X POST https://portofcall.ross.gg/api/perforce/changes \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "p4.example.com",
    "username": "alice",
    "password": "secret123",
    "max": 10
  }' | jq '.changelists[] | {change, user, desc}'

# List submitted changelists only
curl -s -X POST https://portofcall.ross.gg/api/perforce/changes \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "p4.example.com",
    "username": "alice",
    "password": "secret123",
    "status": "submitted",
    "max": 20
  }' | jq '.count'

# Filter by client workspace
curl -s -X POST https://portofcall.ross.gg/api/perforce/changes \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "p4.example.com",
    "username": "alice",
    "password": "secret123",
    "client": "alice-workstation",
    "max": 5
  }' | jq .

# Describe a specific changelist
curl -s -X POST https://portofcall.ross.gg/api/perforce/describe \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "p4.example.com",
    "username": "alice",
    "password": "secret123",
    "change": 12345
  }' | jq '{change, user, time, fileCount, files}'

# Describe with file details
curl -s -X POST https://portofcall.ross.gg/api/perforce/describe \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "p4.example.com",
    "username": "alice",
    "password": "secret123",
    "change": 12345
  }' | jq '.files[] | {path, action}'
```

---

## Local Testing

Perforce offers a free server for testing (Helix Core Server, 5 users, 20 workspaces):

```bash
# Download and run Perforce server (Linux)
wget https://www.perforce.com/downloads/perforce/r23.1/bin.linux26x86_64/p4d
chmod +x p4d
./p4d -r /tmp/p4root -p 1666 -d

# Create user (requires p4 CLI)
export P4PORT=localhost:1666
p4 user -f alice
p4 passwd alice  # Set password

# Create client workspace
p4 client alice-workstation

# Submit a changelist
echo "test" > test.txt
p4 add test.txt
p4 submit -d "Initial commit"

# Test with Port of Call
curl -s -X POST https://portofcall.ross.gg/api/perforce/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_PUBLIC_IP","port":1666}' | jq .
```

**Docker (unofficial image):**

```bash
docker run -d -p 1666:1666 --name perforce \
  -e P4USER=super \
  -e P4PASSWD=superpass \
  ambakshi/perforce-server:latest

# Create user
docker exec perforce p4 user -f alice
docker exec perforce bash -c 'echo "secret123" | p4 passwd alice'
```

---

## Resources

- [Perforce Helix Core documentation](https://www.perforce.com/manuals/p4sag/)
- [Perforce command reference (p4 help)](https://www.perforce.com/manuals/cmdref/)
- [Perforce protocol research (unofficial)](https://github.com/perforce/p4python)
- [Perforce server downloads](https://www.perforce.com/downloads/helix-core-p4d)
- [Perforce free tier (5 users, 20 workspaces)](https://www.perforce.com/products/helix-core/free-version-control)
