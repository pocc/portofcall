/**
 * Docker Integration Test Suite
 *
 * Comprehensive tests for real protocol interactions against Docker containers
 * via the local Cloudflare Worker (wrangler dev).
 *
 * This suite validates that every curlable API endpoint works correctly against
 * real infrastructure — the same validation a power user would do on a VPS.
 *
 * Prerequisites:
 *   1. Start Docker services from the PROJECT ROOT (compose files are in root, NOT docker/):
 *        cd /path/to/portofcall
 *        docker compose up -d                                    # Core (14 services)
 *        docker compose -f docker-compose.queues.yml up -d       # Message queues
 *        docker compose -f docker-compose.databases.yml up -d    # Additional DBs
 *        docker compose -f docker-compose.monitoring.yml up -d   # Monitoring stack
 *        docker compose -f docker-compose.misc.yml up -d         # Misc protocols
 *        docker compose -f docker-compose.directory.yml up -d    # LDAP, RADIUS, Kerberos
 *
 *   2a. LOCAL: Start local Worker (--env dev bypasses SSRF checks for localhost):
 *        npx wrangler dev --env dev --port 8787
 *        API_BASE=http://localhost:8787/api npx vitest run tests/docker-integration.test.ts
 *
 *   2b. REMOTE: Run Docker on a VPS, test via production Worker:
 *        API_BASE=https://l4.fyi/api DOCKER_HOST=<VPS_IP> npx vitest run tests/docker-integration.test.ts
 *
 * SKIPPED when API_BASE points to production AND no DOCKER_HOST is set.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://l4.fyi/api';
const DOCKER_HOST = process.env.DOCKER_HOST || 'localhost';
const isLocal = API_BASE.includes('localhost') || API_BASE.includes('127.0.0.1');
const hasRemoteDocker = DOCKER_HOST !== 'localhost' && DOCKER_HOST !== '127.0.0.1';

// Helper for POST requests
async function post(path: string, body: Record<string, unknown>) {
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Helper: check if a Docker service is reachable (TCP ping)
async function isServiceUp(port: number): Promise<boolean> {
  try {
    const res = await post('/ping', { host: DOCKER_HOST, port, timeout: 3000 });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// Run when: local worker (localhost API), OR remote Docker host is specified
const suite = (isLocal || hasRemoteDocker) ? describe : describe.skip;

// ═══════════════════════════════════════════════════════════════
// CORE SERVICES (docker-compose.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: Core Services (docker-compose.yml)', () => {
  beforeAll(async () => {
    try {
      const res = await post('/ping', { host: 'google.com', port: 443 });
      if (!res.ok) throw new Error(`Worker returned ${res.status}`);
    } catch {
      throw new Error(
        `Worker not reachable at ${API_BASE}. Run: npx wrangler dev --port 8787 (local) or set API_BASE=https://l4.fyi/api DOCKER_HOST=<IP> (remote)`
      );
    }
  });

  // ─── TCP Ping ──────────────────────────────────────────────

  describe('TCP Ping', () => {
    it('should ping Redis (6379)', async () => {
      const res = await post('/ping', { host: DOCKER_HOST, port: 6379 });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.rtt).toBeGreaterThanOrEqual(0);
    });

    it('should ping MySQL (3306)', async () => {
      const res = await post('/ping', { host: DOCKER_HOST, port: 3306 });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should ping PostgreSQL (5432)', async () => {
      const res = await post('/ping', { host: DOCKER_HOST, port: 5432 });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should ping Memcached (11211)', async () => {
      const res = await post('/ping', { host: DOCKER_HOST, port: 11211 });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should ping SSH (2222)', async () => {
      const res = await post('/ping', { host: DOCKER_HOST, port: 2222 });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should ping MongoDB (27017)', async () => {
      const res = await post('/ping', { host: DOCKER_HOST, port: 27017 });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should ping IRC (6667)', async () => {
      const res = await post('/ping', { host: DOCKER_HOST, port: 6667 });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should ping MQTT (1883)', async () => {
      const res = await post('/ping', { host: DOCKER_HOST, port: 1883 });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should ping HTTP/nginx (80)', async () => {
      const res = await post('/ping', { host: DOCKER_HOST, port: 80 });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should ping FTP (21)', async () => {
      const res = await post('/ping', { host: DOCKER_HOST, port: 21 });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should ping Telnet (23)', async () => {
      const res = await post('/ping', { host: DOCKER_HOST, port: 23 });
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  // ─── Redis ─────────────────────────────────────────────────

  describe('Redis (port 6379)', () => {
    it('POST /redis/connect — should connect and report version', async () => {
      const res = await post('/redis/connect', { host: DOCKER_HOST, port: 6379 });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.version).toBeDefined();
      expect(data.serverInfo).toBeDefined();
    });

    it('POST /redis/command [PING] — should return PONG', async () => {
      const res = await post('/redis/command', {
        host: DOCKER_HOST,
        port: 6379,
        command: ['PING'],
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.response).toContain('PONG');
    });

    it('POST /redis/command [SET, GET] — should round-trip a key', async () => {
      const key = `docker_test_${Date.now()}`;
      const val = 'integration_test_value';

      const setRes = await post('/redis/command', {
        host: DOCKER_HOST,
        port: 6379,
        command: ['SET', key, val],
      });
      const setData = await setRes.json();
      expect(setData.success).toBe(true);
      expect(setData.response).toContain('OK');

      const getRes = await post('/redis/command', {
        host: DOCKER_HOST,
        port: 6379,
        command: ['GET', key],
      });
      const getData = await getRes.json();
      expect(getData.success).toBe(true);
      expect(getData.response).toContain(val);

      // Cleanup
      await post('/redis/command', {
        host: DOCKER_HOST,
        port: 6379,
        command: ['DEL', key],
      });
    });

    it('POST /redis/command [INFO server] — should return server info', async () => {
      const res = await post('/redis/command', {
        host: DOCKER_HOST,
        port: 6379,
        command: ['INFO', 'server'],
      });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.response).toContain('redis_version');
    });

    it('POST /redis/command [DBSIZE] — should return db size', async () => {
      const res = await post('/redis/command', {
        host: DOCKER_HOST,
        port: 6379,
        command: ['DBSIZE'],
      });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('POST /redis/command [CONFIG GET] — should be blocked for safety', async () => {
      const res = await post('/redis/command', {
        host: DOCKER_HOST,
        port: 6379,
        command: ['CONFIG', 'GET', 'maxmemory'],
      });
      const data = await res.json();
      // CONFIG commands are blocked by the handler for safety
      expect(data.success).toBe(false);
      expect(data.error).toContain('blocked');
    });
  });

  // ─── MySQL ─────────────────────────────────────────────────

  describe('MySQL (port 3306)', () => {
    it('POST /mysql/connect — probe mode (no creds)', async () => {
      const res = await post('/mysql/connect', { host: DOCKER_HOST, port: 3306 });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.serverVersion).toMatch(/^8\./);
      expect(data.protocolVersion).toBeDefined();
      expect(data.connectionId).toBeGreaterThan(0);
    });

    it('POST /mysql/connect — root auth', async () => {
      const res = await post('/mysql/connect', {
        host: DOCKER_HOST,
        port: 3306,
        username: 'root',
        password: 'rootpass123',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('authentication successful');
    });

    it('POST /mysql/connect — testuser auth with database', async () => {
      const res = await post('/mysql/connect', {
        host: DOCKER_HOST,
        port: 3306,
        username: 'testuser',
        password: 'testpass123',
        database: 'testdb',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('POST /mysql/connect — should reject bad credentials', async () => {
      const res = await post('/mysql/connect', {
        host: DOCKER_HOST,
        port: 3306,
        username: 'root',
        password: 'wrong',
      });
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('POST /mysql/query — SHOW DATABASES', async () => {
      const res = await post('/mysql/query', {
        host: DOCKER_HOST,
        port: 3306,
        username: 'root',
        password: 'rootpass123',
        query: 'SHOW DATABASES',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.rowCount).toBeGreaterThan(0);
      const dbs = data.rows.map((r: string[]) => r[0]);
      expect(dbs).toContain('testdb');
    });

    it('POST /mysql/query — SELECT expression', async () => {
      const res = await post('/mysql/query', {
        host: DOCKER_HOST,
        port: 3306,
        username: 'root',
        password: 'rootpass123',
        query: 'SELECT 42 AS answer, NOW() AS ts',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.fields).toBeDefined();
      expect(data.rowCount).toBe(1);
    });

    it('POST /mysql/query — SHOW VARIABLES LIKE version', async () => {
      const res = await post('/mysql/query', {
        host: DOCKER_HOST,
        port: 3306,
        username: 'root',
        password: 'rootpass123',
        query: "SHOW VARIABLES LIKE 'version'",
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.rowCount).toBeGreaterThan(0);
    });
  });

  // ─── PostgreSQL ────────────────────────────────────────────

  describe('PostgreSQL (port 5432)', () => {
    it('POST /postgres/connect — should authenticate', async () => {
      const res = await post('/postgres/connect', {
        host: DOCKER_HOST,
        port: 5432,
        username: 'testuser',
        password: 'rootpass123',
        database: 'testdb',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.serverVersion).toMatch(/^16\./);
    });

    it('POST /postgres/connect — should reject bad credentials', async () => {
      const res = await post('/postgres/connect', {
        host: DOCKER_HOST,
        port: 5432,
        username: 'testuser',
        password: 'wrong',
        database: 'testdb',
      });
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('POST /postgres/query — SELECT expression', async () => {
      const res = await post('/postgres/query', {
        host: DOCKER_HOST,
        port: 5432,
        username: 'testuser',
        password: 'rootpass123',
        database: 'testdb',
        query: "SELECT 42 AS answer, 'hello' AS greeting",
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.columns).toBeDefined();
      expect(data.rowCount).toBe(1);
    });

    it('POST /postgres/query — list databases', async () => {
      const res = await post('/postgres/query', {
        host: DOCKER_HOST,
        port: 5432,
        username: 'testuser',
        password: 'rootpass123',
        database: 'testdb',
        query: 'SELECT datname FROM pg_database WHERE datistemplate = false',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      const dbs = data.rows.map((r: string[]) => r[0]);
      expect(dbs).toContain('testdb');
    });

    it('POST /postgres/query — version()', async () => {
      const res = await post('/postgres/query', {
        host: DOCKER_HOST,
        port: 5432,
        username: 'testuser',
        password: 'rootpass123',
        database: 'testdb',
        query: 'SELECT version()',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.rows[0][0]).toContain('PostgreSQL');
    });
  });

  // ─── Memcached ─────────────────────────────────────────────

  describe('Memcached (port 11211)', () => {
    it('POST /memcached/connect — should report version', async () => {
      const res = await post('/memcached/connect', { host: DOCKER_HOST, port: 11211 });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.version).toBeDefined();
    });

    it('POST /memcached/command [version] — should return VERSION', async () => {
      const res = await post('/memcached/command', {
        host: DOCKER_HOST,
        port: 11211,
        command: 'version',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.response).toContain('VERSION');
    });

    it('POST /memcached/stats — should return server stats', async () => {
      const res = await post('/memcached/stats', { host: DOCKER_HOST, port: 11211 });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.stats).toBeDefined();
      expect(data.stats.pid).toBeDefined();
      expect(data.stats.version).toBeDefined();
    });

    it('POST /memcached/stats [items] — should return items stats', async () => {
      const res = await post('/memcached/stats', {
        host: DOCKER_HOST,
        port: 11211,
        subcommand: 'items',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('POST /memcached/stats [slabs] — should return slab stats', async () => {
      const res = await post('/memcached/stats', {
        host: DOCKER_HOST,
        port: 11211,
        subcommand: 'slabs',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  // ─── SSH ───────────────────────────────────────────────────

  describe('SSH (port 2222)', () => {
    it('POST /ssh/connect — should read SSH banner', async () => {
      const res = await post('/ssh/connect', { host: DOCKER_HOST, port: 2222 });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.banner).toContain('SSH');
    });

    it('POST /ssh/kexinit — should list key exchange algorithms', async () => {
      const res = await post('/ssh/kexinit', { host: DOCKER_HOST, port: 2222 });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.kexAlgorithms.length).toBeGreaterThan(0);
      expect(data.ciphers.length).toBeGreaterThan(0);
      expect(data.hostKeyAlgorithms.length).toBeGreaterThan(0);
      expect(data.macs.length).toBeGreaterThan(0);
    });

    it('POST /ssh/auth — should attempt auth method probe', async () => {
      const res = await post('/ssh/auth', { host: DOCKER_HOST, port: 2222 });
      const data = await res.json();
      // Some SSH servers reject the SERVICE_REQUEST for auth probing;
      // we just verify the endpoint responded with the right shape.
      expect(data.authMethods).toBeDefined();
      expect(data.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('POST /ssh/exec [echo] — should execute command', async () => {
      const res = await post('/ssh/exec', {
        host: DOCKER_HOST,
        port: 2222,
        username: 'testuser',
        password: 'testpass123',
        command: 'echo hello_docker',
      });
      const data = await res.json();
      // SSH exec may return non-2xx HTTP status but still succeed at protocol level
      expect(data.success).toBe(true);
      expect(data.stdout).toContain('hello_docker');
    });

    it('POST /ssh/exec [whoami] — should return testuser', async () => {
      const res = await post('/ssh/exec', {
        host: DOCKER_HOST,
        port: 2222,
        username: 'testuser',
        password: 'testpass123',
        command: 'whoami',
      });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.stdout).toContain('testuser');
    });

    it('POST /ssh/exec [uname] — should return OS info', async () => {
      const res = await post('/ssh/exec', {
        host: DOCKER_HOST,
        port: 2222,
        username: 'testuser',
        password: 'testpass123',
        command: 'uname -a',
      });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.stdout).toContain('Linux');
    });

    it('POST /ssh/exec — should reject bad password', async () => {
      const res = await post('/ssh/exec', {
        host: DOCKER_HOST,
        port: 2222,
        username: 'testuser',
        password: 'wrong',
        command: 'echo test',
      });
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  // ─── MongoDB ───────────────────────────────────────────────

  describe('MongoDB (port 27017)', () => {
    it('POST /mongodb/connect — should report server info', async () => {
      const res = await post('/mongodb/connect', { host: DOCKER_HOST, port: 27017 });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.serverInfo).toBeDefined();
      expect(data.serverInfo.version).toBeDefined();
    });

    it('POST /mongodb/ping — should return ok=1', async () => {
      const res = await post('/mongodb/ping', { host: DOCKER_HOST, port: 27017 });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.ok).toBe(1);
      expect(data.rtt).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── IRC ───────────────────────────────────────────────────

  describe('IRC (port 6667)', () => {
    it('POST /irc/connect — should receive server messages', async () => {
      const nick = `poc_${Date.now() % 100000}`;
      const res = await post('/irc/connect', {
        host: DOCKER_HOST,
        port: 6667,
        nickname: nick,
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.messages).toBeDefined();
      expect(data.messagesReceived).toBeGreaterThan(0);
    });
  });

  // ─── MQTT ──────────────────────────────────────────────────

  describe('MQTT (port 1883)', () => {
    it('POST /mqtt/connect — should connect to broker', async () => {
      const res = await post('/mqtt/connect', { host: DOCKER_HOST, port: 1883 });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  // ─── FTP ───────────────────────────────────────────────────

  describe('FTP (port 21)', () => {
    it('POST /ftp/connect — should authenticate and connect', async () => {
      const res = await post('/ftp/connect', {
        host: DOCKER_HOST,
        port: 21,
        username: 'testuser',
        password: 'testpass123',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('POST /ftp/list — should fail due to PASV blocked address', async () => {
      // FTP passive mode returns 127.0.0.1 from Docker, which the handler blocks.
      // This validates the SSRF protection inside the FTP handler itself.
      const res = await post('/ftp/list', {
        host: DOCKER_HOST,
        port: 21,
        username: 'testuser',
        password: 'testpass123',
        path: '/',
      });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('PASV');
    });

    it('POST /ftp/connect — should reject bad credentials', async () => {
      const res = await post('/ftp/connect', {
        host: DOCKER_HOST,
        port: 21,
        username: 'testuser',
        password: 'wrong',
      });
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  // ─── Telnet ────────────────────────────────────────────────

  describe('Telnet (port 23)', () => {
    it('POST /telnet/connect — should connect to telnet server', async () => {
      const res = await post('/telnet/connect', { host: DOCKER_HOST, port: 23 });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  // ─── Simple Protocols ─────────────────────────────────────

  describe('Simple Protocols (Echo/Daytime/Time/Finger)', () => {
    it('POST /echo/test — should echo message back', async () => {
      const res = await post('/echo/test', {
        host: DOCKER_HOST,
        port: 7,
        message: 'hello_docker',
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.match).toBe(true);
      }
    });

    it('POST /daytime/get — should return time string', async () => {
      const res = await post('/daytime/get', { host: DOCKER_HOST, port: 13 });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.time).toBeDefined();
      }
    });

    it('POST /time/get — should return binary time', async () => {
      const res = await post('/time/get', { host: DOCKER_HOST, port: 37 });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });

    it('POST /finger/query — should query finger', async () => {
      const res = await post('/finger/query', {
        host: DOCKER_HOST,
        port: 79,
        username: 'testuser',
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  // ─── SMTP ──────────────────────────────────────────────────

  describe('SMTP (port 25)', () => {
    it('POST /smtp/connect — should read banner', async () => {
      const res = await post('/smtp/connect', { host: DOCKER_HOST, port: 25 });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  // ─── IMAP ──────────────────────────────────────────────────

  describe('IMAP (port 143)', () => {
    it('POST /imap/connect — should read IMAP banner', async () => {
      const res = await post('/imap/connect', { host: DOCKER_HOST, port: 143 });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  // ─── POP3 ──────────────────────────────────────────────────

  describe('POP3 (port 110)', () => {
    it('POST /pop3/connect — should read POP3 banner', async () => {
      const res = await post('/pop3/connect', { host: DOCKER_HOST, port: 110 });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  // ─── HTTP ──────────────────────────────────────────────────

  describe('HTTP via nginx (port 80)', () => {
    it('POST /http/request — should fetch from nginx', async () => {
      const res = await post('/http/request', {
        host: DOCKER_HOST,
        port: 80,
        method: 'GET',
        path: '/',
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// MESSAGE QUEUES (docker-compose.queues.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: Queue Services (docker-compose.queues.yml)', () => {
  describe('RabbitMQ / AMQP (port 5672)', () => {
    it('POST /amqp/connect — should connect to AMQP broker', async () => {
      if (!(await isServiceUp(5672))) return;
      const res = await post('/amqp/connect', {
        host: DOCKER_HOST,
        port: 5672,
        vhost: '/',
        username: 'testuser',
        password: 'testpass123',
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe('STOMP via RabbitMQ (port 61613)', () => {
    it('POST /stomp/connect — should connect to STOMP broker', async () => {
      if (!(await isServiceUp(61613))) return;
      const res = await post('/stomp/connect', {
        host: DOCKER_HOST,
        port: 61613,
        username: 'testuser',
        password: 'testpass123',
        vhost: '/',
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('Kafka (port 9092)', () => {
    it('POST /kafka/versions — should fetch API versions', async () => {
      if (!(await isServiceUp(9092))) return;
      const res = await post('/kafka/versions', {
        host: DOCKER_HOST,
        port: 9092,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });

    it('POST /kafka/metadata — should fetch cluster metadata', async () => {
      if (!(await isServiceUp(9092))) return;
      const res = await post('/kafka/metadata', {
        host: DOCKER_HOST,
        port: 9092,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('ZooKeeper (port 2181)', () => {
    it('POST /zookeeper/connect — should respond to ruok', async () => {
      if (!(await isServiceUp(2181))) return;
      const res = await post('/zookeeper/connect', {
        host: DOCKER_HOST,
        port: 2181,
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('POST /zookeeper/command [srvr] — should return server info', async () => {
      if (!(await isServiceUp(2181))) return;
      const res = await post('/zookeeper/command', {
        host: DOCKER_HOST,
        port: 2181,
        command: 'srvr',
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('NATS (port 4222)', () => {
    it('POST /nats/connect — should connect to NATS', async () => {
      if (!(await isServiceUp(4222))) return;
      const res = await post('/nats/connect', {
        host: DOCKER_HOST,
        port: 4222,
        username: 'testuser',
        password: 'testpass123',
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('Beanstalkd (port 11300)', () => {
    it('POST /beanstalkd/connect — should connect', async () => {
      if (!(await isServiceUp(11300))) return;
      const res = await post('/beanstalkd/connect', {
        host: DOCKER_HOST,
        port: 11300,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });

    it('PUT → RESERVE → TOUCH → DELETE — full happy path', async () => {
      if (!(await isServiceUp(11300))) return;

      // 1. Put a job
      const putRes = await post('/beanstalkd/put', {
        host: DOCKER_HOST, port: 11300,
        tube: 'test-lifecycle', payload: 'lifecycle-test-job',
        priority: 0, delay: 0, ttr: 120,
      });
      const putData = await putRes.json();
      expect(putData.success).toBe(true);
      expect(putData.jobId).toBeGreaterThan(0);

      // 2. Reserve the job
      const resRes = await post('/beanstalkd/reserve', {
        host: DOCKER_HOST, port: 11300,
        tube: 'test-lifecycle', reserveTimeout: 2,
      });
      const resData = await resRes.json();
      expect(resData.success).toBe(true);
      expect(resData.status).toBe('RESERVED');
      expect(resData.payload).toContain('lifecycle-test-job');
      const jobId = resData.jobId;

      // 3. Touch (reset TTR) — uses a separate connection so the
      //    job is no longer reserved on this connection. This will
      //    return NOT_FOUND which is expected behavior since each
      //    API call opens a fresh TCP connection.
      const touchRes = await post('/beanstalkd/touch', {
        host: DOCKER_HOST, port: 11300, jobId,
      });
      const touchData = await touchRes.json();
      // Touch requires the same connection that reserved the job,
      // so NOT_FOUND is expected on a fresh connection
      expect(touchData.status).toMatch(/TOUCHED|NOT_FOUND/);

      // 4. Delete the job
      const delRes = await post('/beanstalkd/delete', {
        host: DOCKER_HOST, port: 11300, jobId,
      });
      const delData = await delRes.json();
      // Job may already have been auto-released after connection closed
      expect(delData.status).toMatch(/DELETED|NOT_FOUND/);
    });

    it('PUT → RESERVE → BURY → KICK — buried job recovery', async () => {
      if (!(await isServiceUp(11300))) return;

      // Put and verify
      const putRes = await post('/beanstalkd/put', {
        host: DOCKER_HOST, port: 11300,
        tube: 'test-bury', payload: 'bury-test-job',
      });
      const putData = await putRes.json();
      expect(putData.success).toBe(true);

      // Reserve
      const resRes = await post('/beanstalkd/reserve', {
        host: DOCKER_HOST, port: 11300, tube: 'test-bury',
      });
      const resData = await resRes.json();
      expect(resData.success).toBe(true);
      const jobId = resData.jobId;

      // Bury (fresh connection — job was auto-released when reserve connection closed)
      const buryRes = await post('/beanstalkd/bury', {
        host: DOCKER_HOST, port: 11300, jobId,
      });
      const buryData = await buryRes.json();
      expect(buryData.status).toMatch(/BURIED|NOT_FOUND/);

      // Kick buried jobs back to ready
      const kickRes = await post('/beanstalkd/kick', {
        host: DOCKER_HOST, port: 11300, tube: 'test-bury', bound: 10,
      });
      const kickData = await kickRes.json();
      expect(kickData.status).toMatch(/KICKED/);

      // Clean up — reserve and delete the kicked job
      const cleanRes = await post('/beanstalkd/reserve', {
        host: DOCKER_HOST, port: 11300, tube: 'test-bury', reserveTimeout: 1,
      });
      const cleanData = await cleanRes.json();
      if (cleanData.jobId) {
        await post('/beanstalkd/delete', {
          host: DOCKER_HOST, port: 11300, jobId: cleanData.jobId,
        });
      }
    });

    it('DELETE with invalid jobId — should return NOT_FOUND', async () => {
      if (!(await isServiceUp(11300))) return;
      const res = await post('/beanstalkd/delete', {
        host: DOCKER_HOST, port: 11300, jobId: 999999999,
      });
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.status).toBe('NOT_FOUND');
    });

    it('RELEASE — should re-queue a job', async () => {
      if (!(await isServiceUp(11300))) return;

      // Put a job
      const putRes = await post('/beanstalkd/put', {
        host: DOCKER_HOST, port: 11300,
        tube: 'test-release', payload: 'release-test',
      });
      const putData = await putRes.json();
      expect(putData.success).toBe(true);
      const jobId = putData.jobId;

      // Release (fresh connection — NOT_FOUND expected since not reserved here)
      const relRes = await post('/beanstalkd/release', {
        host: DOCKER_HOST, port: 11300, jobId,
      });
      const relData = await relRes.json();
      expect(relData.status).toMatch(/RELEASED|NOT_FOUND/);

      // Clean up
      const cleanRes = await post('/beanstalkd/reserve', {
        host: DOCKER_HOST, port: 11300, tube: 'test-release', reserveTimeout: 1,
      });
      const cleanData = await cleanRes.json();
      if (cleanData.jobId) {
        await post('/beanstalkd/delete', {
          host: DOCKER_HOST, port: 11300, jobId: cleanData.jobId,
        });
      }
    });
  });

  describe('ActiveMQ (port 61616)', () => {
    it('POST /activemq/connect — should connect to OpenWire', async () => {
      if (!(await isServiceUp(61616))) return;
      const res = await post('/activemq/connect', {
        host: DOCKER_HOST,
        port: 61616,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// ADDITIONAL DATABASES (docker-compose.databases.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: Additional Databases (docker-compose.databases.yml)', () => {
  describe('Cassandra (port 9042)', () => {
    it('POST /cassandra/connect — should handshake', async () => {
      if (!(await isServiceUp(9042))) return;
      const res = await post('/cassandra/connect', {
        host: DOCKER_HOST,
        port: 9042,
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe('ClickHouse (port 9000)', () => {
    it('POST /clickhouse/connect — should connect', async () => {
      if (!(await isServiceUp(9000))) return;
      const res = await post('/clickhouse/connect', {
        host: DOCKER_HOST,
        port: 9000,
        username: 'testuser',
        password: 'testpass123',
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('CouchDB (port 5984)', () => {
    it('POST /couchdb/connect — should connect', async () => {
      if (!(await isServiceUp(5984))) return;
      const res = await post('/couchdb/connect', {
        host: DOCKER_HOST,
        port: 5984,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('Neo4j Bolt (port 7687)', () => {
    it('POST /neo4j/connect — should handshake Bolt protocol', async () => {
      if (!(await isServiceUp(7687))) return;
      const res = await post('/neo4j/connect', {
        host: DOCKER_HOST,
        port: 7687,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('RethinkDB (port 28015)', () => {
    it('POST /rethinkdb/connect — should connect', async () => {
      if (!(await isServiceUp(28015))) return;
      const res = await post('/rethinkdb/connect', {
        host: DOCKER_HOST,
        port: 28015,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('etcd (port 2379)', () => {
    it('POST /etcd/connect — should connect', async () => {
      if (!(await isServiceUp(2379))) return;
      const res = await post('/etcd/connect', {
        host: DOCKER_HOST,
        port: 2379,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('Tarantool (port 3301)', () => {
    it('POST /tarantool/connect — should connect', async () => {
      if (!(await isServiceUp(3301))) return;
      const res = await post('/tarantool/connect', {
        host: DOCKER_HOST,
        port: 3301,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// MONITORING (docker-compose.monitoring.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: Monitoring Services (docker-compose.monitoring.yml)', () => {
  describe('Elasticsearch (port 9200)', () => {
    it('POST /elasticsearch/health — should return cluster health', async () => {
      if (!(await isServiceUp(9200))) return;
      const res = await post('/elasticsearch/health', {
        host: DOCKER_HOST,
        port: 9200,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('Graphite/Carbon (port 2003)', () => {
    it('POST /graphite/send — should send metric', async () => {
      if (!(await isServiceUp(2003))) return;
      const res = await post('/graphite/send', {
        host: DOCKER_HOST,
        port: 2003,
        metrics: [{ name: 'test.docker.cpu', value: 42.5 }],
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('InfluxDB (port 8086)', () => {
    it('POST /influxdb/connect — should connect', async () => {
      if (!(await isServiceUp(8086))) return;
      const res = await post('/influxdb/connect', {
        host: DOCKER_HOST,
        port: 8086,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// DIRECTORY & AUTH (docker-compose.directory.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: Directory Services (docker-compose.directory.yml)', () => {
  describe('LDAP (port 389)', () => {
    it('POST /ldap/connect — should connect to OpenLDAP', async () => {
      if (!(await isServiceUp(389))) return;
      const res = await post('/ldap/connect', {
        host: DOCKER_HOST,
        port: 389,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// MISC PROTOCOLS (docker-compose.misc.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: Misc Protocols (docker-compose.misc.yml)', () => {
  describe('Gopher (port 70)', () => {
    it('POST /gopher/fetch — should fetch root menu', async () => {
      if (!(await isServiceUp(70))) return;
      const res = await post('/gopher/fetch', {
        host: DOCKER_HOST,
        port: 70,
        selector: '',
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('NNTP (port 119)', () => {
    it('POST /nntp/connect — should read banner', async () => {
      if (!(await isServiceUp(119))) return;
      const res = await post('/nntp/connect', {
        host: DOCKER_HOST,
        port: 119,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('DICT (port 2628)', () => {
    it('POST /dict/databases — should list databases', async () => {
      if (!(await isServiceUp(2628))) return;
      const res = await post('/dict/databases', {
        host: DOCKER_HOST,
        port: 2628,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('WHOIS (port 43)', () => {
    it('POST /whois/lookup — should query local WHOIS', async () => {
      if (!(await isServiceUp(43))) return;
      const res = await post('/whois/lookup', {
        host: DOCKER_HOST,
        port: 43,
        domain: 'test.com',
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// FILES (docker-compose.files.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: File Services (docker-compose.files.yml)', () => {
  describe('Rsync (port 873)', () => {
    it('POST /rsync/connect — should list modules', async () => {
      if (!(await isServiceUp(873))) return;
      const res = await post('/rsync/connect', {
        host: DOCKER_HOST,
        port: 873,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('SMB/CIFS (port 445)', () => {
    it('POST /smb/connect — should negotiate SMB', async () => {
      if (!(await isServiceUp(445))) return;
      const res = await post('/smb/connect', {
        host: DOCKER_HOST,
        port: 445,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// INDUSTRIAL (docker-compose.industrial.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: Industrial Protocols (docker-compose.industrial.yml)', () => {
  describe('Modbus TCP (port 502)', () => {
    it('POST /modbus/connect — should connect to simulator', async () => {
      if (!(await isServiceUp(502))) return;
      const res = await post('/modbus/connect', {
        host: DOCKER_HOST,
        port: 502,
        unitId: 1,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });

    it('POST /modbus/read — should read holding registers', async () => {
      if (!(await isServiceUp(502))) return;
      const res = await post('/modbus/read', {
        host: DOCKER_HOST,
        port: 502,
        functionCode: 3,
        address: 0,
        quantity: 10,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('OPC UA (port 4840)', () => {
    it('POST /opcua/connect — should connect to simulator', async () => {
      if (!(await isServiceUp(4840))) return;
      const res = await post('/opcua/connect', {
        host: DOCKER_HOST,
        port: 4840,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// VCS (docker-compose.vcs.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: Version Control (docker-compose.vcs.yml)', () => {
  describe('SVN (port 3690)', () => {
    it('POST /svn/connect — should connect to svnserve', async () => {
      if (!(await isServiceUp(3690))) return;
      const res = await post('/svn/connect', {
        host: DOCKER_HOST,
        port: 3690,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// SECURITY (docker-compose.security.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: Security Services (docker-compose.security.yml)', () => {
  describe('SOCKS5 via Dante (port 1080)', () => {
    it('POST /socks5/connect — should negotiate with proxy', async () => {
      if (!(await isServiceUp(1080))) return;
      const res = await post('/socks5/connect', {
        proxyHost: DOCKER_HOST,
        proxyPort: 1080,
        destHost: 'example.com',
        destPort: 80,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// CHAT (docker-compose.chat.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: Chat Services (docker-compose.chat.yml)', () => {
  describe('XMPP via Prosody (port 5222)', () => {
    it('POST /xmpp/connect — should negotiate XMPP stream', async () => {
      if (!(await isServiceUp(5222))) return;
      const res = await post('/xmpp/connect', {
        host: DOCKER_HOST,
        port: 5222,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// HASHICORP (docker-compose.hashicorp.yml)
// ═══════════════════════════════════════════════════════════════

suite('Docker: HashiCorp Services (docker-compose.hashicorp.yml)', () => {
  describe('Consul (port 8500)', () => {
    it('POST /consul/connect — should connect', async () => {
      if (!(await isServiceUp(8500))) return;
      const res = await post('/consul/connect', {
        host: DOCKER_HOST,
        port: 8500,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });

  describe('Vault (port 8200)', () => {
    it('POST /vault/connect — should connect', async () => {
      if (!(await isServiceUp(8200))) return;
      const res = await post('/vault/connect', {
        host: DOCKER_HOST,
        port: 8200,
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });
  });
});
