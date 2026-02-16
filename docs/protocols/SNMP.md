# SNMP Protocol Implementation

## Overview

**Simple Network Management Protocol (SNMP)** is a widely-used protocol for monitoring and managing network devices. This implementation supports SNMPv1 and SNMPv2c over TCP (RFC 3430).

- **Port:** 161 (agent queries), 162 (traps - not yet implemented)
- **RFCs:** RFC 1157 (SNMPv1), RFC 1905 (SNMPv2c), RFC 3430 (SNMP over TCP)
- **Protocol:** TCP (Workers constraint - UDP not supported)
- **Encoding:** ASN.1/BER (Basic Encoding Rules)

## Features

- ✅ SNMPv1 and SNMPv2c support
- ✅ GET operation (single OID query)
- ✅ GETNEXT operation (sequential OID traversal)
- ✅ GETBULK operation (efficient bulk queries, v2c only)
- ✅ WALK operation (retrieve entire OID subtrees)
- ✅ Community-based authentication
- ✅ ASN.1/BER encoder/decoder
- ✅ Support for common data types (INTEGER, STRING, OID, IPADDRESS, COUNTER, GAUGE, TIMETICKS)

## API Endpoints

### POST /api/snmp/get

Query a single OID from an SNMP agent.

**Request:**
```json
{
  "host": "demo.snmplabs.com",
  "port": 161,
  "community": "public",
  "oid": "1.3.6.1.2.1.1.1.0",
  "version": 2,
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "results": [
    {
      "oid": "1.3.6.1.2.1.1.1.0",
      "type": "STRING",
      "value": "Linux demo 3.10.0 #1 SMP x86_64"
    }
  ]
}
```

**Response (Error):**
```json
{
  "success": false,
  "errorStatus": "noSuchName",
  "errorIndex": 1
}
```

### POST /api/snmp/walk

Retrieve multiple OIDs under a subtree (SNMP WALK).

**Request:**
```json
{
  "host": "demo.snmplabs.com",
  "port": 161,
  "community": "public",
  "oid": "1.3.6.1.2.1.1",
  "version": 2,
  "maxRepetitions": 10,
  "timeout": 30000
}
```

**Response:**
```json
{
  "success": true,
  "count": 7,
  "results": [
    {
      "oid": "1.3.6.1.2.1.1.1.0",
      "type": "STRING",
      "value": "Linux demo 3.10.0"
    },
    {
      "oid": "1.3.6.1.2.1.1.3.0",
      "type": "TIMETICKS",
      "value": 123456789
    },
    {
      "oid": "1.3.6.1.2.1.1.5.0",
      "type": "STRING",
      "value": "demo.snmplabs.com"
    }
  ]
}
```

## Common OIDs (MIB-II System Group)

| OID | Name | Description |
|-----|------|-------------|
| 1.3.6.1.2.1.1.1.0 | sysDescr | System description |
| 1.3.6.1.2.1.1.3.0 | sysUpTime | System uptime (timeticks) |
| 1.3.6.1.2.1.1.4.0 | sysContact | System contact |
| 1.3.6.1.2.1.1.5.0 | sysName | System name |
| 1.3.6.1.2.1.1.6.0 | sysLocation | System location |
| 1.3.6.1.2.1.1.7.0 | sysServices | System services |

## Usage Examples

### cURL - SNMP GET

```bash
curl -X POST http://localhost:8787/api/snmp/get \
  -H "Content-Type: application/json" \
  -d '{
    "host": "demo.snmplabs.com",
    "port": 161,
    "community": "public",
    "oid": "1.3.6.1.2.1.1.1.0",
    "version": 2
  }'
```

### cURL - SNMP WALK

```bash
curl -X POST http://localhost:8787/api/snmp/walk \
  -H "Content-Type: application/json" \
  -d '{
    "host": "demo.snmplabs.com",
    "port": 161,
    "community": "public",
    "oid": "1.3.6.1.2.1.1",
    "version": 2,
    "maxRepetitions": 10
  }'
```

### JavaScript

```javascript
// SNMP GET
const response = await fetch('/api/snmp/get', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    host: 'demo.snmplabs.com',
    community: 'public',
    oid: '1.3.6.1.2.1.1.1.0',
    version: 2,
  }),
});

const data = await response.json();
console.log(data.results[0].value); // System description
```

## Protocol Details

### SNMP Message Structure

```
SEQUENCE {
  version INTEGER (0=v1, 1=v2c)
  community OCTET STRING
  PDU {
    request-id INTEGER
    error-status INTEGER
    error-index INTEGER
    variable-bindings SEQUENCE OF {
      SEQUENCE {
        name OBJECT IDENTIFIER
        value ANY
      }
    }
  }
}
```

### ASN.1 BER Encoding

SNMP uses ASN.1 BER (Basic Encoding Rules) for message encoding:

- **Type-Length-Value (TLV)** encoding
- Type tags: INTEGER (0x02), OCTET_STRING (0x04), OID (0x06), SEQUENCE (0x30)
- SNMP-specific types: IPADDRESS (0x40), COUNTER32 (0x41), GAUGE32 (0x42), TIMETICKS (0x43)

### OID Encoding

OIDs are encoded using a compressed format:
- First two components: `40 * first + second`
- Remaining components: variable-length encoding (base 128)

Example: `1.3.6.1.2.1` → `[0x2B, 0x06, 0x01, 0x02, 0x01]`

## Authentication

### SNMPv1/v2c - Community Strings

- Uses plaintext community strings (default: "public" for read, "private" for write)
- No encryption
- Sent in every message

```json
{
  "community": "public"
}
```

### SNMPv3 (Not Yet Implemented)

- User-based authentication (MD5/SHA)
- Encryption (DES/AES)
- More secure than v1/v2c

## Timeouts and Keep-Alives

### Request Timeout

- Default: 10 seconds for GET, 30 seconds for WALK
- Configurable via `timeout` parameter
- TCP connection timeout handled separately

### Connection Management

- Each request opens a new TCP connection
- No persistent connections (stateless protocol)
- Connection closed after response received

### Walk Operation

- Iteratively sends GETNEXT/GETBULK requests
- Stops when:
  - No more results
  - Response OID outside requested subtree
  - Timeout reached

## Binary vs. Text Encoding

### Request Encoding

- **Wire Format:** Binary ASN.1 BER
- **API Input:** JSON (text)
- **Conversion:** JSON → BER in Worker

### Response Encoding

- **Wire Format:** Binary ASN.1 BER
- **API Output:** JSON (text)
- **Conversion:** BER → JSON in Worker

### Data Types

| SNMP Type | BER Tag | JavaScript Type |
|-----------|---------|-----------------|
| INTEGER | 0x02 | number |
| OCTET STRING | 0x04 | string |
| OBJECT IDENTIFIER | 0x06 | string (dotted) |
| IPADDRESS | 0x40 | string (dotted) |
| COUNTER32 | 0x41 | number |
| GAUGE32 | 0x42 | number |
| TIMETICKS | 0x43 | number |
| NULL | 0x05 | null |

## Error Handling

### SNMP Error Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | noError | No error |
| 1 | tooBig | Response too large |
| 2 | noSuchName | OID does not exist |
| 3 | badValue | Invalid value |
| 4 | readOnly | Attempted write to read-only OID |
| 5 | genErr | General error |

### Common Issues

**❌ "Connection timeout"**
- Agent is unreachable
- Firewall blocking port 161
- Incorrect host/port

**❌ "noSuchName"**
- OID does not exist on device
- Wrong MIB or OID format

**❌ "Authentication failed"**
- Incorrect community string
- SNMPv3 not supported yet

**❌ "Parse error"**
- Invalid ASN.1/BER response
- Malformed SNMP message
- Non-SNMP response on port

## Limitations

### What's Supported

- ✅ SNMPv1 and SNMPv2c
- ✅ TCP transport (RFC 3430)
- ✅ GET, GETNEXT, GETBULK
- ✅ Community-based authentication
- ✅ Common data types

### What's NOT Supported

- ❌ SNMPv3 (user-based security)
- ❌ UDP transport (Workers limitation)
- ❌ SET operations (write)
- ❌ TRAP/INFORM (async notifications)
- ❌ MIB compilation/resolution

### TCP vs. UDP

**Standard:** SNMP typically uses UDP (port 161)

**This Implementation:** Uses TCP (RFC 3430) due to Cloudflare Workers' TCP-only sockets API

**Impact:**
- Some devices may not support SNMP over TCP
- Most modern SNMP agents support both UDP and TCP
- TCP provides reliability but adds overhead

## Testing

### Public SNMP Test Servers

```bash
# demo.snmplabs.com (SNMPv1/v2c)
Host: demo.snmplabs.com
Community: public
Port: 161

# snmp.live.gambitcommunications.com
Host: snmp.live.gambitcommunications.com
Community: public
Port: 161
```

### Test with Example Client

```bash
# Open the test client
open examples/snmp-test.html

# Or use the deployed version
https://portofcall.ross.gg/examples/snmp-test.html
```

## Performance

### SNMP GET

- Single OID query
- Fast (< 100ms typical)
- One request/response

### SNMP WALK

- Multiple GETNEXT/GETBULK requests
- Slower (depends on subtree size)
- SNMPv2c GETBULK is more efficient than v1 GETNEXT

**Optimization:**
- Use SNMPv2c with high `maxRepetitions` (10-50)
- Limit walk scope to specific subtrees
- Set reasonable timeouts

## Security Considerations

### Community Strings

- ⚠️ Sent in plaintext (no encryption)
- ⚠️ Default "public" is widely known
- ⚠️ MITM attacks possible

**Best Practices:**
- Change default community strings
- Use SNMPv3 for sensitive data (not yet implemented)
- Restrict SNMP access via firewall
- Use read-only community strings

### Rate Limiting

- Implement rate limiting to prevent SNMP flooding
- Monitor query frequency
- Set reasonable timeouts

### Input Validation

- ✅ Host/port validation
- ✅ OID format validation
- ✅ Community string sanitization
- ✅ Cloudflare detection (prevents proxy abuse)

## Future Enhancements

- [ ] SNMPv3 support (authentication, encryption)
- [ ] SET operation support (write)
- [ ] TRAP/INFORM receiver
- [ ] MIB parsing and OID resolution
- [ ] Bulk parallel queries
- [ ] WebSocket-based continuous monitoring
- [ ] SNMP agent implementation (respond to queries)

## References

- [RFC 1157 - SNMPv1](https://www.rfc-editor.org/rfc/rfc1157)
- [RFC 1905 - SNMPv2c](https://www.rfc-editor.org/rfc/rfc1905)
- [RFC 3430 - SNMP over TCP](https://www.rfc-editor.org/rfc/rfc3430)
- [RFC 3416 - SNMPv2 Protocol Operations](https://www.rfc-editor.org/rfc/rfc3416)
- [ASN.1 BER Encoding](https://en.wikipedia.org/wiki/X.690#BER_encoding)

## Example Use Cases

### Network Monitoring

Query device uptime, interface statistics, CPU/memory usage

### Device Discovery

Walk system group to identify devices on network

### Capacity Planning

Collect counter data (traffic, errors, discards) over time

### Alerting

Monitor specific OIDs and trigger alerts on threshold violations
