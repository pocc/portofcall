/**
 * SSH Protocol Support for Cloudflare Workers
 * Uses WebSocket tunnel approach for SSH connections
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';
export { handleSSHTerminal } from './ssh2-impl';

/**
 * SSH Authentication Methods
 */
export type SSHAuthMethod = 'password' | 'publickey' | 'keyboard-interactive' | 'hostbased';

/**
 * SSH Connection Options
 *
 * Note: Port of Call provides TCP tunneling. The actual SSH protocol negotiation
 * and authentication happens browser-side. These options are metadata that can
 * be used by browser-side SSH clients (like xterm.js + ssh2).
 */
export interface SSHConnectionOptions {
  // Required
  host: string;
  port?: number;

  // Authentication
  username?: string;
  password?: string;
  privateKey?: string;        // PEM-encoded private key
  passphrase?: string;        // Passphrase for encrypted private key
  authMethod?: SSHAuthMethod; // Preferred auth method

  // Connection options
  timeout?: number;           // Connection timeout in ms (default: 30000)
  keepaliveInterval?: number; // Keepalive interval in ms (default: 0 = disabled)
  readyTimeout?: number;      // Time to wait for handshake in ms (default: 20000)

  // Security options
  hostHash?: 'md5' | 'sha1' | 'sha256'; // Host key hash algorithm
  algorithms?: {
    kex?: string[];           // Key exchange algorithms
    cipher?: string[];        // Cipher algorithms
    serverHostKey?: string[]; // Server host key algorithms
    hmac?: string[];          // MAC algorithms
    compress?: string[];      // Compression algorithms
  };

  // Advanced options
  strictHostKeyChecking?: boolean; // Verify host key (default: false for web clients)
  debug?: boolean;                 // Enable debug output
}

/**
 * Handle SSH connection via WebSocket tunnel
 *
 * This creates a WebSocket that tunnels raw TCP to an SSH server.
 * The browser-side SSH client handles the SSH protocol.
 */
export async function handleSSHConnect(request: Request): Promise<Response> {
  try {
    // Check for WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      // HTTP mode: Test connectivity and return SSH banner
      const url = new URL(request.url);
      let options: Partial<SSHConnectionOptions>;

      if (request.method === 'POST') {
        options = await request.json() as Partial<SSHConnectionOptions>;
      } else {
        options = {
          host: url.searchParams.get('host') || '',
          port: parseInt(url.searchParams.get('port') || '22'),
          username: url.searchParams.get('username') || undefined,
        };
      }

      // Validate required fields
      if (!options.host) {
        return new Response(JSON.stringify({
          error: 'Missing required parameter: host',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const host = options.host;
      const port = options.port || 22;

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

      // Test connection
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      // Read SSH banner
      const reader = socket.readable.getReader();
      const { value } = await reader.read();
      const banner = new TextDecoder().decode(value);

      await socket.close();

      return new Response(JSON.stringify({
        success: true,
        message: 'SSH server reachable',
        host,
        port,
        banner: banner.trim(),
        connectionOptions: {
          username: options.username,
          authMethod: options.authMethod || 'password',
          hasPrivateKey: !!options.privateKey,
          hasPassword: !!options.password,
        },
        note: 'This is a connectivity test only. For full SSH authentication (password/privateKey), use WebSocket upgrade.',
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade - create tunnel with SSH options
    const url = new URL(request.url);

    // Parse SSH connection options from query parameters
    const options: SSHConnectionOptions = {
      host: url.searchParams.get('host') || '',
      port: parseInt(url.searchParams.get('port') || '22'),
      username: url.searchParams.get('username') || undefined,
      password: url.searchParams.get('password') || undefined,
      privateKey: url.searchParams.get('privateKey') || undefined,
      passphrase: url.searchParams.get('passphrase') || undefined,
      authMethod: (url.searchParams.get('authMethod') as SSHAuthMethod) || undefined,
      timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      keepaliveInterval: parseInt(url.searchParams.get('keepaliveInterval') || '0'),
      readyTimeout: parseInt(url.searchParams.get('readyTimeout') || '20000'),
      strictHostKeyChecking: url.searchParams.get('strictHostKeyChecking') === 'true',
      debug: url.searchParams.get('debug') === 'true',
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
    const cfCheckWs = await checkIfCloudflare(options.host);
    if (cfCheckWs.isCloudflare && cfCheckWs.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(options.host, cfCheckWs.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket
    server.accept();

    // Connect to SSH server
    const socket = connect(`${options.host}:${options.port}`);
    await socket.opened;

    // Send SSH connection options to browser client as first message
    // The browser-side SSH client (e.g., xterm.js + ssh2) will use these for authentication
    server.send(JSON.stringify({
      type: 'ssh-options',
      options: {
        host: options.host,
        port: options.port,
        username: options.username,
        password: options.password,
        privateKey: options.privateKey,
        passphrase: options.passphrase,
        authMethod: options.authMethod,
        timeout: options.timeout,
        keepaliveInterval: options.keepaliveInterval,
        readyTimeout: options.readyTimeout,
        algorithms: options.algorithms,
        strictHostKeyChecking: options.strictHostKeyChecking,
        debug: options.debug,
      },
    }));

    // Pipe data bidirectionally
    pipeWebSocketToSocket(server, socket);
    pipeSocketToWebSocket(socket, server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
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
 * Handle SSH command execution (simplified for testing)
 */
export async function handleSSHExecute(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'SSH command execution requires WebSocket tunnel',
    message: 'Use WebSocket connection for interactive SSH sessions. This endpoint is for testing connectivity only.',
  }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle SSH disconnect
 */
export async function handleSSHDisconnect(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    success: true,
    message: 'Close WebSocket connection to disconnect SSH session',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Pipe WebSocket messages to TCP socket
 */
function pipeWebSocketToSocket(ws: WebSocket, socket: Socket): void {
  const writer = socket.writable.getWriter();

  ws.addEventListener('message', async (event) => {
    try {
      if (typeof event.data === 'string') {
        await writer.write(new TextEncoder().encode(event.data));
      } else if (event.data instanceof ArrayBuffer) {
        await writer.write(new Uint8Array(event.data));
      }
    } catch (error) {
      console.error('Error writing to socket:', error);
      ws.close();
    }
  });

  ws.addEventListener('close', () => {
    writer.close().catch(() => {});
  });
}

/**
 * Pipe TCP socket data to WebSocket
 */
async function pipeSocketToWebSocket(socket: Socket, ws: WebSocket): Promise<void> {
  const reader = socket.readable.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        ws.close();
        break;
      }

      ws.send(value);
    }
  } catch (error) {
    console.error('Error reading from socket:', error);
    ws.close();
  }
}


// ─── SSH Key Exchange (RFC 4253) ──────────────────────────────────────────────

export interface SSHKeyExchangeResult {
  success: boolean;
  serverBanner: string;
  kexAlgorithms: string[];
  hostKeyAlgorithms: string[];
  ciphers: string[];
  macs: string[];
  compressions: string[];
  latencyMs: number;
  error?: string;
}

export interface SSHAuthResult {
  success: boolean;
  serverBanner: string;
  authMethods: string[];
  latencyMs: number;
  error?: string;
}

/** Encode a string as an SSH name-list: uint32(len) + utf8 bytes. */
function encodeNameList(names: string): Uint8Array {
  const bytes = new TextEncoder().encode(names);
  const out = new Uint8Array(4 + bytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, bytes.length, false);
  out.set(bytes, 4);
  return out;
}

/** Decode an SSH name-list at the given offset in a DataView.
 *  Returns the list of names and the number of bytes consumed. */
function decodeNameList(view: DataView, offset: number): { names: string[]; consumed: number } {
  if (offset + 4 > view.byteLength) return { names: [], consumed: 4 };
  const len = view.getUint32(offset, false);
  const end = offset + 4 + len;
  if (end > view.byteLength) return { names: [], consumed: 4 + len };
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset + 4, len);
  const str = new TextDecoder().decode(bytes);
  const names = str.length > 0 ? str.split(',') : [];
  return { names, consumed: 4 + len };
}

/** Build a complete SSH_MSG_KEXINIT packet (with SSH binary packet framing). */
function buildSSHKexInit(): Uint8Array {
  const cookie = crypto.getRandomValues(new Uint8Array(16));

  const kexAlgos     = encodeNameList('curve25519-sha256,diffie-hellman-group14-sha256,diffie-hellman-group14-sha1');
  const hostKeyAlgos = encodeNameList('ssh-rsa,rsa-sha2-256,rsa-sha2-512,ssh-ed25519,ecdsa-sha2-nistp256');
  const encCS        = encodeNameList('aes128-ctr,aes256-ctr,aes128-gcm@openssh.com,aes256-gcm@openssh.com');
  const encSC        = encodeNameList('aes128-ctr,aes256-ctr,aes128-gcm@openssh.com,aes256-gcm@openssh.com');
  const macCS        = encodeNameList('hmac-sha2-256,hmac-sha1');
  const macSC        = encodeNameList('hmac-sha2-256,hmac-sha1');
  const compCS       = encodeNameList('none,zlib@openssh.com');
  const compSC       = encodeNameList('none,zlib@openssh.com');
  const langCS       = encodeNameList('');
  const langSC       = encodeNameList('');

  // payload = msg_type(1) + cookie(16) + 10 name-lists + first_kex_follows(1) + reserved(4)
  const payloadSize =
    1 + 16 +
    kexAlgos.length + hostKeyAlgos.length +
    encCS.length + encSC.length +
    macCS.length + macSC.length +
    compCS.length + compSC.length +
    langCS.length + langSC.length +
    1 + 4;

  // Padding: at least 4 bytes; total (packet_length field + 1 + payload + padding) % blockSize == 0
  const blockSize = 8;
  let paddingLength = blockSize - ((4 + 1 + payloadSize) % blockSize);
  if (paddingLength < 4) paddingLength += blockSize;

  // packet layout: uint32(packet_length) + uint8(padding_length) + payload + padding
  const packet = new Uint8Array(4 + 1 + payloadSize + paddingLength);
  const pView = new DataView(packet.buffer);

  let offset = 0;
  pView.setUint32(offset, 1 + payloadSize + paddingLength, false); offset += 4;
  packet[offset++] = paddingLength;
  packet[offset++] = 20; // SSH_MSG_KEXINIT
  packet.set(cookie, offset); offset += 16;

  for (const nl of [kexAlgos, hostKeyAlgos, encCS, encSC, macCS, macSC, compCS, compSC, langCS, langSC]) {
    packet.set(nl, offset); offset += nl.length;
  }

  packet[offset++] = 0; // first_kex_packet_follows = false
  pView.setUint32(offset, 0, false); // reserved (padding stays zero)

  return packet;
}

interface ParsedKexInit {
  kexAlgorithms: string[];
  hostKeyAlgorithms: string[];
  ciphers: string[];
  macs: string[];
  compressions: string[];
}

/**
 * Parse the payload of an SSH_MSG_KEXINIT message.
 * payload[0] = 20 (msg type), payload[1..16] = cookie, then name-lists.
 */
function parseKexInitPayload(payload: Uint8Array): ParsedKexInit {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  // Skip: msg_type(1) + cookie(16)
  let offset = 17;

  function nextList(): string[] {
    const { names, consumed } = decodeNameList(view, offset);
    offset += consumed;
    return names;
  }

  const kexAlgorithms     = nextList();
  const hostKeyAlgorithms = nextList();
  const ciphersCS         = nextList();
  const ciphersSC         = nextList();
  const macsCS            = nextList();
  nextList(); // macs server-to-client (discard)
  const comprCS           = nextList();

  return {
    kexAlgorithms,
    hostKeyAlgorithms,
    // Merge both directions, deduplicated
    ciphers: [...new Set([...ciphersCS, ...ciphersSC])],
    macs: macsCS,
    compressions: comprCS,
  };
}

/**
 * Read from SSH socket until we have at least `needed` bytes.
 * Returns accumulated buffer as a fresh Uint8Array.
 */
async function sshReadAtLeast(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needed: number,
  timeoutMs: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;

  while (total < needed) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('SSH read timeout');

    const timerPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
      setTimeout(() => resolve({ done: true, value: undefined }), remaining)
    );
    const { done, value } = await Promise.race([reader.read(), timerPromise]);
    if (done || !value) throw new Error('SSH connection closed');
    chunks.push(value);
    total += value.length;
  }

  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Merge two Uint8Arrays into one.
 */
function mergeBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Read one SSH binary packet from the stream.
 * `buffer` is any bytes already read ahead. Returns the packet payload
 * (excludes framing) and any leftover bytes after the packet.
 */
async function readSSHPacket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buffer: Uint8Array,
  timeoutMs: number
): Promise<{ payload: Uint8Array; remaining: Uint8Array }> {
  let buf = buffer;

  // Need at least 4 bytes for packet_length
  if (buf.length < 4) {
    const extra = await sshReadAtLeast(reader, 4 - buf.length, timeoutMs);
    buf = mergeBuffers(buf, extra);
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const packetLength = view.getUint32(0, false);
  const totalNeeded = 4 + packetLength;

  if (packetLength === 0 || packetLength > 35000) {
    throw new Error(`SSH packet length out of range: ${packetLength}`);
  }

  while (buf.length < totalNeeded) {
    const extra = await sshReadAtLeast(reader, totalNeeded - buf.length, timeoutMs);
    buf = mergeBuffers(buf, extra);
  }

  const paddingLength = buf[4];
  const payloadLength = packetLength - 1 - paddingLength;
  if (payloadLength < 1) throw new Error('SSH packet payload length < 1');

  // Copy payload into a fresh buffer with its own backing ArrayBuffer
  const payloadSrc = buf.subarray(5, 5 + payloadLength);
  const payload = new Uint8Array(payloadSrc.length);
  payload.set(payloadSrc);

  const remaining = new Uint8Array(buf.length - totalNeeded);
  remaining.set(buf.subarray(totalNeeded));

  return { payload, remaining };
}

/**
 * Wrap a payload in an SSH binary packet frame.
 * Uses block size 8 (pre-key-exchange default) and zero padding.
 */
function wrapSSHPacket(payload: Uint8Array): Uint8Array {
  const blockSize = 8;
  let paddingLength = blockSize - ((4 + 1 + payload.length) % blockSize);
  if (paddingLength < 4) paddingLength += blockSize;

  const packet = new Uint8Array(4 + 1 + payload.length + paddingLength);
  const view = new DataView(packet.buffer);
  view.setUint32(0, 1 + payload.length + paddingLength, false);
  packet[4] = paddingLength;
  packet.set(payload, 5);
  // padding stays zero
  return packet;
}

/**
 * Read the SSH server banner line (terminated by CRLF).
 * Returns the banner text (without CRLF) and any bytes read past the banner.
 */
async function readSSHBanner(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<{ banner: string; remaining: Uint8Array }> {
  const bannerBytes: number[] = [];
  let buf = new Uint8Array(0);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (buf.length === 0) {
      const timeLeft = deadline - Date.now();
      if (timeLeft <= 0) throw new Error('SSH banner read timeout');
      buf = new Uint8Array(await sshReadAtLeast(reader, 1, timeLeft));
    }

    // Scan for CRLF
    let crlfAt = -1;
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i] === 0x0d && buf[i + 1] === 0x0a) {
        crlfAt = i;
        break;
      }
    }

    if (crlfAt >= 0) {
      for (let i = 0; i < crlfAt; i++) bannerBytes.push(buf[i]);
      const remaining = new Uint8Array(buf.length - crlfAt - 2);
      remaining.set(buf.subarray(crlfAt + 2));
      return {
        banner: new TextDecoder().decode(new Uint8Array(bannerBytes)),
        remaining,
      };
    }

    // No CRLF yet — consume all but the last byte (could be bare CR)
    const safeEnd = buf.length - 1;
    for (let i = 0; i < safeEnd; i++) bannerBytes.push(buf[i]);
    buf = buf.subarray(safeEnd);
  }
}

/**
 * POST /api/ssh/kexinit
 *
 * Connects to an SSH server, exchanges version banners, sends a
 * SSH_MSG_KEXINIT, and parses the server's KEXINIT to extract its
 * advertised algorithm lists.
 *
 * Body: { host, port?, timeout? }
 */
export async function handleSSHKeyExchange(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const startTime = Date.now();
  let socket: ReturnType<typeof connect> | null = null;

  try {
    const body = await request.json() as { host?: string; port?: number; timeout?: number };
    const host = (body.host ?? '').trim();
    const port = body.port ?? 22;
    const timeout = Math.min(body.timeout ?? 10000, 30000);

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    socket = connect(`${host}:${port}`);
    await socket.opened;

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    const { banner: serverBanner, remaining } = await readSSHBanner(
      reader, timeout - (Date.now() - startTime)
    );

    await writer.write(new TextEncoder().encode('SSH-2.0-CloudflareWorker_1.0\r\n'));

    await writer.write(buildSSHKexInit());

    const { payload: serverKexPayload } = await readSSHPacket(
      reader, remaining, timeout - (Date.now() - startTime)
    );

    if (serverKexPayload[0] !== 20) {
      throw new Error(`Expected SSH_MSG_KEXINIT (20), got message type ${serverKexPayload[0]}`);
    }

    const parsed = parseKexInitPayload(serverKexPayload);

    reader.releaseLock();
    writer.releaseLock();
    await socket.close();

    const result: SSHKeyExchangeResult = {
      success: true,
      serverBanner,
      kexAlgorithms: parsed.kexAlgorithms,
      hostKeyAlgorithms: parsed.hostKeyAlgorithms,
      ciphers: parsed.ciphers,
      macs: parsed.macs,
      compressions: parsed.compressions,
      latencyMs: Date.now() - startTime,
    };

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    if (socket) try { await socket.close(); } catch { /* ignore */ }
    const result: SSHKeyExchangeResult = {
      success: false,
      serverBanner: '',
      kexAlgorithms: [],
      hostKeyAlgorithms: [],
      ciphers: [],
      macs: [],
      compressions: [],
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /api/ssh/auth
 *
 * Performs banner exchange and KEXINIT, then sends SSH_MSG_SERVICE_REQUEST
 * for "ssh-userauth" and a SSH_MSG_USERAUTH_REQUEST with method "none" to
 * elicit the server's SSH_MSG_USERAUTH_FAILURE listing supported auth methods.
 *
 * Body: { host, port?, timeout? }
 */
export async function handleSSHAuth(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const startTime = Date.now();
  let socket: ReturnType<typeof connect> | null = null;

  try {
    const body = await request.json() as { host?: string; port?: number; timeout?: number };
    const host = (body.host ?? '').trim();
    const port = body.port ?? 22;
    const timeout = Math.min(body.timeout ?? 10000, 30000);

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    socket = connect(`${host}:${port}`);
    await socket.opened;

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    // ── Banner exchange ──────────────────────────────────────────────────────
    const { banner: serverBanner, remaining: afterBanner } = await readSSHBanner(
      reader, timeout - (Date.now() - startTime)
    );

    await writer.write(new TextEncoder().encode('SSH-2.0-CloudflareWorker_1.0\r\n'));

    // ── KEXINIT ──────────────────────────────────────────────────────────────
    await writer.write(buildSSHKexInit());

    const { payload: serverKexPayload, remaining: afterKex } = await readSSHPacket(
      reader, afterBanner, timeout - (Date.now() - startTime)
    );

    if (serverKexPayload[0] !== 20) {
      throw new Error(`Expected SSH_MSG_KEXINIT (20), got type ${serverKexPayload[0]}`);
    }

    // ── SSH_MSG_SERVICE_REQUEST for "ssh-userauth" ───────────────────────────
    // RFC 4253 §10: msg type 5
    const serviceNameBytes = new TextEncoder().encode('ssh-userauth');
    const serviceReqPayload = new Uint8Array(1 + 4 + serviceNameBytes.length);
    serviceReqPayload[0] = 5; // SSH_MSG_SERVICE_REQUEST
    new DataView(serviceReqPayload.buffer).setUint32(1, serviceNameBytes.length, false);
    serviceReqPayload.set(serviceNameBytes, 5);

    await writer.write(wrapSSHPacket(serviceReqPayload));

    const { payload: serviceReply, remaining: afterService } = await readSSHPacket(
      reader, afterKex, timeout - (Date.now() - startTime)
    );

    if (serviceReply[0] !== 6) {
      throw new Error(`Expected SSH_MSG_SERVICE_ACCEPT (6), got type ${serviceReply[0]}`);
    }

    // ── SSH_MSG_USERAUTH_REQUEST with method "none" ──────────────────────────
    // RFC 4252 §5: msg type 50
    // Fields: string username + string service-name + string method-name
    const usernameBytes = new TextEncoder().encode('anonymous');
    const svcBytes      = new TextEncoder().encode('ssh-connection');
    const methodBytes   = new TextEncoder().encode('none');

    const authPayload = new Uint8Array(
      1 +
      4 + usernameBytes.length +
      4 + svcBytes.length +
      4 + methodBytes.length
    );
    const av = new DataView(authPayload.buffer);
    let ao = 0;
    authPayload[ao++] = 50; // SSH_MSG_USERAUTH_REQUEST
    av.setUint32(ao, usernameBytes.length, false); ao += 4;
    authPayload.set(usernameBytes, ao); ao += usernameBytes.length;
    av.setUint32(ao, svcBytes.length, false); ao += 4;
    authPayload.set(svcBytes, ao); ao += svcBytes.length;
    av.setUint32(ao, methodBytes.length, false); ao += 4;
    authPayload.set(methodBytes, ao);

    await writer.write(wrapSSHPacket(authPayload));

    // ── Read SSH_MSG_USERAUTH_FAILURE (51) or SUCCESS (52) ───────────────────
    const { payload: authReply } = await readSSHPacket(
      reader, afterService, timeout - (Date.now() - startTime)
    );

    let authMethods: string[] = [];
    if (authReply[0] === 51) {
      // SSH_MSG_USERAUTH_FAILURE: name-list of continuable methods + boolean partial-success
      const arv = new DataView(authReply.buffer, authReply.byteOffset, authReply.byteLength);
      const { names } = decodeNameList(arv, 1);
      authMethods = names;
    } else if (authReply[0] === 52) {
      // SSH_MSG_USERAUTH_SUCCESS — anonymous login accepted
      authMethods = ['none'];
    }

    reader.releaseLock();
    writer.releaseLock();
    await socket.close();

    const result: SSHAuthResult = {
      success: true,
      serverBanner,
      authMethods,
      latencyMs: Date.now() - startTime,
    };
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    if (socket) try { await socket.close(); } catch { /* ignore */ }
    const result: SSHAuthResult = {
      success: false,
      serverBanner: '',
      authMethods: [],
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
