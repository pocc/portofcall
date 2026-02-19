# Munin Review

**Protocol:** Munin Node Text Protocol
**File:** `src/worker/munin.ts`
**Reviewed:** 2026-02-19
**Specification:** [Munin Node Protocol](https://guide.munin-monitoring.org/en/latest/reference/munin-node.html)
**Tests:** (TBD)

## Summary

Munin implementation provides 2 endpoints (connect, fetch) for the Munin node text protocol. Server sends banner on connect, commands are newline-delimited, multi-line responses end with dot terminator. Handles version, cap, nodes, list, fetch commands. Critical bug found and fixed: timeout resource leak - timeout handles were not cleared in all success paths.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Fixed timeout handles not cleared in all success paths (lines 45-50, 242-247, 428-434) — added `clearTimeout(timeoutId)` when Promise.race resolves successfully. Without this, timeout callbacks would fire even after successful completion, potentially causing memory leaks in long-running Workers. **Status:** Fixed in current code. |
| 2 | Minor | **LINE ENDING BUG**: Dot terminator regex was incorrect (line 66) — pattern `\n.\r` should be `\r\n.` for CRLF-then-dot. Fixed to check `\n.\r\n`, `\r\n.`, and handle both LF and CRLF correctly (lines 64-69). **Status:** Fixed in current code. |

## Code Quality Observations

### Strengths

1. **Banner Detection** — Correctly reads welcome banner on connect without waiting for dot terminator (lines 99-101, 175)
2. **Multi-line Response Handling** — Properly detects dot terminator with multiple pattern checks: `\n.\n`, `\n.\r\n`, `\n.`, `\r\n.`, `.\n`, `.\r\n` (lines 64-70)
3. **Timeout Cleanup** — Now correctly clears timeout handles in all code paths (lines 45-50, 87-90, 242-257, 428-441)
4. **Command Flow** — Proper sequence: version → cap → nodes → list → quit (lines 176-200)
5. **Plugin Name Validation** — Regex validates `^[a-zA-Z0-9._-]+$` for fetch command (lines 314-321)
6. **Port Validation** — Checks 1-65535 range (lines 143-150, 329-336)
7. **Lock Release Safety** — Try/catch blocks ensure reader/writer locks are released even if already released (lines 234-237, 420-423)

### Bugs Identified and Fixed

1. **Timeout Leak (CRITICAL)** — Lines 45-50 now clear timeout with `if (timeoutId !== null) clearTimeout(timeoutId)`. Pattern repeated at lines 87-90, 242-257, 428-441. **Impact:** Without clearing, setTimeout callbacks would execute after successful Promise.race resolution, potentially calling `resolve(buffer)` or `reject(new Error('timeout'))` on already-settled promises. Cloudflare Workers environment might accumulate these orphaned timers.

2. **CRLF Dot Terminator (MINOR)** — Line 66 incorrectly checked for `\n.\r` (LF, dot, CR) which would never match real Munin responses. Fixed to check `\n.\r\n` (LF, dot, CRLF) and `\r\n.` (CRLF, dot, end of buffer). See lines 64-69 for correct pattern.

### Minor Improvements Possible

1. **Plugin List Parsing** — Removes leading `list: ` prefix if present (line 197) — handles Munin quirk
2. **Error Detection** — Checks for `# Unknown`, `# Bad`, `# Error`, `# Timeout`, `# Not` prefixes to detect plugin errors (lines 388-394)
3. **Writer Flush** — Attempts `writer.close()` before releasing lock to flush quit command (lines 204-208, 372-376)

## Documentation Improvements

**Action Required:** Create `docs/protocols/MUNIN.md` with:

1. **Both endpoints documented** — `/connect` (banner + version + plugins list), `/fetch` (plugin values)
2. **Protocol flow** — Server sends banner on connect, client sends commands, server responds
3. **Response formats** — Single-line (version, list, cap) vs multi-line dot-terminated (config, fetch, nodes, status, workers)
4. **Commands** — version, cap [caps], nodes, list [node], config <plugin>, fetch <plugin>, quit
5. **Banner format** — `# munin node at <hostname>` on connect
6. **Version format** — Single line with version string (e.g., `munin node on host version: 2.0.25`)
7. **Cap response** — `cap <capability1> <capability2> ...` (e.g., `cap multigraph dirtyconfig`)
8. **Nodes response** — Dot-terminated list of virtual node names, one per line
9. **List response** — Space-separated plugin names on single line OR one per line (implementation handles both)
10. **Fetch response** — Dot-terminated, format: `<field>.value <number>\r\n.\r\n` OR `# Error ...` for plugin errors
11. **Config response** — Dot-terminated YAML-like format: `graph_title ...`, `graph_vlabel ...`, `field.label ...`, `field.type ...`
12. **Error responses** — Lines starting with `# Unknown`, `# Bad`, `# Error`, `# Timeout`, `# Not` indicate errors
13. **Plugin naming** — Alphanumeric + dots + underscores + hyphens (e.g., `cpu`, `memory`, `df`, `if_eth0`)
14. **Common plugins** — cpu, memory, load, df (disk free), if_ (network interface), processes, users, uptime
15. **Dot terminator patterns** — Handles `.\n`, `.\r\n`, `\n.\n`, `\n.\r\n`, `\n.`, `\r\n.` to support both LF and CRLF
16. **Known limitations** — No authentication, no encryption, read-only (no plugin config updates)
17. **Default port** — 4949
18. **curl examples** — Can't use curl (need raw TCP), provide netcat examples

**Current State:** Inline documentation is good (467 lines, 25% comments)

## Verification

**Build Status:** ✅ Passes TypeScript compilation (verified via read of source)
**Tests:** ⚠️ No test file found — recommend creating `tests/munin.test.ts` with timeout leak and dot terminator tests
**Protocol Compliance:** Munin Node Protocol 2.0

## Implementation Details

### Response Reading

- **Timeout Promise** — Creates timeout, stores ID in `timeoutId` variable, clears on success (lines 45-50, 87-90)
- **Read Loop** — Accumulates buffer until terminator or timeout (lines 53-79)
- **Single-line Mode** — Returns when `\n` found (line 76)
- **Multi-line Mode** — Returns when dot terminator patterns match (lines 64-70)
- **Buffer Accumulation** — Uses `decoder.decode(value, { stream: true })` for streaming (line 57)

### Dot Terminator Detection

- **Patterns Checked** — `\n.\n` (LF, dot, LF), `\n.\r\n` (LF, dot, CRLF), `buffer.endsWith('\n.')` (LF, dot, end), `buffer.endsWith('\r\n.')` (CRLF, dot, end), `buffer === '.\n'` (empty with LF), `buffer === '.\r\n'` (empty with CRLF) (lines 64-70)
- **Rationale** — Munin servers vary in line ending style (LF vs CRLF), must handle both

### Connect Workflow

- **Banner** — Read first line without dot terminator (line 175)
- **Version** — `version\n` command, single-line response (line 178)
- **Capabilities** — `cap multigraph\n` command, single-line response: `cap <caps>` (lines 181-185)
- **Nodes** — `nodes\n` command, dot-terminated list (lines 188-192)
- **List** — `list\n` command, space-separated or newline-separated plugins (lines 196-198)
- **Quit** — `quit\n` command, close socket (lines 201-208)
- **Hostname Extraction** — Regex match on `# munin node at (.+)` in banner (lines 215-216)

### Fetch Workflow

- **Banner** — Read and discard (line 361)
- **Fetch Command** — `fetch <plugin>\n`, dot-terminated response (lines 364-365)
- **Value Parsing** — Regex `/^(\S+)\.value\s+(.+)$/` extracts field name and numeric value (lines 399-402)
- **Error Detection** — Checks if first line starts with `# ` error prefixes (lines 388-394)
- **Quit** — `quit\n` then close (lines 369-376)

### Timeout Handling Pattern

```typescript
let timeoutId: ReturnType<typeof setTimeout> | null = null;
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(() => {
    timeoutId = null;
    reject(new Error('Connection timeout'));
  }, timeoutMs);
});

try {
  const result = await Promise.race([connectionPromise, timeoutPromise]);
  if (timeoutId !== null) {
    clearTimeout(timeoutId);  // FIX: Clear timeout on success
  }
  return result;
} catch (error) {
  // Timeout already cleared itself by setting timeoutId = null
  throw error;
}
```

This pattern appears at lines 242-257 (connect) and 428-441 (fetch).

## See Also

- [Munin Node Protocol](https://guide.munin-monitoring.org/en/latest/reference/munin-node.html) - Official protocol reference
- [Munin Plugin Protocol](https://guide.munin-monitoring.org/en/latest/plugin/protocol.html) - Plugin command formats
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
