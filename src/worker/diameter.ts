/**
 * Diameter Protocol Support for Cloudflare Workers
 * Implements Diameter Base Protocol (RFC 6733)
 * Port 3868 - AAA protocol, successor to RADIUS
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Diameter constants
const DIAMETER_VERSION = 1;
const DIAMETER_HEADER_LENGTH = 20;

// Command codes
const CMD_CAPABILITIES_EXCHANGE = 257;
const CMD_DEVICE_WATCHDOG = 280;
const CMD_DISCONNECT_PEER = 282;

// Flags
const FLAG_REQUEST = 0x80;

// AVP codes
const AVP_ORIGIN_HOST = 264;
const AVP_ORIGIN_REALM = 296;
const AVP_HOST_IP_ADDRESS = 257;
const AVP_VENDOR_ID = 266;
const AVP_PRODUCT_NAME = 269;
const AVP_AUTH_APPLICATION_ID = 258;
const AVP_FIRMWARE_REVISION = 267;
const AVP_RESULT_CODE = 268;
const AVP_ORIGIN_STATE_ID = 278;
const AVP_DISCONNECT_CAUSE = 273;

// Result codes
const RESULT_SUCCESS = 2001;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Encode a Diameter AVP (Attribute-Value Pair)
 */
function encodeAVP(code: number, mandatory: boolean, value: Uint8Array): Uint8Array {
  const headerLen = 8;
  const avpLen = headerLen + value.length;
  const paddedLen = Math.ceil(avpLen / 4) * 4;

  const buf = new Uint8Array(paddedLen);
  const view = new DataView(buf.buffer);

  // AVP Code (4 bytes)
  view.setUint32(0, code, false);

  // Flags (1 byte) + AVP Length (3 bytes)
  const flags = mandatory ? 0x40 : 0x00;
  view.setUint8(4, flags);
  view.setUint8(5, (avpLen >> 16) & 0xff);
  view.setUint8(6, (avpLen >> 8) & 0xff);
  view.setUint8(7, avpLen & 0xff);

  // Value
  buf.set(value, headerLen);

  return buf;
}

function encodeStringAVP(code: number, mandatory: boolean, str: string): Uint8Array {
  return encodeAVP(code, mandatory, encoder.encode(str));
}

function encodeUint32AVP(code: number, mandatory: boolean, val: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, val, false);
  return encodeAVP(code, mandatory, buf);
}

function encodeAddressAVP(code: number, mandatory: boolean): Uint8Array {
  // Address family (2 bytes) + IPv4 (4 bytes) = 6 bytes
  // Use 0.0.0.0 as placeholder
  const buf = new Uint8Array(6);
  const view = new DataView(buf.buffer);
  view.setUint16(0, 1, false); // AF_INET
  // IP bytes remain 0.0.0.0
  return encodeAVP(code, mandatory, buf);
}

/**
 * Build a Diameter message from header fields and AVPs
 */
function buildDiameterMessage(
  commandCode: number,
  flags: number,
  applicationId: number,
  hopByHopId: number,
  endToEndId: number,
  avps: Uint8Array[]
): Uint8Array {
  const avpsTotalLen = avps.reduce((sum, a) => sum + a.length, 0);
  const totalLen = DIAMETER_HEADER_LENGTH + avpsTotalLen;

  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  // Version (1 byte)
  view.setUint8(0, DIAMETER_VERSION);

  // Message Length (3 bytes)
  view.setUint8(1, (totalLen >> 16) & 0xff);
  view.setUint8(2, (totalLen >> 8) & 0xff);
  view.setUint8(3, totalLen & 0xff);

  // Command Flags (1 byte)
  view.setUint8(4, flags);

  // Command Code (3 bytes)
  view.setUint8(5, (commandCode >> 16) & 0xff);
  view.setUint8(6, (commandCode >> 8) & 0xff);
  view.setUint8(7, commandCode & 0xff);

  // Application-ID (4 bytes)
  view.setUint32(8, applicationId, false);

  // Hop-by-Hop Identifier (4 bytes)
  view.setUint32(12, hopByHopId, false);

  // End-to-End Identifier (4 bytes)
  view.setUint32(16, endToEndId, false);

  // AVPs
  let offset = DIAMETER_HEADER_LENGTH;
  for (const avp of avps) {
    buf.set(avp, offset);
    offset += avp.length;
  }

  return buf;
}

/**
 * Parse a Diameter message header and AVPs from raw bytes
 */
function parseDiameterMessage(data: Uint8Array): {
  version: number;
  length: number;
  flags: number;
  commandCode: number;
  applicationId: number;
  hopByHopId: number;
  endToEndId: number;
  avps: { code: number; flags: number; length: number; value: Uint8Array }[];
} {
  const view = new DataView(data.buffer, data.byteOffset);

  const version = view.getUint8(0);
  const length = (view.getUint8(1) << 16) | (view.getUint8(2) << 8) | view.getUint8(3);
  const flags = view.getUint8(4);
  const commandCode = (view.getUint8(5) << 16) | (view.getUint8(6) << 8) | view.getUint8(7);
  const applicationId = view.getUint32(8, false);
  const hopByHopId = view.getUint32(12, false);
  const endToEndId = view.getUint32(16, false);

  // Parse AVPs
  const avps: { code: number; flags: number; length: number; value: Uint8Array }[] = [];
  let offset = DIAMETER_HEADER_LENGTH;

  while (offset < length && offset < data.length) {
    if (offset + 8 > data.length) break;

    const avpView = new DataView(data.buffer, data.byteOffset + offset);
    const avpCode = avpView.getUint32(0, false);
    const avpFlags = avpView.getUint8(4);
    const avpLength = (avpView.getUint8(5) << 16) | (avpView.getUint8(6) << 8) | avpView.getUint8(7);

    const hasVendor = (avpFlags & 0x80) !== 0;
    const valueOffset = hasVendor ? 12 : 8;
    const valueLength = avpLength - valueOffset;

    let value = new Uint8Array(0);
    if (valueLength > 0 && offset + valueOffset + valueLength <= data.length) {
      value = data.slice(offset + valueOffset, offset + valueOffset + valueLength);
    }

    avps.push({ code: avpCode, flags: avpFlags, length: avpLength, value });

    // Advance to next AVP (padded to 4-byte boundary)
    offset += Math.ceil(avpLength / 4) * 4;
  }

  return { version, length, flags, commandCode, applicationId, hopByHopId, endToEndId, avps };
}

/**
 * Extract known AVP values as human-readable info
 */
function extractAVPInfo(avps: { code: number; flags: number; length: number; value: Uint8Array }[]): Record<string, string> {
  const info: Record<string, string> = {};

  for (const avp of avps) {
    switch (avp.code) {
      case AVP_ORIGIN_HOST:
        info['Origin-Host'] = decoder.decode(avp.value);
        break;
      case AVP_ORIGIN_REALM:
        info['Origin-Realm'] = decoder.decode(avp.value);
        break;
      case AVP_PRODUCT_NAME:
        info['Product-Name'] = decoder.decode(avp.value);
        break;
      case AVP_VENDOR_ID:
        if (avp.value.length >= 4) {
          info['Vendor-Id'] = new DataView(avp.value.buffer, avp.value.byteOffset).getUint32(0, false).toString();
        }
        break;
      case AVP_FIRMWARE_REVISION:
        if (avp.value.length >= 4) {
          info['Firmware-Revision'] = new DataView(avp.value.buffer, avp.value.byteOffset).getUint32(0, false).toString();
        }
        break;
      case AVP_RESULT_CODE:
        if (avp.value.length >= 4) {
          const code = new DataView(avp.value.buffer, avp.value.byteOffset).getUint32(0, false);
          info['Result-Code'] = `${code} (${code === RESULT_SUCCESS ? 'SUCCESS' : code >= 3000 && code < 4000 ? 'PROTOCOL_ERROR' : code >= 5000 ? 'PERMANENT_FAILURE' : 'UNKNOWN'})`;
        }
        break;
      case AVP_AUTH_APPLICATION_ID:
        if (avp.value.length >= 4) {
          const appId = new DataView(avp.value.buffer, avp.value.byteOffset).getUint32(0, false);
          info['Auth-Application-Id'] = appId.toString();
        }
        break;
    }
  }

  return info;
}

/**
 * Read a complete Diameter message from a socket reader
 */
async function readDiameterMessage(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalRead = 0;
  let messageLength = 0;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed before complete message');

      chunks.push(value);
      totalRead += value.length;

      // Once we have at least 4 bytes, parse the message length
      if (messageLength === 0 && totalRead >= 4) {
        const header = new Uint8Array(4);
        let copied = 0;
        for (const chunk of chunks) {
          const toCopy = Math.min(chunk.length, 4 - copied);
          header.set(chunk.slice(0, toCopy), copied);
          copied += toCopy;
          if (copied >= 4) break;
        }
        messageLength = (header[1] << 16) | (header[2] << 8) | header[3];
      }

      if (messageLength > 0 && totalRead >= messageLength) {
        // Combine all chunks
        const result = new Uint8Array(totalRead);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        return result.slice(0, messageLength);
      }
    }
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Handle Diameter connect - sends CER (Capabilities-Exchange-Request)
 * and reads CEA (Capabilities-Exchange-Answer)
 */
export async function handleDiameterConnect(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      originHost?: string;
      originRealm?: string;
      timeout?: number;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 3868;
    const originHost = options.originHost || 'portofcall.ross.gg';
    const originRealm = options.originRealm || 'ross.gg';
    const timeoutMs = options.timeout || 15000;

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Build CER (Capabilities-Exchange-Request)
        const hopByHopId = Math.floor(Math.random() * 0xffffffff);
        const endToEndId = Math.floor(Math.random() * 0xffffffff);

        const avps = [
          encodeStringAVP(AVP_ORIGIN_HOST, true, originHost),
          encodeStringAVP(AVP_ORIGIN_REALM, true, originRealm),
          encodeAddressAVP(AVP_HOST_IP_ADDRESS, true),
          encodeUint32AVP(AVP_VENDOR_ID, true, 0),
          encodeStringAVP(AVP_PRODUCT_NAME, false, 'PortOfCall'),
          encodeUint32AVP(AVP_AUTH_APPLICATION_ID, true, 0), // Common Messages
          encodeUint32AVP(AVP_FIRMWARE_REVISION, false, 1),
        ];

        const cer = buildDiameterMessage(
          CMD_CAPABILITIES_EXCHANGE,
          FLAG_REQUEST,
          0, // Common application
          hopByHopId,
          endToEndId,
          avps
        );

        await writer.write(cer);

        // Read CEA
        const ceaBytes = await readDiameterMessage(reader, timeoutMs);
        const cea = parseDiameterMessage(ceaBytes);
        const avpInfo = extractAVPInfo(cea.avps);

        // Check result code
        const resultCodeAVP = cea.avps.find(a => a.code === AVP_RESULT_CODE);
        let resultCode = 0;
        if (resultCodeAVP && resultCodeAVP.value.length >= 4) {
          resultCode = new DataView(resultCodeAVP.value.buffer, resultCodeAVP.value.byteOffset).getUint32(0, false);
        }

        const isRequest = (cea.flags & FLAG_REQUEST) !== 0;

        // Send DPR to cleanly disconnect
        const dprAvps = [
          encodeStringAVP(AVP_ORIGIN_HOST, true, originHost),
          encodeStringAVP(AVP_ORIGIN_REALM, true, originRealm),
          encodeUint32AVP(AVP_DISCONNECT_CAUSE, true, 0), // REBOOTING
        ];

        const dpr = buildDiameterMessage(
          CMD_DISCONNECT_PEER,
          FLAG_REQUEST,
          0,
          hopByHopId + 1,
          endToEndId + 1,
          dprAvps
        );

        await writer.write(dpr);
        writer.releaseLock();

        // Try to read DPA but don't fail if it times out
        try {
          await readDiameterMessage(reader, 3000);
        } catch {
          // DPA timeout is fine
        }

        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          message: 'Diameter peer reachable',
          host,
          port,
          protocol: {
            version: cea.version,
            commandCode: cea.commandCode,
            commandName: cea.commandCode === CMD_CAPABILITIES_EXCHANGE ? 'Capabilities-Exchange-Answer (CEA)' : `Command ${cea.commandCode}`,
            isRequest,
            applicationId: cea.applicationId,
            resultCode,
            resultCodeName: resultCode === RESULT_SUCCESS ? 'DIAMETER_SUCCESS' :
              resultCode >= 3000 && resultCode < 4000 ? 'PROTOCOL_ERROR' :
              resultCode >= 5000 ? 'PERMANENT_FAILURE' : `Code ${resultCode}`,
          },
          peerInfo: avpInfo,
          rawAvpCount: cea.avps.length,
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
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
 * Handle Diameter watchdog - sends DWR (Device-Watchdog-Request)
 * and reads DWA (Device-Watchdog-Answer)
 */
export async function handleDiameterWatchdog(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      originHost?: string;
      originRealm?: string;
      timeout?: number;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 3868;
    const originHost = options.originHost || 'portofcall.ross.gg';
    const originRealm = options.originRealm || 'ross.gg';
    const timeoutMs = options.timeout || 15000;

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const hopByHopId = Math.floor(Math.random() * 0xffffffff);
        const endToEndId = Math.floor(Math.random() * 0xffffffff);

        // First exchange capabilities (required before watchdog)
        const cerAvps = [
          encodeStringAVP(AVP_ORIGIN_HOST, true, originHost),
          encodeStringAVP(AVP_ORIGIN_REALM, true, originRealm),
          encodeAddressAVP(AVP_HOST_IP_ADDRESS, true),
          encodeUint32AVP(AVP_VENDOR_ID, true, 0),
          encodeStringAVP(AVP_PRODUCT_NAME, false, 'PortOfCall'),
          encodeUint32AVP(AVP_AUTH_APPLICATION_ID, true, 0),
        ];

        const cer = buildDiameterMessage(CMD_CAPABILITIES_EXCHANGE, FLAG_REQUEST, 0, hopByHopId, endToEndId, cerAvps);
        await writer.write(cer);
        await readDiameterMessage(reader, timeoutMs);

        // Now send DWR
        const dwrAvps = [
          encodeStringAVP(AVP_ORIGIN_HOST, true, originHost),
          encodeStringAVP(AVP_ORIGIN_REALM, true, originRealm),
          encodeUint32AVP(AVP_ORIGIN_STATE_ID, false, Math.floor(Date.now() / 1000)),
        ];

        const dwrStart = Date.now();
        const dwr = buildDiameterMessage(CMD_DEVICE_WATCHDOG, FLAG_REQUEST, 0, hopByHopId + 1, endToEndId + 1, dwrAvps);
        await writer.write(dwr);

        const dwaBytes = await readDiameterMessage(reader, timeoutMs);
        const rtt = Date.now() - dwrStart;
        const dwa = parseDiameterMessage(dwaBytes);
        const avpInfo = extractAVPInfo(dwa.avps);

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          message: 'Watchdog response received',
          host,
          port,
          rtt,
          commandCode: dwa.commandCode,
          commandName: 'Device-Watchdog-Answer (DWA)',
          peerInfo: avpInfo,
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
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
      error: error instanceof Error ? error.message : 'Request failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Additional AVP codes for ACR and Auth
const AVP_DESTINATION_REALM = 283;
const AVP_SESSION_ID = 263;
const AVP_ACCT_RECORD_TYPE = 480;
const AVP_ACCT_RECORD_NUMBER = 485;
const AVP_USER_NAME = 1;
const AVP_ACCT_APPLICATION_ID = 259;
const AVP_SUPPORTED_VENDOR_ID = 265;

// Accounting record type names
const ACCT_RECORD_TYPE_NAMES: Record<number, string> = {
  1: 'EVENT_RECORD',
  2: 'START_RECORD',
  3: 'INTERIM_RECORD',
  4: 'STOP_RECORD',
};

// Known Diameter application IDs
const DIAMETER_APP_NAMES: Record<number, string> = {
  0: 'Diameter Common Messages',
  1: 'NASREQ (RFC 4005)',
  2: 'Mobile IPv4 (RFC 4004)',
  3: 'Diameter Base Accounting (RFC 6733)',
  4: 'Credit Control (RFC 4006)',
  5: 'EAP (RFC 4072)',
  6: 'SIP (RFC 4740)',
  16777216: 'Cx/Dx 3GPP (TS 29.229)',
  16777217: 'Sh 3GPP (TS 29.329)',
  16777236: 'Rx 3GPP (TS 29.214)',
  16777238: 'Gx 3GPP (TS 29.212)',
};

/**
 * Handle Diameter ACR (Accounting-Request) — sends CER, then ACR, parses ACA.
 */
export async function handleDiameterACR(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      originHost?: string;
      originRealm?: string;
      destinationRealm?: string;
      sessionId?: string;
      acctRecordType?: number;
      username?: string;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 3868;
    const originHost = options.originHost || 'portofcall.ross.gg';
    const originRealm = options.originRealm || 'ross.gg';
    const destinationRealm = options.destinationRealm || originRealm;
    const timeoutMs = options.timeout || 15000;
    const acctRecordType = options.acctRecordType ?? 1; // Default: EVENT_RECORD
    const sessionId = options.sessionId || `${originHost};${Date.now()};1`;

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const hopByHopId = Math.floor(Math.random() * 0xffffffff);
        const endToEndId = Math.floor(Math.random() * 0xffffffff);

        // Step 1: CER
        const cerAvps = [
          encodeStringAVP(AVP_ORIGIN_HOST, true, originHost),
          encodeStringAVP(AVP_ORIGIN_REALM, true, originRealm),
          encodeAddressAVP(AVP_HOST_IP_ADDRESS, true),
          encodeUint32AVP(AVP_VENDOR_ID, true, 0),
          encodeStringAVP(AVP_PRODUCT_NAME, false, 'PortOfCall'),
          encodeUint32AVP(AVP_AUTH_APPLICATION_ID, true, 0),
          encodeUint32AVP(AVP_ACCT_APPLICATION_ID, true, 3), // Base Accounting
        ];
        const cer = buildDiameterMessage(CMD_CAPABILITIES_EXCHANGE, FLAG_REQUEST, 0, hopByHopId, endToEndId, cerAvps);
        await writer.write(cer);
        await readDiameterMessage(reader, timeoutMs);

        // Step 2: ACR (command 271, application-id 3 = base accounting)
        const acrAvps = [
          encodeStringAVP(AVP_SESSION_ID, true, sessionId),
          encodeStringAVP(AVP_ORIGIN_HOST, true, originHost),
          encodeStringAVP(AVP_ORIGIN_REALM, true, originRealm),
          encodeStringAVP(AVP_DESTINATION_REALM, true, destinationRealm),
          encodeUint32AVP(AVP_ACCT_RECORD_TYPE, true, acctRecordType),
          encodeUint32AVP(AVP_ACCT_RECORD_NUMBER, true, 1),
          ...(options.username ? [encodeStringAVP(AVP_USER_NAME, true, options.username)] : []),
        ];

        const acrStart = Date.now();
        const acr = buildDiameterMessage(
          271, // Accounting-Request
          FLAG_REQUEST,
          3,   // Base Accounting application
          hopByHopId + 1,
          endToEndId + 1,
          acrAvps,
        );
        await writer.write(acr);

        // Step 3: Read ACA
        const acaBytes = await readDiameterMessage(reader, timeoutMs);
        const rtt = Date.now() - acrStart;
        const aca = parseDiameterMessage(acaBytes);

        const resultCodeAVP = aca.avps.find(a => a.code === AVP_RESULT_CODE);
        let resultCode = 0;
        if (resultCodeAVP && resultCodeAVP.value.length >= 4) {
          resultCode = new DataView(resultCodeAVP.value.buffer, resultCodeAVP.value.byteOffset).getUint32(0, false);
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          host,
          port,
          rtt,
          resultCode,
          resultCodeName: resultCode === RESULT_SUCCESS ? 'DIAMETER_SUCCESS' :
            resultCode >= 3000 && resultCode < 4000 ? 'PROTOCOL_ERROR' :
            resultCode >= 5000 ? 'PERMANENT_FAILURE' : `Code ${resultCode}`,
          sessionId,
          acctRecordType,
          acctRecordTypeName: ACCT_RECORD_TYPE_NAMES[acctRecordType] || `Unknown (${acctRecordType})`,
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
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
      error: error instanceof Error ? error.message : 'ACR failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Diameter Auth capability probe — sends CER/CEA and reports supported applications.
 * Also sends a generic AAR (Authentication-Authorization-Request, command 265) when the server
 * advertises Auth-Application-IDs, then parses the AAA response.
 */
export async function handleDiameterAuth(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      originHost?: string;
      originRealm?: string;
      destinationRealm?: string;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 3868;
    const originHost = options.originHost || 'portofcall.ross.gg';
    const originRealm = options.originRealm || 'ross.gg';
    const destinationRealm = options.destinationRealm || originRealm;
    const timeoutMs = options.timeout || 15000;

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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const hopByHopId = Math.floor(Math.random() * 0xffffffff);
        const endToEndId = Math.floor(Math.random() * 0xffffffff);

        // Step 1: CER advertising several auth app IDs
        const cerAvps = [
          encodeStringAVP(AVP_ORIGIN_HOST, true, originHost),
          encodeStringAVP(AVP_ORIGIN_REALM, true, originRealm),
          encodeAddressAVP(AVP_HOST_IP_ADDRESS, true),
          encodeUint32AVP(AVP_VENDOR_ID, true, 0),
          encodeStringAVP(AVP_PRODUCT_NAME, false, 'PortOfCall'),
          encodeUint32AVP(AVP_AUTH_APPLICATION_ID, true, 1),   // NASREQ
          encodeUint32AVP(AVP_AUTH_APPLICATION_ID, true, 4),   // Credit Control
          encodeUint32AVP(AVP_AUTH_APPLICATION_ID, true, 5),   // EAP
          encodeUint32AVP(AVP_SUPPORTED_VENDOR_ID, false, 10415), // 3GPP
        ];
        const cer = buildDiameterMessage(CMD_CAPABILITIES_EXCHANGE, FLAG_REQUEST, 0, hopByHopId, endToEndId, cerAvps);
        await writer.write(cer);

        const ceaBytes = await readDiameterMessage(reader, timeoutMs);
        const cea = parseDiameterMessage(ceaBytes);

        // Collect all Auth-Application-Id and Acct-Application-Id AVPs from CEA
        const appIds: number[] = [];
        for (const avp of cea.avps) {
          if (avp.code === AVP_AUTH_APPLICATION_ID || avp.code === AVP_ACCT_APPLICATION_ID) {
            if (avp.value.length >= 4) {
              appIds.push(new DataView(avp.value.buffer, avp.value.byteOffset).getUint32(0, false));
            }
          }
        }

        const supportedApps = [...new Set(appIds)].map(id => {
          const name = DIAMETER_APP_NAMES[id] || `Unknown App (${id})`;
          return `${id}: ${name}`;
        });

        // Step 2: Send AAR (command 265) targeting the first non-zero auth app found,
        // or fall back to NASREQ (app 1). AAR probes auth capability.
        const authAppId = appIds.find(id => id > 0) ?? 1;
        const sessionId = `${originHost};${Date.now()};auth`;

        const aarAvps = [
          encodeStringAVP(AVP_SESSION_ID, true, sessionId),
          encodeStringAVP(AVP_ORIGIN_HOST, true, originHost),
          encodeStringAVP(AVP_ORIGIN_REALM, true, originRealm),
          encodeStringAVP(AVP_DESTINATION_REALM, true, destinationRealm),
          encodeUint32AVP(AVP_AUTH_APPLICATION_ID, true, authAppId),
        ];

        const aarStart = Date.now();
        const aar = buildDiameterMessage(
          265, // AA-Request (AAR)
          FLAG_REQUEST,
          authAppId,
          hopByHopId + 1,
          endToEndId + 1,
          aarAvps,
        );
        await writer.write(aar);

        let resultCode = 0;
        let rtt = 0;
        try {
          const aaaBytes = await readDiameterMessage(reader, timeoutMs);
          rtt = Date.now() - aarStart;
          const aaa = parseDiameterMessage(aaaBytes);
          const rcAVP = aaa.avps.find(a => a.code === AVP_RESULT_CODE);
          if (rcAVP && rcAVP.value.length >= 4) {
            resultCode = new DataView(rcAVP.value.buffer, rcAVP.value.byteOffset).getUint32(0, false);
          }
        } catch {
          // Server may close or not respond to AAR — that's fine, we still have CEA info
          rtt = Date.now() - aarStart;
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          host,
          port,
          rtt,
          resultCode,
          resultCodeName: resultCode === RESULT_SUCCESS ? 'DIAMETER_SUCCESS' :
            resultCode === 0 ? 'NO_RESPONSE' :
            resultCode >= 3000 && resultCode < 4000 ? 'PROTOCOL_ERROR' :
            resultCode >= 5000 ? 'PERMANENT_FAILURE' : `Code ${resultCode}`,
          supportedApps,
          peerInfo: extractAVPInfo(cea.avps),
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
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
      error: error instanceof Error ? error.message : 'Auth probe failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// AVP code for Session-Termination-Request
const AVP_TERMINATION_CAUSE = 295;
const CMD_SESSION_TERMINATION = 275;

/**
 * Send a Diameter Session-Termination-Request (STR, command 275)
 * POST /api/diameter/str
 *
 * Performs CER → CEA → STR → STA (Session-Termination-Answer).
 * Useful for probing whether the peer supports session termination signalling.
 *
 * Request: { host, port?, timeout?, originHost?, originRealm?, sessionId?, terminationCause? }
 *   terminationCause: 1=DIAMETER_LOGOUT (default), 2=SERVICE_NOT_PROVIDED, 4=SESSION_TIMEOUT
 * Response: { success, host, port, rtt, resultCode, resultCodeName, sessionId }
 */
export async function handleDiameterSTR(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; timeout?: number;
      originHost?: string; originRealm?: string;
      sessionId?: string; terminationCause?: number;
    };
    const {
      host, port = 3868, timeout: timeoutMs = 10000,
      originHost = 'portofcall.probe',
      originRealm = 'portofcall.example',
      terminationCause = 1, // DIAMETER_LOGOUT
    } = body;
    if (!host) return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });

    const sessionId = body.sessionId ?? `${originHost};${Date.now()};str`;

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        const hopByHopId = Math.floor(Math.random() * 0xffffffff);
        const endToEndId = Math.floor(Math.random() * 0xffffffff);

        // Step 1: CER (capabilities exchange)
        const cerAvps = [
          encodeStringAVP(AVP_ORIGIN_HOST, true, originHost),
          encodeStringAVP(AVP_ORIGIN_REALM, true, originRealm),
          encodeAddressAVP(AVP_HOST_IP_ADDRESS, true),
          encodeUint32AVP(AVP_VENDOR_ID, true, 0),
          encodeStringAVP(AVP_PRODUCT_NAME, false, 'PortOfCall'),
          encodeUint32AVP(AVP_AUTH_APPLICATION_ID, true, 0),
        ];
        const cer = buildDiameterMessage(CMD_CAPABILITIES_EXCHANGE, FLAG_REQUEST, 0, hopByHopId, endToEndId, cerAvps);
        await writer.write(cer);
        await readDiameterMessage(reader, timeoutMs);

        // Step 2: STR (session-termination-request, command 275)
        const strAvps = [
          encodeStringAVP(AVP_SESSION_ID, true, sessionId),
          encodeStringAVP(AVP_ORIGIN_HOST, true, originHost),
          encodeStringAVP(AVP_ORIGIN_REALM, true, originRealm),
          encodeStringAVP(AVP_DESTINATION_REALM, true, originRealm),
          encodeUint32AVP(AVP_AUTH_APPLICATION_ID, true, 0),
          encodeUint32AVP(AVP_TERMINATION_CAUSE, true, terminationCause),
        ];
        const strStart = Date.now();
        const strMsg = buildDiameterMessage(CMD_SESSION_TERMINATION, FLAG_REQUEST, 0, hopByHopId + 1, endToEndId + 1, strAvps);
        await writer.write(strMsg);

        let resultCode = 0;
        let rtt = 0;
        try {
          const staBytes = await readDiameterMessage(reader, timeoutMs);
          rtt = Date.now() - strStart;
          const sta = parseDiameterMessage(staBytes);
          const rcAVP = sta.avps.find(a => a.code === AVP_RESULT_CODE);
          if (rcAVP && rcAVP.value.length >= 4) {
            resultCode = new DataView(rcAVP.value.buffer, rcAVP.value.byteOffset).getUint32(0, false);
          }
        } catch {
          rtt = Date.now() - strStart;
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const CAUSE_NAMES: Record<number, string> = {
          1: 'DIAMETER_LOGOUT', 2: 'SERVICE_NOT_PROVIDED', 4: 'SESSION_TIMEOUT', 8: 'USER_MOVED',
        };
        return {
          success: true, host, port, rtt, sessionId,
          terminationCause,
          terminationCauseName: CAUSE_NAMES[terminationCause] ?? `Cause(${terminationCause})`,
          resultCode,
          resultCodeName: resultCode === RESULT_SUCCESS ? 'DIAMETER_SUCCESS' :
            resultCode === 0 ? 'NO_RESPONSE' :
            resultCode >= 3000 && resultCode < 4000 ? 'PROTOCOL_ERROR' :
            resultCode >= 5000 ? 'PERMANENT_FAILURE' : `Code(${resultCode})`,
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'STR failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
