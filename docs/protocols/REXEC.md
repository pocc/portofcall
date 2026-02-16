# Rexec Protocol (Port 512)

## Overview
Rexec (Remote Execution) is a BSD Unix protocol for executing a single command on a remote host with explicit username/password authentication. It is the command-execution companion to Rlogin (port 513) in the BSD remote services family.

- **Default Port:** 512
- **Transport:** TCP
- **Status:** Legacy — superseded by SSH, but found on older Unix/BSD systems

## Key Differences from Rlogin and RSH

| Feature | Rexec (512) | Rlogin (513) | RSH (514/tcp) |
|---------|------------|-------------|---------------|
| Purpose | Execute one command | Interactive shell | Execute one command |
| Auth method | Username + password | .rhosts trust | .rhosts trust |
| Output | stdout (+ optional stderr) | Full terminal | stdout + stderr |
| Interactive | No | Yes | No |

## Protocol Flow
```
Client                              Rexec Server (Port 512)
  |                                        |
  |  ---- TCP Connect ----------------->   |
  |  ---- stderrPort\0 ---------------->   |  Stderr port (or \0 for none)
  |  ---- username\0 ------------------>   |  Credentials
  |  ---- password\0 ------------------>   |
  |  ---- command\0 ------------------->   |  Command to execute
  |                                        |
  |  <---- \0 (success) ---------------   |  First byte: \0 = OK
  |  <---- [command stdout] -----------   |  Command output on primary
  |  <---- [command stderr] -----------   |  (on stderr port if given)
  |                                        |
  |  <---- [connection close] ----------  |  Command finished
```

### Handshake Detail
1. **Client sends stderr port** — either a port number (as ASCII string) followed by `\0` for a separate stderr channel, or just `\0` for no separate stderr
2. **Client sends username** — ASCII string terminated with `\0`
3. **Client sends password** — ASCII string terminated with `\0` (cleartext!)
4. **Client sends command** — shell command terminated with `\0`
5. **Server responds:**
   - `\0` (single null byte) = success, command output follows
   - `\1` + error message = authentication or execution failure

### Stderr Port
If the client sends a non-empty stderr port number, the server connects *back* to the client on that port to send stderr output separately. This is impractical for browser-based clients (Workers can't accept incoming connections), so we send `\0` for no stderr channel.

## Implementation Details

### Worker Endpoints

#### `POST /api/rexec/execute` (or `GET` with query params)
Execute a command on a remote host via Rexec protocol.

**Request Body:**
```json
{
  "host": "bsd-server.example.com",
  "port": 512,
  "username": "admin",
  "password": "secret",
  "command": "id",
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "bsd-server.example.com",
  "port": 512,
  "protocol": "Rexec",
  "rtt": 45,
  "serverAccepted": true,
  "username": "admin",
  "command": "id",
  "output": "uid=0(root) gid=0(root) groups=0(root)",
  "note": "Rexec (port 512) is the BSD remote execution protocol...",
  "security": "NONE — Rexec transmits username and password in cleartext."
}
```

#### WebSocket `/api/rexec/execute` (with `Upgrade: websocket` header)
Interactive command execution session over WebSocket. Performs the Rexec handshake, then pipes command output to the WebSocket and allows sending stdin to the running command.

**Query Parameters:**
- `host` (required): Target hostname
- `port` (default: 512)
- `username` (default: "guest")
- `password` (default: "")
- `command` (default: "id")

### Authentication
Unlike Rlogin (which uses .rhosts trust), Rexec requires explicit username and password. However, credentials are transmitted in **cleartext** — no encryption whatsoever.

### Timeouts
- Connection timeout: 10 seconds (configurable)
- Handshake read timeout: 5 seconds
- Output read timeout: 2 seconds per chunk
- Workers execution time limits apply

### Binary vs. Text Encoding
Rexec is a text protocol with null-byte delimiters. All credentials and commands are ASCII. Command output is raw bytes (whatever the command produces).

## Security Considerations
Rexec has critical security vulnerabilities:
- **Cleartext credentials** — username and password sent in plain text
- **No encryption** — all data is unencrypted
- **No integrity protection** — susceptible to MITM attacks
- **Superseded by SSH** — SSH provides encryption, key-based auth, and secure command execution

## BSD Remote Services Family

| Protocol | Port | Auth | Purpose | Era |
|----------|------|------|---------|-----|
| **Rexec** | **512** | **Password** | **Execute one command** | **1980s** |
| Rlogin | 513 | .rhosts trust | Interactive shell | 1980s |
| RSH | 514/tcp | .rhosts trust | Execute one command | 1980s |
| SSH | 22 | Keys/passwords | All of the above + more | 1995+ |

## Common Rexec Servers
- **rexecd** — Standard BSD remote execution daemon
- **inetd/xinetd** — Often manages rexecd as a child service
- **Busybox** — Embedded Linux may include rexecd
