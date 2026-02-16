/**
 * XMPP S2S Protocol Implementation (RFC 6120 Section 13-14)
 *
 * XMPP Server-to-Server (S2S) protocol enables federation between XMPP servers,
 * allowing users on different servers to communicate. This is the backbone of
 * the federated Jabber/XMPP network.
 *
 * Protocol Overview:
 * - Port: 5269 (TCP)
 * - Format: XML streaming protocol
 * - Authentication: Server Dialback (DNS-based) or SASL EXTERNAL
 * - Encryption: STARTTLS required for modern servers
 *
 * Connection Flow:
 * 1. TCP connection to port 5269
 * 2. Send <stream:stream> header with from/to domains
 * 3. Receive <stream:stream> response
 * 4. Receive <stream:features> (STARTTLS, dialback, SASL)
 * 5. Dialback verification (db:result/db:verify)
 * 6. Stanza exchange
 *
 * Server Dialback (RFC 3920):
 * - Originating server sends dialback key
 * - Receiving server verifies via DNS
 * - Weak authentication but widely supported
 *
 * Stream Features:
 * - STARTTLS: Upgrade to TLS
 * - SASL EXTERNAL: Certificate-based auth
 * - dialback: Server dialback support
 *
 * Use Cases:
 * - XMPP server federation testing
 * - Jabber server discovery
 * - S2S connectivity diagnostics
 * - Federation capability detection
 */

import { connect } from 'cloudflare:sockets';

interface XMPPS2SRequest {
  host: string;
  port?: number;
  timeout?: number;
  fromDomain?: string;
  toDomain?: string;
}

interface XMPPS2SResponse {
  success: boolean;
  host: string;
  port: number;
  serverDomain?: string;
  features?: {
    starttls?: boolean;
    dialback?: boolean;
    sasl?: string[];
  };
  streamId?: string;
  version?: string;
  rtt?: number;
  error?: string;
}

/**
 * Build XMPP S2S stream initiation
 */
function buildXMPPStreamInit(fromDomain: string, toDomain: string): string {
  return `<?xml version='1.0'?>
<stream:stream
  xmlns='jabber:server'
  xmlns:stream='http://etherx.jabber.org/streams'
  from='${fromDomain}'
  to='${toDomain}'
  version='1.0'>`;
}

/**
 * Parse XMPP stream response
 */
function parseXMPPStream(data: string): {
  streamId?: string;
  from?: string;
  version?: string;
  features?: {
    starttls?: boolean;
    dialback?: boolean;
    sasl?: string[];
  };
} | null {
  try {
    const result: {
      streamId?: string;
      from?: string;
      version?: string;
      features?: {
        starttls?: boolean;
        dialback?: boolean;
        sasl?: string[];
      };
    } = {};

    // Extract stream attributes
    const streamMatch = data.match(/<stream:stream[^>]*>/);
    if (streamMatch) {
      const streamTag = streamMatch[0];

      const idMatch = streamTag.match(/\bid=['"]([^'"]+)['"]/);
      if (idMatch) result.streamId = idMatch[1];

      const fromMatch = streamTag.match(/\bfrom=['"]([^'"]+)['"]/);
      if (fromMatch) result.from = fromMatch[1];

      const versionMatch = streamTag.match(/\bversion=['"]([^'"]+)['"]/);
      if (versionMatch) result.version = versionMatch[1];
    }

    // Extract stream features
    const featuresMatch = data.match(/<stream:features[^>]*>([\s\S]*?)<\/stream:features>/);
    if (featuresMatch) {
      const featuresContent = featuresMatch[1];

      result.features = {};

      // Check for STARTTLS
      if (featuresContent.includes('<starttls')) {
        result.features.starttls = true;
      }

      // Check for dialback
      if (featuresContent.includes('dialback') || featuresContent.includes('db:result')) {
        result.features.dialback = true;
      }

      // Check for SASL mechanisms
      const mechanismsMatch = featuresContent.match(/<mechanisms[^>]*>([\s\S]*?)<\/mechanisms>/);
      if (mechanismsMatch) {
        const mechanisms: string[] = [];
        const mechRegex = /<mechanism>([^<]+)<\/mechanism>/g;
        let mechMatch;

        while ((mechMatch = mechRegex.exec(mechanismsMatch[1])) !== null) {
          mechanisms.push(mechMatch[1]);
        }

        if (mechanisms.length > 0) {
          result.features.sasl = mechanisms;
        }
      }
    }

    return result;

  } catch {
    return null;
  }
}

/**
 * Probe XMPP S2S server by initiating stream and reading features.
 * Detects server capabilities without full authentication.
 */
export async function handleXMPPS2SProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as XMPPS2SRequest;
    const {
      host,
      port = 5269,
      timeout = 15000,
      fromDomain = 'probe.example.com',
      toDomain,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies XMPPS2SResponse), {
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
      } satisfies XMPPS2SResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const targetDomain = toDomain || host;

    const start = Date.now();

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Build XMPP S2S stream initiation
      const streamInit = buildXMPPStreamInit(fromDomain, targetDomain);

      // Send stream initiation
      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(streamInit));
      writer.releaseLock();

      // Read stream response and features
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
          error: 'No response from XMPP S2S server',
        } satisfies XMPPS2SResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const responseText = new TextDecoder().decode(value);
      const parsed = parseXMPPStream(responseText);

      if (!parsed) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Invalid XMPP S2S stream response',
        } satisfies XMPPS2SResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        serverDomain: parsed.from,
        features: parsed.features,
        streamId: parsed.streamId,
        version: parsed.version,
        rtt,
      } satisfies XMPPS2SResponse), {
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
      port: 5269,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies XMPPS2SResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Test XMPP S2S federation between two domains.
 * Probes whether server supports S2S for a specific domain.
 */
export async function handleXMPPS2SFederationTest(request: Request): Promise<Response> {
  try {
    const body = await request.json() as XMPPS2SRequest;
    const { host, port = 5269, timeout = 10000, fromDomain, toDomain } = body;

    if (!fromDomain || !toDomain) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Both fromDomain and toDomain are required for federation test',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Probe with specific domains
    const probeRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ host, port, timeout, fromDomain, toDomain }),
    });

    return handleXMPPS2SProbe(probeRequest);

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
