/**
 * OpenVPN Protocol Implementation
 *
 * SSL/TLS VPN protocol for secure point-to-point connections.
 * Port 1194 (TCP mode, with 2-byte length prefix framing).
 *
 * Endpoints implemented:
 * - Handshake — Send P_CONTROL_HARD_RESET_CLIENT_V2, detect server response
 *
 * In TCP mode, each OpenVPN packet is prefixed with a 2-byte big-endian length.
 * The packet itself starts with an opcode byte:
 *   High 5 bits: Opcode (message type)
 *   Low 3 bits: Key ID
 *
 * Followed by an 8-byte session ID and message-specific payload.
 *
 * Use Cases:
 * - OpenVPN server detection and fingerprinting
 * - VPN infrastructure health checking
 * - Protocol version identification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface OpenVPNRequest {
  host: string;
  port?: number;
  timeout?: number;
}

// OpenVPN opcodes (high 5 bits of first byte)
const OPCODES: Record<number, string> = {
  0x01: 'P_CONTROL_HARD_RESET_CLIENT_V1',
  0x02: 'P_CONTROL_HARD_RESET_SERVER_V1',
  0x03: 'P_CONTROL_SOFT_RESET_V1',
  0x04: 'P_CONTROL_V1',
  0x05: 'P_ACK_V1',
  0x06: 'P_DATA_V1',
  0x07: 'P_CONTROL_HARD_RESET_CLIENT_V2',
  0x08: 'P_CONTROL_HARD_RESET_SERVER_V2',
  0x09: 'P_DATA_V2',
  0x0a: 'P_CONTROL_HARD_RESET_CLIENT_V3',
  0x0b: 'P_CONTROL_WKC_V1',
};

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build an OpenVPN TCP Client Hello packet (P_CONTROL_HARD_RESET_CLIENT_V2)
 *
 * TCP framing: 2-byte big-endian length prefix + OpenVPN packet
 * OpenVPN packet:
 *   Byte 0: Opcode (0x07 << 3) | KeyID (0x00) = 0x38
 *   Bytes 1-8: Session ID (8 bytes, random)
 *   Byte 9: HMAC/ACK array length = 0 (no prior messages to ACK)
 *   Bytes 10-13: Packet ID (4 bytes, big-endian, starts at 0)
 */
function buildClientHello(): { packet: Uint8Array; sessionId: Uint8Array } {
  const sessionId = new Uint8Array(8);
  crypto.getRandomValues(sessionId);

  // OpenVPN payload (without TCP length prefix)
  const payload = new Uint8Array(14);

  // Opcode: P_CONTROL_HARD_RESET_CLIENT_V2 (0x07) << 3 | KeyID 0 = 0x38
  payload[0] = 0x38;

  // Session ID (8 bytes)
  payload.set(sessionId, 1);

  // Message Packet ID ACK array length = 0
  payload[9] = 0x00;

  // Packet ID = 0 (4 bytes big-endian)
  payload[10] = 0x00;
  payload[11] = 0x00;
  payload[12] = 0x00;
  payload[13] = 0x00;

  // TCP framing: 2-byte length prefix
  const tcpPacket = new Uint8Array(2 + payload.length);
  tcpPacket[0] = (payload.length >> 8) & 0xff;
  tcpPacket[1] = payload.length & 0xff;
  tcpPacket.set(payload, 2);

  return { packet: tcpPacket, sessionId };
}

/**
 * Parse an OpenVPN TCP response
 */
function parseResponse(data: Uint8Array): {
  opcode: number;
  opcodeName: string;
  keyId: number;
  sessionId: string;
  ackCount: number;
  remoteSessionId?: string;
  packetId?: number;
} | null {
  if (data.length < 2) return null;

  // TCP framing: read 2-byte length prefix
  const packetLen = (data[0] << 8) | data[1];
  if (data.length < 2 + packetLen || packetLen < 10) return null;

  const payload = data.slice(2, 2 + packetLen);

  // Parse opcode and key ID
  const opcode = (payload[0] >> 3) & 0x1f;
  const keyId = payload[0] & 0x07;
  const opcodeName = OPCODES[opcode] || `UNKNOWN_0x${opcode.toString(16)}`;

  // Session ID (8 bytes)
  const sessionId = bytesToHex(payload.slice(1, 9));

  // ACK array
  const ackCount = payload[9] || 0;
  if (10 + ackCount * 4 + (ackCount > 0 ? 8 : 0) + 4 > payload.length) return null;

  let offset = 10 + (ackCount * 4); // Skip ACK packet IDs

  // If there are ACKs, there's a remote session ID after them
  let remoteSessionId: string | undefined;
  if (ackCount > 0 && offset + 8 <= payload.length) {
    remoteSessionId = bytesToHex(payload.slice(offset, offset + 8));
    offset += 8;
  }

  // Packet ID (4 bytes, if present)
  let packetId: number | undefined;
  if (offset + 4 <= payload.length) {
    packetId = (payload[offset] << 24) | (payload[offset + 1] << 16) |
               (payload[offset + 2] << 8) | payload[offset + 3];
  }

  return { opcode, opcodeName, keyId, sessionId, ackCount, remoteSessionId, packetId };
}

/**
 * Handle OpenVPN Handshake — Send Client Hello, read Server Hello
 */
export async function handleOpenVPNHandshake(request: Request): Promise<Response> {
  try {
    const body = await request.json() as OpenVPNRequest;
    const { host, port = 1194, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if behind Cloudflare
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const handshakePromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Build and send Client Hello
        const { packet, sessionId } = buildClientHello();
        await writer.write(packet);

        // Read Server Response
        let responseData = new Uint8Array(0);
        const readTimeout = setTimeout(() => {}, timeout);

        // Read until we have enough for a TCP-framed OpenVPN response
        while (responseData.length < 16) {
          const { value, done } = await reader.read();
          if (done) break;
          const newData = new Uint8Array(responseData.length + value.length);
          newData.set(responseData);
          newData.set(value, responseData.length);
          responseData = newData;

          // Check if we have enough based on TCP length prefix
          if (responseData.length >= 2) {
            const expectedLen = (responseData[0] << 8) | responseData[1];
            if (responseData.length >= 2 + expectedLen) break;
          }

          if (responseData.length > 4096) break;
        }

        clearTimeout(readTimeout);
        const rtt = Date.now() - startTime;
        await socket.close();

        if (responseData.length < 12) {
          return {
            success: false,
            host,
            port,
            rtt,
            isOpenVPN: false,
            error: `Incomplete response: received ${responseData.length} bytes`,
          };
        }

        const parsed = parseResponse(responseData);

        if (!parsed) {
          return {
            success: false,
            host,
            port,
            rtt,
            isOpenVPN: false,
            error: 'Failed to parse OpenVPN response',
            rawHex: bytesToHex(responseData.slice(0, Math.min(64, responseData.length))),
          };
        }

        // Check for expected Server Hello response
        const isServerHello = parsed.opcode === 0x08; // P_CONTROL_HARD_RESET_SERVER_V2
        const isServerHelloV1 = parsed.opcode === 0x02; // V1

        return {
          success: isServerHello || isServerHelloV1,
          host,
          port,
          rtt,
          isOpenVPN: true,
          opcode: parsed.opcodeName,
          keyId: parsed.keyId,
          serverSessionId: parsed.sessionId,
          clientSessionId: bytesToHex(sessionId),
          ackCount: parsed.ackCount,
          remoteSessionId: parsed.remoteSessionId,
          packetId: parsed.packetId,
          protocolVersion: isServerHello ? 2 : (isServerHelloV1 ? 1 : undefined),
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([handshakePromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Connection timeout') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Connection timeout',
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Build a minimal TLS 1.2 ClientHello record.
 * Targets common OpenVPN cipher suites (ECDHE-RSA-AES, RSA-AES).
 */
function buildTLSClientHello(): Uint8Array {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);

  // Cipher suites: ECDHE-RSA-AES-128-GCM, ECDHE-RSA-AES-256-GCM,
  //               ECDHE-RSA-AES-256-CBC-SHA, RSA-AES-256-CBC-SHA, RSA-AES-128-CBC-SHA
  const ciphers = new Uint8Array([
    0xC0, 0x2F, // TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
    0xC0, 0x30, // TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
    0xC0, 0x14, // TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA
    0x00, 0x35, // TLS_RSA_WITH_AES_256_CBC_SHA
    0x00, 0x2F, // TLS_RSA_WITH_AES_128_CBC_SHA
    0x00, 0xFF, // TLS_EMPTY_RENEGOTIATION_INFO_SCSV
  ]);

  // ClientHello body: version(2) + random(32) + session_id_len(1) + ciphers_len(2)
  //                   + ciphers + compression_len(1) + compression(1)
  const helloBody = new Uint8Array(2 + 32 + 1 + 2 + ciphers.length + 1 + 1);
  let pos = 0;
  helloBody[pos++] = 0x03; helloBody[pos++] = 0x03; // TLS 1.2
  helloBody.set(random, pos); pos += 32;
  helloBody[pos++] = 0x00; // session_id length = 0
  helloBody[pos++] = 0x00; helloBody[pos++] = ciphers.length; // cipher_suites length
  helloBody.set(ciphers, pos); pos += ciphers.length;
  helloBody[pos++] = 0x01; // compression methods length = 1
  helloBody[pos] = 0x00; // null compression

  // Handshake header: type=ClientHello(1) + length(3)
  const hsLen = helloBody.length;
  const hs = new Uint8Array(4 + hsLen);
  hs[0] = 0x01; // ClientHello
  hs[1] = (hsLen >> 16) & 0xFF;
  hs[2] = (hsLen >> 8) & 0xFF;
  hs[3] = hsLen & 0xFF;
  hs.set(helloBody, 4);

  // TLS record: ContentType=Handshake(22) + version=TLS1.0(0x0301) + length
  const recLen = hs.length;
  const rec = new Uint8Array(5 + recLen);
  rec[0] = 0x16; // Handshake
  rec[1] = 0x03; rec[2] = 0x01; // TLS 1.0 (legacy record version)
  rec[3] = (recLen >> 8) & 0xFF;
  rec[4] = recLen & 0xFF;
  rec.set(hs, 5);
  return rec;
}


/**
 * Build an OpenVPN P_CONTROL_V1 packet wrapping TLS data (TCP-framed).
 * Includes an ACK for the remote's packet_id.
 */
function buildControlV1(
  ourSessionId: Uint8Array,
  ourPacketId: number,
  ackPacketId: number,
  remoteSessionId: Uint8Array,
  tlsData: Uint8Array,
): Uint8Array {
  // payload: opcode(1)+session_id(8)+ack_count(1)+ack_id(4)+remote_session_id(8)+packet_id(4)+tls_data
  const hdrLen = 1 + 8 + 1 + 4 + 8 + 4;
  const payload = new Uint8Array(hdrLen + tlsData.length);
  let pos = 0;
  payload[pos++] = (0x04 << 3) | 0x00; // P_CONTROL_V1, key_id=0
  payload.set(ourSessionId, pos); pos += 8;
  payload[pos++] = 0x01; // ack count = 1
  payload[pos++] = (ackPacketId >> 24) & 0xFF;
  payload[pos++] = (ackPacketId >> 16) & 0xFF;
  payload[pos++] = (ackPacketId >> 8) & 0xFF;
  payload[pos++] = ackPacketId & 0xFF;
  payload.set(remoteSessionId, pos); pos += 8;
  payload[pos++] = (ourPacketId >> 24) & 0xFF;
  payload[pos++] = (ourPacketId >> 16) & 0xFF;
  payload[pos++] = (ourPacketId >> 8) & 0xFF;
  payload[pos++] = ourPacketId & 0xFF;
  payload.set(tlsData, pos);

  const tcpPacket = new Uint8Array(2 + payload.length);
  tcpPacket[0] = (payload.length >> 8) & 0xFF;
  tcpPacket[1] = payload.length & 0xFF;
  tcpPacket.set(payload, 2);
  return tcpPacket;
}

/**
 * Extract TLS data from a P_CONTROL_V1 or P_ACK_V1 OpenVPN payload.
 * Returns the raw TLS bytes after stripping the OpenVPN envelope.
 */
function extractTLSData(payload: Uint8Array): Uint8Array | null {
  if (payload.length < 10) return null;
  const opcode = (payload[0] >> 3) & 0x1F;
  if (opcode !== 0x04) return null; // Only P_CONTROL_V1
  let pos = 1 + 8; // skip opcode + session_id
  const ackCount = payload[pos++];
  if (pos + ackCount * 4 + (ackCount > 0 ? 8 : 0) + 4 > payload.length) return null;
  pos += ackCount * 4; // skip ack IDs
  if (ackCount > 0) pos += 8; // skip remote session ID
  pos += 4; // skip packet_id
  if (pos >= payload.length) return null;
  return payload.slice(pos);
}

/**
 * Parse a TLS ServerHello to extract the negotiated cipher suite and TLS version.
 */
function parseTLSServerHello(tlsData: Uint8Array): {
  version?: string;
  cipherSuite?: string;
  hasCertificate: boolean;
} {
  const cipherNames: Record<number, string> = {
    0xC02B: 'ECDHE-ECDSA-AES128-GCM-SHA256',
    0xC02C: 'ECDHE-ECDSA-AES256-GCM-SHA384',
    0xC02F: 'ECDHE-RSA-AES128-GCM-SHA256',
    0xC030: 'ECDHE-RSA-AES256-GCM-SHA384',
    0xC014: 'ECDHE-RSA-AES256-CBC-SHA',
    0x0035: 'RSA-AES256-CBC-SHA',
    0x002F: 'RSA-AES128-CBC-SHA',
    0xCCA8: 'ECDHE-RSA-CHACHA20-POLY1305',
    0x1301: 'TLS_AES_128_GCM_SHA256',
    0x1302: 'TLS_AES_256_GCM_SHA384',
    0x1303: 'TLS_CHACHA20_POLY1305_SHA256',
  };
  const result = { version: undefined as string | undefined, cipherSuite: undefined as string | undefined, hasCertificate: false };
  let pos = 0;

  // Scan TLS records
  while (pos + 5 <= tlsData.length) {
    const contentType = tlsData[pos];
    const recVer = (tlsData[pos + 1] << 8) | tlsData[pos + 2];
    const recLen = (tlsData[pos + 3] << 8) | tlsData[pos + 4];
    pos += 5;
    if (contentType !== 0x16 || pos + recLen > tlsData.length) { pos += recLen; continue; }

    // Parse handshake messages inside this record
    let hpos = pos;
    while (hpos + 4 <= pos + recLen) {
      const hsType = tlsData[hpos];
      const hsLen = (tlsData[hpos + 1] << 16) | (tlsData[hpos + 2] << 8) | tlsData[hpos + 3];
      hpos += 4;
      if (hsType === 0x02 && hsLen >= 38) {
        // ServerHello
        const major = tlsData[hpos]; const minor = tlsData[hpos + 1];
        if (major === 3 && minor === 3) result.version = 'TLS 1.2';
        else if (major === 3 && minor === 4) result.version = 'TLS 1.3';
        else if (major === 3 && minor === 2) result.version = 'TLS 1.1';
        else if (minor === 1) result.version = 'TLS 1.0';
        else result.version = `${recVer.toString(16)}`;
        const sessionIdLen = tlsData[hpos + 34];
        const cipherOff = hpos + 35 + sessionIdLen;
        if (cipherOff + 2 <= pos + recLen) {
          const suite = (tlsData[cipherOff] << 8) | tlsData[cipherOff + 1];
          result.cipherSuite = cipherNames[suite] ?? `0x${suite.toString(16).padStart(4, '0')}`;
        }
      } else if (hsType === 0x0B) {
        // Certificate
        result.hasCertificate = true;
      }
      hpos += hsLen;
    }
    pos += recLen;
  }
  return result;
}

/**
 * POST {host, port?, timeout?}
 *
 * Performs a full OpenVPN TCP control channel handshake with TLS initiation:
 * 1. P_CONTROL_HARD_RESET_CLIENT_V2 → P_CONTROL_HARD_RESET_SERVER_V2
 * 2. P_CONTROL_V1 wrapping TLS ClientHello (ACKing server's reset)
 * 3. Read P_CONTROL_V1 packets containing TLS ServerHello + Certificate
 * 4. Report negotiated TLS version, cipher suite, and cert presence
 *
 * This verifies that the server is a real OpenVPN server and reveals its TLS capabilities.
 */
export async function handleOpenVPNTLSHandshake(request: Request): Promise<Response> {
  try {
    const body = await request.json() as OpenVPNRequest;
    const { host, port = 1194, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const work = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      const readPacket = async (deadlineMs: number): Promise<Uint8Array | null> => {
        const remaining = deadlineMs - Date.now();
        if (remaining <= 0) return null;
        let buf = new Uint8Array(0);
        while (Date.now() < deadlineMs) {
          const rem2 = deadlineMs - Date.now();
          const { value, done } = await Promise.race([
            reader.read(),
            new Promise<{ value?: Uint8Array; done: boolean }>(resolve =>
              setTimeout(() => resolve({ value: undefined, done: true }), rem2)),
          ]);
          if (done || !value) break;
          const nb = new Uint8Array(buf.length + value.length);
          nb.set(buf); nb.set(value, buf.length); buf = nb;
          if (buf.length >= 2) {
            const expected = (buf[0] << 8) | buf[1];
            if (buf.length >= 2 + expected) return buf;
          }
          if (buf.length > 65536) break;
        }
        return buf.length > 0 ? buf : null;
      };

      try {
        // Step 1: HARD_RESET
        const { packet: resetPkt, sessionId: ourSessionId } = buildClientHello();
        await writer.write(resetPkt);

        const resetResp = await readPacket(Date.now() + 8000);
        if (!resetResp) throw new Error('No response to HARD_RESET');

        const parsed = parseResponse(resetResp);
        if (!parsed) throw new Error('Invalid OpenVPN response to HARD_RESET');

        const isServerReset = parsed.opcode === 0x08 || parsed.opcode === 0x02;
        if (!isServerReset) throw new Error(`Expected HARD_RESET_SERVER, got ${parsed.opcodeName}`);

        const serverSessionIdHex = parsed.sessionId;
        const serverSessionIdBytes = new Uint8Array(8);
        for (let i = 0; i < 8; i++) {
          serverSessionIdBytes[i] = parseInt(serverSessionIdHex.slice(i * 2, i * 2 + 2), 16);
        }
        const serverPacketId = parsed.packetId ?? 0;

        // Step 2: P_CONTROL_V1 with TLS ClientHello (includes embedded ACK for server's HARD_RESET)
        const tlsHello = buildTLSClientHello();
        const controlPkt = buildControlV1(ourSessionId, 1, serverPacketId, serverSessionIdBytes, tlsHello);
        await writer.write(controlPkt);

        // Step 3: Read server's TLS response packets
        let tlsDataBuf = new Uint8Array(0);
        const deadline = Date.now() + 8000;
        let packetsReceived = 0;

        while (Date.now() < deadline && packetsReceived < 10) {
          const pkt = await readPacket(deadline);
          if (!pkt || pkt.length < 4) break;
          const pktLen = (pkt[0] << 8) | pkt[1];
          if (pkt.length < 2 + pktLen) break;
          const payload = pkt.slice(2, 2 + pktLen);
          const tlsChunk = extractTLSData(payload);
          if (tlsChunk && tlsChunk.length > 0) {
            const merged = new Uint8Array(tlsDataBuf.length + tlsChunk.length);
            merged.set(tlsDataBuf); merged.set(tlsChunk, tlsDataBuf.length);
            tlsDataBuf = merged;
          }
          packetsReceived++;
          // Stop once we have enough to parse ServerHello + Certificate
          if (tlsDataBuf.length > 1024) break;
        }

        writer.releaseLock();
        reader.releaseLock();
        try { socket.close(); } catch { /* ignore */ }

        const tlsInfo = tlsDataBuf.length > 0 ? parseTLSServerHello(tlsDataBuf) : null;
        const rtt = Date.now() - startTime;

        return {
          success: true,
          host, port, rtt,
          isOpenVPN: true,
          protocolVersion: parsed.opcode === 0x08 ? 2 : 1,
          serverSessionId: serverSessionIdHex,
          clientSessionId: bytesToHex(ourSessionId),
          tlsHandshakeStarted: tlsDataBuf.length > 0,
          tlsBytesReceived: tlsDataBuf.length,
          tlsVersion: tlsInfo?.version,
          negotiatedCipher: tlsInfo?.cipherSuite,
          serverCertificatePresent: tlsInfo?.hasCertificate ?? false,
        };

      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([work, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
