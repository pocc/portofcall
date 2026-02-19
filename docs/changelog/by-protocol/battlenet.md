# Battle.net BNCS Review

**Protocol:** Battle.net Chat Server (BNCS) Protocol
**File:** `src/worker/battlenet.ts`
**Reviewed:** 2026-02-19
**Specification:** [BNETDocs](https://bnetdocs.org/)
**Tests:** None

## Summary

Battle.net implementation provides 3 endpoints (connect, authinfo, status) supporting the BNCS binary protocol on TCP port 6112. Handles message framing (0xFF header + little-endian length), SID_PING challenges, and SID_AUTH_INFO with logon type parsing. Critical bug found: multi-packet TCP segments not handled correctly — leftover bytes discarded when loop breaks. Well-documented with 10 classic Blizzard game products supported.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **DATA LOSS**: readBNCSPacket leftover bytes lost when loop breaks on invalid/unexpected packet (lines 243-248) — leftover data is calculated but returned as empty array, causing subsequent packets in same TCP segment to be ignored |
| 2 | Medium | **TYPE SAFETY**: Uint8Array type assertion missing ArrayBuffer (line 474) — leftover variable typed as `Uint8Array<ArrayBufferLike>` but should be `Uint8Array<ArrayBuffer>` to match readBNCSPacket return type |
| 3 | Low | **RESOURCE LEAK**: Timeout promises never cleared in connect/authinfo/status endpoints — timers run until expiration even after socket closes |

## Code Quality Observations

**Strengths:**
1. **Complete protocol framing** — Correctly encodes/parses 0xFF header, message ID, little-endian length, and payload
2. **Multi-packet handling** — readBNCSPacket carries leftover bytes between reads, handling TCP segments with multiple messages (but see bug #1)
3. **SID_PING response** — authinfo endpoint properly echoes server cookie when challenged mid-handshake
4. **Logon type decoding** — Parses SID_AUTH_INFO response with NLS version labels (Broken SHA-1, NLS v1, NLS v2)
5. **Product catalog** — 10 classic Blizzard games (DRTL, STAR, SEXP, D2DV, D2XP, WAR3, W3XP, etc.) with human-readable labels
6. **Realm status checker** — status endpoint checks all 4 official gateways (US East/West, Asia, Europe) in parallel
7. **FourCC encoding** — Proper little-endian DWORD encoding for platform/product IDs (IX86, STAR)
8. **MPQ filetime parsing** — Extracts FILETIME (8-byte Windows timestamp) from auth response
9. **Comprehensive documentation** — 37-line header comment with protocol details, message format, connection flow, gateway list

**Limitations:**
1. **Leftover byte loss** — Data loss bug (#1) causes multi-packet responses to fail
2. **No test coverage** — No automated tests to verify packet encoding, SID_PING handling, or authinfo parsing
3. **No full authentication** — authinfo stops after SID_AUTH_INFO; doesn't implement NLS/SRP auth or CD key hashing
4. **Limited message types** — Only handles SID_NULL, SID_PING, SID_AUTH_INFO; no support for game lists, chat, or friends
5. **No reconnection logic** — status endpoint doesn't retry failed realms
6. **Hardcoded timeout** — 4-iteration loop in authinfo with 5000ms reads (lines 475-519); no configuration
7. **No protocol version negotiation** — Always sends protocol ID 0x01 (Game); no support for BNFTP (0x02) or Chat (0x03) beyond validation

## Documentation Improvements

No dedicated protocol documentation file found in `docs/protocols/`. Consider creating `docs/protocols/BATTLENET.md` with:

1. **All 3 endpoints documented** — `/connect`, `/authinfo`, `/status` with complete request/response schemas
2. **Message format table** — 0xFF header, msgId, length (uint16 LE), payload structure
3. **Product ID list** — All 10 supported products with FourCC codes and version bytes
4. **SID message types** — SID_NULL (0x00), SID_PING (0x25), SID_AUTH_INFO (0x50) with wire formats
5. **Auth flow diagram** — Step-by-step: protocol selector → SID_AUTH_INFO → optional SID_PING → response parsing
6. **Logon types** — 0=Broken SHA-1, 1=NLS v1, 2=NLS v2 (table with descriptions)
7. **MPQ info structure** — Filetime (FILETIME 8 bytes), filename (SZSTRING), server info (SZSTRING)
8. **Gateway realms** — All 4 official servers with hosts/ports
9. **Known limitations** — List the 7 limitations above
10. **curl examples** — 3 runnable commands for each endpoint

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ❌ No tests found
**Protocol Compliance:** Battle.net Chat Server Protocol (binary, port 6112)

## See Also

- [BNETDocs](https://bnetdocs.org/) - Community-maintained Battle.net protocol documentation
- [SID_AUTH_INFO Packet](https://bnetdocs.org/packet/164/sid-auth-info) - Auth info packet specification
- [SID_PING Packet](https://bnetdocs.org/packet/268/sid-ping) - Ping packet specification
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
