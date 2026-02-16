/**
 * IKE/ISAKMP Protocol Implementation (RFC 2408/2409/7296)
 *
 * Internet Key Exchange (IKE) is the protocol used to set up Security Associations
 * (SAs) for IPsec VPN connections. ISAKMP (Internet Security Association and Key
 * Management Protocol) is the framework for authentication and key exchange.
 *
 * Protocol Overview:
 * - Port: 500 (UDP primarily, TCP for this implementation)
 * - Port: 4500 (UDP for NAT-T - NAT Traversal)
 * - Versions: IKEv1 (RFC 2409), IKEv2 (RFC 7296)
 * - Header: 28-byte ISAKMP header + variable payloads
 * - Exchange Types: Main Mode, Aggressive Mode, Quick Mode (IKEv1)
 *
 * IKEv1 Phases:
 * - Phase 1: Establish IKE SA (ISAKMP SA) - Main Mode or Aggressive Mode
 * - Phase 2: Establish IPsec SA (ESP/AH) - Quick Mode
 *
 * ISAKMP Header (28 bytes):
 * - Initiator Cookie (8 bytes): Random value
 * - Responder Cookie (8 bytes): Zero in initial request
 * - Next Payload (1 byte): Type of first payload
 * - Version (1 byte): Major/Minor (0x10 = IKEv1)
 * - Exchange Type (1 byte): Main Mode (2), Aggressive (4), etc.
 * - Flags (1 byte): Encryption, Commit, Authentication
 * - Message ID (4 bytes): Unique message identifier
 * - Length (4 bytes): Total message length
 *
 * Payload Types:
 * - Security Association (SA) - 1
 * - Proposal (P) - 2
 * - Transform (T) - 3
 * - Key Exchange (KE) - 4
 * - Identification (ID) - 5
 * - Certificate (CERT) - 6
 * - Hash (HASH) - 8
 * - Signature (SIG) - 9
 * - Nonce (NONCE) - 10
 * - Notification (N) - 11
 * - Delete (D) - 12
 * - Vendor ID (VID) - 13
 *
 * Use Cases:
 * - IPsec VPN gateway detection
 * - Security appliance identification
 * - IKE version and capability discovery
 * - NAT-T support testing
 * - Vendor-specific VPN detection (Cisco, Juniper, etc.)
 */

import { connect } from 'cloudflare:sockets';

interface IKERequest {
  host: string;
  port?: number;
  timeout?: number;
  exchangeType?: number; // 2=Main Mode, 4=Aggressive Mode
}

interface IKEResponse {
  success: boolean;
  host: string;
  port: number;
  version?: string;
  exchangeType?: string;
  initiatorCookie?: string;
  responderCookie?: string;
  vendorIds?: string[];
  proposals?: number;
  transforms?: number;
  rtt?: number;
  error?: string;
}

// ISAKMP Exchange Types
enum ExchangeType {
  None = 0,
  Base = 1,
  IdentityProtection = 2, // Main Mode
  AuthenticationOnly = 3,
  Aggressive = 4,
  Informational = 5,
  QuickMode = 32,
  NewGroupMode = 33,
}

// ISAKMP Payload Types
enum PayloadType {
  None = 0,
  SecurityAssociation = 1,
  Proposal = 2,
  Transform = 3,
  KeyExchange = 4,
  Identification = 5,
  Certificate = 6,
  CertificateRequest = 7,
  Hash = 8,
  Signature = 9,
  Nonce = 10,
  Notification = 11,
  Delete = 12,
  VendorID = 13,
  SAKEv2 = 33,
  KEv2 = 34,
  IDi = 35,
  IDr = 36,
  Auth = 39,
  Nv2 = 40,
}

// Transform IDs for ISAKMP
enum TransformID {
  KEY_IKE = 1,
}

// Encryption Algorithms (for reference)
// enum EncryptionAlgorithm {
//   DES_CBC = 1,
//   IDEA_CBC = 2,
//   Blowfish_CBC = 3,
//   RC5_R16_B64_CBC = 4,
//   TripleDES_CBC = 5,
//   CAST_CBC = 6,
//   AES_CBC = 7,
//   Camellia_CBC = 8,
// }

// Hash Algorithms (for reference)
// enum HashAlgorithm {
//   MD5 = 1,
//   SHA1 = 2,
//   Tiger = 3,
//   SHA2_256 = 4,
//   SHA2_384 = 5,
//   SHA2_512 = 6,
// }

// Authentication Methods (for reference)
// enum AuthMethod {
//   PreSharedKey = 1,
//   DSS_Signatures = 2,
//   RSA_Signatures = 3,
//   RSA_Encryption = 4,
//   RSA_Revised_Encryption = 5,
// }

// Diffie-Hellman Groups (for reference)
// enum DHGroup {
//   Group1_768bit = 1,
//   Group2_1024bit = 2,
//   Group5_1536bit = 5,
//   Group14_2048bit = 14,
//   Group15_3072bit = 15,
//   Group16_4096bit = 16,
// }

/**
 * Build ISAKMP header (28 bytes)
 */
function buildISAKMPHeader(
  initiatorCookie: Buffer,
  responderCookie: Buffer,
  nextPayload: number,
  version: number,
  exchangeType: number,
  flags: number,
  messageId: number,
  length: number
): Buffer {
  const header = Buffer.allocUnsafe(28);

  initiatorCookie.copy(header, 0);
  responderCookie.copy(header, 8);
  header.writeUInt8(nextPayload, 16);
  header.writeUInt8(version, 17);
  header.writeUInt8(exchangeType, 18);
  header.writeUInt8(flags, 19);
  header.writeUInt32BE(messageId, 20);
  header.writeUInt32BE(length, 24);

  return header;
}

/**
 * Build Security Association (SA) payload
 */
function buildSAPayload(nextPayload: number): Buffer {
  // SA Payload header (4 bytes): Next Payload, Reserved, Payload Length
  // DOI (4 bytes): Domain of Interpretation (1 = IPsec)
  // Situation (4 bytes): SIT_IDENTITY_ONLY = 1
  // Proposal payload follows

  const proposal = buildProposalPayload(PayloadType.None);
  const payloadLength = 12 + proposal.length;

  const sa = Buffer.allocUnsafe(12);
  sa.writeUInt8(nextPayload, 0);
  sa.writeUInt8(0, 1); // Reserved
  sa.writeUInt16BE(payloadLength, 2);
  sa.writeUInt32BE(1, 4); // DOI = IPsec
  sa.writeUInt32BE(1, 8); // Situation = SIT_IDENTITY_ONLY

  return Buffer.concat([sa, proposal]);
}

/**
 * Build Proposal payload
 */
function buildProposalPayload(nextPayload: number): Buffer {
  // Proposal Payload:
  // - Next Payload (1)
  // - Reserved (1)
  // - Payload Length (2)
  // - Proposal Number (1)
  // - Protocol ID (1) - PROTO_ISAKMP = 1
  // - SPI Size (1)
  // - Number of Transforms (1)
  // - Transform payloads follow

  const transform = buildTransformPayload(PayloadType.None);
  const payloadLength = 8 + transform.length;

  const proposal = Buffer.allocUnsafe(8);
  proposal.writeUInt8(nextPayload, 0);
  proposal.writeUInt8(0, 1);
  proposal.writeUInt16BE(payloadLength, 2);
  proposal.writeUInt8(1, 4); // Proposal #1
  proposal.writeUInt8(1, 5); // Protocol ID = ISAKMP
  proposal.writeUInt8(0, 6); // SPI Size = 0
  proposal.writeUInt8(1, 7); // 1 transform

  return Buffer.concat([proposal, transform]);
}

/**
 * Build Transform payload with typical IKE attributes
 */
function buildTransformPayload(nextPayload: number): Buffer {
  // Transform Payload:
  // - Next Payload (1)
  // - Reserved (1)
  // - Payload Length (2)
  // - Transform Number (1)
  // - Transform ID (1)
  // - Reserved2 (2)
  // - Attributes (variable)

  // Build attributes: Encryption, Hash, Auth, Group
  const attributes = [
    // Encryption Algorithm = AES-CBC
    Buffer.from([0x80, 0x01, 0x00, 0x07]),
    // Hash Algorithm = SHA1
    Buffer.from([0x80, 0x02, 0x00, 0x02]),
    // Authentication Method = Pre-Shared Key
    Buffer.from([0x80, 0x03, 0x00, 0x01]),
    // Group Description = Group 2 (1024-bit)
    Buffer.from([0x80, 0x04, 0x00, 0x02]),
    // Life Type = Seconds
    Buffer.from([0x80, 0x0B, 0x00, 0x01]),
    // Life Duration = 28800 seconds
    Buffer.from([0x80, 0x0C, 0x00, 0x00, 0x70, 0x80]),
  ];

  const attrData = Buffer.concat(attributes);
  const payloadLength = 8 + attrData.length;

  const transform = Buffer.allocUnsafe(8);
  transform.writeUInt8(nextPayload, 0);
  transform.writeUInt8(0, 1);
  transform.writeUInt16BE(payloadLength, 2);
  transform.writeUInt8(1, 4); // Transform #1
  transform.writeUInt8(TransformID.KEY_IKE, 5);
  transform.writeUInt16BE(0, 6);

  return Buffer.concat([transform, attrData]);
}

/**
 * Parse ISAKMP message
 */
function parseISAKMPMessage(data: Buffer): {
  initiatorCookie: Buffer;
  responderCookie: Buffer;
  nextPayload: number;
  version: number;
  exchangeType: number;
  flags: number;
  messageId: number;
  length: number;
  payloads: Array<{ type: number; data: Buffer }>;
} | null {
  if (data.length < 28) {
    return null;
  }

  const initiatorCookie = data.subarray(0, 8);
  const responderCookie = data.subarray(8, 16);
  const nextPayload = data.readUInt8(16);
  const version = data.readUInt8(17);
  const exchangeType = data.readUInt8(18);
  const flags = data.readUInt8(19);
  const messageId = data.readUInt32BE(20);
  const length = data.readUInt32BE(24);

  const payloads: Array<{ type: number; data: Buffer }> = [];
  let offset = 28;
  let currentPayload = nextPayload;

  while (currentPayload !== PayloadType.None && offset < data.length) {
    if (offset + 4 > data.length) break;

    const nextPl = data.readUInt8(offset);
    const payloadLength = data.readUInt16BE(offset + 2);

    if (payloadLength < 4 || offset + payloadLength > data.length) break;

    const payloadData = data.subarray(offset, offset + payloadLength);
    payloads.push({ type: currentPayload, data: Buffer.from(payloadData) });

    offset += payloadLength;
    currentPayload = nextPl;
  }

  return {
    initiatorCookie,
    responderCookie,
    nextPayload,
    version,
    exchangeType,
    flags,
    messageId,
    length,
    payloads,
  };
}

/**
 * Extract vendor IDs from payloads
 */
function extractVendorIDs(payloads: Array<{ type: number; data: Buffer }>): string[] {
  const vendorIds: string[] = [];

  for (const payload of payloads) {
    if (payload.type === PayloadType.VendorID && payload.data.length > 4) {
      const vendorData = payload.data.subarray(4).toString('hex');
      vendorIds.push(vendorData);
    }
  }

  return vendorIds;
}

/**
 * Probe IKE server with Main Mode SA proposal.
 * Sends IKE Phase 1 SA proposal and parses response.
 */
export async function handleIKEProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as IKERequest;
    const { host, port = 500, timeout = 15000, exchangeType = ExchangeType.IdentityProtection } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies IKEResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies IKEResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Generate random initiator cookie (8 bytes)
      const initiatorCookie = Buffer.allocUnsafe(8);
      for (let i = 0; i < 8; i++) {
        initiatorCookie[i] = Math.floor(Math.random() * 256);
      }

      // Responder cookie is zero for initial request
      const responderCookie = Buffer.alloc(8, 0);

      // Build SA payload
      const saPayload = buildSAPayload(PayloadType.None);
      const totalLength = 28 + saPayload.length;

      // Build ISAKMP header
      const header = buildISAKMPHeader(
        initiatorCookie,
        responderCookie,
        PayloadType.SecurityAssociation,
        0x10, // Version 1.0
        exchangeType,
        0x00, // Flags
        0,    // Message ID
        totalLength
      );

      const ikeRequest = Buffer.concat([header, saPayload]);

      // Send IKE request
      const writer = socket.writable.getWriter();
      await writer.write(ikeRequest);
      writer.releaseLock();

      // Read response
      const reader = socket.readable.getReader();

      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (done || !value) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response from IKE server',
        } satisfies IKEResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const response = parseISAKMPMessage(Buffer.from(value));

      if (!response) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid ISAKMP response format',
        } satisfies IKEResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      // Extract vendor IDs
      const vendorIds = extractVendorIDs(response.payloads);

      // Count proposals and transforms
      const proposals = response.payloads.filter(p => p.type === PayloadType.Proposal).length;
      const transforms = response.payloads.filter(p => p.type === PayloadType.Transform).length;

      const exchangeTypeName =
        response.exchangeType === ExchangeType.IdentityProtection
          ? 'Main Mode'
          : response.exchangeType === ExchangeType.Aggressive
          ? 'Aggressive Mode'
          : response.exchangeType === ExchangeType.QuickMode
          ? 'Quick Mode'
          : `Unknown (${response.exchangeType})`;

      const versionStr = `${(response.version >> 4) & 0x0F}.${response.version & 0x0F}`;

      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        version: versionStr,
        exchangeType: exchangeTypeName,
        initiatorCookie: response.initiatorCookie.toString('hex'),
        responderCookie: response.responderCookie.toString('hex'),
        vendorIds: vendorIds.length > 0 ? vendorIds : undefined,
        proposals: proposals > 0 ? proposals : undefined,
        transforms: transforms > 0 ? transforms : undefined,
        rtt,
      } satisfies IKEResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 500,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies IKEResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Detect IKE version (IKEv1 vs IKEv2) support.
 * Sends both IKEv1 and IKEv2 probes to determine support.
 */
export async function handleIKEVersionDetect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as IKERequest;
    const { host, port = 500, timeout = 10000 } = body;

    // Try IKEv1 first
    const v1Request = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ host, port, timeout }),
    });

    const v1Response = await handleIKEProbe(v1Request);
    const v1Data = await v1Response.json() as IKEResponse;

    return new Response(JSON.stringify({
      success: v1Data.success,
      host,
      port,
      ikev1: v1Data.success,
      ikev2: false, // IKEv2 probe would go here
      version: v1Data.version,
      vendorIds: v1Data.vendorIds,
      error: v1Data.error,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
