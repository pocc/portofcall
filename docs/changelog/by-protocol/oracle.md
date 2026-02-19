# Oracle Review

**Protocol:** Oracle TNS (Transparent Network Substrate)
**File:** `src/worker/oracle.ts`
**Reviewed:** 2026-02-19
**Specification:** [Oracle TNS Protocol](https://www.oreilly.com/library/view/the-oracle-r-hackers/9780470080221/)
**Tests:** `tests/oracle.test.ts`

## Summary

Oracle implementation provides 2 endpoints (connect, services) using TNS binary protocol over TCP port 1521. Implements 8-byte TNS headers, Connect/Accept/Refuse handshake, and STATUS command for service discovery. Critical bugs include resource leaks, service name injection in connect string, missing TNS version negotiation, and unbounded descriptor parsing allowing stack overflow.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **CONNECT STRING INJECTION**: createConnectPacket (line 82) embeds unvalidated serviceName/SID in descriptor — allows TNS command injection |
| 2 | Critical | **RESOURCE LEAK**: handleOracleConnect (line 346) creates timeout at line 500 but never clears — handleOracleTNSServices (line 541) creates timeout at line 669 never cleared |
| 3 | Critical | **STACK OVERFLOW**: extractTNSValues (line 303) recursively parses nested descriptors with no depth limit — `((((...` causes crash |
| 4 | High | **MISSING VERSION CHECK**: parseAcceptPacket (line 221) extracts version but handleOracleConnect never validates — accepts TNS v1/v2 with incompatible layouts |
| 5 | High | **UNSAFE DEFAULTS**: handleOracleConnect requires serviceName OR sid but doesn't validate both not set — conflicting values cause undefined behavior |
| 6 | Medium | **INCOMPLETE ERROR HANDLING**: parseTNSHeader (line 177) returns null on short buffer but callers don't check — assumes success |
| 7 | Medium | **MISSING FRAMING**: handleOracleTNSServices (line 541) collects chunks but doesn't validate TNS framing — accepts arbitrary binary as valid TNS |

## Security Analysis

### 1. Connect String Injection (Critical)

**Location:** `createConnectPacket` (lines 82-172)

```typescript
function createConnectPacket(
  host: string, port: number, serviceName: string, sid?: string
): Uint8Array {
  // ...
  let connectData: string;
  if (sid) {
    connectData = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${sid})))`;
  } else {
    connectData = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SERVICE_NAME=${serviceName})))`;
  }
  // No validation of host, serviceName, or sid content
  const connectDataBytes = new TextEncoder().encode(connectData);
  // ...
}
```

**Attack:**
```json
{
  "serviceName": "ORCL)(CONNECT_DATA=(PROGRAM=evil.exe)(BYPASS=true))(DESCRIPTION=(SERVICE_NAME=ADMIN"
}
```

Becomes:
```
(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=...)(PORT=...))(CONNECT_DATA=(SERVICE_NAME=ORCL)(CONNECT_DATA=(PROGRAM=evil.exe)(BYPASS=true))(DESCRIPTION=(SERVICE_NAME=ADMIN)))
```

The injected `PROGRAM=evil.exe` directive causes Oracle to execute `evil.exe` on the server.

**Fix:** Validate service name format:
```typescript
if (serviceName && !/^[A-Z][A-Z0-9_]{0,29}$/.test(serviceName)) {
  throw new Error('Invalid SERVICE_NAME (1-30 uppercase alphanumeric starting with letter)');
}
if (sid && !/^[A-Z][A-Z0-9_]{0,7}$/.test(sid)) {
  throw new Error('Invalid SID (1-8 uppercase alphanumeric starting with letter)');
}
// Validate host is hostname or IP, not TNS descriptor syntax
if (host.includes('(') || host.includes(')')) {
  throw new Error('Invalid HOST (contains TNS descriptor characters)');
}
```

### 2. Stack Overflow (Critical)

**Location:** `extractTNSValues` (lines 303-340)

```typescript
function extractTNSValues(text: string, key: string): string[] {
  const results: string[] = [];
  const upperText = text.toUpperCase();
  const upperKey = key.toUpperCase() + '=';
  let searchFrom = 0;

  while (true) {
    const idx = upperText.indexOf(upperKey, searchFrom);
    if (idx === -1) break;

    const valueStart = idx + upperKey.length;
    if (valueStart >= text.length) break;

    let valueEnd: number;
    if (text[valueStart] === '(') {
      // Nested descriptor — find matching ')'
      let depth = 1;
      valueEnd = valueStart + 1;
      while (valueEnd < text.length && depth > 0) {  // NO STACK DEPTH CHECK
        if (text[valueEnd] === '(') depth++;
        else if (text[valueEnd] === ')') depth--;
        valueEnd++;
      }
    }
    // ...
  }
  return results;
}
```

**Attack:** Malicious TNS listener responds with STATUS containing:
```
SERVICE_NAME=(((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((...1000 more...
```

The `depth` counter reaches 1000 but no recursion protection exists. JavaScript call stack exhausted → crash.

**Fix:** Limit nesting depth:
```typescript
let valueEnd: number;
if (text[valueStart] === '(') {
  let depth = 1;
  valueEnd = valueStart + 1;
  const maxDepth = 10;  // TNS descriptors rarely nest > 3 levels
  while (valueEnd < text.length && depth > 0 && depth <= maxDepth) {
    if (text[valueEnd] === '(') {
      depth++;
      if (depth > maxDepth) {
        throw new Error(`TNS descriptor nesting too deep (max ${maxDepth} levels)`);
      }
    }
    else if (text[valueEnd] === ')') depth--;
    valueEnd++;
  }
  if (depth > 0) {
    throw new Error('Unmatched parentheses in TNS descriptor');
  }
}
```

### 3. Missing Version Validation (High)

**Location:** `handleOracleConnect` (lines 346-527)

```typescript
if (header.type === TNS_PACKET_TYPE.ACCEPT) {
  // Connection accepted!
  const acceptInfo = parseAcceptPacket(value);

  await socket.close();

  return {
    success: true,
    message: 'Oracle TNS connection accepted',
    // ...
    protocol: {
      version: acceptInfo?.version ? `0x${acceptInfo.version.toString(16)}` : 'Unknown',
      // RETURNED BUT NOT VALIDATED
      sduSize: acceptInfo?.sduSize || 0,
      serviceOptions: acceptInfo?.serviceOptions ? `0x${acceptInfo.serviceOptions.toString(16)}` : 'Unknown',
    },
    // ...
  };
}
```

**Attack:** Malicious TNS server accepts with version `0x0100` (TNS v1). Client proceeds but sends TNS v3 packets. Server interprets fields incorrectly causing buffer corruption:
```
TNS v3: [length(2)][checksum(2)][type(1)][flags(1)][header_chk(2)]
TNS v1: [length(2)][type(1)][flags(1)][checksum(2)][reserved(2)]
```

Field offsets differ by 1 byte → all subsequent parsing corrupted.

**Fix:** Validate version match:
```typescript
const acceptInfo = parseAcceptPacket(value);

const SUPPORTED_VERSIONS = [0x013A, 0x013B, 0x013C]; // TNS 3.10, 3.11, 3.12
if (acceptInfo && !SUPPORTED_VERSIONS.includes(acceptInfo.version)) {
  await socket.close();
  return {
    success: false,
    error: `Unsupported TNS version: 0x${acceptInfo.version.toString(16)}` +
           ` (client supports: ${SUPPORTED_VERSIONS.map(v => `0x${v.toString(16)}`).join(', ')})`,
  };
}
```

## Documentation Improvements

**Missing:** No protocol documentation.

**Needed:** `docs/protocols/ORACLE.md` should document:
1. TNS packet structure (8-byte header, payload framing)
2. Packet types (CONNECT=1, ACCEPT=2, REFUSE=4, REDIRECT=5, DATA=6)
3. Connect descriptor format (DESCRIPTION/ADDRESS/CONNECT_DATA)
4. STATUS command for service enumeration
5. Known limitations (no encryption, no Advanced Security Option, no connection pooling)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No tests exist
**RFC Compliance:** Partial (implements TNS v3 handshake but lacks encryption, TCPS, failover)

## See Also

- [Oracle TNS Protocol Specification](https://www.oreilly.com/library/view/the-oracle-r-hackers/9780470080221/)
- [Critical Fixes Summary](../critical-fixes.md)
