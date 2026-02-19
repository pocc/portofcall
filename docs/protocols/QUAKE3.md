# Quake 3 Arena — Power User Reference

**Port:** 27960 (default) | **Protocol:** Quake 3 OOB Query (TCP) | **Tests:** Not yet deployed

Port of Call provides a Quake 3 Arena server query endpoint that sends out-of-band (OOB) status queries over TCP. This works with Quake 3 Arena, ioquake3, OpenArena, Wolfenstein: Enemy Territory, Return to Castle Wolfenstein, and other Quake engine derivatives.

---

## API Endpoints

### `POST /api/quake3/status` — Server status query

Connects to a Quake 3 server, sends a `getstatus` OOB command, parses the response for server variables and player list, and closes.

**POST body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | — | Required |
| `port` | number | `27960` | Standard Quake 3 port |
| `command` | string | `getstatus` | `getstatus` or `getinfo` |
| `timeout` | number | `10000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "q3.example.com",
  "port": 27960,
  "tcpLatency": 45,
  "command": "getstatus",
  "serverVars": {
    "sv_hostname": "Quake 3 Arena Server",
    "mapname": "q3dm17",
    "gamename": "baseq3",
    "sv_maxclients": "16",
    "sv_privateClients": "0",
    "gametype": "0",
    "protocol": "68"
  },
  "players": [
    { "score": 15, "ping": 23, "name": "Sarge" },
    { "score": 8, "ping": 45, "name": "Grunt" }
  ],
  "playerCount": 2,
  "maxPlayers": 16,
  "mapName": "q3dm17",
  "gameName": "baseq3"
}
```

**Empty response (server doesn't support TCP queries):**
```json
{
  "success": false,
  "host": "q3.example.com",
  "port": 27960,
  "tcpLatency": 12,
  "command": "getstatus",
  "error": "No response received. Server may not support TCP queries — try UDP if possible.",
  "note": "Quake 3 servers primarily use UDP. TCP query support depends on the server build."
}
```

**Invalid response format:**
```json
{
  "success": false,
  "host": "not-a-q3-server.com",
  "port": 27960,
  "tcpLatency": 8,
  "command": "getstatus",
  "error": "Unexpected response format — not a Quake 3 server"
}
```

**Cloudflare-protected host (403):**
```json
{
  "success": false,
  "error": "...",
  "isCloudflare": true
}
```

**Notes:**
- `tcpLatency` measures the time from `connect()` to socket open — does not include query round-trip time.
- `playerCount` is derived from the number of player lines in the response (reliable).
- `maxPlayers` is extracted from `sv_maxclients` cvar (may be missing on some servers).
- `mapName` and `gameName` are convenience fields extracted from `serverVars.mapname` and `serverVars.gamename`.
- Player names may contain color codes (e.g. `^1Red^7Name`). No color code stripping is applied.

---

### `POST /api/quake3/info` — Server info query (condensed status)

Identical to `/status` but sends the `getinfo` command instead of `getstatus`. The server responds with `infoResponse` containing server variables only — no player list.

**POST body:**
```json
{
  "host": "q3.example.com",
  "port": 27960,
  "timeout": 10000
}
```

The `command` parameter is ignored — always sends `getinfo`.

**Success (200):**
```json
{
  "success": true,
  "host": "q3.example.com",
  "port": 27960,
  "tcpLatency": 32,
  "command": "getinfo",
  "serverVars": {
    "hostname": "Quake 3 Server",
    "mapname": "q3dm6",
    "gamename": "baseq3",
    "clients": "4",
    "sv_maxclients": "12",
    "protocol": "68"
  },
  "playerCount": 4,
  "maxPlayers": 12,
  "mapName": "q3dm6",
  "gameName": "baseq3"
}
```

**Notes:**
- `playerCount` is extracted from `serverVars.clients` (not a count of player lines, since `getinfo` doesn't return players).
- `getinfo` is faster than `getstatus` on servers with many players — response size is O(1) instead of O(n).

---

## Protocol Details

### Out-of-Band (OOB) Packet Format

All Quake 3 OOB packets start with a 4-byte header: `\xFF\xFF\xFF\xFF`

**Query packet:**
```
\xFF\xFF\xFF\xFF getstatus\n
```

**Response packet:**
```
\xFF\xFF\xFF\xFF statusResponse\n
\key\value\key\value\...\n
score ping "name"\n
score ping "name"\n
...
```

### Server Variable Format

Server cvars are encoded as `\key\value\key\value\...` with backslashes as delimiters.

Example raw string:
```
\sv_hostname\My Server\mapname\q3dm17\gamename\baseq3\sv_maxclients\16\protocol\68
```

Parsed as:
```json
{
  "sv_hostname": "My Server",
  "mapname": "q3dm17",
  "gamename": "baseq3",
  "sv_maxclients": "16",
  "protocol": "68"
}
```

**Edge cases handled:**
- Empty string → `{}`
- No leading backslash → `{}`
- Trailing backslash → key with empty value
- Odd number of tokens → trailing key ignored

### Player Entry Format

Each player line has the format:
```
{score} {ping} "{name}"
```

Example:
```
15 23 "Sarge"
-5 999 "^1Red^7Player"
```

Parsed as:
```json
[
  { "score": 15, "ping": 23, "name": "Sarge" },
  { "score": -5, "ping": 999, "name": "^1Red^7Player" }
]
```

**Notes:**
- Score can be negative (e.g. in CTF, suicide penalty).
- Ping 999 typically means a bot or very high latency.
- Player names are enclosed in double quotes — quotes are part of the protocol.
- Color codes (e.g. `^1`, `^7`) are Quake 3 in-game color markers. Not stripped.

### Response Types

| Command | Response Type | Contents |
|---------|---------------|----------|
| `getstatus` | `statusResponse` | Server vars + player list |
| `getinfo` | `infoResponse` | Server vars only |
| `getchallenge` | `challengeResponse` | Challenge token (not implemented) |

If the server sends a response type that doesn't match the command (e.g. `infoResponse` for a `getstatus` command), the query fails with:
```json
{
  "success": false,
  "error": "Server sent infoResponse but command was getstatus"
}
```

---

## Common Server Variables

Standard Quake 3 cvars returned in `serverVars`:

| Key | Description | Example |
|-----|-------------|---------|
| `sv_hostname` | Server name | `My Quake 3 Server` |
| `mapname` | Current map | `q3dm17`, `pro-q3dm6` |
| `gamename` | Game mod | `baseq3`, `cpma`, `osp` |
| `sv_maxclients` | Max players | `16` |
| `sv_privateClients` | Reserved slots | `2` |
| `gametype` | Game mode | `0` (FFA), `1` (Tourney), `3` (Team DM), `4` (CTF) |
| `protocol` | Protocol version | `68` (Q3 1.32), `71` (ioq3) |
| `version` | Server version | `ioQ3 1.36` |
| `g_needpass` | Password required | `0` (no), `1` (yes) |
| `capturelimit` | CTF score limit | `8` |
| `fraglimit` | Frag limit | `20` |
| `timelimit` | Time limit (minutes) | `15` |
| `g_gametype` | Detailed game type | `0`-`11` (mod-specific) |

**Game type codes:**
- `0` — Free For All (FFA)
- `1` — Tournament (1v1)
- `2` — Single Player
- `3` — Team Deathmatch (TDM)
- `4` — Capture the Flag (CTF)
- `5+` — Mod-specific (e.g. Freeze Tag, Clan Arena)

**Protocol versions:**
- `68` — Quake 3 Arena 1.32 (retail)
- `71` — ioquake3 / OpenArena
- `84` — Wolfenstein: Enemy Territory

---

## TCP vs UDP

Quake 3 servers primarily use UDP for both gameplay and server queries. The original id Software implementation only supported UDP queries.

**TCP query support:**
- **ioquake3:** Full TCP support for OOB queries (ports 27960/TCP and 27960/UDP)
- **OpenArena:** TCP support (based on ioquake3)
- **Wolfenstein: Enemy Territory:** TCP support in some builds
- **Return to Castle Wolfenstein:** Limited/no TCP support
- **Original Q3A 1.32:** No TCP support

If you query a server over TCP and receive no response, the server either:
1. Doesn't accept TCP connections on that port
2. Ignores OOB queries over TCP
3. Is UDP-only

**Workaround:** Use a UDP-to-TCP proxy or query via UDP directly (not supported by Port of Call — Workers only support TCP sockets).

---

## Known Limitations

**UDP-only servers:** Original Quake 3 Arena (point release 1.32 and earlier) does not accept TCP queries. Most modern servers run ioquake3 or derivatives with TCP support, but older vanilla servers will timeout.

**Response size:** `readAvailable()` reads all available data with a 5-second initial timeout and 500ms continuation timeout. Very large responses (servers with 64+ players) may be truncated if the server sends data slowly. This is rare — typical responses fit in 1-2 TCP segments.

**Binary data in server vars:** Some mods include binary data or non-UTF8 characters in cvar values. The `TextDecoder` uses `fatal: false` and replaces invalid sequences with U+FFFD.

**Color code rendering:** Player names and server hostnames may contain Quake 3 color codes (e.g. `^1Red^7Text`). These are raw in the JSON response — no parsing or stripping is applied. To display without colors, strip all `^[0-9]` sequences.

**Challenge tokens:** `getchallenge` is not implemented. This command is used for client authentication (e.g. rcon, server join). Only status queries (`getstatus`, `getinfo`) are supported.

**Server browser pagination:** There is no master server query support. You can only query one server at a time by IP:port. To scan multiple servers, issue parallel `/api/quake3/status` calls.

**Protocol 68 vs 71:** Some cvars differ between protocol versions. The implementation doesn't normalize these — you get the raw server response.

---

## Practical Examples

### curl

```bash
# Basic status query
curl -s -X POST https://portofcall.ross.gg/api/quake3/status \
  -H 'Content-Type: application/json' \
  -d '{"host":"q3.example.com","port":27960}' \
  | jq

# Condensed info query (no player list)
curl -s -X POST https://portofcall.ross.gg/api/quake3/info \
  -H 'Content-Type: application/json' \
  -d '{"host":"q3.example.com","port":27960}' \
  | jq

# Extract just the player names
curl -s -X POST https://portofcall.ross.gg/api/quake3/status \
  -H 'Content-Type: application/json' \
  -d '{"host":"q3.example.com"}' \
  | jq -r '.players[]?.name'

# Check if server is password-protected
curl -s -X POST https://portofcall.ross.gg/api/quake3/status \
  -H 'Content-Type: application/json' \
  -d '{"host":"q3.example.com"}' \
  | jq -r '.serverVars.g_needpass'

# Get current map and game type
curl -s -X POST https://portofcall.ross.gg/api/quake3/status \
  -H 'Content-Type: application/json' \
  -d '{"host":"q3.example.com"}' \
  | jq '{map: .mapName, gametype: .serverVars.gametype, players: .playerCount, max: .maxPlayers}'
```

### JavaScript (fetch)

```js
async function queryQuake3Server(host, port = 27960) {
  const response = await fetch('https://portofcall.ross.gg/api/quake3/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, port }),
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error);
  }

  return {
    name: data.serverVars?.sv_hostname || 'Unknown',
    map: data.mapName,
    players: data.playerCount,
    maxPlayers: data.maxPlayers,
    gametype: data.serverVars?.gametype,
    latency: data.tcpLatency,
    playerList: data.players || [],
  };
}

// Usage
queryQuake3Server('q3.example.com')
  .then(info => console.log(`${info.name} - ${info.players}/${info.maxPlayers} on ${info.map}`))
  .catch(err => console.error('Query failed:', err.message));
```

### Batch query multiple servers

```bash
# servers.txt contains one "host:port" per line
while IFS=: read -r host port; do
  curl -s -X POST https://portofcall.ross.gg/api/quake3/status \
    -H 'Content-Type: application/json' \
    -d "{\"host\":\"$host\",\"port\":${port:-27960}}" \
    | jq -r 'if .success then "\(.host):\(.port) - \(.playerCount // 0)/\(.maxPlayers // "?") on \(.mapName // "unknown")" else "\(.host):\(.port) - ERROR: \(.error)" end'
done < servers.txt
```

---

## Power User Tips

### Identifying server mods

Check the `gamename` cvar:

| Value | Mod |
|-------|-----|
| `baseq3` | Vanilla Quake 3 Arena |
| `cpma` | Challenge ProMode Arena (competitive) |
| `osp` | Orange Smoothie Productions (tournament) |
| `defrag` | DeFRaG (movement/trick jumping) |
| `excessiveplus` | Excessive Plus (instagib/railgun) |
| `urbanterror` | Urban Terror (tactical) |

### Detecting bots

Players with `ping: 0` are usually bots (server-side AI). Some mods report bot pings as `999` instead.

### Protocol version detection

- Protocol `68` — Original id Q3A 1.32
- Protocol `71` — ioquake3, OpenArena
- Protocol `84` — Wolfenstein: Enemy Territory

Check `serverVars.protocol` to determine compatibility.

### Color code stripping

Quake 3 color codes are `^` followed by a digit `0-9` or letter `a-z`:

```js
function stripColorCodes(text) {
  return text.replace(/\^[0-9a-z]/gi, '');
}

// "^1Red^7Player" → "RedPlayer"
```

### Empty servers

If `playerCount === 0`, the server is empty but online. Use this to find available servers.

### Sorting by player count

```bash
# Query multiple servers and sort by population
curl -s -X POST https://portofcall.ross.gg/api/quake3/status \
  -H 'Content-Type: application/json' \
  -d '{"host":"server1.com"}' | jq '{host, players: .playerCount}' > results.json
# ... repeat for other servers, then:
jq -s 'sort_by(-.players)' results.json
```

---

## Resources

- [Quake 3 Networking Model (Fabian Sanglard)](https://fabiensanglard.net/quake3/network.php)
- [ioquake3 Source Code](https://github.com/ioquake/ioq3)
- [OpenArena Project](http://www.openarena.ws/)
- [Quake 3 Protocol (id Software)](https://github.com/id-Software/Quake-III-Arena)
- [Wolfenstein: Enemy Territory Protocol](https://www.splashdamage.com/games/wolfenstein-enemy-territory/)

---

## Troubleshooting

### "No response received. Server may not support TCP queries"

**Cause:** The server doesn't accept TCP OOB queries (likely running original Q3A or a UDP-only build).

**Solutions:**
1. Verify the server is online by connecting via the game client
2. Check if the server runs ioquake3 or a derivative (has TCP support)
3. Use a UDP-based query tool externally (e.g. `qstat`, `gsquery`)

### "Unexpected response format — not a Quake 3 server"

**Cause:** The response doesn't start with `\xFF\xFF\xFF\xFF` (OOB header).

**Solutions:**
1. Verify the port — Quake 3 uses 27960 by default, but some servers use custom ports
2. Check if the host is actually a Quake 3 server (not HTTP, SSH, etc.)
3. Some firewalls/proxies corrupt binary packets — try a different network

### Players array is empty but playerCount > 0

**Cause:** You used `/api/quake3/info` which sends `getinfo` (no player list). The `playerCount` is from `serverVars.clients`.

**Solution:** Use `/api/quake3/status` (sends `getstatus`) to get the player list.

### serverVars contains garbage or non-UTF8 characters

**Cause:** Some mods (particularly older ones) include binary data in cvars.

**Solution:** The decoder uses `fatal: false` and replaces invalid sequences with U+FFFD (�). Parse `serverVars` values defensively and validate before display.

### Response type mismatch error

**Cause:** The server sent `infoResponse` when you used `getstatus` (or vice versa).

**Possible reasons:**
1. Server bug or non-standard implementation
2. Network corruption (unlikely with TCP)
3. Server running a custom protocol variant

**Solution:** Try the other command (`getinfo` if you used `getstatus`).

---

## Implementation Notes

**Timeout handling:** The 5-second read timeout starts after the first byte is received. Slow servers (high latency, packet loss) may timeout mid-response. Increase the `timeout` parameter if needed.

**Response parsing:** `readAvailable()` accumulates data until no more arrives within 500ms. This handles multi-packet responses but may cut off very slow streams.

**Player parsing regex:** The regex `/^(-?\d+)\s+(-?\d+)\s+"(.*)"/` assumes player lines always have the format `score ping "name"`. Malformed lines are silently ignored (return `null` from `parseQ3Player`).

**Key-value parsing edge cases:** Trailing backslashes, odd token counts, and missing leading backslashes are handled gracefully — see [Server Variable Format](#server-variable-format).

**Integer validation:** `sv_maxclients` and `clients` are parsed with `parseInt()` and validated (`!isNaN()` and `>= 0`). Invalid values are omitted from the result.

**Resource cleanup:** Socket, reader, and writer are properly released in both success and error paths to prevent resource leaks.
