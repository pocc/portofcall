# ADB (Android Debug Bridge) Review

**Protocol:** ADB Smart Socket Protocol (client-to-server)
**File:** `src/worker/adb.ts`
**Reviewed:** 2026-02-19
**Specification:** Android Debug Bridge (ADB) Protocol Documentation
**Tests:** None

## Summary

ADB implementation provides 4 endpoints (command, version, devices, shell) supporting the ADB smart socket protocol on TCP port 5037. Handles text-based length-prefixed commands with OKAY/FAIL responses. The implementation correctly encodes commands with 4-byte lowercase hex length prefixes and parses server responses. No critical bugs found. The code is well-structured with proper timeout handling and Cloudflare detection.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 0 | None | No bugs found during review |

## Code Quality Observations

**Strengths:**
1. **Clear protocol documentation** — 41-line header comment explains protocol format, common commands, shell command flow, and use cases
2. **Proper length encoding** — Uses TextEncoder to get byte length, not character length, for accurate 4-byte hex prefix calculation
3. **Robust response parsing** — Handles OKAY/FAIL status with optional length-prefixed payloads or raw payloads
4. **Version decoding** — Parses hex version numbers (e.g., 0x0029 = 41) for human-readable output
5. **Shell command flow** — Implements proper two-step flow: host:transport selection, then shell command execution with buffered reads
6. **Cloudflare detection** — Integrated Cloudflare check in all 4 endpoints
7. **Timeout management** — Consistent timeout promise pattern across all endpoints (but see limitation below)

**Limitations:**
1. **No timeout cleanup** — Timeout promises created via setTimeout are never cleared, causing timers to run until expiration even after successful operations complete (minor resource leak)
2. **No shell output streaming** — Shell endpoint buffers entire stdout in memory; large outputs could cause memory pressure
3. **No test coverage** — No automated tests to verify protocol encoding, response parsing, or error handling
4. **Limited error context** — Socket close happens in catch blocks without preserving original error for debugging
5. **No device filtering** — devices endpoint cannot filter by state (offline, device, unauthorized) or serial number
6. **Hardcoded max bytes** — readAll() has 65536 byte limit with no configuration option

## Documentation Improvements

No dedicated protocol documentation file found in `docs/protocols/`. Consider creating `docs/protocols/ADB.md` with:

1. **All 4 endpoints documented** — `/command`, `/version`, `/devices`, `/shell` with complete request/response schemas
2. **Protocol format table** — Command encoding (4-byte hex length + payload), response formats (OKAY/FAIL)
3. **Common commands reference** — host:version, host:devices, host:devices-l, host:transport, shell:
4. **Shell command flow diagram** — Step-by-step: connect → transport → shell → read until close
5. **Known limitations** — List the 6 limitations above
6. **Device state values** — offline, device, unauthorized, recovery, bootloader
7. **Error responses** — Common FAIL messages and their meanings
8. **curl examples** — 4 runnable commands for each endpoint

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ❌ No tests found
**Protocol Compliance:** ADB Smart Socket Protocol (text-based, port 5037)

## See Also

- [ADB Protocol Specification](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/OVERVIEW.TXT) - Official ADB protocol overview
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
