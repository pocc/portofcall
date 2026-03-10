# Protocol Curl Tests

Working curl tests against public servers using the [L4.FYI](https://l4.fyi) API.

Each test targets a publicly accessible server. Tests are grouped by testability status. All commands use the base URL `https://l4.fyi`.

---

## Table of Contents

### Testable Protocols (Public Servers Available)

- [DNS](#dns)
- [DoT (DNS over TLS)](#dot-dns-over-tls)
- [DICT](#dict)
- [Gemini](#gemini)
- [Git](#git)
- [Gopher](#gopher)
- [IRC](#irc)
- [Minecraft](#minecraft)
- [NATS](#nats)
- [NNTP](#nntp)
- [NTP / Time](#ntp--time)
- [Whois](#whois)
- [Echo](#echo)
- [SSH](#ssh)
- [FTP](#ftp)

### Testable with Your Own Server

- [ActiveMQ](#activemq)
- [AMQP / AMQPS](#amqp--amqps)
- [Beanstalkd](#beanstalkd)
- [Cassandra](#cassandra)
- [ClickHouse](#clickhouse)
- [Consul](#consul)
- [CouchDB](#couchdb)
- [Docker](#docker)
- [Elasticsearch](#elasticsearch)
- [Etcd](#etcd)
- [FastCGI](#fastcgi)
- [Fluentd](#fluentd)
- [Grafana](#grafana)
- [Graphite](#graphite)
- [HAProxy](#haproxy)
- [HTTP](#http)
- [HTTP Proxy](#http-proxy)
- [Icecast](#icecast)
- [InfluxDB](#influxdb)
- [IMAP / IMAPS](#imap--imaps)
- [IPFS](#ipfs)
- [JSON-RPC](#json-rpc)
- [Jupyter](#jupyter)
- [Kafka](#kafka)
- [LDAP](#ldap)
- [LMTP](#lmtp)
- [LPD](#lpd)
- [ManageSieve](#managesieve)
- [Memcached](#memcached)
- [MongoDB](#mongodb)
- [MPD](#mpd)
- [MQTT](#mqtt)
- [MySQL](#mysql)
- [Neo4j](#neo4j)
- [Nomad](#nomad)
- [NSQ](#nsq)
- [OpenVPN](#openvpn)
- [POP3](#pop3)
- [PostgreSQL](#postgresql)
- [RabbitMQ](#rabbitmq)
- [RCON](#rcon)
- [Redis](#redis)
- [RethinkDB](#rethinkdb)
- [Rsync](#rsync)
- [RTMP](#rtmp)
- [RTSP](#rtsp)
- [Sentinel](#sentinel)
- [SFTP](#sftp)
- [SIP / SIPS](#sip--sips)
- [SMB / CIFS](#smb--cifs)
- [SMTP / SMTPS](#smtp--smtps)
- [SOCKS4 / SOCKS5](#socks4--socks5)
- [Solr](#solr)
- [Sonic](#sonic)
- [Spamd](#spamd)
- [STOMP](#stomp)
- [SVN](#svn)
- [Syslog](#syslog)
- [TACACS](#tacacs)
- [Tarantool](#tarantool)
- [TDS (SQL Server)](#tds-sql-server)
- [TeamSpeak](#teamspeak)
- [Telnet](#telnet)
- [TFTP](#tftp)
- [Thrift](#thrift)
- [Varnish](#varnish)
- [Vault](#vault)
- [VNC](#vnc)
- [WebSocket](#websocket)
- [XMPP](#xmpp)
- [Zabbix](#zabbix)
- [ZMTP (ZeroMQ)](#zmtp-zeromq)
- [ZooKeeper](#zookeeper)

### Untestable Protocols

- [Untestable Protocol List](#untestable-protocols-1)

---

## Testable Protocols (Public Servers Available)

These tests target well-known public servers and should work immediately.

---

### DNS

Public DNS resolvers (Google 8.8.8.8, Cloudflare 1.1.1.1) are freely available.

#### Query A record via Google DNS

```bash
curl -X POST 'https://l4.fyi/api/dns/query' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","type":"A","server":"8.8.8.8","port":53,"edns":true,"dnssecOK":true}'
```

#### Query AAAA record via Cloudflare DNS

```bash
curl -X POST 'https://l4.fyi/api/dns/query' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","type":"AAAA","server":"1.1.1.1","port":53,"edns":true}'
```

#### Query MX record

```bash
curl -X POST 'https://l4.fyi/api/dns/query' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"gmail.com","type":"MX","server":"8.8.8.8","port":53}'
```

#### Query NS record

```bash
curl -X POST 'https://l4.fyi/api/dns/query' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"cloudflare.com","type":"NS","server":"8.8.8.8","port":53}'
```

#### Query TXT record

```bash
curl -X POST 'https://l4.fyi/api/dns/query' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"google.com","type":"TXT","server":"8.8.8.8","port":53}'
```

#### Query SOA record

```bash
curl -X POST 'https://l4.fyi/api/dns/query' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","type":"SOA","server":"8.8.8.8","port":53}'
```

---

### DoT (DNS over TLS)

Cloudflare (1.1.1.1) and Google (8.8.8.8) support DNS over TLS on port 853.

#### Query via Cloudflare DoT

```bash
curl -X POST 'https://l4.fyi/api/dot/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"1.1.1.1","port":853,"domain":"example.com","type":"A"}'
```

#### Query AAAA via Cloudflare DoT

```bash
curl -X POST 'https://l4.fyi/api/dot/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"1.1.1.1","port":853,"domain":"example.com","type":"AAAA"}'
```

#### Query via Google DoT

```bash
curl -X POST 'https://l4.fyi/api/dot/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"8.8.8.8","port":853,"domain":"google.com","type":"A"}'
```

---

### DICT

The public DICT server at dict.org:2628 is freely accessible.

#### Define a word

```bash
curl -X POST 'https://l4.fyi/api/dict/define' \
  -H 'Content-Type: application/json' \
  -d '{"host":"dict.org","port":2628,"word":"serendipity","database":"*","timeout":15000}'
```

#### Match words by prefix

```bash
curl -X POST 'https://l4.fyi/api/dict/match' \
  -H 'Content-Type: application/json' \
  -d '{"host":"dict.org","port":2628,"word":"proto","database":"*","strategy":"prefix","timeout":15000}'
```

#### List available databases

```bash
curl -X POST 'https://l4.fyi/api/dict/databases' \
  -H 'Content-Type: application/json' \
  -d '{"host":"dict.org","port":2628,"timeout":15000}'
```

---

### Gemini

geminiprotocol.net:1965 is the official Gemini protocol capsule.

#### Fetch Gemini homepage

```bash
curl -X POST 'https://l4.fyi/api/gemini/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"geminiprotocol.net","port":1965,"path":"/","timeout":10000}'
```

#### Fetch Gemini documentation

```bash
curl -X POST 'https://l4.fyi/api/gemini/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"geminiprotocol.net","port":1965,"path":"/docs/","timeout":10000}'
```

---

### Git

git.kernel.org:9418 provides public Git protocol access to the Linux kernel repos.

#### List refs for the Git repository

```bash
curl -X POST 'https://l4.fyi/api/git/refs' \
  -H 'Content-Type: application/json' \
  -d '{"host":"git.kernel.org","port":9418,"repo":"/pub/scm/git/git.git","timeout":10000}'
```

#### Fetch HEAD ref

```bash
curl -X POST 'https://l4.fyi/api/git/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"git.kernel.org","port":9418,"repository":"/pub/scm/git/git.git","wantRef":"HEAD","timeout":10000}'
```

---

### Gopher

gopher.floodgap.com:70 is the most well-known public Gopher server.

#### Fetch Gopher root menu

```bash
curl -X POST 'https://l4.fyi/api/gopher/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"gopher.floodgap.com","port":70,"selector":"","timeout":15000}'
```

#### Fetch a Gopher sub-menu

```bash
curl -X POST 'https://l4.fyi/api/gopher/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"gopher.floodgap.com","port":70,"selector":"/gopher","timeout":15000}'
```

---

### IRC

irc.libera.chat:6667 is the public Libera.Chat IRC network.

#### Connect to Libera.Chat

```bash
curl -X POST 'https://l4.fyi/api/irc/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"irc.libera.chat","port":6667,"nickname":"portofcall_test","timeout":10000}'
```

---

### Minecraft

mc.hypixel.net:25565 is a popular public Minecraft server.

#### Query Minecraft server status

```bash
curl -X POST 'https://l4.fyi/api/minecraft/status' \
  -H 'Content-Type: application/json' \
  -d '{"host":"mc.hypixel.net","port":25565,"timeout":10000}'
```

#### Ping Minecraft server

```bash
curl -X POST 'https://l4.fyi/api/minecraft/ping' \
  -H 'Content-Type: application/json' \
  -d '{"host":"mc.hypixel.net","port":25565,"timeout":10000}'
```

---

### NATS

demo.nats.io:4222 is a free public NATS demo server.

#### Connect to NATS demo server

```bash
curl -X POST 'https://l4.fyi/api/nats/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"demo.nats.io","port":4222,"timeout":10000}'
```

#### Publish a message

```bash
curl -X POST 'https://l4.fyi/api/nats/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"demo.nats.io","port":4222,"subject":"test.portofcall","payload":"Hello from L4.FYI","timeout":10000}'
```

#### Subscribe to messages

```bash
curl -X POST 'https://l4.fyi/api/nats/subscribe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"demo.nats.io","port":4222,"subject":"test.>","max_msgs":5,"timeout_ms":10000}'
```

#### Request-reply pattern

```bash
curl -X POST 'https://l4.fyi/api/nats/request' \
  -H 'Content-Type: application/json' \
  -d '{"host":"demo.nats.io","port":4222,"subject":"service.echo","payload":"ping","timeout_ms":5000}'
```

---

### NNTP

news.aioe.org:119 is a free public Usenet news server.

#### Connect to NNTP server

```bash
curl -X POST 'https://l4.fyi/api/nntp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","port":119,"timeout":10000}'
```

#### Select a newsgroup

```bash
curl -X POST 'https://l4.fyi/api/nntp/group' \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","port":119,"group":"comp.lang.python","timeout":10000}'
```

#### Read an article

```bash
curl -X POST 'https://l4.fyi/api/nntp/article' \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","port":119,"group":"comp.lang.python","articleNumber":1,"timeout":10000}'
```

#### List active newsgroups

```bash
curl -X POST 'https://l4.fyi/api/nntp/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"news.aioe.org","port":119,"variant":"active","timeout":15000}'
```

---

### NTP / Time

time.nist.gov:37 is a public NTP/Time server operated by NIST.

#### Get time from NIST

```bash
curl -X POST 'https://l4.fyi/api/time/get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"time.nist.gov","port":37,"timeout":10000}'
```

---

### Whois

whois.verisign-grs.com:43 and whois.arin.net:43 are public WHOIS servers.

#### Domain WHOIS lookup

```bash
curl -X POST 'https://l4.fyi/api/whois/lookup' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","server":"whois.verisign-grs.com","port":43,"followReferral":true,"timeout":10000}'
```

#### IP WHOIS lookup

```bash
curl -X POST 'https://l4.fyi/api/whois/ip' \
  -H 'Content-Type: application/json' \
  -d '{"query":"8.8.8.8","server":"whois.arin.net","followReferral":true,"timeout":10000}'
```

#### Domain WHOIS for .org TLD

```bash
curl -X POST 'https://l4.fyi/api/whois/lookup' \
  -H 'Content-Type: application/json' \
  -d '{"domain":"wikipedia.org","server":"whois.pir.org","port":43,"followReferral":true,"timeout":10000}'
```

---

### Echo

tcpbin.com:7 provides a public TCP echo service.

#### Echo test

```bash
curl -X POST 'https://l4.fyi/api/echo/test' \
  -H 'Content-Type: application/json' \
  -d '{"host":"tcpbin.com","port":7,"message":"Hello, Echo!","timeout":10000}'
```

#### Echo connect

```bash
curl -X POST 'https://l4.fyi/api/echo/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"tcpbin.com","port":7,"timeout":5000}'
```

---

### SSH

Many public servers expose SSH on port 22. These tests probe the SSH banner and key exchange, not authenticate.

#### SSH banner grab (key exchange info)

```bash
curl -X POST 'https://l4.fyi/api/ssh/kexinit' \
  -H 'Content-Type: application/json' \
  -d '{"host":"github.com","port":22,"timeout":5000}'
```

#### SSH auth methods probe

```bash
curl -X POST 'https://l4.fyi/api/ssh/auth' \
  -H 'Content-Type: application/json' \
  -d '{"host":"github.com","port":22,"timeout":5000}'
```

---

### FTP

Public FTP servers with anonymous access exist but are increasingly rare. ftp.gnu.org is one example.

#### Connect to public FTP server

```bash
curl -X POST 'https://l4.fyi/api/ftp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.gnu.org","port":21,"username":"anonymous","password":"test@example.com"}'
```

#### List files on public FTP

```bash
curl -X POST 'https://l4.fyi/api/ftp/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.gnu.org","port":21,"username":"anonymous","password":"test@example.com","path":"/gnu"}'
```

#### Query FTP server features

```bash
curl -X POST 'https://l4.fyi/api/ftp/feat' \
  -H 'Content-Type: application/json' \
  -d '{"host":"ftp.gnu.org","port":21,"username":"anonymous","password":"test@example.com"}'
```

---

## Testable with Your Own Server

These protocols require your own infrastructure. Replace `your-server.example.com` and credentials with your actual values.

---

### ActiveMQ

Requires an ActiveMQ broker. Default STOMP port 61613, OpenWire port 61616.

#### Probe ActiveMQ

```bash
curl -X POST 'https://l4.fyi/api/activemq/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":61616,"timeout":5000}'
```

#### Connect via STOMP

```bash
curl -X POST 'https://l4.fyi/api/activemq/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":61613,"username":"admin","password":"admin","timeout":8000}'
```

#### Send message

```bash
curl -X POST 'https://l4.fyi/api/activemq/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":61613,"username":"admin","password":"admin","destination":"/queue/test","body":"Hello from L4.FYI","contentType":"text/plain","timeout":8000}'
```

#### Subscribe to queue

```bash
curl -X POST 'https://l4.fyi/api/activemq/subscribe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":61613,"username":"admin","password":"admin","destination":"/queue/test","maxMessages":10,"timeout":15000}'
```

---

### AMQP / AMQPS

Requires a RabbitMQ broker. Default AMQP port 5672, AMQPS port 5671.

#### Connect AMQP

```bash
curl -X POST 'https://l4.fyi/api/amqp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5672,"timeout":5000,"vhost":"/"}'
```

#### Publish AMQP

```bash
curl -X POST 'https://l4.fyi/api/amqp/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5672,"username":"guest","password":"guest","vhost":"/","exchange":"amq.direct","exchangeType":"direct","routingKey":"test","message":"Hello AMQP","timeout":8000}'
```

#### Consume AMQP

```bash
curl -X POST 'https://l4.fyi/api/amqp/consume' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5672,"username":"guest","password":"guest","vhost":"/","queue":"test-queue","maxMessages":5,"timeoutMs":10000}'
```

#### Connect AMQPS (TLS)

```bash
curl -X POST 'https://l4.fyi/api/amqps/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5671}'
```

---

### Beanstalkd

Requires a Beanstalkd server on port 11300.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/beanstalkd/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11300,"timeout":5000}'
```

#### Put job

```bash
curl -X POST 'https://l4.fyi/api/beanstalkd/put' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11300,"data":"{\"task\":\"send-email\"}","priority":1024,"delay":0,"ttr":60,"timeout":5000}'
```

#### Reserve job

```bash
curl -X POST 'https://l4.fyi/api/beanstalkd/reserve' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11300,"reserveTimeout":5,"timeout":10000}'
```

#### List tubes

```bash
curl -X POST 'https://l4.fyi/api/beanstalkd/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11300,"command":"list-tubes","timeout":5000}'
```

---

### Cassandra

Requires a Cassandra cluster on port 9042.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/cassandra/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9042,"timeout":5000}'
```

#### Query system table

```bash
curl -X POST 'https://l4.fyi/api/cassandra/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9042,"cql":"SELECT * FROM system.local","username":"cassandra","password":"cassandra","timeout":8000}'
```

---

### ClickHouse

Requires a ClickHouse server. HTTP API on port 8123, native on port 9000.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/clickhouse/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8123,"timeout":5000}'
```

#### Query

```bash
curl -X POST 'https://l4.fyi/api/clickhouse/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8123,"query":"SELECT count() FROM system.tables","username":"default","password":"","timeout":10000}'
```

#### Native protocol probe

```bash
curl -X POST 'https://l4.fyi/api/clickhouse/native' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9000,"timeout":5000}'
```

---

### Consul

Requires a Consul agent on port 8500.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/consul/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8500,"timeout":5000}'
```

#### List services

```bash
curl -X POST 'https://l4.fyi/api/consul/services' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8500,"timeout":5000}'
```

#### KV get

```bash
curl 'https://l4.fyi/api/consul/kv/my-key?host=your-server.example.com&port=8500&timeout=5000'
```

#### KV put

```bash
curl -X POST 'https://l4.fyi/api/consul/kv/my-key' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8500,"value":"my-value","timeout":5000}'
```

---

### CouchDB

Requires a CouchDB server on port 5984.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/couchdb/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5984,"timeout":5000}'
```

#### List databases

```bash
curl -X POST 'https://l4.fyi/api/couchdb/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5984,"path":"/_all_dbs","method":"GET","username":"admin","password":"couchpass","timeout":8000}'
```

---

### Docker

Requires Docker daemon with TCP API enabled on port 2375 (unsecured) or 2376 (TLS).

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/docker/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2375,"timeout":5000}'
```

#### List containers

```bash
curl -X POST 'https://l4.fyi/api/docker/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2375,"path":"/containers/json","method":"GET","timeout":8000}'
```

#### Container logs

```bash
curl -X POST 'https://l4.fyi/api/docker/container-logs' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2375,"containerId":"your-container-id","tail":100,"timeout":10000}'
```

---

### Elasticsearch

Requires an Elasticsearch cluster on port 9200.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/elasticsearch/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9200,"username":"elastic","password":"changeme","timeout":5000}'
```

#### List indices

```bash
curl -X POST 'https://l4.fyi/api/elasticsearch/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9200,"path":"/_cat/indices","method":"GET","username":"elastic","password":"changeme","timeout":5000}'
```

#### Index a document

```bash
curl -X POST 'https://l4.fyi/api/elasticsearch/index' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9200,"index":"test-index","id":"1","doc":{"title":"Test","content":"Hello"},"username":"elastic","password":"changeme","https":false,"timeout":5000}'
```

---

### Etcd

Requires an etcd cluster on port 2379.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/etcd/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2379,"timeout":5000}'
```

#### Query

```bash
curl -X POST 'https://l4.fyi/api/etcd/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2379,"path":"/v3/kv/range","method":"POST","timeout":5000}'
```

---

### FastCGI

Requires a FastCGI server (e.g., PHP-FPM) on port 9000.

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/fastcgi/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9000,"timeout":5000}'
```

#### Request

```bash
curl -X POST 'https://l4.fyi/api/fastcgi/request' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9000,"documentRoot":"/var/www/html","scriptFilename":"/var/www/html/index.php","timeout":5000}'
```

---

### Fluentd

Requires a Fluentd server with the forward input plugin.

#### Send log event

```bash
curl -X POST 'https://l4.fyi/api/fluentd/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":24224,"tag":"app.logs","record":{"message":"Hello from L4.FYI","level":"info"},"timeout":5000}'
```

---

### Grafana

Requires a Grafana instance on port 3000.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/grafana/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3000,"timeout":5000}'
```

---

### Graphite

Requires a Graphite server. Carbon receiver on port 2003, web render on port 8080.

#### Send metrics

```bash
curl -X POST 'https://l4.fyi/api/graphite/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2003,"metrics":[{"name":"test.cpu.usage","value":42.5}],"timeout":5000}'
```

#### Query metrics

```bash
curl 'https://l4.fyi/api/graphite/query?host=your-server.example.com&target=test.cpu.usage&from=-1h&until=now&format=json&renderPort=8080'
```

---

### HAProxy

Requires HAProxy with stats socket enabled.

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/haproxy/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9999,"timeout":5000}'
```

---

### HTTP

Works with any HTTP server.

#### HTTP probe

```bash
curl -X POST 'https://l4.fyi/api/http/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"example.com","port":80,"timeout":5000}'
```

---

### HTTP Proxy

Requires an HTTP proxy server.

#### Probe proxy

```bash
curl -X POST 'https://l4.fyi/api/httpproxy/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8080,"timeout":5000}'
```

#### CONNECT tunnel

```bash
curl -X POST 'https://l4.fyi/api/httpproxy/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8080,"targetHost":"example.com","targetPort":443,"timeout":5000}'
```

---

### Icecast

Requires an Icecast streaming server.

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/icecast/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8000,"timeout":5000}'
```

---

### InfluxDB

Requires an InfluxDB instance on port 8086.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/influxdb/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8086,"timeout":5000}'
```

---

### IMAP / IMAPS

Requires an IMAP mail server. Port 143 for IMAP, 993 for IMAPS.

#### Connect IMAP

```bash
curl -X POST 'https://l4.fyi/api/imap/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":143,"username":"user@example.com","password":"mailpass","timeout":5000}'
```

#### List mailboxes

```bash
curl -X POST 'https://l4.fyi/api/imap/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":143,"username":"user@example.com","password":"mailpass","timeout":5000}'
```

#### Connect IMAPS (TLS)

```bash
curl -X POST 'https://l4.fyi/api/imaps/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":993,"username":"user@example.com","password":"mailpass","timeout":5000}'
```

---

### IPFS

Requires an IPFS node with the API exposed on port 5001.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/ipfs/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5001,"timeout":5000}'
```

---

### JSON-RPC

Works with any JSON-RPC server (e.g., Ethereum node on port 8545).

#### Call method

```bash
curl -X POST 'https://l4.fyi/api/jsonrpc/call' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8545,"method":"eth_blockNumber","params":[],"id":1,"timeout":5000}'
```

#### Batch call

```bash
curl -X POST 'https://l4.fyi/api/jsonrpc/batch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8545,"requests":[{"method":"eth_blockNumber","params":[]},{"method":"net_version","params":[]}],"timeout":5000}'
```

---

### Jupyter

Requires a Jupyter notebook server on port 8888.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/jupyter/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8888,"token":"your-jupyter-token","timeout":5000}'
```

#### List kernels

```bash
curl -X POST 'https://l4.fyi/api/jupyter/kernels' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8888,"token":"your-jupyter-token","timeout":5000}'
```

#### List notebooks

```bash
curl -X POST 'https://l4.fyi/api/jupyter/notebooks' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8888,"token":"your-jupyter-token","timeout":5000}'
```

---

### Kafka

Requires a Kafka broker on port 9092.

#### API versions

```bash
curl -X POST 'https://l4.fyi/api/kafka/versions' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9092,"timeout":5000,"clientId":"portofcall-client"}'
```

#### Produce message

```bash
curl -X POST 'https://l4.fyi/api/kafka/produce' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9092,"topic":"test-topic","key":"key-1","value":"Hello Kafka","acks":-1,"timeout":5000,"clientId":"portofcall-client"}'
```

#### Metadata

```bash
curl -X POST 'https://l4.fyi/api/kafka/metadata' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9092,"topics":["test-topic"],"timeout":5000,"clientId":"portofcall-client"}'
```

#### Fetch messages

```bash
curl -X POST 'https://l4.fyi/api/kafka/fetch' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9092,"topic":"test-topic","partition":0,"offset":0,"maxWaitMs":1000,"maxBytes":65536,"timeout":5000,"clientId":"portofcall-client"}'
```

#### List consumer groups

```bash
curl -X POST 'https://l4.fyi/api/kafka/groups' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9092,"timeout":5000,"clientId":"portofcall-client"}'
```

---

### LDAP

Requires an LDAP server on port 389.

#### Connect and bind

```bash
curl -X POST 'https://l4.fyi/api/ldap/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":389,"bindDn":"cn=admin,dc=example,dc=com","password":"adminpass","timeout":5000}'
```

#### Search

```bash
curl -X POST 'https://l4.fyi/api/ldap/search' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":389,"bindDn":"cn=admin,dc=example,dc=com","password":"adminpass","baseDn":"dc=example,dc=com","filter":"(objectClass=*)","scope":2,"sizeLimit":10,"timeout":10000}'
```

#### Add entry

```bash
curl -X POST 'https://l4.fyi/api/ldap/add' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":389,"bindDn":"cn=admin,dc=example,dc=com","password":"adminpass","entry":{"dn":"cn=Test User,dc=example,dc=com","attributes":{"objectClass":["inetOrgPerson","top"],"cn":"Test User","sn":"User","mail":"test@example.com"}},"timeout":5000}'
```

---

### LMTP

Requires an LMTP server on port 24 (used by Dovecot, Cyrus, etc.).

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/lmtp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":24,"timeout":5000}'
```

#### Send message

```bash
curl -X POST 'https://l4.fyi/api/lmtp/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":24,"from":"sender@example.com","to":["recipient@example.com"],"subject":"Test","body":"Hello via LMTP","timeout":10000}'
```

---

### LPD

Requires an LPD print server on port 515.

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/lpd/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":515,"timeout":5000}'
```

#### Queue status

```bash
curl -X POST 'https://l4.fyi/api/lpd/queue' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":515,"queue":"lp0","timeout":5000}'
```

---

### ManageSieve

Requires a ManageSieve server on port 4190 (Dovecot, Cyrus).

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/managesieve/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4190,"timeout":5000}'
```

#### List scripts

```bash
curl -X POST 'https://l4.fyi/api/managesieve/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4190,"username":"user@example.com","password":"secret","timeout":5000}'
```

---

### Memcached

Requires a Memcached server on port 11211.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/memcached/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11211,"timeout":5000}'
```

#### Stats

```bash
curl -X POST 'https://l4.fyi/api/memcached/stats' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11211,"timeout":5000}'
```

#### Version

```bash
curl -X POST 'https://l4.fyi/api/memcached/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11211,"command":"version","timeout":5000}'
```

#### Get keys

```bash
curl -X POST 'https://l4.fyi/api/memcached/gets' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":11211,"keys":["session:abc123","user:42"],"timeout":5000}'
```

---

### MongoDB

Requires a MongoDB server on port 27017.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/mongodb/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":27017,"timeout":5000}'
```

#### Ping

```bash
curl -X POST 'https://l4.fyi/api/mongodb/ping' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":27017,"timeout":5000}'
```

#### Find documents

```bash
curl -X POST 'https://l4.fyi/api/mongodb/find' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":27017,"database":"test","collection":"users","filter":{},"limit":10,"timeout":10000}'
```

#### Insert document

```bash
curl -X POST 'https://l4.fyi/api/mongodb/insert' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":27017,"database":"test","collection":"users","documents":[{"name":"Alice","email":"alice@example.com"}],"timeout":10000}'
```

---

### MPD

Requires a Music Player Daemon on port 6600.

#### Status

```bash
curl -X POST 'https://l4.fyi/api/mpd/status' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6600,"timeout":5000}'
```

#### Current song

```bash
curl -X POST 'https://l4.fyi/api/mpd/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6600,"command":"currentsong","timeout":5000}'
```

---

### MQTT

Requires an MQTT broker on port 1883.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/mqtt/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1883,"clientId":"portofcall-test","cleanSession":true,"keepAlive":60,"timeout":10000}'
```

#### Publish

```bash
curl -X POST 'https://l4.fyi/api/mqtt/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1883,"clientId":"portofcall-pub","topic":"test/hello","payload":"Hello MQTT","qos":0,"retain":false,"timeout":10000}'
```

---

### MySQL

Requires a MySQL server on port 3306.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/mysql/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3306,"username":"root","password":"secret","database":"mysql","timeout":5000}'
```

#### Query

```bash
curl -X POST 'https://l4.fyi/api/mysql/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3306,"username":"root","password":"secret","database":"mysql","query":"SELECT VERSION()","timeout":10000}'
```

#### List databases

```bash
curl -X POST 'https://l4.fyi/api/mysql/databases' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3306,"username":"root","password":"secret","timeout":5000}'
```

#### List tables

```bash
curl -X POST 'https://l4.fyi/api/mysql/tables' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3306,"username":"root","password":"secret","database":"mysql","timeout":5000}'
```

---

### Neo4j

Requires a Neo4j server on port 7687 (Bolt protocol).

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/neo4j/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":7687,"timeout":5000}'
```

#### Query

```bash
curl -X POST 'https://l4.fyi/api/neo4j/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":7687,"username":"neo4j","password":"secret","query":"MATCH (n) RETURN count(n)","database":"neo4j","timeout":10000}'
```

#### Schema

```bash
curl -X POST 'https://l4.fyi/api/neo4j/schema' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":7687,"username":"neo4j","password":"secret"}'
```

---

### Nomad

Requires a HashiCorp Nomad server on port 4646.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/nomad/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4646,"timeout":5000}'
```

#### List jobs

```bash
curl -X POST 'https://l4.fyi/api/nomad/jobs' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4646,"token":"your-token","timeout":5000}'
```

#### List nodes

```bash
curl -X POST 'https://l4.fyi/api/nomad/nodes' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4646,"token":"your-token","timeout":5000}'
```

---

### NSQ

Requires an NSQ daemon on port 4150.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/nsq/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4150,"timeout":5000}'
```

#### Publish

```bash
curl -X POST 'https://l4.fyi/api/nsq/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4150,"topic":"test","message":"Hello NSQ","timeout":5000}'
```

#### Multi-publish

```bash
curl -X POST 'https://l4.fyi/api/nsq/mpub' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4150,"topic":"test","messages":["msg1","msg2","msg3"],"timeout":5000}'
```

#### Subscribe

```bash
curl -X POST 'https://l4.fyi/api/nsq/subscribe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":4150,"topic":"test","channel":"worker-1","maxMessages":10,"timeout":10000}'
```

---

### OpenVPN

Requires an OpenVPN server on port 1194.

#### TLS handshake probe

```bash
curl -X POST 'https://l4.fyi/api/openvpn/handshake' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1194,"timeout":5000}'
```

---

### POP3

Requires a POP3 mail server on port 110.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/pop3/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":110,"username":"user@example.com","password":"secret","timeout":5000}'
```

#### List messages

```bash
curl -X POST 'https://l4.fyi/api/pop3/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":110,"username":"user@example.com","password":"secret","timeout":5000}'
```

#### Capabilities

```bash
curl -X POST 'https://l4.fyi/api/pop3/capa' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":110,"timeout":5000}'
```

---

### PostgreSQL

Requires a PostgreSQL server on port 5432.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/postgres/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5432,"username":"postgres","password":"secret","database":"postgres","timeout":5000}'
```

#### Query

```bash
curl -X POST 'https://l4.fyi/api/postgres/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5432,"username":"postgres","password":"secret","database":"postgres","query":"SELECT version()","timeout":10000}'
```

#### Listen for notifications

```bash
curl -X POST 'https://l4.fyi/api/postgres/listen' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5432,"username":"postgres","password":"secret","database":"postgres","channel":"events","waitMs":5000,"timeout":15000}'
```

#### Send notification

```bash
curl -X POST 'https://l4.fyi/api/postgres/notify' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5432,"username":"postgres","password":"secret","database":"postgres","channel":"events","payload":"hello","timeout":5000}'
```

---

### RabbitMQ

Requires RabbitMQ with management plugin on port 15672.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/rabbitmq/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":15672,"username":"guest","password":"guest","timeout":5000}'
```

#### Publish message

```bash
curl -X POST 'https://l4.fyi/api/rabbitmq/publish' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":15672,"username":"guest","password":"guest","vhost":"/","exchange":"amq.direct","routingKey":"test","payload":"Hello RabbitMQ","timeout":5000}'
```

#### Overview query

```bash
curl -X POST 'https://l4.fyi/api/rabbitmq/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":15672,"username":"guest","password":"guest","path":"/api/overview","timeout":5000}'
```

---

### RCON

Requires a game server with RCON enabled (Minecraft: 25575, Source: 27015).

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/rcon/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":25575,"password":"rcon-password","timeout":5000}'
```

#### Execute command

```bash
curl -X POST 'https://l4.fyi/api/rcon/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":25575,"password":"rcon-password","command":"list","timeout":5000}'
```

---

### Redis

Requires a Redis server on port 6379.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/redis/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6379,"timeout":5000}'
```

#### SET

```bash
curl -X POST 'https://l4.fyi/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6379,"command":["SET","test-key","Hello from L4.FYI"],"timeout":5000}'
```

#### GET

```bash
curl -X POST 'https://l4.fyi/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6379,"command":["GET","test-key"],"timeout":5000}'
```

#### INFO

```bash
curl -X POST 'https://l4.fyi/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6379,"command":["INFO","server"],"timeout":5000}'
```

#### KEYS

```bash
curl -X POST 'https://l4.fyi/api/redis/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6379,"command":["KEYS","*"],"timeout":5000}'
```

---

### RethinkDB

Requires a RethinkDB server on port 28015.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/rethinkdb/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":28015,"timeout":5000}'
```

#### Server info

```bash
curl -X POST 'https://l4.fyi/api/rethinkdb/info' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":28015,"timeout":5000}'
```

#### List tables

```bash
curl -X POST 'https://l4.fyi/api/rethinkdb/tables' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":28015,"database":"test","timeout":5000}'
```

---

### Rsync

Requires an rsync daemon on port 873.

#### Connect (list modules)

```bash
curl -X POST 'https://l4.fyi/api/rsync/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":873,"timeout":5000}'
```

#### List module contents

```bash
curl -X POST 'https://l4.fyi/api/rsync/module' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":873,"module":"data","timeout":5000}'
```

---

### RTMP

Requires an RTMP streaming server on port 1935 (Nginx-RTMP, OBS, etc.).

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/rtmp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1935,"app":"live","timeout":5000}'
```

---

### RTSP

Requires an RTSP streaming server on port 554 (IP cameras, media servers).

#### OPTIONS request

```bash
curl -X POST 'https://l4.fyi/api/rtsp/options' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":554,"path":"/live","timeout":5000}'
```

#### DESCRIBE request

```bash
curl -X POST 'https://l4.fyi/api/rtsp/describe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":554,"path":"/live","timeout":5000}'
```

---

### Sentinel

Requires Redis Sentinel on port 26379.

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/sentinel/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":26379,"timeout":5000}'
```

#### Get master info

```bash
curl -X POST 'https://l4.fyi/api/sentinel/get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":26379,"masterName":"mymaster","timeout":5000}'
```

#### PING

```bash
curl -X POST 'https://l4.fyi/api/sentinel/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":26379,"command":"PING","timeout":5000}'
```

---

### SFTP

Requires an SSH/SFTP server on port 22.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/sftp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser"}'
```

#### List files

```bash
curl -X POST 'https://l4.fyi/api/sftp/list' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser","password":"secret","path":"/home/sftpuser","timeout":10000}'
```

#### Upload file

```bash
curl -X POST 'https://l4.fyi/api/sftp/upload' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser","password":"secret","path":"/home/sftpuser/hello.txt","content":"Hello from L4.FYI!","encoding":"utf8","timeout":10000}'
```

#### Download file

```bash
curl -X POST 'https://l4.fyi/api/sftp/download' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":22,"username":"sftpuser","password":"secret","path":"/home/sftpuser/hello.txt","timeout":10000}'
```

---

### SIP / SIPS

Requires a SIP server on port 5060 (SIP) or 5061 (SIPS/TLS).

#### SIP OPTIONS

```bash
curl -X POST 'https://l4.fyi/api/sip/options' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5060,"timeout":5000}'
```

#### SIP REGISTER

```bash
curl -X POST 'https://l4.fyi/api/sip/register' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5060,"username":"1001","domain":"sip.example.com","timeout":5000}'
```

#### SIPS OPTIONS (TLS)

```bash
curl -X POST 'https://l4.fyi/api/sips/options' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5061,"timeout":5000}'
```

---

### SMB / CIFS

Requires an SMB/CIFS file server on port 445.

#### SMB Connect

```bash
curl -X POST 'https://l4.fyi/api/smb/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":445,"timeout":5000}'
```

#### SMB Negotiate

```bash
curl -X POST 'https://l4.fyi/api/smb/negotiate' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":445,"timeout":5000}'
```

#### CIFS Connect

```bash
curl -X POST 'https://l4.fyi/api/cifs/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":445,"timeout":5000}'
```

#### CIFS List directory

```bash
curl -X POST 'https://l4.fyi/api/cifs/ls' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":445,"username":"user","password":"pass","share":"shared","path":"/","timeout":15000}'
```

---

### SMTP / SMTPS

Requires an SMTP server on port 25 (SMTP) or 465 (SMTPS).

#### Connect SMTP

```bash
curl -X POST 'https://l4.fyi/api/smtp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":25,"useTLS":false,"timeout":5000}'
```

#### Send email

```bash
curl -X POST 'https://l4.fyi/api/smtp/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":25,"username":"mailuser","password":"mailpass","from":"sender@example.com","to":"recipient@example.com","subject":"Test","body":"Hello from L4.FYI!","timeout":10000}'
```

#### Connect SMTPS (TLS)

```bash
curl -X POST 'https://l4.fyi/api/smtps/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":465,"useTLS":true,"timeout":5000}'
```

---

### SOCKS4 / SOCKS5

Requires a SOCKS proxy server on port 1080.

#### SOCKS4 connect

```bash
curl -X POST 'https://l4.fyi/api/socks4/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1080,"targetHost":"example.com","targetPort":80,"timeout":5000}'
```

#### SOCKS5 connect

```bash
curl -X POST 'https://l4.fyi/api/socks5/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1080,"targetHost":"example.com","targetPort":443,"timeout":5000}'
```

---

### Solr

Requires an Apache Solr server on port 8983.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/solr/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8983,"timeout":5000}'
```

#### Query

```bash
curl -X POST 'https://l4.fyi/api/solr/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8983,"collection":"products","query":"*:*","rows":10,"timeout":5000}'
```

---

### Sonic

Requires a Sonic search backend on port 1491.

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/sonic/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1491,"timeout":5000}'
```

#### Ping

```bash
curl -X POST 'https://l4.fyi/api/sonic/ping' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1491,"password":"SecretPassword","timeout":5000}'
```

#### Push data

```bash
curl -X POST 'https://l4.fyi/api/sonic/push' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1491,"password":"SecretPassword","collection":"articles","bucket":"default","object":"article:1","text":"The quick brown fox","timeout":5000}'
```

#### Search

```bash
curl -X POST 'https://l4.fyi/api/sonic/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1491,"password":"SecretPassword","collection":"articles","bucket":"default","terms":"brown fox","timeout":5000}'
```

---

### Spamd

Requires SpamAssassin spamd on port 783.

#### Ping

```bash
curl -X POST 'https://l4.fyi/api/spamd/ping' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":783,"timeout":5000}'
```

---

### STOMP

Requires a STOMP-compatible broker on port 61613 (RabbitMQ, ActiveMQ).

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/stomp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":61613,"username":"guest","password":"guest","vhost":"/","timeout":5000}'
```

#### Send message

```bash
curl -X POST 'https://l4.fyi/api/stomp/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":61613,"username":"guest","password":"guest","destination":"/queue/test","body":"Hello STOMP","contentType":"text/plain","timeout":5000}'
```

#### Subscribe

```bash
curl -X POST 'https://l4.fyi/api/stomp/subscribe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":61613,"username":"guest","password":"guest","destination":"/queue/test","maxMessages":5,"timeout":10000}'
```

---

### SVN

Requires a Subversion server on port 3690.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/svn/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3690,"timeout":5000}'
```

#### Repository info

```bash
curl -X POST 'https://l4.fyi/api/svn/info' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3690,"repository":"myproject","timeout":5000}'
```

---

### Syslog

Requires a syslog receiver on port 514.

#### Send log message

```bash
curl -X POST 'https://l4.fyi/api/syslog/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":514,"message":"Application started successfully","facility":16,"severity":6,"timeout":5000}'
```

---

### TACACS

Requires a TACACS+ server on port 49.

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/tacacs/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":49,"timeout":5000}'
```

#### Authenticate

```bash
curl -X POST 'https://l4.fyi/api/tacacs/authenticate' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":49,"username":"admin","password":"secret","secret":"tacacskey","timeout":5000}'
```

---

### Tarantool

Requires a Tarantool server on port 3301.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/tarantool/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3301,"timeout":5000}'
```

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/tarantool/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3301,"timeout":5000}'
```

#### Eval

```bash
curl -X POST 'https://l4.fyi/api/tarantool/eval' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":3301,"username":"admin","password":"secret","expression":"return box.info.version","timeout":5000}'
```

---

### TDS (SQL Server)

Requires a Microsoft SQL Server on port 1433.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/tds/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1433,"timeout":5000}'
```

#### Login

```bash
curl -X POST 'https://l4.fyi/api/tds/login' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1433,"username":"sa","password":"YourStrong!Passw0rd","database":"master","timeout":5000}'
```

#### Query

```bash
curl -X POST 'https://l4.fyi/api/tds/query' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":1433,"username":"sa","password":"YourStrong!Passw0rd","database":"master","sql":"SELECT @@VERSION","timeout":5000}'
```

---

### TeamSpeak

Requires a TeamSpeak 3 server with ServerQuery on port 10011.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/teamspeak/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10011,"timeout":5000}'
```

#### Server info

```bash
curl -X POST 'https://l4.fyi/api/teamspeak/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10011,"username":"serveradmin","password":"tspass","command":"serverinfo","timeout":5000}'
```

---

### Telnet

Requires a server with Telnet enabled on port 23.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/telnet/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":23,"timeout":5000}'
```

#### Negotiate

```bash
curl -X POST 'https://l4.fyi/api/telnet/negotiate' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":23,"timeout":5000}'
```

---

### TFTP

Requires a TFTP server on port 69.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/tftp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":69,"timeout":5000}'
```

#### Read file

```bash
curl -X POST 'https://l4.fyi/api/tftp/get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":69,"filename":"config.txt","timeout":10000}'
```

#### Write file

```bash
curl -X POST 'https://l4.fyi/api/tftp/write' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":69,"filename":"upload.txt","data":"Hello from L4.FYI","timeout":10000}'
```

---

### Thrift

Requires an Apache Thrift server on port 9090.

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/thrift/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9090,"timeout":5000}'
```

#### Call method

```bash
curl -X POST 'https://l4.fyi/api/thrift/call' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":9090,"serviceName":"UserService","methodName":"getUser","args":{"userId":"42"},"timeout":5000}'
```

---

### Varnish

Requires Varnish Cache with CLI admin on port 6082.

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/varnish/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6082,"timeout":5000}'
```

#### Status command

```bash
curl -X POST 'https://l4.fyi/api/varnish/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6082,"secret":"varnishsecret","command":"status","timeout":5000}'
```

#### Ban pattern

```bash
curl -X POST 'https://l4.fyi/api/varnish/ban' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":6082,"secret":"varnishsecret","expression":"req.url ~ /api/","timeout":5000}'
```

---

### Vault

Requires HashiCorp Vault on port 8200.

#### Health check

```bash
curl -X POST 'https://l4.fyi/api/vault/health' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8200,"token":"hvs.YOUR_TOKEN","timeout":5000}'
```

#### Read secret

```bash
curl -X POST 'https://l4.fyi/api/vault/secret/read' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8200,"path":"my-app/config","token":"hvs.YOUR_TOKEN","kv_version":2,"mount":"secret","timeout":5000}'
```

#### Write secret

```bash
curl -X POST 'https://l4.fyi/api/vault/secret/write' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":8200,"path":"my-app/config","token":"hvs.YOUR_TOKEN","data":{"db_host":"10.0.1.50","db_pass":"supersecret"},"kv_version":2,"mount":"secret","timeout":5000}'
```

---

### VNC

Requires a VNC server on port 5900.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/vnc/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5900,"timeout":5000}'
```

#### Authenticate

```bash
curl -X POST 'https://l4.fyi/api/vnc/auth' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5900,"password":"vncpass","timeout":5000}'
```

---

### WebSocket

Works with any WebSocket server.

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/websocket/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":80,"path":"/ws","timeout":5000}'
```

---

### XMPP

Requires an XMPP server on port 5222 (client-to-server) or 5269 (server-to-server).

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/xmpp/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5222,"timeout":5000}'
```

#### Login

```bash
curl -X POST 'https://l4.fyi/api/xmpp/login' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5222,"username":"alice","password":"xmpppass","timeout":5000}'
```

#### Send message

```bash
curl -X POST 'https://l4.fyi/api/xmpp/message' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5222,"username":"alice","password":"xmpppass","to":"bob@example.com","body":"Hello Bob!","timeout":5000}'
```

#### Get roster

```bash
curl -X POST 'https://l4.fyi/api/xmpp/roster' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5222,"username":"alice","password":"xmpppass","timeout":5000}'
```

#### S2S connect

```bash
curl -X POST 'https://l4.fyi/api/xmpp-s2s/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5269,"timeout":5000}'
```

---

### Zabbix

Requires Zabbix server on port 10051 or agent on port 10050.

#### Connect (server)

```bash
curl -X POST 'https://l4.fyi/api/zabbix/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10051,"timeout":5000}'
```

#### Agent ping

```bash
curl -X POST 'https://l4.fyi/api/zabbix/agent' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10050,"key":"agent.ping","timeout":5000}'
```

#### Discovery

```bash
curl -X POST 'https://l4.fyi/api/zabbix/discovery' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":10050,"timeout":5000}'
```

---

### ZMTP (ZeroMQ)

Requires a ZeroMQ endpoint on port 5555.

#### Probe

```bash
curl -X POST 'https://l4.fyi/api/zmtp/probe' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5555,"timeout":5000}'
```

#### Handshake

```bash
curl -X POST 'https://l4.fyi/api/zmtp/handshake' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5555,"socketType":"DEALER","timeout":5000}'
```

#### Send message

```bash
curl -X POST 'https://l4.fyi/api/zmtp/send' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":5555,"socketType":"PUSH","message":"Hello ZeroMQ","timeout":5000}'
```

---

### ZooKeeper

Requires a ZooKeeper ensemble on port 2181.

#### Connect

```bash
curl -X POST 'https://l4.fyi/api/zookeeper/connect' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2181,"timeout":5000}'
```

#### ruok command

```bash
curl -X POST 'https://l4.fyi/api/zookeeper/command' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2181,"command":"ruok","timeout":5000}'
```

#### Get znode

```bash
curl -X POST 'https://l4.fyi/api/zookeeper/get' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2181,"path":"/","watch":false,"timeout":5000}'
```

#### Create znode

```bash
curl -X POST 'https://l4.fyi/api/zookeeper/create' \
  -H 'Content-Type: application/json' \
  -d '{"host":"your-server.example.com","port":2181,"path":"/test","data":"hello","flags":"ephemeral","timeout":5000}'
```

---

## Untestable Protocols

These protocols cannot be tested against public servers. They require specialized infrastructure, proprietary software, or hardware that is not publicly accessible.

| Protocol | Reason |
|----------|--------|
| 9P | Plan 9 filesystem protocol, no standard Docker image |
| ADB | Android Debug Bridge, requires Android device |
| Aerospike | NoSQL database, requires cluster setup |
| AFP | Apple Filing Protocol, requires macOS server |
| AJP | Apache JServ Protocol, requires Tomcat server |
| AMI | Asterisk Manager Interface, requires PBX |
| Battle.net | Proprietary gaming protocol, no standard Docker image |
| Beats | Elastic Beats protocol, requires Logstash |
| BGP | Border gateway routing protocol, requires router infrastructure |
| Bitcoin | Cryptocurrency protocol, requires full node |
| BitTorrent | P2P protocol, requires peer network |
| CDP | Chrome DevTools Protocol, requires Chrome debug instance |
| Ceph | Distributed storage, requires cluster infrastructure |
| Chargen | Character Generator protocol, rarely exposed publicly |
| ClamAV | Antivirus daemon, requires ClamAV installation |
| CoAP | Constrained Application Protocol, requires IoT device |
| Collectd | System statistics daemon, requires collectd setup |
| Couchbase | NoSQL database, requires cluster setup |
| CVS | Concurrent Versions System, legacy VCS |
| DAP | Debug Adapter Protocol, requires IDE debug server |
| Daytime | RFC 867, rarely exposed publicly |
| DCE/RPC | Windows DCE/RPC protocol, requires Windows infrastructure |
| Diameter | Telecom signaling protocol, requires specialized infrastructure |
| DICOM | Medical imaging protocol, requires specialized software |
| Discard | RFC 863, rarely exposed publicly |
| DNP3 | Industrial SCADA protocol, no standard Docker image |
| DRDA | IBM DB2 protocol, no free Docker image |
| EPMD | Erlang Port Mapper Daemon, requires Erlang runtime |
| EPP | Extensible Provisioning Protocol, requires registrar access |
| Ethereum | Blockchain protocol, requires full node |
| EtherNet/IP | Industrial protocol, requires PLC hardware |
| FINS | Industrial PLC protocol (Omron), no standard Docker image |
| FIX | Financial information exchange, requires FIX engine |
| Firebird | Database, requires server installation |
| FTPS | FTP over TLS, public FTPS servers are rare |
| Gadu-Gadu | Discontinued Polish IM protocol, no standard Docker image |
| Ganglia | Cluster monitoring, requires Ganglia setup |
| Gearman | Job queue protocol, limited Docker availability |
| GELF | Graylog logging format, requires Graylog server |
| GPSD | GPS daemon, requires GPS hardware |
| H.323 | Legacy VoIP signaling, requires specialized infrastructure |
| Hazelcast | In-memory data grid, requires cluster setup |
| HL7 | Healthcare messaging protocol, requires specialized software |
| HSRP | Hot Standby Router Protocol, requires router infrastructure |
| IEC 60870-5-104 | Industrial SCADA protocol, no standard Docker image |
| Ident | RFC 1413, rarely exposed publicly |
| Ignite | Apache Ignite, requires cluster setup |
| IKE | Internet Key Exchange (IPsec), requires VPN infrastructure |
| Informix | IBM Informix database, requires license |
| IPMI | Server management, requires BMC hardware |
| IPP | Internet Printing Protocol, requires print server setup |
| iSCSI | Storage protocol, requires storage target setup |
| Jabber Component | XMPP component protocol, requires XMPP server |
| JDWP | Java debug wire protocol, requires running JVM |
| JetDirect | HP printer protocol, requires HP printer hardware |
| Kerberos | Requires KDC infrastructure setup |
| LDP | MPLS label distribution protocol, requires network infrastructure |
| MaxDB | SAP database protocol, no free Docker image |
| Modbus | Industrial automation protocol, no standard Docker image |
| MSRP | SIP message session relay, requires SIP infrastructure |
| Napster | Defunct music service protocol, no standard Docker image |
| NBD | Network block device protocol, requires block device setup |
| NetBIOS | Windows networking, requires Windows network |
| Node Inspector | Requires Node.js debug session |
| OPC-UA | Industrial OPC-UA protocol, no standard Docker image |
| OpenFlow | SDN controller protocol, no standard Docker image |
| Oracle | Commercial database protocol, no free Docker image |
| Oracle TNS | Oracle TNS protocol, no free Docker image |
| PCEP | Path computation protocol, requires network infrastructure |
| PJLink | Projector control protocol, requires projector hardware |
| Portmapper | RPC portmapper, requires NFS/RPC infrastructure |
| PPTP | Legacy VPN protocol, no standard Docker image |
| QOTD | Quote of the Day, rarely exposed publicly |
| Radsec | RADIUS over TLS, requires RADIUS infrastructure |
| RCON (Source) | Game server protocol, requires game server |
| RDP | Windows Remote Desktop protocol, requires Windows |
| Rexec | Legacy remote execution protocol, no standard Docker image |
| RLogin | Legacy remote login protocol, no standard Docker image |
| RMI | Java RMI protocol, requires Java RMI registry |
| Rserve | R statistics server, requires R installation |
| RSH | Legacy remote shell protocol, no standard Docker image |
| S7comm | Industrial PLC protocol (Siemens), no standard Docker image |
| SANE | Scanner access protocol, requires scanner hardware |
| SLP | Service location protocol, no standard Docker image |
| SMPP | Short Message Peer-to-Peer, requires SMSC |
| SNPP | Legacy pager protocol, no standard Docker image |
| SPICE | VM display protocol, requires QEMU/KVM infrastructure |
| Ventrilo | Proprietary gaming voice protocol, no standard Docker image |
| X11 | X Window display protocol, requires X server |
