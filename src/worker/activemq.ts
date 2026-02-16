/**
 * Apache ActiveMQ OpenWire Protocol Handler
 *
 * OpenWire is the native binary protocol used by Apache ActiveMQ.
 * Default Port: 61616
 *
 * Protocol Details:
 * - Binary marshalled command-based protocol
 * - WireFormat negotiation on connect
 * - Command framing: [type:1][size:4][data:n]
 * - Marshalling uses types like String, Integer, Boolean, etc.
 *
 * Handshake Flow:
 * 1. Client → Server: WIREFORMAT_INFO (command 1)
 * 2. Server → Client: WIREFORMAT_INFO response
 * 3. Optional: BROKER_INFO exchange
 *
 * References:
 * - https://activemq.apache.org/openwire
 * - https://github.com/apache/activemq/blob/main/activemq-client/src/main/java/org/apache/activemq/openwire/v12/
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const DEFAULT_PORT = 61616;
const DEFAULT_TIMEOUT = 30000;

// OpenWire Command IDs
const WIREFORMAT_INFO = 1;
const BROKER_INFO = 2;

// OpenWire Data Types
// const NULL_TYPE = 0;
const BOOLEAN_TYPE = 1;
// const BYTE_TYPE = 2;
// const SHORT_TYPE = 4;
const INTEGER_TYPE = 5;
const LONG_TYPE = 6;
const STRING_TYPE = 8;
// const BYTE_ARRAY_TYPE = 10;

interface WireFormatInfo {
  version: number;
  properties: Map<string, unknown>;
  magic?: Uint8Array;
}

interface BrokerInfo {
  brokerId?: string;
  brokerURL?: string;
  brokerName?: string;
  peerBrokerInfos?: unknown[];
  brokerUploadUrl?: string;
  networkConnection?: boolean;
  duplex?: boolean;
  slaveBroker?: boolean;
}

/**
 * Handle ActiveMQ connection test
 * Sends WIREFORMAT_INFO and parses response
 */
export async function handleActiveMQConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { host, port = DEFAULT_PORT, timeout = DEFAULT_TIMEOUT } = await request.json<{
      host?: string;
      port?: number;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const socket = connect({ hostname: host, port });
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    try {
      // Set timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      );

      await Promise.race([socket.opened, timeoutPromise]);

      // Send WIREFORMAT_INFO command
      const wireFormatInfoPacket = buildWireFormatInfo();
      await writer.write(wireFormatInfoPacket);

      // Read response with timeout
      const responsePromise = readCommand(reader);
      const response = (await Promise.race([responsePromise, timeoutPromise])) as {
        commandId: number;
        data: Uint8Array;
      };

      let result: {
        success: boolean;
        message?: string;
        wireFormat?: WireFormatInfo;
        broker?: BrokerInfo;
        error?: string;
      } = { success: true };

      if (response.commandId === WIREFORMAT_INFO) {
        const wireFormat = parseWireFormatInfo(response.data);
        result.wireFormat = wireFormat;
        result.message = `Connected to ActiveMQ broker (OpenWire version ${wireFormat.version})`;
      } else if (response.commandId === BROKER_INFO) {
        const brokerInfo = parseBrokerInfo(response.data);
        result.broker = brokerInfo;
        result.message = `Connected to ActiveMQ broker: ${brokerInfo.brokerName || 'Unknown'}`;
      } else {
        result.message = `Received command ID ${response.commandId}`;
      }

      // Try to read BROKER_INFO if first response was WIREFORMAT_INFO
      if (response.commandId === WIREFORMAT_INFO) {
        try {
          const brokerTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Broker info timeout')), 5000)
          );
          const brokerResponse = (await Promise.race([
            readCommand(reader),
            brokerTimeout,
          ])) as { commandId: number; data: Uint8Array };

          if (brokerResponse.commandId === BROKER_INFO) {
            result.broker = parseBrokerInfo(brokerResponse.data);
          }
        } catch {
          // Broker info is optional, continue without it
        }
      }

      await writer.close();
      await reader.cancel();
      await socket.close();

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      await writer.close();
      await reader.cancel();
      await socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'ActiveMQ connection failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Handle ActiveMQ broker probe
 * Get detailed broker information
 */
export async function handleActiveMQProbe(request: Request): Promise<Response> {
  // For now, probe is the same as connect
  // Could be extended to send additional commands for more info
  return handleActiveMQConnect(request);
}

/**
 * Build WIREFORMAT_INFO command packet
 */
function buildWireFormatInfo(): Uint8Array {
  const buffer: number[] = [];

  // Command type: WIREFORMAT_INFO (1)
  buffer.push(WIREFORMAT_INFO);

  // Build WireFormatInfo data
  const properties = new Map<string, unknown>();
  properties.set('MaxFrameSize', 104857600); // 100MB
  properties.set('CacheEnabled', true);
  properties.set('SizePrefixDisabled', false);
  properties.set('TcpNoDelayEnabled', true);
  properties.set('TightEncodingEnabled', true);
  properties.set('StackTraceEnabled', true);
  properties.set('CacheSize', 1024);
  properties.set('MaxInactivityDuration', 30000);
  properties.set('MaxInactivityDurationInitalDelay', 10000);

  const data: number[] = [];

  // Marshal WireFormatInfo object
  data.push(WIREFORMAT_INFO); // Object type

  // Version (marshalled as int)
  data.push(INTEGER_TYPE);
  pushInt(data, 12); // OpenWire version 12

  // Properties map
  data.push(10); // Map type indicator
  pushInt(data, properties.size);

  for (const [key, value] of properties.entries()) {
    // Key (string)
    data.push(STRING_TYPE);
    const keyBytes = new TextEncoder().encode(key);
    pushShort(data, keyBytes.length);
    data.push(...keyBytes);

    // Value
    if (typeof value === 'boolean') {
      data.push(BOOLEAN_TYPE);
      data.push(value ? 1 : 0);
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        data.push(INTEGER_TYPE);
        pushInt(data, value);
      } else {
        // Long for large numbers
        data.push(LONG_TYPE);
        pushLong(data, value);
      }
    } else if (typeof value === 'string') {
      data.push(STRING_TYPE);
      const valueBytes = new TextEncoder().encode(value);
      pushShort(data, valueBytes.length);
      data.push(...valueBytes);
    }
  }

  // Frame the command: [type:1][size:4][data:n]
  const frameSize = data.length;
  pushInt(buffer, frameSize);
  buffer.push(...data);

  return new Uint8Array(buffer);
}

/**
 * Read an OpenWire command from the socket
 */
async function readCommand(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<{ commandId: number; data: Uint8Array }> {
  // Read command type (1 byte)
  const typeResult = await reader.read();
  if (typeResult.done || !typeResult.value || typeResult.value.length === 0) {
    throw new Error('Connection closed');
  }
  const commandId = typeResult.value[0];

  // Read size (4 bytes, big-endian)
  const sizeBytes = await readExact(reader, 4);
  const size = new DataView(sizeBytes.buffer).getUint32(0, false);

  // Read data
  const data = await readExact(reader, size);

  return { commandId, data };
}

/**
 * Read exact number of bytes from stream
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number
): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let offset = 0;

  while (offset < length) {
    const result = await reader.read();
    if (result.done) {
      throw new Error('Unexpected end of stream');
    }
    const chunk = result.value;
    const toCopy = Math.min(chunk.length, length - offset);
    buffer.set(chunk.subarray(0, toCopy), offset);
    offset += toCopy;
  }

  return buffer;
}

/**
 * Parse WIREFORMAT_INFO response
 */
function parseWireFormatInfo(data: Uint8Array): WireFormatInfo {
  let offset = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Skip object type
  offset += 1;

  // Read version
  const versionType = data[offset++];
  let version = 0;
  if (versionType === INTEGER_TYPE) {
    version = view.getInt32(offset, false);
    offset += 4;
  }

  // Read properties map (simplified parsing)
  const properties = new Map<string, unknown>();

  return { version, properties };
}

/**
 * Parse BROKER_INFO response
 */
function parseBrokerInfo(data: Uint8Array): BrokerInfo {
  let offset = 0;
  // const _view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const result: BrokerInfo = {};

  try {
    // Skip object type
    offset += 1;

    // Parse fields (simplified)
    // In reality, BrokerInfo has many fields that need proper unmarshalling
    // For now, we'll try to extract basic info

    // Try to find broker name in the data (simplified heuristic)
    const decoder = new TextDecoder();
    const dataStr = decoder.decode(data);

    // Look for common patterns
    const nameMatch = dataStr.match(/localhost|broker|activemq/i);
    if (nameMatch) {
      result.brokerName = nameMatch[0];
    }

    result.brokerURL = 'tcp://unknown:61616';
  } catch {
    // Parsing failed, return minimal info
    result.brokerName = 'ActiveMQ Broker';
  }

  return result;
}

/**
 * Helper: Push int32 (big-endian)
 */
function pushInt(buffer: number[], value: number): void {
  buffer.push((value >> 24) & 0xff);
  buffer.push((value >> 16) & 0xff);
  buffer.push((value >> 8) & 0xff);
  buffer.push(value & 0xff);
}

/**
 * Helper: Push int16 (big-endian)
 */
function pushShort(buffer: number[], value: number): void {
  buffer.push((value >> 8) & 0xff);
  buffer.push(value & 0xff);
}

/**
 * Helper: Push int64 (big-endian, simplified)
 */
function pushLong(buffer: number[], value: number): void {
  // Simplified: treat as 32-bit for now
  buffer.push(0, 0, 0, 0);
  pushInt(buffer, value);
}
