# RCON — Source RCON Protocol

**Port:** 27015 (TCP, Source Engine default) / 25575 (Minecraft default)
**Spec:** Valve Developer Community Wiki (Source RCON Protocol)
**Implementation:** `src/worker/rcon.ts`
**Routes:** `POST /api/rcon/connect`, `POST /api/rcon/command`

---

## Endpoints

### `POST /api/rcon/connect`

Authenticates with an RCON server and returns the authentication result. Does not execute any commands.

**Request**

```json
{
  "host":     "game.example.com",  // required
  "port":     27015,                // default 27015 (Source) / 25575 (Minecraft)
  "password": "secret123",          // required
  "timeout":  10000                 // ms, default 10000
}
```

**Response — authentication successful**

```json
{
  "success": true,
  "authenticated": true
}
```

**Response — authentication failed**

```json
{
  "success": true,
  "authenticated": false,
  "error": "Authentication failed - incorrect RCON password"
}
```

**Response — connection error**

```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Authentication flow:**
```
→ SERVERDATA_AUTH (type 3, id=1, body=password)
← SERVERDATA_RESPONSE_VALUE (type 0, id=1, body="")  [empty response]
← SERVERDATA_AUTH_RESPONSE (type 2, id=1 or -1)
```

If the server responds with `id == -1`, authentication failed (incorrect password). If `id == 1` (matches request), authentication succeeded.

**No AUTH_RESPONSE from server:** If the server doesn't send a type 2 packet at all, the endpoint returns `success: false, error: "No AUTH_RESPONSE received from server"`.

---

### `POST /api/rcon/command`

Authenticates with an RCON server, executes a command, and returns the output.

**Request**

```json
{
  "host":     "game.example.com",  // required
  "port":     27015,                // default 27015
  "password": "secret123",          // required
  "command":  "status",             // required
  "timeout":  10000                 // ms, default 10000
}
```

**Command length limit:** Max 4082 bytes (4096 byte max packet size minus 14 bytes overhead for size/id/type/nulls).

**Response — command successful**

```json
{
  "success": true,
  "authenticated": true,
  "response": "hostname: MyServer\nversion : 1.0.0.0\nmap     : de_dust2\nplayers : 12 (24 max)\n\n# userid name uniqueid connected ping loss state adr\n#  2 \"Player1\" STEAM_1:0:123456 01:23 50 0 active 192.0.2.1:27005"
}
```

If the server returns no output (empty response body), `response` is `"(No output)"`.

**Response — authentication failed**

```json
{
  "success": false,
  "authenticated": false,
  "error": "Authentication failed - incorrect RCON password"
}
```

**Response — connection error**

```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**Command execution flow:**
```
1. Authenticate (same as /connect):
   → SERVERDATA_AUTH (type 3, id=1, body=password)
   ← SERVERDATA_RESPONSE_VALUE (type 0, id=1, body="")
   ← SERVERDATA_AUTH_RESPONSE (type 2, id=1 or -1)

2. If authenticated (id != -1):
   → SERVERDATA_EXECCOMMAND (type 2, id=2, body=command)
   ← SERVERDATA_RESPONSE_VALUE (type 0, id=2, body=output)
   [may be split across multiple packets]
```

**Multi-packet responses:** RCON servers often split long command output (e.g., `cvarlist`, `status` on full servers) into multiple `SERVERDATA_RESPONSE_VALUE` packets. The handler reads all available data within a 200 ms window and concatenates the body fields.

**Request ID validation:** The handler validates that response packets have the correct request ID (1 for auth, 2 for command). Packets with mismatched IDs are ignored. If no valid response is received, the endpoint returns `success: false, error: "No valid command response received from server"`.

---

## RCON Packet Format

All RCON packets use little-endian byte order.

```
[Size:int32LE][ID:int32LE][Type:int32LE][Body:ASCII string\0][\0]
```

| Field | Size | Description |
|-------|------|-------------|
| Size | 4 bytes | Length of the rest of the packet (ID + Type + Body + 2 null bytes). Min 10, max 4096. |
| ID | 4 bytes | Request ID chosen by client. Server echoes this in responses. Auth failures return -1. |
| Type | 4 bytes | Packet type (see table below). |
| Body | variable | ASCII string, null-terminated. |
| Pad null | 1 byte | Extra null terminator (packet padding). |

**Size calculation:** `Size = 4 (ID) + 4 (Type) + len(Body) + 1 (null) + 1 (pad null)`

For a 6-character password `"secret"`, the size field is `4 + 4 + 6 + 1 + 1 = 16`.

**Max packet size:** 4096 bytes total (including the 4-byte size field itself). Max body length is `4096 - 14 = 4082 bytes`.

---

## Packet Types

| Type | Name | Direction | Description |
|------|------|-----------|-------------|
| 3 | SERVERDATA_AUTH | → | Client sends password to authenticate |
| 2 | SERVERDATA_AUTH_RESPONSE | ← | Server confirms auth (id=request_id) or rejects (id=-1) |
| 2 | SERVERDATA_EXECCOMMAND | → | Client sends command to execute |
| 0 | SERVERDATA_RESPONSE_VALUE | ← | Server sends command output or empty auth response |

**Type 2 overload:** Type 2 is used for both `SERVERDATA_AUTH_RESPONSE` (server → client) and `SERVERDATA_EXECCOMMAND` (client → server). The direction and context determine the meaning.

---

## Common RCON Commands

These commands work on most Source Engine servers (CS:GO, TF2, L4D2, etc.):

| Command | Description |
|---------|-------------|
| `status` | Server status, map, player list |
| `cvarlist` | List all console variables (very long output) |
| `echo <text>` | Echo text back (useful for testing) |
| `changelevel <map>` | Change to a different map |
| `say <message>` | Broadcast a message to all players |
| `kick <player>` | Kick a player by name |
| `ban <player>` | Ban a player by name or ID |
| `exec <config>` | Execute a config file |

**Minecraft-specific commands:**

| Command | Description |
|---------|-------------|
| `list` | List online players |
| `stop` | Gracefully shut down the server |
| `save-all` | Force save world |
| `whitelist add <player>` | Add player to whitelist |
| `op <player>` | Grant operator status |
| `ban <player>` | Ban a player |

---

## Validation and Limits

### Input Validation

**Host validation:**
- Required, non-empty
- Must match pattern `^[a-zA-Z0-9.-]+$` (alphanumeric, dots, hyphens)
- No spaces, underscores, or special characters

**Port validation:**
- Must be 1–65535
- Default 27015

**Password validation:**
- Required, non-empty
- Max length 512 bytes
- Sent in cleartext over TCP (no encryption unless using stunnel/VPN)

**Command validation:**
- Required, non-empty (after trim)
- Max length 4082 bytes (RCON protocol limit)

### Protocol Limits

**Packet size:** Max 4096 bytes per packet (enforced by `parseRCONPacket`). Packets claiming `size > 4096` or `size < 10` are rejected as malformed.

**Read timeout:** 10 seconds default (configurable via `timeout` parameter). If the server doesn't respond within this window, the request fails with `"Connection timeout"`.

**Multi-packet window:** After the first packet is received, the handler waits 200 ms for additional packets. This allows multi-packet responses to be collected without blocking indefinitely.

**Memory limit:** 1 MB total response size. If the server sends more than 1 MB of data (e.g., `cvarlist` on a heavily modded server), collection stops at 1 MB to prevent memory exhaustion.

---

## Known Limitations

### 1. No TLS / encryption

RCON sends passwords and commands in cleartext over TCP. Anyone with network access can sniff credentials. For public servers, use a VPN or stunnel wrapper.

**Workaround:** Run RCON over an SSH tunnel:
```bash
ssh -L 27015:localhost:27015 user@game.example.com
curl -X POST https://portofcall.ross.gg/api/rcon/command \
  -d '{"host":"localhost","port":27015,"password":"secret","command":"status"}'
```

### 2. No connection reuse

Each request opens a new TCP connection, authenticates, executes the command, and closes. For bulk operations (e.g., kicking 50 players), this is inefficient. A persistent RCON client (like `mcrcon` or `rcon-cli`) is faster.

### 3. Source vs Minecraft port difference

Source Engine servers default to **port 27015**. Minecraft servers default to **port 25575**. The `/api/rcon/connect` and `/api/rcon/command` endpoints default to 27015 — override with `"port": 25575` for Minecraft.

### 4. Multi-packet response window is fixed at 200 ms

If a server is slow to send a multi-packet response (e.g., 500 ms between packets), the handler only collects packets that arrive within 200 ms of the first. The rest are dropped. Adjust the hardcoded 200 ms in `readFromSocket` if needed.

### 5. No async command execution

Some RCON commands (e.g., `changelevel`, `exec`) trigger long-running operations. The server may send a partial response before the operation completes. The handler doesn't wait for the operation to finish — it returns the immediate response.

### 6. No packet fragmentation handling beyond 200 ms window

If the TCP connection is slow (high latency, packet loss), a single RCON packet may arrive in multiple TCP segments. The handler uses a 200 ms window to collect segments, but if the delay exceeds 200 ms, the packet is incomplete and parsing fails.

### 7. Empty response body ambiguity

A server that returns no output (empty `SERVERDATA_RESPONSE_VALUE` body) is indistinguishable from a connection error if no packets arrive. The handler sets `response: "(No output)"` if at least one valid response packet is received with an empty body.

---

## curl Examples

```bash
# Test authentication only
curl -X POST https://portofcall.ross.gg/api/rcon/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"game.example.com","port":27015,"password":"secret123"}' | jq .

# Execute 'status' command on Source server
curl -X POST https://portofcall.ross.gg/api/rcon/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"game.example.com","port":27015,"password":"secret123","command":"status"}' | jq .

# Minecraft server (port 25575)
curl -X POST https://portofcall.ross.gg/api/rcon/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"mc.example.com","port":25575,"password":"minecraft","command":"list"}' | jq .

# Test with increased timeout (30 seconds)
curl -X POST https://portofcall.ross.gg/api/rcon/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"game.example.com","password":"secret","command":"cvarlist","timeout":30000}' | jq .

# Test authentication failure
curl -X POST https://portofcall.ross.gg/api/rcon/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"game.example.com","password":"wrongpass"}' | jq .
# {"success":true,"authenticated":false,"error":"Authentication failed - incorrect RCON password"}
```

---

## Local Testing

### Source Engine Server (SRCDS)

**CS:GO Dedicated Server:**
```bash
# Install via SteamCMD
steamcmd +login anonymous +force_install_dir ./csgo +app_update 740 +quit

# Enable RCON in server.cfg
echo 'rcon_password "secret123"' >> csgo/csgo/cfg/server.cfg
echo 'hostport 27015' >> csgo/csgo/cfg/server.cfg

# Start server
./csgo/srcds_run -game csgo +map de_dust2 +maxplayers 16

# Test RCON
curl -X POST https://portofcall.ross.gg/api/rcon/command \
  -d '{"host":"YOUR_PUBLIC_IP","port":27015,"password":"secret123","command":"status"}' | jq .
```

**Team Fortress 2:**
```bash
steamcmd +login anonymous +force_install_dir ./tf2 +app_update 232250 +quit
echo 'rcon_password "tf2secret"' >> tf2/tf/cfg/server.cfg
./tf2/srcds_run -game tf +map ctf_2fort +maxplayers 24
```

### Minecraft Server (Java Edition)

**server.properties:**
```properties
enable-rcon=true
rcon.port=25575
rcon.password=minecraft123
```

**Start server:**
```bash
java -Xmx1024M -Xms1024M -jar server.jar nogui
```

**Test RCON:**
```bash
curl -X POST https://portofcall.ross.gg/api/rcon/command \
  -d '{"host":"YOUR_PUBLIC_IP","port":25575,"password":"minecraft123","command":"list"}' | jq .
```

### Docker Test Server

**Source Engine (TF2):**
```bash
docker run -d -p 27015:27015/tcp --name tf2-rcon \
  -e SRCDS_RCONPW="dockersecret" \
  -e SRCDS_PW="" \
  -e SRCDS_MAP="ctf_2fort" \
  cm2network/tf2

curl -X POST https://portofcall.ross.gg/api/rcon/command \
  -d '{"host":"localhost","port":27015,"password":"dockersecret","command":"status"}' | jq .
```

**Minecraft (Java):**
```bash
docker run -d -p 25575:25575 -e EULA=TRUE \
  -e RCON_PASSWORD=minecraftpw \
  --name mc-rcon itzg/minecraft-server

curl -X POST https://portofcall.ross.gg/api/rcon/command \
  -d '{"host":"localhost","port":25575,"password":"minecraftpw","command":"list"}' | jq .
```

---

## Security Considerations

### 1. Cleartext credentials

RCON passwords are sent unencrypted. Use firewall rules to restrict RCON access to trusted IPs, or tunnel through SSH/VPN.

### 2. Rate limiting

There is no built-in rate limiting. A malicious client can flood the RCON server with auth attempts (password brute-force) or command spam. Implement per-IP rate limits at the Cloudflare Workers layer if exposing this API publicly.

### 3. Command injection

The `command` parameter is sent directly to the server without validation. While RCON servers typically sanitize input, some custom plugins may be vulnerable to injection. Validate commands on the client side before sending.

### 4. Resource exhaustion

The 1 MB read limit prevents memory exhaustion from malicious servers sending infinite data. However, a server that sends exactly 1 MB of garbage data can still waste resources. Consider lowering the limit (e.g., 256 KB) if only short commands are needed.

### 5. Timeout abuse

Setting a very long `timeout` (e.g., 600000 ms = 10 minutes) can tie up Cloudflare Workers resources. Consider capping the max timeout server-side (e.g., 30 seconds) for public APIs.

---

## Protocol Comparison: Source RCON vs Minecraft RCON

| Feature | Source Engine | Minecraft |
|---------|---------------|-----------|
| Default port | 27015 | 25575 |
| Packet format | Identical | Identical |
| Auth flow | RESPONSE_VALUE (empty) + AUTH_RESPONSE | AUTH_RESPONSE only (no empty packet) |
| Multi-packet | Common for long output | Rare (responses usually fit in one packet) |
| Max packet | 4096 bytes | 4096 bytes |
| Commands | Console commands (`status`, `say`, etc.) | Minecraft commands (`list`, `stop`, etc.) |

**Implementation note:** The handler works with both — it collects all packets within 200 ms, so it handles both the Source Engine's empty RESPONSE_VALUE packet and Minecraft's single AUTH_RESPONSE packet.

---

## Debugging RCON Issues

### "Connection timeout" error

**Possible causes:**
- RCON port is firewalled (not exposed to the internet)
- Server is offline
- Wrong port (27015 vs 25575)
- Hostname doesn't resolve

**Fix:**
```bash
# Check if port is open
nc -zv game.example.com 27015

# Check if server is listening
netstat -tuln | grep 27015
```

### "Authentication failed" error

**Possible causes:**
- Incorrect password
- RCON not enabled on server (`enable-rcon=false` in Minecraft, missing `rcon_password` in Source)
- Server rejected auth due to IP whitelist

**Fix:**
```bash
# Source Engine: check server.cfg
cat server.cfg | grep rcon_password

# Minecraft: check server.properties
cat server.properties | grep rcon
```

### "No AUTH_RESPONSE received from server"

**Possible causes:**
- Server sent data but not a valid type 2 packet
- Packet was corrupted or fragmented beyond the 200 ms window
- Server is not an RCON server (wrong protocol — e.g., tried RCON on SSH port 22)

**Fix:**
Use a packet capture tool (Wireshark) to inspect the raw TCP stream and verify the server is sending RCON packets.

### Empty response / "(No output)"

**Possible causes:**
- Command produced no output (e.g., `echo` with no args)
- Command doesn't exist (server silently ignores invalid commands)
- Permissions issue (command requires admin, but RCON user doesn't have access)

**Fix:**
Test with a known-good command like `echo test` or `status`.

---

## References

- [Valve Developer Community: Source RCON Protocol](https://developer.valvesoftware.com/wiki/Source_RCON_Protocol)
- [Minecraft Wiki: RCON](https://minecraft.fandom.com/wiki/Commands#RCON)
- [Example RCON client (Python): rcon](https://github.com/conqp/rcon)
- [Example RCON client (Go): gorcon](https://github.com/gorcon/rcon)
