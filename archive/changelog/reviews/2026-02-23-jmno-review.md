# Protocol Review: J–N Pass
**Date:** 2026-02-23
**Protocols reviewed:** jabber-component, jdwp, jetdirect, jsonrpc, kafka, kerberos, ldap, ldaps, ldp, livestatus, llmnr, lmtp, lpd, lsp, managesieve, matrix, mdns, meilisearch, memcached, mgcp, minecraft, mms, modbus, mongodb, mpd, mqtt, msn, msrp, mumble, munin, mysql, napster, nats, nbd, neo4j, netbios, nfs, ninep, nntp, nntps, node-inspector, nomad, nrpe, nsca, nsq, ntp

## Architecture note: router-level SSRF protection

Many protocols (matrix, mdns, mpd, msn, msrp, napster, ninep/9p, nntp, jabber-component, jsonrpc, mgcp, and others) do not call `checkIfCloudflare()` per-handler. This is **not a bug**. `router-guards.ts` wraps these protocols in `maybeBlockCloudflareTarget()` at the router level before the handler is reached. Both protection layers resolve to the same `isBlockedHost` check.

---

## Finding 1 — LMTP command injection via unsanitized CRLF (HIGH)

**File:** `src/worker/lmtp.ts`

**Problem:** `sendLMTPCommand()` wrote the raw command string to the socket without stripping `\r\n`. The `MAIL FROM:<${options.from}>` and `RCPT TO:<${recipient}>` commands embed user-controlled values directly, so a `from` value of `foo\r\nMAIL FROM:<attacker>` would inject a second LMTP command on the wire.

SMTP's equivalent `sendSMTPCommand()` already strips CRLFs:
```typescript
const safeCommand = command.replace(/[\r\n]/g, '');
```
LMTP lacked this line.

**Fix:** Added `const safeCommand = command.replace(/[\r\n]/g, '');` in `sendLMTPCommand()` and write `safeCommand` instead of `command`.

---

## Finding 2 — JSONRPC WebSocket 64-bit frame length ignored (MEDIUM)

**File:** `src/worker/jsonrpc.ts` — `handleJsonRpcWs()`

**Problem:** When a WebSocket frame header byte indicates a 64-bit extended payload length (`len === 127`), the code advanced `dataOffset` to 10 correctly but did **not** update `len` from 127 to the actual payload size encoded in bytes 2–9. The subsequent `chunk.slice(dataOffset, dataOffset + len)` would then read only the first 127 bytes of the payload regardless of actual frame size.

In practice this means any JSON-RPC response arriving in a single WebSocket frame larger than 65535 bytes would be silently truncated to 127 bytes, causing a JSON parse error returned to the caller as `success: false`.

**Fix:** Reads the lower 32 bits of the 8-byte big-endian length field (bytes 6–9):
```typescript
else if (len === 127) {
  // 64-bit big-endian length in bytes 2-9; lower 32 bits suffice for any realistic payload
  len = ((chunk[6] << 24) | (chunk[7] << 16) | (chunk[8] << 8) | chunk[9]) >>> 0;
  dataOffset = 10;
}
```

---

## Clean protocols (no findings)

jabber-component, jdwp, jetdirect, kafka, kerberos, ldap, ldaps, ldp, livestatus, llmnr, lpd, lsp, managesieve, matrix, mdns, meilisearch, memcached, mgcp, minecraft, mms, modbus, mongodb, mpd, mqtt, msn, msrp, mumble, munin, mysql, napster, nats, nbd, neo4j, netbios, nfs, ninep, nntp, nntps, node-inspector, nomad, nrpe, nsca, nsq, ntp
