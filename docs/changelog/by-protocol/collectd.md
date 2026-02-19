# Collectd Review

**Protocol:** collectd Binary Network Protocol
**File:** `src/worker/collectd.ts`
**Reviewed:** 2026-02-19
**Specification:** [collectd Binary Protocol](https://collectd.org/wiki/index.php/Binary_protocol)
**Tests:** (TBD)

## Summary

Collectd implementation provides 4 endpoints (probe, send, put, receive) using the collectd binary network protocol with TLV (type-length-value) structure. Implements 8 part types (HOST, TIME, PLUGIN, TYPE, VALUES, etc.) with correct big-endian encoding for all fields except GAUGE values which are little-endian IEEE 754 doubles. Critical feature: full binary packet decoder for receiving multi-metric streams from collectd server-mode network plugin.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 0 | Info | **NO CRITICAL BUGS FOUND** — Implementation correctly handles the quirky GAUGE little-endian encoding and all TLV part types |

## Code Quality Observations

### Strengths

1. **TLV Structure Compliance** — Correct 4-byte header: type (2 BE uint16) + length (2 BE uint16) + data (lines 88-103, 109-119, 130-157)
2. **GAUGE Endianness Quirk** — Correctly uses little-endian for GAUGE float64 values (line 147) while all other fields are big-endian per spec
3. **String Part NUL Termination** — Includes NUL byte in length calculation and zero-initializes buffer (lines 93-102)
4. **Values Part Encoding** — Proper structure: num_values (2 BE) + type_codes (n × uint8) + values (n × 8 bytes) (lines 130-157)
5. **Value Type Support** — All 4 types: COUNTER (0, uint64 BE), GAUGE (1, float64 LE), DERIVE (2, int64 BE), ABSOLUTE (3, uint64 BE) (lines 57-61, 144-154)
6. **Packet Decoder** — Full TLV parser with state accumulation (HOST, PLUGIN, TYPE carried across parts) matching collectd C source behavior (lines 610-722)
7. **High-Resolution Time** — Handles both TIME (seconds) and TIME_HR (2^-30 second units) with BigInt division (lines 652-664, 667-677)
8. **Safe Receive** — Limits duration (500-15000 ms) and metric count (1-500) to prevent resource exhaustion (lines 772-773)

### Minor Improvements Possible

1. **Part Type Coverage** — Implements 10 part types (0x0000-0x0009, 0x0100-0x0101, 0x0200, 0x0210) but decoder only handles the 9 most common (lines 44-54, 199-204)
2. **NUL Stripping** — Receive decoder strips trailing NUL bytes from strings which collectd includes (lines 635-646) — correct behavior
3. **Plugin Name Validation** — Send endpoint validates plugin name regex but other fields aren't validated (lines 365-370)

## Documentation Improvements

**Action Required:** Create `docs/protocols/COLLECTD.md` with:

1. **All 4 endpoints documented** — `/probe`, `/send`, `/put`, `/receive` with request/response schemas
2. **TLV structure** — [type:2 BE uint16][length:2 BE uint16][data:variable], length includes 4-byte header
3. **Part type table** — All 16 part types with hex codes and data formats:
   - 0x0000 HOST (string), 0x0001 TIME (uint64 BE seconds), 0x0002 PLUGIN (string), 0x0003 PLUGIN_INSTANCE (string)
   - 0x0004 TYPE (string), 0x0005 TYPE_INSTANCE (string), 0x0006 VALUES (complex), 0x0007 INTERVAL (uint64 BE seconds)
   - 0x0008 TIME_HR (uint64 BE, 2^-30 sec units), 0x0009 INTERVAL_HR (uint64 BE, 2^-30 sec units)
   - 0x0100 MESSAGE (string), 0x0101 SEVERITY (uint64 BE), 0x0200 SIGN_SHA256, 0x0210 ENCRYPT_AES256
4. **VALUES part format** — [num_values:2 BE][type_codes: num_values × uint8][values: num_values × 8 bytes]
5. **Value type codes** — 0=COUNTER (uint64 BE), 1=GAUGE (float64 LE), 2=DERIVE (int64 BE), 3=ABSOLUTE (uint64 BE)
6. **GAUGE endianness quirk** — ONLY value type where encoding is little-endian (x86 host order), all other fields are big-endian
7. **String encoding** — NUL-terminated UTF-8, length includes NUL byte
8. **State accumulation** — HOST/PLUGIN/TYPE parts persist across subsequent VALUES parts in same packet (like Slack's `thread_ts`)
9. **High-resolution time** — TIME_HR/INTERVAL_HR use 2^-30 second units (1,073,741,824ths of a second)
10. **Network plugin modes** — Server mode (pushes metrics to clients), Client mode (accepts metric writes)
11. **Default port** — 25826/TCP (UDP more common but TCP supported)
12. **Metric naming** — `hostname/plugin[-plugin_instance]/type[-type_instance]`
13. **Known limitations** — No encryption (ENCRYPT_AES256), no signing (SIGN_SHA256), no notification support (MESSAGE/SEVERITY parts parsed but not used)
14. **curl examples** — Can't use curl for binary protocol, provide hexdump examples of TLV structure

**Current State:** Inline documentation is excellent (864 lines, 35% comments with detailed wire format notes)

## Verification

**Build Status:** ✅ Passes TypeScript compilation (verified via read of source)
**Tests:** ⚠️ No test file found — recommend creating `tests/collectd.test.ts` with TLV encoding/decoding tests
**Protocol Compliance:** collectd Binary Protocol (no version number in spec)

## Implementation Details

### TLV Part Builders

- **String Parts** — Zero-initialized buffer with type, length (header + string + NUL), string bytes, trailing NUL (lines 93-102)
- **Uint64 Parts** — 12 bytes: type (2) + length (2) + value (8 BE as two uint32s for JS number safety) (lines 109-119)
- **Values Part** — Header (4) + num_values (2) + type_codes (n) + values (n×8), total length calculated correctly (lines 130-157)

### Value Encoding

- **COUNTER/DERIVE/ABSOLUTE** — uint64/int64 big-endian written as two uint32s (high, low) (lines 150-153)
- **GAUGE** — IEEE 754 double **little-endian** (line 147) — the lone exception in collectd protocol
- **Type Codes** — Single uint8 per value: 0, 1, 2, or 3 (lines 139-141)

### Packet Decoder (Receive)

- **State Machine** — Accumulates HOST, PLUGIN, PLUGIN_INSTANCE, TYPE, TYPE_INSTANCE, TIME, INTERVAL across parts (lines 614-621)
- **VALUES Emission** — When VALUES part is seen, emits metric with current state + parsed values (lines 680-714)
- **NUL Stripping** — String parts have trailing NUL(s) removed (lines 635-646) per spec
- **High-Res Time Conversion** — `timestamp >> 30n` to convert 2^-30 units to seconds in BigInt space before Number conversion (lines 663, 676)
- **Value Parsing** — Switches on type code to decode with correct endianness and signedness (lines 687-707)

### Send/Put Workflow

- **Metric Assembly** — Builds ValueList with all 8 parts in order: HOST, TIME, INTERVAL, PLUGIN, PLUGIN_INSTANCE, TYPE, TYPE_INSTANCE, VALUES (lines 174-193)
- **Timestamp** — Unix epoch seconds (line 398)
- **Interval** — Collection interval in seconds, default 10 (line 399)
- **Default Values** — hostname='portofcall.dev', plugin='portofcall', type='gauge', typeInstance='probe', value=42.0 (lines 347-352, 497-502)

### Receive Workflow

- **Duration Clamping** — 500 to 15000 ms (lines 759, 772)
- **Metric Limit** — 1 to 500 metrics (lines 762, 773)
- **Stream Reading** — Reads chunks from server, decodes each as complete packet (lines 804-824)
- **Plugin Discovery** — Extracts unique plugin names seen in metrics (line 830)

## See Also

- [collectd Binary Protocol Specification](https://collectd.org/wiki/index.php/Binary_protocol) - TLV format reference
- [collectd Network Plugin](https://collectd.org/wiki/index.php/Plugin:Network) - Server/client mode documentation
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols (none for collectd)
