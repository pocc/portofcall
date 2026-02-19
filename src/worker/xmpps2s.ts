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

// ─── STARTTLS + DIALBACK HELPERS ──────────────────────────────────────────────

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function parseStreamId(xml: string): string | null {
  const m = xml.match(/<stream:stream[^>]+id=['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function genDialbackKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function readXMPPUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  sentinel: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;
  const dec = new TextDecoder();

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value?: Uint8Array; done: boolean }>(resolve =>
        setTimeout(() => resolve({ value: undefined, done: true }), remaining)),
    ]);
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
    if (total > maxBytes) break;
    const joined = new Uint8Array(total);
    let off = 0; for (const c of chunks) { joined.set(c, off); off += c.length; }
    const text = dec.decode(joined);
    if (text.includes(sentinel)) return text;
  }
  if (chunks.length === 0) return '';
  const joined = new Uint8Array(total);
  let off = 0; for (const c of chunks) { joined.set(c, off); off += c.length; }
  return dec.decode(joined);
}

/**
 * POST {host, port?, fromDomain, toDomain?, timeout?}
 *
 * Full XMPP S2S TLS federation test with STARTTLS upgrade + Server Dialback (XEP-0220):
 *  1. TCP connect with secureTransport='starttls'
 *  2. Send stream header → read features (check STARTTLS offered)
 *  3. Send <starttls/> → receive <proceed/>
 *  4. socket.startTls() → TLS socket
 *  5. Re-send stream header → read new features (check dialback)
 *  6. Send <db:result> dialback key → read result (valid/invalid/pending)
 */
export async function handleXMPPS2STlsDialback(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; fromDomain: string; toDomain?: string; timeout?: number;
    };
    const { host, port = 5269, fromDomain, timeout = 15000 } = body;
    const toDomain = body.toDomain ?? host;

    if (!host || !fromDomain) {
      return new Response(JSON.stringify({
        success: false, error: 'host and fromDomain are required',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const work = (async () => {
      const startTime = Date.now();

      // Must use 'starttls' so socket.startTls() is available later
      const socket = connect(`${host}:${port}`, { secureTransport: 'starttls', allowHalfOpen: false });
      await socket.opened;

      let reader = socket.readable.getReader();
      let writer = socket.writable.getWriter();
      let usedTls = false;

      try {
        // RFC 6120 Section 4.7: Stream opening with proper namespace declarations
        // XEP-0220 dialback namespace is declared in db:result element, not stream header
        const streamHeader = `<?xml version='1.0'?><stream:stream xmlns='jabber:server' xmlns:stream='http://etherx.jabber.org/streams' to='${escapeXml(toDomain)}' from='${escapeXml(fromDomain)}' version='1.0'>`;

        // Step 1: Send stream header on plain connection
        await writer.write(new TextEncoder().encode(streamHeader));

        // Step 2: Read stream features — look for STARTTLS
        const plain1 = await readXMPPUntil(reader, '</stream:features>', 32768, timeout);
        const streamId1 = parseStreamId(plain1);
        const starttlsOffered = plain1.includes('<starttls');
        const dialbackOnPlain = plain1.includes('dialback') || plain1.includes('db:result');

        if (!starttlsOffered) {
          // Server doesn't offer STARTTLS — try dialback directly on plain
          const key = genDialbackKey();
          const dbResult = `<db:result xmlns:db='jabber:server:dialback' from='${escapeXml(fromDomain)}' to='${escapeXml(toDomain)}'>${key}</db:result>`;
          await writer.write(new TextEncoder().encode(dbResult));
          writer.releaseLock();
          const resp = await readXMPPUntil(reader, 'db:result', 32768, 5000).catch(() => '');
          reader.releaseLock();
          try { socket.close(); } catch { /* ignore */ }
          let dialbackResult: string = 'pending';
          if (resp.match(/<db:result[^>]+type=['"]valid['"]/)) dialbackResult = 'valid';
          else if (resp.match(/<db:result[^>]+type=['"]invalid['"]/)) dialbackResult = 'invalid';
          else if (resp.includes('<stream:error')) dialbackResult = 'error';
          return {
            success: dialbackOnPlain,
            host, port, fromDomain, toDomain,
            starttlsOffered: false,
            tlsUpgraded: false,
            dialbackOffered: dialbackOnPlain,
            dialbackResult,
            streamId: streamId1 ?? undefined,
            latencyMs: Date.now() - startTime,
          };
        }

        // Step 3: Send <starttls> element
        await writer.write(new TextEncoder().encode(
          "<starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>"
        ));

        // Step 4: Read <proceed/> or <failure/>
        const proceedRaw = await readXMPPUntil(reader, '>', 4096, 5000);
        if (!proceedRaw.includes('<proceed')) {
          reader.releaseLock(); writer.releaseLock(); socket.close();
          return {
            success: false, host, port, fromDomain, toDomain,
            starttlsOffered: true, tlsUpgraded: false,
            error: `Expected <proceed/>, got: ${proceedRaw.slice(0, 200)}`,
            latencyMs: Date.now() - startTime,
          };
        }

        // Step 5: TLS upgrade — CRITICAL: release locks before calling startTls()
        reader.releaseLock();
        writer.releaseLock();
        const tlsSocket = socket.startTls();
        reader = tlsSocket.readable.getReader();
        writer = tlsSocket.writable.getWriter();
        usedTls = true;

        // Step 6: Re-send stream header on TLS socket
        await writer.write(new TextEncoder().encode(streamHeader));

        // Step 7: Read new features after TLS
        const tls1 = await readXMPPUntil(reader, '</stream:features>', 32768, timeout);
        const streamId2 = parseStreamId(tls1);
        const dialbackOffered = tls1.includes('dialback') || tls1.includes('urn:xmpp:features:dialback');
        const saslMechs: string[] = [];
        const mechRe = /<mechanism>([^<]+)<\/mechanism>/g;
        let m;
        while ((m = mechRe.exec(tls1)) !== null) saslMechs.push(m[1]);

        // Step 8: Send dialback key (XEP-0220 Section 2.1)
        const key = genDialbackKey();
        const dbResult = `<db:result xmlns:db='jabber:server:dialback' from='${escapeXml(fromDomain)}' to='${escapeXml(toDomain)}'>${key}</db:result>`;
        await writer.write(new TextEncoder().encode(dbResult));
        writer.releaseLock();

        // Step 9: Read dialback result
        const dbResp = await readXMPPUntil(reader, 'db:result', 32768, 5000).catch(() => '');
        reader.releaseLock();
        try { socket.close(); } catch { /* ignore */ }

        let dialbackResult: string = 'pending';
        if (dbResp.match(/<db:result[^>]+type=['"]valid['"]/)) dialbackResult = 'valid';
        else if (dbResp.match(/<db:result[^>]+type=['"]invalid['"]/)) dialbackResult = 'invalid';
        else if (dbResp.includes('<stream:error')) dialbackResult = 'error';

        return {
          success: dialbackResult === 'valid',
          host, port, fromDomain, toDomain,
          starttlsOffered: true,
          tlsUpgraded: usedTls,
          dialbackOffered,
          dialbackResult,
          saslMechanisms: saslMechs.length ? saslMechs : undefined,
          streamId: streamId2 ?? streamId1 ?? undefined,
          latencyMs: Date.now() - startTime,
        };

      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        try { socket.close(); } catch { /* ignore */ }
        throw err;
      }
    })();

    const result = await Promise.race([work, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '', port: 5269,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
