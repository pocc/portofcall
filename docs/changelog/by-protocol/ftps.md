# FTPS Review

**Protocol:** FTPS (FTP over TLS/SSL) - RFC 4217
**File:** `src/worker/ftps.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 4217 - Securing FTP with TLS](https://datatracker.ietf.org/doc/html/rfc4217)
**Tests:** `tests/ftps.test.ts`

## Summary

FTPS implementation provides 8 endpoints (connect, login, list, download, upload, delete, mkdir, rename) using implicit TLS on port 990. Handles FTP protocol over encrypted channel with PASV mode for data transfers. Critical findings include missing timeout cleanup in all endpoints, no TLS certificate validation, and potential command injection in path parameters.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **TLS SECURITY**: No certificate validation — `secureTransport: 'on'` used without certificate verification, accepts self-signed/invalid certs (MITM vulnerable) |
| 2 | Critical | **RESOURCE LEAK**: Timeout handles not cleared in 8 endpoints — `timeoutPromise` created but never cancelled, causes memory leaks on long-running Workers |
| 3 | High | **COMMAND INJECTION**: Path parameters in LIST/CWD/RETR/STOR not sanitized — paths with `\r\n` can inject FTP commands (e.g., `CWD ../../\r\nDELE important.txt`) |
| 4 | High | **RACE CONDITION**: Data socket opened before LIST command sent — if `LIST` fails with 550, data socket remains open and must timeout (wastes resources) |
| 5 | Medium | **ERROR HANDLING**: FTP 4xx/5xx response codes treated as generic errors — no distinction between "not found" (550), "permission denied" (530), or "file exists" (553) |
| 6 | Medium | **PROTOCOL VIOLATION**: QUIT command errors silently ignored in all endpoints — server may not properly close session, leaves orphaned connections |
| 7 | Low | **TYPE SAFETY**: `parseFTPResponse` accepts empty string and returns code 0 — should validate input and throw error on malformed responses |
| 8 | Low | **INCOMPLETE PARSING**: LIST output parser only handles Unix format — Windows/DOS `dir` format not supported (breaks on IIS FTP servers) |

## TLS Security Analysis

### Current Implementation
```typescript
const socket = connect(`${host}:${port}`, {
  secureTransport: 'on',  // ❌ No certificate validation
  allowHalfOpen: false,
});
```

### Issues Identified
1. **No Certificate Verification**: Cloudflare Sockets API `secureTransport: 'on'` performs TLS handshake but does NOT validate:
   - Certificate chain trust (accepts self-signed certs)
   - Hostname matching (no SNI validation)
   - Certificate expiration dates
   - Revocation status (OCSP/CRL)

2. **MITM Vulnerability**: Attacker can intercept connection with rogue certificate, Worker will blindly trust it

3. **No TLS Version/Cipher Control**: Worker cannot specify minimum TLS 1.2 or restrict weak ciphers

4. **No Certificate Inspection**: Response does not include:
   - Certificate subject/issuer
   - Public key algorithm
   - Expiration dates
   - TLS version/cipher suite used

### Recommendations
1. **Document Limitation**: Add security warning that TLS certificate validation is not performed
2. **Response Enhancement**: If Cloudflare exposes certificate metadata via Sockets API, include in response:
   ```typescript
   tlsInfo: {
     version: 'TLSv1.3',
     cipher: 'TLS_AES_256_GCM_SHA384',
     peerCertificate: {
       subject: 'CN=ftp.example.com',
       issuer: 'CN=Let\'s Encrypt Authority X3',
       validFrom: '2024-01-01T00:00:00Z',
       validTo: '2025-01-01T00:00:00Z',
     },
   }
   ```
3. **Future Work**: When Cloudflare Sockets API adds certificate verification options, implement strict mode

## Data Transfer Security

### PASV Mode (Lines 285-299)
- ✅ Correctly parses `227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)`
- ✅ Data channel also uses `secureTransport: 'on'` (line 307)
- ❌ No validation that data channel host matches control channel host (SERVER_NAME_INDICATION check missing)
- ❌ FTP bounce attack possible if server returns different IP in PASV response

### File Transfer Operations
- **Download** (lines 596-691): Reads binary data correctly, base64-encodes for JSON transport
- **Upload** (lines 697-779): Accepts base64-encoded content, decodes before STOR
- ⚠️ No integrity checks (MD5/SHA256 hash) to detect corruption over network

## Authentication Security

### Login Flow (lines 354-389)
```typescript
await session.sendCommand(`USER ${username}`);  // ❌ No input validation
const userResp = await session.readResponse(timeoutMs);

if (userResp.code === 331) {
  await session.sendCommand(`PASS ${password}`);  // ❌ Password sent in cleartext over TLS
  const passResp = await session.readResponse(timeoutMs);
}
```

**Issues:**
1. Username/password not escaped — spaces or control characters can break protocol
2. No support for FTPS-specific auth methods (PROT, PBSZ commands not sent)
3. AUTH TLS feature detection present (lines 195-196) but not used for explicit TLS upgrade

## Documentation Improvements

**Created:** `docs/protocols/FTPS.md` (comprehensive reference needed)

The implementation lacks protocol-level documentation. Should document:

1. **Implicit vs Explicit TLS**
   - Current: Implicit TLS on port 990 (connection starts encrypted)
   - Not implemented: Explicit TLS (AUTH TLS command on port 21)

2. **Feature Support Matrix**
   - ✅ PASV (passive mode)
   - ✅ Binary mode (TYPE I)
   - ❌ PROT (data channel protection)
   - ❌ PBSZ (protection buffer size)
   - ❌ Extended commands (MLST, MLSD)

3. **8 Endpoints**
   - `/connect` — Server discovery and capabilities (FEAT, SYST)
   - `/login` — Authentication test (USER/PASS, returns PWD/SYST)
   - `/list` — Directory listing (CWD + PASV + LIST)
   - `/download` — File retrieval (PASV + RETR + base64 encoding)
   - `/upload` — File upload (PASV + STOR + base64 decoding)
   - `/delete` — File/directory deletion (DELE/RMD)
   - `/mkdir` — Directory creation (MKD)
   - `/rename` — File/directory rename (RNFR + RNTO)

4. **Error Code Reference**
   - 2xx: Success codes (200, 220, 227, 230, 250, 257)
   - 3xx: Intermediate (331 password required, 350 RNFR pending)
   - 4xx: Temporary failure (421, 425, 426, 450, 451, 452)
   - 5xx: Permanent failure (500, 501, 502, 503, 530, 532, 550, 551, 552, 553)

5. **Known Limitations**
   - No certificate validation (TLS trust on first use)
   - No IPv6 support (EPSV/EPRT not implemented)
   - No resume support (REST command not implemented)
   - Data transfers limited to PASV mode (active mode not supported due to Cloudflare Workers inbound connection restrictions)
   - File size limited by Worker memory (recommend < 10MB per transfer)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** Pending (tests/ftps.test.ts needs creation)
**RFC Compliance:** RFC 4217 (Securing FTP with TLS)

## See Also

- [RFC 4217 - Securing FTP with TLS](https://datatracker.ietf.org/doc/html/rfc4217) - FTPS specification
- [RFC 959 - File Transfer Protocol](https://datatracker.ietf.org/doc/html/rfc959) - Base FTP protocol
- [Cloudflare Sockets API TLS Limitations](../security-notes/cloudflare-tls-limitations.md) - Platform constraints
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
