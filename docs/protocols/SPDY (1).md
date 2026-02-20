# SPDY Protocol

## Overview

**SPDY** (pronounced "speedy") is an experimental protocol developed by Google to reduce web page load latency. It served as the foundation for HTTP/2 and introduced multiplexing, header compression, and server push. SPDY is now deprecated in favor of HTTP/2.

**Port:** 443 (HTTPS only)
**Transport:** TCP with TLS required
**Status:** Deprecated (superseded by HTTP/2)
**Developer:** Google (2009-2016)

## Protocol Specification

### Key Features

1. **Multiplexing**: Multiple concurrent requests over single connection
2. **Prioritization**: Request/response prioritization
3. **Header Compression**: DEFLATE compression for headers
4. **Server Push**: Proactive resource pushing
5. **TLS Required**: SPDY only works over SSL/TLS
6. **Connection Reuse**: Single connection for multiple resources

### SPDY Versions

- **SPDY/2** - Initial public version (2010)
- **SPDY/3** - Most widely deployed (2012)
- **SPDY/3.1** - Final version (2013)
- **HTTP/2** - Standardized successor (2015)

### Frame Format

```
+----------------------------------+
|C|       Frame Type (15 bits)     |
+----------------------------------+
| Flags (8) |  Length (24 bits)    |
+----------------------------------+
|          Frame Payload          ...
+----------------------------------+
```

### Frame Types

- **SYN_STREAM** - Initiate new stream
- **SYN_REPLY** - Response to stream initiation
- **RST_STREAM** - Terminate stream
- **SETTINGS** - Connection configuration
- **PING** - Round-trip time measurement
- **GOAWAY** - Graceful connection termination
- **HEADERS** - Header metadata
- **WINDOW_UPDATE** - Flow control

### ALPN/NPN Negotiation

SPDY uses NPN (Next Protocol Negotiation) or ALPN to negotiate protocol:
- `spdy/2`
- `spdy/3`
- `spdy/3.1`

## Resources

- [SPDY Whitepaper](https://www.chromium.org/spdy/spdy-whitepaper/)
- [SPDY Protocol Draft 3.1](https://www.chromium.org/spdy/spdy-protocol/spdy-protocol-draft3-1/)
- [Wikipedia: SPDY](https://en.wikipedia.org/wiki/SPDY)
- [Can I Use SPDY](https://caniuse.com/spdy) - Browser support history

## Notes

- **Deprecated**: All major browsers removed SPDY support in 2016
- **HTTP/2 Migration**: HTTP/2 adopted most SPDY concepts
- **TLS Only**: SPDY required SSL/TLS (no cleartext version)
- **Chrome Support**: Chrome removed SPDY in Chrome 51 (2016)
- **Firefox Support**: Firefox removed SPDY in Firefox 50 (2016)
- **Nginx/Apache**: Server support removed in favor of HTTP/2
- **Header Compression**: Used DEFLATE (HTTP/2 uses HPACK instead)
- **Legacy Only**: Only relevant for historical study
- **Performance**: Showed 27-60% reduction in page load times
- **Google Services**: Gmail, Google Search used SPDY (2012-2016)
- **vs HTTP/1.1**: Faster, multiplexed, compressed headers
- **vs HTTP/2**: HTTP/2 is the standardized evolution
- **CRIME Attack**: Vulnerability in DEFLATE compression led to HPACK in HTTP/2
