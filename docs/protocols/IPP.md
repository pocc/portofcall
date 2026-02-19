# IPP (Internet Printing Protocol) -- Power User Reference

**Port:** 631/tcp (RFC 8011 Section 4.4.1) | any port works
**Source:** `src/worker/ipp.ts`
**Standards:** RFC 8010 (Encoding and Transport), RFC 8011 (Model and Semantics)

Two endpoints: one probes a printer's capabilities via Get-Printer-Attributes, the other submits a print job via Print-Job. Both wrap IPP binary payloads inside raw HTTP/1.1 POST requests sent over a TCP socket.

---

## Endpoints

### `POST /api/ipp/probe` -- Get-Printer-Attributes

Connects to an IPP server, sends a Get-Printer-Attributes request (operation 0x000B), and returns the parsed response including printer capabilities.

**Request (JSON body -- POST only):**

| Field | Default | Notes |
|---|---|---|
| `host` | -- | Required. Hostname or IP of the IPP server |
| `port` | `631` | Standard IPP port per RFC 8011 |
| `printerUri` | `ipp://{host}:{port}/ipp/print` | Full IPP URI; overrides auto-generated URI |
| `timeout` | `10000` | Wall-clock timeout in ms |

**Success (200):**

```json
{
  "success": true,
  "host": "192.168.1.50",
  "port": 631,
  "rawHttpStatus": "HTTP/1.1 200 OK",
  "rtt": 42,
  "version": "1.1",
  "statusCode": 0,
  "statusMessage": "successful-ok",
  "attributes": [
    { "name": "printer-name", "value": "HP_LaserJet" },
    { "name": "printer-state", "value": "3" },
    { "name": "document-format-supported", "value": ["application/pdf", "application/postscript", "text/plain"] },
    { "name": "printer-resolution-default", "value": "600x600dpi" }
  ]
}
```

**Failure (400 validation / 500 connection error):**

```json
{
  "success": false,
  "error": "Connection timeout",
  "host": "",
  "port": 0,
  "rtt": 0
}
```

**Key response fields:**

| Field | Notes |
|---|---|
| `version` | IPP version from response header (e.g. `"1.1"` or `"2.0"`) |
| `statusCode` | Numeric IPP status code; 0x0000 = success, 0x04xx = client error, 0x05xx = server error |
| `statusMessage` | Human-readable status from RFC 8011 (e.g. `"successful-ok"`) |
| `attributes` | Up to 50 parsed printer attributes; multi-valued attributes use arrays |
| `rawHttpStatus` | The raw HTTP status line (e.g. `"HTTP/1.1 200 OK"`) |
| `rtt` | Round-trip time in ms from connection start to response parsed |

---

### `POST /api/ipp/print` -- Print-Job

Submits a document to a printer using the Print-Job operation (0x0002).

**Request (JSON body -- POST only):**

| Field | Default | Notes |
|---|---|---|
| `host` | -- | Required |
| `port` | `631` | Standard IPP port |
| `printerUri` | `ipp://{host}:{port}/ipp/print` | Full IPP URI |
| `data` | -- | Required. Document content as a string |
| `mimeType` | `text/plain` | MIME type; also accepts `application/postscript`, `application/pdf`, `application/octet-stream` |
| `jobName` | `portofcall-job` | Human-readable job name sent in `job-name` attribute |
| `timeout` | `30000` | Wall-clock timeout in ms (longer default for print jobs) |

**Success (200):**

```json
{
  "success": true,
  "host": "192.168.1.50",
  "port": 631,
  "printerUri": "ipp://192.168.1.50:631/ipp/print",
  "jobName": "portofcall-job",
  "mimeType": "text/plain",
  "bytesSent": 45,
  "rtt": 128,
  "jobId": 42,
  "statusCode": 0,
  "statusMessage": "successful-ok",
  "rawHttpStatus": "HTTP/1.1 200 OK"
}
```

**Key response fields:**

| Field | Notes |
|---|---|
| `jobId` | Server-assigned job ID from `job-id` attribute; `undefined` if the server did not return one |
| `bytesSent` | Character length of the input `data` string |
| `success` | `true` if IPP status < 0x0400; falls back to checking HTTP 200 if IPP parsing fails |

---

## Wire Exchange

### HTTP Transport Layer

IPP uses HTTP as its transport (RFC 8010 Section 4). Every IPP operation is an HTTP POST with `Content-Type: application/ipp`. The HTTP resource path is derived from the printer URI.

```
-> POST /ipp/print HTTP/1.1
   Host: printer.local:631
   Content-Type: application/ipp
   Content-Length: {n}
   Connection: close

   [IPP binary payload]

<- HTTP/1.1 200 OK
   Content-Type: application/ipp
   Content-Length: {m}

   [IPP binary response]
```

IPP always uses HTTP POST, never GET. The HTTP status should be 200 even for IPP-level errors -- the actual success/failure is encoded in the IPP status-code within the binary response body. Non-200 HTTP status codes indicate transport-level failures.

### IPP Binary Encoding (RFC 8010 Section 3.1)

Every IPP request and response follows the same binary structure:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| major-version | minor-version |       operation-id (req)      |
|               |               |    or status-code (resp)      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          request-id                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  begin-       |  value-tag    |       name-length             |
|  attribute-   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  group-tag    |  name (name-length bytes)                     |
|               +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|               |       value-length            |               |
|               +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+ value         |
|               |  (value-length bytes)                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  ... more attributes ...                                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  end-of-      |
|  attributes   |
|  tag (0x03)   |
+-+-+-+-+-+-+-+-+
|  [document data for Print-Job, if any]                        |
+---------------------------------------------------------------+
```

All multi-byte integers are big-endian (network byte order).

**Header (8 bytes fixed):**
- Bytes 0-1: Version (0x01 0x01 for IPP/1.1, 0x02 0x00 for IPP/2.0)
- Bytes 2-3: Operation-id (request) or status-code (response)
- Bytes 4-7: Request-id (MUST be non-zero, echoed in response)

**Attribute groups follow the header. Each group starts with a delimiter tag:**

| Tag | Hex | Name |
|---|---|---|
| operation-attributes-tag | `0x01` | Operation attributes group |
| job-attributes-tag | `0x02` | Job attributes group |
| end-of-attributes-tag | `0x03` | Terminates all attribute groups |
| printer-attributes-tag | `0x04` | Printer attributes group |
| unsupported-attributes-tag | `0x05` | Unsupported attributes group |

**Each attribute within a group is encoded as:**
1. value-tag (1 byte) -- identifies the attribute syntax
2. name-length (2 bytes, big-endian)
3. name (name-length bytes, UTF-8)
4. value-length (2 bytes, big-endian)
5. value (value-length bytes, encoding depends on value-tag)

**Multi-valued attributes** (RFC 8010 Section 3.1.3): Additional values for the same attribute use name-length = 0 and an empty name. The value-tag and value follow normally. The implementation collects these into arrays.

---

## Value Tags (RFC 8010 Section 3.5.2)

### Delimiter Tags (0x00-0x0F)

| Hex | Name | Purpose |
|---|---|---|
| `0x01` | operation-attributes-tag | Start of operation attributes |
| `0x02` | job-attributes-tag | Start of job attributes |
| `0x03` | end-of-attributes-tag | End of all attribute groups |
| `0x04` | printer-attributes-tag | Start of printer attributes |
| `0x05` | unsupported-attributes-tag | Start of unsupported attributes |

### Out-of-Band Tags (0x10-0x1F)

| Hex | Name | Value encoding |
|---|---|---|
| `0x10` | unsupported | No value data (value-length = 0) |
| `0x12` | unknown | No value data |
| `0x13` | no-value | No value data |

### Integer Tags (0x20-0x2F)

| Hex | Name | Value encoding |
|---|---|---|
| `0x21` | integer | 4 bytes, signed big-endian |
| `0x22` | boolean | 1 byte (0x00=false, 0x01=true) |
| `0x23` | enum | 4 bytes, unsigned big-endian |

### Octet-String Tags (0x30-0x3F)

| Hex | Name | Value encoding |
|---|---|---|
| `0x30` | octetString | Raw bytes |
| `0x31` | dateTime | 11 bytes (RFC 2579 DateAndTime) |
| `0x32` | resolution | 9 bytes (4-byte cross-feed + 4-byte feed + 1-byte units) |
| `0x33` | rangeOfInteger | 8 bytes (4-byte lower + 4-byte upper) |
| `0x34` | begCollection | Begin collection (RFC 3382) |
| `0x35` | textWithLanguage | 2-byte lang-length + lang + 2-byte text-length + text |
| `0x36` | nameWithLanguage | Same structure as textWithLanguage |
| `0x37` | endCollection | End collection |

### Character-String Tags (0x40-0x4F)

| Hex | Name | Value encoding |
|---|---|---|
| `0x41` | textWithoutLanguage | UTF-8 text |
| `0x42` | nameWithoutLanguage | UTF-8 text |
| `0x44` | keyword | US-ASCII keyword (e.g. `"one-sided"`) |
| `0x45` | uri | US-ASCII URI |
| `0x46` | uriScheme | US-ASCII (e.g. `"ipp"`) |
| `0x47` | charset | US-ASCII charset name (e.g. `"utf-8"`) |
| `0x48` | naturalLanguage | US-ASCII language tag (e.g. `"en"`) |
| `0x49` | mimeMediaType | US-ASCII MIME type (e.g. `"application/pdf"`) |
| `0x4A` | memberAttrName | US-ASCII attribute name within a collection |

---

## Operation IDs (RFC 8011 Section 4.2)

| Hex | Name | Description |
|---|---|---|
| `0x0002` | Print-Job | Submit a document with job attributes |
| `0x0003` | Print-URI | Print a document identified by URI |
| `0x0004` | Validate-Job | Validate job attributes without printing |
| `0x0005` | Create-Job | Create a job object without document data |
| `0x0006` | Send-Document | Send document data for a created job |
| `0x0007` | Send-URI | Associate a document URI with a created job |
| `0x0008` | Cancel-Job | Cancel a pending or processing job |
| `0x0009` | Get-Job-Attributes | Get attributes of a specific job |
| `0x000A` | Get-Jobs | Get list of jobs on a printer |
| `0x000B` | Get-Printer-Attributes | Get printer capabilities and status |

This implementation supports `0x000B` (probe) and `0x0002` (print).

---

## Status Codes (RFC 8011 Section 4.1)

### Successful (0x0000-0x00FF)

| Hex | Name |
|---|---|
| `0x0000` | successful-ok |
| `0x0001` | successful-ok-ignored-or-substituted-attributes |
| `0x0002` | successful-ok-conflicting-attributes |

### Client Error (0x0400-0x04FF)

| Hex | Name |
|---|---|
| `0x0400` | client-error-bad-request |
| `0x0401` | client-error-forbidden |
| `0x0402` | client-error-not-authenticated |
| `0x0403` | client-error-not-authorized |
| `0x0404` | client-error-not-possible |
| `0x0405` | client-error-timeout |
| `0x0406` | client-error-not-found |
| `0x0407` | client-error-gone |
| `0x0408` | client-error-request-entity-too-large |
| `0x0409` | client-error-request-value-too-long |
| `0x040A` | client-error-document-format-not-supported |
| `0x040B` | client-error-attributes-or-values-not-supported |
| `0x040C` | client-error-uri-scheme-not-supported |
| `0x040D` | client-error-charset-not-supported |
| `0x040E` | client-error-conflicting-attributes |
| `0x040F` | client-error-compression-not-supported |
| `0x0410` | client-error-compression-error |
| `0x0411` | client-error-document-format-error |
| `0x0412` | client-error-document-access-error |

### Server Error (0x0500-0x05FF)

| Hex | Name |
|---|---|
| `0x0500` | server-error-internal-error |
| `0x0501` | server-error-operation-not-supported |
| `0x0502` | server-error-service-unavailable |
| `0x0503` | server-error-version-not-supported |
| `0x0504` | server-error-device-error |
| `0x0505` | server-error-temporary-error |
| `0x0506` | server-error-not-accepting-jobs |
| `0x0507` | server-error-busy |
| `0x0508` | server-error-job-canceled |
| `0x0509` | server-error-multiple-document-jobs-not-supported |

---

## Mandatory Request Attributes

Per RFC 8011, every IPP request MUST include these operation attributes in this order:

1. **`attributes-charset`** (tag 0x47, charset) -- MUST be first. Value: `"utf-8"`
2. **`attributes-natural-language`** (tag 0x48, naturalLanguage) -- MUST be second. Value: `"en"`
3. **`printer-uri`** (tag 0x45, uri) -- Target printer URI
4. **`requesting-user-name`** (tag 0x42, nameWithoutLanguage) -- SHOULD be included

### Additional for Print-Job:

5. **`job-name`** (tag 0x42, nameWithoutLanguage) -- Human-readable job name
6. **`document-format`** (tag 0x49, mimeMediaType) -- MIME type of the document data

---

## Parsed Value Formats

The response parser decodes values based on their tag type:

| Value type | Parsed format | Example |
|---|---|---|
| integer (0x21) | Signed decimal string | `"-1"`, `"42"` |
| boolean (0x22) | `"true"` or `"false"` | `"true"` |
| enum (0x23) | Unsigned decimal string | `"3"` (idle), `"4"` (processing) |
| dateTime (0x31) | ISO 8601-ish string | `"2025-03-15T14:30:00+00:00"` |
| resolution (0x32) | `{cross}x{feed}{unit}` | `"600x600dpi"`, `"300x300dpcm"` |
| rangeOfInteger (0x33) | `{lower}-{upper}` | `"1-999"` |
| Character strings (0x41-0x4A) | UTF-8 decoded text | `"HP LaserJet"` |
| Out-of-band (0x10-0x13) | Tag name | `"unsupported"`, `"no-value"` |
| Unknown tags | Space-separated hex bytes | `"de ad be ef"` |

### Multi-valued attributes

When a printer returns multiple values for the same attribute (e.g. `document-format-supported`), the `value` field becomes an array of strings:

```json
{ "name": "document-format-supported", "value": ["application/pdf", "image/jpeg", "text/plain"] }
```

Single-valued attributes remain plain strings.

---

## Implementation Notes

### HTTP path derived from printer URI

The HTTP POST path is extracted from the `printerUri` field. For example:
- `ipp://host:631/ipp/print` posts to `/ipp/print`
- `ipp://host/printers/laserjet` posts to `/printers/laserjet`
- If the URI cannot be parsed, falls back to `/ipp/print`

This matches RFC 8011 Section 4.4.1 which states that the HTTP request-target MUST be the same as the path component of the printer-uri.

### Body extraction uses byte-level boundary detection

The HTTP response is binary (IPP data is not valid UTF-8). The implementation finds the `\r\n\r\n` header/body separator by scanning raw bytes rather than decoding to text, avoiding data corruption from UTF-8 replacement characters in binary IPP data. HTTP headers are decoded as ASCII only after being separated from the body.

### Shared timeout

The same timeout promise races against `socket.opened` and every `reader.read()`. If the connection takes most of the timeout budget, the read phase gets whatever remains.

### Response size cap

The read loop stops at 64 KB total response size. This is sufficient for Get-Printer-Attributes responses (typically 2-15 KB) but may truncate responses from printers that return very large attribute sets.

### Attribute limit

The probe endpoint returns at most 50 attributes to keep JSON response sizes manageable. Attributes beyond the 50th are silently dropped.

### Enum values as unsigned integers

IPP enum values (tag 0x23) are always non-negative. The parser uses `>>> 0` to force unsigned interpretation, preventing JavaScript's signed 32-bit shift from producing negative numbers for enum values with bit 31 set.

### Print-Job document encoding

The `data` field is a JavaScript string that gets UTF-8 encoded via `TextEncoder`. For binary document formats (PDF, PostScript), the caller should base64-encode the data and set `mimeType` accordingly. The implementation does not perform base64 decoding -- the raw UTF-8 bytes of the base64 string are sent as the document body.

### IPP over HTTPS (IPPS)

IPP over TLS (IPPS, port 443 or 631 with STARTTLS) is not supported. The implementation uses raw TCP sockets via `cloudflare:sockets`. IPPS URIs (`ipps://`) will have their path extracted correctly but the connection will be unencrypted TCP.

---

## Common Printer Attributes

These are commonly returned by Get-Printer-Attributes:

| Attribute | Tag | Typical values |
|---|---|---|
| `printer-name` | keyword | `"HP_LaserJet_Pro"` |
| `printer-state` | enum | `3` (idle), `4` (processing), `5` (stopped) |
| `printer-state-reasons` | keyword | `"none"`, `"toner-low"`, `"media-empty"` |
| `printer-is-accepting-jobs` | boolean | `"true"` / `"false"` |
| `printer-make-and-model` | text | `"HP LaserJet Pro MFP M428fdw"` |
| `printer-info` | text | Human-readable description |
| `printer-location` | text | Physical location |
| `printer-uri-supported` | uri | `"ipp://host:631/ipp/print"` |
| `document-format-supported` | keyword[] | `["application/pdf","text/plain",...]` |
| `media-supported` | keyword[] | `["iso_a4_210x297mm","na_letter_8.5x11in"]` |
| `sides-supported` | keyword[] | `["one-sided","two-sided-long-edge"]` |
| `color-supported` | boolean | `"true"` / `"false"` |
| `printer-resolution-supported` | resolution[] | `["300x300dpi","600x600dpi"]` |
| `copies-supported` | rangeOfInteger | `"1-999"` |
| `pages-per-minute` | integer | `"30"` |
| `printer-up-time` | integer | Seconds since printer boot |

### Printer State Enum Values

| Value | Meaning |
|---|---|
| 3 | idle -- ready to print |
| 4 | processing -- currently printing |
| 5 | stopped -- paused or error state |

---

## curl Examples

```bash
# Probe a printer for capabilities
curl -s -X POST https://portofcall.ross.gg/api/ipp/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.50"}' | jq .

# Probe with custom printer URI
curl -s -X POST https://portofcall.ross.gg/api/ipp/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.50","printerUri":"ipp://192.168.1.50/printers/laserjet"}' | jq .

# Just printer name and state
curl -s -X POST https://portofcall.ross.gg/api/ipp/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.50"}' \
  | jq '[.attributes[] | select(.name | test("printer-name|printer-state$"))]'

# Print a text document
curl -s -X POST https://portofcall.ross.gg/api/ipp/print \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"192.168.1.50",
    "data":"Hello from Port of Call!\n",
    "jobName":"test-page",
    "mimeType":"text/plain"
  }' | jq .

# Print to a non-standard port
curl -s -X POST https://portofcall.ross.gg/api/ipp/print \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"192.168.1.50",
    "port":9100,
    "data":"Test page\n"
  }' | jq .

# Check if probe succeeded
curl -s -X POST https://portofcall.ross.gg/api/ipp/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.50"}' \
  | jq '{success, statusMessage, version, rtt}'
```

---

## Direct Testing (without Port of Call)

```bash
# Discover CUPS printers on localhost
lpstat -p -d

# Get printer attributes using ipptool (comes with CUPS)
ipptool -tv ipp://localhost:631/ipp/print get-printer-attributes.test

# Raw IPP probe with ipptool
ipptool -tv ipp://192.168.1.50:631/ipp/print \
  -d 'NAME=Get-Printer-Attributes' \
  << 'EOF'
{
  OPERATION Get-Printer-Attributes
  GROUP operation-attributes-tag
  ATTR charset attributes-charset utf-8
  ATTR naturalLanguage attributes-natural-language en
  ATTR uri printer-uri $uri
  STATUS successful-ok
}
EOF

# Print a test page via CUPS command line
echo "Hello World" | lp -d printer_name -

# Print via HTTP POST with curl (bypass Port of Call, talk directly to printer)
# Build IPP binary manually with Python, then POST:
python3 -c "
import struct, sys
# IPP/1.1 Get-Printer-Attributes
buf = struct.pack('>bbhI', 1, 1, 0x000b, 1)  # version, op, request-id
buf += bytes([0x01])  # operation-attributes-tag
# attributes-charset
buf += bytes([0x47])  # charset tag
name = b'attributes-charset'
buf += struct.pack('>H', len(name)) + name
val = b'utf-8'
buf += struct.pack('>H', len(val)) + val
# attributes-natural-language
buf += bytes([0x48])
name = b'attributes-natural-language'
buf += struct.pack('>H', len(name)) + name
val = b'en'
buf += struct.pack('>H', len(val)) + val
# printer-uri
buf += bytes([0x45])
name = b'printer-uri'
buf += struct.pack('>H', len(name)) + name
val = b'ipp://localhost:631/ipp/print'
buf += struct.pack('>H', len(val)) + val
# end-of-attributes
buf += bytes([0x03])
sys.stdout.buffer.write(buf)
" | curl -s -X POST http://localhost:631/ipp/print \
  -H 'Content-Type: application/ipp' \
  --data-binary @- \
  -o /dev/null -w '%{http_code}\n'
```

---

## Local Test Server

```bash
# Start a CUPS server (macOS -- already running by default)
# Enable sharing:
cupsctl --share-printers

# Check if CUPS is listening on 631
lsof -i :631

# Add a virtual PDF printer for testing (macOS)
lpadmin -p test-pdf -E -v cups-pdf:/ -m everywhere

# Linux: install and start CUPS
sudo apt install cups
sudo systemctl start cups
# CUPS listens on localhost:631 by default
```

---

## Security

### No Authentication

This implementation uses unauthenticated IPP requests. CUPS and most network printers accept unauthenticated Get-Printer-Attributes requests by default, but Print-Job may require authentication depending on the printer's access policy.

### No Encryption

IPP traffic is sent over plain TCP. For production use, IPP over TLS (IPPS, RFC 7472) should be used. This implementation does not support TLS.

### Printer URI Injection

The `printerUri` field is used both in the IPP payload and to derive the HTTP request path. The implementation uses `new URL()` to parse the URI, which provides basic validation. However, callers should validate printer URIs before passing them to the API.

### Network Access

Port 631 is typically only accessible on local networks. Most firewalls block external access to IPP. Probing across the internet will usually time out.

---

## Comparison with Related Protocols

| Protocol | Port | Transport | Purpose |
|---|---|---|---|
| **IPP** | **631** | **HTTP (TCP)** | **Full print job management** |
| LPD/LPR | 515 | TCP | Legacy line printer daemon |
| JetDirect (RAW) | 9100 | TCP | Raw data to printer (no protocol) |
| IPPS | 443/631 | HTTPS (TLS) | IPP with encryption |
| WSD | 3702 | HTTP/SOAP | Windows printer discovery |
| mDNS/DNS-SD | 5353 | UDP | Printer discovery (Bonjour) |

IPP is the modern standard -- CUPS on macOS/Linux uses it exclusively, and Windows 10+ supports it natively. LPD and JetDirect are legacy protocols that lack job management capabilities.

---

## Common Printer URIs

| Printer Type | Typical URI Pattern |
|---|---|
| CUPS default | `ipp://host:631/ipp/print` |
| CUPS named printer | `ipp://host:631/printers/{name}` |
| CUPS class | `ipp://host:631/classes/{name}` |
| HP printers | `ipp://host:631/ipp/print` |
| Brother printers | `ipp://host:631/ipp/print` |
| Epson printers | `ipp://host:631/ipp/print` |
| Kyocera printers | `ipp://host:631/ipp/print` |

The path `/ipp/print` is the most common default. Some enterprise printers use custom paths like `/ipp/printer` or `/printers/default`.

---

## Known Limitations

- **No IPPS (TLS)** -- only plain TCP connections; no support for `ipps://` URIs
- **No chunked transfer encoding** -- the read loop expects Content-Length or falls back to heuristic chunk counting
- **64 KB response cap** -- very large attribute sets may be truncated
- **50 attribute limit** -- the probe endpoint caps returned attributes at 50
- **String-only document data** -- binary documents (PDF) must be string-encoded by the caller
- **No Get-Jobs support** -- only Get-Printer-Attributes and Print-Job are implemented
- **No Cancel-Job support** -- jobs cannot be cancelled through this API
- **No subscription/notification** -- IPP event notifications (RFC 3995) are not supported
- **No IPP Everywhere** -- advanced features like `identify-actions` are not implemented
- **Collections not fully parsed** -- `begCollection`/`endCollection` tags are recognized but collection contents are flattened into the attribute list
