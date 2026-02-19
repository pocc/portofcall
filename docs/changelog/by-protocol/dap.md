# DAP (Debug Adapter Protocol) Review

**Protocol:** Debug Adapter Protocol (DAP)
**File:** `src/worker/dap.ts`
**Reviewed:** 2026-02-19
**Specification:** [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/)
**Tests:** None

## Summary

DAP implementation provides 2 endpoints (health, tunnel) supporting the JSON-based Debug Adapter Protocol with Content-Length framing. Handles initialize request/response, bidirectional WebSocket tunnel with framing conversion, and multi-message TCP segments. Critical bug found: WebSocket tunnel doesn't acquire reader lock before read loop, causing potential lock errors. Well-structured with proper byte-level Content-Length parsing.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **LOCK ERROR**: WebSocket tunnel read loop doesn't acquire reader lock (line 346) — Creates reader inside async IIFE without ensuring socket is still valid. If socket closes between tunnel setup and IIFE execution, reader.read() will throw |
| 2 | Medium | **TYPE MISMATCH**: concatBytes function signature mismatch (line 138) — Second parameter accepts `Uint8Array<ArrayBufferLike>` but function creates new ArrayBuffer-backed result. Should accept same type as first parameter |
| 3 | Low | **RESOURCE LEAK**: Timeout promises never cleared in health endpoint — Timer runs until expiration even after successful reads |

## Code Quality Observations

**Strengths:**
1. **Proper Content-Length framing** — Correctly encodes/parses "Content-Length: N\r\n\r\n" + JSON body
2. **Byte-level parsing** — Uses Uint8Array and byte sequence search (HEADER_SEPARATOR) to handle multi-byte UTF-8 correctly
3. **Multi-message handling** — parseDAPMessages extracts multiple messages from single buffer, returns leftover bytes for next read
4. **Initialize request** — Sends complete initialize with 13 capability flags (clientID, linesStartAt1, pathFormat, etc.)
5. **WebSocket tunnel** — Bidirectional proxy: strips Content-Length for browser, adds framing for TCP socket
6. **Error propagation** — Tunnel sends error messages as JSON to WebSocket client before closing
7. **Comprehensive capabilities** — health endpoint returns full adapter capabilities from initialize response
8. **Event tracking** — Collects events (e.g., initialized) separately from responses

**Limitations:**
1. **Reader lock bug** — Critical issue in tunnel (bug #1)
2. **No test coverage** — No automated tests to verify framing, multi-message parsing, or tunnel operation
3. **No authentication** — Tunnel connects to any DAP server without credentials; assumes debugpy --listen 0.0.0.0
4. **No message validation** — Doesn't validate seq numbers or request_seq matching in responses
5. **Hardcoded initialize params** — Cannot customize clientID, adapterID, or capability flags per request
6. **No reconnection logic** — Tunnel closes on any error; client must reconnect manually
7. **No message size limits** — Content-Length can be arbitrarily large; no protection against OOM attacks
8. **No keepalive** — Long-idle tunnels may be closed by intermediate proxies

## Documentation Improvements

No dedicated protocol documentation file found in `docs/protocols/`. Consider creating `docs/protocols/DAP.md` with:

1. **All 2 endpoints documented** — `/health`, `/tunnel` with complete request/response schemas
2. **Message format** — Content-Length framing, JSON schema for request/response/event
3. **Initialize flow** — Step-by-step: initialize request → response (capabilities) → initialized event
4. **Message types** — request (command + arguments), response (success + body), event (event + body)
5. **Capability flags** — All 13 flags sent in initialize request with descriptions
6. **WebSocket tunnel protocol** — Client sends raw JSON, worker adds/removes Content-Length framing
7. **Common debug adapters** — debugpy (Python, port 5678), netcoredbg (.NET, 4711), delve (Go)
8. **Known limitations** — List the 8 limitations above
9. **curl examples** — 1 health check command, WebSocket client example for tunnel

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ❌ No tests found
**Protocol Compliance:** Debug Adapter Protocol (JSON + Content-Length framing)

## See Also

- [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/) - Official DAP specification
- [DAP Overview](https://microsoft.github.io/debug-adapter-protocol/overview) - Protocol overview and message flow
- [debugpy](https://github.com/microsoft/debugpy) - Python debug adapter
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
