/**
 * EtherNet/IP (CIP) Protocol Implementation
 *
 * EtherNet/IP is an industrial protocol for CIP (Common Industrial Protocol)
 * communication over TCP. Default port is 44818. Used by Allen-Bradley/Rockwell
 * PLCs, scanners, drives, and other automation devices.
 *
 * Protocol Flow:
 * 1. Client sends encapsulation header (24 bytes, little-endian)
 * 2. ListIdentity command (0x0063) discovers device info without a session
 * 3. RegisterSession (0x0065) opens a CIP session for further commands
 *
 * Encapsulation Header (24 bytes):
 *   Command (2 LE) | Length (2 LE) | Session Handle (4 LE)
 *   Status (4 LE) | Sender Context (8) | Options (4 LE)
 *
 * Use Cases:
 * - ICS/SCADA device discovery
 * - PLC identification (Allen-Bradley, Rockwell)
 * - Industrial network inventory
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface EtherNetIPRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface DeviceIdentity {
  protocolVersion?: number;
  vendorId?: number;
  deviceType?: number;
  deviceTypeName?: string;
  productCode?: number;
  revisionMajor?: number;
  revisionMinor?: number;
  status?: number;
  statusDescription?: string;
  serialNumber?: string;
  productName?: string;
  state?: number;
  stateName?: string;
  socketAddress?: string;
}

interface EtherNetIPResponse {
  success: boolean;
  host: string;
  port: number;
  rtt: number;
  encapsulationCommand?: number;
  encapsulationStatus?: number;
  identity?: DeviceIdentity;
  error?: string;
}

// Device type names per CIP Volume 1
const DEVICE_TYPES: Record<number, string> = {
  0x00: 'Generic Device',
  0x02: 'AC Drive',
  0x03: 'Motor Overload',
  0x04: 'Limit Switch',
  0x05: 'Inductive Proximity Switch',
  0x06: 'Photoelectric Sensor',
  0x07: 'General Purpose Discrete I/O',
  0x09: 'Resolver',
  0x0C: 'Communications Adapter',
  0x0E: 'Programmable Logic Controller',
  0x10: 'Position Controller',
  0x13: 'DC Drive',
  0x15: 'Contactor',
  0x16: 'Motor Starter',
  0x17: 'Soft Start',
  0x18: 'Human-Machine Interface',
  0x1A: 'Mass Flow Controller',
  0x1B: 'Pneumatic Valve',
  0x1C: 'Vacuum Pressure Gauge',
  0x1D: 'Process Control Value',
  0x1E: 'Residual Gas Analyzer',
  0x1F: 'DC Power Generator',
  0x20: 'RF Power Generator',
  0x21: 'Turbomolecular Vacuum Pump',
  0x22: 'Encoder',
  0x23: 'Safety Discrete I/O Device',
  0x24: 'Fluid Flow Controller',
  0x25: 'CIP Motion Drive',
  0x26: 'CompoNet Repeater',
  0x27: 'CIP Modbus Device',
  0x28: 'CIP Modbus Translator',
  0x29: 'Safety Analog I/O Device',
  0x2A: 'Generic Device (keyable)',
  0x2B: 'Managed Ethernet Switch',
  0x2C: 'CIP Motion Safety Drive',
  0x2D: 'Safety Drive',
  0x2E: 'CIP Motion Encoder',
  0x2F: 'CIP Motion Converter',
  0x30: 'CIP Motion I/O',
  0xC8: 'Embedded Component',
};

// Identity Object status word individual bit flags (CIP Vol 1, Table 5A-2.11)
// Bits 4-7 are the Extended Device Status 4-bit field, handled separately.
const DEVICE_STATUS_BITS: Record<number, string> = {
  0x0001: 'Owned',
  0x0004: 'Configured',
  0x0100: 'Minor Recoverable Fault',
  0x0200: 'Minor Unrecoverable Fault',
  0x0400: 'Major Recoverable Fault',
  0x0800: 'Major Unrecoverable Fault',
};

// Extended Device Status (bits 4-7 of the status word, a 4-bit field)
const EXTENDED_DEVICE_STATUS: Record<number, string> = {
  0x0: 'Unknown',
  0x1: 'Firmware Update In Progress',
  0x2: 'At Least One Faulted I/O Connection',
  0x3: 'No I/O Connections Established',
  0x4: 'Non-Volatile Configuration Bad',
  0x5: 'Major Fault',
  0x6: 'At Least One I/O Connection In Run Mode',
  0x7: 'At Least One I/O Connection In Idle Mode',
};

// Device state values
const DEVICE_STATES: Record<number, string> = {
  0: 'Nonexistent',
  1: 'Device Self Testing',
  2: 'Standby',
  3: 'Operational',
  4: 'Major Recoverable Fault',
  5: 'Major Unrecoverable Fault',
  0xFF: 'Default',
};

// EtherNet/IP encapsulation commands
const EIP_CMD_LIST_IDENTITY      = 0x0063;
const EIP_CMD_REGISTER_SESSION   = 0x0065;
const EIP_CMD_UNREGISTER_SESSION = 0x0066;
const EIP_CMD_SEND_RR_DATA       = 0x006F;

// CIP service codes
const CIP_GET_ATTRIBUTE_SINGLE   = 0x0E;
const CIP_GET_ATTRIBUTES_ALL     = 0x01;
const CIP_SET_ATTRIBUTE_SINGLE   = 0x10;

// EtherNet/IP encapsulation commands (additional)
const EIP_CMD_LIST_SERVICES      = 0x0004;

// CPF type IDs
const CPF_NULL_ADDRESS  = 0x0000;
const CPF_CONNECTED_ADDRESS = 0x00A1;
const CPF_UNCONNECTED_DATA  = 0x00B2;

// CIP general status codes
const CIP_STATUS: Record<number, string> = {
  0x00: 'Success',
  0x01: 'Connection Failure',
  0x02: 'Resource Unavailable',
  0x03: 'Invalid Parameter Value',
  0x04: 'Path Segment Error',
  0x05: 'Path Destination Unknown',
  0x06: 'Partial Transfer',
  0x07: 'Connection Lost',
  0x08: 'Service Not Supported',
  0x09: 'Invalid Attribute Value',
  0x0A: 'Attribute List Error',
  0x0B: 'Already In Requested Mode',
  0x0C: 'Object State Conflict',
  0x0D: 'Object Already Exists',
  0x0E: 'Attribute Not Settable',
  0x0F: 'Privilege Violation',
  0x10: 'Device State Conflict',
  0x11: 'Reply Data Too Large',
  0x12: 'Fragmentation Of Primitive',
  0x13: 'Not Enough Data',
  0x14: 'Attribute Not Supported',
  0x15: 'Too Much Data',
  0x16: 'Object Does Not Exist',
  0x17: 'Service Fragmentation Sequence Not In Progress',
  0x18: 'No Stored Attribute Data',
  0x19: 'Store Operation Failure',
  0x1A: 'Transfer Too Large',
  0x1B: 'Attribute Not Transferable',
  0x1C: 'Attribute Not Readable',
  0x1D: 'Request Too Large',
  0x1E: 'Response Too Large',
  0x1F: 'Missing Attribute List Entry Data',
  0x20: 'Invalid Attribute Value List',
  0x26: 'Keyswitch Protected',
  0xFF: 'General Error',
};

/**
 * Build a ListIdentity encapsulation request (24 bytes, no data)
 */
function buildListIdentityRequest(): Uint8Array {
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);

  // Command: ListIdentity (0x0063) - little-endian
  view.setUint16(0, EIP_CMD_LIST_IDENTITY, true);
  // Length: 0 (no command-specific data)
  view.setUint16(2, 0, true);
  // Session Handle: 0 (not needed for ListIdentity)
  view.setUint32(4, 0, true);
  // Status: 0
  view.setUint32(8, 0, true);
  // Sender Context: arbitrary 8 bytes for correlation
  header[12] = 0x50; // 'P'
  header[13] = 0x6F; // 'o'
  header[14] = 0x43; // 'C'
  header[15] = 0x61; // 'a'
  header[16] = 0x6C; // 'l'
  header[17] = 0x6C; // 'l'
  header[18] = 0x00;
  header[19] = 0x00;
  // Options: 0
  view.setUint32(20, 0, true);

  return header;
}

/**
 * Parse the device identity from a ListIdentity CPF item
 */
function parseIdentityItem(data: Uint8Array, offset: number, length: number): DeviceIdentity {
  const identity: DeviceIdentity = {};
  const view = new DataView(data.buffer, data.byteOffset + offset, length);

  if (length < 34) return identity; // minimum identity item size (through serial + 1 name len byte)

  let pos = 0;

  // Protocol version (2 bytes LE)
  identity.protocolVersion = view.getUint16(pos, true);
  pos += 2;

  // Socket address (16 bytes - sockaddr_in structure, big-endian)
  // Skip sin_family (2 bytes)
  pos += 2;
  const sinPort = view.getUint16(pos, false); // big-endian
  pos += 2;
  const ip1 = data[offset + pos];
  const ip2 = data[offset + pos + 1];
  const ip3 = data[offset + pos + 2];
  const ip4 = data[offset + pos + 3];
  pos += 4;
  identity.socketAddress = `${ip1}.${ip2}.${ip3}.${ip4}:${sinPort}`;
  pos += 8; // sin_zero padding

  // Skip if not enough data
  if (pos + 14 > length) return identity;

  // Vendor ID (2 bytes LE)
  identity.vendorId = view.getUint16(pos, true);
  pos += 2;

  // Device Type (2 bytes LE)
  identity.deviceType = view.getUint16(pos, true);
  identity.deviceTypeName = DEVICE_TYPES[identity.deviceType] || `Unknown (0x${identity.deviceType.toString(16).padStart(4, '0')})`;
  pos += 2;

  // Product Code (2 bytes LE)
  identity.productCode = view.getUint16(pos, true);
  pos += 2;

  // Revision (2 bytes: major, minor)
  identity.revisionMajor = data[offset + pos];
  identity.revisionMinor = data[offset + pos + 1];
  pos += 2;

  // Status (2 bytes LE)
  identity.status = view.getUint16(pos, true);
  const statusParts: string[] = [];
  // Check individual bit flags (bits 0,2,8-11)
  for (const [bit, desc] of Object.entries(DEVICE_STATUS_BITS)) {
    if (identity.status & parseInt(bit, 10)) {
      statusParts.push(desc);
    }
  }
  // Extract Extended Device Status (bits 4-7 as a 4-bit field)
  const extStatus = (identity.status >> 4) & 0x0F;
  if (extStatus !== 0) {
    const extDesc = EXTENDED_DEVICE_STATUS[extStatus];
    if (extDesc) {
      statusParts.push(extDesc);
    } else {
      statusParts.push(`Extended Device Status (${extStatus})`);
    }
  }
  identity.statusDescription = statusParts.length > 0 ? statusParts.join(', ') : 'OK';
  pos += 2;

  // Serial Number (4 bytes LE)
  const serial = view.getUint32(pos, true);
  identity.serialNumber = `0x${serial.toString(16).padStart(8, '0').toUpperCase()}`;
  pos += 4;

  // Product Name (1 byte length + N bytes ASCII)
  if (pos < length) {
    const nameLength = data[offset + pos];
    pos += 1;
    if (pos + nameLength <= length) {
      identity.productName = new TextDecoder().decode(data.slice(offset + pos, offset + pos + nameLength));
      pos += nameLength;
    }
  }

  // State (1 byte)
  if (pos < length) {
    identity.state = data[offset + pos];
    identity.stateName = DEVICE_STATES[identity.state] || `Unknown (${identity.state})`;
  }

  return identity;
}

/**
 * Parse a ListIdentity response
 */
function parseListIdentityResponse(data: Uint8Array): {
  command: number;
  status: number;
  identity?: DeviceIdentity;
} {
  if (data.length < 24) {
    throw new Error('Response too short for encapsulation header');
  }

  const view = new DataView(data.buffer, data.byteOffset, data.length);

  const command = view.getUint16(0, true);
  const dataLength = view.getUint16(2, true);
  const status = view.getUint32(8, true);

  if (status !== 0) {
    return { command, status };
  }

  // Parse CPF (Common Packet Format) items from the data portion
  const dataStart = 24;
  if (dataLength < 2 || data.length < dataStart + 2) {
    return { command, status };
  }

  const itemCount = view.getUint16(dataStart, true);
  if (itemCount === 0) {
    return { command, status };
  }

  // Parse first CPF item
  let itemOffset = dataStart + 2;
  if (itemOffset + 4 > data.length) {
    return { command, status };
  }

  const itemTypeId = view.getUint16(itemOffset, true);
  const itemLength = view.getUint16(itemOffset + 2, true);
  itemOffset += 4;

  // Type 0x000C = ListIdentity Response
  if (itemTypeId === 0x000C && itemOffset + itemLength <= data.length) {
    const identity = parseIdentityItem(data, itemOffset, itemLength);
    return { command, status, identity };
  }

  return { command, status };
}

/**
 * Probe an EtherNet/IP device by sending ListIdentity
 * POST /api/ethernetip/identity
 */
export async function handleEtherNetIPIdentity(request: Request): Promise<Response> {
  try {
    const body = await request.json() as EtherNetIPRequest;
    const { host, port = 44818, timeout = 10000 } = body;

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

    const startTime = Date.now();

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send ListIdentity request
        const request = buildListIdentityRequest();
        await writer.write(request);

        // Read response - accumulate until we have the full encapsulation frame
        let buffer = new Uint8Array(0);
        const maxSize = 4096;

        while (buffer.length < maxSize) {
          const { value, done } = await reader.read();
          if (done || !value) break;

          const newBuffer = new Uint8Array(buffer.length + value.length);
          newBuffer.set(buffer);
          newBuffer.set(value, buffer.length);
          buffer = newBuffer;

          // Check if we have a complete encapsulation frame
          if (buffer.length >= 24) {
            const frameView = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
            const dataLength = frameView.getUint16(2, true);
            if (buffer.length >= 24 + dataLength) break;
          }
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const rtt = Date.now() - startTime;

        if (buffer.length < 24) {
          throw new Error('Incomplete response from device');
        }

        const parsed = parseListIdentityResponse(buffer);

        const response: EtherNetIPResponse = {
          success: true,
          host,
          port,
          rtt,
          encapsulationCommand: parsed.command,
          encapsulationStatus: parsed.status,
          identity: parsed.identity,
        };

        return response;
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
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
      error: error instanceof Error ? error.message : 'Unknown error',
      host: '',
      port: 0,
      rtt: 0,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Read a complete EtherNet/IP encapsulation frame from the socket.
 * The encapsulation header at bytes [2-3] gives the data payload length.
 * Total expected size = 24 + dataLength.
 */
async function readEIPFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Uint8Array> {
  const deadline = Date.now() + timeoutMs;
  let buffer = new Uint8Array(0);

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const timeoutP = new Promise<{ value: undefined; done: true }>(resolve =>
      setTimeout(() => resolve({ value: undefined, done: true }), remaining)
    );
    const { value, done } = await Promise.race([reader.read(), timeoutP]);

    if (done || !value) break;

    const nb = new Uint8Array(buffer.length + value.length);
    nb.set(buffer);
    nb.set(value, buffer.length);
    buffer = nb;

    if (buffer.length >= 24) {
      const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
      const dataLen = dv.getUint16(2, true);
      if (buffer.length >= 24 + dataLen) {
        return buffer.slice(0, 24 + dataLen);
      }
    }
  }

  return buffer;
}

/**
 * Build an EtherNet/IP encapsulation header (24 bytes)
 */
function buildEIPHeader(
  command: number,
  dataLength: number,
  sessionHandle: number,
  senderContext: number = 0x1234,
): Uint8Array {
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);
  view.setUint16(0, command, true);       // Command (LE)
  view.setUint16(2, dataLength, true);    // Length (LE)
  view.setUint32(4, sessionHandle, true); // Session Handle (LE)
  view.setUint32(8, 0, true);             // Status = 0
  view.setUint32(12, senderContext, true); // Sender Context low
  view.setUint32(16, 0, true);            // Sender Context high
  view.setUint32(20, 0, true);            // Options = 0
  return header;
}

/**
 * Build a RegisterSession request.
 * Data: Protocol Version (2 LE) + Options Flags (2 LE)
 */
function buildRegisterSessionRequest(): Uint8Array {
  const data = new Uint8Array(4);
  const view = new DataView(data.buffer);
  view.setUint16(0, 0x0001, true); // Protocol version = 1
  view.setUint16(2, 0x0000, true); // Options = 0
  const header = buildEIPHeader(EIP_CMD_REGISTER_SESSION, 4, 0);
  const frame = new Uint8Array(24 + 4);
  frame.set(header);
  frame.set(data, 24);
  return frame;
}

/**
 * Build a CIP path for class/instance/attribute using logical segments.
 *
 * Segment encoding (1 byte each, padded to even word count):
 *   Class:     0x20 (8-bit) or 0x21 (16-bit)
 *   Instance:  0x24 (8-bit) or 0x25 (16-bit)
 *   Attribute: 0x30 (8-bit) or 0x31 (16-bit)
 */
function buildCIPPath(classId: number, instanceId: number, attributeId: number): Uint8Array {
  const segments: number[] = [];

  // Class segment
  if (classId <= 0xFF) {
    segments.push(0x20, classId);
  } else {
    segments.push(0x21, 0x00, classId & 0xFF, (classId >> 8) & 0xFF);
  }
  // Instance segment
  if (instanceId <= 0xFF) {
    segments.push(0x24, instanceId);
  } else {
    segments.push(0x25, 0x00, instanceId & 0xFF, (instanceId >> 8) & 0xFF);
  }
  // Attribute segment
  if (attributeId <= 0xFF) {
    segments.push(0x30, attributeId);
  } else {
    segments.push(0x31, 0x00, attributeId & 0xFF, (attributeId >> 8) & 0xFF);
  }

  // Pad to even number of bytes
  if (segments.length % 2 !== 0) segments.push(0x00);

  return new Uint8Array(segments);
}

/**
 * Build a SendRRData request carrying a CIP Get_Attribute_Single via Unconnected Send.
 *
 * SendRRData payload:
 *   Interface Handle (4 LE) = 0
 *   Timeout (2 LE) = 5 seconds
 *   CPF item count (2 LE) = 2
 *     Item 0: Null Address (0x0000), length 0
 *     Item 1: Unconnected Data (0x00B2), length = CIP request size
 *       CIP Get_Attribute_Single: service(1) + path_size(1) + path(N)
 */
function buildSendRRDataCIPRead(
  sessionHandle: number,
  classId: number,
  instanceId: number,
  attributeId: number,
): Uint8Array {
  const cipPath = buildCIPPath(classId, instanceId, attributeId);
  const pathWordSize = cipPath.length / 2; // path size in words

  // CIP request: Service | Path Size (words) | Path
  const cipRequest = new Uint8Array(2 + cipPath.length);
  cipRequest[0] = CIP_GET_ATTRIBUTE_SINGLE; // 0x0E
  cipRequest[1] = pathWordSize;
  cipRequest.set(cipPath, 2);

  // CPF items
  // Item 0: Null Address Item (4 bytes total)
  const nullItem = new Uint8Array(4);
  const nullView = new DataView(nullItem.buffer);
  nullView.setUint16(0, CPF_NULL_ADDRESS, true);
  nullView.setUint16(2, 0, true); // length = 0

  // Item 1: Unconnected Data Item (4 header + cipRequest bytes)
  const dataItem = new Uint8Array(4 + cipRequest.length);
  const dataView = new DataView(dataItem.buffer);
  dataView.setUint16(0, CPF_UNCONNECTED_DATA, true);
  dataView.setUint16(2, cipRequest.length, true);
  dataItem.set(cipRequest, 4);

  // SendRRData command data:
  //   Interface Handle (4) + Timeout (2) + Item Count (2) + items
  const commandData = new Uint8Array(8 + nullItem.length + dataItem.length);
  const cdView = new DataView(commandData.buffer);
  cdView.setUint32(0, 0x00000000, true); // Interface Handle = CIP
  cdView.setUint16(4, 0x0005, true);     // Timeout = 5 seconds
  cdView.setUint16(6, 0x0002, true);     // Item count = 2
  commandData.set(nullItem, 8);
  commandData.set(dataItem, 8 + nullItem.length);

  const header = buildEIPHeader(EIP_CMD_SEND_RR_DATA, commandData.length, sessionHandle);
  const frame = new Uint8Array(24 + commandData.length);
  frame.set(header);
  frame.set(commandData, 24);
  return frame;
}

/**
 * Parse a SendRRData response and extract the CIP reply data.
 *
 * Returns the CIP response service code, general status, and data bytes.
 */
function parseSendRRDataResponse(data: Uint8Array): {
  status: number;
  statusName: string;
  service: number;
  cipData: Uint8Array;
} {
  if (data.length < 24) throw new Error('Response too short for EIP header');

  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const encapStatus = view.getUint32(8, true);
  if (encapStatus !== 0) {
    throw new Error(`EtherNet/IP encapsulation error: 0x${encapStatus.toString(16).padStart(8, '0')}`);
  }

  // SendRRData response data starts at byte 24
  // Layout: Interface Handle(4) + Timeout(2) + Item Count(2) + items
  if (data.length < 24 + 8) throw new Error('Response too short for SendRRData header');

  const itemCount = view.getUint16(24 + 6, true);
  let offset = 24 + 8;

  // Find the Unconnected Data item
  for (let i = 0; i < itemCount && offset + 4 <= data.length; i++) {
    const itemType = view.getUint16(offset, true);
    const itemLen  = view.getUint16(offset + 2, true);
    offset += 4;

    if (itemType === CPF_UNCONNECTED_DATA || itemType === CPF_CONNECTED_ADDRESS) {
      if (itemType === CPF_UNCONNECTED_DATA && itemLen >= 4) {
        // CIP response: service(1) + reserved(1) + general status(1) + additional status size(1) + [data]
        const cipData = data.slice(offset, offset + itemLen);
        const service     = cipData[0];
        const genStatus   = cipData[2] ?? 0;
        const addlSize    = cipData[3] ?? 0;
        const dataStart   = 4 + addlSize * 2; // additional status is in words
        const attrData    = cipData.slice(dataStart, itemLen);

        return {
          status: genStatus,
          statusName: CIP_STATUS[genStatus] ?? `Unknown (0x${genStatus.toString(16)})`,
          service,
          cipData: attrData,
        };
      }
    }
    offset += itemLen;
  }

  throw new Error('No Unconnected Data item found in SendRRData response');
}

/**
 * Read a CIP attribute from an EtherNet/IP device via UCMM (Unconnected Messaging)
 * POST /api/ethernetip/cip-read
 *
 * Steps:
 *   1. RegisterSession  — obtain a session handle
 *   2. SendRRData       — CIP Get_Attribute_Single for the requested class/instance/attribute
 *   3. Parse CIP response
 */
export async function handleEtherNetIPCIPRead(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      classId: number;
      instanceId: number;
      attributeId: number;
    };

    const {
      host,
      port = 44818,
      timeout = 10000,
      classId,
      instanceId,
      attributeId,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof classId !== 'number' || typeof instanceId !== 'number' || typeof attributeId !== 'number') {
      return new Response(JSON.stringify({
        success: false,
        error: 'classId, instanceId, and attributeId are required numbers',
      }), {
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

    const startTime = Date.now();

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: RegisterSession
        const regReq = buildRegisterSessionRequest();
        await writer.write(regReq);

        const regResp = await readEIPFrame(reader, 5000);
        if (regResp.length < 24) throw new Error('No response to RegisterSession');

        const regView = new DataView(regResp.buffer, regResp.byteOffset, regResp.length);
        const regCommand = regView.getUint16(0, true);
        const regStatus  = regView.getUint32(8, true);

        if (regCommand !== EIP_CMD_REGISTER_SESSION) {
          throw new Error(`Unexpected response command: 0x${regCommand.toString(16)}`);
        }
        if (regStatus !== 0) {
          throw new Error(`RegisterSession failed with status: 0x${regStatus.toString(16).padStart(8, '0')}`);
        }

        const sessionHandle = regView.getUint32(4, true);

        // Step 2: SendRRData with CIP Get_Attribute_Single
        const cipReadReq = buildSendRRDataCIPRead(sessionHandle, classId, instanceId, attributeId);
        await writer.write(cipReadReq);

        const cipResp = await readEIPFrame(reader, 5000);
        if (cipResp.length < 24) throw new Error('No response to SendRRData');

        const { status, statusName, service, cipData } = parseSendRRDataResponse(cipResp);

        // Unregister session (best effort)
        try {
          const unregHeader = buildEIPHeader(EIP_CMD_UNREGISTER_SESSION, 0, sessionHandle);
          await writer.write(unregHeader);
        } catch { /* ignore */ }

        const dataArray = Array.from(cipData);
        const hexStr = dataArray.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: status === 0,
          host,
          port,
          sessionHandle: `0x${sessionHandle.toString(16).padStart(8, '0').toUpperCase()}`,
          classId: `0x${classId.toString(16).padStart(4, '0').toUpperCase()}`,
          instanceId,
          attributeId,
          cipService: `0x${service.toString(16).padStart(2, '0').toUpperCase()}`,
          status,
          statusName,
          data: dataArray,
          hex: hexStr,
          rtt,
          ...(status !== 0 && { error: `CIP error: ${statusName}` }),
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
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
      error: error instanceof Error ? error.message : 'Unknown error',
      host: '',
      port: 0,
      rtt: 0,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── Additional helpers ──────────────────────────────────────────────────────

/**
 * Build a CIP logical path with class + instance only (no attribute segment).
 * Used for Get_Attributes_All.
 */
function buildCIPPathClassInstance(classId: number, instanceId: number): Uint8Array {
  const segments: number[] = [];

  if (classId <= 0xFF) {
    segments.push(0x20, classId);
  } else {
    segments.push(0x21, 0x00, classId & 0xFF, (classId >> 8) & 0xFF);
  }

  if (instanceId <= 0xFF) {
    segments.push(0x24, instanceId);
  } else {
    segments.push(0x25, 0x00, instanceId & 0xFF, (instanceId >> 8) & 0xFF);
  }

  if (segments.length % 2 !== 0) segments.push(0x00);
  return new Uint8Array(segments);
}

/**
 * Build a generic SendRRData frame given a raw CIP request payload.
 */
function buildSendRRDataRequest(sessionHandle: number, cipRequest: Uint8Array): Uint8Array {
  const nullItem = new Uint8Array(4);
  const nv = new DataView(nullItem.buffer);
  nv.setUint16(0, CPF_NULL_ADDRESS, true);
  nv.setUint16(2, 0, true);

  const dataItem = new Uint8Array(4 + cipRequest.length);
  const dv = new DataView(dataItem.buffer);
  dv.setUint16(0, CPF_UNCONNECTED_DATA, true);
  dv.setUint16(2, cipRequest.length, true);
  dataItem.set(cipRequest, 4);

  const commandData = new Uint8Array(8 + nullItem.length + dataItem.length);
  const cdv = new DataView(commandData.buffer);
  cdv.setUint32(0, 0, true);
  cdv.setUint16(4, 5, true);
  cdv.setUint16(6, 2, true);
  commandData.set(nullItem, 8);
  commandData.set(dataItem, 8 + nullItem.length);

  const header = buildEIPHeader(EIP_CMD_SEND_RR_DATA, commandData.length, sessionHandle);
  const frame = new Uint8Array(24 + commandData.length);
  frame.set(header);
  frame.set(commandData, 24);
  return frame;
}

/**
 * Open an EIP session. Returns the session handle.
 */
async function openEIPSession(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  timeoutMs: number,
): Promise<number> {
  const regReq = buildRegisterSessionRequest();
  await writer.write(regReq);

  const regResp = await readEIPFrame(reader, Math.min(timeoutMs, 5000));
  if (regResp.length < 28) throw new Error('No response to RegisterSession');

  const regView = new DataView(regResp.buffer, regResp.byteOffset, regResp.length);
  const regCommand = regView.getUint16(0, true);
  const regStatus  = regView.getUint32(8, true);

  if (regCommand !== EIP_CMD_REGISTER_SESSION) {
    throw new Error(`Unexpected response command: 0x${regCommand.toString(16)}`);
  }
  if (regStatus !== 0) {
    throw new Error(`RegisterSession failed: 0x${regStatus.toString(16).padStart(8, '0')}`);
  }

  return regView.getUint32(4, true);
}

/**
 * Build a ListServices encapsulation request (24 bytes, no data).
 */
function buildListServicesRequest(): Uint8Array {
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);
  view.setUint16(0, EIP_CMD_LIST_SERVICES, true);
  view.setUint16(2, 0, true);
  view.setUint32(4, 0, true);
  view.setUint32(8, 0, true);
  header[12] = 0x50; header[13] = 0x6F; header[14] = 0x43; header[15] = 0x61;
  header[16] = 0x6C; header[17] = 0x6C;
  view.setUint32(20, 0, true);
  return header;
}

interface ServiceItem {
  typeId: number;
  version: number;
  capabilityFlags: number;
  name: string;
  supportsTCP: boolean;
  supportsUDP: boolean;
}

/**
 * Parse a ListServices response.
 */
function parseListServicesResponse(data: Uint8Array): ServiceItem[] {
  if (data.length < 26) return [];

  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const itemCount = view.getUint16(24, true);
  const items: ServiceItem[] = [];

  let offset = 26;
  for (let i = 0; i < itemCount && offset + 4 <= data.length; i++) {
    const typeId = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    offset += 4;

    if (length >= 4 && offset + length <= data.length) {
      const version = view.getUint16(offset, true);
      const capFlags = view.getUint16(offset + 2, true);
      let name = '';
      if (length >= 20) {
        const nameBytes = data.slice(offset + 4, offset + 4 + 16);
        const nullIdx = nameBytes.indexOf(0);
        name = new TextDecoder().decode(nameBytes.slice(0, nullIdx >= 0 ? nullIdx : 16));
      }
      items.push({
        typeId,
        version,
        capabilityFlags: capFlags,
        name,
        supportsTCP: (capFlags & 0x0020) !== 0,
        supportsUDP: (capFlags & 0x0100) !== 0,
      });
    }
    offset += length;
  }

  return items;
}

/** Validate common host/port params, returns error Response or null. */
function validateEIPParams(host: unknown, port: number): Response | null {
  if (!host || typeof host !== 'string' || host.trim() === '') {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

// ── New EtherNet/IP handlers ─────────────────────────────────────────────────

/**
 * Read all attributes of a CIP object (Get_Attributes_All).
 * POST /api/ethernetip/get-attribute-all
 */
export async function handleEtherNetIPGetAttributeAll(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      classId: number;
      instanceId: number;
    };

    const { host, port = 44818, timeout = 10000, classId, instanceId } = body;

    const validationError = validateEIPParams(host, port);
    if (validationError) return validationError;

    if (typeof classId !== 'number' || typeof instanceId !== 'number') {
      return new Response(JSON.stringify({
        success: false,
        error: 'classId and instanceId are required numbers',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const sessionHandle = await openEIPSession(reader, writer, timeout);

        const cipPath = buildCIPPathClassInstance(classId, instanceId);
        const pathWordSize = cipPath.length / 2;
        const cipRequest = new Uint8Array(2 + cipPath.length);
        cipRequest[0] = CIP_GET_ATTRIBUTES_ALL;
        cipRequest[1] = pathWordSize;
        cipRequest.set(cipPath, 2);

        const sendRRFrame = buildSendRRDataRequest(sessionHandle, cipRequest);
        await writer.write(sendRRFrame);

        const cipResp = await readEIPFrame(reader, Math.min(timeout - (Date.now() - startTime), 5000));
        if (cipResp.length < 24) throw new Error('No response to SendRRData');

        const { status, statusName, cipData } = parseSendRRDataResponse(cipResp);

        try {
          await writer.write(buildEIPHeader(EIP_CMD_UNREGISTER_SESSION, 0, sessionHandle));
        } catch { /* ignore */ }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const dataArray = Array.from(cipData);
        const hex = dataArray.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        const rtt = Date.now() - startTime;

        return {
          success: status === 0,
          host,
          port,
          sessionHandle: `0x${sessionHandle.toString(16).padStart(8, '0').toUpperCase()}`,
          classId: `0x${classId.toString(16).padStart(4, '0').toUpperCase()}`,
          instanceId,
          status,
          statusName,
          data: dataArray,
          hex,
          rtt,
          ...(status !== 0 && { error: `CIP error: ${statusName}` }),
        };
      } catch (err) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        throw err;
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
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Write a single CIP attribute (Set_Attribute_Single).
 * POST /api/ethernetip/set-attribute
 */
export async function handleEtherNetIPSetAttribute(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      classId: number;
      instanceId: number;
      attributeId: number;
      data: number[];
    };

    const { host, port = 44818, timeout = 10000, classId, instanceId, attributeId } = body;
    const writeData = body.data;

    const validationError = validateEIPParams(host, port);
    if (validationError) return validationError;

    if (typeof classId !== 'number' || typeof instanceId !== 'number' || typeof attributeId !== 'number') {
      return new Response(JSON.stringify({
        success: false,
        error: 'classId, instanceId, and attributeId are required numbers',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (!Array.isArray(writeData) || writeData.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'data must be a non-empty array of byte values (0-255)',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const sessionHandle = await openEIPSession(reader, writer, timeout);

        const cipPath = buildCIPPath(classId, instanceId, attributeId);
        const pathWordSize = cipPath.length / 2;
        const valueBytes = new Uint8Array(writeData);
        const cipRequest = new Uint8Array(2 + cipPath.length + valueBytes.length);
        cipRequest[0] = CIP_SET_ATTRIBUTE_SINGLE;
        cipRequest[1] = pathWordSize;
        cipRequest.set(cipPath, 2);
        cipRequest.set(valueBytes, 2 + cipPath.length);

        const sendRRFrame = buildSendRRDataRequest(sessionHandle, cipRequest);
        await writer.write(sendRRFrame);

        const cipResp = await readEIPFrame(reader, Math.min(timeout - (Date.now() - startTime), 5000));
        if (cipResp.length < 24) throw new Error('No response to SendRRData');

        const { status, statusName } = parseSendRRDataResponse(cipResp);

        try {
          await writer.write(buildEIPHeader(EIP_CMD_UNREGISTER_SESSION, 0, sessionHandle));
        } catch { /* ignore */ }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const rtt = Date.now() - startTime;

        return {
          success: status === 0,
          host,
          port,
          classId: `0x${classId.toString(16).padStart(4, '0').toUpperCase()}`,
          instanceId,
          attributeId,
          bytesWritten: writeData.length,
          status,
          statusName,
          rtt,
          ...(status !== 0 && { error: `CIP error: ${statusName}` }),
        };
      } catch (err) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        throw err;
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
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Discover supported services (ListServices, no session needed).
 * POST /api/ethernetip/list-services
 */
export async function handleEtherNetIPListServices(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 44818, timeout = 10000 } = body;

    const validationError = validateEIPParams(host, port);
    if (validationError) return validationError;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        await writer.write(buildListServicesRequest());

        const resp = await readEIPFrame(reader, Math.min(timeout, 8000));
        if (resp.length < 24) throw new Error('No response to ListServices');

        const view = new DataView(resp.buffer, resp.byteOffset, resp.length);
        const encapStatus = view.getUint32(8, true);
        if (encapStatus !== 0) {
          throw new Error(`EtherNet/IP error: 0x${encapStatus.toString(16).padStart(8, '0')}`);
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const services = parseListServicesResponse(resp);
        const rtt = Date.now() - startTime;

        return {
          success: true,
          host,
          port,
          rtt,
          serviceCount: services.length,
          services,
        };
      } catch (err) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        throw err;
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
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
