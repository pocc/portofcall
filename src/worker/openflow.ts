/**
 * OpenFlow Protocol Implementation (Binary over TCP)
 *
 * OpenFlow is the foundational protocol for Software-Defined Networking (SDN).
 * It defines the communication between an SDN controller and network switches,
 * allowing centralized control of network forwarding decisions.
 *
 * Protocol Flow:
 * 1. Client connects to OpenFlow port (default 6653, legacy 6633)
 * 2. Both sides exchange HELLO messages (version negotiation)
 * 3. Client sends FEATURES_REQUEST to discover switch capabilities
 * 4. Server responds with FEATURES_REPLY containing datapath ID, tables, etc.
 *
 * Message Format (8-byte header):
 * - 1 byte:  version (0x01=1.0, 0x04=1.3, 0x06=1.5)
 * - 1 byte:  type
 * - 2 bytes: length (big-endian, includes header)
 * - 4 bytes: xid (transaction ID, big-endian)
 *
 * Key Message Types:
 * - HELLO (0)            → Version negotiation
 * - ERROR (1)            → Error notification
 * - ECHO_REQUEST (2)     → Keep-alive ping
 * - ECHO_REPLY (3)       → Keep-alive response
 * - FEATURES_REQUEST (5) → Request switch capabilities
 * - FEATURES_REPLY (6)   → Switch capabilities response
 * - GET_CONFIG_REQ (7)   → Request switch configuration
 * - GET_CONFIG_REPLY (8) → Switch configuration
 *
 * Docs: https://opennetworking.org/software-defined-standards/specifications/
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// OpenFlow message types
const OFPT_HELLO = 0;
const OFPT_ERROR = 1;
const OFPT_ECHO_REQUEST = 2;
const OFPT_ECHO_REPLY = 3;
const OFPT_FEATURES_REQUEST = 5;
const OFPT_FEATURES_REPLY = 6;
const OFPT_GET_CONFIG_REQUEST = 7;
const OFPT_GET_CONFIG_REPLY = 8;

// OpenFlow version constants
const OFP_VERSION_1_0 = 0x01;
const OFP_VERSION_1_1 = 0x02;
const OFP_VERSION_1_2 = 0x03;
const OFP_VERSION_1_3 = 0x04;
const OFP_VERSION_1_4 = 0x05;
const OFP_VERSION_1_5 = 0x06;

const VERSION_NAMES: Record<number, string> = {
  [OFP_VERSION_1_0]: 'OpenFlow 1.0',
  [OFP_VERSION_1_1]: 'OpenFlow 1.1',
  [OFP_VERSION_1_2]: 'OpenFlow 1.2',
  [OFP_VERSION_1_3]: 'OpenFlow 1.3',
  [OFP_VERSION_1_4]: 'OpenFlow 1.4',
  [OFP_VERSION_1_5]: 'OpenFlow 1.5',
};

const TYPE_NAMES: Record<number, string> = {
  [OFPT_HELLO]: 'HELLO',
  [OFPT_ERROR]: 'ERROR',
  [OFPT_ECHO_REQUEST]: 'ECHO_REQUEST',
  [OFPT_ECHO_REPLY]: 'ECHO_REPLY',
  4: 'EXPERIMENTER',
  [OFPT_FEATURES_REQUEST]: 'FEATURES_REQUEST',
  [OFPT_FEATURES_REPLY]: 'FEATURES_REPLY',
  [OFPT_GET_CONFIG_REQUEST]: 'GET_CONFIG_REQUEST',
  [OFPT_GET_CONFIG_REPLY]: 'GET_CONFIG_REPLY',
};

// OF 1.0 capabilities bitmask
const OFPC_FLOW_STATS = 1 << 0;
const OFPC_TABLE_STATS = 1 << 1;
const OFPC_PORT_STATS = 1 << 2;
const OFPC_GROUP_STATS = 1 << 3;
const OFPC_IP_REASM = 1 << 5;
const OFPC_QUEUE_STATS = 1 << 6;
const OFPC_PORT_BLOCKED = 1 << 8;

const CAPABILITY_FLAGS: Array<{ mask: number; name: string }> = [
  { mask: OFPC_FLOW_STATS, name: 'FLOW_STATS' },
  { mask: OFPC_TABLE_STATS, name: 'TABLE_STATS' },
  { mask: OFPC_PORT_STATS, name: 'PORT_STATS' },
  { mask: OFPC_GROUP_STATS, name: 'GROUP_STATS' },
  { mask: OFPC_IP_REASM, name: 'IP_REASM' },
  { mask: OFPC_QUEUE_STATS, name: 'QUEUE_STATS' },
  { mask: OFPC_PORT_BLOCKED, name: 'PORT_BLOCKED' },
];

// OF error types
const ERROR_TYPE_NAMES: Record<number, string> = {
  0: 'HELLO_FAILED',
  1: 'BAD_REQUEST',
  2: 'BAD_ACTION',
  3: 'BAD_INSTRUCTION',
  4: 'BAD_MATCH',
  5: 'FLOW_MOD_FAILED',
  6: 'GROUP_MOD_FAILED',
  7: 'PORT_MOD_FAILED',
  8: 'TABLE_MOD_FAILED',
  9: 'MULTIPART_REQUEST_FAILED',
  10: 'QUEUE_OP_FAILED',
  11: 'SWITCH_CONFIG_FAILED',
  12: 'ROLE_REQUEST_FAILED',
  13: 'METER_MOD_FAILED',
  14: 'TABLE_FEATURES_FAILED',
};

/**
 * Build an OpenFlow message
 */
function buildMessage(version: number, type: number, xid: number, payload?: Uint8Array): Uint8Array {
  const headerLen = 8;
  const payloadLen = payload ? payload.length : 0;
  const totalLen = headerLen + payloadLen;
  const msg = new Uint8Array(totalLen);
  const view = new DataView(msg.buffer);

  msg[0] = version;
  msg[1] = type;
  view.setUint16(2, totalLen);
  view.setUint32(4, xid);

  if (payload) {
    msg.set(payload, headerLen);
  }

  return msg;
}

/**
 * Parse an OpenFlow message header and body from raw bytes
 */
function parseMessage(data: Uint8Array): {
  version: number;
  versionName: string;
  type: number;
  typeName: string;
  length: number;
  xid: number;
  payload: Uint8Array;
  // FEATURES_REPLY fields (OF 1.0/1.3)
  datapathId?: string;
  nBuffers?: number;
  nTables?: number;
  auxiliaryId?: number;
  capabilities?: number;
  capabilityNames?: string[];
  // GET_CONFIG_REPLY fields
  flags?: number;
  missSendLen?: number;
  // ERROR fields
  errorType?: number;
  errorTypeName?: string;
  errorCode?: number;
} | null {
  if (data.length < 8) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.length);
  const version = data[0];
  const type = data[1];
  const length = view.getUint16(2);
  const xid = view.getUint32(4);

  if (data.length < length) return null;

  const payload = data.slice(8, length);

  const result: NonNullable<ReturnType<typeof parseMessage>> = {
    version,
    versionName: VERSION_NAMES[version] || `Unknown(0x${version.toString(16)})`,
    type,
    typeName: TYPE_NAMES[type] || `UNKNOWN(${type})`,
    length,
    xid,
    payload,
  };

  // Parse FEATURES_REPLY
  if (type === OFPT_FEATURES_REPLY && payload.length >= 24) {
    const pView = new DataView(payload.buffer, payload.byteOffset, payload.length);

    // Datapath ID is 8 bytes (big-endian)
    const dpHigh = pView.getUint32(0);
    const dpLow = pView.getUint32(4);
    result.datapathId = dpHigh.toString(16).padStart(8, '0') + ':' + dpLow.toString(16).padStart(8, '0');

    result.nBuffers = pView.getUint32(8);
    result.nTables = payload[12];

    if (version >= OFP_VERSION_1_3) {
      result.auxiliaryId = payload[13];
    }

    // Capabilities at offset 16 (4 bytes)
    result.capabilities = pView.getUint32(16);
    result.capabilityNames = [];
    for (const { mask, name } of CAPABILITY_FLAGS) {
      if ((result.capabilities & mask) !== 0) {
        result.capabilityNames.push(name);
      }
    }
  }

  // Parse GET_CONFIG_REPLY
  if (type === OFPT_GET_CONFIG_REPLY && payload.length >= 4) {
    const pView = new DataView(payload.buffer, payload.byteOffset, payload.length);
    result.flags = pView.getUint16(0);
    result.missSendLen = pView.getUint16(2);
  }

  // Parse ERROR
  if (type === OFPT_ERROR && payload.length >= 4) {
    const pView = new DataView(payload.buffer, payload.byteOffset, payload.length);
    result.errorType = pView.getUint16(0);
    result.errorTypeName = ERROR_TYPE_NAMES[result.errorType] || `UNKNOWN(${result.errorType})`;
    result.errorCode = pView.getUint16(2);
  }

  return result;
}

/**
 * Read a complete OpenFlow message from a socket reader
 */
async function readMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number,
): Promise<Uint8Array | null> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Read timeout')), timeout);
  });

  let buffer = new Uint8Array(0);

  while (true) {
    const readResult = await Promise.race([reader.read(), timeoutPromise]) as ReadableStreamReadResult<Uint8Array>;
    if (readResult.done) return buffer.length > 0 ? buffer : null;

    if (readResult.value) {
      const newBuf = new Uint8Array(buffer.length + readResult.value.length);
      newBuf.set(buffer);
      newBuf.set(readResult.value, buffer.length);
      buffer = newBuf;
    }

    // Check if we have a complete message (need at least 8 bytes for header)
    if (buffer.length >= 8) {
      const msgLen = (buffer[2] << 8) | buffer[3];
      if (buffer.length >= msgLen) {
        return buffer.slice(0, msgLen);
      }
    }
  }
}

/**
 * Handle OpenFlow probe - connect, exchange HELLO, request features
 * POST /api/openflow/probe
 */
export async function handleOpenFlowProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      version?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const host = body.host;
    const port = body.port !== undefined ? body.port : 6653;
    const version = body.version || OFP_VERSION_1_3;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
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
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);
    const connectTime = Date.now() - startTime;

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    let xid = 1;

    // Send HELLO
    const helloMsg = buildMessage(version, OFPT_HELLO, xid++);
    await writer.write(helloMsg);

    // Read server HELLO
    let serverHello: ReturnType<typeof parseMessage> = null;
    let featuresReply: ReturnType<typeof parseMessage> = null;
    let errorMsg: ReturnType<typeof parseMessage> = null;

    try {
      const helloData = await readMessage(reader, timeout);
      if (helloData) {
        const parsed = parseMessage(helloData);
        if (parsed) {
          if (parsed.type === OFPT_HELLO) {
            serverHello = parsed;
          } else if (parsed.type === OFPT_ERROR) {
            errorMsg = parsed;
          }
        }
      }
    } catch {
      // Read timeout or error
    }

    // If we got a HELLO, negotiate and send FEATURES_REQUEST
    if (serverHello) {
      const negotiatedVersion = Math.min(version, serverHello.version);
      const featReq = buildMessage(negotiatedVersion, OFPT_FEATURES_REQUEST, xid++);
      await writer.write(featReq);

      try {
        const featData = await readMessage(reader, timeout);
        if (featData) {
          const parsed = parseMessage(featData);
          if (parsed) {
            if (parsed.type === OFPT_FEATURES_REPLY) {
              featuresReply = parsed;
            } else if (parsed.type === OFPT_ERROR) {
              errorMsg = parsed;
            }
          }
        }
      } catch {
        // Features request may be rejected
      }
    }

    const rtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    if (serverHello) {
      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          connectTime,
          protocol: 'OpenFlow',
          serverVersion: serverHello.version,
          serverVersionName: serverHello.versionName,
          negotiatedVersion: Math.min(version, serverHello.version),
          negotiatedVersionName: VERSION_NAMES[Math.min(version, serverHello.version)] || 'Unknown',
          features: featuresReply
            ? {
                datapathId: featuresReply.datapathId,
                nBuffers: featuresReply.nBuffers,
                nTables: featuresReply.nTables,
                auxiliaryId: featuresReply.auxiliaryId,
                capabilities: featuresReply.capabilityNames,
                capabilitiesRaw: featuresReply.capabilities,
              }
            : null,
          error: errorMsg
            ? {
                type: errorMsg.errorTypeName,
                code: errorMsg.errorCode,
              }
            : null,
          message: `OpenFlow switch detected in ${rtt}ms`,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (errorMsg) {
      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          connectTime,
          protocol: 'OpenFlow',
          serverVersion: null,
          features: null,
          error: {
            type: errorMsg.errorTypeName,
            code: errorMsg.errorCode,
          },
          message: `OpenFlow error: ${errorMsg.errorTypeName}`,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        connectTime,
        protocol: 'OpenFlow',
        serverVersion: null,
        features: null,
        error: null,
        message: 'Connected but no OpenFlow response received',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'OpenFlow connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Handle OpenFlow echo request - send ECHO_REQUEST, expect ECHO_REPLY
 * POST /api/openflow/echo
 *
 * Useful for testing if the OpenFlow channel is alive.
 */
export async function handleOpenFlowEcho(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      version?: number;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const host = body.host;
    const port = body.port !== undefined ? body.port : 6653;
    const version = body.version || OFP_VERSION_1_3;
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
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
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    let xid = 1;

    // Must exchange HELLO first
    await writer.write(buildMessage(version, OFPT_HELLO, xid++));

    let serverVersion = version;
    try {
      const helloData = await readMessage(reader, timeout);
      if (helloData) {
        const parsed = parseMessage(helloData);
        if (parsed && parsed.type === OFPT_HELLO) {
          serverVersion = Math.min(version, parsed.version);
        }
      }
    } catch {
      // Continue with default version
    }

    // Send ECHO_REQUEST with timestamp payload
    const echoPayload = new Uint8Array(8);
    const echoView = new DataView(echoPayload.buffer);
    const echoSendTime = Date.now();
    echoView.setFloat64(0, echoSendTime);

    await writer.write(buildMessage(serverVersion, OFPT_ECHO_REQUEST, xid++, echoPayload));

    let echoReply: ReturnType<typeof parseMessage> = null;
    try {
      const echoData = await readMessage(reader, timeout);
      if (echoData) {
        const parsed = parseMessage(echoData);
        if (parsed && parsed.type === OFPT_ECHO_REPLY) {
          echoReply = parsed;
        }
      }
    } catch {
      // Echo timeout
    }

    const echoRtt = Date.now() - echoSendTime;
    const totalRtt = Date.now() - startTime;

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new Response(
      JSON.stringify({
        success: !!echoReply,
        host,
        port,
        rtt: totalRtt,
        echoRtt,
        protocol: 'OpenFlow',
        negotiatedVersion: serverVersion,
        negotiatedVersionName: VERSION_NAMES[serverVersion] || 'Unknown',
        echoReceived: !!echoReply,
        echoXid: echoReply?.xid ?? null,
        message: echoReply
          ? `Echo reply received in ${echoRtt}ms`
          : 'No echo reply received',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'OpenFlow echo failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// OpenFlow stats/multipart message types
const OFPT_STATS_REQUEST_10 = 16;  // OF 1.0
const OFPT_STATS_REPLY_10 = 17;    // OF 1.0
const OFPT_MULTIPART_REQUEST_13 = 18; // OF 1.3+
const OFPT_MULTIPART_REPLY_13 = 19;   // OF 1.3+

// Stats body types (same values for OF 1.0 and 1.3)
const OFPST_DESC = 0;   // Switch description
const OFPST_FLOW = 1;   // Individual flow statistics
const OFPST_TABLE = 3;  // Table statistics
const OFPST_PORT = 4;   // Port statistics

// OF 1.0 port structure size (48 bytes per port in FEATURES_REPLY, 104 bytes in PORT_STATS)
const OF10_PORT_STATS_SIZE = 104;
// OF 1.3 port stats size = 112 bytes
const OF13_PORT_STATS_SIZE = 112;
// OF 1.0 table stats size = 64 bytes
const OF10_TABLE_STATS_SIZE = 64;
// OF 1.3 table stats size = 24 bytes
const OF13_TABLE_STATS_SIZE = 24;

type StatsType = 'flow' | 'port' | 'table' | 'desc';

/**
 * Handle OpenFlow stats request — fetch statistics from an OpenFlow switch.
 * Supports DESC, PORT, TABLE, and FLOW stats for both OF 1.0 and OF 1.3.
 * POST /api/openflow/stats
 */
export async function handleOpenFlowStats(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      timeout?: number;
      statsType?: StatsType;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const host = body.host;
    const port = body.port !== undefined ? body.port : 6653;
    const timeout = body.timeout || 10000;
    const statsType: StatsType = body.statsType || 'desc';

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const validStatsTypes: StatsType[] = ['flow', 'port', 'table', 'desc'];
    if (!validStatsTypes.includes(statsType)) {
      return new Response(
        JSON.stringify({ success: false, error: 'statsType must be one of: flow, port, table, desc' }),
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
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    let xid = 1;
    let negotiatedVersion = OFP_VERSION_1_3;

    // ------------------------------------------------------------------
    // 1. HELLO exchange
    // ------------------------------------------------------------------
    await writer.write(buildMessage(OFP_VERSION_1_3, OFPT_HELLO, xid++));

    try {
      const helloData = await readMessage(reader, timeout);
      if (helloData) {
        const parsed = parseMessage(helloData);
        if (parsed && parsed.type === OFPT_HELLO) {
          negotiatedVersion = Math.min(OFP_VERSION_1_3, parsed.version);
        }
      }
    } catch {
      // Continue with default version
    }

    // ------------------------------------------------------------------
    // 2. FEATURES_REQUEST — required before stats on some switches
    // ------------------------------------------------------------------
    await writer.write(buildMessage(negotiatedVersion, OFPT_FEATURES_REQUEST, xid++));
    try {
      const featData = await readMessage(reader, timeout);
      if (featData) {
        const parsed = parseMessage(featData);
        if (parsed && parsed.type !== OFPT_FEATURES_REPLY) {
          // Non-fatal; continue
        }
      }
    } catch {
      // Continue
    }

    // ------------------------------------------------------------------
    // 3. Build STATS_REQUEST / MULTIPART_REQUEST body
    // ------------------------------------------------------------------
    // Determine numeric body type
    let statsBodyType: number;
    switch (statsType) {
      case 'desc':  statsBodyType = OFPST_DESC; break;
      case 'flow':  statsBodyType = OFPST_FLOW; break;
      case 'table': statsBodyType = OFPST_TABLE; break;
      case 'port':  statsBodyType = OFPST_PORT; break;
    }

    // Build stats request payload
    // Format: 2 bytes body-type + 2 bytes flags + optional body
    let statsReqPayload: Uint8Array;

    if (statsType === 'flow') {
      // FLOW_STATS_REQUEST body (OF 1.0): match (40 bytes) + table_id + pad + out_port
      // OF 1.3 flow stats request is different but we send a wildcard match
      if (negotiatedVersion <= OFP_VERSION_1_0) {
        // OF 1.0: 2 (type) + 2 (flags) + 40 (match) + 1 (table) + 1 (pad) + 2 (out_port)
        statsReqPayload = new Uint8Array(48);
        const sv = new DataView(statsReqPayload.buffer);
        sv.setUint16(0, statsBodyType);
        sv.setUint16(2, 0); // flags
        // Match: wildcards = 0x003fffff (all wildcards) at offset 4
        sv.setUint32(4, 0x003fffff); // all wildcards
        statsReqPayload[44] = 0xff; // table_id = 0xff (all tables)
        sv.setUint16(46, 0xffff);   // out_port = OFPP_NONE
      } else {
        // OF 1.3: 2 (type) + 2 (flags) + 4 (reserved) + OXM match (minimal: 4 bytes type+len)
        statsReqPayload = new Uint8Array(16);
        const sv = new DataView(statsReqPayload.buffer);
        sv.setUint16(0, statsBodyType);
        sv.setUint16(2, 0); // flags
        // table_id = 0xff (all tables) at offset 4
        statsReqPayload[4] = 0xff;
        // out_port = OFPP_ANY = 0xffffffff at offset 8
        sv.setUint32(8, 0xffffffff);
        // out_group = OFPG_ANY = 0xffffffff at offset 12 (pad)
        sv.setUint32(12, 0xffffffff);
        // Minimal OXM match would follow — omit for now (empty match = match all)
      }
    } else if (statsType === 'port') {
      // PORT_STATS_REQUEST: 2 (type) + 2 (flags) + 2 (port_no) + padding
      if (negotiatedVersion <= OFP_VERSION_1_0) {
        statsReqPayload = new Uint8Array(8);
        const sv = new DataView(statsReqPayload.buffer);
        sv.setUint16(0, statsBodyType);
        sv.setUint16(2, 0); // flags
        sv.setUint16(4, 0xffff); // OFPP_NONE = all ports (OF 1.0)
      } else {
        statsReqPayload = new Uint8Array(8);
        const sv = new DataView(statsReqPayload.buffer);
        sv.setUint16(0, statsBodyType);
        sv.setUint16(2, 0); // flags
        sv.setUint32(4, 0xffffffff); // OFPP_ANY = all ports (OF 1.3)
      }
    } else {
      // DESC and TABLE require only the 2-byte type + 2-byte flags header (no body)
      statsReqPayload = new Uint8Array(4);
      const sv = new DataView(statsReqPayload.buffer);
      sv.setUint16(0, statsBodyType);
      sv.setUint16(2, 0); // flags
    }

    // Choose message type based on negotiated version
    const statsReqType = negotiatedVersion <= OFP_VERSION_1_0
      ? OFPT_STATS_REQUEST_10
      : OFPT_MULTIPART_REQUEST_13;

    await writer.write(buildMessage(negotiatedVersion, statsReqType, xid++, statsReqPayload));

    // ------------------------------------------------------------------
    // 4. Read STATS_REPLY / MULTIPART_REPLY (may come in multiple parts)
    // ------------------------------------------------------------------
    const statsReplyType = negotiatedVersion <= OFP_VERSION_1_0
      ? OFPT_STATS_REPLY_10
      : OFPT_MULTIPART_REPLY_13;

    let replyPayload: Uint8Array | null = null;
    let gotReply = false;

    try {
      // Read up to 3 messages looking for the stats reply
      for (let attempt = 0; attempt < 3; attempt++) {
        const msgData = await readMessage(reader, timeout);
        if (!msgData) break;
        const parsed = parseMessage(msgData);
        if (!parsed) break;
        if (parsed.type === statsReplyType && parsed.payload.length >= 4) {
          // payload starts with: 2 (type) + 2 (flags) + body
          replyPayload = parsed.payload;
          gotReply = true;
          // Check MORE flag (bit 0 of flags) — for simplicity we read one reply
          // flags are at offset 2 of payload
          const flags = (parsed.payload[2] << 8) | parsed.payload[3];
          if (!(flags & 0x0001)) break; // no MORE flag, we have all data
        } else if (parsed.type === OFPT_ERROR) {
          break;
        }
      }
    } catch {
      // Timeout reading stats reply
    }

    const rtt = Date.now() - startTime;
    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    if (!gotReply || !replyPayload) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          rtt,
          statsType,
          protocol: 'OpenFlow',
          negotiatedVersion,
          negotiatedVersionName: VERSION_NAMES[negotiatedVersion] || 'Unknown',
          error: 'No stats reply received — switch may not support this stats type',
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ------------------------------------------------------------------
    // 5. Parse stats reply body (starts at offset 4 of payload: skip type+flags)
    // ------------------------------------------------------------------
    const statsBody = replyPayload.slice(4);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let statsData: any = null;

    if (statsType === 'desc') {
      // DESC reply: five null-padded strings, each 256 bytes
      // mfr_desc[256] + hw_desc[256] + sw_desc[256] + serial_num[32] + dp_desc[256]
      function readPaddedString(offset: number, len: number): string {
        const end = Math.min(offset + len, statsBody.length);
        let termIdx = offset;
        while (termIdx < end && statsBody[termIdx] !== 0) termIdx++;
        const decoder = new TextDecoder();
        return decoder.decode(statsBody.slice(offset, termIdx)).trim();
      }

      if (statsBody.length >= 1056) {
        statsData = {
          manufacturer: readPaddedString(0, 256),
          hardware: readPaddedString(256, 256),
          software: readPaddedString(512, 256),
          serial: readPaddedString(768, 32),
          datapath: readPaddedString(800, 256),
        };
      } else {
        statsData = { error: `DESC body too short: ${statsBody.length} bytes` };
      }

    } else if (statsType === 'port') {
      // PORT_STATS reply: array of port-stat structs
      const portSize = negotiatedVersion <= OFP_VERSION_1_0 ? OF10_PORT_STATS_SIZE : OF13_PORT_STATS_SIZE;
      const ports: object[] = [];
      let offset = 0;

      while (offset + portSize <= statsBody.length) {
        if (negotiatedVersion <= OFP_VERSION_1_0) {
          // OF 1.0 port stats: port_no(2) + pad(6) + rx_packets(8) + tx_packets(8) + ...
          const ps = new DataView(statsBody.buffer, statsBody.byteOffset + offset, portSize);
          ports.push({
            portNo: ps.getUint16(0),
            rxPackets: Number(ps.getBigUint64(8)),
            txPackets: Number(ps.getBigUint64(16)),
            rxBytes: Number(ps.getBigUint64(24)),
            txBytes: Number(ps.getBigUint64(32)),
            rxDropped: Number(ps.getBigUint64(40)),
            txDropped: Number(ps.getBigUint64(48)),
            rxErrors: Number(ps.getBigUint64(56)),
            txErrors: Number(ps.getBigUint64(64)),
          });
        } else {
          // OF 1.3 port stats: port_no(4) + pad(4) + rx_packets(8) + tx_packets(8) + ...
          const ps = new DataView(statsBody.buffer, statsBody.byteOffset + offset, portSize);
          ports.push({
            portNo: ps.getUint32(0),
            rxPackets: Number(ps.getBigUint64(8)),
            txPackets: Number(ps.getBigUint64(16)),
            rxBytes: Number(ps.getBigUint64(24)),
            txBytes: Number(ps.getBigUint64(32)),
            rxDropped: Number(ps.getBigUint64(40)),
            txDropped: Number(ps.getBigUint64(48)),
            rxErrors: Number(ps.getBigUint64(56)),
            txErrors: Number(ps.getBigUint64(64)),
          });
        }
        offset += portSize;
      }
      statsData = { ports };

    } else if (statsType === 'table') {
      // TABLE_STATS reply: array of table-stat structs
      const tableSize = negotiatedVersion <= OFP_VERSION_1_0 ? OF10_TABLE_STATS_SIZE : OF13_TABLE_STATS_SIZE;
      const tables: object[] = [];
      let offset = 0;

      while (offset + tableSize <= statsBody.length) {
        if (negotiatedVersion <= OFP_VERSION_1_0) {
          // OF 1.0: table_id(1) + pad(3) + name(32) + wildcards(4) + max_entries(4) + active_count(4)
          //       + lookup_count(8) + matched_count(8)
          const ts = new DataView(statsBody.buffer, statsBody.byteOffset + offset, tableSize);
          const nameBytes = statsBody.slice(offset + 4, offset + 36);
          let nameEnd = 0;
          while (nameEnd < nameBytes.length && nameBytes[nameEnd] !== 0) nameEnd++;
          const tableName = new TextDecoder().decode(nameBytes.slice(0, nameEnd));
          tables.push({
            tableId: ts.getUint8(0),
            name: tableName,
            maxEntries: ts.getUint32(40),
            activeCount: ts.getUint32(44),
            lookups: Number(ts.getBigUint64(48)),
            matched: Number(ts.getBigUint64(56)),
          });
        } else {
          // OF 1.3: table_id(1) + pad(3) + active_count(4) + lookup_count(8) + matched_count(8)
          const ts = new DataView(statsBody.buffer, statsBody.byteOffset + offset, tableSize);
          tables.push({
            tableId: ts.getUint8(0),
            activeCount: ts.getUint32(4),
            lookups: Number(ts.getBigUint64(8)),
            matched: Number(ts.getBigUint64(16)),
          });
        }
        offset += tableSize;
      }
      statsData = { tables };

    } else if (statsType === 'flow') {
      // FLOW_STATS reply: variable-length flow records
      const flows: object[] = [];

      if (negotiatedVersion <= OFP_VERSION_1_0) {
        // OF 1.0 flow stats: length(2) + table_id(1) + pad(1) + match(40) + duration_sec(4)
        //   + duration_nsec(4) + priority(2) + idle_timeout(2) + hard_timeout(2) + pad(6)
        //   + cookie(8) + packet_count(8) + byte_count(8) + actions[...]
        let offset = 0;
        while (offset + 4 <= statsBody.length) {
          const fs = new DataView(statsBody.buffer, statsBody.byteOffset + offset, Math.min(88, statsBody.length - offset));
          const flowLen = fs.getUint16(0);
          if (flowLen < 88 || offset + flowLen > statsBody.length) break;
          flows.push({
            tableId: statsBody[offset + 2],
            priority: fs.getUint16(58),
            idleTimeout: fs.getUint16(60),
            hardTimeout: fs.getUint16(62),
            cookie: `0x${fs.getUint32(68).toString(16).padStart(8, '0')}${fs.getUint32(72).toString(16).padStart(8, '0')}`,
            packetCount: Number(fs.getBigUint64(76)),
            byteCount: Number(fs.getBigUint64(84)),
          });
          offset += flowLen;
        }
      } else {
        // OF 1.3 flow stats: length(2) + table_id(1) + pad(1) + duration_sec(4) + duration_nsec(4)
        //   + priority(2) + idle_timeout(2) + hard_timeout(2) + flags(2) + pad(4)
        //   + cookie(8) + packet_count(8) + byte_count(8) + match + instructions
        let offset = 0;
        while (offset + 56 <= statsBody.length) {
          const fs = new DataView(statsBody.buffer, statsBody.byteOffset + offset, Math.min(56, statsBody.length - offset));
          const flowLen = fs.getUint16(0);
          if (flowLen < 56 || offset + flowLen > statsBody.length) break;
          flows.push({
            tableId: statsBody[offset + 2],
            priority: fs.getUint16(14),
            idleTimeout: fs.getUint16(16),
            hardTimeout: fs.getUint16(18),
            flags: fs.getUint16(20),
            cookie: `0x${fs.getUint32(24).toString(16).padStart(8, '0')}${fs.getUint32(28).toString(16).padStart(8, '0')}`,
            packetCount: Number(fs.getBigUint64(32)),
            byteCount: Number(fs.getBigUint64(40)),
          });
          offset += flowLen;
        }
      }
      statsData = { flows };
    }

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        rtt,
        statsType,
        protocol: 'OpenFlow',
        negotiatedVersion,
        negotiatedVersionName: VERSION_NAMES[negotiatedVersion] || 'Unknown',
        stats: statsData,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'OpenFlow stats failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
