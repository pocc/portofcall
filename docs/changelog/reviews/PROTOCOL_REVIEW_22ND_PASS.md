# Protocol Review — 22nd Pass

**Date:** 2026-02-23
**Reviewer:** Claude Sonnet 4.6
**Scope:** SSH, FTP, SFTP, FTPS, SMTP protocols — power-user completeness, security, feature parity
**Method:** Full source read of `ssh.ts`, `ssh2-impl.ts`, `ftp.ts`, `sftp.ts`, `ftps.ts`, `smtp.ts`, `smtps.ts`, `submission.ts`

---

## Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| CRITICAL | 2     | 2     |
| HIGH     | 4     | 4     |
| MEDIUM   | 1     | 0 (documented) |
| LOW      | 1     | 0 (documented) |

---

## CRITICAL Issues

### C-1: SMTPS Open Relay — `handleSMTPSSend` allows unauthenticated email sending

**File:** `src/worker/smtps.ts:handleSMTPSSend`
**Impact:** Anyone can send email through the worker's SMTPS endpoint without credentials.

**Root cause:** `smtp.ts:handleSMTPSend` (the plaintext counterpart) correctly enforces authentication:
```typescript
if (!options.username || !options.password) {
  return new Response(JSON.stringify({ error: 'Authentication required...' }), { status: 400 });
}
```
But `smtps.ts:handleSMTPSSend` only conditionally authenticates and then proceeds regardless:
```typescript
if (options.username && options.password) {
  // authenticate
}
// proceeds to MAIL FROM / RCPT TO / DATA without auth
```

**Fix:** Add explicit auth requirement before MAIL FROM, matching smtp.ts behavior.
**Status:** ✅ Fixed

---

### C-2: SMTPS Missing Email Address Validation — SMTP command injection possible

**File:** `src/worker/smtps.ts:handleSMTPSSend`
**Impact:** `from` and `to` fields are used directly in `MAIL FROM:<...>` and `RCPT TO:<...>` commands without validation. An attacker can inject CRLF sequences to inject arbitrary SMTP commands (e.g., adding hidden recipients, bypassing policies).

**Root cause:** `smtp.ts:handleSMTPSend` validates both addresses:
```typescript
const EMAIL_RE = /^[^\s<>\r\n@]+@[^\s<>\r\n@]+\.[^\s<>\r\n@]+$/;
if (!EMAIL_RE.test(options.from!) || !EMAIL_RE.test(options.to!)) {
  return new Response(...);
}
```
`smtps.ts:handleSMTPSSend` has no such validation.

**Fix:** Add same `EMAIL_RE` validation before processing in `handleSMTPSSend`.
**Status:** ✅ Fixed

---

## HIGH Issues

### H-1: SMTPS Body Not Normalized to CRLF Before Dot-Stuffing

**File:** `src/worker/smtps.ts:handleSMTPSSend`
**Impact:** RFC 5321 §4.5.2 dot-stuffing fails for lines starting with `.` if the body uses bare `\n` line endings. The dot-stuffing regex `/(^|\r\n)\./g` only matches `\r\n.`, not `\n.`. This can cause early termination of the email body at the SMTP level, corrupting the message or ending DATA transmission prematurely.

**Root cause:** `smtp.ts` normalizes body line endings before dot-stuffing:
```typescript
const normalizedBody = (options.body ?? '').replace(/\r?\n/g, '\r\n');
```
`smtps.ts` uses `options.body` directly in the join, then dot-stuffs without normalization.

**Fix:** Add body normalization (`replace(/\r?\n/g, '\r\n')`) before dot-stuffing.
**Status:** ✅ Fixed

---

### H-2: Submission Body Not Normalized to CRLF Before Dot-Stuffing

**File:** `src/worker/submission.ts:handleSubmissionSend`
**Impact:** Same as H-1. The `options.body` is spliced directly into the email with `\r\n` join, but if the body itself has bare `\n` characters, dot-stuffing for `.`-prefixed lines won't fire.

**Fix:** Normalize body line endings before dot-stuffing.
**Status:** ✅ Fixed

---

### H-3: FTPS PASV SSRF — No Internal Host Blocking in `enterPassiveMode`

**File:** `src/worker/ftps.ts:FTPSSession.enterPassiveMode`
**Impact:** An attacker-controlled FTPS server can respond to `PASV` with an internal IP address (e.g., `10.0.0.1`, `169.254.169.254`). The worker then opens a TLS data socket to that internal address, effectively allowing SSRF via the FTPS data channel. This is particularly dangerous since the data channel is encrypted TLS, making it harder to detect.

**Root cause:** `ftp.ts:enterPassiveMode` (line 341) calls `isBlockedHost(host)` from `host-validator.ts`:
```typescript
if (isBlockedHost(host)) {
  throw new Error(`PASV returned blocked address: ${host}`);
}
```
`ftps.ts:FTPSSession.enterPassiveMode` does not import or call `isBlockedHost`.

**Fix:** Import `isBlockedHost` from `./host-validator` and add the SSRF guard after parsing the PASV response.
**Status:** ✅ Fixed

---

### H-4: FTPS Command Injection — No CRLF Sanitization in `FTPSSession.sendCommand`

**File:** `src/worker/ftps.ts:FTPSSession.sendCommand`, all FTPS handlers
**Impact:** FTP commands are delimited by `\r\n`. If user-supplied path, filename, username, or password values contain `\r\n` sequences, additional FTP commands can be injected (e.g., `DELE /legit/path\r\nDELE /secret/file`).

**Root cause:** `ftp.ts:FTPClient.sendCommand` relies on call-site sanitization via `sanitizeFTPInput()`. `ftps.ts:FTPSSession.sendCommand` has no sanitization at all:
```typescript
async sendCommand(cmd: string): Promise<void> {
  await this.writer.write(this.encoder.encode(cmd + '\r\n'));
}
```
All FTPS handlers pass unsanitized user input directly:
- `handleFTPSList`: `CWD ${path}`
- `handleFTPSDownload`: `RETR ${path}`
- `handleFTPSUpload`: `STOR ${path}`
- `handleFTPSDelete`: `RMD/DELE ${path}`
- `handleFTPSMkdir`: `MKD ${path}`
- `handleFTPSRename`: `RNFR ${from}`, `RNTO ${to}`
- `authenticateFTPSSession`: `USER ${username}`, `PASS ${password}`

**Fix:** Add `[\r\n]` stripping directly in `FTPSSession.sendCommand` so all commands are sanitized at the transport layer.
**Status:** ✅ Fixed

---

## MEDIUM Issues

### M-1: SSH Terminal Window Exhaustion Drops Input Silently

**File:** `src/worker/ssh2-impl.ts:runSSHSession` (WS→SSH message handler, ~line 752)
**Impact:** When `remoteWindow === 0`, the chunking loop breaks immediately and all user input for that message event is silently discarded. A power user typing rapidly during a slow remote shell session (e.g., bulk pasting into a slow command) will observe dropped keystrokes.

**Root cause:**
```typescript
for (let offset = 0; offset < data.length; offset += remoteWindow) {
  const chunkSize = Math.min(data.length - offset, remoteWindow);
  if (chunkSize === 0) break;   // ← drops remaining data
  ...
}
```
The correct SSH behavior (RFC 4254 §5.2) is to wait for `SSH_MSG_CHANNEL_WINDOW_ADJUST` before sending. However, the WS message handler is an async event listener that runs concurrently with the TCP reader loop; there's no simple await point to block on WINDOW_ADJUST from within the event handler without restructuring the I/O loop.

**Recommended fix (architectural):** Replace the WebSocket event listener pattern with a write queue:
1. Push all WS input to a queue (non-blocking)
2. Have a dedicated async drain loop that reads from the queue and sends when `remoteWindow > 0`, waiting on WINDOW_ADJUST signals via a shared Promise/notify mechanism

**Status:** 📋 Documented — needs architectural rework. Not fixed in this pass.

---

## LOW Issues

### L-1: HTTP Mode SSH/SFTP Banner Read May Be Incomplete

**File:** `src/worker/ssh.ts:handleSSHConnect` (line 114), `src/worker/sftp.ts:handleSFTPConnect` (line 445)
**Impact:** A single `reader.read()` call returns the first available TCP segment. On fast networks this typically includes the full banner, but on slow/fragmented connections only part of the banner may arrive. Result: truncated banner text in the connectivity test response.

**Note:** This is a test/probe endpoint only; full SSH sessions use the proper `readSSHBanner()` function in `handleSSHKeyExchange` and `handleSSHAuth`. The impact is cosmetic for connectivity tests.

**Status:** 📋 Documented — acceptable limitation for probe endpoints. Not fixed.

---

## Files Modified

| File | Change |
|------|--------|
| `src/worker/smtps.ts` | C-1: Auth required; C-2: Email validation; H-1: Body normalization |
| `src/worker/submission.ts` | H-2: Body normalization |
| `src/worker/ftps.ts` | H-3: isBlockedHost import + PASV SSRF guard; H-4: CRLF sanitization in sendCommand |
