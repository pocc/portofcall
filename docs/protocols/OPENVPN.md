# OpenVPN (1194) — Power-User Reference

> TCP-mode only. Two endpoints: `/api/openvpn/handshake` (control channel reset) and `/api/openvpn/tls` (full TLS negotiation inside the OpenVPN tunnel). Implementation: `src/worker/openvpn.ts` (617 lines).

## Endpoints

### POST `/api/openvpn/handshake`

Sends `P_CONTROL_HARD_RESET_CLIENT_V2`, reads the server's `HARD_RESET_SERVER` response. Confirms the target is an OpenVPN server and reports protocol version (V1 vs V2).

**Request:**
```json
{ "host": "vpn.example.com", "port": 1194, "timeout": 10000 }
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | *(required)* | Validated via host regex in Cloudflare check only, not separately |
| `port` | number | `1194` | No range validation — any value accepted |
| `timeout` | number | `10000` | Outer `Promise.race` deadline (ms). Inner read loop has **no independent timeout** — relies entirely on outer race |

**Success response (HTTP 200):**
```json
{
  "success": true,
  "host": "vpn.example.com",
  "port": 1194,
  "rtt": 47,
  "isOpenVPN": true,
  "opcode": "P_CONTROL_HARD_RESET_SERVER_V2",
  "keyId": 0,
  "serverSessionId": "a1b2c3d4e5f60708",
  "clientSessionId": "1122334455667788",
  "ackCount": 0,
  "remoteSessionId": "1122334455667788",
  "packetId": 0,
  "protocolVersion": 2
}
```

**Failure response (HTTP 502):**

Returns `success: false` with `isOpenVPN: false` if the response can't be parsed as OpenVPN. `rawHex` is included (first 64 bytes) when parsing fails — useful for diagnosing non-OpenVPN services on 1194.

**HTTP status mapping:**
| Condition | Status |
|-----------|--------|
| Parsed as OpenVPN + HARD_RESET_SERVER | 200 |
| Parsed as OpenVPN but wrong opcode | 502 |
| Incomplete/unparseable response | 502 |
| Cloudflare detected | 403 |
| Connection timeout | 504 |
| Other error (connect refused, DNS, etc.) | 500 |

---

### POST `/api/openvpn/tls`

Full three-step OpenVPN control channel handshake with embedded TLS:

1. `P_CONTROL_HARD_RESET_CLIENT_V2` → wait for `HARD_RESET_SERVER`
2. `P_CONTROL_V1` wrapping a TLS 1.2 ClientHello (ACKs server's reset packet)
3. Read `P_CONTROL_V1` packets, extract TLS data, parse ServerHello + Certificate

Reports the negotiated TLS version, cipher suite, and certificate presence.

**Request:**
```json
{ "host": "vpn.example.com", "port": 1194, "timeout": 15000 }
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | *(required)* | Same as `/handshake` |
| `port` | number | `1194` | Same as `/handshake` |
| `timeout` | number | `15000` | Note: **different default** from `/handshake` (15s vs 10s) |

**Success response (HTTP 200):**
```json
{
  "success": true,
  "host": "vpn.example.com",
  "port": 1194,
  "rtt": 312,
  "isOpenVPN": true,
  "protocolVersion": 2,
  "serverSessionId": "a1b2c3d4e5f60708",
  "clientSessionId": "1122334455667788",
  "tlsHandshakeStarted": true,
  "tlsBytesReceived": 1847,
  "tlsVersion": "TLS 1.2",
  "negotiatedCipher": "ECDHE-RSA-AES128-GCM-SHA256",
  "serverCertificatePresent": true
}
```

**HTTP status:** Always 200 on success, 500 on any error (no 502/504 distinction like `/handshake`).

---

## Wire Protocol Details

### TCP Framing

All OpenVPN packets over TCP use a 2-byte big-endian length prefix:
```
[len_hi][len_lo][...openvpn payload...]
```

### Opcode Byte

Byte 0 of every OpenVPN payload:
```
| 7 6 5 4 3 | 2 1 0 |
|  opcode    | keyId |
```

| Opcode | Value | Name | Direction |
|--------|-------|------|-----------|
| 0x01 | `0x08` | P_CONTROL_HARD_RESET_CLIENT_V1 | C→S |
| 0x02 | `0x10` | P_CONTROL_HARD_RESET_SERVER_V1 | S→C |
| 0x03 | `0x18` | P_CONTROL_SOFT_RESET_V1 | Either |
| 0x04 | `0x20` | P_CONTROL_V1 | Either |
| 0x05 | `0x28` | P_ACK_V1 | Either |
| 0x06 | `0x30` | P_DATA_V1 | Either |
| 0x07 | `0x38` | P_CONTROL_HARD_RESET_CLIENT_V2 | C→S |
| 0x08 | `0x40` | P_CONTROL_HARD_RESET_SERVER_V2 | S→C |
| 0x09 | `0x48` | P_DATA_V2 | Either |
| 0x0A | `0x50` | P_CONTROL_HARD_RESET_CLIENT_V3 | C→S |
| 0x0B | `0x58` | P_CONTROL_WKC_V1 | C→S |

The "Value" column shows the full first byte with keyId=0. The implementation always uses keyId=0.

### HARD_RESET Packet Layout (as sent by `/handshake`)

```
Offset  Size  Field
0       1     Opcode|KeyID (0x38 = HARD_RESET_CLIENT_V2, key 0)
1       8     Session ID (random, crypto.getRandomValues)
9       1     ACK array length (0 — first packet, nothing to ACK)
10      4     Packet ID (0, big-endian)
```
Total: 14 bytes payload + 2 bytes TCP length prefix = 16 bytes on the wire.

### P_CONTROL_V1 Packet Layout (as sent by `/tls`)

```
Offset  Size  Field
0       1     Opcode|KeyID (0x20 = P_CONTROL_V1, key 0)
1       8     Our Session ID
9       1     ACK count (1 — ACKing server's HARD_RESET)
10      4     ACK'd Packet ID (server's packetId from HARD_RESET_SERVER)
14      8     Remote Session ID (server's session ID)
22      4     Our Packet ID (1, since HARD_RESET was 0)
26      N     TLS data (ClientHello record)
```

### TLS ClientHello

The `/tls` endpoint builds a minimal TLS 1.2 ClientHello with 5 cipher suites + SCSV:

| Suite Code | Name |
|-----------|------|
| `0xC02F` | TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256 |
| `0xC030` | TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384 |
| `0xC014` | TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA |
| `0x0035` | TLS_RSA_WITH_AES_256_CBC_SHA |
| `0x002F` | TLS_RSA_WITH_AES_128_CBC_SHA |
| `0x00FF` | TLS_EMPTY_RENEGOTIATION_INFO_SCSV |

No TLS extensions are sent (no SNI, no supported_groups, no signature_algorithms). This means:
- TLS 1.3 servers **will not negotiate TLS 1.3** (requires supported_versions extension)
- ECDHE suites may fail if the server requires explicit curve negotiation
- Some strict servers may reject the ClientHello entirely

The `random` field (32 bytes) is cryptographically random via `crypto.getRandomValues`. Session ID length is 0 (no resumption). Only null compression is offered.

### TLS ServerHello Parsing

The response parser recognizes 11 cipher suites by code:

| Code | Name |
|------|------|
| `0xC02B` | ECDHE-ECDSA-AES128-GCM-SHA256 |
| `0xC02C` | ECDHE-ECDSA-AES256-GCM-SHA384 |
| `0xC02F` | ECDHE-RSA-AES128-GCM-SHA256 |
| `0xC030` | ECDHE-RSA-AES256-GCM-SHA384 |
| `0xC014` | ECDHE-RSA-AES256-CBC-SHA |
| `0x0035` | RSA-AES256-CBC-SHA |
| `0x002F` | RSA-AES128-CBC-SHA |
| `0xCCA8` | ECDHE-RSA-CHACHA20-POLY1305 |
| `0x1301` | TLS_AES_128_GCM_SHA256 |
| `0x1302` | TLS_AES_256_GCM_SHA384 |
| `0x1303` | TLS_CHACHA20_POLY1305_SHA256 |

Unknown suites are returned as `"0x{code}"` (4 hex digits, zero-padded).

TLS version detection:
| Bytes | Version |
|-------|---------|
| `0x0303` | TLS 1.2 |
| `0x0304` | TLS 1.3 |
| `0x0302` | TLS 1.1 |
| `*,0x01` | TLS 1.0 |
| other | raw hex of record version |

Certificate detection: `hasCertificate: true` if a TLS Certificate handshake message (type `0x0B`) appears in any Handshake record. No certificate parsing is done — just presence detection.

---

## Quirks and Limitations

### 1. No method restriction on either endpoint

Both endpoints accept any HTTP method (GET, PUT, DELETE, etc.), not just POST. The body is parsed as JSON regardless.

### 2. `/handshake` readTimeout is a no-op

Line 195: `const readTimeout = setTimeout(() => {}, timeout)` — creates a timer that does nothing when it fires. The actual timeout protection comes from the outer `Promise.race` with `timeoutPromise`. The `clearTimeout(readTimeout)` on line 215 clears a timer that would have done nothing anyway.

### 3. `/tls` has hardcoded inner deadlines

The `/tls` handler uses `Date.now() + 8000` as the deadline for both the HARD_RESET read (line 534) and the TLS response collection (line 557). These are **independent of the `timeout` parameter** — even with `timeout: 60000`, the inner steps will individually time out after 8 seconds each.

### 4. Timeout default asymmetry

| Endpoint | Default timeout |
|----------|----------------|
| `/handshake` | 10,000 ms |
| `/tls` | 15,000 ms |

### 5. Port validation is absent

No range check on `port`. Values like 0, negative numbers, or >65535 are passed directly to `connect()`. Cloudflare's `connect()` may reject or silently fail.

### 6. `readPacket` in `/tls` reads one TCP-framed packet only

The `readPacket` helper accumulates bytes until the 2-byte length prefix is satisfied, then returns the whole buffer (including any trailing bytes from the next packet). Those trailing bytes are **discarded** — if two OpenVPN packets arrive in one TCP segment, the second is lost. In practice this rarely matters because control channel packets are typically sent individually, but a busy server could coalesce them.

### 7. 1024-byte TLS data cutoff

The `/tls` handler stops collecting TLS data once `tlsDataBuf.length > 1024` (line 574). Most ServerHello + Certificate chains exceed 1024 bytes. Result: `serverCertificatePresent` may be `false` even when the server sends a certificate, if the Certificate record starts after byte 1024. The field is **unreliable** for certificate detection.

### 8. P_ACK_V1 packets from server are silently dropped

During the TLS data collection loop, `extractTLSData` only processes `P_CONTROL_V1` (opcode 0x04). If the server sends a standalone `P_ACK_V1` (opcode 0x05) before its first data packet, the loop reads it, gets `null` from `extractTLSData`, and continues. No issue, but the ACK is not tracked for reliability purposes.

### 9. No HMAC — tls-auth and tls-crypt not supported

The implementation sends packets with no HMAC. Servers configured with `tls-auth` or `tls-crypt` will silently drop the HARD_RESET (no error response, just timeout). This is the most common reason for `/handshake` to time out on a known-good OpenVPN server.

### 10. session ID is not a `Uint8Array` in the response

`clientSessionId` and `serverSessionId` are hex strings (16 characters), not byte arrays. This is consistent between both endpoints.

### 11. Single TCP read in `/handshake`

The `/handshake` endpoint reads until it has 16+ bytes or the TCP length prefix is satisfied, with a 4096-byte cap. If the server fragments its HARD_RESET_SERVER across multiple TCP segments (each <16 bytes), the read loop handles it. But the 4096-byte cap means absurdly large server responses (which shouldn't happen for a HARD_RESET) are truncated.

### 12. `rtt` measures different things

| Endpoint | `rtt` measures |
|----------|---------------|
| `/handshake` | Time from `connect()` to socket close (1 round-trip: HARD_RESET → response) |
| `/tls` | Time from `connect()` to end of TLS data collection (3+ round-trips: HARD_RESET → response → ClientHello → ServerHello+Cert) |

The `/tls` rtt is **not** a round-trip time — it's total wall-clock time for the full multi-step exchange.

### 13. Error response shapes differ between endpoints

`/handshake` returns `isOpenVPN: false` on parse failure; `/tls` throws and returns a generic `{ success: false, error: "..." }` with no `isOpenVPN` field.

### 14. Cloudflare detection is proactive

Both endpoints call `checkIfCloudflare(host)` before opening a socket. This adds DNS resolution latency to every request, even when the host is not behind Cloudflare.

---

## curl Examples

**Basic handshake (is it OpenVPN?):**
```bash
curl -s http://localhost:8787/api/openvpn/handshake \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com"}' | jq .
```

**TLS probe (what cipher suite and TLS version?):**
```bash
curl -s http://localhost:8787/api/openvpn/tls \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","port":443,"timeout":20000}' | jq .
```

**Non-standard port:**
```bash
curl -s http://localhost:8787/api/openvpn/handshake \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","port":443}' | jq .
```

---

## Local Testing

```bash
# Run OpenVPN in TCP mode (Docker):
docker run -d --name openvpn-tcp \
  --cap-add=NET_ADMIN \
  -p 1194:1194/tcp \
  kylemanna/openvpn

# Initialize PKI (first time):
docker run --rm -v ovpn-data:/etc/openvpn kylemanna/openvpn ovpn_genconfig -u tcp://localhost
docker run --rm -v ovpn-data:/etc/openvpn -it kylemanna/openvpn ovpn_initpki

# Note: default kylemanna/openvpn uses tls-auth, which will cause
# the handshake to timeout. To test without tls-auth, you need a
# custom server.conf with tls-auth commented out.

# Alternative: use a plain OpenVPN server.conf with no tls-auth:
# port 1194
# proto tcp
# dev tun
# ca ca.crt
# cert server.crt
# key server.key
# dh dh2048.pem
# server 10.8.0.0 255.255.255.0
```

---

## Cross-Endpoint Comparison

| | `/handshake` | `/tls` |
|---|---|---|
| Default timeout | 10,000 ms | 15,000 ms |
| Inner deadline | None (outer race only) | 8,000 ms per step (hardcoded) |
| Round-trips | 1 | 3+ |
| TLS data | No | Yes (version, cipher, cert) |
| HTTP status on success | 200 | 200 |
| HTTP status on protocol error | 502 | 500 |
| HTTP status on timeout | 504 | 500 |
| `isOpenVPN` in response | Always present | Not present on error |
| `rawHex` on parse failure | Yes (64 bytes) | No |
| `rtt` meaning | ~1 RTT | Total wall-clock |
| `protocolVersion` | From opcode (1 or 2) | From opcode (1 or 2) |
| Socket cleanup | `socket.close()` | `releaseLock()` → `socket.close()` |
| Cloudflare detection | Yes | Yes |
| Method restriction | None | None |
| Port validation | None | None |
