/**
 * WinRM (Windows Remote Management) Protocol Implementation
 *
 * WinRM is Microsoft's implementation of WS-Management (DMTF standard)
 * for remote management of Windows systems over HTTP/HTTPS.
 *
 * Protocol Flow:
 * 1. Client connects to WinRM HTTP port (default 5985) or HTTPS (5986)
 * 2. Client sends HTTP POST with SOAP XML envelope
 * 3. Server responds with SOAP XML containing management data
 *
 * Key Operations:
 * - WSMAN Identify    → Discover server vendor, version, protocol
 * - Enumerate shells  → List available shell types
 * - Auth detection    → Detect supported authentication methods via 401 response
 *
 * Authentication: Basic, Negotiate (NTLM/Kerberos), CredSSP
 * Default Ports: 5985 (HTTP), 5986 (HTTPS)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface WinRMRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface WinRMIdentifyResponse {
  success: boolean;
  rtt?: number;
  server?: string;
  isWinRM?: boolean;
  productVendor?: string;
  productVersion?: string;
  protocolVersion?: string;
  securityProfiles?: string[];
  authMethods?: string[];
  statusCode?: number;
  error?: string;
  isCloudflare?: boolean;
}

/**
 * Send a raw HTTP/1.1 request over a TCP socket
 */
async function sendHttpRequest(
  host: string,
  port: number,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();

  let request = `${method} ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;

  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      request += `${key}: ${value}\r\n`;
    }
  }

  if (body) {
    const bodyBytes = encoder.encode(body);
    request += `Content-Type: application/soap+xml;charset=UTF-8\r\n`;
    request += `Content-Length: ${bodyBytes.length}\r\n`;
    request += `\r\n`;
    await writer.write(encoder.encode(request));
    await writer.write(bodyBytes);
  } else {
    request += `\r\n`;
    await writer.write(encoder.encode(request));
  }

  writer.releaseLock();

  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let response = '';
  const maxSize = 512000;

  while (response.length < maxSize) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done) break;
    if (value) {
      response += decoder.decode(value, { stream: true });
    }
  }

  reader.releaseLock();
  socket.close();

  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    throw new Error('Invalid HTTP response: no header terminator found');
  }

  const headerSection = response.substring(0, headerEnd);
  let bodySection = response.substring(headerEnd + 4);

  const statusLine = headerSection.split('\r\n')[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

  const respHeaders: Record<string, string> = {};
  const headerLines = headerSection.split('\r\n').slice(1);
  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      respHeaders[key] = value;
    }
  }

  if (respHeaders['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }

  return { statusCode, headers: respHeaders, body: bodySection };
}

/**
 * Decode chunked transfer encoding
 */
function decodeChunked(data: string): string {
  let result = '';
  let remaining = data;

  while (remaining.length > 0) {
    const lineEnd = remaining.indexOf('\r\n');
    if (lineEnd === -1) break;

    const sizeStr = remaining.substring(0, lineEnd).trim();
    const chunkSize = parseInt(sizeStr, 16);
    if (isNaN(chunkSize) || chunkSize === 0) break;

    const chunkStart = lineEnd + 2;
    result += remaining.substring(chunkStart, chunkStart + chunkSize);
    remaining = remaining.substring(chunkStart + chunkSize + 2);
  }

  return result;
}

/**
 * Build WSMAN Identify SOAP envelope
 */
function buildIdentifyEnvelope(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsmid="http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd">
  <s:Header/>
  <s:Body>
    <wsmid:Identify/>
  </s:Body>
</s:Envelope>`;
}

/**
 * Extract text content from an XML tag (simple regex-based parser)
 */
function extractXmlValue(xml: string, tagName: string): string | undefined {
  // Handle namespaced tags like wsmid:ProductVendor
  const patterns = [
    new RegExp(`<(?:[\\w-]+:)?${tagName}[^>]*>([^<]+)</(?:[\\w-]+:)?${tagName}>`, 'i'),
    new RegExp(`<${tagName}[^>]*>([^<]+)</${tagName}>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
}

/**
 * Extract all values from repeating XML tags
 */
function extractXmlValues(xml: string, tagName: string): string[] {
  const results: string[] = [];
  const pattern = new RegExp(`<(?:[\\w-]+:)?${tagName}[^>]*>([^<]+)</(?:[\\w-]+:)?${tagName}>`, 'gi');
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

/**
 * Parse authentication methods from WWW-Authenticate headers
 */
function parseAuthMethods(headerValue: string): string[] {
  const methods: string[] = [];
  const parts = headerValue.split(',').map(s => s.trim());

  for (const part of parts) {
    const method = part.split(/\s/)[0].trim();
    if (method && !methods.includes(method)) {
      methods.push(method);
    }
  }

  return methods;
}

/**
 * Handle WinRM Identify probe
 * POST /api/winrm/identify
 */
export async function handleWinRMIdentify(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: WinRMRequest;
  try {
    body = await request.json() as WinRMRequest;
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 5985, timeout = 10000 } = body;

  if (!host) {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result: WinRMIdentifyResponse = { success: false };
  const startTime = Date.now();

  try {
    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Step 1: Send WSMAN Identify request (anonymous, no auth required)
    const identifyEnvelope = buildIdentifyEnvelope();

    const response = await sendHttpRequest(
      host,
      port,
      'POST',
      '/wsman-anon/identify',
      identifyEnvelope,
      {
        'Content-Type': 'application/soap+xml;charset=UTF-8',
      },
      timeout,
    );

    result.rtt = Date.now() - startTime;
    result.statusCode = response.statusCode;
    result.server = response.headers['server'] || undefined;

    if (response.statusCode === 200) {
      // Parse SOAP XML response for identity info
      const xml = response.body;
      result.productVendor = extractXmlValue(xml, 'ProductVendor');
      result.productVersion = extractXmlValue(xml, 'ProductVersion');
      result.protocolVersion = extractXmlValue(xml, 'ProtocolVersion');
      result.securityProfiles = extractXmlValues(xml, 'SecurityProfilName');

      // Also try the alternate tag name
      if (result.securityProfiles.length === 0) {
        result.securityProfiles = extractXmlValues(xml, 'SecurityProfile');
      }

      result.isWinRM = !!(result.productVendor || result.productVersion);
      result.success = true;
    } else if (response.statusCode === 401) {
      // Server requires auth - still WinRM, extract auth methods
      result.isWinRM = true;

      const wwwAuth = response.headers['www-authenticate'];
      if (wwwAuth) {
        result.authMethods = parseAuthMethods(wwwAuth);
      }

      // Try the /wsman endpoint as well
      try {
        const wsmanResponse = await sendHttpRequest(
          host,
          port,
          'POST',
          '/wsman',
          identifyEnvelope,
          {
            'Content-Type': 'application/soap+xml;charset=UTF-8',
          },
          timeout,
        );

        if (wsmanResponse.statusCode === 401) {
          const wsmanAuth = wsmanResponse.headers['www-authenticate'];
          if (wsmanAuth) {
            const additionalMethods = parseAuthMethods(wsmanAuth);
            const allMethods = [...(result.authMethods || [])];
            for (const m of additionalMethods) {
              if (!allMethods.includes(m)) {
                allMethods.push(m);
              }
            }
            result.authMethods = allMethods;
          }
        }
      } catch {
        // Ignore secondary probe failure
      }

      result.success = true;
    } else if (response.statusCode === 404) {
      // Try /wsman endpoint (some configurations only expose this)
      try {
        const wsmanResponse = await sendHttpRequest(
          host,
          port,
          'POST',
          '/wsman',
          identifyEnvelope,
          {
            'Content-Type': 'application/soap+xml;charset=UTF-8',
          },
          timeout,
        );

        result.statusCode = wsmanResponse.statusCode;

        if (wsmanResponse.statusCode === 200) {
          const xml = wsmanResponse.body;
          result.productVendor = extractXmlValue(xml, 'ProductVendor');
          result.productVersion = extractXmlValue(xml, 'ProductVersion');
          result.protocolVersion = extractXmlValue(xml, 'ProtocolVersion');
          result.securityProfiles = extractXmlValues(xml, 'SecurityProfilName');
          if (result.securityProfiles.length === 0) {
            result.securityProfiles = extractXmlValues(xml, 'SecurityProfile');
          }
          result.isWinRM = true;
          result.success = true;
        } else if (wsmanResponse.statusCode === 401) {
          result.isWinRM = true;
          const wwwAuth = wsmanResponse.headers['www-authenticate'];
          if (wwwAuth) {
            result.authMethods = parseAuthMethods(wwwAuth);
          }
          result.success = true;
        } else {
          result.isWinRM = false;
          result.error = `HTTP ${wsmanResponse.statusCode}: Not a WinRM endpoint`;
        }
      } catch {
        result.isWinRM = false;
        result.error = `HTTP ${response.statusCode}: Not a WinRM endpoint`;
      }
    } else {
      result.isWinRM = false;
      result.error = `HTTP ${response.statusCode}: Unexpected response`;
    }
  } catch (err) {
    result.rtt = Date.now() - startTime;
    result.error = err instanceof Error ? err.message : 'Connection failed';
  }

  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : result.statusCode === 400 ? 400 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Generate a simple UUID v4 for WSMan MessageID headers
 */
function generateUuid(): string {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${(Math.floor(Math.random() * 4) + 8).toString(16)}${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

/**
 * Build a WSMan Create Shell SOAP envelope
 */
function buildCreateShellEnvelope(host: string, port: number, uuid: string): string {
  return `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:wsmid="http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd" xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell" xmlns:cfg="http://schemas.microsoft.com/wbem/wsman/1/config">
  <s:Header>
    <wsa:To>http://${host}:${port}/wsman</wsa:To>
    <wsman:ResourceURI>http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action>http://schemas.xmlsoap.org/ws/2004/09/transfer/Create</wsa:Action>
    <wsman:MaxEnvelopeSize>153600</wsman:MaxEnvelopeSize>
    <wsa:MessageID>uuid:${uuid}</wsa:MessageID>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
    <wsman:OptionSet><wsman:Option Name="WINRS_NOPROFILE">TRUE</wsman:Option><wsman:Option Name="WINRS_CODEPAGE">437</wsman:Option></wsman:OptionSet>
  </s:Header>
  <s:Body><rsp:Shell><rsp:InputStreams>stdin</rsp:InputStreams><rsp:OutputStreams>stdout stderr</rsp:OutputStreams></rsp:Shell></s:Body>
</s:Envelope>`;
}

/**
 * Build a WSMan Execute Command SOAP envelope
 */
function buildCommandEnvelope(host: string, port: number, shellId: string, command: string, args: string[], uuid: string): string {
  const argsXml = args.map(a => `<rsp:Arguments>${a}</rsp:Arguments>`).join('');
  return `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <wsa:To>http://${host}:${port}/wsman</wsa:To>
    <wsman:ResourceURI>http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action>http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command</wsa:Action>
    <wsman:MaxEnvelopeSize>153600</wsman:MaxEnvelopeSize>
    <wsa:MessageID>uuid:${uuid}</wsa:MessageID>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
    <wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>
    <wsman:OptionSet><wsman:Option Name="WINRS_CONSOLEMODE_STDIN">TRUE</wsman:Option><wsman:Option Name="WINRS_SKIP_CMD_SHELL">FALSE</wsman:Option></wsman:OptionSet>
  </s:Header>
  <s:Body><rsp:CommandLine><rsp:Command>${command}</rsp:Command>${argsXml}</rsp:CommandLine></s:Body>
</s:Envelope>`;
}

/**
 * Build a WSMan Receive (read output) SOAP envelope
 */
function buildReceiveEnvelope(host: string, port: number, shellId: string, commandId: string, uuid: string): string {
  return `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <wsa:To>http://${host}:${port}/wsman</wsa:To>
    <wsman:ResourceURI>http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action>http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Receive</wsa:Action>
    <wsman:MaxEnvelopeSize>153600</wsman:MaxEnvelopeSize>
    <wsa:MessageID>uuid:${uuid}</wsa:MessageID>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
    <wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>
  </s:Header>
  <s:Body><rsp:Receive><rsp:DesiredStream CommandId="${commandId}">stdout stderr</rsp:DesiredStream></rsp:Receive></s:Body>
</s:Envelope>`;
}

/**
 * Build a WSMan Signal (terminate command) SOAP envelope
 */
function buildSignalEnvelope(host: string, port: number, shellId: string, commandId: string, uuid: string): string {
  return `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <wsa:To>http://${host}:${port}/wsman</wsa:To>
    <wsman:ResourceURI>http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action>http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Signal</wsa:Action>
    <wsman:MaxEnvelopeSize>153600</wsman:MaxEnvelopeSize>
    <wsa:MessageID>uuid:${uuid}</wsa:MessageID>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
    <wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>
  </s:Header>
  <s:Body><rsp:Signal CommandId="${commandId}"><rsp:Code>http://schemas.microsoft.com/wbem/wsman/1/windows/shell/signal/ctrl_c</rsp:Code></rsp:Signal></s:Body>
</s:Envelope>`;
}

/**
 * Build a WSMan Delete Shell SOAP envelope
 */
function buildDeleteShellEnvelope(host: string, port: number, shellId: string, uuid: string): string {
  return `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">
  <s:Header>
    <wsa:To>http://${host}:${port}/wsman</wsa:To>
    <wsman:ResourceURI>http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action>http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete</wsa:Action>
    <wsman:MaxEnvelopeSize>153600</wsman:MaxEnvelopeSize>
    <wsa:MessageID>uuid:${uuid}</wsa:MessageID>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
    <wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>
  </s:Header>
  <s:Body/>
</s:Envelope>`;
}

/**
 * Perform a WinRM HTTP request with Basic auth using fetch()
 */
async function winrmFetch(
  host: string,
  port: number,
  envelope: string,
  username: string,
  password: string,
  timeout: number,
): Promise<{ statusCode: number; body: string }> {
  const credentials = btoa(`${username}:${password}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`http://${host}:${port}/wsman`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml;charset=UTF-8',
        'Authorization': `Basic ${credentials}`,
        'User-Agent': 'PortOfCall/1.0',
      },
      body: envelope,
      signal: controller.signal,
    });

    const body = await response.text();
    return { statusCode: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decode base64 output streams from WSMan Receive response
 */
function decodeReceiveStreams(xml: string): { stdout: string; stderr: string; done: boolean; exitCode: number } {
  let stdout = '';
  let stderr = '';

  // Extract all stdout stream segments (base64 encoded)
  const stdoutPattern = /<rsp:Stream[^>]*Name="stdout"[^>]*>([^<]*)<\/rsp:Stream>/gi;
  let match: RegExpExecArray | null;
  while ((match = stdoutPattern.exec(xml)) !== null) {
    if (match[1].trim()) {
      try {
        stdout += atob(match[1].trim());
      } catch {
        stdout += match[1].trim();
      }
    }
  }

  // Extract all stderr stream segments
  const stderrPattern = /<rsp:Stream[^>]*Name="stderr"[^>]*>([^<]*)<\/rsp:Stream>/gi;
  while ((match = stderrPattern.exec(xml)) !== null) {
    if (match[1].trim()) {
      try {
        stderr += atob(match[1].trim());
      } catch {
        stderr += match[1].trim();
      }
    }
  }

  // Check for CommandState Done
  const doneMatch = xml.match(/<rsp:CommandState[^>]*State="http:\/\/schemas\.microsoft\.com\/wbem\/wsman\/1\/windows\/shell\/CommandState\/Done"/i);
  const done = !!doneMatch;

  // Parse exit code
  let exitCode = 0;
  const exitMatch = xml.match(/<rsp:ExitCode>(\d+)<\/rsp:ExitCode>/i);
  if (exitMatch) {
    exitCode = parseInt(exitMatch[1], 10);
  }

  return { stdout, stderr, done, exitCode };
}

/**
 * Handle WinRM command execution
 * POST /api/winrm/exec
 *
 * Performs a 4-step WSMan flow:
 *   1. Create shell
 *   2. Execute command
 *   3. Receive output (loop until Done)
 *   4. Signal terminate + Delete shell
 */
export async function handleWinRMExec(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: {
    host: string;
    port?: number;
    timeout?: number;
    username: string;
    password: string;
    command: string;
    args?: string[];
  };

  try {
    body = await request.json() as typeof body;
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 5985, timeout = 30000, username, password, command, args = [] } = body;

  if (!host) {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!username || !password) {
    return new Response(JSON.stringify({ success: false, error: 'Username and password are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!command) {
    return new Response(JSON.stringify({ success: false, error: 'Command is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();
  let shellId = '';
  let commandId = '';

  try {
    // Step 1: Create shell
    const createEnvelope = buildCreateShellEnvelope(host, port, generateUuid());
    const createResp = await winrmFetch(host, port, createEnvelope, username, password, timeout);

    if (createResp.statusCode === 401) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Authentication failed (401 Unauthorized)',
        statusCode: 401,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (createResp.statusCode !== 200) {
      return new Response(JSON.stringify({
        success: false,
        error: `Create shell failed with HTTP ${createResp.statusCode}`,
        statusCode: createResp.statusCode,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse ShellId from response
    const shellIdMatch = createResp.body.match(/<rsp:ShellId>([^<]+)<\/rsp:ShellId>/i);
    if (!shellIdMatch) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to parse ShellId from Create response',
        rawResponse: createResp.body.substring(0, 500),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    shellId = shellIdMatch[1].trim();

    // Step 2: Execute command
    const commandEnvelope = buildCommandEnvelope(host, port, shellId, command, args, generateUuid());
    const commandResp = await winrmFetch(host, port, commandEnvelope, username, password, timeout);

    if (commandResp.statusCode !== 200) {
      return new Response(JSON.stringify({
        success: false,
        shellId,
        error: `Command execution failed with HTTP ${commandResp.statusCode}`,
        statusCode: commandResp.statusCode,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse CommandId from response
    const cmdIdMatch = commandResp.body.match(/<rsp:CommandId>([^<]+)<\/rsp:CommandId>/i);
    if (!cmdIdMatch) {
      return new Response(JSON.stringify({
        success: false,
        shellId,
        error: 'Failed to parse CommandId from Execute response',
        rawResponse: commandResp.body.substring(0, 500),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    commandId = cmdIdMatch[1].trim();

    // Step 3: Receive output (loop until CommandState Done or timeout)
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let done = false;
    const receiveDeadline = startTime + timeout - 2000; // leave 2s for cleanup

    while (!done && Date.now() < receiveDeadline) {
      const receiveEnvelope = buildReceiveEnvelope(host, port, shellId, commandId, generateUuid());
      const receiveResp = await winrmFetch(host, port, receiveEnvelope, username, password, Math.max(5000, receiveDeadline - Date.now()));

      if (receiveResp.statusCode !== 200) {
        break;
      }

      const decoded = decodeReceiveStreams(receiveResp.body);
      stdout += decoded.stdout;
      stderr += decoded.stderr;
      exitCode = decoded.exitCode;
      done = decoded.done;
    }

    const rtt = Date.now() - startTime;

    // Step 4: Signal terminate + Delete shell (best effort, ignore errors)
    try {
      const signalEnvelope = buildSignalEnvelope(host, port, shellId, commandId, generateUuid());
      await winrmFetch(host, port, signalEnvelope, username, password, 5000);
    } catch { /* ignore */ }

    try {
      const deleteEnvelope = buildDeleteShellEnvelope(host, port, shellId, generateUuid());
      await winrmFetch(host, port, deleteEnvelope, username, password, 5000);
    } catch { /* ignore */ }

    return new Response(JSON.stringify({
      success: true,
      shellId,
      commandId,
      stdout,
      stderr,
      exitCode,
      rtt,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    // Best-effort cleanup if we have a shellId
    if (shellId) {
      try {
        if (commandId) {
          const signalEnvelope = buildSignalEnvelope(host, port, shellId, commandId, generateUuid());
          await winrmFetch(host, port, signalEnvelope, username, password, 3000);
        }
        const deleteEnvelope = buildDeleteShellEnvelope(host, port, shellId, generateUuid());
        await winrmFetch(host, port, deleteEnvelope, username, password, 3000);
      } catch { /* ignore */ }
    }

    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Command execution failed',
      rtt: Date.now() - startTime,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle WinRM auth probe (just checks auth methods without SOAP)
 * POST /api/winrm/auth
 */
export async function handleWinRMAuth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: WinRMRequest;
  try {
    body = await request.json() as WinRMRequest;
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { host, port = 5985, timeout = 10000 } = body;

  if (!host) {
    return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (port < 1 || port > 65535) {
    return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();

  try {
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Send a simple GET to /wsman to trigger 401 and see auth methods
    const response = await sendHttpRequest(
      host,
      port,
      'GET',
      '/wsman',
      undefined,
      undefined,
      timeout,
    );

    const rtt = Date.now() - startTime;
    const authMethods: string[] = [];

    if (response.headers['www-authenticate']) {
      authMethods.push(...parseAuthMethods(response.headers['www-authenticate']));
    }

    return new Response(JSON.stringify({
      success: true,
      rtt,
      statusCode: response.statusCode,
      server: response.headers['server'] || undefined,
      authMethods,
      requiresAuth: response.statusCode === 401,
      isWinRM: response.statusCode === 401 || response.statusCode === 200,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      rtt: Date.now() - startTime,
      error: err instanceof Error ? err.message : 'Connection failed',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
