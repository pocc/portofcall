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

// RMI operation numbers for java.rmi.registry.Registry
// Interface hash: 0x44154dc9d4e63bdf
// op 0 = bind, op 1 = list, op 2 = lookup, op 3 = rebind, op 4 = unbind
const REGISTRY_OP_LOOKUP = 2;
const REGISTRY_INTERFACE_HASH_HI = 0x44154dc9;
const REGISTRY_INTERFACE_HASH_LO = 0xd4e63bdf;

/**
 * Build an RMI registry lookup(name) call.
 * Serializes the name string argument using Java Object Serialization.
 *
 * Format:
 *   0x50 (Call marker)
 *   Java ObjectOutputStream magic + version (ac ed 00 05)
 *   TC_BLOCKDATA (0x77) + length byte
 *     [8 bytes] ObjID objNum = 0 (registry well-known ObjID)
 *     [6 bytes] UID: unique(4), count(2), time... packed
 *     [4 bytes] operation = REGISTRY_OP_LOOKUP (padded to full call header)
 *     [8 bytes] interface hash
 *   TC_STRING (0x74) + 2-byte length + name bytes
 */
function buildRegistryLookupCall(name: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);

  // Block data: ObjID(8) + UID(6 bytes used as per wire format) + op(4) + hash(8) = 26 bytes
  // Actual wire layout from Wireshark captures of real RMI traffic:
  //   Call header block (0x77 0x22):
  //   objNum: 8 bytes LE = 0 for registry
  //   UID.unique: 4 bytes = 0
  //   UID.count:  2 bytes = 0
  //   UID.time (high part not in short UID but full UID is 10 bytes)
  //   Actually for registry ObjID it's:
  //   0x00 x8 (objNum) + 0x00 x6 (UID.unique 4 + count 2) + 0x00 x6 (reserved) = 20 bytes total
  //   Then 2 bytes padding
  //   op (4 bytes) = 2 (lookup)
  //   hash (8 bytes)
  // Total block = 34 bytes = 0x22

  const blockLen = 34;
  const blockData = new Uint8Array(blockLen);
  const bv = new DataView(blockData.buffer);

  // ObjID objNum: 8 bytes, value 0
  // ObjID UID.unique: 4 bytes, value 0
  // ObjID UID.count: 2 bytes, value 0
  // ObjID UID padding: 6 bytes, value 0 (total ObjID = 20 bytes but we write 22 bytes with op)
  // operation: 4 bytes LE (at offset 22)
  bv.setInt32(22, REGISTRY_OP_LOOKUP, false); // big-endian per Java serialization convention

  // interface hash: 8 bytes big-endian (at offset 26)
  bv.setUint32(26, REGISTRY_INTERFACE_HASH_HI, false);
  bv.setUint32(30, REGISTRY_INTERFACE_HASH_LO, false);

  // Assemble the full CALL message
  const streamMagic = new Uint8Array([0xac, 0xed, 0x00, 0x05]);
  const blockHeader = new Uint8Array([0x77, blockLen]);

  // TC_STRING: 0x74 + 2-byte BE length + name bytes
  const stringHeader = new Uint8Array([0x74, (nameBytes.length >> 8) & 0xff, nameBytes.length & 0xff]);

  const totalLen = 1 + streamMagic.length + blockHeader.length + blockData.length + stringHeader.length + nameBytes.length;
  const packet = new Uint8Array(totalLen);
  let offset = 0;

  packet[offset++] = 0x50; // Call marker
  packet.set(streamMagic, offset); offset += streamMagic.length;
  packet.set(blockHeader, offset); offset += blockHeader.length;
  packet.set(blockData, offset); offset += blockData.length;
  packet.set(stringHeader, offset); offset += stringHeader.length;
  packet.set(nameBytes, offset);

  return packet;
}

/**
 * Extract a RemoteRef (host, port, ObjID) from a ReturnData response.
 * RMI RemoteObject serialization contains TC_OBJECT with UnicastRef data.
 * We scan for known marker patterns: endpoint string + port.
 */
function extractRemoteRef(data: Uint8Array): {
  host: string | null;
  port: number | null;
  objId: string | null;
} {
  let host: string | null = null;
  let port: number | null = null;
  let objId: string | null = null;

  // Scan for TC_STRING (0x74) markers — host string in UnicastRef
  for (let i = 0; i < data.length - 3; i++) {
    if (data[i] === 0x74) {
      const strLen = (data[i + 1] << 8) | data[i + 2];
      if (strLen > 0 && strLen < 256 && i + 3 + strLen <= data.length) {
        const str = new TextDecoder().decode(data.slice(i + 3, i + 3 + strLen));
        // Looks like a hostname/IP
        if (/^[a-zA-Z0-9._-]+$/.test(str) && str.length > 1 && !str.startsWith('[L')) {
          host = str;
          // Port follows the host string in UnicastRef: 4 bytes BE
          const portOffset = i + 3 + strLen;
          if (portOffset + 4 <= data.length) {
            const p = (data[portOffset] << 24) | (data[portOffset + 1] << 16) |
                      (data[portOffset + 2] << 8) | data[portOffset + 3];
            if (p > 0 && p <= 65535) {
              port = p;
              // ObjID follows port: objNum (8 bytes) + UID (10 bytes) — we hex-encode objNum
              const objOffset = portOffset + 4;
              if (objOffset + 8 <= data.length) {
                objId = Array.from(data.slice(objOffset, objOffset + 8))
                  .map(b => b.toString(16).padStart(2, '0')).join('');
              }
            }
          }
        }
      }
    }
  }

  return { host, port, objId };
}

/**
 * Attempt an RMI method invocation on a named object in the registry.
 * Performs: handshake -> registry lookup(name) -> parse RemoteRef ->
 * connect to object -> send method invocation -> parse return.
 *
 * Note: Full Java deserialization is complex; this implementation performs
 * the lookup and attempts invocation, returning whatever the server sends.
 */
export async function handleRMIInvoke(request: Request): Promise<Response> {
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
      objectName?: string;
      methodName?: string;
      methodHash?: string;
      args?: unknown[];
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!body.objectName) {
      return new Response(
        JSON.stringify({ success: false, error: 'objectName is required (the name bound in the RMI registry)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 1099;
    const timeout = body.timeout || 15000;
    const objectName = body.objectName;
    const methodName = body.methodName || 'toString';

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

    const connectionPromise = (async () => {
      // ---- Phase 1: Connect to registry, perform handshake, send lookup(name) ----
      const regSocket = connect(`${host}:${port}`);
      await regSocket.opened;

      const regWriter = regSocket.writable.getWriter();
      const regReader = regSocket.readable.getReader();

      let lookupSuccess = false;
      let lookupReturnType: string | null = null;
      let remoteRef: { host: string | null; port: number | null; objId: string | null } = {
        host: null,
        port: null,
        objId: null,
      };
      let lookupResponseHex = '';

      try {
        // JRMI handshake
        const handshake = buildJRMIHandshake(STREAM_PROTOCOL);
        await regWriter.write(handshake);

        const ackData = await readResponse(regReader, Math.min(timeout, 3000), 256);
        const ack = parseProtocolAck(ackData);

        if (!ack.acknowledged) {
          regWriter.releaseLock();
          regReader.releaseLock();
          regSocket.close();
          return {
            success: false,
            error: ack.notSupported
              ? 'RMI server does not support StreamProtocol'
              : 'Not an RMI endpoint (handshake failed)',
            responseHex: toHex(ackData),
          };
        }

        // Send client endpoint info
        const clientEndpoint = buildClientEndpoint();
        await regWriter.write(clientEndpoint);

        // Send registry lookup(objectName) call
        const lookupCall = buildRegistryLookupCall(objectName);
        await regWriter.write(lookupCall);

        // Read response
        const lookupResponse = await readResponse(regReader, Math.min(timeout, 4000), 4096);
        lookupResponseHex = toHex(lookupResponse);

        if (lookupResponse.length > 0) {
          lookupSuccess = true;
          if (lookupResponse[0] === 0x51) {
            lookupReturnType = 'ReturnData';
          } else if (lookupResponse[0] === 0x52) {
            lookupReturnType = 'ExceptionalReturn (object may not be bound)';
          } else {
            lookupReturnType = `Unknown (0x${lookupResponse[0].toString(16)})`;
          }

          remoteRef = extractRemoteRef(lookupResponse);
        }
      } finally {
        regWriter.releaseLock();
        regReader.releaseLock();
        regSocket.close();
      }

      // ---- Phase 2: Connect to remote object and invoke method (if ref found) ----
      let invokeResult: string | null = null;
      let invokeResponseHex = '';
      let invokeAttempted = false;

      if (remoteRef.host && remoteRef.port) {
        invokeAttempted = true;
        const objHost = remoteRef.host;
        const objPort = remoteRef.port;

        try {
          const objSocket = connect(`${objHost}:${objPort}`);
          await objSocket.opened;

          const objWriter = objSocket.writable.getWriter();
          const objReader = objSocket.readable.getReader();

          try {
            // Re-do JRMI handshake on the object's endpoint
            const handshake2 = buildJRMIHandshake(STREAM_PROTOCOL);
            await objWriter.write(handshake2);

            const ackData2 = await readResponse(objReader, Math.min(timeout, 3000), 256);
            const ack2 = parseProtocolAck(ackData2);

            if (ack2.acknowledged) {
              const clientEndpoint2 = buildClientEndpoint();
              await objWriter.write(clientEndpoint2);

              // Build a minimal CALL message for method invocation.
              // Without precise interface hashes and argument types, we send
              // a probing CALL to the remote object and observe the response.
              // We use methodHash = 0 as a probe (server may return an exception).
              const methodHashHi = body.methodHash
                ? parseInt(body.methodHash.slice(0, 8), 16)
                : 0x00000000;
              const methodHashLo = body.methodHash
                ? parseInt(body.methodHash.slice(8, 16), 16)
                : 0x00000000;

              const objIdBytes = remoteRef.objId
                ? new Uint8Array(remoteRef.objId.match(/.{2}/g)!.map(h => parseInt(h, 16)))
                : new Uint8Array(8);

              // Minimal CALL PDU for method invocation
              const streamMagic = new Uint8Array([0xac, 0xed, 0x00, 0x05]);
              const blockData = new Uint8Array(34);
              const bv = new DataView(blockData.buffer);

              // ObjID: use the objId from the RemoteRef
              blockData.set(objIdBytes.slice(0, 8), 0);
              // UID: zeros
              // operation (at offset 22, big-endian): -1 means "use hash" in RMI v2
              bv.setInt32(22, -1, false);
              // method hash
              bv.setUint32(26, methodHashHi, false);
              bv.setUint32(30, methodHashLo, false);

              const invokePacket = new Uint8Array(1 + streamMagic.length + 2 + blockData.length);
              invokePacket[0] = 0x50;
              invokePacket.set(streamMagic, 1);
              invokePacket[5] = 0x77;
              invokePacket[6] = 34;
              invokePacket.set(blockData, 7);

              await objWriter.write(invokePacket);

              const invokeResponse = await readResponse(objReader, Math.min(timeout, 4000), 4096);
              invokeResponseHex = toHex(invokeResponse);

              if (invokeResponse.length > 0) {
                // Try to extract a string result from the response
                const strings: string[] = [];
                for (let i = 0; i < invokeResponse.length - 3; i++) {
                  if (invokeResponse[i] === 0x74) {
                    const sLen = (invokeResponse[i + 1] << 8) | invokeResponse[i + 2];
                    if (sLen > 0 && sLen < 512 && i + 3 + sLen <= invokeResponse.length) {
                      const s = new TextDecoder().decode(invokeResponse.slice(i + 3, i + 3 + sLen));
                      if (/^[\x20-\x7e]+$/.test(s) && !s.startsWith('[L') && !s.includes(';')) {
                        strings.push(s);
                      }
                    }
                  }
                }
                invokeResult = strings.length > 0 ? strings.join('; ') : `${invokeResponse.length} bytes received`;
              }
            }
          } finally {
            objWriter.releaseLock();
            objReader.releaseLock();
            objSocket.close();
          }
        } catch (invokeErr) {
          invokeResult = `Invocation failed: ${invokeErr instanceof Error ? invokeErr.message : String(invokeErr)}`;
        }
      }

      const rtt = Date.now() - startTime;

      return {
        success: true,
        host,
        port,
        rtt,
        isRMI: true,
        protocol: 'RMI',
        objectName,
        methodName,
        lookupSuccess,
        lookupReturnType,
        objectRef: remoteRef.host
          ? {
              host: remoteRef.host,
              port: remoteRef.port,
              objId: remoteRef.objId,
            }
          : null,
        invokeAttempted,
        invokeResult,
        lookupResponseHex,
        invokeResponseHex: invokeAttempted ? invokeResponseHex : undefined,
        securityWarning: 'WARNING: Exposed RMI endpoints can be exploited via Java deserialization attacks',
        message: lookupSuccess
          ? remoteRef.host
            ? `Lookup OK, remote ref found at ${remoteRef.host}:${remoteRef.port}. ${invokeAttempted ? `Invoke: ${invokeResult || 'no result'}` : 'No invocation attempted'}`
            : `Lookup returned ${lookupReturnType} but no RemoteRef extracted`
          : `Lookup call sent but no usable response in ${rtt}ms`,
      };
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : 'RMI invoke failed',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'RMI invoke error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
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
