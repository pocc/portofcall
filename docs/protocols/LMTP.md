# LMTP Protocol (RFC 2033)

## Overview
LMTP (Local Mail Transfer Protocol) is a variant of SMTP designed for final delivery of email to local mailboxes. It's used by mail delivery agents (MDAs) like Dovecot, Cyrus IMAP, and Postfix.

- **RFC:** [2033](https://datatracker.ietf.org/doc/html/rfc2033)
- **Default Port:** 24 (also commonly via Unix socket)
- **Transport:** TCP
- **Status:** Active — widely used in mail server infrastructure

## Key Differences from SMTP

| Feature | SMTP | LMTP |
|---------|------|------|
| Greeting command | `EHLO` / `HELO` | `LHLO` |
| After DATA | Single status code | **One status per RCPT TO** |
| Queuing | May queue for later retry | Never queues (immediate accept/reject) |
| Purpose | Relay between servers | Final delivery to mailboxes |

## Protocol Flow
```
Client (MTA)                    LMTP Server (MDA)
  |                                    |
  |  <---- 220 mail.example.com ---   |  Greeting
  |  ---- LHLO portofcall -------->   |
  |  <---- 250-PIPELINING ----------  |  Capabilities
  |  <---- 250 8BITMIME -----------   |
  |                                    |
  |  ---- MAIL FROM:<a@b.com> ----->  |
  |  <---- 250 OK -----------------   |
  |  ---- RCPT TO:<user1@b.com> --->  |
  |  <---- 250 OK -----------------   |
  |  ---- RCPT TO:<user2@b.com> --->  |
  |  <---- 550 No such user -------   |  Per-recipient rejection
  |  ---- DATA -------------------->  |
  |  <---- 354 Go ahead -----------   |
  |  ---- [message content] ------->  |
  |  ---- . ----------------------->  |  End of data
  |  <---- 250 Delivered to user1 --  |  Status for user1
  |                                    |  (no status for user2 - rejected)
  |  ---- QUIT -------------------->  |
  |  <---- 221 Bye -----------------  |
```

## Implementation Details

### Worker Endpoints

#### `POST /api/lmtp/connect` (or `GET` with query params)
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
  "note": "..."
}
```

#### `POST /api/lmtp/send`
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
    { "recipient": "user1@example.com", "code": 250, "message": "250 2.1.5 Delivered", "delivered": true },
    { "recipient": "user2@example.com", "code": 550, "message": "550 No such user", "delivered": false }
  ],
  "allDelivered": false,
  "note": "LMTP provides per-recipient delivery status..."
}
```

### Authentication
LMTP itself has no authentication mechanism (it trusts the connecting MTA). Access is typically controlled via Unix sockets or IP-based restrictions.

### Timeouts / Keep-Alives
- Connection timeout: 10 seconds (configurable)
- Read timeout per command: 5 seconds
- Multi-response timeout (after DATA): 10 seconds
- Workers execution time limits apply

### Binary vs. Text Encoding
LMTP is a pure text protocol using CR+LF line endings. All commands and responses are ASCII. Message bodies support 8BITMIME if the server advertises it.

## Common LMTP Servers
- **Dovecot** — `dovecot-lmtp` service (most common)
- **Cyrus IMAP** — Built-in LMTP delivery
- **Postfix** — `lmtp` transport for local delivery

## Relationship to Email Suite

| Protocol | Port | Purpose |
|----------|------|---------|
| SMTP     | 25/587 | Relay between mail servers |
| **LMTP** | **24** | **Final delivery to mailboxes** |
| POP3     | 110  | Retrieve from mailbox (download) |
| IMAP     | 143  | Manage mailbox (server-side) |
