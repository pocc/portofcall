# AFP readExact Byte-Drop Fix — 2026-02-23

## Finding: readExact drops bytes across TCP message boundaries (HIGH)

**Protocol:** AFP (afp.ts)
**Category:** Data corruption in normal use

### Description

The `readExact` function reads exactly N bytes from a TCP socket but silently discards any excess bytes delivered in the same `reader.read()` chunk. When used to read a DSI header (16 bytes) followed by the DSI payload, if the TCP stack delivers both in a single chunk (common behavior — servers typically send header+payload in one segment), the payload bytes co-delivered with the header are lost.

This causes:
- Corrupted AFP responses (payload starts mid-stream)
- Protocol desync on multi-command sessions (login → listVolumes → enumerate)
- Silent wrong results: the user sees garbage data instead of directory listings

### Input that triggers the bug

1. Connect to any AFP server
2. Send DSIGetStatus → server replies with 16-byte header + N-byte payload in one TCP segment
3. `readExact(reader, 16)` returns the header but drops the first bytes of the payload
4. `readExact(reader, N)` reads from the wrong offset → corrupted data

### Fix

Added a `leftover: { data: Uint8Array }` parameter to `readExact` and `readDSIResponse`. Excess bytes from each `reader.read()` call are preserved in the leftover buffer and consumed by subsequent reads.

- `AFPSession` class now has a `leftover` field shared across all its operations
- Standalone handlers (`handleAFPConnect`, `handleAFPGetServerInfo`, `handleAFPOpenSession`) create a local leftover buffer

### Bulk pattern (NOT filed as separate findings per REVIEW_GUIDELINES.md)

21 other protocol handlers use the same `readExact` pattern without leftover buffering:
rdp, x11, dicom, tacacs, h323, bittorrent, socks4, nbd, radius, tarantool, minecraft, pcep, ceph, rethinkdb, pptp, amqps, tds, ajp, amqp, rtmp, git

**Recommendation:** Extract a shared `createBufferedReader(reader)` helper into a common module and replace all per-file implementations. This would eliminate the bug class entirely.

Files where the bug is **most impactful** (multi-read protocols):
- `rdp.ts` — reads TPKT header (4B) then payload sequentially
- `amqp.ts` — reads frame header then body
- `dicom.ts` — reads DICOM PDU header then payload
- `tds.ts` — reads TDS header then body

Files where the bug is **low impact** (single-read or final-read):
- `ajp.ts` — only uses readExact for 5-byte CPong (single message)
- `bittorrent.ts` — uses closure-scoped leftover (already buffered correctly)
