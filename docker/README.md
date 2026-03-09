# Docker Test Server Configuration

This directory contains all Docker service configurations for the multi-protocol test server.

## Compose Files

Each compose file is self-contained and can be started independently:

```bash
# Core services (original)
docker compose up -d

# Additional stacks (start any combination)
docker compose -f docker-compose.queues.yml up -d
docker compose -f docker-compose.databases.yml up -d
docker compose -f docker-compose.monitoring.yml up -d
docker compose -f docker-compose.dns-network.yml up -d
docker compose -f docker-compose.directory.yml up -d
docker compose -f docker-compose.misc.yml up -d
docker compose -f docker-compose.hashicorp.yml up -d
docker compose -f docker-compose.chat.yml up -d
docker compose -f docker-compose.files.yml up -d
docker compose -f docker-compose.voip.yml up -d
docker compose -f docker-compose.industrial.yml up -d
docker compose -f docker-compose.web.yml up -d
docker compose -f docker-compose.vcs.yml up -d
docker compose -f docker-compose.games.yml up -d
docker compose -f docker-compose.security.yml up -d

# Start everything at once
for f in docker-compose*.yml; do docker compose -f "$f" up -d; done
```

## Service Map

### Core (`docker-compose.yml`) — 14 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| nginx | 80, 443 | HTTP, HTTPS |
| vsftpd | 21, 21100-21110 | FTP |
| openssh | 2222 | SSH, SFTP, SCP |
| mailserver | 25, 110, 143, 587, 993, 995 | SMTP, IMAP, POP3 (+TLS) |
| mysql | 3306 | MySQL |
| postgres | 5432 | PostgreSQL |
| redis | 6379 | Redis |
| mongodb | 27017 | MongoDB |
| memcached | 11211 | Memcached |
| mosquitto | 1883 | MQTT |
| ircd | 6667 | IRC |
| telnet | 23 | Telnet |
| simple-protocols | 7, 9, 13, 19, 37, 79 | Echo, Discard, Daytime, Chargen, Time, Finger |

### Message Queues (`docker-compose.queues.yml`) — 8 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| rabbitmq | 5672, 15672, 61613 | AMQP, STOMP |
| kafka | 9092 | Kafka |
| zookeeper | 2181 | ZooKeeper |
| nats | 4222, 8222 | NATS |
| nsqlookupd | 4160, 4161 | NSQ |
| nsqd | 4150, 4151 | NSQ |
| beanstalkd | 11300 | Beanstalkd |
| activemq | 61616, 8161, 61614 | ActiveMQ, OpenWire, STOMP |

### Databases (`docker-compose.databases.yml`) — 7 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| cassandra | 9042 | Cassandra CQL |
| clickhouse | 9000, 8123 | ClickHouse |
| couchdb | 5984 | CouchDB |
| neo4j | 7687, 7474 | Neo4j Bolt |
| rethinkdb | 28015, 8090 | RethinkDB |
| etcd | 2379 | etcd |
| tarantool | 3301 | Tarantool |

### Monitoring (`docker-compose.monitoring.yml`) — 7 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| elasticsearch | 9200, 9300 | Elasticsearch |
| kibana | 5601 | Kibana |
| prometheus | 9090 | Prometheus |
| grafana | 3000 | Grafana |
| influxdb | 8086 | InfluxDB |
| loki | 3100 | Loki |
| graphite | 2003, 2004, 8081 | Graphite/Carbon |

### DNS & Network (`docker-compose.dns-network.yml`) — 4 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| bind9 | 5353 | DNS |
| bird | 1179 | BGP |
| snmpd | 1161 | SNMP (TCP, RFC 3430) |
| syslog | 1514 | Syslog |

### Directory & Auth (`docker-compose.directory.yml`) — 3 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| openldap | 389, 636 | LDAP, LDAPS |
| freeradius | 1812, 1813 | RADIUS |
| kerberos | 88 | Kerberos |

### Misc Protocols (`docker-compose.misc.yml`) — 6 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| misc-protocols | 17, 43, 70, 113, 119, 2628 | QOTD, WHOIS, Gopher, Ident, NNTP, DICT |
| zabbix-server | 10051 | Zabbix |
| zabbix-agent | 10050 | Zabbix Agent |
| gearman | 4730 | Gearman |
| clamav | 3310 | ClamAV |
| mpd | 6600 | MPD |

### HashiCorp (`docker-compose.hashicorp.yml`) — 2 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| consul | 8500, 8600 | Consul |
| vault | 8200 | Vault |

### Chat (`docker-compose.chat.yml`) — 2 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| prosody | 5222, 5269, 5347 | XMPP (c2s, s2s, component) |
| synapse | 8008, 8448 | Matrix |

### Files (`docker-compose.files.yml`) — 3 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| samba | 139, 445 | SMB/CIFS |
| nfs | 2049 | NFS |
| rsync | 873 | Rsync |

### VoIP (`docker-compose.voip.yml`) — 2 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| asterisk | 5060, 5061, 5038 | SIP, SIPS, AMI |
| coturn | 3478 | STUN, TURN |

### Industrial (`docker-compose.industrial.yml`) — 2 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| modbus-sim | 502 | Modbus TCP |
| opcua-sim | 4840 | OPC UA |

### Web (`docker-compose.web.yml`) — 4 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| haproxy | 8404 | HAProxy |
| varnish | 6081 | Varnish |
| solr | 8983 | Solr |
| meilisearch | 7700 | Meilisearch |

### VCS (`docker-compose.vcs.yml`) — 2 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| gitea | 3022, 3080 | Git (SSH + HTTP) |
| svn | 3690 | Subversion |

### Games (`docker-compose.games.yml`) — 2 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| minecraft | 25565 | Minecraft |
| mumble | 64738 | Mumble |

### Security (`docker-compose.security.yml`) — 2 containers
| Service | Ports | Protocols |
|---------|-------|-----------|
| dante | 1080 | SOCKS5 |
| tor | 9050, 9051 | Tor (SOCKS + Control) |

## Directory Structure

```
docker/
├── nginx/              # HTTP/HTTPS web server
├── vsftpd/             # FTP server
├── openssh/            # SSH server
├── mailserver/         # Email (SMTP/IMAP/POP3)
├── mysql/              # MySQL database
├── postgres/           # PostgreSQL database
├── redis/              # Redis cache
├── mongodb/            # MongoDB database
├── mosquitto/          # MQTT broker
├── ircd/               # IRC server
├── simple-protocols/   # Echo, Discard, Daytime, Chargen, Time, Finger
├── misc-protocols/     # QOTD, WHOIS, Gopher, Ident, NNTP, DICT
├── bind9/              # DNS server (BIND9)
├── bird/               # BGP routing daemon
├── snmpd/              # SNMP agent
├── syslog-server/      # Syslog receiver (rsyslog)
├── prometheus/         # Prometheus config
├── openldap/           # LDAP directory
├── freeradius/         # RADIUS auth
├── kerberos/           # Kerberos KDC
├── prosody/            # XMPP server
├── asterisk/           # Asterisk PBX (SIP/AMI)
├── rsync-server/       # Rsync daemon
├── modbus-sim/         # Modbus TCP simulator
├── opcua-sim/          # OPC UA server
├── haproxy/            # HAProxy config
├── varnish/            # Varnish config
├── svn/                # Subversion server
└── dante/              # SOCKS5 proxy
```

## Default Credentials

All test services use consistent credentials:
- **Username**: `testuser`
- **Password**: `testpass123`
- **Root/Admin password**: `rootpass123` or `testpass123`

## UDP Limitations

Cloudflare Workers' `connect()` API only supports **TCP** sockets. Protocols that are
UDP-only cannot be tested through the worker and have no Docker test servers here.

**Removed protocols (UDP-only, no TCP fallback):**
- **TFTP** (port 69) — RFC 1350 mandates UDP; worker handler removed
- **SSDP** (port 1900) — UDP multicast only; worker handler removed

**Worker handlers kept but no Docker test server (UDP primary, TCP possible via RFC):**
- **NTP** (port 123) — Worker uses TCP; standard NTP servers (chrony, ntpd) are UDP-only
- **CoAP** (port 5683) — Worker uses RFC 8323 CoAP-over-TCP; common libraries are UDP-only
- **RIP** (port 520) — Worker uses TCP probe; BIRD/quagga RIP listeners are UDP-only

**Worker handlers using TCP with RFC-documented fallback (Docker servers configured for TCP):**
- **SNMP** (port 161) — RFC 3430 defines SNMP-over-TCP; snmpd configured with `tcp:161`
- **DNS** (port 53) — RFC 1035 supports TCP; BIND9 listens on both
- **RADIUS** (port 1812) — RFC 6613 defines RADIUS-over-TCP
- **Syslog** (port 514) — RFC 6587 defines syslog-over-TCP; rsyslog listens on both
- **SIP** (port 5060) — RFC 3261 supports TCP; Asterisk listens on both
- **STUN/TURN** (port 3478) — RFC 5389/8656 support TCP; coturn listens on both

## Troubleshooting

```bash
# View logs for a specific compose file
docker compose -f docker-compose.queues.yml logs -f

# Check service status
docker compose -f docker-compose.databases.yml ps

# Restart a service
docker compose -f docker-compose.monitoring.yml restart prometheus

# Rebuild custom images
docker compose -f docker-compose.dns-network.yml build --no-cache

# Stop a specific stack
docker compose -f docker-compose.games.yml down
```
