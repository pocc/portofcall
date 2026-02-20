# SMB Protocol Implementation Plan

## Overview

**Protocol:** SMB (Server Message Block) / CIFS
**Port:** 445 (SMB), 139 (SMB over NetBIOS)
**Specification:** [MS-SMB2](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-smb2/)
**Complexity:** Very High
**Purpose:** Network file sharing

SMB enables **network file sharing** - access files, printers, and serial ports over a network, the primary protocol for Windows file sharing from the browser.

### Use Cases
- Windows file sharing
- Network attached storage (NAS)
- Printer sharing
- Active Directory domain services
- Remote file access
- Backup systems

## Protocol Specification

### SMB Versions

| Version | Features |
|---------|----------|
| SMB 1.0 | Original (deprecated, insecure) |
| SMB 2.0 | Windows Vista+ (improved performance) |
| SMB 2.1 | Windows 7+ (oplocks) |
| SMB 3.0 | Windows 8+ (encryption, multichannel) |
| SMB 3.1.1 | Windows 10+ (pre-auth integrity) |

### SMB2 Header

```
┌────────────────────────────────────┐
│ ProtocolId (4 bytes): 0xFE 'SMB'  │
│ StructureSize (2 bytes): 64       │
│ CreditCharge (2 bytes)             │
│ Status (4 bytes)                   │
│ Command (2 bytes)                  │
│ CreditRequest/CreditResponse (2)   │
│ Flags (4 bytes)                    │
│ NextCommand (4 bytes)              │
│ MessageId (8 bytes)                │
│ Reserved (4 bytes)                 │
│ TreeId (4 bytes)                   │
│ SessionId (8 bytes)                │
│ Signature (16 bytes)               │
└────────────────────────────────────┘
```

### SMB2 Commands

| Code | Command |
|------|---------|
| 0x0000 | NEGOTIATE |
| 0x0001 | SESSION_SETUP |
| 0x0002 | LOGOFF |
| 0x0003 | TREE_CONNECT |
| 0x0004 | TREE_DISCONNECT |
| 0x0005 | CREATE |
| 0x0006 | CLOSE |
| 0x0007 | FLUSH |
| 0x0008 | READ |
| 0x0009 | WRITE |
| 0x000A | LOCK |
| 0x000B | IOCTL |
| 0x000C | CANCEL |
| 0x000D | ECHO |
| 0x000E | QUERY_DIRECTORY |
| 0x000F | CHANGE_NOTIFY |
| 0x0010 | QUERY_INFO |
| 0x0011 | SET_INFO |

### Connection Flow

```
1. TCP Connection (port 445)
2. NEGOTIATE → Select SMB version and dialect
3. SESSION_SETUP → Authenticate user
4. TREE_CONNECT → Connect to share (e.g., \\server\share)
5. CREATE → Open file
6. READ/WRITE → Access file data
7. CLOSE → Close file
8. TREE_DISCONNECT → Disconnect from share
9. LOGOFF → End session
```

## Worker Implementation

```typescript
// src/worker/protocols/smb/client.ts

import { connect } from 'cloudflare:sockets';

export interface SMBConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  domain?: string;
  share: string;
}

export interface FileInfo {
  name: string;
  size: number;
  created: Date;
  modified: Date;
  isDirectory: boolean;
  attributes: number;
}

export class SMBClient {
  private socket: any;
  private sessionId = BigInt(0);
  private treeId = 0;
  private messageId = BigInt(0);
  private creditCharge = 1;
  private creditRequest = 1;

  constructor(private config: SMBConfig) {}

  async connect(): Promise<void> {
    const port = this.config.port || 445;
    this.socket = connect(`${this.config.host}:${port}`);
    await this.socket.opened;

    // Negotiate protocol
    await this.negotiate();

    // Setup session (authenticate)
    await this.sessionSetup();

    // Connect to share
    await this.treeConnect();
  }

  private async negotiate(): Promise<void> {
    // Build NEGOTIATE request
    const dialects = [
      0x0202, // SMB 2.0.2
      0x0210, // SMB 2.1
      0x0300, // SMB 3.0
      0x0302, // SMB 3.0.2
      0x0311, // SMB 3.1.1
    ];

    const header = this.buildHeader(0x0000); // NEGOTIATE
    const request = this.buildNegotiateRequest(dialects);

    await this.send(this.concatenate([header, request]));

    // Read response
    const response = await this.readResponse();
    // Parse selected dialect
  }

  private async sessionSetup(): Promise<void> {
    // Build SESSION_SETUP request with NTLMSSP
    const header = this.buildHeader(0x0001); // SESSION_SETUP

    // NTLMSSP authentication (simplified)
    const ntlmsspBlob = this.buildNTLMSSP();

    const request = this.buildSessionSetupRequest(ntlmsspBlob);

    await this.send(this.concatenate([header, request]));

    // Read response
    const response = await this.readResponse();

    // Extract session ID from response
    this.sessionId = this.parseSessionId(response);
  }

  private async treeConnect(): Promise<void> {
    // Build TREE_CONNECT request
    const header = this.buildHeader(0x0003); // TREE_CONNECT

    const path = `\\\\${this.config.host}\\${this.config.share}`;
    const request = this.buildTreeConnectRequest(path);

    await this.send(this.concatenate([header, request]));

    // Read response
    const response = await this.readResponse();

    // Extract tree ID from response header
    this.treeId = this.parseTreeId(response);
  }

  async listDirectory(path: string = ''): Promise<FileInfo[]> {
    // Open directory
    const fileId = await this.create(path, { directory: true });

    // Query directory
    const files: FileInfo[] = [];

    try {
      let continuationToken: Uint8Array | null = null;

      while (true) {
        const header = this.buildHeader(0x000E); // QUERY_DIRECTORY
        const request = this.buildQueryDirectoryRequest(fileId, continuationToken);

        await this.send(this.concatenate([header, request]));

        const response = await this.readResponse();
        const entries = this.parseDirectoryEntries(response);

        if (entries.length === 0) break;

        files.push(...entries);

        // Check if more entries available
        if (entries.length < 100) break; // Typical batch size
      }
    } finally {
      await this.close(fileId);
    }

    return files;
  }

  async readFile(path: string): Promise<Uint8Array> {
    // Open file
    const fileId = await this.create(path, { read: true });

    const chunks: Uint8Array[] = [];
    let offset = 0;
    const chunkSize = 65536; // 64 KB

    try {
      while (true) {
        const header = this.buildHeader(0x0008); // READ
        const request = this.buildReadRequest(fileId, offset, chunkSize);

        await this.send(this.concatenate([header, request]));

        const response = await this.readResponse();
        const data = this.parseReadResponse(response);

        if (data.length === 0) break;

        chunks.push(data);
        offset += data.length;

        if (data.length < chunkSize) break; // Last chunk
      }
    } finally {
      await this.close(fileId);
    }

    return this.concatenate(chunks);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    // Create/open file for writing
    const fileId = await this.create(path, { write: true, create: true });

    const chunkSize = 65536; // 64 KB
    let offset = 0;

    try {
      while (offset < data.length) {
        const chunk = data.slice(offset, offset + chunkSize);

        const header = this.buildHeader(0x0009); // WRITE
        const request = this.buildWriteRequest(fileId, offset, chunk);

        await this.send(this.concatenate([header, request]));

        const response = await this.readResponse();
        // Verify write success

        offset += chunk.length;
      }
    } finally {
      await this.close(fileId);
    }
  }

  async deleteFile(path: string): Promise<void> {
    const fileId = await this.create(path, { delete: true });
    await this.close(fileId);
  }

  async createDirectory(path: string): Promise<void> {
    const fileId = await this.create(path, { directory: true, create: true });
    await this.close(fileId);
  }

  private async create(
    path: string,
    options: {
      read?: boolean;
      write?: boolean;
      delete?: boolean;
      directory?: boolean;
      create?: boolean;
    }
  ): Promise<Uint8Array> {
    const header = this.buildHeader(0x0005); // CREATE

    const request = this.buildCreateRequest(path, options);

    await this.send(this.concatenate([header, request]));

    const response = await this.readResponse();

    // Extract file ID from response
    return this.parseFileId(response);
  }

  private async close(fileId: Uint8Array): Promise<void> {
    const header = this.buildHeader(0x0006); // CLOSE
    const request = this.buildCloseRequest(fileId);

    await this.send(this.concatenate([header, request]));

    await this.readResponse();
  }

  private buildHeader(command: number): Uint8Array {
    const header = new Uint8Array(64);
    const view = new DataView(header.buffer);

    // Protocol ID
    header[0] = 0xFE;
    header[1] = 0x53; // 'S'
    header[2] = 0x4D; // 'M'
    header[3] = 0x42; // 'B'

    // Structure size
    view.setUint16(4, 64, true);

    // Credit charge
    view.setUint16(6, this.creditCharge, true);

    // Status (0 for request)
    view.setUint32(8, 0, true);

    // Command
    view.setUint16(12, command, true);

    // Credit request
    view.setUint16(14, this.creditRequest, true);

    // Flags (0 for request)
    view.setUint32(16, 0, true);

    // Next command (0 if single)
    view.setUint32(20, 0, true);

    // Message ID
    view.setBigUint64(24, this.messageId++, true);

    // Reserved
    view.setUint32(32, 0, true);

    // Tree ID
    view.setUint32(36, this.treeId, true);

    // Session ID
    view.setBigUint64(40, this.sessionId, true);

    // Signature (16 bytes, zeros for unsigned)
    // bytes 48-63

    return header;
  }

  private buildNegotiateRequest(dialects: number[]): Uint8Array {
    // Simplified NEGOTIATE request
    const buffer = new Uint8Array(36 + dialects.length * 2);
    const view = new DataView(buffer.buffer);

    // Structure size
    view.setUint16(0, 36, true);

    // Dialect count
    view.setUint16(2, dialects.length, true);

    // Security mode
    view.setUint16(4, 0x01, true); // Signing enabled

    // Reserved
    view.setUint16(6, 0, true);

    // Capabilities
    view.setUint32(8, 0x00000001, true); // DFS

    // Client GUID (16 bytes)
    // bytes 12-27

    // Negotiation context offset/count (SMB 3.1.1)
    view.setUint32(28, 0, true);
    view.setUint16(32, 0, true);

    // Reserved
    view.setUint16(34, 0, true);

    // Dialects
    for (let i = 0; i < dialects.length; i++) {
      view.setUint16(36 + i * 2, dialects[i], true);
    }

    return buffer;
  }

  private buildSessionSetupRequest(securityBlob: Uint8Array): Uint8Array {
    const buffer = new Uint8Array(25 + securityBlob.length);
    const view = new DataView(buffer.buffer);

    // Structure size
    view.setUint16(0, 25, true);

    // Flags
    view.setUint8(2, 0);

    // Security mode
    view.setUint8(3, 0x01);

    // Capabilities
    view.setUint32(4, 0x00000001, true);

    // Channel
    view.setUint32(8, 0, true);

    // Security buffer offset
    view.setUint16(12, 25 + 64, true); // After header

    // Security buffer length
    view.setUint16(14, securityBlob.length, true);

    // Previous session ID
    view.setBigUint64(16, BigInt(0), true);

    // Security blob
    buffer.set(securityBlob, 25);

    return buffer;
  }

  private buildTreeConnectRequest(path: string): Uint8Array {
    const encoder = new TextEncoder();
    const pathBytes = encoder.encode(path);

    const buffer = new Uint8Array(9 + pathBytes.length);
    const view = new DataView(buffer.buffer);

    // Structure size
    view.setUint16(0, 9, true);

    // Reserved
    view.setUint16(2, 0, true);

    // Path offset
    view.setUint16(4, 9 + 64, true); // After header

    // Path length
    view.setUint16(6, pathBytes.length, true);

    // Path
    buffer.set(pathBytes, 9);

    return buffer;
  }

  private buildCreateRequest(path: string, options: any): Uint8Array {
    // Simplified CREATE request
    const encoder = new TextEncoder();
    const pathBytes = encoder.encode(path);

    const buffer = new Uint8Array(57 + pathBytes.length);
    const view = new DataView(buffer.buffer);

    // Structure size
    view.setUint16(0, 57, true);

    // Security flags
    view.setUint8(2, 0);

    // Requested oplock level
    view.setUint8(3, 0);

    // Impersonation level
    view.setUint32(4, 0x02, true); // Impersonation

    // Desired access
    let desiredAccess = 0;
    if (options.read) desiredAccess |= 0x00000001;
    if (options.write) desiredAccess |= 0x00000002;
    if (options.delete) desiredAccess |= 0x00010000;
    view.setUint32(24, desiredAccess, true);

    // File attributes
    view.setUint32(28, options.directory ? 0x10 : 0x80, true);

    // Create disposition
    let disposition = 1; // OPEN_IF
    if (options.create) disposition = 2; // CREATE
    view.setUint32(36, disposition, true);

    // Create options
    view.setUint32(40, options.directory ? 0x00000001 : 0, true);

    // Name offset
    view.setUint16(44, 57 + 64, true);

    // Name length
    view.setUint16(46, pathBytes.length, true);

    // Path
    buffer.set(pathBytes, 57);

    return buffer;
  }

  private buildReadRequest(fileId: Uint8Array, offset: number, length: number): Uint8Array {
    const buffer = new Uint8Array(49);
    const view = new DataView(buffer.buffer);

    // Structure size
    view.setUint16(0, 49, true);

    // Padding
    view.setUint8(2, 0);

    // Reserved
    view.setUint8(3, 0);

    // Length
    view.setUint32(4, length, true);

    // Offset
    view.setBigUint64(8, BigInt(offset), true);

    // File ID
    buffer.set(fileId, 16);

    // Minimum count
    view.setUint32(32, 0, true);

    // Channel
    view.setUint32(36, 0, true);

    // Remaining bytes
    view.setUint32(40, 0, true);

    // Read channel info offset/length
    view.setUint16(44, 0, true);
    view.setUint16(46, 0, true);

    // Buffer
    view.setUint8(48, 0);

    return buffer;
  }

  private buildWriteRequest(fileId: Uint8Array, offset: number, data: Uint8Array): Uint8Array {
    const buffer = new Uint8Array(49 + data.length);
    const view = new DataView(buffer.buffer);

    // Structure size
    view.setUint16(0, 49, true);

    // Data offset
    view.setUint16(2, 49 + 64, true);

    // Length
    view.setUint32(4, data.length, true);

    // Offset
    view.setBigUint64(8, BigInt(offset), true);

    // File ID
    buffer.set(fileId, 16);

    // Channel
    view.setUint32(32, 0, true);

    // Remaining bytes
    view.setUint32(36, 0, true);

    // Write channel info offset/length
    view.setUint16(40, 0, true);
    view.setUint16(42, 0, true);

    // Flags
    view.setUint32(44, 0, true);

    // Data
    buffer.set(data, 49);

    return buffer;
  }

  private buildCloseRequest(fileId: Uint8Array): Uint8Array {
    const buffer = new Uint8Array(24);
    const view = new DataView(buffer.buffer);

    // Structure size
    view.setUint16(0, 24, true);

    // Flags
    view.setUint16(2, 0, true);

    // Reserved
    view.setUint32(4, 0, true);

    // File ID
    buffer.set(fileId, 8);

    return buffer;
  }

  private buildQueryDirectoryRequest(fileId: Uint8Array, continuationToken: Uint8Array | null): Uint8Array {
    // Simplified - actual implementation more complex
    return new Uint8Array(33);
  }

  private buildNTLMSSP(): Uint8Array {
    // Simplified NTLMSSP authentication
    // Real implementation would use crypto for NTLM hashes
    return new Uint8Array(32);
  }

  private async send(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async readResponse(): Promise<Uint8Array> {
    // Read SMB header (64 bytes) + response
    const header = await this.readBytes(64);

    // Parse response length from header
    // Simplified - would parse actual response structure

    return header;
  }

  private async readBytes(length: number): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();
    const buffer = new Uint8Array(length);
    let offset = 0;

    while (offset < length) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const toCopy = Math.min(length - offset, value.length);
      buffer.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    reader.releaseLock();
    return buffer;
  }

  private parseSessionId(response: Uint8Array): bigint {
    return new DataView(response.buffer).getBigUint64(40, true);
  }

  private parseTreeId(response: Uint8Array): number {
    return new DataView(response.buffer).getUint32(36, true);
  }

  private parseFileId(response: Uint8Array): Uint8Array {
    // Extract file ID from CREATE response
    return new Uint8Array(16);
  }

  private parseDirectoryEntries(response: Uint8Array): FileInfo[] {
    // Parse directory query response
    return [];
  }

  private parseReadResponse(response: Uint8Array): Uint8Array {
    // Extract data from READ response
    return new Uint8Array(0);
  }

  private concatenate(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }

    return result;
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
// src/components/SMBClient.tsx

export function SMBClient() {
  const [connected, setConnected] = useState(false);
  const [host, setHost] = useState('192.168.1.100');
  const [share, setShare] = useState('SharedFolder');
  const [username, setUsername] = useState('user');
  const [password, setPassword] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [currentPath, setCurrentPath] = useState('');

  const connect = async () => {
    await fetch('/api/smb/connect', {
      method: 'POST',
      body: JSON.stringify({ host, share, username, password }),
    });

    setConnected(true);
    listFiles('');
  };

  const listFiles = async (path: string) => {
    const response = await fetch('/api/smb/list', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });

    const data = await response.json();
    setFiles(data);
    setCurrentPath(path);
  };

  const downloadFile = async (filename: string) => {
    const response = await fetch('/api/smb/download', {
      method: 'POST',
      body: JSON.stringify({ path: `${currentPath}/${filename}` }),
    });

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  return (
    <div className="smb-client">
      <h2>SMB/CIFS File Sharing</h2>

      {!connected ? (
        <div className="connect">
          <input
            type="text"
            placeholder="Server IP/Hostname"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
          <input
            type="text"
            placeholder="Share Name"
            value={share}
            onChange={(e) => setShare(e.target.value)}
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
          <button onClick={connect}>Connect</button>
        </div>
      ) : (
        <>
          <div className="path">
            <span>\\{host}\{share}\{currentPath}</span>
          </div>

          <div className="file-list">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map(file => (
                  <tr key={file.name}>
                    <td>
                      {file.isDirectory ? '📁' : '📄'} {file.name}
                    </td>
                    <td>{file.isDirectory ? '-' : formatSize(file.size)}</td>
                    <td>{file.modified.toLocaleString()}</td>
                    <td>
                      {!file.isDirectory && (
                        <button onClick={() => downloadFile(file.name)}>
                          Download
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

## Security

### SMB3 Encryption

```
Enabled by default in SMB 3.0+
AES-128-CCM or AES-128-GCM encryption
```

### NTLM Authentication

```
Challenge-response authentication
MD4 hashing (weak, deprecated)
Prefer Kerberos in Active Directory
```

## Testing

### Samba Server

```bash
# Install Samba
apt-get install samba

# /etc/samba/smb.conf
[share]
path = /srv/samba/share
read only = no
guest ok = no
valid users = user

# Create SMB user
smbpasswd -a user

# Start Samba
systemctl start smbd
```

### Windows File Sharing

```
Control Panel → Network Sharing Center
→ Advanced Sharing Settings
→ Enable File Sharing
```

## Resources

- **MS-SMB2**: [Protocol Specification](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-smb2/)
- **Samba**: [Open-source SMB implementation](https://www.samba.org/)
- **SMB Security**: [Best Practices](https://docs.microsoft.com/en-us/windows-server/storage/file-server/smb-security)

## Common Shares

| Share | Description |
|-------|-------------|
| C$ | Administrative share (C: drive) |
| ADMIN$ | Windows directory |
| IPC$ | Inter-Process Communication |
| PRINT$ | Printer drivers |

## Notes

- **Windows native** file sharing protocol
- **Very complex** - one of the most sophisticated protocols
- **SMB 1.0 deprecated** - security vulnerabilities (WannaCry)
- **SMB 3.0+** adds encryption and performance improvements
- **CIFS** is legacy name (Common Internet File System)
- **Port 445** direct SMB, **port 139** SMB over NetBIOS
- **NAS devices** commonly use SMB
- **Active Directory** integration
- **Opportunistic locks** (oplocks) for caching
- **Multichannel** support in SMB 3.0+
