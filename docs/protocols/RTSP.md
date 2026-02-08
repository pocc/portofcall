# RTSP (Real Time Streaming Protocol)

## Overview

**RTSP** (Real Time Streaming Protocol) is an application-level protocol for controlling streaming media servers. It provides VCR-like controls (play, pause, stop, seek) for multimedia streams and is commonly used in IP cameras, video surveillance systems, and streaming media servers.

**Port:** 554 (TCP), 8554 (TCP, alternative)
**Transport:** TCP (signaling), UDP/TCP (RTP media)
**RFC:** 2326 (RTSP 1.0), 7826 (RTSP 2.0)

## Protocol Specification

RTSP is a text-based protocol similar to HTTP that provides VCR-like controls for streaming media. It separates signaling (RTSP) from media transport (RTP).

## Resources

- **RFC 2326**: Real Time Streaming Protocol (RTSP 1.0)
- **RFC 7826**: Real Time Streaming Protocol 2.0 (RTSP 2.0)
- **RFC 2327**: SDP: Session Description Protocol
- **RFC 3550**: RTP: A Transport Protocol for Real-Time Applications
- [ONVIF](https://www.onvif.org/) - IP camera standards (uses RTSP)
- [live555](http://www.live555.com/) - RTSP/RTP streaming library
- [FFmpeg](https://ffmpeg.org/) - Multimedia framework with RTSP support

## Notes

- **Stateful Protocol**: Requires session management
- **Text-Based**: Similar to HTTP, human-readable
- **Separate Media Transport**: RTSP is signaling only, media uses RTP/RTCP
- **Transport Options**: RTP over UDP (default) or RTP over TCP (interleaved)
- **VCR-like Controls**: Play, pause, seek, stop
- **Port 554**: Standard RTSP port (TCP)
- **ONVIF**: Most IP cameras support ONVIF Profile S/T which uses RTSP
- **Common Use Cases**: IP security cameras, video surveillance, streaming servers
