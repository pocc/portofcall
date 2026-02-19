# Beats (Lumberjack v2) — Port 5044

`src/worker/beats.ts` · 3 endpoints · Lumberjack v2 binary framing

Binary protocol for shipping JSON events from Elastic Beats agents (Filebeat, Metricbeat, etc.) to Logstash or other receivers. Uses window-based flow control with sequence-numbered ACKs.

---

## Endpoints

| Endpoint | Method | Purpose | Default port | Default timeout | TLS | CF check | Port validation |
|---|---|---|---|---|---|---|---|
| `/api/beats/send` | POST | Send events (plaintext TCP) | 5044 | 15 000 ms | No | No | Yes (1–65535) |
| `/api/beats/connect` | POST | TCP connectivity probe | 5044 | 15 000 ms | No | No | No |
| `/api/beats/tls` | POST | Send events over TLS | 5045 | 15 000 ms | Yes | No | Yes (1–65535) |

No HTTP method restriction on any endpoint — any method works as long as a JSON body is present.

No Cloudflare detection on any endpoint.

---

## POST /api/beats/send

Sends a batch of JSON events over plaintext TCP using Lumberjack v2 framing: WINDOW frame followed by one JSON frame per event, then waits for a single ACK.

### Request

```json
{
  "host": "logstash.example.com",
  "port": 5044,
  "events": [
    { "message": "User logged in", "level": "info" },
    { "message": "Failed login", "level": "warning" }
  ],
  "windowSize": 1000,
  "timeout": 15000
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `host` | yes | — | Target hostname or IP |
| `port` | no | `5044` | Validated 1–65535 |
| `events` | yes | — | Non-empty array of JSON objects |
| `windowSize` | no | `1000` | Window size announced in WINDOW frame |
| `timeout` | no | `15000` | Milliseconds for connect + send + ACK read |

### Wire exchange

```
Client → Server:  32 57 00 00 03 E8                     (WINDOW: version '2', type 'W', size 1000)
Client → Server:  32 4A 00 00 00 01 00 00 00 2D ...     (JSON: version '2', type 'J', seq 1, len 45, payload)
Client → Server:  32 4A 00 00 00 02 00 00 00 31 ...     (JSON: version '2', type 'J', seq 2, len 49, payload)
Server → Client:  32 41 00 00 00 02                      (ACK: version '2', type 'A', seq 2)
```

### Response (success)

```json
{
  "success": true,
  "host": "logstash.example.com",
  "port": 5044,
  "acknowledged": 2,
  "eventsSent": 2,
  "rtt": 245
}
```

`success` is `true` only when `acknowledged >= eventsSent` (all events were ACKed).

### Response (partial ACK)

If the server ACKs fewer events than sent:

```json
{
  "success": false,
  "host": "logstash.example.com",
  "port": 5044,
  "acknowledged": 1,
  "eventsSent": 2,
  "rtt": 180
}
```

### Error response fields

On error (HTTP 500), the `host` and `port` in the response body are empty string and 5044, not the values from the request.

### curl

```bash
curl -s -X POST http://localhost:8787/api/beats/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "logstash.example.com",
    "port": 5044,
    "events": [
      {"message": "test event", "@timestamp": "2026-02-17T00:00:00Z"}
    ]
  }' | jq
```

---

## POST /api/beats/connect

TCP-only connectivity probe. Opens a socket, measures connection time, and immediately closes. Does **not** send any Beats protocol frames — not even a WINDOW frame. This only confirms TCP reachability, not that the server speaks Beats/Lumberjack.

### Request

```json
{ "host": "logstash.example.com", "port": 5044, "timeout": 15000 }
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `host` | yes | — | Target hostname or IP |
| `port` | no | `5044` | **No port validation** |
| `timeout` | no | `15000` | Milliseconds |

### Response

```json
{
  "success": true,
  "host": "logstash.example.com",
  "port": 5044,
  "rtt": 12,
  "message": "Beats connection successful"
}
```

### curl

```bash
curl -s -X POST http://localhost:8787/api/beats/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"logstash.example.com"}' | jq
```

---

## POST /api/beats/tls

Identical to `/send` but connects with `secureTransport: 'on'` (Cloudflare Workers TLS). Default port is 5045. Response shape differs from `/send`.

### Request

```json
{
  "host": "logstash.example.com",
  "port": 5045,
  "events": [
    { "message": "secure event", "level": "info" }
  ],
  "windowSize": 1000,
  "timeout": 15000
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `host` | yes | — | Target hostname or IP |
| `port` | no | `5045` | Validated 1–65535 |
| `events` | yes | — | Non-empty array of JSON objects. Type: `Record<string, string>` (stricter than `/send`) |
| `windowSize` | no | `1000` | Window size |
| `timeout` | no | `15000` | Milliseconds |

### Response

```json
{
  "tls": true,
  "host": "logstash.example.com",
  "port": 5045,
  "events": 1,
  "acked": true,
  "sequenceAcked": 1,
  "rtt": 312
}
```

Note the different response shape:
- `tls: true` (always present, even in errors)
- `events` (count, not `eventsSent`)
- `acked` (boolean, not `success`)
- `sequenceAcked` (not `acknowledged`)

### curl

```bash
curl -s -X POST http://localhost:8787/api/beats/tls \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "logstash.example.com",
    "port": 5045,
    "events": [{"message":"secure test"}]
  }' | jq
```

---

## Wire Protocol Reference

### Frame types

| Version | Type byte | Name | Direction | Payload |
|---|---|---|---|---|
| `0x32` ('2') | `0x57` ('W') | WINDOW | client → server | 4-byte window size (BE) |
| `0x32` ('2') | `0x4A` ('J') | JSON | client → server | 4-byte sequence (BE) + 4-byte length (BE) + JSON bytes |
| `0x32` ('2') | `0x41` ('A') | ACK | server → client | 4-byte sequence (BE) |
| `0x32` ('2') | `0x44` ('D') | DATA | — | Not implemented (Lumberjack v1-style key-value pairs) |
| `0x32` ('2') | `0x43` ('C') | COMPRESSED | — | Not implemented (zlib-compressed batch) |

### Integer encoding

All integers are 32-bit unsigned big-endian. Encoding uses manual bit shifts (`(value >> 24) & 0xFF` etc.), not `DataView`.

### Decoding quirk

`decodeUint32BE` uses bitwise OR (`|`) which produces signed 32-bit integers in JavaScript. Values with the high bit set (sequence numbers > 2,147,483,647) would decode as negative numbers. In practice, sequence numbers start at 1 and represent event counts, so this is unlikely to trigger.

---

## Known Issues and Quirks

### 1. Response shape divergence between `/send` and `/tls`

| Field | `/send` | `/tls` |
|---|---|---|
| Success indicator | `success: boolean` | `acked: boolean` |
| Events sent | `eventsSent: number` | `events: number` |
| ACK sequence | `acknowledged: number` | `sequenceAcked: number` |
| TLS flag | absent | `tls: true` |
| Error response host | `""` (empty string) | `""` (empty string) |
| Error response port | `5044` | `5045` |

Both endpoints do the same thing (send WINDOW + JSON frames, read ACK), but use completely different response field names. A client consuming both needs two parsing paths.

### 2. `/connect` doesn't speak Beats protocol

`handleBeatsConnect` only opens a TCP socket, measures connection time, and closes. It sends no WINDOW frame, no data, and reads nothing. A plain TCP socket to any service on port 5044 will return `success: true`. This is a TCP probe, not a Beats protocol probe.

### 3. Single ACK read

Both `/send` and `/tls` do a single `reader.read()` after sending all frames. If the server sends the ACK split across multiple TCP segments, only the first segment is read. If the first read returns fewer than 6 bytes, `parseAckFrame` returns `null` and the handler throws "Invalid ACK frame received". There's no accumulation buffer.

### 4. Double timeout in `/send` and `/tls`

Two independent `setTimeout` promises exist:
1. `timeoutPromise` — wraps `socket.opened`
2. `readTimeout` — wraps `reader.read()` for the ACK

Both use the full `timeout` value independently. The worst-case wall-clock time is `2 × timeout` (connect takes `timeout - 1` ms, then ACK read gets another full `timeout`).

### 5. Events type difference

`/send` accepts `events: Array<Record<string, unknown>>` (any JSON values).
`/tls` accepts `events: Array<Record<string, string>>` (string values only in the TypeScript type). In practice both go through `JSON.stringify`, so any serializable value works at runtime, but the TypeScript types differ.

### 6. No Cloudflare detection

None of the three endpoints call `checkIfCloudflare()`. Connections to Cloudflare-proxied hosts will attempt to establish a TCP connection on port 5044/5045, which will likely time out or produce unexpected results.

### 7. No `allowHalfOpen` consistency

`/tls` uses `connect(addr, { secureTransport: 'on', allowHalfOpen: false })`.
`/send` and `/connect` use `connect(addr)` with no options. The `allowHalfOpen` behavior is undefined for the plaintext endpoints.

### 8. Error response loses request context

On catch (HTTP 500), `/send` returns `host: ''` and `/tls` returns `host: ''`. The actual host from the request is lost in the error response, making it harder to identify which target failed when sending to multiple hosts.

### 9. Window size not enforced

The `windowSize` value is sent in the WINDOW frame but has no effect on the client's behavior. All events are sent immediately regardless of window size. Real Beats clients pause after `windowSize` events and wait for an ACK before continuing. This implementation fires all events and expects a single final ACK.

### 10. No COMPRESSED frame support

Lumberjack v2's COMPRESSED frame (`'2C'`) is the most common framing used by real Beats agents. This implementation only sends JSON frames (`'2J'`). Logstash's Beats input accepts both, but some receivers may expect compressed data.

---

## Per-Endpoint Comparison

| | `/send` | `/connect` | `/tls` |
|---|---|---|---|
| Default port | 5044 | 5044 | 5045 |
| Default timeout | 15 000 ms | 15 000 ms | 15 000 ms |
| Port validation | Yes (1–65535) | No | Yes (1–65535) |
| CF detection | No | No | No |
| TLS | No | No | Yes (`secureTransport: 'on'`) |
| Sends WINDOW | Yes | No | Yes |
| Sends JSON frames | Yes | No | Yes |
| Reads ACK | Yes | No | Yes |
| Protocol version | 2 | N/A | 2 |

---

## Local Testing

```bash
# Run Logstash with Beats input (plaintext)
docker run -d --name logstash -p 5044:5044 \
  -e 'input { beats { port => 5044 } }' \
  -e 'output { stdout { codec => rubydebug } }' \
  docker.elastic.co/logstash/logstash:8.12.0

# Send events (plaintext)
curl -s -X POST http://localhost:8787/api/beats/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "host.docker.internal",
    "port": 5044,
    "events": [
      {"message": "test event 1", "@timestamp": "2026-02-17T00:00:00Z"},
      {"message": "test event 2", "@timestamp": "2026-02-17T00:00:01Z"}
    ]
  }' | jq

# TCP probe only
curl -s -X POST http://localhost:8787/api/beats/connect \
  -d '{"host":"host.docker.internal"}' | jq
```

For TLS testing, configure Logstash with SSL certificates:

```ruby
input {
  beats {
    port => 5045
    ssl_enabled => true
    ssl_certificate => "/path/to/cert.pem"
    ssl_key => "/path/to/key.pem"
  }
}
```
