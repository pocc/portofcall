# ClamAV Review

**Protocol:** ClamAV Daemon Protocol (clamd)
**File:** `src/worker/clamav.ts`
**Reviewed:** 2026-02-19
**Specification:** ClamAV Protocol Documentation
**Tests:** None

## Summary

ClamAV implementation provides 4 endpoints (ping, version, stats, scan) supporting the clamd TCP protocol on port 3310. Handles three command formats (plain, n-prefix, z-prefix) and INSTREAM chunked scanning protocol. Critical bug found: STATS endpoint uses weak END detection regex that can false-match on words like "PENDING", "BACKEND". Well-structured with proper base64 decoding and chunk framing for virus scanning.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **FALSE POSITIVE**: STATS endpoint regex `/^END\s*$/m` can match "END" within longer words (line 381) — e.g., "PENDING SCANS" would match because multiline ^ anchors to line start. Should use word boundaries or exact line matching |
| 2 | Medium | **DATA TRUNCATION**: readClamdResponse stops at first null byte or newline (line 50) but ClamAV responses can contain multiple lines — VERSION returns single line so OK, but STATS is multiline and handled separately |
| 3 | Low | **RESOURCE LEAK**: Timeout promises created in ping/version/stats endpoints never cleared — timers run until expiration even after successful reads |

## Code Quality Observations

**Strengths:**
1. **Protocol variant support** — Handles n-prefix (newline) and z-prefix (null) command formats correctly
2. **INSTREAM implementation** — Proper chunked protocol: 4-byte big-endian length + data, terminated by zero-length chunk
3. **Base64 decoding** — Converts base64 scan data to Uint8Array with atob + manual byte extraction
4. **Size limits** — 10MB scan data limit, 65536 byte response limit for safety
5. **Virus name extraction** — Parses "stream: VIRUSNAME FOUND" responses with regex matching
6. **Stats parsing** — Extracts POOLS, THREADS, QUEUE, MEMSTATS from multiline stats output
7. **Cloudflare detection** — Integrated in all 4 endpoints
8. **Proper chunk framing** — Uses DataView.setUint32(0, length, false) for big-endian length prefix (network byte order)

**Limitations:**
1. **STATS regex bug** — END detection can false-match (bug #1)
2. **No test coverage** — No automated tests to verify INSTREAM chunking, virus detection, or STATS parsing
3. **No streaming support** — scan endpoint buffers entire 10MB file in memory; no chunked upload API
4. **No multi-file scanning** — Only supports INSTREAM for single file; no MULTISCAN or CONTSCAN support
5. **Limited commands** — Only implements PING, VERSION, STATS, INSTREAM; no RELOAD, SHUTDOWN, SCAN, CONTSCAN
6. **No scan result details** — Only returns virus name; no file type, size, hash, or signature version info
7. **Timeout handling** — readClamdResponse races against timeout but doesn't cancel the read promise properly

## Documentation Improvements

No dedicated protocol documentation file found in `docs/protocols/`. Consider creating `docs/protocols/CLAMAV.md` with:

1. **All 4 endpoints documented** — `/ping`, `/version`, `/stats`, `/scan` with complete request/response schemas
2. **Command formats table** — Plain (\n), n-prefix (n...\n), z-prefix (z...\0)
3. **INSTREAM protocol** — Step-by-step: zINSTREAM\0 → chunks (4-byte BE length + data) → zero chunk → response
4. **Response formats** — PONG, version string (ClamAV X.Y.Z/DB/DATE), stats fields, scan results
5. **Stats field descriptions** — POOLS, THREADS (live/idle/max), QUEUE, MEMSTATS (heap/mmap/used/free)
6. **Scan responses** — "stream: OK", "stream: VIRUSNAME FOUND", "stream: ERROR ..."
7. **Known limitations** — List the 7 limitations above
8. **EICAR test file** — Example base64-encoded EICAR test virus for /scan endpoint testing
9. **curl examples** — 4 runnable commands for each endpoint

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ❌ No tests found
**Protocol Compliance:** ClamAV clamd protocol (text-based, port 3310)

## See Also

- [ClamAV Documentation](https://docs.clamav.net/) - Official ClamAV documentation
- [clamd Protocol](https://linux.die.net/man/8/clamd) - clamd manual page
- [EICAR Test File](https://www.eicar.org/?page_id=3950) - Standard antivirus test file
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
