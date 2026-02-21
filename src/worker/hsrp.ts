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
  const packet = Buffer.alloc(20, 0);

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

// ── HSRPv2 support ──────────────────────────────────────────────────────────

/**
 * Build an HSRPv2 Hello TLV packet (IPv4 Group State).
 *
 * HSRPv2 uses TLV encoding. The Group State TLV for IPv4:
 *   Offset  Field                Size
 *   ------  -------------------  ----
 *   0       TLV Type             1     (1 = Group State)
 *   1       TLV Length           1     (34 = data bytes that follow)
 *   2       Version              1     (2 = HSRPv2)
 *   3       Op Code              1     (0=Hello, 1=Coup, 2=Resign)
 *   4       State                1     (0=Initial,1=Learn,2=Listen,4=Speak,8=Standby,16=Active)
 *   5       IP Version           1     (4=IPv4, 6=IPv6)
 *   6       Group Number         2     (0-4095, big-endian)
 *   8       Identifier           6     (MAC address of sender)
 *   14      Priority             4     (0-255 in first byte; 3 reserved)
 *   18      Hello Time (ms)      4     (big-endian, default 3000)
 *   22      Hold Time (ms)       4     (big-endian, default 10000)
 *   26      Virtual IP           4     (IPv4 address)
 *   ---     Total               30+6 = 36 bytes (type+length+34 data)
 */
function buildHSRPv2Hello(
  group: number,
  priority: number,
  virtualIP = '0.0.0.0',
): Uint8Array {
  const TLV_DATA_LEN = 34;
  const tlv = new Uint8Array(2 + TLV_DATA_LEN); // 36 bytes total
  const dv = new DataView(tlv.buffer);

  tlv[0] = 1;              // TLV type: Group State
  tlv[1] = TLV_DATA_LEN;   // TLV length (data bytes only)
  tlv[2] = 2;              // HSRPv2 version (was incorrectly 1)
  tlv[3] = 0;              // Op code: Hello
  tlv[4] = 2;              // State: Listen (safe probe state; 2=Listen per RFC)
  tlv[5] = 4;              // IP version: IPv4

  // Group number: 2 bytes big-endian (supports 0-4095 in HSRPv2)
  dv.setUint16(6, group & 0x0FFF, false);

  // Identifier (sender MAC): bytes 8-13, leave as zeros for probe

  // Priority: byte 14 (bytes 15-17 reserved, left as zero)
  tlv[14] = priority;

  // Hello time: 3000ms (big-endian uint32)
  dv.setUint32(18, 3000, false);

  // Hold time: 10000ms (big-endian uint32)
  dv.setUint32(22, 10000, false);

  // Virtual IP address: 4 bytes at offset 26
  const ipParts = virtualIP.split('.').map(p => parseInt(p) || 0);
  tlv[26] = ipParts[0];
  tlv[27] = ipParts[1];
  tlv[28] = ipParts[2];
  tlv[29] = ipParts[3];

  return tlv;
}

/**
 * Build an HSRPv1 Coup packet (op_code=1).
 *
 * A Coup is sent by a router that wants to become Active by preempting the
 * current Active router. priority=255 is the maximum and wins any election.
 *
 * Per RFC 2281, the authentication field defaults to "cisco" (padded to 8
 * bytes with NULs). A packet with mismatched auth is silently dropped by
 * compliant routers, so we include the default to maximize probe success.
 */
function buildHSRPv1Coup(
  group: number,
  priority: number,
  authentication: string = 'cisco',
): Uint8Array {
  const packet = new Uint8Array(20);
  packet[0] = 0;               // Version: HSRPv1
  packet[1] = 1;               // Op Code: Coup
  packet[2] = 4;               // State: Speak
  packet[3] = 3;               // Hello time: 3s
  packet[4] = 10;              // Hold time: 10s
  packet[5] = priority;        // Priority (255 = max)
  packet[6] = group & 0xFF;    // Group
  packet[7] = 0;               // Reserved

  // Authentication Data (8 bytes, NUL-padded) — default "cisco" per RFC 2281
  const authBytes = new TextEncoder().encode(authentication.substring(0, 8));
  packet.set(authBytes, 8);

  // bytes [16..19] = 0.0.0.0 (virtual IP unknown for probe)
  return packet;
}

/**
 * Send an HSRPv1 Coup message to attempt Active router election.
 *
 * A Coup is sent when a router with higher priority wants to preempt the
 * current Active router. Sending a Coup with priority=255 reveals whether
 * authentication is required, the current Active router's priority and state,
 * and the configured virtual IP.
 *
 * POST /api/hsrp/coup
 * Body: { host, port=1985, group=0, priority=255, authentication="cisco", timeout=10000 }
 */
export async function handleHSRPCoup(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      group?: number;
      priority?: number;
      authentication?: string;
      timeout?: number;
    };
    const { host, port = 1985, group = 0, priority = 255, authentication = 'cisco', timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startMs = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const coupPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        await writer.write(buildHSRPv1Coup(group, priority, authentication));

        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>(res =>
            setTimeout(() => res({ value: undefined, done: true }), 3000)),
        ]);

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        if (done || !value || value.length < 20) {
          return {
            success: true,
            host, port, group, priority,
            tcpConnected: true,
            coupSent: true,
            response: null,
            note: 'Coup sent — no response (HSRP is UDP multicast; TCP responses uncommon). Router received packet if reachable on TCP 1985.',
            latencyMs: Date.now() - startMs,
          };
        }

        const opCode      = value[1];
        const state       = value[2];
        const respPriority = value[5];
        const respGroup   = value[6];
        const authRaw     = value.slice(8, 16);
        const nullIdx     = Array.from(authRaw).indexOf(0);
        const authStr     = new TextDecoder().decode(authRaw.slice(0, nullIdx >= 0 ? nullIdx : 8));
        const vip = `${value[16]}.${value[17]}.${value[18]}.${value[19]}`;

        const opNames: Record<number, string>    = { 0: 'Hello', 1: 'Coup', 2: 'Resign' };
        const stateNames: Record<number, string> = { 0: 'Initial', 1: 'Learn', 2: 'Listen', 4: 'Speak', 8: 'Standby', 16: 'Active' };

        return {
          success: true,
          host, port, group, priority,
          tcpConnected: true,
          coupSent: true,
          response: {
            opCode: opNames[opCode] ?? `Unknown(${opCode})`,
            state: stateNames[state] ?? `Unknown(${state})`,
            priority: respPriority,
            group: respGroup,
            virtualIP: vip,
            authentication: authStr || '(none — no plaintext auth)',
          },
          note: priority > respPriority
            ? 'Our Coup priority exceeds Active router — election would succeed if preemption is enabled'
            : 'Active router priority >= Coup priority — election would fail',
          latencyMs: Date.now() - startMs,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([coupPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * HSRPv2 probe — sends HSRPv2 TLV Hello and reads response.
 *
 * HSRPv2 supports IPv6 virtual IPs and millisecond timers. Group numbers
 * can be 0-4095 (encoded in group_id field of TLV).
 *
 * POST /api/hsrp/v2-probe
 * Body: { host, port=1985, group=0, priority=50, timeout=10000 }
 */
export async function handleHSRPv2Probe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      group?: number;
      priority?: number;
      timeout?: number;
    };
    const { host, port = 1985, group = 0, priority = 50, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const startMs = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const probePromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        await writer.write(buildHSRPv2Hello(group, priority));

        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>(res =>
            setTimeout(() => res({ value: undefined, done: true }), 3000)),
        ]);

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        // HSRPv2 IPv4 Group State TLV is 36 bytes (2 header + 34 data)
        if (done || !value || value.length < 30) {
          return {
            success: true,
            host, port, group, priority,
            version: 'HSRPv2',
            tcpConnected: true,
            helloSent: true,
            response: null,
            note: 'HSRPv2 Hello sent — no response (HSRP is UDP multicast; TCP probing is non-standard).',
            latencyMs: Date.now() - startMs,
          };
        }

        const dv = new DataView(value.buffer, value.byteOffset, value.byteLength);
        const tlvType   = value[0];
        const tlvLen    = value[1];
        const v2ver     = value[2];
        const opCode    = value[3];
        const state     = value[4];
        const ipVersion = value[5];
        // Group number: 2 bytes big-endian at offset 6 (supports 0-4095)
        const respGroup = dv.getUint16(6, false);
        // Identifier (sender MAC): bytes 8-13
        // Priority: byte 14 (bytes 15-17 reserved)
        const respPrio  = value[14];
        // Hello/Hold times: 4 bytes big-endian each at offsets 18 and 22
        const helloTimeMs = dv.getUint32(18, false);
        const holdTimeMs  = dv.getUint32(22, false);
        // Virtual IP: 4 bytes at offset 26 (IPv4)
        const vip = `${value[26]}.${value[27]}.${value[28]}.${value[29]}`;

        const opNames: Record<number, string>    = { 0: 'Hello', 1: 'Coup', 2: 'Resign' };
        const stateNames: Record<number, string> = { 0: 'Initial', 1: 'Learn', 2: 'Listen', 4: 'Speak', 8: 'Standby', 16: 'Active' };

        return {
          success: true,
          host, port, group, priority,
          version: 'HSRPv2',
          tcpConnected: true,
          helloSent: true,
          response: {
            tlvType,
            tlvLen,
            hsrpVersion: v2ver,
            opCode: opNames[opCode] ?? `Unknown(${opCode})`,
            state: stateNames[state] ?? `Unknown(${state})`,
            ipVersion: ipVersion === 4 ? 'IPv4' : ipVersion === 6 ? 'IPv6' : `Unknown(${ipVersion})`,
            helloTimeMs,
            holdTimeMs,
            priority: respPrio,
            group: respGroup,
            virtualIP: vip,
          },
          latencyMs: Date.now() - startMs,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([probePromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
