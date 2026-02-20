# POP3 Protocol Implementation Plan

## Overview

**Protocol:** POP3 (Post Office Protocol version 3)
**Port:** 110 (plain), 995 (SSL/TLS)
**RFC:** [RFC 1939](https://tools.ietf.org/html/rfc1939)
**Complexity:** Low-Medium
**Purpose:** Retrieve email from mailbox

POP3 is the **simpler alternative to IMAP** for reading email. It downloads messages and typically deletes them from the server, making it perfect for single-device access.

### Use Cases
- Simple email client (read-only)
- Email backup/archival
- Message migration between servers
- Testing email delivery
- Educational - learn email retrieval

## Protocol Specification

### POP3 Command Flow

```
Server: +OK POP3 server ready
Client: USER alice
Server: +OK User accepted
Client: PASS secret123
Server: +OK Pass accepted

Client: STAT
Server: +OK 2 320
       (2 messages, 320 octets total)

Client: LIST
Server: +OK 2 messages (320 octets)
        1 120
        2 200
        .

Client: RETR 1
Server: +OK 120 octets
        Return-Path: <sender@example.com>
        From: sender@example.com
        Subject: Test Message

        This is the message body.
        .

Client: DELE 1
Server: +OK Message 1 deleted

Client: QUIT
Server: +OK POP3 server signing off
```

### POP3 Commands

| Command | Parameters | Description |
|---------|-----------|-------------|
| USER | username | Username for auth |
| PASS | password | Password for auth |
| STAT | - | Mailbox statistics |
| LIST | [msg] | List messages |
| RETR | msg | Retrieve message |
| DELE | msg | Delete message |
| NOOP | - | No operation |
| RSET | - | Reset session |
| QUIT | - | Close connection |
| TOP | msg, n | Get message headers + n lines |
| UIDL | [msg] | Unique message ID |

### Response Format

- `+OK` - Success
- `-ERR` - Error

## Worker Implementation

### POP3 Client

```typescript
// src/worker/protocols/pop3/client.ts

import { connect } from 'cloudflare:sockets';

export interface POP3Config {
  host: string;
  port: number;
  username: string;
  password: string;
  secure?: boolean;
}

export interface EmailMessage {
  id: number;
  size: number;
  uid?: string;
  headers?: Record<string, string>;
  body?: string;
}

export class POP3Client {
  private socket: Socket;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(private config: POP3Config) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Read greeting
    await this.readResponse();

    // Authenticate
    await this.send(`USER ${this.config.username}`);
    await this.readResponse();

    await this.send(`PASS ${this.config.password}`);
    await this.readResponse();
  }

  async stat(): Promise<{ count: number; size: number }> {
    await this.send('STAT');
    const response = await this.readResponse();

    // +OK 2 320
    const match = response.match(/\+OK (\d+) (\d+)/);
    if (!match) throw new Error('Invalid STAT response');

    return {
      count: parseInt(match[1]),
      size: parseInt(match[2]),
    };
  }

  async list(): Promise<EmailMessage[]> {
    await this.send('LIST');
    const response = await this.readMultilineResponse();

    const messages: EmailMessage[] = [];
    const lines = response.split('\r\n').slice(1); // Skip +OK line

    for (const line of lines) {
      if (line === '.') break;
      const [id, size] = line.split(' ').map(Number);
      messages.push({ id, size });
    }

    return messages;
  }

  async retrieve(messageId: number): Promise<string> {
    await this.send(`RETR ${messageId}`);
    const response = await this.readMultilineResponse();

    // Remove +OK line and ending dot
    const lines = response.split('\r\n');
    lines.shift(); // Remove +OK
    lines.pop();   // Remove .
    lines.pop();   // Remove last \r\n

    return lines.join('\r\n');
  }

  async top(messageId: number, lines: number = 0): Promise<string> {
    await this.send(`TOP ${messageId} ${lines}`);
    const response = await this.readMultilineResponse();

    const responseLines = response.split('\r\n');
    responseLines.shift(); // Remove +OK
    responseLines.pop();   // Remove .

    return responseLines.join('\r\n');
  }

  async delete(messageId: number): Promise<void> {
    await this.send(`DELE ${messageId}`);
    await this.readResponse();
  }

  async uidl(messageId?: number): Promise<Map<number, string>> {
    const cmd = messageId ? `UIDL ${messageId}` : 'UIDL';
    await this.send(cmd);
    const response = await this.readMultilineResponse();

    const uidMap = new Map<number, string>();
    const lines = response.split('\r\n').slice(1);

    for (const line of lines) {
      if (line === '.') break;
      const [id, uid] = line.split(' ');
      uidMap.set(parseInt(id), uid);
    }

    return uidMap;
  }

  parseMessage(raw: string): { headers: Record<string, string>; body: string } {
    const parts = raw.split('\r\n\r\n');
    const headerSection = parts[0];
    const body = parts.slice(1).join('\r\n\r\n');

    const headers: Record<string, string> = {};
    let currentHeader = '';

    for (const line of headerSection.split('\r\n')) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        // Continuation of previous header
        headers[currentHeader] += ' ' + line.trim();
      } else {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).toLowerCase();
          const value = line.substring(colonIndex + 1).trim();
          headers[key] = value;
          currentHeader = key;
        }
      }
    }

    return { headers, body };
  }

  async quit(): Promise<void> {
    await this.send('QUIT');
    await this.readResponse();
    await this.socket.close();
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

      if (buffer.includes('\r\n')) {
        reader.releaseLock();
        return buffer;
      }
    }

    reader.releaseLock();
    return buffer;
  }

  private async readMultilineResponse(): Promise<string> {
    const reader = this.socket.readable.getReader();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += this.decoder.decode(value, { stream: true });

      // POP3 multiline ends with \r\n.\r\n
      if (buffer.includes('\r\n.\r\n')) {
        reader.releaseLock();
        return buffer;
      }
    }

    reader.releaseLock();
    return buffer;
  }
}
```

## Web UI Design

### Email Inbox Component

```typescript
// src/components/POP3Inbox.tsx

export function POP3Inbox() {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<number | null>(null);
  const [messageContent, setMessageContent] = useState<string>('');

  const ws = useRef<WebSocket | null>(null);

  const loadMessages = () => {
    ws.current?.send(JSON.stringify({ type: 'list' }));
  };

  const loadMessage = (id: number) => {
    ws.current?.send(JSON.stringify({ type: 'retrieve', id }));
    setSelectedMessage(id);
  };

  const deleteMessage = (id: number) => {
    if (confirm('Delete this message?')) {
      ws.current?.send(JSON.stringify({ type: 'delete', id }));
    }
  };

  return (
    <div className="pop3-inbox">
      <div className="message-list">
        <h3>Inbox ({messages.length})</h3>
        <button onClick={loadMessages}>Refresh</button>

        <ul>
          {messages.map(msg => (
            <li
              key={msg.id}
              className={selectedMessage === msg.id ? 'selected' : ''}
              onClick={() => loadMessage(msg.id)}
            >
              <span className="id">#{msg.id}</span>
              <span className="size">{(msg.size / 1024).toFixed(1)}KB</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="message-viewer">
        {selectedMessage && messageContent && (
          <EmailMessageDisplay
            content={messageContent}
            onDelete={() => deleteMessage(selectedMessage)}
          />
        )}
      </div>
    </div>
  );
}
```

## Security

### Password Handling

```typescript
// Never store passwords
// Use APOP (MD5 digest) when available for better security
```

### SSL/TLS

```typescript
// Always prefer port 995 (SSL) over port 110 (plain text)
const config = {
  host: 'pop.gmail.com',
  port: 995, // SSL
  secure: true,
};
```

## Testing

### Test Server

```bash
# Dovecot POP3 server
docker run -d \
  -p 110:110 \
  -p 995:995 \
  dovecot/dovecot
```

## Resources

- **RFC 1939**: [POP3 Protocol](https://tools.ietf.org/html/rfc1939)
- **Test Mailbox**: Use Mailtrap or Gmail

## Next Steps

1. Implement POP3 client
2. Build message list UI
3. Add message parsing (headers/body)
4. Support HTML email rendering
5. Add attachment extraction
6. Implement "leave on server" option

## Notes

- POP3 is **simpler than IMAP** but less flexible
- Messages are typically **deleted after download**
- Good for **single-device** email access
- Consider IMAP for multi-device sync
