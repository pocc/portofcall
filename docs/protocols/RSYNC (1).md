# Rsync Protocol Implementation Plan

## Overview

**Protocol:** Rsync
**Port:** 873 (rsync daemon), 22 (rsync over SSH)
**Specification:** [Rsync Technical Report](https://rsync.samba.org/tech_report/)
**Complexity:** Very High
**Purpose:** Efficient file synchronization and transfer

Rsync enables **delta-transfer file synchronization** - efficiently sync files by transferring only differences, ideal for backups and remote synchronization from the browser.

### Use Cases
- File backup and synchronization
- Website deployment
- Data replication
- Mirror management
- Incremental backups
- Remote file updates

## Protocol Specification

### Delta-Transfer Algorithm

Rsync's efficiency comes from transferring only file differences:

```
1. Client requests file list from server
2. Server sends file metadata (size, mtime, permissions)
3. For each file:
   a. Client generates checksums of local blocks
   b. Server compares with remote file
   c. Server sends only non-matching blocks
   d. Client reconstructs file
```

### Protocol Phases

**Phase 1: Handshake**
```
Client → Server: Protocol version
Server → Client: Protocol version
Client → Server: Module name
Server → Client: MOTD, module info
```

**Phase 2: File List Exchange**
```
Client → Server: Filter patterns
Server → Client: File list with metadata
```

**Phase 3: Delta Transfer**
```
For each file:
  Client → Server: Block checksums
  Server → Client: Matching blocks + new data
```

### File List Entry

```
flags: uint8
mode: uint32
uid: uint32
gid: uint32
size: int64
mtime: int64
name_length: uint8
name: string
```

### Checksum Algorithm

**Rolling checksum** (fast):
```
a = sum of bytes in block (mod 2^16)
b = sum of a values (mod 2^16)
checksum = (b << 16) | a
```

**Strong checksum** (MD5/MD4):
```
MD4 hash of block data
```

## Worker Implementation

```typescript
// src/worker/protocols/rsync/client.ts

import { connect } from 'cloudflare:sockets';

export interface RsyncConfig {
  host: string;
  port?: number;
  module?: string;
  username?: string;
  password?: string;
}

export interface FileInfo {
  name: string;
  mode: number;
  size: number;
  mtime: Date;
  uid: number;
  gid: number;
}

export interface BlockChecksum {
  offset: number;
  rolling: number;
  md4: Uint8Array;
}

export class RsyncClient {
  private socket: any;
  private version = 30; // Protocol version

  constructor(private config: RsyncConfig) {}

  async connect(): Promise<void> {
    const port = this.config.port || 873;
    this.socket = connect(`${this.config.host}:${port}`);
    await this.socket.opened;

    // Protocol handshake
    await this.handshake();
  }

  private async handshake(): Promise<void> {
    // Send protocol version
    await this.send(`@RSYNCD: ${this.version}\n`);

    // Read server version
    const serverVersion = await this.readLine();
    console.log('Server version:', serverVersion);

    // Send module name
    const module = this.config.module || '';
    await this.send(`${module}\n`);

    // Read MOTD and auth challenge if needed
    while (true) {
      const line = await this.readLine();

      if (line.startsWith('@RSYNCD: OK')) {
        break;
      } else if (line.startsWith('@RSYNCD: AUTHREQD')) {
        await this.authenticate();
        break;
      } else if (line.startsWith('@RSYNCD: EXIT')) {
        throw new Error('Server rejected connection');
      }
    }
  }

  private async authenticate(): Promise<void> {
    if (!this.config.username || !this.config.password) {
      throw new Error('Authentication required but no credentials provided');
    }

    // Read challenge
    const challenge = await this.readLine();

    // Generate response (MD4 based)
    const response = this.generateAuthResponse(
      this.config.username,
      this.config.password,
      challenge
    );

    await this.send(`${this.config.username} ${response}\n`);

    // Wait for OK
    const result = await this.readLine();
    if (!result.startsWith('@RSYNCD: OK')) {
      throw new Error('Authentication failed');
    }
  }

  async list(path: string = ''): Promise<FileInfo[]> {
    // Send list command
    await this.sendCommand('--list-only', path);

    // Read file list
    const files: FileInfo[] = [];

    while (true) {
      const entry = await this.readFileEntry();
      if (!entry) break;
      files.push(entry);
    }

    return files;
  }

  async sync(
    localPath: string,
    remotePath: string,
    options: {
      recursive?: boolean;
      preserve?: boolean;
      compress?: boolean;
      delete?: boolean;
    } = {}
  ): Promise<void> {
    // Build command args
    const args: string[] = [];

    if (options.recursive) args.push('-r');
    if (options.preserve) args.push('-p');
    if (options.compress) args.push('-z');
    if (options.delete) args.push('--delete');

    args.push(remotePath);
    args.push(localPath);

    // Send sync command
    await this.sendCommand(...args);

    // Process file list
    const files = await this.receiveFileList();

    // Transfer files
    for (const file of files) {
      await this.transferFile(file, localPath);
    }
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    await this.sync(localPath, remotePath, { recursive: true });
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    // Rsync client can also send files
    // This requires implementing the sender role

    throw new Error('Upload not yet implemented');
  }

  private async transferFile(file: FileInfo, basePath: string): Promise<void> {
    // Check if local file exists
    const localFile = await this.getLocalFile(`${basePath}/${file.name}`);

    if (localFile && localFile.mtime >= file.mtime && localFile.size === file.size) {
      // File is up to date
      return;
    }

    // Generate block checksums of local file
    const checksums = localFile ? await this.generateBlockChecksums(localFile) : [];

    // Send checksums to server
    await this.sendBlockChecksums(checksums);

    // Receive delta data
    const deltaData = await this.receiveDeltaData();

    // Reconstruct file
    await this.reconstructFile(file, localFile, deltaData, `${basePath}/${file.name}`);
  }

  private async generateBlockChecksums(file: any): Promise<BlockChecksum[]> {
    const blockSize = 700; // Typical block size
    const checksums: BlockChecksum[] = [];

    const data = file.data; // Would read actual file data

    for (let offset = 0; offset < data.length; offset += blockSize) {
      const block = data.slice(offset, offset + blockSize);

      checksums.push({
        offset,
        rolling: this.rollingChecksum(block),
        md4: this.md4Hash(block),
      });
    }

    return checksums;
  }

  private rollingChecksum(data: Uint8Array): number {
    let a = 0;
    let b = 0;

    for (let i = 0; i < data.length; i++) {
      a = (a + data[i]) & 0xFFFF;
      b = (b + a) & 0xFFFF;
    }

    return (b << 16) | a;
  }

  private md4Hash(data: Uint8Array): Uint8Array {
    // Would use actual MD4 implementation
    // Simplified for example
    return new Uint8Array(16);
  }

  private async sendBlockChecksums(checksums: BlockChecksum[]): Promise<void> {
    // Send checksum count
    await this.sendInt(checksums.length);

    // Send each checksum
    for (const checksum of checksums) {
      await this.sendInt(checksum.rolling);
      await this.send(checksum.md4);
    }
  }

  private async receiveDeltaData(): Promise<any> {
    // Receive delta instructions
    // Format: mix of literal data and references to existing blocks

    const instructions: any[] = [];

    while (true) {
      const opcode = await this.readByte();

      if (opcode === 0) break; // End marker

      if (opcode & 0x80) {
        // Block reference
        const blockIndex = opcode & 0x7F;
        instructions.push({ type: 'block', index: blockIndex });
      } else {
        // Literal data
        const length = opcode;
        const data = await this.readBytes(length);
        instructions.push({ type: 'data', data });
      }
    }

    return instructions;
  }

  private async reconstructFile(
    fileInfo: FileInfo,
    localFile: any,
    deltaData: any[],
    outputPath: string
  ): Promise<void> {
    // Reconstruct file from local blocks and delta data
    const output: Uint8Array[] = [];

    for (const instruction of deltaData) {
      if (instruction.type === 'block') {
        // Copy block from local file
        const blockData = localFile.getBlock(instruction.index);
        output.push(blockData);
      } else {
        // Literal data
        output.push(instruction.data);
      }
    }

    // Write reconstructed file
    const finalData = this.concatenate(output);
    await this.writeFile(outputPath, finalData);

    // Set file metadata
    await this.setFileMetadata(outputPath, fileInfo);
  }

  private async sendCommand(...args: string[]): Promise<void> {
    const command = args.join(' ') + '\n';
    await this.send(command);
  }

  private async receiveFileList(): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    while (true) {
      const entry = await this.readFileEntry();
      if (!entry) break;
      files.push(entry);
    }

    return files;
  }

  private async readFileEntry(): Promise<FileInfo | null> {
    // Read file list entry from stream
    // Simplified - actual format is more complex

    const flags = await this.readByte();
    if (flags === 0) return null;

    const mode = await this.readInt();
    const size = await this.readInt64();
    const mtime = await this.readInt();
    const nameLen = await this.readByte();
    const name = await this.readString(nameLen);

    return {
      name,
      mode,
      size,
      mtime: new Date(mtime * 1000),
      uid: 0,
      gid: 0,
    };
  }

  private async send(data: string | Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();

    if (typeof data === 'string') {
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(data));
    } else {
      await writer.write(data);
    }

    writer.releaseLock();
  }

  private async readLine(): Promise<string> {
    // Read until newline
    const reader = this.socket.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!buffer.includes('\n')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }

    reader.releaseLock();

    return buffer.split('\n')[0];
  }

  private async readByte(): Promise<number> {
    const reader = this.socket.readable.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    return value[0];
  }

  private async readBytes(length: number): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();
    const buffer = new Uint8Array(length);
    let offset = 0;

    while (offset < length) {
      const { value } = await reader.read();
      const toCopy = Math.min(length - offset, value.length);
      buffer.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    reader.releaseLock();
    return buffer;
  }

  private async readInt(): Promise<number> {
    const bytes = await this.readBytes(4);
    return new DataView(bytes.buffer).getInt32(0, true);
  }

  private async readInt64(): Promise<number> {
    const bytes = await this.readBytes(8);
    return Number(new DataView(bytes.buffer).getBigInt64(0, true));
  }

  private async readString(length: number): Promise<string> {
    const bytes = await this.readBytes(length);
    return new TextDecoder().decode(bytes);
  }

  private async sendInt(value: number): Promise<void> {
    const buffer = new Uint8Array(4);
    new DataView(buffer.buffer).setInt32(0, value, true);
    await this.send(buffer);
  }

  private generateAuthResponse(username: string, password: string, challenge: string): string {
    // MD4-based authentication
    // Simplified for example
    return 'auth-response-hash';
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

  private async getLocalFile(path: string): Promise<any> {
    // Would read local file
    return null;
  }

  private async writeFile(path: string, data: Uint8Array): Promise<void> {
    // Would write file
  }

  private async setFileMetadata(path: string, info: FileInfo): Promise<void> {
    // Would set file permissions, mtime, etc.
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
// src/components/RsyncClient.tsx

export function RsyncClient() {
  const [connected, setConnected] = useState(false);
  const [host, setHost] = useState('rsync://backup.example.com/');
  const [module, setModule] = useState('backup');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [syncing, setSyncing] = useState(false);

  const connect = async () => {
    await fetch('/api/rsync/connect', {
      method: 'POST',
      body: JSON.stringify({ host, module }),
    });

    setConnected(true);
    listFiles();
  };

  const listFiles = async () => {
    const response = await fetch('/api/rsync/list', {
      method: 'POST',
      body: JSON.stringify({ path: '' }),
    });

    const data = await response.json();
    setFiles(data);
  };

  const syncFile = async (remotePath: string) => {
    setSyncing(true);

    await fetch('/api/rsync/sync', {
      method: 'POST',
      body: JSON.stringify({
        remotePath,
        localPath: '/downloads/',
      }),
    });

    setSyncing(false);
    alert('Sync complete');
  };

  return (
    <div className="rsync-client">
      <h2>Rsync Client</h2>

      {!connected ? (
        <div className="connect">
          <input
            type="text"
            placeholder="rsync://server/module"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
          <input
            type="text"
            placeholder="Module name"
            value={module}
            onChange={(e) => setModule(e.target.value)}
          />
          <button onClick={connect}>Connect</button>
        </div>
      ) : (
        <>
          <div className="file-list">
            <h3>Remote Files</h3>
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
                    <td>{file.name}</td>
                    <td>{formatSize(file.size)}</td>
                    <td>{file.mtime.toLocaleString()}</td>
                    <td>
                      <button
                        onClick={() => syncFile(file.name)}
                        disabled={syncing}
                      >
                        Sync
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="info">
        <h3>About Rsync</h3>
        <ul>
          <li>Efficient delta-transfer algorithm</li>
          <li>Only transfers file differences</li>
          <li>Preserves permissions, ownership, timestamps</li>
          <li>Compression support (-z)</li>
          <li>Can use SSH for secure transport</li>
        </ul>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
```

## Security

### Authentication

```bash
# Create rsyncd secrets file
echo "username:password" > /etc/rsyncd.secrets
chmod 600 /etc/rsyncd.secrets
```

### Rsync over SSH

```bash
# More secure than rsync daemon
rsync -avz -e ssh user@host:/path /local/path
```

## Testing

### Rsync Daemon

```bash
# /etc/rsyncd.conf
[backup]
path = /data/backup
comment = Backup directory
read only = yes
list = yes
auth users = user
secrets file = /etc/rsyncd.secrets

# Start daemon
rsync --daemon

# Test
rsync rsync://localhost/backup/
```

### Docker Rsync Server

```bash
# Rsync server
docker run -d \
  -p 873:873 \
  -v /data:/data \
  --name rsync \
  axiom/rsync-server

# Sync to server
rsync -avz /local/path rsync://localhost/backup/
```

## Resources

- **Rsync**: [Official documentation](https://rsync.samba.org/)
- **Algorithm**: [Technical Report](https://rsync.samba.org/tech_report/)
- **Man Page**: [rsync(1)](https://linux.die.net/man/1/rsync)

## Common Rsync Options

| Option | Description |
|--------|-------------|
| -a | Archive mode (recursive, preserve all) |
| -v | Verbose output |
| -z | Compress during transfer |
| -r | Recursive |
| -p | Preserve permissions |
| -t | Preserve times |
| -u | Update (skip newer files) |
| --delete | Delete extraneous files |
| --exclude | Exclude pattern |
| -n | Dry run |
| -e ssh | Use SSH transport |

## Example Commands

```bash
# Sync directory
rsync -avz source/ dest/

# Sync to remote via SSH
rsync -avz -e ssh /local/ user@host:/remote/

# Sync from rsync daemon
rsync -avz rsync://server/module/ /local/

# Exclude files
rsync -avz --exclude='*.tmp' source/ dest/

# Delete extraneous files
rsync -avz --delete source/ dest/

# Dry run
rsync -avzn source/ dest/
```

## Notes

- **Delta-transfer** - only transfers file differences
- **Very efficient** - minimal bandwidth usage
- **Complex protocol** - one of the most sophisticated
- **Bidirectional** - can send or receive
- **Incremental** - ideal for backups
- **Checksums** - verifies data integrity
- **Compression** - optional gzip compression
- **SSH transport** - recommended for security
- **Daemon mode** - port 873
- **Widely used** - standard for backups and mirrors
