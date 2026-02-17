# SSH — Power User Reference

**Port:** 22 | **Protocol:** SSH-2 (RFC 4253/4252/4254) | **Tests:** 14/14 ✅ Deployed

Port of Call provides six SSH endpoints across two source files. `ssh.ts` handles HTTP probes and a raw TCP tunnel. `ssh2-impl.ts` is a self-contained SSH-2 client — full key exchange, encryption, and authentication in a Cloudflare Worker.

---

## Architecture Overview

```
/api/ssh/connect   HTTP → banner probe (ssh.ts)
                   WS   → raw TCP tunnel, no SSH (ssh.ts)

/api/ssh/kexinit   HTTP → banner + KEXINIT exchange (ssh.ts)
/api/ssh/auth      HTTP → kexinit + USERAUTH_REQUEST none → supported methods (ssh.ts)

/api/ssh/terminal  WS   → full SSH-2: curve25519-sha256 / aes128-ctr / hmac-sha2-256 (ssh2-impl.ts)
/api/ssh/execute   HTTP → 501 (stub; use /terminal WebSocket)
/api/ssh/disconnect HTTP → advisory message (stub)
```

The two WebSocket modes are **completely different**: `/connect` is a raw byte pipe (SSH protocol runs in the browser); `/terminal` speaks SSH-2 natively in the Worker.

---

## API Endpoints

### `GET|POST /api/ssh/connect` — Banner probe (HTTP) / Raw TCP tunnel (WebSocket)

#### HTTP mode

Connects, reads the SSH banner line, closes.

**POST body / GET query params:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `22` | |
| `username` | string | — | Echoed in response only; not used |

**Success (200):**
```json
{
  "success": true,
  "message": "SSH server reachable",
  "host": "example.com",
  "port": 22,
  "banner": "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.6",
  "connectionOptions": {
    "username": "admin",
    "authMethod": "password",
    "hasPrivateKey": false,
    "hasPassword": false
  },
  "note": "This is a connectivity test only. For full SSH authentication (password/privateKey), use WebSocket upgrade."
}
```

`banner` is the raw SSH version string (single line, CRLF stripped, single `reader.read()` call — may be truncated if the banner line doesn't arrive in the first TCP segment).

#### WebSocket mode

When the request carries `Upgrade: websocket`, the endpoint opens a TCP socket to the target host and pipes raw bytes in both directions. **No SSH protocol processing happens in the Worker** — the browser-side client must speak SSH itself.

On connect, the Worker sends one JSON message before switching to raw passthrough:

```json
{ "type": "ssh-options", "options": { "host": "...", "port": 22, "username": "...", "authMethod": "password", ... } }
```

This is a hint to the browser SSH client; the Worker does not enforce or consume it. All subsequent messages are raw `ArrayBuffer` or `string` bytes piped directly between the WebSocket and the TCP socket.

**Connection URL:**
```
wss://portofcall.ross.gg/api/ssh/connect?host=example.com&port=22&username=admin&password=secret&privateKey=...&passphrase=...
```

⚠️ All credentials appear as query parameters and are visible in Cloudflare access logs.

---

### `POST /api/ssh/kexinit` — Key exchange algorithm probe

Connects, exchanges version banners, sends `SSH_MSG_KEXINIT` (20), parses the server's KEXINIT, and closes without completing the key exchange.

**POST body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `22` | |
| `timeout` | number | `10000` | Capped at 30000 ms |

**Client version string sent:** `SSH-2.0-CloudflareWorker_1.0`

**Client KEXINIT advertises:**
- kex: `curve25519-sha256`, `diffie-hellman-group14-sha256`, `diffie-hellman-group14-sha1`
- hostkey: `ssh-rsa`, `rsa-sha2-256`, `rsa-sha2-512`, `ssh-ed25519`, `ecdsa-sha2-nistp256`
- cipher (both directions): `aes128-ctr`, `aes256-ctr`, `aes128-gcm@openssh.com`, `aes256-gcm@openssh.com`
- mac: `hmac-sha2-256`, `hmac-sha1`
- compression: `none`, `zlib@openssh.com`

**Success (200):**
```json
{
  "success": true,
  "serverBanner": "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.6",
  "kexAlgorithms": ["curve25519-sha256", "diffie-hellman-group14-sha256", "..."],
  "hostKeyAlgorithms": ["rsa-sha2-512", "rsa-sha2-256", "ssh-ed25519", "ecdsa-sha2-nistp256-cert-v01@openssh.com", "..."],
  "ciphers": ["chacha20-poly1305@openssh.com", "aes128-ctr", "aes256-ctr", "aes128-gcm@openssh.com", "..."],
  "macs": ["umac-64-etm@openssh.com", "umac-128-etm@openssh.com", "hmac-sha2-256-etm@openssh.com", "..."],
  "compressions": ["none", "zlib@openssh.com"],
  "latencyMs": 87
}
```

`ciphers` is the union of client-to-server and server-to-client cipher lists (deduplicated). `macs` is the client-to-server list only (server-to-client is discarded).

**Error (200 with `success: false`):**
```json
{
  "success": false,
  "serverBanner": "",
  "kexAlgorithms": [],
  "hostKeyAlgorithms": [],
  "ciphers": [],
  "macs": [],
  "compressions": [],
  "latencyMs": 234,
  "error": "SSH packet length out of range: 1263553536"
}
```

Packet length out-of-range occurs when connecting to a port serving a non-SSH protocol (the first 4 bytes of the response are interpreted as a 32-bit packet length).

---

### `POST /api/ssh/auth` — Supported auth method probe

Extends `/kexinit` through service negotiation and a `none` USERAUTH_REQUEST to discover which authentication methods the server accepts.

**POST body:** Same as `/kexinit` (`host`, `port`, `timeout`).

**Wire exchange:**
```
→ SSH-2.0-CloudflareWorker_1.0\r\n
← SSH-2.0-OpenSSH_8.9p1 ...\r\n
→ SSH_MSG_KEXINIT (20)
← SSH_MSG_KEXINIT (20)
→ SSH_MSG_SERVICE_REQUEST (5) "ssh-userauth"
← SSH_MSG_SERVICE_ACCEPT (6)
→ SSH_MSG_USERAUTH_REQUEST (50) username="anonymous" service="ssh-connection" method="none"
← SSH_MSG_USERAUTH_FAILURE (51) [methods-list]    ← most servers
  OR SSH_MSG_USERAUTH_SUCCESS (52)                ← anonymous auth accepted
```

**Success (200):**
```json
{
  "success": true,
  "serverBanner": "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.6",
  "authMethods": ["publickey", "password"],
  "latencyMs": 152
}
```

`authMethods: ["none"]` means the server accepted anonymous login.

Note: the KEXINIT exchange is **not completed** (no KEXECDH_INIT is sent). The SERVICE_REQUEST is sent unencrypted. Some hardened servers may reject the connection if they enforce encryption before service requests — in practice this is rare.

---

### `GET /api/ssh/terminal` — Interactive SSH session (WebSocket)

**WebSocket upgrade required.** Implements full SSH-2:

| Phase | Detail |
|---|---|
| Version exchange | Client sends `SSH-2.0-PortOfCall_1.0\r\n`; skips non-SSH banner lines |
| Key exchange | curve25519-sha256 (X25519 ECDH + SHA-256) |
| Cipher | aes128-ctr (both directions) |
| MAC | hmac-sha2-256 (32-byte tags, both directions) |
| Compression | none |
| Auth | password or Ed25519 public key |
| Terminal | PTY: xterm-256color, 220 cols × 50 rows (hardcoded) |
| I/O | Channel data forwarded as raw bytes; window: 1 MB initial, refilled when < 256 KB |

**Connection URL:**
```
wss://portofcall.ross.gg/api/ssh/terminal?host=example.com&port=22&username=admin&authMethod=password&password=secret
```

**Query parameters:**

| Param | Required | Notes |
|---|---|---|
| `host` | ✅ | |
| `port` | — | Default `22` |
| `username` | ✅ | |
| `authMethod` | ✅ | `"password"` or `"privateKey"` |
| `password` | — | Required if `authMethod=password` |
| `privateKey` | — | OpenSSH PEM string; required if `authMethod=privateKey` |
| `passphrase` | — | Passphrase for encrypted private keys |
| `timeout` | — | Connection timeout ms (default 30000) |

⚠️ All credentials appear in the WebSocket URL query string.

#### Worker → browser messages

```jsonc
// SSH protocol negotiation complete, PTY and shell open; raw output begins after this:
{ "type": "connected" }

// Informational (auth banner, status):
{ "type": "info", "message": "Authenticating…" }

// Fatal error (WebSocket closes after this):
{ "type": "error", "message": "Authentication failed" }

// Server closed the channel:
{ "type": "disconnected" }
```

After `connected`, terminal output is sent as raw `Uint8Array` (binary WebSocket frames), not JSON.

#### Browser → worker messages

Send raw text or binary bytes — they are forwarded directly as `SSH_MSG_CHANNEL_DATA`. The Worker filters out JSON control messages: **any input that starts with `{` and contains `"type"` is silently dropped** and not forwarded to the SSH channel.

There is no resize message or keepalive ping from the browser; the Worker does not process any JSON input after the connection is established.

---

### `POST /api/ssh/execute` — Stub (501)

Always returns HTTP 501. Use `/terminal` WebSocket for command execution.

### `POST /api/ssh/disconnect` — Stub

Returns `{ "success": true, "message": "Close WebSocket connection to disconnect SSH session" }`. Close the WebSocket to disconnect.

---

## Key Exchange Details (ssh2-impl.ts)

The full key exchange follows RFC 4253 curve25519-sha256:

1. **X25519 ephemeral keypair** generated via WebCrypto `generateKey({ name: 'X25519' })`
2. **KEXECDH_INIT (30)** sent with client ephemeral public key
3. **KEXECDH_REPLY (31)** received: host key blob + server ephemeral pubkey + signature
4. **No host key verification** — the exchange hash signature is received but not verified against a known-hosts list
5. **Shared secret** derived via WebCrypto `deriveBits({ name: 'X25519' })`
6. **Exchange hash H** = SHA-256 of: client version, server version, client KEXINIT payload, server KEXINIT payload, host key blob, client ephemeral pubkey, server ephemeral pubkey, shared secret mpint
7. **Session ID** = H (first exchange hash; unchanged for session lifetime — no re-keying)
8. **Session keys** derived per RFC 4253 §7.2: `A`=IVc→s, `B`=IVs→c, `C`=encc→s, `D`=encs→c, `E`=macc→s, `F`=macs→c

---

## Authentication Details

### Password (`authMethod=password`)

Sends `SSH_MSG_USERAUTH_REQUEST (50)` with method `"password"`, `change_request = false`, and the cleartext password as an SSH string. This is encrypted because it is sent after NEWKEYS.

### Ed25519 Public Key (`authMethod=privateKey`)

Parses OpenSSH private key format (the `-----BEGIN OPENSSH PRIVATE KEY-----` format, RFC 4716 / OpenSSH wire format) via `parseOpenSshEd25519`:

- **Only Ed25519 is supported.** RSA, ECDSA, and DSA keys are rejected with `"Unsupported key type"`.
- **Passphrase-protected keys** are decrypted using `bcrypt-pbkdf` (KDF) + AES-CTR or AES-CBC (Web Crypto). Supported ciphers: `aes256-ctr`, `aes256-cbc`, `aes192-ctr`, `aes128-ctr`. Other ciphers (e.g. `chacha20-poly1305@openssh.com`, the current OpenSSH default) throw `"Unsupported cipher"`.
- **Unencrypted keys** (`-N ""`) work without a passphrase.
- If the wrong passphrase is supplied: `"Wrong passphrase — OpenSSH key integrity check failed"`.

Signature method: `Ed25519` via WebCrypto `crypto.subtle.sign('Ed25519', ...)`. The signed blob is: `session_id + SSH_MSG_USERAUTH_REQUEST (no signature field)`.

To export an unencrypted Ed25519 key for use with this endpoint:
```bash
ssh-keygen -t ed25519 -f /tmp/poc_key -N ""
# Use /tmp/poc_key (private) content as the privateKey parameter
```

To strip passphrase from an existing key:
```bash
ssh-keygen -p -N "" -f ~/.ssh/id_ed25519 -o /tmp/stripped_key
```

---

## Known Limitations

**No RSA or ECDSA key auth.** Only Ed25519 is supported in `/terminal`. The `/kexinit` endpoint advertises `rsa-sha2-256`, `rsa-sha2-512` in KEXINIT (read from server only), but `/terminal`'s auth code parses only `ssh-ed25519`.

**No host key verification.** The server's host key signature in KEXECDH_REPLY is received but not checked. MITM attacks on the TCP path are not detected.

**chacha20-poly1305@openssh.com passphrase-protected keys rejected.** OpenSSH 9.x switched to `chacha20-poly1305` as the default KDF cipher. Keys generated with recent OpenSSH versions using the default cipher will fail with `"Unsupported cipher"`. Workaround: generate with `-Z aes256-ctr` or strip the passphrase.

**Hardcoded PTY size: 220×50.** There is no resize message protocol. The terminal dimensions cannot be changed after connection.

**JSON input filtering.** Any terminal input starting with `{` and containing `"type"` is silently dropped. This means you cannot type JSON-looking strings that start with `{` and contain `"type"` in the terminal.

**No re-keying.** The session ID is fixed at the initial exchange hash H. Long-lived sessions use the same encryption keys throughout. OpenSSH servers typically rekey after 1 GB of data or 1 hour.

**No port forwarding.** `SSH_MSG_CHANNEL_OPEN` with type `"direct-tcpip"` or `"forwarded-tcpip"` is not sent or handled.

**Window flow control.** The Worker tracks `remoteWindow` (server's window into client sends) and silently drops input when `data.length > remoteWindow`. The remote window is decremented on send but only refreshed when the server sends `SSH_MSG_CHANNEL_WINDOW_ADJUST`. Input is also capped: if `data.length > remoteWindow`, it is dropped entirely rather than split.

**`/connect` WebSocket is a raw pipe.** Only bytes are forwarded. The `ssh-options` JSON first message is for browser-side SSH clients; the Worker itself does no SSH protocol processing in `/connect` WebSocket mode.

**Single `reader.read()` for banner in HTTP mode.** If the SSH banner arrives across multiple TCP segments, the banner field may be truncated.

---

## SSH-2 Message Type Reference

| Dec | Constant | Direction | Notes |
|---|---|---|---|
| 1 | DISCONNECT | ← | Server-initiated disconnect; reason string at offset 5 |
| 2 | IGNORE | ← | Keepalive / padding; silently skipped |
| 5 | SERVICE_REQUEST | → | Requests "ssh-userauth" service |
| 6 | SERVICE_ACCEPT | ← | Confirms service available |
| 20 | KEXINIT | ↔ | Algorithm negotiation |
| 21 | NEWKEYS | ↔ | Encryption begins after this |
| 30 | KEXECDH_INIT | → | Client ephemeral pubkey (curve25519) |
| 31 | KEXECDH_REPLY | ← | Host key + server ephemeral pubkey + sig |
| 50 | USERAUTH_REQUEST | → | Auth attempt |
| 51 | USERAUTH_FAILURE | ← | Lists continuable methods |
| 52 | USERAUTH_SUCCESS | ← | Auth accepted |
| 53 | USERAUTH_BANNER | ← | Forwarded to browser via `info` event |
| 80 | GLOBAL_REQUEST | ← | e.g. hostkeys-00@openssh.com; Worker replies with REQUEST_FAILURE |
| 82 | REQUEST_FAILURE | → | Response to unrequested global requests |
| 90 | CHANNEL_OPEN | → | Opens "session" channel |
| 91 | CHANNEL_OPEN_CONFIRMATION | ← | Channel established |
| 92 | CHANNEL_OPEN_FAILURE | ← | Channel rejected |
| 93 | CHANNEL_WINDOW_ADJUST | ↔ | Flow control window update |
| 94 | CHANNEL_DATA | ↔ | Terminal I/O |
| 95 | CHANNEL_EXTENDED_DATA | ← | stderr; forwarded to browser as raw bytes |
| 96 | CHANNEL_EOF | ← | Half-close; Worker waits for CHANNEL_CLOSE |
| 97 | CHANNEL_CLOSE | ← | Session over |
| 98 | CHANNEL_REQUEST | → | "pty-req", "shell" |
| 99 | CHANNEL_SUCCESS | ← | PTY/shell accepted |
| 100 | CHANNEL_FAILURE | ← | PTY/shell rejected |

---

## Key Derivation (RFC 4253 §7.2)

```
K  = shared secret (mpint-encoded)
H  = exchange hash (SHA-256, 32 bytes)
session_id = H (fixed at first kex)

IV c→s  = SHA-256(K || H || 'A' || session_id)   [16 bytes]
IV s→c  = SHA-256(K || H || 'B' || session_id)   [16 bytes]
Key c→s = SHA-256(K || H || 'C' || session_id)   [16 bytes for aes128-ctr]
Key s→c = SHA-256(K || H || 'D' || session_id)   [16 bytes]
MAC c→s = SHA-256(K || H || 'E' || session_id)   [32 bytes for hmac-sha2-256]
MAC s→c = SHA-256(K || H || 'F' || session_id)   [32 bytes]
```

If more than 32 bytes are needed, the derivation extends: `K2 = SHA-256(K || H || K1)` concatenated with K1.

---

## curl Examples

```bash
# HTTP banner probe
curl -s https://portofcall.ross.gg/api/ssh/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"test.rebex.net","port":22}' | jq '{banner}'

# GET form
curl -s 'https://portofcall.ross.gg/api/ssh/connect?host=test.rebex.net'

# Algorithm probe
curl -s https://portofcall.ross.gg/api/ssh/kexinit \
  -H 'Content-Type: application/json' \
  -d '{"host":"test.rebex.net"}' | jq '{kexAlgorithms,hostKeyAlgorithms,ciphers}'

# Auth methods
curl -s https://portofcall.ross.gg/api/ssh/auth \
  -H 'Content-Type: application/json' \
  -d '{"host":"test.rebex.net"}' | jq '{serverBanner,authMethods}'
```

---

## Public Test Servers

| Host | Notes |
|---|---|
| `test.rebex.net` | Public SFTP/SSH test server; accepts password auth (demo/password) |

---

## Resources

- [RFC 4251](https://www.rfc-editor.org/rfc/rfc4251) — SSH Architecture
- [RFC 4253](https://www.rfc-editor.org/rfc/rfc4253) — SSH Transport Layer
- [RFC 4252](https://www.rfc-editor.org/rfc/rfc4252) — SSH Auth Protocol
- [RFC 4254](https://www.rfc-editor.org/rfc/rfc4254) — SSH Connection Protocol
- [curve25519-sha256](https://www.rfc-editor.org/rfc/rfc8731) — ECDH key exchange method
