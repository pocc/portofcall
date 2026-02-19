# Gadu-Gadu Review

**Protocol:** Gadu-Gadu (Polish IM)
**File:** `src/worker/gadugadu.ts`
**Reviewed:** 2026-02-19
**Specification:** [Gadu-Gadu Protocol](https://toxygen.net/libgadu/protocol/) (community documentation)
**Tests:** Not yet implemented

## Summary

Gadu-Gadu implementation provides Polish instant messenger protocol support with 3 endpoints (connect, send-message, contacts). Implements binary protocol with little-endian 32-bit type and length fields, two hash algorithms (GG32, SHA-1), and proper WELCOME/LOGIN/SEND_MSG/USERLIST packet handling. Session management extracted into reusable `openGGSession()` helper. Message sending does NOT include client-side timestamp — server handles timestamping per GG protocol.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **UIN VALIDATION**: Validates UIN is positive integer up to 2^32-1 preventing protocol errors from invalid user IDs |
| 2 | High | **RESOURCE CLEANUP**: All handlers properly release reader/writer locks and close sockets in try/finally blocks |
| 3 | Medium | **TIMEOUT HANDLING**: Sequence number generation uses `Date.now() & 0x7FFFFFFF` to ensure 31-bit positive values |
| 4 | Low | **CONTACT PARSING**: Tab-separated contact list parsing handles missing fields gracefully with fallback to empty strings |
| 5 | Low | **MESSAGE CLASS**: GG_SEND_MSG80 uses correct msgclass value 0x0004 for chat messages per protocol spec |

## Documentation Improvements

**Status:** No existing documentation found

Recommended documentation should include:

1. **Protocol Flow** — Connect → GG_WELCOME (seed) → GG_LOGIN80 (hashed password) → GG_LOGIN80_OK/FAILED
2. **Packet Format** — type:4LE | length:4LE | payload (little-endian 32-bit integers)
3. **Authentication** — GG32 (legacy proprietary hash) vs SHA-1 (modern, recommended)
4. **Packet Types** — 0x0001=WELCOME, 0x0031=LOGIN80, 0x0035=LOGIN80_OK, 0x0043=LOGIN80_FAILED, 0x002D=SEND_MSG80, 0x0016=USERLIST_REQUEST, 0x0041=USERLIST_REPLY
5. **UIN Format** — 32-bit unsigned integer user identifier (1 to 4294967295)
6. **Message Structure** — recipientUIN:4LE | seq:4LE | msgclass:4LE | offset_plain:4LE | offset_attrs:4LE | text\0
7. **Contact List** — Tab-separated records: uin\tvisible_name\tfirst_name\tlast_name\tphone\tgroup
8. **Timestamp Handling** — Client does NOT send timestamp in SEND_MSG80 — server adds timestamp to message
9. **Session Reuse** — `openGGSession()` helper for authentication, called by all command handlers
10. **Error Handling** — All handlers return JSON with success boolean and descriptive error messages

## Code Quality Observations

**Strengths:**
- Proper little-endian binary protocol implementation with DataView
- Reusable `openGGSession()` eliminates code duplication across handlers
- UIN validation prevents protocol-level errors
- Message sequence number generation ensures positive 31-bit values
- Contact list parsing robust to missing fields
- Cloudflare protection integrated in all handlers

**Concerns:**
- No timeout on individual packet reads — relies on global deadline promise
- `buildLoginPacket()` imported from `./protocols/gadugadu/utils` — external dependency
- GG_PACKET_TYPES imported from `./protocols/gadugadu/types` — magic numbers not defined inline
- Contact list assumes server-side storage — note warns it may be stored locally
- Send message ACK is optional (2-second timeout) — caller doesn't know if message truly delivered
- No support for rich text attributes (offset_attrs always 0)

## Known Limitations

1. **No Streaming**: Messages collected entirely before processing — cannot handle incremental data
2. **Single Message**: Send message sends one message per connection — no batch support
3. **Contact Storage**: Contact list may be stored locally on client, not server — GG_USERLIST_REPLY could be empty
4. **No Rich Text**: Message attributes (bold, color, etc.) not supported — plain text only
5. **Timestamp Client**: Client cannot specify message timestamp — server assigns timestamp
6. **No Presence**: No presence subscription (online/offline/away status) implemented
7. **No File Transfer**: GG_SEND_FILE/GG_GET_FILE not implemented
8. **Hash Algorithm**: GG32 hash algorithm likely proprietary — SHA-1 recommended but also legacy
9. **No TLS**: Protocol runs over plain TCP (port 8074) — no encryption unless tunneled
10. **Session Per Command**: Each command opens new session — no persistent connection reuse

## Verification

**Build Status:** Not verified — no test file exists
**Tests:** Not implemented
**RFC Compliance:** No formal RFC — community-documented protocol

## See Also

- [Gadu-Gadu Protocol Specification](../protocols/GADUGADU.md) - Technical wire format reference (if exists)
- [libgadu Protocol Docs](https://toxygen.net/libgadu/protocol/) - Community protocol documentation
- [Gadu-Gadu History](https://en.wikipedia.org/wiki/Gadu-Gadu) - Polish instant messenger history
- [GG Packet Types](./protocols/gadugadu/types.ts) - Packet type constants (if exists)
