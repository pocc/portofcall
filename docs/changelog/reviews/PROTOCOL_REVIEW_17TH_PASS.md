# Remediation Report — 16th Pass Findings

**Date:** 2026-02-20
**Source:** Verification audit of [PROTOCOL_REVIEW_16TH_PASS.md](PROTOCOL_REVIEW_16TH_PASS.md) remediations
**Status:** All 3 findings remediated. 1 new finding identified and fixed (LOW).

---

## Remediation Checklist

| # | Severity | Finding | Status | Lines |
|---|----------|---------|--------|-------|
| 1 | HIGH | Unbounded `ws.send()` queue — no backpressure | **FIXED** | `index.ts:4628-4663` |
| 2 | MEDIUM | No chunking for payloads exceeding WebSocket message limit | **FIXED** | `index.ts:4647-4654` |
| 3 | LOW | `pipeWebSocketToSocket` message handler concurrency hazard | **FIXED** | `index.ts:4579-4614` |
| 4 | PASS | SSH banner reader lock in `finally` block | **VERIFIED** | `ssh.ts:113-118` |
| 5 | PASS | RTT uses `performance.now()` with 2-decimal rounding | **VERIFIED** | `index.ts:4479-4486` |
| 6 | LOW | `writeChain` close handler has no `.catch()` — unhandled rejection on torn-down writer | **FIXED** | `index.ts:4599-4607` |

---

## Finding 1: Backpressure — VERIFIED CORRECT

### What was checked

Line-by-line audit of `pipeSocketToWebSocket` at `index.ts:4628-4663`.

### Verification

| Requirement | Status | Evidence |
|-------------|--------|----------|
| `bufferedAmount` checked before each `reader.read()` | PASS | `while (ws.bufferedAmount > HIGH_WATER_MARK)` at line 4637, positioned **before** `reader.read()` at line 4641 |
| High-water mark is 1 MiB | PASS | `const HIGH_WATER_MARK = 1024 * 1024` at line 4630 |
| Loop yields via `setTimeout` when buffer full | PASS | `await new Promise((r) => setTimeout(r, DRAIN_INTERVAL_MS))` at line 4638 |
| Drain interval is 50ms | PASS | `const DRAIN_INTERVAL_MS = 50` at line 4632 |
| Reader lock released in all exit paths | PASS | `finally` block at line 4658 |

### Flow analysis

```
reader.read() returns 64KB chunk
  → ws.bufferedAmount checked (< 1 MiB? continue; >= 1 MiB? yield 50ms)
    → ws.send(chunk)
      → loop back to bufferedAmount check
```

When backpressure engages:
1. The `while` loop at line 4637 blocks the outer `while(true)` loop
2. No further `reader.read()` calls are made
3. TCP receive buffer fills → kernel stops ACK-ing → sender's TCP window closes
4. When `bufferedAmount` drops below 1 MiB, the next `reader.read()` pulls buffered data
5. TCP window reopens, backend resumes sending

**OOM scenario is mitigated.** A 100MB/s backend streaming to a 1MB/s client will hold steady at ~1 MiB of Worker memory (the high-water mark) instead of growing unbounded. The TCP flow control loop is correct.

---

## Finding 2: Chunking Guard — VERIFIED CORRECT

### What was checked

Chunking logic at `index.ts:4647-4654`.

### Verification

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Max message constant is 1 MiB | PASS | `const WS_MAX_MESSAGE = 1024 * 1024` at line 4631 |
| Check before `ws.send()` | PASS | `if (value.length > WS_MAX_MESSAGE)` at line 4648 |
| Splits via `subarray()` (zero-copy) | PASS | `value.subarray(i, Math.min(...))` at line 4650 |
| Last chunk is correctly bounded | PASS | `Math.min(i + WS_MAX_MESSAGE, value.length)` prevents overrun |
| Fast path for normal-sized chunks | PASS | `else { ws.send(value) }` at line 4653 avoids unnecessary branching |

### Edge case analysis

| Input size | Chunks sent | Correct? |
|------------|-------------|----------|
| 0 bytes | `done: true` at line 4643, no send | Yes — EOF |
| 64 KB (typical) | 1 chunk via fast path | Yes |
| 1,048,576 bytes (exactly 1 MiB) | 1 chunk via fast path (`>` not `>=`) | Yes |
| 1,048,577 bytes (1 MiB + 1) | 2 chunks: 1 MiB + 1 byte | Yes |
| 5 MiB | 5 chunks: 4x 1 MiB + 1x remainder | Yes |

The `>` comparison (not `>=`) is correct — a payload of exactly 1 MiB is within the platform limit and doesn't need splitting.

---

## Finding 3: Write Serialization — VERIFIED CORRECT

### What was checked

`pipeWebSocketToSocket` at `index.ts:4579-4614`.

### Verification

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Handler is synchronous (not `async`) | PASS | `ws.addEventListener('message', (event) => {` at line 4583 — no `async` keyword |
| Writes chained via promise queue | PASS | `writeChain = writeChain.then(async () => { ... })` at line 4584 |
| `close` handler waits for drain | PASS | `writeChain.then(() => { writer.close()... })` at line 4600 |
| `error` handler does **not** wait | PASS | Direct `writer.close()` at line 4609 — immediate teardown |
| Error cleanup releases writer lock | PASS | `try { writer.releaseLock(); } catch {}` in both message (line 4592) and close/error handlers |

### Ordering guarantee proof

```
Message A arrives → writeChain = Promise.resolve().then(() => write(A))
Message B arrives → writeChain = [write(A)].then(() => write(B))
Message C arrives → writeChain = [write(A) → write(B)].then(() => write(C))
Close event      → writeChain.then(() => writer.close())
```

Each `.then()` only executes after the previous link resolves. `writer.write()` is awaited inside each link. Ordering is structurally guaranteed regardless of V8 event loop behavior.

### Close-after-drain correctness

The close handler at line 4599-4605 chains off `writeChain`, ensuring all queued writes complete before `writer.close()` is called. This prevents data truncation when the browser closes the WebSocket immediately after sending a burst of messages.

---

## Finding 4: SSH Banner Reader Lock — RE-VERIFIED

`ssh.ts:111-118`:

```typescript
const reader = socket.readable.getReader();  // line 111
let banner = '';
try {
  const { value } = await reader.read();     // line 114 — can throw
  banner = new TextDecoder().decode(value);   // line 115
} finally {
  try { reader.releaseLock(); } catch { /* already released */ }  // line 117
}
```

`releaseLock()` is in `finally` — executes on both success and `reader.read()` failure. Inner `try/catch` handles the edge case where the runtime already released the lock on stream error. Correct.

---

## Finding 5: RTT Precision — RE-VERIFIED

`index.ts:4479-4486`:

```typescript
const start = performance.now();                                    // line 4479
socket = connect(`${host}:${port}`);                                // line 4480
// ...
await Promise.race([socket.opened, timeoutPromise]);                // line 4485
const rtt = Math.round((performance.now() - start) * 100) / 100;   // line 4486
```

| Requirement | Status |
|-------------|--------|
| Uses `performance.now()` (not `Date.now()`) | PASS |
| Monotonic (not subject to clock adjustment) | PASS |
| Rounded to 2 decimal places | PASS — `* 100 / 100` pattern |

---

## Finding 6: `writeChain.then()` Missing `.catch()` (LOW)

### Location

`index.ts:4599-4607` — `close` event handler in `pipeWebSocketToSocket`

### The Problem

The original close handler used `.then()` without a rejection handler:

```typescript
// BEFORE:
ws.addEventListener('close', () => {
  writeChain.then(() => {        // ← no .catch() / rejection handler
    writer.close().catch(...)
    socket.close().catch(...)
  });
});
```

If `writeChain` is in a rejected state when the `close` event fires, the `.then()` callback is never entered, and `writer.close()` / `socket.close()` are never called. The TCP socket and writer lock would leak until the Worker isolate is evicted.

**Risk was theoretical** — the inner `try/catch` in the message handler prevents `writeChain` from rejecting in practice. However, the code didn't structurally prevent it, and a future refactor could introduce a rejection path.

### What was done

Replaced the `.then()` with a two-argument form using a shared `cleanup` function that runs on both fulfillment and rejection:

```typescript
// AFTER (index.ts:4599-4607):
ws.addEventListener('close', () => {
  const cleanup = () => {
    writer.close().catch(() => {}).finally(() => {
      try { writer.releaseLock(); } catch { /* already released */ }
    });
    socket.close().catch(() => {});
  };
  writeChain.then(cleanup, cleanup);
});
```

This is more concise than a `.then().catch()` chain with duplicated cleanup logic, and structurally guarantees cleanup runs regardless of `writeChain` state. The `cleanup` function is defined inline so it closes over `writer` and `socket` without additional allocations.

---

## Scaling Analysis (Post-Remediation)

### Memory Budget per Connection

| Component | Bytes | Notes |
|-----------|-------|-------|
| `ReadableStreamDefaultReader` | ~256 | Reader object + internal state |
| `WritableStreamDefaultWriter` | ~256 | Writer object + internal state |
| `writeChain` promise chain | ~64-512 | Depends on queue depth; typically 1 link |
| TCP read buffer (in-flight) | ~65,536 | One `reader.read()` result, kernel-sized |
| `ws.bufferedAmount` (capped) | <= 1,048,576 | Backpressure engages at 1 MiB |
| Event listener closures | ~1,024 | 3 listeners x ~340 bytes each |
| **Total per connection** | **~1.1 MiB** | Worst case (backpressure active) |
| **Total per connection** | **~67 KB** | Typical (interactive, no backpressure) |

### Concurrency Estimates (128 MiB Isolate)

| Workload | Memory/conn | Max concurrent |
|----------|-------------|----------------|
| Bulk transfer (backpressure active) | ~1.1 MiB | ~116 |
| Interactive SSH/Redis (no backpressure) | ~67 KB | ~1,900 |
| Mixed (80% interactive, 20% bulk) | ~274 KB | ~465 |

These are theoretical maximums. In practice, the V8 isolate itself, the Workers runtime, and the Hono router consume ~10-20 MiB of baseline memory, reducing the available pool to ~108-118 MiB.

### `DRAIN_INTERVAL_MS` Assessment

The current value of **50ms** is well-chosen:

| Value | Polls/sec under pressure | CPU overhead | Added latency | Verdict |
|-------|--------------------------|-------------|---------------|---------|
| 10ms | 100 | ~0.5% of 30s CPU budget | 10ms max | Wasteful for bulk |
| **50ms** | **20** | **~0.1%** | **50ms max** | **Good balance** |
| 100ms | 10 | ~0.05% | 100ms max | Acceptable |
| 200ms | 5 | ~0.025% | 200ms max | Too sluggish |

50ms is optimal because:
- The backpressure loop only fires during sustained bulk transfers (not interactive)
- 50ms of jitter is invisible in bulk transfer throughput measurements
- 20 polls/second uses negligible CPU (~0.1% of the 30s wall-clock budget)
- Going lower (10ms) wastes 5x more CPU for no perceptible improvement

**No change recommended.**

---

## Remaining Silent Failure Modes

| Mode | Trigger | Impact | Mitigated? |
|------|---------|--------|------------|
| ~~OOM crash~~ | ~~Bulk transfer to slow client~~ | ~~Connection drop, no error~~ | **YES** — backpressure caps at 1 MiB |
| ~~Oversized message RangeError~~ | ~~TCP read > 1 MiB~~ | ~~Both connections close~~ | **YES** — chunking guard |
| ~~Write reordering~~ | ~~Rapid WebSocket messages~~ | ~~TCP stream corruption~~ | **YES** — writeChain serialization |
| ~~`writeChain` rejection + close~~ | ~~Theoretical~~ | ~~Writer/socket leak~~ | **YES** — `.then(cleanup, cleanup)` handles both paths |
| Orphaned timeout timer | TCP connect succeeds after timeout race starts | None — harmless `reject()` call | N/A — not a failure |
| WebSocket close during drain poll | Client disconnect mid-backpressure | Clean shutdown via `catch`/`finally` | YES |

The data plane now has **zero open findings at any severity level**. All identified failure modes are either mitigated or structurally harmless.

---

## Build Verification

```
npm run build — PASS (0 TypeScript errors, 0 warnings)
```

---

## Summary

All three 16th-pass remediations are **correctly implemented** and verified line-by-line:

1. **Backpressure** — `bufferedAmount` polled at 1 MiB HWM before each `reader.read()`. TCP flow control propagates naturally. OOM scenario eliminated.
2. **Chunking** — Zero-copy `subarray()` splits payloads > 1 MiB. Edge cases (exact boundary, empty reads) handled correctly. `RangeError` scenario eliminated.
3. **Write serialization** — Promise-chain queue guarantees strict ordering. Close handler drains queue before teardown. Error handler bypasses queue for immediate cleanup. Correct.

One new LOW-severity finding (missing rejection handler on `writeChain.then()` in the close handler) was identified and immediately fixed with `.then(cleanup, cleanup)`.

**Previous report:** [PROTOCOL_REVIEW_16TH_PASS.md](PROTOCOL_REVIEW_16TH_PASS.md)
