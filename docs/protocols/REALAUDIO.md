# RealAudio / RealMedia — Legacy Streaming Protocol

**Ports:** 7070 (RTSP control), 554 (alternative RTSP), 6970-7170 (RTP/RDT data)
**Transport:** TCP (RTSP control), UDP (RTP/RDT media), TCP interleaved (optional)
**RFCs:** RFC 2326 (RTSP 1.0), RFC 2327 (SDP), RFC 3550 (RTP)
**Proprietary:** PNA (Progressive Networks Audio), RDT (Real Data Transport)
**Implementation:** `src/worker/realaudio.ts`
**Routes:** `/api/realaudio/probe`, `/api/realaudio/describe`, `/api/realaudio/setup`, `/api/realaudio/session`

---

## Overview

RealAudio and RealMedia were dominant streaming protocols in the 1990s and 2000s, developed by RealNetworks (formerly Progressive Networks). Before Flash and HTML5 video, RealPlayer was ubiquitous for audio/video streaming on the web. The protocol uses RTSP for session control and RDT (Real Data Transport) or RTP for media delivery.

**Modern status:** RealNetworks discontinued RealPlayer in 2018. Helix Server is still available but rarely used. Most content has migrated to HLS, MPEG-DASH, or WebRTC.

### Protocol Variants

- **PNA (Progressive Networks Audio):** Legacy proprietary protocol on ports 7070/7171
- **RTSP:** Standard RTSP (RFC 2326) with RealMedia-specific extensions
- **RDT (Real Data Transport):** Proprietary alternative to RTP
- **HTTP:** RealMedia can fall back to HTTP streaming

### RTSP Commands (RealMedia Extensions)

| Command | Purpose |
|---------|---------|
| `OPTIONS` | Query server capabilities |
| `DESCRIBE` | Retrieve stream metadata (SDP with RealMedia extensions) |
| `SETUP` | Configure streaming session and transport |
| `PLAY` | Start playback |
| `PAUSE` | Pause playback |
| `TEARDOWN` | End session |

### RealMedia-Specific Headers

| Header | Purpose |
|--------|---------|
| `ClientID` | RealPlayer client identifier (required by many servers) |
| `ClientChallenge` | Challenge string for authentication handshake |
| `PlayerStarttime` | Client timestamp for session correlation |
| `CompanyID` | Vendor identifier (e.g., `progressive-networks`) |
| `GUID` | Client unique identifier |
| `x-Real-UsePreBuffer` | Buffer control directive |
| `x-Real-Proxy` | Proxy configuration |
| `DataType` | Set to `RDT` for Real Data Transport |

### SDP Extensions

RealMedia SDP includes these proprietary attributes:

| Attribute | Purpose |
|-----------|---------|
| `a=mimetype:` | RealAudio MIME type |
| `a=AvgBitRate:` | Average bitrate in bps |
| `a=MaxBitRate:` | Maximum bitrate in bps |
| `a=StreamName:` | Human-readable stream name |

### Common MIME Types

- `audio/x-pn-realaudio`
- `audio/x-pn-realaudio-plugin`
- `video/x-pn-realvideo`
- `application/x-pn-realmedia`
- `application/vnd.rn-realmedia`

---

## Endpoints

### `POST /api/realaudio/probe`

Sends a single RTSP `OPTIONS` request to detect RealMedia server presence and capabilities.

**Request**

```json
{
  "host": "legacy.example.com",
  "port": 7070,
  "timeout": 15000,
  "streamPath": "/"
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | **required** | Hostname or IP address |
| `port` | number | `7070` | TCP port (1-65535) |
| `timeout` | number | `15000` | Timeout in milliseconds |
| `streamPath` | string | `"/"` | RTSP resource path |

**Response (success)**

```json
{
  "success": true,
  "host": "legacy.example.com",
  "port": 7070,
  "server": "Helix Server Version 14.3.0.155",
  "cseq": 1,
  "isRealServer": true,
  "rtt": 142
}
```

| Field | Type | Notes |
|-------|------|-------|
| `success` | boolean | `true` if 200 OK received |
| `server` | string | Value of `Server:` response header |
| `cseq` | number | Sequence number echoed by server |
| `isRealServer` | boolean | `true` if server name contains "Helix", "RealServer", or "Real" |
| `rtt` | number | Round-trip time in milliseconds |

**Response (error)**

```json
{
  "success": false,
  "host": "legacy.example.com",
  "port": 7070,
  "error": "RTSP 404 Not Found",
  "rtt": 98
}
```

The `error` field contains the RTSP status line if non-200, or a connection error message.

---

### `POST /api/realaudio/describe`

Sends RTSP `DESCRIBE` request to retrieve SDP metadata for a RealMedia stream.

**Request**

```json
{
  "host": "legacy.example.com",
  "port": 7070,
  "timeout": 15000,
  "streamPath": "/audio/sample.rm"
}
```

**Response (success)**

```json
{
  "success": true,
  "host": "legacy.example.com",
  "port": 7070,
  "server": "Helix Server Version 14.3.0.155",
  "contentType": "application/sdp",
  "contentBase": "rtsp://legacy.example.com:7070/audio/",
  "streamInfo": "v=0\r\no=- 1234567890 1234567890 IN IP4 10.0.1.5\r\ns=Sample RealAudio Stream\r\ni=RealAudio 10 codec\r\nc=IN IP4 0.0.0.0\r\nt=0 0\r\na=control:*\r\na=range:npt=0-\r\nm=audio 0 RTP/AVP 101\r\na=rtpmap:101 x-pn-realaudio/44100\r\na=control:streamid=0\r\na=mimetype:string;\"audio/x-pn-realaudio\"\r\na=AvgBitRate:integer;128000\r\na=MaxBitRate:integer;160000\r\n",
  "isRealServer": true
}
```

| Field | Type | Notes |
|-------|------|-------|
| `success` | boolean | `true` if 200 OK received |
| `server` | string | `Server:` header value |
| `contentType` | string | `Content-Type:` header (usually `application/sdp`) |
| `contentBase` | string | `Content-Base:` header — base URL for relative control URLs |
| `streamInfo` | string | Full SDP body (up to 5000 bytes) |
| `isRealServer` | boolean | Helix/RealServer detection |

**SDP body parsing:** The `streamInfo` field contains raw SDP with RealMedia extensions. Key fields:

- `s=` — Session name
- `i=` — Session description
- `m=audio` / `m=video` — Media tracks
- `a=rtpmap:` — RTP payload mapping
- `a=control:` — Track control URL (relative or absolute)
- `a=mimetype:` — RealMedia MIME type
- `a=AvgBitRate:` / `a=MaxBitRate:` — Bitrate metadata

---

### `POST /api/realaudio/setup`

Performs RTSP session setup: `OPTIONS` → `DESCRIBE` → `SETUP` (first track). Returns server capabilities, SDP metadata, parsed tracks, and session ID.

**Request**

```json
{
  "host": "legacy.example.com",
  "port": 554,
  "path": "/video/testclip.rm",
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | **required** | Hostname or IP |
| `port` | number | `554` | RTSP port (standard RTSP port, not 7070) |
| `path` | string | `"/testclip.rm"` | Stream path |
| `timeout` | number | `10000` | Timeout in milliseconds |

**Response (success)**

```json
{
  "success": true,
  "serverBanner": "Helix Server Version 14.3.0.155",
  "methods": ["OPTIONS", "DESCRIBE", "SETUP", "PLAY", "PAUSE", "TEARDOWN"],
  "describeStatus": 200,
  "contentType": "application/sdp",
  "sdp": "v=0\r\no=- 1234567890 ...",
  "sessionId": "A3F2BC19",
  "tracks": [
    { "type": "audio", "codec": "x-pn-realaudio" },
    { "type": "video", "codec": "x-pn-realvideo" }
  ],
  "latencyMs": 421
}
```

| Field | Type | Notes |
|-------|------|-------|
| `success` | boolean | `true` if all steps succeeded |
| `serverBanner` | string | From `OPTIONS` response `Server:` header |
| `methods` | string[] | Parsed from `Public:` header (comma-separated list) |
| `describeStatus` | number | HTTP-style status code from `DESCRIBE` response |
| `contentType` | string | `Content-Type:` from `DESCRIBE` |
| `sdp` | string | Full SDP body |
| `sessionId` | string | Session ID from `SETUP` response `Session:` header |
| `tracks` | object[] | Parsed SDP media tracks with type and codec |
| `latencyMs` | number | Total elapsed time from connect to SETUP completion |

**Track parsing:** Each SDP `m=` line becomes a track object. Codec is extracted from `a=rtpmap:` if present, otherwise `"unknown"`.

**SETUP transport:** Always sends `Transport: RTP/AVP;unicast;client_port=6970-6971`. This is UDP-based RTP. Servers that only support TCP interleaved may reject this.

---

### `POST /api/realaudio/session`

Performs a complete RTSP session lifecycle: `OPTIONS` → `DESCRIBE` → `SETUP` → `PLAY` → collect interleaved RTP frames → `TEARDOWN`.

**Request**

```json
{
  "host": "legacy.example.com",
  "port": 554,
  "path": "/live/stream1.rm",
  "collectMs": 2000,
  "timeout": 15000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | **required** | Hostname or IP |
| `port` | number | `554` | RTSP port |
| `path` | string | `"/"` | Stream path |
| `collectMs` | number | `2000` | RTP frame collection window in ms (max 8000) |
| `timeout` | number | `15000` | Overall timeout in ms (max 30000) |

**Response (success)**

```json
{
  "success": true,
  "serverBanner": "Helix Server Version 14.3.0.155",
  "methods": ["OPTIONS", "DESCRIBE", "SETUP", "PLAY", "TEARDOWN"],
  "sessionId": "B7E9C201",
  "tracks": [
    { "type": "audio", "codec": "x-pn-realaudio" }
  ],
  "playStatus": 200,
  "rtpInfo": "url=rtsp://legacy.example.com/live/stream1.rm/trackID=1;seq=12345;rtptime=987654",
  "framesReceived": 42,
  "teardownStatus": 200,
  "latencyMs": 3127
}
```

| Field | Type | Notes |
|-------|------|-------|
| `success` | boolean | `true` if PLAY succeeded (200) OR if DESCRIBE succeeded (even if SETUP/PLAY failed) |
| `serverBanner` | string | Server identification from `OPTIONS` |
| `methods` | string[] | Supported methods from `Public:` header |
| `sessionId` | string | Session ID from `SETUP` response |
| `tracks` | object[] | Parsed SDP tracks |
| `playStatus` | number | Status code from `PLAY` response |
| `rtpInfo` | string | `RTP-Info:` header from `PLAY` — contains sequence number and RTP timestamp |
| `framesReceived` | number | Count of interleaved RTP/RTCP frames received during collection window |
| `teardownStatus` | number | Status code from `TEARDOWN` response |
| `latencyMs` | number | Total elapsed time from connect to TEARDOWN |

**SETUP transport:** Always uses `Transport: RTP/AVP/TCP;unicast;interleaved=0-1` for TCP-interleaved RTP. This allows frame collection on the same connection. Servers that only support UDP RTP will reject with `461 Unsupported Transport`.

**Frame collection:** After `PLAY` succeeds, the handler reads the socket for `collectMs` milliseconds and counts interleaved RTP frames. Each frame starts with:

```
'$' (0x24) + channel (1 byte) + length (2 bytes BE) + payload
```

Even-numbered channels (0, 2, …) are RTP; odd-numbered channels (1, 3, …) are RTCP.

**TEARDOWN:** Always sent after frame collection to cleanly terminate the session. Servers may close the connection even if TEARDOWN is not sent.

---

## RTSP Status Codes

| Code | Meaning | Common Cause |
|------|---------|--------------|
| 200 | OK | Request succeeded |
| 301 | Moved Permanently | Stream relocated |
| 302 | Moved Temporarily | Stream temporarily relocated |
| 401 | Unauthorized | Credentials required |
| 403 | Forbidden | Access denied |
| 404 | Not Found | Stream path does not exist |
| 451 | Parameter Not Understood | Invalid RTSP header |
| 452 | Conference Not Found | Multicast conference unavailable |
| 453 | Not Enough Bandwidth | Server QoS rejection |
| 454 | Session Not Found | Session ID invalid or expired |
| 455 | Method Not Valid in This State | e.g., PLAY before SETUP |
| 456 | Header Field Not Valid for Resource | Invalid header for this stream |
| 457 | Invalid Range | Time range not available |
| 458 | Parameter Is Read-Only | Cannot modify parameter |
| 459 | Aggregate Operation Not Allowed | Cannot control aggregate URL |
| 460 | Only Aggregate Operation Allowed | Must use aggregate URL |
| 461 | Unsupported Transport | Server rejects transport (e.g., TCP interleaved not supported) |
| 462 | Destination Unreachable | Multicast destination unreachable |
| 500 | Internal Server Error | Server bug |
| 501 | Not Implemented | Method not supported |
| 503 | Service Unavailable | Server overloaded |
| 505 | RTSP Version Not Supported | Client uses RTSP/2.0, server only supports RTSP/1.0 |

---

## Authentication

RealMedia servers often use **HTTP Basic** or **Digest** authentication. The current implementation sends client headers but does **not** handle `401 Unauthorized` challenges.

### Basic Auth (not implemented)

To add Basic auth, include this header in RTSP requests:

```
Authorization: Basic <base64(username:password)>
```

### Digest Auth (not implemented)

Many Helix servers use Digest MD5 (RFC 2617). On `401` with `WWW-Authenticate: Digest realm="..." nonce="..."`, compute:

```
HA1 = MD5(username:realm:password)
HA2 = MD5(method:uri)
response = MD5(HA1:nonce:HA2)
```

Then retry with:

```
Authorization: Digest username="...", realm="...", nonce="...", uri="...", response="..."
```

The implementation does **not** parse `WWW-Authenticate` or retry with credentials. All endpoints return `success: false` with the `401` status.

---

## Known Limitations

1. **No authentication** — Basic and Digest auth not implemented. All 401 responses are returned as-is.

2. **TCP interleaved only in `/session`** — The `/session` endpoint uses `Transport: RTP/AVP/TCP;unicast;interleaved=0-1`. Servers that only support UDP RTP will reject with `461 Unsupported Transport`.

3. **UDP RTP in `/setup`** — The `/setup` endpoint uses `Transport: RTP/AVP;unicast;client_port=6970-6971` (UDP). Media frames are not collected because they arrive on separate UDP sockets, which Cloudflare Workers cannot receive.

4. **No multicast** — All endpoints use `unicast`. Multicast RTP (common for legacy broadcast applications) is not supported.

5. **First track only** — `/setup` and `/session` send `SETUP` for the first track in the SDP (`trackID=1` or `streamid=0`). Multi-track SDP (audio + video) is not fully handled. Only the first media line is set up.

6. **Fixed collection window** — `/session` collects RTP frames for `collectMs` milliseconds (default 2000, max 8000). Not adaptive to network conditions.

7. **No PAUSE/RESUME** — The `/session` endpoint goes straight from PLAY to TEARDOWN. No pause capability.

8. **No ANNOUNCE/RECORD** — All endpoints are receive-only. Cannot push a stream to a RealMedia server.

9. **CSeq hardcoded** — `/probe` and `/describe` use `CSeq: 1` and `CSeq: 2`. `/setup` and `/session` increment CSeq correctly across multiple requests.

10. **Content-Length limit** — Response body parsing enforces a 1 MB limit on `Content-Length` to prevent memory exhaustion. Servers advertising `Content-Length` > 1 MB will trigger an error.

11. **Frame count accuracy** — The interleaved frame parser in `/session` may overcount if payload bytes contain the `0x24` marker byte. A proper parser would track frame boundaries strictly.

---

## SDP Field Reference

RealMedia SDP follows RFC 2327 with proprietary extensions:

| SDP Line | Meaning | Example |
|----------|---------|---------|
| `v=` | Version (always 0) | `v=0` |
| `o=` | Origin (username, session ID, version, net type, addr type, address) | `o=- 1234567890 1 IN IP4 10.0.1.5` |
| `s=` | Session name | `s=Sample RealAudio Stream` |
| `i=` | Session description | `i=RealAudio 10 codec` |
| `c=` | Connection data (net type, addr type, address) | `c=IN IP4 0.0.0.0` |
| `t=` | Timing (start/stop NTP timestamps, 0 0 = unbounded) | `t=0 0` |
| `a=control:` | Control URL (session-level or track-level) | `a=control:*` or `a=control:streamid=0` |
| `a=range:` | Temporal range for VoD | `a=range:npt=0-123.45` |
| `m=` | Media description (type, port, transport, format) | `m=audio 0 RTP/AVP 101` |
| `a=rtpmap:` | RTP payload type mapping | `a=rtpmap:101 x-pn-realaudio/44100` |
| `a=fmtp:` | Format parameters (not parsed) | `a=fmtp:101 mode=robust-sorting` |
| `a=mimetype:` | RealMedia MIME type | `a=mimetype:string;"audio/x-pn-realaudio"` |
| `a=AvgBitRate:` | Average bitrate in bps | `a=AvgBitRate:integer;128000` |
| `a=MaxBitRate:` | Maximum bitrate in bps | `a=MaxBitRate:integer;160000` |
| `a=StreamName:` | Stream name | `a=StreamName:string;"Main Audio"` |

**Control URL resolution:**
- Session-level `a=control:*` means the base URL from `DESCRIBE` is used.
- Track-level `a=control:streamid=0` or `a=control:trackID=1` is appended to the base URL (or `Content-Base:` header).
- Absolute URLs like `a=control:rtsp://server/track1` are used as-is.

---

## curl Examples

```bash
# Probe for RealMedia server presence
curl -s -X POST https://portofcall.ross.gg/api/realaudio/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"legacy.example.com","port":7070}' | jq .

# Get stream SDP metadata
curl -s -X POST https://portofcall.ross.gg/api/realaudio/describe \
  -H 'Content-Type: application/json' \
  -d '{"host":"legacy.example.com","port":7070,"streamPath":"/audio/sample.rm"}' | jq .

# Perform RTSP session setup (OPTIONS → DESCRIBE → SETUP)
curl -s -X POST https://portofcall.ross.gg/api/realaudio/setup \
  -H 'Content-Type: application/json' \
  -d '{"host":"legacy.example.com","port":554,"path":"/video/testclip.rm"}' | jq .

# Full session with RTP frame collection (OPTIONS → DESCRIBE → SETUP → PLAY → collect → TEARDOWN)
curl -s -X POST https://portofcall.ross.gg/api/realaudio/session \
  -H 'Content-Type: application/json' \
  -d '{"host":"legacy.example.com","port":554,"path":"/live/stream1.rm","collectMs":3000}' | jq .

# Session with long timeout for slow servers
curl -s -X POST https://portofcall.ross.gg/api/realaudio/session \
  -H 'Content-Type: application/json' \
  -d '{"host":"legacy.example.com","port":554,"path":"/archive/recording.rm","timeout":25000}' | jq .
```

---

## Local Testing

### Helix Server

Helix Server is the official RealNetworks RTSP server. It's no longer actively developed but still available.

1. Download Helix Server from RealNetworks (requires registration)
2. Install and configure `.rm` files in the media directory
3. Start the server:
   ```bash
   /opt/helix/server/bin/rmserver start
   ```
4. Test:
   ```bash
   curl -s -X POST https://portofcall.ross.gg/api/realaudio/probe \
     -d '{"host":"YOUR_PUBLIC_IP","port":7070}' | jq .
   ```

### VLC as RTSP Server

VLC can serve RealMedia files over RTSP (though it won't send RealMedia-specific headers):

```bash
vlc --intf dummy --sout '#rtp{sdp=rtsp://:8554/stream.rm}' /path/to/file.rm
```

Test:
```bash
curl -s -X POST https://portofcall.ross.gg/api/realaudio/describe \
  -d '{"host":"YOUR_PUBLIC_IP","port":8554,"streamPath":"/stream.rm"}' | jq .
```

### FFmpeg RTSP Server

FFmpeg can transcode and serve over RTSP:

```bash
ffmpeg -re -i input.rm -c copy -f rtsp rtsp://localhost:8554/test
```

Note: FFmpeg does not support RealMedia codecs natively. You'll need to transcode to H.264/AAC first.

---

## Connection Flow

### Basic Probe Flow

```
Client → Server:  OPTIONS rtsp://server:7070/ RTSP/1.0
                  CSeq: 1
                  User-Agent: RealMedia Player Version 6.0.9.1235
                  ClientID: Linux_2.4_6.0.9.1235_play32_RN01_EN_586

Server → Client:  RTSP/1.0 200 OK
                  CSeq: 1
                  Server: Helix Server Version 14.3.0.155
                  Public: OPTIONS, DESCRIBE, SETUP, PLAY, PAUSE, TEARDOWN
```

### Full Session Flow

```
1. OPTIONS * → 200 OK (get capabilities)
2. DESCRIBE rtsp://server/stream.rm → 200 OK + SDP (get tracks)
3. SETUP rtsp://server/stream.rm/trackID=1 → 200 OK + Session ID
4. PLAY rtsp://server/stream.rm → 200 OK (start streaming)
   ↓
   [RTP interleaved frames on TCP connection]
   ↓
5. TEARDOWN rtsp://server/stream.rm → 200 OK (end session)
```

### Interleaved RTP Frame Format

After PLAY, RTP/RTCP frames are multiplexed on the TCP connection:

```
┌──────┬─────────┬─────────────────┬──────────────┐
│ '$'  │ Channel │ Length (16-bit) │ Payload      │
│ 0x24 │ 1 byte  │ big-endian      │ Length bytes │
└──────┴─────────┴─────────────────┴──────────────┘
```

- **Channel 0:** RTP for track 1
- **Channel 1:** RTCP for track 1
- **Channel 2:** RTP for track 2 (if multi-track)
- **Channel 3:** RTCP for track 2

The `/session` endpoint counts these frames by parsing the `$` marker and 2-byte length field.

---

## Use Cases

1. **Legacy server inventory** — Detect ancient RealMedia servers still running in enterprise networks.
2. **Network archaeology** — Identify forgotten streaming infrastructure from the dot-com era.
3. **Historical protocol research** — Study RealNetworks' proprietary extensions to RTSP.
4. **Migration planning** — Audit RealMedia content before migrating to modern formats.
5. **Digital preservation** — Archive RealAudio/RealVideo streams for historical records.

---

## Modern Alternatives

| Protocol | Use Case | Notes |
|----------|----------|-------|
| **HLS** | HTTP Live Streaming | Apple standard, browser-native |
| **MPEG-DASH** | Dynamic Adaptive Streaming | ISO standard, adaptive bitrate |
| **WebRTC** | Real-time communication | Peer-to-peer, low latency |
| **RTSP with H.264** | IP cameras, DVRs | Modern RTSP still used in surveillance |
| **RTMP** | Live streaming ingest | Adobe Flash legacy, still used by CDNs |
| **SRT** | Low-latency streaming | Secure Reliable Transport |

---

## RealMedia Codec Reference

### Audio Codecs

| Codec | RTP Type | Description |
|-------|----------|-------------|
| `x-pn-realaudio` | 101+ | RealAudio 1.0 - 10.0 (proprietary) |
| `PCMA` | 8 | G.711 A-law (fallback) |
| `PCMU` | 0 | G.711 μ-law (fallback) |

### Video Codecs

| Codec | RTP Type | Description |
|-------|----------|-------------|
| `x-pn-realvideo` | 96+ | RealVideo 7-10 (proprietary) |
| `H263-1998` | 34 | H.263 (fallback) |

RealMedia uses proprietary codecs (RealAudio G2, RealVideo 10, etc.) that are not compatible with modern players. Transcoding is required for migration.

---

## Troubleshooting

### `success: false, error: "Connection timeout"`

- **Cause:** Server not reachable, firewall blocking port 7070/554, or server down.
- **Fix:** Check firewall rules, verify server is running, use `nmap` to scan ports.

### `success: false, error: "RTSP 401 Unauthorized"`

- **Cause:** Server requires authentication. The implementation does not send credentials.
- **Fix:** Authentication not implemented. You'll need to extend the code to add `Authorization:` headers.

### `success: false, error: "RTSP 404 Not Found"`

- **Cause:** Stream path does not exist on the server.
- **Fix:** Verify the `streamPath` parameter matches a configured stream on the server.

### `success: false, error: "RTSP 461 Unsupported Transport"`

- **Cause:** Server does not support the requested transport (UDP RTP or TCP interleaved).
- **Fix:** Use `/setup` for UDP or `/session` for TCP. Some servers only support one mode.

### `framesReceived: 0` in `/session`

- **Cause:** Server is not sending RTP frames, or frames arrive after the collection window closes.
- **Fix:** Increase `collectMs` parameter. Check server logs for errors.

### `isRealServer: false`

- **Cause:** Server does not identify as Helix/RealServer in the `Server:` header.
- **Fix:** This is informational. Non-RealNetworks RTSP servers (like VLC or FFmpeg) will show `false`.

### `Invalid RTSP response format`

- **Cause:** Server sent malformed RTSP response or non-RTSP data.
- **Fix:** Use `telnet` or `nc` to manually send an OPTIONS request and inspect the raw response.

---

## Security Considerations

1. **Plaintext credentials** — Basic auth sends username:password in base64 (easily decoded). Use RTSPS (RTSP over TLS) for secure authentication.

2. **No encryption** — RTP media is sent in cleartext. Anyone on the network can intercept and decode the stream.

3. **Buffer overflows** — The implementation enforces a 1 MB limit on `Content-Length` to prevent memory exhaustion. Malicious servers advertising huge Content-Length values are rejected.

4. **Denial of service** — A server can stall connections by never sending a complete response. The `timeout` parameter mitigates this, but long-lived connections can exhaust Worker CPU time.

5. **No input sanitization** — The `host` and `streamPath` parameters are not sanitized. Malicious input could cause RTSP request injection if used in a different context. The current implementation is safe because it only builds RTSP requests, not shell commands.

---

## Historical Context

### Timeline

- **1995:** Progressive Networks founded, launches RealAudio 1.0
- **1997:** RealAudio 2.0 and RealVideo released
- **1999:** RealPlayer 7 introduces RealSystem G2 (RDT protocol)
- **2001:** RealOne Player replaces RealPlayer, integrates media store
- **2003:** Helix Community Project open-sources Helix DNA codebase
- **2005:** Flash Video and Windows Media dominate; RealPlayer declines
- **2008:** HTML5 `<video>` tag introduced; streaming shifts to HTTP
- **2018:** RealNetworks discontinues RealPlayer

### Why RealMedia Failed

1. **Proprietary codecs** — Locked users into RealPlayer; no browser support
2. **Aggressive monetization** — Ads, subscription upsells, bloatware
3. **Security issues** — RealPlayer had multiple CVEs and vulnerabilities
4. **Complexity** — RTSP + RDT + PNA was harder to deploy than HTTP-based streaming
5. **Flash dominance** — Adobe Flash became the de facto standard for web video

### Legacy Systems Still Using RealMedia

- **Enterprise training portals** — Archived training videos from the 2000s
- **Government archives** — Historical broadcasts stored in .rm format
- **Educational institutions** — Lecture recordings never migrated
- **Religious organizations** — Sermon archives from the early web
- **Research labs** — Scientific presentations and conference recordings

---

## References

- **RFC 2326:** Real Time Streaming Protocol (RTSP)
  https://www.rfc-editor.org/rfc/rfc2326

- **RFC 2327:** SDP: Session Description Protocol
  https://www.rfc-editor.org/rfc/rfc2327

- **RFC 3550:** RTP: A Transport Protocol for Real-Time Applications
  https://www.rfc-editor.org/rfc/rfc3550

- **RealNetworks Helix DNA Documentation** (archived)
  https://web.archive.org/web/20080516011423/http://docs.helixcommunity.org/

- **RealMedia File Format Specification** (community reverse-engineering)
  https://wiki.multimedia.cx/index.php/RealMedia

---

## Bugs Fixed (2026-02-18)

### Critical

1. **RESOURCE LEAK:** Socket not closed on timeout in `handleRealAudioProbe` and `handleRealAudioDescribe` — added `socket.close()` in timeout catch path.

2. **DATA CORRUPTION:** TextDecoder could fail on partial multi-byte UTF-8 sequences when response chunks split characters — switched to accumulating Uint8Array chunks and decoding once complete.

3. **PROTOCOL VIOLATION:** Missing required RealMedia client headers (`ClientID`, `PlayerStarttime`, `CompanyID`, `GUID`) — added full RealPlayer 6.0.9 client identification to OPTIONS and DESCRIBE requests.

4. **BUG:** Reader/writer locks not released on timeout in `handleRealAudioSetup` and `handleRealAudioSession` — wrapped lock releases in try-catch to prevent lock leak on error.

5. **BUG:** Frame counting logic in `/session` counted every byte matching 0x24, not actual frames — rewrote to parse interleaved frame headers (marker + channel + length) correctly.

### Medium

6. **INPUT VALIDATION:** Content-Length not validated before body extraction — added range check (0 to 1 MB) to prevent memory exhaustion.

7. **PARSING:** CSeq and Content-Length header parsing didn't validate integer conversion — added isNaN checks to prevent undefined values.

---

## Performance Notes

- **Cloudflare Workers CPU limit:** Each Worker request has a 50 ms CPU time limit (can burst to 500 ms). Long RTSP sessions with large SDP or many RTP frames may approach this limit.

- **Memory usage:** Interleaved frame collection allocates a 65 KB accumulator. Multiple concurrent `/session` requests can consume significant memory.

- **Network I/O:** RTSP over TCP has lower latency than UDP RTP but higher overhead. For legacy servers on slow links, increase the `timeout` parameter.

- **Caching:** There is no caching of RTSP responses. Each request re-establishes the connection and re-sends all RTSP commands.

---

**End of Documentation**
