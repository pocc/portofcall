# IPFS — Power User Reference

**Ports:** 4001 (swarm/libp2p), 5001 (HTTP API), 8080 (gateway) | **Protocol:** libp2p multistream-select + Kubo RPC HTTP API | **Tests:** Deployed

Port of Call provides nine IPFS endpoints spanning two transport modes: a raw TCP libp2p multistream-select probe (port 4001) and a suite of Kubo RPC HTTP API proxies (port 5001). The swarm probe uses Cloudflare Workers `connect()` for direct TCP; the HTTP API endpoints use `fetch()` against the target node's Kubo RPC API.

---

## IPFS Ports

| Port | Service | Description |
|------|---------|-------------|
| **4001** | Swarm (libp2p) | Peer-to-peer connections. Multistream-select negotiation, then Noise/TLS encryption. |
| **5001** | HTTP API (Kubo RPC) | Administrative API. All endpoints are `POST`. **Not exposed to the internet by default** — bound to `127.0.0.1` unless explicitly configured. |
| **8080** | Gateway | Read-only HTTP gateway for retrieving content by CID. `GET /ipfs/<CID>`. |

The HTTP API (port 5001) is the Kubo RPC API. **Every endpoint uses HTTP POST** — even read operations like `/api/v0/id` and `/api/v0/cat`. GET requests return `405 Method Not Allowed`. This is by design: the Kubo RPC API is a command-execution interface, not a REST API.

---

## API Endpoints

### `POST /api/ipfs/probe` — libp2p multistream-select probe

Opens a raw TCP connection to the node's swarm port (default 4001) and performs a multistream-select handshake to identify the node and enumerate supported protocols.

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | Hostname or IP |
| `port` | number | `4001` | libp2p swarm port |
| `protocols` | string[] | `["/multistream/1.0.0", "/p2p/0.1.0", "/ipfs/0.1.0", "/ipfs/kad/1.0.0"]` | Protocols to negotiate |
| `timeout` | number (ms) | `10000` | Total timeout |

**Success (200):**
```json
{
  "success": true,
  "host": "ipfs.example.com",
  "port": 4001,
  "tcpLatency": 42,
  "isIPFSNode": true,
  "serverHeader": "/multistream/1.0.0",
  "negotiatedProtocols": ["/p2p/0.1.0", "/ipfs/kad/1.0.0"],
  "unsupportedProtocols": ["/ipfs/0.1.0"],
  "allMessages": ["/multistream/1.0.0", "/p2p/0.1.0", "/ipfs/kad/1.0.0"],
  "note": "libp2p multistream-select protocol negotiation...",
  "references": ["https://docs.ipfs.tech/concepts/libp2p/", "https://github.com/multiformats/multistream-select"]
}
```

**Protocol flow:**
1. Client sends varint-length-prefixed `/multistream/1.0.0\n`
2. Server echoes `/multistream/1.0.0\n` if supported
3. Client sends `ls\n` to enumerate available protocols
4. Client proposes each protocol in the `protocols` array
5. Server responds with the protocol name (accepted) or `na\n` (rejected)

After multistream negotiation, real IPFS nodes require transport encryption (Noise or TLS) before any application data flows. The probe stops after negotiation — it does not establish an encrypted session.

**Cloudflare detection:** This endpoint performs a DNS lookup and rejects Cloudflare-proxied hosts with HTTP 403, because Workers cannot connect to Cloudflare-proxied IPs.

---

### `POST /api/ipfs/add` — Add content to IPFS

Proxies to `POST /api/v0/add` on the target node. Uploads content as `multipart/form-data`.

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `5001` | Kubo API port |
| `content` | string | `"Hello IPFS"` | Content to add |
| `filename` | string | `"test.txt"` | Filename in the IPFS MFS |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "cid": "QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o",
  "size": "20",
  "name": "test.txt",
  "latencyMs": 156
}
```

The `cid` field is the content-addressed hash. CIDv0 hashes start with `Qm` (base58btc-encoded SHA-256 multihash). CIDv1 hashes start with `bafy` (base32-encoded).

**Kubo wire format:** The file is sent as `multipart/form-data` with field name `file`. The Kubo API returns NDJSON (one line per added object); for a single file, only one JSON line is returned.

---

### `POST /api/ipfs/cat` — Retrieve content by CID

Proxies to `POST /api/v0/cat?arg=<CID>` on the target node.

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `5001` | |
| `cid` | string | required | CIDv0 (`Qm...`) or CIDv1 (`bafy...`) |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "content": "Hello IPFS",
  "size": 10,
  "latencyMs": 89
}
```

The `content` field is the raw bytes decoded as UTF-8. Binary content (images, protobuf) will be corrupted — use the gateway (port 8080) for binary retrieval.

---

### `POST /api/ipfs/node-info` — Node identity

Proxies to `POST /api/v0/id` on the target node. Returns the node's peer ID, public key, listen addresses, and agent version.

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `5001` | |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "id": "12D3KooWLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "publicKey": "CAESIJ...",
  "addresses": [
    "/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW...",
    "/ip4/192.168.1.5/tcp/4001/p2p/12D3KooW...",
    "/ip6/::1/tcp/4001/p2p/12D3KooW..."
  ],
  "agentVersion": "kubo/0.28.0/",
  "protocolVersion": "ipfs/0.1.0",
  "protocols": ["/ipfs/bitswap/1.2.0", "/ipfs/kad/1.0.0", "/libp2p/circuit/relay/0.2.0/stop"],
  "latencyMs": 34
}
```

The `id` is the node's libp2p peer ID (Ed25519 or RSA key hash). The `addresses` array lists all multiaddrs the node is listening on. The `agentVersion` identifies the IPFS implementation (e.g. `kubo/0.28.0/`, `js-ipfs/0.66.0`). The `protocolVersion` is the libp2p protocol version. The `protocols` array lists all protocols the node supports.

---

### `POST /api/ipfs/pin-add` — Pin a CID

Proxies to `POST /api/v0/pin/add?arg=<CID>`. Pinning prevents the garbage collector from removing the block.

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `5001` | |
| `cid` | string | required | CID to pin |
| `timeout` | number (ms) | `15000` | Pinning large DAGs may be slow |

**Success (200):**
```json
{
  "success": true,
  "cid": "QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o",
  "pinned": ["QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o"],
  "latencyMs": 230
}
```

Pinning a DAG (directory, large file) recursively pins all child blocks. The operation may take significant time for large DAGs — increase `timeout` accordingly.

---

### `POST /api/ipfs/pin-ls` — List pinned CIDs

Proxies to `POST /api/v0/pin/ls?type=<type>`. Lists all pinned CIDs on the node.

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `5001` | |
| `cid` | string | -- | Filter to a specific CID |
| `type` | string | `"all"` | `"all"`, `"direct"`, `"indirect"`, `"recursive"` |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "pinCount": 3,
  "pins": [
    { "cid": "QmT78z...", "type": "recursive" },
    { "cid": "QmW2Wb...", "type": "direct" },
    { "cid": "QmYwAP...", "type": "indirect" }
  ],
  "latencyMs": 120
}
```

**Pin types:**
- **recursive** — the CID and all blocks it references are pinned (default for `pin add`)
- **direct** — only this specific block is pinned, not its children
- **indirect** — this block is pinned because it is a child of a recursively-pinned block

---

### `POST /api/ipfs/pin-rm` — Remove a pin

Proxies to `POST /api/v0/pin/rm?arg=<CID>&recursive=<bool>`.

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `5001` | |
| `cid` | string | required | CID to unpin |
| `recursive` | boolean | `true` | Unpin recursively |
| `timeout` | number (ms) | `15000` | |

**Success (200):**
```json
{
  "success": true,
  "cid": "QmT78z...",
  "removed": ["QmT78z..."],
  "latencyMs": 45
}
```

After unpinning, blocks become eligible for garbage collection (`ipfs repo gc`). They are not deleted immediately.

---

### `POST /api/ipfs/pubsub-pub` — Publish to a topic

Proxies to `POST /api/v0/pubsub/pub?arg=<topic>` with the message data as a file in multipart/form-data.

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `5001` | |
| `topic` | string | required | Topic name |
| `data` | string | `""` | Message payload |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "topic": "my-topic",
  "dataLength": 13,
  "latencyMs": 67
}
```

**Note:** PubSub requires `--enable-pubsub-experiment` on Kubo < 0.19. Starting with Kubo 0.19, pubsub is enabled by default. PubSub was deprecated in Kubo 0.31 and removed in later versions in favor of other gossip protocols.

---

### `POST /api/ipfs/pubsub-ls` — List subscribed topics

Proxies to `POST /api/v0/pubsub/ls`.

**Request body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | required | |
| `port` | number | `5001` | |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "topicCount": 2,
  "topics": ["my-topic", "announcements"],
  "latencyMs": 28
}
```

---

## Kubo RPC API Reference

All Kubo RPC API endpoints use **HTTP POST** exclusively. The `arg` query parameter is used for positional arguments. Multiple `arg` parameters can be passed for endpoints that accept multiple arguments.

### Authentication

The Kubo HTTP API has **no built-in authentication** by default. Security is achieved through:

1. **Bind address:** By default, the API binds to `127.0.0.1:5001` (localhost only). Remote access requires explicit configuration in `~/.ipfs/config`:
   ```json
   {
     "API": {
       "HTTPHeaders": {
         "Access-Control-Allow-Origin": ["*"]
       }
     },
     "Addresses": {
       "API": "/ip4/0.0.0.0/tcp/5001"
     }
   }
   ```

2. **API authorization (Kubo 0.25+):** Optional `Authorization` header support via the `API.Authorizations` config key. Supports bearer tokens and basic auth.

3. **Reverse proxy:** Nginx/Caddy in front of port 5001 with HTTP Basic Auth or mTLS.

Port of Call does not send any authentication headers. If the target node requires auth, requests will fail with HTTP 401/403.

### Important Kubo RPC API Endpoints Not Proxied

These endpoints are accessible via the Kubo API but not (yet) exposed through Port of Call:

| Endpoint | Description |
|----------|-------------|
| `POST /api/v0/version` | Kubo version, Go version, repo version |
| `POST /api/v0/swarm/peers` | Connected peers list |
| `POST /api/v0/swarm/connect?arg=<multiaddr>` | Connect to a specific peer |
| `POST /api/v0/swarm/disconnect?arg=<multiaddr>` | Disconnect from a peer |
| `POST /api/v0/dht/findpeer?arg=<peerID>` | Find a peer on the DHT |
| `POST /api/v0/dht/findprovs?arg=<CID>` | Find providers for a CID |
| `POST /api/v0/block/get?arg=<CID>` | Get a raw block |
| `POST /api/v0/block/stat?arg=<CID>` | Block size and CID |
| `POST /api/v0/dag/get?arg=<CID>` | Get a DAG node |
| `POST /api/v0/name/publish?arg=<CID>` | Publish IPNS name |
| `POST /api/v0/name/resolve?arg=<name>` | Resolve IPNS name |
| `POST /api/v0/repo/stat` | Repo size, block count |
| `POST /api/v0/repo/gc` | Trigger garbage collection |
| `POST /api/v0/stats/bw` | Bandwidth stats |
| `POST /api/v0/stats/bitswap` | Bitswap stats |
| `POST /api/v0/config/show` | Full node configuration |
| `POST /api/v0/bootstrap/list` | Bootstrap peer list |

---

## libp2p Multistream-Select Protocol

The swarm probe (port 4001) uses the multistream-select protocol to negotiate application protocols over a raw TCP connection.

### Wire Format

Each message is length-prefixed with a **varint** (unsigned LEB128 encoding) followed by the message bytes and a trailing newline (`\n`).

```
[varint: length of (protocol + \n)] [protocol string] [\n]
```

**Varint encoding (unsigned LEB128):**
- 7 bits of data per byte, LSB first
- MSB is a continuation bit (1 = more bytes follow, 0 = final byte)
- Example: 19 (decimal) = `0x13` (single byte, MSB=0)
- Example: 128 (decimal) = `0x80 0x01` (two bytes)

### Handshake Sequence

```
Client → Server:  [varint][/multistream/1.0.0\n]
Server → Client:  [varint][/multistream/1.0.0\n]

Client → Server:  [varint][ls\n]
Server → Client:  [varint][list of supported protocols...]

Client → Server:  [varint][/noise\n]
Server → Client:  [varint][/noise\n]       ← accepted
          — or —  [varint][na\n]            ← rejected
```

### Common libp2p Protocol IDs

| Protocol | Description |
|----------|-------------|
| `/multistream/1.0.0` | Protocol negotiation (always first) |
| `/noise` | Noise Framework encryption (XX handshake) |
| `/tls/1.0.0` | TLS 1.3 encryption |
| `/secio/1.0.0` | SECIO encryption (deprecated, removed in modern nodes) |
| `/ipfs/kad/1.0.0` | Kademlia DHT |
| `/ipfs/bitswap/1.2.0` | Block exchange protocol |
| `/libp2p/identify/1.0.0` | Peer identity exchange |
| `/libp2p/circuit/relay/0.2.0/hop` | Circuit relay (hop) |
| `/libp2p/circuit/relay/0.2.0/stop` | Circuit relay (stop) |
| `/p2p/0.1.0` | IPFS peer exchange (modern) |
| `/ipfs/0.1.0` | IPFS peer exchange (legacy) |
| `/meshsub/1.1.0` | GossipSub (pubsub) |
| `/ipfs/ping/1.0.0` | Ping protocol |
| `/libp2p/autonat/1.0.0` | NAT detection |
| `/libp2p/dcutr` | Direct Connection Upgrade through Relay |

---

## CID Formats

| Version | Prefix | Encoding | Example |
|---------|--------|----------|---------|
| CIDv0 | `Qm` | Base58btc SHA-256 | `QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o` |
| CIDv1 | `bafy` | Base32 SHA-256 | `bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi` |

CIDv0 is 46 characters (always starts with `Qm`). CIDv1 is variable-length and self-describing (includes codec, hash function, and digest length in the CID itself). Modern Kubo defaults to CIDv1 for new content.

---

## curl Examples

```bash
# Probe an IPFS node's libp2p protocols (swarm port)
curl -s -X POST https://portofcall.ross.gg/api/ipfs/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"ipfs.example.com","port":4001}' | jq .

# Get node identity (peer ID, agent version, addresses)
curl -s -X POST https://portofcall.ross.gg/api/ipfs/node-info \
  -H 'Content-Type: application/json' \
  -d '{"host":"ipfs.example.com","port":5001}' | jq '{id: .id, agent: .agentVersion, protocols: .protocols}'

# Add content and get CID
curl -s -X POST https://portofcall.ross.gg/api/ipfs/add \
  -H 'Content-Type: application/json' \
  -d '{"host":"ipfs.example.com","port":5001,"content":"Hello, IPFS!","filename":"hello.txt"}' | jq .cid

# Retrieve content by CID
curl -s -X POST https://portofcall.ross.gg/api/ipfs/cat \
  -H 'Content-Type: application/json' \
  -d '{"host":"ipfs.example.com","port":5001,"cid":"QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o"}' | jq .content

# Pin a CID
curl -s -X POST https://portofcall.ross.gg/api/ipfs/pin-add \
  -H 'Content-Type: application/json' \
  -d '{"host":"ipfs.example.com","port":5001,"cid":"QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o"}' | jq .

# List all pins (recursive only)
curl -s -X POST https://portofcall.ross.gg/api/ipfs/pin-ls \
  -H 'Content-Type: application/json' \
  -d '{"host":"ipfs.example.com","port":5001,"type":"recursive"}' | jq '.pins[] | .cid'

# Remove a pin
curl -s -X POST https://portofcall.ross.gg/api/ipfs/pin-rm \
  -H 'Content-Type: application/json' \
  -d '{"host":"ipfs.example.com","port":5001,"cid":"QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o"}' | jq .

# Publish to pubsub topic
curl -s -X POST https://portofcall.ross.gg/api/ipfs/pubsub-pub \
  -H 'Content-Type: application/json' \
  -d '{"host":"ipfs.example.com","port":5001,"topic":"my-channel","data":"Hello subscribers!"}' | jq .

# List subscribed pubsub topics
curl -s -X POST https://portofcall.ross.gg/api/ipfs/pubsub-ls \
  -H 'Content-Type: application/json' \
  -d '{"host":"ipfs.example.com","port":5001}' | jq .topics

# Round-trip: add content, then retrieve it
CID=$(curl -s -X POST https://portofcall.ross.gg/api/ipfs/add \
  -H 'Content-Type: application/json' \
  -d '{"host":"ipfs.example.com","content":"Round-trip test"}' | jq -r .cid)
echo "CID: $CID"
curl -s -X POST https://portofcall.ross.gg/api/ipfs/cat \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"ipfs.example.com\",\"cid\":\"$CID\"}" | jq .content
```

---

## Known Limitations

**No authentication support:** Port of Call does not send any authentication headers to the IPFS API. Nodes configured with `API.Authorizations` (Kubo 0.25+) or behind a reverse proxy with auth will reject requests.

**No TLS to the IPFS API:** Connections to port 5001 use plain HTTP. If the IPFS node requires HTTPS on its API port (uncommon but possible with a reverse proxy), requests will fail. The standard Kubo configuration does not use TLS on port 5001.

**Binary content via `/api/ipfs/cat`:** Content is decoded as UTF-8 and returned as a JSON string. Binary data (images, protobuf, encrypted blobs) will be corrupted. Use the IPFS HTTP gateway (port 8080, `GET /ipfs/<CID>`) for binary retrieval.

**Large content via `/api/ipfs/add`:** Content is sent as a JSON string in the request body, then re-encoded into multipart/form-data. Very large files will hit JSON parsing limits and Workers memory limits. For files larger than ~10 MB, add directly to the IPFS node.

**No directory operations:** The `/api/v0/add` endpoint supports adding directories (multiple files in one multipart upload), but Port of Call only sends a single file per request.

**No streaming/progress:** `/api/v0/add` with `progress=true` returns progress events as NDJSON. Port of Call reads the entire response as a single JSON object, so progress reporting is not supported.

**Swarm probe does not establish encryption:** The probe performs only multistream-select negotiation. It does not complete the Noise or TLS handshake that modern IPFS nodes require before application data can flow. The probe determines whether the node speaks multistream-select and which protocols it advertises, but cannot exchange actual IPFS data.

**PubSub deprecation:** PubSub was deprecated in Kubo 0.31 and removed in later versions. The `pubsub-pub` and `pubsub-ls` endpoints will return errors on nodes running recent Kubo versions.

**Cloudflare detection only on probe:** The swarm probe endpoint checks if the target host resolves to a Cloudflare IP and rejects it. The HTTP API endpoints (add, cat, node-info, pin-*, pubsub-*) do not perform this check. Since IPFS API nodes are typically not behind Cloudflare CDN this is unlikely to cause issues, but the behavior is inconsistent.

**No IPFS path resolution:** The `cat` endpoint accepts bare CIDs only. IPFS paths like `/ipfs/Qm.../subdir/file.txt` must be passed as the full arg string. The CID parameter is URL-encoded into the `arg` query parameter, so path separators will work, but there is no separate path field.

---

## Local Testing

```bash
# Run a local IPFS node via Docker (Kubo)
docker run -d \
  --name ipfs \
  -p 4001:4001 \
  -p 5001:5001 \
  -p 8080:8080 \
  ipfs/kubo:latest

# Verify the node is running
curl -s -X POST http://localhost:5001/api/v0/id | jq '{id: .ID, agent: .AgentVersion}'

# Verify swarm is listening
curl -s -X POST http://localhost:5001/api/v0/swarm/peers | jq '.Peers | length'

# Add content directly
curl -s -X POST http://localhost:5001/api/v0/add \
  -F file=@/etc/hostname | jq .

# Retrieve via gateway
CID=$(curl -s -X POST http://localhost:5001/api/v0/add -F file=@/etc/hostname | jq -r .Hash)
curl http://localhost:8080/ipfs/$CID

# Check API access controls
curl -s -X POST http://localhost:5001/api/v0/config/show | jq '.API'
```

**Docker volume persistence:**
```bash
docker run -d \
  --name ipfs \
  -v ipfs-data:/data/ipfs \
  -p 4001:4001 -p 5001:5001 -p 8080:8080 \
  ipfs/kubo:latest
```

---

## Resources

- [Kubo RPC API Reference](https://docs.ipfs.tech/reference/kubo/rpc/)
- [IPFS Concepts](https://docs.ipfs.tech/concepts/)
- [libp2p Specification](https://github.com/libp2p/specs)
- [Multistream-Select Specification](https://github.com/multiformats/multistream-select)
- [CID Specification](https://github.com/multiformats/cid)
- [Multiaddr Specification](https://github.com/multiformats/multiaddr)
- [Kubo Configuration Reference](https://github.com/ipfs/kubo/blob/master/docs/config.md)
- [IPFS Gateway Specification](https://specs.ipfs.tech/http-gateways/path-gateway/)
