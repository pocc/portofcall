# SOAP Protocol Implementation

## Overview

SOAP (Simple Object Access Protocol) is a protocol for exchanging structured XML-based messages in web services. This implementation supports both SOAP 1.1 and SOAP 1.2 over HTTP, sending requests via raw TCP sockets using the Cloudflare Sockets API.

## Supported Operations

### 1. SOAP Call (`POST /api/tools/soap`)

Send a SOAP envelope to a service endpoint and receive a parsed response.

### 2. WSDL Discovery (`POST /api/tools/soap/wsdl`)

Retrieve the Web Services Description Language (WSDL) document from a service endpoint to discover available operations.

## SOAP Call Request

```json
{
  "host": "example.com",
  "port": 80,
  "path": "/services/calculator",
  "soapAction": "http://example.com/calculator/Add",
  "soapVersion": "1.1",
  "body": "<?xml version=\"1.0\"?>...",
  "timeout": 15000
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `host` | string | Yes | - | Target server hostname or IP address |
| `port` | number | No | 80 | TCP port for HTTP connection |
| `path` | string | No | `/` | HTTP path for the SOAP endpoint |
| `soapAction` | string | No | - | SOAP action URI (SOAP 1.1: header, SOAP 1.2: Content-Type param) |
| `soapVersion` | string | No | auto | SOAP version: `"1.1"` or `"1.2"` (auto-detected from envelope if omitted) |
| `body` | string | Yes | - | Complete SOAP XML envelope |
| `timeout` | number | No | 15000 | Connection and read timeout in milliseconds |

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "headers": {
    "content-type": "text/xml; charset=utf-8",
    "content-length": "512"
  },
  "body": "<?xml version=\"1.0\"?>...",
  "parsed": {
    "isSoap": true,
    "hasFault": false,
    "soapVersion": "1.1",
    "faultCode": null,
    "faultString": null
  },
  "latencyMs": 234
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | `true` if HTTP status is 2xx or 3xx |
| `statusCode` | number | HTTP response status code |
| `headers` | object | HTTP response headers (lowercase keys) |
| `body` | string | Raw XML response body |
| `parsed.isSoap` | boolean | `true` if response contains SOAP envelope namespace |
| `parsed.hasFault` | boolean | `true` if response contains SOAP fault |
| `parsed.soapVersion` | string | Detected SOAP version: `"1.1"`, `"1.2"`, or `"unknown"` |
| `parsed.faultCode` | string | SOAP fault code (if present) |
| `parsed.faultString` | string | SOAP fault description (if present) |
| `latencyMs` | number | Round-trip time in milliseconds |

## WSDL Discovery Request

```json
{
  "host": "example.com",
  "port": 80,
  "path": "/services/calculator",
  "timeout": 15000
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `host` | string | Yes | - | Target server hostname or IP address |
| `port` | number | No | 80 | TCP port for HTTP connection |
| `path` | string | No | `/` | HTTP path (automatically appends `?wsdl` if not present) |
| `timeout` | number | No | 15000 | Connection and read timeout in milliseconds |

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "isWsdl": true,
  "serviceName": "CalculatorService",
  "operations": ["Add", "Subtract", "Multiply", "Divide"],
  "body": "<?xml version=\"1.0\"?>...",
  "latencyMs": 156
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | `true` if HTTP status is 2xx or 3xx |
| `statusCode` | number | HTTP response status code |
| `isWsdl` | boolean | `true` if response contains WSDL namespace or `<definitions>` |
| `serviceName` | string | Extracted service name from WSDL (if found) |
| `operations` | array | List of operation names defined in WSDL |
| `body` | string | Complete WSDL XML document |
| `latencyMs` | number | Round-trip time in milliseconds |

## SOAP 1.1 vs 1.2 Differences

### HTTP Headers

**SOAP 1.1** (W3C Note 2000):
- Content-Type: `text/xml; charset=utf-8`
- SOAPAction header: `SOAPAction: "http://example.com/Action"`
- Envelope namespace: `http://schemas.xmlsoap.org/soap/envelope/`

**SOAP 1.2** (W3C Recommendation 2007, RFC 3902):
- Content-Type: `application/soap+xml; charset=utf-8; action="http://example.com/Action"`
- No SOAPAction header (action moved to Content-Type parameter)
- Envelope namespace: `http://www.w3.org/2003/05/soap-envelope`

### Fault Structure

**SOAP 1.1 Fault:**
```xml
<soap:Fault>
  <faultcode>soap:Client</faultcode>
  <faultstring>Invalid request</faultstring>
  <faultactor>http://example.com/service</faultactor>
  <detail>...</detail>
</soap:Fault>
```

**SOAP 1.2 Fault:**
```xml
<soap:Fault>
  <soap:Code>
    <soap:Value>soap:Sender</soap:Value>
  </soap:Code>
  <soap:Reason>
    <soap:Text xml:lang="en">Invalid request</soap:Text>
  </soap:Reason>
  <soap:Detail>...</soap:Detail>
</soap:Fault>
```

## Example SOAP 1.1 Envelope

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Header>
    <Authentication>
      <Username>user</Username>
      <Password>pass</Password>
    </Authentication>
  </soap:Header>
  <soap:Body>
    <Add xmlns="http://example.com/calculator">
      <a>5</a>
      <b>3</b>
    </Add>
  </soap:Body>
</soap:Envelope>
```

## Example SOAP 1.2 Envelope

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope
  xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Header>
    <Authentication>
      <Username>user</Username>
      <Password>pass</Password>
    </Authentication>
  </soap:Header>
  <soap:Body>
    <Add xmlns="http://example.com/calculator">
      <a>5</a>
      <b>3</b>
    </Add>
  </soap:Body>
</soap:Envelope>
```

## Common Use Cases

### 1. Calling a SOAP Web Service

```bash
curl -X POST https://portofcall.example.com/api/tools/soap \
  -H "Content-Type: application/json" \
  -d '{
    "host": "webservices.example.com",
    "port": 80,
    "path": "/calculator.asmx",
    "soapAction": "http://tempuri.org/Add",
    "soapVersion": "1.1",
    "body": "<?xml version=\"1.0\"?><soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body><Add xmlns=\"http://tempuri.org/\"><a>10</a><b>20</b></Add></soap:Body></soap:Envelope>"
  }'
```

### 2. Discovering Available Operations

```bash
curl -X POST https://portofcall.example.com/api/tools/soap/wsdl \
  -H "Content-Type: application/json" \
  -d '{
    "host": "webservices.example.com",
    "port": 80,
    "path": "/calculator.asmx"
  }'
```

### 3. Testing Enterprise SOAP Endpoints

```bash
# Bank transaction service
curl -X POST https://portofcall.example.com/api/tools/soap \
  -H "Content-Type: application/json" \
  -d '{
    "host": "banking.example.com",
    "port": 8080,
    "path": "/services/transaction",
    "soapAction": "http://banking.example.com/GetBalance",
    "body": "<?xml version=\"1.0\"?><soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Header><Security><Token>abc123</Token></Security></soap:Header><soap:Body><GetBalance><AccountNumber>123456</AccountNumber></GetBalance></soap:Body></soap:Envelope>"
  }'
```

### 4. Healthcare HL7/SOAP Integration

```bash
curl -X POST https://portofcall.example.com/api/tools/soap \
  -H "Content-Type: application/json" \
  -d '{
    "host": "health.example.com",
    "port": 443,
    "path": "/PatientService",
    "soapAction": "http://health.example.com/GetPatientRecord",
    "soapVersion": "1.2",
    "body": "<?xml version=\"1.0\"?><soap:Envelope xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\"><soap:Body><GetPatientRecord><PatientID>P12345</PatientID></GetPatientRecord></soap:Body></soap:Envelope>"
  }'
```

## Error Handling

### HTTP-Level Errors

```json
{
  "success": false,
  "error": "Connection timeout"
}
```

### SOAP Faults

When the server returns a SOAP fault, the response includes:

```json
{
  "success": true,
  "statusCode": 500,
  "body": "<?xml version=\"1.0\"?>...",
  "parsed": {
    "isSoap": true,
    "hasFault": true,
    "soapVersion": "1.1",
    "faultCode": "soap:Client",
    "faultString": "Invalid XML in request"
  }
}
```

## Protocol Implementation Details

### HTTP Request Construction

1. **Version Detection**: Auto-detects SOAP version from envelope namespace
2. **Content-Type**: Uses `text/xml` for SOAP 1.1, `application/soap+xml` for SOAP 1.2
3. **SOAPAction**: Sends as HTTP header for SOAP 1.1, Content-Type parameter for SOAP 1.2
4. **Connection**: Uses `Connection: close` to avoid connection pooling issues
5. **Content-Length**: Calculated from UTF-8 byte length, not character count

### Response Parsing

1. **HTTP Headers**: Parsed into lowercase-keyed dictionary
2. **Chunked Transfer Encoding**: Automatically decoded per RFC 9112 §7.1.1
3. **Chunk Extensions**: Stripped from chunk size lines (e.g., `1a;name=value` → `1a`)
4. **SOAP Version**: Detected from envelope namespace URI
5. **Fault Detection**: Searches for `<soap:Fault>`, `<SOAP-ENV:Fault>`, or `<soapenv:Fault>`

### Size Limits

- Maximum response size: 512,000 bytes (500 KB)
- Responses exceeding this limit are truncated

### Timeouts

- Default: 15 seconds
- Applied to both connection establishment and response reading
- Configurable via `timeout` parameter

## Security Considerations

### Authentication

SOAP services may require authentication via:

1. **HTTP Basic Auth**: Add `Authorization` header to request
2. **SOAP Headers**: Include `<Security>` or `<Authentication>` in envelope
3. **WS-Security**: Add `<wsse:Security>` header with username token or X.509 certificate

### Transport Security

- **HTTPS**: Not directly supported (raw sockets don't support TLS)
- **Alternative**: Use port 443 with TLS-capable SOAP libraries or proxies
- **Recommendation**: Only use this tool for testing HTTP endpoints or internal services

### XML Injection

- Input is not sanitized or validated
- Ensure SOAP body is properly escaped if constructing from user input
- Use XML libraries for envelope construction in production

## Troubleshooting

### Connection Timeout

**Symptom**: `"error": "Connection timeout"`

**Causes**:
- Firewall blocking outbound connections
- Incorrect host/port
- Server not responding

**Solution**: Verify endpoint is accessible, increase timeout

### Invalid HTTP Response

**Symptom**: `"error": "Invalid HTTP response: no header terminator found"`

**Causes**:
- Server returned non-HTTP response
- Server closed connection immediately
- Not an HTTP-based SOAP service

**Solution**: Verify endpoint serves HTTP, check server logs

### SOAP Fault Returned

**Symptom**: `"hasFault": true` in parsed response

**Causes**:
- Malformed SOAP envelope
- Missing required parameters
- Authentication failure
- Business logic error

**Solution**: Check `faultCode` and `faultString` for details, review WSDL

### Empty Operations List

**Symptom**: `"operations": []` in WSDL response

**Causes**:
- Not a valid WSDL document
- Operations defined without `name` attribute
- Non-standard WSDL format

**Solution**: Review raw WSDL body, check for `<operation>` elements manually

## Technical Specifications

### Standards Compliance

- **SOAP 1.1**: W3C Note 8 May 2000
- **SOAP 1.2**: W3C Recommendation 27 April 2007
- **RFC 3902**: The "application/soap+xml" media type
- **RFC 9112**: HTTP/1.1 (chunked transfer encoding)

### Supported Features

- [x] SOAP 1.1 envelope format
- [x] SOAP 1.2 envelope format
- [x] SOAPAction header (SOAP 1.1)
- [x] action parameter in Content-Type (SOAP 1.2)
- [x] Automatic version detection
- [x] SOAP fault parsing
- [x] WSDL discovery
- [x] Chunked transfer encoding
- [x] Custom timeouts
- [x] HTTP header parsing

### Unsupported Features

- [ ] HTTPS/TLS (use HTTP proxy or port forwarding)
- [ ] MTOM (Message Transmission Optimization Mechanism)
- [ ] WS-Security (must be embedded in envelope by caller)
- [ ] WS-Addressing (must be embedded in envelope by caller)
- [ ] SOAP 1.1 with Attachments
- [ ] HTTP Keep-Alive / connection pooling
- [ ] HTTP/2 or HTTP/3

## References

- [W3C SOAP 1.1 Specification](https://www.w3.org/TR/2000/NOTE-SOAP-20000508/)
- [W3C SOAP 1.2 Specification](https://www.w3.org/TR/soap12/)
- [RFC 3902: application/soap+xml Media Type](https://www.ietf.org/rfc/rfc3902.txt)
- [RFC 9112: HTTP/1.1 Specification](https://www.rfc-editor.org/rfc/rfc9112.html)

## Changelog

### 2026-02-18 - Protocol Correctness Fixes
- **Fixed**: SOAP 1.2 now uses `application/soap+xml` instead of `text/xml`
- **Fixed**: SOAP 1.2 SOAPAction moved to Content-Type `action` parameter per RFC 3902
- **Fixed**: Added automatic SOAP version detection from envelope namespace
- **Fixed**: Chunk extension handling (strip `;` parameters from chunk size)
- **Fixed**: HTTP status code validation (throw error if missing)
- **Added**: `soapVersion` parameter for explicit version control
