# Protocol Changelogs - Alphabetical Index

This directory contains individual changelog files for all protocols reviewed in the February 2026 comprehensive audit.

## Status

**✅ COMPLETE:** All 151 protocol changelogs have been extracted and documented.

## Recent Additions (2026-02-19)

- [submission.md](./submission.md) - Message Submission review
- [tcp.md](./tcp.md) - Raw TCP review
- [tftp.md](./tftp.md) - TFTP-over-TCP review
- [torcontrol.md](./torcontrol.md) - Tor control protocol review
- [uwsgi.md](./uwsgi.md) - uWSGI review
- [varnish.md](./varnish.md) - Varnish CLI review
- [ymsg.md](./ymsg.md) - YMSG review


## Protocol Files

All protocol changelog files are available in this directory. Each file follows a consistent format with:
- Bug summaries (critical and medium severity)
- Documentation improvements
- Links to protocol specifications

### Files with Critical/Medium Severity Bugs (53 protocols)

These protocols had significant bugs fixed during the review:

**Batch 1:** vault, kubernetes, prometheus, grafana, zmtp, tarantool, sybase, oracle-tns, firebird, drda, dcerpc, ignite, ldaps, amqps, pop3s, nntps

**Batch 2:** ssh ✓, websocket, smtps, imaps, shadowsocks ✓, shoutcast, smpp, submission, uwsgi, varnish, torcontrol, ymsg, stun, turn ✓, tftp, time

**Batch 3:** hazelcast, ssdp, spdy, soap, nomad, radsec ✓, sccp, scp ✓, ventrilo, llmnr, lmtp ✓, maxdb, node-inspector, svn, xmpp ✓, ipmi

**Batch 4:** activeusers, informix, ircs, kibana, livestatus, lsp, managesieve ✓, mdns, minecraft, mms, mpd, msn, mumble ✓

**Batch 5:** munin, napster, nbd ✓, netbios, 9p ✓, nrpe, nsca ✓, nsq, opcua, openflow, opentsdb ✓, oscar, pcep ✓

**Batch 6:** perforce, pjlink ✓, portmapper, postgres ✓, qotd, quake3, rcon ✓, realaudio, relp, rethinkdb, riak, rip, rmi

**Batch 7:** rserve ✓, s7comm, sane, sentinel ✓, sip ✓, snpp, solr, sonic ✓, spamd, tacacs, teamspeak ✓, uucp ✓

**Additional protocols with bugs:** afp ✓, bgp ✓, bittorrent ✓, cassandra ✓, dicom ✓, doh ✓, dot ✓, ftps, graphite ✓, h323 ✓, imap ✓, iscsi ✓, kerberos ✓, ldap ✓, msrp ✓, nats ✓, nbd ✓, neo4j ✓, nntp ✓, postgres ✓, rdp ✓, rtmp ✓, rtsp ✓, smb ✓, smtp ✓, spice ✓, stomp ✓, syslog ✓, thrift ✓, winrm ✓

### Documentation-Only Reviews (98 protocols)

These protocols received comprehensive documentation improvements without critical/medium bugs:

Including: activeusers, amqp, apache-kafka, asterisk, bitcoin, boinc, chargen, cifs, collectd, consul, couchdb, cvs, daytime, dhcp, discard, distcc, dns, docker, echo, elasticsearch, erlang-port-mapper, etcd, ftp, gearman, gemini, git, gopher, gpsd, haproxy, hl7, http, icecast, ident, imap, influxdb, irc, ircs, jabber, jetdirect, jupyter, kubernetes, ldap, lmtp, lpd, memcached, minecraft, modbus, mongodb, mqtt, mssql, mysql, napster, netbios, nfs, nntp, ntp, openvpn, oracle, pop3, postgresql, prometheus, quake3, rabbitmq, radius, rdp, redis, riak, rip, rlogin, rsync, rtmp, rtsp, sane, shadowsocks, sip, smb, smtp, snmp, socks4, socks5, spdy, ssh, ssl, stun, submission, syslog, tacacs, teamspeak, telnet, tftp, time, tor, turn, uwsgi, varnish, vnc, websocket, whois, xmpp, zmq, and others.

## File Format

Each protocol changelog follows this structure:

```markdown
# [Protocol Name] Review

**Protocol:** [Full Protocol Name]
**File:** `src/worker/[filename].ts`
**Reviewed:** 2026-02-18
**Specification:** [RFC/Spec URL if applicable]

## Summary
[2-3 sentence overview of implementation and bugs found]

## Bugs Found and Fixed
[Table of bugs with severity and description, OR statement that no critical/medium bugs were found]

## Documentation Improvements
[List of documentation created/improved]

## See Also
- Links to protocol specs and related documentation
```

## Notable Protocols Extracted

**High-Impact Security Fixes:**
- **PostgreSQL** - 5 critical bugs (resource leaks, SQL injection, SCRAM verification)
- **SSH** - 2 critical window flow control bugs causing data loss
- **SIP** - 9 critical bugs (resource leaks, data corruption, protocol violations)
- **TeamSpeak** - 5 critical bugs (resource leaks, command injection, data corruption)
- **RADSEC** - Crypto vulnerabilities (Math.random(), missing authenticator validation)
- **WinRM** - XML injection, multi-byte UTF-8 handling
- **SMTP/NNTP/LMTP/POP3** - Dot-stuffing/unstuffing bugs
- **Sonic** - 13 critical bugs (resource leaks, buffer overflow, protocol violations)
- **Sentinel** - 10 critical bugs (resource leaks, data corruption, RESP validation)

**Complex Protocol Implementations:**
- **PostgreSQL** - 18 message types, 3 auth methods, SCRAM-SHA-256
- **IMAP** - 8 endpoints, LOGIN auth, tag sequencing
- **SSH** - Full SSH-2 client with curve25519, aes128-ctr, Ed25519
- **SIP/SIPS** - Digest auth, NAT traversal, WebSocket session support

**Database Protocols:**
- PostgreSQL, MySQL, MongoDB, Redis, Cassandra, Neo4j, InfluxDB, Elasticsearch, Oracle, Riak, RethinkDB, CouchDB

**Legacy/Retro Protocols:**
- Gopher, Finger, Daytime, Time, Chargen, Echo, Discard, QOTD, Active Users

## Quick Reference by Severity

### Critical Severity (24 protocols)
See [critical-fixes.md](../critical-fixes.md) for complete list

### Medium Severity (31 protocols)
See [medium-fixes.md](../medium-fixes.md) for complete list

### Documentation Only (98 protocols)
No critical/medium bugs, comprehensive documentation created

## Statistics

- **Total Protocol Reviews:** 151
- **Critical Bugs Fixed:** 200+
- **Medium Bugs Fixed:** 30+
- **Documentation Created:** 151 comprehensive protocol specifications
- **Review Completion:** February 18, 2026

## See Also

- [Critical Fixes Summary](../critical-fixes.md) - All high-severity bugs
- [Medium Fixes Summary](../medium-fixes.md) - All medium-severity bugs
- [2026-02-18 Protocol Review](../2026-02-18-protocol-review.md) - Comprehensive audit overview
- [Protocol Specifications](../../protocols/) - Technical reference docs
- [Main Documentation Index](../../README.md) - Complete documentation hub
