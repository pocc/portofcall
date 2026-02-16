/**
 * S7comm Protocol Implementation (Siemens S7 PLC Communication)
 *
 * S7comm is the proprietary protocol used to communicate with Siemens S7
 * PLCs (S7-300, S7-400, S7-1200, S7-1500) in industrial automation/SCADA.
 *
 * Protocol Stack (layered over TCP port 102):
 *   TCP → TPKT (RFC 1006) → COTP (ISO 8073) → S7comm
 *
 * TPKT Header (4 bytes):
 *   [Version=3][Reserved=0][Length:uint16_be] (length includes TPKT header)
 *
 * COTP Connection Request (CR) - PDU type 0xE0:
 *   [Length][PDU Type=0xE0][Dst Ref:uint16][Src Ref:uint16][Class][Params...]
 *   Params include TSAP (Transport Service Access Point) for rack/slot
 *
 * S7 Communication Setup:
 *   [Protocol ID=0x32][Msg Type][Reserved][PDU Ref][Param Length][Data Length]
 *   [Function=0xF0][Reserved][Max AmQ Calling][Max AmQ Called][PDU Length]
 *
 * S7 Read SZL (System Status List):
 *   Used to read CPU identification, module info, and diagnostics
 *
 * Default Port: 102
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface S7commConnectRequest {
  host: string;
  port?: number;
  rack?: number;
  slot?: number;
  timeout?: number;
}

interface S7commResponse {
  success: boolean;
  host?: string;
  port?: number;
  rack?: number;
  slot?: number;
  cotpConnected?: boolean;
  s7Connected?: boolean;
  pduSize?: number;
  cpuInfo?: string;
  moduleType?: string;
  serialNumber?: string;
  plantId?: string;
  copyright?: string;
  error?: string;
  isCloudflare?: boolean;
}

// --- TPKT + COTP + S7 Packet Building ---

/**
 * Wrap payload in TPKT header (RFC 1006)
 * [Version=3][Reserved=0][Total Length:uint16_be]
 */
function wrapTPKT(payload: Uint8Array): Uint8Array {
  const totalLength = 4 + payload.length;
  const packet = new Uint8Array(totalLength);
  packet[0] = 3;  // Version
  packet[1] = 0;  // Reserved
  packet[2] = (totalLength >> 8) & 0xFF;
  packet[3] = totalLength & 0xFF;
  packet.set(payload, 4);
  return packet;
}

/**
 * Build COTP Connection Request (CR) packet
 *
 * TSAP encoding for rack/slot:
 *   Source TSAP: 0x01, 0x00 (client)
 *   Destination TSAP: 0x01, (rack * 0x20 + slot)
 */
function buildCOTPConnectionRequest(rack: number, slot: number): Uint8Array {
  const dstTsapByte = (rack << 5) | slot;

  // COTP CR PDU
  const cotp = new Uint8Array([
    17,       // Length indicator (17 bytes after this)
    0xE0,     // PDU type: CR (Connection Request)
    0x00, 0x00, // Destination reference
    0x00, 0x01, // Source reference
    0x00,     // Class 0
    // Parameter: TPDU size (code 0xC0)
    0xC0, 0x01, 0x0A, // Max TPDU size = 1024
    // Parameter: Source TSAP (code 0xC1)
    0xC1, 0x02, 0x01, 0x00, // Source TSAP
    // Parameter: Destination TSAP (code 0xC2)
    0xC2, 0x02, 0x01, dstTsapByte, // Destination TSAP (rack/slot encoded)
  ]);

  return wrapTPKT(cotp);
}

/**
 * Build S7 Communication Setup request
 *
 * S7 Header:
 *   [0x32][MsgType=0x01(Job)][0x00 0x00][PDU Ref:uint16][Param Len:uint16][Data Len:uint16]
 * S7 Setup Communication parameters:
 *   [Function=0xF0][Reserved=0x00][MaxAmQ Calling:uint16][MaxAmQ Called:uint16][PDU Length:uint16]
 */
function buildS7SetupCommunication(): Uint8Array {
  // COTP Data header (DT)
  const cotpData = new Uint8Array([
    0x02,  // Length indicator
    0xF0,  // PDU type: DT (Data)
    0x80,  // TPDU number + EOT
  ]);

  // S7 Header + Setup Communication
  const s7 = new Uint8Array([
    0x32,       // Protocol ID
    0x01,       // Message type: Job
    0x00, 0x00, // Reserved
    0x00, 0x00, // PDU reference
    0x00, 0x08, // Parameter length (8 bytes)
    0x00, 0x00, // Data length (0)
    // Parameters: Setup Communication
    0xF0,       // Function: Setup Communication
    0x00,       // Reserved
    0x00, 0x01, // Max AmQ calling
    0x00, 0x01, // Max AmQ called
    0x03, 0xC0, // PDU length: 960
  ]);

  // Combine COTP DT + S7
  const payload = new Uint8Array(cotpData.length + s7.length);
  payload.set(cotpData, 0);
  payload.set(s7, cotpData.length);

  return wrapTPKT(payload);
}

/**
 * Build S7 Read SZL (System Status List) request
 * SZL ID 0x001C = Component Identification
 * SZL Index 0x0000 = All
 */
function buildS7ReadSZL(): Uint8Array {
  // COTP Data header
  const cotpData = new Uint8Array([
    0x02, 0xF0, 0x80,
  ]);

  // S7 Header + Userdata + SZL Read
  const s7 = new Uint8Array([
    0x32,       // Protocol ID
    0x07,       // Message type: Userdata
    0x00, 0x00, // Reserved
    0x00, 0x01, // PDU reference
    0x00, 0x08, // Parameter length
    0x00, 0x08, // Data length
    // Parameter header (Userdata)
    0x00, 0x01, 0x12, // Parameter head
    0x04,       // Parameter length
    0x11,       // Type/function: Request
    0x44,       // Subfunction group: SZL
    0x01,       // Sequence number
    0x00,       // Data unit reference
    // Data: SZL read request
    0xFF,       // Return code
    0x09,       // Transport size: Octet string
    0x00, 0x04, // Data length
    0x00, 0x1C, // SZL ID: Component Identification
    0x00, 0x00, // SZL Index
  ]);

  const payload = new Uint8Array(cotpData.length + s7.length);
  payload.set(cotpData, 0);
  payload.set(s7, cotpData.length);

  return wrapTPKT(payload);
}

// --- Response Parsing ---

/**
 * Read a complete TPKT packet from socket
 */
async function readTPKTPacket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
  if (done || !value) return new Uint8Array(0);
  chunks.push(value);
  totalLen += value.length;

  // Try to read more
  try {
    const shortTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('read_done')), 500),
    );
    while (true) {
      const { value: next, done: nextDone } = await Promise.race([reader.read(), shortTimeout]);
      if (nextDone || !next) break;
      chunks.push(next);
      totalLen += next.length;
    }
  } catch {
    // Done reading
  }

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

/**
 * Parse COTP Connection Confirm (CC) from TPKT packet
 * Returns true if CC was received
 */
function parseCOTPConnectionConfirm(data: Uint8Array): boolean {
  if (data.length < 7) return false;

  // TPKT header: version=3, skip to payload at offset 4
  if (data[0] !== 3) return false;

  const cotpLength = data[4]; // Length indicator
  const pduType = data[5];    // PDU type

  return pduType === 0xD0 && cotpLength >= 2; // 0xD0 = CC (Connection Confirm)
}

/**
 * Parse S7 Setup Communication response
 * Returns the negotiated PDU size
 */
function parseS7SetupResponse(data: Uint8Array): number | null {
  if (data.length < 20) return null;

  // Skip TPKT (4) + COTP DT (3) = offset 7
  const offset = 7;

  // Check S7 protocol ID
  if (data[offset] !== 0x32) return null;

  // Message type should be 0x03 (Ack_Data)
  if (data[offset + 1] !== 0x03) return null;

  // Check for error (error class at offset+17, error code at offset+18 for Ack_Data)
  // For setup response, param starts at offset+10
  const paramOffset = offset + 10;
  if (data.length <= paramOffset + 7) return null;

  // Function should be 0xF0 (Setup Communication)
  if (data[paramOffset] !== 0xF0) return null;

  // PDU size is at paramOffset+6 (uint16 big-endian)
  const pduSize = (data[paramOffset + 5] << 8) | data[paramOffset + 6];
  return pduSize;
}

/**
 * Parse S7 SZL response to extract component identification
 * Returns extracted strings from SZL data
 */
function parseSZLResponse(data: Uint8Array): {
  cpuInfo?: string;
  moduleType?: string;
  serialNumber?: string;
  plantId?: string;
  copyright?: string;
} {
  const result: ReturnType<typeof parseSZLResponse> = {};

  if (data.length < 30) return result;

  // Skip TPKT (4) + COTP (3) + S7 Header (12) + Data header (4) + SZL header (4) = 27
  // The SZL data contains records of 34 bytes each
  // Record format: [Index:uint16][Text:32 bytes]

  const decoder = new TextDecoder('ascii');

  // Find the SZL data portion
  // After S7 header at offset 7, message type should be 0x07 (Userdata) response
  const s7Offset = 7;
  if (data[s7Offset] !== 0x32) return result;

  // Get parameter length and data length
  const paramLen = (data[s7Offset + 6] << 8) | data[s7Offset + 7];
  const dataStart = s7Offset + 10 + paramLen;

  if (dataStart + 8 >= data.length) return result;

  // Skip data header (return code, transport size, length) = 4 bytes
  // Then SZL header (SZL ID, SZL Index, SZL record size, SZL record count) = 8 bytes
  const recordStart = dataStart + 4 + 8;
  const recordSize = (data[dataStart + 8] << 8) | data[dataStart + 9];

  if (recordSize < 4 || recordStart >= data.length) return result;

  // Parse records
  let offset = recordStart;
  while (offset + recordSize <= data.length) {
    const index = (data[offset] << 8) | data[offset + 1];
    const textBytes = data.slice(offset + 2, offset + recordSize);
    const text = decoder.decode(textBytes).replace(/\0+$/, '').trim();

    switch (index) {
      case 1: result.cpuInfo = text; break;       // Order number / CPU name
      case 2: result.moduleType = text; break;     // Module type name
      case 3: result.plantId = text; break;        // Plant identification
      case 4: result.copyright = text; break;      // Copyright
      case 5: result.serialNumber = text; break;   // Serial number
      case 7: result.moduleType = result.moduleType || text; break; // Module type
    }

    offset += recordSize;
  }

  return result;
}

// --- Input Validation ---

function validateS7Input(host: string, port: number, rack: number, slot: number): string | null {
  if (!host || host.trim().length === 0) {
    return 'Host is required';
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(host)) {
    return 'Host contains invalid characters';
  }

  if (port < 1 || port > 65535) {
    return 'Port must be between 1 and 65535';
  }

  if (rack < 0 || rack > 7) {
    return 'Rack must be between 0 and 7';
  }

  if (slot < 0 || slot > 31) {
    return 'Slot must be between 0 and 31';
  }

  return null;
}

// --- Handlers ---

/**
 * Handle S7comm connect and probe
 *
 * POST /api/s7comm/connect
 * Body: { host, port?, rack?, slot?, timeout? }
 *
 * Performs COTP connection, S7 setup, and optionally reads SZL for CPU info
 */
export async function handleS7commConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as S7commConnectRequest;
    const {
      host,
      port = 102,
      rack = 0,
      slot = 2,
      timeout = 10000,
    } = body;

    const validationError = validateS7Input(host, port, rack, slot);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError } satisfies S7commResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        } satisfies S7commResponse),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: COTP Connection Request
      const cotpCR = buildCOTPConnectionRequest(rack, slot);
      await writer.write(cotpCR);

      const cotpResponse = await readTPKTPacket(reader, timeoutPromise);
      const cotpConnected = parseCOTPConnectionConfirm(cotpResponse);

      if (!cotpConnected) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            host,
            port,
            rack,
            slot,
            cotpConnected: false,
            error: 'COTP connection rejected - check rack/slot configuration',
          } satisfies S7commResponse),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Step 2: S7 Setup Communication
      const s7Setup = buildS7SetupCommunication();
      await writer.write(s7Setup);

      const s7SetupResponse = await readTPKTPacket(reader, timeoutPromise);
      const pduSize = parseS7SetupResponse(s7SetupResponse);

      if (pduSize === null) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: true,
            host,
            port,
            rack,
            slot,
            cotpConnected: true,
            s7Connected: false,
            error: 'S7 setup communication failed',
          } satisfies S7commResponse),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Step 3: Read SZL for CPU identification (optional, best-effort)
      let cpuInfo: string | undefined;
      let moduleType: string | undefined;
      let serialNumber: string | undefined;
      let plantId: string | undefined;
      let copyright: string | undefined;

      try {
        const szlRequest = buildS7ReadSZL();
        await writer.write(szlRequest);

        const szlResponse = await readTPKTPacket(reader, timeoutPromise);
        const szlData = parseSZLResponse(szlResponse);

        cpuInfo = szlData.cpuInfo;
        moduleType = szlData.moduleType;
        serialNumber = szlData.serialNumber;
        plantId = szlData.plantId;
        copyright = szlData.copyright;
      } catch {
        // SZL read failed - not critical
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rack,
          slot,
          cotpConnected: true,
          s7Connected: true,
          pduSize,
          cpuInfo,
          moduleType,
          serialNumber,
          plantId,
          copyright,
        } satisfies S7commResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies S7commResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
