/**
 * Git Protocol Implementation (git://)
 * Read-only repository access via Git's native protocol
 * Port: 9418 (default)
 *
 * Protocol Flow:
 * 1. Client connects to git daemon on port 9418
 * 2. Client sends: git-upload-pack /path/to/repo\0host=hostname\0
 * 3. Server responds with ref advertisement (branches, tags, HEAD)
 * 4. Communication uses "pkt-line" format: 4-byte hex length + data
 *
 * The pkt-line format:
 * - "0000" = flush packet (end of list)
 * - "XXXX" + data = data packet where XXXX is hex length including the 4 bytes
 *
 * Use Cases:
 * - Browse remote repository branches and tags
 * - Discover server capabilities
 * - Test git daemon connectivity
 * - Educational: learn Git internals
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface GitRefsRequest {
  host: string;
  port?: number;
  repo: string;
  timeout?: number;
}

interface GitRef {
  sha: string;
  name: string;
}

interface GitRefsResponse {
  success: boolean;
  host: string;
  port: number;
  repo: string;
  refs: GitRef[];
  capabilities: string[];
  headSha?: string;
  branchCount: number;
  tagCount: number;
  connectTimeMs: number;
  totalTimeMs: number;
  error?: string;
}

/**
 * Read exactly N bytes from a reader, buffering across chunks
 */
async function readExactBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
  existingBuffer: Uint8Array,
  bufferOffset: number
): Promise<{ data: Uint8Array; buffer: Uint8Array; offset: number }> {
  const result = new Uint8Array(count);
  let filled = 0;

  // First, consume from existing buffer
  const available = bufferOffset;
  if (available > 0) {
    const toCopy = Math.min(available, count);
    result.set(existingBuffer.slice(0, toCopy), 0);
    filled += toCopy;

    // Shift remaining buffer
    const remaining = available - toCopy;
    if (remaining > 0) {
      existingBuffer.set(existingBuffer.slice(toCopy, available), 0);
    }
    bufferOffset = remaining;
  }

  // Read more from stream if needed
  while (filled < count) {
    const { value, done } = await reader.read();
    if (done || !value) {
      throw new Error(`Unexpected end of stream (expected ${count} bytes, got ${filled})`);
    }

    const needed = count - filled;
    const toCopy = Math.min(needed, value.length);
    result.set(value.slice(0, toCopy), filled);
    filled += toCopy;

    // Buffer any excess
    if (value.length > toCopy) {
      const excess = value.length - toCopy;
      // Grow buffer if needed
      if (bufferOffset + excess > existingBuffer.length) {
        const newBuf = new Uint8Array(bufferOffset + excess + 4096);
        newBuf.set(existingBuffer.slice(0, bufferOffset), 0);
        existingBuffer = newBuf;
      }
      existingBuffer.set(value.slice(toCopy), bufferOffset);
      bufferOffset += excess;
    }
  }

  return { data: result, buffer: existingBuffer, offset: bufferOffset };
}

/**
 * Parse pkt-line format responses from git daemon
 * Returns array of lines (null = flush packet encountered)
 */
async function readPktLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxLines: number = 10000
): Promise<string[]> {
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let buffer = new Uint8Array(65536);
  let bufOffset = 0;

  for (let i = 0; i < maxLines; i++) {
    // Read 4-byte hex length
    const lenResult = await readExactBytes(reader, 4, buffer, bufOffset);
    buffer = lenResult.buffer as Uint8Array<ArrayBuffer>;
    bufOffset = lenResult.offset;

    const lenStr = decoder.decode(lenResult.data);
    const pktLen = parseInt(lenStr, 16);

    // 0000 = flush packet (end of ref advertisement)
    if (pktLen === 0) {
      break;
    }

    // Sanity check
    if (pktLen < 4 || pktLen > 65520) {
      throw new Error(`Invalid pkt-line length: ${lenStr} (${pktLen})`);
    }

    // Read the data portion (length includes the 4 hex bytes)
    const dataLen = pktLen - 4;
    if (dataLen > 0) {
      const dataResult = await readExactBytes(reader, dataLen, buffer, bufOffset);
      buffer = dataResult.buffer as Uint8Array<ArrayBuffer>;
      bufOffset = dataResult.offset;

      let line = decoder.decode(dataResult.data);
      // Strip trailing newline
      if (line.endsWith('\n')) {
        line = line.slice(0, -1);
      }
      lines.push(line);
    }
  }

  return lines;
}

/**
 * Build a pkt-line formatted request
 */
function buildPktLine(data: string): Uint8Array {
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);
  const length = dataBytes.length + 4;
  const lengthHex = length.toString(16).padStart(4, '0');
  const lengthBytes = encoder.encode(lengthHex);

  const result = new Uint8Array(length);
  result.set(lengthBytes, 0);
  result.set(dataBytes, 4);
  return result;
}

/**
 * Handle Git ref listing request
 * Lists all branches, tags, and HEAD for a remote repository
 */
export async function handleGitRefs(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as GitRefsRequest;
    const { host, port = 9418, repo, timeout = 15000 } = body;

    // Validation
    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!repo) {
      return new Response(
        JSON.stringify({ success: false, error: 'Repository path is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Ensure repo path starts with /
    const repoPath = repo.startsWith('/') ? repo : `/${repo}`;

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const connectionPromise = (async () => {
      const startTime = Date.now();

      // Connect to git daemon
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const connectTime = Date.now() - startTime;

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // Send git-upload-pack request
        // Format: "git-upload-pack /path/to/repo\0host=hostname\0"
        const request = `git-upload-pack ${repoPath}\0host=${host}\0`;
        const pktLine = buildPktLine(request);
        await writer.write(pktLine);

        // Read ref advertisement
        const rawLines = await readPktLines(reader);

        // Parse refs and capabilities
        const refs: GitRef[] = [];
        let capabilities: string[] = [];
        let headSha: string | undefined;

        for (let i = 0; i < rawLines.length; i++) {
          const line = rawLines[i];

          if (i === 0) {
            // First line contains capabilities after NUL byte
            const [refPart, capsPart] = line.split('\0');
            if (capsPart) {
              capabilities = capsPart.split(' ').filter(Boolean);
            }

            // Parse the ref
            const spaceIdx = refPart.indexOf(' ');
            if (spaceIdx > 0) {
              const sha = refPart.substring(0, spaceIdx);
              const name = refPart.substring(spaceIdx + 1);
              refs.push({ sha, name });

              if (name === 'HEAD') {
                headSha = sha;
              }
            }
          } else {
            // Subsequent lines are just "sha ref"
            const spaceIdx = line.indexOf(' ');
            if (spaceIdx > 0) {
              const sha = line.substring(0, spaceIdx);
              const name = line.substring(spaceIdx + 1);
              refs.push({ sha, name });

              if (name === 'HEAD' && !headSha) {
                headSha = sha;
              }
            }
          }
        }

        const totalTime = Date.now() - startTime;

        // Count branches and tags
        const branchCount = refs.filter(r => r.name.startsWith('refs/heads/')).length;
        const tagCount = refs.filter(r => r.name.startsWith('refs/tags/')).length;

        // Cleanup
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const result: GitRefsResponse = {
          success: true,
          host,
          port,
          repo: repoPath,
          refs,
          capabilities,
          headSha,
          branchCount,
          tagCount,
          connectTimeMs: connectTime,
          totalTimeMs: totalTime,
        };

        return result;
      } catch (error) {
        try { await socket.close(); } catch { /* ignore */ }
        throw error;
      }
    })();

    const result = await Promise.race([connectionPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
