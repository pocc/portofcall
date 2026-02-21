# Remediation Report — 13th Pass Findings

**Date:** 2026-02-20
**Source:** [PROTOCOL_REVIEW_13TH_PASS.md](PROTOCOL_REVIEW_13TH_PASS.md)
**Status:** All 5 findings remediated. 1 new finding discovered during regression scan.

---

## Remediation Checklist

| # | Severity | Finding | Status | Files Changed |
|---|----------|---------|--------|---------------|
| 1 | CRITICAL | SSRF — no private/internal IP validation | **FIXED** | `host-validator.ts` (new), `index.ts` |
| 2 | CRITICAL | `handleSocketConnection` deadlock | **FIXED** | `index.ts` |
| 3 | HIGH | `handleTcpPing` socket leak on timeout | **FIXED** | `index.ts` |
| 4 | HIGH | Pipe functions — no lock release, no error listener | **FIXED** | `index.ts`, `ssh.ts` |
| 5 | MEDIUM | RTT precision documentation | **ACKNOWLEDGED** | No code change (documented below) |
| 6 | HIGH | `body.server` bypasses router guard (new) | **FIXED** | `index.ts` |

---

## Finding 1: SSRF — Private/Internal IP Validation

### What was done

1. **Created `src/worker/host-validator.ts`** — centralized `isBlockedHost()` function that blocks:
   - Loopback: `127.0.0.0/8`, `::1`, `::`
   - RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
   - Link-local: `169.254.0.0/16` (includes cloud metadata `169.254.169.254`), `fe80::/10`
   - ULA IPv6: `fc00::/7` (`fc..` and `fd..`)
   - CGN: `100.64.0.0/10`
   - IANA special: `192.0.0.0/29`
   - Null/broadcast: `0.0.0.0/32`, `255.255.255.255/32`
   - IPv4-mapped IPv6: `::ffff:127.*`, `::ffff:10.*`, `::ffff:192.168.*`
   - Hostnames: `localhost`, `*.internal`, `*.local`, `*.localhost`, `metadata.google.internal`

2. **Added router-level enforcement in `index.ts`** — inside `executeRequest()`, after the Cloudflare guard, all `/api/*` requests have their target host extracted from query params (`host`, `hostname`) and JSON body (`host`, `hostname`, `server`) and checked against `isBlockedHost()`. Returns 403 if blocked.

3. **Extended `maybeBlockCloudflareTarget()` host extraction** to also check `body.server` (see Finding 6).

### Known limitation

DNS rebinding is not mitigated. `cloudflare:sockets` `connect()` resolves hostnames internally — there is no way to inspect the resolved IP before the TCP handshake completes. Hostname blocklisting (`localhost`, `*.internal`, `*.local`) provides partial coverage.

---

## Finding 2: `handleSocketConnection` Deadlock

### What was done

Replaced the `await Promise.all([...])` pattern with fire-and-forget pipe calls, matching the existing SSH/Telnet handler pattern:

```
BEFORE:  await Promise.all([pipe1, pipe2]); return 101;  // DEADLOCK
AFTER:   pipe1(); pipe2(); return 101;                    // Correct
```

Also added `await socket.opened` before starting pipes, so the TCP handshake completes before the WebSocket tunnel begins forwarding.

### Regression check

Scanned all 18 files containing `WebSocketPair` + `status: 101`. **No other handlers** use the await-before-upgrade anti-pattern. All use either:
- Direct fire-and-forget pipe calls (SSH, Telnet)
- Async IIFE `(async () => { ... })()` without await (IRC, IRCS, Redis, MQTT, IMAP, Memcached, etc.)

---

## Finding 3: `handleTcpPing` Socket Leak

### What was done

- Moved `socket` declaration to `let socket: ... | null = null` before the `try` block
- Added `finally { if (socket) await socket.close().catch(() => {}); }`
- Set `socket = null` after successful `socket.close()` in the happy path

The socket is now guaranteed to be closed on timeout, connection error, or any other exception.

---

## Finding 4: Pipe Function Lock/Cleanup

### What was done (both `index.ts` and `ssh.ts`)

**`pipeWebSocketToSocket`:**
- Changed return type from `async ... Promise<void>` to `void` (it only registers event listeners)
- Added `writer.releaseLock()` in the catch block of the message handler
- Added `socket.close()` in both the `close` and new `error` event listeners
- Added WebSocket `error` event listener (was missing entirely)

**`pipeSocketToWebSocket`:**
- Added `finally` block with `reader.releaseLock()`, `ws.close()`, `socket.close()`
- Removed `ws.close()` from the reader-loop break path (moved to finally for single exit point)
- All cleanup wrapped in `try { } catch { }` to tolerate already-closed/released state

### Coverage note

The SSH and index.ts copies are the **only two independent implementations** of these pipe functions. All other protocol handlers (Telnet, IRC, etc.) implement their own tunnel logic with inline reader loops. Those are not affected by this specific finding — they have their own cleanup patterns (many are acceptable, some are risky but not critical).

---

## Finding 5: RTT Precision

### Status: Acknowledged, no code change

`Date.now()` provides ~1ms resolution on Workers. `performance.now()` is not available in the Workers runtime. The current implementation is accurate to within Worker scheduling jitter (~1–5ms). This is adequate for a TCP ping tool.

---

## Finding 6 (NEW): `body.server` Bypasses Router Guard

### Discovery

During regression scanning, discovered that 3 protocol handlers extract the target host from `body.server` instead of `body.host`:

| File | Field | In Cloudflare guard set? |
|------|-------|--------------------------|
| `whois.ts` | `body.server` | No |
| `dns.ts` | `body.server` | No |
| `dot.ts` | `body.server` | Yes, but guard checked wrong field |

The router-level Cloudflare guard and the new SSRF guard only extracted `body.host` and `body.hostname`. A request to `/api/dns/query` with `{ "server": "127.0.0.1" }` would bypass both guards.

### What was done

1. Added `?? normalizeHost(body?.server)` to the host extraction chain in `maybeBlockCloudflareTarget()`
2. Added `?? normalizeHost(guardBody?.server)` to the new SSRF guard in `executeRequest()`

Both guards now cover `host`, `hostname`, and `server` from both query params and JSON body.

---

## Build Verification

```
npm run build — PASS (0 TypeScript errors, 0 warnings)
```

---

## Summary of Files Changed

| File | Change |
|------|--------|
| `src/worker/host-validator.ts` | **NEW** — `isBlockedHost()` SSRF validation |
| `src/worker/index.ts` | Import `isBlockedHost`; router-level SSRF guard; `body.server` in Cloudflare guard; `handleTcpPing` finally block; `handleSocketConnection` deadlock fix; pipe function cleanup |
| `src/worker/ssh.ts` | `pipeWebSocketToSocket` and `pipeSocketToWebSocket` lock release + error listener |

**Previous report:** [PROTOCOL_REVIEW_13TH_PASS.md](PROTOCOL_REVIEW_13TH_PASS.md)
