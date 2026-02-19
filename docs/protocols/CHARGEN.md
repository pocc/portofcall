# CHARGEN -- Power User Reference

**Port:** 19/tcp (RFC 864) | any port works
**Source:** `src/worker/chargen.ts`

One endpoint. No persistent state. Client-only (connects to a remote CHARGEN server and reads the stream).

---

## Endpoint

### `POST /api/chargen/stream` -- Receive character stream

Connects to a remote CHARGEN server, reads up to `maxBytes` of the character stream, then disconnects and returns the data with statistics.

**Request (JSON body -- POST only):**

| Field | Default | Notes |
|---|---|---|
| `host` | -- | Required |
| `port` | `19` | Standard CHARGEN port |
| `maxBytes` | `10240` | Bytes to read before stopping; capped at 1 MB (1048576) |
| `timeout` | `10000` | Wall-clock timeout in ms, shared between connect and read phases |

**Success (200):**

```json
{
  "success": true,
  "data": " !\"#$%&'()*+,-./0123456789...\r\n\"#$%&...",
  "bytes": 10240,
  "lines": 138,
  "duration": 342,
  "bandwidth": "239.53 Kbps"
}
```

**Failure (400 validation / 500 connection error):**

```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Key fields:**

| Field | Notes |
|---|---|
| `data` | Raw character stream from the server, decoded via `TextDecoder` |
| `bytes` | Total bytes read (may slightly exceed `maxBytes` -- see notes) |
| `lines` | Count of non-empty segments split on `\r\n` |
| `duration` | Wall-clock ms from connection start to final byte |
| `bandwidth` | Human-readable throughput (`bps`, `Kbps`, or `Mbps`) |

**Validation errors (HTTP 400):**
- Missing or empty `host` -> `{ success: false, error: "Host is required" }`
- Port outside 1-65535 -> `{ success: false, error: "Port must be between 1 and 65535" }`

---

## Wire Exchange

```
-> (TCP connect to host:port)
<- [continuous stream of ASCII characters until client disconnects]
-> (TCP close)
```

RFC 864 defines no handshake, no commands, and no framing. The server begins sending immediately upon connection. Any data sent by the client is discarded. The stream is infinite -- it continues until the client closes the connection.

---

## RFC 864 Character Pattern

RFC 864 suggests (but does not mandate) a specific rotating character pattern. The RFC says:

> "One popular pattern is 72 character lines of the ASCII printing characters."

### Character set

ASCII 32 (space) through 126 (`~`) = **95** printable characters.

### Line structure

Each line is 72 characters followed by CR LF (`\r\n`), for 74 bytes per line.

### Rotation

Lines are numbered from 0. Line N starts at character `(N mod 95)` in the ordered character set, then wraps. After 72 characters, a CRLF is appended.

### First 6 lines (RFC pattern)

```
 !"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefg\r\n
!"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefgh\r\n
"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghi\r\n
#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghij\r\n
$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijk\r\n
%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijkl\r\n
```

Note: Line 0 begins with a space character (ASCII 32). The full cycle repeats every 95 lines.

### Common deviation

Some implementations use ASCII 33 (`!`) through 126 (`~`) = 94 characters, omitting the space. This is technically allowed since the RFC says "the data may be anything" -- the 95-character rotating pattern is described as "one popular pattern," not a requirement. However, the RFC's own example includes the space.

---

## Implementation Notes

### maxBytes is a soft cap

The read loop checks `totalBytes < safeMaxBytes` before each read. If a single TCP segment pushes the total past the limit, the full segment is kept and the loop exits. The returned `bytes` value reflects the actual amount received, which may be slightly more than `maxBytes`.

The hard cap is 1 MB (1048576 bytes), enforced via `Math.min(maxBytes, 1048576)` regardless of what the client requests.

### Shared timeout

The same `timeoutPromise` races against both `socket.opened` and every `reader.read()`:

```
timeout budget ────────────────────────────────────>
connect phase   [──────────────]
                                read phase [───────]
```

If the connection takes 9 of your 10 s, the read phase has only 1 s left. There is no separate per-phase timeout.

### Line count uses CRLF splitting

`lines` is computed as:
```typescript
dataText.split('\r\n').filter(line => line.length > 0).length
```

Servers that use bare `\n` instead of `\r\n` will produce a line count of 1 (the entire data as one "line"). This matches the RFC specification which mandates CRLF, but some non-compliant servers may behave differently.

### Bandwidth calculation

Bandwidth is `(bytes * 8) / (durationMs / 1000)`, displayed in human-readable units. A guard prevents division by zero when `durationMs <= 0`.

### Partial data on timeout

If the timeout fires during reads but some data was already received, the handler returns what it has rather than failing. Only if zero data was received does the timeout propagate as an error.

### No Cloudflare detection

Unlike some other Port of Call endpoints, the CHARGEN handler does not call `checkIfCloudflare`. Probing Cloudflare-protected hosts will silently connect or fail with a generic error.

### No data sent to server

RFC 864 says the server discards any data it receives from the client. This implementation sends nothing after connecting -- it only reads. This is correct behavior for a CHARGEN client.

---

## curl Examples

```bash
# Basic CHARGEN stream (10 KB default)
curl -s -X POST https://portofcall.ross.gg/api/chargen/stream \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost"}' | jq .

# Just the stats, no data
curl -s -X POST https://portofcall.ross.gg/api/chargen/stream \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","maxBytes":5120}' \
  | jq '{bytes,lines,duration,bandwidth}'

# Non-standard port, larger read
curl -s -X POST https://portofcall.ross.gg/api/chargen/stream \
  -H 'Content-Type: application/json' \
  -d '{"host":"myserver.example.com","port":1919,"maxBytes":102400,"timeout":15000}' | jq .

# Maximum allowed read (1 MB)
curl -s -X POST https://portofcall.ross.gg/api/chargen/stream \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","maxBytes":1048576,"timeout":30000}' \
  | jq '{bytes,lines,duration,bandwidth}'
```

---

## Known Limitations

- **No WebSocket tunnel** -- unlike ECHO, there is no persistent WebSocket mode for interactive streaming; the endpoint does a single connect-read-close cycle
- **No GET form** -- `/api/chargen/stream` is POST-only
- **No pattern validation** -- the response includes raw data but does not verify whether the server's output follows the RFC 864 pattern
- **No Cloudflare detection** -- connecting to Cloudflare-fronted hosts may produce misleading results
- **Shared timeout** -- connect and read share a single timeout budget
- **maxBytes overshoot** -- the actual byte count may slightly exceed the requested limit by one TCP segment

---

## Local Test Server

```bash
# Python CHARGEN server (RFC 864 compliant pattern)
python3 << 'PYEOF'
import socket, threading

def chargen_line(offset):
    return ''.join(chr(32 + (offset + i) % 95) for i in range(72)) + '\r\n'

def handle(conn, addr):
    print(f"CHARGEN connection from {addr}")
    offset = 0
    try:
        while True:
            conn.sendall(chargen_line(offset).encode('ascii'))
            offset = (offset + 1) % 95
    except (BrokenPipeError, ConnectionResetError):
        pass
    finally:
        conn.close()

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('0.0.0.0', 19))
sock.listen(5)
print("CHARGEN server on port 19")
while True:
    conn, addr = sock.accept()
    threading.Thread(target=handle, args=(conn, addr), daemon=True).start()
PYEOF

# socat one-liner (not RFC pattern, but generates chars)
socat TCP-LISTEN:19,fork,reuseaddr SYSTEM:'while true; do printf " !\"#\$%%&'\''()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefg\r\n"; done'

# Then test:
nc localhost 19 | head -n 10
```

---

## Direct Testing (without Port of Call)

```bash
# netcat -- connect and receive (Ctrl-C to stop)
nc chargen.example.com 19

# Limit to first 10 lines
nc chargen.example.com 19 | head -n 10

# Receive exactly 1 MB and measure time
time nc chargen.example.com 19 | head -c 1048576 > /dev/null

# Validate pattern (check that each line is 72 chars)
nc localhost 19 | head -n 100 | awk '{if(length!=72) print NR": bad length "length}'
```

---

## Security

CHARGEN has no authentication, no encryption, and no access control.

**DDoS amplification:** A spoofed UDP packet to port 19 produces a large response directed at the spoofed source IP. This is the primary reason CHARGEN is disabled on virtually all production systems. The TCP variant is less exploitable but still wastes bandwidth.

**Resource exhaustion:** A CHARGEN server will send data as fast as the network allows, potentially saturating links. The 1 MB hard cap in this implementation limits the damage from the client side.

**Firewall filtering:** Port 19 is blocked by most enterprise firewalls and ISPs. Public CHARGEN servers are essentially extinct.

---

## Comparison with Other Simple Service Protocols

| Protocol | RFC | Port | Direction | Behavior |
|---|---|---|---|---|
| ECHO | 862 | 7 | Bidirectional | Echoes back what client sends |
| DISCARD | 863 | 9 | Client -> Server | Silently discards all received data |
| **CHARGEN** | **864** | **19** | **Server -> Client** | **Sends continuous character stream** |
| QOTD | 865 | 17 | Server -> Client | Sends one quote, then closes |
| DAYTIME | 867 | 13 | Server -> Client | Sends current time as text, then closes |
| TIME | 868 | 37 | Server -> Client | Sends 32-bit binary time, then closes |

CHARGEN is unique among these in being an infinite stream -- all others either echo, close after one response, or discard input.

---

## UDP Variant (Not Implemented)

RFC 864 also defines a UDP variant: the client sends a datagram to port 19, and the server replies with a single datagram containing a random number of characters (0-512 bytes). This is not implemented because Cloudflare Workers' `cloudflare:sockets` API only supports TCP.
