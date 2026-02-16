# Bitcoin P2P Wire Protocol (Port 8333)

## Overview
The Bitcoin P2P protocol is the network layer used by all Bitcoin nodes (full nodes, miners, SPV wallets) to communicate. It enables peer discovery, block propagation, transaction relay, and chain synchronization across the decentralized Bitcoin network.

- **Default Port:** 8333 (mainnet), 18333 (testnet3), 48333 (testnet4), 38333 (signet)
- **Transport:** TCP
- **Status:** Active — backbone of the Bitcoin network

## Message Format
Every Bitcoin protocol message follows this structure:

```
+----------+----------+----------+----------+----------+
| Magic    | Command  | Length   | Checksum | Payload  |
| 4 bytes  | 12 bytes | 4 bytes  | 4 bytes  | N bytes  |
+----------+----------+----------+----------+----------+
```

- **Magic**: Network identifier (mainnet: `0xf9beb4d9`, testnet3: `0x0b110907`)
- **Command**: ASCII string, null-padded to 12 bytes (e.g., `version`, `verack`, `getaddr`)
- **Length**: Little-endian uint32 payload size
- **Checksum**: First 4 bytes of double-SHA256(payload)
- **Payload**: Command-specific data

## Protocol Flow (Version Handshake)
```
Client                              Bitcoin Node (Port 8333)
  |                                        |
  |  ---- TCP Connect ----------------->   |
  |  ---- "version" message ----------->   |  Our version info
  |  <---- "version" message -----------   |  Node's version info
  |  ---- "verack" ------------------->   |  Acknowledge their version
  |  <---- "verack" -------------------   |  They acknowledge ours
  |                                        |
  |  ---- "getaddr" ------------------>   |  Request peer addresses
  |  <---- "addr" / "addrv2" ----------   |  Known peer list
  |                                        |
```

## Implementation Details

### Worker Endpoints

#### `POST /api/bitcoin/connect` (or `GET` with query params)
Perform a version handshake with a Bitcoin node and report its information.

**Request Body:**
```json
{
  "host": "seed.bitcoin.sipa.be",
  "port": 8333,
  "network": "mainnet",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "seed.bitcoin.sipa.be",
  "port": 8333,
  "protocol": "Bitcoin",
  "network": "mainnet",
  "rtt": 120,
  "handshakeComplete": true,
  "node": {
    "version": 70016,
    "userAgent": "/Satoshi:25.0.0/",
    "services": ["NODE_NETWORK", "NODE_WITNESS"],
    "servicesRaw": "0x409",
    "startHeight": 830000,
    "timestamp": "2024-01-15T12:00:00.000Z",
    "relay": true
  }
}
```

#### `POST /api/bitcoin/getaddr`
Complete handshake then send `getaddr` to request the node's known peer list.

**Request Body:** Same as `/connect`

**Response:**
```json
{
  "success": true,
  "host": "seed.bitcoin.sipa.be",
  "port": 8333,
  "protocol": "Bitcoin",
  "network": "mainnet",
  "nodeVersion": "/Satoshi:25.0.0/",
  "blockHeight": 830000,
  "messagesReceived": [
    { "command": "addr", "payloadSize": 3070 }
  ]
}
```

### Version Message Fields

| Field | Size | Description |
|-------|------|-------------|
| version | 4 bytes | Protocol version (70016 for Bitcoin Core 25.x) |
| services | 8 bytes | Bitfield of supported services |
| timestamp | 8 bytes | Unix timestamp of the node |
| addr_recv | 26 bytes | Network address of the receiving node |
| addr_from | 26 bytes | Network address of the sending node |
| nonce | 8 bytes | Random nonce for self-connection detection |
| user_agent | variable | Software identifier (e.g., `/Satoshi:25.0.0/`) |
| start_height | 4 bytes | Best known block height |
| relay | 1 byte | Whether to relay transactions (BIP37) |

### Service Flags

| Flag | Value | Meaning |
|------|-------|---------|
| NODE_NETWORK | 1 | Full node with complete blockchain |
| NODE_BLOOM | 4 | Supports BIP37 bloom filters |
| NODE_WITNESS | 8 | Supports SegWit (BIP144) |
| NODE_NETWORK_LIMITED | 1024 | Serves last 288 blocks only (pruned) |

### Network Magic Bytes

| Network | Magic | Default Port |
|---------|-------|-------------|
| Mainnet | `0xf9beb4d9` | 8333 |
| Testnet3 | `0x0b110907` | 18333 |
| Testnet4 | `0x1c163f28` | 48333 |
| Signet | `0x0a03cf40` | 38333 |

### Authentication
The Bitcoin protocol has no authentication. Any node can connect to any other node. Trust is based on proof-of-work consensus, not identity.

### Timeouts / Keep-Alives
- Connection timeout: 10-15 seconds (configurable)
- `ping`/`pong` messages keep connections alive
- Nodes typically disconnect peers that haven't sent anything for 20+ minutes
- Workers execution time limits apply

### Binary Encoding
The Bitcoin wire protocol is entirely binary:
- All integers are little-endian
- Variable-length integers (varints) use a compact encoding
- Network addresses are 16 bytes (IPv6 or IPv4-mapped-to-IPv6)
- Strings are preceded by a varint length

## Well-Known Bitcoin DNS Seeds
These DNS seeds resolve to lists of known Bitcoin nodes:
- `seed.bitcoin.sipa.be`
- `dnsseed.bluematt.me`
- `dnsseed.bitcoin.dashjr-list-of-p2p-nodes.us`
- `seed.bitcoinstats.com`
- `seed.bitcoin.jonasschnelli.ch`

## Related Cryptocurrency Protocols
Many cryptocurrencies use similar wire protocols derived from Bitcoin:
- **Litecoin** (Port 9333) — same message format, different magic
- **Dogecoin** (Port 22556) — same message format, different magic
- **Bitcoin Cash** (Port 8333) — same format with additional message types
- **Zcash** (Port 8233) — extended with shielded transaction types
