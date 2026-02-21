# Protocol Reviews - Index

This file serves as an index to protocol review documentation. For detailed bug reports and fixes, see the [changelog directory](../).

> **Note:** The original 934 KB REVIEWED.md has been backed up as `REVIEWED.md.backup` and reorganized into the new changelog structure for better maintainability and navigation.

## Quick Links

- **[Critical Fixes](../critical-fixes.md)** - All high-severity security and data corruption bugs (~200+ fixes)
- **[Medium Fixes](../medium-fixes.md)** - All medium-severity RFC compliance and parsing bugs (~30+ fixes)
- **[Review Project Overview](../2026-02-18-protocol-review.md)** - Comprehensive protocol audit summary

## Individual Protocol Reviews

All 86 protocol reviews are organized in `changelog/by-protocol/`:

### Currently Available
- [SSH](../by-protocol/ssh.md) - Secure Shell Protocol (2 critical window flow control bugs)
- [Shadowsocks](../by-protocol/shadowsocks.md) - Shadowsocks Proxy Protocol (4 bugs: 2 medium, 2 low)
- [TURN](../by-protocol/turn.md) - Traversal Using Relays around NAT (4 bugs including crypto.random() vulnerability)

### Complete Alphabetical Index

For a complete list of all 86 protocols with review status, see:
- **[by-protocol/README.md](../by-protocol/README.md)** - Full protocol index organized by batch

## Audit Pass Reports

All 17 audit pass reports are in this directory:

| Pass | File | Focus |
|------|------|-------|
| 3-12 | `PROTOCOL_REVIEW_3RD_PASS.md` ... `12TH_PASS.md` | Protocol handler reviews (240+ handlers) |
| 13 | [PROTOCOL_REVIEW_13TH_PASS.md](PROTOCOL_REVIEW_13TH_PASS.md) | Security: SSRF, deadlocks, socket leaks |
| 14 | [PROTOCOL_REVIEW_14TH_PASS.md](PROTOCOL_REVIEW_14TH_PASS.md) | Remediation of 13th pass |
| 15 | [PROTOCOL_REVIEW_15TH_PASS.md](PROTOCOL_REVIEW_15TH_PASS.md) | Verification + IPv6 bypass, timeout, lock fixes |
| 16 | [PROTOCOL_REVIEW_16TH_PASS.md](PROTOCOL_REVIEW_16TH_PASS.md) | Data plane: backpressure, chunking, serialization |
| 17 | [PROTOCOL_REVIEW_17TH_PASS.md](PROTOCOL_REVIEW_17TH_PASS.md) | Verification + writeChain rejection fix |
| 18 | [PROTOCOL_REVIEW_18TH_PASS.md](PROTOCOL_REVIEW_18TH_PASS.md) | Certification audit (all 6 PASS) |
| 19 | [PROTOCOL_REVIEW_19TH_PASS.md](PROTOCOL_REVIEW_19TH_PASS.md) | Final sign-off (CERTIFIED) |

## Review Project Stats

**Completed:** February 2026

- **Protocols Reviewed:** 86
- **Bugs Fixed:** 200+ critical, 30+ medium
- **Documentation Created:** 86 comprehensive protocol specs

### Review Batches

- **Batch 1** (16): vault, kubernetes, prometheus, grafana, zmtp, tarantool, sybase, oracle-tns, firebird, drda, dcerpc, ignite, ldaps, amqps, pop3s, nntps
- **Batch 2** (16): ssh, websocket, smtps, imaps, shadowsocks, shoutcast, smpp, submission, uwsgi, varnish, torcontrol, ymsg, stun, turn, tftp, time
- **Batch 3** (16): hazelcast, ssdp, spdy, soap, nomad, radsec, sccp, scp, ventrilo, llmnr, lmtp, maxdb, node-inspector, svn, xmpp-s2s, ipmi
- **Batch 4** (13): activeusers, informix, ircs, kibana, livestatus, lsp, managesieve, mdns, minecraft, mms, mpd, msn, mumble
- **Batch 5** (13): munin, napster, nbd, netbios, ninep, nrpe, nsca, nsq, opcua, openflow, opentsdb, oscar, pcep
- **Batch 6** (13): perforce, pjlink, portmapper, postgres, qotd, quake3, rcon, realaudio, relp, rethinkdb, riak, rip, rmi
- **Batch 7** (12): rserve, s7comm, sane, sentinel, sip, snpp, solr, sonic, spamd, tacacs, teamspeak, uucp
