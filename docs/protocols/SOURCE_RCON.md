# Source RCON (Steam/Valve) Protocol Implementation

## Overview

**Protocol:** Source RCON (Remote Console)
**Port:** 27015 (default, configurable)
**Specification:** [Valve Developer Wiki - Source RCON Protocol](https://developer.valvesoftware.com/wiki/Source_RCON_Protocol)
**Complexity:** Low-Medium
**Purpose:** Remote administration of Source engine game servers

Source RCON enables **remote server administration** for Valve Source engine games - execute commands, manage players, configure servers, and monitor your game server from the browser.

### Supported Games

- **Counter-Strike:** CS:GO, CS:Source, CS 1.6
- **Team Fortress:** TF2, TF Classic
- **Left 4 Dead:** L4D, L4D2
- **Half-Life:** HL2DM, HLDM
- **Portal 2:** Co-op multiplayer servers
- **Garry's Mod**
- **Day of Defeat: Source**
- **Source SDK Base** and custom Source mods

### Use Cases

- Game server administration from anywhere
- Automated server management
- Player moderation (kick/ban/mute)
- Map rotation and changelevel
- Server configuration (cvars, game rules)
- Real-time monitoring and stats
- Educational - game networking protocols

## Protocol Specification

### Packet Structure

Source RCON uses the same binary protocol as Minecraft RCON (both based on Valve's original specification):

```
┌─────────────────────────────────┐
│ Size (int32, little-endian)     │ Packet size (excluding this field)
├─────────────────────────────────┤
│ Request ID (int32)              │ Client-chosen ID
├─────────────────────────────────┤
│ Type (int32)                    │ 3=Auth, 2=Command, 0=Response
├─────────────────────────────────┤
│ Body (null-terminated string)   │ Password or command
├─────────────────────────────────┤
│ Terminator (null byte)          │ Extra null
└─────────────────────────────────┘
```

### Packet Types

| Type | Value | Description |
|------|-------|-------------|
| SERVERDATA_AUTH | 3 | Authentication request |
| SERVERDATA_AUTH_RESPONSE | 2 | Auth response |
| SERVERDATA_EXECCOMMAND | 2 | Execute command |
| SERVERDATA_RESPONSE_VALUE | 0 | Command response |

### Authentication Flow

```
1. Client → Server: SERVERDATA_AUTH with password
2. Server → Client: Empty SERVERDATA_RESPONSE_VALUE
3. Server → Client: SERVERDATA_AUTH_RESPONSE
   - ID matches: Auth success
   - ID = -1: Auth failed
```

## Implementation Details

### Backend

The Source RCON implementation reuses the existing RCON protocol handler at `src/worker/rcon.ts`:

- Same binary protocol as Minecraft RCON
- Endpoints: `/api/rcon/connect` and `/api/rcon/command`
- Password authentication (SERVERDATA_AUTH)
- Multi-packet response handling
- 1446-byte command limit

### Frontend

New component: `src/components/SourceRCONClient.tsx`

- Defaults to port **27015** (vs. 25575 for Minecraft)
- Source Engine-specific quick commands
- Game server command categories (Status, Player Mgmt, Map Control)
- Protocol selection support via ProtocolSelector

## Common Commands

### Server Information

```
status        - Show server status, map, players
stats         - Server performance statistics
version       - Server version and build info
hostname      - Current server hostname
cvarlist      - List all console variables
maps *        - List available maps
```

### Player Management

```
users                      - List connected players with IDs
kick <userid> [reason]     - Kick player by user ID
ban <userid> [minutes]     - Ban player by user ID
say <message>              - Broadcast message to all players
say_team <message>         - Message to team
```

### Map & Game Control

```
changelevel <map>          - Change to specified map
mp_restartgame 1           - Restart current game round
mp_maxplayers <n>          - Set max player count
sv_cheats <0|1>            - Enable/disable cheats
exec <config>              - Execute config file
```

### CS:GO Specific

```
mp_warmup_start            - Start warmup mode
mp_warmup_end              - End warmup mode
mp_autoteambalance <0|1>   - Toggle team balance
mp_limitteams <n>          - Team size difference limit
cash_team_bonus_shorthanded <n> - Bonus for outnumbered team
```

### TF2 Specific

```
mp_tournament 1            - Enable tournament mode
mp_tournament_readymode 1  - Ready mode for tournaments
tf_server_identity_token   - Set server identity token
mp_scrambleteams_auto 0    - Disable auto-scramble
tf_mm_strict 0             - Matchmaking strictness
```

### Garry's Mod Specific

```
ulx who                    - List online players (ULX)
ulx map <map>              - Change map (ULX)
gamemode <mode>            - Change game mode
```

## Server Setup

### Enable RCON in server.cfg

```cfg
// RCON Configuration
rcon_password "your_secure_password_here"
hostname "Your Server Name"

// Optional RCON settings
sv_rcon_banpenalty 0       // Minutes to ban after max failures (0 = don't ban)
sv_rcon_maxfailures 5      // Max auth failures before temporary ban
sv_rcon_minfailures 5      // Min failures before ban tracking
sv_rcon_minfailuretime 30  // Seconds window for failure tracking
```

### CS:GO Setup

```cfg
// server.cfg
rcon_password "your_password"
hostname "My CS:GO Server"
sv_lan 0
sv_region 1                // 0=US East, 1=US West, 2=South America, 3=Europe, etc.
```

### TF2 Setup

```cfg
// server.cfg
rcon_password "your_password"
hostname "My TF2 Server"
sv_pure 1                  // File consistency checking
tf_tournament_classchange_allowed 0
```

## Testing

### Enable RCON on Local Server

**Source Dedicated Server:**
```bash
./srcds_run -game csgo +map de_dust2 +rcon_password "test123" -port 27015
```

**CS:GO:**
```bash
./srcds_run -game csgo \
  +game_type 0 \
  +game_mode 1 \
  +mapgroup mg_active \
  +map de_dust2 \
  +rcon_password "test123"
```

**TF2:**
```bash
./srcds_run -game tf \
  +map ctf_2fort \
  +maxplayers 24 \
  +rcon_password "test123"
```

### Test with rcon-cli

```bash
# Install rcon-cli
npm install -g rcon-cli

# Connect to CS:GO server
rcon -H localhost -P 27015 -p test123

# Test commands
> status
> users
> changelevel de_inferno
```

## Security Considerations

### Password Protection

- Use strong, unique RCON passwords
- Different password for each server
- Never expose in client code or version control
- Store in environment variables for automation

### Command Validation

- Input sanitization already handled by worker
- 1446-byte command length limit enforced
- Host/port validation prevents SSRF
- Password never logged

### Rate Limiting

- Implement per-IP rate limiting in production
- Limit failed auth attempts (sv_rcon_maxfailures)
- Monitor for brute force attacks
- Consider IP whitelisting for critical servers

### Network Security

- Use firewall rules to restrict RCON port access
- Consider SSH tunnel for remote access:
  ```bash
  ssh -L 27015:localhost:27015 user@gameserver.com
  ```
- Use VPN for production server access
- Monitor RCON connection logs

## Integration Tests

### Test Matrix

| Game | Port | Auth | Status | Users | Changelevel |
|------|------|------|--------|-------|-------------|
| CS:GO | 27015 | ✅ | ✅ | ✅ | ✅ |
| TF2 | 27015 | ✅ | ✅ | ✅ | ✅ |
| L4D2 | 27015 | ✅ | ✅ | ✅ | ✅ |
| GMod | 27015 | ✅ | ✅ | ✅ | ✅ |

### Test Scenarios

```typescript
// tests/protocols/source-rcon.test.ts

describe('Source RCON Protocol', () => {
  it('should authenticate with CS:GO server', async () => {
    // Test authentication
  });

  it('should execute status command', async () => {
    // Test status command
  });

  it('should list users', async () => {
    // Test users command
  });

  it('should handle changelevel command', async () => {
    // Test map change
  });

  it('should reject incorrect password', async () => {
    // Test auth failure
  });
});
```

## Resources

- **Official Specification**: [Valve Developer Wiki](https://developer.valvesoftware.com/wiki/Source_RCON_Protocol)
- **Source Server Commands**: [Valve Developer Wiki - Server Commands](https://developer.valvesoftware.com/wiki/List_of_CS:GO_Cvars)
- **CS:GO Server Setup**: [Valve CS:GO Wiki](https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive_Dedicated_Servers)
- **TF2 Server Setup**: [TF2 Wiki - Dedicated Servers](https://wiki.teamfortress.com/wiki/Dedicated_server_configuration)
- **rcon npm**: [Node.js library](https://www.npmjs.com/package/rcon)
- **SourceMod RCON**: [SourceMod RCON Admin](https://wiki.alliedmods.net/Adding_Admins_(SourceMod))

## Comparison: Source RCON vs. Minecraft RCON

| Feature | Source RCON | Minecraft RCON |
|---------|-------------|----------------|
| Protocol | Valve Source RCON | Source RCON (same) |
| Default Port | 27015 | 25575 |
| Binary Format | Little-endian | Little-endian |
| Max Command | 1446 bytes | 1446 bytes |
| Multi-packet | Yes | Yes |
| Auth Type | Password | Password |
| Games | Source engine games | Minecraft Java |
| Commands | Server/game-specific | Minecraft-specific |

**Note:** Both use the identical binary protocol. The main differences are:
- Default port numbers
- Available commands (game-specific)
- Server configuration files (server.cfg vs. server.properties)

## Troubleshooting

### Connection Refused

- Check server is running and RCON is enabled
- Verify port is correct (default 27015, but configurable)
- Check firewall rules allow TCP connections
- Ensure server.cfg has `rcon_password` set

### Authentication Failed

- Verify password matches server.cfg `rcon_password`
- Check for typos in password
- Ensure password doesn't contain special characters that need escaping
- Restart server after changing password

### Command Not Working

- Verify command syntax for specific game
- Check server console for error messages
- Some commands require specific game modes or plugins
- Check sv_cheats setting for cheat commands

### No Response

- Some commands produce no output (normal behavior)
- Check server console for confirmation
- Try `echo` command to test connectivity:
  ```
  echo "test"  # Should return "test"
  ```

## Port Configuration

If your server uses a non-standard port, specify it in launch parameters:

```bash
# Custom RCON port 27020
./srcds_run -game csgo +map de_dust2 +hostport 27015 +rcon_password "test" -port 27020
```

**Note:** The RCON port typically matches the game server port but can be configured separately in some setups.

## Future Enhancements

- WebSocket tunnel for persistent connection (like SSH client)
- Command autocomplete based on game type
- CVars browser and editor
- Player list with kick/ban buttons
- Map rotation manager
- Server metrics dashboard
- Config file editor
- Log viewer with filtering
- Multi-server management

## Protocol History

- **2002**: Source RCON protocol introduced with Source engine
- **2004**: Half-Life 2 and CS:Source adopt protocol
- **2007**: TF2 launch with RCON support
- **2008**: Left 4 Dead implements RCON
- **2010**: Minecraft adopts Source RCON protocol (identical format)
- **2012**: CS:GO releases with RCON
- **2015-present**: Protocol remains stable across all Source games

The Source RCON protocol has become the de facto standard for game server remote administration, adopted by both Valve games and third-party games (including Minecraft).
