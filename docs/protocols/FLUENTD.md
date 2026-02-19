# Fluentd Forward Protocol — Power User Reference

**Port:** 24224 (default) | **Protocol:** Forward Protocol v1 (MessagePack over TCP) | **Tests:** 9/9 | **Source:** `src/worker/fluentd.ts`

Three endpoints, each using a different Forward Protocol message mode. All open a raw TCP socket from the Cloudflare Worker. No TLS. No shared-key authentication.

---

## Endpoints

| Endpoint | Method | Forward Mode | Default Tag |
|---|---|---|---|
| `/api/fluentd/connect` | POST | Forward (`[tag, [[t,rec],...], opts]`) | `portofcall.probe` |
| `/api/fluentd/send` | POST | Message (`[tag, t, rec, opts]`) | `portofcall.test` |
| `/api/fluentd/bulk` | POST | PackedForward (`[tag, bin-blob, opts]`) | `portofcall.bulk` |

All three return 405 for non-POST requests.

---

## `/api/fluentd/connect` — Probe

Sends a single hardcoded event `{message:"portofcall-probe", source:"portofcall"}` in Forward mode with a chunk ID, then waits for an ack.

**Request:**
```json
{ "host": "fluentd.example.com", "port": 24224, "tag": "portofcall.probe", "timeout": 10000 }
```

All fields except `host` are optional (defaults shown).

**Response (success):**
```json
{
  "success": true,
  "host": "fluentd.example.com",
  "port": 24224,
  "rtt": 42,
  "tag": "portofcall.probe",
  "chunkId": "abc123def456ghij",
  "ackReceived": true,
  "ackChunkId": "abc123def456ghij",
  "ackMatch": true,
  "responseData": { "ack": "abc123def456ghij" },
  "messageSizeBytes": 87,
  "protocol": "Fluentd Forward",
  "message": "Fluentd server acknowledged message in 42ms"
}
```

- `ackChunkId` — the chunk ID value extracted from the server's ack response. May differ from `chunkId` if the server echoes a different value (would set `ackMatch: false`).
- `responseData` — full decoded MessagePack map from server. `null` if server sent nothing.
- `success: true` is returned even when `ackReceived: false`. The probe considers TCP connect + message delivery sufficient. Servers without `require_ack_response true` in their config will not ack.

**Wire exchange:**
```
Client → Server:  [tag, [[unix_ts, {message:"portofcall-probe", source:"portofcall"}]], {chunk:"<id>"}]
Server → Client:  {ack:"<id>"}   (only if require_ack_response is enabled)
```

---

## `/api/fluentd/send` — Single Event

Sends one user-defined event in Message mode.

**Request:**
```json
{
  "host": "fluentd.example.com",
  "port": 24224,
  "tag": "app.logs",
  "record": { "message": "Hello", "level": "info", "source": "browser" },
  "timeout": 10000
}
```

- `record` — flat `Record<string, string>`. All values are coerced to strings via `String(v)` before MessagePack encoding, so numeric values become strings on the wire.
- Max 20 key-value pairs (excess silently truncated).
- Total key+value string length capped at 8192 characters (returns 400 if exceeded).
- Default record if omitted: `{ message: "Hello from Port of Call" }`.

**Response (success):**
```json
{
  "success": true,
  "host": "fluentd.example.com",
  "port": 24224,
  "rtt": 38,
  "tag": "app.logs",
  "chunkId": "xyz789...",
  "ackReceived": true,
  "recordKeys": ["message", "level", "source"],
  "messageSizeBytes": 112,
  "protocol": "Fluentd Forward",
  "message": "Log entry sent and acknowledged in 38ms"
}
```

**Wire exchange:**
```
Client → Server:  [tag, unix_ts, {key1:"val1", key2:"val2"}, {chunk:"<id>"}]
Server → Client:  {ack:"<id>"}
```

---

## `/api/fluentd/bulk` — Batch Events (PackedForward)

Sends multiple events in PackedForward mode — each `[time, record]` pair is MessagePack-encoded individually, then concatenated into a raw binary blob sent as a msgpack `bin` type.

**Request:**
```json
{
  "host": "fluentd.example.com",
  "port": 24224,
  "tag": "app.batch",
  "events": [
    { "time": 1700000000, "record": { "message": "event1", "count": 42 } },
    { "record": { "message": "event2" } }
  ],
  "timeout": 10000
}
```

- `events` — array of `{ time?: number, record: Record<string, string | number> }`. Max 100 events (excess silently truncated). `time` defaults to `Date.now()/1000` if omitted.
- Each event's record: max 20 key-value pairs. All values coerced to strings via `String(v)` despite the type accepting `number`.
- Default events if omitted: `[{ record: { message: "Hello from Port of Call" } }]`.
- Options map includes `size` (event count) in addition to `chunk`.

**Response (success):**
```json
{
  "success": true,
  "host": "fluentd.example.com",
  "port": 24224,
  "tag": "app.batch",
  "eventCount": 2,
  "bytesSent": 198,
  "ackReceived": true,
  "chunkId": "abc...",
  "rtt": 55,
  "message": "Sent 2 events (198 bytes) in 55ms, ACK received"
}
```

**Wire exchange:**
```
Client → Server:  [tag, <bin: [ts,rec][ts,rec]...>, {chunk:"<id>", size:N}]
Server → Client:  {ack:"<id>"}
```

---

## Validation Differences

| Check | `/connect` | `/send` | `/bulk` |
|---|---|---|---|
| `host` required | Yes (400) | Yes (400) | Yes (400) |
| Port range 1–65535 | Yes (400) | Yes (400) | **No** |
| Tag regex + max 128 | Yes (400) | Yes (400) | **No** |
| Record size limit | N/A (hardcoded) | 20 entries, 8 KB | 20 entries/event, **no total size** |
| Event count limit | N/A | N/A | 100 events |
| Cloudflare detection | Yes (403) | Yes (403) | Yes (403) |

The `/bulk` endpoint skips tag and port validation entirely.

---

## Timeout Architecture

| Scope | `/connect` | `/send` | `/bulk` |
|---|---|---|---|
| Default overall timeout | 10 s | 10 s | 10 s |
| Covers | `socket.opened` only | `socket.opened` only | `socket.opened` only |
| Ack read sub-timeout | `min(timeout, 5000)` ms | `min(timeout, 5000)` ms | Hardcoded **3 s** |
| Per-read sub-timeout | 3 s (within `readFluentdResponse`) | 3 s (within `readFluentdResponse`) | N/A (single `reader.read()`) |
| Max ack read bytes | 8192 | 8192 | Single read buffer |

The overall `timeout` only gates `socket.opened` via `Promise.race`. If the TCP connection opens in 100 ms, the remaining 9.9 s of timeout is unused — the ack wait uses its own independent sub-timeout. Setting `timeout: 60000` will not extend the ack wait beyond 5 s (or 3 s for `/bulk`).

---

## Ack Detection

`/connect` and `/send` use `readFluentdResponse()`, which:
1. Reads chunks in a loop with a 3 s per-read timeout
2. After each chunk, attempts to decode the accumulated bytes as MessagePack
3. Stops when decode succeeds (complete message) or the deadline is reached
4. Decodes the result as a map and checks for an `ack` key

`/bulk` uses a simpler strategy:
1. Single `reader.read()` with a 3 s race timeout
2. Decodes the raw bytes as UTF-8 text
3. Checks if `text.includes(chunkId)` — or if `value.length > 0`
4. **Any response bytes = `ackReceived: true`**, even if the response is an error or unrelated data

This means `/bulk`'s `ackReceived` is unreliable — it reports `true` for any non-empty server response.

---

## MessagePack Codec

### Encoder (subset)

| Type | Format byte(s) | Range |
|---|---|---|
| positive fixint | `0x00–0x7F` | 0–127 |
| uint 8 | `0xCC` | 0–255 |
| uint 16 | `0xCD` | 0–65535 |
| uint 32 | `0xCE` | 0–4294967295 |
| fixstr | `0xA0–0xBF` | 0–31 bytes |
| str 8 | `0xD9` | 0–255 bytes |
| str 16 | `0xDA` | 0–65535 bytes |
| fixmap | `0x80–0x8F` | 0–15 entries |
| map 16 | `0xDE` | 0–65535 entries |
| fixarray | `0x90–0x9F` | 0–15 items |
| array 16 | `0xDC` | 0–65535 items |

Missing: str 32, map 32, array 32, int types, float, bin (except inline in `/bulk`), ext, timestamp ext.

**`/bulk` inline bin encoding:**

| Format | Header | Max payload |
|---|---|---|
| bin 8 | `0xC4` + 1-byte len | 255 bytes |
| bin 16 | `0xC5` + 2-byte len | 65535 bytes |

No bin 32. If the concatenated entries blob exceeds 65535 bytes (roughly 300+ events with moderate-size records), the 2-byte length field silently overflows, producing a corrupt MessagePack message. The server will likely reject or misparse it.

### Decoder (subset)

Handles: nil, bool, positive/negative fixint, uint 8/16/32, fixstr/str 8/str 16/str 32, fixmap/map 16/map 32, fixarray.

Missing: int 8/16/32/64, uint 64, float 32/64, bin 8/16/32, ext, array 16/array 32.

Unknown type bytes silently return `{ value: null, bytesRead: 1 }`, which skips 1 byte and may corrupt subsequent map/array parsing.

---

## Known Quirks

1. **`success: true` without ack** — All three endpoints return `success: true` after sending the message, even when `ackReceived: false`. The probe considers "TCP connect + message written" as success.

2. **Numeric record values become strings** — Both `/send` and `/bulk` coerce all record values to strings (`String(v)`) before encoding, even though `/bulk`'s TypeScript type accepts `number`. A record `{ count: 42 }` is sent as `{ count: "42" }` in MessagePack.

3. **`readFluentdResponse` early termination** — The function attempts to decode after each chunk. A single byte like `0x00` (positive fixint 0) decodes successfully, causing early return before the full ack map arrives. This could happen if the server sends data in tiny fragments.

4. **Chunk ID: `Math.random()`** — Generated via `Math.random()` character selection from `[a-z0-9]`, 16 characters. Not cryptographically secure, but adequate for non-security-critical ack correlation.

5. **map 16 dead code** — Line 200: `bytesRead: 3 + result.bytesRead - 0` — the `- 0` is a no-op leftover.

6. **No method restriction bypass** — All three endpoints explicitly check for POST and return 405. Unlike some other protocol workers, there is no GET fallback.

---

## Limitations

- **No TLS** — Plain TCP only. Servers requiring `transport tls` in `<source>` will reject the connection.
- **No shared-key auth** — Servers with `<security>` / `shared_key` configuration will reject messages after the HELO/PING handshake, which this implementation doesn't perform.
- **No CompressedPackedForward** — The protocol spec allows gzip-compressed entry blobs; not implemented.
- **No EventTime (ext type)** — Forward Protocol v1 supports nanosecond timestamps via ext type 0x00; this implementation uses uint32 Unix seconds only.
- **No heartbeat** — No keepalive or heartbeat mechanism; each request opens a fresh TCP connection.
- **No Cloudflare detection gap** — Detection applies to the target `host` only. If Fluentd is behind a TCP load balancer at a different hostname, the check may produce false negatives or positives.
- **bin16 overflow** — `/bulk` entries blob > 65535 bytes silently corrupts the message (no bin32 encoding).

---

## curl Examples

**Probe:**
```bash
curl -X POST https://portofcall.ross.gg/api/fluentd/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"fluentd.example.com","port":24224,"timeout":5000}'
```

**Send single event:**
```bash
curl -X POST https://portofcall.ross.gg/api/fluentd/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"fluentd.example.com","tag":"app.test","record":{"message":"hello","level":"info"}}'
```

**Bulk send:**
```bash
curl -X POST https://portofcall.ross.gg/api/fluentd/bulk \
  -H 'Content-Type: application/json' \
  -d '{"host":"fluentd.example.com","tag":"app.batch","events":[{"record":{"msg":"event1"}},{"record":{"msg":"event2"}}]}'
```

---

## Local Testing

```bash
# Run Fluentd with ack enabled:
docker run -p 24224:24224 -v /tmp/fluentd.conf:/fluentd/etc/fluent.conf:ro fluent/fluentd:v1.16-1

# /tmp/fluentd.conf:
<source>
  @type forward
  port 24224
  <security>
    self_hostname localhost
  </security>
  <transport tcp>
  </transport>
</source>
<match **>
  @type stdout
  <buffer>
    flush_interval 1s
  </buffer>
</match>

# For ack testing, add to <source>:
#   require_ack_response true
```
