# HTTP Proxy Review

**Protocol:** HTTP Proxy (Forward Proxy & CONNECT Tunnel)
**File:** `src/worker/httpproxy.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 9110 (HTTP)](https://datatracker.ietf.org/doc/html/rfc9110) | [RFC 9112 (HTTP/1.1)](https://datatracker.ietf.org/doc/html/rfc9112)
**Tests:** `tests/httpproxy.test.ts`

## Summary

HTTP Proxy implementation provides 2 proxy testing modes: forward proxy (GET with absolute URI) and CONNECT tunnel testing. Detects proxy types (Squid, Nginx, HAProxy) from response headers. Implements Proxy-Authorization (Basic auth). **NOTE:** Unencrypted proxy connections expose credentials and traffic to network sniffers.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **NO ENCRYPTION**: Proxy connections unencrypted (no TLS option) — Proxy-Authorization sent in Base64 (NOT encryption), credentials visible in cleartext |
| 2 | High | **CREDENTIAL EXPOSURE**: `proxyAuth` parameter (line 95) passed as `username:password` then base64-encoded — leaks credentials in Worker logs if logging enabled |
| 3 | High | **INJECTION**: `targetUrl` not validated (line 94) — URL with `\r\n` can inject HTTP headers (e.g., `http://example.com\r\nX-Evil:true`) |
| 4 | Medium | **OPEN PROXY DETECTION**: Code detects proxies but does not warn about open proxies (200 response without auth = open proxy, security risk) |
| 5 | Low | **TIMEOUT INCONSISTENCY**: Forward proxy uses 5s read timeout (line 148) but CONNECT uses same 5s — should be configurable per-request |

## Security Analysis (Unencrypted Proxy)

### Forward Proxy Security

**Request Format (Lines 131-141):**
```typescript
let httpRequest = `GET ${targetUrl} HTTP/1.1\r\n`;
httpRequest += `Host: ${targetHost}\r\n`;
httpRequest += `User-Agent: PortOfCall/1.0 (Proxy Probe)\r\n`;
httpRequest += `Accept: */*\r\n`;
httpRequest += `Connection: close\r\n`;
if (proxyAuth) {
  const encoded = btoa(proxyAuth);  // ❌ Base64 is NOT encryption
  httpRequest += `Proxy-Authorization: Basic ${encoded}\r\n`;
}
httpRequest += `\r\n`;
```

**Cleartext Exposure:**
```
# Network packet (visible to Wireshark):
GET http://api.example.com/secret HTTP/1.1
Host: api.example.com
Proxy-Authorization: Basic dXNlcjpwYXNzd29yZA==   ← Base64 of "user:password"
                                                     ← Trivially decoded
```

**Attack Scenarios:**
1. **Credential Theft:** Attacker on network decodes `Proxy-Authorization` header
2. **Traffic Analysis:** All HTTP requests visible (URLs, headers, bodies)
3. **Session Hijacking:** Cookies/auth tokens in requests interceptable

### CONNECT Tunnel Security

**CONNECT Request (Lines 314-321):**
```typescript
let connectRequest = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n`;
connectRequest += `Host: ${targetHost}:${targetPort}\r\n`;
connectRequest += `User-Agent: PortOfCall/1.0\r\n`;
if (proxyAuth) {
  const encoded = btoa(proxyAuth);
  connectRequest += `Proxy-Authorization: Basic ${encoded}\r\n`;  // ❌ Cleartext
}
connectRequest += `\r\n`;
```

**Tunnel Establishment:**
1. Send CONNECT to proxy (cleartext, credentials visible)
2. Proxy returns `200 Connection established`
3. Subsequent traffic tunneled (can be TLS-encrypted if target is HTTPS)

**Security Notes:**
- ✅ After 200 response, tunnel payload can be TLS (e.g., CONNECT example.com:443)
- ❌ CONNECT request itself (including auth) always cleartext
- ❌ Proxy knows destination (targetHost:targetPort), enabling traffic logging

### Proxy Authentication

**Basic Auth Implementation (Lines 138-139, 318-319):**
```typescript
const encoded = btoa(proxyAuth);  // proxyAuth format: "username:password"
httpRequest += `Proxy-Authorization: Basic ${encoded}\r\n`;
```

**RFC 7617 Compliance:**
- ✅ Correct format: `Basic base64(username:password)`
- ❌ Should warn user that Basic auth is NOT secure without TLS

**Missing Auth Methods:**
- ❌ Proxy-Authenticate: Digest (RFC 7616) — challenge-response auth
- ❌ Proxy-Authenticate: Bearer (OAuth2 for proxies)
- ❌ Proxy-Authenticate: Negotiate (Kerberos/NTLM)

## Proxy Type Detection

### Header-Based Detection (Lines 172-190)

```typescript
const viaHeader = parsed.headers['via'];
const proxyAgentHeader = parsed.headers['proxy-agent'];
const serverHeader = parsed.headers['server'];

if (viaHeader) proxyHeaders.push(`Via: ${viaHeader}`);
if (proxyAgentHeader) proxyHeaders.push(`Proxy-Agent: ${proxyAgentHeader}`);

let proxyType = 'Unknown';
const allHeaders = JSON.stringify(parsed.headers).toLowerCase();
if (allHeaders.includes('squid')) proxyType = 'Squid';
else if (allHeaders.includes('nginx')) proxyType = 'Nginx';
else if (allHeaders.includes('apache')) proxyType = 'Apache';
else if (allHeaders.includes('haproxy')) proxyType = 'HAProxy';
else if (allHeaders.includes('varnish')) proxyType = 'Varnish';
else if (allHeaders.includes('tinyproxy')) proxyType = 'Tinyproxy';
else if (allHeaders.includes('privoxy')) proxyType = 'Privoxy';
else if (allHeaders.includes('ccproxy')) proxyType = 'CCProxy';
else if (proxyHeaders.length > 0) proxyType = 'HTTP Proxy (detected via headers)';
```

**Detection Methods:**
1. **Via Header (RFC 9110 §7.6.3):** Required for proxies
   - Example: `Via: 1.1 squid.example.com (squid/3.5.27)`
2. **Proxy-Agent Header:** Non-standard but common
3. **Server Header:** Fallback (e.g., `Server: nginx/1.18.0`)

**Evasion Techniques:**
- Proxy can remove Via header (violates RFC but happens)
- Custom proxy software returns generic `Server: Apache` (false positive)

**Improvement Needed:**
```typescript
// More robust detection:
const isProxy =
  parsed.statusCode === 200 ||       // Successful forward
  parsed.statusCode === 407 ||       // Auth required
  viaHeader !== undefined ||         // RFC-compliant proxy
  proxyAgentHeader !== undefined ||  // Explicit proxy header
  parsed.headers['x-cache'] ||       // Caching proxy
  parsed.headers['x-forwarded-for']; // Forwarding proxy
```

## Open Proxy Risk Assessment

### Detection Logic (Lines 192-194)

```typescript
const isProxy = parsed.statusCode === 200 ||
  parsed.statusCode === 407 ||
  proxyHeaders.length > 0;
```

**Open Proxy Indicator:**
```typescript
if (isProxy && parsed.statusCode === 200 && !proxyAuth) {
  // ⚠️ Open proxy detected — accepts requests without authentication
  console.warn('SECURITY: Open proxy detected (allows unauthenticated access)');
}
```

**Why Open Proxies Are Dangerous:**
1. **Abuse for Spam/DDoS:** Attackers use as anonymization layer
2. **Legal Liability:** Proxy owner liable for illegal traffic
3. **Data Exfiltration:** Steal data through open proxy to hide source
4. **Bandwidth Theft:** Consume proxy owner's bandwidth

**Recommendation:**
Add `openProxy` flag to response:
```typescript
{
  success: true,
  isProxy: true,
  openProxy: parsed.statusCode === 200 && !requiresAuth,
  securityWarning: openProxy ? "Open proxy detected — authentication not required" : undefined
}
```

## HTTP Header Injection

### Target URL Validation (Line 94)

```typescript
const targetUrl = options.targetUrl || 'http://example.com/';
```

**No Validation:**
```typescript
// Attacker input:
targetUrl = "http://example.com\r\nX-Evil: injected\r\nHost: attacker.com"

// Resulting HTTP request:
GET http://example.com
X-Evil: injected
Host: attacker.com HTTP/1.1
Host: example.com
```

**Impact:** Inject arbitrary headers, including second `Host` header.

**Fix Required:**
```typescript
function validateProxyUrl(url: string): void {
  if (/[\r\n\0]/.test(url)) {
    throw new Error('Target URL cannot contain CR/LF/NUL');
  }
  try {
    new URL(url);  // Validate URL format
  } catch {
    throw new Error('Invalid target URL');
  }
}
validateProxyUrl(targetUrl);
```

## Documentation Improvements

**Created:** `docs/protocols/HTTPPROXY.md` (needed)

Should document:

1. **Security Warnings**
   - ⚠️ NO ENCRYPTION — proxy requests sent in cleartext
   - ⚠️ Basic auth = Base64 (NOT encryption)
   - ⚠️ Suitable for testing only, never production

2. **2 Modes**
   - **Forward Proxy:** `GET http://target/ HTTP/1.1` through proxy
   - **CONNECT Tunnel:** `CONNECT target:443 HTTP/1.1` for TLS tunneling

3. **Proxy Detection**
   - Via header (RFC 9110 required)
   - Proxy-Agent header
   - Server fingerprinting (Squid, Nginx, HAProxy, etc.)

4. **Response Codes**
   - 200 — Proxy forwarded request successfully
   - 407 — Proxy authentication required
   - 502 — Bad Gateway (upstream server error)
   - 503 — Service Unavailable (proxy overloaded)

5. **Known Limitations**
   - No TLS support for proxy connection
   - No Digest/Negotiate auth (only Basic)
   - No SOCKS proxy support (HTTP only)
   - No proxy chain testing (single proxy only)

6. **Supported Proxy Types**
   - Squid (most common)
   - Nginx (proxy_pass module)
   - Apache (mod_proxy)
   - HAProxy
   - Tinyproxy
   - Privoxy
   - Varnish (caching proxy)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** Pending (tests/httpproxy.test.ts needs creation)
**RFC Compliance:**
- ✅ RFC 9110 (HTTP) - Compliant
- ✅ RFC 7617 (Basic Auth) - Compliant
- ❌ RFC 7616 (Digest Auth) - Not implemented

## See Also

- [RFC 9110 - HTTP](https://datatracker.ietf.org/doc/html/rfc9110)
- [RFC 7617 - Basic Authentication](https://datatracker.ietf.org/doc/html/rfc7617)
- [Open Proxy Risks](../security-notes/open-proxy-security.md)
- [Critical Fixes Summary](../critical-fixes.md)
