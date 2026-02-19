# Protocol Reviews - Index

This file serves as an index to protocol review documentation. For detailed bug reports and fixes, see the [changelog directory](changelog/).

> **Note:** The original 934 KB REVIEWED.md has been backed up as `REVIEWED.md.backup` and reorganized into the new changelog structure for better maintainability and navigation.

## Quick Links

- **[Critical Fixes](changelog/critical-fixes.md)** - All high-severity security and data corruption bugs (~200+ fixes)
- **[Medium Fixes](changelog/medium-fixes.md)** - All medium-severity RFC compliance and parsing bugs (~30+ fixes)
- **[Review Project Overview](changelog/2026-02-18-protocol-review.md)** - Comprehensive protocol audit summary

## Individual Protocol Reviews

All 86 protocol reviews are organized in `changelog/by-protocol/`:

### Currently Available
- [SSH](changelog/by-protocol/ssh.md) - Secure Shell Protocol (2 critical window flow control bugs)
- [Shadowsocks](changelog/by-protocol/shadowsocks.md) - Shadowsocks Proxy Protocol (4 bugs: 2 medium, 2 low)
- [TURN](changelog/by-protocol/turn.md) - Traversal Using Relays around NAT (4 bugs including crypto.random() vulnerability)

### Complete Alphabetical Index

For a complete list of all 86 protocols with review status, see:
- **[changelog/by-protocol/README.md](changelog/by-protocol/README.md)** - Full protocol index organized by batch

## Protocol Specifications

For technical protocol documentation (wire formats, endpoints, examples), see:
- **[protocols/](protocols/)** - All 242 protocol specification files
- **[protocols/non-tcp/](protocols/non-tcp/)** - Non-TCP protocol specs (27 files)

## Development & Reference Docs

For implementation guidance and technical references, see:
- **[guides/](guides/)** - Development guides (setup, testing, validation)
- **[reference/](reference/)** - Technical references (RFC compliance, security, standards)

## Review Project Stats

**Completed:** February 18, 2026

- **Protocols Reviewed:** 86
- **Bugs Fixed:** 200+ critical, 30+ medium
- **Documentation Created:** 86 comprehensive protocol specs
- **Build Status:** ✅ 0 critical errors, 7 minor type warnings

### Common Bug Categories

1. **Resource Leaks** (60+ protocols) - Timeout handles, stream locks, socket cleanup
2. **Security Vulnerabilities** (40+ protocols) - SSRF, injection, weak crypto
3. **Data Corruption** (50+ protocols) - Encoding errors, parsing bugs
4. **Protocol Violations** (30+ protocols) - RFC non-compliance

### Review Batches

- **Batch 1** (16): vault, kubernetes, prometheus, grafana, zmtp, tarantool, sybase, oracle-tns, firebird, drda, dcerpc, ignite, ldaps, amqps, pop3s, nntps
- **Batch 2** (16): ssh, websocket, smtps, imaps, shadowsocks, shoutcast, smpp, submission, uwsgi, varnish, torcontrol, ymsg, stun, turn, tftp, time
- **Batch 3** (16): hazelcast, ssdp, spdy, soap, nomad, radsec, sccp, scp, ventrilo, llmnr, lmtp, maxdb, node-inspector, svn, xmpp-s2s, ipmi
- **Batch 4** (13): activeusers, informix, ircs, kibana, livestatus, lsp, managesieve, mdns, minecraft, mms, mpd, msn, mumble
- **Batch 5** (13): munin, napster, nbd, netbios, ninep, nrpe, nsca, nsq, opcua, openflow, opentsdb, oscar, pcep
- **Batch 6** (13): perforce, pjlink, portmapper, postgres, qotd, quake3, rcon, realaudio, relp, rethinkdb, riak, rip, rmi
- **Batch 7** (12): rserve, s7comm, sane, sentinel, sip, snpp, solr, sonic, spamd, tacacs, teamspeak, uucp

## Navigation

```
docs/
├── README.md                    # Documentation hub
├── REVIEWED.md                  # This file (index)
├── guides/                      # Development guides
├── reference/                   # Technical references
├── changelog/                   # Historical review records
│   ├── README.md               # Changelog index
│   ├── critical-fixes.md       # Critical bugs table
│   ├── medium-fixes.md         # Medium bugs table
│   ├── 2026-02-18-protocol-review.md  # Project overview
│   └── by-protocol/            # Individual protocol changelogs
│       ├── README.md           # Alphabetical protocol index
│       ├── ssh.md              # SSH review details
│       ├── shadowsocks.md      # Shadowsocks review details
│       └── [86 protocols]      # One file per protocol
└── protocols/                   # Protocol specifications
    ├── SSH.md                  # SSH protocol spec
    ├── SHADOWSOCKS.md          # Shadowsocks spec
    └── [242 protocols]         # All protocol specs
```

## Original Content

The original 934 KB REVIEWED.md containing all protocol review details has been:
1. **Backed up** as `REVIEWED.md.backup` in this directory
2. **Reorganized** into the changelog structure for better maintainability
3. **Split** into individual protocol files (in progress - currently SSH, Shadowsocks, TURN complete)

To complete the reorganization, the remaining 83 protocol reviews should be extracted from `REVIEWED.md.backup` and created as individual files in `changelog/by-protocol/`.

## See Also

- [Getting Started](README.md) - Main documentation index
- [Architecture](ARCHITECTURE.md) - System design overview
- [Project Overview](PROJECT_OVERVIEW.md) - High-level project summary
