/**
 * FTPS (FTP over TLS) Protocol Implementation
 *
 * Implements implicit FTPS connectivity testing (RFC 4217).
 * Connects via TLS to port 990 and reads the server banner,
 * then optionally sends FEAT to discover supported features.
 *
 * Protocol:
 * - Implicit FTPS: TLS from the start on port 990
 * - Same FTP commands but over encrypted channel
 * - Server sends 220 welcome banner after TLS handshake
 *
 * Use Cases:
 * - Secure file transfer server discovery
 * - FTPS server version fingerprinting
 * - TLS certificate and cipher verification
 * - Feature detection (FEAT command)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Read a complete FTP response (may be multi-line)
 */
function parseFTPResponse(text: string): { code: number; message: string; lines: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const code = parseInt(lines[0]?.substring(0, 3) || '0', 10);
  const message = lines[0]?.substring(4) || '';
  return { code, message, lines };
}

/**
 * Handle FTPS connection test
 */
export async function handleFTPSConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 990, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
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

    const startTime = Date.now();

    // Connect with implicit TLS
    const socket = connect(`${host}:${port}`, {
      secureTransport: 'on',
      allowHalfOpen: false,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    // Helper to read response with timeout
    const readResponse = async (): Promise<string> => {
      let responseText = '';
      const readTimeout = new Promise<{ value: undefined; done: true }>((resolve) => {
        setTimeout(() => resolve({ value: undefined, done: true }), Math.min(timeout, 5000));
      });

      while (true) {
        const result = await Promise.race([reader.read(), readTimeout]);
        if (result.done || !result.value) break;
        responseText += decoder.decode(result.value, { stream: true });
        // Check if we have a complete FTP response (ends with \r\n and has 3-digit code)
        if (/^\d{3} .+\r?\n$/m.test(responseText)) break;
        if (/^\d{3}-.+\r?\n\d{3} .+\r?\n$/ms.test(responseText)) break;
      }

      return responseText.trim();
    };

    // Read welcome banner
    const bannerText = await Promise.race([readResponse(), timeoutPromise]) as string;
    const banner = parseFTPResponse(bannerText);

    if (banner.code < 200 || banner.code >= 300) {
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
      return new Response(JSON.stringify({
        success: false,
        error: `FTPS server error: ${bannerText}`,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Send FEAT to discover features
    let features: string[] = [];
    let featRaw = '';
    try {
      await writer.write(encoder.encode('FEAT\r\n'));
      featRaw = await Promise.race([readResponse(), timeoutPromise]) as string;
      const featParsed = parseFTPResponse(featRaw);
      if (featParsed.code === 211) {
        // Extract feature lines (lines between 211- and 211 End)
        features = featParsed.lines
          .slice(1) // skip first "211-" line
          .filter(l => !l.startsWith('211 '))
          .map(l => l.trim());
      }
    } catch {
      // FEAT not supported - that's ok
    }

    // Send SYST to get system type
    let systemType = '';
    try {
      await writer.write(encoder.encode('SYST\r\n'));
      const systRaw = await Promise.race([readResponse(), timeoutPromise]) as string;
      const systParsed = parseFTPResponse(systRaw);
      if (systParsed.code === 215) {
        systemType = systParsed.message;
      }
    } catch {
      // SYST not supported
    }

    // Send QUIT
    try {
      await writer.write(encoder.encode('QUIT\r\n'));
    } catch {
      // Ignore quit errors
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      connectTime,
      encrypted: true,
      protocol: 'FTPS (Implicit TLS)',
      banner: {
        code: banner.code,
        message: banner.message,
        raw: bannerText,
      },
      systemType: systemType || undefined,
      features: features.length > 0 ? features : undefined,
      tlsFeatures: {
        authTls: features.some(f => f.toUpperCase().includes('AUTH TLS')),
        pbsz: features.some(f => f.toUpperCase().includes('PBSZ')),
        prot: features.some(f => f.toUpperCase().includes('PROT')),
        utf8: features.some(f => f.toUpperCase().includes('UTF8')),
        mlst: features.some(f => f.toUpperCase().includes('MLST')),
        epsv: features.some(f => f.toUpperCase().includes('EPSV')),
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ---------------------------------------------------------------------------
// FTPSSession — stateful wrapper around a TLS control socket
// ---------------------------------------------------------------------------

/**
 * Wraps a Cloudflare TLS socket with FTP-aware send/receive helpers.
 * One instance represents a single authenticated FTPS control connection.
 */
export class FTPSSession {
  private socket: ReturnType<typeof connect>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(socket: ReturnType<typeof connect>) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  /** Send an FTP command followed by CRLF. */
  async sendCommand(cmd: string): Promise<void> {
    await this.writer.write(this.encoder.encode(cmd + '\r\n'));
  }

  /**
   * Read a complete (possibly multi-line) FTP response.
   * Multi-line responses start with "NNN-" and end with "NNN <text>\r\n".
   * Resolves as soon as a terminal line is detected or timeoutMs elapses.
   */
  async readResponse(timeoutMs: number): Promise<{ code: number; message: string; lines: string[]; raw: string }> {
    let buffer = '';
    let timedOut = false;

    const timer = new Promise<void>(resolve => {
      setTimeout(() => { timedOut = true; resolve(); }, timeoutMs);
    });

    const isComplete = (text: string): boolean => {
      // A single-line response: "NNN <text>\r\n"
      if (/^\d{3} [^\r\n]*\r?\n/m.test(text)) {
        // But only if the LAST matching line is a terminal line (not a continuation)
        const lines = text.split(/\r?\n/).filter(l => l.length > 0);
        const last = lines[lines.length - 1];
        return /^\d{3} /.test(last);
      }
      return false;
    };

    while (!timedOut) {
      const readPromise = this.reader.read();
      const result = await Promise.race([readPromise, timer.then(() => ({ done: true as const, value: undefined }))]);
      if (result.done || !result.value) break;
      buffer += this.decoder.decode(result.value, { stream: true });
      if (isComplete(buffer)) break;
    }

    const raw = buffer.trim();
    const parsed = parseFTPResponse(raw);
    return { ...parsed, raw };
  }

  /**
   * Send PASV and parse the "h1,h2,h3,h4,p1,p2" tuple in the response.
   * Returns the data channel host and port.
   */
  async enterPassiveMode(timeoutMs: number): Promise<{ host: string; port: number }> {
    await this.sendCommand('PASV');
    const resp = await this.readResponse(timeoutMs);
    if (resp.code !== 227) {
      throw new Error(`PASV failed: ${resp.code} ${resp.message}`);
    }
    // 227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)
    const match = resp.raw.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
    if (!match) {
      throw new Error(`Could not parse PASV response: ${resp.raw}`);
    }
    const [, h1, h2, h3, h4, p1, p2] = match;
    const host = `${h1}.${h2}.${h3}.${h4}`;
    const p1Num = parseInt(p1, 10);
    const p2Num = parseInt(p2, 10);
    if (isNaN(p1Num) || isNaN(p2Num) || p1Num < 0 || p1Num > 255 || p2Num < 0 || p2Num > 255) {
      throw new Error('Invalid PASV response: port octets out of range');
    }
    const port = p1Num * 256 + p2Num;
    return { host, port };
  }

  /**
   * Open a data channel connection.
   * Implicit FTPS encrypts data channels too, so secureTransport is 'on'.
   */
  openDataSocket(host: string, port: number): ReturnType<typeof connect> {
    return connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
  }

  /**
   * Send QUIT, release reader/writer locks, and close the control socket.
   */
  async close(): Promise<void> {
    try {
      await this.sendCommand('QUIT');
    } catch {
      // Ignore errors during quit
    }
    try { this.writer.releaseLock(); } catch { /* ignore */ }
    try { this.reader.releaseLock(); } catch { /* ignore */ }
    try { this.socket.close(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/**
 * Open a TLS control socket and return a new FTPSSession.
 */
export async function openFTPSSession(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<FTPSSession> {
  const socket = connect(`${host}:${port}`, {
    secureTransport: 'on',
    allowHalfOpen: false,
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeoutMs);
  });

  await Promise.race([socket.opened, timeoutPromise]);
  return new FTPSSession(socket);
}

/**
 * Read the welcome banner then send USER / PASS and set binary transfer mode.
 * Throws on any failure so callers can handle errors uniformly.
 */
export async function authenticateFTPSSession(
  session: FTPSSession,
  username: string,
  password: string,
  timeoutMs: number,
): Promise<void> {
  // Read welcome banner (220)
  const banner = await session.readResponse(timeoutMs);
  if (banner.code !== 220) {
    throw new Error(`Unexpected banner: ${banner.code} ${banner.message}`);
  }

  // Send username
  await session.sendCommand(`USER ${username}`);
  const userResp = await session.readResponse(timeoutMs);
  // 331 = password required, 230 = logged in without password
  if (userResp.code !== 331 && userResp.code !== 230) {
    throw new Error(`USER failed: ${userResp.code} ${userResp.message}`);
  }

  if (userResp.code === 331) {
    // Send password
    await session.sendCommand(`PASS ${password}`);
    const passResp = await session.readResponse(timeoutMs);
    if (passResp.code !== 230) {
      throw new Error(`PASS failed: ${passResp.code} ${passResp.message}`);
    }
  }

  // Set binary / image transfer type
  await session.sendCommand('TYPE I');
  const typeResp = await session.readResponse(timeoutMs);
  if (typeResp.code !== 200) {
    throw new Error(`TYPE I failed: ${typeResp.code} ${typeResp.message}`);
  }
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

/**
 * POST {host, port, username, password, timeout?}
 * Authenticates and returns server info (PWD + SYST).
 */
export async function handleFTPSLogin(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username: string;
      password: string;
      timeout?: number;
    };

    const { host, port = 990, username, password, timeout = 15000 } = body;

    if (!host || !username || !password) {
      return new Response(JSON.stringify({
        success: false,
        error: 'host, username, and password are required',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const session = await openFTPSSession(host, port, timeout);

    try {
      await authenticateFTPSSession(session, username, password, timeout);

      // Get current working directory
      await session.sendCommand('PWD');
      const pwdResp = await session.readResponse(timeout);
      let cwd = '';
      if (pwdResp.code === 257) {
        const m = pwdResp.message.match(/"([^"]+)"/);
        cwd = m ? m[1] : pwdResp.message;
      }

      // Get system type
      await session.sendCommand('SYST');
      const systResp = await session.readResponse(timeout);
      const systemType = systResp.code === 215 ? systResp.message : '';

      await session.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        cwd,
        systemType: systemType || undefined,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      await session.close();
      throw err;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Parsed representation of a single entry from an FTP LIST response.
 */
interface FTPEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'unknown';
  size?: number;
  permissions?: string;
  raw: string;
}

/**
 * Parse Unix-style `ls -l` FTP LIST output into structured entries.
 */
function parseFTPListOutput(raw: string): FTPEntry[] {
  return raw
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0 && !line.startsWith('total'))
    .map(line => {
      // Unix long listing: drwxr-xr-x  2 user group 4096 Jan  1 12:00 dirname
      const match = line.match(
        /^([dlrwxstST\-]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.+)$/,
      );
      if (match) {
        const [, perms, sizeStr, name] = match;
        let type: FTPEntry['type'] = 'unknown';
        if (perms[0] === 'd') type = 'directory';
        else if (perms[0] === '-') type = 'file';
        else if (perms[0] === 'l') type = 'symlink';
        return { name: name.trim(), type, size: parseInt(sizeStr, 10), permissions: perms, raw: line };
      }
      // Fallback — just return the raw line
      return { name: line.trim(), type: 'unknown' as const, raw: line };
    });
}

/**
 * POST {host, port, username, password, path?, timeout?}
 * Authenticates, enters passive mode, sends LIST, and returns a parsed file list.
 */
export async function handleFTPSList(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username: string;
      password: string;
      path?: string;
      timeout?: number;
    };

    const { host, port = 990, username, password, path = '.', timeout = 15000 } = body;

    if (!host || !username || !password) {
      return new Response(JSON.stringify({
        success: false,
        error: 'host, username, and password are required',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const session = await openFTPSSession(host, port, timeout);

    try {
      await authenticateFTPSSession(session, username, password, timeout);

      // Change to the requested directory if specified
      if (path && path !== '.') {
        await session.sendCommand(`CWD ${path}`);
        const cwdResp = await session.readResponse(timeout);
        if (cwdResp.code !== 250) {
          throw new Error(`CWD failed: ${cwdResp.code} ${cwdResp.message}`);
        }
      }

      // Enter passive mode to get data channel coordinates
      const { host: dataHost, port: dataPort } = await session.enterPassiveMode(timeout);

      // Open data socket (encrypted — implicit FTPS)
      const dataSocket = session.openDataSocket(dataHost, dataPort);

      // Send LIST command and await both the data connection and the 150 response
      await session.sendCommand('LIST');
      const [listResp] = await Promise.all([
        session.readResponse(timeout),
        dataSocket.opened,
      ]);

      if (listResp.code !== 125 && listResp.code !== 150) {
        await dataSocket.close();
        throw new Error(`LIST failed: ${listResp.code} ${listResp.message}`);
      }

      // Read all data from data socket
      const dataReader = dataSocket.readable.getReader();
      const decoder = new TextDecoder();
      let rawListing = '';

      while (true) {
        const { done, value } = await dataReader.read();
        if (done || !value) break;
        rawListing += decoder.decode(value, { stream: true });
      }
      dataReader.releaseLock();
      dataSocket.close();

      // Read the 226 Transfer complete response
      await session.readResponse(timeout);

      await session.close();

      const entries = parseFTPListOutput(rawListing);

      return new Response(JSON.stringify({
        success: true,
        path,
        entries,
        count: entries.length,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      await session.close();
      throw err;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST {host, port, username, password, path, timeout?}
 * Authenticates, downloads the file at `path`, and returns its content base64-encoded.
 */
export async function handleFTPSDownload(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username: string;
      password: string;
      path: string;
      timeout?: number;
    };

    const { host, port = 990, username, password, path, timeout = 30000 } = body;

    if (!host || !username || !password || !path) {
      return new Response(JSON.stringify({
        success: false,
        error: 'host, username, password, and path are required',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const session = await openFTPSSession(host, port, timeout);

    try {
      await authenticateFTPSSession(session, username, password, timeout);

      // Enter passive mode
      const { host: dataHost, port: dataPort } = await session.enterPassiveMode(timeout);

      // Open data socket
      const dataSocket = session.openDataSocket(dataHost, dataPort);

      // Send RETR and await both data connection and the 150/125 response
      await session.sendCommand(`RETR ${path}`);
      const [retrResp] = await Promise.all([
        session.readResponse(timeout),
        dataSocket.opened,
      ]);

      if (retrResp.code !== 125 && retrResp.code !== 150) {
        await dataSocket.close();
        throw new Error(`RETR failed: ${retrResp.code} ${retrResp.message}`);
      }

      // Collect raw bytes from data socket
      const dataReader = dataSocket.readable.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await dataReader.read();
        if (done || !value) break;
        chunks.push(value);
      }
      dataReader.releaseLock();
      dataSocket.close();

      // Read the 226 Transfer complete response
      await session.readResponse(timeout);

      await session.close();

      // Combine chunks and base64-encode
      const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }

      // btoa via binary string
      let binary = '';
      for (let i = 0; i < combined.byteLength; i++) {
        binary += String.fromCharCode(combined[i]);
      }
      const base64 = btoa(binary);

      return new Response(JSON.stringify({
        success: true,
        path,
        size: totalLength,
        content: base64,
        encoding: 'base64',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      await session.close();
      throw err;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST {host, port, username, password, path, content (base64), timeout?}
 * Authenticates and uploads base64-decoded content to `path` on the server.
 */
export async function handleFTPSUpload(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username: string;
      password: string;
      path: string;
      content: string; // base64-encoded file content
      timeout?: number;
    };

    const { host, port = 990, username, password, path, content, timeout = 30000 } = body;

    if (!host || !username || !password || !path || !content) {
      return new Response(JSON.stringify({
        success: false,
        error: 'host, username, password, path, and content are required',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Decode base64 content to bytes
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const session = await openFTPSSession(host, port, timeout);

    try {
      await authenticateFTPSSession(session, username, password, timeout);

      // Enter passive mode
      const { host: dataHost, port: dataPort } = await session.enterPassiveMode(timeout);

      // Open data socket
      const dataSocket = session.openDataSocket(dataHost, dataPort);

      // Send STOR and await both data connection opening and the 150/125 response
      await session.sendCommand(`STOR ${path}`);
      const [storResp] = await Promise.all([
        session.readResponse(timeout),
        dataSocket.opened,
      ]);

      if (storResp.code !== 125 && storResp.code !== 150) {
        await dataSocket.close();
        throw new Error(`STOR failed: ${storResp.code} ${storResp.message}`);
      }

      // Write data to data socket then close it to signal EOF
      const dataWriter = dataSocket.writable.getWriter();
      await dataWriter.write(bytes);
      dataWriter.releaseLock();
      dataSocket.close();

      // Read the 226 Transfer complete response
      const doneResp = await session.readResponse(timeout);
      if (doneResp.code !== 226 && doneResp.code !== 250) {
        throw new Error(`Upload did not complete cleanly: ${doneResp.code} ${doneResp.message}`);
      }

      await session.close();

      return new Response(JSON.stringify({
        success: true,
        path,
        bytesUploaded: bytes.byteLength,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      await session.close();
      throw err;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function handleFTPSDelete(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username: string;
      password: string;
      path: string;
      type?: 'file' | 'dir';
      timeout?: number;
    };
    const { host, port = 990, username, password, path, type = 'file', timeout = 10000 } = body;
    if (!host || !username || !path) {
      return new Response(JSON.stringify({ success: false, error: 'host, username, path required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const session = await openFTPSSession(host, port, timeout);
    try {
      await authenticateFTPSSession(session, username, password, timeout);

      const cmd = type === 'dir' ? `RMD ${path}` : `DELE ${path}`;
      await session.sendCommand(cmd);
      const resp = await session.readResponse(timeout);

      if (resp.code !== 250 && resp.code !== 257) {
        throw new Error(`Delete failed: ${resp.code} ${resp.message}`);
      }

      await session.close();
      return new Response(JSON.stringify({
        success: true,
        path,
        type,
        message: resp.message,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      await session.close();
      throw err;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function handleFTPSMkdir(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username: string;
      password: string;
      path: string;
      timeout?: number;
    };
    const { host, port = 990, username, password, path, timeout = 10000 } = body;
    if (!host || !username || !path) {
      return new Response(JSON.stringify({ success: false, error: 'host, username, path required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const session = await openFTPSSession(host, port, timeout);
    try {
      await authenticateFTPSSession(session, username, password, timeout);

      await session.sendCommand(`MKD ${path}`);
      const resp = await session.readResponse(timeout);
      if (resp.code !== 257) {
        throw new Error(`MKD failed: ${resp.code} ${resp.message}`);
      }

      // RFC 959: 257 reply contains quoted path e.g. 257 "/new/dir" created
      const match = resp.message.match(/"([^"]+)"/);
      const createdPath = match ? match[1] : path;

      await session.close();
      return new Response(JSON.stringify({
        success: true,
        path: createdPath,
        message: resp.message,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      await session.close();
      throw err;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function handleFTPSRename(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      username: string;
      password: string;
      from: string;
      to: string;
      timeout?: number;
    };
    const { host, port = 990, username, password, from, to, timeout = 10000 } = body;
    if (!host || !username || !from || !to) {
      return new Response(JSON.stringify({ success: false, error: 'host, username, from, to required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const session = await openFTPSSession(host, port, timeout);
    try {
      await authenticateFTPSSession(session, username, password, timeout);

      // RNFR must respond with 350 (Ready for destination name)
      await session.sendCommand(`RNFR ${from}`);
      const rnfrResp = await session.readResponse(timeout);
      if (rnfrResp.code !== 350) {
        throw new Error(`RNFR failed: ${rnfrResp.code} ${rnfrResp.message}`);
      }

      // RNTO completes the rename
      await session.sendCommand(`RNTO ${to}`);
      const rntoResp = await session.readResponse(timeout);
      if (rntoResp.code !== 250) {
        throw new Error(`RNTO failed: ${rntoResp.code} ${rntoResp.message}`);
      }

      await session.close();
      return new Response(JSON.stringify({
        success: true,
        from,
        to,
        message: rntoResp.message,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      await session.close();
      throw err;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
