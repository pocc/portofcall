# QOTD -- Power User Reference

**Port:** 17/tcp (RFC 865) | any port works
**Source:** `src/worker/qotd.ts`

One endpoint. No persistent state. Client-only (connects to a remote QOTD server and receives a quote).

---

## Endpoint

### `POST /api/qotd/fetch` -- Receive Quote of the Day

Connects to a remote QOTD server, receives the quote immediately upon connection, then disconnects and returns the quote with statistics.

**Request (JSON body -- POST only):**

| Field | Default | Notes |
|---|---|---|
| `host` | -- | Required |
| `port` | `17` | Standard QOTD port |
| `timeout` | `10000` | Wall-clock timeout in ms, shared between connect and read phases |

**Success (200):**

```json
{
  "success": true,
  "host": "djxmmx.net",
  "port": 17,
  "quote": "The reasonable man adapts himself to the world; the unreasonable one persists in trying to adapt the world to himself. Therefore all progress depends on the unreasonable man.\n\t-- George Bernard Shaw",
  "byteLength": 183,
  "rtt": 234
}
```

**Failure (400 validation / 500 connection error):**

```json
{
  "success": false,
  "host": "example.com",
  "port": 17,
  "error": "Connection timeout"
}
```

**Key fields:**

| Field | Notes |
|---|---|
| `quote` | Raw quote from the server, decoded via `TextDecoder` and trimmed |
| `byteLength` | Total bytes received from server |
| `rtt` | Round-trip time in milliseconds from connection start to final byte |

**Validation errors (HTTP 400):**
- Missing or empty `host` -> `{ success: false, error: "Host is required" }`
- Port outside 1-65535 -> `{ success: false, error: "Port must be between 1 and 65535" }`

---

## Wire Exchange

```
-> (TCP connect to host:port)
<- [quote text sent immediately]
<- (TCP close by server)
-> (TCP close by client)
```

RFC 865 defines no handshake, no commands, and no framing. The server sends a quote immediately upon connection and then closes. No data is sent by the client. The quote should be limited to 512 characters per RFC 865, though servers may send more.

---

## RFC 865 Quote Format

RFC 865 is one of the shortest RFCs ever published (1 page). The entire specification:

> A Quote of the Day (QOTD) service is defined for the convenience of administrators and users of TCP/IP networks. It is a simple service that sends a quote to the client upon connection. The quote should be limited to the ASCII printing characters (codes 32 through 126 decimal), and should be limited to 512 characters.

### Character Set

ASCII 32 (space) through 126 (`~`) = printable characters only.

### Length Limit

RFC 865 suggests 512 characters maximum. Many servers violate this and send longer quotes. This implementation caps responses at 2000 bytes to be generous while preventing abuse.

### Format

No specific format is mandated. Common patterns:

```
Quote text here.
	-- Author Name
```

or

```
Quote text here. -- Author Name
```

or just

```
Quote text here.
```

### Example Quote

```
The reasonable man adapts himself to the world; the unreasonable one
persists in trying to adapt the world to himself. Therefore all
progress depends on the unreasonable man.
	-- George Bernard Shaw
```

---

## Implementation Notes

### Server Behavior

The server sends data immediately upon connection without waiting for any client input. The server then closes the connection. RFC 865 states:

> "Once a connection is established a short message is sent out the connection (and any data received is thrown away). The service closes the connection after sending the quote."

This means:
1. No request needed from client
2. Quote sent immediately
3. Connection closed by server after quote
4. Any data from client is ignored

### Response Size Limit

The implementation has a soft cap of 2000 bytes:

```typescript
const maxResponseSize = 2000; // RFC says 512 chars, but be generous
```

The read loop checks `totalBytes > maxResponseSize` after each chunk. If exceeded, the loop breaks and returns what was received so far. This protects against:
- Servers that violate RFC 865 length limit
- Malicious servers sending infinite streams
- Memory exhaustion attacks

The returned `byteLength` reflects actual bytes received.

### Shared Timeout

The same timeout races against both `socket.opened` and every `reader.read()`:

```
timeout budget ────────────────────────────────────>
connect phase   [──────────────]
                                read phase [───────]
```

If the connection takes 9 of your 10s timeout, the read phase has only 1s left. There is no separate per-phase timeout.

### Resource Cleanup

The implementation properly cleans up resources in all code paths:

1. **Timeout handle** — cleared in `finally` block to prevent timer leaks
2. **Reader lock** — released in `finally` block even if errors occur
3. **Socket** — closed in `finally` block and wrapped in try-catch to prevent cleanup errors from masking original errors

### Error Cases

| Condition | Behavior |
|-----------|----------|
| Missing host | 400 Bad Request |
| Invalid port (outside 1-65535) | 400 Bad Request |
| Connection timeout | 500 with "Connection timeout" |
| Server closes without sending data | 500 with "Server closed connection without sending a quote" |
| Empty response after trimming | 200 with `success: false, error: "Empty response from server"` |
| Response exceeds 2000 bytes | Returns first 2000 bytes successfully (not an error) |

### No Client-to-Server Data

RFC 865 specifies that any data received from the client should be discarded. This implementation sends nothing after connecting — it only reads. This is correct behavior for a QOTD client.

### Partial Data Handling

If the server closes the connection during transmission but some data was already received, the implementation returns what it has rather than failing. Only if zero data was received does it return an error.

---

## curl Examples

```bash
# Basic QOTD fetch
curl -s -X POST https://portofcall.ross.gg/api/qotd/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"djxmmx.net"}' | jq .

# Just the quote text
curl -s -X POST https://portofcall.ross.gg/api/qotd/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"djxmmx.net"}' | jq -r '.quote'

# Non-standard port
curl -s -X POST https://portofcall.ross.gg/api/qotd/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","port":1917}' | jq .

# With longer timeout
curl -s -X POST https://portofcall.ross.gg/api/qotd/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"djxmmx.net","timeout":15000}' | jq .

# Check RTT and byte length
curl -s -X POST https://portofcall.ross.gg/api/qotd/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"djxmmx.net"}' | jq '{rtt,byteLength}'
```

---

## Known Limitations

- **No persistent connection** -- each request creates a new TCP connection; there is no WebSocket tunnel mode
- **No GET form** -- `/api/qotd/fetch` is POST-only
- **No quote validation** -- the response is returned as-is without checking RFC 865 512-character limit or verifying printable ASCII
- **No Cloudflare detection** -- connecting to Cloudflare-fronted hosts may produce misleading results
- **Shared timeout** -- connect and read share a single timeout budget
- **Size limit overshoot** -- actual byte count may slightly exceed 2000 bytes by one TCP segment
- **No multiple quotes** -- some QOTD servers support sending different quotes per connection, but this is not exploited

---

## Local Test Server

```bash
# Python QOTD server (RFC 865 compliant)
python3 << 'PYEOF'
import socket
import threading
import random

QUOTES = [
    "The only way to do great work is to love what you do. -- Steve Jobs",
    "Innovation distinguishes between a leader and a follower. -- Steve Jobs",
    "The reasonable man adapts himself to the world; the unreasonable one persists in trying to adapt the world to himself. Therefore all progress depends on the unreasonable man. -- George Bernard Shaw",
    "The future belongs to those who believe in the beauty of their dreams. -- Eleanor Roosevelt",
    "It is never too late to be what you might have been. -- George Eliot"
]

def handle(conn, addr):
    print(f"QOTD connection from {addr}")
    quote = random.choice(QUOTES)
    try:
        conn.sendall(quote.encode('ascii') + b'\r\n')
    finally:
        conn.close()

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('0.0.0.0', 17))
sock.listen(5)
print("QOTD server on port 17")
while True:
    conn, addr = sock.accept()
    threading.Thread(target=handle, args=(conn, addr), daemon=True).start()
PYEOF

# Simple one-liner with socat
socat TCP-LISTEN:17,fork,reuseaddr SYSTEM:'echo "The future belongs to those who believe in the beauty of their dreams. -- Eleanor Roosevelt"'

# Then test:
nc localhost 17
```

---

## Direct Testing (without Port of Call)

```bash
# netcat -- connect and receive quote
nc djxmmx.net 17

# Telnet
telnet djxmmx.net 17

# Measure timing
time nc djxmmx.net 17

# Check byte length
nc djxmmx.net 17 | wc -c

# Verify server closes connection (no hang)
timeout 5 nc djxmmx.net 17 && echo "Success"

# Test local server
nc localhost 17
```

---

## Security

QOTD has no authentication, no encryption, and no access control.

**Information disclosure:** The quote may reveal information about the server (hostname, organization, internal jokes). Some organizations disable QOTD to prevent information leakage.

**Resource exhaustion:** A malicious server can send large amounts of data to waste bandwidth. This implementation's 2000-byte cap limits the damage.

**Firewall filtering:** Port 17 is blocked by most enterprise firewalls and ISPs. Public QOTD servers are rare.

**No modern use:** QOTD is essentially extinct in production environments. It exists primarily for educational purposes and nostalgia.

---

## Public QOTD Servers

Public QOTD servers are extremely rare. Most have been decommissioned due to lack of use and security concerns.

| Host | Status | Notes |
|------|--------|-------|
| `djxmmx.net` | Active (as of 2024) | One of the few remaining public QOTD servers |
| `qotd.online` | Unknown | May or may not be operational |

Most time-service providers (NIST, NTP Pool, etc.) do **not** run QOTD servers. Port 17 is frequently blocked by corporate firewalls and ISPs.

---

## Historical Context

RFC 865 was published in May 1983 by Jon Postel. It is part of a family of "simple services" defined in the early 1980s:

| RFC | Protocol | Port | Purpose |
|-----|----------|------|---------|
| RFC 862 | Echo | 7 | Echo back received data |
| RFC 863 | Discard | 9 | Discard all received data |
| RFC 864 | Chargen | 19 | Generate character stream |
| **RFC 865** | **QOTD** | **17** | **Quote of the Day** |
| RFC 867 | Daytime | 13 | Human-readable time |
| RFC 868 | Time | 37 | Binary time value |

These protocols were designed as building blocks for testing and as minimal examples of TCP and UDP usage. They also served to make the early Internet more friendly and whimsical. Today they serve primarily educational purposes.

### The Whimsical Side of QOTD

Unlike other "simple services" which are purely technical, QOTD had a human touch. Administrators would curate collections of quotes ranging from:
- Literary quotes (Shakespeare, Twain, Shaw)
- Technical humor (UNIX fortunes, programming jokes)
- Philosophical musings
- Organizational mottos
- Inside jokes

Some servers rotated through hundreds or thousands of quotes. The `/usr/games/fortune` program on UNIX systems was often used as a QOTD quote source.

---

## Comparison with Other Simple Service Protocols

| Protocol | RFC | Port | Direction | Behavior |
|---|---|---|---|---|
| ECHO | 862 | 7 | Bidirectional | Echoes back what client sends |
| DISCARD | 863 | 9 | Client -> Server | Silently discards all received data |
| CHARGEN | 864 | 19 | Server -> Client | Sends continuous character stream |
| **QOTD** | **865** | **17** | **Server -> Client** | **Sends one quote, then closes** |
| DAYTIME | 867 | 13 | Server -> Client | Sends current time as text, then closes |
| TIME | 868 | 37 | Server -> Client | Sends 32-bit binary time, then closes |

QOTD is similar to DAYTIME and TIME in being a one-shot protocol (connect, receive, close), but differs in sending human-readable text content rather than technical data.

---

## UDP Variant (Not Implemented)

RFC 865 also defines a UDP variant:

```
1. Client sends an empty UDP datagram to port 17 on the server
2. Server responds with a single UDP datagram containing a quote (up to 512 bytes)
```

This is not implemented because Cloudflare Workers' `cloudflare:sockets` API only supports TCP. The UDP variant is also even rarer than the TCP variant in practice.

---

## Related Protocols

### Fortune (UNIX)

The `/usr/games/fortune` program generates random quotes and was often used as a backend for QOTD servers:

```bash
# Generate a random fortune
fortune

# Use fortune as QOTD server
socat TCP-LISTEN:17,fork,reuseaddr EXEC:fortune
```

### Internet Proverb (RFC 1924)

RFC 1924 (published April 1, 1996) was an April Fools' joke proposing to encode IPv6 addresses in base-85 using printable ASCII. It's unrelated to QOTD but shares the whimsical spirit of early Internet protocols.

---

## Implementation Quality Notes

The QOTD implementation follows best practices:

1. **Resource cleanup** — timeouts cleared, reader locks released, sockets closed in all code paths
2. **Error handling** — socket cleanup wrapped in try-catch to prevent cleanup errors from masking original errors
3. **Size limits** — 2000-byte cap prevents abuse while being generous to RFC-violating servers
4. **Correct protocol** — never sends data to server, properly handles server-initiated close
5. **Timeout safety** — shared timeout prevents indefinite hangs
6. **Type safety** — full TypeScript interfaces for requests and responses

The implementation correctly handles edge cases like:
- Server closes during transmission (partial data returned)
- Server sends no data before closing (error)
- Server violates 512-character RFC limit (data returned up to 2000 bytes)
- Connection timeout during read phase (partial data returned if any received)

---

## Performance Characteristics

QOTD is an extremely lightweight protocol:

- **Typical quote size:** 100-300 bytes
- **Connection overhead:** ~100-200ms (TLS not required)
- **Total RTT:** ~200-500ms for a complete request
- **Bandwidth:** Negligible (< 1 KB per request)

The bottleneck is typically:
1. DNS lookup
2. TCP handshake (3-way)
3. Network latency

The actual quote transmission is instantaneous compared to connection overhead.

---

## Debugging

### Common Issues

**Connection refused:**
- Port 17 is blocked by firewall
- Server doesn't run QOTD service
- Server is down

**Timeout:**
- Network path is blocked
- Server is slow or unresponsive
- Timeout value too low for network conditions

**Empty response:**
- Server connected but sent no data
- Server implementation is broken
- Server is testing client behavior

**Partial quote:**
- Server crashed during send
- Network issue truncated connection
- Implementation size limit hit (2000 bytes)

### Testing Connectivity

```bash
# Check if port is open
nc -zv djxmmx.net 17

# Check with timeout
timeout 5 nc djxmmx.net 17

# Check firewall
telnet djxmmx.net 17
```

---

## Fun Facts

1. **Historical Quotes:** Some QOTD servers ran for decades with the same quote database from the 1980s
2. **Fortune Cookies:** The UNIX `fortune` command was inspired by fortune cookies and became the de facto QOTD source
3. **Academic Use:** Many university servers ran QOTD as a way to share departmental humor
4. **Easter Eggs:** Some servers had special quotes that only appeared on specific dates (April 1, Halloween, etc.)
5. **RFC 865 Length:** RFC 865 is only 1 page, making it one of the shortest RFCs ever

---

## Further Reading

- **RFC 865:** [Quote of the Day Protocol](https://tools.ietf.org/html/rfc865) (May 1983)
- **RFC 862:** [Echo Protocol](https://tools.ietf.org/html/rfc862)
- **RFC 864:** [Character Generator Protocol](https://tools.ietf.org/html/rfc864)
- **fortune(6):** UNIX manual page for the fortune command
- **Port 17:** [IANA Service Name and Transport Protocol Port Number Registry](https://www.iana.org/assignments/service-names-port-numbers/)

---

## Example Quotes from Real QOTD Servers

```
"The only way to do great work is to love what you do."
	-- Steve Jobs

"Any sufficiently advanced technology is indistinguishable from magic."
	-- Arthur C. Clarke

"C makes it easy to shoot yourself in the foot; C++ makes it harder, but when you do it blows your whole leg off."
	-- Bjarne Stroustrup

"There are only two hard things in Computer Science: cache invalidation and naming things."
	-- Phil Karlton

"Talk is cheap. Show me the code."
	-- Linus Torvalds
```
