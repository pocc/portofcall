/**
 * DCERPC / MS-RPC Endpoint Mapper Protocol Support for Cloudflare Workers
 *
 * DCE/RPC (Distributed Computing Environment / Remote Procedure Calls)
 * is the foundation of Windows networking. The Endpoint Mapper (EPM)
 * on port 135 is used for service discovery and RPC interface resolution.
 *
 * Protocol (Connection-Oriented DCE/RPC v5.0):
 *   Client -> Server: Bind PDU (version 5.0, packet type 11)
 *   Server -> Client: Bind Ack PDU (packet type 12) or Bind Nak (packet type 13)
 *
 * PDU Header Format (16 bytes):
 *   [version:1][minor_ver:1][ptype:1][flags:1]
 *   [data_rep:4][frag_len:2][auth_len:2][call_id:4]
 *
 * Bind PDU Body:
 *   [max_xmit:2][max_recv:2][assoc_group:4]
 *   [context_count:1][padding:3]
 *   [context_id:2][num_transfer:1][padding:1]
 *   [abstract_syntax:20][transfer_syntax:20]
 *
 * Well-known Interface UUIDs:
 *   EPM:      e1af8308-5d1f-11c9-91a4-08002b14a0fa v3.0
 *   SAMR:     12345778-1234-abcd-ef00-0123456789ac v1.0
 *   LSARPC:   12345778-1234-abcd-ef00-0123456789ab v0.0
 *   SRVSVC:   4b324fc8-1670-01d3-1278-5a47bf6ee188 v3.0
 *   WKSSVC:   6bffd098-a112-3610-9833-46c3f87e345a v1.0
 *   NETLOGON: 12345678-1234-abcd-ef00-01234567cffb v1.0
 *   WINREG:   338cd001-2244-31f1-aaaa-900038001003 v1.0
 *   SVCCTL:   367abb81-9844-35f1-ad32-98f038001003 v2.0
 *
 * Default port: 135 (TCP)
 *
 * Use Cases:
 *   - Windows service discovery
 *   - RPC interface availability testing
 *   - Endpoint mapper probing
 *   - Security auditing of exposed RPC services
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// DCE/RPC packet types
const PTYPE_BIND = 11;
const PTYPE_BIND_ACK = 12;
const PTYPE_BIND_NAK = 13;

// NDR Transfer Syntax UUID: 8a885d04-1ceb-11c9-9fe8-08002b104860 v2.0
const NDR_TRANSFER_SYNTAX = new Uint8Array([
  0x04, 0x5d, 0x88, 0x8a, 0xeb, 0x1c, 0xc9, 0x11,
  0x9f, 0xe8, 0x08, 0x00, 0x2b, 0x10, 0x48, 0x60,
  0x02, 0x00, 0x00, 0x00, // version 2.0
]);

// Well-known RPC interface UUIDs
const WELL_KNOWN_INTERFACES: Record<string, { uuid: string; version: number; name: string }> = {
  epm: {
    uuid: 'e1af8308-5d1f-11c9-91a4-08002b14a0fa',
    version: 3,
    name: 'Endpoint Mapper (EPM)',
  },
  samr: {
    uuid: '12345778-1234-abcd-ef00-0123456789ac',
    version: 1,
    name: 'Security Account Manager (SAMR)',
  },
  lsarpc: {
    uuid: '12345778-1234-abcd-ef00-0123456789ab',
    version: 0,
    name: 'Local Security Authority (LSARPC)',
  },
  srvsvc: {
    uuid: '4b324fc8-1670-01d3-1278-5a47bf6ee188',
    version: 3,
    name: 'Server Service (SRVSVC)',
  },
  wkssvc: {
    uuid: '6bffd098-a112-3610-9833-46c3f87e345a',
    version: 1,
    name: 'Workstation Service (WKSSVC)',
  },
  netlogon: {
    uuid: '12345678-1234-abcd-ef00-01234567cffb',
    version: 1,
    name: 'Netlogon Service',
  },
  winreg: {
    uuid: '338cd001-2244-31f1-aaaa-900038001003',
    version: 1,
    name: 'Windows Registry (WINREG)',
  },
  svcctl: {
    uuid: '367abb81-9844-35f1-ad32-98f038001003',
    version: 2,
    name: 'Service Control Manager (SVCCTL)',
  },
};

/**
 * Parse a DCE/RPC UUID string into wire-format bytes (16 bytes).
 * UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * Wire format: first 3 fields are little-endian, last 2 are big-endian.
 */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error('Invalid UUID format');

  const bytes = new Uint8Array(16);

  // First field (4 bytes) - little-endian
  bytes[0] = parseInt(hex.slice(6, 8), 16);
  bytes[1] = parseInt(hex.slice(4, 6), 16);
  bytes[2] = parseInt(hex.slice(2, 4), 16);
  bytes[3] = parseInt(hex.slice(0, 2), 16);

  // Second field (2 bytes) - little-endian
  bytes[4] = parseInt(hex.slice(10, 12), 16);
  bytes[5] = parseInt(hex.slice(8, 10), 16);

  // Third field (2 bytes) - little-endian
  bytes[6] = parseInt(hex.slice(14, 16), 16);
  bytes[7] = parseInt(hex.slice(12, 14), 16);

  // Fourth field (2 bytes) - big-endian
  bytes[8] = parseInt(hex.slice(16, 18), 16);
  bytes[9] = parseInt(hex.slice(18, 20), 16);

  // Fifth field (6 bytes) - big-endian
  for (let i = 0; i < 6; i++) {
    bytes[10 + i] = parseInt(hex.slice(20 + i * 2, 22 + i * 2), 16);
  }

  return bytes;
}

/**
 * Parse wire-format UUID bytes back to string representation
 */
function bytesToUuid(bytes: Uint8Array, offset: number): string {
  // First field (4 bytes) - little-endian
  const f1 = [bytes[offset + 3], bytes[offset + 2], bytes[offset + 1], bytes[offset]];
  // Second field (2 bytes) - little-endian
  const f2 = [bytes[offset + 5], bytes[offset + 4]];
  // Third field (2 bytes) - little-endian
  const f3 = [bytes[offset + 7], bytes[offset + 6]];
  // Fourth field (2 bytes) - big-endian
  const f4 = [bytes[offset + 8], bytes[offset + 9]];
  // Fifth field (6 bytes) - big-endian
  const f5 = [bytes[offset + 10], bytes[offset + 11], bytes[offset + 12],
              bytes[offset + 13], bytes[offset + 14], bytes[offset + 15]];

  const hex = (arr: number[]) => arr.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex(f1)}-${hex(f2)}-${hex(f3)}-${hex(f4)}-${hex(f5)}`;
}

/**
 * Build a DCE/RPC Bind PDU for a given interface UUID and version
 */
function buildBindPDU(interfaceUuid: string, interfaceVersion: number): Uint8Array {
  const uuidBytes = uuidToBytes(interfaceUuid);

  // Total PDU size: 16 (header) + 12 (bind body) + 44 (context item) = 72 bytes
  const pdu = new Uint8Array(72);
  const view = new DataView(pdu.buffer);

  // Header
  pdu[0] = 5;              // version
  pdu[1] = 0;              // minor version
  pdu[2] = PTYPE_BIND;     // packet type: Bind
  pdu[3] = 0x03;           // flags: PFC_FIRST_FRAG | PFC_LAST_FRAG

  // Data representation: little-endian, ASCII, IEEE float
  pdu[4] = 0x10; pdu[5] = 0x00; pdu[6] = 0x00; pdu[7] = 0x00;

  view.setUint16(8, 72, true);    // fragment length (little-endian)
  view.setUint16(10, 0, true);    // auth length
  view.setUint32(12, 1, true);    // call ID

  // Bind body
  view.setUint16(16, 4280, true); // max transmit frag
  view.setUint16(18, 4280, true); // max receive frag
  view.setUint32(20, 0, true);    // association group

  // Context list
  pdu[24] = 1;  // num context items
  pdu[25] = 0;  // padding
  pdu[26] = 0;  // padding
  pdu[27] = 0;  // padding

  // Context item 0
  view.setUint16(28, 0, true);    // context ID
  pdu[30] = 1;                     // num transfer syntaxes
  pdu[31] = 0;                     // padding

  // Abstract syntax (interface UUID + version)
  pdu.set(uuidBytes, 32);
  view.setUint16(48, interfaceVersion, true); // interface version major
  view.setUint16(50, 0, true);                // interface version minor

  // Transfer syntax (NDR 2.0)
  pdu.set(NDR_TRANSFER_SYNTAX, 52);

  return pdu;
}

/**
 * Read a complete PDU response from the server
 */
async function readPDU(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number,
): Promise<Uint8Array> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeout)
  );

  const readPromise = (async () => {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    // Read at least 16 bytes (PDU header)
    while (totalBytes < 16) {
      const { value, done } = await reader.read();
      if (done || !value) throw new Error('Connection closed before PDU header');
      chunks.push(value);
      totalBytes += value.length;
    }

    // Combine to read fragment length
    const headerBuf = new Uint8Array(totalBytes);
    let off = 0;
    for (const chunk of chunks) {
      headerBuf.set(chunk, off);
      off += chunk.length;
    }

    // Fragment length is at offset 8, 2 bytes
    // Check data representation to determine endianness
    const isLittleEndian = (headerBuf[4] & 0x10) !== 0;
    const fragLen = isLittleEndian
      ? headerBuf[8] | (headerBuf[9] << 8)
      : (headerBuf[8] << 8) | headerBuf[9];

    if (fragLen < 16 || fragLen > 65536) {
      throw new Error(`Invalid fragment length: ${fragLen}`);
    }

    // Read remaining bytes
    while (totalBytes < fragLen) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      totalBytes += value.length;
    }

    // Combine all chunks
    const fullBuffer = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      fullBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    return fullBuffer.slice(0, fragLen);
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

// Bind Ack result codes
const RESULT_ACCEPTANCE = 0;
const RESULT_USER_REJECTION = 1;
const RESULT_PROVIDER_REJECTION = 2;

const RESULT_NAMES: Record<number, string> = {
  [RESULT_ACCEPTANCE]: 'Accepted',
  [RESULT_USER_REJECTION]: 'User Rejection',
  [RESULT_PROVIDER_REJECTION]: 'Provider Rejection',
};

const REJECTION_REASONS: Record<number, string> = {
  0: 'Reason not specified',
  1: 'Abstract syntax not supported',
  2: 'Proposed transfer syntaxes not supported',
  3: 'Local limit exceeded',
};

// Bind Nak rejection reasons
const NAK_REASONS: Record<number, string> = {
  0: 'Reason not specified',
  1: 'Temporary congestion',
  2: 'Local limit exceeded',
  3: 'Called paddr unknown',
  4: 'Protocol version not supported',
  5: 'Default context not supported',
  6: 'User data not readable',
  7: 'No psap available',
};

/**
 * Parse a Bind Ack PDU response
 */
function parseBindAck(pdu: Uint8Array): {
  maxXmitFrag: number;
  maxRecvFrag: number;
  assocGroup: number;
  secondaryAddr: string;
  resultCount: number;
  results: Array<{
    result: number;
    resultName: string;
    reason: number;
    reasonName: string;
    transferSyntax: string;
  }>;
} {
  const view = new DataView(pdu.buffer, pdu.byteOffset);
  const isLittleEndian = (pdu[4] & 0x10) !== 0;

  const read16 = (off: number) => isLittleEndian ? view.getUint16(off, true) : view.getUint16(off, false);
  const read32 = (off: number) => isLittleEndian ? view.getUint32(off, true) : view.getUint32(off, false);

  const maxXmitFrag = read16(16);
  const maxRecvFrag = read16(18);
  const assocGroup = read32(20);

  // Secondary address (length-prefixed string)
  const secAddrLen = read16(24);
  const secAddrBytes = pdu.slice(26, 26 + secAddrLen);
  // Remove null terminator if present
  const secAddr = new TextDecoder().decode(
    secAddrBytes[secAddrLen - 1] === 0 ? secAddrBytes.slice(0, -1) : secAddrBytes
  );

  // Pad to 4-byte alignment after secondary address
  let offset = 26 + secAddrLen;
  if (offset % 4 !== 0) {
    offset += 4 - (offset % 4);
  }

  // Result list
  const resultCount = pdu[offset];
  offset += 4; // count + 3 padding bytes

  const results = [];
  for (let i = 0; i < resultCount; i++) {
    const result = read16(offset);
    const reason = read16(offset + 2);
    const transferSyntax = bytesToUuid(pdu, offset + 4);
    // Skip past transfer syntax UUID (16) + version (4)
    offset += 24;

    results.push({
      result,
      resultName: RESULT_NAMES[result] || `Unknown (${result})`,
      reason,
      reasonName: REJECTION_REASONS[reason] || `Unknown (${reason})`,
      transferSyntax,
    });
  }

  return { maxXmitFrag, maxRecvFrag, assocGroup, secondaryAddr: secAddr, resultCount, results };
}

/**
 * Handle DCERPC connection test
 * Sends a Bind PDU to the EPM interface and reads the Bind Ack
 */
export async function handleDCERPCConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 135, timeout = 10000 } = body;

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

    const startTime = Date.now();
    const epm = WELL_KNOWN_INTERFACES.epm;

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send Bind PDU for the Endpoint Mapper interface
        const bindPDU = buildBindPDU(epm.uuid, epm.version);
        await writer.write(bindPDU);

        // Read response
        const response = await readPDU(reader, 5000);

        const ptype = response[2];
        if (ptype === PTYPE_BIND_NAK) {
          const reason = response[16] | (response[17] << 8);
          throw new Error(`Bind rejected (NAK): ${NAK_REASONS[reason] || `reason ${reason}`}`);
        }

        if (ptype !== PTYPE_BIND_ACK) {
          throw new Error(`Unexpected response type: ${ptype} (expected Bind Ack ${PTYPE_BIND_ACK})`);
        }

        const bindAck = parseBindAck(response);

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const rtt = Date.now() - startTime;

        return {
          success: true,
          host,
          port,
          rtt,
          protocol: {
            version: `${response[0]}.${response[1]}`,
            maxXmitFrag: bindAck.maxXmitFrag,
            maxRecvFrag: bindAck.maxRecvFrag,
            assocGroup: bindAck.assocGroup,
            secondaryAddr: bindAck.secondaryAddr || undefined,
          },
          epmResult: bindAck.results[0]
            ? {
                accepted: bindAck.results[0].result === RESULT_ACCEPTANCE,
                result: bindAck.results[0].resultName,
                transferSyntax: bindAck.results[0].transferSyntax,
              }
            : undefined,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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

// DCE/RPC Request PDU packet type
const PTYPE_REQUEST = 0;
const PTYPE_RESPONSE = 2;
const PTYPE_FAULT = 3;

// Well-known EPM endpoint UUIDs for service name lookup
const EPM_UUID_TO_SERVICE: Record<string, string> = {
  'e1af8308-5d1f-11c9-91a4-08002b14a0fa': 'Endpoint Mapper (EPMAPPER)',
  '12345778-1234-abcd-ef00-0123456789ac': 'Security Account Manager (SAMR)',
  '12345778-1234-abcd-ef00-0123456789ab': 'Local Security Authority (LSARPC)',
  '4b324fc8-1670-01d3-1278-5a47bf6ee188': 'Server Service (SRVSVC)',
  '6bffd098-a112-3610-9833-46c3f87e345a': 'Workstation Service (WKSSVC)',
  '12345678-1234-abcd-ef00-01234567cffb': 'Netlogon Service',
  '338cd001-2244-31f1-aaaa-900038001003': 'Windows Registry (WINREG)',
  '367abb81-9844-35f1-ad32-98f038001003': 'Service Control Manager (SVCCTL)',
  '82273fdc-e32a-18c3-3f78-827929dc23ea': 'EventLog (EVENTLOG)',
  'f5cc59b4-4264-101a-8c59-08002b2f8426': 'File Replication Service (NTFRS)',
  '1ff70682-0a51-30e8-076d-740be8cee98b': 'Task Scheduler (ATSVC)',
  '378e52b0-c0a9-11cf-822d-00aa0051e40f': 'Task Scheduler v1 (ATSVC)',
  '86d35949-83c9-4044-b424-db363231fd0c': 'Task Scheduler v2',
  '3919286a-b10c-11d0-9ba8-00c04fd92ef5': 'Directory Service (DSROLE)',
  'e3514235-4b06-11d1-ab04-00c04fc2dcd2': 'Directory Replication Service (DRSUAPI)',
  'c9ac6db5-82b7-4e55-ae8a-e464ed7b4277': 'System Event Notification (SENS)',
  '2f5f6521-cb55-1059-b446-00df0bce31db': 'Unimodem LRPC Interface',
  '4fc742e0-4a10-11cf-8273-00aa004ae673': 'Distributed File System (DFS)',
  '50abc2a4-574d-40b3-9d66-ee4fd5fba076': 'DNS Server (DNSSERVER)',
  'afa8bd80-7d8a-11c9-bef4-08002b102989': 'NetDDE (NDDEAPI)',
  '45f52c28-7f9f-101a-b52b-08002b2efabe': 'WINS (WINSIF)',
};

// EPM protocol tower floor IDs (per MS-RPCE and DCE/RPC spec)
const EPM_PROTOCOL_DOD_TCP  = 0x07; // TCP/IP
const EPM_PROTOCOL_DOD_UDP  = 0x08; // UDP/IP
const EPM_PROTOCOL_IP       = 0x09; // IP address
const EPM_PROTOCOL_SMB      = 0x0f; // Named Pipe over SMB
const EPM_PROTOCOL_NCALRPC  = 0x10; // NCALRPC (local RPC / named pipe)

const EPM_PROTOCOL_NAMES: Record<number, string> = {
  [EPM_PROTOCOL_DOD_TCP]:  'TCP',
  [EPM_PROTOCOL_DOD_UDP]:  'UDP',
  [EPM_PROTOCOL_IP]:       'IP',
  [EPM_PROTOCOL_SMB]:      'Named Pipe (SMB)',
  [EPM_PROTOCOL_NCALRPC]:  'LRPC/Named Pipe',
};

/**
 * Build EPM Bind + Request PDUs as separate buffers
 */
function buildEPMPDUs(): { bindPDU: Uint8Array; requestPDU: Uint8Array } {
  const epm = WELL_KNOWN_INTERFACES.epm;
  const bindPDU = buildBindPDU(epm.uuid, epm.version);

  // NDR body for ept_lookup (opnum 2)
  const ndrBody = new Uint8Array(56);
  const ndrView = new DataView(ndrBody.buffer);

  // inquiry_type = 0 (all entries)
  ndrView.setUint32(0, 0, true);
  // object pointer = 1 (non-null, points to null GUID inline)
  ndrView.setUint32(4, 1, true);
  // null GUID 16 bytes at offset 8 — already zero
  // interface pointer = 0 (null)
  ndrView.setUint32(24, 0, true);
  // vers_option = 0
  ndrView.setUint32(28, 0, true);
  // entry_handle (20 bytes) at offset 32 — all zeros
  // max_ents at offset 52
  ndrView.setUint32(52, 500, true);

  const fragLen = 16 + 8 + ndrBody.length;
  const requestPDU = new Uint8Array(fragLen);
  const reqView = new DataView(requestPDU.buffer);

  requestPDU[0] = 5;
  requestPDU[1] = 0;
  requestPDU[2] = PTYPE_REQUEST;
  requestPDU[3] = 0x03;
  requestPDU[4] = 0x10;

  reqView.setUint16(8, fragLen, true);
  reqView.setUint16(10, 0, true);
  reqView.setUint32(12, 2, true); // call_id = 2

  reqView.setUint32(16, ndrBody.length, true); // alloc_hint
  reqView.setUint16(20, 0, true);              // context_id
  reqView.setUint16(22, 2, true);              // opnum = 2 (ept_lookup)

  requestPDU.set(ndrBody, 24);

  return { bindPDU, requestPDU };
}

/**
 * Parse EPM tower floors to extract endpoint information.
 * Each floor: lhs_len(2LE) + lhs_data(lhs_len) + rhs_len(2LE) + rhs_data(rhs_len)
 */
function parseTower(data: Uint8Array, offset: number): {
  protocol: string;
  host: string | null;
  port: number | null;
  pipe: string | null;
} | null {
  if (offset + 2 > data.length) return null;

  const view = new DataView(data.buffer, data.byteOffset);
  const floorCount = view.getUint16(offset, true);
  offset += 2;

  let tcpPort: number | null = null;
  let ipHost: string | null = null;
  let protocol = 'unknown';
  let pipe: string | null = null;

  for (let f = 0; f < floorCount && f < 10; f++) {
    if (offset + 4 > data.length) break;

    const lhsLen = view.getUint16(offset, true);
    offset += 2;

    if (offset + lhsLen > data.length) break;
    const lhs = data.slice(offset, offset + lhsLen);
    offset += lhsLen;

    if (offset + 2 > data.length) break;
    const rhsLen = view.getUint16(offset, true);
    offset += 2;

    if (offset + rhsLen > data.length) break;
    const rhs = data.slice(offset, offset + rhsLen);
    offset += rhsLen;

    if (lhsLen < 1) continue;
    const protId = lhs[0];

    if (protId === EPM_PROTOCOL_DOD_TCP && rhsLen >= 2) {
      tcpPort = (rhs[0] << 8) | rhs[1];
      protocol = EPM_PROTOCOL_NAMES[protId] || 'TCP';
    } else if (protId === EPM_PROTOCOL_DOD_UDP && rhsLen >= 2) {
      tcpPort = (rhs[0] << 8) | rhs[1];
      protocol = EPM_PROTOCOL_NAMES[protId] || 'UDP';
    } else if (protId === EPM_PROTOCOL_IP && rhsLen >= 4) {
      ipHost = `${rhs[0]}.${rhs[1]}.${rhs[2]}.${rhs[3]}`;
    } else if (protId === EPM_PROTOCOL_SMB && rhsLen > 0) {
      pipe = new TextDecoder().decode(rhs).replace(/\0/g, '');
      protocol = EPM_PROTOCOL_NAMES[protId] || 'Named Pipe (SMB)';
    } else if (protId === EPM_PROTOCOL_NCALRPC && rhsLen > 0) {
      pipe = new TextDecoder().decode(rhs).replace(/\0/g, '');
      protocol = EPM_PROTOCOL_NAMES[protId] || 'LRPC';
    } else if (EPM_PROTOCOL_NAMES[protId]) {
      protocol = EPM_PROTOCOL_NAMES[protId];
    }
  }

  return { protocol, host: ipHost, port: tcpPort, pipe };
}

/**
 * Parse the NDR response body from an ept_lookup Response PDU.
 * Extracts entries with UUID, annotation, and endpoint towers.
 */
function parseEPMLookupResponse(pdu: Uint8Array): Array<{
  uuid: string;
  version: string;
  annotation: string;
  endpoint: { protocol: string; host: string | null; port: number | null; pipe: string | null };
  serviceName: string;
}> {
  const entries: Array<{
    uuid: string;
    version: string;
    annotation: string;
    endpoint: { protocol: string; host: string | null; port: number | null; pipe: string | null };
    serviceName: string;
  }> = [];

  // Response PDU body starts at offset 24 (16 header + 8 stub header: alloc_hint+ctx_id+cancel_count+reserved)
  if (pdu.length < 24) return entries;

  const view = new DataView(pdu.buffer, pdu.byteOffset);

  // Skip PDU header (16) + alloc_hint(4) + context_id(2) + cancel_count(1) + reserved(1) = 24
  let offset = 24;

  if (offset + 4 > pdu.length) return entries;

  // num_ents (4 bytes LE)
  const numEnts = view.getUint32(offset, true);
  offset += 4;

  // Array conformant size (4 bytes)
  if (offset + 4 > pdu.length) return entries;
  const arraySize = view.getUint32(offset, true);
  offset += 4;

  const count = Math.min(numEnts, arraySize, 500);

  for (let i = 0; i < count; i++) {
    if (offset + 20 > pdu.length) break;

    // Each entry: ept_entry_t
    // object: GUID (16 bytes)
    const uuidStr = bytesToUuid(pdu, offset);
    offset += 16;

    // tower pointer (4 bytes) — referent ID
    if (offset + 4 > pdu.length) break;
    offset += 4; // skip referent

    // annotation_offset (4 bytes) and annotation_length (4 bytes) for conformant string
    if (offset + 8 > pdu.length) break;
    offset += 4; // offset always 0
    const annoLen = view.getUint32(offset, true);
    offset += 4;

    // annotation string (annoLen bytes, padded to 4-byte boundary)
    let annotation = '';
    if (annoLen > 0 && offset + annoLen <= pdu.length) {
      const annoBytes = pdu.slice(offset, offset + annoLen);
      annotation = new TextDecoder().decode(annoBytes).replace(/\0/g, '').trim();
    }
    const paddedAnnoLen = annoLen + (4 - (annoLen % 4)) % 4;
    offset += paddedAnnoLen;

    // tower (inline, twr_p_t pointer then actual tower):
    // tower_length (4 bytes) then floor data
    if (offset + 4 > pdu.length) break;
    const towerLen = view.getUint32(offset, true);
    offset += 4;

    let endpoint = { protocol: 'unknown', host: null as string | null, port: null as number | null, pipe: null as string | null };
    if (towerLen > 0 && offset + towerLen <= pdu.length) {
      const towerData = pdu.slice(offset, offset + towerLen);
      const parsed = parseTower(towerData, 0);
      if (parsed) endpoint = parsed;
    }
    const paddedTowerLen = towerLen + (4 - (towerLen % 4)) % 4;
    offset += paddedTowerLen;

    // interface UUID is the first floor's LHS UUID when floors are present
    // (the object GUID above is the entry object, not necessarily the interface UUID)
    // For now use the object GUID as interface identifier
    const version = '?';

    const serviceName = EPM_UUID_TO_SERVICE[uuidStr.toLowerCase()] || annotation || `Unknown (${uuidStr})`;

    entries.push({
      uuid: uuidStr,
      version,
      annotation,
      endpoint,
      serviceName,
    });
  }

  return entries;
}

/**
 * Handle DCE/RPC Endpoint Mapper enumeration (ept_lookup)
 * Binds to the EPM interface on port 135 and enumerates registered endpoints.
 */
export async function handleDCERPCEPMEnum(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 135, timeout = 10000 } = body;

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

    const startTime = Date.now();

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const { bindPDU, requestPDU } = buildEPMPDUs();

        // Step 1: Bind to EPM interface
        await writer.write(bindPDU);
        const bindResponse = await readPDU(reader, 5000);

        const bindPtype = bindResponse[2];
        if (bindPtype === PTYPE_BIND_NAK) {
          const reason = bindResponse[16] | (bindResponse[17] << 8);
          throw new Error(`EPM bind rejected: ${NAK_REASONS[reason] || `reason ${reason}`}`);
        }
        if (bindPtype !== PTYPE_BIND_ACK) {
          throw new Error(`Unexpected bind response type: ${bindPtype}`);
        }

        const bindAck = parseBindAck(bindResponse);
        if (bindAck.results[0]?.result !== RESULT_ACCEPTANCE) {
          throw new Error(`EPM bind not accepted: ${bindAck.results[0]?.resultName || 'unknown'}`);
        }

        // Step 2: Send ept_lookup request (opnum 2)
        await writer.write(requestPDU);
        const lookupResponse = await readPDU(reader, 5000);

        const responsePtype = lookupResponse[2];
        if (responsePtype === PTYPE_FAULT) {
          throw new Error(`EPM ept_lookup fault: status=${lookupResponse[16]?.toString(16)}`);
        }
        if (responsePtype !== PTYPE_RESPONSE) {
          throw new Error(`Unexpected ept_lookup response type: ${responsePtype}`);
        }

        const entries = parseEPMLookupResponse(lookupResponse);

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const rtt = Date.now() - startTime;

        return {
          success: true,
          host,
          port,
          rtt,
          count: entries.length,
          entries,
          epmInfo: {
            maxXmitFrag: bindAck.maxXmitFrag,
            maxRecvFrag: bindAck.maxRecvFrag,
            secondaryAddr: bindAck.secondaryAddr || undefined,
          },
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'EPM enumeration failed',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
 * Handle DCERPC interface probe
 * Tests whether a specific RPC interface is available on the target
 */
export async function handleDCERPCProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      interfaceName?: string;
      interfaceUuid?: string;
      interfaceVersion?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Determine interface to probe
    let uuid: string;
    let version: number;
    let interfaceName: string;

    if (body.interfaceName && WELL_KNOWN_INTERFACES[body.interfaceName.toLowerCase()]) {
      const iface = WELL_KNOWN_INTERFACES[body.interfaceName.toLowerCase()];
      uuid = iface.uuid;
      version = iface.version;
      interfaceName = iface.name;
    } else if (body.interfaceUuid) {
      // Validate UUID format
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.interfaceUuid)) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid UUID format. Expected: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      uuid = body.interfaceUuid.toLowerCase();
      version = body.interfaceVersion ?? 0;
      interfaceName = `Custom (${uuid})`;
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: 'Specify interfaceName (epm, samr, lsarpc, srvsvc, wkssvc, netlogon, winreg, svcctl) or interfaceUuid',
        availableInterfaces: Object.entries(WELL_KNOWN_INTERFACES).map(([key, val]) => ({
          name: key,
          description: val.name,
          uuid: val.uuid,
          version: val.version,
        })),
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = body.host;
    const port = body.port || 135;
    const timeout = body.timeout || 10000;

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

    const startTime = Date.now();

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send Bind PDU for the requested interface
        const bindPDU = buildBindPDU(uuid, version);
        await writer.write(bindPDU);

        // Read response
        const response = await readPDU(reader, 5000);
        const ptype = response[2];

        let probeResult: Record<string, unknown>;

        if (ptype === PTYPE_BIND_NAK) {
          const reason = response[16] | (response[17] << 8);
          probeResult = {
            available: false,
            response: 'Bind NAK',
            reason: NAK_REASONS[reason] || `Unknown (${reason})`,
          };
        } else if (ptype === PTYPE_BIND_ACK) {
          const bindAck = parseBindAck(response);
          const ctxResult = bindAck.results[0];

          probeResult = {
            available: ctxResult ? ctxResult.result === RESULT_ACCEPTANCE : false,
            response: 'Bind Ack',
            result: ctxResult?.resultName || 'No result',
            reason: ctxResult && ctxResult.result !== RESULT_ACCEPTANCE
              ? ctxResult.reasonName
              : undefined,
            secondaryAddr: bindAck.secondaryAddr || undefined,
            maxXmitFrag: bindAck.maxXmitFrag,
            maxRecvFrag: bindAck.maxRecvFrag,
          };
        } else {
          probeResult = {
            available: false,
            response: `Unexpected type ${ptype}`,
          };
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const rtt = Date.now() - startTime;

        return {
          success: true,
          host,
          port,
          rtt,
          interface: {
            name: interfaceName,
            uuid,
            version,
          },
          ...probeResult,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Probe failed',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
