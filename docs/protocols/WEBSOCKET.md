# WebSocket Protocol

## Overview

**WebSocket** is a protocol providing full-duplex communication channels over a single TCP connection. It enables real-time, bidirectional communication between clients and servers, making it ideal for chat applications, live feeds, real-time dashboards, and multiplayer games.

**Port:** 80 (ws://), 443 (wss://)
**Transport:** TCP (upgrade from HTTP)
**RFC:** 6455

## Protocol Specification

### Connection Establishment

WebSocket connections start as HTTP requests that are "upgraded" to WebSocket:

**Client Request:**
```
GET /chat HTTP/1.1
Host: server.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Origin: http://example.com
```

**Server Response:**
```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

### Frame Format

WebSocket messages are sent as frames:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
|     Extended payload length continued, if payload len == 127  |
+ - - - - - - - - - - - - - - - +-------------------------------+
|                               |Masking-key, if MASK set to 1  |
+-------------------------------+-------------------------------+
| Masking-key (continued)       |          Payload Data         |
+-------------------------------- - - - - - - - - - - - - - - - +
:                     Payload Data continued ...                :
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
|                     Payload Data continued ...                |
+---------------------------------------------------------------+
```

### Opcodes

- `0x0` - Continuation Frame
- `0x1` - Text Frame (UTF-8)
- `0x2` - Binary Frame
- `0x8` - Connection Close
- `0x9` - Ping
- `0xA` - Pong

### Masking

Client-to-server frames MUST be masked. Server-to-client frames MUST NOT be masked.

### Close Codes

- `1000` - Normal Closure
- `1001` - Going Away
- `1002` - Protocol Error
- `1003` - Unsupported Data
- `1007` - Invalid Frame Payload Data
- `1008` - Policy Violation
- `1009` - Message Too Big
- `1011` - Internal Server Error

## Worker Implementation

```typescript
// workers/websocket.ts

interface WebSocketConfig {
  url: string;
  protocols?: string[];
}

interface WebSocketMessage {
  type: 'text' | 'binary' | 'ping' | 'pong' | 'close';
  data: string | ArrayBuffer;
  timestamp: number;
}

class WebSocketProxy {
  private backend: WebSocket | null = null;
  private client: WebSocket | null = null;

  async handleUpgrade(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();
    this.client = server;

    // Get backend URL from request
    const url = new URL(request.url);
    const backendUrl = url.searchParams.get('backend');

    if (!backendUrl) {
      server.send(JSON.stringify({ error: 'Backend URL required' }));
      server.close(1008, 'Backend URL required');
      return new Response(null, { status: 101, webSocket: client });
    }

    // Connect to backend
    try {
      await this.connectBackend(backendUrl, server);
    } catch (error) {
      server.send(JSON.stringify({
        error: error instanceof Error ? error.message : 'Connection failed'
      }));
      server.close(1011, 'Backend connection failed');
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private async connectBackend(backendUrl: string, clientWs: WebSocket): Promise<void> {
    this.backend = new WebSocket(backendUrl);

    this.backend.addEventListener('open', () => {
      clientWs.send(JSON.stringify({ status: 'connected', backend: backendUrl }));
    });

    this.backend.addEventListener('message', (event: MessageEvent) => {
      clientWs.send(event.data);
    });

    this.backend.addEventListener('close', (event: CloseEvent) => {
      clientWs.close(event.code, event.reason);
    });

    this.backend.addEventListener('error', (event: Event) => {
      clientWs.close(1011, 'Backend error');
    });

    // Forward client messages to backend
    clientWs.addEventListener('message', (event: MessageEvent) => {
      if (this.backend && this.backend.readyState === WebSocket.OPEN) {
        this.backend.send(event.data);
      }
    });

    clientWs.addEventListener('close', (event: CloseEvent) => {
      if (this.backend) {
        this.backend.close(event.code, event.reason);
      }
    });
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/websocket') {
      const proxy = new WebSocketProxy();
      return proxy.handleUpgrade(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
```

## Web UI Design

```typescript
// src/components/WebSocketTester.tsx
import React, { useState, useEffect, useRef } from 'react';

interface Message {
  direction: 'sent' | 'received';
  content: string;
  timestamp: Date;
  type: 'text' | 'binary' | 'system';
}

export default function WebSocketTester() {
  const [url, setUrl] = useState('wss://echo.websocket.org');
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = () => {
    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        addMessage('Connected to ' + url, 'system');
      };

      ws.onmessage = (event) => {
        addMessage(event.data, 'received');
      };

      ws.onerror = (error) => {
        addMessage('WebSocket error occurred', 'system');
      };

      ws.onclose = (event) => {
        setConnected(false);
        addMessage(`Disconnected (${event.code}): ${event.reason || 'No reason'}`, 'system');
      };

      wsRef.current = ws;
    } catch (error) {
      addMessage('Failed to connect: ' + (error instanceof Error ? error.message : 'Unknown error'), 'system');
    }
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close(1000, 'Client closed connection');
      wsRef.current = null;
    }
  };

  const sendMessage = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && message.trim()) {
      wsRef.current.send(message);
      addMessage(message, 'sent');
      setMessage('');
    }
  };

  const sendPing = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send('ping');
      addMessage('ping', 'sent');
    }
  };

  const addMessage = (content: string, direction: 'sent' | 'received' | 'system') => {
    setMessages(prev => [...prev, {
      direction: direction as any,
      content,
      timestamp: new Date(),
      type: 'text',
    }]);
  };

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">WebSocket Tester</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>WebSocket</strong> enables full-duplex, real-time communication between client and server
          over a single TCP connection. Perfect for chat, live feeds, and real-time dashboards.
        </p>
      </div>

      {/* Connection controls */}
      <div className="bg-white border rounded-lg p-4 mb-4">
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="wss://echo.websocket.org"
            className="flex-1 px-3 py-2 border rounded-lg"
            disabled={connected}
          />
          {!connected ? (
            <button
              onClick={connect}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Connect
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Disconnect
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`}></div>
          <span className="text-sm text-gray-600">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Message input */}
      {connected && (
        <div className="bg-white border rounded-lg p-4 mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 border rounded-lg"
            />
            <button
              onClick={sendMessage}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Send
            </button>
            <button
              onClick={sendPing}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Ping
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-3">Messages</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-gray-500 text-sm">No messages yet</p>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg ${
                  msg.direction === 'sent'
                    ? 'bg-blue-100 ml-12'
                    : msg.direction === 'received'
                    ? 'bg-gray-100 mr-12'
                    : 'bg-yellow-50 text-center'
                }`}
              >
                <div className="text-xs text-gray-500 mb-1">
                  {msg.timestamp.toLocaleTimeString()}
                  {msg.direction !== 'system' && (
                    <span className="ml-2 font-semibold">
                      {msg.direction === 'sent' ? '→ SENT' : '← RECEIVED'}
                    </span>
                  )}
                </div>
                <div className="font-mono text-sm break-all">{msg.content}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Info */}
      <div className="mt-6 bg-gray-50 rounded-lg p-4">
        <h3 className="font-semibold mb-2">Public Test Servers</h3>
        <ul className="text-sm space-y-1">
          <li className="font-mono">wss://echo.websocket.org</li>
          <li className="font-mono">wss://ws.postman-echo.com/raw</li>
          <li className="font-mono">wss://socketsbay.com/wss/v2/1/demo/</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security Considerations

1. **Origin Validation**: Validate `Origin` header to prevent CSRF
2. **Authentication**: Use tokens in initial HTTP request or first message
3. **Rate Limiting**: Prevent message flooding
4. **Message Size Limits**: Protect against memory exhaustion
5. **Input Validation**: Sanitize all received data
6. **TLS/SSL**: Always use `wss://` in production
7. **Close Timeouts**: Handle stale connections
8. **Masking**: Clients must mask frames (RFC requirement)

## Testing

```bash
# Test with websocat
websocat wss://echo.websocket.org

# Test with wscat
npm install -g wscat
wscat -c wss://echo.websocket.org

# Test with curl (HTTP upgrade)
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: $(echo -n 'test' | base64)" \
  -H "Sec-WebSocket-Version: 13" \
  http://localhost:8080/ws

# Browser JavaScript test
const ws = new WebSocket('wss://echo.websocket.org');
ws.onopen = () => ws.send('Hello!');
ws.onmessage = (e) => console.log('Received:', e.data);
```

## Resources

- **RFC 6455**: The WebSocket Protocol
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [WebSocket.org](https://www.websocket.org/)
- [Socket.IO](https://socket.io/) - WebSocket library with fallbacks
- [ws](https://github.com/websockets/ws) - Node.js WebSocket library

## Notes

- **Full-Duplex**: Both client and server can send messages anytime
- **Low Overhead**: After handshake, minimal framing overhead (2-14 bytes)
- **Upgrade from HTTP**: Starts as HTTP/1.1, upgrades to WebSocket
- **Browser Support**: All modern browsers support WebSocket
- **Ports**: Uses standard HTTP(S) ports (80/443)
- **Keep-Alive**: Built-in ping/pong frames for connection health
- **Binary Support**: Can send both text (UTF-8) and binary data
- **Firewall Friendly**: Works through most firewalls (uses HTTP ports)
- **Compression**: Supports permessage-deflate extension
- **Subprotocols**: Can negotiate application-level protocols (STOMP, MQTT, etc.)
