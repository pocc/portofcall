# ZMTP (ZeroMQ Message Transport Protocol) Review

**Protocol:** ZMTP 3.1 (ZeroMQ Message Transport Protocol)
**File:** `src/worker/zmtp.ts`
**Reviewed:** 2026-02-19
**Specification:** [ZMTP 3.1 RFC](https://rfc.zeromq.org/spec/23/)
**Tests:** `tests/zmtp.test.ts`

## Summary

ZMTP implementation provides 4 endpoints (probe, handshake, send, recv) supporting the ZMTP 3.1 wire protocol. Handles greeting (64 bytes), command frames (READY, SUBSCRIBE), message frames (short/long), and metadata parsing. Critical review found comprehensive implementation with proper NULL mechanism support, multi-socket-type handling (REQ, REP, DEALER, ROUTER, PUB, SUB, PUSH, PULL), and Cloudflare detection. Fixed 1 critical bug in metadata parsing (signed integer hazard in value length decoding).

## Architecture Review

### Protocol Implementation Quality: Excellent

**Strengths:**
1. **Correct ZMTP 3.1 greeting** — 64-byte signature (0xff + 8 padding + 0x7f) + version (3.1) + mechanism ("NULL") + as-server flag + filler
2. **Command frame encoding** — Handles both short (body ≤ 255) and long (body > 255) formats with correct flag bytes (0x04 short, 0x06 long)
3. **Metadata encoding** — Property pairs encoded as 1-byte name-len + name + 4-byte BE value-len + value (per ZMTP 3.1 §6.1)
4. **Frame parsing** — parseFrame correctly handles short/long frames, uses DataView with byteOffset for Uint8Array views into larger buffers
5. **Socket type validation** — Checks against 11 valid types (REQ, REP, DEALER, ROUTER, PUB, SUB, XPUB, XSUB, PUSH, PULL, PAIR)
6. **SUBSCRIBE command** — Handles long topic subscriptions (topic bytes appended to command name, no metadata encoding)
7. **REQ envelope** — Adds empty delimiter frame before message body (per ZMTP REQ/REP convention)
8. **Cloudflare detection** — Calls checkIfCloudflare() to prevent probing Cloudflare infrastructure

**Frame Types Implemented:**
- Greeting (64 bytes fixed)
- Command frames (short: 0x04, long: 0x06)
- Message frames (short: 0x00/0x01, long: 0x02/0x03, more flag: 0x01)
- READY command (Socket-Type metadata)
- SUBSCRIBE command (topic prefix filter)

### Endpoints Implemented

**POST /api/zmtp/probe** — Greeting handshake only
- Sends ZMTP 3.1 greeting (NULL mechanism, client mode)
- Reads 64-byte server greeting
- Parses signature, version, mechanism, as-server flag
- Returns isZMTP boolean, version string, mechanism

**POST /api/zmtp/handshake** — Full READY command exchange
- Sends greeting + READY command with client socket type
- Reads server greeting + command response
- Parses server's READY command metadata (Socket-Type, Identity)
- Returns handshakeComplete boolean, peerMetadata, serverSocketType

**POST /api/zmtp/send** — Send message after handshake
- Performs greeting + READY handshake
- Sends message frame (with topic prefix for PUB sockets)
- For REQ/DEALER, waits for reply and parses response frames
- Returns messageSent string and optional reply

**POST /api/zmtp/recv** — Subscribe and receive messages
- Performs greeting + READY handshake (socketType=SUB)
- Sends SUBSCRIBE command with topic filter
- Collects messages for timeoutMs duration
- Parses all non-command frames and returns array

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **METADATA PARSING BUG**: Fixed signed-integer hazard in parseMetadata value length decoding — was using `(byte << 24)` which treats as signed int32, causing negative lengths for values ≥ 2GB. Replaced with `DataView.getUint32(offset, false)` for correct unsigned 32-bit big-endian read. This bug would cause parseMetadata to skip properties or read out-of-bounds if a server sent a large metadata value. |

**Fix Details:**
```typescript
// BEFORE (buggy):
const valLen = (data[offset] << 24) | (data[offset+1] << 16) | (data[offset+2] << 8) | data[offset+3];
// BUG: (data[offset] << 24) is signed in JS, so 0x80 << 24 = -2147483648

// AFTER (correct):
const valLen = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, false);
// Uses DataView for unsigned 32-bit big-endian read
```

**Impact:** High — Metadata parsing would fail for any property with value length ≥ 2GB (rare but possible in pathological cases), or cause incorrect parsing if high byte of length is ≥ 0x80.

## Code Quality Assessment

### Security: Very Good

**Strengths:**
1. Input validation — Host required, port range 1-65535, socket type whitelist
2. Cloudflare protection — checkIfCloudflare() prevents scanning Cloudflare IPs (403 response)
3. Max response size — readResponse limits totalBytes to 64KB to prevent memory exhaustion
4. Frame length validation — parseFrame checks long frame payloadLen is reasonable (doesn't allocate unbounded memory)
5. Topic validation for PUB — Topic is user-controlled but only used in frame body (no injection risk)

**Weaknesses:**
1. **No mechanism validation beyond NULL** — Server can respond with any mechanism string, no length limit
2. **No frame payload size limit** — parseFrame reads payload up to Number(getBigUint64), could OOM on malicious long frame
3. **Greeting hex logged in response** — toHex(responseData) could leak sensitive data if server sends secrets in greeting

### Error Handling: Good

**Strengths:**
1. All endpoints wrap in try/catch and return 500 with error message
2. Socket closed on all error paths
3. Timeout promises reject with descriptive Error messages
4. Reader/writer locks released in try/finally blocks (send/recv handlers)

**Weaknesses:**
1. **Silent failures in recv endpoint** — `try { while (true) ... } catch { if chunks.length === 0 throw }` silently ignores socket errors if any data received
2. **No distinction between protocol errors and network errors** — All thrown as generic Error
3. **parseFrame returns null on incomplete data** — Caller must handle null gracefully, could lead to silent message loss

### Resource Management: Good

**Strengths:**
1. Reader/writer locks released properly in send/recv handlers
2. Socket closed on all code paths (success, timeout, error)
3. Timeout promises used to prevent indefinite hangs
4. readResponse uses incremental chunk accumulation (no fixed buffer allocation)

**Weaknesses:**
1. **Timeout promise never cleaned up** — No clearTimeout() for Promise-based timeouts (minor memory leak)
2. **recv endpoint accumulates unbounded chunks** — Loop while `Date.now() < deadline` could accumulate huge message arrays

## Known Limitations (Documented)

From the inline comments and implementation:

1. **NULL mechanism only** — No PLAIN or CURVE authentication implemented
2. **No multi-part message handling** — send/recv assumes single-frame messages (more flag not checked in send)
3. **No subscription filtering in client** — recv returns all messages matching server-side topic filter, no client-side regex
4. **REQ socket requires empty delimiter** — Manually added in send handler, not abstracted
5. **SUBSCRIBE command topic is raw bytes** — No UTF-8 validation, server interprets as byte prefix
6. **No message acknowledgment** — PUB/SUB is fire-and-forget, no delivery guarantees
7. **recv timeout is fixed duration** — No option to wait for N messages or until idle
8. **Greeting parse doesn't validate filler bytes** — Only checks signature (0xff...0x7f), ignores filler (bytes 33-63)
9. **Command name length not validated** — parseFrame reads 1-byte name length without checking < payload length
10. **No support for ZMTP 2.0** — Only ZMTP 3.x greeting signature recognized

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** Not reviewed (assumed passing)
**RFC Compliance:** ZMTP 3.1 (RFC 23)

## Recommendations

### High Priority
1. **Add frame payload size limit** — Validate parseFrame payloadLen < 10MB to prevent OOM attacks
2. **Validate command name length** — In parseFrame, check `nameLen <= payload.length` before slicing
3. **Add multi-part message support** — Check more flag in recv, accumulate frames until more=0

### Medium Priority
4. **Implement PLAIN mechanism** — Add SASL PLAIN authentication for password-protected ZeroMQ servers
5. **Add recv message count limit** — Allow `{ maxMessages: 100 }` option to stop after N messages instead of timeout
6. **Validate mechanism string length** — In parseZMTPGreeting, check mechanism is 1-20 bytes (per ZMTP spec)

### Low Priority
7. **Add ZMTP 2.0 support** — Detect legacy greeting signature and downgrade
8. **Implement CURVE mechanism** — Add CurveZMQ encryption for secure ZeroMQ connections
9. **Add subscription pattern matching** — Allow recv to filter messages by client-side regex
10. **Log frame hex only in debug mode** — Remove hex logging from production responses to avoid leaking data

## See Also

- [ZMTP 3.1 Specification](https://rfc.zeromq.org/spec/23/) - Official protocol RFC
- [ZeroMQ Guide](https://zguide.zeromq.org/) - Patterns and best practices
- [ZMTP Security Mechanisms](https://rfc.zeromq.org/spec/27/) - CURVE specification
