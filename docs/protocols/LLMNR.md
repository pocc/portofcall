# LLMNR (Link-Local Multicast Name Resolution) - Port 5355

## Protocol Overview

LLMNR (RFC 4795) is Windows' equivalent of mDNS (Multicast DNS) for local network name resolution. It allows hosts on the same local network to resolve each other's hostnames to IP addresses without requiring a DNS server.

**Key Characteristics:**
- **Port**: 5355 (UDP multicast 224.0.0.252, or TCP unicast)
- **RFC**: RFC 4795
- **Protocol Type**: DNS-like binary protocol
- **Primary Use**: Windows workgroup name resolution, local device discovery
- **Record Types**: A (IPv4), AAAA (IPv6)

## Protocol Structure

### Packet Format

LLMNR uses a DNS-like packet structure:

```
Header (12 bytes):
  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
  |                      ID                       |
  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
  |QR|   Opcode  |AA|TC|TD| Z| Z| Z| Z|   RCODE   |
  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
  |                    QDCOUNT                    |
  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
  |                    ANCOUNT                    |
  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
  |                    NSCOUNT                    |
  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
  |                    ARCOUNT                    |
  +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+

Question Section:
  - Domain name (variable length, label-encoded)
  - QTYPE (2 bytes): 1=A, 28=AAAA, 255=ANY
  - QCLASS (2 bytes): 1=IN (Internet)

Answer Section (in response):
  - Domain name (variable length, with compression)
  - TYPE (2 bytes)
  - CLASS (2 bytes)
  - TTL (4 bytes)
  - RDLENGTH (2 bytes)
  - RDATA (variable length): IP address bytes
```

### Query Types

| Type | Value | Description |
|------|-------|-------------|
| A | 1 | IPv4 address |
| AAAA | 28 | IPv6 address |
| ANY | 255 | All available records |

### Domain Name Encoding

Domain names are encoded using DNS label format:
- Each label is prefixed with its length (1 byte)
- Labels are concatenated
- Terminated with a zero-length label (0x00)
- Compression pointers allowed in responses (0xC0 prefix)

Example: `DESKTOP-PC` → `0x0A DESKTOP-PC 0x00`

## Implementation Details

### Request Flow

1. **Build Query**:
   - Random transaction ID
   - Standard query flags (0x0000)
   - QDCOUNT = 1
   - Encode hostname as DNS labels
   - Append QTYPE and QCLASS

2. **Send Query**:
   - Connect to target host:5355 via TCP
   - Send binary query packet
   - Set timeout (default 10 seconds)

3. **Parse Response**:
   - Read DNS-like header
   - Parse answer section
   - Decode domain names (handle compression)
   - Extract IP addresses from RDATA

### Key Functions

```typescript
// Build LLMNR query packet
function buildLLMNRQuery(name: string, type: number): Uint8Array

// Parse LLMNR response packet
function parseLLMNRResponse(data: Uint8Array): { answers: LLMNRRecord[] }

// Encode DNS domain name with labels
function encodeDomainName(name: string): Uint8Array

// Decode DNS domain name (with compression support)
function decodeDomainName(data: Uint8Array, offset: number): { name: string; nextOffset: number }
```

## Differences from mDNS

While LLMNR and mDNS serve similar purposes, they have key differences:

| Feature | LLMNR | mDNS |
|---------|-------|------|
| **Platform** | Windows-centric | Cross-platform (Apple, Linux, Windows) |
| **Port** | 5355 | 5353 |
| **Multicast Address** | IPv4: 224.0.0.252, IPv6: FF02::1:3 | IPv4: 224.0.0.251, IPv6: FF02::FB |
| **Service Discovery** | No | Yes (DNS-SD, PTR records) |
| **Complexity** | Simpler, name resolution only | More complex, full service discovery |
| **TLD** | .local (not standardized) | .local (RFC 6762) |
| **Caching** | Basic | Advanced with cache coherency |

## API Endpoint

### `/api/llmnr/query`

Query a hostname via LLMNR.

**Method**: `POST`

**Request Body**:
```json
{
  "host": "192.168.1.100",
  "port": 5355,
  "name": "DESKTOP-PC",
  "type": 1,
  "timeout": 10000
}
```

**Response**:
```json
{
  "success": true,
  "answers": [
    {
      "name": "DESKTOP-PC",
      "type": 1,
      "class": 1,
      "ttl": 30,
      "address": "192.168.1.100"
    }
  ]
}
```

## Testing

Use the interactive test client at `/examples/llmnr-test.html` to:
- Query Windows hostnames on your network
- Test A, AAAA, and ANY record queries
- Inspect raw LLMNR responses
- Debug name resolution issues

## Common Use Cases

1. **Windows Workgroup Networks**
   - Name resolution without DNS server
   - `\\DESKTOP-PC\share` network paths
   - NetBIOS name resolution fallback

2. **Local Device Discovery**
   - Finding Windows computers on LAN
   - Network printer discovery
   - File sharing between Windows machines

3. **Corporate Windows Networks**
   - Supplement DNS for local names
   - Fallback when DNS is unavailable
   - Cross-subnet name resolution (with unicast)

## VERIFY & EDGE CASES

### ✅ Implementation Verification

#### Core Functionality
- [x] DNS-like packet encoding/decoding
- [x] Domain name label encoding (length-prefixed)
- [x] Domain name compression pointer handling (0xC0 prefix)
- [x] A record (IPv4) parsing
- [x] AAAA record (IPv6) parsing
- [x] TTL extraction from responses
- [x] Multiple answer record handling
- [x] Transaction ID randomization
- [x] Timeout handling with configurable duration
- [x] Cloudflare protection check

#### Protocol Compliance
- [x] Standard DNS header format (12 bytes)
- [x] QTYPE support: A (1), AAAA (28), ANY (255)
- [x] QCLASS: IN (1) - Internet class
- [x] Query flags: Standard query (0x0000)
- [x] Response parsing with ANCOUNT field
- [x] RDLENGTH-based RDATA extraction

#### Error Handling
- [x] Connection timeout
- [x] Response timeout
- [x] Invalid response format detection
- [x] Missing required fields validation
- [x] Socket error handling

### ⚠️ Edge Cases & Limitations

#### Protocol Limitations

1. **UDP Multicast vs TCP Unicast**
   - **Standard**: LLMNR uses UDP multicast (224.0.0.252:5355)
   - **Implementation**: Uses TCP unicast (Cloudflare Workers limitation)
   - **Impact**: Must target specific host IP, cannot broadcast to all hosts
   - **Workaround**: Requires knowing target host IP in advance

2. **No Service Discovery**
   - **Limitation**: LLMNR only resolves names, no service info (unlike mDNS SRV records)
   - **Impact**: Cannot discover services (e.g., _http._tcp.local)
   - **Alternative**: Use mDNS implementation for service discovery

3. **Domain Name Length**
   - **Limit**: Each label max 63 bytes, total name max 253 bytes
   - **Handling**: Implementation respects DNS label limits
   - **Error**: Names exceeding limits will fail to encode

#### Parsing Edge Cases

1. **Compression Pointers**
   ```
   Scenario: Response uses DNS compression (0xC0 offset pointer)
   Example: Name at offset 0x0C referenced by pointer 0xC00C
   Handling: Recursive decodeDomainName() follows pointers
   Validation: Prevents infinite loops with pointer validation
   ```

2. **Malformed Responses**
   ```
   Scenario: Response packet shorter than 12 bytes (header size)
   Handling: Throws "LLMNR response too short" error
   Recovery: Returns 500 error with descriptive message
   ```

3. **Zero Answers**
   ```
   Scenario: ANCOUNT = 0 (name not found or no records)
   Handling: Returns empty answers array
   Client: Displays "No records found" with troubleshooting tips
   ```

4. **Mixed Record Types**
   ```
   Scenario: Response contains both A and AAAA records for same name
   Handling: Parses all records, returns array with both types
   Client: Displays all records with type labels
   ```

5. **Invalid IP Addresses**
   ```
   Scenario: A record with RDLENGTH != 4 or AAAA with RDLENGTH != 16
   Handling: Skips record (address = '')
   Impact: Only valid IP addresses included in response
   ```

#### Network Edge Cases

1. **Connection Refused**
   ```
   Scenario: Target host doesn't listen on port 5355
   Error: Socket connection fails immediately
   Response: 500 error "Connection refused" or timeout
   ```

2. **Partial Response**
   ```
   Scenario: TCP connection succeeds but no data received
   Handling: Timeout promise rejects after configured duration
   Error: "No response" after timeout
   ```

3. **Slow Network**
   ```
   Scenario: High latency network, response takes >10 seconds
   Handling: Configurable timeout parameter (1-30 seconds)
   Recovery: Increase timeout value in request
   ```

4. **Firewall Blocking**
   ```
   Scenario: Corporate firewall blocks port 5355
   Result: Connection timeout or refused
   Debugging: Test with different hosts or ports
   ```

#### Windows-Specific Edge Cases

1. **LLMNR Disabled**
   ```
   Scenario: Windows host has LLMNR disabled via Group Policy
   Registry: HKLM\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient\EnableMulticast = 0
   Result: Connection refused or timeout
   Workaround: Use NetBIOS or DNS instead
   ```

2. **Firewall Rules**
   ```
   Scenario: Windows Firewall blocks LLMNR traffic
   Rule: Inbound UDP 5355 blocked
   Impact: Queries from other hosts fail
   Solution: Enable "Network Discovery" in Windows settings
   ```

3. **Case Sensitivity**
   ```
   Scenario: Query "desktop-pc" vs "DESKTOP-PC"
   Behavior: LLMNR is case-insensitive per DNS spec
   Implementation: Names normalized by Windows responder
   ```

### 🔧 Testing Scenarios

#### Basic Functionality
```bash
# Query Windows hostname for IPv4 address
curl -X POST http://localhost:8787/api/llmnr/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.100",
    "name": "DESKTOP-PC",
    "type": 1,
    "timeout": 10000
  }'

# Expected: { "success": true, "answers": [{ "address": "192.168.1.100", ... }] }
```

#### IPv6 Query
```bash
# Query for IPv6 address (AAAA record)
curl -X POST http://localhost:8787/api/llmnr/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.100",
    "name": "WIN10-LAPTOP",
    "type": 28,
    "timeout": 10000
  }'

# Expected: IPv6 address in colon-separated hex format
```

#### ANY Query
```bash
# Query for all available records
curl -X POST http://localhost:8787/api/llmnr/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.100",
    "name": "SERVER-01",
    "type": 255,
    "timeout": 10000
  }'

# Expected: Array with both A and AAAA records if available
```

#### Error Cases
```bash
# Missing hostname
curl -X POST http://localhost:8787/api/llmnr/query \
  -H "Content-Type: application/json" \
  -d '{ "host": "192.168.1.100", "type": 1 }'
# Expected: 400 "Host and name required"

# Connection timeout
curl -X POST http://localhost:8787/api/llmnr/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.999",
    "name": "INVALID",
    "type": 1,
    "timeout": 2000
  }'
# Expected: 500 "Timeout" or connection error

# Cloudflare-protected host
curl -X POST http://localhost:8787/api/llmnr/query \
  -H "Content-Type: application/json" \
  -d '{
    "host": "cloudflare.com",
    "name": "test",
    "type": 1
  }'
# Expected: 403 with Cloudflare protection message
```

### 📊 Performance Considerations

1. **Timeout Tuning**
   - Default: 10 seconds
   - Fast LAN: 2-5 seconds sufficient
   - Slow/WAN: 15-30 seconds recommended
   - Trade-off: Faster failures vs allowing slow responses

2. **Transaction ID Collisions**
   - Probability: 1/65536 per query
   - Impact: Minimal (new ID per query)
   - Mitigation: Random ID generation via Math.random()

3. **Socket Cleanup**
   - Pattern: Always close socket in finally/catch blocks
   - Resources: Writer/reader locks released before close
   - Importance: Prevents socket leaks in Workers environment

### 🔒 Security Considerations

1. **Name Spoofing**
   - Risk: Malicious host could respond to LLMNR queries with false IPs
   - Mitigation: LLMNR lacks authentication (inherent protocol limitation)
   - Best Practice: Use only on trusted networks

2. **LLMNR Poisoning Attacks**
   - Attack: Attacker responds faster than legitimate host
   - Tool: Responder.py commonly used for LLMNR poisoning
   - Defense: Disable LLMNR on Windows via Group Policy if unused
   - Corporate: Consider DNS over TLS or DNSSEC instead

3. **Information Disclosure**
   - Risk: LLMNR reveals hostnames and IP addresses
   - Impact: Network reconnaissance via LLMNR queries
   - Mitigation: Firewall LLMNR traffic at network perimeter

### 🎯 Production Recommendations

1. **Prefer mDNS over LLMNR**
   - mDNS: More standardized, better cross-platform support
   - LLMNR: Windows-only, less widely deployed
   - Use Case: LLMNR only when targeting Windows environments

2. **Validate Responses**
   - Check: Response name matches query name
   - Verify: IP address format is valid (4 bytes for A, 16 for AAAA)
   - Log: Suspicious responses for security monitoring

3. **Timeout Configuration**
   - Interactive: 5-10 seconds
   - Batch/Scripts: 2-3 seconds (fail fast)
   - Unreliable Networks: 15-20 seconds

4. **Error Handling**
   - Always: Provide fallback mechanisms (DNS, NetBIOS)
   - Never: Assume LLMNR will succeed
   - Log: All failures for troubleshooting

## References

- [RFC 4795 - Link-Local Multicast Name Resolution (LLMNR)](https://tools.ietf.org/html/rfc4795)
- [RFC 1035 - Domain Names - Implementation and Specification](https://tools.ietf.org/html/rfc1035)
- [RFC 6762 - Multicast DNS (mDNS)](https://tools.ietf.org/html/rfc6762)
- [Microsoft LLMNR Documentation](https://docs.microsoft.com/en-us/windows/win32/dns/dns-llmnr-names)
