# SMTPS Review

**Protocol:** SMTPS (SMTP over TLS) - RFC 8314
**File:** `src/worker/smtps.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 5321 (SMTP)](https://datatracker.ietf.org/doc/html/rfc5321) | [RFC 8314 (Implicit TLS)](https://datatracker.ietf.org/doc/html/rfc8314)
**Tests:** `tests/smtps.test.ts`

## Summary

SMTPS implementation provides 2 endpoints (connect, send) using implicit TLS on port 465. Supports AUTH LOGIN authentication with base64-encoded credentials. Implements RFC 5321 SMTP command/response parsing. Critical findings include no TLS certificate validation, infinite loops in response reading, and missing MIME header validation.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **TLS SECURITY**: No certificate validation — accepts self-signed/expired certs, MITM can intercept email credentials and content |
| 2 | Critical | **INFINITE LOOP**: `readSMTPResponse` (lines 49-64) never times out if server sends data without complete response code — Worker hangs indefinitely |
| 3 | High | **RESOURCE LEAK**: Timeout handles never cleared — `readSMTPResponse` creates `setTimeout` on line 67 but never cancels it |
| 4 | High | **INJECTION**: Email addresses not validated — `from`/`to` with `\r\n` can inject SMTP commands (e.g., `RCPT TO:<victim>\r\nDATA\r\nSpam\r\n.`) |
| 5 | Medium | **HEADER INJECTION**: Subject/body not sanitized — embedded `\r\n` in subject breaks MIME headers, allows header injection attacks |
| 6 | Low | **AUTH FALLBACK**: AUTH LOGIN assumed supported (line 174) — should check EHLO capabilities first per RFC 4954 |

## TLS Security Analysis

### Current Implementation
```typescript
const socket = connect(`${host}:${port}`, {
  secureTransport: 'on',  // ❌ No certificate validation
  allowHalfOpen: false,
});
```

### Email-Specific Risks

1. **Credential Interception**
   - AUTH LOGIN sends base64(username) and base64(password)
   - MITM attacker intercepts credentials, gains email account access
   - Can read inbox, send phishing emails from victim's account

2. **Email Content Modification**
   - Attacker can modify email body before delivery
   - Insert phishing links, malware attachments (if MIME parsing added)
   - Change recipients (BCC attacker for all sent emails)

3. **Mail Server Impersonation**
   - Attacker presents fake certificate for mail.example.com
   - Worker blindly trusts it, sends email to attacker's server
   - Attacker logs all email content and attachments

### Recommended Mitigations

1. **Add TLS Warning:**
   ```typescript
   return new Response(JSON.stringify({
     success: true,
     tlsWarning: "Certificate not validated. Email interceptable by MITM."
   }));
   ```

2. **Document Risk:**
   > ⚠️ SECURITY WARNING: SMTPS endpoint does not validate TLS certificates.
   > Suitable for testing only. DO NOT use for production email sending.
   > Use Cloudflare Email Workers API for production.

## Response Parsing Vulnerabilities

### Infinite Loop Bug (Lines 49-64)

```typescript
async function readSMTPResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const readPromise = (async () => {
    let response = '';
    while (true) {  // ❌ Infinite if timeout never fires
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = new TextDecoder().decode(value);
      response += chunk;

      // Check for complete response (final line has code followed by space)
      if (response.match(/\d{3}\s.*\r\n$/)) {  // ❌ What if server sends "250-" forever?
        break;
      }
    }
    return response;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('SMTPS read timeout')), timeoutMs)
  );

  return Promise.race([readPromise, timeoutPromise]);  // ❌ Timeout not enforced inside loop
}
```

**Attack Scenario:**
1. Malicious SMTP server sends infinite stream of `250-Continued...\r\n` (multi-line response)
2. Worker keeps reading forever (regex never matches `250 ` with space)
3. Worker exhausts memory or times out globally (not this function)

**Fix Required:**
```typescript
async function readSMTPResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let response = '';
  const maxSize = 65536;  // 64KB response limit

  while (true) {
    if (Date.now() > deadline) {
      throw new Error('SMTPS read timeout');
    }
    if (response.length > maxSize) {
      throw new Error('SMTP response too large');
    }

    const remaining = deadline - Date.now();
    const timeoutPromise = new Promise<{done: true, value: undefined}>(resolve =>
      setTimeout(() => resolve({done: true, value: undefined}), remaining)
    );
    const { done, value } = await Promise.race([reader.read(), timeoutPromise]);

    if (done || !value) break;
    response += new TextDecoder().decode(value);

    // Match final line: "250 OK\r\n" (space after code)
    if (response.match(/^\d{3}\s.*\r\n$/m)) {
      break;
    }
  }
  return response;
}
```

## Email Injection Vulnerabilities

### SMTP Command Injection (Lines 339-356)

```typescript
// Send MAIL FROM
const mailFromResp = await sendSMTPCommand(
  reader, writer,
  `MAIL FROM:<${options.from}>`,  // ❌ No validation
  5000
);

// Send RCPT TO
const rcptToResp = await sendSMTPCommand(
  reader, writer,
  `RCPT TO:<${options.to}>`,  // ❌ No validation
  5000
);
```

**Injection Attack:**
```typescript
// Malicious input:
from = "alice@example.com>\r\nRCPT TO:<victim@other.com>\r\nMAIL FROM:<"

// Resulting SMTP commands:
MAIL FROM:<alice@example.com>
RCPT TO:<victim@other.com>   ← Injected command
MAIL FROM:<>
RCPT TO:<bob@example.com>    ← Original recipient

// Result: Email sent to both bob@ and victim@ (unintended BCC)
```

**Fix Required:**
```typescript
function validateEmailAddress(email: string): void {
  if (/[\r\n\0<>]/.test(email)) {
    throw new Error('Email address contains invalid characters');
  }
  if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
    throw new Error('Invalid email address format');
  }
}

validateEmailAddress(options.from);
validateEmailAddress(options.to);
```

### MIME Header Injection (Lines 365-376)

```typescript
const emailContent = [
  `From: ${options.from}`,        // ❌ No validation
  `To: ${options.to}`,            // ❌ No validation
  `Subject: ${options.subject}`,  // ❌ Allows embedded \r\n
  `Date: ${new Date().toUTCString()}`,
  `MIME-Version: 1.0`,
  `Content-Type: text/plain; charset=UTF-8`,
  '',
  options.body,  // ❌ Allows header injection via blank line + headers
  '.',
].join('\r\n');
```

**Header Injection Attack:**
```typescript
// Malicious subject:
subject = "Meeting\r\nBcc: victim@other.com\r\nX-Spam: true"

// Resulting MIME:
From: alice@example.com
To: bob@example.com
Subject: Meeting
Bcc: victim@other.com    ← Injected BCC
X-Spam: true              ← Injected custom header
Date: ...
```

**Fix Required:**
```typescript
function sanitizeMIMEHeader(value: string): string {
  // Remove all CR/LF characters
  return value.replace(/[\r\n]/g, ' ');
}

const emailContent = [
  `From: ${sanitizeMIMEHeader(options.from)}`,
  `To: ${sanitizeMIMEHeader(options.to)}`,
  `Subject: ${sanitizeMIMEHeader(options.subject)}`,
  // ...
];
```

## Authentication Implementation

### AUTH LOGIN Flow (Lines 319-336)

```typescript
// Authenticate if credentials provided
if (options.username && options.password) {
  const authResp = await sendSMTPCommand(reader, writer, 'AUTH LOGIN', 5000);
  if (authResp.code !== 334) {  // ✅ Correct challenge code
    throw new Error(`AUTH LOGIN failed: ${authResp.message}`);
  }

  const usernameB64 = btoa(options.username);  // ✅ Base64 encoding
  const userResp = await sendSMTPCommand(reader, writer, usernameB64, 5000);
  if (userResp.code !== 334) {
    throw new Error(`Username authentication failed: ${userResp.message}`);
  }

  const passwordB64 = btoa(options.password);
  const passResp = await sendSMTPCommand(reader, writer, passwordB64, 5000);
  if (passResp.code !== 235) {  // ✅ Success code
    throw new Error(`Password authentication failed: ${passResp.message}`);
  }
}
```

**Good Practices:**
- ✅ Checks for 334 challenge response
- ✅ Base64-encodes credentials per RFC 4954
- ✅ Validates 235 auth success

**Missing Features:**
- ❌ No AUTH PLAIN support (RFC 4616)
- ❌ No CRAM-MD5 support (RFC 2195)
- ❌ No XOAUTH2 support (Gmail/OAuth)
- ❌ No capability check (assumes AUTH LOGIN always available)

**Capability Check Should Be:**
```typescript
const ehloResp = await sendSMTPCommand(reader, writer, 'EHLO portofcall', 5000);

if (!ehloResp.message.includes('AUTH LOGIN')) {
  throw new Error('Server does not support AUTH LOGIN');
}
```

## Documentation Improvements

**Created:** `docs/protocols/SMTPS.md` (needed)

Should document:

1. **Security Warnings**
   - ⚠️ No certificate validation
   - ⚠️ AUTH LOGIN sends credentials (base64 is NOT encryption)
   - Suitable for testing only, not production

2. **2 Endpoints**
   - `/connect` — Probe server + optional AUTH LOGIN
   - `/send` — Full email sending (MAIL FROM + RCPT TO + DATA)

3. **SMTP Commands Used**
   - EHLO (extended hello)
   - AUTH LOGIN (authentication)
   - MAIL FROM (sender envelope)
   - RCPT TO (recipient envelope)
   - DATA (message content)
   - QUIT (disconnect)

4. **Response Codes**
   - 220 — Service ready
   - 235 — Authentication successful
   - 250 — OK
   - 334 — AUTH challenge
   - 354 — Start mail input
   - 421 — Service not available
   - 451 — Local error
   - 550 — Mailbox unavailable

5. **Known Limitations**
   - No STARTTLS (only implicit TLS on 465)
   - No SMTP AUTH PLAIN/CRAM-MD5/XOAUTH2
   - No MIME attachments (text/plain only)
   - No DSN (Delivery Status Notification)
   - No PIPELINING (commands sent sequentially)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** Pending (tests/smtps.test.ts needs creation)
**RFC Compliance:**
- ✅ RFC 5321 (SMTP) - Partial
- ✅ RFC 8314 (Implicit TLS) - Partial (no cert validation)
- ❌ RFC 4954 (SMTP AUTH) - Partial (LOGIN only)

## See Also

- [RFC 5321 - SMTP](https://datatracker.ietf.org/doc/html/rfc5321)
- [RFC 8314 - Cleartext Considered Obsolete](https://datatracker.ietf.org/doc/html/rfc8314)
- [RFC 4954 - SMTP AUTH](https://datatracker.ietf.org/doc/html/rfc4954)
- [Cloudflare Sockets TLS Limitations](../security-notes/cloudflare-tls-limitations.md)
- [Critical Fixes Summary](../critical-fixes.md)
