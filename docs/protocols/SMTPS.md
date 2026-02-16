# SMTPS Protocol (Port 465)

## Overview
SMTPS (SMTP over TLS) wraps the SMTP protocol in TLS from the first byte of the connection. Unlike STARTTLS on port 587 which upgrades a plaintext connection, SMTPS uses implicit TLS — the TLS handshake occurs immediately upon TCP connection.

- **Default Port:** 465
- **Transport:** TCP with implicit TLS
- **RFCs:** RFC 8314 (Cleartext Considered Obsolete), RFC 5321 (SMTP)
- **Status:** Active — recommended by RFC 8314 for email submission

## Protocol Flow

```
Client                          SMTPS Server (port 465)
  |                                |
  | --- TCP + TLS handshake -----> |
  |                                |
  | <-- 220 smtp.example.com ---   |  (greeting, already encrypted)
  |                                |
  | --- EHLO portofcall ---------> |
  | <-- 250 capabilities -------   |
  |                                |
  | --- AUTH LOGIN --------------> |  (optional)
  | <-- 334 (username prompt) ---  |
  | --- <base64 username> -------> |
  | <-- 334 (password prompt) ---  |
  | --- <base64 password> -------> |
  | <-- 235 Authenticated ------   |
  |                                |
  | --- MAIL FROM:<sender> ------> |
  | <-- 250 OK -----------------   |
  | --- RCPT TO:<recipient> -----> |
  | <-- 250 OK -----------------   |
  | --- DATA --------------------> |
  | <-- 354 Go ahead -----------   |
  | --- email content + "." -----> |
  | <-- 250 OK -----------------   |
  |                                |
  | --- QUIT --------------------> |
  | <-- 221 Bye ----------------   |
```

## Implementation Details

### Worker Endpoints

#### `POST /api/smtps/connect` (or `GET` with query params)
Test SMTPS connection over TLS with EHLO.

**Request Body:**
```json
{
  "host": "smtp.gmail.com",
  "port": 465,
  "username": "user@gmail.com",
  "password": "app-password",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "smtp.gmail.com",
  "port": 465,
  "protocol": "SMTPS",
  "tls": true,
  "rtt": 45,
  "greeting": "220 smtp.gmail.com ESMTP",
  "capabilities": ["SIZE 35882577", "8BITMIME", "AUTH LOGIN PLAIN XOAUTH2", "PIPELINING"],
  "authenticated": true,
  "note": "Successfully authenticated over implicit TLS"
}
```

#### `POST /api/smtps/send`
Send an email over SMTPS.

**Request Body:**
```json
{
  "host": "smtp.gmail.com",
  "port": 465,
  "username": "user@gmail.com",
  "password": "app-password",
  "from": "user@gmail.com",
  "to": "recipient@example.com",
  "subject": "Test Email",
  "body": "Hello from Port of Call!",
  "timeout": 30000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Email sent successfully over TLS",
  "host": "smtp.gmail.com",
  "port": 465,
  "tls": true,
  "from": "user@gmail.com",
  "to": "recipient@example.com"
}
```

### TLS Implementation
Uses Cloudflare Workers' `secureTransport: 'on'` for implicit TLS:
```typescript
const socket = connect(`${host}:${port}`, {
  secureTransport: 'on',
  allowHalfOpen: false,
});
```

### SMTP Ports Comparison

| Port | Name | TLS | Usage |
|------|------|-----|-------|
| **25** | SMTP | Optional STARTTLS | Server-to-server relay |
| **465** | SMTPS | Implicit TLS | Client submission (recommended by RFC 8314) |
| **587** | Submission | STARTTLS upgrade | Client submission (RFC 6409) |
| **2525** | Alt Submission | Varies | Alternative when 587 is blocked |

### Well-Known SMTPS Servers

| Provider | Host | Port |
|----------|------|------|
| Gmail | smtp.gmail.com | 465 |
| Outlook/365 | smtp.office365.com | 465 |
| Yahoo | smtp.mail.yahoo.com | 465 |
| iCloud | smtp.mail.me.com | 465 |
| Fastmail | smtp.fastmail.com | 465 |
| ProtonMail Bridge | 127.0.0.1 | 465 |

### History of Port 465
1. Originally assigned for SMTPS (1997)
2. Deprecated in favor of STARTTLS on port 587 (1998)
3. Re-assigned for "Submissions" (implicit TLS) by RFC 8314 (2018)
4. Now the recommended approach per RFC 8314
