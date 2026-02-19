# ManageSieve Protocol Implementation

**RFC:** [RFC 5804](https://datatracker.ietf.org/doc/html/rfc5804)
**Port:** 4190 (formerly 2000, reassigned by IANA in 2004)
**TLS:** Optional (STARTTLS)
**Implementation:** `/Users/rj/gd/code/portofcall/src/worker/managesieve.ts`

## Overview

ManageSieve is a text-based protocol for remotely managing Sieve email filtering scripts on mail servers (Dovecot, Cyrus IMAP). It's the "fourth pillar" of the email stack alongside SMTP, POP3, and IMAP.

Sieve scripts allow users to filter incoming email (e.g., vacation auto-replies, spam filtering, folder routing). ManageSieve provides authenticated remote access to upload, download, list, activate, and delete these scripts.

## API Endpoints

### 1. CONNECT — Capability Probe

**Endpoint:** `POST /api/managesieve/connect`

Connects to the server and reads the capability banner. No authentication.

**Request:**
```json
{
  "host": "mail.example.com",
  "port": 4190,
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "capabilities": [
    { "key": "IMPLEMENTATION", "value": "Dovecot Pigeonhole" },
    { "key": "SIEVE", "value": "fileinto reject envelope body" },
    { "key": "SASL", "value": "PLAIN LOGIN" },
    { "key": "VERSION", "value": "1.0" },
    { "key": "STARTTLS", "value": "" }
  ],
  "implementation": "Dovecot Pigeonhole",
  "sieveExtensions": "fileinto reject envelope body",
  "saslMethods": "PLAIN LOGIN",
  "version": "1.0",
  "starttls": true,
  "banner": "\"IMPLEMENTATION\" \"Dovecot Pigeonhole\"\r\n..."
}
```

**Response (Failure):**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Field Defaults:**
- `port`: 4190 (default ManageSieve port)
- `timeout`: 10000 ms

**Port Validation:** 1-65535
**Host Validation:** `/^[a-zA-Z0-9._-]+$/` (no spaces, no special chars except `._-`)

---

### 2. LISTSCRIPTS — Authenticate + List Scripts

**Endpoint:** `POST /api/managesieve/list`

Authenticates with SASL PLAIN and lists all Sieve scripts. The active script (if any) is marked with `active: true`.

**Request:**
```json
{
  "host": "mail.example.com",
  "port": 4190,
  "username": "user@example.com",
  "password": "secret",
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "authenticated": true,
  "scripts": [
    { "name": "vacation", "active": true },
    { "name": "spam-filter", "active": false },
    { "name": "work-rules", "active": false }
  ]
}
```

**Response (Auth Failure):**
```json
{
  "success": false,
  "authenticated": false,
  "error": "Authentication failed",
  "responseCode": "AUTH-TOO-WEAK"
}
```

**Notes:**
- Empty script list `[]` means no scripts exist (valid state).
- At most one script can have `active: true`.
- Script names are UTF-8 encoded per RFC 5804 Net-Unicode restrictions.

---

### 3. GETSCRIPT — Download a Script

**Endpoint:** `POST /api/managesieve/getscript`

Retrieves the content of a script by name.

**Request:**
```json
{
  "host": "mail.example.com",
  "port": 4190,
  "username": "user@example.com",
  "password": "secret",
  "scriptName": "vacation",
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "mail.example.com",
  "port": 4190,
  "scriptName": "vacation",
  "script": "require \"vacation\";\nvacation \"I'm on vacation!\";\n",
  "scriptBytes": 53,
  "rtt": 142
}
```

**Response (Not Found):**
```json
{
  "success": false,
  "error": "GETSCRIPT failed: NO (NONEXISTENT) \"Script not found\"",
  "responseCode": "NONEXISTENT"
}
```

**Notes:**
- `scriptBytes` is the exact byte count from the server's `{size}` literal header.
- `rtt` is round-trip time in milliseconds (including auth handshake).

---

### 4. PUTSCRIPT — Upload or Replace a Script

**Endpoint:** `POST /api/managesieve/putscript`

Uploads a new script or replaces an existing one. The server validates Sieve syntax before accepting.

**Request:**
```json
{
  "host": "mail.example.com",
  "port": 4190,
  "username": "user@example.com",
  "password": "secret",
  "scriptName": "vacation",
  "script": "require \"vacation\";\nvacation \"I'm on vacation!\";\n",
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "mail.example.com",
  "port": 4190,
  "scriptName": "vacation",
  "scriptBytes": 53,
  "rtt": 187
}
```

**Response (Syntax Error):**
```json
{
  "success": false,
  "error": "PUTSCRIPT failed: NO (line 2: unknown command 'vacation')",
  "responseCode": null
}
```

**Response (Quota Exceeded):**
```json
{
  "success": false,
  "error": "PUTSCRIPT failed: NO (QUOTA/MAXSIZE) \"Script too large\"",
  "responseCode": "QUOTA/MAXSIZE"
}
```

**Notes:**
- Script is validated server-side before accepting. If invalid, returns `NO` with syntax error details.
- Uploading a script does NOT activate it. Use `SETACTIVE` after upload.
- `scriptBytes` in request is auto-calculated from UTF-8 encoded `script` field.

---

### 5. DELETESCRIPT — Delete a Script

**Endpoint:** `POST /api/managesieve/deletescript`

Deletes a script by name. Cannot delete the currently active script (use `SETACTIVE ""` first).

**Request:**
```json
{
  "host": "mail.example.com",
  "port": 4190,
  "username": "user@example.com",
  "password": "secret",
  "scriptName": "old-script",
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "mail.example.com",
  "port": 4190,
  "scriptName": "old-script",
  "rtt": 135
}
```

**Response (Active Script):**
```json
{
  "success": false,
  "error": "DELETESCRIPT failed: NO (ACTIVE) \"Cannot delete active script\"",
  "responseCode": "ACTIVE"
}
```

**Response (Not Found):**
```json
{
  "success": false,
  "error": "DELETESCRIPT failed: NO (NONEXISTENT) \"Script not found\"",
  "responseCode": "NONEXISTENT"
}
```

---

### 6. SETACTIVE — Activate a Script

**Endpoint:** `POST /api/managesieve/setactive`

Activates a script (makes it run on incoming mail). Only one script can be active at a time.

**Request (Activate):**
```json
{
  "host": "mail.example.com",
  "port": 4190,
  "username": "user@example.com",
  "password": "secret",
  "scriptName": "spam-filter",
  "timeout": 10000
}
```

**Request (Deactivate All):**
```json
{
  "host": "mail.example.com",
  "port": 4190,
  "username": "user@example.com",
  "password": "secret",
  "scriptName": "",
  "timeout": 10000
}
```

**Response (Success):**
```json
{
  "success": true,
  "host": "mail.example.com",
  "port": 4190,
  "scriptName": "spam-filter",
  "rtt": 128
}
```

**Notes:**
- Empty `scriptName: ""` deactivates all scripts (RFC 5804 special case).
- If another script was active, it's automatically deactivated (one active script at a time).

---

## Protocol Flow

### Capability Banner (Connect)
```
Client: <connect to port 4190>
Server: "IMPLEMENTATION" "Dovecot Pigeonhole"
        "SIEVE" "fileinto reject envelope body"
        "SASL" "PLAIN LOGIN"
        "VERSION" "1.0"
        "STARTTLS"
        OK "ManageSieve ready"
```

### Authentication (SASL PLAIN)
```
Client: AUTHENTICATE "PLAIN" "<base64(\0username\0password)>"
Server: OK "Logged in."
```

### List Scripts
```
Client: LISTSCRIPTS
Server: "vacation" ACTIVE
        "spam-filter"
        "work-rules"
        OK "Listscripts completed."
```

### Get Script
```
Client: GETSCRIPT "vacation"
Server: {53}
        require "vacation";
        vacation "I'm on vacation!";

        OK "Getscript completed."
```

### Upload Script (Non-Synchronizing Literal)
```
Client: PUTSCRIPT "vacation" {53+}
        require "vacation";
        vacation "I'm on vacation!";

Server: OK "Putscript completed."
```

### Activate Script
```
Client: SETACTIVE "vacation"
Server: OK "Setactive completed."
```

### Delete Script
```
Client: DELETESCRIPT "old-script"
Server: OK "Deletescript completed."
```

### Logout
```
Client: LOGOUT
Server: OK "Logout completed."
```

---

## String Encoding

### Quoted Strings
- Format: `"content"`
- Max length: 1024 octets (between quotes)
- Escaping: `\"` for double-quote, `\\` for backslash
- Example: `"Hello \"World\""` → `Hello "World"`

### Literal Strings (Client-to-Server)
- Format: `{size+}\r\n<content>`
- The `+` indicates non-synchronizing literal (no wait for server acknowledgment)
- `size` is exact byte count of UTF-8 encoded content
- Used for script bodies in `PUTSCRIPT`

### Literal Strings (Server-to-Client)
- Format: `{size}\r\n<content>`
- No `+` suffix (server always non-synchronizing)
- Used for script bodies in `GETSCRIPT` response

---

## Response Codes

ManageSieve responses follow the pattern:
```
(OK | NO | BYE) [(response-code)] [human-readable text]
```

### Common Response Codes

| Code | Meaning | Example |
|------|---------|---------|
| `NONEXISTENT` | Script name doesn't exist | `NO (NONEXISTENT) "Script not found"` |
| `ACTIVE` | Cannot delete active script | `NO (ACTIVE) "Deactivate first"` |
| `ALREADYEXISTS` | Script name already exists | `NO (ALREADYEXISTS) "Name taken"` |
| `QUOTA/MAXSCRIPTS` | Too many scripts | `NO (QUOTA/MAXSCRIPTS) "Limit 10 scripts"` |
| `QUOTA/MAXSIZE` | Script too large | `NO (QUOTA/MAXSIZE) "Max 64 KB per script"` |
| `WARNINGS` | Script valid but has warnings | `OK (WARNINGS) "Unused variable 'x'"` |
| `AUTH-TOO-WEAK` | SASL mechanism not allowed | `NO (AUTH-TOO-WEAK) "PLAIN requires TLS"` |

Response codes are extracted via regex: `/^(?:OK|NO|BYE)\s+\(([^)]+)\)/`

---

## Supported SASL Mechanisms

### PLAIN (Implemented)
- Format: `\0username\0password` → base64
- Example: `\0alice\0secret` → `AGFsaWNlAHNlY3JldA==`
- Command: `AUTHENTICATE "PLAIN" "AGFsaWNlAHNlY3JldA=="`
- **RFC Requirement:** MUST be supported over TLS

### SCRAM-SHA-1 (NOT Implemented)
- RFC 5804 states: "Both client and server implementations MUST implement SCRAM-SHA-1"
- **BUG:** This implementation violates RFC 5804 by not supporting SCRAM-SHA-1

---

## Known Limitations and Quirks

### Critical (RFC Violations)

1. **No SCRAM-SHA-1 Support (RFC Violation)**
   - RFC 5804 Section 2.1: "Both client and server implementations of the ManageSieve protocol MUST implement the SCRAM-SHA-1 SASL mechanism"
   - This implementation only supports PLAIN authentication
   - Impact: Cannot connect to servers that require SCRAM-SHA-1 or disable PLAIN

2. **Missing RENAMESCRIPT Command (Version 1.0 Violation)**
   - RFC 5804: Servers advertising `VERSION "1.0"` MUST support RENAMESCRIPT
   - This client cannot rename scripts (workaround: GETSCRIPT → PUTSCRIPT → DELETESCRIPT)

3. **Missing CHECKSCRIPT Command (Version 1.0 Violation)**
   - RFC 5804: CHECKSCRIPT validates Sieve syntax without storing
   - This client cannot pre-validate scripts (must use PUTSCRIPT and handle errors)

4. **Missing NOOP Command (Version 1.0 Violation)**
   - RFC 5804: NOOP keeps connection alive and optionally echoes a tag
   - No keepalive mechanism for long-lived sessions

5. **No STARTTLS Support**
   - RFC 5804 recommends STARTTLS before PLAIN auth
   - This implementation sends PLAIN credentials in cleartext if server is not using TLS
   - Dovecot typically rejects PLAIN over non-TLS connections

6. **No Post-Auth CAPABILITY Check**
   - RFC 5804 Section 2.4: "Clients SHOULD re-issue CAPABILITY after STARTTLS or AUTHENTICATE"
   - Server capabilities may change after authentication (e.g., OWNER field added)
   - This client uses only the initial banner capabilities

### Medium (Protocol Compliance)

7. **No Connection Reuse**
   - RFC 7858 Section 3.4 recommends connection reuse for efficiency
   - Each API call opens a new connection, authenticates, executes command, and closes
   - Impact: Higher latency, more server load

8. **No Pipelining**
   - RFC 5804 allows pipelining multiple commands (except AUTHENTICATE/STARTTLS as last)
   - Could pipeline: `LISTSCRIPTS\r\nGETSCRIPT "vacation"\r\nLOGOUT\r\n`
   - Current: Serial execution with round-trip delay per command

9. **GETSCRIPT Literal Parsing Fragility**
   - Uses `encoder.encode(response)` to re-encode the decoded string for byte slicing
   - May fail if server sends malformed UTF-8 or if response contains binary data
   - Correct approach: Parse literal headers before decoding (like IMAP FETCH does)

10. **No Script Name Length Validation**
    - RFC 5804: Script names MUST be at least 1 character, servers MUST support up to 128 Unicode chars (512 UTF-8 bytes)
    - This client allows arbitrary length names (server will reject if too long)

11. **No UTF-8 Validation for Script Names**
    - RFC 5804 Section 1.6: Script names must comply with Net-Unicode (no control chars U+0000-U+001F, U+007F, U+0080-U+009F, U+2028, U+2029)
    - This client sends names as-is (server will reject invalid names)

12. **No Quota Pre-Check**
    - RFC 5804 HAVESPACE command checks if script will fit before uploading
    - This client blindly uploads and handles `QUOTA/*` errors after the fact

### Low (Usability / Informational)

13. **No LOGOUT Response Wait**
    - RFC 5804: "Server MUST send response before closing connection"
    - This client sends `LOGOUT\r\n` and immediately closes socket without reading response
    - Impact: Rare, but server logs may show aborted connection

14. **Timeout Shared Across All Operations**
    - Single timeout timer starts at socket open, covers TLS handshake + auth + command
    - Slow TLS handshake eats into command timeout budget
    - Better: Separate timeouts for connect, auth, command

15. **No Capability Caching**
    - Each `/connect` call opens a new socket
    - Useful for capability probes, wasteful if checking same server repeatedly

16. **Host Validation Too Strict**
    - Regex `/^[a-zA-Z0-9._-]+$/` rejects IPv6 addresses `[::1]`
    - Workaround: Use IPv6 hostname (e.g., `ip6-localhost`)

17. **405 Response Missing `success: false`**
    - Non-POST requests return `405 Method not allowed` plaintext
    - Other error responses use JSON with `success: false`
    - Shape inconsistency

18. **Cloudflare Detection Only in `/list`**
    - `/connect` endpoint does NOT check for Cloudflare proxy
    - `/list`, `/putscript`, `/getscript`, `/deletescript`, `/setactive` all check
    - Inconsistent behavior

19. **No TXT Response Code on OK**
    - RFC 5804 allows `OK (TAG "xyz")` response codes (e.g., WARNINGS)
    - This implementation only extracts codes from NO/BYE responses
    - `WARNINGS` response code on successful PUTSCRIPT is ignored

20. **Script Content Type Ambiguity**
    - Sieve scripts are UTF-8 text per RFC 5228
    - This implementation uses `TextDecoder()` which replaces invalid UTF-8 with U+FFFD
    - May silently corrupt scripts with encoding errors (rare, but possible)

---

## Comparison: ManageSieve vs Other Admin Protocols

| Feature | ManageSieve | FTP | IMAP (METADATA) | HTTP REST |
|---------|-------------|-----|-----------------|-----------|
| Port | 4190 | 21 | 143 | 443 |
| TLS | STARTTLS | AUTH TLS / Implicit | STARTTLS | HTTPS |
| Auth | SASL (PLAIN, SCRAM) | USER/PASS | SASL | Bearer Token |
| Script Upload | PUTSCRIPT | STOR | SETMETADATA | PUT |
| Validation | Server-side Sieve | None | None | App-dependent |
| Max Script | Quota-limited | Quota-limited | 64 KB | Unlimited |
| Script List | LISTSCRIPTS | LIST | GETMETADATA | GET /scripts |
| Active Marker | ACTIVE keyword | N/A | Metadata flag | Config field |
| Atomicity | Per-command | Per-file | Per-mailbox | Per-request |

**Why ManageSieve over FTP?**
- FTP has no Sieve syntax validation (upload broken scripts)
- FTP has no "active script" concept (mail server must guess)
- ManageSieve is purpose-built for Sieve management

---

## curl Examples

### 1. Check Server Capabilities
```bash
curl -X POST http://localhost:8787/api/managesieve/connect \
  -H "Content-Type: application/json" \
  -d '{"host": "mail.example.com", "port": 4190}'
```

**Expected Output:**
```json
{
  "success": true,
  "implementation": "Dovecot Pigeonhole",
  "sieveExtensions": "fileinto reject envelope body imap4flags",
  "saslMethods": "PLAIN LOGIN",
  "version": "1.0",
  "starttls": true
}
```

---

### 2. List All Scripts
```bash
curl -X POST http://localhost:8787/api/managesieve/list \
  -H "Content-Type: application/json" \
  -d '{
    "host": "mail.example.com",
    "port": 4190,
    "username": "alice@example.com",
    "password": "secret"
  }'
```

**Expected Output:**
```json
{
  "success": true,
  "authenticated": true,
  "scripts": [
    { "name": "vacation", "active": true },
    { "name": "spam-filter", "active": false }
  ]
}
```

---

### 3. Download a Script
```bash
curl -X POST http://localhost:8787/api/managesieve/getscript \
  -H "Content-Type: application/json" \
  -d '{
    "host": "mail.example.com",
    "username": "alice@example.com",
    "password": "secret",
    "scriptName": "vacation"
  }' | jq -r '.script'
```

**Expected Output:**
```sieve
require "vacation";
vacation :days 7 "I'm on vacation until next week!";
```

---

### 4. Upload a New Script
```bash
curl -X POST http://localhost:8787/api/managesieve/putscript \
  -H "Content-Type: application/json" \
  -d '{
    "host": "mail.example.com",
    "username": "alice@example.com",
    "password": "secret",
    "scriptName": "spam-filter",
    "script": "require \"fileinto\";\nif header :contains \"subject\" \"SPAM\" {\n  fileinto \"Spam\";\n}\n"
  }'
```

**Expected Output:**
```json
{
  "success": true,
  "scriptName": "spam-filter",
  "scriptBytes": 94,
  "rtt": 187
}
```

---

### 5. Activate a Script
```bash
curl -X POST http://localhost:8787/api/managesieve/setactive \
  -H "Content-Type: application/json" \
  -d '{
    "host": "mail.example.com",
    "username": "alice@example.com",
    "password": "secret",
    "scriptName": "spam-filter"
  }'
```

**Expected Output:**
```json
{
  "success": true,
  "scriptName": "spam-filter",
  "rtt": 128
}
```

---

### 6. Deactivate All Scripts
```bash
curl -X POST http://localhost:8787/api/managesieve/setactive \
  -H "Content-Type: application/json" \
  -d '{
    "host": "mail.example.com",
    "username": "alice@example.com",
    "password": "secret",
    "scriptName": ""
  }'
```

**Expected Output:**
```json
{
  "success": true,
  "scriptName": "",
  "rtt": 115
}
```

---

### 7. Delete a Script
```bash
curl -X POST http://localhost:8787/api/managesieve/deletescript \
  -H "Content-Type: application/json" \
  -d '{
    "host": "mail.example.com",
    "username": "alice@example.com",
    "password": "secret",
    "scriptName": "old-script"
  }'
```

**Expected Output (Success):**
```json
{
  "success": true,
  "scriptName": "old-script",
  "rtt": 135
}
```

**Expected Output (Active Script Error):**
```json
{
  "success": false,
  "error": "DELETESCRIPT failed: NO (ACTIVE) \"Cannot delete active script\"",
  "responseCode": "ACTIVE"
}
```

---

### 8. Handle Invalid Sieve Syntax
```bash
curl -X POST http://localhost:8787/api/managesieve/putscript \
  -H "Content-Type: application/json" \
  -d '{
    "host": "mail.example.com",
    "username": "alice@example.com",
    "password": "secret",
    "scriptName": "broken",
    "script": "this is not valid sieve syntax;"
  }'
```

**Expected Output:**
```json
{
  "success": false,
  "error": "PUTSCRIPT failed: NO line 1: unknown command 'this'",
  "responseCode": null
}
```

---

### 9. Test Timeout Behavior
```bash
curl -X POST http://localhost:8787/api/managesieve/list \
  -H "Content-Type: application/json" \
  -d '{
    "host": "10.255.255.1",
    "username": "user",
    "password": "pass",
    "timeout": 2000
  }'
```

**Expected Output (After 2 seconds):**
```json
{
  "success": false,
  "error": "Connection timeout"
}
```

---

### 10. Check Cloudflare Block
```bash
curl -X POST http://localhost:8787/api/managesieve/list \
  -H "Content-Type: application/json" \
  -d '{
    "host": "one.one.one.one",
    "username": "user",
    "password": "pass"
  }'
```

**Expected Output:**
```json
{
  "success": false,
  "error": "The domain one.one.one.one (1.1.1.1) appears to be hosted behind Cloudflare...",
  "isCloudflare": true
}
```

---

## Sieve Language Quick Reference

### Common Extensions

| Extension | Capability Token | Purpose |
|-----------|------------------|---------|
| fileinto | `fileinto` | Move mail to folder: `fileinto "Spam";` |
| reject | `reject` | Reject mail: `reject "No spam here";` |
| vacation | `vacation` | Auto-reply: `vacation "I'm away";` |
| imap4flags | `imap4flags` | Set IMAP flags: `setflag "\\Flagged";` |
| envelope | `envelope` | Test envelope sender: `if envelope :is "from" "spam@example.com"` |
| body | `body` | Test message body: `if body :contains "viagra"` |
| regex | `regex` | Regex matching: `if header :regex "subject" "^\\[SPAM\\]"` |

### Basic Script Structure
```sieve
require ["fileinto", "reject"];

# Reject obvious spam
if header :contains "subject" "SPAM" {
  reject "Spam not accepted here";
  stop;
}

# File newsletters
if header :is "list-id" "newsletter.example.com" {
  fileinto "Newsletters";
  stop;
}

# Default: keep in inbox
keep;
```

---

## Wire Protocol Diagram

```
Client                                   Server
  |                                         |
  |--- TCP SYN (port 4190) --------------> |
  |<-- SYN-ACK ----------------------------|
  |--- ACK -------------------------------->|
  |                                         |
  |<-- "IMPLEMENTATION" "Dovecot" ---------|  Capability banner
  |<-- "SIEVE" "fileinto reject" ----------|
  |<-- "SASL" "PLAIN LOGIN" ---------------|
  |<-- "VERSION" "1.0" --------------------|
  |<-- OK "Ready" -------------------------|
  |                                         |
  |--- AUTHENTICATE "PLAIN" "YWxpY2U=" -->|  SASL PLAIN auth
  |<-- OK "Logged in" ---------------------|
  |                                         |
  |--- LISTSCRIPTS ----------------------->|  List scripts
  |<-- "vacation" ACTIVE ------------------|
  |<-- "spam-filter" ----------------------|
  |<-- OK "Listscripts completed" ---------|
  |                                         |
  |--- GETSCRIPT "vacation" -------------->|  Download script
  |<-- {53} -------------------------------|  Literal header
  |<-- require "vacation";... -------------|  Script body
  |<-- OK "Getscript completed" -----------|
  |                                         |
  |--- LOGOUT ---------------------------->|  Close session
  |<-- OK "Logout completed" --------------|
  |<-- FIN --------------------------------|
  |--- FIN-ACK --------------------------->|
```

---

## Error Handling Best Practices

### 1. Check Capabilities Before Commands
```bash
# First check if server supports required extensions
curl -X POST .../connect -d '{"host": "mail.example.com"}' | jq '.sieveExtensions'
# Output: "fileinto reject envelope body"

# If "vacation" is missing, your script will be rejected by PUTSCRIPT
```

### 2. Handle ACTIVE Script Deletion
```bash
# Wrong: Delete active script directly
curl -X POST .../deletescript -d '{"scriptName": "vacation"}'
# Error: NO (ACTIVE) "Cannot delete active script"

# Right: Deactivate first
curl -X POST .../setactive -d '{"scriptName": ""}'
curl -X POST .../deletescript -d '{"scriptName": "vacation"}'
```

### 3. Validate Sieve Syntax Client-Side
```bash
# Use sieve-connect or ManageSieve CLI to pre-validate:
sieve-connect --server mail.example.com --user alice --localsieve vacation.siv --checkscript

# Workaround for missing CHECKSCRIPT:
# Upload with temp name, then delete if successful
curl -X POST .../putscript -d '{"scriptName": "test-validation", "script": "..."}'
curl -X POST .../deletescript -d '{"scriptName": "test-validation"}'
```

### 4. Retry on Timeout
```javascript
async function uploadWithRetry(scriptName, script, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch('/api/managesieve/putscript', {
      method: 'POST',
      body: JSON.stringify({ scriptName, script, timeout: 10000 })
    });
    const data = await response.json();
    if (data.success) return data;
    if (data.error !== 'Connection timeout') throw new Error(data.error);
    await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
  }
  throw new Error('Max retries exceeded');
}
```

---

## Security Considerations

1. **PLAIN Auth Over Cleartext**
   - RFC 5804 requires PLAIN over TLS only
   - This implementation sends PLAIN without STARTTLS
   - Credentials visible to network observers
   - **Mitigation:** Deploy server with TLS on port 4190 (implicit TLS) or use STARTTLS-aware client

2. **No Certificate Validation**
   - Cloudflare Workers TCP sockets don't expose TLS verification APIs
   - Man-in-the-middle attacks possible
   - **Mitigation:** Rely on Cloudflare's outbound TLS validation

3. **Script Injection via Malicious Server**
   - If server is compromised, GETSCRIPT could return malicious Sieve scripts
   - Scripts run with user's email privileges (can file to any folder, auto-reply, etc.)
   - **Mitigation:** Validate downloaded scripts before re-uploading

4. **Quota Exhaustion**
   - No client-side quota check before PUTSCRIPT
   - Large scripts may be rejected after upload
   - **Mitigation:** Use HAVESPACE command (not implemented)

5. **Long Script Names (DoS)**
   - No client-side length validation for script names
   - Server may have buffer limits
   - **Mitigation:** Enforce 128-character limit per RFC 5804

---

## Testing Checklist

- [ ] Connect to Dovecot 2.3+ with Pigeonhole plugin
- [ ] Connect to Cyrus IMAP 3.0+ with Sieve support
- [ ] Authenticate with PLAIN over TLS
- [ ] List scripts (empty list, one script, multiple scripts)
- [ ] Upload valid Sieve script (fileinto, reject, vacation)
- [ ] Upload invalid Sieve script (syntax error)
- [ ] Download script (ASCII, UTF-8 with emoji, large script)
- [ ] Activate script (existing script, empty string)
- [ ] Delete script (non-active, active with error)
- [ ] Test response codes (NONEXISTENT, ACTIVE, QUOTA/MAXSIZE)
- [ ] Test timeout behavior (unreachable host, slow server)
- [ ] Test Cloudflare detection (one.one.one.one)
- [ ] Test script name escaping (quotes, backslashes)
- [ ] Test large script (64 KB+)
- [ ] Verify LOGOUT closes connection cleanly

---

## Common Dovecot Configuration

Enable ManageSieve in `/etc/dovecot/dovecot.conf`:
```conf
protocols = imap lmtp sieve

service managesieve-login {
  inet_listener sieve {
    port = 4190
  }
}

service managesieve {
  process_limit = 1024
}

protocol sieve {
  managesieve_max_line_length = 65536
  managesieve_logout_format = bytes=%i/%o
  managesieve_implementation_string = Dovecot Pigeonhole
}

plugin {
  sieve = ~/.dovecot.sieve
  sieve_dir = ~/sieve
  sieve_max_script_size = 1M
  sieve_quota_max_scripts = 10
  sieve_quota_max_storage = 10M
}
```

Restart Dovecot: `systemctl restart dovecot`

---

## Debugging Tips

### 1. Enable Wire-Level Logging (tcpdump)
```bash
# Capture ManageSieve traffic
sudo tcpdump -i any -A -s0 port 4190 -w managesieve.pcap

# Read captured packets
tcpdump -r managesieve.pcap -A | less
```

### 2. Test with sieve-connect (CLI Client)
```bash
# Install: apt install sieve-connect
sieve-connect --server mail.example.com --user alice@example.com
# Interactive prompt:
> list
vacation ACTIVE
spam-filter
> get vacation
require "vacation";
vacation "I'm away";
> quit
```

### 3. Check Dovecot Logs
```bash
tail -f /var/log/dovecot.log | grep managesieve
# Look for auth failures, quota errors, script syntax errors
```

### 4. Test Without Authentication (Telnet)
```bash
telnet mail.example.com 4190
# Server sends capability banner
# Type: LOGOUT
# Server sends: OK "Logout completed"
```

---

## References

- [RFC 5804 - ManageSieve Protocol](https://datatracker.ietf.org/doc/html/rfc5804)
- [RFC 5228 - Sieve Language](https://datatracker.ietf.org/doc/html/rfc5228)
- [RFC 5229 - Sieve Variables Extension](https://datatracker.ietf.org/doc/html/rfc5229)
- [RFC 5230 - Sieve Vacation Extension](https://datatracker.ietf.org/doc/html/rfc5230)
- [RFC 5804 Errata](https://www.rfc-editor.org/errata_search.php?rfc=5804)
- [Dovecot Pigeonhole Sieve](https://doc.dovecot.org/configuration_manual/sieve/)
- [Cyrus IMAP Sieve](https://www.cyrusimap.org/imap/reference/manpages/systemcommands/sievec.html)

---

## Changelog

**2026-02-18:**
- Fixed GETSCRIPT literal parsing to use byte-level slicing instead of character-based iteration
- Added `version` field to capability response (RFC 5804 VERSION capability)
- Added `responseCode` extraction from NO/BYE responses (NONEXISTENT, ACTIVE, QUOTA/*)
- Added Cloudflare detection to `/list` endpoint (was missing)
- Documented 20 known limitations (SCRAM-SHA-1, RENAMESCRIPT, CHECKSCRIPT, NOOP, STARTTLS, etc.)
