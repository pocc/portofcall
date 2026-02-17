/**
 * Apache ZooKeeper Protocol Implementation
 *
 * Implements ZooKeeper connectivity testing using "Four-Letter Words" (4LW)
 * commands - simple text commands for health checking and monitoring.
 *
 * Protocol Flow:
 * 1. Client connects to server port 2181
 * 2. Client sends a 4-letter command (ruok, srvr, stat, etc.)
 * 3. Server responds with text output
 * 4. Server closes connection
 *
 * Four-Letter Word Commands:
 * - ruok: Are you OK? Server responds "imok" if healthy
 * - srvr: Server details (version, mode, connections)
 * - stat: Server statistics and connected clients
 * - conf: Server configuration
 * - envi: Server environment
 * - mntr: Monitoring data in key=value format
 *
 * Use Cases:
 * - ZooKeeper health checking
 * - Server version detection
 * - Cluster status monitoring
 * - Connection count tracking
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Valid four-letter word commands
const VALID_COMMANDS = ['ruok', 'srvr', 'stat', 'conf', 'envi', 'mntr', 'cons', 'dump', 'wchs', 'dirs', 'isro'];

// ZooKeeper Jute operation type constants
const ZK_OP = {
  CREATE: 1,
  DELETE: 2,
  EXISTS: 3,
  GET_DATA: 4,
  SET_DATA: 5,
} as const;

// ZooKeeper error codes
const ZK_ERR: Record<number, string> = {
  0: 'OK',
  [-101]: 'ZNONODE: Node does not exist',
  [-102]: 'ZNOAUTH: Not authenticated',
  [-103]: 'ZBADVERSION: Version conflict',
  [-108]: 'ZNOCHILDRENFOREPHEMERALS: Ephemeral nodes may not have children',
  [-110]: 'ZNODEEXISTS: Node already exists',
  [-111]: 'ZNOTEMPTY: Directory not empty',
  [-112]: 'ZSESSIONEXPIRED: Session expired',
  [-113]: 'ZINVALIDCALLBACK: Invalid callback',
  [-114]: 'ZINVALIDACL: Invalid ACL',
  [-115]: 'ZAUTHFAILED: Authentication failed',
  [-116]: 'ZCLOSING: ZooKeeper is closing',
  [-117]: 'ZNOTHING: No server responses to process',
  [-118]: 'ZSESSIONMOVED: Session moved to another server',
};

/**
 * Wrap payload with a 4-byte big-endian length prefix
 */
function zkEncode(payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, payload.length, false);
  frame.set(payload, 4);
  return frame;
}

/**
 * Encode a string as ZooKeeper Jute string: 4BE length + UTF-8 bytes
 */
function encodeString(s: string): Uint8Array {
  const encoded = new TextEncoder().encode(s);
  const buf = new Uint8Array(4 + encoded.length);
  const view = new DataView(buf.buffer);
  view.setInt32(0, encoded.length, false);
  buf.set(encoded, 4);
  return buf;
}

/**
 * Decode a ZooKeeper Jute string from a buffer at a given offset
 * Returns the decoded string and the new offset after the string
 */
function decodeString(buf: Uint8Array, offset: number): { value: string; newOffset: number } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = view.getInt32(offset, false);
  offset += 4;
  if (len < 0) {
    return { value: '', newOffset: offset };
  }
  const value = new TextDecoder().decode(buf.slice(offset, offset + len));
  return { value, newOffset: offset + len };
}

/**
 * Read a framed ZooKeeper packet (4BE length prefix + payload)
 */
async function zkReadPacket(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<Uint8Array> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('ZooKeeper read timeout')), timeoutMs)
  );

  const readPromise = (async () => {
    let buffer = new Uint8Array(0);

    const append = (chunk: Uint8Array) => {
      const next = new Uint8Array(buffer.length + chunk.length);
      next.set(buffer);
      next.set(chunk, buffer.length);
      buffer = next;
    };

    // Read until we have the 4-byte length header
    while (buffer.length < 4) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed before length header received');
      append(value);
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const frameLen = view.getInt32(0, false);
    const totalNeeded = 4 + frameLen;

    while (buffer.length < totalNeeded) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed mid-packet');
      append(value);
    }

    return buffer.slice(4, totalNeeded);
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Establish a ZooKeeper session by sending the connect packet and reading the response.
 * Returns sessionId (as bigint) and the negotiated timeout.
 */
async function zkConnect(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  timeoutMs: number
): Promise<{ sessionId: bigint; timeout: number }> {
  // Connect packet: protocolVersion(4) + lastZxidSeen(4) + timeOut(4) + sessionId(8) + passwd_len(4) + passwd(16 zeros)
  // Total payload = 4+4+4+8+4+16 = 40 bytes (but ZK counts passwd_len as part of length field separately)
  // Standard ZK connect request: 4+4+4+8+4 header fields + 16-byte password = 40 bytes
  const payload = new Uint8Array(40);
  const view = new DataView(payload.buffer);
  view.setInt32(0, 0, false);        // protocolVersion = 0
  view.setInt32(4, 0, false);        // lastZxidSeen = 0
  view.setInt32(8, 30000, false);    // timeOut = 30000ms
  // sessionId: 8 bytes at offset 12, leave as 0
  view.setInt32(20, 16, false);      // passwd length = 16
  // passwd: 16 zero bytes at offset 24 (already zero)

  await writer.write(zkEncode(payload));

  // Read connect response
  const resp = await zkReadPacket(reader, timeoutMs);
  const rv = new DataView(resp.buffer, resp.byteOffset, resp.byteLength);
  // protocolVersion(4) + timeOut(4) + sessionId(8) + passwd_len(4) + passwd(?)
  const negotiatedTimeout = rv.getInt32(4, false);

  // sessionId is a 64-bit value starting at byte 8
  const sessionIdHigh = rv.getUint32(8, false);
  const sessionIdLow = rv.getUint32(12, false);
  const sessionId = (BigInt(sessionIdHigh) << BigInt(32)) | BigInt(sessionIdLow);

  return { sessionId, timeout: negotiatedTimeout };
}

/**
 * Send a ZooKeeper Jute request and return the response payload bytes and error code.
 */
async function zkRequest(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  xid: number,
  opType: number,
  payload: Uint8Array,
  timeoutMs: number
): Promise<{ err: number; data: Uint8Array }> {
  // Request header: xid(4BE) + type(4BE) + payload
  const header = new Uint8Array(8);
  const hv = new DataView(header.buffer);
  hv.setInt32(0, xid, false);
  hv.setInt32(4, opType, false);

  const req = new Uint8Array(header.length + payload.length);
  req.set(header);
  req.set(payload, header.length);

  await writer.write(zkEncode(req));

  const resp = await zkReadPacket(reader, timeoutMs);
  // Response: xid(4BE) + zxid(8BE) + err(4BE) + response-payload
  const rv = new DataView(resp.buffer, resp.byteOffset, resp.byteLength);
  const err = rv.getInt32(12, false);  // offset 4(xid) + 8(zxid) = 12
  const data = resp.slice(16);          // offset 4+8+4 = 16

  return { err, data };
}

/**
 * Send a four-letter word command to a ZooKeeper server
 */
async function sendFourLetterWord(
  host: string,
  port: number,
  command: string,
  timeout: number,
): Promise<string> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  try {
    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Send the four-letter command
    await writer.write(new TextEncoder().encode(command));

    // Read the response (server sends text then closes connection)
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const maxResponseSize = 64 * 1024; // 64KB max

    try {
      while (totalBytes < maxResponseSize) {
        const { value, done } = await Promise.race([
          reader.read(),
          timeoutPromise,
        ]);

        if (done || !value) break;

        chunks.push(value);
        totalBytes += value.length;
      }
    } catch {
      // Connection closed by server (expected)
      if (chunks.length === 0) {
        throw new Error('Server closed connection without responding');
      }
    }

    // Combine chunks
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    writer.releaseLock();
    reader.releaseLock();
    socket.close();

    return new TextDecoder().decode(combined).trim();
  } catch (error) {
    socket.close();
    throw error;
  }
}

/**
 * Parse srvr command output into structured data
 */
function parseSrvrOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = output.split('\n');

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim();
      result[key] = value;
    }
  }

  return result;
}

/**
 * Parse mntr command output into structured key=value pairs
 */
function parseMntrOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = output.split('\n');

  for (const line of lines) {
    const tabIdx = line.indexOf('\t');
    if (tabIdx > 0) {
      const key = line.substring(0, tabIdx).trim();
      const value = line.substring(tabIdx + 1).trim();
      result[key] = value;
    }
  }

  return result;
}

/**
 * Handle ZooKeeper connection test using 'ruok' command
 */
export async function handleZooKeeperConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 2181, timeout = 10000 } = body;

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

    // Send 'ruok' to check health
    const ruokResponse = await sendFourLetterWord(host, port, 'ruok', timeout);
    const healthy = ruokResponse === 'imok';

    // Also send 'srvr' to get server details
    let serverInfo: Record<string, string> = {};
    try {
      const srvrResponse = await sendFourLetterWord(host, port, 'srvr', timeout);
      serverInfo = parseSrvrOutput(srvrResponse);
    } catch {
      // srvr might be disabled - that's OK
    }

    const rtt = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      rtt,
      healthy,
      ruokResponse,
      serverInfo: {
        version: serverInfo['Zookeeper version'] || undefined,
        mode: serverInfo['Mode'] || undefined,
        connections: serverInfo['Connections'] || undefined,
        outstanding: serverInfo['Outstanding'] || undefined,
        nodeCount: serverInfo['Node count'] || undefined,
        latencyMin: serverInfo['Latency min/avg/max'] || undefined,
        received: serverInfo['Received'] || undefined,
        sent: serverInfo['Sent'] || undefined,
      },
    }), {
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
 * Handle ZooKeeper four-letter word command
 * Sends any valid 4LW command and returns the raw response
 */
export async function handleZooKeeperCommand(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      command: string;
      timeout?: number;
    };

    const { host, port = 2181, command, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!command) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Command is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!VALID_COMMANDS.includes(command)) {
      return new Response(JSON.stringify({
        success: false,
        error: `Invalid command: "${command}". Valid commands: ${VALID_COMMANDS.join(', ')}`,
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

    const startTime = Date.now();
    const response = await sendFourLetterWord(host, port, command, timeout);
    const rtt = Date.now() - startTime;

    // Parse structured data for certain commands
    let parsed: Record<string, string> | undefined;
    if (command === 'srvr' || command === 'conf' || command === 'envi') {
      parsed = parseSrvrOutput(response);
    } else if (command === 'mntr') {
      parsed = parseMntrOutput(response);
    }

    return new Response(JSON.stringify({
      success: true,
      host,
      port,
      command,
      rtt,
      response,
      parsed,
    }), {
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
 * Handle ZooKeeper GetData request (Jute binary protocol)
 * POST /api/zookeeper/get
 */
export async function handleZooKeeperGet(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      path?: string;
      watch?: boolean;
      timeout?: number;
    };

    const { host, port = 2181, path = '/', watch = false, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
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
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        await zkConnect(reader, writer, timeout);

        // GetData payload: path(string) + watch(1 byte)
        const pathBytes = encodeString(path);
        const payload = new Uint8Array(pathBytes.length + 1);
        payload.set(pathBytes);
        payload[pathBytes.length] = watch ? 1 : 0;

        const { err, data } = await zkRequest(reader, writer, 1, ZK_OP.GET_DATA, payload, timeout);
        const rtt = Date.now() - startTime;

        socket.close();

        if (err === -101) {
          return { success: true, exists: false, path };
        }

        if (err !== 0) {
          return {
            success: false,
            error: ZK_ERR[err] || `ZooKeeper error code: ${err}`,
            path,
          };
        }

        // Parse GetData response: data(4BE len + bytes) + stat(80 bytes)
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const dataLen = dv.getInt32(0, false);
        let nodeData: string | null = null;
        let dataOffset = 4;

        if (dataLen >= 0) {
          const rawBytes = data.slice(4, 4 + dataLen);
          dataOffset = 4 + dataLen;
          // Try to decode as UTF-8; fall back to base64
          try {
            nodeData = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
          } catch {
            nodeData = btoa(String.fromCharCode(...rawBytes));
          }
        }

        // stat structure (80 bytes): czxid(8)+mzxid(8)+ctime(8)+mtime(8)+version(4)+cversion(4)+aversion(4)+ephemeralOwner(8)+dataLength(4)+numChildren(4)+pzxid(8)
        const stat = data.slice(dataOffset, dataOffset + 80);
        const sv = new DataView(stat.buffer, stat.byteOffset, stat.byteLength);

        const czxidHi = sv.getUint32(0, false);
        const czxidLo = sv.getUint32(4, false);
        const mzxidHi = sv.getUint32(8, false);
        const mzxidLo = sv.getUint32(12, false);
        const ctimeHi = sv.getUint32(16, false);
        const ctimeLo = sv.getUint32(20, false);
        const mtimeHi = sv.getUint32(24, false);
        const mtimeLo = sv.getUint32(28, false);
        const version = sv.getInt32(32, false);
        const numChildren = sv.getInt32(52, false);

        return {
          success: true,
          host,
          port,
          path,
          data: nodeData,
          version,
          dataLength: dataLen,
          numChildren,
          czxid: `0x${czxidHi.toString(16).padStart(8, '0')}${czxidLo.toString(16).padStart(8, '0')}`,
          mzxid: `0x${mzxidHi.toString(16).padStart(8, '0')}${mzxidLo.toString(16).padStart(8, '0')}`,
          ctime: Number((BigInt(ctimeHi) << BigInt(32)) | BigInt(ctimeLo)),
          mtime: Number((BigInt(mtimeHi) << BigInt(32)) | BigInt(mtimeLo)),
          rtt,
        };
      } catch (error) {
        socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'ZooKeeper get failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle ZooKeeper SetData request (Jute binary protocol)
 * POST /api/zookeeper/set
 */
export async function handleZooKeeperSet(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      path: string;
      data: string;
      version?: number;
      timeout?: number;
    };

    const { host, port = 2181, path, data: nodeData, version = -1, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!path) {
      return new Response(JSON.stringify({ success: false, error: 'Path is required' }), {
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
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        await zkConnect(reader, writer, timeout);

        // SetData payload: path(string) + data(4BE len + bytes) + version(4BE)
        const pathBytes = encodeString(path);
        const dataBytes = new TextEncoder().encode(nodeData ?? '');
        const dataField = new Uint8Array(4 + dataBytes.length);
        new DataView(dataField.buffer).setInt32(0, dataBytes.length, false);
        dataField.set(dataBytes, 4);

        const versionField = new Uint8Array(4);
        new DataView(versionField.buffer).setInt32(0, version, false);

        const payload = new Uint8Array(pathBytes.length + dataField.length + 4);
        let off = 0;
        payload.set(pathBytes, off); off += pathBytes.length;
        payload.set(dataField, off); off += dataField.length;
        payload.set(versionField, off);

        const { err, data: respData } = await zkRequest(reader, writer, 2, ZK_OP.SET_DATA, payload, timeout);
        const rtt = Date.now() - startTime;

        socket.close();

        if (err !== 0) {
          return {
            success: false,
            error: ZK_ERR[err] || `ZooKeeper error code: ${err}`,
            path,
          };
        }

        // SetData response: stat structure (80 bytes)
        const sv = new DataView(respData.buffer, respData.byteOffset, respData.byteLength);
        const newVersion = respData.length >= 36 ? sv.getInt32(32, false) : -1;

        return {
          success: true,
          host,
          port,
          path,
          version: newVersion,
          rtt,
        };
      } catch (error) {
        socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'ZooKeeper set failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle ZooKeeper Create request (Jute binary protocol)
 * POST /api/zookeeper/create
 */
export async function handleZooKeeperCreate(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      path: string;
      data?: string;
      acl?: string;
      flags?: number;
      timeout?: number;
    };

    const { host, port = 2181, path, data: nodeData = '', flags = 0, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!path) {
      return new Response(JSON.stringify({ success: false, error: 'Path is required' }), {
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
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        await zkConnect(reader, writer, timeout);

        // Create payload: path(string) + data(4BE len + bytes) + acls(4BE count=1 + perms(4BE=31) + scheme + id) + flags(4BE)
        const pathBytes = encodeString(path);

        const dataBytes = new TextEncoder().encode(nodeData);
        const dataField = new Uint8Array(4 + dataBytes.length);
        new DataView(dataField.buffer).setInt32(0, dataBytes.length, false);
        dataField.set(dataBytes, 4);

        // ACL: count(4BE=1) + perms(4BE=31=CDRWA) + scheme("world") + id("anyone")
        const schemeBytes = encodeString('world');
        const idBytes = encodeString('anyone');
        const aclEntry = new Uint8Array(4 + schemeBytes.length + idBytes.length);
        const aclView = new DataView(aclEntry.buffer);
        aclView.setInt32(0, 31, false);  // perms = CDRWA
        aclEntry.set(schemeBytes, 4);
        aclEntry.set(idBytes, 4 + schemeBytes.length);

        const aclCount = new Uint8Array(4);
        new DataView(aclCount.buffer).setInt32(0, 1, false);

        const flagsField = new Uint8Array(4);
        new DataView(flagsField.buffer).setInt32(0, flags, false);

        const payloadLen = pathBytes.length + dataField.length + aclCount.length + aclEntry.length + flagsField.length;
        const payload = new Uint8Array(payloadLen);
        let off = 0;
        payload.set(pathBytes, off); off += pathBytes.length;
        payload.set(dataField, off); off += dataField.length;
        payload.set(aclCount, off); off += aclCount.length;
        payload.set(aclEntry, off); off += aclEntry.length;
        payload.set(flagsField, off);

        const { err, data: respData } = await zkRequest(reader, writer, 3, ZK_OP.CREATE, payload, timeout);
        const rtt = Date.now() - startTime;

        socket.close();

        if (err === -110) {
          return { success: false, error: 'Node already exists', path };
        }

        if (err !== 0) {
          return {
            success: false,
            error: ZK_ERR[err] || `ZooKeeper error code: ${err}`,
            path,
          };
        }

        // Create response: created-path string
        const { value: createdPath } = decodeString(respData, 0);

        return {
          success: true,
          host,
          port,
          path,
          createdPath,
          rtt,
        };
      } catch (error) {
        socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'ZooKeeper create failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
