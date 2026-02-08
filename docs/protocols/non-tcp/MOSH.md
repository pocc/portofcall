# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**MOSH (Mobile Shell)** is a remote terminal application that supports intermittent connectivity, roaming, and intelligent local echo. Unlike SSH, MOSH uses UDP and maintains sessions across IP address changes, making it ideal for mobile devices and unreliable networks.

**Port:** 60000-61000 (UDP, dynamic range)
**Transport:** UDP
**Status:** Active open-source project
**RFC:** Not standardized (MIT project)

## Protocol Specification

### Key Features

1. **Roaming**: Maintains session across IP changes (WiFi ↔ cellular)
2. **Intermittent Connectivity**: Survives temporary disconnections
3. **Low Latency**: Instant local echo for typing
4. **Efficient**: Diffs screen state, sends minimal updates
5. **SSH Bootstrap**: Uses SSH for initial authentication
6. **UTF-8 Native**: Full Unicode support
7. **No Privileged Ports**: Runs in userspace

### Architecture

**Two Components:**

1. **mosh-server**: Runs on remote host
2. **mosh-client**: Runs on local machine

**Protocol Stack:**
```
┌─────────────────────────┐
│   User Terminal I/O     │
├─────────────────────────┤
│   Local Echo (Client)   │
├─────────────────────────┤
│   SSP (Synchronization) │  ← Screen state sync
├─────────────────────────┤
│   SMP (Transport)       │  ← Encrypted datagrams
├─────────────────────────┤
│   UDP                   │
└─────────────────────────┘
```

### Connection Flow

1. Client initiates SSH connection to server
2. SSH launches `mosh-server` on random UDP port (60000-61000)
3. Server sends back: UDP port + AES-128 session key
4. SSH connection closes
5. Client connects via UDP to server's port
6. SSP (State Synchronization Protocol) takes over

### State Synchronization Protocol (SSP)

**Screen State Diffing:**
- Server maintains canonical terminal state
- Client predicts state changes locally (instant echo)
- Server sends incremental diffs to synchronize
- Client reconciles predictions with server state

**Message Format:**
```
┌────────────────────────────┐
│   Sequence Number (64-bit) │
│   Timestamp (16-bit)       │
│   Fragment ID              │
│   Final Fragment Flag      │
│   Payload (diff/instruction)│
└────────────────────────────┘
```

### Secure Mobile Protocol (SMP)

**Encryption:**
- AES-128 in OCB mode (authenticated encryption)
- Key derived from SSH session
- Nonce: direction bit + packet sequence number

**Datagram Structure:**
```
┌────────────────────────────┐
│   Nonce (128-bit)          │
│   Encrypted Payload        │
│   Authentication Tag       │
└────────────────────────────┘
```

### Predictive Local Echo

**Keystroke Handling:**
1. User types character
2. Client displays character immediately (underlined = uncertain)
3. Client sends to server
4. Server confirms state change
5. Client removes underline (confirmed)

**Prediction States:**
- **Solid**: Confirmed by server
- **Underlined**: Locally predicted, waiting for confirmation
- **Incorrect Prediction**: Client rolls back and corrects

## Usage

```bash
# Basic connection
mosh user@hostname

# Specify SSH port
mosh --ssh="ssh -p 2222" user@hostname

# Specify UDP port range
mosh -p 60000:60010 user@hostname

# Use IPv6
mosh -6 user@hostname

# Predict always (aggressive local echo)
mosh --predict=always user@hostname

# No prediction (more like SSH)
mosh --predict=never user@hostname

# Adaptive prediction (default)
mosh --predict=adaptive user@hostname

# Specify server binary path
mosh --server=/usr/local/bin/mosh-server user@host
```

## Resources

- [MOSH Homepage](https://mosh.org/)
- [MOSH GitHub](https://github.com/mobile-shell/mosh)
- [Academic Paper](https://mosh.org/mosh-paper.pdf) - Original MIT research paper
- [MOSH Manual](https://mosh.org/mosh.1.html)

## Notes

- **vs SSH**: MOSH handles roaming and intermittent connectivity, SSH doesn't
- **SSH Dependency**: Requires SSH for initial authentication
- **UDP Only**: Uses UDP (SSH uses TCP)
- **Roaming**: IP address can change mid-session (mobile networks)
- **Firewall**: Needs UDP ports 60000-61000 open
- **NAT Traversal**: Works through NAT (UDP)
- **No Port Forwarding**: Cannot do SSH port forwarding
- **No X11 Forwarding**: No X11 support
- **No Agent Forwarding**: No ssh-agent forwarding
- **Terminal Only**: Designed for interactive terminal sessions only
- **Latency Tolerance**: Works on high-latency connections (satellite, 3G)
- **Power Efficiency**: Reduces radio wake-ups on mobile devices
- **Scrollback**: No server-side scrollback (use tmux/screen)
- **Copy/Paste**: Local terminal handles copy/paste
- **UTF-8**: Full Unicode support (better than many SSH clients)
- **Ctrl-C Works**: Instant even on high-latency connections
- **MIT License**: Open source
- **Installation**: Available in most Linux distributions
- **macOS**: Install via Homebrew (`brew install mosh`)
- **Windows**: Works via WSL or Cygwin
