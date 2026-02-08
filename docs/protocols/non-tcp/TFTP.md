# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**Protocol:** TFTP (Trivial File Transfer Protocol)
**Port:** 69 (UDP)
**RFC:** [RFC 1350](https://tools.ietf.org/html/rfc1350)
**Complexity:** Low
**Purpose:** Simple file transfer (no authentication)

TFTP enables **simple file transfer** - download and upload files using a minimal UDP-based protocol, commonly used for network booting and firmware updates.

### Use Cases
- Network device firmware updates
- PXE network booting
- Configuration file transfers
- Diskless workstation booting
- Simple file sharing
- Embedded systems file access

## Protocol Specification

### UDP-Based Protocol

TFTP uses **UDP on port 69** for initial connection. Each transfer uses a new random port.

### Packet Types

| Opcode | Type | Description |
|--------|------|-------------|
| 1 | RRQ | Read Request |
| 2 | WRQ | Write Request |
| 3 | DATA | Data packet |
| 4 | ACK | Acknowledgment |
| 5 | ERROR | Error message |

### Packet Formats

#### Read Request (RRQ) / Write Request (WRQ)
```
 2 bytes     string    1 byte    string   1 byte
┌────────┬────────────┬───────┬──────────┬───────┐
│ Opcode │  Filename  │   0   │   Mode   │   0   │
└────────┴────────────┴───────┴──────────┴───────┘
```

#### Data Packet
```
 2 bytes     2 bytes      n bytes
┌────────┬────────────┬────────────┐
│ Opcode │ Block #    │   Data     │
└────────┴────────────┴────────────┘
```

#### Acknowledgment (ACK)
```
 2 bytes     2 bytes
┌────────┬────────────┐
│ Opcode │  Block #   │
└────────┴────────────┘
```

#### Error
```
 2 bytes     2 bytes      string    1 byte
┌────────┬────────────┬────────────┬───────┐
│ Opcode │ ErrorCode  │  ErrMsg    │   0   │
└────────┴────────────┴────────────┴───────┘
```

### Transfer Modes

- **netascii**: Text mode (line ending conversion)
- **octet**: Binary mode (raw bytes)
- **mail**: Obsolete (RFC 1350 only)

### Block Size

- Default: **512 bytes** per data packet
- Last packet < 512 bytes indicates end of file
- Block numbers wrap after 65535

## Worker Implementation

```typescript
// src/worker/protocols/tftp/client.ts

// Note: TFTP uses UDP, which is not directly supported by Cloudflare Workers
// This implementation would require a UDP proxy or use TCP-based alternatives

export interface TFTPConfig {
  host: string;
  port?: number;
}

export enum TFTPOpcode {
  RRQ = 1,   // Read Request
  WRQ = 2,   // Write Request
  DATA = 3,  // Data
  ACK = 4,   // Acknowledgment
  ERROR = 5, // Error
}

export enum TFTPMode {
  NetASCII = 'netascii',
  Octet = 'octet',
}

export enum TFTPError {
  NotDefined = 0,
  FileNotFound = 1,
  AccessViolation = 2,
  DiskFull = 3,
  IllegalOperation = 4,
  UnknownTID = 5,
  FileExists = 6,
  NoSuchUser = 7,
}

export class TFTPClient {
  private readonly BLOCK_SIZE = 512;
  private readonly DEFAULT_PORT = 69;

  constructor(private config: TFTPConfig) {}

  async download(filename: string, mode: TFTPMode = TFTPMode.Octet): Promise<Uint8Array> {
    // Since Workers don't support UDP natively, this would need a proxy
    // For demonstration, showing the protocol logic

    const port = this.config.port ?? this.DEFAULT_PORT;

    // Build RRQ packet
    const rrq = this.buildRRQ(filename, mode);

    // Send RRQ and receive DATA packets
    // In practice, this would use a UDP proxy or TCP tunnel

    const blocks: Uint8Array[] = [];
    let blockNumber = 1;

    // Simplified flow (actual implementation needs UDP socket)
    while (true) {
      // Wait for DATA packet
      const dataPacket = await this.receiveData();

      if (!dataPacket) break;

      const { block, data } = this.parseData(dataPacket);

      if (block !== blockNumber) {
        throw new Error(`Expected block ${blockNumber}, got ${block}`);
      }

      blocks.push(data);

      // Send ACK
      const ack = this.buildACK(blockNumber);
      await this.sendPacket(ack);

      // Last packet?
      if (data.length < this.BLOCK_SIZE) {
        break;
      }

      blockNumber++;
    }

    // Concatenate all blocks
    const totalLength = blocks.reduce((sum, block) => sum + block.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const block of blocks) {
      result.set(block, offset);
      offset += block.length;
    }

    return result;
  }

  async upload(filename: string, data: Uint8Array, mode: TFTPMode = TFTPMode.Octet): Promise<void> {
    // Build WRQ packet
    const wrq = this.buildWRQ(filename, mode);

    // Send WRQ
    await this.sendPacket(wrq);

    // Wait for ACK 0
    await this.receiveACK(0);

    // Send data blocks
    let blockNumber = 1;
    let offset = 0;

    while (offset < data.length) {
      const blockData = data.slice(offset, offset + this.BLOCK_SIZE);
      const dataPacket = this.buildDATA(blockNumber, blockData);

      await this.sendPacket(dataPacket);

      // Wait for ACK
      await this.receiveACK(blockNumber);

      offset += this.BLOCK_SIZE;
      blockNumber++;

      // Last block?
      if (blockData.length < this.BLOCK_SIZE) {
        break;
      }
    }
  }

  private buildRRQ(filename: string, mode: TFTPMode): Uint8Array {
    return this.buildRequest(TFTPOpcode.RRQ, filename, mode);
  }

  private buildWRQ(filename: string, mode: TFTPMode): Uint8Array {
    return this.buildRequest(TFTPOpcode.WRQ, filename, mode);
  }

  private buildRequest(opcode: TFTPOpcode, filename: string, mode: TFTPMode): Uint8Array {
    const encoder = new TextEncoder();
    const filenameBytes = encoder.encode(filename);
    const modeBytes = encoder.encode(mode);

    const packet = new Uint8Array(2 + filenameBytes.length + 1 + modeBytes.length + 1);
    const view = new DataView(packet.buffer);

    view.setUint16(0, opcode);
    packet.set(filenameBytes, 2);
    packet[2 + filenameBytes.length] = 0;
    packet.set(modeBytes, 2 + filenameBytes.length + 1);
    packet[2 + filenameBytes.length + 1 + modeBytes.length] = 0;

    return packet;
  }

  private buildDATA(blockNumber: number, data: Uint8Array): Uint8Array {
    const packet = new Uint8Array(4 + data.length);
    const view = new DataView(packet.buffer);

    view.setUint16(0, TFTPOpcode.DATA);
    view.setUint16(2, blockNumber);
    packet.set(data, 4);

    return packet;
  }

  private buildACK(blockNumber: number): Uint8Array {
    const packet = new Uint8Array(4);
    const view = new DataView(packet.buffer);

    view.setUint16(0, TFTPOpcode.ACK);
    view.setUint16(2, blockNumber);

    return packet;
  }

  private buildERROR(errorCode: TFTPError, errorMsg: string): Uint8Array {
    const encoder = new TextEncoder();
    const msgBytes = encoder.encode(errorMsg);

    const packet = new Uint8Array(4 + msgBytes.length + 1);
    const view = new DataView(packet.buffer);

    view.setUint16(0, TFTPOpcode.ERROR);
    view.setUint16(2, errorCode);
    packet.set(msgBytes, 4);
    packet[4 + msgBytes.length] = 0;

    return packet;
  }

  private parseData(packet: Uint8Array): { block: number; data: Uint8Array } {
    const view = new DataView(packet.buffer);
    const opcode = view.getUint16(0);

    if (opcode !== TFTPOpcode.DATA) {
      throw new Error(`Expected DATA packet, got opcode ${opcode}`);
    }

    const block = view.getUint16(2);
    const data = packet.slice(4);

    return { block, data };
  }

  private parseACK(packet: Uint8Array): number {
    const view = new DataView(packet.buffer);
    const opcode = view.getUint16(0);

    if (opcode !== TFTPOpcode.ACK) {
      throw new Error(`Expected ACK packet, got opcode ${opcode}`);
    }

    return view.getUint16(2);
  }

  private parseError(packet: Uint8Array): { code: TFTPError; message: string } {
    const view = new DataView(packet.buffer);
    const opcode = view.getUint16(0);

    if (opcode !== TFTPOpcode.ERROR) {
      throw new Error(`Expected ERROR packet, got opcode ${opcode}`);
    }

    const code = view.getUint16(2) as TFTPError;
    const decoder = new TextDecoder();
    const message = decoder.decode(packet.slice(4, -1)); // Remove trailing null

    return { code, message };
  }

  // These methods would interact with UDP socket in a real implementation
  private async sendPacket(packet: Uint8Array): Promise<void> {
    // UDP send implementation
    throw new Error('UDP not directly supported in Workers - use proxy');
  }

  private async receiveData(): Promise<Uint8Array | null> {
    // UDP receive implementation
    throw new Error('UDP not directly supported in Workers - use proxy');
  }

  private async receiveACK(expectedBlock: number): Promise<void> {
    // UDP receive and validate ACK
    throw new Error('UDP not directly supported in Workers - use proxy');
  }
}

// TFTP Server (simplified)

export class TFTPServer {
  private files = new Map<string, Uint8Array>();

  constructor(private port: number = 69) {}

  addFile(filename: string, data: Uint8Array): void {
    this.files.set(filename, data);
  }

  async start(): Promise<void> {
    // Listen for UDP packets on port 69
    // Handle RRQ and WRQ requests
    console.log(`TFTP server started on port ${this.port}`);
  }

  private handleRRQ(filename: string, mode: TFTPMode, clientAddr: string, clientPort: number): void {
    const data = this.files.get(filename);

    if (!data) {
      this.sendError(TFTPError.FileNotFound, 'File not found', clientAddr, clientPort);
      return;
    }

    this.sendFile(data, clientAddr, clientPort);
  }

  private handleWRQ(filename: string, mode: TFTPMode, clientAddr: string, clientPort: number): void {
    // Send ACK 0 to begin transfer
    this.sendACK(0, clientAddr, clientPort);

    // Receive file blocks
    this.receiveFile(filename, clientAddr, clientPort);
  }

  private sendFile(data: Uint8Array, clientAddr: string, clientPort: number): void {
    // Send DATA packets with ACK synchronization
  }

  private receiveFile(filename: string, clientAddr: string, clientPort: number): void {
    // Receive DATA packets and send ACKs
  }

  private sendACK(blockNumber: number, clientAddr: string, clientPort: number): void {
    // Send ACK packet
  }

  private sendError(code: TFTPError, message: string, clientAddr: string, clientPort: number): void {
    // Send ERROR packet
  }
}
```

## Web UI Design

```typescript
// src/components/TFTPClient.tsx

export function TFTPClient() {
  const [host, setHost] = useState('tftp.example.com');
  const [port, setPort] = useState(69);
  const [filename, setFilename] = useState('config.txt');
  const [mode, setMode] = useState<TFTPMode>(TFTPMode.Octet);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');

  const download = async () => {
    setStatus('Downloading...');

    try {
      const response = await fetch('/api/tftp/download', {
        method: 'POST',
        body: JSON.stringify({ host, port, filename, mode }),
      });

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();

      setStatus('✓ Download complete');
    } catch (error) {
      setStatus(`✗ Error: ${error.message}`);
    }
  };

  const upload = async () => {
    if (!uploadFile) return;

    setStatus('Uploading...');

    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('host', host);
    formData.append('port', String(port));
    formData.append('filename', filename);
    formData.append('mode', mode);

    try {
      await fetch('/api/tftp/upload', {
        method: 'POST',
        body: formData,
      });

      setStatus('✓ Upload complete');
    } catch (error) {
      setStatus(`✗ Error: ${error.message}`);
    }
  };

  return (
    <div className="tftp-client">
      <h2>TFTP Client</h2>

      <div className="config">
        <input
          type="text"
          placeholder="TFTP Server Host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          type="number"
          placeholder="Port"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
        />
      </div>

      <div className="transfer">
        <h3>Download</h3>
        <input
          type="text"
          placeholder="Remote filename"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
        />
        <select value={mode} onChange={(e) => setMode(e.target.value as TFTPMode)}>
          <option value={TFTPMode.Octet}>Binary (octet)</option>
          <option value={TFTPMode.NetASCII}>Text (netascii)</option>
        </select>
        <button onClick={download}>Download</button>
      </div>

      <div className="transfer">
        <h3>Upload</h3>
        <input
          type="file"
          onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
        />
        <button onClick={upload} disabled={!uploadFile}>
          Upload
        </button>
      </div>

      {status && (
        <div className={`status ${status.startsWith('✓') ? 'success' : 'error'}`}>
          {status}
        </div>
      )}

      <div className="info">
        <h3>TFTP Information</h3>
        <ul>
          <li><strong>Protocol:</strong> UDP-based file transfer</li>
          <li><strong>Port:</strong> 69 (UDP)</li>
          <li><strong>Block Size:</strong> 512 bytes</li>
          <li><strong>No Authentication:</strong> Open access</li>
          <li><strong>Common Uses:</strong> Firmware updates, network booting</li>
        </ul>
      </div>

      <div className="warning">
        <h3>⚠️ Security Warning</h3>
        <p>
          TFTP has <strong>no authentication or encryption</strong>.
          Do not use for sensitive data. Consider SFTP or FTPS instead.
        </p>
      </div>
    </div>
  );
}
```

## Security

### No Security Features

TFTP has **no security**:
- No authentication
- No encryption
- No access control
- Anyone can read/write if server allows

### Security Best Practices

```bash
# Restrict to local network only
# Use firewall rules to block external access

# Read-only mode
tftpd --secure --readonly /tftpboot

# Separate directory per client
tftpd --secure --map-file /etc/tftpd.map
```

## Testing

### tftpd (Linux)

```bash
# Install tftp server
apt-get install tftpd-hpa

# Configure
# /etc/default/tftpd-hpa:
TFTP_USERNAME="tftp"
TFTP_DIRECTORY="/srv/tftp"
TFTP_ADDRESS="0.0.0.0:69"
TFTP_OPTIONS="--secure"

# Start
systemctl start tftpd-hpa

# Test download
tftp localhost
> get testfile.txt
> quit
```

### Docker TFTP Server

```bash
# Simple TFTP server
docker run -d \
  -p 69:69/udp \
  -v $(pwd)/tftp:/tftpboot \
  --name tftp \
  pghalliday/tftp

# Add test file
echo "Hello TFTP" > tftp/test.txt

# Test
tftp localhost
> get test.txt
```

### Python Test

```python
import tftpy

# Download
client = tftpy.TftpClient('localhost', 69)
client.download('test.txt', 'downloaded.txt')

# Upload
client.upload('local.txt', 'remote.txt')
```

## Resources

- **RFC 1350**: [TFTP Protocol](https://tools.ietf.org/html/rfc1350)
- **RFC 2347**: [TFTP Option Extension](https://tools.ietf.org/html/rfc2347)
- **RFC 2348**: [TFTP Blocksize Option](https://tools.ietf.org/html/rfc2348)

## Common Use Cases

### PXE Network Boot
```
1. DHCP provides IP + TFTP server address
2. Client downloads pxelinux.0 via TFTP
3. Client downloads kernel and initrd via TFTP
4. System boots from network
```

### Cisco Router Configuration
```
Router# copy running-config tftp://10.0.0.1/config.txt
Router# copy tftp://10.0.0.1/ios.bin flash:
```

### Firmware Updates
```
# Update network switch firmware
tftp> binary
tftp> put firmware.bin
```

## Notes

- **UDP-based** - unreliable, no connection
- **Very simple** - minimal protocol overhead
- **Block size**: 512 bytes (can be negotiated with extensions)
- **No authentication** - major security concern
- **No encryption** - data sent in cleartext
- **Lock-step** - one packet at a time (ACK before next DATA)
- **Timeout and retry** - handles packet loss
- **Common in embedded systems** and network devices
- **PXE boot** is primary modern use case
- **Superseded by SFTP/FTPS** for general file transfer
