# Protocol Registry

Status registry for all Port of Call protocols. Derived from audit passes 3-19 and the protocol review findings.

## Summary

| Metric | Count |
|--------|-------|
| Total protocols implemented | 244 |
| Protocol spec docs | 319 |
| Protocols reviewed (changelog) | 151 |
| Protocols awaiting review | 93 |
| Critical bugs fixed | 200+ |
| Medium bugs fixed | 30+ |

## Coverage by Category

| Category | Protocols | API Complete | Has UI | Has Tests | Coverage |
|----------|-----------|-------------|--------|-----------|---------|
| Database | 20 | 60-95% | 100% | 95% | Good |
| Message Queue | 12 | 70-95% | 100% | 100% | Excellent |
| File Transfer | 12 | 30-100% | 100% | 92% | Good |
| Email | 9 | 85-100% | 89% | 89% | Good |
| Remote Access | 15 | 50-100% | 100% | 93% | Good |
| Network/Routing | 18 | 60-90% | 100% | 89% | Good |
| Security/Auth | 10 | 40-85% | 100% | 90% | Fair |
| Industrial/SCADA | 8 | 50-80% | 100% | 88% | Fair |
| Monitoring | 14 | 70-95% | 100% | 93% | Good |
| DNS Variants | 4 | 80-100% | 100% | 100% | Excellent |
| Chat/Messaging | 12 | 60-90% | 100% | 92% | Good |
| Other | 110 | 50-100% | 97% | 91% | Good |
| **Total** | **244** | **69% avg** | **97%** | **92%** | **Good** |

## Known Critical Gaps

These were identified in the 13th pass findings and remain tracked:

| Protocol | Issue | Severity | Status |
|----------|-------|----------|--------|
| MySQL | Query execution returns HTTP 501 (disabled) | CRITICAL | **Fixed** — read-only queries (SELECT, SHOW, DESCRIBE, EXPLAIN, USE) fully functional |
| SFTP | All operations return HTTP 501 (not deployed) | CRITICAL | Known — architectural limitation: SFTP requires stateful bidirectional SSH channel; HTTP request/response model incompatible; needs WebSocket-based session handler |
| SSH | Window exhaustion silently drops terminal input (RFC 4254 §5.2) | CRITICAL | **Fixed** — drain loop with `inputQueue` respects remote window, waits for `WINDOW_ADJUST`; 4 MiB backpressure cap added |
| SMTP/SMTPS/Submission | Dot-stuffing regex fails on first-line dots | CRITICAL | **Fixed** — regex `/(^|\r\n)\./g` correctly handles first body line (preceded by `\r\n` from header/body separator); line-ending normalization ensures CRLF |
| DNP3, IEC 104, S7comm | No SELECT/operation validation before industrial writes | CRITICAL | Known |

## Data Plane Certification

The WebSocket-to-TCP tunnel was certified "Industrial Grade" after 19 audit passes. All findings are resolved.

### Certification Matrix (from 18th/19th Pass)

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Backpressure via `bufferedAmount` polling (1 MiB HWM) | HIGH | **CERTIFIED** |
| 2 | Zero-copy chunking for payloads >1 MiB | MEDIUM | **CERTIFIED** |
| 3 | Promise-chain write serialization (`writeChain`) | LOW | **CERTIFIED** |
| 4 | SSH banner reader lock in `finally` block | PASS | **CERTIFIED** |
| 5 | RTT `performance.now()` with 2-decimal rounding | PASS | **CERTIFIED** |
| 6 | Close handler rejection safety `.then(cleanup, cleanup)` | LOW | **CERTIFIED** |

### Security Audit (from 13th-15th Pass)

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | No private/internal IP validation (SSRF) | CRITICAL | **FIXED** — `host-validator.ts` |
| 2 | `handleSocketConnection` deadlock (awaited pipes) | CRITICAL | **FIXED** — fire-and-forget |
| 3 | Socket leak in `handleTcpPing` on timeout | HIGH | **FIXED** — `finally` cleanup |
| 4 | Reader lock never released on tunnel error | HIGH | **FIXED** — `finally` blocks |
| 5 | IPv6-mapped private IP bypass | HIGH | **FIXED** — regex extraction to `isBlockedIPv4()` |
| 6 | TCP open blocks 101 upgrade | MEDIUM | **FIXED** — 10s timeout race |
| 7 | Writer lock not released on close/error | MEDIUM | **FIXED** — explicit `releaseLock()` |
| 8 | RTT uses `Date.now()` instead of `performance.now()` | MEDIUM | **FIXED** — monotonic timer |

### Scaling Limits (from 17th/18th Pass)

| Component | Worst case | Typical |
|-----------|-----------|---------|
| Reader/writer objects | 512 B | 512 B |
| `writeChain` promise | 512 B | 64 B |
| TCP read buffer (one `reader.read()`) | 65,536 B | 65,536 B |
| `ws.bufferedAmount` outbound (capped at 1 MiB HWM) | 1,048,576 B | 0 B |
| Inbound write queue (capped at 4 MiB HWM) | 4,194,304 B | 0 B |
| Event listener closures | 1,024 B | 1,024 B |
| **Total per connection (outbound only)** | **~1.1 MiB** | **~67 KB** |
| **Total per connection (bidirectional worst case)** | **~5.1 MiB** | **~67 KB** |

| Workload | Per connection | Max concurrent (128 MiB isolate) |
|----------|---------------|----------------------------------|
| Bulk transfer (bidirectional worst case) | ~5.1 MiB | ~25 |
| Bulk transfer (unidirectional) | ~1.1 MiB | ~102 |
| Interactive SSH/Redis (no backpressure) | ~67 KB | ~1,700 |
| Mixed (80% interactive, 20% bulk) | ~274 KB | ~410 |

## Non-TCP Protocols (Not Implementable on Workers)

These protocols require UDP, raw sockets, or TLS ALPN — none of which are available in the Cloudflare Workers Sockets API:

| Protocol | Reason | TCP Variant? |
|----------|--------|-------------|
| gRPC | Requires HTTP/2 + TLS ALPN | No |
| HTTP/2 | Requires TLS ALPN negotiation | No |
| QUIC | UDP-based | No |
| NTP (UDP) | UDP-based | Yes — implemented over TCP (RFC 5905 §7.2) |
| SNMP (UDP) | UDP-based | Yes — implemented over TCP (RFC 3430) |
| mDNS | UDP multicast | Yes — implemented over TCP (unicast DNS wire format) |
| CoAP | UDP-based | Yes — implemented over TCP (RFC 8323) |
| STUN / TURN | UDP-based | Yes — implemented over TCP (RFC 5389 §7.2.2) |
| RIP | Uses UDP | Yes — implemented over TCP |
| HSRP | Routing protocol (raw sockets) | Yes — implemented over TCP |
| IKE / IPsec | UDP + raw sockets | Yes — IKE implemented over TCP (RFC 8229) |
| L2TP | UDP-based | Yes — implemented over TCP (RFC 3931) |
| OSPF | Layer 3 routing, requires raw IP access | No |
| MOSH | UDP-based | No |

See `docs/protocols/non-tcp/` for detailed specs on why the native forms cannot be implemented.

## Audit Trail

Historical audit logs are in `docs/changelog/reviews/`:

| Pass | Date | Focus |
|------|------|-------|
| 3-12 | 2026-02-20 | Protocol handler reviews (240+ handlers) |
| 13 | 2026-02-20 | Security: SSRF, deadlocks, socket leaks (2 CRITICAL, 2 HIGH, 1 MEDIUM) |
| 14 | 2026-02-20 | Remediation of 13th pass (5/5 fixed) |
| 15 | 2026-02-20 | Verification + IPv6 bypass, timeout, lock fixes (5/5 fixed) |
| 16 | 2026-02-20 | Data plane: backpressure, chunking, serialization (3 fixed) |
| 17 | 2026-02-20 | Verification + writeChain rejection fix (1 new, fixed) |
| 18 | 2026-02-20 | Certification audit (all 6 PASS) |
| 19 | 2026-02-20 | Final sign-off (CERTIFIED) |
