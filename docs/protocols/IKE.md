# IKE / ISAKMP (Port 500/4500) — Power User Reference

Internet Key Exchange. RFC 2409 (IKEv1), RFC 7296 (IKEv2), RFC 2408 (ISAKMP framework). UDP port 500 (standard), UDP port 4500 (NAT-T). Used to negotiate IPsec Security Associations for VPN tunnels.

Implementation: `src/worker/ike.ts` (~1120 lines)
Routes: `src/worker/index.ts`

## Endpoints

| Endpoint | Method | Purpose | Default timeout | Auth required |
|---|---|---|---|---|
| `/api/ike/probe` | POST | IKEv1 Main Mode SA probe | 15 000 ms | No |
| `/api/ike/version` | POST | Dual IKEv1 + IKEv2 version detection | 10 000 ms | No |
| `/api/ike/v2-sa` | POST | IKEv2 IKE_SA_INIT probe | 15 000 ms | No |

## Transport — TCP, not UDP

IKE natively runs over UDP/500. This implementation uses TCP because Cloudflare Workers only support TCP sockets via `connect()` from `cloudflare:sockets`. Some IKE implementations accept TCP connections on port 500 or 4500 (Cisco ASA, strongSwan with `listen-tcp`), and RFC 8229 defines a formal IKE-over-TCP framing protocol. This implementation sends raw IKE packets over TCP without RFC 8229 framing (no 4-byte length prefix, no `IKETCP` stream prefix). This works with servers that accept unframed IKE over TCP but will fail against strict RFC 8229 implementations.

## `/api/ike/probe`

Sends an IKEv1 Phase 1 Main Mode (Identity Protection) SA proposal and parses the response.

### Request

```json
{
  "host": "vpn.example.com",
  "port": 500,
  "timeout": 15000,
  "exchangeType": 2
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `host` | string | Yes | — | Truthiness check only (`if (!host)`) |
| `port` | number | No | 500 | Validated 1-65535 |
| `timeout` | number | No | 15000 | Milliseconds |
| `exchangeType` | number | No | 2 | 2=Main Mode, 4=Aggressive Mode |

### Response (success)

```json
{
  "success": true,
  "host": "vpn.example.com",
  "port": 500,
  "version": "1.0",
  "exchangeType": "Main Mode",
  "initiatorCookie": "a1b2c3d4e5f60708",
  "responderCookie": "1122334455667788",
  "vendorIds": ["4048b7d56ebce885..."],
  "proposals": 1,
  "transforms": 3,
  "rtt": 42
}
```

| Field | Type | Notes |
|---|---|---|
| `version` | string | `"major.minor"` from version byte; typically `"1.0"` |
| `exchangeType` | string | Human-readable: `"Main Mode"`, `"Aggressive Mode"`, `"Quick Mode"`, or `"Unknown (N)"` |
| `initiatorCookie` | string | 8-byte hex — should match what we sent |
| `responderCookie` | string | 8-byte hex — server's cookie |
| `vendorIds` | string[] | Hex-encoded Vendor ID payload data (see vendor ID table below) |
| `proposals` | number | Count of Proposal payloads in response (omitted if 0) |
| `transforms` | number | Count of Transform payloads in response (omitted if 0) |
| `rtt` | number | Milliseconds from connection start to response parsed |

### IKEv1 SA proposal sent

The probe sends a single proposal with one transform:

| Attribute | Value | IANA ID |
|---|---|---|
| Encryption | AES-CBC | 7 |
| Hash | SHA-1 | 2 |
| Authentication | Pre-Shared Key | 1 |
| DH Group | Group 2 (1024-bit MODP) | 2 |
| Life Type | Seconds | 1 |
| Life Duration | 28800 (8 hours) | 0x7080 |

This is a conservative proposal that most IKEv1 implementations will accept. The DH Group 2 (1024-bit) is considered weak by modern standards but remains widely supported for detection purposes.

## `/api/ike/version`

Probes both IKEv1 and IKEv2 concurrently against the same host and reports which versions are supported.

### Request

```json
{
  "host": "vpn.example.com",
  "port": 500,
  "timeout": 10000
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `host` | string | Yes | — | |
| `port` | number | No | 500 | |
| `timeout` | number | No | 10000 | Applied to each probe independently |

### Response

```json
{
  "success": true,
  "host": "vpn.example.com",
  "port": 500,
  "ikev1": true,
  "ikev2": true,
  "version": "2.0",
  "vendorIds": ["4048b7d56ebce885..."],
  "v2SelectedEncr": "ENCR_AES_CBC",
  "v2SelectedInteg": "AUTH_HMAC_SHA2_256_128",
  "v2SelectedPRF": "PRF_HMAC_SHA2_256",
  "v2SelectedDHGroup": 14
}
```

The `version` field shows `"2.0"` if IKEv2 is detected, otherwise falls back to the IKEv1 version string. The `v2Selected*` fields are populated only when `ikev2` is `true`.

## `/api/ike/v2-sa`

Sends an IKEv2 IKE_SA_INIT request (exchange type 34) and parses the response.

### Request

```json
{
  "host": "vpn.example.com",
  "port": 500,
  "timeout": 15000
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `host` | string | Yes | — | |
| `port` | number | No | 500 | Validated 1-65535 |
| `timeout` | number | No | 15000 | Milliseconds |

### Response (success)

```json
{
  "success": true,
  "host": "vpn.example.com",
  "port": 500,
  "version": 2,
  "responderSpi": "aabbccdd11223344",
  "selectedDHGroup": 14,
  "selectedEncr": "ENCR_AES_CBC",
  "selectedInteg": "AUTH_HMAC_SHA2_256_128",
  "selectedPRF": "PRF_HMAC_SHA2_256",
  "rtt": 55
}
```

| Field | Type | Notes |
|---|---|---|
| `version` | number | Major version from response; 2 = IKEv2 |
| `responderSpi` | string | 8-byte hex — server's SPI for this SA |
| `selectedDHGroup` | number | DH group the server selected (14 = 2048-bit MODP) |
| `selectedEncr` | string | Encryption algorithm name (see algorithm tables below) |
| `selectedInteg` | string | Integrity algorithm name |
| `selectedPRF` | string | PRF algorithm name |
| `errorNotify` | string | If server rejected, the Notify error type name (e.g., `NO_PROPOSAL_CHOSEN`) |

### IKEv2 SA proposal sent

| Transform Type | Algorithm | IANA ID | Key Length |
|---|---|---|---|
| ENCR | AES-CBC | 12 | 256 bits |
| PRF | HMAC-SHA2-256 | 5 | — |
| INTEG | HMAC-SHA2-256-128 | 8 | — |
| DH | Group 14 (2048-bit MODP) | 14 | — |

The KE payload contains a zeroed 256-byte (2048-bit) DH public value. This is not a real key exchange — it's sufficient for server detection and algorithm negotiation but the SA will never complete. The 32-byte nonce is generated with `Math.random()` (not cryptographically secure, acceptable for probing).

### Wire exchange

```
Client                              Server
  |                                    |
  |--- IKE_SA_INIT (SA+KE+Nonce) --->|  Exchange Type 34, Flags: I=1
  |                                    |
  |<-- IKE_SA_INIT (SA+KE+Nonce+N) --|  Flags: R=1
  |                                    |
  [Connection closed — no IKE_AUTH]
```

If the server rejects the proposal, it responds with a Notify payload (type 14 = `NO_PROPOSAL_CHOSEN` or type 17 = `INVALID_KE_PAYLOAD`). The `errorNotify` field in the response captures this.

## ISAKMP / IKE header format (28 bytes)

Both IKEv1 and IKEv2 share the same 28-byte header structure.

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Initiator SPI (8 bytes)                   |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Responder SPI (8 bytes)                   |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Next Payload | MjVer | MnVer | Exchange Type |     Flags     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Message ID                            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                            Length                             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 8 | Initiator SPI | Random 8-byte value chosen by initiator. IKEv1 calls this "Initiator Cookie". |
| 8 | 8 | Responder SPI | Zero in initial request; filled by responder. IKEv1 calls this "Responder Cookie". |
| 16 | 1 | Next Payload | Type of first payload after header. 0 = none. |
| 17 | 1 | Version | Upper nibble = major, lower nibble = minor. `0x10` = IKEv1, `0x20` = IKEv2. |
| 18 | 1 | Exchange Type | See exchange type table. |
| 19 | 1 | Flags | See flags table. |
| 20 | 4 | Message ID | Big-endian uint32. 0 for IKE_SA_INIT / Phase 1 Main Mode initial exchange. |
| 24 | 4 | Length | Big-endian uint32. Total message length including header. |

### Version byte encoding

```
Bits 7-4: Major version
Bits 3-0: Minor version

0x10 = Version 1.0 (IKEv1 / ISAKMP)
0x20 = Version 2.0 (IKEv2)
```

### Exchange types

| Value | Name | Protocol | Notes |
|---|---|---|---|
| 0 | None | — | |
| 1 | Base | IKEv1 | Rarely used |
| 2 | Identity Protection | IKEv1 | Main Mode (6-message exchange) |
| 3 | Authentication Only | IKEv1 | |
| 4 | Aggressive | IKEv1 | 3-message exchange, faster but less secure |
| 5 | Informational | IKEv1 | Error and status notifications |
| 32 | Quick Mode | IKEv1 | Phase 2 — establishes IPsec (ESP/AH) SA |
| 33 | New Group Mode | IKEv1 | Negotiate new DH group |
| 34 | IKE_SA_INIT | IKEv2 | Phase 1 equivalent — establishes IKE SA |
| 35 | IKE_AUTH | IKEv2 | Authentication and first Child SA |
| 36 | CREATE_CHILD_SA | IKEv2 | Additional Child SAs or rekeying |
| 37 | INFORMATIONAL | IKEv2 | Delete, notify, configuration |

### Flags byte

**IKEv1 (RFC 2408):**

| Bit | Mask | Name | Meaning |
|---|---|---|---|
| 0 | 0x01 | Encryption | Payloads after header are encrypted |
| 1 | 0x02 | Commit | Sender requests Informational exchange before using SA |
| 2 | 0x04 | Authentication Only | Authentication but no encryption |

**IKEv2 (RFC 7296):**

| Bit | Mask | Name | Meaning |
|---|---|---|---|
| 3 | 0x08 | Initiator (I) | Set by the original initiator of the IKE SA |
| 5 | 0x20 | Response (R) | Set when message is a response |
| 6 | 0x40 | Version (V) | Sender can speak a higher major version |

This implementation sets flags `0x00` for IKEv1 (no encryption, no commit) and `0x08` for IKEv2 (initiator bit).

## Payload types

### IKEv1 / ISAKMP payload types (RFC 2408)

| Value | Name | Abbreviation |
|---|---|---|
| 0 | None | — |
| 1 | Security Association | SA |
| 2 | Proposal | P |
| 3 | Transform | T |
| 4 | Key Exchange | KE |
| 5 | Identification | ID |
| 6 | Certificate | CERT |
| 7 | Certificate Request | CR |
| 8 | Hash | HASH |
| 9 | Signature | SIG |
| 10 | Nonce | N |
| 11 | Notification | NOT |
| 12 | Delete | D |
| 13 | Vendor ID | VID |

### IKEv2 payload types (RFC 7296)

| Value | Name | Abbreviation |
|---|---|---|
| 33 | Security Association | SA |
| 34 | Key Exchange | KE |
| 35 | Identification - Initiator | IDi |
| 36 | Identification - Responder | IDr |
| 37 | Certificate | CERT |
| 38 | Certificate Request | CERTREQ |
| 39 | Authentication | AUTH |
| 40 | Nonce | Ni / Nr |
| 41 | Notify | N |
| 42 | Delete | D |
| 43 | Vendor ID | V |
| 44 | Traffic Selector - Initiator | TSi |
| 45 | Traffic Selector - Responder | TSr |
| 46 | Encrypted and Authenticated | SK |
| 47 | Configuration | CP |
| 48 | Extensible Authentication | EAP |

Note: IKEv1 and IKEv2 payload type numbers do not overlap (1-13 vs 33-48), which is how a parser can distinguish them in the `Next Payload` field.

## IKEv1 SA payload structure

```
SA Payload:
  Next Payload (1)
  Reserved (1)
  Payload Length (2)     ─┐
  DOI (4)                 │  IPsec DOI = 1 (RFC 2407)
  Situation (4)           │  SIT_IDENTITY_ONLY = 0x00000001
  [Proposal Payloads]    ─┘

Proposal Payload:
  Next Payload (1)       0 = last proposal, 2 = more proposals
  Reserved (1)
  Payload Length (2)
  Proposal Number (1)    Starts at 1
  Protocol ID (1)        1 = ISAKMP (Phase 1), 2 = AH, 3 = ESP
  SPI Size (1)           0 for ISAKMP Phase 1
  Num Transforms (1)
  [SPI] (variable)
  [Transform Payloads]

Transform Payload:
  Next Payload (1)       0 = last transform, 3 = more transforms
  Reserved (1)
  Payload Length (2)
  Transform Number (1)   Starts at 1
  Transform ID (1)       1 = KEY_IKE
  Reserved (2)
  [Data Attributes]
```

### Data attribute encoding (RFC 2408 Section 3.3)

IKE/ISAKMP attributes use two formats, distinguished by bit 15 of the attribute type:

**TV format** (Type-Value, bit 15 = 1):
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|1|    Attribute Type (15 bits) |        Attribute Value        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```
Total: 4 bytes. Used for values that fit in 2 bytes.

**TLV format** (Type-Length-Value, bit 15 = 0):
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|0|    Attribute Type (15 bits) |        Attribute Length       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Attribute Value (variable)             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```
Total: 4 + length bytes. Used for values that don't fit in 2 bytes.

Common IKEv1 Phase 1 attributes:

| Type | Name | Format | Common values |
|---|---|---|---|
| 1 | Encryption Algorithm | TV | 5=3DES, 7=AES-CBC |
| 2 | Hash Algorithm | TV | 1=MD5, 2=SHA-1, 4=SHA2-256 |
| 3 | Authentication Method | TV | 1=PSK, 3=RSA-Sig |
| 4 | Group Description | TV | 2=1024-bit, 5=1536-bit, 14=2048-bit |
| 11 | Life Type | TV | 1=Seconds, 2=Kilobytes |
| 12 | Life Duration | TV or TLV | TV if value fits in 2 bytes; TLV for larger values |
| 14 | Key Length | TV | 128, 192, 256 (for AES) |

## IKEv2 SA payload structure

```
SA Payload:
  Next Payload (1)
  Critical bit + Reserved (1)
  Payload Length (2)
  [Proposals]

Proposal:
  Last Substruc (1)      0 = last, 2 = more proposals
  Reserved (1)
  Proposal Length (2)
  Proposal Num (1)
  Protocol ID (1)        1 = IKE, 2 = AH, 3 = ESP
  SPI Size (1)           0 for IKE_SA_INIT
  Num Transforms (1)
  [SPI] (variable)
  [Transforms]

Transform:
  Last Substruc (1)      0 = last, 3 = more transforms
  Reserved (1)
  Transform Length (2)
  Transform Type (1)     1=ENCR, 2=PRF, 3=INTEG, 4=DH, 5=ESN
  Reserved (1)
  Transform ID (2)
  [Attributes]           TV format (e.g., Key Length)
```

### IKEv2 transform types

| Type | Name | Purpose |
|---|---|---|
| 1 | ENCR | Encryption algorithm |
| 2 | PRF | Pseudorandom function |
| 3 | INTEG | Integrity algorithm |
| 4 | DH | Diffie-Hellman group |
| 5 | ESN | Extended Sequence Numbers |

## IKEv2 algorithm reference

### Encryption (ENCR, Transform Type 1)

| ID | Name | Key sizes |
|---|---|---|
| 2 | 3DES | 192 |
| 3 | RC5 | variable |
| 5 | CAST | 128 |
| 6 | Blowfish | variable |
| 12 | AES-CBC | 128, 192, 256 |
| 13 | AES-CTR | 128, 192, 256 |
| 18 | AES-GCM-16 | 128, 192, 256 |
| 20 | Camellia-CBC | 128, 192, 256 |

### PRF (Transform Type 2)

| ID | Name |
|---|---|
| 1 | HMAC-MD5 |
| 2 | HMAC-SHA1 |
| 3 | HMAC-TIGER |
| 4 | AES128-XCBC |
| 5 | HMAC-SHA2-256 |
| 6 | HMAC-SHA2-384 |
| 7 | HMAC-SHA2-512 |

### Integrity (INTEG, Transform Type 3)

| ID | Name | Truncation |
|---|---|---|
| 1 | HMAC-MD5-96 | 96 bits |
| 2 | HMAC-SHA1-96 | 96 bits |
| 5 | AES-XCBC-96 | 96 bits |
| 8 | HMAC-SHA2-256-128 | 128 bits |
| 9 | HMAC-SHA2-384-192 | 192 bits |
| 10 | HMAC-SHA2-512-256 | 256 bits |
| 12 | AES-CMAC-96 | 96 bits |

### Diffie-Hellman groups

| ID | Name | Strength |
|---|---|---|
| 1 | Group 1 (MODP 768) | Broken |
| 2 | Group 2 (MODP 1024) | Weak |
| 5 | Group 5 (MODP 1536) | Marginal |
| 14 | Group 14 (MODP 2048) | Acceptable |
| 15 | Group 15 (MODP 3072) | Good |
| 16 | Group 16 (MODP 4096) | Strong |
| 19 | Group 19 (ECP 256) | Good (ECDH) |
| 20 | Group 20 (ECP 384) | Strong (ECDH) |
| 21 | Group 21 (ECP 521) | Strong (ECDH) |

## IKEv2 Notify message types

### Error notifications (< 16384)

| Value | Name |
|---|---|
| 1 | UNSUPPORTED_CRITICAL_PAYLOAD |
| 4 | INVALID_IKE_SPI |
| 5 | INVALID_MAJOR_VERSION |
| 7 | INVALID_SYNTAX |
| 9 | INVALID_MESSAGE_ID |
| 11 | INVALID_SPI |
| 14 | NO_PROPOSAL_CHOSEN |
| 17 | INVALID_KE_PAYLOAD |
| 24 | AUTHENTICATION_FAILED |
| 34 | SINGLE_PAIR_REQUIRED |
| 35 | NO_ADDITIONAL_SAS |
| 38 | TS_UNACCEPTABLE |
| 39 | INVALID_SELECTORS |

### Status notifications (>= 16384)

| Value | Name |
|---|---|
| 16384 | INITIAL_CONTACT |
| 16385 | SET_WINDOW_SIZE |
| 16388 | NAT_DETECTION_SOURCE_IP |
| 16389 | NAT_DETECTION_DESTINATION_IP |
| 16390 | COOKIE |
| 16391 | USE_TRANSPORT_MODE |
| 16393 | REKEY_SA |

## IKEv1 vs IKEv2 differences

| Aspect | IKEv1 (RFC 2409) | IKEv2 (RFC 7296) |
|---|---|---|
| Version byte | `0x10` | `0x20` |
| Phase 1 exchange | Main Mode (6 msgs) or Aggressive (3 msgs) | IKE_SA_INIT (2 msgs) + IKE_AUTH (2 msgs) |
| SA payload | DOI (4) + Situation (4) + proposals | Proposals directly (no DOI/Situation) |
| Payload type numbers | 1-13 | 33-48 |
| Initiator cookie / SPI | 8 bytes, called "cookie" | 8 bytes, called "SPI" |
| Flags | bit 0=Encryption, bit 1=Commit, bit 2=AuthOnly | bit 3=Initiator, bit 5=Response, bit 6=Version |
| IKE_SA_INIT exchange type | 2 (Identity Protection / Main Mode) | 34 |
| DH group in proposal | Attribute in Transform payload | Separate Transform sub-structure (type 4) |
| PRF | Not separate — implied by Hash attribute | Explicit Transform sub-structure (type 2) |
| NAT-T | Vendor ID payloads (pre-standard) | Built-in Notify types 16388/16389 |

## Well-known Vendor IDs

VPN implementations embed Vendor ID payloads in Phase 1 exchanges to identify themselves. The implementation extracts these as hex strings. Common ones:

| Hex prefix | Vendor |
|---|---|
| `4048b7d56ebce885` | RFC 3947 NAT-T |
| `90cb80913ebb696e` | draft-ietf-ipsec-nat-t-ike-02 |
| `afcad71368a1f1c9` | Cisco Unity |
| `1f07f70eaa6514d3` | Cisco VPN Concentrator |
| `09002689dfd6b712` | XAUTH (Extended Authentication) |
| `4a131c81070358455c5728f20e95452f` | RFC 3706 Dead Peer Detection |
| `7d9419a65310ca6f` | strongSwan |
| `4865617274426561745f4e6f74696679` | Heartbeat Notify (ASCII) |

## Quirks and limitations

1. **TCP transport only.** IKE is a UDP protocol. TCP probing will fail against the majority of IKE/IPsec deployments that only listen on UDP/500. Works best with Cisco ASA (`crypto ikev2 enable outside` with TCP transport), strongSwan (`listen-tcp = yes`), or other implementations that accept IKE over TCP.

2. **No RFC 8229 framing.** RFC 8229 ("TCP Encapsulation of IKE and IPsec Packets") defines a stream prefix and 4-byte length framing for IKE over TCP. This implementation sends raw IKE packets. Servers strictly following RFC 8229 will reject the connection. Servers that accept raw IKE over TCP (some Cisco configs) will work.

3. **IKEv2 KE payload is zeroed.** The 256-byte DH public value is all zeros. A real IKE implementation would reject this during cryptographic validation, but most servers respond to IKE_SA_INIT before validating the KE value. Some strict implementations may send `INVALID_KE_PAYLOAD`.

4. **Nonce and SPI use `Math.random()`.** Not cryptographically secure. Acceptable for probing (no real key exchange occurs) but would be a vulnerability in a production IKE implementation.

5. **Single SA proposal.** Both IKEv1 and IKEv2 probes send exactly one proposal with one set of algorithms. A real negotiation would include multiple proposals/transforms to find common ground. If the server doesn't support the proposed algorithms, it returns `NO_PROPOSAL_CHOSEN`.

6. **No retransmission.** IKE over UDP mandates retransmission (RFC 7296 Section 2.1). Over TCP this is less critical since TCP provides reliability, but the implementation does not handle cases where the server delays responding.

7. **IKEv1 probe reads only one TCP read.** The IKEv1 probe (`handleIKEProbe`) does a single `reader.read()` call. If the response is fragmented across multiple TCP segments, it may parse an incomplete message. The IKEv2 probe (`handleIKEv2SA`) correctly loops to collect all data.

8. **No IKEv2 IKE_AUTH.** The probe stops after IKE_SA_INIT. It cannot determine authentication methods (PSK vs certificate), tunnel mode vs transport mode, or traffic selectors. It only reveals supported algorithms and DH groups.

9. **No NAT-T detection.** The implementation does not send NAT_DETECTION_SOURCE_IP or NAT_DETECTION_DESTINATION_IP notify payloads. It cannot determine if the server supports or requires NAT Traversal (port 4500).

10. **Error responses are always HTTP 500.** Connection timeouts, malformed responses, and unexpected errors all return HTTP 500. No HTTP 502/504 distinction for different failure modes.

## Curl examples

### IKEv1 Main Mode probe

```bash
curl -s http://localhost:8787/api/ike/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com"}' | jq .
```

### IKEv1 Aggressive Mode probe

```bash
curl -s http://localhost:8787/api/ike/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","exchangeType":4}' | jq .
```

### IKEv2 IKE_SA_INIT probe

```bash
curl -s http://localhost:8787/api/ike/v2-sa \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com"}' | jq .
```

### Version detection (IKEv1 + IKEv2)

```bash
curl -s http://localhost:8787/api/ike/version \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com"}' | jq .
```

### Probe on NAT-T port

```bash
curl -s http://localhost:8787/api/ike/v2-sa \
  -H 'Content-Type: application/json' \
  -d '{"host":"vpn.example.com","port":4500}' | jq .
```

## Local testing

### strongSwan (IKEv2)

```bash
# Docker
docker run -d --name strongswan -p 500:500/udp -p 4500:4500/udp \
  strongx509/strongswan

# Enable TCP (add to /etc/strongswan.d/charon.conf):
#   listen-tcp = yes
#   port-tcp = 500

# Or use ipsec.conf:
# conn %default
#   keyexchange=ikev2
```

### Libreswan (IKEv1/IKEv2)

```bash
docker run -d --name libreswan -p 500:500/udp -p 4500:4500/udp \
  libreswan/libreswan
```

### ike-scan (command-line IKE scanner for comparison)

```bash
# IKEv1 Main Mode
ike-scan --multiline vpn.example.com

# IKEv2
ike-scan --ikev2 vpn.example.com

# Aggressive Mode with group name
ike-scan --aggressive --id=test vpn.example.com
```

## RFC references

| RFC | Title | Relevance |
|---|---|---|
| RFC 2408 | ISAKMP | Framework for IKEv1 header, payload, and attribute formats |
| RFC 2409 | IKEv1 | Phase 1/Phase 2, Main Mode, Aggressive Mode |
| RFC 2407 | IPsec DOI | DOI value (1) and Situation field in SA payload |
| RFC 7296 | IKEv2 | Complete IKEv2 protocol specification |
| RFC 8229 | TCP Encapsulation | IKE and IPsec over TCP (framing protocol) |
| RFC 3947 | NAT-T | NAT Traversal for IKEv1 (port 4500) |
| RFC 7383 | IKEv2 Fragmentation | Large message fragmentation over UDP |
