# RDP — Remote Desktop Protocol (Port 3389)

Power-user reference for `src/worker/rdp.ts` (842 lines).

Three endpoints, all POST. No authentication or graphical session — this is an X.224/CredSSP probe, not an RDP client.

---

## Endpoints

| # | Endpoint | Purpose | Default port | Default timeout | Cloudflare check | Port validation |
|---|----------|---------|-------------|----------------|------------------|-----------------|
| 1 | `POST /api/rdp/connect` | X.224 handshake + security detection | 3389 | 10 000 ms | Yes | Yes (1–65535) |
| 2 | `POST /api/rdp/negotiate` | X.224 handshake with configurable protocol bitmask | 3389 | 10 000 ms | Yes | Yes (1–65535) |
| 3 | `POST /api/rdp/nla-probe` | TLS upgrade + CredSSP + NTLM Type 2 extraction | 3389 | 12 000 ms | Yes | **No** |

---

## 1. POST /api/rdp/connect

Basic connectivity test. Sends X.224 CR requesting all protocols (`SSL | HYBRID | RDSTLS` = `0x0B`) and parses the CC response.

### Request

```json
{ "host": "10.0.0.5", "port": 3389, "timeout": 10000 }
```

All fields except `host` are optional.

### Response (success)

```json
{
  "success": true,
  "host": "10.0.0.5",
  "port": 3389,
  "connectTime": 12,
  "rtt": 45,
  "tpktVersion": 3,
  "x224Type": "0xD0 (Connection Confirm)",
  "hasNegotiation": true,
  "selectedProtocol": 2,
  "selectedProtocolNames": ["CredSSP/NLA"],
  "negotiationFlags": 0,
  "nlaRequired": false
}
```

- `connectTime` — TCP handshake only (ms).
- `rtt` — total round-trip including X.224 exchange (ms).
- `selectedProtocol` — integer from server's NEG_RSP.
- `selectedProtocolNames` — human-readable array via bitmask decode.
- `nlaRequired` — true if bit 1 of `negotiationFlags` is set.
- `failureCode` / `failureMessage` — present only when the server sends a NEG_FAILURE.

### Known bug: negotiation offset

`/connect` computes the negotiation-response offset as `negOffset = x224Length` (the X.224 Length Indicator value), but the negotiation data starts at a fixed offset of 7 bytes into the X.224 payload (1 LI byte + 6 fixed CC bytes). For a standard CC+NEG_RSP (LI = 14), the handler reads byte 14 instead of byte 7 — which is the last byte of the 4-byte `selectedProtocol` field (always `0x00` for protocol values 0–3). Result: **`/connect` always reports `selectedProtocol: 0` (Standard RDP Security) regardless of what the server negotiated.** The `nlaRequired` flag is similarly always false.

Use `/negotiate` or `/nla-probe` for accurate protocol detection.

---

## 2. POST /api/rdp/negotiate

Accurate X.224 negotiation with a configurable protocol bitmask and correct response parsing.

### Request

```json
{
  "host": "10.0.0.5",
  "port": 3389,
  "requestProtocols": 3,
  "timeout": 10000
}
```

- `requestProtocols` — bitmask of protocols to offer (default `3` = SSL `0x01` | HYBRID `0x02`). Does not include RDSTLS by default (unlike `/connect` which hardcodes `0x0B`).

### Response (success)

```json
{
  "success": true,
  "selectedProtocol": 2,
  "protocolName": "NLA (CredSSP)",
  "serverFlags": 15,
  "rdpVersion": "RDP 6.0+ (NLA/CredSSP)",
  "latencyMs": 48,
  "raw": [3, 0, 0, 19, 14, 208, 0, 0, 0, 0, 0, 2, 31, 8, 0, 2, 0, 0, 0]
}
```

- `protocolName` — single string (vs `/connect`'s array).
- `serverFlags` — the flags byte from the NEG_RSP (offset +1).
- `rdpVersion` — derived heuristic: NLA → "RDP 6.0+", TLS → "RDP 5.2+", Standard → "RDP 5.x".
- `raw` — full TPKT+X.224+NEG_RSP packet as integer array for offline analysis.
- `note` — present when the server omits a Negotiation Response ("Server responded without RDP Negotiation Response — likely Standard RDP Security only").

### Response (negotiation failure)

```json
{
  "success": true,
  "selectedProtocol": 0,
  "protocolName": "Standard RDP",
  "serverFlags": 0,
  "rdpVersion": "RDP 5.x (Standard RDP Security)",
  "latencyMs": 52,
  "raw": [3, 0, 0, 19, ...],
  "failureCode": 5,
  "failureMessage": "HYBRID_REQUIRED_BY_SERVER"
}
```

Note: `success: true` even when the server sends a NEG_FAILURE. The failure is reported in `failureCode`/`failureMessage` — check these fields.

### Failure codes

| Code | Constant | Meaning |
|------|----------|---------|
| 1 | `SSL_REQUIRED_BY_SERVER` | Server requires TLS but client didn't offer it |
| 2 | `SSL_NOT_ALLOWED_BY_SERVER` | Client offered TLS but server doesn't support it |
| 3 | `SSL_CERT_NOT_ON_SERVER` | TLS requested but no certificate configured |
| 4 | `INCONSISTENT_FLAGS` | Contradictory flags in the request |
| 5 | `HYBRID_REQUIRED_BY_SERVER` | Server requires NLA but client didn't offer it |
| 6 | `SSL_WITH_USER_AUTH_REQUIRED_BY_SERVER` | Server requires TLS + user-level auth |

---

## 3. POST /api/rdp/nla-probe

Full NLA probe: X.224 → TLS upgrade → CredSSP TSRequest v6 with NTLM Type 1 → parse NTLM Type 2 challenge. Extracts the server's Windows identity (computer name, domain, DNS names) without needing valid credentials.

### Request

```json
{ "host": "10.0.0.5", "port": 3389, "timeout": 12000 }
```

### Response (NLA success — full NTLM challenge extracted)

```json
{
  "success": true,
  "selectedProtocol": 2,
  "protocolName": "NLA (CredSSP)",
  "tlsUpgraded": true,
  "nlaProbed": true,
  "ntlmChallenge": {
    "serverChallenge": "a1b2c3d4e5f6a7b8",
    "targetName": "MYSERVER",
    "nbComputerName": "MYSERVER",
    "nbDomainName": "MYDOMAIN",
    "dnsComputerName": "myserver.mydomain.local",
    "dnsDomainName": "mydomain.local",
    "ntlmFlags": 1615462421
  },
  "note": "NLA probe successful — extracted Windows server identity via NTLM challenge",
  "x224LatencyMs": 23,
  "latencyMs": 187
}
```

- `serverChallenge` — 8-byte hex string (the NTLM nonce).
- `ntlmFlags` — raw 32-bit NTLM negotiate flags from the Type 2 message.
- `x224LatencyMs` — time for the X.224 round-trip only.
- `latencyMs` — total probe duration.

### Response (TLS only, no NLA)

```json
{
  "success": true,
  "selectedProtocol": 1,
  "protocolName": "SSL/TLS",
  "tlsUpgraded": true,
  "nlaProbed": false,
  "note": "TLS upgraded (server selected TLS, not NLA — NTLM challenge not available)",
  "x224LatencyMs": 18,
  "latencyMs": 95
}
```

### Response (Standard RDP, no TLS)

```json
{
  "success": true,
  "selectedProtocol": 0,
  "protocolName": "Standard RDP",
  "tlsUpgraded": false,
  "nlaProbed": false,
  "note": "Server selected Standard RDP Security — TLS/NLA not available",
  "x224LatencyMs": 15,
  "latencyMs": 15
}
```

### NLA probe internals

1. Opens TCP with `secureTransport: 'starttls'` (Cloudflare Workers API for deferred TLS upgrade).
2. Sends X.224 CR requesting only `PROTOCOL_HYBRID` (0x02) — not SSL, not RDSTLS.
3. Parses X.224 CC to determine selected protocol.
4. If NLA or TLS selected: calls `socket.startTls()` to upgrade.
5. If NLA: sends CredSSP TSRequest v6 containing NTLM Type 1 (NEGOTIATE_MESSAGE).
6. Reads up to 512 bytes with a 6-second inner deadline to capture the NTLM Type 2.
7. Scans the response for the `NTLMSSP\0` signature, then parses Type 2 fields.

---

## Wire Format Reference

### TPKT Header (4 bytes, RFC 1006)

```
[0]   Version = 0x03
[1]   Reserved = 0x00
[2-3] Length (uint16 BE) — total packet including header
```

### X.224 Connection Request (variable)

```
[0]     LI (Length Indicator) — bytes following this field
[1]     TPDU code = 0xE0 (Connection Request)
[2-3]   DST-REF = 0x0000
[4-5]   SRC-REF = 0x4321 (hardcoded)
[6]     Class = 0x00
[7-14]  RDP Negotiation Request (8 bytes):
          [7]     type = 0x01 (TYPE_RDP_NEG_REQ)
          [8]     flags = 0x00
          [9-10]  length = 8 (uint16 LE)
          [11-14] requestedProtocols (uint32 LE, bitmask)
```

### X.224 Connection Confirm (variable)

```
[0]     LI
[1]     TPDU code = 0xD0 (Connection Confirm)
[2-3]   DST-REF
[4-5]   SRC-REF
[6]     Class
[7-14]  RDP Negotiation Response (8 bytes, when LI > 6):
          [7]     type = 0x02 (NEG_RSP) or 0x03 (NEG_FAILURE)
          [8]     flags
          [9-10]  length = 8 (uint16 LE)
          [11-14] selectedProtocol (uint32 LE) or failureCode (uint32 LE)
```

### Protocol bitmask values

| Bit | Value | Name |
|-----|-------|------|
| — | `0x00000000` | Standard RDP Security (RC4/RSA) |
| 0 | `0x00000001` | TLS 1.0/1.1/1.2 (`PROTOCOL_SSL`) |
| 1 | `0x00000002` | CredSSP / NLA (`PROTOCOL_HYBRID`) |
| 3 | `0x00000008` | RDSTLS (`PROTOCOL_RDSTLS`) |

### Selected protocol values (in NEG_RSP)

| Value | Name | Handler label |
|-------|------|---------------|
| 0 | Standard RDP | "Standard RDP" |
| 1 | SSL/TLS | "SSL/TLS" |
| 2 | NLA (CredSSP) | "NLA (CredSSP)" |
| 3 | NLA+TLS (HYBRID_EX) | "NLA+TLS" |

### NTLM Type 1 (NEGOTIATE_MESSAGE)

Built by `buildNTLMNegotiate()`. 32 bytes fixed:
- Signature: `NTLMSSP\0`
- MessageType: 1
- NegotiateFlags: `0x60088215` (UNICODE, OEM, REQUEST_TARGET, NTLM, EXTENDED_SESSIONSECURITY)
- DomainNameFields: len=0, max=0, offset=32
- WorkstationFields: len=0, max=0, offset=32

### NTLM Type 2 AV_PAIR IDs parsed

| AvId | Name | Extracted field |
|------|------|-----------------|
| 0 | MsvAvEOL | (terminates parse) |
| 1 | MsvAvNbComputerName | `nbComputerName` |
| 2 | MsvAvNbDomainName | `nbDomainName` |
| 3 | MsvAvDnsComputerName | `dnsComputerName` |
| 4 | MsvAvDnsDomainName | `dnsDomainName` |

AvId 5 (DnsTreeName), 6 (Flags), 7 (Timestamp), 9 (TargetName), 10 (ChannelBindings) are **not parsed** — silently skipped.

### CredSSP TSRequest v6

`buildCredSSPRequest()` wraps the NTLM token in DER-encoded ASN.1:

```
SEQUENCE {                    -- TSRequest
  [0] INTEGER 6               -- version
  [1] SEQUENCE {              -- negoTokens
    SEQUENCE {                -- NegoData
      [0] OCTET STRING {     -- negoToken
        <NTLM bytes>
      }
    }
  }
}
```

---

## Cross-Endpoint Comparison

| Field | `/connect` | `/negotiate` | `/nla-probe` |
|-------|-----------|-------------|-------------|
| Protocol request | `0x0B` (all) | configurable (default `3`) | `0x02` (HYBRID only) |
| Timing | `connectTime` + `rtt` | `latencyMs` | `x224LatencyMs` + `latencyMs` |
| Protocol name | `selectedProtocolNames` (array) | `protocolName` (string) | `protocolName` (string) |
| Raw packet | — | `raw` (int array) | — |
| Version heuristic | — | `rdpVersion` | — |
| NLA required flag | `nlaRequired` | — | — |
| NTLM challenge | — | — | `ntlmChallenge` |
| Port validation | Yes | Yes | **No** |
| Negotiation parsing | **Broken** (see bug above) | Correct | Correct |

---

## Quirks and Limitations

1. **`/connect` negotiation parsing is broken.** Uses `negOffset = x224Length` (the LI value, typically 14) instead of the fixed offset 7. Always reports `selectedProtocol: 0`. Use `/negotiate` for accurate protocol detection.

2. **`success: true` with failure.** `/negotiate` returns `success: true` even when the server sends `TYPE_RDP_NEG_FAILURE`. You must check `failureCode` to detect negotiation failures.

3. **No port validation in `/nla-probe`.** `/connect` and `/negotiate` validate `port ∈ [1, 65535]`, but `/nla-probe` passes the port directly to `connect()` without validation.

4. **`readExact()` discards excess bytes.** If the TCP read returns more bytes than requested, the surplus is silently dropped. For RDP's small packets (typically 19 bytes) this rarely matters, but it's a fragility if a server sends the TPKT header and CC in a single segment.

5. **`/nla-probe` requests only HYBRID.** It sends `requestedProtocols = 0x02` (CredSSP only). If the server supports TLS but not NLA, the server may fall back to Standard RDP or send a NEG_FAILURE, depending on configuration. The `/connect` endpoint requests `0x0B` (all protocols) for broader detection.

6. **`/nla-probe` 512-byte read cap with 6-second deadline.** NTLM Type 2 messages are typically well under 512 bytes, but servers with very long TargetInfo AV pairs could theoretically exceed this. The 6-second inner deadline is hardcoded and separate from the outer `timeout`.

7. **No Cookie in negotiate/nla-probe.** The planning doc's `RDPClient` class included a `Cookie: mstshash=<username>` in the X.224 CR. The actual implementation's `buildConnectionRequest()` does not include any cookie — the X.224 CR contains only the negotiation request. This is fine for probing but some RDP gateways may behave differently without a cookie.

8. **SRC-REF = 0x4321.** The X.224 Source Reference is hardcoded to `0x4321` (non-zero). Some protocol analyzers use this to fingerprint the client. Standard RDP clients use `0x0000`.

9. **CredSSP version 6.** The TSRequest uses version 6 (latest). Servers running older Windows versions may reject or behave unexpectedly with v6. No version negotiation or fallback is implemented.

10. **NTLM AvId 7 (Timestamp) not extracted.** The server's FILETIME timestamp in the Type 2 message could be used to detect clock skew, but `parseNTLMChallenge()` only decodes AvIds 1–4.

11. **No TLS certificate inspection.** After `startTls()`, the server's TLS certificate is not examined. Certificate subject/SAN could provide additional server identity information.

12. **Single TCP read for X.224 CC.** Both `/connect` and `/negotiate` use `readExact()` which accumulates chunks correctly, so TCP fragmentation is handled. However, there's no protection against a server that sends a partial TPKT and then stalls — the timeout covers this at the outer level.

13. **Cloudflare check runs outside the timeout.** All three endpoints call `checkIfCloudflare()` before starting the timeout race. A slow DNS resolution for the CF check isn't covered by the user-specified timeout.

---

## curl Examples

### Basic connectivity test

```bash
curl -s -X POST https://portofcall.app/api/rdp/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5"}' | jq .
```

### Detect supported security protocol

```bash
# Offer all protocols
curl -s -X POST https://portofcall.app/api/rdp/negotiate \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","requestProtocols":11}' | jq .

# Test if NLA is required (offer only Standard RDP)
curl -s -X POST https://portofcall.app/api/rdp/negotiate \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","requestProtocols":0}' | jq .failureMessage
```

### Extract Windows server identity via NLA probe

```bash
curl -s -X POST https://portofcall.app/api/rdp/nla-probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","timeout":15000}' | jq .ntlmChallenge
```

### Scan a non-standard port

```bash
curl -s -X POST https://portofcall.app/api/rdp/negotiate \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","port":13389}' | jq '{proto: .protocolName, ms: .latencyMs}'
```
