Read docs/prompts/REVIEW_GUIDELINES.md first. Follow those rules strictly — in particular,
resource leaks in Cloudflare Workers are LOW severity at most (platform provides a
backstop), not CRITICAL or HIGH.

Your task: sweep every protocol file in src/worker/ for exactly two bug classes:

---

## 1B — Reader/writer lock leaks

A `ReadableStreamDefaultReader` or `WritableStreamDefaultWriter` is acquired (via
`.getReader()` or `.getWriter()`) but `releaseLock()` is not called on every code path.
Look specifically for:

- `releaseLock()` only in the happy path, not inside a `finally` block
- `reader.releaseLock()` called after `writer.close()` — if `close()` throws, the reader
  lock is never released
- Early `return` or `throw` inside a `try` block that bypasses a `releaseLock()` outside
  the `finally`

A finding is real if: holding the lock prevents the socket from being closed cleanly
within the same request, OR causes a visible error when the same stream is reused later
in the same handler. It is NOT a finding if the handler closes the socket
unconditionally in `finally` regardless of whether the lock was released.

---

## 1C — Socket not closed on error

A `TCPSocket` (or equivalent transport) is opened but `socket.close()` /
`socket.writable.close()` is not called on every code path. Look specifically for:

- `socket.close()` only in the success path, not in a `finally` block
- `socket.close()` inside a `catch` but missing from the success path (inverted coverage)
- `connect()` called outside `try` — if the connection succeeds but the next line throws,
  the socket is never closed

A finding is real if: the upstream server would observe a half-open TCP connection and
hang waiting for it to close, causing the user to see a timeout or stalled response on
their next call to the same server. It is NOT a finding if the isolate lifetime (< 30 s)
makes this unobservable in practice — file those as LOW only.

---

## Process

For each protocol, working alphabetically through src/worker/:

1. Read the source file
2. Check for 1B and 1C patterns above
3. If found, verify reachability: describe the exact user action and error path that
   triggers it
4. If real: fix it, document it in docs/changelog/by-protocol/<protocol>.md under
   "Bugs Found and Fixed"
5. If 0 findings: document "Pass: 0 findings (1B/1C sweep)" in the same file and move on

Do not fix or report anything outside classes 1B and 1C. Do not re-verify previously
fixed code. One pass per file — if 0 findings, move on immediately.

Run `npm run build` once after all fixes are complete, not after each file.
