# Security & Reliability Review — 13th Pass

**Review Date:** 2026-02-20
**Scope:** WebSocket↔TCP handoff, socket lifecycle, SSRF surface, Cloudflare Sockets API usage
**Focus:** The four review dimensions: Socket/Stream Management, SSRF/Proxy Abuse, Protocol Integrity, Cloudflare Optimizations

---

## Executive Summary

This pass focused on the structural handoff between browser WebSocket connections and the `cloudflare:sockets` TCP API. The core tunnel primitives (`pipeWebSocketToSocket`, `pipeSocketToWebSocket`, `handleSocketConnection`, `handleTcpPing`) and 240+ protocol handlers were reviewed for socket leaks, SSRF exposure, protocol integrity, and Cloudflare-specific concerns.

**Findings: 5 issues (2 critical, 2 high, 1 medium)**

| # | Severity | Issue |
|---|----------|-------|
| 1 | **CRITICAL** | No private/internal IP validation — full SSRF surface |
| 2 | **CRITICAL** | `handleSocketConnection` awaits pipe functions that never resolve, Response never sent |
| 3 | **HIGH** | Socket leak in `handleTcpPing` on timeout path |
| 4 | **HIGH** | WebSocket tunnels: no `ctx.waitUntil()`, reader lock never released on error |
| 5 | **MEDIUM** | TCP ping RTT includes Worker execution overhead (Cloudflare guard, DNS) |

---

## 1. CRITICAL — No Private/Internal IP Validation (SSRF)

**Files:** All 240+ protocol handlers, `cloudflare-detector.ts`, `index.ts`

The only host validation is `checkIfCloudflare()`, which blocks Cloudflare-proxied IPs. There is **zero validation** against:

- **Loopback:** `127.0.0.0/8`, `::1`
- **RFC 1918 private ranges:** `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- **Link-local:** `169.254.0.0/16`, `fe80::/10`
- **Cloud metadata:** `169.254.169.254` (AWS/GCP/Azure instance metadata)
- **ULA (IPv6):** `fc00::/7`
- **Null/broadcast:** `0.0.0.0`, `255.255.255.255`

An attacker can use any of the 240+ protocol handlers (SSH, Redis, MySQL, PostgreSQL, Memcached, etc.) to probe internal services reachable from the Cloudflare Worker network. While Workers run in an isolated environment (not a traditional VPC), the `cloudflare:sockets` `connect()` API can still reach arbitrary public IPs and potentially internal Cloudflare infrastructure.

**Fix:** Add a centralized `isBlockedHost()` check at the router level, before any handler runs.

```typescript
// src/worker/host-validator.ts

const BLOCKED_IPV4_CIDRS = [
  { addr: 0x7F000000, mask: 0xFF000000 },  // 127.0.0.0/8
  { addr: 0x0A000000, mask: 0xFF000000 },  // 10.0.0.0/8
  { addr: 0xAC100000, mask: 0xFFF00000 },  // 172.16.0.0/12
  { addr: 0xC0A80000, mask: 0xFFFF0000 },  // 192.168.0.0/16
  { addr: 0xA9FE0000, mask: 0xFFFF0000 },  // 169.254.0.0/16
  { addr: 0x00000000, mask: 0xFFFFFFFF },  // 0.0.0.0/32
  { addr: 0xFFFFFFFF, mask: 0xFFFFFFFF },  // 255.255.255.255/32
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  return ((parseInt(parts[0]) << 24) >>> 0) +
         (parseInt(parts[1]) << 16) +
         (parseInt(parts[2]) << 8) +
         parseInt(parts[3]);
}

function isBlockedIPv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip) >>> 0;
  return BLOCKED_IPV4_CIDRS.some(({ addr, mask }) =>
    (ipInt & (mask >>> 0)) === (addr >>> 0)
  );
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return lower === '::1' ||
         lower.startsWith('fc') || lower.startsWith('fd') ||  // ULA fc00::/7
         lower.startsWith('fe80');                              // Link-local
}

/**
 * Returns true if the host is a private/internal IP that should be blocked.
 * Handles raw IPs only — hostname resolution should be validated separately.
 */
export function isBlockedHost(host: string): boolean {
  if (host.includes(':')) {
    return isBlockedIPv6(host);
  }
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return isBlockedIPv4(host);
  }
  // Hostname — check for known internal names
  const lower = host.toLowerCase();
  return lower === 'localhost' ||
         lower === 'metadata.google.internal' ||
         lower.endsWith('.internal') ||
         lower.endsWith('.local');
}
```

Then enforce in the router (`index.ts:548–555`), before any handler runs:

```typescript
// In the executeRequest function, after Cloudflare guard:
const body = await parseGuardBody(request);
const host = normalizeHost(url.searchParams.get('host') ?? url.searchParams.get('hostname'))
  ?? normalizeHost(body?.host)
  ?? normalizeHost(body?.hostname);

if (host && isBlockedHost(host)) {
  return new Response(JSON.stringify({
    success: false,
    error: `Connections to internal/private addresses are not allowed: ${host}`,
  }), { status: 403, headers: { 'Content-Type': 'application/json' } });
}
```

**Note:** This does not protect against DNS rebinding (hostname resolves to `127.0.0.1`). The `cloudflare:sockets` `connect()` API resolves hostnames internally, so there is no way to inspect the resolved IP before connecting. Consider also blocking known-internal hostnames and documenting this limitation.

---

## 2. CRITICAL — `handleSocketConnection` Deadlock: Response Never Sent

**File:** `src/worker/index.ts:4489–4531`

```typescript
async function handleSocketConnection(request: Request): Promise<Response> {
  // ...
  const socket = connect(`${host}:${port}`);

  // BUG: await Promise.all blocks FOREVER
  await Promise.all([
    pipeWebSocketToSocket(server, socket),   // Returns void (event listeners only)
    pipeSocketToWebSocket(socket, server),   // Returns Promise<void> (reader loop)
  ]);

  // This line is UNREACHABLE until the TCP socket closes
  return new Response(null, { status: 101, webSocket: client });
}
```

**Problem:** `pipeSocketToWebSocket` returns a `Promise<void>` that resolves only when the TCP socket's readable stream ends. But the `Response(null, { status: 101, webSocket: client })` must be returned *immediately* for the WebSocket upgrade to complete — the browser can't send messages until it receives the 101 response. This creates a deadlock:

1. Worker awaits the pipe functions to complete
2. Pipe functions can't complete because the WebSocket client hasn't connected yet
3. WebSocket client can't connect because the 101 response was never sent
4. TCP socket eventually times out → catch block returns a 500

`pipeWebSocketToSocket` returns `void` (resolves immediately since it only registers event listeners), so the `Promise.all` blocks on `pipeSocketToWebSocket` alone.

**Fix:**

```typescript
async function handleSocketConnection(request: Request): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  try {
    const { host, port } = await request.json<{ host: string; port: number }>();

    if (!host || !port) {
      return new Response('Missing host or port', { status: 400 });
    }

    if (isBlockedHost(host)) {
      return new Response(JSON.stringify({
        success: false,
        error: `Connections to internal/private addresses are not allowed`,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const socket = connect(`${host}:${port}`);
    await socket.opened;

    // Start piping AFTER returning the 101 — do NOT await
    pipeWebSocketToSocket(server, socket);
    pipeSocketToWebSocket(socket, server);

    return new Response(null, { status: 101, webSocket: client });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
```

**Note:** The SSH handler (`ssh.ts:209–210`) already does this correctly — it calls `pipeWebSocketToSocket` and `pipeSocketToWebSocket` without `await` before returning the 101 response. The telnet handler also does this correctly. Only `handleSocketConnection` in `index.ts` has the deadlock.

---

## 3. HIGH — Socket Leak in `handleTcpPing` on Timeout Path

**File:** `src/worker/index.ts:4427–4481`

```typescript
async function handleTcpPing(request: Request): Promise<Response> {
  try {
    // ...
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout)
    );

    await Promise.race([socket.opened, timeoutPromise]);
    //                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    // If timeoutPromise wins, socket is NEVER closed.
    // Execution jumps to the catch block, which does not reference `socket`.

    const rtt = Date.now() - start;
    await socket.close();  // Only reached on success
    // ...
  } catch (error) {
    // BUG: `socket` is not in scope here (declared inside try block)
    // Even if it were, socket.close() is not called
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'TCP Ping Failed',
    }), { status: 500, ... });
  }
}
```

**Impact:** On every timeout, a TCP socket is leaked. The `cloudflare:sockets` runtime will eventually GC it, but for high-frequency ping probes this creates unnecessary resource pressure.

**Fix:**

```typescript
async function handleTcpPing(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let socket: ReturnType<typeof connect> | null = null;

  try {
    const { host, port, timeout = 10000 } = await request.json<{
      host: string; port: number; timeout?: number;
    }>();

    if (!host || !port) {
      return new Response('Missing host or port', { status: 400 });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const start = Date.now();
    socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timeout after ${timeout}ms`)), timeout)
    );

    await Promise.race([socket.opened, timeoutPromise]);
    const rtt = Date.now() - start;

    await socket.close();
    socket = null;

    return new Response(JSON.stringify({
      success: true, host, port, rtt,
      message: `TCP Ping Success: ${rtt}ms`,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'TCP Ping Failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  } finally {
    if (socket) {
      await socket.close().catch(() => {});
    }
  }
}
```

---

## 4. HIGH — WebSocket Tunnels: No `ctx.waitUntil()`, Reader Lock Never Released

**Files:** `src/worker/index.ts:4536–4568` (core pipe functions), `ssh.ts:446–488`, `telnet.ts:227–355`, and 50+ WebSocket handler files

### 4a. `pipeSocketToWebSocket` never releases reader lock

```typescript
// index.ts:4555-4568, ssh.ts:470-488
async function pipeSocketToWebSocket(socket: Socket, ws: WebSocket): Promise<void> {
  const reader = socket.readable.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { ws.close(); break; }
      ws.send(value);
    }
  } catch (error) {
    console.error('Error reading from socket:', error);
    ws.close();
  }
  // BUG: reader.releaseLock() never called — not in finally, not on error path
}
```

When `ws.send(value)` throws (e.g., WebSocket already closed), the reader lock is held forever. While the socket will eventually be GC'd, explicit cleanup is better practice.

### 4b. `pipeWebSocketToSocket` never releases writer lock on error

```typescript
// index.ts:4536-4550, ssh.ts:446-465
function pipeWebSocketToSocket(ws: WebSocket, socket: Socket): void {
  const writer = socket.writable.getWriter();

  ws.addEventListener('message', async (event) => {
    try {
      // ... writer.write(...)
    } catch (error) {
      ws.close();
      // BUG: writer.releaseLock() not called
      // BUG: socket not closed
    }
  });

  ws.addEventListener('close', () => {
    writer.close().catch(() => {});
    // close() implicitly releases the lock, but socket.close() is never called
  });
  // BUG: No 'error' event listener on WebSocket
}
```

### 4c. No `ctx.waitUntil()` for tunnel lifecycle

**File:** `index.ts:4413–4414`

```typescript
if (isWebSocketUpgrade) {
  return executeRequest();  // Returns 101 immediately
}
```

When a WebSocket tunnel is established, the handler returns a 101 Response immediately and the pipe functions run as fire-and-forget async work. The `ExecutionContext` (`_ctx`) is never used to register background work via `ctx.waitUntil()`. On Cloudflare Workers, this means the runtime *may* terminate the Worker isolate before the tunnel cleanup completes, though in practice Workers keep isolates alive while WebSocket connections are active.

**Fix for all three (unified pipe functions):**

```typescript
function pipeWebSocketToSocket(ws: WebSocket, socket: Socket): void {
  const writer = socket.writable.getWriter();

  ws.addEventListener('message', async (event) => {
    try {
      if (typeof event.data === 'string') {
        await writer.write(new TextEncoder().encode(event.data));
      } else if (event.data instanceof ArrayBuffer) {
        await writer.write(new Uint8Array(event.data));
      }
    } catch {
      try { writer.releaseLock(); } catch { /* already released */ }
      try { await socket.close(); } catch { /* already closed */ }
      try { ws.close(); } catch { /* already closed */ }
    }
  });

  ws.addEventListener('close', () => {
    writer.close().catch(() => {});
    socket.close().catch(() => {});
  });

  ws.addEventListener('error', () => {
    writer.close().catch(() => {});
    socket.close().catch(() => {});
  });
}

async function pipeSocketToWebSocket(socket: Socket, ws: WebSocket): Promise<void> {
  const reader = socket.readable.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      ws.send(value);
    }
  } catch {
    // Socket read error or WebSocket send error
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
    try { ws.close(); } catch { /* already closed */ }
    try { await socket.close(); } catch { /* already closed */ }
  }
}
```

---

## 5. MEDIUM — TCP Ping RTT Includes Worker Overhead

**File:** `src/worker/index.ts:4452–4459`

```typescript
const start = Date.now();
const socket = connect(`${host}:${port}`);
// ...
await Promise.race([socket.opened, timeoutPromise]);
const rtt = Date.now() - start;
```

The timer starts *before* `connect()` is called. Since `connect()` is synchronous (returns a Socket handle immediately) and `socket.opened` resolves when the TCP handshake completes, the RTT should be reasonably accurate. However, the Cloudflare guard check (`checkIfCloudflare`) runs *before* `start` is set, which is correct.

The `Date.now()` approach is inherently coarse on Workers (1ms resolution, no `performance.now()`). This is a **minor accuracy issue**, not a bug. Documenting it for completeness.

**No code change needed** — but the API docs should note that RTT includes Worker-side scheduling jitter (~1–5ms).

---

## Verified Non-Issues

| Concern | Assessment |
|---------|------------|
| Smart Placement interference | The connection patterns (short-lived `connect()` calls) are compatible with Smart Placement. Workers that repeatedly connect to the same backend will be migrated closer. No interference detected. |
| Sub-request limits for tunnels | WebSocket tunnels don't consume sub-requests — only the initial `fetch` counts. `connect()` uses the Sockets API, which is separate from the HTTP sub-request quota. |
| Binary safety (SSH) | All WebSocket→TCP piping checks for both `string` and `ArrayBuffer` types. `Uint8Array` is used for binary data. No encoding corruption risk for SSH. |
| Timer tracking system | The `timerStore` / `AsyncLocalStorage` system (`index.ts:295–361`) correctly patches `setTimeout`/`clearTimeout` to track and clean up timers per-request. WebSocket upgrades intentionally bypass this (`index.ts:4413–4414`) since tunnels are long-lived. |
| `withRequestTimeoutCleanup` bypass for WebSocket | Correct behavior — WebSocket connections are long-lived and should not have their timers cleaned up on response return. |

---

## Priority Fix List

### P0 — Critical

1. **SSRF: Add private IP validation** — Create `host-validator.ts`, enforce at router level before any handler. Prevents probing internal services.
2. **`handleSocketConnection` deadlock** — Remove `await Promise.all(...)` before the 101 return. Match the pattern used in SSH/Telnet handlers.

### P1 — High

3. **`handleTcpPing` socket leak** — Move socket declaration before try, add finally block with `socket.close()`.
4. **Pipe function cleanup** — Add `reader.releaseLock()` in finally, `writer.releaseLock()` on error, `socket.close()` on all exit paths. Add WebSocket `error` event listener.

### P2 — Medium

5. **RTT documentation** — Note in API docs that `rtt` includes ~1–5ms Worker scheduling jitter.

---

## Metrics

| Category | Count |
|----------|-------|
| Critical | 2 |
| High | 2 |
| Medium | 1 |
| Verified non-issues | 5 |

**Previous report:** [PROTOCOL_REVIEW_12TH_PASS.md](PROTOCOL_REVIEW_12TH_PASS.md)
