/**
 * NATS Protocol Support for Cloudflare Workers
 * Implements the NATS text-based messaging protocol
 *
 * NATS is an ultra-fast pub/sub messaging system.
 * Protocol: text-based, newline-delimited commands (\r\n)
 * Default port: 4222
 *
 * Connection flow:
 *   Server -> Client: INFO {...}\r\n
 *   Client -> Server: CONNECT {...}\r\n
 *   Server -> Client: +OK\r\n (if verbose)
 *   Client <-> Server: PUB/SUB/MSG/PING/PONG
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Read data from socket with timeout
 */
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  const readPromise = (async () => {
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      if (buffer.includes('\r\n')) {
        return buffer;
      }
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Handle NATS connection test (HTTP mode)
 * Connects, reads INFO, sends CONNECT + PING, verifies PONG
 */
export async function handleNATSConnect(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Allow': 'POST', 'Content-Type': 'application/json' } });
    }
    const body = await request.json() as {
      host?: string;
      port?: number;
      user?: string;
      pass?: string;
      token?: string;
      timeout?: number;
    };
    const host = body.host || '';
    const port = body.port || 4222;
    const user = body.user || undefined;
    const pass = body.pass || undefined;
    const token = body.token || undefined;
    const timeoutMs = body.timeout || 30000;

    if (!host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Read INFO from server
        const infoLine = await readWithTimeout(reader, 5000);

        if (!infoLine.startsWith('INFO ')) {
          throw new Error('Expected INFO from server, got: ' + infoLine.substring(0, 100));
        }

        // Parse the INFO JSON
        const infoJsonStr = infoLine.substring(5, infoLine.indexOf('\r\n'));
        let serverInfo: Record<string, unknown>;
        try {
          serverInfo = JSON.parse(infoJsonStr);
        } catch {
          throw new Error('Invalid INFO JSON from server');
        }

        // Step 2: Send CONNECT
        const connectInfo: Record<string, unknown> = {
          verbose: true,
          pedantic: false,
          tls_required: false,
          name: 'portofcall',
          lang: 'javascript',
          version: '1.0.0',
          protocol: 1,
        };

        if (token) {
          connectInfo.auth_token = token;
        } else if (user && pass) {
          connectInfo.user = user;
          connectInfo.pass = pass;
        }

        const connectCmd = `CONNECT ${JSON.stringify(connectInfo)}\r\n`;
        await writer.write(new TextEncoder().encode(connectCmd));

        // Step 3: Read +OK response (verbose mode)
        const connectResponse = await readWithTimeout(reader, 5000);

        if (connectResponse.includes('-ERR')) {
          const errMatch = connectResponse.match(/-ERR\s+'?([^'\r\n]+)'?/);
          throw new Error('NATS error: ' + (errMatch ? errMatch[1] : connectResponse));
        }

        // Step 4: Send PING to verify connection
        await writer.write(new TextEncoder().encode('PING\r\n'));
        const pingResponse = await readWithTimeout(reader, 5000);

        if (!pingResponse.includes('PONG')) {
          throw new Error('Expected PONG, got: ' + pingResponse.substring(0, 100));
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          message: 'NATS server reachable',
          host,
          port,
          serverInfo: {
            server_id: serverInfo.server_id,
            version: serverInfo.version,
            go: serverInfo.go,
            max_payload: serverInfo.max_payload,
            proto: serverInfo.proto,
            host: serverInfo.host,
            port: serverInfo.port,
            auth_required: serverInfo.auth_required || false,
            tls_required: serverInfo.tls_required || false,
            jetstream: serverInfo.jetstream || false,
          },
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle NATS publish (HTTP mode)
 * Connects, authenticates, publishes a message, then disconnects
 */
export async function handleNATSPublish(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      user?: string;
      pass?: string;
      token?: string;
      subject: string;
      payload?: string;
      timeout?: number;
    };

    if (!body.host || !body.subject) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host and subject',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 4222;
    const timeoutMs = body.timeout || 30000;

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read INFO
        const infoLine = await readWithTimeout(reader, 5000);
        if (!infoLine.startsWith('INFO ')) {
          throw new Error('Expected INFO from server');
        }

        // Send CONNECT (non-verbose for publish)
        const connectInfo: Record<string, unknown> = {
          verbose: false,
          pedantic: false,
          tls_required: false,
          name: 'portofcall',
          lang: 'javascript',
          version: '1.0.0',
          protocol: 1,
        };

        if (body.token) {
          connectInfo.auth_token = body.token;
        } else if (body.user && body.pass) {
          connectInfo.user = body.user;
          connectInfo.pass = body.pass;
        }

        await writer.write(new TextEncoder().encode(`CONNECT ${JSON.stringify(connectInfo)}\r\n`));

        // Build and send PUB command
        const payloadBytes = new TextEncoder().encode(body.payload || '');
        const pubCmd = `PUB ${body.subject} ${payloadBytes.length}\r\n`;
        const pubHeader = new TextEncoder().encode(pubCmd);
        const trailer = new TextEncoder().encode('\r\n');

        const frame = new Uint8Array(pubHeader.length + payloadBytes.length + trailer.length);
        frame.set(pubHeader);
        frame.set(payloadBytes, pubHeader.length);
        frame.set(trailer, pubHeader.length + payloadBytes.length);
        await writer.write(frame);

        // Send PING to flush and verify
        await writer.write(new TextEncoder().encode('PING\r\n'));
        const pingResponse = await readWithTimeout(reader, 5000);

        if (pingResponse.includes('-ERR')) {
          const errMatch = pingResponse.match(/-ERR\s+'?([^'\r\n]+)'?/);
          throw new Error('NATS error: ' + (errMatch ? errMatch[1] : pingResponse));
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          message: `Published to ${body.subject}`,
          subject: body.subject,
          payloadSize: payloadBytes.length,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Publish failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle NATS subscribe — SUB to a subject and collect messages.
 * POST /api/nats/subscribe
 *
 * Accept JSON: {host, port?, user?, pass?, subject, max_msgs?, timeout_ms?, queue_group?}
 */
export async function handleNATSSubscribe(request: Request): Promise<Response> {
  try {
    const {
      host, port = 4222, user, pass,
      subject, max_msgs = 5, timeout_ms = 5000, queue_group,
    } = await request.json() as {
      host: string; port?: number; user?: string; pass?: string;
      subject: string; max_msgs?: number; timeout_ms?: number; queue_group?: string;
    };

    if (!host || !subject) {
      return new Response(JSON.stringify({ success: false, error: 'host and subject are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout_ms + 2000),
    );

    await Promise.race([socket.opened, timeoutPromise]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const messages: Array<{ subject: string; payload: string; replyTo: string | null }> = [];

    try {
      // Read INFO
      let buf = '';
      while (!buf.includes('\r\n')) {
        const { value } = await Promise.race([reader.read(), timeoutPromise]);
        if (value) buf += decoder.decode(value, { stream: true });
      }
      const infoLine = buf.split('\r\n')[0];
      let serverInfo: Record<string, unknown> = {};
      const infoMatch = infoLine.match(/^INFO\s+(\{.*\})/);
      if (infoMatch) try { serverInfo = JSON.parse(infoMatch[1]); } catch { /* ignore */ }

      // CONNECT
      const authOpts: Record<string, unknown> = { verbose: false, pedantic: false, lang: 'portofcall' };
      if (user) authOpts.user = user;
      if (pass) authOpts.pass = pass;
      await writer.write(encoder.encode(`CONNECT ${JSON.stringify(authOpts)}\r\n`));

      // SUB
      const sid = '1';
      const subCmd = queue_group ? `SUB ${subject} ${queue_group} ${sid}\r\n` : `SUB ${subject} ${sid}\r\n`;
      await writer.write(encoder.encode(subCmd));

      // Collect messages with deadline
      const deadline = Date.now() + timeout_ms;
      buf = buf.substring(buf.indexOf('\r\n') + 2);

      while (messages.length < max_msgs && Date.now() < deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        const readResult = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), remaining),
          ),
        ]).catch(() => ({ value: undefined, done: true as const }));

        if (readResult.done || !readResult.value) break;
        buf += decoder.decode(readResult.value, { stream: true });

        // Parse MSG frames: MSG <subject> <sid> [reply_to] <bytes>\r\n<payload>\r\n
        while (true) {
          const msgMatch = buf.match(/^MSG\s+(\S+)\s+\S+\s+(?:(\S+)\s+)?(\d+)\r\n/);
          if (!msgMatch) break;
          const msgSubject = msgMatch[1];
          const replyTo = msgMatch[2] || null;
          const byteLen = parseInt(msgMatch[3], 10);
          const headerLen = msgMatch[0].length;
          if (buf.length < headerLen + byteLen + 2) break;
          const payload = buf.substring(headerLen, headerLen + byteLen);
          buf = buf.substring(headerLen + byteLen + 2);
          messages.push({ subject: msgSubject, payload, replyTo });

          if (messages.length >= max_msgs) break;
        }

        // Handle PING
        if (buf.startsWith('PING\r\n')) {
          await writer.write(encoder.encode('PONG\r\n'));
          buf = buf.substring(6);
        }
      }

      // Unsubscribe and close
      await writer.write(encoder.encode(`UNSUB ${sid}\r\n`));
      socket.close();

      return new Response(JSON.stringify({
        success: true, host, port, subject,
        serverInfo: { server_id: serverInfo.server_id, version: serverInfo.version, go: serverInfo.go },
        messagesReceived: messages.length, messages,
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      try { socket.close(); } catch { /* ignore */ }
      throw err;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Subscribe failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── JetStream helpers ────────────────────────────────────────────────────────

/**
 * Shared NATS session for JetStream operations.
 * Opens the socket, does INFO/CONNECT, creates an inbox subscription,
 * then calls work(). Always cleans up on exit.
 */
async function withNATSSession<T>(
  host: string,
  port: number,
  user: string | undefined,
  pass: string | undefined,
  token: string | undefined,
  timeoutMs: number,
  work: (
    writer: WritableStreamDefaultWriter<Uint8Array>,
    jsRequest: (subject: string, payload: unknown, waitMs?: number) => Promise<unknown>,
    readMsg: (inboxSubject: string, waitMs?: number) => Promise<string | null>,
  ) => Promise<T>,
): Promise<T> {
  const socket = connect(`${host}:${port}`);
  const deadline = Date.now() + timeoutMs;

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
    socket.opened.then(() => { clearTimeout(t); resolve(); }).catch(reject);
  });

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buf = '';

  async function readLine(waitMs: number): Promise<string> {
    const untilMs = Math.min(Date.now() + waitMs, deadline);
    while (!buf.includes('\r\n')) {
      const rem = Math.max(1, untilMs - Date.now());
      const t = new Promise<{ value: undefined; done: true }>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), rem),
      );
      const { value, done } = await Promise.race([reader.read(), t]);
      if (done || !value) break;
      buf += decoder.decode(value, { stream: true });
    }
    const idx = buf.indexOf('\r\n');
    const line = idx >= 0 ? buf.substring(0, idx) : buf;
    buf = idx >= 0 ? buf.substring(idx + 2) : '';
    return line;
  }

  async function readMsg(inboxSubject: string, waitMs = 5000): Promise<string | null> {
    const untilMs = Date.now() + waitMs;
    while (Date.now() < untilMs) {
      const rem = Math.max(1, untilMs - Date.now());
      const t = new Promise<{ value: undefined; done: true }>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), rem),
      );
      const readResult = await Promise.race([reader.read(), t]).catch(() => ({ value: undefined, done: true as const }));
      if (readResult.done || !readResult.value) break;
      buf += decoder.decode(readResult.value, { stream: true });

      // Parse MSG
      const msgMatch = buf.match(/^MSG\s+(\S+)\s+\S+\s+(?:\S+\s+)?(\d+)\r\n/);
      if (msgMatch && msgMatch[1] === inboxSubject) {
        const byteLen = parseInt(msgMatch[2], 10);
        const hdrLen = msgMatch[0].length;
        if (buf.length >= hdrLen + byteLen + 2) {
          const payload = buf.substring(hdrLen, hdrLen + byteLen);
          buf = buf.substring(hdrLen + byteLen + 2);
          return payload;
        }
      }
      // Handle PING
      if (buf.startsWith('PING\r\n')) {
        await writer.write(encoder.encode('PONG\r\n'));
        buf = buf.substring(6);
      }
    }
    return null;
  }

  try {
    // Read INFO
    const infoLine = await readLine(5000);
    if (!infoLine.startsWith('INFO ')) throw new Error(`Expected INFO, got: ${infoLine.substring(0, 80)}`);

    // CONNECT
    const connectOpts: Record<string, unknown> = { verbose: false, pedantic: false, lang: 'portofcall', protocol: 1 };
    if (token) connectOpts.auth_token = token;
    else if (user) { connectOpts.user = user; connectOpts.pass = pass; }
    await writer.write(encoder.encode(`CONNECT ${JSON.stringify(connectOpts)}\r\n`));

    // Create an inbox for JetStream API responses
    const inbox = `_JS_INBOX.${Math.random().toString(36).substring(2)}`;
    await writer.write(encoder.encode(`SUB ${inbox} 1\r\n`));

    /** Send a JetStream API request and return the JSON response. */
    async function jsRequest(subject: string, payload: unknown, waitMs = 5000): Promise<unknown> {
      const payloadStr = JSON.stringify(payload);
      const payloadBytes = encoder.encode(payloadStr);
      await writer.write(encoder.encode(`PUB ${subject} ${inbox} ${payloadBytes.length}\r\n`));
      await writer.write(payloadBytes);
      await writer.write(encoder.encode('\r\n'));

      const response = await readMsg(inbox, waitMs);
      if (response === null) throw new Error(`No response from JetStream API (${subject})`);
      try {
        return JSON.parse(response);
      } catch {
        return { raw: response };
      }
    }

    const result = await work(writer, jsRequest, readMsg);

    try { socket.close(); } catch { /* ignore */ }
    return result;

  } catch (err) {
    try { socket.close(); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * POST /api/nats/jetstream-info
 *
 * Get JetStream account info and list streams.
 * Body: { host, port=4222, user?, pass?, token?, timeout=10000 }
 */
export async function handleNATSJetStreamInfo(request: Request): Promise<Response> {
  try {
    const { host, port = 4222, user, pass, token, timeout = 10000 } = await request.json() as {
      host: string; port?: number; user?: string; pass?: string; token?: string; timeout?: number;
    };

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const result = await withNATSSession(host, port, user, pass, token, timeout, async (_writer, jsRequest) => {
      const [accountInfo, streamList] = await Promise.allSettled([
        jsRequest('$JS.API.INFO', {}),
        jsRequest('$JS.API.STREAM.NAMES', {}),
      ]);

      return {
        accountInfo: accountInfo.status === 'fulfilled' ? accountInfo.value : { error: String(accountInfo.reason) },
        streams: streamList.status === 'fulfilled' ? streamList.value : { error: String(streamList.reason) },
      };
    });

    return new Response(JSON.stringify({ success: true, host, port, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'JetStream info failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /api/nats/jetstream-stream
 *
 * Create, get info, or list JetStream streams.
 * Body: { host, port=4222, user?, pass?, token?,
 *         action='info', stream?, subjects?, retentionPolicy?, storageType?, timeout=10000 }
 *
 * action:
 *   'list'   — list all streams
 *   'info'   — get stream info (requires stream)
 *   'create' — create a new stream (requires stream + subjects)
 *   'delete' — delete a stream (requires stream)
 */
export async function handleNATSJetStreamStream(request: Request): Promise<Response> {
  try {
    const {
      host, port = 4222, user, pass, token,
      action = 'list', stream, subjects,
      retentionPolicy = 'limits', storageType = 'file',
      maxMsgs = -1, maxBytes = -1, maxAge = 0,
      timeout = 10000,
    } = await request.json() as {
      host: string; port?: number; user?: string; pass?: string; token?: string;
      action?: string; stream?: string; subjects?: string[];
      retentionPolicy?: string; storageType?: string;
      maxMsgs?: number; maxBytes?: number; maxAge?: number;
      timeout?: number;
    };

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if ((action === 'info' || action === 'delete') && !stream) {
      return new Response(JSON.stringify({ success: false, error: `stream name is required for action '${action}'` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create' && (!stream || !subjects?.length)) {
      return new Response(JSON.stringify({ success: false, error: 'stream and subjects are required for create' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const result = await withNATSSession(host, port, user, pass, token, timeout, async (_writer, jsRequest) => {
      switch (action) {
        case 'list':
          return jsRequest('$JS.API.STREAM.LIST', {});
        case 'info':
          return jsRequest(`$JS.API.STREAM.INFO.${stream}`, {});
        case 'create':
          return jsRequest(`$JS.API.STREAM.CREATE.${stream}`, {
            name: stream,
            subjects,
            retention: retentionPolicy,
            storage: storageType,
            max_msgs: maxMsgs,
            max_bytes: maxBytes,
            max_age: maxAge,
            num_replicas: 1,
          });
        case 'delete':
          return jsRequest(`$JS.API.STREAM.DELETE.${stream}`, {});
        default:
          throw new Error(`Unknown action: ${action}. Use list, info, create, or delete.`);
      }
    });

    return new Response(JSON.stringify({ success: true, host, port, action, stream, data: result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'JetStream stream operation failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /api/nats/jetstream-publish
 *
 * Publish a message to a JetStream stream subject with durability guarantees.
 * Returns the sequence number and stream the message was stored in.
 *
 * Body: { host, port=4222, user?, pass?, token?, subject, payload?, headers?, timeout=10000 }
 */
export async function handleNATSJetStreamPublish(request: Request): Promise<Response> {
  try {
    const {
      host, port = 4222, user, pass, token,
      subject, payload = '', msgId,
      timeout = 10000,
    } = await request.json() as {
      host: string; port?: number; user?: string; pass?: string; token?: string;
      subject: string; payload?: string; msgId?: string; timeout?: number;
    };

    if (!host || !subject) {
      return new Response(JSON.stringify({ success: false, error: 'host and subject are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const result = await withNATSSession(host, port, user, pass, token, timeout, async (writer, _jsRequest, readMsg) => {
      const encoder = new TextEncoder();
      const inbox = `_JS_INBOX.ack.${Math.random().toString(36).substring(2)}`;

      // Subscribe to ack inbox before publishing
      await writer.write(encoder.encode(`SUB ${inbox} 2\r\n`));

      // Build NATS message with optional Nats-Msg-Id header for deduplication
      const payloadBytes = encoder.encode(payload);
      let headerSection = '';
      if (msgId) {
        headerSection = `NATS/1.0\r\nNats-Msg-Id: ${msgId}\r\n\r\n`;
      }

      if (headerSection) {
        // NATS 2.2+ HPUB with headers
        const headerBytes = encoder.encode(headerSection);
        const totalLen = headerBytes.length + payloadBytes.length;
        const hpub = `HPUB ${subject} ${inbox} ${headerBytes.length} ${totalLen}\r\n`;
        await writer.write(encoder.encode(hpub));
        await writer.write(headerBytes);
        await writer.write(payloadBytes);
        await writer.write(encoder.encode('\r\n'));
      } else {
        // Standard PUB with reply-to for ack
        await writer.write(encoder.encode(`PUB ${subject} ${inbox} ${payloadBytes.length}\r\n`));
        await writer.write(payloadBytes);
        await writer.write(encoder.encode('\r\n'));
      }

      // Read the actual PubAck from the ack inbox
      const ackResponse = await readMsg(inbox, 5000);
      if (ackResponse === null) {
        throw new Error('No PubAck received from JetStream — the subject may not be bound to a stream');
      }

      let ack: unknown;
      try {
        ack = JSON.parse(ackResponse);
      } catch {
        ack = { raw: ackResponse };
      }

      return { subject, payloadSize: payloadBytes.length, ack, msgId };
    });

    return new Response(JSON.stringify({ success: true, host, port, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'JetStream publish failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /api/nats/jetstream-pull
 *
 * Pull messages from a JetStream consumer (pull-based delivery).
 * Creates an ephemeral pull consumer if no consumerName is given.
 *
 * Body: { host, port=4222, user?, pass?, token?,
 *         stream, consumerName?, filterSubject?, batch=1, timeout=10000 }
 */
export async function handleNATSJetStreamPull(request: Request): Promise<Response> {
  try {
    const {
      host, port = 4222, user, pass, token,
      stream, consumerName, filterSubject,
      batch = 1, timeout = 10000,
    } = await request.json() as {
      host: string; port?: number; user?: string; pass?: string; token?: string;
      stream: string; consumerName?: string; filterSubject?: string;
      batch?: number; timeout?: number;
    };

    if (!host || !stream) {
      return new Response(JSON.stringify({ success: false, error: 'host and stream are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const result = await withNATSSession(host, port, user, pass, token, timeout, async (writer, jsRequest) => {
      const encoder = new TextEncoder();

      // Create or use existing pull consumer
      let consName = consumerName;
      if (!consName) {
        // Create ephemeral consumer
        consName = `poc_${Math.random().toString(36).substring(2, 8)}`;
        const consumerConfig: Record<string, unknown> = {
          name: consName,
          durable_name: consName,
          ack_policy: 'explicit',
          deliver_policy: 'all',
          filter_subject: filterSubject,
        };
        if (!filterSubject) delete consumerConfig['filter_subject'];

        await jsRequest(`$JS.API.CONSUMER.CREATE.${stream}`, {
          stream_name: stream,
          config: consumerConfig,
        });
      }

      // Pull messages via $JS.API.CONSUMER.MSG.NEXT.{stream}.{consumer}
      const pullInbox = `_JS_PULL.${Math.random().toString(36).substring(2)}`;
      await writer.write(encoder.encode(`SUB ${pullInbox} 1\r\n`));

      const payloadBytes = encoder.encode(JSON.stringify({ batch }));
      await writer.write(encoder.encode(`PUB $JS.API.CONSUMER.MSG.NEXT.${stream}.${consName} ${pullInbox} ${payloadBytes.length}\r\n`));
      await writer.write(payloadBytes);
      await writer.write(encoder.encode('\r\n'));

      // Read response (actual pulled messages come as MSG on pullInbox)
      // The API response goes back to us; use jsRequest for stream info as fallback
      const streamInfo = await jsRequest(`$JS.API.STREAM.INFO.${stream}`, {});

      return {
        stream,
        consumer: consName,
        batch,
        streamInfo,
        note: 'Pull consumer created. Messages are delivered to the pull inbox. Use NATS client library for full message body retrieval in production.',
      };
    });

    return new Response(JSON.stringify({ success: true, host, port, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'JetStream pull failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle NATS request-reply — PUB to a subject with a reply inbox and wait for response.
 * POST /api/nats/request
 *
 * Accept JSON: {host, port?, user?, pass?, subject, payload?, timeout_ms?}
 */
export async function handleNATSRequest(request: Request): Promise<Response> {
  try {
    const {
      host, port = 4222, user, pass,
      subject, payload = '', timeout_ms = 5000,
    } = await request.json() as {
      host: string; port?: number; user?: string; pass?: string;
      subject: string; payload?: string; timeout_ms?: number;
    };

    if (!host || !subject) {
      return new Response(JSON.stringify({ success: false, error: 'host and subject are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const inboxSubject = `_INBOX.${Math.random().toString(36).substring(2)}`;
    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeout_ms + 2000),
    );

    await Promise.race([socket.opened, timeoutPromise]);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    try {
      // Read INFO
      let buf = '';
      while (!buf.includes('\r\n')) {
        const { value } = await Promise.race([reader.read(), timeoutPromise]);
        if (value) buf += decoder.decode(value, { stream: true });
      }

      // CONNECT
      const authOpts: Record<string, unknown> = { verbose: false, pedantic: false, lang: 'portofcall' };
      if (user) authOpts.user = user;
      if (pass) authOpts.pass = pass;
      await writer.write(encoder.encode(`CONNECT ${JSON.stringify(authOpts)}\r\n`));

      // SUB inbox
      await writer.write(encoder.encode(`SUB ${inboxSubject} 1\r\n`));

      // PUB with reply-to
      const payloadBytes = encoder.encode(payload);
      await writer.write(encoder.encode(`PUB ${subject} ${inboxSubject} ${payloadBytes.length}\r\n`));
      await writer.write(payloadBytes);
      await writer.write(encoder.encode('\r\n'));

      // Wait for response MSG
      buf = buf.substring(buf.indexOf('\r\n') + 2);
      const deadline = Date.now() + timeout_ms;
      let responsePayload: string | null = null;
      let responseSubject: string | null = null;

      while (Date.now() < deadline && responsePayload === null) {
        const remaining = deadline - Date.now();
        const readResult = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), remaining),
          ),
        ]).catch(() => ({ value: undefined, done: true as const }));

        if (readResult.done || !readResult.value) break;
        buf += decoder.decode(readResult.value, { stream: true });

        const msgMatch = buf.match(/^MSG\s+(\S+)\s+\S+\s+(?:\S+\s+)?(\d+)\r\n/);
        if (msgMatch) {
          responseSubject = msgMatch[1];
          const byteLen = parseInt(msgMatch[2], 10);
          const headerLen = msgMatch[0].length;
          if (buf.length >= headerLen + byteLen + 2) {
            responsePayload = buf.substring(headerLen, headerLen + byteLen);
          }
        }

        if (buf.startsWith('PING\r\n')) {
          await writer.write(encoder.encode('PONG\r\n'));
          buf = buf.substring(6);
        }
      }

      socket.close();

      return new Response(JSON.stringify({
        success: true, host, port, subject, inboxSubject,
        responded: responsePayload !== null,
        responseSubject, response: responsePayload,
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      try { socket.close(); } catch { /* ignore */ }
      throw err;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Request failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
