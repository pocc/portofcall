# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**STUN** (Session Traversal Utilities for NAT) is a standardized protocol for NAT traversal. It allows clients behind NATs to discover their public IP addresses and the type of NAT they're behind, facilitating peer-to-peer communication for applications like WebRTC, VoIP, and real-time gaming.

**Port:** 3478 (TCP/UDP), 5349 (TLS)
**Transport:** TCP or UDP
**RFC:** 5389, 8489

## Protocol Specification

### Message Structure

STUN messages use a 20-byte header followed by zero or more attributes:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|0 0|     STUN Message Type     |         Message Length        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Magic Cookie                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                     Transaction ID (96 bits)                  |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          Attributes                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Message Types

**Request (0x00xx):**
- `0x0001` - Binding Request

**Success Response (0x01xx):**
- `0x0101` - Binding Success Response

**Error Response (0x11xx):**
- `0x0111` - Binding Error Response

**Indication (0x10xx):**
- `0x0011` - Binding Indication

### Magic Cookie

Fixed value: `0x2112A442` (identifies STUN messages)

### Common Attributes

- `0x0001` - MAPPED-ADDRESS (deprecated)
- `0x0020` - XOR-MAPPED-ADDRESS (client's reflexive transport address)
- `0x0006` - USERNAME
- `0x0008` - MESSAGE-INTEGRITY (HMAC-SHA1)
- `0x0009` - ERROR-CODE
- `0x000A` - UNKNOWN-ATTRIBUTES
- `0x0014` - REALM
- `0x0015` - NONCE
- `0x8028` - FINGERPRINT (CRC-32)
- `0x8022` - SOFTWARE

### XOR-MAPPED-ADDRESS Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         Type (0x0020)         |            Length             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|x x x x x x x x|    Family     |         X-Port                |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                X-Address (Variable)                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- Family: `0x01` (IPv4), `0x02` (IPv6)
- X-Port: Port XOR'd with most significant 16 bits of magic cookie
- X-Address: IP XOR'd with magic cookie (+ transaction ID for IPv6)

## Worker Implementation

```typescript
// workers/stun.ts
import { connect } from 'cloudflare:sockets';

interface STUNConfig {
  server: string;
  port?: number;
  username?: string;
  password?: string;
}

interface STUNAttribute {
  type: number;
  value: Uint8Array;
}

interface STUNMessage {
  messageType: number;
  transactionId: Uint8Array;
  attributes: STUNAttribute[];
}

interface STUNResponse {
  success: boolean;
  reflexiveAddress?: string;
  reflexivePort?: number;
  mappedAddress?: string;
  mappedPort?: number;
  error?: string;
}

const MAGIC_COOKIE = 0x2112A442;

const MessageType = {
  BINDING_REQUEST: 0x0001,
  BINDING_SUCCESS: 0x0101,
  BINDING_ERROR: 0x0111,
} as const;

const AttributeType = {
  MAPPED_ADDRESS: 0x0001,
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  UNKNOWN_ATTRIBUTES: 0x000A,
  REALM: 0x0014,
  NONCE: 0x0015,
  XOR_MAPPED_ADDRESS: 0x0020,
  SOFTWARE: 0x8022,
  FINGERPRINT: 0x8028,
} as const;

class STUNClient {
  private config: Required<STUNConfig>;
  private socket: any = null;

  constructor(config: STUNConfig) {
    this.config = {
      server: config.server,
      port: config.port || 3478,
      username: config.username || '',
      password: config.password || '',
    };
  }

  async connect(): Promise<void> {
    this.socket = connect({
      hostname: this.config.server,
      port: this.config.port,
    });
  }

  async getReflexiveAddress(): Promise<STUNResponse> {
    if (!this.socket) {
      await this.connect();
    }

    try {
      // Generate random transaction ID
      const transactionId = new Uint8Array(12);
      crypto.getRandomValues(transactionId);

      // Build Binding Request
      const request = this.encodeMessage({
        messageType: MessageType.BINDING_REQUEST,
        transactionId,
        attributes: [],
      });

      // Send request
      const writer = this.socket.writable.getWriter();
      await writer.write(request);
      writer.releaseLock();

      // Read response
      const reader = this.socket.readable.getReader();
      const { value, done } = await reader.read();
      reader.releaseLock();

      if (done || !value) {
        return { success: false, error: 'No response from server' };
      }

      // Parse response
      const response = this.decodeMessage(value);

      // Verify transaction ID
      if (!this.arraysEqual(response.transactionId, transactionId)) {
        return { success: false, error: 'Transaction ID mismatch' };
      }

      // Check message type
      if (response.messageType === MessageType.BINDING_ERROR) {
        const errorAttr = response.attributes.find(a => a.type === AttributeType.ERROR_CODE);
        const errorMsg = errorAttr ? this.parseErrorCode(errorAttr.value) : 'Unknown error';
        return { success: false, error: errorMsg };
      }

      if (response.messageType !== MessageType.BINDING_SUCCESS) {
        return { success: false, error: `Unexpected message type: 0x${response.messageType.toString(16)}` };
      }

      // Extract XOR-MAPPED-ADDRESS
      const xorMappedAttr = response.attributes.find(a => a.type === AttributeType.XOR_MAPPED_ADDRESS);
      if (xorMappedAttr) {
        const { address, port } = this.parseXorMappedAddress(xorMappedAttr.value, transactionId);
        return {
          success: true,
          reflexiveAddress: address,
          reflexivePort: port,
        };
      }

      // Fallback to MAPPED-ADDRESS (deprecated but some servers still use it)
      const mappedAttr = response.attributes.find(a => a.type === AttributeType.MAPPED_ADDRESS);
      if (mappedAttr) {
        const { address, port } = this.parseMappedAddress(mappedAttr.value);
        return {
          success: true,
          mappedAddress: address,
          mappedPort: port,
        };
      }

      return { success: false, error: 'No address attribute in response' };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private encodeMessage(message: STUNMessage): Uint8Array {
    // Calculate total length (excluding header)
    const attributesLength = message.attributes.reduce((sum, attr) => {
      return sum + 4 + attr.value.length + this.getPadding(attr.value.length);
    }, 0);

    const totalLength = 20 + attributesLength;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    const array = new Uint8Array(buffer);

    // Message Type (2 bytes)
    view.setUint16(0, message.messageType);

    // Message Length (2 bytes) - length of attributes only
    view.setUint16(2, attributesLength);

    // Magic Cookie (4 bytes)
    view.setUint32(4, MAGIC_COOKIE);

    // Transaction ID (12 bytes)
    array.set(message.transactionId, 8);

    // Attributes
    let offset = 20;
    for (const attr of message.attributes) {
      view.setUint16(offset, attr.type);
      view.setUint16(offset + 2, attr.value.length);
      array.set(attr.value, offset + 4);
      offset += 4 + attr.value.length + this.getPadding(attr.value.length);
    }

    return array;
  }

  private decodeMessage(data: Uint8Array): STUNMessage {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const messageType = view.getUint16(0);
    const messageLength = view.getUint16(2);
    const magicCookie = view.getUint32(4);

    if (magicCookie !== MAGIC_COOKIE) {
      throw new Error('Invalid magic cookie');
    }

    const transactionId = data.slice(8, 20);

    // Parse attributes
    const attributes: STUNAttribute[] = [];
    let offset = 20;

    while (offset < data.length && offset < 20 + messageLength) {
      const attrType = view.getUint16(offset);
      const attrLength = view.getUint16(offset + 2);
      const attrValue = data.slice(offset + 4, offset + 4 + attrLength);

      attributes.push({ type: attrType, value: attrValue });

      offset += 4 + attrLength + this.getPadding(attrLength);
    }

    return { messageType, transactionId, attributes };
  }

  private parseXorMappedAddress(value: Uint8Array, transactionId: Uint8Array): { address: string; port: number } {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);

    const family = view.getUint8(1);
    const xPort = view.getUint16(2);

    // XOR port with most significant 16 bits of magic cookie
    const port = xPort ^ (MAGIC_COOKIE >> 16);

    if (family === 0x01) { // IPv4
      const xAddress = view.getUint32(4);
      const address = xAddress ^ MAGIC_COOKIE;

      const ip = [
        (address >> 24) & 0xFF,
        (address >> 16) & 0xFF,
        (address >> 8) & 0xFF,
        address & 0xFF,
      ].join('.');

      return { address: ip, port };
    } else if (family === 0x02) { // IPv6
      // XOR with magic cookie + transaction ID
      const xorKey = new Uint8Array(16);
      const magicBytes = new Uint8Array(new Uint32Array([MAGIC_COOKIE]).buffer);
      xorKey.set(magicBytes, 0);
      xorKey.set(transactionId, 4);

      const addressBytes = new Uint8Array(16);
      for (let i = 0; i < 16; i++) {
        addressBytes[i] = value[4 + i] ^ xorKey[i];
      }

      // Format IPv6 address
      const parts: string[] = [];
      for (let i = 0; i < 16; i += 2) {
        parts.push(((addressBytes[i] << 8) | addressBytes[i + 1]).toString(16));
      }

      return { address: parts.join(':'), port };
    }

    throw new Error(`Unknown address family: ${family}`);
  }

  private parseMappedAddress(value: Uint8Array): { address: string; port: number } {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);

    const family = view.getUint8(1);
    const port = view.getUint16(2);

    if (family === 0x01) { // IPv4
      const address = view.getUint32(4);
      const ip = [
        (address >> 24) & 0xFF,
        (address >> 16) & 0xFF,
        (address >> 8) & 0xFF,
        address & 0xFF,
      ].join('.');

      return { address: ip, port };
    }

    throw new Error(`Unknown address family: ${family}`);
  }

  private parseErrorCode(value: Uint8Array): string {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    const errorClass = view.getUint8(2) & 0x07;
    const errorNumber = view.getUint8(3);
    const errorCode = errorClass * 100 + errorNumber;

    const reasonPhrase = new TextDecoder().decode(value.slice(4));
    return `${errorCode} ${reasonPhrase}`;
  }

  private getPadding(length: number): number {
    return (4 - (length % 4)) % 4;
  }

  private arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
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

    if (url.pathname === '/api/stun') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const { server, port, username, password } = await request.json() as STUNConfig;

        if (!server) {
          return new Response(JSON.stringify({ error: 'Server is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const client = new STUNClient({ server, port, username, password });
        const response = await client.getReflexiveAddress();
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
// src/components/STUNTester.tsx
import React, { useState } from 'react';

interface STUNResponse {
  success: boolean;
  reflexiveAddress?: string;
  reflexivePort?: number;
  mappedAddress?: string;
  mappedPort?: number;
  error?: string;
}

export default function STUNTester() {
  const [server, setServer] = useState('stun.l.google.com');
  const [port, setPort] = useState('3478');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<STUNResponse | null>(null);

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch('/api/stun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server,
          port: parseInt(port, 10),
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

  const publicServers = [
    { name: 'Google', server: 'stun.l.google.com' },
    { name: 'Cloudflare', server: 'stun.cloudflare.com' },
    { name: 'Twilio', server: 'global.stun.twilio.com' },
    { name: 'Mozilla', server: 'stun.services.mozilla.com' },
  ];

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">STUN Tester</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>STUN (Session Traversal Utilities for NAT)</strong> helps discover your public IP address
          and port when behind a NAT router, essential for peer-to-peer connections.
        </p>
      </div>

      <form onSubmit={handleTest} className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            STUN Server
          </label>
          <input
            type="text"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="stun.l.google.com"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Port
          </label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="3478"
            min="1"
            max="65535"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Testing...' : 'Get Public Address'}
        </button>
      </form>

      {/* Quick server selection */}
      <div className="mb-6">
        <p className="text-sm font-medium mb-2">Public STUN Servers:</p>
        <div className="flex flex-wrap gap-2">
          {publicServers.map((srv) => (
            <button
              key={srv.server}
              onClick={() => setServer(srv.server)}
              className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              {srv.name}
            </button>
          ))}
        </div>
      </div>

      {/* Response display */}
      {response && (
        <div className={`rounded-lg p-4 ${
          response.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <h2 className="font-semibold mb-3">
            {response.success ? '✓ Success' : '✗ Error'}
          </h2>

          {response.success ? (
            <div className="space-y-2">
              {response.reflexiveAddress && (
                <div className="font-mono text-sm">
                  <span className="font-semibold">Public Address:</span>{' '}
                  {response.reflexiveAddress}:{response.reflexivePort}
                </div>
              )}
              {response.mappedAddress && (
                <div className="font-mono text-sm">
                  <span className="font-semibold">Mapped Address:</span>{' '}
                  {response.mappedAddress}:{response.mappedPort}
                </div>
              )}
              <div className="mt-4 pt-4 border-t border-green-200">
                <p className="text-sm text-green-800">
                  This is how other peers on the internet will see your connection.
                  Use this information for NAT traversal in WebRTC or P2P applications.
                </p>
              </div>
            </div>
          ) : (
            <div className="text-red-800">
              <p className="font-mono text-sm">{response.error}</p>
            </div>
          )}
        </div>
      )}

      {/* NAT Type explanation */}
      <div className="mt-8 p-4 bg-gray-50 rounded-lg">
        <h3 className="font-semibold mb-2">About NAT Types</h3>
        <ul className="text-sm space-y-1 text-gray-700">
          <li><strong>Full Cone NAT:</strong> Most permissive, easiest for P2P</li>
          <li><strong>Restricted Cone NAT:</strong> Only allows traffic from previously contacted addresses</li>
          <li><strong>Port-Restricted Cone NAT:</strong> Like restricted, but also checks port numbers</li>
          <li><strong>Symmetric NAT:</strong> Most restrictive, difficult for P2P (requires TURN relay)</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security Considerations

1. **No Authentication**: Basic STUN has no authentication - anyone can query a STUN server
2. **Limited Integrity**: MESSAGE-INTEGRITY attribute provides HMAC-SHA1 but requires shared secret
3. **Fingerprint**: FINGERPRINT attribute (CRC-32) provides basic integrity check against accidental corruption
4. **Privacy**: STUN reveals your public IP - this is by design but may be a privacy concern
5. **DDoS Amplification**: Open STUN servers can be used for amplification attacks - rate limit public servers
6. **TLS Support**: Use STUN over TLS (port 5349) for confidentiality when needed
7. **Validation**: Always validate magic cookie and transaction IDs

## Testing

```bash
# Test with public STUN server
curl -X POST http://localhost:8787/api/stun \
  -H "Content-Type: application/json" \
  -d '{"server": "stun.l.google.com", "port": 3478}'

# Expected response:
{
  "success": true,
  "reflexiveAddress": "203.0.113.1",
  "reflexivePort": 54321
}

# Test with authentication (TURN servers)
curl -X POST http://localhost:8787/api/stun \
  -H "Content-Type: application/json" \
  -d '{
    "server": "turn.example.com",
    "port": 3478,
    "username": "user",
    "password": "pass"
  }'

# Use command-line STUN client
npm install -g stun
stun stun.l.google.com

# Use stunserver (Linux)
sudo apt install stun-client
stunclient stun.l.google.com 3478
```

## Resources

- **RFC 5389**: Session Traversal Utilities for NAT (STUN)
- **RFC 8489**: STUN Update (current version)
- **RFC 5766**: TURN (Traversal Using Relays around NAT)
- **RFC 8445**: ICE (Interactive Connectivity Establishment)
- [IANA STUN Attributes](https://www.iana.org/assignments/stun-parameters/stun-parameters.xhtml)
- [WebRTC Samples](https://webrtc.github.io/samples/)
- [Public STUN Servers](https://gist.github.com/mondain/b0ec1cf5f60ae726202e)

## Notes

- **ICE Integration**: STUN is typically used as part of ICE (Interactive Connectivity Establishment)
- **TURN Fallback**: When STUN fails (symmetric NAT), use TURN relay servers
- **UDP Preferred**: While STUN supports TCP, UDP is more common and efficient
- **Multiple Queries**: For NAT type detection, multiple STUN queries are needed
- **Port Prediction**: Some NAT traversal techniques use STUN with port prediction
- **Keep-Alives**: NAT bindings timeout - send periodic STUN Binding Indications to keep them alive
- **IPv6**: STUN supports IPv6 with family code 0x02
- **WebRTC**: Modern WebRTC APIs handle STUN/TURN/ICE automatically via RTCPeerConnection
