# TACACS+ (Port 49) — Power User Reference

Terminal Access Controller Access-Control System Plus. RFC 8907. TCP port 49. AAA for network device administration (Cisco routers/switches, Juniper, Arista, etc.).

Implementation: `src/worker/tacacs.ts` (815 lines)
Routes: `src/worker/index.ts`

## Endpoints

| Endpoint | Method | Purpose | Default timeout | Auth required |
|---|---|---|---|---|
| `/api/tacacs/probe` | POST | Server detection + version probe | 10 000 ms | No (probes with dummy user) |
| `/api/tacacs/authenticate` | POST | Full ASCII LOGIN flow | 15 000 ms | Yes (username + password) |

No Authorization or Accounting endpoints are implemented. The doc's fictional `TACACSClient` class showed `authorize()`, `accountingStart()`, `accountingStop()` — none of these exist.

## `/api/tacacs/probe`

Sends an Authentication START for the hardcoded user `probe-user` and reads the server's REPLY. This is not a passive probe — it generates a real authentication attempt visible in TACACS+ server logs.

### Request

```json
{
  "host": "10.0.0.1",
  "port": 49,
  "secret": "my-shared-secret",
  "timeout": 10000
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `host` | string | Yes | — | Truthiness check only (`if (!host)`); no format regex |
| `port` | number | No | 49 | Validated 1–65535 |
| `secret` | string | No | — | If omitted, sends UNENCRYPTED_FLAG |
| `timeout` | number | No | 10000 | Milliseconds, outer `Promise.race` deadline |

### Response (success)

```json
{
  "success": true,
  "host": "10.0.0.1",
  "port": 49,
  "serverVersion": { "major": 12, "minor": 0 },
  "responseType": "Authentication",
  "seqNo": 2,
  "flags": {
    "encrypted": true,
    "singleConnect": true
  },
  "sessionId": "0xa3f7c201",
  "encrypted": true,
  "reply": {
    "status": "GETPASS",
    "statusCode": 5,
    "serverMsg": "Password: ",
    "data": null
  },
  "connectTimeMs": 23,
  "totalTimeMs": 45
}
```

The `reply.status` on a healthy TACACS+ daemon is typically `GETPASS` (0x05) — the server is asking `probe-user` for a password. Other possible statuses:

| Status | Code | Meaning on probe |
|---|---|---|
| `GETPASS` | 0x05 | Normal — server wants password |
| `GETUSER` | 0x04 | Server wants username (some configs) |
| `GETDATA` | 0x03 | Server wants additional data |
| `FAIL` | 0x02 | Immediate reject (e.g., user denied by ACL) |
| `ERROR` | 0x07 | Server-side error |
| `RESTART` | 0x06 | Server wants to restart authentication |
| `FOLLOW` | 0x21 | Redirect to alternate server |

### Encryption mode

Without `secret`: sets `TAC_PLUS_UNENCRYPTED_FLAG` (0x01) in header flags. Body is sent as cleartext. Most production TACACS+ daemons reject unencrypted packets — use this only for testing against permissive configs.

With `secret`: body is XOR-encrypted with an MD5 pseudo-random pad per RFC 8907 §4.5. The pad is computed as:

```
pad_1 = MD5(session_id || secret || version || seq_no)
pad_n = MD5(session_id || secret || version || seq_no || pad_{n-1})
```

Session ID is 4 bytes big-endian. Version is the full version byte (0xc0). Seq_no is 1 byte.

## `/api/tacacs/authenticate`

Full ASCII authentication LOGIN flow: START → REPLY → (if GETPASS/GETDATA) → CONTINUE → final REPLY.

### Request

```json
{
  "host": "10.0.0.1",
  "port": 49,
  "secret": "my-shared-secret",
  "username": "admin",
  "password": "cisco123",
  "timeout": 15000
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `host` | string | Yes | — | Validated |
| `port` | number | No | 49 | Validated 1–65535 |
| `secret` | string | No | — | If omitted, unencrypted mode |
| `username` | string | Yes | — | Sent in START body |
| `password` | string | No | — | Sent in CONTINUE; defaults to `""` if missing |
| `timeout` | number | No | 15000 | Milliseconds |

**Note:** `password` is not validated as required. If omitted, `buildAuthenContinue` is called with empty string. This will almost always result in `FAIL` from the server.

### Response (success)

```json
{
  "success": true,
  "authenticated": true,
  "host": "10.0.0.1",
  "port": 49,
  "username": "admin",
  "encrypted": true,
  "finalStatus": "PASS",
  "finalMessage": null,
  "steps": [
    { "step": "Authentication START", "status": "sent" },
    { "step": "First REPLY", "status": "GETPASS", "message": "Password: " },
    { "step": "Authentication CONTINUE", "status": "sent" },
    { "step": "Final REPLY", "status": "PASS" }
  ],
  "connectTimeMs": 18,
  "totalTimeMs": 52
}
```

`authenticated` is `true` only when `finalStatus === 'PASS'`. The `steps` array shows the full dialog exchange.

### Wire exchange

```
Client                          Server
  │                                │
  │─── Authentication START ──────►│  seq_no=1 (action=LOGIN, type=ASCII, user=<username>)
  │                                │
  │◄── Authentication REPLY ───────│  seq_no=2 (status=GETPASS, msg="Password: ")
  │                                │
  │─── Authentication CONTINUE ───►│  seq_no=3 (user_msg=<password>)
  │                                │
  │◄── Authentication REPLY ───────│  seq_no=4 (status=PASS or FAIL)
  │                                │
```

If the first REPLY is `PASS` or `FAIL` (not `GETPASS`/`GETDATA`), the CONTINUE step is skipped and `finalStatus` is set from the first reply.

## Packet format

### Header (12 bytes, always unencrypted)

```
Byte 0:     [major:4][minor:4]    version (0xc0 = major 12, minor 0)
Byte 1:     type                   0x01=Authen, 0x02=Author, 0x03=Acct
Byte 2:     seq_no                 client=odd (1,3,5...), server=even (2,4,6...)
Byte 3:     flags                  0x01=UNENCRYPTED, 0x04=SINGLE_CONNECT
Bytes 4-7:  session_id             big-endian uint32
Bytes 8-11: body_length            big-endian uint32
```

### Authentication START body

```
Byte 0:     action        0x01=LOGIN (hardcoded)
Byte 1:     priv_lvl      0x01=user (hardcoded)
Byte 2:     authen_type   0x01=ASCII (hardcoded)
Byte 3:     service       0x01=LOGIN (hardcoded)
Byte 4:     user_len
Byte 5:     port_len      (4 = "tty0")
Byte 6:     rem_addr_len  (10 = "web-client")
Byte 7:     data_len      (0)
Bytes 8+:   user || port || rem_addr || data
```

### Authentication CONTINUE body

```
Bytes 0-1:  user_msg_len  big-endian uint16
Bytes 2-3:  data_len      big-endian uint16 (always 0)
Byte 4:     flags         (0x00)
Bytes 5+:   user_msg      (the password)
```

### Authentication REPLY body

```
Byte 0:     status        see status table
Byte 1:     flags
Bytes 2-3:  server_msg_len  big-endian uint16
Bytes 4-5:  data_len        big-endian uint16
Bytes 6+:   server_msg || data
```

## Quirks and limitations

1. **Probe is not passive.** `/probe` sends an Authentication START for `probe-user`. This shows up in TACACS+ server logs as a failed auth attempt. There is no lightweight TCP-only probe.

2. **No password validation in `/authenticate`.** The `password` field is not checked as required. If omitted, an empty string is sent as the CONTINUE user_msg. The server will return FAIL but no HTTP 400.

3. **Hardcoded privilege level 1.** Authentication START always sets `priv_lvl=1` (user level). Cannot probe enable-mode (priv 15) authentication. Not configurable via API.

4. **Hardcoded port name `tty0` and remote address `web-client`.** These appear in the Authentication START body. Some TACACS+ servers use port/rem_addr for per-port authorization policies. Not configurable via API.

5. **Only ASCII authentication type.** No PAP (0x02), CHAP (0x03), MS-CHAP (0x05), or MS-CHAPv2 (0x06). ASCII is the interactive dialog type where the server prompts for data and the client responds. PAP sends credentials in a single START packet (more efficient, no CONTINUE needed).

6. **GETUSER (0x04) not handled.** If the server replies with GETUSER instead of GETPASS, `/authenticate` does not send a CONTINUE with the username. It sets `finalStatus='GETUSER'` and returns. Only GETPASS (0x05) and GETDATA (0x03) trigger a CONTINUE.

7. **SINGLE_CONNECT_FLAG always set but connection not reused.** Both endpoints set the `TAC_PLUS_SINGLE_CONNECT_FLAG` (0x04) in the header, signaling the server that multiple sessions can share one TCP connection. But the connection is closed after a single exchange. Harmless but misleading.

8. **Session ID uses `Math.random()`.** Not cryptographically secure. RFC 8907 §4.3 says session_id SHOULD be unpredictable. Predictable session IDs could theoretically enable replay attacks on unencrypted connections.

9. **No body length upper bound.** If a server (or MITM) returns a large `body_length` value, `readExactBytes` will attempt to allocate and read that many bytes. No cap to prevent memory exhaustion.

10. **MD5 implementation is custom pure-JS.** Not imported from Node.js crypto (which doesn't exist in Workers). The implementation is a textbook MD5 (RFC 1321) — correct but unaudited. Used for both encryption pad generation and the `FOLLOW` status code table is present but FOLLOW redirect is not followed.

11. **No Authorization or Accounting.** Only Authentication (type 0x01) is implemented. No `cmd=` / `cmd-arg=` authorization requests (type 0x02) and no start/stop/watchdog accounting records (type 0x03).

12. **Error responses are always HTTP 500.** Connection timeouts, malformed responses, and server errors all return `{ success: false, error: "..." }` with status 500. No HTTP 502/504 distinction.

## Curl examples

### Probe (unencrypted)

```bash
curl -s http://localhost:8787/api/tacacs/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1"}' | jq .
```

### Probe (encrypted)

```bash
curl -s http://localhost:8787/api/tacacs/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1","secret":"testing123"}' | jq .
```

### Authenticate

```bash
curl -s http://localhost:8787/api/tacacs/authenticate \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1","secret":"testing123","username":"admin","password":"cisco"}' | jq .
```

## Local testing

### tac_plus (open-source TACACS+ daemon)

```bash
# Install (Debian/Ubuntu)
apt-get install tacacs+

# /etc/tacacs+/tac_plus.conf
key = testing123

user = admin {
    default service = permit
    login = cleartext "cisco"
}

# Start
tac_plus -C /etc/tacacs+/tac_plus.conf -G -d 16

# -G = foreground, -d 16 = debug level
```

### Docker

```bash
docker run -d --name tacacs -p 49:49 \
  -e TACACS_SECRET=testing123 \
  lfkeitel/tacacs_plus
```

## Authentication status reference

| Code | Name | Hex | Meaning |
|---|---|---|---|
| 1 | PASS | 0x01 | Authentication successful |
| 2 | FAIL | 0x02 | Authentication failed |
| 3 | GETDATA | 0x03 | Server needs more data |
| 4 | GETUSER | 0x04 | Server needs username |
| 5 | GETPASS | 0x05 | Server needs password |
| 6 | RESTART | 0x06 | Restart authentication |
| 7 | ERROR | 0x07 | Server error |
| 33 | FOLLOW | 0x21 | Redirect to alternate server |
