/**
 * LDAP Protocol Support for Cloudflare Workers
 * Implements basic LDAP connectivity testing with BIND operation
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface LDAPConnectionOptions {
  host: string;
  port?: number;
  bindDN?: string;
  password?: string;
  timeout?: number;
}

/**
 * Encode LDAP BIND request using ASN.1/BER
 * This is a simplified implementation for testing connectivity
 */
function encodeLDAPBindRequest(options: {
  bindDN?: string;
  password?: string;
}): Uint8Array {
  const encoder = new TextEncoder();

  // Message ID (integer 1)
  const messageId = [0x02, 0x01, 0x01]; // INTEGER 1

  // BIND request tag (0x60)
  const bindTag = 0x60;

  // LDAP version 3
  const version = [0x02, 0x01, 0x03]; // INTEGER 3

  // Bind DN (empty for anonymous, or provided DN)
  const bindDN = options.bindDN || '';
  const bindDNBytes = encoder.encode(bindDN);
  const bindDNEncoded = [0x04, bindDNBytes.length, ...bindDNBytes]; // OCTET STRING

  // Simple authentication (password)
  const password = options.password || '';
  const passwordBytes = encoder.encode(password);
  const authEncoded = [0x80, passwordBytes.length, ...passwordBytes]; // [0] OCTET STRING (simple auth)

  // Build BIND request
  const bindRequest = [...version, ...bindDNEncoded, ...authEncoded];
  const bindRequestEncoded = [bindTag, bindRequest.length, ...bindRequest];

  // Build LDAP message
  const ldapMessage = [...messageId, ...bindRequestEncoded];

  // Sequence tag (0x30) and length
  const totalLength = ldapMessage.length;

  // Handle length encoding (simple case for lengths < 128)
  if (totalLength < 128) {
    return new Uint8Array([0x30, totalLength, ...ldapMessage]);
  } else {
    // Long form length encoding
    const lengthBytes = [];
    let len = totalLength;
    while (len > 0) {
      lengthBytes.unshift(len & 0xFF);
      len >>= 8;
    }
    return new Uint8Array([0x30, 0x80 | lengthBytes.length, ...lengthBytes, ...ldapMessage]);
  }
}

/**
 * Parse LDAP BIND response
 */
function parseLDAPBindResponse(data: Uint8Array): { success: boolean; resultCode: number; message: string } {
  if (data.length < 7) {
    return { success: false, resultCode: -1, message: 'Invalid LDAP response' };
  }

  // Skip sequence tag and length
  let offset = 0;
  if (data[offset] !== 0x30) {
    return { success: false, resultCode: -1, message: 'Expected SEQUENCE tag' };
  }
  offset += 2; // Skip tag and length (simplified)

  // Skip message ID
  if (data[offset] === 0x02) {
    offset += 2 + data[offset + 1]; // Skip INTEGER
  }

  // Check for BIND response tag (0x61)
  if (data[offset] !== 0x61) {
    return { success: false, resultCode: -1, message: 'Expected BIND response' };
  }
  offset += 2; // Skip tag and length

  // Read result code (ENUMERATED)
  if (data[offset] === 0x0A) {
    offset++;
    // Skip result code length byte
    offset++;
    const resultCode = data[offset];

    const messages: { [key: number]: string } = {
      0: 'Success',
      1: 'Operations error',
      2: 'Protocol error',
      7: 'Auth method not supported',
      8: 'Strong auth required',
      32: 'No such object',
      34: 'Invalid DN syntax',
      48: 'Inappropriate authentication',
      49: 'Invalid credentials',
    };

    return {
      success: resultCode === 0,
      resultCode,
      message: messages[resultCode] || `LDAP error code: ${resultCode}`,
    };
  }

  return { success: false, resultCode: -1, message: 'Could not parse result code' };
}

/**
 * Handle LDAP connection test
 */
export async function handleLDAPConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<LDAPConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<LDAPConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '389'),
        bindDN: url.searchParams.get('bindDN') || undefined,
        password: url.searchParams.get('password') || undefined,
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
    const port = options.port || 389;
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
        // Send BIND request
        const bindRequest = encodeLDAPBindRequest({
          bindDN: options.bindDN,
          password: options.password,
        });

        await writer.write(bindRequest);

        // Read BIND response
        const { value } = await reader.read();

        if (!value || value.length < 7) {
          throw new Error('Invalid LDAP response');
        }

        const bindResponse = parseLDAPBindResponse(value);

        await socket.close();

        const bindType = options.bindDN ? 'authenticated' : 'anonymous';

        return {
          success: bindResponse.success,
          message: bindResponse.success ? `LDAP ${bindType} bind successful` : 'LDAP bind failed',
          host,
          port,
          bindDN: options.bindDN || '(anonymous)',
          resultCode: bindResponse.resultCode,
          serverResponse: bindResponse.message,
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
          status: 401,
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
