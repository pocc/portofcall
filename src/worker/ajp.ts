/**
 * AJP (Apache JServ Protocol) Support for Cloudflare Workers
 * Implements AJP/1.3 CPing/CPong connectivity testing and HTTP request forwarding
 *
 * AJP is a binary protocol used to proxy requests from a web server
 * (Apache, Nginx) to an application server (Tomcat, Jetty).
 *
 * CPing/CPong handshake:
 * 1. Client sends CPing: 0x1234 (magic) + 0x0001 (length) + 0x0A (CPing type)
 * 2. Server responds CPong: 0x4142 (magic "AB") + 0x0001 (length) + 0x09 (CPong type)
 *
 * Forward Request (type 0x02):
 * - Client sends forward request with HTTP method, URI, headers
 * - Server responds with SEND_HEADERS (0x03), SEND_BODY_CHUNK (0x04), END_RESPONSE (0x05)
 *
 * Spec: https://tomcat.apache.org/connectors-doc/ajp/ajpv13a.html
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * AJP CPing packet (Server to Container)
 * Magic: 0x1234, Length: 0x0001, Type: 0x0A (CPing)
 */
const AJP_CPING = new Uint8Array([0x12, 0x34, 0x00, 0x01, 0x0A]);

/**
 * Expected CPong response (Container to Server)
 * Magic: 0x4142 ("AB"), Length: 0x0001, Type: 0x09 (CPong)
 */
const AJP_CPONG_EXPECTED = new Uint8Array([0x41, 0x42, 0x00, 0x01, 0x09]);

// AJP13 method codes
const AJP_METHODS: Record<string, number> = {
  GET: 2,
  HEAD: 3,
  POST: 4,
  PUT: 5,
  DELETE: 7,
  OPTIONS: 8,
  TRACE: 9,
};

// AJP13 common request header codes (0xA0xx)
const AJP_COMMON_HEADERS: Record<string, number> = {
  'accept': 0xA001,
  'accept-charset': 0xA002,
  'accept-encoding': 0xA003,
  'accept-language': 0xA004,
  'authorization': 0xA005,
  'connection': 0xA006,
  'content-type': 0xA007,
  'content-length': 0xA008,
  'cookie': 0xA009,
  'cookie2': 0xA00A,
  'host': 0xA00B,
  'pragma': 0xA00C,
  'referer': 0xA00D,
  'user-agent': 0xA00E,
};

// AJP13 response message codes
const AJP_RESPONSE_SEND_HEADERS = 0x03;
const AJP_RESPONSE_SEND_BODY = 0x04;
const AJP_RESPONSE_END_RESPONSE = 0x05;
const AJP_RESPONSE_GET_BODY_CHUNK = 0x06;

/** Read exactly N bytes from a socket reader */
async function readExact(reader: ReadableStreamDefaultReader<Uint8Array>, n: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(n);
  let offset = 0;
  while (offset < n) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed unexpectedly');
    const toCopy = Math.min(n - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }
  return buffer;
}

/**
 * Encode a string as an AJP string:
 * 2-byte big-endian length + UTF-8 bytes + 0x00 null terminator
 */
function ajpString(s: string): Uint8Array {
  const encoded = new TextEncoder().encode(s);
  const buf = new Uint8Array(2 + encoded.length + 1);
  const view = new DataView(buf.buffer);
  view.setUint16(0, encoded.length, false);
  buf.set(encoded, 2);
  buf[2 + encoded.length] = 0x00;
  return buf;
}

/**
 * Build an AJP13 Forward Request packet.
 *
 * Packet format: [0x12][0x34][length 2B][body...]
 * Body starts with: [0x02 = FORWARD_REQUEST][method_code 1B][protocol AJP string]...
 */
function buildAJPForwardRequest(
  method: string,
  protocol: string,
  reqUri: string,
  remoteAddr: string,
  remoteHost: string,
  serverName: string,
  serverPort: number,
  isSsl: boolean,
  headers: Record<string, string>,
): Uint8Array {
  const methodCode = AJP_METHODS[method.toUpperCase()] ?? 2;

  const parts: Uint8Array[] = [];

  // Message type: 0x02 = JK_AJP13_FORWARD_REQUEST
  parts.push(new Uint8Array([0x02]));
  // HTTP method code
  parts.push(new Uint8Array([methodCode]));
  // protocol string (e.g. "HTTP/1.1")
  parts.push(ajpString(protocol));
  // request URI
  parts.push(ajpString(reqUri));
  // remote_addr
  parts.push(ajpString(remoteAddr));
  // remote_host
  parts.push(ajpString(remoteHost));
  // server_name
  parts.push(ajpString(serverName));

  // server_port (2 bytes big-endian)
  const portBuf = new Uint8Array(2);
  new DataView(portBuf.buffer).setUint16(0, serverPort, false);
  parts.push(portBuf);

  // is_ssl (1 byte)
  parts.push(new Uint8Array([isSsl ? 0x01 : 0x00]));

  // Header count (2 bytes big-endian)
  const headerEntries = Object.entries(headers);
  const numHeaders = new Uint8Array(2);
  new DataView(numHeaders.buffer).setUint16(0, headerEntries.length, false);
  parts.push(numHeaders);

  for (const [name, value] of headerEntries) {
    const lowerName = name.toLowerCase();
    const commonCode = AJP_COMMON_HEADERS[lowerName];
    if (commonCode !== undefined) {
      // Common header: 2-byte code (0xA0xx)
      const codeBuf = new Uint8Array(2);
      new DataView(codeBuf.buffer).setUint16(0, commonCode, false);
      parts.push(codeBuf);
    } else {
      // Non-common header name as AJP string
      parts.push(ajpString(name));
    }
    // Header value as AJP string
    parts.push(ajpString(value));
  }

  // Attributes section terminator: 0xFF
  parts.push(new Uint8Array([0xFF]));

  // Calculate total body length
  let bodyLength = 0;
  for (const p of parts) bodyLength += p.length;

  // Build full AJP packet: [0x12][0x34][length 2B][body]
  const packet = new Uint8Array(4 + bodyLength);
  const pView = new DataView(packet.buffer);
  packet[0] = 0x12;
  packet[1] = 0x34;
  pView.setUint16(2, bodyLength, false);
  let offset = 4;
  for (const p of parts) {
    packet.set(p, offset);
    offset += p.length;
  }

  return packet;
}

/**
 * Read and parse AJP response packets from the server.
 *
 * AJP response packets from server use magic [0x41][0x42] ("AB"),
 * followed by 2-byte length, 1-byte code, and code-specific data.
 */
async function readAJPResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<{
  statusCode: number;
  statusMessage: string;
  responseHeaders: Record<string, string>;
  body: string;
  bytesReceived: number;
  packetCount: number;
}> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('AJP response timeout')), timeoutMs)
  );

  let statusCode = 0;
  let statusMessage = '';
  const responseHeaders: Record<string, string> = {};
  const bodyChunks: Uint8Array[] = [];
  let bytesReceived = 0;
  let packetCount = 0;
  const decoder = new TextDecoder();

  // Accumulating buffer for incoming bytes
  let buffer = new Uint8Array(0);

  const appendBuffer = (newData: Uint8Array): void => {
    const merged = new Uint8Array(buffer.length + newData.length);
    merged.set(buffer, 0);
    merged.set(newData, buffer.length);
    buffer = merged;
  };

  const ensureBytes = async (needed: number): Promise<void> => {
    while (buffer.length < needed) {
      const result = await Promise.race([reader.read(), timeoutPromise]);
      if (result.done || !result.value) throw new Error('Connection closed while reading response');
      appendBuffer(result.value);
    }
  };

  // Common response header name map (code -> name)
  const responseHeaderNames: Record<number, string> = {
    0xA001: 'Content-Type',
    0xA002: 'Content-Language',
    0xA003: 'Content-Length',
    0xA004: 'Date',
    0xA005: 'Last-Modified',
    0xA006: 'Location',
    0xA007: 'Set-Cookie',
    0xA008: 'Set-Cookie2',
    0xA009: 'Servlet-Engine',
    0xA00A: 'Status',
    0xA00B: 'WWW-Authenticate',
  };

  let done = false;
  while (!done) {
    // Each AJP packet from server: [0x41][0x42][length 2B][code 1B][data...]
    // Minimum 5 bytes for header
    await ensureBytes(5);

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    if (buffer[0] !== 0x41 || buffer[1] !== 0x42) {
      throw new Error(`Invalid AJP response magic: 0x${buffer[0].toString(16).padStart(2,'0')}${buffer[1].toString(16).padStart(2,'0')}`);
    }

    const packetLength = view.getUint16(2, false); // length of body (including code byte)
    const code = buffer[4];
    packetCount++;

    // Full packet is 4 header bytes + packetLength body bytes
    const totalPacketSize = 4 + packetLength;
    await ensureBytes(totalPacketSize);

    // packetData is everything after the code byte
    const packetData = buffer.slice(5, totalPacketSize);
    buffer = buffer.slice(totalPacketSize);
    bytesReceived += totalPacketSize;

    if (code === AJP_RESPONSE_SEND_HEADERS) {
      // Format: [status_code 2B][status_msg AJP string][num_headers 2B][headers...]
      const dv = new DataView(packetData.buffer, packetData.byteOffset, packetData.byteLength);
      statusCode = dv.getUint16(0, false);
      const msgLen = dv.getUint16(2, false);
      statusMessage = decoder.decode(packetData.slice(4, 4 + msgLen));
      let pos = 4 + msgLen + 1; // +1 for null terminator

      const numHeaders = dv.getUint16(pos, false);
      pos += 2;

      for (let i = 0; i < numHeaders && pos < packetData.length; i++) {
        let headerName: string;
        // Check if first byte is 0xA0 (common header code)
        if (packetData[pos] === 0xA0) {
          const code16 = dv.getUint16(pos, false);
          headerName = responseHeaderNames[code16] ?? `header-0x${code16.toString(16)}`;
          pos += 2;
        } else {
          const nameLen = dv.getUint16(pos, false);
          pos += 2;
          headerName = decoder.decode(packetData.slice(pos, pos + nameLen));
          pos += nameLen + 1; // +1 null terminator
        }
        const valLen = dv.getUint16(pos, false);
        pos += 2;
        const headerVal = decoder.decode(packetData.slice(pos, pos + valLen));
        pos += valLen + 1; // +1 null terminator
        responseHeaders[headerName.toLowerCase()] = headerVal;
      }

    } else if (code === AJP_RESPONSE_SEND_BODY) {
      // Format: [chunk_length 2B][data...]
      if (packetData.length >= 2) {
        const dv = new DataView(packetData.buffer, packetData.byteOffset, packetData.byteLength);
        const chunkLen = dv.getUint16(0, false);
        bodyChunks.push(packetData.slice(2, 2 + chunkLen));
      }

    } else if (code === AJP_RESPONSE_END_RESPONSE) {
      // reuse flag: packetData[0] == 1 means connection can be reused
      done = true;

    } else if (code === AJP_RESPONSE_GET_BODY_CHUNK) {
      // Server requesting more body data — we have nothing more to send
      // Send empty body chunk to indicate end of data
    }
  }

  // Assemble body
  let totalBodyLen = 0;
  for (const c of bodyChunks) totalBodyLen += c.length;
  const bodyBytes = new Uint8Array(totalBodyLen);
  let bodyOffset = 0;
  for (const c of bodyChunks) {
    bodyBytes.set(c, bodyOffset);
    bodyOffset += c.length;
  }

  return {
    statusCode,
    statusMessage,
    responseHeaders,
    body: decoder.decode(bodyBytes).substring(0, 4000),
    bytesReceived,
    packetCount,
  };
}

/**
 * Handle AJP CPing/CPong connectivity test
 * POST /api/ajp/connect
 *
 * Sends a CPing packet and validates the CPong response to confirm
 * that an AJP connector (e.g., Tomcat) is listening and responsive.
 */
export async function handleAJPConnect(request: Request): Promise<Response> {
  try {
    const { host, port = 8009, timeout = 10000 } = await request.json<{
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
        const start = Date.now();

        // Step 1: Send CPing packet
        await writer.write(AJP_CPING);

        // Step 2: Read CPong response (5 bytes)
        const response = await readExact(reader, 5);
        const rtt = Date.now() - start;

        // Step 3: Validate CPong
        const magic = (response[0] << 8) | response[1];
        const length = (response[2] << 8) | response[3];
        const messageType = response[4];

        const isValidCPong =
          response[0] === AJP_CPONG_EXPECTED[0] &&
          response[1] === AJP_CPONG_EXPECTED[1] &&
          response[2] === AJP_CPONG_EXPECTED[2] &&
          response[3] === AJP_CPONG_EXPECTED[3] &&
          response[4] === AJP_CPONG_EXPECTED[4];

        await socket.close();

        if (isValidCPong) {
          return {
            success: true,
            host,
            port,
            protocol: 'AJP/1.3',
            rtt,
            cpong: true,
            message: `AJP connector responded with valid CPong in ${rtt}ms`,
          };
        }

        return {
          success: false,
          host,
          port,
          rtt,
          error: `Unexpected response: magic=0x${magic.toString(16).padStart(4, '0')}, length=${length}, type=0x${messageType.toString(16).padStart(2, '0')}`,
          rawHex: Array.from(response).map(b => b.toString(16).padStart(2, '0')).join(' '),
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
 * Handle AJP HTTP request forwarding via AJP13 Forward Request
 * POST /api/ajp/request
 *
 * Forwards an HTTP request through the AJP connector and returns the response.
 * Useful for testing Tomcat/Jetty behind Apache httpd with mod_jk or mod_proxy_ajp.
 *
 * Request body JSON: { host, port?, method?, path?, headers?, body?, timeout? }
 */
export async function handleAJPRequest(request: Request): Promise<Response> {
  try {
    const {
      host,
      port = 8009,
      method = 'GET',
      path: reqPath = '/',
      headers: reqHeaders = {},
      body: reqBody,
      timeout = 15000,
    } = await request.json<{
      host: string;
      port?: number;
      method?: string;
      path?: string;
      headers?: Record<string, string>;
      body?: string;
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
        const start = Date.now();

        // Build merged headers, ensuring Host is always present
        const mergedHeaders: Record<string, string> = {
          host,
          ...Object.fromEntries(
            Object.entries(reqHeaders).map(([k, v]) => [k.toLowerCase(), v])
          ),
        };

        // Auto-set content-length if body is provided
        if (reqBody && !mergedHeaders['content-length']) {
          mergedHeaders['content-length'] = String(new TextEncoder().encode(reqBody).length);
        }

        // Determine SSL and port for the AJP packet
        const isHttps = port === 443;
        const serverPort = isHttps ? 443 : (port === 8009 ? 80 : port);

        // Build and send AJP Forward Request packet
        const fwdPacket = buildAJPForwardRequest(
          method,
          'HTTP/1.1',
          reqPath,
          '127.0.0.1',
          'localhost',
          host,
          serverPort,
          isHttps,
          mergedHeaders,
        );
        await writer.write(fwdPacket);

        // Send request body if present
        if (reqBody) {
          const bodyBytes = new TextEncoder().encode(reqBody);
          // AJP body data chunk: [0x12][0x34][total-length 2B][chunk-length 2B][data]
          const dataPacket = new Uint8Array(4 + 2 + bodyBytes.length);
          const dpView = new DataView(dataPacket.buffer);
          dataPacket[0] = 0x12;
          dataPacket[1] = 0x34;
          dpView.setUint16(2, 2 + bodyBytes.length, false); // total body length in packet
          dpView.setUint16(4, bodyBytes.length, false);     // chunk length
          dataPacket.set(bodyBytes, 6);
          await writer.write(dataPacket);

          // Send empty body chunk to signal end of request body
          const termPacket = new Uint8Array([0x12, 0x34, 0x00, 0x02, 0x00, 0x00]);
          await writer.write(termPacket);
        }

        // Read AJP response packets
        const connRtt = Date.now() - start;
        const ajpResp = await readAJPResponse(reader, Math.max(timeout - connRtt, 3000));
        const rtt = Date.now() - start;

        await socket.close();

        return {
          success: ajpResp.statusCode >= 200 && ajpResp.statusCode < 500,
          host,
          port,
          method: method.toUpperCase(),
          path: reqPath,
          rtt,
          statusCode: ajpResp.statusCode,
          statusMessage: ajpResp.statusMessage,
          responseHeaders: ajpResp.responseHeaders,
          body: ajpResp.body,
          bytesReceived: ajpResp.bytesReceived,
          packetCount: ajpResp.packetCount,
          protocol: 'AJP/1.3',
          message: `AJP forward request completed: HTTP ${ajpResp.statusCode} ${ajpResp.statusMessage}`,
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
