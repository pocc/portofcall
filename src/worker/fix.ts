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
  // Keep a rolling tail of the last 10 bytes to detect checksum across chunk boundaries
  // (10=NNN\x01 is at most 8 bytes: "10=000\x01")
  let tail = '';

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

    // Check if we have a complete FIX message by examining the boundary region
    const chunkText = new TextDecoder().decode(result.value);
    const boundary = tail + chunkText;
    tail = boundary.slice(-10);
    if (/10=\d{3}\x01/.test(boundary)) break;
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

// FIX tag constants for order-related messages
const FIX_TAG_CLORDID  = 11;
const FIX_TAG_HANDLINST = 21;
const FIX_TAG_SYMBOL   = 55;
const FIX_TAG_SIDE     = 54;
const FIX_TAG_ORDERQTY = 38;
const FIX_TAG_ORDTYPE  = 40;
const FIX_TAG_PRICE    = 44;
const FIX_TAG_TRANSACT_TIME = 60;
const FIX_TAG_EXECID   = 17;
const FIX_TAG_ORDSTATUS = 39;
const FIX_TAG_EXECTYPE = 150;
const FIX_TAG_TEXT     = 58;

/**
 * Generate a random ClOrdID
 */
function randomClOrdID(): string {
  return `POC-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

/**
 * Human-readable OrdStatus values
 */
function ordStatusName(status: string): string {
  const names: Record<string, string> = {
    '0': 'New',
    '1': 'Partially Filled',
    '2': 'Filled',
    '3': 'Done for Day',
    '4': 'Canceled',
    '5': 'Replaced',
    '6': 'Pending Cancel',
    '7': 'Stopped',
    '8': 'Rejected',
    '9': 'Suspended',
    A:   'Pending New',
    B:   'Calculated',
    C:   'Expired',
    D:   'Accepted for Bidding',
    E:   'Pending Replace',
  };
  return names[status] || `Unknown(${status})`;
}

/**
 * Human-readable ExecType values
 */
function execTypeName(type: string): string {
  const names: Record<string, string> = {
    '0': 'New',
    '1': 'Partial Fill',
    '2': 'Fill',
    '3': 'Done for Day',
    '4': 'Canceled',
    '5': 'Replaced',
    '6': 'Pending Cancel',
    '7': 'Stopped',
    '8': 'Rejected',
    '9': 'Suspended',
    A:   'Pending New',
    B:   'Calculated',
    C:   'Expired',
    D:   'Restated',
    E:   'Pending Replace',
    F:   'Trade',
    G:   'Trade Correct',
    H:   'Trade Cancel',
    I:   'Order Status',
  };
  return names[type] || `Unknown(${type})`;
}

/** A parsed FIX message with its raw text and structured fields */
interface FIXMessageResult {
  raw: string;
  fields: Map<number, string>;
  msgType: string | undefined;
}

/**
 * Read multiple FIX messages from the stream until a specific MsgType appears
 * or the timeout is reached. Returns all messages received, each individually parsed.
 */
async function readFIXUntilMsgType(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  targetMsgType: string,
  timeoutMs: number
): Promise<FIXMessageResult[]> {
  const messages: FIXMessageResult[] = [];
  const deadline = Date.now() + timeoutMs;
  let buffer = '';

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
      setTimeout(() => resolve({ done: true, value: undefined }), Math.min(remaining, 2000));
    });

    const result = await Promise.race([reader.read(), timeoutPromise]);
    if (result.done || !result.value) break;

    buffer += new TextDecoder().decode(result.value);

    // Extract complete FIX messages (each ends with 10=xxx<SOH>)
    const msgRegex = /8=FIX[^\x01]*(?:\x01[^\x01=]+=[^\x01]*)*\x0110=\d{3}\x01/g;
    let match: RegExpExecArray | null;
    let lastMatchEnd = 0;
    while ((match = msgRegex.exec(buffer)) !== null) {
      const raw = match[0];
      const fields = parseFIXMessage(raw);
      const msgType = fields.get(35);
      messages.push({ raw, fields, msgType });
      lastMatchEnd = match.index + raw.length;
      if (msgType === targetMsgType) {
        return messages;
      }
    }

    // Remove fully-parsed messages from buffer, keeping only unmatched remainder
    if (lastMatchEnd > 0) {
      buffer = buffer.slice(lastMatchEnd);
    }
  }

  return messages;
}

/**
 * Send a NewOrderSingle (35=D) to a FIX engine.
 * Performs: Logon -> parse logon ack -> send NewOrderSingle -> read ExecutionReport -> Logout.
 */
export async function handleFIXOrder(request: Request): Promise<Response> {
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
      senderCompID?: string;
      targetCompID?: string;
      senderSubId?: string;
      fixVersion?: string;
      symbol?: string;
      side?: string;
      qty?: number | string;
      price?: number | string;
      ordType?: string;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!body.symbol) {
      return new Response(
        JSON.stringify({ success: false, error: 'symbol is required (e.g. AAPL, EUR/USD)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!body.side) {
      return new Response(
        JSON.stringify({ success: false, error: 'side is required: "1" (Buy) or "2" (Sell)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!body.qty) {
      return new Response(
        JSON.stringify({ success: false, error: 'qty is required (order quantity)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 9878;
    const timeout = body.timeout || 15000;
    const senderCompID = body.senderCompID || 'PORTOFCALL';
    const targetCompID = body.targetCompID || 'TARGET';
    const senderSubId = body.senderSubId;
    const fixVersion = body.fixVersion || 'FIX.4.4';
    const symbol = body.symbol;
    const side = String(body.side); // '1'=Buy, '2'=Sell
    const qty = String(body.qty);
    const price = body.price !== undefined ? String(body.price) : null;
    const ordType = body.ordType || (price ? '2' : '1'); // '1'=Market, '2'=Limit

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

      // ---- Step 1: Logon (35=A) ----
      const logonFields: [number, string][] = [
        [8, fixVersion],
        [35, 'A'],
        [49, senderCompID],
        [56, targetCompID],
        [34, '1'],
        [52, fixTimestamp()],
        [98, '0'],    // EncryptMethod: None
        [108, '30'], // HeartBtInt: 30 seconds
        [141, 'Y'],  // ResetSeqNumFlag
      ];
      if (senderSubId) {
        logonFields.splice(4, 0, [50, senderSubId]); // SenderSubID after TargetCompID
      }

      const logonMsg = buildFIXMessage(logonFields);
      await writer.write(new TextEncoder().encode(logonMsg));

      // Read until we get a Logon ack (35=A), Reject, or Logout
      const logonResults = await readFIXUntilMsgType(reader, 'A', Math.min(timeout - (Date.now() - startTime), 5000));
      // Find the Logon ack specifically (not other messages like SequenceReset)
      const logonResult = logonResults.find(m => m.msgType === 'A');
      const lastResult = logonResults[logonResults.length - 1];
      const logonParsed = logonResult?.fields ?? lastResult?.fields ?? new Map<number, string>();
      const logonMsgType = logonResult?.msgType ?? lastResult?.msgType;
      const logonRaw = logonResults.map(m => m.raw).join('');

      const logonAck = logonMsgType === 'A';

      if (!logonAck) {
        // Send Logout before returning error
        try {
          const logoutMsg = buildFIXMessage([
            [8, fixVersion], [35, '5'], [49, senderCompID], [56, targetCompID], [34, '2'], [52, fixTimestamp()],
          ]);
          await writer.write(new TextEncoder().encode(logoutMsg));
        } catch { /* ignore logout errors */ }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return new Response(
          JSON.stringify({
            success: false,
            error: `Logon not acknowledged. Server responded with MsgType=${logonMsgType || 'none'}: ${logonParsed.get(58) || 'no message'}`,
            logonAck: false,
            rawLogon: logonRaw.replace(/\x01/g, '|'),
          }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      // ---- Step 2: NewOrderSingle (35=D) ----
      const clOrdID = randomClOrdID();
      const orderFields: [number, string][] = [
        [8, fixVersion],
        [35, 'D'],
        [49, senderCompID],
        [56, targetCompID],
        [34, '2'],
        [52, fixTimestamp()],
        [FIX_TAG_CLORDID, clOrdID],            // 11 = ClOrdID
        [FIX_TAG_HANDLINST, '1'],               // 21 = HandlInst: Automated, no intervention
        [FIX_TAG_SYMBOL, symbol],               // 55 = Symbol
        [FIX_TAG_SIDE, side],                   // 54 = Side
        [FIX_TAG_TRANSACT_TIME, fixTimestamp()], // 60 = TransactTime
        [FIX_TAG_ORDERQTY, qty],                // 38 = OrderQty
        [FIX_TAG_ORDTYPE, ordType],             // 40 = OrdType
      ];

      if (price && ordType === '2') {
        orderFields.push([FIX_TAG_PRICE, price]); // 44 = Price (Limit orders only)
      }

      if (senderSubId) {
        orderFields.splice(4, 0, [50, senderSubId]);
      }

      const orderMsg = buildFIXMessage(orderFields);
      await writer.write(new TextEncoder().encode(orderMsg));

      // ---- Step 3: Read ExecutionReport (35=8) ----
      const execResults = await readFIXUntilMsgType(reader, '8', Math.min(timeout - (Date.now() - startTime), 5000));
      // Find the ExecutionReport specifically, fall back to last message received
      const execResult = execResults.find(m => m.msgType === '8');
      const lastExecResult = execResults[execResults.length - 1];
      const execParsed = execResult?.fields ?? lastExecResult?.fields ?? new Map<number, string>();
      const execRaw = execResult?.raw ?? lastExecResult?.raw ?? '';

      const execMsgType = execParsed.get(35);
      const execId = execParsed.get(FIX_TAG_EXECID);
      const ordStatus = execParsed.get(FIX_TAG_ORDSTATUS);
      const execType = execParsed.get(FIX_TAG_EXECTYPE);
      const rejectText = execParsed.get(FIX_TAG_TEXT);
      const rtt = Date.now() - startTime;

      // ---- Step 4: Logout (35=5) ----
      const logoutMsg = buildFIXMessage([
        [8, fixVersion],
        [35, '5'],
        [49, senderCompID],
        [56, targetCompID],
        [34, '3'],
        [52, fixTimestamp()],
      ]);
      try {
        await writer.write(new TextEncoder().encode(logoutMsg));
      } catch { /* ignore logout write errors */ }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Build human-readable field dump for the exec report
      const execFieldDump: string[] = [];
      for (const [tag, val] of execParsed.entries()) {
        const name = tagName(tag);
        let displayVal = val;
        if (tag === 35) displayVal = `${val} (${msgTypeName(val)})`;
        if (tag === FIX_TAG_ORDSTATUS) displayVal = `${val} (${ordStatusName(val)})`;
        if (tag === FIX_TAG_EXECTYPE) displayVal = `${val} (${execTypeName(val)})`;
        execFieldDump.push(`  ${name} (${tag}): ${displayVal}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          rtt,
          fixVersion,
          protocol: 'FIX',
          logonAck,
          clOrdID,
          symbol,
          side: side === '1' ? 'Buy' : side === '2' ? 'Sell' : side,
          qty,
          price: price || null,
          ordType: ordType === '1' ? 'Market' : ordType === '2' ? 'Limit' : ordType,
          execReportReceived: execMsgType === '8',
          execId: execId || null,
          ordStatus: ordStatus ? ordStatusName(ordStatus) : null,
          ordStatusRaw: ordStatus || null,
          execType: execType ? execTypeName(execType) : null,
          execTypeRaw: execType || null,
          text: rejectText || null,
          execFields: execFieldDump.length > 0 ? execFieldDump : null,
          rawExecReport: execRaw ? execRaw.replace(/\x01/g, '|') : null,
          message: execMsgType === '8'
            ? `ExecutionReport received: OrdStatus=${ordStatus ? ordStatusName(ordStatus) : 'unknown'} in ${rtt}ms`
            : execMsgType === '3'
            ? `Order rejected: ${rejectText || 'unknown reason'} in ${rtt}ms`
            : execRaw
            ? `Response received (${msgTypeName(execMsgType || '?')}) in ${rtt}ms`
            : `Order sent but no ExecutionReport received in ${rtt}ms`,
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
        error: error instanceof Error ? error.message : 'FIX order failed',
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
