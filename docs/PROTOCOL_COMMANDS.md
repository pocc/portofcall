# Protocol Command Reference

Quick reference of all available API endpoints for [Port of Call](https://l4.fyi), organized by protocol.

All endpoints accept POST requests with JSON bodies unless otherwise noted. The base URL is `https://l4.fyi`.

## Table of Contents

- [Utility Endpoints](#utility-endpoints)
- [9P](#9p)
- [ActiveMQ](#activemq)
- [ADB](#adb)
- [Aerospike](#aerospike)
- [AFP](#afp)
- [AJP](#ajp)
- [AMI](#ami)
- [AMQP](#amqp)
- [AMQPS](#amqps)
- [Battle.net](#battlenet)
- [Beanstalkd](#beanstalkd)
- [Beats](#beats)
- [BGP](#bgp)
- [Bitcoin](#bitcoin)
- [BitTorrent](#bittorrent)
- [Cassandra](#cassandra)
- [CDP](#cdp)
- [Ceph](#ceph)
- [Chargen](#chargen)
- [CIFS](#cifs)
- [ClamAV](#clamav)
- [ClickHouse](#clickhouse)
- [CoAP](#coap)
- [Collectd](#collectd)
- [Consul](#consul)
- [Couchbase](#couchbase)
- [CouchDB](#couchdb)
- [CVS](#cvs)
- [DAP](#dap)
- [Daytime](#daytime)
- [DCE/RPC](#dcerpc)
- [Diameter](#diameter)
- [DICOM](#dicom)
- [DICT](#dict)
- [Discard](#discard)
- [DNP3](#dnp3)
- [DNS](#dns)
- [Docker](#docker)
- [DoH](#doh)
- [DoT](#dot)
- [DRDA](#drda)
- [Echo](#echo)
- [Elasticsearch](#elasticsearch)
- [EPMD](#epmd)
- [EPP](#epp)
- [Etcd](#etcd)
- [Ethereum](#ethereum)
- [EtherNet/IP](#ethernetip)
- [FastCGI](#fastcgi)
- [Finger](#finger)
- [FINS](#fins)
- [Firebird](#firebird)
- [FIX](#fix)
- [Fluentd](#fluentd)
- [FTP](#ftp)
- [FTPS](#ftps)
- [Gadu-Gadu](#gadu-gadu)
- [Ganglia](#ganglia)
- [Gearman](#gearman)
- [GELF](#gelf)
- [Gemini](#gemini)
- [Git](#git)
- [Gopher](#gopher)
- [GPSD](#gpsd)
- [Grafana](#grafana)
- [Graphite](#graphite)
- [H.323](#h323)
- [HAProxy](#haproxy)
- [Hazelcast](#hazelcast)
- [HL7](#hl7)
- [HSRP](#hsrp)
- [HTTP](#http)
- [HTTP Proxy](#http-proxy)
- [Icecast](#icecast)
- [IEC 60870-5-104](#iec-60870-5-104)
- [Ident](#ident)
- [Ignite](#ignite)
- [IKE](#ike)
- [IMAP](#imap)
- [IMAPS](#imaps)
- [InfluxDB](#influxdb)
- [Informix](#informix)
- [IPFS](#ipfs)
- [IPMI](#ipmi)
- [IPP](#ipp)
- [IRC](#irc)
- [IRCS](#ircs)
- [iSCSI](#iscsi)
- [Jabber Component](#jabber-component)
- [JDWP](#jdwp)
- [JetDirect](#jetdirect)
- [JSON-RPC](#json-rpc)
- [Jupyter](#jupyter)
- [Kafka](#kafka)
- [Kerberos](#kerberos)
- [Kibana](#kibana)
- [Kubernetes](#kubernetes)
- [L2TP](#l2tp)
- [LDAP](#ldap)
- [LDAPS](#ldaps)
- [LDP](#ldp)
- [Livestatus](#livestatus)
- [LLMNR](#llmnr)
- [LMTP](#lmtp)
- [Loki](#loki)
- [LPD](#lpd)
- [LSP](#lsp)
- [ManageSieve](#managesieve)
- [Matrix](#matrix)
- [MaxDB](#maxdb)
- [mDNS](#mdns)
- [Meilisearch](#meilisearch)
- [Memcached](#memcached)
- [MGCP](#mgcp)
- [Minecraft](#minecraft)
- [MMS](#mms)
- [Modbus](#modbus)
- [MongoDB](#mongodb)
- [MPD](#mpd)
- [MQTT](#mqtt)
- [MSN](#msn)
- [MSRP](#msrp)
- [Mumble](#mumble)
- [Munin](#munin)
- [MySQL](#mysql)
- [Napster](#napster)
- [NATS](#nats)
- [NBD](#nbd)
- [Neo4j](#neo4j)
- [NetBIOS](#netbios)
- [NFS](#nfs)
- [NNTP](#nntp)
- [NNTPS](#nntps)
- [Node Inspector](#node-inspector)
- [Nomad](#nomad)
- [NRPE](#nrpe)
- [NSCA](#nsca)
- [NSQ](#nsq)
- [NTP](#ntp)
- [OPC UA](#opc-ua)
- [OpenFlow](#openflow)
- [OpenVPN](#openvpn)
- [Oracle](#oracle)
- [Oracle TNS](#oracle-tns)
- [OSCAR](#oscar)
- [PCEP](#pcep)
- [Perforce](#perforce)
- [PJLink](#pjlink)
- [POP3](#pop3)
- [POP3S](#pop3s)
- [Portmapper](#portmapper)
- [PostgreSQL](#postgresql)
- [PPTP](#pptp)
- [Prometheus](#prometheus)
- [QOTD](#qotd)
- [Quake3](#quake3)
- [RabbitMQ](#rabbitmq)
- [RADIUS](#radius)
- [RadSec](#radsec)
- [RCON](#rcon)
- [RDP](#rdp)
- [RealAudio](#realaudio)
- [Redis](#redis)
- [RELP](#relp)
- [RethinkDB](#rethinkdb)
- [Rexec](#rexec)
- [Riak](#riak)
- [RIP](#rip)
- [Rlogin](#rlogin)
- [RMI](#rmi)
- [RSH](#rsh)
- [Rserve](#rserve)
- [Rsync](#rsync)
- [RTMP](#rtmp)
- [RTSP](#rtsp)
- [S7comm](#s7comm)
- [SANE](#sane)
- [SCP](#scp)
- [SCCP](#sccp)
- [Sentinel](#sentinel)
- [SFTP](#sftp)
- [Shadowsocks](#shadowsocks)
- [SHOUTcast](#shoutcast)
- [SIP](#sip)
- [SIPS](#sips)
- [SLP](#slp)
- [SMB](#smb)
- [SMTP](#smtp)
- [SMTPS](#smtps)
- [SMPP](#smpp)
- [SNMP](#snmp)
- [SNPP](#snpp)
- [SOAP](#soap)
- [SOCKS4](#socks4)
- [SOCKS5](#socks5)
- [Solr](#solr)
- [Sonic](#sonic)
- [Spamd](#spamd)
- [SPDY](#spdy)
- [SPICE](#spice)
- [SSH](#ssh)
- [SSDP](#ssdp)
- [STOMP](#stomp)
- [STUN](#stun)
- [Submission](#submission)
- [SVN](#svn)
- [Sybase](#sybase)
- [Syslog](#syslog)
- [TACACS+](#tacacs)
- [Tarantool](#tarantool)
- [TDS](#tds)
- [TeamSpeak](#teamspeak)
- [Telnet](#telnet)
- [TFTP](#tftp)
- [Thrift](#thrift)
- [Time](#time)
- [Tor Control](#tor-control)
- [TURN](#turn)
- [UUCP](#uucp)
- [uWSGI](#uwsgi)
- [Varnish](#varnish)
- [Vault](#vault)
- [Ventrilo](#ventrilo)
- [VNC](#vnc)
- [WebSocket](#websocket)
- [Whois](#whois)
- [WinRM](#winrm)
- [X11](#x11)
- [XMPP](#xmpp)
- [XMPP S2S](#xmpp-s2s)
- [YMSG](#ymsg)
- [Zabbix](#zabbix)
- [ZMTP](#zmtp)
- [ZooKeeper](#zookeeper)

---

## Utility Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ping` | POST | TCP ping to check port reachability |
| `/api/tcp/send` | POST | Raw TCP send/receive |
| `/api/connect` | POST | Generic socket connection |
| `/api/activeusers/test` | POST | Active Users protocol test |
| `/api/activeusers/query` | POST | Query active users |
| `/api/activeusers/raw` | POST | Raw active users data |
| `/api/doh/query` | POST | DNS over HTTPS query |
| `/api/http/request` | POST | HTTP request proxy |
| `/api/http/head` | POST | HTTP HEAD request |
| `/api/http/options` | POST | HTTP OPTIONS request |

---

## 9P

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/9p/connect` | POST | Establish connection |
| `/api/9p/stat` | POST | Get file/directory stat |
| `/api/9p/read` | POST | Read file content |
| `/api/9p/ls` | POST | List directory |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/9p/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":564,"timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/9p/ls' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":564,"path":"/","timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/9p/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":564,"path":"/etc/motd","timeout":5000}'
```

---

## ActiveMQ

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/activemq/probe` | POST | Probe ActiveMQ broker |
| `/api/activemq/connect` | POST | Connect via STOMP |
| `/api/activemq/send` | POST | Send message |
| `/api/activemq/subscribe` | POST | Subscribe to destination |
| `/api/activemq/durable-subscribe` | POST | Create durable subscription |
| `/api/activemq/durable-unsubscribe` | POST | Remove durable subscription |
| `/api/activemq/admin` | POST | Admin API query |
| `/api/activemq/info` | POST | Get broker info |
| `/api/activemq/queues` | POST | List queues |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/activemq/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":61616,"timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/activemq/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":61613,"username":"admin","password":"admin","timeout":8000}'
```

```bash
curl -X POST 'https://l4.fyi/api/activemq/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"broker.example.com","port":61613,"username":"admin","password":"admin","destination":"/queue/orders.incoming","body":"{\"orderId\":\"ORD-12345\",\"status\":\"pending\"}","contentType":"application/json","timeout":8000}'
```

---

## ADB

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/adb/command` | POST | Execute ADB command |
| `/api/adb/version` | POST | Get ADB version |
| `/api/adb/devices` | POST | List devices |
| `/api/adb/shell` | POST | Execute shell command |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/adb/version' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5037,"timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/adb/devices' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5037,"timeout":5000}'
```

---

## Aerospike

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/aerospike/connect` | POST | Establish connection |
| `/api/aerospike/info` | POST | Get cluster info |
| `/api/aerospike/kv-get` | POST | Get key-value |
| `/api/aerospike/kv-put` | POST | Put key-value |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/aerospike/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"aero-node1.example.com","port":3000,"timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/aerospike/info' \
  -H 'Content-Type: application/json' \
  -d '{"host":"aero-node1.example.com","command":"namespaces","timeout":5000}'
```

---

## AFP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/afp/connect` | POST | Establish AFP connection |
| `/api/afp/login` | POST | Authenticate |
| `/api/afp/server-info` | POST | Get server info |
| `/api/afp/open-session` | POST | Open session |
| `/api/afp/list-dir` | POST | List directory |
| `/api/afp/get-info` | POST | Get file/volume info |
| `/api/afp/create-dir` | POST | Create directory |
| `/api/afp/create-file` | POST | Create file |
| `/api/afp/delete` | POST | Delete file/directory |
| `/api/afp/rename` | POST | Rename file/directory |
| `/api/afp/read-file` | POST | Read file content |
| `/api/afp/write-file` | POST | Write file content |
| `/api/afp/resource-fork` | POST | Read resource fork |

---

## AJP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ajp/connect` | POST | Probe AJP connector |
| `/api/ajp/request` | POST | Send AJP request |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/ajp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"tomcat.example.com","port":8009,"timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/ajp/request' \
  -H 'Content-Type: application/json' \
  -d '{"host":"tomcat.example.com","port":8009,"method":"GET","path":"/status","headers":{"Host":"tomcat.example.com"},"timeout":8000}'
```

---

## AMI

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ami/probe` | POST | Probe Asterisk Manager |
| `/api/ami/command` | POST | Execute AMI action |
| `/api/ami/originate` | POST | Originate call |
| `/api/ami/hangup` | POST | Hang up channel |
| `/api/ami/clicommand` | POST | Execute CLI command |
| `/api/ami/sendtext` | POST | Send text message |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/ami/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com","port":5038,"timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/ami/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"pbx.example.com","port":5038,"username":"admin","secret":"s3cretP@ss","action":"CoreShowChannels","timeout":8000}'
```

---

## AMQP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/amqp/connect` | POST | Establish AMQP connection |
| `/api/amqp/publish` | POST | Publish message |
| `/api/amqp/consume` | POST | Consume messages |
| `/api/amqp/confirm-publish` | POST | Publish with confirm |
| `/api/amqp/bind` | POST | Bind queue to exchange |
| `/api/amqp/get` | POST | Get single message |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/amqp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","port":5672,"timeout":5000,"vhost":"/"}'
```

```bash
curl -X POST 'https://l4.fyi/api/amqp/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq.example.com","port":5672,"username":"guest","password":"guest","vhost":"/","exchange":"events","exchangeType":"topic","routingKey":"order.created","message":"{\"orderId\":\"ORD-99001\"}","timeout":8000}'
```

---

## AMQPS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/amqps/connect` | POST | Connect via AMQP over TLS |
| `/api/amqps/publish` | POST | Publish message (TLS) |
| `/api/amqps/consume` | POST | Consume messages (TLS) |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/amqps/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"rabbitmq-tls.example.com","port":5671}'
```

---

## Battlenet

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/battlenet/connect` | POST | Connect to BNCS |
| `/api/battlenet/authinfo` | POST | Get auth info |
| `/api/battlenet/status` | POST | Check status |

---

## Beanstalkd

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/beanstalkd/connect` | POST | Establish connection |
| `/api/beanstalkd/command` | POST | Execute command |
| `/api/beanstalkd/put` | POST | Put job into tube |
| `/api/beanstalkd/reserve` | POST | Reserve job |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/beanstalkd/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"queue.example.com","port":11300,"timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/beanstalkd/put' \
  -H 'Content-Type: application/json' \
  -d '{"host":"queue.example.com","port":11300,"data":"{\"task\":\"send-email\",\"to\":\"user@example.com\"}","priority":1024,"delay":0,"ttr":60,"timeout":5000}'
```

---

## Beats

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/beats/connect` | POST | Probe Lumberjack endpoint |
| `/api/beats/send` | POST | Send events |
| `/api/beats/tls` | POST | TLS probe |

---

## BGP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bgp/connect` | POST | Establish BGP session |
| `/api/bgp/announce` | POST | Announce route prefix |
| `/api/bgp/route-table` | POST | Get route table |

---

## Bitcoin

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bitcoin/connect` | POST | Connect to Bitcoin node |
| `/api/bitcoin/getaddr` | POST | Get peer addresses |
| `/api/bitcoin/mempool` | POST | Get mempool info |

---

## BitTorrent

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bittorrent/handshake` | POST | Peer handshake |
| `/api/bittorrent/scrape` | POST | Tracker scrape |
| `/api/bittorrent/announce` | POST | Tracker announce |
| `/api/bittorrent/piece` | POST | Request piece |

---

## Cassandra

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cassandra/connect` | POST | Establish CQL connection |
| `/api/cassandra/query` | POST | Execute CQL query |
| `/api/cassandra/prepare` | POST | Prepare and execute statement |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/cassandra/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra-node1.example.com","port":9042,"timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/cassandra/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"cassandra-node1.example.com","port":9042,"cql":"SELECT * FROM system.local","username":"cassandra","password":"cassandra","timeout":8000}'
```

---

## CDP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cdp/health` | POST | Health check |
| `/api/cdp/query` | POST | Query DevTools endpoint |
| `/api/cdp/tunnel` | WebSocket | WebSocket tunnel |

---

## Ceph

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ceph/connect` | POST | Connect to Ceph monitor |
| `/api/ceph/probe` | POST | Probe monitor |
| `/api/ceph/cluster-info` | POST | Get cluster info |
| `/api/ceph/rest-health` | POST | REST health check |
| `/api/ceph/osd-list` | POST | List OSDs |
| `/api/ceph/pool-list` | POST | List pools |

---

## Chargen

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chargen/stream` | POST | Stream character data |

```bash
curl -X POST 'https://l4.fyi/api/chargen/stream' \
  -H 'Content-Type: application/json' \
  -d '{"host":"chargen.example.com","port":19,"maxBytes":1024,"timeout":10000}'
```

---

## CIFS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cifs/connect` | POST | SMB/CIFS negotiate |
| `/api/cifs/negotiate` | POST | Protocol negotiation |
| `/api/cifs/auth` | POST | Authenticate |
| `/api/cifs/ls` | POST | List directory |
| `/api/cifs/read` | POST | Read file |
| `/api/cifs/write` | POST | Write file |
| `/api/cifs/stat` | POST | Get file info |

---

## ClamAV

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/clamav/ping` | POST | Ping ClamAV daemon |
| `/api/clamav/version` | POST | Get version |
| `/api/clamav/stats` | POST | Get statistics |
| `/api/clamav/scan` | POST | Scan file path |

---

## ClickHouse

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/clickhouse/health` | POST | Health check |
| `/api/clickhouse/query` | POST | Execute query |
| `/api/clickhouse/native` | POST | Native protocol probe |

---

## CoAP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/coap/request` | POST | Send CoAP request |
| `/api/coap/discover` | POST | Discover resources |
| `/api/coap/block-get` | POST | Block-wise GET |
| `/api/coap/observe` | POST | Observe resource |

---

## Collectd

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/collectd/probe` | POST | Probe collectd |
| `/api/collectd/send` | POST | Send metrics |
| `/api/collectd/put` | POST | PUT metrics |
| `/api/collectd/receive` | POST | Receive metrics |

---

## Consul

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/consul/health` | POST | Health check |
| `/api/consul/services` | POST | List services |
| `/api/consul/kv-list` | POST | List KV keys |
| `/api/consul/kv/:key` | GET | Get KV value |
| `/api/consul/kv/:key` | POST | Put KV value |
| `/api/consul/kv/:key` | DELETE | Delete KV key |
| `/api/consul/service/health` | POST | Service health |
| `/api/consul/session/create` | POST | Create session |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/consul/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"consul.example.com","port":8500,"token":"s3cr3t-consul-token","timeout":5000}'
```

```bash
curl 'https://l4.fyi/api/consul/kv/config/api-gateway/rate-limit?host=consul.example.com&port=8500&token=s3cr3t-consul-token&dc=us-east-1&timeout=5000'
```

---

## Couchbase

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/couchbase/ping` | POST | Ping server |
| `/api/couchbase/version` | POST | Get version |
| `/api/couchbase/stats` | POST | Get statistics |
| `/api/couchbase/get` | POST | Get key |
| `/api/couchbase/set` | POST | Set key |
| `/api/couchbase/delete` | POST | Delete key |
| `/api/couchbase/incr` | POST | Increment counter |

---

## CouchDB

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/couchdb/health` | POST | Health check |
| `/api/couchdb/query` | POST | Execute query |

---

## CVS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cvs/connect` | POST | Connect to CVS pserver |
| `/api/cvs/login` | POST | Authenticate |
| `/api/cvs/list` | POST | List modules |
| `/api/cvs/checkout` | POST | Checkout module |

---

## DAP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dap/health` | POST | Health check |
| `/api/dap/tunnel` | WebSocket | Debug adapter tunnel |

---

## Daytime

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/daytime/get` | POST | Get daytime string |
| `/api/daytime/query` | POST | Query daytime (alias) |

```bash
curl -X POST 'https://l4.fyi/api/daytime/get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"time-server.example.com","port":13,"timeout":5000}'
```

---

## DCERPC

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dcerpc/connect` | POST | Connect to endpoint mapper |
| `/api/dcerpc/probe` | POST | Probe RPC |
| `/api/dcerpc/epm-enum` | POST | Enumerate endpoints |

---

## Diameter

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/diameter/connect` | POST | Capabilities Exchange |
| `/api/diameter/watchdog` | POST | Device Watchdog |
| `/api/diameter/acr` | POST | Accounting Request |
| `/api/diameter/auth` | POST | Auth Request |
| `/api/diameter/str` | POST | Session Termination |

---

## DICOM

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dicom/connect` | POST | Association request |
| `/api/dicom/echo` | POST | C-ECHO verification |
| `/api/dicom/find` | POST | C-FIND query |

---

## DICT

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dict/define` | POST | Look up word definition |
| `/api/dict/match` | POST | Match words |
| `/api/dict/databases` | POST | List databases |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/dict/define' \
  -H 'Content-Type: application/json' \
  -d '{"host":"dict.org","port":2628,"word":"serendipity","database":"*","timeout":15000}'
```

---

## Discard

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/discard/send` | POST | Send data to discard |

---

## DNP3

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dnp3/connect` | POST | Connect to outstation |
| `/api/dnp3/read` | POST | Read data points |
| `/api/dnp3/select-operate` | POST | Select-before-operate |

---

## DNS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dns/query` | POST | DNS query |
| `/api/dns/axfr` | POST | Zone transfer |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/dns/query' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","type":"A","server":"8.8.8.8","port":53,"edns":true,"dnssecOK":true}'
```

---

## Docker

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/docker/health` | POST | Health check |
| `/api/docker/query` | POST | Query Docker API |
| `/api/docker/tls` | POST | TLS Docker query |
| `/api/docker/container-create` | POST | Create container |
| `/api/docker/container-start` | POST | Start container |
| `/api/docker/container-logs` | POST | Get container logs |
| `/api/docker/exec` | POST | Execute in container |

---

## DoH

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/doh/query` | POST | DNS over HTTPS query |

---

## DoT

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dot/query` | POST | DNS over TLS query |

```bash
curl -X POST 'https://l4.fyi/api/dot/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"1.1.1.1","port":853,"domain":"example.com","type":"AAAA"}'
```

---

## DRDA

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/drda/connect` | POST | Connect to DB2 |
| `/api/drda/probe` | POST | Probe DRDA |
| `/api/drda/login` | POST | Authenticate |
| `/api/drda/query` | POST | Execute SQL query |
| `/api/drda/execute` | POST | Execute SQL statement |
| `/api/drda/prepare` | POST | Prepare statement |
| `/api/drda/call` | POST | Call stored procedure |

---

## Echo

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/echo/test` | POST | Send echo test |
| `/api/echo/connect` | WebSocket | Interactive echo session |

```bash
curl -X POST 'https://l4.fyi/api/echo/test' \
  -H 'Content-Type: application/json' \
  -d '{"host":"tcpbin.com","port":7,"message":"Hello, Echo!","timeout":10000}'
```

---

## Elasticsearch

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/elasticsearch/health` | POST | Cluster health |
| `/api/elasticsearch/query` | POST | API query |
| `/api/elasticsearch/https` | POST | HTTPS query |
| `/api/elasticsearch/index` | POST | Index document |
| `/api/elasticsearch/delete` | POST | Delete document |
| `/api/elasticsearch/create` | POST | Create index |

---

## EPMD

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/epmd/names` | POST | List registered names |
| `/api/epmd/port` | POST | Query port for name |

---

## EPP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/epp/connect` | POST | Connect to EPP server |
| `/api/epp/login` | POST | Authenticate |
| `/api/epp/domain-check` | POST | Check domain availability |
| `/api/epp/domain-info` | POST | Get domain info |
| `/api/epp/domain-create` | POST | Register domain |
| `/api/epp/domain-update` | POST | Update domain |
| `/api/epp/domain-delete` | POST | Delete domain |
| `/api/epp/domain-renew` | POST | Renew domain |

---

## Etcd

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/etcd/health` | POST | Health check |
| `/api/etcd/query` | POST | Query etcd API |

---

## Ethereum

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ethereum/probe` | POST | Probe Ethereum node |
| `/api/ethereum/rpc` | POST | JSON-RPC call |
| `/api/ethereum/info` | POST | Get node info |
| `/api/ethereum/p2p-probe` | POST | P2P protocol probe |

---

## EtherNet/IP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ethernetip/identity` | POST | List Identity |
| `/api/ethernetip/cip-read` | POST | CIP read attribute |
| `/api/ethernetip/get-attribute-all` | POST | Get all attributes |
| `/api/ethernetip/set-attribute` | POST | Set attribute |
| `/api/ethernetip/list-services` | POST | List services |

---

## FastCGI

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/fastcgi/probe` | POST | Probe FastCGI |
| `/api/fastcgi/request` | POST | Execute request |

---

## Finger

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/finger/query` | POST | Finger user query |

```bash
curl -X POST 'https://l4.fyi/api/finger/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":79,"username":"root","timeout":5000}'
```

---

## FINS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/fins/connect` | POST | Connect to Omron PLC |
| `/api/fins/memory-read` | POST | Read PLC memory |
| `/api/fins/memory-write` | POST | Write PLC memory |

---

## Firebird

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/firebird/probe` | POST | Probe Firebird |
| `/api/firebird/version` | POST | Get version |
| `/api/firebird/auth` | POST | Authenticate |
| `/api/firebird/query` | POST | Execute query |

---

## FIX

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/fix/probe` | POST | Probe FIX engine |
| `/api/fix/heartbeat` | POST | Send heartbeat |
| `/api/fix/order` | POST | Send order |

---

## Fluentd

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/fluentd/connect` | POST | Connect to Fluentd |
| `/api/fluentd/send` | POST | Send event |
| `/api/fluentd/bulk` | POST | Send bulk events |

---

## FTP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ftp/connect` | POST | Connect and authenticate |
| `/api/ftp/list` | POST | List directory |
| `/api/ftp/feat` | POST | Get features |
| `/api/ftp/stat` | POST | Get file status |
| `/api/ftp/nlst` | POST | Name list |
| `/api/ftp/site` | POST | SITE command |
| `/api/ftp/upload` | POST | Upload file |
| `/api/ftp/download` | POST | Download file |
| `/api/ftp/delete` | POST | Delete file |
| `/api/ftp/mkdir` | POST | Create directory |
| `/api/ftp/rename` | POST | Rename file |
| `/api/ftp/rmdir` | POST | Remove directory |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/ftp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass"}'
```

```bash
curl -X POST 'https://l4.fyi/api/ftp/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.example.com","port":21,"username":"ftpuser","password":"ftppass","path":"/pub","mlsd":true}'
```

---

## FTPS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ftps/connect` | POST | TLS connect |
| `/api/ftps/login` | POST | Authenticate |
| `/api/ftps/list` | POST | List directory |
| `/api/ftps/upload` | POST | Upload file |
| `/api/ftps/download` | POST | Download file |
| `/api/ftps/delete` | POST | Delete file |
| `/api/ftps/mkdir` | POST | Create directory |
| `/api/ftps/rename` | POST | Rename file |

---

## Gadu-Gadu

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gadugadu/connect` | POST | Connect to server |
| `/api/gadugadu/send-message` | POST | Send message |
| `/api/gadugadu/contacts` | POST | Get contacts |

---

## Ganglia

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ganglia/connect` | POST | Connect to gmond |
| `/api/ganglia/probe` | POST | Probe metrics |

---

## Gearman

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gearman/connect` | POST | Connect to Gearman |
| `/api/gearman/command` | POST | Admin command |
| `/api/gearman/submit` | POST | Submit job |

---

## GELF

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gelf/send` | POST | Send GELF message |
| `/api/gelf/probe` | POST | Probe GELF endpoint |

---

## Gemini

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gemini/fetch` | POST | Fetch Gemini resource |

```bash
curl -X POST 'https://l4.fyi/api/gemini/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"geminiprotocol.net","port":1965,"path":"/","timeout":10000}'
```

---

## Git

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/git/refs` | POST | List refs |
| `/api/git/fetch` | POST | Fetch objects |

```bash
curl -X POST 'https://l4.fyi/api/git/refs' \
  -H 'Content-Type: application/json' \
  -d '{"host":"git.kernel.org","port":9418,"repo":"/pub/scm/git/git.git","timeout":10000}'
```

---

## Gopher

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gopher/fetch` | POST | Fetch Gopher page |

```bash
curl -X POST 'https://l4.fyi/api/gopher/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"gopher.floodgap.com","port":70,"selector":"","timeout":15000}'
```

---

## GPSD

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gpsd/version` | POST | Get version |
| `/api/gpsd/devices` | POST | List devices |
| `/api/gpsd/poll` | POST | Poll GPS data |
| `/api/gpsd/command` | POST | Send command |
| `/api/gpsd/watch` | POST | Watch mode |

---

## Grafana

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/grafana/health` | POST | Health check |
| `/api/grafana/datasources` | POST | List data sources |
| `/api/grafana/dashboards` | POST | Search dashboards |
| `/api/grafana/dashboard` | POST | Get dashboard |
| `/api/grafana/dashboard-create` | POST | Create dashboard |
| `/api/grafana/folders` | POST | List folders |
| `/api/grafana/alert-rules` | POST | List alert rules |
| `/api/grafana/org` | POST | Get organization |
| `/api/grafana/annotation` | POST | Create annotation |

---

## Graphite

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/graphite/send` | POST | Send metrics |
| `/api/graphite/query` | GET | Query metrics |
| `/api/graphite/find` | GET | Find metrics |
| `/api/graphite/info` | GET | Get server info |

---

## H323

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/h323/connect` | POST | Connect to gatekeeper |
| `/api/h323/register` | POST | Register endpoint |
| `/api/h323/info` | POST | Get info |
| `/api/h323/capabilities` | POST | Get capabilities |

---

## HAProxy

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/haproxy/info` | POST | Get info |
| `/api/haproxy/stat` | POST | Get statistics |
| `/api/haproxy/command` | POST | Execute command |
| `/api/haproxy/weight` | POST | Set server weight |
| `/api/haproxy/state` | POST | Set server state |
| `/api/haproxy/addr` | POST | Set server address |
| `/api/haproxy/disable` | POST | Disable server |
| `/api/haproxy/enable` | POST | Enable server |

---

## Hazelcast

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/hazelcast/probe` | POST | Probe cluster |
| `/api/hazelcast/map-get` | POST | Map get |
| `/api/hazelcast/map-set` | POST | Map set |
| `/api/hazelcast/map-delete` | POST | Map delete |
| `/api/hazelcast/queue-offer` | POST | Queue offer |
| `/api/hazelcast/queue-poll` | POST | Queue poll |
| `/api/hazelcast/set-add` | POST | Set add |
| `/api/hazelcast/set-contains` | POST | Set contains |
| `/api/hazelcast/set-remove` | POST | Set remove |
| `/api/hazelcast/topic-publish` | POST | Topic publish |

---

## HL7

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/hl7/connect` | POST | Connect to HL7 server |
| `/api/hl7/send` | POST | Send HL7 message |
| `/api/hl7/query` | POST | QRY query |
| `/api/hl7/adt-a08` | POST | ADT A08 update |

---

## HSRP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/hsrp/probe` | POST | Probe HSRP |
| `/api/hsrp/listen` | POST | Listen for HSRP |
| `/api/hsrp/coup` | POST | Send coup |
| `/api/hsrp/v2-probe` | POST | HSRPv2 probe |

---

## HTTP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/http/request` | POST | HTTP request |
| `/api/http/head` | POST | HEAD request |
| `/api/http/options` | POST | OPTIONS request |

---

## HTTP Proxy

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/httpproxy/probe` | POST | Probe proxy |
| `/api/httpproxy/connect` | POST | CONNECT tunnel |

---

## Icecast

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/icecast/status` | POST | Get status |
| `/api/icecast/admin` | POST | Admin query |
| `/api/icecast/source` | POST | Source info |

---

## IEC 60870-5-104

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/iec104/probe` | POST | Probe station |
| `/api/iec104/read` | POST | Read data |
| `/api/iec104/write` | POST | Write data |

---

## Ident

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ident/query` | POST | Query identity |

---

## Ignite

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ignite/connect` | POST | Connect to cluster |
| `/api/ignite/probe` | POST | Probe cluster |
| `/api/ignite/list-caches` | POST | List caches |
| `/api/ignite/cache-get` | POST | Get from cache |
| `/api/ignite/cache-put` | POST | Put to cache |
| `/api/ignite/cache-remove` | POST | Remove from cache |

---

## IKE

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ike/probe` | POST | Probe IKE |
| `/api/ike/version` | POST | Detect version |
| `/api/ike/v2-sa` | POST | IKEv2 SA init |

---

## IMAP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/imap/connect` | POST | Connect and login |
| `/api/imap/list` | POST | List mailboxes |
| `/api/imap/select` | POST | Select mailbox |
| `/api/imap/session` | POST | Interactive session |

---

## IMAPS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/imaps/connect` | POST | TLS connect and login |
| `/api/imaps/list` | POST | List mailboxes |
| `/api/imaps/select` | POST | Select mailbox |
| `/api/imaps/session` | POST | Interactive session |

---

## InfluxDB

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/influxdb/health` | POST | Health check |
| `/api/influxdb/write` | POST | Write data points |
| `/api/influxdb/query` | POST | Query data |

---

## Informix

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/informix/probe` | POST | Probe Informix |
| `/api/informix/version` | POST | Get version |
| `/api/informix/query` | POST | Execute query |

---

## IPFS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ipfs/probe` | POST | Probe IPFS node |
| `/api/ipfs/add` | POST | Add content |
| `/api/ipfs/cat` | POST | Read content |
| `/api/ipfs/node-info` | POST | Get node info |
| `/api/ipfs/pin-add` | POST | Pin content |
| `/api/ipfs/pin-ls` | POST | List pins |
| `/api/ipfs/pin-rm` | POST | Unpin content |
| `/api/ipfs/pubsub-pub` | POST | Publish to topic |
| `/api/ipfs/pubsub-ls` | POST | List topics |

---

## IPMI

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ipmi/connect` | POST | Connect to BMC |
| `/api/ipmi/auth-caps` | POST | Get auth capabilities |
| `/api/ipmi/device-id` | POST | Get device ID |

---

## IPP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ipp/probe` | POST | Probe printer |
| `/api/ipp/print` | POST | Submit print job |

---

## IRC

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/irc/connect` | POST/WebSocket | Connect to IRC server |

```bash
curl -X POST 'https://l4.fyi/api/irc/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"irc.libera.chat","port":6667,"nickname":"portofcall_test","timeout":10000}'
```

---

## IRCS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ircs/connect` | POST/WebSocket | Connect to IRC over TLS |

---

## iSCSI

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/iscsi/discover` | POST | Discover targets |
| `/api/iscsi/login` | POST | Login to target |

---

## Jabber Component

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jabber-component/probe` | POST | Probe component port |
| `/api/jabber-component/handshake` | POST | Component handshake |
| `/api/jabber-component/send` | POST | Send stanza |
| `/api/jabber-component/roster` | POST | Get roster |

---

## JDWP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jdwp/probe` | POST | Probe JDWP |
| `/api/jdwp/version` | POST | Get version |
| `/api/jdwp/threads` | POST | List threads |

---

## JetDirect

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jetdirect/connect` | POST | Connect to printer |
| `/api/jetdirect/print` | POST | Send print data |

---

## JSON-RPC

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jsonrpc/call` | POST | Single RPC call |
| `/api/jsonrpc/batch` | POST | Batch RPC calls |
| `/api/jsonrpc/ws` | POST | WebSocket RPC |

---

## Jupyter

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jupyter/health` | POST | Health check |
| `/api/jupyter/query` | POST | Query API |
| `/api/jupyter/kernels` | POST/GET | List or create kernels |
| `/api/jupyter/kernels/:id` | DELETE | Delete kernel |
| `/api/jupyter/notebooks` | POST | List notebooks |
| `/api/jupyter/notebook` | POST | Get notebook |

---

## Kafka

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/kafka/versions` | POST | API version negotiation |
| `/api/kafka/metadata` | POST | Get cluster metadata |
| `/api/kafka/produce` | POST | Produce message |
| `/api/kafka/fetch` | POST | Fetch messages |
| `/api/kafka/groups` | POST | List consumer groups |
| `/api/kafka/offsets` | POST | List offsets |
| `/api/kafka/group-describe` | POST | Describe consumer groups |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/kafka/versions' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9092,"timeout":5000,"clientId":"portofcall-client"}'
```

```bash
curl -X POST 'https://l4.fyi/api/kafka/produce' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":9092,"topic":"events","key":"order-123","value":"{\"orderId\":\"123\",\"status\":\"created\"}","acks":-1,"timeout":5000,"clientId":"portofcall-client"}'
```

---

## Kerberos

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/kerberos/connect` | POST | Connect to KDC |
| `/api/kerberos/user-enum` | POST | Enumerate users |
| `/api/kerberos/spn-check` | POST | Check SPN |

---

## Kibana

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/kibana/status` | POST | Get status |
| `/api/kibana/saved-objects` | POST | List saved objects |
| `/api/kibana/index-patterns` | POST | List index patterns |
| `/api/kibana/alerts` | POST | List alerts |
| `/api/kibana/query` | POST | Query API |

---

## Kubernetes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/kubernetes/probe` | POST | Probe API server |
| `/api/kubernetes/query` | POST | Query API |
| `/api/kubernetes/logs` | POST | Get pod logs |
| `/api/kubernetes/pod-list` | POST | List pods |
| `/api/kubernetes/apply` | POST | Apply manifest |

---

## L2TP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/l2tp/connect` | POST | Connect to L2TP |
| `/api/l2tp/hello` | POST | Send hello |
| `/api/l2tp/start-control` | POST | Start control connection |
| `/api/l2tp/session` | POST | Session setup |

---

## LDAP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ldap/connect` | POST | Bind and connect |
| `/api/ldap/search` | POST | Search entries |
| `/api/ldap/add` | POST | Add entry |
| `/api/ldap/modify` | POST | Modify entry |
| `/api/ldap/delete` | POST | Delete entry |
| `/api/ldap/paged-search` | POST | Paged search |

---

## LDAPS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ldaps/connect` | POST | TLS bind and connect |
| `/api/ldaps/search` | POST | Search entries |
| `/api/ldaps/add` | POST | Add entry |
| `/api/ldaps/modify` | POST | Modify entry |
| `/api/ldaps/delete` | POST | Delete entry |
| `/api/ldaps/paged-search` | POST | Paged search entries |

---

## LDP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ldp/connect` | POST | Connect to LDP peer |
| `/api/ldp/probe` | POST | Probe LDP |
| `/api/ldp/label-map` | POST | Send label mapping |

---

## Livestatus

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/livestatus/status` | POST | Get status |
| `/api/livestatus/hosts` | POST | List hosts |
| `/api/livestatus/query` | POST | Execute query |
| `/api/livestatus/services` | POST | List services |
| `/api/livestatus/command` | POST | Execute command |

---

## LLMNR

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/llmnr/query` | POST | Name query |
| `/api/llmnr/reverse` | POST | Reverse query |
| `/api/llmnr/scan` | POST | Scan network |

---

## LMTP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/lmtp/connect` | POST | Connect to LMTP |
| `/api/lmtp/send` | POST | Deliver message |

---

## Loki

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/loki/health` | POST | Health check |
| `/api/loki/query` | POST | Execute query |
| `/api/loki/metrics` | POST | Get metrics |
| `/api/loki/push` | POST | Push log entries |
| `/api/loki/range` | POST | Range query |

---

## LPD

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/lpd/probe` | POST | Probe LPD |
| `/api/lpd/queue` | POST | Query print queue |
| `/api/lpd/print` | POST | Submit print job |
| `/api/lpd/remove` | POST | Remove job |

---

## LSP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/lsp/connect` | POST | Connect to LSP server |
| `/api/lsp/session` | POST | Interactive session |

---

## ManageSieve

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/managesieve/connect` | POST | Connect to server |
| `/api/managesieve/list` | POST | List scripts |
| `/api/managesieve/putscript` | POST | Upload script |
| `/api/managesieve/getscript` | POST | Download script |
| `/api/managesieve/deletescript` | POST | Delete script |
| `/api/managesieve/setactive` | POST | Set active script |

---

## Matrix

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/matrix/health` | POST | Health check |
| `/api/matrix/query` | POST | Query API |
| `/api/matrix/login` | POST | Authenticate |
| `/api/matrix/rooms` | POST | List rooms |
| `/api/matrix/send` | POST | Send message |
| `/api/matrix/room-create` | POST | Create room |
| `/api/matrix/room-join` | POST | Join room |

---

## MaxDB

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/maxdb/connect` | POST | Connect to MaxDB |
| `/api/maxdb/info` | POST | Get info |
| `/api/maxdb/session` | POST | Authenticated session |

---

## mDNS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mdns/query` | POST | Query mDNS name |
| `/api/mdns/discover` | POST | Discover services |
| `/api/mdns/announce` | POST | Announce service |

---

## Meilisearch

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/meilisearch/health` | POST | Health check |
| `/api/meilisearch/search` | POST | Search documents |
| `/api/meilisearch/documents` | POST | List documents |
| `/api/meilisearch/delete` | POST | Delete document |

---

## Memcached

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/memcached/connect` | POST | Connect to server |
| `/api/memcached/command` | POST | Execute command |
| `/api/memcached/stats` | POST | Get statistics |
| `/api/memcached/gets` | POST | Get multiple keys |
| `/api/memcached/session` | POST | Interactive session |

---

## MGCP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mgcp/audit` | POST | Audit endpoint |
| `/api/mgcp/command` | POST | Send command |
| `/api/mgcp/call-setup` | POST | Setup call |

---

## Minecraft

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/minecraft/status` | POST | Server List Ping |
| `/api/minecraft/ping` | POST | Ping server |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/minecraft/status' \
  -H 'Content-Type: application/json' \
  -d '{"host":"mc.hypixel.net","port":25565,"timeout":10000}'
```

---

## MMS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mms/probe` | POST | Probe MMS server |
| `/api/mms/namelist` | POST | List media names |
| `/api/mms/read` | POST | Read stream |
| `/api/mms/describe` | POST | Describe stream |

---

## Modbus

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/modbus/connect` | POST | Connect to device |
| `/api/modbus/read` | POST | Read registers/coils |
| `/api/modbus/write/coil` | POST | Write single coil |
| `/api/modbus/write/registers` | POST | Write registers |

---

## MongoDB

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mongodb/connect` | POST | Connect to MongoDB |
| `/api/mongodb/ping` | POST | Ping server |
| `/api/mongodb/find` | POST | Find documents |
| `/api/mongodb/insert` | POST | Insert documents |
| `/api/mongodb/update` | POST | Update documents |
| `/api/mongodb/delete` | POST | Delete documents |

---

## MPD

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mpd/status` | POST | Get status |
| `/api/mpd/command` | POST | Execute command |
| `/api/mpd/play` | POST | Play |
| `/api/mpd/pause` | POST | Pause |
| `/api/mpd/next` | POST | Next track |
| `/api/mpd/prev` | POST | Previous track |
| `/api/mpd/add` | POST | Add to playlist |
| `/api/mpd/seek` | POST | Seek position |

---

## MQTT

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mqtt/connect` | POST | Connect to broker |
| `/api/mqtt/publish` | POST | Publish message |
| `/api/mqtt/session` | POST | Interactive session |

---

## MSN

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/msn/probe` | POST | Probe MSN server |
| `/api/msn/version` | POST | Version detection |
| `/api/msn/login` | POST | Login |
| `/api/msn/md5-login` | POST | MD5 login |

---

## MSRP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/msrp/connect` | POST | Connect |
| `/api/msrp/send` | POST | Send message |
| `/api/msrp/session` | POST | Session setup |

---

## Mumble

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mumble/probe` | POST | Probe server |
| `/api/mumble/version` | POST | Get version |
| `/api/mumble/ping` | POST | Ping server |
| `/api/mumble/auth` | POST | Authenticate |
| `/api/mumble/text-message` | POST | Send text message |

---

## Munin

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/munin/connect` | POST | Connect to munin-node |
| `/api/munin/fetch` | POST | Fetch plugin data |

---

## MySQL

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mysql/connect` | POST | Connect and handshake |
| `/api/mysql/query` | POST | Execute SQL query |
| `/api/mysql/databases` | POST | List databases |
| `/api/mysql/tables` | POST | List tables |

---

## Napster

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/napster/connect` | POST | Connect to server |
| `/api/napster/login` | POST | Authenticate |
| `/api/napster/stats` | POST | Get statistics |
| `/api/napster/search` | POST | Search files |
| `/api/napster/browse` | POST | Browse user |

---

## NATS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nats/connect` | POST | Connect to NATS |
| `/api/nats/publish` | POST | Publish message |
| `/api/nats/subscribe` | POST | Subscribe to subject |
| `/api/nats/request` | POST | Request-reply |
| `/api/nats/jetstream-info` | POST | JetStream info |
| `/api/nats/jetstream-stream` | POST | Manage stream |
| `/api/nats/jetstream-publish` | POST | JetStream publish |
| `/api/nats/jetstream-pull` | POST | JetStream pull |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/nats/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"demo.nats.io","port":4222,"timeout":10000}'
```

```bash
curl -X POST 'https://l4.fyi/api/nats/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"demo.nats.io","port":4222,"subject":"events.user.signup","payload":"Hello from Port of Call","timeout":10000}'
```

---

## NBD

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nbd/connect` | POST | Connect |
| `/api/nbd/probe` | POST | Probe |
| `/api/nbd/read` | POST | Read block |
| `/api/nbd/write` | POST | Write block |

---

## Neo4j

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/neo4j/connect` | POST | Bolt connect |
| `/api/neo4j/query` | POST | Execute Cypher |
| `/api/neo4j/query-params` | POST | Parameterized Cypher |
| `/api/neo4j/schema` | POST | Get schema |
| `/api/neo4j/create` | POST | Create node |

---

## NetBIOS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/netbios/connect` | POST | Session connect |
| `/api/netbios/probe` | POST | Name probe |
| `/api/netbios/name-query` | POST | Query name |

---

## NFS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nfs/probe` | POST | Probe NFS |
| `/api/nfs/exports` | POST | List exports |
| `/api/nfs/lookup` | POST | Lookup file |
| `/api/nfs/getattr` | POST | Get attributes |
| `/api/nfs/read` | POST | Read file |
| `/api/nfs/readdir` | POST | Read directory |
| `/api/nfs/write` | POST | Write file |
| `/api/nfs/create` | POST | Create file |
| `/api/nfs/remove` | POST | Remove file |
| `/api/nfs/rename` | POST | Rename file |
| `/api/nfs/mkdir` | POST | Create directory |
| `/api/nfs/rmdir` | POST | Remove directory |

---

## NNTP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nntp/connect` | POST | Connect to news server |
| `/api/nntp/group` | POST | Select newsgroup |
| `/api/nntp/article` | POST | Retrieve article |
| `/api/nntp/list` | POST | List newsgroups |
| `/api/nntp/post` | POST | Post article |
| `/api/nntp/auth` | POST | Authenticate |

---

## NNTPS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nntps/connect` | POST | TLS connect |
| `/api/nntps/group` | POST | Select newsgroup |
| `/api/nntps/article` | POST | Retrieve article |
| `/api/nntps/list` | POST | List newsgroups |
| `/api/nntps/post` | POST | Post article |
| `/api/nntps/auth` | POST | Authenticate |

---

## Node Inspector

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/node-inspector/health` | POST | Health check |
| `/api/node-inspector/query` | POST | Query endpoint |
| `/api/node-inspector/tunnel` | WebSocket | Debug tunnel |

---

## Nomad

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nomad/health` | POST | Health check |
| `/api/nomad/jobs` | POST | List jobs |
| `/api/nomad/nodes` | POST | List nodes |
| `/api/nomad/allocations` | POST | List allocations |
| `/api/nomad/deployments` | POST | List deployments |
| `/api/nomad/dispatch` | POST | Dispatch job |

---

## NRPE

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nrpe/query` | POST | Execute check |
| `/api/nrpe/version` | POST | Get version |
| `/api/nrpe/tls` | POST | TLS probe |

---

## NSCA

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nsca/probe` | POST | Probe NSCA |
| `/api/nsca/send` | POST | Send check result |
| `/api/nsca/encrypted` | POST | Encrypted send |

---

## NSQ

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/nsq/connect` | POST | Connect to NSQ |
| `/api/nsq/publish` | POST | Publish message |
| `/api/nsq/subscribe` | POST | Subscribe to topic |
| `/api/nsq/mpub` | POST | Multi-publish |
| `/api/nsq/dpub` | POST | Deferred publish |

---

## NTP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ntp/query` | POST | Query NTP server |
| `/api/ntp/sync` | POST | Sync time |
| `/api/ntp/poll` | POST | Poll server |

---

## OPC UA

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/opcua/hello` | POST | Hello handshake |
| `/api/opcua/endpoints` | POST | Get endpoints |
| `/api/opcua/read` | POST | Read node value |

---

## OpenFlow

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/openflow/probe` | POST | Probe switch |
| `/api/openflow/echo` | POST | Echo request |
| `/api/openflow/stats` | POST | Get statistics |

---

## OpenVPN

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/openvpn/handshake` | POST | Protocol handshake |
| `/api/openvpn/tls` | POST | TLS handshake |

---

## OpenTSDB

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/opentsdb/version` | POST | Get server version |
| `/api/opentsdb/stats` | POST | Get server stats |
| `/api/opentsdb/suggest` | POST | Suggest metric names |
| `/api/opentsdb/put` | POST | Write data points |
| `/api/opentsdb/query` | POST | Query time series data |

---

## Oracle

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/oracle/connect` | POST | TNS connect |
| `/api/oracle/services` | POST | List services |

---

## Oracle TNS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/oracle-tns/connect` | POST | TNS connect |
| `/api/oracle-tns/probe` | POST | Probe listener |
| `/api/oracle-tns/query` | POST | Execute query |
| `/api/oracle-tns/sql` | POST | Execute SQL |

---

## OSCAR

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/oscar/probe` | POST | Probe server |
| `/api/oscar/ping` | POST | Ping |
| `/api/oscar/auth` | POST | Authenticate |
| `/api/oscar/login` | POST | Login |
| `/api/oscar/send-im` | POST | Send IM |
| `/api/oscar/buddy-list` | POST | Get buddy list |

---

## PCEP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pcep/connect` | POST | Connect to PCE |
| `/api/pcep/probe` | POST | Probe PCE |
| `/api/pcep/compute` | POST | Compute path |

---

## Perforce

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/perforce/probe` | POST | Probe server |
| `/api/perforce/info` | POST | Get server info |
| `/api/perforce/login` | POST | Authenticate |
| `/api/perforce/changes` | POST | List changelists |
| `/api/perforce/describe` | POST | Describe changelist |

---

## PJLink

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pjlink/probe` | POST | Probe projector |
| `/api/pjlink/power` | POST | Power control |

---

## POP3

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pop3/connect` | POST | Connect and login |
| `/api/pop3/list` | POST | List messages |
| `/api/pop3/retrieve` | POST | Retrieve message |
| `/api/pop3/dele` | POST | Delete message |
| `/api/pop3/uidl` | POST | Unique ID listing |
| `/api/pop3/top` | POST | Get message headers |
| `/api/pop3/capa` | POST | Get capabilities |

---

## POP3S

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pop3s/connect` | POST | TLS connect and login |
| `/api/pop3s/list` | POST | List messages |
| `/api/pop3s/retrieve` | POST | Retrieve message |
| `/api/pop3s/dele` | POST | Delete message |
| `/api/pop3s/uidl` | POST | Unique ID listing |
| `/api/pop3s/top` | POST | Get message headers |
| `/api/pop3s/capa` | POST | Get capabilities |

---

## Portmapper

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/portmapper/probe` | POST | Probe portmapper |
| `/api/portmapper/dump` | POST | Dump registrations |
| `/api/portmapper/getport` | POST | Get port for program |

---

## PostgreSQL

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/postgres/connect` | POST | Connect to database |
| `/api/postgres/query` | POST | Execute SQL |
| `/api/postgres/describe` | POST | Describe statement |
| `/api/postgres/listen` | POST | LISTEN for notifications |
| `/api/postgres/notify` | POST | NOTIFY channel |

---

## PPTP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pptp/connect` | POST | Connect to server |
| `/api/pptp/start-control` | POST | Start control connection |
| `/api/pptp/call-setup` | POST | Call setup |

---

## Prometheus

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/prometheus/health` | POST | Health check |
| `/api/prometheus/query` | POST | Instant query |
| `/api/prometheus/metrics` | POST | Get metrics |
| `/api/prometheus/range` | POST | Range query |

---

## QOTD

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/qotd/fetch` | POST | Fetch quote of the day |

---

## Quake3

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/quake3/status` | POST | Get server status |
| `/api/quake3/info` | POST | Get server info |

---

## RabbitMQ

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rabbitmq/health` | POST | Management health check |
| `/api/rabbitmq/query` | POST | Management API query |
| `/api/rabbitmq/publish` | POST | Publish via management API |

---

## RADIUS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/radius/probe` | POST | Probe RADIUS |
| `/api/radius/auth` | POST | Access-Request |
| `/api/radius/accounting` | POST | Accounting-Request |

---

## RadSec

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/radsec/connect` | POST | TLS connect |
| `/api/radsec/auth` | POST | Access-Request (TLS) |
| `/api/radsec/accounting` | POST | Accounting (TLS) |

---

## RCON

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rcon/connect` | POST | Connect and authenticate |
| `/api/rcon/command` | POST | Execute command |

---

## RDP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rdp/connect` | POST | Connect to RDP |
| `/api/rdp/negotiate` | POST | Protocol negotiation |
| `/api/rdp/nla-probe` | POST | NLA probe |

---

## RealAudio

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/realaudio/probe` | POST | Probe server |
| `/api/realaudio/describe` | POST | Describe stream |
| `/api/realaudio/setup` | POST | Setup stream |
| `/api/realaudio/session` | POST | Session |

---

## Redis

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/redis/connect` | POST | Connect to Redis |
| `/api/redis/command` | POST | Execute command |
| `/api/redis/session` | POST | Interactive session |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/redis/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"command":["SET","mykey","Hello World"],"timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"localhost","port":6379,"command":["INFO","server"],"timeout":5000}'
```

---

## RELP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/relp/connect` | POST | Connect to RELP |
| `/api/relp/send` | POST | Send syslog entry |
| `/api/relp/batch` | POST | Send batch |

---

## RethinkDB

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rethinkdb/connect` | POST | Connect to server |
| `/api/rethinkdb/probe` | POST | Probe server |
| `/api/rethinkdb/query` | POST | Query table |
| `/api/rethinkdb/tables` | POST | List tables |
| `/api/rethinkdb/info` | POST | Server info |
| `/api/rethinkdb/table-create` | POST | Create table |
| `/api/rethinkdb/insert` | POST | Insert document |

---

## Rexec

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rexec/execute` | POST/WebSocket | Execute remote command |

---

## Riak

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/riak/ping` | POST | Ping node |
| `/api/riak/info` | POST | Get info |
| `/api/riak/get` | POST | Get value |
| `/api/riak/put` | POST | Put value |

---

## RIP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rip/request` | POST | Route request |
| `/api/rip/probe` | POST | Probe RIP |
| `/api/rip/update` | POST | Route update |
| `/api/rip/send` | POST | Send routes |
| `/api/rip/auth-update` | POST | Auth route update |
| `/api/rip/md5-update` | POST | MD5 auth update |

---

## Rlogin

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rlogin/connect` | POST/WebSocket | Connect to host |
| `/api/rlogin/banner` | POST | Get login banner |

---

## RMI

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rmi/probe` | POST | Probe registry |
| `/api/rmi/list` | POST | List bound names |
| `/api/rmi/invoke` | POST | Invoke method |

---

## RSH

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rsh/execute` | POST/WebSocket | Execute remote command |
| `/api/rsh/probe` | POST | Probe server |
| `/api/rsh/trust-scan` | POST | Scan for trust |

---

## Rserve

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rserve/probe` | POST | Probe Rserve |
| `/api/rserve/eval` | POST | Evaluate R expression |

---

## Rsync

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rsync/connect` | POST | List modules |
| `/api/rsync/module` | POST | List module contents |
| `/api/rsync/auth` | POST | Authenticate to module |

---

## RTMP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rtmp/connect` | POST | RTMP handshake |
| `/api/rtmp/publish` | POST | Publish stream |
| `/api/rtmp/play` | POST | Play stream |

---

## RTSP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rtsp/options` | POST | OPTIONS request |
| `/api/rtsp/describe` | POST | DESCRIBE stream |
| `/api/rtsp/session` | POST | Setup session |

---

## S7comm

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/s7comm/connect` | POST | Connect to PLC |
| `/api/s7comm/read` | POST | Read data block |
| `/api/s7comm/write` | POST | Write data block |

---

## SANE

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sane/probe` | POST | Probe SANE |
| `/api/sane/devices` | POST | List devices |
| `/api/sane/open` | POST | Open device |
| `/api/sane/options` | POST | Get options |
| `/api/sane/scan` | POST | Start scan |

---

## SCP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scp/connect` | POST | Connect via SSH |
| `/api/scp/list` | POST | List files |
| `/api/scp/get` | POST | Download file |
| `/api/scp/put` | POST | Upload file |

---

## SCCP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sccp/probe` | POST | Probe SCCP |
| `/api/sccp/register` | POST | Register phone |
| `/api/sccp/line-state` | POST | Get line state |
| `/api/sccp/call-setup` | POST | Setup call |

---

## Sentinel

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sentinel/probe` | POST | Probe Sentinel |
| `/api/sentinel/query` | POST | Query masters |
| `/api/sentinel/get` | POST | Get master info |
| `/api/sentinel/get-master-addr` | POST | Get master address |
| `/api/sentinel/failover` | POST | Force failover |
| `/api/sentinel/reset` | POST | Reset master |
| `/api/sentinel/set` | POST | Set configuration |

---

## SFTP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sftp/connect` | POST | Connect via SSH |
| `/api/sftp/list` | POST | List directory |
| `/api/sftp/download` | POST | Download file |
| `/api/sftp/upload` | POST | Upload file |
| `/api/sftp/delete` | POST | Delete file |
| `/api/sftp/mkdir` | POST | Create directory |
| `/api/sftp/rename` | POST | Rename file |
| `/api/sftp/stat` | POST | Get file info |

---

## Shadowsocks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/shadowsocks/probe` | POST | Probe server |

---

## SHOUTcast

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/shoutcast/probe` | POST | Probe server |
| `/api/shoutcast/info` | POST | Get stream info |
| `/api/shoutcast/admin` | POST | Admin query |
| `/api/shoutcast/source` | POST | Source info |

---

## SIP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sip/options` | POST | OPTIONS probe |
| `/api/sip/register` | POST | REGISTER |
| `/api/sip/invite` | POST | INVITE call |
| `/api/sip/digest-auth` | POST | Digest auth |

---

## SIPS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sips/options` | POST | OPTIONS probe (TLS) |
| `/api/sips/register` | POST | REGISTER (TLS) |
| `/api/sips/invite` | POST | INVITE call (TLS) |
| `/api/sips/digest-auth` | POST | Digest auth (TLS) |

---

## SLP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/slp/types` | POST | List service types |
| `/api/slp/find` | POST | Find services |
| `/api/slp/attributes` | POST | Get attributes |

---

## SMB

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/smb/connect` | POST | Connect to share |
| `/api/smb/negotiate` | POST | Negotiate protocol |
| `/api/smb/session` | POST | Session setup |
| `/api/smb/tree` | POST | Tree connect |
| `/api/smb/stat` | POST | Get file info |

---

## SMTP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/smtp/connect` | POST | Connect and EHLO |
| `/api/smtp/send` | POST | Send email |

---

## SMTPS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/smtps/connect` | POST | TLS connect |
| `/api/smtps/send` | POST | Send email (TLS) |

---

## SMPP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/smpp/connect` | POST | Connect to SMSC |
| `/api/smpp/probe` | POST | Probe SMSC |
| `/api/smpp/submit` | POST | Submit SMS |
| `/api/smpp/query` | POST | Query status |

---

## SNMP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/snmp/get` | POST | SNMP GET |
| `/api/snmp/walk` | POST | SNMP Walk |
| `/api/snmp/v3-get` | POST | SNMPv3 GET |
| `/api/snmp/set` | POST | SNMP SET |
| `/api/snmp/multi-get` | POST | GET multiple OIDs |

---

## SNPP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/snpp/probe` | POST | Probe SNPP |
| `/api/snpp/page` | POST | Send page |

---

## SOAP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/soap/call` | POST | Call SOAP action |
| `/api/soap/wsdl` | POST | Fetch WSDL |

---

## SOCKS4

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/socks4/connect` | POST | SOCKS4 connect |
| `/api/socks4/relay` | POST | SOCKS4 relay |

---

## SOCKS5

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/socks5/connect` | POST | SOCKS5 connect |
| `/api/socks5/relay` | POST | SOCKS5 relay |

---

## Solr

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/solr/health` | POST | Health check |
| `/api/solr/query` | POST | Execute query |
| `/api/solr/index` | POST | Index document |
| `/api/solr/delete` | POST | Delete document |

---

## Sonic

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sonic/probe` | POST | Probe server |
| `/api/sonic/ping` | POST | Ping server |
| `/api/sonic/query` | POST | Search query |
| `/api/sonic/push` | POST | Push data |
| `/api/sonic/suggest` | POST | Auto-suggest |

---

## Spamd

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/spamd/ping` | POST | Ping spamd |
| `/api/spamd/check` | POST | Check message |
| `/api/spamd/tell` | POST | Report spam/ham |

---

## SPDY

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/spdy/connect` | POST | SPDY connect |
| `/api/spdy/h2-probe` | POST | HTTP/2 probe |

---

## SPICE

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/spice/connect` | POST | Connect to server |
| `/api/spice/channels` | POST | List channels |

---

## SSH

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ssh/connect` | POST | Establish SSH connection |
| `/api/ssh/exec` | POST | Execute command |
| `/api/ssh/disconnect` | POST | Disconnect session |
| `/api/ssh/kexinit` | POST | Key exchange init |
| `/api/ssh/auth` | POST | Authenticate |
| `/api/ssh/terminal` | POST | Interactive terminal |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/ssh/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","port":22,"username":"user","password":"pass","authMethod":"password"}'
```

```bash
curl -X POST 'https://l4.fyi/api/ssh/exec' \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","port":22,"username":"user","password":"pass","command":"uname -a"}'
```

---

## SSDP

> **Not implemented.** SSDP is UDP multicast only — see [IMPOSSIBLE.md](reference/IMPOSSIBLE.md).

---

## STOMP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stomp/connect` | POST | STOMP connect |
| `/api/stomp/send` | POST | Send message |
| `/api/stomp/subscribe` | POST | Subscribe to destination |

---

## STUN

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stun/binding` | POST | Binding request |
| `/api/stun/probe` | POST | Probe server |

---

## Submission

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/submission/connect` | POST | Connect (RFC 6409) |
| `/api/submission/send` | POST | Submit email |

---

## SVN

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/svn/connect` | POST | Connect to repository |
| `/api/svn/list` | POST | List directory |
| `/api/svn/info` | POST | Get info |

---

## Sybase

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sybase/probe` | POST | Probe server |
| `/api/sybase/version` | POST | Get version |
| `/api/sybase/login` | POST | Authenticate |
| `/api/sybase/query` | POST | Execute query |
| `/api/sybase/proc` | POST | Call procedure |

---

## Syslog

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/syslog/send` | POST | Send syslog message |

---

## TACACS+

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tacacs/probe` | POST | Probe server |
| `/api/tacacs/authenticate` | POST | Authenticate |

---

## Tarantool

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tarantool/connect` | POST | Connect to instance |
| `/api/tarantool/probe` | POST | Probe instance |
| `/api/tarantool/eval` | POST | Evaluate Lua |
| `/api/tarantool/sql` | POST | Execute SQL |

---

## TDS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tds/connect` | POST | Connect to SQL Server |
| `/api/tds/login` | POST | Authenticate |
| `/api/tds/query` | POST | Execute query |

---

## TeamSpeak

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/teamspeak/connect` | POST | Connect ServerQuery |
| `/api/teamspeak/command` | POST | Execute command |
| `/api/teamspeak/channel` | POST | Channel info |
| `/api/teamspeak/message` | POST | Send message |
| `/api/teamspeak/kick` | POST | Kick client |
| `/api/teamspeak/ban` | POST | Ban client |

---

## Telnet

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/telnet/connect` | POST/WebSocket | Connect to host |
| `/api/telnet/negotiate` | POST | Negotiate options |
| `/api/telnet/login` | POST | Login sequence |

---

## TFTP

> **Not implemented.** TFTP is UDP only — see [IMPOSSIBLE.md](reference/IMPOSSIBLE.md).

---

## Thrift

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/thrift/probe` | POST | Probe Thrift |
| `/api/thrift/call` | POST | Call method |

---

## Time

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/time/get` | POST | Get time (RFC 868) |

---

## Tor Control

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/torcontrol/probe` | POST | Probe control port |
| `/api/torcontrol/getinfo` | POST | Get Tor info |
| `/api/torcontrol/signal` | POST | Send signal |

---

## TURN

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/turn/allocate` | POST | Allocate relay |
| `/api/turn/probe` | POST | Probe server |
| `/api/turn/permission` | POST | Install permission |

---

## UUCP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/uucp/probe` | POST | Probe UUCP |
| `/api/uucp/handshake` | POST | UUCP handshake |

---

## uWSGI

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/uwsgi/probe` | POST | Probe uWSGI |
| `/api/uwsgi/request` | POST | Send request |

---

## Varnish

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/varnish/probe` | POST | Probe CLI |
| `/api/varnish/command` | POST | Execute command |
| `/api/varnish/ban` | POST | Ban URL/pattern |
| `/api/varnish/param` | POST | Get/set parameter |

---

## Vault

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vault/health` | POST | Health check |
| `/api/vault/query` | POST | Query API |
| `/api/vault/secret/read` | POST | Read secret |
| `/api/vault/secret/write` | POST | Write secret |

---

## Ventrilo

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ventrilo/status` | POST | Get server status |
| `/api/ventrilo/connect` | POST | Connect to server |

---

## VNC

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vnc/connect` | POST | Connect to server |
| `/api/vnc/auth` | POST | Authenticate |

---

## WebSocket

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/websocket/probe` | POST | Probe WebSocket server |
| `/api/websocket` | POST | Probe (alias) |

---

## Whois

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/whois/lookup` | POST | Domain WHOIS lookup |
| `/api/whois/ip` | POST | IP WHOIS lookup |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/whois/lookup' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","timeout":10000}'
```

---

## WinRM

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/winrm/identify` | POST | Identify endpoint |
| `/api/winrm/auth` | POST | Authenticate |
| `/api/winrm/exec` | POST | Execute command |

---

## X11

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/x11/connect` | POST | Connect to X server |
| `/api/x11/query-tree` | POST | Query window tree |

---

## XMPP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/xmpp/connect` | POST | Stream negotiation |
| `/api/xmpp/login` | POST | SASL authenticate |
| `/api/xmpp/roster` | POST | Get roster |
| `/api/xmpp/message` | POST | Send message |

---

## XMPP S2S

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/xmpps2s/probe` | POST | Probe S2S TLS |
| `/api/xmpps2s/federation` | POST | Federation test |
| `/api/xmpps2s/dialback` | POST | Dialback verify |
| `/api/xmpps2s/ping` | POST | Ping remote server |

---

## YMSG

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ymsg/probe` | POST | Probe YMSG server |
| `/api/ymsg/version` | POST | Version detect |
| `/api/ymsg/auth` | POST | Authenticate |
| `/api/ymsg/login` | POST | Login |

---

## Zabbix

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/zabbix/connect` | POST | Connect to agent |
| `/api/zabbix/agent` | POST | Query agent |
| `/api/zabbix/discovery` | POST | Low-level discovery |

---

## ZMTP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/zmtp/probe` | POST | Probe ZeroMQ |
| `/api/zmtp/handshake` | POST | ZMTP handshake |
| `/api/zmtp/send` | POST | Send message |
| `/api/zmtp/recv` | POST | Receive message |

---

## ZooKeeper

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/zookeeper/connect` | POST | Connect to ensemble |
| `/api/zookeeper/command` | POST | Four-letter command |
| `/api/zookeeper/get` | POST | Get znode data |
| `/api/zookeeper/set` | POST | Set znode data |
| `/api/zookeeper/create` | POST | Create znode |

### Curl Examples

```bash
curl -X POST 'https://l4.fyi/api/zookeeper/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"zk.example.com","port":2181,"timeout":5000}'
```

```bash
curl -X POST 'https://l4.fyi/api/zookeeper/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"zk.example.com","port":2181,"command":"stat","timeout":5000}'
```
