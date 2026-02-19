# CVS pserver Protocol — Power-User Reference

**Port:** 2401 (default)
**Transport:** TCP
**Specification:** No RFC. Defined in [CVS Manual, Appendix A: The CVS Client/Server Protocol](https://www.gnu.org/software/trans-coord/manual/cvs/cvs.html#Protocol) and the CVS source code (`src/scramble.c`, `src/client.c`).
**Implementation:** `src/worker/cvs.ts`
**Routes:** `src/worker/index.ts`

## Endpoints

### `POST /api/cvs/connect`

Probe endpoint. Connects to a CVS pserver, sends a dummy auth request with an intentionally invalid repository (`/cvsroot`, user `anonymous`, empty scrambled password `A`), and returns whatever the server responds with. This is a connectivity check, not a real login.

**Request:**

```json
{
  "host": "cvs.example.com",
  "port": 2401
}
```

| Field | Type | Default | Required | Validation |
|---|---|---|---|---|
| `host` | string | -- | yes | Non-empty string |
| `port` | number | `2401` | no | 1-65535 |

**Response (success):**

```json
{
  "success": true,
  "greeting": "I HATE YOU",
  "lines": ["I HATE YOU"],
  "message": "Successfully connected to CVS pserver"
}
```

A response of `I HATE YOU` from connect is normal -- it means the server is alive and speaking the pserver protocol. The dummy credentials are expected to fail.

| Condition | HTTP status | `success` | `error` |
|---|---|---|---|
| Missing `host` | 400 | `false` | `"Host is required"` |
| Invalid port | 400 | `false` | `"Invalid port number"` |
| Cloudflare-proxied host | 403 | `false` | Cloudflare error message |
| No response | 500 | `false` | `"No response from server"` |
| Connection failed | 500 | `false` | Socket error message |

---

### `POST /api/cvs/login`

Authenticates with a CVS repository using the pserver protocol. Sends scrambled credentials, returns whether authentication succeeded.

**Request:**

```json
{
  "host": "cvs.example.com",
  "port": 2401,
  "repository": "/cvsroot",
  "username": "anonymous",
  "password": "anonymous"
}
```

| Field | Type | Default | Required | Validation |
|---|---|---|---|---|
| `host` | string | -- | yes | Non-empty string |
| `port` | number | `2401` | no | 1-65535 |
| `repository` | string | -- | yes | Non-empty string (the CVSROOT path) |
| `username` | string | -- | yes | Non-empty string |
| `password` | string | -- | yes | Non-empty string (cleartext; scrambled before sending) |

**Response (authenticated):**

```json
{
  "success": true,
  "authenticated": true,
  "message": "Authentication successful",
  "response": "I LOVE YOU",
  "lines": ["I LOVE YOU"]
}
```

**Response (rejected):**

```json
{
  "success": true,
  "authenticated": false,
  "message": "Authentication failed",
  "response": "I HATE YOU",
  "lines": ["I HATE YOU"]
}
```

Note: `success: true` with `authenticated: false` means the server was reachable and responded correctly, but the credentials were wrong.

| Condition | HTTP status | `success` | `error` |
|---|---|---|---|
| Auth accepted | 200 | `true` | -- |
| Auth rejected | 200 | `true` | -- (`authenticated: false`) |
| Missing `host` | 400 | `false` | `"Host is required"` |
| Invalid port | 400 | `false` | `"Invalid port number"` |
| Missing `repository` | 400 | `false` | `"Repository path is required"` |
| Missing `username` | 400 | `false` | `"Username is required"` |
| Missing `password` | 400 | `false` | `"Password is required"` |
| Cloudflare-proxied | 403 | `false` | Cloudflare error message |
| Unexpected response | 500 | `false` | `"Unexpected server response"` |
| Connection failed | 500 | `false` | Socket error message |

---

### `POST /api/cvs/list`

Authenticates, then sends CVS protocol commands (`valid-requests`, `version`, `rlog`) to retrieve repository information.

**Request:**

```json
{
  "host": "cvs.example.com",
  "port": 2401,
  "timeout": 15000,
  "username": "anonymous",
  "password": "anonymous",
  "cvsroot": "/cvsroot",
  "module": "myproject"
}
```

| Field | Type | Default | Required | Validation |
|---|---|---|---|---|
| `host` | string | -- | yes | Non-empty string |
| `port` | number | `2401` | no | 1-65535 |
| `timeout` | number | `15000` | no | Milliseconds |
| `username` | string | -- | yes | Non-empty string |
| `password` | string | -- | yes | Non-empty string |
| `cvsroot` | string | -- | yes | Non-empty string |
| `module` | string | `"."` | no | Module path (`.` = root) |

**Response (success):**

```json
{
  "success": true,
  "authenticated": true,
  "validRequests": ["Root", "Valid-responses", "valid-requests", "Directory", "..."],
  "serverVersion": "Concurrent Versions System (CVS) 1.11.23",
  "module": "myproject",
  "rtt": 234,
  "rawLines": ["Valid-requests Root Valid-responses ...", "M Concurrent Versions System ..."]
}
```

---

### `POST /api/cvs/checkout`

Authenticates, then sends a checkout (`co`) command for a named module.

**Request:**

```json
{
  "host": "cvs.example.com",
  "port": 2401,
  "timeout": 20000,
  "username": "anonymous",
  "password": "anonymous",
  "cvsroot": "/cvsroot",
  "module": "myproject"
}
```

| Field | Type | Default | Required | Validation |
|---|---|---|---|---|
| `host` | string | -- | yes | Non-empty string |
| `port` | number | `2401` | no | 1-65535 |
| `timeout` | number | `20000` | no | Milliseconds |
| `username` | string | -- | yes | Non-empty string |
| `password` | string | -- | yes | Non-empty string |
| `cvsroot` | string | -- | yes | Non-empty string |
| `module` | string | `"."` | no | Module name to check out |

**Response (success):**

```json
{
  "success": true,
  "authenticated": true,
  "serverOk": true,
  "module": "myproject",
  "entries": ["Updated myproject/file.c", "Created myproject/README"],
  "modules": ["myproject"],
  "entryCount": 2,
  "rtt": 1523,
  "rawLines": ["..."]
}
```

---

## CVS pserver Protocol Specification

### Authentication Handshake

CVS pserver is a **client-speaks-first** protocol. The server sends no greeting or banner on connect.

```
Client                              Server (port 2401)
  |                                    |
  |------- TCP SYN ------------------>|
  |<------ TCP SYN-ACK --------------|
  |------- TCP ACK ------------------>|
  |                                    |
  |--- "BEGIN AUTH REQUEST\n" ------->|
  |--- "/path/to/cvsroot\n" -------->|
  |--- "username\n" ---------------->|
  |--- "Ascrambled_password\n" ----->|
  |--- "END AUTH REQUEST\n" -------->|
  |                                    |
  |<-- "I LOVE YOU\n" ---------------|    (auth success)
  |    OR                              |
  |<-- "I HATE YOU\n" ---------------|    (auth failure)
```

Key points:
- All lines are terminated with `\n` (LF), **not** `\r\n`.
- The scrambled password line always starts with `A` (version byte) followed by the scrambled characters.
- An empty password scrambles to just `A`.
- `BEGIN VERIFICATION REQUEST` is an alternative that verifies credentials without starting a session.
- After `I LOVE YOU`, the TCP connection remains open for protocol commands.
- After `I HATE YOU`, the server closes the connection.

### CVSROOT Format

The CVSROOT sent during authentication is the **absolute filesystem path** to the repository on the server:

```
/cvsroot
/home/cvs
/usr/local/cvsroot
/var/lib/cvs
```

When used in a full CVSROOT string (e.g., in `$CVSROOT` environment variable or `-d` flag), the format is:

```
:pserver:user@host:/path/to/repo
:pserver:user:password@host:port/path/to/repo
```

But only the path portion (`/path/to/repo`) is sent in the `BEGIN AUTH REQUEST` sequence.

### Password Scrambling Algorithm

CVS uses a trivial substitution cipher defined in `src/scramble.c`. It provides **no security** -- its only purpose is to prevent passwords from being trivially visible in the `~/.cvspass` file.

**Algorithm:**

1. Start the scrambled string with the byte `A` (0x41) as a version indicator.
2. For each byte in the cleartext password, look up its replacement in the 128-entry scramble table.
3. Concatenate all replacement bytes after the `A` prefix.

**The scramble table** (index = cleartext ASCII code, value = scrambled code):

```
  0x00-0x1F: identity (control characters map to themselves)
  0x20 ' ': 0x72 'r'     0x30 '0': 0x6F 'o'     0x40 '@': 0x29 ')'
  0x21 '!': 0x78 'x'     0x31 '1': 0x34 '4'     0x41 'A': 0x39 '9'
  0x22 '"': 0x35 '5'     0x32 '2': 0x4B 'K'     0x42 'B': 0x53 'S'
  0x23 '#': 0x4F 'O'     0x33 '3': 0x77 'w'     0x43 'C': 0x2B '+'
  0x24 '$': 0x60 '`'     0x34 '4': 0x31 '1'     0x44 'D': 0x2E '.'
  0x25 '%': 0x6D 'm'     0x35 '5': 0x22 '"'     0x45 'E': 0x66 'f'
  0x26 '&': 0x48 'H'     0x36 '6': 0x52 'R'     0x46 'F': 0x28 '('
  0x27 "'": 0x6C 'l'     0x37 '7': 0x51 'Q'     0x47 'G': 0x59 'Y'
  0x28 '(': 0x46 'F'     0x38 '8': 0x5F '_'     0x48 'H': 0x26 '&'
  0x29 ')': 0x40 '@'     0x39 '9': 0x41 'A'     0x49 'I': 0x67 'g'
  0x2A '*': 0x4C 'L'     0x3A ':': 0x70 'p'     0x4A 'J': 0x2D '-'
  0x2B '+': 0x43 'C'     0x3B ';': 0x56 'V'     0x4B 'K': 0x32 '2'
  0x2C ',': 0x74 't'     0x3C '<': 0x76 'v'     0x4C 'L': 0x2A '*'
  0x2D '-': 0x4A 'J'     0x3D '=': 0x6E 'n'     0x4D 'M': 0x7B '{'
  0x2E '.': 0x44 'D'     0x3E '>': 0x7A 'z'     0x4E 'N': 0x5B '['
  0x2F '/': 0x57 'W'     0x3F '?': 0x69 'i'     0x4F 'O': 0x23 '#'
  0x50 'P': 0x7D '}'     0x60 '`': 0x24 '$'     0x70 'p': 0x3A ':'
  0x51 'Q': 0x37 '7'     0x61 'a': 0x79 'y'     0x71 'q': 0x71 'q'
  0x52 'R': 0x36 '6'     0x62 'b': 0x75 'u'     0x72 'r': 0x20 ' '
  0x53 'S': 0x42 'B'     0x63 'c': 0x68 'h'     0x73 's': 0x5A 'Z'
  0x54 'T': 0x7C '|'     0x64 'd': 0x65 'e'     0x74 't': 0x2C ','
  0x55 'U': 0x7E '~'     0x65 'e': 0x64 'd'     0x75 'u': 0x62 'b'
  0x56 'V': 0x3B ';'     0x66 'f': 0x45 'E'     0x76 'v': 0x3C '<'
  0x57 'W': 0x2F '/'     0x67 'g': 0x49 'I'     0x77 'w': 0x33 '3'
  0x58 'X': 0x5C '\'     0x68 'h': 0x63 'c'     0x78 'x': 0x21 '!'
  0x59 'Y': 0x47 'G'     0x69 'i': 0x3F '?'     0x79 'y': 0x61 'a'
  0x5A 'Z': 0x73 's'     0x6A 'j': 0x5E '^'     0x7A 'z': 0x3E '>'
  0x5B '[': 0x4E 'N'     0x6B 'k': 0x5D ']'     0x7B '{': 0x4D 'M'
  0x5C '\': 0x58 'X'     0x6C 'l': 0x27 "'"     0x7C '|': 0x54 'T'
  0x5D ']': 0x6B 'k'     0x6D 'm': 0x25 '%'     0x7D '}': 0x50 'P'
  0x5E '^': 0x6A 'j'     0x6E 'n': 0x3D '='     0x7E '~': 0x55 'U'
  0x5F '_': 0x38 '8'     0x6F 'o': 0x30 '0'     0x7F DEL: 0xDF
```

**Example scrambles:**

| Cleartext | Scrambled | Explanation |
|---|---|---|
| (empty) | `A` | Version byte only |
| `anonymous` | `Ay=0=a%0bZ` | Common anon-CVS password |
| `test` | `A,dBZ` | `t`->`,` `e`->`d` `s`->`B` `t`->`Z` ... wait, recheck |

To verify: `t` (0x74) -> 0x2C `,`, `e` (0x65) -> 0x64 `d`, `s` (0x73) -> 0x5A `Z`, `t` (0x74) -> 0x2C `,`. So `test` -> `A,dZ,`.

**Comparison with `~/.cvspass` file format:**

```
/1 :pserver:anonymous@cvs.example.com:2401/cvsroot Ay=0=a%0bZ
```

The `.cvspass` file stores: `/1` (version), the full CVSROOT spec, then the scrambled password.

### Post-Authentication Protocol Commands

After `I LOVE YOU`, the connection enters "protocol mode." The client sends requests and commands, and the server responds. All lines are `\n`-terminated.

#### Requests (client to server)

Requests configure the session state. They do not trigger immediate responses (except `valid-requests`).

| Request | Format | Description |
|---|---|---|
| `Root` | `Root /path/to/cvsroot\n` | Declare the repository root. Must be sent first. |
| `Valid-responses` | `Valid-responses resp1 resp2 ...\n` | Tell the server which response types the client supports. |
| `valid-requests` | `valid-requests\n` | Ask the server to list all requests it supports. Server responds with `Valid-requests req1 req2 ...\n` followed by `ok\n`. |
| `Directory` | `Directory local-dir\nrepository\n` | Two-line request. Sets the working directory context. `local-dir` is the client-side path (`.` for root), `repository` is the absolute server-side path. |
| `Argument` | `Argument value\n` | Append a command-line argument. Multiple `Argument` lines can be sent. They accumulate and are consumed by the next command. |
| `Argumentx` | `Argumentx continuation\n` | Append to the previous `Argument` (for long arguments that span lines). |
| `UseUnchanged` | `UseUnchanged\n` | Tell the server to use the "unchanged" protocol for file transfers. |
| `Global_option` | `Global_option -q\n` | Set a global option (e.g., `-q` for quiet). |
| `Set` | `Set VAR=VALUE\n` | Set an environment variable for the server. |

#### Commands (client to server)

Commands trigger server processing and generate responses. They consume any accumulated `Argument` lines.

| Command | Description |
|---|---|
| `co` | Checkout (export files from repository). Arguments: module name, flags like `-N`. |
| `rlog` | Remote log (list revision history). Arguments: module/file paths. |
| `version` | Request server version string. |
| `rdiff` | Remote diff between revisions. |
| `update` | Update working copy. |
| `ci` | Commit changes. |
| `diff` | Show differences. |
| `status` | Show file status. |
| `log` | Show revision log (requires `Directory` context). |
| `tag` | Tag revisions. |
| `admin` | Repository administration. |
| `annotate` | Annotate lines with revision info. |
| `rannotate` | Remote annotate (no working copy needed). |
| `editors` | Show who is editing files. |
| `watchers` | Show who is watching files. |

#### Responses (server to client)

| Response | Format | Description |
|---|---|---|
| `ok` | `ok\n` | Command completed successfully. |
| `error` | `error [message]\n` | Command failed. Optional error message follows. |
| `Valid-requests` | `Valid-requests req1 req2 ...\n` | Response to `valid-requests`. Space-separated list. **No colon** after `Valid-requests`. |
| `M` | `M text\n` | Message text (stdout). |
| `E` | `E text\n` | Error text (stderr). |
| `MT` | `MT tag [text]\n` | Tagged text (structured output). |
| `F` | `F\n` | Flush output. |
| `Updated` | `Updated pathname/\n` | File has been updated. Followed by file metadata and content. |
| `Created` | `Created pathname/\n` | New file created. Followed by file metadata and content. |
| `Merged` | `Merged pathname/\n` | File merged. Followed by file metadata and content. |
| `Checked-in` | `Checked-in pathname/\n` | File checked in successfully. |
| `Removed` | `Removed pathname/\n` | File removed. |
| `Module-expansion` | `Module-expansion dir\n` | Expanded module name. |
| `Mod-time` | `Mod-time time\n` | File modification time. |
| `Mode` | `Mode mode\n` | File permissions (e.g., `u=rw,g=r,o=r`). |
| `Set-sticky` | `Set-sticky dir/\nspec\n` | Set sticky tag/date. |
| `Clear-sticky` | `Clear-sticky dir/\n` | Clear sticky tag. |

### Typical Session Transcript

```
Client                              Server (port 2401)
  |                                    |
  |--- BEGIN AUTH REQUEST\n ---------->|
  |--- /cvsroot\n ------------------->|
  |--- anonymous\n ------------------>|
  |--- Ay=0=a%0bZ\n ---------------->|
  |--- END AUTH REQUEST\n ----------->|
  |                                    |
  |<-- I LOVE YOU\n -----------------|
  |                                    |
  |--- Root /cvsroot\n -------------->|
  |--- Valid-responses ok error ...\n>|
  |--- valid-requests\n ------------->|
  |                                    |
  |<-- Valid-requests Root ... co\n --|
  |<-- ok\n --------------------------|
  |                                    |
  |--- version\n -------------------->|
  |                                    |
  |<-- M Concurrent Versions ...\n --|
  |<-- ok\n --------------------------|
  |                                    |
  |--- Argument myproject\n --------->|
  |--- rlog\n ----------------------->|
  |                                    |
  |<-- M (rlog output) --------------|
  |<-- ok\n    OR    error msg\n -----|
```

## Curl Examples

```bash
# Probe a CVS pserver for connectivity
curl -X POST https://portofcall.example/api/cvs/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"cvs.savannah.gnu.org","port":2401}'

# Authenticate with a CVS repository
curl -X POST https://portofcall.example/api/cvs/login \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"cvs.savannah.gnu.org",
    "port":2401,
    "repository":"/sources/emacs",
    "username":"anonymous",
    "password":"anonymous"
  }'

# List repository info (after auth)
curl -X POST https://portofcall.example/api/cvs/list \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"cvs.savannah.gnu.org",
    "port":2401,
    "username":"anonymous",
    "password":"anonymous",
    "cvsroot":"/sources/emacs",
    "module":"."
  }'

# Checkout a module
curl -X POST https://portofcall.example/api/cvs/checkout \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"cvs.savannah.gnu.org",
    "port":2401,
    "username":"anonymous",
    "password":"anonymous",
    "cvsroot":"/sources/emacs",
    "module":"emacs"
  }'
```

## Known Quirks and Limitations

### 1. Connect probe sends real auth request

The `/api/cvs/connect` endpoint sends a full `BEGIN AUTH REQUEST ... END AUTH REQUEST` sequence with dummy credentials (`anonymous` / empty password against `/cvsroot`). This means the server processes it as a real login attempt. Some servers may rate-limit or log failed authentication attempts.

### 2. Writer closed before reading in connect handler

In `handleCVSConnect`, the writer is closed (`writer.close()`) immediately after sending the auth request. This sends a TCP half-close (FIN), which signals to the server that no more data will be sent. The server then sends its response and closes. This is correct behavior for a probe, but means the connection cannot be reused for further commands.

### 3. Password is required but can be empty-string in protocol

The login and list endpoints require a non-empty `password` field in the JSON request. However, the CVS protocol supports empty passwords -- the scrambled form is just `A`. If you need to authenticate with an empty password, the API will reject it with HTTP 400.

### 4. No TLS support

CVS pserver has no native TLS. The protocol sends scrambled (not encrypted) passwords over plaintext TCP. Some CVS servers support tunneling through SSH (`ext` method) or stunnel, but this implementation only supports direct pserver connections.

### 5. Timeout shared across authentication and commands

The `timeout` parameter in list and checkout endpoints is shared between the authentication phase and the command phase. If authentication takes a long time (slow network, slow server), less time remains for the actual command output. The auth phase is capped at `min(timeout, 8000)` ms.

### 6. Binary file content not parsed

The `Updated` and `Created` responses include binary file content (length-prefixed). The current implementation treats all response lines as text and does not parse the binary payload format. File contents are not extracted or returned -- only the response line headers are captured.

### 7. No `UseUnchanged` request sent

Modern CVS servers (1.12+) expect the client to send `UseUnchanged` before certain operations. The implementation does not send this request, which may cause issues with some servers for `co` and `update` commands.

### 8. `readLines` stops at 3 lines

The `readLines()` helper (used for auth responses) stops reading after 3 lines. This is fine for `I LOVE YOU\n` or `I HATE YOU\n`, but if the server sends a multi-line error message before the auth response, some lines may be captured as part of the auth response.

### 9. No `Gzip-stream` compression support

The CVS protocol supports gzip compression via the `Gzip-stream` request. This implementation does not negotiate or handle compressed streams. Large repository listings may be slow over high-latency connections.

## Testing

### Known Public CVS Servers

Most public CVS servers have been decommissioned. Some that may still be available:

```bash
# GNU Savannah (may still run CVS)
cvs -d :pserver:anonymous@cvs.savannah.gnu.org:/sources/emacs login

# OpenBSD (anoncvs)
cvs -d :pserver:anoncvs@anoncvs.openbsd.org:/cvs login
```

### Local CVS Server for Testing

```bash
# Install CVS
sudo apt install cvs  # Debian/Ubuntu
brew install cvs       # macOS

# Create a test repository
mkdir -p /tmp/cvsroot
cvs -d /tmp/cvsroot init

# Start pserver (via inetd or xinetd)
# Or use socat for quick testing:
socat TCP-LISTEN:2401,reuseaddr,fork EXEC:'cvs --allow-root=/tmp/cvsroot pserver'

# Create a test module
mkdir /tmp/testmodule && cd /tmp/testmodule
echo "hello" > README
cvs -d /tmp/cvsroot import -m "initial" testmodule vendor start

# Test connectivity
curl -X POST http://localhost:8787/api/cvs/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","port":2401}'
```

### Direct Protocol Testing with Netcat

```bash
# Manual pserver auth test
printf 'BEGIN AUTH REQUEST\n/tmp/cvsroot\nanonymous\nA\nEND AUTH REQUEST\n' | nc localhost 2401
# Expected: "I LOVE YOU" or "I HATE YOU"
```

## References

- [CVS Manual: The CVS Client/Server Protocol](https://www.gnu.org/software/trans-coord/manual/cvs/cvs.html#Protocol)
- [CVS Source Code (scramble.c)](https://cvs.nongnu.org/source/src/scramble.c)
- [CVS Source Code (client.c)](https://cvs.nongnu.org/source/src/client.c)
- [Wikipedia: Concurrent Versions System](https://en.wikipedia.org/wiki/Concurrent_Versions_System)
