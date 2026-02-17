
# Oracle Database (TNS Protocol) Implementation

## Overview

**Protocol:** TNS (Transparent Network Substrate)
**Port:** 1521 (default), configurable during installation
**Specification:** Proprietary (reverse-engineered)
**Complexity:** Very High
**Purpose:** Oracle Database client-server communication

TNS is Oracle's proprietary networking protocol that enables communication between Oracle clients and database servers. It supports connection multiplexing, load balancing, failover, and protocol adaptation.

### Use Cases
- Oracle database connectivity testing
- TNS listener health checks
- Service/SID validation
- Network troubleshooting
- Database administration
- Connection string validation
- Listener monitoring

## Protocol Specification

### Connection Flow

1. **TCP Connect**: Port 1521 (default)
2. **TNS Connect**: Send CONNECT packet with connect descriptor
3. **TNS Accept/Refuse/Redirect**: Listener responds with status
4. **Data Exchange**: Query/response (not implemented in basic version)
5. **Close**: TCP disconnect

### TNS Packet Structure

Every TNS packet begins with an 8-byte header:

```
┌─────────────────────────────────────┐
│ Bytes 0-1: Packet Length (big-endian) │  Total packet size (includes header)
│ Bytes 2-3: Checksum (big-endian)      │  Usually 0x0000 (disabled)
│ Byte 4:    Packet Type                │  1=Connect, 2=Accept, 4=Refuse, etc.
│ Byte 5:    Reserved/Flags             │  Usually 0x00
│ Bytes 6-7: Header Checksum            │  Usually 0x0000
├─────────────────────────────────────┤
│ Packet Body (variable length)         │  Type-specific payload
└─────────────────────────────────────┘
```

### Packet Types

| Type | Value | Description |
|------|-------|-------------|
| CONNECT | 1 | Client connection request |
| ACCEPT | 2 | Server accepts connection |
| ACK | 3 | Acknowledgment |
| REFUSE | 4 | Server refuses connection |
| REDIRECT | 5 | Redirect to another listener |
| DATA | 6 | Data transfer |
| NULL | 7 | Null packet |
| ABORT | 9 | Abort connection |
| RESEND | 11 | Resend request |
| MARKER | 12 | Attention marker |
| ATTENTION | 13 | Attention signal |
| CONTROL | 14 | Control information |

### CONNECT Packet Structure

```
Header (8 bytes)
├─ Protocol Version (2 bytes, big-endian)       │ 0x013A (TNS 314)
├─ Version Compatible (2 bytes, big-endian)     │ 0x013A
├─ Service Options (2 bytes, big-endian)        │ 0x0C41 (standard)
├─ SDU Size (2 bytes, big-endian)               │ 0x2000 (8192 bytes)
├─ MTU Size (2 bytes, big-endian)               │ 0x7FFF (32767 bytes)
├─ NT Protocol Characteristics (2 bytes)        │ 0x7F08
├─ Line Turnaround (2 bytes)                    │ 0x0000
├─ Value of 1 in Hardware (2 bytes)             │ 0x0001
├─ Connect Data Length (2 bytes, big-endian)    │ Length of connect descriptor
└─ Connect Data (variable)                      │ Connect descriptor string
```

### Connect Descriptor Format

The connect descriptor is a structured string with nested parentheses:

**Service Name (modern):**
```
(DESCRIPTION=
  (ADDRESS=(PROTOCOL=TCP)(HOST=oracle.example.com)(PORT=1521))
  (CONNECT_DATA=(SERVICE_NAME=ORCL))
)
```

**SID (legacy):**
```
(DESCRIPTION=
  (ADDRESS=(PROTOCOL=TCP)(HOST=oracle.example.com)(PORT=1521))
  (CONNECT_DATA=(SID=XE))
)
```

### ACCEPT Packet Structure

```
Header (8 bytes)
├─ Protocol Version (2 bytes, big-endian)       │ Server TNS version
├─ Service Options (2 bytes, big-endian)        │ Server options
├─ SDU Size (2 bytes, big-endian)               │ Negotiated SDU size
└─ Additional data (variable)                    │ Server capabilities
```

### REFUSE Packet Structure

```
Header (8 bytes)
├─ Refuse Code (1 byte)                         │ Reason for refusal
├─ Refuse Data Length (2 bytes, big-endian)     │ Length of error message
└─ Refuse Data (variable)                        │ Error message text
```

**Common Refuse Codes:**
- **1:** Listener could not find SID/service
- **2:** Timeout
- **3:** No appropriate service handler found

## Implementation

### Worker Implementation (src/worker/oracle.ts)

```typescript
import { connect } from 'cloudflare:sockets';

export interface OracleConnectionOptions {
  host: string;
  port?: number;          // Default: 1521
  serviceName?: string;   // Modern method (Oracle 8i+)
  sid?: string;           // Legacy method
  timeout?: number;       // Default: 30000ms
}
```

### Key Functions

**createTNSHeader(length, packetType)**
- Constructs 8-byte TNS packet header
- Big-endian encoding for length fields
- Returns Uint8Array

**createConnectPacket(host, port, serviceName, sid)**
- Builds complete TNS CONNECT packet
- Encodes protocol version (0x013A / TNS 314)
- Sets SDU size (8192 bytes)
- Sets MTU size (32767 bytes)
- Constructs connect descriptor string
- Returns Uint8Array ready to send

**parseTNSHeader(data)**
- Extracts packet length, type, checksums
- Returns structured header object
- Null if invalid

**parseAcceptPacket(data)**
- Extracts protocol version
- Extracts service options
- Extracts SDU size
- Returns server capabilities

**parseRefusePacket(data)**
- Extracts refuse code
- Extracts error message
- Returns refusal details

**handleOracleConnect(request)**
- Main HTTP endpoint handler
- Validates host, service name/SID
- Checks Cloudflare protection
- Sends CONNECT packet
- Reads and parses response (ACCEPT/REFUSE/REDIRECT)
- Returns JSON result

### React Component (src/components/OracleClient.tsx)

Features:
- Host/port input fields
- Radio buttons for Service Name vs SID
- Conditional input based on connection mode
- Form validation
- Loading states
- Result/error display
- Help section with TNS protocol information

## Testing

### Integration Tests (tests/oracle.test.ts)

Test scenarios:
- ✅ Non-existent host handling
- ✅ Missing required parameters (host, serviceName/sid)
- ✅ GET request support with query params
- ✅ Custom timeout handling
- ✅ Cloudflare detection blocking
- ✅ Default port (1521) and custom ports
- ✅ Service Name format
- ✅ SID format

### Manual Testing

**Test Server Setup:**

```bash
# Pull Oracle Express Edition
docker pull container-registry.oracle.com/database/express:latest

# Run Oracle XE
docker run -d \
  --name oracle-xe \
  -p 1521:1521 \
  -e ORACLE_PWD=OraclePassword123 \
  container-registry.oracle.com/database/express:latest

# Wait for startup (may take 5-10 minutes)
docker logs -f oracle-xe

# Test connection
curl -X POST http://localhost:8787/api/oracle/connect \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "localhost",
    "port": 1521,
    "sid": "XE"
  }'
```

**Expected Response (Success):**

```json
{
  "success": true,
  "message": "Oracle TNS connection accepted",
  "host": "localhost",
  "port": 1521,
  "sid": "XE",
  "packetType": "ACCEPT",
  "protocol": {
    "version": "0x13a",
    "sduSize": 8192,
    "serviceOptions": "0xc41"
  },
  "note": "TNS handshake successful. Connection accepted by Oracle listener."
}
```

**Expected Response (Service Not Found):**

```json
{
  "success": false,
  "error": "Oracle TNS connection refused: TNS-12514: TNS:listener does not currently know of service...",
  "host": "localhost",
  "port": 1521,
  "packetType": "REFUSE",
  "refuseCode": 1,
  "refuseReason": "TNS-12514: TNS:listener does not currently know of service..."
}
```

## Common Service Names and SIDs

### Oracle Express Edition (XE)
- **Service Name:** XEPDB1 (Pluggable Database)
- **SID:** XE (Container Database)

### Oracle Standard/Enterprise Edition
- **Service Name:** ORCL (default)
- **SID:** ORCL (default)

### Oracle Cloud Database
- **Service Name:** <dbname>_high, <dbname>_medium, <dbname>_low
- **SID:** Not typically used

## Security Considerations

1. **No Authentication Implemented**: This implementation only performs TNS handshake, not full authentication
2. **Connection Test Only**: Does not execute queries or access data
3. **Cloudflare Detection**: Blocks attempts to connect to Cloudflare-protected hosts
4. **Input Validation**: Host, port, service name, and SID are validated
5. **Timeout Protection**: Default 30-second timeout prevents hanging connections
6. **No Credential Storage**: Does not handle or store database credentials

## Limitations

- **No Query Execution**: This implementation only validates TNS connectivity
- **No Authentication**: Does not perform username/password authentication
- **No Data Access**: Cannot read or write database data
- **No Encryption**: Does not support Oracle Advanced Security (TLS/SSL)
- **Read-Only Listener Check**: Only verifies listener availability

## Future Enhancements

1. **Full Authentication**: Implement Oracle password authentication protocol
2. **Query Execution**: Support SQL query execution
3. **Result Formatting**: Display query results in tabular format
4. **Encryption Support**: Add Oracle Native Network Encryption
5. **Connection Pooling**: Maintain persistent connections
6. **Advanced Features**: Stored procedures, PL/SQL blocks, LOB handling

## References

### Official Documentation
- [Oracle Net Services Administrator's Guide](https://docs.oracle.com/en/database/oracle/oracle-database/21/netag/)
- [Oracle Call Interface (OCI) Documentation](https://docs.oracle.com/en/database/oracle/oracle-database/21/lnoci/)

### Protocol Specifications (Unofficial)
- [O'Reilly: The Oracle Hacker's Handbook - TNS Protocol](https://www.oreilly.com/library/view/the-oracle-r-hackers/9780470080221/9780470080221_the_tns_protocol.html)
- [GitHub: Oracle Database Wire Protocol Unofficial Specification](https://github.com/redwood-wire-protocol/oracle-database-wire-protocol-unofficial-specification)
- [Net::TNS Ruby Library](https://github.com/SpiderLabs/net-tns)

### Tools
- [Oracle Instant Client](https://www.oracle.com/database/technologies/instant-client.html)
- [SQL*Plus](https://docs.oracle.com/en/database/oracle/oracle-database/21/sqpug/)
- [Oracle SQL Developer](https://www.oracle.com/database/sqldeveloper/)

## Troubleshooting

### TNS-12154: TNS:could not resolve the connect identifier
- Verify service name or SID is correct
- Check listener is running: `lsnrctl status`

### TNS-12514: TNS:listener does not currently know of service
- Service not registered with listener
- Database instance not started
- Wait for dynamic service registration (may take 60 seconds after startup)

### TNS-12541: TNS:no listener
- Listener not running on specified port
- Check firewall rules
- Verify host and port are correct

### TNS-12560: TNS:protocol adapter error
- Network connectivity issue
- Host unreachable
- Port blocked by firewall

### Connection Timeout
- Database instance slow to respond
- Network latency
- Firewall dropping packets (no RST sent)
- Check timeout settings (default: 30 seconds)

## Deployment Checklist

- [x] Worker implementation (src/worker/oracle.ts)
- [x] React client component (src/components/OracleClient.tsx)
- [x] App.tsx routing
- [x] Worker index.ts routing
- [x] Integration tests (tests/oracle.test.ts)
- [x] Protocol documentation (docs/protocols/ORACLE.md)
- [ ] Update IMPLEMENTED.md
- [ ] Update mutex.md to "Completed"
- [ ] Deploy to production
- [ ] Test with live Oracle instance

---

**Status:** ✅ Implementation Complete (Not Yet Deployed)
**Complexity:** Very High
**Test Coverage:** 13 integration tests
**Documentation:** Complete
