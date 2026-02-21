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
| MySQL | Query execution returns HTTP 501 (disabled) | CRITICAL | Known |
| SFTP | All operations return HTTP 501 (not deployed) | CRITICAL | Known |
| SSH | Window exhaustion silently drops terminal input (RFC 4254 §5.2) | CRITICAL | Known |
| SMTP/SMTPS/Submission | Dot-stuffing regex fails on first-line dots | CRITICAL | Known |
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
| `ws.bufferedAmount` (capped by gate) | 1,048,576 B | 0 B |
| Event listener closures | 1,024 B | 1,024 B |
| **Total per connection** | **~1.1 MiB** | **~67 KB** |

| Workload | Per connection | Max concurrent (128 MiB isolate) |
|----------|---------------|----------------------------------|
| Bulk transfer (backpressure active) | ~1.1 MiB | ~102 |
| Interactive SSH/Redis (no backpressure) | ~67 KB | ~1,700 |
| Mixed (80% interactive, 20% bulk) | ~274 KB | ~410 |

## Non-TCP Protocols (Not Implementable)

These protocols require UDP, raw sockets, or TLS ALPN — none of which are available in the Cloudflare Workers Sockets API:

| Protocol | Reason |
|----------|--------|
| gRPC | Requires HTTP/2 + TLS ALPN |
| HTTP/2 | Requires TLS ALPN negotiation |
| QUIC | UDP-based |
| NTP | UDP-based |
| mDNS | UDP multicast |
| OSPF, RIP, HSRP | Routing protocols (raw sockets) |
| IPsec / IKE | UDP + raw sockets |
| MOSH | UDP-based |
| CoAP | UDP-based |

See `docs/protocols/non-tcp/` for detailed specs on why each cannot be implemented.

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
