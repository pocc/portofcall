# SHOUTcast Protocol

**File:** `src/worker/shoutcast.ts`
**Implemented:** Internet radio server protocol
**Endpoints:** 4 (probe, info, admin, source)

## Overview

SHOUTcast is a streaming audio server protocol developed by Nullsoft (creators of Winamp) in the late 1990s. It enables internet radio broadcasting using HTTP-based transport with proprietary "ICY" protocol extensions for metadata.

**Protocol variants:**
- **SHOUTcast v1**: ICY protocol (non-standard HTTP) - status line "ICY 200 OK"
- **SHOUTcast v2**: Standard HTTP with additional features
- **Icecast**: Open-source compatible alternative

**Transport:**
- Port: 8000 (default, configurable)
- Protocol: TCP, HTTP/1.0 with ICY extensions
- Audio formats: MP3, AAC, OGG Vorbis

## Endpoints

### 1. POST /api/shoutcast/probe

Probe a SHOUTcast server to detect presence and retrieve basic stream information.

**Request:**
```json
{
  "host": "radio.example.com",
  "port": 8000,
  "timeout": 15000,
  "stream": "/"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `host` | string | Yes | - | Target hostname or IP |
| `port` | number | No | 8000 | TCP port |
| `timeout` | number | No | 15000 | Connection timeout (ms) |
| `stream` | string | No | "/" | Stream path/mountpoint |

**Response (Success):**
```json
{
  "success": true,
  "host": "radio.example.com",
  "port": 8000,
  "isShoutCast": true,
  "stationName": "My Radio Station",
  "genre": "Rock",
  "bitrate": 128,
  "url": "http://myradio.com",
  "metaInt": 16000,
  "sampleRate": 44100,
  "contentType": "audio/mpeg",
  "isPublic": false,
  "rtt": 234
}
```

**Response (Failure):**
```json
{
  "success": false,
  "host": "radio.example.com",
  "port": 8000,
  "error": "Connection timeout",
  "rtt": 15003
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the probe succeeded |
| `host` | string | Target host (echoed from request) |
| `port` | number | Target port (echoed from request) |
| `isShoutCast` | boolean | True if server responds with ICY protocol or icy-* headers |
| `stationName` | string | Value of `icy-name` header |
| `genre` | string | Value of `icy-genre` header |
| `bitrate` | number | Stream bitrate in kbps (`icy-br`) |
| `url` | string | Station URL (`icy-url`) |
| `metaInt` | number | Metadata interval in bytes (`icy-metaint`) |
| `sampleRate` | number | Sample rate in Hz (`icy-sr`) |
| `contentType` | string | MIME type (usually `audio/mpeg`) |
| `isPublic` | boolean | Public listing flag (`icy-pub`: 1=public, 0=private) |
| `rtt` | number | Round-trip time in milliseconds |
| `error` | string | Error message (present if `success: false`) |

**Protocol details:**

The probe sends an ICY metadata request:
```http
GET / HTTP/1.0
Host: radio.example.com:8000
Icy-MetaData: 1
User-Agent: WinampMPEG/5.0
```

A SHOUTcast server responds with:
```http
ICY 200 OK
icy-name: My Radio Station
icy-genre: Rock
icy-url: http://myradio.com
icy-br: 128
icy-metaint: 16000
content-type: audio/mpeg

[Audio stream data...]
```

**Detection logic:**
- `isShoutCast = true` if status line starts with "ICY" OR any `icy-*` headers are present
- Response parsing stops at the first `\r\n\r\n` (before audio stream data)

### 2. POST /api/shoutcast/info

Alias for `/api/shoutcast/probe`. Returns identical response.

### 3. POST /api/shoutcast/admin

Query SHOUTcast admin/statistics endpoints for listener counts and metadata. Requires admin password.

**Request:**
```json
{
  "host": "radio.example.com",
  "port": 8000,
  "timeout": 15000,
  "adminPassword": "secret123"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `host` | string | Yes | - | Target hostname or IP |
| `port` | number | No | 8000 | TCP port |
| `timeout` | number | No | 15000 | Overall timeout (ms) |
| `adminPassword` | string | Yes | - | SHOUTcast admin password |

**Response (Success):**
```json
{
  "success": true,
  "host": "radio.example.com",
  "port": 8000,
  "currentListeners": 42,
  "peakListeners": 137,
  "maxListeners": 500,
  "uniqueListeners": 89,
  "title": "Artist - Song Title",
  "genre": "Rock",
  "bitrate": 128,
  "rtt": 456
}
```

**Response (Failure):**
```json
{
  "success": false,
  "host": "radio.example.com",
  "port": 8000,
  "rtt": 8234,
  "error": "Could not retrieve stats from admin.cgi, /statistics, or /7.html. Check the host, port, and adminPassword."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether stats were retrieved |
| `host` | string | Target host (echoed) |
| `port` | number | Target port (echoed) |
| `currentListeners` | number | Current listener count |
| `peakListeners` | number | Peak concurrent listeners |
| `maxListeners` | number | Server capacity limit |
| `uniqueListeners` | number | Unique listener count |
| `title` | string | Current song title or stream title |
| `genre` | string | Station genre |
| `bitrate` | number | Stream bitrate (kbps) |
| `rtt` | number | Round-trip time (ms) |
| `error` | string | Error message (present if `success: false`) |

**Endpoint fallback strategy:**

The handler tries three admin endpoints in order:

1. **SHOUTcast v1 XML** — `GET /admin.cgi?mode=viewxml&page=1&pass={password}`
   - Parses `<CURRENTLISTENERS>`, `<PEAKLISTENERS>`, `<MAXLISTENERS>`, etc.
   - Identifies response by presence of `<SHOUTCASTSERVER>` tag

2. **SHOUTcast v2 JSON** — `GET /statistics?json=1&pass={password}`
   - Parses JSON object with lowercase field names (`currentlisteners`, `peaklisteners`, etc.)
   - May wrap data in `streams` array

3. **Legacy CSV** — `GET /7.html?pass={password}`
   - Format: `currentListeners,streamStatus,peakListeners,maxListeners,uniqueListeners,bitrate,songTitle`
   - Wrapped in `<body>` tags

**Authentication:**
- URL parameter: `?pass={password}`
- HTTP Basic Auth header: `Authorization: Basic {base64("admin:password")}`
- Both methods are sent for maximum compatibility

**Timeout behavior:**
- Each endpoint gets up to 8 seconds or `timeout` (whichever is smaller)
- Failures are silently caught and next endpoint is tried
- Total operation timeout = `timeout` parameter

### 4. POST /api/shoutcast/source

Authenticate a source connection to a SHOUTcast server (broadcaster/DJ login).

**Request:**
```json
{
  "host": "radio.example.com",
  "port": 8000,
  "mountpoint": "/live",
  "password": "djpass123",
  "name": "My Live Stream",
  "genre": "Electronic",
  "bitrate": 192,
  "contentType": "audio/mpeg",
  "timeout": 10000
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `host` | string | Yes | - | Target hostname or IP |
| `port` | number | No | 8000 | TCP port |
| `mountpoint` | string | No | "/" | Stream mountpoint/path |
| `password` | string | Yes | - | Source/DJ password |
| `name` | string | No | "Port of Call Test" | Stream name |
| `genre` | string | No | "Various" | Genre tag |
| `bitrate` | number | No | 128 | Stream bitrate (kbps) |
| `contentType` | string | No | "audio/mpeg" | MIME type |
| `timeout` | number | No | 10000 | Connection timeout (ms) |

**Response (Success):**
```json
{
  "success": true,
  "host": "radio.example.com",
  "port": 8000,
  "mountpoint": "/live",
  "serverResponse": "ICY 200 OK",
  "statusCode": 200,
  "name": "My Live Stream",
  "genre": "Electronic",
  "bitrate": 192,
  "contentType": "audio/mpeg",
  "rtt": 187
}
```

**Response (Failure - Auth):**
```json
{
  "success": false,
  "host": "radio.example.com",
  "port": 8000,
  "mountpoint": "/live",
  "serverResponse": "ICY 401 Unauthorized",
  "statusCode": 401,
  "name": "My Live Stream",
  "genre": "Electronic",
  "bitrate": 192,
  "contentType": "audio/mpeg",
  "rtt": 89
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | True if server accepted source connection (status 200) |
| `host` | string | Target host (echoed) |
| `port` | number | Target port (echoed) |
| `mountpoint` | string | Stream mountpoint (normalized with leading `/`) |
| `serverResponse` | string | Server status line |
| `statusCode` | number | HTTP status code extracted from response |
| `name` | string | Stream name (echoed) |
| `genre` | string | Genre (echoed) |
| `bitrate` | number | Bitrate (echoed) |
| `contentType` | string | Content type (echoed) |
| `rtt` | number | Round-trip time (ms) |

**Protocol details:**

Sends ICY SOURCE handshake:
```http
SOURCE /live ICY/1.0
ice-password: djpass123
icy-name: My Live Stream
icy-genre: Electronic
icy-url: http://radio.example.com:8000/live
icy-br: 192
icy-pub: 0
content-type: audio/mpeg
```

On success (`ICY 200 OK`), sends 1152 bytes of silent data (one MP3 frame worth of zeros) to confirm the data path works, then disconnects cleanly.

**Security note:** This endpoint tests source authentication only. It does NOT stream actual audio content or remain connected.

## ICY Protocol Reference

### ICY Headers

| Header | Type | Description | Example |
|--------|------|-------------|---------|
| `icy-name` | string | Station/stream name | "My Radio Station" |
| `icy-genre` | string | Music genre | "Rock" |
| `icy-url` | string | Station website | "http://myradio.com" |
| `icy-br` | number | Bitrate in kbps | 128 |
| `icy-sr` | number | Sample rate in Hz | 44100 |
| `icy-metaint` | number | Metadata interval (bytes between metadata blocks) | 16000 |
| `icy-pub` | number | Public listing (0=private, 1=public) | 0 |
| `ice-password` | string | Source connection password (SOURCE protocol) | "secret" |

### Metadata Format

When `icy-metaint` is set (e.g., 16000), the server sends metadata blocks every N bytes of audio:

1. Audio data (16000 bytes)
2. Length byte (metadata length / 16)
3. Metadata (length * 16 bytes)
4. Repeat

**Metadata syntax:**
```
StreamTitle='Artist - Song Title';StreamUrl='http://example.com/buy';
```

**Special values:**
- `StreamTitle=''` — No current song (silent or unknown)
- Length byte = 0 — No metadata (skip to next audio chunk)

### Status Codes

| Code | Message | Meaning |
|------|---------|---------|
| 200 | OK | Stream available (ICY) or source accepted |
| 401 | Unauthorized | Invalid admin or source password |
| 403 | Forbidden | Access denied |
| 404 | Not Found | Stream/mountpoint doesn't exist |
| 503 | Service Unavailable | Server full or not accepting sources |

## Implementation Notes

### Connection Flow

**Probe/Info:**
1. Connect to `host:port` via TCP
2. Send ICY metadata request with `Icy-MetaData: 1` header
3. Read response until `\r\n\r\n` (stop before audio stream)
4. Parse status line and ICY headers
5. Close connection

**Admin:**
1. Try `/admin.cgi?mode=viewxml` with Basic auth
2. If no data, try `/statistics?json=1`
3. If still no data, try `/7.html`
4. Parse response based on format (XML tags / JSON / CSV)
5. Merge partial results using first non-undefined value

**Source:**
1. Connect to `host:port` via TCP
2. Send `SOURCE {mountpoint} ICY/1.0` with credentials
3. Read server response status line
4. If accepted (200), send 1152 bytes of silent data
5. Close connection

### Timeouts

- **Probe/Info**: Single timeout for entire operation (default 15s)
- **Admin**: Per-endpoint timeout (min of 8s or total timeout), total may exceed timeout if multiple endpoints tried
- **Source**: Single timeout for connection + handshake (default 10s)

### Error Handling

**Connection errors:**
- Timeout → `"Connection timeout"`
- Refused → `"ECONNREFUSED"`
- DNS failure → `"Host not found"`

**Protocol errors:**
- No response data → `"No response from SHOUTcast server"`
- Invalid format → `"Invalid SHOUTcast response format"`
- Non-200 status → `"ICY 404 Not Found"` (echoes server response)

**Validation errors** (HTTP 400):
- Missing host → `"Host is required"`
- Invalid port → `"Port must be between 1 and 65535"`
- Missing password → `"adminPassword is required"` (admin endpoint)
- Missing password → `"password is required"` (source endpoint)

### Response Size Limits

- **Probe/Info**: Reads one chunk (~16KB typical), stops at `\r\n\r\n`
- **Admin**: 65KB cap in `rawHttpGet` safety check
- **Source**: Reads one response chunk (~4KB typical)

### Transport

- **Protocol**: TCP (HTTP/1.0)
- **TLS**: Not supported (SHOUTcast typically runs unencrypted)
- **Keepalive**: Not used (connections close after each request)
- **Chunked TE**: Not applicable (raw socket reads)

## Example Responses

### Probe - SHOUTcast v1

**Request:**
```json
{
  "host": "stream.radio.org",
  "port": 8000
}
```

**Response:**
```json
{
  "success": true,
  "host": "stream.radio.org",
  "port": 8000,
  "isShoutCast": true,
  "stationName": "Classic Rock Radio",
  "genre": "Classic Rock",
  "bitrate": 128,
  "url": "http://radio.org",
  "metaInt": 16000,
  "contentType": "audio/mpeg",
  "isPublic": true,
  "rtt": 123
}
```

### Admin - SHOUTcast v2

**Request:**
```json
{
  "host": "localhost",
  "port": 8000,
  "adminPassword": "admin123"
}
```

**Response:**
```json
{
  "success": true,
  "host": "localhost",
  "port": 8000,
  "currentListeners": 5,
  "peakListeners": 23,
  "maxListeners": 100,
  "uniqueListeners": 18,
  "title": "DJ Set - Live Mix",
  "genre": "Electronic",
  "bitrate": 192,
  "rtt": 45
}
```

### Source - Authentication Failure

**Request:**
```json
{
  "host": "stream.example.com",
  "port": 8000,
  "mountpoint": "/live",
  "password": "wrongpass"
}
```

**Response:**
```json
{
  "success": false,
  "host": "stream.example.com",
  "port": 8000,
  "mountpoint": "/live",
  "serverResponse": "ICY 401 Unauthorized",
  "statusCode": 401,
  "name": "Port of Call Test",
  "genre": "Various",
  "bitrate": 128,
  "contentType": "audio/mpeg",
  "rtt": 67
}
```

## curl Examples

### Basic Probe
```bash
curl -X POST https://portofcall.app/api/shoutcast/probe \
  -H "Content-Type: application/json" \
  -d '{"host":"stream.radio.org","port":8000}'
```

### Probe with Custom Stream Path
```bash
curl -X POST https://portofcall.app/api/shoutcast/probe \
  -H "Content-Type: application/json" \
  -d '{
    "host": "radio.example.com",
    "port": 8080,
    "stream": "/live.mp3",
    "timeout": 10000
  }'
```

### Admin Statistics
```bash
curl -X POST https://portofcall.app/api/shoutcast/admin \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 8000,
    "adminPassword": "secret123"
  }' | jq '{
    listeners: .currentListeners,
    peak: .peakListeners,
    now_playing: .title
  }'
```

### Test Source Authentication
```bash
curl -X POST https://portofcall.app/api/shoutcast/source \
  -H "Content-Type: application/json" \
  -d '{
    "host": "stream.example.com",
    "port": 8000,
    "mountpoint": "/live",
    "password": "djpass",
    "name": "Test Broadcast",
    "bitrate": 192
  }' | jq '{success, statusCode, serverResponse}'
```

## Known Limitations

1. **No TLS/HTTPS support** — SHOUTcast typically runs on plain TCP. For encrypted streams, use a reverse proxy.

2. **No persistent source connections** — The `/source` endpoint only tests authentication, it doesn't maintain a live broadcast stream.

3. **No in-stream metadata parsing** — The probe reads only headers, not the in-band metadata chunks embedded in the audio stream.

4. **Single stream per server** — Admin endpoint assumes one primary stream. Multi-stream servers (SHOUTcast v2 with multiple mountpoints) may return stats for only the first stream.

5. **65KB response cap** — `rawHttpGet` has a safety limit. Very large admin responses (e.g., detailed listener logs) may be truncated.

6. **No relay authentication** — If the target is a relay server that requires listener auth, probe will fail.

7. **No SHOUTcast DNAS 2 advanced features** — Port of Call implements core v1/v2 compatibility only. Advanced v2 features (on-demand, autoDJ control, advanced scheduling) are not exposed.

8. **No Icecast-specific extensions** — While Icecast is largely compatible, Icecast-specific headers (like `ice-audio-info`) are not parsed.

9. **Admin endpoint tries all methods** — Even if the first endpoint succeeds, the function may still attempt other endpoints if key fields are missing. This adds latency but improves compatibility.

10. **Zero listener counts may be undefined** — Bug in `parse7Html` causes `parseInt() || undefined` to treat 0 as falsy, returning `undefined` instead of 0. This affects `/7.html` responses only.

## Local Testing

### Run SHOUTcast v1 Server (Docker)

```bash
# Start SHOUTcast server
docker run -d --name shoutcast \
  -p 8000:8000 \
  -e ADMIN_PASSWORD=admin123 \
  -e DJ_PASSWORD=djpass \
  ghcr.io/mikenye/docker-shoutcast:latest

# Test probe
curl -X POST http://localhost:8787/api/shoutcast/probe \
  -H "Content-Type: application/json" \
  -d '{"host":"localhost","port":8000}'

# Test admin
curl -X POST http://localhost:8787/api/shoutcast/admin \
  -H "Content-Type: application/json" \
  -d '{"host":"localhost","port":8000,"adminPassword":"admin123"}'

# Test source auth
curl -X POST http://localhost:8787/api/shoutcast/source \
  -H "Content-Type: application/json" \
  -d '{"host":"localhost","port":8000,"password":"djpass"}'
```

### Run Icecast (Open Source Alternative)

```bash
# Start Icecast server
docker run -d --name icecast \
  -p 8000:8000 \
  -e ICECAST_ADMIN_PASSWORD=admin \
  -e ICECAST_SOURCE_PASSWORD=source \
  ghcr.io/mikenye/docker-icecast2:latest

# Probe Icecast stream
curl -X POST http://localhost:8787/api/shoutcast/probe \
  -H "Content-Type: application/json" \
  -d '{"host":"localhost","port":8000,"stream":"/stream"}'
```

### Stream with FFmpeg

```bash
# Stream a test tone to SHOUTcast
ffmpeg -re -f lavfi -i "sine=frequency=440:duration=60" \
  -acodec libmp3lame -ab 128k \
  -f mp3 -content_type audio/mpeg \
  icecast://source:djpass@localhost:8000/test.mp3
```

## Use Cases

1. **Internet radio monitoring** — Check if stations are online, extract metadata
2. **Broadcaster network inventory** — Discover SHOUTcast servers on a network
3. **DJ credential validation** — Test source passwords before going live
4. **Listener analytics** — Poll admin endpoints for real-time listener counts
5. **Stream health checks** — Monitor uptime, bitrate, peak listeners
6. **Radio directory scraping** — Extract station names, genres, URLs for cataloging
7. **Forensics** — Identify SHOUTcast servers by ICY protocol signature

## Version Compatibility

| Feature | SHOUTcast v1 | SHOUTcast v2 | Icecast |
|---------|--------------|--------------|---------|
| ICY probe | ✅ | ✅ | ✅ |
| `icy-*` headers | ✅ | ✅ | ✅ |
| `/admin.cgi?mode=viewxml` | ✅ | ✅ | ❌ |
| `/statistics?json=1` | ❌ | ✅ | ❌ |
| `/7.html` | ✅ | ✅ | ❌ |
| `SOURCE` protocol | ✅ | ✅ | ✅ |
| Multiple mountpoints | ❌ | ✅ | ✅ |
| Icecast-specific headers | ❌ | ❌ | Partial |

## Resources

- **SHOUTcast DNAS Documentation**: https://cast.readme.io/docs/shoutcast
- **SHOUTcast Website**: https://www.shoutcast.com/
- **Icecast Documentation**: https://icecast.org/docs/
- **ICY Protocol Spec (unofficial)**: http://www.smackfu.com/stuff/programming/shoutcast.html
- **Metadata Format**: https://stackoverflow.com/questions/4911062/pulling-track-info-from-an-audio-stream-using-php
- **FFmpeg Streaming**: https://trac.ffmpeg.org/wiki/StreamingGuide
