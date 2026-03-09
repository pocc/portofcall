# Protocol Review — 23rd Pass

**Date:** 2026-02-23
**Reviewer:** Claude Sonnet 4.6
**Scope:** SSH, FTP, SFTP, FTPS, SMTP protocols — post-22nd-pass verification + M-1 fix review
**Method:** Full source read of `ssh.ts`, `ssh2-impl.ts`, `ftp.ts`, `sftp.ts`, `ftps.ts`, `smtp.ts`, `smtps.ts`, `submission.ts`, `host-validator.ts`, `cloudflare-detector.ts`

---

## Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| HIGH     | 0     | 0     |
| MEDIUM   | 3     | 3     |
| LOW      | 0     | 0     |

M-1 (SSH window exhaustion) confirmed fixed. All 22nd-pass fixes verified present.

---

## MEDIUM Issues

### N-1: `readStr` Missing Bounds Check — Silent Truncation on Malformed Packets

**File:** `src/worker/ssh2-impl.ts:readStr`
**Impact:** `b.subarray(off, off + len)` silently returns a truncated slice when `len` exceeds the remaining buffer. An attacker-controlled SSH server can craft a KEXECDH_REPLY with an oversized hostKeyBlob length field, causing host key parsing to use truncated data. In the worst case this causes silent auth failure; in theory it could allow crafted key material to pass a truncated Ed25519 signature check.

**Root cause:**
```typescript
function readStr(b: Uint8Array, off: number): [Uint8Array, number] {
  const len = readU32(b, off);
  off += 4;
  return [b.subarray(off, off + len), off + len]; // no bounds check
}
```

**Fix:** Add a bounds check before the subarray call.
**Status:** ✅ Fixed

---

### N-2: FTP/FTPS Data Transfer — Per-Chunk Timeout Allows Indefinite Resource Hold

**File:** `src/worker/ftp.ts` (list, mlsd, nlst, download)
**Impact:** The timeout timer is reset on every chunk read. A malicious server that trickle-feeds 1 byte every 29 seconds can hold a Worker connection open indefinitely, preventing resource reclamation.

**Root cause:**
```typescript
// timeout restarts on every chunk:
const { done, value } = await Promise.race([dataReader.read(), newTimeoutPromise]);
```

**Fix:** Calculate a single deadline at the start of each data transfer and use the remaining time for each race, rejecting when `deadline - Date.now() <= 0`.
**Status:** ✅ Fixed

---

### N-3: FTPS Multi-line Response Parser — RFC 959 Non-Compliance

**File:** `src/worker/ftps.ts:FTPSSession.readResponse`
**Impact:** The `isComplete` heuristic fires on the first line containing `NNN ` (terminal format), even if that line is not the last line of a multi-line response. This causes command/response desynchronization when the server sends a multi-line reply whose first line happens to be in terminal format (e.g., `250 OK\r\n250-detail\r\n250 end\r\n`).

**Root cause:**
```typescript
const isComplete = (text: string): boolean => {
  if (/^\d{3} [^\r\n]*\r?\n/m.test(text)) {
    const lines = text.split(/\r?\n/).filter(l => l.length > 0);
    const last = lines[lines.length - 1];
    return /^\d{3} /.test(last);
  }
  return false;
};
```
The regex `/^\d{3} .../m` matches on any line with the `m` flag, so it can match a non-last line.

**Fix:** Remove the first-pass regex and only check the last non-empty line for terminal format.
**Status:** ✅ Fixed

---

## Files Modified

| File | Change |
|------|--------|
| `src/worker/ssh2-impl.ts` | N-1: bounds check in `readStr` |
| `src/worker/ftp.ts` | N-2: deadline-based timeout in list, mlsd, nlst, download |
| `src/worker/ftps.ts` | N-3: RFC-compliant multi-line response parser |
