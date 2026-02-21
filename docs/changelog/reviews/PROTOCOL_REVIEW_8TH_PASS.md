# Protocol Review — 8th Pass
**Review Date:** 2026-02-20
**Scope:** 277 protocol implementations, all 8 alphabet batches reviewed in parallel
**Focus:** Deep sweep for remaining bugs after 7 prior passes; spec compliance, usability, integer safety

---

## Executive Summary

The 8th pass found **12 genuine issues** — significantly fewer than prior passes, confirming the codebase is maturing. The most impactful findings are: **Docker log frame size signed integer overflow** (bitshift produces negative length), **TFTP block number overflow + off-by-one** (sends extra empty block, wraps at 65536), **IRCS CAP REQ missing colon prefix** (servers reject capability request), and **POP3 TOP missing dot-unstuffing** (RFC 1939 violation).

No critical security vulnerabilities were found. All prior-pass fixes remain intact.

---

## High-Severity Issues

### 1. Docker — Log Frame Size Signed Integer Overflow
**File:** `src/worker/docker.ts:696-700`

`(data[offset + 4] << 24)` produces a signed 32-bit integer. When the high byte has bit 7 set (≥ 0x80), the result is negative, failing the `size < 0` check and discarding a valid log frame.

**Fix:** Use unsigned right shift: `((data[offset+4] << 24) >>> 0) | ...` to force unsigned 32-bit result.

---

### 2. TFTP — Block Number Overflow + Off-by-One in Write Loop
**File:** `src/worker/tftp.ts:423-465`

Two bugs: (a) The loop condition `offset <= fileData.length` sends an extra empty block when offset equals length exactly. Should be `offset < fileData.length`. (b) Block numbers are 16-bit per RFC 1350 but increment without wrapping or limit, causing protocol violations for files > 33 MB.

**Fix:** Change `<=` to `<`. Add `blockNum = (blockNum + 1) & 0xFFFF` and break if it wraps to 0.

---

### 3. IRCS — CAP REQ Missing Colon Prefix
**File:** `src/worker/ircs.ts:444`

`CAP REQ sasl\r\n` should be `CAP REQ :sasl\r\n`. Per IRCv3 spec, the capability list is a trailing parameter requiring the colon prefix. Strict servers reject the request without it.

**Fix:** Change to `CAP REQ :sasl\r\n`.

---

### 4. POP3 — TOP Response Missing Dot-Unstuffing
**File:** `src/worker/pop3.ts:737-741`

The TOP command response is parsed raw without applying RFC 1939 §3 dot-unstuffing. Lines beginning with `..` should have one dot removed. The RETR handler correctly unstuffs via `readPOP3MultiLine()`, but TOP does not.

**Fix:** Apply the same dot-unstuffing logic from `readPOP3MultiLine()` to the TOP response before extracting content lines.

---

### 5. Tarantool — IPROTO Payload Size Unbounded
**File:** `src/worker/tarantool.ts:924-944`

When reading an IPROTO response, `msgLen` from the MessagePack header is used directly to allocate a buffer. A malicious server sending `msgLen = 0xFFFF` (uint16) causes a 65 KB allocation, which is fine, but `msgLen` from a uint32 prefix could request gigabytes.

**Fix:** Add `if (msgLen > 1_048_576) throw new Error('IPROTO payload too large');` before allocation.

---

### 6. TDS — TEXT/NTEXT/IMAGE Column Missing Bounds Check
**File:** `src/worker/tds.ts:942-950`

When parsing TEXT/NTEXT/IMAGE columns, `dataLen` (4-byte read) is used to slice the buffer without checking `offset + dataLen <= data.length`. A crafted response with `dataLen = 0xFFFFFFFF` reads past the buffer.

**Fix:** Add `if (offset + dataLen > data.length) return { value: null, nextOffset: data.length };` after reading `dataLen`.

---

## Medium-Severity Issues

### 7. FTP — PASV Port Octets Not Validated
**File:** `src/worker/ftp.ts:314-322`

`parseInt(p1) * 256 + parseInt(p2)` computes the port, but neither p1 nor p2 are validated to be in [0, 255]. A malformed PASV response could yield port > 65535 or NaN.

**Fix:** Validate both octets: `if (p1Num < 0 || p1Num > 255 || p2Num < 0 || p2Num > 255) throw new Error('Invalid PASV port');`

---

### 8. Gemini — Writer Lock Not Released on Write Failure
**File:** `src/worker/gemini.ts:136-143`

If `writer.write()` throws, `writer.releaseLock()` is never called. The lock persists until socket close. Should wrap the write in try-finally.

**Fix:** Add try-finally around the writer usage to ensure `releaseLock()` on error.

---

### 9. S7comm — startBit Overflow for Large DB Offsets
**File:** `src/worker/s7comm.ts:423-445`

`startBit = startByte * 8` overflows the 24-bit address field when `startByte > 0x1FFFFF` (2 MB). Only the low 24 bits are encoded, causing a silent read from the wrong address.

**Fix:** Add `if (startByte > 0x1FFFFF) throw new Error('S7comm: start byte exceeds 2MB limit');`

---

### 10. SLP — Message Length Can Exceed 3-Byte Field
**File:** `src/worker/slp.ts:110-115`

The SLP message length is stored in 3 bytes (max 16,777,215). No validation prevents constructing a message exceeding this. The high bits would be silently truncated, encoding a wrong length.

**Fix:** Add `if (length > 0xFFFFFF) throw new Error('SLP message exceeds 16MB limit');`

---

## Low-Severity Issues

### 11. Docker — TextDecoder Stream Not Flushed
**File:** `src/worker/docker.ts:104-105`

`decoder.decode(value, { stream: true })` is called in a loop but never flushed with `decoder.decode(new Uint8Array(0), { stream: false })` after the loop. Multi-byte UTF-8 sequences split across the last chunk boundary may be lost.

**Fix:** Add `response += decoder.decode(new Uint8Array(0));` after the read loop.

---

### 12. Ethereum — JSON-RPC ID Strict Equality May Reject Valid Responses
**File:** `src/worker/ethereum.ts:178`

`json.id !== id` uses strict equality. If the server returns the ID as a string (e.g., `"123"` instead of `123`), the check fails. JSON-RPC 2.0 allows any JSON type for ID.

**Fix:** Use `String(json.id) !== String(id)` for type-safe comparison.

---

## Prior-Pass Fixes Verified Intact

All fixes from passes 1–7 remain correctly applied. No regressions detected.

---

## Priority Fix List

### P0 — High Severity
1. **Docker** — Fix signed integer overflow in log frame size parsing
2. **TFTP** — Fix off-by-one (`<` not `<=`) and block number wrap
3. **IRCS** — Add colon prefix to `CAP REQ :sasl`
4. **POP3** — Apply dot-unstuffing to TOP response
5. **Tarantool** — Cap IPROTO payload size at 1 MB
6. **TDS** — Bounds check TEXT/NTEXT/IMAGE dataLen

### P1 — Medium Severity
7. **FTP** — Validate PASV port octets [0-255]
8. **Gemini** — Writer lock release in try-finally
9. **S7comm** — Validate startByte ≤ 0x1FFFFF
10. **SLP** — Validate message length ≤ 0xFFFFFF

### P2 — Low Severity
11. **Docker** — Flush TextDecoder after read loop
12. **Ethereum** — Use String() coercion for ID comparison

---

## Metrics

| Category | Count |
|---|---|
| High | 6 |
| Medium | 4 |
| Low | 2 |
| Prior fixes verified intact | All |
| False positives filtered | 8 |

**Previous report:** [PROTOCOL_REVIEW_7TH_PASS.md](PROTOCOL_REVIEW_7TH_PASS.md)
