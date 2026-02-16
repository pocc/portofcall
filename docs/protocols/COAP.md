## VERIFY & EDGE CASES

### Authentication

**CoAP (This Implementation):**
- ❌ **No authentication** in base CoAP protocol
- CoAP is designed to be lightweight - authentication optional
- ⚠️ **Vulnerability:** Anyone can send requests to open CoAP servers

**CoAP Authentication Extensions (Not Implemented):**
- **CoAPS (DTLS):** Port 5684 - DTLS encryption (like HTTPS for CoAP)
- **OSCORE:** Object Security for Constrained RESTful Environments (RFC 8613)
- **ACE:** Authentication and Authorization for Constrained Environments (RFC 9200)

**Edge Cases:**
- Open server → No authentication required (like HTTP)
- Protected resource → Server returns 4.01 Unauthorized
- Wrong credentials → 4.03 Forbidden response

---

### Timeouts and Keep-Alives

**Connection Timeout:**
- ✅ Default: 10 seconds
- ✅ Configurable via `timeout` parameter
- ✅ Covers entire operation (TCP connect + CoAP request + response)

**No Keep-Alives Required:**
- CoAP over TCP (RFC 8323) uses persistent connections by default
- Each request reuses the TCP connection if kept open
- This implementation opens/closes per request (stateless)

**Confirmable vs. Non-Confirmable:**
- **CON (Confirmable):** Requires ACK from server (reliable)
- **NON (Non-Confirmable):** No ACK required (fire-and-forget)
- This implementation sends CON by default for reliability

**Retransmission (Not Implemented):**
- Standard CoAP over UDP uses exponential backoff retries
- CoAP over TCP doesn't need retransmission (TCP handles it)
- Our implementation relies on TCP reliability

**Edge Cases:**
- Server doesn't respond → TCP timeout (10s default)
- Server responds with RST → Error returned to client
- Network congestion → TCP handles retransmission automatically

---

### Binary vs. Text Encoding

**Request Path: JSON → Binary**
```
Client JSON → Worker → Binary CoAP Message → TCP Socket → CoAP Server
```

**Response Path: Binary → JSON**
```
CoAP Server → TCP Socket → Binary CoAP Message → Worker Parser → JSON → Client
```

---

**Binary Encoding Details:**

**CoAP Message Format (Minimum 4 bytes):**

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|Ver| T |  TKL  |      Code     |          Message ID           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Token (if any, TKL bytes) ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Options (if any) ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|1 1 1 1 1 1 1 1|    Payload (if any) ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Header Fields:**
- **Ver (2 bits):** Version (always 1 for CoAP)
- **T (2 bits):** Type (CON=0, NON=1, ACK=2, RST=3)
- **TKL (4 bits):** Token length (0-8 bytes)
- **Code (8 bits):** Method (0.01-0.04) or Response (2.XX, 4.XX, 5.XX)
- **Message ID (16 bits):** For matching requests/responses

**Code Format (Class.Detail):**
- 3 bits: Class (0=method, 2=success, 4=client error, 5=server error)
- 5 bits: Detail (specific method or status)
- Examples:
  - `0.01` (0x01) = GET
  - `2.05` (0x45) = Content (success)
  - `4.04` (0x84) = Not Found

**Options Encoding (Variable Length):**
```
 0   1   2   3   4   5   6   7
+---------------+---------------+
|  Option Delta | Option Length |   (1 byte)
+---------------+---------------+
/         Option Delta           (0-2 bytes)
\          (extended)            /
+-------------------------------+
/         Option Length          (0-2 bytes)
\          (extended)            /
+-------------------------------+
\                               /
/         Option Value           (0-N bytes)
\                               /
+-------------------------------+
```

**Option Delta/Length Encoding:**
- 0-12: Value directly in nibble
- 13: +1 byte (value = extended + 13)
- 14: +2 bytes (value = extended + 269)
- 15: Reserved (payload marker if in both nibbles)

**Path Encoding:**
- Path `/sensors/temp` becomes:
  - Option 11 (Uri-Path): "sensors"
  - Option 11 (Uri-Path): "temp"
- Delta for first = 11, delta for second = 0 (same option number)

---

**Edge Cases:**

**Option Encoding:**
- ✅ Path segments split by `/`: Each segment is a separate Uri-Path option
- ✅ Empty path (`/`) → No Uri-Path options
- ✅ Long option values (>255 bytes) → Extended length encoding
- ✅ Many options (>12 delta) → Extended delta encoding

**Payload Marker:**
- ✅ 0xFF byte separates options from payload
- ✅ No payload → No marker needed
- ❌ Payload without marker → Parser error

**Content-Format:**
- ✅ 0 = text/plain (default if not specified)
- ✅ 50 = application/json (for JSON payloads)
- ✅ 60 = application/cbor (binary-efficient JSON alternative)
- ⚠️ Unknown formats → Returned as base64-encoded binary

**Token Matching:**
- Client generates random 4-byte token
- Server echoes token in response
- Used to match async responses to requests
- This implementation uses synchronous requests (token for protocol compliance only)

**Truncated/Malformed Messages:**
- Message < 4 bytes → Error: "CoAP message too short"
- Invalid version → Error: "Unsupported CoAP version"
- Invalid option delta/length (15 in wrong context) → Error: "Reserved option value"
- Non-CoAP response → Parse error with descriptive message

**Response Code Interpretation:**
- 2.XX (Success): Request succeeded
  - 2.01 Created, 2.02 Deleted, 2.04 Changed, 2.05 Content
- 4.XX (Client Error): Client sent invalid request
  - 4.00 Bad Request, 4.04 Not Found, 4.05 Method Not Allowed
- 5.XX (Server Error): Server encountered error
  - 5.00 Internal Server Error, 5.01 Not Implemented

---

## Summary

✅ **Complete CoAP Implementation:**
- Full RFC 7252/8323 client implementation
- Binary message encoder/decoder with option handling
- Support for GET, POST, PUT, DELETE methods
- Confirmable/Non-confirmable message types
- Content-Format negotiation
- Path segment encoding
- Resource discovery (/.well-known/core)

✅ **Production Considerations:**
- ⚠️ No authentication (use CoAPS or OSCORE for security)
- ⚠️ TCP instead of UDP (most IoT devices support both)
- ⚠️ Stateless (no observe/pub-sub pattern)
- ✅ Comprehensive error handling
- ✅ Public test servers available

✅ **Well Documented:**
- Complete protocol specification
- RESTful API design
- Binary encoding details
- Example client and test resources

---

**CoAP implementation complete!** The protocol has been successfully integrated into the Port of Call gateway with full support for lightweight RESTful communication with IoT and constrained devices over TCP.
