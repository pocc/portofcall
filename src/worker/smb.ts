/**
 * SMB Protocol Support for Cloudflare Workers
 * Implements basic SMB2/SMB3 protocol negotiation for connectivity testing
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface SMBConnectionOptions {
  host: string;
  port?: number;
  timeout?: number;
}

/**
 * Encode SMB2 Negotiate Protocol Request
 */
function encodeSMB2Negotiate(): Uint8Array {
  const netbiosHeader = new Uint8Array([
    0x00, 0x00, 0x00, 0x00, // NetBIOS session message (length will be set later)
  ]);

  const smbHeader = new Uint8Array([
    0xFE, 0x53, 0x4D, 0x42, // Protocol: \xFESMB (SMB2)
    0x40, 0x00, // StructureSize: 64
    0x00, 0x00, // CreditCharge: 0
    0x00, 0x00, 0x00, 0x00, // Status: 0
    0x00, 0x00, // Command: SMB2 NEGOTIATE (0)
    0x00, 0x00, // CreditRequest: 0
    0x00, 0x00, 0x00, 0x00, // Flags: 0
    0x00, 0x00, 0x00, 0x00, // NextCommand: 0
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // MessageID: 0
    0x00, 0x00, 0x00, 0x00, // Reserved: 0
    0x00, 0x00, 0x00, 0x00, // TreeID: 0
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // SessionID: 0
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // Signature: 0
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);

  const negotiateRequest = new Uint8Array([
    0x24, 0x00, // StructureSize: 36
    0x05, 0x00, // DialectCount: 5
    0x00, 0x00, // SecurityMode: 0
    0x00, 0x00, // Reserved: 0
    0x00, 0x00, 0x00, 0x00, // Capabilities: 0
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // ClientGUID: 0
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // NegotiateContextOffset: 0
    0x00, 0x00, // NegotiateContextCount: 0
    0x00, 0x00, // Reserved2: 0
    // Dialects: SMB 2.0.2, 2.1, 3.0, 3.0.2, 3.1.1
    0x02, 0x02, // SMB 2.0.2
    0x10, 0x02, // SMB 2.1
    0x00, 0x03, // SMB 3.0
    0x02, 0x03, // SMB 3.0.2
    0x11, 0x03, // SMB 3.1.1
  ]);

  const message = new Uint8Array(smbHeader.length + negotiateRequest.length);
  message.set(smbHeader, 0);
  message.set(negotiateRequest, smbHeader.length);

  // Set NetBIOS length
  const length = message.length;
  netbiosHeader[1] = (length >> 16) & 0xFF;
  netbiosHeader[2] = (length >> 8) & 0xFF;
  netbiosHeader[3] = length & 0xFF;

  const packet = new Uint8Array(netbiosHeader.length + message.length);
  packet.set(netbiosHeader, 0);
  packet.set(message, netbiosHeader.length);

  return packet;
}

/**
 * Parse SMB2 Negotiate Protocol Response
 */
function parseSMB2Negotiate(data: Uint8Array): { success: boolean; dialect?: string; message: string } {
  if (data.length < 68) {
    return { success: false, message: 'Invalid SMB response (too short)' };
  }

  // Skip NetBIOS header (4 bytes)
  let offset = 4;

  // Check SMB2 protocol signature (\xFESMB)
  if (data[offset] !== 0xFE || data[offset + 1] !== 0x53 ||
      data[offset + 2] !== 0x4D || data[offset + 3] !== 0x42) {
    return { success: false, message: 'Invalid SMB2 protocol signature' };
  }

  offset += 4; // Skip protocol signature

  // Skip StructureSize, CreditCharge
  offset += 4;

  // Read Status (4 bytes, little-endian)
  const status = data[offset] | (data[offset + 1] << 8) |
                 (data[offset + 2] << 16) | (data[offset + 3] << 24);

  if (status !== 0) {
    return { success: false, message: `SMB error status: 0x${status.toString(16)}` };
  }

  offset += 4;

  // Read Command (2 bytes, little-endian)
  const command = data[offset] | (data[offset + 1] << 8);

  if (command !== 0) { // Negotiate should be command 0
    return { success: false, message: `Unexpected command: ${command}` };
  }

  offset += 2;

  // Skip to negotiate response body (after full SMB2 header)
  offset = 4 + 64; // NetBIOS header + SMB2 header

  // Skip StructureSize (2 bytes)
  offset += 2;

  // Read SecurityMode, DialectRevision
  offset += 2; // Skip SecurityMode
  const dialectRevision = data[offset] | (data[offset + 1] << 8);

  const dialectNames: { [key: number]: string } = {
    0x0202: 'SMB 2.0.2',
    0x0210: 'SMB 2.1',
    0x0300: 'SMB 3.0',
    0x0302: 'SMB 3.0.2',
    0x0311: 'SMB 3.1.1',
  };

  const dialect = dialectNames[dialectRevision] || `Unknown (0x${dialectRevision.toString(16)})`;

  return {
    success: true,
    dialect,
    message: `SMB negotiation successful - Dialect: ${dialect}`,
  };
}

/**
 * Handle SMB connection test
 */
export async function handleSMBConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<SMBConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<SMBConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '445'),
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      };
    }

    // Validate required fields
    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 445;
    const timeoutMs = options.timeout || 30000;

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

    // Wrap entire connection in timeout
    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send SMB2 Negotiate request
        const negotiatePacket = encodeSMB2Negotiate();
        await writer.write(negotiatePacket);

        // Read SMB2 Negotiate response
        const { value } = await reader.read();

        if (!value || value.length < 68) {
          throw new Error('Invalid SMB response');
        }

        const negotiateResponse = parseSMB2Negotiate(value);

        await socket.close();

        return {
          success: negotiateResponse.success,
          message: negotiateResponse.success ? 'SMB connection successful' : 'SMB connection failed',
          host,
          port,
          dialect: negotiateResponse.dialect,
          serverResponse: negotiateResponse.message,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);

      if (!result.success) {
        return new Response(JSON.stringify(result), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
