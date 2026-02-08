# OpenVPN Protocol

## Overview

**OpenVPN** is an open-source VPN protocol that creates secure point-to-point or site-to-site connections using SSL/TLS for key exchange. It's one of the most widely used VPN protocols due to its flexibility, strong security, and cross-platform support.

**Port:** 1194 (UDP/TCP, configurable)
**Transport:** UDP (preferred), TCP (fallback)
**Security:** SSL/TLS, Pre-shared keys, Certificates

## Protocol Specification

### OpenVPN Packet Structure

OpenVPN packets have two main formats:

**Control Channel (TLS):**
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Opcode & Key |    Session ID (8 bytes)                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       HMAC (optional)                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Packet ID (4 bytes)                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   TLS Payload (variable)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Data Channel (Encrypted):**
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Opcode & Key |    Peer ID (3 bytes, TCP mode only)           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       HMAC (optional)                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Packet ID (4 bytes)                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|               Encrypted Payload (variable)                    |
|                   (IP packet encrypted)                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Opcode Field

**High 5 bits: Opcode**
- `0x1` - P_CONTROL_HARD_RESET_CLIENT_V1
- `0x2` - P_CONTROL_HARD_RESET_SERVER_V1
- `0x3` - P_CONTROL_SOFT_RESET_V1
- `0x4` - P_CONTROL_V1
- `0x5` - P_ACK_V1
- `0x6` - P_DATA_V1
- `0x7` - P_CONTROL_HARD_RESET_CLIENT_V2
- `0x8` - P_CONTROL_HARD_RESET_SERVER_V2
- `0x9` - P_DATA_V2

**Low 3 bits: Key ID**
- 0-7: Key slot identifier

### Connection Establishment

1. **Client Hello**: P_CONTROL_HARD_RESET_CLIENT_V2
2. **Server Hello**: P_CONTROL_HARD_RESET_SERVER_V2
3. **TLS Handshake**: Exchange certificates, negotiate cipher
4. **Key Generation**: Derive encryption keys from TLS session
5. **Options Exchange**: Push VPN configuration (routes, DNS, etc.)
6. **Data Transfer**: Encrypted IP packets (P_DATA_V2)

### Authentication Methods

**Certificate-based (most common):**
- X.509 certificates with PKI
- Client and server certificates
- Certificate Revocation List (CRL) support

**Username/Password:**
- Optional in addition to certificates
- Sent over TLS connection
- Can use PAM, LDAP, RADIUS

**Pre-shared Key (static):**
- Single shared secret key
- Less secure, no perfect forward secrecy
- Simpler for point-to-point VPNs

### Encryption Ciphers

**Data Channel:**
- AES-256-GCM (default, modern)
- AES-256-CBC (legacy)
- AES-128-GCM
- ChaCha20-Poly1305

**Control Channel:**
- TLS 1.3 (modern)
- TLS 1.2 (legacy, still supported)
- Perfect Forward Secrecy (PFS)

### Configuration Directives

**Server:**
```
port 1194
proto udp
dev tun
ca ca.crt
cert server.crt
key server.key
dh dh2048.pem
server 10.8.0.0 255.255.255.0
push "redirect-gateway def1"
push "dhcp-option DNS 8.8.8.8"
keepalive 10 120
cipher AES-256-GCM
auth SHA256
user nobody
group nogroup
persist-key
persist-tun
```

**Client:**
```
client
dev tun
proto udp
remote vpn.example.com 1194
resolv-retry infinite
nobind
persist-key
persist-tun
ca ca.crt
cert client.crt
key client.key
cipher AES-256-GCM
auth SHA256
verb 3
```

## Worker Implementation

```typescript
// workers/openvpn.ts
import { connect } from 'cloudflare:sockets';

interface OpenVPNConfig {
  server: string;
  port?: number;
  protocol?: 'udp' | 'tcp';
}

interface OpenVPNResponse {
  success: boolean;
  connected?: boolean;
  serverHello?: boolean;
  error?: string;
  sessionId?: string;
}

const Opcode = {
  P_CONTROL_HARD_RESET_CLIENT_V1: 0x01,
  P_CONTROL_HARD_RESET_SERVER_V1: 0x02,
  P_CONTROL_SOFT_RESET_V1: 0x03,
  P_CONTROL_V1: 0x04,
  P_ACK_V1: 0x05,
  P_DATA_V1: 0x06,
  P_CONTROL_HARD_RESET_CLIENT_V2: 0x07,
  P_CONTROL_HARD_RESET_SERVER_V2: 0x08,
  P_DATA_V2: 0x09,
} as const;

class OpenVPNClient {
  private config: Required<OpenVPNConfig>;
  private socket: any = null;
  private sessionId: Uint8Array;
  private packetId: number = 1;

  constructor(config: OpenVPNConfig) {
    this.config = {
      server: config.server,
      port: config.port || 1194,
      protocol: config.protocol || 'udp',
    };

    // Generate random session ID
    this.sessionId = new Uint8Array(8);
    crypto.getRandomValues(this.sessionId);
  }

  async connect(): Promise<void> {
    this.socket = connect({
      hostname: this.config.server,
      port: this.config.port,
    });
  }

  async handshake(): Promise<OpenVPNResponse> {
    if (!this.socket) {
      await this.connect();
    }

    try {
      // Send Client Hello (HARD_RESET_CLIENT_V2)
      const clientHello = this.buildClientHello();
      await this.sendPacket(clientHello);

      // Wait for Server Hello (HARD_RESET_SERVER_V2)
      const serverResponse = await this.receivePacket();

      if (!serverResponse) {
        return { success: false, error: 'No response from server' };
      }

      const opcode = this.getOpcode(serverResponse);

      if (opcode === Opcode.P_CONTROL_HARD_RESET_SERVER_V2) {
        const serverSessionId = this.getSessionId(serverResponse);

        return {
          success: true,
          connected: true,
          serverHello: true,
          sessionId: Array.from(serverSessionId)
            .map(b => b.toString(16).padStart(2, '0'))
            .join(''),
        };
      } else {
        return {
          success: false,
          error: `Unexpected opcode: 0x${opcode.toString(16)}`,
        };
      }

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildClientHello(): Uint8Array {
    // Simplified Client Hello packet (no HMAC, no TLS payload yet)
    const buffer = new Uint8Array(14);
    const view = new DataView(buffer.buffer);

    // Opcode (high 5 bits) + Key ID (low 3 bits)
    buffer[0] = (Opcode.P_CONTROL_HARD_RESET_CLIENT_V2 << 3) | 0x00;

    // Session ID (8 bytes)
    buffer.set(this.sessionId, 1);

    // Packet ID (4 bytes) - replay protection
    view.setUint32(9, this.packetId++, false);

    // In real implementation, would add:
    // - HMAC for authentication
    // - TLS ClientHello payload
    // - ACK array for reliability

    return buffer;
  }

  private getOpcode(packet: Uint8Array): number {
    return (packet[0] >> 3) & 0x1F;
  }

  private getKeyId(packet: Uint8Array): number {
    return packet[0] & 0x07;
  }

  private getSessionId(packet: Uint8Array): Uint8Array {
    return packet.slice(1, 9);
  }

  private async sendPacket(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async receivePacket(): Promise<Uint8Array | null> {
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

    if (url.pathname === '/api/openvpn/handshake') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        const config = await request.json() as OpenVPNConfig;

        if (!config.server) {
          return new Response(JSON.stringify({ error: 'Server is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const client = new OpenVPNClient(config);
        const response = await client.handshake();
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
// src/components/OpenVPNTester.tsx
import React, { useState } from 'react';

interface OpenVPNResponse {
  success: boolean;
  connected?: boolean;
  serverHello?: boolean;
  error?: string;
  sessionId?: string;
}

export default function OpenVPNTester() {
  const [server, setServer] = useState('');
  const [port, setPort] = useState('1194');
  const [protocol, setProtocol] = useState<'udp' | 'tcp'>('udp');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<OpenVPNResponse | null>(null);

  const handleHandshake = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch('/api/openvpn/handshake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server,
          port: parseInt(port, 10),
          protocol,
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
      <h1 className="text-3xl font-bold mb-6">OpenVPN Tester</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>OpenVPN</strong> is an open-source VPN protocol using SSL/TLS for secure tunneling.
          This tester performs the initial handshake to verify server availability.
        </p>
      </div>

      <form onSubmit={handleHandshake} className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            OpenVPN Server
          </label>
          <input
            type="text"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="vpn.example.com"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Port
            </label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="1194"
              min="1"
              max="65535"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Protocol
            </label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as 'udp' | 'tcp')}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="udp">UDP (Recommended)</option>
              <option value="tcp">TCP (Fallback)</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Connecting...' : 'Test Connection'}
        </button>
      </form>

      {/* Response display */}
      {response && (
        <div className={`rounded-lg p-4 ${
          response.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <h2 className="font-semibold mb-3">
            {response.success ? '✓ Handshake Successful' : '✗ Connection Failed'}
          </h2>

          {response.success && response.serverHello ? (
            <div className="space-y-2 font-mono text-sm">
              <div><strong>Status:</strong> Server responded to initial handshake</div>
              {response.sessionId && (
                <div><strong>Session ID:</strong> {response.sessionId}</div>
              )}
              <div className="mt-3 pt-3 border-t border-green-200 text-green-800 font-sans">
                <p className="text-sm">
                  Server is reachable and responding to OpenVPN protocol. Full TLS negotiation and
                  authentication would follow in a complete implementation.
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
        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">OpenVPN Features</h3>
          <ul className="text-sm space-y-1 text-gray-700 list-disc ml-5">
            <li>Strong encryption (AES-256-GCM, ChaCha20-Poly1305)</li>
            <li>Perfect Forward Secrecy (PFS)</li>
            <li>Certificate-based authentication (PKI)</li>
            <li>Username/password authentication</li>
            <li>UDP and TCP support</li>
            <li>Works through NAT and firewalls</li>
            <li>Cross-platform (Linux, Windows, macOS, mobile)</li>
            <li>Split-tunneling support</li>
          </ul>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">OpenVPN Modes</h3>
          <div className="text-sm space-y-2 text-gray-700">
            <div>
              <strong>TUN (Layer 3, IP routing):</strong>
              <ul className="list-disc ml-5 mt-1">
                <li>Routes IP packets</li>
                <li>Most common mode</li>
                <li>Lower overhead</li>
                <li>Used for remote access VPN</li>
              </ul>
            </div>
            <div>
              <strong>TAP (Layer 2, Ethernet bridging):</strong>
              <ul className="list-disc ml-5 mt-1">
                <li>Bridges Ethernet frames</li>
                <li>Supports non-IP protocols</li>
                <li>Higher overhead</li>
                <li>Used for site-to-site VPN</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2">UDP vs TCP</h3>
          <div className="text-sm space-y-2 text-gray-700">
            <div>
              <strong>UDP (Recommended):</strong>
              <ul className="list-disc ml-5 mt-1">
                <li>Lower latency</li>
                <li>Better for real-time traffic</li>
                <li>No TCP-over-TCP issues</li>
                <li>Handles packet loss better</li>
              </ul>
            </div>
            <div>
              <strong>TCP (Fallback):</strong>
              <ul className="list-disc ml-5 mt-1">
                <li>Works through restrictive firewalls</li>
                <li>Guaranteed delivery</li>
                <li>Higher latency</li>
                <li>TCP meltdown risk (TCP-over-TCP)</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="font-semibold mb-2 text-yellow-900">Note</h3>
          <p className="text-sm text-yellow-800">
            This tester only performs the initial protocol handshake. A full OpenVPN connection
            requires TLS negotiation, certificate validation, key derivation, and tunnel setup.
          </p>
        </div>
      </div>
    </div>
  );
}
```

## Security Considerations

1. **Strong Encryption**: Use AES-256-GCM or ChaCha20-Poly1305
2. **TLS 1.3**: Disable legacy TLS versions
3. **Certificate Validation**: Properly validate server certificates
4. **Perfect Forward Secrecy**: Ensure PFS is enabled
5. **HMAC Authentication**: Use SHA-256 or stronger
6. **Key Management**: Secure storage of private keys
7. **CRL/OCSP**: Implement certificate revocation
8. **Cipher Hardening**: Disable weak ciphers
9. **DNS Leak Prevention**: Use VPN DNS servers
10. **Kill Switch**: Block traffic if VPN disconnects

## Testing

```bash
# Test with OpenVPN client
sudo openvpn --config client.ovpn

# Check connection status
openvpn --show-tls

# Test server availability
nc -zv vpn.example.com 1194

# Monitor OpenVPN traffic
sudo tcpdump -i any port 1194 -w openvpn.pcap

# Test API endpoint
curl -X POST http://localhost:8787/api/openvpn/handshake \
  -H "Content-Type: application/json" \
  -d '{
    "server": "vpn.example.com",
    "port": 1194,
    "protocol": "udp"
  }'

# Expected response:
{
  "success": true,
  "connected": true,
  "serverHello": true,
  "sessionId": "a1b2c3d4e5f60708"
}
```

## Resources

- [OpenVPN Official Site](https://openvpn.net/)
- [OpenVPN Community](https://community.openvpn.net/)
- [OpenVPN Protocol Documentation](https://openvpn.net/community-resources/reference-manual-for-openvpn-2-6/)
- [OpenVPN GitHub](https://github.com/OpenVPN/openvpn)
- [OpenVPN Hardening Guide](https://community.openvpn.net/openvpn/wiki/Hardening)
- [WireGuard](https://www.wireguard.com/) - Modern alternative

## Notes

- **Open Source**: GPL-licensed, widely audited
- **Cross-Platform**: Clients for all major platforms
- **Performance**: Good performance but slower than WireGuard
- **Complexity**: More complex than modern alternatives (WireGuard)
- **Flexibility**: Highly configurable
- **Enterprise Adoption**: Widely used in enterprises
- **Mobile Support**: Official apps for iOS and Android
- **Commercial Version**: OpenVPN Access Server (paid, easier management)
- **Port Flexibility**: Can run on any port, even 443 (HTTPS) for firewall bypass
- **Compression**: LZO/LZ4 compression available (but adds overhead)
- **IPv6**: Full IPv6 support
- **Default Cipher**: AES-256-GCM (as of OpenVPN 2.4+)
