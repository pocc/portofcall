# WinRM (Windows Remote Management) — Power User Reference

> Port of Call implementation: [`src/worker/winrm.ts`](../../src/worker/winrm.ts)

## Endpoints

| # | Route | Method | Handler | Default Port | Timeout | Auth Required | Description |
|---|-------|--------|---------|-------------|---------|---------------|-------------|
| 1 | `/api/winrm/identify` | POST | `handleWinRMIdentify` | 5985 | 10 s | No | WSMAN Identify probe (anonymous) |
| 2 | `/api/winrm/auth` | POST | `handleWinRMAuth` | 5985 | 10 s | No | Auth method detection via 401 |
| 3 | `/api/winrm/exec` | POST | `handleWinRMExec` | 5985 | 30 s | Yes (Basic) | Remote command execution |

All three endpoints enforce POST (`request.method !== 'POST'` → HTTP 405). This is one of the few protocols in Port of Call that properly method-restricts.

Cloudflare detection: `/identify` and `/auth` only. `/exec` does **not** check — it uses `fetch()` instead of raw sockets.

---

## Transport

### `/identify` and `/auth` — Raw TCP sockets

These use `sendHttpRequest()`, a hand-rolled HTTP/1.1 client over Cloudflare `connect()` sockets:

- Sends `Connection: close` on every request
- Parses status line with regex: `/HTTP\/\d\.\d\s+(\d+)/`
- Lowercases all response header names
- Supports chunked transfer-encoding via `decodeChunked()` (string-based; see caveats below)
- Response body cap: **500 KB** (`maxSize = 512000`) — reads stop silently at this limit
- User-Agent: `PortOfCall/1.0`
- Always sends `Content-Type: application/soap+xml;charset=UTF-8` when body is present

### `/exec` — Cloudflare `fetch()`

Uses the Workers `fetch()` API with Basic auth:

- Sends `Authorization: Basic ${btoa(username + ':' + password)}`
- No Connection: close (fetch handles connection lifecycle)
- `AbortController` for timeout
- Sends to `http://${host}:${port}/wsman` (always HTTP, never HTTPS)
- Each of the 4+ round-trips in the exec flow is a separate `fetch()` call

---

## Endpoint Details

### 1. `/api/winrm/identify`

Sends an anonymous WSMAN Identify SOAP envelope. This is the only WS-Management operation that doesn't require authentication (per DMTF DSP0226).

**Request:**
```json
{ "host": "windows-server.example.com", "port": 5985, "timeout": 10000 }
```

**Probe sequence:**

1. POST `/wsman-anon/identify` with SOAP Identify envelope
2. If HTTP 200 → parse `ProductVendor`, `ProductVersion`, `ProtocolVersion`, `SecurityProfilName`/`SecurityProfile` from XML
3. If HTTP 401 → `isWinRM: true`, extract auth methods from `WWW-Authenticate`, then make a **second** request to POST `/wsman` to collect additional auth methods
4. If HTTP 404 → fallback: POST `/wsman` with same envelope, then re-evaluate (200/401/other)
5. Anything else → `isWinRM: false`

**Response (200 OK from server):**
```json
{
  "success": true,
  "rtt": 85,
  "server": "Microsoft-HTTPAPI/2.0",
  "isWinRM": true,
  "productVendor": "Microsoft Corporation",
  "productVersion": "OS: 10.0.20348 SP: 0.0 Stack: 3.0",
  "protocolVersion": "http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd",
  "securityProfiles": [
    "http://schemas.dmtf.org/wbem/wsman/1/wsman/secprofile/http/basic",
    "http://schemas.dmtf.org/wbem/wsman/1/wsman/secprofile/http/spnego-kerberos"
  ],
  "statusCode": 200
}
```

**Response (401 from server — still `success: true`):**
```json
{
  "success": true,
  "rtt": 42,
  "server": "Microsoft-HTTPAPI/2.0",
  "isWinRM": true,
  "authMethods": ["Negotiate", "Basic"],
  "statusCode": 401
}
```

**Quirks:**

- **`SecurityProfilName` is not a typo** — The WS-Management Identity schema defines the tag as `SecurityProfilName` (missing 'e'). The code also tries `SecurityProfile` as a fallback for non-Microsoft implementations.

- **Duplicate Content-Type** — `sendHttpRequest` adds `Content-Type: application/soap+xml;charset=UTF-8` from the body-present branch, **and** `/identify` passes the same header explicitly. The explicit header wins (appears later in the HTTP request), so no harm done, but it's redundant.

- **401 triggers two TCP connections** — When `/wsman-anon/identify` returns 401, the handler opens a second TCP connection to `/wsman` to collect any additional auth methods. Both connections are sequential, so worst-case latency is 2× timeout.

- **404 triggers two TCP connections** — Same pattern: if `/wsman-anon/identify` returns 404, retries against `/wsman`.

- **`isWinRM` detection** — Set to `true` if either `productVendor` or `productVersion` is present (200 case), or if the status is 401 (auth-required = WinRM). Any other status returns `isWinRM: false`.

- **HTTP status code in API response** — Returns HTTP 400 for Cloudflare detection. For connection errors, returns HTTP 200 with `success: false`. For successful probes (even 401), returns HTTP 200.

---

### 2. `/api/winrm/auth`

Lightweight auth-method probe. Sends a plain HTTP GET (no SOAP body) to `/wsman` to trigger a 401 response and inspect `WWW-Authenticate`.

**Request:**
```json
{ "host": "windows-server.example.com", "port": 5985, "timeout": 10000 }
```

**Wire exchange:**
```
→ GET /wsman HTTP/1.1
  Host: windows-server.example.com:5985
  Connection: close
  User-Agent: PortOfCall/1.0

← HTTP/1.1 401 Unauthorized
  WWW-Authenticate: Negotiate, Basic realm="WSMAN"
  Server: Microsoft-HTTPAPI/2.0
```

**Response:**
```json
{
  "success": true,
  "rtt": 28,
  "statusCode": 401,
  "server": "Microsoft-HTTPAPI/2.0",
  "authMethods": ["Negotiate", "Basic"],
  "requiresAuth": true,
  "isWinRM": true
}
```

**Quirks:**

- **Uses GET, not POST** — Unlike `/identify` which sends a SOAP envelope via POST, `/auth` sends a bare GET. Some WinRM configurations may respond differently to GET vs POST.

- **`isWinRM` is loose** — Returns `true` for status 401 **or** 200. Any HTTP server returning 401 on `/wsman` would be classified as WinRM.

- **`requiresAuth`** — Only `true` when status is exactly 401. If the server returns 200 (anonymous access enabled), `requiresAuth: false` but `isWinRM: true`.

- **Single request only** — Unlike `/identify`, does NOT retry against `/wsman-anon/identify` or fall back on 404.

- **`authMethods` parsing** — Splits `WWW-Authenticate` on commas, then takes the first whitespace-delimited token from each part. `"Negotiate, Basic realm=\"WSMAN\""` → `["Negotiate", "Basic"]`. Does not parse challenge parameters (realms, domains).

---

### 3. `/api/winrm/exec`

Full command execution over WS-Man. Performs a 4-step SOAP flow: Create Shell → Execute Command → Receive Output → Signal + Delete Shell.

**Request:**
```json
{
  "host": "windows-server.example.com",
  "port": 5985,
  "timeout": 30000,
  "username": "Administrator",
  "password": "P@ssw0rd",
  "command": "ipconfig",
  "args": ["/all"]
}
```

**SOAP flow (4 round-trips minimum):**

```
Step 1: Create Shell
→ POST /wsman  [Basic auth]
  Action: http://schemas.xmlsoap.org/ws/2004/09/transfer/Create
  ResourceURI: .../windows/shell/cmd
  Options: WINRS_NOPROFILE=TRUE, WINRS_CODEPAGE=437
← 200 OK  →  parse <rsp:ShellId>

Step 2: Execute Command
→ POST /wsman  [Basic auth]
  Action: .../windows/shell/Command
  SelectorSet: ShellId={shellId}
  Options: WINRS_CONSOLEMODE_STDIN=TRUE, WINRS_SKIP_CMD_SHELL=FALSE
  Body: <rsp:CommandLine><rsp:Command>ipconfig</rsp:Command><rsp:Arguments>/all</rsp:Arguments></rsp:CommandLine>
← 200 OK  →  parse <rsp:CommandId>

Step 3: Receive Output (loop)
→ POST /wsman  [Basic auth]
  Action: .../windows/shell/Receive
  Body: <rsp:DesiredStream CommandId="{commandId}">stdout stderr</rsp:DesiredStream>
← 200 OK  →  parse base64 <rsp:Stream Name="stdout"> and <rsp:Stream Name="stderr">
← ...repeat until CommandState=Done or timeout

Step 4: Cleanup (best-effort, errors ignored)
→ POST /wsman  Signal ctrl_c
→ POST /wsman  Delete Shell
```

**Response:**
```json
{
  "success": true,
  "shellId": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
  "commandId": "12345678-ABCD-EF01-2345-678901234567",
  "stdout": "Windows IP Configuration\r\n\r\n   Host Name . . . : WIN-SERVER\r\n...",
  "stderr": "",
  "exitCode": 0,
  "rtt": 1250
}
```

**Quirks and limitations:**

- **Basic auth only** — Despite the doc overview mentioning Negotiate/Kerberos/CredSSP, `/exec` only implements Basic (`btoa(username:password)`). Negotiate requires NTLM/Kerberos token exchange which is not implemented. Most production WinRM setups require `winrm set winrm/config/service/auth @{Basic="true"}` and `winrm set winrm/config/service @{AllowUnencrypted="true"}` for this endpoint to work.

- **HTTP only, no HTTPS** — The `fetch()` call hardcodes `http://` (line 532). Port 5986 (HTTPS) targets will fail. Credentials are sent in cleartext Base64 over the wire.

- **XML injection in command/args** — The `command` and `args` values are interpolated directly into SOAP XML without escaping (lines 455–456). Characters like `<`, `>`, `&`, `"` in command names or arguments will produce malformed XML and likely cause a server-side parse error.

- **WINRS_CODEPAGE=437** — Hardcoded to OEM US codepage (line 432). Non-ASCII output from the Windows command may be garbled. Windows Server returns base64-encoded output in this codepage.

- **WINRS_NOPROFILE=TRUE** — User profile is not loaded (line 432). Environment variables from the user profile (like custom PATH entries) won't be available.

- **WINRS_SKIP_CMD_SHELL=FALSE** — Command runs inside `cmd.exe`. The `command` field is passed to `cmd.exe /c {command}`. To run PowerShell, use `command: "powershell.exe"` with `args: ["-Command", "Get-Process"]`.

- **Receive loop timeout arithmetic** — `receiveDeadline = startTime + timeout - 2000` (line 741). The 2-second headroom is reserved for the Signal + Delete cleanup. If the command takes longer than `timeout - 2s` to produce output, the loop exits early with whatever output was collected. The cleanup steps each get their own 5-second timeout.

- **MaxEnvelopeSize=153600** — All SOAP envelopes declare a 150 KB max. If the server's response exceeds this, it should fragment into multiple Receive responses. The receive loop handles this by looping until `CommandState=Done`.

- **base64 output decoding** — `atob()` is used to decode stdout/stderr stream segments (line 563). If decoding fails, the raw base64 string is used as-is. `atob()` only handles Latin-1; multi-byte UTF-8 output encoded in base64 will decode incorrectly (UTF-8 bytes interpreted as Latin-1 codepoints).

- **UUID generation** — Uses `Math.random()` (line 415), not `crypto.getRandomValues()`. UUIDs are used only for WS-Addressing `MessageID` headers, so predictability is not a security concern, but the generated UUIDs don't fully conform to RFC 4122 (the variant bits are approximately correct but not guaranteed).

- **Cleanup is best-effort** — Signal (ctrl_c) and Delete Shell are wrapped in try/catch with empty handlers (lines 764, 769). If the server is unreachable, the shell may remain open on the Windows side until it times out (default WinRM idle timeout: 15 minutes).

- **Auth failure returns HTTP 200** — A 401 from the WinRM server is wrapped in `{ success: false, error: "Authentication failed (401 Unauthorized)", statusCode: 401 }` but the API response itself is HTTP 200.

- **No Cloudflare detection** — Unlike `/identify` and `/auth`, the `/exec` endpoint does not call `checkIfCloudflare()` before connecting.

---

## Cross-Endpoint Comparison

| | `/identify` | `/auth` | `/exec` |
|---|---|---|---|
| Default port | 5985 | 5985 | 5985 |
| Default timeout | 10 s | 10 s | 30 s |
| Transport | Raw TCP socket | Raw TCP socket | `fetch()` API |
| HTTP method sent | POST (SOAP) | GET (bare) | POST (SOAP) |
| Auth required | No | No | Yes (Basic) |
| Cloudflare check | Yes | Yes | **No** |
| Method restriction | POST only (405) | POST only (405) | POST only (405) |
| Port validation | 1–65535 | 1–65535 | 1–65535 |
| Host validation | Truthy check | Truthy check | Truthy check |
| Fallback paths | `/wsman-anon/identify` → `/wsman` | `/wsman` only | `/wsman` only |
| TCP connections | 1 or 2 | 1 | 4+ (per SOAP step) |
| Response body cap | 500 KB | 500 KB | None (fetch) |

---

## SOAP Envelope Structure

All envelopes use SOAP 1.2 (`http://www.w3.org/2003/05/soap-envelope`) with WS-Addressing and WS-Man namespaces:

```
s:    = http://www.w3.org/2003/05/soap-envelope
wsa:  = http://schemas.xmlsoap.org/ws/2004/08/addressing
wsman: = http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd
wsmid: = http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd
rsp:  = http://schemas.microsoft.com/wbem/wsman/1/windows/shell
```

Key fields in all `/exec` envelopes:
- `wsa:To` — `http://{host}:{port}/wsman`
- `wsman:ResourceURI` — `http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd`
- `wsa:ReplyTo` — `http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous`
- `wsman:MaxEnvelopeSize` — 153600 (150 KB)
- `wsa:MessageID` — `uuid:{random}` (Math.random-based)
- `wsman:OperationTimeout` — PT60S (hardcoded, not tied to the API `timeout` parameter)

---

## XML Parsing

All XML parsing uses regex — no DOM parser:

| Function | Pattern | Used by |
|----------|---------|---------|
| `extractXmlValue(xml, tag)` | `<(?:[\w-]+:)?{tag}[^>]*>([^<]+)</...>` | `/identify` — ProductVendor, ProductVersion, ProtocolVersion |
| `extractXmlValues(xml, tag)` | Same pattern, global flag | `/identify` — SecurityProfilName/SecurityProfile |
| `decodeReceiveStreams(xml)` | `<rsp:Stream[^>]*Name="stdout"[^>]*>([^<]*)</rsp:Stream>` | `/exec` — stdout, stderr, CommandState, ExitCode |
| ShellId parse | `<rsp:ShellId>([^<]+)</rsp:ShellId>` | `/exec` step 1 |
| CommandId parse | `<rsp:CommandId>([^<]+)</rsp:CommandId>` | `/exec` step 2 |

**Limitations of regex parsing:**
- CDATA sections are not handled — `<![CDATA[...]]>` content would be missed
- Nested elements with same name would only match innermost
- XML comments inside elements could pollute extracted values
- Multi-line tag content (unlikely in WS-Man responses) would not match (`[^<]+` doesn't cross lines unless content lacks newlines)

---

## Chunked Transfer-Encoding

`decodeChunked()` operates on strings, not bytes:

1. Finds `\r\n` to locate chunk size line
2. Parses hex chunk size via `parseInt(sizeStr, 16)`
3. Extracts `chunkSize` characters (not bytes) from the string
4. Advances past `\r\n` after chunk data

**Bug: character vs byte mismatch** — Chunked TE chunk sizes are in bytes, but the decoder operates on a JavaScript string (UTF-16 code units). Multi-byte UTF-8 sequences (accented characters, CJK, emoji) occupy fewer string characters than their byte count. The decoder would read too few characters and lose sync. In practice, WinRM responses are typically ASCII XML, so this rarely triggers.

---

## Known Limitations

1. **Basic auth only** — Negotiate/NTLM/Kerberos/CredSSP not implemented for `/exec`
2. **HTTP only** — No HTTPS/TLS; credentials sent in cleartext Base64
3. **XML injection** — Command and arguments not XML-escaped
4. **OEM codepage 437** — Non-ASCII output may be garbled
5. **atob() Latin-1** — UTF-8 encoded base64 output decoded incorrectly
6. **No user profile** — WINRS_NOPROFILE=TRUE; custom PATH etc. unavailable
7. **OperationTimeout mismatch** — SOAP envelope says PT60S regardless of API `timeout` parameter
8. **No WinRM shell cleanup guarantee** — Network errors during cleanup leave shells open
9. **500 KB response cap** — Only applies to `/identify` and `/auth` (raw socket path)
10. **Chunked TE byte/char mismatch** — Multi-byte UTF-8 responses could desync the chunk decoder
11. **No Cloudflare detection on `/exec`** — Fetch-based path skips the CF check
12. **Math.random() UUIDs** — Not cryptographically random (harmless for MessageID but technically non-conformant)

---

## curl Examples

**Identify a WinRM server:**
```bash
curl -s https://portofcall.example.com/api/winrm/identify \
  -H 'Content-Type: application/json' \
  -d '{"host":"windows-server.example.com"}' | jq
```

**Detect auth methods:**
```bash
curl -s https://portofcall.example.com/api/winrm/auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"windows-server.example.com"}' | jq '.authMethods'
```

**Execute a command:**
```bash
curl -s https://portofcall.example.com/api/winrm/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "windows-server.example.com",
    "username": "Administrator",
    "password": "P@ssw0rd",
    "command": "hostname"
  }' | jq '{stdout,stderr,exitCode}'
```

**Execute PowerShell:**
```bash
curl -s https://portofcall.example.com/api/winrm/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "windows-server.example.com",
    "username": "Administrator",
    "password": "P@ssw0rd",
    "command": "powershell.exe",
    "args": ["-Command", "Get-Service | Where-Object {$_.Status -eq \"Running\"} | Select-Object -First 5 Name,Status"]
  }' | jq
```

**Probe with custom port and timeout:**
```bash
curl -s https://portofcall.example.com/api/winrm/identify \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.50","port":5986,"timeout":5000}' | jq
```

---

## Local Testing

Enable WinRM on a Windows machine (PowerShell as Administrator):

```powershell
# Enable WinRM with HTTP listener
Enable-PSRemoting -Force

# Allow Basic auth (required for /exec)
winrm set winrm/config/service/auth @{Basic="true"}

# Allow unencrypted (required since Port of Call uses HTTP)
winrm set winrm/config/service @{AllowUnencrypted="true"}

# Verify listener
winrm enumerate winrm/config/listener

# Test locally
winrm identify -r:http://localhost:5985/wsman-anon/identify
```

Then from Port of Call's local dev server:
```bash
# Identify
curl -s localhost:8787/api/winrm/identify \
  -d '{"host":"192.168.1.100"}' | jq

# Auth probe
curl -s localhost:8787/api/winrm/auth \
  -d '{"host":"192.168.1.100"}' | jq

# Execute command
curl -s localhost:8787/api/winrm/exec \
  -d '{"host":"192.168.1.100","username":"Admin","password":"pass","command":"whoami"}' | jq
```

For Docker-based testing, use a Windows Server container:
```powershell
docker run -d -p 5985:5985 mcr.microsoft.com/windows/servercore:ltsc2022
# Then configure WinRM inside the container
```
