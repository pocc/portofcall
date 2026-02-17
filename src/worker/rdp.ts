/**
 * RDP (Remote Desktop Protocol) Implementation
 *
 * Implements connectivity testing for RDP servers using the
 * X.224 Connection Request / Connection Confirm handshake (MS-RDPBCGR).
 *
 * Protocol Flow:
 * 1. Client sends TPKT header + X.224 Connection Request + RDP Negotiation Request
 * 2. Server sends TPKT header + X.224 Connection Confirm + RDP Negotiation Response
 *
 * TPKT Header (4 bytes):
 *   version(1) = 3 | reserved(1) = 0 | length(2, big-endian)
 *
 * X.224 Connection Request:
 *   length(1) | type(1) = 0xE0 | dst-ref(2) | src-ref(2) | class(1)
 *
 * RDP Negotiation Request (8 bytes):
 *   type(1) = 0x01 | flags(1) | length(2) = 8 | requestedProtocols(4)
 *
 * Requested Protocols:
 *   0x00000000 = Standard RDP Security
 *   0x00000001 = TLS 1.0/1.1/1.2
 *   0x00000002 = CredSSP (NLA)
 *   0x00000008 = RDSTLS
 *
 * Use Cases:
 * - RDP server discovery and connectivity testing
 * - Security protocol detection (Standard/TLS/NLA)
 * - Remote desktop infrastructure validation
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// RDP Negotiation Protocol constants
const PROTOCOL_RDP = 0x00000000;
const PROTOCOL_SSL = 0x00000001;
const PROTOCOL_HYBRID = 0x00000002; // CredSSP / NLA
const PROTOCOL_RDSTLS = 0x00000008;

// Negotiation response types
const TYPE_RDP_NEG_RSP = 0x02;
const TYPE_RDP_NEG_FAILURE = 0x03;

// Failure codes
const FAILURE_CODES: Record<number, string> = {
  0x01: 'SSL_REQUIRED_BY_SERVER',
  0x02: 'SSL_NOT_ALLOWED_BY_SERVER',
  0x03: 'SSL_CERT_NOT_ON_SERVER',
  0x04: 'INCONSISTENT_FLAGS',
  0x05: 'HYBRID_REQUIRED_BY_SERVER',
  0x06: 'SSL_WITH_USER_AUTH_REQUIRED_BY_SERVER',
};

/**
 * Build the X.224 Connection Request with RDP Negotiation.
 * requestedProtocols is a bitmask: SSL(0x1) | HYBRID(0x2) | RDSTLS(0x8)
 */
function buildConnectionRequest(requestedProtocols: number): Uint8Array {
  // RDP Negotiation Request (8 bytes, all LE)
  const negReq = new Uint8Array(8);
  negReq[0] = 0x01; // TYPE_RDP_NEG_REQ
  negReq[1] = 0x00; // flags
  new DataView(negReq.buffer).setUint16(2, 8, true);                    // length LE = 8
  new DataView(negReq.buffer).setUint32(4, requestedProtocols, true);   // protocols LE

  // X.224 CR fixed part (after LI): type(1) + DST-REF(2) + SRC-REF(2) + CLASS(1) = 6
  // LI covers everything after itself: 6 fixed + 8 negReq = 14
  const liValue = 6 + negReq.length; // 14
  const x224 = new Uint8Array(1 + liValue);
  x224[0] = liValue;               // Length Indicator
  x224[1] = 0xE0;                  // TPDU code: Connection Request
  x224[2] = 0x00; x224[3] = 0x00; // DST-REF = 0x0000
  x224[4] = 0x43; x224[5] = 0x21; // SRC-REF = 0x4321
  x224[6] = 0x00;                  // Class 0, no options
  x224.set(negReq, 7);

  // TPKT Header (4 bytes): version=3, reserved=0, length=total (BE)
  const totalLength = 4 + x224.length;
  const tpkt = new Uint8Array(totalLength);
  tpkt[0] = 0x03; // version
  tpkt[1] = 0x00; // reserved
  new DataView(tpkt.buffer).setUint16(2, totalLength, false); // length BE
  tpkt.set(x224, 4);

  return tpkt;
}

/**
 * Get human-readable names for a protocol bitmask (used in connect response)
 */
function getProtocolNames(protocols: number): string[] {
  const names: string[] = [];
  if (protocols === PROTOCOL_RDP) names.push('Standard RDP Security');
  if (protocols & PROTOCOL_SSL) names.push('TLS');
  if (protocols & PROTOCOL_HYBRID) names.push('CredSSP/NLA');
  if (protocols & PROTOCOL_RDSTLS) names.push('RDSTLS');
  return names.length > 0 ? names : ['Standard RDP Security'];
}

/**
 * Get a single protocol name for the selectedProtocol field in negotiate response.
 * MS-RDPBCGR selectedProtocol values:
 *   0 = Standard RDP
 *   1 = SSL/TLS
 *   2 = NLA (CredSSP)
 *   3 = NLA+TLS (HYBRID_EX)
 */
function getSelectedProtocolName(protocol: number): string {
  switch (protocol) {
    case 0: return 'Standard RDP';
    case 1: return 'SSL/TLS';
    case 2: return 'NLA (CredSSP)';
    case 3: return 'NLA+TLS';
    default: return `Unknown (0x${protocol.toString(16)})`;
  }
}

/**
 * Read exactly `length` bytes from a reader, accumulating chunks.
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let offset = 0;

  while (offset < length) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed while reading');

    const toCopy = Math.min(length - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }

  return buffer;
}

interface RDPNegotiateResult {
  success: boolean;
  selectedProtocol: number;
  protocolName: string;
  serverFlags: number;
  rdpVersion: string;
  latencyMs: number;
  raw: number[];
  note?: string;
  failureCode?: number;
  failureMessage?: string;
}

/**
 * Full RDP connection negotiation sequence (MS-RDPBCGR §1.3.2).
 *
 * Step 1: Build and send X.224 CR with RDP Negotiation Request.
 *   - TPKT header: 0x03, 0x00, length(uint16 BE)
 *   - TPDU code: 0xE0 (Connection Request)
 *   - DST-REF: 0x0000, SRC-REF: 0x4321, Class: 0x00
 *   - RDP Neg Req: type=0x01, flags=0x00, length=0x0008,
 *     requestedProtocols = 0x00000003 (SSL | HYBRID) by default
 *
 * Step 2: Parse X.224 Connection Confirm (CC) response.
 *   - Check TPKT version (0x03, 0x00)
 *   - Verify TPDU code = 0xD0 (Connection Confirm)
 *
 * Step 3: Extract RDP Negotiation Response or Failure.
 *   - type 0x02 = NEG_RSP  → read selectedProtocol (uint32 LE)
 *   - type 0x03 = NEG_FAILURE → read failureCode (uint32 LE)
 *
 * Selected protocol values:
 *   0 = Standard RDP  |  1 = SSL/TLS  |  2 = NLA (CredSSP)  |  3 = NLA+TLS
 *
 * POST /api/rdp/negotiate
 * Body: { host, port=3389, requestProtocols=3, timeout=10000 }
 */
export async function handleRDPNegotiate(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      requestProtocols?: number;
      timeout?: number;
    };

    const { host, port = 3389, requestProtocols = 3, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const negotiatePromise = (async (): Promise<RDPNegotiateResult> => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // --- Step 1: Send X.224 Connection Request ---
        await writer.write(buildConnectionRequest(requestProtocols));

        // --- Step 2: Read TPKT header (4 bytes) ---
        const tpktHeader = await readExact(reader, 4);

        if (tpktHeader[0] !== 0x03) {
          throw new Error(`Invalid TPKT version: 0x${tpktHeader[0].toString(16)} (expected 0x03)`);
        }
        if (tpktHeader[1] !== 0x00) {
          throw new Error(`Invalid TPKT reserved: 0x${tpktHeader[1].toString(16)} (expected 0x00)`);
        }

        const tpktLength = new DataView(tpktHeader.buffer).getUint16(2, false); // BE
        if (tpktLength < 11) { // minimum: 4 TPKT + 7 X.224 CC fixed
          throw new Error(`TPKT length too short: ${tpktLength}`);
        }

        const remaining = tpktLength - 4;
        const responseData = await readExact(reader, remaining);
        const latencyMs = Date.now() - startTime;

        // Assemble full raw packet for diagnostics
        const rawAll = new Uint8Array(4 + remaining);
        rawAll.set(tpktHeader, 0);
        rawAll.set(responseData, 4);

        // --- Step 2: Parse X.224 Connection Confirm ---
        // responseData layout:
        //   [0]      Length Indicator (LI) — byte count after this byte
        //   [1]      TPDU code (must be 0xD0 = CC)
        //   [2..3]   DST-REF (BE)
        //   [4..5]   SRC-REF (BE)
        //   [6]      Class / Options
        //   [7..]    Variable part (RDP Negotiation Response if present)
        if (remaining < 7) {
          throw new Error(`Response too short for X.224 CC: ${remaining} bytes`);
        }

        const x224LI   = responseData[0];  // Length Indicator
        const x224Code = responseData[1];  // TPDU code

        if (x224Code !== 0xD0) {
          throw new Error(
            `Unexpected X.224 TPDU code: 0x${x224Code.toString(16)} (expected 0xD0 = Connection Confirm)`
          );
        }

        // --- Step 3: Parse RDP Negotiation Response ---
        // Fixed CC part (from byte 1 through 6) = 6 bytes, so LI >= 6.
        // Variable part starts at offset 7 (after the LI byte + 6 fixed bytes).
        const negOffset = 7;
        let selectedProtocol = PROTOCOL_RDP;
        let serverFlags = 0;
        let failureCode: number | undefined;
        let failureMessage: string | undefined;
        let hasNegotiation = false;
        let negotiationType = 0;

        // LI > 6 means variable part is present (LI covers bytes [1..LI] = 6 fixed + extra)
        if (x224LI > 6 && remaining >= negOffset + 8) {
          hasNegotiation = true;
          negotiationType = responseData[negOffset];      // 0x02 = NEG_RSP, 0x03 = NEG_FAILURE
          serverFlags     = responseData[negOffset + 1];  // flags byte

          if (negotiationType === TYPE_RDP_NEG_RSP) {
            // selectedProtocol: uint32 LE at negOffset+4
            selectedProtocol = new DataView(
              responseData.buffer, responseData.byteOffset + negOffset + 4
            ).getUint32(0, true);
          } else if (negotiationType === TYPE_RDP_NEG_FAILURE) {
            failureCode = new DataView(
              responseData.buffer, responseData.byteOffset + negOffset + 4
            ).getUint32(0, true);
            failureMessage = FAILURE_CODES[failureCode] ??
              `Unknown failure code (0x${failureCode.toString(16)})`;
          }
        }

        // Derive a human-readable RDP version string
        let rdpVersion: string;
        if (selectedProtocol & PROTOCOL_HYBRID) {
          rdpVersion = 'RDP 6.0+ (NLA/CredSSP)';
        } else if (selectedProtocol & PROTOCOL_SSL) {
          rdpVersion = 'RDP 5.2+ (TLS)';
        } else {
          rdpVersion = 'RDP 5.x (Standard RDP Security)';
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const result: RDPNegotiateResult = {
          success: true,
          selectedProtocol,
          protocolName: getSelectedProtocolName(selectedProtocol),
          serverFlags,
          rdpVersion,
          latencyMs,
          raw: Array.from(rawAll),
        };

        if (!hasNegotiation) {
          result.note = 'Server responded without RDP Negotiation Response — likely Standard RDP Security only';
        }
        if (failureCode !== undefined) result.failureCode = failureCode;
        if (failureMessage !== undefined) result.failureMessage = failureMessage;

        return result;
      } catch (err) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([negotiatePromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
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

/**
 * Handle RDP connection test.
 * Sends X.224 Connection Request and parses the negotiation response.
 *
 * POST /api/rdp/connect
 * Body: { host, port=3389, timeout=10000 }
 */
export async function handleRDPConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 3389, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Request all protocols for maximum detection coverage
        const requestedProtocols = PROTOCOL_SSL | PROTOCOL_HYBRID | PROTOCOL_RDSTLS;
        await writer.write(buildConnectionRequest(requestedProtocols));

        // Read TPKT header (4 bytes)
        const tpktHeader = await readExact(reader, 4);
        const tpktVersion = tpktHeader[0];
        const tpktLength = new DataView(tpktHeader.buffer).getUint16(2, false);

        if (tpktVersion !== 3) {
          throw new Error(`Invalid TPKT version: ${tpktVersion} (expected 3)`);
        }

        // Read the rest of the packet
        const remaining = tpktLength - 4;
        const responseData = await readExact(reader, remaining);

        const rtt = Date.now() - startTime;

        // Parse X.224 header
        const x224Length = responseData[0];
        const x224Type = responseData[1];

        // Connection Confirm = 0xD0
        if (x224Type !== 0xD0) {
          throw new Error(`Unexpected X.224 type: 0x${x224Type.toString(16)} (expected 0xD0 Connection Confirm)`);
        }

        // Parse RDP Negotiation Response (if present)
        let selectedProtocol = PROTOCOL_RDP;
        let negotiationType = 0;
        let negotiationFlags = 0;
        let failureCode = 0;
        let failureMessage = '';
        let hasNegotiation = false;

        const negOffset = x224Length; // negotiation starts after x224 header
        if (remaining > negOffset) {
          hasNegotiation = true;
          negotiationType = responseData[negOffset];
          negotiationFlags = responseData[negOffset + 1];

          if (negotiationType === TYPE_RDP_NEG_RSP) {
            selectedProtocol = new DataView(
              responseData.buffer, responseData.byteOffset + negOffset + 4
            ).getUint32(0, true);
          } else if (negotiationType === TYPE_RDP_NEG_FAILURE) {
            failureCode = new DataView(
              responseData.buffer, responseData.byteOffset + negOffset + 4
            ).getUint32(0, true);
            failureMessage = FAILURE_CODES[failureCode] || `Unknown failure (${failureCode})`;
          }
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const nlaRequired = (negotiationFlags & 0x02) !== 0;

        return {
          success: true,
          host,
          port,
          connectTime,
          rtt,
          tpktVersion,
          x224Type: '0xD0 (Connection Confirm)',
          hasNegotiation,
          selectedProtocol,
          selectedProtocolNames: getProtocolNames(selectedProtocol),
          negotiationFlags,
          nlaRequired,
          failureCode: failureCode || undefined,
          failureMessage: failureMessage || undefined,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([connectionPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
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

// ── RDP NLA Probe helpers ──────────────────────────────────────────────────

/** DER-encode a length value. */
function rdpDerLen(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  if (n < 0x100) return new Uint8Array([0x81, n]);
  return new Uint8Array([0x82, (n >> 8) & 0xff, n & 0xff]);
}

/** Concatenate Uint8Arrays. */
function rdpConcat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

/**
 * Build an NTLM NEGOTIATE_MESSAGE (Type 1).
 * 32 bytes: Signature + MessageType + NegotiateFlags + DomainNameFields + WorkstationFields.
 */
function buildNTLMNegotiate(): Uint8Array {
  const msg = new Uint8Array(32);
  // Signature "NTLMSSP\0"
  msg.set([0x4e, 0x54, 0x4c, 0x4d, 0x53, 0x53, 0x50, 0x00], 0);
  // MessageType = 1 (LE)
  msg.set([0x01, 0x00, 0x00, 0x00], 8);
  // NegotiateFlags: UNICODE | OEM | REQUEST_TARGET | NTLM | EXTENDED_SESSIONSECURITY (LE 0x60088215)
  msg.set([0x15, 0x82, 0x08, 0x60], 12);
  // DomainNameFields: Len=0, MaxLen=0, Offset=32 (LE)
  new DataView(msg.buffer).setUint32(20, 32, true);
  // WorkstationFields: Len=0, MaxLen=0, Offset=32 (LE)
  new DataView(msg.buffer).setUint32(28, 32, true);
  return msg;
}

/**
 * Wrap an NTLM token in a CredSSP TSRequest v6 (DER/BER).
 * TSRequest ::= SEQUENCE { version [0] INTEGER, negoTokens [1] SEQUENCE OF NegoData }
 */
function buildCredSSPRequest(ntlmToken: Uint8Array): Uint8Array {
  // OCTET STRING containing NTLM token
  const octet = rdpConcat(new Uint8Array([0x04]), rdpDerLen(ntlmToken.length), ntlmToken);
  // [0] EXPLICIT negoToken
  const tagged0 = rdpConcat(new Uint8Array([0xa0]), rdpDerLen(octet.length), octet);
  // NegoData SEQUENCE
  const negoData = rdpConcat(new Uint8Array([0x30]), rdpDerLen(tagged0.length), tagged0);
  // SEQUENCE OF NegoData
  const seqOf = rdpConcat(new Uint8Array([0x30]), rdpDerLen(negoData.length), negoData);
  // [1] EXPLICIT negoTokens
  const negoTokens = rdpConcat(new Uint8Array([0xa1]), rdpDerLen(seqOf.length), seqOf);
  // [0] EXPLICIT version = INTEGER 6
  const version = new Uint8Array([0xa0, 0x03, 0x02, 0x01, 0x06]);
  // Outer TSRequest SEQUENCE
  const inner = rdpConcat(version, negoTokens);
  return rdpConcat(new Uint8Array([0x30]), rdpDerLen(inner.length), inner);
}

/**
 * Parse an NTLM CHALLENGE_MESSAGE (Type 2) from raw bytes.
 * Scans for the NTLMSSP\0 signature, then extracts the server challenge and
 * TargetInfo AV pairs (NetBIOS/DNS computer name, NetBIOS/DNS domain name).
 */
function parseNTLMChallenge(data: Uint8Array): {
  serverChallenge: string;
  targetName?: string;
  nbComputerName?: string;
  nbDomainName?: string;
  dnsComputerName?: string;
  dnsDomainName?: string;
  ntlmFlags: number;
} | null {
  const SIG = [0x4e, 0x54, 0x4c, 0x4d, 0x53, 0x53, 0x50, 0x00];
  let start = -1;
  for (let i = 0; i <= data.length - SIG.length; i++) {
    if (SIG.every((b, j) => data[i + j] === b)) { start = i; break; }
  }
  if (start < 0 || data.length - start < 48) return null;

  const d = data.slice(start);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (dv.getUint32(8, true) !== 2) return null; // not Type 2

  const targetNameLen    = dv.getUint16(12, true);
  const targetNameOffset = dv.getUint32(16, true);
  const ntlmFlags        = dv.getUint32(20, true);
  // ServerChallenge: 8 bytes at offset 24
  const challenge = Array.from(d.slice(24, 32))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  let tiLen = 0, tiOffset = 0;
  if (d.length >= 48) {
    tiLen    = dv.getUint16(40, true);
    tiOffset = dv.getUint32(44, true);
  }

  const dec16 = new TextDecoder('utf-16le');
  let targetName: string | undefined;
  if (targetNameLen > 0 && targetNameOffset + targetNameLen <= d.length) {
    targetName = dec16.decode(d.slice(targetNameOffset, targetNameOffset + targetNameLen));
  }

  const avPairs: Record<string, string> = {};
  if (tiLen > 0 && tiOffset + tiLen <= d.length) {
    let pos = tiOffset;
    const end = tiOffset + tiLen;
    while (pos + 4 <= end) {
      const avId  = dv.getUint16(pos, true);
      const avLen = dv.getUint16(pos + 2, true);
      pos += 4;
      if (avId === 0) break; // MsvAvEOL
      if (pos + avLen > d.length) break;
      const val = dec16.decode(d.slice(pos, pos + avLen));
      switch (avId) {
        case 1: avPairs.nbComputerName  = val; break;
        case 2: avPairs.nbDomainName    = val; break;
        case 3: avPairs.dnsComputerName = val; break;
        case 4: avPairs.dnsDomainName   = val; break;
      }
      pos += avLen;
    }
  }

  return { serverChallenge: challenge, targetName, ntlmFlags, ...avPairs };
}

/**
 * RDP NLA probe: X.224 negotiation → TLS upgrade → CredSSP + NTLM Type 1 →
 * parse NTLM Type 2 Challenge to extract Windows server identity.
 *
 * This reveals the server's NetBIOS computer name, domain, and DNS names from
 * the NTLM challenge without needing valid credentials.
 *
 * POST /api/rdp/nla-probe
 * Body: { host, port=3389, timeout=12000 }
 * Returns: {
 *   tlsUpgraded, selectedProtocol, protocolName,
 *   ntlmChallenge: { serverChallenge, nbComputerName, nbDomainName,
 *                    dnsComputerName, dnsDomainName, ntlmFlags }
 * }
 */
export async function handleRDPNLAProbe(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 3389, timeout = 12000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const tp = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const probePromise = (async () => {
      const socket = connect(`${host}:${port}`, { secureTransport: 'starttls', allowHalfOpen: false });
      await Promise.race([socket.opened, tp]);

      let reader = socket.readable.getReader();
      let writer = socket.writable.getWriter();

      try {
        // Step 1: X.224 CR requesting NLA (CredSSP/HYBRID)
        await writer.write(buildConnectionRequest(PROTOCOL_HYBRID));

        // Step 2: Read X.224 CC
        const tpktHdr = await readExact(reader, 4);
        if (tpktHdr[0] !== 0x03) throw new Error('Not an RDP server (bad TPKT version)');
        const tpktLen = new DataView(tpktHdr.buffer).getUint16(2, false);
        const rest    = await readExact(reader, tpktLen - 4);
        const x224LatencyMs = Date.now() - start;

        if (rest[1] !== 0xD0) {
          throw new Error(`Expected X.224 CC (0xD0), got 0x${rest[1].toString(16)}`);
        }

        // Parse selected protocol from Negotiation Response
        let selectedProtocol = 0;
        const x224LI = rest[0];
        if (x224LI > 6 && rest.length >= 15) {
          const negType = rest[7];
          if (negType === TYPE_RDP_NEG_RSP) {
            selectedProtocol = new DataView(rest.buffer, rest.byteOffset + 11, 4).getUint32(0, true);
          }
        }

        const isNLA = (selectedProtocol & PROTOCOL_HYBRID) !== 0;
        const isTLS = (selectedProtocol & PROTOCOL_SSL) !== 0;

        // Step 3: TLS upgrade
        reader.releaseLock();
        writer.releaseLock();

        if (!isNLA && !isTLS) {
          try { socket.close(); } catch { /* ignore */ }
          return {
            success: true,
            selectedProtocol,
            protocolName: getSelectedProtocolName(selectedProtocol),
            tlsUpgraded: false,
            nlaProbed: false,
            note: 'Server selected Standard RDP Security — TLS/NLA not available',
            x224LatencyMs,
            latencyMs: Date.now() - start,
          };
        }

        const tlsSocket = socket.startTls();
        reader = tlsSocket.readable.getReader();
        writer = tlsSocket.writable.getWriter();

        if (!isNLA) {
          // TLS only — no CredSSP, report TLS upgrade success
          reader.releaseLock();
          writer.releaseLock();
          try { tlsSocket.close(); } catch { /* ignore */ }
          return {
            success: true,
            selectedProtocol,
            protocolName: getSelectedProtocolName(selectedProtocol),
            tlsUpgraded: true,
            nlaProbed: false,
            note: 'TLS upgraded (server selected TLS, not NLA — NTLM challenge not available)',
            x224LatencyMs,
            latencyMs: Date.now() - start,
          };
        }

        // Step 4: CredSSP + NTLM Type 1 NEGOTIATE
        const tsReq = buildCredSSPRequest(buildNTLMNegotiate());
        await writer.write(tsReq);

        // Step 5: Read CredSSP TSRequest response containing NTLM Type 2
        const chunks: Uint8Array[] = [];
        let totalRead = 0;
        const deadline = Date.now() + 6000;
        while (Date.now() < deadline && totalRead < 4096) {
          const { value, done } = await Promise.race([
            reader.read(),
            new Promise<{ value: undefined; done: true }>(res =>
              setTimeout(() => res({ value: undefined, done: true }), Math.max(100, deadline - Date.now()))),
          ]);
          if (done || !value) break;
          chunks.push(value);
          totalRead += value.length;
          if (totalRead >= 512) break; // NTLM challenge is always < 512 bytes
        }

        reader.releaseLock();
        writer.releaseLock();
        try { tlsSocket.close(); } catch { /* ignore */ }

        if (totalRead === 0) {
          return {
            success: true,
            selectedProtocol,
            protocolName: getSelectedProtocolName(selectedProtocol),
            tlsUpgraded: true,
            nlaProbed: true,
            note: 'TLS+NLA established but server sent no CredSSP response',
            x224LatencyMs,
            latencyMs: Date.now() - start,
          };
        }

        const respBuf = new Uint8Array(totalRead);
        let off = 0;
        for (const c of chunks) { respBuf.set(c, off); off += c.length; }

        const ntlmChallenge = parseNTLMChallenge(respBuf);
        return {
          success: true,
          selectedProtocol,
          protocolName: getSelectedProtocolName(selectedProtocol),
          tlsUpgraded: true,
          nlaProbed: true,
          ntlmChallenge: ntlmChallenge ?? undefined,
          note: ntlmChallenge
            ? 'NLA probe successful — extracted Windows server identity via NTLM challenge'
            : 'TLS+CredSSP exchange completed but NTLM challenge not parsed from response',
          x224LatencyMs,
          latencyMs: Date.now() - start,
        };
      } catch (err) {
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([probePromise, tp]);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      latencyMs: Date.now() - start,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
