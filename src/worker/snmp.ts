/**
 * SNMP Protocol Implementation (RFC 1157, 1905, 3430)
 *
 * Simple Network Management Protocol for monitoring and managing network devices.
 * This implementation supports SNMPv1 and SNMPv2c over TCP (RFC 3430).
 *
 * Protocol Overview:
 * - Port 161 (agent queries)
 * - ASN.1/BER encoding
 * - Community-based authentication (v1/v2c)
 * - Supports GET, GETNEXT, and GETBULK operations
 *
 * Common OIDs:
 * - 1.3.6.1.2.1.1.1.0 (sysDescr)
 * - 1.3.6.1.2.1.1.3.0 (sysUpTime)
 * - 1.3.6.1.2.1.1.5.0 (sysName)
 * - 1.3.6.1.2.1.1.6.0 (sysLocation)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ASN.1 BER Type Tags
const BER_TYPE = {
  INTEGER: 0x02,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OBJECT_IDENTIFIER: 0x06,
  SEQUENCE: 0x30,

  // SNMP-specific
  IPADDRESS: 0x40,
  COUNTER32: 0x41,
  GAUGE32: 0x42,
  TIMETICKS: 0x43,
  OPAQUE: 0x44,
  COUNTER64: 0x46,

  // PDU types
  GET_REQUEST: 0xa0,
  GETNEXT_REQUEST: 0xa1,
  GET_RESPONSE: 0xa2,
  SET_REQUEST: 0xa3,
  GETBULK_REQUEST: 0xa5,
} as const;

// SNMP Versions
const SNMP_VERSION = {
  V1: 0,
  V2C: 1,
} as const;

interface SNMPRequest {
  host: string;
  port?: number;
  community?: string;
  oid: string;
  version?: 1 | 2;
  timeout?: number;
}

interface SNMPWalkRequest {
  host: string;
  port?: number;
  community?: string;
  oid: string;
  version?: 1 | 2;
  maxRepetitions?: number;
  timeout?: number;
}

interface SNMPResult {
  oid: string;
  type: string;
  value: string | number;
}

interface SNMPResponse {
  success: boolean;
  results?: SNMPResult[];
  error?: string;
  errorStatus?: string;
  errorIndex?: number;
}

/**
 * Encode an integer in ASN.1 BER format
 */
function encodeInteger(value: number): Uint8Array {
  const bytes: number[] = [];

  // Handle negative numbers (two's complement)
  let n = value;
  if (n >= 0) {
    do {
      bytes.unshift(n & 0xff);
      n >>= 8;
    } while (n > 0);

    // Add leading zero if high bit is set (to keep it positive)
    if (bytes[0] & 0x80) {
      bytes.unshift(0);
    }
  } else {
    // Negative number handling
    do {
      bytes.unshift(n & 0xff);
      n >>= 8;
    } while (n < -1 || (n === -1 && !(bytes[0] & 0x80)));
  }

  return new Uint8Array([BER_TYPE.INTEGER, bytes.length, ...bytes]);
}

/**
 * Encode a string in ASN.1 BER format
 */
function encodeOctetString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  return new Uint8Array([BER_TYPE.OCTET_STRING, bytes.length, ...bytes]);
}

/**
 * Encode an OID in ASN.1 BER format
 * Example: "1.3.6.1.2.1.1.1.0" -> encoded bytes
 */
function encodeOID(oid: string): Uint8Array {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [];

  // First two components are encoded as: 40 * first + second
  if (parts.length >= 2) {
    bytes.push(40 * parts[0] + parts[1]);
  }

  // Remaining components
  for (let i = 2; i < parts.length; i++) {
    let value = parts[i];

    if (value < 128) {
      bytes.push(value);
    } else {
      // Encode as variable-length quantity
      const encoded: number[] = [];
      encoded.unshift(value & 0x7f);
      value >>= 7;

      while (value > 0) {
        encoded.unshift((value & 0x7f) | 0x80);
        value >>= 7;
      }

      bytes.push(...encoded);
    }
  }

  return new Uint8Array([BER_TYPE.OBJECT_IDENTIFIER, bytes.length, ...bytes]);
}

/**
 * Encode NULL in ASN.1 BER format
 */
function encodeNull(): Uint8Array {
  return new Uint8Array([BER_TYPE.NULL, 0]);
}

/**
 * Encode a sequence in ASN.1 BER format
 */
function encodeSequence(items: Uint8Array[]): Uint8Array {
  const totalLength = items.reduce((sum, item) => sum + item.length, 0);
  const length = encodeLength(totalLength);

  const result = new Uint8Array(1 + length.length + totalLength);
  result[0] = BER_TYPE.SEQUENCE;
  result.set(length, 1);

  let offset = 1 + length.length;
  for (const item of items) {
    result.set(item, offset);
    offset += item.length;
  }

  return result;
}

/**
 * Encode length in ASN.1 BER format
 */
function encodeLength(length: number): Uint8Array {
  if (length < 128) {
    return new Uint8Array([length]);
  } else {
    const bytes: number[] = [];
    let n = length;
    while (n > 0) {
      bytes.unshift(n & 0xff);
      n >>= 8;
    }
    return new Uint8Array([0x80 | bytes.length, ...bytes]);
  }
}

/**
 * Encode a PDU (Protocol Data Unit)
 */
function encodePDU(type: number, requestId: number, varbinds: Uint8Array[]): Uint8Array {
  const pduContent = [
    encodeInteger(requestId),
    encodeInteger(0), // error-status
    encodeInteger(0), // error-index
    encodeSequence(varbinds), // variable bindings
  ];

  const pduSequence = encodeSequence(pduContent);

  // Replace SEQUENCE tag with PDU type tag
  const result = new Uint8Array(pduSequence);
  result[0] = type;

  return result;
}

/**
 * Encode a GETBULK PDU (SNMPv2c only)
 */
function encodeBulkPDU(requestId: number, maxRepetitions: number, varbinds: Uint8Array[]): Uint8Array {
  const pduContent = [
    encodeInteger(requestId),
    encodeInteger(0), // non-repeaters
    encodeInteger(maxRepetitions), // max-repetitions
    encodeSequence(varbinds), // variable bindings
  ];

  const pduSequence = encodeSequence(pduContent);

  // Replace SEQUENCE tag with GETBULK type tag
  const result = new Uint8Array(pduSequence);
  result[0] = BER_TYPE.GETBULK_REQUEST;

  return result;
}

/**
 * Build a complete SNMP GET request message
 */
function buildGetRequest(community: string, oid: string, version: number): Uint8Array {
  const requestId = Math.floor(Math.random() * 0x7fffffff);

  // Build varbind: [OID, NULL]
  const varbind = encodeSequence([
    encodeOID(oid),
    encodeNull(),
  ]);

  const pdu = encodePDU(BER_TYPE.GET_REQUEST, requestId, [varbind]);

  const message = encodeSequence([
    encodeInteger(version === 1 ? SNMP_VERSION.V1 : SNMP_VERSION.V2C),
    encodeOctetString(community),
    pdu,
  ]);

  return message;
}

/**
 * Build a complete SNMP GETNEXT request message
 */
function buildGetNextRequest(community: string, oid: string, version: number): Uint8Array {
  const requestId = Math.floor(Math.random() * 0x7fffffff);

  const varbind = encodeSequence([
    encodeOID(oid),
    encodeNull(),
  ]);

  const pdu = encodePDU(BER_TYPE.GETNEXT_REQUEST, requestId, [varbind]);

  const message = encodeSequence([
    encodeInteger(version === 1 ? SNMP_VERSION.V1 : SNMP_VERSION.V2C),
    encodeOctetString(community),
    pdu,
  ]);

  return message;
}

/**
 * Build a complete SNMP GETBULK request message (SNMPv2c only)
 */
function buildGetBulkRequest(community: string, oid: string, maxRepetitions: number): Uint8Array {
  const requestId = Math.floor(Math.random() * 0x7fffffff);

  const varbind = encodeSequence([
    encodeOID(oid),
    encodeNull(),
  ]);

  const pdu = encodeBulkPDU(requestId, maxRepetitions, [varbind]);

  const message = encodeSequence([
    encodeInteger(SNMP_VERSION.V2C),
    encodeOctetString(community),
    pdu,
  ]);

  return message;
}

/**
 * Parse ASN.1 BER encoded data
 */
function parseBER(data: Uint8Array, offset = 0): { type: number; length: number; value: Uint8Array; nextOffset: number } {
  const type = data[offset];
  let lengthOffset = offset + 1;
  let length = data[lengthOffset];

  if (length & 0x80) {
    // Long form length
    const numLengthBytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < numLengthBytes; i++) {
      length = (length << 8) | data[lengthOffset + 1 + i];
    }
    lengthOffset += numLengthBytes;
  }

  const valueOffset = lengthOffset + 1;
  const value = data.slice(valueOffset, valueOffset + length);

  return {
    type,
    length,
    value,
    nextOffset: valueOffset + length,
  };
}

/**
 * Parse an integer from BER
 */
function parseInteger(data: Uint8Array): number {
  let value = 0;
  const isNegative = data[0] & 0x80;

  for (let i = 0; i < data.length; i++) {
    value = (value << 8) | data[i];
  }

  // Handle negative numbers
  if (isNegative) {
    value -= Math.pow(2, data.length * 8);
  }

  return value;
}

/**
 * Parse an OID from BER
 */
function parseOID(data: Uint8Array): string {
  const parts: number[] = [];

  // First byte encodes first two components
  if (data.length > 0) {
    const first = Math.floor(data[0] / 40);
    const second = data[0] % 40;
    parts.push(first, second);
  }

  // Parse remaining components
  let i = 1;
  while (i < data.length) {
    let value = 0;

    while (i < data.length && (data[i] & 0x80)) {
      value = (value << 7) | (data[i] & 0x7f);
      i++;
    }

    if (i < data.length) {
      value = (value << 7) | data[i];
      i++;
    }

    parts.push(value);
  }

  return parts.join('.');
}

/**
 * Parse SNMP response message
 */
function parseResponse(data: Uint8Array): SNMPResponse {
  try {
    // Parse outer SEQUENCE
    const message = parseBER(data);
    if (message.type !== BER_TYPE.SEQUENCE) {
      throw new Error('Invalid SNMP message: not a SEQUENCE');
    }

    let offset = 0;

    // Parse version
    const version = parseBER(message.value, offset);
    offset = version.nextOffset;

    // Parse community
    const community = parseBER(message.value, offset);
    offset = community.nextOffset;

    // Parse PDU
    const pdu = parseBER(message.value, offset);

    let pduOffset = 0;

    // Parse request-id
    const requestId = parseBER(pdu.value, pduOffset);
    pduOffset = requestId.nextOffset;

    // Parse error-status
    const errorStatus = parseBER(pdu.value, pduOffset);
    const errorStatusValue = parseInteger(errorStatus.value);
    pduOffset = errorStatus.nextOffset;

    // Parse error-index
    const errorIndex = parseBER(pdu.value, pduOffset);
    const errorIndexValue = parseInteger(errorIndex.value);
    pduOffset = errorIndex.nextOffset;

    // Check for errors
    if (errorStatusValue !== 0) {
      const errorMessages = [
        'noError',
        'tooBig',
        'noSuchName',
        'badValue',
        'readOnly',
        'genErr',
      ];

      return {
        success: false,
        errorStatus: errorMessages[errorStatusValue] || `Error ${errorStatusValue}`,
        errorIndex: errorIndexValue,
      };
    }

    // Parse variable bindings
    const varbinds = parseBER(pdu.value, pduOffset);

    const results: SNMPResult[] = [];
    let vbOffset = 0;

    while (vbOffset < varbinds.value.length) {
      const varbind = parseBER(varbinds.value, vbOffset);

      // Parse OID
      const oidData = parseBER(varbind.value, 0);
      const oid = parseOID(oidData.value);

      // Parse value
      const valueData = parseBER(varbind.value, oidData.nextOffset);
      let value: string | number;
      let type: string;

      switch (valueData.type) {
        case BER_TYPE.INTEGER:
          value = parseInteger(valueData.value);
          type = 'INTEGER';
          break;
        case BER_TYPE.OCTET_STRING:
          value = new TextDecoder().decode(valueData.value);
          type = 'STRING';
          break;
        case BER_TYPE.OBJECT_IDENTIFIER:
          value = parseOID(valueData.value);
          type = 'OID';
          break;
        case BER_TYPE.IPADDRESS:
          value = Array.from(valueData.value).join('.');
          type = 'IPADDRESS';
          break;
        case BER_TYPE.COUNTER32:
          value = parseInteger(valueData.value);
          type = 'COUNTER32';
          break;
        case BER_TYPE.GAUGE32:
          value = parseInteger(valueData.value);
          type = 'GAUGE32';
          break;
        case BER_TYPE.TIMETICKS:
          value = parseInteger(valueData.value);
          type = 'TIMETICKS';
          break;
        case BER_TYPE.NULL:
          value = 'null';
          type = 'NULL';
          break;
        default:
          value = `Unknown type 0x${valueData.type.toString(16)}`;
          type = 'UNKNOWN';
      }

      results.push({ oid, type, value });

      vbOffset = varbind.nextOffset;
    }

    return {
      success: true,
      results,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Parse error',
    };
  }
}

/**
 * Handle SNMP GET request
 */
export async function handleSNMPGet(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SNMPRequest;
    const {
      host,
      port = 161,
      community = 'public',
      oid,
      version = 2,
      timeout = 10000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!oid) {
      return new Response(JSON.stringify({
        success: false,
        error: 'OID is required',
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

    // Build SNMP GET request
    const requestData = buildGetRequest(community, oid, version);

    // Connect to SNMP agent
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send request
      await writer.write(requestData);

      // Read response
      const { value: responseData } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (!responseData) {
        throw new Error('No response from SNMP agent');
      }

      // Parse response
      const response = parseResponse(responseData);

      // Cleanup
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify(response), {
        status: response.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      socket.close();
      throw error;
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
 * Handle SNMP WALK request (retrieves multiple OIDs under a subtree)
 */
export async function handleSNMPWalk(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SNMPWalkRequest;
    const {
      host,
      port = 161,
      community = 'public',
      oid,
      version = 2,
      maxRepetitions = 10,
      timeout = 30000,
    } = body;

    // Validation
    if (!host || !oid) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host and OID are required',
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

    const allResults: SNMPResult[] = [];
    let currentOid = oid;
    const startTime = Date.now();

    // Connect once for the entire walk
    const socket = connect(`${host}:${port}`);

    try {
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Use GETBULK for SNMPv2c, GETNEXT for SNMPv1
      const useBulk = version === 2;

      while (Date.now() - startTime < timeout) {
        // Build request
        const requestData = useBulk
          ? buildGetBulkRequest(community, currentOid, maxRepetitions)
          : buildGetNextRequest(community, currentOid, version);

        // Send request
        await writer.write(requestData);

        // Read response
        const { value: responseData } = await reader.read();

        if (!responseData) {
          break;
        }

        // Parse response
        const response = parseResponse(responseData);

        if (!response.success || !response.results || response.results.length === 0) {
          break;
        }

        // Check if we've moved beyond the requested OID subtree
        let endOfMib = false;
        for (const result of response.results) {
          if (!result.oid.startsWith(oid)) {
            endOfMib = true;
            break;
          }
          allResults.push(result);
          currentOid = result.oid;
        }

        if (endOfMib) {
          break;
        }

        // For v1, only one result per request
        if (!useBulk) {
          if (response.results.length > 0) {
            currentOid = response.results[0].oid;
          } else {
            break;
          }
        }
      }

      // Cleanup
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        results: allResults,
        count: allResults.length,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      socket.close();
      throw error;
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
