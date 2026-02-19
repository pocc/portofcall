# MSRP — Message Session Relay Protocol (RFC 4975)

**Port:** 2855 (default)
**Transport:** TCP (raw, no TLS)
**Source:** `src/worker/msrp.ts`
**Routes:** `src/worker/index.ts` lines 1865–1875

## Endpoints

| # | Route | Method | Purpose |
|---|-------|--------|---------|
| 1 | `/api/msrp/send` | POST | Send a single MSRP SEND and read the response |
| 2 | `/api/msrp/connect` | POST | TCP connectivity test (no MSRP framing sent) |
| 3 | `/api/msrp/session` | POST | Multi-message session: SEND each message, read 200 OK, send REPORT receipt |

All three routes accept any HTTP method — no method restriction.

---

## 1. `/api/msrp/send`

Sends a single MSRP SEND request and parses the response.

### Request

```json
{
  "host": "relay.example.com",
  "port": 2855,
  "fromPath": "msrp://client.example.com:2855/abc123;tcp",
  "toPath": "msrp://relay.example.com:2855/def456;tcp",
  "content": "Hello, world!",
  "contentType": "text/plain",
  "messageId": "optional-custom-id",
  "timeout": 15000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | yes | — | No regex validation; any string accepted |
| `port` | no | `2855` | Validated: 1–65535 |
| `fromPath` | yes | — | MSRP URI; not validated for format |
| `toPath` | yes | — | MSRP URI; not validated for format |
| `content` | yes | — | String only; no binary/base64 support |
| `contentType` | no | `"text/plain"` | Passed verbatim in `Content-Type:` header |
| `messageId` | no | auto-generated | Format: `{Date.now()}-{random}` |
| `timeout` | no | `15000` | ms; applies independently to connect AND read (worst case 2× wall-clock) |

### Response (typed `MsrpResponse`)

```json
{
  "success": true,
  "host": "relay.example.com",
  "port": 2855,
  "statusCode": 200,
  "statusText": "OK",
  "transactionId": "aB3xKm9pQ2rT7wYz",
  "messageId": "1708123456789-k3m8n2p5q9",
  "byteRange": "1-13/13",
  "rtt": 245
}
```

- `success` is `true` when `statusCode` is 200–299.
- `transactionId` is the one generated client-side (16 random alphanumeric chars via `Math.random()`), not extracted from the server response — but it should match since the response parser keys on the request line.
- `byteRange` comes from the server's `Byte-Range` response header (case-sensitive lookup). If the server omits this header, the field is `undefined`.
- `rtt` is wall-clock time from before `connect()` to after response parsing, including both TCP setup and MSRP exchange.

### Wire exchange

```
→ MSRP aB3xKm9pQ2rT7wYz SEND\r\n
→ To-Path: msrp://relay.example.com:2855/def456;tcp\r\n
→ From-Path: msrp://client.example.com:2855/abc123;tcp\r\n
→ Message-ID: 1708123456789-k3m8n2p5q9\r\n
→ Byte-Range: 1-13/13\r\n
→ Content-Type: text/plain\r\n
→ \r\n
→ Hello, world!\r\n
→ -------aB3xKm9pQ2rT7wYz$\r\n

← MSRP aB3xKm9pQ2rT7wYz 200 OK\r\n
← ...\r\n
← -------aB3xKm9pQ2rT7wYz$\r\n
```

### Quirks

- **Byte-Range uses byte length, not character count.** `new TextEncoder().encode(content).length` — correct for multi-byte UTF-8, but `content` is a JSON string so it's already decoded from UTF-8.
- **Response cap: 8 KB.** Reads stop at 8192 bytes regardless of whether the end-line marker has been found. Responses longer than this are silently truncated and will fail to parse.
- **End-line detection is transaction-ID-scoped.** The read loop breaks when it finds `-------{transactionId}` in the accumulated response. If the server sends interleaved messages (e.g., an unsolicited SEND before the 200 OK), parsing breaks.
- **`$` flag only.** All messages are sent as complete single-chunk (`$`). The `+` (continuation) and `#` (abort) flags are recognized by the RFC but never generated.
- **Error 500 loses request context.** The outer catch block returns `host: ''` and `port: 2855` because the `body` variable is out of scope. The original request's host/port are not propagated to the error response.

---

## 2. `/api/msrp/connect`

Pure TCP connectivity test. Opens a socket and immediately closes it. **No MSRP framing is sent or read.**

### Request

```json
{
  "host": "relay.example.com",
  "port": 2855,
  "fromPath": "msrp://client.example.com:2855/abc123;tcp",
  "toPath": "msrp://relay.example.com:2855/def456;tcp",
  "timeout": 15000
}
```

| Field | Required | Default |
|-------|----------|---------|
| `host` | yes | — |
| `port` | no | `2855` |
| `fromPath` | yes | — |
| `toPath` | yes | — |
| `timeout` | no | `15000` |

`fromPath` and `toPath` are required by validation but **not used** — they are echoed back in the response verbatim.

### Response

```json
{
  "success": true,
  "host": "relay.example.com",
  "port": 2855,
  "fromPath": "msrp://client.example.com:2855/abc123;tcp",
  "toPath": "msrp://relay.example.com:2855/def456;tcp",
  "rtt": 42,
  "message": "MSRP connection successful"
}
```

### Quirks

- **Not a protocol probe.** Does not send an MSRP request or read a server banner. You're testing raw TCP reachability, not whether an MSRP relay is listening.
- **No port validation.** Unlike `/send` (which validates 1–65535), `/connect` does not check the port range.
- **`fromPath`/`toPath` are dead weight.** Required but unused — they could be anything.
- **Response is untyped.** Unlike `/send` which uses `satisfies MsrpResponse`, `/connect` returns an ad-hoc JSON shape with a `message` field that `/send` doesn't have.

---

## 3. `/api/msrp/session`

Sends multiple messages sequentially over a single TCP connection. After each SEND gets a 200 OK, sends a REPORT receipt notification.

### Request

```json
{
  "host": "relay.example.com",
  "port": 2855,
  "fromPath": "msrp://client.example.com:2855/abc123;tcp",
  "toPath": "msrp://relay.example.com:2855/def456;tcp",
  "messages": ["Hello", "How are you?", "Goodbye"],
  "timeout": 15000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | yes | — | |
| `port` | no | `2855` | No range validation (unlike `/send`) |
| `fromPath` | yes | — | |
| `toPath` | yes | — | |
| `messages` | yes | — | Non-empty string array |
| `timeout` | no | `15000` | Shared timeout per read operation |

### Response

```json
{
  "success": true,
  "host": "relay.example.com",
  "port": 2855,
  "rtt": 1250,
  "sent": 3,
  "acknowledged": 3,
  "reports": [
    { "tid": "tid001", "status": 200, "messageId": "1708123456789-k3m8n2p5q9" },
    { "tid": "tid002", "status": 200, "messageId": "1708123456790-x7y2z4a6b8" },
    { "tid": "tid003", "status": 200, "messageId": "1708123456791-c1d5e9f3g7" }
  ]
}
```

- `sent` = number of SEND requests written to the socket.
- `acknowledged` = number with status 200–299.
- `reports` = one entry per message with the transaction ID, status code, and message ID.
- `success` is **always `true`** if the function completes without throwing. Even if all messages get 400/481 errors, `success: true` as long as the socket didn't fail.

### Wire exchange (per message)

```
→ MSRP tid001 SEND\r\n
→ To-Path: ...\r\n
→ From-Path: ...\r\n
→ Message-ID: ...\r\n
→ Byte-Range: 1-5/5\r\n
→ Content-Type: text/plain\r\n
→ \r\n
→ Hello\r\n
→ -------tid001$\r\n

← MSRP tid001 200 OK\r\n
← ...\r\n
← -------tid001$\r\n

→ MSRP rpt001 REPORT\r\n         (receipt for tid001)
→ To-Path: ...\r\n
→ From-Path: ...\r\n
→ Message-ID: ...\r\n
→ Byte-Range: 1-5/5\r\n
→ Status: 000 200 OK\r\n
→ -------rpt001$\r\n
```

### Quirks

- **Predictable transaction IDs.** Uses `tid001`, `tid002`, ..., `tid{N}` and `rpt001`, `rpt002`, ..., `rpt{N}`. Unlike `/send`'s random 16-char IDs, these are sequential and predictable.
- **Content-Type hardcoded to `text/plain`.** No `contentType` parameter — all messages are sent as plain text regardless of content.
- **REPORT semantics are backwards.** RFC 4975 §7.1.1: REPORT is sent by the *receiving* party to acknowledge delivery. Here, the *sender* sends REPORT to the relay after getting 200 OK. This is atypical — it's a delivery receipt confirmation loop, not standard MSRP REPORT usage.
- **REPORT Status uses `000` namespace.** `Status: 000 200 OK` — the `000` is correct per RFC 4975 §7.1.1 (namespace for MSRP-defined status codes).
- **Response cap: 16 KB per message.** Each `readNextMsrpMessage()` call breaks at 16384 bytes. Longer responses are truncated.
- **No REPORT response read.** The REPORT is fire-and-forget — the server may respond to it, but the code doesn't read that response before moving to the next SEND. If the server does respond, that data sits in the TCP buffer and contaminates the next message's read.
- **Single timeout per read.** Each `readNextMsrpMessage()` creates a fresh `setTimeout(timeout)`. With N messages, worst case wall-clock is roughly N × timeout.
- **`success: true` on partial acknowledgement.** If 2 of 3 messages fail, `success` is still `true`. Check `acknowledged < sent` to detect partial failures.

---

## Cross-endpoint comparison

| | `/send` | `/connect` | `/session` |
|---|---------|-----------|------------|
| MSRP framing | SEND + parse response | none | SEND + parse response + REPORT |
| Port validation | 1–65535 | none | none |
| Content-Type | configurable | n/a | hardcoded `text/plain` |
| Transaction ID | 16 random chars | n/a | sequential `tid001`... |
| Response type | typed `MsrpResponse` | ad-hoc | ad-hoc |
| Response cap | 8 KB | n/a | 16 KB per message |
| Cloudflare detection | no | no | no |
| Host validation | presence-only | presence-only | presence-only |

## Known limitations

1. **No TLS (MSRPS).** All connections are plaintext TCP. RFC 4975 §14.1 recommends TLS for relay connections.
2. **No Cloudflare detection.** Unlike most other protocol workers, `checkIfCloudflare()` is not called.
3. **No host regex.** Host is checked for presence only, not validated against a hostname/IP pattern.
4. **No MSRP URI validation.** `fromPath` and `toPath` are not validated as proper `msrp://` URIs.
5. **No chunked sending.** Only the `$` (complete message) end-line flag is used. No support for sending chunked messages with `+` flag or aborting with `#`.
6. **No incoming SEND handling.** The implementation is send-only. If the relay sends an unsolicited SEND (e.g., a message from another participant), it's not parsed as a message — it would be misread as a response.
7. **No session negotiation.** MSRP sessions are normally established via SIP INVITE/200 OK with SDP containing `m=message` and `a=path:` attributes. This implementation skips that — you provide paths directly.
8. **`Math.random()` for IDs.** Transaction IDs and message IDs use `Math.random()`, which is not cryptographically secure and can produce collisions under high concurrency.
9. **No method restriction.** All three routes accept GET, PUT, DELETE, etc. — not just POST.
10. **Binary content unsupported.** `content` is a JSON string. Binary payloads (images, files per RFC 5547) would need base64 encoding, but the implementation has no decoding path.

## Response codes reference (RFC 4975)

| Code | Text | Meaning |
|------|------|---------|
| 200 | OK | Success |
| 400 | Bad Request | Malformed request |
| 403 | Forbidden | Relay denied access |
| 408 | Request Timeout | Relay timeout |
| 413 | Message Too Large | Content exceeds relay limit |
| 415 | Unsupported Media Type | Content-Type not accepted |
| 481 | No Such Session | Session ID unknown to relay |
| 501 | Not Implemented | Method not supported |

## curl examples

### Send a single message

```bash
curl -s -X POST https://portofcall.ross.gg/api/msrp/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "msrp.example.com",
    "port": 2855,
    "fromPath": "msrp://me.example.com:2855/session1;tcp",
    "toPath": "msrp://msrp.example.com:2855/session2;tcp",
    "content": "Hello from Port of Call",
    "contentType": "text/plain",
    "timeout": 10000
  }' | jq .
```

### Test connectivity

```bash
curl -s -X POST https://portofcall.ross.gg/api/msrp/connect \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "msrp.example.com",
    "port": 2855,
    "fromPath": "msrp://x:2855/a;tcp",
    "toPath": "msrp://x:2855/b;tcp"
  }' | jq .
```

### Multi-message session with receipts

```bash
curl -s -X POST https://portofcall.ross.gg/api/msrp/session \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "msrp.example.com",
    "port": 2855,
    "fromPath": "msrp://me.example.com:2855/session1;tcp",
    "toPath": "msrp://msrp.example.com:2855/session2;tcp",
    "messages": ["Hello", "How are you?", "Bye"]
  }' | jq .
```

## Local testing

Public MSRP relays are rare since MSRP sessions are normally negotiated through SIP. For local testing:

```bash
# OpenSIPS with MSRP relay module
docker run -d --name opensips -p 2855:2855 opensips/opensips

# Or use the OPAL library's MSRP test server
# https://sourceforge.net/projects/opalvoip/

# Simplest: netcat to observe wire format
nc -l 2855  # in one terminal
# then curl /api/msrp/send in another
```
