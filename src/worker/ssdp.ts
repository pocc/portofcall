/**
 * SSDP Protocol Implementation (UPnP Device Discovery)
 *
 * Simple Service Discovery Protocol - Part of Universal Plug and Play (UPnP).
 * Used for discovering devices and services on local networks.
 *
 * Protocol Overview:
 * - Port 1900 (UDP multicast 239.255.255.250, or TCP unicast)
 * - HTTP-like text protocol
 * - M-SEARCH: Discovery request
 * - NOTIFY: Device advertisement
 * - RESPONSE: Discovery response
 *
 * Common Search Targets:
 * - ssdp:all - All devices and services
 * - upnp:rootdevice - Root devices only
 * - uuid:device-UUID - Specific device
 * - urn:schemas-upnp-org:device:deviceType:version
 * - urn:schemas-upnp-org:service:serviceType:version
 *
 * Response Headers:
 * - LOCATION: URL to device description XML
 * - ST: Search target (device/service type)
 * - USN: Unique Service Name
 * - SERVER: Server string (OS/version UPnP/version product/version)
 * - CACHE-CONTROL: max-age in seconds
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Common SSDP Search Targets
export const SSDP_SEARCH_TARGETS = {
  ALL: 'ssdp:all',
  ROOT_DEVICE: 'upnp:rootdevice',
  MEDIA_SERVER: 'urn:schemas-upnp-org:device:MediaServer:1',
  MEDIA_RENDERER: 'urn:schemas-upnp-org:device:MediaRenderer:1',
  INTERNET_GATEWAY: 'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  WAN_DEVICE: 'urn:schemas-upnp-org:device:WANDevice:1',
  WAN_CONNECTION: 'urn:schemas-upnp-org:device:WANConnectionDevice:1',
} as const;

interface SSDPRequest {
  host: string;
  port?: number;
  searchTarget?: string; // ST header
  maxWait?: number; // MX header (seconds)
  timeout?: number; // Overall timeout
}

interface SSDPDevice {
  location?: string;
  searchTarget?: string; // ST
  uniqueServiceName?: string; // USN
  server?: string;
  cacheControl?: string;
  date?: string;
  ext?: string;
  headers?: Record<string, string>;
}

// interface SSDPResponse {
//   success: boolean;
//   devices?: SSDPDevice[];
//   count?: number;
//   error?: string;
// }

/**
 * Build SSDP M-SEARCH request
 */
function buildMSearchRequest(searchTarget: string, maxWait: number, host: string): string {
  const lines = [
    'M-SEARCH * HTTP/1.1',
    `HOST: ${host}:1900`,
    'MAN: "ssdp:discover"',
    `MX: ${maxWait}`,
    `ST: ${searchTarget}`,
    'USER-AGENT: PortOfCall/1.0 UPnP/1.1',
    '',
    '',
  ];

  return lines.join('\r\n');
}

/**
 * Parse SSDP response (HTTP-like format)
 */
function parseSSDPResponse(data: string): SSDPDevice {
  const lines = data.split('\r\n');
  const headers: Record<string, string> = {};

  // Parse status line (HTTP/1.1 200 OK)
  const statusLine = lines[0];
  if (!statusLine || !statusLine.startsWith('HTTP/')) {
    throw new Error('Invalid SSDP response: missing HTTP status line');
  }

  // Parse headers
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Empty line marks end of headers

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim().toUpperCase();
    const value = line.substring(colonIndex + 1).trim();
    headers[key] = value;
  }

  return {
    location: headers['LOCATION'],
    searchTarget: headers['ST'],
    uniqueServiceName: headers['USN'],
    server: headers['SERVER'],
    cacheControl: headers['CACHE-CONTROL'],
    date: headers['DATE'],
    ext: headers['EXT'],
    headers,
  };
}

/**
 * Handle SSDP discovery request
 */
export async function handleSSDPDiscover(request: Request): Promise<Response> {
  try {
    const body = await request.json() as SSDPRequest;
    const {
      host,
      port = 1900,
      searchTarget = SSDP_SEARCH_TARGETS.ALL,
      maxWait = 3,
      timeout = 10000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (maxWait < 1 || maxWait > 120) {
      return new Response(JSON.stringify({
        success: false,
        error: 'MX (maxWait) must be between 1 and 120 seconds',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if behind Cloudflare
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

    // Build M-SEARCH request
    const searchRequest = buildMSearchRequest(searchTarget, maxWait, host);

    // Connect to SSDP server
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send M-SEARCH request
      await writer.write(new TextEncoder().encode(searchRequest));

      // Collect responses (there may be multiple devices responding)
      const devices: SSDPDevice[] = [];
      const startTime = Date.now();
      const collectionTimeout = Math.min(maxWait * 1000 + 2000, timeout);

      while (Date.now() - startTime < collectionTimeout) {
        const readTimeout = new Promise<{ value: undefined; done: true }>((resolve) => {
          setTimeout(() => resolve({ value: undefined, done: true }), 1000);
        });

        const { value: responseData, done } = await Promise.race([
          reader.read(),
          readTimeout,
        ]);

        if (done || !responseData) {
          // No more data available, but keep waiting for MX timeout
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }

        // Decode response
        const responseText = new TextDecoder().decode(responseData);

        // SSDP can send multiple responses, split by double newlines
        const responses = responseText.split('\r\n\r\n').filter(r => r.trim());

        for (const response of responses) {
          if (response.startsWith('HTTP/')) {
            try {
              const device = parseSSDPResponse(response + '\r\n\r\n');

              // Check if this device is already in the list (avoid duplicates)
              const isDuplicate = devices.some(d =>
                d.uniqueServiceName === device.uniqueServiceName &&
                d.searchTarget === device.searchTarget
              );

              if (!isDuplicate) {
                devices.push(device);
              }
            } catch (parseError) {
              // Skip malformed responses
              console.error('Failed to parse SSDP response:', parseError);
            }
          }
        }
      }

      // Cleanup
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        devices,
        count: devices.length,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle SSDP search for specific device type
 */
export async function handleSSDPSearch(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const host = url.searchParams.get('host');
    const searchTarget = url.searchParams.get('searchTarget') || SSDP_SEARCH_TARGETS.ALL;
    const port = parseInt(url.searchParams.get('port') || '1900');
    const maxWait = parseInt(url.searchParams.get('maxWait') || '3');

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host parameter required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Call discover with specific search target
    return handleSSDPDiscover(new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        port,
        searchTarget,
        maxWait,
        timeout: 15000,
      }),
    }));
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
