# SSH Authentication Guide

## Overview

Port of Call provides **TCP tunneling** for SSH connections. The Worker creates a secure WebSocket tunnel to the SSH server, and the **browser-side SSH client handles authentication** (password, private key, etc.).

## Authentication Methods

Port of Call supports passing all common SSH authentication options to browser-side SSH clients:

- ✅ **Password authentication** (`password`)
- ✅ **Public key authentication** (`publickey`)
- ✅ **Keyboard-interactive** (`keyboard-interactive`)
- ✅ **Host-based authentication** (`hostbased`)

## How It Works

```
┌─────────────┐          ┌──────────────────┐          ┌─────────────┐
│   Browser   │          │  Cloudflare      │          │ SSH Server  │
│  SSH Client │◄────────►│  Worker (Tunnel) │◄────────►│             │
│ (xterm.js)  │ WebSocket│  (Port of Call)  │   TCP    │ (port 22)   │
└─────────────┘          └──────────────────┘          └─────────────┘
      ▲
      │
      └─ Authentication happens HERE (browser-side)
         using SSH options sent by Worker
```

1. **Worker receives SSH options** (username, password, privateKey, etc.)
2. **Worker creates TCP tunnel** to SSH server
3. **Worker sends options to browser** via initial WebSocket message
4. **Browser SSH client authenticates** using the provided credentials

## Usage Examples

### 1. Password Authentication (HTTP Test)

Test SSH connectivity with username/password:

```bash
curl -X POST https://portofcall.ross.gg/api/ssh/connect \
  -H "Content-Type: application/json" \
  -d '{
    "host": "ssh.example.com",
    "port": 22,
    "username": "admin",
    "password": "secret123",
    "authMethod": "password"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "SSH server reachable",
  "host": "ssh.example.com",
  "port": 22,
  "banner": "SSH-2.0-OpenSSH_8.9",
  "connectionOptions": {
    "username": "admin",
    "authMethod": "password",
    "hasPassword": true,
    "hasPrivateKey": false
  },
  "note": "This is a connectivity test only. For full SSH authentication, use WebSocket upgrade."
}
```

### 2. Private Key Authentication (WebSocket)

For full SSH sessions with private key authentication, use WebSocket:

```javascript
// Browser-side JavaScript
const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
...
-----END OPENSSH PRIVATE KEY-----`;

const sshOptions = {
  host: 'ssh.example.com',
  port: 22,
  username: 'admin',
  privateKey: privateKey,
  authMethod: 'publickey'
};

// Create WebSocket tunnel with SSH options
const params = new URLSearchParams(sshOptions);
const ws = new WebSocket(`wss://portofcall.ross.gg/api/ssh/connect?${params}`);

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'ssh-options') {
    // Worker sent SSH options - use them with browser SSH client
    const { Client } = require('ssh2'); // or use xterm.js with ssh2

    const conn = new Client();
    conn.on('ready', () => {
      console.log('SSH connection ready!');

      conn.shell((err, stream) => {
        if (err) throw err;

        // Pipe WebSocket data to SSH stream
        ws.onmessage = (msg) => stream.write(msg.data);
        stream.on('data', (data) => ws.send(data));
      });
    }).connect(data.options);
  }
};
```

### 3. Private Key with Passphrase

If your private key is encrypted with a passphrase:

```javascript
const sshOptions = {
  host: 'ssh.example.com',
  port: 22,
  username: 'admin',
  privateKey: privateKey,
  passphrase: 'keyPassphrase123',
  authMethod: 'publickey'
};
```

### 4. Multiple Authentication Methods

Specify preferred authentication order:

```javascript
const sshOptions = {
  host: 'ssh.example.com',
  port: 22,
  username: 'admin',
  password: 'fallbackPassword',
  privateKey: privateKey,
  authMethod: 'publickey', // Try publickey first, then password
};
```

### 5. Command Execution (SSH Exec Endpoint)

Execute commands non-interactively via the SSH exec channel:

```bash
curl -X POST https://portofcall.ross.gg/api/ssh/exec \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.0.2.1",
    "username": "root",
    "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----",
    "command": "uptime"
  }'
```

**Response:**
```json
{
  "success": true,
  "stdout": " 10:30:42 up 35 days,  2:15,  1 user,  load average: 0.00, 0.01, 0.05\n",
  "stderr": "",
  "executionTime": 1234,
  "colo": "SJC",
  "note": "SSH exec channel combines stdout and stderr. Use pty-req for separate streams."
}
```

#### Bash Shell Wrapper

Create an interactive shell-like experience with this bash function:

```bash
myssh() {
  if [ -z "$1" ]; then
    # Interactive mode - get hostname first
    local hostname_result=$(jq -n \
      --arg key "$(cat ~/.ssh/id_ed25519)" \
      --arg host "192.0.2.1" \
      '{
        host: $host,
        username: "root",
        privateKey: $key,
        command: "hostname"
      }' | curl -s -X POST https://portofcall.ross.gg/api/ssh/exec \
        -H "Content-Type: application/json" \
        -d @-)

    local hostname=$(echo "$hostname_result" | jq -r '.stdout // "unknown"' | tr -d '\n\r' | tr -d '[:cntrl:]')
    local colo=$(echo "$hostname_result" | jq -r '.colo // "unknown"')

    echo -e "\033[36mEntering remote shell (type 'exit' to quit)...\033[0m"

    while true; do
      echo -ne "\033[33m${hostname} via ${colo}>\033[0m "
      read -r cmd

      [ "$cmd" = "exit" ] && break
      [ -z "$cmd" ] && continue

      local api_response=$(jq -n \
        --arg key "$(cat ~/.ssh/id_ed25519)" \
        --arg host "192.0.2.1" \
        --arg cmds "$cmd" \
        '{
          host: $host,
          username: "root",
          privateKey: $key,
          command: $cmds
        }' | curl -s -X POST https://portofcall.ross.gg/api/ssh/exec \
          -H "Content-Type: application/json" \
          -d @-)

      local success=$(echo "$api_response" | jq -r '.success')
      if [ "$success" = "true" ]; then
        echo "$api_response" | jq -r '.stdout // ""' | sed $'s/^/\033[32m/' | sed $'s/$/\033[0m/'
      else
        echo "$api_response" | jq -r '.error // "Unknown error"' | sed $'s/^/\033[31mError: /' | sed $'s/$/\033[0m/'
      fi
    done
    echo -e "\033[36mExited remote shell.\033[0m"
  else
    # Single command mode
    local api_response=$(jq -n \
      --arg key "$(cat ~/.ssh/id_ed25519)" \
      --arg host "192.0.2.1" \
      --arg cmds "$1" \
      '{
        host: $host,
        username: "root",
        privateKey: $key,
        command: $cmds
      }' | curl -s -X POST https://portofcall.ross.gg/api/ssh/exec \
        -H "Content-Type: application/json" \
        -d @-)

    local success=$(echo "$api_response" | jq -r '.success')
    if [ "$success" = "true" ]; then
      echo "$api_response" | jq -r '.stdout // ""' | sed $'s/^/\033[32m/' | sed $'s/$/\033[0m/'
    else
      echo "$api_response" | jq -r '.error // "Unknown error"' | sed $'s/^/\033[31mError: /' | sed $'s/$/\033[0m/'
    fi
  fi
}
```

**Usage:**

Single command:
```bash
$ myssh "ls -la"
total 48
drwx------ 6 root root 4096 Feb 19 10:30 .
drwxr-xr-x 18 root root 4096 Jan 15 08:22 ..
```

Interactive mode:
```bash
$ myssh
Entering remote shell (type 'exit' to quit)...
example-server via SJC> pwd
/root
example-server via SJC> uptime
10:30:42 up 35 days, 2:15, 1 user, load average: 0.00, 0.01, 0.05
example-server via SJC> exit
Exited remote shell.
```

#### JSON Payload Reference

The SSH exec endpoint accepts the following JSON structure:

```json
{
  "host": "192.0.2.1",
  "port": 22,
  "username": "root",
  "authMethod": "privateKey",
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----",
  "passphrase": "optional-key-passphrase",
  "command": "ls -la /var/log",
  "timeout": 30000
}
```

**Authentication auto-detection:**
- If `privateKey` is provided without `authMethod`, automatically uses `privateKey` auth
- If `password` is provided without `authMethod`, automatically uses `password` auth
- You can explicitly set `authMethod` to `"password"` or `"privateKey"`

**Alternative: Using script instead of command:**
```json
{
  "host": "192.0.2.1",
  "username": "root",
  "privateKey": "...",
  "script": "#!/bin/bash\nuptime\ndf -h\nfree -m"
}
```

## Advanced SSH Options

### Connection Timeouts

```javascript
const sshOptions = {
  host: 'ssh.example.com',
  username: 'admin',
  privateKey: privateKey,
  timeout: 30000,       // Connect timeout: 30 seconds
  readyTimeout: 20000,  // Handshake timeout: 20 seconds
};
```

### Keepalive

Prevent connection from timing out:

```javascript
const sshOptions = {
  host: 'ssh.example.com',
  username: 'admin',
  privateKey: privateKey,
  keepaliveInterval: 10000, // Send keepalive every 10 seconds
};
```

### Cryptographic Algorithms

Specify preferred algorithms:

```javascript
const sshOptions = {
  host: 'ssh.example.com',
  username: 'admin',
  privateKey: privateKey,
  algorithms: {
    kex: [
      'ecdh-sha2-nistp256',
      'ecdh-sha2-nistp384',
      'ecdh-sha2-nistp521',
      'diffie-hellman-group-exchange-sha256'
    ],
    cipher: [
      'aes128-gcm',
      'aes128-gcm@openssh.com',
      'aes256-gcm',
      'aes256-gcm@openssh.com'
    ],
    serverHostKey: [
      'ssh-ed25519',
      'ecdsa-sha2-nistp256',
      'ecdsa-sha2-nistp384',
      'rsa-sha2-256',
      'rsa-sha2-512'
    ],
    hmac: [
      'hmac-sha2-256',
      'hmac-sha2-512',
      'hmac-sha1'
    ]
  }
};
```

### Host Key Verification

```javascript
const sshOptions = {
  host: 'ssh.example.com',
  username: 'admin',
  privateKey: privateKey,
  strictHostKeyChecking: true,  // Verify host key (requires known_hosts)
  hostHash: 'sha256',           // Host key hash algorithm
};
```

### Debug Mode

Enable debug logging:

```javascript
const sshOptions = {
  host: 'ssh.example.com',
  username: 'admin',
  privateKey: privateKey,
  debug: true, // Enable debug output to console
};
```

## Supported Private Key Formats

Port of Call passes private keys to browser-side SSH clients (like ssh2.js), which support:

- ✅ **OpenSSH format** (modern, recommended)
  ```
  -----BEGIN OPENSSH PRIVATE KEY-----
  ...
  -----END OPENSSH PRIVATE KEY-----
  ```

- ✅ **PEM format** (RSA)
  ```
  -----BEGIN RSA PRIVATE KEY-----
  ...
  -----END RSA PRIVATE KEY-----
  ```

- ✅ **PEM format** (ECDSA)
  ```
  -----BEGIN EC PRIVATE KEY-----
  ...
  -----END EC PRIVATE KEY-----
  ```

- ✅ **Ed25519** keys
  ```
  -----BEGIN OPENSSH PRIVATE KEY-----
  ...
  -----END OPENSSH PRIVATE KEY-----
  ```

## Generating SSH Keys

### Generate Ed25519 key (recommended):
```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
```

### Generate RSA key (4096 bits):
```bash
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
```

### Generate ECDSA key:
```bash
ssh-keygen -t ecdsa -b 521 -C "your_email@example.com"
```

### Convert old PEM to OpenSSH format:
```bash
ssh-keygen -p -f ~/.ssh/id_rsa -m openssh
```

## Security Best Practices

1. **Never expose private keys in URLs**
   - Use POST body or WebSocket connection metadata
   - Never pass privateKey in query parameters

2. **Use encrypted private keys**
   - Always encrypt keys with a strong passphrase
   - Use key agents for better security

3. **Prefer public key auth over passwords**
   - More secure than passwords
   - Supports key rotation
   - Can be revoked without changing passwords

4. **Enable host key verification in production**
   - Set `strictHostKeyChecking: true`
   - Maintain known_hosts file
   - Verify fingerprints on first connection

5. **Use strong cryptographic algorithms**
   - Prefer Ed25519 or ECDSA over RSA
   - Disable weak algorithms (DES, 3DES, MD5)
   - Use AES-GCM for encryption

6. **Implement connection timeouts**
   - Prevent hanging connections
   - Set reasonable timeout values
   - Use keepalive for long sessions

## Browser-Side SSH Clients

Port of Call works with any browser-side SSH client that supports WebSocket tunneling:

### Recommended Libraries

1. **ssh2** + **xterm.js**
   - Full SSH protocol implementation
   - Terminal emulation
   - File transfer support (SFTP)
   - [ssh2 on npm](https://www.npmjs.com/package/ssh2)
   - [xterm.js](https://xtermjs.org/)

2. **ssh2-streams**
   - Lower-level SSH protocol
   - More control over connection
   - [ssh2-streams on npm](https://www.npmjs.com/package/ssh2-streams)

### Example: xterm.js + ssh2

```javascript
import { Terminal } from 'xterm';
import { Client } from 'ssh2';

const term = new Terminal();
term.open(document.getElementById('terminal'));

// Connect to Port of Call WebSocket tunnel
const ws = new WebSocket('wss://portofcall.ross.gg/api/ssh/connect?host=ssh.example.com&port=22');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'ssh-options') {
    // Use SSH options from Worker
    const conn = new Client();

    conn.on('ready', () => {
      term.writeln('SSH connection established!');

      conn.shell((err, stream) => {
        if (err) {
          term.writeln(`Error: ${err.message}`);
          return;
        }

        // Connect terminal to SSH stream
        term.onData((input) => stream.write(input));
        stream.on('data', (data) => term.write(data.toString()));
        stream.stderr.on('data', (data) => term.write(data.toString()));
      });
    });

    conn.on('error', (err) => {
      term.writeln(`SSH Error: ${err.message}`);
    });

    conn.connect(data.options);
  }
};
```

## Troubleshooting

### "Authentication failed"
- Verify username is correct
- For password auth: check password
- For key auth: ensure public key is in `~/.ssh/authorized_keys` on server
- Check SSH server logs: `/var/log/auth.log`

### "Permission denied (publickey)"
- Public key not in authorized_keys
- Wrong permissions on .ssh directory (should be 700)
- Wrong permissions on authorized_keys (should be 600)
- SELinux blocking SSH access

### "Connection timeout"
- Server firewall blocking port 22
- Wrong host or port
- Server not responding
- Network issues

### "Host key verification failed"
- Host key changed (potential security issue!)
- First connection without known_hosts
- Use `strictHostKeyChecking: false` for testing (not production)

### "Encrypted key requires passphrase"
- Private key is encrypted
- Add `passphrase` parameter
- Or decrypt key first: `ssh-keygen -p -f keyfile`

## API Reference

See [SSH Connection Options interface](../src/worker/ssh.ts) for complete TypeScript definitions.

### SSHConnectionOptions

```typescript
interface SSHConnectionOptions {
  // Required
  host: string;
  port?: number; // default: 22

  // Authentication
  username?: string;
  password?: string;
  privateKey?: string;        // PEM-encoded private key
  passphrase?: string;        // For encrypted private keys
  authMethod?: 'password' | 'publickey' | 'keyboard-interactive' | 'hostbased';

  // Connection
  timeout?: number;           // default: 30000ms
  keepaliveInterval?: number; // default: 0 (disabled)
  readyTimeout?: number;      // default: 20000ms

  // Security
  hostHash?: 'md5' | 'sha1' | 'sha256';
  algorithms?: { /* see above */ };
  strictHostKeyChecking?: boolean; // default: false

  // Advanced
  debug?: boolean; // default: false
}
```

## Related Documentation

- [Cloudflare Detection](./CLOUDFLARE_DETECTION.md) - Limitations with Cloudflare-protected hosts
- [Project Overview](./PROJECT_OVERVIEW.md) - How Port of Call works
- [Sockets API](./SOCKETS_API.md) - TCP tunnel architecture
