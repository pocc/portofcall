/**
 * SCP (Secure Copy Protocol) Support
 *
 * SCP transfers files over an SSH-encrypted channel. It runs entirely as an
 * SSH subsystem — there is no separate port or handshake distinct from SSH.
 * The SCP wire protocol (C/D/E/T messages) is negotiated after SSH login.
 *
 * This worker performs an SSH banner grab on the target host, which is the
 * observable TCP-level behavior of an SCP-capable server. The SSH banner
 * identifies the server software and version, confirming SCP availability.
 *
 * Port: 22 (TCP) — same as SSH
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

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
 * Handle SCP connectivity check (SSH banner grab)
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
        port: parseInt(url.searchParams.get('port') || '22'),
        timeout: parseInt(url.searchParams.get('timeout') || '10000'),
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

    // Check if behind Cloudflare
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
        // Read SSH identification string (server sends it first)
        const { value } = await reader.read();
        const raw = value ? new TextDecoder().decode(value) : '';

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
          message: `SSH server reachable — SCP is available`,
          note: `SCP runs as an SSH subsystem. Authentication and file transfer are negotiated inside the SSH session.`,
        };
      } catch (err) {
        try { await socket.close(); } catch (_) { /* ignore */ }
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
