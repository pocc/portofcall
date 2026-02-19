# SNPP — Power User Reference

**Port:** 444 | **Protocol:** SNPP RFC 1861 | **Tests:** Deployed

Simple Network Paging Protocol is a text-based TCP protocol for sending pages (messages) to pagers/beepers. It uses a command-response model with numeric status codes similar to SMTP and FTP. Port of Call implements SNPP Level 1 (basic paging) with two endpoints: a connectivity probe and a page sender.

---

## API Endpoints

### `POST /api/snpp/probe` — Connectivity probe

Connects to an SNPP server, reads the `220` greeting banner, sends `QUIT`, and closes. GET is rejected with HTTP 405.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `444`   | Standard SNPP port |
| `timeout` | number | `10000` | Total timeout in ms (1-300000) |

**Success (200):**
```json
{
  "success": true,
  "host": "pager.example.com",
  "port": 444,
  "banner": "220 pager.example.com SNPP Gateway ready",
  "serverInfo": "220 pager.example.com SNPP Gateway ready | QUIT: 221 Goodbye",
  "rtt": 245
}
```

The `serverInfo` field combines the initial banner with the QUIT response if the server sends one.

**Error (500):**
```json
{
  "success": false,
  "host": "",
  "port": 444,
  "error": "Connection timeout"
}
```

**Unexpected banner (200 with success: false):**
```json
{
  "success": false,
  "host": "pager.example.com",
  "port": 444,
  "banner": "421 Service unavailable",
  "serverInfo": "421 Service unavailable",
  "rtt": 156,
  "error": "Unexpected response: 421 Service unavailable"
}
```

Success is `true` only if the banner starts with `220`. Any other response code (421, 550, etc.) returns `success: false` with the full response text in `error`.

**curl example:**
```bash
# Probe an SNPP server
curl -s https://portofcall.ross.gg/api/snpp/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"pager.example.com","port":444}' \
  | jq '{success,banner,rtt}'
```

---

### `POST /api/snpp/page` — Send a page

Executes the full SNPP Level 1 paging transaction: `PAGE <id>` → `MESS <message>` → `SEND` → `QUIT`. GET is rejected with HTTP 405.

**POST body:**

| Field      | Type   | Required | Default | Notes |
|------------|--------|----------|---------|-------|
| `host`     | string | ✅       | —       | |
| `port`     | number | —        | `444`   | |
| `pagerId`  | string | ✅       | —       | Pager ID (phone number, PIN, or alphanumeric ID) |
| `message`  | string | ✅       | —       | Message text (max 256 chars) |
| `timeout`  | number | —        | `15000` | Total timeout in ms (1-300000) |

**Input validation:**
- `pagerId` and `message` cannot contain `\r` or `\n` characters (prevents command injection)
- `message` max length is 256 characters (standard SNPP message limit)
- `port` must be 1-65535
- `timeout` must be 1-300000ms

**Success (200):**
```json
{
  "success": true,
  "host": "pager.example.com",
  "port": 444,
  "pagerId": "5551234567",
  "pageResponse": "250 Pager ID Accepted",
  "sendResponse": "250 Message Queued for Delivery",
  "transcript": [
    "S: 220 pager.example.com SNPP Gateway ready",
    "C: PAGE 5551234567",
    "S: 250 Pager ID Accepted",
    "C: MESS Your server is down",
    "S: 250 Message OK",
    "C: SEND",
    "S: 250 Message Queued for Delivery",
    "C: QUIT",
    "S: 221 Goodbye"
  ],
  "rtt": 387
}
```

Success is `true` if the SEND response starts with `250` (queued for delivery) or `860` (queued with coverage information, Level 2 extension). The full command/response transcript is returned in the `transcript` array for debugging.

**PAGE command failed (200 with success: false):**
```json
{
  "success": false,
  "host": "pager.example.com",
  "port": 444,
  "pagerId": "invalid",
  "pageResponse": "550 Invalid Pager ID",
  "transcript": [
    "S: 220 pager.example.com SNPP Gateway ready",
    "C: PAGE invalid",
    "S: 550 Invalid Pager ID"
  ],
  "error": "PAGE command failed: 550 Invalid Pager ID"
}
```

**Validation error (400):**
```json
{
  "error": "Message cannot contain CR or LF characters"
}
```

**curl example:**
```bash
# Send a page
curl -s https://portofcall.ross.gg/api/snpp/page \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "pager.example.com",
    "port": 444,
    "pagerId": "5551234567",
    "message": "Your server is down - check /var/log/messages"
  }' \
  | jq '{success,sendResponse,rtt}'
```

---

## Wire Exchange

### Probe flow

```
→ (TCP connect to port 444)
← 220 pager.example.com SNPP Gateway ready\r\n
→ QUIT\r\n
← 221 Goodbye\r\n
```

### Page flow

```
→ (TCP connect to port 444)
← 220 pager.example.com SNPP Gateway ready\r\n
→ PAGE 5551234567\r\n
← 250 Pager ID Accepted\r\n
→ MESS Your server is down\r\n
← 250 Message OK\r\n
→ SEND\r\n
← 250 Message Queued for Delivery\r\n
→ QUIT\r\n
← 221 Goodbye\r\n
```

All commands and responses are terminated with `\r\n` (CRLF). Commands are case-insensitive but the implementation sends uppercase.

---

## SNPP Response Codes

SNPP uses numeric status codes in the same style as SMTP/FTP. The first digit indicates the response class; the implementation checks only the 3-digit prefix (e.g., `250`, `550`).

| Code | Meaning | When seen |
|------|---------|-----------|
| `220` | Service ready | Server greeting banner |
| `221` | Service closing | QUIT response |
| `250` | OK / Success | PAGE, MESS, SEND acknowledgment |
| `421` | Service not available | Server overloaded or shutting down |
| `500` | Syntax error / unrecognized command | Invalid command or argument |
| `550` | Error / failure | Pager ID not found, message rejected, etc. |
| `860` | Message queued with coverage info | SEND response (Level 2 extension) |

The implementation treats `250` and `860` as success for the SEND command. All other codes are failures.

---

## SNPP Protocol Levels

SNPP has three capability levels defined in RFC 1861:

### Level 1 (Implemented)
Basic one-way paging with minimal commands:
- `PAGE <pager_id>` — Set the destination pager ID
- `MESS <message>` — Set the message text
- `SEND` — Transmit the page
- `QUIT` — Disconnect
- `RESE` — Reset the current page (cancel without sending)
- `HELP` — Request help text

Port of Call implements `PAGE`, `MESS`, `SEND`, and `QUIT`. `RESE` and `HELP` are not implemented (servers rarely enforce these, and the typical flow is to disconnect on error rather than reset).

### Level 2 (Not Implemented)
Adds scheduling and authentication:
- `LOGIn <username> [<password>]` — Authenticate
- `LEVEl <service_level>` — Set urgency/priority
- `COVErage` — Query pager coverage
- `HOLDuntil <YYMMDDHHMMSS>` — Schedule delivery
- `CALLerid <number>` — Set caller ID

### Level 3 (Not Implemented)
Two-way paging:
- `2WAY` — Enable two-way paging
- `MCREsponse` — Request message confirmation response
- `MSTA` — Query message status

Port of Call does not implement Level 2 or Level 3 commands. If your SNPP server requires authentication (`LOGIn`), the connection will fail after the PAGE or MESS command.

---

## Protocol Compliance Notes

### RFC 1861 (SNPP v1)

The implementation follows RFC 1861 for basic Level 1 paging:
- Commands are sent in uppercase with `\r\n` termination
- Responses are parsed as 3-digit numeric codes followed by optional text
- `PAGE` must precede `MESS`, and `SEND` must follow `MESS`
- Server may respond immediately after `SEND` or queue the page asynchronously

### Response parsing

`readLine()` accumulates bytes until it finds `\r\n` (or just `\n` as a fallback for non-compliant servers). Multi-line responses are not expected in Level 1 SNPP; each command produces exactly one response line.

### Message length

The SNPP RFC does not mandate a maximum message length, but most pagers have hardware limits:
- Numeric pagers: 10-20 digits
- Alphanumeric pagers: 240 characters (typical), 256 characters (max)
- Modern SMS gateways: 160 characters (1 SMS segment) or 1600 characters (concatenated SMS)

The implementation enforces a **256 character limit** on `message` to match common alphanumeric pager limits. Servers may truncate longer messages or reject them with `550`.

---

## Known Limitations

### No authentication

The implementation does not support `LOGIn` (Level 2). If your SNPP server requires authentication, the PAGE or MESS command will fail with `550` or similar.

**Workaround:** Use an open/anonymous SNPP gateway, or run an SNPP proxy that handles authentication and forwards to the downstream server.

### No TLS

SNPP does not have a TLS variant or STARTTLS extension. All communication is plaintext TCP. Use SSH tunneling or a VPN if you need encryption:

```bash
# SSH tunnel to an SNPP server
ssh -L 444:pager.example.com:444 user@jumphost

# Then connect to localhost:444
curl -s https://portofcall.ross.gg/api/snpp/page \
  -d '{"host":"YOUR_WORKER_IP","port":444,"pagerId":"...","message":"..."}'
```

### Single pager per transaction

Each `/api/snpp/page` request sends to exactly one `pagerId`. To send the same message to multiple pagers, call the endpoint multiple times (or use the `ALERt` command if the server supports it, which is Level 2).

### No delivery confirmation

The implementation sends `SEND` and receives `250 Message Queued`, but it does **not** wait for actual delivery confirmation. SNPP is a store-and-forward protocol; the `250` code means the message was accepted by the gateway, not that the pager received it. Level 3's `MSTA` command provides delivery tracking, but it is not implemented.

### No retry on 421 (service unavailable)

If the server responds with `421` (service not available), the request fails immediately. SMTP clients typically retry 421 errors; SNPP clients should do the same, but the implementation leaves retry logic to the caller.

### No RESE or HELP

`RESE` (reset current page) and `HELP` (request help text) are part of Level 1 but not implemented. Servers rarely enforce these; most accept just `PAGE`, `MESS`, `SEND`, `QUIT`.

### Command injection protection

`pagerId` and `message` are validated to reject `\r` and `\n` characters. This prevents an attacker from injecting extra SNPP commands like:

```
pagerId = "5551234567\r\nMESS injected message\r\nSEND"
```

Without validation, this would send two pages. The check blocks this attack.

---

## Error Handling

### Network errors

Connection timeouts, DNS failures, and socket errors throw exceptions and return HTTP 500:

```json
{
  "success": false,
  "host": "",
  "port": 444,
  "pagerId": "",
  "transcript": [],
  "error": "Connection timeout"
}
```

### SNPP protocol errors

If the server rejects a command with a non-250 response, the implementation sends `QUIT` (best effort) and returns HTTP 200 with `success: false`:

```json
{
  "success": false,
  "host": "pager.example.com",
  "port": 444,
  "pagerId": "invalid",
  "pageResponse": "550 Invalid Pager ID",
  "transcript": ["S: 220 ...", "C: PAGE invalid", "S: 550 Invalid Pager ID"],
  "error": "PAGE command failed: 550 Invalid Pager ID"
}
```

The `transcript` array contains the full command/response exchange for debugging.

---

## Local Testing

SNPP servers are rare in 2026. Most legacy paging infrastructure has been shut down. To test the implementation:

### Option 1: Mock SNPP server (netcat)

```bash
# Simple echo server that responds with valid SNPP codes
while true; do
  nc -l 444 <<'EOF'
220 Mock SNPP Server ready
250 PAGE OK
250 MESS OK
250 SEND OK
221 Goodbye
EOF
done
```

Then:
```bash
curl -s https://portofcall.ross.gg/api/snpp/page \
  -d '{"host":"YOUR_LOCAL_IP","port":444,"pagerId":"test","message":"hello"}'
```

This mock server does not parse commands; it just sends fixed responses. It's enough to test the happy path.

### Option 2: smpppd (Perl SNPP daemon)

Install `smpppd` on a Linux box:

```bash
# Debian/Ubuntu
apt-get install smpppd

# Configure /etc/smpppd.conf
# Start the daemon
/etc/init.d/smpppd start
```

`smpppd` is a full SNPP Level 1 server that can forward pages to email, SMS gateways, or scripts.

### Option 3: Public test servers

No known public SNPP test servers exist as of 2026. Legacy paging networks (SkyTel, PageNet) are offline. If you have access to a TAP/IXO paging modem, you can run an SNPP-to-TAP gateway locally.

---

## Use Cases

SNPP was designed in the 1990s for alphanumeric pagers. Modern use cases are rare but include:

1. **Legacy infrastructure integration** — Interfacing with old hospital or emergency systems that still use SNPP
2. **SMS gateway fallback** — Some SMS gateways expose SNPP as a lightweight alternative to SMPP or HTTP APIs
3. **Industrial monitoring** — SCADA systems that trigger SNPP alerts to operator pagers
4. **Historical reenactment** — Running retro paging systems for fun or education

---

## Response Code Reference (Complete)

RFC 1861 §4 defines these codes:

| Code | Text | Description |
|------|------|-------------|
| `220` | Service Ready | Server ready to accept commands |
| `221` | Closing Connection | QUIT acknowledged |
| `250` | OK | Command succeeded |
| `421` | Service Unavailable | Server shutting down or overloaded |
| `500` | Command Not Recognized | Invalid command or syntax error |
| `550` | Error | Generic failure (pager not found, message rejected, etc.) |
| `554` | Transaction Failed | Command succeeded but action could not be completed |
| `860` | Queued for Delivery (coverage info) | Level 2 SEND response with coverage area details |

Level 2 and Level 3 add additional codes (e.g., `860`, `960`), but the implementation only checks for `250` and `860` as success codes.

---

## Resources

- [RFC 1861 — Simple Network Paging Protocol (SNPP) Version 1](https://www.rfc-editor.org/rfc/rfc1861)
- [RFC 1645 — SNPP Version 2](https://www.rfc-editor.org/rfc/rfc1645) (Level 2 commands)
- [Wikipedia: Pager](https://en.wikipedia.org/wiki/Pager)
- [smpppd](https://packages.debian.org/buster/smpppd) — Perl SNPP daemon
