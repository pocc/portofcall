# RTMP Protocol Implementation Plan

## Overview

**Protocol:** RTMP (Real-Time Messaging Protocol)
**Port:** 1935 (TCP), 443 (RTMPS)
**Specification:** [Adobe RTMP Specification](https://www.adobe.com/devnet/rtmp.html)
**Complexity:** Very High
**Purpose:** Low-latency audio/video streaming

RTMP enables **live streaming** - publish and play live video streams, commonly used for broadcasting to streaming platforms like Twitch, YouTube Live, and Facebook Live from the browser.

### Use Cases
- Live streaming to platforms
- Broadcasting applications
- Video conferencing
- Gaming stream capture
- Real-time video delivery
- Interactive live events

## Protocol Specification

### Protocol Stack

```
┌─────────────────────┐
│   Application       │ (Commands, Data)
├─────────────────────┤
│   RTMP Messages     │ (Audio, Video, Data)
├─────────────────────┤
│   RTMP Chunks       │ (Chunking Layer)
├─────────────────────┤
│   TCP               │
└─────────────────────┘
```

### Handshake (C0, C1, C2 / S0, S1, S2)

**C0/S0** (1 byte): Version (0x03)

**C1/S1** (1536 bytes):
```
time: 4 bytes
zero: 4 bytes
random: 1528 bytes
```

**C2/S2** (1536 bytes):
```
time: 4 bytes (echo from C1/S1)
time2: 4 bytes (timestamp)
random_echo: 1528 bytes (echo from C1/S1)
```

### Chunk Format

```
┌──────────────────────────────────┐
│ Basic Header (1-3 bytes)         │
│   fmt (2 bits) + csid (6-14 bits)│
├──────────────────────────────────┤
│ Message Header (0-11 bytes)      │
│   timestamp, length, type, stream│
├──────────────────────────────────┤
│ Extended Timestamp (0-4 bytes)   │
├──────────────────────────────────┤
│ Chunk Data                       │
└──────────────────────────────────┘
```

### Chunk Types (fmt)

| fmt | Name | Header Size |
|-----|------|-------------|
| 0 | Full header | 11 bytes |
| 1 | No stream ID | 7 bytes |
| 2 | Timestamp only | 3 bytes |
| 3 | No header | 0 bytes |

### Message Types

| Type | Name |
|------|------|
| 1 | Set Chunk Size |
| 2 | Abort Message |
| 3 | Acknowledgement |
| 4 | User Control |
| 5 | Window Acknowledgement Size |
| 6 | Set Peer Bandwidth |
| 8 | Audio Data |
| 9 | Video Data |
| 15 | AMF3 Data |
| 17 | AMF3 Command |
| 18 | AMF0 Data |
| 20 | AMF0 Command |

### RTMP Commands (AMF0)

**connect**:
```javascript
{
  app: "live",
  flashVer: "LNX 10,0,32,18",
  tcUrl: "rtmp://server/live",
  fpad: false,
  capabilities: 15,
  audioCodecs: 4071,
  videoCodecs: 252,
  videoFunction: 1
}
```

**createStream**: Returns stream ID

**publish**: Start publishing stream

**play**: Start playing stream

## Worker Implementation

```typescript
// src/worker/protocols/rtmp/client.ts

import { connect } from 'cloudflare:sockets';

export interface RTMPConfig {
  host: string;
  port?: number;
  app: string;
  streamKey?: string;
}

export interface RTMPChunk {
  csid: number;
  timestamp: number;
  messageLength: number;
  messageTypeId: number;
  messageStreamId: number;
  data: Uint8Array;
}

export class RTMPClient {
  private socket: any;
  private chunkSize = 128;
  private streamId = 0;

  constructor(private config: RTMPConfig) {}

  async connect(): Promise<void> {
    const port = this.config.port || 1935;
    this.socket = connect(`${this.config.host}:${port}`);
    await this.socket.opened;

    // RTMP Handshake
    await this.handshake();

    // Send connect command
    await this.sendConnect();

    // Create stream
    this.streamId = await this.createStream();
  }

  private async handshake(): Promise<void> {
    // C0: Version
    await this.send(new Uint8Array([0x03]));

    // C1: Timestamp + Zero + Random
    const c1 = new Uint8Array(1536);
    const now = Date.now();
    new DataView(c1.buffer).setUint32(0, now);
    // Fill rest with random data
    for (let i = 8; i < 1536; i++) {
      c1[i] = Math.floor(Math.random() * 256);
    }
    await this.send(c1);

    // Read S0
    const s0 = await this.readBytes(1);
    if (s0[0] !== 0x03) {
      throw new Error('Invalid RTMP version');
    }

    // Read S1
    const s1 = await this.readBytes(1536);

    // Send C2 (echo of S1)
    const c2 = new Uint8Array(1536);
    c2.set(s1.slice(0, 8));
    new DataView(c2.buffer).setUint32(4, now);
    c2.set(s1.slice(8), 8);
    await this.send(c2);

    // Read S2 (echo of C1)
    await this.readBytes(1536);

    console.log('RTMP handshake complete');
  }

  private async sendConnect(): Promise<void> {
    const connectObj = {
      app: this.config.app,
      flashVer: 'LNX 10,0,32,18',
      tcUrl: `rtmp://${this.config.host}/${this.config.app}`,
      fpad: false,
      capabilities: 15,
      audioCodecs: 4071,
      videoCodecs: 252,
      videoFunction: 1,
      objectEncoding: 0,
    };

    await this.sendCommand('connect', 1, connectObj);

    // Wait for _result
    await this.readChunk();
  }

  private async createStream(): Promise<number> {
    await this.sendCommand('createStream', 2, null);

    // Wait for _result with stream ID
    const chunk = await this.readChunk();

    // Parse AMF0 response to get stream ID
    // Simplified - would parse actual AMF0
    return 1;
  }

  async publish(streamName: string): Promise<void> {
    await this.sendCommand('publish', 3, null, streamName, 'live');

    // Start sending audio/video data
  }

  async play(streamName: string): Promise<void> {
    await this.sendCommand('play', 3, null, streamName);

    // Start receiving audio/video data
    this.receiveStream();
  }

  async sendAudioData(data: Uint8Array, timestamp: number): Promise<void> {
    await this.sendChunk({
      csid: 4,
      timestamp,
      messageLength: data.length,
      messageTypeId: 8, // Audio
      messageStreamId: this.streamId,
      data,
    });
  }

  async sendVideoData(data: Uint8Array, timestamp: number): Promise<void> {
    await this.sendChunk({
      csid: 6,
      timestamp,
      messageLength: data.length,
      messageTypeId: 9, // Video
      messageStreamId: this.streamId,
      data,
    });
  }

  private async sendCommand(name: string, transactionId: number, ...args: any[]): Promise<void> {
    // Encode as AMF0
    const amf0 = this.encodeAMF0(name, transactionId, ...args);

    await this.sendChunk({
      csid: 3,
      timestamp: 0,
      messageLength: amf0.length,
      messageTypeId: 20, // AMF0 Command
      messageStreamId: 0,
      data: amf0,
    });
  }

  private async sendChunk(chunk: RTMPChunk): Promise<void> {
    // Build chunk with header
    const chunks: Uint8Array[] = [];

    let remaining = chunk.data.length;
    let offset = 0;
    let isFirst = true;

    while (remaining > 0) {
      const chunkDataSize = Math.min(remaining, this.chunkSize);

      if (isFirst) {
        // Type 0: Full header
        const header = this.buildChunkHeader(0, chunk);
        chunks.push(header);
        isFirst = false;
      } else {
        // Type 3: No header (continuation)
        const header = this.buildChunkHeader(3, chunk);
        chunks.push(header);
      }

      // Chunk data
      chunks.push(chunk.data.slice(offset, offset + chunkDataSize));

      offset += chunkDataSize;
      remaining -= chunkDataSize;
    }

    // Send all chunks
    for (const chunkData of chunks) {
      await this.send(chunkData);
    }
  }

  private buildChunkHeader(fmt: number, chunk: RTMPChunk): Uint8Array {
    // Basic header
    const basicHeader = new Uint8Array(1);
    basicHeader[0] = (fmt << 6) | (chunk.csid & 0x3F);

    if (fmt === 0) {
      // Type 0: Full header (11 bytes)
      const header = new Uint8Array(12);
      const view = new DataView(header.buffer);

      header[0] = basicHeader[0];

      // Timestamp (3 bytes, big-endian)
      view.setUint8(1, (chunk.timestamp >> 16) & 0xFF);
      view.setUint8(2, (chunk.timestamp >> 8) & 0xFF);
      view.setUint8(3, chunk.timestamp & 0xFF);

      // Message length (3 bytes, big-endian)
      view.setUint8(4, (chunk.messageLength >> 16) & 0xFF);
      view.setUint8(5, (chunk.messageLength >> 8) & 0xFF);
      view.setUint8(6, chunk.messageLength & 0xFF);

      // Message type ID
      view.setUint8(7, chunk.messageTypeId);

      // Message stream ID (4 bytes, little-endian)
      view.setUint32(8, chunk.messageStreamId, true);

      return header;
    } else if (fmt === 3) {
      // Type 3: No header
      return basicHeader;
    }

    return basicHeader;
  }

  private async readChunk(): Promise<RTMPChunk> {
    // Read basic header
    const basicHeader = await this.readBytes(1);
    const fmt = (basicHeader[0] >> 6) & 0x03;
    const csid = basicHeader[0] & 0x3F;

    // Read message header based on fmt
    let timestamp = 0;
    let messageLength = 0;
    let messageTypeId = 0;
    let messageStreamId = 0;

    if (fmt === 0) {
      const header = await this.readBytes(11);
      const view = new DataView(header.buffer);

      timestamp = (view.getUint8(0) << 16) | (view.getUint8(1) << 8) | view.getUint8(2);
      messageLength = (view.getUint8(3) << 16) | (view.getUint8(4) << 8) | view.getUint8(5);
      messageTypeId = view.getUint8(6);
      messageStreamId = view.getUint32(7, true);
    }

    // Read chunk data
    const data = await this.readBytes(Math.min(messageLength, this.chunkSize));

    return {
      csid,
      timestamp,
      messageLength,
      messageTypeId,
      messageStreamId,
      data,
    };
  }

  private async receiveStream(): Promise<void> {
    // Continuously read and process chunks
    while (true) {
      const chunk = await this.readChunk();

      if (chunk.messageTypeId === 8) {
        // Audio data
        this.handleAudioData(chunk.data);
      } else if (chunk.messageTypeId === 9) {
        // Video data
        this.handleVideoData(chunk.data);
      }
    }
  }

  private handleAudioData(data: Uint8Array): void {
    console.log('Audio data:', data.length);
    // Would process audio (AAC, MP3, etc.)
  }

  private handleVideoData(data: Uint8Array): void {
    console.log('Video data:', data.length);
    // Would process video (H.264, etc.)
  }

  private encodeAMF0(...values: any[]): Uint8Array {
    // Simplified AMF0 encoder
    const chunks: Uint8Array[] = [];

    for (const value of values) {
      if (typeof value === 'string') {
        // String marker
        chunks.push(new Uint8Array([0x02]));

        // String length and data
        const encoder = new TextEncoder();
        const strData = encoder.encode(value);
        const len = new Uint8Array(2);
        new DataView(len.buffer).setUint16(0, strData.length);
        chunks.push(len);
        chunks.push(strData);
      } else if (typeof value === 'number') {
        // Number marker
        chunks.push(new Uint8Array([0x00]));

        // Double value
        const num = new Uint8Array(8);
        new DataView(num.buffer).setFloat64(0, value);
        chunks.push(num);
      } else if (value === null) {
        // Null marker
        chunks.push(new Uint8Array([0x05]));
      } else if (typeof value === 'object') {
        // Object marker
        chunks.push(new Uint8Array([0x03]));

        // Encode properties
        for (const [key, val] of Object.entries(value)) {
          // Property name
          const encoder = new TextEncoder();
          const keyData = encoder.encode(key);
          const keyLen = new Uint8Array(2);
          new DataView(keyLen.buffer).setUint16(0, keyData.length);
          chunks.push(keyLen);
          chunks.push(keyData);

          // Property value (recursive)
          chunks.push(this.encodeAMF0(val));
        }

        // Object end marker
        chunks.push(new Uint8Array([0x00, 0x00, 0x09]));
      }
    }

    // Concatenate all chunks
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

  async close(): Promise<void> {
    if (this.socket) {
      await this.socket.close();
    }
  }
}
```

## Web UI Design

```typescript
// src/components/RTMPClient.tsx

export function RTMPClient() {
  const [streaming, setStreaming] = useState(false);
  const [streamUrl, setStreamUrl] = useState('rtmp://live.twitch.tv/app/');
  const [streamKey, setStreamKey] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const startStream = async () => {
    // Get media stream from camera/screen
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }

    // Start RTMP connection
    await fetch('/api/rtmp/publish', {
      method: 'POST',
      body: JSON.stringify({ url: streamUrl, key: streamKey }),
    });

    setStreaming(true);

    // Start encoding and sending
    startEncoding(stream);
  };

  const stopStream = async () => {
    await fetch('/api/rtmp/stop', { method: 'POST' });
    setStreaming(false);

    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
  };

  const startEncoding = (stream: MediaStream) => {
    // Would encode video/audio and send to RTMP server
    // Requires MediaRecorder or WebCodecs API
  };

  return (
    <div className="rtmp-client">
      <h2>RTMP Live Streaming</h2>

      <div className="preview">
        <video ref={videoRef} autoPlay muted />
      </div>

      {!streaming ? (
        <div className="config">
          <input
            type="text"
            placeholder="RTMP Server URL"
            value={streamUrl}
            onChange={(e) => setStreamUrl(e.target.value)}
          />
          <input
            type="password"
            placeholder="Stream Key"
            value={streamKey}
            onChange={(e) => setStreamKey(e.target.value)}
          />
          <button onClick={startStream}>Start Stream</button>
        </div>
      ) : (
        <div className="controls">
          <span className="live-indicator">🔴 LIVE</span>
          <button onClick={stopStream}>Stop Stream</button>
        </div>
      )}

      <div className="info">
        <h3>Platform URLs</h3>
        <ul>
          <li><strong>Twitch:</strong> rtmp://live.twitch.tv/app/</li>
          <li><strong>YouTube:</strong> rtmp://a.rtmp.youtube.com/live2/</li>
          <li><strong>Facebook:</strong> rtmps://live-api-s.facebook.com:443/rtmp/</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### RTMPS (RTMP over TLS)

```
Port: 443
URL: rtmps://server/app
```

### Stream Key

```
Use secret stream key for authentication
Never expose publicly
```

## Testing

### NGINX RTMP Module

```bash
# Install nginx-rtmp-module
apt-get install libnginx-mod-rtmp

# /etc/nginx/nginx.conf
rtmp {
  server {
    listen 1935;
    application live {
      live on;
      record off;
    }
  }
}

# Restart nginx
systemctl restart nginx

# Stream with ffmpeg
ffmpeg -re -i video.mp4 \
  -c:v libx264 -c:a aac \
  -f flv rtmp://localhost/live/stream

# Play with ffplay
ffplay rtmp://localhost/live/stream
```

### OBS Studio

```
Stream to custom RTMP server:
Server: rtmp://localhost/live
Stream Key: mystream
```

## Resources

- **RTMP Spec**: [Adobe RTMP Specification](https://www.adobe.com/devnet/rtmp.html)
- **NGINX RTMP**: [nginx-rtmp-module](https://github.com/arut/nginx-rtmp-module)
- **OBS Studio**: [Open Broadcaster Software](https://obsproject.com/)

## Video Codecs

| Codec | ID | Description |
|-------|-----|------------|
| H.264 | 7 | Most common, good quality |
| VP8 | - | Open codec, WebM |
| VP9 | - | Better compression |

## Audio Codecs

| Codec | ID | Description |
|-------|-----|------------|
| AAC | 10 | High quality |
| MP3 | 2 | Legacy |
| Speex | 11 | Voice |

## Notes

- **Low latency** - 2-5 seconds typical
- **Flash-based** originally, now widely adopted
- **Chunked protocol** - configurable chunk size
- **AMF encoding** - ActionScript Message Format
- **Handshake** - C0/C1/C2, S0/S1/S2
- **Complex** - one of the most sophisticated streaming protocols
- **Stateful** - maintains connection
- **Replaced by HLS/DASH** for playback, still used for ingest
- **WebRTC** is replacing for browser-to-browser
