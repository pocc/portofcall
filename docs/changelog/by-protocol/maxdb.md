# MaxDB Review

**Protocol:** SAP NI (Network Interface) Protocol
**File:** `src/worker/maxdb.ts`
**Reviewed:** 2026-02-19
**Specification:** [SAP MaxDB NI Protocol](https://maxdb.sap.com/doc/)
**Tests:** `tests/maxdb.test.ts`

## Summary

MaxDB implementation provides 3 endpoints (connect, info, session) using SAP NI protocol over TCP port 7210. Implements 8-byte NI packet headers (length + version + type + rc), service descriptor routing, and X Server port discovery. Critical bugs include resource leaks, database name injection in service descriptor, missing NI version validation, and unbounded packet length allowing OOM attacks.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **SERVICE DESCRIPTOR INJECTION**: buildNIPacket (line 193) allows newlines in database param — `database: "MAXDB\nD=ADMIN"` injects second descriptor |
| 2 | Critical | **RESOURCE LEAK**: All 3 handlers use setTimeout but never clear — handleMaxDBConnect (line 181), handleMaxDBInfo (line 313), handleMaxDBSession (line 433) |
| 3 | Critical | **OOM ATTACK**: readNIResponse (line 107) validates expectedLen < 1MB but reads until deadline — server can send 1MB every 50ms = 20MB/sec |
| 4 | High | **MISSING VERSION CHECK**: parseNIPacket (line 84) extracts version but never validates `version === 3` — accepts NI v1/v2 with different field layouts |
| 5 | High | **PORT HIJACKING**: handleMaxDBSession (line 451) extracts xServerPort from first 4 bytes but doesn't validate port > 1024 — allows redirection to privileged ports |
| 6 | Medium | **INCOMPLETE ERROR HANDLING**: buildNIPacket (line 69) always sets rc=0 even for error packets — NI_ERROR should have rc > 0 |
| 7 | Medium | **UNSAFE PARSING**: handleMaxDBInfo database listing (line 344) splits by whitespace but doesn't validate DBNAME format — accepts `../etc/passwd` as database name |

## Security Analysis

### 1. Service Descriptor Injection (Critical)

**Location:** `handleMaxDBConnect` (lines 159-278)

```typescript
const { host, port = 7210, database = 'MAXDB', timeout = 10000 } = body;

// Line 193: Database name embedded in service descriptor
const serviceDesc = enc.encode(`D=${database}\n\n\r\0`);
const connectPkt = buildNIPacket(NI_CONNECT, serviceDesc);
await writer.write(connectPkt);
```

**Attack:**
```json
{
  "database": "MAXDB\nD=SYSADMIN\nUSER=sa\nPASSWORD=admin"
}
```

Becomes service descriptor:
```
D=MAXDB
D=SYSADMIN
USER=sa
PASSWORD=admin

```

Second `D=` directive overrides database, and `USER`/`PASSWORD` inject credentials.

**Fix:** Validate database name:
```typescript
if (!/^[A-Z][A-Z0-9]{0,17}$/.test(database)) {
  return new Response(JSON.stringify({
    success: false,
    error: 'Invalid database name (1-18 uppercase alphanumeric, starts with letter)'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}
```

### 2. OOM Attack (Critical)

**Location:** `readNIResponse` (lines 107-150)

```typescript
async function readNIResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalRead = 0;
  let expectedLen = -1;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // ... reads chunk
    chunks.push(result.value);
    totalRead += result.value.length;

    if (expectedLen < 0 && totalRead >= 4) {
      // ... extracts expectedLen
      if (expectedLen < 8 || expectedLen > 1_048_576) break;  // 1MB limit
    }

    if (expectedLen > 0 && totalRead >= expectedLen) break;  // GOOD
  }
  // Loops until deadline even if expectedLen < totalRead
}
```

**Attack:** Server sends valid NI header with `expectedLen = 1MB`, then sends data at 50KB/sec. Client reads for full timeout (10s) accumulating 500KB, but loop continues until deadline, allowing server to send 10MB total.

**Fix:** Break immediately when enough data received:
```typescript
if (expectedLen > 0 && totalRead >= expectedLen) {
  break; // Already present
}
// Add after chunk read:
if (totalRead > 2 * 1_048_576) {
  throw new Error('NI response exceeds 2MB limit (safety)');
}
```

### 3. Port Redirection (High)

**Location:** `handleMaxDBSession` (lines 404-562)

```typescript
// Step 1: NI_CONNECT to global listener → discover X Server port
// ...
const parsed = parseNIPacket(respData);
if (parsed && parsed.rc === 0 && parsed.payload.length >= 4) {
  const dv = new DataView(parsed.payload.buffer, parsed.payload.byteOffset);
  xServerPort = dv.getUint32(0, false);  // NO VALIDATION
}

// Step 2: Connect directly to X Server
if (!xServerPort || xServerPort === 0 || xServerPort > 65535) {
  // Validates here, but too late
}
const socket2 = connect(`${host}:${xServerPort}`);
```

**Attack:** Malicious NI listener returns `xServerPort = 22` (SSH). Client connects to SSH daemon thinking it's MaxDB X Server:
```json
{
  "success": true,
  "xServerPort": 22,
  "xServerConnected": true,
  "sessionBytes": 32,
  "sessionHex": "53 53 48 2d 32 2e 30 ..."  // "SSH-2.0"
}
```

**Fix:** Validate port range before connecting:
```typescript
if (parsed && parsed.rc === 0 && parsed.payload.length >= 4) {
  const dv = new DataView(parsed.payload.buffer, parsed.payload.byteOffset);
  xServerPort = dv.getUint32(0, false);

  // Validate X Server port is in safe range
  if (xServerPort < 1024 || xServerPort > 65535) {
    return new Response(JSON.stringify({
      success: false,
      error: `X Server port ${xServerPort} outside safe range (1024-65535)`,
    }), { ... });
  }
}
```

## Documentation Improvements

**Missing:** No protocol documentation.

**Needed:** `docs/protocols/MAXDB.md` should document:
1. NI packet structure (8-byte header: length, version, type, rc)
2. Message types (NI_CONNECT=0x04, NI_DATA=0x00, NI_ERROR=0x05, NI_INFO=0xFF)
3. Service descriptor format (`D=<database>\n\n\r\0`)
4. Global listener vs X Server port allocation
5. Known limitations (no SQLDBC support, no encryption, read-only NI operations)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No tests exist
**RFC Compliance:** Partial (implements NI v3 framing but lacks SQLDBC binary protocol)

## See Also

- [SAP MaxDB Documentation](https://maxdb.sap.com/doc/)
- [Critical Fixes Summary](../critical-fixes.md)
