/**
 * OSCAR Protocol Implementation (AOL Instant Messenger / ICQ)
 *
 * Open System for CommunicAtion in Realtime (OSCAR) was the protocol used by
 * AOL Instant Messenger (AIM) and ICQ for instant messaging. AIM was shut down
 * in 2017, but ICQ continued (now discontinued in 2024).
 *
 * Protocol Overview:
 * - Port: 5190 (TCP)
 * - Format: Binary FLAP (Frame Layer Protocol) + SNAC (Service-specific commands)
 * - Authentication: MD5 password hash or OAuth
 * - Versions: Multiple, with different SNAC families
 *
 * FLAP Frame Structure (6-byte header):
 * - Start Byte: 0x2A (asterisk '*')
 * - Frame Type/Channel (1 byte): 1=Signon, 2=SNAC, 3=Error, 4=Close, 5=Keepalive
 * - Sequence Number (2 bytes): Incrementing frame number
 * - Data Length (2 bytes): Length of frame data
 * - Data (variable): Payload
 *
 * SNAC Structure (10-byte header + data):
 * - Family ID (2 bytes): Service family (0x01=Generic, 0x02=Location, etc.)
 * - Subtype ID (2 bytes): Command within family
 * - Flags (2 bytes): SNAC flags
 * - Request ID (4 bytes): Request identifier
 * - Data (variable): SNAC-specific data
 *
 * FLAP Channels:
 * - 0x01: Signon/negotiation
 * - 0x02: SNAC data
 * - 0x03: Error
 * - 0x04: Close connection
 * - 0x05: Keepalive/ping
 *
 * Common SNAC Families:
 * - 0x0001: Generic service
 * - 0x0002: Location services
 * - 0x0003: Buddy list
 * - 0x0004: ICBM (messaging)
 * - 0x0013: SSI (server-stored info)
 * - 0x0017: Authorization/registration
 *
 * Use Cases:
 * - Legacy AIM/ICQ server detection
 * - IM protocol archaeology
 * - Historical protocol research
 */

import { connect } from 'cloudflare:sockets';
import { createHash } from 'node:crypto';

interface OSCARRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface OSCARResponse {
  success: boolean;
  host: string;
  port: number;
  channel?: number;
  channelName?: string;
  sequence?: number;
  dataLength?: number;
  rtt?: number;
  error?: string;
}

// FLAP Channel Types
enum FLAPChannel {
  Signon = 0x01,
  SNAC = 0x02,
  Error = 0x03,
  Close = 0x04,
  Keepalive = 0x05,
}

/**
 * Build FLAP frame header
 */
function buildFLAPFrame(channel: number, sequence: number, data: Buffer): Buffer {
  const header = Buffer.allocUnsafe(6);

  // Start byte (asterisk '*' = 0x2A)
  header.writeUInt8(0x2A, 0);

  // Channel/Frame type
  header.writeUInt8(channel, 1);

  // Sequence number (big-endian)
  header.writeUInt16BE(sequence, 2);

  // Data length (big-endian)
  header.writeUInt16BE(data.length, 4);

  return Buffer.concat([header, data]);
}

/**
 * Build OSCAR signon frame (FLAP channel 1)
 */
function buildOSCARSignon(): Buffer {
  // Signon data: Version (4 bytes)
  // Use version 1 for basic probe
  const signonData = Buffer.allocUnsafe(4);
  signonData.writeUInt32BE(0x00000001, 0);

  return buildFLAPFrame(FLAPChannel.Signon, 0, signonData);
}

/**
 * Parse FLAP frame header.
 * Returns null if invalid start byte or incomplete frame.
 */
function parseFLAPFrame(data: Buffer): {
  startByte: number;
  channel: number;
  sequence: number;
  dataLength: number;
  data: Buffer;
} | null {
  if (data.length < 6) {
    return null;
  }

  const startByte = data.readUInt8(0);

  // Verify start byte is 0x2A (asterisk)
  if (startByte !== 0x2A) {
    return null;
  }

  const channel = data.readUInt8(1);
  const sequence = data.readUInt16BE(2);
  const dataLength = data.readUInt16BE(4);

  // Verify we have complete frame data
  if (data.length < 6 + dataLength) {
    return null;
  }

  // Extract complete data payload
  const frameData = data.subarray(6, 6 + dataLength);

  return {
    startByte,
    channel,
    sequence,
    dataLength,
    data: frameData,
  };
}

/**
 * Probe OSCAR server by sending signon frame.
 * Detects AIM/ICQ server and protocol support.
 */
export async function handleOSCARProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as OSCARRequest;
    const { host, port = 5190, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies OSCARResponse), {
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
      } satisfies OSCARResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Build and send OSCAR signon frame
      const signon = buildOSCARSignon();

      writer = socket.writable.getWriter();
      await writer.write(signon);
      writer.releaseLock();
      writer = null;

      // Read server response
      reader = socket.readable.getReader();

      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (done || !value) {
        reader.releaseLock();
        reader = null;
        socket.close();
        if (timeoutHandle) clearTimeout(timeoutHandle);
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response from OSCAR server',
        } satisfies OSCARResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const parsed = parseFLAPFrame(Buffer.from(value));

      if (!parsed) {
        reader.releaseLock();
        reader = null;
        socket.close();
        if (timeoutHandle) clearTimeout(timeoutHandle);
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid FLAP frame format',
        } satisfies OSCARResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      reader = null;
      socket.close();
      if (timeoutHandle) clearTimeout(timeoutHandle);

      // Map channel to name
      const channelNames: { [key: number]: string } = {
        [FLAPChannel.Signon]: 'Signon',
        [FLAPChannel.SNAC]: 'SNAC Data',
        [FLAPChannel.Error]: 'Error',
        [FLAPChannel.Close]: 'Close',
        [FLAPChannel.Keepalive]: 'Keepalive',
      };

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        channel: parsed.channel,
        channelName: channelNames[parsed.channel] || `Unknown (0x${parsed.channel.toString(16)})`,
        sequence: parsed.sequence,
        dataLength: parsed.dataLength,
        rtt,
      } satisfies OSCARResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      if (writer) writer.releaseLock();
      if (reader) reader.releaseLock();
      socket.close();
      if (timeoutHandle) clearTimeout(timeoutHandle);
      throw error;
    }

  } catch (error) {
    const body = await request.json().catch(() => ({ host: '', port: 5190 })) as OSCARRequest;
    return new Response(JSON.stringify({
      success: false,
      host: body.host || '',
      port: body.port || 5190,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies OSCARResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Test OSCAR server capabilities.
 * Sends keepalive ping to test server responsiveness.
 */
export async function handleOSCARPing(request: Request): Promise<Response> {
  try {
    const body = await request.json() as OSCARRequest;
    const { host, port = 5190, timeout = 10000 } = body;

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

    const socket = connect(`${host}:${port}`);

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // First send signon, then keepalive
      const signon = buildOSCARSignon();
      const keepalive = buildFLAPFrame(FLAPChannel.Keepalive, 1, Buffer.alloc(0));

      writer = socket.writable.getWriter();
      await writer.write(signon);
      await writer.write(keepalive);
      writer.releaseLock();
      writer = null;

      // Read responses
      reader = socket.readable.getReader();

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const maxResponseSize = 1000;

      try {
        while (totalBytes < maxResponseSize) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);

          if (done) break;

          if (value) {
            chunks.push(Buffer.from(value));
            totalBytes += value.length;

            // Stop after getting responses
            if (chunks.length >= 2) break;
          }
        }
      } catch {
        // Connection closed (expected)
      }

      reader.releaseLock();
      reader = null;
      socket.close();
      if (timeoutHandle) clearTimeout(timeoutHandle);

      return new Response(JSON.stringify({
        success: chunks.length > 0,
        host,
        port,
        message: chunks.length > 0 ? 'OSCAR server responded to ping' : 'No ping response',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      if (writer) writer.releaseLock();
      if (reader) reader.releaseLock();
      socket.close();
      if (timeoutHandle) clearTimeout(timeoutHandle);
      throw error;
    }

  } catch (error) {
    const body = await request.json().catch(() => ({ host: '', port: 5190 })) as OSCARRequest;
    return new Response(JSON.stringify({
      success: false,
      host: body.host || '',
      port: body.port || 5190,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Build a TLV (Type-Length-Value) block used in OSCAR SNAC payloads.
 */
function buildTLV(type: number, value: Buffer): Buffer {
  const tlv = Buffer.allocUnsafe(4 + value.length);
  tlv.writeUInt16BE(type, 0);
  tlv.writeUInt16BE(value.length, 2);
  value.copy(tlv, 4);
  return tlv;
}

/**
 * Build SNAC packet (10-byte header + data).
 */
function buildSNAC(family: number, subtype: number, data: Buffer, reqId = 1): Buffer {
  const header = Buffer.allocUnsafe(10);
  header.writeUInt16BE(family, 0);   // family
  header.writeUInt16BE(subtype, 2);  // subtype
  header.writeUInt16BE(0, 4);        // flags
  header.writeUInt32BE(reqId, 6);    // request ID
  return Buffer.concat([header, data]);
}

/**
 * Parse TLVs from a buffer, returning a Map of type → Buffer.
 */
function parseTLVs(data: Buffer): Map<number, Buffer> {
  const tlvs = new Map<number, Buffer>();
  let offset = 0;
  while (offset + 4 <= data.length) {
    const type = data.readUInt16BE(offset);
    const length = data.readUInt16BE(offset + 2);
    offset += 4;
    if (offset + length > data.length) break;
    tlvs.set(type, data.subarray(offset, offset + length));
    offset += length;
  }
  return tlvs;
}

/**
 * Read a full FLAP frame from the stream (header + payload).
 * Returns null if no data received or incomplete frame.
 */
async function readFLAP(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  let expectedLen = -1;
  const deadline = Date.now() + timeoutMs;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((_, rej) => {
          timeoutHandle = setTimeout(() => rej(new Error('timeout')), remaining);
        }),
      ]).catch(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        return { value: undefined as undefined, done: true as const };
      });

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      if (done || !value) break;
      chunks.push(Buffer.from(value));
      total += value.length;
      // Once we have the 6-byte FLAP header, know expected total length
      if (expectedLen < 0 && total >= 6) {
        const combined = Buffer.concat(chunks);
        expectedLen = 6 + combined.readUInt16BE(4); // 6 header + data length
      }
      if (expectedLen > 0 && total >= expectedLen) break;
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  if (total === 0) return null;
  // Only return if we have a complete frame
  if (expectedLen > 0 && total < expectedLen) return null;
  return Buffer.concat(chunks).subarray(0, expectedLen > 0 ? expectedLen : total);
}

/**
 * Initiate OSCAR authentication (FLAP signon + SNAC AuthKeyRequest).
 *
 * Flow: connect → read server signon → send client signon → send SNAC 0x0017/0x0006
 *       → read SNAC 0x0017/0x0007 with auth key.
 *
 * POST /api/oscar/auth
 * Body: { host, port?, screenName, timeout? }
 */
export async function handleOSCARAuth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { host: string; port?: number; screenName?: string; timeout?: number };
    const { host, port = 5190, screenName = 'testuser', timeout = 10000 } = body;

    if (!host) return Response.json({ success: false, error: 'Host is required' }, { status: 400 });

    if (port < 1 || port > 65535) {
      return Response.json({ success: false, error: 'Port must be between 1 and 65535' }, { status: 400 });
    }

    const socket = connect(`${host}:${port}`, { secureTransport: 'off' as const, allowHalfOpen: false });
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const tp = new Promise<never>((_, rej) => {
      timeoutHandle = setTimeout(() => rej(new Error('timeout')), timeout);
    });

    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      await Promise.race([socket.opened, tp]);
      writer = socket.writable.getWriter();
      reader = socket.readable.getReader();

      // Step 1: Read server signon (FLAP Channel 1)
      const serverSignon = await Promise.race([readFLAP(reader, 3000), tp]);
      const serverFlap = serverSignon ? parseFLAPFrame(serverSignon) : null;

      // Step 2: Send client signon (FLAP Channel 1 with version=1)
      const clientSignon = buildFLAPFrame(FLAPChannel.Signon, 0, Buffer.from([0x00, 0x00, 0x00, 0x01]));
      await writer.write(clientSignon);

      // Step 3: Send SNAC (0x0017/0x0006) AuthKeyRequest with screen name TLV
      const snNameBuf = Buffer.from(screenName, 'ascii');
      const snacData = buildTLV(0x0001, snNameBuf); // TLV 0x0001 = screen name
      const snac = buildSNAC(0x0017, 0x0006, snacData);
      const authKeyReq = buildFLAPFrame(FLAPChannel.SNAC, 1, snac);
      await writer.write(authKeyReq);

      // Step 4: Read AuthKeyResponse (SNAC 0x0017/0x0007)
      const resp = await Promise.race([readFLAP(reader, 5000), tp]).catch(() => null);

      writer.releaseLock();
      writer = null;
      reader.releaseLock();
      reader = null;
      socket.close();
      if (timeoutHandle) clearTimeout(timeoutHandle);

      let authKey: string | undefined;
      let snacFamily: number | undefined;
      let snacSubtype: number | undefined;
      let errorText: string | undefined;

      if (resp && resp.length >= 6) {
        const respFlap = parseFLAPFrame(resp);
        if (respFlap && respFlap.channel === FLAPChannel.SNAC && respFlap.data.length >= 10) {
          snacFamily = respFlap.data.readUInt16BE(0);
          snacSubtype = respFlap.data.readUInt16BE(2);
          const payload = respFlap.data.subarray(10);
          const tlvs = parseTLVs(payload);
          // TLV 0x0025 = MD5 auth key (challenge)
          // TLV 0x0008 = error code
          if (tlvs.has(0x0025)) {
            authKey = tlvs.get(0x0025)!.toString('ascii');
          }
          if (tlvs.has(0x0008)) {
            const errCode = tlvs.get(0x0008)!.readUInt16BE(0);
            errorText = `Auth error code: 0x${errCode.toString(16).padStart(4, '0')}`;
          }
        }
      }

      return Response.json({
        success: !!authKey || !!snacFamily,
        host,
        port,
        screenName,
        serverSignonReceived: !!serverFlap,
        serverChannel: serverFlap?.channel,
        authKeyReceived: !!authKey,
        authKey,
        snacFamily: snacFamily !== undefined ? `0x${snacFamily.toString(16).padStart(4, '0')}` : undefined,
        snacSubtype: snacSubtype !== undefined ? `0x${snacSubtype.toString(16).padStart(4, '0')}` : undefined,
        error: errorText,
      });
    } catch (err) {
      if (writer) writer.releaseLock();
      if (reader) reader.releaseLock();
      socket.close();
      if (timeoutHandle) clearTimeout(timeoutHandle);
      throw err;
    }
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** Build a uint16 TLV with a big-endian 16-bit value. */
function buildTLVUint16(type: number, value: number): Buffer {
  const b = Buffer.allocUnsafe(2);
  b.writeUInt16BE(value, 0);
  return buildTLV(type, b);
}


/**
 * Full OSCAR login: auth key request → MD5 login → returns BOS host, port, and auth cookie.
 * POST /api/oscar/login  Body: { host, port=5190, screenName, password, timeout=15000 }
 */
export async function handleOSCARLogin(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; screenName: string; password: string; timeout?: number;
    };
    const { host, port = 5190, screenName, password, timeout = 15000 } = body;
    if (!host || !screenName || !password) {
      return Response.json({ success: false, error: 'host, screenName, and password are required' }, { status: 400 });
    }
    if (port < 1 || port > 65535) {
      return Response.json({ success: false, error: 'Port must be between 1 and 65535' }, { status: 400 });
    }
    const socket = connect(`${host}:${port}`, { secureTransport: 'off' as const, allowHalfOpen: false });
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const tp = new Promise<never>((_, rej) => {
      timeoutHandle = setTimeout(() => rej(new Error('timeout')), timeout);
    });
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      await Promise.race([socket.opened, tp]);
      writer = socket.writable.getWriter();
      reader = socket.readable.getReader();
      await Promise.race([readFLAP(reader, 3000), tp]).catch(() => null);
      await writer.write(buildFLAPFrame(FLAPChannel.Signon, 0, Buffer.from([0x00, 0x00, 0x00, 0x01])));
      await writer.write(buildFLAPFrame(FLAPChannel.SNAC, 1,
        buildSNAC(0x0017, 0x0006, buildTLV(0x0001, Buffer.from(screenName, 'ascii')))));
      const akRaw = await Promise.race([readFLAP(reader, 5000), tp]);
      if (!akRaw) throw new Error('No auth key response');
      const akFlap = parseFLAPFrame(akRaw);
      if (!akFlap || akFlap.channel !== FLAPChannel.SNAC || akFlap.data.length < 10) throw new Error('Invalid auth key response');
      const authKeyBuf = parseTLVs(akFlap.data.subarray(10)).get(0x0025);
      if (!authKeyBuf) throw new Error('Auth key TLV 0x0025 missing');
      const pwdMD5 = createHash('md5').update(Buffer.from(password, 'utf8')).digest();
      const loginHash = createHash('md5').update(authKeyBuf).update(pwdMD5)
        .update(Buffer.from('AOL Instant Messenger (SM)', 'ascii')).digest();
      const loginData = Buffer.concat([
        buildTLV(0x0001, Buffer.from(screenName, 'ascii')),
        buildTLV(0x0025, loginHash),
        buildTLV(0x0003, Buffer.from('AIM 5.9.3797', 'ascii')),
        buildTLVUint16(0x0016, 0x0109),
        buildTLV(0x000E, Buffer.from('us', 'ascii')),
        buildTLV(0x000F, Buffer.from('en', 'ascii')),
      ]);
      await writer.write(buildFLAPFrame(FLAPChannel.SNAC, 2, buildSNAC(0x0017, 0x0002, loginData, 2)));
      const lrRaw = await Promise.race([readFLAP(reader, 8000), tp]);
      writer.releaseLock();
      writer = null;
      reader.releaseLock();
      reader = null;
      socket.close();
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (!lrRaw) throw new Error('No login response');
      const lrFlap = parseFLAPFrame(lrRaw);
      if (!lrFlap || lrFlap.channel !== FLAPChannel.SNAC || lrFlap.data.length < 10) throw new Error('Invalid login response');
      const lrTLVs = parseTLVs(lrFlap.data.subarray(10));
      const errBuf = lrTLVs.get(0x0008);
      if (errBuf && errBuf.length >= 2) {
        const code = errBuf.readUInt16BE(0);
        const msgs: Record<number, string> = { 1: 'Invalid nick or password', 4: 'Incorrect nick or password',
          5: 'Mismatch nick or password', 18: 'Account suspended', 24: 'Rate limit exceeded' };
        return Response.json({ success: false, host, port, screenName, errorCode: code, error: msgs[code] ?? `Login failed (code ${code})` });
      }
      const bosAddrBuf = lrTLVs.get(0x0005);
      const cookieB = lrTLVs.get(0x0006);
      if (!bosAddrBuf || !cookieB) {
        return Response.json({ success: false, host, port, screenName, error: 'Login reply missing BOS address or auth cookie' });
      }
      const bosAddr = bosAddrBuf.toString('ascii').trim();
      const ci = bosAddr.lastIndexOf(':');
      const bosHost = ci > 0 ? bosAddr.substring(0, ci) : bosAddr;
      const bosPort = ci > 0 ? (parseInt(bosAddr.substring(ci + 1), 10) || 5190) : 5190;
      return Response.json({ success: true, host, port, screenName, bosHost, bosPort,
        cookieHex: cookieB.toString('hex'), cookieLength: cookieB.length });
    } catch (err) {
      if (writer) writer.releaseLock();
      if (reader) reader.releaseLock();
      socket.close();
      if (timeoutHandle) clearTimeout(timeoutHandle);
      throw err;
    }
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** Drain SNACs from a BOS connection for up to maxMs, collecting {family, subtype, data}. */
async function drainBOSSNACs(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxMs: number,
): Promise<Array<{ family: number; subtype: number; data: Buffer }>> {
  const out: Array<{ family: number; subtype: number; data: Buffer }> = [];
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const raw = await readFLAP(reader, Math.max(200, deadline - Date.now())).catch(() => null);
    if (!raw) break;
    const flap = parseFLAPFrame(raw);
    if (!flap) break;
    if (flap.channel === FLAPChannel.SNAC && flap.data.length >= 4) {
      out.push({ family: flap.data.readUInt16BE(0), subtype: flap.data.readUInt16BE(2), data: flap.data });
    }
  }
  return out;
}

/**
 * Full OSCAR buddy list: login → BOS connect + rate negotiation → SSI checkout.
 *
 * POST /api/oscar/buddy-list
 * Body: { host, port=5190, screenName, password, timeout=20000 }
 *
 * Flow: login → BOS connect with cookie → SNAC 0x01/0x08 rate ACK
 *       → SNAC 0x13/0x02 SSI checkout → parse SSI items (buddies, groups, permits).
 */
export async function handleOSCARBuddyList(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; screenName: string; password: string; timeout?: number;
    };
    const { host, port = 5190, screenName, password, timeout = 20000 } = body;
    if (!host || !screenName || !password) {
      return Response.json({ success: false, error: 'host, screenName, and password are required' }, { status: 400 });
    }
    const tp = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout));

    // --- A: login to get BOS host + auth cookie ---
    const authSock = connect(`${host}:${port}`, { secureTransport: 'off' as const, allowHalfOpen: false });
    let bosHost = host, bosPort = port, cookieBuf: Buffer | undefined;

    try {
      await Promise.race([authSock.opened, tp]);
      const aw = authSock.writable.getWriter();
      const ar = authSock.readable.getReader();

      await Promise.race([readFLAP(ar, 3000), tp]).catch(() => null);
      await aw.write(buildFLAPFrame(FLAPChannel.Signon, 0, Buffer.from([0x00, 0x00, 0x00, 0x01])));
      await aw.write(buildFLAPFrame(FLAPChannel.SNAC, 1,
        buildSNAC(0x0017, 0x0006, buildTLV(0x0001, Buffer.from(screenName, 'ascii')))));

      const akRaw = await Promise.race([readFLAP(ar, 5000), tp]);
      if (!akRaw) throw new Error('No auth key response');
      const akFlap = parseFLAPFrame(akRaw);
      if (!akFlap || akFlap.data.length < 10) throw new Error('Bad auth key FLAP');
      const authKeyBuf = parseTLVs(akFlap.data.subarray(10)).get(0x0025);
      if (!authKeyBuf) throw new Error('No auth key in response');

      const pwdMD5 = createHash('md5').update(Buffer.from(password, 'utf8')).digest();
      const loginHash = createHash('md5').update(authKeyBuf).update(pwdMD5)
        .update(Buffer.from('AOL Instant Messenger (SM)', 'ascii')).digest();

      await aw.write(buildFLAPFrame(FLAPChannel.SNAC, 2, buildSNAC(0x0017, 0x0002, Buffer.concat([
        buildTLV(0x0001, Buffer.from(screenName, 'ascii')),
        buildTLV(0x0025, loginHash),
        buildTLV(0x0003, Buffer.from('AIM 5.9.3797', 'ascii')),
        buildTLVUint16(0x0016, 0x0109),
      ]), 2)));

      const lrRaw = await Promise.race([readFLAP(ar, 8000), tp]);
      aw.releaseLock(); ar.releaseLock(); authSock.close();

      if (!lrRaw) throw new Error('No login reply');
      const lrFlap = parseFLAPFrame(lrRaw);
      if (!lrFlap || lrFlap.data.length < 10) throw new Error('Bad login reply');
      const lrTLVs = parseTLVs(lrFlap.data.subarray(10));

      const errBuf = lrTLVs.get(0x0008);
      if (errBuf && errBuf.length >= 2) {
        return Response.json({ success: false, host, screenName,
          error: `Login failed (code ${errBuf.readUInt16BE(0)})` });
      }

      const bosAddrBuf = lrTLVs.get(0x0005);
      cookieBuf = lrTLVs.get(0x0006);
      if (!bosAddrBuf || !cookieBuf) throw new Error('Login reply missing BOS info');
      const ba = bosAddrBuf.toString('ascii').trim();
      const ci = ba.lastIndexOf(':');
      bosHost = ci > 0 ? ba.substring(0, ci) : ba;
      bosPort = ci > 0 ? (parseInt(ba.substring(ci + 1), 10) || 5190) : 5190;
    } catch (err) {
      authSock.close();
      throw err;
    }

    // --- B: BOS connect with cookie ---
    const bosSock = connect(`${bosHost}:${bosPort}`, { secureTransport: 'off' as const, allowHalfOpen: false });
    try {
      await Promise.race([bosSock.opened, tp]);
      const bw = bosSock.writable.getWriter();
      const br = bosSock.readable.getReader();

      // BOS signon: FLAP ch1 version=1 + TLV 0x0006 (cookie)
      await Promise.race([readFLAP(br, 3000), tp]).catch(() => null);
      await bw.write(buildFLAPFrame(FLAPChannel.Signon, 0,
        Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01]), buildTLV(0x0006, cookieBuf!)])));

      // Drain init SNACs; look for rate info (0x01/0x07) to extract class IDs
      const initSNACs = await drainBOSSNACs(br, 4000);
      const rateSnac = initSNACs.find(s => s.family === 0x0001 && s.subtype === 0x0007);
      let rateIds: number[] = [1, 2, 3, 4, 5];
      if (rateSnac && rateSnac.data.length > 12) {
        const numClasses = rateSnac.data.readUInt16BE(10);
        rateIds = [];
        let off = 12;
        for (let i = 0; i < numClasses && off + 2 <= rateSnac.data.length; i++) {
          rateIds.push(rateSnac.data.readUInt16BE(off));
          off += 35;
        }
      }

      // Send rate ACK (0x01/0x08) — payload is a flat list of uint16 class IDs (no count prefix)
      const rateAck = Buffer.allocUnsafe(rateIds.length * 2);
      rateIds.forEach((id, i) => rateAck.writeUInt16BE(id, i * 2));
      await bw.write(buildFLAPFrame(FLAPChannel.SNAC, 3, buildSNAC(0x0001, 0x0008, rateAck, 3)));

      // SSI checkout: SNAC 0x13/0x02 (request SSI data)
      await bw.write(buildFLAPFrame(FLAPChannel.SNAC, 4, buildSNAC(0x0013, 0x0002, Buffer.alloc(0), 4)));

      const ssiSNACs = await drainBOSSNACs(br, 5000);
      bw.releaseLock(); br.releaseLock(); bosSock.close();

      // Parse SSI items from SNAC 0x13/0x06
      const ssiSnac = ssiSNACs.find(s => s.family === 0x0013 && s.subtype === 0x0006);
      const items: Array<{ name: string; groupId: number; itemId: number; type: string }> = [];

      if (ssiSnac && ssiSnac.data.length > 14) {
        const itemTypeNames: Record<number, string> = {
          0: 'buddy', 1: 'group', 2: 'permit', 3: 'deny', 5: 'master_group', 14: 'presence',
        };
        let off = 12; // skip 10-byte SNAC header + 2-byte SSI version
        if (ssiSnac.data.length > off + 2) {
          const numItems = ssiSnac.data.readUInt16BE(off); off += 2;
          for (let i = 0; i < numItems && off + 10 <= ssiSnac.data.length; i++) {
            const nameLen = ssiSnac.data.readUInt16BE(off); off += 2;
            if (off + nameLen + 8 > ssiSnac.data.length) break;
            const name = ssiSnac.data.subarray(off, off + nameLen).toString('utf8'); off += nameLen;
            const groupId  = ssiSnac.data.readUInt16BE(off); off += 2;
            const itemId   = ssiSnac.data.readUInt16BE(off); off += 2;
            const itemType = ssiSnac.data.readUInt16BE(off); off += 2;
            const tlvLen   = ssiSnac.data.readUInt16BE(off); off += 2 + tlvLen;
            items.push({ name, groupId, itemId, type: itemTypeNames[itemType] ?? `type${itemType}` });
          }
        }
      }

      const allFamilies = [...new Set(
        initSNACs.concat(ssiSNACs).map(s =>
          `0x${s.family.toString(16).padStart(4,'0')}/0x${s.subtype.toString(16).padStart(4,'0')}`),
      )];

      return Response.json({
        success: true, host, screenName, bosHost, bosPort,
        ssiReceived: !!ssiSnac,
        itemCount: items.length,
        buddies: items.filter(i => i.type === 'buddy'),
        groups:  items.filter(i => i.type === 'group'),
        allItems: items,
        snacFamiliesReceived: allFamilies,
      });
    } catch (err) {
      bosSock.close();
      throw err;
    }
  } catch (err) {
    return Response.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}


/** Compute MD5 of a Buffer using node:crypto (nodejs_compat). */
function md5Buffer(data: Buffer): Buffer {
  return Buffer.from(createHash('md5').update(data).digest());
}

/** OSCAR LoginRequest SNAC (0x0017/0x0002) with MD5 auth hash. */
function buildOSCARLoginRequest(screenName: string, password: string, authKey: Buffer): Buffer {
  const pwMd5 = md5Buffer(Buffer.from(password, 'ascii'));
  const AIM_MD5_STRING = Buffer.from('AOL Instant Messenger (SM)', 'ascii');
  const authHash = md5Buffer(Buffer.concat([authKey, pwMd5, AIM_MD5_STRING]));
  const snData = Buffer.concat([
    buildTLV(0x0001, Buffer.from(screenName, 'ascii')),
    buildTLV(0x0025, authHash),
    buildTLV(0x0003, Buffer.from('Port of Call 1.0', 'ascii')),
    buildTLV(0x0016, Buffer.from([0x01, 0x09])),  // client ID
    buildTLV(0x0017, Buffer.from([0x00, 0x01])),  // major version 1
    buildTLV(0x0018, Buffer.from([0x00, 0x00])),  // minor version 0
    buildTLV(0x0019, Buffer.from([0x00, 0x00])),  // lesser 0
    buildTLV(0x001a, Buffer.from([0x00, 0x01])),  // build 1
  ]);
  return buildSNAC(0x0017, 0x0002, snData);
}

/** BOS signon FLAP (channel 1, version 1 + login cookie TLV 0x0006). */
function buildBOSSignonFLAP(cookie: Buffer, seq: number): Buffer {
  const data = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x01]),
    buildTLV(0x0006, cookie),
  ]);
  return buildFLAPFrame(FLAPChannel.Signon, seq, data);
}

/** ClientReady SNAC (0x0001/0x0002) — declares supported service families. */
function buildClientReadySNAC(): Buffer {
  // Each entry: family(2) + version(2) + tool(2) + toolversion(2)
  const svcList = Buffer.concat([
    Buffer.from([0x00, 0x01, 0x00, 0x04, 0x01, 0x10, 0x06, 0x29]),  // Generic
    Buffer.from([0x00, 0x02, 0x00, 0x01, 0x01, 0x10, 0x06, 0x29]),  // Location
    Buffer.from([0x00, 0x03, 0x00, 0x01, 0x01, 0x10, 0x06, 0x29]),  // Buddy list
    Buffer.from([0x00, 0x04, 0x00, 0x01, 0x01, 0x10, 0x06, 0x29]),  // ICBM messaging
  ]);
  return buildSNAC(0x0001, 0x0002, svcList);
}

/**
 * Build ICBM SendIM SNAC (family 0x0004, subtype 0x0006).
 * Channel 1: plaintext IM message.
 */
function buildICBMSendIM(targetSN: string, message: string): Buffer {
  // 8-byte random ICBM cookie
  const cookie = Buffer.allocUnsafe(8);
  for (let i = 0; i < 8; i++) cookie[i] = Math.floor(Math.random() * 256);

  const msgBuf = Buffer.from(message, 'ascii');

  // Capability fragment: type=0x05, flags=0x01, length=4, data=4 zero bytes
  const capFrag = Buffer.from([0x05, 0x01, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00]);

  // Text fragment: type=0x01, flags=0x01, length=(4+textlen), charset=ASCII(0), sub=0
  const textFragLen = 4 + msgBuf.length;
  const textFrag = Buffer.concat([
    Buffer.from([0x01, 0x01, (textFragLen >> 8) & 0xff, textFragLen & 0xff]),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),  // charset + sub-charset
    msgBuf,
  ]);

  const msgTLV = buildTLV(0x0002, Buffer.concat([capFrag, textFrag]));

  const targetBuf = Buffer.from(targetSN, 'ascii');
  const body = Buffer.concat([
    cookie,
    Buffer.from([0x00, 0x01]),              // channel 1 (plaintext IM)
    Buffer.from([targetBuf.length & 0xff]), // screenname length (1 byte)
    targetBuf,
    Buffer.from([0x00, 0x00]),              // warnings = 0
    Buffer.from([0x00, 0x01]),              // 1 TLV follows
    msgTLV,
  ]);
  return buildSNAC(0x0004, 0x0006, body);
}

/**
 * Read FLAP frames from a stream until a specific SNAC family/subtype is found.
 * Ignores intermediate frames (e.g., server heartbeats, other SNACs).
 */
async function readSNAC(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  family: number,
  subtype: number,
  timeoutMs: number,
): Promise<{ payload: Buffer; tlvs: Map<number, Buffer> } | null> {
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const raw = await readFLAP(reader, remaining);
      if (!raw) break;
      const frm = parseFLAPFrame(raw);
      if (!frm || frm.channel !== FLAPChannel.SNAC || frm.data.length < 10) continue;
      const f = frm.data.readUInt16BE(0);
      const s = frm.data.readUInt16BE(2);
      if (f === family && s === subtype) {
        const payload = frm.data.subarray(10);
        return { payload, tlvs: parseTLVs(payload) };
      }
    }
  } catch { /* connection closed or timeout */ }
  return null;
}

/**
 * Send an instant message via OSCAR (AIM/ICQ) protocol.
 * Performs full auth flow: AuthKeyRequest → MD5 login → BOS redirect → ICBM SendIM.
 * Works with OSCAR revival servers (e.g., NINA, ICQ revival).
 *
 * POST /api/oscar/send-im
 * Body: { host, port?, screenName, password, targetScreenName, message, timeout? }
 */
export async function handleOSCARSendIM(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      screenName: string;
      password: string;
      targetScreenName: string;
      message: string;
      timeout?: number;
    };
    const {
      host, port = 5190,
      screenName, password,
      targetScreenName, message,
      timeout = 15000,
    } = body;

    if (!host) return Response.json({ success: false, error: 'host required' }, { status: 400 });
    if (!screenName) return Response.json({ success: false, error: 'screenName required' }, { status: 400 });
    if (!password) return Response.json({ success: false, error: 'password required' }, { status: 400 });
    if (!targetScreenName) return Response.json({ success: false, error: 'targetScreenName required' }, { status: 400 });
    if (!message) return Response.json({ success: false, error: 'message required' }, { status: 400 });

    const tp = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Overall timeout')), timeout));

    // === Phase 1: Authenticate on auth server ===
    const authSock = connect(`${host}:${port}`, { secureTransport: 'off' as const, allowHalfOpen: false });
    await Promise.race([authSock.opened, tp]);
    const aW = authSock.writable.getWriter();
    const aR = authSock.readable.getReader();
    let seq = 0;

    // Step 1: Read server signon (FLAP ch 1)
    await readFLAP(aR, 3000).catch(() => null);

    // Step 2: Send client signon (FLAP ch 1, version = 1)
    await aW.write(buildFLAPFrame(FLAPChannel.Signon, seq++, Buffer.from([0x00, 0x00, 0x00, 0x01])));

    // Step 3: Send AuthKeyRequest (SNAC 0x0017/0x0006)
    const akReqSnac = buildSNAC(0x0017, 0x0006, buildTLV(0x0001, Buffer.from(screenName, 'ascii')));
    await aW.write(buildFLAPFrame(FLAPChannel.SNAC, seq++, akReqSnac));

    // Step 4: Read AuthKeyResponse (SNAC 0x0017/0x0007) — TLV 0x0025 = auth key
    const akResp = await Promise.race([readSNAC(aR, 0x0017, 0x0007, 6000), tp]);
    if (!akResp) throw new Error('No AuthKeyResponse from server (SNAC 0x0017/0x0007)');
    const authKey = akResp.tlvs.get(0x0025);
    if (!authKey) throw new Error('Auth key TLV (0x0025) missing in AuthKeyResponse');

    // Step 5: Send LoginRequest (SNAC 0x0017/0x0002) with MD5 hash
    const loginSnac = buildOSCARLoginRequest(screenName, password, authKey);
    await aW.write(buildFLAPFrame(FLAPChannel.SNAC, seq++, loginSnac));

    // Step 6: Read LoginReply (SNAC 0x0017/0x0003) — TLV 0x0005 = BOS addr, 0x0006 = cookie
    const loginReply = await Promise.race([readSNAC(aR, 0x0017, 0x0003, 6000), tp]);
    if (!loginReply) throw new Error('No LoginReply from server (SNAC 0x0017/0x0003)');

    if (loginReply.tlvs.has(0x0008)) {
      const errCode = loginReply.tlvs.get(0x0008)!.readUInt16BE(0);
      throw new Error(`Login failed: error 0x${errCode.toString(16).padStart(4, '0')} (wrong password or screen name)`);
    }

    const bosAddrBuf = loginReply.tlvs.get(0x0005);
    const bosCookie = loginReply.tlvs.get(0x0006);
    if (!bosAddrBuf || !bosCookie) throw new Error('BOS address (0x0005) or cookie (0x0006) missing in LoginReply');

    const bosAddr = new TextDecoder().decode(bosAddrBuf);  // "host:port"
    const colon = bosAddr.lastIndexOf(':');
    const bosHost = colon >= 0 ? bosAddr.slice(0, colon) : host;
    const bosPort = colon >= 0 ? (parseInt(bosAddr.slice(colon + 1), 10) || 5190) : 5190;

    aW.releaseLock();
    aR.releaseLock();
    authSock.close();

    // === Phase 2: Connect to BOS (Basic Oscar Service) server ===
    const bosSock = connect(`${bosHost}:${bosPort}`, { secureTransport: 'off' as const, allowHalfOpen: false });
    await Promise.race([bosSock.opened, tp]);
    const bW = bosSock.writable.getWriter();
    const bR = bosSock.readable.getReader();
    seq = 0;

    // Step 7: Read BOS server signon
    await readFLAP(bR, 3000).catch(() => null);

    // Step 8: Send BOS signon with login cookie (FLAP ch 1, version + TLV 0x0006)
    await bW.write(buildBOSSignonFLAP(bosCookie, seq++));

    // Step 9: Wait for ServerReady (0x0001/0x0003)
    const srvReady = await Promise.race([readSNAC(bR, 0x0001, 0x0003, 8000), tp]);
    if (!srvReady) throw new Error('BOS ServerReady (SNAC 0x0001/0x0003) not received');

    // Step 10: Send ClientReady (0x0001/0x0002)
    await bW.write(buildFLAPFrame(FLAPChannel.SNAC, seq++, buildClientReadySNAC()));

    // Step 11: Send IM (SNAC 0x0004/0x0006 — ICBM channel 1)
    await bW.write(buildFLAPFrame(FLAPChannel.SNAC, seq++, buildICBMSendIM(targetScreenName, message)));

    // Step 12: Drain briefly for any server ack
    const ackRaw = await readFLAP(bR, 2000).catch(() => null);
    const ackFrm = ackRaw ? parseFLAPFrame(ackRaw) : null;
    const ackSNAC = ackFrm?.channel === FLAPChannel.SNAC && ackFrm.data.length >= 4
      ? `${ackFrm.data.readUInt16BE(0).toString(16).padStart(4, '0')}/${ackFrm.data.readUInt16BE(2).toString(16).padStart(4, '0')}`
      : null;

    bW.releaseLock();
    bR.releaseLock();
    bosSock.close();

    return Response.json({
      success: true,
      host,
      port,
      screenName,
      targetScreenName,
      message,
      bosServer: bosAddr,
      messageSent: true,
      ackSNAC,
    });
  } catch (err) {
    return Response.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
