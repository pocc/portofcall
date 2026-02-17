# RTSP — Real Time Streaming Protocol

**Port:** 554 (standard), 8554 (alternative)
**Transport:** TCP (signaling); RTP/RTCP media over TCP interleaved or UDP
**RFCs:** 2326 (RTSP 1.0), 7826 (RTSP 2.0), 2327 (SDP), 3550 (RTP)
**Implementation:** `src/worker/rtsp.ts`
**Routes:** `/api/rtsp/options`, `/api/rtsp/describe`, `/api/rtsp/session`

---

## Endpoints

### `POST /api/rtsp/options`

Sends a single `OPTIONS` request and returns the server's advertised method list.

**Request**

```json
{
  "host":     "192.168.1.100",    // required
  "port":     554,                 // default 554
  "path":     "/stream",          // default "/"
  "timeout":  10000,              // ms, default 10000
  "username": "admin",            // optional, Basic auth
  "password": "pass"              // optional, Basic auth
}
```

**Response (success)**

```json
{
  "success":      true,
  "host":         "192.168.1.100",
  "port":         554,
  "path":         "/stream",
  "rtt":          142,
  "statusCode":   200,
  "statusText":   "OK",
  "methods":      ["OPTIONS", "DESCRIBE", "SETUP", "PLAY", "TEARDOWN"],
  "serverHeader": "DSS/6.0.3 (Build/526.3)",
  "rawResponse":  "RTSP/1.0 200 OK\r\nCSeq: 1\r\n..."
}
```

| Field | Notes |
|-------|-------|
| `methods` | Parsed from the `Public:` response header, split on `,`. Empty array if header absent. |
| `serverHeader` | From the `Server:` response header; `"Unknown"` if absent. |
| `rawResponse` | Raw RTSP response text, **truncated at 2000 characters**. |
| `rtt` | Round-trip time in ms from connect to response received. |

The wire request always uses `CSeq: 1`. A 401 Unauthorized with `WWW-Authenticate: Digest ...` will appear in `statusCode: 401` — no Digest retry is attempted.

---

### `POST /api/rtsp/describe`

Sends `DESCRIBE` with `Accept: application/sdp` and parses the SDP response body.

**Request**

```json
{
  "host":     "192.168.1.100",
  "port":     554,
  "path":     "/stream1",
  "timeout":  10000,
  "username": "admin",
  "password": "pass"
}
```

**Response (success)**

```json
{
  "success":     true,
  "host":        "192.168.1.100",
  "port":        554,
  "path":        "/stream1",
  "statusCode":  200,
  "statusText":  "OK",
  "contentType": "application/sdp",
  "serverHeader": "Hikvision-Webs",
  "sdpInfo": {
    "sessionName": "Session streamed by Hikvision",
    "sessionInfo": "stream1",
    "mediaTypes":  "video 0 RTP/AVP 26, audio 0 RTP/AVP 8",
    "controlUrl":  "rtsp://192.168.1.100/stream1/",
    "codecs":      "26 JPEG/90000, 8 PCMA/8000"
  },
  "sdpRaw": "v=0\r\no=- 1234 1234 IN IP4 192.168.1.100\r\n..."
}
```

| Field | Notes |
|-------|-------|
| `sdpInfo.sessionName` | From first `s=` SDP line. |
| `sdpInfo.sessionInfo` | From first `i=` SDP line. |
| `sdpInfo.mediaTypes` | All `m=` lines concatenated with `", "`. |
| `sdpInfo.controlUrl` | **Last** `a=control:` line wins — for multi-track SDP only the final track's URL is kept. See limitation below. |
| `sdpInfo.codecs` | All `a=rtpmap:` lines concatenated with `", "`. |
| `sdpRaw` | Full SDP body, **truncated at 4000 characters**. |

**No `rtt` field** is returned by this endpoint (unlike `/options`).

**SDP `controlUrl` clobber:** The parser iterates all SDP lines linearly; each `a=control:` overwrites the previous value. For a session-level `a=control:*` followed by media-level `a=control:trackID=0` and `a=control:trackID=1`, `controlUrl` ends up as `"trackID=1"`. Use `sdpRaw` to extract all track URLs yourself.

---

### `POST /api/rtsp/session`

Performs the full RTSP session lifecycle: OPTIONS → DESCRIBE → SETUP → PLAY → 500 ms RTP collection → TEARDOWN.

**Request**

```json
{
  "host":        "192.168.1.100",
  "port":        554,
  "path":        "/live/main",
  "url":         "rtsp://192.168.1.100:554/live/main",  // explicit URL overrides host+port+path
  "username":    "admin",
  "password":    "pass",
  "timeout_ms":  15000
}
```

Note: this endpoint uses **`timeout_ms`** (not `timeout` like the other two endpoints).

**Response (success)**

```json
{
  "success":          true,
  "host":             "192.168.1.100",
  "port":             554,
  "url":              "rtsp://192.168.1.100:554/live/main",
  "rtt":              3241,
  "sessionId":        "BC3047A2",
  "sessionEstablished": true,
  "steps": [
    "OPTIONS: 200 OK",
    "DESCRIBE: 200 OK",
    "SETUP: 200 OK",
    "PLAY: 200 OK",
    "RTP collection: 12 packets, 18432 bytes",
    "TEARDOWN: 200 OK"
  ],
  "methods":       ["OPTIONS", "DESCRIBE", "SETUP", "PLAY", "TEARDOWN"],
  "rtpFrames":     12,
  "rtpBytes":      18432,
  "rtcpPackets":   2,
  "trackUrl":      "rtsp://192.168.1.100:554/live/main/trackID=0",
  "sdpSummary":    "v=0\r\no=...",
  "serverHeader":  "RTSP Server",
  "message":       "RTSP session established. Received 12 RTP/RTCP packet(s) in 500ms."
}
```

| Field | Notes |
|-------|-------|
| `success` | `true` if PLAY succeeded OR if DESCRIBE succeeded (even if SETUP/PLAY failed). See limitation below. |
| `sessionEstablished` | `true` only if PLAY returned 2xx. Useful for distinguishing "stream info available" from "stream active". |
| `steps` | Ordered list of `"METHOD: STATUS TEXT"` entries. Aborted steps are absent. |
| `methods` | From OPTIONS `Public:` header (only if OPTIONS succeeded). |
| `rtpFrames` | Number of interleaved RTP+RTCP packets received in the 500 ms window. |
| `rtcpPackets` | Count of frames on odd channels (channels 1, 3, …) — RTCP by convention. |
| `rtpBytes` | Total payload bytes across all interleaved frames. |
| `trackUrl` | First track's resolved control URL used for SETUP. |
| `sdpSummary` | SDP body **truncated at 1000 characters**. |
| `rtt` | Total elapsed time from connect to TEARDOWN. |

**SETUP transport:** Always sends `Transport: RTP/AVP/TCP;unicast;interleaved=0-1`. There is no UDP option. Servers that only support RTP/UDP will reject this SETUP.

**Per-step timeout:** Each RTSP method call inside the session uses a **hardcoded 5000 ms** timeout, independent of `timeout_ms`. If any step stalls for 5 s, it throws and the session aborts.

**RTP collection window:** Fixed at **500 ms** after PLAY. Not configurable.

**Session field parsing:** `Session:` header value is split on `;` and the first token taken. This correctly handles `Session: BC3047A2;timeout=60`.

---

## Authentication

Only **HTTP Basic auth** is implemented. The `Authorization` header is:

```
Authorization: Basic <base64(username:password)>
```

The base64 is computed with `btoa()`, which is Latin-1 only. Usernames or passwords containing non-Latin-1 characters will produce a broken credential silently.

### Digest auth is not supported

Most IP cameras and DVRs use **Digest MD5** authentication (RFC 2069 / 2617). When a server responds with `401 WWW-Authenticate: Digest realm="..." nonce="..."`, the implementation does not:

- Parse the `WWW-Authenticate` header
- Compute the Digest HA1/HA2/response
- Retry with `Authorization: Digest ...`

The 401 is returned as-is. If your camera requires Digest auth and Basic is not enabled, all three endpoints will return `statusCode: 401` with `success: false`.

---

## SDP Field Reference

SDP lines extracted by `/describe` and available raw in all endpoints:

| SDP line | Meaning |
|----------|---------|
| `v=0` | Version (always 0) |
| `o=` | Origin: username, session ID, version, network type, addr type, address |
| `s=` | Session name (→ `sdpInfo.sessionName`) |
| `i=` | Session description (→ `sdpInfo.sessionInfo`) |
| `c=` | Connection data (network type, addr type, multicast addr) |
| `t=` | Timing: start/stop NTP timestamps (0 0 = no fixed time) |
| `m=` | Media description: type port proto payload-type (→ `sdpInfo.mediaTypes`) |
| `a=control:` | Track control URL for SETUP (→ `sdpInfo.controlUrl`, last value wins) |
| `a=rtpmap:` | Payload type encoding: `PT codec/clock-rate[/channels]` (→ `sdpInfo.codecs`) |
| `a=fmtp:` | Format parameters (H.264 SPS/PPS in base64, etc.) — **not parsed** |
| `a=framerate:` | Nominal frame rate — **not parsed** |
| `a=range:` | Presentation time range (VoD scrubbing) — **not parsed** |

---

## Known Limitations

1. **Basic auth only** — Digest MD5 (the camera default) is not implemented. All three endpoints are affected.

2. **TCP interleaved only** — SETUP sends `Transport: RTP/AVP/TCP;unicast;interleaved=0-1`. Many cameras and servers default to RTP/UDP and may not support interleaved TCP. SETUP will get a 461 (Unsupported Transport) or 400 in that case.

3. **`controlUrl` clobber** — `/describe` keeps only the **last** `a=control:` line. Multi-track SDP (video + audio) exposes only the last track's URL. Parse `sdpRaw` manually for all tracks.

4. **Fixed 500 ms RTP window** — not configurable via request body. On a slow or lossy path you may receive 0 packets even from a working camera.

5. **Hardcoded 5 s per-step timeout in `/session`** — if the camera is slow to respond to any individual RTSP method (OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN), the session aborts at that step regardless of `timeout_ms`.

6. **`success: true` even without PLAY** — if DESCRIBE returns 2xx but SETUP or PLAY fail, `success` is still `true`. Check `sessionEstablished` to confirm the stream was actually started.

7. **`timeout_ms` vs `timeout`** — `/session` uses `timeout_ms`; `/options` and `/describe` use `timeout`. Using the wrong field name silently falls back to the default (15 s for session, 10 s for the others).

8. **No ANNOUNCE/RECORD** — the `/session` endpoint is receive-only. There is no endpoint to push a stream to an RTSP server.

9. **No PAUSE** — no endpoint or session-level command to pause mid-stream.

10. **No `rtt` from `/describe`** — the describe handler calculates no timing; only `/options` and `/session` return `rtt`.

---

## RTSP Status Codes

| Code | Meaning | Common cause |
|------|---------|-------------|
| 200 | OK | Request succeeded |
| 401 | Unauthorized | Credentials required or wrong; Digest not retried |
| 403 | Forbidden | Auth ok but resource not accessible |
| 404 | Not Found | Stream path does not exist |
| 454 | Session Not Found | Session ID expired or invalid |
| 455 | Method Not Valid in This State | e.g. PLAY before SETUP |
| 461 | Unsupported Transport | Server doesn't support TCP interleaved |
| 503 | Service Unavailable | Server busy or at capacity |

---

## curl Examples

```bash
# OPTIONS — discover server capabilities
curl -s -X POST https://portofcall.ross.gg/api/rtsp/options \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","port":554}' | jq .

# DESCRIBE — get stream SDP
curl -s -X POST https://portofcall.ross.gg/api/rtsp/describe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","path":"/stream1","username":"admin","password":"12345"}' | jq .

# Full session — OPTIONS→DESCRIBE→SETUP→PLAY→collect RTP→TEARDOWN
curl -s -X POST https://portofcall.ross.gg/api/rtsp/session \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","path":"/live/main","username":"admin","password":"12345","timeout_ms":20000}' | jq .

# Session with explicit URL (overrides host+port+path)
curl -s -X POST https://portofcall.ross.gg/api/rtsp/session \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","url":"rtsp://192.168.1.100:8554/live/ch0","timeout_ms":20000}' | jq .
```

---

## Typical Camera Flow (Hikvision / Dahua / Axis)

Most IP cameras follow this SDP pattern:

```
v=0
o=- 1234 1 IN IP4 192.168.1.100
s=Session streamed by camera
i=stream1
t=0 0
a=tool:LIVE555 Streaming Media
m=video 0 RTP/AVP 96
a=control:trackID=0
a=rtpmap:96 H264/90000
a=fmtp:96 profile-level-id=4D0029; sprop-parameter-sets=Z0KA...
m=audio 0 RTP/AVP 8
a=control:trackID=1
a=rtpmap:8 PCMA/8000
```

The `/session` endpoint uses `trackID=1` as `trackUrl` (last `a=control:` wins), so it will SETUP the **audio** track, not video. Use the `/describe` endpoint to read `sdpRaw` and select the correct track URL yourself.

---

## Local Testing

```bash
# VLC as RTSP server (streams a local file)
vlc --intf dummy --sout '#rtp{sdp=rtsp://:8554/test}' /path/to/video.mp4

# Test against it
curl -s -X POST https://portofcall.ross.gg/api/rtsp/options \
  -d '{"host":"YOUR_PUBLIC_IP","port":8554,"path":"/test"}' | jq .methods

# live555 MediaServer (streams files from ./mediaDir/)
live555MediaServer
```

FFmpeg can also act as a sender:
```bash
ffmpeg -re -i video.mp4 -c copy -f rtsp rtsp://localhost:8554/test
```
