# Protocol Review — 9th Pass
**Review Date:** 2026-02-20
**Scope:** 277 protocol implementations, all reviewed in parallel batches
**Focus:** Deep sweep for subtle bugs surviving 8 prior passes; spec compliance, bounds safety, resource management

---

## Executive Summary

The 9th pass found **5 genuine issues** after rigorous verification against the actual code. This is a significant drop from the 8th pass (12 issues) and confirms the codebase has reached a high level of maturity. The most impactful finding is **CoAP block transfer resource leak** (reader/writer locks not released on error). The remaining issues are bounds-check gaps in S7comm, Tarantool, and Thrift.

Over **30 agent-reported findings were verified as false positives** and filtered out, including claims about RTMP AMF0 parsing (loop condition is correct), SNMP OID parsing (already guarded), Gemini response size (already fixed in 8th pass), TACACS MD5 rotation (works correctly with signed 32-bit), and Telnet IAC handling (correctly skips 3 bytes).

No critical security vulnerabilities were found. All prior-pass fixes remain intact.

---

## High-Severity Issues

### 1. CoAP — Block Transfer Reader/Writer Locks Not Released on Error
**File:** `src/worker/coap.ts:790-840`

The block-wise GET transfer loop can throw at line 814 (`CoAP block sequence error`) or via timeout. The `writer.releaseLock()` and `reader.releaseLock()` calls at lines 838-839 are outside the loop with no try-finally wrapper, so any error path leaks both locks.

**Fix:** Wrap the block transfer section (lines 788-839) in try-finally that releases both locks and closes the socket.

---

## Medium-Severity Issues

### 2. S7comm — parseSZLResponse Missing Bounds Check Before paramLen Read
**File:** `src/worker/s7comm.ts:345-348`

At line 348, `data[s7Offset + 6]` and `data[s7Offset + 7]` (indices 13-14) are read without validating `data.length >= 15`. The only prior check at line 345 validates `data[7]`. On short responses, these reads return `undefined`, silently producing `paramLen = 0`.

**Fix:** Add `if (data.length < s7Offset + 8) return result;` before line 348.

---

### 3. S7comm — handleS7ReadDB Insufficient Bounds Check for bitLen
**File:** `src/worker/s7comm.ts:744-748`

The guard at line 744 checks `readResp.length > 21` (minimum 22 bytes), but line 748 accesses `readResp[23]` and `readResp[24]` which require at least 25 bytes. For responses of 22-24 bytes, these reads return `undefined`.

**Fix:** Change `readResp.length > 21` to `readResp.length >= 25` on line 744.

---

### 4. Tarantool — mpSkipValue Missing Bounds Check for str8/bin8 and str16/bin16
**File:** `src/worker/tarantool.ts:284-286`

Line 284: `data[offset + 1]` is read without checking `offset + 1 < data.length` for str8/bin8 types. Line 286: `data[offset + 1]` and `data[offset + 2]` are read without bounds check for str16/bin16. Both can return `undefined`, producing `NaN` offsets.

**Fix:** Add bounds guards: `if (offset + 2 > data.length) return data.length;` for str8/bin8, and `if (offset + 3 > data.length) return data.length;` for str16/bin16.

---

### 5. Thrift — T_LIST and T_MAP Size Not Capped
**File:** `src/worker/thrift.ts:222,239`

`readI32(data, offset)` returns a signed 32-bit value used directly as a loop bound in T_LIST (line 226) and T_MAP (line 243). A malformed packet with `size = 0x7FFFFFFF` would iterate ~2 billion times, hanging the worker.

**Fix:** Cap size to a reasonable maximum: `const size = Math.min(readI32(data, offset), 10000);`

---

## Prior-Pass Fixes Verified Intact

All fixes from passes 1–8 remain correctly applied. No regressions detected.

---

## False Positives Filtered (30+)

Key false positives rejected during verification:

| Reported Finding | Reason Rejected |
|---|---|
| RTMP AMF0 off-by-one at pos+2 | Loop condition `pos + 2 < data.length` correctly guarantees `data[pos+2]` is valid |
| SNMP parseOID missing empty check | Line 379 already has `if (data.length > 0)` guard |
| SNMP OID encoding continuation bit backwards | Unshift order is correct: last byte has no continuation, all others do |
| Gemini response size check after accumulation | Already fixed in 8th pass — check is now before `chunks.push()` |
| TACACS rotl unsigned shift needed | MD5 works correctly with signed 32-bit; `add32` masks with `& 0xffffffff` |
| Telnet IAC WONT/DONT skips wrong bytes | Code correctly advances 3 bytes (IAC + cmd + opt) |
| TURN XOR decode signed shift | `0x2112A442 >> 16` = `0x2112` (positive, no sign extension) |
| TDS 3-byte date sign extension | Max value 0xFFFFFF = 16,777,215 < 2^31, no sign issue |
| Rserve extractSEXPResult infinite loop | `headerLen` is always 4 or 8, so `offset` always advances |
| RMI extractRemoteRef bounds | Loop condition `i < data.length - 3` ensures `data[i+2]` is valid |
| CoAP encodeBlockOption shift overflow | NUM field is 20-bit max per RFC 7959; `num << 4` stays within 32-bit range |

---

## Priority Fix List

### P0 — High Severity
1. **CoAP** — Try-finally for reader/writer lock release in block transfer

### P1 — Medium Severity
2. **S7comm** — Bounds check before paramLen read in parseSZLResponse
3. **S7comm** — Change `> 21` to `>= 25` in handleS7ReadDB
4. **Tarantool** — Bounds check for str8/bin8 and str16/bin16 in mpSkipValue
5. **Thrift** — Cap T_LIST and T_MAP size to prevent runaway loops

---

## Metrics

| Category | Count |
|---|---|
| High | 1 |
| Medium | 4 |
| Low | 0 |
| Prior fixes verified intact | All |
| False positives filtered | 30+ |

**Previous report:** [PROTOCOL_REVIEW_8TH_PASS.md](PROTOCOL_REVIEW_8TH_PASS.md)
