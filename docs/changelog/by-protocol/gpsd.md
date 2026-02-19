# GPSD Review

**Protocol:** GPS Service Daemon (gpsd)
**File:** `src/worker/gpsd.ts`
**Reviewed:** 2026-02-19
**Specification:** [gpsd Protocol](https://gpsd.gitlab.io/gpsd/gpsd_json.html)
**Tests:** Not yet implemented

## Summary

GPSD implementation provides GPS device query interface with 4 endpoints (version, devices, poll, watch, command). Protocol is JSON-based text over TCP port 2947 with commands prefixed by '?' and responses as newline-delimited JSON objects. Implements proper WATCH lifecycle (enable → collect → poll → disable) for fix data. Each JSON object has "class" field identifying message type (VERSION, DEVICES, TPV, SKY, POLL, etc.). Watch endpoint streams GPS data for configurable duration (1-30 seconds).

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | High | **POLL PROTOCOL**: Implements proper ?POLL sequence — enable WATCH, pause 1.2s for GPS fix cycle, poll, then disable WATCH |
| 2 | High | **LINE BUFFERING**: Proper newline-delimited JSON parsing with incremental buffer draining prevents partial JSON errors |
| 3 | Medium | **WATCH DURATION**: Clamped to 1-30 seconds to prevent abuse of long-running streaming connections |
| 4 | Medium | **TPV/SKY EXTRACTION**: POLL response embeds tpv/sky arrays — implementation extracts from nested structure correctly |
| 5 | Low | **COMMAND SAFETY**: Only allows commands starting with '?' to prevent write operations (safety guard) |

## Documentation Improvements

**Status:** No existing documentation found

Recommended documentation should include:

1. **Protocol Overview** — Text-based JSON over TCP port 2947, commands prefixed with '?', responses newline-delimited
2. **Key Commands** — ?VERSION (gpsd version), ?DEVICES (list GPS receivers), ?POLL (latest fix), ?WATCH (stream mode)
3. **JSON Classes** — VERSION (server info), DEVICES (device list), DEVICE (individual device), TPV (position/velocity), SKY (satellites), WATCH (mode ack), ERROR (errors)
4. **TPV Fields** — lat, lon, alt (altitude), speed, track (heading), time (ISO 8601), mode (1=no fix, 2=2D, 3=3D)
5. **SKY Fields** — satellites array with PRN (ID), az (azimuth), el (elevation), ss (signal strength), used (boolean)
6. **WATCH Protocol** — Must enable WATCH before ?POLL returns meaningful data — gpsd only reads GPS when watched
7. **Fix Cycle Timing** — GPS devices typically update every 1 second — implementation pauses 1.2s before polling
8. **POLL Response Structure** — Embeds tpv[] and sky[] arrays within POLL class object (not top-level)
9. **Use Cases** — NTP time sync (PPS), fleet tracking, maritime AIS+GPS, Raspberry Pi GPS HATs, vehicle telematics
10. **Common Deployments** — Linux USB GPS (u-blox, SiRF, MTK), NMEA 0183 serial devices, USB GPS dongles

## Code Quality Observations

**Strengths:**
- Proper WATCH enable/pause/poll/disable sequence for accurate GPS fix data
- Incremental line buffering with `drainBuffer()` handles streaming JSON cleanly
- Watch duration clamped to prevent long-running connection abuse
- POLL response correctly extracts embedded tpv/sky arrays
- Command safety check (must start with '?') prevents accidental write operations
- Fallback to standalone TPV/SKY objects if POLL embedding not used (backward compatibility)

**Concerns:**
- `readLines()` has nested try-catch with 500ms "extra read" timeout — complex control flow
- No validation that JSON "class" field exists before parsing
- `sendPollCommand()` 1.2-second pause is hardcoded — not configurable
- Watch handler uses `setTimeout()` in Promise constructor — could leak timers on error
- `parseLines()` silently discards invalid JSON — no error accumulation or logging
- No retry logic if server sends partial JSON then closes

## Known Limitations

1. **No Streaming API**: Watch endpoint collects messages then closes — no long-lived HTTP streaming (SSE/WebSocket)
2. **Buffer Size**: 65KB max per read call — extremely verbose JSON could exceed limit
3. **WATCH Timing**: 1.2-second pause hardcoded — too short for slow GPS receivers (cold start takes 30-60s)
4. **No PPS Support**: PPS (pulse-per-second) timing data not extracted or exposed
5. **No Device Selection**: Commands query all devices — no per-device filtering
6. **JSON Only**: No support for NMEA 0183 raw mode
7. **No AIS**: AIS (maritime vessel tracking) messages not parsed even though gpsd supports them
8. **Satellite Details**: SKY satellites array returned but not analyzed (e.g., no GPS vs GLONASS vs Galileo separation)
9. **No Configuration**: Cannot set baud rate, protocol, or device-specific options
10. **Watch Overlap**: Concurrent watch requests to same server could interfere with each other

## Verification

**Build Status:** Not verified — no test file exists
**Tests:** Not implemented
**RFC Compliance:** gpsd JSON protocol (no formal RFC)

## See Also

- [GPSD Protocol Specification](../protocols/GPSD.md) - Technical wire format reference (if exists)
- [gpsd JSON Protocol](https://gpsd.gitlab.io/gpsd/gpsd_json.html) - Official JSON protocol docs
- [gpsd Client HOWTO](https://gpsd.gitlab.io/gpsd/client-howto.html) - Client implementation guide
- [NMEA 0183](https://en.wikipedia.org/wiki/NMEA_0183) - GPS sentence format
- [NTP PPS](https://www.ntp.org/documentation/drivers/driver22/) - GPS/PPS time synchronization
