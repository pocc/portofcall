# DoH (DNS over HTTPS)

## Overview

**DoH** (DNS over HTTPS) encrypts DNS queries using HTTPS, making them indistinguishable from regular web traffic. Provides privacy and prevents DNS-based censorship.

**Port:** 443 (HTTPS)
**Transport:** HTTPS
**RFC:** 8484

## Protocol Specification

DoH uses HTTP/2 (or HTTP/3) with two methods:

### GET Method

```
GET /dns-query?dns=AAABAAABAAAAAAAAA3d3dwdleGFtcGxlA2NvbQAAAQAB HTTP/2
Host: dns.example.com
Accept: application/dns-message
```

### POST Method

```
POST /dns-query HTTP/2
Host: dns.example.com
Content-Type: application/dns-message
Content-Length: 33

[Binary DNS query]
```

### Response

```
HTTP/2 200 OK
Content-Type: application/dns-message
Content-Length: 64

[Binary DNS response]
```

## Resources

- **RFC 8484**: DNS Queries over HTTPS (DoH)
- [Cloudflare 1.1.1.1](https://1.1.1.1/dns/)
- [Google Public DNS](https://developers.google.com/speed/public-dns/docs/doh)

## Notes

- **Privacy**: Encrypted DNS in HTTPS traffic
- **Port 443**: Blends with regular HTTPS
- **Censorship Resistance**: Harder to block than DoT
- **CDN-Friendly**: Can use CDN infrastructure
- **Browser Support**: Firefox, Chrome, Edge support DoH
- **Cloudflare**: https://cloudflare-dns.com/dns-query
- **Google**: https://dns.google/dns-query
- **Controversy**: Centralization concerns
- **vs DoT**: DoH hides in HTTPS, DoT has dedicated port
