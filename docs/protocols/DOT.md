# DoT (DNS over TLS)

## Overview

**DoT** (DNS over TLS) encrypts DNS queries and responses using TLS, preventing eavesdropping and tampering. Standardized alternative to plain DNS for privacy and security.

**Port:** 853 (TCP)
**Transport:** TCP over TLS
**RFC:** 7858, 8310

## Protocol Specification

DoT wraps standard DNS queries in TLS:

1. Establish TLS connection to port 853
2. Send DNS query as binary data
3. Receive DNS response
4. Reuse connection for multiple queries

### TLS Requirements

- TLS 1.2 or higher
- Server certificate validation
- SNI (Server Name Indication) optional
- ALPN (Application-Layer Protocol Negotiation): "dot"

## Resources

- **RFC 7858**: Specification for DNS over Transport Layer Security (TLS)
- **RFC 8310**: Usage Profiles for DNS over TLS and DNS over DTLS

## Notes

- **Privacy**: Prevents ISP snooping on DNS queries
- **Port 853**: Dedicated port for DoT
- **vs DoH**: DoT uses dedicated port, DoH uses HTTPS (port 443)
- **Cloudflare**: 1.1.1.1 supports DoT
- **Google**: 8.8.8.8 supports DoT
- **Quad9**: 9.9.9.9 supports DoT
- **Android 9+**: Native DoT support (Private DNS)
- **Stub vs Recursive**: Can be used for both
