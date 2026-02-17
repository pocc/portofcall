# Local Testing with Docker

Guide for running integration tests locally using Docker containers as protocol servers.

## Overview

Integration tests default to the production Worker at `https://portofcall.ross.gg`. For local development, you need:

1. **Local Worker** (wrangler dev) — so the Worker can reach `localhost`
2. **Docker containers** — real servers for protocols that require infrastructure

```
Tests → http://localhost:8787 → Local Worker → Docker containers (FTP, Redis, etc.)
```

## Quick Start

```bash
# 1. Start the local Worker (in a separate terminal)
npx wrangler dev --port 8787

# 2. Start all Docker test servers (see sections below)
# ... or use the start-all-servers one-liner

# 3. Run tests against local Worker
API_BASE=http://localhost:8787/api npx vitest run
```

## Running the Local Worker

```bash
# Start on default port 8787
npx wrangler dev --port 8787

# Verify it's running
curl http://localhost:8787/api/ping \
  -X POST -H "Content-Type: application/json" \
  -d '{"host":"google.com","port":443}'
# → {"success":true,"rtt":...}
```

> **Why is this needed?** The production Worker at `portofcall.ross.gg` runs on Cloudflare's edge network and cannot reach `localhost` on your machine. A local Worker runs on your machine and can connect to Docker containers via `localhost`.

## Docker Servers by Protocol

### Simple Protocol Services (Port 7, 9, 13, 19, 37, 79)

Tests: `tests/echo.test.ts`, `tests/real-world-usage.test.ts` (Echo section), `tests/chargen.test.ts`, `tests/daytime.test.ts`, `tests/time.test.ts`, `tests/qotd.test.ts`, `tests/finger.test.ts`

```bash
docker run -d --name testserver-simple \
  -p 7:7 -p 9:9 -p 13:13 -p 19:19 -p 37:37 -p 79:79 \
  busybox sh -c "
    # Echo (port 7)
    while true; do nc -l -p 7 -e cat; done &
    # Discard (port 9)
    while true; do nc -l -p 9 -e /dev/null; done &
    # Daytime (port 13)
    while true; do echo '\$(date)' | nc -l -p 13; done &
    # CHARGEN (port 19)
    while true; do nc -l -p 19 -e /dev/urandom; done &
    wait"
```

> **Note:** The `testserver-simple` container used in development uses a custom multi-service setup. The busybox command above is illustrative; check the actual running container for details.

### FTP (Ports 20-21, passive 21100-21110)

Tests: `tests/ftp.test.ts`

```bash
docker run -d --name testserver-ftp \
  -p 20:20 -p 21:21 -p 21100-21110:21100-21110 \
  -e FTP_USER=testuser \
  -e FTP_PASS=testpass123 \
  -e PASV_ADDRESS=127.0.0.1 \
  -e PASV_MIN_PORT=21100 \
  -e PASV_MAX_PORT=21110 \
  garethflowers/ftp-server
```

Credentials: `testuser` / `testpass123`

### SSH (Port 2222)

Tests: `tests/ssh.test.ts`

```bash
docker run -d --name testserver-ssh \
  -p 2222:22 \
  -e SSH_USERS="testuser:1000" \
  panubo/sshd
```

### Telnet (Port 23)

Tests: `tests/telnet.test.ts`

```bash
docker run -d --name testserver-telnet \
  -p 23:23 \
  sylvaindumont/telnetd
```

### SMTP/IMAP/POP3 (Ports 25, 143, 110, 587, 993, 995)

Tests: `tests/smtp.test.ts`, `tests/imap.test.ts`, `tests/pop3.test.ts`

```bash
docker run -d --name testserver-mail \
  -p 25:25 -p 110:110 -p 143:143 \
  -p 587:587 -p 993:993 -p 995:995 \
  mailhog/mailhog
```

### MySQL (Port 3306)

Tests: `tests/mysql.test.ts`

```bash
docker run -d --name testserver-mysql \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=testpass \
  -e MYSQL_DATABASE=testdb \
  mysql:8
```

Credentials: `root` / `testpass`

### PostgreSQL (Port 5432)

Tests: `tests/postgres.test.ts`

```bash
docker run -d --name testserver-postgres \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  postgres:16
```

Credentials: `postgres` / `testpass`

### Redis (Port 6379)

Tests: `tests/redis.test.ts`

```bash
docker run -d --name testserver-redis -p 6379:6379 redis:latest
```

No credentials by default.

### MongoDB (Port 27017)

Tests: `tests/mongodb.test.ts`

```bash
docker run -d --name testserver-mongodb -p 27017:27017 mongo:7 --bind_ip_all
```

### Memcached (Port 11211)

Tests: `tests/memcached.test.ts`

```bash
docker run -d --name testserver-memcached -p 11211:11211 memcached:latest
```

### MQTT (Port 1883)

Tests: `tests/mqtt.test.ts`

```bash
docker run -d --name testserver-mqtt \
  -p 1883:1883 \
  eclipse-mosquitto:2 mosquitto -c /mosquitto/config/mosquitto.conf
```

### IRC (Port 6667)

Tests: `tests/irc.test.ts`, `tests/real-world-usage.test.ts` (IRC section)

```bash
docker run -d --name testserver-irc \
  -p 6667:6667 \
  inspircd/inspircd-docker:latest
```

### HTTP/HTTPS (Ports 80, 443)

Tests: `tests/nginx.test.ts`, `tests/docker.test.ts`

```bash
docker run -d --name testserver-nginx \
  -p 80:80 -p 443:443 -p 8080:8080 \
  nginx:latest
```

### RabbitMQ AMQP + Management API (Ports 5671, 5672, 15672)

Tests: `tests/rabbitmq.test.ts`

For AMQP only (no TLS):
```bash
docker run -d --name testserver-rabbitmq \
  -p 5672:5672 -p 15672:15672 \
  rabbitmq:3-management
```

For AMQP + TLS (AMQPS on port 5671):
```bash
# Generate self-signed certs
mkdir -p /tmp/rabbitmq-certs
openssl genrsa -out /tmp/rabbitmq-certs/ca.key 4096
openssl req -new -x509 -days 365 -key /tmp/rabbitmq-certs/ca.key \
  -out /tmp/rabbitmq-certs/ca.crt -subj "/CN=TestCA"
openssl genrsa -out /tmp/rabbitmq-certs/server.key 2048
openssl req -new -key /tmp/rabbitmq-certs/server.key \
  -out /tmp/rabbitmq-certs/server.csr -subj "/CN=localhost"
openssl x509 -req -days 365 -in /tmp/rabbitmq-certs/server.csr \
  -CA /tmp/rabbitmq-certs/ca.crt -CAkey /tmp/rabbitmq-certs/ca.key \
  -CAcreateserial -out /tmp/rabbitmq-certs/server.crt

# Write config
cat > /tmp/rabbitmq-certs/rabbitmq.conf << 'EOF'
listeners.tcp.default = 5672
listeners.ssl.default = 5671
ssl_options.cacertfile = /certs/ca.crt
ssl_options.certfile   = /certs/server.crt
ssl_options.keyfile    = /certs/server.key
ssl_options.verify     = verify_none
ssl_options.fail_if_no_peer_cert = false
management.listener.port = 15672
management.listener.ssl  = false
EOF

# Start with TLS
docker run -d --name testserver-rabbitmq \
  -p 5671:5671 -p 5672:5672 -p 15672:15672 \
  -v /tmp/rabbitmq-certs:/certs:ro \
  -v /tmp/rabbitmq-certs/rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf:ro \
  rabbitmq:3-management
```

Default credentials: `guest` / `guest`

> **Note:** `tests/amqps.test.ts` "should connect to AMQPS broker over TLS" is skipped when running locally because `wrangler dev` does not support `secureTransport: 'on'` for `localhost` connections.

### CVS pserver (Port 2401)

Tests: `tests/cvs.test.ts`

```bash
docker run -d --name testserver-cvs \
  -p 2401:2401 \
  costamauricio/alpine-cvs
```

## Running Tests

```bash
# Run all tests against local Worker
API_BASE=http://localhost:8787/api npx vitest run

# Run a specific test file
API_BASE=http://localhost:8787/api npx vitest run tests/redis.test.ts

# Run with verbose output
API_BASE=http://localhost:8787/api npx vitest run --reporter=verbose

# Run and watch for changes
API_BASE=http://localhost:8787/api npx vitest
```

## Known Limitations When Running Locally

Some tests are automatically skipped (`it.skip`) when `API_BASE` contains `localhost`:

| Test | Reason |
|------|--------|
| AMQPS: "should connect to AMQPS broker over TLS" | `wrangler dev` blocks `secureTransport: 'on'` to `localhost` |
| Gadu-Gadu: "should handle invalid credentials with real GG server" | Real GG server at `91.214.237.10` silently filters TCP; hangs indefinitely |
| Gadu-Gadu: "should support GG32 hash algorithm" | Same reason |
| Gopher: "should fetch the root menu from Floodgap" | External server may cause wrangler dev restart |
| Gemini: "should handle connection to a Gemini server" | TLS to external server may cause wrangler dev restart |

These tests run normally against the production Worker (`https://portofcall.ross.gg`).

## Protocol Test Matrix

| Protocol | Docker Image | Port(s) | Test File |
|----------|-------------|---------|-----------|
| Echo/Discard/Daytime/etc | Custom busybox | 7,9,13,19,37,79 | `echo.test.ts`, `chargen.test.ts` |
| FTP | `garethflowers/ftp-server` | 20-21, 21100-21110 | `ftp.test.ts` |
| SSH | `panubo/sshd` | 2222→22 | `ssh.test.ts` |
| Telnet | `sylvaindumont/telnetd` | 23 | `telnet.test.ts` |
| SMTP/IMAP/POP3 | `mailhog/mailhog` | 25,110,143,587,993,995 | `smtp.test.ts`, `imap.test.ts`, `pop3.test.ts` |
| MySQL | `mysql:8` | 3306 | `mysql.test.ts` |
| PostgreSQL | `postgres:16` | 5432 | `postgres.test.ts` |
| Redis | `redis:latest` | 6379 | `redis.test.ts` |
| MongoDB | `mongo:7` | 27017 | `mongodb.test.ts` |
| Memcached | `memcached:latest` | 11211 | `memcached.test.ts` |
| MQTT | `eclipse-mosquitto:2` | 1883 | `mqtt.test.ts` |
| IRC | `inspircd/inspircd-docker` | 6667 | `irc.test.ts` |
| HTTP/HTTPS | `nginx:latest` | 80,443,8080 | `nginx.test.ts` |
| RabbitMQ | `rabbitmq:3-management` | 5671,5672,15672 | `rabbitmq.test.ts` |
| CVS | `costamauricio/alpine-cvs` | 2401 | `cvs.test.ts` |

## Managing Docker Containers

```bash
# List running test containers
docker ps --filter name=testserver

# Stop all test containers
docker stop $(docker ps -q --filter name=testserver)

# Remove all test containers
docker rm -f $(docker ps -aq --filter name=testserver)

# View logs for a container
docker logs testserver-rabbitmq

# Restart a container
docker restart testserver-redis
```

## Test Architecture

### Production Tests (default)
```
tests/ → https://portofcall.ross.gg/api → Cloudflare Worker → Internet hosts
```
- No setup required
- All tests run; tests requiring local infrastructure connect to real public servers

### Local Tests (with wrangler dev + Docker)
```
tests/ → http://localhost:8787/api → Local Worker → Docker containers
```
- Requires: `npx wrangler dev` + Docker containers running
- 165 test files, 1925+ tests pass (5 skipped due to wrangler dev limitations)
- Faster feedback loop; no dependency on external public services

## CI/CD Considerations

For GitHub Actions, add services to your workflow:

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:latest
        ports: ["6379:6379"]
      postgres:
        image: postgres:16
        ports: ["5432:5432"]
        env:
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: testdb
      mysql:
        image: mysql:8
        ports: ["3306:3306"]
        env:
          MYSQL_ROOT_PASSWORD: testpass
          MYSQL_DATABASE: testdb
      rabbitmq:
        image: rabbitmq:3-management
        ports: ["5672:5672", "15672:15672"]
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx wrangler dev --port 8787 &
      - run: sleep 5  # Wait for Worker to start
      - run: API_BASE=http://localhost:8787/api npm test
```
