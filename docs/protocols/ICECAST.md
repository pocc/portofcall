# Icecast Streaming Server -- Power User Reference

**Port:** 8000 (default) | **Protocol:** HTTP/1.0 + HTTP/1.1 | **Transport:** TCP

Port of Call provides three Icecast endpoints: a public status probe, an authenticated admin stats query, and a SOURCE mount test. All three open a direct TCP connection from the Cloudflare Worker to the target Icecast server.

---

## Protocol Overview

Icecast is an open-source streaming media server (originally by Xiph.org) that supports Ogg Vorbis, MP3, Opus, FLAC, AAC+, Theora video, and WebM. It operates entirely over HTTP with a few non-standard extensions.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Mount point** | A named stream endpoint (e.g. `/stream`, `/live.mp3`). Each mount carries one audio source. |
| **Source** | An encoder (Liquidsoap, butt, Mixxx, etc.) that pushes audio to a mount via the `SOURCE` HTTP method. |
| **Listener** | A client that receives the audio stream via standard HTTP `GET` on the mount. |
| **Fallback** | When a source disconnects, Icecast can redirect listeners to a fallback mount. |
| **icy-metaint** | ICY metadata interval: the number of audio bytes between inline metadata blocks in the stream. |

### Port Conventions

| Port | Usage |
|------|-------|
| 8000 | Icecast default |
| 8080 | Common alternative |
| 8443 | HTTPS variant (with reverse proxy) |
| 80/443 | Behind a reverse proxy |

---

## API Endpoints

### `POST /api/icecast/status` -- Public Status Probe

Connects to the target server, sends `GET /status-json.xsl HTTP/1.1`, and parses the JSON response into structured mount point data. No authentication required.

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | -- | Required. Hostname or IP of the Icecast server. |
| `port` | number | `8000` | TCP port. |
| `timeout` | number | `10000` | Total timeout in ms. |

**Success response (200):**

```json
{
  "success": true,
  "host": "radio.example.com",
  "port": 8000,
  "rtt": 85,
  "httpStatus": 200,
  "server": "Icecast 2.4.4",
  "isIcecast": true,
  "serverInfo": {
    "admin": "admin@example.com",
    "host": "radio.example.com",
    "location": "Earth",
    "serverId": "Icecast 2.4.4",
    "serverStart": "2024-01-15T10:30:00+0000"
  },
  "mountPoints": [
    {
      "name": "http://radio.example.com:8000/stream",
      "listeners": 15,
      "peakListeners": 42,
      "genre": "Various",
      "title": "Current Song - Artist",
      "description": "My Radio Station",
      "contentType": "audio/mpeg",
      "bitrate": 128,
      "samplerate": 44100,
      "channels": 2,
      "serverUrl": "http://myradio.com"
    }
  ],
  "totalListeners": 15,
  "mountCount": 1,
  "protocol": "Icecast",
  "message": "Icecast server responded in 85ms - 1 mount(s), 15 listener(s)"
}
```

**Error responses:**

| HTTP | Condition | Body |
|------|-----------|------|
| 400 | Missing host or invalid port | `{ "success": false, "error": "..." }` |
| 403 | Cloudflare-proxied host | `{ "success": false, "error": "...", "isCloudflare": true }` |
| 502 | No valid HTTP response | `{ "success": false, "error": "No valid HTTP response received..." }` |
| 200 | Non-200 HTTP status from server | `{ "success": false, "host": "...", "httpStatus": 404, ... }` |

**Notes:**

- The `isIcecast` field is `true` only if the `Server` response header contains "Icecast". Shoutcast, Liquidsoap, and custom servers return `false` even if they serve the same JSON format.
- Icecast serializes `source` as a single object (not an array) when there is exactly one mount. The parser handles both cases.
- Response is capped at 64 KB.
- Chunked transfer encoding is decoded transparently.

---

### `POST /api/icecast/source` -- Source Mount Test

Authenticates a SOURCE connection and optionally sends a brief burst of silence bytes, then disconnects. Useful for verifying source passwords and mount point availability.

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | -- | Required. |
| `port` | number | `8000` | |
| `mountpoint` | string | `/stream` | Leading `/` added if missing. |
| `password` | string | -- | Required. The source password from `icecast.xml`. |
| `contentType` | string | `audio/mpeg` | MIME type for the stream. |
| `streamName` | string | `Port of Call Test Stream` | Value of `ice-name` header. |
| `description` | string | `Test mount by Port of Call` | Value of `ice-description` header. |
| `burstBytes` | number | `32` | Bytes of silence to send (max 1024). |
| `timeout` | number | `10000` | Total timeout in ms (max 30000). |

**Success response:**

```json
{
  "success": true,
  "host": "radio.example.com",
  "port": 8000,
  "mountpoint": "/stream",
  "latencyMs": 120,
  "serverResponse": "HTTP/1.0 200 OK",
  "bytesSent": 32,
  "contentType": "audio/mpeg",
  "streamName": "Port of Call Test Stream"
}
```

**Auth failure:**

```json
{
  "success": false,
  "host": "radio.example.com",
  "port": 8000,
  "mountpoint": "/stream",
  "latencyMs": 95,
  "serverResponse": "HTTP/1.0 401 Unauthorized",
  "error": "Authentication failed -- check source password"
}
```

**Wire protocol details:**

The SOURCE method is not part of standard HTTP. Icecast extends HTTP/1.0 with this custom method:

```
SOURCE /stream HTTP/1.0\r\n
Authorization: Basic c291cmNlOmhhY2ttZQ==\r\n
Content-Type: audio/mpeg\r\n
ice-name: My Stream\r\n
ice-description: Test\r\n
ice-public: 0\r\n
User-Agent: PortOfCall/1.0\r\n
\r\n
[continuous audio bytes until disconnect]
```

- The username is always `source`. The password is the source password.
- `HTTP/1.0` is mandatory. The SOURCE protocol does not use HTTP/1.1 features (no chunked encoding, no keep-alive).
- After the server responds with `HTTP/1.0 200 OK`, the client writes raw audio bytes directly. There is no framing.
- SHOUTcast v1 DNAS may respond with a bare `OK2\r\n` instead of a full HTTP response. Both are accepted.

---

### `POST /api/icecast/admin` -- Admin Stats

Queries the `/admin/stats` endpoint with HTTP Basic Auth. Returns raw XML (Icecast does not serve admin stats as JSON).

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | -- | Required. |
| `port` | number | `8000` | |
| `username` | string | `admin` | Admin username from `icecast.xml`. |
| `password` | string | -- | Required. Admin password. |
| `timeout` | number | `10000` | Total timeout in ms. |

**Success response:**

```json
{
  "success": true,
  "host": "radio.example.com",
  "port": 8000,
  "rtt": 90,
  "httpStatus": 200,
  "server": "Icecast 2.4.4",
  "contentType": "text/xml",
  "adminStats": "<?xml version=\"1.0\"?>...",
  "protocol": "Icecast Admin",
  "message": "Admin stats retrieved in 90ms"
}
```

The `adminStats` field contains raw XML, capped at 8 KB.

**Auth failure (200 with success=false):**

```json
{
  "success": false,
  "rtt": 55,
  "server": "Icecast 2.4.4",
  "error": "Authentication failed - check admin credentials"
}
```

---

## Icecast Protocol Specification

### HTTP Endpoints (Server-Side)

| Endpoint | Method | Auth | Format | Description |
|----------|--------|------|--------|-------------|
| `/status-json.xsl` | GET | No | JSON | Public server status with mount info |
| `/status.xsl` | GET | No | HTML | Human-readable status page |
| `/admin/stats` | GET | Basic | XML | Full server statistics |
| `/admin/stats?mount=/stream` | GET | Basic | XML | Per-mount statistics |
| `/admin/listmounts` | GET | Basic | XML | List of active mounts |
| `/admin/listclients?mount=/stream` | GET | Basic | XML | Connected listeners on a mount |
| `/admin/moveclients?mount=/old&destination=/new` | GET | Basic | XML | Move listeners between mounts |
| `/admin/killclient?mount=/stream&id=123` | GET | Basic | XML | Disconnect a specific listener |
| `/admin/killsource?mount=/stream` | GET | Basic | XML | Disconnect a source |
| `/admin/metadata?mount=/stream&mode=updinfo&song=...` | GET | Basic | XML | Update stream metadata |
| `/admin/fallbacks?mount=/stream` | GET | Basic | XML | View fallback configuration |
| `/<mountpoint>` | GET | No | audio/* | Listener stream connection |
| `/<mountpoint>` | SOURCE | Basic | audio/* | Source stream upload |

### ICY Metadata Protocol

When a listener sends `Icy-MetaData: 1` in their GET request, the server interleaves metadata blocks in the audio stream:

```
[icy-metaint bytes of audio] [1 byte length] [length*16 bytes of metadata] [audio] ...
```

**Metadata format:**

```
StreamTitle='Artist - Song Title';StreamUrl='http://station.com';
```

- The length byte N means the metadata block is N * 16 bytes, null-padded.
- If N = 0, there is no metadata update (audio continues immediately).
- `icy-metaint` is typically 8192 or 16000 bytes.

**ICY response headers (listener connection):**

| Header | Example | Description |
|--------|---------|-------------|
| `icy-name` | `My Station` | Station name |
| `icy-genre` | `Rock` | Genre |
| `icy-url` | `http://mystation.com` | Station website |
| `icy-br` | `128` | Bitrate in kbps |
| `icy-sr` | `44100` | Sample rate in Hz |
| `icy-metaint` | `16000` | Metadata interval in bytes |
| `icy-pub` | `1` | Public directory listing (0 or 1) |
| `icy-description` | `Best Rock` | Station description |

### Source Connection Headers (ice-* prefix)

| Header | Example | Description |
|--------|---------|-------------|
| `ice-name` | `My Stream` | Stream name |
| `ice-description` | `Rock radio` | Stream description |
| `ice-url` | `http://myradio.com` | Stream URL |
| `ice-genre` | `Rock` | Genre |
| `ice-bitrate` | `128` | Bitrate hint |
| `ice-public` | `0` | Directory listing (0=private, 1=public) |
| `ice-audio-info` | `channels=2;samplerate=44100` | Audio parameters |

Note: Source connections use `ice-*` headers (Icecast native). Listener connections may use `icy-*` headers (SHOUTcast/ICY compatibility).

### Status JSON Response Format

The `/status-json.xsl` endpoint returns:

```json
{
  "icestats": {
    "admin": "admin@example.com",
    "host": "icecast.example.com",
    "location": "Earth",
    "server_id": "Icecast 2.4.4",
    "server_start": "Mon, 15 Jan 2024 10:30:00 +0000",
    "server_start_iso8601": "2024-01-15T10:30:00+0000",
    "source": [
      {
        "audio_info": "channels=2;samplerate=44100;bitrate=128",
        "bitrate": 128,
        "channels": 2,
        "genre": "Various",
        "ice_bitrate": 128,
        "listener_peak": 42,
        "listeners": 15,
        "listenurl": "http://icecast.example.com:8000/stream",
        "samplerate": 44100,
        "server_description": "My Radio Station",
        "server_name": "Cool Stream",
        "server_type": "audio/mpeg",
        "server_url": "http://myradio.com",
        "stream_start": "Mon, 15 Jan 2024 10:35:00 +0000",
        "stream_start_iso8601": "2024-01-15T10:35:00+0000",
        "title": "Current Song - Artist"
      }
    ]
  }
}
```

**Single mount edge case:** When exactly one source is active, `source` is a plain object, not an array. The implementation handles both forms.

**No sources:** When no sources are connected, the `source` key is absent entirely.

### Authentication Model

Icecast uses three separate credential sets, all configured in `icecast.xml`:

| Role | Default Username | Config Element | Used For |
|------|-----------------|----------------|----------|
| Admin | `admin` | `<admin-password>` | `/admin/*` endpoints |
| Source | `source` | `<source-password>` | `SOURCE` method connections |
| Relay | `relay` | `<relay-password>` | Relay pull connections |

All use HTTP Basic Auth. The source username is always `source` (hardcoded in the protocol).

### Audio Format Support

| Format | Content-Type | Notes |
|--------|-------------|-------|
| MP3 | `audio/mpeg` | Most common, universal compatibility |
| Ogg Vorbis | `application/ogg` | Open format, good quality |
| Opus | `audio/ogg; codecs=opus` | Modern, efficient, low latency |
| FLAC | `audio/ogg; codecs=flac` | Lossless audio streaming |
| AAC+ | `audio/aac` | Efficient at low bitrates |
| Theora | `video/ogg` | Video streaming (less common) |
| WebM | `video/webm` | Modern video format |

---

## Icecast vs. SHOUTcast

| Feature | Icecast | SHOUTcast v1 | SHOUTcast v2 |
|---------|---------|--------------|--------------|
| Source protocol | `SOURCE /mount HTTP/1.0` | `SOURCE /mount ICY/1.0` or password-only | HTTP PUT |
| Source response | `HTTP/1.0 200 OK` | `OK2` | `HTTP/1.1 200 OK` |
| Status endpoint | `/status-json.xsl` (JSON) | `/7.html` (CSV) | `/statistics?json=1` (JSON) |
| Admin endpoint | `/admin/stats` (XML) | `/admin.cgi?mode=viewxml` (XML) | `/admin.cgi` |
| Multiple mounts | Yes (native) | v1: single stream | v2: multiple streams |
| Open source | Yes (GPL) | No (proprietary) | No (proprietary) |
| Default port | 8000 | 8000 | 8000 |

---

## Edge Cases and Gotchas

1. **Single vs. array mount points.** Icecast serializes `source` as a bare object when there is exactly one mount, and as an array when there are multiple. Always normalize to an array.

2. **Missing source key.** When no sources are connected, the `source` field is absent from the JSON response (not an empty array).

3. **Transfer-Encoding: chunked in status responses.** Icecast 2.4+ may use chunked transfer encoding for status responses. The implementation decodes this transparently.

4. **SOURCE is HTTP/1.0 only.** The `SOURCE` method uses `HTTP/1.0`. Do not send `Transfer-Encoding: chunked` (HTTP/1.1 feature) with SOURCE requests. Audio data is a raw continuous byte stream.

5. **SHOUTcast compatibility.** When probing with `SOURCE`, some SHOUTcast v1 servers respond with a bare `OK2` instead of a full HTTP response line. The implementation accepts both.

6. **Zeroed silence bytes.** The source test sends null bytes (0x00) as silence. These are not valid MP3 frames; some servers may log decode warnings. This is acceptable for a brief connection test.

7. **icy-metaint is listener-side only.** The `icy-metaint` header is sent by the server to listeners, not by sources. Sources update metadata via the `/admin/metadata` admin endpoint.

8. **Cloudflare-proxied hosts.** Icecast servers behind Cloudflare's proxy cannot be reached from Cloudflare Workers due to anti-loop protections. The implementation detects this and returns a clear error.

9. **Admin stats are XML, not JSON.** Unlike `/status-json.xsl`, the `/admin/stats` endpoint returns XML. The raw XML is returned in the `adminStats` field.

10. **Response size cap.** Status responses are limited to 64 KB, admin responses to 8 KB. Servers with hundreds of mounts may exceed these limits.

---

## curl Examples

**Public status probe:**

```bash
curl -s -X POST https://portofcall.tshark.dev/api/icecast/status \
  -H 'Content-Type: application/json' \
  -d '{"host":"radio.example.com","port":8000}' | jq .
```

**Source mount test:**

```bash
curl -s -X POST https://portofcall.tshark.dev/api/icecast/source \
  -H 'Content-Type: application/json' \
  -d '{"host":"radio.example.com","port":8000,"password":"hackme","mountpoint":"/test"}' | jq .
```

**Admin stats:**

```bash
curl -s -X POST https://portofcall.tshark.dev/api/icecast/admin \
  -H 'Content-Type: application/json' \
  -d '{"host":"radio.example.com","port":8000,"username":"admin","password":"hackme"}' | jq .
```

**Direct Icecast status (bypassing Port of Call):**

```bash
curl -s http://radio.example.com:8000/status-json.xsl | jq .
```

**Direct Icecast admin stats:**

```bash
curl -s -u admin:hackme http://radio.example.com:8000/admin/stats
```

**Listen to a stream with metadata:**

```bash
curl -s -H "Icy-MetaData: 1" http://radio.example.com:8000/stream | head -c 32768 | xxd | head
```

---

## References

- [Icecast Documentation](https://icecast.org/docs/)
- [Icecast 2.4.1 Server Stats](https://icecast.org/docs/icecast-2.4.1/server-stats.html)
- [Icecast 2.4.1 Admin Interface](https://icecast.org/docs/icecast-2.4.1/admin-interface.html)
- [Icecast 2.4.1 Configuration](https://icecast.org/docs/icecast-2.4.1/config-file.html)
- [ICY Protocol (SHOUTcast) Reference](https://cast.readme.io/docs/icy)
- [Xiph.org Icecast Source Code](https://gitlab.xiph.org/xiph/icecast-server)
