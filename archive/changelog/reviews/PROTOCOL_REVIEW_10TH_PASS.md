# Protocol Review — 10th Pass
**Review Date:** 2026-02-20
**Scope:** 277 protocol implementations, reviewed in 11+ parallel batches
**Focus:** Final sweep for runtime-breaking bugs, resource safety, and spec compliance gaps surviving 9 prior passes

---

## Executive Summary

The 10th pass found **6 genuine issues** — a slight uptick from the 9th pass (5 issues), reflecting a shift in focus toward runtime-environment compatibility and edge-case safety. The most impactful finding is **YMSG using Node.js Buffer API** which does not exist in Cloudflare Workers, making the entire protocol non-functional at runtime. The second high-severity issue is **CoAP btoa spread operator stack overflow** on large block-transfer payloads.

Over **40 agent-reported findings were verified as false positives** and filtered out, continuing the pattern of high false-positive rates from review agents on this mature codebase.

No critical security vulnerabilities were found. All prior-pass fixes remain intact.

---

## High-Severity Issues

### 1. YMSG — Node.js Buffer API Used in Workers Runtime
**File:** `src/worker/ymsg.ts:193-215`

The entire `buildYMSGHeader` function uses `Buffer.allocUnsafe()`, `Buffer.write()`, `Buffer.writeUInt16BE()`, `Buffer.writeUInt32BE()`, and elsewhere `Buffer.concat()` and `Buffer.from()`. The Node.js `Buffer` class is not available in Cloudflare Workers. This protocol will crash at runtime with `ReferenceError: Buffer is not defined`.

**Fix:** Replace all Buffer usage with `Uint8Array` + `DataView` for binary construction.

---

### 2. CoAP — btoa Spread Operator Stack Overflow on Large Payloads
**File:** `src/worker/coap.ts:853`

`btoa(String.fromCharCode(...combined))` uses the spread operator on the `combined` Uint8Array. For block-transfer payloads (up to 5 MB with SZX=6), the array can contain millions of elements. JavaScript's max function argument count is ~65,536 (engine-dependent), so this throws `RangeError: Maximum call stack size exceeded`.

**Fix:** Use a chunked approach:
```typescript
let binaryStr = '';
for (let i = 0; i < combined.length; i++) binaryStr += String.fromCharCode(combined[i]);
payloadStr = btoa(binaryStr);
```

---

## Medium-Severity Issues

### 3. FTPS — PASV Port Octets Not Validated (8th Pass Fix Not Propagated)
**File:** `src/worker/ftps.ts:298`

The 8th pass added PASV port octet validation to `ftp.ts` (lines 322-326: range check [0-255], NaN check), but the identical code in `ftps.ts` was not updated. A malformed PASV response can produce `port > 65535` or `NaN`.

**Fix:** Apply the same validation from ftp.ts:
```typescript
const p1Num = parseInt(p1, 10);
const p2Num = parseInt(p2, 10);
if (isNaN(p1Num) || isNaN(p2Num) || p1Num < 0 || p1Num > 255 || p2Num < 0 || p2Num > 255) {
  throw new Error('Invalid PASV response: port octets out of range');
}
const port = p1Num * 256 + p2Num;
```

---

### 4. DoH — DNS Name Compression Pointer Loop Has No Iteration Cap
**File:** `src/worker/doh.ts:125-130`

The `decodeDNSName` function follows compression pointers via `continue` with no safety counter or visited-set. A DNS response with circular compression pointers causes an infinite loop. The equivalent function in `dns.ts` correctly has `while (safetyCounter++ < 128)`.

**Fix:** Add a safety counter: `let safetyCounter = 0;` before the loop and `if (safetyCounter++ > 128) break;` at the loop top.

---

## Low-Severity Issues

### 5. Beats — decodeUint32BE Missing Unsigned Shift
**File:** `src/worker/beats.ts:80-87`

`(buffer[offset] << 24) | ...` produces a signed 32-bit integer. When the high byte is >= 0x80, the result is negative. The function is named `decodeUint32BE` but returns signed values. Used for sequence numbers (line 142), which in practice start at 1 and are unlikely to reach 2^31.

**Fix:** Add `>>> 0` to force unsigned: `return (...) >>> 0;`

---

### 6. XMPP — btoa Fails on Non-ASCII SASL Credentials
**File:** `src/worker/xmpp.ts:480`

`btoa(\`\0${username}\0${password}\`)` will throw `DOMException` if username or password contain characters with code points > 255 (e.g., non-Latin scripts). SASL PLAIN (RFC 4616) supports UTF-8 identities, but `btoa()` only handles Latin-1.

**Fix:** Encode to UTF-8 first, then base64:
```typescript
const saslBytes = new TextEncoder().encode(`\0${username}\0${password}`);
let binaryStr = '';
for (let i = 0; i < saslBytes.length; i++) binaryStr += String.fromCharCode(saslBytes[i]);
const authStr = btoa(binaryStr);
```

---

## Prior-Pass Fixes Verified Intact

All fixes from passes 1–9 remain correctly applied. No regressions detected.

---

## False Positives Filtered (40+)

Key false positives rejected during verification:

| Reported Finding | Reason Rejected |
|---|---|
| Thrift negative size from readI32 | `Math.min(-1, 10000) = -1`; loop `i < -1` runs 0 times — safe |
| ZooKeeper negative string length offset | `offset += 4` happens before the check; `newOffset` is correct |
| SANE decodeWord unsigned shift | Already has `>>> 0` |
| Hazelcast writeString return value | Not needed — last write before function return |
| DNS compression pointer OOB | Has `safetyCounter++ < 128` guard |
| SMB FILETIME integer overflow | Real-world FILETIME values stay within Number.MAX_SAFE_INTEGER |
| LDP DataView wrong buffer offset | DataView uses correct byteOffset from the PDU buffer |
| Neo4j packInteger negative encoding | Two's complement masking with `& 0xFF` is correct |
| Sentinel RESP parsing bounds | Standard bulk string length + complete check is correct |
| LMTP regex premature match | `$` anchor ensures match is at string end; SMTP final-line detection correct |
| VNC setBit masking | Standard 1-indexed MSB-first bit manipulation, math is correct |
| WinRM chunked decoding overflow | parseInt on reasonable HTTP chunk sizes stays within safe integer |
| Zabbix frame length overflow | getUint32 + 13 is within safe integer; timeout prevents hanging |
| mDNS compression loop | Already has `visited` set AND forward-pointer validation |
| LLMNR message length validation | Short data handled by slice + `dns.length < 12` guard |
| Submission lock release during STARTTLS | Correct — must release plain-socket locks before TLS upgrade |
| ClickHouse Int16 bounds | Called within structured column decoder with protocol-guaranteed data |
| Ignite buffer bounds too short | Response header is always >= 12 bytes; `4 + length` check sufficient |

---

## Priority Fix List

### P0 — High Severity
1. **YMSG** — Replace all Node.js Buffer usage with Uint8Array + DataView
2. **CoAP** — Replace btoa spread with chunked String.fromCharCode

### P1 — Medium Severity
3. **FTPS** — Propagate PASV port octet validation from ftp.ts
4. **DoH** — Add safety counter to DNS compression pointer loop

### P2 — Low Severity
5. **Beats** — Add `>>> 0` to decodeUint32BE
6. **XMPP** — Use UTF-8 encoding before btoa for SASL credentials

---

## Metrics

| Category | Count |
|---|---|
| High | 2 |
| Medium | 2 |
| Low | 2 |
| Prior fixes verified intact | All |
| False positives filtered | 40+ |

**Previous report:** [PROTOCOL_REVIEW_9TH_PASS.md](PROTOCOL_REVIEW_9TH_PASS.md)
