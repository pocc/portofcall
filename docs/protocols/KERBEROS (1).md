# Kerberos Protocol Implementation Plan

## Overview

**Protocol:** Kerberos
**Port:** 88 (TCP/UDP)
**RFC:** [RFC 4120](https://tools.ietf.org/html/rfc4120)
**Complexity:** Very High
**Purpose:** Network authentication protocol

Kerberos provides **secure authentication** - ticket-based authentication system using symmetric key cryptography, with single sign-on (SSO) and mutual authentication between client and server.

### Use Cases
- Active Directory authentication
- Single Sign-On (SSO)
- Network service authentication
- Cross-realm authentication
- Mutual authentication
- Enterprise identity management

## Protocol Specification

### Kerberos Components

```
KDC - Key Distribution Center
  AS - Authentication Server
  TGS - Ticket Granting Server
Client - User/service requesting authentication
Service - Resource being accessed
```

### Authentication Flow

```
1. AS Request (AS-REQ): Client → KDC
2. AS Reply (AS-REP): KDC → Client (TGT)
3. TGS Request (TGS-REQ): Client → KDC (with TGT)
4. TGS Reply (TGS-REP): KDC → Client (Service Ticket)
5. AP Request (AP-REQ): Client → Service (with ticket)
6. AP Reply (AP-REP): Service → Client (mutual auth)
```

### Message Format (ASN.1 DER Encoded)

```
KDC-REQ ::= SEQUENCE {
  pvno [1] INTEGER (5),
  msg-type [2] INTEGER,
  padata [3] SEQUENCE OF PA-DATA OPTIONAL,
  req-body [4] KDC-REQ-BODY
}

KDC-REQ-BODY ::= SEQUENCE {
  kdc-options [0] KDCOptions,
  cname [1] PrincipalName OPTIONAL,
  realm [2] Realm,
  sname [3] PrincipalName OPTIONAL,
  from [4] KerberosTime OPTIONAL,
  till [5] KerberosTime,
  rtime [6] KerberosTime OPTIONAL,
  nonce [7] UInt32,
  etype [8] SEQUENCE OF Int32,
  addresses [9] HostAddresses OPTIONAL
}
```

### Ticket Structure

```
Ticket ::= [APPLICATION 1] SEQUENCE {
  tkt-vno [0] INTEGER (5),
  realm [1] Realm,
  sname [2] PrincipalName,
  enc-part [3] EncryptedData
}

EncryptedData ::= SEQUENCE {
  etype [0] Int32,
  kvno [1] UInt32 OPTIONAL,
  cipher [2] OCTET STRING
}
```

### Encryption Types

```
des-cbc-crc          = 1
des-cbc-md4          = 2
des-cbc-md5          = 3
des3-cbc-sha1        = 16
aes128-cts-hmac-sha1-96 = 17
aes256-cts-hmac-sha1-96 = 18
rc4-hmac             = 23
```

## Worker Implementation

```typescript
// src/worker/protocols/kerberos/client.ts

import { connect } from 'cloudflare:sockets';
import { createHash, pbkdf2Sync } from 'crypto';

export interface KerberosConfig {
  host: string;
  port?: number;
  realm: string;
  username: string;
  password: string;
  service?: string;
}

// Message Types
export enum KerberosMessageType {
  AS_REQ = 10,
  AS_REP = 11,
  TGS_REQ = 12,
  TGS_REP = 13,
  AP_REQ = 14,
  AP_REP = 15,
  ERROR = 30,
}

// Encryption Types
export enum EncryptionType {
  DES_CBC_CRC = 1,
  DES_CBC_MD5 = 3,
  DES3_CBC_SHA1 = 16,
  AES128_CTS_HMAC_SHA1_96 = 17,
  AES256_CTS_HMAC_SHA1_96 = 18,
  RC4_HMAC = 23,
}

export interface KerberosTicket {
  realm: string;
  sname: string;
  encPart: Uint8Array;
  sessionKey?: Uint8Array;
}

export class KerberosClient {
  private socket: any;
  private tgt?: KerberosTicket;
  private sessionKey?: Uint8Array;

  constructor(private config: KerberosConfig) {
    if (!config.port) config.port = 88;
  }

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;
  }

  async authenticate(): Promise<boolean> {
    // Step 1: Get TGT from AS
    await this.getTicketGrantingTicket();

    // Step 2: Get Service Ticket from TGS (optional)
    if (this.config.service) {
      await this.getServiceTicket(this.config.service);
    }

    return true;
  }

  private async getTicketGrantingTicket(): Promise<void> {
    // Build AS-REQ
    const asReq = this.buildASRequest();

    // Send AS-REQ
    await this.send(asReq);

    // Receive AS-REP
    const asRep = await this.receive();

    // Parse and decrypt AS-REP
    this.parseASReply(asRep);
  }

  private buildASRequest(): Uint8Array {
    // Simplified ASN.1 DER encoding
    const chunks: Uint8Array[] = [];

    // Message type (AS-REQ = 10)
    chunks.push(this.encodeInteger(KerberosMessageType.AS_REQ));

    // Protocol version (5)
    chunks.push(this.encodeInteger(5));

    // Client name
    chunks.push(this.encodePrincipalName(this.config.username));

    // Realm
    chunks.push(this.encodeString(this.config.realm));

    // Service name (krbtgt)
    chunks.push(this.encodePrincipalName(`krbtgt/${this.config.realm}`));

    // Till (validity period)
    const till = new Date(Date.now() + 10 * 60 * 60 * 1000); // 10 hours
    chunks.push(this.encodeTime(till));

    // Nonce
    const nonce = Math.floor(Math.random() * 0xFFFFFFFF);
    chunks.push(this.encodeInteger(nonce));

    // Encryption types
    chunks.push(this.encodeSequence([
      this.encodeInteger(EncryptionType.AES256_CTS_HMAC_SHA1_96),
      this.encodeInteger(EncryptionType.AES128_CTS_HMAC_SHA1_96),
      this.encodeInteger(EncryptionType.RC4_HMAC),
    ]));

    return this.combineChunks(chunks);
  }

  private parseASReply(data: Uint8Array): void {
    // Simplified ASN.1 DER parsing
    let offset = 0;

    // Skip header
    offset = this.skipASN1Header(data, offset);

    // Message type
    const msgType = this.decodeInteger(data, offset);
    offset += 4;

    if (msgType === KerberosMessageType.ERROR) {
      throw new Error('Kerberos authentication error');
    }

    // Parse ticket
    const ticket = this.parseTicket(data, offset);
    this.tgt = ticket;

    // Decrypt enc-part with user's key
    const userKey = this.deriveKey(this.config.password, this.config.realm, this.config.username);
    this.sessionKey = this.decryptEncPart(ticket.encPart, userKey);
  }

  private async getServiceTicket(service: string): Promise<KerberosTicket> {
    if (!this.tgt || !this.sessionKey) {
      throw new Error('No TGT available');
    }

    // Build TGS-REQ
    const tgsReq = this.buildTGSRequest(service);

    // Send TGS-REQ
    await this.send(tgsReq);

    // Receive TGS-REP
    const tgsRep = await this.receive();

    // Parse TGS-REP
    return this.parseTGSReply(tgsRep);
  }

  private buildTGSRequest(service: string): Uint8Array {
    const chunks: Uint8Array[] = [];

    // Message type (TGS-REQ = 12)
    chunks.push(this.encodeInteger(KerberosMessageType.TGS_REQ));

    // Protocol version
    chunks.push(this.encodeInteger(5));

    // TGT (from AS-REP)
    chunks.push(this.encodeTicket(this.tgt!));

    // Service name
    chunks.push(this.encodePrincipalName(service));

    // Realm
    chunks.push(this.encodeString(this.config.realm));

    // Authenticator (encrypted with session key)
    const authenticator = this.buildAuthenticator();
    chunks.push(this.encrypt(authenticator, this.sessionKey!));

    return this.combineChunks(chunks);
  }

  private parseTGSReply(data: Uint8Array): KerberosTicket {
    // Parse similar to AS-REP
    return this.parseTicket(data, 0);
  }

  private buildAuthenticator(): Uint8Array {
    const chunks: Uint8Array[] = [];

    // Authenticator version
    chunks.push(this.encodeInteger(5));

    // Client realm
    chunks.push(this.encodeString(this.config.realm));

    // Client name
    chunks.push(this.encodePrincipalName(this.config.username));

    // Timestamp
    chunks.push(this.encodeTime(new Date()));

    // Microseconds
    chunks.push(this.encodeInteger(Date.now() % 1000000));

    return this.combineChunks(chunks);
  }

  async getServiceTicketForAP(service: string): Promise<Uint8Array> {
    const ticket = await this.getServiceTicket(service);

    // Build AP-REQ
    const chunks: Uint8Array[] = [];

    // Message type (AP-REQ = 14)
    chunks.push(this.encodeInteger(KerberosMessageType.AP_REQ));

    // Protocol version
    chunks.push(this.encodeInteger(5));

    // Ticket
    chunks.push(this.encodeTicket(ticket));

    // Authenticator
    const authenticator = this.buildAuthenticator();
    chunks.push(this.encrypt(authenticator, this.sessionKey!));

    return this.combineChunks(chunks);
  }

  private deriveKey(password: string, realm: string, principal: string): Uint8Array {
    // Kerberos string-to-key (simplified - uses PBKDF2)
    const salt = realm.toUpperCase() + principal;
    const iterations = 4096;

    return pbkdf2Sync(password, salt, iterations, 32, 'sha1');
  }

  private encrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
    // Simplified - would use AES-CTS or RC4-HMAC
    // For demonstration, using XOR (NOT SECURE)
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      result[i] = data[i] ^ key[i % key.length];
    }
    return result;
  }

  private decryptEncPart(encPart: Uint8Array, key: Uint8Array): Uint8Array {
    return this.encrypt(encPart, key); // XOR is symmetric
  }

  private parseTicket(data: Uint8Array, offset: number): KerberosTicket {
    // Simplified ticket parsing
    return {
      realm: this.config.realm,
      sname: 'krbtgt',
      encPart: new Uint8Array(0),
    };
  }

  private encodeTicket(ticket: KerberosTicket): Uint8Array {
    const chunks: Uint8Array[] = [];

    chunks.push(this.encodeInteger(5)); // Version
    chunks.push(this.encodeString(ticket.realm));
    chunks.push(this.encodePrincipalName(ticket.sname));
    chunks.push(ticket.encPart);

    return this.combineChunks(chunks);
  }

  // ASN.1 DER Encoding Helpers

  private encodeInteger(value: number): Uint8Array {
    const bytes: number[] = [];
    let v = value;

    if (v === 0) {
      bytes.push(0);
    } else {
      while (v > 0) {
        bytes.unshift(v & 0xFF);
        v >>= 8;
      }
    }

    return new Uint8Array([0x02, bytes.length, ...bytes]);
  }

  private decodeInteger(data: Uint8Array, offset: number): number {
    if (data[offset] !== 0x02) throw new Error('Not an integer');

    const length = data[offset + 1];
    let value = 0;

    for (let i = 0; i < length; i++) {
      value = (value << 8) | data[offset + 2 + i];
    }

    return value;
  }

  private encodeString(str: string): Uint8Array {
    const bytes = new TextEncoder().encode(str);
    return new Uint8Array([0x1B, bytes.length, ...bytes]); // GeneralString
  }

  private encodePrincipalName(principal: string): Uint8Array {
    // Simplified - would encode as SEQUENCE
    return this.encodeString(principal);
  }

  private encodeTime(date: Date): Uint8Array {
    // KerberosTime: YYYYMMDDHHmmssZ
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    const second = String(date.getUTCSeconds()).padStart(2, '0');

    const timeStr = `${year}${month}${day}${hour}${minute}${second}Z`;
    return this.encodeString(timeStr);
  }

  private encodeSequence(items: Uint8Array[]): Uint8Array {
    const combined = this.combineChunks(items);
    return new Uint8Array([0x30, combined.length, ...combined]);
  }

  private skipASN1Header(data: Uint8Array, offset: number): number {
    // Skip tag and length
    offset++; // Tag
    const length = data[offset++];

    if (length & 0x80) {
      const numBytes = length & 0x7F;
      offset += numBytes;
    }

    return offset;
  }

  private combineChunks(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  private async send(data: Uint8Array): Promise<void> {
    // Prepend length (4 bytes, big-endian)
    const buffer = new ArrayBuffer(4 + data.length);
    const view = new DataView(buffer);
    view.setUint32(0, data.length, false);
    new Uint8Array(buffer).set(data, 4);

    const writer = this.socket.writable.getWriter();
    await writer.write(new Uint8Array(buffer));
    writer.releaseLock();
  }

  private async receive(): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();

    // Read length
    const lengthBuf = new Uint8Array(4);
    let offset = 0;

    while (offset < 4) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = 4 - offset;
      const toCopy = Math.min(remaining, value.length);
      lengthBuf.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    const length = new DataView(lengthBuf.buffer).getUint32(0, false);

    // Read message
    const messageBuf = new Uint8Array(length);
    offset = 0;

    while (offset < length) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = length - offset;
      const toCopy = Math.min(remaining, value.length);
      messageBuf.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    reader.releaseLock();
    return messageBuf;
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/KerberosClient.tsx

export function KerberosClient() {
  const [host, setHost] = useState('');
  const [realm, setRealm] = useState('EXAMPLE.COM');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [service, setService] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [ticket, setTicket] = useState<any>(null);

  const authenticate = async () => {
    try {
      const response = await fetch('/api/kerberos/auth', {
        method: 'POST',
        body: JSON.stringify({
          host,
          realm,
          username,
          password,
          service,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setAuthenticated(true);
        setTicket(data.ticket);
      }
    } catch (error) {
      alert(`Authentication failed: ${error.message}`);
    }
  };

  return (
    <div className="kerberos-client">
      <h2>Kerberos Authentication</h2>

      <div className="config">
        <input
          placeholder="KDC Host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          placeholder="Realm (e.g., EXAMPLE.COM)"
          value={realm}
          onChange={(e) => setRealm(e.target.value.toUpperCase())}
        />
        <input
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
        <input
          placeholder="Service (optional)"
          value={service}
          onChange={(e) => setService(e.target.value)}
        />
        <button onClick={authenticate}>Authenticate</button>
      </div>

      {authenticated && (
        <div className="success">
          <h3>✓ Authentication Successful</h3>
          <p>Ticket Granting Ticket obtained</p>
          {ticket && (
            <div className="ticket-info">
              <pre>{JSON.stringify(ticket, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      <div className="info">
        <h3>About Kerberos</h3>
        <ul>
          <li>Network authentication protocol (RFC 4120)</li>
          <li>Symmetric key cryptography</li>
          <li>Ticket-based authentication</li>
          <li>Single Sign-On (SSO)</li>
          <li>Mutual authentication</li>
          <li>Used by Active Directory</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### Encryption

```typescript
// Kerberos uses strong encryption:
// - AES256-CTS-HMAC-SHA1-96
// - AES128-CTS-HMAC-SHA1-96
// - DES3-CBC-SHA1 (legacy)
```

### Pre-authentication

```bash
# Prevent password guessing
# Client must prove knowledge of password
```

## Testing

```bash
# Install MIT Kerberos
apt-get install krb5-kdc krb5-admin-server

# Initialize realm
krb5_newrealm

# Create principal
kadmin.local -q "addprinc username@EXAMPLE.COM"

# Get TGT
kinit username@EXAMPLE.COM

# List tickets
klist

# Destroy tickets
kdestroy
```

## Resources

- **RFC 4120**: [Kerberos Protocol](https://tools.ietf.org/html/rfc4120)
- **MIT Kerberos**: [Documentation](https://web.mit.edu/kerberos/)
- **Active Directory**: [Microsoft docs](https://docs.microsoft.com/en-us/windows-server/security/kerberos/)

## Notes

- **Very complex** - Full implementation requires ASN.1 DER encoding
- **Symmetric crypto** - Shared secrets between KDC and principals
- **Ticket-based** - TGT, service tickets
- **Port 88** - Both TCP and UDP
- **Time-sensitive** - Requires synchronized clocks (within 5 minutes)
- **Realms** - Administrative domains (e.g., EXAMPLE.COM)
- **Cross-realm** - Trust between realms
- **Active Directory** - Windows implementation of Kerberos
- **GSSAPI** - Generic Security Services API (uses Kerberos)
- **SPNEGO** - Negotiate authentication (HTTP with Kerberos)
