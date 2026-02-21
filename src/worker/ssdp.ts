/**
 * SSDP / UPnP Protocol Implementation
 *
 * Simple Service Discovery Protocol (SSDP) is the discovery layer of UPnP.
 * Devices advertise themselves via UDP multicast (239.255.255.250:1900) and
 * respond to M-SEARCH requests.
 *
 * Because Cloudflare Workers cannot send UDP multicast, this file implements
 * UPnP discovery via two complementary strategies:
 *
 *   1. handleSSDPFetch / handleSSDPDiscover — HTTP GET to common UPnP
 *      description XML paths on the target host.  This is the most reliable
 *      approach when the device's HTTP description server is reachable.
 *
 *   2. handleSSDPSearch — TCP unicast M-SEARCH on port 1900.  Some UPnP stacks
 *      (notably Windows SSDP service) accept M-SEARCH over TCP.
 *
 * Parsed from description XML:
 *   deviceType, friendlyName, manufacturer, modelName, UDN, serviceList
 *
 * References:
 *   UPnP Device Architecture 1.1: https://openconnectivity.org/upnp-specs/
 *   RFC 2616 (HTTP/1.1), informally used by SSDP
 *
 * Endpoints:
 *   POST /api/ssdp/discover  — fetch UPnP description XML, parse device info
 *   POST /api/ssdp/fetch     — try multiple common XML paths, return first hit
 *   POST /api/ssdp/search    — TCP unicast M-SEARCH on port 1900
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SSDPDiscoverRequest {
  host: string;
  port?: number;
  timeout?: number;
  path?: string; // override description XML path
}

interface SSDPSearchRequest {
  host: string;
  port?: number;
  st?: string;   // Search Target header (default: ssdp:all)
  mx?: number;   // MX header seconds (default: 3)
  timeout?: number;
}

interface UPnPService {
  serviceType: string;
  serviceId: string;
  controlURL: string;
  eventSubURL: string;
  SCPDURL: string;
}

// ─── Common UPnP description XML paths ───────────────────────────────────────

const UPNP_DESCRIPTION_PATHS = [
  '/rootDesc.xml',
  '/description.xml',
  '/upnp/IGD.xml',
  '/gateway.xml',
  '/setup.xml',
  '/wps_info.xml',
  '/tr64desc.xml',
  '/gatedesc.xml',
  '/igd.xml',
  '/device-desc.xml',
];

// ─── XML helpers ─────────────────────────────────────────────────────────────

/**
 * Extract the text content of the first XML element matching `tag`.
 * Uses non-greedy match to handle nested elements and CDATA sections.
 */
function xmlValue(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(re)?.[1]?.trim() ?? '';
  // Strip CDATA sections if present
  return match.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/**
 * Extract all occurrences of a block delimited by `tag`.
 */
function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi');
  return xml.match(re) ?? [];
}

/**
 * Parse the <serviceList> section of a UPnP description XML.
 */
function parseServices(xml: string): UPnPService[] {
  return xmlBlocks(xml, 'service').map((block) => ({
    serviceType: xmlValue(block, 'serviceType'),
    serviceId:   xmlValue(block, 'serviceId'),
    controlURL:  xmlValue(block, 'controlURL'),
    eventSubURL: xmlValue(block, 'eventSubURL'),
    SCPDURL:     xmlValue(block, 'SCPDURL'),
  }));
}

/**
 * Parse a UPnP device description XML document.
 */
function parseDeviceDescription(xml: string, foundPath: string, latencyMs: number) {
  const deviceBlock = xmlBlocks(xml, 'device')[0] ?? xml;
  return {
    success: true,
    latencyMs,
    foundPath,
    deviceType:   xmlValue(deviceBlock, 'deviceType'),
    friendlyName: xmlValue(deviceBlock, 'friendlyName'),
    manufacturer: xmlValue(deviceBlock, 'manufacturer'),
    manufacturerURL: xmlValue(deviceBlock, 'manufacturerURL'),
    modelName:    xmlValue(deviceBlock, 'modelName'),
    modelNumber:  xmlValue(deviceBlock, 'modelNumber'),
    serialNumber: xmlValue(deviceBlock, 'serialNumber'),
    udn:          xmlValue(deviceBlock, 'UDN'),
    presentationURL: xmlValue(deviceBlock, 'presentationURL'),
    services:     parseServices(xml),
  };
}

// ─── Cloudflare guard ─────────────────────────────────────────────────────────

async function guardCloudflare(host: string): Promise<Response | null> {
  const cfCheck = await checkIfCloudflare(host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return new Response(JSON.stringify({
      success: false,
      error: getCloudflareErrorMessage(host, cfCheck.ip),
      isCloudflare: true,
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  return null;
}

function badRequest(error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(error: unknown): Response {
  return new Response(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}

// ─── POST /api/ssdp/discover ──────────────────────────────────────────────────

/**
 * Fetch the UPnP device description XML from a specific path (or the default
 * /rootDesc.xml) and parse it for device information.
 *
 * Request body: { host, port=1900, path?, timeout=10000 }
 * If port is 1900 (SSDP), the HTTP description is typically on port 1900 or
 * a port extracted from the LOCATION header — try both 1900 and 49152.
 */
export async function handleSSDPDiscover(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as SSDPDiscoverRequest;
    const { host, port = 1900, timeout = 10000 } = body;
    const descPath = body.path ?? '/rootDesc.xml';

    if (!host) return badRequest('Host is required');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const guard = await guardCloudflare(host);
    if (guard) return guard;

    const startTime = Date.now();
    const url = `http://${host}:${port}${descPath}`;

    try {
      const res = await Promise.race([
        fetch(url, { headers: { 'User-Agent': 'PortOfCall/1.0' } }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Fetch timeout')), timeout)),
      ]);

      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        return jsonResponse({
          success: false,
          latencyMs,
          httpStatus: res.status,
          error: `HTTP ${res.status} ${res.statusText}`,
          path: descPath,
        });
      }

      const xml = await res.text();

      if (!xml.trim().startsWith('<') && !xml.includes('<root')) {
        return jsonResponse({
          success: false,
          latencyMs,
          error: 'Response does not appear to be XML',
          path: descPath,
        });
      }

      return jsonResponse(parseDeviceDescription(xml, descPath, latencyMs));
    } catch (fetchErr) {
      return jsonResponse({
        success: false,
        latencyMs: Date.now() - startTime,
        error: fetchErr instanceof Error ? fetchErr.message : 'Fetch failed',
        path: descPath,
      });
    }
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── POST /api/ssdp/fetch ─────────────────────────────────────────────────────

/**
 * Try multiple common UPnP description XML paths and return the first
 * successful parse.  Useful when you don't know which path the device uses.
 *
 * Request body: { host, port=1900, timeout=10000 }
 * Return: parsed device info + foundPath, or list of tried paths on failure
 */
export async function handleSSDPFetch(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as SSDPDiscoverRequest;
    const { host, port = 1900, timeout = 15000 } = body;

    if (!host) return badRequest('Host is required');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const guard = await guardCloudflare(host);
    if (guard) return guard;

    const startTime = Date.now();
    const perPathTimeout = Math.floor(timeout / UPNP_DESCRIPTION_PATHS.length);
    const tried: string[] = [];

    for (const path of UPNP_DESCRIPTION_PATHS) {
      if (Date.now() - startTime >= timeout) break;

      const url = `http://${host}:${port}${path}`;
      tried.push(path);

      try {
        const remaining = Math.max(timeout - (Date.now() - startTime), 1000);
        const res = await Promise.race([
          fetch(url, { headers: { 'User-Agent': 'PortOfCall/1.0' } }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), Math.min(perPathTimeout, remaining))),
        ]);

        if (!res.ok) continue;
        const xml = await res.text();
        if (!xml.includes('<device') && !xml.includes('<root')) continue;

        return jsonResponse(parseDeviceDescription(xml, path, Date.now() - startTime));
      } catch {
        // try next path
      }
    }

    return jsonResponse({
      success: false,
      latencyMs: Date.now() - startTime,
      error: 'No UPnP description found at any known path',
      triedPaths: tried,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── POST /api/ssdp/subscribe ────────────────────────────────────────────────

interface SSDPSubscribeRequest {
  host: string;
  port?: number;
  eventSubURL: string; // e.g. "/eventSub" from service description
  callbackURL?: string; // where to receive events (default: http://127.0.0.1:1901/)
  timeoutSecs?: number; // subscription timeout in seconds (default: 1800)
  httpTimeout?: number; // HTTP request timeout ms (default: 8000)
}

/**
 * Subscribe to UPnP GENA events from a device service.
 *
 * GENA (General Event Notification Architecture) is the eventing layer of UPnP.
 * This sends an HTTP SUBSCRIBE request to the device's eventSubURL and returns
 * the assigned subscription ID (SID).  The actual event delivery to the callback
 * URL will not work (Workers can't listen), but establishing the subscription
 * tests reachability and confirms the device supports eventing.
 *
 * To renew: send another SUBSCRIBE with SID header (no CALLBACK/NT).
 * To cancel: send UNSUBSCRIBE with SID header.
 *
 * Request body: { host, port=1900, eventSubURL, callbackURL?, timeoutSecs?, httpTimeout? }
 */
export async function handleSSDPSubscribe(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as SSDPSubscribeRequest;
    const {
      host,
      port = 1900,
      eventSubURL,
      callbackURL = 'http://127.0.0.1:1901/',
      timeoutSecs = 1800,
      httpTimeout = 8000,
    } = body;

    if (!host) return badRequest('Host is required');
    if (!eventSubURL) return badRequest('eventSubURL is required');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const guard = await guardCloudflare(host);
    if (guard) return guard;

    const startTime = Date.now();

    const subscribeRequest = [
      `SUBSCRIBE ${eventSubURL} HTTP/1.1`,
      `HOST: ${host}:${port}`,
      `CALLBACK: <${callbackURL}>`,
      `NT: upnp:event`,
      `TIMEOUT: Second-${timeoutSecs}`,
      `Connection: close`,
      `User-Agent: PortOfCall/1.0`,
      '',
      '',
    ].join('\r\n');

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        await writer.write(new TextEncoder().encode(subscribeRequest));

        // Read response
        let buf = '';
        const dec = new TextDecoder();
        const deadline = Date.now() + httpTimeout;
        while (Date.now() < deadline) {
          const rem = deadline - Date.now();
          const timer = new Promise<{ value: undefined; done: true }>((r) =>
            setTimeout(() => r({ value: undefined, done: true as const }), rem)
          );
          const { value, done } = await Promise.race([reader.read(), timer]);
          if (done || !value) break;
          buf += dec.decode(value, { stream: true });
          if (buf.includes('\r\n\r\n')) break;
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const latencyMs = Date.now() - startTime;

        if (!buf) return { success: false, latencyMs, error: 'No response received' };

        // Parse HTTP status and headers
        const lines = buf.split('\r\n');
        const statusLine = lines[0] ?? '';
        const statusCode = parseInt(statusLine.match(/\s(\d{3})\s/)?.[1] ?? '0', 10);

        const headers: Record<string, string> = {};
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) break;
          const colon = lines[i].indexOf(':');
          if (colon < 0) continue;
          headers[lines[i].slice(0, colon).trim().toLowerCase()] = lines[i].slice(colon + 1).trim();
        }

        const sid = headers['sid'];
        const serverTimeout = headers['timeout'];
        const accepted = statusCode === 200;

        return {
          success: accepted,
          latencyMs,
          statusCode,
          statusLine,
          ...(sid ? { sid, timeoutHeader: serverTimeout } : {}),
          ...(accepted
            ? { note: 'Subscription established. Events will be sent to callbackURL (not receivable in Workers).' }
            : { error: `SUBSCRIBE rejected: ${statusLine}` }),
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    return jsonResponse(await Promise.race([
      work,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), httpTimeout)),
    ]));
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── POST /api/ssdp/action ────────────────────────────────────────────────────

interface SSDPActionRequest {
  host: string;
  port?: number;
  controlURL: string; // e.g. "/ctl/IPConn" from service description
  serviceType: string; // e.g. "urn:schemas-upnp-org:service:WANIPConnection:1"
  action: string; // e.g. "GetExternalIPAddress"
  args?: Record<string, string>; // action arguments
  httpTimeout?: number;
}

/**
 * Invoke a UPnP SOAP action on a device service.
 *
 * UPnP control uses SOAP (Simple Object Access Protocol) over HTTP POST to the
 * service's controlURL.  Common actions include GetExternalIPAddress (IGD),
 * SetVolume (AV), and GetSystemUpdateID (content directory).
 *
 * Request body: { host, port, controlURL, serviceType, action, args?, httpTimeout? }
 */
export async function handleSSDPAction(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as SSDPActionRequest;
    const {
      host,
      port = 1900,
      controlURL,
      serviceType,
      action,
      args = {},
      httpTimeout = 8000,
    } = body;

    if (!host) return badRequest('Host is required');
    if (!controlURL) return badRequest('controlURL is required');
    if (!serviceType) return badRequest('serviceType is required');
    if (!action) return badRequest('action is required');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');

    const guard = await guardCloudflare(host);
    if (guard) return guard;

    // Build SOAP body
    const argXml = Object.entries(args)
      .map(([k, v]) => `<${k}>${v}</${k}>`)
      .join('');

    const soapBody = `<?xml version="1.0" encoding="utf-8"?>\r\n` +
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">\r\n` +
      `  <s:Body>\r\n` +
      `    <u:${action} xmlns:u="${serviceType}">${argXml}</u:${action}>\r\n` +
      `  </s:Body>\r\n` +
      `</s:Envelope>`;

    const soapBytes = new TextEncoder().encode(soapBody);

    const httpRequest = [
      `POST ${controlURL} HTTP/1.1`,
      `HOST: ${host}:${port}`,
      `Content-Type: text/xml; charset="utf-8"`,
      `SOAPAction: "${serviceType}#${action}"`,
      `Content-Length: ${soapBytes.length}`,
      `Connection: close`,
      `User-Agent: PortOfCall/1.0`,
      '',
      '',
    ].join('\r\n');

    const startTime = Date.now();

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        const header = new TextEncoder().encode(httpRequest);
        const fullRequest = new Uint8Array(header.length + soapBytes.length);
        fullRequest.set(header, 0);
        fullRequest.set(soapBytes, header.length);
        await writer.write(fullRequest);

        // Read response
        const chunks: string[] = [];
        const dec = new TextDecoder();
        const deadline = Date.now() + httpTimeout;
        while (Date.now() < deadline) {
          const rem = deadline - Date.now();
          const timer = new Promise<{ value: undefined; done: true }>((r) =>
            setTimeout(() => r({ value: undefined, done: true as const }), rem)
          );
          const { value, done } = await Promise.race([reader.read(), timer]);
          if (done || !value) break;
          chunks.push(dec.decode(value, { stream: true }));
          const full = chunks.join('');
          if (full.includes('</s:Envelope>') || full.includes('</SOAP-ENV:Envelope>')) break;
          if (full.includes('\r\n\r\n') && !full.includes('Content-Length')) break;
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const response = chunks.join('');
        const latencyMs = Date.now() - startTime;

        if (!response) return { success: false, latencyMs, error: 'No response received' };

        const statusCode = parseInt(response.match(/HTTP\/[\d.]+ (\d+)/)?.[1] ?? '0', 10);
        const bodyStart = response.indexOf('\r\n\r\n');
        const responseBody = bodyStart >= 0 ? response.slice(bodyStart + 4).trim() : '';

        // Extract response args from SOAP body
        const responseArgs: Record<string, string> = {};
        const argMatches = responseBody.matchAll(/<([A-Za-z][A-Za-z0-9_]*)>([^<]*)<\/[A-Za-z][A-Za-z0-9_]*>/g);
        for (const m of argMatches) {
          const tag = m[1];
          if (!['Envelope', 'Body', 'Fault', 'faultcode', 'faultstring', 'detail'].includes(tag)) {
            responseArgs[tag] = m[2];
          }
        }

        // Check for SOAP fault
        const faultCode = responseBody.match(/<faultcode[^>]*>([^<]+)<\/faultcode>/i)?.[1];
        const faultString = responseBody.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/i)?.[1];

        return {
          success: statusCode === 200 && !faultCode,
          latencyMs,
          statusCode,
          action,
          serviceType,
          ...(Object.keys(responseArgs).length > 0 ? { responseArgs } : {}),
          ...(faultCode ? { fault: { code: faultCode, message: faultString } } : {}),
          ...(statusCode !== 200 ? { error: `HTTP ${statusCode}` } : {}),
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    return jsonResponse(await Promise.race([
      work,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), httpTimeout)),
    ]));
  } catch (error) {
    return errorResponse(error);
  }
}

// ─── POST /api/ssdp/search ────────────────────────────────────────────────────

/**
 * Send an HTTP M-SEARCH request over TCP to port 1900.
 * Some UPnP stacks (e.g. Windows) respond to M-SEARCH over TCP unicast.
 *
 * Request body: { host, port=1900, st='ssdp:all', mx=3, timeout=5000 }
 * Return: { success, location?, server?, usn?, st?, latencyMs }
 */
export async function handleSSDPSearch(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await request.json() as SSDPSearchRequest;
    const { host, port = 1900, st = 'ssdp:all', mx = 3, timeout = 5000 } = body;

    if (!host) return badRequest('Host is required');
    if (port < 1 || port > 65535) return badRequest('Port must be between 1 and 65535');
    if (mx < 1 || mx > 120) return badRequest('MX must be between 1 and 120');

    const guard = await guardCloudflare(host);
    if (guard) return guard;

    const startTime = Date.now();

    // Per UPnP spec, HOST header MUST be multicast address even for unicast M-SEARCH
    const msearch = [
      'M-SEARCH * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'MAN: "ssdp:discover"',
      `MX: ${mx}`,
      `ST: ${st}`,
      'USER-AGENT: PortOfCall/1.0 UPnP/1.1',
      '',
      '',
    ].join('\r\n');

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        await writer.write(new TextEncoder().encode(msearch));

        // Read response — allow up to 2 seconds after the MX window
        const readDeadline = Math.min(mx * 1000 + 2000, timeout);
        let buf = '';
        const dec = new TextDecoder();
        const deadline = Date.now() + readDeadline;

        while (Date.now() < deadline) {
          const remaining = Math.max(deadline - Date.now(), 0);
          const timer = new Promise<{ value: undefined; done: true }>((resolve) =>
            setTimeout(() => resolve({ value: undefined, done: true }), remaining),
          );
          const { value, done } = await Promise.race([reader.read(), timer]);
          if (done || !value) break;
          buf += dec.decode(value, { stream: true });
          if (buf.includes('\r\n\r\n')) break;
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const latencyMs = Date.now() - startTime;

        if (!buf) {
          return { success: false, latencyMs, error: 'No response received' };
        }

        // Parse HTTP response headers
        const headers: Record<string, string> = {};
        const lines = buf.split('\r\n');
        const statusLine = lines[0] ?? '';
        const statusCode = parseInt(statusLine.match(/HTTP\/[\d.]+ (\d+)/)?.[1] ?? '0', 10);
        const isOk = statusCode === 200;

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) break;
          const colonIdx = line.indexOf(':');
          if (colonIdx < 0) continue;
          const key = line.slice(0, colonIdx).trim().toLowerCase();
          const val = line.slice(colonIdx + 1).trim();
          headers[key] = val;
        }

        return {
          success: isOk,
          latencyMs,
          statusLine,
          location: headers['location'],
          server: headers['server'],
          usn: headers['usn'],
          st: headers['st'],
          cacheControl: headers['cache-control'],
          date: headers['date'],
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([
      work,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), timeout)),
    ]);

    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
