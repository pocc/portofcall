# Echo — Power User Reference

**Port:** 7/tcp (RFC 862) | any port works
**Tests:** 9/9 ✅ Deployed
**Source:** `src/worker/echo.ts`

Two endpoints. No persistent state.

---

## Endpoints

### `POST /api/echo/test` — One-shot echo test

Connects, sends a message, reads the first response chunk, and closes.

**Request (JSON body — POST only, no GET form):**

| Field | Default | Notes |
|---|---|---|
| `host` | — | ✅ Required |
| `port` | `7` | Standard echo port; use `4242` for tcpbin.com |
| `message` | — | ✅ Required; must be non-empty |
| `timeout` | `10000` | Wall-clock timeout in ms, shared between connect and read |

**Success (200):**

```json
{
  "success": true,
  "sent": "hello",
  "received": "hello",
  "match": true,
  "rtt": 23
}
```

**Success with mismatch (200):**

```json
{
  "success": true,
  "sent": "hello",
  "received": "hello\n",
  "match": false,
  "rtt": 19,
  "error": "Echo mismatch: sent \"hello\" but received \"hello\\n\""
}
```

**Failure (400 validation / 500 connection error):**

```json
{
  "success": false,
  "error": "Connection timeout",
  "sent": "",
  "received": "",
  "match": false,
  "rtt": 0
}
```

**Key fields:**

| Field | Notes |
|---|---|
| `sent` | Exact string sent (same as request `message`) |
| `received` | First chunk returned by the server, decoded via TextDecoder |
| `match` | `true` iff `sent === received` (strict string equality) |
| `rtt` | ms from `socket.opened` resolution to receipt of first byte |

**Validation errors (HTTP 400):**
- Missing or empty `host` → `{ success: false, error: "Host is required" }`
- Missing or empty `message` → `{ success: false, error: "Message is required" }`
- Port outside 1–65535 → `{ success: false, error: "Port must be between 1 and 65535" }`

---

### `GET /api/echo/connect` — WebSocket tunnel

Upgrades to WebSocket and bridges all traffic to/from a TCP echo server. Useful for testing multiple messages without reconnecting, or for binary echo sessions.

**Query params (GET only):**

| Param | Default | Notes |
|---|---|---|
| `host` | — | Required; returns HTTP 400 if absent |
| `port` | `7` | |

**Connection:**

```javascript
const ws = new WebSocket('wss://portofcall.ross.gg/api/echo/connect?host=tcpbin.com&port=4242');

ws.onopen = () => ws.send('ping');                // → TCP: "ping"
ws.onmessage = (e) => console.log(e.data);       // ← TCP: "ping" (decoded to string)
ws.onclose = () => console.log('closed');
```

**Data flow:**

| Direction | What happens |
|---|---|
| WS → TCP | String messages encoded to UTF-8; ArrayBuffer forwarded as Uint8Array |
| TCP → WS | Each TCP chunk decoded via `TextDecoder` then sent as a string frame |
| WS close | TCP socket closed |
| TCP close/EOF | WebSocket closed |

Returns HTTP 426 if the request is not a WebSocket upgrade.

---

## Wire Exchange

```
→ (TCP connect to host:port)
→ hello\r\n
← hello\r\n
→ (more messages or close)
```

RFC 862 defines no framing, no commands, no handshake. The server echoes every byte it receives. Connection can remain open for multiple exchanges.

---

## Implementation Notes

### Single-read limitation

`handleEchoTest` issues exactly one `reader.read()` call after sending. If the echo server returns the data spread across multiple TCP segments (e.g., a 100 KB message on a slow link), `received` will only contain the first segment and `match` will be `false` even if the server is behaving correctly.

This is rarely a problem in practice since echo servers typically send one segment per send. But for large messages or high-latency paths, expect false negatives.

### Shared timeout

The same `timeoutPromise` races against both `socket.opened` and `reader.read()`:

```
timeout budget ──────────────────────────────────▶
connect phase   [────────────────]
                                  read phase [────]
```

If the connection takes 9 of your 10 s, the read phase has only 1 s left. There is no separate per-phase timeout.

### match is strict string equality

`match = (sent === received)` — both values are JavaScript strings after TextDecoder decoding. Servers that append `\n` or `\r\n`, echo CRLF for LF, add timestamps, or change encoding will produce `match: false` even though they echoed the payload correctly. Check `received` directly when diagnosing.

### Error response shape diverges from success

On connection/read failure, the response shape is:
```json
{ "success": false, "error": "...", "sent": "", "received": "", "match": false, "rtt": 0 }
```
On success with mismatch, `success` stays `true` and `sent`/`received` are the actual values. The `error` field appears in both cases but means different things — in the mismatch case it's an explanation, not a failure indicator.

### Binary data in WebSocket mode

The WebSocket tunnel sends TCP data as **string frames** (decoded via `TextDecoder`). Binary echo servers that return arbitrary bytes will have those bytes transcoded through UTF-8 replacement characters. For binary echo testing, use the HTTP endpoint (`/api/echo/test`) — it does the same TextDecoder decode but at least keeps it to a single request/response cycle.

---

## curl Examples

```bash
# Basic echo test (tcpbin.com public server)
curl -s -X POST https://portofcall.ross.gg/api/echo/test \
  -H 'Content-Type: application/json' \
  -d '{"host":"tcpbin.com","port":4242,"message":"hello"}' | jq .

# Check match and RTT
curl -s -X POST https://portofcall.ross.gg/api/echo/test \
  -H 'Content-Type: application/json' \
  -d '{"host":"tcpbin.com","port":4242,"message":"ping"}' \
  | jq '{match,rtt,received}'

# Non-standard port
curl -s -X POST https://portofcall.ross.gg/api/echo/test \
  -H 'Content-Type: application/json' \
  -d '{"host":"myserver.example.com","port":9999,"message":"test","timeout":5000}' | jq .

# WebSocket tunnel (wscat)
wscat -c 'wss://portofcall.ross.gg/api/echo/connect?host=tcpbin.com&port=4242'
# then type messages; each is echoed back

# Test large message (detect single-read limitation)
python3 -c "import json; print(json.dumps({'host':'tcpbin.com','port':4242,'message':'x'*8000}))" \
  | curl -s -X POST https://portofcall.ross.gg/api/echo/test \
    -H 'Content-Type: application/json' -d @- | jq '{match,sent_len:.sent|length,received_len:.received|length}'
```

---

## Known Limitations

- **Single TCP read** — `received` contains only the first chunk; large messages or slow paths cause false `match: false`
- **No GET form** — `/api/echo/test` is POST-only; there is no query-param GET variant
- **No Cloudflare detection** — unlike most other Port of Call endpoints, the echo handler does not call `checkIfCloudflare`. Probing Cloudflare-protected hosts will silently connect or fail with a generic error
- **Binary data** — TCP responses decoded to string via `TextDecoder`; binary echo is lossy
- **Shared timeout** — connect phase and read phase share the same `timeout` budget

---

## Public Test Servers

| Host | Port | Notes |
|---|---|---|
| `tcpbin.com` | `4242` | Reliable public TCP echo server; responds quickly |
| Any host | `7` | Standard port; blocked on most hosts; enabled only on legacy/embedded systems |

---

## Local Test Server

```bash
# netcat echo server (one-shot)
nc -l 4242 | nc -l 4242   # won't actually loop — use socat instead

# socat echo server (persistent, recommended)
socat TCP-LISTEN:4242,fork PIPE

# Then test locally via the API:
curl -s -X POST https://portofcall.ross.gg/api/echo/test \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_LOCAL_IP","port":4242,"message":"test"}'
```
