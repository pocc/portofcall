# FTP Protocol Implementation Plan

## Overview

**Protocol:** FTP (File Transfer Protocol)
**Port:** 21 (control), 20 (data in active mode)
**RFC:** [RFC 959](https://tools.ietf.org/html/rfc959)
**Complexity:** Medium-High
**Purpose:** File transfer

FTP is a **classic file transfer protocol**. Despite being legacy, it's still widely used. A browser-based client enables file management, uploads, and downloads from any device.

### Use Cases
- Browse FTP servers
- Upload/download files
- Website file management
- Legacy system integration
- Educational - learn FTP protocol

## Protocol Specification

### FTP Architecture

FTP uses **two connections**:
1. **Control connection** (port 21) - Commands and responses
2. **Data connection** (port 20 or dynamic) - File transfers

### Transfer Modes

**Active Mode**:
- Client opens listening port
- Server connects to client for data transfer
- Problematic with firewalls/NAT

**Passive Mode** (PASV):
- Server opens listening port
- Client connects to server for data transfer
- Works better with firewalls

### FTP Commands

| Command | Description | Example |
|---------|-------------|---------|
| USER | Username | `USER alice` |
| PASS | Password | `PASS secret` |
| PWD | Print working directory | `PWD` |
| CWD | Change directory | `CWD /pub` |
| LIST | List files | `LIST` |
| RETR | Retrieve file | `RETR file.txt` |
| STOR | Store file | `STOR file.txt` |
| DELE | Delete file | `DELE file.txt` |
| MKD | Make directory | `MKD newdir` |
| RMD | Remove directory | `RMD olddir` |
| PASV | Passive mode | `PASV` |
| TYPE | Transfer type | `TYPE I` (binary) |
| QUIT | Disconnect | `QUIT` |

### Response Codes

| Code | Meaning |
|------|---------|
| 150 | File status okay |
| 200 | Command okay |
| 220 | Service ready |
| 226 | Closing data connection |
| 230 | User logged in |
| 331 | Username okay, need password |
| 425 | Can't open data connection |
| 530 | Not logged in |

## Worker Implementation

### FTP Client

```typescript
// src/worker/protocols/ftp/client.ts

import { connect } from 'cloudflare:sockets';

export interface FTPConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface FTPFile {
  name: string;
  size: number;
  type: 'file' | 'directory';
  permissions: string;
  modified: Date;
}

export class FTPClient {
  private controlSocket: Socket;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(private config: FTPConfig) {}

  async connect(): Promise<void> {
    // Control connection
    this.controlSocket = connect(`${this.config.host}:${this.config.port}`);
    await this.controlSocket.opened;

    // Read greeting
    await this.readResponse();

    // Login
    if (this.config.username) {
      await this.send(`USER ${this.config.username}`);
      await this.readResponse();

      if (this.config.password) {
        await this.send(`PASS ${this.config.password}`);
        await this.readResponse();
      }
    } else {
      // Anonymous login
      await this.send('USER anonymous');
      await this.readResponse();

      await this.send('PASS anonymous@');
      await this.readResponse();
    }

    // Binary mode
    await this.send('TYPE I');
    await this.readResponse();
  }

  async pwd(): Promise<string> {
    await this.send('PWD');
    const response = await this.readResponse();

    // Response: 257 "/path" is current directory
    const match = response.match(/"([^"]+)"/);
    return match ? match[1] : '/';
  }

  async cwd(path: string): Promise<void> {
    await this.send(`CWD ${path}`);
    await this.readResponse();
  }

  async list(path: string = ''): Promise<FTPFile[]> {
    // Enter passive mode
    const { host, port } = await this.enterPassiveMode();

    // Send LIST command
    await this.send(`LIST ${path}`);
    await this.readResponse(); // 150 Opening data connection

    // Open data connection
    const dataSocket = connect(`${host}:${port}`);
    await dataSocket.opened;

    // Read file list
    const reader = dataSocket.readable.getReader();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += this.decoder.decode(value, { stream: true });
    }

    await dataSocket.close();

    // Read completion response
    await this.readResponse(); // 226 Transfer complete

    // Parse list
    return this.parseList(buffer);
  }

  async retrieve(filename: string): Promise<Uint8Array> {
    const { host, port } = await this.enterPassiveMode();

    await this.send(`RETR ${filename}`);
    await this.readResponse();

    // Open data connection
    const dataSocket = connect(`${host}:${port}`);
    await dataSocket.opened;

    // Read file data
    const reader = dataSocket.readable.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    await dataSocket.close();
    await this.readResponse(); // 226 Transfer complete

    // Concatenate chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  async store(filename: string, data: Uint8Array): Promise<void> {
    const { host, port } = await this.enterPassiveMode();

    await this.send(`STOR ${filename}`);
    await this.readResponse();

    // Open data connection
    const dataSocket = connect(`${host}:${port}`);
    await dataSocket.opened;

    // Send file data
    const writer = dataSocket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();

    await dataSocket.close();
    await this.readResponse(); // 226 Transfer complete
  }

  async delete(filename: string): Promise<void> {
    await this.send(`DELE ${filename}`);
    await this.readResponse();
  }

  async mkdir(dirname: string): Promise<void> {
    await this.send(`MKD ${dirname}`);
    await this.readResponse();
  }

  async rmdir(dirname: string): Promise<void> {
    await this.send(`RMD ${dirname}`);
    await this.readResponse();
  }

  private async enterPassiveMode(): Promise<{ host: string; port: number }> {
    await this.send('PASV');
    const response = await this.readResponse();

    // Response: 227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)
    const match = response.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);

    if (!match) throw new Error('Failed to parse PASV response');

    const host = `${match[1]}.${match[2]}.${match[3]}.${match[4]}`;
    const port = parseInt(match[5]) * 256 + parseInt(match[6]);

    return { host, port };
  }

  private parseList(data: string): FTPFile[] {
    const files: FTPFile[] = [];
    const lines = data.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      // Parse Unix-style listing
      // -rw-r--r-- 1 user group 1234 Jan 01 12:34 file.txt
      const parts = line.split(/\s+/);

      if (parts.length >= 9) {
        const permissions = parts[0];
        const size = parseInt(parts[4]);
        const name = parts.slice(8).join(' ');

        files.push({
          name,
          size,
          type: permissions[0] === 'd' ? 'directory' : 'file',
          permissions,
          modified: new Date(), // Parse from parts[5-7]
        });
      }
    }

    return files;
  }

  private async send(command: string): Promise<void> {
    const writer = this.controlSocket.writable.getWriter();
    await writer.write(this.encoder.encode(command + '\r\n'));
    writer.releaseLock();
  }

  private async readResponse(): Promise<string> {
    const reader = this.controlSocket.readable.getReader();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += this.decoder.decode(value, { stream: true });

      // FTP responses end with code + space + text
      // Multi-line: code-text\r\ncode text\r\n
      const lines = buffer.split('\r\n');
      const lastLine = lines[lines.length - 2];

      if (lastLine && /^\d{3} /.test(lastLine)) {
        reader.releaseLock();
        return buffer;
      }
    }

    reader.releaseLock();
    return buffer;
  }

  async quit(): Promise<void> {
    await this.send('QUIT');
    await this.readResponse();
    await this.controlSocket.close();
  }
}
```

## Web UI Design

### FTP File Manager

```typescript
// src/components/FTPClient.tsx

export function FTPClient() {
  const [connected, setConnected] = useState(false);
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FTPFile[]>([]);

  const ws = useRef<WebSocket | null>(null);

  const loadDirectory = (path: string) => {
    ws.current?.send(JSON.stringify({
      type: 'list',
      path,
    }));
  };

  const downloadFile = (filename: string) => {
    ws.current?.send(JSON.stringify({
      type: 'retrieve',
      filename,
    }));
  };

  return (
    <div className="ftp-client">
      <div className="toolbar">
        <button onClick={() => loadDirectory(currentPath)}>Refresh</button>
        <span className="path">{currentPath}</span>
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
          {files.map(file => (
            <tr key={file.name}>
              <td>
                {file.type === 'directory' ? '📁' : '📄'} {file.name}
              </td>
              <td>{file.size} bytes</td>
              <td>{file.modified.toLocaleString()}</td>
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
```

## Security

### FTPS (FTP over TLS)

```typescript
// Use port 990 for FTPS (implicit TLS)
// Or use STARTTLS on port 21 (explicit TLS)
```

### Anonymous Access

```typescript
// Many FTP servers allow anonymous login
const config = {
  host: 'ftp.example.com',
  port: 21,
  username: 'anonymous',
  password: 'user@example.com',
};
```

## Testing

### Public FTP Servers

```
ftp.gnu.org (anonymous)
ftp.debian.org (anonymous)
```

### Docker FTP Server

```bash
docker run -d \
  -p 21:21 \
  -p 20:20 \
  -p 21000-21010:21000-21010 \
  -e FTP_USER=testuser \
  -e FTP_PASS=testpass \
  fauria/vsftpd
```

## Resources

- **RFC 959**: [FTP Protocol](https://tools.ietf.org/html/rfc959)
- **RFC 2228**: [FTP Security Extensions (FTPS)](https://tools.ietf.org/html/rfc2228)

## Next Steps

1. Implement FTP client with passive mode
2. Build file manager UI
3. Add upload/download progress
4. Support FTPS (FTP over TLS)
5. Add resume capability
6. Support active mode (if needed)
7. Create bookmark manager

## Notes

- **Passive mode** is essential for firewalls/NAT
- FTP is **legacy** but still widely used
- Consider **SFTP** (SSH-based) as modern alternative
- **FTPS** (FTP+TLS) is more secure than plain FTP
- Active mode requires opening ports on client side (challenging in browser)
