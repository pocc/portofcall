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

export default {
  eppConnect,
  eppLogin,
  eppDomainCheck,
};
