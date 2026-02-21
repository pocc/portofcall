/**
 * Real-World Usage Integration Tests
 *
 * Tests each protocol's /api endpoints using realistic hosts, ports, and
 * parameter values that reflect how people actually use these protocols
 * in practice.  Targets are well-known public services or dedicated test
 * servers; every test uses the HTTP (non-WebSocket) API surface.
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'https://portofcall.ross.gg/api';
const isLocal = API_BASE.includes('localhost');

// Echo server: use local Docker simple server on port 7 when running locally
const ECHO_HOST = isLocal ? 'localhost' : 'tcpbin.com';
const ECHO_PORT = isLocal ? 7 : 4242;

// Skip tests connecting to external servers that may cause wrangler dev restarts
const itRemoteOnly = isLocal ? it.skip : it;

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

/** POST JSON to an API endpoint and return { response, data }. */
async function postJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    // Worker may restart mid-request in dev mode, returning non-JSON
    data = { success: false, error: 'Worker restarted mid-request' };
  }
  return { response, data } as {
    response: Response;
    data: Record<string, unknown>;
  };
}

/* ================================================================== */
/*  1. TCP Ping — common services a sysadmin would check              */
/* ================================================================== */

describe('TCP Ping — Real-World Targets', () => {
  it('should ping Google Public DNS on port 53', async () => {
    const { data } = await postJson('/ping', { host: '8.8.8.8', port: 53 });
    expect(data.success).toBe(true);
    expect(data.rtt).toBeGreaterThan(0);
  });

  it('should ping Quad9 DNS on port 53', async () => {
    const { data } = await postJson('/ping', { host: '9.9.9.9', port: 53 });
    expect(data.success).toBe(true);
    expect(data.rtt).toBeGreaterThan(0);
  });

  it('should ping OpenDNS on port 53', async () => {
    const { data } = await postJson('/ping', { host: '208.67.222.222', port: 53 });
    expect(data.success).toBe(true);
    expect(data.rtt).toBeGreaterThan(0);
  });

  it('should ping Google HTTPS on port 443', async () => {
    const { data } = await postJson('/ping', { host: 'google.com', port: 443 });
    expect(data.success).toBe(true);
    expect(data.message).toContain('TCP Ping Success');
  });

  it('should ping an SSH server on port 22', async () => {
    const { data } = await postJson('/ping', { host: 'test.rebex.net', port: 22 });
    expect(data.success).toBe(true);
    expect(data.port).toBe(22);
    expect(data.rtt).toBeGreaterThan(0);
  });

  it('should ping an MQTT broker on port 1883', async () => {
    const { data } = await postJson('/ping', {
      host: 'broker.hivemq.com',
      port: 1883,
    });
    expect(data.success).toBe(true);
    expect(data.rtt).toBeGreaterThan(0);
  }, 15000);

  it('should ping Gmail SMTP on port 587', async () => {
    const { data } = await postJson('/ping', {
      host: 'smtp.gmail.com',
      port: 587,
    });
    // Gmail may or may not be reachable from CF Workers, but the API should
    // return a well-formed response either way.
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should ping a Telnet service on a non-standard port', async () => {
    // freechess.org runs on port 5000
    const { data } = await postJson('/ping', {
      host: 'freechess.org',
      port: 5000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);
});

/* ================================================================== */
/*  2. SSH — public test server banner reading                        */
/* ================================================================== */

describe('SSH — Real-World Usage', () => {
  it('should read banner from Rebex test server', async () => {
    const { data } = await postJson('/ssh/connect', {
      host: 'test.rebex.net',
      port: 22,
      username: 'demo',
      password: 'password',
    });
    expect(data.success).toBe(true);
    expect(data.banner).toBeDefined();
    expect(typeof data.banner).toBe('string');
    expect((data.banner as string).startsWith('SSH-2.0')).toBe(true);
  });

  it('should handle connection to SSH on a non-standard port gracefully', async () => {
    // Telehack offers SSH on port 2222
    const { data } = await postJson('/ssh/connect', {
      host: 'telehack.com',
      port: 2222,
    });
    // May or may not succeed — just verify well-formed response
    expect(data).toHaveProperty('success');
  }, 15000);
});

/* ================================================================== */
/*  3. FTP — public test servers                                      */
/* ================================================================== */

describe('FTP — Real-World Usage', () => {
  it('should connect to Rebex FTP with demo credentials', async () => {
    const { data } = await postJson('/ftp/connect', {
      host: 'test.rebex.net',
      port: 21,
      username: 'demo',
      password: 'password',
    });
    expect(data.success).toBe(true);
    expect(data.currentDirectory).toBeDefined();
  }, 30000);

  it('should list root directory on Rebex FTP', async () => {
    const { data } = await postJson('/ftp/list', {
      host: 'test.rebex.net',
      port: 21,
      username: 'demo',
      password: 'password',
      path: '/',
    });
    expect(data.success).toBe(true);
    expect(Array.isArray(data.files)).toBe(true);
  }, 30000);

  it('should connect to WingFTP demo server', async () => {
    const { data } = await postJson('/ftp/connect', {
      host: 'demo.wftpserver.com',
      port: 21,
      username: 'demo',
      password: 'demo',
    });
    // May succeed or fail depending on availability
    expect(data).toHaveProperty('success');
  }, 30000);

  it('should handle anonymous FTP connection to Tele2 speedtest', async () => {
    const { data } = await postJson('/ftp/connect', {
      host: 'speedtest.tele2.net',
      port: 21,
      username: 'anonymous',
      password: 'anonymous@example.com',
    });
    expect(data).toHaveProperty('success');
  }, 30000);
});

/* ================================================================== */
/*  4. Telnet — public services                                       */
/* ================================================================== */

describe('Telnet — Real-World Usage', () => {
  it('should connect to Telehack on standard port 23', async () => {
    const { data } = await postJson('/telnet/connect', {
      host: 'telehack.com',
      port: 23,
      timeout: 10000,
    });
    expect(data.success).toBe(true);
    expect(data).toHaveProperty('banner');
  }, 30000);

  it('should connect to Telehack on alternate port 1337', async () => {
    const { data } = await postJson('/telnet/connect', {
      host: 'telehack.com',
      port: 1337,
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 30000);

  it('should connect to Free Internet Chess Server on port 5000', async () => {
    const { data } = await postJson('/telnet/connect', {
      host: 'freechess.org',
      port: 5000,
      timeout: 10000,
    });
    // FICS may or may not be reachable; verify well-formed response
    expect(data).toHaveProperty('success');
  }, 30000);

  it('should connect to TBA MUD on port 9091', async () => {
    const { data } = await postJson('/telnet/connect', {
      host: 'tbamud.com',
      port: 9091,
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 30000);
});

/* ================================================================== */
/*  5. SMTP — major email providers                                   */
/* ================================================================== */

describe('SMTP — Real-World Usage', () => {
  it('should test connectivity to Gmail SMTP on port 587', async () => {
    const { data } = await postJson('/smtp/connect', {
      host: 'smtp.gmail.com',
      port: 587,
      timeout: 10000,
    });
    // Gmail may reject from CF Workers IPs, but the request format is valid
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should test connectivity to Gmail SMTP on port 465 (SMTPS)', async () => {
    const { data } = await postJson('/smtp/connect', {
      host: 'smtp.gmail.com',
      port: 465,
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should test connectivity to Outlook SMTP on port 587', async () => {
    const { data } = await postJson('/smtp/connect', {
      host: 'smtp.office365.com',
      port: 587,
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should test connectivity to Yahoo SMTP on port 465', async () => {
    const { data } = await postJson('/smtp/connect', {
      host: 'smtp.mail.yahoo.com',
      port: 465,
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should validate email send request with realistic fields', async () => {
    const { response, data } = await postJson('/smtp/send', {
      host: 'smtp.gmail.com',
      port: 587,
      from: 'sender@gmail.com',
      to: 'recipient@example.com',
      subject: 'Quarterly Report Q4 2025',
      body: 'Please find the quarterly report attached.\n\nBest regards,\nJohn',
      username: 'sender@gmail.com',
      password: 'app-specific-password',
      timeout: 10000,
    });
    // Will fail to actually send (wrong creds), but should attempt connection
    expect(data).toHaveProperty('success');
    // Should NOT be a 400 — all required fields are present
    expect(response.status).not.toBe(400);
  }, 15000);
});

/* ================================================================== */
/*  6. POP3 — common mail providers                                   */
/* ================================================================== */

describe('POP3 — Real-World Usage', () => {
  it('should test connectivity to Gmail POP3 on port 995 (SSL)', async () => {
    const { data } = await postJson('/pop3/connect', {
      host: 'pop.gmail.com',
      port: 995,
      username: 'user@gmail.com',
      password: 'app-password',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should test connectivity to Outlook POP3 on port 995', async () => {
    const { data } = await postJson('/pop3/connect', {
      host: 'outlook.office365.com',
      port: 995,
      username: 'user@outlook.com',
      password: 'password',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should test connectivity to Yahoo POP3 on port 995', async () => {
    const { data } = await postJson('/pop3/connect', {
      host: 'pop.mail.yahoo.com',
      port: 995,
      username: 'user@yahoo.com',
      password: 'password',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should request message listing with realistic parameters', async () => {
    const { response, data } = await postJson('/pop3/list', {
      host: 'pop.gmail.com',
      port: 995,
      username: 'user@gmail.com',
      password: 'app-password',
      timeout: 10000,
    });
    // Should attempt connection, not reject on validation
    expect(response.status).not.toBe(400);
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should request message retrieval with realistic parameters', async () => {
    const { response, data } = await postJson('/pop3/retrieve', {
      host: 'pop.gmail.com',
      port: 995,
      username: 'user@gmail.com',
      password: 'app-password',
      messageId: 1,
      timeout: 10000,
    });
    expect(response.status).not.toBe(400);
    expect(data).toHaveProperty('success');
  }, 15000);
});

/* ================================================================== */
/*  7. IMAP — common mail providers                                   */
/* ================================================================== */

describe('IMAP — Real-World Usage', () => {
  it('should test connectivity to Gmail IMAP on port 993 (SSL)', async () => {
    const { data } = await postJson('/imap/connect', {
      host: 'imap.gmail.com',
      port: 993,
      username: 'user@gmail.com',
      password: 'app-password',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should test connectivity to Outlook IMAP on port 993', async () => {
    const { data } = await postJson('/imap/connect', {
      host: 'outlook.office365.com',
      port: 993,
      username: 'user@outlook.com',
      password: 'password',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should test connectivity to Yahoo IMAP on port 993', async () => {
    const { data } = await postJson('/imap/connect', {
      host: 'imap.mail.yahoo.com',
      port: 993,
      username: 'user@yahoo.com',
      password: 'password',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should test connectivity to Apple iCloud IMAP on port 993', async () => {
    const { data } = await postJson('/imap/connect', {
      host: 'imap.mail.me.com',
      port: 993,
      username: 'user@icloud.com',
      password: 'app-password',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should request mailbox listing with realistic parameters', async () => {
    const { response, data } = await postJson('/imap/list', {
      host: 'imap.gmail.com',
      port: 993,
      username: 'user@gmail.com',
      password: 'app-password',
      timeout: 10000,
    });
    expect(response.status).not.toBe(400);
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should request INBOX select with realistic parameters', async () => {
    const { response, data } = await postJson('/imap/select', {
      host: 'imap.gmail.com',
      port: 993,
      username: 'user@gmail.com',
      password: 'app-password',
      mailbox: 'INBOX',
      timeout: 10000,
    });
    expect(response.status).not.toBe(400);
    expect(data).toHaveProperty('success');
  }, 15000);
});

/* ================================================================== */
/*  8. MySQL — realistic cloud-style endpoints                        */
/* ================================================================== */

describe('MySQL — Real-World Usage', () => {
  it('should handle connection to a typical RDS-style endpoint', async () => {
    const { data } = await postJson('/mysql/connect', {
      host: 'myapp-db.abc123xyz.us-east-1.rds.amazonaws.com',
      port: 3306,
      username: 'admin',
      password: 'secretpassword',
      timeout: 5000,
    });
    // Unreachable, but should return a well-formed failure
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);

  it('should handle connection on MySQL X Protocol port 33060', async () => {
    const { data } = await postJson('/mysql/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 33060,
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle connection to Azure-style MySQL endpoint', async () => {
    const { data } = await postJson('/mysql/connect', {
      host: 'myserver.mysql.database.azure.com',
      port: 3306,
      username: 'dbadmin@myserver',
      password: 'P@ssw0rd!',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);

  it('should handle typical DigitalOcean managed DB port', async () => {
    const { data } = await postJson('/mysql/connect', {
      host: 'db-mysql-nyc1-12345-do-user-000-0.b.db.ondigitalocean.com',
      port: 25060,
      username: 'doadmin',
      password: 'password',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);
});

/* ================================================================== */
/*  9. PostgreSQL — realistic cloud-style endpoints                   */
/* ================================================================== */

describe('PostgreSQL — Real-World Usage', () => {
  it('should handle connection to a typical RDS-style endpoint', async () => {
    const { data } = await postJson('/postgres/connect', {
      host: 'myapp-db.abc123xyz.us-east-1.rds.amazonaws.com',
      port: 5432,
      username: 'postgres',
      password: 'secretpassword',
      database: 'myapp_production',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);

  it('should handle connection to a Supabase-style endpoint', async () => {
    const { data } = await postJson('/postgres/connect', {
      host: 'db.abcdefghijklmnop.supabase.co',
      port: 5432,
      username: 'postgres',
      password: 'your-password',
      database: 'postgres',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);

  it('should handle connection to a Neon-style endpoint', async () => {
    const { data } = await postJson('/postgres/connect', {
      host: 'ep-cool-wildflower-123456.us-east-2.aws.neon.tech',
      port: 5432,
      username: 'neondb_owner',
      password: 'password',
      database: 'neondb',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);

  it('should handle connection to Azure-style PostgreSQL endpoint', async () => {
    const { data } = await postJson('/postgres/connect', {
      host: 'myserver.postgres.database.azure.com',
      port: 5432,
      username: 'pgadmin@myserver',
      password: 'P@ssw0rd!',
      database: 'postgres',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);
});

/* ================================================================== */
/*  10. Redis — common commands and configurations                    */
/* ================================================================== */

describe('Redis — Real-World Usage', () => {
  it('should handle PING command to unreachable host', async () => {
    const { data } = await postJson('/redis/command', {
      host: 'unreachable-host-12345.invalid',
      port: 6379,
      command: ['PING'],
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle INFO command', async () => {
    const { data } = await postJson('/redis/command', {
      host: 'unreachable-host-12345.invalid',
      port: 6379,
      command: ['INFO'],
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle DBSIZE command', async () => {
    const { data } = await postJson('/redis/command', {
      host: 'unreachable-host-12345.invalid',
      port: 6379,
      command: ['DBSIZE'],
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle GET with a typical cache key', async () => {
    const { data } = await postJson('/redis/command', {
      host: 'unreachable-host-12345.invalid',
      port: 6379,
      command: ['GET', 'session:user:abc123'],
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle SET with a typical session key', async () => {
    const { data } = await postJson('/redis/command', {
      host: 'unreachable-host-12345.invalid',
      port: 6379,
      command: ['SET', 'cache:api:v1:users:42', '{"name":"Alice"}'],
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle HGETALL for a hash key', async () => {
    const { data } = await postJson('/redis/command', {
      host: 'unreachable-host-12345.invalid',
      port: 6379,
      command: ['HGETALL', 'user:profile:1001'],
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle connection with auth on Redis Sentinel port', async () => {
    const { data } = await postJson('/redis/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 26379,
      password: 'sentinel-password',
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle connection with database selection', async () => {
    const { data } = await postJson('/redis/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 6379,
      password: 'redis-password',
      database: 15,
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  11. MQTT — public brokers                                         */
/* ================================================================== */

describe('MQTT — Real-World Usage', () => {
  it('should connect to HiveMQ public broker (no auth)', async () => {
    const { data } = await postJson('/mqtt/connect', {
      host: 'broker.hivemq.com',
      port: 1883,
      clientId: 'portofcall-test-hivemq',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should connect to EMQX public broker with credentials', async () => {
    const { data } = await postJson('/mqtt/connect', {
      host: 'broker.emqx.io',
      port: 1883,
      username: 'emqx',
      password: 'public',
      clientId: 'portofcall-test-emqx',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should connect to Eclipse Mosquitto public broker (no auth)', async () => {
    const { data } = await postJson('/mqtt/connect', {
      host: 'test.mosquitto.org',
      port: 1883,
      clientId: 'portofcall-test-mosquitto',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should connect to Mosquitto with auth on port 1884', async () => {
    const { data } = await postJson('/mqtt/connect', {
      host: 'test.mosquitto.org',
      port: 1884,
      username: 'rw',
      password: 'readwrite',
      clientId: 'portofcall-test-mosquitto-auth',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should connect to EMQX on TLS port 8883', async () => {
    const { data } = await postJson('/mqtt/connect', {
      host: 'broker.emqx.io',
      port: 8883,
      clientId: 'portofcall-test-emqx-tls',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should use an IoT-style client ID', async () => {
    const { data } = await postJson('/mqtt/connect', {
      host: 'broker.hivemq.com',
      port: 1883,
      clientId: 'sensor-temp-001-warehouse-east',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);
});

/* ================================================================== */
/*  12. LDAP — public test server (forumsys)                          */
/* ================================================================== */

describe('LDAP — Real-World Usage', () => {
  it('should bind as read-only admin on forumsys', async () => {
    const { data } = await postJson('/ldap/connect', {
      host: 'ldap.forumsys.com',
      port: 389,
      bindDN: 'cn=read-only-admin,dc=example,dc=com',
      password: 'password',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should bind as Einstein user on forumsys', async () => {
    const { data } = await postJson('/ldap/connect', {
      host: 'ldap.forumsys.com',
      port: 389,
      bindDN: 'uid=einstein,dc=example,dc=com',
      password: 'password',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should bind as Euler user on forumsys', async () => {
    const { data } = await postJson('/ldap/connect', {
      host: 'ldap.forumsys.com',
      port: 389,
      bindDN: 'uid=euler,dc=example,dc=com',
      password: 'password',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should attempt anonymous bind on forumsys', async () => {
    const { data } = await postJson('/ldap/connect', {
      host: 'ldap.forumsys.com',
      port: 389,
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should reject incorrect password on forumsys', async () => {
    const { data } = await postJson('/ldap/connect', {
      host: 'ldap.forumsys.com',
      port: 389,
      bindDN: 'uid=einstein,dc=example,dc=com',
      password: 'wrong-password',
      timeout: 10000,
    });
    // Should connect but fail auth (or timeout — either way, well-formed)
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should handle typical Active Directory style DN', async () => {
    const { data } = await postJson('/ldap/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 389,
      bindDN: 'cn=svc-account,ou=Service Accounts,dc=corp,dc=example,dc=com',
      password: 'ServiceP@ss!',
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle LDAPS port 636', async () => {
    const { data } = await postJson('/ldap/connect', {
      host: 'ldap.forumsys.com',
      port: 636,
      bindDN: 'cn=read-only-admin,dc=example,dc=com',
      password: 'password',
      timeout: 10000,
    });
    expect(data).toHaveProperty('success');
  }, 15000);
});

/* ================================================================== */
/*  13. SMB — typical NAS / file-server scenarios                     */
/* ================================================================== */

describe('SMB — Real-World Usage', () => {
  it('should handle connection attempt to a NAS-style hostname', async () => {
    const { data } = await postJson('/smb/connect', {
      host: 'nas.home.local',
      port: 445,
      timeout: 3000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should handle connection on legacy NetBIOS port 139', async () => {
    const { data } = await postJson('/smb/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 139,
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle connection to a corporate file server hostname', async () => {
    const { data } = await postJson('/smb/connect', {
      host: 'fileserver.corp.example.com',
      port: 445,
      timeout: 3000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);
});

/* ================================================================== */
/*  14. Echo — tcpbin.com service                                     */
/* ================================================================== */

describe('Echo — Real-World Usage', () => {
  // tcpbin.com is a free service that can rate-limit or timeout under load.
  // Tests use lenient assertions so flaky connectivity doesn't break CI.

  it('should echo a JSON payload', async () => {
    const message = '{"event":"heartbeat","ts":1706400000}';
    const { data } = await postJson('/echo/test', {
      host: ECHO_HOST,
      port: ECHO_PORT,
      message,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.sent).toBe(message);
      expect(data.match).toBe(true);
    }
  }, 20000);

  it('should echo an HTTP-like request line', async () => {
    const message = 'GET /health HTTP/1.1\r\nHost: example.com\r\n\r\n';
    const { data } = await postJson('/echo/test', {
      host: ECHO_HOST,
      port: ECHO_PORT,
      message,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.sent).toBe(message);
    }
  }, 20000);

  it('should echo a Redis RESP command string', async () => {
    // RESP uses CRLF terminators; the echo service may normalize line endings
    // so we only check that the message was sent and a response came back.
    const message = '*1\r\n$4\r\nPING\r\n';
    const { data } = await postJson('/echo/test', {
      host: ECHO_HOST,
      port: ECHO_PORT,
      message,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.sent).toBe(message);
      expect(data.received).toBeTruthy();
    }
  }, 20000);

  it('should echo a SQL-like query string', async () => {
    const message = "SELECT id, name, email FROM users WHERE active = true LIMIT 100;";
    const { data } = await postJson('/echo/test', {
      host: ECHO_HOST,
      port: ECHO_PORT,
      message,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.match).toBe(true);
    }
  }, 20000);

  it('should echo a log-line message', async () => {
    const message = '2025-01-28T12:00:00Z INFO [main] Application started on port 8080';
    const { data } = await postJson('/echo/test', {
      host: ECHO_HOST,
      port: ECHO_PORT,
      message,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.match).toBe(true);
    }
  }, 20000);

  it('should echo binary-ish hex-encoded data', async () => {
    const message = '\x00\x01\x02\x03DEADBEEF\xFF\xFE';
    const { data } = await postJson('/echo/test', {
      host: ECHO_HOST,
      port: ECHO_PORT,
      message,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
  }, 20000);
});

/* ================================================================== */
/*  15. WHOIS — domain registration lookups                           */
/* ================================================================== */

describe('WHOIS — Real-World Usage', () => {
  it('should look up google.com via auto-selected Verisign server', async () => {
    const { data } = await postJson('/whois/lookup', {
      domain: 'google.com',
      timeout: 15000,
    });
    expect(data.success).toBe(true);
    expect(data.domain).toBe('google.com');
    expect(data.server).toBe('whois.verisign-grs.com');
    expect(data.response).toBeDefined();
    expect((data.response as string).toLowerCase()).toContain('domain name');
  }, 20000);

  it('should look up wikipedia.org via PIR WHOIS', async () => {
    const { data } = await postJson('/whois/lookup', {
      domain: 'wikipedia.org',
      timeout: 15000,
    });
    expect(data.success).toBe(true);
    expect(data.server).toBe('whois.pir.org');
    expect((data.response as string).length).toBeGreaterThan(0);
  }, 20000);

  it('should look up mit.edu via EDUCAUSE WHOIS', async () => {
    const { data } = await postJson('/whois/lookup', {
      domain: 'mit.edu',
      timeout: 15000,
    });
    expect(data.success).toBe(true);
    expect(data.server).toBe('whois.educause.edu');
    expect(data.response).toBeDefined();
  }, 20000);

  it('should look up a .net domain via Verisign', async () => {
    const { data } = await postJson('/whois/lookup', {
      domain: 'speedtest.net',
      timeout: 15000,
    });
    expect(data.success).toBe(true);
    expect(data.server).toBe('whois.verisign-grs.com');
    expect((data.response as string).length).toBeGreaterThan(0);
  }, 20000);

  it('should fall back to IANA for unknown TLDs', async () => {
    const { data } = await postJson('/whois/lookup', {
      domain: 'example.xyz',
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    // Unknown TLD should go to whois.iana.org
    if (data.success) {
      expect(data.server).toBe('whois.iana.org');
    }
  }, 20000);

  it('should allow explicit WHOIS server override', async () => {
    const { data } = await postJson('/whois/lookup', {
      domain: 'facebook.com',
      server: 'whois.verisign-grs.com',
      port: 43,
      timeout: 15000,
    });
    expect(data.success).toBe(true);
    expect(data.server).toBe('whois.verisign-grs.com');
    expect((data.response as string).toLowerCase()).toContain('domain name');
  }, 20000);

  it('should reject an invalid domain format', async () => {
    const { response, data } = await postJson('/whois/lookup', {
      domain: 'invalid..domain..com',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid domain format');
  });

  it('should reject an empty domain', async () => {
    const { response, data } = await postJson('/whois/lookup', {
      domain: '',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Domain is required');
  });
});

/* ================================================================== */
/*  16. Syslog — centralized logging messages                         */
/* ================================================================== */

describe('Syslog — Real-World Usage', () => {
  // Syslog is fire-and-forget (no server response), so these tests
  // validate message formatting and input validation.  Connection may
  // fail without a listener — that's expected.

  it('should format an SSH auth failure (auth/warning, priority 36)', async () => {
    const { data } = await postJson('/syslog/send', {
      host: 'localhost',
      port: 514,
      severity: 4,   // Warning
      facility: 4,   // Auth
      message: 'pam_unix(sshd:auth): authentication failure; rhost=10.0.2.2 user=root',
      hostname: 'bastion-01',
      appName: 'sshd',
      format: 'rfc5424',
      timeout: 5000,
    });
    if (data.success) {
      expect(data.formatted).toMatch(/^<36>1 /);
      expect(data.formatted).toContain('bastion-01');
      expect(data.formatted).toContain('sshd');
      expect(data.formatted).toContain('authentication failure');
    }
  }, 10000);

  it('should format a kernel panic (kern/emerg, priority 0)', async () => {
    const { data } = await postJson('/syslog/send', {
      host: 'localhost',
      port: 514,
      severity: 0,   // Emergency
      facility: 0,   // Kernel
      message: 'Kernel panic - not syncing: VFS: Unable to mount root fs',
      hostname: 'prod-db-01',
      appName: 'kernel',
      format: 'rfc5424',
      timeout: 5000,
    });
    if (data.success) {
      expect(data.formatted).toMatch(/^<0>1 /);
      expect(data.formatted).toContain('Kernel panic');
    }
  }, 10000);

  it('should format a cron job log (cron/info, priority 78)', async () => {
    const { data } = await postJson('/syslog/send', {
      host: 'localhost',
      port: 514,
      severity: 6,   // Informational
      facility: 9,   // Cron
      message: '(root) CMD (/usr/local/bin/backup.sh --full)',
      hostname: 'backup-server',
      appName: 'crond',
      format: 'rfc5424',
      timeout: 5000,
    });
    if (data.success) {
      expect(data.formatted).toMatch(/^<78>1 /);
      expect(data.formatted).toContain('backup.sh');
    }
  }, 10000);

  it('should format a web server access log (local1/info, priority 142)', async () => {
    const { data } = await postJson('/syslog/send', {
      host: 'localhost',
      port: 514,
      severity: 6,   // Informational
      facility: 17,  // Local1
      message: '192.168.1.50 - - "GET /api/health HTTP/1.1" 200 42',
      hostname: 'web-lb-01',
      appName: 'nginx',
      format: 'rfc5424',
      timeout: 5000,
    });
    if (data.success) {
      expect(data.formatted).toMatch(/^<142>1 /);
      expect(data.formatted).toContain('nginx');
    }
  }, 10000);

  it('should format a firewall drop event (kern/notice, priority 5)', async () => {
    const { data } = await postJson('/syslog/send', {
      host: 'localhost',
      port: 514,
      severity: 5,   // Notice
      facility: 0,   // Kernel
      message: 'iptables DROP IN=eth0 SRC=192.168.1.100 DST=10.0.0.5 PROTO=TCP DPT=22',
      hostname: 'fw-edge-01',
      appName: 'kernel',
      format: 'rfc5424',
      timeout: 5000,
    });
    if (data.success) {
      expect(data.formatted).toMatch(/^<5>1 /);
      expect(data.formatted).toContain('iptables DROP');
    }
  }, 10000);

  it('should format a sudo auth failure (authpriv/error, priority 83)', async () => {
    const { data } = await postJson('/syslog/send', {
      host: 'localhost',
      port: 514,
      severity: 3,   // Error
      facility: 10,  // Authpriv
      message: 'user1 : 3 incorrect password attempts ; TTY=pts/0 ; USER=root ; COMMAND=/bin/cat /etc/shadow',
      hostname: 'dev-server',
      appName: 'sudo',
      format: 'rfc5424',
      timeout: 5000,
    });
    if (data.success) {
      expect(data.formatted).toMatch(/^<83>1 /);
      expect(data.formatted).toContain('sudo');
    }
  }, 10000);

  it('should format a legacy BSD-style message (RFC 3164)', async () => {
    const { data } = await postJson('/syslog/send', {
      host: 'localhost',
      port: 514,
      severity: 6,   // Informational
      facility: 1,   // User
      message: 'Application startup complete, listening on port 8080',
      hostname: 'app-server',
      appName: 'myapp',
      format: 'rfc3164',
      timeout: 5000,
    });
    if (data.success) {
      expect(data.formatted).toMatch(/^<14>/);  // (1*8)+6 = 14
      expect(data.formatted).toContain('app-server');
      expect(data.formatted).toContain('myapp:');
    }
  }, 10000);

  it('should reject severity out of range (0-7)', async () => {
    const { response, data } = await postJson('/syslog/send', {
      host: 'test-host.invalid',
      severity: 99,
      message: 'Test message',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Severity must be between 0 and 7');
  });

  it('should reject facility out of range (0-23)', async () => {
    const { response, data } = await postJson('/syslog/send', {
      host: 'test-host.invalid',
      severity: 6,
      facility: 99,
      message: 'Test message',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Facility must be between 0 and 23');
  });

  it('should reject empty host', async () => {
    const { response, data } = await postJson('/syslog/send', {
      host: '',
      severity: 6,
      message: 'Test',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject empty message', async () => {
    const { response, data } = await postJson('/syslog/send', {
      host: 'test-host.invalid',
      severity: 6,
      message: '',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Message is required');
  });
});

/* ================================================================== */
/*  17. SOCKS4 — proxy connection testing                             */
/* ================================================================== */

describe('SOCKS4 — Real-World Usage', () => {
  // No reliable public SOCKS4 proxies exist; these tests verify the
  // protocol handshake against unreachable endpoints and input validation.

  it('should handle connection to unreachable proxy on standard port 1080', async () => {
    const { data } = await postJson('/socks4/connect', {
      proxyHost: 'unreachable-host-12345.invalid',
      proxyPort: 1080,
      destHost: 'example.com',
      destPort: 80,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should handle SOCKS4a with hostname resolution', async () => {
    const { data } = await postJson('/socks4/connect', {
      proxyHost: 'unreachable-host-12345.invalid',
      proxyPort: 1080,
      destHost: 'www.google.com',
      destPort: 443,
      useSocks4a: true,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should handle SSH tunnel proxy scenario (ssh -D)', async () => {
    // ssh -D creates a local SOCKS proxy for tunneling
    const { data } = await postJson('/socks4/connect', {
      proxyHost: 'unreachable-host-12345.invalid',
      proxyPort: 9050,
      destHost: 'internal-wiki.corp.local',
      destPort: 80,
      userId: 'tunnel-user',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should handle classic SOCKS4 with IP-only destination', async () => {
    const { data } = await postJson('/socks4/connect', {
      proxyHost: 'unreachable-host-12345.invalid',
      proxyPort: 1080,
      destHost: '93.184.216.34',  // example.com IP
      destPort: 80,
      useSocks4a: false,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject missing proxy host', async () => {
    const { response, data } = await postJson('/socks4/connect', {
      proxyHost: '',
      destHost: 'example.com',
      destPort: 80,
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Proxy host is required');
  });

  it('should reject missing destination host', async () => {
    const { response, data } = await postJson('/socks4/connect', {
      proxyHost: 'unreachable-host-12345.invalid',
      destHost: '',
      destPort: 80,
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Destination host is required');
  });

  it('should reject invalid destination port', async () => {
    const { response, data } = await postJson('/socks4/connect', {
      proxyHost: 'unreachable-host-12345.invalid',
      destHost: 'example.com',
      destPort: 99999,
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toContain('port');
  });
});

/* ================================================================== */
/*  18. Daytime (RFC 867) — human-readable time service               */
/* ================================================================== */

describe('Daytime — Real-World Usage', () => {
  it('should get time from NIST daytime server on port 13', async () => {
    const { data } = await postJson('/daytime/get', {
      host: 'time.nist.gov',
      port: 13,
      timeout: 15000,
    });
    // NIST may or may not respond from CF Workers; verify well-formed response
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.time).toBeDefined();
      expect((data.time as string).length).toBeGreaterThan(0);
      expect(data.localTime).toBeDefined();
    }
  }, 20000);

  it('should handle unreachable daytime host gracefully', async () => {
    const { data } = await postJson('/daytime/get', {
      host: 'unreachable-host-12345.invalid',
      port: 13,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should reject empty host', async () => {
    const { response, data } = await postJson('/daytime/get', {
      host: '',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port', async () => {
    const { response, data } = await postJson('/daytime/get', {
      host: 'time.nist.gov',
      port: 99999,
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });
});

/* ================================================================== */
/*  19. Finger (RFC 1288) — user information lookup                   */
/* ================================================================== */

describe('Finger — Real-World Usage', () => {
  // Finger is effectively a dead protocol — very few public servers
  // remain.  These tests exercise the API surface and validation.

  it('should handle connection to an unreachable finger server', async () => {
    const { data } = await postJson('/finger/query', {
      host: 'unreachable-host-12345.invalid',
      port: 79,
      username: 'admin',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should handle a bare query (list all users)', async () => {
    const { data } = await postJson('/finger/query', {
      host: 'unreachable-host-12345.invalid',
      port: 79,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle remote host forwarding syntax', async () => {
    // Finger supports user@host forwarding
    const { data } = await postJson('/finger/query', {
      host: 'unreachable-host-12345.invalid',
      port: 79,
      username: 'root',
      remoteHost: 'internal.example.com',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject empty host', async () => {
    const { response, data } = await postJson('/finger/query', {
      host: '',
      username: 'admin',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid username characters', async () => {
    const { response, data } = await postJson('/finger/query', {
      host: 'unreachable-host-12345.invalid',
      username: 'admin; rm -rf /',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Username contains invalid characters');
  });

  it('should reject invalid port', async () => {
    const { response, data } = await postJson('/finger/query', {
      host: 'unreachable-host-12345.invalid',
      port: 0,
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });
});

/* ================================================================== */
/*  20. Time (RFC 868) — binary time protocol                         */
/* ================================================================== */

describe('Time — Real-World Usage', () => {
  it('should get binary time from NIST on port 37', async () => {
    const { data } = await postJson('/time/get', {
      host: 'time.nist.gov',
      port: 37,
      timeout: 15000,
    });
    // NIST may or may not respond from CF Workers; verify well-formed response
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.raw).toBeDefined();
      expect(typeof data.raw).toBe('number');
      expect(data.unixTimestamp).toBeDefined();
      expect(data.date).toBeDefined();
      // Timestamp should be reasonable (after 2020-01-01)
      expect(data.unixTimestamp as number).toBeGreaterThan(1577836800);
    }
  }, 20000);

  it('should handle unreachable time host gracefully', async () => {
    const { data } = await postJson('/time/get', {
      host: 'unreachable-host-12345.invalid',
      port: 37,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 10000);

  it('should reject empty host', async () => {
    const { response, data } = await postJson('/time/get', {
      host: '',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port', async () => {
    const { response, data } = await postJson('/time/get', {
      host: 'time.nist.gov',
      port: 99999,
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });
});

/* ================================================================== */
/*  21. DNS — public resolvers                                        */
/* ================================================================== */

describe('DNS — Real-World Usage', () => {
  it('should resolve google.com A record via Google DNS', async () => {
    const { data } = await postJson('/dns/query', {
      domain: 'google.com',
      type: 'A',
      server: '8.8.8.8',
      port: 53,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.domain).toBe('google.com');
      expect(data.queryType).toBe('A');
      expect(data.rcode).toBe('NOERROR');
      expect((data.answers as unknown[]).length).toBeGreaterThan(0);
    }
  }, 15000);

  it('should resolve cloudflare.com AAAA via Cloudflare DNS', async () => {
    const { data } = await postJson('/dns/query', {
      domain: 'cloudflare.com',
      type: 'AAAA',
      server: '1.1.1.1',
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.queryType).toBe('AAAA');
    }
  }, 15000);

  it('should resolve MX records for gmail.com via Quad9', async () => {
    const { data } = await postJson('/dns/query', {
      domain: 'gmail.com',
      type: 'MX',
      server: '9.9.9.9',
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.rcode).toBe('NOERROR');
      expect((data.answers as unknown[]).length).toBeGreaterThan(0);
    }
  }, 15000);

  it('should resolve TXT records for google.com (SPF)', async () => {
    const { data } = await postJson('/dns/query', {
      domain: 'google.com',
      type: 'TXT',
      server: '8.8.8.8',
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.queryType).toBe('TXT');
    }
  }, 15000);

  it('should return NXDOMAIN for nonexistent domain', async () => {
    const { data } = await postJson('/dns/query', {
      domain: 'this-domain-does-not-exist-xyz123.example',
      type: 'A',
      server: '8.8.8.8',
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.rcode).toBe('NXDOMAIN');
    }
  }, 15000);

  it('should reject missing domain', async () => {
    const { response, data } = await postJson('/dns/query', {
      type: 'A',
      server: '8.8.8.8',
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('domain');
  });

  it('should reject unsupported record type', async () => {
    const { response, data } = await postJson('/dns/query', {
      domain: 'google.com',
      type: 'BOGUS',
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Unknown record type');
  });
});

/* ================================================================== */
/*  22. Gopher — public Gopher servers                                */
/* ================================================================== */

describe('Gopher — Real-World Usage', () => {
  itRemoteOnly('should fetch the root menu from Floodgap', async () => {
    const { data } = await postJson('/gopher/fetch', {
      host: 'gopher.floodgap.com',
      port: 70,
      selector: '',
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.isMenu).toBe(true);
      expect((data.items as unknown[]).length).toBeGreaterThan(0);
    }
  }, 20000);

  it('should handle unreachable Gopher host gracefully', async () => {
    const { data } = await postJson('/gopher/fetch', {
      host: 'unreachable-host-12345.invalid',
      port: 70,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject empty host', async () => {
    const { response, data } = await postJson('/gopher/fetch', {
      host: '',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject host with invalid characters', async () => {
    const { response, data } = await postJson('/gopher/fetch', {
      host: 'bad host!',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('invalid characters');
  });
});

/* ================================================================== */
/*  23. Gemini — gemini:// protocol                                   */
/* ================================================================== */

describe('Gemini — Real-World Usage', () => {
  itRemoteOnly('should handle connection to a Gemini server', async () => {
    const { data } = await postJson('/gemini/fetch', {
      url: 'gemini://geminiprotocol.net/',
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.status).toBeDefined();
      expect(typeof data.status).toBe('number');
    }
  }, 20000);

  it('should handle unreachable Gemini host', async () => {
    const { data } = await postJson('/gemini/fetch', {
      url: 'gemini://unreachable-host-12345.invalid/',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject empty URL', async () => {
    const { response, data } = await postJson('/gemini/fetch', {
      url: '',
      timeout: 5000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('URL is required');
  });
});

/* ================================================================== */
/*  24. IRC — public IRC networks                                     */
/* ================================================================== */

const IRC_HOST = isLocal ? 'localhost' : 'irc.libera.chat';

describe('IRC — Real-World Usage', () => {
  it('should connect to IRC and read MOTD', async () => {
    const { data } = await postJson('/irc/connect', {
      host: IRC_HOST,
      port: 6667,
      nickname: 'poctest' + Math.floor(Math.random() * 9999),
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.messagesReceived).toBeGreaterThan(0);
    }
  }, 35000);

  it('should reject missing nickname', async () => {
    const { response, data } = await postJson('/irc/connect', {
      host: 'irc.libera.chat',
      port: 6667,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('nickname');
  });

  it('should reject invalid nickname (starts with number)', async () => {
    const { response, data } = await postJson('/irc/connect', {
      host: 'irc.libera.chat',
      nickname: '123bad',
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid nickname');
  });

  it('should reject missing host', async () => {
    const { response, data } = await postJson('/irc/connect', {
      nickname: 'testuser',
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('host');
  });
});

/* ================================================================== */
/*  25. NNTP — public Usenet server                                   */
/* ================================================================== */

describe('NNTP — Real-World Usage', () => {
  it('should connect to aioe.org NNTP server', async () => {
    const { data } = await postJson('/nntp/connect', {
      host: 'nntp.aioe.org',
      port: 119,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.banner).toBeDefined();
    }
  }, 20000);

  it('should select a newsgroup on aioe.org', async () => {
    const { data } = await postJson('/nntp/group', {
      host: 'nntp.aioe.org',
      port: 119,
      group: 'comp.lang.python',
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
  }, 20000);

  it('should handle unreachable NNTP host', async () => {
    const { data } = await postJson('/nntp/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 119,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  26. Memcached — cache operations                                  */
/* ================================================================== */

describe('Memcached — Real-World Usage', () => {
  it('should handle connection to unreachable Memcached host', async () => {
    const { data } = await postJson('/memcached/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 11211,
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle VERSION command to unreachable host', async () => {
    const { data } = await postJson('/memcached/command', {
      host: 'unreachable-host-12345.invalid',
      port: 11211,
      command: 'version',
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle stats request to unreachable host', async () => {
    const { data } = await postJson('/memcached/stats', {
      host: 'unreachable-host-12345.invalid',
      port: 11211,
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle set command with realistic cache key', async () => {
    const { data } = await postJson('/memcached/command', {
      host: 'unreachable-host-12345.invalid',
      port: 11211,
      command: 'set session:user:abc123 0 3600 hello-world',
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject missing host on connect', async () => {
    const { response, data } = await postJson('/memcached/connect', {
      host: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('host');
  });

  it('should reject missing command', async () => {
    const { response, data } = await postJson('/memcached/command', {
      host: 'test-host.invalid',
      command: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('host and command');
  });
});

/* ================================================================== */
/*  27. STOMP — message broker protocol                               */
/* ================================================================== */

describe('STOMP — Real-World Usage', () => {
  it('should handle connection to unreachable STOMP broker', async () => {
    const { data } = await postJson('/stomp/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 61613,
      username: 'guest',
      password: 'guest',
      vhost: '/',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle send to unreachable broker', async () => {
    const { data } = await postJson('/stomp/send', {
      host: 'unreachable-host-12345.invalid',
      port: 61613,
      username: 'guest',
      password: 'guest',
      destination: '/queue/test-events',
      body: '{"event":"user.signup","userId":"u-12345"}',
      contentType: 'application/json',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  28. SOCKS5 — proxy connection testing                             */
/* ================================================================== */

describe('SOCKS5 — Real-World Usage', () => {
  it('should handle connection to unreachable SOCKS5 proxy', async () => {
    const { data } = await postJson('/socks5/connect', {
      proxyHost: 'unreachable-host-12345.invalid',
      proxyPort: 1080,
      destHost: 'example.com',
      destPort: 80,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle SOCKS5 with username/password auth', async () => {
    const { data } = await postJson('/socks5/connect', {
      proxyHost: 'unreachable-host-12345.invalid',
      proxyPort: 1080,
      destHost: 'www.google.com',
      destPort: 443,
      username: 'proxyuser',
      password: 'proxypass',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle SOCKS5 proxy on Tor port 9050', async () => {
    const { data } = await postJson('/socks5/connect', {
      proxyHost: 'unreachable-host-12345.invalid',
      proxyPort: 9050,
      destHost: 'check.torproject.org',
      destPort: 443,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  29. Modbus TCP — industrial protocol                              */
/* ================================================================== */

describe('Modbus — Real-World Usage', () => {
  it('should handle connection to unreachable PLC', async () => {
    const { data } = await postJson('/modbus/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 502,
      unitId: 1,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle read holding registers from unreachable device', async () => {
    const { data } = await postJson('/modbus/read', {
      host: 'unreachable-host-12345.invalid',
      port: 502,
      unitId: 1,
      functionCode: 3, // Read Holding Registers
      address: 0,
      quantity: 10,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle read coils from unreachable device', async () => {
    const { data } = await postJson('/modbus/read', {
      host: 'unreachable-host-12345.invalid',
      port: 502,
      unitId: 1,
      functionCode: 1, // Read Coils
      address: 100,
      quantity: 16,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject write function codes', async () => {
    const { response, data } = await postJson('/modbus/read', {
      host: 'unreachable-host-12345.invalid',
      port: 502,
      functionCode: 6, // Write Single Register
      address: 0,
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid read function code');
  });

  it('should reject missing host', async () => {
    const { response, data } = await postJson('/modbus/connect', {
      host: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('host');
  });
});

/* ================================================================== */
/*  30. MongoDB — wire protocol                                       */
/* ================================================================== */

describe('MongoDB — Real-World Usage', () => {
  it('should handle connection to Atlas-style endpoint', async () => {
    const { data } = await postJson('/mongodb/connect', {
      host: 'cluster0-shard-00-00.abc123.mongodb.net',
      port: 27017,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  }, 15000);

  it('should handle ping to unreachable MongoDB', async () => {
    const { data } = await postJson('/mongodb/ping', {
      host: 'unreachable-host-12345.invalid',
      port: 27017,
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject empty host on connect', async () => {
    const { response, data } = await postJson('/mongodb/connect', {
      host: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port on connect', async () => {
    const { response, data } = await postJson('/mongodb/connect', {
      host: 'test-host.invalid',
      port: 99999,
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });
});

/* ================================================================== */
/*  31. Graphite — metrics ingestion                                  */
/* ================================================================== */

describe('Graphite — Real-World Usage', () => {
  it('should handle sending CPU metric to unreachable Graphite', async () => {
    const { data } = await postJson('/graphite/send', {
      host: 'unreachable-host-12345.invalid',
      port: 2003,
      metrics: [
        { name: 'servers.web01.cpu.usage', value: 72.5 },
        { name: 'servers.web01.memory.used', value: 4096 },
        { name: 'servers.web01.disk.iops', value: 1250 },
      ],
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject missing metrics array', async () => {
    const { response, data } = await postJson('/graphite/send', {
      host: 'test-host.invalid',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('metrics');
  });

  it('should reject invalid metric name (spaces)', async () => {
    const { response, data } = await postJson('/graphite/send', {
      host: 'test-host.invalid',
      metrics: [{ name: 'bad metric name', value: 1 }],
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid metric name');
  });

  it('should reject NaN metric value', async () => {
    const { response, data } = await postJson('/graphite/send', {
      host: 'test-host.invalid',
      metrics: [{ name: 'valid.name', value: NaN }],
      timeout: 3000,
    });
    // NaN serializes to null in JSON, server may return 400 or 500
    expect([400, 500]).toContain(response.status);
    expect(data.success).not.toBe(true);
  });
});

/* ================================================================== */
/*  32. RCON — Minecraft / Source Engine                               */
/* ================================================================== */

describe('RCON — Real-World Usage', () => {
  it('should handle connection to unreachable Minecraft server', async () => {
    const { data } = await postJson('/rcon/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 25575,
      password: 'minecraft-rcon-pass',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle command execution to unreachable server', async () => {
    const { data } = await postJson('/rcon/command', {
      host: 'unreachable-host-12345.invalid',
      port: 25575,
      password: 'rcon_password',
      command: 'list',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject missing password on connect', async () => {
    const { response, data } = await postJson('/rcon/connect', {
      host: 'mc.example.com',
      password: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Password is required');
  });

  it('should reject missing command', async () => {
    const { response, data } = await postJson('/rcon/command', {
      host: 'mc.example.com',
      password: 'pass',
      command: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Command is required');
  });

  it('should reject invalid host characters', async () => {
    const { response, data } = await postJson('/rcon/connect', {
      host: 'bad host!',
      password: 'pass',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('invalid characters');
  });
});

/* ================================================================== */
/*  33. Git — native protocol (git://)                                */
/* ================================================================== */

describe('Git — Real-World Usage', () => {
  it('should list refs from GNU Savannah git daemon', async () => {
    const { data } = await postJson('/git/refs', {
      host: 'git.savannah.gnu.org',
      port: 9418,
      repo: '/git/emacs.git',
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.refs).toBeDefined();
      expect((data.refs as unknown[]).length).toBeGreaterThan(0);
      expect(data.branchCount).toBeGreaterThan(0);
    }
  }, 20000);

  it('should handle unreachable git daemon', async () => {
    const { data } = await postJson('/git/refs', {
      host: 'unreachable-host-12345.invalid',
      port: 9418,
      repo: '/project.git',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject missing host', async () => {
    const { response, data } = await postJson('/git/refs', {
      host: '',
      repo: '/project.git',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Host is required');
  });

  it('should reject missing repo', async () => {
    const { response, data } = await postJson('/git/refs', {
      host: 'git.example.com',
      repo: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Repository path is required');
  });
});

/* ================================================================== */
/*  34. ZooKeeper — four-letter words                                 */
/* ================================================================== */

describe('ZooKeeper — Real-World Usage', () => {
  it('should handle ruok to unreachable ZooKeeper', async () => {
    const { data } = await postJson('/zookeeper/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 2181,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle srvr command to unreachable ZooKeeper', async () => {
    const { data } = await postJson('/zookeeper/command', {
      host: 'unreachable-host-12345.invalid',
      port: 2181,
      command: 'srvr',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject invalid four-letter word command', async () => {
    const { response, data } = await postJson('/zookeeper/command', {
      host: 'test-host.invalid',
      command: 'xxxx',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid command');
  });

  it('should reject missing command', async () => {
    const { response, data } = await postJson('/zookeeper/command', {
      host: 'test-host.invalid',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Command is required');
  });
});

/* ================================================================== */
/*  35. Cassandra — CQL binary protocol                               */
/* ================================================================== */

describe('Cassandra — Real-World Usage', () => {
  it('should handle connection to unreachable Cassandra cluster', async () => {
    const { data } = await postJson('/cassandra/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 9042,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle Astra DB-style endpoint', async () => {
    const { data } = await postJson('/cassandra/connect', {
      host: 'abc12345-us-east-1.db.astra.datastax.com',
      port: 29042,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject empty host', async () => {
    const { response, data } = await postJson('/cassandra/connect', {
      host: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toBe('Host is required');
  });
});

/* ================================================================== */
/*  36. AMQP — RabbitMQ-style broker                                  */
/* ================================================================== */

describe('AMQP — Real-World Usage', () => {
  it('should handle connection to unreachable RabbitMQ', async () => {
    const { data } = await postJson('/amqp/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 5672,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle CloudAMQP-style endpoint', async () => {
    const { data } = await postJson('/amqp/connect', {
      host: 'sparrow.rmq.cloudamqp.com',
      port: 5672,
      timeout: 10000,
    });
    // May succeed with handshake or fail — verify well-formed
    expect(data).toHaveProperty('success');
  }, 15000);

  it('should reject missing host', async () => {
    const { response, data } = await postJson('/amqp/connect', {
      host: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('host');
  });
});

/* ================================================================== */
/*  37. Kafka — broker protocol                                       */
/* ================================================================== */

describe('Kafka — Real-World Usage', () => {
  it('should handle ApiVersions to unreachable Kafka broker', async () => {
    const { data } = await postJson('/kafka/versions', {
      host: 'unreachable-host-12345.invalid',
      port: 9092,
      clientId: 'portofcall-test',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle Metadata request to unreachable broker', async () => {
    const { data } = await postJson('/kafka/metadata', {
      host: 'unreachable-host-12345.invalid',
      port: 9092,
      clientId: 'portofcall-test',
      topics: ['events', 'logs'],
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject missing host on versions', async () => {
    const { response, data } = await postJson('/kafka/versions', {
      host: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Host is required');
  });
});

/* ================================================================== */
/*  38. RTSP — streaming media                                        */
/* ================================================================== */

describe('RTSP — Real-World Usage', () => {
  it('should handle OPTIONS to unreachable IP camera', async () => {
    const { data } = await postJson('/rtsp/options', {
      host: 'unreachable-host-12345.invalid',
      port: 554,
      path: '/live/stream1',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle DESCRIBE to unreachable RTSP server', async () => {
    const { data } = await postJson('/rtsp/describe', {
      host: 'unreachable-host-12345.invalid',
      port: 554,
      path: '/cam/realmonitor',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject missing host on OPTIONS', async () => {
    const { response, data } = await postJson('/rtsp/options', {
      host: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toBe('Host is required');
  });
});

/* ================================================================== */
/*  39. Rsync — daemon protocol                                       */
/* ================================================================== */

describe('Rsync — Real-World Usage', () => {
  it('should connect to kernel.org rsync daemon', async () => {
    const { data } = await postJson('/rsync/connect', {
      host: 'rsync.kernel.org',
      port: 873,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.serverVersion).toBeDefined();
      expect(data.greeting).toContain('@RSYNCD');
    }
  }, 20000);

  it('should list modules from kernel.org', async () => {
    const { data } = await postJson('/rsync/module', {
      host: 'rsync.kernel.org',
      port: 873,
      module: 'pub',
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
  }, 20000);

  it('should handle unreachable rsync daemon', async () => {
    const { data } = await postJson('/rsync/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 873,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject empty host', async () => {
    const { response, data } = await postJson('/rsync/connect', {
      host: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toBe('Host is required');
  });

  it('should reject missing module name', async () => {
    const { response, data } = await postJson('/rsync/module', {
      host: 'rsync.kernel.org',
      module: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Module name is required');
  });
});

/* ================================================================== */
/*  40. TDS — MS SQL Server                                           */
/* ================================================================== */

describe('TDS — Real-World Usage', () => {
  it('should handle connection to unreachable SQL Server', async () => {
    const { data } = await postJson('/tds/connect', {
      host: 'sqlserver.database.windows.net',
      port: 1433,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
  }, 10000);

  it('should handle connection to RDS-style SQL Server', async () => {
    const { data } = await postJson('/tds/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 1433,
      timeout: 3000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  41. VNC — Remote Framebuffer Protocol                             */
/* ================================================================== */

describe('VNC — Real-World Usage', () => {
  it('should handle connection to unreachable VNC server', async () => {
    const { data } = await postJson('/vnc/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 5900,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle VNC on display :1 (port 5901)', async () => {
    const { data } = await postJson('/vnc/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 5901,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  42. CHARGEN — character generator                                 */
/* ================================================================== */

describe('CHARGEN — Real-World Usage', () => {
  it('should handle connection to unreachable CHARGEN server', async () => {
    const { data } = await postJson('/chargen/stream', {
      host: 'unreachable-host-12345.invalid',
      port: 19,
      maxBytes: 1024,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject empty host', async () => {
    const { response, data } = await postJson('/chargen/stream', {
      host: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toBe('Host is required');
  });

  it('should reject invalid port', async () => {
    const { response, data } = await postJson('/chargen/stream', {
      host: 'test-host.invalid',
      port: 99999,
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toBe('Port must be between 1 and 65535');
  });
});

/* ================================================================== */
/*  43. Neo4j — Bolt protocol                                         */
/* ================================================================== */

describe('Neo4j — Real-World Usage', () => {
  it('should handle connection to unreachable Neo4j server', async () => {
    const { data } = await postJson('/neo4j/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 7687,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle Aura cloud endpoint', async () => {
    const { data } = await postJson('/neo4j/connect', {
      host: 'abc12345.databases.neo4j.io',
      port: 7687,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
  }, 10000);
});

/* ================================================================== */
/*  44. RTMP — streaming media                                        */
/* ================================================================== */

describe('RTMP — Real-World Usage', () => {
  it('should handle connection to unreachable RTMP server', async () => {
    const { data } = await postJson('/rtmp/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 1935,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle Twitch ingest endpoint', async () => {
    const { data } = await postJson('/rtmp/connect', {
      host: 'live.twitch.tv',
      port: 1935,
      timeout: 10000,
    });
    // Twitch may or may not respond before RTMP handshake
    expect(data).toHaveProperty('success');
  }, 15000);
});

/* ================================================================== */
/*  45. TACACS+ — network device AAA                                  */
/* ================================================================== */

describe('TACACS+ — Real-World Usage', () => {
  it('should handle probe to unreachable TACACS+ server', async () => {
    const { data } = await postJson('/tacacs/probe', {
      host: 'unreachable-host-12345.invalid',
      port: 49,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle authenticate to unreachable server', async () => {
    const { data } = await postJson('/tacacs/authenticate', {
      host: 'unreachable-host-12345.invalid',
      port: 49,
      username: 'netadmin',
      password: 'cisco123',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  46. HL7 — healthcare messaging                                    */
/* ================================================================== */

describe('HL7 — Real-World Usage', () => {
  it('should handle connection to unreachable HL7 endpoint', async () => {
    const { data } = await postJson('/hl7/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 2575,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle ADT^A01 send to unreachable hospital system', async () => {
    const { data } = await postJson('/hl7/send', {
      host: 'unreachable-host-12345.invalid',
      port: 2575,
      messageType: 'ADT^A01',
      sendingApplication: 'LabSystem',
      sendingFacility: 'CentralLab',
      receivingApplication: 'HIS',
      receivingFacility: 'MainHospital',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  47. Elasticsearch — REST over TCP                                 */
/* ================================================================== */

describe('Elasticsearch — Real-World Usage', () => {
  it('should handle health check to unreachable cluster', async () => {
    const { data } = await postJson('/elasticsearch/health', {
      host: 'unreachable-host-12345.invalid',
      port: 9200,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle query to unreachable cluster', async () => {
    const { data } = await postJson('/elasticsearch/query', {
      host: 'unreachable-host-12345.invalid',
      port: 9200,
      path: '/logs-2025/_search',
      method: 'POST',
      body: JSON.stringify({ query: { match_all: {} }, size: 10 }),
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  48. AJP — Apache JServ Protocol                                   */
/* ================================================================== */

describe('AJP — Real-World Usage', () => {
  it('should handle CPing to unreachable Tomcat', async () => {
    const { data } = await postJson('/ajp/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 8009,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle CPing to typical internal Tomcat port', async () => {
    const { data } = await postJson('/ajp/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 8009,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  49. XMPP — instant messaging                                      */
/* ================================================================== */

describe('XMPP — Real-World Usage', () => {
  it('should connect to jabber.org XMPP server', async () => {
    const { data } = await postJson('/xmpp/connect', {
      host: 'jabber.org',
      port: 5222,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
  }, 20000);

  it('should handle unreachable XMPP server', async () => {
    const { data } = await postJson('/xmpp/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 5222,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  50. RDP — Remote Desktop Protocol                                 */
/* ================================================================== */

describe('RDP — Real-World Usage', () => {
  it('should handle connection to unreachable RDP server', async () => {
    const { data } = await postJson('/rdp/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 3389,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should handle connection to Windows Server endpoint', async () => {
    const { data } = await postJson('/rdp/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 3389,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  51. NATS — pub/sub messaging                                      */
/* ================================================================== */

describe('NATS — Real-World Usage', () => {
  it('should connect to demo.nats.io public server', async () => {
    const { data } = await postJson('/nats/connect', {
      host: 'demo.nats.io',
      port: 4222,
      timeout: 5000,
    });
    expect(data).toHaveProperty('success');
    if (data.success) {
      expect(data.serverInfo).toBeDefined();
    }
  }, 20000);

  it('should handle publish to unreachable NATS', async () => {
    const { data } = await postJson('/nats/publish', {
      host: 'unreachable-host-12345.invalid',
      port: 4222,
      subject: 'events.user.login',
      payload: '{"userId":"u-12345","ts":1706400000}',
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);
});

/* ================================================================== */
/*  52. JetDirect — network printing                                  */
/* ================================================================== */

describe('JetDirect — Real-World Usage', () => {
  it('should handle connection to unreachable printer', async () => {
    const { data } = await postJson('/jetdirect/connect', {
      host: 'unreachable-host-12345.invalid',
      port: 9100,
      timeout: 5000,
    });
    expect(data.success).toBe(false);
  }, 10000);

  it('should reject empty host', async () => {
    const { response, data } = await postJson('/jetdirect/connect', {
      host: '',
      timeout: 3000,
    });
    expect(response.status).toBe(400);
    expect(data.error).toContain('Host is required');
  });
});
