# HTTP/2

## Overview

**HTTP/2** is a major revision of the HTTP protocol, focused on performance improvements. It introduces binary framing, multiplexing, header compression, and server push. Designed to reduce latency and improve page load times.

**Port:** 80 (HTTP), 443 (HTTPS)
**Transport:** TCP
**Status:** Current standard (superseding HTTP/1.1)
**RFC:** 7540

## Protocol Specification

### Key Features

1. **Binary Framing**: Binary protocol instead of text
2. **Multiplexing**: Multiple requests/responses over single connection
3. **Header Compression**: HPACK compression reduces overhead
4. **Server Push**: Server can send resources before requested
5. **Stream Prioritization**: Priority-based resource delivery
6. **Connection Coalescing**: Reuse connections for multiple origins

### Frame Structure

```
+-----------------------------------------------+
|                 Length (24 bits)              |
+---------------+---------------+---------------+
|   Type (8)    |   Flags (8)   |
+-+-------------+---------------+-------------------------------+
|R|                 Stream Identifier (31 bits)                 |
+=+=============================================================+
|                   Frame Payload (0...)                      ...
+---------------------------------------------------------------+
```

### Frame Types

- `0x0` - DATA (application data)
- `0x1` - HEADERS (header data)
- `0x2` - PRIORITY (stream priority)
- `0x3` - RST_STREAM (terminate stream)
- `0x4` - SETTINGS (connection parameters)
- `0x5` - PUSH_PROMISE (server push)
- `0x6` - PING (connectivity check)
- `0x7` - GOAWAY (graceful shutdown)
- `0x8` - WINDOW_UPDATE (flow control)
- `0x9` - CONTINUATION (header continuation)

### Connection Preface

Client sends: `PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n` + SETTINGS frame

### HPACK Header Compression

Uses static and dynamic tables to compress headers, reducing redundancy.

## Resources

- **RFC 7540**: Hypertext Transfer Protocol Version 2 (HTTP/2)
- **RFC 7541**: HPACK: Header Compression for HTTP/2
- [HTTP/2 Spec](https://httpwg.org/specs/rfc7540.html)
- [Can I Use HTTP/2](https://caniuse.com/http2)

## Notes

- **Binary Protocol**: Not human-readable like HTTP/1.1
- **Single Connection**: Eliminates head-of-line blocking at HTTP layer
- **TLS Recommended**: Most implementations require TLS (h2 vs h2c)
- **Browser Support**: All modern browsers support HTTP/2
- **Server Push**: Can improve performance but requires careful tuning
- **Backward Compatible**: Falls back to HTTP/1.1 via ALPN negotiation
- **vs HTTP/1.1**: Faster, more efficient, multiplexed
- **vs HTTP/3**: HTTP/3 uses QUIC (UDP) instead of TCP
- **ALPN**: Application-Layer Protocol Negotiation for protocol selection
- **h2**: HTTP/2 over TLS
- **h2c**: HTTP/2 cleartext (no TLS)
