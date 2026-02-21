/**
 * Varnish CLI (VCLI) Protocol Implementation
 *
 * The Varnish Cache daemon exposes an administration CLI interface on
 * port 6082 (by default). The protocol is text-based with a simple
 * request-response format.
 *
 * Connection Flow:
 *   1. Client connects to port 6082
 *   2. Server sends banner response:
 *      - 200 <len>\n<banner>\n  (no auth required)
 *      - 107 <len>\n<challenge>\n  (auth required)
 *   3. If auth required, client sends: auth <sha256_response>\n
 *   4. Client sends commands, each terminated by \n
 *   5. Server responds: <status> <len>\n<body>\n
 *
 * Response Status Codes:
 *   100 - Syntax error
 *   101 - Unknown request
 *   102 - Not implemented
 *   104 - Too few parameters
 *   105 - Too many parameters
 *   106 - Bad parameter
 *   107 - Authentication required
 *   200 - OK
 *   300 - Truncated result
 *   400 - Communication error
 *   500 - Close
 *
 * Authentication:
 *   The server sends a 32-byte hex nonce in the 107 response.
 *   The client computes: SHA256(nonce + "\n" + secret + "\n" + nonce + "\n")
 *   and sends: auth <hex_digest>
 *
 * Common Commands:
 *   ping [timestamp]   - Connectivity test, returns PONG + timestamp
 *   status             - Show child process status (running/stopped)
 *   banner             - Show the Varnish version banner
 *   backend.list       - List configured backends and health
 *   vcl.list           - List loaded VCL configurations
 *   param.show         - Show runtime parameters
 *
 * Use Cases:
 *   - Varnish Cache server discovery and health checking
 *   - Backend pool monitoring
 *   - VCL configuration auditing
 *   - Cache infrastructure monitoring
 */

import { connect } from 'cloudflare:sockets';

interface VarnishProbeRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface VarnishCommandRequest {
  host: string;
  port?: number;
  command: string;
  secret?: string;
  timeout?: number;
}

interface VarnishProbeResponse {
  success: boolean;
  host?: string;
  port?: number;
  authRequired?: boolean;
  banner?: string;
  challenge?: string;
  statusCode?: number;
  rtt?: number;
  error?: string;
}

interface VarnishCommandResponse {
  success: boolean;
  host?: string;
  port?: number;
  command?: string;
  statusCode?: number;
  body?: string;
  authenticated?: boolean;
  rtt?: number;
  error?: string;
}

/**
 * Parse a VCLI response: <status> <length>\n<body>\n
 * Returns the status code, body, and remaining data
 */
function parseVcliResponse(data: string): { status: number; length: number; body: string; remaining: string } | null {
  // Find the first line: "<status> <length>\n"
  const newlineIdx = data.indexOf('\n');
  if (newlineIdx === -1) return null;

  const firstLine = data.substring(0, newlineIdx);
  const match = firstLine.match(/^(\d+)\s+(\d+)$/);
  if (!match) return null;

  const status = parseInt(match[1], 10);
  const length = parseInt(match[2], 10);

  // Body starts after first \n and should be `length` bytes
  const bodyStart = newlineIdx + 1;
  const bodyEnd = bodyStart + length;

  // Check if we have enough data (body + trailing \n)
  if (data.length < bodyEnd + 1) return null;

  const body = data.substring(bodyStart, bodyEnd);
  const remaining = data.substring(bodyEnd + 1); // skip trailing \n

  return { status, length, body, remaining };
}

/**
 * Read data from the socket until we get a complete VCLI response
 */
async function readVcliResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 65536; // 64KB safety limit

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Read timeout')), timeout);
  });

  try {
    while (totalBytes < maxBytes) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) break;
      chunks.push(value);
      totalBytes += value.length;

      // Try to parse - check if we have a complete response
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder().decode(combined);

      // Try parsing the response
      const parsed = parseVcliResponse(text);
      if (parsed) break;
    }
  } catch (error) {
    if (chunks.length === 0) throw error;
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(result);
}

/**
 * Compute the Varnish auth response:
 * SHA256(challenge + "\n" + secret + "\n" + challenge + "\n")
 */
async function computeAuthResponse(challenge: string, secret: string): Promise<string> {
  const input = challenge + '\n' + secret + '\n' + challenge + '\n';
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * PROBE - Detect Varnish CLI and check auth requirements
 * Connects and reads the initial banner/challenge response
 */
export async function handleVarnishProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as VarnishProbeRequest;
    const { host, port = 6082, timeout = 10000 } = body;

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

    const startTime = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();

      // Read the initial banner/challenge
      const responseText = await readVcliResponse(reader, timeout);
      const rtt = Date.now() - startTime;

      reader.releaseLock();
      socket.close();

      // Parse the response
      const parsed = parseVcliResponse(responseText);

      if (!parsed) {
        return new Response(JSON.stringify({
          success: false,
          error: `Unexpected response from server`,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const result: VarnishProbeResponse = {
        success: true,
        host,
        port,
        statusCode: parsed.status,
        rtt,
      };

      if (parsed.status === 107) {
        // Authentication required
        result.authRequired = true;
        result.challenge = parsed.body.trim();
      } else if (parsed.status === 200) {
        // No auth, banner returned
        result.authRequired = false;
        result.banner = parsed.body.trim();
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }

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

/**
 * COMMAND - Execute a Varnish CLI command
 * Optionally authenticates with shared secret, then sends command
 */
export async function handleVarnishCommand(request: Request): Promise<Response> {
  try {
    const body = await request.json() as VarnishCommandRequest;
    const { host, port = 6082, command, secret, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!command) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Command is required',
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

    // Validate command - only allow safe read-only commands
    const safeCommands = ['ping', 'status', 'banner', 'backend.list', 'vcl.list', 'param.show', 'panic.show', 'storage.list', 'help'];
    const cmdBase = command.trim().split(/\s+/)[0].toLowerCase();
    if (!safeCommands.includes(cmdBase)) {
      return new Response(JSON.stringify({
        success: false,
        error: `Command not allowed. Safe commands: ${safeCommands.join(', ')}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Read the initial banner/challenge
      const bannerText = await readVcliResponse(reader, timeout);
      const bannerParsed = parseVcliResponse(bannerText);

      if (!bannerParsed) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to parse server banner',
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let authenticated = false;

      // Handle authentication if required
      if (bannerParsed.status === 107) {
        if (!secret) {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
          return new Response(JSON.stringify({
            success: false,
            error: 'Authentication required but no secret provided',
            authRequired: true,
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Compute auth response
        const challenge = bannerParsed.body.trim();
        const authHash = await computeAuthResponse(challenge, secret);
        await writer.write(new TextEncoder().encode(`auth ${authHash}\n`));

        // Read auth response
        const authResponseText = await readVcliResponse(reader, timeout);
        const authParsed = parseVcliResponse(authResponseText);

        if (!authParsed || authParsed.status !== 200) {
          writer.releaseLock();
          reader.releaseLock();
          socket.close();
          return new Response(JSON.stringify({
            success: false,
            error: 'Authentication failed',
            statusCode: authParsed?.status,
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        authenticated = true;
      }

      // Send the command
      await writer.write(new TextEncoder().encode(command.trim() + '\n'));

      // Read command response
      const cmdResponseText = await readVcliResponse(reader, timeout);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Parse response
      const cmdParsed = parseVcliResponse(cmdResponseText);

      if (!cmdParsed) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to parse command response',
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const result: VarnishCommandResponse = {
        success: true,
        host,
        port,
        command: command.trim(),
        statusCode: cmdParsed.status,
        body: cmdParsed.body,
        authenticated,
        rtt,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }

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


// === Write Command Handlers ===

interface VarnishWriteRequest {
  host: string;
  port?: number;
  secret: string;
  timeout?: number;
}

interface VarnishBanRequest extends VarnishWriteRequest {
  expr: string;
}

interface VarnishParamRequest extends VarnishWriteRequest {
  name: string;
  value: string;
}

interface VarnishWriteResponse {
  success: boolean;
  host?: string;
  port?: number;
  command?: string;
  statusCode?: number;
  body?: string;
  authenticated?: boolean;
  rtt?: number;
  error?: string;
}

/**
 * Shared helper: authenticate to Varnish CLI and run a single write command.
 * Follows the same connect/auth flow as handleVarnishCommand.
 */
async function runVarnishWrite(
  host: string,
  port: number,
  secret: string,
  command: string,
  timeout: number,
): Promise<{ statusCode: number; body: string; rtt: number }> {
  const socket = connect(`${host}:${port}`);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });
  await Promise.race([socket.opened, timeoutPromise]);
  const startTime = Date.now();
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  try {
    const bannerText = await readVcliResponse(reader, timeout);
    const bannerParsed = parseVcliResponse(bannerText);
    if (!bannerParsed) throw new Error('Failed to parse server banner');
    if (bannerParsed.status === 107) {
      const challenge = bannerParsed.body.trim();
      const authHash = await computeAuthResponse(challenge, secret);
      await writer.write(new TextEncoder().encode(`auth ${authHash}\n`));
      const authText = await readVcliResponse(reader, timeout);
      const authParsed = parseVcliResponse(authText);
      if (!authParsed || authParsed.status !== 200) {
        throw new Error(`Authentication failed (status ${authParsed?.status})`);
      }
    } else if (bannerParsed.status !== 200) {
      throw new Error(`Unexpected banner status: ${bannerParsed.status}`);
    }
    await writer.write(new TextEncoder().encode(`${command}\n`));
    const cmdText = await readVcliResponse(reader, timeout);
    const rtt = Date.now() - startTime;
    writer.releaseLock();
    reader.releaseLock();
    socket.close();
    const cmdParsed = parseVcliResponse(cmdText);
    if (!cmdParsed) throw new Error('Failed to parse command response');
    return { statusCode: cmdParsed.status, body: cmdParsed.body, rtt };
  } catch (err) {
    try { writer.releaseLock(); } catch { /* ignore */ }
    try { reader.releaseLock(); } catch { /* ignore */ }
    socket.close();
    throw err;
  }
}

/**
 * Handle Varnish ban -- authenticate then run ban {expr}.
 * POST body: { host, port?, secret, expr, timeout? }
 */
export async function handleVarnishBan(request: Request): Promise<Response> {
  try {
    const body = await request.json() as VarnishBanRequest;
    const { host, port = 6082, secret, timeout = 15000 } = body;
    const expr = body.expr;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' } satisfies VarnishWriteResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!secret) {
      return new Response(JSON.stringify({ success: false, error: 'Secret is required' } satisfies VarnishWriteResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!expr) {
      return new Response(JSON.stringify({ success: false, error: 'Ban expression is required' } satisfies VarnishWriteResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (/[\r\n]/.test(expr)) {
      return new Response(JSON.stringify({ success: false, error: 'Ban expression must not contain newlines' } satisfies VarnishWriteResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' } satisfies VarnishWriteResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cmd = `ban ${expr}`;
    const { statusCode, body: respBody, rtt } = await runVarnishWrite(host, port, secret, cmd, timeout);
    return new Response(JSON.stringify({
      success: statusCode === 200,
      host, port, command: cmd, statusCode, body: respBody, authenticated: true, rtt,
      error: statusCode !== 200 ? `Varnish returned status ${statusCode}: ${respBody.trim()}` : undefined,
    } satisfies VarnishWriteResponse), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies VarnishWriteResponse), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Varnish param.set -- authenticate then run param.set {name} {value}.
 * POST body: { host, port?, secret, name, value, timeout? }
 */
export async function handleVarnishParam(request: Request): Promise<Response> {
  try {
    const body = await request.json() as VarnishParamRequest;
    const { host, port = 6082, secret, timeout = 15000 } = body;
    const name = body.name;
    const value = body.value;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' } satisfies VarnishWriteResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!secret) {
      return new Response(JSON.stringify({ success: false, error: 'Secret is required' } satisfies VarnishWriteResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!name || value === undefined || value === null || value === '') {
      return new Response(JSON.stringify({ success: false, error: 'name and value are required' } satisfies VarnishWriteResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (/[\s\r\n]/.test(name)) {
      return new Response(JSON.stringify({ success: false, error: 'Parameter name must not contain whitespace or newlines' } satisfies VarnishWriteResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (/[\r\n]/.test(value)) {
      return new Response(JSON.stringify({ success: false, error: 'Parameter value must not contain newlines' } satisfies VarnishWriteResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' } satisfies VarnishWriteResponse), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cmd = `param.set ${name} ${value}`;
    const { statusCode, body: respBody, rtt } = await runVarnishWrite(host, port, secret, cmd, timeout);
    return new Response(JSON.stringify({
      success: statusCode === 200,
      host, port, command: cmd, statusCode, body: respBody, authenticated: true, rtt,
      error: statusCode !== 200 ? `Varnish returned status ${statusCode}: ${respBody.trim()}` : undefined,
    } satisfies VarnishWriteResponse), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies VarnishWriteResponse), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
