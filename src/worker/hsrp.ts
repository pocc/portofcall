/**
 * HSRP Protocol Implementation (Cisco Proprietary)
 *
 * Hot Standby Router Protocol (HSRP) is a Cisco proprietary redundancy protocol
 * for establishing a fault-tolerant default gateway. Multiple routers share a
 * virtual IP address, with one router acting as Active and others as Standby.
 *
 * Protocol Overview:
 * - Port: 1985 (UDP multicast to 224.0.0.2, TCP for this implementation)
 * - Version: HSRPv1 (original), HSRPv2 (improved, supports IPv6)
 * - Virtual MAC: 0000.0c07.acXX (XX = group number)
 * - Hello Interval: 3 seconds (default)
 * - Hold Time: 10 seconds (default)
 *
 * HSRP States:
 * - Initial (0): Beginning state
 * - Learn (1): Router has not determined virtual IP
 * - Listen (2): Router knows virtual IP, not Active/Standby
 * - Speak (4): Router is candidate for Active/Standby
 * - Standby (8): Router is next in line to be Active
 * - Active (16): Router is forwarding packets for virtual IP
 *
 * HSRPv1 Packet Format (20 bytes):
 * - Version (1 byte): 0 for HSRPv1
 * - Op Code (1 byte): 0=Hello, 1=Coup, 2=Resign
 * - State (1 byte): Router state
 * - Hello Time (1 byte): Seconds between hellos
 * - Hold Time (1 byte): Seconds before Active is declared down
 * - Priority (1 byte): 0-255, highest wins (default 100)
 * - Group (1 byte): HSRP group number (0-255)
 * - Reserved (1 byte): Must be 0
 * - Authentication Data (8 bytes): Plain text password
 * - Virtual IP Address (4 bytes): Shared virtual IP
 *
 * Use Cases:
 * - Cisco network discovery
 * - Router redundancy detection
 * - High availability topology mapping
 * - Active/Standby router identification
 * - Network failover testing
 */

import { connect } from 'cloudflare:sockets';

interface HSRPRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface HSRPResponse {
  success: boolean;
  host: string;
  port: number;
  version?: number;
  opCode?: string;
  state?: string;
  helloTime?: number;
  holdTime?: number;
  priority?: number;
  group?: number;
  virtualIP?: string;
  authentication?: string;
  rtt?: number;
  error?: string;
}

// HSRP Op Codes
enum HSRPOpCode {
  Hello = 0,
  Coup = 1,
  Resign = 2,
}

// HSRP States
enum HSRPState {
  Initial = 0,
  Learn = 1,
  Listen = 2,
  Speak = 4,
  Standby = 8,
  Active = 16,
}

/**
 * Build HSRP Hello message (HSRPv1)
 */
function buildHSRPHello(
  group: number,
  priority: number,
  virtualIP: string,
  helloTime: number = 3,
  holdTime: number = 10,
  authentication: string = 'cisco'
): Buffer {
  const packet = Buffer.allocUnsafe(20);

  // Version (0 = HSRPv1)
  packet.writeUInt8(0, 0);

  // Op Code (0 = Hello)
  packet.writeUInt8(HSRPOpCode.Hello, 1);

  // State (2 = Listen - safe probe state)
  packet.writeUInt8(HSRPState.Listen, 2);

  // Hello Time (seconds)
  packet.writeUInt8(helloTime, 3);

  // Hold Time (seconds)
  packet.writeUInt8(holdTime, 4);

  // Priority (0-255)
  packet.writeUInt8(priority, 5);

  // Group (0-255)
  packet.writeUInt8(group, 6);

  // Reserved (must be 0)
  packet.writeUInt8(0, 7);

  // Authentication Data (8 bytes, padded with nulls)
  const authBuffer = Buffer.alloc(8, 0);
  Buffer.from(authentication.substring(0, 8), 'ascii').copy(authBuffer);
  authBuffer.copy(packet, 8);

  // Virtual IP Address (4 bytes)
  const ipParts = virtualIP.split('.').map(p => parseInt(p, 10));
  packet.writeUInt8(ipParts[0] || 0, 16);
  packet.writeUInt8(ipParts[1] || 0, 17);
  packet.writeUInt8(ipParts[2] || 0, 18);
  packet.writeUInt8(ipParts[3] || 0, 19);

  return packet;
}

/**
 * Parse HSRP packet (HSRPv1)
 */
function parseHSRPPacket(data: Buffer): {
  version: number;
  opCode: number;
  state: number;
  helloTime: number;
  holdTime: number;
  priority: number;
  group: number;
  authentication: string;
  virtualIP: string;
} | null {
  if (data.length < 20) {
    return null;
  }

  const version = data.readUInt8(0);

  // Only support HSRPv1 (version 0) for now
  if (version !== 0) {
    return null;
  }

  const opCode = data.readUInt8(1);
  const state = data.readUInt8(2);
  const helloTime = data.readUInt8(3);
  const holdTime = data.readUInt8(4);
  const priority = data.readUInt8(5);
  const group = data.readUInt8(6);

  // Authentication (8 bytes, null-terminated string)
  const authBuffer = data.subarray(8, 16);
  const nullIndex = authBuffer.indexOf(0);
  const authentication = authBuffer.toString('ascii', 0, nullIndex >= 0 ? nullIndex : 8);

  // Virtual IP Address
  const virtualIP = `${data.readUInt8(16)}.${data.readUInt8(17)}.${data.readUInt8(18)}.${data.readUInt8(19)}`;

  return {
    version,
    opCode,
    state,
    helloTime,
    holdTime,
    priority,
    group,
    authentication,
    virtualIP,
  };
}

/**
 * Probe HSRP router by sending Hello and parsing response.
 * Detects Active/Standby routers and extracts configuration.
 */
export async function handleHSRPProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as HSRPRequest;
    const { host, port = 1985, timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies HSRPResponse), {
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
      } satisfies HSRPResponse), {
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

      // Build HSRP Hello probe packet
      // Use group 0, low priority 50, dummy virtual IP
      const hsrpHello = buildHSRPHello(0, 50, '0.0.0.0');

      // Send HSRP Hello
      const writer = socket.writable.getWriter();
      await writer.write(hsrpHello);
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
          error: 'No response from HSRP router',
        } satisfies HSRPResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const response = parseHSRPPacket(Buffer.from(value));

      if (!response) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid HSRP packet format',
        } satisfies HSRPResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      // Map op code to name
      const opCodeNames: { [key: number]: string } = {
        [HSRPOpCode.Hello]: 'Hello',
        [HSRPOpCode.Coup]: 'Coup',
        [HSRPOpCode.Resign]: 'Resign',
      };

      // Map state to name
      const stateNames: { [key: number]: string } = {
        [HSRPState.Initial]: 'Initial',
        [HSRPState.Learn]: 'Learn',
        [HSRPState.Listen]: 'Listen',
        [HSRPState.Speak]: 'Speak',
        [HSRPState.Standby]: 'Standby',
        [HSRPState.Active]: 'Active',
      };

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        version: response.version,
        opCode: opCodeNames[response.opCode] || `Unknown (${response.opCode})`,
        state: stateNames[response.state] || `Unknown (${response.state})`,
        helloTime: response.helloTime,
        holdTime: response.holdTime,
        priority: response.priority,
        group: response.group,
        virtualIP: response.virtualIP,
        authentication: response.authentication || '(none)',
        rtt,
      } satisfies HSRPResponse), {
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
      port: 1985,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies HSRPResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Listen for HSRP Hello messages from routers.
 * Passive listening mode to discover HSRP configuration.
 */
export async function handleHSRPListen(request: Request): Promise<Response> {
  try {
    const body = await request.json() as HSRPRequest;
    const { host, port = 1985, timeout = 10000 } = body;

    // Simply probe for HSRP - full passive listening would require
    // continuous connection which isn't ideal for Workers
    const probeRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ host, port, timeout }),
    });

    return handleHSRPProbe(probeRequest);

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
