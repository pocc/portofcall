# readExact() Data Loss — Bulk Finding

**Date:** 2026-02-23
**Severity:** HIGH
**Pattern:** readExact discards excess TCP bytes when `reader.read()` returns more data than requested
**Status:** FIXED

## Description

Multiple protocol handlers implement a `readExact(reader, n)` function that reads exactly `n` bytes from a TCP stream. When `reader.read()` returns a chunk larger than the remaining bytes needed, the excess bytes are silently discarded:

```typescript
const toCopy = Math.min(n - offset, value.length);
buffer.set(value.subarray(0, toCopy), offset);
offset += toCopy;
// If value.length > toCopy, remaining bytes are LOST
```

TCP does not guarantee that read boundaries align with protocol message boundaries. When a server sends two protocol messages back-to-back (e.g., a frame header followed by payload), they may arrive in a single TCP segment. The first `readExact` call consumes the header but discards the beginning of the payload.

## Reachability

This bug triggers during **normal use** whenever:
1. The protocol handler calls `readExact` multiple times on the same reader
2. TCP coalesces adjacent protocol messages into a single segment

This is common on fast networks, localhost connections, and any scenario where the server writes responses quickly.

## Fix Applied

Created a shared `BufferedReader` utility (`src/worker/buffered-reader.ts`) that wraps `ReadableStreamDefaultReader` and preserves excess bytes across reads:

```typescript
export class BufferedReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buf: Uint8Array = new Uint8Array(0);

  async readExact(n: number, timeoutPromise?: Promise<never>): Promise<Uint8Array> {
    while (this.buf.length < n) {
      const readOp = this.reader.read();
      const { value, done } = timeoutPromise
        ? await Promise.race([readOp, timeoutPromise])
        : await readOp;
      if (done || !value) throw new Error(`Connection closed...`);
      // merge into internal buffer
    }
    const result = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);  // preserve leftover
    return result;
  }
}
```

Each handler creates `const br = new BufferedReader(reader)` and replaces `readExact(reader, N)` → `br.readExact(N)`.

## Files Fixed (local readExact deleted, BufferedReader adopted)

| File | Sequential Reads | Key Protocol Messages |
|------|-----------------|----------------------|
| rdp.ts | 6 (3 handlers × 2) | TPKT header (4B) + X.224 body |
| pptp.ts | 6 (3 handlers) | SCCRP (156B) + OCRP (32B) in tunnel handler |
| dicom.ts | 6 (3 handlers × readPDU) | PDU header (6B) + payload |
| bittorrent.ts | 3+ | Handshake (68B) + peer messages (4B len + payload) |
| rethinkdb.ts | 14+ (7 handlers) | Query response header (12B) + body |
| ceph.ts | 21+ (3 handlers) | Banner + auth + OSD map sequences |
| nbd.ts | 36+ (4 handlers) | Greeting + option replies + export sequences |
| pcep.ts | 7 (3 handlers) | PCEP header (4B) + message body, loop of header+body pairs |
| tarantool.ts | 9+ (4 handlers) | Greeting (128B) + IPROTO size prefix + payload |
| bitcoin.ts | 10+ (3 handlers) | readMessage: 24B header + payload (version→verack→inv→pong) |
| cdp.ts | tunnel loop + handshake | WebSocket frames spanning TCP segments; handshake leftover |

## Files Already Safe (verified, no changes needed)

| File | Why Safe |
|------|----------|
| amqp.ts | Local `BufferedReader` class (prior review) |
| amqps.ts | Local `BufferedReader` class (prior review) |
| h323.ts | Local `BufferedReader` class (prior review) |
| rtmp.ts | Local `BufferedReader` class (prior review) |
| x11.ts | Uses shared `BufferedReader` import (prior review) |
| cassandra.ts | Local `BufferedReader` class (prior review) |
| couchbase.ts | Local `BufferedReader` class (prior review) |
| oracle-tns.ts | Local `BufferedReader` class (prior review) |
| vnc.ts | Local `BufferedReader` class (prior review) |
| livestatus.ts | Local `BufferedReader` class (prior review) |
| gadugadu/utils.ts | Local `BufferedReader` class (prior review) |
| afp.ts | `leftover` mutable ref parameter |
| epp.ts | Inline leftover handling |
| git.ts | `existingBuffer` + `bufferOffset` pattern |
| minecraft.ts | Returns `{ data, leftover }` |
| radius.ts | Returns `{ data, leftover }` |
| tacacs.ts | Returns `{ data, leftover }` |
| tds.ts | Mutable `buf` reference parameter |
| adb.ts | `readAtLeast` with leftover buffering |
| dict.ts | Leftover handling |
| battlenet.ts | Leftover handling |
| ami.ts | `AMIReader` class with internal buffer |
| mqtt.ts | Leftover handling |

## Files Not Affected

| File | Reason |
|------|--------|
| ajp.ts | readExact called only once (5B CPong), then socket closes |
| socks4.ts | readExactly called only once (8B response), then socket closes |
