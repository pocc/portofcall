# RADIUS Protocol Implementation Plan

## Overview

**Protocol:** RADIUS (Remote Authentication Dial-In User Service)
**Port:** 1812 (authentication), 1813 (accounting), legacy 1645/1646
**RFC:** [RFC 2865](https://tools.ietf.org/html/rfc2865) (Authentication), [RFC 2866](https://tools.ietf.org/html/rfc2866) (Accounting)
**Complexity:** Medium
**Purpose:** AAA (Authentication, Authorization, Accounting)

RADIUS provides **centralized authentication** - validates user credentials, authorizes network access, and tracks resource usage for billing and auditing.

### Use Cases
- Network device authentication (routers, switches, firewalls)
- VPN authentication
- WiFi/802.1X authentication
- ISP user authentication
- Accounting and billing
- Centralized access control

## Protocol Specification

### UDP-Based Protocol

RADIUS uses **UDP** (not TCP):
- Port 1812: Authentication
- Port 1813: Accounting
- Legacy: 1645/1646

**Note:** For Cloudflare Workers TCP sockets, a UDP proxy would be needed.

### Packet Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Code      |  Identifier   |            Length             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                         Authenticator                         |
|                          (16 bytes)                           |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Attributes ...
+-+-+-+-+-+-+-+-+-+-+-+-+-
```

### Packet Codes

```
1  - Access-Request
2  - Access-Accept
3  - Access-Reject
4  - Accounting-Request
5  - Accounting-Response
11 - Access-Challenge
12 - Status-Server
13 - Status-Client
```

### Attribute Format

```
 0                   1                   2
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Type      |    Length     |  Value ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Common Attributes

```
1  - User-Name
2  - User-Password (encrypted)
3  - CHAP-Password
4  - NAS-IP-Address
5  - NAS-Port
6  - Service-Type
7  - Framed-Protocol
8  - Framed-IP-Address
18 - Reply-Message
25 - Class
79 - EAP-Message
80 - Message-Authenticator
```

## Worker Implementation

```typescript
// src/worker/protocols/radius/client.ts

import { connect } from 'cloudflare:sockets';
import { createHash, createHmac, randomBytes } from 'crypto';

export interface RADIUSConfig {
  host: string;
  port?: number;
  secret: string; // Shared secret
  timeout?: number;
}

// RADIUS Packet Codes
export enum PacketCode {
  AccessRequest = 1,
  AccessAccept = 2,
  AccessReject = 3,
  AccountingRequest = 4,
  AccountingResponse = 5,
  AccessChallenge = 11,
  StatusServer = 12,
  StatusClient = 13,
}

// RADIUS Attribute Types
export enum AttributeType {
  UserName = 1,
  UserPassword = 2,
  CHAPPassword = 3,
  NASIPAddress = 4,
  NASPort = 5,
  ServiceType = 6,
  FramedProtocol = 7,
  FramedIPAddress = 8,
  ReplyMessage = 18,
  State = 24,
  Class = 25,
  VendorSpecific = 26,
  SessionTimeout = 27,
  IdleTimeout = 28,
  CallingStationId = 31,
  CalledStationId = 30,
  NASIdentifier = 32,
  AcctStatusType = 40,
  AcctSessionId = 44,
  EAPMessage = 79,
  MessageAuthenticator = 80,
}

export interface RADIUSAttribute {
  type: number;
  value: Uint8Array;
}

export interface RADIUSPacket {
  code: PacketCode;
  identifier: number;
  authenticator: Uint8Array;
  attributes: RADIUSAttribute[];
}

export class RADIUSClient {
  private socket: any;
  private identifier: number = 0;

  constructor(private config: RADIUSConfig) {
    if (!config.port) {
      config.port = 1812;
    }
    if (!config.timeout) {
      config.timeout = 5000;
    }
  }

  // Note: RADIUS uses UDP, not TCP
  // This implementation assumes a UDP-to-TCP proxy or RADIUS-over-TCP extension

  async authenticate(username: string, password: string): Promise<{
    success: boolean;
    message?: string;
    attributes?: RADIUSAttribute[];
  }> {
    // Generate request authenticator
    const requestAuth = randomBytes(16);

    // Build Access-Request packet
    const attributes: RADIUSAttribute[] = [
      this.buildAttribute(AttributeType.UserName, username),
      this.buildPasswordAttribute(password, requestAuth),
      this.buildAttribute(AttributeType.NASIPAddress, '127.0.0.1'),
    ];

    const request: RADIUSPacket = {
      code: PacketCode.AccessRequest,
      identifier: this.nextIdentifier(),
      authenticator: requestAuth,
      attributes,
    };

    // Send request
    const response = await this.sendRequest(request);

    // Parse response
    if (response.code === PacketCode.AccessAccept) {
      const replyMessage = this.getAttribute(response, AttributeType.ReplyMessage);
      return {
        success: true,
        message: replyMessage ? new TextDecoder().decode(replyMessage.value) : undefined,
        attributes: response.attributes,
      };
    } else if (response.code === PacketCode.AccessReject) {
      const replyMessage = this.getAttribute(response, AttributeType.ReplyMessage);
      return {
        success: false,
        message: replyMessage ? new TextDecoder().decode(replyMessage.value) : 'Access denied',
      };
    } else if (response.code === PacketCode.AccessChallenge) {
      return {
        success: false,
        message: 'Multi-factor authentication required',
        attributes: response.attributes,
      };
    }

    return { success: false, message: 'Unknown response' };
  }

  async accounting(
    username: string,
    sessionId: string,
    statusType: 'Start' | 'Stop' | 'Interim-Update'
  ): Promise<boolean> {
    const requestAuth = randomBytes(16);

    const statusTypeValue = statusType === 'Start' ? 1 : statusType === 'Stop' ? 2 : 3;

    const attributes: RADIUSAttribute[] = [
      this.buildAttribute(AttributeType.UserName, username),
      this.buildAttribute(AttributeType.AcctStatusType, statusTypeValue),
      this.buildAttribute(AttributeType.AcctSessionId, sessionId),
      this.buildAttribute(AttributeType.NASIPAddress, '127.0.0.1'),
    ];

    const request: RADIUSPacket = {
      code: PacketCode.AccountingRequest,
      identifier: this.nextIdentifier(),
      authenticator: requestAuth,
      attributes,
    };

    const response = await this.sendRequest(request);

    return response.code === PacketCode.AccountingResponse;
  }

  private async sendRequest(packet: RADIUSPacket): Promise<RADIUSPacket> {
    const encoded = this.encodePacket(packet);

    // For demonstration - actual implementation needs UDP proxy
    // Or RADIUS-over-TCP (non-standard)

    const socket = connect(`${this.config.host}:${this.config.port}`);
    await socket.opened;

    const writer = socket.writable.getWriter();
    await writer.write(encoded);
    writer.releaseLock();

    const reader = socket.readable.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    await socket.close();

    if (!value) {
      throw new Error('No response from RADIUS server');
    }

    return this.decodePacket(value, packet.authenticator);
  }

  private encodePacket(packet: RADIUSPacket): Uint8Array {
    // Calculate total length
    let attributesLength = 0;
    for (const attr of packet.attributes) {
      attributesLength += 2 + attr.value.length; // Type + Length + Value
    }

    const totalLength = 20 + attributesLength; // Header (20 bytes) + Attributes

    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    let offset = 0;

    // Code
    view.setUint8(offset++, packet.code);

    // Identifier
    view.setUint8(offset++, packet.identifier);

    // Length
    view.setUint16(offset, totalLength, false);
    offset += 2;

    // Authenticator
    new Uint8Array(buffer).set(packet.authenticator, offset);
    offset += 16;

    // Attributes
    for (const attr of packet.attributes) {
      view.setUint8(offset++, attr.type);
      view.setUint8(offset++, 2 + attr.value.length);
      new Uint8Array(buffer).set(attr.value, offset);
      offset += attr.value.length;
    }

    return new Uint8Array(buffer);
  }

  private decodePacket(data: Uint8Array, requestAuth: Uint8Array): RADIUSPacket {
    const view = new DataView(data.buffer);
    let offset = 0;

    // Code
    const code = view.getUint8(offset++) as PacketCode;

    // Identifier
    const identifier = view.getUint8(offset++);

    // Length
    const length = view.getUint16(offset, false);
    offset += 2;

    // Authenticator
    const authenticator = data.slice(offset, offset + 16);
    offset += 16;

    // Verify response authenticator
    if (!this.verifyResponseAuthenticator(data, requestAuth)) {
      throw new Error('Invalid response authenticator');
    }

    // Attributes
    const attributes: RADIUSAttribute[] = [];

    while (offset < length) {
      const type = view.getUint8(offset++);
      const attrLength = view.getUint8(offset++);
      const value = data.slice(offset, offset + attrLength - 2);
      offset += attrLength - 2;

      attributes.push({ type, value });
    }

    return { code, identifier, authenticator, attributes };
  }

  private buildAttribute(type: AttributeType, value: string | number): RADIUSAttribute {
    let valueBytes: Uint8Array;

    if (typeof value === 'string') {
      valueBytes = new TextEncoder().encode(value);
    } else if (typeof value === 'number') {
      const buffer = new ArrayBuffer(4);
      new DataView(buffer).setUint32(0, value, false);
      valueBytes = new Uint8Array(buffer);
    } else {
      throw new Error('Invalid attribute value type');
    }

    return { type, value: valueBytes };
  }

  private buildPasswordAttribute(password: string, requestAuth: Uint8Array): RADIUSAttribute {
    // Encrypt password using shared secret and request authenticator
    const encrypted = this.encryptPassword(password, requestAuth);
    return { type: AttributeType.UserPassword, value: encrypted };
  }

  private encryptPassword(password: string, requestAuth: Uint8Array): Uint8Array {
    // RADIUS password encryption:
    // 1. Pad password to multiple of 16 bytes
    // 2. XOR with MD5(secret + requestAuth)

    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);

    // Pad to multiple of 16
    const paddedLength = Math.ceil(passwordBytes.length / 16) * 16;
    const padded = new Uint8Array(paddedLength);
    padded.set(passwordBytes);

    const result = new Uint8Array(paddedLength);
    const secret = encoder.encode(this.config.secret);

    for (let i = 0; i < paddedLength; i += 16) {
      // Calculate MD5(secret + previous_output)
      const hashInput = new Uint8Array(secret.length + 16);
      hashInput.set(secret);

      if (i === 0) {
        hashInput.set(requestAuth, secret.length);
      } else {
        hashInput.set(result.slice(i - 16, i), secret.length);
      }

      const hash = this.md5(hashInput);

      // XOR with password block
      for (let j = 0; j < 16; j++) {
        result[i + j] = padded[i + j] ^ hash[j];
      }
    }

    return result;
  }

  private verifyResponseAuthenticator(responsePacket: Uint8Array, requestAuth: Uint8Array): boolean {
    // Response authenticator = MD5(Code+ID+Length+RequestAuth+Attributes+Secret)

    const buffer = new Uint8Array(responsePacket.length + this.config.secret.length);
    buffer.set(responsePacket);

    // Replace response authenticator with request authenticator
    buffer.set(requestAuth, 4);

    // Append secret
    buffer.set(new TextEncoder().encode(this.config.secret), responsePacket.length);

    const hash = this.md5(buffer);
    const responseAuth = responsePacket.slice(4, 20);

    // Compare
    for (let i = 0; i < 16; i++) {
      if (hash[i] !== responseAuth[i]) {
        return false;
      }
    }

    return true;
  }

  private md5(data: Uint8Array): Uint8Array {
    // Use Web Crypto API or crypto library
    const hash = createHash('md5');
    hash.update(data);
    return new Uint8Array(hash.digest());
  }

  private getAttribute(packet: RADIUSPacket, type: AttributeType): RADIUSAttribute | undefined {
    return packet.attributes.find(attr => attr.type === type);
  }

  private nextIdentifier(): number {
    this.identifier = (this.identifier + 1) % 256;
    return this.identifier;
  }
}

// EAP (Extensible Authentication Protocol) Support

export class RADIUSEAP extends RADIUSClient {
  async authenticateEAP(username: string, eapMessage: Uint8Array): Promise<any> {
    // EAP authentication flow
    // Used for 802.1X, WPA Enterprise, etc.
  }
}
```

## Web UI Design

```typescript
// src/components/RADIUSClient.tsx

export function RADIUSClient() {
  const [host, setHost] = useState('');
  const [secret, setSecret] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<any>(null);

  const authenticate = async () => {
    try {
      const response = await fetch('/api/radius/authenticate', {
        method: 'POST',
        body: JSON.stringify({
          host,
          secret,
          username,
          password,
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  const testAccounting = async () => {
    try {
      const sessionId = `session-${Date.now()}`;

      // Start
      await fetch('/api/radius/accounting', {
        method: 'POST',
        body: JSON.stringify({
          host,
          secret,
          username,
          sessionId,
          statusType: 'Start',
        }),
      });

      alert('Accounting Start sent');

      // Stop after 5 seconds
      setTimeout(async () => {
        await fetch('/api/radius/accounting', {
          method: 'POST',
          body: JSON.stringify({
            host,
            secret,
            username,
            sessionId,
            statusType: 'Stop',
          }),
        });

        alert('Accounting Stop sent');
      }, 5000);
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  return (
    <div className="radius-client">
      <h2>RADIUS Client</h2>

      <div className="config">
        <input
          type="text"
          placeholder="RADIUS Server Host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          type="password"
          placeholder="Shared Secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button onClick={authenticate}>Authenticate</button>
        <button onClick={testAccounting}>Test Accounting</button>
      </div>

      {result && (
        <div className={`result ${result.success ? 'success' : 'failure'}`}>
          <h3>{result.success ? 'Access Accepted' : 'Access Rejected'}</h3>
          {result.message && <p>{result.message}</p>}

          {result.attributes && result.attributes.length > 0 && (
            <div className="attributes">
              <h4>Attributes:</h4>
              <ul>
                {result.attributes.map((attr: any, i: number) => (
                  <li key={i}>
                    Type {attr.type}: {new TextDecoder().decode(attr.value)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="info">
        <h3>About RADIUS</h3>
        <ul>
          <li>RFC 2865 - Authentication</li>
          <li>RFC 2866 - Accounting</li>
          <li>UDP-based (ports 1812/1813)</li>
          <li>Shared secret for security</li>
          <li>MD5 password encryption</li>
          <li>Widely used for AAA</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### Shared Secret

```typescript
const client = new RADIUSClient({
  host: 'radius.example.com',
  port: 1812,
  secret: 'strong-shared-secret-here',
});
```

### Password Encryption

RADIUS encrypts passwords using MD5(secret + authenticator), but **MD5 is weak**. Use RadSec (RADIUS over TLS) for better security.

### RadSec (RADIUS over TLS)

```typescript
// RFC 6614 - RADIUS over TLS
// Port 2083 (TCP with TLS)
```

## Testing

```bash
# Install radtest (part of freeradius-utils)
apt-get install freeradius-utils

# Test authentication
radtest username password radius-server.com 1812 shared-secret

# Test with specific NAS
radtest username password radius-server.com:1812 10 shared-secret

# Output:
# Sent Access-Request Id 123 from 0.0.0.0:12345 to 192.168.1.1:1812 length 73
# Received Access-Accept Id 123 from 192.168.1.1:1812 to 0.0.0.0:12345 length 20
```

## Resources

- **RFC 2865**: [RADIUS Authentication](https://tools.ietf.org/html/rfc2865)
- **RFC 2866**: [RADIUS Accounting](https://tools.ietf.org/html/rfc2866)
- **RFC 6614**: [RadSec (RADIUS over TLS)](https://tools.ietf.org/html/rfc6614)
- **FreeRADIUS**: [Open source server](https://freeradius.org/)

## Notes

- **UDP-based** - requires proxy for Workers TCP sockets
- **Port 1812/1813** - modern standard (legacy: 1645/1646)
- **Shared secret** - symmetric key authentication
- **MD5 encryption** - considered weak, use RadSec for production
- **Stateless** - each request/response is independent
- **EAP support** - Extensible Authentication Protocol for 802.1X
- **Vendor-Specific Attributes** - custom attributes per vendor
- **Widely deployed** - ISPs, enterprises, WiFi networks
- **Accounting** - track session time, bandwidth, billing
- **Replacement**: DIAMETER (RFC 6733) for more modern systems
