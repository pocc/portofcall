# Apache Ignite Review

**Protocol:** Apache Ignite Thin Client Protocol
**File:** `src/worker/ignite.ts`
**Reviewed:** 2026-02-19
**Specification:** [Apache Ignite Thin Client Protocol](https://ignite.apache.org/docs/latest/thin-clients/binary-client-protocol)
**Tests:** `tests/ignite.test.ts`

## Summary

Apache Ignite implementation provides 6 endpoints (connect, probe, list-caches, cache-get, cache-put, cache-remove) supporting the binary thin client protocol over TCP. Handles handshake negotiation (version probing 1.0-1.7), typed value encoding (strings, null), cache ID hashing (Java String.hashCode), and request/response framing. Critical bugs fixed include cache ID calculation (integer overflow), response parsing (length validation), and error handling (status codes not checked before parsing payload).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **INTEGER OVERFLOW**: Cache ID calculation using `(31 * hash) + charCode` without forcing 32-bit — fixed with `Math.imul(31, hash)` and `| 0` operator |
| 2 | Critical | **RESPONSE VALIDATION**: Status code not checked before parsing payload — added explicit status === 0 check in all operations |
| 3 | High | **LENGTH VALIDATION**: Response length field not validated (can be negative or > 1MB) — added bounds check in `readResponse()` |
| 4 | Medium | **HANDSHAKE RETRY**: Failed handshake attempts reconnection with server-advertised version but throws away result — fallback logic incomplete |
| 5 | Low | **TYPE SAFETY**: Payload parsing uses magic offsets (4, 12, 14, 16) without named constants — should define protocol constants |

## Documentation Improvements

**Created:** Complete binary protocol specification and type encoding reference

The implementation includes extensive documentation:

1. **All 6 endpoints documented** — `/connect`, `/probe`, `/list-caches`, `/cache-get`, `/cache-put`, `/cache-remove` with complete binary packet layouts
2. **Handshake protocol** — Request format (length + major/minor/patch + client_code), success response (success=1 + node_uuid + features), failure response (success=0 + server_version + error_msg)
3. **Request/response framing** — Request (length + op_code + request_id + data), Response (length + request_id + status + data)
4. **Operation codes** — OP_CACHE_GET (1000), OP_CACHE_PUT (1001), OP_CACHE_REMOVE (1016), OP_CACHE_GET_NAMES (1050), OP_CACHE_GET_OR_CREATE_WITH_NAME (1052)
5. **Type encoding** — 11 type codes documented (byte=1, short=2, int=3, long=4, float=5, double=6, char=7, bool=8, String=9, null=101)
6. **String encoding** — Type code (1 byte = 9) + length (int32 LE) + UTF-8 bytes
7. **Cache ID hashing** — Java String.hashCode() algorithm: `hash = 31*hash + charCode` operating on UTF-16 code units
8. **UUID parsing** — Two 64-bit LE integers (MSB first) converted to canonical format with byte reversal
9. **Known limitations** — 9 documented limitations including:
   - Only string keys/values supported (no complex types)
   - No binary/boolean/numeric type support
   - Cache creation implicit (no explicit cache configuration)
   - No transaction support
   - No SQL query execution
   - No compute grid operations
   - Handshake fallback incomplete (throws on version mismatch)
   - No compression support
   - Authentication not implemented

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ✅ Tests present in `tests/ignite.test.ts`
**RFC Compliance:** Apache Ignite Thin Client Protocol

## See Also

- [Ignite Binary Client Protocol](https://ignite.apache.org/docs/latest/thin-clients/binary-client-protocol) - Official protocol specification
- [Ignite Thin Clients](https://ignite.apache.org/docs/latest/thin-clients/getting-started-thin-clients) - Client overview
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
