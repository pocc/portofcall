# IMAPS Protocol (RFC 8314, Port 993)

## Overview
IMAPS (IMAP over TLS) provides the same IMAP4rev1 functionality as plaintext IMAP (port 143) but wraps the entire connection in TLS from the first byte. This is called "implicit TLS" as opposed to STARTTLS which upgrades a plaintext connection.

- **RFC:** [8314](https://datatracker.ietf.org/doc/html/rfc8314) (recommends implicit TLS)
- **Default Port:** 993
- **Transport:** TCP + TLS
- **Status:** Active — the recommended way to access IMAP

## Protocol Flow
```
Client                              IMAPS Server (Port 993)
  |                                        |
  |  ---- TCP Connect ----------------->   |
  |  ---- TLS Handshake --------------->   |  Implicit TLS
  |  <---- TLS Handshake ---------------   |
  |                                        |
  |  <---- * OK [CAPABILITY ...] --------  |  Server greeting (over TLS)
  |  ---- A001 LOGIN user pass -------->   |  Authentication
  |  <---- A001 OK -----------------------  |
  |                                        |
  |  ---- A002 LIST "" "*" ------------>   |  List mailboxes
  |  <---- * LIST ... ------------------   |
  |  <---- A002 OK ---------------------   |
  |                                        |
  |  ---- A003 SELECT INBOX ----------->   |  Select mailbox
  |  <---- * N EXISTS ------------------   |
  |  <---- A003 OK ---------------------   |
  |                                        |
  |  ---- A099 LOGOUT ----------------->   |
  |  <---- * BYE -----------------------   |
  |  <---- A099 OK ---------------------   |
```

## Implementation Details

### Worker Endpoints

#### `POST /api/imaps/connect` (or `GET` with query params)
Test IMAPS connectivity and optionally authenticate. Returns greeting, capabilities, and TLS status.

**Request Body:**
```json
{
  "host": "imap.gmail.com",
  "port": 993,
  "username": "user@gmail.com",
  "password": "app-password",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "imap.gmail.com",
  "port": 993,
  "protocol": "IMAPS",
  "tls": true,
  "rtt": 85,
  "greeting": "* OK Gimap ready for requests",
  "capabilities": "IMAP4rev1 UNSELECT IDLE NAMESPACE ...",
  "authenticated": true,
  "note": "Successfully authenticated over TLS"
}
```

#### `POST /api/imaps/list`
Authenticate and list all mailboxes (folders) on the server.

**Request Body:**
```json
{
  "host": "imap.gmail.com",
  "port": 993,
  "username": "user@gmail.com",
  "password": "app-password",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "mailboxes": ["INBOX", "Sent", "Drafts", "Trash", "Spam"],
  "count": 5
}
```

#### `POST /api/imaps/select`
Authenticate, select a mailbox, and return message counts.

**Request Body:**
```json
{
  "host": "imap.gmail.com",
  "port": 993,
  "username": "user@gmail.com",
  "password": "app-password",
  "mailbox": "INBOX",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "mailbox": "INBOX",
  "exists": 1234,
  "recent": 3,
  "message": "Selected mailbox \"INBOX\" with 1234 message(s)"
}
```

### TLS Implementation
IMAPS uses Cloudflare Workers' `secureTransport: 'on'` option:
```typescript
const socket = connect(`${host}:${port}`, {
  secureTransport: 'on',
  allowHalfOpen: false,
});
```

This establishes TLS at the transport layer before any IMAP commands are sent, unlike STARTTLS which upgrades an existing plaintext connection.

### Authentication
- Uses IMAP `LOGIN` command (username + password) over TLS
- TLS ensures credentials are encrypted in transit
- Capabilities may differ before and after authentication

### Timeouts
- Connection timeout: configurable (default 30 seconds)
- Greeting timeout: 5 seconds
- Command timeout: 10 seconds (login), 5 seconds (capability, logout)
- Workers execution time limits apply

## IMAP vs IMAPS Comparison

| Feature | IMAP | IMAPS |
|---------|------|-------|
| Port | 143 | 993 |
| TLS | Optional (STARTTLS) | Mandatory (implicit) |
| First byte | Plaintext | TLS ClientHello |
| RFC recommendation | Use STARTTLS or IMAPS | Preferred (RFC 8314) |
| Downgrade attack risk | Yes (STARTTLS stripping) | No |

## Well-Known IMAPS Servers
- **Gmail:** `imap.gmail.com:993`
- **Outlook/Hotmail:** `outlook.office365.com:993`
- **Yahoo:** `imap.mail.yahoo.com:993`
- **iCloud:** `imap.mail.me.com:993`
- **Fastmail:** `imap.fastmail.com:993`
- **ProtonMail Bridge:** `127.0.0.1:1143` (local bridge)

## Related Protocols

| Protocol | Port | Description |
|----------|------|-------------|
| IMAP | 143 | Plaintext IMAP (optionally STARTTLS) |
| IMAPS | 993 | IMAP over implicit TLS |
| POP3 | 110 | Simpler email retrieval (plaintext) |
| POP3S | 995 | POP3 over implicit TLS |
| SMTP | 25/587 | Email sending (plaintext/STARTTLS) |
| SMTPS | 465 | Email submission over implicit TLS |

## Security Considerations
- IMAPS encrypts all data including credentials from the first byte
- No opportunity for STARTTLS stripping attacks
- RFC 8314 recommends implicit TLS (port 993) over STARTTLS (port 143)
- Modern email clients default to IMAPS
- App-specific passwords recommended for services with 2FA (Gmail, etc.)
