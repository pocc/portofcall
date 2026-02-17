# Protocol Documentation Reviews

## FTP — `src/worker/ftp.ts`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** deployed
**Implementation:** `src/worker/ftp.ts`

### What was there before

- `FTPClient` class with passive-mode connect, LIST, STOR, RETR, DELE, MKD, RMD, RNFR/RNTO, SIZE, PWD, QUIT
- `parseListingResponse()` parsed Unix-style LIST output for name, size, type, mtime only — discarded permissions, owner, group, link count, symlink targets; no DOS listing support
- No FEAT negotiation (couldn't discover server capabilities)
- No MLSD (machine-readable listing per RFC 3659)
- No MDTM (get modification time without downloading)
- No NLST (bare name list)
- No SITE command passthrough
- `list()` had no `useMlsd` option

### Changes made

1. **Extended `FTPFile` interface** — added `permissions` (rwxr-xr-x), `links`, `owner`, `group`, `target` (symlink target), `facts` (raw MLSD key→value map); `type` now includes `'link'` and `'other'` (block devices, sockets, pipes) in addition to `'file'` and `'directory'`

2. **`FTPFeatures` interface + `feat()` method (RFC 2389)** — sends `FEAT`, parses the multi-line 211 response into a structured object with boolean flags: `mlsd`, `mdtm`, `size`, `utf8`, `tvfs`, `rest`, plus `raw` string array for the complete feature list

3. **`mdtm()` method (RFC 3659)** — sends `MDTM <path>`, parses the `YYYYMMDDHHmmss` response into an ISO 8601 UTC timestamp string

4. **`stat()` method** — issues SIZE and MDTM in parallel, returns `{ size, modified }` without initiating a data connection or file transfer

5. **`mlsd()` method (RFC 3659)** — opens a passive data connection, sends `MLSD`, reads the response, and parses each `fact1=val1;fact2=val2; name` line into `FTPFile` objects with ISO 8601 `modified` times and all available facts stored in the `facts` map

6. **`nlst()` method** — `NLST [path]` bare filename list; returns `string[]`

7. **`site()` method** — raw `SITE <command>` passthrough, returns the server's response string; lets power users issue `SITE CHMOD 755 /path`, `SITE CHOWN user:group /path`, etc.

8. **Enhanced `list()` with `useMlsd` param** — when `useMlsd=true`, tries `mlsd()` first and falls back to `LIST` on error (e.g. server doesn't support MLSD or refuses it)

9. **Enhanced `parseListingResponse()`** — now extracts full Unix metadata (permissions string minus leading type char, link count, owner, group, symlink target after ` -> `); handles DOS/Windows-style listings (`MM-DD-YY  HH:MMAM  <DIR>  name`); maps first permission char to `'directory'`, `'link'`, `'other'`, `'file'`

10. **New handlers** added to `src/worker/index.ts`:
    - `POST/GET /api/ftp/feat` — FEAT negotiation
    - `POST/GET /api/ftp/stat` — SIZE + MDTM without transfer
    - `POST/GET /api/ftp/nlst` — bare name list
    - `POST  /api/ftp/site` — SITE command passthrough

11. **`handleFTPList` updated** — accepts `mlsd: true` in POST body or `?mlsd=true` query param; returns `mode: 'mlsd' | 'list'` in response

### Power User Notes

- **MLSD vs LIST**: MLSD is strongly preferred when the server supports it (check via `/api/ftp/feat` first). It gives machine-readable timestamps in ISO format, standardised fact names, and avoids the ambiguity of LIST's free-form output.
- **Stat without download**: Use `/api/ftp/stat` to check file size and mtime before deciding whether to download. Much faster than initiating a data connection.
- **SITE CHMOD**: Not all servers support it; response code 200 = success, 202 = not implemented, 500 = error. The `site()` method returns the raw response string so you can distinguish these.
- **Anonymous FTP**: Pass `username: 'anonymous'` and any email-format string as password per RFC 1635.

## WHOIS — `docs/protocols/WHOIS.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** deployed
**Implementation:** `src/worker/whois.ts`

### What was in the original doc

`docs/protocols/WHOIS.md` was a pre-implementation planning document titled "WHOIS Protocol Implementation Plan". It contained a fictional `WhoisClient` TypeScript class at a nonexistent path, a React `WhoisLookup` component, a `DomainAvailability` checker component, pseudocode caching and rate-limiting stubs (with a KV TTL variable and a `WHOIS_RATE_LIMIT` constant), a `/api/whois/availability` batch endpoint that does not exist, and a "Next Steps" section. The two actual API endpoints were entirely absent.

### What was improved

Replaced with an accurate endpoint reference. Key additions:

1. **Two-endpoint structure** — documented `POST /api/whois/lookup` (domain) and `POST /api/whois/ip` (IP/ASN/CIDR) with exact request/response JSON, field defaults, and all response shapes including partial failures.

2. **`port` field gotcha** — `/lookup` accepts `port` in its body type but `doWhoisQuery` hardcodes `:43`; the field is silently ignored. Documented explicitly.

3. **TLD routing table** — full 38-entry table with all TLD→server mappings, 2-part TLD priority logic (e.g. `co.uk` before `uk`), and `whois.iana.org` fallback.

4. **RIR routing heuristics** — IPv4 first-octet ranges for RIPE/APNIC/LACNIC/AFRINIC, IPv6 `2001:` block parsing, ARIN as default (issues `ReferralServer:` for non-ARIN resources).

5. **Referral chasing** — documented all 5 `extractReferralServer()` patterns in priority order, `whois://` prefix stripping, self-referral prevention, and HTTP-value rejection. Clarified that each query (registry + referral) gets the full `timeout` independently (worst case 2× timeout).

6. **200 KB cap** — `IMPLEMENTED.md` says 100 KB; actual code uses `200_000` bytes. Corrected.

7. **`parsed` field precedence** — `referralResponse || registryResponse` means referral data wins when available.

8. **Parsed field catalog** — documented all 24 field mappings, multi-value fields (`status`, `nameServers`, `asnNumber` always arrays), GDPR filtering (`"REDACTED FOR PRIVACY"` and `https://icann.org` values dropped), deduplication via `Set`.

9. **ASN detection quirk** — bare integers less than 400,000 are auto-detected as ASNs and normalized to `AS{n}` format before querying ARIN.

10. **Per-endpoint timeout defaults** — `/lookup` defaults to 10,000 ms; `/ip` defaults to 15,000 ms. Documented both.

11. **Cloudflare detection** — both endpoints call `checkIfCloudflare()` before connecting; returns HTTP 403 with `isCloudflare: true` if the WHOIS server resolves to a Cloudflare IP.

12. **UTF-8 with replacement** — `TextDecoder('utf-8', { fatal: false })`; malformed bytes produce U+FFFD in output.

---

## Thrift — `docs/protocols/THRIFT.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 16/16 tests passing
**Implementation:** `src/worker/thrift.ts`
**Tests:** `tests/thrift.test.ts`

### What was in the original doc

`docs/protocols/THRIFT.md` was titled "Apache Thrift Protocol Implementation Plan" and contained a fictional `ThriftClient` TypeScript class with `connect()`/`call()`/`close()` methods, `ThriftConfig`/`ThriftField`/`ThriftStruct` interfaces, a React `ThriftClient` component with service dropdown, and sample Thrift IDL — none of which exist. The two actual Worker endpoints were entirely absent.

### What was improved

Replaced the planning doc with an accurate endpoint reference. Key additions:

1. **Two-endpoint structure** — documented `POST /api/thrift/probe` and `POST /api/thrift/call` with exact request/response JSON, field tables, and defaults.

2. **Binary Protocol wire format** — documented the `versionAndType` header (`0x80010000 | messageType`), method name as 4-byte-length-prefixed UTF-8, seqId, and struct encoding (type + field id + value + T_STOP).

3. **Framed vs. buffered transport** — framed prepends a 4-byte big-endian frame length; buffered sends raw. Detection: any `transport` value that is not exactly `"buffered"` uses framed. Buffered read is a single `reader.read()` call with no completeness guarantee.

4. **`/call` arg type table** — documented all supported `type` strings (`bool`, `byte`/`i8`, `i16`, `i32`, `i64`, `double`, `string`), encoding behavior, and the fallback-to-string for unknown types. Complex types (LIST, MAP, SET, STRUCT) cannot be sent via REST args.

5. **Key parser limitations** — T_STRUCT offset hardcoded to +100 bytes (breaks structs >100 bytes); LIST/MAP/SET capped at 20 items; T_VOID (type 1) unrecognized; seqId always 1 (not validated); frame cap 1 MB; all field values returned as strings.

6. **Application exception format** — documented the EXCEPTION message type, `exceptionMessage` field, and exception type code table (UNKNOWN_METHOD, PROTOCOL_ERROR, etc.).

## SMB — `docs/protocols/SMB.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 10/10 tests passing
**Implementation:** `src/worker/smb.ts`
**Tests:** `tests/smb.test.ts`

### What was in the original doc

`docs/protocols/SMB.md` was titled "SMB Protocol Implementation Plan" and contained aspirational pseudocode: an `SMBClient` TypeScript class, `SMBConfig`/`SMBShare`/`FileInfo` interfaces, a React `SMBClient` component with file browser UI, and stub packet builders (`buildNegotiateRequest`, `buildSessionSetupRequest`, `buildTreeConnectRequest`, etc.) with placeholder `return new Uint8Array(32)` bodies — none of which exist. The actual five Worker endpoints were entirely absent.

### What was improved

Replaced the planning doc with an accurate endpoint reference. Key additions:

1. **Five-endpoint structure** — documented `GET|POST /api/smb/connect`, `POST /api/smb/negotiate`, `POST /api/smb/session`, `POST /api/smb/tree`, and `POST /api/smb/stat` with exact request/response JSON, field tables, and defaults.

2. **NetBIOS session framing** — documented the 4-byte NetBIOS session header (type=0x00, 3-byte big-endian length) that wraps every packet, 65536-byte `readResponse` cap, and 5 s per-step inner timeouts.

3. **Anonymous null-session NTLMSSP** — documented the three-round SESSION_SETUP exchange (NEGOTIATE → NTLMSSP_NEGOTIATE → NTLMSSP_AUTHENTICATE empty), SPNEGO NegTokenInit/NegTokenResp wrapping, NTLM_FLAGS=0x60088215, single-round shortcut path.

4. **Capability and security mode flag tables** — 7 capability bits (DFS through Encryption) and 2 security mode bits (SigningEnabled, SigningRequired) with numeric values.

5. **Windows FILETIME conversion** — `(ftHigh * 4294967296 + ftLow) / 10000 - 11644473600000` formula; `/stat` uses integer arithmetic, `/negotiate` uses floating-point (mild precision difference).

6. **`/stat` internals** — CREATE DesiredAccess=0x00120080 (READ_ATTRIBUTES|SYNCHRONIZE), CreateDisposition=FILE_OPEN, FileId at packet offset 132, QUERY_INFO FileBasicInformation, CLOSE fire-and-forget. Common NTSTATUS codes from CREATE failure (ACCESS_DENIED, OBJECT_NAME_NOT_FOUND, OBJECT_PATH_INVALID).

7. **Key gotchas** — `sessionId` truncated to 32 bits; `/connect` has no port validation; SMB1 fallback only in `/negotiate`; default share differs (`/tree`=IPC$ vs `/stat`=C$); `fileAttributes` padded to 4 hex digits; signing advertised but not enforced; no credential auth.

## IMAP — `docs/protocols/IMAP.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 17/17 tests passing
**Implementation:** `src/worker/imap.ts`
**Tests:** `tests/imap.test.ts`

### What was in the original doc

`docs/protocols/IMAP.md` was titled "IMAP Protocol Implementation Plan" and contained aspirational pseudocode: a full `IMAPClient` TypeScript class, `IMAPConfig`/`IMAPMailbox`/`IMAPMessage` interfaces, and a React `IMAPClient` component with sidebar folder tree and message viewer — none of which exist in the codebase. The four actual Worker endpoints were entirely absent. The doc ended with a "Next Steps" list.

### What was improved

Replaced the planning doc with an accurate endpoint reference. Key additions:

1. **Four-endpoint structure** — documented `GET|POST /api/imap/connect`, `POST /api/imap/list`, `POST /api/imap/select`, and `GET /api/imap/session` (WebSocket) with exact request/response JSON, field tables, and defaults.

2. **Tag sequence tables** — the connect handler uses hardcoded tags A001 (LOGIN), A002 (CAPABILITY), A003 (LOGOUT); list and select handlers use A001/A002/A003 for their three commands. The session starts from A003 and increments monotonically.

3. **`capabilities` raw response gotcha** — the connect endpoint's `capabilities` field contains the entire raw CAPABILITY response including the `* CAPABILITY` prefix line and `A002 OK` completion line, not a parsed list. The session endpoint correctly strips to keywords only.

4. **Greeting timeout difference** — connect handler has a dedicated 5 s inner greeting timeout; list and select handlers read the greeting under only the outer wall-clock timeout.

5. **LIST parser regex limitation** — the `* LIST` response parser only matches double-quoted delimiter and mailbox name: `\* LIST \([^)]*\) "([^"]*)" "([^"]*)"/`. Servers returning `NIL` delimiter or unquoted names silently drop those mailboxes.

6. **SELECT fields not extracted** — only `EXISTS` and `RECENT` are parsed from SELECT responses. `UNSEEN`, `UIDVALIDITY`, `UIDNEXT`, `FLAGS`, and `PERMANENTFLAGS` are not extracted. Documented workaround: use `STATUS` via session.

7. **SELECT vs EXAMINE** — SELECT opens read-write and clears `\Recent`; EXAMINE (read-only) is not available via HTTP endpoints, only via session raw commands.

8. **No STARTTLS or IMAPS** — port 993 accepted but TLS never negotiated; times out at the 5 s greeting read waiting for `* OK` that never arrives.

9. **LOGIN only, no SASL AUTHENTICATE** — `LOGINDISABLED` servers will reject the LOGIN; the implementation never fetches pre-auth capabilities to check.

10. **IDLE not supported in session** — IDLE returns `+ idling` (continuation), not a tagged completion. `readIMAPResponse` waits for the tag and times out after 30 s.

11. **Session message protocol** — both directions fully documented: `connected` (with parsed capability keywords), `response` (raw tagged response), `error`; and browser→worker `command` (raw IMAP command without tag).

12. **Mailbox name quoting** — the implementation interpolates `mailbox` directly into `SELECT ${mailbox}`; callers must quote names containing spaces themselves.

13. **curl examples and JavaScript WebSocket example** — runnable code for all four endpoints.

---

## WHOIS — `src/worker/whois.ts`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed
**Endpoints before:** `POST /api/whois/lookup`
**Endpoints after:** `POST /api/whois/lookup`, `POST /api/whois/ip`

### What was reviewed

The WHOIS implementation connected to the right WHOIS server (20-entry TLD routing table) and returned the raw text response. It had no structured field parsing, no referral chasing, and rejected IP addresses at the validation layer (`/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?/` regex). A power user looking up a domain would get a wall of text with no extractable dates or nameservers; a power user looking up an IP address couldn't use this endpoint at all.

### Changes made

#### 1. Structured field parsing

Added `parseWhoisFields()` which walks every line of the WHOIS response and extracts 20 key fields:

| Field | WHOIS line variants handled |
|-------|----------------------------|
| `registrar` | Registrar:, Registrar Name:, registrar: |
| `creationDate` | Creation Date:, Created Date:, created:, registered: |
| `updatedDate` | Updated Date:, last-modified:, changed: |
| `expiryDate` | Registry Expiry Date:, Expiry Date:, expires:, paid-till: |
| `status` | Domain Status:, status: (multi-value, deduplicated) |
| `nameServers` | Name Server:, nserver: (multi-value, deduplicated) |
| `dnssec` | DNSSEC:, dnssec: |
| `registrant` | Registrant Name:, Registrant Organization:, holder: |
| `netRange` | NetRange:, inetnum:, inet6num: |
| `cidr` | CIDR:, route:, route6: |
| `netName` | NetName:, netname: |
| `orgName` | OrgName:, org-name:, Organization: |
| `country` | Country:, country: |
| `asnNumber` | OriginAS:, origin: |
| `asnName` | ASName:, as-name: |

The parsed fields are returned in the `parsed` object alongside the full raw `response` text.

#### 2. Referral chasing for domain lookups (`followReferral: true` by default)

IANA and Verisign (`.com`, `.net`) return thin "registry" responses with a `WHOIS Server:` line pointing to the registrar's server where the actual registrant data lives. Without chasing this referral, you get the raw registry record which contains almost no useful information.

`handleWhoisLookup` now:
1. Queries the registry WHOIS server (unchanged)
2. Extracts `Registrar WHOIS Server:` / `WHOIS Server:` / `Refer:` from the response
3. Queries the registrar server if different from the registry server
4. Returns both responses plus `parsed` fields extracted from the registrar response (which has the complete data)

The `referral` object in the response includes the server name, raw response, and timing:
```json
{
  "referral": {
    "server": "whois.MarkMonitor.com",
    "response": "...",
    "queryTimeMs": 312
  }
}
```

#### 3. New endpoint: `POST /api/whois/ip` for IP/ASN/CIDR queries

Handles IPv4, IPv6, CIDR blocks, and ASNs with automatic RIR routing:

**RIR routing logic:**
- RIPE: RFC-1918-adjacent, European prefixes (77-95, 151-185, 193-217 roughly)
- APNIC: Asia-Pacific prefixes (1, 27, 36, 42, 49, 58-61, 101-126, etc.)
- LACNIC: Latin American prefixes (177-191)
- AFRINIC: African prefixes (41, 102, 105, 154, 196, 197, 198)
- ARIN: Default (US/Canada + redirects to correct RIR via `ReferralServer:`)

**Query formats accepted:**
- `1.1.1.1` → IPv4, routes to APNIC
- `8.8.8.8` → IPv4, routes to ARIN
- `2001:db8::1` → IPv6
- `192.0.2.0/24` → CIDR block
- `AS15169` or `15169` → ASN, routes to ARIN (which follows up)

**Referral chasing:** ARIN's response for non-ARIN IPs includes `ReferralServer: whois://whois.ripe.net` — the handler follows this automatically to get the authoritative RIR record.

#### 4. Extended TLD table

Added 20 more TLD→server mappings: `io`, `ai`, `app`, `dev`, `co`, `nl`, `it`, `es`, `pl`, `ch`, `se`, `no`, `fi`, `dk`, `eu`, `asia`, `mobi`, `tel`, `name`, `pro`.

### Power User Notes

- `followReferral: false` disables the second query, halving latency when you only need the registry record (e.g., to check EPP status codes without needing registrant data)
- REDACTED FOR PRIVACY values (GDPR-compliant registries) are silently dropped from `parsed` fields — check the raw `response` for the privacy proxy contact link
- The `status` field returns an array of EPP status codes; `clientTransferProhibited` is the most common; `serverDeleteProhibited + serverTransferProhibited + serverUpdateProhibited` together indicate a registry lock
- For IP lookups, the `parsed.country` and `parsed.netName` fields are the fastest way to attribute a block to an organization without reading the full WHOIS text

## POP3 — `docs/protocols/POP3.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 18/18 tests passing

### What was in the original doc

`docs/protocols/POP3.md` was titled "POP3 Protocol Implementation Plan" and contained aspirational pseudocode: a `POP3Client` class and a React `POP3MailboxViewer` component — none of which exist in the codebase. The six actual Worker endpoints were entirely absent.

### What was improved

Replaced the planning doc with an accurate endpoint reference. Key additions:

1. **Six-endpoint structure** — documented `GET|POST /connect`, `POST /list`, `POST /retrieve`, `POST /dele`, `POST /uidl`, `GET|POST /capa`, and `POST /top` with required/optional field tables and exact response JSON.

2. **`capabilities` field bug documented** — the connect endpoint's `capabilities` response field is actually the raw PASS `+OK` response (e.g., `+OK Logged in.`), not CAPA output. Named misleadingly; use `/capa` for actual capability strings.

3. **`msgnum` vs `messageId` inconsistency** — `/retrieve` uses `messageId`; `/dele`, `/top`, and `/uidl` response use `msgnum`; `/list` response uses `id`. All refer to the same POP3 session-local ordinal. Documented with a comparison table.

4. **`readPOP3Response` vs `readPOP3MultiLine` distinction** — documented both primitives, termination conditions, which commands use each, and the single-line leak risk (if multiple response lines arrive in one TCP segment, only the first is consumed by the single-line reader).

5. **Dot-unstuffing not implemented** — RFC 1939 requires leading `..` to be un-escaped to `.` in multi-line wire responses. The implementation does not do this; body lines starting with `.` arrive corrupted from `/retrieve`.

6. **DELE commit semantics** — DELE marks a message; deletion is committed on QUIT during UPDATE state. The endpoint sends QUIT immediately, so deletion is committed. `success: true` reflects DELE +OK, not QUIT completion — a network drop between DELE and QUIT rolls back the deletion.

7. **No TLS** — port 995 is accepted but times out at the 5 s greeting read because TLS is never negotiated.

8. **CAPA capability table** — reference table of 9 common capabilities (TOP, UIDL, USER, SASL, STLS, PIPELINING, RESP-CODES, AUTH-RESP-CODE, EXPIRE) with RFC numbers and meanings.

9. **TOP command** — entirely undocumented; added full spec including `lines: 0` for headers-only per RFC 2449.

10. **Unimplemented features listed** — APOP, SASL AUTH, STLS, dot-unstuffing, RSET, NOOP, single-message UIDL/LIST.

11. **curl examples** — nine one-liners covering all six endpoints including GET form, `jq` field extraction, and message preview via TOP.

---

## DNS — `src/worker/dns.ts`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed
**Endpoint before:** `POST /api/dns/query`
**Endpoints after:** `POST /api/dns/query`, `POST /api/dns/axfr`

### What was reviewed

The DNS implementation supported standard record types (A, AAAA, CNAME, MX, TXT, NS, SOA, PTR, SRV, ANY) with full TCP framing, query building, and response parsing including compression pointers, authority, and additional sections. It was well-written but missing two things a power user would immediately notice:

1. **No AXFR zone transfer** — the primary tool for DNS administrators auditing a zone or security researchers testing for misconfigured authoritative servers.
2. **No DNSSEC/security record types** — DNSKEY, DS, RRSIG, NSEC, NSEC3, TLSA, CAA, SSHFP, and others were not recognized; queries for them returned raw hex instead of structured data.

### Changes made

#### 1. Added 16 new record type codes

Extended `DNS_RECORD_TYPES` with all DNSSEC and modern DNS record types:
- DNSSEC chain: `DNSKEY (48)`, `DS (43)`, `RRSIG (46)`, `NSEC (47)`, `NSEC3 (50)`, `NSEC3PARAM (51)`, `CDS (59)`, `CDNSKEY (60)`
- Security: `TLSA (52)` (DANE), `SSHFP (44)`, `CAA (257)`, `OPENPGPKEY (61)`
- Modern: `SVCB (64)`, `HTTPS (65)`, `NAPTR (35)`
- Transfer: `AXFR (252)`, `IXFR (251)`

#### 2. Added structured parsers for all new record types

Each new type now produces a human-readable data string rather than raw hex:

- **CAA**: `flags tag "value"` (e.g., `0 issue "letsencrypt.org"`)
- **DNSKEY/CDNSKEY**: key flags decoded as `ZSK`/`KSK`/`SEP`, algorithm number, base64 pubkey (truncated for display)
- **DS/CDS**: `keyTag algorithmName digestTypeName hexDigest` (algorithm 8=RSASHA256, 13=ECDSAP256SHA256, 15=ED25519, etc.)
- **RRSIG**: `coveredType algo=N labels=N keyTag=N signer=name expires=YYYY-MM-DD`
- **NSEC**: `nextName (TYPE1 TYPE2 ...)` — full type bitmap walk
- **NSEC3**: `hashAlgo=N iterations=N salt=hex [opt-out]`
- **TLSA**: `PKIX-TA/PKIX-EE/DANE-TA/DANE-EE Cert/SPKI Full/SHA-256/SHA-512 hexdata...`
- **SSHFP**: `RSA/DSA/ECDSA/Ed25519 SHA-1/SHA-256 hexfingerprint`
- **NAPTR**: `order pref "flags" "services" "regexp" replacement`
- **SVCB/HTTPS**: `priority target`

#### 3. Added AXFR zone transfer handler: `POST /api/dns/axfr`

```json
{ "zone": "example.com", "server": "ns1.example.com", "port": 53, "timeout": 30000, "maxRecords": 50000 }
```

Returns:
```json
{
  "success": true,
  "zone": "example.com",
  "server": "ns1.example.com",
  "soaSerial": 2024010101,
  "recordCount": 1234,
  "typeSummary": { "A": 400, "AAAA": 200, "MX": 5, "TXT": 50, "CNAME": 579 },
  "messageCount": 47,
  "transferTimeMs": 812,
  "complete": true,
  "records": [...]
}
```

AXFR protocol implementation details (RFC 5936):
- Sends DNS query with `QTYPE=252` (AXFR) and `RD=0` (no recursion — authoritative transfer)
- Reads a stream of TCP-framed DNS messages until the second SOA record is received
- Checks RCODE in the first response message and surfaces `REFUSED`/`NOTAUTH`/`NXDOMAIN` as a clear error
- Tracks SOA serial from the opening SOA for change detection workflows
- Returns `typeSummary` for quick zone composition overview
- `complete: false` if the stream ended before the closing SOA (truncated transfer or timeout)
- Configurable via `maxRecords` (up to 100,000) and `timeout` (up to 60s)

### Power User Notes

AXFR is refused by most public authoritative servers by default — it requires `allow-transfer { your-ip; }` in BIND/NSD/PowerDNS configuration. When refused, the response is `{ success: false, error: "Zone transfer refused: REFUSED" }`.

When a zone transfer succeeds, the `records` array contains every DNS record parsed with the same type-aware parser used by the regular query endpoint, so DNSSEC-signed zones return structured DNSKEY/RRSIG/DS/NSEC records.

The `soaSerial` field enables change detection: poll with AXFR and compare serials to detect zone updates without fetching all records.

---

## MQTT — `docs/protocols/MQTT.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 13/13 tests passing

### What was in the original doc

`docs/protocols/MQTT.md` was an **implementation plan** document headed "MQTT Protocol Implementation Plan". It described the MQTT pub/sub model with tutorial-level diagrams and a full theoretical `MQTTClient` class and React component that don't exist in the codebase. None of the three actual Worker endpoints were documented.

### What was improved

Replaced the planning doc with an accurate power-user API reference:

1. **Three-endpoint structure** — documented `GET|POST /api/mqtt/connect`, `POST /api/mqtt/publish`, and `GET /api/mqtt/session` (WebSocket) with exact request/response shapes, field tables, and defaults.

2. **CONNACK return codes** — all five codes (1–5) with their exact string messages as surfaced in the error field.

3. **WebSocket message protocol** — both directions documented completely: all `type` values Worker→browser (`connected`, `subscribed`, `unsubscribed`, `message`, `published`, `puback`, `pong`, `error`) and browser→Worker (`publish`, `subscribe`, `unsubscribe`, `ping`, `disconnect`), with field details and JSON examples with inline comments.

4. **messageId = 1 hardcoded** in HTTP publish (versus incrementing counter in session).

5. **`published` event is pre-PUBACK** — fires after the PUBLISH write, not after PUBACK arrives; documented alongside the separate `puback` event to watch for QoS 1 delivery confirmation.

6. **Credentials in WebSocket URL** — username/password appear as query params, visible in access logs and browser history; noted with a recommendation to use scoped/read-only credentials.

7. **`grantedQoS: 0x80`** — broker subscription refusal byte documented (permissions failure).

8. **QoS 2 downgrade** — silently capped to 1 (`Math.min(qos, 1)`); PUBREC/PUBREL/PUBCOMP received but not acted on.

9. **CONNACK single-read gotcha** — `mqttConnect` calls `reader.read()` exactly once; split TCP segment would cause "Expected CONNACK" error; noted with practical risk assessment.

10. **LWT limitations** — will QoS and retain are not configurable via the session endpoint's query params despite being present in the TypeScript interface; will is always QoS 0, retain off.

11. **Binary payload limitation** — TextDecoder used throughout; binary MQTT payloads are corrupted; encode as base64.

12. **keepAlive sent but not enforced** — CONNECT sends keepAlive=60 but no PINGREQ timer runs in any handler; use `{ type: 'ping' }` manually for long-lived sessions.

13. **Wire format reference** — remaining-length encoding sizes, CONNECT flags byte bit layout, PUBLISH fixed-header flags, and full packet type table (including QoS 2 types and their unhandled status).

14. **Persistent session details** — what `sessionPresent: true` means, when to re-send subscribe messages.

15. **curl examples + JavaScript WebSocket example** — complete working code for all three endpoints.

---

## Redis — `docs/protocols/REDIS.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 17/17 tests passing

### What was reviewed

The existing `docs/protocols/REDIS.md` was an **implementation plan** document predating the actual code. It described a `RESPParser` class architecture and a WebSocket message protocol that differed from what was actually shipped in `src/worker/redis.ts`.

### Changes made

The document was replaced/updated with an accurate reference for a reader who already knows Redis:

1. **Removed planning language** — stripped "Implementation Plan" framing, `RESPParser` class pseudocode, and "Next Steps" list (all completed).

2. **Accurate endpoint documentation** — documented the three real endpoints (`/api/redis/connect`, `/api/redis/command`, `/api/redis/session`) with correct request/response schemas, including the GET form for `/api/redis/connect`.

3. **Correct WebSocket message protocol** — the plan doc had `{ command, args }` as the message format; the actual implementation uses `{ type: 'command', command: string[] }`. Updated to reflect reality.

4. **Response formatting table** — documented exactly how `formatRESPResponse()` renders each RESP type, including the known limitation that nested arrays fall back to raw RESP output.

5. **Known Limitations section** — documented for power users who need to know failure modes:
   - Single-read response parsing (may truncate very large multi-read responses)
   - Binary values corrupted by TextDecoder
   - AUTH only supports single-argument form (no ACL username)
   - No pipelining in HTTP mode
   - No TLS support
   - No Sentinel / Cluster topology awareness

6. **Auth sequence diagram** — shows the exact wire exchange with AUTH, SELECT, and PING responses including Redis error codes (`-WRONGPASS`, `-NOAUTH`).

7. **Practical curl examples** — runnable one-liners for common operations.

8. **WebSocket session JavaScript example** — minimal working browser code.

9. **Power User Tips section** — added reference material for advanced use:
   - SCAN vs KEYS * (keystore safety)
   - INFO section reference table
   - ACL user auth workaround
   - OBJECT ENCODING for memory diagnosis
   - WAIT for write durability confirmation
   - MEMORY USAGE, OBJECT FREQ/IDLETIME, SLOWLOG, LATENCY HISTORY, COMMAND DOCS

---

## MQTT — `docs/protocols/MQTT.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 13/13 tests passing
**Implementation:** `src/worker/mqtt.ts`
**Tests:** `tests/mqtt.test.ts`

### What was reviewed

`docs/protocols/MQTT.md` was an **implementation plan** document describing aspirational pub/sub architecture. It did not document the three actual endpoints (`/api/mqtt/connect`, `/api/mqtt/publish`, `/api/mqtt/session`), the WebSocket message protocol, or any limitations.

### Changes made

The document was replaced with an accurate power-user reference. Key additions:

1. **Three-endpoint reference** — exact request/response schemas for `/connect`, `/publish`, and `/session`, including all optional fields and their defaults.

2. **CONNACK return code table** — mapped broker refusal codes 1–5 to their human-readable messages as surfaced in the error string.

3. **`sessionPresent` semantics** — explained what CONNACK bit 0 means and when to act on it (re-subscribe if `false` after `cleanSession=false` reconnect).

4. **QoS handling table** — documented that QoS 2 is silently downgraded to QoS 1, and that inbound PUBREC/PUBREL/PUBCOMP packets are received but not processed.

5. **Full WebSocket message protocol** — all 9 worker→browser message types and 5 browser→worker types with exact JSON shapes, including the `grantedQoS` array meaning (0x80 = subscription refused), `dup` flag semantics, and the fact that `published` fires pre-PUBACK.

6. **Message ID counter semantics** — starts at 1, wraps at 0xFFFF, skips 0, shared across publish/subscribe/unsubscribe within a session.

7. **LWT limitations** — `willTopic`/`willPayload` supported in session, but will QoS and will retain are not configurable (fixed at QoS 0, retain=false). HTTP connect probe has no LWT support at all.

8. **Known Limitations** — no TLS, no MQTT 5.0, no QoS 2, binary payload corruption via TextDecoder, CONNACK single-read (throws on high-latency split CONNACK), credentials visible in WebSocket URL/access logs, `published` event is pre-PUBACK.

9. **Wire format reference** — remaining length encoding, CONNECT flags byte, PUBLISH flags nibble, and packet type/hex table for all 14 MQTT 3.1.1 packet types (noting SUBSCRIBE/UNSUBSCRIBE/PUBREL reserved flag bits).

10. **curl examples and JavaScript session example** — runnable code for all three endpoints, including a full session lifecycle with subscribe, message handling, publish, ping, and graceful disconnect.

11. **Public test brokers table** — Mosquitto, HiveMQ, and EMQX public endpoints with privacy warning.

12. **Persistent sessions** — explained `cleanSession=false` semantics, session resumption pattern, and broker queue limits.

---

## Docker Engine API — 2026-02-17

**Protocol:** Docker Engine API (HTTP/REST over raw TCP or HTTPS)
**File reviewed:** `docs/protocols/DOCKER.md`
**Implementation:** `src/worker/docker.ts`
**Tests:** `tests/docker.test.ts` (14 passing)

### What was wrong with the original doc

The original `DOCKER.md` was a planning document containing:
- A fictitious `DockerClient` TypeScript class using direct `fetch()` calls, which cannot work for port 2375 in Workers (Workers can't `fetch()` arbitrary non-Cloudflare TCP ports)
- A React `DockerDashboard` component sketch with no relation to the actual endpoints
- A security section with `tlsVerify`, `tlsCert`, `tlsKey`, `tlsCa` config fields that don't exist
- No mention of the six actual API endpoints
- No documentation of Docker's log multiplexing binary format, the exec two-step protocol, chunked TE handling, or the 512 KB response cap

### What was improved

The rewritten doc targets a power user who knows Docker and wants an accurate reference for this specific implementation:

1. **Dual transport architecture** — Documented why port 2375 uses raw TCP (`connect()` from `cloudflare:sockets`) while port 2376 uses native `fetch()`. This is the single most important thing for understanding why the code exists at all.

2. **No auto API versioning** — The implementation does not prepend `/v1.43/` to paths. This is undocumented and trips users who expect SDK-style version management. Documented explicitly with the instruction to include the prefix manually when needed.

3. **All six endpoints documented** with full request/response JSON schemas:
   - `/api/docker/health` — ping + version + trimmed info (13 specific fields, not the full payload)
   - `/api/docker/query` — arbitrary TCP HTTP request
   - `/api/docker/tls` — arbitrary HTTPS request
   - `/api/docker/container/create` — container creation with cmd/env overrides
   - `/api/docker/container/start` — with 204 vs 304 semantics table
   - `/api/docker/container/logs` — with binary multiplexing format documentation
   - `/api/docker/exec` — with two-step protocol (create → start) documented

4. **Docker log multiplexing format** — Documented the 8-byte binary frame header (`stream_type[1B] + zeros[3B] + size[4B BE]`), the stream type values (1=stdout, 2=stderr), and the TTY caveat (TTY containers don't use this framing and will produce garbled output from the parser).

5. **Container start status codes** — Added a table showing 204 (started), 304 (already running), 404, 409, 500 and their effect on `success`, `started`, and `alreadyRunning` fields. The 304-is-success behavior is non-obvious.

6. **Exec two-step protocol** — Documented the two API calls (POST `/containers/{id}/exec` → 201, then POST `/exec/{id}/start` → 200/204), the exact request bodies, the shared multiplexing parser, the 30 s default timeout, and the lack of exit code.

7. **Response size limits table** — Compared TCP vs HTTPS paths across all endpoints: 512 KB for most TCP paths, 1 MB for the logs TCP path, Workers-runtime-limit for HTTPS paths.

8. **Common Docker API paths** — Added a reference table of 20 frequently-used paths with method and notes.

9. **curl quick-reference** — Complete set of copy-paste examples covering health, container listing, inspect, stats, create/start/logs/exec, stop, and TLS.

10. **What is NOT implemented** — Documented API version prefixing, timestamp stripping, TTY logs, exec exit codes, streaming, mTLS client certs, image operations, volume/network CRUD.

---

## SMTP — 2026-02-17

**Protocol:** SMTP / SMTPS / Message Submission
**File reviewed:** `docs/protocols/SMTP.md`
**Implementations:** `src/worker/smtp.ts`, `src/worker/submission.ts`, `src/worker/smtps.ts`
**Tests:** `tests/smtp.test.ts`, `tests/smtps.test.ts`

### What was wrong with the original doc

The original `SMTP.md` covered only one of the three actual implementations, and even that coverage was fictitious:

- Described a single `SMTPClient` TypeScript class, `SMTPConfig`/`EmailMessage` interfaces, and a React `SMTPEmailComposer` component — none of which exist in the codebase
- Showed a STARTTLS flow with a `// TODO: Upgrade to TLS` comment — STARTTLS is fully implemented in `submission.ts` using `socket.startTls()`, but the doc was never updated
- Did not mention `/api/smtps/` (implicit TLS, port 465) or `/api/submission/` (STARTTLS, port 587) at all — two thirds of the implementation was undocumented
- Showed a `validateSender` function and credential storage via env vars — neither exists
- Ended with a "Next Steps" list describing unimplemented features

### What was improved

1. **Three-family structure revealed** — the doc now covers all six endpoints across all three source files (`smtp.ts`, `submission.ts`, `smtps.ts`), each routed separately in the worker

2. **TLS model per family** — `smtp.ts` uses plain TCP, `submission.ts` uses `connect()` with `secureTransport: 'starttls'` then `socket.startTls()` mid-stream, `smtps.ts` uses `secureTransport: 'on'` (implicit TLS from first byte). The doc explains the Cloudflare Workers socket API used for each.

3. **STARTTLS flow documented step-by-step** — the five-phase handshake in `/api/submission/send` (plain EHLO → STARTTLS → `startTls()` → re-EHLO → auth) was not documented anywhere

4. **Auth method differences** — `/api/submission/send` prefers AUTH PLAIN then falls back to LOGIN; `/api/smtp/send` and `/api/smtps/send` hardcode AUTH LOGIN. The capability-negotiation logic in `submission.ts` (reading the `AUTH` line from EHLO) is documented.

5. **Message construction differences** — `/api/smtp/send` generates only `From:`, `To:`, `Subject:`, no MIME headers, no Date, no dot-stuffing. `/api/submission/send` generates full RFC-compliant headers and implements dot-stuffing. `/api/smtps/send` generates full headers but no dot-stuffing.

6. **Cross-endpoint comparison table** — feature matrix showing TLS type, auth methods, dot-stuffing, headers, and response fields per endpoint

7. **Response field differences** — `/api/smtps/connect` returns `rtt` and `authenticated`; `/api/submission/send` returns `tls` and `serverResponse` (queue ID from the server's 250 reply); `/api/smtp/send` returns neither

8. **Known limitations** — single recipient only (no CC/BCC), no Message-ID, no RFC 2047 subject encoding, port 25 blocked from Cloudflare outbound, no XOAUTH2, AUTH LOGIN hardcoded on SMTPS

9. **curl examples** — runnable one-liners for Gmail SMTPS (app password), Mailgun submission with STARTTLS, and MailHog local dev

---

## etcd — `docs/protocols/ETCD.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 26/26 tests passing

### What was reviewed

The existing `docs/protocols/ETCD.md` was an implementation plan document written before the code. It described a fictional `EtcdClient` class, `ServiceRegistry` pattern, `DistributedLock` pattern, and a `fetch()`-based HTTP client. None of these exist in the actual implementation (`src/worker/etcd.ts`), which has two plain HTTP endpoints and uses raw TCP sockets.

The plan also described different endpoint paths (`/api/etcd/get`, `/api/etcd/put`, `/api/etcd/delete`) that were never built. The actual endpoints are `/api/etcd/health` and `/api/etcd/query`.

### Changes made

The entire document was replaced with an accurate reference for a reader who already knows etcd:

1. **Transport architecture** — explained why raw TCP HTTP/1.1 is used instead of `fetch()` (Workers can't reach non-Cloudflare HTTP on arbitrary ports), 512 KB response cap, chunked encoding handling, and one-connection-per-request model.

2. **Base64 encoding section** — documented the critical caller responsibility: keys and values must be base64-encoded in query bodies before sending. The implementation does NOT encode for you. Showed the auto-decode behavior (`key_decoded`, `value_decoded` added to parsed output).

3. **Accurate endpoint documentation** — both real endpoints with exact request fields, response shapes, and failure modes. Clarified that `body` in `/api/etcd/query` is a JSON string (pre-serialized), not a JSON object. Clarified that `success: true` from Port of Call doesn't mean etcd returned 2xx — check `statusCode`.

4. **v3 API reference** — all operations available via the query endpoint: KV (range, put, deleterange), transactions (CAS with compare/success/failure), leases (grant, revoke, keepalive, timetolive, list), maintenance (status, compact, defragment, alarm), cluster (member list), and auth (list roles/users, enable).

5. **Prefix query guide** — explained the `range_end` increment convention with working JavaScript and pre-computed examples. Explained the all-keys query using `\x00` range.

6. **Watch not supported** — explained why `/v3/watch` doesn't work (streaming incompatible with request/response model).

7. **Practical curl examples** — runnable commands for health probe, get/put, list cluster members, prefix key listing, and lease grant.

8. **Known Limitations** — documented: no Watch, no gRPC, no Cloudflare detection (unlike Redis), 512 KB cap, no base64 validation, Basic Auth only, int64-as-strings in responses.

---

## SMTP — `docs/protocols/SMTP.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 14/14 tests passing
**Source:** `src/worker/smtp.ts`, `src/components/SMTPClient.tsx`
**Tests:** `tests/smtp.test.ts`

### What was in the original doc

The original `SMTP.md` was an implementation plan. It contained a full pseudocode `SMTPClient` TypeScript class with a `connect()`, `sendMail()`, and `close()` pattern that does not exist in the codebase, along with React component sketches and a "Next Steps" list of unimplemented features.

### What was improved

The document was replaced with an accurate reference for a reader who already understands SMTP:

1. **TLS / STARTTLS limitation prominently surfaced** — the `useTLS` field is in the `SMTPConnectionOptions` interface but is completely ignored by both handlers. Port 465 (implicit TLS / SMTPS) will never produce a `220` greeting. Port 587 works at the TCP level but credentials are sent in cleartext since STARTTLS is never negotiated. This is the single most important thing a power user must know and was not mentioned anywhere.

2. **Exact endpoint shapes** — correct request/response JSON for both `/api/smtp/connect` and `/api/smtp/send`, including which fields are accepted-but-ignored (`useTLS`) and the combined validation error message when any required send field is missing.

3. **Wire exchanges** — annotated SMTP command sequences for the connect probe, unauthenticated send, and AUTH LOGIN send, showing the actual EHLO hostname (`portofcall`) and base64 encoding steps.

4. **AUTH LOGIN only** — documented that only `AUTH LOGIN` is implemented and named the unsupported mechanisms: `PLAIN`, `CRAM-MD5`, `XOAUTH2` (required by Gmail/Google Workspace), `GSSAPI`, `NTLM`. Also noted the `btoa()` Latin1 limitation for non-ASCII credentials.

5. **Single-recipient constraint** — `to` is a single string, no CC/BCC/multi-RCPT.

6. **Minimal headers** — DATA section only sends `From:`, `To:`, `Subject:`. No `Date:`, `Message-ID:`, `MIME-Version:`, or `Content-Type:`. Consequences for spam filtering and MUA display explained.

7. **No dot-stuffing** — RFC 5321 §4.5.2 requires lines beginning with `.` to be doubled. The implementation does not do this. A body line starting with `.` will terminate the DATA section early.

8. **EHLO hostname** — always `EHLO portofcall`, which strict MTAs may reject as non-FQDN or mismatched PTR.

9. **Response code table** — full table of codes a power user will encounter, with context for when each appears.

10. **Local testing** — Docker commands for MailHog and smtp4dev, which are the only realistic ways to exercise AUTH LOGIN and the full send flow without an open relay.

---

## SNMP — `docs/protocols/SNMP.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 3 endpoints active
**Implementation:** `src/worker/snmp.ts`
**Routes:** `/api/snmp/get`, `/api/snmp/walk`, `/api/snmp/v3-get`

### What was wrong with the original doc

The original `SNMP.md` was an **implementation plan** that predated or ignored a large portion of the codebase. Critical failures:

- "SNMPv3 (Not Yet Implemented)" — wrong. A full two-step USM discovery + authenticated GET is deployed at `/api/snmp/v3-get`.
- "Future Enhancements: [ ] SNMPv3 support" — already done.
- `❌ SNMPv3 (user-based security)` listed in the Limitations section — wrong.
- `"❌ Authentication failed" → "SNMPv3 not supported yet"` in the error handling table — wrong.
- No documentation of `/api/snmp/v3-get` whatsoever — endpoint, fields, response shape, SNMPv3 flow.
- curl examples pointed to `localhost:8787` instead of `portofcall.ross.gg`.
- Listed `demo.snmplabs.com` as a public test server (decommissioned years ago).
- Referenced `examples/snmp-test.html` (does not exist).

### What was improved

The document was replaced with an accurate power-user reference:

1. **All three endpoints documented** — exact request field tables (with types, defaults, and notes), success/error JSON shapes, and behavioral notes for `/api/snmp/get`, `/api/snmp/walk`, and `/api/snmp/v3-get`.

2. **SNMPv3 endpoint fully documented** — field table including `username`, `authPassword`, `authProtocol`, `privPassword`, `privProtocol`, `oids` (array, not single OID like v1/v2c), `timeout`. Success response includes `engineId` (hex), `engineBoots`, `engineTime`, `securityLevel`, `rtt`.

3. **SNMPv3 flow diagram** — two-connection sequence: Discovery (empty engineID → REPORT with engine params) then Authenticated GET (HMAC-SHA1 with 12-byte auth parameters inserted into the message).

4. **Critical MD5 limitation** — `authProtocol: "MD5"` is accepted but the HMAC is computed with SHA-1 (WebCrypto has no MD5). Agents configured for MD5 auth will send back `usmStatsWrongDigests` and authentication will fail. The bug is in line 871 of the source: both branches of the ternary evaluate to `'SHA-1'`.

5. **Privacy (`authPriv`) not implemented** — `privPassword` and `privProtocol` are accepted in the request body but never used. The scoped PDU is never encrypted. `securityLevel` can only be `noAuthNoPriv` or `authNoPriv`. Sending to an agent requiring `authPriv` results in `usmStatsDecryptionErrors`.

6. **COUNTER64 only in v3** — v1/v2c GET and WALK parsers handle types up to TIMETICKS (0x43); COUNTER64 (0x46) returns `UNKNOWN(0x46)`. Use `/api/snmp/v3-get` to fetch 64-bit interface counters from IF-MIB.

7. **Single TCP read limitation** — each GETBULK iteration calls `reader.read()` exactly once. Large GETBULK responses spanning multiple TCP segments are silently truncated. Recommend keeping `maxRepetitions` ≤ 20 for reliability over slow or high-latency paths.

8. **Response type table** — all 9 ASN.1 BER types handled (INTEGER, STRING, OID, NULL, IPADDRESS, COUNTER32, GAUGE32, TIMETICKS, COUNTER64) with BER tag, type name as returned in JSON, and JS representation. Noted that COUNTER64 is v3-only.

9. **TIMETICKS note** — values are in hundredths of a second; how to convert to seconds and days.

10. **Extended OID reference** — MIB-II system group (7 OIDs), ifTable key columns with notes on COUNTER32 wrap and where to find 64-bit equivalents, HOST-MIB hrStorage and hrProcessorLoad.

11. **SNMPv2c exception types** — `noSuchObject` (0x80), `noSuchInstance` (0x81), `endOfMibView` (0x82) appear as `UNKNOWN(0x80)` etc. in the current parser and are not surfaced as distinct error types.

12. **SNMPv3 engineID format** — 4-byte enterprise prefix (MSB set) + format byte + ID bytes; decoder table for common prefixes (net-snmp, Cisco IOS, Windows SNMP service).

13. **Wire format reference** — both SNMPv1/v2c message structure (annotated) and full SNMPv3 message structure (globalHeader, USM security parameters SEQUENCE, scoped PDU) with field-level comments.

14. **Working curl examples** — six commands covering all three endpoints: basic GET, forced v1 GET, system group walk, large-bulk ifTable walk, v3 `noAuthNoPriv`, v3 `authNoPriv`.

15. **Public test server note** — `demo.snmplabs.com` removed; replaced with instructions for running a local net-snmp agent and configuring a v3 user.

---

## LDAP — `docs/protocols/LDAP.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 13/13 tests passing
**Implementation:** `src/worker/ldap.ts`
**Tests:** `tests/ldap.test.ts`

### What was wrong with the original doc

The original `LDAP.md` was an implementation plan predating the shipped code. Critical failures:

- Described a single `/api/ldap/search` endpoint — the actual implementation has five operations (connect, search, add, modify, delete) **and a parallel TLS family** (`/api/ldaps/*`) for a total of ten routes.
- Described TypeScript classes (`LDAPClient`, `LDAPConnection`, `DirectoryService`) that do not exist.
- Had no mention of the actual BER/ASN.1 encoding or the hand-rolled parser.
- Did not document the filter limitation — the most critical power-user gotcha.
- Listed no known limitations, response caps, or error codes.

### What was improved

The document was replaced with an accurate power-user reference:

1. **Ten-endpoint structure revealed** — documented all five operations across both `/api/ldap/*` (plain TCP, port 389) and `/api/ldaps/*` (TLS, port 636) families, with exact request/response JSON for each.

2. **Filter limitation (critical)** — the filter encoder supports exactly two syntaxes:
   - Presence: `(attr=*)` → BER tag 0x87
   - Equality: `(attr=value)` → BER tag 0xA3
   All other filter forms — AND `(&...)`, OR `(|...)`, NOT `(!...)`, substring `(attr=*foo*)`, approxMatch `(attr~=value)`, greaterOrEqual, lessOrEqual — silently fall back to `(objectClass=*)` with no error. A complex LDAP filter will run and return all objects. This is the most important thing a power user must know.

3. **Two bind implementations revealed** — `/api/ldap/connect` uses a legacy `encodeLDAPBindRequest` + single `reader.read()` bind; all other endpoints use `ldapBindOnSocket` + a length-aware accumulator (`readLDAPData`). The connect probe may fail on high-latency links where the BindResponse spans multiple TCP reads.

4. **BER application tag reference** — table mapping all LDAP PDU types to their Application-class tags (0x60 BindRequest, 0x61 BindResponse, 0x63 SearchRequest, 0x64 SearchResultEntry, 0x65 SearchResultDone, 0x66 ModifyRequest, 0x68 AddRequest, 0x6A DelRequest).

5. **SearchResultDone scanner** — `readLDAPSearchData` stops accumulating when it finds tag 0x65 in the current buffer position. This works correctly for well-formed responses but documented the edge case where a value field could contain 0x65 at an offset the scanner checks.

6. **All 19 LDAP result codes** — complete table with numeric code, RFC name, and when it appears. Includes codes the implementation returns explicitly (0 success, 1 operations error, 32 noSuchObject, 34 invalidDNSyntax, 48 inappropriateAuthentication, 49 invalidCredentials, 50 insufficientAccessRights, 53 unwillingToPerform, 65 objectClassViolation, 68 entryAlreadyExists).

7. **128 KB response cap** — both `readLDAPData` and `readLDAPSearchData` stop accumulating at 131072 bytes. A search returning thousands of entries or entries with large binary attributes may be silently truncated.

8. **Modify operation codes** — `add: 0`, `delete: 1`, `replace: 2` as BER-encoded `ENUMERATED`. The modify handler accepts `"add"`, `"delete"`, `"replace"` strings and maps them to codes.

9. **Active Directory notes** — documented UPN vs SAM vs DN bind syntax, binary `objectGUID`/`objectSid` corruption via TextDecoder, AD's 1000-entry hard limit on search results, and which filter formats work (equality only for most AD attributes).

10. **derefAliases and typesOnly** — both hardcoded in the implementation; `derefAliases` is always 0 (`neverDerefAliases`), `typesOnly` is always `false`. Noted so power users know they can't control alias dereferencing.

11. **Binary attribute limitation** — TextDecoder is used throughout the response parser. Attributes containing non-UTF-8 binary values (userPassword with certain hash formats, thumbnailPhoto, objectGUID, objectSid, certificates) will be corrupted silently.

12. **curl examples** — runnable one-liners for all five operations including anonymous bind, authenticated bind, search with scope and filter, add with multi-value attributes, modify with replace, and delete. Plus a TLS (LDAPS) variant.

13. **Local testing** — Docker command for `osixia/openldap` with pre-loaded test data, connection parameters, and example searches against the test DIT.

---

## etcd — `docs/protocols/ETCD.md` (this session)

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 26/26 tests passing

### What was reviewed

`docs/protocols/ETCD.md` was an implementation plan containing a fictional `EtcdClient` TypeScript class, `ServiceRegistry`, `DistributedLock`, and a React component — none of which exist. The actual implementation has two endpoints and uses raw TCP HTTP/1.1. The initial rewrite (by a parallel session) replaced the planning doc with an accurate reference. This session added:

### Improvements added

1. **Revision semantics table** — Documented the three per-KV "version" fields (`version`, `create_revision`, `mod_revision`) with scope, reset behavior on delete+re-create, and use cases. The distinction between per-key `version` and cluster-global `revision` (response headers) is a common confusion point for etcd users.

2. **Transaction `target` table** — Reference table mapping each `target` value (VERSION, CREATE, MOD, VALUE, LEASE) to the compare body field it reads, with the common use case for each.

3. **Common compare patterns** — Four concrete compare JSON snippets: key does not exist (`version = 0`), key exists (`version > 0`), optimistic lock (`mod_revision = <read value>`), and value CAS. These are the patterns power users reach for in distributed locking and leader election.

4. **`LEASE` as fifth txn target** — Was missing from the initial rewrite.

5. **Txn response structure** — Documented that `success`/`failure` branches support `request_range` in addition to `request_put`/`request_delete_range`, and where to find responses in the nested structure (`responses[n].response_put`, etc.).

---

## DNS — `docs/protocols/DNS.md` (documentation review)

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed
**Implementation:** `src/worker/dns.ts`
**Endpoints:** `POST /api/dns/query`, `POST /api/dns/axfr`

### What was wrong with the original doc

`docs/protocols/DNS.md` was titled "DNS Protocol Implementation Plan" and remained as a planning artifact. Critical failures:

- Listed only 7 record types (A, NS, CNAME, MX, TXT, AAAA, SRV) — the implementation supports **28**
- Contained a pseudocode `DNSClient` TypeScript class that does not match any real code
- Contained a React `DNSLookup` component that does not exist in the codebase
- "Next Steps" included "Add DNSSEC support" and "Parse all record types" — both already implemented
- No mention of the AXFR zone transfer endpoint (`POST /api/dns/axfr`) at all
- No documentation of response flags (AA, TC, RD, RA), RCODE names, or authority/additional sections
- No documentation of DNSSEC record parsing (DNSKEY flag decoding, DS algorithm names, RRSIG expiry, NSEC type bitmap, NSEC3 parameters)
- No documentation of DANE/TLSA, SSHFP, CAA, NAPTR, SVCB/HTTPS

### Changes made

Replaced the entire document with an accurate power-user reference:

1. **Two-endpoint structure** — `POST /api/dns/query` and `POST /api/dns/axfr` with exact request/response JSON, field tables, and defaults.

2. **Response flags and RCODE tables** — QR, AA, TC, RD, RA with meanings. NOERROR, FORMERR, SERVFAIL, NXDOMAIN, NOTIMP, REFUSED.

3. **All 28 record types** — organized into four groups (common, service/routing, DNSSEC, security/identity) with the decoded `data` format for each. Types outside this set return `TYPE<N>` with raw hex.

4. **DNSKEY flag decoding** — bit 8 (0x0100) = ZSK, bit 0 (0x0001) = SEP/KSK; flags 256 = ZSK, 257 = KSK.

5. **DS/DNSKEY algorithm table** — codes 5, 7, 8, 10, 13, 14, 15, 16 decoded to RSASHA256, ECDSAP256SHA256, ED25519, etc.

6. **DS digest type table** — codes 1–4 decoded to SHA-1, SHA-256, GOST, SHA-384.

7. **TLSA field decoding** — usage (PKIX-TA/PKIX-EE/DANE-TA/DANE-EE), selector (Cert/SPKI), matching type (Full/SHA-256/SHA-512).

8. **AXFR endpoint documentation** — request fields (`zone`, `server`, `port`, `timeout` capped at 60 s, `maxRecords` capped at 100 K), response shape including `soaSerial`, `typeSummary`, `messageCount`, `complete` boolean.

9. **DNSSEC workflow examples** — three-step curl sequence to verify DNSSEC signing (DNSKEY at apex → DS at parent → RRSIG covering A records).

10. **DANE/TLSA and SSHFP examples** — `_25._tcp.<host>` TLSA lookup for SMTP, SSHFP comparison against `ssh-keygen -l`.

11. **AXFR test server** — `zonetransfer.me` / `nsztm1.digi.ninja` documented as intentionally open for testing.

12. **Known Limitations** — TCP only (no UDP), no EDNS0 (no DO bit → no DNSSEC validation), DNSSEC parsed not validated (RRSIG signatures not verified, expiry not compared to current time), NSEC3 type bitmap not decoded, SOA shows only mname/rname/serial, HTTPS/SVCB SvcParams not decoded, Cloudflare-hosted DNS servers blocked.

---

## Memcached — `src/worker/memcached.ts`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 5 endpoints
**Endpoints before:** `/api/memcached/connect`, `/api/memcached/command`, `/api/memcached/stats`, `/api/memcached/session`
**Endpoints after:** + `/api/memcached/gets`

### What was wrong with the original doc

`docs/protocols/MEMCACHED.md` was an implementation plan containing a fictional `MemcachedClient` TypeScript class and React component. None of the four actual Worker endpoints were documented.

### Bug found: CAS command silently broken

`cas` was included in the `storageCommands` list alongside `set`, `add`, `replace`, `append`, `prepend`. All commands in that list used `parts.slice(4).join(' ')` as the data value and `parts[3]` as exptime.

But `cas` takes an extra `<cas_unique>` argument: `cas <key> <flags> <exptime> <cas_unique> <bytes>\r\n<data>\r\n`. With the old code, `cas mykey 0 3600 12345 hello` would produce:
```
cas mykey 0 3600 11\r\n12345 hello\r\n
```
instead of the correct:
```
cas mykey 0 3600 12345 5\r\nhello\r\n
```
The server would respond `CLIENT_ERROR bad data chunk` or store `"12345 hello"` as the value with the wrong CAS unique. Same bug in both the HTTP `/command` handler and the WebSocket session handler.

**Fix:** Removed `'cas'` from `storageCommands`. Added a separate `else if (cmd === 'cas')` branch in both handlers that reads `parts[4]` as `casUnique` and `parts.slice(5).join(' ')` as the data value.

### Changes made to `src/worker/memcached.ts`

**1. Fixed CAS parsing in `/api/memcached/command` and session handler** — Both handlers now correctly handle `cas <key> <flags> <exptime> <cas_unique> <value>` with the unique token at position 4 and data starting at position 5.

**2. Added `handleMemcachedGets` — `POST /api/memcached/gets`** — The `gets` command returns VALUE blocks with a trailing CAS unique token. This is the prerequisite for CAS writes. The endpoint takes `{ host, keys: string[] }` and returns structured items with `key`, `flags`, `bytes`, `value`, and `cas` fields, plus a `missing` array of keys the server omitted. The `parseValueBlocks()` helper handles both plain `VALUE` (no CAS) and `VALUE+CAS` headers.

**3. Stats `subcommand` support on `/api/memcached/stats`** — Previously always sent `stats\r\n`. Now accepts `subcommand: "items" | "slabs" | "sizes" | "conns" | "reset"`. `stats items` shows per-slab eviction counts; `stats slabs` shows per-class memory allocation. `stats sizes` disruption warning: takes a global lock while walking all items — avoid on production under load.

### What was improved in the doc

Rewrote `docs/protocols/MEMCACHED.md` from scratch: five-endpoint reference with exact request/response JSON; CAS workflow (gets → parse cas token → cas write with EXISTS/NOT_FOUND/STORED semantics); `flags` field semantics (opaque 32-bit int, common client conventions); `exptime ≥ 2592000 = Unix timestamp` gotcha; stats subcommand table with descriptions and `stats sizes` disruption warning; key stats formulas (hit rate, fill ratio, eviction rate, connection pressure) with actionable thresholds; response reference table for all standard response strings; known limitations (no SASL, no binary protocol, no TLS, binary value corruption, `noreply` timeout); 12 curl examples covering all endpoints.

---

## IRC / IRCS — 2026-02-17

**Protocol:** IRC (RFC 2812) + IRCv3 extensions
**Files reviewed:** `src/worker/irc.ts`, `src/worker/ircs.ts`
**Doc rewritten:** `docs/protocols/IRC.md`

### What was wrong with the original doc

`docs/protocols/IRC.md` was a planning document containing:
- A fictional `IRCClient` TypeScript class, `ircTunnel()` function, and `IRCClient.tsx` React component — none of which exist in the codebase
- Wrong WebSocket message protocol (polling-based `getMessages`/`clearMessages` vs. the actual streaming event model)
- Wrong endpoint (`/api/irc/connect` described as a WebSocket-only route, when it serves both `POST` probe and WebSocket upgrade at the same URL)
- "Next Steps" list describing unimplemented features as future work
- No mention of IRCv3, CAP negotiation, SASL, or IRCS

### What was found in the implementation

Good foundation: `parseIRCMessage` with RFC-correct prefix/param/trailing-param parsing, PING/PONG auto-response, `validateNickname`, channel auto-join after 376/422, and a clean write-then-releaseLock pattern on the writable stream. The WebSocket handler already supported `raw`, `join`, `part`, `privmsg`, `nick`, `quit`, `topic`, `names`, `list`, `whois`.

### What was improved in the code

1. **IRCv3 message tag parsing** (`irc.ts` + `ircs.ts`) — The parser previously ignored lines starting with `@tags`. Modern servers (Libera.Chat, OFTC, etc.) routinely send message tags for `server-time`, `msgid`, `account`, `batch`, `react`, etc. Without this fix, every tagged line silently garbled the prefix field. Added IRCv3 tag extraction with correct value unescaping (`\:` → `;`, `\s` → space, `\\` → `\`, `\r`, `\n`).

2. **`IRCMessage.tags` field** — Added `tags?: Record<string, string>` to the exported interface so the parsed tag map is included in every `irc-message` event sent to the browser.

3. **IRCv3 capability negotiation** (`irc.ts` + `ircs.ts`) — The registration sequence now sends `CAP LS 302` before `NICK`/`USER`. The read loop handles: `CAP * LS` → emits `irc-caps` event; sends `CAP REQ :sasl` or `CAP END`; `CAP * ACK` → starts SASL or sends `CAP END`; `CAP * NAK` → sends `CAP END`.

4. **SASL PLAIN authentication** (`irc.ts` + `ircs.ts`) — Added `saslUsername` / `saslPassword` query params to the WebSocket endpoint. When provided and the server offers `sasl`, performs the full exchange: `CAP REQ :sasl` → `AUTHENTICATE PLAIN` → `AUTHENTICATE <base64(account\0account\0password)>` → on 903 sends `CAP END`. Emits `irc-sasl-success` or `irc-sasl-failed` (codes 904–907) to the browser.

5. **`IRCConnectionOptions` interface** — Added `saslUsername?: string` and `saslPassword?: string`.

6. **Missing session command types** (`irc.ts` + `ircs.ts`) — Added nine new JSON command types: `notice` (NOTICE), `kick` (KICK), `mode` (MODE), `invite` (INVITE), `away` (AWAY/unaway), `ctcp` (PRIVMSG \x01…\x01), `ctcp-reply` (NOTICE \x01…\x01), `cap` (raw CAP subcommands), `userhost` (USERHOST, up to 5 nicks).

### What was improved in the doc

Rewrote `docs/protocols/IRC.md` from scratch: exact endpoint reference; full registration sequence diagrams for no-SASL and SASL PLAIN flows; complete `irc-message` event shape with `tags` field; table of all worker→browser event types; complete command reference for all JSON types with example payloads; CTCP detection snippet; minimal browser connection snippet; nickname validation spec; known limitations (no STARTTLS, only SASL PLAIN, multi-line CAP LS caveat, no flood throttling, no DCC); public servers table for testing.

---

## IMAP — `docs/protocols/IMAP.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 17/17 tests passing
**Implementation:** `src/worker/imap.ts`
**Tests:** `tests/imap.test.ts`

### What was wrong with the original doc

`docs/protocols/IMAP.md` was an implementation plan containing a fictional `IMAPClient` TypeScript class (with `connect()`, `authenticate()`, `listMailboxes()`, `selectMailbox()`, `fetchMessages()`, `searchMessages()`, `close()` methods), a React `IMAPMailboxViewer` component, and tutorial-level protocol explanation. None of the four actual Worker endpoints were documented.

### What was improved

The document was replaced with an accurate power-user reference:

1. **Four-endpoint structure** — documented `GET|POST /api/imap/connect`, `POST /api/imap/list`, `POST /api/imap/select`, and `GET /api/imap/session` (WebSocket) with exact request/response JSON, field tables, and defaults.

2. **Tag sequence tables** — each HTTP endpoint uses hardcoded tags A001/A002/A003 in fixed positions. Documented which tag maps to which command per endpoint, and why the session starts at A003 (A001/A002 consumed by LOGIN and CAPABILITY during startup).

3. **Session tag counter format** — the counter uses `.padStart(3, '0')`, so tags go A003, A004 … A009, A010, A099, A100, A999, A1000 (stops zero-padding at 4 digits). Documented the full sequence and that the counter is per-connection.

4. **LIST regex limitation** — the mailbox parser matches only lines with a quoted delimiter AND a quoted mailbox name. NIL delimiters (valid for container-only hierarchy nodes) and unquoted mailbox names are silently dropped. The regex pattern is shown verbatim.

5. **SELECT vs EXAMINE** — SELECT always opens in read-write mode, clearing the `\Recent` flag on messages. EXAMINE is not available via HTTP endpoints; power users who need read-only access can issue `EXAMINE mailbox` via the `/session` endpoint.

6. **Mailbox name quoting** — the SELECT handler interpolates the mailbox name directly without quoting. Names with spaces require the caller to pass the quotes as part of the value (e.g., `"\"Sent Items\""`).

7. **Full WebSocket session protocol** — both directions documented: browser→worker (`{ type: 'command', command }`) and worker→browser (`connected`, `response`, `error` types) with exact JSON shapes and field descriptions. `response` contains the raw server response including CRLF pairs.

8. **Session teardown** — LOGOUT sent on WebSocket `close` event with a 3 s timeout; failure silently ignored.

9. **Greeting reader timeout asymmetry** — `/connect` has a 5 s hard timeout on the greeting read; `/list` and `/select` have no per-read limit (only the outer wall-clock timeout). A stalled partial greeting holds the connection until `timeout` ms elapses.

10. **`capabilities` field format difference** — in `/connect`, `capabilities` is the raw multi-line response string (including `A002 OK ...` tag line and CRLF pairs). In `/session`, `capabilities` is the parsed space-separated token list. Documented both with a note on how to extract tokens from the HTTP form.

11. **LOGIN vs SASL** — only `LOGIN` is used, never `AUTHENTICATE`. Pre-auth CAPABILITY is never fetched, so `LOGINDISABLED` is never detected before credentials are submitted.

12. **No TLS at any level** — STARTTLS is never negotiated; IMAPS (port 993) is accepted but the socket opens as plain TCP, so TLS-expecting servers close the connection before the greeting.

13. **Credentials in WebSocket URL** — session endpoint takes username/password as query parameters, visible in server access logs, browser history, and any HTTP proxy.

14. **What is NOT implemented** — table covering STARTTLS, IMAPS, EXAMINE, FETCH, SEARCH, STORE, COPY, MOVE, IDLE, APPEND, NAMESPACE, SASL AUTHENTICATE, pre-auth CAPABILITY, and mailbox name quoting.

15. **curl examples** — five one-liners covering unauthenticated probe, authenticated probe, list, select, and select with a space-containing mailbox name.

16. **Local test server** — Dovecot and GreenMail Docker configurations for plaintext testing.

---

## POP3 revision — `docs/protocols/POP3.md`

**Revised:** 2026-02-17
**Revising:** Prior POP3 entry from this session (which had three errors)

### Corrections made to the prior POP3 entry

1. **Endpoint count was wrong.** The prior entry called it "six endpoints" but there are seven: `connect`, `list`, `retrieve`, `dele`, `uidl`, `capa`, `top`.

2. **"No TLS" claim was wrong.** The prior entry stated "port 995 is accepted but times out because TLS is never negotiated." This is incorrect — `src/worker/pop3s.ts` implements a full POP3S handler using `secureTransport: 'on'` (implicit TLS) with all seven endpoints mirrored under `/api/pop3s/`.

3. **POP3S was entirely undocumented.** Added a complete `/api/pop3s/` section covering all seven TLS endpoints, their parameter shapes, and POP3S-specific response fields (`rtt`, `messageCount`, `mailboxSize`, `protocol: 'POP3S'`, `tls: true`).

### Additional additions

- **POP3S `messageId` vs `msgnum` inconsistency** — `/api/pop3s/retrieve` requires `messageId` (matching the plain POP3 equivalent); `/api/pop3s/dele` and `/api/pop3s/top` require `msgnum`. This inconsistency between endpoints in the same TLS family is now documented.
- **Wire exchange diagrams** — added four wire traces: unauthenticated connect, authenticated session with LIST, RETR, and DELE+QUIT.
- **POP3S curl examples** — added three POP3S examples (connect with `rtt`/`messageCount`, list over TLS, capa over TLS).
- **GreenMail test server** — added as a Docker option for integrated POP3+POP3S local testing.

---

## SNMP — `src/worker/snmp.ts` (code review and improvements)

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed — GET/WALK/SNMPv3-GET working
**Endpoints before review:** `/api/snmp/get`, `/api/snmp/walk`, `/api/snmp/v3-get`
**Endpoints after review:** + `/api/snmp/set`, `/api/snmp/multi-get`

### What was reviewed

The implementation correctly covered the core SNMP wire format (ASN.1/BER encoding, v1/v2c community strings, SNMPv3 USM discovery + authenticated GET). However, a power user who monitors real network infrastructure daily would hit five silent bugs and two missing operations.

### Changes made to `src/worker/snmp.ts`

**1. Fixed silent COUNTER64 omission (v1/v2c `parseResponse`)**

`BER_TYPE.COUNTER64 = 0x46` was defined and handled in the SNMPv3 path, but missing from the main `parseResponse()` switch. Any 64-bit counter (ifHCInOctets, ifHCOutOctets — the standard high-speed interface counters on anything faster than 100 Mbps) silently rendered as `Unknown type 0x46`. Fixed with `parseCounter64()`, which uses arithmetic (not JS bit-shifting, which truncates to 32 bits) and returns BigInt decimal strings for values exceeding `Number.MAX_SAFE_INTEGER`.

**2. Fixed silent SNMPv2c exception types**

RFC 1905 §3.2 defines three exception values that appear in varbinds rather than `errorStatus`: `noSuchObject (0x80)`, `noSuchInstance (0x81)`, `endOfMibView (0x82)`. These are how SNMPv2c signals "this OID doesn't exist" without an error PDU. Before this fix, all three produced `Unknown type 0x8x`, causing walks to silently stop or produce garbage. Fixed in both `parseResponse()` and the SNMPv3 varbind parser.

**3. Fixed binary OCTET_STRING corruption**

`new TextDecoder().decode(data)` was used unconditionally. This corrupts binary octet strings: MAC addresses, `ifPhysAddress`, interface IDs, engine IDs, and many vendor MIB values are binary. Added `decodeOctetString()` which checks for printable ASCII. Non-printable data is returned as colon-separated hex (e.g. `00:1a:2b:3c:4d:5e`). Text values like `sysDescr`, `sysName` are unaffected.

**4. Added TIMETICKS human-readable formatting**

Raw TIMETICKS (hundredths of seconds since last restart) is useless to a human. `sysUpTime.0 = 47759600` tells you nothing. Now returns `47759600 (5 days, 12:39:56)`. Applied consistently in both `parseResponse()` and the SNMPv3 varbind parser.

**5. Fixed SNMPv3 MD5 authentication — was silently using SHA-1**

Source line 871 before the fix:
```typescript
const hashAlgorithm: 'SHA-1' | 'SHA-256' = authProtocol === 'SHA' ? 'SHA-1' : 'SHA-1';
```
Both branches returned `'SHA-1'`. Requesting `authProtocol: 'MD5'` computed HMAC-SHA1 and presented it as MD5, guaranteeing authentication failure against MD5-configured agents. WebCrypto doesn't support MD5, but `node:crypto` does (available via `nodejs_compat` in wrangler.toml). Fixed `hmacDigest()` and `localizeKey()` to use `createHmac('md5')` / `createHash('md5')` from `node:crypto` when `authProtocol === 'MD5'`.

**6. Added `/api/snmp/set` — SNMP SET operation**

Without SET, the implementation is read-only. Power users need SET to rename devices (`sysName.0`), bring interfaces down (`ifAdminStatus.N = 2`), and adjust device config. Supports INTEGER, STRING, OID, IPADDRESS, COUNTER32, GAUGE32, TIMETICKS. Uses write community (defaults to `private`). Agent echoes the set value back in the response for confirmation.

**7. Added `/api/snmp/multi-get` — multi-OID GET in a single request**

The existing `/api/snmp/get` fetches one OID per TCP round trip. Monitoring dashboards poll dozens of counters per device; one-OID-per-request is 10–30× more expensive than necessary. `buildMultiGetRequest()` packs up to 60 OIDs into a single GET PDU (v1 and v2c).

### Known Limitations (unchanged)

- UDP not supported — SNMP normally runs over UDP 161; TCP (RFC 3430) used throughout
- SNMPv3 privacy (AES/DES) not implemented — `privProtocol`/`privPassword` accepted but ignored
- SNMPv3 SET not implemented — only SNMPv1/v2c SET via `/api/snmp/set`
- TRAP reception not supported — UDP 162, no listener infrastructure in Workers
- GETBULK non-repeaters hardcoded to 0 — mixed scalar+table GETBULK needs configurable non-repeaters
- Large COUNTER64 values returned as decimal strings (values ≥ 2^53 lose precision as JS numbers)

## DNS — `src/worker/dns.ts`

**Reviewed:** 2026-02-17
**Protocol:** DNS over TCP (RFC 1035), EDNS0 (RFC 6891), DNSSEC (RFC 4034/5155), AXFR (RFC 5936)
**File:** `src/worker/dns.ts`

### What was reviewed

The DNS implementation correctly handled basic A/AAAA/CNAME/MX/TXT/NS/PTR/SOA/SRV queries over TCP with name-compression support. However, a power user who regularly operates DNS servers or diagnoses DNSSEC deployment would immediately hit several gaps.

### Gaps identified

1. **No EDNS0 in queries** — Without the OPT record (type 41) in the additional section, servers cap responses at 512 bytes and refuse to return DNSSEC signatures. Any query for large TXT records (SPF, DKIM) or zones with many records was silently truncated or incomplete.

2. **No DNSSEC record type support** — DNSKEY, RRSIG, DS, NSEC, NSEC3, CDS, and CDNSKEY all fell to the hex-dump default case. A user running `type=DNSKEY` would get opaque binary, not the structured key flags/algorithm/public-key they need to verify a chain of trust.

3. **SOA parsing was incomplete** — Returned only `mname rname serial`, dropping refresh, retry, expire, and minimum TTL. Power users diagnosing zone staleness specifically check these timing fields.

4. **AD and CD flags missing** — The `flags` object had no `ad` (Authentic Data) or `cd` (Checking Disabled) fields. AD=1 is the resolver's signal that the answer is DNSSEC-validated; CD=1 is how a client bypasses validation at the resolver to fetch raw DNSSEC records.

5. **No zone transfer (AXFR)** — The `/api/dns/axfr` route was wired in index.ts calling a non-existent `handleDNSZoneTransfer` export, causing a build error.

6. **Missing record types** — NAPTR (SIP/ENUM/E.164), CAA (certificate authority authorization), TLSA (DANE), CDS/CDNSKEY (automated DNSSEC delegation) were all absent. These are the types a power user tests when auditing a zone.

7. **OPT record in responses not decoded** — When a server includes its own OPT record (NSID, COOKIE, padding), it appeared as a confusing entry in the additional section rather than being decoded into structured EDNS metadata.

### Changes made

**EDNS0 OPT record in queries (RFC 6891)**
- `buildDNSQuery()` now accepts `{ edns, dnssecOK, checkingDisabled }` options
- EDNS0 is on by default: ARCOUNT=1, OPT record with UDP payload size=4096
- `dnssecOK=true` sets the DO bit (bit 15 of OPT TTL field)
- `checkingDisabled=true` sets the CD bit in the query flags
- Queries for DNSKEY/RRSIG/DS/NSEC/NSEC3/CDS/CDNSKEY auto-enable `dnssecOK`

**DNSSEC record types (RFC 4034, RFC 5155)**
- **DNSKEY / CDNSKEY**: flags (KSK vs ZSK via zone-key and SEP bits), protocol, algorithm name, base64 public key
- **RRSIG**: type covered, algorithm, label count, original TTL, signature expiration/inception as ISO-8601, key tag, signer name, base64 signature
- **DS / CDS**: key tag, algorithm name, digest type name, hex digest
- **NSEC**: next domain name, type bitmap decoded to record type names
- **NSEC3**: hash algorithm, opt-out flag, iterations, hex salt, base64 next-hashed-owner, type bitmap

**New record types**
- **NAPTR** (RFC 3403): order, preference, flags, services, regexp, replacement — for SIP/ENUM/E.164 lookup
- **TLSA** (RFC 6698): cert usage (PKIX-TA/PKIX-EE/DANE-TA/DANE-EE), selector (Cert/SPKI), matching type (Full/SHA-256/SHA-512), hex cert-association data
- **CAA** (RFC 8659): critical flag, tag (issue/issuewild/iodef), value

**Full SOA parsing**
- Now returns all 7 SOA fields: mname, rname, serial, refresh, retry, expire, minimum
- Structured `parsed` object on SOA records for programmatic access

**AD and CD flags**
- `DNSFlags` interface now includes `ad: boolean` and `cd: boolean`
- Parsed from header flags bits 5 (AD) and 4 (CD)

**OPT record decoding**
- When a server includes its OPT record, it is decoded into `edns` on the top-level response object rather than cluttering `additional`
- Fields: version, udpPayloadSize, doFlag, extendedRcode, options array (with NSID, COOKIE, padding, edns-client-subnet names)

**AXFR zone transfer endpoint (RFC 5936)**
- `handleDNSAXFR` export, replacing the broken `handleDNSZoneTransfer` reference in index.ts
- POST /api/dns/axfr — `{ zone, server, port?, timeout? }`
- Reads multiple DNS-over-TCP messages until the second SOA record (zone transfer terminator per RFC 5936 §2.2)
- Returns: soaSerial, recordCount, msgCount, byType summary, full record list
- REFUSED response surfaced as `success: false` with rcode — normal for servers with transfer ACLs

**Refactored TCP framing**
- Extracted `tcpWrap()` and `readTCPDNSMessage()` as shared helpers used by both query and AXFR paths

**Additional record type codes**
- NAPTR=35, DS=43, RRSIG=46, NSEC=47, DNSKEY=48, NSEC3=50, TLSA=52, CDS=59, CDNSKEY=60, IXFR=251, AXFR=252, CAA=257 all added to `DNS_RECORD_TYPES`

**Extended RCODE names**
- YXDOMAIN(6), YXRRSET(7), NXRRSET(8), NOTAUTH(9), NOTZONE(10) added to `RCODE_NAMES`

**snmp.ts build fix** — Fixed unrelated pre-existing `TS2365: Operator * cannot be applied to number and bigint` error in `src/worker/snmp.ts` line 653.

### Power user curl examples

```bash
# Query DNSKEY with DO bit (DNSSEC-aware query)
curl -X POST https://portofcall.example.com/api/dns/query \
  -H 'Content-Type: application/json' \
  -d '{"domain":"cloudflare.com","type":"DNSKEY","server":"1.1.1.1","dnssecOK":true}'

# Query DS record (verify chain of trust)
curl -X POST https://portofcall.example.com/api/dns/query \
  -d '{"domain":"cloudflare.com","type":"DS","server":"8.8.8.8"}'

# CAA — check which CAs are authorized for a domain
curl -X POST https://portofcall.example.com/api/dns/query \
  -d '{"domain":"github.com","type":"CAA"}'

# TLSA — verify DANE certificate pinning
curl -X POST https://portofcall.example.com/api/dns/query \
  -d '{"domain":"_443._tcp.fedoraproject.org","type":"TLSA","server":"8.8.8.8"}'

# NAPTR — E.164 ENUM or SIP routing
curl -X POST https://portofcall.example.com/api/dns/query \
  -d '{"domain":"3.0.0.0.6.9.1.e164.arpa","type":"NAPTR","server":"8.8.8.8"}'

# AXFR — zone transfer (requires server that allows it)
curl -X POST https://portofcall.example.com/api/dns/axfr \
  -d '{"zone":"zonetransfer.me","server":"nsztm1.digi.ninja"}'
```

### Endpoints after review

| Endpoint | Method | Description |
|---|---|---|
| /api/dns/query | POST | DNS query (all record types, EDNS0, DNSSEC flags) |
| /api/dns/axfr | POST | AXFR zone transfer |

---

## SSH — `docs/protocols/SSH.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 14/14 tests passing
**Implementation:** `src/worker/ssh.ts`, `src/worker/ssh2-impl.ts`
**Tests:** `tests/ssh.test.ts`

### What was wrong with the original doc

`docs/protocols/SSH.md` was titled "SSH Protocol Implementation Plan" and described aspirational architecture:

- Described a single `/api/ssh/connect` endpoint and a fictitious `SSHConnectionOptions` TypeScript class that implies browser-side SSH — the doc didn't distinguish between the raw TCP tunnel (`/connect` WebSocket) and the full server-side SSH-2 implementation (`/terminal`)
- Did not document `/api/ssh/kexinit`, `/api/ssh/auth`, `/api/ssh/terminal`, `/api/ssh/execute`, or `/api/ssh/disconnect` at all — five of the six actual endpoints were invisible
- Had tutorial-level SSH layer diagrams and connection flow explanations that add no value to a power user who already knows SSH
- Did not document the two source files (`ssh.ts` vs `ssh2-impl.ts`), which implement fundamentally different behaviours
- Did not document the key exchange (curve25519-sha256), cipher (aes128-ctr), MAC (hmac-sha2-256), or auth (Ed25519 only — RSA not supported in `/terminal`) choices
- Listed `SSHConnectionOptions` fields (`keepaliveInterval`, `readyTimeout`, `hostHash`, `algorithms`, `strictHostKeyChecking`, `debug`) that are accepted by the WebSocket query params but have no effect on the `/terminal` endpoint, which is hard-coded to specific algorithms

### What was improved

The document was replaced with an accurate power-user reference:

1. **Architecture overview table** — clearly distinguishes the three operational modes: HTTP banner probe (`/connect` HTTP), raw TCP tunnel (`/connect` WebSocket), and full SSH-2 client (`/terminal` WebSocket).

2. **All six endpoints documented** — `/connect`, `/kexinit`, `/auth`, `/terminal`, `/execute` (501 stub), `/disconnect` (advisory stub) with exact request/response shapes, field tables, defaults, and error cases.

3. **`/kexinit` endpoint fully documented** — the KEXINIT exchange happens in `ssh.ts` (not `ssh2-impl.ts`), advertises a different algorithm set than `/terminal`, and does not complete the key exchange. The client banner sent is `SSH-2.0-CloudflareWorker_1.0` vs `/terminal`'s `SSH-2.0-PortOfCall_1.0`. Both banners documented.

4. **`/auth` endpoint wire exchange** — step-by-step annotated sequence from banner through KEXINIT, SERVICE_REQUEST, USERAUTH_REQUEST(none), to USERAUTH_FAILURE/SUCCESS. Noted that SERVICE_REQUEST is sent unencrypted (no key exchange is completed).

5. **`/terminal` WebSocket message protocol** — both directions: `connected`, `info`, `error`, `disconnected` JSON events from worker, plus raw binary frames for terminal output; raw text/binary for terminal input with the JSON-filtering rule documented (`{...,"type":...}` input is silently dropped).

6. **Ed25519-only auth limitation** — only Ed25519 keys are supported. RSA and ECDSA throw `"Unsupported key type"`. The `/kexinit` endpoint advertises `ssh-rsa,rsa-sha2-256,rsa-sha2-512` to the server but `/terminal`'s auth code never uses them.

7. **Passphrase-protected key limitation** — only `aes256-ctr`, `aes256-cbc`, `aes192-ctr`, `aes128-ctr` are supported as KDF ciphers. OpenSSH 9.x defaults to `chacha20-poly1305@openssh.com` for new keys — those keys fail with `"Unsupported cipher"`. Workaround documented.

8. **No host key verification** — host key signature in KEXECDH_REPLY is received but not checked against a known-hosts list. MITM on the TCP path is undetected.

9. **Hardcoded PTY dimensions** — xterm-256color, 220 cols × 50 rows. No resize protocol.

10. **Key derivation reference** — RFC 4253 §7.2 six-key derivation scheme with labels A–F documented with actual byte lengths (16 for AES-128-CTR IVs and keys, 32 for HMAC-SHA-256 keys).

11. **SSH-2 message type reference table** — all 26 message types handled or produced by the implementation, with direction, decimal code, and behavioral notes (e.g. GLOBAL_REQUEST → Worker replies REQUEST_FAILURE, CHANNEL_EXTENDED_DATA stderr is forwarded to browser as raw bytes).

12. **curl examples** — runnable one-liners for the three HTTP endpoints (`/connect`, `/kexinit`, `/auth`), and `ssh-keygen` commands to prepare Ed25519 keys for `/terminal`.


---

## MySQL — `docs/protocols/MYSQL.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 4 endpoints active
**Implementation:** `src/worker/mysql.ts`
**Routes:** `/api/mysql/connect`, `/api/mysql/query`, `/api/mysql/databases`, `/api/mysql/tables`

### What was wrong with the original doc

The original `MYSQL.md` was a pure planning document that described an implementation strategy that was never built:

- Proposed using the `mysql2` Node.js library (`npm install mysql2`) — not installed, not available in Cloudflare Workers
- Showed a `MySQLClient` class wrapping a `mysql.Connection` object with `stream: socket as any` — does not exist
- Included a `mysqlTunnel` WebSocket handler — does not exist
- Included a React `MySQLClient` component with an SQL editor UI — does not exist
- Ended with a "Next Steps" checklist of unbuilt features
- Contained no mention of the four actual endpoints
- No documentation of the binary wire protocol, auth flows, or result set format

The actual implementation (`src/worker/mysql.ts`, 1100 lines) implements the MySQL Client/Server Protocol from scratch: handshake parsing, capability negotiation, two auth plugins, accumulating packet reader, column definition parsing, result set parsing with length-encoded strings.

### What was improved

The document was replaced with an accurate power-user reference:

1. **All four endpoints documented** — exact request field tables and response JSON shapes for `/connect` (probe vs. full auth modes), `/query`, `/databases`, and `/tables`.

2. **Probe vs. full auth mode in `/connect`** — without credentials, the endpoint reads only the Initial Handshake (succeeds even if credentials are wrong, useful for port scanning and version fingerprinting); with credentials, performs full auth and disconnects.

3. **Dual auth plugin support** — documented both `mysql_native_password` (SHA-1 XOR chain) and `caching_sha2_password` (SHA-256 XOR chain) with the exact hash formulas. Documented the fast auth (`0x03`) vs. full auth (`0x04`) distinction for `caching_sha2_password`.

4. **RSA limitation clearly documented** — `caching_sha2_password` full auth (`0x04`) throws an error because WebCrypto cannot perform RSA-OAEP without a key pair. This is the most common failure on default MySQL 8+ installations using plaintext TCP. Documented the workaround: use `--default-authentication-plugin=mysql_native_password` or create a user with `mysql_native_password` plugin.

5. **DML limitation** — INSERT/UPDATE/DELETE return OK packets, not result sets; the `/query` endpoint returns `success: false` for these. Documented the `SELECT ROW_COUNT()` workaround.

6. **All values are strings** — result set rows are `Record<string, string | null>`. No type conversion. Documented with the column type number table (type 3 = INT, 12 = DATETIME, 253 = VARCHAR, etc.).

7. **Accumulating packet reader** — `readPacket` accumulates TCP chunks until a full 4-byte header + payload is available. This is why large result sets work correctly (unlike single-read implementations). Documented this as a feature since it explains why fragmented TCP responses don't fail.

8. **Capability flags sent** — listed the six flags set in every Handshake Response, and noted that `CLIENT_SSL` and `CLIENT_COMPRESS` are NOT set.

9. **Default `username` is `"root"`** — surprising behavior for a tool targeting power users who expect a validation error when credentials are omitted.

10. **No multi-statement, no prepared statements** — `CLIENT_MULTI_STATEMENTS` not set; `COM_STMT_PREPARE` (0x16) not implemented. All queries use `COM_QUERY` (text protocol).

11. **Wire sequence diagram** — annotated connection sequence from Initial Handshake through auth, `COM_QUERY`, column defs, EOF, rows, EOF.

12. **Power-user query examples** — curl one-liners for: table sizes, column schema introspection, active processlist, replication lag (MySQL 8 `SHOW REPLICA STATUS`), InnoDB lock waits.

13. **Local testing** — Docker commands for three configurations: MySQL 8 with `mysql_native_password` forced (avoids RSA auth), MySQL 8 with default `caching_sha2` (tests fast auth path), MariaDB 11.

---

## PostgreSQL — `docs/protocols/POSTGRESQL.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, tests passing
**Implementation:** `src/worker/postgres.ts`
**Tests:** `tests/postgres.test.ts`
**Endpoints:** `/api/postgres/connect`, `/api/postgres/query`, `/api/postgres/describe`, `/api/postgres/listen`, `/api/postgres/notify`

### What was wrong with the original doc

`docs/protocols/POSTGRESQL.md` was titled "PostgreSQL Protocol Implementation Plan" and contained:
- A fictional `pg` library usage pattern (`npm install pg` + `Client`/`Pool` class) — no pg library is used; the wire protocol is implemented from scratch with a hand-rolled `PGReader` class
- A React `PostgreSQLClient.tsx` component sketch that does not exist
- Only 5 message types documented (Q, T, D, C, Z) — the implementation handles 18
- No mention of the three auth methods actually supported (MD5, SCRAM-SHA-256, cleartext)
- No mention of SCRAM-SHA-256 (the most complex part: PBKDF2, HMAC-SHA-256, nonce exchange)
- No mention of `/api/postgres/describe` (Extended Query protocol: Parse+Describe+Sync)
- No mention of `/api/postgres/listen` or `/api/postgres/notify` (LISTEN/NOTIFY async pub/sub)
- No documentation of type OIDs, ErrorResponse field codes, SQLSTATE codes, or known limitations

### What was improved

The document was replaced with an accurate power-user reference for someone who knows PostgreSQL and wants to understand exactly what this implementation does and does not support:

1. **All five endpoints documented** — exact request/response JSON for `/connect`, `/query`, `/describe`, `/listen`, `/notify`, including all optional fields and their defaults.

2. **Auth methods table** — trust (0), cleartext (3), MD5 (5), SCRAM-SHA-256 (10). What's NOT supported: SCRAM-SHA-256-PLUS, GSS/Kerberos, SSPI, PAM, RADIUS.

3. **SCRAM-SHA-256 implementation details** — step-by-step: client nonce generation (24 bytes, base64url), PBKDF2-SHA-256 key derivation (Web Crypto), HMAC-SHA-256 client/server key derivation, client proof = ClientKey XOR ClientSignature, channel binding = `biws`. Critical note: server signature is computed but immediately discarded (`void serverSigB64`); a MITM can substitute its own SCRAM challenge without detection.

4. **Simple Query vs Extended Query distinction** — `/query` uses Simple Query protocol ('Q' message); `/describe` uses Extended Query (Parse+'P'/Describe+'D'/Sync+'S'). No parameterized queries in `/query`.

5. **All-values-are-strings limitation** — every column value (int, timestamp, bytea, json, uuid) arrives as a text string. No binary format mode.

6. **COPY protocol not handled** — queries triggering CopyIn/CopyOut will hang until timeout.

7. **Type OID reference table** — 20 common OIDs with type names (int4=23, text=25, uuid=2950, jsonb=3802, etc.) and a query to resolve unknown OIDs via `pg_type`.

8. **Wire protocol message types table** — 18 message codes with direction, name, and key notes.

9. **ErrorResponse field codes** — 8 field codes (S, V, C, M, D, H, P, position); only M and D are extracted, rest silently ignored.

10. **SQLSTATE reference** — 10 common codes (28P01 invalid_password, 42P01 undefined_table, 23505 unique_violation, etc.).

11. **LISTEN limitations** — channel name regex `/^[a-zA-Z_][a-zA-Z0-9_]*$/` rejects names valid in PostgreSQL (hyphens, quoted identifiers). Cannot long-poll beyond 15s timeout. `listenConfirmed` and `pid` semantics explained.

12. **NOTIFY injection safety** — documents that `pg_notify('channel', 'payload')` is used (not bare `NOTIFY`), with single-quote escaping; explains why `notified: true` does not mean listeners received the message.

13. **`database` defaults to `username`** — non-obvious default that surprises users expecting `"postgres"`.

14. **Multiple statements return only last result** — Simple Query allows multi-statement strings; earlier result sets are silently overwritten.

15. **curl examples** — 6 runnable commands including admin queries for `pg_stat_activity` and table size listing.

16. **Local testing** — Docker command for postgres:16 with SCRAM-SHA-256 user setup.


---

## IMAP — `docs/protocols/IMAP.md` (full rewrite)

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 17/17 tests passing
**Source:** `src/worker/imap.ts` (plain TCP), `src/worker/imaps.ts` (implicit TLS)
**Tests:** `tests/imap.test.ts`

### Correction to the prior IMAP entry in this file

The earlier IMAP entry incorrectly states: *"IMAPS (port 993) is accepted but the socket opens as plain TCP, so TLS-expecting servers close the connection before the greeting."* This is wrong. `src/worker/imaps.ts` implements a complete TLS-wrapped family using `connect(..., { secureTransport: 'on' })`, with four mirrored endpoints under `/api/imaps/*` that are fully functional.

### What was in the original doc

`docs/protocols/IMAP.md` was an implementation plan with a fictional `IMAPClient` TypeScript class (`connect()`, `authenticate()`, `listMailboxes()`, `selectMailbox()`, `fetchMessages()`, `searchMessages()`, `close()`) and a React `IMAPMailboxViewer` component — none of which exist in the codebase. The four actual Worker endpoints were entirely undocumented.

### What the rewrite covers

Replaced the planning doc with an accurate power-user reference:

1. **Eight-endpoint two-family structure** — all four operations (`/connect`, `/list`, `/select`, `/session`) documented for both `/api/imap/*` (plain TCP, port 143) and `/api/imaps/*` (implicit TLS, port 993).

2. **Transport** — plain IMAP uses `connect()` with no TLS options; IMAPS uses `connect(..., { secureTransport: 'on' })`. No STARTTLS supported in either family.

3. **LOGIN only** — `A001 LOGIN {username} {password}` plain text. No SASL, no AUTHENTICATE. Modern providers (Gmail, Outlook, Yahoo) disable LOGIN; they require `AUTHENTICATE XOAUTH2`.

4. **Tag sequence** — hardcoded `A001`/`A002`/`A003` for HTTP endpoints; session starts at `A003` (A001=LOGIN, A002=CAPABILITY consumed during init). Tags use `.padStart(3, '0')` — goes A003…A099, A100…A999, A1000 (4 digits) onward.

5. **`capabilities` format asymmetry** — in `/connect`, the raw multi-line CAPABILITY response including the `A002 OK` tag line; in `/session`, the parsed token string from the `* CAPABILITY` line only.

6. **Greeting timeout asymmetry** — `/connect` has a 5 s inner greeting timeout; `/list` and `/select` have no per-read limit.

7. **LIST regex limitation** — matches only double-quoted delimiter + double-quoted name. NIL delimiters, unquoted atoms, and literal-format names are silently dropped.

8. **SELECT parses EXISTS and RECENT only** — UIDVALIDITY, UIDNEXT, UNSEEN, FLAGS, PERMANENTFLAGS, READ-WRITE not extracted. SELECT always opens READ-WRITE; EXAMINE is session-only.

9. **Mailbox name quoting** — `mailbox` is interpolated verbatim; names with spaces require embedded quotes.

10. **WebSocket session protocol** — both directions documented. LOGOUT sent on close (3 s timeout, silently ignored on error).

11. **IDLE not fully functional** — worker prefixes all commands with a tag; IDLE termination requires untagged `DONE\r\n` which the session cannot send correctly.

12. **Common session commands** — EXAMINE, FETCH, UID FETCH, SEARCH, STORE, MOVE, CREATE, NAMESPACE — documented with example JSON.

13. **curl examples and local test servers** — Dovecot and GreenMail Docker configurations.


---

## LDAP — `docs/protocols/LDAP.md`

**Reviewed:** 2026-02-17
**Source verified against:** `src/worker/ldap.ts` (1031 lines)

### What the doc already covered well

The LDAP doc was already a solid power-user reference — the only protocol doc in the repo that pre-dated this review session in good shape. It correctly documented the filter limitation fallback, the single-read /connect limitation, the 128KB response cap, binary attribute corruption, the BER wire format table, and Active Directory quirks.

### Gaps found and added

1. **`bindDN`/`bindDn` field name inconsistency (source bug).** `/connect` reads the bind DN from `bindDN` (uppercase N). Every other endpoint (`/search`, `/add`, `/modify`, `/delete`) reads `bindDn` (lowercase n). Sending the wrong casing silently falls through to anonymous bind — no error is returned. Added a prominent note in the `/connect` Notes section and in Known Limitations.

2. **`baseDn: ""` rootDSE search broken (source bug).** The `/search` handler validates `if (!baseDn)` which is truthy for an empty string — so passing `"baseDn":""` returns HTTP 400 "baseDn is required". The doc's own rootDSE curl examples used `"baseDn":""` and would have failed at runtime. Added a rootDSE bug callout in the `/search` section, commented out the broken examples with an explanation, and replaced the Testing Locally rootDSE example with `/connect` as the workaround. Added to Known Limitations.

3. **`timeout` (ms) → LDAP `timeLimit` (seconds) conversion.** The `timeout` field is sent to users in milliseconds (default 15000), but the implementation sends `Math.floor(timeout / 1000)` as the LDAP SearchRequest `timeLimit` field. Previously undocumented. Added to the `/search` field table.

4. **`resultCode: -1` on 128KB truncation.** When `readLDAPSearchData` hits the 128KB cap before finding the SearchResultDone tag (`0x65`), the parser returns `resultCode: -1` and `message: ""` (uninitialized defaults). The previous Known Limitations entry said "resultCode may be missing" which was imprecise. Updated to name the actual value (`-1`) and note it returns HTTP 200.

### No implementation changes made
This was a documentation-only review.

## PPTP — docs/protocols/PPTP.md

**What was reviewed:**
- The previous doc was a 28-line generic stub: no endpoints, no request/response schemas, no wire
  format details, no result codes, and nothing specific to the Port of Call implementation.
- The actual implementation (`src/worker/pptp.ts`) has three fully wired endpoints, each performing
  distinct PPTP control-channel exchanges using raw TCP via `cloudflare:sockets connect()`.

**Changes made:**
- Complete rewrite of `docs/protocols/PPTP.md` from 28 lines to a full power-user reference.
- Documented all three endpoints with accurate request/response schemas:
  - `POST /api/pptp/connect` — SCCRQ → SCCRP probe; returns framing/bearer capabilities, firmware
    revision, hostname, vendor, protocol version, separate `connectTime` and `rtt`.
  - `POST /api/pptp/start-control` — Same exchange, different schema: `success` reflects
    `resultCode === 1` (not just TCP connectivity); uses `hostName`/`vendorName` vs `hostname`/
    `vendor`; returns `latencyMs` instead of `connectTime`+`rtt`.
  - `POST /api/pptp/call-setup` — Full SCCRQ→SCCRP→OCRQ→OCRP; exposes `tunnelEstablished`
    independently of `callResult`; reports `peerCallId`, `connectSpeed`, and `note` when call
    is rejected.
- Added complete SCCRP result code table (codes 1–5) and OCRP result code table (codes 1–7).
- Added annotated byte-level wire format tables for all four messages: SCCRQ (156 B), SCCRP
  (156 B), OCRQ (168 B), OCRP (32 B), with field offsets and example values.
- Added framing and bearer capability bitmask tables.
- Documented Cloudflare detection (403 + `isCloudflare: true`) present on all three endpoints.
- Added vendor fingerprinting guide with common vendor strings and products.
- Added Power User Notes: endpoint selection guide, `maxChannels` semantics, `callResult !== 1`
  nuance (tunnelEstablished can be true even when call is rejected), and protocol version encoding.
- Added "What Port of Call does NOT implement" section (GRE, PPP, keep-alive, incoming calls).
- Added curl examples for all three endpoints.

---

## Elasticsearch — `docs/protocols/ELASTICSEARCH.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed
**Implementation:** `src/worker/elasticsearch.ts`
**Endpoints:** `POST /api/elasticsearch/health`, `POST /api/elasticsearch/query`, `POST /api/elasticsearch/https`, `POST /api/elasticsearch/index`, `DELETE /api/elasticsearch/document`, `PUT /api/elasticsearch/create-index`

### What was wrong with the original doc

`docs/protocols/ELASTICSEARCH.md` was titled "Elasticsearch Protocol Implementation Plan" and was entirely a planning artifact:

- Contained a pseudocode `ElasticsearchClient` TypeScript class using `fetch()` calls that don't match any code in the codebase
- Showed `apiKey` as a supported auth field — **not implemented**; only Basic Auth works
- Contained a React `ElasticsearchDashboard` component that does not exist
- No mention of any of the six actual Worker endpoints
- No mention of the two transport modes (raw TCP vs TLS fetch)
- No mention of the 512 KB response cap on the TCP path
- No mention of chunked Transfer-Encoding handling
- `body` parameter described as an object — actually must be a pre-serialized string

### Changes made

Replaced the entire document with an accurate power-user reference:

1. **Two-transport-mode architecture** — documented that `/api/elasticsearch/query` always uses raw TCP HTTP/1.1 (port 9200, plain), while `/api/elasticsearch/https` always uses native `fetch()` with TLS (Elastic Cloud, port 443). The `index`, `delete`, and `create-index` endpoints switch between transports via `https: boolean`.

2. **All six endpoints documented** — exact request field tables and response JSON for each:
   - `/health` — sequential GET `/` + `/_cluster/health`; `clusterHealth` is null (not an error) if health check fails
   - `/query` — arbitrary TCP HTTP/1.1; `body` must be a pre-serialized JSON string, not an object
   - `/https` — TLS `fetch()` equivalent of `/query`; no 512 KB cap
   - `/index` — PUT (with `id`) or POST (without, auto-generates `_id`); `result` field values (`created`/`updated`)
   - `/document` (DELETE) — 404 returns `success: false`
   - `/create-index` — `shards`/`replicas` fields; set `replicas: 0` for single-node clusters

3. **512 KB TCP cap documented** — the TCP response reader stops accumulating at 512,000 bytes; large search responses are silently truncated; HTTPS path has no cap.

4. **`body` is a string, not an object** — the most common integration error; documented explicitly with note to pre-serialize Query DSL.

5. **No API key auth** — the planning doc showed `apiKey` config; the implementation has no such field. Documented as a known limitation.

6. **Cluster health status semantics** — green/yellow/red meanings and what "yellow" means operationally (replica unassigned, data safe).

7. **Common Query DSL patterns** as pre-serialized strings ready to use in `body` — full-text match, time-range filter, top-N aggregation, bool query (must/filter/must_not/should), mapping inspection, `_cat/indices` sorted by size.

8. **Operational quick-reference table** — 23 frequently-needed ES API paths (cluster health, node JVM stats, hot threads, shard allocation, unassigned shard explain, ILM explain, reindex, delete-by-query, alias management, task management) mapped to method + path.

9. **Known Limitations** — no API key auth, 512 KB TCP cap, no streaming/scroll, no PATCH (use POST `_update`), Elastic Cloud requires HTTPS path, `body` must be pre-serialized string.

10. **curl examples** — all six endpoints, including Elastic Cloud (HTTPS/port 443), delete-by-query via generic query endpoint, force-merge.

11. **Local testing** — Docker one-liner for single-node ES with and without auth.

---

## RTSP — `docs/protocols/RTSP.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 3 endpoints
**Implementation:** `src/worker/rtsp.ts`
**Routes:** `POST /api/rtsp/options`, `POST /api/rtsp/describe`, `POST /api/rtsp/session`

### What was wrong with the original doc

`docs/protocols/RTSP.md` was a 35-line stub: an overview, a Resources section with RFC links, and a Notes section with generic protocol facts. Zero endpoint documentation.

### What was improved

Replaced the stub with a complete power-user reference. Key findings from reading `src/worker/rtsp.ts`:

1. **Three-endpoint structure** — documented `POST /api/rtsp/options`, `POST /api/rtsp/describe`, and `POST /api/rtsp/session` with exact request/response JSON, field tables, defaults, and behavioral notes.

2. **`timeout_ms` vs `timeout` naming inconsistency** — `/options` and `/describe` accept `timeout` (ms); `/session` accepts `timeout_ms`. The wrong field name silently falls back to the default (15 s for session, 10 s for others). Documented with a callout.

3. **Digest auth not implemented (critical)** — Basic auth only (`btoa(user:pass)`). Most IP cameras use Digest MD5 (RFC 2617). A 401 with `WWW-Authenticate: Digest ...` is returned as-is; no retry with computed Digest credentials. Documented prominently with a dedicated Auth section.

4. **TCP interleaved only** — SETUP always sends `Transport: RTP/AVP/TCP;unicast;interleaved=0-1`. Cameras that only support RTP/UDP will reject this with 461 (Unsupported Transport) or 400. Documented as a known limitation.

5. **`controlUrl` clobber in multi-track SDP** — The `/describe` SDP parser overwrites `controlUrl` on every `a=control:` line. For two-track SDP (video + audio), only the last track's URL is kept. The session then calls SETUP on the wrong track (last instead of first — typically audio instead of video). Added the camera flow section explaining how to work around this using `sdpRaw`.

6. **`success: true` without PLAY** — The session endpoint sets `success: true` if DESCRIBE returned 2xx, even if SETUP or PLAY failed. `sessionEstablished` correctly reflects only PLAY success. Documented with field table noting the difference.

7. **Fixed 500 ms RTP collection window** — Not configurable. Documented as limitation.

8. **Hardcoded 5 s per-step timeout** — Each RTSP method in the session handler uses a hard `5000 ms` timeout regardless of `timeout_ms`. Documented as limitation.

9. **No `rtt` from `/describe`** — The describe handler returns no timing field; only `/options` and `/session` return `rtt`. Documented in the field table.

10. **Interleaved frame channel convention** — Even channels (0, 2, …) = RTP; odd channels (1, 3, …) = RTCP. Documented so users understand `rtcpPackets` vs `rtpFrames`.

11. **SDP field reference table** — All standard SDP lines with their `sdpInfo` key or "not parsed" status. Includes `a=fmtp:` (H.264 SPS/PPS), `a=framerate:`, and `a=range:` — all not parsed.

12. **RTSP status code table** — 200, 401, 403, 404, 454 (Session Not Found), 455 (Method Not Valid in This State), 461 (Unsupported Transport), 503.

13. **curl examples** — all three endpoints, including explicit URL override for `/session`.

14. **Typical camera flow and workaround** — concrete Hikvision/Dahua/Axis SDP example showing why `controlUrl` ends up as the audio track URL, and how to read `sdpRaw` to extract the correct video `trackID`.

15. **Local testing** — VLC and live555MediaServer as RTSP servers, FFmpeg as stream sender.

---

## FTP / FTPS — `docs/protocols/FTP.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed
**Implementation:** `src/worker/ftp.ts` (842 lines), `src/worker/ftps.ts` (932 lines)
**Tests:** `tests/ftp.test.ts`, `tests/ftps.test.ts`

### What was wrong with the original doc

`docs/protocols/FTP.md` was a planning document. It described a theoretical `FTPClient` class (not the actual one), a React `FTPFileManager` component that does not exist, a note that "FTPS support is planned", and a "Next Steps" list. The 14 actual endpoints across two source files were not documented at all.

### What was improved

Replaced the planning doc with an accurate power-user reference:

1. **Dual-implementation framing** — the first section is a comparison table of the 8 key differences between FTP and FTPS implementations: transport, default port, data channel TLS, whether connect requires credentials, upload body format, download response format, rename param names, list response key name, list entry shape, default path, and delete granularity. This is the most important thing a user migrating from one to the other must know.

2. **All 14 endpoints documented** — 7 FTP (`connect`, `list`, `upload`, `download`, `delete`, `mkdir`, `rename`) and 7 FTPS (`connect`, `login`, `list`, `download`, `upload`, `delete`, `mkdir`, `rename`) with exact request/response JSON, field tables, and defaults.

3. **Upload API asymmetry highlighted** — FTP upload uses `multipart/form-data` (field name `file` + `remotePath`); FTPS upload uses JSON body with base64 `content`. These are completely different content types and cannot be swapped.

4. **Download API asymmetry highlighted** — FTP download returns `application/octet-stream` binary body; FTPS download returns JSON with base64 `content` + `encoding: 'base64'`.

5. **Rename param name difference** — FTP uses `fromPath`/`toPath`; FTPS uses `from`/`to`. A developer copying between the two will get a 400 error.

6. **FTPS delete/mkdir/rename port default bug** — `handleFTPSDelete`, `handleFTPSMkdir`, `handleFTPSRename` all default to `port = 21` instead of `990`. Documented with instruction to pass `port: 990` explicitly.

7. **FTPS connect probe without credentials** — the `/api/ftps/connect` endpoint does not require username/password. The FTP connect endpoint does. Documented the FEAT response structure including `tlsFeatures` boolean map.

8. **Data socket timing** — both implementations open the data socket *before* sending the data command (LIST/RETR/STOR), then await both in `Promise.all`. Documented why (servers can close PASV port quickly), with code snippets showing the pattern for both FTP and FTPS.

9. **LIST parser differences** — FTP uses a 9-field whitespace split (no symlink detection); FTPS uses a regex on the `[dlrwxstST-]{10}` prefix and detects symlinks. Both skip DOS/Windows format listing — affected entries are silently dropped (FTP) or returned as `{ type: 'unknown' }` (FTPS).

10. **Multi-line response parser difference** — FTP `readResponse` checks for `\r\n` end and 4th-char-is-space terminal line detection; FTPS `FTPSSession.readResponse` uses last-line regex and a `timedOut` flag pattern.

11. **FTPS connect readResponse difference** — `handleFTPSConnect` uses a different regex pattern from `FTPSSession.readResponse`. The connect probe's pattern handles only 1-line and 2-line multi-line responses; longer FEAT lists may be truncated.

12. **No STARTTLS / Explicit TLS** — implicit FTPS only; AUTH TLS is not implemented.

13. **Full cross-implementation comparison table** — 8 rows covering all endpoints with FTP and FTPS equivalents side by side.

14. **What is NOT implemented table** — 12 rows: active mode, EPSV, AUTH TLS, MLSD, NLST, SIZE/MDTM, REST resume, APPE, SITE, FTP rmdir, DOS LIST parsing.

15. **curl examples** — 12 one-liners covering all endpoints including the multipart upload, binary download pipe to file, base64 upload from local file, and the explicit `port: 990` workaround for the delete bug.

## InfluxDB — 2026-02-17

**File:** `docs/protocols/INFLUXDB.md`
**Reviewer:** claude-sonnet-4-5-20250929

**What was wrong:**
The doc was a pre-implementation planning artifact. It described a fake `InfluxDBClient`
TypeScript class (with `writePoints()`, `queryRange()`, `aggregate()`, `listMeasurements()`,
`deleteMeasurement()` methods), a `PointBuilder` pattern, and a React `InfluxDBClient`
component — none of which exist in the codebase.

**What was fixed:**
Rewrote from scratch as an accurate reference for the three real HTTP handlers in
`src/worker/influxdb.ts`:

1. **`POST /api/influxdb/health`** — documents that two sequential TCP requests are made
   (`GET /health` + `GET /api/v2/ready`), that `parsed.ready` can be null, and that
   `latencyMs` covers both calls.

2. **`POST /api/influxdb/write`** — documents that `lineProtocol` is a raw Line Protocol
   string (not a structured object), that `precision=ns` is hardcoded, that **204 No Content**
   is the success status (not 200), and includes a complete Line Protocol field-type reference
   (integer `i` suffix, string quoting, boolean literals, batch `\n` separator).

3. **`POST /api/influxdb/query`** — documents that Flux results are **annotated CSV** (not
   JSON), so `parsed` is always `null` on success and the data is in `body`. Includes the
   annotated CSV format and a Flux quick-reference covering range, aggregateWindow, last(),
   pivot, and join patterns.

Added: transport details (raw TCP, no TLS, 512 KB cap, chunked TE), auth section (Token-only,
no Basic Auth, no InfluxQL), and Known Limitations table.

---

## BGP — `docs/protocols/BGP.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 3 endpoints
**Implementation:** `src/worker/bgp.ts`
**Routes:** `POST /api/bgp/connect`, `POST /api/bgp/announce`, `POST /api/bgp/route-table`

### What was wrong with the original doc

`docs/protocols/BGP.md` was a planning document titled "BGP Protocol Implementation Plan" containing:
- A fictional `BGPClient` TypeScript class with `connect()`, `messageLoop()`, `handleOpen()`, `handleUpdate()`, `parsePathAttributes()`, `parseASPath()`, `parseCommunities()`, `parseNLRI()` methods — none of which match the actual code structure
- A fictional `BGPClient.tsx` React component with `localAS`, `remoteAS`, `routerId`, `routes` state, connecting to `/api/bgp/connect` via WebSocket — none of this exists
- Zero documentation of the three actual HTTP POST endpoints
- The planning doc showed `/api/bgp/connect` as WebSocket-only; it is a POST that returns JSON

### What was improved

Replaced the planning doc with an accurate power-user reference:

1. **Three-endpoint structure** — `POST /api/bgp/connect`, `POST /api/bgp/announce`, `POST /api/bgp/route-table` with exact request/response JSON for all cases (OPEN received, NOTIFICATION received, no response).

2. **`success: true` for NOTIFICATION (critical)** — `/connect` returns `success: true` even when the peer sends a NOTIFICATION (rejecting the session). A "Bad Peer AS" rejection returns `success: true, peerOpen: null, notification: {...}`. Documented with the correct check (`peerOpen !== null`).

3. **`localAS` validation difference** — `/connect` rejects localAS > 65535 (HTTP 400); `/announce` and `/route-table` accept full 32-bit ASNs. But `/announce` silently masks to low 16 bits in the wire OPEN with no capability 65 — for 4-byte AS values > 65535 this produces an invalid My AS field.

4. **OPEN with vs without capabilities** — `/connect` and `/announce` send bare OPEN (no optional parameters); `/route-table` sends OPEN with capabilities 1 (Multiprotocol IPv4/Unicast), 2 (Route Refresh), and 65 (4-Octet AS). Documented the AS_TRANS=23456 substitution for 4-byte ASNs in `/route-table`.

5. **AS_PATH 2-byte parse bug** — The UPDATE parser reads AS_PATH segments with 2-byte per-ASN entries. When `/route-table` negotiates 4-Octet AS capability with a peer that sends 4-byte AS_PATH, the parser misinterprets the data, producing garbled AS paths. Documented as the primary correctness limitation.

6. **COMMUNITY attribute not decoded** — Path attribute type 8 (COMMUNITY, RFC 1997) is missing from the switch in `parseUpdateMessage`. Community values (no-export, no-advertise, etc.) are silently dropped.

7. **Single `reader.read()` in `/connect` and `/announce`** — No buffering; split TCP segments (uncommon but possible on high-latency paths) cause silent parse failure.

8. **Hardcoded 10 s session open deadline in `/route-table`** — Independent of `timeout`. Slow BGP peers that take longer than 10 s to send OPEN will fail even with `timeout: 30000`.

9. **`collectMs` and `maxRoutes` caps** — Values above 30000 ms / 10000 routes are silently capped.

10. **Field naming inconsistencies** — `routerId` in `/connect` becomes `bgpId` in `/announce`; `errorSubcode` in `/connect` becomes `errorSubCode` (capital C) in `/announce`.

11. **No TCP MD5** — BGP TCP MD5 (RFC 2385) requires `TCP_MD5SIG` socket option unavailable in Cloudflare Workers. Any peer requiring MD5 silently drops the SYN.

12. **BGP message and path attribute reference tables** — All 4 message types, capability codes 1–128, NOTIFICATION error codes 1–6 with subcodes, path attribute codes 1–7 with decoded field names and format, plus attribute 8 (COMMUNITY) noted as not decoded.

13. **curl examples** — all three endpoints; collectMs=0 trick for capabilities-only probe via `/route-table`.

14. **Local testing** — GoBGP config, BIRD config, and notes on public route servers (PeeringDB, MD5 requirement).

---

## Apache Kafka — `docs/protocols/KAFKA.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 6 endpoints active
**Implementation:** `src/worker/kafka.ts`
**Routes:** `/api/kafka/versions`, `/api/kafka/metadata`, `/api/kafka/produce`, `/api/kafka/fetch`, `/api/kafka/groups`, `/api/kafka/group-describe`

### What was wrong with the original doc

`docs/protocols/KAFKA.md` was an 74-line overview with:
- No endpoint documentation whatsoever — none of the 6 routes mentioned
- Generic protocol description copied from the Kafka spec (RecordBatch field layout, API key list)
- No mention of what the code actually sends or parses
- No request/response shapes
- No known limitations
- Links to KafkaJS (not used) and generic Kafka docs

### What was improved

The document was replaced with a full power-user reference for someone who knows Kafka and wants to understand exactly what this implementation does:

1. **All 6 endpoints documented** — exact request fields (with types, defaults, required/optional), success JSON shapes, and behavioral details for each.

2. **Wire format section** — frame structure (4B size prefix + API key + version + correlation ID + client ID + payload), string encoding (INT16-prefixed UTF-8), how arrays are encoded, and the fixed correlation ID values used (1/2/3 per endpoint).

3. **ApiVersions as version fingerprint** — the `maxVersion` of ApiVersions itself (API key 18) is documented as a Kafka release indicator: maxVersion 0 → Kafka ≤ 0.10.0, 3 → Kafka 2.4+.

4. **CRC32C=0 limitation documented in detail** — CRC32C (Castagnoli) is not available in Web Crypto. The field is zeroed. Documented what different broker configurations do: most accept and commit the message; strict CRC enforcement returns errorCode=2 (CORRUPT_MESSAGE). Clarified that CORRUPT_MESSAGE means the message was **not** committed.

5. **Metadata v0 limitations** — fields added in v1+ (controller, clusterId, rack, isInternal, topicAuthorizedOperations) are not returned. Under-replicated partition detection via `isr.length < replicas.length` documented.

6. **`advertised.listeners` host warning** — broker `host` in metadata comes from broker config, not DNS. Internal hostnames cause external connectivity failures.

7. **Fetch record parsing details** — RecordBatch magic=2 (Kafka 0.11+) only; magic=0/1 silently skipped. zigzag varint decoding for offset delta, timestamp delta, key length, value length, header count. 100-record cap. READ_UNCOMMITTED isolation. highWatermark vs lastStableOffset distinction.

8. **`acks=0` fire-and-forget behavior** — endpoint returns before reading any response; `success:true` and `baseOffset:"0"` always returned for acks=0.

9. **Int64 as strings** — `baseOffset`, `highWatermark`, `lastStableOffset`, `timestampMs` returned as strings to avoid JS number precision loss.

10. **Consumer group lifecycle** — all 5 group states (Empty, PreparingRebalance, CompletingRebalance, Stable, Dead) with meaning. `protocol` field values (range, roundrobin, sticky, cooperative-sticky).

11. **Member assignment not decoded** — `member_metadata` and `member_assignment` BYTES fields are skipped in DescribeGroups; partition-per-consumer data is not surfaced.

12. **ListGroups single-broker scope** — documented that in multi-broker clusters, each broker only knows groups it coordinates; full enumeration requires calling all brokers.

13. **Error codes table** — 9 error codes with names and when they appear.

14. **Known limitations summary** — no SASL, no TLS, one topic/partition per call, CRC=0, all values UTF-8, 100-record fetch cap, old message format not parsed, member assignment not decoded.

15. **Workflow examples** — 6 curl one-liners: version fingerprint, topic list with partition counts, under-replicated partition check, produce, consume, consumer lag calculation, list+describe groups.

16. **Local testing** — Docker command for Apache Kafka 3.7.0 in KRaft mode (no ZooKeeper) with `ADVERTISED_LISTENERS` note for external access.

## SMB — `docs/protocols/SMB.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 10/10 tests passing
**Implementation:** `src/worker/smb.ts`
**Routes:** `/api/smb/connect`, `/api/smb/negotiate`, `/api/smb/session`, `/api/smb/tree`, `/api/smb/stat`

### What was in the original doc

`docs/protocols/SMB.md` was titled "SMB Protocol Implementation Plan" and described a fictional `SMBClient` TypeScript class (with `connect`, `listDirectory`, `readFile`, `writeFile`, `deleteFile`, `createDirectory` methods), a fictional React `SMBClient.tsx` component with a file browser UI, and wrong endpoint paths (`/api/smb/list`, `/api/smb/download`) that do not exist. The five actual endpoints were completely absent from the doc.

### What was improved

Replaced with a complete power-user reference. Key additions:

1. **All 5 endpoints documented** with exact request/response JSON, field tables, and defaults: `/connect` (dialect probe), `/negotiate` (full metadata), `/session` (anonymous null-session), `/tree` (TREE_CONNECT), `/stat` (file attribute query).

2. **NetBIOS session framing** — documented the mandatory 4-byte prefix (`0x00` + 3-byte big-endian length) required even on port 445 direct TCP.

3. **Negotiate response body layout** — field-by-field table per [MS-SMB2] §2.2.4: `serverGuid` (128-bit → `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`), `securityMode` (bits 0/1 = SigningEnabled/SigningRequired), `capabilities` (7 named bits), `systemTime` (Windows FILETIME conversion formula documented).

4. **Dialect code table** — hex codes 0x0202–0x0311 mapped to names and Windows versions.

5. **Anonymous NTLMSSP sequence** — documented the two-round SPNEGO/NTLMSSP exchange used by `/session`, `/tree`, and `/stat`: NTLMSSP type 1 (32 bytes, flags `0x60088215`) wrapped in SPNEGO `negTokenInit`, followed by type 3 anonymous (72 bytes, all credential buffers empty) wrapped in `negTokenResp`.

6. **Session flags** — bit table: `0x0001` guest, `0x0002` null session, `0x0004` encrypted.

7. **FileBasicInformation parsing offsets** — documented the QUERY_INFO response offset calculation: NetBIOS 4 + SMB2 header 64 + `OutputBufferOffset` (from body+2, relative to SMB2 message start).

8. **FileId extraction offset** — CREATE response body starts at `4 + 64 + 64 = 132` from packet start; FileId is 16 bytes at that offset.

9. **`fileAttributes` hex table** — 14 standard FILE_ATTRIBUTE_* values.

10. **Common NTSTATUS error codes** — 0xC0000022 (ACCESS_DENIED), 0xC0000034 (OBJECT_NAME_NOT_FOUND), 0xC0000039 (OBJECT_PATH_INVALID), 0xC00000CC (BAD_NETWORK_NAME).

11. **Timeout architecture** — documented outer wall-clock + 5 s inner per-step + 65 536-byte buffer cap; noted that `/stat` runs 6 sequential reads and can fail at the outer limit even if each individual step is fast.

12. **SMB1 fallback** in `/negotiate` — server returning `\xFF SMB` signature instead of `\xFE SMB` is detected and reported as `dialect: "SMB 1.x (CIFS)"` with empty GUID/capabilities.

13. **SessionId truncation gotcha** — `parseSMB2ResponseHeader` reads SessionId as a `uint32` (not `uint64`), so only the low 32 bits are returned in the `sessionId` field.

14. **UTF-16LE path encoding** — share paths (TREE_CONNECT) and file names (CREATE) are encoded as UTF-16LE, not ASCII or UTF-8.

15. **curl examples** for all 5 endpoints, Samba local test setup, and known limitations (no authenticated sessions, no signing enforcement, no READ/WRITE, no enumeration, port 139 not supported).

## Doc Review — Modbus TCP (claude-sonnet-4-5-20250929)
- [x] Modbus TCP (502) — Replaced planning doc with accurate power-user reference. (DONE)

**What was in the original doc:**
- A "Modbus TCP Protocol Implementation Plan" with a fake `ModbusTCPClient` TypeScript class,
  `ModbusConfig` interface, React `ModbusDashboard` component, and a single endpoint name
  `/api/modbus/read-holding-registers` — none of which exist in the codebase. Write endpoints
  were not mentioned at all.

**What the actual implementation has (src/worker/modbus.ts):**
Four endpoints, all using raw TCP via `cloudflare:sockets connect()`:
- `POST /api/modbus/connect` — Connectivity probe via FC 0x03 (read holding register 0); uniquely,
  returns `success: true` even when the server responds with a Modbus exception (exception proves
  reachability). Response includes `testRegister` value or `exception` message.
- `POST /api/modbus/read` — General read for FC 0x01/0x02/0x03/0x04; rejects write FCs at HTTP
  400. Returns `values` as boolean[] for coils or number[] for registers; includes `format` and
  `functionName` fields.
- `POST /api/modbus/write/coil` — FC 0x05 Write Single Coil; `value` accepts bool or 0/1; wire
  encoding: ON=0xFF00, OFF=0x0000; response includes `coilValue` (raw 16-bit echo) and `written`.
- `POST /api/modbus/write/registers` — FC 0x10 Write Multiple Registers; max 123 registers per
  request; response echoes `startAddress` and `quantity`.

**Changes made to docs/protocols/MODBUS.md:**
- Complete rewrite from 285 lines (planning doc) to comprehensive power-user reference.
- Documented all 4 endpoints with accurate request/response schemas, field tables, and defaults.
- Documented key implementation subtleties:
  - Timeout architecture: outer `timeout` param wraps a hardcoded inner 5 s read timeout;
    write endpoints default `timeout` to 5000 (not 10000).
  - Transaction ID is a module-level counter (not per-connection), wraps at 0xFFFF.
  - `quantity` limits: 2000 for coils/discrete inputs, 125 for holding/input registers.
  - No FC 0x06 (Write Single Register) — workaround: use `/write/registers` with one element.
  - `/connect` uses `success: true` even on Modbus exception (exception = reachable).
- Added Modbus data model table (4 object types, FC read/write, address space).
- Added 0-based vs. 1-based addressing explanation (PDU vs. Modicon 4xxxx convention).
- Added power user notes: unit ID semantics for gateways, 32-bit value reassembly, register
  scanning technique, `functionName` field behavior.
- Added local testing instructions (Docker, pymodbus).
- Added "What Port of Call does NOT implement" section (FC 0x06, 0x0F, 0x08, RTU/ASCII, etc.).
- Added Cloudflare detection note (403 + `isCloudflare: true` on all 4 endpoints).
- Added curl examples for all 4 endpoints.

---

## RSH — `docs/protocols/RSH.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 6/6 tests passing
**Source:** `src/worker/rsh.ts` — 4 exported handlers

### What was in the original doc

`docs/protocols/RSH.md` was a protocol explanation doc (background, `.rhosts` auth, privileged port requirement, security context) that referenced implementation file and mentioned two endpoints by name, but had:

- No request/response JSON schemas for any endpoint
- No curl examples
- `/api/rsh/probe` mentioned only in passing
- `/api/rsh/trust-scan` entirely absent
- WebSocket tunnel (`/api/rsh/execute` with `Upgrade: websocket`) entirely absent

### What was improved

Replaced with a complete API reference covering all four wired endpoints:

1. **`/api/rsh/execute` (HTTP)** — full request field table (host, port, localUser, remoteUser, command, timeout), success and rejection response schemas, all response fields documented (`serverAccepted`, `output`, `serverMessage`, `privilegedPortRejection`, `rtt`), output collection behavior (10 chunks / 2 s).

2. **`/api/rsh/execute` (WebSocket)** — query params, data flow description (TCP→WS binary chunks, WS→TCP stdin forwarding), WebSocket close semantics, note about `\0` acceptance byte in first message.

3. **`/api/rsh/probe`** — lightweight port probe sending empty command; `portOpen`/`accepted`/`serverByte`/`serverText`/`latencyMs` response fields; comparison with `/execute`.

4. **`/api/rsh/trust-scan`** — pair generation logic (nested loops capped at `maxPairs`), default user lists, concurrent `Promise.all` execution, `summary.trustedPairs` shortcut, three distinct `note` messages, response schema.

5. **Wire exchange diagrams** — accepted session and privileged port rejection.

6. **curl examples** — five one-liners covering probe, execute (GET and POST), trust scan (default and custom), wscat WebSocket example.

7. **Implementation notes** — output collection internals, `/probe` vs `/execute` default user difference, privileged port keyword mismatch (`permission` substring in `/execute` vs stricter `permission denied` regex in `/probe`+`/trust-scan`).

8. **Known limitations** — no stderr channel, no privileged source port, output truncation, no interactive session in HTTP mode.

## MongoDB — `docs/protocols/MONGODB.md`

**Reviewed:** 2026-02-17
**Implementation:** `src/worker/mongodb.ts`

### What was in the original doc

`docs/protocols/MONGODB.md` was titled "MongoDB Protocol Implementation Plan" and contained a `MongoDBClient` TypeScript class (importing from the `mongodb` npm library), a React `MongoDBClient` component with sidebar database/collection browser and query textarea, an `AggregationBuilder` React component with visual pipeline stages, and a "Next Steps" checklist. None of this existed in the codebase. The actual Worker endpoints were entirely absent. The doc described WebSocket communication with a `ws.current?.send()` pattern.

### What was improved

Replaced the planning doc with an accurate endpoint reference. Key additions:

1. **Six-endpoint structure** — documented `POST /api/mongodb/connect`, `/ping`, `/find`, `/insert`, `/update`, and `/delete` with exact request/response JSON, field tables, defaults, and edge cases.

2. **OP_MSG wire format** — documented the full 21-byte frame header (messageLength + requestID + responseTo + opCode 2013 + flagBits + sectionKind), OP_REPLY fallback at offset 36, and the `readFullResponse` TCP accumulation pattern.

3. **Two BSON encoders** — `encodeBSON` (simple: int32/double/string/boolean, used for command frames) vs. `encodeBSONFull` (recursive: adds null/object/array, used for user data). Power users need to know which encoder handles their data: INT64 cannot be sent (encodes as lossy DOUBLE outside int32 range).

4. **BSON decoder type table** — documented all 11 decoded types with their JavaScript representations, including ObjectId → 24-char hex, DATETIME → ISO string, TIMESTAMP → `{timestamp, increment}` object (not a date), INT64 → `hi * 0x100000000 + lo` (precision loss above 2⁵³).

5. **Hello-before-every-command** — every data endpoint (find/insert/update/delete) opens a fresh TCP connection and sends `{ hello: 1, $db: database }` before the actual command. Two round trips per request. No connection pooling.

6. **Cursor paging limitation** — `hasMore: true` is detected from a non-zero cursor ID, but there is no `/getMore` endpoint. Results are always limited to the first page (max 100 documents). Workaround options documented.

7. **Update wire format** — `update` command uses `updates: [{ q: filter, u: update, multi, upsert }]` (array form, single spec per request). `multi: false` → updateOne; `multi: true` → updateMany.

8. **Delete wire format** — `deletes: [{ q: filter, limit }]` where `limit=1` is deleteOne, `limit=0` is deleteMany (MongoDB's convention for limit-zero meaning no limit on deletions).

9. **Inconsistent Cloudflare detection** — `/connect`, `/update`, and `/delete` check for CF-hosted targets (return 403). `/find` and `/insert` do not perform this check.

10. **No authentication, no TLS** — documented clearly with error behavior: servers with `--auth` will return Unauthorized on data commands; TLS servers will reject the plain TCP connection.

11. **`readOnly` null behavior** — `readOnly` in the connect response is `null` unless explicitly set by the server, which is uncommon for standalone deployments.

## Doc Review — SMB (claude-sonnet-4-5-20250929, 2026-02-17, DONE)
- [x] SMB (445) — Reviewed docs/protocols/SMB.md against src/worker/smb.ts (1228 lines, 5 endpoints). The planning doc had already been replaced by another agent with a comprehensive reference. Added one missing known bug: duplicate /api/smb/stat route in index.ts (registered at lines 879 and 883 — both call handleSMBStat, so behavior is correct but the second entry is dead). Confirmed all 5 endpoints documented: /connect (GET|POST, basic negotiate), /negotiate (full negotiate: GUID/securityMode/capabilities/systemTime/SMB1 fallback), /session (anonymous NTLMSSP null-session: NEGOTIATE + SESSION_SETUP×2), /tree (adds TREE_CONNECT: shareType DISK/PIPE/PRINT), /stat (adds CREATE + QUERY_INFO FileBasicInformation + CLOSE: 4 timestamps + fileAttributes). Verified: NTLM_FLAGS=0x60088215, timeout defaults (30000ms connect, 10000ms others), 64KiB readResponse cap, sessionId 32-bit truncation, FILETIME conversion formula, STATUS_MORE_PROCESSING 0xC0000016, SecurityMode bits, capability bits, FileBasicInformation layout.

---

## SMB — `docs/protocols/SMB.md`

**Reviewed:** 2026-02-17
**Source verified against:** `src/worker/smb.ts` (1228 lines)

### What the original doc was

A planning/pseudocode document titled "SMB Protocol Implementation Plan" — 900+ lines of aspirational TypeScript (`SMBClient` class, React UI component) that was never built. Described endpoints like `/api/smb/list`, `/api/smb/download`, full SESSION_SETUP with credentials, file read/write/delete — none of which exist.

### What was actually implemented

Four endpoints, all using anonymous NTLMSSP null-session authentication:

1. **`POST /api/smb/connect`** — SMB2 NEGOTIATE → dialect detection
2. **`POST /api/smb/negotiate`** — Full NEGOTIATE: server GUID, security mode, capability flags decoded, Windows FILETIME system time, SMB1 fallback banner grab
3. **`POST /api/smb/session`** — NEGOTIATE → SESSION_SETUP × 2 with SPNEGO-wrapped NTLMSSP (anonymous AUTHENTICATE): detects whether server allows null sessions; returns sessionFlags (Guest/null session/encrypted bits)
4. **`POST /api/smb/stat`** — NEGOTIATE → SESSION_SETUP × 2 → TREE_CONNECT → CREATE (read-attributes) → QUERY_INFO (FileBasicInformation) → CLOSE: returns four FILETIME timestamps + fileAttributes hex string

### Key implementation details documented

- **NetBIOS framing:** Every TCP message starts with a 4-byte `\x00 + 3-byte-BE-length` header, required on port 445 as well as 139.
- **ClientGUID:** Not random — it's `(i * 17 + 0xAB) & 0xFF` for bytes 0–15 of the 16-byte GUID field. Same value on every request.
- **CreditRequest:** Always 31 in all SMB2 request headers (hardcoded).
- **NTLM flags:** `0x60088215` — Unicode, OEM, NTLM, AlwaysSign, 56-bit, 128-bit.
- **sessionId truncation:** All endpoints read only `getUint32(40, true)` from the 64-bit SessionId field — the high 32 bits are discarded. Adequate for most anonymous sessions.
- **FILETIME precision:** `/negotiate` uses `(ftHigh * 0x100000000 + ftLow) / 10000` (floating point, may lose precision for times near year 2038+). `/stat` uses the safer `(hi * 4294967296 + lo) / 10000`.
- **SMB1 fallback:** `/negotiate` checks for `\xFF SMB` signature in the server's response to the SMB2 NEGOTIATE. No separate SMB1 NEGOTIATE is sent.
- **`/connect` has no port validation** (no `1 ≤ port ≤ 65535` check). `/negotiate` validates port range.
- **`/connect` HTTP status:** Returns 500 when `success: false`. All other endpoints return 200 regardless.
- **Inner timeouts:** `/connect` hardcodes 5-second read, `/negotiate` hardcodes 6-second read; each SESSION_SETUP round has a hardcoded 5-second read. The `timeout` parameter only controls the outer `Promise.race`.
- **`/stat` CREATE:** Uses `DesiredAccess = 0x00120080` (READ_ATTRIBUTES | SYNCHRONIZE) and `CreateDisposition = FILE_OPEN` — never creates files.
- **File ID extraction in `/stat`:** Offset 132 from packet start = NetBIOS(4) + SMB2 header(64) + CREATE response body(64) = the FileId field.

### Complete rewrite
Replaced 900 lines of pseudocode with an accurate power-user reference: endpoint schemas, wire format, NTSTATUS error table, capability flags, file attribute bitmask, security mode flags, share type codes, curl examples, and known limitations.

## AMQP — `src/worker/amqp.ts`

**Reviewed:** 2026-02-17
**Protocol:** AMQP 0-9-1 (RabbitMQ dialect)
**File:** `src/worker/amqp.ts`

### What was reviewed

The AMQP implementation correctly handled the full AMQP 0-9-1 connection handshake (protocol header, SASL PLAIN auth, Tune/TuneOk, Open/OpenOk, Channel.Open/OpenOk) and graceful shutdown. Three endpoints were implemented: connect (probe), publish (Basic.Publish, fire-and-forget), and consume (Basic.Consume, push-based collection). However, three features that power users rely on for production RabbitMQ work were absent: publisher confirms, queue binding, and synchronous pull (Basic.Get). The exchange type was also hardcoded to `"direct"`.

### Gaps identified

1. **No publisher confirms** — `Confirm.Select` (class 85, method 10) is a RabbitMQ extension that makes the broker ACK every published message after durable storage. Without it there is no way to know if a publish succeeded.

2. **Exchange type hardcoded to `"direct"`** — `buildExchangeDeclare` always passed `"direct"` to the broker. Publishing to a fanout or topic exchange was not possible through the existing API.

3. **No `Queue.Bind`** — For any exchange type other than the default exchange, the bind step is mandatory. There was no `/api/amqp/bind` endpoint.

4. **No `Basic.Get`** — The only consumer was the push-based `Basic.Consume` endpoint. For polling patterns (pulling a single job, checking queue depth, peeking without consuming) the synchronous `Basic.Get` / `Basic.GetOk` / `Basic.GetEmpty` flow is the standard tool.

5. **`docs/protocols/AMQP.md` was a generic stub** — The existing doc was a 79-line generic AMQP overview with no endpoint documentation, no request/response examples, and no wire protocol details.

### Changes made

**Publisher confirms (`Confirm.Select`, class 85)**
- New constants: `CLASS_CONFIRM = 85`, `METHOD_CONFIRM_SELECT = 10/11`, `METHOD_BASIC_ACK = 29`, `METHOD_BASIC_NACK = 120`
- `buildConfirmSelect()` and `buildBasicAck()` frame builders
- `handleAMQPConfirmPublish` — POST `/api/amqp/confirm-publish`; returns `{ acked, deliveryTag, multiple, latencyMs }`

**Exchange type parameter**
- `buildExchangeDeclare(exchange, type, durable)` updated to accept `type` and `durable`
- Both publish handlers accept `exchangeType` and `durable` in the request body

**Queue.Bind (class 50, method 20)**
- `buildQueueBind(queue, exchange, routingKey)` frame builder
- `handleAMQPBind` — POST `/api/amqp/bind`; returns `{ queue, exchange, routingKey, vhost, latencyMs }`

**Basic.Get (class 60, method 70)**
- New constants: `METHOD_BASIC_GET = 70`, `METHOD_BASIC_GET_OK = 71`, `METHOD_BASIC_GET_EMPTY = 72`
- `buildBasicGet(queue, noAck)` frame builder
- `handleAMQPGet` — POST `/api/amqp/get`; handles GetOk + HEADER + BODY frames, GetEmpty, and optional explicit Basic.Ack; returns `{ empty, message: { deliveryTag, redelivered, exchange, routingKey, messageCount, body, bodySize }, latencyMs }`

**Routing in `src/worker/index.ts`**
- Import and three new routes wired: `/api/amqp/confirm-publish`, `/api/amqp/bind`, `/api/amqp/get`

**`docs/protocols/AMQP.md` rewritten**
- Replaced generic 79-line stub with accurate power-user reference covering all six endpoints, wire protocol frames, and known limitations

### Endpoints after review

| Endpoint | Method | Description |
|---|---|---|
| /api/amqp/connect | POST | Protocol probe — handshake only |
| /api/amqp/publish | POST | Publish (fire-and-forget) |
| /api/amqp/confirm-publish | POST | Publish with broker ACK (publisher confirms) |
| /api/amqp/bind | POST | Bind queue to exchange |
| /api/amqp/get | POST | Synchronous pull (Basic.Get) |
| /api/amqp/consume | POST | Push consumer (Basic.Consume, multi-message) |

## Cassandra — 2026-02-17

**File:** `docs/protocols/CASSANDRA.md`
**Reviewer:** claude-sonnet-4-5-20250929

**What was wrong:**
The doc was a 579-line planning artifact titled "Cassandra Protocol Implementation Plan". It
contained a fake `CassandraClient` TypeScript class with 20+ methods (`query()`, `prepare()`,
`execute()`, `parseResult()`, `listKeyspaces()`, `createKeyspace()`, etc.) none of which exist
in the codebase. It also included a React `CassandraClient` component and extensive pseudocode
examples against an OOP API that was never built.

**What was fixed:**
Rewrote from scratch as an accurate reference for the three real handlers in
`src/worker/cassandra.ts`:

1. **`POST /api/cassandra/connect`** — Documents OPTIONS+STARTUP probe without auth, Cloudflare
   detection (only this endpoint), response fields (`connectTime` vs `rtt`, `protocolVersion`
   from masked OPTIONS response byte, `compression` from SUPPORTED multimap,
   `startupResponse` opcode name). Clarifies that auth is *detected* but not *attempted* here.

2. **`POST /api/cassandra/query`** — Documents SASL PLAIN auth flow (AUTH_RESPONSE stream=2),
   fixed consistency=ONE and page_size=100 constraints, and — critically — that **all row
   values are decoded as raw UTF-8 bytes regardless of CQL type**. Added a type table showing
   which CQL types decode cleanly (text/varchar/ascii) vs. which produce garbage (int, bigint,
   uuid, etc.) and the `CAST(col AS text)` workaround. Documents UDT/tuple parse risk.

3. **`POST /api/cassandra/prepare`** — Documents PREPARE+EXECUTE flow in a single connection,
   `preparedIdHex` response field, that bound `values[]` are all serialized as UTF-8 strings
   with same type-decoding caveats, stream IDs (3 for PREPARE, 4 for EXECUTE).

Added: full wire protocol reference (9-byte header layout, stream ID assignments, opcode table
with all 16 opcodes including unimplemented ones, RESULT kind table, ERROR code table with
hex codes and names, complete CQL type ID table), authentication details (SASL PLAIN token
format, supported authenticator class names, what's not supported), Known Limitations table
(10 entries covering no TLS/compression/paging/BATCH/REGISTER, string-only binding, UDT risk,
Cloudflare detection scope), and CQL quick-reference for system table introspection.

---

## Apache Kafka — `src/worker/kafka.ts`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 7 endpoints
**Endpoints before:** `/api/kafka/versions`, `/api/kafka/metadata`, `/api/kafka/produce`, `/api/kafka/fetch`, `/api/kafka/groups`, `/api/kafka/group-describe`
**Endpoints after:** + `/api/kafka/offsets`

### What was wrong with the original doc

`docs/protocols/KAFKA.md` was a 74-line stub covering only the wire format header layout, a list of API key numbers, and the RecordBatch field structure. It did not document any of the six actual Worker endpoints, their request/response schemas, the ApiVersions capability-discovery response, the RecordBatch hard limit, the CRC32C = 0 limitation, the consumer group state machine, or any known limitations.

### What was found in the implementation

Solid binary protocol foundation: proper size-prefixed TCP framing with a full accumulator (`readKafkaResponse`) that waits for the complete response before parsing — no single-read truncation. ProduceRequest uses RecordBatch v2 (magic=2) with correct zigzag varint encoding for record fields. FetchResponse v4 has a full RecordBatch parser with zigzag varint decode, handling multi-batch responses and the aborted-transactions array (v4 addition). Consumer group APIs use v0 — stable and compatible.

### Missing endpoint found: ListOffsets

A power user's first question after getting Metadata is: "What is the current end offset of this partition?" and "What was the earliest retained offset?" Without ListOffsets, the only way to answer is to blind-fetch from offset 0 and look at `highWatermark` in the response — which fails if offset 0 is below the log start (retention has deleted it) with `OFFSET_OUT_OF_RANGE`. This is the most common reason fetch fails against production Kafka.

Added `handleKafkaListOffsets` implementing **ListOffsets v1** (API key 2, available on Kafka 0.10.1+):

- `timestamp: -1` → high watermark (next offset to be written; last written message is at `offset - 1`)
- `timestamp: -2` → log start offset (earliest retained; fetch from here if you get `OFFSET_OUT_OF_RANGE`)
- `timestamp: <unix_ms>` → first offset at or after that timestamp (enables time-based log scanning)

Wired at `POST /api/kafka/offsets`.

### Other notable findings documented in the rewritten doc

1. **100-record Fetch hard limit** — `parseRecordBatches(slice, 100)` stops at 100 records regardless of `maxBytes`. Not documented anywhere. Power users consuming large topics must issue repeated Fetch calls advancing `offset` by `recordCount`.

2. **CRC32C = 0 on produce** — The code comment notes this, but the prior doc was silent. Error codes 2 AND 87 both mean `CORRUPT_MESSAGE` (the error code table had them listed as two separate entries with the same name — correct, documented in full). Most brokers skip CRC validation on inbound Produce; error only appears on strict configurations.

3. **Advertised listener trap** — Metadata returns the broker's advertised listener address, which is typically an internal hostname. Fetching/producing against a cloud cluster always requires pointing at a specific broker's external address. Documented prominently because it's the #1 reason metadata succeeds but produce/fetch fails.

4. **acks=-1 encoding** — `view.setInt16(pOff, acks)` with `acks=-1` correctly encodes `0xFFFF` as a signed INT16, which Kafka interprets as `acks=all`. Verified correct.

5. **Compression in fetch not supported** — RecordBatch attributes bits 0-2 control compression. The parser reads records directly without decompression. Compressed batches (GZIP/Snappy/LZ4/Zstd) will produce empty or corrupted records. Documented as a known limitation.

6. **Consumer group states** — `Empty`, `PreparingRebalance`, `CompletingRebalance`, `Stable`, `Dead` with meanings. Protocol field is the partition assignment strategy name.

### What was improved in the doc

Replaced the 74-line stub with a full power-user reference: seven-endpoint API reference with exact request/response JSON; wire protocol framing; ApiVersions capability-version guide; Metadata partition health interpretation (ISR shrinkage, preferred leader election pending); ListOffsets sentinel values and high-watermark vs. log-start semantics; Produce CRC limitation and acks=-1 encoding; Fetch hard limit and OFFSET_OUT_OF_RANGE handling; RecordBatch wire format with zigzag varint layout; consumer group state table; error code reference; curl examples for all seven endpoints; Docker local testing setup; 10-entry known limitations list.

---

---

## Cassandra CQL Native Protocol — `docs/protocols/CASSANDRA.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed
**Implementation:** `src/worker/cassandra.ts` (743 lines)
**Tests:** `tests/cassandra.test.ts`

### What was wrong with the original doc

`docs/protocols/CASSANDRA.md` was a planning document describing a fictional `CassandraClient` TypeScript class using the `cassandra-driver` npm package, a React component, and a "service discovery" pattern. None of this exists in the codebase. The three actual endpoints were entirely absent, and the binary CQL wire protocol was not documented at all.

### What was improved

Replaced the planning doc with an accurate power-user reference for readers familiar with Cassandra:

1. **Frame format reference** — documented the 9-byte header (`version | flags | stream(BE) | opcode | length(BE)`), the client version byte (`0x04`), the response bit (`0x80`), hardcoded stream IDs per operation (0 for OPTIONS/STARTUP, 2 for AUTH_RESPONSE, 3 for QUERY/PREPARE, 4 for EXECUTE), and a full opcode reference table.

2. **Handshake sequence** — documented the OPTIONS → SUPPORTED → STARTUP → READY/AUTHENTICATE flow. Noted that `CQL_VERSION` is hardcoded to `"3.0.0"` regardless of what SUPPORTED advertised.

3. **All three endpoints documented** — `/api/cassandra/connect`, `/api/cassandra/query`, `/api/cassandra/prepare` with exact request/response JSON, field tables, and defaults.

4. **Column type decoding limitations** — the most critical power-user gotcha: all cell values are decoded via `TextDecoder` regardless of CQL type. Only `text`, `varchar`, and `ascii` columns return readable values. All numeric types (int, bigint, float, double, smallint, tinyint, counter), booleans, timestamps, UUIDs, inet, date, time, and binary types produce garbled output. Documented with a 21-row type table showing hex code, name, and what the caller actually receives.

5. **Collection type handling** — `list` and `set` consume 2 bytes for the element type code but do not decode the actual values. `map` consumes 4 bytes. `udt` and `tuple` do not consume subtype bytes at all, likely causing the parser to crash on those columns. Documented in the type table.

6. **Consistency hardcoded to ONE** — no way to specify QUORUM, LOCAL_QUORUM, ALL, etc. Documented as a table in the QUERY frame parameters section.

7. **Page size hardcoded to 100** — responses with more than 100 rows are truncated; no `paging_state` is captured or returned. Documented.

8. **Prepared statement limitations** — all bound values are UTF-8-encoded regardless of actual CQL type. Only text/varchar/ascii parameters work. Non-string bound values (int, boolean, timestamp, uuid) cause server-side deserialization errors. Documented with the EXECUTE frame body structure.

9. **`preparedIdHex` is per-connection** — prepared statement IDs are not cached across HTTP requests. Each `/prepare` call opens a fresh connection.

10. **`startupError` with `success: true`** — if STARTUP returns an ERROR frame, the connect endpoint returns `success: true` with a `startupError` field rather than `success: false`. Documented with a note to check `startupError`.

11. **`readExact` behavior** — the frame reader loops until exactly the requested byte count arrives. No per-read timeout inside `readExact`; only the outer `timeout` applies. Documented.

12. **Error code reference** — 15-row table of CQL error codes (hex and decimal) with names.

13. **USE keyspace absent** — all table references must be fully qualified (`keyspace.table`). Bare table names return error code 8704. Documented.

14. **No TLS** — plain TCP only; port 9142 (native TLS) will fail.

15. **curl examples** — 7 one-liners: connect probe, auth check, list keyspaces, list tables, query with auth, prepared statement, peer topology, local node info.

## Telnet — `docs/protocols/TELNET.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 9/9 tests passing
**Implementation:** `src/worker/telnet.ts`
**Tests:** `tests/telnet.test.ts`

### What was in the original doc

`docs/protocols/TELNET.md` was a planning artifact titled "Telnet Protocol Implementation Plan." It contained an aspirational `TelnetClient` TypeScript class (with `connect()`, `processBuffer()`, `handleCommand()`, `handleSubnegotiation()`, `sendWindowSize()`, and `getData()` methods), a `telnetTunnel()` WebSocket wrapper, a React `TelnetTerminal` component polling data every 50ms via `setInterval`, and a `isTelnetAllowed()` IP prefix filter that only allowed private network connections — none of which exists in the actual implementation. The real four handlers and their exact behaviors were entirely absent.

### What was improved

Replaced the planning doc with an accurate power-user reference. Key additions:

1. **Dual-behavior `/connect` path** — documented that `GET/POST /api/telnet/connect` and `WebSocket /api/telnet/connect` are the same path, disambiguated by the `Upgrade: websocket` header check in the router, with separate request/response schemas for each.

2. **WebSocket raw tunnel behavior** — documented that `pipeTelnetToWebSocket` passes bytes as-is (`"For now, pass data through as-is"` comment in source), that server→browser frames are raw binary (not JSON-wrapped), and that browser→server accepts both `string` (UTF-8 encoded) and `ArrayBuffer` input.

3. **`/negotiate` IAC policy table** — exact accept/reject rules: WILL ECHO → DO, WILL SGA → DO, WILL other → DONT; DO TERMINAL-TYPE → WILL + SB VT100; DO NAWS → WILL + SB 80×24; DO other → WONT; WONT/DONT → no response. All responses batched into a single write.

4. **`/negotiate` collection limit** — documented the 3-chunk/3-second cap and its implication for servers that spread IAC across many segments.

5. **`/login` IAC policy** — documents that the login handler refuses ALL options (DO→DONT, WILL→WONT), preventing echo suppression negotiation. Contrast with `/negotiate` which selectively accepts ECHO and SGA.

6. **Sub-timeout arithmetic bug** — documented that `/login` sub-timeouts (8s+6s+6s=20s) can exceed the default 15s outer `timeout` because they are applied sequentially against each step's deadline, not against a shared remaining budget.

7. **Authentication heuristic** — exact logic (`$`/`#`/`>` present AND no error keywords), with documented false-positive/negative scenarios.

8. **`parseTelnetIAC` utility** — documented the exported function signature and what it handles vs. what the endpoint handlers inline separately.

9. **Complete IAC wire-format reference** — all 7 command bytes with hex values, 14-entry option name table, wire format examples for simple negotiation, terminal-type SB, and NAWS SB.

---

## Echo — `docs/protocols/ECHO.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 9/9 tests passing
**Source:** `src/worker/echo.ts` — 2 exported handlers

### What was in the original doc

`docs/protocols/ECHO.md` was titled "Echo Protocol Implementation Plan" and contained planning pseudocode: a fake `echoTest()` function at a nonexistent path `src/worker/protocols/echo.ts`, a fake `validateEchoRequest()` SSRF-blocking function, fake rate-limiting stubs, a React `EchoClient` component, and a "Next Steps" list. None of this exists. The actual routes (`POST /api/echo/test`, `GET /api/echo/connect`) were absent.

### What was improved

1. **Both endpoints documented** — `POST /api/echo/test` (HTTP one-shot) and `GET /api/echo/connect` (WebSocket tunnel) with exact request/response JSON schemas, all validated fields, HTTP status codes per validation path.

2. **Single-read limitation documented** — `/test` issues exactly one `reader.read()` after sending. Multi-segment responses produce `match: false` even when the server is behaving correctly. This is the most common source of confusion for users testing large messages.

3. **Shared timeout architecture** — Both `socket.opened` and `reader.read()` race against the same timeout promise. If connection takes 9 of 10 s, only 1 s remains for the read. Documented with a visual timeline.

4. **`match: false` with `success: true`** — The response shape diverges: mismatch sets `success: true` + adds `error` explaining the mismatch; connection failure sets `success: false` + sets `sent: "", received: "", rtt: 0`. Both cases include `error`.

5. **No Cloudflare detection** — Unlike most Port of Call endpoints, the echo handler does not call `checkIfCloudflare`. Documented as a known limitation.

6. **WebSocket binary data loss** — TCP → WS direction decodes chunks to string via `TextDecoder`. Binary echo servers will have non-UTF-8 bytes replaced. Documented.

7. **No GET form for `/test`** — POST only; no query-param variant.

8. **curl examples + socat local server** — including a test to observe the single-read limitation on large messages.

## Source RCON — `docs/protocols/SOURCE_RCON.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 20/20 tests passing
**Implementation:** `src/worker/rcon.ts`
**Routes:** `POST /api/rcon/connect`, `POST /api/rcon/command`

### What was in the original doc

`docs/protocols/SOURCE_RCON.md` was titled "Source RCON (Steam/Valve) Protocol Implementation" and was primarily a game administration guide: lists of game-specific commands for CS:GO, TF2, GMod, server.cfg snippets, rcon-cli testing instructions, "Future Enhancements" lists, and a Protocol History section. The actual API request/response JSON was entirely absent. The doc mentioned "reuses the existing RCON protocol handler at `src/worker/rcon.ts`" but never documented the endpoint paths or response shapes.

### What was improved

Replaced with an accurate endpoint reference. Key additions:

1. **Correct endpoint paths** — `/api/rcon/connect` and `/api/rcon/command` (not game-specific paths). Tests hit these paths; the doc was silent on actual route names.

2. **Default port bug documented** — both handlers default to `port: 25575` (Minecraft RCON), not 27015 (Source engine). The original doc stated "default port 27015" without noting the implementation mismatch. Added explicit warning to always specify port for Source servers.

3. **`success: true` + `authenticated: false` gotcha** — in `/connect`, a wrong password returns HTTP 200 with `{ "success": true, "authenticated": false }`. This is unintuitive and was undocumented. Documented the asymmetry with `/command`, which returns HTTP 401 on auth failure.

4. **Exact request/response JSON** for both endpoints including all validation error messages and their exact text (used verbatim in tests).

5. **Wire format** — packet structure table (offset/size/field), type code table clarifying that type=2 is shared by both `SERVERDATA_AUTH_RESPONSE` and `SERVERDATA_EXECCOMMAND` (distinguished by direction), hardcoded requestId=1/2, auth exchange sequence diagram.

6. **Multi-packet 200ms drain** — documented the two-phase read: first blocking read, then 200ms drain window. Noted truncation risk for commands with multi-burst output like `cvarlist`.

7. **Host validation regex** — `^[a-zA-Z0-9.-]+$` rejects underscores, IPv6 brackets, and embedded ports.

8. **No persistent session** — every `/command` call re-authenticates. Risk: `sv_rcon_maxfailures` banning rapid callers.

9. **No Cloudflare detection** — unlike most other Port of Call TCP endpoints, there is no `checkIfCloudflare()` call.

10. **1446-byte command limit** — enforced at HTTP layer, not a protocol field limit. Documented what it is (historical Valve server parser behavior) and what it is not.

## NATS — `docs/protocols/NATS.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, ★★★★★
**Implementation:** `src/worker/nats.ts`

### What was in the original doc

`docs/protocols/NATS.md` was a planning artifact titled "NATS Protocol Implementation Plan." It contained a fictional `NatsClient` class (with `connect()`, `subscribe()`, `publish()`, `request()`, `readLoop()`, `processLine()`, and `flush()` methods), a `RequestReply` helper class, a `QueueGroup` helper class, and a React `NatsClient` component using a WebSocket stream for received messages — none of which exist in the real implementation. The actual 8 HTTP endpoints and their wire behaviors were entirely absent.

### What was improved

Replaced the planning doc with an accurate power-user reference covering all 8 endpoints and their exact behavior. Key findings:

1. **Auth field split (critical gotcha)** — documented that `/connect`, `/publish`, and all four `/jetstream-*` endpoints use `user`/`pass`/`token` fields, while `/subscribe` and `/request` use `username`/`password` with no `token` support. Sending the wrong field names silently results in an unauthenticated connection.

2. **`verbose:true` only in `/connect`** — documented that only the `/connect` handshake uses `verbose:true` and waits for `+OK`. All other endpoints use `verbose:false` and do not wait for `+OK` after CONNECT, so a rejected CONNECT (bad auth) surfaces as a downstream error on the first PUB/SUB command.

3. **JetStream publish ack is broken** — documented that `/jetstream-publish` publishes to the stream correctly but then calls `$JS.API.STREAM.NAMES` as a dummy API call instead of reading the actual PubAck from the ack inbox. The `ack` field in the response contains STREAM.NAMES data (a list of stream names), not the publish acknowledgment. Real PubAck fields (`seq`, `duplicate`) are never returned. Documented workaround: verify via `/jetstream-stream` with `action:info` and check `state.last_seq`.

4. **JetStream pull is a stub** — documented that `/jetstream-pull` creates the consumer and sends the MSG.NEXT request, but the implementation falls back to `$JS.API.STREAM.INFO.{stream}` and returns stream metadata instead of pulled messages. The `messages` array is always empty. The response includes an explicit `note` field from the source saying to use a NATS client library in production.

5. **Durable name on ephemeral consumer** — documented that `/jetstream-pull` creates consumers with `durable_name` set, making them persist on the server. Repeated calls with the same `consumer` name reuse the existing consumer; changing consumer config between calls causes a server error.

6. **HPUB header format** — documented the exact HPUB wire format for `/jetstream-publish` with `msgId`: header byte count (`NATS/1.0\r\nNats-Msg-Id: ...\r\n\r\n`) is sent as the first size, total bytes (headers + payload) as the second size.

7. **`responsed` typo** — documented that the `/request` response field is `responsed` (not `responded`) — an existing typo in the source.

8. **`withNATSSession` helper** — documented the shared JetStream session wrapper: single TCP connection, shared inbox `_INBOX_JS_.<random>`, reused across all `jsRequest` calls; PING-based flushing; session closes after all JetStream API calls complete.

9. **`Promise.allSettled` in `/jetstream-info`** — documented that `/jetstream-info` fires `$JS.API.INFO` and `$JS.API.STREAM.NAMES` in parallel; a failure in either produces a `null` field rather than a top-level error.

10. **`num_replicas:1` hardcoded** — documented that `/jetstream-stream` stream creation always sends `num_replicas:1` with no way to override.

11. **Queue subscription wire** — documented that `queue_group` in `/subscribe` generates `SUB subject queue_group sid` (3-token form), enabling server-side load balancing across concurrent subscribers.

12. **Inbox format** — documented that `/request` uses `_INBOX.` + `Math.random().toString(36).slice(2)` (short, not a full NUID), while JetStream endpoints use `_INBOX_JS_.<random>` (separate namespace).

13. **No TLS** — documented that even when the server INFO reports `tls_available:true`, the implementation never upgrades and always communicates plaintext.

14. **curl examples** — 8 one-liners covering connect, publish, subscribe, queue subscription, request-reply, JetStream info, stream create, and verify-publish-via-stream-info workaround.

11. **`(No output)` literal** — commands with no server output return the string `"(No output)"`, not an empty string or null.

## Doc Review — Gemini (claude-sonnet-4-5-20250929)
- [x] Gemini (1965) — Replaced 48-line generic stub with accurate power-user reference. (DONE)

**What was in the original doc:**
- A 48-line generic overview: protocol description, status code classes (1x/2x/3x/4x/5x/6x), and
  a resources section. No Port of Call endpoints, no request/response schemas, no implementation
  details, no curl examples.

**What the actual implementation has (src/worker/gemini.ts):**
- One endpoint: `POST /api/gemini/fetch`
- Request: `{ url, timeout=10000 }`. `gemini://` prefix is optional.
- Transport: TLS via `cloudflare:sockets connect()` with `secureTransport: "on"`. No HTTP at all.
- URL parsing: strips `gemini://`, splits on first `/`, extracts optional port (default 1965).
  When a non-default port is in the URL, it's used for TCP but **dropped from the request line**
  sent to the server — potential virtual-hosting issue with strict servers.
- Request line: `gemini://${host}${path}\r\n` (reconstructed, not the raw input URL)
- Reads until server close; 5 MB hard cap (`5242880` bytes).
- If zero bytes received before connection closes (non-timeout): throws `"No response from server"`.
- Response: `{ success, status, meta, body }`. Body is empty string for non-2x status codes.
- **No redirect following** — 3x returned as-is with redirect URL in `meta`.
- **No client certificate support** — 6x responses returned as-is.
- **TLS CA validation** — self-signed certs (common on Gemini) will fail handshake.
- No Cloudflare detection.

**Changes made to docs/protocols/GEMINI.md:**
- Complete rewrite from 48 lines to comprehensive power-user reference.
- Documented the single endpoint with full request/response schema and field table.
- Documented URL parsing behavior including the port-stripping edge case.
- Added complete Gemini status code table with all 17 defined codes and `meta` semantics per code.
- Added Gemtext line-type reference table (7 line types).
- Added curl examples (basic fetch, link extraction, redirect check, custom port, timeout probe).
- Documented TLS CA validation limitation (self-signed certs = connect failure).
- Documented redirect non-following, client cert limitation, 5 MB cap, error handling.
- Explained `1x` INPUT flow (second request with `?query` appended to URL).
- Added "What Port of Call does NOT implement" section.
- Added local testing instructions and public test capsule table.

## Neo4j — `docs/protocols/NEO4J.md`

**Reviewed:** 2026-02-17
**Implementation:** `src/worker/neo4j.ts`

### What was in the original doc

`docs/protocols/NEO4J.md` was titled "Neo4j Protocol Implementation Plan" and contained a `Neo4jClient` TypeScript class (with `connect()`, `run()`, `beginTransaction()`, `commit()`, `rollback()` methods), a `Record`/`ResultSummary`/`StatementStatistics` interface hierarchy, and a React `Neo4jClient` component with Cypher textarea and quick-query buttons. None of this existed. The actual five Worker endpoints were entirely absent. The doc offered Bolt 4.1–4.4 versions; the implementation offers 5.4, 5.3, 4.4, 4.3.

### What was improved

Replaced the planning doc with an accurate endpoint reference. Key additions:

1. **Five-endpoint structure** — documented `POST /api/neo4j/connect`, `/query`, `/query-params`, `/create`, and `GET /api/neo4j/schema` with exact request/response JSON, field tables, defaults, and edge cases.

2. **`/connect` anonymous probe behavior** — uses `scheme: none` (not basic auth). Returns `success: true` in both cases: `helloSuccess: true` for open servers, `helloSuccess: false, authRequired: true` for auth-protected servers. Power users need to check `helloSuccess` rather than `success`.

3. **`/schema` is GET not POST** — unlike all other endpoints, it reads query string parameters rather than a JSON body. No `database` parameter, hardcoded 15s timeout.

4. **Bolt handshake details** — version offers (5.4, 5.3, 4.4, 4.3), version decoding formula (`(uint32 >> 8) & 0xFF` = major, `uint32 & 0xFF` = minor), `selectedVersion` as raw decimal in response.

5. **Bolt 3 vs. Bolt 4+ protocol differences** — RUN has 2 fields in Bolt 3, 3 fields in Bolt 4+ (adds `run_metadata_map` with `db`); PULL has 0 fields in Bolt 3, `{n: -1}` in Bolt 4+. BEGIN is only sent when `database` is specified on Bolt 4+.

6. **Pipelined RUN + PULL** — both messages are written to the socket before reading any response. Documented explicitly as this is the source of the Bolt 3 vs. 4+ PULL_ALL distinction.

7. **PackStream type tables** — encoder (params) and decoder side documented separately, including the `0xD4` list8 encoding used by `packAnyValue` for arrays ≥16 elements (not handled by the decoder — round-trip not tested).

8. **Graph type struct layout** — Node (`0x4E`), Relationship (`0x52`), Path (`0x50`) structs are returned as `{ _tag, _fields: [...] }`. Documented `_fields` layout for Node (`[id, labels[], props{}]`) and Relationship (`[id, startId, endId, type, props{}]`).

9. **Int64 gap** — `0xCB` marker not decoded; fields with Int64 return `null` and remaining fields in the same map are lost. Integer parameter encoding uses bitwise ops that truncate at 32 bits.

10. **`readBoltMessages` vs `parseResponse`** — data endpoints use the accumulating deadline-based reader; `/connect` uses single-read `parseResponse`. Documented which is used where and the implication.

11. **`/create` label validation** — regex `/^[A-Za-z_][A-Za-z0-9_]*$/` applied before sending; backtick-escaped in Cypher. Properties passed as `$props` parameter (safe).

---

## Consul (8500) — Doc Review (claude-sonnet-4-5-20250929, 2026-02-17)

**File:** `docs/protocols/CONSUL.md`
**Implementation:** `src/worker/consul.ts` (685 lines, 8 exported handlers)

### What was wrong with the old doc
The old doc was `# Consul Protocol Implementation Plan` — a planning document describing what Consul supports in general (DNS port 8600, server RPC 8300, Serf 8301/8302, React components, theoretical service registration workflow). None of it matched the actual implementation.

### What the implementation actually does
1. **POST /api/consul/health** — fetches `GET /v1/agent/self` + `GET /v1/catalog/services` in series; returns version, datacenter, nodeName, server (bool), and list of service name strings.
2. **POST /api/consul/services** — fetches `GET /v1/catalog/services`; returns the raw service-name→tags object.
3. **GET /api/consul/kv/{key}** — reads a KV key; `key` comes from JSON body (URL suffix ignored); decodes base64 value via `atob()`; returns decoded string + createIndex/modifyIndex/lockIndex/flags/session metadata.
4. **POST /api/consul/kv/{key}** — writes a KV key via `PUT /v1/kv/...`; sends value as raw string body with `Content-Type: application/json` (mismatch); success requires statusCode 200 AND body === 'true'.
5. **DELETE /api/consul/kv/{key}** — deletes a KV key; success = statusCode 200 only (does not check body unlike PUT).
6. **POST /api/consul/kv-list** — lists keys under a prefix using `?keys=true&separator=/`; hierarchical listing stops at first slash; prefix='' lists all top-level prefixes.
7. **POST /api/consul/service/health** — queries `GET /v1/health/service/{name}`; supports `passing=true` filter and `dc` parameter; returns per-instance node/address/serviceId/servicePort/checks.
8. **POST /api/consul/session/create** — issues `PUT /v1/session/create` with Behavior/Name/TTL body; returns sessionId (UUID from Consul `ID` field).

### Key findings for power users
- **Two HTTP helpers**: `sendHttpGet` (top-level import) vs `sendConsulHttpRequest` (dynamic import for method variety). Both open a new TCP socket per request.
- **KV routing gotcha**: URL path after `/api/consul/kv/` is completely ignored by the worker; the actual `key` must be in the JSON request body.
- **KV GET non-standard**: HTTP GET with JSON request body — required by this implementation.
- **Content-Type mismatch on KV PUT**: sets `Content-Type: application/json` but sends raw string value. Consul doesn't care; value stored as-is.
- **Session lifecycle incomplete**: no renew (`PUT /v1/session/renew/{id}`) or destroy (`PUT /v1/session/destroy/{id}`) endpoints.
- **No lock primitives**: KV `?acquire=session` and `?release=session` not exposed despite session creation being implemented.
- **kv-list separator**: hardcoded `separator=/` means hierarchical listing only; no way to list all keys recursively.
- **512KB cap**: silently truncated for large catalogs or KV values.
- **Timeout defaults**: `/health` and `/services` default to 15s; `/service/health` and `/session/create` default to 10s.
- **No TLS**: plaintext HTTP/1.1 only; port 8443 not supported.

### What was added/corrected
- Complete endpoint reference with exact request/response JSON schemas
- Two-helper architecture explanation
- KV routing and method dispatch details
- `kv-list` hierarchical semantics and empty-prefix behavior
- Session behavior modes and lifecycle limitations
- All known limitations table (13 entries)
- curl examples for all 8 endpoints
- Local Docker testing setup (Consul 1.17 dev mode)

## ZooKeeper — 2026-02-17

**File:** `docs/protocols/ZOOKEEPER.md`
**Reviewer:** claude-sonnet-4-5-20250929

**What was wrong:**
The doc was an 892-line planning artifact titled "ZooKeeper Protocol Implementation Plan"
describing the binary protocol at a spec level (request type constants, ConnectRequest layout)
but not documenting any of the actual HTTP endpoints. It contained a React `ZooKeeperClient`
component and pseudocode class with methods like `create()`, `delete()`, `exists()`,
`getChildren()`, `setData()`, and watches — most of which either don't exist or behave
differently. Critically, the doc implied only the Jute binary protocol was implemented, while
ignoring the equally important Four-Letter Word (4LW) layer.

**What was fixed:**
Rewrote from scratch to accurately document the five real endpoints in `src/worker/zookeeper.ts`:

1. **`POST /api/zookeeper/connect`** — Sends `ruok` + `srvr` as two separate TCP connections;
   documents `rtt` covering both, structured `serverInfo` field names (mapped from `srvr`'s
   `"Zookeeper version"` / `"Node count"` / `"Latency min/avg/max"` keys), and the behavior
   when `srvr` is disabled by the server whitelist.

2. **`POST /api/zookeeper/command`** — Documents all 11 valid commands (ruok, srvr, stat, conf,
   envi, mntr, cons, dump, wchs, dirs, isro), the whitelist requirement for ZooKeeper 3.5+,
   which commands get a structured `parsed` field vs. raw `response`, and the parsing rule
   difference between `srvr`/`conf`/`envi` (colon-split) vs. `mntr` (tab-split). Includes
   a `mntr` key reference table for monitoring.

3. **`POST /api/zookeeper/get`** — Documents the full Jute session handshake (40-byte
   ConnectRequest, hardcoded protocolVersion=0/timeOut=30000/sessionId=0), GET_DATA xid=1,
   the 80-byte stat structure layout with which fields are decoded vs. omitted, ZNONODE→
   `{success:true, exists:false}` special case, UTF-8→base64 fallback for binary data, and
   the `dataLength:-1` null-data distinction.

4. **`POST /api/zookeeper/set`** — Documents SET_DATA xid=2, the `version:-1` unconditional
   write vs. optimistic concurrency control pattern, ZBADVERSION error behavior, and that
   the response `version` is the new version (input version + 1).

5. **`POST /api/zookeeper/create`** — Documents CREATE xid=3, the `flags` table (0=persistent,
   1=ephemeral, 2=persistent-sequential, 3=ephemeral-sequential), the critical gotcha that
   ephemeral nodes are immediately deleted because each request creates a new session, that
   sequential nodes return a different `createdPath` than the input `path`, and that ACL is
   hardcoded to world:anyone with full permissions (no custom ACL support).

Also documented: the `zkReadPacket` framing reader's chunk-accumulation behavior and timeout
race, Jute string encoding (4-byte length prefix), XID assignments per operation, error code
table (18 codes), Cloudflare detection scope (connect/get/set/create only, not command),
64 KB response cap for 4LW commands, session timeout hardcoded at 30 seconds, known
limitations table (getChildren/delete/exists/multi/watches/TLS/SASL not implemented).

## CDP (Chrome DevTools Protocol) — claude-sonnet-4-5-20250929, 2026-02-17

**File:** `docs/protocols/CDP.md`
**Source:** `src/worker/cdp.ts`
**Tests:** `tests/cdp.test.ts` (15 tests)

**What the old doc was:** A planning doc + Chrome browser usage guide. Mixed Chrome-native CDP documentation (how to use Puppeteer, DevTools domains, common commands) with an overview of the Port of Call endpoints. Claims a fictional `CDPClient.tsx` React component. The WebSocket tunnel was correctly claimed to exist.

**What I documented:**

- All 3 endpoints: `POST /api/cdp/health`, `POST /api/cdp/query`, `WebSocket /api/cdp/tunnel`
- `/health` makes two separate TCP connections (/json/version + /json/list); /json/list failure silently swallowed — targets:null with no error flag, success still true
- `/query` has no Cloudflare detection (unlike /health and /tunnel)
- No port validation in either HTTP endpoint — any integer accepted
- 512KB cap in sendHttpRequest — /json/protocol (~5MB) is silently truncated to invalid JSON
- `/tunnel` WebSocket path logic: no targetId → /devtools/browser; with targetId → /devtools/page/{targetId}
- sec-websocket-accept not validated (any 101 accepted)
- CDP→Client read loop recreates reader every iteration (lock release/re-acquire overhead)
- Pong frame is correctly masked; only handles ≤16-bit payload lengths in pong (fine since ping max is 125 bytes per RFC 6455)
- decodeChunked() stops on NaN chunk size (malformed chunk extension would halt early)
- No TLS, no auth, GET-only HTTP, no fragment reassembly

## STOMP — `docs/protocols/STOMP.md`

**Reviewed:** 2026-02-17
**Implementation:** `src/worker/stomp.ts`

### What was in the original doc

`docs/protocols/STOMP.md` was titled "STOMP Protocol Implementation Plan" and contained a fictional `StompClient` TypeScript class with `connect()`, `send()`, `subscribe()`, `beginTransaction()`, `commit()`, `rollback()` methods, a React component with a WebSocket-based STOMP session, and a "Next Steps" checklist. None of this existed. The actual three Worker endpoints were absent. The planning doc described STOMP over WebSocket (not TCP).

### What was improved

Replaced the planning doc with an accurate endpoint reference. Key additions:

1. **Three-endpoint structure** — documented `POST /api/stomp/connect`, `/send`, and `/subscribe` with exact request/response JSON, field tables, defaults, and edge cases.

2. **`receiptReceived: false` with `success: true`** — in `/send`, if the RECEIPT doesn't arrive before the timeout, the catch block is silently swallowed and the response returns `success: true, receiptReceived: false`. The message may have been delivered. Power users need to check `receiptReceived`, not `success`, to confirm delivery.

3. **8-second collection cap** — `/subscribe` uses `collectDeadline = min(timeout - 500ms, 8000ms)`. No matter how large `timeout` is, message collection stops after 8 seconds. Documented explicitly.

4. **`bodyLength` character vs byte discrepancy** — `/send` returns `bodyLength: messageBody.length` (JS char count), but the `content-length` STOMP header uses UTF-8 byte count. For multi-byte characters these differ.

5. **Destination regex restriction** — `/send` validates destination with `/^\/[a-zA-Z0-9/_.-]+$/`, rejecting `#`, `*`, `>`, `@`, spaces. RabbitMQ wildcard topic subscriptions and ActiveMQ virtual topic patterns fail this check. `/subscribe` has no such restriction.

6. **Host validation excludes IPv6 and underscores** — `validateStompInput` uses `/^[a-zA-Z0-9.-]+$/`, rejecting hostnames with underscores (common in internal DNS) and IPv6 literals (contain `:`).

7. **Custom headers precedence in /send** — `customHeaders` are spread last in the `sendHeaders` object, so they can override `receipt`, `destination`, `content-type`, and `content-length`. Not documented in original.

8. **Frame format details** — NULL byte terminator, header colon parsing (first colon only, values with colons handled correctly), header escaping gap (`\r`/`\n`/`:` in header values not escaped per STOMP 1.1+ spec).

9. **Subscription hardcoded state** — subscription ID always `"sub-0"`, `ack: auto`, no ACK/NACK, no transaction support.

10. **Buffer carryover in /subscribe** — data received alongside the CONNECTED frame is preserved and parsed before the next read, preventing loss of messages queued immediately after SUBSCRIBE.

## Doc Review — JSON-RPC (claude-sonnet-4-5-20250929, 2026-02-17, DONE)
- [x] JSON-RPC (8545/8546) — Replaced 101-line generic spec overview (no Port of Call endpoint docs — just JSON-RPC 2.0 spec examples and error codes) with accurate power-user reference. Documented all 3 endpoints: /call (single HTTP/TCP, default port 8545), /batch (multi-call HTTP/TCP, auto-assigned 1-based IDs), /ws (WebSocket, default port 8546). Key findings: success semantics differ — /call and /batch use HTTP status 200–399, /ws uses JSON parse success; WS read loop capped at min(timeout,10000) ms regardless of timeout param; Sec-WebSocket-Accept not validated; JSON-RPC error on /call sets top-level error string but success stays true if HTTP 2xx; params omitted (not null) when not provided; 512KB HTTP response cap; no TLS; chunked TE decoded but Content-Encoding not decoded; batch IDs auto-assigned (index+1, not configurable).

---

## RIP — `src/worker/rip.ts`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 5 endpoints wired
**Implementation:** `src/worker/rip.ts`
**Endpoints before:** `/api/rip/request`, `/api/rip/probe`, `/api/rip/update`, `/api/rip/send`, `/api/rip/auth-update`
**Endpoints after:** + `/api/rip/md5-update`

### What was in the original implementation

The RIP implementation had comprehensive coverage of basic RIPv2 features:
- Full routing table request (`/request`) with v1/v2 support
- Whole-table probe (`/probe`)
- RIPv2 update packet with route entries (`/update`)
- RIPv1 send (`/send`)
- **Simple password authentication** (`/auth-update`) per RFC 2082 §2 — cleartext password embedded in the auth entry (AFI=0xFFFF, type=2), padded to 16 bytes

### What was missing

**RIPv2 Keyed MD5 Authentication (RFC 2082 §4)** — the most important real-world RIPv2 auth mechanism.
Simple password (type=2) stores the password in plaintext, visible to any sniffer on the LAN. Virtually no production network uses it. MD5 keyed auth (type=3) computes an MD5 digest over the entire packet, making it infeasible to forge or replay route updates without knowing the pre-shared key.

The existing `handleRIPAuthUpdate` also had `function ipBytes` declared inside a `try` block, which is not valid in strict mode. Both handlers now use arrow function (`const ipBytes = ...`).

### Changes made

#### 1. Fixed `ipBytes` declaration in `handleRIPAuthUpdate`

Changed `function ipBytes(...)` (block-level function declaration, disallowed in strict mode) to:
```typescript
const ipBytes = (addr: string): [number, number, number, number] => { ... };
```

#### 2. Added `handleRIPMD5Update` — `/api/rip/md5-update`

Implements the full RFC 2082 §4 Keyed MD5 packet structure:

**Packet layout (64 bytes minimum for 1 route):**
```
Offset  Size  Field
──────  ────  ─────────────────────────────────────────────────────────────
0       1     Command = 2 (Response)
1       1     Version = 2
2       2     Zero
4       2     AFI = 0xFFFF (auth entry marker)
6       2     Auth type = 3 (Keyed MD5)
8       2     Packet length = 4+20+N*20 (excludes trailing auth entry)
10      1     Key ID (0–255; which key slot the receiver should use)
11      1     Auth data length = 16
12      4     Sequence number (anti-replay monotonic counter)
16      4     Reserved (0x00000000)
20+     20×N  Route entries (AFI=2, tag, IP, mask, nextHop, metric)
end-20  2     Trailing AFI = 0xFFFF
end-18  2     Trailing subtype = 0x0001
end-16  16    MD5 digest
```

**MD5 computation (RFC 2082 §4.1):**
```
key16 = password padded/truncated to 16 bytes
digest = MD5(key16 || full_packet_with_zeros_in_auth_data || key16)
```
The packet is built with trailing auth data = zeros (Uint8Array zero-init), digest computed, then inserted.

**Request body:**
```json
{
  "host": "192.168.1.1",
  "port": 520,
  "password": "mysecretkey",
  "keyId": 1,
  "sequenceNumber": 1708000000,
  "routes": [
    { "address": "10.0.0.0", "mask": "255.0.0.0", "nextHop": "192.168.1.254", "metric": 2, "tag": 0 }
  ],
  "timeout": 10000
}
```

**Key fields in response:**
- `authType`: `"Keyed MD5 (RFC 2082 §4)"`
- `keyId`: the key slot used (0–255)
- `keyLength`: effective key length used (≤16)
- `sequenceNumber`: the monotonic counter in the packet
- `packetLen`: bytes from RIP header through last route entry (RFC 2082 definition)
- `totalBytes`: `packetLen + 20` (including trailing auth entry)
- `raw`: full hex dump including MD5 digest

**Difference from simple password (`/auth-update`):**

| Feature | Simple Password (type=2) | Keyed MD5 (type=3) |
|---|---|---|
| Password exposure | Visible in plaintext | Hashed; never in packet |
| Anti-replay | None | Sequence number |
| Key selection | N/A | Key ID field (0–255) |
| Trailing entry | No | Yes (AFI=0xFFFF, subtype=1, 16-byte digest) |
| Deployment | Rare (deprecated) | Standard on Cisco/Juniper |

**curl example:**
```bash
curl -X POST https://portofcall.ross.gg/api/rip/md5-update \
  -H "Content-Type: application/json" \
  -d '{
    "host": "192.168.1.1",
    "password": "cisco",
    "keyId": 1,
    "sequenceNumber": 100,
    "routes": [
      {"address": "172.16.0.0", "mask": "255.255.0.0", "nextHop": "0.0.0.0", "metric": 1}
    ]
  }'
```

**Wire compatibility note:** RIP uses UDP/520. This implementation sends over TCP (Cloudflare Workers limitation). On a real RIPv2 router, the MD5 packet structure is identical; only the transport differs. The `connected` and `responseReceived` fields indicate whether the TCP probe reached the port and received a response.


## NNTP — `docs/protocols/NNTP.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 14/14 tests passing
**Implementation:** `src/worker/nntp.ts`
**Tests:** `tests/nntp.test.ts`

### What was in the original doc

`docs/protocols/NNTP.md` was a planning artifact titled "NNTP Protocol Implementation Plan." It contained a fictional `NNTPClient` TypeScript class (with `connect()`, `authenticate()`, `capabilities()`, `listNewsgroups()`, `selectGroup()`, `listArticles()`, `getArticle()`, `getHeaders()`, `getBody()`, `post()`, `next()`, `last()` methods), a React `NNTPClient` component with group browser and article viewer, and a stub `readMultilineResponse()` that buffered until `\r\n.\r\n` using `readline`-style string scan — none of which exists. The actual six HTTP endpoints, their request/response schemas, and all implementation quirks were absent.

### What was improved

Replaced the planning doc with an accurate power-user reference. Key additions:

1. **Six-endpoint table** — documented `POST /connect`, `/group`, `/article`, `/list`, `/post`, `/auth` with complete request field tables, defaults, protocol sequences, and JSON response schemas.

2. **Shared timeout architecture** — documented that a single `timeoutPromise` created at handler start is raced against both `socket.opened` and every subsequent `readLine` call; slow TCP connects eat into the I/O budget for all later steps.

3. **MODE READER inconsistency** — `/group` and `/article` send MODE READER unconditionally; `/connect` sends it in try-catch; `/list`, `/post`, and `/auth` skip it entirely. Documented impact on servers that require it.

4. **OVER vs XOVER** — `/group` uses RFC 3977 `OVER` (not RFC 2980 `XOVER`); if a server returns non-224, articles silently returns `[]`. 20-article cap documented.

5. **`/post` dot-stuffing bug** — body content is not dot-stuffed; lines that are exactly `.` terminate the article early. Also missing `Date:` and `Message-ID:` headers required by RFC 5536.

6. **`/article` header parsing caveats** — duplicate header names clobber each other (last wins); folded RFC 5536 continuation lines are silently dropped; `messageId` comes from the `220` response line, not the `Message-ID:` header.

7. **Auth divergence** — private `nntpAuth()` helper (used by `/list`+`/post`) throws on failure → HTTP 500; public `/auth` endpoint returns HTTP 200 with `authenticated: false` on non-381. Documented this asymmetry.

8. **Group name regex** — `/^[a-zA-Z0-9][a-zA-Z0-9.+-]*$/` rejects underscores; groups like `alt.fan_fiction` would get HTTP 400.

9. **LIST variant behavior** — documented all three variants (ACTIVE/NEWSGROUPS/OVERVIEW.FMT), ACTIVE field order (`last first` unlike GROUP's `first last`), 500-group cap, `truncated` flag.

10. **Response code reference table** — all relevant codes; commands not exposed (HEAD, BODY, STAT, NEXT, LAST, LISTGROUP, NEWNEWS, NEWGROUPS, XHDR, STARTTLS).

## TDS (SQL Server / Sybase) — 2026-02-17

**File reviewed:** `src/worker/tds.ts` (1394 lines)
**Doc rewritten:** `docs/protocols/TDS.md`

TDS 7.4 implementation with 3 endpoints: Pre-Login probe (no credentials), Login7 auth check, and SQL Batch query execution. Documented the 8-byte packet header format, Pre-Login option structure (5 options + TERMINATOR), LOGIN7 fixed fields (TDS 7.4 hardcoded, LCID en-US, all client strings "portofcall"), password obfuscation (XOR 0xA5 + nibble-swap), and the full token stream parser. Produced a 26-row column type decoding table showing which SQL Server types return usable values vs placeholder strings (temporal, binary, decimal-without-scale, UNIQUEIDENTIFIER-without-dashes are all notable gaps). Documented all known limitations: no TLS (ENCRYPT_OFF always sent), no Windows auth, no prepared statements, no multiple result sets, fragile unknown-token skip behavior.

## DICOM — `docs/protocols/DICOM.md`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, ★★★★★
**Implementation:** `src/worker/dicom.ts`

### What was in the original doc

`docs/protocols/DICOM.md` was a planning artifact titled "DICOM Protocol Implementation Plan." It contained a 488-line fictional `DICOMClient` class (with `connect()`, `echo()`, `find()`, `store()`, `sendPData()`, `receivePDU()`, etc.), a React `DICOMClient` component, and fictional TypeScript interfaces/enums (`PDUType`, `DIMSECommand`, `TransferSyntax`, `SOPClass`) — none of which exist in the actual Cloudflare Worker. The real 3 endpoints and their precise behaviors were entirely absent.

### What was improved

Replaced the planning doc with an accurate power-user reference covering all 3 endpoints. Key findings:

1. **`success:true` on association rejection in `/connect`** — `/connect` returns HTTP 200 with `success:true` even when the server sends A-ASSOCIATE-RJ, with `associationAccepted:false` and decoded rejection fields. `/echo` and `/find` return `success:false` + HTTP 502 on association failure.

2. **Three different default timeouts** — `/connect` uses `timeout=10000`, `/echo` uses `timeout=15000`, `/find` uses `timeout=20000`. All three use the field name `timeout` (milliseconds, not `timeout_ms`).

3. **AE title auto-uppercased** — `padAETitle()` calls `.toUpperCase()` before writing to the PDU. Input `"portofcall"` becomes `PORTOFCALL` in the wire frame. Validation: `^[\x20-\x7E]+$`, max 16 chars.

4. **Implicit VR LE parse-only in `/find`** — `parseDICOMDataset` assumes Implicit VR LE. Both Implicit and Explicit VR LE are offered in the association; if the server selects Explicit VR, datasets will be garbled.

5. **C-FIND query fields are mostly fixed** — `(0010,0010) PatientName` and `(0020,000D) StudyInstanceUID` are always empty strings (wildcard). Only `patientId` and `studyDate` are configurable. No search by patient name is possible.

6. **Study Root only** — `/find` proposes Study Root C-FIND SOP Class only. Patient Root is not supported.

7. **`studies` returned as raw tag maps** — Results are `Record<string, string>` with lowercase hex `"GGGG,EEEE"` keys (e.g., `"0010,0010"` for PatientName). No friendly name mapping. Provided a 15-row tag reference table.

8. **Max PDU size 16,384 bytes** — Advertised in User Information sub-item (0x51). Incoming PDUs over 1,048,576 bytes are rejected in `readPDU()`.

9. **No sequence/nested dataset support** — Parser stops at `length === 0xFFFFFFFF`, truncating studies with embedded sequences.

10. **A-ABORT handling asymmetry** — Only `/connect` returns structured `{aborted:true,abortSource:...}`; `/echo` and `/find` fall to the generic error path on A-ABORT.

11. **C-ECHO-RSP status codes** — 4 known codes (0x0000 Success, 0x0110 Processing Failure, 0x0112 SOP Class Not Supported, 0x0211 Unrecognized Operation); others return `statusText:"Unknown"`.

12. **0xFF01 treated as pending in `/find`** — Both 0xFF00 and 0xFF01 are collected as pending results before the 0x0000 success terminator.

13. **Full PDU/PDV wire reference** — documented all PDU types, A-ASSOCIATE-RQ fixed fields, variable item type codes, PDV control header bit semantics, and hardcoded implementation identity (Class UID + version name).

14. **No image retrieval** — C-MOVE, C-GET, C-STORE are not implemented. Only C-ECHO and Study Root C-FIND.

## Doc Review — Oracle (claude-sonnet-4-5-20250929, 2026-02-17, DONE)
- [x] Oracle (1521) — Replaced planning doc (fake OracleClient component / deployment checklist / future enhancements) with accurate power-user reference. Two source files documented: oracle.ts (2 endpoints: /api/oracle/connect GET|POST + /api/oracle/services POST) and oracle-tns.ts (4 endpoints: /api/oracle-tns/connect, /probe, /query, /sql). Key findings: two different CONNECT packet body layouts (26-byte in oracle.ts vs 50-byte in oracle-tns.ts; TNS versions 314 vs 316); /oracle/connect requires serviceName or sid (no default, HTTP 400 if omitted) vs /oracle-tns/connect defaults to 'ORCL'; /oracle/services response collector stops at 1KB despite 128KB limit (silent service truncation); services[].status always "READY" (not parsed from descriptor); /oracle-tns/connect returns success:true even on REFUSE (listener detection); /oracle-tns/sql TTI_LOGON is not a valid Oracle auth (O5LOGON/Diffie-Hellman required); /oracle-tns/query uses field name 'service' while all other endpoints use 'serviceName'; ANO negotiation uses hardcoded 3s inner timeout; VSNNUM version decoding documented. docs/protocols/ORACLE.md rewritten.

## VNC — `docs/protocols/VNC.md`
**Implementation:** `src/worker/vnc.ts`
**Tests:** `tests/vnc.test.ts`

`docs/protocols/VNC.md` was a planning artifact titled "VNC Protocol Implementation Plan." It contained a fictional `vncProxy()` WebSocket proxy function that uses `@novnc/novnc` (not installed), a React `VNCViewer.tsx` component using noVNC's `RFB` class, and generic SSH tunneling advice — none of which exists in the actual implementation.

The real implementation has two endpoints:

1. **`/connect` — security type discovery**: reads the 12-byte RFB version string, sends negotiated version (max 3.8), then reads the security type list (RFB 3.7+: count byte + type list; RFB 3.3: 4-byte uint32). Returns `securityTypes[]`, `authRequired` (true if type 1/None not offered), `connectTime`, `rtt`, `serverVersion`, `negotiatedVersion`. Does **not** select a security type.

2. **`/auth` — VNC Authentication (type 2)**: same handshake, then selects type 2, reads 16-byte DES challenge, encrypts with VNC's bit-reversed-key DES ECB (two 8-byte blocks, manually implemented since `crypto.subtle` doesn't support DES), reads 4-byte SecurityResult (0=ok, 1=failed, 2=tooMany). Password >8 bytes is silently truncated.

Key findings documented:
- Server-refused path in `/connect` returns `success: true` with `securityError` populated (not `success: false`)
- `/auth` returns 500 without `securityTypes` if server doesn't offer type 2
- `desAvailable` is always hardcoded `true` in response
- Default timeout is 10000ms (shorter than most other workers at 15000–30000ms)
- Timeout is a single outer `Promise.race` covering full handshake (no per-step inner timeouts)
- Types 7–15 not named (appear as `Unknown(N)`); source comment "5-16 = RealVNC" is misleading
- Empty password `""` is valid; `null`/`undefined` rejected with 400
- No WebSocket tunnel — the noVNC proxy described in the planning doc is not implemented

---

## CoAP — `src/worker/coap.ts`

**Reviewed:** 2026-02-17
**Protocol status at time of review:** ✅ Deployed, 2 endpoints wired
**Implementation:** `src/worker/coap.ts`
**Endpoints before:** `/api/coap/request`, `/api/coap/discover`
**Endpoints after:** + `/api/coap/block-get`, `/api/coap/observe`

### What was in the original implementation

The implementation had:
- Full option encoding/decoding (delta/length extended format)
- GET/POST/PUT/DELETE via `handleCoAPRequest` with Content-Format and confirmable/NON options
- Resource discovery via `.well-known/core` in `handleCoAPDiscover`
- Response parsing extracting code, content-format, and payload (text or base64 for binary)

### What was missing

**Block-wise transfer (RFC 7959)** and **Observe (RFC 7641)** — the two features that separate hobbyist CoAP from production IoT use:

- Without Block2, any resource larger than ~1KB (firmware image, config blob, OTA payload) silently truncates to the first message.
- Without Observe, the client must poll constantly instead of subscribing to changes — impossible to do efficiently in a Worker with a 30s wall-clock limit.

### Changes made

#### 1. Block option helpers

```typescript
function decodeBlockOption(data: Uint8Array): { num: number; more: boolean; szx: number; blockSize: number }
function encodeBlockOption(num: number, more: boolean, szx: number): Uint8Array
```

Block option value is 1–3 bytes:
- `SZX` (3 bits): block size = 2^(SZX+4), range 16–1024 bytes
- `M` (1 bit): 1 = more blocks follow
- `NUM` (remaining bits): block sequence number

#### 2. `handleCoAPBlockGet` — `/api/coap/block-get` (RFC 7959 §2.5)

**Request body:**
```json
{ "host": "coap.example.com", "port": 5683, "path": "/firmware/image.bin",
  "szx": 6, "maxBlocks": 64, "timeout": 10000 }
```

**Protocol flow:**
1. Sends initial GET with no Block2 option (server chooses block size)
2. Parses Block2 option in each response: `extractBlock2AndPayload()` walks raw option bytes, decodes Block2 NUM/M/SZX
3. If `M=1` (more), sends GET with Block2 option requesting `NUM+1` at same SZX
4. Continues until `M=0` or `maxBlocks` reached
5. Reassembles chunks into complete payload, decodes as UTF-8 or base64

**Response fields:** `blocks`, `totalBytes`, `blockSize`, `szx`, `contentFormat`, `payload`, `latencyMs`

**Key parameters:**
- `szx=6` (default) = 1024 bytes per block, suitable for most servers
- `maxBlocks=64` = safety cap (64 KB at szx=6); set higher for firmware images

#### 3. `handleCoAPObserve` — `/api/coap/observe` (RFC 7641)

**Request body:**
```json
{ "host": "sensor.local", "port": 5683, "path": "/sensors/temperature",
  "observeMs": 5000, "timeout": 10000 }
```

**Protocol flow:**
1. Sends `GET /path` with `Observe=0` (option 6, value=0) to register subscription
2. Waits up to `timeout` ms for initial notification (current resource state)
3. Waits up to `observeMs` for a second notification (state change)
4. Sends RST to deregister before closing (RFC 7641 §3.6)

**Response fields:**
```json
{
  "initial": { "observeSeq": 12345, "contentFormat": 50, "payload": "22.5" },
  "update":  { "observeSeq": 12346, "contentFormat": 50, "payload": "22.8" },
  "note": "Received initial value and one change notification."
}
```

`update` is absent if no state change arrived within `observeMs`.

**Observe sequence numbers:** The server's Observe counter (mod 2^24) in `initial.observeSeq` and `update.observeSeq` lets callers detect missed notifications — if `update.observeSeq - initial.observeSeq > 1`, notifications were lost.

**curl examples:**
```bash
# Block-wise GET (large resource)
curl -X POST https://portofcall.ross.gg/api/coap/block-get \
  -H "Content-Type: application/json" \
  -d '{"host":"coap.example.com","path":"/large-resource","szx":6,"maxBlocks":128}'

# Observe temperature sensor (wait 10s for a change notification)
curl -X POST https://portofcall.ross.gg/api/coap/observe \
  -H "Content-Type: application/json" \
  -d '{"host":"sensor.local","path":"/sensors/temp","observeMs":10000}'
```

