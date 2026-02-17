/**
 * EPP (Extensible Provisioning Protocol) - RFCs 5730-5734
 * Port: 700 (TCP)
 * Protocol: XML-based with length-prefixed framing (4-byte big-endian header)
 *
 * EPP is used for domain registration provisioning between registrars and registries.
 * Commands: hello, login, check, info, create, renew, transfer, update, delete
 */

import { connect } from 'cloudflare:sockets';

interface EPPConfig {
  host: string;
  port: number;
  clid?: string;     // Client ID (username)
  pw?: string;       // Password
}

interface EPPResponse {
  success: boolean;
  message: string;
  code?: number;
  xml?: string;
  data?: Record<string, any>;
}

/**
 * Reads an EPP frame from the socket (4-byte length header + XML payload)
 */
async function readEPPFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  // Read 4-byte length header (network byte order / big-endian)
  const headerResult = await reader.read();
  if (headerResult.done || !headerResult.value || headerResult.value.length < 4) {
    throw new Error('Failed to read EPP frame header');
  }

  const header = headerResult.value.slice(0, 4);
  const length = new DataView(header.buffer, header.byteOffset, 4).getUint32(0, false); // big-endian

  // Length includes the 4-byte header itself
  const payloadLength = length - 4;

  if (payloadLength <= 0 || payloadLength > 1000000) {
    throw new Error(`Invalid EPP frame length: ${length}`);
  }

  // Read the XML payload
  let payload = new Uint8Array(payloadLength);
  let bytesRead = headerResult.value.length - 4;

  if (bytesRead > 0) {
    payload.set(headerResult.value.slice(4), 0);
  }

  while (bytesRead < payloadLength) {
    const result = await reader.read();
    if (result.done) {
      throw new Error('Connection closed while reading EPP frame');
    }
    const chunk = result.value!;
    const remaining = payloadLength - bytesRead;
    const toCopy = Math.min(chunk.length, remaining);
    payload.set(chunk.slice(0, toCopy), bytesRead);
    bytesRead += toCopy;
  }

  return new TextDecoder().decode(payload);
}

/**
 * Writes an EPP frame to the socket (4-byte length header + XML payload)
 */
function encodeEPPFrame(xml: string): Uint8Array {
  const payload = new TextEncoder().encode(xml);
  const length = payload.length + 4; // Include 4-byte header

  const frame = new Uint8Array(4 + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, length, false); // big-endian
  frame.set(payload, 4);

  return frame;
}

/**
 * Parses EPP XML response to extract result code and message
 */
function parseEPPResponse(xml: string): { code: number; message: string } {
  // Simple XML parsing (for basic info extraction)
  const codeMatch = xml.match(/<result code="(\d+)">/);
  const msgMatch = xml.match(/<msg[^>]*>([^<]+)<\/msg>/);

  return {
    code: codeMatch ? parseInt(codeMatch[1]) : 0,
    message: msgMatch ? msgMatch[1].trim() : 'Unknown response',
  };
}

/**
 * EPP Connection Test - Connect, read greeting, send hello command
 */
export async function eppConnect(config: EPPConfig): Promise<EPPResponse> {
  const socket = connect({
    hostname: config.host,
    port: config.port,
  });

  try {
    await socket.opened;
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    // Read server greeting
    const greeting = await readEPPFrame(reader);

    // Send hello command to get server info
    const helloCmd = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <hello/>
</epp>`;

    await writer.write(encodeEPPFrame(helloCmd));

    // Read hello response
    const helloResponse = await readEPPFrame(reader);
    const result = parseEPPResponse(helloResponse);

    await socket.close();

    return {
      success: result.code >= 1000 && result.code < 2000,
      message: result.message,
      code: result.code,
      xml: helloResponse,
      data: {
        greeting: greeting.substring(0, 500), // First 500 chars of greeting
        serverResponse: helloResponse.substring(0, 500),
      },
    };
  } catch (error: any) {
    try {
      await socket.close();
    } catch {}

    return {
      success: false,
      message: `EPP connection failed: ${error.message}`,
    };
  }
}

/**
 * EPP Login - Authenticate with client ID and password
 */
export async function eppLogin(config: EPPConfig): Promise<EPPResponse> {
  if (!config.clid || !config.pw) {
    return {
      success: false,
      message: 'Client ID and password are required for login',
    };
  }

  const socket = connect({
    hostname: config.host,
    port: config.port,
  });

  try {
    await socket.opened;
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    // Read server greeting
    const greeting = await readEPPFrame(reader);

    // Send login command
    const loginCmd = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <login>
      <clID>${escapeXml(config.clid)}</clID>
      <pw>${escapeXml(config.pw)}</pw>
      <options>
        <version>1.0</version>
        <lang>en</lang>
      </options>
      <svcs>
        <objURI>urn:ietf:params:xml:ns:domain-1.0</objURI>
        <objURI>urn:ietf:params:xml:ns:contact-1.0</objURI>
        <objURI>urn:ietf:params:xml:ns:host-1.0</objURI>
      </svcs>
    </login>
    <clTRID>cli-${Date.now()}</clTRID>
  </command>
</epp>`;

    await writer.write(encodeEPPFrame(loginCmd));

    // Read login response
    const loginResponse = await readEPPFrame(reader);
    const result = parseEPPResponse(loginResponse);

    await socket.close();

    return {
      success: result.code === 1000, // 1000 = Command completed successfully
      message: result.message,
      code: result.code,
      xml: loginResponse,
      data: {
        greeting: greeting.substring(0, 300),
        loginResponse: loginResponse.substring(0, 500),
      },
    };
  } catch (error: any) {
    try {
      await socket.close();
    } catch {}

    return {
      success: false,
      message: `EPP login failed: ${error.message}`,
    };
  }
}

/**
 * EPP Domain Check - Check if a domain is available
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

  const socket = connect({
    hostname: config.host,
    port: config.port,
  });

  try {
    await socket.opened;
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();

    // Read greeting
    await readEPPFrame(reader);

    // Login first
    const loginCmd = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <login>
      <clID>${escapeXml(config.clid)}</clID>
      <pw>${escapeXml(config.pw)}</pw>
      <options>
        <version>1.0</version>
        <lang>en</lang>
      </options>
      <svcs>
        <objURI>urn:ietf:params:xml:ns:domain-1.0</objURI>
      </svcs>
    </login>
    <clTRID>cli-${Date.now()}</clTRID>
  </command>
</epp>`;

    await writer.write(encodeEPPFrame(loginCmd));
    const loginResponse = await readEPPFrame(reader);
    const loginResult = parseEPPResponse(loginResponse);

    if (loginResult.code !== 1000) {
      await socket.close();
      return {
        success: false,
        message: `Login failed: ${loginResult.message}`,
        code: loginResult.code,
      };
    }

    // Send domain check command
    const checkCmd = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <check>
      <domain:check xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${escapeXml(domain)}</domain:name>
      </domain:check>
    </check>
    <clTRID>cli-${Date.now()}</clTRID>
  </command>
</epp>`;

    await writer.write(encodeEPPFrame(checkCmd));
    const checkResponse = await readEPPFrame(reader);
    const result = parseEPPResponse(checkResponse);

    // Parse availability from response
    const availMatch = checkResponse.match(/avail="([01])"/);
    const available = availMatch ? availMatch[1] === '1' : null;

    await socket.close();

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
  } catch (error: any) {
    try {
      await socket.close();
    } catch {}

    return {
      success: false,
      message: `EPP domain check failed: ${error.message}`,
    };
  }
}

/**
 * Escape XML special characters
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
 * HTTP handler for EPP domain info (login + domain:info)
 * POST /api/epp/domain-info
 * Body: { host, port?, clid, pw, domain }
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
    const loginResult = await eppLogin(config);
    if (!loginResult.success) {
      return new Response(JSON.stringify(loginResult), { headers: { 'Content-Type': 'application/json' } });
    }

    // EPP socket was closed by eppLogin — open a new session for info
    let socket: ReturnType<typeof connect> | null = null;
    try {
      socket = connect(`${config.host}:${config.port}`);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Read server greeting
      await readEPPFrame(reader);

      // Login
      const loginCmd = `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><login><clID>${escapeXml(config.clid ?? '')}</clID><pw>${escapeXml(config.pw ?? '')}</pw><options><version>1.0</version><lang>en</lang></options><svcs><objURI>urn:ietf:params:xml:ns:domain-1.0</objURI></svcs></login></command></epp>`;
      await writer.write(encodeEPPFrame(loginCmd));
      const loginResp = await readEPPFrame(reader);
      const loginParsed = parseEPPResponse(loginResp);
      if (loginParsed.code !== 1000) {
        throw new Error(`Login failed: ${loginParsed.message}`);
      }

      // Domain info
      const infoCmd = `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><info><domain:info xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name hosts="all">${escapeXml(body.domain)}</domain:name></domain:info></info></command></epp>`;
      await writer.write(encodeEPPFrame(infoCmd));
      const infoResp = await readEPPFrame(reader);
      const infoParsed = parseEPPResponse(infoResp);

      writer.releaseLock();
      reader.releaseLock();
      await socket.close();

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
      try { if (socket) await socket.close(); } catch {}
      throw err;
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'EPP domain info failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * HTTP handler for EPP domain create
 * POST /api/epp/domain-create
 * Body: { host, port?, clid, pw, domain, period?, nameservers?, registrant?, password? }
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
    const ns = (body.nameservers ?? []).slice(0, 13);
    const registrant = body.registrant ?? 'REGISTRANT';
    const authPw = body.password ?? 'authInfo2023!';

    const nsXml = ns.map(n => `<domain:hostObj>${escapeXml(n)}</domain:hostObj>`).join('');
    const nsBlock = ns.length > 0 ? `<domain:ns>${nsXml}</domain:ns>` : '';

    let socket: ReturnType<typeof connect> | null = null;
    try {
      socket = connect(`${config.host}:${config.port}`);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      await readEPPFrame(reader);

      const loginCmd = `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><login><clID>${escapeXml(config.clid ?? '')}</clID><pw>${escapeXml(config.pw ?? '')}</pw><options><version>1.0</version><lang>en</lang></options><svcs><objURI>urn:ietf:params:xml:ns:domain-1.0</objURI></svcs></login></command></epp>`;
      await writer.write(encodeEPPFrame(loginCmd));
      const loginResp = await readEPPFrame(reader);
      const loginParsed = parseEPPResponse(loginResp);
      if (loginParsed.code !== 1000) throw new Error(`Login failed: ${loginParsed.message}`);

      const createCmd = `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>${escapeXml(body.domain)}</domain:name><domain:period unit="y">${period}</domain:period>${nsBlock}<domain:registrant>${escapeXml(registrant)}</domain:registrant><domain:authInfo><domain:pw>${escapeXml(authPw)}</domain:pw></domain:authInfo></domain:create></create></command></epp>`;
      await writer.write(encodeEPPFrame(createCmd));
      const createResp = await readEPPFrame(reader);
      const createParsed = parseEPPResponse(createResp);

      writer.releaseLock();
      reader.releaseLock();
      await socket.close();

      const extract = (xml: string, tag: string) => {
        const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
        return m ? m[1] : undefined;
      };

      return new Response(JSON.stringify({
        success: createParsed.code === 1000,
        domain: body.domain,
        code: createParsed.code,
        message: createParsed.message,
        crDate: extract(createResp, 'domain:crDate'),
        exDate: extract(createResp, 'domain:exDate'),
        raw: createResp.substring(0, 2000),
      }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      try { if (socket) await socket.close(); } catch {}
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
 * EPP Domain Update — modify nameservers or auth info
 *
 * POST /api/epp/domain-update
 * Body: { host, port?, clid, pw, domain, addNs?, remNs?, authPw? }
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

  let socket: ReturnType<typeof connect> | null = null;
  try {
    socket = connect({ hostname: host, port });
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    try {
      // Read greeting
      await readEPPFrame(reader);

      // Login
      const loginXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <login>
      <clID>${clid}</clID>
      <pw>${pw}</pw>
      <options><version>1.0</version><lang>en</lang></options>
      <svcs><objURI>urn:ietf:params:xml:ns:domain-1.0</objURI></svcs>
    </login>
    <clTRID>POC-LOGIN-001</clTRID>
  </command>
</epp>`;
      await writer.write(encodeEPPFrame(loginXml));
      const loginResp = await readEPPFrame(reader);
      const loginResult = parseEPPResponse(loginResp);
      if (loginResult.code < 1000 || loginResult.code >= 2000) {
        return new Response(JSON.stringify({
          success: false, error: `Login failed: ${loginResult.message} (code ${loginResult.code})`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Domain Update
      const addNsXml = addNs.length > 0
        ? `<domain:add><domain:ns>${addNs.map((ns) => `<domain:hostObj>${ns}</domain:hostObj>`).join('')}</domain:ns></domain:add>`
        : '';
      const remNsXml = remNs.length > 0
        ? `<domain:rem><domain:ns>${remNs.map((ns) => `<domain:hostObj>${ns}</domain:hostObj>`).join('')}</domain:ns></domain:rem>`
        : '';
      const chgXml = authPw
        ? `<domain:chg><domain:authInfo><domain:pw>${authPw}</domain:pw></domain:authInfo></domain:chg>`
        : '';

      const updateXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <domain:update xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${domain}</domain:name>
        ${addNsXml}${remNsXml}${chgXml}
      </domain:update>
    </update>
    <clTRID>POC-UPDATE-001</clTRID>
  </command>
</epp>`;
      await writer.write(encodeEPPFrame(updateXml));
      const updateResp = await readEPPFrame(reader);
      const result = parseEPPResponse(updateResp);

      return new Response(JSON.stringify({
        success: result.code >= 1000 && result.code < 2000,
        domain,
        code: result.code,
        message: result.message,
        addedNs: addNs,
        removedNs: remNs,
        raw: updateResp.substring(0, 2000),
      }), { headers: { 'Content-Type': 'application/json' } });
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      try { if (socket) await socket.close(); } catch {}
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'EPP domain update failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * EPP Domain Delete — remove a domain registration
 *
 * POST /api/epp/domain-delete
 * Body: { host, port?, clid, pw, domain }
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

  let socket: ReturnType<typeof connect> | null = null;
  try {
    socket = connect({ hostname: host, port });
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    try {
      await readEPPFrame(reader);

      const loginXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <login>
      <clID>${clid}</clID><pw>${pw}</pw>
      <options><version>1.0</version><lang>en</lang></options>
      <svcs><objURI>urn:ietf:params:xml:ns:domain-1.0</objURI></svcs>
    </login>
    <clTRID>POC-LOGIN-002</clTRID>
  </command>
</epp>`;
      await writer.write(encodeEPPFrame(loginXml));
      const loginResp = await readEPPFrame(reader);
      const loginResult = parseEPPResponse(loginResp);
      if (loginResult.code < 1000 || loginResult.code >= 2000) {
        return new Response(JSON.stringify({
          success: false, error: `Login failed: ${loginResult.message} (code ${loginResult.code})`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const deleteXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <delete>
      <domain:delete xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${domain}</domain:name>
      </domain:delete>
    </delete>
    <clTRID>POC-DELETE-001</clTRID>
  </command>
</epp>`;
      await writer.write(encodeEPPFrame(deleteXml));
      const deleteResp = await readEPPFrame(reader);
      const result = parseEPPResponse(deleteResp);

      return new Response(JSON.stringify({
        success: result.code >= 1000 && result.code < 2000,
        domain,
        code: result.code,
        message: result.message,
        raw: deleteResp.substring(0, 2000),
      }), { headers: { 'Content-Type': 'application/json' } });
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      try { if (socket) await socket.close(); } catch {}
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'EPP domain delete failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * EPP Domain Renew — extend a domain registration period
 *
 * POST /api/epp/domain-renew
 * Body: { host, port?, clid, pw, domain, curExpDate, years? }
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

  let socket: ReturnType<typeof connect> | null = null;
  try {
    socket = connect({ hostname: host, port });
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    try {
      await readEPPFrame(reader);

      const loginXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <login>
      <clID>${clid}</clID><pw>${pw}</pw>
      <options><version>1.0</version><lang>en</lang></options>
      <svcs><objURI>urn:ietf:params:xml:ns:domain-1.0</objURI></svcs>
    </login>
    <clTRID>POC-LOGIN-003</clTRID>
  </command>
</epp>`;
      await writer.write(encodeEPPFrame(loginXml));
      const loginResp = await readEPPFrame(reader);
      const loginResult = parseEPPResponse(loginResp);
      if (loginResult.code < 1000 || loginResult.code >= 2000) {
        return new Response(JSON.stringify({
          success: false, error: `Login failed: ${loginResult.message} (code ${loginResult.code})`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const renewXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <renew>
      <domain:renew xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${domain}</domain:name>
        <domain:curExpDate>${curExpDate}</domain:curExpDate>
        <domain:period unit="y">${years}</domain:period>
      </domain:renew>
    </renew>
    <clTRID>POC-RENEW-001</clTRID>
  </command>
</epp>`;
      await writer.write(encodeEPPFrame(renewXml));
      const renewResp = await readEPPFrame(reader);
      const result = parseEPPResponse(renewResp);

      // Extract new expiry date
      const newExpDate = renewResp.match(/<domain:exDate>([^<]+)<\/domain:exDate>/)?.[1];

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
    } finally {
      reader.releaseLock();
      writer.releaseLock();
      try { if (socket) await socket.close(); } catch {}
    }
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'EPP domain renew failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
