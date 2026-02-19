# mDNS (Multicast DNS) - RFC 6762

## Protocol Overview

**mDNS** (Multicast DNS) is a zero-configuration service discovery protocol that resolves hostnames to IP addresses on small networks without a central DNS server. It's the foundation of Apple's **Bonjour**, Linux **Avahi**, and **Zeroconf** networking.

**Standard Port:** 5353 (UDP multicast)
**Multicast Addresses:**
- IPv4: `224.0.0.251`
- IPv6: `FF02::FB`

**RFCs:**
- RFC 6762: Multicast DNS
- RFC 6763: DNS-Based Service Discovery (DNS-SD)

**Common Use Cases:**
- Printer discovery (`_ipp._tcp.local`)
- AirPlay devices (`_airplay._tcp.local`)
- Chromecast (`_googlecast._tcp.local`)
- SSH servers (`_ssh._tcp.local`)
- HTTP APIs (`_http._tcp.local`)
- File sharing (AFP, SMB)

---

## Port of Call Implementation

This implementation provides **DNS over TCP** (RFC 1035 Section 4.2.2) to mDNS servers, not true multicast UDP. This is useful for:
- Querying mDNS responders that support TCP (rare but valid)
- Testing mDNS implementations
- Service announcement simulation

**Limitations:**
- No UDP multicast support (Cloudflare Workers only support TCP)
- No continuous multicast querying
- No automatic service announcement
- No conflict resolution

---

## DNS/mDNS Message Format

### Header (12 bytes)

```
 0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                      ID                       |  Transaction ID (0 for mDNS queries)
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|QR|   Opcode  |AA|TC|RD|RA| Z|AD|CD|   RCODE   |  Flags
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    QDCOUNT                    |  Question count
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    ANCOUNT                    |  Answer count
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    NSCOUNT                    |  Authority count
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    ARCOUNT                    |  Additional count
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
```

**Flags:**
- **QR**: Query (0) or Response (1)
- **Opcode**: Operation code (0 = standard query)
- **AA**: Authoritative Answer (1 for mDNS responses)
- **TC**: Truncated (1 if message > 512 bytes for UDP)
- **RD**: Recursion Desired (0 for mDNS)
- **RA**: Recursion Available (0 for mDNS)
- **RCODE**: Response code (0 = no error, 3 = NXDOMAIN)

### Question Section

```
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                                               |
/                     QNAME                     /  Domain name (length-prefixed labels)
/                                               /
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                     QTYPE                     |  Record type (1=A, 12=PTR, 33=SRV)
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                     QCLASS                    |  Class (0x0001=IN, 0x8001=QU bit)
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
```

**QCLASS QU Bit (RFC 6762 Section 5.4):**
- Bit 15 of QCLASS requests a **unicast response**
- `0x0001` = Normal multicast response (QM)
- `0x8001` = Unicast response (QU)

### Resource Record

```
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                                               |
/                      NAME                     /  Domain name (compressed)
/                                               /
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                      TYPE                     |  Record type
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                     CLASS                     |  Class (0x8001=cache-flush)
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                      TTL                      |  Time to live (seconds)
|                                               |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                   RDLENGTH                    |  Data length
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--|
/                     RDATA                     /  Record data
/                                               /
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
```

**Cache-Flush Bit (RFC 6762 Section 10.2):**
- Bit 15 of CLASS field (0x8000)
- Set on **unique records** (SRV, TXT, A, AAAA) to invalidate cached data
- **NOT set** on **shared records** (PTR) — multiple instances can coexist

---

## DNS Name Compression (RFC 1035 Section 4.1.4)

DNS names use **length-prefixed labels** terminated by a null byte.

**Example:** `webserver._http._tcp.local`

```
0x09 webserver 0x05 _http 0x04 _tcp 0x05 local 0x00
```

**Compression Pointers:**
- Top 2 bits set (0xC0) indicate a pointer
- Lower 14 bits = offset to label elsewhere in message
- Saves space when names repeat

**Example:**
```
Offset 12: 0x09 webserver 0x05 _http 0x04 _tcp 0x05 local 0x00
Offset 50: 0xC0 0x0C  (pointer to offset 12)
```

**Implementation Notes:**
- Must validate pointers don't create loops
- Pointers can only point **backward** in the message
- Maximum label length: 63 bytes
- Maximum name length: 255 bytes

---

## Record Types

### PTR (Pointer) — Service Instance Enumeration

Points from a service type to a service instance name.

**Query:** `_http._tcp.local PTR?`

**Response:**
```
_http._tcp.local. 120 IN PTR webserver._http._tcp.local.
_http._tcp.local. 120 IN PTR api._http._tcp.local.
```

### SRV (Service) — Hostname and Port

Provides hostname and port for a service instance.

**Format:**
```
Priority (2 bytes)
Weight (2 bytes)
Port (2 bytes)
Target (domain name)
```

**Example:**
```
webserver._http._tcp.local. 120 IN SRV 0 0 8080 myserver.local.
```

### TXT (Text) — Key-Value Metadata

Service metadata as length-prefixed key=value strings.

**Format:**
```
Length (1 byte) + String (UTF-8)
Repeated for each key=value pair
```

**Example:**
```
webserver._http._tcp.local. 120 IN TXT "path=/api" "version=1.0" "auth=basic"
```

### A (IPv4 Address)

```
webserver.local. 120 IN A 192.168.1.100
```

### AAAA (IPv6 Address)

```
webserver.local. 120 IN AAAA 2001:db8::1
```

---

## Service Discovery Flow

### 1. Service Enumeration

**Query:** `_services._dns-sd._udp.local PTR?`

Lists all available service types on the network.

**Response:**
```
_services._dns-sd._udp.local. 3600 IN PTR _http._tcp.local.
_services._dns-sd._udp.local. 3600 IN PTR _ssh._tcp.local.
_services._dns-sd._udp.local. 3600 IN PTR _printer._tcp.local.
```

### 2. Service Browsing

**Query:** `_http._tcp.local PTR?`

Lists all HTTP service instances.

**Response:**
```
_http._tcp.local. 120 IN PTR webserver._http._tcp.local.
_http._tcp.local. 120 IN PTR api._http._tcp.local.
```

### 3. Service Resolution

**Query:** `webserver._http._tcp.local SRV?` + `TXT?` + `A?`

Gets full details for a specific service.

**Response:**
```
# SRV: hostname and port
webserver._http._tcp.local. 120 IN SRV 0 0 8080 myserver.local.

# TXT: metadata
webserver._http._tcp.local. 120 IN TXT "path=/api" "version=2.0"

# A: IP address (in Additional section)
myserver.local. 120 IN A 192.168.1.100
```

### 4. Direct Hostname Resolution

**Query:** `myserver.local A?`

**Response:**
```
myserver.local. 120 IN A 192.168.1.100
```

---

## mDNS-Specific Features

### Transaction ID = 0 (RFC 6762 Section 18.1)

> "In multicast query messages, the Query Identifier SHOULD be set to zero on transmission."

Regular DNS uses random transaction IDs to match queries/responses. mDNS uses 0 because multicast responses go to all listeners.

### QU Bit — Unicast Response (RFC 6762 Section 5.4)

Set bit 15 in QCLASS to request a unicast response instead of multicast.

**Use cases:**
- Reduce network traffic when only one client needs the answer
- Legacy unicast-only queries
- Continuous query refreshes

**Example:**
```
QCLASS = 0x8001  (IN class + QU bit)
```

### Cache-Flush Bit (RFC 6762 Section 10.2)

Set bit 15 in CLASS field for **unique records** to signal clients to flush cached data.

**Shared records (PTR):** No cache-flush bit (multiple services can have same type)
**Unique records (SRV, TXT, A, AAAA):** Cache-flush bit set

**Example:**
```
# Shared record — no cache-flush
_http._tcp.local. 120 IN PTR webserver._http._tcp.local.
CLASS = 0x0001

# Unique record — cache-flush
webserver._http._tcp.local. 120 IN/flush SRV 0 0 8080 myserver.local.
CLASS = 0x8001
```

### Known-Answer Suppression (RFC 6762 Section 7.1)

Include known answers in the query's Answer section to suppress duplicate responses.

**Benefits:**
- Reduces network traffic
- Prevents redundant responses
- Optimizes continuous querying

### Continuous Querying

Standard mDNS clients re-query periodically to discover new services and detect changes.

**Typical intervals:**
- Initial: 1 second
- Exponential backoff: 2s, 4s, 8s, 16s, 32s
- Maximum: 60 minutes

### TTL Values (RFC 6762 Section 10)

**Host records (A, AAAA):** 120 seconds
**Service records (SRV, TXT):** 120 seconds
**Goodbye packets:** TTL = 0 (service leaving)
**Service type enumeration:** 3600 seconds (1 hour)

---

## Service Naming Convention

### Service Type Format

```
_<service>._<proto>.local
```

**Examples:**
- `_http._tcp.local` — HTTP servers
- `_ssh._tcp.local` — SSH servers
- `_printer._tcp.local` — Printers
- `_airplay._tcp.local` — AirPlay receivers
- `_googlecast._tcp.local` — Chromecast
- `_ipp._tcp.local` — Internet Printing Protocol
- `_smb._tcp.local` — Samba/CIFS file sharing
- `_afpovertcp._tcp.local` — Apple Filing Protocol

### Service Instance Format

```
<instance-name>._<service>._<proto>.local
```

**Examples:**
- `My Printer._printer._tcp.local`
- `Living Room TV._airplay._tcp.local`
- `Office API._http._tcp.local`

**Rules:**
- Instance names can contain spaces and UTF-8
- Underscores prefix service/protocol (reserved)
- Always ends with `.local`

---

## API Usage

### Query mDNS Service

```bash
POST /api/mdns/query
```

```json
{
  "host": "192.168.1.1",
  "port": 5353,
  "service": "_http._tcp.local",
  "queryType": "PTR",
  "unicastResponse": false,
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "192.168.1.1",
  "port": 5353,
  "service": "_http._tcp.local",
  "answers": [
    {
      "name": "_http._tcp.local",
      "type": "PTR",
      "class": "IN",
      "ttl": 120,
      "data": "webserver._http._tcp.local"
    }
  ],
  "additionals": [
    {
      "name": "webserver._http._tcp.local",
      "type": "SRV",
      "class": "IN (cache-flush)",
      "ttl": 120,
      "data": {
        "priority": 0,
        "weight": 0,
        "port": 8080,
        "target": "myserver.local"
      }
    },
    {
      "name": "myserver.local",
      "type": "A",
      "class": "IN (cache-flush)",
      "ttl": 120,
      "data": "192.168.1.100"
    }
  ],
  "answerCount": 1,
  "rtt": 45
}
```

### Discover All Services

```bash
POST /api/mdns/discover
```

```json
{
  "host": "192.168.1.1",
  "port": 5353,
  "timeout": 10000
}
```

Automatically queries `_services._dns-sd._udp.local` to enumerate service types.

### Announce Service

```bash
POST /api/mdns/announce
```

```json
{
  "host": "192.168.1.1",
  "port": 5353,
  "serviceType": "_http._tcp.local",
  "instanceName": "My API._http._tcp.local",
  "hostname": "api.local",
  "servicePort": 8080,
  "txtRecords": ["path=/v1", "version=2.0", "auth=token"],
  "ttl": 120,
  "timeout": 8000
}
```

Sends a DNS response packet (QR=1, AA=1) with PTR, SRV, and TXT records.

**Note:** This simulates a service announcement over TCP, not true multicast.

---

## Query Types Reference

| Type | Code | Description | Example |
|------|------|-------------|---------|
| A | 1 | IPv4 address | `myserver.local A?` |
| AAAA | 28 | IPv6 address | `myserver.local AAAA?` |
| PTR | 12 | Service instance | `_http._tcp.local PTR?` |
| SRV | 33 | Service location | `webserver._http._tcp.local SRV?` |
| TXT | 16 | Service metadata | `webserver._http._tcp.local TXT?` |
| ANY | 255 | All records | `myserver.local ANY?` |

---

## Common Service Types

| Service | Type | Port | Description |
|---------|------|------|-------------|
| HTTP | `_http._tcp.local` | 80/8080 | Web servers |
| HTTPS | `_https._tcp.local` | 443 | Secure web servers |
| SSH | `_ssh._tcp.local` | 22 | SSH servers |
| FTP | `_ftp._tcp.local` | 21 | FTP servers |
| Printer | `_printer._tcp.local` | 515 | LPR printers |
| IPP | `_ipp._tcp.local` | 631 | Internet Printing |
| AirPlay | `_airplay._tcp.local` | 7000 | Apple AirPlay |
| Chromecast | `_googlecast._tcp.local` | 8009 | Google Cast |
| SMB | `_smb._tcp.local` | 445 | Windows file sharing |
| AFP | `_afpovertcp._tcp.local` | 548 | Apple file sharing |
| MQTT | `_mqtt._tcp.local` | 1883 | Message queue |
| Home Assistant | `_home-assistant._tcp.local` | 8123 | Smart home |
| Spotify Connect | `_spotify-connect._tcp.local` | — | Music streaming |

---

## Testing Examples

### Find HTTP Services

```bash
curl -X POST https://portofcall.dev/api/mdns/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.1",
    "service": "_http._tcp.local",
    "queryType": "PTR"
  }'
```

### Resolve Service Details

```bash
curl -X POST https://portofcall.dev/api/mdns/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.1",
    "service": "webserver._http._tcp.local",
    "queryType": "SRV"
  }'
```

### Get IP Address

```bash
curl -X POST https://portofcall.dev/api/mdns/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.1",
    "service": "myserver.local",
    "queryType": "A"
  }'
```

### Request Unicast Response

```bash
curl -X POST https://portofcall.dev/api/mdns/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.1",
    "service": "_ssh._tcp.local",
    "queryType": "PTR",
    "unicastResponse": true
  }'
```

---

## Implementation Notes

### DNS over TCP Framing (RFC 1035 Section 4.2.2)

All DNS over TCP messages are prefixed with a 2-byte length field:

```
+--+--+--+--+--+--+--+--+
|     Message Length    |  16-bit big-endian
+--+--+--+--+--+--+--+--+
|                       |
/    DNS Message        /
/                       /
+--+--+--+--+--+--+--+--+
```

**Maximum DNS message size:** 65535 bytes

### Error Handling

**RCODE values (RFC 1035 Section 4.1.1):**
- 0: No error
- 1: Format error (malformed query)
- 2: Server failure
- 3: Name error (NXDOMAIN — domain doesn't exist)
- 4: Not implemented
- 5: Refused

**Implementation validates:**
- QR bit must be 1 (response)
- OPCODE must be 0 (standard query)
- RCODE must be 0 (no error)

### Compression Loop Detection

The implementation detects compression loops by:
1. Tracking visited pointer offsets in a Set
2. Validating pointers only point backward
3. Maximum 20 pointer jumps (though loops are detected earlier)

**Invalid compression examples:**
```
# Pointer to itself
Offset 12: 0xC0 0x0C

# Pointer to future offset
Offset 12: 0xC0 0x50  (offset 80, but we're at 12)

# Circular reference
Offset 12: 0xC0 0x20
Offset 32: 0xC0 0x0C
```

### Label Length Validation

**RFC 1035 Section 2.3.1:**
- Maximum label length: 63 bytes
- Maximum name length: 255 bytes
- Labels starting with underscore are reserved for service types

### UTF-8 vs ASCII Encoding

Traditional DNS uses ASCII (7-bit). Modern implementations support UTF-8 for internationalized domain names (IDN).

**This implementation uses UTF-8** for label encoding/decoding to support international service names.

---

## Limitations

### No UDP Multicast

True mDNS requires UDP multicast to `224.0.0.251:5353`. Cloudflare Workers only support TCP via `connect()`.

**Workarounds:**
- Query mDNS responders that support TCP (rare)
- Use as a testing tool for mDNS message formatting
- Implement UDP multicast in a local proxy/gateway

### No Continuous Querying

Standard mDNS clients re-query every 1-60 seconds to discover new services. This implementation only supports single queries.

### No Service Announcement

Real mDNS responders announce services via unsolicited multicast responses. The `/api/mdns/announce` endpoint sends a single TCP packet, not true multicast.

### No Conflict Resolution

mDNS includes conflict resolution when multiple devices claim the same name. Not implemented.

---

## RFC Compliance

### RFC 6762: Multicast DNS

**Implemented:**
- Transaction ID = 0 for queries (Section 18.1)
- QU bit for unicast responses (Section 5.4)
- Cache-flush bit parsing (Section 10.2)
- DNS message format (Section 18)
- PTR/SRV/TXT/A/AAAA record parsing

**Not Implemented (UDP multicast required):**
- Multicast query/response (Section 5)
- Continuous querying (Section 5.2)
- Known-answer suppression (Section 7.1)
- Conflict resolution (Section 9)
- Probe queries (Section 8.1)

### RFC 6763: DNS-Based Service Discovery

**Implemented:**
- Service type format `_service._proto.local`
- Service instance naming
- PTR/SRV/TXT record relationships
- Service enumeration via `_services._dns-sd._udp.local`

**Not Implemented:**
- Browse domain list (Section 11)
- Legacy browsing (Section 11.2)

### RFC 1035: Domain Names

**Implemented:**
- DNS message format (Section 4.1)
- DNS name compression (Section 4.1.4)
- TCP framing (Section 4.2.2)
- Resource record format (Section 3.2)
- Response validation (QR, OPCODE, RCODE)

---

## Bugs Fixed (2026-02-18)

### 1. DNS Name Encoding - UTF-8 Support
**Issue:** Used `'ascii'` encoding instead of `'utf8'` for DNS labels.
**Impact:** International characters in service names would be corrupted.
**Fix:** Changed to UTF-8 encoding; added 63-byte label length validation.

### 2. Compression Pointer Recursion
**Issue:** When following pointers, entire recursive result was added as single label instead of merging labels.
**Impact:** Compressed names would have incorrect structure (e.g., `"a.b.c"` instead of individual labels).
**Fix:** Rewrote to iteratively follow pointers and append labels individually.

### 3. Compression Loop Detection
**Issue:** No cycle detection for malicious/malformed compression pointers.
**Impact:** Infinite loops or stack overflow on circular references.
**Fix:** Added `Set<number>` to track visited offsets; validate pointers only point backward.

### 4. Missing Response Validation
**Issue:** Flags field was read but never validated.
**Impact:** Invalid responses (queries, errors, non-standard opcodes) would be parsed as valid.
**Fix:** Added checks for QR bit, OPCODE, and RCODE; throw descriptive errors.

### 5. QU Bit Not Supported
**Issue:** Documentation mentioned unicast responses but code didn't support it.
**Impact:** No way to request unicast responses (reduces multicast traffic).
**Fix:** Added `unicastResponse` parameter; set QCLASS to 0x8001 when true.

### 6. TCP Message Length Validation
**Issue:** No bounds check on TCP length prefix.
**Impact:** Malicious server could send length > 65535, causing memory issues.
**Fix:** Added validation that `expectedLength <= 65535`.

### 7. Buffer Bounds Checks
**Issue:** Initial bounds check didn't protect subsequent reads.
**Impact:** Could read past buffer end on truncated messages.
**Fix:** Added bounds checks before all buffer reads; early exit on insufficient data.

---

## Security Considerations

### DNS Spoofing

mDNS has no authentication — any device can respond to queries. Malicious actors can:
- Advertise fake services
- Redirect traffic to attacker-controlled servers
- Perform man-in-the-middle attacks

**Mitigations:**
- Use mDNS only on trusted networks
- Validate service responses (check certificates for HTTPS/TLS services)
- Implement service-specific authentication

### Resource Exhaustion

**Compression bombs:** Deeply nested pointers could cause excessive CPU usage.
**Mitigation:** Pointer loop detection; maximum 20 jumps (though loops caught earlier).

**Large messages:** 65535-byte DNS messages could exhaust memory.
**Mitigation:** TCP length validation; streaming buffer accumulation.

### Information Disclosure

mDNS broadcasts service availability to the local network.

**Exposed information:**
- Device names
- Service types (printer, SSH, etc.)
- Software versions (in TXT records)
- Network topology

**Mitigation:** Disable mDNS on public/untrusted networks.

---

## References

- [RFC 6762: Multicast DNS](https://datatracker.ietf.org/doc/html/rfc6762)
- [RFC 6763: DNS-Based Service Discovery](https://datatracker.ietf.org/doc/html/rfc6763)
- [RFC 1035: Domain Names - Implementation and Specification](https://datatracker.ietf.org/doc/html/rfc1035)
- [Apple Bonjour Developer Documentation](https://developer.apple.com/bonjour/)
- [Avahi: Free Zeroconf Implementation](https://www.avahi.org/)
- [DNS-SD Service Type Registry](http://www.dns-sd.org/servicetypes.html)

---

## Troubleshooting

### No Response from mDNS Server

**Possible causes:**
1. Server doesn't support TCP (mDNS is primarily UDP multicast)
2. Firewall blocking port 5353
3. Service name doesn't exist
4. Server not responding to unicast queries

**Solutions:**
- Test with `dig @192.168.1.1 -p 5353 _http._tcp.local PTR`
- Use `avahi-browse -a` on Linux to verify services exist
- Try `unicastResponse: true` in query
- Check server logs for errors

### Invalid Response Format

**Error:** `Invalid DNS response: QR bit not set`

**Cause:** Server sent a query instead of a response, or TCP stream corrupted.

**Solution:** Check server implementation; validate TCP framing.

### DNS Compression Loop

**Error:** `DNS compression loop detected at offset X`

**Cause:** Malformed DNS message with circular pointer references.

**Solution:** Server bug or network corruption; test with different server.

### Empty Answers

**Response has `answerCount: 0`**

**Cause:** Service doesn't exist, or mDNS responder not configured.

**Solution:**
- Verify service name spelling (case-sensitive)
- Check service is actually running on target host
- Query `_services._dns-sd._udp.local` to enumerate available services

---

## Advanced Topics

### Building Custom Queries

Query ANY record type (even non-standard):

```typescript
const query = buildMDNSQuery('test.local', 99, false); // TYPE99
```

### Parsing Raw DNS Messages

```typescript
const response = parseMDNSResponse(buffer);

// Access raw fields
console.log(`Transaction ID: ${response.transactionId}`);
console.log(`Answers: ${response.answers.length}`);
console.log(`Additionals: ${response.additionals.length}`);

// Iterate records
for (const record of response.answers) {
  console.log(`${record.name} ${record.ttl} ${record.class} ${record.type} ${JSON.stringify(record.data)}`);
}
```

### Service Announcement Message Structure

The `buildMDNSAnnouncement()` function creates a DNS response with:

**Header:**
- Transaction ID: 0
- Flags: 0x8400 (QR=1, AA=1)
- QDCOUNT: 0 (no questions in response)
- ANCOUNT: 3 (PTR + SRV + TXT)

**Answer Section:**
1. PTR: `_http._tcp.local` → `My Service._http._tcp.local` (shared, no cache-flush)
2. SRV: `My Service._http._tcp.local` → `0 0 8080 myhost.local` (unique, cache-flush)
3. TXT: `My Service._http._tcp.local` → `["path=/", "version=1.0"]` (unique, cache-flush)

**No Additional Section:** Could include A/AAAA records for hostname resolution.

---

## Future Enhancements

**If UDP multicast support becomes available:**
1. True multicast query/response to `224.0.0.251:5353`
2. Continuous querying with exponential backoff
3. Known-answer suppression
4. Probing and conflict resolution
5. Service announcement with TTL=0 goodbye packets
6. IPv6 multicast to `FF02::FB`

**Protocol extensions:**
1. DNSSEC validation (RRSIG, DNSKEY records)
2. EDNS0 support (OPT pseudo-record)
3. Long-lived queries (LLQ) for push notifications
4. Update lease (RFC 2136) for dynamic updates

---

## Summary

This mDNS implementation provides RFC-compliant DNS message formatting and parsing over TCP, suitable for:
- Testing mDNS responders that support TCP
- Learning DNS/mDNS message format
- Building custom DNS tools
- Protocol debugging

**Not suitable for:**
- Production service discovery (use native Bonjour/Avahi)
- Multicast network scanning
- Zero-configuration networking in real deployments

For production mDNS, use platform-native implementations:
- **macOS/iOS:** `dns-sd` command-line, Bonjour API
- **Linux:** `avahi-browse`, `avahi-publish`, Avahi API
- **Windows:** Install Bonjour Print Services, or use third-party mDNS libraries
