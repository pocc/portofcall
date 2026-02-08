# Cloudflare Detection Feature

## Overview

Port of Call includes automatic detection of Cloudflare-protected hosts and prevents connection attempts to them. This is a **critical security limitation** imposed by Cloudflare's architecture.

## Why This Exists

Cloudflare Workers cannot connect to Cloudflare-proxied domains. This is by design to prevent:
- Workers from being used as open proxies
- Abuse of Cloudflare's infrastructure
- Security risks from Worker-to-Worker tunneling

## How It Works

When you attempt to connect to any host via FTP, SSH, or TCP ping, Port of Call:

1. **Resolves the hostname** to an IP address using DNS over HTTPS (DoH)
2. **Checks the IP** against known Cloudflare IP ranges
3. **Blocks the connection** if the IP belongs to Cloudflare
4. **Returns a helpful error** explaining the limitation

### Cloudflare IP Ranges

The detector checks against Cloudflare's published IP ranges:

**IPv4 Ranges:**
- 173.245.48.0/20
- 103.21.244.0/22
- 103.22.200.0/22
- 103.31.4.0/22
- 141.101.64.0/18
- 108.162.192.0/18
- 190.93.240.0/20
- 188.114.96.0/20
- 197.234.240.0/22
- 198.41.128.0/17
- 162.158.0.0/15
- 104.16.0.0/13
- 104.24.0.0/14
- 172.64.0.0/13
- 131.0.72.0/22

**IPv6 Ranges:**
- 2400:cb00::/32
- 2606:4700::/32
- 2803:f800::/32
- 2405:b500::/32
- 2405:8100::/32
- 2a06:98c0::/29
- 2c0f:f248::/32

## Error Response

When a Cloudflare-protected host is detected, you'll receive:

```json
{
  "success": false,
  "isCloudflare": true,
  "error": "Cannot connect to example.com (104.16.1.1): This domain is protected by Cloudflare. Cloudflare Workers cannot connect to Cloudflare-proxied domains due to security restrictions. Please try connecting to a non-Cloudflare-protected server, or use the origin IP directly if available."
}
```

**HTTP Status:** `403 Forbidden`

## Workarounds

If you need to connect to a service behind Cloudflare:

### Option 1: Use the Origin IP
If you have access to the origin server's IP address (not proxied through Cloudflare), you can connect directly:

```javascript
// Instead of:
host: "myserver.example.com"  // ❌ Cloudflare-proxied

// Use:
host: "203.0.113.42"          // ✅ Direct origin IP
```

### Option 2: Disable Cloudflare Proxy
If you control the domain, you can:
1. Go to Cloudflare DNS settings
2. Toggle the orange cloud icon to gray (DNS-only mode)
3. Wait for DNS propagation (5-30 minutes)

### Option 3: Use a Different Port of Call Instance
Deploy Port of Call on a non-Cloudflare platform:
- AWS Lambda + API Gateway
- Google Cloud Functions
- Azure Functions
- Your own VPS/dedicated server

## Testing Cloudflare Detection

Run the Cloudflare detection tests:

```bash
npm test tests/cloudflare-detection.test.ts
```

This will verify:
- Cloudflare-protected domains are blocked
- Cloudflare IPs are blocked
- Non-Cloudflare hosts work normally
- Error messages are helpful

## Updating IP Ranges

Cloudflare occasionally adds new IP ranges. To update:

1. Check official Cloudflare IP lists:
   - IPv4: https://www.cloudflare.com/ips-v4
   - IPv6: https://www.cloudflare.com/ips-v6

2. Update `src/worker/cloudflare-detector.ts`:
   ```typescript
   const CLOUDFLARE_IPV4_RANGES = [
     // Add new ranges here
   ];
   ```

3. Run tests to verify:
   ```bash
   npm test
   ```

## Architecture Notes

The Cloudflare detection happens **before** any connection attempt, saving time and preventing error logs. The detection uses:

- **DNS over HTTPS (DoH)** for hostname resolution
- **CIDR range matching** for IPv4 addresses
- **Prefix matching** for IPv6 addresses (simplified but effective)

This approach is fast (typically <50ms) and accurate for all of Cloudflare's large IP blocks.

## Affected Protocols

Cloudflare detection applies to:
- ✅ FTP (all operations)
- ✅ SSH (HTTP test and WebSocket tunnel)
- ✅ TCP Ping
- ✅ Generic socket connections

## Common Cloudflare-Protected Services

Services you **cannot** connect to via Port of Call:
- Any site with orange cloud icon in Cloudflare DNS
- discord.com (uses Cloudflare)
- stackoverflow.com (uses Cloudflare)
- npmjs.com (uses Cloudflare)
- Many others

Services you **can** connect to:
- github.com (uses Fastly, not Cloudflare)
- google.com (uses Google infrastructure)
- aws.amazon.com (uses AWS infrastructure)
- Most FTP servers (typically not behind Cloudflare)
- Most SSH servers (typically not behind Cloudflare)

## Security Implications

This limitation is actually a **security feature**. Without it:
- Attackers could use Workers as anonymous proxies
- DDoS attacks could be amplified through Worker chains
- Cloudflare's network could be used against itself

By blocking Cloudflare-to-Cloudflare connections, the platform remains secure for all users.
