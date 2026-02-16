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
