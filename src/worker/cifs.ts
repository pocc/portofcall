/**
 * CIFS (Common Internet File System) Protocol Support
 * Implements SMB1/CIFS Negotiate Protocol Request for connectivity testing
 *
 * CIFS is the original SMB 1.0 protocol, now largely deprecated in favor
 * of SMB 2.0+. Many modern servers will reject SMB1 or respond with an
 * SMB2 redirect.
 *
 * Port: 445 (TCP direct), 139 (NetBIOS)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface CIFSConnectionOptions {
  host: string;
  port?: number;
  timeout?: number;
}

/**
 * Build an SMB1 Negotiate Protocol Request packet (with NetBIOS session header)
 */
function encodeSMB1Negotiate(): Uint8Array {
  // Dialects to negotiate (CIFS / SMB1)
  const dialectStrings = [
    '\x02PC NETWORK PROGRAM 1.0\x00',
    '\x02LANMAN1.0\x00',
    '\x02Windows for Workgroups 3.1a\x00',
    '\x02LM1.2X002\x00',
    '\x02LANMAN2.1\x00',
    '\x02NT LM 0.12\x00',
  ];
  const dialectBytes = new TextEncoder().encode(dialectStrings.join(''));

  // SMB1 header (32 bytes)
  const smb1Header = new Uint8Array([
    0xFF, 0x53, 0x4D, 0x42, // Protocol: \xFFSMB
    0x72,                   // Command: SMB_COM_NEGOTIATE
    0x00, 0x00, 0x00, 0x00, // Status: NT_STATUS_SUCCESS
    0x18,                   // Flags
    0x01, 0xC8,             // Flags2
    0x00, 0x00,             // PIDHigh
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // SecurityFeatures
    0x00, 0x00,             // Reserved
    0xFF, 0xFF,             // TID
    0xFE, 0xFF,             // PIDLow
    0x00, 0x00,             // UID
    0x01, 0x00,             // MID
  ]);

  // Body: WordCount(1) + ByteCount(2) + dialect list
  const body = new Uint8Array(1 + 2 + dialectBytes.length);
  body[0] = 0x00; // WordCount = 0 (no parameter words for negotiate request)
  body[1] = dialectBytes.length & 0xFF;
  body[2] = (dialectBytes.length >> 8) & 0xFF;
  body.set(dialectBytes, 3);

  // Combine SMB1 header + body
  const message = new Uint8Array(smb1Header.length + body.length);
  message.set(smb1Header, 0);
  message.set(body, smb1Header.length);

  // NetBIOS Session Message header (4 bytes): type 0x00 + 3-byte length
  const netbiosHeader = new Uint8Array(4);
  netbiosHeader[0] = 0x00;
  netbiosHeader[1] = (message.length >> 16) & 0xFF;
  netbiosHeader[2] = (message.length >> 8) & 0xFF;
  netbiosHeader[3] = message.length & 0xFF;

  const packet = new Uint8Array(4 + message.length);
  packet.set(netbiosHeader, 0);
  packet.set(message, 4);
  return packet;
}

/**
 * Parse SMB1 or SMB2 Negotiate Protocol Response
 */
function parseSMB1Negotiate(data: Uint8Array): {
  success: boolean;
  dialect?: string;
  smb2Redirect: boolean;
  message: string;
} {
  if (data.length < 8) {
    return { success: false, smb2Redirect: false, message: 'Response too short' };
  }

  // Skip NetBIOS header (4 bytes)
  const offset = 4;

  if (data.length <= offset + 4) {
    return { success: false, smb2Redirect: false, message: 'Response truncated after NetBIOS header' };
  }

  // Check for SMB2 redirect (server rejected SMB1)
  if (data[offset] === 0xFE && data[offset + 1] === 0x53 &&
      data[offset + 2] === 0x4D && data[offset + 3] === 0x42) {
    return {
      success: false,
      smb2Redirect: true,
      message: 'Server rejected SMB1/CIFS — responded with SMB2/SMB3 protocol. SMB1 is disabled on this server.',
    };
  }

  // Check for SMB1 protocol signature (\xFFSMB)
  if (data[offset] !== 0xFF || data[offset + 1] !== 0x53 ||
      data[offset + 2] !== 0x4D || data[offset + 3] !== 0x42) {
    return { success: false, smb2Redirect: false, message: 'Unexpected response — not an SMB1 packet' };
  }

  // offset+4 = Command (should be 0x72), +5..+8 = Status
  const status = data[offset + 5] | (data[offset + 6] << 8) |
                 (data[offset + 7] << 16) | (data[offset + 8] << 24);
  if (status !== 0) {
    return {
      success: false,
      smb2Redirect: false,
      message: `SMB1 error status: 0x${status.toString(16).padStart(8, '0')}`,
    };
  }

  // Navigate to negotiate response body: 4 (NetBIOS) + 32 (SMB1 header) = 36
  const bodyOffset = 36;
  if (data.length <= bodyOffset) {
    return { success: false, smb2Redirect: false, message: 'Response too short for negotiate body' };
  }

  const wordCount = data[bodyOffset];
  if (wordCount < 1) {
    return { success: false, smb2Redirect: false, message: 'No dialect selected by server' };
  }

  // DialectIndex is the first word (2 bytes, little-endian)
  const dialectIndex = data[bodyOffset + 1] | (data[bodyOffset + 2] << 8);
  const dialectNames: Record<number, string> = {
    0: 'PC NETWORK PROGRAM 1.0',
    1: 'LANMAN1.0',
    2: 'Windows for Workgroups 3.1a',
    3: 'LM1.2X002',
    4: 'LANMAN2.1',
    5: 'NT LM 0.12 (CIFS)',
  };

  const dialect = dialectNames[dialectIndex] ?? `Unknown dialect (index ${dialectIndex})`;
  return {
    success: true,
    smb2Redirect: false,
    dialect,
    message: `CIFS/SMB1 negotiation successful — Dialect: ${dialect}`,
  };
}

/**
 * Handle CIFS connectivity test
 */
export async function handleCIFSConnect(request: Request): Promise<Response> {
  try {
    let options: Partial<CIFSConnectionOptions>;
    if (request.method === 'POST') {
      options = await request.json() as Partial<CIFSConnectionOptions>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '445'),
        timeout: parseInt(url.searchParams.get('timeout') || '10000'),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 445;
    const timeoutMs = options.timeout || 10000;

    // Check if behind Cloudflare
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const negotiatePacket = encodeSMB1Negotiate();
        await writer.write(negotiatePacket);

        const { value } = await reader.read();
        if (!value || value.length < 8) {
          throw new Error('Invalid or empty CIFS response');
        }

        const parsed = parseSMB1Negotiate(value);
        await socket.close();

        return {
          success: parsed.success || parsed.smb2Redirect,
          host,
          port,
          dialect: parsed.dialect,
          smb2Redirect: parsed.smb2Redirect,
          message: parsed.message,
          serverInfo: parsed.success
            ? `CIFS/SMB1 is active — selected dialect: ${parsed.dialect}`
            : parsed.smb2Redirect
              ? 'Server is SMB2/SMB3 only — SMB1/CIFS is disabled'
              : parsed.message,
        };
      } catch (err) {
        await socket.close();
        throw err;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unexpected error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
