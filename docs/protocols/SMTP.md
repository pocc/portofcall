# SMTP — Power User Reference

**Ports:** 25 (relay), 587 (submission), 465 (SMTPS) | **Protocol:** SMTP RFC 5321 | **Tests:** 14/14 ✅ Deployed

Port of Call provides two SMTP endpoints: a connectivity probe and an email sender. Both open a plain TCP connection from the Cloudflare Worker to the target host. **TLS is not supported** — see [TLS / STARTTLS Limitations](#tls--starttls-limitations) below before connecting to port 587 or 465.

---

## API Endpoints

### `GET/POST /api/smtp/connect` — Connectivity probe

Connects, reads the `220` greeting, sends `EHLO portofcall`, reads the capability list, sends `QUIT`, and closes.

**POST body / GET query params:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `25`    | |
| `timeout` | number | `30000` | Total timeout in ms |

Note: `username`, `password`, and `useTLS` fields are accepted in the body but **not used** by the connect probe.

**Success (200):**
```json
{
  "success": true,
  "message": "SMTP server reachable",
  "host": "mail.example.com",
  "port": 25,
  "greeting": "220 mail.example.com ESMTP Postfix",
  "capabilities": "250-mail.example.com\r\n250-PIPELINING\r\n250-SIZE 10240000\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN\r\n250 ENHANCEDSTATUSCODES",
  "note": "This is a connectivity test. Use the send feature to send emails."
}
```

The `capabilities` field is the raw multi-line EHLO response (all `250-…` continuation lines plus the final `250` line), joined with `\r\n`. Parse it yourself to extract extensions.

**Error (500):**
```json
{ "success": false, "error": "EHLO failed: 503 Bad sequence of commands" }
```

**Cloudflare-protected host (403):**
```json
{ "success": false, "error": "...", "isCloudflare": true }
```

**curl example:**
```bash
# Probe an MTA
curl -s https://portofcall.ross.gg/api/smtp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"mail.example.com","port":25}' \
  | jq '{greeting,capabilities}'

# GET form
curl -s 'https://portofcall.ross.gg/api/smtp/connect?host=mail.example.com&port=25'
```

---

### `POST /api/smtp/send` — Send email

Connects, runs the full SMTP transaction, and closes. GET is rejected with HTTP 405.

**POST body:**

| Field      | Type   | Required | Default | Notes |
|------------|--------|----------|---------|-------|
| `host`     | string | ✅       | —       | |
| `port`     | number | —        | `25`    | |
| `username` | string | —        | —       | Triggers `AUTH LOGIN` |
| `password` | string | —        | —       | Required if `username` set |
| `from`     | string | ✅       | —       | Used in `MAIL FROM:<...>` and `From:` header |
| `to`       | string | ✅       | —       | Single address; used in `RCPT TO:<...>` and `To:` header |
| `subject`  | string | ✅       | —       | `Subject:` header |
| `body`     | string | ✅       | —       | Plain text only |
| `timeout`  | number | —        | `30000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "message": "Email sent successfully",
  "host": "mail.example.com",
  "port": 25,
  "from": "sender@example.com",
  "to": "recipient@example.com"
}
```

**Validation error (400):**
```json
{ "error": "Missing required parameters: host, from, to, subject, body" }
```

All five fields must be present; if any is missing the check fires with this combined message.

**curl example:**
```bash
curl -s https://portofcall.ross.gg/api/smtp/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "mail.example.com",
    "port": 587,
    "username": "user@example.com",
    "password": "secret",
    "from": "user@example.com",
    "to": "recipient@example.com",
    "subject": "Test from Port of Call",
    "body": "Hello from the wire."
  }'
```

---

## Wire Exchange

### Connect probe

```
→ (TCP connect)
← 220 mail.example.com ESMTP Postfix\r\n
→ EHLO portofcall\r\n
← 250-mail.example.com\r\n
   250-PIPELINING\r\n
   250-SIZE 10240000\r\n
   250-STARTTLS\r\n
   250 AUTH PLAIN LOGIN\r\n
→ QUIT\r\n
← 221 Bye\r\n
```

### Send — unauthenticated

```
→ (TCP connect)
← 220 mail.example.com ESMTP Postfix\r\n
→ EHLO portofcall\r\n
← 250 …\r\n
→ MAIL FROM:<sender@example.com>\r\n
← 250 Ok\r\n
→ RCPT TO:<recipient@example.com>\r\n
← 250 Ok\r\n
→ DATA\r\n
← 354 End data with <CR><LF>.<CR><LF>\r\n
→ From: sender@example.com\r\n
   To: recipient@example.com\r\n
   Subject: Test\r\n
   \r\n
   Hello from the wire.\r\n
   .\r\n
← 250 Ok: queued as ABC123\r\n
→ QUIT\r\n
← 221 Bye\r\n
```

### Send — AUTH LOGIN

```
→ EHLO portofcall\r\n
← 250 …\r\n
→ AUTH LOGIN\r\n
← 334 VXNlcm5hbWU6\r\n          (base64 "Username:")
→ dXNlckBleGFtcGxlLmNvbQ==\r\n  (base64 of username)
← 334 UGFzc3dvcmQ6\r\n           (base64 "Password:")
→ c2VjcmV0\r\n                   (base64 of password)
← 235 2.7.0 Authentication successful\r\n
→ MAIL FROM:<sender@example.com>\r\n
…
```

---

## Response Parsing

`readSMTPResponse` accumulates chunks until the buffer matches `/\d{3}\s.*\r\n$/` — a final response line (3 digits + space, not dash). This correctly handles multi-line EHLO responses.

`parseSMTPResponse` splits on `\n` and extracts the code from the **last line**. The full raw text (all continuation lines) is in `message`.

---

## Known Limitations

### TLS / STARTTLS Limitations

**This is the most important limitation for real-world use.**

The worker uses `connect()` (plain TCP) only. There is no TLS socket and no STARTTLS negotiation.

| Port | Protocol | What happens |
|------|----------|--------------|
| 25   | SMTP relay | Plain TCP. Works for open relays, MTA-to-MTA testing. Most cloud-provider egress on port 25 is blocked; results depend on the Worker's origin IP. |
| 587  | Submission + STARTTLS | Server advertises `STARTTLS` in EHLO response; the worker does not negotiate it. Credentials are sent in cleartext after `AUTH LOGIN`. Most servers (Gmail, Outlook, Sendgrid) will reject the connection or the auth. |
| 465  | SMTPS (implicit TLS) | Server expects TLS from byte 0. Plain TCP connection will receive no `220` greeting; instead the socket will produce garbage or the server will drop it. Connect probe will throw `Invalid SMTP greeting`. |

For testing against servers that require TLS, use a local tool (swaks, openssl s_client) or a TLS-terminating proxy.

**`useTLS` field:** accepted in the request body but completely ignored by both endpoints. It has no effect.

### AUTH LOGIN only

Only `AUTH LOGIN` (RFC 4616 variant with base64-encoded username and password exchange) is implemented. The following are **not supported**:

- `AUTH PLAIN` — single base64-encoded `\0user\0pass` string
- `AUTH CRAM-MD5` — challenge-response
- `AUTH XOAUTH2` — OAuth 2.0 bearer tokens (required by Gmail/Google Workspace)
- `AUTH GSSAPI`, `AUTH NTLM`, `AUTH DIGEST-MD5`

If the server's EHLO response lists `AUTH PLAIN` but not `AUTH LOGIN`, the worker will still send `AUTH LOGIN` and the server will respond with an error.

`btoa()` is used for base64 encoding — this will silently corrupt usernames or passwords containing non-Latin1 characters (code points > 255).

### Single recipient

`to` accepts exactly one address string. There is no multi-recipient support, no CC, and no BCC. To send to multiple recipients, call `/api/smtp/send` once per address.

### Minimal message headers

The DATA section contains only `From:`, `To:`, and `Subject:` headers:

```
From: sender@example.com
To: recipient@example.com
Subject: Test subject

Message body here.
```

Missing headers that spam filters and MUAs rely on:
- `Date:` — RFC 5321 requires this; some servers add it automatically, others reject the message
- `Message-ID:` — deduplication and threading
- `MIME-Version:` and `Content-Type:` — messages are plain text only; HTML and attachments are not supported
- `Reply-To:`, `Cc:`, `Bcc:`, `X-Mailer:`

### No dot-stuffing (RFC 5321 §4.5.2)

RFC 5321 requires that any line in the DATA body beginning with `.` be doubled to `..` to prevent premature termination. This implementation does **not** perform dot-stuffing. If `body` contains a line that starts with `.` (e.g., a PEM certificate, a diff, or a markdown item starting with `...`), that line will terminate the DATA section early, likely causing a `500` or mangled message.

### EHLO hostname is always `portofcall`

The greeting sent is always `EHLO portofcall` regardless of the Worker's actual hostname. Some strict MTAs validate that the EHLO argument resolves to the connecting IP; they may reject with `550 5.7.1 client not authorized` or similar.

### No pipelining

Each command is sent and its response is awaited before the next command is issued, despite many servers advertising `PIPELINING` in EHLO. Not a correctness issue, but adds RTT overhead.

### No RSET on partial failure

If `AUTH LOGIN` receives an unexpected code at the username step, the error propagates immediately without sending `RSET`. The connection is closed but the server-side state may be left in an inconsistent auth sequence.

---

## Local Testing (MailHog)

The test file includes a MailHog config (disabled by default). MailHog is the easiest way to exercise auth and the full send flow locally:

```bash
docker run -d -p 1025:1025 -p 8025:8025 mailhog/mailhog
```

Then:
```bash
curl -s https://portofcall.ross.gg/api/smtp/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"YOUR_LOCAL_IP","port":1025,"from":"a@b.com","to":"c@d.com","subject":"hi","body":"test"}'
```

MailHog accepts any sender and recipient, does not require auth, and displays received messages at `http://localhost:8025`. It's the only realistic way to test the send flow without an open relay.

Alternatively, use **smtp4dev** (`docker run -p 2525:25 rnwood/smtp4dev`) or **Mailtrap** (cloud sandbox, provides SMTP credentials that work from external IPs).

---

## SMTP Response Codes Reference

| Code | Meaning | When seen |
|------|---------|-----------|
| `220` | Service ready | Server greeting |
| `221` | Service closing | QUIT response |
| `235` | Authentication successful | After correct password in AUTH LOGIN |
| `250` | Requested action OK | EHLO (per-capability line), MAIL FROM, RCPT TO, DATA terminator |
| `334` | Server challenge | During AUTH LOGIN (each credential prompt) |
| `354` | Start mail input | After DATA command |
| `421` | Service unavailable | Server overloaded or shutting down |
| `450` | Mailbox unavailable (temporary) | Greylisting; retry later |
| `451` | Aborted; server error | Transient failure |
| `500` | Unrecognised command | Sent unknown verb |
| `501` | Syntax error in parameters | Bad argument to command |
| `503` | Bad sequence of commands | E.g., MAIL FROM before EHLO |
| `530` | Authentication required | Must authenticate before sending |
| `535` | Authentication failed | Wrong credentials |
| `550` | Mailbox unavailable (permanent) | Non-existent recipient, policy rejection |
| `554` | Transaction failed | General permanent failure |

---

## Resources

- [RFC 5321 — SMTP](https://www.rfc-editor.org/rfc/rfc5321)
- [RFC 4954 — SMTP Auth Extension](https://www.rfc-editor.org/rfc/rfc4954)
- [RFC 3207 — STARTTLS](https://www.rfc-editor.org/rfc/rfc3207)
- [AUTH LOGIN spec](https://www.ietf.org/archive/id/draft-murchison-sasl-login-00.txt)
- [MailHog](https://github.com/mailhog/MailHog) — local SMTP test server
