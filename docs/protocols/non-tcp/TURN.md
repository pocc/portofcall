# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**TURN** (Traversal Using Relays around NAT) is a protocol that allows clients behind restrictive NATs or firewalls to relay their traffic through a TURN server. When direct peer-to-peer connections fail (e.g., symmetric NAT), TURN provides a guaranteed fallback by relaying all traffic through a server.

**Port:** 3478 (TCP/UDP), 5349 (TLS)
**Transport:** TCP or UDP
**RFC:** 8656 (replaces RFC 5766)

## Protocol Specification

### Message Structure

TURN uses the STUN message format with additional methods and attributes:

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

### TURN Methods

**Request Types:**
- `0x0003` - Allocate (request relay address)
- `0x0004` - Refresh (refresh allocation)
- `0x0006` - Send (send data via relay)
- `0x0007` - Data (receive data from peer)
- `0x0008` - CreatePermission (allow traffic from peer)
- `0x0009` - ChannelBind (bind channel number to peer)

### TURN-Specific Attributes

- `0x000C` - CHANNEL-NUMBER
- `0x000D` - LIFETIME (allocation duration)
- `0x0010` - BANDWIDTH (reserved)
- `0x0012` - XOR-PEER-ADDRESS
- `0x0013` - DATA
- `0x0016` - XOR-RELAYED-ADDRESS
- `0x0017` - EVEN-PORT
- `0x0018` - REQUESTED-TRANSPORT (protocol to relay)
- `0x0019` - DONT-FRAGMENT
- `0x001A` - ACCESS-TOKEN (OAuth)
- `0x0022` - RESERVATION-TOKEN

### Channel Data Message

For efficient data transfer, TURN supports ChannelData messages:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         Channel Number        |            Length             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                       Application Data                        |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

Channel numbers: `0x4000` - `0x7FFF`

### Typical Flow

1. **Allocate**: Client requests relay address
2. **CreatePermission**: Client authorizes peer addresses
3. **ChannelBind**: (Optional) Bind channel for efficiency
4. **Send/Data**: Exchange data via relay or channel
5. **Refresh**: Keep allocation alive
6. **Delete**: Release allocation

## Worker Implementation

```typescript
// workers/turn.ts
import { connect } from 'cloudflare:sockets';

interface TURNConfig {
  server: string;
  port?: number;
  username: string;
  password: string;
  transport?: 'udp' | 'tcp';
}

interface TURNAttribute {
  type: number;
  value: Uint8Array;
}

interface TURNMessage {
  messageType: number;
  transactionId: Uint8Array;
  attributes: TURNAttribute[];
}

interface TURNAllocation {
  relayAddress?: string;
  relayPort?: number;
  lifetime?: number;
}

interface TURNResponse {
  success: boolean;
  allocation?: TURNAllocation;
  error?: string;
}

const MAGIC_COOKIE = 0x2112A442;

const MessageType = {
  ALLOCATE_REQUEST: 0x0003,
  ALLOCATE_SUCCESS: 0x0103,
  ALLOCATE_ERROR: 0x0113,
  REFRESH_REQUEST: 0x0004,
  REFRESH_SUCCESS: 0x0104,
  SEND_INDICATION: 0x0016,
  DATA_INDICATION: 0x0017,
  CREATE_PERMISSION_REQUEST: 0x0008,
  CREATE_PERMISSION_SUCCESS: 0x0108,
  CHANNEL_BIND_REQUEST: 0x0009,
  CHANNEL_BIND_SUCCESS: 0x0109,
} as const;

const AttributeType = {
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  REALM: 0x0014,
  NONCE: 0x0015,
  XOR_RELAYED_ADDRESS: 0x0016,
  XOR_PEER_ADDRESS: 0x0012,
  DATA: 0x0013,
  CHANNEL_NUMBER: 0x000C,
  LIFETIME: 0x000D,
  REQUESTED_TRANSPORT: 0x0019,
  DONT_FRAGMENT: 0x001A,
  FINGERPRINT: 0x8028,
  SOFTWARE: 0x8022,
} as const;

class TURNClient {
  private config: Required<TURNConfig>;
  private socket: any = null;
  private realm: string = '';
  private nonce: string = '';

  constructor(config: TURNConfig) {
    this.config = {
      server: config.server,
      port: config.port || 3478,
      username: config.username,
      password: config.password,
      transport: config.transport || 'tcp',
    };
  }

  async connect(): Promise<void> {
    this.socket = connect({
      hostname: this.config.server,
      port: this.config.port,
    });
  }

  async allocate(): Promise<TURNResponse> {
    if (!this.socket) {
      await this.connect();
    }

    try {
      // First attempt (will get 401 with realm/nonce)
      const transactionId1 = new Uint8Array(12);
      crypto.getRandomValues(transactionId1);

      const request1 = this.encodeAllocateRequest(transactionId1, false);

      const writer = this.socket.writable.getWriter();
      await writer.write(request1);
      writer.releaseLock();

      const reader = this.socket.readable.getReader();
      const { value: response1 } = await reader.read();
      reader.releaseLock();

      if (!response1) {
        return { success: false, error: 'No response from server' };
      }

      const parsed1 = this.decodeMessage(response1);

      // Extract realm and nonce from 401 response
      if (parsed1.messageType === MessageType.ALLOCATE_ERROR) {
        const errorAttr = parsed1.attributes.find(a => a.type === AttributeType.ERROR_CODE);
        if (errorAttr) {
          const errorCode = this.parseErrorCode(errorAttr.value);
          if (!errorCode.startsWith('401')) {
            return { success: false, error: errorCode };
          }
        }

        const realmAttr = parsed1.attributes.find(a => a.type === AttributeType.REALM);
        const nonceAttr = parsed1.attributes.find(a => a.type === AttributeType.NONCE);

        if (realmAttr && nonceAttr) {
          this.realm = new TextDecoder().decode(realmAttr.value);
          this.nonce = new TextDecoder().decode(nonceAttr.value);
        }
      }

      // Second attempt with authentication
      const transactionId2 = new Uint8Array(12);
      crypto.getRandomValues(transactionId2);

      const request2 = this.encodeAllocateRequest(transactionId2, true);

      const writer2 = this.socket.writable.getWriter();
      await writer2.write(request2);
      writer2.releaseLock();

      const reader2 = this.socket.readable.getReader();
      const { value: response2 } = await reader2.read();
      reader2.releaseLock();

      if (!response2) {
        return { success: false, error: 'No response to authenticated request' };
      }

      const parsed2 = this.decodeMessage(response2);

      if (parsed2.messageType === MessageType.ALLOCATE_ERROR) {
        const errorAttr = parsed2.attributes.find(a => a.type === AttributeType.ERROR_CODE);
        return {
          success: false,
          error: errorAttr ? this.parseErrorCode(errorAttr.value) : 'Allocation failed',
        };
      }

      if (parsed2.messageType !== MessageType.ALLOCATE_SUCCESS) {
        return { success: false, error: 'Unexpected response type' };
      }

      // Extract relay address
      const relayAttr = parsed2.attributes.find(a => a.type === AttributeType.XOR_RELAYED_ADDRESS);
      const lifetimeAttr = parsed2.attributes.find(a => a.type === AttributeType.LIFETIME);

      if (!relayAttr) {
        return { success: false, error: 'No relay address in response' };
      }

      const { address, port } = this.parseXorAddress(relayAttr.value, transactionId2);
      const lifetime = lifetimeAttr ? new DataView(lifetimeAttr.value.buffer).getUint32(0) : undefined;

      return {
        success: true,
        allocation: {
          relayAddress: address,
          relayPort: port,
          lifetime,
        },
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private encodeAllocateRequest(transactionId: Uint8Array, withAuth: boolean): Uint8Array {
    const attributes: TURNAttribute[] = [];

    // REQUESTED-TRANSPORT (always UDP = 17)
    const transportValue = new Uint8Array(4);
    transportValue[0] = 17; // UDP
    attributes.push({ type: AttributeType.REQUESTED_TRANSPORT, value: transportValue });

    if (withAuth && this.realm && this.nonce) {
      // USERNAME
      const usernameValue = new TextEncoder().encode(this.config.username);
      attributes.push({ type: AttributeType.USERNAME, value: usernameValue });

      // REALM
      const realmValue = new TextEncoder().encode(this.realm);
      attributes.push({ type: AttributeType.REALM, value: realmValue });

      // NONCE
      const nonceValue = new TextEncoder().encode(this.nonce);
      attributes.push({ type: AttributeType.NONCE, value: nonceValue });
    }

    // SOFTWARE (optional)
    const softwareValue = new TextEncoder().encode('Cloudflare Workers TURN Client');
    attributes.push({ type: AttributeType.SOFTWARE, value: softwareValue });

    const message: TURNMessage = {
      messageType: MessageType.ALLOCATE_REQUEST,
      transactionId,
      attributes,
    };

    let encoded = this.encodeMessage(message);

    // Add MESSAGE-INTEGRITY if authenticated
    if (withAuth && this.realm && this.nonce) {
      encoded = this.addMessageIntegrity(encoded, this.config.username, this.realm, this.config.password);
    }

    return encoded;
  }

  private encodeMessage(message: TURNMessage): Uint8Array {
    // Calculate attributes length
    const attributesLength = message.attributes.reduce((sum, attr) => {
      return sum + 4 + attr.value.length + this.getPadding(attr.value.length);
    }, 0);

    const totalLength = 20 + attributesLength;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    const array = new Uint8Array(buffer);

    // Message Type
    view.setUint16(0, message.messageType);

    // Message Length
    view.setUint16(2, attributesLength);

    // Magic Cookie
    view.setUint32(4, MAGIC_COOKIE);

    // Transaction ID
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

  private async addMessageIntegrity(message: Uint8Array, username: string, realm: string, password: string): Promise<Uint8Array> {
    // Calculate HMAC-SHA1 key
    const key = await this.computeLongTermKey(username, realm, password);

    // Adjust message length to include MESSAGE-INTEGRITY attribute
    const view = new DataView(message.buffer);
    const currentLength = view.getUint16(2);
    view.setUint16(2, currentLength + 24); // MESSAGE-INTEGRITY = 4 (header) + 20 (HMAC-SHA1)

    // Import key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    // Calculate HMAC
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
    const hmac = new Uint8Array(signature);

    // Build new message with MESSAGE-INTEGRITY
    const newMessage = new Uint8Array(message.length + 24);
    newMessage.set(message);

    const newView = new DataView(newMessage.buffer);
    const offset = message.length;

    newView.setUint16(offset, AttributeType.MESSAGE_INTEGRITY);
    newView.setUint16(offset + 2, 20);
    newMessage.set(hmac, offset + 4);

    return newMessage;
  }

  private async computeLongTermKey(username: string, realm: string, password: string): Promise<Uint8Array> {
    const credentials = `${username}:${realm}:${password}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(credentials);

    const hashBuffer = await crypto.subtle.digest('MD5', data);
    return new Uint8Array(hashBuffer);
  }

  private decodeMessage(data: Uint8Array): TURNMessage {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const messageType = view.getUint16(0);
    const messageLength = view.getUint16(2);
    const transactionId = data.slice(8, 20);

    const attributes: TURNAttribute[] = [];
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

  private parseXorAddress(value: Uint8Array, transactionId: Uint8Array): { address: string; port: number } {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    const family = view.getUint8(1);
    const xPort = view.getUint16(2);
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
    }

    throw new Error(`Unsupported address family: ${family}`);
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

    if (url.pathname === '/api/turn') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const { server, port, username, password, transport } = await request.json() as TURNConfig;

        if (!server || !username || !password) {
          return new Response(JSON.stringify({ error: 'Server, username, and password are required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const client = new TURNClient({ server, port, username, password, transport });
        const response = await client.allocate();
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
// src/components/TURNTester.tsx
import React, { useState } from 'react';

interface TURNAllocation {
  relayAddress?: string;
  relayPort?: number;
  lifetime?: number;
}

interface TURNResponse {
  success: boolean;
  allocation?: TURNAllocation;
  error?: string;
}

export default function TURNTester() {
  const [server, setServer] = useState('');
  const [port, setPort] = useState('3478');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<TURNResponse | null>(null);

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch('/api/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server,
          port: parseInt(port, 10),
          username,
          password,
          transport: 'tcp',
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
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">TURN Tester</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>TURN (Traversal Using Relays around NAT)</strong> provides a relay server for cases where
          direct peer-to-peer connection is impossible (e.g., symmetric NAT). All traffic is relayed through
          the TURN server.
        </p>
      </div>

      <form onSubmit={handleTest} className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            TURN Server
          </label>
          <input
            type="text"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="turn.example.com"
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

        <div>
          <label className="block text-sm font-medium mb-2">
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="username"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="password"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Allocating...' : 'Allocate Relay Address'}
        </button>
      </form>

      {/* Response display */}
      {response && (
        <div className={`rounded-lg p-4 ${
          response.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <h2 className="font-semibold mb-3">
            {response.success ? '✓ Allocation Success' : '✗ Error'}
          </h2>

          {response.success && response.allocation ? (
            <div className="space-y-2">
              <div className="font-mono text-sm">
                <span className="font-semibold">Relay Address:</span>{' '}
                {response.allocation.relayAddress}:{response.allocation.relayPort}
              </div>
              {response.allocation.lifetime && (
                <div className="font-mono text-sm">
                  <span className="font-semibold">Lifetime:</span>{' '}
                  {response.allocation.lifetime} seconds ({Math.floor(response.allocation.lifetime / 60)} minutes)
                </div>
              )}
              <div className="mt-4 pt-4 border-t border-green-200">
                <p className="text-sm text-green-800">
                  Your relay address is now allocated. Peers can send data to this address, and it will be
                  relayed to you. Remember to refresh the allocation before it expires.
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

      {/* Information boxes */}
      <div className="mt-8 space-y-4">
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="font-semibold mb-2 text-yellow-900">⚠️ Cost Consideration</h3>
          <p className="text-sm text-yellow-800">
            TURN servers relay all media/data traffic, consuming significant bandwidth. This makes TURN the
            most expensive component of WebRTC infrastructure. Use TURN only as a fallback when direct
            connection fails.
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">STUN vs TURN</h3>
          <div className="text-sm space-y-2 text-gray-700">
            <div>
              <strong>STUN (Preferred):</strong>
              <ul className="list-disc ml-5 mt-1">
                <li>Discovers public IP address</li>
                <li>No media relay - direct P2P connection</li>
                <li>Low bandwidth usage</li>
                <li>Works with Full Cone, Restricted, Port-Restricted NAT</li>
              </ul>
            </div>
            <div>
              <strong>TURN (Fallback):</strong>
              <ul className="list-disc ml-5 mt-1">
                <li>Relays all traffic through server</li>
                <li>High bandwidth usage</li>
                <li>Works with Symmetric NAT and restrictive firewalls</li>
                <li>Guaranteed connectivity (if TURN server is reachable)</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">Public TURN Providers</h3>
          <ul className="text-sm space-y-1 text-gray-700">
            <li><strong>Twilio:</strong> Managed TURN infrastructure for WebRTC</li>
            <li><strong>Cloudflare Calls:</strong> Global TURN network</li>
            <li><strong>Xirsys:</strong> TURN-as-a-Service</li>
            <li><strong>Self-hosted:</strong> coturn (open-source TURN server)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
```

## Security Considerations

1. **Authentication Required**: TURN servers MUST require authentication (unlike STUN)
2. **Long-term Credentials**: Username/password (hashed with MD5)
3. **Short-term Credentials**: Time-limited tokens (recommended for WebRTC)
4. **MESSAGE-INTEGRITY**: HMAC-SHA1 authentication on all requests
5. **Bandwidth Limits**: Rate-limit allocations to prevent abuse
6. **Quota Management**: Limit concurrent allocations per user
7. **TLS/DTLS**: Use encrypted transport (ports 5349, 5350)
8. **DoS Protection**: TURN amplification attacks - validate source addresses
9. **Access Control**: Restrict who can allocate relay addresses

## Testing

```bash
# Test TURN allocation
curl -X POST http://localhost:8787/api/turn \
  -H "Content-Type: application/json" \
  -d '{
    "server": "turn.example.com",
    "port": 3478,
    "username": "user",
    "password": "pass"
  }'

# Expected response:
{
  "success": true,
  "allocation": {
    "relayAddress": "198.51.100.1",
    "relayPort": 50000,
    "lifetime": 600
  }
}

# Test with coturn (self-hosted TURN server)
# Install coturn
sudo apt install coturn

# Configure /etc/turnserver.conf
listening-port=3478
fingerprint
lt-cred-mech
user=testuser:testpass
realm=example.com

# Start coturn
sudo turnserver -v

# Test with turnutils
turnutils_uclient -u testuser -w testpass turn.example.com
```

## Resources

- **RFC 8656**: TURN (current version, replaces RFC 5766)
- **RFC 5766**: TURN (original specification)
- **RFC 6062**: TURN Extensions for TCP Allocations
- **RFC 7065**: TURN URI Scheme
- [coturn](https://github.com/coturn/coturn) - Open-source TURN server
- [WebRTC samples](https://webrtc.github.io/samples/) - Browser examples
- [IANA TURN Parameters](https://www.iana.org/assignments/stun-parameters/)

## Notes

- **ICE Integration**: TURN is used within ICE framework alongside STUN
- **Bandwidth Costs**: TURN relays all media - can be expensive at scale
- **Allocation Lifetime**: Typically 10 minutes, requires periodic refresh
- **Permission Management**: Must create permissions for each peer address
- **Channel Binding**: Use channels (0x4000-0x7FFF) for efficient data transfer
- **Transport**: Supports UDP, TCP, and TLS
- **Relay Protocols**: Can relay UDP or TCP traffic
- **Multiple Allocations**: Client may need multiple allocations (audio, video, data channels)
- **coturn**: Most popular open-source TURN server implementation
- **WebRTC**: Modern browsers handle TURN automatically via ICE agent
