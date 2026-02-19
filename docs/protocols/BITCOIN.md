# Bitcoin P2P Wire Protocol — Port of Call Reference

**RFC/BIP:** [Protocol documentation](https://en.bitcoin.it/wiki/Protocol_documentation), [BIP 37](https://github.com/bitcoin/bips/blob/master/bip-0037.mediawiki) (Bloom), [BIP 144](https://github.com/bitcoin/bips/blob/master/bip-0144.mediawiki) (SegWit), [BIP 155](https://github.com/bitcoin/bips/blob/master/bip-0155.mediawiki) (addrv2)
**Default port:** 8333 (mainnet), 18333 (testnet3), 48333 (testnet4), 38333 (signet)
**Source:** `src/worker/bitcoin.ts`
**Tests:** `tests/bitcoin.test.ts`

---

## Endpoints

### `GET|POST /api/bitcoin/connect` — Version handshake probe

Performs the Bitcoin version/verack handshake and reports node information.

**Request (POST body or GET query params):**

```json
{
  "host": "seed.bitcoin.sipa.be",
  "port": 8333,
  "network": "mainnet",
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | IP or hostname of Bitcoin node |
| `port` | `8333` | TCP port |
| `network` | `"mainnet"` | One of: `mainnet`, `testnet3`, `testnet4`, `signet` |
| `timeout` | `10000` | Outer wall-clock timeout in ms |

**Response (success):**

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
    "userAgent": "/Satoshi:27.0.0/",
    "services": ["NODE_NETWORK", "NODE_WITNESS"],
    "servicesRaw": "0x409",
    "startHeight": 880000,
    "timestamp": "2026-02-17T12:00:00.000Z",
    "relay": true
  },
  "note": "Bitcoin P2P protocol (port 8333). Connected to mainnet node running /Satoshi:27.0.0/ at block height 880000. Services: NODE_NETWORK, NODE_WITNESS."
}
```

**Key fields:**

- `rtt` — time from TCP connect to receiving the server's `version` message (ms). Does NOT include verack round-trip.
- `handshakeComplete` — `true` only if `verack` was received within 3 s after we sent ours. Many nodes are slow; `false` does not mean the connection failed — just that verack didn't arrive in the window.
- `node.version` — Bitcoin protocol version integer. 70016 = Bitcoin Core 25.x+. Older nodes may send 70015 (SegWit), 70002 (BIP 37), etc.
- `node.services` — decoded service flag names (see table below)
- `node.servicesRaw` — raw hex bitfield for flags we don't decode
- `node.startHeight` — best known block height the node has synced
- `node.relay` — BIP 37 relay flag. `false` means the node won't forward unconfirmed transactions unless a bloom filter is set.
- `note` — human-readable summary string

**Failure modes:**

- Invalid magic in response → `"Invalid network magic: 0x..."` (you connected to a non-Bitcoin service)
- Server sends a non-`version` command first → `"Expected 'version', got '<command>'"` (rare; some altcoin forks send other messages first)
- TCP timeout → `"Connection timeout"` (node unreachable or port filtered)

---

### `GET|POST /api/bitcoin/getaddr` — Peer discovery

Completes the version handshake, then sends `getaddr` to request the node's known peer address list. Parses the `addr` response to return structured peer information.

**Request:** same fields as `/connect`, with `timeout` default `15000`.

**Response (success):**

```json
{
  "success": true,
  "host": "seed.bitcoin.sipa.be",
  "port": 8333,
  "protocol": "Bitcoin",
  "network": "mainnet",
  "nodeVersion": "/Satoshi:27.0.0/",
  "blockHeight": 880000,
  "peerCount": 23,
  "peers": [
    {
      "timestamp": "2026-02-17T10:30:00.000Z",
      "services": ["NODE_NETWORK", "NODE_WITNESS"],
      "servicesRaw": "0x409",
      "address": "185.2.3.4",
      "port": 8333
    },
    {
      "timestamp": "2026-02-17T09:15:00.000Z",
      "services": ["NODE_NETWORK", "NODE_WITNESS", "NODE_COMPACT_FILTERS"],
      "servicesRaw": "0x449",
      "address": "2001:db8::1",
      "port": 8333
    }
  ],
  "messagesReceived": [
    { "command": "verack", "payloadSize": 0 },
    { "command": "addr", "payloadSize": 690 }
  ]
}
```

**Key fields:**

- `peerCount` — number of peers parsed from the `addr` message
- `peers[].timestamp` — last time this peer was known to be active (per the advertising node)
- `peers[].address` — IPv4 or IPv6 address. IPv4-mapped-to-IPv6 addresses (`::ffff:x.x.x.x`) are decoded to dotted-decimal.
- `peers[].services` — service flags of the advertised peer, not the node you connected to
- `messagesReceived` — all messages received after sending `getaddr`, in order. The handler reads up to 10 messages or until `addr` is received.

**Gotcha:** Many nodes restrict `getaddr` responses. Bitcoin Core limits the response to 23% of known addresses (max ~1000 entries) and rate-limits to once per 24 hours per connection. DNS seed nodes are more generous. If `peerCount` is 0 and `messagesReceived` contains no `addr` entry, the node likely ignored the request.

**Gotcha:** Only `addr` (v1) messages are parsed, not `addrv2` (BIP 155). If the node sends `addrv2` instead (which uses variable-length network address encoding), it will appear in `messagesReceived` with the correct command name but `peers` will be empty.

---

### `GET|POST /api/bitcoin/mempool` — Mempool inventory + ping RTT

Completes the handshake, sends `mempool` to request unconfirmed transaction inventory, then measures ping/pong round-trip time.

**Request:**

```json
{
  "host": "seed.bitcoin.sipa.be",
  "port": 8333,
  "network": "mainnet",
  "timeout": 20000,
  "maxTxIds": 50
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | IP or hostname |
| `port` | `8333` | TCP port |
| `network` | `"mainnet"` | Network name |
| `timeout` | `20000` | Outer wall-clock timeout in ms |
| `maxTxIds` | `20` | Maximum transaction IDs to collect (1–200). Does not affect `mempoolTxCount`. |

**Response (success):**

```json
{
  "success": true,
  "host": "seed.bitcoin.sipa.be",
  "port": 8333,
  "network": "mainnet",
  "mempoolTxCount": 4523,
  "txIds": [
    "a1b2c3d4e5f6...",
    "f6e5d4c3b2a1..."
  ],
  "pingRtt": 45,
  "rtt": 12300
}
```

**Key fields:**

- `mempoolTxCount` — total MSG_TX entries seen in `inv` messages (may exceed `txIds.length` when capped by `maxTxIds`)
- `txIds` — display-order hex transaction IDs (bytes reversed from wire order, matching block explorers). Capped at `maxTxIds`.
- `pingRtt` — ping/pong round-trip time in ms. `undefined` if the node didn't respond to `pong` within 5 s.
- `rtt` — total wall-clock time for the entire operation

**Gotcha:** The `mempool` command (BIP 35) requires the peer to have `NODE_BLOOM` (service flag 4) or to be running Bitcoin Core with `-whitelist` or `-whitebind`. Most public nodes silently ignore `mempool` requests from unknown peers. `mempoolTxCount: 0` is the normal result against standard nodes — use the `pingRtt` measurement which works universally.

**Gotcha:** The handler collects `inv` messages for up to 5 seconds. Nodes with large mempools may send many `inv` batches; the 5-second deadline and `maxTxIds` cap prevent unbounded collection.

---

## Wire Format

Every Bitcoin P2P message:

```
 0                   4                  16                  20       24       24+N
 +-------------------+------------------+-------------------+--------+--------+
 | Magic (4B)        | Command (12B)    | Payload len (4B)  | Cksum  | Payload|
 | network-specific  | ASCII, null-pad  | little-endian     | (4B)   | (N B)  |
 +-------------------+------------------+-------------------+--------+--------+
```

- **Magic**: network identifier (see table below)
- **Command**: ASCII command name, null-padded to exactly 12 bytes
- **Payload length**: uint32 LE
- **Checksum**: first 4 bytes of SHA256(SHA256(payload))
- **Payload**: command-specific binary data

### Network Magic Bytes

| Network | Magic | Default Port | Notes |
|---------|-------|-------------|-------|
| `mainnet` | `f9beb4d9` | 8333 | Production Bitcoin network |
| `testnet3` | `0b110907` | 18333 | Primary testnet |
| `testnet4` | `1c163f28` | 48333 | BIP-94 testnet |
| `signet` | `0a03cf40` | 38333 | Signature-based testnet |

### Service Flags

| Flag | Bit | Value | Meaning |
|------|-----|-------|---------|
| `NODE_NETWORK` | 0 | 1 | Full node, serves all blocks |
| `NODE_BLOOM` | 2 | 4 | Supports BIP 37 bloom filters (mempool) |
| `NODE_WITNESS` | 3 | 8 | Supports SegWit (BIP 144) |
| `NODE_COMPACT_FILTERS` | 6 | 64 | Serves BIP 157/158 compact block filters |
| `NODE_NETWORK_LIMITED` | 10 | 1024 | Pruned node, serves last 288 blocks only |
| `NODE_P2P_V2` | 11 | 2048 | Supports BIP 324 v2 encrypted transport |

### Variable-Length Integers (varints)

| First byte | Encoding | Range |
|-----------|----------|-------|
| `< 0xfd` | 1 byte literal | 0–252 |
| `0xfd` | 2-byte LE uint16 follows | 253–65535 |
| `0xfe` | 4-byte LE uint32 follows | 65536–4294967295 |
| `0xff` | 8-byte LE uint64 follows | 4294967296+ |

**Limitation:** The 0xff case reads only the low 32 bits. This is sufficient for mempool counts and addr lists but would truncate values >4 billion.

### Version Message Fields (as sent by this implementation)

| Field | Size | Value sent | Notes |
|-------|------|------------|-------|
| `version` | 4B LE int32 | `70016` | Bitcoin Core 25.x protocol version |
| `services` | 8B LE uint64 | `0` (NODE_NONE) | We don't serve blocks |
| `timestamp` | 8B LE int64 | current Unix time | |
| `addr_recv` | 26B | `127.0.0.1:8333` | Hardcoded; irrelevant for handshake |
| `addr_from` | 26B | `127.0.0.1:0` | Hardcoded |
| `nonce` | 8B | random | Anti-self-connection per protocol spec |
| `user_agent` | varint + UTF-8 | `/PortOfCall:1.0/` | Our identifier visible to the peer |
| `start_height` | 4B LE int32 | `0` | We report no blocks synced |
| `relay` | 1B bool | `0` (false) | Don't send us unconfirmed tx by default |

---

## Implementation Notes

### Checksum computation

The double-SHA256 checksum uses the Web Crypto API (`crypto.subtle.digest`). Since this is async, the implementation builds the message first, then fills in the 4 checksum bytes (offsets 20–23) after the hash completes. This pattern repeats for every message sent (version, verack, getaddr, mempool, ping).

### Received message checksums

**Not verified.** The implementation checks magic bytes and parses the command/length, but does not compute or verify the received payload checksum. A malicious or faulty peer could send corrupt payloads undetected.

### TCP fragmentation handling

`readMessage()` accumulates data from `reader.read()` calls until enough bytes are available for the header (24 bytes) and full payload. However, leftover bytes after the payload are discarded. If two messages arrive in a single TCP segment and the second starts mid-buffer, it will be lost. In practice this is rare for the small number of messages exchanged (handshake + one request).

### Timeout architecture

Each endpoint uses two layers:
1. **Outer wall-clock timeout** — `Promise.race` against the entire operation (default 10–20 s depending on endpoint)
2. **Inner per-read timeout** — 3–10 s passed to `readMessage()` for individual message reads

The verack read uses a short 3-second timeout; failure is non-fatal (handshakeComplete: false).

### Our version identity

The implementation identifies as `/PortOfCall:1.0/` with protocol version 70016 and `NODE_NONE` services. The `relay` flag is `false` and `start_height` is 0. This is a deliberately minimal peer that won't be asked to relay blocks or transactions.

---

## Quick Reference — curl

```bash
# Version handshake against a DNS seed (mainnet)
curl -s -X POST https://portofcall.ross.gg/api/bitcoin/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"seed.bitcoin.sipa.be"}' | jq .

# GET form with query params
curl -s 'https://portofcall.ross.gg/api/bitcoin/connect?host=seed.bitcoin.sipa.be&port=8333' | jq .

# Connect to testnet4 node
curl -s -X POST https://portofcall.ross.gg/api/bitcoin/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"seed.testnet4.bitcoin.sprovoost.nl","port":48333,"network":"testnet4"}' | jq .

# Discover peers (with parsed addresses)
curl -s -X POST https://portofcall.ross.gg/api/bitcoin/getaddr \
  -H 'Content-Type: application/json' \
  -d '{"host":"seed.bitcoin.sipa.be"}' | jq '.peers[:5]'

# Check node service flags
curl -s -X POST https://portofcall.ross.gg/api/bitcoin/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"seed.bitcoin.sipa.be"}' | jq '.node.services'

# Mempool snapshot (collect up to 100 txids)
curl -s -X POST https://portofcall.ross.gg/api/bitcoin/mempool \
  -H 'Content-Type: application/json' \
  -d '{"host":"seed.bitcoin.sipa.be","maxTxIds":100}' | jq '{count: .mempoolTxCount, sample: .txIds[:3], pingMs: .pingRtt}'

# Ping RTT measurement (mempool result always includes it)
curl -s -X POST https://portofcall.ross.gg/api/bitcoin/mempool \
  -H 'Content-Type: application/json' \
  -d '{"host":"seed.bitcoin.sipa.be","maxTxIds":1}' | jq '.pingRtt'

# Check block height across multiple seeds
for seed in seed.bitcoin.sipa.be dnsseed.bluematt.me seed.bitcoinstats.com; do
  echo -n "$seed: "
  curl -s -X POST https://portofcall.ross.gg/api/bitcoin/connect \
    -H 'Content-Type: application/json' \
    -d "{\"host\":\"$seed\",\"timeout\":5000}" | jq -r '.node.startHeight // .error'
done
```

---

## DNS Seeds

These hostnames resolve to lists of known reachable Bitcoin nodes:

| Seed | Operator |
|------|----------|
| `seed.bitcoin.sipa.be` | Pieter Wuille |
| `dnsseed.bluematt.me` | Matt Corallo |
| `dnsseed.bitcoin.dashjr-list-of-p2p-nodes.us` | Luke Dashjr |
| `seed.bitcoinstats.com` | bitcoinstats.com |
| `seed.bitcoin.jonasschnelli.ch` | Jonas Schnelli |

DNS seeds rotate addresses and may return different nodes on each query. For consistent testing, resolve a seed with `dig` first and use the IP directly.

---

## What Is NOT Implemented

- **Block/header download** — no `getblocks`, `getheaders`, `getdata`, or `block` message handling
- **Transaction relay** — `relay=false` in our version message; no `tx`/`inv` sending capability
- **`addrv2` parsing** (BIP 155) — variable-length network addresses (Tor v3, I2P, CJDNS) are not decoded
- **Checksum verification** on received messages
- **Encrypted transport** (BIP 324 v2) — connections are plaintext TCP
- **Authentication** — Bitcoin P2P has no auth; any node can connect to any other
- **Compact blocks** (BIP 152) — `sendcmpct` messages from peers are ignored
- **Fee filter** (BIP 133) — `feefilter` messages are not sent or processed
