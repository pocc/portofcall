/**
 * SMPP (Short Message Peer-to-Peer) Protocol Support for Cloudflare Workers
 * Implements SMPP v3.4 Bind Transceiver for SMS gateway connectivity testing
 *
 * SMPP is the standard protocol used by the telecom industry to exchange
 * SMS messages between Short Message Service Centers (SMSCs) and External
 * Short Messaging Entities (ESMEs) like SMS gateways and aggregators.
 *
 * Connection flow:
 * 1. Client connects to SMPP server (typically port 2775)
 * 2. Client sends bind_transceiver PDU with system_id and password
 * 3. Server responds with bind_transceiver_resp containing status and system_id
 * 4. Client sends unbind PDU to cleanly disconnect
 *
 * PDU Header (16 bytes):
 *   [0-3]   command_length (uint32, big-endian) - total PDU size
 *   [4-7]   command_id (uint32, big-endian) - PDU type identifier
 *   [8-11]  command_status (uint32, big-endian) - error code (0 = success)
 *   [12-15] sequence_number (uint32, big-endian) - request/response correlation
 *
 * Spec: SMPP v3.4 (Short Message Peer-to-Peer Protocol Specification)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// SMPP Command IDs
const BIND_RECEIVER       = 0x00000001;
const BIND_RECEIVER_RESP  = 0x80000001;
const BIND_TRANSMITTER      = 0x00000002;
const BIND_TRANSMITTER_RESP = 0x80000002;
const BIND_TRANSCEIVER      = 0x00000009;
const BIND_TRANSCEIVER_RESP = 0x80000009;
const UNBIND              = 0x00000006;
const UNBIND_RESP         = 0x80000006;
const GENERIC_NACK        = 0x80000000;
const ENQUIRE_LINK        = 0x00000015;
const ENQUIRE_LINK_RESP   = 0x80000015;

// SMPP Interface Versions
const SMPP_V33 = 0x33;
const SMPP_V34 = 0x34;
const SMPP_V50 = 0x50;

function getCommandName(id: number): string {
  switch (id) {
    case BIND_RECEIVER: return 'bind_receiver';
    case BIND_RECEIVER_RESP: return 'bind_receiver_resp';
    case BIND_TRANSMITTER: return 'bind_transmitter';
    case BIND_TRANSMITTER_RESP: return 'bind_transmitter_resp';
    case BIND_TRANSCEIVER: return 'bind_transceiver';
    case BIND_TRANSCEIVER_RESP: return 'bind_transceiver_resp';
    case UNBIND: return 'unbind';
    case UNBIND_RESP: return 'unbind_resp';
    case GENERIC_NACK: return 'generic_nack';
    case ENQUIRE_LINK: return 'enquire_link';
    case ENQUIRE_LINK_RESP: return 'enquire_link_resp';
    default: return `0x${id.toString(16).padStart(8, '0')}`;
  }
}

function getStatusName(status: number): string {
  switch (status) {
    case 0x00000000: return 'ESME_ROK (Success)';
    case 0x00000001: return 'ESME_RINVMSGLEN (Invalid message length)';
    case 0x00000002: return 'ESME_RINVCMDLEN (Invalid command length)';
    case 0x00000003: return 'ESME_RINVCMDID (Invalid command ID)';
    case 0x00000004: return 'ESME_RINVBNDSTS (Invalid bind status)';
    case 0x00000005: return 'ESME_RALYBND (Already bound)';
    case 0x00000006: return 'ESME_RINVPRTFLG (Invalid priority flag)';
    case 0x00000008: return 'ESME_RSYSERR (System error)';
    case 0x0000000D: return 'ESME_RINVSRCADR (Invalid source address)';
    case 0x0000000E: return 'ESME_RINVDSTADR (Invalid destination address)';
    case 0x0000000F: return 'ESME_RINVMSGID (Invalid message ID)';
    case 0x00000014: return 'ESME_RBINDFAIL (Bind failed)';
    case 0x00000015: return 'ESME_RINVPASWD (Invalid password)';
    case 0x00000016: return 'ESME_RINVSYSID (Invalid system ID)';
    case 0x00000058: return 'ESME_RINVSERTYP (Invalid service type)';
    default: return `0x${status.toString(16).padStart(8, '0')}`;
  }
}

function getVersionName(version: number): string {
  switch (version) {
    case SMPP_V33: return 'SMPP v3.3';
    case SMPP_V34: return 'SMPP v3.4';
    case SMPP_V50: return 'SMPP v5.0';
    default: return `v0x${version.toString(16)}`;
  }
}

/**
 * Encode a C-octet string (null-terminated)
 */
function encodeCOctet(str: string, maxLen: number): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const truncated = bytes.subarray(0, maxLen - 1); // leave room for null
  const result = new Uint8Array(truncated.length + 1);
  result.set(truncated);
  result[truncated.length] = 0x00; // null terminator
  return result;
}

/**
 * Read a null-terminated C-octet string from buffer
 */
function decodeCOctet(data: Uint8Array, offset: number): { value: string; nextOffset: number } {
  let end = offset;
  while (end < data.length && data[end] !== 0x00) {
    end++;
  }
  const value = new TextDecoder().decode(data.subarray(offset, end));
  return { value, nextOffset: end + 1 }; // skip null terminator
}

/**
 * Build an SMPP bind_transceiver PDU
 *
 * Body fields (all C-Octet strings):
 *   system_id       (max 16)
 *   password         (max 9)
 *   system_type      (max 13)
 *   interface_version (1 byte)
 *   addr_ton         (1 byte)
 *   addr_npi         (1 byte)
 *   address_range    (max 41)
 */
function buildBindTransceiverPDU(systemId: string, password: string, systemType: string = ''): Uint8Array {
  const sysIdBytes = encodeCOctet(systemId, 16);
  const passBytes = encodeCOctet(password, 9);
  const sysTypeBytes = encodeCOctet(systemType, 13);
  const interfaceVersion = SMPP_V34;
  const addrTon = 0x00;  // Unknown
  const addrNpi = 0x00;  // Unknown
  const addrRangeBytes = encodeCOctet('', 41); // Empty address range

  const bodyLen = sysIdBytes.length + passBytes.length + sysTypeBytes.length + 1 + 1 + 1 + addrRangeBytes.length;
  const totalLen = 16 + bodyLen; // 16-byte header + body

  const pdu = new Uint8Array(totalLen);
  const view = new DataView(pdu.buffer);

  // Header
  view.setUint32(0, totalLen, false);           // command_length
  view.setUint32(4, BIND_TRANSCEIVER, false);   // command_id
  view.setUint32(8, 0, false);                  // command_status (request = 0)
  view.setUint32(12, 1, false);                 // sequence_number

  // Body
  let offset = 16;
  pdu.set(sysIdBytes, offset);     offset += sysIdBytes.length;
  pdu.set(passBytes, offset);      offset += passBytes.length;
  pdu.set(sysTypeBytes, offset);   offset += sysTypeBytes.length;
  pdu[offset++] = interfaceVersion;
  pdu[offset++] = addrTon;
  pdu[offset++] = addrNpi;
  pdu.set(addrRangeBytes, offset);

  return pdu;
}

/**
 * Build an SMPP unbind PDU
 */
function buildUnbindPDU(sequenceNumber: number): Uint8Array {
  const pdu = new Uint8Array(16);
  const view = new DataView(pdu.buffer);
  view.setUint32(0, 16, false);
  view.setUint32(4, UNBIND, false);
  view.setUint32(8, 0, false);
  view.setUint32(12, sequenceNumber, false);
  return pdu;
}

/**
 * Build an SMPP enquire_link PDU
 */
function buildEnquireLinkPDU(sequenceNumber: number): Uint8Array {
  const pdu = new Uint8Array(16);
  const view = new DataView(pdu.buffer);
  view.setUint32(0, 16, false);
  view.setUint32(4, ENQUIRE_LINK, false);
  view.setUint32(8, 0, false);
  view.setUint32(12, sequenceNumber, false);
  return pdu;
}

/**
 * Parse an SMPP PDU header and body
 */
function parsePDU(data: Uint8Array): {
  commandLength: number;
  commandId: number;
  commandName: string;
  commandStatus: number;
  statusName: string;
  sequenceNumber: number;
  systemId?: string;
  scInterfaceVersion?: number;
  scInterfaceVersionName?: string;
} {
  if (data.length < 16) {
    throw new Error(`SMPP PDU too short: ${data.length} bytes (minimum 16)`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const commandLength = view.getUint32(0, false);
  const commandId = view.getUint32(4, false);
  const commandStatus = view.getUint32(8, false);
  const sequenceNumber = view.getUint32(12, false);

  const result: ReturnType<typeof parsePDU> = {
    commandLength,
    commandId,
    commandName: getCommandName(commandId),
    commandStatus,
    statusName: getStatusName(commandStatus),
    sequenceNumber,
  };

  // Parse bind response body
  if (
    (commandId === BIND_TRANSCEIVER_RESP ||
     commandId === BIND_TRANSMITTER_RESP ||
     commandId === BIND_RECEIVER_RESP) &&
    data.length > 16
  ) {
    // system_id is the first field
    const { value: systemId, nextOffset } = decodeCOctet(data, 16);
    result.systemId = systemId;

    // Optional TLVs may follow — look for sc_interface_version (tag 0x0210)
    let tlvOffset = nextOffset;
    while (tlvOffset + 4 <= data.length) {
      const tag = (data[tlvOffset] << 8) | data[tlvOffset + 1];
      const length = (data[tlvOffset + 2] << 8) | data[tlvOffset + 3];
      if (tag === 0x0210 && length >= 1 && tlvOffset + 4 + length <= data.length) {
        result.scInterfaceVersion = data[tlvOffset + 4];
        result.scInterfaceVersionName = getVersionName(data[tlvOffset + 4]);
      }
      tlvOffset += 4 + length;
    }
  }

  return result;
}

/** Read exactly N bytes from a socket */
async function readBytes(reader: ReadableStreamDefaultReader<Uint8Array>, n: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalRead = 0;
  while (totalRead < n) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed before full SMPP PDU received');
    chunks.push(value);
    totalRead += value.length;
  }
  if (chunks.length === 1) return chunks[0];
  const result = new Uint8Array(totalRead);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Handle SMPP bind test
 * POST /api/smpp/connect
 *
 * Sends a bind_transceiver PDU and parses the response to detect
 * SMPP server presence, authentication status, and interface version.
 */
export async function handleSMPPConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const {
      host,
      port = 2775,
      systemId = 'probe',
      password = '',
      systemType = '',
      timeout = 10000,
    } = await request.json<{
      host: string;
      port?: number;
      systemId?: string;
      password?: string;
      systemType?: string;
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Step 1: Send bind_transceiver
        const bindPDU = buildBindTransceiverPDU(systemId, password, systemType);
        await writer.write(bindPDU);

        // Step 2: Read response PDU header (first 4 bytes to get length)
        const headerStart = await readBytes(reader, 4);
        const pduLength = new DataView(headerStart.buffer, headerStart.byteOffset, 4).getUint32(0, false);

        if (pduLength < 16 || pduLength > 65536) {
          throw new Error(`Invalid SMPP PDU length: ${pduLength}`);
        }

        // Read remaining PDU bytes
        const remaining = await readBytes(reader, pduLength - 4);
        const fullPDU = new Uint8Array(pduLength);
        fullPDU.set(headerStart, 0);
        fullPDU.set(remaining, 4);

        // Step 3: Parse response
        const resp = parsePDU(fullPDU);

        // Step 4: Send unbind if bind was successful
        if (resp.commandStatus === 0) {
          const unbindPDU = buildUnbindPDU(2);
          await writer.write(unbindPDU);
          // Don't wait for unbind_resp — just close
        }

        await socket.close();

        const isSmpp = [
          BIND_TRANSCEIVER_RESP,
          BIND_TRANSMITTER_RESP,
          BIND_RECEIVER_RESP,
          GENERIC_NACK,
        ].includes(resp.commandId);

        return {
          success: true,
          host,
          port,
          protocol: 'SMPP',
          smppDetected: isSmpp,
          commandName: resp.commandName,
          commandStatus: resp.commandStatus,
          statusName: resp.statusName,
          sequenceNumber: resp.sequenceNumber,
          bound: resp.commandStatus === 0,
          ...(resp.systemId && { serverSystemId: resp.systemId }),
          ...(resp.scInterfaceVersion !== undefined && { interfaceVersion: resp.scInterfaceVersion }),
          ...(resp.scInterfaceVersionName && { interfaceVersionName: resp.scInterfaceVersionName }),
          message: resp.commandStatus === 0
            ? `SMPP bind successful to ${host}:${port}${resp.systemId ? ` (${resp.systemId})` : ''}`
            : `SMPP server detected on ${host}:${port} — bind refused: ${resp.statusName}`,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
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
 * Handle SMPP enquire_link (keepalive/probe)
 * POST /api/smpp/probe
 *
 * Simplified probe that sends an enquire_link PDU without binding first.
 * A real SMPP server will respond with generic_nack (since we're not bound).
 * A non-SMPP server will close the connection or send garbage data.
 */
export async function handleSMPPProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { host, port = 2775, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send enquire_link without binding
        const enquirePDU = buildEnquireLinkPDU(1);
        await writer.write(enquirePDU);

        // Read response header
        const headerStart = await readBytes(reader, 4);
        const pduLength = new DataView(headerStart.buffer, headerStart.byteOffset, 4).getUint32(0, false);

        if (pduLength < 16 || pduLength > 65536) {
          throw new Error(`Invalid response length: ${pduLength}`);
        }

        const remaining = await readBytes(reader, pduLength - 4);
        const fullPDU = new Uint8Array(pduLength);
        fullPDU.set(headerStart, 0);
        fullPDU.set(remaining, 4);

        await socket.close();

        const resp = parsePDU(fullPDU);

        // Any valid SMPP response means server is SMPP
        const isSmpp = resp.commandLength >= 16 &&
          (resp.commandId === ENQUIRE_LINK_RESP ||
           resp.commandId === GENERIC_NACK ||
           (resp.commandId & 0x80000000) !== 0); // any response bit set

        return {
          success: true,
          host,
          port,
          protocol: 'SMPP',
          isSmpp,
          commandName: resp.commandName,
          statusName: resp.statusName,
          message: isSmpp
            ? `SMPP server detected on ${host}:${port} (response: ${resp.commandName})`
            : `Port ${port} responded but may not be SMPP (command: ${resp.commandName})`,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
