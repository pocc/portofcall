# NTP — Network Time Protocol

**Port:** 123 (UDP standard; this implementation uses TCP via Cloudflare Workers sockets)
**RFC:** 5905 (NTPv4)
**Implementation:** `src/worker/ntp.ts`
**Endpoints:** 3 (`/query`, `/sync`, `/poll`)

## Endpoints

### POST /api/ntp/query

Single NTP query. Sends a client-mode NTPv4 packet over TCP, parses the server response, and returns clock offset/delay.

**Request:**

```json
{
  "host": "time.cloudflare.com",
  "port": 123,
  "timeout": 10000
}
```

| Field     | Type   | Default | Required | Notes |
|-----------|--------|---------|----------|-------|
| `host`    | string | —       | yes      | NTP server hostname or IP |
| `port`    | number | `123`   | no       | Validated: 1–65535 |
| `timeout` | number | `10000` | no       | Milliseconds. Covers entire operation (connect + send + receive) |

**Response (success):**

```json
{
  "success": true,
  "time": "2026-02-17T12:34:56.789Z",
  "offset": -15,
  "delay": 8,
  "stratum": 2,
  "precision": -20,
  "referenceId": "192.168.1.1",
  "rootDelay": 12.5,
  "rootDispersion": 6.8,
  "leapIndicator": "no warning"
}
```

| Field             | Type   | Notes |
|-------------------|--------|-------|
| `time`            | string | ISO 8601 UTC. Computed as `t4 + offset` (client receive time adjusted by clock offset) |
| `offset`          | number | Clock offset in whole milliseconds (`Math.round`). Negative = your clock is ahead |
| `delay`           | number | Round-trip delay in whole milliseconds (`Math.round`) |
| `stratum`         | number | 0=unspecified, 1=primary (GPS/atom), 2–15=secondary, 16=unsynchronized |
| `precision`       | number | Server clock precision as signed log2 seconds (e.g. -20 = ~1 us) |
| `referenceId`     | string | Stratum 0–1: ASCII code ("GPS", "ATOM", "PPS"). Stratum 2+: IPv4 dotted-quad (see quirk below) |
| `rootDelay`       | number | Total delay to primary source in ms, rounded to 2 decimal places |
| `rootDispersion`  | number | Total dispersion to primary source in ms, rounded to 2 decimal places |
| `leapIndicator`   | string | One of: `"no warning"`, `"61 seconds"`, `"59 seconds"`, `"alarm (clock unsynchronized)"` |

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | `host` missing, or `port` out of 1–65535 range |
| 403  | Cloudflare detection triggered (`isCloudflare: true`) |
| 500  | Connection timeout, truncated packet, wrong NTP mode, or other failure |

---

### POST /api/ntp/sync

Dead alias — calls `handleNTPQuery(request)` directly and returns the identical response. No additional logic, no multi-server averaging, no different behavior. Exists as a route placeholder.

---

### POST /api/ntp/poll

Multi-sample NTP query with statistics. Opens a new TCP connection per sample, waits `intervalMs` between samples, and computes offset/RTT statistics.

**Request:**

```json
{
  "host": "time.cloudflare.com",
  "port": 123,
  "count": 4,
  "intervalMs": 1000,
  "timeout": 10000
}
```

| Field        | Type   | Default | Range     | Notes |
|--------------|--------|---------|-----------|-------|
| `host`       | string | —       | —         | Required |
| `port`       | number | `123`   | —         | **No range validation** (unlike /query) |
| `count`      | number | `4`     | 1–10      | Clamped with `Math.min(Math.max(...))` |
| `intervalMs` | number | `1000`  | 100–5000  | Clamped. Delay between samples |
| `timeout`    | number | `10000` | —         | Per-sample timeout. Also 5s hard deadline on reads |

**Response (success):**

```json
{
  "success": true,
  "host": "time.cloudflare.com",
  "port": 123,
  "count": 4,
  "requested": 4,
  "intervalMs": 1000,
  "offsetMs": {
    "min": -18,
    "max": -12,
    "avg": -15.25,
    "jitter": 2.17
  },
  "rttMs": {
    "min": 6,
    "max": 11,
    "avg": 8.5
  },
  "samples": [
    { "offset": -15, "rtt": 8, "stratum": 2, "timestamp": "2026-02-17T12:34:56.789Z" }
  ],
  "errors": ["Sample 3: Timeout"],
  "message": "3/4 samples: avg offset -15.25ms, jitter 2.17ms"
}
```

| Field             | Notes |
|-------------------|-------|
| `count`           | Number of successful samples |
| `requested`       | Number of samples requested |
| `offsetMs.jitter` | Population standard deviation of offsets (sqrt of variance) |
| `samples[].timestamp` | `new Date().toISOString()` captured after parse — is t4-ish, not server time |
| `errors`          | Present only if any samples failed. Partial success is possible |
| `message`         | Human-readable summary string |

**If all samples fail:** returns HTTP 500 with `success: false` and `errors` array.

---

## Wire Protocol

### Request Packet (48 bytes)

Built by `createNTPRequest()`:

| Byte(s) | Field | Value |
|---------|-------|-------|
| 0       | LI=0, VN=4, Mode=3 (client) | `0x23` |
| 1       | Stratum | `0` (unspecified) |
| 2       | Poll interval | `6` (2^6 = 64s) |
| 3       | Precision | `0xFA` (-6, ~15ms) |
| 4–7     | Root Delay | `0` |
| 8–11    | Root Dispersion | `0` |
| 12–15   | Reference Identifier | `0` |
| 16–23   | Reference Timestamp | `0` |
| 24–31   | Origin Timestamp | `0` |
| 32–39   | Receive Timestamp | `0` |
| 40–47   | Transmit Timestamp | Current time as NTP timestamp (see t1 gap quirk) |

### Response Parsing

Strict mode 4 (SERVER) check — any other mode throws `"Invalid NTP mode"`.

**Timestamp math:**
- `t1` = `Date.now()` captured right before `socket.opened` (not from the packet's Transmit Timestamp)
- `t2` = server Receive Timestamp (bytes 32–39)
- `t3` = server Transmit Timestamp (bytes 40–47)
- `t4` = `Date.now()` captured after `reader.read()` returns

```
offset = ((t2 - t1) + (t3 - t4)) / 2
delay  = (t4 - t1) - (t3 - t2)
time   = t4 + offset
```

**NTP timestamp conversion:** 32 bits seconds (since 1900-01-01) + 32 bits fraction. Converted to Unix ms: `(seconds - 2208988800) * 1000 + floor(fraction / 2^32 * 1000)`. Sub-millisecond precision lost.

**Root Delay/Dispersion:** Read as unsigned 16.16 fixed-point, divided by 65536, multiplied by 1000 for ms.

---

## Known Bugs and Quirks

### 1. Single-read fragmentation bug in /query

`handleNTPQuery` does exactly one `reader.read()` (line ~316) and passes the result directly to `parseNTPResponse`. If TCP delivers the 48-byte response across multiple chunks (which is legal and does happen), the parse will either fail with "too short" or silently parse a truncated packet.

**Workaround:** Use `/api/ntp/poll` with `count: 1` — it correctly accumulates chunks until 48 bytes are received.

`handleNTPPoll` has a proper multi-chunk read loop with a deadline.

### 2. t1 timing gap

`createNTPRequest()` calls `Date.now()` internally to write the Transmit Timestamp into the packet. Then `t1 = Date.now()` is captured separately, after `createNTPRequest()` returns. These two calls are microseconds apart but are different values. The server echoes back the packet's Transmit Timestamp as its Origin Timestamp, but the offset calculation uses the separately-captured `t1`, not the value in the packet.

Impact: negligible for ms-level accuracy, but a protocol purist would note this makes the Origin Timestamp validation impossible (which is why it's commented out at line ~210).

### 3. /sync is a dead alias

`handleNTPSync` literally returns `handleNTPQuery(request)`. No multi-server logic, no different response shape. Use `/query` or `/poll` instead.

### 4. referenceId always displayed as IPv4 for stratum >= 2

For stratum 2+, the 4-byte Reference Identifier is always formatted as `x.x.x.x`. Per RFC 5905, when the server's upstream peer is an IPv6 address, this field contains the first 4 bytes of the MD5 hash of that IPv6 address — not a real IPv4 address. The displayed "IP" will be meaningless in that case.

### 5. Kiss-o'-Death (KoD) packets not flagged

If an NTP server is rate-limiting or rejecting a client, it responds with stratum=0 and an ASCII code in the Reference Identifier (e.g. "DENY", "RSTR", "RATE"). This implementation will return `stratum: 0` and `referenceId: "DENY"` without flagging it as a KoD. The caller must check for `stratum === 0` and interpret the `referenceId` accordingly.

Common KoD codes: DENY (access denied), RSTR (rate limited), RATE (poll too fast), INIT (association not yet initialized).

### 6. Origin Timestamp not validated

RFC 5905 §8 says the client should verify that the server's Origin Timestamp matches the client's Transmit Timestamp (to detect misdirected or replayed responses). This check is not performed. A response from a different request would be silently accepted.

### 7. No port validation in /poll

`handleNTPQuery` rejects port values outside 1–65535, but `handleNTPPoll` does not validate port at all. A port of 0 or 99999 is passed directly to `connect()`.

### 8. NTP version not returned

The response version number is parsed (`(byte0 >>> 3) & 0x7`) but discarded. If the server responds with NTPv3 instead of NTPv4, there's no way for the caller to know from the response. The version check would also be useful for diagnosing compatibility issues.

### 9. Strict mode 4 check

The parser rejects any response with mode != 4 (SERVER). Some NTP implementations respond with mode 2 (SYMMETRIC_PASSIVE) to client queries. These would produce an error.

### 10. Precision resolution loss

Both `offset` and `delay` are `Math.round()`'d to whole milliseconds. For comparing high-quality NTP servers where the offset difference is sub-millisecond, the response always shows integers.

---

## Timeout Architecture

| Endpoint | Default | Scope |
|----------|---------|-------|
| `/query` | 10000ms | Single `setTimeout` race covers connect + send + read |
| `/sync`  | 10000ms | (alias for /query) |
| `/poll`  | 10000ms per sample | Also 5000ms hard deadline on read loop (`Math.min(timeout, 5000)`) |

For `/poll`, the total wall-clock time is approximately `count * (timeout + intervalMs)` in the worst case (all samples failing at timeout). With defaults: 4 * (10000 + 1000) = 44 seconds max.

---

## Cloudflare Detection

All three endpoints (`/query`, `/sync`, `/poll`) call `checkIfCloudflare(host)` before connecting. Returns HTTP 403 with `isCloudflare: true` if the NTP server hostname resolves to a Cloudflare IP.

---

## curl Examples

```bash
# Basic time query
curl -s -X POST https://portofcall.ross.gg/api/ntp/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"time.cloudflare.com"}' | jq .

# Multi-sample poll (8 samples, 500ms apart)
curl -s -X POST https://portofcall.ross.gg/api/ntp/poll \
  -H 'Content-Type: application/json' \
  -d '{"host":"time.google.com","count":8,"intervalMs":500}' | jq .

# Quick single-sample via poll (avoids single-read fragmentation bug)
curl -s -X POST https://portofcall.ross.gg/api/ntp/poll \
  -H 'Content-Type: application/json' \
  -d '{"host":"time.cloudflare.com","count":1}' | jq .

# Custom port with short timeout
curl -s -X POST https://portofcall.ross.gg/api/ntp/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"time.nist.gov","port":123,"timeout":5000}' | jq .
```

---

## Limitations

- **TCP only** — NTP is traditionally UDP; some servers may not accept TCP on port 123 (most modern ones do, including Cloudflare, Google, and NIST)
- **No authentication** — no symmetric key (MD5/SHA1), no Autokey, no NTS (RFC 8915)
- **No KoD handling** — rate-limiting responses not flagged (see quirk #5)
- **No server mode** — client queries only
- **No broadcast/multicast** — not applicable over TCP
- **Millisecond resolution** — sub-ms precision lost in JS `Date.now()` and `Math.round()`
- **POST only** — all endpoints require POST with JSON body; no GET support
- **NTPv4 only** — always sends version 4; NTPv3 responses may work if server responds with mode 4
