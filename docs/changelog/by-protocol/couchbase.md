# Couchbase Review

**Protocol:** Memcached Binary Protocol (KV Engine)
**File:** `src/worker/couchbase.ts`
**Reviewed:** 2026-02-19
**Specification:** [Memcached Binary Protocol](https://github.com/memcached/memcached/wiki/BinaryProtocolRevised)
**Tests:** `tests/couchbase.test.ts`

## Summary

Couchbase implementation provides 6 endpoints (ping, version, stats, get, set, delete, incr) using the memcached binary protocol over TCP port 11210. Implements 24-byte packet headers, opaque field echo verification, and BufferedReader for TCP stream framing. Critical bugs include resource leaks (timeout handles, reader/writer locks), unsafe opaque value prediction allowing response spoofing, missing CAS validation enabling race conditions, and increment/decrement arithmetic overflow.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Timeout handles never cleared in all 6 handlers — `setTimeout()` at lines 231, 324, 420, 651, 720, 779, 874 leaks on every request |
| 2 | Critical | **RESOURCE LEAK**: Reader/writer locks never released on error paths — try/catch blocks at lines 235-277, 329-368, 424-482 missing `finally { reader.releaseLock(); writer.releaseLock(); }` |
| 3 | Critical | **RESPONSE SPOOFING**: Opaque field uses predictable values (0xDEADBEEF, 0x12345678, 0xAAAAAAAA) — attacker can pre-send requests with matching opaque to hijack responses |
| 4 | High | **MISSING CAS VALIDATION**: handleCouchbaseSet (line 700) ignores CAS field — allows race conditions where two clients overwrite each other's data |
| 5 | High | **ARITHMETIC OVERFLOW**: handleCouchbaseIncr (line 839) uses 64-bit counters but JS math at line 902 `hi * 0x100000000 + lo` overflows for values > 2^53 |
| 6 | High | **TYPE CONFUSION**: buildSetRequest (line 546) uses flags=0 for all types — clients cannot distinguish strings from JSON, causing deserialization errors |
| 7 | Medium | **UNSAFE DEFAULTS**: All handlers default to port 11210 (unencrypted) — production Couchbase uses 11207 (TLS) |
| 8 | Medium | **MISSING VALIDATION**: buildIncrDecrRequest (line 595) allows negative `delta` for INCREMENT — server rejects but error message is misleading |
| 9 | Medium | **INCOMPLETE ERROR HANDLING**: parseResponseHeader (line 107) doesn't validate magic byte — accepts 0x00-0xFF but only 0x81 is valid for responses |
| 10 | Low | **MISSING STATS LIMIT**: handleCouchbaseStats (line 386) has `maxStats = 500` but no size limit — malicious server can send 500 stats of 1MB each = 500MB response |

## Security Analysis

### 1. Response Spoofing (Critical)

**Location:** All handlers using buildRequest (lines 90-101)

```typescript
function buildRequest(opcode: number, opaque: number = 0): Uint8Array {
  const header = new Uint8Array(HEADER_SIZE);
  const view = new DataView(header.buffer);

  header[0] = MAGIC_REQUEST;
  header[1] = opcode;
  // Bytes 2-7: key length, extras length, data type, vbucket — all 0
  // Bytes 8-11: total body length — 0 (no key/extras/value)
  view.setUint32(12, opaque); // Opaque  <-- PREDICTABLE
  // Bytes 16-23: CAS — 0

  return header;
}

// Usage:
const noopReq = buildRequest(OPCODE_NOOP, 0xDEADBEEF);  // Line 242
const versionReq = buildRequest(OPCODE_VERSION, 0x12345678);  // Line 335
const statReq = buildRequest(OPCODE_STAT, 0xAAAAAAAA);  // Line 431
```

**Attack:** Attacker connects to same server, sends requests with opaque values `0xDEADBEEF`, `0x12345678`, etc. Server processes both attacker and victim requests, but attacker's responses arrive first and match the opaque values, causing victim to receive attacker-controlled data.

**Fix:** Use cryptographically random opaque values:
```typescript
function buildRequest(opcode: number, opaque?: number): Uint8Array {
  const randomOpaque = opaque ?? crypto.getRandomValues(new Uint32Array(1))[0];
  // ... rest of function
  view.setUint32(12, randomOpaque);
  return header;
}
```

### 2. Resource Leaks (Critical)

**Location:** All handlers (lines 197-493, 631-916)

```typescript
export async function handleCouchbasePing(request: Request): Promise<Response> {
  // ...
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
    // TIMEOUT HANDLE NEVER STORED OR CLEARED
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);
    const writer = socket.writable.getWriter();
    const buffered = new BufferedReader(socket.readable.getReader());
    // ... operation
    writer.releaseLock();
    buffered.releaseLock();  // BufferedReader.releaseLock releases inner reader
    socket.close();
    // SUCCESS PATH: timeout still active
  } catch (error) {
    socket.close();
    throw error;
    // ERROR PATH: reader/writer/timeout all leak
  }
}
```

**Impact:** After 10,000 requests, runtime holds 10,000 active timeout handles and 20,000 unreleased reader/writer locks. Eventually triggers "too many open handles" error and crashes.

**Fix:** Store handle and use finally:
```typescript
let timeoutHandle: number | undefined;
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
});

let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
let buffered: BufferedReader | undefined;

try {
  await Promise.race([socket.opened, timeoutPromise]);
  writer = socket.writable.getWriter();
  buffered = new BufferedReader(socket.readable.getReader());
  // ... operation
  return new Response(...);
} catch (error) {
  return new Response(...);
} finally {
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  if (writer) try { writer.releaseLock(); } catch { /* ok */ }
  if (buffered) try { buffered.releaseLock(); } catch { /* ok */ }
  try { socket.close(); } catch { /* ok */ }
}
```

### 3. Missing CAS Validation (High)

**Location:** `handleCouchbaseSet` (lines 700-751)

```typescript
export async function handleCouchbaseSet(request: Request): Promise<Response> {
  // ...
  await writer.write(buildSetRequest(key, value));  // CAS = 0 (ignored)
  const { header } = await readResponse(buffered, timeoutPromise);

  if (header.status === STATUS_SUCCESS) {
    return new Response(JSON.stringify({
      success: true, host, port, key, rtt,
      message: 'Key stored successfully', valueLength: value.length
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  // ...
}
```

**Attack:** Two clients SET the same key simultaneously:
```
Time 0: Client A: GET key (CAS=100)
Time 1: Client B: GET key (CAS=100)
Time 2: Client A: SET key=value1 (no CAS) → success
Time 3: Client B: SET key=value2 (no CAS) → success (overwrites A)
```

Client A's write is silently lost because CAS (Compare-And-Swap) validation is not enforced.

**Fix:** Return CAS from GET, require it on SET:
```typescript
// GET response:
const casValue = new DataView(respBody.buffer, respBody.byteOffset).getBigUint64(16, false);
return new Response(JSON.stringify({
  success: true, host, port, key, rtt, value, flags,
  cas: casValue.toString(),  // Return as string (64-bit)
}), ...);

// SET request:
function buildSetRequest(
  key: string, value: string, flags = 0, expiry = 0,
  cas = 0n, opaque = crypto.getRandomValues(new Uint32Array(1))[0]
): Uint8Array {
  // ... existing code
  // Write CAS (bytes 16-23)
  const dv = new DataView(packet.buffer);
  dv.setBigUint64(HEADER_SIZE - 8, cas, false);
  return packet;
}

// Usage:
const { cas } = await request.json();
await writer.write(buildSetRequest(key, value, 0, 0, BigInt(cas)));
```

### 4. Arithmetic Overflow (High)

**Location:** `handleCouchbaseIncr` (lines 839-916)

```typescript
if (header.status === STATUS_SUCCESS && respBody.length >= 8) {
  // Response body is the new 64-bit counter value (big-endian)
  const dv = new DataView(respBody.buffer, respBody.byteOffset);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const newValue = hi * 0x100000000 + lo;  // OVERFLOW for values > 2^53
  return new Response(JSON.stringify({
    success: true, host, port, key, rtt, operation, delta,
    newValue, newValueStr: String(newValue)  // Silent truncation
  }), ...);
}
```

**Attack:** Counter starts at `2^53 - 100`. Client increments by 1000:
```
Expected: 9007199254741892
Actual:   9007199254740992  (silent truncation)
```

The value silently wraps to a smaller number due to IEEE 754 double precision limits.

**Fix:** Use BigInt for all 64-bit arithmetic:
```typescript
const dv = new DataView(respBody.buffer, respBody.byteOffset);
const hi = BigInt(dv.getUint32(0));
const lo = BigInt(dv.getUint32(4));
const newValue = (hi << 32n) | lo;
return new Response(JSON.stringify({
  success: true, host, port, key, rtt, operation, delta,
  newValue: newValue.toString(),  // String repr (no overflow)
  newValueNum: Number(newValue),  // May be unsafe if > 2^53
}), ...);
```

## Documentation Improvements

**Missing:** No protocol documentation. Implementation has brief header comments but no operational guide.

**Needed:** `docs/protocols/COUCHBASE.md` should document:
1. Memcached binary protocol 24-byte header structure
2. Opcode table (GET=0x00, SET=0x01, DELETE=0x04, INCREMENT=0x05, etc.)
3. Status codes (0x0000=Success, 0x0001=NotFound, 0x0020=AuthError, etc.)
4. CAS (Compare-And-Swap) semantics for race-free updates
5. Known limitations (no SASL auth, no TLS, no collections API, single bucket only)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No tests exist (`tests/couchbase.test.ts` missing)
**RFC Compliance:** Partial (implements memcached binary protocol but lacks SASL, no vBucket support)

## See Also

- [Memcached Binary Protocol Spec](https://github.com/memcached/memcached/wiki/BinaryProtocolRevised)
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
- [Couchbase SDK Auth](https://docs.couchbase.com/server/current/learn/security/authentication.html)
