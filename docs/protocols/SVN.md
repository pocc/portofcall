# SVN (Subversion) Protocol Implementation

## Overview

**Protocol**: svnserve wire protocol
**Port**: 3690 (default)
**Transport**: TCP with S-expression encoding
**Status**: Active (declining usage, replaced by Git)

Subversion's native wire protocol (svnserve) provides direct repository access over TCP. The protocol uses parenthesized S-expression-like encoding for structured data exchange.

## Protocol Format

### S-Expression Encoding

All svnserve messages use a Lisp-like S-expression format:

```
( keyword ( arg1 arg2 ( nested-list ) ( another-list ) ) )
```

Types:
- **Numbers**: Decimal integers (e.g., `2`)
- **Strings**: Length-prefixed or bare words (e.g., `edit-pipeline`)
- **Lists**: Parenthesized groups (e.g., `( item1 item2 )`)

### Server Greeting

Upon connection, the server immediately sends a greeting:

```
( success ( min-ver max-ver ( capabilities... ) ( auth-mechanisms... ) ) )
```

Example:
```
( success ( 2 2 ( edit-pipeline svndiff1 absent-entries depth mergeinfo log-revprops ) ( ANONYMOUS CRAM-MD5 ) ) )
```

### Error Response

```
( failure ( ( error-code "error message" "source-file" line-number ) ) )
```

## Implementation

### Endpoint

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/svn/connect` | POST | Probe SVN server and parse greeting |

### Request Body

```json
{
  "host": "svn.example.com",
  "port": 3690,
  "timeout": 10000
}
```

### Response

```json
{
  "success": true,
  "host": "svn.example.com",
  "port": 3690,
  "greeting": "( success ( 2 2 ( edit-pipeline svndiff1 ... ) ( ANONYMOUS ) ) )",
  "minVersion": 2,
  "maxVersion": 2,
  "capabilities": ["edit-pipeline", "svndiff1", "absent-entries", "depth", "mergeinfo"],
  "authMechanisms": ["ANONYMOUS", "CRAM-MD5"],
  "rtt": 85
}
```

## Common Capabilities

| Capability | Description |
|------------|-------------|
| `edit-pipeline` | Streaming edit operations |
| `svndiff1` | Compressed delta encoding |
| `absent-entries` | Sparse checkout support |
| `depth` | Checkout depth control |
| `mergeinfo` | Merge tracking |
| `log-revprops` | Revision property retrieval |
| `atomic-revprops` | Atomic revision property changes |
| `partial-replay` | Partial replay of revisions |
| `inherited-props` | Inherited property support |

## Authentication Mechanisms

| Mechanism | Description |
|-----------|-------------|
| `ANONYMOUS` | No authentication required |
| `CRAM-MD5` | Challenge-response MD5 authentication |
| `EXTERNAL` | External authentication (e.g., via TLS client cert) |

## Authentication

- **Greeting phase**: No authentication needed (read-only greeting)
- **ANONYMOUS**: Open access, no credentials
- **CRAM-MD5**: Server sends challenge, client responds with MD5 hash
- Not implemented beyond greeting parsing (probe-only)

## Timeouts & Keep-alives

- Default timeout: 10 seconds
- Server sends greeting immediately upon connection
- No keep-alive needed for probe mode
- Connection closed after reading greeting

## Binary vs. Text Encoding

- **Entirely text-based**: S-expression encoding using ASCII
- **Length-prefixed strings**: e.g., `7:example` for "example"
- **No binary data** in the greeting phase

## Edge Cases

1. **No greeting**: Server may not be svnserve (handled via timeout)
2. **Incomplete S-expression**: Depth tracking ensures we read complete expressions
3. **Failure responses**: Parsed separately from success with error extraction
4. **Large greetings**: Capped at 8KB for safety
5. **Empty capability/auth lists**: Handled as empty arrays

## Security Considerations

- Read-only probe (greeting only, no auth attempted)
- No credentials transmitted
- Host/port validated
- Response size limited to 8KB

## References

- [SVN Protocol Design](https://svn.apache.org/repos/asf/subversion/trunk/subversion/libsvn_ra_svn/protocol)
- [Subversion Protocol Specification](https://svn.apache.org/repos/asf/subversion/trunk/notes/svn-protocol)
- [Apache Subversion](https://subversion.apache.org/)
