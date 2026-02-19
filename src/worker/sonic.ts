/**
 * Sonic Search Backend Protocol Implementation
 *
 * Sonic is a lightweight, fast search backend that runs over TCP
 * on port 1491 with a simple text-based protocol.
 *
 * Protocol Flow:
 * 1. Client connects to port 1491
 * 2. Server sends: "CONNECTED <instance_id>\r\n"
 * 3. Client sends: "START <mode> [<password>]\r\n"
 *    - Modes: search, ingest, control
 * 4. Server sends: "STARTED <mode> protocol(<version>) buffer(<size>)\r\n"
 * 5. Commands vary by mode:
 *    - All modes: PING → PONG, QUIT → ENDED quit
 *    - Control mode: INFO → multi-line key(value) stats
 *    - Search mode: QUERY <collection> <bucket> "<query>" → PENDING/EVENT
 *    - Ingest mode: PUSH <collection> <bucket> <key> "<text>"
 *
 * Error Responses:
 *   ERR <message>
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface SonicRequest {
  host: string;
  port?: number;
  timeout?: number;
  password?: string;
}

interface SonicProbeResponse {
  success: boolean;
  host: string;
  port: number;
  rtt: number;
  instanceId?: string;
  protocol?: number;
  bufferSize?: number;
  modes?: {
    search: boolean;
    ingest: boolean;
    control: boolean;
  };
  stats?: Record<string, string>;
  error?: string;
}

/**
 * Read a line (terminated by \r\n or \n) from the socket
 */
async function readLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes: number = 4096,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) break;

    // Prevent buffer overflow
    const available = maxBytes - total;
    if (available <= 0) break;

    const chunk = value.length > available ? value.slice(0, available) : value;
    chunks.push(chunk);
    total += chunk.length;

    // Check for \n terminator
    if (chunk.includes(0x0A)) break;

    if (total >= maxBytes) break;
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Strip trailing \r\n or \n
  let end = combined.length;
  while (end > 0 && (combined[end - 1] === 0x0D || combined[end - 1] === 0x0A)) {
    end--;
  }

  return new TextDecoder().decode(combined.slice(0, end));
}

/**
 * Send a command and read the response line
 */
async function sendCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  command: string,
): Promise<string> {
  const data = new TextEncoder().encode(command + '\r\n');
  await writer.write(data);
  return readLine(reader, timeoutPromise);
}

/**
 * Try to start a Sonic session in the given mode
 * Returns the STARTED response or null if failed
 */
async function tryStartMode(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  mode: string,
  password?: string,
): Promise<{ protocol: number; bufferSize: number } | null> {
  const cmd = password ? `START ${mode} ${password}` : `START ${mode}`;
  const response = await sendCommand(writer, reader, timeoutPromise, cmd);

  // Parse: "STARTED <mode> protocol(<version>) buffer(<size>)"
  const match = response.match(/^STARTED\s+\w+\s+protocol\((\d+)\)\s+buffer\((\d+)\)/);
  if (match) {
    return {
      protocol: parseInt(match[1], 10),
      bufferSize: parseInt(match[2], 10),
    };
  }

  return null;
}

/**
 * Parse Sonic INFO response lines into key-value pairs
 * Format: "RESULT key(value) key(value) ..."
 */
function parseInfoLine(line: string): Record<string, string> {
  // Strip RESULT prefix if present
  const content = line.startsWith('RESULT ') ? line.substring(7) : line;
  const result: Record<string, string> = {};
  const regex = /(\w[\w.]+)\(([^)]*)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

/**
 * Probe a Sonic search backend instance
 * POST /api/sonic/probe
 */
export async function handleSonicProbe(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as SonicRequest;
    const { host, port = 1491, timeout = 10000, password } = body;

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

    if (timeout < 1 || timeout > 60000) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Timeout must be between 1 and 60000 ms',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
      });

      try {
        // Step 1: Read the CONNECTED banner
        const banner = await readLine(reader, timeoutPromise);

        if (!banner.startsWith('CONNECTED')) {
          throw new Error(`Unexpected banner: ${banner.substring(0, 100)}`);
        }

        // Parse instance ID from "CONNECTED <instance_id>"
        const instanceId = banner.substring(10).trim() || undefined;

        // Step 2: Try to start in control mode (most info)
        const controlResult = await tryStartMode(writer, reader, timeoutPromise, 'control', password);

        let protocol: number | undefined;
        let bufferSize: number | undefined;
        let stats: Record<string, string> | undefined;
        const modes = { search: false, ingest: false, control: false };

        if (controlResult) {
          protocol = controlResult.protocol;
          bufferSize = controlResult.bufferSize;
          modes.control = true;

          // Step 3: Get server info via INFO command
          const infoResponse = await sendCommand(writer, reader, timeoutPromise, 'INFO');
          if (infoResponse.startsWith('RESULT')) {
            stats = parseInfoLine(infoResponse);
          }

          // Step 4: Verify with PING
          const pingResponse = await sendCommand(writer, reader, timeoutPromise, 'PING');
          if (pingResponse !== 'PONG') {
            // Not critical, just note it
          }

          // Step 5: Clean quit and validate response
          const quitResponse = await sendCommand(writer, reader, timeoutPromise, 'QUIT');
          if (!quitResponse.startsWith('ENDED')) {
            // Non-critical protocol violation
          }
        }

        // Step 6: Reconnect to test search mode
        try {
          const searchSocket = connect(`${host}:${port}`);
          await searchSocket.opened;
          const searchReader = searchSocket.readable.getReader();
          const searchWriter = searchSocket.writable.getWriter();
          try {
            await readLine(searchReader, timeoutPromise);
            const searchResult = await tryStartMode(searchWriter, searchReader, timeoutPromise, 'search', password);
            if (searchResult) modes.search = true;
            await sendCommand(searchWriter, searchReader, timeoutPromise, 'QUIT');
            searchWriter.releaseLock();
            searchReader.releaseLock();
            searchSocket.close();
          } catch {
            try { searchWriter.releaseLock(); } catch {}
            try { searchReader.releaseLock(); } catch {}
            try { searchSocket.close(); } catch {}
          }
        } catch {
          // Search mode test failed, not critical
        }

        // Step 7: Reconnect to test ingest mode
        try {
          const ingestSocket = connect(`${host}:${port}`);
          await ingestSocket.opened;
          const ingestReader = ingestSocket.readable.getReader();
          const ingestWriter = ingestSocket.writable.getWriter();
          try {
            await readLine(ingestReader, timeoutPromise);
            const ingestResult = await tryStartMode(ingestWriter, ingestReader, timeoutPromise, 'ingest', password);
            if (ingestResult) modes.ingest = true;
            await sendCommand(ingestWriter, ingestReader, timeoutPromise, 'QUIT');
            ingestWriter.releaseLock();
            ingestReader.releaseLock();
            ingestSocket.close();
          } catch {
            try { ingestWriter.releaseLock(); } catch {}
            try { ingestReader.releaseLock(); } catch {}
            try { ingestSocket.close(); } catch {}
          }
        } catch {
          // Ingest mode test failed, not critical
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const result: SonicProbeResponse = {
          success: true,
          host,
          port,
          rtt: Date.now() - startTime,
          instanceId,
          protocol,
          bufferSize,
          modes,
          stats,
        };

        return result;

      } catch (error) {
        try { writer.releaseLock(); } catch {}
        try { reader.releaseLock(); } catch {}
        try { socket.close(); } catch {}
        throw error;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    })();

    const result = await connectionPromise;
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
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
 * Escape text for Sonic protocol (backslashes then quotes)
 */
function escapeSonicText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Validate Sonic identifier (collection, bucket, objectId)
 */
function validateSonicIdentifier(value: string, name: string): string | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return `${name} must contain only alphanumeric, underscore, or hyphen characters`;
  }
  if (value.length > 64) {
    return `${name} must be 64 characters or less`;
  }
  return null;
}

/**
 * Run a search query against a Sonic collection
 * POST /api/sonic/query
 */
export async function handleSonicQuery(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as {
      host: string; port?: number; password?: string; timeout?: number;
      collection: string; bucket: string; terms: string; limit?: number;
    };
    const { host, port = 1491, password, timeout = 10000, collection, bucket, terms, limit = 10 } = body;

    if (!host || !collection || !bucket || !terms) {
      return new Response(JSON.stringify({ success: false, error: 'host, collection, bucket, and terms are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (timeout < 1 || timeout > 60000) {
      return new Response(JSON.stringify({ success: false, error: 'Timeout must be between 1 and 60000 ms' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const collectionErr = validateSonicIdentifier(collection, 'collection');
    if (collectionErr) {
      return new Response(JSON.stringify({ success: false, error: collectionErr }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const bucketErr = validateSonicIdentifier(bucket, 'bucket');
    if (bucketErr) {
      return new Response(JSON.stringify({ success: false, error: bucketErr }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

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

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Timeout')), timeout);
    });
    await Promise.race([socket.opened, timeoutPromise]);
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    try {
      // CONNECTED banner
      await readLine(reader, timeoutPromise);
      // START search
      const startCmd = password ? `START search ${password}` : 'START search';
      const started = await sendCommand(writer, reader, timeoutPromise, startCmd);
      if (!started.startsWith('STARTED')) throw new Error(`Failed to start search mode: ${started}`);
      // QUERY
      const queryCmd = `QUERY ${collection} ${bucket} "${escapeSonicText(terms)}" LIMIT(${limit})`;
      const pendingLine = await sendCommand(writer, reader, timeoutPromise, queryCmd);
      let results: string[] = [];
      if (pendingLine.startsWith('PENDING')) {
        // Wait for EVENT line
        const eventLine = await readLine(reader, timeoutPromise);
        const eventMatch = eventLine.match(/^EVENT QUERY \S+ (.+)$/);
        if (eventMatch) results = eventMatch[1].trim().split(' ').filter(Boolean);
      } else if (pendingLine.startsWith('ERR')) {
        throw new Error(pendingLine.substring(4));
      }
      const quitResponse = await sendCommand(writer, reader, timeoutPromise, 'QUIT');
      if (!quitResponse.startsWith('ENDED')) {
        // Non-critical protocol violation
      }
      try { writer.releaseLock(); } catch {}
      try { reader.releaseLock(); } catch {}
      try { socket.close(); } catch {}
      return new Response(JSON.stringify({ success: true, host, port, collection, bucket, terms, results, count: results.length }),
        { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      try { writer.releaseLock(); } catch {}
      try { reader.releaseLock(); } catch {}
      try { socket.close(); } catch {}
      throw e;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Push text into a Sonic collection for indexing
 * POST /api/sonic/push
 */
export async function handleSonicPush(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as {
      host: string; port?: number; password?: string; timeout?: number;
      collection: string; bucket: string; objectId: string; text: string;
    };
    const { host, port = 1491, password, timeout = 10000, collection, bucket, objectId, text } = body;

    if (!host || !collection || !bucket || !objectId || !text) {
      return new Response(JSON.stringify({ success: false, error: 'host, collection, bucket, objectId, and text are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (timeout < 1 || timeout > 60000) {
      return new Response(JSON.stringify({ success: false, error: 'Timeout must be between 1 and 60000 ms' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const collectionErr = validateSonicIdentifier(collection, 'collection');
    if (collectionErr) {
      return new Response(JSON.stringify({ success: false, error: collectionErr }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const bucketErr = validateSonicIdentifier(bucket, 'bucket');
    if (bucketErr) {
      return new Response(JSON.stringify({ success: false, error: bucketErr }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const objectIdErr = validateSonicIdentifier(objectId, 'objectId');
    if (objectIdErr) {
      return new Response(JSON.stringify({ success: false, error: objectIdErr }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

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

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Timeout')), timeout);
    });
    await Promise.race([socket.opened, timeoutPromise]);
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    try {
      await readLine(reader, timeoutPromise);
      const startCmd = password ? `START ingest ${password}` : 'START ingest';
      const started = await sendCommand(writer, reader, timeoutPromise, startCmd);
      if (!started.startsWith('STARTED')) throw new Error(`Failed to start ingest mode: ${started}`);
      const pushCmd = `PUSH ${collection} ${bucket} ${objectId} "${escapeSonicText(text)}"`;
      const pushResp = await sendCommand(writer, reader, timeoutPromise, pushCmd);
      const ok = pushResp === 'OK';
      const quitResponse = await sendCommand(writer, reader, timeoutPromise, 'QUIT');
      if (!quitResponse.startsWith('ENDED')) {
        // Non-critical protocol violation
      }
      try { writer.releaseLock(); } catch {}
      try { reader.releaseLock(); } catch {}
      try { socket.close(); } catch {}
      return new Response(JSON.stringify({ success: ok, host, port, collection, bucket, objectId, response: pushResp }),
        { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      try { writer.releaseLock(); } catch {}
      try { reader.releaseLock(); } catch {}
      try { socket.close(); } catch {}
      throw e;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Get search suggestions from Sonic
 * POST /api/sonic/suggest
 */
export async function handleSonicSuggest(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as {
      host: string; port?: number; password?: string; timeout?: number;
      collection: string; bucket: string; word: string; limit?: number;
    };
    const { host, port = 1491, password, timeout = 10000, collection, bucket, word, limit = 5 } = body;

    if (!host || !collection || !bucket || !word) {
      return new Response(JSON.stringify({ success: false, error: 'host, collection, bucket, and word are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (timeout < 1 || timeout > 60000) {
      return new Response(JSON.stringify({ success: false, error: 'Timeout must be between 1 and 60000 ms' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const collectionErr = validateSonicIdentifier(collection, 'collection');
    if (collectionErr) {
      return new Response(JSON.stringify({ success: false, error: collectionErr }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const bucketErr = validateSonicIdentifier(bucket, 'bucket');
    if (bucketErr) {
      return new Response(JSON.stringify({ success: false, error: bucketErr }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

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

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Timeout')), timeout);
    });
    await Promise.race([socket.opened, timeoutPromise]);
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    try {
      await readLine(reader, timeoutPromise);
      const startCmd = password ? `START search ${password}` : 'START search';
      const started = await sendCommand(writer, reader, timeoutPromise, startCmd);
      if (!started.startsWith('STARTED')) throw new Error(`Failed to start search mode: ${started}`);
      const suggestCmd = `SUGGEST ${collection} ${bucket} "${escapeSonicText(word)}" LIMIT(${limit})`;
      const pendingLine = await sendCommand(writer, reader, timeoutPromise, suggestCmd);
      let suggestions: string[] = [];
      if (pendingLine.startsWith('PENDING')) {
        const eventLine = await readLine(reader, timeoutPromise);
        const eventMatch = eventLine.match(/^EVENT SUGGEST \S+ (.+)$/);
        if (eventMatch) suggestions = eventMatch[1].trim().split(' ').filter(Boolean);
      } else if (pendingLine.startsWith('ERR')) {
        throw new Error(pendingLine.substring(4));
      }
      const quitResponse = await sendCommand(writer, reader, timeoutPromise, 'QUIT');
      if (!quitResponse.startsWith('ENDED')) {
        // Non-critical protocol violation
      }
      try { writer.releaseLock(); } catch {}
      try { reader.releaseLock(); } catch {}
      try { socket.close(); } catch {}
      return new Response(JSON.stringify({ success: true, host, port, collection, bucket, word, suggestions }),
        { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      try { writer.releaseLock(); } catch {}
      try { reader.releaseLock(); } catch {}
      try { socket.close(); } catch {}
      throw e;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Send a PING to a Sonic instance
 * POST /api/sonic/ping
 */
export async function handleSonicPing(request: Request): Promise<Response> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = await request.json() as SonicRequest;
    const { host, port = 1491, timeout = 10000, password } = body;

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

    if (timeout < 1 || timeout > 60000) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Timeout must be between 1 and 60000 ms',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
      });

      try {
        // Read CONNECTED banner
        const banner = await readLine(reader, timeoutPromise);
        if (!banner.startsWith('CONNECTED')) {
          throw new Error(`Not a Sonic server: ${banner.substring(0, 100)}`);
        }

        // Start in search mode (lightest)
        const startResult = await tryStartMode(writer, reader, timeoutPromise, 'search', password);
        if (!startResult) {
          throw new Error('Failed to start Sonic session');
        }

        // Send PING
        const pingResponse = await sendCommand(writer, reader, timeoutPromise, 'PING');
        const alive = pingResponse === 'PONG';

        // Clean quit
        const quitResponse = await sendCommand(writer, reader, timeoutPromise, 'QUIT');
        if (!quitResponse.startsWith('ENDED')) {
          // Non-critical protocol violation
        }

        try { writer.releaseLock(); } catch {}
        try { reader.releaseLock(); } catch {}
        try { socket.close(); } catch {}

        return {
          success: true,
          host,
          port,
          rtt: Date.now() - startTime,
          alive,
          response: pingResponse,
        };

      } catch (error) {
        try { writer.releaseLock(); } catch {}
        try { reader.releaseLock(); } catch {}
        try { socket.close(); } catch {}
        throw error;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    })();

    const result = await connectionPromise;
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
