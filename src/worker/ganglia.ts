/**
 * Ganglia gmond Protocol Support for Cloudflare Workers
 * Implements the Ganglia gmond/gmetad XML dump protocol (TCP ports 8649/8651)
 *
 * Ganglia is a scalable distributed monitoring system for high-performance
 * computing systems such as clusters and grids. The gmond daemon listens
 * on TCP port 8649 and dumps the entire cluster state as XML on connect.
 * The gmetad daemon listens on TCP port 8651 and serves aggregated XML
 * from multiple gmond sources using the same XML schema.
 *
 * Protocol behavior:
 *   1. Client connects to gmond TCP port 8649 (or gmetad 8651)
 *   2. Server immediately sends an XML document containing cluster state
 *   3. XML includes: cluster info, host info, metrics (CPU, memory, disk, etc.)
 *   4. Connection closes after the XML dump completes
 *
 * The XML format uses GANGLIA_XML as the root element, containing CLUSTER
 * elements, which contain HOST elements, which contain METRIC elements.
 * In Ganglia 3.1+, METRIC elements may contain EXTRA_DATA children with
 * additional metadata (GROUP, DESC, TITLE, SOURCE, CLUSTER).
 *
 * Note: Ganglia also uses XDR (RFC 4506) encoding for multicast/unicast
 * metric announcements between gmond daemons (UDP port 8649). This module
 * implements only the TCP XML dump protocol, not the XDR binary protocol.
 *
 * No commands to send - it's a pure read-only dump protocol.
 * No authentication required.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const decoder = new TextDecoder();

/**
 * Read all data from gmond until the socket closes or timeout
 */
async function readGangliaXML(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  let buffer = '';

  const timeoutPromise = new Promise<string>((resolve) =>
    setTimeout(() => resolve(buffer), timeoutMs)
  );

  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Check for end of XML document
      if (buffer.includes('</GANGLIA_XML>')) {
        break;
      }
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Simple XML tag extraction (no external parser needed)
 * Extracts attributes from an XML opening tag
 */
function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = re.exec(tag)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

/**
 * Parse extra data from a METRIC element body (Ganglia 3.1+)
 * EXTRA_DATA contains EXTRA_ELEMENT children with NAME/VAL attributes
 * Common extras: GROUP, DESC, TITLE, SOURCE, CLUSTER
 */
function parseExtraData(metricBody: string): Record<string, string> {
  const extras: Record<string, string> = {};
  const extraElementRegex = /<EXTRA_ELEMENT\s+([^>]*)\/?>/g;
  let match;
  while ((match = extraElementRegex.exec(metricBody)) !== null) {
    const attrs = parseAttributes(match[1]);
    if (attrs['NAME'] && attrs['VAL']) {
      extras[attrs['NAME']] = attrs['VAL'];
    }
  }
  return extras;
}

/**
 * Parse the Ganglia XML dump into structured data.
 * Handles both Ganglia 3.0 (self-closing METRIC tags) and
 * Ganglia 3.1+ (METRIC tags with EXTRA_DATA children).
 */
function parseGangliaXML(xml: string): {
  gangliaVersion?: string;
  source?: string;
  clusters: {
    name: string;
    owner?: string;
    url?: string;
    localtime?: string;
    hosts: {
      name: string;
      ip: string;
      reported?: string;
      tn?: string;
      tmax?: string;
      os?: string;
      gmond_started?: string;
      metrics: {
        name: string;
        val: string;
        type: string;
        units: string;
        tn?: string;
        tmax?: string;
        group?: string;
        desc?: string;
        title?: string;
      }[];
    }[];
  }[];
} {
  const result: ReturnType<typeof parseGangliaXML> = { clusters: [] };

  // Parse GANGLIA_XML root attributes
  const gangliaMatch = xml.match(/<GANGLIA_XML\s+([^>]+)>/);
  if (gangliaMatch) {
    const attrs = parseAttributes(gangliaMatch[1]);
    result.gangliaVersion = attrs['VERSION'];
    result.source = attrs['SOURCE'];
  }

  // Parse CLUSTER elements
  const clusterRegex = /<CLUSTER\s+([^>]+)>([\s\S]*?)<\/CLUSTER>/g;
  let clusterMatch;
  while ((clusterMatch = clusterRegex.exec(xml)) !== null) {
    const clusterAttrs = parseAttributes(clusterMatch[1]);
    const clusterContent = clusterMatch[2];

    const cluster: (typeof result.clusters)[0] = {
      name: clusterAttrs['NAME'] || 'unknown',
      owner: clusterAttrs['OWNER'],
      url: clusterAttrs['URL'],
      localtime: clusterAttrs['LOCALTIME'],
      hosts: [],
    };

    // Parse HOST elements within this cluster
    const hostRegex = /<HOST\s+([^>]+)>([\s\S]*?)<\/HOST>/g;
    let hostMatch;
    while ((hostMatch = hostRegex.exec(clusterContent)) !== null) {
      const hostAttrs = parseAttributes(hostMatch[1]);
      const hostContent = hostMatch[2];

      const host: (typeof cluster.hosts)[0] = {
        name: hostAttrs['NAME'] || 'unknown',
        ip: hostAttrs['IP'] || '',
        reported: hostAttrs['REPORTED'],
        tn: hostAttrs['TN'],
        tmax: hostAttrs['TMAX'],
        os: hostAttrs['OS_NAME'] ? `${hostAttrs['OS_NAME']} ${hostAttrs['OS_RELEASE'] || ''}`.trim() : undefined,
        gmond_started: hostAttrs['GMOND_STARTED'],
        metrics: [],
      };

      // Parse METRIC elements within this host.
      // Handles both forms:
      //   1. Self-closing: <METRIC NAME="..." VAL="..." ... />
      //   2. With body:    <METRIC NAME="..." VAL="..." ...><EXTRA_DATA>...</EXTRA_DATA></METRIC>
      const metricRegex = /<METRIC\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/METRIC>)/g;
      let metricMatch;
      while ((metricMatch = metricRegex.exec(hostContent)) !== null) {
        const metricAttrs = parseAttributes(metricMatch[1]);
        const metricBody = metricMatch[2] || '';

        // Parse EXTRA_DATA if present (Ganglia 3.1+)
        const extras = metricBody ? parseExtraData(metricBody) : {};

        host.metrics.push({
          name: metricAttrs['NAME'] || '',
          val: metricAttrs['VAL'] || '',
          type: metricAttrs['TYPE'] || '',
          units: metricAttrs['UNITS'] || '',
          tn: metricAttrs['TN'],
          tmax: metricAttrs['TMAX'],
          group: extras['GROUP'],
          desc: extras['DESC'],
          title: extras['TITLE'],
        });
      }

      cluster.hosts.push(host);
    }

    result.clusters.push(cluster);
  }

  return result;
}

/**
 * Handle Ganglia connect - connects and reads XML dump
 * POST /api/ganglia/connect
 */
export async function handleGangliaConnect(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 8649;
    const timeoutMs = options.timeout || 15000;

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
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();

      try {
        // Read the XML dump (gmond sends it immediately on connect)
        const remainingMs = Math.max(timeoutMs - connectTime, 1000);
        const xml = await readGangliaXML(reader, remainingMs);
        const rtt = Date.now() - startTime;

        reader.releaseLock();
        await socket.close();

        // Parse the XML
        const parsed = parseGangliaXML(xml);

        // Build summary
        const totalHosts = parsed.clusters.reduce((sum, c) => sum + c.hosts.length, 0);
        const totalMetrics = parsed.clusters.reduce(
          (sum, c) => sum + c.hosts.reduce((hsum, h) => hsum + h.metrics.length, 0),
          0
        );

        return {
          success: true,
          message: `Ganglia gmond connected: ${parsed.clusters.length} cluster(s), ${totalHosts} host(s), ${totalMetrics} metric(s)`,
          host,
          port,
          connectTime,
          rtt,
          gangliaVersion: parsed.gangliaVersion,
          source: parsed.source,
          clusterCount: parsed.clusters.length,
          hostCount: totalHosts,
          metricCount: totalMetrics,
          clusters: parsed.clusters.map(c => ({
            name: c.name,
            owner: c.owner,
            url: c.url,
            hostCount: c.hosts.length,
            hosts: c.hosts.map(h => ({
              name: h.name,
              ip: h.ip,
              os: h.os,
              reported: h.reported,
              metricCount: h.metrics.length,
              metricsTruncated: h.metrics.length > 50,
              metrics: h.metrics.slice(0, 50), // Limit to 50 metrics per host for response size
            })),
          })),
          xmlSize: xml.length,
        };
      } catch (error) {
        reader.releaseLock();
        await socket.close();
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
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Ganglia probe - lightweight connectivity check
 * POST /api/ganglia/probe
 */
export async function handleGangliaProbe(request: Request): Promise<Response> {
  try {
    const options = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    if (!options.host) {
      return new Response(JSON.stringify({
        error: 'Missing required parameter: host',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 8649;
    const timeoutMs = options.timeout || 5000;

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
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();

      try {
        // Read just the first chunk to detect gmond
        let buffer = '';
        const readStart = Date.now();

        const { value, done } = await reader.read();
        if (!done && value) {
          buffer = decoder.decode(value, { stream: true });
        }

        const rtt = Date.now() - readStart;

        reader.releaseLock();
        await socket.close();

        // Check if it looks like Ganglia XML - require GANGLIA_XML tag specifically,
        // not just any XML document (<?xml alone would false-positive on other services)
        const hasGangliaTag = buffer.includes('<GANGLIA_XML');
        const isGanglia = hasGangliaTag;
        const versionMatch = buffer.match(/VERSION="([^"]+)"/);
        const sourceMatch = buffer.match(/SOURCE="([^"]+)"/);

        return {
          success: true,
          message: isGanglia ? 'Ganglia gmond detected' : 'Connected but response does not contain GANGLIA_XML tag',
          host,
          port,
          connectTime,
          rtt,
          isGanglia,
          gangliaVersion: versionMatch ? versionMatch[1] : undefined,
          source: sourceMatch ? sourceMatch[1] : undefined,
          previewSize: buffer.length,
        };
      } catch (error) {
        reader.releaseLock();
        await socket.close();
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
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Request failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
