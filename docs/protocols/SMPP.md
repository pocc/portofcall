# SMPP (Short Message Peer-to-Peer Protocol) v3.4

## Protocol Overview

SMPP v3.4 is the industry-standard protocol for exchanging SMS messages between Short Message Service Centers (SMSCs) and External Short Messaging Entities (ESMEs) such as SMS gateways and aggregators.

**Default Port:** 2775
**Transport:** TCP
**Specification:** SMPP v3.4 Issue 1.2 (Oct 1999)

## Implementation Status

Port of Call implements SMPP v3.4 client functionality with support for:
- Bind operations (receiver, transmitter, transceiver)
- SMS submission (submit_sm)
- Message status query (query_sm)
- Connection keepalive (enquire_link)

## Connection Flow

```
Client                                Server (SMSC)
  |                                       |
  |--- TCP Connect (port 2775) ---------->|
  |                                       |
  |--- bind_transceiver PDU ------------->|
  |    (system_id, password)              |
  |                                       |
  |<-- bind_transceiver_resp PDU ---------|
  |    (status, system_id, version TLV)   |
  |                                       |
  |--- submit_sm PDU -------------------->|
  |    (source, dest, message)            |
  |                                       |
  |<-- submit_sm_resp PDU ----------------|
  |    (status, message_id)               |
  |                                       |
  |--- unbind PDU ----------------------->|
  |                                       |
  |<-- unbind_resp PDU -------------------|
  |                                       |
  |--- TCP Close ------------------------>|
```

## PDU Structure

All SMPP PDUs consist of a 16-byte header followed by a variable-length body.

### PDU Header (16 bytes)

| Offset | Field           | Type    | Description |
|--------|-----------------|---------|-------------|
| 0-3    | command_length  | uint32  | Total PDU size in bytes (header + body) |
| 4-7    | command_id      | uint32  | PDU type identifier |
| 8-11   | command_status  | uint32  | Error code (0 = success, request PDUs always 0) |
| 12-15  | sequence_number | uint32  | Request/response correlation ID |

All multi-byte integers use big-endian (network) byte order.

### Command IDs (SMPP v3.4 §5.1.2.1)

| Command ID | Name                    | Type     |
|------------|-------------------------|----------|
| 0x00000001 | bind_receiver           | Request  |
| 0x80000001 | bind_receiver_resp      | Response |
| 0x00000002 | bind_transmitter        | Request  |
| 0x80000002 | bind_transmitter_resp   | Response |
| 0x00000003 | query_sm                | Request  |
| 0x80000003 | query_sm_resp           | Response |
| 0x00000004 | submit_sm               | Request  |
| 0x80000004 | submit_sm_resp          | Response |
| 0x00000005 | deliver_sm              | Request  |
| 0x80000005 | deliver_sm_resp         | Response |
| 0x00000006 | unbind                  | Request  |
| 0x80000006 | unbind_resp             | Response |
| 0x00000009 | bind_transceiver        | Request  |
| 0x80000009 | bind_transceiver_resp   | Response |
| 0x00000015 | enquire_link            | Request  |
| 0x80000015 | enquire_link_resp       | Response |
| 0x80000000 | generic_nack            | Response |

Response PDUs have the high bit (0x80000000) set.

### Status Codes (SMPP v3.4 §5.1.3)

| Code       | Name                   | Description |
|------------|------------------------|-------------|
| 0x00000000 | ESME_ROK               | Success |
| 0x00000001 | ESME_RINVMSGLEN        | Message length is invalid |
| 0x00000002 | ESME_RINVCMDLEN        | Command length is invalid |
| 0x00000003 | ESME_RINVCMDID         | Invalid command ID |
| 0x00000004 | ESME_RINVBNDSTS        | Incorrect BIND status for given command |
| 0x00000005 | ESME_RALYBND           | ESME already in bound state |
| 0x00000006 | ESME_RINVPRTFLG        | Invalid priority flag |
| 0x00000007 | ESME_RINVREGDLVFLG     | Invalid registered delivery flag |
| 0x00000008 | ESME_RSYSERR           | System error |
| 0x0000000A | ESME_RINVSRCADR        | Invalid source address |
| 0x0000000B | ESME_RINVDSTADR        | Invalid dest address |
| 0x0000000C | ESME_RINVMSGID         | Invalid message ID |
| 0x0000000D | ESME_RBINDFAIL         | Bind failed |
| 0x0000000E | ESME_RINVPASWD         | Invalid password |
| 0x0000000F | ESME_RINVSYSID         | Invalid system ID |
| 0x00000011 | ESME_RCANCELFAIL       | Cancel SM failed |
| 0x00000013 | ESME_RREPLACEFAIL      | Replace SM failed |
| 0x00000014 | ESME_RMSGQFUL          | Message queue full |
| 0x00000015 | ESME_RINVSERTYP        | Invalid service type |
| 0x00000033 | ESME_RINVNUMDESTS      | Invalid number of destinations |
| 0x00000034 | ESME_RINVDLNAME        | Invalid distribution list name |
| 0x00000040 | ESME_RINVDESTFLAG      | Destination flag is invalid |
| 0x00000042 | ESME_RINVSUBREP        | Invalid submit with replace request |
| 0x00000043 | ESME_RINVESMCLASS      | Invalid esm_class field data |
| 0x00000044 | ESME_RCNTSUBDL         | Cannot submit to distribution list |
| 0x00000045 | ESME_RSUBMITFAIL       | submit_sm or submit_multi failed |
| 0x00000048 | ESME_RINVSRCTON        | Invalid source address TON |
| 0x00000049 | ESME_RINVSRCNPI        | Invalid source address NPI |
| 0x00000050 | ESME_RINVDSTTON        | Invalid destination address TON |
| 0x00000051 | ESME_RINVDSTNPI        | Invalid destination address NPI |
| 0x00000053 | ESME_RINVSYSTYP        | Invalid system type field |
| 0x00000054 | ESME_RINVREPFLAG       | Invalid replace_if_present flag |
| 0x00000055 | ESME_RINVNUMMSGS       | Invalid number of messages |
| 0x00000058 | ESME_RTHROTTLED        | Throttling error (ESME exceeded allowed message limits) |
| 0x00000061 | ESME_RINVSCHED         | Invalid scheduled delivery time |
| 0x00000062 | ESME_RINVEXPIRY        | Invalid message validity period |
| 0x00000063 | ESME_RINVDFTMSGID      | Predefined message invalid or not found |
| 0x00000064 | ESME_RX_T_APPN         | ESME receiver temporary app error code |
| 0x00000065 | ESME_RX_P_APPN         | ESME receiver permanent app error code |
| 0x00000066 | ESME_RX_R_APPN         | ESME receiver reject message error code |
| 0x00000067 | ESME_RQUERYFAIL        | query_sm request failed |
| 0x000000C0 | ESME_RINVTLVSTREAM     | Error in the optional part of the PDU body |
| 0x000000C1 | ESME_RTLVNOTALLWD      | TLV not allowed |
| 0x000000C2 | ESME_RINVTLVLEN        | Invalid parameter length |
| 0x000000C3 | ESME_RMISSINGTLV       | Expected TLV missing |
| 0x000000C4 | ESME_RINVTLVVAL        | Invalid TLV value |
| 0x000000FE | ESME_RDELIVERYFAILURE  | Transaction delivery failure |
| 0x000000FF | ESME_RUNKNOWNERR       | Unknown error |

## Bind Operations

### bind_transceiver PDU

Establishes a bidirectional session (can send and receive messages).

**Command ID:** 0x00000009

**Body Fields:**

| Field             | Type          | Max Length | Description |
|-------------------|---------------|------------|-------------|
| system_id         | C-Octet String| 16         | ESME identifier |
| password          | C-Octet String| 9          | Authentication password |
| system_type       | C-Octet String| 13         | ESME type (optional) |
| interface_version | Integer-1     | 1          | SMPP version (0x34 = v3.4) |
| addr_ton          | Integer-1     | 1          | Type of Number (0x00 = unknown) |
| addr_npi          | Integer-1     | 1          | Numbering Plan Indicator (0x00 = unknown) |
| address_range     | C-Octet String| 41         | ESME address range (optional) |

**Response:** bind_transceiver_resp (0x80000009)

**Response Body:**

| Field     | Type          | Max Length | Description |
|-----------|---------------|------------|-------------|
| system_id | C-Octet String| 16         | SMSC identifier |
| (optional TLVs) | | | sc_interface_version (tag 0x0210) |

## Submit SM (Send Message)

### submit_sm PDU

Submits a short message to the SMSC for delivery.

**Command ID:** 0x00000004

**Body Fields:**

| Field              | Type          | Max Length | Description |
|--------------------|---------------|------------|-------------|
| service_type       | C-Octet String| 6          | SMS service type (empty = default) |
| source_addr_ton    | Integer-1     | 1          | Source address type of number |
| source_addr_npi    | Integer-1     | 1          | Source address numbering plan |
| source_addr        | C-Octet String| 21         | Source address (sender) |
| dest_addr_ton      | Integer-1     | 1          | Destination address TON (0x01 = international) |
| dest_addr_npi      | Integer-1     | 1          | Destination address NPI (0x01 = ISDN/E.164) |
| destination_addr   | C-Octet String| 21         | Destination address (recipient) |
| esm_class          | Integer-1     | 1          | ESM class (0x00 = default) |
| protocol_id        | Integer-1     | 1          | Protocol identifier (0x00 = default) |
| priority_flag      | Integer-1     | 1          | Priority (0x00 = default) |
| schedule_delivery_time | C-Octet String| 17     | Scheduled delivery (empty = immediate) |
| validity_period    | C-Octet String| 17         | Message validity (empty = SMSC default) |
| registered_delivery| Integer-1     | 1          | Delivery receipt request (0x01 = requested) |
| replace_if_present_flag | Integer-1| 1          | Replace existing message (0x00 = no) |
| data_coding        | Integer-1     | 1          | Character encoding (0x00 = SMSC default/GSM 7-bit, 0x08 = UCS-2) |
| sm_default_msg_id  | Integer-1     | 1          | Predefined message ID (0x00 = none) |
| sm_length          | Integer-1     | 1          | Message length in bytes |
| short_message      | Octet String  | 0-254      | Message payload (max 160 chars for GSM 7-bit) |

**Response:** submit_sm_resp (0x80000004)

**Response Body:**

| Field      | Type          | Max Length | Description |
|------------|---------------|------------|-------------|
| message_id | C-Octet String| 65         | SMSC-assigned message identifier |

## Query SM (Check Message Status)

### query_sm PDU

Queries the delivery status of a previously submitted message.

**Command ID:** 0x00000003

**Body Fields:**

| Field         | Type          | Max Length | Description |
|---------------|---------------|------------|-------------|
| message_id    | C-Octet String| 65         | Message ID from submit_sm_resp |
| source_addr_ton | Integer-1   | 1          | Source address TON (0x00 = unknown) |
| source_addr_npi | Integer-1   | 1          | Source address NPI (0x00 = unknown) |
| source_addr   | C-Octet String| 21         | Source address from original submit |

**Response:** query_sm_resp (0x80000003)

**Response Body:**

| Field         | Type          | Max Length | Description |
|---------------|---------------|------------|-------------|
| message_id    | C-Octet String| 65         | Echoed message ID |
| final_date    | C-Octet String| 17         | Message final state timestamp (YYMMDDhhmmss) |
| message_state | Integer-1     | 1          | Message delivery state (see below) |
| error_code    | Integer-1     | 1          | Network-specific error code |

**Message States:**

| Value | State          | Description |
|-------|----------------|-------------|
| 0     | ENROUTE        | Message is in transit |
| 1     | DELIVERED      | Message delivered to destination |
| 2     | EXPIRED        | Message validity period expired |
| 3     | DELETED        | Message deleted |
| 4     | UNDELIVERABLE  | Message is undeliverable |
| 5     | ACCEPTED       | Message accepted but not yet in enroute state |
| 6     | UNKNOWN        | Message state unknown |
| 7     | REJECTED       | Message rejected |

## Enquire Link (Keepalive)

### enquire_link PDU

Keepalive PDU to verify connection is active.

**Command ID:** 0x00000015

**Body:** None (header only)

**Response:** enquire_link_resp (0x80000015)

**Response Body:** None (header only)

## Data Types

### C-Octet String

Null-terminated string (like C strings). Maximum length includes the null terminator.

**Encoding:**
```
"hello" → 0x68 0x65 0x6C 0x6C 0x6F 0x00
```

### Integer-1, Integer-2, Integer-4

Unsigned integers (1, 2, or 4 bytes) in big-endian byte order.

### Octet String

Raw byte sequence without null terminator. Length specified by preceding length field.

## TLV (Tag-Length-Value) Parameters

Optional parameters in SMPP responses use TLV encoding:

```
[Tag: 2 bytes][Length: 2 bytes][Value: N bytes]
```

**Common TLVs:**

| Tag    | Name                 | Type      | Description |
|--------|----------------------|-----------|-------------|
| 0x0210 | sc_interface_version | Integer-1 | SMSC SMPP version (in bind responses) |
| 0x001D | additional_status_info_text | C-Octet String | Error details |
| 0x001E | receipted_message_id | C-Octet String | Message ID in delivery receipts |

## API Endpoints

### POST /api/smpp/connect

Test SMPP server connectivity and authentication.

**Request:**
```json
{
  "host": "smpp.example.com",
  "port": 2775,
  "systemId": "test_user",
  "password": "test_pass",
  "systemType": "",
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "smpp.example.com",
  "port": 2775,
  "protocol": "SMPP",
  "smppDetected": true,
  "commandName": "bind_transceiver_resp",
  "commandStatus": 0,
  "statusName": "ESME_ROK (Success)",
  "sequenceNumber": 1,
  "bound": true,
  "serverSystemId": "SMSC_SIM",
  "interfaceVersion": 52,
  "interfaceVersionName": "SMPP v3.4",
  "message": "SMPP bind successful to smpp.example.com:2775 (SMSC_SIM)"
}
```

**Response (Auth Failure):**
```json
{
  "success": true,
  "host": "smpp.example.com",
  "port": 2775,
  "protocol": "SMPP",
  "smppDetected": true,
  "commandName": "bind_transceiver_resp",
  "commandStatus": 14,
  "statusName": "ESME_RINVPASWD (Invalid password)",
  "sequenceNumber": 1,
  "bound": false,
  "message": "SMPP server detected on smpp.example.com:2775 — bind refused: ESME_RINVPASWD (Invalid password)"
}
```

### POST /api/smpp/submit

Send an SMS message via SMPP.

**Request:**
```json
{
  "host": "smpp.example.com",
  "port": 2775,
  "system_id": "test_user",
  "password": "test_pass",
  "source_addr": "1234",
  "destination_addr": "15551234567",
  "message": "Hello from Port of Call!",
  "data_coding": 0,
  "timeout": 15000
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "SMS submitted successfully",
  "host": "smpp.example.com",
  "port": 2775,
  "rtt": 450,
  "connectTime": 230,
  "boundSystemId": "SMSC_SIM",
  "messageId": "msg_abc123",
  "sourceAddr": "1234",
  "destinationAddr": "15551234567",
  "messageLength": 24,
  "dataCoding": 0
}
```

**Response (Failure):**
```json
{
  "success": false,
  "host": "smpp.example.com",
  "port": 2775,
  "rtt": 380,
  "connectTime": 210,
  "boundSystemId": "SMSC_SIM",
  "error": "submit_sm failed: ESME_RTHROTTLED (Throttling error)",
  "commandStatus": 88
}
```

### POST /api/smpp/query

Query the delivery status of a submitted message.

**Request:**
```json
{
  "host": "smpp.example.com",
  "port": 2775,
  "system_id": "test_user",
  "password": "test_pass",
  "message_id": "msg_abc123",
  "source_addr": "1234",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "smpp.example.com",
  "port": 2775,
  "messageId": "msg_abc123",
  "messageState": 1,
  "messageStateName": "DELIVERED",
  "finalDate": "260218143022",
  "errorCode": 0,
  "rtt": 420
}
```

### POST /api/smpp/probe

Lightweight SMPP server detection (sends enquire_link without binding).

**Request:**
```json
{
  "host": "smpp.example.com",
  "port": 2775,
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "smpp.example.com",
  "port": 2775,
  "protocol": "SMPP",
  "isSmpp": true,
  "commandName": "generic_nack",
  "statusName": "ESME_RINVBNDSTS (Invalid bind status)",
  "message": "SMPP server detected on smpp.example.com:2775 (response: generic_nack)"
}
```

## Security Considerations

1. **Authentication**: SMPP uses plaintext credentials in the bind PDU. Use TLS/SSL tunnels (stunnel, VPN) for production deployments.

2. **Message Injection**: Source and destination addresses are validated by the SMSC, but client applications should sanitize user input.

3. **Rate Limiting**: SMSCs enforce throttling limits. Respect `ESME_RTHROTTLED` (0x58) errors.

4. **Session Keepalive**: Send `enquire_link` PDUs periodically (typically every 30-60 seconds) to prevent idle disconnection.

## Testing with Simulators

**SMPP Simulator (Java-based):**
```bash
# Download from https://github.com/smn/smpp-simulator
# Run on port 2775
java -jar SMPPSim.jar
```

**Default Credentials:**
- System ID: `smppclient1`
- Password: `password`

**Test Commands:**
```bash
# Test bind
curl -X POST http://localhost:8787/api/smpp/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 2775,
    "systemId": "smppclient1",
    "password": "password"
  }'

# Submit SMS
curl -X POST http://localhost:8787/api/smpp/submit \
  -H "Content-Type: application/json" \
  -d '{
    "host": "localhost",
    "port": 2775,
    "system_id": "smppclient1",
    "password": "password",
    "destination_addr": "15551234567",
    "message": "Test message"
  }'
```

## References

- **SMPP v3.4 Specification**: SMS Forum (now part of 3GPP), October 1999
- **SMPP.org**: Community resources and documentation
- **RFC 5724**: URI Scheme for Global System for Mobile Communications (GSM) Short Message Service (SMS)
- **GSM 03.38**: SMS Character Set and Encoding (GSM 7-bit alphabet)

## Implementation Notes

1. **Interface Version**: Port of Call sends interface_version = 0x34 (SMPP v3.4) in bind requests.

2. **TON/NPI Defaults**: Uses 0x00 (Unknown) for bind operations, 0x01 (International/ISDN) for submit_sm.

3. **Message Length Limit**: SMS messages are truncated to 160 characters (GSM 7-bit) or 70 characters (UCS-2).

4. **Session Management**: Sends unbind PDU after each operation for stateless testing. Production clients should maintain persistent sessions.

5. **Byte Order**: All multi-byte integers use big-endian (network) byte order per SMPP spec.

6. **Character Encoding**: Supports data_coding 0x00 (SMSC default/GSM 7-bit) and 0x08 (UCS-2/UTF-16).

7. **TLV Parsing**: Parses sc_interface_version (tag 0x0210) from bind responses to detect server SMPP version.

## Limitations

1. **No Long Message Support**: Does not implement message_payload TLV (0x0424) or SAR (Segmentation and Reassembly).

2. **No Delivery Receipts**: Does not handle deliver_sm PDUs (requires persistent connection and message listener).

3. **No TLS Support**: Cloudflare Workers sockets API doesn't support SMPP-over-TLS. Use external TLS proxy for encryption.

4. **No Multi-Part Messages**: Messages longer than 160 chars are truncated, not segmented.

5. **No Broadcast/Multicast**: Does not implement submit_multi or broadcast_sm commands.
