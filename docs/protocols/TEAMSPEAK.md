# TEAMSPEAK — TeamSpeak 3 ServerQuery Protocol

**Port:** 10011 (TCP, default ServerQuery port)
**Spec:** TeamSpeak 3 ServerQuery Manual
**Implementation:** `src/worker/teamspeak.ts`
**Routes:** `POST /api/teamspeak/connect`, `POST /api/teamspeak/command`, `POST /api/teamspeak/channel`, `POST /api/teamspeak/message`, `POST /api/teamspeak/kick`, `POST /api/teamspeak/ban`

---

## Overview

TeamSpeak 3 ServerQuery is a text-based TCP protocol for administering TeamSpeak servers. It runs on port 10011 by default (separate from the voice port 9987). Commands are sent as plaintext lines terminated by `\n`, and responses are key=value pairs separated by spaces and pipes, terminated by an `error id=X msg=...` line followed by `\r\n`.

**Key characteristics:**
- Text-based protocol with escape sequences (`\s` = space, `\p` = pipe, `\\` = backslash, etc.)
- No encryption (plaintext credentials over TCP)
- Session-based: banner → commands → `quit`
- Multi-item responses separated by `|`
- Error responses always present (`error id=0 msg=ok` for success)

---

## Endpoints

### `POST /api/teamspeak/connect`

Connects to a TeamSpeak server, reads the banner, and executes `version` and `whoami` commands to verify connectivity.

**Request**

```json
{
  "host":    "ts3.example.com",  // required
  "port":    10011,               // default 10011
  "timeout": 10000                // ms, default 10000
}
```

**Response — success**

```json
{
  "success": true,
  "server": "ts3.example.com:10011",
  "banner": "TS3\r\nWelcome to the TeamSpeak 3 ServerQuery interface...",
  "version": [
    { "key": "version", "value": "3.13.7" },
    { "key": "build", "value": "1655727713" },
    { "key": "platform", "value": "Linux" }
  ],
  "whoami": [
    { "key": "virtualserver_status", "value": "online" },
    { "key": "virtualserver_id", "value": "1" },
    { "key": "client_id", "value": "0" }
  ]
}
```

**Response — connection error**

```json
{
  "success": false,
  "server": "",
  "error": "Connection timeout"
}
```

**Banner format:** The TeamSpeak server sends `TS3` followed by a welcome message ending with `\r\n`. This endpoint validates the banner starts with `TS3` before proceeding.

---

### `POST /api/teamspeak/command`

Executes a single read-only ServerQuery command and returns the parsed response.

**Request**

```json
{
  "host":    "ts3.example.com",  // required
  "port":    10011,               // default 10011
  "command": "clientlist",        // required
  "timeout": 10000                // ms, default 10000
}
```

**Command whitelist:** Only safe read-only commands are allowed:
- `version`, `whoami`, `serverinfo`, `clientlist`, `channellist`
- `hostinfo`, `instanceinfo`, `serverlist`, `servergrouplist`
- `channelgrouplist`, `servergroupclientlist`, `channelgroupclientlist`
- `permissionlist`, `serversnapshotcreate`, `logview`
- `clientinfo`, `channelinfo`, `clientfind`, `channelfind`
- `help`

**Response — success**

```json
{
  "success": true,
  "server": "ts3.example.com:10011",
  "command": "clientlist",
  "items": [
    [
      { "key": "clid", "value": "1" },
      { "key": "cid", "value": "1" },
      { "key": "client_database_id", "value": "1" },
      { "key": "client_nickname", "value": "ServerAdmin" },
      { "key": "client_type", "value": "0" }
    ],
    [
      { "key": "clid", "value": "5" },
      { "key": "cid", "value": "2" },
      { "key": "client_database_id", "value": "23" },
      { "key": "client_nickname", "value": "Guest" },
      { "key": "client_type", "value": "0" }
    ]
  ],
  "errorId": 0,
  "errorMsg": "ok",
  "raw": "clid=1 cid=1 client_database_id=1 client_nickname=ServerAdmin client_type=0|clid=5..."
}
```

**Response — command not allowed**

```json
{
  "success": false,
  "server": "",
  "error": "Command \"serverstart\" is not allowed. Only read-only commands are permitted."
}
```

**Response — ServerQuery error**

```json
{
  "success": false,
  "server": "ts3.example.com:10011",
  "command": "clientlist",
  "errorId": 1024,
  "errorMsg": "invalid serverID",
  "raw": "error id=1024 msg=invalid\\sserverID",
  "error": "ServerQuery error 1024: invalid serverID"
}
```

**Raw output limit:** The `raw` field is truncated to 5000 characters to prevent memory exhaustion.

---

### `POST /api/teamspeak/channel`

Lists all channels on a TeamSpeak server and optionally creates a new permanent channel if `serverAdminToken` and `channelName` are provided.

**Request**

```json
{
  "host":             "ts3.example.com",  // required
  "port":             10011,               // default 10011
  "timeout":          10000,               // ms, default 10000
  "serverAdminToken": "AAABBBCCC",         // optional
  "channelName":      "New Channel",       // optional (requires token)
  "channelTopic":     "Topic text"         // optional
}
```

**Authentication:** If `serverAdminToken` is provided, the handler logs in with `login serveradmin <token>` and selects virtual server 1 (`use sid=1`) before executing `channellist`. If `channelName` is also provided, it creates a permanent channel with `channelcreate channel_name=... channel_flag_permanent=1`.

**Response — success**

```json
{
  "success": true,
  "server": "ts3.example.com:10011",
  "channels": [
    {
      "cid": "1",
      "name": "Default Channel",
      "topic": "",
      "clientsOnline": "2",
      "maxClients": "-1"
    },
    {
      "cid": "2",
      "name": "AFK",
      "topic": "Away from keyboard",
      "clientsOnline": "0",
      "maxClients": "8"
    }
  ],
  "newChannelId": "42",  // only if channelName was provided
  "errorId": 0,
  "errorMsg": "ok"
}
```

**Response — login failed**

```json
{
  "success": false,
  "server": "ts3.example.com:10011",
  "errorId": 520,
  "errorMsg": "invalid loginname or password",
  "error": "Login failed: invalid loginname or password"
}
```

**Channel fields:**
- `cid`: Channel ID (unique per virtual server)
- `name`: Channel name (unescaped)
- `topic`: Channel topic (unescaped)
- `clientsOnline`: Number of clients currently in the channel
- `maxClients`: Max clients allowed (`-1` = unlimited)

---

### `POST /api/teamspeak/message`

Sends a text message to a client, channel, or the entire server via ServerQuery.

**Request**

```json
{
  "host":             "ts3.example.com",  // required
  "port":             10011,               // default 10011
  "timeout":          10000,               // ms, default 10000
  "serverAdminToken": "AAABBBCCC",         // optional (recommended for server/channel messages)
  "targetmode":       3,                   // 1=client, 2=channel, 3=server (default 3)
  "target":           0,                   // client ID (targetmode=1) or channel ID (targetmode=2)
  "message":          "Hello world"        // required
}
```

**Target modes:**
- `1`: Direct message to a specific client (requires `target` = client ID)
- `2`: Message to all clients in a channel (requires `target` = channel ID)
- `3`: Server-wide broadcast (ignores `target`)

**Response — success**

```json
{
  "success": true,
  "server": "ts3.example.com:10011",
  "errorId": 0,
  "errorMsg": "ok"
}
```

**Response — permission error**

```json
{
  "success": false,
  "server": "ts3.example.com:10011",
  "errorId": 2568,
  "errorMsg": "insufficient client permissions",
  "error": "ServerQuery error 2568: insufficient client permissions"
}
```

**Note:** Server-wide and channel messages typically require admin permissions (login with `serverAdminToken`). Client-to-client messages may work without authentication depending on server configuration.

---

### `POST /api/teamspeak/kick`

Kicks a client from the server or channel.

**Request**

```json
{
  "host":             "ts3.example.com",  // required
  "port":             10011,               // default 10011
  "timeout":          10000,               // ms, default 10000
  "serverAdminToken": "AAABBBCCC",         // required
  "clid":             42,                  // client ID to kick (required)
  "reasonid":         5,                   // 4=channel, 5=server (default 5)
  "reasonmsg":        "AFK too long"       // optional
}
```

**Reason IDs:**
- `4`: Kick from channel (client moves to default channel)
- `5`: Kick from server (client disconnects)

**Response — success**

```json
{
  "success": true,
  "server": "ts3.example.com:10011",
  "errorId": 0,
  "errorMsg": "ok"
}
```

**Response — client not found**

```json
{
  "success": false,
  "server": "ts3.example.com:10011",
  "errorId": 512,
  "errorMsg": "invalid clientID",
  "error": "ServerQuery error 512: invalid clientID"
}
```

---

### `POST /api/teamspeak/ban`

Bans a client by client ID. Returns the ban ID on success.

**Request**

```json
{
  "host":             "ts3.example.com",  // required
  "port":             10011,               // default 10011
  "timeout":          10000,               // ms, default 10000
  "serverAdminToken": "AAABBBCCC",         // required
  "clid":             42,                  // client ID to ban (required)
  "time":             3600,                // ban duration in seconds (0 = permanent, default 0)
  "banreason":        "Spamming"           // optional
}
```

**Ban duration:**
- `0`: Permanent ban
- `>0`: Temporary ban (expires after `time` seconds)

**Response — success**

```json
{
  "success": true,
  "server": "ts3.example.com:10011",
  "banid": "123",
  "errorId": 0,
  "errorMsg": "ok"
}
```

**Response — insufficient permissions**

```json
{
  "success": false,
  "server": "ts3.example.com:10011",
  "errorId": 2568,
  "errorMsg": "insufficient client permissions",
  "error": "ServerQuery error 2568: insufficient client permissions"
}
```

**Ban ID:** The `banid` can be used to remove the ban later with the `bandelid` command (not implemented in this API).

---

## Protocol Details

### Escape Sequences

TeamSpeak ServerQuery uses escape sequences to encode special characters:

| Escape | Character | Description |
|--------|-----------|-------------|
| `\s` | space | Space character |
| `\p` | pipe (`\|`) | Item separator |
| `\/` | forward slash (`/`) | Path separator |
| `\\` | backslash (`\`) | Literal backslash |
| `\n` | newline | LF (0x0A) |
| `\r` | carriage return | CR (0x0D) |
| `\t` | tab | Horizontal tab |

**Encoding example:**
```
Input:  "Hello World / Test | Data"
Encoded: "Hello\sWorld\s\/\sTest\s\p\sData"
```

**Decoding order matters:** The unescape function must process `\\` last to avoid false matches. For example, `\\s` should decode to literal `\s`, not backslash-space.

### Response Format

All ServerQuery responses follow this structure:

```
<data line 1>
<data line 2>
...
error id=<N> msg=<message>\r\n
```

**Single-item response (version):**
```
version=3.13.7 build=1655727713 platform=Linux
error id=0 msg=ok\r\n
```

**Multi-item response (clientlist):**
```
clid=1 cid=1 client_nickname=Admin|clid=2 cid=1 client_nickname=Guest
error id=0 msg=ok\r\n
```

**Error response:**
```
error id=1024 msg=invalid\sserverID\r\n
```

**Success:** `error id=0 msg=ok`
**Failure:** `error id=<nonzero> msg=<reason>`

### Connection Flow

```
1. Client connects to port 10011
2. Server sends banner: "TS3\r\nWelcome to the TeamSpeak 3 ServerQuery interface..."
3. Client sends command: "version\n"
4. Server responds: "version=3.13.7 build=1655727713 platform=Linux\nerror id=0 msg=ok\r\n"
5. Client sends: "quit\n"
6. Server closes connection
```

**No keep-alive:** Each API request opens a new connection, executes commands, sends `quit`, and closes. The protocol supports persistent connections, but this implementation does not reuse them.

---

## Validation and Limits

### Input Validation

**Host validation:**
- Required, non-empty
- Must match `^[a-zA-Z0-9._:-]+$` (alphanumeric, dots, hyphens, colons)
- Rejects IPv6 bracket notation (use raw IPv6 address instead)

**Port validation:**
- Must be 1–65535
- Default 10011

**Timeout validation:**
- Must be 1–300000 ms (1 ms to 5 minutes)
- Default 10000 ms (10 seconds)

**Command validation:**
- Required, non-empty (after trim)
- Must be in the SAFE_COMMANDS whitelist
- No newlines allowed (prevents command injection)

**Token validation:**
- Automatically escaped via `tsEscape()` to prevent special character corruption

### Protocol Limits

**Response size:** Max 100 KB per response. If the server sends more (e.g., `logview` with thousands of entries), the connection is terminated with `"Response too large"`.

**Read timeout:** Each command has an independent timeout. If the server doesn't send the `error id=...` line within the timeout window, the request fails with `"Response timeout"`.

**Connection timeout:** Initial socket connection has a separate timeout. If `socket.opened` doesn't resolve within the timeout, the request fails with `"Connection timeout"`.

---

## Known Limitations

### 1. No TLS / encryption

ServerQuery sends credentials and commands in cleartext over TCP. Anyone with network access can sniff the `serverAdminToken` or intercept messages.

**Workaround:** Use an SSH tunnel or VPN to encrypt the connection:
```bash
ssh -L 10011:localhost:10011 user@ts3.example.com
curl -X POST https://portofcall.ross.gg/api/teamspeak/command \
  -d '{"host":"localhost","port":10011,"command":"version"}'
```

### 2. No connection reuse

Each request opens a new TCP connection, reads the banner, executes commands, and closes. For bulk operations (e.g., listing 50 channels, kicking 20 clients), this is inefficient. A persistent ServerQuery client would be faster.

**Impact:** Overhead of ~50-100 ms per request for connection setup and banner reading.

### 3. Fixed whitelist of commands

Only commands in `SAFE_COMMANDS` are allowed. This prevents write operations (`channelcreate`, `clientkick`, etc.) in the `/api/teamspeak/command` endpoint. To perform admin actions, use the dedicated endpoints (`/channel`, `/message`, `/kick`, `/ban`).

**Adding commands:** Modify the `SAFE_COMMANDS` set in `teamspeak.ts` (not recommended without security review).

### 4. No virtual server selection

The `/connect` and `/command` endpoints do not select a virtual server (`use sid=1`). They operate in the global context, which means some commands (e.g., `clientlist`, `serverinfo`) may fail with `error id=1024 msg=invalid\sserverID`.

**Fix:** The `/channel`, `/message`, `/kick`, and `/ban` endpoints automatically select virtual server 1 (`use sid=1`) after login. To use a different virtual server, modify the hardcoded `use sid=1` command in the implementation.

### 5. Banner terminator mismatch in comments

The original implementation comments claimed the banner ends with `\n\r\n`, but the TeamSpeak protocol actually uses `\r\n` (CR LF). The code has been corrected to match the spec, but old documentation may still reference the incorrect terminator.

### 6. Unescape order bug (FIXED)

**Original bug:** The unescape function processed `\\` before other escape sequences, causing `\\s` to incorrectly decode as space instead of literal `\s`.

**Fix:** Moved `\\` replacement to the end of the unescape chain (line 113). Now `\\s` → `\s` (backslash-s), `\s` → ` ` (space).

### 7. Timeout handle leaks (FIXED)

**Original bug:** `setTimeout()` calls in `readTSResponse()`, `readTSBanner()`, and `tsSession()` were never cleared if `Promise.race()` resolved early. This caused timeout callbacks to fire after successful responses, potentially logging spurious errors.

**Fix:** Wrapped `setTimeout()` handle in a variable and called `clearTimeout()` in a `finally` block (lines 174, 244, 285, 662, 978, 1040, 1102, 1186).

### 8. No authentication caching

If you need to execute multiple commands with the same `serverAdminToken`, each request re-authenticates. This wastes ~100-200 ms per request.

**Workaround:** Use a persistent ServerQuery client outside of this API (e.g., `telnet ts3.example.com 10011` and manually send commands).

### 9. No Cloudflare detection

Unlike most other handlers, this implementation does not check for Cloudflare's internal IP range (`CF-Connecting-IP` header). Running this API against `localhost` or `127.0.0.1` works.

### 10. Channel creation does not validate name length

TeamSpeak channel names are limited to 40 characters. The API does not enforce this limit — if you send a 200-character channel name, the server will reject it with `error id=1538 msg=invalid\sargument`.

**Fix (user-side):** Validate `channelName.length <= 40` before sending.

---

## Common ServerQuery Commands

These commands can be used with `POST /api/teamspeak/command` (read-only) or manually in a ServerQuery session (read-write).

### Server Information

| Command | Description | Example |
|---------|-------------|---------|
| `version` | Server version and platform | `version=3.13.7 build=1655727713 platform=Linux` |
| `serverinfo` | Virtual server details (name, uptime, clients) | `virtualserver_name=My\sServer virtualserver_uptime=1234567` |
| `hostinfo` | Host machine info (OS, CPU cores, uptime) | `instance_uptime=9876543 host_timestamp_utc=1609459200` |
| `instanceinfo` | Server instance stats (databases, connections) | `serverinstance_database_version=26 serverinstance_total_maxclients=1000` |
| `serverlist` | List all virtual servers | `virtualserver_id=1 virtualserver_port=9987 virtualserver_status=online\|virtualserver_id=2...` |

### Client Management

| Command | Description | Example |
|---------|-------------|---------|
| `clientlist` | List all connected clients | `clid=1 cid=1 client_database_id=1 client_nickname=Admin\|clid=2...` |
| `clientinfo clid=<N>` | Get detailed info about a client | `client_unique_identifier=abcdef123 client_version=3.5.6 client_platform=Windows` |
| `clientfind pattern=<text>` | Search for clients by nickname | `clid=42 client_nickname=Guest` |
| `clientkick clid=<N> reasonid=<4\|5>` | Kick a client (4=channel, 5=server) | `error id=0 msg=ok` (admin only) |
| `clientmove clid=<N> cid=<M>` | Move client to channel M | `error id=0 msg=ok` (admin only) |
| `clientpoke clid=<N> msg=<text>` | Send a poke (notification) to a client | `error id=0 msg=ok` |

### Channel Management

| Command | Description | Example |
|---------|-------------|---------|
| `channellist` | List all channels | `cid=1 channel_name=Default\|cid=2 channel_name=AFK` |
| `channelinfo cid=<N>` | Get detailed info about a channel | `channel_topic=Welcome channel_maxclients=-1 channel_order=0` |
| `channelfind pattern=<text>` | Search for channels by name | `cid=5 channel_name=Gaming` |
| `channelcreate channel_name=<name>` | Create a new channel | `cid=42` (admin only) |
| `channeldelete cid=<N>` | Delete a channel | `error id=0 msg=ok` (admin only) |
| `channeledit cid=<N> channel_topic=<text>` | Edit channel properties | `error id=0 msg=ok` (admin only) |

### Messaging

| Command | Description | Example |
|---------|-------------|---------|
| `sendtextmessage targetmode=1 target=<clid> msg=<text>` | Send DM to client | `error id=0 msg=ok` |
| `sendtextmessage targetmode=2 target=<cid> msg=<text>` | Send message to channel | `error id=0 msg=ok` |
| `sendtextmessage targetmode=3 msg=<text>` | Server-wide broadcast | `error id=0 msg=ok` (admin only) |

### Bans

| Command | Description | Example |
|---------|-------------|---------|
| `banclient clid=<N> time=<seconds>` | Ban a client (0=permanent) | `banid=123` (admin only) |
| `bandelid banid=<N>` | Remove a ban by ID | `error id=0 msg=ok` (admin only) |
| `banlist` | List all active bans | `banid=1 ip=192.0.2.1 created=1609459200 duration=3600\|banid=2...` |

---

## curl Examples

```bash
# Connect and get version info
curl -X POST https://portofcall.ross.gg/api/teamspeak/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"ts3.example.com"}' | jq .

# List all clients
curl -X POST https://portofcall.ross.gg/api/teamspeak/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"ts3.example.com","command":"clientlist"}' | jq .

# Get server info
curl -X POST https://portofcall.ross.gg/api/teamspeak/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"ts3.example.com","command":"serverinfo"}' | jq .

# List all channels (with authentication)
curl -X POST https://portofcall.ross.gg/api/teamspeak/channel \
  -H 'Content-Type: application/json' \
  -d '{"host":"ts3.example.com","serverAdminToken":"YOUR_TOKEN"}' | jq .

# Create a new channel
curl -X POST https://portofcall.ross.gg/api/teamspeak/channel \
  -H 'Content-Type: application/json' \
  -d '{"host":"ts3.example.com","serverAdminToken":"YOUR_TOKEN","channelName":"New Room","channelTopic":"Welcome"}' | jq .

# Send server-wide message
curl -X POST https://portofcall.ross.gg/api/teamspeak/message \
  -H 'Content-Type: application/json' \
  -d '{"host":"ts3.example.com","serverAdminToken":"YOUR_TOKEN","targetmode":3,"message":"Server restart in 5 minutes"}' | jq .

# Kick a client
curl -X POST https://portofcall.ross.gg/api/teamspeak/kick \
  -H 'Content-Type: application/json' \
  -d '{"host":"ts3.example.com","serverAdminToken":"YOUR_TOKEN","clid":42,"reasonid":5,"reasonmsg":"AFK"}' | jq .

# Ban a client for 1 hour
curl -X POST https://portofcall.ross.gg/api/teamspeak/ban \
  -H 'Content-Type: application/json' \
  -d '{"host":"ts3.example.com","serverAdminToken":"YOUR_TOKEN","clid":42,"time":3600,"banreason":"Spamming"}' | jq .
```

---

## Local Testing

### TeamSpeak 3 Server (Linux)

**Download and extract:**
```bash
wget https://files.teamspeak-services.com/releases/server/3.13.7/teamspeak3-server_linux_amd64-3.13.7.tar.bz2
tar xjf teamspeak3-server_linux_amd64-3.13.7.tar.bz2
cd teamspeak3-server_linux_amd64
```

**Start server:**
```bash
./ts3server_startscript.sh start
```

**Retrieve admin token:**
On first startup, the server prints:
```
------------------------------------------------------------------
                      I M P O R T A N T
------------------------------------------------------------------
               Server Query Admin Account created
         loginname= "serveradmin", password= "AAABBBCCC"
------------------------------------------------------------------
```

Copy the password (your `serverAdminToken`).

**Test ServerQuery:**
```bash
telnet localhost 10011
# You'll see the banner: TS3\r\nWelcome to...
# Type: version
# Server responds: version=3.13.7 build=1655727713 platform=Linux
#                   error id=0 msg=ok
# Type: quit
```

**Test via API:**
```bash
curl -X POST https://portofcall.ross.gg/api/teamspeak/connect \
  -d '{"host":"YOUR_PUBLIC_IP","port":10011}' | jq .
```

**Create a channel:**
```bash
curl -X POST https://portofcall.ross.gg/api/teamspeak/channel \
  -d '{"host":"YOUR_PUBLIC_IP","serverAdminToken":"AAABBBCCC","channelName":"Test Room"}' | jq .
```

### Docker Test Server

```bash
docker run -d -p 9987:9987/udp -p 10011:10011 -p 30033:30033 \
  --name teamspeak teamspeak

# Get the admin token from logs
docker logs teamspeak | grep password
# loginname= "serveradmin", password= "XYZABC123"

# Test connection
curl -X POST https://portofcall.ross.gg/api/teamspeak/connect \
  -d '{"host":"localhost"}' | jq .

# Test admin command
curl -X POST https://portofcall.ross.gg/api/teamspeak/channel \
  -d '{"host":"localhost","serverAdminToken":"XYZABC123"}' | jq .
```

---

## Security Considerations

### 1. Cleartext credentials

The `serverAdminToken` is sent unencrypted over TCP. Anyone sniffing the network can capture it and gain full admin access to the TeamSpeak server.

**Mitigation:**
- Use firewall rules to restrict ServerQuery access to trusted IPs
- Tunnel through SSH or VPN
- Use a low-privilege token instead of `serveradmin` for read-only operations

### 2. Command injection via newlines

The implementation validates that commands do not contain `\r` or `\n` characters. Without this check, an attacker could send:
```
command: "version\nlogin serveradmin <stolen_token>\nserverdelete sid=1"
```

**Protection:** Line 468 rejects commands containing newlines with `"Command must not contain newlines"`.

### 3. Token escaping bug (FIXED)

**Original bug:** Line 636 sent `serverAdminToken` unescaped in the `login` command. If the token contained spaces, pipes, or backslashes, the command would be malformed.

**Example:**
```
Token: "my pass|word"
Command: login serveradmin my pass|word
Result: ServerQuery parses as "login serveradmin my" with extra garbage
```

**Fix:** Line 636 now uses `tsEscape(serverAdminToken)` to properly escape special characters.

### 4. Resource exhaustion via large responses

The `MAX_RESPONSE_SIZE` limit (100 KB) prevents memory exhaustion from malicious servers sending infinite data. However, a server can still waste 100 KB per request.

**Recommendation:** Deploy this API behind Cloudflare Workers rate limiting (e.g., 10 requests/minute per IP).

### 5. Timeout abuse

A client can set `timeout: 300000` (5 minutes) to tie up worker resources. Consider capping the max timeout server-side.

**Fix (server-side):**
```typescript
const cappedTimeout = Math.min(timeout, 30000); // Max 30 seconds
```

### 6. No SSRF protection

The API allows connections to any host, including internal IPs (`127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`). This enables SSRF attacks to scan internal networks.

**Mitigation:** Add IP range validation before connecting (check for private/loopback ranges).

---

## Error Codes

Common TeamSpeak ServerQuery error codes:

| Code | Name | Description |
|------|------|-------------|
| 0 | OK | Success |
| 256 | COMMAND_NOT_FOUND | Invalid command |
| 512 | INVALID_CLIENTID | Client ID does not exist |
| 520 | INVALID_LOGIN | Incorrect username or password |
| 768 | INVALID_PERMID | Permission ID does not exist |
| 1024 | INVALID_SERVERID | Virtual server ID does not exist (need `use sid=1`) |
| 1025 | ALREADY_RUNNING | Virtual server already running |
| 1281 | CHANNEL_NOT_EMPTY | Cannot delete channel with clients |
| 1538 | INVALID_ARGUMENT | Malformed command parameter |
| 1540 | ARGUMENT_MISSING | Required parameter missing |
| 1794 | NOT_CONNECTED | Client not connected |
| 2048 | UNKNOWN_ERROR | Internal server error |
| 2568 | INSUFFICIENT_PERMISSIONS | Insufficient client permissions |

**Reference:** Full error code list in TeamSpeak 3 ServerQuery Manual.

---

## References

- [TeamSpeak 3 ServerQuery Manual (PDF)](http://media.teamspeak.com/ts3_literature/TeamSpeak%203%20Server%20Query%20Manual.pdf)
- [TeamSpeak Developer Forum](https://forum.teamspeak.com/forums/24-Developer-Documentation)
- [Example ServerQuery client (Python): ts3API](https://github.com/benediktschmitt/py-ts3)
- [Example ServerQuery client (Node.js): TS3-NodeJS-Library](https://github.com/Multivit4min/TS3-NodeJS-Library)
