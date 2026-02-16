/**
 * HTTP Proxy Protocol Implementation (Port 3128/8080/8888)
 *
 * HTTP forward proxy and CONNECT tunnel testing. Implements the proxy
 * methods from RFC 7231/9110 and the CONNECT method from RFC 9110 §9.3.6.
 *
 * Two modes:
 * 1. Forward Proxy (GET/HEAD): Send an absolute-URI request through the proxy
 *    GET http://example.com/ HTTP/1.1
 *
 * 2. CONNECT Tunnel: Request a TCP tunnel through the proxy
 *    CONNECT example.com:443 HTTP/1.1
 *
 * This complements SOCKS4/SOCKS5 proxy testing with HTTP-layer proxy support.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface HTTPProxyRequest {
  host: string;
  port?: number;
  targetUrl?: string;
  targetHost?: string;
  targetPort?: number;
  method?: string;
  proxyAuth?: string;
  timeout?: number;
}

/**
 * Parse an HTTP response from raw bytes
 */
function parseHTTPResponse(data: string): {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
} {
  const headerEnd = data.indexOf('\r\n\r\n');
  const headerSection = headerEnd >= 0 ? data.substring(0, headerEnd) : data;
  const body = headerEnd >= 0 ? data.substring(headerEnd + 4) : '';

  const lines = headerSection.split('\r\n');
  const statusLine = lines[0] || '';
  const statusMatch = statusLine.match(/^HTTP\/[\d.]+ (\d+)\s*(.*)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
  const statusText = statusMatch ? statusMatch[2] : statusLine;

  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const colonIdx = lines[i].indexOf(':');
    if (colonIdx > 0) {
      const key = lines[i].substring(0, colonIdx).trim().toLowerCase();
      const value = lines[i].substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  return { statusCode, statusText, headers, body };
}

/**
 * Test HTTP proxy with a forward proxy request (GET http://...)
 */
export async function handleHTTPProxyProbe(request: Request): Promise<Response> {
  try {
    let options: Partial<HTTPProxyRequest>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<HTTPProxyRequest>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '3128'),
        targetUrl: url.searchParams.get('targetUrl') || 'http://example.com/',
        timeout: parseInt(url.searchParams.get('timeout') || '10000'),
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
    const port = options.port || 3128;
    const targetUrl = options.targetUrl || 'http://example.com/';
    const proxyAuth = options.proxyAuth || '';
    const timeoutMs = options.timeout || 10000;

    // Check Cloudflare
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

    // Parse the target URL to get the Host header
    let targetHost = 'example.com';
    try {
      const parsedUrl = new URL(targetUrl);
      targetHost = parsedUrl.host;
    } catch {
      // Use default
    }

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      try {
        // Build forward proxy HTTP request
        let httpRequest = `GET ${targetUrl} HTTP/1.1\r\n`;
        httpRequest += `Host: ${targetHost}\r\n`;
        httpRequest += `User-Agent: PortOfCall/1.0 (Proxy Probe)\r\n`;
        httpRequest += `Accept: */*\r\n`;
        httpRequest += `Connection: close\r\n`;
        if (proxyAuth) {
          const encoded = btoa(proxyAuth);
          httpRequest += `Proxy-Authorization: Basic ${encoded}\r\n`;
        }
        httpRequest += `\r\n`;

        await writer.write(encoder.encode(httpRequest));

        // Read response
        let responseData = '';
        const readTimeout = new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), 5000)
        );

        for (let i = 0; i < 20; i++) {
          const result = await Promise.race([reader.read(), readTimeout]);
          if (result.done || !result.value) break;
          responseData += decoder.decode(result.value);
          // Stop if we have enough response headers
          if (responseData.includes('\r\n\r\n') && responseData.length > 500) break;
        }

        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        if (!responseData) {
          throw new Error('No response received from proxy');
        }

        const parsed = parseHTTPResponse(responseData);

        // Detect proxy type from headers
        const proxyHeaders: string[] = [];
        const viaHeader = parsed.headers['via'];
        const proxyAgentHeader = parsed.headers['proxy-agent'];
        const serverHeader = parsed.headers['server'];

        if (viaHeader) proxyHeaders.push(`Via: ${viaHeader}`);
        if (proxyAgentHeader) proxyHeaders.push(`Proxy-Agent: ${proxyAgentHeader}`);

        let proxyType = 'Unknown';
        const allHeaders = JSON.stringify(parsed.headers).toLowerCase();
        if (allHeaders.includes('squid')) proxyType = 'Squid';
        else if (allHeaders.includes('nginx')) proxyType = 'Nginx';
        else if (allHeaders.includes('apache')) proxyType = 'Apache';
        else if (allHeaders.includes('haproxy')) proxyType = 'HAProxy';
        else if (allHeaders.includes('varnish')) proxyType = 'Varnish';
        else if (allHeaders.includes('tinyproxy')) proxyType = 'Tinyproxy';
        else if (allHeaders.includes('privoxy')) proxyType = 'Privoxy';
        else if (allHeaders.includes('ccproxy')) proxyType = 'CCProxy';
        else if (proxyHeaders.length > 0) proxyType = 'HTTP Proxy (detected via headers)';

        const isProxy = parsed.statusCode === 200 ||
          parsed.statusCode === 407 ||
          proxyHeaders.length > 0;

        const requiresAuth = parsed.statusCode === 407;
        const authMethod = parsed.headers['proxy-authenticate'] || '';

        return {
          success: true,
          host,
          port,
          protocol: 'HTTP Proxy',
          rtt,
          isProxy,
          proxyType,
          requiresAuth,
          authMethod: authMethod || undefined,
          statusCode: parsed.statusCode,
          statusText: parsed.statusText,
          targetUrl,
          proxyHeaders: proxyHeaders.length > 0 ? proxyHeaders : undefined,
          server: serverHeader || undefined,
          note: isProxy
            ? `HTTP proxy detected on ${host}:${port}. ${requiresAuth ? 'Proxy requires authentication (' + authMethod + ').' : 'Proxy forwarded the request successfully.'}`
            : `No HTTP proxy behavior detected on ${host}:${port}. Server responded with ${parsed.statusCode} ${parsed.statusText}.`,
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection timeout',
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

/**
 * Test HTTP CONNECT tunnel through a proxy
 */
export async function handleHTTPProxyConnect(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        error: 'POST method required for CONNECT tunnel test',
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = await request.json() as Partial<HTTPProxyRequest>;

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
    const port = options.port || 3128;
    const targetHost = options.targetHost || 'example.com';
    const targetPort = options.targetPort || 443;
    const proxyAuth = options.proxyAuth || '';
    const timeoutMs = options.timeout || 10000;

    // Check Cloudflare
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
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      try {
        // Build CONNECT request
        let connectRequest = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n`;
        connectRequest += `Host: ${targetHost}:${targetPort}\r\n`;
        connectRequest += `User-Agent: PortOfCall/1.0\r\n`;
        if (proxyAuth) {
          const encoded = btoa(proxyAuth);
          connectRequest += `Proxy-Authorization: Basic ${encoded}\r\n`;
        }
        connectRequest += `\r\n`;

        await writer.write(encoder.encode(connectRequest));

        // Read response
        let responseData = '';
        const readTimeout = new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), 5000)
        );

        for (let i = 0; i < 10; i++) {
          const result = await Promise.race([reader.read(), readTimeout]);
          if (result.done || !result.value) break;
          responseData += decoder.decode(result.value);
          if (responseData.includes('\r\n\r\n')) break;
        }

        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        if (!responseData) {
          throw new Error('No response received from proxy');
        }

        const parsed = parseHTTPResponse(responseData);

        const tunnelEstablished = parsed.statusCode === 200;
        const requiresAuth = parsed.statusCode === 407;

        return {
          success: true,
          host,
          port,
          protocol: 'HTTP Proxy (CONNECT)',
          rtt,
          tunnelEstablished,
          requiresAuth,
          statusCode: parsed.statusCode,
          statusText: parsed.statusText,
          target: `${targetHost}:${targetPort}`,
          authMethod: parsed.headers['proxy-authenticate'] || undefined,
          note: tunnelEstablished
            ? `CONNECT tunnel to ${targetHost}:${targetPort} established through ${host}:${port}. The proxy supports HTTP tunneling.`
            : requiresAuth
              ? `Proxy ${host}:${port} requires authentication for CONNECT tunneling.`
              : `CONNECT request to ${targetHost}:${targetPort} failed with ${parsed.statusCode} ${parsed.statusText}.`,
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection timeout',
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
