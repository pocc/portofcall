# SSH Implementation Bug Report (2026-02-18)

## Critical Bugs (Data Loss / Protocol Violations)

### BUG #1: Terminal input dropped when exceeding remote window
**File:** `ssh2-impl.ts` line 749
**Severity:** HIGH - Data loss
**Current code:**
```typescript
if (data.length === 0 || data.length > remoteWindow) return;
```

**Issue:** When user types input that exceeds the current remote window size, the input is silently dropped. This causes data loss - the user's keystrokes disappear without error.

**Fix:** Split input into chunks that fit the available window, or queue data until window is replenished:
```typescript
// Split data into chunks that fit the remote window
for (let offset = 0; offset < data.length; offset += remoteWindow) {
  const chunkSize = Math.min(data.length - offset, remoteWindow);
  if (chunkSize === 0) break; // Window exhausted; drop remaining or queue

  const chunk = data.slice(offset, offset + chunkSize);
  await sendPayload(cat(
    new Uint8Array([MSG_CHANNEL_DATA]),
    u32(remoteChannel),
    sshBytes(chunk),
  ));
  remoteWindow -= chunk.length;
}
```

**Protocol context:** RFC 4254 §5.2 requires respecting the remote window. The correct behavior is to wait for `SSH_MSG_CHANNEL_WINDOW_ADJUST` or split large data into window-sized chunks.

---

### BUG #2: Subsystem sendChannelData throws on window exhaustion
**File:** `ssh2-impl.ts` line 1062
**Severity:** HIGH - Protocol violation
**Current code:**
```typescript
if (chunk.length > remoteWin) throw new Error('Remote window exhausted');
```

**Issue:** The `sendChannelData()` method throws an error when the remote window is exhausted, causing the SFTP or exec session to fail. This is incorrect - the sender should wait for `SSH_MSG_CHANNEL_WINDOW_ADJUST` to replenish the window.

**Fix:** Wait for window adjust or return backpressure:
```typescript
// Wait for window to be available
while (chunk.length > remoteWin) {
  const p = await readPayload2();
  if (p[0] === MSG_CHANNEL_WINDOW_ADJUST) {
    remoteWin += readU32(p, 5);
  } else if (p[0] === MSG_CHANNEL_EOF || p[0] === MSG_CHANNEL_CLOSE) {
    throw new Error('Channel closed while waiting for window');
  }
  // Handle other messages...
}
await sendPayload2(cat(new Uint8Array([MSG_CHANNEL_DATA]), u32(remoteCh), sshBytes(chunk)));
remoteWin -= chunk.length;
```

**Alternative:** Return a Promise that resolves when the data is queued, implementing proper backpressure.

**Protocol context:** RFC 4254 §5.2 Window Adjustment - "When the window is consumed, the sender MUST wait for a SSH_MSG_CHANNEL_WINDOW_ADJUST message before sending more data."

---

## Medium Severity Bugs (Correctness / Edge Cases)

### BUG #3: Banner read incomplete in HTTP mode
**File:** `ssh.ts` line 111-112
**Severity:** MEDIUM - Informational data may be truncated
**Current code:**
```typescript
const reader = socket.readable.getReader();
const { value } = await reader.read();
const banner = new TextDecoder().decode(value);
```

**Issue:** Uses a single `reader.read()` which may not receive the complete banner if it arrives across multiple TCP segments. This is acceptable for a connectivity test but may show partial banners.

**Fix:** Read until CRLF is found:
```typescript
const reader = socket.readable.getReader();
let accumBuf = new Uint8Array(0);
let banner = '';

while (!banner) {
  const { done, value } = await reader.read();
  if (done) break;
  accumBuf = cat(accumBuf, value);

  // Scan for CRLF
  for (let i = 0; i < accumBuf.length - 1; i++) {
    if (accumBuf[i] === 0x0d && accumBuf[i + 1] === 0x0a) {
      banner = new TextDecoder().decode(accumBuf.slice(0, i));
      break;
    }
  }
}
```

**Status:** Already documented in `SSH.md` line 311 as a known limitation. This is acceptable for an HTTP probe.

---

### BUG #4: No banner size limit in ssh2-impl.ts
**File:** `ssh2-impl.ts` lines 452-474
**Severity:** LOW - Resource exhaustion potential
**Current code:**
```typescript
while (!serverVersion) {
  const { done, value } = await tcpReader.read();
  if (done) throw new Error('Connection closed during version exchange');
  accumBuf = cat(accumBuf, value);
  // ... scan for CRLF ...
}
```

**Issue:** The accumulation buffer `accumBuf` has no size limit. A malicious or misconfigured server could send unlimited data before the SSH version string, causing memory exhaustion.

**Fix:** Add a maximum banner size check (RFC 4253 §4.2 suggests lines should be < 255 characters):
```typescript
const MAX_BANNER_SIZE = 8192; // 8KB safety limit

while (!serverVersion) {
  const { done, value } = await tcpReader.read();
  if (done) throw new Error('Connection closed during version exchange');
  accumBuf = cat(accumBuf, value);

  if (accumBuf.length > MAX_BANNER_SIZE) {
    throw new Error('Server banner exceeds maximum size');
  }

  // ... rest of code ...
}
```

**Protocol context:** RFC 4253 §4.2 states version string lines MUST be < 255 characters (excluding CRLF).

---

### BUG #5: Packet length validation too permissive
**File:** `ssh.ts` line 499
**Severity:** LOW - DoS potential
**Current code:**
```typescript
if (packetLength === 0 || packetLength > 35000) {
  throw new Error(`SSH packet length out of range: ${packetLength}`);
}
```

**Issue:** RFC 4253 §6.1 specifies maximum packet length of 35,000 bytes, but also requires `packet_length` field to account for padding. A packet_length of 1 would indicate a payload of 0 bytes after subtracting padding_length field and padding, which should be invalid.

**Fix:** More precise validation:
```typescript
// RFC 4253 §6: minimum packet is 16 bytes (12 bytes overhead + 4 bytes min padding)
// Maximum is 35000 bytes total
if (packetLength < 12 || packetLength > 35000) {
  throw new Error(`SSH packet length out of range: ${packetLength}`);
}
```

**Protocol context:** RFC 4253 §6 - packet_length includes padding_length field (1 byte) + payload + padding (minimum 4 bytes).

---

## Low Severity Issues (Documentation / Clarity)

### ISSUE #1: MAC comparison timing attack
**File:** `ssh2-impl.ts` lines 208-209
**Severity:** LOW - Theoretical timing attack
**Current code:**
```typescript
for (let i = 0; i < 32; i++) {
  if (mac[i] !== expectedMac[i]) throw new Error('SSH: MAC verification failed');
}
```

**Issue:** Early exit on first byte mismatch allows timing attacks to determine MAC bytes one at a time.

**Fix:** Use constant-time comparison:
```typescript
let mismatch = 0;
for (let i = 0; i < 32; i++) {
  mismatch |= mac[i] ^ expectedMac[i];
}
if (mismatch !== 0) throw new Error('SSH: MAC verification failed');
```

**Note:** Timing attacks over network latency are extremely difficult, so this is more of a best practice than a critical security issue.

---

### ISSUE #2: Credentials in WebSocket URL query parameters
**File:** `ssh.ts` lines 142-145, `ssh2-impl.ts` lines 1114-1119
**Severity:** LOW - Security anti-pattern (by design)
**Current behavior:** Passwords and private keys are passed as URL query parameters.

**Issue:** Query parameters appear in:
- Cloudflare access logs
- Browser history
- Server logs
- Any intermediary proxies

**Recommendation:** Document this as a critical security consideration. For production use, credentials should be sent via:
1. POST request body for initial connection
2. Worker generates time-limited connection token
3. WebSocket upgrade uses token instead of credentials

**Status:** Already documented in `SSH.md` lines 80, 208 with warning emoji.

---

## Correctness Issues (Not Bugs, But Worth Noting)

### OBSERVATION #1: No sequence number reset on re-key
**File:** `ssh2-impl.ts` lines 424-425, 433
**Current behavior:** Sequence numbers increment indefinitely.

**Issue:** The implementation doesn't support re-keying, so sequence numbers will eventually overflow after 2^32 packets (approximately 4 billion packets).

**Impact:** Extremely unlikely in practice (would require weeks of continuous high-throughput SSH usage).

**Recommendation:** Document that long-lived sessions (> 1GB transferred or > 1 hour) may have undefined behavior if the server enforces re-keying.

**Status:** Already documented in `SSH.md` line 304: "No re-keying."

---

### OBSERVATION #2: Counter overflow in AES-CTR mode
**File:** `ssh2-impl.ts` lines 138-146
**Current behavior:** AES-CTR counter is a 16-byte big-endian integer.

**Issue:** After encrypting approximately 2^128 * 16 bytes (340 undecillion bytes), the counter overflows and wraps to zero, repeating keystream.

**Impact:** Impossible to reach in practice (would take trillions of years at current data rates).

**Status:** Not worth documenting - academic concern only.

---

## Summary Statistics

**Critical bugs:** 2 (data loss, protocol violation)
**Medium bugs:** 3 (incomplete reads, resource limits)
**Low severity:** 2 (timing attack, security anti-pattern by design)
**Observations:** 2 (documented limitations)

**Recommendation:** Fix critical bugs #1 and #2 immediately. Other issues can be documented as known limitations.
# SSH Review Summary — To be appended to REVIEWED.md

**Add this section to /Users/rj/gd/code/portofcall/docs/REVIEWED.md**

---

## SSH Protocol — `docs/protocols/SSH.md`

**Reviewed:** 2026-02-18
**Protocol status at time of review:** deployed
**Implementation:** `src/worker/ssh.ts`, `src/worker/ssh2-impl.ts`

### Bugs Found (Unfixed — Requires Code Editing Permission)

The SSH implementation spans two source files:
- `ssh.ts` (813 lines): HTTP connectivity probes, KEXINIT/auth method discovery, raw TCP WebSocket tunnel
- `ssh2-impl.ts` (1158 lines): Full SSH-2 client implementation (curve25519 kex, aes128-ctr, hmac-sha2-256, Ed25519 auth, PTY/shell, SFTP subsystem)

Review identified **2 critical bugs**, **3 medium bugs**, and **2 low-severity issues**. Full analysis documented in `docs/SSH_BUGS_FOUND.md`.

#### Critical Bugs (Data Loss / Protocol Violations)

**Bug #1: Terminal input data loss on window exhaustion (ssh2-impl.ts:749)**
Severity: HIGH — Silent data loss

When user input exceeds the current SSH channel remote window size, the data is silently dropped:
```typescript
if (data.length === 0 || data.length > remoteWindow) return;
```
This violates RFC 4254 §5.2 which requires respecting window limits by either splitting data into chunks or waiting for `SSH_MSG_CHANNEL_WINDOW_ADJUST`. User keystrokes disappear without error or visual indication.

**Recommended fix:** Split input into chunks that fit available window:
```typescript
for (let offset = 0; offset < data.length; offset += remoteWindow) {
  const chunkSize = Math.min(data.length - offset, remoteWindow);
  if (chunkSize === 0) break; // Window exhausted; queue or drop remaining
  const chunk = data.slice(offset, offset + chunkSize);
  await sendPayload(...);
  remoteWindow -= chunk.length;
}
```

**Bug #2: SFTP/subsystem channel throws on window exhaustion (ssh2-impl.ts:1062)**
Severity: HIGH — Protocol violation causing session failure

The `sendChannelData()` method in `openSSHSubsystem` throws an error when remote window is exhausted:
```typescript
if (chunk.length > remoteWin) throw new Error('Remote window exhausted');
```
RFC 4254 §5.2 mandates waiting for `SSH_MSG_CHANNEL_WINDOW_ADJUST` to replenish the window. Throwing an error causes SFTP transfers and exec sessions to fail mid-operation.

**Recommended fix:** Wait for window adjust message in a loop:
```typescript
while (chunk.length > remoteWin) {
  const p = await readPayload2();
  if (p[0] === MSG_CHANNEL_WINDOW_ADJUST) { remoteWin += readU32(p, 5); }
  else if (p[0] === MSG_CHANNEL_EOF || p[0] === MSG_CHANNEL_CLOSE) {
    throw new Error('Channel closed while waiting for window');
  }
  // Handle other message types...
}
```

#### Medium Severity Bugs

**Bug #3: HTTP banner probe incomplete read (ssh.ts:111)**
Single `reader.read()` call may receive partial SSH banner if it arrives across multiple TCP segments. Results in truncated banner string.
Status: Already documented in SSH.md line 311 as "Single `reader.read()` for banner in HTTP mode." Acceptable for connectivity test; informational only.

**Bug #4: No banner size limit (ssh2-impl.ts:452-474)**
Version exchange accumulates banner data in `accumBuf` without size limit. Malicious server could send unlimited pre-banner data causing memory exhaustion.
Recommended: Add 8KB limit per RFC 4253 §4.2 (version string < 255 chars).

**Bug #5: Packet length validation range too permissive (ssh.ts:499)**
Accepts `packetLength > 0` but RFC 4253 §6 specifies minimum packet is 12 bytes overhead + 4 bytes padding = 16 bytes total.
Recommended: Change to `if (packetLength < 12 || packetLength > 35000)`.

#### Low Severity Issues

**Issue #1: MAC comparison timing attack (ssh2-impl.ts:208-209)**
Early-exit byte comparison allows theoretical timing attack. Recommended: Use constant-time XOR accumulation.
Impact: Extremely difficult over network latency; academic concern.

**Issue #2: Credentials in WebSocket URL query parameters (by design)**
Passwords and private keys appear in Cloudflare logs, browser history, server logs.
Status: Already documented with warning emoji in SSH.md lines 80, 208. Known security anti-pattern required by current architecture.

### What the original doc covered

`docs/protocols/SSH.md` was already comprehensive (404 lines):
- Architecture diagram showing 6 endpoints across 2 source files
- Full API reference for all endpoints with request/response schemas
- Key exchange details (curve25519-sha256 flow, exchange hash H, session key derivation)
- Authentication details (password, Ed25519 public key parsing including passphrase decryption)
- 12 known limitations (no RSA/ECDSA, no host key verification, hardcoded PTY 220×50, no re-keying, etc.)
- SSH-2 message type reference table (26 message types with direction and notes)
- Key derivation formulas (RFC 4253 §7.2)
- curl examples and public test server info

The doc correctly described the window flow control behavior (line 307): "silently drops input when `data.length > remoteWindow`", but presented it as a design choice rather than identifying it as a bug.

### What doc improvements were made

Created `docs/SSH_BUGS_FOUND.md` (comprehensive bug report, 300+ lines):
1. **Critical bugs section** — detailed analysis of window exhaustion bugs with RFC citations, current code snippets, recommended fixes, and protocol context
2. **Medium/low severity sections** — banner read incomplete, resource limits, timing attacks
3. **Correctness observations** — sequence number overflow (academic), counter overflow (impossible)
4. **Summary statistics** — 2 critical, 3 medium, 2 low severity issues
5. **Fix recommendations** — immediate fixes for critical bugs, documentation for others

No changes made to `SSH.md` itself — the existing documentation is accurate and comprehensive. The window flow control limitation at line 307 should be updated to indicate it is a **bug** (data loss) rather than a design limitation, but this requires Edit permission.

**Recommendation:** Fix critical bugs #1 and #2 immediately. Update SSH.md line 307 to clarify window exhaustion causes data loss (not just "drops input"). Add medium bugs to known limitations section. Reference SSH_BUGS_FOUND.md for technical details.
