# IMAP Protocol Implementation Plan

## Overview

**Protocol:** IMAP (Internet Message Access Protocol)
**Port:** 143 (plain), 993 (SSL/TLS)
**RFC:** [RFC 3501](https://tools.ietf.org/html/rfc3501)
**Complexity:** High
**Purpose:** Advanced email retrieval and management

IMAP is the **modern email protocol** supporting multiple devices, server-side folders, and advanced search. More complex than POP3 but much more powerful.

### Use Cases
- Full-featured email client
- Multi-device email synchronization
- Server-side email organization
- Advanced email search and filtering
- Email management and archival
- Mobile email access

## Protocol Specification

### IMAP States

```
Not Authenticated → Authenticated → Selected → Logout
```

### IMAP Command Structure

All commands are tagged:
```
A001 LOGIN user password
A002 SELECT INBOX
A003 FETCH 1 BODY[]
A004 LOGOUT
```

### Common Commands

| Command | State | Description |
|---------|-------|-------------|
| LOGIN | Any | Authenticate |
| SELECT | Auth | Select mailbox |
| EXAMINE | Auth | Select read-only |
| CREATE | Auth | Create mailbox |
| DELETE | Auth | Delete mailbox |
| LIST | Auth | List mailboxes |
| FETCH | Selected | Retrieve messages |
| STORE | Selected | Update flags |
| SEARCH | Selected | Search messages |
| IDLE | Selected | Wait for new mail |
| LOGOUT | Any | Close connection |

### Response Types

- **OK** - Success
- **NO** - Failure
- **BAD** - Protocol error
- **PREAUTH** - Already authenticated
- **BYE** - Closing connection

### FETCH Data Items

| Item | Description |
|------|-------------|
| BODY[] | Full message |
| BODY[HEADER] | Headers only |
| BODY[TEXT] | Body only |
| FLAGS | Message flags |
| ENVELOPE | Parsed headers |
| UID | Unique ID |
| RFC822.SIZE | Message size |

## Worker Implementation

### IMAP Client

```typescript
// src/worker/protocols/imap/client.ts

import { connect } from 'cloudflare:sockets';

export interface IMAPConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  secure?: boolean;
}

export interface IMAPMailbox {
  name: string;
  flags: string[];
  exists: number;
  recent: number;
  unseen?: number;
}

export interface IMAPMessage {
  uid: number;
  seq: number;
  flags: string[];
  envelope?: {
    date: string;
    subject: string;
    from: string[];
    to: string[];
  };
  size?: number;
  body?: string;
}

export class IMAPClient {
  private socket: Socket;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private tagCounter = 0;
  private currentMailbox: string | null = null;

  constructor(private config: IMAPConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Read greeting
    const greeting = await this.readResponse();

    if (!greeting.includes('OK')) {
      throw new Error('Server not ready');
    }
  }

  async login(): Promise<void> {
    const tag = this.nextTag();
    await this.send(`${tag} LOGIN ${this.config.username} ${this.config.password}`);

    const response = await this.readTaggedResponse(tag);

    if (!response.includes('OK')) {
      throw new Error('Authentication failed');
    }
  }

  async listMailboxes(pattern: string = '*'): Promise<string[]> {
    const tag = this.nextTag();
    await this.send(`${tag} LIST "" "${pattern}"`);

    const response = await this.readTaggedResponse(tag);
    const mailboxes: string[] = [];

    const lines = response.split('\r\n');
    for (const line of lines) {
      if (line.startsWith('* LIST')) {
        // Parse: * LIST (\HasNoChildren) "/" "INBOX"
        const match = line.match(/"([^"]+)"$/);
        if (match) {
          mailboxes.push(match[1]);
        }
      }
    }

    return mailboxes;
  }

  async selectMailbox(mailbox: string): Promise<IMAPMailbox> {
    const tag = this.nextTag();
    await this.send(`${tag} SELECT ${mailbox}`);

    const response = await this.readTaggedResponse(tag);

    if (!response.includes('OK')) {
      throw new Error(`Failed to select ${mailbox}`);
    }

    this.currentMailbox = mailbox;

    // Parse mailbox info
    const info: IMAPMailbox = {
      name: mailbox,
      flags: [],
      exists: 0,
      recent: 0,
    };

    const lines = response.split('\r\n');
    for (const line of lines) {
      if (line.includes(' EXISTS')) {
        info.exists = parseInt(line.match(/\* (\d+) EXISTS/)?.[1] || '0');
      } else if (line.includes(' RECENT')) {
        info.recent = parseInt(line.match(/\* (\d+) RECENT/)?.[1] || '0');
      } else if (line.includes('UNSEEN')) {
        info.unseen = parseInt(line.match(/UNSEEN (\d+)/)?.[1] || '0');
      }
    }

    return info;
  }

  async search(criteria: string): Promise<number[]> {
    const tag = this.nextTag();
    await this.send(`${tag} SEARCH ${criteria}`);

    const response = await this.readTaggedResponse(tag);

    // Parse: * SEARCH 1 2 3 4
    const match = response.match(/\* SEARCH (.+)/);
    if (!match) return [];

    return match[1].split(' ').map(Number).filter(n => n > 0);
  }

  async fetch(
    sequence: string,
    items: string
  ): Promise<IMAPMessage[]> {
    const tag = this.nextTag();
    await this.send(`${tag} FETCH ${sequence} ${items}`);

    const response = await this.readTaggedResponse(tag);

    return this.parseFetchResponse(response);
  }

  async fetchMessage(uid: number): Promise<IMAPMessage> {
    const messages = await this.fetch(
      uid.toString(),
      '(UID FLAGS ENVELOPE RFC822.SIZE BODY[])'
    );

    return messages[0];
  }

  async setFlags(
    sequence: string,
    flags: string[],
    mode: '+' | '-' | '' = ''
  ): Promise<void> {
    const tag = this.nextTag();
    const flagList = flags.map(f => `\\${f}`).join(' ');
    await this.send(`${tag} STORE ${sequence} ${mode}FLAGS (${flagList})`);

    await this.readTaggedResponse(tag);
  }

  async deleteMessage(uid: number): Promise<void> {
    await this.setFlags(uid.toString(), ['Deleted'], '+');

    const tag = this.nextTag();
    await this.send(`${tag} EXPUNGE`);
    await this.readTaggedResponse(tag);
  }

  async createMailbox(name: string): Promise<void> {
    const tag = this.nextTag();
    await this.send(`${tag} CREATE ${name}`);
    await this.readTaggedResponse(tag);
  }

  async deleteMailbox(name: string): Promise<void> {
    const tag = this.nextTag();
    await this.send(`${tag} DELETE ${name}`);
    await this.readTaggedResponse(tag);
  }

  async idle(): Promise<void> {
    const tag = this.nextTag();
    await this.send(`${tag} IDLE`);

    // Server responds with "+ idling"
    await this.readLine();
  }

  async stopIdle(): Promise<void> {
    await this.send('DONE');
    // Read response from previous IDLE command
    await this.readResponse();
  }

  async logout(): Promise<void> {
    const tag = this.nextTag();
    await this.send(`${tag} LOGOUT`);
    await this.readTaggedResponse(tag);
    await this.socket.close();
  }

  private parseFetchResponse(response: string): IMAPMessage[] {
    const messages: IMAPMessage[] = [];
    const lines = response.split('\r\n');
    let currentMessage: Partial<IMAPMessage> = {};

    for (const line of lines) {
      if (line.startsWith('* ') && line.includes(' FETCH ')) {
        // New message
        if (currentMessage.seq) {
          messages.push(currentMessage as IMAPMessage);
        }

        const seqMatch = line.match(/\* (\d+) FETCH/);
        currentMessage = {
          seq: parseInt(seqMatch?.[1] || '0'),
          flags: [],
        };

        // Parse UID
        const uidMatch = line.match(/UID (\d+)/);
        if (uidMatch) {
          currentMessage.uid = parseInt(uidMatch[1]);
        }

        // Parse flags
        const flagsMatch = line.match(/FLAGS \(([^)]+)\)/);
        if (flagsMatch) {
          currentMessage.flags = flagsMatch[1].split(' ').map(f => f.replace('\\', ''));
        }

        // Parse size
        const sizeMatch = line.match(/RFC822\.SIZE (\d+)/);
        if (sizeMatch) {
          currentMessage.size = parseInt(sizeMatch[1]);
        }
      }
    }

    if (currentMessage.seq) {
      messages.push(currentMessage as IMAPMessage);
    }

    return messages;
  }

  private nextTag(): string {
    return `A${String(++this.tagCounter).padStart(4, '0')}`;
  }

  private async send(command: string): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(this.encoder.encode(command + '\r\n'));
    writer.releaseLock();
  }

  private async readLine(): Promise<string> {
    const reader = this.socket.readable.getReader();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += this.decoder.decode(value, { stream: true });

      if (buffer.includes('\r\n')) {
        const lines = buffer.split('\r\n');
        reader.releaseLock();
        return lines[0];
      }
    }

    reader.releaseLock();
    return buffer;
  }

  private async readResponse(): Promise<string> {
    const reader = this.socket.readable.getReader();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += this.decoder.decode(value, { stream: true });

      // IMAP responses end with tagged OK/NO/BAD
      if (/\r\n[A-Z]\d+ (OK|NO|BAD)/.test(buffer)) {
        reader.releaseLock();
        return buffer;
      }
    }

    reader.releaseLock();
    return buffer;
  }

  private async readTaggedResponse(tag: string): Promise<string> {
    const reader = this.socket.readable.getReader();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += this.decoder.decode(value, { stream: true });

      // Look for tagged completion
      const regex = new RegExp(`\\r\\n${tag} (OK|NO|BAD)`);
      if (regex.test(buffer)) {
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

### Email Client Component

```typescript
// src/components/IMAPClient.tsx

export function IMAPClient() {
  const [connected, setConnected] = useState(false);
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [selectedMailbox, setSelectedMailbox] = useState<string>('INBOX');
  const [messages, setMessages] = useState<IMAPMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<IMAPMessage | null>(null);

  const ws = useRef<WebSocket | null>(null);

  const loadMailboxes = () => {
    ws.current?.send(JSON.stringify({ type: 'listMailboxes' }));
  };

  const selectMailbox = (mailbox: string) => {
    setSelectedMailbox(mailbox);
    ws.current?.send(JSON.stringify({
      type: 'selectMailbox',
      mailbox,
    }));
  };

  const loadMessages = () => {
    ws.current?.send(JSON.stringify({
      type: 'search',
      criteria: 'ALL',
    }));
  };

  const loadMessage = (uid: number) => {
    ws.current?.send(JSON.stringify({
      type: 'fetchMessage',
      uid,
    }));
  };

  return (
    <div className="imap-client">
      <div className="sidebar">
        <h3>Mailboxes</h3>
        <ul className="mailbox-list">
          {mailboxes.map(mailbox => (
            <li
              key={mailbox}
              className={selectedMailbox === mailbox ? 'selected' : ''}
              onClick={() => selectMailbox(mailbox)}
            >
              📁 {mailbox}
            </li>
          ))}
        </ul>

        <button onClick={loadMailboxes}>Refresh</button>
      </div>

      <div className="message-list">
        <h3>{selectedMailbox}</h3>
        <button onClick={loadMessages}>Refresh</button>

        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>Subject</th>
              <th>Date</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {messages.map(msg => (
              <tr
                key={msg.uid}
                onClick={() => loadMessage(msg.uid)}
                className={selectedMessage?.uid === msg.uid ? 'selected' : ''}
              >
                <td>{msg.envelope?.from?.[0] || 'Unknown'}</td>
                <td>
                  {msg.flags?.includes('Seen') ? '' : '🔵 '}
                  {msg.envelope?.subject || '(no subject)'}
                </td>
                <td>{msg.envelope?.date}</td>
                <td>{(msg.size || 0 / 1024).toFixed(1)}KB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="message-viewer">
        {selectedMessage && (
          <EmailMessageDisplay
            message={selectedMessage}
            onDelete={(uid) => {
              ws.current?.send(JSON.stringify({
                type: 'deleteMessage',
                uid,
              }));
            }}
          />
        )}
      </div>
    </div>
  );
}
```

## Security

### SSL/TLS

```typescript
// Always use port 993 (SSL) for production
const config = {
  host: 'imap.gmail.com',
  port: 993,
  secure: true,
};
```

### OAuth2

```typescript
// Modern email providers prefer OAuth2
// Gmail requires OAuth2 or App Passwords
```

## Testing

### Docker IMAP Server

```bash
docker run -d \
  -p 143:143 \
  -p 993:993 \
  -e MAIL_ADDRESS=test@example.com \
  -e MAIL_PASS=password \
  tvial/docker-mailserver
```

## Resources

- **RFC 3501**: [IMAP4rev1](https://tools.ietf.org/html/rfc3501)
- **RFC 2177**: [IDLE Extension](https://tools.ietf.org/html/rfc2177)
- **Gmail IMAP**: [Google Docs](https://developers.google.com/gmail/imap/imap-smtp)

## Next Steps

1. Implement IMAP client with state machine
2. Build mailbox folder tree
3. Add message threading
4. Support IDLE for push notifications
5. Implement search queries
6. Add attachment handling
7. Create email composition

## Notes

- IMAP is **much more complex** than POP3
- Supports **multiple devices** syncing
- Server-side **folder organization**
- **IDLE** command enables push email
- Gmail requires OAuth2 or App Passwords
