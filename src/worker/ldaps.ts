/**
 * LDAPS Protocol Support for Cloudflare Workers
 * LDAP over TLS (RFC 4511 / RFC 8314) — port 636
 *
 * Identical to LDAP but the entire connection is wrapped in TLS
 * using Cloudflare Workers' secureTransport: 'on' option.
 *
 * Protocol: ASN.1/BER encoded LDAP messages over TLS
 *
 * Operations supported:
 *   - Connect + Bind (anonymous or authenticated) over TLS
 *   - Search (base DN enumeration) over TLS
 *
 * Use Cases:
 *   - Test secure LDAP directory connectivity
 *   - Verify TLS certificate and LDAP bind
 *   - Active Directory / OpenLDAP secure access testing
 *   - Enterprise directory infrastructure monitoring
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface LDAPSConnectionOptions {
  host: string;
  port?: number;
  bindDN?: string;
  password?: string;
  timeout?: number;
}

interface LDAPSSearchOptions extends LDAPSConnectionOptions {
  baseDN: string;
  filter?: string;
}

/**
 * Encode length in ASN.1/BER format
 */
function encodeLength(length: number): number[] {
  if (length < 128) {
    return [length];
  }
  const bytes: number[] = [];
  let len = length;
  while (len > 0) {
    bytes.unshift(len & 0xFF);
    len >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/**
 * Encode an OCTET STRING in ASN.1/BER
 */
function encodeOctetString(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  return [0x04, ...encodeLength(bytes.length), ...bytes];
}

/**
 * Encode LDAP BIND request using ASN.1/BER
 */
function encodeLDAPBindRequest(messageId: number, bindDN: string, password: string): Uint8Array {
  // Message ID (INTEGER)
  const msgIdBytes = encodeInteger(messageId);

  // BIND request (application tag 0x60)
  // Version 3 (INTEGER)
  const version = encodeInteger(3);
  // Bind DN (OCTET STRING)
  const dn = encodeOctetString(bindDN);
  // Simple authentication (context tag [0])
  const pwBytes = new TextEncoder().encode(password);
  const auth = [0x80, ...encodeLength(pwBytes.length), ...pwBytes];

  const bindBody = [...version, ...dn, ...auth];
  const bindRequest = [0x60, ...encodeLength(bindBody.length), ...bindBody];

  // LDAP Message (SEQUENCE)
  const message = [...msgIdBytes, ...bindRequest];
  return new Uint8Array([0x30, ...encodeLength(message.length), ...message]);
}

/**
 * Encode LDAP UNBIND request
 */
function encodeLDAPUnbindRequest(messageId: number): Uint8Array {
  const msgIdBytes = encodeInteger(messageId);
  // Unbind is application tag [2] with no content
  const unbindRequest = [0x42, 0x00];
  const message = [...msgIdBytes, ...unbindRequest];
  return new Uint8Array([0x30, ...encodeLength(message.length), ...message]);
}

/**
 * Encode LDAP Search request
 */
function encodeLDAPSearchRequest(
  messageId: number,
  baseDN: string,
  filter: string
): Uint8Array {
  const msgIdBytes = encodeInteger(messageId);

  // Search request (application tag 0x63)
  const base = encodeOctetString(baseDN);
  const scope = encodeEnumerated(0); // baseObject
  const derefAliases = encodeEnumerated(0); // neverDerefAliases
  const sizeLimit = encodeInteger(10); // max 10 entries
  const timeLimit = encodeInteger(10); // 10 second timeout
  const typesOnly = [0x01, 0x01, 0x00]; // BOOLEAN false

  // Parse simple filter - support (objectClass=*) pattern
  let filterEncoded: number[];
  if (filter === '(objectClass=*)') {
    // Present filter for objectClass
    const attrBytes = new TextEncoder().encode('objectClass');
    filterEncoded = [0x87, ...encodeLength(attrBytes.length), ...attrBytes];
  } else {
    // Equality match filter: (attr=value)
    const match = filter.match(/^\(([^=]+)=([^)]*)\)$/);
    if (match) {
      const attr = encodeOctetString(match[1]);
      const val = encodeOctetString(match[2]);
      const eqBody = [...attr, ...val];
      filterEncoded = [0xA3, ...encodeLength(eqBody.length), ...eqBody];
    } else {
      // Default: present filter for objectClass
      const attrBytes = new TextEncoder().encode('objectClass');
      filterEncoded = [0x87, ...encodeLength(attrBytes.length), ...attrBytes];
    }
  }

  // Attributes to return (empty SEQUENCE = all attributes)
  const attributes = [0x30, 0x00];

  const searchBody = [
    ...base,
    ...scope,
    ...derefAliases,
    ...sizeLimit,
    ...timeLimit,
    ...typesOnly,
    ...filterEncoded,
    ...attributes,
  ];
  const searchRequest = [0x63, ...encodeLength(searchBody.length), ...searchBody];

  const message = [...msgIdBytes, ...searchRequest];
  return new Uint8Array([0x30, ...encodeLength(message.length), ...message]);
}

/**
 * Encode INTEGER in ASN.1/BER
 */
function encodeInteger(value: number): number[] {
  if (value < 128) {
    return [0x02, 0x01, value];
  }
  const bytes: number[] = [];
  let v = value;
  while (v > 0) {
    bytes.unshift(v & 0xFF);
    v >>= 8;
  }
  // Add leading zero if high bit set
  if (bytes[0] & 0x80) {
    bytes.unshift(0x00);
  }
  return [0x02, bytes.length, ...bytes];
}

/**
 * Encode ENUMERATED in ASN.1/BER
 */
function encodeEnumerated(value: number): number[] {
  return [0x0A, 0x01, value];
}

/**
 * Parse ASN.1 length from BER data
 */
function parseLength(data: Uint8Array, offset: number): { length: number; bytesRead: number } {
  if (data[offset] < 128) {
    return { length: data[offset], bytesRead: 1 };
  }
  const numBytes = data[offset] & 0x7F;
  let length = 0;
  for (let i = 0; i < numBytes; i++) {
    length = (length << 8) | data[offset + 1 + i];
  }
  return { length, bytesRead: 1 + numBytes };
}

/**
 * Parse LDAP BIND response
 */
function parseLDAPBindResponse(data: Uint8Array): {
  success: boolean;
  resultCode: number;
  message: string;
  matchedDN?: string;
} {
  if (data.length < 7) {
    return { success: false, resultCode: -1, message: 'Invalid LDAP response (too short)' };
  }

  let offset = 0;

  // SEQUENCE tag
  if (data[offset] !== 0x30) {
    return { success: false, resultCode: -1, message: 'Expected SEQUENCE tag' };
  }
  offset++;
  const seqLen = parseLength(data, offset);
  offset += seqLen.bytesRead;

  // Message ID (INTEGER)
  if (data[offset] === 0x02) {
    offset++;
    const idLen = parseLength(data, offset);
    offset += idLen.bytesRead + idLen.length;
  }

  // BIND response tag (0x61)
  if (data[offset] !== 0x61) {
    return { success: false, resultCode: -1, message: `Expected BIND response tag (0x61), got 0x${data[offset].toString(16)}` };
  }
  offset++;
  const bindLen = parseLength(data, offset);
  offset += bindLen.bytesRead;

  // Result code (ENUMERATED)
  if (data[offset] === 0x0A) {
    offset++;
    const rcLen = parseLength(data, offset);
    offset += rcLen.bytesRead;
    const resultCode = data[offset];
    offset += rcLen.length;

    // Matched DN (OCTET STRING)
    let matchedDN = '';
    if (offset < data.length && data[offset] === 0x04) {
      offset++;
      const dnLen = parseLength(data, offset);
      offset += dnLen.bytesRead;
      if (dnLen.length > 0) {
        matchedDN = new TextDecoder().decode(data.slice(offset, offset + dnLen.length));
      }
      offset += dnLen.length;
    }

    // Diagnostic message (OCTET STRING)
    let diagMessage = '';
    if (offset < data.length && data[offset] === 0x04) {
      offset++;
      const msgLen = parseLength(data, offset);
      offset += msgLen.bytesRead;
      if (msgLen.length > 0) {
        diagMessage = new TextDecoder().decode(data.slice(offset, offset + msgLen.length));
      }
    }

    const messages: Record<number, string> = {
      0: 'Success',
      1: 'Operations error',
      2: 'Protocol error',
      3: 'Time limit exceeded',
      4: 'Size limit exceeded',
      7: 'Auth method not supported',
      8: 'Stronger auth required',
      32: 'No such object',
      34: 'Invalid DN syntax',
      48: 'Inappropriate authentication',
      49: 'Invalid credentials',
      50: 'Insufficient access rights',
      53: 'Unwilling to perform',
    };

    const msg = diagMessage || messages[resultCode] || `LDAP result code: ${resultCode}`;

    return {
      success: resultCode === 0,
      resultCode,
      message: msg,
      matchedDN: matchedDN || undefined,
    };
  }

  return { success: false, resultCode: -1, message: 'Could not parse result code' };
}

/**
 * Parse LDAP Search result entries
 */
function parseLDAPSearchResults(data: Uint8Array): {
  entries: Array<{ dn: string; attributes: Record<string, string[]> }>;
  resultCode: number;
  message: string;
} {
  const entries: Array<{ dn: string; attributes: Record<string, string[]> }> = [];
  let resultCode = -1;
  let message = '';
  let offset = 0;

  while (offset < data.length) {
    // Each LDAP message is a SEQUENCE
    if (data[offset] !== 0x30) break;
    offset++;
    const seqLen = parseLength(data, offset);
    offset += seqLen.bytesRead;
    const messageEnd = offset + seqLen.length;

    // Message ID
    if (data[offset] === 0x02) {
      offset++;
      const idLen = parseLength(data, offset);
      offset += idLen.bytesRead + idLen.length;
    }

    const tag = data[offset];

    if (tag === 0x64) {
      // SearchResultEntry (application tag 4)
      offset++;
      const entryLen = parseLength(data, offset);
      offset += entryLen.bytesRead;

      // DN (OCTET STRING)
      let dn = '';
      if (data[offset] === 0x04) {
        offset++;
        const dnLen = parseLength(data, offset);
        offset += dnLen.bytesRead;
        if (dnLen.length > 0) {
          dn = new TextDecoder().decode(data.slice(offset, offset + dnLen.length));
        }
        offset += dnLen.length;
      }

      // Attributes (SEQUENCE of SEQUENCE)
      const attributes: Record<string, string[]> = {};
      if (data[offset] === 0x30) {
        offset++;
        const attrsLen = parseLength(data, offset);
        offset += attrsLen.bytesRead;
        const attrsEnd = offset + attrsLen.length;

        while (offset < attrsEnd) {
          if (data[offset] !== 0x30) break;
          offset++;
          const attrLen = parseLength(data, offset);
          offset += attrLen.bytesRead;

          // Attribute type (OCTET STRING)
          let attrType = '';
          if (data[offset] === 0x04) {
            offset++;
            const typeLen = parseLength(data, offset);
            offset += typeLen.bytesRead;
            if (typeLen.length > 0) {
              attrType = new TextDecoder().decode(data.slice(offset, offset + typeLen.length));
            }
            offset += typeLen.length;
          }

          // Attribute values (SET of OCTET STRING)
          const values: string[] = [];
          if (data[offset] === 0x31) {
            offset++;
            const setLen = parseLength(data, offset);
            offset += setLen.bytesRead;
            const setEnd = offset + setLen.length;

            while (offset < setEnd) {
              if (data[offset] === 0x04) {
                offset++;
                const valLen = parseLength(data, offset);
                offset += valLen.bytesRead;
                if (valLen.length > 0) {
                  values.push(new TextDecoder().decode(data.slice(offset, offset + valLen.length)));
                }
                offset += valLen.length;
              } else {
                break;
              }
            }
          }

          if (attrType) {
            attributes[attrType] = values;
          }
        }
      }

      entries.push({ dn, attributes });
      offset = messageEnd;
    } else if (tag === 0x65) {
      // SearchResultDone (application tag 5)
      offset++;
      const doneLen = parseLength(data, offset);
      offset += doneLen.bytesRead;

      // Result code
      if (data[offset] === 0x0A) {
        offset++;
        const rcLen = parseLength(data, offset);
        offset += rcLen.bytesRead;
        resultCode = data[offset];
        offset += rcLen.length;
      }

      // Skip matched DN
      if (offset < data.length && data[offset] === 0x04) {
        offset++;
        const dnLen = parseLength(data, offset);
        offset += dnLen.bytesRead + dnLen.length;
      }

      // Diagnostic message
      if (offset < data.length && data[offset] === 0x04) {
        offset++;
        const msgLen = parseLength(data, offset);
        offset += msgLen.bytesRead;
        if (msgLen.length > 0) {
          message = new TextDecoder().decode(data.slice(offset, offset + msgLen.length));
        }
        offset += msgLen.length;
      }

      break;
    } else {
      offset = messageEnd;
    }
  }

  return { entries, resultCode, message };
}

/**
 * Read complete LDAP response(s) from socket
 */
async function readLDAPResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 65536;

  const readPromise = (async () => {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      totalBytes += value.length;

      // For simple responses (bind), one read is usually enough
      // Check if we have a complete LDAP message
      const combined = new Uint8Array(totalBytes);
      let off = 0;
      for (const chunk of chunks) {
        combined.set(chunk, off);
        off += chunk.length;
      }

      // Try to see if we have a complete SEQUENCE
      if (combined.length >= 2) {
        let expectedLen: number;
        if (combined[1] < 128) {
          expectedLen = 2 + combined[1];
        } else {
          const numBytes = combined[1] & 0x7F;
          if (combined.length < 2 + numBytes) continue;
          expectedLen = 2 + numBytes;
          let len = 0;
          for (let i = 0; i < numBytes; i++) {
            len = (len << 8) | combined[2 + i];
          }
          expectedLen += len;
        }
        if (totalBytes >= expectedLen) break;
      }
    }

    const result = new Uint8Array(totalBytes);
    let off = 0;
    for (const chunk of chunks) {
      result.set(chunk, off);
      off += chunk.length;
    }
    return result;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LDAPS read timeout')), timeoutMs)
  );

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Read multiple LDAP messages (for search results)
 */
async function readLDAPSearchResults(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const maxBytes = 131072;

  const readPromise = (async () => {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      totalBytes += value.length;

      // Check if we've received SearchResultDone (tag 0x65)
      const combined = new Uint8Array(totalBytes);
      let off = 0;
      for (const chunk of chunks) {
        combined.set(chunk, off);
        off += chunk.length;
      }

      // Scan for SearchResultDone tag within LDAP messages
      let scanOffset = 0;
      let foundDone = false;
      while (scanOffset < combined.length) {
        if (combined[scanOffset] !== 0x30) break;
        scanOffset++;
        if (scanOffset >= combined.length) break;
        const len = parseLength(combined, scanOffset);
        scanOffset += len.bytesRead;
        const msgEnd = scanOffset + len.length;

        // Skip message ID
        if (scanOffset < combined.length && combined[scanOffset] === 0x02) {
          scanOffset++;
          if (scanOffset >= combined.length) break;
          const idLen = parseLength(combined, scanOffset);
          scanOffset += idLen.bytesRead + idLen.length;
        }

        // Check tag
        if (scanOffset < combined.length && combined[scanOffset] === 0x65) {
          foundDone = true;
          break;
        }

        scanOffset = msgEnd;
      }

      if (foundDone) break;
    }

    const result = new Uint8Array(totalBytes);
    let off = 0;
    for (const chunk of chunks) {
      result.set(chunk, off);
      off += chunk.length;
    }
    return result;
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LDAPS search timeout')), timeoutMs)
  );

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Handle LDAPS connection test (Bind over TLS)
 */
export async function handleLDAPSConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let options: Partial<LDAPSConnectionOptions>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<LDAPSConnectionOptions>;
    } else {
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '636'),
        bindDN: url.searchParams.get('bindDN') || undefined,
        password: url.searchParams.get('password') || undefined,
        timeout: parseInt(url.searchParams.get('timeout') || '30000'),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 636;
    const timeoutMs = options.timeout || 30000;

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
      const startTime = Date.now();

      // Connect with TLS using secureTransport: 'on'
      const socket = connect(`${host}:${port}`, {
        secureTransport: 'on',
        allowHalfOpen: false,
      });
      await socket.opened;

      const rtt = Date.now() - startTime;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Send BIND request
        const bindDN = options.bindDN || '';
        const password = options.password || '';
        const bindRequest = encodeLDAPBindRequest(1, bindDN, password);
        await writer.write(bindRequest);

        // Read BIND response
        const responseData = await readLDAPResponse(reader, 10000);
        const bindResult = parseLDAPBindResponse(responseData);

        // Send UNBIND
        const unbindRequest = encodeLDAPUnbindRequest(2);
        await writer.write(unbindRequest);

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        const bindType = options.bindDN ? 'authenticated' : 'anonymous';

        return {
          success: bindResult.success,
          host,
          port,
          protocol: 'LDAPS',
          tls: true,
          rtt,
          bindDN: options.bindDN || '(anonymous)',
          bindType,
          resultCode: bindResult.resultCode,
          serverResponse: bindResult.message,
          matchedDN: bindResult.matchedDN,
          note: bindResult.success
            ? `LDAPS ${bindType} bind successful over TLS`
            : `LDAPS ${bindType} bind failed: ${bindResult.message}`,
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

      if (!result.success) {
        return new Response(JSON.stringify(result), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

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

// ---------------------------------------------------------------------------
// Shared TLS bind helper
// ---------------------------------------------------------------------------

async function ldapsTLSBind(
  host: string,
  port: number,
  bindDN: string,
  password: string,
  timeoutMs: number
): Promise<{
  socket: ReturnType<typeof connect>;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
}> {
  const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
  await socket.opened;
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  const bindRequest = encodeLDAPBindRequest(1, bindDN, password);
  await writer.write(bindRequest);

  const bindData = await readLDAPResponse(reader, timeoutMs);
  const bindResult = parseLDAPBindResponse(bindData);
  if (!bindResult.success) {
    reader.releaseLock();
    writer.releaseLock();
    await socket.close();
    throw new Error(`Bind failed (code ${bindResult.resultCode}): ${bindResult.message}`);
  }
  return { socket, reader, writer };
}

// ---------------------------------------------------------------------------
// BER helpers used by add/modify/delete (mirror pattern from ldap.ts)
// ---------------------------------------------------------------------------

function berTLV_s(tag: number, data: number[]): number[] {
  return [tag, ...encodeLength(data.length), ...data];
}

function berEnumerated_s(value: number): number[] {
  return [0x0A, 0x01, value];
}

function berInteger_s(value: number): number[] {
  if (value >= 0 && value < 128) return [0x02, 0x01, value];
  const bytes: number[] = [];
  let v = value;
  while (v > 0) { bytes.unshift(v & 0xFF); v >>= 8; }
  if (bytes[0] & 0x80) bytes.unshift(0x00);
  return [0x02, bytes.length, ...bytes];
}

function berSequence_s(data: number[]): number[] {
  return berTLV_s(0x30, data);
}

function ldapsMessage(msgId: number, protocolOp: number[]): Uint8Array {
  const msg = [...berInteger_s(msgId), ...protocolOp];
  return new Uint8Array(berSequence_s(msg));
}

function parseLDAPSResult(data: Uint8Array, expectedTag: number): {
  success: boolean; resultCode: number; matchedDN: string; message: string;
} {
  let offset = 0;
  if (data[offset] !== 0x30) return { success: false, resultCode: -1, matchedDN: '', message: 'Expected SEQUENCE' };
  offset++;
  const seqLen = parseLength(data, offset); offset += seqLen.bytesRead;

  if (data[offset] === 0x02) {
    offset++;
    const idLen = parseLength(data, offset); offset += idLen.bytesRead + idLen.length;
  }

  if (data[offset] !== expectedTag) {
    return { success: false, resultCode: -1, matchedDN: '', message: `Expected tag 0x${expectedTag.toString(16)}, got 0x${data[offset].toString(16)}` };
  }
  offset++;
  const opLen = parseLength(data, offset); offset += opLen.bytesRead;

  let resultCode = -1;
  if (data[offset] === 0x0A) {
    offset++;
    const rcLen = parseLength(data, offset); offset += rcLen.bytesRead;
    resultCode = data[offset]; offset += rcLen.length;
  }

  let matchedDN = '';
  if (offset < data.length && data[offset] === 0x04) {
    offset++;
    const dnLen = parseLength(data, offset); offset += dnLen.bytesRead;
    if (dnLen.length > 0) matchedDN = new TextDecoder().decode(data.slice(offset, offset + dnLen.length));
    offset += dnLen.length;
  }

  let diagMessage = '';
  if (offset < data.length && data[offset] === 0x04) {
    offset++;
    const msgLen = parseLength(data, offset); offset += msgLen.bytesRead;
    if (msgLen.length > 0) diagMessage = new TextDecoder().decode(data.slice(offset, offset + msgLen.length));
  }

  const ldapMessages: Record<number, string> = {
    0: 'Success', 1: 'Operations error', 2: 'Protocol error', 16: 'No such attribute',
    20: 'Attribute or value exists', 32: 'No such object', 34: 'Invalid DN syntax',
    48: 'Inappropriate authentication', 49: 'Invalid credentials', 50: 'Insufficient access rights',
    53: 'Unwilling to perform', 64: 'Naming violation', 65: 'Object class violation',
    68: 'Entry already exists', 69: 'Object class mods prohibited',
  };
  const msg = diagMessage || ldapMessages[resultCode] || `LDAP result code: ${resultCode}`;
  return { success: resultCode === 0, resultCode, matchedDN, message: msg };
}

/**
 * Handle LDAPS Add (Add entry over TLS)
 */
export async function handleLDAPSAdd(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number; bindDN: string; password: string;
      entry: { dn: string; attributes: Record<string, string | string[]> };
      timeout?: number;
    };

    const { host, port = 636, bindDN, password, entry, timeout = 10000 } = body;

    if (!host || !bindDN || !entry?.dn) {
      return new Response(JSON.stringify({ success: false, error: 'host, bindDN, and entry.dn are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const work = (async () => {
      const startTime = Date.now();
      const { socket, reader, writer } = await ldapsTLSBind(host, port, bindDN, password, timeout);

      try {
        const attrListBytes: number[] = [];
        for (const [attrName, attrVal] of Object.entries(entry.attributes)) {
          const vals = Array.isArray(attrVal) ? attrVal : [attrVal];
          const valSet = vals.flatMap(v => encodeOctetString(v));
          const valSetBer = berTLV_s(0x31, valSet);
          const attrSeq = berSequence_s([...encodeOctetString(attrName), ...valSetBer]);
          attrListBytes.push(...attrSeq);
        }

        const addBody = [...encodeOctetString(entry.dn), ...berSequence_s(attrListBytes)];
        const addReq = ldapsMessage(2, berTLV_s(0x68, addBody));
        await writer.write(addReq);

        const respData = await readLDAPResponse(reader, timeout);
        const rtt = Date.now() - startTime;
        const result = parseLDAPSResult(respData, 0x69);

        const unbindReq = ldapsMessage(3, [0x42, 0x00]);
        await writer.write(unbindReq);
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return { success: result.success, host, port, dn: entry.dn, resultCode: result.resultCode, message: result.message, rtt };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { await socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([work, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Add failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle LDAPS Modify (Modify entry over TLS)
 */
export async function handleLDAPSModify(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number; bindDN: string; password: string;
      dn: string;
      changes: Array<{ operation: 'add' | 'replace' | 'delete'; attribute: string; values: string[] }>;
      timeout?: number;
    };

    const { host, port = 636, bindDN, password, dn, changes, timeout = 10000 } = body;

    if (!host || !bindDN || !dn || !changes) {
      return new Response(JSON.stringify({ success: false, error: 'host, bindDN, dn, and changes are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const work = (async () => {
      const startTime = Date.now();
      const { socket, reader, writer } = await ldapsTLSBind(host, port, bindDN, password, timeout);

      try {
        const opCodes: Record<string, number> = { add: 0, delete: 1, replace: 2 };
        const changesBytes: number[] = [];
        for (const change of changes) {
          const opCode = opCodes[change.operation] ?? 0;
          const valSet = change.values.flatMap(v => encodeOctetString(v));
          const partialAttr = berSequence_s([
            ...encodeOctetString(change.attribute),
            ...berTLV_s(0x31, valSet),
          ]);
          changesBytes.push(...berSequence_s([...berEnumerated_s(opCode), ...partialAttr]));
        }

        const modBody = [...encodeOctetString(dn), ...berSequence_s(changesBytes)];
        const modReq = ldapsMessage(2, berTLV_s(0x66, modBody));
        await writer.write(modReq);

        const respData = await readLDAPResponse(reader, timeout);
        const rtt = Date.now() - startTime;
        const result = parseLDAPSResult(respData, 0x67);

        const unbindReq = ldapsMessage(3, [0x42, 0x00]);
        await writer.write(unbindReq);
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return { success: result.success, host, port, dn, resultCode: result.resultCode, message: result.message, rtt };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { await socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([work, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Modify failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle LDAPS Delete (Delete entry over TLS)
 */
export async function handleLDAPSDelete(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number; bindDN: string; password: string;
      dn: string; timeout?: number;
    };

    const { host, port = 636, bindDN, password, dn, timeout = 10000 } = body;

    if (!host || !bindDN || !dn) {
      return new Response(JSON.stringify({ success: false, error: 'host, bindDN, and dn are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const work = (async () => {
      const startTime = Date.now();
      const { socket, reader, writer } = await ldapsTLSBind(host, port, bindDN, password, timeout);

      try {
        const dnBytes = Array.from(new TextEncoder().encode(dn));
        const delReq = ldapsMessage(2, berTLV_s(0x4a, dnBytes));
        await writer.write(delReq);

        const respData = await readLDAPResponse(reader, timeout);
        const rtt = Date.now() - startTime;
        const result = parseLDAPSResult(respData, 0x6b);

        const unbindReq = ldapsMessage(3, [0x42, 0x00]);
        await writer.write(unbindReq);
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return { success: result.success, host, port, dn, resultCode: result.resultCode, message: result.message, rtt };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { await socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([work, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Delete failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle LDAPS Search (Search over TLS)
 */
export async function handleLDAPSSearch(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<LDAPSSearchOptions>;

    if (!options.host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!options.baseDN) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Base DN is required for search',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 636;
    const baseDN = options.baseDN;
    const timeoutMs = options.timeout || 30000;
    const filter = options.filter || '(objectClass=*)';

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

    const searchPromise = (async () => {
      const startTime = Date.now();

      const socket = connect(`${host}:${port}`, {
        secureTransport: 'on',
        allowHalfOpen: false,
      });
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // First, bind (anonymous or authenticated)
        const bindDN = options.bindDN || '';
        const password = options.password || '';
        const bindRequest = encodeLDAPBindRequest(1, bindDN, password);
        await writer.write(bindRequest);

        const bindData = await readLDAPResponse(reader, 10000);
        const bindResult = parseLDAPBindResponse(bindData);

        if (!bindResult.success) {
          throw new Error(`Bind failed: ${bindResult.message}`);
        }

        // Send Search request
        const searchRequest = encodeLDAPSearchRequest(2, baseDN, filter);
        await writer.write(searchRequest);

        // Read search results (multiple messages)
        const searchData = await readLDAPSearchResults(reader, timeoutMs);
        const rtt = Date.now() - startTime;

        const searchResults = parseLDAPSearchResults(searchData);

        // Send UNBIND
        const unbindRequest = encodeLDAPUnbindRequest(3);
        await writer.write(unbindRequest);

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          host,
          port,
          tls: true,
          baseDN,
          filter,
          entries: searchResults.entries,
          entryCount: searchResults.entries.length,
          resultCode: searchResults.resultCode,
          rtt,
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Search timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([searchPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Search timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Search failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
