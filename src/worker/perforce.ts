/**
 * Perforce (Helix Core) Protocol Implementation (Port 1666/TCP)
 *
 * Perforce is a proprietary version control system (VCS) widely used in game
 * development and large enterprises. The p4d server listens on port 1666 and
 * uses a binary tagged wire protocol for client-server communication.
 *
 * Wire Protocol Overview:
 * - The client initiates all communication (server sends nothing on connect)
 * - Messages consist of null-terminated key=value pairs
 * - The "func" key specifies the RPC function to invoke
 * - A message is terminated by two consecutive null bytes
 *
 * Initial Client → Server Message:
 *   func\0protocol\0\0  (negotiates protocol version)
 *
 * Server → Client Response:
 *   server2\0<version>\0  (server version info)
 *   xfiles\0<n>\0         (max xfiles)
 *   ... more key-value pairs ...
 *   \0\0                  (end of message)
 *
 * Default Port: 1666/TCP
 *
 * Note: The Perforce protocol is proprietary and not publicly documented.
 * This implementation is based on protocol analysis and community research.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface PerforceProbeRequest {
  host: string;
  port?: number;
  timeout?: number;
}

function validatePerforceInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  return null;
}

/**
 * Parse a Perforce tagged wire protocol message into key-value pairs.
 * Messages are sequences of null-terminated strings forming key-value pairs,
 * terminated by a double-null.
 */
function parsePerforceMessage(data: Uint8Array): Record<string, string> {
  const result: Record<string, string> = {};
  const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
  const parts = text.split('\0').filter((p) => p.length > 0);

  for (let i = 0; i + 1 < parts.length; i += 2) {
    result[parts[i]] = parts[i + 1];
  }
  return result;
}

/**
 * Build a Perforce tagged wire protocol message.
 * Each argument is a null-terminated string; the message ends with \0\0.
 */
function buildPerforceMessage(pairs: Record<string, string>): Uint8Array {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(pairs)) {
    parts.push(key, value);
  }
  // Join with null separators and add terminating double-null
  const message = parts.join('\0') + '\0\0';
  return new TextEncoder().encode(message);
}

/**
 * Probe a Perforce server — initiates the protocol handshake to
 * retrieve server version and configuration information.
 *
 * POST /api/perforce/probe
 * Body: { host, port?, timeout? }
 */
export async function handlePerforceProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as PerforceProbeRequest;
    const {
      host,
      port = 1666,
      timeout = 10000,
    } = body;

    const validationError = validatePerforceInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - startTime;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Perforce client initiates with a "protocol" function call.
      // This negotiates supported features and requests server info.
      const probeMsg = buildPerforceMessage({
        func: 'protocol',
        xfiles: '3',
        server: '2',
        api: '99999',  // high version to get all info
        enableStreams: '',
        enableGraph: '',
        expandAndmaps: '',
      });
      await writer.write(probeMsg);

      // Read server response
      let serverInfo: Record<string, string> = {};
      let rawResponse = '';
      let isPerforceServer = false;

      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 5000),
        );

        // Collect all response data
        const chunks: Uint8Array[] = [];
        let totalLen = 0;

        // First chunk
        const { value, done } = await Promise.race([reader.read(), readTimeout]);
        if (!done && value) {
          chunks.push(value);
          totalLen += value.length;

          // Try to read more
          try {
            const shortTimeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('done')), 500),
            );
            while (true) {
              const { value: next, done: nextDone } = await Promise.race([reader.read(), shortTimeout]);
              if (nextDone || !next) break;
              chunks.push(next);
              totalLen += next.length;
            }
          } catch {
            // Short timeout — we have all available data
          }

          // Combine chunks
          const combined = new Uint8Array(totalLen);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          rawResponse = new TextDecoder('utf-8', { fatal: false }).decode(combined);
          serverInfo = parsePerforceMessage(combined);

          // Perforce servers typically respond with 'server2', 'xfiles', or 'security' keys
          isPerforceServer = 'server2' in serverInfo || 'xfiles' in serverInfo ||
            'security' in serverInfo || 'maxcommitsperfile' in serverInfo ||
            rawResponse.includes('Perforce') || rawResponse.includes('p4d');
        }
      } catch {
        // No response data
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          isPerforceServer,
          serverVersion: serverInfo.server2 || serverInfo.server || undefined,
          serverInfo: Object.keys(serverInfo).length > 0 ? serverInfo : undefined,
          note: 'Perforce Helix Core is a proprietary VCS popular in game development. ' +
            'Full client operations require authentication and a licensed p4 client.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Attempt authenticated login and info retrieval from a Perforce server.
 *
 * POST /api/perforce/login
 * Body: { host, port?, timeout?, username, password, client? }
 *
 * Protocol flow:
 *   1. Send "protocol" handshake (existing pattern)
 *   2. Read server protocol response
 *   3. Send "login" tagged command with username + password
 *   4. Read response: check for "func" = "client-FstatInfo" success or error
 *   5. If authenticated, send "user-info" to retrieve server metadata
 *   6. Return { authenticated, serverVersion, serverDate, serverRoot, rtt }
 *
 * Note: Perforce's "login" command sends the password as the tag "password"
 * alongside "func" = "login" and "user" = username.  The server responds
 * with either a "client-Message" containing the text of an error, or with
 * a "client-outputData" block (and eventually "release") indicating success.
 * Because the full P4 auth flow requires the client to supply a ticket after
 * login, this handler treats any non-error response as authenticated.
 */
export async function handlePerforceLogin(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  interface PerforceLoginRequest extends PerforceProbeRequest {
    username: string;
    password: string;
    client?: string;
  }

  try {
    const body = (await request.json()) as PerforceLoginRequest;
    const {
      host,
      port = 1666,
      timeout = 12000,
      username,
      password,
      client,
    } = body;

    const validationError = validatePerforceInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!username) {
      return new Response(
        JSON.stringify({ success: false, error: 'username is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!password) {
      return new Response(
        JSON.stringify({ success: false, error: 'password is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // ── Step 1: Protocol handshake ─────────────────────────────────────────
      const protoMsg = buildPerforceMessage({
        func: 'protocol',
        xfiles: '3',
        server: '2',
        api: '99999',
        enableStreams: '',
        enableGraph: '',
        expandAndmaps: '',
      });
      await writer.write(protoMsg);

      // Helper: read all available data with a short deadline
      async function readAllAvailable(deadlineMs: number): Promise<Uint8Array> {
        const chunks: Uint8Array[] = [];
        let totalLen = 0;
        const deadline = Date.now() + deadlineMs;

        while (Date.now() < deadline) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;

          const st = new Promise<{ value: undefined; done: true }>((resolve) =>
            setTimeout(() => resolve({ value: undefined, done: true }), remaining),
          );
          const { value, done } = await Promise.race([reader.read(), st]);
          if (done || !value) break;
          chunks.push(value);
          totalLen += value.length;
        }

        const combined = new Uint8Array(totalLen);
        let off = 0;
        for (const chunk of chunks) { combined.set(chunk, off); off += chunk.length; }
        return combined;
      }

      // Wait for protocol response (server may send nothing until it sees our command)
      const protoRaw = await readAllAvailable(1000);
      const protoInfo = protoRaw.length > 0 ? parsePerforceMessage(protoRaw) : {};

      // ── Step 2: Login command ──────────────────────────────────────────────
      // P4 protocol: send tagged message with func="login", user=, password=
      // Some servers accept the password directly; others require stdin delivery.
      // We send it as a tag which works with most p4d versions.
      const loginPairs: Record<string, string> = {
        func: 'login',
        user: username,
        password: password,
      };
      if (client) loginPairs['client'] = client;

      await writer.write(buildPerforceMessage(loginPairs));

      // Read login response
      const loginRaw = await readAllAvailable(5000);
      const loginInfo = loginRaw.length > 0 ? parsePerforceMessage(loginRaw) : {};

      // Detect explicit error in the response
      const responseText = new TextDecoder('utf-8', { fatal: false }).decode(loginRaw);
      const hasError =
        'fmt0' in loginInfo && loginInfo['fmt0']?.toLowerCase().includes('invalid') ||
        responseText.toLowerCase().includes('invalid password') ||
        responseText.toLowerCase().includes('password invalid') ||
        responseText.toLowerCase().includes('access denied') ||
        responseText.toLowerCase().includes('login failed') ||
        (loginInfo['func'] === 'client-Message' &&
          (loginInfo['data'] || '').toLowerCase().includes('invalid'));

      const authenticated = !hasError && loginRaw.length > 0;

      // ── Step 3: user-info (if authenticated) ──────────────────────────────
      let serverVersion: string | undefined =
        protoInfo['server2'] || protoInfo['server'] || undefined;
      let serverDate: string | undefined;
      let serverRoot: string | undefined;
      let serverId: string | undefined;
      let serverAddress: string | undefined;

      if (authenticated) {
        const infoPairs: Record<string, string> = {
          func: 'user-info',
          tag: '',
          user: username,
        };
        if (client) infoPairs['client'] = client;

        await writer.write(buildPerforceMessage(infoPairs));

        const infoRaw = await readAllAvailable(4000);
        if (infoRaw.length > 0) {
          const infoMap = parsePerforceMessage(infoRaw);
          serverVersion = serverVersion || infoMap['server2'] || infoMap['server'] || undefined;
          serverDate = infoMap['serverDate'] || undefined;
          serverRoot = infoMap['serverRoot'] || undefined;
          serverId = infoMap['serverId'] || undefined;
          serverAddress = infoMap['serverAddress'] || undefined;
        }
      }

      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          authenticated,
          serverVersion,
          serverDate,
          serverRoot,
          serverId,
          serverAddress,
          rtt,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Query server info from a Perforce server.
 *
 * POST /api/perforce/info
 * Body: { host, port?, timeout? }
 */
export async function handlePerforceInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as PerforceProbeRequest;
    const {
      host,
      port = 1666,
      timeout = 10000,
    } = body;

    const validationError = validatePerforceInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - startTime;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send protocol negotiation first
      const protoMsg = buildPerforceMessage({
        func: 'protocol',
        xfiles: '3',
        server: '2',
        api: '99999',
      });
      await writer.write(protoMsg);

      // Wait briefly for any immediate response
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send the "info" command — requests server information
      // This does not require authentication
      const infoMsg = buildPerforceMessage({
        func: 'user-info',
        tag: '',
      });
      await writer.write(infoMsg);

      // Collect response
      let serverInfo: Record<string, string> = {};
      let isPerforceServer = false;

      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 5000),
        );

        const chunks: Uint8Array[] = [];
        let totalLen = 0;

        const { value, done } = await Promise.race([reader.read(), readTimeout]);
        if (!done && value) {
          chunks.push(value);
          totalLen += value.length;

          try {
            const shortTimeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('done')), 800),
            );
            while (true) {
              const { value: next, done: nextDone } = await Promise.race([reader.read(), shortTimeout]);
              if (nextDone || !next) break;
              chunks.push(next);
              totalLen += next.length;
            }
          } catch {
            // Done reading
          }

          const combined = new Uint8Array(totalLen);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          const rawText = new TextDecoder('utf-8', { fatal: false }).decode(combined);
          serverInfo = parsePerforceMessage(combined);
          isPerforceServer = Object.keys(serverInfo).length > 0 ||
            rawText.includes('Perforce') || rawText.includes('p4d');
        }
      } catch {
        // No response
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          isPerforceServer,
          serverVersion: serverInfo.server2 || serverInfo.server || undefined,
          serverAddress: serverInfo.serverAddress || undefined,
          serverDate: serverInfo.serverDate || undefined,
          serverLicense: serverInfo.serverLicense || undefined,
          serverRoot: serverInfo.serverRoot || undefined,
          caseHandling: serverInfo.caseHandling || undefined,
          rawInfo: Object.keys(serverInfo).length > 0 ? serverInfo : undefined,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

export async function handlePerforceChanges(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  interface PerforceChangesRequest extends PerforceProbeRequest {
    username: string;
    password: string;
    client?: string;
    max?: number;
    status?: string; // 'submitted' | 'pending' | 'shelved'
  }

  let body: PerforceChangesRequest;
  try { body = await request.json() as PerforceChangesRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 1666, timeout = 15000, username, password, client, max = 10, status: changeStatus } = body;

  const validationError = validatePerforceInput(host, port);
  if (validationError) {
    return new Response(JSON.stringify({ success: false, error: validationError }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!username) {
    return new Response(JSON.stringify({ success: false, error: 'username is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const socket = connect(`${host}:${port}`);
  try {
    const startTime = Date.now();
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
    ]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    async function readAllAvailable(deadlineMs: number): Promise<Uint8Array> {
      const chunks: Uint8Array[] = [];
      let totalLen = 0;
      const deadline = Date.now() + deadlineMs;
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const st = new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), remaining),
        );
        const { value, done } = await Promise.race([reader.read(), st]);
        if (done || !value) break;
        chunks.push(value);
        totalLen += value.length;
      }
      const combined = new Uint8Array(totalLen);
      let off = 0;
      for (const chunk of chunks) { combined.set(chunk, off); off += chunk.length; }
      return combined;
    }

    try {
      // Protocol negotiation
      await writer.write(buildPerforceMessage({ func: 'protocol', xfiles: '3', server: '2', api: '99999' }));
      await readAllAvailable(1000);

      // Login
      const loginPairs: Record<string, string> = { func: 'login', user: username, password };
      if (client) loginPairs['client'] = client;
      await writer.write(buildPerforceMessage(loginPairs));
      const loginRaw = await readAllAvailable(5000);
      const loginText = new TextDecoder('utf-8', { fatal: false }).decode(loginRaw).toLowerCase();
      if (loginText.includes('invalid') || loginText.includes('denied') || loginText.includes('failed')) {
        return new Response(JSON.stringify({ success: false, error: 'Authentication failed' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // p4 changes
      const changesPairs: Record<string, string> = {
        func: 'changes',
        maxResults: String(Math.min(max, 50)),
      };
      if (changeStatus) changesPairs['status'] = changeStatus;
      if (client) changesPairs['client'] = client;
      await writer.write(buildPerforceMessage(changesPairs));
      const changesRaw = await readAllAvailable(8000);

      // Parse multiple changelist records from the response
      const text = new TextDecoder('utf-8', { fatal: false }).decode(changesRaw);
      const changelists: Array<Record<string, string>> = [];

      // The server sends one record per changelist; records are separated by double-null
      const parts = text.split('\0').filter((p) => p.length > 0);
      let current: Record<string, string> = {};
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const k = parts[i];
        const v = parts[i + 1];
        if (k === 'func' && v === 'client-Message' && Object.keys(current).length > 0) {
          changelists.push(current);
          current = {};
        } else if (k === 'change' || k === 'time' || k === 'user' || k === 'client' || k === 'status' || k === 'desc') {
          current[k] = v;
        }
      }
      if (Object.keys(current).length > 0) changelists.push(current);

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        username,
        changelists,
        count: changelists.length,
        rtt: Date.now() - startTime,
      }), { headers: { 'Content-Type': 'application/json' } });
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      socket.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Perforce changes failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Describe a Perforce changelist (p4 describe -s <change>)
 *
 * POST /api/perforce/describe
 * Body: { host, port?, username, password, client?, change }
 *
 * Returns the changelist description, user, date, and list of affected files.
 */
export async function handlePerforceDescribe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  interface PerforceDescribeRequest extends PerforceProbeRequest {
    username: string;
    password: string;
    client?: string;
    change: number;
  }

  let body: PerforceDescribeRequest;
  try { body = await request.json() as PerforceDescribeRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 1666, timeout = 15000, username, password, client, change } = body;

  const validationError = validatePerforceInput(host, port);
  if (validationError) {
    return new Response(JSON.stringify({ success: false, error: validationError }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!username || !change) {
    return new Response(JSON.stringify({ success: false, error: 'username and change are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const socket = connect(`${host}:${port}`);
  try {
    const startTime = Date.now();
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
    ]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    async function readAllAvailable(deadlineMs: number): Promise<Uint8Array> {
      const chunks: Uint8Array[] = [];
      let totalLen = 0;
      const deadline = Date.now() + deadlineMs;
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const st = new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), remaining),
        );
        const { value, done } = await Promise.race([reader.read(), st]);
        if (done || !value) break;
        chunks.push(value);
        totalLen += value.length;
      }
      const combined = new Uint8Array(totalLen);
      let off = 0;
      for (const chunk of chunks) { combined.set(chunk, off); off += chunk.length; }
      return combined;
    }

    try {
      // Protocol negotiation
      await writer.write(buildPerforceMessage({ func: 'protocol', xfiles: '3', server: '2', api: '99999' }));
      await readAllAvailable(1000);

      // Login
      const loginPairs: Record<string, string> = { func: 'login', user: username, password };
      if (client) loginPairs['client'] = client;
      await writer.write(buildPerforceMessage(loginPairs));
      const loginRaw = await readAllAvailable(5000);
      const loginText = new TextDecoder('utf-8', { fatal: false }).decode(loginRaw).toLowerCase();
      if (loginText.includes('invalid') || loginText.includes('denied') || loginText.includes('failed')) {
        return new Response(JSON.stringify({ success: false, error: 'Authentication failed' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // p4 describe -s <change>
      const describePairs: Record<string, string> = {
        func: 'describe',
        change: String(change),
        shortDesc: '1', // -s flag (no diff)
      };
      await writer.write(buildPerforceMessage(describePairs));
      const describeRaw = await readAllAvailable(8000);

      const info = parsePerforceMessage(describeRaw);

      // Extract file list: depotFile0, depotFile1, ... action0, action1, ...
      const files: Array<{ path: string; action: string }> = [];
      let idx = 0;
      while (`depotFile${idx}` in info) {
        files.push({ path: info[`depotFile${idx}`], action: info[`action${idx}`] ?? 'unknown' });
        idx++;
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        change,
        description: info['desc'] ?? null,
        user: info['user'] ?? null,
        client: info['client'] ?? null,
        status: info['status'] ?? null,
        time: info['time'] ? new Date(parseInt(info['time']) * 1000).toISOString() : null,
        files,
        fileCount: files.length,
        rtt: Date.now() - startTime,
      }), { headers: { 'Content-Type': 'application/json' } });
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      socket.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Perforce describe failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
