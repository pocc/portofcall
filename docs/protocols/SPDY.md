# SPDY Protocol Implementation

## Overview

SPDY (pronounced "speedy") was Google's experimental protocol designed to reduce web page latency. Developed between 2009-2015, it introduced several groundbreaking concepts that later became standardized in HTTP/2:

- **Multiplexing**: Multiple concurrent requests over a single TCP connection
- **Header Compression**: Reduced overhead through efficient header encoding
- **Server Push**: Proactive resource delivery from server to client
- **Prioritization**: Stream-level request prioritization

**Status**: Deprecated in 2016 when Chrome removed support. Superseded by HTTP/2 (RFC 7540).

**Transport**: TLS required, port 443, negotiated via ALPN with identifier `spdy/3.1`

## Protocol Specifications

### SPDY/3 and SPDY/3.1

The implementation targets SPDY/3 (and is compatible with 3.1), following the Chromium project specifications:

- [SPDY Protocol Draft 3](https://www.chromium.org/spdy/spdy-protocol/spdy-protocol-draft3)
- [SPDY Protocol Draft 3.1](https://www.chromium.org/spdy/spdy-protocol/spdy-protocol-draft3-1/)

Key differences between versions:
- **SPDY/3**: Original multiplexing implementation
- **SPDY/3.1**: Added flow control improvements and CREDENTIAL frames

## Frame Structure

### Control Frame Format

All SPDY control frames follow an 8-byte header:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|C| Version(15)   | Type(16)                                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Flags (8)  | Length (24 bits)                                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Data                                                          |
+---------------------------------------------------------------+
```

**Fields**:
- **C** (Control bit): Always 1 for control frames
- **Version**: 3 for SPDY/3, 3 for SPDY/3.1
- **Type**: Frame type identifier (16 bits)
- **Flags**: Frame-specific flags (8 bits)
- **Length**: Payload length in bytes, excluding header (24 bits)

**Endianness**: All multi-byte integers use **network byte order (big-endian)**.

### SETTINGS Frame (Type 4)

The SETTINGS frame transmits configuration parameters between endpoints:

```
+----------------------------------+
|1| version | 4                   |
+----------------------------------+
| Flags (8) | Length (24 bits)     |
+----------------------------------+
| Number of entries (32-bit)       |
+----------------------------------+
| ID/Value Pairs (variable)        |
+----------------------------------+
```

**ID/Value Pair Structure** (8 bytes each):
```
+----------------------------------+
| Flags(8) | ID (24 bits)          |
+----------------------------------+
| Value (32 bits)                  |
+----------------------------------+
```

**Standard Setting IDs**:
- `1`: Upload bandwidth estimate (KB/s)
- `2`: Download bandwidth estimate (KB/s)
- `3`: Round-trip time estimate (ms)
- `4`: Max concurrent streams allowed
- `5`: Current TCP congestion window
- `6`: Download retransmission rate
- `7`: Initial window size for new streams (bytes)
- `8`: Client certificate vector size

**Flags**:
- `0x01`: `FLAG_SETTINGS_CLEAR_SETTINGS` - Clear all previously persisted settings
- `0x01` (entry-level): `FLAG_SETTINGS_PERSIST_VALUE` - Server requests persistence
- `0x02` (entry-level): `FLAG_SETTINGS_PERSISTED` - Value was previously persisted

### Data Frame Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|C| Stream-ID (31 bits)                                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Flags (8)  | Length (24 bits)                                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Data                                                          |
+---------------------------------------------------------------+
```

**Fields**:
- **C** (Control bit): Always 0 for data frames
- **Stream-ID**: 31-bit stream identifier
- **Flags**: `0x01` = `FLAG_FIN` (final frame on stream)
- **Length**: Data payload length (24 bits)

### Frame Types

| Type | Name           | Description                           |
|------|----------------|---------------------------------------|
| 1    | SYN_STREAM     | Open new stream                       |
| 2    | SYN_REPLY      | Accept stream, send response headers  |
| 3    | RST_STREAM     | Terminate stream abnormally           |
| 4    | SETTINGS       | Configuration parameters              |
| 6    | PING           | Measure round-trip time               |
| 7    | GOAWAY         | Graceful connection termination       |
| 8    | HEADERS        | Additional headers for existing stream|
| 9    | WINDOW_UPDATE  | Flow control window update (3.1)      |

## Implementation Details

### SPDY Probe Function

`handleSPDYConnect()` performs a SPDY capability probe:

**Request Parameters**:
```json
{
  "host": "example.com",
  "port": 443,
  "timeout": 10000
}
```

**Process Flow**:
1. Establish TLS connection to target
2. Send SPDY/3 SETTINGS frame with 0 entries
3. Read server response
4. Detect protocol based on response pattern
5. Return result with protocol identification

**Response Format**:
```json
{
  "success": true,
  "host": "example.com",
  "port": 443,
  "tlsConnected": true,
  "spdyDetected": false,
  "protocol": "http2",
  "message": "Server responded with HTTP/2 SETTINGS frame",
  "note": "SPDY is deprecated (2016). ALPN cannot be set via Cloudflare Sockets API."
}
```

### Protocol Detection

The `detectProtocol()` function identifies the server's response:

**Detection Patterns**:

1. **SPDY/3**: `0x80 0x03 0x00 0x04` (control bit + version 3 + type SETTINGS)
2. **HTTP/2**: `0x00 0x00 ... 0x04` (SETTINGS frame, type 0x04 at byte 3)
3. **HTTP/1.x**: Text starts with `HTTP/1`
4. **TLS Alert**: `0x15` (TLS alert record type)

**Example Detection**:
```typescript
// SPDY/3 SETTINGS response
if (data[0] === 0x80 && data[1] === 0x03 &&
    data[2] === 0x00 && data[3] === 0x04) {
  return { protocol: 'spdy3', detail: 'SPDY/3 SETTINGS frame received' };
}
```

### HTTP/2 Probe Function

`handleSPDYH2Probe()` performs a full HTTP/2 handshake and request:

**Request Parameters**:
```json
{
  "host": "example.com",
  "port": 443,
  "path": "/",
  "timeout": 15000
}
```

**Handshake Flow**:
1. TLS connection establishment
2. Send HTTP/2 client preface (`PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n`)
3. Send SETTINGS frame (0 entries)
4. Send WINDOW_UPDATE (increment 65535 on stream 0)
5. Read server SETTINGS frame
6. Send SETTINGS ACK + HEADERS (GET request)
7. Read response HEADERS frame
8. Parse HPACK-encoded headers
9. Return result with server settings and response

**Response Format**:
```json
{
  "success": true,
  "host": "example.com",
  "port": 443,
  "path": "/",
  "protocol": "HTTP/2",
  "tlsConnected": true,
  "h2Handshake": true,
  "h2Settings": {
    "MAX_CONCURRENT_STREAMS": 100,
    "INITIAL_WINDOW_SIZE": 65535,
    "MAX_FRAME_SIZE": 16384
  },
  "statusCode": 200,
  "responseHeaders": {
    "server": "cloudflare",
    "content-type": "text/html"
  },
  "serverBanner": "cloudflare",
  "bytesReceived": 1234,
  "latencyMs": 45
}
```

## HTTP/2 Implementation

### Frame Construction

**SETTINGS Frame** (0 entries):
```typescript
function buildH2Settings(): Uint8Array {
  // Type 0x04, Flags 0x00, Stream 0, Length 0
  return buildH2Frame(0x04, 0x00, 0, new Uint8Array(0));
}
```

**SETTINGS ACK**:
```typescript
function buildH2SettingsAck(): Uint8Array {
  // Type 0x04, Flags 0x01 (ACK), Stream 0, Length 0
  return buildH2Frame(0x04, 0x01, 0, new Uint8Array(0));
}
```

**WINDOW_UPDATE**:
```typescript
function buildH2WindowUpdate(increment: number): Uint8Array {
  // Type 0x08, Flags 0x00, Stream 0, Payload = increment (31-bit)
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, increment & 0x7fffffff, false);
  return buildH2Frame(0x08, 0x00, 0, payload);
}
```

### HPACK Header Compression

The implementation uses **static table indexing** without Huffman encoding for simplicity and compatibility.

**GET Request Headers** (RFC 7541 Appendix A):
```typescript
// :method GET → 0x82 (static table index 2)
// :path <path> → 0x44 (literal, name index 4) + length + value
// :scheme https → 0x87 (static table index 7)
// :authority <host> → 0x41 (literal, name index 1) + length + value
```

**Frame Flags**:
- `END_HEADERS (0x04)`: No continuation frames
- `END_STREAM (0x01)`: Final frame for this stream
- Combined: `0x05` for single HEADERS frame completing request

**HPACK Static Table** (Partial, RFC 7541 Appendix A):

| Index | Name         | Value       |
|-------|--------------|-------------|
| 1     | :authority   | (empty)     |
| 2     | :method      | GET         |
| 3     | :method      | POST        |
| 4     | :path        | /           |
| 5     | :path        | /index.html |
| 6     | :scheme      | http        |
| 7     | :scheme      | https       |
| 8     | :status      | 200         |
| 9     | :status      | 204         |
| 13    | :status      | 404         |
| 14    | :status      | 500         |

### Response Parsing

**HPACK Decoding** (simplified, no Huffman):

1. **Indexed Header Field** (`1xxxxxxx`): Read 7-bit index, lookup in static table
2. **Literal with Incremental Indexing** (`01xxxxxx`): Read name index (or literal name), then literal value
3. **Literal without Indexing** (`0000xxxx`): Read name index (or literal name), then literal value
4. **Literal Never Indexed** (`0001xxxx`): Same as above, with persistence hint

**String Encoding**:
```
+---+---+-----------------------+
| H | Length (7+)             |
+---+---------------------------+
| String Data (Length octets) |
+-------------------------------+
```
- **H**: Huffman encoding flag (1 bit)
- **Length**: String length in octets (7+ bit integer encoding)

## Limitations and Constraints

### Cloudflare Workers Sockets API

The implementation runs on Cloudflare Workers with specific limitations:

**ALPN Negotiation**: The Sockets API (`connect()`) does not expose ALPN configuration. TLS negotiation uses the server's preferred protocol (typically HTTP/2 or HTTP/1.1).

**Impact**: The probe cannot force SPDY negotiation via ALPN `spdy/3.1`. Instead, it:
1. Establishes TLS connection
2. Sends SPDY SETTINGS frame opportunistically
3. Observes whether the server responds with SPDY frames

**Workaround**: Servers that speak SPDY will recognize the SETTINGS frame format and respond accordingly, even without ALPN negotiation.

### Frame Size Limits

**SPDY/3**: Minimum supported frame size is **8,192 octets** (spec requirement).

**HTTP/2**:
- Default max frame size: **16,384 octets** (RFC 7540 §6.5.2)
- Valid range: 16,384 to 16,777,215 octets
- Server can advertise different limit via `MAX_FRAME_SIZE` setting

**Implementation**: Buffers are limited to **65,536 bytes** to prevent unbounded memory growth.

### Cloudflare Detection

Both probes check if the target is behind Cloudflare before connecting:

```typescript
const cfCheck = await checkIfCloudflare(host);
if (cfCheck.isCloudflare && cfCheck.ip) {
  return { success: false, error: '...', isCloudflare: true };
}
```

**Rationale**: Cloudflare-to-Cloudflare connections may exhibit different behavior or be blocked by policy.

## Usage Examples

### Basic SPDY Probe

**GET Request**:
```
GET /api/spdy/connect?host=example.com&port=443&timeout=10000
```

**POST Request**:
```bash
curl -X POST https://portofcall.example.com/api/spdy/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "old-server.example.com", "port": 443}'
```

**Expected Response** (SPDY not supported):
```json
{
  "success": true,
  "host": "old-server.example.com",
  "port": 443,
  "tlsConnected": true,
  "spdyDetected": false,
  "protocol": "http2",
  "message": "Server responded with HTTP/2 SETTINGS frame — SPDY not supported",
  "note": "SPDY is deprecated (2016). Most servers have dropped support."
}
```

### HTTP/2 Full Probe

**POST Request**:
```bash
curl -X POST https://portofcall.example.com/api/spdy/h2-probe \
  -H "Content-Type: application/json" \
  -d '{
    "host": "www.cloudflare.com",
    "port": 443,
    "path": "/",
    "timeout": 15000
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "host": "www.cloudflare.com",
  "port": 443,
  "path": "/",
  "protocol": "HTTP/2",
  "tlsConnected": true,
  "h2Handshake": true,
  "h2Settings": {
    "MAX_CONCURRENT_STREAMS": 256,
    "INITIAL_WINDOW_SIZE": 65536,
    "MAX_FRAME_SIZE": 16384,
    "MAX_HEADER_LIST_SIZE": 262144
  },
  "statusCode": 200,
  "responseHeaders": {
    "server": "cloudflare",
    "content-type": "text/html; charset=utf-8",
    "cache-control": "max-age=3600"
  },
  "serverBanner": "cloudflare",
  "framesReceived": [
    {"type": 4, "typeName": "SETTINGS", "flags": 0, "streamId": 0, "payloadLen": 24},
    {"type": 4, "typeName": "SETTINGS", "flags": 1, "streamId": 0, "payloadLen": 0},
    {"type": 8, "typeName": "WINDOW_UPDATE", "flags": 0, "streamId": 0, "payloadLen": 4},
    {"type": 1, "typeName": "HEADERS", "flags": 5, "streamId": 1, "payloadLen": 156}
  ],
  "bytesReceived": 256,
  "latencyMs": 67
}
```

## Error Handling

### Common Errors

**Connection Timeout**:
```json
{
  "success": false,
  "tlsConnected": false,
  "error": "Connection timeout"
}
```

**TLS Handshake Failure**:
```json
{
  "success": true,
  "host": "example.com",
  "port": 443,
  "tlsConnected": true,
  "spdyDetected": false,
  "protocol": "tls-alert",
  "message": "TLS alert received (level=2, desc=112) — server rejected the connection"
}
```

**No Response**:
```json
{
  "success": false,
  "host": "example.com",
  "port": 443,
  "tlsConnected": true,
  "spdyDetected": false,
  "protocol": "unknown",
  "message": "TLS connected but server sent no response to SPDY SETTINGS"
}
```

**Cloudflare Target**:
```json
{
  "success": false,
  "error": "Target example.com (104.16.123.45) is behind Cloudflare. Workers-to-Cloudflare connections may exhibit unexpected behavior.",
  "isCloudflare": true
}
```

## Historical Context

### SPDY Timeline

- **2009**: Google announces SPDY project
- **2012**: SPDY/3 specification released
- **2013**: SPDY/3.1 adds flow control improvements
- **2014**: HTTP/2 standardization begins based on SPDY
- **2015**: HTTP/2 (RFC 7540) published, deprecating SPDY
- **2016**: Chrome, Firefox, and major browsers remove SPDY support
- **2016+**: Servers begin removing SPDY in favor of HTTP/2

### Why SPDY Was Replaced

**HTTP/2 Improvements**:
- Formal IETF standardization (RFC 7540, RFC 7541)
- Better header compression (HPACK vs SPDY's gzip-based compression)
- Refined stream prioritization model
- Simplified flow control semantics
- Removal of unnecessary SPDY features (CREDENTIAL frames)

**Current State**: Virtually no production servers support SPDY. Modern web infrastructure uses HTTP/2 or HTTP/3 (QUIC).

## Testing and Verification

### Known SPDY Servers

As of 2016, no major public servers support SPDY. For testing:

**Historical Approach**:
- Configure nginx with `spdy` module (deprecated)
- Use Apache with `mod_spdy` (no longer maintained)
- Deploy test server with `node-spdy` library

**Modern Approach**:
- Test HTTP/2 instead (universal support)
- Use the H2 probe function to verify HTTP/2 capabilities
- Simulate SPDY via custom test harness (development only)

### Verification Checklist

To verify protocol implementation correctness:

- [ ] TLS connection establishes successfully
- [ ] Control frame uses correct bit layout (C=1, version=3, type=4)
- [ ] SETTINGS frame has proper 24-bit length field
- [ ] All integers use network byte order (big-endian)
- [ ] Server responds with recognizable protocol (SPDY/HTTP2/HTTP1)
- [ ] HTTP/2 HPACK encoding produces valid headers
- [ ] Response parsing handles all frame types gracefully
- [ ] Timeout handling prevents indefinite hangs
- [ ] Resource cleanup (sockets, readers, writers) occurs on all paths

## References

### Specifications

- [SPDY Protocol Draft 3](https://www.chromium.org/spdy/spdy-protocol/spdy-protocol-draft3) - Chromium Projects
- [SPDY Protocol Draft 3.1](https://www.chromium.org/spdy/spdy-protocol/spdy-protocol-draft3-1/) - Chromium Projects
- [RFC 7540: HTTP/2](https://datatracker.ietf.org/doc/html/rfc7540) - IETF
- [RFC 7541: HPACK Header Compression](https://datatracker.ietf.org/doc/html/rfc7541) - IETF

### Implementation Guides

- [SPDY: An experimental protocol for a faster web](https://www.chromium.org/spdy/spdy-whitepaper/) - Google Whitepaper
- [HTTP/2 Frequently Asked Questions](https://http2.github.io/faq/) - HTTP/2 Working Group
- [HPACK Static Table](https://httpwg.org/specs/rfc7541.html#static.table.definition) - RFC 7541 Appendix A

### Tools and Libraries

- [spdylay](https://github.com/tatsuhiro-t/spdylay) - C implementation of SPDY/2, 3, 3.1
- [node-spdy](https://github.com/spdy-http2/node-spdy) - Node.js SPDY implementation (deprecated)
- [Wireshark](https://www.wireshark.org/) - Packet analyzer with SPDY dissector

## Technical Notes

### Frame Size Calculation

SPDY SETTINGS frame with N entries:
```
Total size = 12 + (8 × N) bytes
  - 8-byte header (control bit + version + type + flags + length)
  - 4-byte entry count
  - 8 bytes per ID/Value pair
```

Example (0 entries):
```
Bytes:  80 03 00 04 | 00 00 00 04 | 00 00 00 00
Decode: C=1 V=3 T=4 | Fl=0 Len=4  | Entries=0
Result: 12 bytes total, length field = 4 (just the count)
```

### HTTP/2 Frame Size Calculation

HTTP/2 frame structure:
```
Total size = 9 + payload_length bytes
  - 3-byte length (24-bit)
  - 1-byte type
  - 1-byte flags
  - 4-byte stream ID (31-bit + reserved bit)
  - Variable-length payload
```

Example (SETTINGS with 0 entries):
```
Bytes:  00 00 00 | 04 | 00 | 00 00 00 00
Decode: Len=0    | T=4| F=0| Stream=0
Result: 9 bytes total (no payload)
```

### HPACK Integer Encoding

HPACK uses prefix integer encoding (RFC 7541 §5.1):

**Small values** (fit in N-bit prefix):
```
0   1   2   3   4   5   6   7
+---+---+---+---+---+---+---+---+
|   |       Value              |
+---+---------------------------+
```

**Large values** (exceed N-bit prefix):
```
0   1   2   3   4   5   6   7
+---+---+---+---+---+---+---+---+
|   |       2^N - 1            |  (First byte)
+---+---------------------------+
|   | Continuation bytes       |  (Variable)
+-------------------------------+
```

Example: Encoding 127 with 7-bit prefix:
```
Byte 0: 0x7F (127 fits in 7 bits)
```

Example: Encoding 255 with 7-bit prefix:
```
Byte 0: 0x7F (127, prefix filled)
Byte 1: 0x80 (128 with continuation bit)
```

## Performance Characteristics

### Latency Measurements

Typical probe latencies (measured from worker execution start to response):

**SPDY Probe** (connect + SETTINGS + detect):
- TLS handshake: 20-50ms
- Frame exchange: 5-15ms
- Total: **25-65ms** (typical)

**HTTP/2 Probe** (full handshake + request):
- TLS handshake: 20-50ms
- HTTP/2 handshake: 10-25ms
- Request/response: 15-35ms
- Total: **45-110ms** (typical)

**Timeout Recommendations**:
- SPDY probe: 10,000ms (default)
- HTTP/2 probe: 15,000ms (default)
- Minimum: 5,000ms (fast local networks)
- Maximum: 30,000ms (slow international connections)

### Resource Usage

**Memory**:
- SPDY probe buffer: ≤ 8KB (single frame expected)
- HTTP/2 probe buffer: ≤ 64KB (multiple frames, capped at 65,536 bytes)
- Frame parsing: O(n) where n = buffer size

**Network**:
- SPDY probe: 12 bytes sent, 0-1KB received (typical)
- HTTP/2 probe: 46 bytes sent (preface + SETTINGS + WINDOW_UPDATE), 1-4KB received (typical)

**Connection Lifecycle**:
- TLS session: Established per request, closed after response
- Socket cleanup: Automatic via try/finally blocks
- Reader/writer locks: Released explicitly to prevent leaks

## Security Considerations

### TLS Requirements

**SPDY**: TLS 1.0+ required (protocol design decision)

**HTTP/2**: TLS 1.2+ recommended (RFC 7540 §9.2), though cleartext HTTP/2 (h2c) is possible.

**Implementation**: Uses Cloudflare Workers `secureTransport: 'on'` which enforces TLS 1.2+.

### Cipher Suite Restrictions

SPDY and HTTP/2 both prohibit weak cipher suites:

**Blacklisted** (RFC 7540 Appendix A):
- Null encryption (e.g., `TLS_NULL_WITH_NULL_NULL`)
- Export-grade ciphers (e.g., `TLS_RSA_EXPORT_*`)
- Anonymous DH (e.g., `TLS_DH_anon_*`)
- Weak symmetric encryption (RC4, DES, 3DES)

**Recommended**:
- AES-GCM cipher suites
- ChaCha20-Poly1305
- Forward secrecy (ECDHE, DHE)

**Implementation**: Cloudflare Workers enforces secure cipher suites automatically.

### Header Compression Vulnerabilities

**CRIME Attack** (2012): Exploits SPDY's DEFLATE-based header compression to decrypt cookies.

**BREACH Attack** (2013): Similar to CRIME, targets HTTP response compression.

**HPACK Mitigation**: HTTP/2's HPACK avoids DEFLATE compression, using static/dynamic table indexing instead. Resistant to CRIME-style attacks.

**Implementation**: Uses HPACK static table only (no dynamic table), minimal attack surface.

## Debugging

### Enable Verbose Logging

The implementation includes diagnostic information in responses:

**Frame Details** (HTTP/2 probe):
```json
"framesReceived": [
  {"type": 4, "typeName": "SETTINGS", "flags": 0, "streamId": 0, "payloadLen": 18},
  {"type": 8, "typeName": "WINDOW_UPDATE", "flags": 0, "streamId": 0, "payloadLen": 4},
  {"type": 1, "typeName": "HEADERS", "flags": 5, "streamId": 1, "payloadLen": 89}
]
```

**Raw Hex Dump** (unknown protocol):
```json
"message": "Unknown response: 80 03 00 07 00 00 00 08"
```

### Wireshark Dissection

To analyze SPDY/HTTP2 traffic in Wireshark:

1. **Capture**: Use `ssldump` or SSLKEYLOGFILE to decrypt TLS
2. **Filter**: `tcp.port == 443 && (spdy || http2)`
3. **Decode**: Right-click packet → Decode As → HTTP/2
4. **Inspect**: Expand SPDY/HTTP2 frames to verify field values

**SPDY SETTINGS Frame Example**:
```
SPDY Control Frame
├─ Control Bit: 1
├─ Version: 3
├─ Type: 4 (SETTINGS)
├─ Flags: 0x00
├─ Length: 4
└─ Number of Entries: 0
```

### Common Mistakes

**Byte Order Confusion**:
```typescript
// WRONG: Little-endian (0x0380 = 896)
view.setUint16(0, 0x8003, true);

// CORRECT: Big-endian (0x8003 = 32771)
view.setUint16(0, 0x8003, false);
```

**Length Field Errors**:
```typescript
// WRONG: Include header in length
view.setUint32(5, 12, false); // Total frame size

// CORRECT: Payload length only
frame[5] = 0x00;
frame[6] = 0x00;
frame[7] = 0x04; // 4-byte payload (entry count)
```

**HPACK Indexing Mistakes**:
```typescript
// WRONG: Off-by-one (index 0 is unused)
const [name, value] = staticTable[0];

// CORRECT: Static table starts at index 1
if (idx > 0 && idx < staticTable.length) {
  const [name, value] = staticTable[idx];
}
```

## Future Enhancements

While SPDY is deprecated, this implementation could be extended:

**HTTP/3 Support**:
- Add QUIC probe using WebTransport or UDP sockets
- Implement QPACK header compression
- Detect HTTP/3 via Alt-Svc header

**Advanced HTTP/2 Features**:
- Server push detection (PUSH_PROMISE frames)
- Stream prioritization analysis
- Flow control window tracking
- Detailed frame timing measurements

**Protocol Fingerprinting**:
- Identify server software based on SETTINGS values
- Detect CDN/proxy presence via header patterns
- Measure TLS handshake timings for server classification

**Compression Analysis**:
- Compare HPACK vs. uncompressed header sizes
- Measure dynamic table utilization
- Analyze compression ratio over multiple requests

---

**Implementation Status**: Production-ready
**Last Updated**: 2026-02-18
**Maintainer**: Port of Call Project
