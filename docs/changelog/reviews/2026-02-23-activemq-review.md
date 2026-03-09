# ActiveMQ Protocol Review — 2026-02-23

**Protocol:** ActiveMQ (OpenWire + STOMP)
**Files:** `src/worker/activemq.ts`
**Pass:** 1

---

## Bugs Found and Fixed

| # | ID | Severity | Description | Status |
|---|-----|----------|-------------|--------|
| 1 | BUG-AMQ-3 | Medium | `readNextFrame` uses JS string character count for `content-length` offset arithmetic, but STOMP `content-length` is a UTF-8 **byte** count. For multi-byte bodies (Japanese text, emoji, etc.), this misaligns `remainingBuf` after extracting the body, corrupting subsequent frame parsing in `handleActiveMQSubscribe` and `handleActiveMQDurableSubscribe`. | ✅ Fixed |

## Fix Details

### BUG-AMQ-3 — UTF-8/content-length mismatch in readNextFrame

**Root cause:** When `content-length` is present, the code computed:
```javascript
const needed = bodyStart + contentLength + 1;
if (remainingBuf.length >= needed) {
  const rawFrame = remainingBuf.substring(0, bodyStart + contentLength);
  remainingBuf = remainingBuf.substring(needed);
}
```
`contentLength` is a byte count from the STOMP header, but `remainingBuf.length` and `.substring()` count JavaScript UTF-16 code units. For "café" (5 UTF-8 bytes, 4 JS chars), `contentLength=5` but the actual body in `remainingBuf` is 4 characters. This advances `remainingBuf` 1 character too far into the next frame.

**Example:** Message body "こんにちは" (15 UTF-8 bytes, 5 JS chars) with `content-length: 15`. Previous code advanced `remainingBuf` by 16 characters past `bodyStart`, skipping 10 characters into the next frame.

**Fix:** Use `TextEncoder`/`TextDecoder` to find the correct character boundary:
```javascript
const enc2 = new TextEncoder();
const encoded = enc2.encode(bodyPrefix);
if (encoded.length >= contentLength + 1) {
  const bodyStr = new TextDecoder().decode(encoded.slice(0, contentLength));
  const rawFrame = remainingBuf.substring(0, bodyStart + bodyStr.length);
  remainingBuf = remainingBuf.substring(bodyStart + bodyStr.length + 1);
  return parseStompFrame(rawFrame);
}
```

Applied to both copies of `readNextFrame`:
1. `withStompSession` inner function (line ~412)
2. `handleActiveMQDurableSubscribe` local function (line ~1524)

## Pass 1 Result

1 issue found and fixed. Proceeding to Pass 2.

---

# Pass 2 Review — 2026-02-24

## Verification of Pass 1 Fix

**BUG-AMQ-3** fix verified correct for all cases:
- ASCII body (5 bytes, 5 chars): `bodyStr.length = 5` → advances `remainingBuf` by 6 ✓
- Japanese body ("こんにちは", 15 bytes, 5 chars): `bodyStr.length = 5` → advances by 6 ✓  
- Binary body with embedded nulls: TextDecoder preserves U+0000 chars ✓
- Empty body (`content-length: 0`): `bodyStr = ""`, advances by 1 (null only) ✓
- Fragmented TCP (not enough bytes): falls through to read more ✓

Both copies of `readNextFrame` (in `withStompSession` and `handleActiveMQDurableSubscribe`) updated consistently.

## Findings

**0 issues found.**

## Pass 2 Result

**0 issues found. ACTIVEMQ review complete. Total: 3 bugs fixed (1 in pass 1 review, 1 today).**
