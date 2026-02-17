# DICOM — Digital Imaging and Communications in Medicine

**Port:** 104 (standard), 11112 (alternative/testing)
**Transport:** TCP, binary (Upper Layer Protocol / ULP)
**Standard:** NEMA PS3 / ISO 12052
**Implementation:** `src/worker/dicom.ts`
**Routes:** `/api/dicom/connect`, `/api/dicom/echo`, `/api/dicom/find`

---

## Endpoints

### `POST /api/dicom/connect`

Performs an A-ASSOCIATE handshake **only** — does not send any DIMSE command. Tests whether the DICOM server accepts an association for the Verification SOP Class. On success, sends A-RELEASE-RQ before closing.

**Request**

```json
{
  "host":       "192.168.1.10",    // required
  "port":       104,               // default 104
  "callingAE":  "PORTOFCALL",      // default "PORTOFCALL"; 1-16 printable ASCII
  "calledAE":   "ANY-SCP",         // default "ANY-SCP"; 1-16 printable ASCII
  "timeout":    10000              // ms, default 10000
}
```

AE title validation: `^[\x20-\x7E]+$` — printable ASCII only, max 16 chars. Input is **auto-uppercased** before being written into the PDU (e.g., `portofcall` → `PORTOFCALL`).

**Wire exchange**

```
TCP connect
→ A-ASSOCIATE-RQ (Verification SOP Class 1.2.840.10008.1.1; Implicit VR LE + Explicit VR LE)
← A-ASSOCIATE-AC | A-ASSOCIATE-RJ | A-ABORT
→ A-RELEASE-RQ     (only on A-ASSOCIATE-AC)
← A-RELEASE-RP
```

**⚠ `success:true` on rejection** — Unlike `/echo`, both A-ASSOCIATE-AC and A-ASSOCIATE-RJ return HTTP 200 with `success:true`. Distinguish them via `associationAccepted`.

**Response — association accepted**

```json
{
  "success":              true,
  "host":                 "192.168.1.10",
  "port":                 104,
  "connectTime":          18,
  "rtt":                  42,
  "associationAccepted":  true,
  "calledAE":             "PACS",
  "callingAE":            "PORTOFCALL",
  "protocolVersion":      1,
  "maxPDULength":         65536,
  "implementationClassUID":  "1.2.276.0.7230010.3.0.3.6.4",
  "implementationVersion":   "OFFIS_DCMTK_364",
  "verificationAccepted": true,
  "acceptedContexts": [
    {
      "id":           1,
      "accepted":     true,
      "resultText":   "Acceptance",
      "transferSyntax": "1.2.840.10008.1.2"
    }
  ]
}
```

| Field | Notes |
|-------|-------|
| `connectTime` | ms from TCP connect to first write |
| `rtt` | ms from TCP connect to response received |
| `verificationAccepted` | `true` if at least one presentation context result === 0 |
| `acceptedContexts[].resultText` | "Acceptance" / "User rejection" / "No reason (provider rejection)" / "Abstract syntax not supported" / "Transfer syntaxes not supported" |
| `transferSyntax` | UID of the negotiated transfer syntax for that context |

**Response — association rejected**

```json
{
  "success":             true,
  "host":                "192.168.1.10",
  "port":                104,
  "connectTime":         8,
  "rtt":                 12,
  "associationAccepted": false,
  "rejectionResult":     "Permanent rejection",
  "rejectionSource":     "DICOM UL service-user",
  "rejectionReason":     "Called AE title not recognized"
}
```

**Response — A-ABORT received**

```json
{
  "success":             true,
  "associationAccepted": false,
  "aborted":             true,
  "abortSource":         "Service provider"
}
```

---

### `POST /api/dicom/echo`

Full C-ECHO cycle: A-ASSOCIATE → C-ECHO-RQ → C-ECHO-RSP → A-RELEASE. Returns `success:false` + HTTP 502 if association is rejected (unlike `/connect` which returns `success:true`).

**Request**

```json
{
  "host":      "192.168.1.10",
  "port":      104,
  "callingAE": "PORTOFCALL",
  "calledAE":  "ECHOSCP",
  "timeout":   15000            // default 15000 (different from /connect's 10000)
}
```

**Wire exchange**

```
→ A-ASSOCIATE-RQ (Verification SOP Class)
← A-ASSOCIATE-AC
→ P-DATA-TF (C-ECHO-RQ, messageId=1)
← P-DATA-TF (C-ECHO-RSP)
→ A-RELEASE-RQ
← A-RELEASE-RP  (errors here silently ignored)
```

The C-ECHO-RQ always uses messageId=1. There is no way to change it.

**C-ECHO DIMSE command set** (Implicit VR Little Endian):

| Tag | Name | Value |
|-----|------|-------|
| (0000,0000) | CommandGroupLength | computed |
| (0000,0002) | AffectedSOPClassUID | `1.2.840.10008.1.1` (Verification) |
| (0000,0100) | CommandField | 0x0030 (C-ECHO-RQ) |
| (0000,0110) | MessageID | 1 |
| (0000,0800) | CommandDataSetType | 0x0101 (no dataset) |

**Response**

```json
{
  "success":              true,
  "host":                 "192.168.1.10",
  "port":                 104,
  "callingAE":            "PORTOFCALL",
  "calledAE":             "ECHOSCP",
  "associateTime":        38,
  "echoTime":             12,
  "totalTime":            62,
  "echoSuccess":          true,
  "echoStatus":           0,
  "echoStatusText":       "Success",
  "implementationClassUID": "1.2.276.0.7230010.3.0.3.6.4",
  "implementationVersion":  "OFFIS_DCMTK_364",
  "maxPDULength":         65536,
  "transferSyntax":       "1.2.840.10008.1.2"
}
```

`echoSuccess` is `true` only when status `=== 0` (0x0000). Known status codes decoded by the implementation:

| Status | Text |
|--------|------|
| 0x0000 | Success |
| 0x0110 | Processing Failure |
| 0x0112 | SOP Class Not Supported |
| 0x0211 | Unrecognized Operation |
| other  | "Unknown" |

If the association is rejected, the response is `success:false` with HTTP 502:
```json
{
  "success": false,
  "error": "Association rejected: Called AE title not recognized (DICOM UL service-user)"
}
```

---

### `POST /api/dicom/find`

Study Root C-FIND query. Fetches a list of studies matching `patientId` and/or `studyDate`.

**Request**

```json
{
  "host":        "192.168.1.10",
  "port":        104,
  "callingAE":   "PORTOFCALL",
  "calledAE":    "QRSCP",
  "queryLevel":  "STUDY",           // default "STUDY"; "SERIES"/"IMAGE" may work server-side
  "patientId":   "12345",           // optional, empty string = wildcard
  "studyDate":   "20240101",        // optional, empty string = all dates; range: "20230101-20240101"
  "timeout":     20000              // default 20000 (different from /connect and /echo)
}
```

**⚠ PatientName and StudyInstanceUID are always wildcard** — The C-FIND dataset hardcodes empty strings for `(0010,0010) PatientName` and `(0020,000D) StudyInstanceUID`. There is no way to search by patient name or retrieve a specific study UID via this endpoint.

**⚠ Study Root only** — The association proposes Study Root Query/Retrieve C-FIND SOP Class (`1.2.840.10008.5.1.4.1.2.2.1`). Patient Root (`1.2.840.10008.5.1.4.1.2.1.1`) is not supported.

**Wire exchange**

```
→ A-ASSOCIATE-RQ (Study Root C-FIND SOP Class 1.2.840.10008.5.1.4.1.2.2.1)
← A-ASSOCIATE-AC
→ P-DATA-TF (C-FIND-RQ with command set + dataset)
← P-DATA-TF (C-FIND-RSP, status 0xFF00/0xFF01 = pending, repeat)
← P-DATA-TF (C-FIND-RSP, status 0x0000 = success, stop)
→ A-RELEASE-RQ
← A-RELEASE-RP
```

**C-FIND-RQ dataset fields sent:**

| Tag | Name | Value |
|-----|------|-------|
| (0008,0052) | QueryRetrieveLevel | `queryLevel` param |
| (0008,0020) | StudyDate | `studyDate` param (or empty) |
| (0010,0010) | PatientName | `""` (always wildcard) |
| (0010,0020) | PatientID | `patientId` param (or empty) |
| (0020,000D) | StudyInstanceUID | `""` (always wildcard) |

C-FIND-RSP pending codes: `0xFF00` (normal pending) and `0xFF01` (pending, optional keys not supported) — both collected as study results.

**⚠ Implicit VR LE decode only** — The dataset parser assumes Implicit VR Little Endian encoding. If the server negotiates Explicit VR, the parser will treat 2-byte VR codes as part of the value length and return garbage. Both transfer syntaxes are offered in the association; the accepted one determines the actual encoding.

**Response**

```json
{
  "success":    true,
  "host":       "192.168.1.10",
  "port":       104,
  "callingAE":  "PORTOFCALL",
  "calledAE":   "QRSCP",
  "queryLevel": "STUDY",
  "patientId":  "12345",
  "rtt":        1241,
  "studyCount": 2,
  "studies": [
    {
      "0010,0010": "Smith^John",
      "0010,0020": "12345",
      "0008,0020": "20240101",
      "0020,000d": "1.2.840.113619.2.55.3.604688119.2.20240101",
      "0008,0052": "STUDY"
    },
    {
      "0010,0010": "Smith^John",
      "0010,0020": "12345",
      "0008,0020": "20240115",
      "0020,000d": "1.2.840.113619.2.55.3.604688119.2.20240115"
    }
  ],
  "implementationClassUID": "1.2.276.0.7230010.3.0.3.6.4",
  "implementationVersion":  "OFFIS_DCMTK_364"
}
```

`studies` is an array of raw DICOM tag maps. Keys are lowercase hex tag strings like `"0010,0010"`. Values are UTF-8 strings decoded from the raw bytes; null-padded bytes are stripped. No friendly field name mapping is applied — callers must know the DICOM tag numbers. If the server returns Explicit VR, values will be garbled due to the Implicit VR parser assumption.

If association is rejected, returns `success:false` + HTTP 502. If `studyDate` or `patientId` are empty and there are no studies, `studies` is `[]`.

---

## Wire Protocol Reference

### PDU Header Format

All DICOM PDUs share a 6-byte header:

```
Offset  Size  Field
0       1     PDU Type
1       1     Reserved (0x00)
2       4     PDU Length (big-endian, excludes 6-byte header)
```

### PDU Types

| Code | Name |
|------|------|
| 0x01 | A-ASSOCIATE-RQ (request) |
| 0x02 | A-ASSOCIATE-AC (accept) |
| 0x03 | A-ASSOCIATE-RJ (reject) |
| 0x04 | P-DATA-TF (data transfer) |
| 0x05 | A-RELEASE-RQ |
| 0x06 | A-RELEASE-RP |
| 0x07 | A-ABORT |

### A-ASSOCIATE-RQ Fixed Fields (after 6-byte header)

```
Offset  Size  Field
0       2     Protocol Version (0x0001)
2       2     Reserved (0x0000)
4       16    Called AE Title (space-padded)
20      16    Calling AE Title (space-padded)
36      32    Reserved (zeros)
68+     var   Variable Items (Application Context, Presentation Contexts, User Info)
```

### Variable Item Types

| Code | Name |
|------|------|
| 0x10 | Application Context (`1.2.840.10008.3.1.1.1`) |
| 0x20 | Presentation Context (in RQ) |
| 0x21 | Presentation Context (in AC) |
| 0x30 | Abstract Syntax (sub-item) |
| 0x40 | Transfer Syntax (sub-item) |
| 0x50 | User Information |
| 0x51 | Maximum Length (sub-item) |
| 0x52 | Implementation Class UID (sub-item) |
| 0x55 | Implementation Version Name (sub-item) |

Implementation advertises:
- Max PDU length: **16,384 bytes** (0x4000). Responses larger than this will not arrive.
- Implementation Class UID: `1.2.826.0.1.3680043.8.498.1`
- Implementation Version: `PORTOFCALL_001`

### P-DATA-TF PDV Item

```
Offset  Size  Field
0       4     PDV Item Length (big-endian, excludes these 4 bytes)
4       1     Presentation Context ID (e.g., 0x01)
5       1     Control Header
               Bit 0: 1 = command, 0 = dataset
               Bit 1: 1 = last fragment
               0x01 = command, not last
               0x03 = command, last fragment ← used for C-ECHO-RQ
               0x02 = dataset, last fragment ← used for C-FIND dataset
6+      var   DIMSE command set or dataset
```

### A-ASSOCIATE-RJ Rejection Codes

**Result:**

| Code | Meaning |
|------|---------|
| 1 | Permanent rejection |
| 2 | Transient rejection |

**Source:**

| Code | Meaning |
|------|---------|
| 1 | DICOM UL service-user |
| 2 | DICOM UL service-provider (ACSE) |
| 3 | DICOM UL service-provider (Presentation) |

**Reason (service-user, source=1):**

| Code | Meaning |
|------|---------|
| 1 | No reason given |
| 2 | Application context name not supported |
| 3 | Calling AE title not recognized |
| 7 | Called AE title not recognized |

---

## Known Limitations

1. **Implicit VR LE parser only** — `/find` uses `parseDICOMDataset` which assumes Implicit VR LE. If the server negotiates Explicit VR LE (also proposed), the response datasets will be garbled. Workaround: some servers can be configured to prefer Implicit VR.

2. **PatientName and StudyInstanceUID always wildcard** — No way to search by patient name or retrieve by study UID. Only `patientId` and `studyDate` are user-configurable in the C-FIND dataset.

3. **Study Root C-FIND only** — `/find` only negotiates Study Root C-FIND SOP. Patient Root model is not available.

4. **queryLevel is not fully parameterized** — You can change `queryLevel` to SERIES or IMAGE, but the dataset tags are fixed (study-level attributes only). SERIES-level C-FIND typically needs `(0020,000D)` StudyInstanceUID set, which is always empty here.

5. **Max PDU size 16,384 bytes** — The User Information item advertises this as the maximum PDU the worker will accept. PACS systems with large C-FIND responses (many study attributes) may truncate or send an error. The implementation also rejects incoming PDUs larger than 1,048,576 bytes (`readPDU` check).

6. **`success:true` on rejection in `/connect`** — `/connect` returns `success:true` for both A-ASSOCIATE-AC and A-ASSOCIATE-RJ. Use `associationAccepted` to distinguish.

7. **Different default timeouts** — `/connect` default 10s, `/echo` default 15s, `/find` default 20s. All three use the field name `timeout` (milliseconds).

8. **No C-MOVE, C-GET, C-STORE** — Only C-ECHO (connectivity ping) and C-FIND (study query) are implemented. No image retrieval.

9. **No DICOM TLS (DICOMweb/TLS)** — Plaintext port 104 only.

10. **A-ABORT handling limited** — `/echo` and `/find` don't handle A-ABORT specially; the worker enters the error path. Only `/connect` returns a structured `aborted:true` response.

11. **C-ECHO messageId hardcoded** — Always sends messageId=1. Cannot be changed.

12. **No sequence/nested dataset support** — `parseDICOMDataset` stops parsing when it encounters a length of `0xFFFFFFFF` (undefined-length sequence marker). Studies with sequence attributes (e.g., Referenced Study Sequence) will be truncated.

13. **Studies returned as raw tag maps** — The `studies` array uses `"GGGG,EEEE"` lowercase hex keys. No VR-aware decoding: DA (date), TM (time), PN (person name), UI (UID) values are returned as raw trimmed strings.

---

## DICOM Tag Quick Reference

Common tags returned in C-FIND study responses:

| Tag | Name |
|-----|------|
| 0008,0020 | StudyDate |
| 0008,0030 | StudyTime |
| 0008,0050 | AccessionNumber |
| 0008,0052 | QueryRetrieveLevel |
| 0008,0060 | Modality |
| 0008,0090 | ReferringPhysicianName |
| 0008,1030 | StudyDescription |
| 0010,0010 | PatientName |
| 0010,0020 | PatientID |
| 0010,0030 | PatientBirthDate |
| 0010,0040 | PatientSex |
| 0020,000d | StudyInstanceUID |
| 0020,0010 | StudyID |
| 0020,1206 | NumberOfStudyRelatedSeries |
| 0020,1208 | NumberOfStudyRelatedInstances |

---

## Well-Known UIDs

| UID | Name |
|-----|------|
| `1.2.840.10008.1.1` | Verification SOP Class |
| `1.2.840.10008.1.2` | Implicit VR Little Endian (default) |
| `1.2.840.10008.1.2.1` | Explicit VR Little Endian |
| `1.2.840.10008.3.1.1.1` | DICOM Application Context |
| `1.2.840.10008.5.1.4.1.2.2.1` | Study Root C-FIND SOP Class |

---

## curl Examples

```bash
# Test DICOM server reachability (association only, no DIMSE)
curl -s -X POST https://portofcall.ross.gg/api/dicom/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","port":104,"calledAE":"PACS"}' | jq '{accepted:.associationAccepted,rtt:.rtt,impl:.implementationVersion}'

# Check if called AE is recognized
curl -s -X POST https://portofcall.ross.gg/api/dicom/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","calledAE":"WRONG_AE"}' | jq '{accepted:.associationAccepted,reason:.rejectionReason}'

# DICOM ping (C-ECHO)
curl -s -X POST https://portofcall.ross.gg/api/dicom/echo \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","port":104,"calledAE":"ECHOSCP"}' | jq '{echoSuccess:.echoSuccess,echoTime:.echoTime,status:.echoStatusText}'

# Query all studies (no filter)
curl -s -X POST https://portofcall.ross.gg/api/dicom/find \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","port":104,"calledAE":"QRSCP"}' | jq '.studyCount'

# Query by patient ID
curl -s -X POST https://portofcall.ross.gg/api/dicom/find \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","calledAE":"QRSCP","patientId":"12345"}' | jq '.studies[].["0010,0010"]'

# Query by date range (YYYYMMDD-YYYYMMDD)
curl -s -X POST https://portofcall.ross.gg/api/dicom/find \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","calledAE":"QRSCP","studyDate":"20240101-20241231"}' \
  | jq '[.studies[] | {"date":".["0008,0020"]","patient":".["0010,0010"]"}]'

# Extract study UIDs
curl -s -X POST https://portofcall.ross.gg/api/dicom/find \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.10","calledAE":"QRSCP","patientId":"12345"}' \
  | jq '[.studies[]["0020,000d"]]'
```

---

## Local Testing

```bash
# DCMTK C-ECHO server (accepts any AE)
storescp --fork --aetitle ECHOSCP 104

# DCMTK C-FIND/C-MOVE SCP (simple worklist)
wlmscpfs --aetitle QRSCP 104 /path/to/worklist/

# Orthanc (full PACS, REST + DICOM)
docker run -d -p 104:4242 -p 8042:8042 jodogne/orthanc
# Orthanc default AE: ORTHANC

# Test against Orthanc
curl -s -X POST https://portofcall.ross.gg/api/dicom/echo \
  -d '{"host":"YOUR_IP","port":104,"calledAE":"ORTHANC"}' | jq .echoSuccess

# DCM4CHEE (enterprise PACS)
docker run -d -p 104:11112 -p 8080:8080 dcm4che/dcm4chee-arc-psql
```

Dcm4che tools for validation:
```bash
# C-ECHO
echoscu -aet PORTOFCALL -aec PACS 192.168.1.10 104

# C-FIND studies
findscu -aet PORTOFCALL -aec QRSCP -S -k 0008,0052=STUDY \
        -k 0010,0020= -k 0010,0010= -k 0020,000d= \
        192.168.1.10 104
```
