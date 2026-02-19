/**
 * Git Protocol Implementation (git://)
 * Read-only repository access via Git's native protocol
 * Port: 9418 (default)
 *
 * Protocol Flow (git-upload-pack / reference discovery):
 * 1. Client connects to git daemon on port 9418
 * 2. Client sends pkt-line: git-upload-pack /path/to/repo\0host=hostname\0
 * 3. Server may respond with "version 1\n" pkt-line (optional)
 * 4. Server sends ref advertisement: first line has capabilities after NUL
 * 5. Server sends flush packet (0000) to end ref advertisement
 * 6. Client sends flush packet (0000) to abort, or want/have/done to fetch
 *
 * The pkt-line format (RFC-like):
 * - "0000" = flush packet (end of section / graceful abort)
 * - "XXXX" + data = data packet where XXXX is 4-byte hex length INCLUDING the 4 bytes
 * - Maximum pkt-line length: 65520 bytes (65516 payload + 4 length bytes)
 * - Non-binary lines SHOULD include trailing LF (included in length)
 *
 * Use Cases:
 * - Browse remote repository branches and tags (ls-remote equivalent)
 * - Discover server capabilities
 * - Fetch pack data for a specific ref
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

/** Build a flush pkt-line (four ASCII zeros) */
function buildFlushPkt(): Uint8Array {
  return new TextEncoder().encode('0000');
}

/**
 * Parse Git pack object type+size from a variable-length header.
 *
 * Pack object header encoding (see gitformat-pack):
 *   First byte:  bit 7 = MSB (more bytes follow), bits [6:4] = type, bits [3:0] = size[3:0]
 *   Next bytes:  bit 7 = MSB (more bytes follow), bits [6:0] = size[N:N-6]
 *
 * Size is built up with 4 bits from the first byte, then 7 bits per continuation byte.
 * Returns { type, size, bytesConsumed }.
 */
function parsePackObjectHeader(data: Uint8Array, offset: number): {
  type: number;
  size: number;
  bytesConsumed: number;
} | null {
  if (offset >= data.length) return null;

  const firstByte = data[offset];
  const type = (firstByte >> 4) & 0x07;
  let size = firstByte & 0x0F;
  let shift = 4;
  let consumed = 1;
  let currentByte = firstByte;

  while (currentByte & 0x80) {
    if (offset + consumed >= data.length) break;
    currentByte = data[offset + consumed];
    size |= (currentByte & 0x7F) << shift;
    shift += 7;
    consumed++;
  }

  return { type, size, bytesConsumed: consumed };
}

const GIT_OBJ_TYPE_NAMES: Record<number, string> = {
  1: 'commit',
  2: 'tree',
  3: 'blob',
  4: 'tag',
  6: 'ofs_delta',
  7: 'ref_delta',
};

/**
 * Parse the ref advertisement lines returned by readPktLines().
 *
 * Handles the following protocol details:
 * - Skips "version 1" pkt-line if present (some servers send this first)
 * - Parses capabilities from the NUL-separated portion of the first ref line
 * - Parses subsequent ref lines as "sha refname"
 * - Validates SHA format (40 hex chars) to avoid misparse
 */
function parseRefAdvertisement(rawLines: string[]): {
  refs: Array<{ sha: string; name: string }>;
  capabilities: string[];
  headSha?: string;
} {
  const refs: Array<{ sha: string; name: string }> = [];
  let capabilities: string[] = [];
  let headSha: string | undefined;
  let firstRefSeen = false;

  for (const line of rawLines) {
    // Skip "version N" lines that some servers send before ref advertisement
    if (!firstRefSeen && /^version \d+$/.test(line)) {
      continue;
    }

    if (!firstRefSeen) {
      // First ref line: "sha refname\0capability-list"
      firstRefSeen = true;
      const [refPart, capsPart] = line.split('\0');
      if (capsPart) {
        capabilities = capsPart.split(' ').filter(Boolean);
      }
      const spaceIdx = refPart.indexOf(' ');
      if (spaceIdx > 0) {
        const sha = refPart.substring(0, spaceIdx);
        const name = refPart.substring(spaceIdx + 1);
        // Validate SHA is 40 hex chars (SHA-1) or 64 hex chars (SHA-256)
        if (/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) {
          refs.push({ sha, name });
          if (name === 'HEAD') headSha = sha;
        }
      }
    } else {
      // Subsequent lines: "sha refname"
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx > 0) {
        const sha = line.substring(0, spaceIdx);
        const name = line.substring(spaceIdx + 1);
        if (/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) {
          refs.push({ sha, name });
          if (name === 'HEAD' && !headSha) headSha = sha;
        }
      }
    }
  }

  return { refs, capabilities, headSha };
}

/**
 * Handle Git fetch request — connects to a git daemon, advertises a want ref,
 * sends done, and parses the PACK header to report object metadata.
 *
 * Request body: { host, port?, timeout?, repository, wantRef? }
 * Response:     { wantedRef, sha, packVersion, objectCount, objects, rtt }
 */
export async function handleGitFetch(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = (await request.json()) as {
    host: string;
    port?: number;
    timeout?: number;
    repository: string;
    wantRef?: string;
  };

  const { host, port = 9418, timeout = 20000, repository, wantRef = 'HEAD' } = body;

  if (!host) {
    return new Response(
      JSON.stringify({ success: false, error: 'Host is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (!repository) {
    return new Response(
      JSON.stringify({ success: false, error: 'repository is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (port < 1 || port > 65535) {
    return new Response(
      JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const repoPath = repository.startsWith('/') ? repository : `/${repository}`;

  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(
      JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Connection timeout')), timeout),
  );

  const connectionPromise = (async () => {
    const startTime = Date.now();

    const socket = connect(`${host}:${port}`);
    await socket.opened;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Step 1: Send git-upload-pack request
      const uploadPackReq = `git-upload-pack ${repoPath}\0host=${host}\0`;
      await writer.write(buildPktLine(uploadPackReq));

      // Step 2: Read ref advertisement
      const rawLines = await Promise.race([
        readPktLines(reader, 10000),
        timeoutPromise,
      ]);

      // Parse refs to find the desired ref's SHA
      const { refs, capabilities } = parseRefAdvertisement(rawLines);

      // Resolve the wanted ref (HEAD symref, branch name, or full ref)
      let wantedSha: string | undefined;
      let resolvedRef = wantRef;

      // Check HEAD symref in capabilities (e.g. "symref=HEAD:refs/heads/main")
      if (wantRef === 'HEAD') {
        const headRef = refs.find(r => r.name === 'HEAD');
        if (headRef) wantedSha = headRef.sha;

        // Also try to resolve through symref capability
        if (!wantedSha) {
          const symref = capabilities.find(c => c.startsWith('symref=HEAD:'));
          if (symref) {
            // Format is "symref=HEAD:refs/heads/main" — use indexOf to handle
            // ref names that could theoretically contain colons
            const colonIdx = symref.indexOf(':');
            if (colonIdx > 0) {
              const target = symref.substring(colonIdx + 1);
              const resolved = refs.find(r => r.name === target);
              if (resolved) { wantedSha = resolved.sha; resolvedRef = target; }
            }
          }
        }
      } else {
        // Try exact match first, then suffix match
        const exact = refs.find(r => r.name === wantRef || r.name === `refs/heads/${wantRef}` || r.name === `refs/tags/${wantRef}`);
        if (exact) { wantedSha = exact.sha; resolvedRef = exact.name; }
      }

      if (!wantedSha) {
        // Send flush to gracefully abort before closing
        await writer.write(buildFlushPkt());
        await socket.close();
        return {
          success: false,
          error: `Ref not found: ${wantRef}`,
          availableRefs: refs.map(r => r.name),
        };
      }

      // Step 3: Send want line + flush + done
      // Per the spec, the FIRST want line MUST include the client's desired capabilities.
      // We request ofs-delta (efficient delta encoding) and side-band-64k (multiplexed output)
      // only if the server advertised them.
      const clientCaps: string[] = [];
      if (capabilities.includes('ofs-delta')) clientCaps.push('ofs-delta');
      if (capabilities.includes('side-band-64k')) clientCaps.push('side-band-64k');
      else if (capabilities.includes('side-band')) clientCaps.push('side-band');
      if (capabilities.includes('no-progress')) clientCaps.push('no-progress');

      const capStr = clientCaps.length > 0 ? ` ${clientCaps.join(' ')}` : '';
      const wantLine = buildPktLine(`want ${wantedSha}${capStr}\n`);
      const flushPkt = buildFlushPkt();
      const doneLine = buildPktLine('done\n');

      const negotiation = new Uint8Array(wantLine.length + flushPkt.length + doneLine.length);
      negotiation.set(wantLine, 0);
      negotiation.set(flushPkt, wantLine.length);
      negotiation.set(doneLine, wantLine.length + flushPkt.length);
      await writer.write(negotiation);

      // Step 4: Read server response — expect "NAK\n" pkt-line(s) then PACK data
      // Collect raw bytes since PACK is binary
      const packChunks: Uint8Array[] = [];
      let packTotal = 0;
      const packDeadline = Date.now() + Math.min(timeout, 15000);

      while (Date.now() < packDeadline && packTotal < 4 * 1024 * 1024) {
        const remaining = packDeadline - Date.now();
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Read timeout')), remaining),
            ),
          ]);
        } catch {
          break;
        }
        if (chunk.done || !chunk.value) break;
        packChunks.push(chunk.value);
        packTotal += chunk.value.length;

        // Once we have enough data, check if we have a PACK header
        if (packTotal >= 32) break;
      }

      const rtt = Date.now() - startTime;

      // Combine all received bytes
      const allData = new Uint8Array(packTotal);
      let off = 0;
      for (const c of packChunks) { allData.set(c, off); off += c.length; }

      // Scan for PACK magic bytes (may be preceded by pkt-line sideband data)
      let packOffset = -1;
      for (let i = 0; i <= allData.length - 4; i++) {
        if (allData[i] === 0x50 && allData[i + 1] === 0x41 &&
            allData[i + 2] === 0x43 && allData[i + 3] === 0x4B) {
          packOffset = i;
          break;
        }
      }

      if (packOffset === -1) {
        // Try to decode as text to see if it's an error pkt-line
        const textPreview = new TextDecoder('utf-8', { fatal: false })
          .decode(allData.slice(0, Math.min(256, allData.length)));
        return {
          success: false,
          error: 'PACK magic bytes not found in server response',
          serverResponse: textPreview.replace(/\x00/g, '\\0'),
          wantedRef: resolvedRef,
          sha: wantedSha,
          rtt,
        };
      }

      const packData = allData.slice(packOffset);

      if (packData.length < 12) {
        return {
          success: false,
          error: 'PACK data too short to parse header',
          wantedRef: resolvedRef,
          sha: wantedSha,
          rtt,
        };
      }

      const packView = new DataView(packData.buffer, packData.byteOffset, packData.byteLength);
      const packVersion = packView.getUint32(4);
      const objectCount = packView.getUint32(8);

      // Parse object headers (up to 100 objects or end of data)
      const objects: Array<{ type: string; size: number }> = [];
      let objOffset = 12;
      const maxObjects = Math.min(objectCount, 100);

      for (let i = 0; i < maxObjects && objOffset < packData.length; i++) {
        const hdr = parsePackObjectHeader(packData, objOffset);
        if (!hdr) break;
        objects.push({
          type: GIT_OBJ_TYPE_NAMES[hdr.type] ?? `unknown(${hdr.type})`,
          size: hdr.size,
        });
        // We can't easily skip the compressed data without inflating it,
        // so we only report what we can parse from headers
        break; // report first object only to avoid inflating
      }

      await socket.close();

      return {
        success: true,
        host,
        port,
        repository: repoPath,
        wantedRef: resolvedRef,
        sha: wantedSha,
        packVersion,
        objectCount,
        objects,
        rtt,
      };

    } catch (error) {
      try { await socket.close(); } catch { /* ignore */ }
      throw error;
    } finally {
      writer.releaseLock();
      reader.releaseLock();
    }
  })();

  try {
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
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
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

        // Parse refs and capabilities using shared parser
        // (handles "version 1" lines and validates SHA format)
        const { refs, capabilities, headSha } = parseRefAdvertisement(rawLines);

        const totalTime = Date.now() - startTime;

        // Count branches and tags
        const branchCount = refs.filter(r => r.name.startsWith('refs/heads/')).length;
        const tagCount = refs.filter(r => r.name.startsWith('refs/tags/')).length;

        // Send flush packet to gracefully signal we're done (ls-remote abort).
        // Per the Git pack protocol spec: "the client can decide to terminate
        // the connection by sending a flush-pkt, telling the server it can
        // now gracefully terminate."
        await writer.write(buildFlushPkt());

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
