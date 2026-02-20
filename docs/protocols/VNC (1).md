# VNC Protocol Implementation Plan

## Overview

**Protocol:** VNC (Virtual Network Computing) / RFB
**Port:** 5900+ (5900 = display :0, 5901 = display :1, etc.)
**RFC:** [RFC 6143](https://tools.ietf.org/html/rfc6143)
**Complexity:** Very High
**Purpose:** Remote desktop / screen sharing

VNC enables **viewing and controlling remote desktops** from the browser - a full graphical remote desktop experience without plugins.

### Use Cases
- Remote desktop access
- Server GUI management
- Tech support / screen sharing
- Remote education
- Data center management
- Cross-platform remote access

## Protocol Specification

### RFB Protocol (Remote FrameBuffer)

```
1. Handshake (version exchange)
2. Security negotiation
3. ClientInit / ServerInit
4. Normal operation (framebuffer updates)
```

### Handshake

```
Server → Client: "RFB 003.008\n"
Client → Server: "RFB 003.008\n"
```

### Security Types

| Type | Description |
|------|-------------|
| 0 | Invalid |
| 1 | None |
| 2 | VNC Authentication |
| 5-16 | RealVNC |
| 30-35 | Apple |

### Message Types (Client → Server)

| Type | Name |
|------|------|
| 0 | SetPixelFormat |
| 2 | SetEncodings |
| 3 | FramebufferUpdateRequest |
| 4 | KeyEvent |
| 5 | PointerEvent |
| 6 | ClientCutText |

### Message Types (Server → Client)

| Type | Name |
|------|------|
| 0 | FramebufferUpdate |
| 1 | SetColourMapEntries |
| 2 | Bell |
| 3 | ServerCutText |

## Worker Implementation

### Use noVNC Library

```bash
npm install @novnc/novnc
```

```typescript
// src/worker/protocols/vnc/proxy.ts

import { connect } from 'cloudflare:sockets';

/**
 * VNC WebSocket proxy
 * Translates WebSocket → TCP for VNC protocol
 */
export async function vncProxy(
  request: Request,
  vncHost: string,
  vncPort: number
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  (async () => {
    try {
      // Connect to VNC server
      const socket = connect(`${vncHost}:${vncPort}`);
      await socket.opened;

      // Bidirectional pipe: WebSocket ↔ TCP

      // WebSocket → TCP
      server.addEventListener('message', async (event) => {
        const writer = socket.writable.getWriter();

        if (event.data instanceof ArrayBuffer) {
          await writer.write(new Uint8Array(event.data));
        } else if (typeof event.data === 'string') {
          const encoder = new TextEncoder();
          await writer.write(encoder.encode(event.data));
        }

        writer.releaseLock();
      });

      // TCP → WebSocket
      (async () => {
        const reader = socket.readable.getReader();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          server.send(value.buffer);
        }

        server.close();
      })();

      // Handle close
      server.addEventListener('close', () => {
        socket.close();
      });

    } catch (error) {
      console.error('VNC proxy error:', error);
      server.close();
    }
  })();

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
```

## Web UI Design

### noVNC Integration

```typescript
// src/components/VNCViewer.tsx

import RFB from '@novnc/novnc/core/rfb';
import { useEffect, useRef, useState } from 'react';

export function VNCViewer() {
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);

  const [connected, setConnected] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(5900);
  const [password, setPassword] = useState('');

  const connect = () => {
    if (!screenRef.current) return;

    // WebSocket URL to our proxy
    const url = `/api/vnc/connect?host=${host}&port=${port}`;

    try {
      rfbRef.current = new RFB(screenRef.current, url, {
        credentials: { password },
      });

      rfbRef.current.addEventListener('connect', () => {
        setConnected(true);
      });

      rfbRef.current.addEventListener('disconnect', () => {
        setConnected(false);
      });

      // Set quality
      rfbRef.current.qualityLevel = 6;
      rfbRef.current.compressionLevel = 2;

    } catch (error) {
      console.error('VNC connection failed:', error);
    }
  };

  const disconnect = () => {
    rfbRef.current?.disconnect();
    setConnected(false);
  };

  const sendCtrlAltDel = () => {
    rfbRef.current?.sendCtrlAltDel();
  };

  return (
    <div className="vnc-viewer">
      {!connected ? (
        <div className="connection-form">
          <h2>VNC Connection</h2>
          <input
            type="text"
            placeholder="VNC Host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
          <input
            type="number"
            placeholder="Port"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
          <input
            type="password"
            placeholder="Password (if required)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button onClick={connect}>Connect</button>
        </div>
      ) : (
        <>
          <div className="vnc-toolbar">
            <span>Connected to {host}:{port}</span>
            <button onClick={sendCtrlAltDel}>Ctrl+Alt+Del</button>
            <button onClick={disconnect}>Disconnect</button>
          </div>

          <div ref={screenRef} className="vnc-screen" />
        </>
      )}
    </div>
  );
}
```

## Security

### VNC Authentication

```typescript
// VNC authentication is weak (DES-based)
// Always use SSH tunnel or VPN

// Recommend SSH tunnel
ssh -L 5900:localhost:5900 user@remote-host
// Then connect to localhost:5900
```

### Encrypted VNC

```typescript
// Use VeNCrypt for TLS encryption
// Or tunnel through SSH
```

## Testing

```bash
# VNC server (Linux)
apt-get install tightvncserver
vncserver :1 -geometry 1024x768

# VNC server (Docker)
docker run -d \
  -p 5900:5900 \
  -e VNC_PASSWORD=vncpassword \
  consol/ubuntu-xfce-vnc
```

## Resources

- **RFC 6143**: [RFB Protocol](https://tools.ietf.org/html/rfc6143)
- **noVNC**: [JavaScript VNC client](https://github.com/novnc/noVNC)
- **TightVNC**: [Popular VNC implementation](https://www.tightvnc.com/)

## Notes

- **Very complex** protocol (framebuffer streaming)
- **noVNC** handles most complexity
- Worker acts as **WebSocket ↔ TCP proxy**
- VNC authentication is **weak** - use SSH tunnel
- Different **encodings** for performance (Raw, Tight, ZRLE)
- Requires significant **bandwidth** for smooth operation
