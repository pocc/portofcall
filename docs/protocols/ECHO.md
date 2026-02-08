# Echo Protocol Implementation Plan

## Overview

**Protocol:** TCP Echo Service
**Port:** 7
**RFC:** [RFC 862](https://tools.ietf.org/html/rfc862)
**Complexity:** Low
**Purpose:** Testing and validation

Echo is the simplest TCP protocol - it echoes back everything sent to it. Perfect for testing TCP connectivity and establishing baseline implementation patterns.

### Use Cases
- TCP connectivity testing
- Latency measurement
- Protocol development debugging
- Network troubleshooting

## Protocol Specification

### Wire Format
Extremely simple - no protocol overhead:

```
Client → Server: [any data]
Server → Client: [same data]
```

No headers, no commands, no encoding rules. Pure echo.

### Example Session
```
Client: Hello, World!
Server: Hello, World!

Client: Testing 123
Server: Testing 123
```

## Worker Implementation

### Socket Handler

```typescript
// src/worker/protocols/echo.ts

import { connect } from 'cloudflare:sockets';

export interface EchoRequest {
  host: string;
  port: number;
  message?: string;  // For simple test
}

export interface EchoResponse {
  success: boolean;
  echoed?: string;
  rtt?: number;
  error?: string;
}

/**
 * Simple echo test - send message, receive echo, measure RTT
 */
export async function echoTest(
  host: string,
  port: number,
  message: string
): Promise<EchoResponse> {
  const start = Date.now();

  try {
    const socket = connect(`${host}:${port}`);
    await socket.opened;

    // Send message
    const writer = socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(message));

    // Read echo response
    const reader = socket.readable.getReader();
    const { value } = await reader.read();
    const decoder = new TextDecoder();
    const echoed = decoder.decode(value);

    const rtt = Date.now() - start;

    await socket.close();

    return {
      success: true,
      echoed,
      rtt,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * WebSocket tunnel for interactive echo session
 */
export async function echoTunnel(
  request: Request,
  host: string,
  port: number
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  try {
    const socket = connect(`${host}:${port}`);
    await socket.opened;

    // Pipe WebSocket → TCP
    server.addEventListener('message', async (event) => {
      const writer = socket.writable.getWriter();
      const data = typeof event.data === 'string'
        ? new TextEncoder().encode(event.data)
        : event.data;
      await writer.write(data);
      writer.releaseLock();
    });

    // Pipe TCP → WebSocket
    (async () => {
      const reader = socket.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        server.send(value);
      }
    })();

    // Handle close
    server.addEventListener('close', () => {
      socket.close();
    });

  } catch (error) {
    server.send(JSON.stringify({
      error: error instanceof Error ? error.message : 'Connection failed',
    }));
    server.close();
  }

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
```

### API Endpoints

```typescript
// Add to src/worker/index.ts

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Simple echo test
    if (url.pathname === '/api/echo/test' && request.method === 'POST') {
      const { host, port, message } = await request.json();
      const result = await echoTest(host, port, message || 'Hello');
      return Response.json(result);
    }

    // WebSocket tunnel for interactive echo
    if (url.pathname === '/api/echo/connect') {
      const { host, port } = await request.json();
      return echoTunnel(request, host, port);
    }

    // ... other routes
  }
};
```

## Web UI Design

### Component Structure

```typescript
// src/components/EchoClient.tsx

import { useState } from 'react';

interface EchoResult {
  message: string;
  echoed?: string;
  rtt?: number;
  error?: string;
}

export function EchoClient() {
  const [host, setHost] = useState('tcpbin.com');
  const [port, setPort] = useState(4242);
  const [message, setMessage] = useState('Hello, Echo!');
  const [results, setResults] = useState<EchoResult[]>([]);
  const [loading, setLoading] = useState(false);

  const sendEcho = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/echo/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, message }),
      });

      const result = await response.json();
      setResults([...results, {
        message,
        echoed: result.echoed,
        rtt: result.rtt,
        error: result.error,
      }]);
    } catch (error) {
      setResults([...results, {
        message,
        error: error instanceof Error ? error.message : 'Failed',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="echo-client">
      <h2>TCP Echo Service</h2>

      <div className="connection-form">
        <input
          type="text"
          placeholder="Host"
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

      <div className="message-form">
        <input
          type="text"
          placeholder="Message to echo"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendEcho()}
        />
        <button onClick={sendEcho} disabled={loading}>
          {loading ? 'Sending...' : 'Send Echo'}
        </button>
      </div>

      <div className="results">
        <h3>Echo Results</h3>
        {results.map((result, i) => (
          <div key={i} className={result.error ? 'error' : 'success'}>
            <div className="sent">Sent: {result.message}</div>
            {result.echoed && (
              <>
                <div className="received">Received: {result.echoed}</div>
                <div className="rtt">RTT: {result.rtt}ms</div>
              </>
            )}
            {result.error && <div className="error">{result.error}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Interactive Mode (WebSocket)

```typescript
// src/components/EchoInteractive.tsx

export function EchoInteractive() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Array<{sent: string, received: string}>>([]);

  const connect = async () => {
    const socket = new WebSocket(`${location.origin}/api/echo/connect`);

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);

    socket.onmessage = (event) => {
      const received = event.data;
      setMessages(prev => [...prev, { sent: prev[prev.length - 1]?.sent || '', received }]);
    };

    setWs(socket);
  };

  const send = (message: string) => {
    if (ws && connected) {
      ws.send(message);
      setMessages(prev => [...prev, { sent: message, received: '' }]);
    }
  };

  return (
    <div className="echo-interactive">
      <button onClick={connect} disabled={connected}>
        {connected ? 'Connected' : 'Connect'}
      </button>

      {connected && (
        <input
          type="text"
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              send(e.currentTarget.value);
              e.currentTarget.value = '';
            }
          }}
        />
      )}

      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i}>
            <div className="sent">→ {msg.sent}</div>
            <div className="received">← {msg.received}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Data Flow

### Simple Echo Test

```
┌─────────┐         ┌──────────┐         ┌─────────────┐
│ Browser │         │  Worker  │         │ Echo Server │
└────┬────┘         └────┬─────┘         └──────┬──────┘
     │                   │                       │
     │ POST /api/echo/test                       │
     │ {host, port, msg} │                       │
     ├──────────────────>│                       │
     │                   │ connect(host:port)    │
     │                   ├──────────────────────>│
     │                   │ <── TCP handshake ──> │
     │                   │                       │
     │                   │ write(message)        │
     │                   ├──────────────────────>│
     │                   │                       │
     │                   │        read()         │
     │                   │<──────────────────────┤
     │                   │ (echoed message)      │
     │                   │                       │
     │ {echoed, rtt}     │                       │
     │<──────────────────┤                       │
     │                   │                       │
```

### WebSocket Tunnel

```
┌─────────┐         ┌──────────┐         ┌─────────────┐
│ Browser │         │  Worker  │         │ Echo Server │
└────┬────┘         └────┬─────┘         └──────┬──────┘
     │                   │                       │
     │ WS /api/echo/connect                      │
     ├──────────────────>│                       │
     │                   │ connect(host:port)    │
     │ <── WS Accept ──> │<───────────────────> │
     │                   │                       │
     │ WS: "Hello"       │                       │
     ├──────────────────>│ TCP: "Hello"         │
     │                   ├──────────────────────>│
     │                   │                       │
     │                   │ TCP: "Hello"          │
     │ WS: "Hello"       │<──────────────────────┤
     │<──────────────────┤                       │
     │                   │                       │
```

## Security

### Input Validation

```typescript
function validateEchoRequest(host: string, port: number): boolean {
  // Validate port range
  if (port < 1 || port > 65535) return false;

  // Validate hostname (prevent SSRF)
  if (host.includes('localhost') || host.includes('127.0.0.1')) return false;
  if (host.includes('192.168.') || host.includes('10.')) return false;

  return true;
}
```

### Rate Limiting

```typescript
// Limit echo requests per IP
const ECHO_RATE_LIMIT = 60; // requests per minute

async function checkRateLimit(ip: string): Promise<boolean> {
  // Use KV or Durable Objects to track request counts
  // Return false if limit exceeded
}
```

### Message Size Limits

```typescript
const MAX_ECHO_MESSAGE_SIZE = 4096; // 4KB

if (message.length > MAX_ECHO_MESSAGE_SIZE) {
  return Response.json({ error: 'Message too large' }, { status: 400 });
}
```

## Testing

### Test Servers

Public echo servers for testing:
- `tcpbin.com:4242` - Reliable test server
- `echo.websocket.org` (WebSocket echo, not pure TCP)

### Unit Tests

```typescript
// tests/echo.test.ts

import { echoTest } from '../src/worker/protocols/echo';

describe('Echo Protocol', () => {
  it('should echo message correctly', async () => {
    const result = await echoTest('tcpbin.com', 4242, 'Test');
    expect(result.success).toBe(true);
    expect(result.echoed).toBe('Test');
    expect(result.rtt).toBeGreaterThan(0);
  });

  it('should handle connection failures', async () => {
    const result = await echoTest('invalid-host.example', 9999, 'Test');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

### Integration Tests

```typescript
// tests/echo-integration.test.ts

describe('Echo API Endpoints', () => {
  it('POST /api/echo/test should work', async () => {
    const response = await fetch('http://localhost:8787/api/echo/test', {
      method: 'POST',
      body: JSON.stringify({
        host: 'tcpbin.com',
        port: 4242,
        message: 'Integration Test',
      }),
    });

    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.echoed).toBe('Integration Test');
  });
});
```

## Resources

- **RFC 862**: [Echo Protocol Specification](https://tools.ietf.org/html/rfc862)
- **Test Server**: [tcpbin.com](http://tcpbin.com/)
- **Implementation Example**: See [echo-server npm package](https://www.npmjs.com/package/echo-server)

## Next Steps

1. Implement basic echo test endpoint
2. Add WebSocket tunnel support
3. Build React UI component
4. Add comprehensive error handling
5. Implement rate limiting
6. Create visual latency graphs

## Notes

- Echo is perfect as the **first protocol** to implement
- Establishes patterns for all other protocols
- Simple enough to validate entire architecture
- Useful for ongoing connectivity testing
