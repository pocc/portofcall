# SMTP Protocol Implementation Plan

## Overview

**Protocol:** SMTP (Simple Mail Transfer Protocol)
**Port:** 25 (plain), 587 (submission), 465 (SMTPS)
**RFC:** [RFC 5321](https://tools.ietf.org/html/rfc5321)
**Complexity:** Medium
**Purpose:** Send email

SMTP enables **sending email** directly from the browser. Perfect for automated notifications, testing email templates, and web-based email clients.

### Use Cases
- Web-based email client (sending)
- Test email templates and formatting
- Send automated notifications
- Email deliverability testing
- Educational - learn email protocols
- Transactional email debugging

## Protocol Specification

### SMTP Command Flow

```
Client: EHLO client.example.com
Server: 250-server.example.com
        250-SIZE 35882577
        250-AUTH PLAIN LOGIN
        250 STARTTLS

Client: STARTTLS
Server: 220 Ready to start TLS

[TLS handshake]

Client: AUTH LOGIN
Server: 334 VXNlcm5hbWU6
Client: dGVzdHVzZXI=
Server: 334 UGFzc3dvcmQ6
Client: cGFzc3dvcmQ=
Server: 235 Authentication successful

Client: MAIL FROM:<sender@example.com>
Server: 250 OK

Client: RCPT TO:<recipient@example.com>
Server: 250 OK

Client: DATA
Server: 354 Start mail input

Client: From: sender@example.com
        To: recipient@example.com
        Subject: Test Email

        This is the message body.
        .
Server: 250 OK: queued

Client: QUIT
Server: 221 Bye
```

### SMTP Commands

| Command | Description | Example |
|---------|-------------|---------|
| EHLO | Extended hello | `EHLO client.com` |
| AUTH | Authentication | `AUTH LOGIN` |
| MAIL FROM | Sender address | `MAIL FROM:<user@example.com>` |
| RCPT TO | Recipient | `RCPT TO:<dest@example.com>` |
| DATA | Message content | `DATA` |
| QUIT | Close connection | `QUIT` |

### Response Codes

| Code | Meaning |
|------|---------|
| 220 | Service ready |
| 235 | Authentication successful |
| 250 | Requested action okay |
| 334 | Authentication challenge |
| 354 | Start mail input |
| 421 | Service not available |
| 535 | Authentication failed |

## Worker Implementation

### SMTP Client

```typescript
// src/worker/protocols/smtp/client.ts

import { connect } from 'cloudflare:sockets';

export interface SMTPConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  secure?: boolean; // Use SMTPS (port 465)
  requireTLS?: boolean; // Upgrade with STARTTLS
}

export interface EmailMessage {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    encoding?: string;
  }>;
}

export class SMTPClient {
  private socket: Socket;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(private config: SMTPConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Read greeting
    await this.readResponse();

    // Send EHLO
    await this.send(`EHLO portofcall.app`);
    const ehloResponse = await this.readResponse();

    // Check if STARTTLS is available
    if (this.config.requireTLS && ehloResponse.includes('STARTTLS')) {
      await this.send('STARTTLS');
      await this.readResponse();
      // TODO: Upgrade to TLS
    }

    // Authenticate if credentials provided
    if (this.config.username && this.config.password) {
      await this.authenticate();
    }
  }

  private async authenticate(): Promise<void> {
    // Use AUTH LOGIN
    await this.send('AUTH LOGIN');
    await this.readResponse();

    // Send username (base64)
    const username = btoa(this.config.username!);
    await this.send(username);
    await this.readResponse();

    // Send password (base64)
    const password = btoa(this.config.password!);
    await this.send(password);
    await this.readResponse();
  }

  async sendEmail(email: EmailMessage): Promise<void> {
    // MAIL FROM
    await this.send(`MAIL FROM:<${email.from}>`);
    await this.readResponse();

    // RCPT TO (recipients)
    const recipients = Array.isArray(email.to) ? email.to : [email.to];
    for (const recipient of recipients) {
      await this.send(`RCPT TO:<${recipient}>`);
      await this.readResponse();
    }

    // CC
    if (email.cc) {
      const ccList = Array.isArray(email.cc) ? email.cc : [email.cc];
      for (const cc of ccList) {
        await this.send(`RCPT TO:<${cc}>`);
        await this.readResponse();
      }
    }

    // BCC
    if (email.bcc) {
      const bccList = Array.isArray(email.bcc) ? email.bcc : [email.bcc];
      for (const bcc of bccList) {
        await this.send(`RCPT TO:<${bcc}>`);
        await this.readResponse();
      }
    }

    // DATA
    await this.send('DATA');
    await this.readResponse();

    // Build message
    const message = this.buildMessage(email);
    await this.send(message);
    await this.send('.'); // End of message
    await this.readResponse();
  }

  private buildMessage(email: EmailMessage): string {
    const lines: string[] = [];

    // Headers
    lines.push(`From: ${email.from}`);
    lines.push(`To: ${Array.isArray(email.to) ? email.to.join(', ') : email.to}`);

    if (email.cc) {
      lines.push(`Cc: ${Array.isArray(email.cc) ? email.cc.join(', ') : email.cc}`);
    }

    lines.push(`Subject: ${email.subject}`);
    lines.push(`Date: ${new Date().toUTCString()}`);
    lines.push('MIME-Version: 1.0');

    if (email.html) {
      // Multipart message
      const boundary = `----=_Part_${Date.now()}`;
      lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      lines.push('');

      // Text part
      if (email.text) {
        lines.push(`--${boundary}`);
        lines.push('Content-Type: text/plain; charset=utf-8');
        lines.push('');
        lines.push(email.text);
        lines.push('');
      }

      // HTML part
      lines.push(`--${boundary}`);
      lines.push('Content-Type: text/html; charset=utf-8');
      lines.push('');
      lines.push(email.html);
      lines.push('');
      lines.push(`--${boundary}--`);
    } else {
      // Plain text only
      lines.push('Content-Type: text/plain; charset=utf-8');
      lines.push('');
      lines.push(email.text || '');
    }

    return lines.join('\r\n');
  }

  private async send(data: string): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(this.encoder.encode(data + '\r\n'));
    writer.releaseLock();
  }

  private async readResponse(): Promise<string> {
    const reader = this.socket.readable.getReader();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += this.decoder.decode(value, { stream: true });

      // SMTP responses are line-based
      // Multi-line responses: 250-line1\r\n250-line2\r\n250 last
      if (buffer.includes('\r\n')) {
        const lines = buffer.split('\r\n');
        const lastLine = lines[lines.length - 2];

        // Check if last line doesn't have a dash after code
        if (lastLine && /^\d{3} /.test(lastLine)) {
          reader.releaseLock();
          return buffer;
        }
      }
    }

    reader.releaseLock();
    return buffer;
  }

  async quit(): Promise<void> {
    await this.send('QUIT');
    await this.readResponse();
    await this.socket.close();
  }
}
```

## Web UI Design

### Email Composer

```typescript
// src/components/SMTPEmailComposer.tsx

export function SMTPEmailComposer() {
  const [config, setConfig] = useState<SMTPConfig>({
    host: 'smtp.gmail.com',
    port: 587,
    username: '',
    password: '',
    requireTLS: true,
  });

  const [email, setEmail] = useState<EmailMessage>({
    from: '',
    to: '',
    subject: '',
    text: '',
  });

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string>('');

  const sendEmail = async () => {
    setSending(true);
    setResult('');

    try {
      const response = await fetch('/api/smtp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, email }),
      });

      const data = await response.json();

      if (data.success) {
        setResult('✓ Email sent successfully!');
      } else {
        setResult(`✗ Failed: ${data.error}`);
      }
    } catch (error) {
      setResult(`✗ Error: ${error.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="smtp-composer">
      <h2>Send Email via SMTP</h2>

      <div className="smtp-config">
        <h3>SMTP Server</h3>
        <input
          type="text"
          placeholder="SMTP Host"
          value={config.host}
          onChange={(e) => setConfig({ ...config, host: e.target.value })}
        />
        <input
          type="number"
          placeholder="Port"
          value={config.port}
          onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })}
        />
        <input
          type="text"
          placeholder="Username"
          value={config.username}
          onChange={(e) => setConfig({ ...config, username: e.target.value })}
        />
        <input
          type="password"
          placeholder="Password"
          value={config.password}
          onChange={(e) => setConfig({ ...config, password: e.target.value })}
        />
      </div>

      <div className="email-form">
        <h3>Email Message</h3>
        <input
          type="email"
          placeholder="From"
          value={email.from}
          onChange={(e) => setEmail({ ...email, from: e.target.value })}
        />
        <input
          type="email"
          placeholder="To"
          value={email.to as string}
          onChange={(e) => setEmail({ ...email, to: e.target.value })}
        />
        <input
          type="text"
          placeholder="Subject"
          value={email.subject}
          onChange={(e) => setEmail({ ...email, subject: e.target.value })}
        />
        <textarea
          placeholder="Message"
          value={email.text}
          onChange={(e) => setEmail({ ...email, text: e.target.value })}
          rows={10}
        />
      </div>

      <button onClick={sendEmail} disabled={sending}>
        {sending ? 'Sending...' : 'Send Email'}
      </button>

      {result && (
        <div className={`result ${result.startsWith('✓') ? 'success' : 'error'}`}>
          {result}
        </div>
      )}

      <EmailTemplates onSelect={(template) => setEmail({ ...email, ...template })} />
    </div>
  );
}
```

## Security

### Credential Storage

```typescript
// NEVER store credentials
// Use environment variables or prompt each time
const SMTP_CONFIG = {
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  username: env.SMTP_USERNAME,
  password: env.SMTP_PASSWORD,
};
```

### SPF/DKIM Validation

```typescript
// Warn if From address doesn't match authenticated domain
function validateSender(from: string, domain: string): boolean {
  return from.endsWith(`@${domain}`);
}
```

## Testing

### Test with Mailtrap

```typescript
// Mailtrap - catches all emails for testing
const config = {
  host: 'smtp.mailtrap.io',
  port: 2525,
  username: 'your_username',
  password: 'your_password',
};
```

### Docker Test Server

```bash
# MailHog - SMTP testing
docker run -d -p 1025:1025 -p 8025:8025 mailhog/mailhog
# SMTP: localhost:1025
# Web UI: http://localhost:8025
```

## Resources

- **RFC 5321**: [SMTP Protocol](https://tools.ietf.org/html/rfc5321)
- **RFC 5322**: [Internet Message Format](https://tools.ietf.org/html/rfc5322)
- **Nodemailer**: [Node.js email library](https://nodemailer.com/)

## Next Steps

1. Implement SMTP client
2. Add HTML email support
3. Build email template system
4. Support attachments (base64 encoding)
5. Add email validation
6. Implement DKIM signing
7. Create email testing tools

## Notes

- Port 587 (submission) is preferred over port 25
- Always use TLS when available (STARTTLS)
- Gmail requires "App Passwords" for SMTP access
- Consider rate limiting to prevent abuse
