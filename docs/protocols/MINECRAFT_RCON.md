# Minecraft RCON Protocol Implementation Plan

## Overview

**Protocol:** Minecraft RCON (Remote Console)
**Port:** 25575 (default)
**Specification:** [Source RCON Protocol](https://developer.valvesoftware.com/wiki/Source_RCON_Protocol)
**Complexity:** Low
**Purpose:** Minecraft server administration

Minecraft RCON enables **remote server administration** - execute commands, manage players, and monitor your Minecraft server from the browser.

### Use Cases
- Server administration from anywhere
- Automated server management
- Player management (kick/ban/whitelist)
- World management (time, weather, gamemode)
- Server monitoring and stats
- Educational - game server protocols

## Protocol Specification

### Packet Structure

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

## Worker Implementation

```typescript
// src/worker/protocols/minecraft/rcon.ts

import { connect } from 'cloudflare:sockets';

const SERVERDATA_AUTH = 3;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

export interface RCONConfig {
  host: string;
  port: number;
  password: string;
}

export class MinecraftRCON {
  private socket: Socket;
  private requestId = 1;
  private authenticated = false;

  constructor(private config: RCONConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Authenticate
    await this.authenticate();
  }

  private async authenticate(): Promise<void> {
    const authPacket = this.buildPacket(
      this.requestId,
      SERVERDATA_AUTH,
      this.config.password
    );

    const writer = this.socket.writable.getWriter();
    await writer.write(authPacket);
    writer.releaseLock();

    // Read empty response
    await this.readPacket();

    // Read auth response
    const response = await this.readPacket();

    if (response.id === -1) {
      throw new Error('Authentication failed - incorrect password');
    }

    this.authenticated = true;
  }

  async command(cmd: string): Promise<string> {
    if (!this.authenticated) {
      throw new Error('Not authenticated');
    }

    const packet = this.buildPacket(
      ++this.requestId,
      SERVERDATA_EXECCOMMAND,
      cmd
    );

    const writer = this.socket.writable.getWriter();
    await writer.write(packet);
    writer.releaseLock();

    // Read response(s)
    let fullResponse = '';

    // Minecraft may send response in multiple packets
    // Send empty packet to trigger end marker
    const endPacket = this.buildPacket(
      ++this.requestId,
      SERVERDATA_EXECCOMMAND,
      ''
    );
    await writer.write(endPacket);
    writer.releaseLock();

    while (true) {
      const response = await this.readPacket();

      if (response.id === this.requestId) {
        // End marker received
        break;
      }

      fullResponse += response.body;
    }

    return fullResponse;
  }

  private buildPacket(id: number, type: number, body: string): Uint8Array {
    const encoder = new TextEncoder();
    const bodyBytes = encoder.encode(body);

    // Size = ID (4) + Type (4) + Body (n) + 2 null bytes
    const size = 4 + 4 + bodyBytes.length + 2;

    const buffer = new ArrayBuffer(4 + size);
    const view = new DataView(buffer);
    let offset = 0;

    // Size (little-endian)
    view.setInt32(offset, size, true);
    offset += 4;

    // Request ID
    view.setInt32(offset, id, true);
    offset += 4;

    // Type
    view.setInt32(offset, type, true);
    offset += 4;

    // Body
    const array = new Uint8Array(buffer);
    array.set(bodyBytes, offset);
    offset += bodyBytes.length;

    // Two null terminators
    array[offset] = 0;
    array[offset + 1] = 0;

    return array;
  }

  private async readPacket(): Promise<{ id: number; type: number; body: string }> {
    const reader = this.socket.readable.getReader();

    // Read size (4 bytes)
    const { value: sizeBytes } = await reader.read();
    const sizeView = new DataView(sizeBytes.buffer);
    const size = sizeView.getInt32(0, true);

    // Read packet
    const { value: packetBytes } = await reader.read();
    const view = new DataView(packetBytes.buffer);

    const id = view.getInt32(0, true);
    const type = view.getInt32(4, true);

    const decoder = new TextDecoder();
    const body = decoder.decode(packetBytes.slice(8, size - 2));

    reader.releaseLock();

    return { id, type, body };
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/MinecraftRCON.tsx

export function MinecraftRCON() {
  const [connected, setConnected] = useState(false);
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState<string[]>([]);

  const ws = useRef<WebSocket | null>(null);

  const executeCommand = () => {
    if (!command.trim()) return;

    ws.current?.send(JSON.stringify({
      type: 'command',
      command,
    }));

    setOutput([...output, `> ${command}`, '...']);
    setCommand('');
  };

  const commonCommands = [
    'list',
    'help',
    'time set day',
    'weather clear',
    'gamemode creative',
    'tp @p 0 100 0',
  ];

  return (
    <div className="minecraft-rcon">
      <h2>Minecraft Server Console</h2>

      {!connected ? (
        <ConnectionForm onConnect={(config) => {
          // Connect via WebSocket
        }} />
      ) : (
        <>
          <div className="console">
            {output.map((line, i) => (
              <div key={i} className={line.startsWith('>') ? 'input' : 'output'}>
                {line}
              </div>
            ))}
          </div>

          <div className="command-input">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') executeCommand();
              }}
              placeholder="Enter command..."
              autoFocus
            />
            <button onClick={executeCommand}>Execute</button>
          </div>

          <div className="quick-commands">
            <h3>Quick Commands</h3>
            {commonCommands.map(cmd => (
              <button
                key={cmd}
                onClick={() => {
                  setCommand(cmd);
                  setTimeout(executeCommand, 100);
                }}
              >
                {cmd}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

## Common Commands

### Server Management

```
stop - Stop server
save-all - Save world
whitelist add <player>
whitelist remove <player>
ban <player>
pardon <player>
kick <player> [reason]
```

### World Management

```
time set day
time set night
weather clear
weather rain
weather thunder
gamerule doDaylightCycle false
```

### Player Management

```
list - List online players
gamemode survival <player>
gamemode creative <player>
tp <player> <x> <y> <z>
give <player> <item> [amount]
```

## Security

### Password Protection

```typescript
// RCON password from server.properties
// rcon.password=your_secure_password

// NEVER expose password in client code
// Always prompt user or use environment variable
```

### Rate Limiting

```typescript
// Limit commands per minute to prevent abuse
const COMMAND_RATE_LIMIT = 30; // per minute
```

## Testing

### Enable RCON in Minecraft

Edit `server.properties`:
```properties
enable-rcon=true
rcon.port=25575
rcon.password=minecraft
```

### Test with rcon-cli

```bash
# Install rcon-cli
npm install -g rcon-cli

# Connect
rcon -H localhost -P 25575 -p minecraft

# Send command
> list
```

## Resources

- **Source RCON Protocol**: [Valve Dev Wiki](https://developer.valvesoftware.com/wiki/Source_RCON_Protocol)
- **Minecraft Wiki**: [Server Commands](https://minecraft.fandom.com/wiki/Commands)
- **rcon npm**: [Node.js library](https://www.npmjs.com/package/rcon)

## Notes

- Protocol based on **Valve's Source RCON**
- Works with **Minecraft Java Edition** servers
- Also works with **Source Engine** games (TF2, CS:GO, etc.)
- **Simple binary protocol** with little-endian integers
- Multi-packet responses need **special handling**
