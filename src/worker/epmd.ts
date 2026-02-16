/**
 * EPMD Protocol Implementation (Erlang Port Mapper Daemon)
 *
 * EPMD is a name server for Erlang nodes. It runs on port 4369 and maps
 * Erlang node names to their TCP distribution ports. Any system running
 * Erlang/OTP (RabbitMQ, CouchDB, Elixir) uses EPMD for node discovery.
 *
 * Protocol (binary TCP):
 * - Request: [Length:16be, Tag:8, Data...]
 * - NAMES_REQ (tag 110/'n'): Lists all registered Erlang nodes
 *   Response: [EPMDPort:32be, NodeInfo...] where NodeInfo = "name <name> at port <port>\n"
 * - PORT_PLEASE2_REQ (tag 122/'z'): Looks up a specific node
 *   Response: [119, Result:8, ...] where Result=0=found, 1=not found
 *
 * Use Cases:
 * - RabbitMQ cluster discovery
 * - CouchDB node detection
 * - Elixir/Phoenix distributed systems
 * - Erlang infrastructure auditing
 */

import { connect } from 'cloudflare:sockets';

interface EPMDNamesRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface EPMDNamesResponse {
  success: boolean;
  host: string;
  port: number;
  epmdPort?: number;
  nodes?: { name: string; port: number }[];
  rawResponse?: string;
  rtt?: number;
  error?: string;
}

interface EPMDPortRequest {
  host: string;
  port?: number;
  nodeName: string;
  timeout?: number;
}

interface EPMDPortResponse {
  success: boolean;
  host: string;
  port: number;
  nodeName: string;
  found: boolean;
  nodePort?: number;
  nodeType?: string;
  protocol?: number;
  highestVersion?: number;
  lowestVersion?: number;
  extra?: string;
  rtt?: number;
  error?: string;
}

/**
 * Build a NAMES_REQ packet.
 * Format: [Length:16be=1, Tag:8=110]
 */
function buildNamesRequest(): Uint8Array {
  const buf = new Uint8Array(3);
  // Length = 1 (just the tag byte)
  buf[0] = 0x00;
  buf[1] = 0x01;
  // Tag = 110 ('n') = NAMES_REQ
  buf[2] = 110;
  return buf;
}

/**
 * Build a PORT_PLEASE2_REQ packet.
 * Format: [Length:16be, Tag:8=122, NodeName...]
 */
function buildPortRequest(nodeName: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(nodeName);
  const length = 1 + nameBytes.length; // tag + name
  const buf = new Uint8Array(2 + length);
  // Length (16-bit big-endian)
  buf[0] = (length >> 8) & 0xff;
  buf[1] = length & 0xff;
  // Tag = 122 ('z') = PORT_PLEASE2_REQ
  buf[2] = 122;
  // Node name
  buf.set(nameBytes, 3);
  return buf;
}

/**
 * Parse NAMES response.
 * Format: [EPMDPort:32be, "name <name> at port <port>\n"...]
 */
function parseNamesResponse(data: Uint8Array): {
  epmdPort: number;
  nodes: { name: string; port: number }[];
  raw: string;
} {
  if (data.length < 4) {
    throw new Error('Response too short for NAMES response');
  }

  // First 4 bytes: EPMD port (32-bit big-endian)
  const epmdPort =
    (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];

  // Rest is text: "name <name> at port <port>\n" repeated
  const text = new TextDecoder().decode(data.slice(4));
  const nodes: { name: string; port: number }[] = [];

  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  for (const line of lines) {
    // Format: "name <name> at port <port>"
    const match = line.match(/^name\s+(\S+)\s+at\s+port\s+(\d+)/);
    if (match) {
      nodes.push({ name: match[1], port: parseInt(match[2], 10) });
    }
  }

  return { epmdPort, nodes, raw: text };
}

/**
 * Parse PORT_PLEASE2 response.
 * Success: [119, 0, PortNo:16be, NodeType:8, Protocol:8, HighVer:16be, LowVer:16be, NLen:16be, NodeName, ELen:16be, Extra]
 * Failure: [119, 1]
 */
function parsePortResponse(data: Uint8Array): {
  found: boolean;
  nodePort?: number;
  nodeType?: string;
  protocol?: number;
  highestVersion?: number;
  lowestVersion?: number;
  nodeName?: string;
  extra?: string;
} {
  if (data.length < 2) {
    throw new Error('Response too short for PORT response');
  }

  // First byte should be 119 ('w') = PORT2_RESP
  if (data[0] !== 119) {
    throw new Error(`Unexpected response tag: ${data[0]} (expected 119)`);
  }

  const result = data[1];
  if (result !== 0) {
    return { found: false };
  }

  if (data.length < 12) {
    return { found: true };
  }

  const nodePort = (data[2] << 8) | data[3];
  const nodeTypeVal = data[4];
  const nodeType = nodeTypeVal === 72 ? 'hidden' : nodeTypeVal === 77 ? 'normal' : `unknown(${nodeTypeVal})`;
  const protocol = data[5];
  const highestVersion = (data[6] << 8) | data[7];
  const lowestVersion = (data[8] << 8) | data[9];
  const nameLen = (data[10] << 8) | data[11];

  let nodeName: string | undefined;
  if (data.length >= 12 + nameLen) {
    nodeName = new TextDecoder().decode(data.slice(12, 12 + nameLen));
  }

  let extra: string | undefined;
  if (data.length >= 12 + nameLen + 2) {
    const extraLen = (data[12 + nameLen] << 8) | data[12 + nameLen + 1];
    if (extraLen > 0 && data.length >= 12 + nameLen + 2 + extraLen) {
      extra = new TextDecoder().decode(
        data.slice(12 + nameLen + 2, 12 + nameLen + 2 + extraLen),
      );
    }
  }

  return {
    found: true,
    nodePort,
    nodeType,
    protocol,
    highestVersion,
    lowestVersion,
    nodeName,
    extra,
  };
}

/**
 * List all registered Erlang nodes (NAMES_REQ).
 */
export async function handleEPMDNames(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as EPMDNamesRequest;
    const { host, port = 4369, timeout = 10000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({
          success: false,
          host: '',
          port,
          error: 'Host is required',
        } satisfies EPMDNamesResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (port < 1 || port > 65535) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          error: 'Port must be between 1 and 65535',
        } satisfies EPMDNamesResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send NAMES_REQ
      await writer.write(buildNamesRequest());

      // Read response — EPMD sends all data then closes
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);
          if (done) break;
          if (value) {
            chunks.push(value);
            totalBytes += value.length;
            if (totalBytes > 65536) break; // Safety limit
          }
        }
      } catch {
        // Connection closed by server (expected)
        if (chunks.length === 0) {
          throw new Error('Server closed connection without sending data');
        }
      }

      const rtt = Date.now() - start;

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const parsed = parseNamesResponse(combined);

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          epmdPort: parsed.epmdPort,
          nodes: parsed.nodes,
          rawResponse: parsed.raw.trim(),
          rtt,
        } satisfies EPMDNamesResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        host: '',
        port: 4369,
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies EPMDNamesResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Look up a specific Erlang node (PORT_PLEASE2_REQ).
 */
export async function handleEPMDPort(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as EPMDPortRequest;
    const { host, port = 4369, nodeName, timeout = 10000 } = body;

    if (!host) {
      return new Response(
        JSON.stringify({
          success: false,
          host: '',
          port,
          nodeName: '',
          found: false,
          error: 'Host is required',
        } satisfies EPMDPortResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!nodeName) {
      return new Response(
        JSON.stringify({
          success: false,
          host,
          port,
          nodeName: '',
          found: false,
          error: 'Node name is required',
        } satisfies EPMDPortResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send PORT_PLEASE2_REQ
      await writer.write(buildPortRequest(nodeName));

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);
          if (done) break;
          if (value) {
            chunks.push(value);
            totalBytes += value.length;
            if (totalBytes > 4096) break; // Safety limit
          }
        }
      } catch {
        if (chunks.length === 0) {
          throw new Error('Server closed connection without sending data');
        }
      }

      const rtt = Date.now() - start;

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const parsed = parsePortResponse(combined);

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          nodeName,
          found: parsed.found,
          nodePort: parsed.nodePort,
          nodeType: parsed.nodeType,
          protocol: parsed.protocol,
          highestVersion: parsed.highestVersion,
          lowestVersion: parsed.lowestVersion,
          extra: parsed.extra,
          rtt,
        } satisfies EPMDPortResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        host: '',
        port: 4369,
        nodeName: '',
        found: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } satisfies EPMDPortResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
