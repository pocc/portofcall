# SNMP — Power User Reference

**Port:** 161 (agent queries) | **Protocol:** SNMPv1, SNMPv2c, SNMPv3 USM | **Tests:** Deployed

Port of Call provides three SNMP endpoints: a single-OID GET, a subtree WALK, and an SNMPv3 authenticated GET. All three open a direct TCP connection from the Cloudflare Worker to your SNMP agent (RFC 3430 — SNMP over TCP). UDP is not supported.

---

## API Endpoints

### `POST /api/snmp/get` — Single OID query (v1/v2c)

Sends a GET-REQUEST for one OID and returns the variable binding.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `161` | |
| `community` | string | `"public"` | Community string (sent in plaintext) |
| `oid` | string | required | Dotted-decimal, e.g. `1.3.6.1.2.1.1.1.0` |
| `version` | `1` \| `2` | `2` | `1` = SNMPv1 (GET-REQUEST), `2` = SNMPv2c (GET-REQUEST) |
| `timeout` | number (ms) | `10000` | |

**Success (200):**
```json
{
  "success": true,
  "results": [
    {
      "oid": "1.3.6.1.2.1.1.1.0",
      "type": "STRING",
      "value": "Linux myhost 5.15.0 #1 SMP x86_64"
    }
  ]
}
```

**Error (500):**
```json
{
  "success": false,
  "errorStatus": "noSuchName",
  "errorIndex": 1
}
```

`errorStatus` values: `noError`, `tooBig`, `noSuchName`, `badValue`, `readOnly`, `genErr`.

**Note:** `version: 1` forces SNMPv1 GET-REQUEST (which has subtly different error semantics — `noSuchName` vs. SNMPv2c `noSuchObject` / `endOfMibView`). Always prefer `version: 2` unless targeting a v1-only agent.

---

### `POST /api/snmp/walk` — Subtree walk (v1/v2c)

Iterates a subtree using GETNEXT (SNMPv1) or GETBULK (SNMPv2c) over a persistent TCP connection.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `161` | |
| `community` | string | `"public"` | |
| `oid` | string | required | Root of the subtree to walk |
| `version` | `1` \| `2` | `2` | v2 uses GETBULK; v1 uses GETNEXT (one OID per round-trip) |
| `maxRepetitions` | number | `10` | GETBULK only — number of OIDs per GETBULK response |
| `timeout` | number (ms) | `30000` | Total walk timeout (not per-request) |

**Success (200):**
```json
{
  "success": true,
  "count": 7,
  "results": [
    { "oid": "1.3.6.1.2.1.1.1.0", "type": "STRING",    "value": "Linux myhost 5.15.0" },
    { "oid": "1.3.6.1.2.1.1.3.0", "type": "TIMETICKS", "value": 123456789 },
    { "oid": "1.3.6.1.2.1.1.5.0", "type": "STRING",    "value": "myhost.example.com" }
  ]
}
```

**Walk termination:** stops when a returned OID falls outside the requested subtree, when the agent signals end-of-MIB, or when `timeout` is exhausted.

**Performance:** For deep subtrees, increase `maxRepetitions` (20–50). GETBULK with `maxRepetitions: 50` is much faster than GETNEXT for large tables like ifTable. Be aware: very large GETBULK responses may be truncated if they span multiple TCP segments (see Known Limitations).

---

### `POST /api/snmp/v3-get` — SNMPv3 USM authenticated GET

Full SNMPv3 User Security Model (USM) flow: discovery + authenticated GET-REQUEST. Supports multiple OIDs per call.

**Request:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `161` | |
| `username` | string | required | USM username configured on agent |
| `authPassword` | string | — | If omitted, uses `noAuthNoPriv` |
| `authProtocol` | `"SHA"` \| `"MD5"` | `"SHA"` | See note — both use SHA-1 internally |
| `privPassword` | string | — | **Accepted but ignored** — see Known Limitations |
| `privProtocol` | `"AES"` \| `"DES"` | — | **Accepted but ignored** — see Known Limitations |
| `oids` | string[] | required | One or more OIDs in dotted-decimal form |
| `timeout` | number (ms) | `10000` | Applied per TCP connection (two connections total) |

**Success (200):**
```json
{
  "success": true,
  "engineId": "80001f8880a76c5a000000a5",
  "engineBoots": 12,
  "engineTime": 48291,
  "securityLevel": "authNoPriv",
  "authProtocol": "SHA",
  "varbinds": [
    { "oid": "1.3.6.1.2.1.1.1.0", "type": "STRING",    "value": "Linux myhost 5.15.0" },
    { "oid": "1.3.6.1.2.1.1.3.0", "type": "TIMETICKS", "value": 123456789 }
  ],
  "rtt": 184
}
```

`engineId` is the authoritative engine ID in hex. `engineBoots` + `engineTime` are the agent's boot count and seconds-since-boot, returned from the discovery step.

---

## SNMPv3 Flow (What the implementation does)

The v3 endpoint makes **two TCP connections**:

```
Client                              Agent
  |                                   |
  | ---[Discovery: REPORT-REQ]------> |  empty engineID, msgFlags=0x04 (REPORTABLE)
  | <--[REPORT: USM error]---------   |  carries engineID, engineBoots, engineTime
  |                                   |
  | ---[GET-REQUEST: auth'd]-------->  |  HMAC-SHA1 over full message, first 12 bytes
  | <--[GET-RESPONSE]---------------  |  variable bindings
```

**Step 1 (Discovery):** Sends an unauthenticated message with empty engineID and `msgFlags=0x04` (REPORTABLE). The agent responds with a REPORT PDU containing its `usmStatsUnknownEngineIDs` OID, and crucially, the USM security parameters include the real engineID, engineBoots, and engineTime.

**Step 2 (Authenticated GET):** Uses the discovered engineID to localize the auth key (RFC 3414 key derivation: hash 1MB of repeated password to get Ku, then hash Ku+engineID+Ku to get Kul). Builds a full GET-REQUEST PDU, computes HMAC over the whole message, inserts the first 12 bytes of the HMAC as `msgAuthenticationParameters`.

---

## Response Data Types

Both GET/WALK and v3-get parse these ASN.1 BER types:

| BER Tag | Type name | JS representation |
|---|---|---|
| `0x02` | `INTEGER` | number |
| `0x04` | `STRING` | UTF-8 decoded string |
| `0x06` | `OID` | dotted-decimal string |
| `0x05` | `NULL` | `"null"` |
| `0x40` | `IPADDRESS` | dotted-decimal string (e.g. `"192.168.1.1"`) |
| `0x41` | `COUNTER32` | number |
| `0x42` | `GAUGE32` | number |
| `0x43` | `TIMETICKS` | number (hundredths of a second) |
| `0x46` | `COUNTER64` | number (v3 only; v1/v2c returns UNKNOWN) |
| other | `UNKNOWN(0xNN)` | hex string of raw bytes |

**TIMETICKS note:** values are in hundredths of a second. Divide by 100 for seconds, by 8640000 for days. `sysUpTime.0` = `1.3.6.1.2.1.1.3.0`.

---

## Common OIDs for Daily Use

### MIB-II System Group (`1.3.6.1.2.1.1`)

| OID | Name | Type | Notes |
|---|---|---|---|
| `1.3.6.1.2.1.1.1.0` | `sysDescr` | STRING | Full OS/hardware description |
| `1.3.6.1.2.1.1.2.0` | `sysObjectID` | OID | Vendor enterprise OID |
| `1.3.6.1.2.1.1.3.0` | `sysUpTime` | TIMETICKS | Uptime in hundredths of a second |
| `1.3.6.1.2.1.1.4.0` | `sysContact` | STRING | Admin contact |
| `1.3.6.1.2.1.1.5.0` | `sysName` | STRING | Hostname |
| `1.3.6.1.2.1.1.6.0` | `sysLocation` | STRING | Physical location |
| `1.3.6.1.2.1.1.7.0` | `sysServices` | INTEGER | Services bitmask (L1=1, L2=2, L3=4, L4=8, L7=64) |

Walk `1.3.6.1.2.1.1` to get all 7 in one request.

### Interface Table (`1.3.6.1.2.1.2.2`)

Walk `1.3.6.1.2.1.2.2` for the full interface table. Key columns:

| Column OID | Name | Notes |
|---|---|---|
| `1.3.6.1.2.1.2.2.1.1` | `ifIndex` | Interface index |
| `1.3.6.1.2.1.2.2.1.2` | `ifDescr` | Interface description |
| `1.3.6.1.2.1.2.2.1.5` | `ifSpeed` | Speed in bits/sec (GAUGE32, max 4Gbps; use ifHighSpeed for 10G+) |
| `1.3.6.1.2.1.2.2.1.8` | `ifOperStatus` | `1`=up `2`=down `3`=testing |
| `1.3.6.1.2.1.2.2.1.10` | `ifInOctets` | Total input bytes (COUNTER32 — wraps at ~4GB) |
| `1.3.6.1.2.1.2.2.1.16` | `ifOutOctets` | Total output bytes (COUNTER32) |
| `1.3.6.1.2.1.2.2.1.14` | `ifInErrors` | Input errors |
| `1.3.6.1.2.1.2.2.1.20` | `ifOutErrors` | Output errors |

For 64-bit counters (RFC 2863 IF-MIB): `1.3.6.1.2.1.31.1.1.1` — `ifHCInOctets` (`.6`), `ifHCOutOctets` (`.10`), `ifHighSpeed` (`.15`). Requires SNMPv2c or v3.

### Host Resources (`1.3.6.1.2.1.25`)

| OID | Name | Notes |
|---|---|---|
| `1.3.6.1.2.1.25.2.3` | `hrStorageTable` | Disk/RAM: size, used, allocation units |
| `1.3.6.1.2.1.25.3.3.1.2` | `hrProcessorLoad` | CPU % per processor |
| `1.3.6.1.2.1.25.5.1.1.1` | `hrSWRunPerfCPU` | Per-process CPU time |

---

## Known Limitations

**UDP not supported.** SNMP standard transport is UDP port 161. This implementation uses TCP (RFC 3430). Many modern agents support both; some embedded devices (older switches, UPS units) respond only to UDP.

**SNMPv3 MD5 uses SHA-1 internally.** The `authProtocol: "MD5"` parameter is accepted but the HMAC is computed with SHA-1 (WebCrypto does not expose MD5). Agents configured for SHA-1 auth will authenticate correctly. Agents configured for MD5 auth will reject the request with `usmStatsWrongDigests`.

**SNMPv3 privacy (`authPriv`) not supported.** `privPassword` and `privProtocol` fields are accepted in the request but not used — the implementation never encrypts the scoped PDU. The `securityLevel` is always either `noAuthNoPriv` (no `authPassword`) or `authNoPriv` (with `authPassword`). Sending `authPriv` traffic to an agent that requires it will result in a REPORT PDU with `usmStatsDecryptionErrors`.

**Single TCP read per message.** GET and each GETBULK iteration call `reader.read()` exactly once. If a GETBULK response spans multiple TCP segments (possible with `maxRepetitions` > 20 over slow links), only the first segment is parsed and results are silently truncated. Lower `maxRepetitions` if you see suspiciously short walk results.

**COUNTER64 only in v3.** The v1/v2c GET and WALK parsers handle types up to TIMETICKS (0x43); 64-bit counter values (0x46, `COUNTER64`) are returned as `UNKNOWN(0x46)`. Use `/api/snmp/v3-get` to retrieve 64-bit interface counters from the IF-MIB.

**Binary OCTET STRING values.** All `STRING` values are UTF-8 decoded with `TextDecoder`. OIDs containing binary data (MAC addresses in bridge MIBs, raw keys) will be corrupted. Convert expected binary OIDs to hex by fetching them as `UNKNOWN` type (if the agent responds with an unrecognized tag) or inspect the raw hex in `UNKNOWN(0xNN)` output.

**No SNMPv2c INFORM / TRAP receive.** Port of Call is a query initiator only — there is no endpoint to receive asynchronous traps or informs.

**No SET operations.** Write access (SET-REQUEST) is not implemented.

---

## curl Examples

```bash
# GET sysDescr
curl -s -X POST https://portofcall.ross.gg/api/snmp/get \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","community":"public","oid":"1.3.6.1.2.1.1.1.0"}' | jq .

# GET sysUpTime with SNMPv1 forced
curl -s -X POST https://portofcall.ross.gg/api/snmp/get \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","community":"public","oid":"1.3.6.1.2.1.1.3.0","version":1}' | jq .results[0].value

# Walk entire system group
curl -s -X POST https://portofcall.ross.gg/api/snmp/walk \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","community":"public","oid":"1.3.6.1.2.1.1"}' | jq '.results[] | "\(.oid) = \(.type): \(.value)"'

# Walk ifTable with large bulk size for efficiency
curl -s -X POST https://portofcall.ross.gg/api/snmp/walk \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","community":"public","oid":"1.3.6.1.2.1.2.2","maxRepetitions":50,"timeout":60000}' | jq '.count, .results[0]'

# SNMPv3 noAuthNoPriv (just username, no password)
curl -s -X POST https://portofcall.ross.gg/api/snmp/v3-get \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","username":"monitor","oids":["1.3.6.1.2.1.1.1.0","1.3.6.1.2.1.1.3.0"]}' | jq .

# SNMPv3 authNoPriv with SHA-1
curl -s -X POST https://portofcall.ross.gg/api/snmp/v3-get \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.1","username":"monitor","authPassword":"myauthpass","authProtocol":"SHA","oids":["1.3.6.1.2.1.1.1.0","1.3.6.1.2.1.2.2.1.10.1"]}' | jq '{engineId:.engineId, rtt:.rtt, varbinds:.varbinds}'
```

---

## SNMP Error Status Codes

| Code | Name | Meaning |
|---|---|---|
| 0 | `noError` | Success |
| 1 | `tooBig` | Response PDU exceeds agent's max size |
| 2 | `noSuchName` | OID does not exist (v1 only) |
| 3 | `badValue` | Invalid value for SET |
| 4 | `readOnly` | Attempted SET on read-only OID |
| 5 | `genErr` | General unspecified error |

SNMPv2c exceptions (appear as `type` in varbinds, not `errorStatus`): `noSuchObject` (0x80), `noSuchInstance` (0x81), `endOfMibView` (0x82). These are not surfaced as distinct types in the current implementation — they appear as `UNKNOWN(0x80)` etc.

---

## SNMPv3 Engine ID Format

The `engineId` field is returned as a hex string (e.g., `"80001f8880a76c5a000000a5"`). RFC 3411 format:

```
[4 bytes: enterprise OID, MSB set] [1 byte: format] [N bytes: ID]
Format byte: 1=IPv4, 2=IPv6, 3=MAC, 4=text, 5=octets
```

Common prefixes: `80001f88` = net-snmp, `8000273b` = Cisco IOS, `80007a69` = Windows SNMP service.

---

## Public Test Agents

Most public SNMP labs have been decommissioned. Test against your own agent:

```bash
# Run a local net-snmp agent (Linux)
apt install snmpd
# Edit /etc/snmp/snmpd.conf to add community/v3 user
snmpd -f -Le  # foreground, log to stderr

# Quick test with snmpget (local)
snmpget -v2c -c public 127.0.0.1 1.3.6.1.2.1.1.1.0

# Configure SNMPv3 user (net-snmp)
net-snmp-create-v3-user -ro -A myauthpass -a SHA -X myprivpass -x AES monitor
```

---

## Wire Format Reference

### SNMPv1/v2c message structure

```
SEQUENCE {
  INTEGER version          (0 = SNMPv1, 1 = SNMPv2c)
  OCTET_STRING community   (plaintext community string)
  PDU {                    (tag 0xa0=GET, 0xa1=GETNEXT, 0xa5=GETBULK)
    INTEGER request-id
    INTEGER error-status   (GET/GETNEXT) or non-repeaters (GETBULK)
    INTEGER error-index    (GET/GETNEXT) or max-repetitions (GETBULK)
    SEQUENCE {
      SEQUENCE { OID, NULL }   (one varbind per requested OID)
    }
  }
}
```

### SNMPv3 message structure

```
SEQUENCE {
  INTEGER version=3
  SEQUENCE {               (global header)
    INTEGER msgID
    INTEGER msgMaxSize=65507
    OCTET_STRING msgFlags  (1 byte: bit0=auth, bit1=priv, bit2=reportable)
    INTEGER msgSecurityModel=3  (USM)
  }
  OCTET_STRING {           (wraps USM security parameters SEQUENCE)
    SEQUENCE {
      OCTET_STRING msgAuthoritativeEngineID
      INTEGER msgAuthoritativeEngineBoots
      INTEGER msgAuthoritativeEngineTime
      OCTET_STRING msgUserName
      OCTET_STRING msgAuthenticationParameters  (12 bytes HMAC, or 12 zero bytes)
      OCTET_STRING msgPrivacyParameters         (0 bytes for noPriv)
    }
  }
  SEQUENCE {               (scoped PDU)
    OCTET_STRING contextEngineID
    OCTET_STRING contextName  (empty string = default context)
    PDU { ... }
  }
}
```

---

## Resources

- [RFC 1157 — SNMPv1](https://www.rfc-editor.org/rfc/rfc1157)
- [RFC 3416 — SNMPv2c Protocol Operations](https://www.rfc-editor.org/rfc/rfc3416)
- [RFC 3411 — SNMPv3 Architecture](https://www.rfc-editor.org/rfc/rfc3411)
- [RFC 3414 — USM for SNMPv3](https://www.rfc-editor.org/rfc/rfc3414) (key localization, auth, priv)
- [RFC 3430 — SNMP over TCP](https://www.rfc-editor.org/rfc/rfc3430)
- [MIB-II RFC 1213](https://www.rfc-editor.org/rfc/rfc1213)
- [IF-MIB RFC 2863](https://www.rfc-editor.org/rfc/rfc2863) (64-bit counters, ifHighSpeed)
