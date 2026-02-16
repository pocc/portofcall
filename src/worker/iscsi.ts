/**
 * iSCSI Protocol Implementation (RFC 7143)
 *
 * Internet Small Computer System Interface — block-level storage over IP.
 * Port 3260 (TCP).
 *
 * Endpoints implemented:
 * - Login + SendTargets Discovery — Discover available iSCSI targets
 *
 * The iSCSI Login phase uses binary PDUs with a 48-byte Basic Header Segment (BHS):
 *   Byte 0:    Opcode (0x03 = Login Request, 0x23 = Login Response)
 *   Byte 1:    Flags (T=Transit, C=Continue, CSG/NSG stage indicators)
 *   Bytes 4-7: TotalAHSLength (1 byte) + DataSegmentLength (3 bytes)
 *   Bytes 8-15: ISID (6 bytes) + TSIH (2 bytes)
 *   Bytes 16-19: Initiator Task Tag
 *   Bytes 20-23: CID (2 bytes) + reserved
 *   Bytes 24-27: CmdSN
 *   Bytes 28-31: ExpStatSN
 *   Bytes 32-47: Reserved
 *   Data Segment: Key=Value text pairs (null-terminated)
 *
 * Use Cases:
 * - iSCSI target discovery and enumeration
 * - Storage infrastructure health checking
 * - SAN connectivity verification
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface ISCSIRequest {
  host: string;
  port?: number;
  timeout?: number;
  initiatorName?: string;
}

/**
 * Build an iSCSI Login Request PDU for SendTargets discovery
 */
function buildLoginRequest(initiatorName: string, cmdSN: number): Uint8Array {
  // Key-value pairs for discovery session
  const kvPairs = [
    `InitiatorName=${initiatorName}`,
    'SessionType=Discovery',
    'AuthMethod=None',
    'HeaderDigest=None',
    'DataDigest=None',
    'MaxRecvDataSegmentLength=65536',
    'DefaultTime2Wait=2',
    'DefaultTime2Retain=0',
  ];

  // Null-terminate each key-value pair and join
  const dataText = kvPairs.map(kv => kv + '\0').join('');
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(dataText);

  // Pad data to 4-byte boundary
  const paddedLen = Math.ceil(dataBytes.length / 4) * 4;
  const paddedData = new Uint8Array(paddedLen);
  paddedData.set(dataBytes);

  // Build 48-byte BHS (Basic Header Segment)
  const bhs = new Uint8Array(48);

  // Byte 0: Opcode 0x03 (Login Request), Immediate bit set
  bhs[0] = 0x43; // 0x40 (Immediate) | 0x03 (Login Request)

  // Byte 1: Flags — T=1 (Transit), CSG=00 (SecurityNegotiation), NSG=01 (LoginOperationalNegotiation)
  // Actually for discovery with AuthMethod=None, go straight: T=1, CSG=01 (LoginOp), NSG=11 (FullFeature)
  bhs[1] = 0x87; // T=1 (0x80) | CSG=01 (0x04) | NSG=11 (0x03) = 0x87

  // Byte 2-3: Version max/min
  bhs[2] = 0x00; // Version-max: 0
  bhs[3] = 0x00; // Version-min: 0

  // Byte 4: TotalAHSLength = 0
  bhs[4] = 0x00;

  // Bytes 5-7: DataSegmentLength (3 bytes, big-endian)
  bhs[5] = (dataBytes.length >> 16) & 0xff;
  bhs[6] = (dataBytes.length >> 8) & 0xff;
  bhs[7] = dataBytes.length & 0xff;

  // Bytes 8-13: ISID (Initiator Session ID) - 6 bytes
  // Use type 0x00 (OUI), qualifier 0x023d (IANA enterprise number for "example")
  bhs[8] = 0x00;  // Type + A
  bhs[9] = 0x02;  // B
  bhs[10] = 0x3d; // C
  bhs[11] = 0x00; // D (2 bytes)
  bhs[12] = 0x00;
  bhs[13] = 0x01; // Qualifier

  // Bytes 14-15: TSIH = 0x0000 (new session)
  bhs[14] = 0x00;
  bhs[15] = 0x00;

  // Bytes 16-19: Initiator Task Tag
  bhs[16] = 0x00;
  bhs[17] = 0x00;
  bhs[18] = 0x00;
  bhs[19] = 0x01;

  // Bytes 20-21: CID = 0
  bhs[20] = 0x00;
  bhs[21] = 0x00;

  // Bytes 24-27: CmdSN
  bhs[24] = (cmdSN >> 24) & 0xff;
  bhs[25] = (cmdSN >> 16) & 0xff;
  bhs[26] = (cmdSN >> 8) & 0xff;
  bhs[27] = cmdSN & 0xff;

  // Bytes 28-31: ExpStatSN = 0
  bhs[28] = 0x00;
  bhs[29] = 0x00;
  bhs[30] = 0x00;
  bhs[31] = 0x00;

  // Combine BHS + padded data
  const pdu = new Uint8Array(48 + paddedLen);
  pdu.set(bhs);
  pdu.set(paddedData, 48);

  return pdu;
}

/**
 * Build a SendTargets Text Request PDU
 */
function buildTextRequest(cmdSN: number, expStatSN: number): Uint8Array {
  const dataText = 'SendTargets=All\0';
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(dataText);

  const paddedLen = Math.ceil(dataBytes.length / 4) * 4;
  const paddedData = new Uint8Array(paddedLen);
  paddedData.set(dataBytes);

  const bhs = new Uint8Array(48);

  // Byte 0: Opcode 0x04 (Text Request), Immediate
  bhs[0] = 0x44; // 0x40 | 0x04

  // Byte 1: F=1 (Final)
  bhs[1] = 0x80;

  // Bytes 5-7: DataSegmentLength
  bhs[5] = (dataBytes.length >> 16) & 0xff;
  bhs[6] = (dataBytes.length >> 8) & 0xff;
  bhs[7] = dataBytes.length & 0xff;

  // Bytes 16-19: Initiator Task Tag
  bhs[16] = 0x00;
  bhs[17] = 0x00;
  bhs[18] = 0x00;
  bhs[19] = 0x02;

  // Bytes 20-23: Target Transfer Tag = 0xFFFFFFFF
  bhs[20] = 0xff;
  bhs[21] = 0xff;
  bhs[22] = 0xff;
  bhs[23] = 0xff;

  // Bytes 24-27: CmdSN
  bhs[24] = (cmdSN >> 24) & 0xff;
  bhs[25] = (cmdSN >> 16) & 0xff;
  bhs[26] = (cmdSN >> 8) & 0xff;
  bhs[27] = cmdSN & 0xff;

  // Bytes 28-31: ExpStatSN
  bhs[28] = (expStatSN >> 24) & 0xff;
  bhs[29] = (expStatSN >> 16) & 0xff;
  bhs[30] = (expStatSN >> 8) & 0xff;
  bhs[31] = expStatSN & 0xff;

  const pdu = new Uint8Array(48 + paddedLen);
  pdu.set(bhs);
  pdu.set(paddedData, 48);

  return pdu;
}

/**
 * Parse an iSCSI Login Response PDU
 */
function parseLoginResponse(data: Uint8Array): {
  opcode: number;
  statusClass: number;
  statusDetail: number;
  isTransit: boolean;
  csg: number;
  nsg: number;
  versionMax: number;
  versionActive: number;
  tsih: number;
  statSN: number;
  dataLength: number;
  kvPairs: Record<string, string>;
} {
  const opcode = data[0] & 0x3f;
  const flags = data[1];
  const isTransit = !!(flags & 0x80);
  const csg = (flags >> 2) & 0x03;
  const nsg = flags & 0x03;

  const versionMax = data[2];
  const versionActive = data[3];

  const dataLength = ((data[5] << 16) | (data[6] << 8) | data[7]);

  const tsih = (data[14] << 8) | data[15];
  const statSN = (data[24] << 24) | (data[25] << 16) | (data[26] << 8) | data[27];

  const statusClass = data[36];
  const statusDetail = data[37];

  // Parse key-value data
  const kvPairs: Record<string, string> = {};
  if (dataLength > 0 && data.length >= 48 + dataLength) {
    const decoder = new TextDecoder();
    const dataText = decoder.decode(data.slice(48, 48 + dataLength));
    const pairs = dataText.split('\0').filter(s => s.length > 0);
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        kvPairs[pair.substring(0, eqIdx)] = pair.substring(eqIdx + 1);
      }
    }
  }

  return { opcode, statusClass, statusDetail, isTransit, csg, nsg, versionMax, versionActive, tsih, statSN, dataLength, kvPairs };
}

/**
 * Parse a Text Response PDU for SendTargets
 */
function parseTextResponse(data: Uint8Array): {
  opcode: number;
  isFinal: boolean;
  dataLength: number;
  targets: Array<{ name: string; addresses: string[] }>;
  kvPairs: Record<string, string>;
} {
  const opcode = data[0] & 0x3f;
  const isFinal = !!(data[1] & 0x80);
  const dataLength = ((data[5] << 16) | (data[6] << 8) | data[7]);

  const kvPairs: Record<string, string> = {};
  const targets: Array<{ name: string; addresses: string[] }> = [];

  if (dataLength > 0 && data.length >= 48 + dataLength) {
    const decoder = new TextDecoder();
    const dataText = decoder.decode(data.slice(48, 48 + dataLength));
    const pairs = dataText.split('\0').filter(s => s.length > 0);

    let currentTarget: { name: string; addresses: string[] } | null = null;
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.substring(0, eqIdx);
        const value = pair.substring(eqIdx + 1);
        kvPairs[key] = value;

        if (key === 'TargetName') {
          currentTarget = { name: value, addresses: [] };
          targets.push(currentTarget);
        } else if (key === 'TargetAddress' && currentTarget) {
          currentTarget.addresses.push(value);
        }
      }
    }
  }

  return { opcode, isFinal, dataLength, targets, kvPairs };
}

/**
 * Get iSCSI status class description
 */
function getStatusDescription(statusClass: number, statusDetail: number): string {
  const classes: Record<number, string> = {
    0x00: 'Success',
    0x01: 'Redirection',
    0x02: 'Initiator Error',
    0x03: 'Target Error',
  };

  const details: Record<string, string> = {
    '0:0': 'Login successful',
    '1:1': 'Target moved temporarily',
    '1:2': 'Target moved permanently',
    '2:0': 'Initiator error (miscellaneous)',
    '2:1': 'Authentication failure',
    '2:2': 'Authorization failure',
    '2:3': 'Target not found',
    '2:4': 'Target removed',
    '2:5': 'Unsupported version',
    '2:6': 'Too many connections',
    '2:7': 'Missing parameter',
    '2:8': 'Cannot include in session',
    '2:9': 'Session type not supported',
    '2:10': 'Session does not exist',
    '2:11': 'Invalid during login',
    '3:0': 'Target error (miscellaneous)',
    '3:1': 'Service unavailable',
    '3:2': 'Out of resources',
  };

  const classDesc = classes[statusClass] || `Unknown (0x${statusClass.toString(16)})`;
  const detailDesc = details[`${statusClass}:${statusDetail}`] || '';

  return detailDesc ? `${classDesc} — ${detailDesc}` : classDesc;
}

/**
 * Handle iSCSI Discovery — Login + SendTargets
 */
export async function handleISCSIDiscover(request: Request): Promise<Response> {
  try {
    const body = await request.json() as ISCSIRequest;
    const { host, port = 3260, timeout = 10000 } = body;
    const initiatorName = body.initiatorName || 'iqn.2024-01.gg.ross.portofcall:initiator';

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if behind Cloudflare
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const discoveryPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Step 1: Send Login Request (discovery session)
        const loginReq = buildLoginRequest(initiatorName, 1);
        await writer.write(loginReq);

        // Read Login Response
        let responseData = new Uint8Array(0);
        while (responseData.length < 48) {
          const { value, done } = await reader.read();
          if (done) break;
          const newData = new Uint8Array(responseData.length + value.length);
          newData.set(responseData);
          newData.set(value, responseData.length);
          responseData = newData;
        }

        if (responseData.length < 48) {
          const rtt = Date.now() - startTime;
          await socket.close();
          return {
            success: false,
            host,
            port,
            rtt,
            error: `Incomplete login response: received ${responseData.length} of 48+ bytes`,
            isISCSI: false,
          };
        }

        // Check opcode
        const loginOpcode = responseData[0] & 0x3f;
        if (loginOpcode !== 0x23) {
          const rtt = Date.now() - startTime;
          await socket.close();
          return {
            success: false,
            host,
            port,
            rtt,
            error: `Not an iSCSI target: unexpected opcode 0x${loginOpcode.toString(16)}`,
            isISCSI: false,
          };
        }

        // Read full login response (BHS + data)
        const loginDataLen = ((responseData[5] << 16) | (responseData[6] << 8) | responseData[7]);
        const paddedLoginDataLen = Math.ceil(loginDataLen / 4) * 4;
        const totalLoginLen = 48 + paddedLoginDataLen;

        while (responseData.length < totalLoginLen) {
          const { value, done } = await reader.read();
          if (done) break;
          const newData = new Uint8Array(responseData.length + value.length);
          newData.set(responseData);
          newData.set(value, responseData.length);
          responseData = newData;
        }

        const loginResp = parseLoginResponse(responseData);
        const loginStatus = getStatusDescription(loginResp.statusClass, loginResp.statusDetail);

        if (loginResp.statusClass !== 0) {
          const rtt = Date.now() - startTime;
          await socket.close();
          return {
            success: false,
            host,
            port,
            rtt,
            isISCSI: true,
            loginStatus,
            loginStatusClass: loginResp.statusClass,
            loginStatusDetail: loginResp.statusDetail,
            negotiatedParams: loginResp.kvPairs,
            error: `Login failed: ${loginStatus}`,
          };
        }

        // Step 2: Send Text Request (SendTargets=All)
        const textReq = buildTextRequest(2, loginResp.statSN + 1);
        await writer.write(textReq);

        // Read Text Response
        let textData = new Uint8Array(0);
        while (textData.length < 48) {
          const { value, done } = await reader.read();
          if (done) break;
          const newData = new Uint8Array(textData.length + value.length);
          newData.set(textData);
          newData.set(value, textData.length);
          textData = newData;
        }

        const rtt = Date.now() - startTime;

        let targets: Array<{ name: string; addresses: string[] }> = [];
        let textKvPairs: Record<string, string> = {};

        if (textData.length >= 48) {
          const textOpcode = textData[0] & 0x3f;
          if (textOpcode === 0x24) {
            // Read full text response
            const textDataLen = ((textData[5] << 16) | (textData[6] << 8) | textData[7]);
            const paddedTextDataLen = Math.ceil(textDataLen / 4) * 4;
            const totalTextLen = 48 + paddedTextDataLen;

            while (textData.length < totalTextLen) {
              const { value, done } = await reader.read();
              if (done) break;
              const newData = new Uint8Array(textData.length + value.length);
              newData.set(textData);
              newData.set(value, textData.length);
              textData = newData;
            }

            const textResp = parseTextResponse(textData);
            targets = textResp.targets;
            textKvPairs = textResp.kvPairs;
          }
        }

        await socket.close();

        return {
          success: true,
          host,
          port,
          rtt,
          isISCSI: true,
          loginStatus,
          versionMax: loginResp.versionMax,
          versionActive: loginResp.versionActive,
          tsih: loginResp.tsih,
          negotiatedParams: loginResp.kvPairs,
          targets: targets.map(t => ({
            name: t.name,
            addresses: t.addresses,
          })),
          targetCount: targets.length,
          rawKvPairs: textKvPairs,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([discoveryPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Connection timeout') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Connection timeout',
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
