/**
 * SFTP Protocol Implementation (SSH File Transfer Protocol, draft-ietf-secsh-filexfer-02)
 *
 * ===============================================================================
 * ARCHITECTURAL BLOCKER: SFTP File Operations Require WebSocket Tunnel
 * ===============================================================================
 *
 * PROBLEM:
 * SFTP is a stateful, bidirectional protocol that runs over an SSH channel.
 * The SSH channel uses SSH_MSG_CHANNEL_DATA packets (type 94) for bidirectional
 * communication between client and server. This creates a fundamental incompatibility
 * with the HTTP request/response model:
 *
 *   1. SFTP protocol requires multiple round-trips (INIT → VERSION → OPEN → READ → DATA → CLOSE)
 *   2. Each SFTP request packet expects a corresponding response packet
 *   3. The SSH channel must remain open and actively process incoming messages
 *   4. HTTP requests are inherently one-shot: send request → wait → receive response → close
 *
 * CURRENT STATE:
 * All SFTP file operations (list, download, upload, delete, mkdir, rename) return
 * HTTP 501 Not Implemented because they cannot work over HTTP. Only the /connect
 * endpoint works (SSH banner grab) because it doesn't require an SSH channel.
 *
 * WHY HTTP DOESN'T WORK:
 * When openSFTP() calls openSSHSubsystem(), it gets an SSHSubsystemIO object with:
 *   - sendChannelData(data): sends SSH_MSG_CHANNEL_DATA to server
 *   - readChannelData(): waits for incoming SSH_MSG_CHANNEL_DATA from server
 *
 * The readChannelData() method is asynchronous and waits for the TCP socket to
 * deliver the next SSH packet. In an HTTP handler, once the Response is returned,
 * the request is done — there's no way to keep reading from the socket.
 *
 * SOLUTION: WebSocket Tunnel (Like SSH Exec Sessions)
 * ===============================================================================
 *
 * SFTP operations need the same WebSocket-based architecture used by SSH terminal
 * sessions (handleSSHTerminal in ssh2-impl.ts). The WebSocket provides:
 *
 *   1. Persistent connection: The WebSocket stays open during the entire SFTP session
 *   2. Bidirectional messaging: Browser ↔ Worker via WebSocket, Worker ↔ SSH via TCP
 *   3. Asynchronous I/O: The Worker can read SSH_MSG_CHANNEL_DATA packets while
 *      simultaneously waiting for browser commands over the WebSocket
 *
 * REFERENCE IMPLEMENTATION:
 * See openSSHSubsystem() in ssh2-impl.ts (lines 854-1123) for the SSH channel
 * infrastructure. This function already handles:
 *   - Version exchange, key exchange, authentication
 *   - Opening a session channel
 *   - Requesting a subsystem (e.g., "sftp")
 *   - Bidirectional channel data forwarding
 *
 * The SSH terminal uses this pattern:
 *   1. Browser sends WebSocket upgrade request
 *   2. Worker accepts WebSocket, opens TCP socket to SSH server
 *   3. Worker calls openSSHSubsystem(socket, opts, 'sftp') to get SSHSubsystemIO
 *   4. Worker forwards data: WebSocket ↔ SFTPSession ↔ SSHSubsystemIO ↔ TCP
 *   5. SFTPSession handles SFTP protocol parsing (this file already has the logic)
 *
 * IMPLEMENTATION STEPS NEEDED:
 * ===============================================================================
 *
 * 1. Create WebSocket endpoint: POST /api/sftp/session (upgrade to WebSocket)
 *    - Accept WebSocket upgrade request with connection params (host, user, auth)
 *    - Open TCP socket via connect()
 *    - Call openSSHSubsystem(socket, opts, 'sftp') to establish SSH+SFTP session
 *
 * 2. Create browser-to-worker protocol over WebSocket:
 *    Browser → Worker (JSON commands):
 *      { type: 'list', path: '/home/user' }
 *      { type: 'download', path: '/path/to/file' }
 *      { type: 'upload', path: '/path/to/file', content: '<base64>' }
 *      { type: 'delete', path: '/path/to/file' }
 *      { type: 'mkdir', path: '/new/dir' }
 *      { type: 'rename', oldPath: '/old', newPath: '/new' }
 *      { type: 'stat', path: '/path' }
 *      { type: 'close' }
 *
 *    Worker → Browser (JSON responses):
 *      { type: 'result', data: { ... } }
 *      { type: 'error', message: 'Permission denied' }
 *      { type: 'progress', bytesTransferred: 1024 }
 *
 * 3. Wire up SFTPSession (lines 75-134) to WebSocket message loop:
 *    - Create SFTPSession wrapper around SSHSubsystemIO
 *    - On WebSocket message: parse command → call SFTP operation → send result
 *    - Keep reading SSH_MSG_CHANNEL_DATA via SSHSubsystemIO.readChannelData()
 *
 * 4. Update frontend to use WebSocket instead of fetch() for SFTP operations
 *
 * TODO: Implement WebSocket-based SFTP session handler (see Issue #TBD)
 *
 * ===============================================================================
 *
 * OPERATIONS:
 *   POST /api/sftp/connect  — SSH banner grab + server info (no auth, works via HTTP)
 *   POST /api/sftp/list     — BLOCKED: requires WebSocket (returns 501)
 *   POST /api/sftp/download — BLOCKED: requires WebSocket (returns 501)
 *   POST /api/sftp/upload   — BLOCKED: requires WebSocket (returns 501)
 *   POST /api/sftp/delete   — BLOCKED: requires WebSocket (returns 501)
 *   POST /api/sftp/mkdir    — BLOCKED: requires WebSocket (returns 501)
 *   POST /api/sftp/rename   — BLOCKED: requires WebSocket (returns 501)
 *   POST /api/sftp/stat     — Partially works via HTTP (one-shot stat, inefficient)
 *
 * All authenticated endpoints require: host, username, and either password or privateKey.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';
import { openSSHSubsystem, SSHSubsystemIO, SSHTerminalOptions } from './ssh2-impl';

// ─── SFTP packet types (draft-ietf-secsh-filexfer-02) ────────────────────────

const SSH_FXP_INIT        = 1;
const SSH_FXP_VERSION     = 2;
const SSH_FXP_STAT        = 17;
const SSH_FXP_STATUS      = 101;
const SSH_FXP_ATTRS       = 105;

// SFTP status codes
const SSH_FX_OK           = 0;

// ─── Binary helpers ───────────────────────────────────────────────────────────

function u32BE(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function readU32BE(b: Uint8Array, off: number): number {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function sftpStr(s: string): Uint8Array {
  const b = new TextEncoder().encode(s);
  return concat(u32BE(b.length), b);
}

function sftpReadStr(b: Uint8Array, off: number): [string, number] {
  const len = readU32BE(b, off); off += 4;
  return [new TextDecoder().decode(b.slice(off, off + len)), off + len];
}

/** Build a framed SFTP packet: [length:4][type:1][id:4?][...payloads] */
function sftpPkt(type: number, id: number | null, ...payloads: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([type])];
  if (id !== null) parts.push(u32BE(id));
  parts.push(...payloads);
  const body = concat(...parts);
  return concat(u32BE(body.length), body);
}

// ─── SFTP session wrapper ─────────────────────────────────────────────────────
//
// This class handles the SFTP wire protocol (packet framing, request/response matching).
// It depends on SSHSubsystemIO for bidirectional SSH_MSG_CHANNEL_DATA communication.
//
// CRITICAL: The recv() method is asynchronous and waits indefinitely for the next
// SSH packet. This requires a persistent connection (WebSocket or long-lived TCP socket).
// In an HTTP request handler, once the Response is returned, the connection closes,
// so recv() will fail mid-operation.
//
// This is the core reason why SFTP cannot work over HTTP request/response.

class SFTPSession {
  private buf = new Uint8Array(0);
  private nextReqId = 1;

  constructor(private io: SSHSubsystemIO) {}

  /** Append incoming channel data to internal buffer. */
  private append(chunk: Uint8Array): void {
    const nb = new Uint8Array(this.buf.length + chunk.length);
    nb.set(this.buf); nb.set(chunk, this.buf.length);
    this.buf = nb;
  }

  /** Try to extract one complete SFTP packet from the buffer. */
  private tryParse(): { type: number; id: number; payload: Uint8Array } | null {
    if (this.buf.length < 5) return null; // need at least length(4)+type(1)
    const pktLen = readU32BE(this.buf, 0);
    if (this.buf.length < 4 + pktLen) return null; // incomplete
    const type = this.buf[4];
    let id = -1;
    let payloadStart = 5;
    // SSH_FXP_VERSION (type=2) has no request ID; all response types do
    if (type !== SSH_FXP_VERSION && pktLen >= 5) {
      id = readU32BE(this.buf, 5);
      payloadStart = 9;
    }
    const payload = this.buf.slice(payloadStart, 4 + pktLen);
    this.buf = this.buf.slice(4 + pktLen);
    return { type, id, payload };
  }

  /**
   * Read one complete SFTP packet, fetching channel data as needed.
   *
   * BLOCKING REQUIREMENT: This method calls io.readChannelData() in a loop,
   * which waits for the next SSH_MSG_CHANNEL_DATA packet from the server.
   * This requires the SSH channel to remain open and actively receiving data.
   *
   * In HTTP handlers, once Response is returned, the request is done and the
   * connection closes, causing readChannelData() to fail.
   */
  async recv(): Promise<{ type: number; id: number; payload: Uint8Array }> {
    while (true) {
      const pkt = this.tryParse();
      if (pkt) return pkt;
      // BLOCKER: This await will never resolve if the SSH channel is closed
      // (which happens immediately after HTTP response is sent)
      const chunk = await this.io.readChannelData();
      if (!chunk) throw new Error('SSH channel closed unexpectedly');
      this.append(chunk);
    }
  }

  /** Send an SFTP packet over the SSH channel. */
  async send(pkt: Uint8Array): Promise<void> {
    await this.io.sendChannelData(pkt);
  }

  /** Generate a new request ID. */
  id(): number { return this.nextReqId++; }

  /**
   * Send a packet and wait for the response with the matching request ID.
   *
   * BLOCKING REQUIREMENT: This method calls recv() in a loop, which in turn
   * waits for SSH_MSG_CHANNEL_DATA packets from the server. This is the
   * fundamental SFTP request/response pattern, but it requires a persistent
   * bidirectional channel.
   *
   * In HTTP handlers, the response must be returned immediately, so the
   * recv() loop cannot wait for the server's reply.
   */
  async rpc(pkt: Uint8Array, reqId: number): Promise<{ type: number; payload: Uint8Array }> {
    await this.send(pkt);
    while (true) {
      // BLOCKER: This await will never resolve in HTTP context
      const { type, id, payload } = await this.recv();
      if (id === reqId) return { type, payload };
      // Ignore out-of-order responses (shouldn't happen in sequential mode)
    }
  }
}

// ─── SFTP operation helpers ───────────────────────────────────────────────────

interface SFTPAttrs {
  size?: number;
  uid?: number;
  gid?: number;
  permissions?: number;
  atime?: number;
  mtime?: number;
  isDirectory: boolean;
  isSymlink: boolean;
  permissionString?: string;
}

function parseAttrs(b: Uint8Array, off: number): SFTPAttrs & { consumed: number } {
  if (b.length < off + 4) return { isDirectory: false, isSymlink: false, consumed: 0 };
  const flags = readU32BE(b, off); off += 4;
  let size: number | undefined;
  let uid: number | undefined;
  let gid: number | undefined;
  let permissions: number | undefined;
  let atime: number | undefined;
  let mtime: number | undefined;

  if (flags & 0x00000001) { // SIZE (uint64)
    // Read as two 32-bit values; combine into a JS number (safe up to ~4GB)
    const hi = readU32BE(b, off);
    const lo = readU32BE(b, off + 4);
    size = hi > 0 ? hi * 0x100000000 + lo : lo;
    off += 8;
  }
  if (flags & 0x00000002) { // UIDGID
    uid = readU32BE(b, off);
    gid = readU32BE(b, off + 4);
    off += 8;
  }
  if (flags & 0x00000004) { // PERMISSIONS
    permissions = readU32BE(b, off);
    off += 4;
  }
  if (flags & 0x00000008) { // ACMODTIME
    atime = readU32BE(b, off);
    mtime = readU32BE(b, off + 4);
    off += 8;
  }
  if (flags & 0x80000000) { // EXTENDED
    const cnt = readU32BE(b, off); off += 4;
    for (let i = 0; i < cnt; i++) {
      const [, ke] = sftpReadStr(b, off); off = ke;
      const [, ve] = sftpReadStr(b, off); off = ve;
    }
  }

  const isDirectory = permissions !== undefined ? (permissions & 0xF000) === 0x4000 : false;
  const isSymlink   = permissions !== undefined ? (permissions & 0xF000) === 0xA000 : false;
  let permissionString: string | undefined;
  if (permissions !== undefined) {
    const chars = 'rwxrwxrwx';
    let s = '';
    for (let i = 8; i >= 0; i--) {
      s += (permissions >> i) & 1 ? chars[8 - i] : '-';
    }
    permissionString = (isDirectory ? 'd' : isSymlink ? 'l' : '-') + s;
  }

  return { size, uid, gid, permissions, atime, mtime, isDirectory, isSymlink, permissionString, consumed: off };
}

/** Check SSH_FXP_STATUS and throw a human-readable error if it's not OK. */
function checkStatus(type: number, payload: Uint8Array, operation: string): void {
  if (type !== SSH_FXP_STATUS) return;
  const code = readU32BE(payload, 0);
  if (code === SSH_FX_OK) return;
  const [msg] = payload.length > 4 ? sftpReadStr(payload, 4) : ['(no message)', 4];
  const codeNames: Record<number, string> = {
    1: 'EOF', 2: 'NO_SUCH_FILE', 3: 'PERMISSION_DENIED', 4: 'FAILURE',
    5: 'BAD_MESSAGE', 6: 'NO_CONNECTION', 7: 'CONNECTION_LOST', 8: 'OP_UNSUPPORTED',
  };
  throw new Error(`${operation} failed: ${codeNames[code] ?? `status ${code}`} — ${msg}`);
}

/**
 * Establish SSH+SFTP session from request params.
 *
 * INFRASTRUCTURE: This function uses openSSHSubsystem() from ssh2-impl.ts to
 * establish a full SSH connection and open the "sftp" subsystem channel. The
 * returned SSHSubsystemIO provides bidirectional channel data communication.
 *
 * DESIGN NOTE: This function is designed to work in a WebSocket context where
 * the SSH session persists across multiple SFTP operations. The returned
 * SFTPSession can be reused for hundreds of operations.
 *
 * CURRENT LIMITATION: When called from HTTP handlers (like handleSFTPStat),
 * the session is used for exactly one operation and then closed. This works
 * but is extremely inefficient (2-3 second overhead per operation).
 */
async function openSFTP(body: {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}): Promise<{ session: SFTPSession; io: SSHSubsystemIO }> {
  const { host, port = 22, username, password, privateKey, passphrase } = body;

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    throw Object.assign(new Error(getCloudflareErrorMessage(host, cfCheck.ip)), { isCloudflare: true });
  }

  const opts: SSHTerminalOptions = {
    host, port, username,
    authMethod: privateKey ? 'privateKey' : 'password',
    password,
    privateKey,
    passphrase,
  };

  const socket = connect(`${host}:${port}`);
  await socket.opened;

  const io = await openSSHSubsystem(socket, opts, 'sftp');

  // SFTP handshake: SSH_FXP_INIT → SSH_FXP_VERSION
  const sftp = new SFTPSession(io);
  await sftp.send(sftpPkt(SSH_FXP_INIT, null, u32BE(3)));
  const { type: verType } = await sftp.recv();
  if (verType !== SSH_FXP_VERSION) throw new Error(`Expected SSH_FXP_VERSION, got ${verType}`);

  return { session: sftp, io };
}

/** Common request body validation. */
function requireFields(body: Record<string, unknown>, ...fields: string[]): string | null {
  for (const f of fields) {
    if (!body[f]) return `Missing required field: ${f}`;
  }
  return null;
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/sftp/connect
 * SSH banner grab — no credentials needed.
 * Body: { host, port? }
 */
export async function handleSFTPConnect(request: Request): Promise<Response> {
  try {
    let body: { host?: string; port?: number; username?: string };
    if (request.method === 'POST') {
      body = await request.json();
    } else {
      const url = new URL(request.url);
      body = {
        host: url.searchParams.get('host') ?? '',
        port: url.searchParams.has('port') ? parseInt(url.searchParams.get('port')!) : undefined,
        username: url.searchParams.get('username') ?? undefined
      };
    }

    if (!body.host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!body.username) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: username' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port ?? 22;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const socket = connect(`${host}:${port}`);
    await socket.opened;
    const reader = socket.readable.getReader();
    const { value } = await reader.read();
    const banner = value ? new TextDecoder().decode(value).trim() : '';
    reader.releaseLock();
    await socket.close();

    const sshLine = banner.split('\n').find(l => l.startsWith('SSH-')) ?? '';
    const isSsh = sshLine.startsWith('SSH-');
    const parts = sshLine.startsWith('SSH-') ? sshLine.slice(4).split('-') : [];
    const protoVersion = parts[0] ?? '';
    const softwareVersion = parts.slice(1).join('-').trim();

    return new Response(JSON.stringify({
      success: true,
      host, port,
      sshBanner: banner,
      banner: banner, // Keep for backwards compatibility
      sshVersion: protoVersion,
      software: softwareVersion,
      sftpAvailable: isSsh,
      requiresAuth: true,
      message: `SFTP subsystem available via SSH ${protoVersion || '2.0'}. Use authenticated endpoints for file operations.`,
      note: 'SFTP subsystem typically available on all OpenSSH servers. Use authenticated endpoints for file operations.',
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST /api/sftp/list
 * List directory contents.
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path? }
 *
 * TODO: This operation requires a WebSocket tunnel to support bidirectional
 * SSH_MSG_CHANNEL_DATA communication. See top-of-file documentation for details.
 */
export async function handleSFTPList(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP list operation requires WebSocket tunnel for bidirectional SSH channel communication. HTTP request/response model cannot support the stateful SFTP protocol.',
    details: 'See sftp.ts documentation for architectural requirements and implementation steps.',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/download
 * Download a file (base64-encoded, up to 4 MB).
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path }
 *
 * TODO: This operation requires a WebSocket tunnel to support bidirectional
 * SSH_MSG_CHANNEL_DATA communication. See top-of-file documentation for details.
 */
export async function handleSFTPDownload(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP download operation requires WebSocket tunnel for bidirectional SSH channel communication. HTTP request/response model cannot support the stateful SFTP protocol.',
    details: 'See sftp.ts documentation for architectural requirements and implementation steps.',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/upload
 * Upload a file (content as base64 string).
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path, content, encoding? }
 *
 * TODO: This operation requires a WebSocket tunnel to support bidirectional
 * SSH_MSG_CHANNEL_DATA communication. See top-of-file documentation for details.
 */
export async function handleSFTPUpload(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP upload operation requires WebSocket tunnel for bidirectional SSH channel communication. HTTP request/response model cannot support the stateful SFTP protocol.',
    details: 'See sftp.ts documentation for architectural requirements and implementation steps.',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/delete
 * Delete a file.
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path }
 *
 * TODO: This operation requires a WebSocket tunnel to support bidirectional
 * SSH_MSG_CHANNEL_DATA communication. See top-of-file documentation for details.
 */
export async function handleSFTPDelete(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP delete operation requires WebSocket tunnel for bidirectional SSH channel communication. HTTP request/response model cannot support the stateful SFTP protocol.',
    details: 'See sftp.ts documentation for architectural requirements and implementation steps.',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/mkdir
 * Create a directory.
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path }
 *
 * TODO: This operation requires a WebSocket tunnel to support bidirectional
 * SSH_MSG_CHANNEL_DATA communication. See top-of-file documentation for details.
 */
export async function handleSFTPMkdir(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP mkdir operation requires WebSocket tunnel for bidirectional SSH channel communication. HTTP request/response model cannot support the stateful SFTP protocol.',
    details: 'See sftp.ts documentation for architectural requirements and implementation steps.',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/rename
 * Rename or move a file or directory.
 * Body: { host, port?, username, password?, privateKey?, passphrase?, oldPath, newPath }
 *
 * TODO: This operation requires a WebSocket tunnel to support bidirectional
 * SSH_MSG_CHANNEL_DATA communication. See top-of-file documentation for details.
 */
export async function handleSFTPRename(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP rename operation requires WebSocket tunnel for bidirectional SSH channel communication. HTTP request/response model cannot support the stateful SFTP protocol.',
    details: 'See sftp.ts documentation for architectural requirements and implementation steps.',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/stat
 * Get file or directory metadata.
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path }
 *
 * NOTE: This operation works via HTTP but is highly inefficient because it:
 *   1. Opens a full SSH connection (version exchange, key exchange, auth)
 *   2. Opens an SFTP subsystem channel
 *   3. Performs SFTP handshake (INIT → VERSION)
 *   4. Sends a single STAT request
 *   5. Closes the entire session
 *
 * For one-off stat operations, this overhead (2-3 seconds) is acceptable. However,
 * for multiple operations (e.g., listing a directory with stat() per file), this
 * creates a connection storm. A WebSocket-based session can reuse the SSH channel
 * for hundreds of operations in milliseconds.
 *
 * RECOMMENDATION: Use WebSocket session for any use case involving multiple SFTP
 * operations. Keep this HTTP endpoint for debugging/testing only.
 */
export async function handleSFTPStat(request: Request): Promise<Response> {
  try {
    const body = await request.json() as Record<string, unknown>;
    const err = requireFields(body, 'host', 'username', 'path');
    if (err) return new Response(JSON.stringify({ error: err }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    const path = body.path as string;
    const { session, io } = await openSFTP(body as Parameters<typeof openSFTP>[0]);

    try {
      const stId = session.id();
      const { type, payload } = await session.rpc(sftpPkt(SSH_FXP_STAT, stId, sftpStr(path)), stId);
      checkStatus(type, payload, 'STAT');
      if (type !== SSH_FXP_ATTRS) throw new Error(`Expected ATTRS, got ${type}`);
      const attrs = parseAttrs(payload, 0);
      await io.close();

      return new Response(JSON.stringify({
        success: true,
        path,
        isDirectory: attrs.isDirectory,
        isSymlink: attrs.isSymlink,
        size: attrs.size,
        permissions: attrs.permissions,
        permissionString: attrs.permissionString,
        uid: attrs.uid,
        gid: attrs.gid,
        atime: attrs.atime ? new Date(attrs.atime * 1000).toISOString() : undefined,
        mtime: attrs.mtime ? new Date(attrs.mtime * 1000).toISOString() : undefined,
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      await io.close().catch(() => {});
      throw e;
    }
  } catch (err) {
    const e = err as Error & { isCloudflare?: boolean };
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
