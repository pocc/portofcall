/**
 * MSN/MSNP Protocol Implementation
 *
 * Microsoft Notification Protocol (MSNP) was the protocol used by MSN Messenger
 * (later Windows Live Messenger) for instant messaging. The service was shut down
 * in 2013, but the protocol remains of historical interest.
 *
 * Protocol Overview:
 * - Port: 1863 (TCP)
 * - Format: Text-based command/response protocol
 * - Versions: MSNP2 through MSNP21 (MSNP18 was final widely-used version)
 * - Authentication: Passport/Windows Live ID
 *
 * Connection Flow:
 * 1. TCP connection to messenger.hotmail.com:1863
 * 2. VER - Version negotiation
 * 3. CVR - Client version information
 * 4. USR - User authentication
 * 5. Presence and messaging
 *
 * Command Format:
 * - Three-letter command code
 * - Transaction ID (incrementing number)
 * - Parameters separated by spaces
 * - Terminated with \r\n
 *
 * Example Commands:
 * - VER 1 MSNP18 CVR0\r\n
 * - CVR 2 0x0409 win 10.0 i386 MSNMSGR 8.5.1302 msmsgs user@example.com\r\n
 * - USR 3 TWN I user@example.com\r\n
 *
 * Server Responses:
 * - VER 1 MSNP18\r\n (version accepted)
 * - CVR 2 8.5.1302 8.5.1302 8.5.1302 ... (client version)
 * - USR 3 TWN S ... (authentication challenge)
 * - 500 Internal Server Error
 * - 911 Authentication failed
 *
 * Use Cases:
 * - Legacy MSN server detection
 * - Historical protocol research
 * - IM protocol archaeology
 * - Network forensics
 */

import { connect } from 'cloudflare:sockets';

interface MSNRequest {
  host: string;
  port?: number;
  timeout?: number;
  protocolVersion?: string;
}

interface MSNResponse {
  success: boolean;
  host: string;
  port: number;
  supportedVersions?: string[];
  serverResponse?: string;
  protocolVersion?: string;
  rtt?: number;
  error?: string;
}

/**
 * Build MSN VER (version negotiation) command
 */
function buildMSNVersion(transactionId: number, versions: string[]): string {
  return `VER ${transactionId} ${versions.join(' ')}\r\n`;
}

/**
 * Build MSN CVR (client version) command
 */
function buildMSNClientVersion(transactionId: number): string {
  // CVR format: CVR TrID LocaleID OSType OSVer Arch ClientName ClientVer ClientID UserEmail
  return `CVR ${transactionId} 0x0409 win 10.0 i386 MSNMSGR 8.5.1302 msmsgs probe@example.com\r\n`;
}

/**
 * Parse MSN server response
 */
function parseMSNResponse(data: string): {
  command: string;
  transactionId?: number;
  params: string[];
} | null {
  const lines = data.split('\r\n').filter(line => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  const firstLine = lines[0];
  const parts = firstLine.split(' ');

  if (parts.length < 1) {
    return null;
  }

  const command = parts[0];
  const transactionId = parts.length > 1 ? parseInt(parts[1], 10) : undefined;
  const params = parts.slice(2);

  return {
    command,
    transactionId,
    params,
  };
}

/**
 * Probe MSN server by initiating version negotiation.
 * Detects MSN/MSNP server and supported protocol versions.
 */
export async function handleMSNProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MSNRequest;
    const {
      host,
      port = 1863,
      timeout = 15000,
      protocolVersion = 'MSNP18',
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies MSNResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies MSNResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Send VER command (version negotiation)
      // Try multiple versions for compatibility
      const versions = [protocolVersion, 'MSNP17', 'MSNP16', 'MSNP15', 'CVR0'];
      const verCommand = buildMSNVersion(1, versions);

      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(verCommand));
      writer.releaseLock();

      // Read server response
      const reader = socket.readable.getReader();

      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (done || !value) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response from MSN server',
        } satisfies MSNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const responseText = new TextDecoder().decode(value);
      const parsed = parseMSNResponse(responseText);

      if (!parsed) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid MSN response format',
        } satisfies MSNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      // Check if VER command succeeded
      if (parsed.command === 'VER') {
        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          supportedVersions: parsed.params,
          serverResponse: responseText.trim(),
          protocolVersion: parsed.params[0],
          rtt,
        } satisfies MSNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        // Server responded with error or unexpected command
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          serverResponse: responseText.trim(),
          error: `Unexpected server response: ${parsed.command}`,
          rtt,
        } satisfies MSNResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 1863,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies MSNResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Test MSN client version command.
 * Sends CVR after successful VER to get more server info.
 */
export async function handleMSNClientVersion(request: Request): Promise<Response> {
  try {
    const body = await request.json() as MSNRequest;
    const { host, port = 1863, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Send VER then CVR
      const verCommand = buildMSNVersion(1, ['MSNP18', 'CVR0']);
      const cvrCommand = buildMSNClientVersion(2);

      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(verCommand));
      await writer.write(new TextEncoder().encode(cvrCommand));
      writer.releaseLock();

      // Read responses (may get multiple)
      const reader = socket.readable.getReader();

      const chunks: string[] = [];
      let totalBytes = 0;
      const maxResponseSize = 2000;

      try {
        while (totalBytes < maxResponseSize) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);

          if (done) break;

          if (value) {
            const text = new TextDecoder().decode(value);
            chunks.push(text);
            totalBytes += value.length;

            // Stop after getting both VER and CVR responses
            if (text.includes('CVR')) {
              break;
            }
          }
        }
      } catch {
        // Connection closed by server (expected)
      }

      const responseText = chunks.join('');

      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        serverResponse: responseText.trim(),
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
