/**
 * Sybase Protocol Implementation (TDS - Tabular Data Stream)
 *
 * Sybase Adaptive Server Enterprise (ASE) is a relational database management
 * system developed by Sybase Inc. (now part of SAP). It uses the Tabular Data
 * Stream (TDS) protocol, which was later adopted by Microsoft for SQL Server.
 *
 * Protocol Overview:
 * - Port: 5000 (default, configurable)
 * - Transport: TCP
 * - Format: TDS (Tabular Data Stream) binary protocol
 * - Versions: TDS 4.x, 5.0 (Sybase), 7.x+ (Microsoft SQL Server)
 *
 * TDS Protocol Structure:
 * - Packet Header (8 bytes):
 *   - Type (1 byte): Packet type (Login, Query, Response, etc.)
 *   - Status (1 byte): Status flags (EOM, Ignore, etc.)
 *   - Length (2 bytes): Total packet length (big-endian)
 *   - SPID (2 bytes): Server Process ID (big-endian)
 *   - Packet Number (1 byte): Sequence number
 *   - Window (1 byte): Window size (unused)
 *
 * TDS Packet Types:
 * - 0x01: Query (SQL batch)
 * - 0x02: Login - Client login request
 * - 0x03: RPC - Remote Procedure Call
 * - 0x04: Response - Server response
 * - 0x05: Attention - Cancel request
 * - 0x06: Bulk Load - Bulk insert
 * - 0x07: Transaction Manager - DTC request
 * - 0x0E: Login7 - SQL Server 7.0+ login
 * - 0x10: SSPI - SSPI message
 * - 0x11: Prelogin - Pre-login handshake
 * - 0x12: TDS7+ - TDS 7.x protocol
 *
 * TDS Status Flags:
 * - 0x00: Normal
 * - 0x01: EOM (End of Message)
 * - 0x02: Ignore this packet
 * - 0x04: Event notification
 * - 0x08: Reset connection
 * - 0x10: Reset connection keep transaction
 *
 * Login Packet (Type 0x02):
 * - Client hostname, username, password
 * - Application name, server name
 * - Interface library name
 * - Language, character set
 *
 * Response Packet (Type 0x04):
 * - Token stream: Results, errors, messages
 * - Login acknowledgment token (0xAD)
 * - Environment change token (0xE3)
 * - Error token (0xAA)
 * - Done token (0xFD)
 *
 * Connection Flow:
 * 1. Client → Server: Login packet (Type 0x02)
 * 2. Server → Client: Response packet (Type 0x04) with Login Ack
 * 3. Client → Server: Query packet (Type 0x01)
 * 4. Server → Client: Response packet with result set
 *
 * Use Cases:
 * - Enterprise Sybase ASE detection
 * - Database server inventory
 * - Legacy system analysis
 * - SAP infrastructure mapping
 * - TDS protocol forensics
 *
 * Modern Usage:
 * - Still used in enterprise SAP environments
 * - Legacy financial systems
 * - Mainframe integration
 * - Replaced by SAP HANA in many deployments
 *
 * Reference:
 * - http://www.freetds.org/tds.html
 * - Sybase ASE documentation
 */

import { connect } from 'cloudflare:sockets';

interface SybaseRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface SybaseResponse {
  success: boolean;
  host: string;
  port: number;
  packetType?: number;
  packetTypeName?: string;
  status?: number;
  length?: number;
  isSybase?: boolean;
  rtt?: number;
  error?: string;
}

// TDS Packet Types
enum TDSPacketType {
  Query = 0x01,
  Login = 0x02,
  RPC = 0x03,
  Response = 0x04,
  Attention = 0x05,
  BulkLoad = 0x06,
  TransactionManager = 0x07,
  Login7 = 0x0E,
  SSPI = 0x10,
  Prelogin = 0x11,
}

/**
 * Build simple TDS login packet (Type 0x02)
 * This is a minimal login for detection purposes
 */
// function buildTDSLogin(): Buffer {
//   // TDS Login packet structure (simplified)
//   // Real login packets are more complex with client info, hostname, etc.

//   // Login packet data (minimal)
//   const loginData = Buffer.allocUnsafe(512);
//   loginData.fill(0);

//   // Simplified login structure
//   // In a real implementation, this would contain:
//   // - Client hostname
//   // - Username
//   // - Password (encrypted)
//   // - Application name
//   // - Server name
//   // - Library name
//   // - Language
//   // - Character set

//   // For detection, we send minimal data
//   loginData.write('probe', 0, 'ascii'); // Dummy client name

//   // Build TDS header
//   const header = Buffer.allocUnsafe(8);
//   header.writeUInt8(TDSPacketType.Login, 0); // Packet type: Login
//   header.writeUInt8(0x01, 1); // Status: EOM (End of Message)
//   header.writeUInt16BE(512 + 8, 2); // Length: header + data
//   header.writeUInt16BE(0, 4); // SPID: 0
//   header.writeUInt8(0, 6); // Packet number: 0
//   header.writeUInt8(0, 7); // Window: 0

//   return Buffer.concat([header, loginData]);
// }

/**
 * Build TDS Prelogin packet (Type 0x11)
 * Used in newer TDS versions (7.x+) for initial handshake
 */
function buildTDSPrelogin(): Buffer {
  // Prelogin packet data
  const preloginData = Buffer.allocUnsafe(25);
  let offset = 0;

  // Version option (0x00)
  preloginData.writeUInt8(0x00, offset); // Token: Version
  offset += 1;
  preloginData.writeUInt16BE(5, offset); // Offset to data
  offset += 2;
  preloginData.writeUInt16BE(6, offset); // Length: 6 bytes
  offset += 2;

  // Terminator (0xFF)
  preloginData.writeUInt8(0xFF, offset);
  offset += 1;

  // Version data: Major.Minor.Build (6 bytes)
  preloginData.writeUInt8(9, offset); // Major: 9
  offset += 1;
  preloginData.writeUInt8(0, offset); // Minor: 0
  offset += 1;
  preloginData.writeUInt16BE(0, offset); // Build: 0
  offset += 2;
  preloginData.writeUInt16BE(0, offset); // Sub-build: 0
  offset += 2;

  // Padding
  preloginData.fill(0, offset);

  // Build TDS header
  const header = Buffer.allocUnsafe(8);
  header.writeUInt8(TDSPacketType.Prelogin, 0); // Packet type: Prelogin
  header.writeUInt8(0x01, 1); // Status: EOM
  header.writeUInt16BE(preloginData.length + 8, 2); // Length
  header.writeUInt16BE(0, 4); // SPID: 0
  header.writeUInt8(0, 6); // Packet number: 0
  header.writeUInt8(0, 7); // Window: 0

  return Buffer.concat([header, preloginData]);
}

/**
 * Parse TDS packet header
 */
function parseTDSPacket(data: Buffer): {
  type: number;
  status: number;
  length: number;
  spid: number;
  packetNumber: number;
  window: number;
  payload: Buffer;
} | null {
  if (data.length < 8) {
    return null;
  }

  const type = data.readUInt8(0);
  const status = data.readUInt8(1);
  const length = data.readUInt16BE(2);
  const spid = data.readUInt16BE(4);
  const packetNumber = data.readUInt8(6);
  const window = data.readUInt8(7);

  const payload = data.subarray(8, Math.min(length, data.length));

  return {
    type,
    status,
    length,
    spid,
    packetNumber,
    window,
    payload,
  };
}

/**
 * Probe Sybase server by sending TDS login/prelogin packet.
 * Detects Sybase ASE and TDS protocol support.
 */
export async function handleSybaseProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SybaseRequest;
    const { host, port = 5000, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies SybaseResponse), {
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
      } satisfies SybaseResponse), {
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

      // Try Prelogin first (newer TDS versions), fallback to Login
      const prelogin = buildTDSPrelogin();

      const writer = socket.writable.getWriter();
      await writer.write(prelogin);
      writer.releaseLock();

      // Read server response
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
          error: 'No response from Sybase server',
        } satisfies SybaseResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseTDSPacket(Buffer.from(value));

      if (!parsed) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid TDS packet format',
        } satisfies SybaseResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      // Map packet type to name
      const packetTypeNames: { [key: number]: string } = {
        [TDSPacketType.Query]: 'Query',
        [TDSPacketType.Login]: 'Login',
        [TDSPacketType.RPC]: 'RPC',
        [TDSPacketType.Response]: 'Response',
        [TDSPacketType.Attention]: 'Attention',
        [TDSPacketType.BulkLoad]: 'Bulk Load',
        [TDSPacketType.TransactionManager]: 'Transaction Manager',
        [TDSPacketType.Login7]: 'Login7',
        [TDSPacketType.SSPI]: 'SSPI',
        [TDSPacketType.Prelogin]: 'Prelogin',
      };

      // Check if response is valid TDS (Response or Prelogin response)
      const isSybase = parsed.type === TDSPacketType.Response ||
                       parsed.type === TDSPacketType.Prelogin;

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        packetType: parsed.type,
        packetTypeName: packetTypeNames[parsed.type] || `Unknown (0x${parsed.type.toString(16)})`,
        status: parsed.status,
        length: parsed.length,
        isSybase,
        rtt,
      } satisfies SybaseResponse), {
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
      port: 5000,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies SybaseResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Get Sybase server version information.
 * Same as probe but with focus on version extraction.
 */
export async function handleSybaseVersion(request: Request): Promise<Response> {
  // Reuse probe logic
  return handleSybaseProbe(request);
}
