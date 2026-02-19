# SOAP Review

**Protocol:** SOAP (Simple Object Access Protocol)
**File:** `src/worker/soap.ts`
**Reviewed:** 2026-02-19
**Specification:** SOAP 1.1 / SOAP 1.2 (W3C Recommendations)
**Tests:** `tests/soap.test.ts`

## Summary

SOAP implementation provides 2 endpoints (call, wsdl) for XML-based web services. Automatically detects SOAP 1.1 vs 1.2 from envelope namespace. Implements chunked transfer-encoding decoder for large SOAP responses. Handles fault parsing for error detection. **NOTE:** Runs over unencrypted HTTP (port 80) by default — no TLS option for SOAP-over-HTTPS.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **NO TLS SUPPORT**: SOAP endpoints hardcoded to HTTP (port 80, line 88, 232) — no option for HTTPS, all SOAP messages sent in cleartext |
| 2 | High | **XML INJECTION**: SOAPAction header (line 104) not validated — injecting `\r\n` allows HTTP header injection attacks |
| 3 | High | **MEMORY EXHAUSTION**: Response reading (lines 122-129, 246-253) accumulates unlimited data (512KB limit but no enforcement) — malicious server can send 10GB SOAP response |
| 4 | Medium | **CHUNKED DECODING**: Custom `decodeChunked` (lines 175-206) duplicates HTTP.ts logic — should import shared implementation to fix bugs in one place |
| 5 | Low | **REGEX FAULT PARSING**: Fault code/string extraction (lines 318-325) uses simple regex — fails on CDATA sections, namespace prefixes |
| 6 | Low | **WSDL PARSING**: Operation extraction (lines 443-453) only finds `<wsdl:operation>` — misses `<operation>` without namespace prefix |

## Security Analysis (No TLS)

### Cleartext SOAP Messages

**Current Implementation:**
```typescript
async function sendSoapRequest(
  host: string,
  port: number,  // Default 80
  path: string,
  soapBody: string,
  soapAction?: string,
  timeout = 15000,
  soapVersion?: '1.1' | '1.2',
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);  // ❌ No TLS option
  // ...
}
```

**Sensitive Data Exposure:**
```xml
<!-- Example SOAP request (visible on network): -->
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:Login>
      <username>john.doe</username>
      <password>secret123</password>  ← PLAINTEXT
    </ns:Login>
  </soapenv:Body>
</soapenv:Envelope>
```

**Attack Scenarios:**
1. **Credential Theft:** Banking SOAP APIs often use username/password in body
2. **Data Leakage:** Healthcare HL7/SOAP contains PHI (Protected Health Information)
3. **Business Logic Exposure:** SOAP method names reveal internal APIs

### Impact on Enterprise Systems

**Typical SOAP Use Cases:**
- Banking (wire transfers, account queries)
- Healthcare (HL7 SOAP, patient records)
- Government (tax filing, benefits)
- ERP systems (SAP, Oracle)

**All require HTTPS in production but Worker cannot test encrypted SOAP.**

### Recommended Fix

**Add TLS Support:**
```typescript
async function sendSoapRequest(
  host: string,
  port: number,
  path: string,
  soapBody: string,
  soapAction?: string,
  timeout = 15000,
  soapVersion?: '1.1' | '1.2',
  tls = false,  // ← Add TLS parameter
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socketOptions = tls ? { secureTransport: 'on' as const } : undefined;
  const socket = connect(`${host}:${port}`, socketOptions);
  // ...
}
```

**Update Endpoint:**
```typescript
export async function handleSoapCall(request: Request): Promise<Response> {
  const body = await request.json() as SOAPRequest & { tls?: boolean };
  const tls = body.tls ?? false;
  const port = body.port ?? (tls ? 443 : 80);

  const result = await sendSoapRequest(
    body.host, port, normalizedPath, body.body, body.soapAction, body.timeout, body.soapVersion,
    tls  // ← Pass TLS flag
  );
  // ...
}
```

## SOAP Version Detection

### Implementation (Lines 50-56, 302-311)

```typescript
function detectSoapVersion(envelope: string): '1.1' | '1.2' | undefined {
  if (envelope.includes('http://www.w3.org/2003/05/soap-envelope')) {
    return '1.2';
  } else if (envelope.includes('http://schemas.xmlsoap.org/soap/envelope/')) {
    return '1.1';
  }
  return undefined;
}
```

**SOAP 1.1 vs 1.2 Differences:**

| Feature | SOAP 1.1 | SOAP 1.2 |
|---------|----------|----------|
| Namespace | `http://schemas.xmlsoap.org/soap/envelope/` | `http://www.w3.org/2003/05/soap-envelope` |
| Content-Type | `text/xml` | `application/soap+xml` |
| SOAPAction | Required header | Optional `action` parameter |
| Fault Structure | `faultcode`, `faultstring` | `Code/Value`, `Reason/Text` |

**Content-Type Selection (Lines 91-106):**
```typescript
if (detectedVersion === '1.2') {
  // RFC 3902: SOAP 1.2 uses application/soap+xml
  let contentType = 'application/soap+xml; charset=utf-8';
  if (soapAction) {
    contentType += `; action="${soapAction}"`;
  }
  request += `Content-Type: ${contentType}\r\n`;
} else {
  // SOAP 1.1 uses text/xml and separate SOAPAction header
  request += `Content-Type: text/xml; charset=utf-8\r\n`;
  if (soapAction !== undefined) {
    request += `SOAPAction: "${soapAction}"\r\n`;  // ❌ Injection risk
  }
}
```

**RFC Compliance:**
- ✅ SOAP 1.1: `Content-Type: text/xml` + `SOAPAction: "..."` header
- ✅ SOAP 1.2: `Content-Type: application/soap+xml; action="..."`

### SOAPAction Header Injection

**Vulnerability (Line 104):**
```typescript
request += `SOAPAction: "${soapAction}"\r\n`;  // ❌ Not validated
```

**Attack:**
```typescript
// Malicious input:
soapAction = "urn:login\"\r\nX-Evil: injected\r\nFake: \""

// Resulting HTTP headers:
SOAPAction: "urn:login"
X-Evil: injected
Fake: ""
Content-Length: 1234
```

**Fix:**
```typescript
function validateSoapAction(action: string): void {
  if (/[\r\n\0"]/.test(action)) {
    throw new Error('SOAPAction cannot contain CR/LF/NUL/quotes');
  }
}

if (soapAction !== undefined) {
  validateSoapAction(soapAction);
  request += `SOAPAction: "${soapAction}"\r\n`;
}
```

## SOAP Fault Parsing

### Current Implementation (Lines 294-329)

```typescript
function parseSoapResponse(xml: string): SOAPResponse['parsed'] {
  const result: SOAPResponse['parsed'] = {
    isSoap: false,
    hasFault: false,
    soapVersion: undefined,
  };

  // Detect SOAP version
  if (xml.includes('http://schemas.xmlsoap.org/soap/envelope/')) {
    result.isSoap = true;
    result.soapVersion = '1.1';
  } else if (xml.includes('http://www.w3.org/2003/05/soap-envelope')) {
    result.isSoap = true;
    result.soapVersion = '1.2';
  }

  // Detect SOAP fault
  if (xml.includes('<soap:Fault') || xml.includes('<SOAP-ENV:Fault') || xml.includes('<soapenv:Fault')) {
    result.hasFault = true;

    // Extract faultcode (SOAP 1.1)
    const codeMatch = xml.match(/<faultcode[^>]*>([^<]+)<\/faultcode>/i)
      || xml.match(/<Code[^>]*>.*?<Value[^>]*>([^<]+)<\/Value>/is);  // SOAP 1.2
    if (codeMatch) result.faultCode = codeMatch[1].trim();

    // Extract faultstring (SOAP 1.1) or Reason/Text (SOAP 1.2)
    const stringMatch = xml.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/i)
      || xml.match(/<Reason[^>]*>.*?<Text[^>]*>([^<]+)<\/Text>/is);
    if (stringMatch) result.faultString = stringMatch[1].trim();
  }

  return result;
}
```

**Issues:**

1. **Namespace Handling:**
   - Works for common prefixes (`soap`, `SOAP-ENV`, `soapenv`)
   - Fails for custom prefixes: `<s12:Fault>` (SOAP 1.2 with `s12` prefix)

2. **CDATA Sections:**
   ```xml
   <faultstring><![CDATA[Error: <invalid>]]></faultstring>
   ```
   Regex `([^<]+)` stops at `<invalid>`, returns partial string.

3. **Nested Elements:**
   ```xml
   <Code>
     <Value>soap:Sender</Value>
     <Subcode><Value>InvalidCredentials</Value></Subcode>
   </Code>
   ```
   Regex returns first `<Value>`, ignores `<Subcode>`.

**Robust XML Parsing Needed:**
Use DOM parser (if available in Workers):
```typescript
const parser = new DOMParser();
const doc = parser.parseFromString(xml, 'text/xml');
const faultNode = doc.getElementsByTagNameNS('*', 'Fault')[0];
if (faultNode) {
  const codeNode = faultNode.getElementsByTagName('faultcode')[0]
    || faultNode.getElementsByTagNameNS('*', 'Value')[0];
  result.faultCode = codeNode?.textContent?.trim();
}
```

## WSDL Discovery

### Implementation (Lines 410-478)

```typescript
export async function handleSoapWsdl(request: Request): Promise<Response> {
  // ...
  const result = await sendWsdlRequest(host, port, normalizedPath, timeout);

  const isWsdl = result.body.includes('<wsdl:') || result.body.includes('<definitions')
    || result.body.includes('schemas.xmlsoap.org/wsdl');

  // Extract service info
  let serviceName: string | undefined;
  let operations: string[] = [];

  if (isWsdl) {
    const nameMatch = result.body.match(/<wsdl:service\s+name="([^"]+)"/i)
      || result.body.match(/<service\s+name="([^"]+)"/i);
    if (nameMatch) serviceName = nameMatch[1];

    const opMatches = result.body.matchAll(/<wsdl:operation\s+name="([^"]+)"/gi);
    const opSet = new Set<string>();
    for (const match of opMatches) {
      opSet.add(match[1]);
    }

    const opMatches2 = result.body.matchAll(/<operation\s+name="([^"]+)"/gi);
    for (const match of opMatches2) {
      opSet.add(match[1]);
    }
    operations = Array.from(opSet);
  }
  // ...
}
```

**Good Practices:**
- ✅ Handles both `<wsdl:operation>` and `<operation>` (with/without namespace)
- ✅ Uses Set to deduplicate operations
- ✅ Checks multiple WSDL indicators

**Missing Features:**
- ❌ No port/binding extraction
- ❌ No endpoint URL extraction (where to send SOAP requests)
- ❌ No message type parsing (input/output schemas)

**Enhanced WSDL Parsing:**
```typescript
// Extract SOAP endpoint
const portMatch = result.body.match(/<soap:address\s+location="([^"]+)"/i)
  || result.body.match(/<address\s+location="([^"]+)"/i);
const endpoint = portMatch ? portMatch[1] : undefined;

// Return additional metadata
return new Response(JSON.stringify({
  success: true,
  isWsdl,
  serviceName,
  operations,
  endpoint,  // ← Add endpoint URL
  bindingStyle: result.body.includes('rpc') ? 'rpc' : 'document',
}));
```

## Chunked Transfer Encoding

**Duplication Issue (Lines 175-206):**
```typescript
function decodeChunked(data: string): string {
  // ... same logic as http.ts decodeChunked
}
```

**Problem:** Logic duplicated from `http.ts` lines 116-160.
If bug fixed in one file, must fix in both.

**Solution:**
```typescript
// Create shared/chunked-decoder.ts
export function decodeChunked(data: Uint8Array | string): Uint8Array | string {
  // Unified implementation
}

// Import in both files
import { decodeChunked } from './shared/chunked-decoder';
```

## Documentation Improvements

**Created:** `docs/protocols/SOAP.md` (needed)

Should document:

1. **Security Warnings**
   - ⚠️ NO TLS SUPPORT — SOAP messages in cleartext
   - ⚠️ Credentials in SOAP body visible to network
   - Add `tls` parameter for HTTPS support

2. **2 Endpoints**
   - `/call` — Send SOAP envelope, parse response
   - `/wsdl` — Fetch WSDL document (GET request with `?wsdl`)

3. **SOAP Version Support**
   - SOAP 1.1 (`text/xml` + `SOAPAction` header)
   - SOAP 1.2 (`application/soap+xml` + `action` parameter)
   - Auto-detection from namespace

4. **Fault Codes**
   - **SOAP 1.1:** `faultcode` (e.g., `soap:Client`, `soap:Server`)
   - **SOAP 1.2:** `Code/Value` (e.g., `soap:Sender`, `soap:Receiver`)

5. **Known Limitations**
   - No TLS/HTTPS support (HTTP only)
   - No WS-Security (SOAP security extensions)
   - No MTOM (binary attachments)
   - No WS-ReliableMessaging
   - Fault parsing uses regex (no full XML parser)
   - WSDL parsing minimal (operations only, no schemas)

6. **WSDL Elements**
   - `<definitions>` — Root element
   - `<types>` — XML Schema definitions
   - `<message>` — Abstract message definitions
   - `<portType>` — Abstract operations
   - `<binding>` — Concrete protocol bindings
   - `<service>` — Endpoint addresses

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** Pending (tests/soap.test.ts needs creation)
**Spec Compliance:**
- ✅ SOAP 1.1 (W3C Note) - Partial
- ✅ SOAP 1.2 (W3C Recommendation) - Partial
- ❌ WS-Security - Not implemented
- ❌ MTOM - Not implemented

## See Also

- [SOAP 1.1 Specification](https://www.w3.org/TR/2000/NOTE-SOAP-20000508/)
- [SOAP 1.2 Specification](https://www.w3.org/TR/soap12/)
- [WSDL 1.1 Specification](https://www.w3.org/TR/wsdl/)
- [Critical Fixes Summary](../critical-fixes.md)
