# DCE/RPC (MS-RPC Endpoint Mapper) Review

**Protocol:** DCE/RPC v5.0 / MS-RPC Endpoint Mapper
**File:** `src/worker/dcerpc.ts`
**Reviewed:** 2026-02-19
**Specification:** [DCE/RPC C706](https://pubs.opengroup.org/onlinepubs/9629399/), [MS-RPCE](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-rpce/)
**Tests:** None

## Summary

DCE/RPC implementation provides 3 endpoints (connect, epmenum, probe) supporting connection-oriented DCE/RPC v5.0 on TCP port 135. Implements Bind/Bind Ack PDU exchange, Endpoint Mapper enumeration (ept_lookup opnum 2), and 8 well-known Windows RPC interfaces. Critical bugs found: Endianness not respected in all parsing paths, EPM tower parsing can read out-of-bounds, UUID encoding uses hardcoded byte order. Well-structured with comprehensive NDR parsing and 17 EPM service name mappings.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **DATA CORRUPTION**: parseBindAck uses hardcoded little-endian reads (lines 334-335) but should respect data representation byte (pdu[4] & 0x10). Big-endian servers would return corrupted maxXmitFrag/maxRecvFrag/assocGroup values |
| 2 | Critical | **OUT-OF-BOUNDS READ**: parseTower floor iteration doesn't validate offset stays within data bounds (lines 642-688) — Can read past end of tower data if server sends malformed floor with incorrect lhs_len or rhs_len |
| 3 | Medium | **INCORRECT UUID ENCODING**: uuidToBytes hardcodes little-endian for first 3 fields (lines 112-119) but should use data representation from PDU context (not available in current function signature) |
| 4 | Medium | **INCOMPLETE VALIDATION**: parseEPMLookupResponse doesn't validate num_ents matches arraySize (line 752) — Uses Math.min to avoid crashes but doesn't report mismatch as error |
| 5 | Low | **RESOURCE LEAK**: Timeout promises never cleared in connect/epmenum/probe endpoints — Timers run until expiration even after socket closes |

## Code Quality Observations

**Strengths:**
1. **Complete PDU implementation** — Bind, Bind Ack, Bind Nak, Request, Response, Fault packet types
2. **Endianness detection** — parseBindNakReason and readPDU check data representation byte (pdu[4] & 0x10) for correct endianness
3. **8 well-known interfaces** — EPM, SAMR, LSARPC, SRVSVC, WKSSVC, NETLOGON, WINREG, SVCCTL with UUIDs and versions
4. **EPM enumeration** — Implements ept_lookup (opnum 2) with full NDR request encoding and response parsing
5. **Tower protocol parsing** — Decodes protocol floors: UUID (0x0D), TCP (0x07), UDP (0x08), IP (0x09), SMB (0x0F), NCALRPC (0x10)
6. **17 EPM service mappings** — Comprehensive UUID-to-service name lookup including EventLog, FRS, Task Scheduler, DFS, DNS
7. **NDR conformant/varying arrays** — Correctly parses annotation strings with max_count, offset, actual_count, data, padding
8. **Context handle** — Parses 20-byte entry_handle (4-byte attributes + 16-byte UUID) in ept_lookup response
9. **Comprehensive rejection reasons** — Maps Bind Nak (7 reasons) and Bind Ack result codes (3 types) to human-readable strings

**Limitations:**
1. **Endianness bugs** — Critical parsing errors (bugs #1, #3)
2. **No test coverage** — No automated tests to verify UUID encoding, PDU parsing, or tower decoding
3. **No write operations** — Only implements read-only operations (bind, ept_lookup); no ept_map, ept_unmap
4. **No RPC calls** — probe endpoint only binds; doesn't invoke interface methods (e.g., SAMR SamrConnect5)
5. **No authentication** — Doesn't support NTLM, Kerberos, or other RPC auth levels (always auth_level=0)
6. **Hardcoded max_ents** — ept_lookup requests 500 entries (line 586) with no configuration
7. **No paging support** — Doesn't use entry_handle to fetch additional entries beyond first response
8. **Tower parsing limits** — Stops at 10 floors (line 642) even if floorCount is higher
9. **No IPv6 support** — parseTower only extracts IPv4 addresses (4 bytes); doesn't handle protocol 0x1F (IPv6)

## Documentation Improvements

No dedicated protocol documentation file found in `docs/protocols/`. Consider creating `docs/protocols/DCERPC.md` with:

1. **All 3 endpoints documented** — `/connect`, `/epmenum`, `/probe` with complete request/response schemas
2. **PDU header format** — 16-byte header: version, ptype, flags, data_rep, frag_len, auth_len, call_id
3. **Bind PDU structure** — max_xmit, max_recv, assoc_group, context list, abstract syntax, transfer syntax
4. **Well-known interfaces** — All 8 interfaces with UUIDs, versions, and descriptions
5. **EPM service mappings** — All 17 UUID-to-service mappings
6. **Tower floor types** — Table of protocol IDs: 0x0D (UUID), 0x07 (TCP), 0x08 (UDP), 0x09 (IP), 0x0F (SMB), 0x10 (NCALRPC)
7. **NDR data representation** — Little-endian (0x10), big-endian (0x00), ASCII, IEEE float
8. **Bind Ack results** — 0=Acceptance, 1=User Rejection, 2=Provider Rejection with reason codes
9. **Bind Nak reasons** — 7 rejection reasons (congestion, protocol version, etc.)
10. **ept_lookup flow** — Request structure (inquiry_type, object, interface, entry_handle, max_ents), response parsing
11. **Known limitations** — List the 9 limitations above
12. **curl examples** — 3 runnable commands for each endpoint

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ❌ No tests found
**Protocol Compliance:** DCE/RPC v5.0 (C706), MS-RPC Extensions (MS-RPCE)

## See Also

- [DCE/RPC Specification (C706)](https://pubs.opengroup.org/onlinepubs/9629399/) - Official DCE/RPC standard
- [MS-RPCE](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-rpce/) - Microsoft RPC protocol extensions
- [MS-DTYP](https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-dtyp/) - Windows data types (GUID, FILETIME)
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
