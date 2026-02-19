# Finger Protocol — Power-User Reference

**Port:** 79 (default)
**Transport:** TCP
**RFC:** [RFC 1288](https://tools.ietf.org/html/rfc1288) (1991), supersedes [RFC 742](https://tools.ietf.org/html/rfc742) (1977)
**Implementation:** `src/worker/finger.ts`
**Route:** `src/worker/index.ts` line 377

## Endpoint

### `POST /api/finger/query`

Single endpoint. Connects to a Finger server, sends a query line, reads the full text response, closes.

**Request:**

```json
{
  "host": "finger.example.com",
  "port": 79,
  "username": "alice",
  "remoteHost": "otherhost.example.com",
  "timeout": 10000
}
```

| Field | Type | Default | Required | Validation |
|---|---|---|---|---|
| `host` | string | — | yes | **None** — no regex, no Cloudflare detection |
| `port` | number | `79` | no | 1–65535 (HTTP 400 if out of range) |
| `username` | string | `""` | no | `/^[a-zA-Z0-9_.-]+$/` — no spaces, no `/W` |
| `remoteHost` | string | `""` | no | `/^[a-zA-Z0-9.-]+$/` |
| `timeout` | number | `10000` | no | Not validated (any number accepted) |

**Wire query format:** `[username][@remoteHost]\r\n`

| username | remoteHost | Wire query | Meaning |
|---|---|---|---|
| `"alice"` | — | `alice\r\n` | Look up user "alice" on `host` |
| — | — | `\r\n` | List logged-in users on `host` |
| — | `"other.com"` | `@other.com\r\n` | Forward: ask `host` to query `other.com` for all users |
| `"alice"` | `"other.com"` | `alice@other.com\r\n` | Forward: ask `host` to look up "alice" on `other.com` |

**Response (success):**

```json
{
  "success": true,
  "query": "alice",
  "response": "Login: alice        Name: Alice Smith\nDirectory: /home/alice      Shell: /bin/bash\nLast login Fri Jan 15 10:23 from client.example.com\nNo mail.\nNo Plan."
}
```

**Response (empty):**

```json
{
  "success": true,
  "query": "",
  "response": "(No response from server)"
}
```

**Response (error):**

```json
{
  "success": false,
  "error": "Connection timeout"
}
```

| Condition | HTTP status | `success` | `error` |
|---|---|---|---|
| Missing `host` | 400 | `false` | `"Host is required"` |
| Invalid port | 400 | `false` | `"Port must be between 1 and 65535"` |
| Bad `username` chars | 400 | `false` | `"Username contains invalid characters"` |
| Bad `remoteHost` chars | 400 | `false` | `"Remote host contains invalid characters"` |
| Timeout | 500 | `false` | `"Connection timeout"` |
| Response > 100KB | 500 | `false` | `"Response too large (max 100KB)"` |
| Connection refused | 500 | `false` | Varies (socket error message) |
| Server RST after connect, no data | 200 | `true` | — (`response: "(No response from server)"`) |

## Curl examples

```bash
# Look up user on a Finger server
curl -X POST https://portofcall.example/api/finger/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"finger.example.com","username":"alice"}'

# List all logged-in users (empty query)
curl -X POST https://portofcall.example/api/finger/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"finger.example.com"}'

# Forward query through host to remoteHost
curl -X POST https://portofcall.example/api/finger/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"proxy.example.com","username":"bob","remoteHost":"target.example.com"}'
```

## Known quirks and limitations

### 1. No Cloudflare detection

Unlike most other protocol handlers, `handleFingerQuery` does not call `checkIfCloudflare()`. If the target `host` resolves to a Cloudflare IP, the connection will be attempted directly and will likely fail with a socket error rather than returning `isCloudflare: true`.

### 2. `host` parameter has no validation

The `host` field (target Finger server) has **no regex or format validation** — any non-empty string is accepted. By contrast, `remoteHost` (forwarding destination in the Finger query) is validated against `/^[a-zA-Z0-9.-]+$/`. This asymmetry means `host` could contain spaces, colons, or other characters that would cause `connect()` to fail at the socket level.

### 3. Shared timeout covers both connection and response

A single `setTimeout` fires at the start and is reused for both `socket.opened` and every `reader.read()`. If the TCP handshake takes 8 seconds of a 10-second timeout, only 2 seconds remain for the entire response. The timeout is not reset between phases.

### 4. RFC 1288 `/W` verbose flag not supported

RFC 1288 §2.5.5 defines the `/W` prefix (e.g. `/W alice\r\n`) to request verbose/long-format output. This implementation does not support it. The `username` validation regex blocks the `/` character, so passing `/W alice` in the username field returns HTTP 400 (`"Username contains invalid characters"`).

### 5. No forwarding depth limit

RFC 1288 §3.2.3 describes forwarding (`user@host1@host2`). The implementation sends whatever `remoteHost` is given, but does not restrict chaining depth. A malicious query could attempt `alice@host1@host2@host3` by putting the full chain in `remoteHost` — though the regex would reject the `@` character in `remoteHost`.

Actually, the regex `/^[a-zA-Z0-9.-]+$/` blocks `@` in `remoteHost`, so multi-hop forwarding is effectively prevented by input validation. Only single-hop forwarding (`username@remoteHost`) is possible.

### 6. Error swallowing in read loop

If the server sends a TCP RST during the read loop and no chunks have been collected, the error is silently discarded (lines 153–160). The response will be `success: true` with `response: "(No response from server)"`. Only timeout errors are re-thrown. This means a connection that is actively refused after the handshake looks identical to a server that accepts and immediately closes.

### 7. No method restriction

The handler is registered for `url.pathname === '/api/finger/query'` with no HTTP method check. In practice, only POST works because `request.json()` requires a body, but a PUT or PATCH with a JSON body would also succeed.

### 8. `reader.releaseLock()` not called on error path

In the success path, `reader.releaseLock()` is called before `socket.close()`. In the error path (throw from the read loop catch), the reader lock is NOT released. The socket is still closed, so this doesn't cause a resource leak in practice, but it differs from the documented Cloudflare sockets best practice.

### 9. Response is `.trim()`ed

The raw response text is trimmed of leading and trailing whitespace before being returned. If the server's response has significant leading/trailing newlines (e.g. a banner), those are silently stripped.

### 10. UTF-8 decoding is strict by default

The `TextDecoder()` constructor is called with no options, so `fatal` defaults to `false` — invalid UTF-8 bytes produce U+FFFD replacement characters. This is correct behavior for Finger servers that may send Latin-1 or other encodings, but the response will contain `\ufffd` for those bytes.

## Wire exchange

```
Client                          Server (port 79)
  |                                |
  |------- TCP SYN --------------->|
  |<------ TCP SYN-ACK -----------|
  |------- TCP ACK --------------->|
  |                                |
  |--- "alice\r\n" -------------->|    (Finger query)
  |                                |
  |<-- "Login: alice  ..." -------|    (Plain text response,
  |<-- "Directory: /home..." -----|     may arrive in chunks)
  |<-- "No Plan.\n" -------------|
  |                                |
  |<------ TCP FIN/RST -----------|    (Server closes)
  |------- TCP FIN --------------->|    (Client closes)
```

## Response size limit

100,000 bytes (100 KB). Exceeding this triggers an error response. The cap is enforced as cumulative bytes across all read chunks, not per-chunk.

## No RTT measurement

Unlike many other protocol handlers (AJP, SSH, etc.), the Finger handler does not track or return an RTT (round-trip time) value. The `success` response has only `query` and `response` fields.

## Local testing

Few public Finger servers remain. For local testing:

```bash
# Simple Finger server with netcat (one-shot)
echo -e "Login: test\tName: Test User\nNo Plan." | nc -l 79

# Then query it:
curl -X POST http://localhost:8787/api/finger/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1"}'
```

Or with a proper Finger daemon:

```bash
# Debian/Ubuntu
sudo apt install fingerd
# macOS (xinetd/launchd config needed)
```
