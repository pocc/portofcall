# Time -- Power User Reference

**Port:** 37/tcp (RFC 868) | any port works
**Source:** `src/worker/time.ts`

One endpoint. No persistent state. Server sends 4 bytes and closes.

---

## Endpoint

### `POST /api/time/get` -- Query time server

Connects to a remote Time protocol server (RFC 868), reads the 4-byte binary timestamp, and converts it to multiple formats for comparison with local time.

**Request (JSON body -- POST only):**

| Field | Default | Notes |
|---|---|---|
| `host` | -- | Required |
| `port` | `37` | Standard Time protocol port |
| `timeout` | `10000` | Wall-clock timeout in ms |

**Success (200):**

```json
{
  "success": true,
  "raw": 3976214400,
  "unixTimestamp": 1767225600,
  "date": "2026-01-01T00:00:00.000Z",
  "localTime": "2026-01-01T00:00:00.123Z",
  "localTimestamp": 1767225600123,
  "offsetMs": -62
}
```

**Failure (400 validation / 403 Cloudflare / 500 connection error):**

```json
{
  "success": false,
  "error": "Host is required"
}
```

**Key fields:**

| Field | Notes |
|---|---|
| `raw` | Raw 32-bit value from server (seconds since 1900-01-01 00:00:00 UTC) |
| `unixTimestamp` | `raw - 2208988800` (converted to Unix epoch) |
| `date` | ISO 8601 string of the remote server time |
| `localTime` | ISO 8601 string of local time when response received |
| `localTimestamp` | Local time as Unix milliseconds |
| `offsetMs` | Estimated clock offset in ms (accounts for network round-trip / 2) |

**Validation errors (HTTP 400):**
- Missing or empty `host` -> `"Host is required"`
- Port outside 1-65535 -> `"Port must be between 1 and 65535"`

**Cloudflare detection (HTTP 403):**
- Calls `checkIfCloudflare(host)` before connecting
- Returns `{ success: false, error: "...", isCloudflare: true }` if target is behind Cloudflare

---

## Wire Exchange

```
-> (TCP connect to host:port)
<- [4 bytes: 32-bit big-endian unsigned integer]
<- FIN (server closes)
```

RFC 868 defines no handshake and no client data. The server sends exactly 4 bytes representing the number of seconds since 1900-01-01 00:00:00 UTC, then closes the connection.

---

## RFC 868 Compliance

RFC 868 is extremely short. The specification:

> When used via TCP the time service works as follows: the server listens for a connection on port 37. When the connection is established, the server returns a 32-bit time value and closes the connection.

### Epoch

The Time Protocol uses **January 1, 1900 00:00:00 UTC** as its epoch. To convert to Unix time (epoch 1970-01-01), subtract the constant `2208988800` (70 years in seconds).

### 2036 Rollover

The 32-bit unsigned integer overflows on **February 7, 2036 06:28:16 UTC**. After that point, values wrap to 0. This implementation does not attempt to handle the rollover.

---

## Implementation Notes

### Offset calculation

The handler records `localTimeBefore` and `localTimeAfter` timestamps around the TCP read. Network delay is estimated as `(localTimeAfter - localTimeBefore) / 2`. The offset is then `remoteTime - (localTimeAfter - networkDelay)`.

### Exactly 4 bytes required

If the server sends fewer than 4 bytes, the handler throws `"Invalid response: expected 4 bytes"`. The 4 bytes are parsed as a big-endian unsigned 32-bit integer via `DataView`.

---

## curl Examples

```bash
# Query a Time protocol server
curl -s -X POST https://l4.fyi/api/time/get \
  -H 'Content-Type: application/json' \
  -d '{"host":"time.nist.gov"}' | jq .

# Custom port
curl -s -X POST https://l4.fyi/api/time/get \
  -H 'Content-Type: application/json' \
  -d '{"host":"myserver.example.com","port":37,"timeout":5000}' | jq .
```

---

## Known Limitations

- **No UDP** -- Cloudflare Workers only support TCP sockets; the UDP variant of RFC 868 is not testable
- **2036 rollover** -- 32-bit timestamp overflows on 2036-02-07; no workaround attempted
- **Single read** -- Expects all 4 bytes in one TCP segment (standard behavior for Time servers)
- **Cloudflare detection** -- Blocks connections to Cloudflare-protected hosts (returns HTTP 403)

---

## Relationship to Other Simple Services

| Protocol | RFC | Port | Behavior |
|---|---|---|---|
| Echo | 862 | 7 | Echoes data back |
| Discard | 863 | 9 | Discards data silently |
| Chargen | 864 | 19 | Generates character stream |
| QOTD | 865 | 17 | Returns a quote |
| Daytime | 867 | 13 | Returns human-readable time |
| **Time** | **868** | **37** | **Returns 32-bit binary time** |

Time is the binary counterpart to Daytime (which returns human-readable text). Both serve time synchronization but Time is machine-parseable.
