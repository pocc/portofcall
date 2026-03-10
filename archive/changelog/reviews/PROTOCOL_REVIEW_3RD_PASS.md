# Protocol Review — 3rd Pass
**Review Date:** 2026-02-20
**Scope:** 277 protocol implementations across 8 parallel review batches
**Focus:** API completeness, bug risks, UI parity, test quality

---

## Executive Summary

The 3rd pass surfaced **31 new critical/high findings** not present in the prior two passes, predominantly in:
- **Integer overflow / bounds checking** across binary protocol parsers
- **Resource leak patterns** (reader/writer locks, timeout handles) in error paths
- **Broken imports** (`node:crypto`) that cause runtime crashes in Workers
- **Security gaps** (XML injection, command injection, CRLF injection)
- **Silent data loss** (truncated responses, incomplete RESP parsing, missing type handlers)

---

## Critical Issues — Fix Immediately

### 1. YMSG — `node:crypto` Import Crashes Worker
**File:** `src/worker/ymsg.ts:51`
```typescript
import { createHash } from 'node:crypto'; // FAILS in Cloudflare Workers
```
**Impact:** YMSG protocol is entirely non-functional at runtime. Worker throws on import.
**Fix:** Replace with `crypto.subtle.digest()` (Web Crypto API).

---

### 2. WinRM — XML Injection via Unescaped Input
**File:** `src/worker/winrm.ts:100+`
`escapeXml()` is defined but **never called** on user-supplied `username` or `hostname`. SOAP envelope constructed with raw values.

**Exploit:** hostname `test"><inject/><x attr="` breaks XML structure.
**Fix:** Call `escapeXml()` on all user inputs before embedding in SOAP envelope.

---

### 3. Oracle TNS — `readBytes()` Consumes More Than Requested
**File:** `src/worker/oracle-tns.ts:206-227`

Two-step read pattern:
```typescript
const headerData = await readBytes(reader, 8);
const remaining = await readBytes(reader, packetLength - 8);
```
When the OS delivers a complete packet atomically, `readBytes(reader, 8)` consumes all data and discards excess via `subarray(0, 8)`. The second call blocks indefinitely.

**Impact:** `handleOracleQuery` and `handleOracleSQLQuery` hang on fast/local connections.
**Fix:** Maintain a persistent read buffer across calls; use a buffered reader abstraction.

---

### 4. SCP — Test Assertions Don't Match Response Fields
**File:** `tests/scp.test.ts:145, 224, 297`

| Test expects | Implementation returns |
|---|---|
| `data.files` | `data.entries` |
| `data.content` | `data.data` |
| `data.size` | `data.bytesUploaded` |

**Impact:** All SCP list/get/put tests silently pass while checking wrong keys — complete false coverage.
**Fix:** Align test assertions with actual response shape.

---

### 5. Tarantool — Integer Overflow in `mpDecode()`
**File:** `src/worker/tarantool.ts:797-800`
```typescript
const v = ((data[off+1] << 24) | ...) >>> 0;
```
Left-shifting a byte by 24 can produce a value with the sign bit set before `>>> 0` normalizes it. Use `DataView.getUint32()` instead.

---

### 6. TDS — Silent Data Loss on Unknown Column Types
**File:** `src/worker/tds.ts:748-983`
`parseColumnValue()` falls through to:
```typescript
return `[type:0x${type.toString(16)}]` // Silently replaces data
```
DECIMAL/NUMERIC sign is also parsed incorrectly (line 959). Users receive placeholder strings instead of actual column data.

---

### 7. MongoDB — Unbounded BSON Recursion (DoS)
**File:** `src/worker/mongodb.ts:124`
```typescript
result[key] = decodeBSON(data, startOffset + offset); // No depth limit
```
A deeply nested BSON document exhausts the call stack.
**Fix:** Add `maxDepth` parameter (default 10); throw on exceed.

---

### 8. Redis — RESP Array Parsing Returns First Line Only
**File:** `src/worker/redis.ts:33-54`
```typescript
if (buffer.includes('\r\n')) {
  return buffer; // Returns "*2\r\n", discarding all elements
}
```
Multi-element Redis responses (arrays) are silently truncated to just the count header.
**Fix:** Implement proper RESP parser that reads `N` bulk strings after `*N`.

---

### 9. OpenVPN — `ackCount` Bounds Not Checked Before Arithmetic
**File:** `src/worker/openvpn.ts:388-399`
```typescript
const ackCount = payload[pos++];
pos += ackCount * 4; // No bounds check — ackCount=64 → pos+=256 → OOB
if (pos >= payload.length) return null; // Too late
return payload.slice(pos); // Potential OOB slice
```
**Fix:** Check `pos + ackCount * 4 <= payload.length` before advancing.

---

### 10. POP3 — Dot-Destuffing Missing from Multi-line Reads
**File:** `src/worker/pop3.ts:67-100`
RFC 1939 §3 requires reversing dot-stuffing (lines starting with `..` become `.`) in RETR and TOP responses. The code mentions it but does not implement it. Email bodies with lines starting `.` are returned with an extra `.`.

---

### 11. LMTP / SMTP — CRLF Injection in Email Headers
**File:** `src/worker/lmtp.ts:395-404`
```typescript
`Subject: ${options.subject}`, // subject can contain \r\nBcc: attacker@evil.com
```
User-supplied `subject`, `from`, `to` embedded directly without CRLF stripping.
**Fix:** Strip `\r` and `\n` from all header fields before building the message.

---

### 12. Livestatus — Command Injection via `args`
**File:** `src/worker/livestatus.ts:570-571`
```typescript
const argsStr = args.length > 0 ? ';' + args.join(';') : '';
const cmdLine = `COMMAND [${timestamp}] ${command.toUpperCase()}${argsStr}`;
```
No character-level validation on `args` elements. Shell metacharacters pass through.
**Fix:** Validate each arg matches `[a-zA-Z0-9_.:-]+` allowlist.

---

### 13. L2TP — AVP Offset Can Integer-Overflow
**File:** `src/worker/l2tp.ts:196-208`
```typescript
if (offset + avpLength > data.length) break;
offset += avpLength;
```
If `avpLength` is a legitimate 10-bit value but the accumulated `offset` exceeds `Number.MAX_SAFE_INTEGER` in a crafted loop, the bounds check can wrap.
**Fix:** Add explicit `offset > data.length` guard inside the loop.

---

### 14. H.323 — TPKT Frame Length Has No Upper Bound
**File:** `src/worker/h323.ts:385-388`
`readTPKTFrame()` rejects `< 4` but accepts any declared size up to 4 GB. A malicious server sends `payloadLength = 2^31`, triggering a massive buffer allocation.
**Fix:** Cap at 65535 bytes (maximum TPKT payload per spec).

---

### 15. IEC 104 — `numObj` Loop Doesn't Cap to Buffer Size
**File:** `src/worker/iec104.ts:429-601`
`numObj` from untrusted ASDU can be 255. If the buffer only has data for 2 objects, the loop runs 255 times anyway, parsing garbage after valid data.
**Fix:** `numObj = Math.min(numObj, maxObjectsForBufferSize)`.

Also: `CP56Time2a` returns string `'invalid'` on bad timestamps (line 385); callers treat it as a valid timestamp value. Change to `null`.

---

## High-Severity Issues

### Binary Parser Integer Overflows (Multiple Protocols)

| Protocol | File | Line | Issue |
|---|---|---|---|
| SCCP | sccp.ts | 162-168 | `totalSize = 4 + uint32` can exceed MAX_SAFE_INTEGER |
| Zabbix | zabbix.ts | 86 | `setUint32` with no bounds — payloads >4 GB silently truncate |
| OPC UA | opcua.ts | 354-357 | 1 MB message cap too high; allows OOM via crafted header |
| Hazelcast | hazelcast.ts | 346-351 | Multi-frame messages return first frame only; rest discarded |
| OpenFlow | openflow.ts | 851-872 | Multi-part stats replies silently truncated after 3 messages |

---

### Resource Leaks — Reader/Writer Locks Not Released on Error

| Protocol | File | Description |
|---|---|---|
| Cassandra | cassandra.ts:269-314 | `reader.getReader()` acquired; `releaseLock()` only on success path |
| CDP | cdp.ts:407-438 | Untracked async loop continues after client disconnect |
| FTP/FTPS | ftp.ts:200-216 | `dataReader` never released in `finally` block |
| EPP | epp.ts:331-345 | Locks released before socket close; not in `finally` |
| S7comm | s7comm.ts:544-655 | Timeout handle leaks if `socket.opened` throws |
| SANE | sane.ts | Reader not cancelled on large-length DoS input |

**Pattern fix for all:** Acquire locks inside `try`, release in `finally`:
```typescript
const reader = socket.readable.getReader();
try {
  // ... operations
} finally {
  reader.releaseLock();
  await socket.close();
}
```

---

### Security Findings

| Severity | Protocol | File | Finding |
|---|---|---|---|
| HIGH | WinRM | winrm.ts:28-35 | `escapeXml()` defined but never called on user input |
| HIGH | Sentinel | sentinel.ts:557 | masterName validation bypassed via command string building |
| HIGH | SANE | sane.ts:155-168 | Path traversal: blocks `..` but not single `.` or absolute paths |
| HIGH | SNMP | snmp.ts:129 | OID components not validated; `NaN` passes to encoder |
| HIGH | ZooKeeper | zookeeper.ts:32 | `VALID_COMMANDS` list defined but command never validated against it |
| HIGH | Chargen | chargen.ts | No `checkIfCloudflare()` call; DoS amplification attack vector |
| MEDIUM | HSRP | hsrp.ts:128-132 | Virtual IP split without 0-255 range validation |
| MEDIUM | BGP | bgp.ts:62 | Router ID allows leading zeros (`192.001.1.1`) and isn't normalized |

---

### Protocol Violations

| Protocol | File | RFC | Violation |
|---|---|---|---|
| POP3 | pop3.ts | RFC 1939 §3 | Dot-destuffing not applied to RETR/TOP responses |
| LMTP | lmtp.ts | RFC 2821 | CRLF injection possible in headers |
| CoAP | coap.ts:744-779 | RFC 7959 | Block-wise GET sends CON without waiting for ACK |
| AMQP | amqp.ts | AMQP 0-9-1 | Field table parsing absent (present in amqps.ts but not amqp.ts) |
| Redis | redis.ts | RESP spec | Array responses return only count header, not elements |
| LLMNR | llmnr.ts:88 | RFC 1035 | Pointer compression depth capped at 20; doesn't handle all valid depths |
| HL7 | hl7.ts:91 | MLLP | Start-of-block `0x0B` byte inside payload incorrectly splits frame |
| TELNET | telnet.ts:15-29 | RFC 854 | IAC negotiation constants defined but never sent/processed |

---

### Broken/Incomplete Implementations

| Protocol | Status | Detail |
|---|---|---|
| SFTP | 20% | All file operations return 501; architectural blocker (needs WebSocket) |
| VNC | 15% | DES auth loop never executes; probe-only |
| TACACS+ | 60% | Custom MD5 without test vectors; GETPASS re-auth missing |
| Thrift | 40% | Message framing hardcoded; varint encoding missing |
| TURN | 50% | `MESSAGE-INTEGRITY` (RFC 5766 §15.4) not implemented; auth always fails |
| WHOIS | 70% | Referral chasing code incomplete |
| X11 | 30% | Setup request built; response parsing missing |
| XMPP | 50% | TLS upgrade missing; stream feature regex fragile |

---

### Correctness Issues

| Protocol | File | Issue |
|---|---|---|
| PostgreSQL | postgres.ts:59-65 | `md5()` upper 32-bit length bits always 0; correct for passwords but breaks contract for >512 MB inputs |
| Beanstalkd | beanstalkd.ts:90-112 | O(n²) buffer allocation: full reassembly on every TCP chunk |
| Clickhouse | clickhouse.ts:162 | `Math.pow(2, shift)` loses precision for shift ≥ 53; affects VarUInt >2^53 |
| CIFS | cifs.ts:85 | `MD4()` bit-length uses `>>> 0`; wrong for inputs > 512 MB |
| EPMD | epmd.ts:100-113 | Byte shifting for port may sign-extend before `>>> 0` mask |
| SOCKS5 | socks5.ts:82-91 | IPv6 groups display without `:` separator |
| IKE | ike.ts:400-402 | `Buffer.allocUnsafe()` for IKE cookies; uninitialized memory in crypto context |
| Git | git.ts:98-108 | Buffer grows unbounded; no cumulative size cap against malicious servers |

---

## Test Quality Findings

### False-Positive Test Pattern (Widespread)
Multiple test files use conditional assertions that always pass:
```typescript
if (data.success) {
  expect(data.something).toBeDefined(); // Only runs if connected
} else {
  expect(data.error).toBeDefined();     // Always true for unreachable hosts
}
```
Tests appear to cover happy paths but only ever exercise the `else` branch. **Affects:** adb, afp, ami, beanstalkd, bgp, bitcoin, and ~40 others.

**Fix pattern:**
```typescript
// Assert the specific expected outcome explicitly
expect(data.success).toBe(false);
expect(data.error).toMatch(/ECONNREFUSED|connection refused/i);
```

### Missing Test Coverage

| Protocol | Missing Tests |
|---|---|
| SCP | Test assertions use wrong field names (files/content/size) |
| S7comm | No tests for read/write DB operations |
| Cassandra | No tests for query/prepare endpoints |
| CoAP | No integration test for observe feature |
| CDP | No tests for WebSocket tunnel endpoint |
| VNC | No auth attempt tests |
| TACACS+ | No GETPASS re-authentication test |
| TDS | No multi-packet or binary column type tests |
| OpenFlow | No multi-part stats reply test |

---

## UI Parity Findings

Most protocols have matching UI components. Newly identified gaps:

| Protocol | Gap |
|---|---|
| Elasticsearch | No 512 KB+ response truncation indicator in UI |
| EPP | `domain-renew` action not exposed in UI |
| Ethereum | RPC method dropdown missing methods from worker |
| Vault | UI shows health only; secret read/write operations not exposed |
| WinRM | UI doesn't warn about missing auth before submitting commands |

---

## Priority Action List

### P0 — Deploy Blockers (Fix Before Next Release)
1. **YMSG** — Replace `node:crypto` import (`ymsg.ts:51`)
2. **WinRM** — Call `escapeXml()` on all user inputs
3. **SCP tests** — Fix field name assertions (`files`→`entries`, `content`→`data`, `size`→`bytesUploaded`)
4. **Redis** — Fix RESP array parser to read all elements
5. **LMTP/SMTP** — Strip `\r\n` from all header fields

### P1 — Security Fixes (This Sprint)
6. **Oracle TNS** — Buffered reader to fix hung connections
7. **Livestatus** — Allowlist-validate `args` array elements
8. **SANE** — Add absolute path and single `.` checks
9. **ZooKeeper** — Validate commands against `VALID_COMMANDS` before sending
10. **SNMP** — Validate OID components are non-negative integers
11. **L2TP** — Add overflow guard in AVP offset arithmetic
12. **OpenVPN** — Check `ackCount * 4 <= remaining` before arithmetic
13. **SCCP** — Cap `totalSize` before bounds check
14. **IEC 104** — Cap `numObj` to buffer capacity; return `null` not `'invalid'` from timestamp parser
15. **H.323** — Cap TPKT declared length at 65535

### P2 — Correctness (Next Sprint)
16. **MongoDB** — Add `maxDepth` to BSON decoder
17. **Tarantool** — Replace bit-shift with `DataView.getUint32()`
18. **TDS** — Fix `parseColumnValue()` for DECIMAL sign and unknown types
19. **POP3** — Implement dot-destuffing in multi-line reads
20. **HL7** — Fix MLLP frame detection to scan for START then END, not first occurrence
21. Fix all reader/writer lock leaks in Cassandra, CDP, FTP, EPP, S7comm, SANE

### P3 — Test Coverage
22. Fix false-positive conditional test pattern across ~40 test files
23. Fix SCP test field names
24. Add missing tests: Cassandra query/prepare, CoAP observe, CDP tunnel, VNC auth, TDS binary columns, OpenFlow multi-part stats

### P4 — Completeness
25. SFTP: Implement WebSocket session endpoint
26. TURN: Implement `MESSAGE-INTEGRITY`
27. CoAP: Fix block-wise ACK handling (RFC 7959 compliance)
28. AMQP: Add field table parsing (parity with amqps.ts)
29. XMPP: Add STARTTLS upgrade
30. Telnet: Implement IAC negotiation state machine
31. Chargen: Add `checkIfCloudflare()` call

---

## Metrics

| Category | 3rd Pass New Findings | Prior Pass Status |
|---|---|---|
| Critical bugs | 15 | New discoveries |
| High security issues | 8 | New discoveries |
| High protocol violations | 8 | New discoveries |
| Broken implementations | 8 | 3 were known (SFTP, VNC, RDP) |
| Test false positives | ~40 files | Pattern not previously identified |
| Resource leaks | 6 new | 5 were fixed in 2nd pass |

**Overall code quality:** Production-ready for ~210/277 protocols. ~50 protocols have correctness or security issues requiring fixes before production use. ~17 are partially/non-functional (SFTP, VNC, X11, Thrift, TURN, etc.).

---

**Document Version:** 1.0
**Review Method:** 8 parallel static analysis agents across alphabetical protocol batches
**Previous Reports:** [PROTOCOL_REVIEW_FINDINGS.md](PROTOCOL_REVIEW_FINDINGS.md)
