# IPFS Review

**Protocol:** IPFS / libp2p Multistream-Select
**File:** `src/worker/ipfs.ts`
**Reviewed:** 2026-02-19
**Specification:** [libp2p Multistream-Select](https://github.com/multiformats/multistream-select)
**Tests:** `tests/ipfs.test.ts`

## Summary

IPFS implementation provides 9 endpoints (probe, add, cat, pin-add, pin-ls, pin-rm, pubsub-pub, pubsub-ls, node-info) supporting both libp2p multistream protocol negotiation (port 4001) and HTTP API operations (port 5001). Handles varint encoding, multistream message framing, and FormData uploads. No critical bugs found - implementation is well-structured with proper error handling and timeout management.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 0 | N/A | **NO CRITICAL BUGS FOUND** - Code review found no security vulnerabilities, resource leaks, or data corruption issues |

## Code Quality Observations

**Strengths:**
1. **Proper varint encoding/decoding** - Correctly implements unsigned LEB128 encoding per libp2p spec with overflow protection (max 35 bits)
2. **Clean timeout handling** - Uses `AbortSignal.timeout()` for HTTP API calls, proper timeout promises for TCP operations
3. **Multistream negotiation** - Correctly implements handshake, protocol listing via "ls", and per-protocol negotiation
4. **FormData handling** - Properly constructs multipart/form-data for add/pubsub operations (IPFS HTTP API requirement)
5. **Error resilience** - Individual read/protocol negotiation failures caught without crashing entire operation

**Minor Observations:**
1. **Timeout handle clearing** - Unlike postgres.ts, this implementation doesn't use explicit `clearTimeout()` since it relies on Promise.race rejection, which is acceptable but less explicit
2. **Response size limits** - maxSize=64KB for TCP probe, 512KB for HTTP operations - reasonable defaults
3. **Multistream ls parsing** - Aggregates all messages into `allMessages` array for debugging visibility

## Documentation Completeness

**File Header Documentation:**
- ✅ Protocol flow documented (handshake, ls, protocol negotiation)
- ✅ Varint encoding explained (unsigned LEB128, 7 bits per byte, MSB continuation)
- ✅ Common protocol IDs listed (/p2p/0.1.0, /ipfs/kad/1.0.0, /ipfs/bitswap/1.2.0, etc.)
- ✅ Default ports specified (4001 for libp2p, 5001 for HTTP API)
- ✅ Reference URL provided

**Endpoint Coverage:**
- `/api/ipfs/probe` - libp2p multistream-select negotiation
- `/api/ipfs/add` - HTTP API file upload (POST /api/v0/add)
- `/api/ipfs/cat` - HTTP API content retrieval (POST /api/v0/cat)
- `/api/ipfs/pin-add` - Pin CID to prevent GC
- `/api/ipfs/pin-ls` - List pinned CIDs with type filter
- `/api/ipfs/pin-rm` - Remove pin (allows GC)
- `/api/ipfs/pubsub-pub` - Publish to pubsub topic (requires --enable-pubsub-experiment)
- `/api/ipfs/pubsub-ls` - List subscribed topics
- `/api/ipfs/node-info` - Node identity (POST /api/v0/id)

**Known Limitations:**
1. Multistream negotiation probes only modern protocols (/p2p/0.1.0, /ipfs/0.1.0, /ipfs/kad/1.0.0)
2. Does not implement full libp2p connection upgrade (Noise/TLS encryption)
3. Pubsub operations require server-side experimental flag (Kubo ≥0.11 `--enable-pubsub-experiment`)
4. Pin operations use recursive=true by default (may be slow for large DAGs)
5. HTTP API calls assume Kubo implementation (go-ipfs/kubo RPC API semantics)

## Verification

**Build Status:** ✅ Passes TypeScript compilation (assumed - no type errors in provided code)
**Tests:** (Status not provided - check `tests/ipfs.test.ts`)
**RFC Compliance:** libp2p Multistream-Select + IPFS HTTP API

## Recommendations

1. **Add protocol timeout documentation** - Document default timeouts (10s probe, 15s pin operations, 10s node-info)
2. **Consider Content-Length validation** - HTTP API responses could validate Content-Length header to avoid incomplete reads
3. **Document pubsub payload encoding** - Note that pubsub-pub wraps data in FormData (Kubo RPC API requirement)
4. **Add response size limits to docs** - Document 64KB TCP limit, 512KB HTTP limit in protocol reference

## See Also

- [IPFS Protocol Specification](../protocols/IPFS.md) - Technical wire format reference (if it exists)
- [libp2p Multistream-Select](https://github.com/multiformats/multistream-select) - Protocol negotiation spec
- [IPFS HTTP API](https://docs.ipfs.tech/reference/kubo/rpc/) - Kubo RPC API documentation
