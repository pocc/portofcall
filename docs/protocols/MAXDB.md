# SAP MaxDB Protocol Implementation Guide

## Overview

SAP MaxDB (formerly SAP DB) is a relational database management system developed by SAP SE. It uses the **SAP NI (Network Interface)** protocol for client-server communication, providing a network routing layer between clients and database instances.

## Protocol Architecture

### Network Communication Layers

MaxDB uses a two-tier architecture for network communication:

1. **Global Listener (NI Router)** - Port 7200 (default)
   - Receives initial connection requests
   - Routes clients to appropriate database instances
   - Returns X Server port information
   - Handles service discovery and enumeration

2. **X Server (Database Process)** - Dynamic port (e.g., 7210)
   - Actual database instance
   - Handles SQL queries and transactions
   - Manages database sessions
   - Uses proprietary SQLDBC binary protocol

### Default Ports

| Port | Service | Description |
|------|---------|-------------|
| 7200 | Global Listener | NI router, service discovery |
| 7210 | X Server (sql6) | Database instance (default) |
| 7269 | NI (standard) | SAP NI protocol |
| 7270 | NISSL | NI with SSL/TLS encryption |

## SAP NI Protocol Specification

### Packet Format

All NI packets follow this 8-byte header format (big-endian):

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      Total Length (uint32)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| NI Version    | Message Type  |      Return Code (uint16)     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Payload ...                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Header Fields

| Offset | Size | Field | Endianness | Description |
|--------|------|-------|------------|-------------|
| 0-3 | 4 bytes | Total Length | Big-endian | Total packet size including header (minimum 8) |
| 4 | 1 byte | NI Version | N/A | Protocol version (0x03 for modern MaxDB) |
| 5 | 1 byte | Message Type | N/A | Packet type (see below) |
| 6-7 | 2 bytes | Return Code | Big-endian | Status code (0 = success) |
| 8+ | Variable | Payload | N/A | Message-specific data |

### Message Types

| Value | Name | Direction | Description |
|-------|------|-----------|-------------|
| 0x00 | NI_DATA | Bidirectional | Data packet (general purpose) |
| 0x04 | NI_CONNECT | Client → Server | Connection request |
| 0x05 | NI_ERROR | Server → Client | Error response |
| 0xFF | NI_INFO | Client → Server | Information request (service enumeration) |

### Return Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 0 | Success | Operation completed successfully |
| Non-zero | Error | Error code (payload contains error message) |

## Connection Flow

### 1. Service Discovery (NI_CONNECT)

```
Client                   Global Listener (7200)
  |                              |
  |  NI_CONNECT                  |
  |  "D=MAXDB\n\n\r\0"           |
  |----------------------------->|
  |                              |
  |  NI_CONNECT/NI_DATA          |
  |  [4-byte X Server port]      |
  |<-----------------------------|
  |                              |
```

**Request Payload (Client → Listener):**
```
Service descriptor: null-terminated string
Format: "D={database_name}\n\n\r\0"
Example: "D=MAXDB\n\n\r\0"
```

**Response Payload (Listener → Client):**
```
Success: 4-byte big-endian uint32 containing X Server port number
Error: UTF-8 error message string
```

### 2. Database Enumeration (NI_INFO)

```
Client                   Global Listener (7200)
  |                              |
  |  NI_INFO (empty payload)     |
  |----------------------------->|
  |                              |
  |  NI_INFO/NI_DATA             |
  |  [database listing]          |
  |<-----------------------------|
  |                              |
```

**Response Format:**
```
DBNAME1  7210  ONLINE
DBNAME2  7211  OFFLINE
DBNAME3  7212  STARTING
```

Each line contains:
- Database name (alphanumeric, max 18 chars)
- X Server port number
- Status information

### 3. Database Session Establishment

```
Client          Listener (7200)        X Server (7210)
  |                  |                        |
  | (1) NI_CONNECT   |                        |
  |----------------->|                        |
  | (2) Port=7210    |                        |
  |<-----------------|                        |
  |                  |                        |
  | (3) Connect to X Server                   |
  |------------------------------------------>|
  |                  |                        |
  | (4) NI_CONNECT   |                        |
  |  "D=MAXDB\n\n\r\0"                        |
  |------------------------------------------>|
  |                  |                        |
  | (5) Session greeting/challenge            |
  |<------------------------------------------|
  |                  |                        |
  | (6) Auth + SQL (SQLDBC protocol)          |
  |<=========================================>|
```

## Implementation Details

### Building NI Packets

```typescript
function buildNIPacket(type: number, payload: Uint8Array): Uint8Array {
  const totalLen = 8 + payload.length;
  const pkt = new Uint8Array(totalLen);
  const dv = new DataView(pkt.buffer);

  dv.setUint32(0, totalLen, false);  // Big-endian total length
  pkt[4] = 0x03;                     // NI protocol version
  pkt[5] = type;                     // Message type
  dv.setUint16(6, 0, false);         // Return code = 0 (success)
  pkt.set(payload, 8);

  return pkt;
}
```

### Parsing NI Packets

```typescript
function parseNIPacket(data: Uint8Array): {
  totalLen: number;
  version: number;
  type: number;
  rc: number;
  payload: Uint8Array;
} | null {
  if (data.length < 8) return null;

  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalLen = dv.getUint32(0, false);
  const version = data[4];
  const type = data[5];
  const rc = dv.getUint16(6, false);
  const payloadEnd = Math.min(totalLen, data.length);
  const payload = data.slice(8, payloadEnd);

  return { totalLen, version, type, rc, payload };
}
```

### Reading Length-Prefixed Packets

NI uses a length-prefixed framing protocol. To read a complete packet:

1. Read at least 4 bytes to get the length field
2. Parse the 4-byte big-endian uint32 total length
3. Continue reading until `totalLength` bytes have been received
4. Validate minimum length (8 bytes for header)
5. Parse the complete packet

**Important:** The length field includes the 8-byte header, so:
```
Payload size = Total Length - 8
```

### Service Descriptor Format

The service descriptor identifies which database to connect to:

```
"D={database_name}\n\n\r\0"
```

Components:
- `D=` prefix (routing key)
- Database name (alphanumeric, typically uppercase)
- Two newlines (`\n\n`)
- Carriage return (`\r`)
- Null terminator (`\0`)

Example for database "MAXDB":
```
Hex: 44 3d 4d 41 58 44 42 0a 0a 0d 00
Text: D=MAXDB\n\n\r\0
```

## API Endpoints

### POST /api/maxdb/connect

Perform NI handshake with global listener to discover X Server port.

**Request:**
```json
{
  "host": "maxdb.example.com",
  "port": 7200,
  "database": "MAXDB",
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "maxdb.example.com",
  "port": 7200,
  "database": "MAXDB",
  "niVersion": 3,
  "messageType": "CONNECT",
  "returnCode": 0,
  "xServerPort": 7210,
  "note": "MaxDB X Server is listening on port 7210. Use this port for database-level connections.",
  "rtt": 42
}
```

**Response (Error):**
```json
{
  "success": false,
  "host": "maxdb.example.com",
  "port": 7200,
  "database": "TESTDB",
  "niVersion": 3,
  "messageType": "ERROR",
  "returnCode": 1,
  "error": "Database TESTDB not found",
  "rtt": 38
}
```

### POST /api/maxdb/info

Enumerate available databases via NI_INFO request.

**Request:**
```json
{
  "host": "maxdb.example.com",
  "port": 7200,
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "maxdb.example.com",
  "port": 7200,
  "niVersion": 3,
  "messageType": "INFO",
  "returnCode": 0,
  "databases": [
    {
      "name": "MAXDB",
      "xServerPort": 7210,
      "info": "ONLINE"
    },
    {
      "name": "TESTDB",
      "xServerPort": 7211,
      "info": "OFFLINE"
    }
  ],
  "rawInfo": "MAXDB  7210  ONLINE\nTESTDB  7211  OFFLINE",
  "rtt": 35
}
```

### POST /api/maxdb/session

Discover X Server port, then connect directly to the database process to establish a session.

**Request:**
```json
{
  "host": "maxdb.example.com",
  "port": 7200,
  "database": "MAXDB",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "maxdb.example.com",
  "port": 7200,
  "database": "MAXDB",
  "niVersion": 3,
  "niRc": 0,
  "xServerPort": 7210,
  "xServerConnected": true,
  "xServerResponse": "NI type=DATA rc=0 payloadLen=64 payload=...",
  "sessionBytes": 72,
  "sessionHex": "00 00 00 48 03 00 00 00 ...",
  "rtt": 78,
  "note": "Connected to MaxDB X Server on port 7210 for database \"MAXDB\". Full SQL execution requires SQLDBC binary protocol (proprietary)."
}
```

## Protocol Compliance Notes

### Endianness

All multi-byte integer fields in NI packets use **big-endian** (network byte order):
- Total Length (4 bytes)
- Return Code (2 bytes)
- X Server Port (4 bytes in payload)

JavaScript DataView operations must use `false` for the `littleEndian` parameter:
```typescript
dv.setUint32(0, totalLen, false);  // Big-endian
dv.getUint32(0, false);            // Big-endian
```

### String Encoding

- Service descriptors: ASCII (alphanumeric + control chars)
- Error messages: UTF-8
- Database names: ASCII alphanumeric (max 18 characters)

### Packet Length Validation

Valid NI packets must satisfy:
```
8 ≤ Total Length ≤ 1,048,576
```

Minimum: 8 bytes (header with empty payload)
Maximum: 1 MB (implementation limit)

### Keep-Alive Messages

The NI protocol supports keep-alive via special messages:
- `NI_PING\0` - Keep-alive request
- `NI_PONG\0` - Keep-alive response

These are typically handled at the transport layer and not exposed to application code.

## Error Handling

### Common Error Scenarios

| Scenario | Message Type | Return Code | Payload |
|----------|--------------|-------------|---------|
| Database not found | NI_ERROR (0x05) | Non-zero | "Database {name} not found" |
| Service unavailable | NI_ERROR (0x05) | Non-zero | "Service unavailable" |
| Invalid descriptor | NI_ERROR (0x05) | Non-zero | "Invalid service descriptor" |
| Connection refused | N/A (TCP) | N/A | TCP connection error |

### Timeout Handling

Recommended timeout values:
- Initial NI_CONNECT: 5-8 seconds
- NI_INFO request: 5-6 seconds
- X Server connection: 5-8 seconds
- Total session establishment: 15 seconds

### Non-NI Responses

Some MaxDB configurations may respond with non-NI protocol data (pre-NI legacy format). The implementation handles this by:

1. Attempting to parse as NI packet
2. If parsing fails, treating as raw binary/text response
3. Returning hex dump and ASCII interpretation

## Security Considerations

### No Authentication at NI Layer

The NI protocol provides **routing only**, not authentication. Security relies on:
- Database-level authentication (X Server)
- Network-level access control (firewalls)
- Optional SSL/TLS (NISSL on port 7270)

### Service Enumeration

The NI_INFO request can enumerate all databases on a server without authentication. This may reveal:
- Database names
- X Server ports
- Database status (online/offline)

In production environments, consider:
- Firewall rules restricting port 7200 access
- Network segmentation
- Disabling global listener if not using SAPRouter

### Plaintext Transmission

Standard NI (port 7269) transmits data in **plaintext**. For encrypted communication:
- Use NISSL (port 7270) for NI layer encryption
- Use SSL/TLS at the X Server level
- Use VPN or network encryption

## Advanced Topics

### SAPRouter Integration

MaxDB NI protocol supports routing through SAPRouter for multi-tier network architectures:

```
Client → SAPRouter → Global Listener → X Server
```

SAPRouter uses the same NI protocol with extended routing strings.

### SQLDBC Binary Protocol

After NI session establishment, the X Server communicates using SQLDBC (proprietary SAP protocol):

- Binary format (not documented publicly)
- Handles authentication (username/password)
- SQL statement execution
- Result set retrieval
- Transaction management

Full database operations require implementing or using:
- SAP's official SQLDBC library (C++)
- pyMaxDB (Python)
- Third-party JDBC drivers

### Multiple Database Instances

A single MaxDB server can run multiple database instances, each with its own X Server process and port. The global listener maintains a registry of all active databases and routes connections accordingly.

## Troubleshooting

### Connection Refused

**Symptom:** TCP connection to port 7200 fails

**Causes:**
- MaxDB global listener not running
- Firewall blocking port 7200
- Wrong host/IP address

**Solution:**
```bash
# Check if port is listening
netstat -an | grep 7200
lsof -i :7200

# Start global listener (Linux/Unix)
dbmcli -d MAXDB -u control,password db_online
```

### Database Not Found

**Symptom:** NI_ERROR response with "Database not found"

**Causes:**
- Database name misspelled (case-sensitive)
- Database not registered with global listener
- Database instance stopped

**Solution:**
```bash
# List registered databases
dbmcli db_enum

# Register database with listener
dbmcli -d MAXDB -u control,password db_reg
```

### X Server Port Unreachable

**Symptom:** NI_CONNECT succeeds but X Server connection fails

**Causes:**
- X Server port blocked by firewall
- X Server process crashed
- Port number out of valid range

**Solution:**
- Check X Server process: `ps aux | grep dbm`
- Verify port in database config
- Check firewall rules for dynamic port

### Invalid NI Version

**Symptom:** Unexpected NI version byte (not 0x03)

**Causes:**
- Very old MaxDB version (pre-7.x)
- Non-MaxDB service on the port
- SAPRouter or gateway in the path

**Solution:**
- Verify MaxDB version: `dbmcli -d MAXDB -u control,password db_version`
- Check if connecting through SAPRouter
- Review packet capture for actual version byte

### Timeout During Session Establishment

**Symptom:** Connection times out during multi-step session flow

**Causes:**
- Network latency too high
- X Server overloaded
- Insufficient timeout value

**Solution:**
- Increase timeout to 15-20 seconds
- Check server load
- Verify network path (traceroute)

## Testing

### Integration Tests

The implementation includes comprehensive tests in `tests/maxdb.test.ts`:

**Connection Tests:**
- Non-existent host handling
- Missing host parameter validation
- Custom port 7210 support
- Timeout behavior
- Custom database name

**Error Handling:**
- Missing parameter validation
- Network error handling
- Graceful failure

**Security:**
- Cloudflare detection
- SSRF protection

**Port Support:**
- Port 7200 (X Server)
- Port 7210 (sql6)

**Response Format:**
- Structured response validation
- Server info properties
- Latency reporting

### Local Testing

**Using Docker:**
```bash
# MaxDB in Docker (if available)
docker run -d \
  -p 7200:7200 \
  -p 7210:7210 \
  --name maxdb-test \
  sap/maxdb:latest

# Test connection
curl -X POST http://localhost:3000/api/maxdb/connect \
  -H "Content-Type: application/json" \
  -d '{"host":"localhost","port":7200,"database":"MAXDB"}'
```

## Bug Fixes Applied

### 1. Packet Length Validation (Line 138)

**Bug:** Sanity check rejected valid empty NI packets
```typescript
// BEFORE (incorrect):
if (expectedLen === 0 || expectedLen > 1_048_576) break;

// AFTER (correct):
if (expectedLen < 8 || expectedLen > 1_048_576) break;
```

**Impact:** Empty NI packets (8-byte header with no payload) would be incorrectly rejected.

**Fix:** Changed validation to require minimum 8 bytes (header size) instead of rejecting 0-length packets.

### 2. Payload Slicing Boundary (Line 98)

**Bug:** Payload extraction could overrun buffer if `totalLen` exceeded actual data received
```typescript
// BEFORE (incorrect):
const payload = data.slice(8, totalLen);

// AFTER (correct):
const payloadEnd = Math.min(totalLen, data.length);
const payload = data.slice(8, payloadEnd);
```

**Impact:** If server advertised a larger packet than actually sent, slicing could include garbage data or cause buffer overruns.

**Fix:** Added boundary check to limit payload extraction to actual received data.

## Reference Implementation

The Port of Call MaxDB implementation provides three endpoints demonstrating progressive protocol usage:

1. **connect** - Basic NI_CONNECT handshake
2. **info** - Service enumeration with NI_INFO
3. **session** - Full two-step connection to X Server

All endpoints handle:
- Cloudflare protection detection
- Timeout management
- Error response parsing
- Non-NI fallback detection
- Structured JSON responses

## References

### Official Documentation
- [SAP MaxDB Documentation](https://maxdb.sap.com/documentation/)
- [Network Communication - SAP Documentation](https://maxdb.sap.com/doc/7_8/44/d7c3e72e6338d3e10000000a1553f7/content.htm)
- [Global Listener and X Servers - SAP Documentation](https://maxdb.sap.com/doc/7_8/45/376baca05f6bf1e10000000a1553f6/content.htm)
- [Ports and Protocols of X Server - SAP Documentation](https://maxdb.sap.com/doc/7_7/45/37e202462f4c2fe10000000a1553f6/content.htm)

### Protocol Analysis Tools
- [pysap - OWASP SAP Protocol Library](https://pysap.readthedocs.io/en/latest/protocols/SAPNI.html)
- [pysap SAPNI Module Source](https://github.com/OWASP/pysap/blob/master/pysap/SAPNI.py)
- [SAP Wireshark Dissectors](https://github.com/SecureAuthCorp/SAP-Dissection-plug-in-for-Wireshark)

### Related Protocols
- SAP RFC (Remote Function Call)
- SAP Diag (SAP GUI protocol)
- SAPRouter (SAP network gateway)

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Initial | Initial implementation with connect/info/session endpoints |
| 1.1 | 2026-02-18 | Fixed packet length validation (minimum 8 bytes, not 0) |
| 1.1 | 2026-02-18 | Fixed payload slicing to respect totalLen boundary |

---

**Protocol Status:** Proprietary (SAP AG/SAP SE)
**Implementation Status:** Production-ready for NI layer; SQLDBC requires proprietary libraries
**Test Coverage:** Integration tests for all three endpoints
