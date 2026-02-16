/**
 * Java RMI Registry Protocol Implementation
 *
 * Java RMI (Remote Method Invocation) uses JRMI wire protocol for
 * communication between Java objects in different JVMs.
 *
 * Protocol: Binary with "JRMI" magic header
 * Default port: 1099 (rmiregistry)
 *
 * JRMI Wire Protocol Handshake:
 *   Client sends:
 *     Magic: 0x4a 0x52 0x4d 0x49 ("JRMI")
 *     Version: 0x00 0x02 (version 2)
 *     Protocol: 0x4c (StreamProtocol), 0x4d (SingleOpProtocol), 0x4e (MultiplexProtocol)
 *
 *   Server responds (for StreamProtocol):
 *     0x4e (ProtocolAck)
 *     hostname length (2 bytes BE) + hostname string
 *     port (4 bytes BE)
 *
 *   Client then sends:
 *     0x00 0x00 (null hostname length)
 *     0x00 0x00 0x00 0x00 (null port)
 *
 *   After negotiation, Java Object Serialization format is used
 *   for RMI calls (lookup, list, bind, etc.)
 *
 * Security: Exposed RMI registries can be exploited via deserialization
 * attacks (ysoserial, etc.). They should never be internet-facing.
 *
 * This implementation is read-only: probe handshake and attempt
 * a registry list operation.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// JRMI magic bytes
const JRMI_MAGIC = new Uint8Array([0x4a, 0x52, 0x4d, 0x49]); // "JRMI"
const JRMI_VERSION = new Uint8Array([0x00, 0x02]); // Version 2

// Protocol types
const STREAM_PROTOCOL = 0x4c;
const SINGLEOP_PROTOCOL = 0x4d;
const MULTIPLEX_PROTOCOL = 0x4e;

// Server response codes
const PROTOCOL_ACK = 0x4e;
const PROTOCOL_NOT_SUPPORTED = 0x4f;

/**
 * Build JRMI handshake packet
 */
function buildJRMIHandshake(protocolType: number = STREAM_PROTOCOL): Uint8Array {
  const packet = new Uint8Array(7);
  packet.set(JRMI_MAGIC, 0);     // "JRMI"
  packet.set(JRMI_VERSION, 4);    // Version 2
  packet[6] = protocolType;       // Protocol type
  return packet;
}

/**
 * Build client endpoint info (sent after ProtocolAck)
 */
function buildClientEndpoint(): Uint8Array {
  // Send null hostname (length=0) and port=0
  return new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

/**
 * Build an RMI registry "list" call using Java Serialization
 * This is a simplified version that sends the minimal ObjectOutputStream
 * header + DGC/Registry call
 *
 * The RMI call format:
 *   0x50 (Call marker)
 *   Then Java ObjectOutputStream with serialized call data
 *
 * For registry list:
 *   ObjectOutputStream header: ac ed 00 05
 *   BlockData with call header:
 *     - 0x77 (TC_BLOCKDATA) + length
 *     - UnicastRef: objNum=0 (long), UID, operation=0 (list)
 *     - Hash for Registry interface
 */
function buildRegistryListCall(): Uint8Array {
  // Call message type
  const callMarker = 0x50;

  // Java Object Serialization stream magic + version
  const streamMagic = new Uint8Array([0xac, 0xed, 0x00, 0x05]);

  // BlockData containing the RMI call header
  // This is a minimal call to the registry's list() method
  // ObjID for Registry is well-known: {0, 0, 0}
  // Operation number for list() in RegistryImpl_Stub is 1
  // Interface hash for Registry: 0x44154dc9d4e63bdf
  const blockData = new Uint8Array([
    0x77, // TC_BLOCKDATA
    0x22, // length = 34 bytes
    // Call header
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // ObjID objNum = 0
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,               // ObjID UID (unique, count, time)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,   // UID continued
    0x00, 0x00,                                         // operation = 0 (unused in v2)
    // Hash of java.rmi.registry.Registry interface
    0x44, 0x15, 0x4d, 0xc9, 0xd4, 0xe6, 0x3b, 0xdf,
  ]);

  const packet = new Uint8Array(1 + streamMagic.length + blockData.length);
  packet[0] = callMarker;
  packet.set(streamMagic, 1);
  packet.set(blockData, 1 + streamMagic.length);
  return packet;
}

/**
 * Protocol type name
 */
function protocolTypeName(type: number): string {
  switch (type) {
    case STREAM_PROTOCOL: return 'StreamProtocol';
    case SINGLEOP_PROTOCOL: return 'SingleOpProtocol';
    case MULTIPLEX_PROTOCOL: return 'MultiplexProtocol';
    default: return `Unknown(0x${type.toString(16)})`;
  }
}

/**
 * Parse server's ProtocolAck response to extract hostname and port
 */
function parseProtocolAck(data: Uint8Array): {
  acknowledged: boolean;
  serverHost: string | null;
  serverPort: number | null;
  notSupported: boolean;
} {
  if (data.length === 0) {
    return { acknowledged: false, serverHost: null, serverPort: null, notSupported: false };
  }

  if (data[0] === PROTOCOL_NOT_SUPPORTED) {
    return { acknowledged: false, serverHost: null, serverPort: null, notSupported: true };
  }

  if (data[0] !== PROTOCOL_ACK) {
    return { acknowledged: false, serverHost: null, serverPort: null, notSupported: false };
  }

  let offset = 1;
  let serverHost: string | null = null;
  let serverPort: number | null = null;

  // Read hostname (2-byte length + string)
  if (offset + 2 <= data.length) {
    const hostLen = (data[offset] << 8) | data[offset + 1];
    offset += 2;

    if (hostLen > 0 && offset + hostLen <= data.length) {
      serverHost = new TextDecoder().decode(data.slice(offset, offset + hostLen));
      offset += hostLen;
    }
  }

  // Read port (4 bytes BE)
  if (offset + 4 <= data.length) {
    serverPort = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
    // Handle signed int
    if (serverPort < 0) serverPort += 0x100000000;
  }

  return { acknowledged: true, serverHost, serverPort, notSupported: false };
}

/**
 * Format bytes as hex string
 */
function toHex(data: Uint8Array, maxBytes = 64): string {
  const slice = data.slice(0, maxBytes);
  return Array.from(slice)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/**
 * Read TCP response data with timeout
 */
async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  expectedBytes: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 64 * 1024;
  const deadline = Date.now() + timeoutMs;

  while (totalBytes < expectedBytes) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
      setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 3000));
    });

    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;

    chunks.push(result.value);
    totalBytes += result.value.length;
    if (totalBytes >= maxBytes) break;
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

/**
 * Probe an RMI registry endpoint by performing the JRMI handshake
 */
export async function handleRMIProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 1099;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
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

      // Send JRMI handshake: magic + version + StreamProtocol
      const handshake = buildJRMIHandshake(STREAM_PROTOCOL);
      await writer.write(handshake);

      // Read server response (ProtocolAck + host + port)
      const responseData = await readResponse(reader, Math.min(timeout, 5000), 256);
      const rtt = Date.now() - startTime;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      if (responseData.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            host,
            port,
            rtt,
            isRMI: false,
            protocol: 'RMI',
            message: `TCP connected but no JRMI response (${rtt}ms)`,
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      const parsed = parseProtocolAck(responseData);

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          isRMI: parsed.acknowledged,
          protocolAck: parsed.acknowledged,
          notSupported: parsed.notSupported,
          serverHost: parsed.serverHost,
          serverPort: parsed.serverPort,
          protocolType: protocolTypeName(STREAM_PROTOCOL),
          responseBytes: responseData.length,
          responseHex: toHex(responseData),
          protocol: 'RMI',
          message: parsed.acknowledged
            ? `Java RMI Registry detected (${parsed.serverHost || 'unknown'}:${parsed.serverPort || 'unknown'}) in ${rtt}ms`
            : parsed.notSupported
            ? `Server responded but does not support StreamProtocol in ${rtt}ms`
            : `Non-RMI response received in ${rtt}ms`,
          securityWarning: parsed.acknowledged
            ? 'WARNING: Exposed RMI registries can be exploited via Java deserialization attacks'
            : undefined,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'RMI probe failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Attempt to list bindings in the RMI registry
 * Performs handshake + sends registry list() call
 */
export async function handleRMIList(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 1099;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
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

      // Step 1: JRMI handshake
      const handshake = buildJRMIHandshake(STREAM_PROTOCOL);
      await writer.write(handshake);

      const ackData = await readResponse(reader, Math.min(timeout, 3000), 256);
      const ack = parseProtocolAck(ackData);

      if (!ack.acknowledged) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return new Response(
          JSON.stringify({
            success: false,
            error: ack.notSupported
              ? 'RMI server does not support StreamProtocol'
              : 'Not an RMI endpoint (handshake failed)',
            responseHex: toHex(ackData),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Step 2: Send client endpoint info
      const clientEndpoint = buildClientEndpoint();
      await writer.write(clientEndpoint);

      // Step 3: Send registry list call
      const listCall = buildRegistryListCall();
      await writer.write(listCall);

      // Step 4: Read response (Java serialized data)
      const listResponse = await readResponse(reader, Math.min(timeout, 3000), 4096);
      const rtt = Date.now() - startTime;

      // Try to extract string names from the serialized response
      // Look for TC_STRING (0x74) or TC_LONGSTRING (0x7c) markers
      const bindings: string[] = [];
      let hasReturnData = false;
      let returnType: string | null = null;

      if (listResponse.length > 0) {
        hasReturnData = true;

        // Check for ReturnData marker (0x51)
        if (listResponse[0] === 0x51) {
          returnType = 'ReturnData';
        } else if (listResponse[0] === 0x52) {
          returnType = 'ExceptionalReturn';
        }

        // Scan for Java serialized strings (TC_STRING: 0x74 + 2-byte length + UTF-8)
        for (let i = 0; i < listResponse.length - 3; i++) {
          if (listResponse[i] === 0x74) {
            const strLen = (listResponse[i + 1] << 8) | listResponse[i + 2];
            if (strLen > 0 && strLen < 256 && i + 3 + strLen <= listResponse.length) {
              const str = new TextDecoder().decode(listResponse.slice(i + 3, i + 3 + strLen));
              // Filter to likely binding names (printable ASCII, reasonable length)
              if (str.length > 0 && str.length < 128 && /^[\x20-\x7e]+$/.test(str)) {
                // Skip common Java class/interface names
                if (!str.startsWith('[L') && !str.includes(';') && !str.startsWith('java.')) {
                  bindings.push(str);
                }
              }
            }
          }
        }
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          isRMI: true,
          protocol: 'RMI',
          handshake: 'OK',
          serverHost: ack.serverHost,
          serverPort: ack.serverPort,
          listAttempted: true,
          hasReturnData,
          returnType,
          bindings: bindings.length > 0 ? bindings : null,
          bindingCount: bindings.length,
          responseBytes: listResponse.length,
          responseHex: toHex(listResponse),
          securityWarning: 'WARNING: Exposed RMI registries can be exploited via Java deserialization attacks',
          message: bindings.length > 0
            ? `RMI Registry: ${bindings.length} binding(s) found in ${rtt}ms`
            : hasReturnData
            ? `RMI Registry responded (${returnType || 'unknown'}) in ${rtt}ms`
            : `RMI handshake OK but no list response in ${rtt}ms`,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'RMI list failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
