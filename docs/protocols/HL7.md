# HL7 v2.x — Health Level Seven (MLLP)

**Port:** 2575 (default)
**Transport:** TCP with MLLP framing (RFC not formalized; de facto standard per IHE)
**Implementation:** `src/worker/hl7.ts`
**Rating:** ★★★★★

Four endpoints. All POST, all JSON body. Messages are pipe-delimited HL7 v2.5 text wrapped in MLLP framing (`0x0B` ... `0x1C 0x0D`) over `cloudflare:sockets` TCP.

---

## Endpoints

| Method | Path | Purpose | Default timeout |
|--------|------|---------|-----------------|
| POST | `/api/hl7/connect` | TCP/MLLP connectivity test (no HL7 message sent) | 10 000 ms |
| POST | `/api/hl7/send` | Send ADT^A01 or ORU^R01 (or raw message) and read ACK | 10 000 ms |
| POST | `/api/hl7/query` | Send QRY^Q01 patient query and read response | 10 000 ms |
| POST | `/api/hl7/adt-a08` | Send ADT^A08 (Update Patient Info) and read ACK | 10 000 ms |

No GET forms. No HTTP method restriction — all endpoints accept any method (they all parse `request.json()` without checking `request.method`).

---

## POST `/api/hl7/connect`

Opens a TCP socket to the target, confirms the connection succeeds, then immediately closes it. **No HL7 message is sent.** This only verifies that the MLLP port is reachable.

### Request

```json
{
  "host": "hl7.example.com",
  "port": 2575,
  "timeout": 10000
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | *required* | Cloudflare-fronted hosts blocked (HTTP 403). |
| `port` | number | `2575` | **No port validation** — any value accepted; out-of-range fails at TCP level. |
| `timeout` | number | `10000` | Wall-clock timeout in ms. |

### Response (success)

```json
{
  "success": true,
  "host": "hl7.example.com",
  "port": 2575,
  "rtt": 34,
  "message": "MLLP connection established in 34ms",
  "protocol": "HL7 v2.x / MLLP"
}
```

| Field | Notes |
|-------|-------|
| `rtt` | ms from `connect()` call to `socket.opened` — TCP connect time only. Misleading name since no round-trip HL7 exchange occurs. |
| `message` | Hardcoded template: `"MLLP connection established in {rtt}ms"`. Always present on success. |
| `protocol` | Always `"HL7 v2.x / MLLP"`. |

### Error HTTP status codes

| Code | Cause |
|------|-------|
| 400 | Missing `host` |
| 403 | Cloudflare-fronted host |
| 500 | Connection error (generic) |
| 504 | Timeout — note: this is the only endpoint that returns 504 for timeouts; `/send`, `/query`, and `/adt-a08` also return 504 for timeouts |

```bash
curl -X POST https://portofcall.dev/api/hl7/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"hl7.example.com","port":2575}'
```

---

## POST `/api/hl7/send`

Sends an HL7 v2.5 message via MLLP and reads the ACK response. Supports two built-in message types (ADT^A01, ORU^R01) or a raw message pass-through.

### Request

```json
{
  "host": "hl7.example.com",
  "port": 2575,
  "timeout": 10000,
  "messageType": "ADT^A01",
  "sendingApplication": "PortOfCall",
  "sendingFacility": "TestFacility",
  "receivingApplication": "",
  "receivingFacility": "",
  "rawMessage": null
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | *required* | |
| `port` | number | `2575` | No validation. |
| `timeout` | number | `10000` | Wall-clock timeout. |
| `messageType` | string | `"ADT^A01"` | Only `"ORU^R01"` is specifically handled; **any other value falls through to ADT^A01**. |
| `sendingApplication` | string | `"PortOfCall"` | MSH-3. |
| `sendingFacility` | string | `"TestFacility"` | MSH-4. |
| `receivingApplication` | string | `""` | MSH-5. |
| `receivingFacility` | string | `""` | MSH-6. |
| `rawMessage` | string | *(null)* | If non-null, sent verbatim (bypasses built-in message builders). Must be a complete HL7 message with `\r`-separated segments. |

### Message type dispatch

```
if (rawMessage) → send rawMessage as-is
else if (messageType === "ORU^R01") → buildORU_R01(...)
else → buildADT_A01(...)   // catches ADT^A01, ADT^A08, anything else
```

The `messageType` field is only used for dispatch — it doesn't appear in the MSH segment of built-in messages (those always have the correct MSH-9 hardcoded).

### Built-in ADT^A01 message

```
MSH|^~\&|{sendingApp}|{sendingFac}|{recvApp}|{recvFac}|{ts}||ADT^A01|{controlId}|P|2.5
EVN|A01|{ts}
PID|1||TESTPID001^^^TestHosp^MR||TEST^PATIENT^A||19800101|M|||123 Test St^^TestCity^TS^12345^USA
PV1|1|I|TestWard^101^A|E|||TestDoc^Test^MD
```

- Patient data is **hardcoded**: patient ID `TESTPID001`, name `TEST^PATIENT^A`, DOB `19800101`, Male, address `123 Test St`. There is no way to customize patient demographics via `/send` — use `/adt-a08` for that or pass `rawMessage`.
- Processing ID is always `P` (Production). No way to set `D` (Debugging) or `T` (Training).
- Version is always `2.5`.

### Built-in ORU^R01 message

```
MSH|^~\&|{sendingApp}|{sendingFac}|{recvApp}|{recvFac}|{ts}||ORU^R01|{controlId}|P|2.5
PID|1||TESTPID001^^^TestHosp^MR||TEST^PATIENT^A||19800101|M
OBR|1|ORD001||CBC^Complete Blood Count|||{ts}
OBX|1|NM|WBC^White Blood Cell Count||7.5|10*3/uL|4.5-11.0|N|||F
OBX|2|NM|RBC^Red Blood Cell Count||4.8|10*6/uL|4.2-5.9|N|||F
OBX|3|NM|HGB^Hemoglobin||14.2|g/dL|12.0-17.5|N|||F
```

- Lab results are hardcoded CBC values. Same patient demographics as ADT^A01.
- OBX value type is always `NM` (Numeric). Abnormality flag is `N` (Normal). Status is `F` (Final).

### Response (success)

```json
{
  "success": true,
  "host": "hl7.example.com",
  "port": 2575,
  "rtt": 87,
  "sent": {
    "messageType": "ADT",
    "triggerEvent": "A01",
    "controlId": "MSG1708192345678",
    "version": "2.5",
    "segmentCount": 4,
    "rawMessage": "MSH|^~\\&|PortOfCall|TestFacility|..."
  },
  "response": {
    "messageType": "ACK",
    "triggerEvent": "",
    "controlId": "ACK123",
    "ackCode": "AA",
    "ackText": "Message accepted",
    "rawMessage": "MSH|^~\\&|..."
  }
}
```

| Field | Notes |
|-------|-------|
| `sent.rawMessage` | Truncated to first 2000 characters. |
| `response.rawMessage` | Also truncated to 2000 characters. |
| `response.ackCode` | From MSA-1: `AA` (accept), `AE` (error), `AR` (reject), `CA`/`CE`/`CR` (enhanced mode). |
| `response.ackText` | From MSA-3 (not MSA-2). See parser quirk below. |
| `response` | `null` if server closed connection without sending an ACK. |

### ACK response reading

The ACK reader accumulates TCP chunks until it finds an `END_OF_BLOCK` (0x1C) byte. There is **no read timeout** beyond the outer wall-clock timeout — if the server sends bytes slowly without an FS byte, the handler hangs until the overall timeout fires.

```bash
curl -X POST https://portofcall.dev/api/hl7/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"hl7.example.com","messageType":"ORU^R01"}'
```

### Sending a raw message

```bash
curl -X POST https://portofcall.dev/api/hl7/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "hl7.example.com",
    "rawMessage": "MSH|^~\\&|MyApp|MyFac|TheirApp|TheirFac|20260217120000||ORM^O01|CTL001|P|2.5\rPID|1||PAT001^^^Hosp^MR||Smith^Jane\rORC|NW|ORD001||||||20260217\rOBR|1|ORD001||CBC^Complete Blood Count"
  }'
```

Note: In JSON, `\r` represents a carriage return (0x0D), which is the HL7 segment separator. The `rawMessage` string must use literal `\r` characters between segments, not `\n` or `\r\n`.

---

## POST `/api/hl7/query`

Sends a QRY^Q01 (Patient Query) message and parses the response. The query uses the deprecated QRY/QCK pattern (HL7 v2.3 era); modern systems use QBP^Q22 or FHIR instead.

### Request

```json
{
  "host": "hl7.example.com",
  "port": 2575,
  "timeout": 10000,
  "queryId": "QID1708192345678",
  "patientId": "TESTPID001",
  "dateRange": ""
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | *required* | |
| `port` | number | `2575` | |
| `timeout` | number | `10000` | |
| `queryId` | string | `"QID{Date.now()}"` | QRD-4 query ID. Auto-generated if omitted. |
| `patientId` | string | `"TESTPID001"` | QRD-8 who-subject filter. Formatted as `{patientId}^^^TestHosp^MR`. |
| `dateRange` | string | `""` | QRD-12 quantity/timing qualifier. Empty = no date filter. |

### Generated QRY^Q01 message

```
MSH|^~\&|PortOfCall|TestFacility|||{ts}||QRY^Q01|{controlId}|P|2.5
QRD|{ts}|R|I|{queryId}|||99^RD|{patientId}^^^TestHosp^MR|@PID|||{dateRange}
```

- Sending/receiving app and facility are **hardcoded** (`PortOfCall` / `TestFacility` / empty / empty). Unlike `/send`, there is no way to customize these.
- QRD-2 format code is `R` (Record-oriented).
- QRD-3 priority is `I` (Immediate).
- QRD-7 quantity is `99^RD` (up to 99 records).
- QRD-9 what-subject filter is `@PID` (patient identification).

### Response

```json
{
  "success": true,
  "host": "hl7.example.com",
  "port": 2575,
  "rtt": 102,
  "queryId": "QID1708192345678",
  "ackCode": "AA",
  "messageCount": 5,
  "segments": [
    { "id": "MSH", "fieldCount": 11 },
    { "id": "MSA", "fieldCount": 2 },
    { "id": "QAK", "fieldCount": 3 },
    { "id": "PID", "fieldCount": 12 },
    { "id": "PV1", "fieldCount": 8 }
  ]
}
```

| Field | Notes |
|-------|-------|
| `ackCode` | From MSA-1 of the response. `null` if no MSA segment. |
| `messageCount` | Count of segments **excluding** MSH, MSA, QAK, and QRD. These are the "data" segments. |
| `segments` | All segments with segment ID and field count. **Field values are not returned** — only the structure. |

**Key limitation:** The actual field data from the query response is not included in the API response. You get the segment structure (IDs and field counts) but not the patient demographics, visit info, or other content. This makes the endpoint useful for verifying that a query interface works, but not for actually retrieving patient data.

```bash
curl -X POST https://portofcall.dev/api/hl7/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"hl7.example.com","patientId":"PAT12345"}'
```

---

## POST `/api/hl7/adt-a08`

Sends an ADT^A08 (Update Patient Information) message with caller-specified demographics. This is the only endpoint that lets you customize patient data.

### Request

```json
{
  "host": "hl7.example.com",
  "port": 2575,
  "timeout": 10000,
  "patientId": "PAT12345",
  "lastName": "Smith",
  "firstName": "Jane",
  "dob": "19900315",
  "sex": "F",
  "diagnosis": "J06.9"
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | *required* | |
| `port` | number | `2575` | |
| `timeout` | number | `10000` | |
| `patientId` | string | *required* | PID-3 patient identifier. Formatted as `{patientId}^^^TestHosp^MR`. |
| `lastName` | string | *required* | PID-5 component 1. |
| `firstName` | string | *required* | PID-5 component 2. |
| `dob` | string | `""` | PID-7 date of birth. Expected format: `YYYYMMDD`. |
| `sex` | string | `""` | PID-8 administrative sex. `M`/`F`/`O`/`U`/`A`/`N`. |
| `diagnosis` | string | `""` | If non-empty, adds a DG1 segment with the value as DG1-3 code (formatted as ICD-10 with code repeated in text field). |

### Generated ADT^A08 message

```
MSH|^~\&|PortOfCall|TestFacility|||{ts}||ADT^A08|{controlId}|P|2.5
EVN|A08|{ts}
PID|1||{patientId}^^^TestHosp^MR||{lastName}^{firstName}||{dob}|{sex}|||123 Test St^^TestCity^TS^12345^USA
PV1|1|O|TestWard^101^A|E|||TestDoc^Test^MD||||{1 if diagnosis else empty}
DG1|1||{diagnosis}^{diagnosis}^ICD10|{diagnosis} Diagnosis||F
```

- Address is **hardcoded** to `123 Test St^^TestCity^TS^12345^USA`. Not configurable.
- Attending physician is hardcoded to `TestDoc^Test^MD`.
- Patient class (PV1-2) is `O` (Outpatient) — different from ADT^A01 which uses `I` (Inpatient).
- Sending app/facility are hardcoded to `PortOfCall` / `TestFacility`.
- DG1 segment is conditionally included only if `diagnosis` is non-empty.
- DG1-3 coding system is hardcoded to `ICD10`. The diagnosis code is repeated as both the identifier and the text.

### Response

```json
{
  "success": true,
  "host": "hl7.example.com",
  "port": 2575,
  "rtt": 65,
  "messageControlId": "A081708192345678",
  "ackCode": "AA",
  "ackText": "Message accepted"
}
```

| Field | Notes |
|-------|-------|
| `messageControlId` | Prefixed with `A08` + `Date.now()`. |
| `ackCode` | From MSA-1. `null` if no ACK received. |
| `ackText` | From MSA-3 (see parser quirk). `null` if absent. |

```bash
curl -X POST https://portofcall.dev/api/hl7/adt-a08 \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "hl7.example.com",
    "patientId": "PAT12345",
    "lastName": "Smith",
    "firstName": "Jane",
    "dob": "19900315",
    "sex": "F",
    "diagnosis": "J06.9"
  }'
```

---

## MLLP Framing

### Wire format

```
0x0B  <HL7 message bytes>  0x1C  0x0D
 VT                          FS    CR
```

| Byte | Name | Hex | Purpose |
|------|------|-----|---------|
| Start of Block | Vertical Tab (VT) | `0x0B` | Marks beginning of message |
| End of Block | File Separator (FS) | `0x1C` | Marks end of message |
| Trailing CR | Carriage Return | `0x0D` | Terminates the frame |

### `wrapMLLP(message)`

Prepends `0x0B`, appends `0x1C 0x0D`. The message string is UTF-8 encoded via `TextEncoder`.

### `unwrapMLLP(data)`

Scans for the first `0x0B` byte and the first `0x1C` byte after it. Returns the bytes between them as a UTF-8 string. If no MLLP framing is found (no `0x0B` or no `0x1C`), returns the entire buffer decoded as UTF-8. This fallback means non-MLLP responses are silently accepted.

---

## HL7 Message Parser (`parseHL7Message`)

Splits on `\r` (0x0D), filters empty lines, then splits each line on `|`. Returns:

- `messageType` / `triggerEvent`: from MSH field index 7 (MSH-9), split on `^`
- `controlId`: MSH field index 8 (MSH-10)
- `version`: MSH field index 10 (MSH-12)
- `sendingApp` / `sendingFac` / `receivingApp` / `receivingFac`: MSH fields 1–4
- `timestamp`: MSH field 5 (MSH-7)
- `ackCode`: MSA field index 0 (MSA-1)
- `ackText`: MSA field index 2 (MSA-3) — **not MSA-2**

### MSH field indexing quirk

The MSH segment is special in HL7: the first `|` after `MSH` is both the field separator character AND MSH-1. This means the parser's `fields[0]` is `^~\&` (MSH-2, encoding characters), `fields[1]` is MSH-3 (sending application), etc. The implementation accounts for this by indexing from the split result: `parts[0]` = `"MSH"`, `parts.slice(1)` = fields starting from the encoding characters.

So the field mapping is:

| Parser index | Actual MSH field | Content |
|-------------|------------------|---------|
| `fields[0]` | MSH-2 | Encoding characters (`^~\&`) |
| `fields[1]` | MSH-3 | Sending application |
| `fields[2]` | MSH-4 | Sending facility |
| `fields[3]` | MSH-5 | Receiving application |
| `fields[4]` | MSH-6 | Receiving facility |
| `fields[5]` | MSH-7 | Timestamp |
| `fields[6]` | MSH-8 | Security |
| `fields[7]` | MSH-9 | Message type (`ADT^A01`) |
| `fields[8]` | MSH-10 | Control ID |
| `fields[9]` | MSH-11 | Processing ID |
| `fields[10]` | MSH-12 | Version ID |

### MSA ackText field

`ackText` is read from `msa.fields[2]`, which is MSA-3 (Text Message). MSA-2 is the Message Control ID of the original message. Most HL7 ACKs put the acknowledgment text in MSA-3, but some systems use ERR segments instead. The check `msa.fields.length > 2` means MSA segments with only 2 fields (MSA-1 + MSA-2) will return `ackText: undefined`.

---

## Known Limitations and Gotchas

### No port validation

None of the four endpoints validate the port range. Invalid ports fail at the TCP connect level with a generic error.

### Hardcoded patient demographics in `/send`

ADT^A01 and ORU^R01 built-in messages use hardcoded test patient data (ID: `TESTPID001`, name: `TEST^PATIENT^A`, DOB: `19800101`, sex: `M`). Only `/adt-a08` allows caller-specified demographics. Use `rawMessage` in `/send` for full control.

### Hardcoded sending application/facility in `/query` and `/adt-a08`

These endpoints always use `PortOfCall` / `TestFacility` as MSH-3/MSH-4. Only `/send` accepts `sendingApplication` and `sendingFacility` parameters.

### Hardcoded address

All built-in messages use `123 Test St^^TestCity^TS^12345^USA` as the patient address. Not configurable via any endpoint.

### UTC timestamps in `/send` and `/query`, local time in `/adt-a08`

The `hl7Timestamp()` function (used by `/send` and `/query`) uses `getUTC*` methods, producing timestamps in UTC. However, the planning doc's `HL7Client.formatDateTime()` used local time — this is irrelevant since the planning doc code is not in the actual implementation. All four handlers use the same `hl7Timestamp()` which is UTC.

### No HL7 escape sequence handling

The parser does not process HL7 escape sequences (`\F\` for `|`, `\S\` for `^`, `\R\` for `~`, `\E\` for `\`, `\T\` for `&`, `\X...\` for hex, `\.br\` for line break). Escaped delimiters in field values will be split incorrectly.

### MessageType fallback to ADT^A01

In `/send`, any `messageType` value other than exactly `"ORU^R01"` results in ADT^A01. If you pass `"ADT^A08"`, `"ORM^O01"`, or any other type, you get ADT^A01. The `messageType` field only controls the build function selection, not the actual MSH-9 value.

### ACK reader has no inner timeout

The MLLP response reader loops on `reader.read()` until it finds `0x1C` or the stream closes. There is no per-read timeout — only the outer `Promise.race` timeout protects against hangs. If the server sends bytes continuously without `0x1C`, the handler will consume data until the wall-clock timeout fires.

### Single MLLP message per connection

Each endpoint opens a new TCP connection, sends one message, reads one ACK, and closes. There is no connection reuse or support for sending multiple messages on a single MLLP session.

### Control ID generation

Each endpoint uses a different control ID prefix:
- `/send`: `MSG{Date.now()}`
- `/query`: `QRY{Date.now()}`
- `/adt-a08`: `A08{Date.now()}`

These are not guaranteed unique across concurrent requests since `Date.now()` has millisecond resolution.

### QRY^Q01 is deprecated

The `/query` endpoint uses QRY^Q01, which was deprecated in HL7 v2.4 (replaced by QBP^Q22). Many modern HL7 interfaces do not support QRY^Q01. The `99^RD` quantity and `@PID` subject filter are v2.3-era conventions.

### `/query` does not return field values

The response includes segment IDs and field counts but not the actual field values. This makes it a structural test, not a data retrieval endpoint.

### Cloudflare detection

All four endpoints call `checkIfCloudflare(host)` before connecting. Returns HTTP 403 with `isCloudflare: true` if the host resolves to a Cloudflare IP.

### Socket cleanup on error

`/send`, `/query`, and `/adt-a08` call `await socket.close()` in the catch block. `/connect` calls `await socket.close()` in the success path. None release the writer/reader locks before closing — `socket.close()` handles this implicitly.

---

## ACK Code Reference

| Code | Name | Meaning |
|------|------|---------|
| `AA` | Application Accept | Message processed successfully |
| `AE` | Application Error | Error in message processing; message may be retried |
| `AR` | Application Reject | Message rejected; do not retry without correction |
| `CA` | Enhanced: Commit Accept | Original mode only |
| `CE` | Enhanced: Commit Error | Original mode only |
| `CR` | Enhanced: Commit Reject | Original mode only |

---

## HL7 v2.5 Segment Reference (used in this implementation)

| Segment | Name | Used in |
|---------|------|---------|
| MSH | Message Header | All messages |
| EVN | Event Type | ADT^A01, ADT^A08 |
| PID | Patient Identification | ADT^A01, ORU^R01, ADT^A08 |
| PV1 | Patient Visit | ADT^A01, ADT^A08 |
| OBR | Observation Request | ORU^R01 |
| OBX | Observation/Result | ORU^R01 |
| DG1 | Diagnosis | ADT^A08 (conditional) |
| QRD | Query Definition | QRY^Q01 |
| MSA | Message Acknowledgment | ACK responses |
| QAK | Query Acknowledgment | Query responses |

---

## Quick Reference

| Endpoint | Custom patient data | Custom app/facility | Raw message | Response detail |
|----------|-------------------|--------------------|----|------|
| `/api/hl7/connect` | n/a | n/a | n/a | TCP RTT only |
| `/api/hl7/send` | No (hardcoded) | Yes | Yes (`rawMessage`) | Full sent + ACK with raw text |
| `/api/hl7/query` | `patientId` only | No (hardcoded) | No | Segment structure only (no field values) |
| `/api/hl7/adt-a08` | Yes (ID, name, DOB, sex, diagnosis) | No (hardcoded) | No | ACK code + text |

---

## Local Testing

```bash
# HAPI Test Panel (Java-based HL7 test server)
# Download from: https://hapifhir.github.io/hapi-hl7v2/hapi-testpanel/

# Or use a simple netcat-based MLLP listener:
# This receives an MLLP message and sends a hardcoded ACK
nc -l 2575 | xxd

# Docker-based HL7 test server (mirth connect)
docker run -d -p 2575:2575 nextgenhealthcare/connect

# Send a test message
curl -X POST http://localhost:8787/api/hl7/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"host.docker.internal","port":2575,"messageType":"ADT^A01"}'

# Update patient info
curl -X POST http://localhost:8787/api/hl7/adt-a08 \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "host.docker.internal",
    "port": 2575,
    "patientId": "PAT001",
    "lastName": "Doe",
    "firstName": "John",
    "dob": "19800101",
    "sex": "M",
    "diagnosis": "I10"
  }'
```
