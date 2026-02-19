# Discard -- Power User Reference

**Port:** 9/tcp (RFC 863) | any port works
**Source:** `src/worker/discard.ts`

One endpoint. No persistent state. No server response.

---

## Endpoint

### `POST /api/discard/send` -- One-shot discard test

Connects, sends data, closes, and reports timing/throughput. The server never sends application data back -- the only confirmation of success is that the TCP write completed without error.

**Request (JSON body -- POST only):**

| Field | Default | Notes |
|---|---|---|
| `host` | -- | Required |
| `port` | `9` | Standard discard port |
| `data` | -- | Required; must be non-empty; max 1 MB (measured in UTF-8 bytes) |
| `timeout` | `10000` | Wall-clock timeout in ms, covers both connect and write phases |

**Success (200):**

```json
{
  "success": true,
  "bytesSent": 25,
  "duration": 42,
  "throughput": "4.76 Kbps"
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
| `bytesSent` | UTF-8 encoded byte count of `data` (not character count) |
| `duration` | ms from pre-connect to post-write |
| `throughput` | Human-readable bits/sec; `"N/A (instant)"` if duration rounds to 0 ms |

**Validation errors (HTTP 400):**
- Missing or empty `host` -> `"Host is required"`
- Port outside 1-65535 -> `"Port must be between 1 and 65535"`
- Missing or empty `data` -> `"Data is required (cannot be empty)"`
- Data exceeds 1 MB in UTF-8 -> `"Data exceeds maximum size (1MB). Actual size: N bytes"`

---

## Wire Exchange

```
-> (TCP connect to host:port)
-> [arbitrary bytes]
   (server reads and discards -- no application-layer response)
-> FIN (client closes)
<- FIN-ACK
```

RFC 863 defines no framing, no commands, no handshake, and no response. The server simply reads all incoming data and throws it away. The only bytes from the server are TCP-level ACKs.

---

## RFC 863 Compliance

RFC 863 is one of the shortest RFCs ever published (roughly half a page). The full specification:

> A discard service is defined as a connection based application on TCP. A server listens for TCP connections on TCP port 9. Once a connection is established any data received is thrown away. No response is sent. This continues until the calling user terminates the connection.

### What this implementation covers

| RFC requirement | Status | Notes |
|---|---|---|
| TCP transport | Compliant | Uses Cloudflare `connect()` for TCP sockets |
| Default port 9 | Compliant | Defaults to 9; configurable via `port` field |
| Server discards all data | Compliant (client-side) | Sends data and never reads; relies on remote server behavior |
| No response from server | Compliant | Implementation never attempts `reader.read()` |
| Client closes connection | Compliant | `writer.close()` then `socket.close()` |

### What this implementation does NOT cover

| Feature | Reason |
|---|---|
| UDP variant | Cloudflare Workers `connect()` is TCP-only; UDP datagrams are not supported by the platform |
| Server-side discard service | This is a client that probes remote discard servers, not a discard server itself |
| Repeated/streamed sends | Single write per connection; no `repeatCount` or streaming mode |

---

## Implementation Notes

### Shared timeout

The same `timeoutPromise` races against both `socket.opened` and the write:

```
timeout budget ---------------------------------------->
connect phase   [--------------------]
                                      write phase [----]
```

If the connection takes 9 of your 10 seconds, the write phase has only 1 second. There is no separate per-phase timeout.

### Throughput calculation

Throughput is calculated as `(bytes * 8) / (durationMs / 1000)` and reported in bps / Kbps / Mbps. This measures **client-side send throughput**, not network throughput -- it includes TCP handshake time in the duration, and the data may still be in kernel/network buffers when the measurement completes.

For `duration = 0` (sub-millisecond operations), the result is `"N/A (instant)"` rather than `Infinity`.

### Size limit is byte-based

The 1 MB safety limit is enforced against UTF-8 encoded byte length, not JavaScript string length. A string of 500,000 emoji characters (~2 MB in UTF-8) will be correctly rejected even though `string.length` reports ~500,000.

### No response verification

Unlike Echo (which reads a response to verify correctness), Discard has no way to confirm the server actually received and discarded the data. A successful result means only that the TCP write completed without error. The server could be anything that accepts connections -- there is no protocol-level way to distinguish a real discard server from any other TCP listener.

### Error on socket close

If the remote server resets the connection or refuses it, the error surfaces as a generic message (e.g., `"Connection refused"` or `"Connection timeout"`). The HTTP status is 500 for all connection/write errors.

---

## curl Examples

```bash
# Basic discard test (localhost)
curl -s -X POST https://portofcall.ross.gg/api/discard/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9,"data":"Hello, Discard!"}' | jq .

# 1KB throughput test
curl -s -X POST https://portofcall.ross.gg/api/discard/send \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"localhost\",\"port\":9,\"data\":\"$(python3 -c "print('A'*1024)")\"}" | jq .

# Custom port, short timeout
curl -s -X POST https://portofcall.ross.gg/api/discard/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"myserver.example.com","port":9999,"data":"test","timeout":3000}' | jq .

# Generate a large payload and check throughput
python3 -c "import json; print(json.dumps({'host':'localhost','port':9,'data':'x'*100000}))" \
  | curl -s -X POST https://portofcall.ross.gg/api/discard/send \
    -H 'Content-Type: application/json' -d @- | jq '{bytesSent,duration,throughput}'
```

---

## Known Limitations

- **No UDP** -- Cloudflare Workers only support TCP sockets; the UDP variant of RFC 863 is not testable
- **No streaming** -- Data is sent in a single `writer.write()` call; no chunked/repeated sends
- **No server verification** -- Cannot confirm the remote is actually a discard server (versus any TCP listener)
- **Shared timeout** -- Connect and write share the same timeout budget
- **Throughput is approximate** -- Includes TCP handshake time; measures client-side write completion, not actual delivery
- **No Cloudflare detection** -- Does not call `checkIfCloudflare`; probing Cloudflare-protected hosts will connect or fail with a generic error
- **Text-only input** -- The API accepts a JSON string field; binary payloads must be representable as UTF-8 text

---

## Relationship to Other Simple Services

| Protocol | RFC | Port | Behavior |
|---|---|---|---|
| Echo | 862 | 7 | Echoes data back |
| **Discard** | **863** | **9** | **Discards data silently** |
| Chargen | 864 | 19 | Generates character stream |
| QOTD | 865 | 17 | Returns a quote |
| Daytime | 867 | 13 | Returns human-readable time |
| Time | 868 | 37 | Returns binary time |

---

## Public Test Servers

Port 9 is blocked by most ISPs and cloud providers. In practice, you need a server you control.

| Host | Port | Notes |
|---|---|---|
| `localhost` | `9` | Requires a local discard daemon (see below) |
| Any host | `9` | Standard port; almost universally firewalled |

---

## Local Test Server

```bash
# socat discard server (persistent, recommended)
socat TCP-LISTEN:9,reuseaddr,fork /dev/null

# ncat discard server
ncat -l -k 9 > /dev/null

# Python one-liner (single-connection)
python3 -c "
import socket
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('', 9)); s.listen(1)
while True:
    c, _ = s.accept()
    while c.recv(4096): pass
    c.close()
"

# Then test:
curl -s -X POST http://localhost:8787/api/discard/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_LOCAL_IP","port":9,"data":"test"}' | jq .
```

---

## Security Considerations

Discard is classified as an "insecure service" alongside Echo, Chargen, and Daytime:

- **No authentication or encryption** -- anyone who can reach the port can send data
- **Connection exhaustion** -- attackers can open many connections to exhaust server resources
- **Amplification (UDP)** -- while the UDP variant does not amplify (no response), a Chargen/Echo+Discard loop was a classic DDoS vector
- **Resource waste** -- server CPU/memory consumed processing data that is thrown away
- Port 9 is typically filtered by firewalls and disabled by default on all modern operating systems
- **Do not expose discard servers to the public internet**
