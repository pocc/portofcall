# Oracle TNS — Power User Reference

**Port:** 1521 (default)
**Protocol:** TNS (Transparent Network Substrate) — Oracle proprietary
**Spec:** Unofficial reverse-engineering; see O'Reilly *Oracle Hacker's Handbook*
**Tests:** 13/13 ✅ Deployed
**Source:** `src/worker/oracle.ts` · `src/worker/oracle-tns.ts`

Six endpoints across two route families (`/api/oracle/` and `/api/oracle-tns/`). Both families implement the same TNS wire protocol but differ in CONNECT packet layout, service discovery behavior, and response fields. Every call opens a fresh TCP connection.

---

## Route Map

| Method | Path | Source | Flow |
|---|---|---|---|
| `GET\|POST` | `/api/oracle/connect` | `oracle.ts` | TNS CONNECT → parse ACCEPT/REFUSE/REDIRECT |
| `POST` | `/api/oracle/services` | `oracle.ts` | TNS CONNECT → STATUS command → parse listener response |
| `POST` | `/api/oracle-tns/connect` | `oracle-tns.ts` | TNS CONNECT (full body) → parse ACCEPT/REFUSE/REDIRECT/RESEND |
| `POST` | `/api/oracle-tns/probe` | `oracle-tns.ts` | TNS CONNECT with bogus service → detect Oracle presence |
| `POST` | `/api/oracle-tns/query` | `oracle-tns.ts` | TNS CONNECT → ANO negotiation → version/instance info |
| `POST` | `/api/oracle-tns/sql` | `oracle-tns.ts` | TNS CONNECT → ANO → minimal TTI_LOGON → TTI_QUERY |

---

## TNS Wire Format

### Packet header (8 bytes, all big-endian)

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 2 | Packet length | Total including header |
| 2 | 2 | Checksum | Always 0x0000 |
| 4 | 1 | Packet type | See table below |
| 5 | 1 | Reserved/flags | Always 0x00 |
| 6 | 2 | Header checksum | Always 0x0000 |

### Packet types

| Type | Hex | Name |
|---|---|---|
| 1 | `0x01` | CONNECT |
| 2 | `0x02` | ACCEPT |
| 4 | `0x04` | REFUSE |
| 5 | `0x05` | REDIRECT |
| 6 | `0x06` | DATA |
| 7 | `0x07` | NULL |
| 9 | `0x09` | ABORT |
| 11 | `0x0B` | RESEND |
| 12 | `0x0C` | MARKER |
| 13 | `0x0D` | ATTENTION |
| 14 | `0x0E` | CONTROL |

### CONNECT packet body

**oracle.ts** sends a 26-byte body (simpler):

```
Header (8) + body (26 bytes) + Connect Data (variable)
```

Fields (all big-endian):
- +0: Version 0x013A (TNS 314)
- +2: VersionCompatible 0x013A
- +4: ServiceOptions 0x0C41
- +6: SDU size 0x2000 (8192)
- +8: MTU size 0x7FFF (32767)
- +10: NT Protocol Characteristics 0x7F08
- +12: Line turnaround 0x0000
- +14: Value of 1 0x0001
- +16: Connect Data Length (2 bytes)
- +18: Connect Data (variable)

**oracle-tns.ts** sends a 50-byte body (fuller, more spec-compliant):

Same fields as above at the same offsets plus:
- +18: Connect Data Offset (2 bytes) = 58 (header 8 + body 50)
- +20: Max Receivable CD (4 bytes) = 0
- +24: Connect Flags 0 = 0x41
- +25: Connect Flags 1 = 0x41
- +26..+49: Reserved zeros (24 bytes)

Also: TNS version is 316 (0x013C) and VersionCompatible 300 (0x012C) in oracle-tns.ts vs 314 (0x013A) in oracle.ts.

### Connect descriptor string

```
(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST={host})(PORT={port}))(CONNECT_DATA=(SERVICE_NAME={sn})))
```

SID variant (oracle.ts only):
```
(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST={host})(PORT={port}))(CONNECT_DATA=(SID={sid})))
```

oracle-tns.ts always uses SERVICE_NAME and appends a CID block:
```
(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=…)(PORT=…))(CONNECT_DATA=(SERVICE_NAME=…)(CID=(PROGRAM=portofcall)(HOST=cloudflare-worker)(USER=probe))))
```

### ACCEPT body (starting at offset 8)

| Offset | Size | Field |
|---|---|---|
| +0 | 2 | Protocol version (negotiated) |
| +2 | 2 | Compatible version |
| +4 | 2 | Service options |
| +6 | 2 | SDU size |
| +8 | 2 | TDU size (oracle-tns.ts only) |
| +18 | 1 | Connect Flags 0 (oracle-tns.ts only) |
| +19 | 1 | Connect Flags 1 (oracle-tns.ts only) |

### REFUSE body

**oracle.ts** parsing:
- +8: Refuse code (1 byte)
- +9: Refuse data length (2 bytes, big-endian)
- +11: Refuse data text

**oracle-tns.ts** parsing:
- +8: Refuse reason user (1 byte)
- +9: Refuse reason system (1 byte)
- +10: Refuse data length (2 bytes, big-endian)
- +12: Refuse data text

The two parsers extract the same text but split the reason byte differently.

### REDIRECT body (oracle-tns.ts)
- +8: Redirect data length (2 bytes)
- +10: Redirect data (ASCII address string)

---

## `/api/oracle/connect` — Basic TNS connect (GET|POST)

**oracle.ts.** Requires `serviceName` or `sid`. Does NOT default either — omitting both returns HTTP 400.

**Fields:**

| Field | Default | Required | Notes |
|---|---|---|---|
| `host` | — | ✅ | |
| `port` | `1521` | | No range validation |
| `serviceName` | — | ✅ (or `sid`) | Modern Oracle 8i+ |
| `sid` | — | ✅ (or `serviceName`) | Legacy; `sid` wins if both supplied |
| `timeout` | `30000` | | Outer race timeout (ms) |

**Success (ACCEPT):**
```json
{
  "success": true,
  "message": "Oracle TNS connection accepted",
  "host": "oracle.example.com",
  "port": 1521,
  "serviceName": "ORCL",
  "packetType": "ACCEPT",
  "protocol": {
    "version": "0x13a",
    "sduSize": 8192,
    "serviceOptions": "0xc41"
  },
  "note": "TNS handshake successful. Connection accepted by Oracle listener."
}
```

**Failure (REFUSE):**
```json
{
  "success": false,
  "error": "Oracle TNS connection refused: (ERR=12514)(ERROR_STACK=(ERROR=(CODE=12514)...))",
  "host": "oracle.example.com",
  "port": 1521,
  "packetType": "REFUSE",
  "refuseCode": 1,
  "refuseReason": "(ERR=12514)(ERROR_STACK=...)"
}
```

**REDIRECT (success: false):**
```json
{
  "success": false,
  "error": "Oracle TNS connection redirected. Follow redirect manually.",
  "packetType": "REDIRECT",
  "note": "The listener redirected the connection to another address."
}
```

**Notes:**
- Returns HTTP 500 when `success` is false
- `protocol.version` is the hex string of the 2-byte version field from the ACCEPT body
- Inner read: single `reader.read()` call — no retry or buffer accumulation; if the server sends multiple TCP chunks, only the first is received
- GET form: `?host=&port=&serviceName=&sid=&timeout=`

---

## `/api/oracle/services` — Listener status query (POST)

**oracle.ts.** Sends a TNS CONNECT to service name 'LISTENER', then regardless of the response (ACCEPT or REFUSE), sends a TNS DATA packet with `(CONNECT_DATA=(COMMAND=STATUS))`. The listener replies with a text-based descriptor listing its services, endpoints, and version.

**Fields:**

| Field | Default | Required | Notes |
|---|---|---|---|
| `host` | — | ✅ | |
| `port` | `1521` | | Validated: must be 1–65535 |
| `timeout` | `15000` | | Outer timeout; inner read deadline = min(timeout, 8000) ms |

**Success:**
```json
{
  "success": true,
  "host": "oracle.example.com",
  "port": 1521,
  "listenerVersion": "19.3.0.0.0",
  "services": [
    { "serviceName": "ORCL", "instanceName": "orcl1", "status": "READY" },
    { "serviceName": "ORCLPDB", "instanceName": "orcl1", "status": "READY" }
  ],
  "endpoints": ["oracle.example.com:1521"],
  "rawResponse": "(DESCRIPTION_LIST=(DESCRIPTION=...",
  "rtt": 45
}
```

**Field notes:**
- `listenerVersion` is extracted from the pattern `TNSLSNR for Linux: Version X.Y.Z` or `Version X.Y.Z.Z.Z`; `null` if not found
- `services[].status` is always `"READY"` — the STATUS response text is not parsed for status; this is a hard-coded string
- `services[]` is built by pairing `SERVICE_NAME` values with `INSTANCE_NAME` values by index — if counts differ, extras get `instanceName: null`
- `endpoints` is extracted from `(ADDRESS=(…HOST=X…)(PORT=Y…))` patterns in the response
- `rawResponse` contains up to 2048 bytes of the raw ASCII descriptor with null bytes stripped
- `rtt` is wall-clock ms from `connect()` to receiving the first status response chunk

**Known issues:**
- Stops accumulating response data after 1 KB even though the read deadline allows up to 128 KB (line 640: `if (responseTotal > 1024) break`). Multi-service listeners may have their later services truncated.
- `services[].status` is always `"READY"` regardless of the actual listener state.
- If the listener sends no DATA response (some older Oracle versions), the endpoint falls back to parsing the initial CONNECT response text, which typically has no service info.

---

## `/api/oracle-tns/connect` — Full TNS connect (POST)

**oracle-tns.ts.** More spec-compliant CONNECT packet. Defaults service to 'ORCL'. Returns `success: true` even on REFUSE (it's a listener probe, not a connection test).

**Fields:**

| Field | Default | Required | Notes |
|---|---|---|---|
| `host` | — | ✅ | |
| `port` | `1521` | | |
| `serviceName` | `"ORCL"` | | SERVICE_NAME in the connect descriptor |
| `timeout` | `10000` | | |

**ACCEPT (service accepted):**
```json
{
  "success": true,
  "host": "oracle.example.com",
  "port": 1521,
  "serviceName": "ORCL",
  "protocol": "Oracle TNS",
  "responseType": "Accept",
  "latencyMs": 12,
  "accepted": true,
  "tnsVersion": 316,
  "compatibleVersion": 300,
  "sduSize": 8192,
  "tduSize": 65535,
  "message": "Oracle listener accepted connection for service \"ORCL\"",
  "rawHeader": "00 3e 00 00 02 00 00 00 01 3c ..."
}
```

**REFUSE (listener present, service not found):**
```json
{
  "success": true,
  "accepted": false,
  "listenerDetected": true,
  "responseType": "Refuse",
  "refuseReasonUser": 34,
  "refuseReasonSystem": 0,
  "refuseData": "(ERR=12514)(ERROR_STACK=(ERROR=(CODE=12514)(...)))",
  "oracleVersion": "19.3.0.0.0",
  "errorCode": "ORA-12514",
  "message": "Oracle listener refused: ...",
  "rawHeader": "00 1f 00 00 04 00 00 00 22 00 ..."
}
```

**Key difference from `/api/oracle/connect`:** Returns `success: true` even on REFUSE — a refused connection still proves the Oracle listener is alive. Use `accepted` to distinguish actual service access from listener detection.

**`oracleVersion` extraction:** Reads `VSNNUM=N` from the REFUSE/REDIRECT text, decodes as `(N>>24).(N>>20 & 0xF).(N>>12 & 0xFF).(N>>8 & 0xF).(N & 0xFF)`. Falls back to matching `Oracle X.Y.Z` or `version X.Y.Z` patterns.

**`errorCode` extraction:** Matches `(ERR=N)` and formats as `ORA-N`; falls back to `ORA-NNNNN` pattern.

---

## `/api/oracle-tns/probe` — Oracle listener detection (POST)

**oracle-tns.ts.** Sends a TNS CONNECT with `serviceName='__PROBE__'`. Since this service doesn't exist, the listener will REFUSE — but the REFUSE response proves the Oracle TNS listener is listening. Any of ACCEPT, REFUSE, REDIRECT, or RESEND is interpreted as `isOracle: true`.

**Fields:**

| Field | Default | Required | Notes |
|---|---|---|---|
| `host` | — | ✅ | |
| `port` | `1521` | | |
| `timeout` | `10000` | | |

**Success (Oracle detected via REFUSE):**
```json
{
  "success": true,
  "host": "oracle.example.com",
  "port": 1521,
  "protocol": "Oracle TNS",
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
  "message": "Non-Oracle response on host:1521 (type: Unknown (0x48))"
}
```

**Use this endpoint** when you don't know the service name and just want to confirm Oracle TNS is present. The REFUSE from `__PROBE__` is diagnostic, not an error.

---

## `/api/oracle-tns/query` — TNS connect + ANO negotiation (POST)

**oracle-tns.ts.** Extends the CONNECT handshake with an ANO (Advanced Networking Option) negotiation DATA packet. This reveals the Oracle version, SDU size, and sometimes the instance name from the server's ANO response.

**Fields:**

| Field | Default | Required | Notes |
|---|---|---|---|
| `host` | — | ✅ | |
| `port` | `1521` | | |
| `service` | `"XE"` | | Note: `service` not `serviceName` |
| `timeout` | `10000` | | |

**Success (ACCEPT + ANO response):**
```json
{
  "success": true,
  "host": "oracle.example.com",
  "port": 1521,
  "responseType": 2,
  "responseTypeName": "Accept",
  "latencyMs": 28,
  "tnsVersion": 316,
  "sduSize": 8192,
  "serviceName": "XE",
  "instanceName": "XE",
  "dbVersion": "19.3.0.0.0"
}
```

**REFUSE (listener present, success: false):**
```json
{
  "success": false,
  "responseType": 4,
  "responseTypeName": "Refuse",
  "refuseReason": "(ERR=12514)...",
  "dbVersion": "19.3.0.0.0",
  "latencyMs": 10
}
```

**ANO negotiation details:**
The ANO DATA packet sent is a hardcoded 40-byte payload declaring 4 service slots (Authentication=1, Encryption=2, DataIntegrity=3, Supervisor=4) with no actual capabilities. The server's response may contain version strings and instance names. The ANO response read has a hardcoded 3-second timeout; if it doesn't arrive, the ACCEPT data alone is returned (no `dbVersion`, no `instanceName`).

**Field naming inconsistency:** This endpoint uses `service` (not `serviceName`) in the request body. All other endpoints use `serviceName`. Both mean the same thing (the Oracle SERVICE_NAME connect descriptor value).

---

## `/api/oracle-tns/sql` — 4-phase login + query attempt (POST)

**oracle-tns.ts.** Attempts a staged Oracle login using TNS + minimal TTC (Two-Task Common) protocol. This is a best-effort probe — full Oracle authentication requires O5LOGON (Diffie-Hellman) which is not implemented.

**Fields:**

| Field | Default | Required | Notes |
|---|---|---|---|
| `host` | — | ✅ | |
| `port` | `1521` | | |
| `service` | `"XE"` | | |
| `username` | — | | If omitted, stops after ANO (phase "negotiate") |
| `password` | — | | Required if `username` is set |
| `query` | `"SELECT 1 FROM DUAL"` | | SQL to attempt |
| `timeout` | `15000` | | Outer timeout |

**Phase progression:**
1. **"connect"** — TNS CONNECT handshake
2. **"negotiate"** — ANO DATA packet + read response (3s timeout)
3. **"login"** — TTI_LOGON DATA packet + read response (5s timeout)
4. **"query"** — TTI_QUERY DATA packet + read response (5s timeout)

**Success with no credentials (negotiate only):**
```json
{
  "success": true,
  "phase": "negotiate",
  "tnsVersion": 316,
  "sduSize": 8192,
  "dbVersion": "19.3.0.0.0",
  "note": "Connect and negotiate phases completed. Provide username/password for login."
}
```

**With credentials (login rejected — typical):**
```json
{
  "success": false,
  "phase": "login",
  "tnsVersion": 316,
  "sduSize": 8192,
  "dbVersion": "19.3.0.0.0",
  "loginAccepted": false,
  "errorMessage": "ORA-1017"
}
```

**TTI_LOGON format:** `[0x76] [username_len] [username_bytes] [password_len] [password_bytes] [service_len] [service_bytes]`. All wrapped in a TNS DATA packet. Lengths are 1-byte LE (max 255 bytes per field). This is a simplified version of Oracle's real logon sequence — actual Oracle servers use the O5LOGON challenge-response with Diffie-Hellman key exchange; the server will typically respond with an auth challenge or ORA-1017 (wrong password).

**TTI_QUERY format:** `[0x03] [query_len] [query_bytes]`. Also simplified; a real Oracle TTC QUERY packet is more complex and includes cursor IDs, fetch sizes, and format descriptors.

**`queryResult`:** If the login somehow succeeds and the query response arrives, `queryResult` is the raw text after the DATA packet header with null bytes stripped, limited to 512 characters. This is unlikely to be properly decoded — it would typically be binary TTC response data.

---

## Wire Exchange

### Minimal listener probe

```
→ (TCP connect :1521)
→ [8-byte header][50-byte body][connect descriptor with __PROBE__]
← [8-byte header][REFUSE body: refuseReasonUser, refuseReasonSystem, len, text]
```

### Services query sequence

```
→ TNS CONNECT (serviceName=LISTENER)
← ACCEPT or REFUSE (either accepted)
→ TNS DATA (data_flags=0x0000) + "(CONNECT_DATA=(COMMAND=STATUS))"
← TNS DATA (ASCII descriptor: TNSLSNR version, SERVICE_NAME list, ADDRESS list)
```

### 4-phase SQL attempt

```
→ TNS CONNECT (serviceName=XE)
← TNS ACCEPT
→ TNS DATA [ANO probe: 4 service slots]
← TNS DATA [ANO response: version/instance info]
→ TNS DATA [TTI_LOGON 0x76: username + password + service]
← TNS DATA [auth challenge or TNS_MARKER (rejection)]
→ TNS DATA [TTI_QUERY 0x03: SQL text]
← TNS DATA [raw TTC response]
```

---

## Common Oracle Error Codes

| Code | Error |
|---|---|
| ORA-12514 | Listener does not currently know of service in connect descriptor |
| ORA-12505 | Listener does not currently know of SID given in connect descriptor |
| ORA-12541 | No listener (port not open or listener not running) |
| ORA-12154 | Could not resolve connect identifier |
| ORA-12560 | Protocol adapter error (network issue) |
| ORA-1017 | Invalid username/password |

---

## Known Limitations

### Two different CONNECT implementations

`oracle.ts` and `oracle-tns.ts` both send TNS CONNECT packets but with different body layouts, TNS versions (314 vs 316), and REFUSE parsing. A test targeting one family may get different results from the other on edge-case servers.

### `/api/oracle/connect` requires serviceName or SID

Unlike `/api/oracle-tns/connect` (defaults to 'ORCL'), `/api/oracle/connect` will return HTTP 400 if neither `serviceName` nor `sid` is provided. There is no probe mode in the `/oracle/` family.

### `/api/oracle/services` truncates at 1 KB

The response collector stops after 1024 bytes of status data even though the deadline allows up to 128 KB. Multi-service listeners with many registered services may have entries silently omitted.

### `services[].status` is always "READY"

The STATUS response parser doesn't extract actual service handler status from the TNS descriptor. All services are reported as `"READY"` regardless of actual state.

### TTI_LOGON is not a valid Oracle auth request

Oracle requires O5LOGON (Diffie-Hellman, Oracle 10g+) or O3LOGON (older). The minimal `0x76` packet sent by `/oracle-tns/sql` is not a proper auth request. The server will respond with a challenge, error, or TNS_MARKER rejection — but will not authenticate. The login phase can succeed (loginAccepted: true) if the server returns any TNS_DATA packet, even a challenge/error, as long as no ORA-NNNNN error code is detectable in the response text.

### Inner read is single-chunk in oracle.ts

`handleOracleConnect` reads one TCP chunk with `reader.read()` and no retry. If the TNS ACCEPT spans multiple TCP segments (uncommon but possible), only the first chunk is received and parsing may fail.

### No Cloudflare detection in oracle-tns.ts

Wait — this is wrong. Both files call `checkIfCloudflare(host)`. The check is present in all handlers. Requests to Cloudflare-protected hosts return HTTP 403 with `isCloudflare: true`.

### No TLS/encryption

Neither family supports Oracle Advanced Security (native TLS or native network encryption). Connections are plaintext. Oracle 18c+ defaults to requiring encryption for non-loopback connections on some configurations.

---

## curl Examples

```bash
# Basic connect test — SID format
curl -s -X POST https://portofcall.ross.gg/api/oracle/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","sid":"XE"}' | jq '{success,packetType,"protocol"}'

# Basic connect test — service name format
curl -s -X POST https://portofcall.ross.gg/api/oracle/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","serviceName":"ORCL"}' | jq .

# GET form (quick browser test)
curl -s 'https://portofcall.ross.gg/api/oracle/connect?host=oracle.example.com&serviceName=ORCL' | jq .

# Query listener for all registered services (no credentials needed)
curl -s -X POST https://portofcall.ross.gg/api/oracle/services \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com"}' | jq '{listenerVersion,services,endpoints,rtt}'

# Detect Oracle TNS listener presence (no service name needed)
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com"}' | jq '{isOracle,oracleVersion,responseType,latencyMs}'

# Full negotiate: TNS version + SDU + service acceptance
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","serviceName":"ORCL"}' \
  | jq '{accepted,tnsVersion,compatibleVersion,sduSize,tduSize,oracleVersion,errorCode}'

# ANO negotiation: service + instance name + DB version
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","service":"ORCL"}' \
  | jq '{success,tnsVersion,sduSize,serviceName,instanceName,dbVersion}'

# SQL attempt (likely fails at login — returns challenge info)
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/sql \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","service":"ORCL","username":"scott","password":"tiger"}' \
  | jq '{phase,loginAccepted,dbVersion,errorMessage}'

# Probe without credentials — stops at negotiate phase
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/sql \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","service":"XE"}' \
  | jq '{phase,tnsVersion,dbVersion,note}'

# Custom port (non-standard listener port)
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"oracle.example.com","port":1522}' | jq .
```

---

## Local Test Server

**Oracle XE via Docker (requires free Oracle account):**

```bash
docker pull container-registry.oracle.com/database/express:latest

docker run -d \
  --name oracle-xe \
  -p 1521:1521 \
  -e ORACLE_PWD=OraclePassword123 \
  container-registry.oracle.com/database/express:latest

# Wait 5-10 minutes for first-time init
docker logs -f oracle-xe | grep -i "ready"
# Service name: XEPDB1 (pluggable), SID: XE (container)
```

**Instant probe check:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/oracle-tns/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_LOCAL_IP","port":1521}' | jq .
```
