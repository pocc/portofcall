import { connect } from 'cloudflare:sockets';

/**
 * Send HTTP GET request over raw TCP socket
 */
async function sendHttpGet(socket: Socket, hostname: string, path: string): Promise<string> {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  try {
    // Send HTTP/1.1 GET request
    const request = [
      `GET ${path} HTTP/1.1`,
      `Host: ${hostname}`,
      'Connection: close',
      'User-Agent: PortOfCall/1.0',
      '',
      ''
    ].join('\r\n');

    await writer.write(new TextEncoder().encode(request));

    // Read response
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const maxBytes = 5 * 1024 * 1024; // 5MB limit

    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalBytes += value.length;
      }
    }

    const responseBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      responseBytes.set(chunk, offset);
      offset += chunk.length;
    }

    const responseText = new TextDecoder().decode(responseBytes);

    // Parse HTTP response - handle both chunked and content-length
    const headerEndIndex = responseText.indexOf('\r\n\r\n');
    if (headerEndIndex === -1) {
      return responseText;
    }

    const headers = responseText.substring(0, headerEndIndex);
    let body = responseText.substring(headerEndIndex + 4);

    // Check if chunked transfer encoding
    if (headers.toLowerCase().includes('transfer-encoding: chunked')) {
      const chunks: string[] = [];
      let pos = 0;

      while (pos < body.length) {
        const chunkSizeEnd = body.indexOf('\r\n', pos);
        if (chunkSizeEnd === -1) break;

        const chunkSizeHex = body.substring(pos, chunkSizeEnd).trim();
        const chunkSize = parseInt(chunkSizeHex, 16);

        if (chunkSize === 0 || isNaN(chunkSize)) break;

        const chunkStart = chunkSizeEnd + 2;
        const chunkEnd = chunkStart + chunkSize;
        chunks.push(body.substring(chunkStart, chunkEnd));

        pos = chunkEnd + 2; // Skip trailing \r\n
      }

      body = chunks.join('');
    }

    return headers + '\r\n\r\n' + body;
  } finally {
    writer.releaseLock();
    reader.releaseLock();
  }
}

/**
 * Check Grafana health and get server info
 */
export async function handleGrafanaHealth(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const hostname = url.searchParams.get('hostname');
  const port = parseInt(url.searchParams.get('port') || '3000', 10);

  if (!hostname) {
    return new Response(JSON.stringify({ error: 'Missing hostname parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let socket: Socket | null = null;

  try {
    socket = connect({ hostname, port });

    // Check /api/health endpoint
    const healthResponse = await sendHttpGet(socket, hostname, '/api/health');

    // Parse response
    const bodyStart = healthResponse.indexOf('\r\n\r\n');
    const body = bodyStart !== -1 ? healthResponse.substring(bodyStart + 4) : healthResponse;

    let healthData = {};
    try {
      healthData = JSON.parse(body);
    } catch {
      // If not JSON, parse as text
      healthData = { raw: body };
    }

    // Close and reconnect for /api/frontend/settings
    socket.close();
    socket = connect({ hostname, port });

    const settingsResponse = await sendHttpGet(socket, hostname, '/api/frontend/settings');
    const settingsBodyStart = settingsResponse.indexOf('\r\n\r\n');
    const settingsBody = settingsBodyStart !== -1 ? settingsResponse.substring(settingsBodyStart + 4) : settingsResponse;

    let settingsData = {};
    try {
      settingsData = JSON.parse(settingsBody);
    } catch {
      settingsData = { raw: settingsBody };
    }

    return new Response(JSON.stringify({
      success: true,
      health: healthData,
      settings: settingsData,
      endpoint: `${hostname}:${port}`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      details: 'Failed to connect to Grafana server'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    if (socket) {
      try {
        socket.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * List Grafana datasources
 */
export async function handleGrafanaDatasources(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const hostname = url.searchParams.get('hostname');
  const port = parseInt(url.searchParams.get('port') || '3000', 10);

  if (!hostname) {
    return new Response(JSON.stringify({ error: 'Missing hostname parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let socket: Socket | null = null;

  try {
    socket = connect({ hostname, port });

    // Query /api/datasources endpoint
    const response = await sendHttpGet(socket, hostname, '/api/datasources');

    // Parse response
    const bodyStart = response.indexOf('\r\n\r\n');
    const body = bodyStart !== -1 ? response.substring(bodyStart + 4) : response;

    let datasources = [];
    try {
      datasources = JSON.parse(body);
    } catch {
      // If not JSON, return raw response
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to parse datasources response',
        raw: body.substring(0, 1000)
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      datasources,
      count: Array.isArray(datasources) ? datasources.length : 0,
      endpoint: `${hostname}:${port}`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      details: 'Failed to fetch datasources from Grafana'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    if (socket) {
      try {
        socket.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Search Grafana dashboards
 */
export async function handleGrafanaDashboards(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const hostname = url.searchParams.get('hostname');
  const port = parseInt(url.searchParams.get('port') || '3000', 10);
  const query = url.searchParams.get('query') || '';
  const limit = url.searchParams.get('limit') || '50';

  if (!hostname) {
    return new Response(JSON.stringify({ error: 'Missing hostname parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let socket: Socket | null = null;

  try {
    socket = connect({ hostname, port });

    // Search dashboards via /api/search endpoint
    const searchPath = `/api/search?query=${encodeURIComponent(query)}&limit=${limit}&type=dash-db`;
    const response = await sendHttpGet(socket, hostname, searchPath);

    // Parse response
    const bodyStart = response.indexOf('\r\n\r\n');
    const body = bodyStart !== -1 ? response.substring(bodyStart + 4) : response;

    let dashboards = [];
    try {
      dashboards = JSON.parse(body);
    } catch {
      // If not JSON, return raw response
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to parse dashboards response',
        raw: body.substring(0, 1000)
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      dashboards,
      count: Array.isArray(dashboards) ? dashboards.length : 0,
      query,
      endpoint: `${hostname}:${port}`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      details: 'Failed to search dashboards in Grafana'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    if (socket) {
      try {
        socket.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}
