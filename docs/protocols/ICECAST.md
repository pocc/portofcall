# Icecast Streaming Server Protocol Implementation

## Overview

**Protocol**: HTTP-based streaming server
**Port**: 8000 (default)
**Transport**: HTTP/1.1 over TCP
**Status**: Active, widely deployed for internet radio

Icecast is an open-source streaming media server that supports Ogg Vorbis, MP3, Opus, FLAC, AAC+, and other audio formats. It uses standard HTTP for both audio streaming and status/admin queries.

## Protocol Format

### Status Query

Icecast provides several HTTP endpoints for monitoring:

| Endpoint | Auth | Format | Description |
|----------|------|--------|-------------|
| `/status-json.xsl` | No | JSON | Public server status |
| `/admin/stats` | Yes | XML | Full admin statistics |
| `/admin/listmounts` | Yes | XML | List of mount points |
| `/admin/listclients` | Yes | XML | Connected clients |

### Status JSON Response

```json
{
  "icestats": {
    "admin": "admin@example.com",
    "host": "icecast.example.com",
    "location": "Earth",
    "server_id": "Icecast 2.4.4",
    "server_start": "2024-01-15T10:30:00+0000",
    "source": [
      {
        "audio_info": "channels=2;samplerate=44100;bitrate=128",
        "bitrate": 128,
        "channels": 2,
        "genre": "Various",
        "listener_peak": 42,
        "listeners": 15,
        "listenurl": "http://icecast.example.com:8000/stream",
        "samplerate": 44100,
        "server_description": "My Radio Station",
        "server_name": "Cool Stream",
        "server_type": "audio/mpeg",
        "title": "Current Song - Artist"
      }
    ]
  }
}
```

## Implementation

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/icecast/status` | POST | Probe Icecast server for public status |
| `/api/icecast/admin` | POST | Query admin stats (requires credentials) |

### Status Probe (`/api/icecast/status`)

**Request Body:**
```json
{
  "host": "icecast.example.com",
  "port": 8000,
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "icecast.example.com",
  "port": 8000,
  "rtt": 85,
  "server": "Icecast 2.4.4",
  "isIcecast": true,
  "serverInfo": {
    "admin": "admin@example.com",
    "serverId": "Icecast 2.4.4",
    "serverStart": "2024-01-15T10:30:00+0000"
  },
  "mountPoints": [...],
  "totalListeners": 42,
  "mountCount": 3
}
```

### Admin Stats (`/api/icecast/admin`)

**Request Body:**
```json
{
  "host": "icecast.example.com",
  "port": 8000,
  "username": "admin",
  "password": "hackme",
  "timeout": 10000
}
```

## Authentication

- **Public endpoints** (`/status-json.xsl`): No authentication needed
- **Admin endpoints** (`/admin/*`): HTTP Basic Authentication required
  - Default username: `admin`
  - Password set in `icecast.xml` configuration
- **Source connections**: Separate source password for stream uploading

## Timeouts & Keep-alives

- Default connection timeout: 10 seconds
- HTTP/1.1 with `Connection: close` (single request per connection)
- No keep-alive needed for status queries
- Response size capped at 64KB

## Binary vs. Text Encoding

- **Entirely text-based**: HTTP/1.1 protocol with JSON/XML responses
- **Audio streams**: Binary audio data (MP3, Ogg, etc.) but not accessed by probe
- **Chunked encoding**: Supported and decoded transparently

## Edge Cases

1. **Non-Icecast server**: If host runs a different HTTP server, status endpoint returns 404. Server header is checked for "Icecast".
2. **Empty mount list**: Server running with no active streams returns empty `source` array.
3. **Single mount point**: `source` field is an object instead of array (handled).
4. **Chunked responses**: Transfer-Encoding: chunked is decoded.
5. **Large responses**: Capped at 64KB for safety.

## Security Considerations

- Public status endpoint is read-only (no authentication needed)
- Admin endpoint requires Basic Auth (credentials sent in request)
- No stream manipulation or source connection attempted
- Host/port validated
- Response size limited

## Common Mount Point Formats

| Format | Content-Type | Description |
|--------|-------------|-------------|
| MP3 | `audio/mpeg` | Most common, wide compatibility |
| Ogg Vorbis | `application/ogg` | Open format, good quality |
| Opus | `audio/ogg; codecs=opus` | Modern, efficient codec |
| FLAC | `audio/ogg; codecs=flac` | Lossless audio |
| AAC+ | `audio/aac` | Efficient at low bitrates |

## References

- [Icecast Documentation](https://icecast.org/docs/)
- [Icecast JSON Status API](https://icecast.org/docs/icecast-2.4.1/server-stats.html)
- [Icecast Admin Interface](https://icecast.org/docs/icecast-2.4.1/admin-interface.html)
