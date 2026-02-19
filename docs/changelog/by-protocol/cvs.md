# CVS pserver Review

**Protocol:** CVS pserver (Password Server)
**File:** `src/worker/cvs.ts`
**Reviewed:** 2026-02-19
**Specification:** CVS pserver protocol (documented in CVS manual)
**Tests:** None

## Summary

CVS pserver implementation provides 4 endpoints (connect, login, list, checkout) supporting the CVS password authentication protocol on TCP port 2401. Implements CVS password scrambling algorithm with full 128-byte lookup table, multi-step authentication flow, and protocol command sequences. Critical bugs found: Resource leaks from incomplete socket cleanup, race conditions in readLines timeout handling. Well-documented scrambling algorithm and protocol flow.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Socket cleanup in connect endpoint incomplete (lines 198-205) — writer.close(), reader.cancel(), socket.close() all called in finally but errors are silently ignored. Should await cleanup and log errors |
| 2 | Critical | **RACE CONDITION**: readLines timeout implementation incorrect (lines 86-91) — Promise.race between reader.read() and timeout resolve can cause reads to continue after timeout, potentially leaving data in stream |
| 3 | Medium | **INCOMPLETE CLEANUP**: Multiple endpoints use try-catch-finally with socket cleanup but don't await all cleanup promises sequentially (lines 444-446, 630-632) — socket.close() may execute before writer.close() completes |
| 4 | Low | **RESOURCE LEAK**: Timeout promises never cleared in readLines/readAllLines — timers run until expiration even after reads complete |

## Code Quality Observations

**Strengths:**
1. **Complete scrambling table** — Full 128-byte CVS_SCRAMBLE_TABLE with accurate mappings from CVS source (scramble.c)
2. **Password scrambling** — Correct implementation: 'A' prefix + character-by-character substitution through lookup table
3. **Multi-step auth flow** — Proper sequence: BEGIN AUTH REQUEST → cvsroot → username → scrambled password → END AUTH REQUEST → I LOVE YOU/I HATE YOU
4. **Post-auth protocol** — list/checkout send Root, Valid-responses, valid-requests, Directory, Argument, command
5. **Response parsing** — Extracts valid-requests list, server version from M lines, entry counts from Checked-in/Updated/Created
6. **Module expansion** — Handles Module-expansion responses for repository structure discovery
7. **Comprehensive endpoints** — 4 endpoints cover full workflow: probe → login → list modules → checkout
8. **Cloudflare detection** — Integrated in all endpoints
9. **Documentation** — 20-line header comment explains protocol flow and server responses

**Limitations:**
1. **Resource cleanup bugs** — Multiple critical issues with socket/stream cleanup (bugs #1-4)
2. **No test coverage** — No automated tests to verify scrambling algorithm, auth flow, or checkout parsing
3. **No write operations** — Only implements read-only operations (no commit, add, remove, update)
4. **No binary file support** — Assumes text responses; binary files in checkout would fail to decode
5. **Hardcoded limits** — readLines stops at 3 lines (line 101), readAllLines at 200 lines (line 232) with no configuration
6. **No streaming** — Checkout buffers entire response (up to 500 lines) in memory
7. **No cvsroot validation** — Accepts any string; doesn't validate format like :pserver:user@host:/path
8. **No encryption** — Password scrambling provides no security (substitution cipher); easily reversed

## Documentation Improvements

No dedicated protocol documentation file found in `docs/protocols/`. Consider creating `docs/protocols/CVS.md` with:

1. **All 4 endpoints documented** — `/connect`, `/login`, `/list`, `/checkout` with complete request/response schemas
2. **Protocol flow diagram** — Auth sequence, post-auth commands (Root, Valid-responses, etc.)
3. **Password scrambling** — Algorithm explanation, 'A' prefix, lookup table (reference only, don't publish table)
4. **Server responses** — I LOVE YOU (success), I HATE YOU (failure), Valid-requests format
5. **Command sequence** — Root, Valid-responses, valid-requests, Directory, Argument, co/rlog
6. **Response types** — ok, error, Checked-in, Updated, Created, Module-expansion, M (server message)
7. **Known limitations** — List the 8 limitations above
8. **Security warning** — Password scrambling is NOT encryption; use SSH for secure access
9. **curl examples** — 4 runnable commands for each endpoint

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ❌ No tests found
**Protocol Compliance:** CVS pserver protocol (text-based, port 2401)

## See Also

- [CVS Manual](https://www.gnu.org/software/trans-coord/manual/cvs/cvs.html) - Official CVS documentation
- [CVS pserver Protocol](https://www.gnu.org/software/trans-coord/manual/cvs/cvs.html#Password-authentication-server) - Password server protocol details
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
