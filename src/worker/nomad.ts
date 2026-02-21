/**
 * HashiCorp Nomad Protocol Implementation (HTTP API over TCP)
 *
 * Nomad provides a RESTful HTTP API on port 4646 for job scheduling,
 * cluster management, and workload orchestration. This implementation
 * uses raw TCP sockets to construct HTTP/1.1 requests.
 *
 * Protocol Flow:
 * 1. Client connects to Nomad HTTP API port (default 4646)
 * 2. Client sends HTTP/1.1 GET requests
 * 3. Server responds with JSON data
 *
 * Endpoints tested:
 * - GET /v1/agent/self      → Agent info, version, datacenter, region
 * - GET /v1/status/leader   → Raft leader address
 * - GET /v1/jobs             → Job listing
 * - GET /v1/nodes            → Node listing
 *
 * Authentication: Optional ACL token via X-Nomad-Token header.
 *
 * Docs: https://developer.hashicorp.com/nomad/api-docs
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Base64 encode a string with proper UTF-8 support.
 * btoa() alone fails on non-ASCII characters (code points > 255).
 */
function base64Encode(str: string): string {
  const bytes = encoder.encode(str);
  const base64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;

  for (; i < bytes.length - 2; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result += base64chars[(chunk >> 18) & 63];
    result += base64chars[(chunk >> 12) & 63];
    result += base64chars[(chunk >> 6) & 63];
    result += base64chars[chunk & 63];
  }

  if (i < bytes.length) {
    const remaining = bytes.length - i;
    const chunk = (bytes[i] << 16) | (remaining > 1 ? bytes[i + 1] << 8 : 0);
    result += base64chars[(chunk >> 18) & 63];
    result += base64chars[(chunk >> 12) & 63];
    result += remaining > 1 ? base64chars[(chunk >> 6) & 63] : '=';
    result += '=';
  }

  return result;
}

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
    request += `X-Nomad-Token: ${token}\r\n`;
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
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  // Parse headers (multi-valued headers concatenated with comma per RFC 9110 §5.3)
  const headers: Record<string, string> = {};
  const headerLines = headerSection.split('\r\n').slice(1);
  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      if (headers[key]) {
        headers[key] += ', ' + value;
      } else {
        headers[key] = value;
      }
    }
  }

  // Handle chunked transfer encoding
  if (headers['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }

  return { statusCode, headers, body: bodySection };
}

/**
 * Send a raw HTTP/1.1 POST request over a TCP socket and parse the response.
 */
async function sendHttpPost(
  host: string,
  port: number,
  path: string,
  token: string | undefined,
  bodyStr: string,
  timeout = 15000,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const socket = connect(`${host}:${port}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Connection timeout')), timeout);
  });

  await Promise.race([socket.opened, timeoutPromise]);

  const writer = socket.writable.getWriter();
  const bodyBytes = encoder.encode(bodyStr);

  let request = `POST ${path} HTTP/1.1\r\n`;
  request += `Host: ${host}:${port}\r\n`;
  request += `Accept: application/json\r\n`;
  request += `Content-Type: application/json\r\n`;
  request += `Content-Length: ${bodyBytes.length}\r\n`;
  request += `Connection: close\r\n`;
  request += `User-Agent: PortOfCall/1.0\r\n`;

  if (token) {
    request += `X-Nomad-Token: ${token}\r\n`;
  }

  request += `\r\n`;
  await writer.write(encoder.encode(request));
  await writer.write(bodyBytes);
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

  const statusLine = headerSection.split('\r\n')[0];
  const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  const headers: Record<string, string> = {};
  const headerLines = headerSection.split('\r\n').slice(1);
  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      if (headers[key]) {
        headers[key] += ', ' + value;
      } else {
        headers[key] = value;
      }
    }
  }

  if (headers['transfer-encoding']?.includes('chunked')) {
    bodySection = decodeChunked(bodySection);
  }

  return { statusCode, headers, body: bodySection };
}

/**
 * Decode chunked transfer encoding per RFC 9112 §7.1.
 * Format: chunk-size [ chunk-ext ] CRLF chunk-data CRLF
 * Handles chunk extensions and stops at zero-sized chunk.
 */
function decodeChunked(data: string): string {
  let result = '';
  let remaining = data;

  while (remaining.length > 0) {
    const lineEnd = remaining.indexOf('\r\n');
    if (lineEnd === -1) break;

    // Parse chunk size line, stripping optional chunk extensions
    // Format: 1a;name=value or just 1a
    let sizeStr = remaining.substring(0, lineEnd).trim();
    const semicolonIdx = sizeStr.indexOf(';');
    if (semicolonIdx > 0) {
      sizeStr = sizeStr.substring(0, semicolonIdx).trim();
    }

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
 * Handle Nomad health check and agent info request.
 * POST /api/nomad/health
 *
 * Connects to Nomad's HTTP API and retrieves:
 * - Agent info (GET /v1/agent/self) → version, region, datacenter, node name
 * - Leader status (GET /v1/status/leader) → Raft leader address
 */
export async function handleNomadHealth(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      token?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 4646;
    const token = body.token;
    const timeout = body.timeout || 15000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();

    // Get agent info
    const agentResult = await sendHttpGet(host, port, '/v1/agent/self', token, timeout);
    const rtt = Date.now() - startTime;

    let agentInfo: Record<string, unknown> | null = null;
    try {
      agentInfo = JSON.parse(agentResult.body);
    } catch {
      agentInfo = null;
    }

    // Get leader status
    let leader: string | null = null;
    try {
      const leaderResult = await sendHttpGet(host, port, '/v1/status/leader', token, timeout);
      leader = JSON.parse(leaderResult.body) as string;
    } catch {
      // Leader endpoint might fail, that's OK
    }

    const config = (agentInfo?.config || agentInfo?.Config) as Record<string, unknown> | undefined;
    const member = (agentInfo?.member || agentInfo?.Member) as Record<string, unknown> | undefined;
    const stats = (agentInfo?.stats || agentInfo?.Stats) as Record<string, Record<string, string>> | undefined;

    const version = config?.Version || config?.version || stats?.nomad?.version || null;
    const region = config?.Region || config?.region || null;
    const datacenter = config?.Datacenter || config?.datacenter || null;
    const nodeName = member?.Name || config?.NodeName || null;
    const isServer = config?.Server !== undefined
      ? !!(config.Server as Record<string, unknown>)?.Enabled
      : (stats?.nomad?.server === 'true' || null);

    return new Response(
      JSON.stringify({
        success: agentResult.statusCode >= 200 && agentResult.statusCode < 400,
        host,
        port,
        rtt,
        statusCode: agentResult.statusCode,
        version,
        region,
        datacenter,
        nodeName,
        server: isServer,
        leader: leader || null,
        raftPeers: stats?.raft?.num_peers || null,
        protocol: 'Nomad',
        message: `Nomad connected in ${rtt}ms`,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Nomad connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle Nomad jobs listing request.
 * POST /api/nomad/jobs
 *
 * Lists all jobs registered with the Nomad cluster.
 */
export async function handleNomadJobs(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      token?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 4646;
    const token = body.token;
    const timeout = body.timeout || 15000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const result = await sendHttpGet(host, port, '/v1/jobs', token, timeout);
    const rtt = Date.now() - startTime;

    let jobs: unknown[] = [];
    try {
      jobs = JSON.parse(result.body) as unknown[];
    } catch {
      jobs = [];
    }

    // Extract summary info from each job
    const jobSummaries = Array.isArray(jobs) ? jobs.map((job: unknown) => {
      const j = job as Record<string, unknown>;
      return {
        id: j.ID || j.id,
        name: j.Name || j.name,
        type: j.Type || j.type,
        status: j.Status || j.status,
        priority: j.Priority || j.priority,
      };
    }) : [];

    return new Response(
      JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        host,
        port,
        rtt,
        statusCode: result.statusCode,
        jobs: jobSummaries,
        jobCount: jobSummaries.length,
        message: `Found ${jobSummaries.length} job(s)`,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Nomad jobs query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle Nomad nodes listing request.
 * POST /api/nomad/nodes
 *
 * Lists all nodes in the Nomad cluster.
 */
export async function handleNomadNodes(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      token?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 4646;
    const token = body.token;
    const timeout = body.timeout || 15000;

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const result = await sendHttpGet(host, port, '/v1/nodes', token, timeout);
    const rtt = Date.now() - startTime;

    let nodes: unknown[] = [];
    try {
      nodes = JSON.parse(result.body) as unknown[];
    } catch {
      nodes = [];
    }

    // Extract summary info from each node
    const nodeSummaries = Array.isArray(nodes) ? nodes.map((node: unknown) => {
      const n = node as Record<string, unknown>;
      return {
        id: (n.ID || n.id || '') as string,
        name: n.Name || n.name,
        datacenter: n.Datacenter || n.datacenter,
        status: n.Status || n.status,
        schedulingEligibility: n.SchedulingEligibility || n.schedulingEligibility,
        nodeClass: n.NodeClass || n.nodeClass || '',
        drain: n.Drain || n.drain || false,
      };
    }) : [];

    return new Response(
      JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        host,
        port,
        rtt,
        statusCode: result.statusCode,
        nodes: nodeSummaries.map(n => ({ ...n, id: (n.id as string).substring(0, 8) + '...' })),
        nodeCount: nodeSummaries.length,
        message: `Found ${nodeSummaries.length} node(s)`,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Nomad nodes query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle Nomad allocations listing request.
 * POST /api/nomad/allocations
 *
 * Lists all allocations, or allocations for a specific job if jobId is provided.
 */
export async function handleNomadAllocations(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      token?: string;
      jobId?: string;
      namespace?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 4646;
    const token = body.token;
    const jobId = body.jobId;
    const namespace = body.namespace;
    const timeout = body.timeout || 10000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let path = jobId ? `/v1/job/${encodeURIComponent(jobId)}/allocations` : '/v1/allocations';
    if (namespace) {
      path += `?namespace=${encodeURIComponent(namespace)}`;
    }

    const startTime = Date.now();
    const result = await sendHttpGet(host, port, path, token, timeout);
    const rtt = Date.now() - startTime;

    let allocations: unknown[] = [];
    try {
      allocations = JSON.parse(result.body) as unknown[];
    } catch {
      allocations = [];
    }

    const allocationSummaries = Array.isArray(allocations) ? allocations.map((alloc: unknown) => {
      const a = alloc as Record<string, unknown>;
      return {
        id: a.ID || a.id,
        jobId: a.JobID || a.jobId,
        taskGroup: a.TaskGroup || a.taskGroup,
        clientStatus: a.ClientStatus || a.clientStatus,
        desiredStatus: a.DesiredStatus || a.desiredStatus,
        createTime: a.CreateTime || a.createTime,
        modifyTime: a.ModifyTime || a.modifyTime,
      };
    }) : [];

    return new Response(
      JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        host,
        port,
        rtt,
        allocationCount: allocationSummaries.length,
        allocations: allocationSummaries,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Nomad allocations query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle Nomad deployments listing request.
 * POST /api/nomad/deployments
 *
 * Lists all deployments, or deployments for a specific job if jobId is provided.
 */
export async function handleNomadDeployments(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      token?: string;
      jobId?: string;
      namespace?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 4646;
    const token = body.token;
    const jobId = body.jobId;
    const namespace = body.namespace;
    const timeout = body.timeout || 10000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let path = jobId ? `/v1/job/${encodeURIComponent(jobId)}/deployments` : '/v1/deployments';
    if (namespace) {
      path += `?namespace=${encodeURIComponent(namespace)}`;
    }

    const startTime = Date.now();
    const result = await sendHttpGet(host, port, path, token, timeout);
    const rtt = Date.now() - startTime;

    let deployments: unknown[] = [];
    try {
      deployments = JSON.parse(result.body) as unknown[];
    } catch {
      deployments = [];
    }

    const deploymentSummaries = Array.isArray(deployments) ? deployments.map((dep: unknown) => {
      const d = dep as Record<string, unknown>;
      return {
        id: d.ID || d.id,
        jobId: d.JobID || d.jobId,
        namespace: d.Namespace || d.namespace,
        status: d.Status || d.status,
        statusDescription: d.StatusDescription || d.statusDescription,
        taskGroups: d.TaskGroups || d.taskGroups,
      };
    }) : [];

    return new Response(
      JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        host,
        port,
        rtt,
        deploymentCount: deploymentSummaries.length,
        deployments: deploymentSummaries,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Nomad deployments query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle Nomad job dispatch request.
 * POST /api/nomad/dispatch
 *
 * Dispatches a parameterized job instance.
 */
export async function handleNomadJobDispatch(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      host?: string;
      port?: number;
      token?: string;
      jobId?: string;
      payload?: string;
      meta?: Record<string, string>;
      namespace?: string;
      timeout?: number;
    };

    if (!body.host) {
      return new Response(
        JSON.stringify({ success: false, error: 'Host is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!body.jobId) {
      return new Response(
        JSON.stringify({ success: false, error: 'jobId is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = body.host;
    const port = body.port || 4646;
    const token = body.token;
    const jobId = body.jobId;
    const timeout = body.timeout || 10000;

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let path = `/v1/job/${encodeURIComponent(jobId)}/dispatch`;
    if (body.namespace) {
      path += `?namespace=${encodeURIComponent(body.namespace)}`;
    }

    const dispatchBody: Record<string, unknown> = {};
    if (body.payload) {
      dispatchBody.Payload = base64Encode(body.payload);
    }
    if (body.meta) {
      dispatchBody.Meta = body.meta;
    }

    const startTime = Date.now();
    const result = await sendHttpPost(host, port, path, token, JSON.stringify(dispatchBody), timeout);
    const rtt = Date.now() - startTime;

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(result.body) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    return new Response(
      JSON.stringify({
        success: result.statusCode >= 200 && result.statusCode < 400,
        host,
        port,
        rtt,
        dispatchedJobId: parsed?.DispatchedJobID || parsed?.dispatchedJobId || null,
        evalId: parsed?.EvalID || parsed?.evalId || null,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Nomad job dispatch failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
