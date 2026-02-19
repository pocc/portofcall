# IRCS (IRC over TLS) — Power-User Reference

**Protocol:** IRC over TLS (RFC 7194, RFC 2812, IRCv3)
**Port:** 6697 (implicit TLS)
**Transport:** TCP with mandatory TLS
**Implementation:** `/src/worker/ircs.ts` (550 lines)
**Related:** `/src/worker/irc.ts` (plaintext IRC on port 6667)

## Overview

IRCS is IRC with implicit TLS encryption on port 6697. Unlike STARTTLS-based protocols, IRCS begins the TLS handshake immediately upon TCP connection (similar to HTTPS vs HTTP). This implementation provides two modes:

1. **HTTP mode** (`POST /api/ircs/connect`) — Quick connectivity test, reads server welcome/MOTD, disconnects
2. **WebSocket mode** (`GET /api/ircs/ws`) — Full interactive IRC client bridge with IRCv3 capability negotiation and SASL PLAIN authentication

## Architecture

```
Browser                Worker                    IRC Server (TLS)
  |                      |                            |
  |-- POST /connect ---->|                            |
  |                      |--- TLS handshake --------->|
  |                      |<-- TLS established --------|
  |                      |--- PASS (if provided) ---->|
  |                      |--- NICK mybot ------------>|
  |                      |--- USER mybot 0 * :Bot --->|
  |                      |<-- 001 Welcome ------------|
  |                      |<-- 002-004 server info ----|
  |                      |<-- 375 MOTD start ---------|
  |                      |<-- 372 MOTD line ... ------|
  |                      |<-- 376 MOTD end -----------|
  |                      |--- QUIT :test ------------>|
  |                      |<-- TLS close --------------|
  |<-- JSON response ----|
  |
  |-- WS /api/ircs/ws -->|
  |<-- WS accepted ------|
  |                      |--- TLS handshake --------->|
  |                      |--- PASS (if provided) ---->|
  |                      |--- CAP LS 302 ------------>|
  |                      |--- NICK mybot ------------>|
  |                      |--- USER mybot 0 * :Bot --->|
  |                      |<-- CAP LS :sasl ... -------|
  |                      |--- CAP REQ sasl ---------->|
  |                      |<-- CAP ACK :sasl ----------|
  |                      |--- AUTHENTICATE PLAIN ---->|
  |                      |<-- AUTHENTICATE + ---------|
  |                      |--- AUTHENTICATE <base64> ->|
  |                      |<-- 903 SASL success -------|
  |                      |--- CAP END --------------->|
  |                      |<-- 001 Welcome ------------|
  |                      |<-- 376 MOTD end -----------|
  |                      |--- JOIN #channel --------->|
  |                      |<-- 353 NAMES --------------|
  |<-- WS: irc-message --|
  |-- WS: {"type":"privmsg","target":"#channel","message":"hello"}-->|
  |                      |--- PRIVMSG #channel :hello->|
  |<-- WS: irc-message --|<-- PING :server1 ----------|
  |                      |--- PONG :server1 --------->|
  |(auto-handled)        |                            |
```

## HTTP Mode: POST /api/ircs/connect

### Request

```bash
curl -X POST https://portofcall.example/api/ircs/connect \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "irc.libera.chat",
    "port": 6697,
    "nickname": "testbot",
    "username": "testbot",
    "realname": "Test Bot",
    "password": "server_password_if_required"
  }'
```

**Request schema:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `host` | string | Yes | — | IRC server hostname (e.g., `irc.libera.chat`) |
| `port` | number | No | `6697` | IRC-over-TLS port (always uses TLS regardless of port) |
| `nickname` | string | Yes | — | IRC nickname (validated by RFC 2812 rules) |
| `username` | string | No | `nickname` | Ident username for USER command |
| `realname` | string | No | `nickname` | Real name for USER command |
| `password` | string | No | — | Server password (PASS command, sent before NICK/USER) |

### Response (Success)

```json
{
  "success": true,
  "host": "irc.libera.chat",
  "port": 6697,
  "tls": true,
  "rtt": 234,
  "nickname": "testbot",
  "welcome": "Welcome to the Libera.Chat Internet Relay Chat Network testbot",
  "serverInfo": "irc.libera.chat 2.11.2p3 itkloO biklmnopstveI bklov",
  "motd": "- Welcome to Libera Chat\n- By connecting to Libera Chat you...",
  "messagesReceived": 18,
  "messages": [
    {
      "prefix": "irc.libera.chat",
      "command": "001",
      "params": ["testbot", "Welcome to the Libera.Chat Internet Relay Chat Network testbot"],
      "timestamp": 1708294561234
    }
  ]
}
```

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` for successful connections |
| `host` | string | Echoed hostname |
| `port` | number | Echoed port |
| `tls` | boolean | Always `true` (IRCS uses implicit TLS) |
| `rtt` | number | Round-trip time from socket connect to TLS handshake complete (ms) |
| `nickname` | string | Nickname used for registration |
| `welcome` | string | `undefined` | Text from `001 RPL_WELCOME` (last parameter) |
| `serverInfo` | string | `undefined` | Server version/modes from `004 RPL_MYINFO` (params[1+]) |
| `motd` | string | `undefined` | Concatenated lines from `372 RPL_MOTDLINE` messages |
| `messagesReceived` | number | Total IRC protocol messages received |
| `messages` | array | First 50 parsed IRC messages (see IRCMessage schema below) |

**IRCMessage schema:**

```typescript
{
  tags?: Record<string, string>;  // IRCv3 message tags (@key=value)
  prefix?: string;                 // Server or nick!user@host prefix
  command: string;                 // Numeric (001) or command (PRIVMSG)
  params: string[];                // Command parameters
  timestamp: number;               // Worker timestamp (Date.now())
}
```

### Response (Error)

**Cloudflare-protected target:**

```json
{
  "success": false,
  "error": "Target host irc.example.com (1.2.3.4) is behind Cloudflare...",
  "isCloudflare": true
}
```
Status: `403 Forbidden`

**Connection timeout (30s):**

```json
{
  "success": false,
  "error": "Connection timeout"
}
```
Status: `500 Internal Server Error`

**Invalid nickname:**

```json
{
  "error": "Invalid nickname. Must start with a letter and contain only alphanumeric characters."
}
```
Status: `400 Bad Request`

## WebSocket Mode: GET /api/ircs/ws

### Connection

Establish WebSocket with query parameters:

```javascript
const ws = new WebSocket(
  'wss://portofcall.example/api/ircs/ws?' +
  'host=irc.libera.chat&' +
  'port=6697&' +
  'nickname=mybot&' +
  'username=mybot&' +
  'realname=My+Bot&' +
  'channels=%23lobby,%23dev&' +
  'saslUsername=myaccount&' +
  'saslPassword=mypassword'
);
```

**Query parameters:**

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `host` | string | Yes | — | IRC server hostname |
| `port` | number | No | `6697` | IRC-over-TLS port |
| `nickname` | string | Yes | — | IRC nickname |
| `username` | string | No | `nickname` | Ident username |
| `realname` | string | No | `nickname` | Real name |
| `password` | string | No | — | Server password (PASS command) |
| `channels` | string | No | — | Comma-separated channels to auto-join after registration (e.g., `#lobby,#dev`) |
| `saslUsername` | string | No | — | SASL PLAIN account name (triggers IRCv3 SASL auth if server supports it) |
| `saslPassword` | string | No | — | SASL PLAIN password |

### Messages from Worker → Browser

All messages are JSON strings with `type` field:

#### `irc-connected`

Sent immediately after TLS handshake completes:

```json
{
  "type": "irc-connected",
  "host": "irc.libera.chat",
  "port": 6697,
  "tls": true,
  "message": "Connected to irc.libera.chat:6697 (TLS)"
}
```

#### `irc-message`

Every IRC protocol message from server (including numeric replies, PRIVMSG, JOIN, etc.):

```json
{
  "type": "irc-message",
  "raw": ":nick!user@host PRIVMSG #channel :Hello world",
  "parsed": {
    "prefix": "nick!user@host",
    "command": "PRIVMSG",
    "params": ["#channel", "Hello world"],
    "timestamp": 1708294561234
  }
}
```

#### `irc-caps` (IRCv3)

Available capabilities from `CAP LS`:

```json
{
  "type": "irc-caps",
  "caps": ["sasl", "multi-prefix", "away-notify", "account-notify", "extended-join"]
}
```

#### `irc-cap-ack` (IRCv3)

Acknowledged capabilities from `CAP ACK`:

```json
{
  "type": "irc-cap-ack",
  "caps": ["sasl"]
}
```

#### `irc-cap-nak` (IRCv3)

Rejected capabilities from `CAP NAK`:

```json
{
  "type": "irc-cap-nak",
  "caps": "sasl"
}
```

#### `irc-sasl-success` (IRCv3)

SASL authentication succeeded (`903 RPL_SASLSUCCESS`):

```json
{
  "type": "irc-sasl-success",
  "message": "SASL authentication successful"
}
```

#### `irc-sasl-failed` (IRCv3)

SASL authentication failed (numeric `904`/`905`/`906`/`907`):

```json
{
  "type": "irc-sasl-failed",
  "code": "904",
  "message": "SASL authentication failed"
}
```

**Note:** WebSocket is closed immediately after SASL failure.

#### `irc-disconnected`

Server closed connection:

```json
{
  "type": "irc-disconnected",
  "message": "Server closed connection"
}
```

#### `error`

Worker-side error (command send failure, socket error):

```json
{
  "type": "error",
  "error": "Failed to send command"
}
```

### Messages from Browser → Worker

#### Raw IRC command

Send plain text (not JSON) to send raw IRC protocol line:

```javascript
ws.send('PRIVMSG #channel :Hello world');
```

Worker appends `\r\n` automatically. Use for custom commands not covered by JSON API.

#### JSON Commands

Send JSON objects for structured commands:

##### `raw`

Send arbitrary IRC command:

```json
{
  "type": "raw",
  "command": "PRIVMSG #channel :Hello world"
}
```

##### `join`

Join channel:

```json
{
  "type": "join",
  "channel": "#lobby"
}
```

##### `part`

Leave channel:

```json
{
  "type": "part",
  "channel": "#lobby",
  "message": "Goodbye"  // optional
}
```

##### `privmsg`

Send message to channel or user:

```json
{
  "type": "privmsg",
  "target": "#channel",  // or "nickname"
  "message": "Hello world"
}
```

##### `notice`

Send notice (non-auto-reply message):

```json
{
  "type": "notice",
  "target": "#channel",
  "message": "Bot restarting in 60s"
}
```

##### `nick`

Change nickname:

```json
{
  "type": "nick",
  "nickname": "newbot"
}
```

##### `quit`

Disconnect with quit message:

```json
{
  "type": "quit",
  "message": "Leaving"  // optional, default "Leaving"
}
```

##### `topic`

Query or set channel topic:

```json
{
  "type": "topic",
  "channel": "#lobby",
  "topic": "New topic text"  // omit to query current topic
}
```

##### `names`

Request channel member list:

```json
{
  "type": "names",
  "channel": "#lobby"
}
```

Responds with `353 RPL_NAMREPLY` messages.

##### `list`

Request channel list:

```json
{
  "type": "list"
}
```

Responds with `322 RPL_LIST` for each channel.

##### `whois`

Query user information:

```json
{
  "type": "whois",
  "nickname": "alice"
}
```

##### `kick`

Kick user from channel (requires ops):

```json
{
  "type": "kick",
  "channel": "#lobby",
  "user": "spammer",
  "reason": "Spam"  // optional
}
```

##### `mode`

Set channel or user mode:

```json
{
  "type": "mode",
  "target": "#lobby",  // or nickname
  "mode": "+o alice",
  "params": ""  // optional additional parameters
}
```

##### `invite`

Invite user to channel:

```json
{
  "type": "invite",
  "nick": "alice",
  "channel": "#private"
}
```

##### `away`

Set or clear away status:

```json
{
  "type": "away",
  "message": "Out to lunch"  // omit to clear away status
}
```

##### `ctcp`

Send CTCP request (e.g., ACTION for /me, VERSION, PING):

```json
{
  "type": "ctcp",
  "target": "#channel",  // or nickname
  "ctcp": "ACTION",
  "args": "waves hello"  // optional
}
```

**Produces:** `PRIVMSG #channel :\x01ACTION waves hello\x01`

Common CTCP commands: `ACTION` (=/me=), `VERSION`, `PING`, `TIME`, `FINGER`, `CLIENTINFO`.

##### `ctcp-reply`

Reply to CTCP request (uses NOTICE):

```json
{
  "type": "ctcp-reply",
  "target": "alice",
  "ctcp": "VERSION",
  "args": "MyIRCBot v1.0"  // optional
}
```

**Produces:** `NOTICE alice :\x01VERSION MyIRCBot v1.0\x01`

##### `cap`

Manual IRCv3 capability negotiation:

```json
{
  "type": "cap",
  "subcommand": "LIST"  // LS, LIST, REQ, END, etc.
  "params": ""  // optional capability list for REQ
}
```

##### `userhost`

Query userhost information (RFC 1459 §4.8):

```json
{
  "type": "userhost",
  "nicks": ["alice", "bob", "carol"]  // max 5 nicknames
}
```

Worker automatically truncates to first 5 nicknames.

## IRC Message Flow

### Registration (HTTP Mode)

1. Worker sends `PASS password` (if provided)
2. Worker sends `NICK nickname`
3. Worker sends `USER username 0 * :realname`
4. Server responds with:
   - `001 RPL_WELCOME` — registration complete
   - `002 RPL_YOURHOST` — server info
   - `003 RPL_CREATED` — server creation date
   - `004 RPL_MYINFO` — server version and modes
   - `005 RPL_ISUPPORT` — extended server features
   - `251-255` — LUSERS stats
   - `375 RPL_MOTDSTART` — MOTD header
   - `372 RPL_MOTD` — MOTD line (multiple)
   - `376 RPL_ENDOFMOTD` — MOTD end (or `422 ERR_NOMOTD`)
5. Worker sends `QUIT :Port of Call TLS test`
6. Worker closes socket

**Max read time:** 10 seconds from registration start
**Timeout per read:** 5 seconds
**Overall connection timeout:** 30 seconds

### Registration (WebSocket Mode with SASL)

1. Worker sends `PASS password` (if provided)
2. Worker sends `CAP LS 302` (IRCv3.2 capability negotiation)
3. Worker sends `NICK nickname`
4. Worker sends `USER username 0 * :realname`
5. Server responds with `CAP * LS :sasl multi-prefix ...`
6. Worker checks if `sasl` capability is available and credentials provided
7. If SASL available:
   - Worker sends `CAP REQ sasl`
   - Server sends `CAP * ACK :sasl`
   - Worker sends `AUTHENTICATE PLAIN`
   - Server sends `AUTHENTICATE +`
   - Worker sends `AUTHENTICATE <base64(account\0account\0password)>`
   - Server sends `903 RPL_SASLSUCCESS` or `904-907` failure codes
   - Worker sends `CAP END`
8. If SASL not needed:
   - Worker sends `CAP END` immediately
9. Server completes registration with `001`-`376` messages
10. If `channels` parameter provided, worker auto-joins each channel

### Auto-PING Response

Worker automatically responds to `PING` messages with `PONG` in both modes:

```
Server: PING :server1.example.com
Worker: PONG :server1.example.com
```

This keeps the connection alive without client intervention. PING/PONG messages are still forwarded to the browser in WebSocket mode.

## Nickname Validation

Per RFC 2812 §2.3.1, nicknames must:

- Start with letter or special character: `[a-zA-Z\[\]\\`_^{|}]`
- Contain only alphanumeric, special, or hyphen: `[a-zA-Z0-9\[\]\\`_^{|}\-]`
- Maximum 30 characters (RFC 2812 allows 9, modern servers extend to 30)

**Valid:** `alice`, `bob123`, `test_bot`, `[Guest]`, `user^away`
**Invalid:** `123bot` (starts with digit), `alice bob` (space), `user@host` (@ not allowed)

## Common IRC Numeric Replies

| Code | Name | Description |
|------|------|-------------|
| `001` | `RPL_WELCOME` | Welcome message, registration complete |
| `002` | `RPL_YOURHOST` | Server hostname and version |
| `004` | `RPL_MYINFO` | Server version, user modes, channel modes |
| `005` | `RPL_ISUPPORT` | Extended server features (CHANTYPES, PREFIX, NETWORK, etc.) |
| `353` | `RPL_NAMREPLY` | Channel member list (multiple messages) |
| `366` | `RPL_ENDOFNAMES` | End of NAMES list |
| `372` | `RPL_MOTD` | MOTD line |
| `375` | `RPL_MOTDSTART` | MOTD start |
| `376` | `RPL_ENDOFMOTD` | MOTD end |
| `422` | `ERR_NOMOTD` | No MOTD available |
| `433` | `ERR_NICKNAMEINUSE` | Nickname already in use |
| `903` | `RPL_SASLSUCCESS` | SASL authentication successful (IRCv3) |
| `904` | `ERR_SASLFAIL` | SASL authentication failed |
| `905` | `ERR_SASLTOOLONG` | SASL credentials too long |
| `906` | `ERR_SASLABORTED` | SASL authentication aborted |
| `907` | `ERR_SASLALREADY` | Already authenticated |

## SASL PLAIN Authentication (IRCv3)

SASL PLAIN per RFC 4616 §2:

```
AUTHENTICATE PLAIN
Server: AUTHENTICATE +
Client: AUTHENTICATE <base64(authzid\0authcid\0password)>
Server: 903 RPL_SASLSUCCESS
```

This implementation uses account name for both `authzid` and `authcid`:

```javascript
const credentials = `${saslUsername}\0${saslUsername}\0${saslPassword}`;
const base64 = btoa(credentials);
// Send: AUTHENTICATE <base64>
```

**Security warning:** SASL PLAIN sends credentials in base64 (not encrypted). Always use TLS (IRCS) when using SASL PLAIN. Over plaintext IRC (port 6667), credentials are visible to network observers.

## IRCv3 Capabilities

Common capabilities advertised by modern IRC servers:

| Capability | Description | Spec |
|------------|-------------|------|
| `sasl` | SASL authentication | IRCv3.1 |
| `multi-prefix` | Multiple mode prefixes in NAMES/WHO | IRCv3.1 |
| `away-notify` | Real-time away status notifications | IRCv3.1 |
| `account-notify` | Account name change notifications | IRCv3.1 |
| `extended-join` | Extended JOIN with account/realname | IRCv3.1 |
| `account-tag` | Account name in message tags | IRCv3.2 |
| `cap-notify` | Runtime CAP NEW/DEL notifications | IRCv3.2 |
| `chghost` | Host change notifications | IRCv3.2 |
| `invite-notify` | Channel invite notifications | IRCv3.2 |
| `message-tags` | Arbitrary message tags | IRCv3.2 |
| `server-time` | Server timestamps in message tags | IRCv3.2 |
| `batch` | Batch message grouping | IRCv3.2 |
| `labeled-response` | Request/response correlation | IRCv3.2 |
| `echo-message` | Echo sent messages back to client | IRCv3.2 |
| `sasl=PLAIN,EXTERNAL` | Available SASL mechanisms | IRCv3.2 |

This implementation only actively uses `sasl` capability. All other capabilities are reported to the browser but not automatically requested. Use the `cap` command type to manually negotiate additional capabilities.

## Known Limitations and Quirks

### 1. CAP REQ format uses single-word parameter (not trailing)

**Code:** `CAP REQ sasl\r\n` (line 444)
**IRCv3 spec:** Both `CAP REQ sasl` and `CAP REQ :sasl` are valid for single capabilities. For multiple capabilities, must use `CAP REQ :sasl multi-prefix`.
**Impact:** Code only requests single capability 'sasl'. If future versions add multi-capability support, will need to use trailing parameter format.
**Status:** Correct for current usage.

### 2. CAP LS multiline continuation not handled

**Current behavior:** When server sends capabilities list across multiple `CAP * LS` messages with `*` continuation marker (e.g., `CAP * LS * :cap1 cap2 ...`), only the last batch is processed.
**IRCv3.2 spec:** `CAP LS` with `*` in params[2] indicates more capabilities coming in next message.
**Impact:** Servers with 20+ capabilities may not have all capabilities visible to client.
**Affected servers:** Large networks with many IRCv3 extensions (rare on 2024 IRC servers).
**Fix:** Track `CAP LS` continuation state and accumulate capabilities across messages.

### 3. CAP NEW/DEL runtime notifications not handled

**Current behavior:** `CAP * NEW` and `CAP * DEL` messages during active session are forwarded as `irc-message` but not specially processed.
**IRCv3.2 spec:** Servers can enable new capabilities at runtime (e.g., SASL becomes available mid-session).
**Impact:** Client code must manually watch for `CAP` messages with `NEW`/`DEL` subcommands.
**Workaround:** Subscribe to `irc-message` and filter for `msg.parsed.command === 'CAP'`.

### 4. No SASL mechanism negotiation

**Current behavior:** Always uses SASL PLAIN mechanism if `sasl` capability is available.
**IRCv3 spec:** Servers may advertise `sasl=PLAIN,SCRAM-SHA-256,EXTERNAL` with available mechanisms.
**Impact:** Cannot use SCRAM-SHA-256 (stronger than PLAIN) or EXTERNAL (CertFP) authentication.
**Workaround:** None. PLAIN is widely supported and secure over TLS.

### 5. No nickname collision handling

**Current behavior:** If nickname is in use (433 ERR_NICKNAMEINUSE), error is forwarded to browser as `irc-message` but worker doesn't auto-retry with alternate nickname.
**Impact:** Browser must implement fallback logic (e.g., append underscore, prompt user).
**RFC 2812:** Clients should try alternate nicknames or prompt user.

### 6. Auto-join channels fires immediately after 376/422

**Current behavior:** Channels specified in `channels` parameter are joined immediately after registration completes (376 RPL_ENDOFMOTD or 422 ERR_NOMOTD).
**Issue:** If SASL failed (904-907), registration never completes, so channels are never joined. If nickname collision occurs, user is not registered, but JOIN may still fire (server will reject with 451 ERR_NOTREGISTERED).
**Best practice:** Browser should wait for `001 RPL_WELCOME` before considering user fully registered.

### 7. No channel name validation

**Current behavior:** Channels in `channels` parameter and `join` command are sent to server without validation.
**RFC 2812 §1.3:** Valid channel names: `#` (network-wide), `&` (server-local), `+` (modeless), `!` (safe channels). Max 50 characters, no space/comma/^G.
**Impact:** Malformed channel names cause server errors (403 ERR_NOSUCHCHANNEL).
**Workaround:** Server rejects invalid channels harmlessly.

### 8. USERHOST command truncates to 5 nicknames without error

**Code:** `(cmd.nicks as string[]).slice(0, 5)` (line 368)
**RFC 1459 §4.8:** USERHOST accepts up to 5 nicknames.
**Impact:** Silently drops nicknames 6+ in array without notifying browser.
**Recommended:** Return error or warning if `cmd.nicks.length > 5`.

### 9. No PING flood protection

**Current behavior:** Worker auto-responds to every PING message immediately.
**Attack vector:** Malicious server sends rapid PING flood, causing worker to send unlimited PONG responses.
**Impact:** CPU/network exhaustion, potential DoS of Cloudflare Worker.
**Recommended:** Rate limit to max 10 PONGs per 30 seconds, ignore excess PINGs.

### 10. No WHO/MODE/WHOWAS commands

**Missing JSON commands:** `who`, `mode` (query only), `whowas`, `ison`, `links`, `admin`, `info`, `motd`, `lusers`, `version`, `stats`, `time`, `kill`, `rehash`, `restart`.
**Workaround:** Use `raw` command type for unsupported commands.
**Example:** `{"type":"raw","command":"WHO #lobby"}`

### 11. No message rate limiting

**Current behavior:** Browser can send unlimited messages per second via WebSocket.
**IRC server behavior:** Most servers enforce flood limits (e.g., max 5 messages per 2 seconds), will throttle or disconnect flooding clients.
**Impact:** Sending too fast triggers server-side throttling or K-line (ban).
**Recommended:** Implement client-side rate limiter (e.g., max 2 messages/second for PRIVMSG).

### 12. No connection timeout in WebSocket mode

**HTTP mode:** 30-second overall timeout.
**WebSocket mode:** No timeout — connection stays open indefinitely until server closes or browser disconnects.
**Impact:** Stale connections may accumulate if browser closes without sending QUIT.
**Cloudflare Workers behavior:** WebSocket connections time out after idle period (varies by plan, typically 60-300 seconds).

### 13. TLS certificate not validated against server hostname

**Current behavior:** Cloudflare Workers' `connect()` API with `secureTransport: 'on'` validates TLS certificate against standard CA trust store.
**Issue:** No explicit check that certificate CN/SAN matches provided `host` parameter.
**Security impact:** LOW — underlying TLS stack likely performs hostname validation, but not explicitly documented.
**Recommended:** Test with self-signed cert to confirm validation behavior.

### 14. Cloudflare detection before TLS connection

**Current behavior:** Worker calls `checkIfCloudflare(host)` and blocks connection if target is behind Cloudflare proxy.
**Reason:** Cloudflare blocks outbound connections to other Cloudflare IPs to prevent abuse loops.
**Impact:** Cannot connect to IRC servers behind Cloudflare (e.g., `irc.example.com` CNAMEd to Cloudflare).
**Workaround:** Connect via IP address instead of hostname (bypasses DNS-based CF detection).
**Limitation:** IP-based connection fails if server requires SNI (Server Name Indication) for TLS certificate selection.

### 15. No IRCv3 message-tags parsing in parseIRCMessage

**Current behavior:** `parseIRCMessage()` from `irc.ts` supports IRCv3 message tags (`@key=value; ...`).
**Validation:** Checked in `irc.ts:37-64`, tag escaping is correctly implemented (\: → ; \s → space \\\\ → \ \r → CR \n → LF).
**Status:** Message tags are fully supported.

### 16. No multi-line message support

**RFC 2812:** Messages are delimited by `\r\n`. Multi-line text (e.g., pasted paragraphs) must be split into multiple PRIVMSG commands.
**Current behavior:** Sending `{"type":"privmsg","target":"#chan","message":"line1\nline2"}` results in malformed IRC command (`PRIVMSG #chan :line1\nline2\r\n`).
**Impact:** Server may reject message or interpret newline as command separator (protocol desync).
**Recommended:** Browser must split multi-line input into separate messages.

## Security Considerations

### 1. SASL PLAIN over TLS

**Mechanism:** SASL PLAIN sends credentials as base64(user\0user\0pass).
**Security:** Base64 is encoding, not encryption. Credentials are visible to anyone with TLS session keys.
**Mitigation:** TLS encrypts all traffic, including SASL payload. Use IRCS (port 6697) always, never plaintext IRC (port 6667) with SASL PLAIN.
**Verification:** Modern IRC servers (Libera.Chat, OFTC, etc.) reject SASL PLAIN over plaintext.

### 2. No server password encryption

**Current behavior:** `password` parameter is sent as `PASS password\r\n` in plaintext over TLS.
**RFC 2812 §3.1.1:** PASS command is cleartext, TLS provides encryption.
**Security:** Same as SASL PLAIN — secure over TLS, insecure over plaintext.

### 3. Auto-PONG response can be abused for DDoS amplification

**Attack:** Malicious server sends flood of PING messages, worker amplifies by sending matching PONG flood.
**Impact:** Worker consumes CPU/network responding to PING flood.
**Mitigation:** Implement rate limiting (see Quirk #9).
**Current status:** No rate limiting implemented (design flaw).

### 4. No SSL certificate pinning

**Current behavior:** Trusts any certificate signed by CA in Workers' trust store.
**Risk:** Nation-state or compromised CA can MITM connection.
**Mitigation:** Not feasible in browser-based tool. Users connecting to sensitive servers should use dedicated IRC client with cert pinning.

### 5. Credentials visible in WebSocket URL

**WebSocket connection:** `wss://...?saslPassword=secret`
**Exposure points:**
- Browser history (saved indefinitely)
- Server access logs (Cloudflare logs all query parameters)
- Referer headers (if browser navigates away mid-session)
- Browser extensions (can intercept WebSocket URLs)

**Recommendation:** Use HTTP POST API instead of WebSocket for automated tools. For interactive use, accept this risk or use dedicated IRC client.

### 6. No channel moderation protection

**Risk:** If browser joins channels with +o (operator) mode, malicious commands could perform destructive actions (KICK, BAN, MODE +b, TOPIC override).
**Mitigation:** Browser UI should confirm destructive commands before sending.

## Example Use Cases

### 1. Quick connectivity test

```bash
curl -X POST https://portofcall.example/api/ircs/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"irc.libera.chat","port":6697,"nickname":"testbot"}'
```

Returns server welcome, version, MOTD in 2-5 seconds.

### 2. Check if server supports SASL

```bash
curl -X POST https://portofcall.example/api/ircs/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"irc.libera.chat","port":6697,"nickname":"testbot"}' \
  | jq '.messages[] | select(.command=="CAP") | .params'
```

Look for `"sasl"` in capabilities list.

### 3. Verify account credentials work

Connect via WebSocket with SASL credentials, watch for `irc-sasl-success` or `irc-sasl-failed` message.

### 4. Interactive IRC client bridge

Build browser IRC client by:
1. Connect WebSocket with credentials
2. Listen for `irc-message` events, render in UI
3. Send `privmsg` commands on user input
4. Handle `433 ERR_NICKNAMEINUSE` by prompting for new nickname
5. Auto-reconnect on `irc-disconnected`

### 5. Monitor channel for keywords

```javascript
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'irc-message' && msg.parsed.command === 'PRIVMSG') {
    const text = msg.parsed.params[1];
    if (text.includes('security alert')) {
      console.log('ALERT:', text);
    }
  }
});
```

### 6. Send announcements to multiple channels

```javascript
const channels = ['#lobby', '#dev', '#ops'];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'irc-connected') {
    // Wait for registration (376)
  } else if (msg.parsed?.command === '376') {
    channels.forEach(ch => {
      ws.send(JSON.stringify({
        type: 'privmsg',
        target: ch,
        message: 'Server maintenance in 30 minutes'
      }));
    });
    ws.send(JSON.stringify({type: 'quit'}));
  }
});
```

## Testing Servers

### Public test servers

| Server | Port | TLS | SASL | Notes |
|--------|------|-----|------|-------|
| `irc.libera.chat` | 6697 | ✓ | ✓ | Requires registered account for SASL, anonymous allowed without SASL |
| `irc.oftc.net` | 6697 | ✓ | ✓ | Open Network for Free Computing |
| `irc.rizon.net` | 6697 | ✓ | ✗ | No SASL, server password only |
| `irc.freenode.net` | 6697 | ✓ | ✓ | Post-2021 Freenode, use Libera.Chat instead |

### Test commands

**Basic registration:**

```bash
curl -X POST http://localhost:8787/api/ircs/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"irc.libera.chat","port":6697,"nickname":"testbot123"}'
```

**Check MOTD:**

```bash
curl -s -X POST http://localhost:8787/api/ircs/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"irc.libera.chat","port":6697,"nickname":"testbot123"}' \
  | jq -r '.motd'
```

**Measure connection latency:**

```bash
time curl -s -X POST http://localhost:8787/api/ircs/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"irc.libera.chat","port":6697,"nickname":"testbot123"}' > /dev/null
```

**WebSocket test (Node.js):**

```javascript
import WebSocket from 'ws';

const ws = new WebSocket(
  'ws://localhost:8787/api/ircs/ws?host=irc.libera.chat&port=6697&nickname=testbot123'
);

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  console.log(msg.type, msg);

  if (msg.parsed?.command === '376') {
    // Registration complete, join channel
    ws.send(JSON.stringify({type: 'join', channel: '#test'}));
  }
});

setTimeout(() => ws.close(), 30000); // Auto-close after 30s
```

## References

### RFCs
- **RFC 1459** — Internet Relay Chat Protocol (original, 1993)
- **RFC 2810** — IRC Architecture
- **RFC 2811** — IRC Channel Management
- **RFC 2812** — IRC Client Protocol (supersedes RFC 1459)
- **RFC 2813** — IRC Server Protocol
- **RFC 7194** — Default Port for IRC via TLS/SSL (port 6697)
- **RFC 4616** — SASL PLAIN mechanism

### IRCv3 Specifications
- **IRCv3.1** — https://ircv3.net/specs/core/capability-negotiation.html
- **IRCv3.2** — https://ircv3.net/specs/extensions/capability-negotiation.html
- **SASL 3.1** — https://ircv3.net/specs/extensions/sasl-3.1.html
- **Message Tags** — https://ircv3.net/specs/extensions/message-tags.html

### Related Documentation
- `/docs/protocols/IRC.md` — Plaintext IRC (port 6667) implementation reference
- `/src/worker/irc.ts` — Plaintext IRC implementation with shared parser
- `/src/worker/ircs.ts` — This IRCS implementation (TLS-only)

### Tools
- **WeeChat** — https://weechat.org/ (terminal IRC client with SASL support)
- **irssi** — https://irssi.org/ (classic terminal IRC client)
- **Hexchat** — https://hexchat.github.io/ (GUI IRC client)
- **Textual** — https://www.codeux.com/textual/ (macOS IRC client)

### Network documentation
- **Libera.Chat** — https://libera.chat/guides/registration (SASL setup guide)
- **OFTC** — https://www.oftc.net/NickServ/ (NickServ registration)
