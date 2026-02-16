/**
 * FIX Protocol Implementation (Financial Information eXchange)
 *
 * FIX is a text-based TCP protocol used in financial trading for
 * order routing, execution reporting, and market data distribution.
 * It's the backbone of electronic trading worldwide.
 *
 * Protocol: Tag=Value pairs delimited by SOH (0x01)
 * Default ports: 9878 (common), 9010, 4500 (varies by venue)
 *
 * Message structure:
 *   8=FIX.4.4|9=<bodylen>|35=<type>|...|10=<checksum>|
 *   (| represents SOH / 0x01)
 *
 * Key tags:
 *   8  = BeginString (FIX version: FIX.4.0 - FIX.4.4, FIXT.1.1)
 *   9  = BodyLength (bytes from after tag 9 to before tag 10)
 *   35 = MsgType (A=Logon, 0=Heartbeat, 1=TestRequest, 5=Logout)
 *   49 = SenderCompID
 *   56 = TargetCompID
 *   34 = MsgSeqNum
 *   52 = SendingTime (UTC timestamp)
 *   98 = EncryptMethod (0=None)
 *   108 = HeartBtInt (heartbeat interval seconds)
 *   10 = CheckSum (mod 256 sum of all preceding bytes)
 *
 * Security: Read-only probing. We send a Logon and observe the response.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const SOH = '\x01'; // FIX field delimiter

/**
 * Calculate FIX checksum (sum of all bytes mod 256, zero-padded to 3 digits)
 */
function fixChecksum(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data.charCodeAt(i);
  }
  return String(sum % 256).padStart(3, '0');
}

/**
 * Build a FIX message with proper BodyLength and CheckSum
 */
function buildFIXMessage(fields: [number, string][]): string {
  // Separate header fields (8, 9) and trailer (10) from body
  const beginString = fields.find(([tag]) => tag === 8)?.[1] || 'FIX.4.4';

  // Build body (everything between tag 9 and tag 10)
  const bodyFields = fields.filter(([tag]) => tag !== 8 && tag !== 9 && tag !== 10);
  const body = bodyFields.map(([tag, val]) => `${tag}=${val}`).join(SOH) + SOH;

  // Calculate BodyLength
  const bodyLength = body.length;

  // Build full message without checksum
  const preChecksum = `8=${beginString}${SOH}9=${bodyLength}${SOH}${body}`;

  // Calculate and append checksum
  const checksum = fixChecksum(preChecksum);
  return `${preChecksum}10=${checksum}${SOH}`;
}

/**
 * Format a UTC timestamp for FIX tag 52 (SendingTime)
 */
function fixTimestamp(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const H = String(now.getUTCHours()).padStart(2, '0');
  const M = String(now.getUTCMinutes()).padStart(2, '0');
  const S = String(now.getUTCSeconds()).padStart(2, '0');
  const ms = String(now.getUTCMilliseconds()).padStart(3, '0');
  return `${y}${m}${d}-${H}:${M}:${S}.${ms}`;
}

/**
 * Parse a FIX message into a map of tag -> value
 */
function parseFIXMessage(raw: string): Map<number, string> {
  const fields = new Map<number, string>();
  const parts = raw.split(SOH).filter((p) => p.length > 0);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      const tag = parseInt(part.substring(0, eq));
      const val = part.substring(eq + 1);
      if (!isNaN(tag)) {
        fields.set(tag, val);
      }
    }
  }
  return fields;
}

/**
 * Human-readable FIX message type names
 */
function msgTypeName(type: string): string {
  const types: Record<string, string> = {
    '0': 'Heartbeat',
    '1': 'TestRequest',
    '2': 'ResendRequest',
    '3': 'Reject',
    '4': 'SequenceReset',
    '5': 'Logout',
    '8': 'ExecutionReport',
    '9': 'OrderCancelReject',
    A: 'Logon',
    D: 'NewOrderSingle',
    F: 'OrderCancelRequest',
    G: 'OrderCancelReplaceRequest',
    W: 'MarketDataSnapshot',
    X: 'MarketDataIncRefresh',
    Y: 'MarketDataRequestReject',
    j: 'BusinessMessageReject',
  };
  return types[type] || `Unknown(${type})`;
}

/**
 * Human-readable FIX tag names
 */
function tagName(tag: number): string {
  const names: Record<number, string> = {
    8: 'BeginString',
    9: 'BodyLength',
    10: 'CheckSum',
    35: 'MsgType',
    49: 'SenderCompID',
    56: 'TargetCompID',
    34: 'MsgSeqNum',
    52: 'SendingTime',
    58: 'Text',
    98: 'EncryptMethod',
    108: 'HeartBtInt',
    141: 'ResetSeqNumFlag',
    553: 'Username',
    554: 'Password',
    789: 'NextExpectedMsgSeqNum',
    1137: 'DefaultApplVerID',
  };
  return names[tag] || `Tag${tag}`;
}

/**
 * Read raw TCP response data with timeout
 */
async function readResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 64 * 1024;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
      setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 3000));
    });

    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;

    chunks.push(result.value);
    totalBytes += result.value.length;
    if (totalBytes >= maxBytes) break;

    // Check if we have a complete FIX message (ends with 10=xxx<SOH>)
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(combined);
    // A complete FIX message contains 10= followed by 3 digits and SOH
    if (/10=\d{3}\x01/.test(text)) break;
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(combined);
}

/**
 * Probe a FIX engine by sending a Logon message and analyzing the response
 */
export async function handleFIXProbe(request: Request): Promise<Response> {
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
      senderCompID?: string;
      targetCompID?: string;
      fixVersion?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 9878;
    const senderCompID = body.senderCompID || 'PORTOFCALL';
    const targetCompID = body.targetCompID || 'TARGET';
    const fixVersion = body.fixVersion || 'FIX.4.4';
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Build and send FIX Logon message (35=A)
      const logonMsg = buildFIXMessage([
        [8, fixVersion],
        [35, 'A'],
        [49, senderCompID],
        [56, targetCompID],
        [34, '1'],
        [52, fixTimestamp()],
        [98, '0'],   // EncryptMethod: None
        [108, '30'], // HeartBtInt: 30 seconds
        [141, 'Y'],  // ResetSeqNumFlag
      ]);

      await writer.write(new TextEncoder().encode(logonMsg));

      // Read response
      const rawResponse = await readResponse(reader, Math.min(timeout, 5000));
      const rtt = Date.now() - startTime;

      // Send Logout (35=5) to cleanly disconnect
      const logoutMsg = buildFIXMessage([
        [8, fixVersion],
        [35, '5'],
        [49, senderCompID],
        [56, targetCompID],
        [34, '2'],
        [52, fixTimestamp()],
      ]);
      await writer.write(new TextEncoder().encode(logoutMsg));

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Parse response
      const parsed = parseFIXMessage(rawResponse);
      const msgType = parsed.get(35);
      const responseVersion = parsed.get(8);
      const responseSender = parsed.get(49);
      const responseTarget = parsed.get(56);
      const rejectText = parsed.get(58);
      const heartBtInt = parsed.get(108);

      // Format human-readable field dump
      const fieldDump: string[] = [];
      for (const [tag, val] of parsed.entries()) {
        const name = tagName(tag);
        const displayVal = tag === 35 ? `${val} (${msgTypeName(val)})` : val;
        fieldDump.push(`  ${name} (${tag}): ${displayVal}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          fixVersion: responseVersion || fixVersion,
          msgType: msgType ? msgTypeName(msgType) : null,
          msgTypeRaw: msgType || null,
          senderCompID: responseSender || null,
          targetCompID: responseTarget || null,
          heartBtInt: heartBtInt ? parseInt(heartBtInt) : null,
          rejectText: rejectText || null,
          isLogonAccepted: msgType === 'A',
          isLogout: msgType === '5',
          isReject: msgType === '3' || msgType === 'j',
          fields: fieldDump,
          rawResponse: rawResponse.replace(/\x01/g, '|'),
          protocol: 'FIX',
          message: msgType === 'A'
            ? `FIX Logon accepted (${responseVersion}) in ${rtt}ms`
            : msgType === '5'
            ? `FIX Logout received: ${rejectText || 'session ended'} in ${rtt}ms`
            : msgType === '3'
            ? `FIX Reject: ${rejectText || 'unknown reason'} in ${rtt}ms`
            : rawResponse
            ? `FIX response received (${msgTypeName(msgType || '?')}) in ${rtt}ms`
            : `TCP connected but no FIX response in ${rtt}ms`,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'FIX connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Send a FIX Heartbeat/TestRequest to check engine liveness
 */
export async function handleFIXHeartbeat(request: Request): Promise<Response> {
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
      senderCompID?: string;
      targetCompID?: string;
      fixVersion?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 9878;
    const senderCompID = body.senderCompID || 'PORTOFCALL';
    const targetCompID = body.targetCompID || 'TARGET';
    const fixVersion = body.fixVersion || 'FIX.4.4';
    const timeout = body.timeout || 10000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Logon
      const logonMsg = buildFIXMessage([
        [8, fixVersion],
        [35, 'A'],
        [49, senderCompID],
        [56, targetCompID],
        [34, '1'],
        [52, fixTimestamp()],
        [98, '0'],
        [108, '30'],
        [141, 'Y'],
      ]);
      await writer.write(new TextEncoder().encode(logonMsg));
      const logonResponse = await readResponse(reader, Math.min(timeout, 3000));
      const logonParsed = parseFIXMessage(logonResponse);

      if (logonParsed.get(35) !== 'A') {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(
          JSON.stringify({
            success: false,
            error: `Logon rejected: ${logonParsed.get(58) || 'no logon acknowledgment'}`,
            rawResponse: logonResponse.replace(/\x01/g, '|'),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Step 2: Send TestRequest (35=1) with TestReqID
      const testReqID = `PROBE-${Date.now()}`;
      const testMsg = buildFIXMessage([
        [8, fixVersion],
        [35, '1'],
        [49, senderCompID],
        [56, targetCompID],
        [34, '2'],
        [52, fixTimestamp()],
        [112, testReqID],
      ]);
      await writer.write(new TextEncoder().encode(testMsg));
      const testResponse = await readResponse(reader, Math.min(timeout, 3000));
      const testParsed = parseFIXMessage(testResponse);
      const rtt = Date.now() - startTime;

      // Step 3: Logout
      const logoutMsg = buildFIXMessage([
        [8, fixVersion],
        [35, '5'],
        [49, senderCompID],
        [56, targetCompID],
        [34, '3'],
        [52, fixTimestamp()],
      ]);
      await writer.write(new TextEncoder().encode(logoutMsg));

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const responseMsgType = testParsed.get(35);
      const responseTestReqID = testParsed.get(112);

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          fixVersion: logonParsed.get(8) || fixVersion,
          logonAccepted: true,
          heartbeatReceived: responseMsgType === '0',
          testReqID,
          echoedTestReqID: responseTestReqID || null,
          responseMsgType: responseMsgType ? msgTypeName(responseMsgType) : null,
          rawResponse: testResponse.replace(/\x01/g, '|'),
          protocol: 'FIX',
          message: responseMsgType === '0'
            ? `Heartbeat received in ${rtt}ms`
            : `Response: ${msgTypeName(responseMsgType || '?')} in ${rtt}ms`,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'FIX heartbeat test failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
