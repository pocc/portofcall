/**
 * Consul Protocol Implementation (HTTP API over TCP)
 *
 * Consul provides a RESTful HTTP API on port 8500 for service discovery,
 * health checking, and key-value configuration. This implementation uses
 * raw TCP sockets to construct HTTP/1.1 requests.
 *
 * Protocol Flow:
 * 1. Client connects to Consul HTTP API port (default 8500)
 * 2. Client sends HTTP/1.1 GET requests
 * 3. Server responds with JSON data
 *
 * Endpoints tested:
 * - GET /v1/agent/self         → Agent info, version, datacenter
 * - GET /v1/catalog/services   → Service catalog listing
 *
 * Docs: https://www.consul.io/api-docs
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Send a raw HTTP/1.1 GET request over a TCP socket and parse the response.
 */
async function sendHttpGet(
  host: string,
  port: number,
  path: string,
  token?: string,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();

  // Build HTTP/1.1 request
  let request = `GET ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Accept: application/json\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;

  if (token) {
    request += `X-Consul-Token: ${token}\r\n`;
  }

  request += `\r\n`;
  await writer.write(encoder.encode(request));
  writer.releaseLock();

  // Read response
  const reader = socket.readable.getReader();
  let response = '';
  const maxSize = 512000; // 512KB limit

  while (response.length < maxSize) {
    const readResult = await Promise.race([reader.read(), timeoutPromise]) as ReadableStreamReadResult<Uint8Array>;
    if (readResult.done) break;
    if (readResult.value) {
      response += decoder.decode(readResult.value, { stream: true });
    }
  }

  reader.releaseLock();
  socket.close();

  // Parse HTTP response
  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    throw new Error('Invalid HTTP response: no header terminator found');
  }

  const headerSection = response.substring(0, headerEnd);
  let bodySection = response.substring(headerEnd + 4);

  // Parse status line
  const statusLine = headerSection.split('\r\n')[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

  // Parse headers
  const headers: Record<string, string> = {};
  const headerLines = headerSection.split('\r\n').slice(1);
  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  // Handle chunked transfer encoding
  if (headers['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }

  return { statusCode, headers, body: bodySection };
}

/**
 * Decode chunked transfer encoding.
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
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > remaining.length) {
      result += remaining.substring(chunkStart);
      break;
    }

    result += remaining.substring(chunkStart, chunkEnd);
    remaining = remaining.substring(chunkEnd + 2);
  }

  return result;
}

/**
 * Handle Consul connectivity and info request.
 * POST /api/consul/health
 *
 * Connects to Consul's HTTP API and retrieves:
 * - Agent info (GET /v1/agent/self) → version, datacenter, node name
 * - Service catalog (GET /v1/catalog/services) → registered services
 */
export async function handleConsulHealth(request: Request): Promise<Response> {
  try {
    const { host, port = 8500, token, timeout = 15000 } = await request.json<{
      host: string;
      port?: number;
      token?: string;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const start = Date.now();

    // Get agent info
    const agentResult = await sendHttpGet(host, port, '/v1/agent/self', token, timeout);
    const latencyMs = Date.now() - start;

    let agentInfo;
    try {
      agentInfo = JSON.parse(agentResult.body);
    } catch {
      agentInfo = null;
    }

    // Try to get service catalog
    let services = null;
    try {
      const servicesResult = await sendHttpGet(host, port, '/v1/catalog/services', token, timeout);
      services = JSON.parse(servicesResult.body);
    } catch {
      // Service catalog might fail, that's OK
    }

    const config = agentInfo?.Config || agentInfo?.DebugConfig || {};
    const member = agentInfo?.Member || {};

    return new Response(JSON.stringify({
      success: agentResult.statusCode >= 200 && agentResult.statusCode < 400,
      host,
      port,
      statusCode: agentResult.statusCode,
      latencyMs,
      version: config.Version || 'Unknown',
      datacenter: config.Datacenter || 'Unknown',
      nodeName: config.NodeName || member.Name || 'Unknown',
      server: config.Server !== undefined ? config.Server : null,
      services: services ? Object.keys(services) : [],
      serviceCount: services ? Object.keys(services).length : 0,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
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
 * Handle Consul service listing request.
 * POST /api/consul/services
 *
 * Lists all registered services with their tags.
 */
export async function handleConsulServices(request: Request): Promise<Response> {
  try {
    const { host, port = 8500, token, timeout = 15000 } = await request.json<{
      host: string;
      port?: number;
      token?: string;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const start = Date.now();
    const result = await sendHttpGet(host, port, '/v1/catalog/services', token, timeout);
    const latencyMs = Date.now() - start;

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }

    return new Response(JSON.stringify({
      success: result.statusCode >= 200 && result.statusCode < 400,
      host,
      port,
      statusCode: result.statusCode,
      latencyMs,
      services: parsed,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
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
