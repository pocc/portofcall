/**
 * SOCKS5 Protocol Implementation (RFC 1928)
 * Generic TCP proxy with authentication support
 * Port: 1080 (default)
 *
 * Improvements over SOCKS4:
 * - Username/password authentication (RFC 1929)
 * - Domain name resolution by proxy server
 * - IPv6 support
 * - UDP ASSOCIATE command
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/** SOCKS5 authentication methods */
const AUTH_NONE = 0x00;
const AUTH_USERPASS = 0x02;
const AUTH_NO_ACCEPTABLE = 0xff;

/** SOCKS5 address types */
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;

/** SOCKS5 reply codes */
const REPLY_NAMES: Record<number, string> = {
  0x00: 'Succeeded',
  0x01: 'General SOCKS server failure',
  0x02: 'Connection not allowed by ruleset',
  0x03: 'Network unreachable',
  0x04: 'Host unreachable',
  0x05: 'Connection refused',
  0x06: 'TTL expired',
  0x07: 'Command not supported',
  0x08: 'Address type not supported',
};

/** Auth method names */
const AUTH_METHOD_NAMES: Record<number, string> = {
  [AUTH_NONE]: 'No authentication',
  [AUTH_USERPASS]: 'Username/password',
  [AUTH_NO_ACCEPTABLE]: 'No acceptable methods',
};

interface Socks5Request {
  proxyHost: string;
  proxyPort?: number;
  destHost: string;
  destPort: number;
  username?: string;
  password?: string;
  timeout?: number;
}

/**
 * Parse a bound address from SOCKS5 response
 */
function parseBoundAddress(data: Uint8Array, offset: number): { address: string; port: number; newOffset: number } {
  const atyp = data[offset];
  offset++;

  let address = '';

  switch (atyp) {
    case ATYP_IPV4: {
      if (offset + 4 > data.length) throw new Error('Truncated IPv4 address');
      address = `${data[offset]}.${data[offset + 1]}.${data[offset + 2]}.${data[offset + 3]}`;
      offset += 4;
      break;
    }
    case ATYP_DOMAIN: {
      const len = data[offset];
      offset++;
      if (offset + len > data.length) throw new Error('Truncated domain name');
      for (let i = 0; i < len; i++) {
        address += String.fromCharCode(data[offset + i]);
      }
      offset += len;
      break;
    }
    case ATYP_IPV6: {
      if (offset + 16 > data.length) throw new Error('Truncated IPv6 address');
      const parts: string[] = [];
      for (let i = 0; i < 8; i++) {
        const val = (data[offset + i * 2] << 8) | data[offset + i * 2 + 1];
        parts.push(val.toString(16));
      }
      address = parts.join(':');
      offset += 16;
      break;
    }
    default:
      address = `unknown(atyp=${atyp})`;
      break;
  }

  if (offset + 2 > data.length) throw new Error('Truncated port');
  const port = (data[offset] << 8) | data[offset + 1];
  offset += 2;

  return { address, port, newOffset: offset };
}

/**
 * Handle SOCKS5 proxy connection test
 */
export async function handleSocks5Connect(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as Socks5Request;
    const {
      proxyHost,
      proxyPort = 1080,
      destHost,
      destPort,
      username,
      password,
      timeout = 15000,
    } = body;

    // Validation
    if (!proxyHost) {
      return new Response(
        JSON.stringify({ success: false, error: 'Proxy host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!destHost) {
      return new Response(
        JSON.stringify({ success: false, error: 'Destination host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!destPort || destPort < 1 || destPort > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Valid destination port is required (1-65535)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if the proxy is behind Cloudflare
    const cfCheck = await checkIfCloudflare(proxyHost);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(proxyHost, cfCheck.ip),
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

      // Step 1: Connect to SOCKS5 proxy
      const socket = connect(`${proxyHost}:${proxyPort}`);
      await socket.opened;

      const connectTime = Date.now() - startTime;

      try {
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();

        // Step 2: Send greeting (authentication methods)
        const hasAuth = username && password;
        const methods = hasAuth ? [AUTH_NONE, AUTH_USERPASS] : [AUTH_NONE];
        const greeting = new Uint8Array([0x05, methods.length, ...methods]);
        await writer.write(greeting);

        // Step 3: Read server's chosen method
        const { value: methodResponse } = await reader.read();
        if (!methodResponse || methodResponse.length < 2) {
          throw new Error('Invalid greeting response from SOCKS5 proxy');
        }

        if (methodResponse[0] !== 0x05) {
          throw new Error(`Not a SOCKS5 proxy (version ${methodResponse[0]})`);
        }

        const selectedMethod = methodResponse[1];
        const selectedMethodName = AUTH_METHOD_NAMES[selectedMethod] || `Unknown (0x${selectedMethod.toString(16)})`;

        if (selectedMethod === AUTH_NO_ACCEPTABLE) {
          throw new Error('SOCKS5 proxy rejected all authentication methods');
        }

        // Step 4: Authenticate if needed
        let authSuccess = false;
        if (selectedMethod === AUTH_USERPASS) {
          if (!username || !password) {
            throw new Error('SOCKS5 proxy requires authentication but no credentials provided');
          }

          const usernameBytes = new TextEncoder().encode(username);
          const passwordBytes = new TextEncoder().encode(password);

          const authPacket = new Uint8Array([
            0x01, // auth sub-negotiation version
            usernameBytes.length,
            ...usernameBytes,
            passwordBytes.length,
            ...passwordBytes,
          ]);

          await writer.write(authPacket);

          const { value: authResponse } = await reader.read();
          if (!authResponse || authResponse.length < 2) {
            throw new Error('Invalid authentication response');
          }

          if (authResponse[1] !== 0x00) {
            throw new Error('SOCKS5 authentication failed (invalid credentials)');
          }

          authSuccess = true;
        }

        // Step 5: Send CONNECT request
        const hostBytes = new TextEncoder().encode(destHost);
        const connectRequest = new Uint8Array([
          0x05, // SOCKS version
          0x01, // CONNECT command
          0x00, // Reserved
          ATYP_DOMAIN, // Address type: domain name
          hostBytes.length,
          ...hostBytes,
          (destPort >> 8) & 0xff,
          destPort & 0xff,
        ]);

        await writer.write(connectRequest);

        // Step 6: Read CONNECT response
        const { value: connectResponse } = await reader.read();
        if (!connectResponse || connectResponse.length < 4) {
          throw new Error('Invalid CONNECT response');
        }

        if (connectResponse[0] !== 0x05) {
          throw new Error(`Invalid SOCKS version in response: ${connectResponse[0]}`);
        }

        const replyCode = connectResponse[1];
        const replyMessage = REPLY_NAMES[replyCode] || `Unknown reply (0x${replyCode.toString(16)})`;
        const granted = replyCode === 0x00;

        // Parse bound address
        let boundAddress = '';
        let boundPort = 0;
        try {
          const bound = parseBoundAddress(connectResponse, 3);
          boundAddress = bound.address;
          boundPort = bound.port;
        } catch {
          // Bound address parsing is best-effort
        }

        const totalTime = Date.now() - startTime;

        // Cleanup
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          granted,
          proxyHost,
          proxyPort,
          destHost,
          destPort,
          authMethod: selectedMethodName,
          authSuccess: selectedMethod === AUTH_USERPASS ? authSuccess : null,
          replyCode,
          replyMessage,
          boundAddress,
          boundPort,
          connectTimeMs: connectTime,
          totalTimeMs: totalTime,
        };
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
