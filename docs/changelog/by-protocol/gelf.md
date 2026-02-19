# GELF Review

**Protocol:** GELF (Graylog Extended Log Format) over TCP
**File:** `src/worker/gelf.ts`
**Implemented:** 2026-02-19
**Reviewed:** 2026-02-19
**Specification:** [Graylog GELF Documentation](https://go2docs.graylog.org/5-0/getting_in_log_data/gelf.html)
**Tests:** `tests/gelf.test.ts`

## Summary

GELF TCP implementation provides 2 endpoints (send, probe) for sending structured JSON log messages to Graylog servers. Messages are null-byte delimited JSON with required fields (version, host, short_message) and optional custom fields prefixed with underscore. Code review identified 5 bugs: 2 critical resource leaks (timeout handles, writer locks), 2 medium validation issues (port/timeout bounds), and 1 low-severity array mutation. Implementation includes comprehensive validation, batch support (up to 100 messages), auto-population of timestamps, and Cloudflare SSRF protection.

## Bugs Found and Fixed

| # | Severity | Location | Bug | Fix |
|---|----------|----------|-----|-----|
| 1 | **Critical** | Lines 205-207, 296-298 | **Timeout handle leak** - `setTimeout()` creates handles never cleared with `clearTimeout()`. If connection succeeds before timeout, handle remains active causing resource leak (1000+ leaked handles after 1000 requests) | Add `let timeoutHandle` variable and `clearTimeout(timeoutHandle)` in finally block |
| 2 | **Critical** | Lines 180, 272 | **Writer lock leak** - If timeout fires while `writer.write()` is pending, lock never released. Promise.race rejects but pending write holds lock forever | Add try/finally to release writer: `writer.releaseLock()` before socket.close() |
| 3 | Medium | Line 232 | **Port validation missing** - `parseInt(port)` doesn't validate range 1-65535. Accepts invalid ports (-1, 0, 70000) causing connection failures with unclear errors | Add: `if (port < 1 || port > 65535) return 400 "Invalid port"` |
| 4 | Medium | Lines 104, 233 | **Timeout validation missing** - No check that timeout is positive reasonable number. Accepts negative/zero (instant timeout) or extreme values (years) | Add: `if (timeout < 100 || timeout > 300000) return 400 "Timeout must be 100-300000ms"` |
| 5 | Low | Lines 143-150 | **Input mutation** - Code modifies caller's `messages` array by setting `timestamp` and `version` properties, unexpected side effect | Use spread operator to copy: `const msg = { ...messages[i] }` before mutation |

## Detailed Bug Analysis

### Bug #1: Timeout Handle Leak (Critical)

**Location:** `src/worker/gelf.ts` lines 205-207, 296-298

**Problem:**
```typescript
const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('Connection timeout')), timeout)
);
```

The `setTimeout()` creates a timeout handle that is never cleared. If `Promise.race()` resolves with the connection succeeding before the timeout fires, the timeout handle remains active in the Workers runtime. After 1000 successful requests, there will be 1000 leaked timeout handles consuming memory.

**Impact:** Resource exhaustion in long-running Workers. Each leaked handle holds a closure with reject callback and error object.

**Fix:**
```typescript
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
try {
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  const result = await Promise.race([connectionPromise, timeoutPromise]);
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
} finally {
  if (timeoutHandle) clearTimeout(timeoutHandle);
}
```

**Specification Reference:** N/A (Workers runtime resource management best practice)

---

### Bug #2: Writer Lock Leak (Critical)

**Location:** `src/worker/gelf.ts` lines 180, 272

**Problem:**
```typescript
const writer = socket.writable.getWriter();
try {
  await writer.write(encoder.encode(payload));
  await socket.close();
} catch (error) {
  await socket.close();
  throw error;
}
```

If the timeout fires while `writer.write()` is pending, `Promise.race()` rejects but the write operation continues holding the lock. The lock is never released because control never returns to the catch/finally block.

**Impact:** WebSocket streams API locks are never garbage collected. After enough timeouts, the runtime may refuse to create new writers.

**Fix:**
```typescript
const writer = socket.writable.getWriter();
try {
  await writer.write(encoder.encode(payload));
} finally {
  writer.releaseLock();
  await socket.close();
}
```

**Specification Reference:** [Streams API](https://developer.mozilla.org/en-US/docs/Web/API/WritableStreamDefaultWriter/releaseLock)

---

### Bug #3: Port Validation Missing (Medium)

**Location:** `src/worker/gelf.ts` line 232

**Problem:**
```typescript
const port = parseInt(url.searchParams.get('port') || '12201', 10);
```

`parseInt()` accepts any string and converts to integer. No validation that result is in valid TCP port range 1-65535.

**Examples:**
- `?port=-1` → -1 (invalid, connection fails)
- `?port=0` → 0 (invalid, connection fails)
- `?port=70000` → 70000 (invalid, out of range)
- `?port=abc` → NaN (invalid but code doesn't check)

**Impact:** Confusing connection errors instead of clear validation error. User wastes time debugging invalid port values.

**Fix:**
```typescript
const port = parseInt(url.searchParams.get('port') || '12201', 10);
if (isNaN(port) || port < 1 || port > 65535) {
  return new Response(JSON.stringify({
    error: 'Invalid port number. Must be 1-65535.'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}
```

**Specification Reference:** TCP port range 1-65535 (IANA)

---

### Bug #4: Timeout Validation Missing (Medium)

**Location:** `src/worker/gelf.ts` lines 104, 233

**Problem:**
```typescript
const { timeout = 10000 } = await request.json();
const timeout = parseInt(url.searchParams.get('timeout') || '5000', 10);
```

No validation that timeout is a reasonable positive number:
- Negative timeout → instant timeout (connection always fails)
- Zero timeout → instant timeout
- Very large timeout (1,000,000ms = 16 minutes) → exceeds Workers 30s CPU limit anyway

**Impact:** Confusing behavior when users accidentally pass invalid timeout values.

**Fix:**
```typescript
if (timeout < 100 || timeout > 300000) {
  return new Response(JSON.stringify({
    error: 'Timeout must be between 100ms and 300000ms (5 minutes)'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}
```

**Specification Reference:** Workers 30s request duration limit

---

### Bug #5: Input Mutation (Low)

**Location:** `src/worker/gelf.ts` lines 143-150

**Problem:**
```typescript
for (let i = 0; i < messages.length; i++) {
  const msg = messages[i];

  if (msg.timestamp === undefined) {
    msg.timestamp = Date.now() / 1000;  // Mutates caller's object!
  }

  if (!msg.version) {
    msg.version = '1.1';  // Mutates caller's object!
  }
}
```

The code directly modifies properties on the caller's message objects. This is unexpected behavior - callers don't expect their input objects to be modified.

**Impact:** If caller reuses message objects, they may be confused by unexpected `timestamp` and `version` properties appearing.

**Fix:**
```typescript
for (let i = 0; i < messages.length; i++) {
  const original = messages[i];
  const msg = { ...original };  // Shallow copy

  if (msg.timestamp === undefined) {
    msg.timestamp = Date.now() / 1000;
  }

  if (!msg.version) {
    msg.version = '1.1';
  }

  messages[i] = msg;  // Replace with modified copy
}
```

**Specification Reference:** JavaScript best practices (avoid mutating inputs)

---

## Implementation Details

**New Protocol Implementation:**

1. **Endpoints Implemented:**
   - `POST /api/gelf/send` - Send GELF messages (batch support)
   - `GET /api/gelf/probe` - Test GELF server connectivity

2. **Message Validation:**
   - Required fields: version="1.1", host (string, max 255 chars), short_message (string)
   - Optional standard fields: full_message, timestamp, level (0-7), facility, file, line
   - Custom fields must start with underscore (`_`)
   - Reserved field `_id` is rejected
   - Severity levels validated (0-7, syslog compatible)

3. **Wire Protocol:**
   - Format: `<JSON>\0` (null-byte terminated)
   - UTF-8 encoding
   - Fire-and-forget (no server response expected)

4. **Security Features:**
   - Cloudflare detection prevents SSRF attacks
   - Input validation on all message fields
   - Batch size limit (max 100 messages per request)
   - Host length validation (max 255 characters)
   - Timeout protection (default: 10s send, 5s probe)

5. **Auto-Population:**
   - `timestamp` defaults to current Unix time (seconds with decimal precision)
   - `version` defaults to "1.1" if missing

## Code Quality Observations

**Strengths:**
- ✅ Comprehensive message validation with detailed error messages
- ✅ Proper null-byte framing per GELF TCP specification
- ✅ Cloudflare SSRF protection built-in
- ✅ Clean separation of validation logic
- ✅ Batch support for efficient log shipping
- ✅ Timeout handling with Promise.race pattern
- ✅ Proper socket cleanup in error paths

**Potential Improvements:**
- Could add persistent connection mode for high-throughput scenarios
- Could add GZIP compression support (though rare for TCP GELF)
- Could add TLS/GELF over TLS support (secureTransport: 'on')
- Could add message chunking for very large messages (edge case)

## Documentation Improvements

**Created:** `docs/protocols/GELF.md` (comprehensive 300+ line specification)

**Sections:**
1. Protocol overview and wire format details
2. API endpoint reference (send, probe)
3. Message structure with all field descriptions
4. Severity levels table (syslog 0-7)
5. Custom fields guidelines
6. cURL usage examples
7. JavaScript/TypeScript integration example
8. Security features documentation
9. Wire format hexdump example
10. Docker testing guide (with Graylog 5.0)
11. Comparison with Syslog RFC 5424
12. Known limitations (10 items documented)

## Known Limitations

1. **No UDP Support** - Only TCP transport (UDP GELF not possible on Workers)
2. **No Chunked GELF** - Large messages not split into chunks (UDP-only feature)
3. **No Compression** - GZIP not supported (uncommon for TCP GELF)
4. **Fire-and-Forget** - Cannot verify message acceptance by server
5. **No Streaming** - Each send creates new TCP connection
6. **Batch Limit** - Maximum 100 messages per request
7. **No TLS** - Currently plain TCP only (could add `secureTransport: 'on'`)
8. **Timestamp Precision** - Milliseconds (not microseconds)
9. **Custom Field Types** - JSON primitives only (no complex objects)
10. **No Persistent Connections** - New connection per request

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ 48 comprehensive test cases covering all power-user scenarios
**Specification Compliance:** GELF 1.1 specification

**Test Coverage:**
- **Message validation** (7 tests): Required fields, custom fields, reserved `_id`, severity levels 0-7
- **Batch operations** (3 tests): Size limits (1, 100, 101 messages), batch edge cases
- **API parameters** (4 tests): Missing host/messages, probe parameters
- **Power-user scenarios** (32 tests):
  - All 8 severity levels (EMERGENCY to DEBUG)
  - Timestamp formats (Unix decimal, integer, auto-generation)
  - Custom fields (multiple fields, mixed types, unicode)
  - Optional standard fields (full set, minimal set)
  - Batch size edge cases (1 message, exactly 100 messages)
  - Host validation (255 chars max, 256 chars reject, empty reject)
  - Error logging scenarios (structured error logs with stack traces)
  - Timeout handling (custom timeouts for send/probe)
  - Port variations (default 12201, custom ports)
  - Message content edge cases (unicode, multiline, 8KB messages)
- **Integration tests** (2 tests, skipped): Real Graylog server send/probe

## Power-User Test Examples

**All Severity Levels:**
```typescript
// Tests all 8 syslog levels (0-7)
levels.forEach(({ level, name }) => {
  it(`should accept level ${level} (${name})`, async () => { ... });
});
```

**Timestamp Precision:**
```typescript
// Supports Unix timestamp with decimal precision
timestamp: 1385053862.3072  // Seconds since epoch with microseconds

// Auto-generates if missing
// No timestamp → auto-populated with Date.now() / 1000
```

**Custom Fields:**
```typescript
// Comprehensive custom field test
_user_id: 12345,
_username: 'alice',
_request_id: 'abc-123-def-456',
_endpoint: '/api/users/12345',
_duration_ms: 145,
_is_cached: false,  // Boolean
_null_field: null,  // Null allowed
```

**Host Validation:**
```typescript
// Max 255 characters (GELF spec limit)
host: 'a'.repeat(255) → ✅ Accepted
host: 'a'.repeat(256) → ❌ 400 Invalid

// Empty hostname rejected
host: '' → ❌ 400 Invalid
```

**Batch Limits:**
```typescript
// Exactly 100 messages (at limit)
messages: Array(100).fill({...}) → ✅ Accepted

// 101 messages (over limit)
messages: Array(101).fill({...}) → ❌ 400 Maximum 100 messages
```

## See Also

- [GELF Protocol Specification](../protocols/GELF.md) - Complete wire format reference
- [Syslog Implementation](syslog.md) - Alternative logging protocol
- [Graphite Implementation](graphite.md) - Similar metrics protocol
- [Graylog Official Documentation](https://go2docs.graylog.org/5-0/getting_in_log_data/gelf.html)
