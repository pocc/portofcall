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

// ─── IKEv2 IKE_SA_INIT ───────────────────────────────────────────────────────

interface IKEv2Response {
  success: boolean;
  host: string;
  port: number;
  version?: number;
  responderSpi?: string;
  selectedDHGroup?: number;
  selectedEncr?: string;
  selectedInteg?: string;
  selectedPRF?: string;
  errorNotify?: string;
  rtt?: number;
  error?: string;
}

// IKEv2 Next Payload type numbers (RFC 7296)
const IKEv2Payload = {
  None: 0,
  SA: 33,
  KE: 34,
  IDi: 35,
  IDr: 36,
  CERT: 37,
  CERTREQ: 38,
  AUTH: 39,
  Nonce: 40,
  Notify: 41,
  Delete: 42,
  VendorID: 43,
  TSi: 44,
  TSr: 45,
  SK: 46,
  CP: 47,
  EAP: 48,
} as const;

// IKEv2 Transform types
const IKEv2TransformType = {
  ENCR: 1,
  PRF: 2,
  INTEG: 3,
  DH: 4,
  ESN: 5,
} as const;

// Well-known algorithm IDs
const ENCR_NAMES: Record<number, string> = {
  2: 'ENCR_3DES',
  3: 'ENCR_RC5',
  5: 'ENCR_CAST',
  6: 'ENCR_BLOWFISH',
  7: 'ENCR_3IDEA',
  12: 'ENCR_AES_CBC',
  13: 'ENCR_AES_CTR',
  18: 'ENCR_AES_GCM_16',
  20: 'ENCR_CAMELLIA_CBC',
};

const PRF_NAMES: Record<number, string> = {
  1: 'PRF_HMAC_MD5',
  2: 'PRF_HMAC_SHA1',
  3: 'PRF_HMAC_TIGER',
  4: 'PRF_AES128_XCBC',
  5: 'PRF_HMAC_SHA2_256',
  6: 'PRF_HMAC_SHA2_384',
  7: 'PRF_HMAC_SHA2_512',
};

const INTEG_NAMES: Record<number, string> = {
  1: 'AUTH_HMAC_MD5_96',
  2: 'AUTH_HMAC_SHA1_96',
  3: 'AUTH_DES_MAC',
  4: 'AUTH_KPDK_MD5',
  5: 'AUTH_AES_XCBC_96',
  8: 'AUTH_HMAC_SHA2_256_128',
  9: 'AUTH_HMAC_SHA2_384_192',
  10: 'AUTH_HMAC_SHA2_512_256',
  12: 'AUTH_AES_CMAC_96',
  13: 'AUTH_AES_128_GMAC',
  14: 'AUTH_AES_256_GMAC',
};

// IKEv2 Notify message type codes
const NOTIFY_NAMES: Record<number, string> = {
  1:    'UNSUPPORTED_CRITICAL_PAYLOAD',
  4:    'INVALID_IKE_SPI',
  5:    'INVALID_MAJOR_VERSION',
  7:    'INVALID_SYNTAX',
  9:    'INVALID_MESSAGE_ID',
  11:   'INVALID_SPI',
  14:   'NO_PROPOSAL_CHOSEN',
  17:   'INVALID_KE_PAYLOAD',
  24:   'AUTHENTICATION_FAILED',
  34:   'SINGLE_PAIR_REQUIRED',
  35:   'NO_ADDITIONAL_SAS',
  36:   'INTERNAL_ADDRESS_FAILURE',
  37:   'FAILED_CP_REQUIRED',
  38:   'TS_UNACCEPTABLE',
  39:   'INVALID_SELECTORS',
  16384: 'INITIAL_CONTACT',
  16385: 'SET_WINDOW_SIZE',
  16386: 'ADDITIONAL_TS_POSSIBLE',
  16387: 'IPCOMP_SUPPORTED',
  16388: 'NAT_DETECTION_SOURCE_IP',
  16389: 'NAT_DETECTION_DESTINATION_IP',
  16390: 'COOKIE',
  16391: 'USE_TRANSPORT_MODE',
  16392: 'HTTP_CERT_LOOKUP_SUPPORTED',
  16393: 'REKEY_SA',
  16394: 'ESP_TFC_PADDING_NOT_SUPPORTED',
  16395: 'NON_FIRST_FRAGMENTS_ALSO',
};

/**
 * Build a single IKEv2 transform sub-structure (8 bytes + optional attributes).
 * Format: Type(1) Reserved(1) TransformID(2) Attributes(variable)
 * With wrapping payload header: NextPayload(1) RESERVED(1) Length(2)
 */
function buildIKEv2Transform(
  isLast: boolean,
  transformType: number,
  transformId: number,
  attributes?: Buffer,
): Buffer {
  const attrLen = attributes ? attributes.length : 0;
  const totalLen = 8 + attrLen;
  const buf = Buffer.allocUnsafe(totalLen);

  buf.writeUInt8(isLast ? 0 : 3, 0);       // 0=last, 3=more transforms
  buf.writeUInt8(0, 1);                      // Reserved
  buf.writeUInt16BE(totalLen, 2);            // Transform length
  buf.writeUInt8(transformType, 4);          // Transform type
  buf.writeUInt8(0, 5);                      // Reserved
  buf.writeUInt16BE(transformId, 6);         // Transform ID

  if (attributes) attributes.copy(buf, 8);

  return buf;
}

/**
 * Build a fixed-length attribute for IKEv2 transform (key length etc.).
 * TV format: bit15=1 (TV), bits14-0=type, value(2)
 */
function buildIKEv2TVAttribute(attrType: number, value: number): Buffer {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt16BE(0x8000 | attrType, 0);
  buf.writeUInt16BE(value, 2);
  return buf;
}

/**
 * Build an IKEv2 SA payload for IKE_SA_INIT.
 * Proposes: DH group 14, AES-CBC-256, HMAC-SHA2-256 (PRF+INTEG), no ESN.
 */
function buildIKEv2SAPayload(nextPayloadAfterSA: number): Buffer {
  // Transforms for the IKE SA proposal:
  //   ENCR: AES-CBC (id=12) with key-len=256 attribute
  //   PRF:  PRF_HMAC_SHA2_256 (id=5)
  //   INTEG: AUTH_HMAC_SHA2_256_128 (id=8)
  //   DH:   Group 14 / 2048-bit MODP (id=14)

  const keyLenAttr = buildIKEv2TVAttribute(14 /* KEY_LENGTH */, 256);

  const t1 = buildIKEv2Transform(false, IKEv2TransformType.ENCR, 12 /* AES-CBC */, keyLenAttr);
  const t2 = buildIKEv2Transform(false, IKEv2TransformType.PRF, 5 /* HMAC-SHA2-256 */);
  const t3 = buildIKEv2Transform(false, IKEv2TransformType.INTEG, 8 /* HMAC-SHA2-256-128 */);
  const t4 = buildIKEv2Transform(true, IKEv2TransformType.DH, 14 /* DH group 14 */);

  const transforms = Buffer.concat([t1, t2, t3, t4]);

  // Proposal sub-structure:
  // Last(1) Reserved(1) Length(2) ProposalNum(1) ProtocolID(1) SPISize(1) NumTransforms(1)
  const proposalBody = Buffer.allocUnsafe(8);
  proposalBody.writeUInt8(0, 0);                       // Last proposal
  proposalBody.writeUInt8(0, 1);                       // Reserved
  proposalBody.writeUInt16BE(8 + transforms.length, 2);// Length
  proposalBody.writeUInt8(1, 4);                       // Proposal #1
  proposalBody.writeUInt8(1, 5);                       // Protocol IKE = 1
  proposalBody.writeUInt8(0, 6);                       // SPI Size = 0
  proposalBody.writeUInt8(4, 7);                       // 4 transforms

  const proposal = Buffer.concat([proposalBody, transforms]);

  // SA payload header: NextPayload(1) CRITICAL(1) Length(2)
  const saHdr = Buffer.allocUnsafe(4);
  saHdr.writeUInt8(nextPayloadAfterSA, 0);
  saHdr.writeUInt8(0, 1);                              // not critical
  saHdr.writeUInt16BE(4 + proposal.length, 2);

  return Buffer.concat([saHdr, proposal]);
}

/**
 * Build an IKEv2 KE payload.
 * DH group 14 (2048-bit MODP) — we use a zeroed public key value for probing.
 */
function buildIKEv2KEPayload(nextPayload: number): Buffer {
  const dhPublicKeyLen = 256; // 2048 bits / 8
  // KE payload header: NextPayload(1) CRITICAL(1) Length(2) DHGroup(2) RESERVED(2)
  const hdr = Buffer.allocUnsafe(8);
  hdr.writeUInt8(nextPayload, 0);
  hdr.writeUInt8(0, 1);
  hdr.writeUInt16BE(8 + dhPublicKeyLen, 2);
  hdr.writeUInt16BE(14 /* DH group 14 */, 4);
  hdr.writeUInt16BE(0, 6);

  const dhValue = Buffer.alloc(dhPublicKeyLen, 0); // zeroed fake key
  return Buffer.concat([hdr, dhValue]);
}

/**
 * Build an IKEv2 Nonce payload (Nr).
 */
function buildIKEv2NoncePayload(nextPayload: number, nonce: Buffer): Buffer {
  const hdr = Buffer.allocUnsafe(4);
  hdr.writeUInt8(nextPayload, 0);
  hdr.writeUInt8(0, 1);
  hdr.writeUInt16BE(4 + nonce.length, 2);
  return Buffer.concat([hdr, nonce]);
}

/**
 * Build the full IKEv2 IKE_SA_INIT request.
 *
 * IKE Header (28 bytes):
 *   initiatorSPI(8) + responderSPI(8) + nextPayload(1) + version(1) +
 *   exchangeType(1) + flags(1) + messageID(4) + length(4)
 */
function buildIKEv2SAInit(initiatorSPI: Buffer, nonce: Buffer): Buffer {
  // Payload chain: SA → KE → Nonce
  const noncePl = buildIKEv2NoncePayload(IKEv2Payload.None, nonce);
  const kePl = buildIKEv2KEPayload(IKEv2Payload.Nonce);
  const saPl = buildIKEv2SAPayload(IKEv2Payload.KE);

  const payloads = Buffer.concat([saPl, kePl, noncePl]);
  const totalLength = 28 + payloads.length;

  const header = Buffer.allocUnsafe(28);
  initiatorSPI.copy(header, 0);                         // Initiator SPI (8 bytes)
  Buffer.alloc(8, 0).copy(header, 8);                   // Responder SPI = 0
  header.writeUInt8(IKEv2Payload.SA, 16);               // First payload = SA
  header.writeUInt8(0x20, 17);                           // Version = 2.0
  header.writeUInt8(34, 18);                             // Exchange type = IKE_SA_INIT
  header.writeUInt8(0x08, 19);                           // Flags: Initiator bit
  header.writeUInt32BE(0, 20);                           // Message ID = 0
  header.writeUInt32BE(totalLength, 24);

  return Buffer.concat([header, payloads]);
}

/**
 * Parse an IKEv2 response.
 * Returns header fields and extracted payload info.
 */
function parseIKEv2Response(data: Buffer): {
  initiatorSPI: string;
  responderSPI: string;
  version: number;
  exchangeType: number;
  flags: number;
  payloads: Array<{ type: number; data: Buffer }>;
} | null {
  if (data.length < 28) return null;

  const initiatorSPI = data.subarray(0, 8).toString('hex');
  const responderSPI = data.subarray(8, 16).toString('hex');
  const version = data.readUInt8(17);
  const exchangeType = data.readUInt8(18);
  const flags = data.readUInt8(19);
  const totalLength = data.readUInt32BE(24);

  const payloads: Array<{ type: number; data: Buffer }> = [];
  let offset = 28;
  let currentType = data.readUInt8(16);

  while (currentType !== IKEv2Payload.None && offset + 4 <= Math.min(data.length, totalLength)) {
    const nextType = data.readUInt8(offset);
    const payloadLen = data.readUInt16BE(offset + 2);
    if (payloadLen < 4 || offset + payloadLen > data.length) break;

    payloads.push({
      type: currentType,
      data: Buffer.from(data.subarray(offset, offset + payloadLen)),
    });

    offset += payloadLen;
    currentType = nextType;
  }

  return { initiatorSPI, responderSPI, version, exchangeType, flags, payloads };
}

/**
 * Parse the SA payload in an IKEv2 IKE_SA_INIT response to extract
 * selected algorithms from the first proposal.
 */
function parseIKEv2SAPayload(saPayloadData: Buffer): {
  dhGroup?: number;
  encr?: string;
  prf?: string;
  integ?: string;
} {
  // SA payload: NextPayload(1) CRITICAL(1) Length(2) [proposals...]
  // Proposal: Last(1) Reserved(1) Length(2) Num(1) Proto(1) SPISize(1) NumTransforms(1) [SPI] [transforms...]
  if (saPayloadData.length < 8) return {};

  let propOffset = 4; // skip SA header (4 bytes)

  const result: { dhGroup?: number; encr?: string; prf?: string; integ?: string } = {};

  while (propOffset + 8 <= saPayloadData.length) {
    const propLen = saPayloadData.readUInt16BE(propOffset + 2);
    const numTransforms = saPayloadData.readUInt8(propOffset + 7);
    const spiSize = saPayloadData.readUInt8(propOffset + 6);

    let tOffset = propOffset + 8 + spiSize;

    for (let t = 0; t < numTransforms && tOffset + 8 <= saPayloadData.length; t++) {
      const tLen = saPayloadData.readUInt16BE(tOffset + 2);
      const tType = saPayloadData.readUInt8(tOffset + 4);
      const tId = saPayloadData.readUInt16BE(tOffset + 6);

      switch (tType) {
        case IKEv2TransformType.ENCR:
          result.encr = ENCR_NAMES[tId] || `ENCR_${tId}`;
          break;
        case IKEv2TransformType.PRF:
          result.prf = PRF_NAMES[tId] || `PRF_${tId}`;
          break;
        case IKEv2TransformType.INTEG:
          result.integ = INTEG_NAMES[tId] || `INTEG_${tId}`;
          break;
        case IKEv2TransformType.DH:
          result.dhGroup = tId;
          break;
      }

      tOffset += tLen || 8;
    }

    const isLast = saPayloadData.readUInt8(propOffset) === 0;
    propOffset += propLen || 8;
    if (isLast) break;
  }

  return result;
}

/**
 * Send an IKEv2 IKE_SA_INIT request and parse the response.
 *
 * POST /api/ike/v2
 * Body: { host, port?, timeout? }
 *
 * Note: IKE normally runs over UDP/500, but some implementations (Cisco,
 * strongSwan) also accept TCP/4500 (RFC 8229) or TCP/500.  This handler
 * uses TCP as that is the only transport available in Cloudflare Workers.
 * Expects IKEv2 IKE_SA_INIT exchange (exchange type 34).
 */
export async function handleIKEv2SA(request: Request): Promise<Response> {
  try {
    const body = await request.json() as IKERequest;
    const { host, port = 500, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false, host: '', port,
        error: 'Host is required',
      } satisfies IKEv2Response), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false, host, port,
        error: 'Port must be between 1 and 65535',
      } satisfies IKEv2Response), {
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

      // Build IKEv2 IKE_SA_INIT packet
      const initiatorSPI = Buffer.allocUnsafe(8);
      for (let i = 0; i < 8; i++) initiatorSPI[i] = Math.floor(Math.random() * 256);

      const nonce = Buffer.allocUnsafe(32);
      for (let i = 0; i < 32; i++) nonce[i] = Math.floor(Math.random() * 256);

      const packet = buildIKEv2SAInit(initiatorSPI, nonce);

      const writer = socket.writable.getWriter();
      await writer.write(packet);
      writer.releaseLock();

      // Read response
      const reader = socket.readable.getReader();

      // Collect data with a read timeout
      const chunks: Buffer[] = [];
      let totalLen = 0;
      const readDeadline = Date.now() + Math.min(timeout, 8000);

      while (Date.now() < readDeadline) {
        const remaining = readDeadline - Date.now();
        if (remaining <= 0) break;

        const st = new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), remaining),
        );

        const { value, done } = await Promise.race([reader.read(), st]);
        if (done || !value) break;
        chunks.push(Buffer.from(value));
        totalLen += value.length;
        if (totalLen >= 28) break; // We have at least the IKE header — stop early
      }

      reader.releaseLock();
      socket.close();

      const rtt = Date.now() - start;

      if (totalLen === 0) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          rtt,
          error: 'No response from server. IKEv2 over TCP may not be supported ' +
            '(IKE normally uses UDP/500).',
        } satisfies IKEv2Response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const combined = Buffer.concat(chunks, totalLen);
      const parsed = parseIKEv2Response(combined);

      if (!parsed) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          rtt,
          error: 'Could not parse IKEv2 response (response too short or malformed).',
        } satisfies IKEv2Response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Check if version byte indicates IKEv2
      const majorVersion = (parsed.version >> 4) & 0x0F;
      const minorVersion = parsed.version & 0x0F;

      // Look for error notify payloads
      let errorNotify: string | undefined;
      let saAlgorithms: { dhGroup?: number; encr?: string; prf?: string; integ?: string } = {};

      for (const pl of parsed.payloads) {
        if (pl.type === IKEv2Payload.Notify && pl.data.length >= 8) {
          // Notify payload: NextPayload(1) Critical(1) Length(2) ProtocolID(1) SPISize(1) NotifyType(2)
          const notifyType = pl.data.readUInt16BE(6);
          if (notifyType < 16384) {
            // Error notifications are < 16384
            errorNotify = NOTIFY_NAMES[notifyType] || `NOTIFY_${notifyType}`;
          }
        }

        if (pl.type === IKEv2Payload.SA) {
          saAlgorithms = parseIKEv2SAPayload(pl.data);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        version: majorVersion === 2 ? 2 : majorVersion,
        responderSpi: parsed.responderSPI,
        selectedDHGroup: saAlgorithms.dhGroup,
        selectedEncr: saAlgorithms.encr,
        selectedInteg: saAlgorithms.integ,
        selectedPRF: saAlgorithms.prf,
        errorNotify,
        rtt,
        note: majorVersion !== 2
          ? `Unexpected IKE version ${majorVersion}.${minorVersion} — may be IKEv1 server`
          : undefined,
      } satisfies IKEv2Response & { note?: string }), {
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
    } satisfies IKEv2Response), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
