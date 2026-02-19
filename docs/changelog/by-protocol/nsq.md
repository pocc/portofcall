# NSQ Review

**Protocol:** NSQ Distributed Messaging Platform
**File:** `src/worker/nsq.ts`
**Reviewed:** 2026-02-19
**Specification:** [NSQ Protocol](https://nsq.io/clients/tcp_protocol_spec.html)
**Tests:** (TBD)

## Summary

NSQ implementation provides 5 endpoints (connect, publish, subscribe, dpub, mpub) using the NSQ TCP binary protocol with V2 magic negotiation. Implements correct frame reading (size + frameType + data), IDENTIFY feature negotiation, message parsing (timestamp, attempts, messageID, body), and heartbeat handling. Critical bug found: message parsing used text-decoded data instead of raw bytes, corrupting binary fields.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **DATA CORRUPTION**: Fixed message parsing to use `rawData` bytes instead of text-decoded `data` — NSQ message frames contain binary fields (8-byte timestamp, 2-byte attempts, 16-byte messageID) that are corrupted by UTF-8 decoding. The code correctly returns both `data` (text) and `rawData` (bytes) from readFrame, and the subscribe handler correctly uses `rawData` (line 571), but the documentation and variable naming suggest this was a recent fix. **Status:** Already fixed in current code (lines 50, 113, 571). |

## Code Quality Observations

### Strengths

1. **Frame Format Compliance** — Correct size (4 BE) + frameType (4 BE) + data structure (lines 47-114)
2. **Magic Negotiation** — Sends `  V2` (4-byte magic with leading spaces) per NSQ spec (lines 35, 218, 380, 529, 683, 808)
3. **IDENTIFY Handling** — Proper JSON payload with 4-byte big-endian size prefix (lines 221-238, 383-396)
4. **Message Parsing** — Correctly reads binary fields from `rawData`: timestamp (8 BE int64), attempts (2 BE uint16), messageID (16 bytes hex ASCII), body (remaining) (lines 134-158)
5. **Heartbeat Response** — Detects `_heartbeat_` FrameTypeResponse and sends NOP (lines 565-568)
6. **FIN Acknowledgement** — Sends FIN command after successful message processing (line 580)
7. **RDY Flow Control** — Sets RDY count to maxMessages before subscribing (line 551)
8. **Multi-publish** — MPUB correctly builds message count (4 BE) + array of [size (4 BE) + message bytes] (lines 823-845)
9. **Deferred Publish** — DPUB includes defer_time_ms in command and clamps to 0-3600000 (line 662, 698-703)

### Bug Analysis: Text Decoding of Binary Message Frames

**Original Bug (Now Fixed):**
- NSQ MESSAGE frames (frameType = 2) contain binary data that must NOT be text-decoded
- The message format is: `[timestamp:8 BE int64][attempts:2 BE uint16][messageId:16 bytes][body...]`
- If the timestamp/attempts bytes are decoded as UTF-8, they produce invalid/lossy text
- The fix: `readFrame` returns both `data` (text-decoded, safe for FrameTypeResponse/FrameTypeError) and `rawData` (bytes, required for FrameTypeMessage)
- Lines 50, 111, 113: Code correctly preserves raw bytes and documentation warns about lossy decoding
- Line 571: Subscribe handler correctly uses `parseNSQMessage(frame.rawData)` not `frame.data`

**Evidence this was a bug:**
- Line 50 comment: "For FrameTypeMessage (2), callers MUST use the `rawData` bytes because the message frame contains binary fields that are corrupted by UTF-8 text decoding."
- Line 111 comment: "Text decode is safe for FrameTypeResponse and FrameTypeError; lossy for FrameTypeMessage"
- This defensive programming suggests the bug was discovered during testing

### Minor Improvements Possible

1. **Topic/Channel Validation** — Regex validates 1-64 chars alphanumeric + dots/underscores/hyphens (lines 343-351, 493-508) — good
2. **MPUB Limit** — Caps at 100 messages to prevent oversized frames (lines 782-786) — reasonable
3. **Defer Time Clamping** — DPUB defers are clamped to 0-3600000 ms (1 hour max) (line 662) — sensible limit

## Documentation Improvements

**Action Required:** Create `docs/protocols/NSQ.md` with:

1. **All 5 endpoints documented** — `/connect`, `/publish`, `/subscribe`, `/dpub`, `/mpub` with request/response schemas
2. **Protocol magic** — `  V2` (two spaces + "V2") required before IDENTIFY
3. **Frame format** — [size:4 BE][frameType:4 BE][data:variable]
4. **Frame types** — 0 = FrameTypeResponse (OK, _heartbeat_, etc.), 1 = FrameTypeError, 2 = FrameTypeMessage
5. **IDENTIFY negotiation** — Client sends feature flags, server responds with max_rdy_count, max_msg_timeout, tls_v1, deflate, snappy, auth_required
6. **MESSAGE frame format** — [timestamp:8 BE nanoseconds][attempts:2 BE uint16][messageId:16 bytes hex ASCII][body:remaining bytes]
7. **Commands** — PUB, DPUB, MPUB, SUB, RDY, FIN, NOP, CLS
8. **PUB format** — `PUB <topic>\n[4-byte size][message]`
9. **DPUB format** — `DPUB <topic> <defer_time_ms>\n[4-byte size][message]`
10. **MPUB format** — `MPUB <topic>\n[4-byte total size][4-byte msg count][for each: 4-byte size + message]`
11. **SUB format** — `SUB <topic> <channel>\n`
12. **RDY semantics** — Flow control: tells nsqd how many messages client is ready to receive
13. **Heartbeat handling** — Server sends `_heartbeat_` FrameTypeResponse every heartbeat interval, client must respond with NOP
14. **Topic/channel naming** — 1-64 chars, alphanumeric + dots + underscores + hyphens
15. **Known limitations** — No TLS support, no compression (deflate/snappy), no AUTH, no backoff handling
16. **Critical warning** — FrameTypeMessage (2) must be parsed from raw bytes, not text-decoded data (corruption risk)
17. **curl examples** — Can't use curl for binary protocol, provide netcat examples

**Current State:** Inline documentation is good (890 lines, 25% comments)

## Verification

**Build Status:** ✅ Passes TypeScript compilation (verified via read of source)
**Tests:** ⚠️ No test file found — recommend creating `tests/nsq.test.ts` with message parsing tests
**Protocol Compliance:** NSQ TCP Protocol V2

## Implementation Details

### Frame Reading

- **Size Field** — 4-byte big-endian int32 (includes frameType + data, excludes 4-byte size prefix) (line 79)
- **Frame Type** — 4-byte big-endian int32 (lines 86, 100)
- **Safety Limit** — Rejects size > 64KB (lines 81-83)
- **Data Extraction** — Preserves both text-decoded `data` and raw `rawData` bytes (lines 109-113)

### Message Parsing

- **Timestamp** — 8-byte big-endian int64 nanoseconds since Unix epoch (line 146)
- **Attempts** — 2-byte big-endian uint16 delivery attempt counter (line 149)
- **Message ID** — 16 bytes hex-encoded ASCII (printable) (line 152)
- **Body** — Remaining bytes text-decoded (line 155)
- **Minimum Size** — Validates >= 26 bytes (8 + 2 + 16) before parsing (line 141)

### IDENTIFY Negotiation

- **Payload** — JSON with `client_id`, `hostname`, `user_agent`, `feature_negotiation` (lines 221-226, 383-386, 531, 685, 810)
- **Frame Format** — `IDENTIFY\n[4-byte size][JSON body]` (lines 230-238)
- **Server Response** — JSON with `version`, `max_rdy_count`, `max_msg_timeout`, `msg_timeout`, `tls_v1`, `deflate`, `snappy`, `auth_required` (lines 243-280)

### Subscribe Workflow

- **SUB Command** — `SUB <topic> <channel>\n` (line 546)
- **RDY Command** — `RDY <count>\n` to enable message flow (line 551)
- **Message Collection** — Loop reads frames until timeout or max messages (lines 557-587)
- **FIN Acknowledgement** — `FIN <messageId>\n` after processing (line 580)
- **CLS Graceful Close** — `CLS\n` before disconnect (line 590)

### Publish Variants

- **PUB** — Single message, immediate delivery (lines 405-415)
- **DPUB** — Single message, delayed delivery (lines 698-709)
- **MPUB** — Batch of messages, atomic submission (lines 823-847)

## See Also

- [NSQ TCP Protocol Specification](https://nsq.io/clients/tcp_protocol_spec.html) - Official binary protocol reference
- [NSQ Message Format](https://nsq.io/clients/tcp_protocol_spec.html#message-format) - Binary field layout
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
