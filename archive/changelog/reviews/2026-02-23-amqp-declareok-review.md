# AMQP Queue.DeclareOk Parsing Bug — 2026-02-23

## Finding: Wrong offset for queue metadata in Basic.Get handler (MEDIUM)

**File:** `src/worker/amqp.ts` — `handleAMQPGet` (~line 1575)

**Bug:** The Queue.Declare-Ok response parsing skipped the queue-name short
string and read `message-count` / `consumer-count` directly from offset 0 of
the args payload. Per AMQP 0-9-1, Queue.Declare-Ok carries:

    queue-name   (shortstr)   — 1-byte length + N bytes
    message-count (long)      — uint32
    consumer-count (long)     — uint32

The code was treating `message-count` as starting at byte 0, but byte 0 is the
length prefix of the queue name. Any non-empty queue name causes both
`queueMessageCount` and `queueConsumerCount` to return garbage values.

**Impact:** Every call to `POST /api/amqp/get` returned wrong `queueMessageCount`
and `queueConsumerCount` metadata. The actual message body, exchange, routing
key, and delivery tag were unaffected (those come from Basic.Get-Ok, not
Queue.Declare-Ok).

**Fix:** Skip the queue-name short string before reading the two uint32 counts
using the existing `readShortString` helper.

**Reachability:** Any user calling `/api/amqp/get` with any queue name triggers
this — the queue name is always present in Queue.Declare-Ok.

---

## Protocols reviewed (clean)

- **ami.ts** — Proper `AMIReader` class with internal string buffer. CRLF
  injection prevented via `sanitize()`. `SAFE_ACTIONS` allowlist for read-only
  commands. MD5 challenge-response auth correct. Write endpoints intentionally
  separate. 0 findings.

- **amqp.ts** — Already uses `BufferedReader` class (readExact byte-drop fixed).
  Field table parser handles all standard AMQP 0-9-1 types correctly. Unknown
  types bail out of table rather than misaligning cursor. 1 finding (above).

- **amqps.ts** — Connect handler uses `BufferedReader` class. Publish/consume
  delegate to shared `doAMQPPublish`/`doAMQPConsume` from amqp.ts. 0 unique
  findings.

- **battlenet.ts** — `readBNCSPacket` correctly returns `{ data, leftover }`
  and callers thread leftover between reads. SID_PING challenge handled.
  `parseAuthInfoResponse` correctly parses all fields. 0 findings.
