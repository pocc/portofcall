# Diameter Protocol Implementation Plan

## Overview

**Protocol:** Diameter
**Port:** 3868 (TCP/SCTP)
**RFC:** [RFC 6733](https://tools.ietf.org/html/rfc6733)
**Complexity:** High
**Purpose:** AAA protocol (successor to RADIUS)

Diameter provides **modern AAA** - Authentication, Authorization, and Accounting for network access, mobile networks (LTE/5G), and service delivery, with improved reliability, security, and extensibility over RADIUS.

### Use Cases
- Mobile network authentication (4G LTE, 5G)
- IMS (IP Multimedia Subsystem)
- Network access control
- Service charging and billing
- Policy control
- VoLTE/VoWiFi authentication

## Protocol Specification

### Diameter Header

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    Version    |                 Message Length                |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Command Flags |                  Command Code                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Application-ID                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      Hop-by-Hop Identifier                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      End-to-End Identifier                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  AVPs ...
+-+-+-+-+-+-+-+-+-+-+-+-+-
```

### Command Flags

```
R - Request bit (0 = answer, 1 = request)
P - Proxiable bit
E - Error bit
T - Potentially retransmitted
```

### AVP Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                           AVP Code                            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|V M P r r r r r|                  AVP Length                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Vendor-ID (opt)                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    Data ...
+-+-+-+-+-+-+-+-+-
```

### Common Command Codes

```
257 - Capabilities-Exchange (CER/CEA)
258 - Re-Auth (RAR/RAA)
271 - Accounting (ACR/ACA)
272 - Credit-Control (CCR/CCA)
274 - Abort-Session (ASR/ASA)
275 - Session-Termination (STR/STA)
280 - Device-Watchdog (DWR/DWA)
282 - Disconnect-Peer (DPR/DPA)
300 - User-Authorization (UAR/UAA)
301 - Server-Assignment (SAR/SAA)
303 - Multimedia-Auth (MAR/MAA)
306 - Push-Profile (PPR/PPA)
```

### Common AVPs

```
1   - User-Name
25  - Class
27  - Session-Timeout
33  - Proxy-State
44  - Accounting-Session-Id
50  - Acct-Multi-Session-Id
85  - Acct-Interim-Interval
257 - Host-IP-Address
258 - Auth-Application-Id
259 - Acct-Application-Id
263 - Session-Id
264 - Origin-Host
265 - Supported-Vendor-Id
266 - Vendor-Id
267 - Firmware-Revision
268 - Result-Code
269 - Product-Name
296 - Origin-State-Id
```

## Worker Implementation

```typescript
// src/worker/protocols/diameter/client.ts

import { connect } from 'cloudflare:sockets';

export interface DiameterConfig {
  host: string;
  port?: number;
  originHost: string;
  originRealm: string;
  vendorId?: number;
  productName?: string;
}

// Command Codes
export enum DiameterCommand {
  CapabilitiesExchange = 257,
  ReAuth = 258,
  Accounting = 271,
  CreditControl = 272,
  AbortSession = 274,
  SessionTermination = 275,
  DeviceWatchdog = 280,
  DisconnectPeer = 282,
}

// Application IDs
export enum DiameterApplication {
  Common = 0,
  NASREQ = 1,
  MobileIPv4 = 2,
  BaseAccounting = 3,
  CreditControl = 4,
  EAP = 5,
  SIP = 6,
  MobileIPv6 = 7,
  3GPP_Cx = 16777216,
  3GPP_Sh = 16777217,
  3GPP_Rx = 16777236,
  3GPP_Gx = 16777238,
}

// AVP Codes
export enum AVPCode {
  UserName = 1,
  SessionId = 263,
  OriginHost = 264,
  OriginRealm = 265,
  DestinationHost = 293,
  DestinationRealm = 283,
  ResultCode = 268,
  AuthApplicationId = 258,
  AcctApplicationId = 259,
  VendorId = 266,
  ProductName = 269,
  SupportedVendorId = 265,
}

export interface DiameterAVP {
  code: number;
  vendorId?: number;
  mandatory: boolean;
  value: Uint8Array | number | string | DiameterAVP[];
}

export interface DiameterMessage {
  version: number;
  commandCode: number;
  flags: number;
  applicationId: number;
  hopByHopId: number;
  endToEndId: number;
  avps: DiameterAVP[];
}

export class DiameterClient {
  private socket: any;
  private hopByHopId: number = 1;
  private endToEndId: number = 1;
  private sessionId: string;

  constructor(private config: DiameterConfig) {
    if (!config.port) config.port = 3868;
    if (!config.vendorId) config.vendorId = 0;
    if (!config.productName) config.productName = 'PortOfCall';

    this.sessionId = `${config.originHost};${Date.now()};${Math.random()}`;
  }

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Send CER (Capabilities-Exchange-Request)
    await this.sendCapabilitiesExchange();

    // Receive CEA (Capabilities-Exchange-Answer)
    const cea = await this.receiveMessage();

    if (this.getResultCode(cea) !== 2001) {
      throw new Error('Capabilities exchange failed');
    }
  }

  private async sendCapabilitiesExchange(): Promise<void> {
    const avps: DiameterAVP[] = [
      { code: AVPCode.OriginHost, mandatory: true, value: this.config.originHost },
      { code: AVPCode.OriginRealm, mandatory: true, value: this.config.originRealm },
      { code: AVPCode.VendorId, mandatory: true, value: this.config.vendorId! },
      { code: AVPCode.ProductName, mandatory: false, value: this.config.productName! },
      { code: AVPCode.AuthApplicationId, mandatory: true, value: DiameterApplication.Common },
    ];

    const message: DiameterMessage = {
      version: 1,
      commandCode: DiameterCommand.CapabilitiesExchange,
      flags: 0x80, // Request bit
      applicationId: DiameterApplication.Common,
      hopByHopId: this.hopByHopId++,
      endToEndId: this.endToEndId++,
      avps,
    };

    await this.sendMessage(message);
  }

  async sendAccountingRequest(
    recordType: 'START' | 'INTERIM' | 'STOP',
    username: string
  ): Promise<DiameterMessage> {
    const recordTypeValue = recordType === 'START' ? 2 : recordType === 'INTERIM' ? 3 : 4;

    const avps: DiameterAVP[] = [
      { code: AVPCode.SessionId, mandatory: true, value: this.sessionId },
      { code: AVPCode.OriginHost, mandatory: true, value: this.config.originHost },
      { code: AVPCode.OriginRealm, mandatory: true, value: this.config.originRealm },
      { code: AVPCode.DestinationRealm, mandatory: true, value: this.config.originRealm },
      { code: 480, mandatory: true, value: recordTypeValue }, // Accounting-Record-Type
      { code: 485, mandatory: true, value: 1 }, // Accounting-Record-Number
      { code: AVPCode.UserName, mandatory: false, value: username },
    ];

    const message: DiameterMessage = {
      version: 1,
      commandCode: DiameterCommand.Accounting,
      flags: 0xC0, // Request + Proxiable
      applicationId: DiameterApplication.BaseAccounting,
      hopByHopId: this.hopByHopId++,
      endToEndId: this.endToEndId++,
      avps,
    };

    await this.sendMessage(message);

    return await this.receiveMessage();
  }

  async sendCreditControlRequest(
    requestType: 'INITIAL' | 'UPDATE' | 'TERMINATE',
    username: string,
    requestedUnits: number
  ): Promise<DiameterMessage> {
    const requestTypeValue = requestType === 'INITIAL' ? 1 : requestType === 'UPDATE' ? 2 : 3;

    const avps: DiameterAVP[] = [
      { code: AVPCode.SessionId, mandatory: true, value: this.sessionId },
      { code: AVPCode.OriginHost, mandatory: true, value: this.config.originHost },
      { code: AVPCode.OriginRealm, mandatory: true, value: this.config.originRealm },
      { code: AVPCode.DestinationRealm, mandatory: true, value: this.config.originRealm },
      { code: 416, mandatory: true, value: requestTypeValue }, // CC-Request-Type
      { code: 415, mandatory: true, value: 1 }, // CC-Request-Number
      { code: AVPCode.UserName, mandatory: false, value: username },
      { code: 437, mandatory: false, value: requestedUnits }, // Requested-Service-Unit
    ];

    const message: DiameterMessage = {
      version: 1,
      commandCode: DiameterCommand.CreditControl,
      flags: 0xC0,
      applicationId: DiameterApplication.CreditControl,
      hopByHopId: this.hopByHopId++,
      endToEndId: this.endToEndId++,
      avps,
    };

    await this.sendMessage(message);

    return await this.receiveMessage();
  }

  private async sendMessage(message: DiameterMessage): Promise<void> {
    const encoded = this.encodeMessage(message);
    await this.send(encoded);
  }

  private async receiveMessage(): Promise<DiameterMessage> {
    const data = await this.receive();
    return this.decodeMessage(data);
  }

  private encodeMessage(message: DiameterMessage): Uint8Array {
    const avpsEncoded = this.encodeAVPs(message.avps);

    const totalLength = 20 + avpsEncoded.length;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    let offset = 0;

    // Version
    view.setUint8(offset++, message.version);

    // Message Length (24-bit)
    view.setUint8(offset++, (totalLength >> 16) & 0xFF);
    view.setUint8(offset++, (totalLength >> 8) & 0xFF);
    view.setUint8(offset++, totalLength & 0xFF);

    // Command Flags
    view.setUint8(offset++, message.flags);

    // Command Code (24-bit)
    view.setUint8(offset++, (message.commandCode >> 16) & 0xFF);
    view.setUint8(offset++, (message.commandCode >> 8) & 0xFF);
    view.setUint8(offset++, message.commandCode & 0xFF);

    // Application-ID
    view.setUint32(offset, message.applicationId, false);
    offset += 4;

    // Hop-by-Hop Identifier
    view.setUint32(offset, message.hopByHopId, false);
    offset += 4;

    // End-to-End Identifier
    view.setUint32(offset, message.endToEndId, false);
    offset += 4;

    // AVPs
    new Uint8Array(buffer).set(avpsEncoded, offset);

    return new Uint8Array(buffer);
  }

  private decodeMessage(data: Uint8Array): DiameterMessage {
    const view = new DataView(data.buffer, data.byteOffset);
    let offset = 0;

    const version = view.getUint8(offset++);

    const length = (view.getUint8(offset++) << 16) |
                   (view.getUint8(offset++) << 8) |
                   view.getUint8(offset++);

    const flags = view.getUint8(offset++);

    const commandCode = (view.getUint8(offset++) << 16) |
                        (view.getUint8(offset++) << 8) |
                        view.getUint8(offset++);

    const applicationId = view.getUint32(offset, false);
    offset += 4;

    const hopByHopId = view.getUint32(offset, false);
    offset += 4;

    const endToEndId = view.getUint32(offset, false);
    offset += 4;

    const avps = this.decodeAVPs(data.slice(offset));

    return {
      version,
      commandCode,
      flags,
      applicationId,
      hopByHopId,
      endToEndId,
      avps,
    };
  }

  private encodeAVPs(avps: DiameterAVP[]): Uint8Array {
    const chunks: Uint8Array[] = [];

    for (const avp of avps) {
      chunks.push(this.encodeAVP(avp));
    }

    return this.combineChunks(chunks);
  }

  private encodeAVP(avp: DiameterAVP): Uint8Array {
    const valueEncoded = this.encodeAVPValue(avp);
    const hasVendor = avp.vendorId !== undefined;

    const headerLength = hasVendor ? 12 : 8;
    const paddedLength = Math.ceil((headerLength + valueEncoded.length) / 4) * 4;

    const buffer = new ArrayBuffer(paddedLength);
    const view = new DataView(buffer);
    let offset = 0;

    // AVP Code
    view.setUint32(offset, avp.code, false);
    offset += 4;

    // Flags
    let flags = 0;
    if (hasVendor) flags |= 0x80; // Vendor bit
    if (avp.mandatory) flags |= 0x40; // Mandatory bit
    view.setUint8(offset++, flags);

    // AVP Length (24-bit)
    const avpLength = headerLength + valueEncoded.length;
    view.setUint8(offset++, (avpLength >> 16) & 0xFF);
    view.setUint8(offset++, (avpLength >> 8) & 0xFF);
    view.setUint8(offset++, avpLength & 0xFF);

    // Vendor-ID (if present)
    if (hasVendor) {
      view.setUint32(offset, avp.vendorId!, false);
      offset += 4;
    }

    // Value
    new Uint8Array(buffer).set(valueEncoded, offset);

    return new Uint8Array(buffer);
  }

  private encodeAVPValue(avp: DiameterAVP): Uint8Array {
    if (typeof avp.value === 'number') {
      const buffer = new ArrayBuffer(4);
      new DataView(buffer).setUint32(0, avp.value, false);
      return new Uint8Array(buffer);
    } else if (typeof avp.value === 'string') {
      return new TextEncoder().encode(avp.value);
    } else if (avp.value instanceof Uint8Array) {
      return avp.value;
    } else if (Array.isArray(avp.value)) {
      return this.encodeAVPs(avp.value);
    }

    return new Uint8Array(0);
  }

  private decodeAVPs(data: Uint8Array): DiameterAVP[] {
    const avps: DiameterAVP[] = [];
    let offset = 0;

    while (offset < data.length) {
      const view = new DataView(data.buffer, data.byteOffset + offset);

      const code = view.getUint32(0, false);
      const flags = view.getUint8(4);
      const length = (view.getUint8(5) << 16) |
                     (view.getUint8(6) << 8) |
                     view.getUint8(7);

      let valueOffset = 8;
      let vendorId: number | undefined;

      if (flags & 0x80) {
        vendorId = view.getUint32(8, false);
        valueOffset = 12;
      }

      const valueLength = length - valueOffset;
      const value = data.slice(offset + valueOffset, offset + valueOffset + valueLength);

      avps.push({
        code,
        vendorId,
        mandatory: (flags & 0x40) !== 0,
        value,
      });

      // Move to next AVP (padded to 4-byte boundary)
      offset += Math.ceil(length / 4) * 4;
    }

    return avps;
  }

  private getResultCode(message: DiameterMessage): number {
    const resultCodeAVP = message.avps.find(avp => avp.code === AVPCode.ResultCode);

    if (resultCodeAVP && resultCodeAVP.value instanceof Uint8Array) {
      return new DataView(resultCodeAVP.value.buffer).getUint32(0, false);
    }

    return 0;
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
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async receive(): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();

    // Read header to get length
    const headerBuf = new Uint8Array(4);
    let offset = 0;

    while (offset < 4) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = 4 - offset;
      const toCopy = Math.min(remaining, value.length);
      headerBuf.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    // Parse length
    const length = (headerBuf[1] << 16) | (headerBuf[2] << 8) | headerBuf[3];

    // Read rest of message
    const messageBuf = new Uint8Array(length);
    messageBuf.set(headerBuf, 0);
    offset = 4;

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
    // Send DPR (Disconnect-Peer-Request)
    const avps: DiameterAVP[] = [
      { code: AVPCode.OriginHost, mandatory: true, value: this.config.originHost },
      { code: AVPCode.OriginRealm, mandatory: true, value: this.config.originRealm },
      { code: 273, mandatory: true, value: 0 }, // Disconnect-Cause: REBOOTING
    ];

    const message: DiameterMessage = {
      version: 1,
      commandCode: DiameterCommand.DisconnectPeer,
      flags: 0x80,
      applicationId: DiameterApplication.Common,
      hopByHopId: this.hopByHopId++,
      endToEndId: this.endToEndId++,
      avps,
    };

    await this.sendMessage(message);
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/DiameterClient.tsx

export function DiameterClient() {
  const [host, setHost] = useState('');
  const [originHost, setOriginHost] = useState('client.example.com');
  const [originRealm, setOriginRealm] = useState('example.com');
  const [username, setUsername] = useState('');
  const [connected, setConnected] = useState(false);
  const [result, setResult] = useState<any>(null);

  const connect = async () => {
    const response = await fetch('/api/diameter/connect', {
      method: 'POST',
      body: JSON.stringify({ host, originHost, originRealm }),
    });

    if (response.ok) {
      setConnected(true);
    }
  };

  const sendAccounting = async () => {
    const response = await fetch('/api/diameter/accounting', {
      method: 'POST',
      body: JSON.stringify({
        recordType: 'START',
        username,
      }),
    });

    const data = await response.json();
    setResult(data);
  };

  return (
    <div className="diameter-client">
      <h2>Diameter Client</h2>

      <div className="config">
        <input placeholder="Diameter Server" value={host} onChange={(e) => setHost(e.target.value)} />
        <input placeholder="Origin-Host" value={originHost} onChange={(e) => setOriginHost(e.target.value)} />
        <input placeholder="Origin-Realm" value={originRealm} onChange={(e) => setOriginRealm(e.target.value)} />
        <button onClick={connect}>Connect</button>
      </div>

      {connected && (
        <div className="actions">
          <h3>Send Request</h3>
          <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <button onClick={sendAccounting}>Send Accounting Request</button>
        </div>
      )}

      {result && (
        <div className="result">
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}

      <div className="info">
        <h3>About Diameter</h3>
        <ul>
          <li>Modern AAA protocol (RFC 6733)</li>
          <li>Successor to RADIUS</li>
          <li>TCP/SCTP transport (reliable)</li>
          <li>Used in 4G LTE, 5G networks</li>
          <li>IMS, policy control, charging</li>
          <li>Extensible with AVPs</li>
        </ul>
      </div>
    </div>
  );
}
```

## Resources

- **RFC 6733**: [Diameter Base Protocol](https://tools.ietf.org/html/rfc6733)
- **3GPP**: [Mobile network specs](https://www.3gpp.org/)
- **FreeDiameter**: [Open source implementation](http://www.freediameter.net/)

## Notes

- **Successor to RADIUS** - More reliable, secure, extensible
- **TCP/SCTP** - Reliable transport (not UDP)
- **AVP-based** - Attribute-Value Pairs
- **Mobile networks** - 4G LTE, 5G core
- **IMS** - IP Multimedia Subsystem
- **Peer-to-peer** - Can operate in mesh topology
- **Realm routing** - Message routing based on realms
- **Application IDs** - Different applications (auth, accounting, credit control)
- **Result codes** - 2xxx success, 3xxx protocol errors, 4xxx transient failures, 5xxx permanent failures
