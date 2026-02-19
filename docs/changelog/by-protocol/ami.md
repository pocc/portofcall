# AMI (Asterisk Manager Interface) Review

**Protocol:** Asterisk Manager Interface (AMI)
**File:** `src/worker/ami.ts`
**Reviewed:** 2026-02-19
**Specification:** [Asterisk Manager Interface](https://docs.asterisk.org/Asterisk_18_Documentation/API_Documentation/AMI_Actions/)
**Tests:** None

## Summary

AMI implementation provides 7 endpoints (probe, command, originate, hangup, clicommand, sendtext) supporting the AMI text-based protocol on TCP port 5038. Implements buffered stream reading with proper banner/block parsing, safe action whitelist (33 read-only commands), and session management helper. Critical bug found: ActionID filtering logic accepts blocks without ActionID, potentially mismatching responses. Well-structured with comprehensive write action support.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESPONSE MISMATCH**: readBlockByActionID accepts blocks without ActionID field (line 219) — can return unsolicited events or mismatched responses when ActionID is missing. Should only accept blocks that match the requested ActionID exactly |
| 2 | Medium | **PARSE ERROR**: Banner reading consumes first \r\n but doesn't handle servers that send multiple \r\n after banner (line 168-174) — leftover \r\n characters may corrupt first block read |
| 3 | Low | **RESOURCE LEAK**: Timeout promises created in readUntil are never cleared (line 132-134) — timers run until expiration even after successful reads |

## Code Quality Observations

**Strengths:**
1. **Buffered stream reader** — AMIReader class maintains state across reads, preventing data loss when multiple messages arrive in single TCP segment
2. **Safe action whitelist** — 33 read-only actions in SAFE_ACTIONS set prevents destructive commands (Originate, Hangup excluded from /command endpoint)
3. **Session management helper** — withAMISession abstracts login/logout flow for write actions (4 endpoints reuse this)
4. **Protocol variants handled** — Supports actions with EventList:start → event stream → EventList:Complete pattern
5. **Comprehensive write support** — 4 write action endpoints (originate, hangup, clicommand, sendtext) with proper parameter validation
6. **Transcript tracking** — All command/originate/hangup/clicommand endpoints maintain full protocol transcript for debugging
7. **Special Command handling** — clicommand endpoint handles Asterisk's unique --END COMMAND-- sentinel terminator

**Limitations:**
1. **No ActionID validation** — Responses accepted without strict ActionID matching (bug #1)
2. **No test coverage** — No automated tests to verify action parsing, event handling, or whitelist enforcement
3. **No streaming events** — command endpoint stops after first event batch; doesn't support long-lived event streams
4. **Hardcoded limits** — Max 50 events per response, 200 max lines in readAllLines (no configuration)
5. **CLI output parsing** — clicommand uses heuristics for "Output:" vs raw lines; may fail on non-standard Asterisk versions
6. **No connection pooling** — Each request creates new TCP connection; high-frequency usage may exhaust ports
7. **Whitelist maintenance** — SAFE_ACTIONS requires manual updates when new AMI actions are added to Asterisk

## Documentation Improvements

No dedicated protocol documentation file found in `docs/protocols/`. Consider creating `docs/protocols/AMI.md` with:

1. **All 7 endpoints documented** — `/probe`, `/command`, `/originate`, `/hangup`, `/clicommand`, `/sendtext`, with request/response schemas
2. **Protocol format** — Key-value pairs, \r\n terminators, \r\n\r\n block delimiter
3. **Action/Response flow** — ActionID usage, Response: Success/Error, EventList patterns
4. **Safe actions list** — All 33 whitelisted read-only actions with descriptions
5. **Write actions table** — Originate, Hangup, Command, SendText with required parameters
6. **Event types** — Common events (FullyBooted, PeerStatus, Newchannel, Hangup)
7. **Command action details** — CLI command execution, --END COMMAND-- terminator, Output: prefix format
8. **Error responses** — Common failure messages and authentication errors
9. **Known limitations** — List the 7 limitations above
10. **curl examples** — 7 runnable commands for each endpoint

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ❌ No tests found
**Protocol Compliance:** Asterisk Manager Interface (text-based, port 5038)

## See Also

- [Asterisk AMI Actions](https://docs.asterisk.org/Asterisk_18_Documentation/API_Documentation/AMI_Actions/) - Official AMI action reference
- [Asterisk AMI Events](https://docs.asterisk.org/Asterisk_18_Documentation/API_Documentation/AMI_Events/) - Event documentation
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
