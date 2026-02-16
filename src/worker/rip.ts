/**
 * RIP Protocol Implementation (RFC 2453 / RFC 1058)
 *
 * Routing Information Protocol (RIP) is a distance-vector routing protocol used
 * in local and wide area networks. RIP uses hop count as its routing metric and
 * prevents routing loops by limiting the number of hops (max 15).
 *
 * Protocol Overview:
 * - Port: 520 (UDP primarily, TCP for this implementation)
 * - Versions: RIPv1 (RFC 1058), RIPv2 (RFC 2453), RIPng (IPv6)
 * - Metric: Hop count (max 15, 16 = unreachable)
 * - Update Interval: 30 seconds
 * - Packet Format: Command (1), Version (1), Route Entries (20 bytes each)
 *
 * Message Types:
 * - Request (1): Request for routing information
 * - Response (2): Routing table update or reply to request
 *
 * RIPv1 Route Entry (20 bytes):
 * - Address Family Identifier (2): Always 2 for IP
 * - IP Address (4): Network address
 * - Metric (4): Hop count to destination
 *
 * RIPv2 Route Entry (20 bytes):
 * - Address Family Identifier (2): 2 for IP
 * - Route Tag (2): Attribute assigned to route
 * - IP Address (4): Network address
 * - Subnet Mask (4): Subnet mask for network
 * - Next Hop (4): IP address of next hop router
 * - Metric (4): Hop count (1-16)
 *
 * Special Requests:
 * - Whole Table Request: AFI=0, Metric=16
 * - Specific Network Request: AFI=2, IP Address, Metric=16
 *
 * Use Cases:
 * - Router discovery and enumeration
 * - Routing table inspection
 * - Network topology mapping
 * - Legacy network diagnostics
 * - Small network route monitoring
 */

import { connect } from 'cloudflare:sockets';

interface RIPRequest {
  host: string;
  port?: number;
  timeout?: number;
  version?: number; // 1 or 2
  networkAddress?: string; // Request specific network, or undefined for all routes
}

interface RIPRouteEntry {
  addressFamily: number;
  routeTag?: number; // RIPv2 only
  ipAddress: string;
  subnetMask?: string; // RIPv2 only
  nextHop?: string; // RIPv2 only
  metric: number;
}

interface RIPResponse {
  success: boolean;
  host: string;
  port: number;
  version?: number;
  command?: string;
  routes?: RIPRouteEntry[];
  routeCount?: number;
  rtt?: number;
  error?: string;
}

// RIP Commands
enum RIPCommand {
  Request = 1,
  Response = 2,
}

// Address Family Identifier
enum AddressFamily {
  Unspecified = 0,
  IP = 2,
}

// Maximum metric (16 = infinity/unreachable)
const RIP_INFINITY = 16;
// const RIP_MAX_ROUTES = 25; // Max routes per RIP packet

/**
 * Build RIP request message
 */
function buildRIPRequest(version: number, networkAddress?: string): Buffer {
  // RIP Header: Command (1), Version (1), Reserved (2)
  const header = Buffer.allocUnsafe(4);
  header.writeUInt8(RIPCommand.Request, 0);
  header.writeUInt8(version, 1);
  header.writeUInt16BE(0, 2); // Reserved/Must be zero

  if (networkAddress) {
    // Request specific network
    const entry = buildRIPEntry(version, AddressFamily.IP, networkAddress, '0.0.0.0', '0.0.0.0', RIP_INFINITY, 0);
    return Buffer.concat([header, entry]);
  } else {
    // Request whole routing table (special entry with AFI=0, Metric=16)
    const entry = Buffer.allocUnsafe(20);
    entry.fill(0);
    entry.writeUInt16BE(AddressFamily.Unspecified, 0); // AFI = 0
    entry.writeUInt32BE(RIP_INFINITY, 16); // Metric = 16
    return Buffer.concat([header, entry]);
  }
}

/**
 * Build RIP route entry (20 bytes)
 */
function buildRIPEntry(
  version: number,
  afi: number,
  ipAddress: string,
  subnetMask: string,
  nextHop: string,
  metric: number,
  routeTag: number
): Buffer {
  const entry = Buffer.allocUnsafe(20);

  // Address Family Identifier
  entry.writeUInt16BE(afi, 0);

  if (version === 2) {
    // RIPv2: Route Tag
    entry.writeUInt16BE(routeTag, 2);
  } else {
    // RIPv1: Reserved (must be zero)
    entry.writeUInt16BE(0, 2);
  }

  // IP Address
  const ipParts = ipAddress.split('.').map(p => parseInt(p, 10));
  entry.writeUInt8(ipParts[0] || 0, 4);
  entry.writeUInt8(ipParts[1] || 0, 5);
  entry.writeUInt8(ipParts[2] || 0, 6);
  entry.writeUInt8(ipParts[3] || 0, 7);

  if (version === 2) {
    // RIPv2: Subnet Mask
    const maskParts = subnetMask.split('.').map(p => parseInt(p, 10));
    entry.writeUInt8(maskParts[0] || 0, 8);
    entry.writeUInt8(maskParts[1] || 0, 9);
    entry.writeUInt8(maskParts[2] || 0, 10);
    entry.writeUInt8(maskParts[3] || 0, 11);

    // RIPv2: Next Hop
    const nhParts = nextHop.split('.').map(p => parseInt(p, 10));
    entry.writeUInt8(nhParts[0] || 0, 12);
    entry.writeUInt8(nhParts[1] || 0, 13);
    entry.writeUInt8(nhParts[2] || 0, 14);
    entry.writeUInt8(nhParts[3] || 0, 15);
  } else {
    // RIPv1: Reserved (must be zero)
    entry.fill(0, 8, 16);
  }

  // Metric
  entry.writeUInt32BE(metric, 16);

  return entry;
}

/**
 * Parse RIP message
 */
function parseRIPMessage(data: Buffer): {
  command: number;
  version: number;
  routes: RIPRouteEntry[];
} | null {
  if (data.length < 4) {
    return null;
  }

  const command = data.readUInt8(0);
  const version = data.readUInt8(1);

  const routes: RIPRouteEntry[] = [];
  let offset = 4;

  while (offset + 20 <= data.length) {
    const afi = data.readUInt16BE(offset);

    if (afi === AddressFamily.IP) {
      const routeTag = version === 2 ? data.readUInt16BE(offset + 2) : 0;

      const ipAddress = `${data.readUInt8(offset + 4)}.${data.readUInt8(offset + 5)}.${data.readUInt8(offset + 6)}.${data.readUInt8(offset + 7)}`;

      const subnetMask = version === 2
        ? `${data.readUInt8(offset + 8)}.${data.readUInt8(offset + 9)}.${data.readUInt8(offset + 10)}.${data.readUInt8(offset + 11)}`
        : undefined;

      const nextHop = version === 2
        ? `${data.readUInt8(offset + 12)}.${data.readUInt8(offset + 13)}.${data.readUInt8(offset + 14)}.${data.readUInt8(offset + 15)}`
        : undefined;

      const metric = data.readUInt32BE(offset + 16);

      // Only include valid routes (metric < 16 or metric = 16 for unreachable)
      if (metric <= RIP_INFINITY) {
        const route: RIPRouteEntry = {
          addressFamily: afi,
          ipAddress,
          metric,
        };

        if (version === 2) {
          route.routeTag = routeTag;
          route.subnetMask = subnetMask;
          route.nextHop = nextHop;
        }

        routes.push(route);
      }
    }

    offset += 20;
  }

  return { command, version, routes };
}

/**
 * Send RIP request to router and retrieve routing table.
 * Requests entire routing table or specific network route.
 */
export async function handleRIPRequest(request: Request): Promise<Response> {
  try {
    const body = await request.json() as RIPRequest;
    const { host, port = 520, timeout = 15000, version = 2, networkAddress } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies RIPResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Port must be between 1 and 65535',
      } satisfies RIPResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (version !== 1 && version !== 2) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'Version must be 1 or 2',
      } satisfies RIPResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Build RIP request
      const ripRequest = buildRIPRequest(version, networkAddress);

      // Send request
      const writer = socket.writable.getWriter();
      await writer.write(ripRequest);
      writer.releaseLock();

      // Read response
      const reader = socket.readable.getReader();

      const { value, done } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (done || !value) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No response from RIP router',
        } satisfies RIPResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const response = parseRIPMessage(Buffer.from(value));

      if (!response) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid RIP response format',
        } satisfies RIPResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      const commandName = response.command === RIPCommand.Response ? 'Response' : 'Request';

      if (response.command !== RIPCommand.Response) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          version: response.version,
          command: commandName,
          error: `Unexpected RIP command: ${commandName} (expected Response)`,
          rtt,
        } satisfies RIPResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        version: response.version,
        command: commandName,
        routes: response.routes,
        routeCount: response.routes.length,
        rtt,
      } satisfies RIPResponse), {
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
      host: '',
      port: 520,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies RIPResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Probe RIP router to check if it's running RIP service.
 * Sends a whole routing table request.
 */
export async function handleRIPProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as RIPRequest;
    const { host, port = 520, timeout = 10000, version = 2 } = body;

    // Request whole routing table
    const probeRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ host, port, timeout, version }),
    });

    return handleRIPRequest(probeRequest);

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
