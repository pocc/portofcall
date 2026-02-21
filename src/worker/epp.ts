/**
 * EPP (Extensible Provisioning Protocol) - RFCs 5730-5734
 * Port: 700 (TCP over TLS, per RFC 5734)
 * Protocol: XML-based with length-prefixed framing (4-byte big-endian header)
 *
 * EPP is used for domain registration provisioning between registrars and registries.
 * Commands: hello, login, check, info, create, renew, transfer, update, delete
 *
 * Transport (RFC 5734):
 *   Each EPP frame is preceded by a 4-byte network-order (big-endian) length field.
 *   The length value INCLUDES the 4 header bytes themselves. Minimum valid length = 4.
 *
 * Session lifecycle (RFC 5730 Section 2):
 *   1. Server sends <greeting> upon connection
 *   2. Client may send <hello/> to request a fresh <greeting>
 *   3. Client sends <login> to authenticate and declare object URIs
 *   4. Client sends transform/query commands
 *   5. Client sends <logout> to end the session gracefully
 */

import { connect } from 'cloudflare:sockets';

interface EPPConfig {
  host: string;
  port: number;
  clid?: string;     // Client ID (registrar username)
  pw?: string;       // Password
}

interface EPPResponse {
  success: boolean;
  message: string;
  code?: number;
  xml?: string;
  data?: Record<string, unknown>;
}

/**
 * Escape XML special characters to prevent injection and malformed XML.
 * All five predefined XML entities are escaped.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Reads an EPP frame from the socket.
 *
 * RFC 5734 Section 4: Each EPP data unit is preceded by 4 bytes containing the
 * total length of the data unit (in network byte order). The total length includes
 * the 4 header bytes. So a frame with N payload bytes has length = N + 4.
 *
 * The stream may deliver data in arbitrary chunk boundaries, so we handle:
 * - Partial header reads (need exactly 4 bytes before parsing length)
 * - First chunk containing header + partial/full payload
 * - First chunk containing data beyond this frame (clamp to payloadLength)
 * - Multiple subsequent reads to fill the payload
 */
async function readEPPFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  // Accumulate exactly 4 header bytes (stream chunks may be smaller)
  const headerBuf = new Uint8Array(4);
  let headerFilled = 0;
  let leftover: Uint8Array | null = null;

  while (headerFilled < 4) {
    const { done, value } = await reader.read();
    if (done || !value || value.length === 0) {
      throw new Error('Failed to read EPP frame header: connection closed');
    }
    const need = 4 - headerFilled;
    const take = Math.min(value.length, need);
    headerBuf.set(value.slice(0, take), headerFilled);
    headerFilled += take;

    // If this chunk had extra bytes beyond the header, save them for payload
    if (headerFilled === 4 && take < value.length) {
      leftover = value.slice(take);
    }
  }

  const totalLength = new DataView(headerBuf.buffer, headerBuf.byteOffset, 4).getUint32(0, false);

  // RFC 5734: length includes the 4 header bytes
  const payloadLength = totalLength - 4;

  if (payloadLength < 0 || payloadLength > 10_000_000) {
    throw new Error(`Invalid EPP frame length: ${totalLength} (payload would be ${payloadLength} bytes)`);
  }

  if (payloadLength === 0) {
    return '';
  }

  const payload = new Uint8Array(payloadLength);
  let bytesRead = 0;

  // Copy any leftover bytes from the header read
  if (leftover !== null) {
    const toCopy = Math.min(leftover.length, payloadLength);
    payload.set(leftover.slice(0, toCopy), 0);
    bytesRead += toCopy;
  }

  while (bytesRead < payloadLength) {
    const { done, value } = await reader.read();
    if (done || !value) {
      throw new Error(`Connection closed while reading EPP frame (got ${bytesRead}/${payloadLength} bytes)`);
    }
    const remaining = payloadLength - bytesRead;
    const toCopy = Math.min(value.length, remaining);
    payload.set(value.slice(0, toCopy), bytesRead);
    bytesRead += toCopy;
  }

  return new TextDecoder().decode(payload);
}

/**
 * Encodes an XML string into an EPP frame (4-byte length header + payload).
 *
 * RFC 5734 Section 4: The length field is a 32-bit unsigned integer in network
 * byte order that includes its own 4 bytes in the total.
 */
function encodeEPPFrame(xml: string): Uint8Array {
  const payload = new TextEncoder().encode(xml);
  const totalLength = payload.length + 4;

  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, totalLength, false); // big-endian / network byte order
  frame.set(payload, 4);

  return frame;
}

/**
 * Build and send an EPP <logout/> command, read the response.
 * RFC 5730 Section 2.9.1.2: The client SHOULD send logout before closing.
 */
async function sendLogout(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  const logoutXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <logout/>
    <clTRID>logout-${Date.now()}</clTRID>
  </command>
</epp>`;
  try {
    await writer.write(encodeEPPFrame(logoutXml));
    await readEPPFrame(reader); // 1500 = "Command completed successfully; ending session"
  } catch {
    // Best-effort; server may have closed already
  }
}

/**
 * Parses an EPP command response to extract the result code and message.
 *
 * RFC 5730 Section 3: Command responses contain a <result> element with a
 * numeric "code" attribute and a <msg> child element.
 *
 * Result code ranges (RFC 5730 Section 3):
 *   1000-1999: Success (1000 = OK, 1001 = action pending, 1300-1301 = queue)
 *   2000-2999: Errors
 */
function parseEPPResponse(xml: string): { code: number; message: string } {
  // Match result code with optional whitespace variations and single/double quotes
  const codeMatch = xml.match(/<result\s+code\s*=\s*["'](\d+)["']/);
  const msgMatch = xml.match(/<msg[^>]*>([^<]+)<\/msg>/);

  return {
    code: codeMatch ? parseInt(codeMatch[1], 10) : 0,
    message: msgMatch ? msgMatch[1].trim() : 'Unknown response',
  };
}

/**
 * Checks whether an XML string is an EPP <greeting> (returned by server
 * on connect and in response to <hello/>).
 *
 * RFC 5730 Section 2.4: A greeting contains <svID>, <svDate>, <svcMenu>, etc.
 * It does NOT contain a <result> element.
 */
function isGreeting(xml: string): boolean {
  return /<greeting>/i.test(xml);
}

/**
 * Generate a unique client transaction ID.
 * RFC 5730 Section 2.5: clTRID is optional but RECOMMENDED.
 */
function clTRID(prefix = 'poc'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build an EPP login command XML string.
 * Extracted to avoid duplicating the same XML template in every handler.
 *
 * RFC 5730 Section 2.9.1.1: Login command structure.
 * The <svcs> element lists object namespace URIs the client intends to use.
 */
function buildLoginXml(clid: string, pw: string, objURIs: string[] = [
  'urn:ietf:params:xml:ns:domain-1.0',
  'urn:ietf:params:xml:ns:contact-1.0',
  'urn:ietf:params:xml:ns:host-1.0',
]): string {
  const svcLines = objURIs.map(uri => `        <objURI>${escapeXml(uri)}</objURI>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <login>
      <clID>${escapeXml(clid)}</clID>
      <pw>${escapeXml(pw)}</pw>
      <options>
        <version>1.0</version>
        <lang>en</lang>
      </options>
      <svcs>
${svcLines}
      </svcs>
    </login>
    <clTRID>${clTRID('login')}</clTRID>
  </command>
</epp>`;
}

/**
 * Open an EPP session: connect, read greeting, login.
 * Returns the reader, writer, socket, and greeting XML for reuse.
 * Caller is responsible for calling sendLogout() and socket.close().
 */
async function openEPPSession(config: EPPConfig, objURIs?: string[]): Promise<{
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  socket: ReturnType<typeof connect>;
  greeting: string;
}> {
  const socket = connect(`${config.host}:${config.port}`, { secureTransport: 'on', allowHalfOpen: false });
  try {
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    // RFC 5730 Section 2.4: Server sends greeting upon connection
    const greeting = await readEPPFrame(reader);

    if (config.clid && config.pw) {
      const loginXml = buildLoginXml(config.clid, config.pw, objURIs);
      await writer.write(encodeEPPFrame(loginXml));
      const loginResp = await readEPPFrame(reader);
      const loginResult = parseEPPResponse(loginResp);
      if (loginResult.code !== 1000) {
        throw new Error(`Login failed (code ${loginResult.code}): ${loginResult.message}`);
      }
    }

    return { reader, writer, socket, greeting };
  } catch (err) {
    try { await socket.close(); } catch { /* ignored */ }
    throw err;
  }
}

/**
 * Gracefully close an EPP session: logout then close socket.
 */
async function closeEPPSession(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  socket: ReturnType<typeof connect>,
): Promise<void> {
  try {
    await sendLogout(writer, reader);
  } finally {
    try { reader.releaseLock(); } catch { /* ignored */ }
    try { writer.releaseLock(); } catch { /* ignored */ }
    try { await socket.close(); } catch { /* ignored */ }
  }
}

// ---------------------------------------------------------------------------
// Public API: standalone functions
// ---------------------------------------------------------------------------

/**
 * EPP Connection Test - Connect, read greeting, send hello, read greeting again.
 *
 * RFC 5730 Section 2.4: The server sends a <greeting> when the connection is
 * established. A client may send <hello/> at any time; the server responds
 * with another <greeting>.
 *
 * Note: The response to <hello/> is a <greeting>, NOT a command response.
 * There is no <result> element in a greeting, so we check for <greeting>
 * presence instead of parsing a result code.
 */
export async function eppConnect(config: EPPConfig): Promise<EPPResponse> {
  const socket = connect(`${config.host}:${config.port}`, { secureTransport: 'on', allowHalfOpen: false });

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  try {
    // Read initial server greeting
    const greeting = await readEPPFrame(reader);

    // Send hello command to request a fresh greeting
    const helloCmd = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <hello/>
</epp>`;

    await writer.write(encodeEPPFrame(helloCmd));

    // Read hello response (which is a <greeting>, not a command response)
    const helloResponse = await readEPPFrame(reader);

    // A greeting has no result code; success = we got a valid greeting back
    const gotGreeting = isGreeting(helloResponse);

    return {
      success: gotGreeting,
      message: gotGreeting ? 'EPP server greeting received' : 'Unexpected response to hello',
      xml: helloResponse,
      data: {
        greeting: greeting.substring(0, 500),
        serverResponse: helloResponse.substring(0, 500),
      },
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: `EPP connection failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    try { reader.releaseLock(); } catch { /* ignored */ }
    try { writer.releaseLock(); } catch { /* ignored */ }
    try { await socket.close(); } catch { /* ignored */ }
  }
}

/**
 * EPP Login - Authenticate with client ID and password.
 *
 * RFC 5730 Section 2.9.1.1: The login command establishes a session.
 * After login, the client has authenticated access until logout.
 */
export async function eppLogin(config: EPPConfig): Promise<EPPResponse> {
  if (!config.clid || !config.pw) {
    return {
      success: false,
      message: 'Client ID and password are required for login',
    };
  }

  let session: Awaited<ReturnType<typeof openEPPSession>> | null = null;
  try {
    session = await openEPPSession(config);

    // Login succeeded (openEPPSession throws on failure)
    await closeEPPSession(session.reader, session.writer, session.socket);

    return {
      success: true,
      message: 'Command completed successfully',
      code: 1000,
      data: {
        greeting: session.greeting.substring(0, 300),
      },
    };
  } catch (error: unknown) {
    if (session) {
      try { await closeEPPSession(session.reader, session.writer, session.socket); } catch { /* ignored */ }
    }
    return {
      success: false,
      message: `EPP login failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * EPP Domain Check - Check if a domain is available.
 *
 * RFC 5731 Section 3.1.1: The <check> command determines whether a domain
 * object can be provisioned. The response includes an "avail" attribute
 * (1 = available, 0 = not available).
 */
export async function eppDomainCheck(config: EPPConfig, domain: string): Promise<EPPResponse> {
  if (!config.clid || !config.pw) {
    return {
      success: false,
      message: 'Client ID and password are required',
    };
  }

  if (!domain || !domain.includes('.')) {
    return {
      success: false,
      message: 'Invalid domain name',
    };
  }

  let session: Awaited<ReturnType<typeof openEPPSession>> | null = null;
  try {
    session = await openEPPSession(config, ['urn:ietf:params:xml:ns:domain-1.0']);
    const { reader, writer, socket } = session;

    // Send domain check command
    const checkCmd = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <check>
      <domain:check xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${escapeXml(domain)}</domain:name>
      </domain:check>
    </check>
    <clTRID>${clTRID('check')}</clTRID>
  </command>
</epp>`;

    await writer.write(encodeEPPFrame(checkCmd));
    const checkResponse = await readEPPFrame(reader);
    const result = parseEPPResponse(checkResponse);

    // Parse availability from response
    const availMatch = checkResponse.match(/avail\s*=\s*["']([01])["']/);
    const available = availMatch ? availMatch[1] === '1' : null;

    await closeEPPSession(reader, writer, socket);

    return {
      success: result.code === 1000,
      message: result.message,
      code: result.code,
      xml: checkResponse,
      data: {
        domain,
        available,
        response: checkResponse.substring(0, 500),
      },
    };
  } catch (error: unknown) {
    if (session) {
      try { await closeEPPSession(session.reader, session.writer, session.socket); } catch { /* ignored */ }
    }
    return {
      success: false,
      message: `EPP domain check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

/**
 * HTTP handler for EPP domain info (login + domain:info).
 *
 * POST /api/epp/domain-info
 * Body: { host, port?, clid, pw, domain }
 *
 * RFC 5731 Section 3.1.2: The <info> command retrieves information about
 * a domain object including registrant, nameservers, dates, and status.
 */
export async function handleEPPDomainInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const body = await request.json() as { host: string; port?: number; clid?: string; pw?: string; domain: string };
    if (!body.host || !body.domain) {
      return new Response(JSON.stringify({ success: false, error: 'host and domain are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const config: EPPConfig = { host: body.host, port: body.port ?? 700, clid: body.clid, pw: body.pw };
    const session = await openEPPSession(config, ['urn:ietf:params:xml:ns:domain-1.0']);
    const { reader, writer, socket } = session;

    try {
      // Domain info command
      const infoCmd = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info>
      <domain:info xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name hosts="all">${escapeXml(body.domain)}</domain:name>
      </domain:info>
    </info>
    <clTRID>${clTRID('info')}</clTRID>
  </command>
</epp>`;
      await writer.write(encodeEPPFrame(infoCmd));
      const infoResp = await readEPPFrame(reader);
      const infoParsed = parseEPPResponse(infoResp);

      await closeEPPSession(reader, writer, socket);

      // Extract key fields from XML
      const extract = (xml: string, tag: string) => {
        const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
        return m ? m[1] : undefined;
      };
      const extractAll = (xml: string, tag: string) => {
        const matches = [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g'))];
        return matches.map(m => m[1]);
      };

      return new Response(JSON.stringify({
        success: infoParsed.code === 1000,
        domain: body.domain,
        code: infoParsed.code,
        message: infoParsed.message,
        registrant: extract(infoResp, 'domain:registrant'),
        crDate: extract(infoResp, 'domain:crDate'),
        upDate: extract(infoResp, 'domain:upDate'),
        exDate: extract(infoResp, 'domain:exDate'),
        status: extractAll(infoResp, 'domain:status'),
        nameservers: extractAll(infoResp, 'domain:hostObj'),
        raw: infoResp.substring(0, 2000),
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      try { await closeEPPSession(reader, writer, socket); } catch { /* ignored */ }
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'EPP domain info failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * HTTP handler for EPP domain create.
 *
 * POST /api/epp/domain-create
 * Body: { host, port?, clid, pw, domain, period?, nameservers?, registrant?, password? }
 *
 * RFC 5731 Section 3.2.1: The <create> command creates a domain object.
 * Success codes: 1000 (created) or 1001 (pending approval).
 */
export async function handleEPPDomainCreate(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const body = await request.json() as {
      host: string; port?: number; clid?: string; pw?: string;
      domain: string; period?: number; nameservers?: string[];
      registrant?: string; password?: string;
    };
    if (!body.host || !body.domain) {
      return new Response(JSON.stringify({ success: false, error: 'host and domain are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const config: EPPConfig = { host: body.host, port: body.port ?? 700, clid: body.clid, pw: body.pw };
    const period = body.period ?? 1;
    const ns = (body.nameservers ?? []).slice(0, 13); // RFC 5731: max 13 nameservers
    const registrant = body.registrant ?? 'REGISTRANT';
    const authPw = body.password ?? 'authInfo2023!';

    const nsXml = ns.map(n => `<domain:hostObj>${escapeXml(n)}</domain:hostObj>`).join('');
    const nsBlock = ns.length > 0 ? `<domain:ns>${nsXml}</domain:ns>` : '';

    const session = await openEPPSession(config, ['urn:ietf:params:xml:ns:domain-1.0']);
    const { reader, writer, socket } = session;

    try {
      const createCmd = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${escapeXml(body.domain)}</domain:name>
        <domain:period unit="y">${period}</domain:period>
        ${nsBlock}
        <domain:registrant>${escapeXml(registrant)}</domain:registrant>
        <domain:authInfo>
          <domain:pw>${escapeXml(authPw)}</domain:pw>
        </domain:authInfo>
      </domain:create>
    </create>
    <clTRID>${clTRID('create')}</clTRID>
  </command>
</epp>`;
      await writer.write(encodeEPPFrame(createCmd));
      const createResp = await readEPPFrame(reader);
      const createParsed = parseEPPResponse(createResp);

      await closeEPPSession(reader, writer, socket);

      const extract = (xml: string, tag: string) => {
        const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
        return m ? m[1] : undefined;
      };

      return new Response(JSON.stringify({
        // 1000 = created, 1001 = pending approval (both are success)
        success: createParsed.code === 1000 || createParsed.code === 1001,
        domain: body.domain,
        code: createParsed.code,
        message: createParsed.message,
        crDate: extract(createResp, 'domain:crDate'),
        exDate: extract(createResp, 'domain:exDate'),
        raw: createResp.substring(0, 2000),
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      try { await closeEPPSession(reader, writer, socket); } catch { /* ignored */ }
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'EPP domain create failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export default {
  eppConnect,
  eppLogin,
  eppDomainCheck,
};

/**
 * EPP Domain Update -- modify nameservers, status, or auth info.
 *
 * POST /api/epp/domain-update
 * Body: { host, port?, clid, pw, domain, addNs?, remNs?, authPw? }
 *
 * RFC 5731 Section 3.2.5: The <update> command modifies a domain object.
 * It contains optional <add>, <rem>, and <chg> sub-elements.
 */
export async function handleEPPDomainUpdate(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  interface EPPUpdateRequest {
    host: string; port?: number; clid: string; pw: string;
    domain: string; addNs?: string[]; remNs?: string[]; authPw?: string;
  }

  let body: EPPUpdateRequest;
  try { body = await request.json() as EPPUpdateRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 700, clid, pw, domain, addNs = [], remNs = [], authPw } = body;
  if (!host || !clid || !pw || !domain) {
    return new Response(JSON.stringify({ success: false, error: 'host, clid, pw, and domain are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const config: EPPConfig = { host, port, clid, pw };
  try {
    const session = await openEPPSession(config, ['urn:ietf:params:xml:ns:domain-1.0']);
    const { reader, writer, socket } = session;

    try {
      // Domain Update
      const addNsXml = addNs.length > 0
        ? `<domain:add><domain:ns>${addNs.map((n) => `<domain:hostObj>${escapeXml(n)}</domain:hostObj>`).join('')}</domain:ns></domain:add>`
        : '';
      const remNsXml = remNs.length > 0
        ? `<domain:rem><domain:ns>${remNs.map((n) => `<domain:hostObj>${escapeXml(n)}</domain:hostObj>`).join('')}</domain:ns></domain:rem>`
        : '';
      const chgXml = authPw
        ? `<domain:chg><domain:authInfo><domain:pw>${escapeXml(authPw)}</domain:pw></domain:authInfo></domain:chg>`
        : '';

      const updateXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <domain:update xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${escapeXml(domain)}</domain:name>
        ${addNsXml}${remNsXml}${chgXml}
      </domain:update>
    </update>
    <clTRID>${clTRID('update')}</clTRID>
  </command>
</epp>`;
      await writer.write(encodeEPPFrame(updateXml));
      const updateResp = await readEPPFrame(reader);
      const result = parseEPPResponse(updateResp);

      await closeEPPSession(reader, writer, socket);

      return new Response(JSON.stringify({
        success: result.code >= 1000 && result.code < 2000,
        domain,
        code: result.code,
        message: result.message,
        addedNs: addNs,
        removedNs: remNs,
        raw: updateResp.substring(0, 2000),
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      try { await closeEPPSession(reader, writer, socket); } catch { /* ignored */ }
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'EPP domain update failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * EPP Domain Delete -- remove a domain registration.
 *
 * POST /api/epp/domain-delete
 * Body: { host, port?, clid, pw, domain }
 *
 * RFC 5731 Section 3.2.2: The <delete> command removes a domain object.
 * The domain must not have active child host objects.
 */
export async function handleEPPDomainDelete(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  interface EPPDeleteRequest {
    host: string; port?: number; clid: string; pw: string; domain: string;
  }

  let body: EPPDeleteRequest;
  try { body = await request.json() as EPPDeleteRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 700, clid, pw, domain } = body;
  if (!host || !clid || !pw || !domain) {
    return new Response(JSON.stringify({ success: false, error: 'host, clid, pw, and domain are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const config: EPPConfig = { host, port, clid, pw };
  try {
    const session = await openEPPSession(config, ['urn:ietf:params:xml:ns:domain-1.0']);
    const { reader, writer, socket } = session;

    try {
      const deleteXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <delete>
      <domain:delete xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${escapeXml(domain)}</domain:name>
      </domain:delete>
    </delete>
    <clTRID>${clTRID('delete')}</clTRID>
  </command>
</epp>`;
      await writer.write(encodeEPPFrame(deleteXml));
      const deleteResp = await readEPPFrame(reader);
      const result = parseEPPResponse(deleteResp);

      await closeEPPSession(reader, writer, socket);

      return new Response(JSON.stringify({
        success: result.code >= 1000 && result.code < 2000,
        domain,
        code: result.code,
        message: result.message,
        raw: deleteResp.substring(0, 2000),
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      try { await closeEPPSession(reader, writer, socket); } catch { /* ignored */ }
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'EPP domain delete failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * EPP Domain Renew -- extend a domain registration period.
 *
 * POST /api/epp/domain-renew
 * Body: { host, port?, clid, pw, domain, curExpDate, years? }
 *
 * RFC 5731 Section 3.2.3: The <renew> command extends a domain's registration
 * period. The current expiration date MUST be provided as a safety check.
 */
export async function handleEPPDomainRenew(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  interface EPPRenewRequest {
    host: string; port?: number; clid: string; pw: string;
    domain: string; curExpDate: string; years?: number;
  }

  let body: EPPRenewRequest;
  try { body = await request.json() as EPPRenewRequest; }
  catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 700, clid, pw, domain, curExpDate, years = 1 } = body;
  if (!host || !clid || !pw || !domain || !curExpDate) {
    return new Response(JSON.stringify({
      success: false, error: 'host, clid, pw, domain, and curExpDate are required',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const config: EPPConfig = { host, port, clid, pw };
  try {
    const session = await openEPPSession(config, ['urn:ietf:params:xml:ns:domain-1.0']);
    const { reader, writer, socket } = session;

    try {
      const renewXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <renew>
      <domain:renew xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${escapeXml(domain)}</domain:name>
        <domain:curExpDate>${escapeXml(curExpDate)}</domain:curExpDate>
        <domain:period unit="y">${years}</domain:period>
      </domain:renew>
    </renew>
    <clTRID>${clTRID('renew')}</clTRID>
  </command>
</epp>`;
      await writer.write(encodeEPPFrame(renewXml));
      const renewResp = await readEPPFrame(reader);
      const result = parseEPPResponse(renewResp);

      // Extract new expiry date
      const newExpDate = renewResp.match(/<domain:exDate>([^<]+)<\/domain:exDate>/)?.[1];

      await closeEPPSession(reader, writer, socket);

      return new Response(JSON.stringify({
        success: result.code >= 1000 && result.code < 2000,
        domain,
        code: result.code,
        message: result.message,
        curExpDate,
        newExpDate: newExpDate ?? null,
        yearsRenewed: years,
        raw: renewResp.substring(0, 2000),
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      try { await closeEPPSession(reader, writer, socket); } catch { /* ignored */ }
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'EPP domain renew failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
