/**
 * MQTT Protocol Support for Cloudflare Workers
 * Implements basic MQTT 3.1.1 protocol for connectivity testing
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface MQTTConnectionOptions {
  host: string;
  port?: number;
  clientId?: string;
  username?: string;
  password?: string;
  timeout?: number;
}

/**
 * Encode MQTT CONNECT packet
 */
function encodeMQTTConnect(options: {
  clientId: string;
  username?: string;
  password?: string;
}): Uint8Array {
  const encoder = new TextEncoder();

  // Protocol name "MQTT"
  const protocolName = encoder.encode('MQTT');
  const protocolLevel = 4; // MQTT 3.1.1

  // Connect flags
  let connectFlags = 0x02; // Clean session

  // Username flag
  if (options.username) {
    connectFlags |= 0x80;
  }

  // Password flag
  if (options.password) {
    connectFlags |= 0x40;
  }

  // Keep alive (60 seconds)
  const keepAlive = 60;

  // Build variable header
  const variableHeader: number[] = [
    0, protocolName.length, // Protocol name length
    ...protocolName,
    protocolLevel,
    connectFlags,
    keepAlive >> 8, keepAlive & 0xFF,
  ];

  // Build payload
  const clientIdBytes = encoder.encode(options.clientId);
  const payload: number[] = [
    clientIdBytes.length >> 8, clientIdBytes.length & 0xFF,
    ...clientIdBytes,
  ];

  // Add username if provided
  if (options.username) {
    const usernameBytes = encoder.encode(options.username);
    payload.push(usernameBytes.length >> 8, usernameBytes.length & 0xFF);
    payload.push(...usernameBytes);
  }

  // Add password if provided
  if (options.password) {
    const passwordBytes = encoder.encode(options.password);
    payload.push(passwordBytes.length >> 8, passwordBytes.length & 0xFF);
    payload.push(...passwordBytes);
  }

  // Calculate remaining length
  const remainingLength = variableHeader.length + payload.length;

  // Build fixed header
  const fixedHeader = [
    0x10, // CONNECT packet type
    remainingLength,
  ];

  return new Uint8Array([...fixedHeader, ...variableHeader, ...payload]);
}

/**
 * Parse MQTT CONNACK packet
 */
function parseMQTTConnack(data: Uint8Array): { success: boolean; returnCode: number; message: string } {
  if (data.length < 4) {
    return { success: false, returnCode: -1, message: 'Invalid CONNACK packet' };
  }

  const packetType = data[0] >> 4;
  if (packetType !== 2) { // CONNACK
    return { success: false, returnCode: -1, message: 'Expected CONNACK packet' };
  }

  const returnCode = data[3];

  const messages: { [key: number]: string } = {
    0: 'Connection accepted',
    1: 'Connection refused: unacceptable protocol version',
    2: 'Connection refused: identifier rejected',
    3: 'Connection refused: server unavailable',
    4: 'Connection refused: bad username or password',
    5: 'Connection refused: not authorized',
  };

  return {
    success: returnCode === 0,
    returnCode,
    message: messages[returnCode] || `Unknown return code: ${returnCode}`,
  };
}

/**
 * Handle MQTT connection test
 */
export async function handleMQTTConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<MQTTConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<MQTTConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '1883'),
        clientId: url.searchParams.get('clientId') || undefined,
        username: url.searchParams.get('username') || undefined,
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
    const port = options.port || 1883;
    const timeoutMs = options.timeout || 30000;
    const clientId = options.clientId || `cf-worker-${Math.random().toString(36).substring(7)}`;

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
        // Send CONNECT packet
        const connectPacket = encodeMQTTConnect({
          clientId,
          username: options.username,
          password: options.password,
        });

        await writer.write(connectPacket);

        // Read CONNACK packet
        const { value } = await reader.read();

        if (!value || value.length < 4) {
          throw new Error('Invalid MQTT response');
        }

        const connack = parseMQTTConnack(value);

        await socket.close();

        return {
          success: connack.success,
          message: connack.success ? 'MQTT connection successful' : 'MQTT connection failed',
          host,
          port,
          clientId,
          returnCode: connack.returnCode,
          serverResponse: connack.message,
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
