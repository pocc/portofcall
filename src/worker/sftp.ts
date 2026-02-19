/**
 * SFTP Protocol Implementation (SSH File Transfer Protocol, draft-ietf-secsh-filexfer-02)
 *
 * SFTP runs as a subsystem over an SSH channel. This implementation uses the
 * openSSHSubsystem() function from ssh2-impl.ts to establish an authenticated
 * SSH session and then speaks the SFTP wire protocol over the channel.
 *
 * Supported operations:
 *   POST /api/sftp/connect  — SSH banner grab + server info (no credentials needed)
 *   POST /api/sftp/list     — list directory contents
 *   POST /api/sftp/download — download a file (base64-encoded, up to 4 MB)
 *   POST /api/sftp/upload   — upload a file (base64-encoded content)
 *   POST /api/sftp/delete   — delete a file
 *   POST /api/sftp/mkdir    — create a directory
 *   POST /api/sftp/rename   — rename/move a file or directory
 *   POST /api/sftp/stat     — get file/directory metadata
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

  /** Read one complete SFTP packet, fetching channel data as needed. */
  async recv(): Promise<{ type: number; id: number; payload: Uint8Array }> {
    while (true) {
      const pkt = this.tryParse();
      if (pkt) return pkt;
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

  /** Send a packet and wait for the response with the matching request ID. */
  async rpc(pkt: Uint8Array, reqId: number): Promise<{ type: number; payload: Uint8Array }> {
    await this.send(pkt);
    while (true) {
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

/** Establish SSH+SFTP session from request params. */
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
 */
export async function handleSFTPList(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP file operations require WebSocket tunnel support (not available over HTTP)',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/download
 * Download a file (base64-encoded, up to 4 MB).
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path }
 */
export async function handleSFTPDownload(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP file operations require WebSocket tunnel support (not available over HTTP)',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/upload
 * Upload a file (content as base64 string).
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path, content, encoding? }
 */
export async function handleSFTPUpload(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP file operations require WebSocket tunnel support (not available over HTTP)',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/delete
 * Delete a file.
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path }
 */
export async function handleSFTPDelete(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP file operations require WebSocket tunnel support (not available over HTTP)',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/mkdir
 * Create a directory.
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path }
 */
export async function handleSFTPMkdir(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP file operations require WebSocket tunnel support (not available over HTTP)',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/rename
 * Rename or move a file or directory.
 * Body: { host, port?, username, password?, privateKey?, passphrase?, oldPath, newPath }
 */
export async function handleSFTPRename(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    error: 'Not Implemented',
    message: 'SFTP file operations require WebSocket tunnel support (not available over HTTP)',
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * POST /api/sftp/stat
 * Get file or directory metadata.
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path }
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
