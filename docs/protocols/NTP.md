# NTP Protocol Implementation

## Overview

**Network Time Protocol (NTP)** is a protocol for synchronizing computer clocks over packet-switched networks. This implementation supports NTPv4 over TCP (RFC 5905).

- **Port:** 123 (UDP standard, TCP supported)
- **RFC:** RFC 5905 (NTPv4)
- **Protocol:** TCP (Workers constraint - UDP not supported)
- **Encoding:** Binary (48-byte fixed packet format)

## Features

- ✅ NTPv4 client implementation
- ✅ High-precision time synchronization
- ✅ Clock offset calculation
- ✅ Round-trip delay measurement
- ✅ Stratum level reporting (distance from reference clock)
- ✅ Leap second indication
- ✅ Reference clock identification
- ✅ Root delay and dispersion metrics

## API Endpoints

### POST /api/ntp/query

Query an NTP server for accurate time synchronization.

**Request:**
```json
{
  "host": "time.cloudflare.com",
  "port": 123,
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "time": "2026-02-16T12:34:56.789Z",
  "offset": -42,
  "delay": 12,
  "stratum": 3,
  "precision": -6,
  "referenceId": "192.168.1.1",
  "rootDelay": 15.5,
  "rootDispersion": 8.2,
  "leapIndicator": "no warning"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

### POST /api/ntp/sync

Alias for `/api/ntp/query`. Returns the same synchronization information.

## Common NTP Servers

| Server | Provider | Notes |
|--------|----------|-------|
| time.cloudflare.com | Cloudflare | Fast, anycast |
| time.google.com | Google | Smeared leap seconds |
| time.nist.gov | NIST | US government standard |
| pool.ntp.org | NTP Pool Project | Community pool |
| time.apple.com | Apple | iOS/macOS default |
| time.windows.com | Microsoft | Windows default |

## Usage Examples

### cURL

```bash
curl -X POST http://localhost:8787/api/ntp/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "time.cloudflare.com",
    "port": 123
  }'
```

### JavaScript

```javascript
const response = await fetch('/api/ntp/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    host: 'time.cloudflare.com',
  }),
});

const data = await response.json();
console.log('Server time:', data.time);
console.log('Clock offset:', data.offset, 'ms');
console.log('Stratum:', data.stratum);
```

## Protocol Details

### NTP Packet Structure

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|LI | VN  |Mode |    Stratum    |     Poll      |   Precision   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Root Delay                            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      Root Dispersion                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Reference Identifier                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                  Reference Timestamp (64 bits)                |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                  Origin Timestamp (64 bits)                   |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                  Receive Timestamp (64 bits)                  |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                  Transmit Timestamp (64 bits)                 |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### NTP Timestamp Format

- **64 bits total**
  - 32 bits: Seconds since 1900-01-01 00:00:00 UTC
  - 32 bits: Fractional seconds (1/2^32 resolution ≈ 233 picoseconds)
- **Range:** 1900 to 2036 (136 years)
- **Resolution:** ~0.23 nanoseconds (theoretical)

### Leap Indicator (LI)

| Value | Meaning |
|-------|---------|
| 0 | No warning |
| 1 | Last minute of the day has 61 seconds |
| 2 | Last minute of the day has 59 seconds |
| 3 | Alarm condition (clock unsynchronized) |

### Stratum Levels

| Stratum | Description | Example Sources |
|---------|-------------|-----------------|
| 0 | Unspecified/invalid | - |
| 1 | Primary reference | GPS, atomic clock, radio clock |
| 2 | Secondary reference | Synced from Stratum 1 |
| 3-15 | Secondary reference | Synced from Stratum N-1 |
| 16 | Unsynchronized | - |

### Time Calculation

**Four timestamps are used:**
- **t1:** Client transmit time (sent in request)
- **t2:** Server receive time (from response)
- **t3:** Server transmit time (from response)
- **t4:** Client receive time (current time)

**Clock offset:**
```
offset = ((t2 - t1) + (t3 - t4)) / 2
```

**Round-trip delay:**
```
delay = (t4 - t1) - (t3 - t2)
```

**True time:**
```
true_time = t4 + offset
```

## Authentication

### NTPv4 (This Implementation)

- ⚠️ **No authentication** - open protocol
- Any client can query any server
- Vulnerable to man-in-the-middle attacks

### NTP Authentication (Not Implemented)

- **Symmetric keys:** Pre-shared secrets (MD5/SHA1)
- **Autokey:** Public-key cryptography
- **NTS (Network Time Security):** Modern encrypted NTP (RFC 8915)

**Security Note:** This implementation does NOT support authentication. Use trusted NTP servers and consider implementing NTS for production use.

## Timeouts and Keep-Alives

### Connection Timeout

- Default: 10 seconds
- Configurable via `timeout` parameter
- Applies to entire query (connect + request + response)

### No Keep-Alives

- NTP is stateless (single request-response)
- TCP connection opened, query sent, response received, connection closed
- No persistent connections needed

### Retry Strategy (Not Implemented)

Standard NTP clients typically:
- Query multiple servers
- Use exponential backoff (poll intervals: 64s, 128s, 256s, ...)
- Maintain long-term statistics

This implementation performs a single query without retries.

## Binary Encoding

### Request Encoding

- **Wire Format:** Binary (48 bytes minimum)
- **API Input:** JSON (text)
- **Conversion:** JSON → Binary packet in Worker

### Response Encoding

- **Wire Format:** Binary (48 bytes minimum)
- **API Output:** JSON (text)
- **Conversion:** Binary packet → JSON in Worker

### Timestamp Precision

- **NTP:** 64-bit (32.32 fixed point)
- **JavaScript:** 64-bit floating point (millisecond precision)
- **Loss of Precision:** Fractional milliseconds may be lost

### Endianness

- **NTP:** Big-endian (network byte order)
- **JavaScript:** Platform-dependent (typically little-endian)
- **Conversion:** Manual byte swapping required

## Error Handling

### Common Errors

**❌ "Connection timeout"**
- Server is unreachable
- Firewall blocking port 123
- Incorrect host/port

**❌ "Invalid NTP mode"**
- Server sent non-server response
- Wrong protocol on port 123
- Malformed response

**❌ "Invalid NTP packet: too short"**
- Truncated response
- Non-NTP response on port 123

**❌ "No response from NTP server"**
- Server didn't respond
- Connection dropped mid-query

### Stratum 0 or 16

- **Stratum 0:** Invalid/unspecified
- **Stratum 16:** Unsynchronized
- Both indicate the server is not suitable for time synchronization

### Large Offset

- Offset > 100ms: Clock likely needs synchronization
- Offset > 1000ms: Significant clock drift
- Offset > 10000ms: Check system time settings

### Kiss-o'-Death (KoD)

NTP servers can send "Kiss-o'-Death" packets to rate-limit or reject clients. This implementation does NOT handle KoD packets (not in basic NTPv4).

## Limitations

### What's Supported

- ✅ NTPv4 client queries
- ✅ TCP transport
- ✅ Clock offset and delay calculation
- ✅ Stratum, precision, reference ID
- ✅ Single-shot queries

### What's NOT Supported

- ❌ Authentication (MD5, SHA1, Autokey, NTS)
- ❌ UDP transport (Workers limitation)
- ❌ Server mode (responding to queries)
- ❌ Broadcast/multicast mode
- ❌ Kiss-o'-Death packet handling
- ❌ Multiple server queries for redundancy
- ❌ Long-term clock discipline algorithms
- ❌ NTPv1/v2/v3 (only NTPv4)

### TCP vs. UDP

**Standard:** NTP uses UDP (port 123)

**This Implementation:** Uses TCP due to Cloudflare Workers' TCP-only sockets API

**Impact:**
- Some NTP servers may not support TCP (most modern ones do)
- TCP adds overhead (handshake, ack packets)
- Slightly higher latency than UDP

## Performance

### Typical Query Time

- Fast servers (Cloudflare, Google): 10-50ms
- Moderate servers: 50-200ms
- Slow/distant servers: 200-1000ms

### Accuracy

- **Best case:** ±10ms (local network, low-latency server)
- **Typical:** ±50ms (internet, mid-latency server)
- **Worst case:** ±200ms (high-latency, distant server)

**Note:** TCP overhead slightly reduces accuracy compared to UDP.

### Optimization

- Use geographically close servers
- Use anycast servers (time.cloudflare.com, time.google.com)
- Query multiple servers and average results (not implemented)

## Testing

### Public NTP Servers

```bash
# Cloudflare (anycast, fast)
Host: time.cloudflare.com
Port: 123

# Google (anycast, smeared leap seconds)
Host: time.google.com
Port: 123

# NIST (US government standard)
Host: time.nist.gov
Port: 123

# NTP Pool (community pool)
Host: pool.ntp.org
Port: 123
```

### Test with Example Client

```bash
# Open the test client
open examples/ntp-test.html

# Or use the deployed version
https://portofcall.ross.gg/examples/ntp-test.html
```

### Verify Time Accuracy

```bash
# Compare with system time
date -u && curl -X POST http://localhost:8787/api/ntp/query \
  -H "Content-Type: application/json" \
  -d '{"host":"time.cloudflare.com"}' | jq -r '.time'
```

## Security Considerations

### No Encryption

- ⚠️ NTP packets are plaintext
- ⚠️ Vulnerable to eavesdropping and MITM attacks
- ⚠️ No authentication of server identity

### Time-Based Security Implications

- Incorrect time can break TLS/SSL certificates
- Kerberos authentication requires synchronized clocks (±5 minutes)
- Log timestamps may be incorrect

**Best Practices:**
- Use trusted NTP servers (Cloudflare, Google, NIST)
- Consider implementing NTS (Network Time Security) for sensitive applications
- Validate reasonable time values (not too far in past/future)
- Cross-check with multiple servers

### Rate Limiting

- Many NTP servers rate-limit aggressive clients
- Recommended: Query interval ≥ 64 seconds for production
- This implementation is stateless (no rate limiting)

## Use Cases

### Browser-Based Time Sync

Synchronize client-side time with authoritative sources (useful for time-sensitive web apps)

### Clock Skew Detection

Measure offset between client and server clocks

### Distributed Systems

Ensure consistent time across distributed systems (though ntpd/chrony preferred for production)

### Time Zone Independent Operations

NTP provides UTC time (no time zone conversions needed)

## Future Enhancements

- [ ] NTS (Network Time Security) support (RFC 8915)
- [ ] Multiple server queries with best-of-N selection
- [ ] Long-term clock discipline algorithm
- [ ] Kiss-o'-Death packet handling
- [ ] NTP pool rotation
- [ ] WebSocket-based continuous time sync
- [ ] NTP server mode (respond to queries)

## References

- [RFC 5905 - NTPv4 Specification](https://www.rfc-editor.org/rfc/rfc5905)
- [RFC 8915 - Network Time Security (NTS)](https://www.rfc-editor.org/rfc/rfc8915)
- [NTP Pool Project](https://www.pool.ntp.org/)
- [Cloudflare Time Services](https://www.cloudflare.com/time/)
- [Google Public NTP](https://developers.google.com/time)

## Example Output

```json
{
  "success": true,
  "time": "2026-02-16T18:30:45.123Z",
  "offset": -15,
  "delay": 8,
  "stratum": 2,
  "precision": -6,
  "referenceId": "192.168.1.1",
  "rootDelay": 12.5,
  "rootDispersion": 6.8,
  "leapIndicator": "no warning"
}
```

**Interpretation:**
- Server time is 2026-02-16 18:30:45.123 UTC
- Your clock is 15ms behind the server (fast)
- Round-trip delay is 8ms
- Server is Stratum 2 (synced from a Stratum 1 reference)
- Server clock precision is 2^-6 ≈ 15.6ms
- Server is synced to 192.168.1.1 (likely a local Stratum 1 server)
- Total delay to primary reference is 12.5ms
- Total dispersion (uncertainty) is 6.8ms
- No leap second warning
