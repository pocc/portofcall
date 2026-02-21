/**
 * LDAPS Protocol Support for Cloudflare Workers
 * LDAP over TLS (RFC 4511 / RFC 4513 / RFC 8314) — port 636
 *
 * Identical to LDAP but the entire connection is wrapped in TLS
 * using Cloudflare Workers' secureTransport: 'on' option.
 *
 * Protocol: ASN.1/BER encoded LDAP messages over TLS
 *
 * Operations supported:
 *   - Connect + Bind (anonymous or authenticated) over TLS
 *   - Search (configurable scope, filter, attributes) over TLS
 *   - Paged Search (RFC 2696) over TLS
 *   - Add (create entries) over TLS
 *   - Modify (update entries) over TLS
 *   - Delete (remove entries) over TLS
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
  bindDn?: string;
  password?: string;
  timeout?: number;
}

interface LDAPSSearchOptions extends LDAPSConnectionOptions {
  baseDN?: string;
  baseDn?: string;
  filter?: string;
  scope?: number;
  attributes?: string[];
  sizeLimit?: number;
}

// ---------------------------------------------------------------------------
// ASN.1/BER encoding helpers
// ---------------------------------------------------------------------------

function berLength(n: number): number[] {
  if (n < 128) return [n];
  const bytes: number[] = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xFF); v >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}

function berTLV(tag: number, data: number[]): number[] {
  return [tag, ...berLength(data.length), ...data];
}

function berInteger(value: number): number[] {
  if (value >= 0 && value < 128) return [0x02, 0x01, value];
  const bytes: number[] = [];
  let v = value;
  if (v < 0) {
    // Two's complement for negative numbers
    const u = v >>> 0;
    return [0x02, 0x04,
      (u >> 24) & 0xFF, (u >> 16) & 0xFF, (u >> 8) & 0xFF, u & 0xFF];
  }
  while (v > 0) { bytes.unshift(v & 0xFF); v >>= 8; }
  if (bytes[0] & 0x80) bytes.unshift(0x00);
  return [0x02, bytes.length, ...bytes];
}

function berEnumerated(value: number): number[] {
  return [0x0A, 0x01, value];
}

function berOctetString(s: string): number[] {
  const b = new TextEncoder().encode(s);
  return berTLV(0x04, Array.from(b));
}

function berSequence(data: number[]): number[] {
  return berTLV(0x30, data);
}

function berBoolean(value: boolean): number[] {
  return [0x01, 0x01, value ? 0xFF : 0x00];
}

function ldapsMessage(msgId: number, protocolOp: number[]): Uint8Array {
  const msg = [...berInteger(msgId), ...protocolOp];
  return new Uint8Array(berSequence(msg));
}

/** Build an LDAP message SEQUENCE with a controls [0] section appended. */
function ldapsMessageWithControls(
  msgId: number,
  protocolOp: number[],
  controls: number[],
): Uint8Array {
  const msg = [...berInteger(msgId), ...protocolOp, ...controls];
  return new Uint8Array(berSequence(msg));
}

// ---------------------------------------------------------------------------
// ASN.1/BER parsing helpers
// ---------------------------------------------------------------------------

function parseLength(data: Uint8Array, offset: number): { length: number; bytesRead: number } {
  if (data[offset] < 128) return { length: data[offset], bytesRead: 1 };
  const numBytes = data[offset] & 0x7F;
  let length = 0;
  for (let i = 0; i < numBytes; i++) length = (length << 8) | data[offset + 1 + i];
  return { length, bytesRead: 1 + numBytes };
}

// ---------------------------------------------------------------------------
// Filter encoding
// ---------------------------------------------------------------------------

function encodeFilter(filter: string): number[] {
  const presenceMatch = filter.match(/^\(([^=)]+)=\*\)$/);
  if (presenceMatch) {
    const attrBytes = new TextEncoder().encode(presenceMatch[1]);
    return berTLV(0x87, Array.from(attrBytes));
  }
  const equalityMatch = filter.match(/^\(([^=)]+)=([^)]*)\)$/);
  if (equalityMatch) {
    const attrPart = berOctetString(equalityMatch[1]);
    const valPart = berOctetString(equalityMatch[2]);
    return berTLV(0xA3, [...attrPart, ...valPart]);
  }
  // Default: (objectClass=*) presence
  const fallback = new TextEncoder().encode('objectClass');
  return berTLV(0x87, Array.from(fallback));
}

// ---------------------------------------------------------------------------
// LDAP message encoding
// ---------------------------------------------------------------------------

/**
 * Encode LDAP BIND request (APPLICATION 0 = 0x60)
 * RFC 4511 Section 4.2
 */
function encodeLDAPBindRequest(messageId: number, bindDN: string, password: string): Uint8Array {
  const bindBody = [
    ...berInteger(3),         // LDAP version 3
    ...berOctetString(bindDN),
    ...berTLV(0x80, Array.from(new TextEncoder().encode(password))), // simple auth [0]
  ];
  return ldapsMessage(messageId, berTLV(0x60, bindBody));
}

/**
 * Encode LDAP UNBIND request (APPLICATION 2 = 0x42)
 * RFC 4511 Section 4.3 -- UnbindRequest has no content
 */
function encodeLDAPUnbindRequest(messageId: number): Uint8Array {
  return ldapsMessage(messageId, [0x42, 0x00]);
}

/**
 * Encode LDAP SearchRequest (APPLICATION 3 = 0x63)
 * RFC 4511 Section 4.5.1
 */
function encodeLDAPSearchRequest(
  messageId: number,
  baseDN: string,
  filter: string,
  scope: number = 0,
  sizeLimitVal: number = 100,
  timeLimitSec: number = 10,
  attributes: string[] = [],
): Uint8Array {
  const filterBytes = encodeFilter(filter);
  const attrList = attributes.flatMap(a => berOctetString(a));
  const attrSeq = berSequence(attrList);

  const searchBody: number[] = [
    ...berOctetString(baseDN),
    ...berEnumerated(scope),           // scope: 0=base, 1=one, 2=sub
    ...berEnumerated(0),               // derefAliases: neverDerefAliases
    ...berInteger(sizeLimitVal),
    ...berInteger(timeLimitSec),
    ...berBoolean(false),              // typesOnly
    ...filterBytes,
    ...attrSeq,
  ];
  return ldapsMessage(messageId, berTLV(0x63, searchBody));
}

// ---------------------------------------------------------------------------
// Length-aware socket reader
// ---------------------------------------------------------------------------

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

      const combined = new Uint8Array(totalBytes);
      let off = 0;
      for (const c of chunks) { combined.set(c, off); off += c.length; }

      if (combined.length >= 2) {
        let expectedLen: number;
        if (combined[1] < 128) {
          expectedLen = 2 + combined[1];
        } else {
          const numBytes = combined[1] & 0x7F;
          if (combined.length < 2 + numBytes) continue;
          let len = 0;
          for (let i = 0; i < numBytes; i++) len = (len << 8) | combined[2 + i];
          expectedLen = 2 + numBytes + len;
        }
        if (totalBytes >= expectedLen) break;
      }
    }
    const result = new Uint8Array(totalBytes);
    let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.length; }
    return result;
  })();

  return Promise.race([
    readPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('LDAPS read timeout')), timeoutMs)
    ),
  ]);
}

async function readLDAPSearchData(
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

      const combined = new Uint8Array(totalBytes);
      let off = 0;
      for (const c of chunks) { combined.set(c, off); off += c.length; }

      // Scan for SearchResultDone (0x65) tag inside any SEQUENCE
      let scanOff = 0;
      let foundDone = false;
      while (scanOff < combined.length) {
        if (combined[scanOff] !== 0x30) break;
        scanOff++;
        if (scanOff >= combined.length) break;
        const lenInfo = parseLength(combined, scanOff);
        scanOff += lenInfo.bytesRead;
        const msgEnd = scanOff + lenInfo.length;
        // Skip message ID
        if (scanOff < combined.length && combined[scanOff] === 0x02) {
          scanOff++;
          const idLen = parseLength(combined, scanOff);
          scanOff += idLen.bytesRead + idLen.length;
        }
        if (scanOff < combined.length && combined[scanOff] === 0x65) {
          foundDone = true;
          break;
        }
        scanOff = msgEnd;
      }
      if (foundDone) break;
    }

    const result = new Uint8Array(totalBytes);
    let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.length; }
    return result;
  })();

  return Promise.race([
    readPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('LDAPS search timeout')), timeoutMs)
    ),
  ]);
}

// ---------------------------------------------------------------------------
// BER response parsers
// ---------------------------------------------------------------------------

const LDAP_RESULT_MESSAGES: Record<number, string> = {
  0: 'Success', 1: 'Operations error', 2: 'Protocol error',
  3: 'Time limit exceeded', 4: 'Size limit exceeded',
  7: 'Auth method not supported', 8: 'Stronger auth required',
  16: 'No such attribute', 17: 'Undefined attribute type',
  20: 'Attribute or value exists', 21: 'Invalid attribute syntax',
  32: 'No such object', 34: 'Invalid DN syntax',
  48: 'Inappropriate authentication', 49: 'Invalid credentials',
  50: 'Insufficient access rights', 53: 'Unwilling to perform',
  64: 'Naming violation', 65: 'Object class violation',
  68: 'Entry already exists', 69: 'Object class mods prohibited',
};

function parseLDAPResult(data: Uint8Array, expectedTag: number): {
  success: boolean; resultCode: number; matchedDN: string; message: string;
} {
  let offset = 0;
  if (data[offset] !== 0x30) return { success: false, resultCode: -1, matchedDN: '', message: 'Expected SEQUENCE' };
  offset++;
  const seqLen = parseLength(data, offset); offset += seqLen.bytesRead;

  // Skip message ID
  if (data[offset] === 0x02) {
    offset++;
    const idLen = parseLength(data, offset); offset += idLen.bytesRead + idLen.length;
  }

  if (data[offset] !== expectedTag) {
    return { success: false, resultCode: -1, matchedDN: '', message: `Expected tag 0x${expectedTag.toString(16)}, got 0x${data[offset].toString(16)}` };
  }
  offset++;
  const opLen = parseLength(data, offset); offset += opLen.bytesRead;

  // resultCode (ENUMERATED)
  let resultCode = -1;
  if (data[offset] === 0x0A) {
    offset++;
    const rcLen = parseLength(data, offset); offset += rcLen.bytesRead;
    resultCode = data[offset]; offset += rcLen.length;
  }

  // matchedDN (OCTET STRING)
  let matchedDN = '';
  if (offset < data.length && data[offset] === 0x04) {
    offset++;
    const dnLen = parseLength(data, offset); offset += dnLen.bytesRead;
    if (dnLen.length > 0) matchedDN = new TextDecoder().decode(data.slice(offset, offset + dnLen.length));
    offset += dnLen.length;
  }

  // diagnosticMessage (OCTET STRING)
  let diagMessage = '';
  if (offset < data.length && data[offset] === 0x04) {
    offset++;
    const msgLen = parseLength(data, offset); offset += msgLen.bytesRead;
    if (msgLen.length > 0) diagMessage = new TextDecoder().decode(data.slice(offset, offset + msgLen.length));
  }

  const msg = diagMessage || LDAP_RESULT_MESSAGES[resultCode] || `LDAP result code: ${resultCode}`;
  return { success: resultCode === 0, resultCode, matchedDN, message: msg };
}

function parseLDAPSearchResults(data: Uint8Array): {
  entries: Array<{ dn: string; attributes: Array<{ type: string; values: string[] }> }>;
  resultCode: number;
  message: string;
} {
  const entries: Array<{ dn: string; attributes: Array<{ type: string; values: string[] }> }> = [];
  let resultCode = -1;
  let message = '';
  let offset = 0;

  while (offset < data.length) {
    if (data[offset] !== 0x30) break;
    offset++;
    const seqLen = parseLength(data, offset); offset += seqLen.bytesRead;
    const messageEnd = offset + seqLen.length;

    // Skip message ID
    if (data[offset] === 0x02) {
      offset++;
      const idLen = parseLength(data, offset); offset += idLen.bytesRead + idLen.length;
    }

    const tag = data[offset];

    if (tag === 0x64) {
      // SearchResultEntry (APPLICATION 4)
      offset++;
      const entryLen = parseLength(data, offset); offset += entryLen.bytesRead;

      let dn = '';
      if (data[offset] === 0x04) {
        offset++;
        const dnLen = parseLength(data, offset); offset += dnLen.bytesRead;
        if (dnLen.length > 0) dn = new TextDecoder().decode(data.slice(offset, offset + dnLen.length));
        offset += dnLen.length;
      }

      const attributes: Array<{ type: string; values: string[] }> = [];
      if (data[offset] === 0x30) {
        offset++;
        const attrsLen = parseLength(data, offset); offset += attrsLen.bytesRead;
        const attrsEnd = offset + attrsLen.length;

        while (offset < attrsEnd) {
          if (data[offset] !== 0x30) break;
          offset++;
          const attrLen = parseLength(data, offset); offset += attrLen.bytesRead;

          let attrType = '';
          if (data[offset] === 0x04) {
            offset++;
            const typeLen = parseLength(data, offset); offset += typeLen.bytesRead;
            if (typeLen.length > 0) attrType = new TextDecoder().decode(data.slice(offset, offset + typeLen.length));
            offset += typeLen.length;
          }

          const values: string[] = [];
          if (data[offset] === 0x31) {
            offset++;
            const setLen = parseLength(data, offset); offset += setLen.bytesRead;
            const setEnd = offset + setLen.length;
            while (offset < setEnd) {
              if (data[offset] === 0x04) {
                offset++;
                const valLen = parseLength(data, offset); offset += valLen.bytesRead;
                if (valLen.length > 0) values.push(new TextDecoder().decode(data.slice(offset, offset + valLen.length)));
                offset += valLen.length;
              } else break;
            }
          }
          if (attrType) attributes.push({ type: attrType, values });
        }
      }
      entries.push({ dn, attributes });
      offset = messageEnd;
    } else if (tag === 0x65) {
      // SearchResultDone (APPLICATION 5)
      offset++;
      const doneLen = parseLength(data, offset); offset += doneLen.bytesRead;
      if (data[offset] === 0x0A) {
        offset++;
        const rcLen = parseLength(data, offset); offset += rcLen.bytesRead;
        resultCode = data[offset]; offset += rcLen.length;
      }
      // Skip matched DN
      if (offset < data.length && data[offset] === 0x04) {
        offset++;
        const dnLen = parseLength(data, offset); offset += dnLen.bytesRead + dnLen.length;
      }
      // Diagnostic message
      if (offset < data.length && data[offset] === 0x04) {
        offset++;
        const msgLen = parseLength(data, offset); offset += msgLen.bytesRead;
        if (msgLen.length > 0) message = new TextDecoder().decode(data.slice(offset, offset + msgLen.length));
      }
      break;
    } else {
      offset = messageEnd;
    }
  }

  return { entries, resultCode, message };
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
  const bindResult = parseLDAPResult(bindData, 0x61);
  if (!bindResult.success) {
    reader.releaseLock();
    writer.releaseLock();
    await socket.close();
    throw new Error(`Bind failed (code ${bindResult.resultCode}): ${bindResult.message}`);
  }
  return { socket, reader, writer };
}

/** Resolve bindDN from either casing variant */
function resolveBindDN(body: { bindDN?: string; bindDn?: string }): string {
  return body.bindDN || body.bindDn || '';
}

// ---------------------------------------------------------------------------
// RFC 2696 Simple Paged Results Control helpers
// OID: 1.2.840.113556.1.4.319
// ---------------------------------------------------------------------------

const PAGED_RESULTS_OID = '1.2.840.113556.1.4.319';

/** Encode the Simple Paged Results Control for inclusion in a SearchRequest. */
function encodePagedResultsControl(pageSize: number, cookie: Uint8Array): number[] {
  // controlValue inner SEQUENCE { INTEGER pageSize, OCTET STRING cookie }
  const innerSeq = berSequence([
    ...berInteger(pageSize),
    ...berTLV(0x04, Array.from(cookie)),
  ]);
  // Control SEQUENCE { controlType OID as OCTET STRING, controlValue OCTET STRING wrapping innerSeq }
  const ctrl = berSequence([
    ...berOctetString(PAGED_RESULTS_OID),
    ...berTLV(0x04, innerSeq), // controlValue
  ]);
  // Controls wrapper: context-specific constructed [0] = tag 0xA0
  return berTLV(0xA0, ctrl);
}

/**
 * Extract the RFC 2696 response cookie from the controls section of a
 * SearchResultDone message. Returns empty Uint8Array when there are no
 * more pages.
 */
function extractPagedResultsCookie(data: Uint8Array): Uint8Array {
  let offset = 0;

  // Walk through concatenated LDAPMessage SEQUENCEs
  while (offset < data.length) {
    if (data[offset] !== 0x30) break;
    offset++;
    const seqLen = parseLength(data, offset);
    offset += seqLen.bytesRead;
    const msgEnd = offset + seqLen.length;

    // Skip messageID (INTEGER 0x02)
    if (offset < data.length && data[offset] === 0x02) {
      offset++;
      const idLen = parseLength(data, offset);
      offset += idLen.bytesRead + idLen.length;
    }

    const tag = data[offset];
    if (tag === 0x65) {
      // SearchResultDone -- skip its body, look for controls after it
      offset++;
      const doneLen = parseLength(data, offset);
      offset += doneLen.bytesRead + doneLen.length;

      // Controls [0] = 0xA0
      if (offset < msgEnd && data[offset] === 0xA0) {
        offset++;
        const ctrlsLen = parseLength(data, offset);
        offset += ctrlsLen.bytesRead;
        const ctrlsEnd = offset + ctrlsLen.length;

        while (offset < ctrlsEnd) {
          if (data[offset] !== 0x30) break;
          offset++;
          const ctrlLen = parseLength(data, offset);
          offset += ctrlLen.bytesRead;
          const ctrlEnd = offset + ctrlLen.length;

          // controlType (OCTET STRING 0x04)
          if (offset < ctrlEnd && data[offset] === 0x04) {
            offset++;
            const oidLen = parseLength(data, offset);
            offset += oidLen.bytesRead;
            const oidStr = new TextDecoder().decode(
              data.slice(offset, offset + oidLen.length),
            );
            offset += oidLen.length;

            // Skip optional criticality (BOOLEAN 0x01)
            if (offset < ctrlEnd && data[offset] === 0x01) {
              offset++;
              const boolLen = parseLength(data, offset);
              offset += boolLen.bytesRead + boolLen.length;
            }

            // controlValue (OCTET STRING 0x04) -- only for our OID
            if (
              offset < ctrlEnd &&
              data[offset] === 0x04 &&
              oidStr === PAGED_RESULTS_OID
            ) {
              offset++;
              const valLen = parseLength(data, offset);
              offset += valLen.bytesRead;
              const valData = data.slice(offset, offset + valLen.length);

              // Inner SEQUENCE { INTEGER size, OCTET STRING cookie }
              let vOff = 0;
              if (valData[vOff] === 0x30) {
                vOff++;
                const vs = parseLength(valData, vOff);
                vOff += vs.bytesRead;
                // Skip INTEGER (server's total size estimate)
                if (vOff < valData.length && valData[vOff] === 0x02) {
                  vOff++;
                  const il = parseLength(valData, vOff);
                  vOff += il.bytesRead + il.length;
                }
                // Cookie OCTET STRING
                if (vOff < valData.length && valData[vOff] === 0x04) {
                  vOff++;
                  const cl = parseLength(valData, vOff);
                  vOff += cl.bytesRead;
                  return valData.slice(vOff, vOff + cl.length);
                }
              }
            }
          }
          offset = ctrlEnd;
        }
      }
      break;
    } else {
      offset = msgEnd;
    }
  }
  return new Uint8Array(0);
}

// ---------------------------------------------------------------------------
// Handler: LDAPS Connect (Bind test over TLS)
// ---------------------------------------------------------------------------

export async function handleLDAPSConnect(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Allow': 'POST', 'Content-Type': 'application/json' } });
    }
    const raw = await request.json() as Partial<LDAPSConnectionOptions>;
    const options = { ...raw, bindDN: resolveBindDN(raw) || undefined };

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
        const responseData = await readLDAPResponse(reader, timeoutMs);
        const bindResult = parseLDAPResult(responseData, 0x61);

        // Send UNBIND only when the bind succeeded; if the server rejected
        // the bind it may have already closed the TLS session, so attempting
        // an Unbind write would throw and mask the real error details.
        if (bindResult.success) {
          const unbindRequest = encodeLDAPUnbindRequest(2);
          try { await writer.write(unbindRequest); } catch { /* ignore */ }
        }

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
          matchedDN: bindResult.matchedDN || undefined,
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
// Handler: LDAPS Add (Add entry over TLS)
// ---------------------------------------------------------------------------

export async function handleLDAPSAdd(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number; bindDN?: string; bindDn?: string; password: string;
      entry: { dn: string; attributes: Record<string, string | string[]> };
      timeout?: number;
    };

    const { host, port = 636, password, entry, timeout = 10000 } = body;
    const bindDN = resolveBindDN(body);

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
        // Build AttributeList: SEQUENCE OF SEQUENCE { type, vals SET OF value }
        const attrListBytes: number[] = [];
        for (const [attrName, attrVal] of Object.entries(entry.attributes)) {
          const vals = Array.isArray(attrVal) ? attrVal : [attrVal];
          const valSet = vals.flatMap(v => berOctetString(v));
          const valSetBer = berTLV(0x31, valSet);
          const attrSeq = berSequence([...berOctetString(attrName), ...valSetBer]);
          attrListBytes.push(...attrSeq);
        }

        // AddRequest (APPLICATION 8 = 0x68)
        const addBody = [...berOctetString(entry.dn), ...berSequence(attrListBytes)];
        const addReq = ldapsMessage(2, berTLV(0x68, addBody));
        await writer.write(addReq);

        const respData = await readLDAPResponse(reader, timeout);
        const rtt = Date.now() - startTime;
        // AddResponse is APPLICATION 9 = 0x69
        const result = parseLDAPResult(respData, 0x69);

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

// ---------------------------------------------------------------------------
// Handler: LDAPS Modify (Modify entry over TLS)
// ---------------------------------------------------------------------------

export async function handleLDAPSModify(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number; bindDN?: string; bindDn?: string; password: string;
      dn: string;
      changes: Array<{ operation: 'add' | 'replace' | 'delete'; attribute: string; values: string[] }>;
      timeout?: number;
    };

    const { host, port = 636, password, dn, changes, timeout = 10000 } = body;
    const bindDN = resolveBindDN(body);

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

        // Build changes SEQUENCE OF SEQUENCE { operation ENUMERATED, modification PartialAttribute }
        const changesBytes: number[] = [];
        for (const change of changes) {
          const opCode = opCodes[change.operation] ?? 0;
          const valSet = change.values.flatMap(v => berOctetString(v));
          const partialAttr = berSequence([
            ...berOctetString(change.attribute),
            ...berTLV(0x31, valSet),
          ]);
          const changeSeq = berSequence([...berEnumerated(opCode), ...partialAttr]);
          changesBytes.push(...changeSeq);
        }

        // ModifyRequest APPLICATION 6 = 0x66
        const modBody = [...berOctetString(dn), ...berSequence(changesBytes)];
        const modReq = ldapsMessage(2, berTLV(0x66, modBody));
        await writer.write(modReq);

        const respData = await readLDAPResponse(reader, timeout);
        const rtt = Date.now() - startTime;
        // ModifyResponse APPLICATION 7 = 0x67
        const result = parseLDAPResult(respData, 0x67);

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

// ---------------------------------------------------------------------------
// Handler: LDAPS Delete (Delete entry over TLS)
// ---------------------------------------------------------------------------

export async function handleLDAPSDelete(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json() as {
      host: string; port?: number; bindDN?: string; bindDn?: string; password: string;
      dn: string; timeout?: number;
    };

    const { host, port = 636, password, dn, timeout = 10000 } = body;
    const bindDN = resolveBindDN(body);

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
        // DelRequest: APPLICATION 10 = 0x4a, content is the DN as raw bytes
        const dnBytes = Array.from(new TextEncoder().encode(dn));
        const delReq = ldapsMessage(2, berTLV(0x4a, dnBytes));
        await writer.write(delReq);

        const respData = await readLDAPResponse(reader, timeout);
        const rtt = Date.now() - startTime;
        // DelResponse: APPLICATION 11 = 0x6b
        const result = parseLDAPResult(respData, 0x6b);

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

// ---------------------------------------------------------------------------
// Handler: LDAPS Search (Search over TLS)
// ---------------------------------------------------------------------------

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

    const baseDN = options.baseDN || options.baseDn;
    if (!baseDN) {
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
    const timeoutMs = options.timeout || 30000;
    const filter = options.filter || '(objectClass=*)';
    const scope = options.scope ?? 2;
    const sizeLimit = options.sizeLimit ?? 100;
    const attributes = options.attributes || [];

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
      const bindDN = resolveBindDN(options);
      const password = options.password || '';
      const { socket, reader, writer } = await ldapsTLSBind(host, port, bindDN, password, timeoutMs);

      try {
        // Send Search request
        const searchRequest = encodeLDAPSearchRequest(
          2, baseDN, filter, scope, sizeLimit,
          Math.floor(timeoutMs / 1000), attributes,
        );
        await writer.write(searchRequest);

        // Read search results (multiple messages)
        const searchData = await readLDAPSearchData(reader, timeoutMs);
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
          scope,
          filter,
          entries: searchResults.entries,
          entryCount: searchResults.entries.length,
          resultCode: searchResults.resultCode,
          rtt,
        };
      } catch (error) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { await socket.close(); } catch { /* ignore */ }
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

// ---------------------------------------------------------------------------
// Handler: LDAPS Paged Search (RFC 2696 over TLS)
// ---------------------------------------------------------------------------

/**
 * POST /api/ldaps/paged-search
 * Body: { host, port=636, bindDN?, password?, baseDN, filter='(objectClass=*)',
 *         scope=2, attributes=[], pageSize=100, cookie='', timeout=30000 }
 *
 * Returns: { success, entries, resultCode, cookie (hex), hasMore, entryCount, rtt }
 *
 * For the first request omit `cookie` or pass ''. For subsequent pages pass
 * the hex cookie string returned by the previous response. When `hasMore`
 * is false there are no further pages.
 */
export async function handleLDAPSPagedSearch(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = (await request.json()) as {
      host: string;
      port?: number;
      bindDn?: string;
      bindDN?: string;
      password?: string;
      baseDn?: string;
      baseDN?: string;
      filter?: string;
      scope?: number;
      attributes?: string[];
      pageSize?: number;
      cookie?: string;
      timeout?: number;
    };

    const {
      host,
      port = 636,
      password = '',
      filter = '(objectClass=*)',
      scope = 2,
      attributes = [],
      pageSize = 100,
      cookie: cookieHex = '',
      timeout = 30000,
    } = body;

    const bindDN = resolveBindDN(body);
    const baseDN = body.baseDN || body.baseDn;

    if (!host) {
      return new Response(
        JSON.stringify({ success: false, error: 'host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (!baseDN) {
      return new Response(
        JSON.stringify({ success: false, error: 'baseDN is required' }),
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

    // Decode hex cookie from previous page (empty = first page)
    let cookieBytes = new Uint8Array(0);
    if (cookieHex) {
      const hex = cookieHex.replace(/\s/g, '');
      const pairs = hex.match(/.{1,2}/g);
      cookieBytes = new Uint8Array(
        pairs ? pairs.map((b) => parseInt(b, 16)) : [],
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const work = (async () => {
      const startTime = Date.now();
      const { socket, reader, writer } = await ldapsTLSBind(
        host, port, bindDN, password, timeout,
      );

      try {
        // Build SearchRequest (APPLICATION 3 = 0x63) with Paged Results Control
        const filterBytes = encodeFilter(filter);
        const attrList = attributes.flatMap((a) => berOctetString(a));
        const attrSeq = berSequence(attrList);

        const searchBody: number[] = [
          ...berOctetString(baseDN),
          ...berEnumerated(scope),
          ...berEnumerated(0),         // derefAliases: neverDerefAliases
          ...berInteger(0),            // sizeLimit 0 = server decides
          ...berInteger(Math.floor(timeout / 1000)),
          ...berBoolean(false),        // typesOnly
          ...filterBytes,
          ...attrSeq,
        ];
        const searchOp = berTLV(0x63, searchBody);
        const controls = encodePagedResultsControl(pageSize, cookieBytes);
        const searchReq = ldapsMessageWithControls(2, searchOp, controls);

        await writer.write(searchReq);

        const rawData = await readLDAPSearchData(reader, timeout);
        const rtt = Date.now() - startTime;
        const parsed = parseLDAPSearchResults(rawData);

        // Extract response cookie from SearchResultDone controls
        const responseCookie = extractPagedResultsCookie(rawData);
        const hasMore = responseCookie.length > 0;
        const responseCookieHex = Array.from(responseCookie)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        // Unbind
        const unbindReq = ldapsMessage(3, [0x42, 0x00]);
        await writer.write(unbindReq);
        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

        return {
          success: true,
          host,
          port,
          tls: true,
          baseDN,
          scope,
          filter,
          pageSize,
          entries: parsed.entries,
          entryCount: parsed.entries.length,
          resultCode: parsed.resultCode,
          cookie: responseCookieHex,
          hasMore,
          rtt,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { await socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([work, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Paged search failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
