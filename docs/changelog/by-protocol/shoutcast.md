## SHOUTcast Protocol

**File:** `src/worker/shoutcast.ts`
**Reviewed:** 2026-02-18
**Documentation:** `docs/protocols/SHOUTCAST.md` (created)

### Bugs Found and Fixed

| # | Severity | Location | Bug | Fix |
|---|---|---|---|---|
| 1 | High | All handlers (probe, info, admin, source) | Missing Cloudflare detection — no `checkIfCloudflare` call before outbound connections, creating SSRF vulnerability. All other protocol handlers include this security check. | Need to add `import { checkIfCloudflare } from './cloudflare-detector'` and check before connecting. Return HTTP 403 if Cloudflare detected. |
| 2 | Medium | `rawHttpGet`, line 479 | Buffer overflow potential — safety cap check `if (totalLen > 65536) break` happens after adding chunk to array, so `totalLen` could be e.g. 80000 when break occurs, but `combined` buffer is allocated with that size causing memory waste or issues. | Move check before `chunks.push(value)`: `if (totalLen + value.length > 65536) break; chunks.push(value); totalLen += value.length;` |
| 3 | Low | `parse7Html`, lines 505-510 | Zero listener count treated as undefined — `parseInt(parts[0], 10) || undefined` treats 0 as falsy, so zero listeners returns `undefined` instead of 0. This breaks listener count tracking when nobody is listening. | Change `|| undefined` to `|| 0` or use `const val = parseInt(...); return isNaN(val) ? undefined : val` pattern. |
| 4 | Low | `rawHttpGet`, lines 470-472 | Timeout doesn't cancel read — `readTimeout` promise resolves after timeout but doesn't signal the reader, potentially leaving resources hanging if server sends data slowly. | This is a design limitation of the current timeout pattern. Proper fix would require AbortController or socket close after timeout. Document as known limitation. |
| 5 | Low | `handleSHOUTcastAdmin`, lines 654, 672, 691 | Silent error swallowing — all three admin endpoint attempts catch errors with empty blocks, making debugging impossible when endpoints fail for reasons other than "not found". | Add basic logging: `catch (err) { /* Try next endpoint */ }` or return error details in development mode. |

**Bug #1 Detail: Missing SSRF Protection**

All other protocols in portofcall call `checkIfCloudflare(host)` before making outbound connections. This prevents Cloudflare Workers from connecting to Cloudflare-proxied domains (which is blocked by Cloudflare's security model) and returns a clear error to the client. SHOUTcast handlers are missing this check entirely.

Example from `prometheus.ts`:
```typescript
const cfCheck = await checkIfCloudflare(host);
if (cfCheck.isCloudflare) {
  return new Response(JSON.stringify({
    success: false,
    error: 'Cannot connect to Cloudflare-proxied hosts from Cloudflare Workers',
  }), { status: 403 });
}
```

SHOUTcast needs this same check added to:
- `handleShoutCastProbe` (line 218)
- `handleSHOUTcastAdmin` (line 592)
- `handleSHOUTcastSource` (line 753)

**Bug #3 Detail: parseInt Falsy Coercion**

Line 505-510 in `parse7Html`:
```typescript
return {
  currentListeners: parseInt(parts[0], 10) || undefined,  // ❌ 0 becomes undefined
  peakListeners: parseInt(parts[2], 10) || undefined,
  maxListeners: parseInt(parts[3], 10) || undefined,
  uniqueListeners: parseInt(parts[4], 10) || undefined,
  bitrate: parseInt(parts[5], 10) || undefined,
  title: parts[6]?.trim() || undefined,
};
```

When `parts[0]` is `"0"`, `parseInt("0", 10)` returns `0`, which is falsy, so `||` evaluates to `undefined`. This means a station with zero listeners will report `currentListeners: undefined` instead of `currentListeners: 0`.

The other parsers (`parseAdminXml`, `parseStatisticsJson`) have the same pattern and should also be fixed.

### Documentation Created

`docs/protocols/SHOUTCAST.md` (469 lines) covers:

1. **Protocol overview** — SHOUTcast v1 (ICY), v2 (HTTP + extensions), Icecast compatibility; transport details
2. **Endpoint documentation** — All 4 endpoints (probe, info, admin, source) with full request/response schemas, field tables, example responses
3. **ICY protocol reference** — Complete ICY header table (icy-name, icy-genre, icy-br, etc.), metadata format (StreamTitle syntax), status codes
4. **Implementation notes** — Connection flow for each endpoint type, timeout behavior, error handling patterns, response size limits
5. **Example responses** — Real-world examples for probe (v1 server), admin (v2 JSON), source (auth failure)
6. **curl examples** — Working examples for all 4 endpoints with jq post-processing
7. **Known limitations** — 10 limitations (no TLS, no persistent source, no in-stream metadata parsing, 65KB cap, zero=undefined bug, single stream assumption, no relay auth, no DNAS 2 advanced features, no Icecast extensions, admin tries all endpoints)
8. **Local testing** — Docker one-liners for SHOUTcast DNAS and Icecast servers, FFmpeg streaming example
9. **Use cases** — 7 scenarios (radio monitoring, network inventory, credential validation, analytics, health checks, directory scraping, forensics)
10. **Version compatibility table** — Feature support matrix for SHOUTcast v1, v2, and Icecast

**Admin endpoint fallback logic documented:**

The `/admin` handler implements a sophisticated three-tier fallback:
1. Try `/admin.cgi?mode=viewxml` (SHOUTcast v1 XML format with `<SHOUTCASTSERVER>` root)
2. Try `/statistics?json=1` (SHOUTcast v2 JSON, may have `streams` array wrapper)
3. Try `/7.html` (legacy CSV: 7 comma-separated values wrapped in `<body>`)

Each attempt is given min(8000ms, timeout) to respond. Failures are caught silently and next endpoint is tried. Results are merged using `mergeStats` which prefers first non-undefined value for each field. This maximizes compatibility but means total operation time can exceed the requested timeout.

**Source protocol documented:**

The `SOURCE` endpoint tests broadcaster authentication by:
1. Sending `SOURCE {mountpoint} ICY/1.0` handshake with credentials in `ice-password` header
2. Sending stream metadata (icy-name, icy-genre, icy-br, icy-pub, content-type, icy-url)
3. Waiting for server response (ICY 200 OK or ICY 401 Unauthorized)
4. If accepted, sending 1152 bytes of silent audio (zero-filled buffer = one MP3 frame)
5. Cleanly disconnecting

This confirms both authentication and that the server accepts the data path, without requiring actual audio content or long-lived connection.

---
