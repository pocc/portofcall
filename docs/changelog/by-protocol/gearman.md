# Gearman Review

**Protocol:** Gearman Job Queue (Text Admin + Binary Protocol)
**File:** `src/worker/gearman.ts`
**Reviewed:** 2026-02-19
**Specification:** [Gearman Protocol](http://gearman.org/protocol/)
**Tests:** (TBD)

## Summary

Gearman implementation provides 3 endpoints (connect, command, submit) supporting both text admin protocol (version, status, workers, maxqueue) and binary protocol (job submission with foreground/background, priority levels, work progress tracking). Implements correct binary framing with `\0REQ`/`\0RES` magic, proper packet type handling, and comprehensive work result collection (WORK_DATA, WORK_WARNING, WORK_STATUS, WORK_COMPLETE, WORK_FAIL, WORK_EXCEPTION). Minor bug found in packet type table (not used in code logic).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Minor | **DOCUMENTATION BUG**: PACKET_TYPE_NAMES table has duplicate key `[PacketType.GET_STATUS]` overwriting earlier entry — GET_STATUS (15) is defined twice, second definition at line 90 overwrites line 69 value. Does not affect runtime as table is only used for debug output. |

## Code Quality Observations

### Strengths

1. **Binary Protocol Implementation** — Correct `\0REQ`/`\0RES` magic validation (lines 107-114)
2. **Packet Framing** — Proper 12-byte header parsing: magic (4) + type (4 BE) + dataLen (4 BE) (lines 123-146)
3. **Work Progress Tracking** — Collects WORK_DATA chunks, WORK_WARNING, WORK_STATUS updates during foreground job execution (lines 734-850)
4. **Priority Support** — Implements all 6 job submission types: SUBMIT_JOB (normal), _HIGH, _LOW, and _BG variants (lines 60-68, 631-644)
5. **Field Separation** — Correct NULL-byte field separation in request packets (lines 136-144)
6. **Extra Bytes Handling** — Prefetch mechanism passes unconsumed bytes from one packet to next read (lines 155-161, 237, 738-757)
7. **Safety Limits** — Rejects packets > 16 MB to prevent memory exhaustion (lines 209-211)
8. **Command Whitelist** — Admin protocol blocks destructive operations (version, status, workers, maxqueue query-only) (lines 495-520)

### Bugs Identified

1. **PACKET_TYPE_NAMES Duplicate** — Line 90 redefines `[PacketType.GET_STATUS]: 'GET_STATUS'` which was already defined at line 69. This is a harmless bug since the const is only used for debug output (line 249), but creates confusion. **Fix:** Remove duplicate or rename to clarify which GET_STATUS variant this represents (client request vs server response).

### Minor Improvements Possible

1. **Timeout Handling** — Binary packet reader uses nested timeout promises which could be simplified
2. **Error Frame Parsing** — ERROR packet format is `errorCode\0errorText` — code splits on NULL but doesn't validate format (lines 689-692, 833-836)
3. **Multi-line Admin Responses** — Knows `status` and `workers` are multi-line with `.` terminator, but `MULTILINE_COMMANDS` array is only checked in `handleGearmanCommand` (line 317, 547)

## Documentation Improvements

**Action Required:** Create `docs/protocols/GEARMAN.md` with:

1. **All 3 endpoints documented** — `/connect`, `/command`, `/submit` with request/response schemas
2. **Protocol comparison** — Text admin (port 4730, ASCII commands) vs Binary protocol (same port, binary frames)
3. **Binary frame format** — 12-byte header: magic (4), type (4 BE uint32), dataLen (4 BE uint32) + data (variable, NULL-separated fields)
4. **Magic codes** — `\0REQ` (0x00524551) for client requests, `\0RES` (0x00524553) for server responses
5. **Packet type table** — All 19+ packet types with direction and purpose:
   - Client requests: SUBMIT_JOB (7), SUBMIT_JOB_BG (18), _HIGH (21), _HIGH_BG (32), _LOW (33), _LOW_BG (34), GET_STATUS (15)
   - Server responses: JOB_CREATED (8), WORK_DATA (28), WORK_WARNING (29), WORK_STATUS (12), WORK_COMPLETE (13), WORK_FAIL (14), WORK_EXCEPTION (25), ERROR (19), STATUS_RES (20)
6. **Job submission types** — Foreground (SUBMIT_JOB waits for result) vs Background (SUBMIT_JOB_BG returns immediately after JOB_CREATED)
7. **Priority levels** — high (processed first), normal (default), low (processed last)
8. **Work progress frames** — WORK_DATA (partial results), WORK_WARNING (non-fatal issues), WORK_STATUS (numerator/denominator progress)
9. **Terminal responses** — WORK_COMPLETE (success + result data), WORK_FAIL (failure, no data), WORK_EXCEPTION (exception message)
10. **Admin commands** — version (single line), status (multi-line, dot-terminated: FUNCTION, TOTAL, RUNNING, AVAILABLE_WORKERS), workers (multi-line: FD, IP, CLIENT-ID, functions), maxqueue FUNC (query), maxqueue FUNC MAX (blocked - mutation)
11. **Error response format** — ERROR packet: `errorCode\0errorText` (both strings)
12. **Known limitations** — No worker registration support, no CAN_DO/CANT_DO, no GRAB_JOB worker commands
13. **curl examples** — Can't use curl for binary protocol, but provide netcat/openssl examples for admin protocol

**Current State:** Inline documentation is comprehensive (868 lines, 35% comments)

## Verification

**Build Status:** ✅ Passes TypeScript compilation (verified via read of source)
**Tests:** ⚠️ No test file found — recommend creating `tests/gearman.test.ts`
**Protocol Compliance:** Gearman Protocol (no version number in spec)

## Implementation Details

### Text Admin Protocol

- **Command Format** — Newline-terminated ASCII commands: `version\n`, `status\n`, `workers\n`, `maxqueue FUNC\n`
- **Response Parsing** — Single-line (version) vs multi-line dot-terminated (status, workers) (lines 262-312)
- **Status Format** — Tab-delimited: `FUNCTION\tTOTAL\tRUNNING\tAVAILABLE_WORKERS\n.\n` (lines 389-410)
- **Whitelist** — Blocks `shutdown`, `shutdown graceful`, and `maxqueue` with 2+ args (mutation) (lines 495-520)

### Binary Protocol

- **Request Packet Builder** — Assembles magic + type + dataLen + NULL-separated fields (lines 122-146)
- **Response Packet Reader** — Reads 12-byte header, validates magic, extracts type/dataLen, reads data (lines 152-253)
- **Magic Validation** — Checks all 4 bytes of `\0RES` (0x00, 0x52, 0x45, 0x53) (lines 107-114)
- **Size Limit** — Rejects dataSize > 16 MB (lines 209-211)
- **Prefetch Handling** — Unconsumed bytes from header read are passed to data read phase (lines 214-222)

### Job Submission

- **Foreground Jobs** — SUBMIT_JOB (7), SUBMIT_JOB_HIGH (21), SUBMIT_JOB_LOW (33) — waits for WORK_COMPLETE (lines 734-850)
- **Background Jobs** — SUBMIT_JOB_BG (18), _HIGH_BG (32), _LOW_BG (34) — returns after JOB_CREATED (lines 718-730)
- **Field Format** — `functionName\0uniqueId\0payload` (lines 670-674)
- **JOB_CREATED** — Response contains job handle string (line 716)
- **Work Collection Loop** — Reads WORK_DATA, WORK_WARNING, WORK_STATUS until terminal frame (WORK_COMPLETE, WORK_FAIL, WORK_EXCEPTION) (lines 739-851)
- **Error Handling** — ERROR frames can arrive at any point (lines 688-700, 832-844)

### Packet Type Bug

- **Line 69:** `[PacketType.GET_STATUS]: 'GET_STATUS'` — First definition
- **Line 90:** `[PacketType.GET_STATUS]: 'GET_STATUS'` — Duplicate definition (overwrites first)
- **Impact:** Only affects debug output at line 249 (`typeName: PACKET_TYPE_NAMES[packetType] || ...`)
- **Fix:** Remove duplicate or clarify if this represents different GET_STATUS variants

## See Also

- [Gearman Protocol](http://gearman.org/protocol/) - Official protocol specification
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
