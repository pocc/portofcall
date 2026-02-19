# Shadowsocks Protocol Implementation

**File:** `src/worker/shadowsocks.ts`
**Default Port:** 8388 (highly configurable)
**Transport:** TCP
**Encryption:** AEAD ciphers (AES-256-GCM, ChaCha20-Poly1305)

## Overview

Shadowsocks is an encrypted proxy protocol designed for censorship circumvention. It was created in 2012 by a Chinese programmer known as "clowwindy" to bypass the Great Firewall of China. Unlike traditional VPN protocols, Shadowsocks is designed to be difficult to detect and block.

### Key Characteristics

1. **No plaintext handshake** — The connection opens silently with no banner or greeting
2. **Encrypted from first byte** — All traffic is encrypted using AEAD ciphers
3. **Stateless** — Each connection is independent
4. **Application-level** — Works as a SOCKS5 proxy, not a full VPN
5. **Detection resistance** — Traffic appears as random encrypted data

### AEAD Header Format

After encryption, Shadowsocks packets have this structure:

```
[salt (16-32 bytes)] [encrypted length (2 bytes + 16 byte tag)] [encrypted payload + tag]
```

- **Salt:** Random bytes for key derivation (size depends on cipher)
- **Encrypted length:** 2-byte payload length + 16-byte AEAD tag
- **Encrypted payload:** The actual SOCKS5 address header and data + 16-byte AEAD tag

### Why Detection is Difficult

Since Shadowsocks requires the encryption key to:
1. Decrypt the initial header
2. Understand the target destination
3. Exchange any meaningful data

...an external observer cannot probe a Shadowsocks server without the key. The server will simply wait silently for valid encrypted data.

## Implementation

Port of Call's Shadowsocks implementation performs TCP connectivity probes only. It:

1. Establishes a TCP connection to the server
2. Measures round-trip time (RTT) to the socket.opened event
3. Waits 500ms to check if the server sends unsolicited data
4. Reports whether the port is open and silent (consistent with Shadowsocks behavior)

This approach cannot:
- Confirm the server is actually running Shadowsocks (requires the encryption key)
- Perform encryption/decryption (key is secret)
- Test authentication or data transfer

It can:
- Verify the port is reachable and accepting connections
- Detect if a different service (like HTTP or SSH) is running on the port
- Measure basic connectivity metrics

## API Endpoint

### POST /api/shadowsocks/probe

Test TCP connectivity to a Shadowsocks server.

#### Request Body

```typescript
{
  host: string;        // Target hostname or IP address
  port?: number;       // Target port (default: 8388)
  timeout?: number;    // Timeout in milliseconds (default: 10000)
}
```

#### Response (Success)

**Status:** 200 OK

```json
{
  "success": true,
  "host": "example.com",
  "port": 8388,
  "rtt": 123,
  "portOpen": true,
  "silentOnConnect": true,
  "isShadowsocks": true,
  "note": "Port is open and server is silent — consistent with Shadowsocks behavior"
}
```

**Fields:**
- `success` (boolean) — Always `true` for successful probes
- `host` (string) — The hostname that was probed
- `port` (number) — The port that was probed
- `rtt` (number) — Round-trip time in milliseconds to socket.opened
- `portOpen` (boolean) — `true` if TCP connection succeeded
- `silentOnConnect` (boolean) — `true` if server sent no data within 500ms
- `isShadowsocks` (boolean) — `true` if behavior matches Shadowsocks (same as silentOnConnect)
- `bannerHex` (string, optional) — Hex dump of unexpected banner data if received
- `note` (string) — Human-readable interpretation

#### Response (Unexpected Banner)

**Status:** 200 OK

If the server sends data immediately (within 500ms), it's likely not Shadowsocks:

```json
{
  "success": true,
  "host": "example.com",
  "port": 80,
  "rtt": 45,
  "portOpen": true,
  "silentOnConnect": false,
  "isShadowsocks": false,
  "bannerHex": "485454502f312e3120343030204261642052657175657374",
  "note": "Port is open but server sent data (27 bytes) — likely not Shadowsocks"
}
```

#### Response (Timeout)

**Status:** 504 Gateway Timeout

```json
{
  "success": false,
  "error": "Connection timeout",
  "portOpen": false
}
```

#### Response (Cloudflare-Protected)

**Status:** 403 Forbidden

```json
{
  "success": false,
  "error": "Cannot connect to example.com (104.21.45.67): This domain is protected by Cloudflare...",
  "isCloudflare": true
}
```

#### Response (Connection Failed)

**Status:** 500 Internal Server Error

```json
{
  "success": false,
  "error": "Connection refused",
  "portOpen": false
}
```

#### Response (Validation Error)

**Status:** 400 Bad Request

```json
{
  "success": false,
  "error": "Host is required"
}
```

Or:

```json
{
  "success": false,
  "error": "Port must be between 1 and 65535"
}
```

## Common Ports

- **8388** — Default Shadowsocks port (conventional)
- **443** — HTTPS port (often used to blend with HTTPS traffic)
- **80** — HTTP port (less common, more suspicious)
- **8080, 8443** — Alternative HTTP/HTTPS ports
- **Random high ports** — 1024-65535 (any unprivileged port can be used)

Port selection is entirely up to the server administrator. There is no "official" Shadowsocks port.

## Use Cases

### Infrastructure Health Checks
```bash
curl -X POST https://portofcall.example.com/api/shadowsocks/probe \
  -H "Content-Type: application/json" \
  -d '{"host": "shadowsocks.example.com", "port": 8388}' | jq .
```

### Verify Server Before Client Setup
Before configuring a Shadowsocks client, verify the server is reachable:

```bash
curl -X POST https://portofcall.example.com/api/shadowsocks/probe \
  -H "Content-Type: application/json" \
  -d '{"host": "10.20.30.40", "port": 8388}' | jq '.portOpen, .isShadowsocks'
```

### Detect Port Conflicts
If you accidentally run HTTP on port 8388 instead of Shadowsocks:

```bash
curl -X POST https://portofcall.example.com/api/shadowsocks/probe \
  -H "Content-Type: application/json" \
  -d '{"host": "localhost", "port": 8388}' | jq .
```

Expected output if HTTP is running:
```json
{
  "success": true,
  "portOpen": true,
  "silentOnConnect": false,
  "isShadowsocks": false,
  "bannerHex": "485454502f312e31203430302042616420526571756573740d0a...",
  "note": "Port is open but server sent data (97 bytes) — likely not Shadowsocks"
}
```

## Supported Ciphers (Reference)

Shadowsocks supports multiple AEAD ciphers. Port of Call does not implement encryption, but for reference, common ciphers include:

### AEAD Ciphers (Recommended)
- **aes-256-gcm** — AES-256 with Galois/Counter Mode (widely supported)
- **aes-192-gcm** — AES-192 variant (less common)
- **aes-128-gcm** — AES-128 variant (faster, slightly less secure)
- **chacha20-ietf-poly1305** — ChaCha20 stream cipher with Poly1305 MAC (mobile-friendly)
- **xchacha20-ietf-poly1305** — Extended-nonce variant of ChaCha20 (recommended for high-traffic servers)

### Stream Ciphers (Deprecated)
- **aes-256-cfb, aes-192-cfb, aes-128-cfb** — CFB mode (vulnerable, do not use)
- **aes-256-ctr, aes-192-ctr, aes-128-ctr** — CTR mode (vulnerable, do not use)
- **rc4-md5** — RC4 stream cipher (completely broken, do not use)

**Important:** Only AEAD ciphers should be used in production. Stream ciphers are vulnerable to known attacks.

## Protocol Versions

### Shadowsocks AEAD (Current)
- Introduced in 2017 as SIP004 and SIP007
- Replaces stream ciphers with authenticated encryption
- Each payload chunk is independently encrypted and authenticated
- Salt is sent with each connection (no nonce reuse)

### Shadowsocks Stream (Legacy)
- Original design (2012-2017)
- Used stream ciphers (AES-CFB, RC4, etc.)
- Vulnerable to replay attacks and chosen-plaintext attacks
- **Do not use**

### Shadowsocks-libev vs. Shadowsocks-rust vs. Shadowsocks-go
All implementations follow the same protocol specification. Differences:
- **shadowsocks-libev** — C implementation, low resource usage
- **shadowsocks-rust** — Rust implementation, memory-safe, modern
- **shadowsocks-go** — Go implementation, easy to deploy
- **shadowsocks-windows** — C# implementation for Windows

Port of Call's detection works with all implementations.

## Limitations

### Cannot Verify Encryption
Without the server's encryption key, Port of Call cannot:
- Decrypt the initial handshake
- Send a valid SOCKS5 request
- Confirm the server is actually running Shadowsocks (vs. a silent TCP echo service)

### Cannot Test Authentication
Shadowsocks does not have a built-in authentication protocol beyond the shared encryption key. The key serves as both encryption and authentication.

### Cannot Distinguish Shadowsocks from Silent Services
Any TCP service that accepts connections but sends no banner will be reported as "consistent with Shadowsocks behavior." This includes:
- Silent honeypots
- Broken services waiting for client-first protocols
- Custom proxy implementations

### No TLS Support
Port of Call uses the Cloudflare Sockets API, which does not support TLS wrapping (as of February 2026). Shadowsocks servers behind TLS (e.g., using stunnel or nginx stream proxy) cannot be directly tested.

### No UDP Support
Shadowsocks supports UDP relay for DNS and other datagram protocols. Port of Call only tests TCP connectivity.

### No Plugin Testing
Shadowsocks supports plugins (v2ray-plugin, obfs, simple-obfs) for additional obfuscation. Port of Call cannot detect or test these.

### Cloudflare-Protected Hosts
Cloudflare Workers cannot connect to Cloudflare-proxied domains. If the target is behind Cloudflare, the probe will return HTTP 403.

## Cloudflare Detection

Before attempting a connection, Port of Call checks if the target host resolves to a Cloudflare IP address using DNS-over-HTTPS (DoH). If detected, the request is rejected with HTTP 403 and a helpful error message:

```json
{
  "success": false,
  "error": "Cannot connect to example.com (104.21.45.67): This domain is protected by Cloudflare. Cloudflare Workers cannot connect to Cloudflare-proxied domains due to security restrictions. Please try connecting to a non-Cloudflare-protected server, or use the origin IP directly if available.",
  "isCloudflare": true
}
```

This prevents wasted timeouts and clarifies the limitation.

## Security Considerations

### Not a Vulnerability Scanner
This implementation performs basic connectivity tests only. It does not:
- Exploit vulnerabilities in Shadowsocks servers
- Attempt to brute-force encryption keys
- Perform man-in-the-middle attacks
- Log or intercept user traffic

### Server Fingerprinting
The probe reveals:
- TCP port is open and accepting connections
- Server behavior (silent vs. banner)
- Approximate RTT

It does not reveal:
- Encryption cipher in use
- Server version or implementation
- Active users or traffic volume
- Encryption key

### Rate Limiting
Consider implementing rate limiting on the API endpoint to prevent:
- Abuse as a port scanner
- Distributed denial-of-service (DDoS) via reflection
- Resource exhaustion

## Direct Shadowsocks Usage (Reference)

Port of Call does not provide a full Shadowsocks client. To actually use Shadowsocks for proxying traffic, you need:

### 1. Server Setup

Using shadowsocks-rust:
```bash
# Install
cargo install shadowsocks-rust

# Run server
ssserver -s "0.0.0.0:8388" -m "aes-256-gcm" -k "YourSecretPassword" -U
```

### 2. Client Setup

Using shadowsocks-rust:
```bash
# Install
cargo install shadowsocks-rust

# Run local client
sslocal -s "server.example.com:8388" -m "aes-256-gcm" -k "YourSecretPassword" -b "127.0.0.1:1080"
```

This creates a SOCKS5 proxy on localhost:1080 that forwards traffic through the Shadowsocks server.

### 3. Browser/App Configuration

Point your browser or application to the SOCKS5 proxy:
- **Host:** 127.0.0.1
- **Port:** 1080
- **Type:** SOCKS5

Or use system-wide proxy settings.

### 4. JSON Configuration

Most Shadowsocks clients support JSON config files:

```json
{
  "server": "server.example.com",
  "server_port": 8388,
  "local_address": "127.0.0.1",
  "local_port": 1080,
  "password": "YourSecretPassword",
  "timeout": 300,
  "method": "aes-256-gcm"
}
```

Save as `config.json` and run:
```bash
sslocal -c config.json
```

## Testing

### Local Shadowsocks Server

Start a test server using Docker:

```bash
docker run -d --name shadowsocks \
  -p 8388:8388 \
  shadowsocks/shadowsocks-libev \
  ss-server -s 0.0.0.0 -p 8388 -k testpassword -m aes-256-gcm
```

### Test with Port of Call

```bash
curl -X POST http://localhost:8787/api/shadowsocks/probe \
  -H "Content-Type: application/json" \
  -d '{"host": "localhost", "port": 8388}' | jq .
```

Expected output:
```json
{
  "success": true,
  "host": "localhost",
  "port": 8388,
  "rtt": 2,
  "portOpen": true,
  "silentOnConnect": true,
  "isShadowsocks": true,
  "note": "Port is open and server is silent — consistent with Shadowsocks behavior"
}
```

### Test with Wrong Port

Try probing an HTTP server:
```bash
curl -X POST http://localhost:8787/api/shadowsocks/probe \
  -H "Content-Type: application/json" \
  -d '{"host": "localhost", "port": 80}' | jq .
```

Expected output:
```json
{
  "success": true,
  "host": "localhost",
  "port": 80,
  "rtt": 1,
  "portOpen": true,
  "silentOnConnect": false,
  "isShadowsocks": false,
  "bannerHex": "485454502f312e31203430302042616420526571756573740d0a...",
  "note": "Port is open but server sent data (97 bytes) — likely not Shadowsocks"
}
```

### Cleanup

```bash
docker stop shadowsocks
docker rm shadowsocks
```

## Resources

### Official Documentation
- [Shadowsocks GitHub](https://github.com/shadowsocks) — Organization with all official implementations
- [shadowsocks-rust](https://github.com/shadowsocks/shadowsocks-rust) — Recommended Rust implementation
- [SIP004 - AEAD Ciphers](https://shadowsocks.org/en/wiki/SIP004-AEAD-Ciphers.html) — AEAD spec
- [SIP007 - Replay Attack Protection](https://shadowsocks.org/en/wiki/SIP007-Replay-Attack-Protection.html) — Security improvements

### Clients
- [Shadowsocks for Windows](https://github.com/shadowsocks/shadowsocks-windows)
- [ShadowsocksX-NG for macOS](https://github.com/shadowsocks/ShadowsocksX-NG)
- [Shadowsocks for Android](https://github.com/shadowsocks/shadowsocks-android)
- [Outline](https://getoutline.org/) — User-friendly Shadowsocks client and server manager

### Security Research
- [Shadowsocks: A Censorship Circumvention System](https://www.usenix.org/conference/foci21/presentation/bock) — Academic paper on detection resistance
- [Active Probing Attacks Against Shadowsocks](https://gfw.report/blog/ss_probe/en/) — Analysis of GFW detection methods

### Alternative Protocols
- **V2Ray** — More feature-rich proxy with multiple protocols (includes Shadowsocks)
- **Trojan** — TLS-based proxy disguised as HTTPS
- **Wireguard** — Modern VPN protocol (not a proxy, but often compared)
- **SOCKS5** — Standard proxy protocol (no encryption unless tunneled over SSH/TLS)

## Comparison: Shadowsocks vs. SOCKS5

| Feature | Shadowsocks | SOCKS5 |
|---------|-------------|--------|
| Encryption | Built-in (AEAD) | None (plaintext) |
| Authentication | Shared key | Username/password (optional) |
| Detection resistance | High (appears as random data) | Low (plaintext headers) |
| Performance | Moderate (crypto overhead) | High (no crypto) |
| Setup complexity | Moderate (key management) | Low |
| Censorship bypass | Designed for it | Not designed for it |
| Protocol overhead | ~32 bytes per chunk (salt + tags) | ~10 bytes (SOCKS5 header) |
| Use case | Censorship circumvention | General proxying |

**When to use Shadowsocks:**
- Evading firewalls and censorship
- Encrypting proxy traffic end-to-end
- Accessing blocked services

**When to use SOCKS5:**
- Internal network proxying
- Tunneling through SSH (e.g., ssh -D)
- Legacy compatibility

## Implementation Notes

### Why TCP-Only Probe?

The Shadowsocks protocol encrypts all data from the first byte. Without the encryption key, there is no way to:

1. Send a valid encrypted header
2. Receive a meaningful response
3. Confirm the service is Shadowsocks

The best we can do is:
- Verify the port accepts TCP connections
- Confirm the server does not send unsolicited data (unlike HTTP, SSH, FTP)
- Measure basic connectivity metrics

This is sufficient for infrastructure monitoring and pre-deployment verification.

### Why Not Implement Full Encryption?

Implementing AEAD encryption in a Cloudflare Worker would require:
- Implementing AES-GCM or ChaCha20-Poly1305 in JavaScript/WebAssembly
- Managing encryption keys (security risk if stored in worker)
- Handling key derivation (HKDF with salt)
- Implementing the SOCKS5 protocol within the encrypted stream

This is outside the scope of a connectivity testing tool. If you need a full Shadowsocks client, use shadowsocks-rust, shadowsocks-libev, or a GUI client.

### Timeout Behavior

The probe uses two timeouts:

1. **Connection timeout** (default 10s) — Maximum time to wait for socket.opened
2. **Banner wait** (fixed 500ms) — Time to wait for server to send unsolicited data

The 500ms wait is intentionally short:
- Shadowsocks servers should send nothing (0ms response)
- HTTP/SSH/FTP servers send banners immediately (0-100ms response)
- 500ms is long enough to distinguish these cases

### Error Handling

All errors return HTTP 500 except:
- Validation errors: HTTP 400
- Timeout: HTTP 504
- Cloudflare-protected: HTTP 403

This follows HTTP semantic conventions for gateway/proxy errors.

## Changelog

### 2026-02-18 (Current Implementation)
- Initial Shadowsocks TCP connectivity probe
- Cloudflare IP detection and blocking
- Silent server detection (500ms wait for banner)
- Hex dump of unexpected banner data
- Timeout handling (10s default)
- Basic input validation (host, port range)

## Future Enhancements (Not Planned)

The following features are **not planned** for implementation, but listed for completeness:

- Full AEAD encryption/decryption
- SOCKS5 protocol implementation within encrypted stream
- UDP relay testing
- Plugin support (v2ray-plugin, obfs)
- Multi-server load balancing tests
- Bandwidth testing
- Latency histograms
- IPv6-specific testing
- TLS wrapper support
- Key derivation and rotation

Port of Call focuses on **connectivity testing**, not full protocol implementation. For production Shadowsocks usage, use dedicated clients and servers.
