# Asterisk Manager Interface (AMI) Protocol Reference

AMI is a text-based TCP protocol for monitoring and controlling Asterisk PBX systems. It runs on **port 5038** by default and uses a request-response model with asynchronous event delivery.

## Wire Format

All AMI messages are plain ASCII key-value pairs. Each line is terminated by `\r\n` (CRLF). A complete message block is terminated by an empty line (`\r\n\r\n`).

```
Key: Value\r\n
Key: Value\r\n
\r\n
```

The colon-space (`: `) separator is mandatory. Keys are case-sensitive. Values may contain any characters except `\r` and `\n`.

### Banner

Upon TCP connection, the server immediately sends a single-line banner:

```
Asterisk Call Manager/X.X.X\r\n
```

This is NOT a key-value block. It is a single line terminated by `\r\n`, not `\r\n\r\n`. Clients must read exactly one `\r\n`-terminated line before switching to block-based reading.

Common banner values:
- `Asterisk Call Manager/1.1` (Asterisk 1.8)
- `Asterisk Call Manager/2.8.0` (Asterisk 13)
- `Asterisk Call Manager/5.0.2` (Asterisk 18)
- `Asterisk Call Manager/9.0.0` (Asterisk 21)

## Actions (Client to Server)

An action is a request sent from the client. Every action must include an `Action` header as the first line.

```
Action: <ActionName>\r\n
ActionID: <unique-id>\r\n
Key: Value\r\n
\r\n
```

### ActionID

The `ActionID` header is optional but strongly recommended. Asterisk echoes it back in all response and event messages associated with the action, allowing clients to correlate responses to requests in the presence of unsolicited events.

### Login

The first action after connecting must be `Login`:

```
Action: Login\r\n
Username: admin\r\n
Secret: mysecret\r\n
ActionID: login-1\r\n
\r\n
```

On success:
```
Response: Success\r\n
ActionID: login-1\r\n
Message: Authentication accepted\r\n
\r\n
```

On failure:
```
Response: Error\r\n
ActionID: login-1\r\n
Message: Authentication failed\r\n
\r\n
```

After successful login, the server may immediately send unsolicited events (e.g., `FullyBooted`). Clients must be prepared to skip these when waiting for a specific action response.

### Logoff

```
Action: Logoff\r\n
ActionID: logoff-1\r\n
\r\n
```

Response:
```
Response: Goodbye\r\n
ActionID: logoff-1\r\n
Message: Thanks for all the fish.\r\n
\r\n
```

The server closes the connection after sending the Goodbye response.

### Ping

```
Action: Ping\r\n
ActionID: ping-1\r\n
\r\n
```

Response:
```
Response: Success\r\n
ActionID: ping-1\r\n
Ping: Pong\r\n
Timestamp: 1234567890.123456\r\n
\r\n
```

### Command (CLI passthrough)

The `Command` action is special. It executes an Asterisk CLI command and returns raw output.

```
Action: Command\r\n
Command: sip show peers\r\n
ActionID: cmd-1\r\n
\r\n
```

The response format differs from standard actions:

**Asterisk 13+ (modern format with Output: prefix):**
```
Response: Follows\r\n
Privilege: Command\r\n
ActionID: cmd-1\r\n
Output: Name/username             Host                                    Dyn Forcerport Comedia    ACL Port     Status      Description\r\n
Output: 6001/6001                 192.168.1.100                            D  Auto (No)  No             5060     OK (1 ms)\r\n
Output: 1 sip peers [Monitored: 1 online, 0 offline Unmonitored: 0 online, 0 offline]\r\n
--END COMMAND--\r\n
```

**Asterisk 1.8/11 (legacy format, raw lines):**
```
Response: Follows\r\n
Privilege: Command\r\n
ActionID: cmd-1\r\n
Name/username             Host             Dyn ...\r\n
6001/6001                 192.168.1.100     D  ...\r\n
--END COMMAND--\r\n
```

Key points:
- The response type is `Follows` (not `Success`)
- Output is terminated by `--END COMMAND--\r\n`, not `\r\n\r\n`
- On error (e.g., invalid command), a normal `Response: Error` block is returned instead

### List Actions (EventList pattern)

Actions like `SIPpeers`, `CoreShowChannels`, `QueueStatus`, etc. return results as a series of events:

1. Initial response with `EventList: start`
2. Zero or more event blocks
3. Final event with `EventList: Complete`

```
Response: Success\r\n
ActionID: action-1\r\n
EventList: start\r\n
Message: Peer status list will follow\r\n
\r\n

Event: PeerEntry\r\n
ActionID: action-1\r\n
Channeltype: SIP\r\n
ObjectName: 6001\r\n
Status: OK (1 ms)\r\n
\r\n

Event: PeerlistComplete\r\n
ActionID: action-1\r\n
EventList: Complete\r\n
ListItems: 1\r\n
\r\n
```

The completion event always contains `EventList: Complete` and typically has an event name ending in `Complete` (e.g., `PeerlistComplete`, `CoreShowChannelsComplete`).

## Responses (Server to Client)

Every response contains a `Response` header:

| Response Value | Meaning |
|---|---|
| `Success` | Action completed successfully |
| `Error` | Action failed; `Message` header has details |
| `Follows` | Response body follows (used by `Command` action) |
| `Goodbye` | Server is closing the connection (response to `Logoff`) |

## Events (Server to Client, unsolicited)

Events are asynchronous notifications. They look like response blocks but have an `Event` header instead of `Response`:

```
Event: Newchannel\r\n
Privilege: call,all\r\n
Channel: SIP/6001-00000001\r\n
ChannelState: 0\r\n
ChannelStateDesc: Down\r\n
CallerIDNum: 6001\r\n
\r\n
```

Common events:
- `FullyBooted` -- Sent immediately after login; Asterisk is ready
- `Newchannel` / `Hangup` -- Channel lifecycle
- `Dial` / `Bridge` -- Call connection events
- `PeerStatus` -- SIP/IAX peer registration changes
- `Newstate` -- Channel state change
- `VarSet` -- Channel variable set

Events may arrive at any time between action responses. Robust clients must filter by `ActionID` to match responses to their requests rather than assuming the next block is the response.

## Common Read-Only Actions

| Action | Description | EventList? |
|---|---|---|
| `Ping` | Keepalive check | No |
| `CoreSettings` | Asterisk version, build info | No |
| `CoreStatus` | Uptime, channel count | No |
| `CoreShowChannels` | List active channels | Yes |
| `SIPpeers` | List SIP endpoints | Yes |
| `SIPshowpeer` | Detail for one SIP peer (requires `Peer` param) | No |
| `SIPshowregistry` | SIP registrations | Yes |
| `IAXpeers` | List IAX endpoints | Yes |
| `PJSIPShowContacts` | PJSIP contacts | Yes |
| `Status` | Channel status | Yes |
| `QueueStatus` | Queue members and callers | Yes |
| `QueueSummary` | Queue summary statistics | Yes |
| `ParkedCalls` | List parked calls | Yes |
| `BridgeList` | Active bridges | Yes |
| `ExtensionState` | Dialplan extension state (requires `Exten`, `Context`) | No |
| `MailboxCount` | Voicemail message count (requires `Mailbox`) | No |
| `ListCommands` | List available AMI actions | No |
| `DeviceStateList` | Device states | Yes |

## Write/Mutating Actions

| Action | Description | Key Parameters |
|---|---|---|
| `Originate` | Place an outbound call | `Channel`, `Context`, `Exten`, `Priority`, `CallerID` |
| `Hangup` | Hang up a channel | `Channel` |
| `Redirect` | Transfer a channel | `Channel`, `Context`, `Exten`, `Priority` |
| `SendText` | Send text to a channel | `Channel`, `Message` |
| `Command` | Execute CLI command | `Command` |
| `Reload` | Reload Asterisk modules | `Module` (optional) |
| `ModuleLoad` | Load/unload module | `Module`, `LoadType` |
| `LoggerRotate` | Rotate log files | (none) |

## Authentication

AMI supports two authentication modes configured in `/etc/asterisk/manager.conf`:

1. **Plaintext secret**: `secret = mysecret`
2. **MD5 challenge-response**: `Action: Challenge` then `Action: Login` with `Key` instead of `Secret`

The plaintext method is simpler and more common. The implementation in this codebase uses plaintext `Secret` authentication.

## Security Considerations

- AMI transmits credentials in cleartext over TCP. Use a VPN, SSH tunnel, or firewall rules to restrict access.
- The `Command` action can execute any CLI command, including destructive ones like `core stop now`. Always restrict which actions a user can perform via `manager.conf` permissions.
- This implementation restricts the generic `/api/ami/command` endpoint to a safe-listed set of read-only actions. Write actions (`Originate`, `Hangup`, `Command`, `SendText`) have dedicated endpoints.

## Port and Transport

| Port | Transport | Description |
|---|---|---|
| 5038 | TCP | Standard AMI (plaintext) |
| 5039 | TLS | AMI over TLS (if configured in `manager.conf`) |

## Protocol Quirks

1. **Banner is not a block.** The initial banner is a single `\r\n`-terminated line, not a `\r\n\r\n`-terminated block. Treating it as a block may cause hangs on servers that do not send trailing data after the banner.

2. **Unsolicited events after login.** Asterisk sends a `FullyBooted` event immediately after successful login. Naive clients that read the next block expecting their action response may instead get this event.

3. **Command output format varies by version.** Asterisk 13+ prefixes each output line with `Output: `. Older versions send raw text between the response header and `--END COMMAND--`.

4. **Duplicate keys.** Some events contain duplicate keys (e.g., multiple `ChanVariable` lines). A simple key-value map will only retain the last value. This implementation uses a `Record<string, string>` which has this limitation.

5. **EventList: start vs event names.** The completion event name varies by action (e.g., `PeerlistComplete`, `CoreShowChannelsComplete`). The safest termination check is `EventList: Complete`.

6. **LoggerRotate is mutating.** Despite appearing harmless, `LoggerRotate` creates new log files and is a write operation.

## API Endpoints

This implementation exposes the following HTTP endpoints:

| Method | Path | Description |
|---|---|---|
| POST | `/api/ami/probe` | Connect and read the AMI banner (no auth) |
| POST | `/api/ami/command` | Run a safe-listed read-only action |
| POST | `/api/ami/originate` | Place an outbound call |
| POST | `/api/ami/hangup` | Hang up a channel |
| POST | `/api/ami/clicommand` | Execute a CLI command |
| POST | `/api/ami/sendtext` | Send text to a channel |

### Probe Request

```json
{
  "host": "pbx.example.com",
  "port": 5038,
  "timeout": 10000
}
```

### Command Request

```json
{
  "host": "pbx.example.com",
  "port": 5038,
  "username": "admin",
  "secret": "mysecret",
  "action": "SIPpeers",
  "params": {},
  "timeout": 15000
}
```

### Originate Request

```json
{
  "host": "pbx.example.com",
  "username": "admin",
  "secret": "mysecret",
  "channel": "SIP/6001",
  "context": "default",
  "exten": "6002",
  "priority": 1,
  "callerID": "Test <1234>"
}
```

### CLI Command Request

```json
{
  "host": "pbx.example.com",
  "username": "admin",
  "secret": "mysecret",
  "command": "sip show peers"
}
```

All responses include a `transcript` array showing the raw C:/S: (client/server) message exchange for debugging.

## References

- Asterisk Wiki: [AMI Actions](https://docs.asterisk.org/Configuration/Interfaces/Asterisk-Manager-Interface-AMI/AMI-Actions/)
- Asterisk Wiki: [AMI Events](https://docs.asterisk.org/Configuration/Interfaces/Asterisk-Manager-Interface-AMI/AMI-Events/)
- Source: `src/worker/ami.ts`
