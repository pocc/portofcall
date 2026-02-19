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
import { createHash } from 'node:crypto';

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

// RouteEntry type used by handleRIPUpdate / handleRIPSend
interface RouteEntry {
  family: number;
  tag: number;
  address: string;
  mask: string;
  nextHop: string;
  metric: number;
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

/**
 * Validate IPv4 address format and octet ranges
 */
function validateIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return false;
    // Check for leading zeros (reject "192.001.002.001")
    if (part !== num.toString()) return false;
  }
  return true;
}

/**
 * Build RIP request message as a Uint8Array (avoids Node.js Buffer dependency)
 */
function buildRIPRequestBytes(version: number, networkAddress?: string): Uint8Array {
  // Header: Command(1) + Version(1) + Reserved(2) = 4 bytes
  // Entry:  20 bytes
  const total = 24;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  // Header
  buf[0] = RIPCommand.Request;
  buf[1] = version;
  view.setUint16(2, 0); // Reserved

  if (networkAddress) {
    // Request a specific route: AFI=2, IP address set, metric=16
    if (!validateIPv4(networkAddress)) {
      throw new Error(`Invalid IPv4 address: ${networkAddress}`);
    }
    const ipParts = networkAddress.split('.').map(p => parseInt(p, 10));
    view.setUint16(4, AddressFamily.IP);                   // AFI
    view.setUint16(6, 0);                                  // Route tag (v2) / reserved (v1)
    buf[8]  = ipParts[0];
    buf[9]  = ipParts[1];
    buf[10] = ipParts[2];
    buf[11] = ipParts[3];
    buf[12] = 0; buf[13] = 0; buf[14] = 0; buf[15] = 0;   // Subnet mask (zeros = v1 compat)
    buf[16] = 0; buf[17] = 0; buf[18] = 0; buf[19] = 0;   // Next hop
    view.setUint32(20, RIP_INFINITY);                      // Metric = 16
  } else {
    // Whole-table request: AFI=0, metric=16 (RFC 2453 §3.9.1)
    view.setUint16(4, AddressFamily.Unspecified);          // AFI = 0
    view.setUint16(6, 0);
    buf[8]  = 0; buf[9]  = 0; buf[10] = 0; buf[11] = 0;
    buf[12] = 0; buf[13] = 0; buf[14] = 0; buf[15] = 0;
    buf[16] = 0; buf[17] = 0; buf[18] = 0; buf[19] = 0;
    view.setUint32(20, RIP_INFINITY);
  }

  return buf;
}

/**
 * Build RIP request message (legacy Buffer-based, kept for handleRIPRequest)
 */
function buildRIPRequest(version: number, networkAddress?: string): Buffer {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt8(RIPCommand.Request, 0);
  header.writeUInt8(version, 1);
  header.writeUInt16BE(0, 2);

  if (networkAddress) {
    const entry = buildRIPEntry(version, AddressFamily.IP, networkAddress, '0.0.0.0', '0.0.0.0', RIP_INFINITY, 0);
    return Buffer.concat([header, entry]);
  } else {
    const entry = Buffer.allocUnsafe(20);
    entry.fill(0);
    entry.writeUInt16BE(AddressFamily.Unspecified, 0);
    entry.writeUInt32BE(RIP_INFINITY, 16);
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

  entry.writeUInt16BE(afi, 0);

  if (version === 2) {
    entry.writeUInt16BE(routeTag, 2);
  } else {
    entry.writeUInt16BE(0, 2);
  }

  if (!validateIPv4(ipAddress)) {
    throw new Error(`Invalid IPv4 address: ${ipAddress}`);
  }
  const ipParts = ipAddress.split('.').map(p => parseInt(p, 10));
  entry.writeUInt8(ipParts[0], 4);
  entry.writeUInt8(ipParts[1], 5);
  entry.writeUInt8(ipParts[2], 6);
  entry.writeUInt8(ipParts[3], 7);

  if (version === 2) {
    if (!validateIPv4(subnetMask)) {
      throw new Error(`Invalid subnet mask: ${subnetMask}`);
    }
    const maskParts = subnetMask.split('.').map(p => parseInt(p, 10));
    entry.writeUInt8(maskParts[0], 8);
    entry.writeUInt8(maskParts[1], 9);
    entry.writeUInt8(maskParts[2], 10);
    entry.writeUInt8(maskParts[3], 11);

    if (!validateIPv4(nextHop)) {
      throw new Error(`Invalid next hop: ${nextHop}`);
    }
    const nhParts = nextHop.split('.').map(p => parseInt(p, 10));
    entry.writeUInt8(nhParts[0], 12);
    entry.writeUInt8(nhParts[1], 13);
    entry.writeUInt8(nhParts[2], 14);
    entry.writeUInt8(nhParts[3], 15);
  } else {
    entry.fill(0, 8, 16);
  }

  entry.writeUInt32BE(metric, 16);
  return entry;
}

/**
 * Parse RIP message from raw bytes (Buffer path, used by handleRIPRequest)
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
 * Parse a RIP v2 response from a Uint8Array into RouteEntry records.
 * Returns an empty array if the packet is too short or not a Response command.
 */
function parseRIPv2Response(data: Uint8Array): RouteEntry[] {
  const routes: RouteEntry[] = [];
  if (data.length < 4) return routes;

  const command = data[0];
  const version = data[1];

  // Only parse Response packets
  if (command !== RIPCommand.Response) return routes;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 4;

  while (offset + 20 <= data.length) {
    const family = view.getUint16(offset);
    const tag    = view.getUint16(offset + 2);

    const a0 = data[offset + 4];
    const a1 = data[offset + 5];
    const a2 = data[offset + 6];
    const a3 = data[offset + 7];
    const address = `${a0}.${a1}.${a2}.${a3}`;

    const m0 = data[offset + 8];
    const m1 = data[offset + 9];
    const m2 = data[offset + 10];
    const m3 = data[offset + 11];
    const mask = version === 2
      ? `${m0}.${m1}.${m2}.${m3}`
      : '0.0.0.0';

    const n0 = data[offset + 12];
    const n1 = data[offset + 13];
    const n2 = data[offset + 14];
    const n3 = data[offset + 15];
    const nextHop = version === 2
      ? `${n0}.${n1}.${n2}.${n3}`
      : '0.0.0.0';

    const metric = view.getUint32(offset + 16);

    if (family === AddressFamily.IP && metric <= RIP_INFINITY) {
      routes.push({ family, tag, address, mask, nextHop, metric });
    }

    offset += 20;
  }

  return routes;
}

/**
 * Format a Uint8Array as a space-separated hex string
 */
function toHexString(data: Uint8Array): string {
  return Array.from(data)
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
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

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

      const ripRequest = buildRIPRequest(version, networkAddress);

      const writer = socket.writable.getWriter();
      await writer.write(ripRequest);
      writer.releaseLock();

      const reader = socket.readable.getReader();

      const readResult = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

      const { value, done } = readResult;

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
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
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

/**
 * Send a RIP v2 Request packet and attempt to read a routing table response.
 *
 * RIP uses UDP (port 520), which Cloudflare Workers' connect() does not support.
 * This function therefore uses TCP to port 520 as a best-effort probe:
 *
 *   1. Constructs a properly-formatted RIP v2 Request packet (RFC 2453 §3.9.1)
 *      with AFI=0 and Metric=16 to solicit the full routing table.
 *   2. Attempts a TCP connection to port 520.
 *   3. Sends the binary packet and tries to read a RIP v2 Response.
 *   4. If a response arrives, parses route entries and returns them.
 *   5. If the TCP connection is refused or times out, returns the packet
 *      details so the caller can see what would have been sent over UDP.
 *
 * Request body:
 *   host     — router hostname or IP (required)
 *   port     — port to probe (default: 520)
 *   version  — RIP version to use: 1 or 2 (default: 2)
 *   timeout  — connection + read timeout in ms (default: 10000)
 *
 * Response fields:
 *   success    — true if a parseable RIP Response was received
 *   version    — RIP version used (2)
 *   command    — 'request' (what we sent)
 *   routes     — parsed RouteEntry list from the response (may be empty)
 *   raw        — hex dump of the packet sent
 *   latencyMs  — elapsed ms from connect attempt to first response (or failure)
 */
export async function handleRIPUpdate(request: Request): Promise<Response> {
  let host = '';
  let port = 520;

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      version?: number;
      timeout?: number;
    };

    host = body.host ?? '';
    port = body.port ?? 520;
    const version = body.version ?? 2;
    const timeout = body.timeout ?? 10000;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (version !== 1 && version !== 2) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Version must be 1 or 2',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build the RIP v2 whole-table request packet
    const packet = buildRIPRequestBytes(version);
    const raw = toHexString(packet);

    const startTime = Date.now();

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    let routes: RouteEntry[] = [];
    let connected = false;
    let responseReceived = false;
    let connectionError: string | undefined;

    try {
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      connected = true;

      const writer = socket.writable.getWriter();
      await writer.write(packet);
      writer.releaseLock();

      const reader = socket.readable.getReader();
      try {
        timeoutHandle = setTimeout(() => {}, timeout); // Reset timeout for read
        const timeoutPromiseRead = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Read timeout')), timeout);
        });
        const result = await Promise.race([reader.read(), timeoutPromiseRead]);
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        if (!result.done && result.value && result.value.length >= 4) {
          responseReceived = true;
          routes = parseRIPv2Response(result.value);
        }
      } catch {
        // No response within timeout — normal for UDP-only routers
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      } finally {
        reader.releaseLock();
      }

      socket.close();
    } catch (err) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      connectionError = err instanceof Error ? err.message : 'Connection failed';
    }

    const latencyMs = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: responseReceived,
      version: 2,
      command: 'request',
      connected,
      responseReceived,
      routes,
      raw,
      latencyMs,
      note: connected
        ? responseReceived
          ? undefined
          : 'TCP connection succeeded but no RIP response (router may require UDP)'
        : `TCP connection to port ${port} failed — router likely requires UDP: ${connectionError ?? 'refused'}`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      host,
      port,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Send a RIPv2 authenticated route update (RFC 2082 §2 — simple password).
 *
 * RIPv2 supports an authentication entry as the first 20-byte route entry
 * when AFI=0xFFFF (65535). Type 2 = simple cleartext password (padded to 16 bytes).
 *
 * Packet layout:
 *   [Header: cmd=2, ver=2, zero(2)]       4 bytes
 *   [Auth entry: AFI=0xFFFF, type=2, pw]  20 bytes  ← authentication
 *   [Route entry: AFI=2, tag, ip, mask, nexthop, metric] 20 bytes × N
 *
 * POST /api/rip/auth-update
 * Body: { host, port?, password?, routes?: [{address, mask?, nextHop?, metric?, tag?}], timeout? }
 */
export async function handleRIPAuthUpdate(request: Request): Promise<Response> {
  let host = '';
  let port = 520;

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      password?: string;
      routes?: Array<{ address: string; mask?: string; nextHop?: string; metric?: number; tag?: number }>;
      timeout?: number;
    };

    host = body.host ?? '';
    port = body.port ?? 520;
    const password = body.password ?? 'rip';
    const timeout  = body.timeout  ?? 10000;
    const routes   = body.routes   ?? [{ address: '0.0.0.0', mask: '0.0.0.0', nextHop: '0.0.0.0', metric: 1 }];

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const enc = new TextEncoder();

    const ipBytes = (addr: string): [number, number, number, number] => {
      if (!validateIPv4(addr)) {
        throw new Error(`Invalid IPv4 address: ${addr}`);
      }
      const p = addr.split('.').map(Number);
      return [p[0], p[1], p[2], p[3]];
    };

    const routeCount = routes.length;
    // Header(4) + Auth(20) + routes(20 each)
    const totalBytes = 4 + 20 + routeCount * 20;
    const pkt = new Uint8Array(totalBytes);
    const dview = new DataView(pkt.buffer);

    // Header
    pkt[0] = RIPCommand.Response;
    pkt[1] = 2; // version=2
    dview.setUint16(2, 0);

    // Authentication entry (bytes 4..23): AFI=0xFFFF, type=2, 16-byte password
    dview.setUint16(4,  0xFFFF); // AFI
    dview.setUint16(6,  2);      // Auth type: simple password
    const pwBytes = enc.encode(password.slice(0, 16));
    pkt.set(pwBytes, 8); // bytes 8..23

    // Route entries
    for (let i = 0; i < routeCount; i++) {
      const r = routes[i];
      const base = 24 + i * 20;
      dview.setUint16(base,      AddressFamily.IP);
      dview.setUint16(base + 2,  r.tag ?? 0);
      const [a0, a1, a2, a3] = ipBytes(r.address);
      pkt[base + 4] = a0; pkt[base + 5] = a1; pkt[base + 6] = a2; pkt[base + 7] = a3;
      const [m0, m1, m2, m3] = ipBytes(r.mask ?? '255.255.255.0');
      pkt[base + 8] = m0; pkt[base + 9] = m1; pkt[base + 10] = m2; pkt[base + 11] = m3;
      const [n0, n1, n2, n3] = ipBytes(r.nextHop ?? '0.0.0.0');
      pkt[base + 12] = n0; pkt[base + 13] = n1; pkt[base + 14] = n2; pkt[base + 15] = n3;
      dview.setUint32(base + 16, Math.min(r.metric ?? 1, RIP_INFINITY));
    }

    const raw = toHexString(pkt);
    const startTime = Date.now();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    let connected = false;
    let responseReceived = false;
    let responseRoutes: RouteEntry[] = [];
    let connectionError: string | undefined;

    try {
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      connected = true;

      const writer = socket.writable.getWriter();
      await writer.write(pkt);
      writer.releaseLock();

      const reader = socket.readable.getReader();
      try {
        const timeoutPromiseRead = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Read timeout')), timeout);
        });
        const result = await Promise.race([reader.read(), timeoutPromiseRead]);
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        if (!result.done && result.value && result.value.length >= 4) {
          responseReceived = true;
          responseRoutes = parseRIPv2Response(result.value);
        }
      } catch {
        // No response — expected for UDP-only routers
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      } finally {
        reader.releaseLock();
      }
      socket.close();
    } catch (err) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      connectionError = err instanceof Error ? err.message : 'Connection failed';
    }

    const latencyMs = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: responseReceived,
      version: 2,
      command: 'response',
      authType: 'simple-password (RFC 2082 §2)',
      passwordLength: Math.min(password.length, 16),
      routeCount,
      connected,
      responseReceived,
      routes: responseRoutes,
      raw,
      latencyMs,
      note: connected
        ? responseReceived
          ? 'Router accepted the RIPv2 authenticated update and responded.'
          : 'TCP connected; no RIPv2 response (router may require UDP, or auth was rejected).'
        : `TCP connection to port ${port} failed — router likely requires UDP: ${connectionError ?? 'refused'}.`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      host,
      port,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Send a RIP v1 Request packet (for legacy router compatibility).
 *
 * Identical flow to handleRIPUpdate but uses RIP version 1 (RFC 1058).
 * RIPv1 route entries omit subnet mask, next-hop, and route tag fields.
 *
 * Request body:
 *   host     — router hostname or IP (required)
 *   port     — port to probe (default: 520)
 *   timeout  — connection + read timeout in ms (default: 10000)
 *
 * Response fields: same as handleRIPUpdate with version=1
 */
export async function handleRIPSend(request: Request): Promise<Response> {
  let host = '';
  let port = 520;

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    host = body.host ?? '';
    port = body.port ?? 520;
    const timeout = body.timeout ?? 10000;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build a RIP v1 whole-table request packet
    const packet = buildRIPRequestBytes(1);
    const raw = toHexString(packet);

    const startTime = Date.now();

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    let routes: RouteEntry[] = [];
    let connected = false;
    let responseReceived = false;
    let connectionError: string | undefined;

    try {
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      connected = true;

      const writer = socket.writable.getWriter();
      await writer.write(packet);
      writer.releaseLock();

      const reader = socket.readable.getReader();
      try {
        const timeoutPromiseRead = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Read timeout')), timeout);
        });
        const result = await Promise.race([reader.read(), timeoutPromiseRead]);
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        if (!result.done && result.value && result.value.length >= 4) {
          responseReceived = true;
          // Parse as v2 for max field extraction; v1 fields will show zeros for mask/nextHop
          routes = parseRIPv2Response(result.value);
        }
      } catch {
        // No response — router likely UDP-only
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      } finally {
        reader.releaseLock();
      }

      socket.close();
    } catch (err) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      connectionError = err instanceof Error ? err.message : 'Connection failed';
    }

    const latencyMs = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: responseReceived,
      version: 1,
      command: 'request',
      connected,
      responseReceived,
      routes,
      raw,
      latencyMs,
      note: connected
        ? responseReceived
          ? undefined
          : 'TCP connection succeeded but no RIP response (router may require UDP)'
        : `TCP connection to port ${port} failed — router likely requires UDP: ${connectionError ?? 'refused'}`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      host,
      port,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Send a RIPv2 Keyed MD5 authenticated route update (RFC 2082 §4).
 *
 * RFC 2082 §4 defines a stronger authentication scheme than simple password.
 * Instead of embedding the password in plaintext, the password is used as a
 * key for an MD5 digest computed over the entire RIP packet.
 *
 * Packet layout:
 *   [Header: cmd=2, ver=2, zero(2)]                                4 bytes
 *   [Auth entry: AFI=0xFFFF, type=3, pktlen, keyId, dataLen, seq] 20 bytes
 *   [Route entries: AFI=2, tag, ip, mask, nexthop, metric]        N × 20 bytes
 *   [Trailing auth data: AFI=0xFFFF, 0x0001, MD5[16]]            20 bytes
 *
 * Auth entry fields (starting at offset 4):
 *   AFI         = 0xFFFF (2 bytes)
 *   Auth type   = 3 = Keyed MD5 (2 bytes)
 *   Packet len  = offset from RIP header to start of trailing entry (2 bytes)
 *   Key ID      = which key slot to use, 1-255 (1 byte)
 *   Data len    = length of auth data = 16 for MD5 (1 byte)
 *   Seq number  = anti-replay counter, monotonically increasing (4 bytes)
 *   Reserved    = 0x00000000 (4 bytes)
 *
 * MD5 computation (RFC 2082 §4.1):
 *   1. Build packet with trailing auth entry's auth data field = zeros (16 bytes)
 *   2. Pad key to 16 bytes
 *   3. Digest = MD5(key[16] || packet[...] || key[16])
 *   4. Insert digest into trailing auth entry bytes 4..19
 *
 * POST /api/rip/md5-update
 * Body: {
 *   host, port?, password?, keyId?, sequenceNumber?,
 *   routes?: [{address, mask?, nextHop?, metric?, tag?}],
 *   timeout?
 * }
 */
export async function handleRIPMD5Update(request: Request): Promise<Response> {
  let host = '';
  let port = 520;

  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      password?: string;
      keyId?: number;
      sequenceNumber?: number;
      routes?: Array<{ address: string; mask?: string; nextHop?: string; metric?: number; tag?: number }>;
      timeout?: number;
    };

    host = body.host ?? '';
    port = body.port ?? 520;
    const password       = body.password       ?? 'rip';
    const keyId          = body.keyId          ?? 1;
    const sequenceNumber = body.sequenceNumber ?? Math.floor(Date.now() / 1000); // Unix timestamp as default seq
    const timeout        = body.timeout        ?? 10000;
    const routes         = body.routes         ?? [{ address: '0.0.0.0', mask: '0.0.0.0', nextHop: '0.0.0.0', metric: 1 }];

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Clamp keyId to valid range per RFC 2082 (1-255, 0 is reserved)
    const keyIdClamped = Math.max(1, Math.min(255, keyId));

    const ipBytes = (addr: string): [number, number, number, number] => {
      if (!validateIPv4(addr)) {
        throw new Error(`Invalid IPv4 address: ${addr}`);
      }
      const p = addr.split('.').map(Number);
      return [p[0], p[1], p[2], p[3]];
    };

    const routeCount = routes.length;

    // Packet size:
    //   Header(4) + Auth entry(20) + routes(N*20) + Trailing auth(20)
    const packetLen  = 4 + 20 + routeCount * 20; // excludes trailing auth entry per RFC 2082
    const totalBytes = packetLen + 20;            // including trailing auth entry
    const pkt = new Uint8Array(totalBytes);
    const dv  = new DataView(pkt.buffer);

    // ── Header ───────────────────────────────────────────────────────────────
    pkt[0] = RIPCommand.Response;
    pkt[1] = 2; // RIPv2
    dv.setUint16(2, 0);

    // ── Auth entry (bytes 4..23) ─────────────────────────────────────────────
    dv.setUint16(4,  0xFFFF);         // AFI = 0xFFFF (auth entry marker)
    dv.setUint16(6,  3);              // Auth type = 3 = Keyed MD5
    dv.setUint16(8,  packetLen);      // Packet length (up to but not including trailing auth)
    pkt[10] = keyIdClamped;           // Key ID
    pkt[11] = 16;                     // Auth data length = 16 bytes (MD5 digest size)
    dv.setUint32(12, sequenceNumber); // Sequence number (anti-replay)
    dv.setUint32(16, 0);              // Reserved

    // ── Route entries (bytes 24..24+N*20-1) ─────────────────────────────────
    for (let i = 0; i < routeCount; i++) {
      const r    = routes[i];
      const base = 24 + i * 20;
      dv.setUint16(base,      AddressFamily.IP);
      dv.setUint16(base + 2,  r.tag ?? 0);
      const [a0, a1, a2, a3] = ipBytes(r.address);
      pkt[base + 4] = a0; pkt[base + 5] = a1; pkt[base + 6] = a2; pkt[base + 7] = a3;
      const [m0, m1, m2, m3] = ipBytes(r.mask ?? '255.255.255.0');
      pkt[base + 8] = m0; pkt[base + 9] = m1; pkt[base + 10] = m2; pkt[base + 11] = m3;
      const [n0, n1, n2, n3] = ipBytes(r.nextHop ?? '0.0.0.0');
      pkt[base + 12] = n0; pkt[base + 13] = n1; pkt[base + 14] = n2; pkt[base + 15] = n3;
      dv.setUint32(base + 16, Math.min(r.metric ?? 1, RIP_INFINITY));
    }

    // ── Trailing auth data entry (bytes packetLen..packetLen+19) ────────────
    // AFI=0xFFFF, subtype=0x0001, then 16 bytes of auth data (initially zeros)
    const trailBase = packetLen;
    dv.setUint16(trailBase,     0xFFFF);
    dv.setUint16(trailBase + 2, 0x0001);
    // bytes trailBase+4 through trailBase+19 remain zero (Uint8Array is zero-initialized)

    // ── Compute MD5 digest: MD5(key || packet || key) ────────────────────────
    // Pad or truncate password to exactly 16 bytes
    const enc   = new TextEncoder();
    const pwRaw = enc.encode(password);
    const key16 = new Uint8Array(16);
    key16.set(pwRaw.slice(0, 16));

    const digest = createHash('md5')
      .update(key16)
      .update(pkt)    // full packet including trailing entry (auth data = zeros)
      .update(key16)
      .digest();

    // Insert digest into trailing auth entry at offset 4
    pkt.set(new Uint8Array(digest.buffer, digest.byteOffset, digest.byteLength), trailBase + 4);

    const raw = toHexString(pkt);

    // ── Wire up TCP connection and send ─────────────────────────────────────
    const startTime = Date.now();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    let connected = false;
    let responseReceived = false;
    let responseRoutes: RouteEntry[] = [];
    let connectionError: string | undefined;

    try {
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      connected = true;

      const writer = socket.writable.getWriter();
      await writer.write(pkt);
      writer.releaseLock();

      const reader = socket.readable.getReader();
      try {
        const timeoutPromiseRead = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Read timeout')), timeout);
        });
        const result = await Promise.race([reader.read(), timeoutPromiseRead]);
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        if (!result.done && result.value && result.value.length >= 4) {
          responseReceived = true;
          responseRoutes = parseRIPv2Response(result.value);
        }
      } catch {
        // No response — expected for UDP-only routers
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      } finally {
        reader.releaseLock();
      }
      socket.close();
    } catch (err) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      connectionError = err instanceof Error ? err.message : 'Connection failed';
    }

    const latencyMs = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: responseReceived,
      version: 2,
      command: 'response',
      authType: 'Keyed MD5 (RFC 2082 §4)',
      keyId: keyIdClamped,
      keyLength: Math.min(password.length, 16),
      sequenceNumber,
      packetLen,
      totalBytes,
      routeCount,
      connected,
      responseReceived,
      routes: responseRoutes,
      raw,
      latencyMs,
      note: connected
        ? responseReceived
          ? 'Router accepted the RIPv2 Keyed MD5 authenticated update and responded.'
          : 'TCP connected; no RIPv2 response (router may require UDP, or MD5 auth was rejected).'
        : `TCP connection to port ${port} failed — router likely requires UDP: ${connectionError ?? 'refused'}.`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      host,
      port,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
