# Oracle TNS (`oracle-tns.ts`) — Power User Reference

**Port:** 1521 (default)
**Protocol:** TNS (Transparent Network Substrate) — Oracle proprietary
**Source:** `src/worker/oracle-tns.ts`
**Related:** `src/worker/oracle.ts` (older, simpler implementation — see `docs/protocols/ORACLE.md`)

This document covers the four endpoints exported from `oracle-tns.ts` only. For side-by-side comparison of both oracle files and their wire format differences, see `docs/protocols/ORACLE.md`.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/oracle-tns/connect` | TNS CONNECT handshake — test service accessibility |
| `POST` | `/api/oracle-tns/probe` | Lightweight Oracle listener detection (no service name required) |
| `POST` | `/api/oracle-tns/query` | CONNECT + ANO negotiation — extract version and instance name |
| `POST` | `/api/oracle-tns/sql` | 4-phase: CONNECT + ANO + TTI_LOGON + TTI_QUERY attempt |

All endpoints:
- Open a fresh TCP connection per request
- Check the target host against Cloudflare; return HTTP 403 with `isCloudflare: true` if matched
- Enforce an outer timeout via `Promise.race`
- Return HTTP 200 on structural success (even for REFUSE responses that prove listener presence)
- Return HTTP 500 for connection failures, parse errors, and timeouts

---

## TNS Packet Format

### Header (8 bytes, all big-endian)

```
[0-1] Packet Length  — total packet size including header
[2-3] Checksum       — always 0x0000
[4]   Packet Type    — see type table below
[5]   Reserved       — always 0x00
[6-7] Header Checksum — always 0x0000
```

### Packet Types

| Hex | Decimal | Name | Direction |
|---|---|---|---|
| `0x01` | 1 | CONNECT | Client → Server |
| `0x02` | 2 | ACCEPT | Server → Client |
| `0x04` | 4 | REFUSE | Server → Client |
| `0x05` | 5 | REDIRECT | Server → Client |
| `0x06` | 6 | DATA | Both |
| `0x0B` | 11 | RESEND | Server → Client |
| `0x0C` | 12 | MARKER | Server → Client |

### CONNECT Packet Body (50 bytes at offsets 8–57, then connect data)

```
[8-9]   Version             0x013C = 316 (Oracle 12c+ compatible)
[10-11] Compatible Version  0x012C = 300 (Oracle 10g+ minimum)
[12-13] Service Options     0x0C41
[14-15] SDU Size            0x2000 = 8192 bytes
[16-17] TDU Size            0x7FFF = 32767 bytes
[18-19] NT Protocol Chars   0x7F08
[20-21] Line Turnaround     0x0000
[22-23] Value of 1          0x0001
[24-25] Connect Data Length (2 bytes, big-endian)
[26-27] Connect Data Offset 0x003A = 58 (header 8 + body 50)
[28-31] Max Receivable CD   0x00000000
[32]    Connect Flags 0     0x41
[33]    Connect Flags 1     0x41
[34-57] Reserved zeros      (24 bytes)
[58+]   Connect Data        ASCII descriptor string
```

The connect descriptor string format:

```
(DESCRIPTION=
  (ADDRESS=(PROTOCOL=TCP)(HOST={host})(PORT={port}))
  (CONNECT_DATA=
    (SERVICE_NAME={serviceName})
    (CID=(PROGRAM=portofcall)(HOST=cloudflare-worker)(USER=probe))
  )
)
```

The CID block is included in all four endpoints' CONNECT packets. It identifies the client to the Oracle listener and appears in listener log entries.

### ACCEPT Body (offsets from packet start)

```
[8-9]   Version (negotiated)
[10-11] Compatible version
[12-13] Service options
[14-15] SDU size
[16-17] TDU size
[18-19] NT Protocol Characteristics
[20-21] Line turnaround
[22-23] Value of 1
[24-25] Data offset
[26]    Connect Flags 0
[27]    Connect Flags 1
```

Minimum length to parse all ACCEPT fields: 28 bytes. Code requires `data.length >= 32`.

### REFUSE Body

```
[8]     User reason code     (1 byte)
[9]     System reason code   (1 byte)
[10-11] Refuse data length   (2 bytes, big-endian)
[12+]   Refuse data          ASCII/text descriptor
```

The refuse data typically contains Oracle error descriptors like:
```
(ERROR=(CODE=12514)(EMFI=4))(ERROR_STACK=(ERROR=(CODE=12514)(EMFI=4)(ARGS=(ARG=(VALUE=ORCL)))))
```

Common reason codes:
- User byte `0x22` (34) = "TNS: listener refused connection" (ORA-12514 / ORA-12505 group)
- System byte `0x00` = listener-level refusal (not OS-level)

### REDIRECT Body

```
[8-9]  Redirect data length (2 bytes, big-endian)
[10+]  Redirect data        ASCII address descriptor
```

The redirect data is a connect descriptor pointing to the actual database listener address (VRID listener → dedicated server port).

---

## Internal Helpers

### `buildTNSConnectPacket(host, port, serviceName)`

Constructs the full 58+N byte CONNECT packet using `DataView` (big-endian). Allocates `new Uint8Array(58 + connectDataBytes.length)` — the array is zero-initialized, so the 24-byte reserved block at [34–57] is implicitly zeroed.

### `parseTNSResponse(data)`

Parses header + type-specific body. Returns typed object with optional fields:
- `version`, `compatibleVersion`, `sduSize`, `tduSize`, `connectFlags0`, `connectFlags1` (ACCEPT only)
- `refuseReasonUser`, `refuseReasonSystem`, `refuseData` (REFUSE only)
- `redirectData` (REDIRECT only)
- `rawHex` — first 64 bytes as hex string, always present (useful for debugging unknown packet types)

### `extractOracleVersion(text)`

Tries two patterns in order:
1. `VSNNUM=N` — decodes as `(N>>24).(N>>20 & 0xF).(N>>12 & 0xFF).(N>>8 & 0xF).(N & 0xFF)`. VSNNUM is a packed 32-bit integer in Oracle's internal format. Example: VSNNUM=318767104 = 0x13030000 → `19.3.0.0.0`.
2. `Oracle X.Y.Z` or `version X.Y.Z` pattern (case-insensitive).

VSNNUM is only present in REFUSE and REDIRECT response text, not in ACCEPT bodies.

### `extractErrorCode(text)`

Tries:
1. `(ERR=N)` → formatted as `ORA-N`
2. `ORA-NNNNN` verbatim match

### `readBytes(reader, n)` — FIXED

Reads exactly `n` bytes from the stream, buffering across multiple TCP chunks.

**Bug that was fixed:** The original implementation returned "at least n" bytes — when the OS delivers a full TNS packet in one TCP chunk, `readBytes(reader, 8)` consumed all bytes (e.g. all 50 bytes of an ACCEPT packet), and the subsequent `readBytes(reader, 42)` stalled indefinitely. Fixed by slicing `combined.subarray(0, n)` before returning.

### `doTNSConnect(host, port, serviceName)`

Shared helper used by `/connect` and `/probe`. Sends a CONNECT packet, reads header (8 bytes), reads body (`packetLength - 8` bytes), assembles and parses the full packet. Closes the socket before returning.

---

## `/api/oracle-tns/connect` — Service Connect Test

Tests whether a specific Oracle service name is accessible on the listener.

**Request body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | — | Required |
| `port` | number | `1521` | |
| `serviceName` | string | `"ORCL"` | SERVICE_NAME in the connect descriptor |
| `timeout` | number | `10000` | Outer race timeout (ms) |

**Response fields:**

| Field | Present when | Notes |
|---|---|---|
| `success` | always | `true` regardless of ACCEPT/REFUSE/REDIRECT |
| `accepted` | always | `true` only on ACCEPT |
| `listenerDetected` | REFUSE/REDIRECT/RESEND | `true` — listener is alive even if service rejected |
| `responseType` | always | Packet type name string |
| `tnsVersion` | ACCEPT | Negotiated TNS version number |
| `compatibleVersion` | ACCEPT | |
| `sduSize` | ACCEPT | Session Data Unit size |
| `tduSize` | ACCEPT | Transport Data Unit size |
| `refuseReasonUser` | REFUSE | 1-byte user reason code |
| `refuseReasonSystem` | REFUSE | 1-byte system reason code |
| `refuseData` | REFUSE | Raw refuse descriptor text |
| `oracleVersion` | REFUSE/REDIRECT | Decoded from VSNNUM in refuse/redirect data |
| `errorCode` | REFUSE | `ORA-NNNNN` string |
| `redirectData` | REDIRECT | Redirect address descriptor |
| `rawHeader` | always | First 64 bytes of response as hex string |
| `latencyMs` | always | Wall-clock time from connect to parsed response |

**Key behavior:** Returns `success: true` even on REFUSE. A refused connection proves the listener is alive and responding. Use `accepted` to distinguish actual service connectivity from listener detection.

**ACCEPT example:**
```json
{
  "success": true,
  "accepted": true,
  "responseType": "Accept",
  "tnsVersion": 316,
  "compatibleVersion": 300,
  "sduSize": 8192,
  "tduSize": 65535,
  "latencyMs": 12,
  "message": "Oracle listener accepted connection for service \"ORCL\""
}
```

**REFUSE example (ORA-12514):**
```json
{
  "success": true,
  "accepted": false,
  "listenerDetected": true,
  "responseType": "Refuse",
  "refuseReasonUser": 34,
  "refuseReasonSystem": 0,
  "refuseData": "(ERROR=(CODE=12514)(EMFI=4))",
  "oracleVersion": "19.3.0.0.0",
  "errorCode": "ORA-12514",
  "message": "Oracle listener refused: (ERROR=(CODE=12514)...)"
}
```

---

## `/api/oracle-tns/probe` — Listener Detection

Detects the presence of an Oracle TNS listener without knowing any service name.

**Request body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | — | Required |
| `port` | number | `1521` | |
| `timeout` | number | `10000` | |

**Strategy:** Sends a CONNECT with `SERVICE_NAME=__PROBE__`. Since `__PROBE__` does not exist, the listener responds with REFUSE — which is interpreted as `isOracle: true`. Any of ACCEPT, REFUSE, REDIRECT, or RESEND from the server indicates an Oracle TNS listener.

**Response:**

| Field | Present when | Notes |
|---|---|---|
| `isOracle` | always | `true` if response type is ACCEPT/REFUSE/REDIRECT/RESEND |
| `oracleVersion` | if extractable | From VSNNUM in REFUSE text |
| `responseType` | always | Raw packet type name |
| `latencyMs` | always | |

**Oracle detected (via REFUSE):**
```json
{
  "success": true,
  "isOracle": true,
  "responseType": "Refuse",
  "oracleVersion": "19.3.0.0.0",
  "latencyMs": 8,
  "message": "Oracle TNS listener detected on oracle.example.com:1521 (Oracle 19.3.0.0.0)"
}
```

**Non-Oracle port:**
```json
{
  "success": true,
  "isOracle": false,
  "responseType": "Unknown (0x48)",
  "message": "Non-Oracle response on oracle.example.com:1521 (type: Unknown (0x48))"
}
```

---

## `/api/oracle-tns/query` — CONNECT + ANO Negotiation

Extends the basic CONNECT handshake with an ANO (Advanced Networking Option) negotiation step to extract Oracle version and instance name.

**Request body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | — | Required |
| `port` | number | `1521` | |
| `service` | string | `"XE"` | Note: field name is `service`, not `serviceName` |
| `timeout` | number | `10000` | |

**Field name inconsistency:** This endpoint uses `service` while `/connect` and `/probe` use `serviceName`. Both mean Oracle SERVICE_NAME. This is an implementation inconsistency.

**Protocol flow:**
```
→ TNS CONNECT (SERVICE_NAME={service})
← TNS ACCEPT (or REFUSE/REDIRECT — closes immediately if not ACCEPT)
→ TNS DATA (data_flags=0x0000) + ANO probe payload (40 bytes)
← TNS DATA (ANO response — 3-second timeout)
```

**ANO probe payload (40 bytes):**

```
[0-1]   0x00 0x28  ANO body length (40 bytes)
[2-3]   0x00 0x02  ANO version
[4-5]   0x00 0x00  flags
[6]     0x04       service count (4)
[7]     0x00       reserved
[8-15]  service 0: Authentication  (ID=0x0001, 6 zero bytes)
[16-23] service 1: Encryption      (ID=0x0002, 6 zero bytes)
[24-31] service 2: Data Integrity  (ID=0x0003, 6 zero bytes)
[32-39] service 3: Supervisor      (ID=0x0004, 6 zero bytes)
```

The service capability lists are all empty — this is a minimal probe requesting negotiation without advertising any actual capabilities. Real Oracle clients send full capability vectors per service.

**ANO response parsing:** The DATA packet response is decoded as UTF-8 (with `fatal: false` for binary tolerance). `extractOracleVersion` and an `INSTANCE_NAME` regex are applied to the decoded text. Instance name pattern: `/INSTANCE_NAME[=\x00]([A-Za-z0-9_]+)/i`.

**Response fields:**

| Field | Present when | Notes |
|---|---|---|
| `success` | always | `false` if REFUSE/REDIRECT/unexpected type |
| `responseType` | always | Numeric packet type (not name — inconsistency vs. `/connect`) |
| `responseTypeName` | always | Packet type name string |
| `tnsVersion` | ACCEPT | Negotiated version |
| `sduSize` | ACCEPT | SDU size from ACCEPT body |
| `serviceName` | ACCEPT | Echoes back the `service` field |
| `instanceName` | if in ANO response | From INSTANCE_NAME pattern in server response |
| `dbVersion` | if extractable | From VSNNUM or version pattern in ANO or REFUSE data |
| `refuseReason` | REFUSE | Raw refuse descriptor |
| `redirectTo` | REDIRECT | Redirect address |
| `latencyMs` | always | |

**Field inconsistency:** `responseType` returns the numeric packet type (e.g. `2`), unlike `/connect` which returns the name string (e.g. `"Accept"`).

**ACCEPT + ANO response example:**
```json
{
  "success": true,
  "responseType": 2,
  "responseTypeName": "Accept",
  "tnsVersion": 316,
  "sduSize": 8192,
  "serviceName": "XE",
  "instanceName": "XE",
  "dbVersion": "19.3.0.0.0",
  "latencyMs": 28
}
```

---

## `/api/oracle-tns/sql` — 4-Phase Login + Query Attempt

Stages a full connection attempt: CONNECT → ANO negotiation → TTI_LOGON → TTI_QUERY.

**Request body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | — | Required |
| `port` | number | `1521` | |
| `service` | string | `"XE"` | |
| `username` | string | — | Optional; stops at `negotiate` phase if omitted |
| `password` | string | — | Paired with `username` |
| `query` | string | `"SELECT 1 FROM DUAL"` | SQL to attempt in phase 4 |
| `timeout` | number | `15000` | Outer race timeout |

**Phase progression:**

| Phase label | Condition to advance | Inner timeout |
|---|---|---|
| `"connect"` | ACCEPT received | None (outer timeout applies) |
| `"negotiate"` | ANO DATA sent; response optional | 3000 ms |
| `"login"` | TTI_LOGON DATA sent and DATA received | 5000 ms |
| `"query"` | TTI_QUERY DATA sent and DATA received | 5000 ms |

If `username`/`password` are absent, the endpoint stops at `negotiate` and returns `success: true` with a note.

**TTI_LOGON packet format** (wrapped in TNS DATA, data_flags=0x0000):

```
[0]    0x76          TTI function code (LOGON)
[1]    username_len  length byte (max 255)
[2..] username_bytes
[?]    password_len  length byte (max 255)
[?+1..] password_bytes
[?]    service_len   length byte (max 255)
[?+1..] service_bytes
```

This is a simplified, non-compliant Oracle login packet. Real Oracle 10g+ authentication uses O5LOGON (Diffie-Hellman challenge-response). The server responds to this packet with either a DATA packet (auth challenge or error), a MARKER packet (hard rejection), or an error code. The implementation interprets any TNS_DATA response as a potential `loginAccepted: true` unless an ORA-NNNNN code is detected in the response text.

**TTI_QUERY packet format** (wrapped in TNS DATA):

```
[0]    0x03          TTI function code (QUERY / OSQL3)
[1]    query_len     length byte (max 255)
[2..] query_bytes
```

This is also simplified. A real Oracle TTC QUERY packet includes cursor IDs, fetch sizes, define descriptors, and protocol version fields. The response will be binary TTC data that is returned as raw decoded UTF-8 text (null bytes stripped, limited to 512 chars).

**Response fields:**

| Field | Present when | Notes |
|---|---|---|
| `success` | always | `true` only if query phase succeeds |
| `phase` | always | Highest phase reached |
| `tnsVersion` | after connect | |
| `sduSize` | after connect | |
| `dbVersion` | if extractable | From ANO negotiation response |
| `loginAccepted` | after login attempt | `true` if server returned DATA with no detectable ORA error |
| `queryResult` | after query attempt | Raw text, max 512 chars |
| `errorCode` | on REFUSE | ORA-NNNNN string |
| `errorMessage` | on error | Description |
| `latencyMs` | always | Total elapsed time |

**Login accepted vs. actual authentication:** `loginAccepted: true` is set when the server returns a TNS_DATA packet with no ORA-NNNNN error code detectable as plain text. Oracle O5LOGON sends a challenge-response in DATA; the minimal TTI_LOGON packet triggers the server to send back an auth challenge DATA packet. Since no ORA error code is in an auth challenge, the code incorrectly marks `loginAccepted: true` even though authentication has not completed — the server is actually asking for the DH response. The login phase will almost never reach actual success.

**Query phase:** Even if `loginAccepted: true`, the TTI_QUERY packet is not a valid Oracle cursor execution request. The server will likely return an error DATA packet or close the connection.

---

## Wire Exchange Diagrams

### `/probe` — listener detection via bogus service

```
Client                            Oracle Listener (:1521)
  |                                        |
  |--[TCP SYN]--------------------------->|
  |<-[TCP SYN-ACK]------------------------|
  |--[TCP ACK]--------------------------->|
  |                                        |
  |--[TNS CONNECT]----------------------->|  SERVICE_NAME=__PROBE__
  |<-[TNS REFUSE]-------------------------|  code=12514 (unknown service)
  |                                        |
  => isOracle: true, oracleVersion from VSNNUM in refuse text
```

### `/connect` — service exists

```
  |--[TNS CONNECT]----------------------->|  SERVICE_NAME=ORCL
  |<-[TNS ACCEPT]--------------------------|
  => accepted: true, tnsVersion, sduSize, tduSize
```

### `/query` — ANO negotiation

```
  |--[TNS CONNECT]----------------------->|  SERVICE_NAME=XE
  |<-[TNS ACCEPT]--------------------------|
  |--[TNS DATA: ANO probe (40 bytes)]---->|  4 service slots, no capabilities
  |<-[TNS DATA: ANO response]-------------|  (3s timeout)
  => dbVersion from VSNNUM in ANO response, instanceName if present
```

### `/sql` — 4-phase attempt (no real credentials)

```
  |--[TNS CONNECT]----------------------->|
  |<-[TNS ACCEPT]--------------------------|
  |--[TNS DATA: ANO probe]--------------->|
  |<-[TNS DATA: ANO response]-------------|  (3s timeout, optional)
  |--[TNS DATA: TTI_LOGON 0x76]---------->|  plaintext user+pass+service
  |<-[TNS DATA: O5LOGON challenge]--------|  (5s timeout) — DH auth request
  |--[TNS DATA: TTI_QUERY 0x03]---------->|  raw SQL text
  |<-[TNS DATA: TTC error response]-------|  (5s timeout)
```

---

## Common Oracle Error Codes in REFUSE Responses

| ORA Code | Numeric | Meaning |
|---|---|---|
| ORA-12514 | 12514 | Listener does not know the SERVICE_NAME |
| ORA-12505 | 12505 | Listener does not know the SID |
| ORA-12541 | 12541 | No listener (port closed or listener not running) |
| ORA-12154 | 12154 | Could not resolve connect identifier |
| ORA-12560 | 12560 | Protocol adapter error |
| ORA-1017 | 1017 | Invalid username/password |
| ORA-28000 | 28000 | Account is locked |

---

## Bugs Found and Fixed

### Bug 1 — Critical: `readBytes` delivered "at least n" bytes, breaking two-step read

**Location:** `readBytes()` function, lines 196–214 (pre-fix)

**Root cause:** The function accumulated chunks until `totalRead >= n` but returned the combined buffer without slicing. When the OS delivers an entire TNS packet in one TCP chunk (common for small packets like REFUSE responses), `readBytes(reader, 8)` consumed all 20–50+ bytes. The subsequent `readBytes(reader, packetLength - 8)` then blocked indefinitely waiting for bytes that had already been consumed.

**Impact:** In practice, most Oracle REFUSE and ACCEPT responses fit in a single TCP chunk (typically under 200 bytes). Any such response would cause `doTNSConnect`, `handleOracleQuery`, and `handleOracleSQLQuery` to hang until their timeout fired (10–15 seconds). The endpoint would always time out on fast Oracle servers — the handlers only succeed when the server's response is fragmented across multiple TCP segments.

**Fix:** Added `combined.subarray(0, n)` before return. The loop now serves as a buffer accumulator, and the return is always exactly `n` bytes.

### Bug 2 — Protocol violation: ANO payload length field incorrect in `handleOracleQuery`

**Location:** `handleOracleQuery`, ANO `anoPayload` array, line 588 (pre-fix)

**Root cause:** The first two bytes of the ANO body declare the ANO body's total length. The payload array contains 40 bytes (8-byte ANO header + 4 × 8-byte service entries). The length field was set to `0x00, 0xDE` (222), which is larger than the actual payload. An Oracle server that validates the ANO length field would either reject the packet or read 222 bytes when only 40 are available, potentially consuming bytes from the next TNS message.

**Fix:** Changed to `0x00, 0x28` (40), matching the actual payload size.

### Bug 3 — Protocol violation: Same ANO length bug in `handleOracleSQLQuery`

**Location:** `handleOracleSQLQuery`, Phase 2 ANO negotiation, line 808 (pre-fix)

**Root cause:** Same as Bug 2 — the ANO payload is 40 bytes but the length field declared 222.

**Fix:** Changed `0x00, 0xDE` to `0x00, 0x28` in the SQL handler's anoPayload array.

---

## Known Limitations

### No socket resource cleanup on timeout

When the outer `Promise.race` timeout fires, the connection IIFE continues running in the background until its own I/O operations fail or time out. The socket is not closed from the timeout branch — only the response is discarded. Cloudflare Workers' socket lifetime is tied to the request lifetime, so the socket is eventually garbage-collected, but it may briefly hold resources.

### ANO negotiation is not spec-compliant

The 40-byte ANO probe sends empty capability lists for each service. A real Oracle client sends per-service capability arrays (encryption algorithm lists, integrity algorithm lists, etc.). Some Oracle configurations may ignore the probe or respond with minimal data. The 3-second ANO response timeout means the endpoint returns partial data if the server is slow.

### TTI_LOGON is not a valid Oracle authentication packet

Real Oracle authentication (10g+) uses O5LOGON: a Diffie-Hellman key exchange with AUTH_SESSKEY, AUTH_PASSWORD (encrypted), and AUTH_VFR_DATA. The simplified `0x76` packet may elicit a challenge packet (misread as `loginAccepted: true`), a TNS_MARKER rejection, or an ORA-1017 error. Actual database access via this endpoint is not achievable.

### `loginAccepted: true` does not mean authentication succeeded

The login phase marks `loginAccepted: true` when the server returns any TNS_DATA packet without a detectable ORA error code. Oracle's O5LOGON auth challenge arrives as a DATA packet with no ORA code — so the endpoint incorrectly reports `loginAccepted: true` even though the server is asking for DH key exchange.

### `queryResult` is binary TTC data, not SQL results

If the query phase runs, the server response is raw TTC binary with null bytes stripped, limited to 512 characters. It will not be readable as query results.

### Instance name regex matches binary data

The pattern `/INSTANCE_NAME[=\x00]([A-Za-z0-9_]+)/i` matches the literal byte `0x00` as a field separator. In practice, Oracle ANO responses may include binary data where this pattern accidentally matches non-name bytes.

### `service` vs `serviceName` inconsistency

`/query` and `/sql` use `service` in the request body. `/connect` uses `serviceName`. Both refer to the Oracle SERVICE_NAME. There is no validation that catches passing `serviceName` to `/query` — the endpoint silently uses the default `"XE"`.

### No port validation

`/connect` and `/probe` perform no validation on the `port` field. Values outside 1–65535 will be passed directly to `connect()`, which may throw or silently clamp the value. Compare with `oracle.ts:handleOracleTNSServices` which validates `1 <= port <= 65535`.

### Single-chunk ANO response read

After sending the ANO DATA packet, only one `reader.read()` call is made (with a 3-second timeout). If the ANO response arrives in multiple TCP chunks, only the first chunk is decoded, and version/instance extraction may fail even if the data is present in later chunks.

---

## curl Examples

```bash
# Probe: detect Oracle listener without knowing service name
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com"}' | jq '{isOracle,oracleVersion,latencyMs}'

# Connect: test specific service name (defaults to ORCL)
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","serviceName":"XEPDB1"}' \
  | jq '{accepted,tnsVersion,sduSize,tduSize,errorCode}'

# Query: extract version and instance via ANO negotiation
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","service":"ORCL"}' \
  | jq '{tnsVersion,sduSize,serviceName,instanceName,dbVersion}'

# SQL: probe login (likely fails at login with ORA-1017 or challenge)
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/sql \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","service":"ORCL","username":"system","password":"oracle"}' \
  | jq '{phase,loginAccepted,dbVersion,errorMessage}'

# SQL: stop at negotiate phase (no credentials)
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/sql \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","service":"XE"}' \
  | jq '{phase,tnsVersion,dbVersion,note}'

# Custom port
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","port":1522}' | jq .
```

---

## Local Test Setup

**Oracle XE 21c via Docker (free):**

```bash
docker run -d \
  --name oracle-xe \
  -p 1521:1521 \
  -e ORACLE_PWD=OracleXE21 \
  gvenzl/oracle-xe:21-slim

# Wait ~90 seconds for startup
docker logs -f oracle-xe | grep "DATABASE IS READY"
# Service name: XEPDB1 (pluggable), SID: XE (root container)
```

**Smoke test:**
```bash
# Probe (should detect listener immediately)
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_LOCAL_IP","port":1521}' | jq '{isOracle,oracleVersion}'

# Query the PDB (XEPDB1)
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_LOCAL_IP","service":"XEPDB1"}' | jq .
```
