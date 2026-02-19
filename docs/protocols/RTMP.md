# RTMP (Real-Time Messaging Protocol) — Port 1935

Implementation: `src/worker/rtmp.ts` (922 lines)
Routes: `src/worker/index.ts` lines 1154–1165
Tests: `tests/rtmp.test.ts` (validation only — no live-server integration tests)

Three endpoints. All POST, all JSON body. Full RTMP handshake (C0/C1/S0/S1/S2/C2) + AMF0 command layer over `cloudflare:sockets` TCP.

**No method guard:** Routes in index.ts match pathname only. GET or empty-body POST will 500 from `request.json()`, not 405.

---

## Endpoints

### POST /api/rtmp/connect

Handshake + `connect` command. Tests whether an RTMP server is reachable and accepts connections to a given application.

**Request:**
```json
{
  "host": "live.example.com",
  "port": 1935,
  "app": "live",
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | *(required)* | |
| `port` | `1935` | Validated 1–65535 |
| `app` | `"live"` | RTMP application name |
| `timeout` | `10000` | ms; wraps entire operation |

**Response (success):**
```json
{
  "success": true,
  "host": "live.example.com",
  "port": 1935,
  "app": "live",
  "connectTime": 42,
  "rtt": 187,
  "handshakeComplete": true,
  "connectResult": [
    { "fmsVer": "FMS/5,0,17,0", "capabilities": 31, "mode": 1 },
    { "level": "status", "code": "NetConnection.Connect.Success", "description": "Connection succeeded." }
  ]
}
```

- `connectTime` — TCP socket open latency (ms)
- `rtt` — total elapsed from socket open through connect `_result` (ms)
- `connectResult` — raw AMF0 `_result` args array (typically two objects: server properties + info object)

**Wire sequence:**
```
C → S: C0 (0x03) + C1 (1536 bytes: timestamp + zero + random)
S → C: S0 + S1 + S2
C → S: C2 (echo of S1)
C → S: Window Acknowledgement Size (2500000)
C → S: connect("live", txId=1, {app, type, flashVer, tcUrl})
S → C: (various protocol control messages, then _result txId=1)
```

**curl:**
```bash
curl -s -X POST https://portofcall.dev/api/rtmp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"live.example.com","app":"live"}' | jq
```

---

### POST /api/rtmp/publish

Handshake + connect + `createStream` + `publish` command. Negotiates a publish session and optionally sends `@setDataFrame` metadata.

**Request:**
```json
{
  "host": "live.example.com",
  "port": 1935,
  "app": "live",
  "streamKey": "my-stream-key",
  "metaData": {
    "width": 1920,
    "height": 1080,
    "framerate": 30,
    "videocodecid": 7,
    "audiocodecid": 10
  },
  "timeout": 15000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | *(required)* | |
| `streamKey` | *(required)* | Sent as the stream name in the `publish` command |
| `port` | `1935` | Not validated (unlike `/connect`) |
| `app` | `"live"` | |
| `metaData` | *(omit)* | If non-empty, sent as `@setDataFrame` / `onMetaData` AMF0 data message after publish starts |
| `timeout` | `15000` | ms |

**Response (success):**
```json
{
  "success": true,
  "host": "live.example.com",
  "port": 1935,
  "app": "live",
  "streamKey": "my-stream-key",
  "streamId": 1,
  "publishStarted": true,
  "connectResult": [ ... ],
  "serverResponses": [
    { "name": "onStatus", "info": { "level": "status", "code": "NetStream.Publish.Start", "description": "Publishing my-stream-key" } }
  ]
}
```

- `streamId` — the server-assigned stream ID from `createStream`
- `publishStarted` — true if server sent `NetStream.Publish.Start`
- `serverResponses` — all AMF0 command responses received after `publish` was sent (array of `{name, info}`)

**Wire sequence:**
```
[handshake + connect as above]
C → S: createStream(txId=2)
S → C: _result(txId=2, streamId)
C → S: publish(txId=0, null, streamKey, "live")  [on stream streamId]
S → C: onStatus("NetStream.Publish.Start")
C → S: @setDataFrame("onMetaData", {...})  [if metaData provided, AMF0 data msg type 18]
```

**Port validation gap:** Unlike `/connect`, this endpoint does not validate port range. Out-of-range values will fail at the TCP level.

---

### POST /api/rtmp/play

Handshake + connect + `createStream` + `play` command. Attempts to subscribe to a published stream and captures metadata.

**Request:**
```json
{
  "host": "live.example.com",
  "port": 1935,
  "app": "live",
  "streamName": "my-stream",
  "timeout": 15000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | *(required)* | |
| `streamName` | *(required)* | |
| `port` | `1935` | Not validated |
| `app` | `"live"` | |
| `timeout` | `15000` | ms |

**Response (success):**
```json
{
  "success": true,
  "host": "live.example.com",
  "port": 1935,
  "app": "live",
  "streamName": "my-stream",
  "streamId": 1,
  "playStarted": true,
  "connectResult": [ ... ],
  "streamMetaData": { "width": 1920, "height": 1080, "framerate": 30 },
  "serverResponses": [
    { "name": "onStatus", "txId": 0, "info": { "level": "status", "code": "NetStream.Play.Start" } }
  ]
}
```

- `streamMetaData` — captured from `onMetaData` AMF0 data message (null if server doesn't send one)
- `playStarted` — true if `NetStream.Play.Start`, `NetStream.Play.Reset`, or an audio/video frame was received
- `serverResponses` — includes `txId` field (unlike `/publish` responses)

**Wire sequence:**
```
[handshake + connect as above]
C → S: User Control SetBufferLength(streamId=1, 3000ms)
C → S: createStream(txId=2)
S → C: _result(txId=2, streamId)
C → S: play(txId=0, null, streamName, start=-1)  [on stream streamId]
S → C: onStatus, |RtmpSampleAccess, onMetaData, audio/video frames
```

---

## Handshake Details

All three endpoints share the same handshake code (`rtmpHandshakeAndConnect`).

| Step | Bytes | Content |
|------|-------|---------|
| C0 | 1 | `0x03` (RTMP version 3) |
| C1 | 1536 | 4-byte timestamp (`Date.now() & 0xFFFFFFFF`) + 4 zero bytes + 1528 random bytes (`Math.random()`) |
| S0 | 1 | Expected `0x03`; throws if different |
| S1 | 1536 | Read in full |
| S2 | 1536 | Read and discarded (`void s2`) — **no echo verification** |
| C2 | 1536 | Echo of S1 timestamps + S1 random data |

After handshake, the client sends:
- Window Acknowledgement Size = 2,500,000 bytes (protocol control on csid 2)
- `connect` command (AMF0 on csid 3) with `{app, type: "nonprivate", flashVer: "FMLE/3.0 (compatible; portofcall)", tcUrl: "rtmp://host:port/app"}`

The response loop reads up to 20 messages looking for `_result` with txId=1. Protocol control messages (Set Chunk Size, Window Ack Size, Set Peer Bandwidth, User Control, Acknowledgement) are consumed silently. If `Set Chunk Size` arrives, the module-level `remoteChunkSize` is updated.

---

## AMF0 Codec

Full encode/decode for 6 types:

| Type byte | Name | Encoding |
|-----------|------|----------|
| `0x00` | Number | 8-byte IEEE 754 double, big-endian |
| `0x01` | Boolean | 1 byte (0x00 or 0x01) |
| `0x02` | String | 2-byte length prefix (big-endian) + UTF-8 |
| `0x03` | Object | Key-value pairs (2-byte-length key + typed value), terminated by `0x00 0x00 0x09` |
| `0x05` | Null | No data |
| `0x08` | ECMA Array | 4-byte count (ignored in decoder) + key-value pairs + end marker |

Not supported: Long String (0x0C), Typed Object (0x10), Undefined (0x06), Reference (0x07), Date (0x0B), XML (0x0F). Unknown type bytes decode as null and consume 1 byte.

`amf0DecodeAll` repeatedly calls `amf0Decode` until the buffer is exhausted (or `bytesRead === 0` as a safety valve).

---

## Chunk Framing

### Encoding (`encodeChunks`)

Outgoing messages use fmt=0 (full 12-byte header: 1 basic + 11 message) for the first chunk, fmt=3 (1-byte header) for continuation chunks. Default outgoing chunk size is 128 bytes (hardcoded; the client never sends Set Chunk Size to increase it).

Basic header for csid <= 63: `(fmt << 6) | (csid & 0x3F)` — always 1 byte.

Timestamps are capped at `0xFFFFFF` (3-byte max). Extended timestamps are never sent.

### Decoding (`readRTMPMessage`)

Reads a single RTMP message (possibly spanning multiple chunks). Handles:
- 1-byte basic header (csid 2–63)
- 2-byte basic header (csid=0 in first byte → read 1 more byte, csid = byte + 64)
- 3-byte basic header (csid=1 in first byte → read 2 more bytes, csid = `b1*256 + b0 + 64`)

For fmt=0: reads full 11-byte message header + optional 4-byte extended timestamp (if timestamp == 0xFFFFFF, but the value is read and discarded — not applied to the message timestamp).

For fmt=1: reads 7 bytes (timestamp delta, length, type ID). No stream ID.

For fmt=2: reads 3 bytes (timestamp delta only).

For fmt=3: no header bytes.

**Continuation chunk handling:** After reading `remoteChunkSize` bytes, if more payload remains, reads a 1-byte continuation header. If the continuation fmt is not 3, it's silently treated as fmt=3 anyway (comment: "Re-parse would be complex; treat as fmt=3 for simplicity").

---

## Known Limitations and Quirks

### Module-level `remoteChunkSize` (concurrency bug)

`remoteChunkSize` is declared at module scope (`let remoteChunkSize = 128`). Each handler resets it to 128 at the start, but if two requests execute concurrently in the same Worker isolate, they'll clobber each other's chunk size. This could cause mid-stream framing corruption.

### No RTMPS (TLS)

No TLS support. Cannot connect to `rtmps://` endpoints (e.g., Facebook Live requires RTMPS on port 443). Would need `connect({secureTransport: "on"})`.

### No authentication

No RTMP-level authentication (e.g., Adobe Access, SWF verification, or token-based auth). The only auth mechanism is the `streamKey` in the publish command, which is standard RTMP behavior (the key is the stream name, not a separate auth exchange).

### S2 not verified

The handshake reads S2 but explicitly discards it (`void s2`). Per the RTMP spec, S2 should echo C1's random bytes. Skipping verification means the client won't detect a misbehaving intermediary that doesn't properly echo the handshake.

### Extended timestamp discarded

When fmt=0 and the 3-byte timestamp field is 0xFFFFFF, the code reads the 4-byte extended timestamp but doesn't store the value — the message keeps timestamp=0xFFFFFF. Streams longer than ~4.6 hours (2^24 ms) would have incorrect timestamps.

### fmt=1/2/3 state not tracked across messages

`readRTMPMessage` doesn't maintain per-csid state between calls. If a server sends fmt=1/2/3 headers (which rely on values from a previous message on the same csid), the decoded timestamp/length/typeId/streamId will be 0 because the previous context isn't preserved. This works in practice because most servers send fmt=0 for the first message on each csid in a new session, but could break with aggressive header compression.

### C1 random bytes: `Math.random()`

C1's 1528 random bytes are generated with `Math.random()`, not a CSPRNG. This is fine for basic handshakes but wouldn't pass RTMP version 2 (RTMPE) cryptographic handshake requirements.

### SetBufferLength hardcoded stream ID

In `/play`, the SetBufferLength user control message is sent with hardcoded stream ID 1, *before* `createStream` returns the actual stream ID. If the server assigns a stream ID other than 1, the buffer length hint applies to the wrong stream.

### `/play` response shape differs from `/publish`

`/play` `serverResponses` entries have `{name, txId, info}` while `/publish` entries have `{name, info}` (no txId). Consumers parsing responses from both endpoints need to account for this.

### play start=-1 semantics

The `play` command passes `start=-1` as the fourth argument, which in RTMP means "play live stream from the current position." This cannot be changed via the API — there's no way to request a recorded stream or seek to a specific position.

### Response loop limits

- `/connect`: reads up to 20 messages for `_result`
- `/publish`: reads up to 20 messages for `onStatus`
- `/play`: reads up to 30 messages for play start

If the server sends more than this many protocol control messages before the expected response, the handler throws "Did not receive _result" or similar.

### No FCPublish / releaseStream

The publish flow sends `createStream` → `publish` directly. Some ingest servers (YouTube Live, Facebook Live, certain Wowza configs) require `releaseStream` and/or `FCPublish` before the `publish` command. Publish will fail on those servers with no clear error — typically a timeout waiting for `NetStream.Publish.Start`.

### Publish type hardcoded to `"live"`

The `publish` command's type argument is always `"live"`. No support for `"record"` (save to server-side file) or `"append"` (append to existing recording). Not configurable via the API.

### `publishStarted: false` with `success: true`

If the `/publish` loop reads 20 messages without seeing `NetStream.Publish.Start`, it exits the loop without throwing. The response will have `success: true` but `publishStarted: false` — callers must check `publishStarted`, not just `success`. Same pattern in `/play` with `playStarted`.

### tcUrl always includes port

The connect command builds tcUrl as `rtmp://${host}:${port}/${app}`, always including the port even when using the default 1935. Some strict servers may reject this form vs the portless `rtmp://host/app`.

### Minimal connect properties

The `connect` command sends only `{app, type, flashVer, tcUrl}`. It omits `objectEncoding`, `swfUrl`, `pageUrl`, `audioCodecs`, `videoCodecs`, and `videoFunction`. Most servers tolerate this, but servers that use SWF verification or codec negotiation may behave differently.

### No Acknowledgement messages sent

The client sends Window Acknowledgement Size (2,500,000) but never sends actual Acknowledgement (type 3) messages in response to received data. For the short-lived probe connections this is fine, but a long-running session would eventually stall on servers that enforce flow control.

### AMF0 unknown type parsing corruption

Unknown AMF0 type bytes (anything not 0x00/0x01/0x02/0x03/0x05/0x08) decode as `null` consuming only 1 byte. If the actual encoded value is longer (e.g., Date is 11 bytes, Strict Array is variable), all subsequent values in the stream will be mis-parsed. Safe for typical connect/publish/play flows but breaks if server sends Date, Strict Array, or Typed Object in responses.

### Cloudflare detection

All three endpoints call `checkIfCloudflare(host)` before connecting. Returns HTTP 403 with `{success: false, isCloudflare: true}` if the target resolves to a Cloudflare IP.

---

## Quick Reference

| Endpoint | Method | Timeout | Port Validated | Unique Features |
|----------|--------|---------|----------------|-----------------|
| `/api/rtmp/connect` | POST | 10s | Yes (1–65535) | `connectTime` + `rtt` |
| `/api/rtmp/publish` | POST | 15s | No | `metaData` → `@setDataFrame`, `serverResponses` (no txId) |
| `/api/rtmp/play` | POST | 15s | No | SetBufferLength, `streamMetaData` capture, `serverResponses` (with txId) |

## RTMP Message Types Reference

| Type ID | Constant | Purpose |
|---------|----------|---------|
| 1 | `MSG_SET_CHUNK_SIZE` | New max chunk payload size |
| 3 | `MSG_ACK` | Bytes received acknowledgement |
| 4 | `MSG_USER_CONTROL` | Stream events (SetBufferLength, StreamBegin, etc.) |
| 5 | `MSG_WINDOW_ACK_SIZE` | Flow control window |
| 6 | `MSG_SET_PEER_BW` | Peer bandwidth limit |
| 8 | `MSG_AUDIO` | Audio data |
| 9 | `MSG_VIDEO` | Video data |
| 17 | `MSG_AMF3_CMD` | AMF3 command (decoded as AMF0 in this impl) |
| 18 | `MSG_AMF0_DATA` | AMF0 data (metadata, @setDataFrame) |
| 20 | `MSG_AMF0_CMD` | AMF0 command (connect, createStream, publish, play, onStatus, _result, _error) |

**AMF3 command bug (type 17):** `MSG_AMF3_CMD` is handled identically to `MSG_AMF0_CMD` — `parseAMF0Response` is called directly on the payload. Per the RTMP spec, AMF3 command messages prepend a `0x00` byte before the AMF0-encoded command name. Without stripping this byte, `amf0Decode` interprets `0x00` as an AMF0 Number marker and consumes the next 8 bytes as an IEEE 754 double, corrupting the entire parse chain. In practice this rarely triggers because most servers only use AMF0 commands.

---

## Missing Protocol Features

### No FCPublish / releaseStream

Some RTMP servers (nginx-rtmp, Wowza, YouTube Live) expect `FCPublish(streamKey)` and/or `releaseStream(streamKey)` commands before `publish`. This implementation skips them. Most servers still accept the publish without these commands, but YouTube Live in particular requires `FCPublish` and will reject the publish without it.

### No acknowledgement messages

The RTMP spec requires the client to send Acknowledgement (type 3) messages after receiving Window-Ack-Size bytes of data. This implementation reads the server's window ack size but never tracks incoming bytes or sends acknowledgements. Servers with strict flow control may stall waiting for an ack that never comes, particularly during `/play` where the server streams audio/video data.

### No Set Chunk Size from client

The client always uses the default 128-byte chunk size for outgoing messages and never sends a Set Chunk Size protocol control message. This is spec-compliant but suboptimal for larger payloads — a typical `connect` command object exceeds 128 bytes and requires multi-chunk framing.

### Publish type fixed to "live"

The `publish` command always sends `"live"` as the publish type. RTMP supports `"record"` (save to server-side file) and `"append"` (append to existing recording), but neither is exposed via the API.

### Play start fixed to -1

The `play` command always sends `start=-1` (live stream, current position). RTMP supports `start=-2` (live first, then recorded if live unavailable) and `start=N` (seek to N seconds into a recording), but the API doesn't expose these.

### connect command omits codec capabilities

The `connect` command object sends only `{app, type, flashVer, tcUrl}`. It does not include `audioCodecs`, `videoCodecs`, `capabilities`, or `videoFunction` fields that a real Flash client would send. Some servers may return reduced capability sets or reject connections without these.

### No ECMA Array encoding

The AMF0 decoder handles ECMA Array (0x08), but the encoder has no `amf0EncodeECMAArray` function. Metadata objects sent via `@setDataFrame` are always encoded as AMF0 Object (0x03). Most servers accept either, but some strictly expect ECMA Array for `onMetaData`.

---

## Local Testing

```bash
# Start nginx-rtmp in Docker
docker run -d -p 1935:1935 --name rtmp tiangolo/nginx-rtmp

# Test connectivity against local server (via wrangler dev on port 8787)
curl -s localhost:8787/api/rtmp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"host.docker.internal","port":1935,"app":"live"}' | jq

# Push a test stream with ffmpeg first, then test play
ffmpeg -re -f lavfi -i testsrc=size=320x240:rate=15 -c:v libx264 -f flv rtmp://localhost/live/test &
curl -s localhost:8787/api/rtmp/play \
  -H 'Content-Type: application/json' \
  -d '{"host":"host.docker.internal","streamName":"test","app":"live"}' | jq

# Test publish (will get NetStream.Publish.Start from nginx-rtmp)
curl -s localhost:8787/api/rtmp/publish \
  -H 'Content-Type: application/json' \
  -d '{"host":"host.docker.internal","streamKey":"mykey","app":"live"}' | jq
```
