# LMTP (Local Mail Transfer Protocol) — Power User Documentation

## Protocol Overview

**RFC:** [RFC 2033](https://datatracker.ietf.org/doc/html/rfc2033) (Informational, October 1996)
**Port:** 24 (TCP) or Unix socket
**Purpose:** Final mail delivery to mailboxes without queueing

LMTP is nearly identical to SMTP but designed for local delivery agents (LDAs) that don't manage mail queues. It provides per-recipient delivery status instead of a single status for all recipients.

### Key Differences from SMTP

| Feature | SMTP | LMTP |
|---------|------|------|
| Handshake | `EHLO` / `HELO` | `LHLO` only |
| DATA Response | Single status for all recipients | One status per recipient |
| Queueing | Server may queue | Must accept or reject immediately |
| Default Port | 25 | 24 or Unix socket |
| HELO/EHLO Support | Required | MUST reject (500 error) |

### Common Implementations

- **Dovecot LMTP** — Delivers to user mailboxes
- **Cyrus IMAP** — Built-in LMTP server
- **Postfix** — Uses LMTP for local delivery via `lmtp` transport

---

## Protocol Flow

```
Client                          Server
  |                               |
  |---- TCP Connect ------------->|
  |<--- 220 Greeting -------------|
  |                               |
  |---- LHLO portofcall --------->|
  |<--- 250-server.example.com ---|
  |<--- 250-PIPELINING ----------|
  |<--- 250 8BITMIME -------------|
  |                               |
  |---- MAIL FROM:<sender> ------>|
  |<--- 250 OK -------------------|
  |                               |
  |---- RCPT TO:<user1> --------->|
  |<--- 250 OK -------------------|
  |                               |
  |---- RCPT TO:<user2> --------->|
  |<--- 250 OK -------------------|
  |                               |
  |---- DATA -------------------->|
  |<--- 354 Start mail input -----|
  |---- (message content) ------->|
  |---- . ----------------------->|
  |<--- 250 user1 delivered ------|  ← Per-recipient
  |<--- 550 user2 no mailbox -----|  ← Per-recipient
  |                               |
  |---- QUIT -------------------->|
  |<--- 221 Bye ------------------|
```

**Critical:** After DATA termination (`\r\n.\r\n`), the server sends **one status line per accepted RCPT TO**, in the order recipients were specified.

---

## Commands

### LHLO (LMTP Hello)

**Syntax:** `LHLO <client-domain>`
**Responses:**
- `250-<server-domain>` (first line)
- `250-<capability>` (continuation lines)
- `250 <last-capability>` (final line with space)

**Example:**
```
C: LHLO portofcall
S: 250-mail.example.com
S: 250-PIPELINING
S: 250-ENHANCEDSTATUSCODES
S: 250 8BITMIME
```

**Notes:**
- LMTP servers MUST reject `HELO` and `EHLO` with `500` (RFC 2033)
- Identical semantics to SMTP's `EHLO`
- Required extensions: `PIPELINING`, `ENHANCEDSTATUSCODES`
- Recommended extension: `8BITMIME`

### MAIL FROM

**Syntax:** `MAIL FROM:<sender@example.com>`
**Responses:**
- `250` — Accepted
- `552` — Insufficient storage
- `451` — Temporary failure

**Example:**
```
C: MAIL FROM:<alice@example.com>
S: 250 2.1.0 Sender OK
```

### RCPT TO

**Syntax:** `RCPT TO:<recipient@example.com>`
**Responses:**
- `250` — Recipient accepted
- `251` — User not local, will forward (also success)
- `550` — User does not exist
- `551` — User not local (no forwarding)
- `552` — Mailbox full
- `450` — Mailbox temporarily unavailable

**Example:**
```
C: RCPT TO:<bob@example.com>
S: 250 2.1.5 Recipient OK
C: RCPT TO:<charlie@example.com>
S: 550 5.1.1 No such user
```

**Notes:**
- Both `250` and `251` are success codes
- Failed recipients are NOT delivery attempts — they're rejected before DATA
- If all RCPT TO commands fail, client should not send DATA

### DATA

**Syntax:**
```
C: DATA
S: 354 Start mail input; end with <CRLF>.<CRLF>
C: (headers)
C: (blank line)
C: (body)
C: .
```

**Responses (per-recipient):**
- `250` — Delivered successfully
- `450` — Mailbox temporarily unavailable
- `550` — Mailbox unavailable (permanent)
- `552` — Mailbox full

**Example with 2 successful RCPT TO:**
```
C: DATA
S: 354 Start mail input
C: From: alice@example.com
C: To: bob@example.com, charlie@example.com
C: Subject: Test
C:
C: Hello world
C: .
S: 250 2.6.0 Message delivered to bob@example.com
S: 550 5.2.1 Mailbox full for charlie@example.com
```

**Critical Rules:**
- **Per-Recipient Status:** One reply per previously successful RCPT TO, in order
- **No RCPT Success = 503 Error:** If no RCPT TO succeeded, DATA MUST fail with `503`
- **Duplicate Recipients:** Each RCPT TO requires its own reply, even if addresses are identical
- **Dot-Stuffing:** Lines starting with `.` are sent as `..` (RFC 5321 §4.5.2)
- **Dot-Unstuffing:** Server removes leading `.` from `..` lines before delivery

### RSET

**Syntax:** `RSET`
**Response:** `250` — State cleared

Clears MAIL FROM and all RCPT TO commands. Does not close connection.

### QUIT

**Syntax:** `QUIT`
**Response:** `221` — Connection closing

Terminates the session gracefully.

---

## Response Code Classes

| Class | Meaning | Action |
|-------|---------|--------|
| `2xx` | Positive completion | Success |
| `3xx` | Positive intermediate | Continue (e.g., 354 after DATA) |
| `4xx` | Transient failure | Retry later |
| `5xx` | Permanent failure | Do not retry |

### Multi-Line Responses

**Format:**
```
250-First line (hyphen after code)
250-Second line
250 Final line (space after code)
```

**Parsing Rule:**
- Continuation lines: `code-text`
- Final line: `code<space>text`

The response is complete when you see the final line (space after code).

---

## Advanced Features

### PIPELINING (RFC 2920)

**Required by RFC 2033.** Allows sending multiple commands without waiting for responses:

```
C: LHLO portofcall
C: MAIL FROM:<alice@example.com>
C: RCPT TO:<bob@example.com>
C: DATA
S: 250-server.example.com
S: 250 PIPELINING
S: 250 Sender OK
S: 250 Recipient OK
S: 354 Start mail input
```

**Commands Safe to Pipeline:**
- `LHLO`, `MAIL FROM`, `RCPT TO`, `RSET`, `QUIT`

**Commands NOT Safe to Pipeline:**
- `DATA` (must wait for 354 before sending body)

### ENHANCEDSTATUSCODES (RFC 2034)

**Required by RFC 2033.** Provides detailed status codes:

```
250 2.1.0 Sender OK
     ^^^^^ Enhanced status code
     |||||
     |||++- Detail (0 = undefined)
     ||+--- Subject (1 = addressing)
     |+---- Category (success/failure/etc)
     +----- Class (2 = success)
```

**Common Enhanced Codes:**
- `2.1.0` — Sender OK
- `2.1.5` — Recipient OK
- `2.6.0` — Message delivered
- `5.1.1` — Bad destination mailbox
- `5.2.1` — Mailbox full
- `5.2.2` — Mailbox disabled

### 8BITMIME (RFC 6152)

**Recommended by RFC 2033.** Allows 8-bit message content:

```
C: MAIL FROM:<alice@example.com> BODY=8BITMIME
S: 250 Sender OK
```

Without this, only 7-bit ASCII is guaranteed to work.

### CHUNKING (RFC 3030)

If supported, `BDAT` command can replace `DATA`:

```
C: BDAT 12 LAST
C: Hello world
C: (no dot required)
S: 250 2.6.0 Message delivered to bob@example.com
S: 550 5.2.1 Mailbox full for charlie@example.com
```

**Key Difference:** `BDAT ... LAST` behaves like `DATA` — returns one reply per recipient.

---

## Security Considerations

### No Built-In Authentication

LMTP has **no authentication mechanism** by default. It's designed for:
- **Local delivery** via Unix sockets (file permissions control access)
- **Trusted networks** (e.g., localhost or internal network)

**Never expose LMTP on public networks without:**
1. **Firewall rules** restricting access to trusted IPs
2. **VPN or SSH tunnel** for remote access
3. **Wrapper authentication** (e.g., SASL via custom implementation)

### Relay Prevention

LMTP servers should:
- Only accept mail for **local recipients**
- Reject relay attempts (mail destined for other domains)
- Use `551 User not local, no forwarding` for non-local addresses

### Dot-Stuffing Attack

If dot-stuffing is not implemented, an attacker can prematurely terminate the message:

```
Subject: Malicious
Body:
.
<attacker's command>
```

**Mitigation:** Always implement dot-stuffing (RFC 5321 §4.5.2):
- Lines starting with `.` are sent as `..`
- Server removes one leading `.` from `..` lines

---

## Common Errors

### 1. Using EHLO Instead of LHLO

**Symptom:**
```
C: EHLO portofcall
S: 500 5.5.1 Command not recognized
```

**Fix:** Use `LHLO` for LMTP (RFC 2033 requires rejecting EHLO/HELO).

### 2. Expecting Single DATA Reply

**Symptom:** Client hangs after receiving first DATA reply.

**Fix:** Read **one reply per successful RCPT TO** (in order).

```python
# WRONG (SMTP-style)
send("DATA\r\n")
send(message + "\r\n.\r\n")
reply = read_line()  # Only reads first recipient status!

# CORRECT (LMTP-style)
send("DATA\r\n")
send(message + "\r\n.\r\n")
for recipient in successful_recipients:
    reply = read_line()
    print(f"{recipient}: {reply}")
```

### 3. Sending DATA with No Accepted Recipients

**Symptom:**
```
C: RCPT TO:<invalid@example.com>
S: 550 No such user
C: DATA
S: 503 5.5.1 No valid recipients
```

**Fix:** Track RCPT TO responses. Only send DATA if at least one RCPT TO succeeded (250 or 251).

### 4. Not Implementing Dot-Stuffing

**Symptom:** Message body is truncated at first line starting with `.`

**Fix:** Prepend `.` to any line starting with `.` before sending:

```python
# Input:  "Hello\n.\nWorld"
# Output: "Hello\n..\nWorld"
message = message.replace("\n.", "\n..")
```

### 5. Using Port 25 for LMTP

**Symptom:** Connection refused or SMTP commands expected.

**Fix:** Use port **24** (or Unix socket). RFC 2033 forbids LMTP on port 25.

---

## Testing with Telnet

```bash
# Connect to LMTP server
telnet localhost 24

# Commands to type:
LHLO portofcall
MAIL FROM:<test@example.com>
RCPT TO:<user@localhost>
DATA
From: test@example.com
To: user@localhost
Subject: Test

This is a test message.
.
QUIT
```

**Expected Output:**
```
220 mail.example.com LMTP server ready
250-mail.example.com
250-PIPELINING
250 ENHANCEDSTATUSCODES
250 2.1.0 Sender OK
250 2.1.5 Recipient OK
354 Start mail input
250 2.6.0 Message delivered
221 2.0.0 Bye
```

---

## Debugging Tips

### 1. Enable Server Logging

Dovecot:
```ini
# /etc/dovecot/conf.d/10-logging.conf
mail_debug = yes
log_path = /var/log/dovecot.log
```

Postfix (using LMTP):
```ini
# /etc/postfix/main.cf
lmtp_destination_concurrency_limit = 1
debug_peer_list = 127.0.0.1
```

### 2. Capture Traffic with tcpdump

```bash
# Capture LMTP traffic on port 24
sudo tcpdump -i lo -A -s 0 'tcp port 24'
```

### 3. Check Mailbox Permissions

```bash
# Dovecot mailbox location
ls -la /var/mail/username

# Ensure LMTP user has write access
sudo chmod 0600 /var/mail/username
sudo chown mail:mail /var/mail/username
```

### 4. Verify Server is Listening

```bash
# Check if LMTP is running
netstat -tlnp | grep :24

# Or with ss (newer)
ss -tlnp | grep :24

# Test Unix socket
ls -la /var/run/dovecot/lmtp
```

### 5. Test Per-Recipient Status

```bash
# Send to multiple recipients
echo -e "LHLO test\nMAIL FROM:<test@example.com>\nRCPT TO:<user1@localhost>\nRCPT TO:<user2@localhost>\nDATA\nSubject: Test\n\nHello\n.\nQUIT" | nc localhost 24
```

**Expected:** Two `250` replies after the dot (one per recipient).

---

## Performance Tuning

### 1. Use Pipelining

**Before (sequential):**
```
Send: LHLO
Wait: 250 reply
Send: MAIL FROM
Wait: 250 reply
Send: RCPT TO
Wait: 250 reply
```

**After (pipelined):**
```
Send: LHLO\r\nMAIL FROM:<...>\r\nRCPT TO:<...>\r\n
Wait: 250\r\n250\r\n250\r\n
```

**Latency Reduction:** 3 round-trips → 1 round-trip

### 2. Reuse Connections

After delivery:
```
C: RSET           (instead of QUIT)
S: 250 OK
C: MAIL FROM:...  (start new delivery)
```

**Benefit:** Avoids TCP handshake and LHLO negotiation overhead.

### 3. Batch Recipients

```
C: RCPT TO:<user1@localhost>
C: RCPT TO:<user2@localhost>
C: RCPT TO:<user3@localhost>
C: DATA
```

**Benefit:** Server processes one message for multiple recipients instead of separate deliveries.

### 4. Monitor Delivery Queue

If many recipients fail (4xx codes), exponential backoff prevents overwhelming the server:

```python
failures = 0
for recipient in delivery_statuses:
    if recipient.code >= 400 and recipient.code < 500:
        failures += 1

if failures > 0:
    delay = min(2 ** failures, 3600)  # Max 1 hour
    sleep(delay)
```

---

## Implementation Checklist

### Server Requirements

- [ ] Reject `HELO` and `EHLO` with `500`
- [ ] Implement `LHLO` command
- [ ] Return per-recipient status after DATA (one per RCPT TO)
- [ ] Implement `PIPELINING` (required)
- [ ] Implement `ENHANCEDSTATUSCODES` (required)
- [ ] Implement `8BITMIME` (recommended)
- [ ] Dot-unstuffing (remove leading `.` from `..` lines)
- [ ] Reject relay attempts (551 for non-local domains)
- [ ] Return `503` for DATA with no valid recipients
- [ ] Support multi-line responses (`code-` continuation, `code ` final)

### Client Requirements

- [ ] Send `LHLO` (not `EHLO` or `HELO`)
- [ ] Read per-recipient status after DATA (one per successful RCPT TO)
- [ ] Track which RCPT TO commands succeeded
- [ ] Don't send DATA if no RCPT TO succeeded
- [ ] Implement dot-stuffing (prepend `.` to lines starting with `.`)
- [ ] Parse multi-line responses correctly
- [ ] Handle `251` (forward) as success for RCPT TO
- [ ] Use port 24 or Unix socket (not port 25)

---

## Worker API Reference

### `POST /api/lmtp/connect` (or `GET` with query params)

Test LMTP connectivity: connects, reads greeting, sends LHLO, reports capabilities.

**Request Body:**
```json
{
  "host": "mail.example.com",
  "port": 24,
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "mail.example.com",
  "port": 24,
  "protocol": "LMTP",
  "greeting": "220 mail.example.com Dovecot ready.",
  "capabilities": ["PIPELINING", "8BITMIME", "ENHANCEDSTATUSCODES"],
  "note": "LMTP server reachable. Uses LHLO instead of EHLO; per-recipient delivery status."
}
```

### `POST /api/lmtp/send`

Send a message with per-recipient delivery status.

**Request Body:**
```json
{
  "host": "mail.example.com",
  "port": 24,
  "from": "sender@example.com",
  "to": ["user1@example.com", "user2@example.com"],
  "subject": "Test delivery",
  "body": "Hello from Port of Call!",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "mail.example.com",
  "port": 24,
  "from": "sender@example.com",
  "recipientCount": 2,
  "acceptedCount": 1,
  "deliveryStatus": [
    {
      "recipient": "user1@example.com",
      "code": 250,
      "message": "250 2.1.5 Delivered",
      "delivered": true
    },
    {
      "recipient": "user2@example.com",
      "code": 550,
      "message": "550 No such user",
      "delivered": false
    }
  ],
  "allDelivered": false,
  "note": "LMTP provides per-recipient delivery status (unlike SMTP which gives one status for all)."
}
```

**Timeouts:**
- Connection timeout: 10 seconds (configurable via `timeout` param)
- Read timeout per command: 5 seconds
- Multi-response timeout (after DATA): 10 seconds

**Binary vs. Text Encoding:**
LMTP is a pure text protocol using CR+LF line endings. All commands and responses are ASCII. Message bodies support 8BITMIME if the server advertises it.

---

## RFC 2033 Compliance Summary

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Use LHLO instead of EHLO/HELO | ✅ | Line 224, 355 |
| Reject EHLO/HELO with 500 | ⚠️ | Server-side (not implemented) |
| Per-recipient DATA status | ✅ | Line 414 (reads `acceptedCount` replies) |
| PIPELINING support | ✅ | Capabilities parsed at line 231-234 |
| ENHANCEDSTATUSCODES support | ✅ | Capabilities parsed at line 231-234 |
| 8BITMIME support | ⚠️ | Not explicitly used (recommended, not required) |
| Must not use port 25 | ✅ | Default port 24 (line 191, 323) |
| Dot-stuffing (RFC 5321 §4.5.2) | ✅ | Line 410 (fixed 2026-02-18) |
| 503 for DATA with no valid RCPT | ⚠️ | Client-side check at line 384-386 (server-side not implemented) |

**Legend:**
- ✅ Fully compliant
- ⚠️ Recommended but not enforced (or server-side requirement)

---

## Relationship to Email Suite

| Protocol | Port | Purpose |
|----------|------|---------|
| SMTP     | 25/587 | Relay between mail servers |
| **LMTP** | **24** | **Final delivery to mailboxes** |
| POP3     | 110  | Retrieve from mailbox (download) |
| IMAP     | 143  | Manage mailbox (server-side) |

---

## References

- **RFC 2033** — LMTP Specification
  https://datatracker.ietf.org/doc/html/rfc2033

- **RFC 5321** — SMTP (base protocol)
  https://datatracker.ietf.org/doc/html/rfc5321

- **RFC 2920** — PIPELINING Extension
  https://datatracker.ietf.org/doc/html/rfc2920

- **RFC 2034** — ENHANCEDSTATUSCODES Extension
  https://datatracker.ietf.org/doc/html/rfc2034

- **RFC 6152** — 8BITMIME Extension
  https://datatracker.ietf.org/doc/html/rfc6152

- **RFC 3030** — CHUNKING Extension
  https://datatracker.ietf.org/doc/html/rfc3030

---

## Changelog

**2026-02-18** — Initial power-user documentation created
**2026-02-18** — Fixed dot-stuffing regex to handle first line (line 410)
