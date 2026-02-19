# Gopher Protocol — Power-User Reference

**Port:** 70 (default)
**RFC:** [1436](https://tools.ietf.org/html/rfc1436)
**Transport:** TCP (plaintext)
**Implementation:** `src/worker/gopher.ts`
**Rating:** ★★★★★

---

## Endpoint

### `POST /api/gopher/fetch`

Connects to a Gopher server, sends a selector, and returns either parsed menu items or raw text content.

**Request body:**

| Field      | Type   | Default | Notes                                                      |
|------------|--------|---------|-------------------------------------------------------------|
| `host`     | string | —       | Required. Must match `/^[a-zA-Z0-9.-]+$/` (no underscores, no IPv6, no bare IPs with colons). |
| `port`     | number | `70`    | 1–65535.                                                   |
| `selector` | string | `""`    | The Gopher selector to request. Empty string = root menu. Max 1024 chars. No control chars except `\t` (allowed for search). |
| `query`    | string | —       | If provided, appended to selector with `\t` separator (for type-7 search servers). |
| `timeout`  | number | `10000` | Milliseconds. Applies to both the connection and each individual `reader.read()` call (same timer, not reset per read). |

**Success response (`200`):**

```json
{
  "success": true,
  "isMenu": true,
  "selector": "/",
  "items": [
    { "type": "i", "display": "Welcome to Gopher!", "selector": "", "host": "", "port": 0 },
    { "type": "1", "display": "About", "selector": "/about", "host": "gopher.example.com", "port": 70 },
    { "type": "0", "display": "README", "selector": "/readme", "host": "gopher.example.com", "port": 70 }
  ]
}
```

or (non-menu content):

```json
{
  "success": true,
  "isMenu": false,
  "selector": "/readme",
  "content": "This is a plain text file.\nRetrieved from Gopher.\n"
}
```

**Error responses:**
- `400` — validation failure (missing host, bad chars, selector too long)
- `500` — connection timeout, response too large, socket error

---

## Wire Protocol

1. Client opens TCP to `host:port`
2. Client sends: `<selector>\r\n` (or `<selector>\t<query>\r\n` for search)
3. Server sends response and closes the connection

There is no persistent connection, no framing, no headers. One request per TCP socket.

### Menu Line Format

```
<type><display>\t<selector>\t<host>\t<port>\r\n
```

End-of-menu marker: a line containing only `.`

### Item Type Reference

| Type | Meaning | Selectable |
|------|---------|------------|
| `0`  | Text file | Yes |
| `1`  | Directory (submenu) | Yes |
| `2`  | CCSO nameserver | Yes |
| `3`  | Error | No |
| `4`  | BinHex file | Yes |
| `5`  | DOS binary | Yes |
| `6`  | UUencoded file | Yes |
| `7`  | Search server | Yes (with query) |
| `8`  | Telnet session | Yes |
| `9`  | Binary file | Yes |
| `g`  | GIF image | Yes |
| `I`  | Image (other) | Yes |
| `h`  | HTML file | Yes |
| `i`  | Info text (non-selectable) | No |
| `s`  | Sound | Yes |
| `T`  | TN3270 session | Yes |
| `p`  | Image (PNG, extension) | Yes |
| `w`  | Gopher+ (extension) | Yes |
| `+`  | Redundant server | Yes |

---

## Implementation Details

### Menu Detection Heuristic

The handler does NOT rely on the selector or any server hint to decide menu vs text. Instead, `looksLikeMenu()` inspects the response body:

1. Counts non-empty lines matching `/^[0-9giIhsTpw+]/` **and** containing at least one `\t`
2. If that count is >50% of all non-empty lines, it's a menu

**Gotcha:** Info-text lines (type `i`) are common in Gopher menus but often lack tabs on poorly-conforming servers. A response that is mostly `i`-type lines without tabs will be classified as plain text, not a menu. Well-formatted servers include the full 4-field tab-separated format even for `i` lines, so this works correctly against compliant servers.

### Menu Parsing

`parseGopherMenu()` splits the response on `\n` (not `\r\n`), leaving trailing `\r` on field values:

- **`port`**: Trailing `\r` is stripped via `.replace(/\r$/, '')` before `parseInt()`
- **`host`**: Trailing `\r` is **not** stripped — the `host` field may contain a trailing `\r` character
- **`display`** and **`selector`**: Also not stripped of `\r`

This means if you use the returned `host` value to make a follow-up request, the trailing `\r` will be caught by the host regex validation (`/^[a-zA-Z0-9.-]+$/`) and **rejected**. You need to `.trim()` the host client-side before reuse.

### Info Text Handling

Lines starting with `i` that have fewer than 4 tab-separated fields get special treatment:
- `type` = `"i"`, `display` = text after the `i` prefix, `selector` = `""`, `host` = `""`, `port` = `0`
- Only lines starting with `i` get this fallback; other types with <4 fields are silently dropped

### Port Parsing Edge Case

Port is parsed via `parseInt(parts[3]) || 70`. Since `parseInt('0')` returns `0` (falsy), a server advertising port 0 would be silently rewritten to port 70. Port 0 is not valid for Gopher, so this is harmless in practice.

### Search Queries (Type 7)

To search a type-7 server, pass both `selector` (the search server's selector) and `query`:

```bash
curl -X POST https://portofcall.dev/api/gopher/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"gopher.floodgap.com", "selector":"/v2/vs", "query":"internet history"}'
```

The wire request becomes: `/v2/vs\tinternet history\r\n`

---

## Validation Rules

| Check | Rule | Error |
|-------|------|-------|
| Host required | `host.trim().length > 0` | `"Host is required"` |
| Host characters | `/^[a-zA-Z0-9.-]+$/` | `"Host contains invalid characters"` |
| Port range | 1–65535 | `"Port must be between 1 and 65535"` |
| Selector control chars | `/[\x00-\x08\x0b\x0c\x0e-\x1f]/` rejects | `"Selector contains invalid control characters"` |
| Selector length | ≤ 1024 | `"Selector too long (max 1024 characters)"` |

Note: `\t` (0x09), `\n` (0x0a), and `\r` (0x0d) are explicitly **allowed** in the selector (they are excluded from the control-char regex). Tab is needed for search queries; CR/LF in a selector would break the wire protocol but pass validation.

---

## Known Limitations

1. **No Cloudflare detection** — Unlike most other Port of Call handlers, this one does not call `checkIfCloudflare()`. It will attempt to connect to any resolved IP.

2. **No HTTP method restriction** — The route in `index.ts` does not check `request.method`. GET/PUT/DELETE etc. will reach the handler and fail at `request.json()` with a generic 500 error instead of a clean 405.

3. **Trailing `\r` in parsed fields** — `host`, `display`, and `selector` fields in menu items may contain a trailing `\r`. Only `port` is cleaned.

4. **512 KB response cap** — Responses exceeding 512,000 bytes are rejected. This is bytes (Uint8Array length), not characters.

5. **Single timeout for everything** — The same `timeout` timer is shared between `socket.opened` and every `reader.read()`. If connection takes 8s of a 10s timeout, reads only get 2s total.

6. **No binary content support** — Binary items (types `9`, `g`, `I`, `5`) are decoded as UTF-8 text. Binary data will be mangled. The response is always a JSON string, not a binary download.

7. **Host regex rejects IPv6** — `[a-zA-Z0-9.-]+` excludes colons and brackets, so IPv6 addresses (`[::1]`) cannot be used.

8. **Host regex rejects underscores** — Some DNS names contain underscores (e.g., `_sip._tcp.example.com`); these are rejected.

9. **Error swallowing in read loop** — Socket errors other than timeout are silently caught and treated as "server closed connection" (normal Gopher behavior). This means actual I/O errors are invisible.

10. **CR/LF in selector passes validation** — The control-char regex exempts `\n` (0x0a) and `\r` (0x0d), but including these in a selector would prematurely terminate the request line on the wire. The server would see a truncated selector.

---

## Curl Examples

**Root menu:**
```bash
curl -X POST https://portofcall.dev/api/gopher/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"gopher.floodgap.com"}'
```

**Specific selector:**
```bash
curl -X POST https://portofcall.dev/api/gopher/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"gopher.floodgap.com", "selector":"/gopher/relevstreet"}'
```

**Search query (type 7):**
```bash
curl -X POST https://portofcall.dev/api/gopher/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"gopher.floodgap.com", "selector":"/v2/vs", "query":"gopher protocol"}'
```

**Custom timeout:**
```bash
curl -X POST https://portofcall.dev/api/gopher/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"gopher.floodgap.com", "timeout": 5000}'
```

---

## Public Gopher Servers for Testing

| Server | Port | Notes |
|--------|------|-------|
| `gopher.floodgap.com` | 70 | Largest active Gopherspace directory. Has search (type 7). |
| `gopher.club` | 70 | Community phlog (Gopher blog) host |
| `sdf.org` | 70 | SDF Public Access UNIX System |
| `gopher.quux.org` | 70 | Historical Gopher archive |
