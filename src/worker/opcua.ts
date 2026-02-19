/**
 * OPC UA (OPC Unified Architecture) Support for Cloudflare Workers
 * Implements OPC UA over TCP (port 4840) for Industrial IoT communication
 *
 * OPC UA is the successor to OPC Classic, used in manufacturing, energy,
 * building automation, and process control systems.
 *
 * OPC UA TCP Binary Protocol (OPC 10000-6):
 *   Message types: HEL (Hello), ACK (Acknowledge), ERR (Error),
 *                  OPN (OpenSecureChannel), CLO (CloseSecureChannel), MSG
 *
 * Hello Message format:
 *   [MessageType:3bytes "HEL"][ChunkType:1byte "F"]
 *   [MessageSize:uint32_le][ProtocolVersion:uint32_le]
 *   [ReceiveBufferSize:uint32_le][SendBufferSize:uint32_le]
 *   [MaxMessageSize:uint32_le][MaxChunkCount:uint32_le]
 *   [EndpointUrlLength:uint32_le][EndpointUrl:utf8]
 *
 * Acknowledge Message format:
 *   [MessageType:3bytes "ACK"][ChunkType:1byte "F"]
 *   [MessageSize:uint32_le][ProtocolVersion:uint32_le]
 *   [ReceiveBufferSize:uint32_le][SendBufferSize:uint32_le]
 *   [MaxMessageSize:uint32_le][MaxChunkCount:uint32_le]
 *
 * Error Message format:
 *   [MessageType:3bytes "ERR"][ChunkType:1byte "F"]
 *   [MessageSize:uint32_le][Error:uint32_le]
 *   [ReasonLength:uint32_le][Reason:utf8]
 *
 * Default Port: 4840
 *
 * WARNING: OPC UA controls industrial equipment and processes.
 * This implementation supports PROBE and READ-ONLY operations only.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/** OPC UA Status Codes (common ones) */
const STATUS_CODES: Record<number, string> = {
  0x00000000: 'Good',
  0x80010000: 'BadUnexpectedError',
  0x80020000: 'BadInternalError',
  0x80030000: 'BadOutOfMemory',
  0x80040000: 'BadResourceUnavailable',
  0x80050000: 'BadCommunicationError',
  0x80060000: 'BadEncodingError',
  0x80070000: 'BadDecodingError',
  0x80080000: 'BadEncodingLimitsExceeded',
  0x80090000: 'BadRequestTooLarge',
  0x800A0000: 'BadResponseTooLarge',
  0x800B0000: 'BadUnknownResponse',
  0x800C0000: 'BadTimeout',
  0x800D0000: 'BadServiceUnsupported',
  0x800E0000: 'BadShutdown',
  0x800F0000: 'BadServerNotConnected',
  0x80100000: 'BadServerHalted',
  0x80110000: 'BadNothingToDo',
  0x80120000: 'BadTooManyOperations',
  0x80130000: 'BadTooManyMonitoredItems',
  0x80280000: 'BadSecurityChecksFailed',
  0x80340000: 'BadSecureChannelIdInvalid',
  0x80350000: 'BadSecureChannelTokenUnknown',
  0x80390000: 'BadCertificateInvalid',
  0x806D0000: 'BadTcpMessageTypeInvalid',
  0x806E0000: 'BadTcpSecureChannelUnknown',
  0x806F0000: 'BadTcpMessageTooLarge',
  0x80700000: 'BadTcpNotEnoughResources',
  0x80710000: 'BadTcpInternalError',
  0x80720000: 'BadTcpEndpointUrlInvalid',
  0x80730000: 'BadRequestInterrupted',
  0x80740000: 'BadRequestTimeout',
  0x80750000: 'BadSecureChannelClosed',
  0x80760000: 'BadSecurityPolicyRejected',
  0x80780000: 'BadTcpServerTooBusy',
  0x807D0000: 'BadTooManySessions',
};

/**
 * Build an OPC UA Hello message (OPC 10000-6, Section 7.1.2.3)
 *
 * Layout (all fields little-endian):
 *   Offset  Size  Field
 *   0       3     MessageType = "HEL"
 *   3       1     Reserved = 'F'
 *   4       4     MessageSize (total including header)
 *   8       4     ProtocolVersion (0)
 *   12      4     ReceiveBufferSize
 *   16      4     SendBufferSize
 *   20      4     MaxMessageSize (0 = no limit)
 *   24      4     MaxChunkCount (0 = no limit)
 *   28      4     EndpointUrl length (Int32)
 *   32      var   EndpointUrl (UTF-8, no null terminator)
 */
function buildHelloMessage(endpointUrl: string): Uint8Array {
  const urlBytes = new TextEncoder().encode(endpointUrl);
  // 4 (type+reserved) + 4 (size) + 5*4 (fields) + 4 (url length) + url bytes = 32 + url
  const messageSize = 32 + urlBytes.length;

  const buffer = new ArrayBuffer(messageSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Message header: "HEL" + reserved byte 'F'
  bytes[0] = 0x48; // 'H'
  bytes[1] = 0x45; // 'E'
  bytes[2] = 0x4C; // 'L'
  bytes[3] = 0x46; // 'F' (reserved, always Final for Hello)

  // Message size (little-endian uint32)
  view.setUint32(4, messageSize, true);

  // Protocol version: 0 is the only defined version
  view.setUint32(8, 0, true);

  // Receive buffer size: 65536 is the conventional minimum for real implementations
  view.setUint32(12, 65536, true);

  // Send buffer size: 65536
  view.setUint32(16, 65536, true);

  // Max message size (0 = no limit, let server decide)
  view.setUint32(20, 0, true);

  // Max chunk count (0 = no limit)
  view.setUint32(24, 0, true);

  // Endpoint URL as UA String: Int32 length prefix + UTF-8 bytes
  view.setInt32(28, urlBytes.length, true);

  // Endpoint URL bytes
  bytes.set(urlBytes, 32);

  return bytes;
}

/**
 * Build an OPC UA OpenSecureChannel request (OPC 10000-6, Section 7.1.3)
 * Uses SecurityPolicy None for read-only probing.
 *
 * OPN message layout:
 *   [MessageType: "OPN"][ChunkType: "F"][MessageSize: uint32]
 *   [SecureChannelId: uint32]
 *   --- Asymmetric Security Header (Section 6.7.2.3) ---
 *   [SecurityPolicyUri: UA String]
 *   [SenderCertificate: ByteString (-1 = null)]
 *   [ReceiverCertificateThumbprint: ByteString (-1 = null)]
 *   --- Sequence Header (Section 6.7.2.4) ---
 *   [SequenceNumber: uint32]
 *   [RequestId: uint32]
 *   --- Body: Encoded OpenSecureChannelRequest ---
 *   [NodeId: FourByte encoding of id=446 (0x01, 0x00, 0xBE, 0x01)]
 *   [RequestHeader]
 *   [ClientProtocolVersion: uint32]
 *   [RequestType: uint32 (0=Issue, 1=Renew)]
 *   [SecurityMode: uint32 (1=None)]
 *   [ClientNonce: ByteString (-1 = null)]
 *   [RequestedLifetime: uint32 (ms)]
 */
function buildOpenSecureChannelRequest(secureChannelId: number): Uint8Array {
  const securityPolicyUri = 'http://opcfoundation.org/UA/SecurityPolicy#None';
  const policyBytes = new TextEncoder().encode(securityPolicyUri);

  // --- Build the request body first ---
  // NodeId for OpenSecureChannelRequest encoding = i=446 (FourByte: 0x01, ns=0, id=446 LE)
  const nodeId = new Uint8Array([0x01, 0x00, 0xBE, 0x01]); // 446 = 0x01BE

  // Minimal RequestHeader:
  //   AuthenticationToken: TwoByteNodeId(0) = [0x00, 0x00]
  //   Timestamp: Int64 = 0 (8 bytes)
  //   RequestHandle: UInt32 = 1
  //   ReturnDiagnostics: UInt32 = 0
  //   AuditEntryId: UA String = null (-1)
  //   TimeoutHint: UInt32 = 0
  //   AdditionalHeader: ExtensionObject = null (TypeId=0 + encoding=0x00)
  const reqHeader = new Uint8Array([
    0x00, 0x00,                                           // AuthenticationToken (TwoByteNodeId id=0)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,     // Timestamp = 0
    0x01, 0x00, 0x00, 0x00,                               // RequestHandle = 1
    0x00, 0x00, 0x00, 0x00,                               // ReturnDiagnostics = 0
    0xFF, 0xFF, 0xFF, 0xFF,                               // AuditEntryId = null string (-1)
    0x00, 0x00, 0x00, 0x00,                               // TimeoutHint = 0
    0x00, 0x00, 0x00,                                     // AdditionalHeader: TypeId(TwoByteNodeId 0) + Encoding(0x00)
  ]);

  // OpenSecureChannelRequest parameters:
  //   ClientProtocolVersion: UInt32 = 0
  //   RequestType: UInt32 = 0 (Issue)
  //   SecurityMode: UInt32 = 1 (None)
  //   ClientNonce: ByteString = null (-1)
  //   RequestedLifetime: UInt32 = 600000 (10 minutes)
  const params = new Uint8Array([
    0x00, 0x00, 0x00, 0x00,     // ClientProtocolVersion = 0
    0x00, 0x00, 0x00, 0x00,     // RequestType = 0 (Issue)
    0x01, 0x00, 0x00, 0x00,     // SecurityMode = 1 (None / MessageSecurityMode_None)
    0xFF, 0xFF, 0xFF, 0xFF,     // ClientNonce = null (-1)
    0x60, 0x27, 0x09, 0x00,     // RequestedLifetime = 600000ms (10 min)
  ]);

  const bodySize = nodeId.length + reqHeader.length + params.length;

  // --- Calculate total message size ---
  // Header: 4 (type) + 4 (size) + 4 (channelId) = 12
  // Asymmetric security header: 4 (policy len) + policy + 4 (cert = -1) + 4 (thumbprint = -1)
  // Sequence header: 4 (seqNum) + 4 (reqId) = 8
  // Body
  const asymHdrSize = 4 + policyBytes.length + 4 + 4;
  const totalSize = 12 + asymHdrSize + 8 + bodySize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Message header
  bytes[0] = 0x4F; // 'O'
  bytes[1] = 0x50; // 'P'
  bytes[2] = 0x4E; // 'N'
  bytes[3] = 0x46; // 'F' (Final chunk)

  view.setUint32(4, totalSize, true);
  view.setUint32(8, secureChannelId, true);

  // Asymmetric security header
  let offset = 12;

  // SecurityPolicyUri (UA String: Int32 length + bytes)
  view.setInt32(offset, policyBytes.length, true);
  offset += 4;
  bytes.set(policyBytes, offset);
  offset += policyBytes.length;

  // SenderCertificate (ByteString: null = -1)
  view.setInt32(offset, -1, true);
  offset += 4;

  // ReceiverCertificateThumbprint (ByteString: null = -1)
  view.setInt32(offset, -1, true);
  offset += 4;

  // Sequence header
  view.setUint32(offset, 1, true);  // SequenceNumber = 1
  offset += 4;
  view.setUint32(offset, 1, true);  // RequestId = 1
  offset += 4;

  // Body: NodeId + RequestHeader + Parameters
  bytes.set(nodeId, offset);
  offset += nodeId.length;
  bytes.set(reqHeader, offset);
  offset += reqHeader.length;
  bytes.set(params, offset);

  return bytes;
}

/**
 * Parse an OPC UA response message
 */
function parseResponse(data: Uint8Array): {
  messageType: string;
  chunkType: string;
  messageSize: number;
  protocolVersion?: number;
  receiveBufferSize?: number;
  sendBufferSize?: number;
  maxMessageSize?: number;
  maxChunkCount?: number;
  errorCode?: number;
  errorName?: string;
  errorReason?: string;
  secureChannelId?: number;
  rawPayload?: Uint8Array;
} | null {
  if (data.length < 8) return null;

  const messageType = String.fromCharCode(data[0], data[1], data[2]);
  const chunkType = String.fromCharCode(data[3]);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const messageSize = view.getUint32(4, true);

  const result: ReturnType<typeof parseResponse> = {
    messageType,
    chunkType,
    messageSize,
  };

  if (messageType === 'ACK') {
    // Acknowledge message
    if (data.length >= 28) {
      result.protocolVersion = view.getUint32(8, true);
      result.receiveBufferSize = view.getUint32(12, true);
      result.sendBufferSize = view.getUint32(16, true);
      result.maxMessageSize = view.getUint32(20, true);
      result.maxChunkCount = view.getUint32(24, true);
    }
  } else if (messageType === 'ERR') {
    // Error message
    if (data.length >= 16) {
      const errorCode = view.getUint32(8, true);
      result.errorCode = errorCode;
      result.errorName = STATUS_CODES[errorCode] || `Unknown(0x${errorCode.toString(16).padStart(8, '0')})`;

      // Read error reason string
      if (data.length >= 16) {
        const reasonLength = view.getInt32(12, true);
        if (reasonLength > 0 && data.length >= 16 + reasonLength) {
          result.errorReason = new TextDecoder().decode(data.subarray(16, 16 + reasonLength));
        }
      }
    }
  } else if (messageType === 'OPN' || messageType === 'MSG' || messageType === 'CLO') {
    // Secure channel messages
    if (data.length >= 12) {
      result.secureChannelId = view.getUint32(8, true);
    }
    if (data.length > 12) {
      result.rawPayload = data.subarray(12);
    }
  }

  return result;
}

/**
 * Read a complete OPC UA message from the socket
 */
async function readOPCUAResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Read timeout')), timeoutMs);
  });

  const readPromise = (async () => {
    let buffer = new Uint8Array(0);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;

      // Need at least 8 bytes to read message header
      if (buffer.length >= 8) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const messageSize = view.getUint32(4, true);

        // Validate messageSize to prevent buffer overflow
        if (messageSize < 8 || messageSize > 1000000) {
          throw new Error(`Invalid OPC UA message size: ${messageSize}`);
        }

        if (buffer.length >= messageSize) {
          return buffer.subarray(0, messageSize);
        }
      }
    }
    return buffer;
  })();

  try {
    const result = await Promise.race([readPromise, timeoutPromise]);
    if (timeoutId !== null) clearTimeout(timeoutId);
    return result;
  } catch (error) {
    if (timeoutId !== null) clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Format raw bytes as hex string
 */
function toHex(data: Uint8Array, maxBytes = 64): string {
  const hex = Array.from(data.subarray(0, maxBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
  return data.length > maxBytes ? hex + '...' : hex;
}

/**
 * Handle OPC UA Hello probe
 * POST /api/opcua/hello
 *
 * Sends an OPC UA Hello message to test connectivity and get server capabilities
 */
export async function handleOPCUAHello(request: Request): Promise<Response> {
  try {
    const {
      host,
      port = 4840,
      endpointUrl,
      timeout = 10000,
    } = await request.json<{
      host: string;
      port?: number;
      endpointUrl?: string;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const actualEndpointUrl = endpointUrl || `opc.tcp://${host}:${port}`;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send OPC UA Hello
        const helloMsg = buildHelloMessage(actualEndpointUrl);
        await writer.write(helloMsg);

        // Read response
        const responseBytes = await readOPCUAResponse(reader, 5000);

        if (responseBytes.length === 0) {
          try { await socket.close(); } catch { /* ignore close error */ }
          return {
            success: false,
            error: 'No response from OPC UA server (empty response)',
          };
        }

        const parsed = parseResponse(responseBytes);

        if (!parsed) {
          try { await socket.close(); } catch { /* ignore close error */ }
          return {
            success: true,
            message: 'Received data but could not parse as OPC UA message',
            host,
            port,
            endpointUrl: actualEndpointUrl,
            rawHex: toHex(responseBytes),
            rawLength: responseBytes.length,
          };
        }

        if (parsed.messageType === 'ACK') {
          try { await socket.close(); } catch { /* ignore close error */ }
          return {
            success: true,
            message: `OPC UA server reachable at ${host}:${port}`,
            host,
            port,
            endpointUrl: actualEndpointUrl,
            acknowledge: {
              protocolVersion: parsed.protocolVersion,
              receiveBufferSize: parsed.receiveBufferSize,
              sendBufferSize: parsed.sendBufferSize,
              maxMessageSize: parsed.maxMessageSize,
              maxChunkCount: parsed.maxChunkCount,
            },
            rawHex: toHex(responseBytes),
          };
        }

        if (parsed.messageType === 'ERR') {
          try { await socket.close(); } catch { /* ignore close error */ }
          return {
            success: true,
            message: `OPC UA server responded with error at ${host}:${port}`,
            host,
            port,
            endpointUrl: actualEndpointUrl,
            serverError: {
              code: parsed.errorCode,
              name: parsed.errorName,
              reason: parsed.errorReason,
            },
            rawHex: toHex(responseBytes),
          };
        }

        try { await socket.close(); } catch { /* ignore close error */ }
        return {
          success: true,
          message: `OPC UA server responded with ${parsed.messageType} at ${host}:${port}`,
          host,
          port,
          endpointUrl: actualEndpointUrl,
          response: {
            messageType: parsed.messageType,
            chunkType: parsed.chunkType,
            messageSize: parsed.messageSize,
          },
          rawHex: toHex(responseBytes),
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore close error */ }
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      if (timeoutId !== null) clearTimeout(timeoutId);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'OPC UA connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle OPC UA endpoint discovery
 * POST /api/opcua/endpoints
 *
 * Sends Hello + OpenSecureChannel + GetEndpoints to discover server endpoints
 * This is a read-only discovery operation
 */
export async function handleOPCUAEndpoints(request: Request): Promise<Response> {
  try {
    const {
      host,
      port = 4840,
      endpointUrl,
      timeout = 10000,
    } = await request.json<{
      host: string;
      port?: number;
      endpointUrl?: string;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const actualEndpointUrl = endpointUrl || `opc.tcp://${host}:${port}`;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Send Hello
        const helloMsg = buildHelloMessage(actualEndpointUrl);
        await writer.write(helloMsg);

        const ackBytes = await readOPCUAResponse(reader, 5000);
        const ackParsed = parseResponse(ackBytes);

        if (!ackParsed || ackParsed.messageType !== 'ACK') {
          try { await socket.close(); } catch { /* ignore close error */ }

          if (ackParsed?.messageType === 'ERR') {
            return {
              success: true,
              host,
              port,
              endpointUrl: actualEndpointUrl,
              phase: 'hello',
              serverError: {
                code: ackParsed.errorCode,
                name: ackParsed.errorName,
                reason: ackParsed.errorReason,
              },
              rawHex: toHex(ackBytes),
            };
          }

          return {
            success: false,
            error: 'Did not receive ACK to Hello message',
            host,
            port,
            rawHex: ackBytes.length > 0 ? toHex(ackBytes) : undefined,
          };
        }

        // Step 2: Send OpenSecureChannel with None security
        const opnMsg = buildGetEndpointsRequest(0, 0);
        await writer.write(opnMsg);

        const opnBytes = await readOPCUAResponse(reader, 5000);
        try { await socket.close(); } catch { /* ignore close error */ }

        const opnParsed = parseResponse(opnBytes);

        const result: Record<string, unknown> = {
          success: true,
          host,
          port,
          endpointUrl: actualEndpointUrl,
          acknowledge: {
            protocolVersion: ackParsed.protocolVersion,
            receiveBufferSize: ackParsed.receiveBufferSize,
            sendBufferSize: ackParsed.sendBufferSize,
            maxMessageSize: ackParsed.maxMessageSize,
            maxChunkCount: ackParsed.maxChunkCount,
          },
        };

        if (opnParsed) {
          if (opnParsed.messageType === 'ERR') {
            result.secureChannel = {
              status: 'rejected',
              error: {
                code: opnParsed.errorCode,
                name: opnParsed.errorName,
                reason: opnParsed.errorReason,
              },
            };
          } else if (opnParsed.messageType === 'OPN') {
            result.secureChannel = {
              status: 'opened',
              channelId: opnParsed.secureChannelId,
              payloadSize: opnParsed.rawPayload?.length || 0,
            };
          } else {
            result.secureChannel = {
              status: 'unknown',
              messageType: opnParsed.messageType,
            };
          }
          result.secureChannelRawHex = toHex(opnBytes);
        }

        result.helloRawHex = toHex(ackBytes);

        return result;
      } catch (error) {
        try { await socket.close(); } catch { /* ignore close error */ }
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      if (timeoutId !== null) clearTimeout(timeoutId);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'OPC UA endpoint discovery failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Build a combined OpenSecureChannel + GetEndpoints request.
 * This is what handleOPCUAEndpoints and handleOPCUARead actually need.
 * The function name is kept for compatibility with existing call sites.
 */
function buildGetEndpointsRequest(secureChannelId: number, _tokenId: number): Uint8Array {
  // For now, this just calls buildOpenSecureChannelRequest
  // The actual GetEndpoints is sent as a separate MSG after receiving OPN
  return buildOpenSecureChannelRequest(secureChannelId);
}

/**
 * Parse a UA String (4-byte length prefix + UTF-8 bytes) from a buffer.
 * Returns the string value and the next read offset.
 */
function parseUAString(view: DataView, data: Uint8Array, offset: number): { value: string | null; nextOffset: number } {
  if (offset + 4 > data.length) return { value: null, nextOffset: offset };
  const len = view.getInt32(offset, true);
  if (len < 0) return { value: null, nextOffset: offset + 4 };
  if (offset + 4 + len > data.length) return { value: null, nextOffset: offset };
  const value = new TextDecoder().decode(data.subarray(offset + 4, offset + 4 + len));
  return { value, nextOffset: offset + 4 + len };
}

/**
 * Build a GetEndpoints MSG request.
 * Sends over the already-opened secure channel.
 */
function buildGetEndpointsMsgRequest(endpointUrl: string): Uint8Array {
  const urlBytes = new TextEncoder().encode(endpointUrl);
  // NodeId for GetEndpoints request = i=428 (FourByte: 0x01, ns=0, id=0xAC01 LE)
  const nodeId = new Uint8Array([0x01, 0x00, 0xAC, 0x01]);
  // Minimal request header: null auth token, timestamp=0, requestHandle=1, returnDiag=0, auditId=null, timeout=0, addHeader=null
  const reqHeader = new Uint8Array([
    0x00, 0x00,                               // null auth token (TwoByteNodeId id=0)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // timestamp = 0
    0x01, 0x00, 0x00, 0x00,                   // requestHandle = 1
    0x00, 0x00, 0x00, 0x00,                   // returnDiagnostics = 0
    0xFF, 0xFF, 0xFF, 0xFF,                   // auditEntryId = null string
    0x00, 0x00, 0x00, 0x00,                   // timeout = 0
    0x00, 0x00, 0x00,                         // additionalHeader = null
  ]);
  // Parameters: endpointUrl, localeIds count=0, profileUris count=0
  const urlLenBuf = new Uint8Array(4);
  new DataView(urlLenBuf.buffer).setInt32(0, urlBytes.length, true);
  const tail = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // two empty arrays

  const body = new Uint8Array(nodeId.length + reqHeader.length + 4 + urlBytes.length + tail.length);
  let off = 0;
  body.set(nodeId, off); off += nodeId.length;
  body.set(reqHeader, off); off += reqHeader.length;
  body.set(urlLenBuf, off); off += 4;
  body.set(urlBytes, off); off += urlBytes.length;
  body.set(tail, off);

  // MSG header: MSGF + size(4) + channelId(4)=0 + tokenId(4)=0 + seqNum(4)=2 + reqId(4)=2
  const msgSize = 8 + 4 + 4 + 4 + 4 + body.length;
  const msg = new Uint8Array(msgSize);
  const msgView = new DataView(msg.buffer);
  msg[0] = 0x4D; msg[1] = 0x53; msg[2] = 0x47; msg[3] = 0x46; // MSGF
  msgView.setUint32(4, msgSize, true);
  msgView.setUint32(8, 0, true);  // channelId
  msgView.setUint32(12, 0, true); // tokenId
  msgView.setUint32(16, 2, true); // sequenceNum
  msgView.setUint32(20, 2, true); // requestId
  msg.set(body, 24);
  return msg;
}

/**
 * Parse endpoint URLs and security info from a GetEndpoints response payload.
 * Best-effort parsing — OPC UA binary is complex and variable-length.
 */
function parseEndpointList(payload: Uint8Array): Array<{
  endpointUrl: string | null;
  securityMode: string;
  securityPolicyUri: string | null;
  securityLevel: number;
}> {
  const SECURITY_MODES: Record<number, string> = { 1: 'None', 2: 'Sign', 3: 'SignAndEncrypt' };
  const endpoints: Array<{ endpointUrl: string | null; securityMode: string; securityPolicyUri: string | null; securityLevel: number }> = [];

  // Validate minimum payload length before parsing
  if (payload.length < 48) return endpoints;

  try {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    // Skip sequence header (8B), response NodeId (~4B), response header (~32B) — approximate
    let offset = 44;
    if (offset + 4 > payload.length) return endpoints;

    const count = view.getInt32(offset, true);
    offset += 4;
    if (count <= 0 || count > 50) return endpoints;

    for (let i = 0; i < count && offset < payload.length - 8; i++) {
      const ep = { endpointUrl: null as string | null, securityMode: 'Unknown', securityPolicyUri: null as string | null, securityLevel: 0 };

      // endpointUrl
      const urlResult = parseUAString(view, payload, offset);
      ep.endpointUrl = urlResult.value;
      offset = urlResult.nextOffset;

      // Skip ApplicationDescription (complex nested struct) — scan for next endpoint
      // ApplicationUri, ProductUri, ApplicationName(LocalizedText), ApplicationType(4B)
      // GatewayServerUri, DiscoveryProfileUri, DiscoveryUrls(array)
      for (let skip = 0; skip < 3 && offset < payload.length; skip++) {
        const r = parseUAString(view, payload, offset);
        offset = r.nextOffset;
      }
      // ApplicationName (LocalizedText)
      if (offset < payload.length) {
        const mask = payload[offset++];
        if (mask & 0x01) { const r = parseUAString(view, payload, offset); offset = r.nextOffset; }
        if (mask & 0x02) { const r = parseUAString(view, payload, offset); offset = r.nextOffset; }
      }
      if (offset + 4 <= payload.length) offset += 4; // ApplicationType
      for (let skip = 0; skip < 2 && offset < payload.length; skip++) {
        const r = parseUAString(view, payload, offset);
        offset = r.nextOffset;
      }
      // DiscoveryUrls array
      if (offset + 4 <= payload.length) {
        const duCount = view.getInt32(offset, true);
        offset += 4;
        if (duCount > 0 && duCount < 20) {
          for (let j = 0; j < duCount && offset < payload.length; j++) {
            const r = parseUAString(view, payload, offset);
            offset = r.nextOffset;
          }
        }
      }

      // serverCertificate (ByteString)
      if (offset + 4 <= payload.length) {
        const certLen = view.getInt32(offset, true);
        offset += 4;
        if (certLen > 0 && certLen < 10000) offset += certLen;
      }

      // securityMode
      if (offset + 4 <= payload.length) {
        ep.securityMode = SECURITY_MODES[view.getUint32(offset, true)] || 'Unknown';
        offset += 4;
      }

      // securityPolicyUri
      const spResult = parseUAString(view, payload, offset);
      ep.securityPolicyUri = spResult.value;
      offset = spResult.nextOffset;

      // Skip userIdentityTokens
      if (offset + 4 <= payload.length) {
        const tokCount = view.getInt32(offset, true);
        offset += 4;
        if (tokCount >= 0 && tokCount < 20) {
          for (let k = 0; k < tokCount && offset < payload.length; k++) {
            for (let s = 0; s < 4 && offset < payload.length; s++) {
              const r = parseUAString(view, payload, offset);
              offset = r.nextOffset;
            }
            if (offset + 4 <= payload.length) offset += 4; // tokenType
          }
        }
      }

      // transportProfileUri
      const tpResult = parseUAString(view, payload, offset);
      offset = tpResult.nextOffset;

      // securityLevel
      if (offset + 1 <= payload.length) {
        ep.securityLevel = payload[offset++];
      }

      endpoints.push(ep);
    }
  } catch { /* best-effort */ }

  return endpoints;
}

/**
 * Handle OPC UA GetEndpoints with full MSG request and structured response parsing.
 * POST /api/opcua/read
 *
 * Sends Hello → OPN → GetEndpoints MSG and parses the endpoint list.
 * Accept JSON: {host, port?, endpoint_url?, timeout?}
 */
export async function handleOPCUARead(request: Request): Promise<Response> {
  try {
    const { host, port = 4840, endpoint_url, timeout = 10000 } = await request.json() as {
      host: string; port?: number; endpoint_url?: string; timeout?: number;
    };

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const actualEndpointUrl = endpoint_url || `opc.tcp://${host}:${port}`;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Hello
        await writer.write(buildHelloMessage(actualEndpointUrl));
        const ackBytes = await readOPCUAResponse(reader, 5000);
        const ackParsed = parseResponse(ackBytes);
        if (!ackParsed || ackParsed.messageType !== 'ACK') {
          try { await socket.close(); } catch { /* ignore close error */ }
          return { success: false, error: `Expected ACK, got ${ackParsed?.messageType || 'empty'}`, host, port };
        }

        // OpenSecureChannel
        await writer.write(buildGetEndpointsRequest(0, 0));
        const opnBytes = await readOPCUAResponse(reader, 5000);
        const opnParsed = parseResponse(opnBytes);
        if (!opnParsed || opnParsed.messageType !== 'OPN') {
          try { await socket.close(); } catch { /* ignore close error */ }
          return {
            success: false,
            error: opnParsed?.messageType === 'ERR' ? `Server error: ${opnParsed.errorName}` : `Expected OPN, got ${opnParsed?.messageType || 'empty'}`,
            host, port,
          };
        }
        const channelId = opnParsed.secureChannelId ?? 0;

        // GetEndpoints MSG
        await writer.write(buildGetEndpointsMsgRequest(actualEndpointUrl));
        const msgBytes = await readOPCUAResponse(reader, 5000);
        try { await socket.close(); } catch { /* ignore close error */ }

        const msgParsed = parseResponse(msgBytes);
        const endpoints = msgParsed?.rawPayload ? parseEndpointList(msgParsed.rawPayload) : [];

        return {
          success: true, host, port, endpointUrl: actualEndpointUrl, channelId,
          acknowledge: { protocolVersion: ackParsed.protocolVersion, receiveBufferSize: ackParsed.receiveBufferSize, sendBufferSize: ackParsed.sendBufferSize },
          endpoints, endpointCount: endpoints.length,
          msgResponseType: msgParsed?.messageType,
          rawHex: msgParsed?.rawPayload ? toHex(msgParsed.rawPayload, 128) : undefined,
        };
      } catch (err) {
        try { await socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      if (timeoutId !== null) clearTimeout(timeoutId);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'OPC UA read failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
