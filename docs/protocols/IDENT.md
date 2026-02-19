# IDENT Protocol (RFC 1413) -- Power-User Reference

## Overview

**Protocol:** Identification Protocol (IDENT / auth / tap)
**Default Port:** 113/TCP
**RFC:** [RFC 1413](https://tools.ietf.org/html/rfc1413) (February 1993)
**Obsoletes:** RFC 931
**Transport:** TCP only
**Status:** Largely deprecated but still used by IRC servers

IDENT allows a remote server to query the identity of the user who owns a specific TCP connection. When a client connects to a server (e.g., an IRC server), the server can open a separate connection back to port 113 on the client's machine and ask "who owns the TCP connection from your port X to my port Y?"

### Historical Context

Originally defined as the "Authentication Server Protocol" (RFC 931, 1985), IDENT was renamed to the "Identification Protocol" in RFC 1413 to clarify that it provides **identification, not authentication**. The protocol cannot verify that the returned userid is genuine -- it merely reports what the remote system claims.

### Common Use Cases

- IRC servers querying connecting users (most common surviving usage)
- Mail servers logging sender identity (MTA IDENT lookups)
- Network forensics and connection attribution
- FTP servers performing reverse ident checks
- Legacy Unix systems with identd running

## Wire Protocol

### Query Format

The client (the party that wants to know who owns a connection) connects to port 113 on the target host and sends:

```
<server-port>, <client-port>\r\n
```

- **server-port**: The port on the IDENT server's side of the connection being queried (1-65535)
- **client-port**: The port on the querying party's side of the connection being queried (1-65535)
- Ports are decimal ASCII integers separated by a comma
- Whitespace around the comma is permitted but not required
- Line MUST be terminated with CRLF (`\r\n`)

Example query:
```
6191, 23\r\n
```
This asks: "Who owns the TCP connection from your port 6191 to my port 23?"

### Response Format -- USERID

On success, the server responds with:

```
<server-port>, <client-port> : USERID : <opsys> : <userid>\r\n
```

- **server-port, client-port**: Echo of the queried port pair
- **USERID**: Literal token indicating a successful identification
- **opsys**: Operating system identifier from the IANA "SYSTEM NAMES" list, or `OTHER`
- **userid**: The user identifier string
- Fields are separated by ` : ` (space-colon-space)
- Response is terminated with CRLF

Example responses:
```
6191, 23 : USERID : UNIX : root
6191, 23 : USERID : OTHER : someone
6191, 23 : USERID : UNIX : user:with:colons
```

### Response Format -- ERROR

On failure, the server responds with:

```
<server-port>, <client-port> : ERROR : <error-type>\r\n
```

### Error Types (RFC 1413 Section 4)

| Error Type       | Meaning |
|------------------|---------|
| `INVALID-PORT`   | The port pair does not specify a currently active TCP connection on this machine |
| `NO-USER`        | The connection is identified but the system cannot determine the owning user |
| `HIDDEN-USER`    | The system can determine the user but the policy is to hide the information |
| `UNKNOWN-ERROR`  | Catch-all for any other error condition; should include a human-readable message |

Implementations MAY define additional error types beyond these four.

### Protocol Constraints

- **Maximum line length**: 1000 characters (excluding the trailing CRLF)
- **Port range**: 1 to 65535 (decimal integers)
- **userid characters**: Any printable character is allowed except `\r` (CR) and `\n` (LF); colons are explicitly permitted within the userid field
- **opsys field**: Must be a token from the IANA "Assigned Numbers" SYSTEM NAMES list, or `OTHER` for non-standard
- **Single query per connection**: Each TCP connection to port 113 handles one query/response, though some implementations support multiple
- **No encryption**: All data is plaintext
- **No authentication**: The response is self-reported and trivially spoofable

### Common Operating System Tokens

| Token     | System |
|-----------|--------|
| `UNIX`    | Unix/Linux variants |
| `OTHER`   | Non-standard or unspecified |
| `WIN32`   | Windows |
| `VMS`     | OpenVMS |
| `MULTICS` | Multics |
| `TAC`     | DISA TAC |

## API Endpoint

### `POST /api/ident/query`

Query an IDENT server for the identity of a TCP connection owner.

#### Request Body

```json
{
  "host": "irc.example.com",
  "port": 113,
  "serverPort": 6667,
  "clientPort": 42391,
  "timeout": 10000
}
```

| Field        | Type   | Required | Default | Description |
|--------------|--------|----------|---------|-------------|
| `host`       | string | Yes      | --      | Hostname or IP of the IDENT server to query |
| `port`       | number | No       | `113`   | Port the IDENT daemon listens on |
| `serverPort` | number | Yes      | --      | Port on the IDENT server's side of the connection being queried (1-65535) |
| `clientPort` | number | Yes      | --      | Port on the querying party's side (1-65535) |
| `timeout`    | number | No       | `10000` | Connection timeout in milliseconds |

#### Success Response (USERID)

```json
{
  "success": true,
  "host": "irc.example.com",
  "serverPort": 6667,
  "clientPort": 42391,
  "responseType": "USERID",
  "os": "UNIX",
  "userId": "jdoe",
  "raw": "6667, 42391 : USERID : UNIX : jdoe",
  "latencyMs": 45
}
```

#### Success Response (ERROR from server)

```json
{
  "success": true,
  "host": "irc.example.com",
  "serverPort": 6667,
  "clientPort": 42391,
  "responseType": "ERROR",
  "errorType": "NO-USER",
  "raw": "6667, 42391 : ERROR : NO-USER",
  "latencyMs": 32
}
```

Note: `success: true` means the IDENT protocol exchange completed. The IDENT server itself returned an `ERROR` response type, which is a valid protocol response (not a transport failure).

#### Failure Response (connection/transport error)

```json
{
  "success": false,
  "error": "Connection timeout",
  "host": "",
  "serverPort": 0,
  "clientPort": 0,
  "latencyMs": 0
}
```

## Testing

### With netcat

```bash
# Connect to an IDENT server and send a manual query
echo -e "22, 12345\r" | nc target.example.com 113

# Expected response:
# 22, 12345 : ERROR : NO-USER
# or
# 22, 12345 : USERID : UNIX : someuser
```

### Run a local identd for testing

```bash
# Using oidentd (common on Linux)
sudo apt install oidentd
sudo systemctl start oidentd

# Verify it's listening
ss -tlnp | grep 113

# Query it
echo -e "22, 54321\r" | nc localhost 113
```

### With curl (via Port of Call API)

```bash
# Query an IDENT server
curl -X POST https://portofcall.ross.gg/api/ident/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "irc.libera.chat",
    "serverPort": 6667,
    "clientPort": 12345,
    "timeout": 5000
  }'
```

### Docker test server

```bash
# Run oidentd in a container
docker run -d --name identd -p 113:113 \
  alpine sh -c '
    apk add oidentd &&
    oidentd -i -d
  '

# Query it
echo -e "80, 12345\r" | nc localhost 113
```

## Security Considerations

### Trust Model

IDENT provides **identification, not authentication**. Per RFC 1413 Section 5:

> "The information returned by this protocol is AT MOST as trustworthy as the host providing it OR the organization operating the host."

This means:
- A compromised host can return any userid it wants
- A malicious user with root access can spoof IDENT responses
- The protocol offers zero cryptographic guarantees
- It should never be used as a sole authentication mechanism

### Common Attack Vectors

1. **Spoofed responses**: Trivial with root access on the queried machine
2. **Information disclosure**: Reveals local usernames to remote parties
3. **Port scanning**: IDENT responses reveal whether specific connections exist
4. **Denial of service**: Flooding port 113 with queries
5. **Privacy concerns**: Leaks process ownership information

### Modern Status

- Most operating systems ship with identd disabled by default
- Many firewalls block port 113 outright
- IRC networks increasingly use SASL or CertFP instead of IDENT
- Some IRC servers still fall back to IDENT with a ~10 second timeout if port 113 is unreachable

## Implementation Notes

### Response Parsing

The response is parsed by splitting on `:` delimiters. Because the userid field (the 4th field) may itself contain colons, the parser must join all fields from the 4th position onward:

```
6191, 23 : USERID : UNIX : user:name:with:colons
         ^        ^       ^
         |        |       +-- everything after this colon is userid
         |        +-- opsys delimiter
         +-- response type delimiter
```

### TCP Fragmentation

IDENT responses are single-line, CRLF-terminated messages. Because TCP is a byte stream, the response may arrive across multiple TCP segments. The implementation accumulates data until a `\r\n` is detected or a safety limit is reached (1100 bytes, just above the RFC maximum of 1000 characters + CRLF).

### Port Pair Semantics

The terms "server-port" and "client-port" in RFC 1413 refer to the TCP connection **being queried**, not the IDENT connection itself:

```
                  Connection being queried
    Client ──────────────────────────────────────── Server
    (client-port)                              (server-port)
         \                                        /
          \  IDENT query on port 113             /
           ─────────────────────────────────────
           "server-port, client-port\r\n"
```

The IDENT query asks: "On the TCP connection between your port [server-port] and the querier's port [client-port], who is the user?"

## Resources

- **RFC 1413**: [Identification Protocol](https://tools.ietf.org/html/rfc1413)
- **RFC 931**: [Authentication Server Protocol](https://tools.ietf.org/html/rfc931) (obsoleted by RFC 1413)
- **IANA Port 113**: [Service Name and Transport Protocol Port Number Registry](https://www.iana.org/assignments/service-names-port-numbers/)
- **IANA SYSTEM NAMES**: Referenced by RFC 1413 for the opsys field
- **oidentd**: [Modern ident daemon](https://wiki.archlinux.org/title/Identd_Setup)

## Protocol Comparison

| Protocol | Port | Purpose | Auth? | Encryption? | Status |
|----------|------|---------|-------|-------------|--------|
| IDENT    | 113  | Connection owner identification | No | No | Largely deprecated |
| Finger   | 79   | User information lookup | No | No | Obsolete |
| WHOIS    | 43   | Domain/IP registration lookup | No | No | Active |
| LDAP     | 389  | Directory services | Yes | Optional (STARTTLS) | Active |

## Errata and Edge Cases

- Some implementations send responses without trailing CRLF; the parser tolerates bare LF or missing terminators
- Some servers support multiple queries on a single TCP connection (not required by RFC 1413)
- Port 0 is not valid per the RFC; both ports must be 1-65535
- The RFC does not specify a maximum query length, but implementations typically enforce one
- Some IRC servers send IDENT queries with additional whitespace or trailing data; robust parsers should handle this
