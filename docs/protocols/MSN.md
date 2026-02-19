# MSN Messenger / MSNP — Power-User Reference

**Port:** 1863 (default)
**Transport:** TCP plaintext (TLS via STARTTLS-like negotiation in MSNP15+)
**Implementation:** `src/worker/msn.ts`
**Routes:**
- `POST /api/msn/probe` (VER version negotiation)
- `POST /api/msn/client-version` (VER + CVR client version)
- `POST /api/msn/login` (VER + CVR + USR TWN I - Tweener auth initiation)
- `POST /api/msn/md5-login` (VER + INF + USR MD5 - legacy MD5 authentication)

Microsoft Notification Protocol (MSNP) was the proprietary text-based protocol used by MSN Messenger (later Windows Live Messenger) for instant messaging. The service was shut down in 2013, but the protocol is still supported by revival servers (Escargot, WLM revival projects). Protocol versions range from MSNP2 (1999) through MSNP21 (2012), with MSNP18 being the final widely-deployed version.

---

## Endpoints

### `POST /api/msn/probe`

Probe for MSN/MSNP server by sending VER (version negotiation) command.

**Request:**
```json
{
  "host": "messenger.hotmail.com",
  "port": 1863,
  "protocolVersion": "MSNP18",
  "timeout": 15000
}
```

| Field             | Required | Default     | Notes |
|-------------------|----------|-------------|-------|
| `host`            | Yes      | —           | No format validation — any string passed to `connect()`. |
| `port`            | No       | `1863`      | Validated 1–65535. |
| `protocolVersion` | No       | `"MSNP18"`  | Requested version. Client sends this plus MSNP17/16/15/CVR0 for fallback. |
| `timeout`         | No       | `15000`     | Milliseconds. Shared timer — covers connection + handshake + response. |

**Success response:**
```json
{
  "success": true,
  "host": "messenger.hotmail.com",
  "port": 1863,
  "supportedVersions": ["MSNP18"],
  "serverResponse": "VER 1 MSNP18",
  "protocolVersion": "MSNP18",
  "rtt": 42
}
```

| Field               | Type       | Notes |
|---------------------|------------|-------|
| `supportedVersions` | `string[]` | Protocol versions from server VER response. CVR0 filtered out (it's a capability flag, not a version). |
| `protocolVersion`   | `string`   | Negotiated version (first in `supportedVersions`). Server echoes highest mutually-supported version. |
| `rtt`               | `number`   | Round-trip time in milliseconds (connection open to VER response). |

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | Missing host, invalid port (< 1 or > 65535). |
| 200  | Server returned error code (e.g., `500 Internal Server Error`, `911 Authentication failed`). `success: false`, includes `error` field with error description if code is known. |
| 200  | Server sent unexpected command (not VER). |
| 200  | Transaction ID mismatch (server echoed wrong TrID). |
| 500  | Connection timeout, socket errors, JSON parse failure. |

---

### `POST /api/msn/client-version`

Send VER + CVR (client version report) in sequence.

**Request:**
```json
{
  "host": "messenger.hotmail.com",
  "port": 1863,
  "timeout": 15000
}
```

Same fields as `/api/msn/probe` but no `protocolVersion` parameter (hardcoded to MSNP18 + CVR0).

**Success response:**
```json
{
  "success": true,
  "host": "messenger.hotmail.com",
  "port": 1863,
  "verResponse": "VER 1 MSNP18 CVR0",
  "cvrResponse": "CVR 2 8.5.1302 8.5.1302 8.5.1302 http://... http://...",
  "serverResponse": "VER 1 MSNP18 CVR0\r\nCVR 2 8.5.1302 8.5.1302 8.5.1302 http://... http://..."
}
```

CVR response format: `CVR TrID RecVer RecVer MinVer DownloadURL InfoURL` (server recommends client version and provides update URLs).

**Error responses:** Same as `/api/msn/probe`.

---

### `POST /api/msn/login`

Initiate MSNP login with Tweener (TWN) authentication method (MSNP8+). Performs VER + CVR + USR TWN I sequence. Server responds with authentication challenge token for Passport/Windows Live ID authentication (not implemented — challenge returned only).

**Request:**
```json
{
  "host": "messenger.escargot.chat",
  "port": 1863,
  "email": "user@example.com",
  "protocolVersion": "MSNP18",
  "timeout": 10000
}
```

| Field             | Required | Default              | Notes |
|-------------------|----------|----------------------|-------|
| `email`           | No       | `"user@example.com"` | Account identifier for USR command. |

All other fields same as `/api/msn/probe`.

**Success response:**
```json
{
  "success": true,
  "host": "messenger.escargot.chat",
  "port": 1863,
  "email": "user@example.com",
  "verResponse": "VER 1 MSNP18 MSNP17 MSNP16 CVR0",
  "cvrResponse": "CVR 2 8.5.1302 8.5.1302 8.5.1302 http://... http://...",
  "usrResponse": "USR 3 TWN S lc=1033,id=507,tw=40,fs=1,ru=http://...,ct=...",
  "negotiatedVersion": "MSNP18",
  "authChallengeToken": "lc=1033,id=507,tw=40,fs=1,ru=http://...,ct=...",
  "redirectServer": null,
  "errorCode": null
}
```

| Field                 | Type     | Notes |
|-----------------------|----------|-------|
| `authChallengeToken`  | `string` | Tweener challenge string from `USR 3 TWN S <token>`. Client must use this to authenticate with Passport server (not implemented). |
| `redirectServer`      | `string` | If server sends `XFR NS <ip:port>`, client should reconnect to this server. |
| `errorCode`           | `string` | 3-digit numeric error code if server rejected login (e.g., `911`). |

**Error responses:** Same as `/api/msn/probe` plus:
- 200: Server sent XFR redirect or error code. `success: false`, includes `redirectServer` or `errorCode`.

---

### `POST /api/msn/md5-login`

Legacy MD5 authentication flow for MSNP2-7 (MSN Messenger 1.x-4.x). Performs VER (MSNP7-2) + INF + USR MD5 I + USR MD5 S. Computes MD5 challenge-response and attempts login.

**Request:**
```json
{
  "host": "messenger.escargot.chat",
  "port": 1863,
  "email": "user@example.com",
  "password": "hunter2",
  "timeout": 12000
}
```

| Field      | Required | Default              | Notes |
|------------|----------|----------------------|-------|
| `email`    | No       | `"user@example.com"` | Account identifier. |
| `password` | No       | `""`                 | Plaintext password (never sent over wire — MD5 hashed locally). |

**Success response:**
```json
{
  "success": true,
  "host": "messenger.escargot.chat",
  "port": 1863,
  "email": "user@example.com",
  "negotiatedVersion": "MSNP7",
  "authMethods": "MD5",
  "challenge": "1234567890.1234567890",
  "authResponse": "d41d8cd98f00b204e9800998ecf8427e",
  "verifiedName": "user@example.com",
  "usrOkResponse": "USR 4 OK user@example.com User 1",
  "errorCode": null,
  "error": null
}
```

| Field            | Type     | Notes |
|------------------|----------|-------|
| `negotiatedVersion` | `string` | Highest mutually-supported version from VER response (MSNP2-7). |
| `authMethods`    | `string` | Supported auth methods from INF response (typically `"MD5"`). |
| `challenge`      | `string` | Server's random challenge string from `USR 3 MD5 S <challenge>`. |
| `authResponse`   | `string` | Client's computed response: `MD5(challenge + MD5(password))`. |
| `verifiedName`   | `string` | Verified account name from `USR 4 OK <email> <name> <flags>`. |
| `usrOkResponse`  | `string` | Full USR OK response line. |

**Error responses:**
- 400: Missing host.
- 200: Server sent XFR redirect or error code instead of challenge. `success: false`, includes `redirectServer` or `errorCode`.
- 200: Login failed after sending auth response. `success: false`, includes `errorCode` or generic error message.
- 500: Connection timeout, socket errors, JSON parse failure.

---

## Protocol Command Reference

MSNP is a text-based request/response protocol. All commands follow this format:

```
COMMAND TrID param1 param2 ...\r\n
```

- **COMMAND:** 3-letter code (VER, CVR, USR, etc.)
- **TrID:** Transaction ID — incrementing integer client maintains for request/response correlation
- **Params:** Space-separated parameters (command-specific)
- **Terminator:** All commands/responses end with `\r\n`

### VER (Version Negotiation)

**Client → Server:**
```
VER 1 MSNP18 MSNP17 MSNP16 MSNP15 CVR0\r\n
```

Client sends list of supported protocol versions in descending order (highest first). `CVR0` is a capability flag indicating CVR command support (not a protocol version).

**Server → Client:**
```
VER 1 MSNP18 CVR0\r\n
```

Server echoes transaction ID and highest mutually-supported version. May return multiple versions if it supports multiple from the client's list.

### CVR (Client Version Report)

**Client → Server:**
```
CVR 2 0x0409 win 10.0 i386 MSNMSGR 8.5.1302 msmsgs user@example.com\r\n
```

| Param     | Example       | Description |
|-----------|---------------|-------------|
| TrID      | `2`           | Transaction ID |
| LocaleID  | `0x0409`      | Windows LCID (0x0409 = en-US) |
| OSType    | `win`         | Operating system (`win`, `mac`, `linux`) |
| OSVer     | `10.0`        | OS version |
| Arch      | `i386`        | CPU architecture |
| ClientName | `MSNMSGR`    | Client identifier |
| ClientVer | `8.5.1302`    | Client version |
| ClientID  | `msmsgs`      | Client type identifier |
| Email     | `user@example.com` | User account (optional in some versions) |

**Server → Client:**
```
CVR 2 8.5.1302 8.5.1302 8.5.1302 http://download.live.com/... http://config.live.com/...\r\n
```

| Param       | Description |
|-------------|-------------|
| RecVer      | Recommended client version |
| RecVer      | (repeated) |
| MinVer      | Minimum supported client version |
| DownloadURL | Update download URL |
| InfoURL     | Client info/configuration URL |

### INF (Information Query)

**Client → Server (MSNP2-7 only):**
```
INF 2\r\n
```

Queries server for supported authentication methods.

**Server → Client:**
```
INF 2 MD5 SHA1\r\n
```

Returns list of supported auth methods (MD5, SHA1, etc.).

### USR (User Authentication)

#### Tweener (TWN) - MSNP8+

**Client → Server (Initiate):**
```
USR 3 TWN I user@example.com\r\n
```

| Param   | Description |
|---------|-------------|
| TrID    | Transaction ID |
| AuthType | `TWN` (Tweener/Passport) |
| Stage   | `I` (Initiate) |
| Email   | User account |

**Server → Client (Challenge):**
```
USR 3 TWN S lc=1033,id=507,tw=40,fs=1,ru=http://login.live.com/...,ct=...\r\n
```

Server returns Passport authentication challenge token. Client must authenticate with Passport server using this token (not implemented in this codebase).

#### MD5 Authentication - MSNP2-7

**Client → Server (Initiate):**
```
USR 3 MD5 I user@example.com\r\n
```

**Server → Client (Challenge):**
```
USR 3 MD5 S 1234567890.1234567890\r\n
```

Server sends random challenge string.

**Client → Server (Response):**
```
USR 4 MD5 S d41d8cd98f00b204e9800998ecf8427e\r\n
```

Client computes: `MD5(challenge + MD5(password))` in hexadecimal lowercase.

**Server → Client (Success):**
```
USR 4 OK user@example.com User 1\r\n
```

| Param        | Description |
|--------------|-------------|
| OK           | Success status |
| Email        | Verified account |
| DisplayName  | User's display name |
| Flags        | Account flags |

### XFR (Transfer/Redirect)

**Server → Client:**
```
XFR 3 NS 207.46.110.100:1863 0 65.54.239.210:1863\r\n
```

Server redirects client to different notification server. Client should disconnect and reconnect to specified host:port.

### Error Codes

**Server → Client:**
```
911 3\r\n
```

3-digit numeric error code followed by transaction ID. No additional parameters.

---

## Error Code Reference

| Code | Description |
|------|-------------|
| 200  | Syntax error |
| 201  | Invalid parameter |
| 205  | Invalid principal |
| 206  | Domain name missing |
| 207  | Already logged in |
| 208  | Invalid principal |
| 209  | Nickname change illegal |
| 210  | Principal list full |
| 215  | Principal already on list |
| 216  | Principal not on list |
| 217  | Principal not online |
| 218  | Already in mode |
| 219  | Principal is in the opposite list |
| 223  | Too many groups |
| 224  | Invalid group |
| 225  | Principal not in group |
| 229  | Group name too long |
| 230  | Cannot remove group zero |
| 231  | Invalid group |
| 280  | Switchboard failed |
| 281  | Transfer to switchboard failed |
| 300  | Required field missing |
| 302  | Not logged in |
| 500  | Internal server error |
| 501  | DB server error |
| 502  | Command disabled |
| 510  | File operation failed |
| 520  | Memory allocation failed |
| 540  | Challenge response failed |
| 600  | Server is busy |
| 601  | Server is unavailable |
| 602  | Peer NS is down |
| 603  | DB connection failed |
| 604  | Server is going down |
| 605  | Server unavailable |
| 707  | Could not create connection |
| 710  | Bad CVR parameters sent |
| 711  | Write is blocking |
| 712  | Session is overloaded |
| 713  | Calling too rapidly |
| 714  | Too many sessions |
| 715  | Not expected |
| 717  | Bad friend file |
| 731  | Not expected |
| 800  | Changing too rapidly |
| 910  | Server too busy |
| 911  | Authentication failed |
| 912  | Server too busy |
| 913  | Not allowed when hiding |
| 914  | Server unavailable |
| 915  | Server unavailable |
| 916  | Server unavailable |
| 917  | Authentication failed |
| 918  | Server too busy |
| 919  | Server too busy |
| 920  | Not accepting new principals |
| 921  | Server too busy for kids |
| 922  | Server too busy |
| 923  | Kids Passport without parental consent |
| 924  | Passport account not yet verified |
| 928  | Bad ticket |

---

## Known Quirks and Limitations

### Transaction ID not validated in probe endpoint

`handleMSNProbe` generates transaction ID 1 for the VER command but only recently added validation that the server's response echoes the same TrID. Previously, a misdirected or poisoned response would be accepted. Fixed as of 2026-02-18.

### No transaction ID validation in other endpoints

`handleMSNClientVersion`, `handleMSNLogin`, and `handleMSNMD5Login` never validate transaction IDs. They parse responses but don't check that server echoed the correct TrID for each command. A poisoned or out-of-order response would be accepted.

### MD5 authentication is deprecated and insecure

MSNP2-7 MD5 authentication uses MD5 hashes (cryptographically broken since 2004). While the challenge-response prevents plaintext password exposure, MD5 collisions allow impersonation attacks. Modern MSNP servers use Tweener/OAuth instead. MD5 auth is only supported for historical/revival server compatibility.

### UTF-8 encoding in MD5 computation

`handleMSNMD5Login` uses UTF-8 encoding for both `MD5(password)` and `MD5(challenge + hash)`. MSNP challenges are documented as "20-digit numbers" (pure ASCII), so UTF-8 is technically correct but semantically imprecise. ASCII or binary encoding would be clearer. This is not a bug (UTF-8 is a superset of ASCII for 7-bit characters).

### No CRLF validation in response parsing

`readMSNLine` searches for `\r\n` terminators but doesn't validate that responses use proper CRLF. If a server sends bare `\n`, the function will timeout instead of parsing. MSNP spec requires `\r\n` terminators.

### Shared timeout timer

All endpoints use a single timeout timer for the entire operation (connection + all commands + responses). If VER takes 9s of a 10s timeout, only 1s remains for CVR/USR. Worst case: total operation time ≈ `timeout` (not `timeout` per phase).

### No connection reuse

Each request opens a new TCP connection and closes it immediately after receiving responses. MSNP servers expect persistent connections for full sessions (presence, messaging, etc.). This implementation is suitable for probing/diagnostics only, not for production messenger clients.

### Hardcoded client version string

CVR commands always report client as `MSNMSGR 8.5.1302` (Windows Live Messenger 8.5) from 2007. Some servers may reject outdated clients or require specific versions. The version is hardcoded and not configurable.

### Email parameter in CVR is optional

The CVR command includes email as the last parameter, but some MSNP versions don't require it. The implementation always sends it (`user@example.com` or `probe@example.com`). Some strict servers may reject CVR with email if not yet authenticated.

### No validation of server challenge format

`handleMSNMD5Login` extracts the challenge from `USR 3 MD5 S <challenge>` but doesn't validate the challenge format. MSNP documentation states challenges are "20-digit numbers" (historically), but modern revival servers may use different formats. The implementation accepts any non-empty string as a valid challenge.

### Protocol version parsing assumes specific order

`handleMSNLogin` and `handleMSNMD5Login` extract negotiated version from `verParts[2]` (first version parameter after TrID). This assumes the server returns versions in the same order as the client sent them. The MSNP spec says servers should echo the highest mutually-supported version first, so this is correct, but brittle if servers deviate.

### Incomplete Tweener authentication

`handleMSNLogin` stops after receiving the Tweener challenge token. Full Tweener/Passport authentication requires:
1. Parsing the challenge token
2. Making HTTPS request to Passport login server with username/password
3. Receiving Passport ticket
4. Sending `USR TrID TWN S <ticket>` to complete login

Steps 2-4 are not implemented. The endpoint is useful for probing Tweener-capable servers but cannot complete login.

### No socket option configuration

All `connect()` calls use `secureTransport: 'off'` and `allowHalfOpen: false`. MSNP traditionally ran over plaintext TCP (TLS was added in MSNP15+ via SSL/TLS negotiation after initial handshake). This implementation doesn't support TLS-upgraded MSNP sessions.

### No server input validation

`host` parameter is passed directly to `connect()` without regex validation or DNS checks. Malformed hostnames, IP addresses, or localhost bypass attempts are not blocked. Port validation only checks range (1-65535).

### Timeout cleanup added recently

Timeout timers created via `setTimeout` were not cleared if operations completed successfully, causing resource leaks. Fixed as of 2026-02-18 — all code paths now call `clearTimeout(timeoutHandle)` before returning or closing sockets.

### Protocol versions supported

Implementation requests MSNP18/17/16/15 for Tweener auth and MSNP7-2 for MD5 auth. Versions MSNP19-21 (final Windows Live Messenger releases) are not requested. These versions added features like P2P v2, shared folders, and OAuth, but the core handshake is compatible with MSNP18.

### CVR0 filtering

The code filters out "CVR0" from the list of supported versions returned to the client. CVR0 is a capability flag (not a protocol version) indicating the server supports the CVR command. Filtering it is correct, but the comment is misleading — CVR0 is not a "protocol version" and should never appear in `supportedVersions` arrays.

---

## Wire Protocol Flow

### Basic Probe (VER only)

```
Client                          Server (:1863)
  │                                  │
  │──── TCP SYN ────────────────────▶│
  │◀─── TCP SYN+ACK ─────────────────│
  │──── TCP ACK ────────────────────▶│
  │                                  │
  │──── VER 1 MSNP18 ... CVR0\r\n ──▶│
  │◀─── VER 1 MSNP18 CVR0\r\n ───────│
  │                                  │
  │──── TCP FIN ────────────────────▶│  ← rtt measured here
  │◀─── TCP FIN+ACK ─────────────────│
```

### Full Login Flow (MSNP8+ Tweener)

```
Client                          Server
  │──── VER 1 MSNP18 ... CVR0\r\n ──▶│
  │◀─── VER 1 MSNP18 CVR0\r\n ───────│
  │──── CVR 2 0x0409 win ...\r\n ───▶│
  │◀─── CVR 2 8.5.1302 ...\r\n ──────│
  │──── USR 3 TWN I user@...\r\n ───▶│
  │◀─── USR 3 TWN S <token>\r\n ─────│
  │                                  │
  │  (Client must authenticate with  │
  │   Passport server — not impl.)   │
  │                                  │
  │──── USR 4 TWN S <ticket>\r\n ───▶│  (not implemented)
  │◀─── USR 4 OK user@...\r\n ───────│  (not implemented)
```

### Legacy MD5 Login Flow (MSNP2-7)

```
Client                          Server
  │──── VER 1 MSNP7 ... CVR0\r\n ───▶│
  │◀─── VER 1 MSNP7 CVR0\r\n ────────│
  │──── INF 2\r\n ──────────────────▶│
  │◀─── INF 2 MD5\r\n ────────────────│
  │──── USR 3 MD5 I user@...\r\n ───▶│
  │◀─── USR 3 MD5 S <challenge>\r\n ──│
  │                                  │
  │  (Client computes MD5 response)  │
  │                                  │
  │──── USR 4 MD5 S <hash>\r\n ─────▶│
  │◀─── USR 4 OK user@...\r\n ───────│
```

---

## curl Examples

### Probe MSN server
```bash
curl -X POST http://localhost:8787/api/msn/probe \
  -H "Content-Type: application/json" \
  -d '{
    "host": "messenger.hotmail.com",
    "port": 1863,
    "protocolVersion": "MSNP18",
    "timeout": 15000
  }'
```

### Test client version command
```bash
curl -X POST http://localhost:8787/api/msn/client-version \
  -H "Content-Type: application/json" \
  -d '{
    "host": "messenger.escargot.chat",
    "port": 1863,
    "timeout": 15000
  }'
```

### Initiate Tweener login
```bash
curl -X POST http://localhost:8787/api/msn/login \
  -H "Content-Type: application/json" \
  -d '{
    "host": "messenger.escargot.chat",
    "port": 1863,
    "email": "user@example.com",
    "protocolVersion": "MSNP18",
    "timeout": 10000
  }'
```

### Attempt MD5 login (MSNP2-7)
```bash
curl -X POST http://localhost:8787/api/msn/md5-login \
  -H "Content-Type: application/json" \
  -d '{
    "host": "messenger.escargot.chat",
    "port": 1863,
    "email": "user@example.com",
    "password": "hunter2",
    "timeout": 12000
  }'
```

### Probe with custom timeout
```bash
curl -X POST http://localhost:8787/api/msn/probe \
  -H "Content-Type: application/json" \
  -d '{
    "host": "65.54.239.210",
    "port": 1863,
    "timeout": 5000
  }'
```

### Test legacy MSNP2 server
```bash
curl -X POST http://localhost:8787/api/msn/md5-login \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 1863,
    "email": "test@localhost",
    "password": "test",
    "timeout": 12000
  }'
```

---

## Revival Servers

Official MSN Messenger servers were shut down in 2013 (except China, which persisted until 2014). Revival/replacement servers exist:

- **Escargot** (messenger.escargot.chat:1863) — Most active revival project, supports MSNP2-21
- **WLM Revival** — Community-run servers for Windows Live Messenger nostalgia
- **Local test servers** — Implement MSNP for protocol research/testing

None are affiliated with Microsoft. Use at your own risk.

---

## References

- [MSNP Protocol Documentation (protogined.wordpress.com)](https://protogined.wordpress.com/msnp2/) — Community-maintained MSNP2-21 protocol specs
- [MSN Messenger Protocol (hypothetic.org)](http://www.hypothetic.org/docs/msn/) — Historical protocol documentation (archived)
- [MSNP Wiki (NINA)](https://wiki.nina.chat/wiki/Protocols/MSNP) — Detailed command reference and authentication flows
- [Escargot MSN Revival](https://escargot.chat/) — Active MSN Messenger revival server
- [Microsoft Notification Protocol (Wikipedia)](https://en.wikipedia.org/wiki/Microsoft_Notification_Protocol) — Protocol overview and history

**Note:** MSNP is a proprietary Microsoft protocol. No IETF RFCs exist. All documentation is reverse-engineered from client implementations.
