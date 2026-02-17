/**
 * SVN (Subversion) Protocol Implementation
 *
 * Subversion uses a custom wire protocol over TCP (port 3690) called
 * "svnserve" for native repository access. The protocol uses
 * parenthesized S-expression-like encoding.
 *
 * Protocol Flow:
 * 1. Client connects to server port 3690
 * 2. Server sends greeting with version, capabilities, and auth mechanisms
 * 3. Client responds with version and URL
 * 4. Server sends auth challenge or success
 *
 * Greeting Format (S-expression):
 *   ( success ( min-ver max-ver ( cap1 cap2 ... ) ( mech1 mech2 ... ) ) )
 *
 * Example:
 *   ( success ( 2 2 ( ) ( edit-pipeline svndiff1 absent-entries ) ) )
 *
 * Use Cases:
 * - Verify SVN server reachability
 * - Detect svnserve version and capabilities
 * - Enumerate supported authentication mechanisms
 * - Repository path validation
 */

import { connect } from 'cloudflare:sockets';

interface SVNConnectRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface SVNConnectResponse {
  success: boolean;
  host?: string;
  port?: number;
  greeting?: string;
  minVersion?: number;
  maxVersion?: number;
  capabilities?: string[];
  authMechanisms?: string[];
  rtt?: number;
  error?: string;
}

/**
 * Parse an SVN protocol S-expression greeting
 *
 * The greeting format is:
 *   ( success ( min-ver max-ver ( cap1 cap2 ... ) ( mech1 mech2 ... ) ) )
 *
 * Or on error:
 *   ( failure ( ( error-code error-msg file line ) ) )
 */
function parseSvnGreeting(raw: string): {
  success: boolean;
  minVersion?: number;
  maxVersion?: number;
  capabilities?: string[];
  authMechanisms?: string[];
  error?: string;
} {
  const trimmed = raw.trim();

  // Check for failure response
  if (trimmed.startsWith('( failure')) {
    const errorMatch = trimmed.match(/\(\s*\d+\s+"?([^")\n]+)"?\s/);
    return {
      success: false,
      error: errorMatch ? errorMatch[1].trim() : 'Server returned failure',
    };
  }

  // Check for success response
  if (!trimmed.startsWith('( success')) {
    return {
      success: false,
      error: `Unexpected response format: ${trimmed.substring(0, 100)}`,
    };
  }

  // Parse version numbers
  const versionMatch = trimmed.match(/success\s+\(\s*(\d+)\s+(\d+)/);
  const minVersion = versionMatch ? parseInt(versionMatch[1]) : undefined;
  const maxVersion = versionMatch ? parseInt(versionMatch[2]) : undefined;

  // Parse capabilities and auth mechanisms from parenthesized groups
  const capabilities: string[] = [];
  const authMechanisms: string[] = [];

  // Find all parenthesized groups
  const groupRegex = /\(\s*([^()]*)\s*\)/g;
  const groups: string[] = [];
  let match;

  while ((match = groupRegex.exec(trimmed)) !== null) {
    groups.push(match[1].trim());
  }

  // groups[0] = outer "success ( ... )"
  // groups[1] = inner version wrapper
  // groups[2] = capabilities list
  // groups[3] = auth mechanisms list

  if (groups.length >= 3) {
    const capWords = groups[2].split(/\s+/).filter(w => w.length > 0);
    capabilities.push(...capWords);
  }

  if (groups.length >= 4) {
    const mechWords = groups[3].split(/\s+/).filter(w => w.length > 0);
    authMechanisms.push(...mechWords);
  }

  return {
    success: true,
    minVersion,
    maxVersion,
    capabilities,
    authMechanisms,
  };
}

/**
 * Probe an SVN server and read its greeting
 */
export async function handleSVNConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SVNConnectRequest;
    const { host, port = 3690, timeout = 10000 } = body;

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

      // SVN server sends greeting immediately upon connection
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxBytes = 8192;

      try {
        while (totalBytes < maxBytes) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);

          if (done) break;

          if (value) {
            chunks.push(value);
            totalBytes += value.length;

            // Check if we have a complete S-expression
            const combined = combineChunks(chunks, totalBytes);
            const text = new TextDecoder().decode(combined);

            let depth = 0;
            let complete = false;
            for (const ch of text) {
              if (ch === '(') depth++;
              if (ch === ')') depth--;
              if (depth === 0 && text.indexOf('(') >= 0) {
                complete = true;
                break;
              }
            }

            if (complete) break;
          }
        }
      } catch (error) {
        if (chunks.length === 0) throw error;
      }

      const rtt = Date.now() - startTime;

      const combined = combineChunks(chunks, totalBytes);
      const greeting = new TextDecoder().decode(combined);

      reader.releaseLock();
      socket.close();

      const parsed = parseSvnGreeting(greeting);

      const result: SVNConnectResponse = {
        success: parsed.success,
        host,
        port,
        greeting: greeting.trim(),
        minVersion: parsed.minVersion,
        maxVersion: parsed.maxVersion,
        capabilities: parsed.capabilities,
        authMechanisms: parsed.authMechanisms,
        rtt,
      };

      if (!parsed.success) {
        result.error = parsed.error;
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

function combineChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}


// ─── SVN Protocol Extensions ───────────────────────────────────────────────

interface SVNListRequest {
  host: string;
  port?: number;
  repo?: string;
  path?: string;
  timeout?: number;
}

interface SVNListResponse {
  success: boolean;
  serverVersion?: number;
  capabilities?: string[];
  realm?: string;
  url?: string;
  authRequired: boolean;
  entries?: string[];
  latencyMs: number;
  error?: string;
}

interface SVNInfoResponse {
  success: boolean;
  reposRoot?: string;
  latencyMs: number;
  error?: string;
}

/**
 * Parse the SVN server greeting S-expression, which has the form:
 *   ( success ( min-ver max-ver ( caps... ) ( mechs... ) ) )
 * followed by a second greeting that includes the server URL and realm:
 *   ( success ( repos-url ( cap1 cap2 ... ) <realm-string> ) )
 */
function parseSvnServerGreeting(text: string): {
  minVer?: number;
  maxVer?: number;
  caps: string[];
  mechs: string[];
} {
  const versionMatch = text.match(/success\s+\(\s*(\d+)\s+(\d+)/);
  const minVer = versionMatch ? parseInt(versionMatch[1]) : undefined;
  const maxVer = versionMatch ? parseInt(versionMatch[2]) : undefined;

  // Extract parenthesized token groups (not nested)
  const groupRegex = /\(\s*([^()]*?)\s*\)/g;
  const groups: string[] = [];
  let m;
  while ((m = groupRegex.exec(text)) !== null) {
    groups.push(m[1].trim());
  }

  const caps = groups.length >= 3
    ? groups[2].split(/\s+/).filter(w => w.length > 0)
    : [];
  const mechs = groups.length >= 4
    ? groups[3].split(/\s+/).filter(w => w.length > 0)
    : [];

  return { minVer, maxVer, caps, mechs };
}

/**
 * Read from a socket reader until we see a balanced S-expression at the
 * top level (depth goes 1 then back to 0). Stops after `maxBytes`.
 */
async function readSvnResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  maxBytes = 8192
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const deadline = Date.now() + timeoutMs;

  while (totalBytes < maxBytes) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('SVN read timeout');

    const timerPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
      setTimeout(() => resolve({ done: true, value: undefined }), remaining)
    );
    const { done, value } = await Promise.race([reader.read(), timerPromise]);
    if (done || !value) break;

    chunks.push(value);
    totalBytes += value.length;

    const text = new TextDecoder().decode(combineChunks(chunks, totalBytes));
    let depth = 0;
    let sawOpen = false;
    let complete = false;
    for (const ch of text) {
      if (ch === '(') { depth++; sawOpen = true; }
      if (ch === ')') depth--;
      if (sawOpen && depth === 0) { complete = true; break; }
    }
    if (complete) return text;
  }

  const combined = combineChunks(chunks, totalBytes);
  return new TextDecoder().decode(combined);
}

/**
 * Parse a quoted or unquoted string value from an SVN auth-challenge line.
 * SVN auth lines look like: ( EXTERNAL ( ) "REALM STRING" )
 */
function parseSvnRealm(text: string): string | undefined {
  // Look for a quoted string after the auth mechs list
  const quoted = text.match(/"([^"]+)"/);
  if (quoted) return quoted[1];
  // Look for an unquoted atom that looks like a realm
  const match = text.match(/\)\s+(\S[^()]+?)\s*\)/);
  return match ? match[1].trim() : undefined;
}

/**
 * Encode a string in SVN protocol format: "<len>:<data>"
 */
function svnStr(s: string): string {
  const bytes = new TextEncoder().encode(s);
  return `${bytes.length}:${s}`;
}

/**
 * POST /api/svn/list
 *
 * Connects to an SVN server, negotiates the protocol, attempts anonymous
 * authentication, and lists the contents of a repository path.
 *
 * Body: { host, port?, repo?, path?, timeout? }
 */
export async function handleSVNList(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const startTime = Date.now();

  try {
    const body = await request.json() as SVNListRequest;
    const host    = (body.host ?? '').trim();
    const port    = body.port ?? 3690;
    const repo    = body.repo ?? '/';
    const path    = body.path ?? '';
    const timeout = Math.min(body.timeout ?? 10000, 30000);

    if (!host) {
      return new Response(JSON.stringify({ success: false, authRequired: false, error: 'Host is required', latencyMs: 0 }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);
    await socket.opened;

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    let authRequired = false;
    let realm: string | undefined;
    let url: string | undefined;
    let serverVersion: number | undefined;
    let capabilities: string[] = [];

    try {
      // Step 1: Read server greeting
      const greetingText = await readSvnResponse(reader, timeout - (Date.now() - startTime));
      const greeting = parseSvnServerGreeting(greetingText);
      serverVersion = greeting.maxVer;
      capabilities = greeting.caps;

      // Step 2: Send client greeting
      // Format: ( version ( capabilities... ) ( ) )
      const repoUrl = `svn://${host}${repo}`;
      const clientGreeting =
        `( 2 ( edit-pipeline svndiff1 accepts-svndiff2 accepts-svndiff3 ) ` +
        `( ${svnStr(repoUrl)} ) ) \n`;
      await writer.write(new TextEncoder().encode(clientGreeting));

      // Step 3: Read auth challenge from server
      // Server sends: ( success ( repos-url ( cap... ) ) )
      // followed by: ( ( ANONYMOUS PLAIN ... ) "realm" )
      const authChallenge = await readSvnResponse(reader, timeout - (Date.now() - startTime));
      realm = parseSvnRealm(authChallenge);

      // Check if ANONYMOUS auth is available
      const hasAnon = /\bANONYMOUS\b/.test(authChallenge);
      if (!hasAnon) {
        authRequired = true;
        // Try ANONYMOUS anyway — some servers accept it even when not advertised
      }

      // Extract server URL from the auth challenge if present
      const urlMatch = authChallenge.match(/svn:\/\/[^\s")]+/);
      if (urlMatch) url = urlMatch[0];

      // Step 4: Send ANONYMOUS auth
      // Format: ( ANONYMOUS ( <base64-or-empty> ) )
      // "anonymous" as the credential string, empty string also works
      const anonCred = btoa('anonymous');
      const authResp = `( ANONYMOUS ( ${svnStr(anonCred)} ) ) \n`;
      await writer.write(new TextEncoder().encode(authResp));

      // Step 5: Read auth result
      const authResult = await readSvnResponse(reader, timeout - (Date.now() - startTime));

      if (authResult.includes('failure')) {
        authRequired = true;
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();

        const response: SVNListResponse = {
          success: false,
          serverVersion,
          capabilities,
          realm,
          url,
          authRequired,
          latencyMs: Date.now() - startTime,
          error: 'Authentication required',
        };
        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 6: Send reparent to set the repository URL
      const reparentCmd = `( reparent ( ${svnStr(repoUrl)} ) ) \n`;
      await writer.write(new TextEncoder().encode(reparentCmd));

      // Read reparent response
      await readSvnResponse(reader, timeout - (Date.now() - startTime));

      // Step 7: Send list command
      const listPath = path || '';
      const listCmd = `( stat ( ${svnStr(listPath)} ) ) \n`;
      await writer.write(new TextEncoder().encode(listCmd));

      // Read list response
      const listResponse = await readSvnResponse(reader, timeout - (Date.now() - startTime));

      // Parse directory entries from the response
      // Entries are strings in the form: "1:name" or similar
      const entries: string[] = [];
      const entryRegex = /\d+:([^\s()]+)/g;
      let em;
      while ((em = entryRegex.exec(listResponse)) !== null) {
        const entry = em[1];
        if (entry && !entry.startsWith('svn:') && entry.length > 0) {
          entries.push(entry);
        }
      }

      reader.releaseLock();
      writer.releaseLock();
      await socket.close();

      const response: SVNListResponse = {
        success: true,
        serverVersion,
        capabilities,
        realm,
        url: url ?? repoUrl,
        authRequired,
        entries,
        latencyMs: Date.now() - startTime,
      };
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (innerError) {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
      throw innerError;
    }

  } catch (error) {
    const response: SVNListResponse = {
      success: false,
      authRequired: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /api/svn/info
 *
 * Connects to an SVN server, authenticates anonymously, and queries the
 * repository root via the get-repos-root command.
 *
 * Body: { host, port?, timeout? }
 */
export async function handleSVNInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const startTime = Date.now();

  try {
    const body = await request.json() as SVNListRequest;
    const host    = (body.host ?? '').trim();
    const port    = body.port ?? 3690;
    const repo    = body.repo ?? '/';
    const timeout = Math.min(body.timeout ?? 10000, 30000);

    if (!host) {
      return new Response(JSON.stringify({ success: false, latencyMs: 0, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);
    await socket.opened;

    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    try {
      // Read server greeting
      await readSvnResponse(reader, timeout - (Date.now() - startTime));

      // Send client greeting
      const repoUrl = `svn://${host}${repo}`;
      const clientGreeting =
        `( 2 ( edit-pipeline svndiff1 accepts-svndiff2 accepts-svndiff3 ) ` +
        `( ${svnStr(repoUrl)} ) ) \n`;
      await writer.write(new TextEncoder().encode(clientGreeting));

      // Read auth challenge
      await readSvnResponse(reader, timeout - (Date.now() - startTime));

      // Send ANONYMOUS auth
      const anonCred = btoa('anonymous');
      await writer.write(new TextEncoder().encode(
        `( ANONYMOUS ( ${svnStr(anonCred)} ) ) \n`
      ));

      // Read auth result
      const authResult = await readSvnResponse(reader, timeout - (Date.now() - startTime));
      if (authResult.includes('failure')) {
        throw new Error('Authentication failed');
      }

      // Send get-repos-root command
      await writer.write(new TextEncoder().encode('( get-repos-root ( ) ) \n'));

      // Read response
      const infoResponse = await readSvnResponse(reader, timeout - (Date.now() - startTime));

      // Extract repos root URL from the response
      // Format: ( success ( <repos-root-url> ) )
      const rootMatch = infoResponse.match(/success\s+\(\s*(?:\d+:)?([^\s()]+)/);
      const reposRoot = rootMatch ? rootMatch[1] : undefined;

      reader.releaseLock();
      writer.releaseLock();
      await socket.close();

      const response: SVNInfoResponse = {
        success: true,
        reposRoot,
        latencyMs: Date.now() - startTime,
      };
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (innerError) {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
      throw innerError;
    }

  } catch (error) {
    const response: SVNInfoResponse = {
      success: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
