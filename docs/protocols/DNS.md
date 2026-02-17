# DNS — Power User Reference

**Port:** 53 (TCP) | **Protocol:** DNS over TCP (RFC 1035, RFC 5936) | **Tests:** ✅ Deployed

Port of Call implements two DNS endpoints: a standard query handler and a full AXFR zone transfer. Both open a direct TCP connection from the Cloudflare Worker to your DNS server. UDP is not supported (Workers runtime is TCP-only). DNS-over-TLS (port 853) is not supported.

---

## API Endpoints

### `POST /api/dns/query` — Standard DNS query

Sends a single DNS query and parses the full response including answer, authority, and additional sections.

**Request body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `domain` | string | required | Trailing dot stripped automatically |
| `type` | string | `"A"` | Record type name (see table below) |
| `server` | string | `"8.8.8.8"` | Any DNS server IP; hostname resolution uses Cloudflare's internal resolver |
| `port` | number | `53` | |

**Success (200):**
```json
{
  "success": true,
  "domain": "example.com",
  "server": "8.8.8.8",
  "port": 53,
  "queryType": "MX",
  "rcode": "NOERROR",
  "flags": {
    "qr": true,
    "aa": false,
    "tc": false,
    "rd": true,
    "ra": true
  },
  "questions": 1,
  "answers": [
    { "name": "example.com", "type": "MX", "typeCode": 15, "class": 1, "ttl": 3600, "data": "10 mail.example.com" }
  ],
  "authority": [],
  "additional": [],
  "queryTimeMs": 42
}
```

**Flag meanings:**

| Flag | Meaning |
|---|---|
| `qr` | Response bit (always true in a valid response) |
| `aa` | Authoritative Answer — the responding server is authoritative for this zone |
| `tc` | Truncated — response was cut off (rare over TCP; common over UDP) |
| `rd` | Recursion Desired — set in the query (always true here) |
| `ra` | Recursion Available — the server supports recursive resolution |

**RCODE values:**

| RCODE | Meaning |
|---|---|
| `NOERROR` | Success |
| `FORMERR` | Query format error |
| `SERVFAIL` | Server failure |
| `NXDOMAIN` | Name does not exist |
| `NOTIMP` | Query type not implemented by server |
| `REFUSED` | Server refused (policy) |

**Error (400):** `{ "error": "Unknown record type: BOGUS. Supported: A, NS, CNAME, SOA, ..." }`

**Cloudflare-protected server (403):** `{ "success": false, "error": "...", "isCloudflare": true }`

---

### `POST /api/dns/axfr` — AXFR zone transfer

Sends an AXFR query (RFC 5936) and streams all DNS messages until the closing SOA, collecting every record in the zone.

**Request body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `zone` | string | required | Zone apex (e.g. `"example.com"`) |
| `server` | string | required | Must be an authoritative nameserver that permits transfers |
| `port` | number | `53` | |
| `timeout` | number (ms) | `30000` | Capped at 60000 |
| `maxRecords` | number | `50000` | Capped at 100000 |

**Success (200):**
```json
{
  "success": true,
  "zone": "example.com",
  "server": "ns1.example.com",
  "port": 53,
  "soaSerial": 2024010101,
  "recordCount": 1243,
  "typeSummary": { "SOA": 2, "NS": 4, "A": 800, "AAAA": 120, "MX": 5, "TXT": 80, "CNAME": 200, "DNSKEY": 2, "RRSIG": 32 },
  "messageCount": 5,
  "transferTimeMs": 312,
  "complete": true,
  "records": [ ... ]
}
```

`complete: true` means the transfer ended with a second SOA record (RFC 5936 §4.1 boundary). `complete: false` means the transfer hit `timeout` or `maxRecords` before the closing SOA arrived.

**Zone transfer refused (200):**
```json
{ "success": false, "error": "Zone transfer refused: REFUSED", "transferTimeMs": 15 }
```

Servers that don't permit transfers from your IP return RCODE `REFUSED` (5) or `NOTAUTH` in the first message.

**Note on AXFR flags:** The AXFR query intentionally sends no Recursion Desired bit (`RD=0`). Zone transfers are an authoritative operation — recursive resolvers don't serve them.

---

## Supported Record Types

All 28 types below can be used as the `type` field in `/api/dns/query`. Each is parsed into a human-readable `data` string.

### Common types

| Type | Code | `data` format |
|---|---|---|
| `A` | 1 | `"1.2.3.4"` |
| `NS` | 2 | `"ns1.example.com"` |
| `CNAME` | 5 | `"alias.example.com"` |
| `SOA` | 6 | `"ns1.example.com admin.example.com 2024010101"` (mname, rname, serial) |
| `PTR` | 12 | `"hostname.example.com"` |
| `MX` | 15 | `"10 mail.example.com"` (priority, exchanger) |
| `TXT` | 16 | Raw string (multi-string TXT records are concatenated) |
| `AAAA` | 28 | `"2001:db8::1"` (hex groups, not compressed) |
| `SRV` | 33 | `"10 20 443 target.example.com"` (priority, weight, port, target) |
| `CAA` | 257 | `"0 issue \"letsencrypt.org\""` (flags, tag, value) |

### Service/routing types

| Type | Code | `data` format |
|---|---|---|
| `NAPTR` | 35 | `"100 10 \"s\" \"SIP+D2T\" \"\" _sip._tcp.example.com"` (order, pref, flags, services, regexp, replacement) |
| `SVCB` | 64 | `"1 .example.com"` (priority, target) |
| `HTTPS` | 65 | `"1 .example.com"` — same as SVCB; used for HTTPS service binding |

### DNSSEC types

| Type | Code | `data` format |
|---|---|---|
| `DS` | 43 | `"12345 ECDSAP256SHA256 SHA-256 abcd1234..."` (key tag, algorithm, digest type, hex digest) |
| `RRSIG` | 46 | `"A algo=13 labels=2 keyTag=12345 signer=example.com expires=2024-06-01"` |
| `NSEC` | 47 | `"next.example.com (A AAAA MX RRSIG NSEC)"` (next name, bitmap of covered types) |
| `DNSKEY` | 48 | `"257 3 13 (SEP/KSK) AQPR..."` (flags, protocol, algorithm, key type, base64 prefix) |
| `NSEC3` | 50 | `"hashAlgo=1 iterations=10 salt=ab12 opt-out"` |
| `NSEC3PARAM` | 51 | Raw hex |
| `CDS` | 59 | Same as DS (child-published DS for key rollover) |
| `CDNSKEY` | 60 | Same as DNSKEY (child-published DNSKEY for key rollover) |

**DNSKEY flag decoding:**

| Flags bit | Meaning |
|---|---|
| bit 8 (0x0100) | Zone Key (`ZSK`) — this key can sign the zone |
| bit 0 (0x0001) | Secure Entry Point (`SEP`/`KSK`) — this is a key-signing key |

A ZSK has flags `256`; a KSK has flags `257` (both bits set). The `data` string shows the decoded label (`ZSK`, `SEP/KSK`, `ZSK+SEP/KSK`).

**Algorithm names** (DS and DNSKEY):

| Code | Name |
|---|---|
| 5 | RSASHA1 |
| 7 | RSASHA1-NSEC3-SHA1 |
| 8 | RSASHA256 |
| 10 | RSASHA512 |
| 13 | ECDSAP256SHA256 |
| 14 | ECDSAP384SHA384 |
| 15 | ED25519 |
| 16 | ED448 |

**DS digest type names:**

| Code | Name |
|---|---|
| 1 | SHA-1 |
| 2 | SHA-256 |
| 3 | GOST |
| 4 | SHA-384 |

### Security/identity types

| Type | Code | `data` format |
|---|---|---|
| `SSHFP` | 44 | `"Ed25519 SHA-256 abcd1234..."` (algorithm, fingerprint type, hex fingerprint) |
| `TLSA` | 52 | `"DANE-EE SPKI SHA-256 abcd1234..."` (usage, selector, matching type, hex data) |
| `IPSECKEY` | 45 | Raw hex |
| `OPENPGPKEY` | 61 | Raw hex |

**TLSA usage names:**

| Code | Name | Meaning |
|---|---|---|
| 0 | `PKIX-TA` | Trust anchor from PKIX chain |
| 1 | `PKIX-EE` | End-entity cert, must chain to PKIX |
| 2 | `DANE-TA` | Trust anchor, no PKIX required |
| 3 | `DANE-EE` | End-entity cert, no PKIX required (most common for self-signed) |

**TLSA selector names:**

| Code | Name | Meaning |
|---|---|---|
| 0 | `Cert` | Full certificate |
| 1 | `SPKI` | SubjectPublicKeyInfo only |

**TLSA matching type names:**

| Code | Name |
|---|---|
| 0 | `Full` |
| 1 | `SHA-256` |
| 2 | `SHA-512` |

### Special query types

| Type | Code | Notes |
|---|---|---|
| `ANY` | 255 | Requests all record types; most public resolvers return HINFO or empty (RFC 8482 deprecation) |
| `AXFR` | 252 | Use `/api/dns/axfr` endpoint instead of `/api/dns/query` for zone transfers |
| `IXFR` | 251 | Sends an IXFR query; most servers respond with a full AXFR or refuse |

Unknown/unsupported type codes are returned as `"TYPE<N>"` in the `type` field and raw hex (up to 64 bytes, then `...`) in the `data` field.

---

## DNSSEC Workflows

### Verify a domain is DNSSEC-signed

```bash
# 1. Check for DNSKEY at the apex
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"cloudflare.com","type":"DNSKEY","server":"1.1.1.1"}' | jq '.answers[] | {type,data}'

# 2. Check for DS at the parent zone (confirms chain of trust to root)
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"cloudflare.com","type":"DS","server":"8.8.8.8"}' | jq '.answers[] | {data}'

# 3. Verify RRSIG covers the A records
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"cloudflare.com","type":"RRSIG","server":"1.1.1.1"}' | jq '.answers[] | select(.data | startswith("A "))'
```

### DANE/TLSA lookup for SMTP

```bash
# Look up TLSA for port 25 SMTP on mail.example.com
# DANE SMTP format: _<port>._<proto>.<hostname>
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"_25._tcp.mail.example.com","type":"TLSA","server":"8.8.8.8"}' | jq '.answers[].data'
```

### SSHFP — verify SSH host key via DNS

```bash
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"bastion.example.com","type":"SSHFP","server":"8.8.8.8"}' | jq '.answers[].data'
# Returns: "Ed25519 SHA-256 <fingerprint>"
# Compare against: ssh-keygen -l -E sha256 -f /etc/ssh/ssh_host_ed25519_key.pub
```

### Query authoritative nameserver directly (AA bit)

```bash
# Get NS records for the zone
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","type":"NS","server":"8.8.8.8"}' | jq '.answers[].data'

# Then query the authoritative nameserver directly — check for aa:true in response
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","type":"SOA","server":"ns1.example.com"}' | jq '{aa: .flags.aa, data: .answers[0].data}'
```

---

## AXFR Zone Transfer

Zone transfers require that the authoritative server permits transfers from Cloudflare's egress IPs. Most production servers allow transfers only from secondary nameservers (configured via ACL or `allow-transfer`).

### Test servers that permit AXFR

```bash
# zonetransfer.me — intentionally permits AXFR (security training resource)
curl -s -X POST https://portofcall.ross.gg/api/dns/axfr \
  -H 'Content-Type: application/json' \
  -d '{"zone":"zonetransfer.me","server":"nsztm1.digi.ninja"}' | jq '{recordCount,soaSerial,typeSummary,complete}'

# Partial transfer with record cap
curl -s -X POST https://portofcall.ross.gg/api/dns/axfr \
  -H 'Content-Type: application/json' \
  -d '{"zone":"zonetransfer.me","server":"nsztm1.digi.ninja","maxRecords":100}' | jq '.records[:5]'
```

### Inspect DNSSEC records in a zone

```bash
# After a successful AXFR, filter for DNSSEC record types
curl -s -X POST https://portofcall.ross.gg/api/dns/axfr \
  -H 'Content-Type: application/json' \
  -d '{"zone":"example.com","server":"ns1.example.com"}' \
  | jq '[.records[] | select(.type | test("DNSKEY|RRSIG|NSEC|DS"))]'
```

### Check zone serial from multiple nameservers

```bash
# Compare SOA serials across NS servers to detect replication lag
for ns in ns1.example.com ns2.example.com; do
  curl -s -X POST https://portofcall.ross.gg/api/dns/query \
    -H 'Content-Type: application/json' \
    -d "{\"domain\":\"example.com\",\"type\":\"SOA\",\"server\":\"$ns\"}" \
    | jq --arg ns "$ns" '{server: $ns, serial: .answers[0].data}'
done
```

---

## curl Examples

```bash
# A record via Google Public DNS
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","type":"A"}' | jq '.answers[].data'

# MX records via Cloudflare DNS
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"gmail.com","type":"MX","server":"1.1.1.1"}' | jq '.answers[] | .data'

# TXT records (SPF, DKIM, DMARC)
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"_dmarc.example.com","type":"TXT","server":"8.8.8.8"}' | jq '.answers[].data'

# SRV for XMPP federation
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"_xmpp-server._tcp.jabber.org","type":"SRV","server":"8.8.8.8"}' | jq '.answers[].data'

# CAA — which CAs can issue for this domain
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","type":"CAA","server":"1.1.1.1"}' | jq '.answers[].data'

# PTR reverse lookup
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"1.0.0.127.in-addr.arpa","type":"PTR","server":"8.8.8.8"}' | jq '.answers[].data'

# Query a private/internal resolver
curl -s -X POST https://portofcall.ross.gg/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"internal.corp","type":"A","server":"10.0.0.53","port":53}' | jq .

# AXFR from an authoritative nameserver
curl -s -X POST https://portofcall.ross.gg/api/dns/axfr \
  -H 'Content-Type: application/json' \
  -d '{"zone":"zonetransfer.me","server":"nsztm1.digi.ninja","timeout":30000}' | jq '{recordCount,typeSummary,complete}'
```

---

## Known Limitations

**TCP only:** DNS over UDP is not supported (Workers runtime is TCP-only). All queries use the DNS-over-TCP framing (2-byte length prefix). TCP DNS is universally supported by all name servers but may be rate-limited on some public resolvers.

**No EDNS0:** Queries do not include OPT records (EDNS0). This means no DNSSEC DO bit, no extended RCODE, and no large-UDP-equivalent framing hints. Servers that require EDNS0 for DNSSEC responses may return truncated or empty additional sections.

**DNSSEC parsing, not validation:** RRSIG, DNSKEY, DS, NSEC, and NSEC3 records are parsed and displayed, but signatures are **not cryptographically verified**. The `expires` field in RRSIG is decoded from the wire but not compared against the current time. Use a validating resolver (Unbound, BIND with `dnssec-validation yes`) for actual DNSSEC validation.

**NSEC3 type bitmap not decoded:** NSEC3 records show `hashAlgo`, `iterations`, `salt`, and `opt-out` flag, but the type bitmap (which types are covered by this hash range) is not parsed. NSEC records fully decode the type bitmap.

**SOA data is partial:** Only `mname`, `rname`, and `serial` are shown in the SOA `data` field. `refresh`, `retry`, `expire`, and `minimum` are present in the wire format but not included in the decoded string.

**HTTPS/SVCB SvcParams not decoded:** Only `SvcPriority` and `TargetName` are decoded. `SvcParams` (ECH, alpn, port hints, ipv4hint, ipv6hint) are in the wire format but not parsed — they appear in the raw hex fallback for unknown types within the record.

**Cloudflare-hosted servers blocked:** The query endpoint detects if the target DNS server IP is behind Cloudflare and returns a 403 with `isCloudflare: true`. This prevents the Worker from looping back into Cloudflare's infrastructure. Cloudflare's public resolvers (1.1.1.1, 1.0.0.1) are **not** blocked.

**IXFR not incremental:** Sending `type: "IXFR"` via `/api/dns/query` sends an IXFR query packet, but IXFR responses are multi-message and may not parse correctly through the single-response reader. Use `/api/dns/axfr` for zone enumeration; it handles multi-message streams.

---

## Resources

- [RFC 1035 — Domain Names: Implementation and Specification](https://tools.ietf.org/html/rfc1035)
- [RFC 5936 — DNS Zone Transfer Protocol (AXFR)](https://tools.ietf.org/html/rfc5936)
- [RFC 4034 — DNSSEC Resource Records](https://tools.ietf.org/html/rfc4034)
- [RFC 6698 — DANE/TLSA](https://tools.ietf.org/html/rfc6698)
- [RFC 4255 — SSHFP](https://tools.ietf.org/html/rfc4255)
- [RFC 8659 — CAA](https://tools.ietf.org/html/rfc8659)
- [IANA DNS Parameters](https://www.iana.org/assignments/dns-parameters/)
- [zonetransfer.me](https://digi.ninja/projects/zonetransfer.php) — intentionally open AXFR test zone
