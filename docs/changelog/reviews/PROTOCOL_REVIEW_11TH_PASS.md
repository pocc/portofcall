# Protocol Review — 11th Pass
**Review Date:** 2026-02-20
**Scope:** 277 protocol implementations
**Focus:** Cloudflare Workers runtime compatibility — APIs that crash or misbehave in the Workers environment

---

## Executive Summary

The 11th pass focused exclusively on **Cloudflare Workers runtime compatibility**. The project has `nodejs_compat` enabled in wrangler.toml, which means `Buffer`, `node:crypto`, `node:async_hooks`, and other core Node.js APIs are available. This pass found **6 genuine issues** across two categories:

1. **`String.fromCharCode(...spread)` stack overflow** — 2 protocols pass potentially large arrays (>65K elements) as spread arguments, exceeding the JS engine's maximum function argument count and causing `RangeError`.

2. **`btoa()` DOMException on non-ASCII SASL credentials** — 4 protocol handlers pass raw strings containing non-Latin-1 characters to `btoa()`, which throws `DOMException`. The correct pattern (TextEncoder → loop → btoa) already exists in `managesieve.ts` but was not applied consistently.

Additionally, the 10th pass's YMSG "Buffer API" finding is reclassified — `Buffer` works with `nodejs_compat`, though the Uint8Array rewrite remains preferable.

---

## Important Context: `nodejs_compat` Flag

The project's `wrangler.toml` includes:
```toml
compatibility_flags = ["nodejs_compat"]
```

This enables Node.js compatibility in Workers, making the following APIs available:
- `Buffer` (global) — works for all Buffer operations
- `node:crypto` — `createHash`, `createHmac`, etc.
- `node:async_hooks` — `AsyncLocalStorage`
- `require()` — for bundled packages

**Files using these APIs that are NOT broken:**
- `oscar.ts`, `rip.ts`, `hsrp.ts`, `mdns.ts`, `ike.ts`, `turn.ts`, `l2tp.ts` — Buffer usage is valid
- `oscar.ts`, `msn.ts`, `rip.ts`, `snmp.ts` — `node:crypto` imports are valid
- `index.ts` — `AsyncLocalStorage` from `node:async_hooks` is valid
- `ssh2-impl.ts` — `require('bcrypt-pbkdf')` is bundled and works

---

## High-Severity Issues

### 1. NFS — `String.fromCharCode(...fileData)` Stack Overflow on Large Reads
**File:** `src/worker/nfs.ts:1144`

NFS READ responses can contain up to the requested read size (commonly 8KB–1MB). When the response is binary (non-UTF-8), the fallback `btoa(String.fromCharCode(...fileData))` spreads the entire array as function arguments. Arrays exceeding ~65,536 elements crash with `RangeError: Maximum call stack size exceeded`.

**Fix:** Use loop-based approach (already used correctly in `afp.ts:1308-1310`):
```typescript
let binaryStr = '';
for (let i = 0; i < fileData.length; i++) binaryStr += String.fromCharCode(fileData[i]);
dataStr = btoa(binaryStr);
```

---

### 2. ZooKeeper — `String.fromCharCode(...rawBytes)` Stack Overflow on Large Node Data
**File:** `src/worker/zookeeper.ts:592`

ZooKeeper node data can be up to 1MB (default `jute.maxbuffer` limit). When the node data is binary, `btoa(String.fromCharCode(...rawBytes))` will crash for nodes larger than ~65KB.

**Fix:** Same loop-based approach:
```typescript
let binaryStr = '';
for (let i = 0; i < rawBytes.length; i++) binaryStr += String.fromCharCode(rawBytes[i]);
nodeData = btoa(binaryStr);
```

---

## Medium-Severity Issues

### 3. XMPP — `btoa()` Fails on Non-ASCII SASL Credentials (2 locations)
**File:** `src/worker/xmpp.ts:614,762`

Two XMPP handlers use `btoa(\`\0${username}\0${password}\`)` for SASL PLAIN authentication. If username or password contains characters with code points > 255 (e.g., non-Latin scripts), `btoa()` throws `DOMException: The string to be encoded contains characters outside of the Latin1 range`.

The 10th pass fixed line 480 but missed these two identical patterns at lines 614 and 762.

**Fix:** Apply the same TextEncoder pattern from line 480:
```typescript
const saslBytes = new TextEncoder().encode(`\0${username}\0${password}`);
let saslBinary = '';
for (let i = 0; i < saslBytes.length; i++) saslBinary += String.fromCharCode(saslBytes[i]);
const authStr = btoa(saslBinary);
```

---

### 4. IRC — `btoa()` Fails on Non-ASCII SASL Credentials
**File:** `src/worker/irc.ts:587`

`btoa(\`${saslUsername}\0${saslUsername}\0${saslPassword}\`)` has the same non-ASCII issue as XMPP. SASL PLAIN (RFC 4616) supports UTF-8 identities.

**Fix:** Use TextEncoder → loop → btoa pattern.

---

### 5. IRCS — `btoa()` Fails on Non-ASCII SASL Credentials
**File:** `src/worker/ircs.ts:478`

Same pattern as IRC. `btoa(\`${saslUsername}\0${saslUsername}\0${saslPassword}\`)` will throw on non-ASCII credentials.

**Fix:** Use TextEncoder → loop → btoa pattern.

---

## Low-Severity Issues

### 6. Nomad — Stale Comment Claims `btoa()` Unavailable
**File:** `src/worker/nomad.ts:32`

Comment states "btoa() is not available in Workers runtime" — this is incorrect. `btoa()` is a standard Web API available in all Cloudflare Workers. The custom `base64Encode()` implementation works but is unnecessary. (The custom function does handle UTF-8 correctly via TextEncoder, which is actually the better pattern.)

**Fix:** Update comment to: `Base64 encode a string with proper UTF-8 support (btoa alone fails on non-ASCII).`

---

## Verified Non-Issues

### Files Using `nodejs_compat` APIs Correctly

| File(s) | API Used | Status |
|---|---|---|
| oscar.ts, rip.ts, hsrp.ts, mdns.ts, ike.ts, turn.ts, l2tp.ts | `Buffer` | Valid with `nodejs_compat` |
| oscar.ts, msn.ts, rip.ts, snmp.ts | `node:crypto` | Valid with `nodejs_compat` |
| index.ts | `node:async_hooks` | Valid with `nodejs_compat` |
| ssh2-impl.ts | `require('bcrypt-pbkdf')` | Bundled, works |

### Safe `String.fromCharCode(...spread)` Calls (Small Fixed-Size Data)

| File | Line | Data Size | Why Safe |
|---|---|---|---|
| cdp.ts | 498 | 16 bytes | WebSocket key |
| node-inspector.ts | 501 | 16 bytes | WebSocket key |
| node-inspector.ts | 588 | 20 bytes | SHA-1 hash |
| postgres.ts | 314 | ~32 bytes | SCRAM nonce |
| postgres.ts | 452, 487 | 32 bytes | SCRAM proof/signature |
| rethinkdb.ts | 225, 228 | 32 bytes | SCRAM proof/signature |
| jsonrpc.ts | 441 | 16 bytes | WebSocket key |
| cifs.ts | 1321 | ≤1024 bytes | Capped with `.slice(0, 1024)` |
| ssh2-impl.ts | 588, 989 | 32 bytes | Ed25519 key (fixed size) |

### Safe Loop-Based Approaches Already in Codebase

| File | Approach |
|---|---|
| afp.ts:1308 | `for (let i=0; i<data.length; i++) binary += String.fromCharCode(data[i])` |
| ftps.ts:672 | Same loop pattern |
| scp.ts:63-70 | Chunked approach (8KB chunks) |
| managesieve.ts:71-78 | TextEncoder + loop + btoa (correct for UTF-8) |
| rabbitmq.ts:35-41 | Same TextEncoder + loop pattern |
| coap.ts:853 | Fixed in 10th pass to use loop |

---

## Priority Fix List

### P0 — High Severity
1. **NFS** — Replace spread with loop in binary base64 encoding
2. **ZooKeeper** — Replace spread with loop in binary base64 encoding

### P1 — Medium Severity
3. **XMPP** — Fix `btoa()` for non-ASCII SASL at lines 614 and 762
4. **IRC** — Fix `btoa()` for non-ASCII SASL at line 587
5. **IRCS** — Fix `btoa()` for non-ASCII SASL at line 478

### P2 — Low Severity
6. **Nomad** — Update stale comment about btoa availability

---

## 10th Pass Reclassification

The 10th pass finding #1 (YMSG — "Node.js Buffer API Used in Workers Runtime") was technically **not a runtime error** since `nodejs_compat` enables `Buffer`. The rewrite to `Uint8Array` + `DataView` is still valid as best practice (reduces dependency on the compat layer), but the original code would have functioned correctly.

---

## Metrics

| Category | Count |
|---|---|
| High | 2 |
| Medium | 3 |
| Low | 1 |
| Verified non-issues | 20+ |

**Previous report:** [PROTOCOL_REVIEW_10TH_PASS.md](PROTOCOL_REVIEW_10TH_PASS.md)
