# EPMD Review

**Protocol:** Erlang Port Mapper Daemon
**File:** `src/worker/epmd.ts`
**Reviewed:** 2026-02-19
**Specification:** [Erlang EPMD Protocol](https://www.erlang.org/doc/apps/erts/erl_dist_protocol.html#epmd-protocol)
**Tests:** Not yet implemented

## Summary

EPMD implementation provides Erlang node discovery for distributed Erlang/OTP systems (RabbitMQ, CouchDB, Elixir). Implements 2 endpoints (names, port) with binary TCP protocol on port 4369. Protocol uses 16-bit big-endian length prefix followed by tag byte and request data. Response parsing handles both NAMES_REQ (tag 110) and PORT_PLEASE2_REQ (tag 122) with proper binary data interpretation and unsigned integer handling.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **SIGNED INTEGER BUG**: Fixed EPMD port parsing to use unsigned right shift (`>>> 0`) preventing negative port numbers when data[0] >= 128 |
| 2 | Medium | **SAFETY LIMITS**: Added 65KB limit on NAMES response and 4KB limit on PORT response to prevent memory exhaustion |
| 3 | Medium | **CONNECTION HANDLING**: Server close exception caught gracefully in both handlers — empty response triggers descriptive error |
| 4 | Low | **RESPONSE VALIDATION**: PORT response validates tag byte is 119 before parsing to prevent incorrect data interpretation |
| 5 | Low | **INPUT VALIDATION**: Port range validation (1-65535) enforced in both handlers before connection attempt |

## Documentation Improvements

**Status:** No existing documentation found

Recommended documentation should include:

1. **Protocol Overview** — Binary TCP protocol on port 4369 with 16-bit big-endian length prefix
2. **Request Formats** — NAMES_REQ (tag 110, length 1) and PORT_PLEASE2_REQ (tag 122, length 1+name_length)
3. **Response Structures** — NAMES response (EPMDPort:32be + node list text), PORT2_RESP (tag 119, result byte, node details)
4. **Node Information** — name, port, node type (72='hidden', 77='normal'), protocol, version range
5. **Use Cases** — RabbitMQ cluster discovery, CouchDB node detection, Elixir/Phoenix distributed systems
6. **Error Handling** — Result byte 0=found, 1=not found in PORT response
7. **Common Ports** — Erlang distribution ports typically range 4370-4379
8. **Packet Boundary** — Server sends all data then closes connection (no persistent session)
9. **Node Name Format** — Short names (node@host) vs long names (node@fqdn)
10. **Security Note** — EPMD has no authentication — typically firewalled or bound to localhost

## Code Quality Observations

**Strengths:**
- Unsigned integer handling prevents negative port number bug
- Safety limits prevent memory exhaustion attacks
- Proper handling of server-initiated connection close
- Node type decoding (hidden/normal) for operational visibility
- Regex parsing of node list text is fault-tolerant
- Cloudflare check included in both handlers

**Concerns:**
- No timeout on individual read operations — only overall connection timeout
- Chunk accumulation uses array of Uint8Array — could be optimized with a ring buffer
- No validation of node name characters before sending PORT_PLEASE2_REQ
- Error response when chunks.length === 0 could be more specific (timeout vs close)
- No retry logic if server closes prematurely
- Response parsing uses brittle regex — malformed text could silently fail

## Known Limitations

1. **No Timeouts**: Individual read operations lack timeout — server stall could hang until global timeout
2. **Memory Allocation**: Pre-allocates combined buffer after collecting all chunks — inefficient for large responses
3. **No Streaming**: Must collect entire response before parsing — cannot process incrementally
4. **Text Parsing**: NAMES response parsing uses regex on free-form text — no structured format guarantee
5. **No Authentication**: EPMD protocol has no auth — relies on network-level security
6. **Single Query**: Each request opens/closes connection — no session reuse for multiple queries
7. **No Registration**: Only implements query operations (NAMES, PORT2) — no node registration (ALIVE2_REQ)
8. **Node Type Mapping**: Only decodes types 72/77 — other values show as "unknown(N)"
9. **Extra Field**: PORT response "extra" field parsed but not documented or interpreted
10. **No Validation**: Node name not validated against Erlang naming rules before querying

## Verification

**Build Status:** Not verified — no test file exists
**Tests:** Not implemented
**RFC Compliance:** Erlang EPMD protocol (no formal RFC)

## See Also

- [EPMD Protocol Specification](../protocols/EPMD.md) - Technical wire format reference (if exists)
- [Erlang Distribution Protocol](https://www.erlang.org/doc/apps/erts/erl_dist_protocol.html) - Official Erlang documentation
- [RabbitMQ Clustering](https://www.rabbitmq.com/clustering.html) - EPMD usage in RabbitMQ
- [CouchDB Clustering](https://docs.couchdb.org/en/stable/cluster/index.html) - EPMD usage in CouchDB
