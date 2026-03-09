# Docker Testing Prompt — Port of Call

## Context
Port of Call has 17 docker-compose files covering 60+ services for protocol testing. The host machine has **36GB RAM** and Docker Desktop is allocated **~7.6GB**. Without memory limits, services like MongoDB, Elasticsearch, and Kafka will consume all available memory, causing swap thrashing and system instability (~64GB observed).

## Memory Limits
All compose files now include `mem_limit` per service. These are the budgets:

| Tier | Limit | Services |
|------|-------|----------|
| Heavy | 1g | mongodb, mysql, postgres, kafka, mailserver, minecraft |
| Medium | 512m | elasticsearch, kibana, prometheus, influxdb, redis, rabbitmq, activemq, cassandra, clickhouse, neo4j, rethinkdb, gitea, synapse, solr |
| Light | 256m | nginx, vsftpd, openssh, telnet, ircd, mosquitto, grafana, loki, graphite, zookeeper, nsqd, couchdb, etcd, tarantool, consul, vault, openldap, varnish, meilisearch, prosody, tor, samba, nfs, bind9 |
| Minimal | 128m | simple-protocols, memcached, modbus-sim, opcua-sim, svn, freeradius, kerberos, haproxy, misc-protocols, zabbix-agent, gearman, mpd, dante, rsync, mumble, bird, snmpd, syslog, coturn, nats, nsqlookupd, beanstalkd |

## Rules

1. **Never start all compose files at once.** The combined memory of all services exceeds 20GB.
2. **Start only what you need.** Run individual stacks by protocol category:
   ```bash
   docker compose -f docker-compose.yml up -d nginx redis    # just 2 services
   docker compose -f docker-compose.databases.yml up -d neo4j # just neo4j
   ```
3. **Stop when done.** Always tear down after testing:
   ```bash
   docker compose -f docker-compose.yml down
   docker compose -f docker-compose.databases.yml down
   ```
4. **Monitor memory** during test runs:
   ```bash
   docker stats --no-stream
   ```
5. **Budget: ~8GB total.** Don't run more than 2–3 heavy services simultaneously. A safe combination is 2 heavy + 3 medium + several light services.
6. **Clean up regularly:**
   ```bash
   docker system prune          # remove stopped containers, dangling images
   docker volume prune          # remove unused volumes (WARNING: deletes data)
   ```

## Compose File Reference

| File | Category | Services | Max Memory |
|------|----------|----------|------------|
| `docker-compose.yml` | Core | nginx, ftp, ssh, mail, redis, mysql, postgres, simple-protocols, telnet, irc, mqtt, mongodb, memcached | ~6.5g |
| `docker-compose.monitoring.yml` | Monitoring | elasticsearch, kibana, prometheus, grafana, influxdb, loki, graphite | ~2.8g |
| `docker-compose.queues.yml` | Queues | rabbitmq, kafka, zookeeper, nats, nsq (2), beanstalkd, activemq | ~2.9g |
| `docker-compose.databases.yml` | Databases | cassandra, clickhouse, couchdb, neo4j, rethinkdb, etcd, tarantool | ~2.8g |
| `docker-compose.chat.yml` | Chat | prosody, synapse | ~768m |
| `docker-compose.games.yml` | Games | minecraft, mumble | ~1.1g |
| `docker-compose.web.yml` | Web/Proxy | haproxy, varnish, solr, meilisearch | ~1.1g |
| `docker-compose.directory.yml` | Auth/LDAP | openldap, freeradius, kerberos | ~512m |
| `docker-compose.hashicorp.yml` | HashiCorp | consul, vault | ~512m |
| `docker-compose.vcs.yml` | VCS | gitea, svn | ~640m |
| `docker-compose.files.yml` | File sharing | samba, nfs, rsync | ~640m |
| `docker-compose.dns-network.yml` | DNS/Net | bind9, bird, snmpd, syslog | ~640m |
| `docker-compose.security.yml` | Security | dante (socks5), tor | ~384m |
| `docker-compose.industrial.yml` | Industrial | modbus, opcua | ~256m |
| `docker-compose.misc.yml` | Misc | qotd, whois, gopher, ident, nntp, dict, zabbix, gearman, mpd | ~512m |
| `docker-compose.voip.yml` | VoIP | coturn | ~128m |
| `docker-compose.hardened.yml` | Hardened | Same as core, with security hardening + deploy limits | ~12g |

## Testing Workflow

```bash
# 1. Start only the stack(s) you need
docker compose -f docker-compose.yml up -d redis postgres

# 2. Run your tests
npm run test

# 3. Check memory isn't spiraling
docker stats --no-stream

# 4. Tear down when done
docker compose -f docker-compose.yml down

# 5. If testing across multiple stacks, bring them up/down sequentially
docker compose -f docker-compose.databases.yml up -d cassandra
npm run test -- --grep "cassandra"
docker compose -f docker-compose.databases.yml down
```

## Troubleshooting

**System becomes unresponsive during Docker tests:**
```bash
docker kill $(docker ps -q)    # kill all running containers
docker system prune -f         # clean up
```

**A service is OOM-killed (exit code 137):**
The `mem_limit` is too low for that service's workload. Increase it in the compose file, but keep it under 2g for any single test service.

**Swap usage is high after Docker tests:**
Stop all containers and wait for the OS to reclaim swap, or restart Docker Desktop.
