# Remote Desktop Protocol (RDP) Implementation Plan

## Overview

**Protocol:** Remote Desktop Protocol (RDP)
**Port:** 3389 (TCP)
**Specification:** [MS-RDPBCGR](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpbcgr/)
**Complexity:** Very High
**Purpose:** Remote desktop access and control

RDP provides **remote desktop functionality** - full graphical remote control of Windows systems, multi-channel virtual connections, clipboard sharing, drive redirection, and multimedia streaming.

### Use Cases
- Remote Windows desktop access
- System administration
- Remote support and troubleshooting
- Virtual desktop infrastructure (VDI)
- Remote application delivery
- Windows server management

## Protocol Specification

### Connection Sequence

```
1. X.224 Connection Request
2. X.224 Connection Confirm
3. MCS Connect Initial (with GCC Conference Create Request)
4. MCS Connect Response (with GCC Conference Create Response)
5. MCS Erect Domain Request
6. MCS Attach User Request
7. MCS Attach User Confirm
8. MCS Channel Join Requests (for each channel)
9. Security Exchange (encryption setup)
10. Client Info (credentials)
11. Licensing
12. Capabilities Exchange
13. Connection Finalization
14. Graphics/Input data exchange
```

### X.224 Connection Request

```
TPKT Header:
  version: 3
  reserved: 0
  length: [packet length]

X.224 COTP:
  length: 0x0E
  type: 0xE0 (CR - Connection Request)
  dst-ref: 0x0000
  src-ref: 0x0000
  class: 0x00

RDP Negotiation Request:
  type: TYPE_RDP_NEG_REQ (0x01)
  flags: 0x00
  length: 0x0008
  requestedProtocols: PROTOCOL_RDP (0x00000000)
                    | PROTOCOL_SSL (0x00000001)
                    | PROTOCOL_HYBRID (0x00000002)
```

### MCS Connect Initial PDU

Contains GCC Conference Create Request with:
- Client core data
- Client security data
- Client network data
- Client cluster data

### Encryption

RDP supports multiple encryption levels:
- **Standard RDP Security** - RC4, RSA
- **TLS/SSL** - Modern RDP uses TLS 1.2+
- **CredSSP** - Network Level Authentication (NLA)

## Worker Implementation

```typescript
// src/worker/protocols/rdp/client.ts

import { connect } from 'cloudflare:sockets';

export interface RDPConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  width?: number;
  height?: number;
  colorDepth?: number;
  useNLA?: boolean; // Network Level Authentication
}

// RDP Protocol Constants
const PROTOCOL_RDP = 0x00000000;
const PROTOCOL_SSL = 0x00000001;
const PROTOCOL_HYBRID = 0x00000002;

export class RDPClient {
  private socket: any;
  private config: Required<RDPConfig>;
  private mcsUserId?: number;
  private channels = new Map<number, string>();

  constructor(config: RDPConfig) {
    this.config = {
      port: 3389,
      username: '',
      password: '',
      domain: '',
      width: 1024,
      height: 768,
      colorDepth: 16,
      useNLA: true,
      ...config,
    };
  }

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Step 1: X.224 Connection Request
    await this.sendX224ConnectionRequest();
    await this.receiveX224ConnectionConfirm();

    // Step 2: MCS Connect Initial
    await this.sendMCSConnectInitial();
    await this.receiveMCSConnectResponse();

    // Step 3: MCS Erect Domain Request
    await this.sendMCSErectDomainRequest();

    // Step 4: MCS Attach User Request
    await this.sendMCSAttachUserRequest();
    this.mcsUserId = await this.receiveMCSAttachUserConfirm();

    // Step 5: Join channels
    await this.joinChannels();

    // Step 6: Security Exchange
    await this.securityExchange();

    // Step 7: Send Client Info (credentials)
    await this.sendClientInfo();

    // Step 8: Licensing
    await this.handleLicensing();

    // Step 9: Capabilities Exchange
    await this.sendClientCapabilities();
    await this.receiveServerCapabilities();

    // Step 10: Finalization
    await this.sendClientFinalization();
  }

  private async sendX224ConnectionRequest(): Promise<void> {
    const buffer = new ArrayBuffer(43);
    const view = new DataView(buffer);
    let offset = 0;

    // TPKT Header
    view.setUint8(offset++, 3); // version
    view.setUint8(offset++, 0); // reserved
    view.setUint16(offset, 43, false); // length
    offset += 2;

    // X.224 COTP Connection Request
    view.setUint8(offset++, 0x0E); // length
    view.setUint8(offset++, 0xE0); // type: CR
    view.setUint16(offset, 0, false); // dst-ref
    offset += 2;
    view.setUint16(offset, 0, false); // src-ref
    offset += 2;
    view.setUint8(offset++, 0); // class

    // Cookie (optional)
    const cookie = `Cookie: mstshash=${this.config.username}\r\n`;
    const cookieBytes = new TextEncoder().encode(cookie);
    new Uint8Array(buffer).set(cookieBytes, offset);
    offset += cookieBytes.length;

    // RDP Negotiation Request
    view.setUint8(offset++, 0x01); // type: TYPE_RDP_NEG_REQ
    view.setUint8(offset++, 0x00); // flags
    view.setUint16(offset, 0x0008, true); // length
    offset += 2;

    const protocols = this.config.useNLA
      ? PROTOCOL_HYBRID
      : PROTOCOL_SSL | PROTOCOL_RDP;
    view.setUint32(offset, protocols, true);

    await this.send(new Uint8Array(buffer));
  }

  private async receiveX224ConnectionConfirm(): Promise<void> {
    const response = await this.receive(19); // Minimum size
    const view = new DataView(response.buffer);

    // Verify TPKT
    if (view.getUint8(0) !== 3) {
      throw new Error('Invalid TPKT version');
    }

    // Verify X.224 Connection Confirm
    if (view.getUint8(5) !== 0xD0) {
      throw new Error('Expected X.224 Connection Confirm');
    }

    // Check for RDP Negotiation Response
    if (response.length >= 19) {
      const negType = view.getUint8(11);
      if (negType === 0x02) {
        const selectedProtocol = view.getUint32(15, true);
        console.log('Selected protocol:', selectedProtocol);
      }
    }
  }

  private async sendMCSConnectInitial(): Promise<void> {
    // MCS Connect Initial PDU with GCC Conference Create Request
    // This is complex - would include client data blocks:
    // - CS_CORE (core settings)
    // - CS_SECURITY (security settings)
    // - CS_NET (network settings)
    // - CS_CLUSTER (cluster settings)

    // Simplified version
    const gccData = this.buildGCCConferenceCreateRequest();
    const mcsConnectInitial = this.buildMCSConnectInitial(gccData);

    await this.sendTPKT(mcsConnectInitial);
  }

  private buildGCCConferenceCreateRequest(): Uint8Array {
    // Build client data blocks
    const coreData = this.buildClientCoreData();
    const securityData = this.buildClientSecurityData();
    const networkData = this.buildClientNetworkData();

    // Combine into GCC packet
    const totalLength = coreData.length + securityData.length + networkData.length;
    const buffer = new Uint8Array(totalLength + 20); // +20 for headers

    let offset = 0;

    // GCC Conference Create Request header (simplified)
    // ... BER encoding ...

    buffer.set(coreData, offset);
    offset += coreData.length;

    buffer.set(securityData, offset);
    offset += securityData.length;

    buffer.set(networkData, offset);

    return buffer;
  }

  private buildClientCoreData(): Uint8Array {
    const buffer = new ArrayBuffer(216);
    const view = new DataView(buffer);
    let offset = 0;

    // CS_CORE header
    view.setUint16(offset, 0xC001, true); // type
    offset += 2;
    view.setUint16(offset, 216, true); // length
    offset += 2;

    // Version
    view.setUint32(offset, 0x00080004, true); // RDP 5.0+
    offset += 4;

    // Desktop width/height
    view.setUint16(offset, this.config.width, true);
    offset += 2;
    view.setUint16(offset, this.config.height, true);
    offset += 2;

    // Color depth
    view.setUint16(offset, 0xCA01, true); // RNS_UD_COLOR_8BPP
    offset += 2;

    // ... additional fields ...

    return new Uint8Array(buffer);
  }

  private buildClientSecurityData(): Uint8Array {
    const buffer = new ArrayBuffer(12);
    const view = new DataView(buffer);

    view.setUint16(0, 0xC002, true); // type: CS_SECURITY
    view.setUint16(2, 12, true); // length
    view.setUint32(4, 0x00000001, true); // encryption methods: 40-bit
    view.setUint32(8, 0, true); // ext encryption methods

    return new Uint8Array(buffer);
  }

  private buildClientNetworkData(): Uint8Array {
    // CS_NET - lists virtual channels
    const channels = ['rdpdr', 'rdpsnd', 'drdynvc']; // Device redirection, sound, dynamic VC

    const buffer = new ArrayBuffer(8 + channels.length * 12);
    const view = new DataView(buffer);
    let offset = 0;

    view.setUint16(offset, 0xC003, true); // type: CS_NET
    offset += 2;
    view.setUint16(offset, buffer.byteLength, true); // length
    offset += 2;
    view.setUint32(offset, channels.length, true); // channel count
    offset += 4;

    for (const channel of channels) {
      const nameBytes = new TextEncoder().encode(channel.padEnd(8, '\0'));
      new Uint8Array(buffer).set(nameBytes.slice(0, 8), offset);
      offset += 8;

      view.setUint32(offset, 0x80000000, true); // options: initialized
      offset += 4;
    }

    return new Uint8Array(buffer);
  }

  private buildMCSConnectInitial(gccData: Uint8Array): Uint8Array {
    // MCS Connect Initial PDU (BER encoded)
    // Simplified - real implementation needs proper BER encoding

    const buffer = new Uint8Array(100 + gccData.length);
    let offset = 0;

    // MCS header (simplified BER)
    buffer[offset++] = 0x7F; // Connect Initial
    buffer[offset++] = 0x65; // ...

    // ... BER encoding of MCS structure ...

    // Embed GCC data
    buffer.set(gccData, offset);

    return buffer;
  }

  private async sendMCSErectDomainRequest(): Promise<void> {
    const pdu = new Uint8Array([
      0x04, 0x01, 0x00, // MCS Erect Domain Request
      0x01, 0x00, // subHeight
      0x01, 0x00, // subInterval
    ]);

    await this.sendTPKT(pdu);
  }

  private async sendMCSAttachUserRequest(): Promise<void> {
    const pdu = new Uint8Array([0x28]); // MCS Attach User Request
    await this.sendTPKT(pdu);
  }

  private async receiveMCSAttachUserConfirm(): Promise<number> {
    const response = await this.receiveTPKT();

    // Parse MCS Attach User Confirm
    // Extract user ID

    return 0; // Simplified - return actual user ID
  }

  private async joinChannels(): Promise<void> {
    const channelIds = [1003, 1004, 1005]; // I/O, RDPDR, ClipRdr channels

    for (const channelId of channelIds) {
      await this.sendMCSChannelJoinRequest(channelId);
      await this.receiveMCSChannelJoinConfirm();
    }
  }

  private async sendMCSChannelJoinRequest(channelId: number): Promise<void> {
    const buffer = new ArrayBuffer(5);
    const view = new DataView(buffer);

    view.setUint8(0, 0x38); // MCS Channel Join Request
    view.setUint16(1, this.mcsUserId!, false);
    view.setUint16(3, channelId, false);

    await this.sendTPKT(new Uint8Array(buffer));
  }

  private async receiveMCSChannelJoinConfirm(): Promise<void> {
    await this.receiveTPKT();
  }

  private async securityExchange(): Promise<void> {
    // Exchange encryption keys
    // For TLS connections, this may be simplified
  }

  private async sendClientInfo(): Promise<void> {
    // Send credentials and client info
    const info = this.buildClientInfoPDU();
    await this.sendSecurityExchange(info);
  }

  private buildClientInfoPDU(): Uint8Array {
    const encoder = new TextEncoder();
    const domain = encoder.encode(this.config.domain + '\0');
    const username = encoder.encode(this.config.username + '\0');
    const password = encoder.encode(this.config.password + '\0');

    const buffer = new ArrayBuffer(1000); // Simplified
    const view = new DataView(buffer);
    let offset = 0;

    // Client Info PDU header
    view.setUint32(offset, 0, true); // codePage
    offset += 4;
    view.setUint32(offset, 0x00000001, true); // flags: INFO_MOUSE
    offset += 4;

    // ... domain, username, password, etc. ...

    return new Uint8Array(buffer.slice(0, offset));
  }

  private async handleLicensing(): Promise<void> {
    // Receive and respond to licensing PDUs
    // This can be complex - simplified here
  }

  private async sendClientCapabilities(): Promise<void> {
    // Send capability sets
    // - General, Bitmap, Order, Input, Font, etc.
  }

  private async receiveServerCapabilities(): Promise<void> {
    // Receive server capability sets
  }

  private async sendClientFinalization(): Promise<void> {
    // Send Synchronize, Control Cooperate, Control Request, Font List
  }

  // Graphics and Input

  async sendMouseEvent(x: number, y: number, button: number, pressed: boolean): Promise<void> {
    // Send TS_POINTER_EVENT
  }

  async sendKeyEvent(keyCode: number, pressed: boolean): Promise<void> {
    // Send TS_KEYBOARD_EVENT
  }

  async sendRefreshRect(left: number, top: number, right: number, bottom: number): Promise<void> {
    // Request screen refresh for specific area
  }

  // Utility methods

  private async sendTPKT(data: Uint8Array): Promise<void> {
    const buffer = new ArrayBuffer(4 + data.length);
    const view = new DataView(buffer);

    view.setUint8(0, 3); // TPKT version
    view.setUint8(1, 0); // reserved
    view.setUint16(2, buffer.byteLength, false); // length

    new Uint8Array(buffer).set(data, 4);

    await this.send(new Uint8Array(buffer));
  }

  private async receiveTPKT(): Promise<Uint8Array> {
    const header = await this.receive(4);
    const view = new DataView(header.buffer);
    const length = view.getUint16(2, false);

    if (length > 4) {
      const payload = await this.receive(length - 4);
      return payload;
    }

    return new Uint8Array(0);
  }

  private async send(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async receive(length: number): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();
    const buffer = new Uint8Array(length);
    let offset = 0;

    while (offset < length) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = length - offset;
      const toCopy = Math.min(remaining, value.length);
      buffer.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    reader.releaseLock();
    return buffer;
  }

  private async sendSecurityExchange(data: Uint8Array): Promise<void> {
    // Send data with security header
    await this.sendTPKT(data);
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/RDPClient.tsx

export function RDPClient() {
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [domain, setDomain] = useState('');
  const [connected, setConnected] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const connect = async () => {
    try {
      const ws = new WebSocket('/api/rdp/connect');

      ws.onopen = () => {
        ws.send(JSON.stringify({
          host,
          username,
          password,
          domain,
          width: 1024,
          height: 768,
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          setConnected(true);
        } else if (data.type === 'bitmap') {
          renderBitmap(data.bitmap);
        }
      };

    } catch (error) {
      alert(`Connection failed: ${error.message}`);
    }
  };

  const renderBitmap = (bitmap: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Render RDP bitmap data
    const imageData = ctx.createImageData(bitmap.width, bitmap.height);
    imageData.data.set(bitmap.data);
    ctx.putImageData(imageData, bitmap.x, bitmap.y);
  };

  return (
    <div className="rdp-client">
      <h2>Remote Desktop Protocol (RDP)</h2>

      {!connected ? (
        <div className="connection">
          <input
            type="text"
            placeholder="Host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
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
          <input
            type="text"
            placeholder="Domain (optional)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <button onClick={connect}>Connect</button>
        </div>
      ) : (
        <div className="desktop">
          <canvas
            ref={canvasRef}
            width={1024}
            height={768}
            className="rdp-canvas"
          />
        </div>
      )}

      <div className="info">
        <h3>About RDP</h3>
        <ul>
          <li>Remote Desktop Protocol (Microsoft)</li>
          <li>Full graphical remote desktop</li>
          <li>Supports TLS encryption</li>
          <li>Network Level Authentication (NLA)</li>
          <li>Multi-monitor support</li>
          <li>RemoteFX for enhanced graphics</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### Network Level Authentication (NLA)

```typescript
// CredSSP authentication
const config: RDPConfig = {
  host: 'windows-server.example.com',
  username: 'admin',
  password: 'password',
  useNLA: true, // Enable NLA
};
```

### TLS Encryption

```bash
# RDP server must have valid TLS certificate
# Client verifies certificate (or can accept any in testing)
```

## Testing

```bash
# Test RDP connection with rdesktop
rdesktop -u admin -p password windows-server.example.com

# Or with xfreerdp (FreeRDP)
xfreerdp /v:windows-server.example.com /u:admin /p:password

# Windows built-in client
mstsc /v:windows-server.example.com
```

## Resources

- **MS-RDPBCGR**: [Core Protocol Spec](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpbcgr/)
- **FreeRDP**: [Open source RDP client](https://www.freerdp.com/)
- **RDP Security**: [Best practices](https://docs.microsoft.com/en-us/windows-server/remote/remote-desktop-services/rds-security)

## Notes

- **Very complex protocol** - full implementation requires 1000s of lines
- **Multi-layered** - X.224, MCS, RDP, virtual channels
- **Binary protocol** - requires careful parsing
- **Encryption** - TLS/SSL, CredSSP for NLA
- **Graphics** - Bitmap orders, RemoteFX, H.264 codec
- **Virtual channels** - Device redirection, audio, clipboard
- **Widely used** - default Windows remote access
- **Port 3389** - often targeted, use strong passwords/NLA
- **Licensing** - Microsoft RDP licensing requirements
- Consider using **FreeRDP library** for full implementation
