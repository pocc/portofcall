# TACACS+ Protocol Implementation Plan

## Overview

**Protocol:** TACACS+ (Terminal Access Controller Access-Control System Plus)
**Port:** 49 (TCP)
**RFC:** [RFC 8907](https://tools.ietf.org/html/rfc8907)
**Complexity:** Medium
**Purpose:** AAA for network devices (Cisco)

TACACS+ provides **device administration AAA** - authentication, authorization, and accounting for network device access, with full separation of AAA functions and encrypted packet bodies.

### Use Cases
- Cisco router/switch authentication
- Network device administration
- Command authorization (per-command)
- Privileged EXEC mode access
- Configuration changes auditing
- Centralized network access control

## Protocol Specification

### TCP-Based Protocol

TACACS+ uses **TCP port 49** for reliable delivery.

### Packet Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|major  | minor |     type      |   seq_no      |    flags      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         session_id                            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                            length                             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
~                     body (encrypted)                          ~
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Header Fields

```
major_version: 0xC (12) - TACACS+ major version
minor_version: 0x0 (default) or 0x1 (minor version)
type:
  0x01 - Authentication
  0x02 - Authorization
  0x03 - Accounting
seq_no: Packet sequence number (starts at 1)
flags:
  0x01 - TAC_PLUS_UNENCRYPTED_FLAG
  0x04 - TAC_PLUS_SINGLE_CONNECT_FLAG
session_id: Unique session identifier
length: Length of encrypted body
```

### Authentication Packet

```
START:
  action: LOGIN, CHPASS, SENDAUTH
  priv_lvl: Privilege level (0-15)
  authen_type: ASCII, PAP, CHAP, etc.
  service: LOGIN, ENABLE, PPP, etc.
  user: Username
  port: NAS port
  rem_addr: Remote address
  data: Optional data

CONTINUE:
  user_msg: User's response
  data: Additional data

REPLY:
  status: PASS, FAIL, GETDATA, GETUSER, GETPASS, RESTART, ERROR
  server_msg: Message to display
  data: Additional data
```

### Authorization Packet

```
REQUEST:
  authen_method: Method used
  priv_lvl: Privilege level
  authen_type: Authentication type
  authen_service: Service
  user: Username
  port: NAS port
  rem_addr: Remote address
  args: Command arguments (AV pairs)

RESPONSE:
  status: PASS_ADD, PASS_REPL, FAIL
  args: Returned AV pairs
  server_msg: Message
```

### Accounting Packet

```
REQUEST:
  flags: START, STOP, WATCHDOG
  authen_method: Authentication method
  priv_lvl: Privilege level
  authen_type: Authentication type
  authen_service: Service
  user: Username
  port: NAS port
  rem_addr: Remote address
  args: Accounting AV pairs

REPLY:
  status: SUCCESS, ERROR, FOLLOW
  server_msg: Message
```

## Worker Implementation

```typescript
// src/worker/protocols/tacacs/client.ts

import { connect } from 'cloudflare:sockets';
import { createHash } from 'crypto';

export interface TACACSConfig {
  host: string;
  port?: number;
  secret: string;
  timeout?: number;
}

// Packet Types
export enum PacketType {
  Authentication = 0x01,
  Authorization = 0x02,
  Accounting = 0x03,
}

// Authentication Actions
export enum AuthenAction {
  Login = 0x01,
  ChangePass = 0x02,
  SendAuth = 0x04,
}

// Authentication Types
export enum AuthenType {
  ASCII = 0x01,
  PAP = 0x02,
  CHAP = 0x03,
  MSCHAP = 0x05,
  MSCHAPv2 = 0x06,
}

// Authentication Services
export enum AuthenService {
  None = 0x00,
  Login = 0x01,
  Enable = 0x02,
  PPP = 0x03,
  PT = 0x05,
  RCMD = 0x06,
  X25 = 0x07,
  NASI = 0x08,
}

// Authentication Status
export enum AuthenStatus {
  Pass = 0x01,
  Fail = 0x02,
  GetData = 0x03,
  GetUser = 0x04,
  GetPass = 0x05,
  Restart = 0x06,
  Error = 0x07,
  Follow = 0x21,
}

// Authorization Status
export enum AuthorStatus {
  PassAdd = 0x01,
  PassRepl = 0x02,
  Fail = 0x10,
  Error = 0x11,
  Follow = 0x21,
}

// Accounting Flags
export enum AcctFlag {
  Start = 0x02,
  Stop = 0x04,
  Watchdog = 0x08,
}

export interface TACACSHeader {
  majorVersion: number;
  minorVersion: number;
  type: PacketType;
  seqNo: number;
  flags: number;
  sessionId: number;
  length: number;
}

export class TACACSClient {
  private socket: any;
  private sessionId: number;
  private seqNo: number = 1;

  constructor(private config: TACACSConfig) {
    if (!config.port) config.port = 49;
    if (!config.timeout) config.timeout = 5000;
    this.sessionId = Math.floor(Math.random() * 0xFFFFFFFF);
  }

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;
  }

  async authenticate(username: string, password: string): Promise<{
    success: boolean;
    message?: string;
  }> {
    // Authentication START
    const startBody = this.buildAuthenStart(username);
    const startPacket = this.buildPacket(PacketType.Authentication, startBody);
    await this.send(startPacket);

    // Receive REPLY
    const replyPacket = await this.receive();
    const reply = this.parseAuthenReply(replyPacket);

    if (reply.status === AuthenStatus.GetPass) {
      // Send CONTINUE with password
      const continueBody = this.buildAuthenContinue(password);
      const continuePacket = this.buildPacket(PacketType.Authentication, continueBody);
      await this.send(continuePacket);

      // Receive final REPLY
      const finalReply = await this.receive();
      const final = this.parseAuthenReply(finalReply);

      return {
        success: final.status === AuthenStatus.Pass,
        message: final.serverMsg,
      };
    } else if (reply.status === AuthenStatus.Pass) {
      return { success: true, message: reply.serverMsg };
    } else {
      return { success: false, message: reply.serverMsg };
    }
  }

  async authorize(username: string, command: string): Promise<{
    allowed: boolean;
    message?: string;
    args?: string[];
  }> {
    const body = this.buildAuthorRequest(username, command);
    const packet = this.buildPacket(PacketType.Authorization, body);
    await this.send(packet);

    const response = await this.receive();
    const reply = this.parseAuthorResponse(response);

    return {
      allowed: reply.status === AuthorStatus.PassAdd || reply.status === AuthorStatus.PassRepl,
      message: reply.serverMsg,
      args: reply.args,
    };
  }

  async accountingStart(username: string, port: string): Promise<boolean> {
    return this.sendAccounting(username, port, AcctFlag.Start);
  }

  async accountingStop(username: string, port: string): Promise<boolean> {
    return this.sendAccounting(username, port, AcctFlag.Stop);
  }

  private async sendAccounting(username: string, port: string, flag: AcctFlag): Promise<boolean> {
    const body = this.buildAcctRequest(username, port, flag);
    const packet = this.buildPacket(PacketType.Accounting, body);
    await this.send(packet);

    const response = await this.receive();
    const reply = this.parseAcctReply(response);

    return reply.status === 0x01; // SUCCESS
  }

  private buildPacket(type: PacketType, body: Uint8Array): Uint8Array {
    const header = new ArrayBuffer(12);
    const view = new DataView(header);

    // Major version (4 bits) + Minor version (4 bits)
    view.setUint8(0, 0xC0); // 0xC = 12 (major), 0 (minor)

    // Type
    view.setUint8(1, type);

    // Sequence number
    view.setUint8(2, this.seqNo++);

    // Flags (0x00 = encrypted)
    view.setUint8(3, 0x00);

    // Session ID
    view.setUint32(4, this.sessionId, false);

    // Length
    view.setUint32(8, body.length, false);

    // Encrypt body
    const encrypted = this.encrypt(body, this.seqNo - 1);

    // Combine header + encrypted body
    const packet = new Uint8Array(12 + encrypted.length);
    packet.set(new Uint8Array(header), 0);
    packet.set(encrypted, 12);

    return packet;
  }

  private buildAuthenStart(username: string): Uint8Array {
    const userBytes = new TextEncoder().encode(username);
    const buffer = new ArrayBuffer(8 + userBytes.length);
    const view = new DataView(buffer);
    let offset = 0;

    // Action
    view.setUint8(offset++, AuthenAction.Login);

    // Privilege level
    view.setUint8(offset++, 1); // User privilege

    // Authen type
    view.setUint8(offset++, AuthenType.ASCII);

    // Service
    view.setUint8(offset++, AuthenService.Login);

    // User length
    view.setUint8(offset++, userBytes.length);

    // Port length
    view.setUint8(offset++, 0);

    // Remote address length
    view.setUint8(offset++, 0);

    // Data length
    view.setUint8(offset++, 0);

    // User
    new Uint8Array(buffer).set(userBytes, offset);

    return new Uint8Array(buffer);
  }

  private buildAuthenContinue(password: string): Uint8Array {
    const passBytes = new TextEncoder().encode(password);
    const buffer = new ArrayBuffer(5 + passBytes.length);
    const view = new DataView(buffer);

    // User message length
    view.setUint16(0, passBytes.length, false);

    // Data length
    view.setUint16(2, 0, false);

    // Flags
    view.setUint8(4, 0x00);

    // User message (password)
    new Uint8Array(buffer).set(passBytes, 5);

    return new Uint8Array(buffer);
  }

  private parseAuthenReply(packet: Uint8Array): {
    status: AuthenStatus;
    serverMsg?: string;
  } {
    const body = this.decrypt(packet.slice(12), packet[2]);
    const view = new DataView(body.buffer);

    const status = view.getUint8(0) as AuthenStatus;
    const flags = view.getUint8(1);
    const serverMsgLen = view.getUint16(2, false);
    const dataLen = view.getUint16(4, false);

    let serverMsg: string | undefined;
    if (serverMsgLen > 0) {
      const msgBytes = body.slice(6, 6 + serverMsgLen);
      serverMsg = new TextDecoder().decode(msgBytes);
    }

    return { status, serverMsg };
  }

  private buildAuthorRequest(username: string, command: string): Uint8Array {
    const userBytes = new TextEncoder().encode(username);
    const args = this.parseCommandArgs(command);

    let argsLength = 0;
    for (const arg of args) {
      argsLength += arg.length;
    }

    const buffer = new ArrayBuffer(8 + userBytes.length + args.length + argsLength);
    const view = new DataView(buffer);
    let offset = 0;

    // Authen method
    view.setUint8(offset++, 0x01); // Not set

    // Privilege level
    view.setUint8(offset++, 15); // Enable

    // Authen type
    view.setUint8(offset++, AuthenType.ASCII);

    // Authen service
    view.setUint8(offset++, AuthenService.Enable);

    // User length
    view.setUint8(offset++, userBytes.length);

    // Port length
    view.setUint8(offset++, 0);

    // Remote address length
    view.setUint8(offset++, 0);

    // Arg count
    view.setUint8(offset++, args.length);

    // Arg lengths
    for (const arg of args) {
      view.setUint8(offset++, arg.length);
    }

    // User
    new Uint8Array(buffer).set(userBytes, offset);
    offset += userBytes.length;

    // Args
    for (const arg of args) {
      new Uint8Array(buffer).set(arg, offset);
      offset += arg.length;
    }

    return new Uint8Array(buffer.slice(0, offset));
  }

  private parseCommandArgs(command: string): Uint8Array[] {
    // Parse command into AV pairs
    // Example: "show running-config" -> ["cmd=show", "cmd-arg=running-config"]

    const parts = command.split(' ');
    const args: Uint8Array[] = [];

    if (parts.length > 0) {
      args.push(new TextEncoder().encode(`cmd=${parts[0]}`));
    }

    for (let i = 1; i < parts.length; i++) {
      args.push(new TextEncoder().encode(`cmd-arg=${parts[i]}`));
    }

    return args;
  }

  private parseAuthorResponse(packet: Uint8Array): {
    status: AuthorStatus;
    serverMsg?: string;
    args: string[];
  } {
    const body = this.decrypt(packet.slice(12), packet[2]);
    const view = new DataView(body.buffer);

    const status = view.getUint8(0) as AuthorStatus;
    const argCount = view.getUint8(1);
    const serverMsgLen = view.getUint16(2, false);
    const dataLen = view.getUint16(4, false);

    let offset = 6;

    // Read arg lengths
    const argLengths: number[] = [];
    for (let i = 0; i < argCount; i++) {
      argLengths.push(view.getUint8(offset++));
    }

    // Server message
    let serverMsg: string | undefined;
    if (serverMsgLen > 0) {
      const msgBytes = body.slice(offset, offset + serverMsgLen);
      serverMsg = new TextDecoder().decode(msgBytes);
      offset += serverMsgLen;
    }

    // Skip data
    offset += dataLen;

    // Args
    const args: string[] = [];
    for (const argLen of argLengths) {
      const argBytes = body.slice(offset, offset + argLen);
      args.push(new TextDecoder().decode(argBytes));
      offset += argLen;
    }

    return { status, serverMsg, args };
  }

  private buildAcctRequest(username: string, port: string, flag: AcctFlag): Uint8Array {
    const userBytes = new TextEncoder().encode(username);
    const portBytes = new TextEncoder().encode(port);

    const buffer = new ArrayBuffer(9 + userBytes.length + portBytes.length);
    const view = new DataView(buffer);
    let offset = 0;

    // Flags
    view.setUint8(offset++, flag);

    // Authen method
    view.setUint8(offset++, 0x01);

    // Privilege level
    view.setUint8(offset++, 1);

    // Authen type
    view.setUint8(offset++, AuthenType.ASCII);

    // Authen service
    view.setUint8(offset++, AuthenService.Login);

    // User length
    view.setUint8(offset++, userBytes.length);

    // Port length
    view.setUint8(offset++, portBytes.length);

    // Remote address length
    view.setUint8(offset++, 0);

    // Arg count
    view.setUint8(offset++, 0);

    // User
    new Uint8Array(buffer).set(userBytes, offset);
    offset += userBytes.length;

    // Port
    new Uint8Array(buffer).set(portBytes, offset);

    return new Uint8Array(buffer);
  }

  private parseAcctReply(packet: Uint8Array): { status: number } {
    const body = this.decrypt(packet.slice(12), packet[2]);
    const status = body[0];
    return { status };
  }

  private encrypt(body: Uint8Array, seqNo: number): Uint8Array {
    // TACACS+ encryption: XOR with MD5 pseudo-random pad
    // pad = MD5(session_id + secret + version + seq_no)
    // pad_n = MD5(session_id + secret + version + seq_no + pad_n-1)

    const result = new Uint8Array(body.length);
    const secret = new TextEncoder().encode(this.config.secret);
    let offset = 0;

    while (offset < body.length) {
      const hashInput = new Uint8Array(4 + secret.length + 1 + 1 + (offset > 0 ? 16 : 0));
      const view = new DataView(hashInput.buffer);
      let hashOffset = 0;

      // Session ID
      view.setUint32(hashOffset, this.sessionId, false);
      hashOffset += 4;

      // Secret
      hashInput.set(secret, hashOffset);
      hashOffset += secret.length;

      // Version
      hashInput[hashOffset++] = 0xC0;

      // Seq no
      hashInput[hashOffset++] = seqNo;

      // Previous pad (if not first iteration)
      if (offset > 0) {
        hashInput.set(result.slice(offset - 16, offset), hashOffset);
      }

      // Compute MD5
      const pad = this.md5(hashInput);

      // XOR with body
      const chunk = Math.min(16, body.length - offset);
      for (let i = 0; i < chunk; i++) {
        result[offset + i] = body[offset + i] ^ pad[i];
      }

      offset += chunk;
    }

    return result;
  }

  private decrypt(encrypted: Uint8Array, seqNo: number): Uint8Array {
    // Decryption is same as encryption (XOR)
    return this.encrypt(encrypted, seqNo);
  }

  private md5(data: Uint8Array): Uint8Array {
    const hash = createHash('md5');
    hash.update(data);
    return new Uint8Array(hash.digest());
  }

  private async send(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async receive(): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();

    // Read header (12 bytes)
    const headerBuf = new Uint8Array(12);
    let offset = 0;

    while (offset < 12) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = 12 - offset;
      const toCopy = Math.min(remaining, value.length);
      headerBuf.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    // Parse length
    const view = new DataView(headerBuf.buffer);
    const length = view.getUint32(8, false);

    // Read body
    const bodyBuf = new Uint8Array(length);
    offset = 0;

    while (offset < length) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = length - offset;
      const toCopy = Math.min(remaining, value.length);
      bodyBuf.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    reader.releaseLock();

    // Combine header + body
    const packet = new Uint8Array(12 + length);
    packet.set(headerBuf, 0);
    packet.set(bodyBuf, 12);

    return packet;
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/TACACSClient.tsx

export function TACACSClient() {
  const [host, setHost] = useState('');
  const [secret, setSecret] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [command, setCommand] = useState('show running-config');
  const [authResult, setAuthResult] = useState<any>(null);
  const [authzResult, setAuthzResult] = useState<any>(null);

  const authenticate = async () => {
    const response = await fetch('/api/tacacs/authenticate', {
      method: 'POST',
      body: JSON.stringify({ host, secret, username, password }),
    });

    const data = await response.json();
    setAuthResult(data);
  };

  const authorize = async () => {
    const response = await fetch('/api/tacacs/authorize', {
      method: 'POST',
      body: JSON.stringify({ host, secret, username, command }),
    });

    const data = await response.json();
    setAuthzResult(data);
  };

  return (
    <div className="tacacs-client">
      <h2>TACACS+ Client</h2>

      <div className="config">
        <input placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} />
        <input placeholder="Secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
        <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>

      <div className="actions">
        <button onClick={authenticate}>Authenticate</button>
      </div>

      {authResult && (
        <div className={`result ${authResult.success ? 'success' : 'failure'}`}>
          <h3>Authentication: {authResult.success ? 'Success' : 'Failed'}</h3>
          {authResult.message && <p>{authResult.message}</p>}
        </div>
      )}

      <div className="authorization">
        <h3>Command Authorization</h3>
        <input
          placeholder="Command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        <button onClick={authorize}>Authorize Command</button>
      </div>

      {authzResult && (
        <div className={`result ${authzResult.allowed ? 'success' : 'failure'}`}>
          <h3>Authorization: {authzResult.allowed ? 'Allowed' : 'Denied'}</h3>
          {authzResult.message && <p>{authzResult.message}</p>}
        </div>
      )}

      <div className="info">
        <h3>About TACACS+</h3>
        <ul>
          <li>Cisco AAA protocol (RFC 8907)</li>
          <li>TCP port 49</li>
          <li>Full packet encryption</li>
          <li>Separate authentication, authorization, accounting</li>
          <li>Per-command authorization</li>
          <li>Widely used in enterprise networks</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### Shared Secret

```typescript
const client = new TACACSClient({
  host: 'tacacs-server.example.com',
  port: 49,
  secret: 'strong-shared-secret',
});
```

### Full Packet Encryption

Unlike RADIUS (which only encrypts password), TACACS+ **encrypts the entire packet body** using MD5 pseudo-random pad.

## Testing

```bash
# Test with Cisco device
Router# test aaa group tacacs+ username password legacy

# Configure TACACS+ on Cisco
Router(config)# tacacs-server host 192.168.1.100
Router(config)# tacacs-server key shared-secret
Router(config)# aaa new-model
Router(config)# aaa authentication login default group tacacs+ local
Router(config)# aaa authorization exec default group tacacs+ local
Router(config)# aaa accounting exec default start-stop group tacacs+
```

## Resources

- **RFC 8907**: [TACACS+ Protocol](https://tools.ietf.org/html/rfc8907)
- **Cisco TACACS+**: [Configuration Guide](https://www.cisco.com/c/en/us/support/docs/security-vpn/tacacs/13847-tac.html)
- **tac_plus**: [Open source server](http://www.shrubbery.net/tac_plus/)

## Notes

- **TCP-based** - reliable delivery (unlike RADIUS UDP)
- **Port 49** - standard TCP port
- **Full encryption** - entire packet body encrypted
- **Separation of AAA** - authentication, authorization, accounting are separate
- **Per-command authorization** - granular control
- **Cisco proprietary** - primarily used in Cisco environments
- **More secure than RADIUS** - full packet encryption vs. password-only
- **Stateful** - TCP connection maintained
- **Privilege levels** - 0-15 (15 = highest)
- **AV pairs** - Attribute-Value pairs for authorization
