# LLMNR (Link-Local Multicast Name Resolution) Protocol

## Overview

**RFC:** 4795
**Port:** 5355 UDP (multicast) / TCP (unicast)
**Multicast Group:** 224.0.0.252 (IPv4), FF02:0:0:0:0:0:1:3 (IPv6)
**Purpose:** Local network name resolution without DNS server (Windows equivalent of mDNS)

LLMNR allows hosts on a link-local network to resolve hostnames to IP addresses without requiring a DNS server. It is primarily used in Windows environments for workgroup name resolution.

## Protocol Characteristics

- **Query/Response Model:** DNS-like binary packet format
- **Record Types:** Primarily A, AAAA, and PTR (no service discovery like mDNS SRV records)
- **Transport:** UDP multicast for queries; responders send unicast UDP or TCP responses
- **TCP Framing:** All TCP messages MUST be preceded by 2-octet network-byte-order length prefix (RFC 1035 §4.2.2, RFC 4795 §2.5)
- **Scope:** Link-local only (queries do not traverse routers)
- **Uniqueness:** LLMNR includes conflict detection via the 'C' (conflict) flag

## Worker API Endpoints

### 1. Forward Lookup (A/AAAA/PTR/ANY Query)

**Endpoint:** `POST /api/llmnr/query`

**Request Body:**
```json
{
  "host": "192.168.1.100",
  "port": 5355,
  "name": "WORKSTATION01",
  "type": 1,
  "timeout": 10000
}
```

**Parameters:**
- `host` (required): Target LLMNR responder IP address
- `port` (optional): TCP port, default 5355
- `name` (required): Hostname to resolve (without domain suffix)
- `type` (optional): DNS record type (1=A, 28=AAAA, 12=PTR, 255=ANY), default 1
- `timeout` (optional): Maximum wait time in milliseconds, default 10000

**Response (Success):**
```json
{
  "success": true,
  "query": {
    "name": "WORKSTATION01",
    "type": 1,
    "typeName": "A"
  },
  "id": 12345,
  "answers": [
    {
      "name": "WORKSTATION01",
      "type": 1,
      "typeName": "A",
      "class": 1,
      "ttl": 30,
      "value": "192.168.1.100"
    }
  ],
  "flags": {
    "raw": 33152,
    "qr": true,
    "opcode": 0,
    "conflict": false,
    "tc": false,
    "tentative": false,
    "rcode": 0,
    "rcodeName": "NOERROR"
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Timeout"
}
```

### 2. Reverse Lookup (PTR Query)

**Endpoint:** `POST /api/llmnr/reverse`

**Request Body:**
```json
{
  "host": "192.168.1.100",
  "port": 5355,
  "ip": "192.168.1.50",
  "timeout": 10000
}
```

**Parameters:**
- `host` (required): Target LLMNR responder IP address
- `port` (optional): TCP port, default 5355
- `ip` (required): IPv4 or IPv6 address to reverse-resolve
- `timeout` (optional): Maximum wait time in milliseconds, default 10000

**Response (Success):**
```json
{
  "success": true,
  "ip": "192.168.1.50",
  "ptrName": "50.1.168.192.in-addr.arpa",
  "hostnames": ["FILESERVER"],
  "id": 23456,
  "answers": [
    {
      "name": "50.1.168.192.in-addr.arpa",
      "type": 12,
      "typeName": "PTR",
      "class": 1,
      "ttl": 30,
      "value": "FILESERVER"
    }
  ],
  "flags": {
    "raw": 33152,
    "qr": true,
    "opcode": 0,
    "conflict": false,
    "tc": false,
    "tentative": false,
    "rcode": 0,
    "rcodeName": "NOERROR"
  }
}
```

**IPv6 Reverse Example:**
```json
{
  "host": "fe80::1",
  "ip": "fe80::aabb:ccff:fe00:1122"
}
```

Response includes PTR name like:
```
2.2.1.1.0.0.0.0.e.f.f.f.c.c.b.b.a.a.0.0.0.0.0.0.0.0.0.0.0.8.e.f.ip6.arpa
```

### 3. Hostname Scan (Parallel Enumeration)

**Endpoint:** `POST /api/llmnr/scan`

**Request Body (Custom Name List):**
```json
{
  "host": "192.168.1.1",
  "port": 5355,
  "names": ["DC01", "DC02", "FILESERVER", "EXCHANGE"],
  "type": 1,
  "perQueryTimeout": 3000,
  "timeout": 30000
}
```

**Request Body (Prefix Range Scan):**
```json
{
  "host": "192.168.1.1",
  "prefix": "WORKSTATION",
  "rangeStart": 1,
  "rangeEnd": 20,
  "type": 1
}
```
This generates queries for: `WORKSTATION01`, `WORKSTATION02`, ..., `WORKSTATION20`

**Request Body (Default Common Names):**
```json
{
  "host": "192.168.1.1"
}
```
Probes 24 common Windows hostname patterns: DC, DC01, DC02, PDC, BDC, FILESERVER, FS01, FS02, EXCHANGE, MAIL, SMTP, WORKSTATION, DESKTOP, LAPTOP, ADMIN, SERVER, NAS, PRINTER, PRINT, SCAN, ROUTER, GATEWAY, FIREWALL

**Parameters:**
- `host` (required): Target LLMNR responder IP address
- `port` (optional): TCP port, default 5355
- `names` (optional): Array of specific hostnames to probe
- `prefix` (optional): Hostname prefix for range scan (e.g., "WORKSTATION")
- `rangeStart` (optional): Starting number for range scan, default 1
- `rangeEnd` (optional): Ending number for range scan, default 20
- `type` (optional): DNS record type, default 1 (A)
- `perQueryTimeout` (optional): Timeout per individual query in ms, default 3000
- `timeout` (optional): Overall scan timeout in ms, default 30000

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.1",
  "port": 5355,
  "total": 24,
  "respondedCount": 3,
  "responded": [
    {
      "name": "DC01",
      "answers": [
        {
          "name": "DC01",
          "type": 1,
          "typeName": "A",
          "class": 1,
          "ttl": 30,
          "value": "192.168.1.10"
        }
      ]
    },
    {
      "name": "FILESERVER",
      "answers": [
        {
          "name": "FILESERVER",
          "type": 1,
          "typeName": "A",
          "class": 1,
          "ttl": 30,
          "value": "192.168.1.50"
        }
      ]
    },
    {
      "name": "WORKSTATION",
      "answers": [
        {
          "name": "WORKSTATION",
          "type": 1,
          "typeName": "A",
          "class": 1,
          "ttl": 30,
          "value": "192.168.1.100"
        }
      ]
    }
  ],
  "noResponse": [
    "DC", "DC02", "PDC", "BDC", "FS01", "FS02", "EXCHANGE", "MAIL", "SMTP",
    "DESKTOP", "LAPTOP", "ADMIN", "SERVER", "NAS", "PRINTER", "PRINT", "SCAN",
    "ROUTER", "GATEWAY", "FIREWALL", "ADMIN"
  ],
  "note": "3 LLMNR host(s) responded. LLMNR resolves link-local names on Windows networks."
}
```

## LLMNR Packet Structure

### Header Format (12 bytes)

```
 0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                      ID                       |  Transaction ID
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|QR|  Opcode  |C |TC|T | Z  Z  Z  Z|   RCODE   |  Flags
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                   QDCOUNT                     |  Question count
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                   ANCOUNT                     |  Answer count
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                   NSCOUNT                     |  Authority count
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                   ARCOUNT                     |  Additional count
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
```

**Query Header (RFC 4795 §2.1.1):**
- **ID:** Random 16-bit transaction identifier
- **FLAGS:** 0x0000 for standard query
  - QR=0 (query), OPCODE=0, C=0, TC=0, T=0, Z=0000, RCODE=0
- **QDCOUNT:** 1 (exactly one question per RFC 4795)
- **ANCOUNT, NSCOUNT, ARCOUNT:** 0

**Response Header Flags (RFC 4795 §2.2):**

| Bit(s) | Field   | Meaning |
|--------|---------|---------|
| 15     | QR      | 0=query, 1=response |
| 14-11  | OPCODE  | Must be 0 for LLMNR |
| 10     | C       | Conflict flag (responder detected name conflict) |
| 9      | TC      | Truncated (response too large for UDP, retry via TCP) |
| 8      | T       | Tentative (sender has not verified name uniqueness) |
| 7-4    | Z       | Reserved, must be zero |
| 3-0    | RCODE   | 0=NOERROR, 1=FORMERR, 2=SERVFAIL, 3=NXDOMAIN, 4=NOTIMP, 5=REFUSED |

### Question Section

```
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                                               |
|                     QNAME                     |  Domain name (label-encoded)
|                                               |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                     QTYPE                     |  A=1, AAAA=28, PTR=12, ANY=255
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    QCLASS                     |  IN=1
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
```

**Domain Name Encoding (RFC 1035 §3.1):**
- Each label prefixed by length byte
- Example: "DC01" → `04 44 43 30 31 00` (length=4, "DC01", null terminator)
- Example: "workstation.local" → `0B 77 6F 72 6B 73 74 61 74 69 6F 6E 05 6C 6F 63 61 6C 00`

**Compression Pointers (RFC 1035 §4.1.4):**
- Top 2 bits = 11 (0xC0) indicates pointer
- Lower 14 bits = offset from start of DNS message
- Example: `C0 0C` = pointer to offset 12 (start of question)

### Answer Section (Resource Records)

```
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                                               |
|                      NAME                     |  Domain name (may use compression)
|                                               |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                      TYPE                     |  Record type
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                     CLASS                     |  IN=1
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                      TTL                      |  Time to live (32-bit)
|                                               |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    RDLENGTH                   |  Data length
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                     RDATA                     |  Record data
|                                               |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
```

**RDATA Format by Type:**

- **A (type 1):** 4 bytes (IPv4 address)
  - Example: `C0 A8 01 0A` = 192.168.1.10

- **AAAA (type 28):** 16 bytes (IPv6 address)
  - Example: `FE80 0000 0000 0000 AABB CCFF FE00 1122`

- **PTR (type 12):** Domain name (label-encoded, may use compression)
  - Example: `04 44 43 30 31 00` = "DC01"

## TCP Framing

**RFC 1035 §4.2.2 / RFC 4795 §2.5:** All TCP messages MUST be preceded by a 2-octet message length field in network byte order.

**Example TCP LLMNR Query:**
```
Bytes 0-1:   00 1E        (length = 30 bytes)
Bytes 2-13:  [12-byte DNS header]
Bytes 14-31: [question section]
```

**Why TCP?**
- UDP responses exceeding 512 bytes trigger TC (truncated) flag
- Client must retry via TCP to receive full response
- Worker implementation uses TCP exclusively for simplicity

## Reverse DNS (PTR) Name Format

### IPv4 Reverse
- Take IP octets in reverse order, append `.in-addr.arpa`
- Example: `192.168.1.50` → `50.1.168.192.in-addr.arpa`

### IPv6 Reverse
- Expand address to full 32 hex digits (no compression)
- Reverse nibble order, insert dots between each nibble
- Append `.ip6.arpa`

**Example 1:** `fe80::1`
1. Expand: `fe80:0000:0000:0000:0000:0000:0000:0001`
2. Extract nibbles: `f e 8 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1`
3. Reverse: `1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 8 e f`
4. Result: `1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.e.f.ip6.arpa`

**Example 2:** `2001:db8::8a2e:370:7334`
1. Expand: `2001:0db8:0000:0000:0000:8a2e:0370:7334`
2. Nibbles: `2 0 0 1 0 d b 8 0 0 0 0 0 0 0 0 0 0 0 0 8 a 2 e 0 3 7 0 7 3 3 4`
3. Reverse: `4 3 3 7 0 7 3 0 e 2 a 8 0 0 0 0 0 0 0 0 0 0 0 0 8 b d 0 1 0 0 2`
4. Result: `4.3.3.7.0.7.3.0.e.2.a.8.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa`

## Record Types

| Type | Name  | Purpose | RDATA Format |
|------|-------|---------|--------------|
| 1    | A     | IPv4 address | 4 bytes (dotted decimal in JSON: "192.168.1.10") |
| 28   | AAAA  | IPv6 address | 16 bytes (colon-hex in JSON: "fe80::1") |
| 12   | PTR   | Reverse DNS pointer | Domain name string |
| 255  | ANY   | Request all available record types | Varies by record type |

## Typical Use Cases

### 1. Windows Workgroup Name Resolution
```bash
# Resolve a Windows machine by hostname
curl -X POST http://localhost:8787/api/llmnr/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.100",
    "name": "WORKSTATION01",
    "type": 1
  }'
```

### 2. Domain Controller Discovery
```bash
# Scan for domain controllers
curl -X POST http://localhost:8787/api/llmnr/scan \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.1",
    "names": ["DC", "DC01", "DC02", "PDC", "BDC"],
    "type": 1
  }'
```

### 3. Reverse Lookup (IP to Hostname)
```bash
# Resolve IP to hostname
curl -X POST http://localhost:8787/api/llmnr/reverse \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.50",
    "ip": "192.168.1.50"
  }'
```

### 4. IPv6 Reverse Lookup
```bash
curl -X POST http://localhost:8787/api/llmnr/reverse \
  -H "Content-Type: application/json" \
  -d '{
    "host": "fe80::1",
    "ip": "fe80::aabb:ccff:fe00:1122"
  }'
```

### 5. Hostname Enumeration (Range Scan)
```bash
# Enumerate WORKSTATION01 through WORKSTATION20
curl -X POST http://localhost:8787/api/llmnr/scan \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.1",
    "prefix": "WORKSTATION",
    "rangeStart": 1,
    "rangeEnd": 20
  }'
```

## LLMNR vs. mDNS Comparison

| Feature | LLMNR (RFC 4795) | mDNS (RFC 6762) |
|---------|------------------|-----------------|
| **Primary OS** | Windows | macOS, Linux, iOS |
| **Multicast Group** | 224.0.0.252 / FF02::1:3 | 224.0.0.251 / FF02::FB |
| **Port** | 5355 | 5353 |
| **Domain Suffix** | None (bare hostnames) | `.local` |
| **Service Discovery** | No (A/AAAA/PTR only) | Yes (SRV, TXT records) |
| **Conflict Detection** | C flag in response | Probing queries before claim |
| **Continuous Announcement** | No | Yes (periodic unsolicited responses) |
| **Query Suppression** | No | Yes (known-answer suppression) |
| **Complexity** | Simpler (DNS-like queries) | More complex (stateful caching) |

## Implementation Notes

### Compression Pointer Handling
The worker implementation includes protection against malicious compression pointer loops:
- Maximum 20 pointer jumps per domain name decode
- Bounds checking for pointer targets
- Separate tracking of read position vs. next-offset for caller

### Timeout Behavior
- **Single Query:** Entire operation times out after `timeout` ms (default 10000)
- **Scan:** Each individual query times out after `perQueryTimeout` ms (default 3000)
- **Scan Overall:** Entire scan operation times out after `timeout` ms (default 30000)

### TCP-Only Implementation
The worker uses TCP exclusively rather than UDP multicast because:
1. Cloudflare Workers do not support UDP multicast
2. TCP provides reliable delivery for large responses
3. Unicast TCP to known LLMNR responder IP is sufficient for direct queries
4. RFC 4795 §2.5 explicitly allows TCP for all LLMNR queries

### Cloudflare IP Blocking
All endpoints reject connections to Cloudflare IPs (HTTP 403) to prevent:
- Attacks against Cloudflare infrastructure via Workers
- DNS tunneling/exfiltration attempts
- Abuse of Workers as LLMNR proxy

## Edge Cases and Known Limitations

### 1. No Multicast Support
Worker cannot send UDP multicast queries to 224.0.0.252. You must specify the target LLMNR responder's IP address directly.

**Workaround:** Use scan endpoint to probe multiple IPs in parallel if you don't know which host runs LLMNR.

### 2. Truncated Responses (TC Flag)
If `flags.tc === true`, the UDP response was truncated and incomplete. RFC 4795 requires retrying via TCP.

**Worker Behavior:** Worker uses TCP by default, so TC flag indicates responder sent incomplete data even over TCP (non-compliant behavior or genuine resource limit).

### 3. Tentative Flag (T Bit)
If `flags.tentative === true`, the responding host has not yet verified the name is unique on the link (e.g., during boot).

**Implication:** The name may change after conflict detection completes. Query again after ~1 second.

### 4. Conflict Flag (C Bit)
If `flags.conflict === true`, the responder detected another host using the same name.

**Implication:** Name resolution is unreliable. Multiple hosts may be responding with different IPs.

### 5. RCODE Errors
- **FORMERR (1):** Malformed query packet (implementation bug or corrupted packet)
- **SERVFAIL (2):** Responder encountered internal error
- **NXDOMAIN (3):** Name does not exist
- **NOTIMP (4):** Responder does not support the requested operation
- **REFUSED (5):** Responder refuses to answer (policy or security)

### 6. IPv6 `::` Compression
The implementation correctly handles all forms of IPv6 compression:
- `::1` (loopback)
- `fe80::` (link-local prefix)
- `2001:db8::8a2e:370:7334` (embedded compression)
- `::ffff:192.0.2.1` (IPv4-mapped IPv6)

### 7. Empty Labels in Domain Names
The domain encoder skips empty labels (e.g., `hostname..local` → `hostname.local`). This is defensive but non-standard.

**RFC Compliance:** RFC 1035 does not explicitly forbid empty labels, but they are nonsensical in practice.

### 8. Maximum Domain Name Length
DNS names are limited to 255 octets total, with each label limited to 63 octets. The implementation does not enforce these limits.

**Risk:** Sending excessively long names will cause the query to fail or be rejected by the responder.

### 9. TTL Interpretation
LLMNR TTLs are typically 30 seconds. The worker returns raw TTL values but does not cache responses.

**Implication:** Clients should cache responses locally if making repeated queries.

### 10. Concurrent Scan Limit
The scan endpoint runs all queries in parallel via `Promise.all()`. Scanning 1000+ names may exhaust Worker memory or hit Cloudflare's connection limits.

**Recommendation:** Limit scans to <100 names. For larger ranges, batch into multiple requests.

## RFC 4795 Compliance Summary

| Requirement | Status | Notes |
|-------------|--------|-------|
| §2.1.1 Query Header | ✅ Compliant | Correct FLAGS=0x0000, QDCOUNT=1 |
| §2.1.2 Question Section | ✅ Compliant | Proper QNAME, QTYPE, QCLASS encoding |
| §2.2 Response Flags | ✅ Compliant | All flag bits decoded correctly |
| §2.4 TC Bit Handling | ⚠️ Partial | Worker uses TCP by default, TC not actionable |
| §2.5 TCP Framing | ✅ Compliant | 2-byte length prefix per RFC 1035 §4.2.2 |
| §3 Multicast Queries | ❌ Not Supported | Cloudflare Workers do not support UDP multicast |
| §4 Conflict Detection | ✅ Compliant | C flag decoded and returned to client |
| §5 Sender Guidelines | ⚠️ Partial | No retries, no caching (client must implement) |

## Security Considerations

### LLMNR Poisoning (Responder Spoofing)
LLMNR has no authentication or integrity protection. Any host on the link can respond to LLMNR queries, allowing man-in-the-middle attacks.

**Mitigation:**
- Use LLMNR only on trusted networks
- Prefer DNS with DNSSEC when available
- Monitor for multiple responses to the same query (conflict detection)

### DNS Rebinding
An attacker could register a public DNS name (e.g., `attacker.com`) that resolves to a private IP (e.g., `192.168.1.1`), then use LLMNR to override local name resolution.

**Worker Protection:** Cloudflare IP blocking prevents using the worker to attack Cloudflare infrastructure, but does not prevent LLMNR rebinding attacks on client networks.

### Enumeration and Fingerprinting
LLMNR scan endpoint allows rapid enumeration of Windows hostnames on a network, revealing:
- Machine naming conventions
- Network topology (DC, file servers, workstations)
- Operating system versions (via hostname patterns)

**Defense:** Disable LLMNR on sensitive machines or segment networks by VLAN.

### Denial of Service
Rapid LLMNR queries can generate excessive multicast traffic on the local network segment.

**Worker Mitigation:** Per-query timeouts prevent indefinite blocking. Overall scan timeout prevents resource exhaustion.

## Troubleshooting

### "Timeout" Error
**Cause:** LLMNR responder did not send a TCP response within the timeout period.

**Debug Steps:**
1. Verify target host has LLMNR enabled (Windows: enabled by default)
2. Check firewall allows TCP port 5355 inbound
3. Confirm host is reachable (ping, TCP traceroute)
4. Increase `timeout` parameter (try 30000ms)

### "Response too short" Error
**Cause:** TCP connection closed prematurely, or responder sent incomplete data.

**Debug Steps:**
1. Check network stability (packet loss, congestion)
2. Verify target host is not under heavy load
3. Retry query with longer timeout

### "No response" in Scan
**Cause:** Hostname is not registered for LLMNR, or host does not exist.

**Expected Behavior:** Windows machines register their NetBIOS name and hostname by default. If a machine does not respond:
- It may not be running Windows
- LLMNR may be disabled in Group Policy
- The hostname does not match your query

### Empty `answers` Array with `NOERROR`
**Cause:** LLMNR responder received the query but has no record of the requested name/type.

**Interpretation:** Name exists (RCODE=0) but no A/AAAA record available. Try querying for a different type (e.g., PTR).

### `conflict: true` in Response
**Cause:** Multiple hosts on the network are using the same hostname.

**Resolution:** Rename one of the conflicting machines, or use IP addresses directly.

### IPv6 PTR Name Too Short
**Cause:** Bug in `ipv6ToPTRName` prior to 2026-02-18 fix. Ensure you are running the latest worker code.

**Verification:** PTR name should always be 72 characters (63 nibbles + dots + 8-char suffix `.ip6.arpa`).

## Example: Full Query/Response Flow

**1. Client sends HTTP request:**
```http
POST /api/llmnr/query HTTP/1.1
Host: worker.example.com
Content-Type: application/json

{"host":"192.168.1.100","name":"FILESERVER","type":1}
```

**2. Worker builds LLMNR query packet:**
```
ID: 0x3A2B (random)
FLAGS: 0x0000 (query)
QDCOUNT: 1
ANCOUNT: 0
NSCOUNT: 0
ARCOUNT: 0
QNAME: 0A FILESERVER 00
QTYPE: 0001 (A)
QCLASS: 0001 (IN)
```

**3. Worker prepends TCP length and sends:**
```
0x00 0x1C  [28 bytes total]
[12-byte header]
[16-byte question]
```

**4. Responder sends TCP reply:**
```
0x00 0x2E  [46 bytes total]
ID: 0x3A2B
FLAGS: 0x8180 (response, QR=1, RCODE=0)
QDCOUNT: 1
ANCOUNT: 1
[question section echoed]
NAME: C0 0C (compression pointer to offset 12)
TYPE: 0001 (A)
CLASS: 0001 (IN)
TTL: 0000 001E (30 seconds)
RDLENGTH: 0004
RDATA: C0 A8 01 32 (192.168.1.50)
```

**5. Worker parses and returns JSON:**
```json
{
  "success": true,
  "query": {"name":"FILESERVER","type":1,"typeName":"A"},
  "id": 14891,
  "answers": [
    {
      "name":"FILESERVER",
      "type":1,
      "typeName":"A",
      "class":1,
      "ttl":30,
      "value":"192.168.1.50"
    }
  ],
  "flags": {
    "raw":33152,
    "qr":true,
    "opcode":0,
    "conflict":false,
    "tc":false,
    "tentative":false,
    "rcode":0,
    "rcodeName":"NOERROR"
  }
}
```

## References

- **RFC 4795:** Link-Local Multicast Name Resolution (LLMNR)
  https://datatracker.ietf.org/doc/html/rfc4795

- **RFC 1035:** Domain Names - Implementation and Specification
  https://datatracker.ietf.org/doc/html/rfc1035

- **RFC 6762:** Multicast DNS (mDNS) - for comparison
  https://datatracker.ietf.org/doc/html/rfc6762

- **Microsoft LLMNR Documentation:**
  https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2008-R2-and-2008/cc995404(v=ws.10)
