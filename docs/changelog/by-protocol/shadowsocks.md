---

## Shadowsocks Protocol

**File:** `src/worker/shadowsocks.ts`
**Reviewed:** 2026-02-18
**Documentation:** `docs/protocols/SHADOWSOCKS.md` (created)

### Bugs Found and Fixed

| # | Severity | Location | Bug | Fix |
|---|---|---|---|---|
| 1 | Medium | Lines 96-104, 126-129 | Memory leak — reader.releaseLock() not called on error paths — if Promise.race at line 101 throws (e.g., timeout during read), reader lock is never released; outer catch at 126 calls socket.close() but not reader.releaseLock() | Wrap reader.releaseLock() in try-catch within error handler; set reader to null after release; ensure finally-style cleanup |
| 2 | Low | Lines 81-83, 132 | Potential unhandled promise rejection in timeout — timeoutPromise creates rejected promise with setTimeout; if timeout fires after probe completes successfully, rejection is unhandled; race condition causes worker runtime warnings | Use clearTimeout() when probe completes successfully; track timeoutId and clear it before returning success |
| 3 | Medium | Lines 81-83, 87, 132, 139 | Socket not closed on timeout path — when timeout fires (line 132), timeoutPromise rejects; catch block at 139 returns 504 response but socket created at line 87 is never closed; leaves hanging connection | Track socket outside probePromise scope; ensure socket.close() is called in timeout error handler before returning 504 |
| 4 | Low | Lines 108-110 | Type assertion on bannerData without validation — code asserts `bannerData as Uint8Array` without checking type; if shortWait wins race, bannerData is undefined (line 97-98); while line 108 checks `bannerData && bannerData.length > 0`, type assertion happens at line 110 before proper instanceof check | Change line 108 to `const unexpectedBanner = bannerData && bannerData instanceof Uint8Array && bannerData.length > 0`; remove type assertion at line 110 (no longer needed) |

**Bug 1: Memory leak — reader not released on all error paths**

The reader lock acquired at line 96 is released at line 103 in the success path, but if the `Promise.race` at line 101 throws an error (e.g., timeout during read, or socket closed by remote), the lock is never released. The outer catch block at line 126 calls `socket.close()` but does not call `reader.releaseLock()`. This can cause resource exhaustion over time as reader locks accumulate. Fixed by wrapping `reader.releaseLock()` in a try-catch within the error handler, nulling reader after release, and ensuring cleanup happens on all paths.

**Bug 2: Potential unhandled promise rejection in timeout**

The `timeoutPromise` created at lines 81-83 uses `setTimeout` to reject a promise after the timeout period. If the probe completes successfully before the timeout, the setTimeout callback still fires and rejects the promise. Since the promise is no longer being awaited (the race was won by probePromise), this becomes an unhandled promise rejection. While not fatal, it causes warnings in the worker runtime and pollutes logs. Fixed by tracking the timeoutId and calling `clearTimeout(timeoutId)` when the probe completes successfully, preventing the rejection from ever occurring.

**Bug 3: Socket not closed on timeout path**

When the connection timeout fires (line 132, Promise.race won by timeoutPromise), the outer catch block at line 139 detects the "Connection timeout" error and returns HTTP 504. However, the socket created at line 87 inside probePromise is never closed. This leaves a hanging TCP connection that wastes worker resources and may trigger rate limits or connection pool exhaustion. Fixed by hoisting the socket declaration outside probePromise (let socket: ... | null = null) and ensuring the timeout error handler closes the socket before returning the 504 response.

**Bug 4: Type assertion on bannerData without proper validation**

At line 110, the code performs a type assertion `bannerData as Uint8Array` to call `Array.from()`. However, if the shortWait promise wins the race at line 101 (i.e., the server sends no data within 500ms), bannerData is `undefined` (from line 97: `value: undefined`). While line 108 checks `bannerData && bannerData.length > 0`, this check is insufficient because `undefined.length` would throw before the check even runs, and the type assertion assumes bannerData is always a Uint8Array when truthy. In practice, this works because the `&&` short-circuits, but it's fragile. Fixed by adding an `instanceof Uint8Array` check at line 108 and removing the type assertion at line 110, making the code type-safe and explicit.

### What doc improvements were made

Created `docs/protocols/SHADOWSOCKS.md` from scratch (734 lines). Contents:

1. **Protocol overview** — History (created 2012 by clowwindy for GFW circumvention), key characteristics (no plaintext handshake, encrypted from first byte, stateless), AEAD header format
2. **Detection difficulty explanation** — Why external probes cannot verify Shadowsocks without encryption key; server waits silently for encrypted data
3. **Implementation approach** — TCP connectivity probe only; measures RTT to socket.opened; waits 500ms for unsolicited banner; reports silent behavior as consistent with Shadowsocks
4. **API endpoint documentation** — POST /api/shadowsocks/probe with full request/response schemas; success (silent server), success (unexpected banner), timeout, Cloudflare-protected, connection failed, validation error cases; real JSON examples
5. **Common ports reference** — 8388 (default), 443 (blend with HTTPS), random high ports; note that any port can be used
6. **Use cases** — Infrastructure health checks, verify server before client setup, detect port conflicts; curl examples with jq
7. **Supported ciphers reference** — AEAD (aes-256-gcm, chacha20-ietf-poly1305, etc.) vs. deprecated stream ciphers (aes-cfb, rc4-md5); note to only use AEAD in production
8. **Protocol versions** — Shadowsocks AEAD (current, SIP004/SIP007 from 2017) vs. stream (legacy, vulnerable); comparison of implementations (libev, rust, go, windows)
9. **Limitations** — Cannot verify encryption, cannot test authentication, cannot distinguish from silent services, no TLS, no UDP, no plugin testing, Cloudflare-protected hosts rejected
10. **Cloudflare detection** — DoH-based IP check before connection; HTTP 403 with helpful error message if behind Cloudflare
11. **Security considerations** — Not a vulnerability scanner; does not exploit, brute-force, or intercept; server fingerprinting limited to TCP open + silence; rate limiting recommendations
12. **Direct Shadowsocks usage reference** — Server setup (shadowsocks-rust example), client setup (sslocal), browser/app configuration, JSON config file format
13. **Testing** — Docker one-liner for local shadowsocks-libev server; curl examples for testing via Port of Call; expected outputs for silent server and wrong port
14. **Resources** — Official GitHub org, shadowsocks-rust, SIP004/SIP007 specs, clients for Windows/macOS/Android, Outline, academic security research, alternative protocols (V2Ray, Trojan, Wireguard)
15. **Comparison table** — Shadowsocks vs. SOCKS5 across 8 dimensions (encryption, auth, detection resistance, performance, setup, censorship bypass, overhead, use case)
16. **Implementation notes** — Why TCP-only probe, why not implement full encryption, timeout behavior (10s connection + 500ms banner), error handling (HTTP status codes)
17. **Changelog** — 2026-02-18 initial implementation
18. **Future enhancements** — Explicit list of features NOT planned (full AEAD, SOCKS5 within stream, UDP relay, plugins, load balancing, bandwidth testing, etc.)
# Shadowsocks Bug Fixes

This file contains the corrected code for the 4 bugs found in `src/worker/shadowsocks.ts`.

## Summary of Changes

1. **Bug 1**: Added proper reader cleanup on error paths
2. **Bug 2**: Clear timeout when probe completes successfully
3. **Bug 3**: Track socket outside probePromise and close it on timeout
4. **Bug 4**: Use `instanceof Uint8Array` check instead of type assertion

## Corrected Code

Replace lines 81-132 in `src/worker/shadowsocks.ts` with:

```typescript
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout) as unknown as number;
    });

    let socket: ReturnType<typeof connect> | null = null;

    const probePromise = (async () => {
      const startTime = Date.now();
      socket = connect(`${host}:${port}`);

      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      try {
        await Promise.race([socket.opened, timeoutPromise]);
        const rtt = Date.now() - startTime;

        // Shadowsocks sends no banner — the server silently waits for encrypted data.
        // A successful TCP open is sufficient to confirm the port is reachable.
        // We wait briefly to see if the server sends anything unexpected (wrong service).
        reader = socket.readable.getReader();
        const shortWait = new Promise<{ value: undefined; done: true }>(resolve =>
          setTimeout(() => resolve({ value: undefined, done: true }), 500)
        );

        const { value: bannerData } = await Promise.race([reader.read(), shortWait]);

        reader.releaseLock();
        reader = null;
        await socket.close();
        socket = null;

        // Clear timeout since we completed successfully
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }

        // If the server sent data immediately, it's likely not Shadowsocks
        // (a Shadowsocks server stays silent until it receives the encrypted header)
        const unexpectedBanner = bannerData && bannerData instanceof Uint8Array && bannerData.length > 0;
        const bannerHex = unexpectedBanner
          ? Array.from(bannerData).map(b => b.toString(16).padStart(2, '0')).join('')
          : undefined;

        return {
          success: true,
          host,
          port,
          rtt,
          portOpen: true,
          silentOnConnect: !unexpectedBanner,
          isShadowsocks: !unexpectedBanner,
          bannerHex,
          note: unexpectedBanner
            ? `Port is open but server sent data (${bannerData.length} bytes) — likely not Shadowsocks`
            : 'Port is open and server is silent — consistent with Shadowsocks behavior',
        };
      } catch (error) {
        // Bug 1 fix: Ensure reader is released on error paths
        if (reader) {
          try {
            reader.releaseLock();
          } catch {
            // Reader may already be released or closed
          }
        }
        if (socket) {
          await socket.close();
        }
        throw error;
      }
    })();

    const result = await Promise.race([probePromise, timeoutPromise]);
```

Replace lines 138-148 in `src/worker/shadowsocks.ts` with:

```typescript
  } catch (error) {
    // Bug 3 fix: Close socket on timeout path
    if (socket) {
      await socket.close();
    }
    // Bug 2 fix: Clear timeout if it was set
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    if (error instanceof Error && error.message === 'Connection timeout') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Connection timeout',
        portOpen: false,
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
      portOpen: false,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
```

## Detailed Explanation

### Bug 1: Memory Leak - Reader Not Released

**Problem:**
```typescript
const reader = socket.readable.getReader();
// ...
const { value: bannerData } = await Promise.race([reader.read(), shortWait]);
reader.releaseLock();  // Only happens on success path
```

If the `Promise.race` throws (timeout, socket closed), `reader.releaseLock()` is never called.

**Fix:**
```typescript
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
try {
  reader = socket.readable.getReader();
  // ...
  reader.releaseLock();
  reader = null;
} catch (error) {
  if (reader) {
    try {
      reader.releaseLock();
    } catch {
      // Ignore if already released
    }
  }
  throw error;
}
```

### Bug 2: Unhandled Promise Rejection

**Problem:**
```typescript
const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('Connection timeout')), timeout)
);
```

If the probe completes before timeout, the setTimeout still fires and rejects the promise.

**Fix:**
```typescript
let timeoutId: number | undefined;
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout) as unknown as number;
});

// ... in success path:
if (timeoutId !== undefined) {
  clearTimeout(timeoutId);
  timeoutId = undefined;
}
```

### Bug 3: Socket Not Closed on Timeout

**Problem:**
```typescript
const probePromise = (async () => {
  const socket = connect(`${host}:${port}`);
  // ...
})();

const result = await Promise.race([probePromise, timeoutPromise]);
// If timeout wins, socket is never closed
```

**Fix:**
```typescript
let socket: ReturnType<typeof connect> | null = null;

const probePromise = (async () => {
  socket = connect(`${host}:${port}`);
  // ...
})();

// ... in catch block:
if (socket) {
  await socket.close();
}
```

### Bug 4: Type Assertion Without Validation

**Problem:**
```typescript
const unexpectedBanner = bannerData && bannerData.length > 0;
const bannerHex = unexpectedBanner
  ? Array.from(bannerData as Uint8Array).map(...)  // Type assertion assumes Uint8Array
  : undefined;
```

If `shortWait` wins, `bannerData` is `undefined`, not `Uint8Array`.

**Fix:**
```typescript
const unexpectedBanner = bannerData && bannerData instanceof Uint8Array && bannerData.length > 0;
const bannerHex = unexpectedBanner
  ? Array.from(bannerData).map(...)  // No type assertion needed
  : undefined;
```

## Testing the Fixes

After applying the fixes, test with:

```bash
# Test normal probe (should complete successfully)
curl -X POST http://localhost:8787/api/shadowsocks/probe \
  -H "Content-Type: application/json" \
  -d '{"host": "localhost", "port": 8388}'

# Test timeout (unreachable host)
curl -X POST http://localhost:8787/api/shadowsocks/probe \
  -H "Content-Type: application/json" \
  -d '{"host": "192.0.2.1", "port": 12345, "timeout": 2000}'

# Test unexpected banner (HTTP server)
curl -X POST http://localhost:8787/api/shadowsocks/probe \
  -H "Content-Type: application/json" \
  -d '{"host": "example.com", "port": 80}'
```

All three scenarios should complete without:
- Memory leaks (reader locks)
- Unhandled promise rejections (timeout cleanup)
- Hanging connections (socket cleanup)
- Type errors (instanceof check)

## Verification

To verify the fixes work correctly:

1. Run the worker with `wrangler dev`
2. Monitor for unhandled promise rejections in console
3. Run multiple rapid-fire requests to check for resource leaks
4. Test timeout path explicitly with unreachable hosts
5. Verify socket cleanup with `lsof` or similar tools (check for orphaned connections)
