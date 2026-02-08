# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**WireGuard** is a modern, extremely simple and fast VPN protocol that uses state-of-the-art cryptography. It's significantly faster and simpler than IPsec and OpenVPN, with a codebase of only ~4,000 lines of code compared to hundreds of thousands for alternatives.

**Port:** 51820 (UDP, configurable)
**Transport:** UDP
**Status:** Linux kernel mainline (since 5.6)

## Protocol Specification

### Cryptography

WireGuard uses a fixed set of modern cryptographic primitives:
- **ChaCha20** for symmetric encryption
- **Poly1305** for authentication
- **Curve25519** for ECDH key exchange
- **BLAKE2s** for hashing
- **SipHash** for hashtable keys
- **HKDF** for key derivation

### Packet Structure

**Handshake Initiation** (148 bytes):
```
Type (4 bytes = 1)
| Sender Index (4 bytes)
| Unencrypted Ephemeral (32 bytes)
| Encrypted Static (48 bytes)
| Encrypted Timestamp (28 bytes)
| MAC1 (16 bytes)
| MAC2 (16 bytes)
```

**Handshake Response** (92 bytes):
```
Type (4 bytes = 2)
| Sender Index (4 bytes)
| Receiver Index (4 bytes)
| Unencrypted Ephemeral (32 bytes)
| Encrypted Nothing (16 bytes)
| MAC1 (16 bytes)
| MAC2 (16 bytes)
```

**Data Packet**:
```
Type (4 bytes = 4)
| Receiver Index (4 bytes)
| Counter (8 bytes)
| Encrypted Payload (variable)
```

### Key Concepts

1. **Cryptokey Routing**: Each peer has a public key and list of allowed IPs
2. **Silent Until Spoken To**: No response to unauthenticated packets
3. **Connectionless**: No connection state, just keys
4. **Built-in Roaming**: Survives IP address changes
5. **Perfect Forward Secrecy**: Keys rotated every 2 minutes

### Configuration Example

```ini
[Interface]
PrivateKey = <base64-encoded-private-key>
Address = 10.0.0.1/24
ListenPort = 51820

[Peer]
PublicKey = <base64-encoded-public-key>
AllowedIPs = 10.0.0.2/32
Endpoint = peer.example.com:51820
PersistentKeepalive = 25
```

## Worker Implementation

```typescript
// workers/wireguard.ts

// Note: WireGuard is a kernel-level VPN protocol
// This is a simplified representation for protocol analysis
// Real implementation requires kernel modules or userspace implementations

interface WireGuardConfig {
  endpoint: string;
  port?: number;
  publicKey: string;
  allowedIPs: string[];
}

interface WireGuardResponse {
  success: boolean;
  handshake?: boolean;
  error?: string;
}

// WireGuard packet types
const MessageType = {
  HANDSHAKE_INITIATION: 1,
  HANDSHAKE_RESPONSE: 2,
  COOKIE_REPLY: 3,
  TRANSPORT_DATA: 4,
} as const;

class WireGuardAnalyzer {
  private config: Required<WireGuardConfig>;

  constructor(config: WireGuardConfig) {
    this.config = {
      endpoint: config.endpoint,
      port: config.port || 51820,
      publicKey: config.publicKey,
      allowedIPs: config.allowedIPs,
    };
  }

  analyzePacket(data: Uint8Array): {
    type: string;
    valid: boolean;
    details: any;
  } {
    if (data.length < 4) {
      return { type: 'unknown', valid: false, details: {} };
    }

    const view = new DataView(data.buffer, data.byteOffset);
    const messageType = view.getUint32(0, true); // little-endian

    switch (messageType) {
      case MessageType.HANDSHAKE_INITIATION:
        return this.analyzeHandshakeInitiation(data);
      case MessageType.HANDSHAKE_RESPONSE:
        return this.analyzeHandshakeResponse(data);
      case MessageType.COOKIE_REPLY:
        return { type: 'cookie_reply', valid: data.length === 64, details: {} };
      case MessageType.TRANSPORT_DATA:
        return this.analyzeTransportData(data);
      default:
        return { type: 'unknown', valid: false, details: { messageType } };
    }
  }

  private analyzeHandshakeInitiation(data: Uint8Array) {
    const expectedLength = 148;
    const valid = data.length === expectedLength;

    const view = new DataView(data.buffer, data.byteOffset);
    const senderIndex = view.getUint32(4, true);

    return {
      type: 'handshake_initiation',
      valid,
      details: {
        length: data.length,
        expectedLength,
        senderIndex,
      },
    };
  }

  private analyzeHandshakeResponse(data: Uint8Array) {
    const expectedLength = 92;
    const valid = data.length === expectedLength;

    const view = new DataView(data.buffer, data.byteOffset);
    const senderIndex = view.getUint32(4, true);
    const receiverIndex = view.getUint32(8, true);

    return {
      type: 'handshake_response',
      valid,
      details: {
        length: data.length,
        expectedLength,
        senderIndex,
        receiverIndex,
      },
    };
  }

  private analyzeTransportData(data: Uint8Array) {
    if (data.length < 16) {
      return { type: 'transport_data', valid: false, details: { error: 'Too short' } };
    }

    const view = new DataView(data.buffer, data.byteOffset);
    const receiverIndex = view.getUint32(4, true);

    // Counter is 8 bytes (little-endian)
    const counterLow = view.getUint32(8, true);
    const counterHigh = view.getUint32(12, true);
    const counter = counterLow + (counterHigh * 0x100000000);

    const payloadLength = data.length - 16;

    return {
      type: 'transport_data',
      valid: true,
      details: {
        receiverIndex,
        counter,
        payloadLength,
      },
    };
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    return new Response(JSON.stringify({
      info: 'WireGuard protocol analyzer',
      note: 'WireGuard requires kernel-level implementation',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
```

## Resources

- [WireGuard Website](https://www.wireguard.com/)
- [WireGuard Whitepaper](https://www.wireguard.com/papers/wireguard.pdf)
- [WireGuard Repository](https://git.zx2c4.com/wireguard-linux/)
- [Cloudflare WARP](https://1.1.1.1/) - Uses WireGuard
- [Tailscale](https://tailscale.com/) - Built on WireGuard

## Security Considerations

1. **Authenticated Encryption**: ChaCha20-Poly1305 AEAD
2. **Perfect Forward Secrecy**: Session keys rotated every 2 minutes
3. **Identity Hiding**: Public keys not revealed to unauthorized parties
4. **DoS Protection**: Cookie mechanism prevents resource exhaustion
5. **Replay Protection**: Counter-based nonce prevents replay attacks
6. **Key Distribution**: Out-of-band public key exchange (like SSH)
7. **No Cipher Negotiation**: Fixed cryptographic suite prevents downgrade attacks

## Testing

```bash
# Install WireGuard
# Ubuntu/Debian
sudo apt install wireguard

# macOS
brew install wireguard-tools

# Generate keys
wg genkey | tee privatekey | wg pubkey > publickey

# Configure interface
sudo ip link add dev wg0 type wireguard
sudo ip address add dev wg0 10.0.0.1/24
sudo wg setconf wg0 /etc/wireguard/wg0.conf
sudo ip link set up dev wg0

# Check status
sudo wg show

# Start WireGuard
sudo wg-quick up wg0

# Stop WireGuard
sudo wg-quick down wg0

# Monitor traffic
sudo tcpdump -i wg0 -n

# Test connectivity
ping 10.0.0.2
```

## Notes

- **Simplicity**: Only ~4,000 lines of code (vs ~400,000 for OpenVPN)
- **Performance**: Significantly faster than IPsec and OpenVPN
- **Modern Crypto**: Uses state-of-the-art cryptographic primitives
- **Stealth**: Silent to port scans, no response to invalid packets
- **Roaming**: Seamless IP address changes (mobile-friendly)
- **Kernel Integration**: Built into Linux kernel 5.6+
- **Cross-Platform**: Linux, Windows, macOS, Android, iOS, FreeBSD
- **No Configuration Complexity**: Simple INI-style config files
- **Automatic Reconnection**: Handles network interruptions gracefully
- **NAT-Friendly**: Works behind NAT without special configuration
- **Low Overhead**: Minimal packet overhead compared to alternatives
- **Cryptokey Routing**: Routes based on public keys, not IP addresses
- **vs OpenVPN**: Faster, simpler, more secure
- **vs IPsec**: Much simpler configuration, better performance
- **UDP Only**: No TCP mode (UDP is better for VPN encapsulation)
