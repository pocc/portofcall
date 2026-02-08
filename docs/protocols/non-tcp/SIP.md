# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**Protocol:** SIP (Session Initiation Protocol)
**Port:** 5060 (TCP/UDP), 5061 (TLS)
**RFC:** [RFC 3261](https://tools.ietf.org/html/rfc3261)
**Complexity:** Very High
**Purpose:** VoIP signaling and multimedia session initiation

SIP enables **voice and video calling** - establish, modify, and terminate multimedia sessions for VoIP, video conferencing, and instant messaging from the browser.

### Use Cases
- VoIP phone systems
- Video conferencing
- Instant messaging
- Presence information
- WebRTC signaling
- SIP trunking

## Protocol Specification

### HTTP-Like Text Protocol

```
INVITE sip:user@domain SIP/2.0
Via: SIP/2.0/UDP client.local:5060;branch=z9hG4bK776asdhds
Max-Forwards: 70
To: <sip:user@domain>
From: <sip:caller@local>;tag=1928301774
Call-ID: a84b4c76e66710@pc33.local
CSeq: 314159 INVITE
Contact: <sip:caller@192.168.1.100:5060>
Content-Type: application/sdp
Content-Length: 142

[SDP body]
```

### SIP Methods

| Method | Description |
|--------|-------------|
| INVITE | Initiate session |
| ACK | Acknowledge response to INVITE |
| BYE | Terminate session |
| CANCEL | Cancel pending request |
| REGISTER | Register contact with server |
| OPTIONS | Query capabilities |
| INFO | Send mid-session information |
| UPDATE | Update session parameters |
| REFER | Transfer call |
| SUBSCRIBE | Subscribe to event notifications |
| NOTIFY | Notify of event |
| MESSAGE | Instant message |
| PUBLISH | Publish presence |

### Response Codes

| Code | Meaning |
|------|---------|
| 100 | Trying |
| 180 | Ringing |
| 181 | Call Being Forwarded |
| 182 | Queued |
| 183 | Session Progress |
| 200 | OK |
| 300 | Multiple Choices |
| 301 | Moved Permanently |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 486 | Busy Here |
| 487 | Request Terminated |
| 500 | Server Internal Error |
| 503 | Service Unavailable |
| 603 | Decline |

### Call Flow (Basic)

```
Caller                    Proxy                    Callee
  |                         |                         |
  |--- INVITE ------------->|                         |
  |<-- 100 Trying ----------|                         |
  |                         |--- INVITE ------------->|
  |                         |<-- 100 Trying ----------|
  |                         |<-- 180 Ringing ---------|
  |<-- 180 Ringing ---------|                         |
  |                         |<-- 200 OK --------------|
  |<-- 200 OK --------------|                         |
  |--- ACK ---------------->|                         |
  |                         |--- ACK ---------------->|
  |                                                   |
  |<================= RTP Media ====================>|
  |                                                   |
  |--- BYE ---------------->|                         |
  |                         |--- BYE ---------------->|
  |                         |<-- 200 OK --------------|
  |<-- 200 OK --------------|                         |
```

### SDP in SIP

SIP carries SDP (Session Description Protocol) for media negotiation:

```sdp
v=0
o=alice 2890844526 2890844526 IN IP4 client.local
s=Call
c=IN IP4 192.168.1.100
t=0 0
m=audio 49170 RTP/AVP 0 8 97
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:97 iLBC/8000
```

## Worker Implementation

```typescript
// src/worker/protocols/sip/client.ts

import { connect } from 'cloudflare:sockets';

export interface SIPConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  displayName?: string;
  transport?: 'UDP' | 'TCP' | 'TLS';
}

export interface SIPSession {
  callId: string;
  localTag: string;
  remoteTag?: string;
  cseq: number;
  state: 'idle' | 'calling' | 'ringing' | 'established' | 'terminating';
}

export class SIPClient {
  private socket: any;
  private sessions = new Map<string, SIPSession>();
  private branch = this.generateBranch();
  private localIP = '192.168.1.100'; // Would be detected

  constructor(private config: SIPConfig) {}

  async connect(): Promise<void> {
    const port = this.config.port || 5060;
    this.socket = connect(`${this.config.host}:${port}`);
    await this.socket.opened;

    // Start reading responses
    this.readLoop();
  }

  async register(): Promise<void> {
    const uri = `sip:${this.config.username}@${this.config.host}`;
    const contact = `<sip:${this.config.username}@${this.localIP}:5060>`;

    const request = this.buildRequest('REGISTER', uri, {
      'To': `<${uri}>`,
      'From': `<${uri}>;tag=${this.generateTag()}`,
      'Contact': contact,
      'Expires': '3600',
    });

    await this.sendRequest(request);
  }

  async invite(targetUri: string, sdp: string): Promise<string> {
    const callId = this.generateCallId();
    const localTag = this.generateTag();

    const session: SIPSession = {
      callId,
      localTag,
      cseq: 1,
      state: 'calling',
    };

    this.sessions.set(callId, session);

    const fromUri = `sip:${this.config.username}@${this.config.host}`;
    const contact = `<sip:${this.config.username}@${this.localIP}:5060>`;

    const request = this.buildRequest('INVITE', targetUri, {
      'To': `<${targetUri}>`,
      'From': `<${fromUri}>;tag=${localTag}`,
      'Call-ID': callId,
      'Contact': contact,
      'Content-Type': 'application/sdp',
    }, sdp);

    await this.sendRequest(request);

    return callId;
  }

  async ack(callId: string, remoteTag: string): Promise<void> {
    const session = this.sessions.get(callId);
    if (!session) throw new Error('Session not found');

    session.remoteTag = remoteTag;
    session.state = 'established';

    const targetUri = `sip:${this.config.username}@${this.config.host}`;
    const fromUri = `sip:${this.config.username}@${this.config.host}`;

    const request = this.buildRequest('ACK', targetUri, {
      'To': `<${targetUri}>;tag=${remoteTag}`,
      'From': `<${fromUri}>;tag=${session.localTag}`,
      'Call-ID': callId,
      'CSeq': `${session.cseq} ACK`,
    });

    await this.sendRequest(request);
  }

  async bye(callId: string): Promise<void> {
    const session = this.sessions.get(callId);
    if (!session) throw new Error('Session not found');

    session.state = 'terminating';
    session.cseq++;

    const targetUri = `sip:${this.config.username}@${this.config.host}`;
    const fromUri = `sip:${this.config.username}@${this.config.host}`;

    const request = this.buildRequest('BYE', targetUri, {
      'To': `<${targetUri}>;tag=${session.remoteTag}`,
      'From': `<${fromUri}>;tag=${session.localTag}`,
      'Call-ID': callId,
    });

    await this.sendRequest(request);
    this.sessions.delete(callId);
  }

  async message(targetUri: string, text: string): Promise<void> {
    const fromUri = `sip:${this.config.username}@${this.config.host}`;

    const request = this.buildRequest('MESSAGE', targetUri, {
      'To': `<${targetUri}>`,
      'From': `<${fromUri}>;tag=${this.generateTag()}`,
      'Call-ID': this.generateCallId(),
      'Content-Type': 'text/plain',
    }, text);

    await this.sendRequest(request);
  }

  async options(targetUri: string): Promise<void> {
    const fromUri = `sip:${this.config.username}@${this.config.host}`;

    const request = this.buildRequest('OPTIONS', targetUri, {
      'To': `<${targetUri}>`,
      'From': `<${fromUri}>;tag=${this.generateTag()}`,
      'Call-ID': this.generateCallId(),
      'Accept': 'application/sdp',
    });

    await this.sendRequest(request);
  }

  private buildRequest(
    method: string,
    uri: string,
    headers: Record<string, string>,
    body?: string
  ): string {
    let request = `${method} ${uri} SIP/2.0\r\n`;

    // Via header
    const transport = this.config.transport || 'TCP';
    request += `Via: SIP/2.0/${transport} ${this.localIP}:5060;branch=${this.branch}\r\n`;

    // Max-Forwards
    request += `Max-Forwards: 70\r\n`;

    // Standard headers
    for (const [key, value] of Object.entries(headers)) {
      if (key !== 'CSeq') {
        request += `${key}: ${value}\r\n`;
      }
    }

    // CSeq
    if (!headers['CSeq']) {
      const callId = headers['Call-ID'];
      const session = callId ? this.sessions.get(callId) : null;
      const cseq = session ? session.cseq : 1;
      request += `CSeq: ${cseq} ${method}\r\n`;
    } else {
      request += `CSeq: ${headers['CSeq']}\r\n`;
    }

    // User-Agent
    request += `User-Agent: PortOfCall/1.0\r\n`;

    // Body
    if (body) {
      request += `Content-Length: ${body.length}\r\n`;
      request += '\r\n';
      request += body;
    } else {
      request += `Content-Length: 0\r\n`;
      request += '\r\n';
    }

    return request;
  }

  private async sendRequest(request: string): Promise<void> {
    const writer = this.socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(request));
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

      // Process complete messages
      while (buffer.includes('\r\n\r\n')) {
        const idx = buffer.indexOf('\r\n\r\n');
        const headerSection = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 4);

        // Parse Content-Length
        const lengthMatch = headerSection.match(/Content-Length:\s*(\d+)/i);
        const contentLength = lengthMatch ? parseInt(lengthMatch[1]) : 0;

        // Read body if needed
        let body = '';
        if (contentLength > 0) {
          while (buffer.length < contentLength) {
            const { value } = await reader.read();
            buffer += decoder.decode(value, { stream: true });
          }
          body = buffer.substring(0, contentLength);
          buffer = buffer.substring(contentLength);
        }

        // Process message
        this.processMessage(headerSection, body);
      }
    }
  }

  private processMessage(headers: string, body: string): void {
    const lines = headers.split('\r\n');
    const statusLine = lines[0];

    if (statusLine.startsWith('SIP/')) {
      // Response
      const match = statusLine.match(/SIP\/2\.0 (\d+)/);
      if (match) {
        const statusCode = parseInt(match[1]);
        this.handleResponse(statusCode, headers, body);
      }
    } else {
      // Request
      const [method] = statusLine.split(' ');
      this.handleRequest(method, headers, body);
    }
  }

  private handleResponse(statusCode: number, headers: string, body: string): void {
    console.log(`SIP Response: ${statusCode}`);

    switch (statusCode) {
      case 100: // Trying
        break;
      case 180: // Ringing
        console.log('Call is ringing');
        break;
      case 200: // OK
        console.log('Call answered');
        break;
      case 401: // Unauthorized
        // Handle authentication
        break;
    }
  }

  private handleRequest(method: string, headers: string, body: string): void {
    console.log(`SIP Request: ${method}`);

    switch (method) {
      case 'INVITE':
        // Incoming call
        this.sendResponse(180, 'Ringing', headers);
        break;
      case 'BYE':
        // Call termination
        this.sendResponse(200, 'OK', headers);
        break;
      case 'MESSAGE':
        // Instant message
        this.sendResponse(200, 'OK', headers);
        break;
    }
  }

  private async sendResponse(statusCode: number, reason: string, requestHeaders: string): Promise<void> {
    // Extract headers from request
    const lines = requestHeaders.split('\r\n');
    const viaLine = lines.find(l => l.startsWith('Via:')) || '';
    const fromLine = lines.find(l => l.startsWith('From:')) || '';
    const toLine = lines.find(l => l.startsWith('To:')) || '';
    const callIdLine = lines.find(l => l.startsWith('Call-ID:')) || '';
    const cseqLine = lines.find(l => l.startsWith('CSeq:')) || '';

    let response = `SIP/2.0 ${statusCode} ${reason}\r\n`;
    response += `${viaLine}\r\n`;
    response += `${fromLine}\r\n`;
    response += `${toLine}\r\n`;
    response += `${callIdLine}\r\n`;
    response += `${cseqLine}\r\n`;
    response += `Content-Length: 0\r\n`;
    response += '\r\n';

    await this.sendRequest(response);
  }

  private generateCallId(): string {
    return `${Date.now()}@${this.localIP}`;
  }

  private generateTag(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private generateBranch(): string {
    return `z9hG4bK${Math.random().toString(36).substring(2, 15)}`;
  }

  async close(): Promise<void> {
    if (this.socket) {
      await this.socket.close();
    }
  }
}
```

## Web UI Design

```typescript
// src/components/SIPPhone.tsx

export function SIPPhone() {
  const [registered, setRegistered] = useState(false);
  const [calling, setCalling] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [targetUri, setTargetUri] = useState('sip:user@domain.com');

  const register = async () => {
    await fetch('/api/sip/register', {
      method: 'POST',
      body: JSON.stringify({
        host: 'sip.example.com',
        username: 'myuser',
        password: 'mypass',
      }),
    });

    setRegistered(true);
  };

  const call = async () => {
    setCalling(true);

    await fetch('/api/sip/invite', {
      method: 'POST',
      body: JSON.stringify({ targetUri }),
    });
  };

  const hangup = async () => {
    await fetch('/api/sip/bye', {
      method: 'POST',
    });

    setInCall(false);
    setCalling(false);
  };

  const sendMessage = async (text: string) => {
    await fetch('/api/sip/message', {
      method: 'POST',
      body: JSON.stringify({ targetUri, text }),
    });
  };

  return (
    <div className="sip-phone">
      <h2>SIP Softphone</h2>

      {!registered ? (
        <div className="registration">
          <button onClick={register}>Register</button>
        </div>
      ) : (
        <>
          <div className="status">
            {inCall && <span className="indicator">📞 In Call</span>}
            {calling && <span className="indicator">📲 Calling...</span>}
          </div>

          <div className="dial">
            <input
              type="text"
              placeholder="SIP URI (sip:user@domain)"
              value={targetUri}
              onChange={(e) => setTargetUri(e.target.value)}
            />
            {!inCall && !calling ? (
              <button onClick={call}>📞 Call</button>
            ) : (
              <button onClick={hangup} className="hangup">
                ❌ Hang Up
              </button>
            )}
          </div>

          <div className="messaging">
            <h3>Instant Message</h3>
            <input
              type="text"
              placeholder="Message"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  sendMessage(e.currentTarget.value);
                  e.currentTarget.value = '';
                }
              }}
            />
          </div>

          <div className="info">
            <h3>About SIP</h3>
            <ul>
              <li>Session Initiation Protocol for VoIP</li>
              <li>Used by IP phones, softphones, PBX systems</li>
              <li>Requires RTP for audio/video transport</li>
              <li>WebRTC uses SIP-like signaling</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
```

## Security

### Digest Authentication

```typescript
// SIP uses MD5 digest authentication
// Challenge: realm, nonce
// Response: MD5(MD5(user:realm:pass):nonce:MD5(method:uri))
```

### SIPS (SIP over TLS)

```
Port: 5061
URI: sips:user@domain
```

### SRTP (Secure RTP)

```
Encrypt media streams with SRTP
Key exchange via SDES or DTLS-SRTP
```

## Testing

### SIP Test Tools

```bash
# SIPp (SIP protocol tester)
sipp -sn uac -d 10000 -s 1000@domain sip.server.com

# linphone-console
linphonec
> register sip:user@domain password
> call sip:target@domain
```

### Asterisk PBX (Docker)

```bash
# Asterisk SIP server
docker run -d \
  -p 5060:5060/udp \
  -p 10000-10010:10000-10010/udp \
  --name asterisk \
  andrius/asterisk

# Configure SIP users in /etc/asterisk/sip.conf
```

### FreeSWITCH

```bash
# FreeSWITCH SIP server
docker run -d \
  -p 5060:5060/tcp -p 5060:5060/udp \
  -p 5080:5080/tcp -p 5080:5080/udp \
  --name freeswitch \
  drachtio/drachtio-freeswitch-mrf
```

## Resources

- **RFC 3261**: [SIP: Session Initiation Protocol](https://tools.ietf.org/html/rfc3261)
- **RFC 4566**: [SDP](https://tools.ietf.org/html/rfc4566)
- **RFC 3550**: [RTP](https://tools.ietf.org/html/rfc3550)
- **Asterisk**: [Open source PBX](https://www.asterisk.org/)

## Common Headers

| Header | Purpose |
|--------|---------|
| Via | Routing path |
| From | Originator |
| To | Recipient |
| Call-ID | Unique call identifier |
| CSeq | Command sequence |
| Contact | Direct contact URI |
| Max-Forwards | Loop prevention |
| User-Agent | Client identification |
| Allow | Supported methods |
| Supported | Supported extensions |

## Notes

- **Text-based** protocol similar to HTTP
- **Stateful** - maintains dialog state
- **Signaling only** - media uses RTP
- **Peer-to-peer** possible, but usually uses proxy
- **NAT traversal** requires STUN/TURN
- **WebRTC** uses similar concepts
- **Complex** - many RFCs and extensions
- **Port 5060** for non-secure, **5061** for TLS
- Requires **RTP/RTCP** for media transport
- **SDP** for media negotiation
