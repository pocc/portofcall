# Ethereum Protocol — Port of Call Reference

**Spec:** [Ethereum JSON-RPC API](https://ethereum.org/en/developers/docs/apis/json-rpc/), [DevP2P RLPx](https://github.com/ethereum/devp2p/blob/master/rlpx.md), [EIP-8](https://eips.ethereum.org/EIPS/eip-8), [EIP-695](https://eips.ethereum.org/EIPS/eip-695) (eth_chainId), [JSON-RPC 2.0](https://www.jsonrpc.org/specification)
**Default ports:** 8545 (HTTP JSON-RPC), 30303 (DevP2P/RLPx TCP)
**Source:** `src/worker/ethereum.ts`

---

## Overview

Ethereum nodes expose two distinct interfaces:

1. **JSON-RPC API (port 8545)** — Standard HTTP POST interface for querying chain state, submitting transactions, and managing the node. Uses JSON-RPC 2.0 framing over HTTP.

2. **DevP2P/RLPx (port 30303)** — Peer-to-peer wire protocol for node discovery, block/transaction propagation, and state sync. Uses encrypted TCP connections with secp256k1 ECIES.

This module provides four endpoints covering both interfaces, with the caveat that full DevP2P handshakes require secp256k1 crypto not available in the Cloudflare Workers runtime.

---

## Endpoints

### `POST /api/ethereum/rpc` — Single JSON-RPC method call

Sends a single JSON-RPC 2.0 request to an Ethereum node's HTTP API.

**Request body:**

```json
{
  "host": "192.168.1.100",
  "port": 8545,
  "method": "eth_blockNumber",
  "params": [],
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | IP or hostname of Ethereum node |
| `port` | `8545` | HTTP JSON-RPC port |
| `method` | `"eth_blockNumber"` | Any valid Ethereum JSON-RPC method name |
| `params` | `[]` | Method parameters array |
| `timeout` | `10000` | Request timeout in ms |

**Response (success):**

```json
{
  "success": true,
  "result": "0x1234abc",
  "latencyMs": 45
}
```

**Response (RPC error):**

```json
{
  "success": false,
  "error": "RPC error -32601: The method eth_foo does not exist/is not available",
  "errorData": "optional additional error context",
  "latencyMs": 30
}
```

**JSON-RPC 2.0 compliance:** The implementation validates that the response contains `"jsonrpc": "2.0"` and that the response `id` matches the request `id`. Non-compliant responses are flagged as errors.

---

### `POST /api/ethereum/info` — Multi-method node overview

Queries five JSON-RPC methods in parallel to produce a comprehensive node snapshot.

**Request body:**

```json
{
  "host": "192.168.1.100",
  "port": 8545,
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | IP or hostname |
| `port` | `8545` | HTTP JSON-RPC port |
| `timeout` | `10000` | Per-method timeout in ms |

**Methods called in parallel:**

| Method | Returns | Example |
|--------|---------|---------|
| `web3_clientVersion` | Node software string | `"Geth/v1.13.15-stable/linux-amd64/go1.22.3"` |
| `net_version` | Network ID (decimal string) | `"1"` (mainnet), `"11155111"` (sepolia) |
| `eth_chainId` | Chain ID (hex quantity) | `"0x1"` (mainnet), `"0xaa36a7"` (sepolia) |
| `eth_blockNumber` | Head block number (hex) | `"0x12ab34"` |
| `eth_syncing` | Sync status or `false` | `false` (fully synced) |

**Response (success):**

```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 8545,
  "clientVersion": "Geth/v1.13.15-stable/linux-amd64/go1.22.3",
  "clientVersionError": null,
  "networkId": "1",
  "networkIdError": null,
  "chainId": "0x1",
  "chainIdDecimal": 1,
  "chainIdError": null,
  "blockNumber": "0x12ab34",
  "blockNumberDecimal": 1223476,
  "blockNumberError": null,
  "syncing": false,
  "syncingError": null,
  "latencyMs": 120
}
```

**Partial success:** If at least one of `clientVersion`, `blockNumber`, `networkId`, or `chainId` succeeds, the response reports `"success": true`. Individual method errors appear in their respective `*Error` fields.

---

### `POST /api/ethereum/probe` — DevP2P/RLPx port probe

Connects to TCP port 30303 and attempts to read initial data. Applies heuristic fingerprinting to determine whether the response looks like RLPx.

**Request body:**

```json
{
  "host": "192.168.1.100",
  "port": 30303,
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | IP or hostname |
| `port` | `30303` | DevP2P TCP port |
| `timeout` | `10000` | Connection timeout in ms |

**Response (typical — server silent):**

```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 30303,
  "tcpLatency": 25,
  "portOpen": true,
  "receivedBytes": 0,
  "rlpxFingerprint": {
    "isRLPx": null,
    "note": "Server silent -- waiting for client Auth message. Normal RLPx behavior. Full handshake requires secp256k1 ECIES crypto."
  },
  "protocol": "Ethereum DevP2P / RLPx",
  "limitations": [
    "Full RLPx handshake requires secp256k1 ECDH + ECIES encryption",
    "secp256k1 is not available as a built-in in the Workers runtime",
    "Use Ethereum JSON-RPC API (port 8545) for programmatic node interaction"
  ],
  "references": [
    "https://github.com/ethereum/devp2p/blob/master/rlpx.md",
    "https://eips.ethereum.org/EIPS/eip-8"
  ]
}
```

**RLPx fingerprinting heuristics:**

| Detection | Criteria | Note |
|-----------|----------|------|
| EIP-8 | First 2 bytes = big-endian length of remaining data | Length-prefixed RLPx handshake (post-2016 nodes) |
| Legacy pre-EIP-8 | Exactly 307 bytes | Original fixed-size ECIES Auth message |
| Opaque binary | < 10% printable ASCII in first 32 bytes | Consistent with encrypted handshake |
| Not RLPx | >= 10% printable ASCII | Likely not Ethereum / different protocol |

---

### `POST /api/ethereum/p2p-probe` — Raw TCP byte inspection

Opens a passive TCP connection to the P2P port and reads whatever bytes the peer sends first. Unlike the `/probe` endpoint, this does not apply RLPx fingerprinting -- it returns raw hex bytes.

**Request body:**

```json
{
  "host": "192.168.1.100",
  "port": 30303,
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | IP or hostname |
| `port` | `30303` | TCP port |
| `timeout` | `10000` | Connection + read timeout in ms |

**Response:**

```json
{
  "success": true,
  "host": "192.168.1.100",
  "port": 30303,
  "responseBytes": "",
  "responseLength": 0,
  "latencyMs": 50,
  "note": "Server sent no data. In RLPx the initiator (client) speaks first by sending an Auth message."
}
```

The `responseBytes` field contains up to 512 bytes of hex-encoded data received from the peer.

---

## Ethereum JSON-RPC 2.0 Protocol Details

### Request Format

Every JSON-RPC request is an HTTP POST with `Content-Type: application/json`:

```json
{
  "jsonrpc": "2.0",
  "method": "eth_blockNumber",
  "params": [],
  "id": 1
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `jsonrpc` | string | Yes | MUST be exactly `"2.0"` |
| `method` | string | Yes | The RPC method name |
| `params` | array | Yes | Positional parameters (some methods accept none) |
| `id` | number/string/null | Yes | Client-chosen correlation ID; response MUST echo it |

### Response Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0x1234abc"
}
```

Or on error:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32601,
    "message": "The method eth_foo does not exist/is not available",
    "data": "optional"
  }
}
```

**Key rules:**
- A response MUST contain either `result` or `error`, never both
- The `error.code` is a signed integer; standard codes are defined in JSON-RPC 2.0
- The `error.data` field is optional and can contain additional context (e.g., Solidity revert reasons)

### Standard JSON-RPC Error Codes

| Code | Meaning |
|------|---------|
| `-32700` | Parse error — invalid JSON |
| `-32600` | Invalid request — not a valid JSON-RPC object |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |
| `-32000` to `-32099` | Server error (implementation-defined) |

### Ethereum Quantity Encoding

Ethereum uses a specific hex encoding convention for quantities:

- Quantities (block numbers, gas, balances) are hex-encoded with a `0x` prefix
- Leading zeros are omitted: `0x1` not `0x01`, `0x41` not `0x041`
- Zero is encoded as `0x0`
- Data (hashes, addresses, bytecode) retains leading zeros and is always even-length

---

## Common JSON-RPC Methods

### `eth_blockNumber`

Returns the current block number.

```
Request:  { "method": "eth_blockNumber", "params": [] }
Response: { "result": "0x12e4f8a" }
```

No parameters. Result is a hex QUANTITY.

### `web3_clientVersion`

Returns the node software version string.

```
Request:  { "method": "web3_clientVersion", "params": [] }
Response: { "result": "Geth/v1.13.15-stable/linux-amd64/go1.22.3" }
```

Format varies by client: `Geth/...`, `Erigon/...`, `Nethermind/...`, `Besu/...`, `Reth/...`.

### `net_version`

Returns the network ID as a decimal string.

```
Request:  { "method": "net_version", "params": [] }
Response: { "result": "1" }
```

| Network ID | Chain |
|------------|-------|
| `"1"` | Ethereum Mainnet |
| `"11155111"` | Sepolia testnet |
| `"17000"` | Holesky testnet |

**Note:** `net_version` returns the *network* ID. Use `eth_chainId` (EIP-695) for the *chain* ID. On mainnet they are both 1, but they can differ on some networks.

### `eth_chainId`

Returns the chain ID as a hex quantity (EIP-695). Preferred over `net_version` for chain identification since EIP-155.

```
Request:  { "method": "eth_chainId", "params": [] }
Response: { "result": "0x1" }
```

| Chain ID (hex) | Chain ID (dec) | Chain |
|----------------|----------------|-------|
| `0x1` | 1 | Ethereum Mainnet |
| `0xaa36a7` | 11155111 | Sepolia |
| `0x4268` | 17000 | Holesky |
| `0x89` | 137 | Polygon |
| `0xa` | 10 | Optimism |
| `0xa4b1` | 42161 | Arbitrum One |
| `0x2105` | 8453 | Base |

### `eth_syncing`

Returns sync status or `false` if fully synced.

```
Request:  { "method": "eth_syncing", "params": [] }
Response: { "result": false }
```

When syncing:

```json
{
  "result": {
    "startingBlock": "0x0",
    "currentBlock": "0x12ab34",
    "highestBlock": "0x12ffff"
  }
}
```

### `eth_gasPrice`

Returns the current gas price in wei as a hex quantity.

```
Request:  { "method": "eth_gasPrice", "params": [] }
Response: { "result": "0x3b9aca00" }
```

`0x3b9aca00` = 1,000,000,000 wei = 1 Gwei.

### `eth_getBlockByNumber`

Returns block data. Takes a block number (hex) and a boolean for full transactions.

```
Request:  { "method": "eth_getBlockByNumber", "params": ["latest", false] }
```

The second parameter controls whether to return full transaction objects (`true`) or just hashes (`false`).

---

## DevP2P/RLPx Wire Protocol (Port 30303)

### Protocol Stack

```
Application   eth/68   (Ethereum wire protocol v68)
              snap/1   (Snap sync protocol)
Transport     RLPx     (encrypted multiplexed TCP)
Crypto        ECIES    (secp256k1 ECDH + AES-128-CTR + HMAC-SHA-256)
Discovery     discv4   (UDP, Kademlia DHT) / discv5 (UDP, topic-based)
```

### RLPx Handshake Sequence

```
Client                              Server
  |                                    |
  |--- Auth (ECIES encrypted) -------->|   ~307 bytes (pre-EIP-8)
  |                                    |   or length-prefixed (EIP-8)
  |<--- AuthAck (ECIES encrypted) ----|
  |                                    |
  |    [derive frame keys]             |
  |                                    |
  |--- Hello (RLP, encrypted) ------->|
  |<--- Hello (RLP, encrypted) -------|
  |                                    |
  |    [protocol negotiation]          |
  |                                    |
```

**Key points:**

1. The **initiator (client) speaks first** by sending an Auth message. A passive probe will receive nothing from a well-behaved node.
2. Auth messages are **ECIES-encrypted** using the recipient's secp256k1 public key.
3. Pre-EIP-8 Auth is exactly **307 bytes**. Post-EIP-8 adds a 2-byte big-endian length prefix and may be larger due to future-proofing.
4. After Auth/AuthAck, both peers derive AES-128-CTR + HMAC-SHA-256 frame keys.
5. Hello frames are RLP-encoded and contain the protocol version, client ID, capabilities, listen port, and node ID.

### RLP Encoding

RLP (Recursive Length Prefix) is Ethereum's binary serialization format:

| Data | RLP Encoding |
|------|-------------|
| Single byte 0x00-0x7f | The byte itself |
| String 0-55 bytes | `(0x80 + length)` + data |
| String > 55 bytes | `(0xb7 + length-of-length)` + length + data |
| List 0-55 bytes total | `(0xc0 + length)` + items |
| List > 55 bytes total | `(0xf7 + length-of-length)` + length + items |

### Why Full DevP2P Is Not Possible in Workers

Cloudflare Workers lack:
- **secp256k1** — Required for ECDH key exchange and ECIES encryption
- **Raw ECDSA** — Required to sign the Auth message with an ephemeral key
- **Long-lived TCP** — Workers have execution time limits

The JSON-RPC API (port 8545) is the recommended alternative for programmatic interaction.

---

## Network Security Notes

- JSON-RPC (8545) is **unauthenticated by default** in most node software. Production nodes should use reverse proxies, IP allowlists, or JWT authentication (Engine API).
- The Engine API (port 8551) uses JWT bearer tokens and handles consensus-layer communication (post-Merge).
- DevP2P (30303) connections are authenticated by the ECIES handshake (requires knowing the node's enode URI / public key).
- Many public RPC providers (Infura, Alchemy, QuickNode) expose JSON-RPC over HTTPS with API key authentication.

---

## Testing

### Using curl against a local node

```bash
# eth_blockNumber
curl -s -X POST http://localhost:8545/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# web3_clientVersion
curl -s -X POST http://localhost:8545/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"web3_clientVersion","params":[],"id":2}'

# eth_chainId
curl -s -X POST http://localhost:8545/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":3}'

# net_version
curl -s -X POST http://localhost:8545/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"net_version","params":[],"id":4}'

# eth_syncing
curl -s -X POST http://localhost:8545/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":5}'

# eth_gasPrice
curl -s -X POST http://localhost:8545/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_gasPrice","params":[],"id":6}'

# eth_getBlockByNumber (latest, no full txs)
curl -s -X POST http://localhost:8545/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["latest",false],"id":7}'
```

### Using the Port of Call API

```bash
# Single RPC call
curl -s -X POST https://portofcall.example/api/ethereum/rpc \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.1.100","method":"eth_blockNumber"}'

# Node overview (5 methods in parallel)
curl -s -X POST https://portofcall.example/api/ethereum/info \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.1.100"}'

# DevP2P probe
curl -s -X POST https://portofcall.example/api/ethereum/probe \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.1.100","port":30303}'

# Raw TCP P2P probe
curl -s -X POST https://portofcall.example/api/ethereum/p2p-probe \
  -H "Content-Type: application/json" \
  -d '{"host":"192.168.1.100"}'
```

### Checking if a port is an Ethereum node

```bash
# Step 1: Try JSON-RPC on 8545
curl -s -X POST https://portofcall.example/api/ethereum/info \
  -H "Content-Type: application/json" \
  -d '{"host":"TARGET","timeout":5000}'

# Step 2: If JSON-RPC fails, try DevP2P on 30303
curl -s -X POST https://portofcall.example/api/ethereum/probe \
  -H "Content-Type: application/json" \
  -d '{"host":"TARGET"}'
```

---

## Resources

- [Ethereum JSON-RPC API](https://ethereum.org/en/developers/docs/apis/json-rpc/) — Official method reference
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification) — Wire format
- [DevP2P RLPx Transport](https://github.com/ethereum/devp2p/blob/master/rlpx.md) — Encrypted P2P transport
- [EIP-8: DevP2P Forward Compatibility](https://eips.ethereum.org/EIPS/eip-8) — Length-prefixed handshake
- [EIP-695: eth_chainId](https://eips.ethereum.org/EIPS/eip-695) — Chain identification method
- [EIP-155: Replay Protection](https://eips.ethereum.org/EIPS/eip-155) — Chain ID in transaction signing
- [RLP Specification](https://ethereum.org/en/developers/docs/data-structures-and-encoding/rlp/) — Recursive Length Prefix encoding
- [Ethereum Wire Protocol (eth/68)](https://github.com/ethereum/devp2p/blob/master/caps/eth.md) — Block/tx propagation
- [chainlist.org](https://chainlist.org/) — Comprehensive chain ID directory
