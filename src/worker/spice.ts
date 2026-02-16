/**
 * SPICE (Simple Protocol for Independent Computing Environments) Protocol Implementation
 *
 * SPICE is a remote display protocol developed by Red Hat for virtual desktop infrastructure.
 * It's used primarily with KVM/QEMU virtual machines and provides:
 * - Remote display rendering
 * - Audio/video streaming
 * - USB redirection
 * - Clipboard sharing
 * - Multiple monitor support
 *
 * Protocol Overview:
 * - Default Port: 5900 (same as VNC, but different protocol)
 * - Transport: TCP
 * - Initial handshake uses SPICE link messages
 * - Binary protocol with little-endian byte order
 *
 * Handshake Flow:
 * 1. Client connects to server
 * 2. Client sends SPICE link header with "REDQ" magic
 * 3. Server responds with SPICE link reply containing:
 *    - Protocol version (major.minor)
 *    - Server capabilities
 *    - Authentication methods
 *    - Available channels (main, display, inputs, cursor, playback, record)
 *
 * SPICE Link Header Format (16 bytes):
 * - Magic: "REDQ" (4 bytes) 0x52 0x45 0x44 0x51
 * - Major version: uint32 (4 bytes)
 * - Minor version: uint32 (4 bytes)
 * - Message size: uint32 (4 bytes)
 *
 * References:
 * - SPICE Protocol Specification: https://www.spice-space.org/
 * - GitLab: https://gitlab.freedesktop.org/spice/spice-protocol
 */

import { connect } from 'cloudflare:sockets';

interface SPICERequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface SPICEResponse {
  success: boolean;
  host: string;
  port: number;
  protocolVersion?: string;
  majorVersion?: number;
  minorVersion?: number;
  capabilities?: string[];
  channels?: string[];
  authMethods?: string[];
  error?: string;
  details?: string;
}

// SPICE Protocol Constants
// const SPICE_MAGIC = 'REDQ'; // Magic bytes for SPICE protocol
const SPICE_MAGIC_BYTES = new Uint8Array([0x52, 0x45, 0x44, 0x51]); // "REDQ"

// SPICE Version
const SPICE_VERSION_MAJOR = 2;
const SPICE_VERSION_MINOR = 2;

// SPICE Link Message Types (for reference)
// const SPICE_LINK_CLIENT = 1;
// const SPICE_LINK_SERVER = 2;

// SPICE Channel Types (for reference)
// const SPICE_CHANNELS: { [key: number]: string } = {
//   1: 'main',
//   2: 'display',
//   3: 'inputs',
//   4: 'cursor',
//   5: 'playback',
//   6: 'record',
//   7: 'tunnel',
//   8: 'smartcard',
//   9: 'usbredir',
//   10: 'port',
//   11: 'webdav',
// };

// SPICE Capabilities (common ones)
const SPICE_COMMON_CAPABILITIES: { [key: number]: string } = {
  0: 'auth-selection',
  1: 'auth-spice',
  2: 'auth-sasl',
  3: 'mini-header',
  4: 'protocol-auth-selection',
};

/**
 * Build SPICE link client message
 */
function buildSPICELinkMessage(): Uint8Array {
  // SPICE Link Header: 16 bytes
  // - Magic: "REDQ" (4 bytes)
  // - Major: 2 (4 bytes, little-endian uint32)
  // - Minor: 2 (4 bytes, little-endian uint32)
  // - Size: 0 (4 bytes, little-endian uint32) - no additional data for probe

  const buffer = new Uint8Array(16);

  // Magic bytes "REDQ"
  buffer.set(SPICE_MAGIC_BYTES, 0);

  // Major version (little-endian uint32)
  const view = new DataView(buffer.buffer);
  view.setUint32(4, SPICE_VERSION_MAJOR, true);

  // Minor version (little-endian uint32)
  view.setUint32(8, SPICE_VERSION_MINOR, true);

  // Message size (little-endian uint32) - 0 for basic probe
  view.setUint32(12, 0, true);

  return buffer;
}

/**
 * Parse SPICE link server response
 */
function parseSPICELinkReply(data: Uint8Array): Partial<SPICEResponse> {
  if (data.length < 16) {
    throw new Error('Response too short for SPICE link header');
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Check magic bytes "REQD" (server response magic)
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== 'REQD') {
    throw new Error(`Invalid SPICE magic: expected 'REQD', got '${magic}'`);
  }

  // Parse header
  const majorVersion = view.getUint32(4, true); // little-endian
  const minorVersion = view.getUint32(8, true);
  const messageSize = view.getUint32(12, true);

  const result: Partial<SPICEResponse> = {
    majorVersion,
    minorVersion,
    protocolVersion: `${majorVersion}.${minorVersion}`,
  };

  // If there's additional data in the message, parse it
  if (messageSize > 0 && data.length >= 16 + messageSize) {
    const messageData = data.slice(16, 16 + messageSize);

    // SPICE link reply message structure (simplified):
    // - Capabilities offset (4 bytes)
    // - Capabilities count (4 bytes)
    // - Caps data...

    if (messageData.length >= 8) {
      const msgView = new DataView(messageData.buffer, messageData.byteOffset, messageData.byteLength);

      // Try to extract basic info
      try {
        const capsOffset = msgView.getUint32(0, true);
        const capsCount = msgView.getUint32(4, true);

        result.capabilities = [];

        // Parse capabilities (if available)
        if (capsOffset < messageData.length && capsCount > 0 && capsCount < 100) {
          for (let i = 0; i < capsCount && (capsOffset + i * 4) < messageData.length; i++) {
            const capId = msgView.getUint32(capsOffset + i * 4, true);
            const capName = SPICE_COMMON_CAPABILITIES[capId] || `unknown-${capId}`;
            result.capabilities.push(capName);
          }
        }
      } catch (e) {
        // Parsing additional fields failed, but we have version info
        result.details = 'Partial parse: version info only';
      }
    }
  }

  return result;
}

/**
 * Handle SPICE connection probe
 */
export async function handleSPICEConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json() as SPICERequest;
    const { host, port = 5900, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate port
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Connect to SPICE server
    const socket = connect(`${host}:${port}`);

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      // Wait for connection
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send SPICE link client message
        const linkMessage = buildSPICELinkMessage();
        await writer.write(linkMessage);

        // Read response
        const { value, done } = await Promise.race([
          reader.read(),
          timeoutPromise,
        ]) as ReadableStreamReadResult<Uint8Array>;

        if (done || !value) {
          return new Response(JSON.stringify({
            success: false,
            host,
            port,
            error: 'Connection closed by server',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Parse SPICE link reply
        const parsed = parseSPICELinkReply(value);

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          ...parsed,
        } as SPICEResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: errorMessage,
      } as SPICEResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } finally {
      try {
        await socket.close();
      } catch {
        // Ignore close errors
      }
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request processing failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
