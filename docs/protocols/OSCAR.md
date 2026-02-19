# OSCAR Protocol Implementation (AOL Instant Messenger / ICQ)

**RFC:** None (proprietary protocol, community-documented)
**Port:** 5190 (TCP)
**TLS:** Optional (rarely used)
**Implementation:** `/Users/rj/gd/code/portofcall/src/worker/oscar.ts`

## Overview

**OSCAR** (Open System for CommunicAtion in Realtime) was the proprietary protocol used by AOL Instant Messenger (AIM) and ICQ for instant messaging from 1997-2017. AIM was officially shut down in 2017, but ICQ continued until 2024. Several revival servers now exist (e.g., NINA, Phoenix).

OSCAR is a binary protocol consisting of two layers:
- **FLAP** (Frame Layer Protocol): Transport framing with 6-byte headers
- **SNAC** (Service-specific commands): Application-layer messages with 10-byte headers

The protocol supports authentication, presence, buddy lists, instant messaging, file transfer, and chat rooms.

## API Endpoints

### 1. PROBE — Basic Server Detection

**Endpoint:** `POST /api/oscar/probe`

Sends a FLAP signon frame (channel 1) and reads the server's response. Used to detect if an OSCAR server is running and responsive.

**Request:**
```json
{
  "host": "login.oscar.aol.com",
  "port": 5190,
  "timeout": 15000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "login.oscar.aol.com",
  "port": 5190,
  "channel": 1,
  "channelName": "Signon",
  "sequence": 0,
  "dataLength": 4,
  "rtt": 142
}
```

**Response (Failure):**
```json
{
  "success": false,
  "host": "login.oscar.aol.com",
  "port": 5190,
  "error": "Connection timeout"
}
```

**Field Defaults:**
- `port`: 5190 (standard OSCAR port)
- `timeout`: 15000 ms

**Port Validation:** 1-65535

**Channel Types:**
- `1` (0x01): Signon/negotiation
- `2` (0x02): SNAC data
- `3` (0x03): Error
- `4` (0x04): Close connection
- `5` (0x05): Keepalive/ping

**Notes:**
- `rtt` is measured from socket open to response received
- `dataLength` is the payload size (typically 4 bytes for signon response)
- `sequence` should be 0 or 1 for initial signon response

---

### 2. PING — Server Keepalive Test

**Endpoint:** `POST /api/oscar/ping`

Sends signon frame followed by a keepalive frame (channel 5) to test server responsiveness.

**Request:**
```json
{
  "host": "login.oscar.aol.com",
  "port": 5190,
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "login.oscar.aol.com",
  "port": 5190,
  "message": "OSCAR server responded to ping"
}
```

**Response (No Response):**
```json
{
  "success": false,
  "host": "login.oscar.aol.com",
  "port": 5190,
  "message": "No ping response"
}
```

**Field Defaults:**
- `port`: 5190
- `timeout`: 10000 ms

**Notes:**
- Reads up to 1000 bytes or 2 response frames
- Does not parse response content, only checks for presence
- Some servers may close connection after signon (not an error)

---

### 3. AUTH — Authentication Key Request

**Endpoint:** `POST /api/oscar/auth`

Performs OSCAR authentication handshake up to the auth key exchange. Returns the MD5 challenge key from the server without completing login.

**Request:**
```json
{
  "host": "login.oscar.aol.com",
  "port": 5190,
  "screenName": "TestUser123",
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "login.oscar.aol.com",
  "port": 5190,
  "screenName": "TestUser123",
  "serverSignonReceived": true,
  "serverChannel": 1,
  "authKeyReceived": true,
  "authKey": "8b4f2e91a3c7d8f5",
  "snacFamily": "0x0017",
  "snacSubtype": "0x0007",
  "error": null
}
```

**Response (Auth Error):**
```json
{
  "success": true,
  "host": "login.oscar.aol.com",
  "port": 5190,
  "screenName": "InvalidUser",
  "serverSignonReceived": true,
  "serverChannel": 1,
  "authKeyReceived": false,
  "snacFamily": "0x0017",
  "snacSubtype": "0x0007",
  "error": "Auth error code: 0x0001"
}
```

**Field Defaults:**
- `port`: 5190
- `screenName`: "testuser" (if not provided)
- `timeout`: 10000 ms

**SNAC Sequence:**
1. Client sends FLAP channel 1 (signon) with version=1
2. Client sends SNAC 0x0017/0x0006 (AuthKeyRequest) with screen name TLV
3. Server responds with SNAC 0x0017/0x0007 (AuthKeyResponse) containing TLV 0x0025 (MD5 key)

**TLV Types:**
- `0x0001`: Screen name (UTF-8 string)
- `0x0025`: MD5 auth key (16-byte challenge)
- `0x0008`: Error code (2-byte uint16)

**Notes:**
- Auth key is returned as ASCII hex string (32 characters for 16 bytes)
- `success` is true even if auth key is missing (check `authKeyReceived`)
- SNAC family 0x0017 is the Authorization/registration service

---

### 4. LOGIN — Full Authentication

**Endpoint:** `POST /api/oscar/login`

Performs complete OSCAR login flow: auth key request → MD5 login → BOS redirect. Returns the BOS (Basic OSCAR Service) server address and login cookie for subsequent operations.

**Request:**
```json
{
  "host": "login.oscar.aol.com",
  "port": 5190,
  "screenName": "TestUser123",
  "password": "password123",
  "timeout": 15000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "login.oscar.aol.com",
  "port": 5190,
  "screenName": "TestUser123",
  "bosHost": "bos.oscar.aol.com",
  "bosPort": 5190,
  "cookieHex": "4a7f9e2b8c1d3f5a6e8b9c2d4f7a1e3b",
  "cookieLength": 16
}
```

**Response (Invalid Credentials):**
```json
{
  "success": false,
  "host": "login.oscar.aol.com",
  "port": 5190,
  "screenName": "TestUser123",
  "errorCode": 4,
  "error": "Incorrect nick or password"
}
```

**Response (Account Suspended):**
```json
{
  "success": false,
  "host": "login.oscar.aol.com",
  "port": 5190,
  "screenName": "TestUser123",
  "errorCode": 18,
  "error": "Account suspended"
}
```

**Field Defaults:**
- `port`: 5190
- `timeout`: 15000 ms

**Error Codes:**
- `1`: Invalid nick or password
- `4`: Incorrect nick or password
- `5`: Mismatch nick or password
- `18`: Account suspended
- `24`: Rate limit exceeded

**Authentication Flow:**
1. Send SNAC 0x0017/0x0006 (AuthKeyRequest) with screen name
2. Receive SNAC 0x0017/0x0007 (AuthKeyResponse) with MD5 challenge key
3. Compute MD5 hash: `MD5(authKey + MD5(password) + "AOL Instant Messenger (SM)")`
4. Send SNAC 0x0017/0x0002 (LoginRequest) with screen name, hash, client info
5. Receive SNAC 0x0017/0x0003 (LoginReply) with BOS address (TLV 0x0005) and cookie (TLV 0x0006)

**TLV Types in LoginRequest:**
- `0x0001`: Screen name
- `0x0025`: MD5 auth hash (16 bytes)
- `0x0003`: Client ID string ("AIM 5.9.3797")
- `0x0016`: Client ID code (0x0109)
- `0x000E`: Country code ("us")
- `0x000F`: Language ("en")

**TLV Types in LoginReply:**
- `0x0005`: BOS server address (format: "host:port")
- `0x0006`: Authorization cookie (opaque binary, used for BOS connection)
- `0x0008`: Error code (if login failed)

**Notes:**
- BOS cookie is returned as hex string for debugging/logging
- Cookie must be preserved exactly (binary data) for BOS connection
- BOS port defaults to 5190 if not specified in address
- Password is hashed with MD5 (insecure by modern standards)

---

### 5. BUDDY-LIST — Retrieve Server-Side Buddy List

**Endpoint:** `POST /api/oscar/buddy-list`

Performs full login and connects to BOS server to retrieve the server-stored buddy list (SSI - Server-Side Information).

**Request:**
```json
{
  "host": "login.oscar.aol.com",
  "port": 5190,
  "screenName": "TestUser123",
  "password": "password123",
  "timeout": 20000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "login.oscar.aol.com",
  "screenName": "TestUser123",
  "bosHost": "bos.oscar.aol.com",
  "bosPort": 5190,
  "ssiReceived": true,
  "itemCount": 12,
  "buddies": [
    { "name": "Friend1", "groupId": 1, "itemId": 2, "type": "buddy" },
    { "name": "Friend2", "groupId": 1, "itemId": 3, "type": "buddy" },
    { "name": "Coworker", "groupId": 2, "itemId": 5, "type": "buddy" }
  ],
  "groups": [
    { "name": "Friends", "groupId": 1, "itemId": 1, "type": "group" },
    { "name": "Work", "groupId": 2, "itemId": 4, "type": "group" }
  ],
  "allItems": [
    { "name": "Friends", "groupId": 1, "itemId": 1, "type": "group" },
    { "name": "Friend1", "groupId": 1, "itemId": 2, "type": "buddy" },
    { "name": "Friend2", "groupId": 1, "itemId": 3, "type": "buddy" },
    { "name": "Work", "groupId": 2, "itemId": 4, "type": "group" },
    { "name": "Coworker", "groupId": 2, "itemId": 5, "type": "buddy" }
  ],
  "snacFamiliesReceived": [
    "0x0001/0x0003",
    "0x0001/0x0007",
    "0x0013/0x0006"
  ]
}
```

**Response (Login Failed):**
```json
{
  "success": false,
  "host": "login.oscar.aol.com",
  "screenName": "TestUser123",
  "error": "Login failed (code 4)"
}
```

**Field Defaults:**
- `port`: 5190
- `timeout`: 20000 ms (longer due to multi-step process)

**BOS Connection Flow:**
1. Perform auth server login (get BOS address + cookie)
2. Connect to BOS server
3. Send FLAP channel 1 signon with cookie (TLV 0x0006)
4. Receive SNAC 0x0001/0x0003 (ServerReady)
5. Parse SNAC 0x0001/0x0007 (RateInfo) to extract rate class IDs
6. Send SNAC 0x0001/0x0008 (RateAck) with class IDs
7. Send SNAC 0x0013/0x0002 (SSI checkout request)
8. Receive SNAC 0x0013/0x0006 (SSI data)

**SSI Item Types:**
- `0`: buddy (individual contact)
- `1`: group (buddy list folder)
- `2`: permit (allow list)
- `3`: deny (block list)
- `5`: master_group (root group)
- `14`: presence (visibility setting)

**SSI Item Structure:**
- `name`: UTF-8 screen name or group name (empty for master_group)
- `groupId`: Group ID (0 for ungrouped)
- `itemId`: Unique item ID within group
- `type`: Item type string (see above)

**Rate Limiting:**
- OSCAR servers use rate classes to prevent flooding
- RateInfo SNAC (0x0001/0x0007) contains rate limits per class
- RateAck must echo all class IDs received in RateInfo
- Rate classes are 16-bit integers (typically 1-5)

**Notes:**
- Empty buddy list returns `[]` (valid state)
- Buddies are grouped by `groupId` matching group items
- `allItems` includes all SSI items in server order
- `snacFamiliesReceived` lists all SNAC family/subtype pairs seen during connection
- Some revival servers may not support SSI (returns empty list)

---

### 6. SEND-IM — Send Instant Message

**Endpoint:** `POST /api/oscar/send-im`

Performs full authentication flow and sends an instant message to a target screen name.

**Request:**
```json
{
  "host": "login.oscar.aol.com",
  "port": 5190,
  "screenName": "TestUser123",
  "password": "password123",
  "targetScreenName": "Friend456",
  "message": "Hello from OSCAR protocol!",
  "timeout": 15000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "login.oscar.aol.com",
  "port": 5190,
  "screenName": "TestUser123",
  "targetScreenName": "Friend456",
  "message": "Hello from OSCAR protocol!",
  "bosServer": "bos.oscar.aol.com:5190",
  "messageSent": true,
  "ackSNAC": "0004/000c"
}
```

**Response (Auth Failed):**
```json
{
  "success": false,
  "error": "Login failed: error 0x0004 (wrong password or screen name)"
}
```

**Response (Timeout):**
```json
{
  "success": false,
  "error": "Overall timeout"
}
```

**Field Defaults:**
- `port`: 5190
- `timeout`: 15000 ms

**Required Fields:**
- `host`: Auth server hostname
- `screenName`: Sender's screen name
- `password`: Sender's password
- `targetScreenName`: Recipient's screen name
- `message`: Message text (ASCII)

**Message Sending Flow:**
1. Authenticate on auth server (AuthKeyRequest → LoginRequest)
2. Receive BOS server address and cookie
3. Connect to BOS server with cookie
4. Wait for SNAC 0x0001/0x0003 (ServerReady)
5. Send SNAC 0x0001/0x0002 (ClientReady) declaring supported families
6. Send SNAC 0x0004/0x0006 (ICBM SendIM) with message

**ICBM (Inter-Client Basic Messaging) Structure:**
- 8-byte random cookie (message ID)
- Channel 1 (0x0001 = plaintext IM)
- Screen name length (1 byte) + screen name
- Warning level (2 bytes, always 0)
- TLV count (2 bytes, always 1)
- TLV 0x0002: Message data
  - Capability fragment (type 0x05, empty)
  - Text fragment (type 0x01, charset 0x0000 = ASCII)

**Acknowledgment SNACs:**
- `0x0004/0x000c`: Message acknowledgment (delivery confirmed)
- `0x0004/0x000a`: Message missed (user offline)
- `0x0001/0x0003`: Server ready (not an ack)

**Notes:**
- Messages are ASCII only (no UTF-8 support in this implementation)
- 8-byte ICBM cookie is randomly generated per message
- No delivery confirmation is guaranteed (check `ackSNAC` field)
- Revival servers may have different ack behavior than original AIM
- Message length is not explicitly limited (server may enforce limits)

---

## Protocol Wire Format

### FLAP Frame Structure

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Start (0x2A) |    Channel    |        Sequence Number        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         Data Length           |     Data (variable)...        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Field Descriptions:**
- **Start Byte** (1 byte): Always 0x2A (ASCII asterisk '*')
- **Channel** (1 byte): FLAP channel type (1-5)
- **Sequence Number** (2 bytes, BE): Incrementing frame counter
- **Data Length** (2 bytes, BE): Payload size in bytes
- **Data** (variable): Payload (SNAC for channel 2, version for channel 1, empty for channel 5)

### SNAC Structure

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Family ID            |          Subtype ID           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|            Flags              |          Request ID           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         Request ID (cont)     |     Data (variable)...        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Field Descriptions:**
- **Family ID** (2 bytes, BE): Service family (0x0001 = Generic, 0x0004 = ICBM, 0x0017 = Auth)
- **Subtype ID** (2 bytes, BE): Command within family
- **Flags** (2 bytes, BE): SNAC flags (typically 0x0000)
- **Request ID** (4 bytes, BE): Request identifier for matching responses
- **Data** (variable): SNAC-specific payload (usually TLVs)

### TLV (Type-Length-Value) Structure

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|             Type              |            Length             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Value (variable, length specified by Length field)...     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Field Descriptions:**
- **Type** (2 bytes, BE): TLV type identifier
- **Length** (2 bytes, BE): Value length in bytes
- **Value** (variable): Type-specific data

## Common SNAC Families

| Family | Hex    | Name | Description |
|--------|--------|------|-------------|
| 1      | 0x0001 | Generic | Connection management, rate limits, server ready |
| 2      | 0x0002 | Location | User location and directory services |
| 3      | 0x0003 | Buddy List | Buddy list management (deprecated, use SSI) |
| 4      | 0x0004 | ICBM | Inter-Client Basic Messaging (instant messages) |
| 9      | 0x0009 | Privacy | Privacy and blocking settings |
| 19     | 0x0013 | SSI | Server-Side Information (buddy list storage) |
| 23     | 0x0017 | Authorization | Authentication and registration |

## Common SNAC Subtypes

### Family 0x0001 (Generic)
| Subtype | Hex    | Name | Direction | Description |
|---------|--------|------|-----------|-------------|
| 2       | 0x0002 | ClientReady | Client → Server | Client declares supported families |
| 3       | 0x0003 | ServerReady | Server → Client | Server ready for commands |
| 7       | 0x0007 | RateInfo | Server → Client | Rate limiting information |
| 8       | 0x0008 | RateAck | Client → Server | Acknowledge rate limits |

### Family 0x0004 (ICBM)
| Subtype | Hex    | Name | Direction | Description |
|---------|--------|------|-----------|-------------|
| 6       | 0x0006 | SendIM | Client → Server | Send instant message |
| 7       | 0x0007 | ReceiveIM | Server → Client | Incoming instant message |
| 10      | 0x000a | MessageMissed | Server → Client | Message not delivered (user offline) |
| 12      | 0x000c | MessageAck | Server → Client | Message delivery confirmation |

### Family 0x0013 (SSI)
| Subtype | Hex    | Name | Direction | Description |
|---------|--------|------|-----------|-------------|
| 2       | 0x0002 | CheckoutRequest | Client → Server | Request SSI data |
| 6       | 0x0006 | SSIData | Server → Client | SSI item list |
| 14      | 0x000e | SSIAdd | Client → Server | Add SSI item |
| 15      | 0x000f | SSIUpdate | Client → Server | Update SSI item |
| 16      | 0x0010 | SSIDelete | Client → Server | Delete SSI item |

### Family 0x0017 (Authorization)
| Subtype | Hex    | Name | Direction | Description |
|---------|--------|------|-----------|-------------|
| 2       | 0x0002 | LoginRequest | Client → Server | MD5 login with credentials |
| 3       | 0x0003 | LoginReply | Server → Client | Login result with BOS address |
| 6       | 0x0006 | AuthKeyRequest | Client → Server | Request MD5 challenge key |
| 7       | 0x0007 | AuthKeyReply | Server → Client | MD5 challenge key |

## Known Issues and Limitations

### Critical Issues

1. **Resource Leaks Fixed** (2026-02-18)
   - Stream reader/writer locks were not released in error paths
   - setTimeout handles were not cleared after Promise.race completion
   - Could cause memory leaks under high load or network errors
   - **Status:** FIXED in all handlers

2. **Incomplete Frame Handling Fixed** (2026-02-18)
   - `parseFLAPFrame` accepted partial frames without validation
   - `readFLAP` could return incomplete frames on timeout
   - Could cause parse errors or data corruption
   - **Status:** FIXED - now validates complete frame before returning

### Security Concerns

3. **MD5 Authentication**
   - MD5 is cryptographically broken (collision attacks possible)
   - Passwords hashed with MD5 (no salt, no key derivation)
   - Auth key transmitted in plaintext (no TLS by default)
   - **Impact:** Credentials vulnerable to MITM and rainbow table attacks
   - **Mitigation:** Use TLS if supported by revival server

4. **No Certificate Validation**
   - TLS connections (if used) do not validate server certificates
   - Subject to MITM attacks even with TLS
   - **Impact:** Attacker can intercept credentials
   - **Status:** Not implemented (secureTransport set to 'off')

### Protocol Compliance

5. **Missing Port Validation in Some Handlers**
   - `handleOSCARAuth` and `handleOSCARLogin` originally lacked port range validation
   - **Status:** FIXED - all handlers now validate port 1-65535

6. **No Host Format Validation**
   - Host parameter accepts any string (no DNS validation)
   - Could accept invalid hostnames or IP addresses
   - **Impact:** Connection will fail with unclear error
   - **Status:** OPEN - consider adding host regex validation

7. **Hardcoded Client Version**
   - LoginRequest uses "AIM 5.9.3797" and client ID 0x0109
   - Some servers may reject outdated client versions
   - **Impact:** May fail against strict revival servers
   - **Status:** OPEN - consider making client info configurable

8. **Sequence Number Tracking**
   - FLAP sequence numbers should increment per frame
   - Some handlers use hardcoded values (0, 1, 2)
   - **Impact:** Minor protocol deviation, most servers tolerate it
   - **Status:** OPEN - consider proper sequence tracking

### Functional Limitations

9. **ASCII-Only Messages**
   - ICBM SendIM uses charset 0x0000 (ASCII)
   - No UTF-8 or Unicode support
   - **Impact:** Cannot send non-ASCII characters (emoji, accents, CJK)
   - **Workaround:** Use UTF-8 encoding with charset 0x0003 (not implemented)

10. **No Message Delivery Guarantee**
    - SendIM reads one ack SNAC with 2-second timeout
    - May miss ack if server responds slowly
    - No retry mechanism for failed sends
    - **Impact:** Message may send successfully but report failure
    - **Status:** OPEN - consider longer ack timeout or multiple reads

11. **No Connection Reuse**
    - Each API call creates new TCP connection
    - Auth, BOS, and message send are separate connections
    - **Impact:** High latency for send-im (3 connections required)
    - **Workaround:** Consider session management for persistent connections

12. **Rate Limiting Not Enforced**
    - RateInfo (SNAC 0x0001/0x0007) is parsed but not used
    - No client-side rate limiting or backoff
    - **Impact:** Server may disconnect if rate limits exceeded
    - **Status:** OPEN - rate limits are acknowledged but not enforced

### Parsing Issues

13. **TLV Parsing Incomplete**
    - `parseTLVs` stops if length exceeds remaining buffer
    - Does not return partial TLVs or report truncation
    - **Impact:** Silent data loss if TLV chain is malformed
    - **Status:** OPEN - consider error reporting for truncated TLVs

14. **Error Response Inconsistency**
    - Error handlers originally returned empty host/default port
    - **Status:** FIXED - now extracts actual values from request body

15. **SSI Item Type Coverage**
    - Only 6 SSI item types mapped (0, 1, 2, 3, 5, 14)
    - Other types (4, 6-13, 15+) return generic "typeN" string
    - **Impact:** Uncommon SSI items have unclear type names
    - **Status:** OPEN - consider adding remaining type names

### Documentation Gaps

16. **No SNAC Flag Documentation**
    - SNAC flags field always set to 0x0000
    - Meaning of flag bits not documented
    - **Impact:** Cannot handle server-set flags
    - **Status:** OPEN - research flag meanings

17. **BOS Cookie Lifetime Unknown**
    - Login cookie returned but expiration not documented
    - Unknown if cookie can be reused across sessions
    - **Impact:** Cannot implement persistent sessions
    - **Status:** OPEN - needs testing with revival servers

18. **ICBM Channel Support**
    - Only channel 1 (plaintext IM) implemented
    - Channel 2 (rendezvous/file transfer) not supported
    - Channel 4 (typing notifications) not supported
    - **Impact:** Limited to basic instant messaging
    - **Status:** OPEN - consider adding channel 2/4 support

## Testing with Revival Servers

### NINA (Not ICQ, Not AIM)
- **URL:** https://github.com/mk6i/retro-aim-server
- **Status:** Active (2024)
- **Compatibility:** AIM protocol, OSCAR 1.0+
- **Notes:** Supports buddy lists, messaging, away messages

### Phoenix AIM Server
- **URL:** https://github.com/jgknight/phoenix
- **Status:** Active (2023)
- **Compatibility:** AIM/ICQ dual protocol
- **Notes:** Supports file transfer, chat rooms

### Testing Checklist
1. Create test account on revival server
2. Test `/api/oscar/probe` for connectivity
3. Test `/api/oscar/auth` for auth key exchange
4. Test `/api/oscar/login` with valid credentials
5. Test `/api/oscar/buddy-list` to retrieve contacts
6. Test `/api/oscar/send-im` to send message to self or test buddy
7. Verify ack SNAC received (0x0004/0x000c)

## Use Cases

1. **Protocol Archaeology**: Study historical IM protocols
2. **Revival Server Testing**: Verify OSCAR server implementations
3. **Security Research**: Analyze MD5 authentication weaknesses
4. **Nostalgia Projects**: Build modern clients for AIM revival servers
5. **Network Debugging**: Diagnose OSCAR connection issues

## Resources

- **AOL Instant Messenger** (Wikipedia): https://en.wikipedia.org/wiki/AOL_Instant_Messenger
- **OSCAR Protocol Documentation** (unofficial): http://iserverd.khstu.ru/oscar/
- **libpurple OSCAR Plugin**: https://developer.pidgin.im/wiki/Protocol%20Specific%20Questions#OSCAR
- **NINA Server**: https://github.com/mk6i/retro-aim-server
- **Phoenix Server**: https://github.com/jgknight/phoenix

## Historical Notes

- **1997**: AIM launched by AOL
- **1998**: ICQ acquired by AOL, adopted OSCAR
- **2005**: OSCAR protocol reverse-engineered by open source community
- **2017**: AIM officially shut down by Verizon
- **2024**: ICQ discontinued by VK
- **2024+**: Revival servers keep OSCAR alive for nostalgia and research

## Client Implementation Notes

If building a full OSCAR client:

1. **Connection Management**: Keep auth and BOS connections separate
2. **Sequence Numbers**: Track per-connection sequence counter
3. **Rate Limiting**: Parse RateInfo and enforce client-side limits
4. **Keepalives**: Send FLAP channel 5 keepalives every 60 seconds
5. **Buddy List Sync**: Use SSI checkout on connect, store locally
6. **Message Queue**: Queue outbound messages if rate limited
7. **Presence Updates**: Subscribe to buddy presence (SNAC 0x0003)
8. **Away Messages**: Set location info (SNAC 0x0002)
9. **Error Handling**: Reconnect on FLAP channel 3 (error) or channel 4 (close)
10. **Security**: Use TLS if server supports STARTTLS (rare)

## Implementation Quality

**Code Review Score: B+**

**Strengths:**
- Comprehensive endpoint coverage (6 endpoints)
- Correct FLAP and SNAC framing
- Proper MD5 authentication flow
- SSI buddy list parsing with type mapping
- Rate info parsing (even if not enforced)
- Good error handling with specific error codes

**Fixed Issues (2026-02-18):**
- Resource leaks (stream locks, timeout handles)
- Incomplete frame handling
- Port validation consistency
- Error response field accuracy

**Remaining Improvements:**
- Add UTF-8 message support (charset 0x0003)
- Implement client-side rate limiting
- Add connection keepalive support
- Support ICBM channel 2 (file transfer)
- Add STARTTLS support
- Improve message delivery confirmation
- Add session/connection reuse

**Overall:** Solid implementation for protocol research and revival server testing. Not suitable for production IM client without addressing security and functionality gaps.
