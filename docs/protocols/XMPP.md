# XMPP Protocol Implementation Plan

## Overview

**Protocol:** XMPP (Extensible Messaging and Presence Protocol) / Jabber
**Port:** 5222 (client), 5269 (server-to-server), 5280 (BOSH HTTP)
**RFC:** [RFC 6120](https://tools.ietf.org/html/rfc6120), [RFC 6121](https://tools.ietf.org/html/rfc6121), [RFC 6122](https://tools.ietf.org/html/rfc6122)
**Complexity:** High
**Purpose:** Instant messaging, presence, and real-time communication

XMPP enables **instant messaging and presence** - chat, group conversations, presence updates, and real-time notifications from the browser.

### Use Cases
- Instant messaging
- Presence information
- Multi-user chat (MUC)
- Push notifications
- IoT device communication
- Gaming chat systems

## Protocol Specification

### XML Streaming Protocol

XMPP uses XML streams:

```xml
<?xml version='1.0'?>
<stream:stream
    to='jabber.org'
    xmlns='jabber:client'
    xmlns:stream='http://etherx.jabber.org/streams'
    version='1.0'>
```

### Stanza Types

**Message:**
```xml
<message
    from='juliet@example.com/balcony'
    to='romeo@example.net'
    type='chat'
    xml:lang='en'>
  <body>Wherefore art thou, Romeo?</body>
</message>
```

**Presence:**
```xml
<presence from='juliet@example.com/balcony'>
  <show>away</show>
  <status>Be right back</status>
  <priority>5</priority>
</presence>
```

**IQ (Info/Query):**
```xml
<iq from='juliet@example.com/balcony'
    id='roster1'
    type='get'>
  <query xmlns='jabber:iq:roster'/>
</iq>
```

### JID (Jabber Identifier)

Format: `localpart@domainpart/resourcepart`

Examples:
- `user@jabber.org` (bare JID)
- `user@jabber.org/mobile` (full JID)
- `room@conference.jabber.org` (MUC room)

### Connection Flow

```
1. Client → Server: Open stream
2. Server → Client: Stream features
3. Client → Server: STARTTLS (optional)
4. Client ↔ Server: TLS negotiation
5. Client → Server: SASL authentication
6. Server → Client: Success
7. Client → Server: Bind resource
8. Client → Server: Start session
9. Client ↔ Server: Stanzas
```

### Message Types

| Type | Description |
|------|-------------|
| chat | One-to-one chat |
| groupchat | Multi-user chat |
| headline | News/alerts |
| normal | Email-like message |
| error | Error message |

### Presence Show Values

| Value | Meaning |
|-------|---------|
| (none) | Available |
| away | Temporarily away |
| chat | Free for chat |
| dnd | Do not disturb |
| xa | Extended away |

## Worker Implementation

```typescript
// src/worker/protocols/xmpp/client.ts

import { connect } from 'cloudflare:sockets';

export interface XMPPConfig {
  host: string;
  port?: number;
  jid: string; // user@domain
  password: string;
  resource?: string;
}

export interface XMPPMessage {
  from: string;
  to: string;
  body: string;
  type?: 'chat' | 'groupchat' | 'headline' | 'normal';
  id?: string;
}

export interface XMPPPresence {
  from: string;
  show?: 'away' | 'chat' | 'dnd' | 'xa';
  status?: string;
  priority?: number;
}

export class XMPPClient {
  private socket: any;
  private streamId?: string;
  private authenticated = false;
  private bound = false;
  private fullJid?: string;

  constructor(private config: XMPPConfig) {}

  async connect(): Promise<void> {
    const port = this.config.port || 5222;
    this.socket = connect(`${this.config.host}:${port}`);
    await this.socket.opened;

    // Start reading XML stream
    this.readLoop();

    // Open stream
    await this.openStream();
  }

  private async openStream(): Promise<void> {
    const domain = this.config.jid.split('@')[1];

    const stream = `<?xml version='1.0'?>\n` +
      `<stream:stream to='${domain}' ` +
      `xmlns='jabber:client' ` +
      `xmlns:stream='http://etherx.jabber.org/streams' ` +
      `version='1.0'>`;

    await this.send(stream);
  }

  async authenticate(): Promise<void> {
    // Wait for stream features
    await this.waitForFeatures();

    // SASL PLAIN authentication
    const [username, domain] = this.config.jid.split('@');
    const authString = `\0${username}\0${this.config.password}`;
    const authBase64 = btoa(authString);

    const auth = `<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' ` +
      `mechanism='PLAIN'>${authBase64}</auth>`;

    await this.send(auth);

    // Wait for success
    await this.waitForSuccess();

    this.authenticated = true;

    // Restart stream after authentication
    await this.openStream();
    await this.waitForFeatures();
  }

  async bind(): Promise<void> {
    const resource = this.config.resource || 'web';

    const bindIq = `<iq type='set' id='bind_1'>` +
      `<bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'>` +
      `<resource>${resource}</resource>` +
      `</bind>` +
      `</iq>`;

    await this.send(bindIq);

    // Wait for bind result (contains full JID)
    // This would be handled in readLoop
    this.bound = true;
  }

  async startSession(): Promise<void> {
    const sessionIq = `<iq type='set' id='session_1'>` +
      `<session xmlns='urn:ietf:params:xml:ns:xmpp-session'/>` +
      `</iq>`;

    await this.send(sessionIq);
  }

  async sendMessage(to: string, body: string, type: string = 'chat'): Promise<void> {
    const id = `msg_${Date.now()}`;

    const message = `<message to='${to}' type='${type}' id='${id}'>` +
      `<body>${this.escapeXml(body)}</body>` +
      `</message>`;

    await this.send(message);
  }

  async sendPresence(show?: string, status?: string, priority?: number): Promise<void> {
    let presence = '<presence>';

    if (show) {
      presence += `<show>${show}</show>`;
    }

    if (status) {
      presence += `<status>${this.escapeXml(status)}</status>`;
    }

    if (priority !== undefined) {
      presence += `<priority>${priority}</priority>`;
    }

    presence += '</presence>';

    await this.send(presence);
  }

  async getRoster(): Promise<void> {
    const iq = `<iq type='get' id='roster_1'>` +
      `<query xmlns='jabber:iq:roster'/>` +
      `</iq>`;

    await this.send(iq);
  }

  async addToRoster(jid: string, name?: string): Promise<void> {
    const id = `roster_add_${Date.now()}`;

    let item = `<item jid='${jid}'`;
    if (name) {
      item += ` name='${this.escapeXml(name)}'`;
    }
    item += '/>';

    const iq = `<iq type='set' id='${id}'>` +
      `<query xmlns='jabber:iq:roster'>` +
      item +
      `</query>` +
      `</iq>`;

    await this.send(iq);
  }

  async subscribe(jid: string): Promise<void> {
    const presence = `<presence to='${jid}' type='subscribe'/>`;
    await this.send(presence);
  }

  async joinRoom(room: string, nickname: string): Promise<void> {
    const presence = `<presence to='${room}/${nickname}'>` +
      `<x xmlns='http://jabber.org/protocol/muc'/>` +
      `</presence>`;

    await this.send(presence);
  }

  async sendRoomMessage(room: string, body: string): Promise<void> {
    await this.sendMessage(room, body, 'groupchat');
  }

  private async send(data: string): Promise<void> {
    const writer = this.socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(data));
    writer.releaseLock();
  }

  private async readLoop(): Promise<void> {
    const reader = this.socket.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse XML stanzas
      // Simplified - real implementation needs proper XML parser
      if (buffer.includes('</stream:stream>')) {
        break;
      }

      // Process complete stanzas
      buffer = this.processStanzas(buffer);
    }
  }

  private processStanzas(buffer: string): string {
    // Extract and process complete XML stanzas
    // This is simplified - real implementation needs XML parser

    if (buffer.includes('<message')) {
      const match = buffer.match(/<message[^>]*>.*?<\/message>/s);
      if (match) {
        this.handleMessage(match[0]);
        buffer = buffer.replace(match[0], '');
      }
    }

    if (buffer.includes('<presence')) {
      const match = buffer.match(/<presence[^>]*>.*?<\/presence>/s);
      if (match) {
        this.handlePresence(match[0]);
        buffer = buffer.replace(match[0], '');
      }
    }

    if (buffer.includes('<iq')) {
      const match = buffer.match(/<iq[^>]*>.*?<\/iq>/s);
      if (match) {
        this.handleIQ(match[0]);
        buffer = buffer.replace(match[0], '');
      }
    }

    return buffer;
  }

  private handleMessage(xml: string): void {
    // Parse message stanza
    const fromMatch = xml.match(/from=['"]([^'"]+)['"]/);
    const bodyMatch = xml.match(/<body>([^<]+)<\/body>/);

    if (fromMatch && bodyMatch) {
      console.log(`Message from ${fromMatch[1]}: ${bodyMatch[1]}`);
    }
  }

  private handlePresence(xml: string): void {
    // Parse presence stanza
    const fromMatch = xml.match(/from=['"]([^'"]+)['"]/);
    const showMatch = xml.match(/<show>([^<]+)<\/show>/);

    if (fromMatch) {
      const show = showMatch ? showMatch[1] : 'available';
      console.log(`Presence from ${fromMatch[1]}: ${show}`);
    }
  }

  private handleIQ(xml: string): void {
    // Parse IQ stanza
    console.log('IQ received:', xml);
  }

  private async waitForFeatures(): Promise<void> {
    // Wait for stream features
    // Simplified - real implementation tracks state
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  private async waitForSuccess(): Promise<void> {
    // Wait for SASL success
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async close(): Promise<void> {
    await this.send('</stream:stream>');

    if (this.socket) {
      await this.socket.close();
    }
  }
}

// BOSH (HTTP-based XMPP)

export class XMPPBOSHClient {
  private sessionId?: string;
  private rid = Math.floor(Math.random() * 10000000);

  constructor(
    private boshUrl: string,
    private jid: string,
    private password: string
  ) {}

  async connect(): Promise<void> {
    const domain = this.jid.split('@')[1];

    const body = this.buildBody({
      'xmlns:xmpp': 'urn:xmpp:xbosh',
      'xmpp:version': '1.0',
      'to': domain,
      'wait': '60',
      'hold': '1',
    });

    const response = await fetch(this.boshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body,
    });

    const xml = await response.text();
    this.sessionId = this.extractAttribute(xml, 'sid');
  }

  async sendMessage(to: string, body: string): Promise<void> {
    const message = `<message to='${to}' type='chat'>` +
      `<body>${body}</body>` +
      `</message>`;

    const boshBody = this.buildBody({}, message);

    await fetch(this.boshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: boshBody,
    });
  }

  private buildBody(attrs: Record<string, string>, content: string = ''): string {
    this.rid++;

    let body = `<body rid='${this.rid}' ` +
      `xmlns='http://jabber.org/protocol/httpbind'`;

    if (this.sessionId) {
      body += ` sid='${this.sessionId}'`;
    }

    for (const [key, value] of Object.entries(attrs)) {
      body += ` ${key}='${value}'`;
    }

    body += '>';
    body += content;
    body += '</body>';

    return body;
  }

  private extractAttribute(xml: string, attr: string): string {
    const match = xml.match(new RegExp(`${attr}=['"]([^'"]+)['"]`));
    return match ? match[1] : '';
  }
}
```

## Web UI Design

```typescript
// src/components/XMPPClient.tsx

export function XMPPClient() {
  const [connected, setConnected] = useState(false);
  const [jid, setJid] = useState('user@jabber.org');
  const [password, setPassword] = useState('');
  const [recipient, setRecipient] = useState('friend@jabber.org');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<XMPPMessage[]>([]);
  const [roster, setRoster] = useState<string[]>([]);

  const connect = async () => {
    await fetch('/api/xmpp/connect', {
      method: 'POST',
      body: JSON.stringify({ jid, password }),
    });

    setConnected(true);

    // Load roster
    loadRoster();

    // Start listening for messages
    startMessageListener();
  };

  const loadRoster = async () => {
    const response = await fetch('/api/xmpp/roster');
    const data = await response.json();
    setRoster(data);
  };

  const sendMessage = async () => {
    await fetch('/api/xmpp/message', {
      method: 'POST',
      body: JSON.stringify({ to: recipient, body: message }),
    });

    setMessages([...messages, { from: jid, to: recipient, body: message }]);
    setMessage('');
  };

  const setPresence = async (show: string, status: string) => {
    await fetch('/api/xmpp/presence', {
      method: 'POST',
      body: JSON.stringify({ show, status }),
    });
  };

  const startMessageListener = () => {
    const ws = new WebSocket('/api/xmpp/messages');

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      setMessages(prev => [...prev, msg]);
    };
  };

  return (
    <div className="xmpp-client">
      <h2>XMPP/Jabber Client</h2>

      {!connected ? (
        <div className="login">
          <input
            type="text"
            placeholder="JID (user@jabber.org)"
            value={jid}
            onChange={(e) => setJid(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button onClick={connect}>Connect</button>
        </div>
      ) : (
        <>
          <div className="sidebar">
            <h3>Roster</h3>
            <ul>
              {roster.map(contact => (
                <li
                  key={contact}
                  onClick={() => setRecipient(contact)}
                  className={recipient === contact ? 'selected' : ''}
                >
                  👤 {contact}
                </li>
              ))}
            </ul>

            <h3>Presence</h3>
            <select onChange={(e) => setPresence(e.target.value, 'Available')}>
              <option value="">Available</option>
              <option value="away">Away</option>
              <option value="dnd">Do Not Disturb</option>
              <option value="xa">Extended Away</option>
            </select>
          </div>

          <div className="chat">
            <h3>Chat with {recipient}</h3>

            <div className="messages">
              {messages
                .filter(m => m.from === recipient || m.to === recipient)
                .map((msg, i) => (
                  <div key={i} className={`message ${msg.from === jid ? 'sent' : 'received'}`}>
                    <strong>{msg.from === jid ? 'You' : msg.from}:</strong>
                    <span>{msg.body}</span>
                  </div>
                ))}
            </div>

            <div className="input">
              <input
                type="text"
                placeholder="Type a message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              />
              <button onClick={sendMessage}>Send</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

## Security

### STARTTLS

```xml
<starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>
```

### SASL Authentication

```
Mechanisms: PLAIN, SCRAM-SHA-1, SCRAM-SHA-256, DIGEST-MD5
```

### E2E Encryption

```
OMEMO, OTR (Off-the-Record), PGP
```

## Testing

### Public XMPP Servers

- `jabber.org`
- `xmpp.jp`
- `conversations.im`

### ejabberd (Docker)

```bash
# ejabberd XMPP server
docker run -d \
  -p 5222:5222 \
  -p 5269:5269 \
  -p 5280:5280 \
  --name ejabberd \
  ejabberd/ecs

# Create user
docker exec ejabberd ejabberdctl register user localhost password
```

### Prosody

```bash
# Prosody XMPP server
docker run -d \
  -p 5222:5222 \
  -p 5269:5269 \
  --name prosody \
  prosody/prosody
```

## Resources

- **RFC 6120**: [XMPP Core](https://tools.ietf.org/html/rfc6120)
- **RFC 6121**: [XMPP Instant Messaging](https://tools.ietf.org/html/rfc6121)
- **XEPs**: [XMPP Extension Protocols](https://xmpp.org/extensions/)
- **ejabberd**: [XMPP server](https://www.ejabberd.im/)

## XEPs (Common Extensions)

| XEP | Title |
|-----|-------|
| 0045 | Multi-User Chat (MUC) |
| 0054 | vcard-temp |
| 0085 | Chat State Notifications |
| 0092 | Software Version |
| 0115 | Entity Capabilities |
| 0163 | Personal Eventing Protocol (PEP) |
| 0191 | Blocking Command |
| 0198 | Stream Management |
| 0280 | Message Carbons |
| 0313 | Message Archive Management (MAM) |
| 0363 | HTTP File Upload |
| 0384 | OMEMO Encryption |

## Notes

- **XML streaming** - verbose but extensible
- **Decentralized** - like email, any server can connect
- **Extensible** - many XEPs for features
- **Real-time** - push-based, not polling
- **Federation** - server-to-server communication
- **Roster** - contact list management
- **Presence** - availability status
- **MUC** - group chat rooms
- **BOSH** - HTTP binding for web clients
- **WebSocket** support via RFC 7395
