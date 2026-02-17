/**
 * ManageSieve Protocol Implementation (RFC 5804)
 *
 * ManageSieve is a text-based protocol for managing Sieve email filtering
 * scripts on mail servers (Dovecot, Cyrus IMAP). It's the "fourth pillar"
 * of the email stack alongside SMTP, POP3, and IMAP.
 *
 * Protocol Flow:
 * 1. Connect → Server sends capability listing (multi-line, ends with "OK")
 * 2. AUTHENTICATE "PLAIN" "<base64>" → OK/NO
 * 3. LISTSCRIPTS → List of scripts with active marker, then OK/NO
 * 4. GETSCRIPT "name" → Script content, then OK/NO
 * 5. PUTSCRIPT "name" {size+}\r\ncontent → OK/NO
 * 6. SETACTIVE "name" → OK/NO
 * 7. CAPABILITY → Re-fetch capabilities (useful post-auth)
 * 8. LOGOUT → BYE + OK
 *
 * Response Format:
 *   Quoted strings: "SIEVE" "fileinto reject"
 *   Literal strings: {size+}\r\ncontent
 *   Status: OK / NO / BYE (optionally with response codes and text)
 *
 * Default Port: 4190 (formerly 2000, reassigned by IANA)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface ManageSieveConnectRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface ManageSieveListRequest {
  host: string;
  port?: number;
  username: string;
  password: string;
  timeout?: number;
}

interface ManageSieveCapability {
  key: string;
  value: string;
}

interface ManageSieveResponse {
  success: boolean;
  capabilities?: ManageSieveCapability[];
  sieveExtensions?: string;
  implementation?: string;
  saslMethods?: string;
  starttls?: boolean;
  scripts?: Array<{ name: string; active: boolean }>;
  authenticated?: boolean;
  banner?: string;
  error?: string;
  isCloudflare?: boolean;
}

// --- Helpers ---

/**
 * Read all available data from a socket with timeout
 */
async function readFromSocket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<string> {
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
  if (done || !value) return '';
  chunks.push(decoder.decode(value));

  // Read more if available
  try {
    const shortTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('read_done')), 500),
    );
    while (true) {
      const { value: next, done: nextDone } = await Promise.race([reader.read(), shortTimeout]);
      if (nextDone || !next) break;
      chunks.push(decoder.decode(next));
    }
  } catch {
    // Short timeout - we have all data
  }

  return chunks.join('');
}

/**
 * Parse ManageSieve capability lines into structured data
 *
 * Example server banner:
 *   "IMPLEMENTATION" "Dovecot Pigeonhole"
 *   "SIEVE" "fileinto reject envelope body"
 *   "SASL" "PLAIN LOGIN"
 *   "STARTTLS"
 *   OK "ManageSieve ready"
 */
function parseCapabilities(response: string): {
  capabilities: ManageSieveCapability[];
  sieveExtensions?: string;
  implementation?: string;
  saslMethods?: string;
  starttls: boolean;
} {
  const capabilities: ManageSieveCapability[] = [];
  let sieveExtensions: string | undefined;
  let implementation: string | undefined;
  let saslMethods: string | undefined;
  let starttls = false;

  const lines = response.split('\r\n').filter((l) => l.length > 0);

  for (const line of lines) {
    // Skip status lines
    if (line.startsWith('OK') || line.startsWith('NO') || line.startsWith('BYE')) continue;

    // Parse "KEY" "VALUE" or "KEY"
    const match = line.match(/^"([^"]+)"(?:\s+"([^"]*)")?/);
    if (match) {
      const key = match[1];
      const value = match[2] || '';
      capabilities.push({ key, value });

      switch (key.toUpperCase()) {
        case 'SIEVE':
          sieveExtensions = value;
          break;
        case 'IMPLEMENTATION':
          implementation = value;
          break;
        case 'SASL':
          saslMethods = value;
          break;
        case 'STARTTLS':
          starttls = true;
          break;
      }
    }
  }

  return { capabilities, sieveExtensions, implementation, saslMethods, starttls };
}

/**
 * Parse LISTSCRIPTS response
 *
 * Example:
 *   "vacation" ACTIVE
 *   "spam-filter"
 *   "work-rules"
 *   OK "Listscripts completed."
 */
function parseScriptList(response: string): Array<{ name: string; active: boolean }> {
  const scripts: Array<{ name: string; active: boolean }> = [];
  const lines = response.split('\r\n').filter((l) => l.length > 0);

  for (const line of lines) {
    if (line.startsWith('OK') || line.startsWith('NO') || line.startsWith('BYE')) continue;

    const match = line.match(/^"([^"]+)"(?:\s+ACTIVE)?/);
    if (match) {
      scripts.push({
        name: match[1],
        active: line.includes('ACTIVE'),
      });
    }
  }

  return scripts;
}

/**
 * Check if response indicates success
 */
function isOK(response: string): boolean {
  const lines = response.trim().split('\r\n');
  const lastLine = lines[lines.length - 1];
  return lastLine.startsWith('OK');
}

// --- Input Validation ---

function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) {
    return 'Host is required';
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(host)) {
    return 'Host contains invalid characters';
  }

  if (port < 1 || port > 65535) {
    return 'Port must be between 1 and 65535';
  }

  return null;
}

// --- Handlers ---

/**
 * Handle ManageSieve connect (capability probe)
 *
 * POST /api/managesieve/connect
 * Body: { host, port?, timeout? }
 *
 * Connects and reads the server's capability banner
 */
export async function handleManageSieveConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as ManageSieveConnectRequest;
    const { host, port = 4190, timeout = 10000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies ManageSieveResponse),
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
        } satisfies ManageSieveResponse),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();

      // Read capability banner
      const bannerText = await readFromSocket(reader, timeoutPromise);
      reader.releaseLock();
      socket.close();

      if (!bannerText) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No response from server',
          } satisfies ManageSieveResponse),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const parsed = parseCapabilities(bannerText);

      return new Response(
        JSON.stringify({
          success: true,
          capabilities: parsed.capabilities,
          sieveExtensions: parsed.sieveExtensions,
          implementation: parsed.implementation,
          saslMethods: parsed.saslMethods,
          starttls: parsed.starttls,
          banner: bannerText.trim(),
        } satisfies ManageSieveResponse),
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
      } satisfies ManageSieveResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle ManageSieve LISTSCRIPTS (authenticate + list)
 *
 * POST /api/managesieve/list
 * Body: { host, port?, username, password, timeout? }
 *
 * Authenticates with SASL PLAIN and lists scripts
 */
export async function handleManageSieveList(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as ManageSieveListRequest;
    const { host, port = 4190, username, password, timeout = 10000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!username || username.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!password || password.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Password is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const encoder = new TextEncoder();
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Read capability banner
      const bannerText = await readFromSocket(reader, timeoutPromise);

      if (!isOK(bannerText)) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Server did not send valid capabilities',
            banner: bannerText.trim(),
          } satisfies ManageSieveResponse),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // SASL PLAIN authentication: \0username\0password → base64
      const authStr = `\0${username}\0${password}`;
      const authBase64 = btoa(authStr);
      await writer.write(encoder.encode(`AUTHENTICATE "PLAIN" "${authBase64}"\r\n`));

      const authResponse = await readFromSocket(reader, timeoutPromise);

      if (!isOK(authResponse)) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            authenticated: false,
            error: 'Authentication failed',
          } satisfies ManageSieveResponse),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // LISTSCRIPTS
      await writer.write(encoder.encode('LISTSCRIPTS\r\n'));

      const listResponse = await readFromSocket(reader, timeoutPromise);
      const scripts = parseScriptList(listResponse);

      // LOGOUT
      await writer.write(encoder.encode('LOGOUT\r\n'));
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          authenticated: true,
          scripts,
        } satisfies ManageSieveResponse),
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
      } satisfies ManageSieveResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

interface ManageSievePutScriptRequest {
  host: string;
  port?: number;
  username: string;
  password: string;
  scriptName: string;
  script: string;
  timeout?: number;
}

interface ManageSieveGetScriptRequest {
  host: string;
  port?: number;
  username: string;
  password: string;
  scriptName: string;
  timeout?: number;
}

interface ManageSieveDeleteScriptRequest {
  host: string;
  port?: number;
  username: string;
  password: string;
  scriptName: string;
  timeout?: number;
}

interface ManageSieveSetActiveRequest {
  host: string;
  port?: number;
  username: string;
  password: string;
  scriptName: string;
  timeout?: number;
}

/**
 * Perform PLAIN auth and return connected reader/writer, or throw on failure.
 * Caller is responsible for LOGOUT and socket.close().
 */
async function connectAndAuth(
  host: string,
  port: number,
  username: string,
  password: string,
  timeoutPromise: Promise<never>,
): Promise<{
  socket: ReturnType<typeof connect>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  encoder: TextEncoder;
}> {
  const socket = connect(`${host}:${port}`);
  await Promise.race([socket.opened, timeoutPromise]);

  const encoder = new TextEncoder();
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  // Read capability banner
  const bannerText = await readFromSocket(reader, timeoutPromise);
  if (!isOK(bannerText)) {
    writer.releaseLock();
    reader.releaseLock();
    socket.close();
    throw new Error('Server did not send valid capabilities');
  }

  // SASL PLAIN auth
  const authStr = `\0${username}\0${password}`;
  const authBase64 = btoa(authStr);
  await writer.write(encoder.encode(`AUTHENTICATE "PLAIN" "${authBase64}"\r\n`));

  const authResponse = await readFromSocket(reader, timeoutPromise);
  if (!isOK(authResponse)) {
    writer.releaseLock();
    reader.releaseLock();
    socket.close();
    throw new Error('Authentication failed');
  }

  return { socket, writer, reader, encoder };
}

/**
 * Handle ManageSieve PUTSCRIPT — upload or replace a Sieve script
 *
 * POST /api/managesieve/putscript
 * Body: { host, port?, username, password, scriptName, script, timeout? }
 */
export async function handleManageSievePutScript(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as ManageSievePutScriptRequest;
    const { host, port = 4190, username, password, scriptName, script, timeout = 10000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!username || username.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!password || password.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Password is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!scriptName || scriptName.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Script name is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (script === undefined || script === null) {
      return new Response(
        JSON.stringify({ success: false, error: 'Script content is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const startTime = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const { socket, writer, reader, encoder } = await connectAndAuth(host, port, username, password, timeoutPromise);

    try {
      const scriptBytes = new TextEncoder().encode(script).length;
      await writer.write(encoder.encode(`PUTSCRIPT "${scriptName}" {${scriptBytes}+}\r\n${script}\r\n`));

      const putResponse = await readFromSocket(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      // LOGOUT
      await writer.write(encoder.encode('LOGOUT\r\n'));
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (!isOK(putResponse)) {
        const errorLine = putResponse.trim().split('\r\n').find((l) => l.startsWith('NO') || l.startsWith('BYE')) || putResponse.trim();
        return new Response(
          JSON.stringify({
            success: false,
            error: `PUTSCRIPT failed: ${errorLine}`,
          } satisfies ManageSieveResponse),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          scriptName,
          scriptBytes,
          rtt,
        } as ManageSieveResponse & { host: string; port: number; scriptName: string; scriptBytes: number; rtt: number }),
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
      } satisfies ManageSieveResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle ManageSieve GETSCRIPT — retrieve a Sieve script by name
 *
 * POST /api/managesieve/getscript
 * Body: { host, port?, username, password, scriptName, timeout? }
 */
export async function handleManageSieveGetScript(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as ManageSieveGetScriptRequest;
    const { host, port = 4190, username, password, scriptName, timeout = 10000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!username || username.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!password || password.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Password is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!scriptName || scriptName.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Script name is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const startTime = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const { socket, writer, reader, encoder } = await connectAndAuth(host, port, username, password, timeoutPromise);

    try {
      await writer.write(encoder.encode(`GETSCRIPT "${scriptName}"\r\n`));

      const getResponse = await readFromSocket(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      // LOGOUT
      await writer.write(encoder.encode('LOGOUT\r\n'));
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (!isOK(getResponse)) {
        const errorLine = getResponse.trim().split('\r\n').find((l) => l.startsWith('NO') || l.startsWith('BYE')) || getResponse.trim();
        return new Response(
          JSON.stringify({
            success: false,
            error: `GETSCRIPT failed: ${errorLine}`,
          } satisfies ManageSieveResponse),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Parse literal: {<byteLen>}\r\n<content>\r\nOK
      // The response starts with {N}\r\n<script content>\r\nOK ...
      const literalMatch = getResponse.match(/^\{(\d+)\}\r\n([\s\S]*?)\r\nOK/);
      let scriptContent = '';
      let scriptBytes = 0;
      if (literalMatch) {
        scriptBytes = parseInt(literalMatch[1]);
        scriptContent = literalMatch[2];
      }

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          scriptName,
          script: scriptContent,
          scriptBytes,
          rtt,
        } as ManageSieveResponse & { host: string; port: number; scriptName: string; script: string; scriptBytes: number; rtt: number }),
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
      } satisfies ManageSieveResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle ManageSieve DELETESCRIPT — delete a Sieve script by name
 *
 * POST /api/managesieve/deletescript
 * Body: { host, port?, username, password, scriptName, timeout? }
 */
export async function handleManageSieveDeleteScript(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as ManageSieveDeleteScriptRequest;
    const { host, port = 4190, username, password, scriptName, timeout = 10000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!username || username.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!password || password.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Password is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!scriptName || scriptName.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Script name is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const startTime = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const { socket, writer, reader, encoder } = await connectAndAuth(host, port, username, password, timeoutPromise);

    try {
      await writer.write(encoder.encode(`DELETESCRIPT "${scriptName}"\r\n`));

      const deleteResponse = await readFromSocket(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      // LOGOUT
      await writer.write(encoder.encode('LOGOUT\r\n'));
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (!isOK(deleteResponse)) {
        const errorLine = deleteResponse.trim().split('\r\n').find((l) => l.startsWith('NO') || l.startsWith('BYE')) || deleteResponse.trim();
        return new Response(
          JSON.stringify({
            success: false,
            error: `DELETESCRIPT failed: ${errorLine}`,
          } satisfies ManageSieveResponse),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          scriptName,
          rtt,
        } as ManageSieveResponse & { host: string; port: number; scriptName: string; rtt: number }),
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
      } satisfies ManageSieveResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle ManageSieve SETACTIVE — activate a script (or deactivate all with empty name)
 *
 * POST /api/managesieve/setactive
 * Body: { host, port?, username, password, scriptName, timeout? }
 */
export async function handleManageSieveSetActive(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as ManageSieveSetActiveRequest;
    const { host, port = 4190, username, password, scriptName, timeout = 10000 } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!username || username.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Username is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!password || password.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Password is required' } satisfies ManageSieveResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const startTime = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const { socket, writer, reader, encoder } = await connectAndAuth(host, port, username, password, timeoutPromise);

    try {
      // Empty scriptName deactivates all scripts
      const name = scriptName || '';
      await writer.write(encoder.encode(`SETACTIVE "${name}"\r\n`));

      const setActiveResponse = await readFromSocket(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      // LOGOUT
      await writer.write(encoder.encode('LOGOUT\r\n'));
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (!isOK(setActiveResponse)) {
        const errorLine = setActiveResponse.trim().split('\r\n').find((l) => l.startsWith('NO') || l.startsWith('BYE')) || setActiveResponse.trim();
        return new Response(
          JSON.stringify({
            success: false,
            error: `SETACTIVE failed: ${errorLine}`,
          } satisfies ManageSieveResponse),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          scriptName: name,
          rtt,
        } as ManageSieveResponse & { host: string; port: number; scriptName: string; rtt: number }),
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
      } satisfies ManageSieveResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
