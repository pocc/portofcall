# IRC / IRCS — Implementation Reference

**Protocol:** IRC (RFC 1459 / RFC 2812) + IRCv3 extensions
**Files:** `src/worker/irc.ts`, `src/worker/ircs.ts`
**Ports:** 6667 (plaintext IRC), 6697 (implicit-TLS IRCS)
**Routes:**
- `POST /api/irc/connect` — connection probe (plaintext)
- `GET /api/irc/connect` (WebSocket upgrade) — interactive session (plaintext)
- `POST /api/ircs/connect` — connection probe (TLS)
- `GET /api/ircs/connect` (WebSocket upgrade) — interactive session (TLS)

---

## Connection Probe

### Request

```
POST /api/irc/connect           (plaintext)
POST /api/ircs/connect          (TLS)
Content-Type: application/json
```

```json
{
  "host": "irc.libera.chat",
  "port": 6667,
  "nickname": "porttest",
  "username": "porttest",
  "realname": "Port of Call",
  "password": "serverpass",
  "channels": []
}
```

All fields except `host` and `nickname` are optional. `password` is the IRC server password (`PASS`), not NickServ/SASL.

### What it does

1. Connects TCP (plaintext) or TLS (IRCS)
2. Sends `CAP LS 302` + `NICK` + `USER` (and optionally `PASS`)
3. Reads server output until `376 End of /MOTD` or `422 MOTD File Missing` (whichever comes first, 10 s cap)
4. Sends `QUIT`, closes

### Response

```json
{
  "success": true,
  "host": "irc.libera.chat",
  "port": 6667,
  "tls": false,
  "rtt": 42,
  "nickname": "porttest",
  "welcome": "Welcome to the Libera.Chat Internet Relay Chat Network porttest",
  "serverInfo": "chopin.libera.chat InspIRCd-3 dioswkgxXbe-c bIiklmnopstv :abcdefghijklmnopqrstuvwxyz",
  "motd": "...",
  "messagesReceived": 32,
  "messages": [...]
}
```

`rtt` (ms from TCP open to `socket.opened`) is only present in IRCS responses. `messages` is capped at 50 entries.

### Important limits

- `CAP END` is **not** sent during the probe — the server holds off some numerics until CAP negotiation ends. If the server sends 376 before CAP END, the probe terminates normally. If not, it times out at 10 s.
- Nickname collision (`433 ERR_NICKNAMEINUSE`) is **not** retried — the probe returns a partial failure with the 433 message included in `messages`.
- SASL is **not** performed in the probe.

---

## Interactive WebSocket Session

### Connecting

```
GET /api/irc/connect?host=...&nickname=...    (plaintext, port 6667)
GET /api/ircs/connect?host=...&nickname=...   (TLS, port 6697)
Upgrade: websocket
```

Query parameters:

| Param | Default | Description |
|-------|---------|-------------|
| `host` | (required) | IRC server hostname |
| `port` | 6667 / 6697 | TCP port |
| `nickname` | (required) | IRC nick (validated with `validateNickname`) |
| `username` | = nickname | USER ident |
| `realname` | = nickname | USER gecos / real name |
| `password` | `` | Server password (PASS command) |
| `channels` | `` | Comma-separated channels to auto-join after 376/422 |
| `saslUsername` | `` | SASL PLAIN account name (enables SASL) |
| `saslPassword` | `` | SASL PLAIN password |

### Registration sequence

**Without SASL:**
```
→ CAP LS 302
→ NICK <nick>
→ USER <user> 0 * :<realname>
← CAP * LS <caps>           (worker sends CAP END, reports caps via irc-caps event)
← 001 :Welcome ...
← 376 :End of /MOTD         (worker auto-joins channels, registration complete)
```

**With SASL PLAIN** (`saslUsername` + `saslPassword` provided, server has `sasl` cap):
```
→ CAP LS 302
→ NICK <nick>
→ USER <user> 0 * :<realname>
← CAP * LS ... sasl ...      (worker sends CAP REQ :sasl)
→ CAP REQ :sasl
← CAP * ACK :sasl            (worker sends AUTHENTICATE PLAIN)
→ AUTHENTICATE PLAIN
← AUTHENTICATE +             (worker sends base64 creds)
→ AUTHENTICATE <base64(account\0account\0password)>
← 900 * <nick> <account> :You are now logged in
← 903 * :SASL authentication successful  (worker sends CAP END)
→ CAP END
← 001 :Welcome ...
← 376 :End of /MOTD
```

If SASL fails (904/905/906/907), the WebSocket closes with an `irc-sasl-failed` event.

---

## Worker → Browser events

All inbound IRC lines are forwarded as:

```json
{ "type": "irc-message", "raw": ":nick!user@host PRIVMSG #chan :hello", "parsed": { ... } }
```

`parsed` shape:
```typescript
{
  tags?: Record<string, string>;  // IRCv3 @key=value tags, if present
  prefix?: string;                // "nick!user@host" or "server.name"
  command: string;                // "PRIVMSG", "001", "CAP", etc.
  params: string[];               // positional parameters
  timestamp: number;              // Date.now() when line was processed
}
```

**IRCv3 message tags** — if the server sends a line like:
```
@time=2024-01-01T12:00:00.000Z;msgid=abc123 :nick!user@host PRIVMSG #chan :hello
```
…`parsed.tags` will be `{ "time": "2024-01-01T12:00:00.000Z", "msgid": "abc123" }`. Tag values are unescaped per IRCv3 spec (`\:` → `;`, `\s` → space, `\\` → `\`).

Additional event types:

| Event | When sent |
|-------|-----------|
| `{ type: "irc-connected", host, port, tls?, message }` | TCP connection established, before registration |
| `{ type: "irc-caps", caps: string[] }` | Server `CAP LS` received; `caps` = available capability names |
| `{ type: "irc-cap-ack", caps: string[] }` | Server acknowledged requested caps |
| `{ type: "irc-cap-nak", caps: string }` | Server rejected requested caps |
| `{ type: "irc-sasl-success", message }` | 903 — SASL authentication accepted |
| `{ type: "irc-sasl-failed", code, message }` | 904/905/906/907 — SASL authentication rejected |
| `{ type: "irc-disconnected", message }` | Server closed the TCP connection |
| `{ type: "error", error }` | Worker-side error |

---

## Browser → Worker commands

Send JSON over the WebSocket. Any string that fails `JSON.parse` is sent verbatim as a raw IRC line (with `\r\n` appended).

### Full command reference

```json
{ "type": "raw", "command": "WHOIS porttest" }
```
Send any raw IRC command. No length or safety checks are applied.

```json
{ "type": "privmsg", "target": "#libera", "message": "hello" }
```
Send a `PRIVMSG`. `target` may be a channel or a nick.

```json
{ "type": "notice", "target": "#libera", "message": "announcement" }
```
Send a `NOTICE`. Servers and IRC etiquette distinguish NOTICE from PRIVMSG: servers do not auto-reply to NOTICEs.

```json
{ "type": "join", "channel": "#linux" }
```
Join a channel. Key-protected channels: `{ "type": "raw", "command": "JOIN #secret key" }`.

```json
{ "type": "part", "channel": "#linux", "message": "goodbye" }
```
Part a channel. `message` is optional.

```json
{ "type": "nick", "nickname": "newnick" }
```
Change nickname. The server may reject with `433 ERR_NICKNAMEINUSE`.

```json
{ "type": "topic", "channel": "#dev", "topic": "new topic" }
```
Set channel topic. Omit `topic` to query the current topic.

```json
{ "type": "names", "channel": "#linux" }
```
Request nick list for a channel. Expect `353 RPL_NAMREPLY` + `366 RPL_ENDOFNAMES` messages.

```json
{ "type": "whois", "nickname": "alice" }
```
Query user info. Expect `311 RPL_WHOISUSER` + related numerics.

```json
{ "type": "mode", "target": "#linux", "mode": "+o", "params": "alice" }
```
Set a channel or user mode. `params` is optional (required for some modes like `+o`, `+b`, `+l`).

```json
{ "type": "kick", "channel": "#linux", "user": "troll", "reason": "off-topic" }
```
Kick a user. Requires channel operator status (+o). `reason` is optional.

```json
{ "type": "invite", "nick": "alice", "channel": "#private" }
```
Invite a user to a channel.

```json
{ "type": "away", "message": "lunch" }
```
Set away status. Omit `message` (or send `""`) to return from away.

```json
{ "type": "ctcp", "target": "#linux", "ctcp": "ACTION", "args": "nods" }
```
Send a CTCP request via `PRIVMSG`. Common ctcp values: `ACTION` (/me), `VERSION`, `PING`, `TIME`, `CLIENTINFO`. Args are optional.

```json
{ "type": "ctcp-reply", "target": "alice", "ctcp": "VERSION", "args": "Port of Call 1.0" }
```
Send a CTCP reply via `NOTICE`. Used to respond to incoming CTCP queries.

```json
{ "type": "userhost", "nicks": ["alice", "bob", "charlie"] }
```
Query `USERHOST` for up to 5 nicks. Returns `302 RPL_USERHOST` with `nick=±user@host` entries.

```json
{ "type": "list" }
```
Request the full channel list (`LIST`). On large networks this returns thousands of lines and may cause flooding. Prefer `LIST #pattern` via `raw`.

```json
{ "type": "quit", "message": "be back later" }
```
Send QUIT and close the session.

```json
{ "type": "cap", "subcommand": "LIST" }
{ "type": "cap", "subcommand": "REQ", "params": "away-notify account-notify" }
```
Send arbitrary `CAP` commands mid-session (for dynamic capability negotiation).

---

## Detecting CTCP in incoming messages

Incoming CTCP requests arrive as `PRIVMSG` with `\x01` delimiters in the last param:

```javascript
ws.onmessage = ({ data }) => {
  const { type, parsed } = JSON.parse(data);
  if (type === 'irc-message' && parsed.command === 'PRIVMSG') {
    const text = parsed.params[1] ?? '';
    if (text.startsWith('\x01') && text.endsWith('\x01')) {
      const inner = text.slice(1, -1);
      const [ctcp, ...args] = inner.split(' ');
      console.log('CTCP', ctcp, args.join(' '), 'from', parsed.prefix);
      // Reply with ctcp-reply:
      ws.send(JSON.stringify({ type: 'ctcp-reply', target: parsed.prefix.split('!')[0], ctcp, args: '...' }));
    }
  }
};
```

---

## Minimal browser snippet

```javascript
const ws = new WebSocket(
  'wss://portofcall.example/api/ircs/connect' +
  '?host=irc.libera.chat&nickname=porttest&channels=%23libera' +
  '&saslUsername=myaccount&saslPassword=secret'
);

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  switch (msg.type) {
    case 'irc-connected':   console.log('TCP open'); break;
    case 'irc-caps':        console.log('Server caps:', msg.caps); break;
    case 'irc-sasl-success':console.log('Authenticated'); break;
    case 'irc-sasl-failed': console.error('SASL fail:', msg.message); break;
    case 'irc-message':
      const { parsed } = msg;
      if (parsed.command === 'PRIVMSG') {
        console.log(`<${parsed.prefix?.split('!')[0]}> ${parsed.params[1]}`);
      }
      break;
    case 'irc-disconnected': ws.close(); break;
  }
};

// After registration (wait for irc-message with command "376" or "422")
function sendMessage(target, text) {
  ws.send(JSON.stringify({ type: 'privmsg', target, message: text }));
}
function meAction(channel, action) {
  ws.send(JSON.stringify({ type: 'ctcp', target: channel, ctcp: 'ACTION', args: action }));
}
```

---

## Nickname validation

`validateNickname(nick)` enforces RFC 2812: 1–30 chars, starts with `[a-zA-Z\[\]\\` + backtick + `_^{|}]`, rest may also include digits and `-`. Applied at the HTTP level; the server may have stricter rules.

---

## Known limitations

- **No STARTTLS** — plaintext IRC (`/api/irc/connect`) uses no TLS; for encrypted connections use `/api/ircs/connect` (implicit TLS port 6697). There is no mid-stream STARTTLS upgrade.
- **CAP LS sent in probe but CAP END is not guaranteed** — the probe exits on `376`/`422` regardless of CAP negotiation state. Some servers hold that numeric until CAP END; those probes will time out at 10 s.
- **SASL mechanisms** — only `PLAIN` is implemented. `EXTERNAL`, `SCRAM-SHA-256`, `ECDSA-NIST256P-CHALLENGE` (used by some servers) are not supported.
- **Multi-line CAP LS** — large `CAP LS` responses use multiple continuation lines ending with `*`. The implementation reads the last line (the one without `*`). Capabilities only listed in a continuation line may be missed. This is rare in practice.
- **No flood throttling** — the `raw` command type allows unrestricted writes. IRC servers apply flood-protection kicks; the Worker does not rate-limit outbound lines.
- **No DCC** — Direct Client-to-Client file transfer / chat requires P2P connections; not possible from a Worker.

---

## Public servers for testing

| Network | Plaintext | TLS | Notes |
|---------|-----------|-----|-------|
| Libera.Chat | `irc.libera.chat:6667` | `irc.libera.chat:6697` | SASL required for registered accounts |
| OFTC | `irc.oftc.net:6667` | `irc.oftc.net:6697` | Debian/open source community |
| EFnet | `irc.efnet.org:6667` | — | Legacy network, no SASL |
| IRCNet | `open.ircnet.net:6667` | — | European network |

---

## Resources

- [RFC 2812](https://tools.ietf.org/html/rfc2812) — IRC Client Protocol
- [Modern IRC (ircdocs.horse)](https://modern.ircdocs.horse/) — authoritative modern reference
- [IRCv3 Specifications](https://ircv3.net/specs/) — capabilities, message tags, SASL
- [IRCv3 SASL](https://ircv3.net/specs/extensions/sasl-3.1) — authentication framework
