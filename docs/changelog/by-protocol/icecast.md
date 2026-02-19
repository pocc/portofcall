# Icecast Review

**Protocol:** Icecast Streaming Server (HTTP)
**File:** `src/worker/icecast.ts`
**Reviewed:** 2026-02-19
**Specification:** [Icecast Documentation](https://icecast.org/docs/)
**Tests:** `tests/icecast.test.ts`

## Summary

Icecast implementation provides 3 endpoints (status, source, admin) supporting the HTTP-based streaming server API. Handles JSON status queries (mount point enumeration, listener counts), SOURCE protocol for stream mounting (ICY source authentication), and admin stats retrieval (Basic auth). Critical bugs fixed include source password exposure (logged in responses), authentication handling (OK2 vs HTTP response detection), and response timeout (infinite loop in source endpoint).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **PASSWORD EXPOSURE**: Source password returned in JSON response — removed password from success response |
| 2 | High | **INFINITE LOOP**: Source endpoint read loop can hang indefinitely waiting for \r\n\r\n — added explicit timeout with setTimeout |
| 3 | Medium | **SHOUTCAST COMPAT**: SHOUTcast v1 DNAS "OK2" response not properly detected — added startsWith('OK') check |
| 4 | Low | **CHUNKED ENCODING**: decodeChunked() doesn't validate chunk size bounds — should add max chunk size check |
| 5 | Low | **SERVER DETECTION**: Server header check case-sensitive — should use `.toLowerCase().includes('icecast')` |

## Documentation Improvements

**Created:** Comprehensive streaming protocol documentation

The implementation includes detailed documentation:

1. **All 3 endpoints documented** — `/status` (JSON status query), `/source` (stream mount), `/admin` (stats with auth) with complete HTTP request/response formats
2. **Status JSON parsing** — Mount point structure (name, listeners, peakListeners, genre, title, description, contentType, bitrate, samplerate, channels), server info (admin, host, location, serverId, serverStart)
3. **SOURCE protocol** — HTTP SOURCE method (non-standard), Basic auth (username="source", password=source_password), ice-* headers (ice-name, ice-description, ice-public), HTTP/1.0 (no chunked encoding), continuous stream format
4. **SHOUTcast compatibility** — DNAS v1 bare "OK2\r\n" response detection, HTTP/1.0 200 OK standard response, authentication failure detection (401/403/forbidden/unauthorized)
5. **Admin API** — /admin/stats endpoint, mount-specific stats (?mount=/mountpoint), Basic auth required, global server statistics
6. **Known limitations** — 7 documented limitations including:
   - No actual streaming (test burst only, 32-1024 bytes)
   - No metadata updates (no icy-metadata support)
   - No listener authentication
   - No mount point management (create/delete)
   - No relay configuration
   - Source mount test only (disconnects immediately)
   - Admin password sent in cleartext (no TLS)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ Tests present in `tests/icecast.test.ts`
**RFC Compliance:** Icecast HTTP API (proprietary)

## See Also

- [Icecast Documentation](https://icecast.org/docs/) - Official server documentation
- [SHOUTcast Server Protocol](http://wiki.winamp.com/wiki/SHOUTcast_DNAS_Server_2) - DNAS compatibility notes
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
