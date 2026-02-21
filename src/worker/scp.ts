/**
 * SCP (Secure Copy Protocol) Support
 *
 * SCP transfers files over an SSH-encrypted channel. It runs as an SSH exec
 * channel — the client executes `scp -f /path` (download) or `scp -t /path`
 * (upload) as an SSH command, then exchanges the SCP wire protocol.
 *
 * SCP wire protocol (download, scp -f, client receives):
 *   1. Server → Client: '\0' (ready)
 *   2. Client → Server: '\0' (ready)
 *   3. Server → Client: ['T{mtime} 0 {atime} 0\n'] (optional timestamp)
 *   4. [Client → Server: '\0' (ACK timestamp)]
 *   5. Server → Client: 'C{mode} {size} {filename}\n' (control message)
 *   6. Client → Server: '\0' (ACK)
 *   7. Server → Client: {size} bytes of file content
 *   8. Server → Client: '\0' (EOF marker)
 *   9. Client → Server: '\0' (final ACK)
 *
 * SCP wire protocol (upload, scp -t, client sends):
 *   1. Client → Server: 'C{mode} {size} {filename}\n'
 *   2. Server → Client: '\0' (ACK)
 *   3. Client → Server: {size} bytes of file content
 *   4. Client → Server: '\0' (EOF marker)
 *   5. Server → Client: '\0' (final ACK)
 *
 * Error handling:
 *   - '\x01' + message + '\n' = warning (non-fatal)
 *   - '\x02' + message + '\n' = error (fatal, connection terminates)
 *
 * Directory listing uses SSH exec 'ls -la {path}' for compatibility.
 * Directory transfers ('D' messages) are not implemented.
 *
 * All operations require authentication (password or private key).
 *
 * Port: 22 (TCP) — same as SSH
 *
 * Endpoints:
 *   POST /api/scp/connect  — SSH banner grab (no credentials required)
 *   POST /api/scp/list     — list directory via SSH exec 'ls -la'
 *   POST /api/scp/get      — download a file via SCP protocol
 *   POST /api/scp/put      — upload a file via SCP protocol
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';
import { openSSHSubsystem, SSHTerminalOptions } from './ssh2-impl';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Escape a string for safe use in shell commands.
 * Wraps the string in single quotes and escapes any single quotes within.
 */
function shellEscape(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

/**
 * Convert Uint8Array to base64 string.
 * Uses proper chunking to avoid call stack issues with large arrays.
 */
function toBase64(data: Uint8Array): string {
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, Math.min(i + chunkSize, data.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export interface SCPConnectionOptions {
  host: string;
  port?: number;
  timeout?: number;
}

/**
 * Parse an SSH identification string (RFC 4253 §4.2)
 * Format: SSH-protoversion-softwareversion[ SP comments] CR LF
 */
function parseSSHBanner(raw: string): {
  protoVersion: string;
  softwareVersion: string;
  comments: string;
} {
  const line = raw.split('\n').find(l => l.startsWith('SSH-')) ?? raw.trim();
  const clean = line.replace(/\r?\n$/, '');
  const withoutSSH = clean.slice(4); // remove "SSH-"
  const dashIdx = withoutSSH.indexOf('-');
  if (dashIdx === -1) {
    return { protoVersion: '', softwareVersion: clean, comments: '' };
  }
  const protoVersion = withoutSSH.slice(0, dashIdx);
  const rest = withoutSSH.slice(dashIdx + 1);
  const spaceIdx = rest.indexOf(' ');
  const softwareVersion = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const comments = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1);
  return { protoVersion, softwareVersion, comments };
}

/**
 * Handle SCP connectivity check (SSH banner grab, no credentials needed)
 */
export async function handleSCPConnect(request: Request): Promise<Response> {
  try {
    let options: Partial<SCPConnectionOptions>;
    if (request.method === 'POST') {
      options = await request.json() as Partial<SCPConnectionOptions>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '22', 10),
        timeout: parseInt(url.searchParams.get('timeout') || '10000', 10),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 22;
    const timeoutMs = options.timeout || 10000;

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

      try {
        const { value } = await reader.read();
        const raw = value ? dec.decode(value) : '';

        const bannerLine = raw.split('\n').find(l => l.startsWith('SSH-')) ?? '';
        const isSsh = bannerLine.startsWith('SSH-');

        await socket.close();

        if (!isSsh) {
          return {
            success: false,
            host,
            port,
            banner: raw.trim(),
            message: 'Server did not send an SSH banner — SCP requires an SSH server on this port',
          };
        }

        const parsed = parseSSHBanner(bannerLine);

        return {
          success: true,
          host,
          port,
          banner: bannerLine.trim(),
          protoVersion: parsed.protoVersion,
          softwareVersion: parsed.softwareVersion,
          comments: parsed.comments,
          message: 'SSH server reachable — SCP is available. Use /api/scp/list or /api/scp/get with credentials.',
        };
      } catch (err) {
        try { await socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unexpected error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Collect all data from an SSH exec channel until EOF or timeout.
 */
async function collectExecOutput(
  readChannelData: () => Promise<Uint8Array | null>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let chunk: Uint8Array | null;
    try {
      const remaining = deadline - Date.now();
      chunk = await Promise.race([
        readChannelData(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('read timeout')), remaining)),
      ]);
    } catch {
      break;
    }
    if (chunk === null) break;
    chunks.push(chunk);
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Parse `ls -la` output into structured file entries.
 */
function parseLsOutput(raw: string): Array<{
  permissions: string;
  links: number;
  owner: string;
  group: string;
  size: number;
  date: string;
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
}> {
  const entries = [];
  for (const line of raw.split('\n')) {
    const m = line.match(
      /^([dlrwxs-]{10})\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+\s+\d+\s+[\d:]+)\s+(.+)$/
    );
    if (!m) continue;
    const [, perms, links, owner, group, size, date, name] = m;
    if (name === '.' || name === '..') continue;
    entries.push({
      permissions: perms,
      links: parseInt(links, 10),
      owner,
      group,
      size: parseInt(size, 10),
      date: date.trim(),
      name: name.trim(),
      type: (perms[0] === 'd' ? 'directory' : perms[0] === 'l' ? 'symlink' : perms[0] === '-' ? 'file' : 'other') as 'file' | 'directory' | 'symlink' | 'other',
    });
  }
  return entries;
}

/**
 * List directory contents via SSH exec 'ls -la {path}'.
 *
 * POST /api/scp/list
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path?, timeout? }
 * Returns: { success, entries: [{ permissions, links, owner, group, size, date, name, type }] }
 */
export async function handleSCPList(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; timeout?: number;
      username: string; password?: string; privateKey?: string; passphrase?: string;
      path?: string;
    };
    const { host, port = 22, timeout = 20000, username, password, privateKey, passphrase } = body;
    const path = body.path || '.';

    if (!host || !username) {
      return new Response(JSON.stringify({ success: false, error: 'host and username are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!password && !privateKey) {
      return new Response(JSON.stringify({ success: false, error: 'password or privateKey is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const tp = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, tp]);

      const opts: SSHTerminalOptions = {
        host, port, username,
        authMethod: privateKey ? 'privateKey' : 'password',
        password, privateKey, passphrase,
      };

      const { readChannelData, close } = await openSSHSubsystem(
        socket, opts, `ls -la ${shellEscape(path)}`, true,
      );

      try {
        const raw = await Promise.race([
          collectExecOutput(readChannelData, Math.min(timeout - (Date.now() - startTime), 10000)),
          tp,
        ]);

        const text = dec.decode(raw);
        const entries = parseLsOutput(text);
        const rtt = Date.now() - startTime;

        return {
          success: true,
          host, port, path,
          count: entries.length,
          entries,
          rawOutput: text.slice(0, 4096),
          rtt,
        };
      } finally {
        await close();
      }
    })();

    const result = await Promise.race([connectionPromise, tp]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Download a file via SCP wire protocol over SSH exec.
 *
 * The SCP download flow uses `scp -f {path}` as the exec command.
 * The protocol is:
 *   1. Client sends '\0' (ready to receive)
 *   2. Server sends control: 'C{mode} {size} {filename}\n'
 *   3. Client sends '\0' (ACK)
 *   4. Server sends {size} bytes of file content
 *   5. Server sends '\0' (EOF marker)
 *   6. Client sends '\0' (ACK)
 *
 * POST /api/scp/get
 * Body: { host, port?, username, password?, privateKey?, passphrase?, path, maxBytes?, timeout? }
 * Returns: { success, filename, size, mode, data (base64), rtt }
 */
export async function handleSCPGet(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; timeout?: number;
      username: string; password?: string; privateKey?: string; passphrase?: string;
      path: string; maxBytes?: number;
    };
    const { host, port = 22, timeout = 30000, username, password, privateKey, passphrase } = body;
    const path = body.path;
    const maxBytes = Math.min(body.maxBytes ?? 4 * 1024 * 1024, 16 * 1024 * 1024);

    if (!host || !username) {
      return new Response(JSON.stringify({ success: false, error: 'host and username are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!path) {
      return new Response(JSON.stringify({ success: false, error: 'path is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!password && !privateKey) {
      return new Response(JSON.stringify({ success: false, error: 'password or privateKey is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const tp = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, tp]);

      const opts: SSHTerminalOptions = {
        host, port, username,
        authMethod: privateKey ? 'privateKey' : 'password',
        password, privateKey, passphrase,
      };

      // scp -f = "from" mode (server sends, client receives)
      const { sendChannelData, readChannelData, close } = await openSSHSubsystem(
        socket, opts, `scp -f ${shellEscape(path)}`, true,
      );

      try {
        const deadline = Date.now() + Math.min(timeout - (Date.now() - startTime), 15000);

        // Step 1: Wait for initial ready signal from server
        const initialReady = await Promise.race([
          readChannelData(),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout waiting for server ready')), deadline - Date.now())),
        ]);
        if (initialReady === null || initialReady[0] !== 0x00) {
          throw new Error('Server did not send initial ready signal');
        }

        // Step 2: Send client ready signal
        await sendChannelData(new Uint8Array([0x00]));

        // Step 3: Read control message (may be T timestamp or C file)
        let controlLine = '';
        let timestampLine = '';

        while (!controlLine.endsWith('\n') && Date.now() < deadline) {
          const chunk = await Promise.race([
            readChannelData(),
            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), deadline - Date.now())),
          ]);
          if (chunk === null) break;
          controlLine += dec.decode(chunk);
        }

        controlLine = controlLine.trim();

        // Handle error responses
        if (controlLine.startsWith('\x01')) {
          throw new Error(`SCP warning: ${controlLine.slice(1).trim()}`);
        }
        if (controlLine.startsWith('\x02')) {
          throw new Error(`SCP error: ${controlLine.slice(1).trim()}`);
        }

        // Handle timestamp message (T)
        if (controlLine.startsWith('T')) {
          timestampLine = controlLine;
          // ACK timestamp
          await sendChannelData(new Uint8Array([0x00]));

          // Read next control message (should be C or D)
          controlLine = '';
          while (!controlLine.endsWith('\n') && Date.now() < deadline) {
            const chunk = await Promise.race([
              readChannelData(),
              new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), deadline - Date.now())),
            ]);
            if (chunk === null) break;
            controlLine += dec.decode(chunk);
          }
          controlLine = controlLine.trim();

          // Check again for errors
          if (controlLine.startsWith('\x01') || controlLine.startsWith('\x02')) {
            throw new Error(`SCP error: ${controlLine.slice(1).trim()}`);
          }
        }

        // Reject directory transfers (not implemented)
        if (controlLine.startsWith('D')) {
          await sendChannelData(enc.encode('\x02Directory transfers not supported\n'));
          throw new Error('Directory transfers not supported — use a single file path');
        }

        if (!controlLine.startsWith('C')) {
          throw new Error(`Unexpected SCP control message: ${JSON.stringify(controlLine.slice(0, 64))}`);
        }

        // Parse: C{mode} {size} {filename}
        const parts = controlLine.slice(1).split(' ');
        const mode = parts[0] || '0644';
        const fileSize = parseInt(parts[1] || '0', 10);
        const filename = parts.slice(2).join(' ').trim();

        // Validate filename doesn't contain path separators (security)
        if (filename.includes('/') || filename.includes('\\') || filename === '..' || filename === '.') {
          await sendChannelData(enc.encode('\x02Invalid filename\n'));
          throw new Error('Filename contains path separators or special names');
        }

        if (isNaN(fileSize) || fileSize < 0) {
          await sendChannelData(enc.encode('\x02Invalid file size\n'));
          throw new Error('Invalid file size in SCP control message');
        }

        if (fileSize > maxBytes) {
          await sendChannelData(enc.encode('\x02File too large\n'));
          throw new Error(`File size ${fileSize} exceeds maxBytes ${maxBytes}`);
        }

        // Step 4: ACK the control message
        await sendChannelData(new Uint8Array([0x00]));

        // Step 5: Read exactly fileSize bytes of file content
        const fileData = new Uint8Array(fileSize);
        let bytesRead = 0;

        while (bytesRead < fileSize && Date.now() < deadline) {
          const chunk = await Promise.race([
            readChannelData(),
            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), deadline - Date.now())),
          ]);
          if (chunk === null) break;

          const toCopy = Math.min(chunk.length, fileSize - bytesRead);
          fileData.set(chunk.subarray(0, toCopy), bytesRead);
          bytesRead += toCopy;
        }

        if (bytesRead !== fileSize) {
          throw new Error(`Incomplete file transfer: expected ${fileSize} bytes, got ${bytesRead}`);
        }

        // Step 6: Wait for EOF marker from server
        const eofMarker = await Promise.race([
          readChannelData(),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout waiting for EOF')), 1000)),
        ]).catch(() => null);

        if (eofMarker && eofMarker[0] !== 0x00) {
          throw new Error('Server did not send EOF marker (0x00)');
        }

        // Step 7: Send final ACK
        await sendChannelData(new Uint8Array([0x00]));

        const rtt = Date.now() - startTime;
        return {
          success: true,
          host, port, path,
          filename,
          mode,
          size: fileSize,
          timestamp: timestampLine || undefined,
          data: toBase64(fileData),
          rtt,
        };

      } finally {
        await close();
      }
    })();

    const result = await Promise.race([connectionPromise, tp]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Upload a file to a remote server via SCP (scp -t mode).
 *
 * SCP upload wire protocol (scp -t, server receives):
 *   1. Client → Server: 'C{mode} {size} {filename}\n'
 *   2. Server → Client: '\0'  (ACK)
 *   3. Client → Server: {size} bytes of file content
 *   4. Client → Server: '\0'  (EOF marker)
 *   5. Server → Client: '\0'  (final ACK)
 *
 * Body: { host, port?, username, password?, privateKey?, passphrase?,
 *         remotePath, filename?, mode?, data (base64) }
 */
export async function handleSCPPut(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; timeout?: number;
      username: string; password?: string; privateKey?: string; passphrase?: string;
      remotePath: string; filename?: string; mode?: string; data: string;
    };
    const { host, port = 22, timeout = 30000, username, password, privateKey, passphrase } = body;
    const remotePath = body.remotePath;
    const mode = body.mode ?? '0644';

    if (!host || !username) {
      return new Response(JSON.stringify({ success: false, error: 'host and username are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!remotePath) {
      return new Response(JSON.stringify({ success: false, error: 'remotePath is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const filename = body.filename ?? remotePath.split('/').pop() ?? 'file';
    if (!body.data) {
      return new Response(JSON.stringify({ success: false, error: 'data (base64) is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!password && !privateKey) {
      return new Response(JSON.stringify({ success: false, error: 'password or privateKey is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate and decode base64 data
    let fileData: Uint8Array;
    try {
      const raw = atob(body.data);
      fileData = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) fileData[i] = raw.charCodeAt(i);
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Invalid base64 data' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate mode format (should be octal, 4 digits)
    if (!/^[0-7]{4}$/.test(mode)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid mode format (must be 4-digit octal, e.g., 0644)' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate filename doesn't contain path separators
    if (filename.includes('/') || filename.includes('\\') || filename === '..' || filename === '.') {
      return new Response(JSON.stringify({ success: false, error: 'Filename contains path separators or special names' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({ success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const tp = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, tp]);

      const opts: SSHTerminalOptions = {
        host, port, username,
        authMethod: privateKey ? 'privateKey' : 'password',
        password, privateKey, passphrase,
      };

      const { sendChannelData, readChannelData, close } = await openSSHSubsystem(
        socket, opts, `scp -t ${shellEscape(remotePath)}`, true,
      );

      try {
        const deadline = Date.now() + Math.min(timeout - (Date.now() - startTime), 25000);

        // Read optional initial ready from server (some servers send \0 on start)
        await Promise.race([
          readChannelData(),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 500)),
        ]).catch(() => null);

        // Send control message
        const controlMsg = `C${mode} ${fileData.length} ${filename}\n`;
        await sendChannelData(enc.encode(controlMsg));

        // Wait for ACK (\0)
        const ack1 = await Promise.race([
          readChannelData(),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout waiting for ACK')), deadline - Date.now())),
        ]);
        if (ack1 !== null && ack1[0] !== 0) {
          throw new Error(`SCP error: ${dec.decode(ack1).slice(1).trim()}`);
        }

        // Send file content then EOF marker
        await sendChannelData(fileData);
        await sendChannelData(new Uint8Array([0x00]));

        // Read final ACK (best-effort)
        await Promise.race([
          readChannelData(),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
        ]).catch(() => null);

        return {
          success: true,
          host, port, remotePath, filename,
          bytesUploaded: fileData.length,
          rtt: Date.now() - startTime,
        };

      } finally {
        await close();
      }
    })();

    const putResult = await Promise.race([connectionPromise, tp]);
    return new Response(JSON.stringify(putResult), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'SCP put failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
