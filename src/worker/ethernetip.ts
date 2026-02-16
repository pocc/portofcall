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

// Device status bit descriptions
const DEVICE_STATUS_BITS: Record<number, string> = {
  0x0001: 'Owned',
  0x0004: 'Configured',
  0x0010: 'Extended Device Status (Minor Recoverable Fault)',
  0x0020: 'Extended Device Status (Minor Unrecoverable Fault)',
  0x0030: 'Extended Device Status (Major Recoverable Fault)',
  0x0040: 'Extended Device Status (Major Unrecoverable Fault)',
  0x0100: 'Minor Recoverable Fault',
  0x0200: 'Minor Unrecoverable Fault',
  0x0400: 'Major Recoverable Fault',
  0x0800: 'Major Unrecoverable Fault',
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

/**
 * Build a ListIdentity encapsulation request (24 bytes, no data)
 */
function buildListIdentityRequest(): Uint8Array {
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);

  // Command: ListIdentity (0x0063) - little-endian
  view.setUint16(0, 0x0063, true);
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

  if (length < 33) return identity; // minimum identity item size

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
  for (const [bit, desc] of Object.entries(DEVICE_STATUS_BITS)) {
    if (identity.status & parseInt(bit)) {
      statusParts.push(desc);
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
