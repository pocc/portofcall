# Remediation Report — 14th Pass Findings

**Date:** 2026-02-20
**Source:** Re-audit of [REMEDIATION_13TH_PASS.md](REMEDIATION_13TH_PASS.md) findings + regression scan
**Status:** All 5 findings remediated.

---

## Remediation Checklist

| # | Severity | Finding | Status | Files Changed |
|---|----------|---------|--------|---------------|
| 1 | HIGH | IPv6-mapped private IPs bypass `isBlockedHost()` | **FIXED** | `host-validator.ts` |
| 2 | MEDIUM | `handleSocketConnection` TCP open can block 101 upgrade | **FIXED** | `index.ts` |
| 3 | HIGH | SSH banner reader lock never released | **FIXED** | `ssh.ts` |
| 4 | MEDIUM | `pipeWebSocketToSocket` writer lock not released on close/error | **FIXED** | `index.ts` |
| 5 | MEDIUM | TCP ping RTT uses `Date.now()` instead of `performance.now()` | **FIXED** | `index.ts` |

---

## Finding 1: IPv6-Mapped Private IP Bypass (HIGH)

### Problem

The 13th pass added `isBlockedIPv6()` with hardcoded prefix checks for `::ffff:127`, `::ffff:10.`, and `::ffff:192.168`. This missed other IPv4-mapped forms:

- `::ffff:172.16.0.0/12` (RFC 1918)
- `::ffff:169.254.0.0/16` (link-local / cloud metadata)
- `::ffff:100.64.0.0/10` (CGN)
- `::ffff:192.0.0.0/29` (IANA special)
- `::ffff:0.0.0.0` and `::ffff:255.255.255.255`

An attacker could send `::ffff:169.254.169.254` to hit cloud metadata endpoints.

### What was done

Replaced the hardcoded `::ffff:` prefix checks with a regex extraction that delegates to the existing `isBlockedIPv4()` function. This ensures that every CIDR in `BLOCKED_IPV4_CIDRS` is also blocked in its IPv4-mapped IPv6 form:

```typescript
// IPv4-mapped IPv6 (::ffff:x.x.x.x) — extract the IPv4 part and validate
const v4MappedMatch = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
if (v4MappedMatch) {
  return isBlockedIPv4(v4MappedMatch[1]);
}
```

Adding a new CIDR to `BLOCKED_IPV4_CIDRS` now automatically covers the IPv4-mapped IPv6 form too.

---

## Finding 2: `handleSocketConnection` TCP Open Timeout (MEDIUM)

### Problem

`handleSocketConnection` calls `await socket.opened` before returning the 101 WebSocket upgrade response. If the target TCP server is slow or unresponsive, this blocks the upgrade handshake indefinitely. The 13th pass fixed the pipe-before-response deadlock but left the TCP open without a timeout.

### What was done

Added a 10-second timeout race around `socket.opened`:

```typescript
const socket = connect(`${host}:${port}`);
const openTimeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('TCP connect timeout')), 10000)
);
await Promise.race([socket.opened, openTimeout]);
```

On timeout, the `catch` block returns a 500 error response instead of deadlocking.

---

## Finding 3: SSH Banner Reader Lock Leak (HIGH)

### Problem

In `handleSSHConnect` (HTTP mode), a `getReader()` call acquired a lock on `socket.readable` but never called `releaseLock()`:

```typescript
// BEFORE:
const reader = socket.readable.getReader();
const { value } = await reader.read();
const banner = new TextDecoder().decode(value);
await socket.close();  // reader lock still held
```

On the Workers runtime, `socket.close()` with a held reader lock can throw or leave the stream in a broken state.

### What was done

Wrapped the read in a `try/finally` that releases the lock before socket close:

```typescript
const reader = socket.readable.getReader();
let banner = '';
try {
  const { value } = await reader.read();
  banner = new TextDecoder().decode(value);
} finally {
  try { reader.releaseLock(); } catch { /* already released */ }
}
await socket.close();
```

---

## Finding 4: `pipeWebSocketToSocket` Writer Lock on Close/Error (MEDIUM)

### Problem

The `close` and `error` WebSocket event listeners in `pipeWebSocketToSocket` called `writer.close()` but never explicitly called `writer.releaseLock()`. While `writer.close()` implicitly releases the lock on the Workers runtime, this is an implementation detail. If `close()` itself throws, the lock is leaked.

### What was done

Added explicit `releaseLock()` in `.finally()` chains on both listeners:

```typescript
ws.addEventListener('close', () => {
  writer.close().catch(() => {}).finally(() => {
    try { writer.releaseLock(); } catch { /* already released */ }
  });
  socket.close().catch(() => {});
});

ws.addEventListener('error', () => {
  writer.close().catch(() => {}).finally(() => {
    try { writer.releaseLock(); } catch { /* already released */ }
  });
  socket.close().catch(() => {});
});
```

---

## Finding 5: TCP Ping RTT Precision (MEDIUM)

### Problem

`handleTcpPing` used `Date.now()` for RTT measurement, which provides only millisecond resolution and is subject to system clock adjustments and Worker scheduling jitter.

The 13th pass acknowledged this but stated "`performance.now()` is not available in the Workers runtime." This is incorrect — `performance.now()` **is** available in the Cloudflare Workers runtime and provides sub-millisecond monotonic timing.

### What was done

Replaced `Date.now()` with `performance.now()`, rounding to 2 decimal places:

```typescript
const start = performance.now();
// ...
const rtt = Math.round((performance.now() - start) * 100) / 100;
```

**Note:** Reported RTT still includes ~0.5-5ms of Worker scheduling overhead on top of actual network latency. This is inherent to the execution model and is not a bug.

---

## Build Verification

```
npm run build — PASS (0 TypeScript errors, 0 warnings)
```

---

## Verification Plan (`wrangler dev`)

```bash
# SSRF — IPv4-mapped IPv6 bypass (should return 403)
curl -X POST http://localhost:8787/api/ping \
  -H 'Content-Type: application/json' \
  -d '{"host":"::ffff:169.254.169.254","port":80}'

curl -X POST http://localhost:8787/api/ping \
  -H 'Content-Type: application/json' \
  -d '{"host":"::ffff:172.16.0.1","port":80}'

curl -X POST http://localhost:8787/api/ping \
  -H 'Content-Type: application/json' \
  -d '{"host":"::ffff:100.64.0.1","port":80}'

# TCP connect timeout (should return error within ~10s, not hang)
wscat -c 'ws://localhost:8787/api/connect' \
  --header 'Content-Type: application/json' \
  -x '{"host":"192.0.2.1","port":9999}'

# RTT precision (rtt field should have decimal places)
curl -X POST http://localhost:8787/api/ping \
  -H 'Content-Type: application/json' \
  -d '{"host":"1.1.1.1","port":53}'

# SSH banner test (should succeed without reader lock error)
curl -X POST http://localhost:8787/api/ssh/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"github.com","port":22}'
```

---

## Summary of Files Changed

| File | Change |
|------|--------|
| `src/worker/host-validator.ts` | Replaced hardcoded `::ffff:` prefix checks with regex extraction + `isBlockedIPv4()` delegation |
| `src/worker/index.ts` | TCP connect timeout in `handleSocketConnection`; `writer.releaseLock()` in pipe close/error handlers; `performance.now()` in `handleTcpPing` |
| `src/worker/ssh.ts` | `reader.releaseLock()` in `finally` block for SSH banner read |

**Previous report:** [REMEDIATION_13TH_PASS.md](REMEDIATION_13TH_PASS.md)
