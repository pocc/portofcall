# RSH (Remote Shell) Protocol

## Overview

RSH (Remote Shell) is a BSD remote command execution protocol that uses `.rhosts`-based trust instead of passwords. It is part of the **BSD r-commands** family alongside Rlogin (port 513) and Rexec (port 512), and is the direct ancestor of SSH.

- **Port**: 514/tcp
- **RFC**: RFC 1282 (covers rlogin and rsh)
- **Status**: Deprecated — superseded by SSH (RFC 4251+)
- **Security**: None — no encryption, relies on IP-based trust

## Protocol Flow

```
Client → Server: "\0"                          (no stderr port)
Client → Server: "localUsername\0"             (client-side user)
Client → Server: "remoteUsername\0"            (server-side user to run as)
Client → Server: "command\0"                   (shell command)
Server → Client: "\0"                          (accepted) or error text
Server → Client: command stdout...
```

## Authentication: `.rhosts` Trust

RSH grants access based on the contents of `/etc/hosts.equiv` and `~/.rhosts` on the server:

- **`/etc/hosts.equiv`**: Lists trusted hosts (all users from that host are trusted)
- **`~/.rhosts`**: Per-user list of trusted `hostname username` pairs

The server checks: "Is the client connecting from a trusted host, as a trusted user?" If yes, the command runs. No password is ever sent.

## Privileged Port Requirement

RSH traditionally requires the client to connect from a **privileged source port (< 1024)**. On Unix systems, only root can bind privileged ports, which provides a weak form of assurance that the client is a legitimate rsh process.

**Cloudflare Workers cannot bind privileged ports.** A connection from an unprivileged port will typically be rejected by strict RSH servers with an error like:
- `Permission denied`
- `Connection from illegitimate port`
- `Must be superuser to run rsh`

This rejection still confirms the server is active and running RSH — Port of Call detects and reports this case explicitly.

## Differences from Related Protocols

| Protocol | Port | Auth | Session | Privileged Port |
|----------|------|------|---------|-----------------|
| Rexec | 512 | Password (cleartext) | Single command | No |
| Rlogin | 513 | .rhosts trust | Interactive shell | Yes |
| RSH | 514 | .rhosts trust | Single command | Yes |
| SSH | 22 | Key/password (encrypted) | Both | No |

## Implementation Notes

### Worker (`src/worker/rsh.ts`)

- Exports `handleRshExecute` (POST `/api/rsh/execute`) — HTTP probe mode
- Exports `handleRshWebSocket` (WebSocket `/api/rsh/execute`) — streaming tunnel mode
- Detects privileged port rejections and reports them as `privilegedPortRejection: true`
- Cloudflare detection guards the endpoint

### Response Fields

```typescript
{
  success: boolean;
  host: string;
  port: number;
  protocol: 'RSH';
  rtt: number;                        // round-trip time in ms
  serverAccepted: boolean;            // true if \0 first byte
  localUser: string;
  remoteUser: string;
  command: string;
  output?: string;                    // command stdout (if accepted)
  serverMessage?: string;             // error text from server
  privilegedPortRejection: boolean;   // true if port < 1024 required
  note: string;                       // contextual explanation
  security: string;                   // always warns about cleartext
}
```

### UI (`src/components/RSHClient.tsx`)

- Host, port (default 514), local user, remote user, command fields
- Explains `.rhosts` trust vs password auth
- Specifically handles privileged port rejection as a positive detection
- Includes protocol handshake reference

## Security Considerations

RSH is **entirely insecure** and should not be used on production systems:

1. **No encryption** — all data including command output is plaintext
2. **IP-based trust** — source IP can be spoofed
3. **No integrity protection** — traffic can be modified in transit
4. **Privileged port "security"** — trivially bypassed with root access

**Use SSH instead** for all remote command execution needs.

## Testing

```bash
# Integration tests
npx vitest run tests/rsh.test.ts
```

Tests cover:
1. Missing host validation (400 error)
2. Unreachable host handling (500 error)
3. Custom users and command parameters
4. GET query parameter support
5. Default port (514) and user (guest)
6. Cloudflare-protected host detection (403)

## Historical Context

RSH was developed at UC Berkeley in the early 1980s as part of BSD Unix. Along with Rlogin and Rexec, it formed the standard suite of remote access tools before SSH existed. The `.rhosts` trust model, while convenient, proved fundamentally insecure:

- The 1988 **Morris Worm** exploited `.rhosts` trust to propagate between systems
- In 1995, **Tsutomu Shimomura's IP spoofing attack** (documented by Kevin Mitnick) exploited the privileged port + .rhosts model

These incidents accelerated the development and adoption of SSH (1995, Tatu Ylönen at Helsinki University of Technology).
