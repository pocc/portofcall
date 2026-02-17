# RSH — Power User Reference

**Port:** 514/tcp
**RFC:** 1282
**Tests:** 6/6 ✅ Deployed
**Source:** `src/worker/rsh.ts`

Four endpoints share `/api/rsh/execute` (HTTP + WebSocket at one URL), `/api/rsh/probe`, and `/api/rsh/trust-scan`. Every connection opens a fresh TCP socket; there are no sessions.

---

## Protocol Wire Format

```
Client → Server: \0                     # stderrPort=0 (Workers can't receive; always \0)
Client → Server: localUser\0            # client-side username
Client → Server: remoteUser\0           # server-side username to run as
Client → Server: command\0              # shell command (or \0 for empty)
Server → Client: \0                     # accepted
  — or —
Server → Client: error text             # rejected (first byte ≠ \0)
Server → Client: command stdout...      # streams until connection closes
```

Stderr can be redirected to a separate port; Workers cannot listen for incoming connections, so the stderr port is always 0 (first byte sent is `\0`).

---

## Endpoints

### `GET|POST|WebSocket /api/rsh/execute` — Execute command

The same URL handles three modes: HTTP GET, HTTP POST, and WebSocket upgrade.

**HTTP request fields:**

| Field | Default | Notes |
|---|---|---|
| `host` | — | ✅ Required |
| `port` | `514` | |
| `localUser` | `'guest'` | Client-side username (appears in `.rhosts` check) |
| `remoteUser` | `'guest'` | Server-side username to run as |
| `command` | `'id'` | Shell command sent to the server |
| `timeout` | `10000` | Wall-clock timeout in ms |

GET: all fields as query params. POST: JSON body.

**HTTP success response:**

```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 514,
  "protocol": "RSH",
  "rtt": 12,
  "serverAccepted": true,
  "localUser": "root",
  "remoteUser": "root",
  "command": "id",
  "output": "uid=0(root) gid=0(root) groups=0(root)",
  "privilegedPortRejection": false,
  "note": "RSH (port 514) uses .rhosts trust for authentication — no password is sent...",
  "security": "NONE — RSH relies on .rhosts trust with no encryption. Use SSH instead."
}
```

**Rejection response (privileged port):**

```json
{
  "success": true,
  "serverAccepted": false,
  "serverMessage": "permission denied",
  "privilegedPortRejection": true,
  "note": "RSH server rejected the connection because it originated from an unprivileged port (> 1023). This is expected — Cloudflare Workers cannot bind privileged source ports. The server is active and running RSH."
}
```

**Key response fields:**

| Field | Notes |
|---|---|
| `serverAccepted` | `true` if the server's first byte was `\0` |
| `output` | Command stdout (up to 10 read chunks over 2 s); absent if not accepted |
| `serverMessage` | Full error text when rejected; absent on acceptance |
| `privilegedPortRejection` | Detected by keywords: `permission`, `privileged`, `reserved`, `not superuser` |
| `rtt` | ms from `connect()` to receipt of server's first response byte |

**Output collection:** After the first `\0` acceptance byte, the worker reads up to 10 chunks within a 2-second window. Commands that produce no output or exit immediately may appear in `output` as an empty string (omitted from the response if empty after trimming).

---

### WebSocket `/api/rsh/execute` — Streaming tunnel

Upgrade the same `/api/rsh/execute` URL to WebSocket for live bidirectional I/O.

**Connection (query params):**

| Param | Default | Notes |
|---|---|---|
| `host` | — | Required |
| `port` | `514` | |
| `localUser` | `'guest'` | |
| `remoteUser` | `'guest'` | |
| `command` | `'id'` | Shell command |

```javascript
const ws = new WebSocket(
  'wss://portofcall.ross.gg/api/rsh/execute?host=192.168.1.10&localUser=root&remoteUser=root&command=bash'
);

// Receive command output (raw bytes)
ws.onmessage = (e) => process.stdout.write(e.data);

// Send stdin to the running command
ws.send('ls -la\n');

// Server closes when the TCP connection ends
ws.onclose = () => console.log('RSH session ended');
```

**Data flow:**
- **TCP → WebSocket:** Command stdout is forwarded as binary `Uint8Array` chunks. The RSH handshake is performed before the first message arrives — the first WebSocket message is the first byte of command output (or the `\0` acceptance byte if it arrives with output in the same chunk).
- **WebSocket → TCP:** Client messages are forwarded to the command's stdin. Both string and ArrayBuffer types are accepted.
- The worker closes the WebSocket when the TCP connection closes (command exits or server disconnects).

> **Note:** The RSH handshake happens before the WebSocket pipes start. The `\0` acceptance byte from the server is included in the first WebSocket message. If the server rejects (sends error text instead of `\0`), that error text is the first WebSocket message and the server closes the connection immediately after.

---

### `GET|POST /api/rsh/probe` — Lightweight port probe

Sends an empty command (`\0`) and reads exactly one chunk of the server's response. Does not collect command output. Useful for quickly checking if RSH is running on a host without triggering a real command.

**Request fields:**

| Field | Default | Notes |
|---|---|---|
| `host` | — | ✅ Required |
| `port` | `514` | |
| `localUser` | `'probe'` | Sent in the handshake; different default than `/execute` |
| `remoteUser` | `'probe'` | |
| `timeout` | `8000` | |

GET: query params. POST: JSON body.

**Success (port open):**

```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 514,
  "portOpen": true,
  "accepted": false,
  "serverByte": 112,
  "serverText": "permission denied",
  "privilegedPortRejection": true,
  "latencyMs": 8,
  "note": "RSH server rejected the unprivileged source port (>1023). This is expected in Workers. The server is running RSH.",
  "security": "RSH relies on .rhosts trust with no encryption. Use SSH instead."
}
```

**Failure (port closed):**

```json
{
  "success": false,
  "host": "192.168.1.10",
  "port": 514,
  "portOpen": false,
  "latencyMs": 3001,
  "error": "Connection timeout"
}
```

**Key fields:**

| Field | Notes |
|---|---|
| `portOpen` | `true` if `socket.opened` resolved; `false` if it threw |
| `accepted` | `true` if server's first byte was `\0` (null byte) |
| `serverByte` | The numeric value of the first byte (0 = accepted, anything else = rejection) |
| `serverText` | The full text response with null bytes stripped; absent if no response |
| `privilegedPortRejection` | Detected via `/permission denied|privileged port|reserved port|not superuser/i` |
| `latencyMs` | Wall-clock ms from `connect()` to result |

> **`/probe` vs `/execute`:** `/probe` sends an empty command (`\0`), reads one chunk, and returns immediately. `/execute` sends a real command and collects output over 2 s. Use `/probe` for host discovery; use `/execute` when you want actual output.

---

### `POST /api/rsh/trust-scan` — .rhosts trust discovery

Tests multiple `localUser→remoteUser` combinations concurrently to discover which `.rhosts` trust relationships exist on the server. Each pair gets its own fresh TCP connection, all fired in parallel via `Promise.all`.

**Request:**

```json
{
  "host": "192.168.1.10",
  "port": 514,
  "localUsers": ["root", "bin", "daemon", "guest", "nobody", "anonymous"],
  "remoteUsers": ["root", "bin"],
  "command": "id",
  "maxPairs": 25,
  "timeout": 20000
}
```

| Field | Default | Notes |
|---|---|---|
| `host` | — | ✅ Required |
| `port` | `514` | |
| `localUsers` | `["root","bin","daemon","guest","nobody","anonymous"]` | Client-side usernames to test |
| `remoteUsers` | same as `localUsers` | Server-side usernames to test; defaults to `localUsers` if omitted |
| `command` | `'id'` | Command to run when a pair is accepted |
| `maxPairs` | `25` | Cap on total combinations (pairs built by nested iteration, capped here) |
| `timeout` | `20000` | Overall timeout across all concurrent probes |

**Pair generation:** Nested loops: for each `localUser`, for each `remoteUser`, push pair. Stops at `maxPairs`. So with 6 local × 2 remote, you get 12 pairs; with 6 × 6, you get 25 (capped).

**Success response:**

```json
{
  "success": true,
  "host": "192.168.1.10",
  "port": 514,
  "command": "id",
  "pairsTestedCount": 12,
  "results": [
    {
      "localUser": "root",
      "remoteUser": "root",
      "command": "id",
      "accepted": true,
      "output": "uid=0(root) gid=0(root) groups=0(root)",
      "privilegedPortRejection": false,
      "rttMs": 11
    },
    {
      "localUser": "root",
      "remoteUser": "bin",
      "command": "id",
      "accepted": false,
      "error": "permission denied",
      "privilegedPortRejection": true,
      "rttMs": 9
    }
  ],
  "summary": {
    "total": 12,
    "accepted": 1,
    "rejected": 11,
    "privilegedPortRejections": 11,
    "trustedPairs": ["root→root"]
  },
  "note": "SECURITY: 1 trusted pair(s) confirmed. Server has .rhosts entries for this host.",
  "latencyMs": 45
}
```

**`summary.trustedPairs`** is a string array of `"localUser→remoteUser"` for every accepted pair — the fastest way to see which trust relationships exist.

**Note strings:**
- If `accepted > 0`: warns that trusted pairs were found
- If all rejected due to privileged port: explains the Workers limitation and confirms RSH is running
- Otherwise: no trust found or RSH not listening

> **Concurrent execution:** All pairs are tested simultaneously. On servers that are reachable but require privileged ports, all probes will return quickly (server immediately responds with rejection). On open/trusted servers, accepted pairs return after 1-2 RTTs plus the 1.5 s output-collection window.

---

## Wire Exchange Examples

### Server accepts (trusted host in `.rhosts`)

```
→ (TCP connect to :514)
→ \0                             # stderr port = 0
→ root\0                         # localUser
→ root\0                         # remoteUser
→ id\0                           # command
← \0                             # server accepted
← uid=0(root) gid=0(root)...\n  # stdout
← (connection close)
```

### Server rejects (unprivileged source port)

```
→ (TCP connect from port > 1023)
→ \0 root\0 root\0 id\0
← permission denied\0
← (connection close)
```

Cloudflare Workers connect from ports > 1023. Most RSH servers that check source port will reject with a message containing `permission`, `privileged`, `reserved`, or `not superuser`. This is correctly identified as `privilegedPortRejection: true` and still confirms RSH is running.

### No stderr channel

The worker always sends `\0` as the first byte (stderrPort=0). RSH normally allows a second port for stderr, but Workers cannot receive inbound connections, so stderr is always merged with stdout or discarded by the server.

---

## curl Examples

```bash
# Quick probe — is RSH running?
curl -s -X POST https://portofcall.ross.gg/api/rsh/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10"}' | jq '{portOpen,accepted,privilegedPortRejection,serverText}'

# Execute a command (GET form, quick test)
curl -s 'https://portofcall.ross.gg/api/rsh/execute?host=192.168.1.10&localUser=root&remoteUser=root&command=id'

# Execute with custom user pair
curl -s -X POST https://portofcall.ross.gg/api/rsh/execute \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","localUser":"alice","remoteUser":"alice","command":"whoami; hostname"}' \
  | jq '{serverAccepted,output,privilegedPortRejection}'

# Trust scan — discover all .rhosts relationships
curl -s -X POST https://portofcall.ross.gg/api/rsh/trust-scan \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10"}' \
  | jq '{summary,"trustedPairs":.summary.trustedPairs}'

# Trust scan with custom user lists
curl -s -X POST https://portofcall.ross.gg/api/rsh/trust-scan \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "192.168.1.10",
    "localUsers": ["root", "alice", "bob"],
    "remoteUsers": ["root"],
    "command": "id",
    "maxPairs": 10
  }' | jq '.results[] | select(.accepted)'

# WebSocket tunnel (wscat)
wscat -c 'wss://portofcall.ross.gg/api/rsh/execute?host=192.168.1.10&localUser=root&remoteUser=root&command=bash'
```

---

## Implementation Notes

### Output collection in `/execute`

After the server sends `\0` (accepted), the worker enters a loop:
- Reads up to **10 chunks** with a 2-second per-chunk deadline
- Breaks on `done` (TCP close) or no data (deadline fires returning `{ done: true }`)
- All chunks joined into `output` and trimmed

Fast commands (`id`, `uname -a`) typically return in 1-2 reads. Long-running commands will return partial output. Commands with no output return `output: undefined` in the response.

### `/probe` vs `/execute` defaults

`/probe` defaults `localUser` and `remoteUser` to `'probe'` rather than `'guest'`. This distinguishes probe traffic from execute traffic in server logs and `.rhosts` entries.

### Trust-scan pair ordering

Pairs are generated by outer `localUsers` loop, inner `remoteUsers` loop — so all `remoteUsers` are tested for the first `localUser` before moving to the next. The first `maxPairs` combinations are tested.

### Privileged port detection — keyword differences

`/execute` checks `value.toLowerCase()` for substrings: `'permission'`, `'privileged'`, `'reserved'`, `'not superuser'`.

`/probe` and `/trust-scan` use a regex: `/permission denied|privileged port|reserved port|not superuser/i` (slightly more specific — `'permission alone'` does not match, only `'permission denied'`).

---

## Known Limitations

- **No stderr channel** — Workers cannot bind listener ports; stderr is always lost or merged with stdout by the server
- **No privileged source port** — Workers connect from port > 1023; strict RSH servers will always reject. A `privilegedPortRejection: true` result proves the server is running RSH but all commands will fail from this source
- **Output truncation** — `/execute` collects at most 10 chunks over 2 seconds; large outputs are silently truncated
- **No interactive session** — HTTP mode is one-shot per request. Use the WebSocket endpoint for commands that require stdin or produce streaming output
- **No encryption** — all data including usernames and command output is plaintext

---

## Local Test Server

```bash
# Debian/Ubuntu — install and allow RSH (unsafe, test environment only)
apt-get install rsh-server
# Add to /etc/hosts.equiv or ~/.rhosts:
echo "$(hostname) $(whoami)" >> ~/.rhosts
chmod 600 ~/.rhosts
# Enable in xinetd or inetd: edit /etc/xinetd.d/rsh, set disable = no
service xinetd restart

# Test locally
rsh localhost id
```

For Docker-based testing, most modern base images ship without inetd. A minimal test target:

```bash
docker run -it --rm ubuntu bash -c "
  apt-get update -q && apt-get install -y rsh-server xinetd &&
  echo 'localhost root' >> /root/.rhosts &&
  service xinetd start &&
  sleep 3600
"
```
