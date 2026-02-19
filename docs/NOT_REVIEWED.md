# Protocols Not Reviewed

This document lists all protocols that have specification files in `docs/protocols/` but were **not** included in the February 2026 comprehensive protocol review.

## Summary

- **Total Protocol Specs:** 241 files in `docs/protocols/`
- **Reviewed Protocols:** 151 (documented in `docs/changelog/by-protocol/`)
- **Not Reviewed:** 93 protocols (listed below)
- **Non-Protocol Files:** 5 documentation files (excluded from count)

## Why These Were Not Reviewed

The February 2026 protocol review focused on **86 protocols** that were already implemented in `src/worker/` with working code. The protocols listed below fall into these categories:

1. **Not yet implemented** - Spec exists but no working implementation
2. **Non-TCP protocols** - Cannot run on Cloudflare Workers (UDP, raw sockets)
3. **Future implementations** - Planned but not built yet
4. **Documentation files** - Not actual protocols (IMPLEMENTATION_GUIDE, QUICK_REFERENCE, README)

## Not Reviewed Protocols (93 total)

### A-C (19 protocols)
1. **ACTIVEMQ** - Apache ActiveMQ messaging broker
2. **ACTIVEUSERS** - RFC 866 Active Users Protocol
3. **ADB** - Android Debug Bridge
4. **AEROSPIKE** - Aerospike NoSQL database
5. **AMI** - Asterisk Manager Interface
6. **BATTLENET** - Battle.net gaming protocol
7. **BEANSTALKD** - Beanstalkd work queue
8. **CDP** - Cisco Discovery Protocol
9. **CEPH** - Ceph distributed storage
10. **CHARGEN** - RFC 864 Character Generator Protocol
11. **CLAMAV** - ClamAV antivirus daemon
12. **CLICKHOUSE** - ClickHouse database
13. **COLLECTD** - Collectd monitoring daemon
14. **CONSUL** - HashiCorp Consul service discovery
15. **COUCHBASE** - Couchbase NoSQL database
16. **COUCHDB** - Apache CouchDB database
17. **CVS** - Concurrent Versions System
18. **DAP** - Data Access Protocol
19. **DAYTIME** - RFC 867 Daytime Protocol

### D-F (16 protocols)
20. **DCERPC** - Distributed Computing Environment / Remote Procedure Call
21. **DICT** - Dictionary Server Protocol (RFC 2229)
22. **DISCARD** - RFC 863 Discard Protocol
23. **DNP3** - Distributed Network Protocol 3 (SCADA)
24. **EPMD** - Erlang Port Mapper Daemon
25. **EPP** - Extensible Provisioning Protocol
26. **ETHEREUM** - Ethereum blockchain protocol
27. **ETHERNETIP** - EtherNet/IP industrial protocol
28. **FINS** - Omron FINS factory automation
29. **FIREBIRD** - Firebird SQL database
30. **FIX** - Financial Information eXchange protocol
31. **FTPS** - FTP over TLS (explicit)
32. **GADUGADU** - Gadu-Gadu instant messaging
33. **GANGLIA** - Ganglia monitoring system
34. **GEARMAN** - Gearman job server
35. **GEMINI** - Gemini protocol (alternative to HTTP)

### G-I (20 protocols)
36. **GIT** - Git version control protocol
37. **GPSD** - GPS daemon protocol
38. **GRAFANA** - Grafana monitoring platform
39. **GRPC** - gRPC (HTTP/2-based RPC) ❌ *Cannot be implemented - requires TLS ALPN (see IMPOSSIBLE.md)*
40. **HAPROXY** - HAProxy stats protocol
41. **HL7** - Health Level 7 healthcare protocol
42. **HSRP** - Hot Standby Router Protocol
43. **HTTP** - Hypertext Transfer Protocol
44. **HTTP2** - HTTP/2 ❌ *Cannot be implemented - requires TLS ALPN for h2, impractical for h2c (see IMPOSSIBLE.md)*
45. **HTTPPROXY** - HTTP proxy protocol
46. **ICECAST** - Icecast streaming server
47. **IDENT** - Identification Protocol (RFC 1413)
48. **IEC104** - IEC 60870-5-104 SCADA protocol
49. **IGNITE** - Apache Ignite in-memory computing
50. **IKE** - Internet Key Exchange (IPsec)
51. **IMAPS** - IMAP over TLS (implicit)
52. **INFORMIX** - Informix database
53. **IPFS** - InterPlanetary File System
54. **IPP** - Internet Printing Protocol
55. **JABBER-COMPONENT** - Jabber/XMPP component protocol

### J-M (18 protocols)
56. **JDWP** - Java Debug Wire Protocol
57. **JSONRPC** - JSON-RPC
58. **JUPYTER** - Jupyter notebook protocol
59. **L2TP** - Layer 2 Tunneling Protocol
60. **LDP** - Label Distribution Protocol
61. **LLMNR** - Link-Local Multicast Name Resolution
62. **LOKI** - Grafana Loki log aggregation
63. **LPD** - Line Printer Daemon (RFC 1179)
64. **LSP** - Language Server Protocol
65. **MAXDB** - SAP MaxDB database
66. **MEILISEARCH** - Meilisearch search engine
67. **MGCP** - Media Gateway Control Protocol
68. **MINECRAFT_RCON** - Minecraft Remote Console
69. **MMS** - Manufacturing Message Specification
70. **MODBUS** - Modbus industrial protocol
71. **MUNIN** - Munin monitoring system
72. **NINEP** - Plan 9 Filesystem Protocol (9P)
73. **NNTPS** - NNTP over TLS (implicit)

### N-S (14 protocols)
74. **NSQ** - NSQ messaging platform
75. **ORACLE** - Oracle Database TNS protocol
76. **POSTGRESQL** - PostgreSQL wire protocol (alternate spec) 📄 *Duplicate - postgres.ts already implemented and reviewed*
77. **PROMETHEUS** - Prometheus monitoring
78. **S7COMM** - Siemens S7 PLC protocol
79. **SHOUTCAST** - Shoutcast streaming protocol
80. **SIPS** - SIP over TLS (secure SIP)
81. **SMPP** - Short Message Peer-to-Peer
82. **SMTPS** - SMTP over TLS (implicit)
83. **SOAP** - Simple Object Access Protocol
84. **SOURCE_RCON** - Source Engine RCON
85. **SSDP** - Simple Service Discovery Protocol
86. **STUN** - Session Traversal Utilities for NAT

### T-Z (4 protocols)
87. **TACACS+** - Terminal Access Controller Access-Control System Plus
88. **TARANTOOL** - Tarantool in-memory database
89. **TIME** - RFC 868 Time Protocol
90. **VENTRILO** - Ventrilo voice chat
91. **WEBSOCKET** - WebSocket Protocol
92. **XMPP-S2S** - XMPP Server-to-Server
93. **ZMTP** - ZeroMQ Message Transport Protocol

## Non-Protocol Documentation Files (Excluded)

These files exist in `docs/protocols/` but are not actual protocols:
- **IMPLEMENTATION_GUIDE.md** - Development guide (moved to `docs/guides/`)
- **QUICK_REFERENCE.md** - Cheat sheet
- **README.md** - Directory index
- **SUMMARY.md** - Protocol summary
- **SHOUTCAST_REVIEW.md** - Review document

## Protocols With Multiple Specs

Some protocols have multiple specification files (e.g., POSTGRES and POSTGRESQL, TACACS and TACACS+). In the review:
- **POSTGRES** was reviewed (151 changelog files use lowercase names)
- **POSTGRESQL** is an alternate spec that was not reviewed
- **TACACS** was reviewed
- **TACACS+** is an alternate spec

## How to Request a Review

If you need a protocol from this list to be reviewed:

1. **Check if it's implemented:** Look for `src/worker/[protocol].ts`
2. **If implemented:** Request a code review following the February 2026 audit template
3. **If not implemented:** First implement the protocol following the [ADD_PROTOCOL Guide](guides/ADD_PROTOCOL.md)

## See Also

- [Reviewed Protocols Index](changelog/by-protocol/README.md) - Complete list of 151 reviewed protocols
- [Critical Fixes Summary](changelog/critical-fixes.md) - High-severity bugs found during review
- [Medium Fixes Summary](changelog/medium-fixes.md) - Medium-severity bugs found during review
- [Protocol Specifications](protocols/) - All 241 protocol spec files
- [Implementation Guide](guides/IMPLEMENTATION_GUIDE.md) - How to implement new protocols

---

**Last Updated:** February 2026
**Review Coverage:** 151 of 244 total protocol-related files (62%)
**Protocols Reviewed:** 151 of 244 (62%)
**Protocols Not Reviewed:** 93 total (38%)
  - **87 implemented, ready for review** (listed above)
  - **3 cannot be implemented**: GRPC ❌, HTTP2 ❌, POSTGRESQL 📄 (duplicate)
  - **3 not eligible for review** (impossible/duplicate specs)
**Documentation Files:** 5 (IMPLEMENTATION_GUIDE, QUICK_REFERENCE, README, SUMMARY, SHOUTCAST_REVIEW)
