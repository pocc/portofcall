# BitTorrent Review

**Protocol:** BitTorrent
**File:** `src/worker/bittorrent.ts`
**Reviewed:** 2026-02-18

## Summary

A generic 58-line protocol overview describing BitTorrent concepts (components, message types, DHT, piece selection, legal uses). Zero mention of the actual implementation, endpoints, request/response schemas, or wire details. Essentially a Wikipedia summary. Replaced with a comprehensive power-user reference covering all 4 endpoints. Key additions: 1. **Full endpoint reference table** — all 4 endpoints with transport type (TCP socket vs HTTP fetch), default ports (6881 vs 6969 split), default timeouts (10s vs 15s inconsistency), Cloudflare detection status.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Created `BencodeDict` class with hex-encoded keys to prevent UTF-8 corruption of binary SHA1 info_hash in scrape responses |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/BITTORRENT.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
