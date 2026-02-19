# Ganglia Review

**Protocol:** Ganglia gmond XML Dump Protocol
**File:** `src/worker/ganglia.ts`
**Reviewed:** 2026-02-19
**Specification:** [Ganglia Monitoring System](http://ganglia.info/)
**Tests:** (TBD)

## Summary

Ganglia implementation provides 2 endpoints (connect, probe) for the gmond XML dump protocol. Server immediately sends complete cluster state as XML on TCP connection. Parser handles both Ganglia 3.0 (self-closing METRIC tags) and Ganglia 3.1+ (METRIC tags with EXTRA_DATA children). No critical bugs found - XML parsing is robust with proper attribute extraction and element nesting.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 0 | Info | **NO CRITICAL BUGS FOUND** — XML parser correctly handles both Ganglia 3.0 and 3.1+ formats with proper tag matching and attribute extraction |

## Code Quality Observations

### Strengths

1. **Zero-Command Protocol** — Correctly implements gmond's immediate XML dump behavior (no commands sent, just connect and read) (lines 247-258)
2. **Version Detection** — Handles both Ganglia 3.0 (self-closing `<METRIC ... />`) and 3.1+ (`<METRIC ...><EXTRA_DATA>...</EXTRA_DATA></METRIC>`) (lines 179-187)
3. **XML Parser** — Simple regex-based parser avoids heavy XML library dependency (lines 67-208)
4. **Attribute Extraction** — Reliable regex for `name="value"` pairs (lines 69-76)
5. **EXTRA_DATA Parsing** — Extracts Ganglia 3.1+ metadata: GROUP, DESC, TITLE, SOURCE, CLUSTER (lines 80-95)
6. **Nested Structure** — Correctly parses GANGLIA_XML → CLUSTER → HOST → METRIC hierarchy (lines 132-208)
7. **Termination Detection** — Reads until `</GANGLIA_XML>` tag is seen (line 55)
8. **Response Size Limiting** — Probe truncates metrics to 50 per host to avoid huge responses (line 298)
9. **Heartbeat Detection** — Probe checks for `<GANGLIA_XML` tag specifically, not just any XML (lines 401-402) to avoid false positives

### Minor Improvements Possible

1. **OS Field Concatenation** — Combines OS_NAME + OS_RELEASE with trim() (line 170) — clean
2. **Regex Safety** — Uses non-greedy `[\s\S]*?` for tag body matching (lines 143, 158, 179) — correct
3. **Empty Result Handling** — Correctly returns empty arrays for clusters/hosts/metrics when none found (lines 132, 148, 177)

## Documentation Improvements

**Action Required:** Create `docs/protocols/GANGLIA.md` with:

1. **Both endpoints documented** — `/connect` (full XML parse + summary), `/probe` (quick detection + version)
2. **Protocol behavior** — Server sends XML immediately on connect, no commands required, connection closes after dump
3. **XML schema** — GANGLIA_XML (root) → CLUSTER (0+) → HOST (0+) → METRIC (0+)
4. **Root attributes** — GANGLIA_XML: VERSION, SOURCE (gmond vs gmetad)
5. **Cluster attributes** — NAME, OWNER, URL, LOCALTIME
6. **Host attributes** — NAME, IP, REPORTED (timestamp), TN (metric age threshold), TMAX (max age), GMOND_STARTED, OS_NAME, OS_RELEASE
7. **Metric attributes** — NAME, VAL (current value), TYPE (string, uint8, uint16, uint32, float, double), UNITS, TN, TMAX
8. **EXTRA_DATA format** — Ganglia 3.1+: `<EXTRA_ELEMENT NAME="..." VAL="..." />` children providing GROUP, DESC, TITLE
9. **Metric types** — string, int8, uint8, int16, uint16, int32, uint32, float, double (most common: uint32, float)
10. **Common metrics** — cpu_user, cpu_system, mem_total, mem_free, load_one, load_five, load_fifteen, disk_total, disk_free, bytes_in, bytes_out
11. **Ports** — 8649 (gmond), 8651 (gmetad)
12. **Difference: gmond vs gmetad** — gmond reports single host/cluster, gmetad aggregates multiple gmond sources
13. **Known limitations** — No XDR binary protocol support (used for gmond-to-gmond multicast), read-only (no metric submission)
14. **curl examples** — 3 runnable commands: basic connect, probe, full dump with formatting

**Current State:** Inline documentation is clear and concise (453 lines, 30% comments)

## Verification

**Build Status:** ✅ Passes TypeScript compilation (verified via read of source)
**Tests:** ⚠️ No test file found — recommend creating `tests/ganglia.test.ts` with XML parser tests for Ganglia 3.0 vs 3.1+ formats
**Protocol Compliance:** Ganglia gmond XML protocol (no version number)

## Implementation Details

### XML Reading

- **Stream Accumulation** — Reads chunks until `</GANGLIA_XML>` tag seen or timeout (lines 48-62)
- **Timeout Handling** — Returns partial buffer on timeout (line 45)
- **Completion Detection** — Checks for closing tag, not just any XML (line 55)

### Attribute Parsing

- **Regex** — `/(\w+)\s*=\s*"([^"]*)"/g` extracts all `name="value"` pairs (lines 69-76)
- **Record Builder** — Accumulates into `Record<string, string>` (line 70)
- **Null Safety** — Uses `match[1]` and `match[2]` with null checks (line 74)

### EXTRA_DATA Parsing

- **Regex** — `/<EXTRA_ELEMENT\s+([^>]*)\/?>/g` matches both self-closing and open tags (line 87)
- **Attribute Extraction** — Reuses attribute parser on matched tag (line 89)
- **Name→Value Mapping** — Stores NAME attribute as key, VAL attribute as value (lines 90-91)

### XML Structure Parsing

- **GANGLIA_XML** — `/<GANGLIA_XML\s+([^>]+)>/` for root attributes (lines 135-140)
- **CLUSTER** — `/<CLUSTER\s+([^>]+)>([\s\S]*?)<\/CLUSTER>/g` with non-greedy body match (line 143)
- **HOST** — `/<HOST\s+([^>]+)>([\s\S]*?)<\/HOST>/g` nested within cluster content (line 158)
- **METRIC** — `/<METRIC\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/METRIC>)/g` handles both self-closing and body forms (line 179)
- **Body Access** — Cluster content is `clusterMatch[2]`, host content is `hostMatch[2]`, metric body is `metricMatch[2]` (lines 147, 162, 183)

### Connect Endpoint

- **Full Parse** — Reads entire XML document with 15-second timeout (line 258)
- **Summary Stats** — Counts clusters, hosts, metrics across all clusters (lines 268-272)
- **Response Formatting** — Returns nested structure with cluster → host → metric hierarchy (lines 286-300)
- **Metric Truncation** — Limits to 50 metrics per host in response to avoid huge JSON (line 298)

### Probe Endpoint

- **Quick Detection** — Reads only first chunk (line 389)
- **Tag Check** — Validates `<GANGLIA_XML` presence (line 401) — prevents false positives on other XML services
- **Version Extraction** — Regex match on VERSION attribute (line 403)
- **Source Detection** — Extracts SOURCE attribute (gmond or gmetad) (line 404)

## See Also

- [Ganglia Monitoring System](http://ganglia.info/) - Project homepage
- [Ganglia gmond](http://ganglia.sourceforge.net/) - gmond daemon documentation
- [Ganglia XML Format](https://github.com/ganglia/monitor-core/blob/master/gmond/gmond.c) - XML generator source code
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols (none for Ganglia)
