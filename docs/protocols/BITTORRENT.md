# BitTorrent — Port of Call Implementation

**Port:** 6881 (peer wire), 6969 (HTTP tracker)
**Transport:** TCP (peer wire), HTTP (tracker scrape/announce)
**Spec:** [BEP 3](http://www.bittorrent.org/beps/bep_0003.html), [BEP 5](http://www.bittorrent.org/beps/bep_0005.html) (DHT), [BEP 10](http://www.bittorrent.org/beps/bep_0010.html) (Extension Protocol)
**Source:** `src/worker/bittorrent.ts`

## Endpoints

| Endpoint | Method | Transport | Default Port | Default Timeout | CF Detection | Description |
|---|---|---|---|---|---|---|
| `/api/bittorrent/handshake` | POST | TCP socket | 6881 | 10 s | Yes | BEP 3 peer handshake + client fingerprinting |
| `/api/bittorrent/piece` | POST | TCP socket | 6881 | 15 s | Yes | Piece exchange: handshake→INTERESTED→UNCHOKE→REQUEST→PIECE |
| `/api/bittorrent/scrape` | POST | HTTP fetch | 6969 | 10 s | No | HTTP tracker scrape (seeder/leecher/completed counts) |
| `/api/bittorrent/announce` | POST | HTTP fetch | 6969 | 10 s | No | HTTP tracker announce (peer list + swarm stats) |

Note the port split: peer wire endpoints default to **6881**, tracker endpoints to **6969**. Cloudflare detection runs only on TCP socket endpoints (handshake and piece), not on the HTTP fetch-based tracker endpoints.

---

## `/api/bittorrent/handshake`

Performs the BEP 3 68-byte protocol handshake and fingerprints the remote peer.

### Request

```json
{ "host": "peer.example.com", "port": 6881, "infoHash": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d", "timeout": 10000 }
```

- `infoHash` is optional — if omitted, a random 20-byte hash is generated (probe mode). Non-hex chars are stripped before validation.
- `port` defaults to 6881.

### Wire Exchange

```
Client → Peer: 68 bytes
  [19]["BitTorrent protocol"][0x00 0x00 0x00 0x00 0x00 0x10 0x00 0x01][info_hash(20)][peer_id(20)]

Peer → Client: 68 bytes (same format)
```

The client announces itself as `-PC0100-` (Azureus-style peer ID for "PortOfCall v0.1.0.0") plus 12 random bytes. Reserved bytes set **Extension Protocol** (BEP 10, byte 5 bit 4) and **DHT** (BEP 5, byte 7 bit 0).

### Response

```json
{
  "success": true,
  "host": "peer.example.com",
  "port": 6881,
  "rtt": 42,
  "isBitTorrent": true,
  "protocol": "BitTorrent protocol",
  "infoHash": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
  "peerId": "2d7142343632302d...",
  "peerIdDecoded": "qBittorrent 4.6.2",
  "reservedHex": "0000000000100005",
  "extensions": ["Extension Protocol (BEP 10)", "DHT (BEP 5)", "Fast Extension (BEP 6)"]
}
```

### Peer ID Decoding

Azureus-style (`-XX####-...`) is detected by checking bytes 0 and 7 for `-` (0x2D). The 2-char client code is looked up in a 22-client table:

| Code | Client | Code | Client |
|---|---|---|---|
| `AZ` | Vuze (Azureus) | `qB` | qBittorrent |
| `DE` | Deluge | `TR` | Transmission |
| `UT` | µTorrent | `LT` | libtorrent |
| `lt` | libtorrent (rasterbar) | `RT` | rTorrent |
| `BT` | mainline BitTorrent | `BC` | BitComet |
| `WB` | WebTorrent | `XL` | Xunlei |

Version bytes (positions 3–6) have leading zeros stripped, then each char joined with `.`. Example: `4620` → `4.6.2`. This works for most clients but can misinterpret clients using non-decimal version schemes.

If the peer ID doesn't match Azureus-style, printable ASCII is extracted (non-printable replaced with `.`) and returned as `"Unknown client: ..."`.

### Extension Bit Parsing

Six extension flags are checked from the 8 reserved bytes:

| Byte | Bit | Extension |
|---|---|---|
| 5 | 4 (0x10) | Extension Protocol (BEP 10) |
| 7 | 0 (0x01) | DHT (BEP 5) |
| 7 | 2 (0x04) | Fast Extension (BEP 6) |
| 5 | 0 (0x01) | LTEP (libtorrent Extension Protocol) |
| 0 | 7 (0x80) | Azureus Messaging Protocol |
| 2 | 3 (0x08) | NAT Traversal |

### HTTP Status Codes

| Status | Meaning |
|---|---|
| 200 | Successful handshake |
| 400 | Missing host or invalid infoHash |
| 403 | Host is behind Cloudflare |
| 502 | Peer responded but handshake failed (incomplete, wrong pstrlen, wrong protocol string) |
| 504 | Connection timeout |
| 500 | Other errors |

### Quirks

- **Random infoHash probing**: Without a real info_hash, the peer may accept the handshake (confirms it speaks BitTorrent) but will disconnect after since it doesn't have the torrent. Useful for detection/fingerprinting.
- **Extension Protocol advertised but not negotiated**: The client sets BEP 10 in its reserved bytes but never sends or processes an extended handshake message (msg ID 20). This is fine for probing but means you can't discover supported extensions like `ut_metadata` (BEP 9) or `ut_pex` (BEP 11).
- **No response infoHash validation**: The peer's echoed info_hash is returned but not compared against the requested one. A misbehaving peer could echo a different hash.

---

## `/api/bittorrent/piece`

Full peer wire session: handshake → read initial messages → INTERESTED → wait for UNCHOKE → REQUEST → receive PIECE data.

### Request

```json
{
  "host": "peer.example.com",
  "port": 6881,
  "infoHash": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
  "pieceIndex": 0,
  "pieceOffset": 0,
  "pieceLength": 16384,
  "timeout": 15000
}
```

- `infoHash` is **required** (unlike /handshake). Must be 40 hex chars.
- `pieceLength` is capped at **16384** (16 KiB) regardless of the value you pass — `Math.min(pieceLength, 16384)`.
- Default timeout is **15 s** (vs 10 s for /handshake).

### Wire Exchange

```
1. Client → Peer:  68-byte handshake (same as /handshake)
2. Peer → Client:  68-byte handshake
3. Peer → Client:  Optional BITFIELD (msg 5) + HAVE (msg 4) messages
4. Client → Peer:  INTERESTED (msg 2): [0x00 0x00 0x00 0x01 0x02]
5. Peer → Client:  UNCHOKE (msg 1): [0x00 0x00 0x00 0x01 0x01]
6. Client → Peer:  REQUEST (msg 6): [length=13][0x06][index(4)][begin(4)][length(4)]
7. Peer → Client:  PIECE (msg 7): [length][0x07][index(4)][begin(4)][data...]
```

### Timeout Architecture

The overall `timeout` parameter (default 15 s) wraps the entire operation via `Promise.race`. Within that:

| Phase | Timeout | Notes |
|---|---|---|
| Handshake read | 5 s per chunk | Accumulates until 68 bytes |
| Post-handshake messages | 3 s per read (up to 8 messages) | Drops to 1 s after BITFIELD received |
| UNCHOKE wait | 3 s per read (up to 6 messages) | Only runs if not already unchoked |
| PIECE read | 8 s single read | One message only |

### Response

```json
{
  "success": true,
  "host": "peer.example.com",
  "port": 6881,
  "infoHash": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
  "pieceIndex": 0,
  "pieceOffset": 0,
  "requestedLength": 16384,
  "bitfieldReceived": true,
  "unchokeReceived": true,
  "pieceDataReceived": true,
  "pieceDataBytes": 16384,
  "pieceDataHex": "89504e470d0a1a0a0000000d49484452000001...",
  "peerMessages": ["bitfield", "unchoke", "piece(index=0,begin=0,bytes=16384)"],
  "latencyMs": 230,
  "note": "Piece data received successfully."
}
```

- `pieceDataHex` shows the first **32 bytes** in hex, appending `"..."` if the data is longer.
- `peerMessages` is an array of all messages seen during the session.
- `note` has three possible values depending on outcome:
  - `"Piece data received successfully."` — got PIECE data
  - `"Peer unchoked but did not send PIECE (may not have the piece)."` — unchoked but no data
  - `"Peer did not send UNCHOKE — peer may be choking, or does not have requested piece."` — stayed choked

### Message ID Reference

| ID | Name | Parsed in /piece |
|---|---|---|
| 0 | choke | Yes — breaks message loop |
| 1 | unchoke | Yes — sets unchokeReceived, breaks loop |
| 2 | interested | Logged only |
| 3 | not_interested | Logged only |
| 4 | have | Logged only |
| 5 | bitfield | Sets bitfieldReceived, reduces wait to 1 s |
| 6 | request | Logged only |
| 7 | piece | Parsed — extracts index, begin, data |
| 8 | cancel | Logged only |
| 9 | port (DHT) | Logged only |
| ≥10 | (BEP 6 Fast, BEP 10 Extended, etc.) | Logged as `msg_{id}` |

### Quirks

1. **readExact excess-byte discard**: If a TCP read returns more bytes than the current message needs, the excess is silently dropped. In practice this can lose the start of the next message if the peer sends messages back-to-back in one TCP segment.
2. **peerMessages deduplication inconsistency**: The initial message loop (step 3) pushes every message name. The UNCHOKE wait loop (step 5) only pushes names not already in the array. So you can see duplicate names from phase 3 but not from phase 5.
3. **BITFIELD content not decoded**: The bitfield payload (which bits = which pieces the peer has) is not parsed or returned. Only `bitfieldReceived: true/false` is reported.
4. **Single REQUEST only**: Only one block is requested per session. No pipelining of multiple REQUEST messages (real clients pipeline 5–10 for throughput).
5. **No HAVE_ALL/HAVE_NONE**: BEP 6 Fast Extension messages (IDs 0x0D–0x11) are not recognized by name — logged as `msg_13`, `msg_14`, etc.

---

## `/api/bittorrent/scrape`

HTTP tracker scrape — fetches seeder/leecher/completed counts for a torrent.

### Request

```json
{ "host": "tracker.example.com", "port": 6969, "infoHash": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d", "timeout": 10000 }
```

- `infoHash` is **required**. 40 hex chars.
- Default port: **6969** (HTTP tracker, not peer wire).

### Wire Exchange

```
Client → Tracker:  GET http://{host}:{port}/scrape?info_hash={percent-encoded}
Tracker → Client:  Bencoded dict: d5:filesd20:{hash}d8:completei5e10:downloadedi100e10:incompletei2eeee
```

The info_hash is percent-encoded byte-by-byte (every byte as `%XX`, even printable ASCII). This is correct per the BEP 3 spec.

### Response

```json
{ "success": true, "seeders": 5, "leechers": 2, "completed": 100, "latencyMs": 85 }
```

### Bencode Parser

A minimal recursive parser supporting the four bencode types: integers (`i42e`), byte strings (`4:spam`), lists (`l...e`), and dicts (`d...e`). Returns `number | Uint8Array | BencodeValue[] | Map<string, BencodeValue>`.

### Quirks

1. **First-entry assumption**: The `files` dict is keyed by raw 20-byte info_hash. The parser iterates and takes the **first** Map entry, not the one matching the requested hash. For single-hash scrapes (the only kind this endpoint sends) this works, but the code would break on a multi-torrent scrape response.
2. **Binary dict key corruption**: Dict keys are decoded with `TextDecoder` (UTF-8), which corrupts raw binary info_hash bytes. This makes correct key matching impossible for the `files` dict — another reason the first-entry approach is the only viable path.
3. **No Cloudflare detection**: Uses `fetch()`, not `connect()`. The CF check is skipped entirely.
4. **No port validation or host regex**: Unlike the TCP socket endpoints, there's no input validation beyond checking that `host` is present and `infoHash` is 40 hex chars.
5. **HTTP only**: No HTTPS tracker support (URL is always `http://`).

---

## `/api/bittorrent/announce`

HTTP tracker announce — registers as a peer and receives the peer list.

### Request

```json
{
  "host": "tracker.example.com",
  "port": 6969,
  "infoHash": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
  "peerId": "2d5043303130302d...",
  "timeout": 10000
}
```

- `peerId` is optional — if omitted, random 20 bytes are generated. If provided, must be 40 hex chars.
- Default port: **6969**.

### Wire Exchange

```
Client → Tracker:  GET http://{host}:{port}/announce?info_hash={enc}&peer_id={enc}&uploaded=0&downloaded=0&left=0&event=started&compact=1&numwant=10&port=6881
Tracker → Client:  Bencoded dict with interval, complete, incomplete, peers
```

### Hardcoded Announce Parameters

| Parameter | Value | Notes |
|---|---|---|
| `uploaded` | `0` | Always zero |
| `downloaded` | `0` | Always zero |
| `left` | `0` | **Announces as a seeder** (complete). Some trackers may exclude you from leecher peer lists. |
| `event` | `started` | Always "started" — no support for stopped/completed/empty |
| `compact` | `1` | Requests compact peer format (6 bytes per peer) |
| `numwant` | `10` | Requests up to 10 peers |
| `port` | `6881` | Hardcoded — not the `port` param from the request body (which is the tracker port) |

### Compact Peer List Parsing

Two formats handled:

- **Compact** (when `peers` is a byte string): Every 6 bytes = 4 bytes IPv4 + 2 bytes port (big-endian). Returned as `["1.2.3.4:6881", ...]`.
- **Non-compact** (when `peers` is a list of dicts): Each dict has `ip` (byte string) and `port` (integer) keys.

**IPv6 not supported**: BEP 7 `peers6` key (18 bytes per peer: 16 IPv6 + 2 port) is not parsed.

### Response

```json
{
  "success": true,
  "interval": 1800,
  "peers": ["1.2.3.4:6881", "5.6.7.8:51413"],
  "seeders": 5,
  "leechers": 2,
  "latencyMs": 120
}
```

- `seeders`/`leechers` are only present if the tracker returns `complete`/`incomplete` keys.
- `interval` is the tracker's re-announce interval in seconds.

### Quirks

1. **`left=0` seeder announcement**: The client announces itself as having all data. Most trackers still return peers, but some tracker implementations may behave differently for seeders vs leechers.
2. **No stopped event**: The client sends `event=started` but never sends `event=stopped`. The tracker will retain this peer entry until its own timeout (typically 30–60 minutes).
3. **Same limitations as /scrape**: No Cloudflare detection, no port validation, no host regex, HTTP only.

---

## Cross-Endpoint Comparison

| Feature | /handshake | /piece | /scrape | /announce |
|---|---|---|---|---|
| Transport | TCP socket | TCP socket | HTTP fetch | HTTP fetch |
| Default port | 6881 | 6881 | 6969 | 6969 |
| Default timeout | 10 s | 15 s | 10 s | 10 s |
| infoHash required | No (random) | **Yes** | **Yes** | **Yes** |
| CF detection | Yes | Yes | No | No |
| Port validation | No | No | No | No |
| Method restriction | No | No | No | No |

---

## Curl Examples

### Handshake (probe mode — random infoHash)
```bash
curl -s http://localhost:8787/api/bittorrent/handshake \
  -d '{"host":"peer.example.com"}' | jq
```

### Handshake (with known infoHash)
```bash
curl -s http://localhost:8787/api/bittorrent/handshake \
  -d '{"host":"peer.example.com","port":51413,"infoHash":"aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"}' | jq
```

### Piece exchange
```bash
curl -s http://localhost:8787/api/bittorrent/piece \
  -d '{"host":"peer.example.com","port":51413,"infoHash":"aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d","pieceIndex":0}' | jq
```

### Tracker scrape
```bash
curl -s http://localhost:8787/api/bittorrent/scrape \
  -d '{"host":"tracker.opentrackr.org","port":1337,"infoHash":"aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"}' | jq
```

### Tracker announce
```bash
curl -s http://localhost:8787/api/bittorrent/announce \
  -d '{"host":"tracker.opentrackr.org","port":1337,"infoHash":"aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"}' | jq
```

---

## Known Limitations

1. **No UDP tracker protocol**: Only HTTP trackers are supported. The UDP tracker protocol (BEP 15) — used by most public trackers — requires UDP sockets, which Cloudflare Workers don't support.
2. **No TLS/HTTPS tracker**: Tracker URLs are always `http://`. No support for `https://` trackers.
3. **No BEP 9 metadata exchange**: Can't fetch torrent metadata (file names, sizes) from peers via `ut_metadata` extension messages.
4. **No BEP 10 extended handshake**: Extension Protocol is advertised in reserved bytes but never negotiated — can't discover peer-supported extensions.
5. **No BEP 6 Fast Extension messages**: HAVE_ALL (0x0D), HAVE_NONE (0x0E), SUGGEST_PIECE (0x0F), REJECT_REQUEST (0x10), ALLOWED_FAST (0x11) are not recognized.
6. **No BEP 7 IPv6 peers**: Compact `peers6` key from announce response is ignored.
7. **16 KiB block cap**: REQUEST length is capped at 16384 bytes. Standard per BEP 3, but some modern clients support larger blocks.
8. **Single block per session**: /piece requests one block and closes. No multi-block download or pipelining.
9. **No piece hash verification**: Downloaded piece data is not SHA-1 verified against the info dict. The caller receives raw bytes.
10. **TCP-only**: No uTP (BEP 29) or WebSocket transport.
