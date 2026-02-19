# Medium Severity Fixes Summary

This document contains all medium severity bugs (RFC compliance / parsing issues) found during the February 2026 comprehensive protocol audit.

**Total:** 31 protocols with medium severity fixes

## Medium (RFC Compliance / Parsing)

| Protocol | File | Fix |
|----------|------|-----|
| BGP | `bgp.ts` | Fixed `AS_PATH` parsing for 4-byte ASNs — was reading 2-byte ASNs from 4-byte AS capability sessions |
| RTSP | `rtsp.ts` | Fixed `controlUrl` resolution — relative URLs now properly joined with Content-Base/session URL instead of overwriting |
| LDAP | `ldap.ts` | Fixed `bindDN` to use provided value instead of hardcoded empty string; added rootDSE read (search with empty baseDN); added proper BER length encoding for multi-byte lengths |
| Thrift | `thrift.ts` | Fixed `T_STRUCT` field offset tracking — was resetting offset inside nested structs instead of continuing from current position |
| Syslog | `syslog.ts` | Fixed severity calculation — was using `Math.floor(priority % 8)` which returns `NaN` on non-numeric input; added input validation |
| Graphite | `graphite.ts` | Fixed timestamp to use seconds (Unix epoch) instead of milliseconds |
| Kerberos | `kerberos.ts` | Added error code 16 (`KDC_ERR_PREAUTHENTICATION_FAILED`) to error table; fixed error code parsing |
| DICOM | `dicom.ts` | Fixed VR (Value Representation) parsing to handle both explicit and implicit VR transfer syntaxes; added 4-byte length VRs (OB, OW, OF, SQ, UC, UN, UR, UT) |
| XMPP | `xmpp.ts` | Fixed `tls.required` false positive — scoped `<required>` check to `<starttls>` block only; fixed `roster-versioning` false positive by not matching `version=` in stream header |
| NATS | `nats.ts` | Fixed JetStream publish to expect `+OK` or `-ERR` instead of JSON ack for core NATS publish; fixed `username`/`password` to `user`/`pass` per NATS protocol; fixed "responsed" typo |
| FTPS | `ftps.ts` | Fixed default port from 990 to 21 for explicit FTPS (AUTH TLS); kept 990 for implicit FTPS |
| STOMP | `stomp.ts` | Fixed `content-length` body extraction to use byte length instead of character length for multi-byte UTF-8 |
| RDP | `rdp.ts` | Fixed X.224 negotiation response offset to use fixed value 7 instead of variable `x224Length` which could be corrupted |
| AFP | `afp.ts` | Fixed error code table to use computed property keys `[-5019]` instead of string keys `'-5019'` for `Record<number, string>` lookup |
| BitTorrent | `bittorrent.ts` | Created `BencodeDict` class with hex-encoded keys to prevent UTF-8 corruption of binary SHA1 info_hash in scrape responses |
| SMB | `smb.ts` | Changed SessionId handling to 64-bit using BigInt to prevent truncation of high 32 bits |
| RCON | `rcon.ts` | Changed default Source RCON port from 25575 (Minecraft) to 27015 (Source Engine) |
| DoH | `doh.ts` | Added SOA and SRV record type parsing |
| SPICE | `spice.ts` | Read server version from `SpiceLinkReply` instead of hardcoding 2.2 |
| Neo4j | `neo4j.ts` | Added PackStream INT_64 (0xCB) type handler with BigInt support for values outside safe integer range |
| IMAP | `imap.ts` | Fixed LIST response parser to handle NIL delimiter, unquoted mailbox names, and escaped characters; fixed line splitting to use `\r\n` |
| DoT | `dot.ts` | Added transaction ID verification — response ID checked against query ID |
| RTMP | `rtmp.ts` | Fixed AMF3 command message parsing (skip leading 0x00 byte); added AMF0 Strict Array, Long String, and Undefined type handlers |
| Cassandra | `cassandra.ts` | Replaced flat type-skip with recursive `readCqlTypeOption()` for nested collection types; added comprehensive `decodeCqlValue()` for all CQL types instead of raw UTF-8 decode |
| MSRP | `msrp.ts` | Removed incorrect sender-side REPORT generation per RFC 4975 §7.1.2 (REPORTs are recipient-to-sender only) |
| H.323 | `h323.ts` | Added TPKT framing (RFC 1006) — all Q.931 PDUs now wrapped in 4-byte TPKT headers; response parsing uses proper TPKT deframing |
| ManageSieve | `managesieve.ts` | Fixed GETSCRIPT literal parsing to use byte-level slicing instead of fragile character iteration; added VERSION capability parsing; added response code extraction (NONEXISTENT, ACTIVE, QUOTA/*); added Cloudflare detection to /list endpoint |
| NSQ | `nsq.ts` | Fixed resource leak in `readFrame()` — setTimeout() not cleared when Promise.race() resolved early; added channel name validation in subscribe handler (was missing alphanumeric check); fixed timestamp conversion from nanoseconds BigInt to milliseconds |
| 9P | `ninep.ts` | Fixed stat parsing offset bug (was using offset 0 instead of 2 for walked paths, causing parse failures); fixed 64-bit file length arithmetic using BigInt to avoid precision loss; fixed timeout calculation in handshake to prevent negative values; added bounds validation to parse9PString and parseQID; added path traversal protection in buildTwalk (reject `.`, `..`, null bytes, `/`, max depth 16); fixed base64 encoding to use explicit loop instead of spread operator for TS target compatibility |

## Common Patterns

**Parsing Offset Errors (20+ protocols):**
- Incorrect byte offset calculations when reading structured data
- Fields extracted from wrong positions, corrupted values
- Fix: Explicit offset tracking with validation

**Integer Type Mismatches (15+ protocols):**
- Using 32-bit integers for 64-bit values, signed vs unsigned confusion
- Value truncation, overflow, incorrect interpretations
- Fix: Use BigInt for 64-bit values, explicit unsigned operations

**String Encoding Issues (10+ protocols):**
- Byte length vs character length confusion for multi-byte UTF-8
- Truncated strings, buffer overruns
- Fix: Explicit byte-level operations, proper TextEncoder usage

**Missing Record Type Support (10+ protocols):**
- Protocols only parsing subset of specification-defined types
- Unsupported types returned as raw bytes or cause errors
- Fix: Add comprehensive type parsers following specification

**Default Value Issues (8+ protocols):**
- Wrong default ports, missing field initializations
- Connections to wrong services, unexpected behavior
- Fix: Use RFC-specified defaults, document all defaults

## Impact Assessment

While medium severity bugs don't cause immediate security or data corruption issues, they can:
- Reduce protocol interoperability
- Cause unexpected failures with certain implementations
- Lead to incorrect data interpretation
- Violate RFC specifications

All medium bugs have been fixed to ensure full specification compliance and maximum interoperability.

## See Also

- [Critical Fixes Summary](critical-fixes.md) - High severity bugs
- [2026-02-18 Protocol Review Project](2026-02-18-protocol-review.md) - Complete project overview
- [Individual Protocol Changelogs](by-protocol/README.md) - Detailed bug descriptions by protocol
