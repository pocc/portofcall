/**
 * STUN Protocol Support for Cloudflare Workers
 * Implements STUN Binding Request/Response (RFC 5389/8489)
 * Port 3478 - Session Traversal Utilities for NAT
 *
 * STUN is used for NAT traversal in WebRTC, VoIP, and other real-time
 * communication systems. A Binding Request discovers the public IP and
 * port as seen by the STUN server.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// STUN constants (RFC 5389)
const STUN_MAGIC_COOKIE = 0x2112a442;
const STUN_HEADER_LENGTH = 20;

// Message types (method 0x0001 = Binding)
const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_RESPONSE = 0x0101;
const STUN_BINDING_ERROR_RESPONSE = 0x0111;

// Attribute types
const ATTR_MAPPED_ADDRESS = 0x0001;
const ATTR_USERNAME = 0x0006;
const ATTR_MESSAGE_INTEGRITY = 0x0008;
const ATTR_ERROR_CODE = 0x0009;
const ATTR_UNKNOWN_ATTRIBUTES = 0x000a;
const ATTR_REALM = 0x0014;
const ATTR_NONCE = 0x0015;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const ATTR_SOFTWARE = 0x8022;
const ATTR_ALTERNATE_SERVER = 0x8023;
const ATTR_FINGERPRINT = 0x8028;
const ATTR_RESPONSE_ORIGIN = 0x802b;
const ATTR_OTHER_ADDRESS = 0x802c;

// Address families
const AF_IPV4 = 0x01;
const AF_IPV6 = 0x02;

const decoder = new TextDecoder();

/**
 * Generate a random 12-byte transaction ID
 */
function generateTransactionId(): Uint8Array {
  const id = new Uint8Array(12);
  crypto.getRandomValues(id);
  return id;
}

/**
 * Build a STUN Binding Request message
 */
function buildBindingRequest(transactionId: Uint8Array, software?: string): Uint8Array {
  const attrs: Uint8Array[] = [];

  // Optionally include SOFTWARE attribute
  if (software) {
    const softwareBytes = new TextEncoder().encode(software);
    const paddedLen = Math.ceil(softwareBytes.length / 4) * 4;
    const attr = new Uint8Array(4 + paddedLen);
    const view = new DataView(attr.buffer);
    view.setUint16(0, ATTR_SOFTWARE, false);
    view.setUint16(2, softwareBytes.length, false);
    attr.set(softwareBytes, 4);
    attrs.push(attr);
  }

  const attrsLen = attrs.reduce((sum, a) => sum + a.length, 0);
  const msg = new Uint8Array(STUN_HEADER_LENGTH + attrsLen);
  const view = new DataView(msg.buffer);

  // Message Type: Binding Request (0x0001)
  view.setUint16(0, STUN_BINDING_REQUEST, false);

  // Message Length (excludes 20-byte header)
  view.setUint16(2, attrsLen, false);

  // Magic Cookie
  view.setUint32(4, STUN_MAGIC_COOKIE, false);

  // Transaction ID (12 bytes)
  msg.set(transactionId, 8);

  // Attributes
  let offset = STUN_HEADER_LENGTH;
  for (const attr of attrs) {
    msg.set(attr, offset);
    offset += attr.length;
  }

  return msg;
}

/**
 * Decode a STUN address attribute (MAPPED-ADDRESS or XOR-MAPPED-ADDRESS)
 */
function decodeAddress(
  value: Uint8Array,
  xored: boolean,
  transactionId: Uint8Array
): { family: string; port: number; address: string } | null {
  if (value.length < 4) return null;

  const view = new DataView(value.buffer, value.byteOffset);
  // First byte is reserved (0x00), second byte is address family
  const family = view.getUint8(1);
  let port = view.getUint16(2, false);

  if (xored) {
    // XOR port with top 16 bits of magic cookie
    port ^= (STUN_MAGIC_COOKIE >>> 16) & 0xffff;
  }

  if (family === AF_IPV4 && value.length >= 8) {
    const ipBytes = new Uint8Array(4);
    ipBytes.set(value.slice(4, 8));

    if (xored) {
      // XOR with magic cookie bytes
      const cookieBytes = new Uint8Array(4);
      new DataView(cookieBytes.buffer).setUint32(0, STUN_MAGIC_COOKIE, false);
      for (let i = 0; i < 4; i++) {
        ipBytes[i] ^= cookieBytes[i];
      }
    }

    return {
      family: 'IPv4',
      port,
      address: `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`,
    };
  }

  if (family === AF_IPV6 && value.length >= 20) {
    const ipBytes = new Uint8Array(16);
    ipBytes.set(value.slice(4, 20));

    if (xored) {
      // XOR with magic cookie (4 bytes) + transaction ID (12 bytes)
      const cookieBytes = new Uint8Array(4);
      new DataView(cookieBytes.buffer).setUint32(0, STUN_MAGIC_COOKIE, false);
      for (let i = 0; i < 4; i++) {
        ipBytes[i] ^= cookieBytes[i];
      }
      for (let i = 0; i < 12; i++) {
        ipBytes[i + 4] ^= transactionId[i];
      }
    }

    // Format as IPv6
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(((ipBytes[i] << 8) | ipBytes[i + 1]).toString(16));
    }
    return {
      family: 'IPv6',
      port,
      address: parts.join(':'),
    };
  }

  return null;
}

/**
 * Get human-readable attribute type name
 */
function getAttrTypeName(type: number): string {
  const names: Record<number, string> = {
    [ATTR_MAPPED_ADDRESS]: 'MAPPED-ADDRESS',
    [ATTR_USERNAME]: 'USERNAME',
    [ATTR_MESSAGE_INTEGRITY]: 'MESSAGE-INTEGRITY',
    [ATTR_ERROR_CODE]: 'ERROR-CODE',
    [ATTR_UNKNOWN_ATTRIBUTES]: 'UNKNOWN-ATTRIBUTES',
    [ATTR_REALM]: 'REALM',
    [ATTR_NONCE]: 'NONCE',
    [ATTR_XOR_MAPPED_ADDRESS]: 'XOR-MAPPED-ADDRESS',
    [ATTR_SOFTWARE]: 'SOFTWARE',
    [ATTR_ALTERNATE_SERVER]: 'ALTERNATE-SERVER',
    [ATTR_FINGERPRINT]: 'FINGERPRINT',
    [ATTR_RESPONSE_ORIGIN]: 'RESPONSE-ORIGIN',
    [ATTR_OTHER_ADDRESS]: 'OTHER-ADDRESS',
  };
  return names[type] || `0x${type.toString(16).padStart(4, '0')}`;
}

/**
 * Parse a STUN message from raw bytes
 */
function parseStunMessage(data: Uint8Array, transactionId: Uint8Array): {
  messageType: number;
  messageTypeName: string;
  length: number;
  magicCookie: number;
  validCookie: boolean;
  transactionIdMatch: boolean;
  attributes: {
    type: number;
    typeName: string;
    length: number;
    value: string;
    address?: { family: string; port: number; address: string };
  }[];
  errorCode?: { code: number; reason: string };
  mappedAddress?: { family: string; port: number; address: string };
  xorMappedAddress?: { family: string; port: number; address: string };
  software?: string;
  responseOrigin?: { family: string; port: number; address: string };
  otherAddress?: { family: string; port: number; address: string };
} {
  const view = new DataView(data.buffer, data.byteOffset);

  const messageType = view.getUint16(0, false);
  const length = view.getUint16(2, false);
  const magicCookie = view.getUint32(4, false);

  // Check transaction ID match
  const responseTxId = data.slice(8, 20);
  let transactionIdMatch = true;
  for (let i = 0; i < 12; i++) {
    if (responseTxId[i] !== transactionId[i]) {
      transactionIdMatch = false;
      break;
    }
  }

  // Determine message type name
  let messageTypeName = 'Unknown';
  if (messageType === STUN_BINDING_RESPONSE) messageTypeName = 'Binding Success Response';
  else if (messageType === STUN_BINDING_ERROR_RESPONSE) messageTypeName = 'Binding Error Response';
  else if (messageType === STUN_BINDING_REQUEST) messageTypeName = 'Binding Request';

  // Parse attributes
  const attributes: {
    type: number;
    typeName: string;
    length: number;
    value: string;
    address?: { family: string; port: number; address: string };
  }[] = [];

  let mappedAddress: { family: string; port: number; address: string } | undefined;
  let xorMappedAddress: { family: string; port: number; address: string } | undefined;
  let software: string | undefined;
  let errorCode: { code: number; reason: string } | undefined;
  let responseOrigin: { family: string; port: number; address: string } | undefined;
  let otherAddress: { family: string; port: number; address: string } | undefined;

  let offset = STUN_HEADER_LENGTH;
  const endOffset = STUN_HEADER_LENGTH + length;

  while (offset + 4 <= endOffset && offset + 4 <= data.length) {
    const attrView = new DataView(data.buffer, data.byteOffset + offset);
    const attrType = attrView.getUint16(0, false);
    const attrLength = attrView.getUint16(2, false);
    const attrValue = data.slice(offset + 4, offset + 4 + attrLength);
    const paddedLength = Math.ceil(attrLength / 4) * 4;

    const attr: {
      type: number;
      typeName: string;
      length: number;
      value: string;
      address?: { family: string; port: number; address: string };
    } = {
      type: attrType,
      typeName: getAttrTypeName(attrType),
      length: attrLength,
      value: '',
    };

    switch (attrType) {
      case ATTR_MAPPED_ADDRESS: {
        const addr = decodeAddress(attrValue, false, transactionId);
        if (addr) {
          mappedAddress = addr;
          attr.address = addr;
          attr.value = `${addr.address}:${addr.port} (${addr.family})`;
        }
        break;
      }
      case ATTR_XOR_MAPPED_ADDRESS: {
        const addr = decodeAddress(attrValue, true, transactionId);
        if (addr) {
          xorMappedAddress = addr;
          attr.address = addr;
          attr.value = `${addr.address}:${addr.port} (${addr.family})`;
        }
        break;
      }
      case ATTR_RESPONSE_ORIGIN: {
        const addr = decodeAddress(attrValue, true, transactionId);
        if (addr) {
          responseOrigin = addr;
          attr.address = addr;
          attr.value = `${addr.address}:${addr.port} (${addr.family})`;
        }
        break;
      }
      case ATTR_OTHER_ADDRESS: {
        const addr = decodeAddress(attrValue, true, transactionId);
        if (addr) {
          otherAddress = addr;
          attr.address = addr;
          attr.value = `${addr.address}:${addr.port} (${addr.family})`;
        }
        break;
      }
      case ATTR_SOFTWARE: {
        software = decoder.decode(attrValue);
        attr.value = software;
        break;
      }
      case ATTR_ERROR_CODE: {
        if (attrValue.length >= 4) {
          const errView = new DataView(attrValue.buffer, attrValue.byteOffset);
          const classNum = errView.getUint8(2) & 0x07;
          const number = errView.getUint8(3);
          const code = classNum * 100 + number;
          const reason = attrValue.length > 4 ? decoder.decode(attrValue.slice(4)) : '';
          errorCode = { code, reason };
          attr.value = `${code} ${reason}`;
        }
        break;
      }
      case ATTR_FINGERPRINT: {
        if (attrValue.length >= 4) {
          const fp = new DataView(attrValue.buffer, attrValue.byteOffset).getUint32(0, false);
          attr.value = `0x${fp.toString(16).padStart(8, '0')}`;
        }
        break;
      }
      case ATTR_MESSAGE_INTEGRITY: {
        attr.value = `[${attrLength} bytes HMAC-SHA1]`;
        break;
      }
      default: {
        // Show hex for unknown attributes
        const hex = Array.from(attrValue.slice(0, 32))
          .map(b => b.toString(16).padStart(2, '0'))
          .join(' ');
        attr.value = hex + (attrValue.length > 32 ? '...' : '');
        break;
      }
    }

    attributes.push(attr);
    offset += 4 + paddedLength;
  }

  return {
    messageType,
    messageTypeName,
    length,
    magicCookie,
    validCookie: magicCookie === STUN_MAGIC_COOKIE,
    transactionIdMatch,
    attributes,
    errorCode,
    mappedAddress,
    xorMappedAddress,
    software,
    responseOrigin,
    otherAddress,
  };
}

/**
 * Read a complete STUN message from a TCP socket
 * STUN over TCP: messages are self-delimiting via the length field
 */
async function readStunMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalRead = 0;
  let messageLength = 0;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed before complete STUN message');

      chunks.push(value);
      totalRead += value.length;

      // Parse message length once we have at least the header
      if (messageLength === 0 && totalRead >= STUN_HEADER_LENGTH) {
        const header = new Uint8Array(4);
        let copied = 0;
        for (const chunk of chunks) {
          const toCopy = Math.min(chunk.length, 4 - copied);
          header.set(chunk.slice(0, toCopy), copied);
          copied += toCopy;
          if (copied >= 4) break;
        }
        // Total message size = 20-byte header + length field
        messageLength = STUN_HEADER_LENGTH + ((header[2] << 8) | header[3]);
      }

      if (messageLength > 0 && totalRead >= messageLength) {
        const result = new Uint8Array(totalRead);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        return result.slice(0, messageLength);
      }
    }
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Handle STUN Binding Test - sends Binding Request, parses Binding Response
 * Returns the public-facing IP:port as seen by the STUN server
 */
export async function handleStunBinding(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 3478;
    const timeoutMs = options.timeout || 10000;

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

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Build and send Binding Request
        const transactionId = generateTransactionId();
        const bindingRequest = buildBindingRequest(transactionId, 'PortOfCall');

        const sendTime = Date.now();
        await writer.write(bindingRequest);

        // Read Binding Response
        const responseBytes = await readStunMessage(reader, timeoutMs);
        const rtt = Date.now() - sendTime;

        const response = parseStunMessage(responseBytes, transactionId);

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        // Determine the public address (prefer XOR-MAPPED-ADDRESS per RFC 5389)
        const publicAddress = response.xorMappedAddress || response.mappedAddress;

        return {
          success: true,
          message: response.messageType === STUN_BINDING_RESPONSE
            ? 'STUN Binding successful'
            : 'STUN server responded',
          host,
          port,
          rtt,
          connectTime,
          protocol: {
            messageType: `0x${response.messageType.toString(16).padStart(4, '0')}`,
            messageTypeName: response.messageTypeName,
            validMagicCookie: response.validCookie,
            transactionIdMatch: response.transactionIdMatch,
          },
          publicAddress: publicAddress ? {
            ip: publicAddress.address,
            port: publicAddress.port,
            family: publicAddress.family,
          } : null,
          serverSoftware: response.software || null,
          responseOrigin: response.responseOrigin ? {
            ip: response.responseOrigin.address,
            port: response.responseOrigin.port,
          } : null,
          otherAddress: response.otherAddress ? {
            ip: response.otherAddress.address,
            port: response.otherAddress.port,
          } : null,
          errorCode: response.errorCode || null,
          attributes: response.attributes.map(a => ({
            type: a.typeName,
            value: a.value,
          })),
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
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
      error: error instanceof Error ? error.message : 'Request failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle STUN server probe - lightweight check if a STUN server is alive
 * Sends a minimal Binding Request and checks for valid response
 */
export async function handleStunProbe(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 3478;
    const timeoutMs = options.timeout || 8000;

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

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send minimal Binding Request (no SOFTWARE attribute)
        const transactionId = generateTransactionId();
        const bindingRequest = buildBindingRequest(transactionId);

        const sendTime = Date.now();
        await writer.write(bindingRequest);

        // Read response
        const responseBytes = await readStunMessage(reader, timeoutMs);
        const rtt = Date.now() - sendTime;

        const response = parseStunMessage(responseBytes, transactionId);

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const isValid = response.validCookie && response.transactionIdMatch;
        const isSuccess = response.messageType === STUN_BINDING_RESPONSE;

        return {
          success: true,
          alive: isValid && isSuccess,
          host,
          port,
          rtt,
          connectTime,
          validStun: isValid,
          responseType: response.messageTypeName,
          software: response.software || null,
          hasXorMappedAddress: !!response.xorMappedAddress,
          hasMappedAddress: !!response.mappedAddress,
          attributeCount: response.attributes.length,
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        alive: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      alive: false,
      error: error instanceof Error ? error.message : 'Request failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
