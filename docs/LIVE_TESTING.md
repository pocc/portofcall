# Live Integration Testing — DigitalOcean Droplet

## Overview

End-to-end integration testing of L4.FYI runs against real Docker services on a DigitalOcean droplet, with the production Cloudflare Worker at `l4.fyi` bridging TCP connections.

**Test path:** Local Vitest → `https://l4.fyi/api/*` → Cloudflare Worker → TCP socket → Docker service on VPS

## Droplet Details

- **IP:** 157.230.147.115
- **SSH:** `ssh root@157.230.147.115` (key: `~/.ssh/digital_ocean_157.230.147.115`)
- **OS:** Ubuntu 24.04, Docker 28.x
- **RAM:** 3.8 GB (resized from 458 MB after OOM)
- **Repo:** `/opt/portofcall`

## Running Services (13 containers)

| Service | Container | Port(s) | Credentials |
|---------|-----------|---------|-------------|
| Nginx | testserver-nginx | 80, 443 | — |
| Redis | testserver-redis | 6379 | none (no auth) |
| MySQL | testserver-mysql | 3306 | testuser/testpass123 |
| PostgreSQL | testserver-postgres | 5432 | testuser/testpass123 |
| MongoDB | testserver-mongodb | 27017 | testuser/testpass123 |
| Memcached | testserver-memcached | 11211 | — |
| SSH | testserver-ssh | 2222 | testuser/testpass123 |
| Telnet | testserver-telnet | 23 | testuser/testpass123 |
| FTP (vsftpd) | testserver-ftp | 21 | testuser/testpass123 |
| IRC (InspIRCd) | testserver-irc | 6667 | — |
| MQTT (Mosquitto) | testserver-mqtt | 1883 | anonymous |
| Simple Protocols | testserver-simple | 7,9,13,19,37,79 | — |

### Simple Protocols Detail

- **Port 7** — Echo
- **Port 9** — Discard
- **Port 13** — Daytime
- **Port 19** — Chargen
- **Port 37** — Time
- **Port 79** — Finger

## Test Results

**95/95 passing** (as of 2026-03-10)

```
API_BASE=https://l4.fyi/api DOCKER_HOST=157.230.147.115 npx vitest run tests/docker-integration.test.ts
```

### Test Breakdown

- **Core services (docker-compose.yml):** All 95 tests pass
- **Extended services (databases, queues, etc.):** Not running on this droplet — tests skip gracefully via `isServiceUp()` guard

## Setup Issues & Fixes

### OOM on 458 MB droplet
Starting all core Docker services exhausted memory. Resized to 3.8 GB.

### MQTT (Mosquitto)
- `docker/mosquitto/passwd` had comment lines that mosquitto 2.1.2 couldn't parse
- `socket_domain ipv4` in config caused duplicate port binding
- **Fix:** Minimal config — `listener 1883`, `allow_anonymous true`, `persistence true`

### IRC (InspIRCd)
- `inspircd.conf` on droplet had XML header corruption from git clone
- **Fix:** SCP'd correct config from local machine

### Memcached
- `memcached -t 4` on 1-core droplet caused file descriptor exhaustion
- **Fix:** `docker run ... memcached:alpine memcached -m 64 -t 1` with `--ulimit nofile=1024:1024`

### MongoDB
- Compose file had unsupported `socketCheckIntervalMS` parameter for mongo:7
- **Fix:** Started manually with `docker run ... mongo:7 mongod --auth --bind_ip_all`

### Telnet
- xinetd config pointed to `/usr/sbin/in.telnetd` but Alpine only had `/usr/sbin/telnetd`
- **Fix:** Recreated with Alpine + busybox-extras: `telnetd -F -l /bin/login -b 0.0.0.0:23`

## Code Changes

### `tests/docker-integration.test.ts`

Added `DOCKER_HOST` environment variable support:

```typescript
const DOCKER_HOST = process.env.DOCKER_HOST || 'localhost';
const hasRemoteDocker = DOCKER_HOST !== 'localhost' && DOCKER_HOST !== '127.0.0.1';
const suite = (isLocal || hasRemoteDocker) ? describe : describe.skip;
```

All `host: 'localhost'` references replaced with `host: DOCKER_HOST`.

## Running Tests

```bash
# Against live droplet via production Worker
API_BASE=https://l4.fyi/api DOCKER_HOST=157.230.147.115 npx vitest run tests/docker-integration.test.ts

# Against local Docker via local wrangler dev
npx vitest run tests/docker-integration.test.ts

# Single protocol
API_BASE=https://l4.fyi/api DOCKER_HOST=157.230.147.115 npx vitest run tests/docker-integration.test.ts -t "Redis"
```

## SSH Command Log

All commands executed on the droplet are logged in `dist/ssh_commands.txt`.
