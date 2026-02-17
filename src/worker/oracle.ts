/**
 * Oracle Database (TNS Protocol) Support for Cloudflare Workers
 * Port: 1521 (default)
 * Protocol: TNS (Transparent Network Substrate) - Oracle's proprietary protocol
 * Complexity: Very High
 *
 * TNS Packet Structure (8-byte header):
 * - Bytes 0-1: Packet length (big-endian, includes header)
 * - Bytes 2-3: Packet checksum (usually 0x0000)
 * - Byte 4: Packet type (1=Connect, 2=Accept, 3=Ack, 4=Refuse, 5=Redirect, 6=Data)
 * - Byte 5: Reserved/Flags
 * - Bytes 6-7: Header checksum
 *
 * References:
 * - https://www.oreilly.com/library/view/the-oracle-r-hackers/9780470080221/9780470080221_the_tns_protocol.html
 * - https://github.com/redwood-wire-protocol/oracle-database-wire-protocol-unofficial-specification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface OracleConnectionOptions {
  host: string;
  port?: number;
  serviceName?: string;
  sid?: string;
  timeout?: number;
}

// TNS Packet Types
const TNS_PACKET_TYPE = {
  CONNECT: 1,
  ACCEPT: 2,
  ACK: 3,
  REFUSE: 4,
  REDIRECT: 5,
  DATA: 6,
  NULL: 7,
  ABORT: 9,
  RESEND: 11,
  MARKER: 12,
  ATTENTION: 13,
  CONTROL: 14,
} as const;

/**
 * Create TNS packet header (8 bytes)
 */
function createTNSHeader(
  length: number,
  packetType: number,
  checksum = 0,
  headerChecksum = 0
): Uint8Array {
  const header = new Uint8Array(8);

  // Bytes 0-1: Packet length (big-endian)
  header[0] = (length >> 8) & 0xFF;
  header[1] = length & 0xFF;

  // Bytes 2-3: Packet checksum (usually 0x0000)
  header[2] = (checksum >> 8) & 0xFF;
  header[3] = checksum & 0xFF;

  // Byte 4: Packet type
  header[4] = packetType;

  // Byte 5: Reserved/Flags (0x00)
  header[5] = 0x00;

  // Bytes 6-7: Header checksum (usually 0x0000)
  header[6] = (headerChecksum >> 8) & 0xFF;
  header[7] = headerChecksum & 0xFF;

  return header;
}

/**
 * Create TNS Connect packet
 * This initiates a connection to the Oracle database
 */
function createConnectPacket(host: string, port: number, serviceName: string, sid?: string): Uint8Array {
  // TNS protocol version 314 (0x013A) is widely compatible
  const version = 0x013A;
  const versionCompatible = 0x013A;

  // Service options
  const serviceOptions = 0x0C41; // Standard options

  // Session Data Unit (SDU) size
  const sduSize = 0x2000; // 8192 bytes

  // Maximum Transmission Unit (MTU) size
  const mtuSize = 0x7FFF; // 32767 bytes

  // NT protocol characteristics
  const ntProtocolCharacteristics = 0x7F08;

  // Line turnaround value
  const lineTurnaround = 0x0000;

  // Value of 1 in hardware
  const value1 = 0x0001;

  // Connect data length (will be calculated)
  // Connect data format: (DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=...)(PORT=...))(CONNECT_DATA=(SERVICE_NAME=...)))
  let connectData: string;
  if (sid) {
    connectData = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${sid})))`;
  } else {
    connectData = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SERVICE_NAME=${serviceName})))`;
  }

  const connectDataBytes = new TextEncoder().encode(connectData);
  const connectDataLength = connectDataBytes.length;

  // Calculate total packet length
  // Header (8) + Version (2) + Version Compatible (2) + Service Options (2) +
  // SDU Size (2) + MTU Size (2) + NT Protocol Characteristics (2) +
  // Line Turnaround (2) + Value of 1 (2) + Connect Data Length (2) + Connect Data
  const packetLength = 8 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + connectDataLength;

  // Create packet buffer
  const packet = new Uint8Array(packetLength);
  let offset = 0;

  // Header
  const header = createTNSHeader(packetLength, TNS_PACKET_TYPE.CONNECT);
  packet.set(header, offset);
  offset += 8;

  // Version (big-endian)
  packet[offset++] = (version >> 8) & 0xFF;
  packet[offset++] = version & 0xFF;

  // Version Compatible (big-endian)
  packet[offset++] = (versionCompatible >> 8) & 0xFF;
  packet[offset++] = versionCompatible & 0xFF;

  // Service Options (big-endian)
  packet[offset++] = (serviceOptions >> 8) & 0xFF;
  packet[offset++] = serviceOptions & 0xFF;

  // SDU Size (big-endian)
  packet[offset++] = (sduSize >> 8) & 0xFF;
  packet[offset++] = sduSize & 0xFF;

  // MTU Size (big-endian)
  packet[offset++] = (mtuSize >> 8) & 0xFF;
  packet[offset++] = mtuSize & 0xFF;

  // NT Protocol Characteristics (big-endian)
  packet[offset++] = (ntProtocolCharacteristics >> 8) & 0xFF;
  packet[offset++] = ntProtocolCharacteristics & 0xFF;

  // Line Turnaround (big-endian)
  packet[offset++] = (lineTurnaround >> 8) & 0xFF;
  packet[offset++] = lineTurnaround & 0xFF;

  // Value of 1 (big-endian)
  packet[offset++] = (value1 >> 8) & 0xFF;
  packet[offset++] = value1 & 0xFF;

  // Connect Data Length (big-endian)
  packet[offset++] = (connectDataLength >> 8) & 0xFF;
  packet[offset++] = connectDataLength & 0xFF;

  // Connect Data
  packet.set(connectDataBytes, offset);

  return packet;
}

/**
 * Parse TNS packet header
 */
function parseTNSHeader(data: Uint8Array): {
  length: number;
  checksum: number;
  type: number;
  flags: number;
  headerChecksum: number;
} | null {
  if (data.length < 8) {
    return null;
  }

  return {
    length: (data[0] << 8) | data[1],
    checksum: (data[2] << 8) | data[3],
    type: data[4],
    flags: data[5],
    headerChecksum: (data[6] << 8) | data[7],
  };
}

/**
 * Get packet type name
 */
function getPacketTypeName(type: number): string {
  const typeNames: Record<number, string> = {
    1: 'CONNECT',
    2: 'ACCEPT',
    3: 'ACK',
    4: 'REFUSE',
    5: 'REDIRECT',
    6: 'DATA',
    7: 'NULL',
    9: 'ABORT',
    11: 'RESEND',
    12: 'MARKER',
    13: 'ATTENTION',
    14: 'CONTROL',
  };
  return typeNames[type] || `UNKNOWN(${type})`;
}

/**
 * Parse TNS Accept packet to extract version info
 */
function parseAcceptPacket(data: Uint8Array): {
  version: number;
  serviceOptions: number;
  sduSize: number;
} | null {
  if (data.length < 16) {
    return null;
  }

  // Skip header (8 bytes)
  let offset = 8;

  // Version (2 bytes, big-endian)
  const version = (data[offset] << 8) | data[offset + 1];
  offset += 2;

  // Service Options (2 bytes, big-endian)
  const serviceOptions = (data[offset] << 8) | data[offset + 1];
  offset += 2;

  // SDU Size (2 bytes, big-endian)
  const sduSize = (data[offset] << 8) | data[offset + 1];

  return { version, serviceOptions, sduSize };
}

/**
 * Parse TNS Refuse packet to extract error information
 */
function parseRefusePacket(data: Uint8Array): {
  refuseCode: number;
  refuseDataLength: number;
  refuseData: string;
} | null {
  if (data.length < 10) {
    return null;
  }

  // Skip header (8 bytes)
  let offset = 8;

  // Refuse Code (1 byte) - reason for refusal
  const refuseCode = data[offset++];

  // Refuse Data Length (2 bytes, big-endian)
  const refuseDataLength = (data[offset] << 8) | data[offset + 1];
  offset += 2;

  // Refuse Data (variable length, typically error message)
  let refuseData = '';
  if (refuseDataLength > 0 && offset + refuseDataLength <= data.length) {
    refuseData = new TextDecoder().decode(data.slice(offset, offset + refuseDataLength));
  }

  return { refuseCode, refuseDataLength, refuseData };
}

/**
 * Create a TNS DATA packet wrapping a text payload string.
 * Structure: header(8) + data_flags(2) + payload_bytes
 */
function createTNSDataPacket(payload: string): Uint8Array {
  const payloadBytes = new TextEncoder().encode(payload);
  // TNS DATA packet: header(8) + data_flags(2) + payload
  const totalLength = 8 + 2 + payloadBytes.length;
  const packet = new Uint8Array(totalLength);

  const header = createTNSHeader(totalLength, TNS_PACKET_TYPE.DATA);
  packet.set(header, 0);

  // Data flags (2 bytes, big-endian) — 0x0000 for normal data
  packet[8] = 0x00;
  packet[9] = 0x00;

  packet.set(payloadBytes, 10);
  return packet;
}

/**
 * Extract all occurrences of a TNS descriptor key from a response string.
 * E.g. extractTNSValues(text, "SERVICE_NAME") returns all values in SERVICE_NAME=... entries.
 */
function extractTNSValues(text: string, key: string): string[] {
  const results: string[] = [];
  const upperText = text.toUpperCase();
  const upperKey = key.toUpperCase() + '=';
  let searchFrom = 0;

  while (true) {
    const idx = upperText.indexOf(upperKey, searchFrom);
    if (idx === -1) break;

    const valueStart = idx + upperKey.length;
    if (valueStart >= text.length) break;

    let valueEnd: number;
    if (text[valueStart] === '(') {
      // Nested descriptor — find matching ')'
      let depth = 1;
      valueEnd = valueStart + 1;
      while (valueEnd < text.length && depth > 0) {
        if (text[valueEnd] === '(') depth++;
        else if (text[valueEnd] === ')') depth--;
        valueEnd++;
      }
    } else {
      // Simple value — terminated by ')' or end of string
      valueEnd = text.indexOf(')', valueStart);
      if (valueEnd === -1) valueEnd = text.length;
    }

    const value = text.slice(valueStart, valueEnd).trim();
    if (value && !results.includes(value)) {
      results.push(value);
    }
    searchFrom = valueEnd;
  }

  return results;
}

/**
 * Handle Oracle TNS connection test (HTTP mode)
 * Tests basic connectivity to Oracle database via TNS protocol
 */
export async function handleOracleConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<OracleConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<OracleConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '1521'),
        serviceName: url.searchParams.get('serviceName') || undefined,
        sid: url.searchParams.get('sid') || undefined,
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      };
    }

    // Validate required fields
    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Either serviceName or SID is required
    if (!options.serviceName && !options.sid) {
      return new Response(JSON.stringify({
        error: 'Either serviceName or sid is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 1521;
    const timeoutMs = options.timeout || 30000;
    const serviceName = options.serviceName || '';
    const sid = options.sid;

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

    // Wrap entire connection in timeout
    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Create and send TNS Connect packet
        const connectPacket = createConnectPacket(host, port, serviceName, sid);
        await writer.write(connectPacket);

        // Read response packet
        const { value, done } = await reader.read();

        if (done || !value || value.length < 8) {
          throw new Error('Invalid TNS response');
        }

        // Parse TNS header
        const header = parseTNSHeader(value);
        if (!header) {
          throw new Error('Failed to parse TNS header');
        }

        const packetTypeName = getPacketTypeName(header.type);

        // Handle different response types
        if (header.type === TNS_PACKET_TYPE.ACCEPT) {
          // Connection accepted!
          const acceptInfo = parseAcceptPacket(value);

          await socket.close();

          return {
            success: true,
            message: 'Oracle TNS connection accepted',
            host,
            port,
            serviceName: serviceName || undefined,
            sid: sid || undefined,
            packetType: packetTypeName,
            protocol: {
              version: acceptInfo?.version ? `0x${acceptInfo.version.toString(16)}` : 'Unknown',
              sduSize: acceptInfo?.sduSize || 0,
              serviceOptions: acceptInfo?.serviceOptions ? `0x${acceptInfo.serviceOptions.toString(16)}` : 'Unknown',
            },
            note: 'TNS handshake successful. Connection accepted by Oracle listener.',
          };
        } else if (header.type === TNS_PACKET_TYPE.REFUSE) {
          // Connection refused
          const refuseInfo = parseRefusePacket(value);

          await socket.close();

          return {
            success: false,
            error: `Oracle TNS connection refused: ${refuseInfo?.refuseData || 'Unknown error'}`,
            host,
            port,
            packetType: packetTypeName,
            refuseCode: refuseInfo?.refuseCode,
            refuseReason: refuseInfo?.refuseData,
          };
        } else if (header.type === TNS_PACKET_TYPE.REDIRECT) {
          // Connection redirected to another listener
          await socket.close();

          return {
            success: false,
            error: 'Oracle TNS connection redirected. Follow redirect manually.',
            host,
            port,
            packetType: packetTypeName,
            note: 'The listener redirected the connection to another address.',
          };
        } else {
          // Unexpected packet type
          await socket.close();

          return {
            success: false,
            error: `Unexpected TNS packet type: ${packetTypeName}`,
            host,
            port,
            packetType: packetTypeName,
          };
        }
      } catch (error) {
        await socket.close();
        throw error;
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
 * Handle Oracle TNS Listener Status — query the listener for service names,
 * instance names, version info, and endpoints without needing credentials.
 *
 * Sends a TNS DATA packet with the status command string:
 *   (CONNECT_DATA=(COMMAND=STATUS))
 * The Oracle listener responds with a TNS DATA packet containing a descriptor
 * like TNSLSNR version, DESCRIPTION_LIST with service/instance info, etc.
 *
 * Request body: { host, port?, timeout? }
 * Response:     { listenerVersion, services, endpoints, rtt }
 */
export async function handleOracleTNSServices(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 1521, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
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

    const connectionPromise = (async () => {
      const startTime = Date.now();

      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send a TNS Connect packet first (required by some Oracle versions to
        // establish the TNS session before a DATA packet is accepted)
        const connectPacket = createConnectPacket(host, port, 'LISTENER', undefined);
        await writer.write(connectPacket);

        // Read the initial response (ACCEPT, REFUSE, or REDIRECT)
        let initialResp: Uint8Array | null = null;
        {
          const readResult = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Read timeout')), Math.min(timeout, 5000)),
            ),
          ]);
          if (!readResult.done && readResult.value) {
            initialResp = readResult.value;
          }
        }

        if (!initialResp || initialResp.length < 8) {
          throw new Error('No response to TNS Connect');
        }

        const initialHeader = parseTNSHeader(initialResp);
        if (!initialHeader) throw new Error('Failed to parse initial TNS response');

        // If REFUSED, we may still try DATA directly. If REDIRECT, note the address.
        // If ACCEPTED, send the status DATA packet.
        // Some listeners respond REFUSE to LISTENER service_name but still answer STATUS.
        // We proceed to send the status command regardless.

        // Send the STATUS command as a TNS DATA packet
        const statusPayload = '(CONNECT_DATA=(COMMAND=STATUS))';
        const dataPacket = createTNSDataPacket(statusPayload);
        await writer.write(dataPacket);

        // Collect all response data (may come in multiple chunks)
        const responseChunks: Uint8Array[] = [];
        let responseTotal = 0;
        const readDeadline = Date.now() + Math.min(timeout, 8000);

        while (Date.now() < readDeadline && responseTotal < 128 * 1024) {
          const remaining = readDeadline - Date.now();
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await Promise.race([
              reader.read(),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Read timeout')), remaining),
              ),
            ]);
          } catch {
            break;
          }
          if (chunk.done || !chunk.value) break;
          responseChunks.push(chunk.value);
          responseTotal += chunk.value.length;

          // Stop once we have a reasonably complete response
          if (responseTotal > 1024) break;
        }

        const rtt = Date.now() - startTime;

        if (responseTotal === 0) {
          // Try to extract info from the initial response (some listeners reply directly)
          const initText = new TextDecoder('utf-8', { fatal: false }).decode(initialResp);
          return buildOracleServicesResult(host, port, initText, initialHeader.type, rtt);
        }

        // Combine chunks
        const combined = new Uint8Array(responseTotal);
        let combineOff = 0;
        for (const c of responseChunks) { combined.set(c, combineOff); combineOff += c.length; }

        // Decode as text (TNS STATUS response is ASCII/text-based)
        const responseText = new TextDecoder('utf-8', { fatal: false }).decode(combined);

        return buildOracleServicesResult(host, port, responseText, -1, rtt);

      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { await socket.close(); } catch { /* ignore */ }
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Parse the Oracle listener STATUS response text and build the structured result.
 */
function buildOracleServicesResult(
  host: string,
  port: number,
  responseText: string,
  packetType: number,
  rtt: number,
): object {
  // Extract listener version — typically appears as:
  //   "TNSLSNR for Linux: Version X.Y.Z" or similar
  let listenerVersion: string | null = null;
  const versionPatterns = [
    /TNSLSNR[^:]*:\s*Version\s+([\d.]+)/i,
    /Version\s+([\d.]+\.\d+\.\d+\.\d+)/i,
  ];
  for (const pat of versionPatterns) {
    const m = responseText.match(pat);
    if (m) { listenerVersion = m[1]; break; }
  }

  // Extract service names
  const serviceNames = extractTNSValues(responseText, 'SERVICE_NAME');

  // Extract instance names
  const instanceNames = extractTNSValues(responseText, 'INSTANCE_NAME');

  // Extract endpoints (HOST/PORT pairs from DESCRIPTION or ADDRESS blocks)
  const endpoints: string[] = [];
  const addrRegex = /\(ADDRESS=\([^)]*HOST=([^)]+)\)[^)]*PORT=(\d+)[^)]*\)/gi;
  let addrMatch: RegExpExecArray | null;
  while ((addrMatch = addrRegex.exec(responseText)) !== null) {
    const ep = `${addrMatch[1].trim()}:${addrMatch[2].trim()}`;
    if (!endpoints.includes(ep)) endpoints.push(ep);
  }

  // Build services array by pairing service names with instance names
  const services = serviceNames.map((sn, i) => ({
    serviceName: sn,
    instanceName: instanceNames[i] ?? instanceNames[0] ?? null,
    status: 'READY',
  }));

  // If no service names found but we have instance names, emit them
  if (services.length === 0 && instanceNames.length > 0) {
    instanceNames.forEach(inst => {
      services.push({ serviceName: null as unknown as string, instanceName: inst, status: 'UNKNOWN' });
    });
  }

  const rawResponsePreview = responseText.slice(0, 2048).replace(/\x00/g, '');

  return {
    success: true,
    host,
    port,
    packetType: packetType >= 0 ? getPacketTypeName(packetType) : undefined,
    listenerVersion,
    services,
    endpoints,
    rawResponse: rawResponsePreview,
    rtt,
  };
}
