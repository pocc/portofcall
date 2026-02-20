# SFTP Protocol Implementation Plan

## Overview

**Protocol:** SFTP (SSH File Transfer Protocol)
**Port:** 22 (over SSH)
**RFC:** [draft-ietf-secsh-filexfer](https://datatracker.ietf.org/doc/html/draft-ietf-secsh-filexfer-02)
**Complexity:** High
**Purpose:** Secure file transfer over SSH

SFTP provides **secure file transfer** via SSH. Unlike FTP, it's fully encrypted and uses a single port, making it the modern standard for secure file operations.

### Use Cases
- Secure file upload/download
- Remote file management
- Website deployment
- Backup operations
- File synchronization
- Cloud storage access

## Protocol Specification

### SFTP over SSH

SFTP runs as an SSH subsystem:
```
SSH Connection → Request "sftp" subsystem → SFTP protocol
```

### SFTP Packet Format

```
┌────────────────────────────────┐
│ Length (uint32)                 │
│ Type (byte)                     │
│ Request ID (uint32)             │
│ ... type-specific data ...      │
└────────────────────────────────┘
```

### Packet Types

| Type | Value | Description |
|------|-------|-------------|
| SSH_FXP_INIT | 1 | Initialize |
| SSH_FXP_VERSION | 2 | Version response |
| SSH_FXP_OPEN | 3 | Open file |
| SSH_FXP_CLOSE | 4 | Close file |
| SSH_FXP_READ | 5 | Read file |
| SSH_FXP_WRITE | 6 | Write file |
| SSH_FXP_OPENDIR | 11 | Open directory |
| SSH_FXP_READDIR | 12 | Read directory |
| SSH_FXP_STAT | 17 | Get file attributes |

## Worker Implementation

### Use ssh2-sftp-client

```bash
npm install ssh2 ssh2-sftp-client
```

```typescript
// src/worker/protocols/sftp/client.ts

import SFTPClient from 'ssh2-sftp-client';
import { Client as SSHClient } from 'ssh2';
import { connect as tcpConnect } from 'cloudflare:sockets';

export interface SFTPConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export interface FileInfo {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifyTime: Date;
  permissions: number;
}

export class SFTPClientWrapper {
  private sftp: SFTPClient;
  private ssh: SSHClient;

  constructor(private config: SFTPConfig) {
    this.sftp = new SFTPClient();
    this.ssh = new SSHClient();
  }

  async connect(): Promise<void> {
    // Create TCP socket
    const socket = tcpConnect(`${this.config.host}:${this.config.port}`);
    await socket.opened;

    await this.sftp.connect({
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      password: this.config.password,
      privateKey: this.config.privateKey,
      sock: socket as any,
    });
  }

  async list(remotePath: string = '.'): Promise<FileInfo[]> {
    const files = await this.sftp.list(remotePath);

    return files.map(file => ({
      name: file.name,
      type: file.type as 'file' | 'directory' | 'symlink',
      size: file.size,
      modifyTime: new Date(file.modifyTime),
      permissions: file.rights?.user || 0,
    }));
  }

  async get(remotePath: string): Promise<Buffer> {
    return this.sftp.get(remotePath) as Promise<Buffer>;
  }

  async put(localData: Buffer | string, remotePath: string): Promise<void> {
    await this.sftp.put(localData, remotePath);
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.sftp.mkdir(remotePath);
  }

  async rmdir(remotePath: string): Promise<void> {
    await this.sftp.rmdir(remotePath);
  }

  async delete(remotePath: string): Promise<void> {
    await this.sftp.delete(remotePath);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.sftp.rename(oldPath, newPath);
  }

  async stat(remotePath: string): Promise<FileInfo> {
    const stats = await this.sftp.stat(remotePath);

    return {
      name: remotePath.split('/').pop() || '',
      type: stats.isDirectory ? 'directory' : 'file',
      size: stats.size,
      modifyTime: new Date(stats.mtime * 1000),
      permissions: stats.mode,
    };
  }

  async close(): Promise<void> {
    await this.sftp.end();
  }
}
```

## Web UI Design

```typescript
// src/components/SFTPClient.tsx

export function SFTPClient() {
  const [connected, setConnected] = useState(false);
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const ws = useRef<WebSocket | null>(null);

  const loadDirectory = (path: string) => {
    ws.current?.send(JSON.stringify({
      type: 'list',
      path,
    }));
    setCurrentPath(path);
  };

  const downloadFile = async (filename: string) => {
    const response = await fetch('/api/sftp/download', {
      method: 'POST',
      body: JSON.stringify({
        path: `${currentPath}/${filename}`,
      }),
    });

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const handleUpload = async () => {
    if (!uploadFile) return;

    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('path', currentPath);

    await fetch('/api/sftp/upload', {
      method: 'POST',
      body: formData,
    });

    loadDirectory(currentPath);
  };

  return (
    <div className="sftp-client">
      <div className="toolbar">
        <button onClick={() => loadDirectory(currentPath)}>Refresh</button>
        <span className="path">{currentPath}</span>
        <input
          type="file"
          onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
        />
        <button onClick={handleUpload} disabled={!uploadFile}>
          Upload
        </button>
      </div>

      <table className="file-list">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Modified</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr onClick={() => loadDirectory(currentPath + '/..')}>
            <td>📁 ..</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
          </tr>

          {files.map(file => (
            <tr key={file.name}>
              <td>
                <span
                  onClick={() => {
                    if (file.type === 'directory') {
                      loadDirectory(`${currentPath}/${file.name}`);
                    }
                  }}
                  className={file.type === 'directory' ? 'clickable' : ''}
                >
                  {file.type === 'directory' ? '📁' : '📄'} {file.name}
                </span>
              </td>
              <td>{file.type === 'file' ? formatSize(file.size) : '-'}</td>
              <td>{file.modifyTime.toLocaleString()}</td>
              <td>
                {file.type === 'file' && (
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
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

## Security

### SSH Key Authentication

```typescript
// Prefer key-based auth over passwords
const config = {
  host: 'sftp.example.com',
  port: 22,
  username: 'user',
  privateKey: fs.readFileSync('~/.ssh/id_rsa'),
  passphrase: 'key_passphrase',
};
```

### Path Validation

```typescript
function validatePath(path: string): boolean {
  // Prevent path traversal
  return !path.includes('../') && !path.includes('..\\');
}
```

## Testing

```bash
# OpenSSH server with SFTP
docker run -d \
  -p 2222:22 \
  -e USER_NAME=testuser \
  -e USER_PASSWORD=testpass \
  atmoz/sftp testuser:testpass:::upload
```

## Resources

- **SFTP Draft**: [SSH File Transfer Protocol](https://datatracker.ietf.org/doc/html/draft-ietf-secsh-filexfer-02)
- **ssh2**: [Node.js SSH2 library](https://github.com/mscdex/ssh2)
- **ssh2-sftp-client**: [SFTP wrapper](https://github.com/theophilusx/ssh2-sftp-client)

## Notes

- **Encrypted** via SSH (unlike FTP)
- Uses **single port** (22)
- **Not the same as FTPS** (FTP over SSL)
- Modern standard for **secure file transfer**
- **SSH subsystem** (not separate protocol)
