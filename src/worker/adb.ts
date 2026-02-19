/**
 * ADB (Android Debug Bridge) Smart Socket Protocol Implementation
 *
 * This module implements the ADB **smart socket** (client-to-server) protocol,
 * which is a text-based protocol used to communicate with the ADB server daemon
 * on TCP port 5037.
 *
 * NOTE: This is NOT the ADB binary transport protocol (CNXN/AUTH/OPEN/WRTE/CLSE)
 * used between the ADB server and an Android device on port 5555. For direct
 * device connections, the binary transport protocol would be required — that is
 * not implemented here.
 *
 * Smart Socket Protocol Format:
 * - Client sends: 4-byte lowercase hex length (ASCII) + command string
 *   Example: "000chost:version" (000c = 12 bytes for "host:version")
 * - Server responds with one of:
 *   "OKAY" + optional data (4-byte hex length + payload)
 *   "FAIL" + 4-byte hex length + error message
 *
 * Common Commands:
 * - host:version       — Get ADB server protocol version (hex, e.g. 0x0029 = 41)
 * - host:devices       — List connected devices with state
 * - host:devices-l     — List devices with extended info (transport_id, product, model)
 * - host:kill          — Kill the ADB server (destructive!)
 * - host:track-devices — Stream device connect/disconnect events (long-lived)
 *
 * Shell Command Flow (via ADB server):
 * 1. Client connects to ADB server on port 5037
 * 2. Client sends "host:transport:<serial>" (or "host:transport-any")
 * 3. Server responds OKAY — the connection is now bound to that device
 * 4. Client sends "shell:<command>"
 * 5. Server responds OKAY then streams stdout until the shell exits
 * 6. Server closes the connection
 *
 * Use Cases:
 * - Verify ADB server is running and responsive
 * - Check ADB protocol version for compatibility
 * - List connected Android devices and their states
 * - Execute shell commands on devices via the ADB server
 * - Mobile development and testing infrastructure monitoring
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const ADB_DEFAULT_PORT = 5037;

interface ADBRequest {
  host: string;
  port?: number;
  command?: string;
  timeout?: number;
}

/**
 * Encode an ADB command with the 4-byte hex length prefix.
 * Format: "xxxx<command>" where xxxx is the lowercase hex-encoded byte length.
 * The ADB protocol uses lowercase hex (printf "%04x" format in the C source).
 *
 * Note: The length is the byte length of the command string, not the character
 * length. For ASCII commands this is the same, but we use TextEncoder to be safe.
 */
function encodeADBCommand(command: string): Uint8Array {
  const encoded = new TextEncoder().encode(command);
  const lengthHex = encoded.length.toString(16).padStart(4, '0');
  const prefix = new TextEncoder().encode(lengthHex);
  const result = new Uint8Array(prefix.length + encoded.length);
  result.set(prefix, 0);
  result.set(encoded, prefix.length);
  return result;
}

/**
 * Read all available data from a reader until the connection closes or timeout.
 */
async function readAll(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
  maxBytes: number = 65536,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (totalBytes < maxBytes) {
    try {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) break;

      chunks.push(value);
      totalBytes += value.length;
    } catch {
      break;
    }
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Parse an ADB response. Returns the status (OKAY/FAIL) and any payload data.
 */
function parseADBResponse(data: Uint8Array): {
  status: string;
  payload: string;
  raw: string;
} {
  const decoder = new TextDecoder();
  const raw = decoder.decode(data);

  if (raw.length < 4) {
    return { status: 'ERROR', payload: `Incomplete response: ${raw.length} bytes`, raw };
  }

  const status = raw.substring(0, 4);
  const rest = raw.substring(4);

  if (status === 'OKAY' || status === 'FAIL') {
    // If there's a 4-byte hex length prefix after the status, parse the payload
    if (rest.length >= 4) {
      const payloadLen = parseInt(rest.substring(0, 4), 16);
      if (!isNaN(payloadLen) && payloadLen >= 0) {
        const payload = rest.substring(4, 4 + payloadLen);
        return { status, payload, raw };
      }
    }
    // No length prefix — the rest is the payload directly
    return { status, payload: rest, raw };
  }

  return { status: 'UNKNOWN', payload: raw, raw };
}

/**
 * Handle ADB command — send an arbitrary ADB host command and get the response.
 */
export async function handleADBCommand(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as ADBRequest;
    const {
      host,
      port = ADB_DEFAULT_PORT,
      command = 'host:version',
      timeout = 10000,
    } = body;

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

    if (!command.trim()) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Command is required',
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
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send the ADB command
      const encodedCommand = encodeADBCommand(command);
      await writer.write(encodedCommand);

      // Read the response
      const responseData = await readAll(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (responseData.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          command,
          error: 'No response received — ADB server may not be running or port is blocked',
          rtt,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseADBResponse(responseData);

      // For host:version, decode the hex version number
      let decodedVersion: string | undefined;
      if (command === 'host:version' && parsed.status === 'OKAY' && parsed.payload) {
        const versionNum = parseInt(parsed.payload.trim(), 16);
        if (!isNaN(versionNum)) {
          decodedVersion = `${versionNum} (0x${parsed.payload.trim()})`;
        }
      }

      return new Response(JSON.stringify({
        success: parsed.status === 'OKAY',
        host,
        port,
        command,
        status: parsed.status,
        payload: parsed.payload,
        decodedVersion,
        rtt,
        error: parsed.status === 'FAIL' ? parsed.payload : undefined,
      }), {
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
 * Handle ADB version check — convenience endpoint for host:version command.
 */
export async function handleADBVersion(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = ADB_DEFAULT_PORT, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
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
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send host:version command
      await writer.write(encodeADBCommand('host:version'));

      // Read response
      const responseData = await readAll(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (responseData.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response — ADB server may not be running',
          rtt,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseADBResponse(responseData);

      let protocolVersion: number | null = null;
      if (parsed.status === 'OKAY' && parsed.payload) {
        const vNum = parseInt(parsed.payload.trim(), 16);
        if (!isNaN(vNum)) {
          protocolVersion = vNum;
        }
      }

      return new Response(JSON.stringify({
        success: parsed.status === 'OKAY',
        host,
        port,
        protocolVersion,
        protocolVersionHex: parsed.payload.trim(),
        status: parsed.status,
        rtt,
        error: parsed.status === 'FAIL' ? parsed.payload : undefined,
      }), {
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
 * Handle ADB devices — convenience endpoint for host:devices command.
 */
export async function handleADBDevices(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = ADB_DEFAULT_PORT, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
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
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send host:devices-l for extended info
      await writer.write(encodeADBCommand('host:devices-l'));

      // Read response
      const responseData = await readAll(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (responseData.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response — ADB server may not be running',
          rtt,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseADBResponse(responseData);

      // Parse device list: each line is "serial\tstate\tproperty:value ..."
      const devices: { serial: string; state: string; properties: Record<string, string> }[] = [];
      if (parsed.status === 'OKAY' && parsed.payload.trim()) {
        const lines = parsed.payload.trim().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            const serial = parts[0];
            const state = parts[1];
            const properties: Record<string, string> = {};
            for (let i = 2; i < parts.length; i++) {
              const [key, ...valParts] = parts[i].split(':');
              if (key && valParts.length > 0) {
                properties[key] = valParts.join(':');
              }
            }
            devices.push({ serial, state, properties });
          }
        }
      }

      return new Response(JSON.stringify({
        success: parsed.status === 'OKAY',
        host,
        port,
        deviceCount: devices.length,
        devices,
        raw: parsed.payload,
        rtt,
        error: parsed.status === 'FAIL' ? parsed.payload : undefined,
      }), {
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
 * Handle ADB shell — transport to a specific device and run a shell command.
 *
 * Flow:
 *   1. Connect to the ADB server (default port 5037)
 *   2. Send host:transport:{serial} to select the device
 *      (or host:transport-any if serial is empty)
 *   3. Expect OKAY from the server
 *   4. Send shell:{command}
 *   5. Expect OKAY from the server
 *   6. Read all output until the socket closes
 *   7. Return stdout as a string
 */
export async function handleADBShell(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      serial?: string;
      command: string;
      timeout?: number;
    };

    const {
      host,
      port = ADB_DEFAULT_PORT,
      serial = '',
      command,
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!command) {
      return new Response(JSON.stringify({ success: false, error: 'Command is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
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
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Buffer for bytes that arrive ahead of what we need.
      let leftover = new Uint8Array(0);

      /**
       * Read until we have at least `needed` bytes, then return them.
       * Any bytes beyond `needed` are stored in `leftover`.
       */
      async function readAtLeast(needed: number): Promise<Uint8Array> {
        while (leftover.length < needed) {
          const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
          if (done || !value) throw new Error('Connection closed unexpectedly');
          const merged = new Uint8Array(leftover.length + value.length);
          merged.set(leftover, 0);
          merged.set(value, leftover.length);
          leftover = merged;
        }
        const out = leftover.subarray(0, needed);
        leftover = leftover.subarray(needed);
        return out;
      }

      /**
       * Send a command and verify the ADB server responds with OKAY.
       * Throws on FAIL with the server-provided reason.
       */
      async function sendAndCheckOkay(cmd: string): Promise<void> {
        await writer.write(encodeADBCommand(cmd));

        const statusBytes = await readAtLeast(4);
        const status = new TextDecoder().decode(statusBytes);

        if (status === 'OKAY') {
          return;
        }

        if (status === 'FAIL') {
          // FAIL is followed by 4-hex-digit length + error message
          const lenBytes = await readAtLeast(4);
          const reasonLen = parseInt(new TextDecoder().decode(lenBytes), 16);
          if (isNaN(reasonLen) || reasonLen <= 0) {
            throw new Error('ADB FAIL: unknown error');
          }
          const reasonBytes = await readAtLeast(reasonLen);
          const reason = new TextDecoder().decode(reasonBytes);
          throw new Error(`ADB FAIL: ${reason}`);
        }

        throw new Error(`ADB unexpected status: ${status}`);
      }

      // Step 1: Select the device transport
      const transportCmd = serial.trim() ? `host:transport:${serial.trim()}` : 'host:transport-any';
      await sendAndCheckOkay(transportCmd);

      // Step 2: Run the shell command
      // After the OKAY for shell:, the server streams stdout until it closes.
      await writer.write(encodeADBCommand(`shell:${command}`));
      const shellStatusBytes = await readAtLeast(4);
      const shellStatus = new TextDecoder().decode(shellStatusBytes);

      if (shellStatus === 'FAIL') {
        const lenBytes = await readAtLeast(4);
        const reasonLen = parseInt(new TextDecoder().decode(lenBytes), 16);
        const reasonBytes = reasonLen > 0 ? await readAtLeast(reasonLen) : new Uint8Array(0);
        const reason = new TextDecoder().decode(reasonBytes);
        throw new Error(`ADB shell FAIL: ${reason}`);
      }

      if (shellStatus !== 'OKAY') {
        throw new Error(`ADB shell unexpected status: ${shellStatus}`);
      }

      // Step 3: Drain remaining output (leftover bytes + anything still incoming)
      const outputChunks: Uint8Array[] = leftover.length > 0 ? [leftover] : [];
      leftover = new Uint8Array(0);

      while (true) {
        try {
          const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
          if (done || !value) break;
          outputChunks.push(value);
        } catch {
          break;
        }
      }

      const totalLen = outputChunks.reduce((s, c) => s + c.length, 0);
      const outputBuf = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of outputChunks) {
        outputBuf.set(chunk, offset);
        offset += chunk.length;
      }

      const rtt = Date.now() - startTime;
      const stdout = new TextDecoder().decode(outputBuf);

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        serial: serial.trim() || '(any)',
        command,
        stdout,
        rtt,
      }), {
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
