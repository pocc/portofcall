# Rlogin Protocol (RFC 1282)

## Overview
Rlogin (Remote Login) is a BSD Unix remote terminal protocol, the predecessor to SSH. It provides a simple way to log into remote Unix systems with automatic credential passing based on trusted host relationships.

- **RFC:** [1282](https://datatracker.ietf.org/doc/html/rfc1282)
- **Default Port:** 513
- **Transport:** TCP
- **Status:** Legacy — superseded by SSH, but still found on older Unix/BSD systems

## Protocol Flow
```
Client                              Rlogin Server (Port 513)
  |                                        |
  |  ---- TCP Connect ----------------->   |
  |  ---- \0 (null byte) -------------->   |  Step 1: Initial null byte
  |  ---- localUser\0remoteUser\0 ----->   |  Step 2: Credentials
  |  ---- termType/speed\0 ------------>   |  (continued in same write)
  |                                        |
  |  <---- \0 (success) ---------------   |  Step 3: Server acknowledges
  |  <---- [optional banner/motd] -----   |  Login banner
  |                                        |
  |  ---- [terminal data] ------------>   |  Interactive session
  |  <---- [terminal data] ------------   |  (bidirectional)
  |                                        |
  |  ---- [connection close] --------->   |
```

### Handshake Detail
1. **Client sends null byte** (`\0`) — signals start of Rlogin session
2. **Client sends credential string:** `localUser\0remoteUser\0terminalType/terminalSpeed\0`
   - `localUser`: Username on the client machine
   - `remoteUser`: Username to log in as on the server
   - `terminalType`: Terminal emulation (e.g., `xterm`, `vt100`)
   - `terminalSpeed`: Baud rate (e.g., `38400`)
3. **Server responds:**
   - `\0` (single null byte) = success, proceed to shell
   - Any other data = error message (usually authentication failure)

## Implementation Details

### Worker Endpoints

#### `POST /api/rlogin/connect` (or `GET` with query params)
Test Rlogin connectivity: performs the handshake and reports success/failure with any banner text.

**Request Body:**
```json
{
  "host": "bsd-server.example.com",
  "port": 513,
  "localUser": "guest",
  "remoteUser": "guest",
  "terminalType": "xterm",
  "terminalSpeed": "38400",
  "timeout": 5000
}
```

**Response (success):**
```json
{
  "success": true,
  "host": "bsd-server.example.com",
  "port": 513,
  "protocol": "Rlogin",
  "localUser": "guest",
  "remoteUser": "guest",
  "terminalType": "xterm/38400",
  "handshakeSuccess": true,
  "banner": "Last login: Mon Jan 1 00:00:00 from client.example.com\n",
  "note": "Rlogin (RFC 1282) is a legacy remote login protocol..."
}
```

#### WebSocket `/api/rlogin/connect` (with `Upgrade: websocket` header)
Interactive terminal session over WebSocket. Performs the Rlogin handshake, then tunnels bidirectional terminal data.

**Query Parameters:**
- `host` (required): Target hostname
- `port` (default: 513)
- `localUser` (default: "guest")
- `remoteUser` (default: "guest")
- `terminalType` (default: "xterm")
- `terminalSpeed` (default: "38400")

### Authentication Model
Rlogin uses a **trusted host** model — no passwords are exchanged over the wire. The server decides whether to grant access based on:
- The client's source IP and hostname
- `.rhosts` or `/etc/hosts.equiv` files on the server
- The local and remote usernames

This is inherently insecure — traffic is unencrypted, and trust is IP-based.

### Timeouts
- Connection timeout: 5 seconds (configurable)
- Handshake read timeout: 3 seconds
- Banner read timeout: 2 seconds
- Workers execution time limits apply

### Window Size Control
Rlogin supports an out-of-band window size notification using TCP urgent data. The client sends a 12-byte structure when the terminal is resized. This implementation does not support urgent data (Cloudflare Workers Sockets API limitation).

## Security Considerations
Rlogin has significant security vulnerabilities:
- **No encryption** — all data (including credentials) sent in plaintext
- **IP-based trust** — susceptible to IP spoofing
- **No password exchange** — relies entirely on `.rhosts` trust
- **Superseded by SSH** — SSH provides encryption, key-based auth, and port forwarding

Most modern systems disable Rlogin by default. It remains relevant for:
- Legacy system administration
- Historical protocol study
- Embedded systems that predate SSH support

## Comparison with Related Protocols

| Protocol | Port | Encryption | Auth Method | Era |
|----------|------|-----------|-------------|-----|
| Rlogin   | 513  | None      | Trusted host (.rhosts) | 1980s |
| Telnet   | 23   | None      | Password prompt | 1960s |
| SSH      | 22   | Yes (AES, ChaCha20) | Keys, passwords, certificates | 1995+ |
| RDP      | 3389 | TLS       | NLA / password | 1998+ |
| VNC      | 5900 | Optional  | Password / none | 1998+ |

## Common Rlogin Servers
- **rlogind** — Standard BSD Rlogin daemon
- **inetd/xinetd** — Often manages rlogind as a child service
- **Busybox** — Embedded Linux includes rlogind
