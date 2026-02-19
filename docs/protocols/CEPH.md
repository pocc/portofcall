# Ceph Monitor (MSGR) — Power User Reference

**Ports:** 6789 (v1 legacy / combined), 3300 (v2 msgr2-only) | **Protocol:** MSGR v1 / MSGR v2 | **Transport:** TCP

Port of Call provides six Ceph endpoints: a banner-level connection probe, a lightweight banner-only probe, a full MSGR v1 handshake with CONNECT/CONNECT_REPLY exchange, and three MGR REST API endpoints for health, OSD, and pool data.

---

## API Endpoints

### `POST /api/ceph/connect` — Banner detection + entity address

Connects to a Ceph monitor, reads the MSGR banner, and attempts to read additional data (entity address for v1, feature payload for v2). Does not complete the full handshake.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `6789`  | Use 3300 for msgr2-only monitors |
| `timeout` | number | `10000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "ceph-mon1.example.com",
  "port": 6789,
  "rtt": 42,
  "connectTime": 18,
  "isCeph": true,
  "msgrVersion": "v1 (msgr1)",
  "banner": "ceph v027",
  "entityInfo": {
    "entityType": "mon",
    "nonce": 0,
    "port": 6789,
    "ipAddress": "10.0.1.5"
  },
  "v2Features": null,
  "rawBytesReceived": 153,
  "message": "Ceph monitor detected (v1 (msgr1)). Banner: \"ceph v027\""
}
```

For MSGR v2, `entityInfo` is null and `v2Features` contains:
```json
{
  "v2Features": {
    "supportedFeatures": "3",
    "requiredFeatures": "3",
    "payloadLength": 16
  }
}
```

**Notes:**
- Reads 8 bytes initially, then attempts to read more data with a 500ms timeout for trailing bytes.
- Does not send any data to the server; purely passive detection.
- Entity address parsing extracts IPv4 and IPv6 addresses from the sockaddr_storage embedded in the entity_addr_t.

---

### `POST /api/ceph/probe` — Lightweight banner probe

Reads exactly 9 bytes from the server and detects whether it is a Ceph monitor. Minimal overhead; does not parse entity addresses or features.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `6789`  | |
| `timeout` | number | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "host": "ceph-mon1.example.com",
  "port": 6789,
  "rtt": 23,
  "isCeph": true,
  "msgrVersion": "v1 (msgr1)",
  "banner": "ceph v027",
  "message": "Ceph monitor detected (v1 (msgr1))."
}
```

---

### `POST /api/ceph/cluster-info` — Full MSGR v1 handshake

Performs the complete MSGR v1 banner exchange and sends a CONNECT message to elicit a CONNECT_REPLY. Extracts server entity type, feature flags, protocol version, and auth requirements. Falls back to passive feature extraction for MSGR v2 servers.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `6789`  | |
| `timeout` | number | `15000` | Total timeout in ms |

**Success — MSGR v1 (200):**
```json
{
  "success": true,
  "host": "ceph-mon1.example.com",
  "port": 6789,
  "rtt": 85,
  "connectTimeMs": 18,
  "msgrVersion": "v1 (msgr1)",
  "serverBanner": "ceph v027",
  "serverEntity": {
    "type": "mon",
    "typeCode": 1,
    "nonce": 0,
    "ip": "10.0.1.5",
    "port": 6789,
    "addressFamily": "IPv4"
  },
  "connectReply": {
    "tag": 11,
    "tagName": "BADAUTHORIZER",
    "features": "0x3ffddff8ffacffff",
    "globalSeq": 0,
    "connectSeq": 0,
    "protocolVersion": 15,
    "authLen": 0,
    "flags": 0
  },
  "handshakeComplete": false,
  "authRequired": true,
  "message": "MSGR v1 handshake completed. Server tag: BADAUTHORIZER. Protocol v15"
}
```

**Success — MSGR v2 (200):**
```json
{
  "success": true,
  "host": "ceph-mon1.example.com",
  "port": 3300,
  "connectTimeMs": 22,
  "msgrVersion": "v2 (msgr2)",
  "serverBanner": "ceph v2",
  "features": {
    "supported": "0x3",
    "required": "0x3"
  },
  "note": "MSGR v2 handshake requires TLS/auth negotiation; feature flags extracted",
  "message": "Ceph monitor detected (v2 (msgr2)). Feature flags: {\"supported\":\"0x3\",\"required\":\"0x3\"}"
}
```

**CONNECT_REPLY tag values (CEPH_MSGR_TAG_*):**

| Tag | Name | Meaning |
|-----|------|---------|
| 1   | READY | Handshake accepted; connection established |
| 2   | RESETSESSION | Server requests session reset |
| 3   | WAIT | Server busy, client should wait and retry |
| 4   | RETRY_SESSION | Retry with different session sequence |
| 5   | RETRY_GLOBAL | Retry with different global sequence |
| 6   | CLOSE | Connection rejected |
| 10  | BADPROTOVER | Protocol version mismatch |
| 11  | BADAUTHORIZER | Auth required / auth failed |
| 12  | FEATURES | Feature mismatch |
| 16  | CHALLENGE_AUTHORIZER | Server sends an auth challenge |

**Notes:**
- The CONNECT message advertises a broad feature set (`0x3ffffffffffffff`) and entity type CLIENT (0x08).
- Without valid CephX authorization, most monitors will respond with BADAUTHORIZER (tag 11) or CHALLENGE_AUTHORIZER (tag 16). This is expected and confirms the monitor is operational.
- `handshakeComplete` is true only when tag is READY (1).
- `authRequired` is true when tag is BADAUTHORIZER (11) or CHALLENGE_AUTHORIZER (16).

---

### `POST /api/ceph/rest-health` — MGR REST API health query

Queries the Ceph Manager REST API (requires `ceph mgr module enable restful`). Tries multiple endpoint paths.

**POST body:**

| Field          | Type    | Default | Notes |
|----------------|---------|---------|-------|
| `host`         | string  | —       | Required |
| `port`         | number  | `8003`  | MGR restful default |
| `apiKey`       | string  | —       | REST API key |
| `apiSecret`    | string  | —       | REST API secret |
| `username`     | string  | —       | Alternative basic auth |
| `password`     | string  | —       | Alternative basic auth |
| `useDashboard` | boolean | `false` | Target Ceph Dashboard instead of restful module |
| `timeout`      | number  | `10000` | |

**Endpoints tried (restful module):**
1. `{scheme}://{host}:{port}/api/health/full`
2. `{scheme}://{host}:{port}/api/summary`
3. `{scheme}://{host}:{port}/request?wait=1`

**Endpoints tried (dashboard mode):**
1. `{scheme}://{host}:{port}/api/health/full`
2. `{scheme}://{host}:{port}/api/summary`

HTTPS is used when port is 8003; HTTP otherwise.

---

### `POST /api/ceph/osd-list` — OSD status via MGR REST API

**POST body:** Same auth fields as `rest-health`.

**Endpoints tried:**
1. `{scheme}://{host}:{port}/api/osd`
2. `{scheme}://{host}:{port}/api/osd/tree`

---

### `POST /api/ceph/pool-list` — Pool info via MGR REST API

**POST body:** Same auth fields as `rest-health`.

**Endpoints tried:**
1. `{scheme}://{host}:{port}/api/pool`
2. `{scheme}://{host}:{port}/api/pool?stats=true`

---

## Ceph MSGR Wire Protocol Reference

### MSGR v1 (Legacy)

The Messenger v1 protocol has been the default since early Ceph releases. It uses a text banner followed by binary structures.

#### Banner Exchange

```
Server → Client: "ceph v027\n"      (9 bytes ASCII, version 027)
Server → Client: entity_addr_t       (136 bytes)
Client → Server: "ceph v027\n"      (9 bytes ASCII)
Client → Server: entity_addr_t       (136 bytes)
```

The banner string is always `ceph v027\n`. The "027" is the protocol revision number, which has not changed in any shipping Ceph release.

#### entity_addr_t (136 bytes)

```
Offset  Size  Field              Encoding
0       4     type               uint32 LE (CEPH_ENTITY_TYPE_*)
4       4     nonce              uint32 LE
8       128   sockaddr_storage   raw (Linux native byte order)
```

**Entity types (CEPH_ENTITY_TYPE_*):**

| Value | Name   | Description |
|-------|--------|-------------|
| 0x01  | MON    | Monitor daemon |
| 0x02  | MDS    | Metadata Server |
| 0x04  | OSD    | Object Storage Daemon |
| 0x08  | CLIENT | Client |
| 0x10  | MGR    | Manager daemon |
| 0x20  | AUTH   | Authentication server |
| 0xFF  | ANY    | Wildcard |

**sockaddr_storage (128 bytes):**

Encoded in Linux-native byte order. `sa_family` is little-endian. Port (`sin_port` / `sin6_port`) is network byte order (big-endian), as per the POSIX sockaddr convention.

For AF_INET (family = 2):
```
Offset  Size  Field       Encoding
0       2     sa_family   uint16 LE (= 2)
2       2     sin_port    uint16 BE (network order)
4       4     sin_addr    4 bytes (a.b.c.d)
8       120   padding     zeros
```

For AF_INET6 (family = 10):
```
Offset  Size  Field         Encoding
0       2     sa_family     uint16 LE (= 10)
2       2     sin6_port     uint16 BE (network order)
4       4     sin6_flowinfo uint32
8       16    sin6_addr     16 bytes (8 x uint16 BE groups)
24      4     sin6_scope_id uint32
28      100   padding       zeros
```

#### ceph_msg_connect (33 bytes)

Sent by client after the banner/address exchange:

```
Offset  Size  Field              Encoding
0       8     features           uint64 LE
8       4     host_type          uint32 LE (CEPH_ENTITY_TYPE_*)
12      4     global_seq         uint32 LE
16      4     connect_seq        uint32 LE
20      4     protocol_version   uint32 LE
24      4     authorizer_protocol uint32 LE
28      4     authorizer_len     uint32 LE
32      1     flags              uint8
```

#### ceph_msg_connect_reply (26 bytes)

Server response to CONNECT:

```
Offset  Size  Field              Encoding
0       1     tag                uint8 (CEPH_MSGR_TAG_*)
1       8     features           uint64 LE
9       4     global_seq         uint32 LE
13      4     connect_seq        uint32 LE
17      4     protocol_version   uint32 LE
21      4     authorizer_len     uint32 LE
25      1     flags              uint8
```

**Tag is the first byte.** This is critical — the tag determines the server's response disposition before any other fields are meaningful.

**CEPH_MSGR_TAG_* values (from `include/msgr.h`):**

| Value | Name                  | Description |
|-------|-----------------------|-------------|
| 1     | READY                 | Connection accepted |
| 2     | RESETSESSION          | Reset session and retry |
| 3     | WAIT                  | Server busy, wait |
| 4     | RETRY_SESSION         | Retry with updated connect_seq |
| 5     | RETRY_GLOBAL          | Retry with updated global_seq |
| 6     | CLOSE                 | Connection rejected |
| 7     | MSG                   | Normal message follows |
| 8     | ACK                   | Acknowledgment |
| 9     | KEEPALIVE             | Keepalive ping |
| 10    | BADPROTOVER           | Protocol version mismatch |
| 11    | BADAUTHORIZER         | Authorization failed |
| 12    | FEATURES              | Feature set mismatch |
| 13    | SEQ                   | Sequence reset |
| 14    | KEEPALIVE2            | Modern keepalive |
| 15    | KEEPALIVE2_ACK        | Keepalive acknowledgment |
| 16    | CHALLENGE_AUTHORIZER  | Auth challenge (CephX) |

---

### MSGR v2 (Modern, Nautilus 14.2+)

Introduced in Ceph Nautilus (14.2.0). Uses port 3300 by default when configured as a dedicated v2 listener. Port 6789 can serve both v1 and v2 when `ms_bind_msgr2` is enabled alongside `ms_bind_msgr1`.

#### Banner Exchange

```
Server → Client: "ceph v2\n"        (8 bytes ASCII)
Server → Client: payload_len         (uint16 LE) x 2 = 4 bytes
Server → Client: banner_payload      (payload_len bytes)

Client → Server: "ceph v2\n"        (8 bytes ASCII)
Client → Server: payload_len         (uint16 LE) x 2 = 4 bytes
Client → Server: banner_payload      (payload_len bytes)
```

The two `payload_len` values must be identical (redundancy check).

#### Banner Payload (16 bytes)

```
Offset  Size  Field                Encoding
0       8     supported_features   uint64 LE
8       8     required_features    uint64 LE
```

**Known v2 feature flags:**

| Bit | Name | Description |
|-----|------|-------------|
| 0   | REVISION_1 | Protocol revision 1 |
| 1   | COMPRESSION | On-wire compression support |

After the banner exchange, MSGR v2 uses a frame-based protocol with optional TLS negotiation. The full v2 handshake is not implemented in Port of Call because it requires CephX authentication or TLS, which are not practical for unauthenticated probing.

---

## Default Ports

| Port | Usage |
|------|-------|
| 6789 | Monitor (v1 default, or combined v1+v2) |
| 3300 | Monitor (v2/msgr2-only, Nautilus+) |
| 6800-7568 | OSD daemons (range: `ms_bind_port_min` to `ms_bind_port_max`) |
| 6800-7568 | MDS daemons (same default range as OSDs) |
| 8003 | MGR restful module (HTTPS) |
| 8443 | Ceph Dashboard (HTTPS) |
| 9283 | MGR Prometheus module |

---

## Known Limitations

**No CephX authentication:** the CONNECT message is sent without authorization data. All production Ceph clusters require CephX auth, so the CONNECT_REPLY will be BADAUTHORIZER (tag 11) or CHALLENGE_AUTHORIZER (tag 16). This is expected and sufficient to confirm a live, responsive monitor.

**MSGR v2 handshake incomplete:** after the v2 banner+payload exchange, the protocol requires frame-based negotiation including optional TLS. Port of Call extracts the feature flags from the banner payload but does not continue the v2 handshake.

**No TLS:** connections are plain TCP. Ceph's `ms_cluster_mode` and `ms_service_mode` settings may require encrypted connections. If the monitor is configured with `ms_mon_cluster_mode = secure` and no `crc` or `secure` fallback, the connection will be rejected at the frame level (after v2 banner exchange).

**Single-byte sockaddr_storage endianness assumption:** the implementation assumes Linux little-endian byte order for `sa_family` in sockaddr_storage. Ceph only runs on Linux, so this is correct in practice.

**MGR REST API requires credentials:** the `rest-health`, `osd-list`, and `pool-list` endpoints require either `apiKey`/`apiSecret` or `username`/`password`. Without credentials, the MGR returns 401 Unauthorized.

**IPv6 address display:** IPv6 addresses from entity_addr_t are displayed in expanded form (no `::` abbreviation). For example, `0:0:0:0:0:ffff:a00:105` instead of `::ffff:10.0.1.5`.

---

## Practical Examples

### curl

```bash
# Quick probe — is this a Ceph monitor?
curl -s https://portofcall.ross.gg/api/ceph/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":6789}' | jq .

# Full detection with entity address parsing
curl -s https://portofcall.ross.gg/api/ceph/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":6789,"timeout":10000}' | jq .

# Check msgr2 on port 3300
curl -s https://portofcall.ross.gg/api/ceph/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":3300}' | jq .

# Full MSGR v1 handshake with CONNECT/CONNECT_REPLY
curl -s https://portofcall.ross.gg/api/ceph/cluster-info \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":6789}' | jq .

# MGR REST API health (requires credentials)
curl -s https://portofcall.ross.gg/api/ceph/rest-health \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mgr1.example.com","port":8003,"apiKey":"mykey","apiSecret":"mysecret"}' | jq .

# OSD list via MGR REST API
curl -s https://portofcall.ross.gg/api/ceph/osd-list \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mgr1.example.com","port":8003,"apiKey":"mykey","apiSecret":"mysecret"}' | jq .

# Pool list via MGR REST API
curl -s https://portofcall.ross.gg/api/ceph/pool-list \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mgr1.example.com","port":8003,"apiKey":"mykey","apiSecret":"mysecret"}' | jq .
```

### Interpreting CONNECT_REPLY

A typical response from a production monitor without auth:

```json
{
  "connectReply": {
    "tag": 11,
    "tagName": "BADAUTHORIZER",
    "features": "0x3ffddff8ffacffff",
    "globalSeq": 0,
    "connectSeq": 0,
    "protocolVersion": 15,
    "authLen": 0,
    "flags": 0
  },
  "handshakeComplete": false,
  "authRequired": true
}
```

- **tag 11 (BADAUTHORIZER):** confirms the monitor is live and requires CephX auth. This is the expected response for an unauthenticated probe.
- **features:** the server's advertised feature bitfield. High values like `0x3ffddff8ffacffff` indicate a modern Ceph release (Luminous+).
- **protocolVersion:** the monitor protocol version. Version 15 corresponds to Luminous (12.2+).
- **authLen = 0:** no auth payload included in the reply (since auth was rejected).

### Determining Ceph release from features

The feature bitfield grows with each major release. Rough mapping:

| Features (approximate)      | Release |
|-----------------------------|---------|
| `0x107d0fb8ee4cffff`        | Jewel (10.2) |
| `0x3ffddff8ffacffff`        | Luminous (12.2) through Quincy (17.2) |
| `0x7fffffffeffffffn`        | Reef (18.2+) |

Exact feature detection requires checking individual bit positions against the `CEPH_FEATURE_*` defines in the Ceph source.

---

## Multi-port Scanning

Modern Ceph clusters often listen on both 6789 (v1) and 3300 (v2). To probe both:

```bash
# v1 on legacy port
curl -s https://portofcall.ross.gg/api/ceph/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":6789}' | jq '{port:.port, version:.msgrVersion, isCeph:.isCeph}'

# v2 on dedicated msgr2 port
curl -s https://portofcall.ross.gg/api/ceph/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"ceph-mon1.example.com","port":3300}' | jq '{port:.port, version:.msgrVersion, isCeph:.isCeph}'
```

---

## Ceph Monitor Discovery

Ceph monitors in production are typically discovered via:

1. **DNS SRV records:** `_ceph-mon._tcp.{domain}` (RFC 2782)
2. **ceph.conf:** `mon_host = 10.0.1.5:6789, 10.0.1.6:6789, 10.0.1.7:6789`
3. **Ceph keyring + monmap:** embedded in the bootstrap keyring

Port of Call requires you to specify the monitor address directly. Use `dig SRV _ceph-mon._tcp.yourdomain.com` to find monitor addresses if your cluster uses DNS discovery.

---

## Resources

- [Ceph Messenger v2 protocol spec](https://docs.ceph.com/en/latest/dev/msgr2/)
- [Ceph source: include/msgr.h](https://github.com/ceph/ceph/blob/main/src/include/msgr.h) — CEPH_MSGR_TAG_* defines
- [Ceph source: msg/msg_types.h](https://github.com/ceph/ceph/blob/main/src/msg/msg_types.h) — entity_addr_t, entity types
- [Ceph source: msg/async/ProtocolV1.cc](https://github.com/ceph/ceph/blob/main/src/msg/async/ProtocolV1.cc) — v1 handshake implementation
- [Ceph source: msg/async/ProtocolV2.cc](https://github.com/ceph/ceph/blob/main/src/msg/async/ProtocolV2.cc) — v2 handshake implementation
- [Ceph MGR restful module](https://docs.ceph.com/en/latest/mgr/restful/)
- [Ceph Dashboard](https://docs.ceph.com/en/latest/mgr/dashboard/)
- [Ceph network config reference](https://docs.ceph.com/en/latest/rados/configuration/network-config-ref/)
