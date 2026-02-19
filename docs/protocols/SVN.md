# SVN (Subversion) Protocol — Power User Guide

## Protocol Overview

**Port**: 3690 (TCP)
**Service**: `svnserve` (native Subversion protocol)
**Encoding**: S-expression-based wire format
**RFC/Spec**: Apache Subversion `libsvn_ra_svn` protocol specification

Subversion's native protocol (`svnserve`) uses a custom S-expression-based wire format for repository access. Unlike HTTP-based SVN (which uses WebDAV/DeltaV), the native protocol provides a lightweight, stateful connection optimized for version control operations.

## Protocol Architecture

### S-Expression Format

The protocol uses parenthesized lists similar to Lisp S-expressions:

```
( success ( 2 2 ( edit-pipeline svndiff1 ) ( ANONYMOUS ) ) )
```

**Core Elements**:
- **Words**: Identifiers (e.g., `success`, `failure`, `ANONYMOUS`)
- **Numbers**: Integers (e.g., `2`, `42`)
- **Strings**: Length-prefixed binary data: `<len>:<data> ` (note mandatory trailing space)
- **Lists**: Parenthesized groups `( item1 item2 ... )`

**Whitespace Rule**: All elements must be terminated with whitespace (space, tab, or newline).

### Data Types

| Type | Format | Example |
|------|--------|---------|
| Word | Alphanumeric identifier | `success` |
| Number | Decimal integer | `42` |
| String | `<len>:<data> ` | `11:hello world ` |
| List | `( ... )` | `( edit-pipeline svndiff1 )` |
| Bool | Word | `true` or `false` |

### Protocol Phases

1. **Connection Establishment** — Server sends greeting, client responds
2. **Authentication** — SASL-based mechanism negotiation
3. **Repository Access** — Command/response cycles
4. **Session Termination** — Client closes connection

## Connection Flow

### Phase 1: Server Greeting

Server immediately sends greeting upon TCP connection:

```
( success ( <minver>:number <maxver>:number ( <cap>:word ... ) ( <mech>:word ... ) ) )
```

**Example**:
```
( success ( 2 2 ( edit-pipeline svndiff1 absent-entries ) ( ANONYMOUS CRAM-MD5 ) ) )
```

**Fields**:
- `minver`/`maxver`: Protocol version range (typically `2 2`)
- Capabilities list: Server features (e.g., `edit-pipeline`, `svndiff1`)
- Mechanisms list: Supported auth methods (e.g., `ANONYMOUS`, `CRAM-MD5`, `PLAIN`)

### Phase 2: Client Greeting

Client responds with version selection and repository URL:

```
( <version>:number ( <cap>:word ... ) ( <url>:string ) )
```

**Example**:
```
( 2 ( edit-pipeline svndiff1 ) ( 23:svn://example.com/repo ) )
```

**Fields**:
- `version`: Selected protocol version (must be in server's `minver`-`maxver` range)
- Capabilities: Client feature set
- URL: Repository path as counted string

### Phase 3: Authentication Challenge

Server responds with repository info and auth challenge:

```
( success ( <repos-url>:string ( <cap>:word ... ) ) )
( ( <mech>:word ... ) <realm>:string )
```

**Example**:
```
( success ( 23:svn://example.com/repo ( edit-pipeline ) ) )
( ( ANONYMOUS PLAIN ) 13:My SVN Realm )
```

### Phase 4: Authentication Response

Client selects mechanism and provides credentials:

```
( <mechanism>:word ( <token>:string ) )
```

**Examples**:

**ANONYMOUS**:
```
( ANONYMOUS ( 0: ) )
```

**PLAIN** (username:password):
```
( PLAIN ( 13:alice:hunter2 ) )
```

**CRAM-MD5** (challenge-response):
```
( CRAM-MD5 ( 32:alice <challenge-response-hash> ) )
```

### Phase 5: Authentication Result

Server responds with success or failure:

**Success**:
```
( success ( ) )
```

**Failure**:
```
( failure ( ( <code>:number <message>:string <file>:string <line>:number ) ) )
```

## Common Commands

### Repository Information

**get-repos-root** — Get repository root URL:
```
Request:  ( get-repos-root ( ) )
Response: ( success ( <root-url>:string ) )
```

**get-latest-rev** — Get latest revision number:
```
Request:  ( get-latest-rev ( ) )
Response: ( success ( <rev>:number ) )
```

### Directory Operations

**get-dir** — List directory contents:
```
Request:  ( get-dir ( <path>:string ( <rev>:number ) ( <want-props>:bool <want-contents>:bool ) ) )
Response: ( success ( ( <rev>:number ) <props>:proplist ( ( <entry>:dirent ... ) ) ) )
```

**dirent structure**:
```
( <name>:string <kind>:word <size>:number <has-props>:bool <created-rev>:number [ <created-date>:string <last-author>:string ] )
```

**Example**:
```
Request:  ( get-dir ( 0: ( HEAD ) ( false true ) ) )
Response: ( success ( ( 42 ) ( ) ( ( 8:README.md file 1234 false 41 ) ( 4:src/ dir 0 false 38 ) ) ) )
```

### File Operations

**stat** — Get file/directory metadata:
```
Request:  ( stat ( <path>:string ( <rev>:number ) ) )
Response: ( success ( ( <kind>:word <size>:number <has-props>:bool <created-rev>:number <created-date>:string <last-author>:string ) ) )
```

**check-path** — Check if path exists:
```
Request:  ( check-path ( <path>:string ( <rev>:number ) ) )
Response: ( success ( <kind>:word ) )
```

Node kinds: `none`, `file`, `dir`, `unknown`

### Session Management

**reparent** — Change repository URL within session:
```
Request:  ( reparent ( <url>:string ) )
Response: ( success ( ) )
```

## Authentication Mechanisms

### ANONYMOUS

No credentials required. Send empty token:
```
( ANONYMOUS ( 0: ) )
```

### PLAIN

Username and password as colon-separated string:
```
( PLAIN ( <len>:<username>:<password> ) )
```

**Security**: Credentials sent in cleartext — use only over TLS or trusted networks.

### CRAM-MD5

Challenge-response HMAC-MD5:

1. Server sends challenge in auth response
2. Client computes HMAC-MD5 of challenge using password
3. Client sends username and hex-encoded digest:
   ```
   ( CRAM-MD5 ( <len>:<username> <digest> ) )
   ```

### EXTERNAL

Relies on external authentication (e.g., SSH tunnel, TLS client cert):
```
( EXTERNAL ( 0: ) )
```

## Capabilities

### Server Capabilities

| Capability | Description |
|------------|-------------|
| `edit-pipeline` | Server supports pipelined editor commands |
| `svndiff1` | Server supports svndiff1 delta compression |
| `absent-entries` | Server can mark entries as absent |
| `commit-revprops` | Client can set revision properties during commit |
| `mergeinfo` | Server supports merge tracking |
| `depth` | Server supports sparse checkouts |
| `log-revprops` | `log` command accepts revision property filters |
| `atomic-revprops` | Revision property changes are atomic |
| `partial-replay` | Server supports partial replay |

### Client Capabilities

Advertised in client greeting to inform server of supported features:
- `edit-pipeline`
- `svndiff1`
- `accepts-svndiff2`
- `accepts-svndiff3`

## Error Handling

### Failure Response Format

```
( failure ( ( <code>:number <message>:string <file>:string <line>:number ) ) )
```

**Example**:
```
( failure ( ( 170001 35:Authentication required for realm ) 0: 0 ) )
```

### Common Error Codes

| Code | Meaning |
|------|---------|
| `170001` | Authorization failed |
| `170002` | No authentication mechanism found |
| `170003` | RA layer error |
| `160013` | Path not found |
| `125002` | Malformed protocol data |

## Implementation Notes

### String Encoding

Counted strings use **byte length**, not character length:

**Correct**:
```javascript
function svnStr(s: string): string {
  const bytes = new TextEncoder().encode(s);
  return `${bytes.length}:${s} `;  // Mandatory trailing space
}
```

**Incorrect**:
```javascript
// ❌ Uses character length, not byte length
return `${s.length}:${s}`;

// ❌ Missing mandatory trailing whitespace
return `${bytes.length}:${s}`;
```

### Whitespace Requirements

All S-expression elements **must** be followed by whitespace:

**Correct**:
```
( success ( 2 2 ( edit-pipeline ) ( ANONYMOUS ) ) )
```

**Incorrect**:
```
( success ( 2 2 ( edit-pipeline )( ANONYMOUS )))  // Missing spaces before lists
```

### Protocol Version Negotiation

Client must select version within server's `minver`-`maxver` range. Version 2 is current standard:

```javascript
if (greeting.maxVer < 2) {
  throw new Error(`Server does not support protocol version 2`);
}
```

### Reading S-Expressions

Read until balanced parentheses (depth returns to 0):

```javascript
let depth = 0;
let sawOpen = false;
for (const ch of text) {
  if (ch === '(') { depth++; sawOpen = true; }
  if (ch === ')') depth--;
  if (sawOpen && depth === 0) break;  // Complete
}
```

### Parsing Counted Strings

Must handle embedded spaces and special characters:

```javascript
// Extract length and position
const match = text.match(/(\d+):/g);
const length = parseInt(match[1]);
const startIdx = match.index + match[0].length;
const data = text.substring(startIdx, startIdx + length);
```

**Incorrect regex** (fails on spaces):
```javascript
// ❌ Stops at whitespace
/\d+:([^\s()]+)/
```

## Security Considerations

### Authentication

- **ANONYMOUS**: No security — suitable for public repositories
- **PLAIN**: Cleartext credentials — use only over TLS/VPN
- **CRAM-MD5**: Challenge-response — protects against replay but password stored reversibly on server
- **EXTERNAL**: Recommended for SSH tunnels or TLS client certificates

### Transport Security

Native `svnserve` (port 3690) has **no built-in encryption**. For secure access:

1. **SSH Tunnel**: `svn+ssh://` scheme
2. **HTTPS**: Use HTTP-based SVN (WebDAV) instead of native protocol
3. **VPN**: Isolate `svnserve` on private network

### Injection Risks

Unlike HTTP-based SVN (which uses XML), the S-expression format is **not vulnerable to injection** if counted strings are used correctly. The length-prefix prevents data from escaping string boundaries.

## Common Pitfalls

### 1. Base64 Encoding ANONYMOUS Credentials

**Incorrect**:
```javascript
const cred = btoa('anonymous');  // ❌ Not required
( ANONYMOUS ( 9:YW5vbnltb3Vz ) )
```

**Correct**:
```javascript
// Empty string or literal "anonymous"
( ANONYMOUS ( 0: ) )
```

### 2. Using `stat` Instead of `get-dir`

**Incorrect** (for listing):
```javascript
// stat returns metadata, not directory contents
( stat ( 0: ( HEAD ) ) )
```

**Correct**:
```javascript
// get-dir returns directory entries
( get-dir ( 0: ( HEAD ) ( false true ) ) )
```

### 3. Missing Trailing Whitespace

**Incorrect**:
```javascript
`( 2 ( edit-pipeline ) ( ${svnStr(url)} ) )\n`  // ❌ No space before newline
```

**Correct**:
```javascript
`( 2 ( edit-pipeline ) ( ${svnStr(url)}) ) `  // ✅ Space after final )
```

### 4. Character vs Byte Length

**Incorrect**:
```javascript
// "日本語" is 3 characters but 9 bytes in UTF-8
`${text.length}:${text}`  // ❌ Wrong length
```

**Correct**:
```javascript
const bytes = new TextEncoder().encode(text);
`${bytes.length}:${text} `  // ✅ Byte length
```

## Testing & Debugging

### Test Server Setup

Use Apache Subversion's `svnserve`:

```bash
# Create test repository
svnadmin create /tmp/test-repo

# Configure anonymous read access
echo "[general]
anon-access = read
auth-access = write" > /tmp/test-repo/conf/svnserve.conf

# Start server
svnserve -d --foreground -r /tmp/test-repo --listen-port 3690
```

### Manual Protocol Testing

Use `nc` (netcat) to interact with server:

```bash
nc localhost 3690
```

**Example session**:
```
< ( success ( 2 2 ( edit-pipeline svndiff1 ) ( ANONYMOUS ) ) )
> ( 2 ( edit-pipeline ) ( 16:svn://localhost/ ) )
< ( success ( 16:svn://localhost/ ( edit-pipeline ) ) )
< ( ( ANONYMOUS ) 8:Test Repo )
> ( ANONYMOUS ( 0: ) )
< ( success ( ) )
> ( get-latest-rev ( ) )
< ( success ( 0 ) )
```

### Packet Capture

Use `tcpdump` or Wireshark to inspect protocol:

```bash
tcpdump -i lo0 -A port 3690
```

### Common Response Patterns

**Success with data**:
```
( success ( <data> ) )
```

**Success without data**:
```
( success ( ) )
```

**Failure**:
```
( failure ( ( <code> <message> <file> <line> ) ) )
```

## Advanced Usage

### Repository Browsing

Full directory listing flow:

1. Connect and authenticate
2. Get repository root: `get-repos-root`
3. List root directory: `get-dir` with path `""`
4. For each subdirectory, recursively call `get-dir`

### File Content Retrieval

1. Get file metadata: `stat`
2. Retrieve file: `get-file`
3. Apply deltas if using `svndiff` compression

### Commit Operations

1. Open root: `open-root`
2. For each change:
   - Add file: `add-file`
   - Modify file: `open-file`, `apply-textdelta`
   - Delete: `delete-entry`
3. Close directories: `close-dir`
4. Complete: `close-edit`

## Protocol Comparison

| Feature | svnserve (native) | HTTP (WebDAV) |
|---------|-------------------|---------------|
| **Port** | 3690 | 80/443 |
| **Encryption** | None (use SSH tunnel) | TLS/SSL built-in |
| **Format** | S-expressions | XML |
| **Performance** | Faster (binary protocol) | Slower (XML overhead) |
| **Firewall** | Often blocked | Usually allowed |
| **Authentication** | SASL mechanisms | HTTP auth (Basic, Digest, NTLM) |
| **Use Case** | Private LANs, SSH access | Public internet, enterprise |

## API Endpoints in portofcall

### POST /api/svn/connect

Probe SVN server and parse greeting.

**Request**:
```json
{
  "host": "svn.example.com",
  "port": 3690,
  "timeout": 10000
}
```

**Response**:
```json
{
  "success": true,
  "host": "svn.example.com",
  "port": 3690,
  "greeting": "( success ( 2 2 ( edit-pipeline ) ( ANONYMOUS ) ) )",
  "minVersion": 2,
  "maxVersion": 2,
  "capabilities": ["edit-pipeline", "svndiff1"],
  "authMechanisms": ["ANONYMOUS", "CRAM-MD5"],
  "rtt": 42
}
```

### POST /api/svn/list

List repository directory contents (requires anonymous access).

**Request**:
```json
{
  "host": "svn.example.com",
  "port": 3690,
  "repo": "/myrepo",
  "path": "trunk/src",
  "timeout": 10000
}
```

**Response**:
```json
{
  "success": true,
  "serverVersion": 2,
  "capabilities": ["edit-pipeline"],
  "realm": "My Repository",
  "url": "svn://svn.example.com/myrepo",
  "authRequired": false,
  "entries": ["file1.c", "file2.h", "subdir"],
  "latencyMs": 156
}
```

### POST /api/svn/info

Get repository root URL.

**Request**:
```json
{
  "host": "svn.example.com",
  "port": 3690,
  "repo": "/myrepo",
  "timeout": 10000
}
```

**Response**:
```json
{
  "success": true,
  "reposRoot": "svn://svn.example.com/myrepo",
  "latencyMs": 89
}
```

## References

- [Apache Subversion Protocol Specification](https://svn.apache.org/repos/asf/subversion/trunk/subversion/libsvn_ra_svn/protocol)
- [Subversion Book: svnserve](https://svnbook.red-bean.com/en/1.7/svn.ref.svnserve.html)
- [SASL RFC 4422](https://tools.ietf.org/html/rfc4422)
- [CRAM-MD5 RFC 2195](https://tools.ietf.org/html/rfc2195)

## Changelog

- **2026-02-18**: Initial protocol review and bug fixes
  - Fixed counted string encoding to include mandatory trailing whitespace
  - Fixed ANONYMOUS auth to use empty string instead of base64-encoded "anonymous"
  - Changed `stat` to `get-dir` for directory listing
  - Improved counted string parsing to handle embedded spaces
  - Added protocol version validation
  - Fixed resource cleanup in error paths
