# gRPC (gRPC Remote Procedure Calls)

## Overview

**gRPC** is a modern, high-performance RPC framework developed by Google. It uses HTTP/2 for transport, Protocol Buffers (protobuf) for serialization, and supports streaming, authentication, and load balancing. It's widely used for microservices communication.

**Port:** Any (commonly 50051, 9090)
**Transport:** HTTP/2
**Serialization:** Protocol Buffers (protobuf)

## Protocol Specification

### HTTP/2 Foundation

gRPC builds on HTTP/2 features:
- **Multiplexing**: Multiple concurrent calls on one connection
- **Streaming**: Bidirectional streaming support
- **Header Compression**: HPACK compression
- **Flow Control**: Application-level flow control

### Message Format

gRPC messages consist of:
1. **Length-Prefixed Message**:
   ```
   [Compressed-Flag (1 byte)][Message-Length (4 bytes)][Message (N bytes)]
   ```

2. **Compressed-Flag**:
   - `0` - No compression
   - `1` - Compressed with method from grpc-encoding header

### Request/Response Types

**Unary RPC** (single request, single response):
```protobuf
rpc GetUser(UserRequest) returns (UserResponse);
```

**Server Streaming** (single request, stream of responses):
```protobuf
rpc ListUsers(ListRequest) returns (stream UserResponse);
```

**Client Streaming** (stream of requests, single response):
```protobuf
rpc CreateUsers(stream UserRequest) returns (CreateResponse);
```

**Bidirectional Streaming** (stream both ways):
```protobuf
rpc Chat(stream Message) returns (stream Message);
```

### Protocol Buffers Example

```protobuf
syntax = "proto3";

package user;

service UserService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
  rpc ListUsers(ListUsersRequest) returns (stream User);
  rpc UpdateUser(UpdateUserRequest) returns (UpdateUserResponse);
}

message GetUserRequest {
  int32 id = 1;
}

message GetUserResponse {
  User user = 1;
}

message User {
  int32 id = 1;
  string name = 2;
  string email = 3;
  int64 created_at = 4;
}

message ListUsersRequest {
  int32 page = 1;
  int32 page_size = 2;
}

message UpdateUserRequest {
  int32 id = 1;
  User user = 2;
}

message UpdateUserResponse {
  User user = 1;
}
```

### HTTP/2 Headers

**Request Headers:**
```
:method = POST
:scheme = http / https
:path = /{Service-Name}/{Method-Name}
:authority = {host}
content-type = application/grpc+proto
grpc-encoding = gzip / identity
grpc-timeout = {timeout-value}
authorization = Bearer {token}
```

**Response Headers:**
```
:status = 200
content-type = application/grpc+proto
grpc-encoding = gzip / identity
grpc-status = 0  (in trailers)
grpc-message = {error-message} (in trailers)
```

### Status Codes

- `0` - OK
- `1` - CANCELLED
- `2` - UNKNOWN
- `3` - INVALID_ARGUMENT
- `4` - DEADLINE_EXCEEDED
- `5` - NOT_FOUND
- `6` - ALREADY_EXISTS
- `7` - PERMISSION_DENIED
- `8` - RESOURCE_EXHAUSTED
- `9` - FAILED_PRECONDITION
- `10` - ABORTED
- `11` - OUT_OF_RANGE
- `12` - UNIMPLEMENTED
- `13` - INTERNAL
- `14` - UNAVAILABLE
- `15` - DATA_LOSS
- `16` - UNAUTHENTICATED

## Worker Implementation

```typescript
// workers/grpc.ts
import { connect } from 'cloudflare:sockets';

interface GRPCConfig {
  server: string;
  port?: number;
  service: string;
  method: string;
  message: any;
  metadata?: Record<string, string>;
}

interface GRPCResponse {
  success: boolean;
  data?: any;
  error?: string;
  status?: number;
  statusMessage?: string;
}

class GRPCClient {
  private config: Required<GRPCConfig>;
  private socket: any = null;

  constructor(config: GRPCConfig) {
    this.config = {
      server: config.server,
      port: config.port || 50051,
      service: config.service,
      method: config.method,
      message: config.message,
      metadata: config.metadata || {},
    };
  }

  async connect(): Promise<void> {
    this.socket = connect({
      hostname: this.config.server,
      port: this.config.port,
    });
  }

  async call(): Promise<GRPCResponse> {
    if (!this.socket) {
      await this.connect();
    }

    try {
      // Build gRPC HTTP/2 request
      const path = `/${this.config.service}/${this.config.method}`;

      // Encode protobuf message (simplified - in reality use protobuf.js)
      const messageBytes = this.encodeMessage(this.config.message);
      const grpcFrame = this.buildGRPCFrame(messageBytes);

      // Build HTTP/2 pseudo-headers and headers
      const headers = this.buildHeaders(path, grpcFrame.length);

      // In a real implementation, would use HTTP/2 framing
      // For now, this is a simplified representation
      const request = this.buildHTTP2Request(headers, grpcFrame);

      await this.sendRequest(request);
      const response = await this.receiveResponse();

      if (!response) {
        return { success: false, error: 'No response from server' };
      }

      const parsed = this.parseResponse(response);

      return {
        success: parsed.status === 0,
        data: parsed.data,
        status: parsed.status,
        statusMessage: parsed.statusMessage,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildGRPCFrame(messageBytes: Uint8Array): Uint8Array {
    const frame = new Uint8Array(5 + messageBytes.length);
    const view = new DataView(frame.buffer);

    // Compressed-Flag (1 byte): 0 = not compressed
    frame[0] = 0;

    // Message-Length (4 bytes, big-endian)
    view.setUint32(1, messageBytes.length, false);

    // Message
    frame.set(messageBytes, 5);

    return frame;
  }

  private buildHeaders(path: string, contentLength: number): Map<string, string> {
    const headers = new Map<string, string>();

    // HTTP/2 pseudo-headers
    headers.set(':method', 'POST');
    headers.set(':scheme', 'http');
    headers.set(':path', path);
    headers.set(':authority', `${this.config.server}:${this.config.port}`);

    // gRPC headers
    headers.set('content-type', 'application/grpc+proto');
    headers.set('te', 'trailers');
    headers.set('grpc-encoding', 'identity');

    // Custom metadata
    for (const [key, value] of Object.entries(this.config.metadata)) {
      headers.set(key.toLowerCase(), value);
    }

    return headers;
  }

  private buildHTTP2Request(headers: Map<string, string>, body: Uint8Array): Uint8Array {
    // Simplified HTTP/2 request building
    // In reality, would use proper HTTP/2 framing with HEADERS and DATA frames

    const encoder = new TextEncoder();
    const headerLines: string[] = [];

    for (const [key, value] of headers) {
      headerLines.push(`${key}: ${value}`);
    }

    const headerText = headerLines.join('\r\n') + '\r\n\r\n';
    const headerBytes = encoder.encode(headerText);

    const request = new Uint8Array(headerBytes.length + body.length);
    request.set(headerBytes, 0);
    request.set(body, headerBytes.length);

    return request;
  }

  private encodeMessage(message: any): Uint8Array {
    // Simplified protobuf encoding
    // In reality, would use protobuf.js or similar library
    const json = JSON.stringify(message);
    return new TextEncoder().encode(json);
  }

  private parseResponse(data: Uint8Array): {
    status: number;
    statusMessage: string;
    data?: any;
  } {
    // Simplified response parsing
    // In reality, would parse HTTP/2 frames and protobuf messages

    // Look for grpc-status in trailers
    const text = new TextDecoder().decode(data);
    const statusMatch = text.match(/grpc-status:\s*(\d+)/);
    const messageMatch = text.match(/grpc-message:\s*([^\r\n]+)/);

    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
    const statusMessage = messageMatch ? messageMatch[1] : 'OK';

    // Extract response data (simplified)
    let responseData;
    try {
      // In reality, would extract and decode protobuf message
      responseData = { raw: text };
    } catch {
      responseData = null;
    }

    return {
      status,
      statusMessage,
      data: responseData,
    };
  }

  private async sendRequest(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async receiveResponse(): Promise<Uint8Array | null> {
    const reader = this.socket.readable.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();

    if (done || !value) {
      return null;
    }

    return value;
  }

  async close(): Promise<void> {
    if (this.socket) {
      await this.socket.close();
      this.socket = null;
    }
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/grpc/call') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const config = await request.json() as GRPCConfig;

        if (!config.server || !config.service || !config.method) {
          return new Response(JSON.stringify({ error: 'Server, service, and method are required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const client = new GRPCClient(config);
        const response = await client.call();
        await client.close();

        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
        });

      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
```

## Web UI Design

```typescript
// src/components/GRPCTester.tsx
import React, { useState } from 'react';

interface GRPCResponse {
  success: boolean;
  data?: any;
  error?: string;
  status?: number;
  statusMessage?: string;
}

export default function GRPCTester() {
  const [server, setServer] = useState('localhost');
  const [port, setPort] = useState('50051');
  const [service, setService] = useState('UserService');
  const [method, setMethod] = useState('GetUser');
  const [message, setMessage] = useState('{"id": 1}');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<GRPCResponse | null>(null);

  const handleCall = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResponse(null);

    try {
      const messageObj = JSON.parse(message);

      const res = await fetch('/api/grpc/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server,
          port: parseInt(port, 10),
          service,
          method,
          message: messageObj,
        }),
      });

      const data = await res.json();
      setResponse(data);
    } catch (error) {
      setResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">gRPC Tester</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>gRPC</strong> is a high-performance RPC framework using HTTP/2 and Protocol Buffers.
          Ideal for microservices, mobile apps, and IoT devices.
        </p>
      </div>

      <form onSubmit={handleCall} className="space-y-4 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Server</label>
            <input
              type="text"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="localhost"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Port</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="50051"
              min="1"
              max="65535"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Service</label>
            <input
              type="text"
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg font-mono"
              placeholder="UserService"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Method</label>
            <input
              type="text"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg font-mono"
              placeholder="GetUser"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Message (JSON)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
            rows={5}
            placeholder='{"id": 1}'
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
        >
          {loading ? 'Calling...' : 'Call RPC Method'}
        </button>
      </form>

      {response && (
        <div className={`rounded-lg p-4 ${
          response.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <h2 className="font-semibold mb-3">
            {response.success ? '✓ Success' : '✗ Error'}
          </h2>

          {response.success ? (
            <div className="space-y-2">
              <div className="font-mono text-sm">
                <strong>Status:</strong> {response.status} ({response.statusMessage})
              </div>
              {response.data && (
                <div>
                  <strong className="text-sm">Response Data:</strong>
                  <pre className="mt-2 p-3 bg-white border rounded text-xs overflow-x-auto">
                    {JSON.stringify(response.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="text-red-800 font-mono text-sm">{response.error}</div>
          )}
        </div>
      )}

      <div className="mt-8 space-y-4">
        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">gRPC Features</h3>
          <ul className="text-sm space-y-1 text-gray-700 list-disc ml-5">
            <li>HTTP/2 multiplexing - multiple concurrent calls on one connection</li>
            <li>Bidirectional streaming</li>
            <li>Protocol Buffers - efficient binary serialization</li>
            <li>Built-in authentication, load balancing, retries</li>
            <li>Language-neutral interface definitions (.proto files)</li>
            <li>Code generation for 10+ languages</li>
          </ul>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">Common gRPC Ports</h3>
          <ul className="text-sm space-y-1 text-gray-700 font-mono">
            <li>50051 - Default gRPC development port</li>
            <li>9090 - Prometheus gRPC</li>
            <li>8080 - Common alternative</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
```

## Security Considerations

1. **TLS/SSL**: Always use TLS in production
2. **Authentication**: Use interceptors for token-based auth
3. **Authorization**: Implement service-level permissions
4. **Rate Limiting**: Prevent API abuse
5. **Input Validation**: Validate all protobuf messages
6. **Metadata Sanitization**: Clean metadata headers
7. **Timeouts**: Set deadlines for all calls
8. **Error Messages**: Don't leak sensitive information in errors

## Testing

```bash
# Install grpcurl (like curl for gRPC)
brew install grpcurl

# List services
grpcurl -plaintext localhost:50051 list

# Describe service
grpcurl -plaintext localhost:50051 describe UserService

# Call method
grpcurl -plaintext -d '{"id": 1}' \
  localhost:50051 UserService/GetUser

# With TLS
grpcurl -d '{"id": 1}' \
  api.example.com:443 UserService/GetUser

# With auth token
grpcurl -H 'authorization: Bearer TOKEN' \
  -d '{"id": 1}' \
  api.example.com:443 UserService/GetUser
```

## Resources

- [gRPC Official Site](https://grpc.io/)
- [Protocol Buffers](https://protobuf.dev/)
- [gRPC GitHub](https://github.com/grpc/grpc)
- [grpcurl](https://github.com/fullstorydev/grpcurl) - Command-line tool
- [Buf](https://buf.build/) - Protobuf tooling

## Notes

- **HTTP/2 Required**: gRPC requires HTTP/2 support
- **Protobuf**: Smaller payloads than JSON (up to 6x smaller)
- **Streaming**: Four types of streaming patterns
- **Code Generation**: Auto-generate client/server code from .proto files
- **Language Support**: Official support for C++, Java, Python, Go, Ruby, C#, Node.js, PHP, Dart
- **Deadlines**: Built-in timeout propagation across service calls
- **Cancellation**: Request cancellation propagates through call chain
- **Load Balancing**: Client-side load balancing support
- **Service Mesh**: Works well with Istio, Linkerd
- **vs REST**: Faster (binary), smaller payloads, streaming, but less browser-friendly
