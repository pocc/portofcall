# DoT (DNS over TLS) — Power-User Reference

**Port:** 853 (default)
**Transport:** TLS over TCP (Cloudflare Workers `connect()` with `secureTransport: 'on'`)
**Implementation:** `src/worker/dot.ts`
**Route:** `POST /api/dot/query` (index.ts:1676)

Single endpoint. Sends one DNS query per TLS connection, parses the full response (answers + authority + additional), and tears down the connection. No connection reuse.

---

## Endpoint

### `POST /api/dot/query`

Send an encrypted DNS query to any DoT resolver.

**Request:**
```json
{
  "domain": "example.com",
  "type": "A",
  "server": "1.1.1.1",
  "port": 853,
  "timeout": 10000
}
```

| Field     | Required | Default     | Notes |
|-----------|----------|-------------|-------|
| `domain`  | Yes      | —           | Trailing dot stripped silently (`example.com.` → `example.com`). No total-length validation (RFC 1035 §2.3.4 limits to 253 chars). Individual labels capped at 63 chars. |
| `type`    | No       | `"A"`       | Case-insensitive, uppercased internally. See supported types below. |
| `server`  | No       | `"1.1.1.1"` | No host regex or format validation — any string is passed to `connect()`. |
| `port`    | No       | `853`       | Validated 1–65535. |
| `timeout` | No       | `10000`     | Capped at 30000 ms. Shared timer — covers TLS handshake + query + response read. |

**Supported record types:**

| Type  | Code | RDATA parsing |
|-------|------|---------------|
| A     | 1    | Dotted quad (`1.2.3.4`) |
| NS    | 2    | Domain name (compression-aware) |
| CNAME | 5    | Domain name (compression-aware) |
| SOA   | 6    | `mname rname serial` — **refresh/retry/expire/minimum omitted** |
| PTR   | 12   | Domain name (compression-aware) |
| MX    | 15   | `priority exchange` |
| TXT   | 16   | Character strings concatenated with no separator (follows RFC 7208 SPF semantics) |
| AAAA  | 28   | Full colon-separated hex — **no `::` compression** (e.g. `0:0:0:0:0:0:0:1` not `::1`) |
| SRV   | 33   | `priority weight port target` |
| ANY   | 255  | Returns whatever the server sends (many resolvers refuse or return minimal) |

Missing types: CAA (257), NAPTR (35), TLSA (52), HTTPS (65), DNSKEY (48), RRSIG (46), DS (43). Unknown types fall back to hex dump (first 64 bytes).

**Success response:**
```json
{
  "success": true,
  "encrypted": true,
  "protocol": "DoT (DNS over TLS)",
  "domain": "example.com",
  "server": "1.1.1.1",
  "port": 853,
  "queryType": "A",
  "rtt": 45,
  "connectTime": 32,
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
    {
      "name": "example.com",
      "type": "A",
      "typeCode": 1,
      "class": 1,
      "ttl": 3600,
      "data": "93.184.216.34"
    }
  ],
  "authority": [],
  "additional": []
}
```

**Error responses:**

| HTTP | Shape | Condition |
|------|-------|-----------|
| 405  | `{ error: "Method not allowed" }` | Non-POST request. **Note:** `success` field absent (inconsistent with other errors). |
| 400  | `{ success: false, error: "..." }` | Missing domain, invalid port, unknown record type. |
| 500  | `{ success: false, error: "..." }` | Connection timeout, TLS failure, truncated response (<14 bytes including 2-byte length prefix). |

---

## Wire Protocol

Each query follows this sequence:

```
Client                          DoT Server (:853)
  │                                  │
  │──── TLS ClientHello ────────────▶│
  │◀─── TLS ServerHello + Cert ─────│
  │──── TLS Finished ───────────────▶│
  │                                  │  ← connectTime measured here
  │──── [2-byte len][DNS query] ────▶│
  │◀─── [2-byte len][DNS response] ──│
  │──── close ──────────────────────▶│  ← rtt measured here
```

DNS payloads are framed with a 2-byte big-endian length prefix per RFC 1035 §4.2.2 (TCP DNS framing). The query packet always sets:
- Random 16-bit transaction ID (not verified in response)
- Flags: `0x0100` (standard query, recursion desired)
- QDCOUNT=1, ANCOUNT=NSCOUNT=ARCOUNT=0

---

## Known Quirks and Limitations

### Transaction ID not verified
`buildDNSQuery` generates a random 16-bit txid but `parseDNSResponse` never checks that the response txid matches. A poisoned or misdirected response would be accepted silently.

### No EDNS0 (RFC 6891)
The query has ARCOUNT=0 — no OPT pseudo-record is appended. This means:
- No signaling of larger payload sizes (responses may be truncated at 512 bytes on strict servers)
- No DNSSEC OK (DO) bit — cannot request DNSSEC validation
- Some modern resolvers may return smaller responses without EDNS0

### No SNI in TLS handshake
The `connect()` call passes `server:port` without specifying an SNI hostname. Servers that use SNI for certificate selection (e.g. `dns.google` at 8.8.8.8) may present a default certificate. For IP-addressed resolvers like `1.1.1.1` this doesn't matter, but for hostname-based servers it could cause TLS verification failures upstream.

### No ALPN "dot"
RFC 7858 §3.1 recommends ALPN token `"dot"` in the TLS handshake. This implementation doesn't set ALPN. Strict servers could reject the connection, though in practice most resolvers accept connections without ALPN.

### Shared timeout timer
A single `setTimeout` promise is created before `socket.opened` and reused for the read phase. If the TLS handshake takes 9.5s of a 10s timeout, only 0.5s remains for the DNS query+response. Worst case: total wall-clock time ≈ `timeout` (not `timeout` per phase).

### No connection reuse
RFC 7858 §3.4 recommends persistent connections for amortizing TLS overhead. This implementation opens a new TLS connection per query and closes it immediately. Each request pays full handshake cost (~30-80ms to nearby resolvers).

### SOA record incomplete
SOA RDATA parsing extracts only `mname`, `rname`, and `serial`. The four remaining 32-bit fields (refresh, retry, expire, minimum) are present in the wire data but not included in the `data` string.

### AAAA without :: compression
IPv6 addresses are rendered as 8 full colon-separated hex groups. `::1` appears as `0:0:0:0:0:0:0:1`. Valid but verbose — may not match expected output from tools like `dig`.

### TXT concatenation
Multiple character strings within a single TXT record are joined with empty string (`texts.join('')`). This matches RFC 7208 SPF semantics but hides string boundaries. A TXT record with strings `["v=spf1", " include:_spf.google.com ~all"]` appears as one string.

### No Cloudflare detection
Unlike most other protocol handlers, `handleDoTQuery` does not call `checkIfCloudflare()`. The `server` target is never checked against Cloudflare IP ranges.

### No server input validation
The `server` field has no regex or format validation. Any string (including hostnames, IPv6 addresses, or garbage) is passed directly to `connect()`. This is both flexible (allows hostnames like `dns.google`) and risky (no early failure for bad input).

### 405 response shape inconsistency
The `Method not allowed` response returns `{ error: "..." }` without `success: false`, unlike all other error paths which include `success: false`.

### DNS parser is a standalone copy
The DNS wire format parser (encode/build/parse functions) is duplicated from `dns.ts`. Bug fixes in one file won't propagate to the other.

### Name compression pointer safety
`parseDNSName` limits pointer-following to 128 iterations, preventing infinite loops from malicious compression pointers. Pointer chains across multiple jumps are handled correctly.

---

## Flags Reference

| Flag | Bit    | Meaning |
|------|--------|---------|
| `qr` | 0x8000 | Query (0) / Response (1) |
| `aa` | 0x0400 | Authoritative Answer |
| `tc` | 0x0200 | Truncated (response too large for transport) |
| `rd` | 0x0100 | Recursion Desired (always set in queries) |
| `ra` | 0x0080 | Recursion Available (set by recursive resolvers) |

## RCODE Reference

| Code | Name     | Meaning |
|------|----------|---------|
| 0    | NOERROR  | No error |
| 1    | FORMERR  | Format error (server couldn't parse query) |
| 2    | SERVFAIL | Server failure |
| 3    | NXDOMAIN | Domain does not exist |
| 4    | NOTIMP   | Not implemented |
| 5    | REFUSED  | Server refuses query |

RCODEs 6+ are not named — returned as `RCODE{n}`.

---

## curl Examples

**Basic A record query (Cloudflare):**
```bash
curl -s -X POST https://portofcall.app/api/dot/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com"}' | jq .
```

**MX records via Google DNS:**
```bash
curl -s -X POST https://portofcall.app/api/dot/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"gmail.com","type":"MX","server":"8.8.8.8"}' | jq .
```

**TXT records (SPF/DKIM/DMARC):**
```bash
curl -s -X POST https://portofcall.app/api/dot/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"_dmarc.gmail.com","type":"TXT","server":"9.9.9.9"}' | jq .
```

**AAAA (IPv6) via Quad9:**
```bash
curl -s -X POST https://portofcall.app/api/dot/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"google.com","type":"AAAA","server":"9.9.9.9"}' | jq .
```

**SOA record:**
```bash
curl -s -X POST https://portofcall.app/api/dot/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","type":"SOA"}' | jq .
```

**SRV record (e.g. XMPP):**
```bash
curl -s -X POST https://portofcall.app/api/dot/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"_xmpp-server._tcp.jabber.org","type":"SRV"}' | jq .
```

**Custom timeout (short, for latency testing):**
```bash
curl -s -X POST https://portofcall.app/api/dot/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","timeout":2000}' | jq '{rtt,connectTime}'
```

---

## Well-Known DoT Resolvers

| Provider    | Server          | Notes |
|-------------|-----------------|-------|
| Cloudflare  | `1.1.1.1`       | Default server. Also `1.0.0.1`. |
| Google      | `8.8.8.8`       | Also `8.8.4.4`. SNI: `dns.google`. |
| Quad9       | `9.9.9.9`       | Malware-blocking. Also `149.112.112.112`. |
| AdGuard     | `94.140.14.14`  | Ad-blocking DNS. |
| CleanBrowsing | `185.228.168.9` | Family/security filters. |

---

## vs DoH (`/api/doh/query`)

Both encrypt DNS. Key differences in this implementation:

| Aspect | DoT (`/api/dot/query`) | DoH (`/api/doh/query`) |
|--------|------------------------|------------------------|
| Transport | Raw TLS socket via `connect()` | HTTPS fetch to `/dns-query` |
| Port | 853 | 443 |
| Firewall visibility | Dedicated port — easy to block/detect | Blends with HTTPS traffic |
| Connection reuse | None (new TLS per query) | Depends on fetch() internals |
| Method restriction | POST only (405 on others) | Both GET and POST |
| EDNS0 | Not sent | Check DoH implementation |
| Cloudflare detection | None | Check DoH implementation |
