# Diameter — Port 3868

RFC 6733 AAA protocol (successor to RADIUS). TCP transport only (no SCTP, no TLS/DTLS).

Implementation: `src/worker/diameter.ts` (1096 lines, functional handlers — no class)

## Endpoints

| # | Method | Path | Wire sequence | Default timeout |
|---|--------|------|---------------|-----------------|
| 1 | POST | `/api/diameter/connect` | CER → CEA → DPR → (DPA) | 15 000 ms |
| 2 | POST | `/api/diameter/watchdog` | CER → CEA → DWR → DWA | 15 000 ms |
| 3 | POST | `/api/diameter/acr` | CER → CEA → ACR → ACA | 15 000 ms |
| 4 | POST | `/api/diameter/auth` | CER → CEA → AAR → (AAA) | 15 000 ms |
| 5 | POST | `/api/diameter/str` | CER → CEA → STR → (STA) | **10 000 ms** |

Parenthesised answers are best-effort: the handler catches read failures and returns `resultCode: 0` / `resultCodeName: "NO_RESPONSE"` instead of failing.

All endpoints expect JSON body via `request.json()`. No HTTP method check is performed — a GET with a JSON body will work, but POST is the intended method.

---

## 1. `/api/diameter/connect` — Capabilities Exchange

Sends CER (Capabilities-Exchange-Request, command 257), reads CEA, then sends DPR (Disconnect-Peer-Request, command 282) for clean teardown. The only endpoint that sends DPR.

**Request:**
```json
{
  "host": "diameter.example.com",
  "port": 3868,
  "originHost": "portofcall.ross.gg",
  "originRealm": "ross.gg",
  "timeout": 15000
}
```
Only `host` is required. All others have defaults shown above.

**CER AVPs sent:**
| AVP | Code | Mandatory | Value |
|-----|------|-----------|-------|
| Origin-Host | 264 | M | `originHost` param |
| Origin-Realm | 296 | M | `originRealm` param |
| Host-IP-Address | 257 | M | `0.0.0.0` (hardcoded — see quirks) |
| Vendor-Id | 266 | M | `0` |
| Product-Name | 269 | - | `"PortOfCall"` |
| Auth-Application-Id | 258 | M | `0` (Common Messages) |
| Firmware-Revision | 267 | - | `1` |

**Response:**
```json
{
  "success": true,
  "message": "Diameter peer reachable",
  "host": "diameter.example.com",
  "port": 3868,
  "protocol": {
    "version": 1,
    "commandCode": 257,
    "commandName": "Capabilities-Exchange-Answer (CEA)",
    "isRequest": false,
    "applicationId": 0,
    "resultCode": 2001,
    "resultCodeName": "DIAMETER_SUCCESS"
  },
  "peerInfo": {
    "Origin-Host": "server.example.com",
    "Origin-Realm": "example.com",
    "Product-Name": "FreeDiameter",
    "Vendor-Id": "0",
    "Firmware-Revision": "10201",
    "Result-Code": "2001 (SUCCESS)"
  },
  "rawAvpCount": 12
}
```

**DPR details:** Sent after CEA with Disconnect-Cause AVP (code 273) set to `0` (REBOOTING). Reads DPA with a 3-second timeout — timeout is silently ignored.

**`commandName` mapping:** Only command 257 gets a human-readable name (`"Capabilities-Exchange-Answer (CEA)"`). All other command codes produce `"Command {n}"`.

---

## 2. `/api/diameter/watchdog` — Device Watchdog (DWR/DWA)

Establishes a CER/CEA session, then sends DWR (command 280) and measures RTT. Does NOT send DPR — just closes the socket.

**Request:** Same schema as `/connect`.

**Additional CER note:** This endpoint's CER omits `Firmware-Revision` (unlike `/connect`).

**DWR AVPs sent:**
| AVP | Code | Mandatory | Value |
|-----|------|-----------|-------|
| Origin-Host | 264 | M | `originHost` param |
| Origin-Realm | 296 | M | `originRealm` param |
| Origin-State-Id | 278 | - | `Math.floor(Date.now() / 1000)` |

**Response:**
```json
{
  "success": true,
  "message": "Watchdog response received",
  "host": "...",
  "port": 3868,
  "rtt": 42,
  "commandCode": 280,
  "commandName": "Device-Watchdog-Answer (DWA)",
  "peerInfo": { "Origin-Host": "...", ... }
}
```

`rtt` measures DWR→DWA latency only (excludes CER/CEA).

**Quirk: CEA result code unchecked.** The CER/CEA exchange is required before DWR, but the CEA Result-Code is NOT validated. If the peer returns a non-2001 CEA (e.g. 5010 = NO_COMMON_APPLICATION), the code still proceeds to send DWR. This applies to all non-`/connect` endpoints (`/watchdog`, `/acr`, `/auth`, `/str`) — they all read the CEA and discard it without checking the result.

---

## 3. `/api/diameter/acr` — Accounting Request (ACR/ACA)

Sends an Accounting-Request (command 271, application-id 3 = Base Accounting).

**Request:**
```json
{
  "host": "diameter.example.com",
  "port": 3868,
  "originHost": "portofcall.ross.gg",
  "originRealm": "ross.gg",
  "destinationRealm": "ross.gg",
  "sessionId": "portofcall.ross.gg;1708123456789;1",
  "acctRecordType": 1,
  "username": "user@example.com",
  "timeout": 15000
}
```

`destinationRealm` defaults to `originRealm`. `sessionId` auto-generates from `{originHost};{timestamp};1`. `acctRecordType` defaults to `1` (EVENT_RECORD). `username` is optional — when omitted, the User-Name AVP is not sent.

**`acctRecordType` values:**
| Value | Name |
|-------|------|
| 1 | EVENT_RECORD |
| 2 | START_RECORD |
| 3 | INTERIM_RECORD |
| 4 | STOP_RECORD |

**CER difference:** This endpoint's CER includes `Acct-Application-Id: 3` (Base Accounting) in addition to `Auth-Application-Id: 0`.

**Response:**
```json
{
  "success": true,
  "host": "...",
  "port": 3868,
  "rtt": 35,
  "resultCode": 2001,
  "resultCodeName": "DIAMETER_SUCCESS",
  "sessionId": "portofcall.ross.gg;1708123456789;1",
  "acctRecordType": 1,
  "acctRecordTypeName": "EVENT_RECORD"
}
```

No `peerInfo` in the ACR response (unlike `/connect` and `/auth`).

---

## 4. `/api/diameter/auth` — Auth Capability Probe (AAR/AAA)

Sends a CER advertising multiple auth applications (NASREQ=1, Credit-Control=4, EAP=5, plus Supported-Vendor-Id=10415 for 3GPP), then reads the CEA to discover which applications the server supports. After that, sends an AAR (AA-Request, command 265) targeting the first non-zero Auth-Application-Id from the CEA (falls back to NASREQ=1).

**Request:**
```json
{
  "host": "diameter.example.com",
  "port": 3868,
  "originHost": "portofcall.ross.gg",
  "originRealm": "ross.gg",
  "destinationRealm": "ross.gg",
  "timeout": 15000
}
```

**CER difference from other endpoints:**
- Advertises three Auth-Application-Ids (1, 4, 5) instead of just 0
- Includes `Supported-Vendor-Id: 10415` (3GPP)
- Omits `Firmware-Revision`

**Application ID name table (hardcoded):**
| ID | Name |
|----|------|
| 0 | Diameter Common Messages |
| 1 | NASREQ (RFC 4005) |
| 2 | Mobile IPv4 (RFC 4004) |
| 3 | Diameter Base Accounting (RFC 6733) |
| 4 | Credit Control (RFC 4006) |
| 5 | EAP (RFC 4072) |
| 6 | SIP (RFC 4740) |
| 16777216 | Cx/Dx 3GPP (TS 29.229) |
| 16777217 | Sh 3GPP (TS 29.329) |
| 16777236 | Rx 3GPP (TS 29.214) |
| 16777238 | Gx 3GPP (TS 29.212) |

Any application ID not in this table appears as `"Unknown App ({id})"`.

**Response:**
```json
{
  "success": true,
  "host": "...",
  "port": 3868,
  "rtt": 28,
  "resultCode": 2001,
  "resultCodeName": "DIAMETER_SUCCESS",
  "supportedApps": [
    "0: Diameter Common Messages",
    "3: Diameter Base Accounting (RFC 6733)"
  ],
  "peerInfo": { "Origin-Host": "...", ... }
}
```

`supportedApps` is deduplicated (`Set`). If the AAR gets no response (server closes or times out), `resultCode` is `0` and `resultCodeName` is `"NO_RESPONSE"` but `success` is still `true` because the CER/CEA already succeeded.

---

## 5. `/api/diameter/str` — Session Termination (STR/STA)

Sends a Session-Termination-Request (command 275).

**Request:**
```json
{
  "host": "diameter.example.com",
  "port": 3868,
  "originHost": "portofcall.probe",
  "originRealm": "portofcall.example",
  "sessionId": "portofcall.probe;1708123456789;str",
  "terminationCause": 1,
  "timeout": 10000
}
```

**`destinationRealm` not configurable.** Unlike `/acr` and `/auth`, the `/str` handler does not accept a `destinationRealm` parameter. It hardcodes Destination-Realm to `originRealm`. If you need to terminate a session in a different realm, you must set `originRealm` to the target realm.

**Termination cause values:**
| Value | Name |
|-------|------|
| 1 | DIAMETER_LOGOUT (default) |
| 2 | SERVICE_NOT_PROVIDED |
| 4 | SESSION_TIMEOUT |
| 8 | USER_MOVED |

**Response:**
```json
{
  "success": true,
  "host": "...",
  "port": 3868,
  "rtt": 31,
  "sessionId": "portofcall.probe;1708123456789;str",
  "terminationCause": 1,
  "terminationCauseName": "DIAMETER_LOGOUT",
  "resultCode": 2001,
  "resultCodeName": "DIAMETER_SUCCESS"
}
```

---

## Cross-Endpoint Comparison

### Default identity inconsistency

| Field | `/connect`, `/watchdog`, `/acr`, `/auth` | `/str` |
|-------|------------------------------------------|--------|
| `originHost` | `portofcall.ross.gg` | `portofcall.probe` |
| `originRealm` | `ross.gg` | `portofcall.example` |
| `timeout` | 15 000 ms | 10 000 ms |

If you're scripting a multi-endpoint session (e.g. `/connect` then `/str`), explicitly pass `originHost` and `originRealm` to both — the mismatched defaults will cause the server to treat them as different peers.

### Cloudflare detection

| Endpoint | CF check |
|----------|----------|
| `/connect` | Yes |
| `/watchdog` | Yes |
| `/acr` | Yes |
| `/auth` | Yes |
| `/str` | **No** |

`/str` skips the `checkIfCloudflare()` call — it will attempt to connect to Cloudflare-fronted hosts where other endpoints would return HTTP 403.

### Clean disconnect (DPR)

Only `/connect` sends DPR after the main exchange. All other endpoints close the TCP socket without signalling. This means `/watchdog`, `/acr`, `/auth`, and `/str` will appear as abrupt peer failures in server logs.

### CER AVP differences

| AVP | `/connect` | `/watchdog` | `/acr` | `/auth` | `/str` |
|-----|-----------|-------------|--------|---------|--------|
| Auth-Application-Id | 0 | 0 | 0 | 1, 4, 5 | 0 |
| Acct-Application-Id | — | — | 3 | — | — |
| Firmware-Revision | 1 | — | — | — | — |
| Supported-Vendor-Id | — | — | — | 10415 | — |

### Port validation

None of the 5 endpoints validate the `port` field. Any integer (including 0 or >65535) is passed directly to `connect()`.

---

## Wire Format

### Diameter message header (20 bytes)

```
Offset  Size  Field
0       1     Version (always 1)
1       3     Message Length (including header)
4       1     Command Flags (R=0x80, P=0x40, E=0x20, T=0x10)
5       3     Command Code
8       4     Application-ID
12      4     Hop-by-Hop Identifier
16      4     End-to-End Identifier
20+     var   AVPs
```

### AVP format

```
Offset  Size  Field
0       4     AVP Code
4       1     Flags (V=0x80 vendor, M=0x40 mandatory, P=0x20 protected)
5       3     AVP Length (header + value, before padding)
8       4     Vendor-ID (only if V flag set)
8/12    var   Value (padded to 4-byte boundary)
```

### Hop-by-Hop / End-to-End identifiers

Generated via `Math.floor(Math.random() * 0xffffffff)`. Subsequent messages in the same connection increment by 1 (`hopByHopId + 1`, `endToEndId + 1`).

### Host-IP-Address AVP

Always sends `AF_INET (0x0001)` + `0.0.0.0` (6 bytes). The real Worker IP is not available in the Cloudflare Workers runtime.

---

## AVP Decoding

`extractAVPInfo()` decodes 7 AVP types from responses:

| AVP Code | Name | Decode |
|----------|------|--------|
| 264 | Origin-Host | UTF-8 string |
| 296 | Origin-Realm | UTF-8 string |
| 269 | Product-Name | UTF-8 string |
| 266 | Vendor-Id | uint32 → string |
| 267 | Firmware-Revision | uint32 → string |
| 268 | Result-Code | uint32 → `"{code} ({category})"` |
| 258 | Auth-Application-Id | uint32 → string |

All other AVPs (Supported-Vendor-Id, Acct-Application-Id, Host-IP-Address, Inband-Security-Id, etc.) are parsed structurally but their values are not included in `peerInfo`.

### Result code classification

| Range | Name | Note |
|-------|------|------|
| 2001 | `DIAMETER_SUCCESS` | Only 2001 is named; other 2xxx codes show as `"Code {n}"` |
| 3000–3999 | `PROTOCOL_ERROR` | |
| 4000–4999 | (unnamed) | Gap: 4xxx transient failures produce `"Code {n}"` or `"Code({n})"` |
| 5000+ | `PERMANENT_FAILURE` | |

The format string also varies: `/connect` and `/acr` produce `"Code {n}"` while `/str` produces `"Code({n})"` (parenthesised, no space).

---

## Known Quirks and Limitations

1. **Host-IP-Address is always `0.0.0.0`** — RFC 6733 §5.3.5 requires a real address. Strict peers may reject the CER.

2. **No TLS** — `connect()` uses raw TCP. No DTLS, no Diameter-over-TLS (RFC 6733 §13.1), no Inband-Security-Id negotiation.

3. **No SCTP** — TCP only. Cloudflare Workers do not support SCTP sockets.

4. **Single TCP read per message** — `readDiameterMessage()` assembles chunks until the Diameter message length is satisfied, which is correct. However, it does not handle pipelined messages (multiple messages in one read), so a server that sends CEA + DWR in one TCP segment will have the DWR silently discarded.

5. **`/str` missing Cloudflare detection** — See cross-endpoint comparison above.

6. **`/str` default identity mismatch** — `originHost: "portofcall.probe"` and `originRealm: "portofcall.example"` differ from all other endpoints (`portofcall.ross.gg` / `ross.gg`). Scripted workflows must pass explicit values.

7. **`/str` default timeout shorter** — 10s vs 15s for all other endpoints.

8. **`/auth` AAR may silently fail** — If the server closes or times out after AAR, the response still has `success: true` with `resultCode: 0`. The `supportedApps` from CEA are still returned.

9. **No DPR on non-`/connect` endpoints** — `/watchdog`, `/acr`, `/auth`, and `/str` just close the socket. This is an RFC 6733 §5.4 violation (peers MUST send DPR before disconnecting).

10. **4xxx result codes not classified** — Transient failures (e.g. 4001 DIAMETER_AUTHENTICATION_REJECTED) appear as generic `"Code {n}"`.

11. **No vendor-specific AVP encoding** — `encodeAVP()` supports the vendor flag and vendor-id field, but none of the handlers use it. You cannot send 3GPP or other vendor-specific AVPs.

12. **Acct-Record-Number always `1`** — In `/acr`, the `Acct-Record-Number` AVP (code 485) is hardcoded to `1`. For a proper START→INTERIM→STOP sequence, the record number should increment.

13. **`/acr` response omits `peerInfo`** — Unlike `/connect` and `/auth`, the ACR response does not call `extractAVPInfo()` on the ACA.

14. **Proxiable flag not set on ACR/STR** — RFC 6733 §9.7.1 specifies ACR as proxiable (P flag should be set, making flags 0xC0). Similarly, STR is proxiable per §8.4.1. The implementation only sets R=0x80 on all requests. Strict Diameter relay agents may reject non-proxiable ACR/STR.

15. **Timeout architecture** — Each endpoint wraps the entire connection flow in `Promise.race([connectionPromise, timeoutPromise])`, and `readDiameterMessage()` also accepts `timeoutMs` internally. Since both the outer and inner timeouts start from approximately the same instant, the outer `Promise.race` always fires first if the total flow exceeds `timeoutMs`. Effective maximum is ~`timeoutMs`, not doubled. The inner read timeouts are redundant but harmless.

---

## curl Examples

```bash
# Capabilities exchange (connect + probe)
curl -s -X POST https://portofcall.ross.gg/api/diameter/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"diameter.example.com"}' | jq .

# Watchdog ping with RTT measurement
curl -s -X POST https://portofcall.ross.gg/api/diameter/watchdog \
  -H 'Content-Type: application/json' \
  -d '{"host":"diameter.example.com","originHost":"myprobe.lab","originRealm":"lab"}' | jq .rtt

# Accounting event record
curl -s -X POST https://portofcall.ross.gg/api/diameter/acr \
  -H 'Content-Type: application/json' \
  -d '{"host":"diameter.example.com","acctRecordType":1,"username":"test@example.com"}' | jq .

# Auth capability discovery
curl -s -X POST https://portofcall.ross.gg/api/diameter/auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"diameter.example.com"}' | jq .supportedApps

# Session termination
curl -s -X POST https://portofcall.ross.gg/api/diameter/str \
  -H 'Content-Type: application/json' \
  -d '{"host":"diameter.example.com","originHost":"portofcall.ross.gg","originRealm":"ross.gg","terminationCause":1}' | jq .
```

## Local Testing

Install [FreeDiameter](http://www.freediameter.net/) or use a Docker container:

```bash
# FreeDiameter in Docker (listens on 3868)
docker run --rm -p 3868:3868 freediameter/freediameter

# Test with wrangler dev
npx wrangler dev
curl -s -X POST http://localhost:8787/api/diameter/connect \
  -d '{"host":"localhost","port":3868}' | jq .
```

## Command Code Reference

| Code | Name | Request/Answer | Used by |
|------|------|---------------|---------|
| 257 | Capabilities-Exchange | CER/CEA | all endpoints |
| 265 | AA (Auth) | AAR/AAA | `/auth` |
| 271 | Accounting | ACR/ACA | `/acr` |
| 275 | Session-Termination | STR/STA | `/str` |
| 280 | Device-Watchdog | DWR/DWA | `/watchdog` |
| 282 | Disconnect-Peer | DPR/DPA | `/connect` (cleanup only) |
