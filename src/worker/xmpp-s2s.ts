/**
 * XMPP Server-to-Server Protocol Implementation (RFC 6120, RFC 7590)
 *
 * XMPP S2S is the federation protocol that allows XMPP servers to communicate
 * with each other, enabling users on different servers to exchange messages,
 * presence updates, and other stanzas.
 *
 * Protocol Flow:
 * 1. Client initiates TCP connection to remote server on port 5269
 * 2. Client sends opening <stream:stream> element
 * 3. Server responds with its own <stream:stream> and stream ID
 * 4. Server sends <stream:features> advertising capabilities
 * 5. TLS negotiation (STARTTLS or direct TLS)
 * 6. Authentication (Dialback or SASL)
 * 7. XML stanzas exchanged over stream
 * 8. Stream closed with </stream:stream>
 *
 * RFC 6120 specifies XMPP Core
 * RFC 7590 specifies TLS for XMPP
 * RFC 3920 (obsolete) was original XMPP spec
 *
 * XMPP Stream Format:
 * <stream:stream
 *   xmlns='jabber:server'
 *   xmlns:stream='http://etherx.jabber.org/streams'
 *   from='example.com'
 *   to='jabber.org'
 *   version='1.0'>
 *
 *   <!-- Stream features -->
 *   <stream:features>
 *     <starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'>
 *       <required/>
 *     </starttls>
 *   </stream:features>
 *
 *   <!-- Stanzas -->
 *   <iq type='get' id='ping1' to='jabber.org'>
 *     <ping xmlns='urn:xmpp:ping'/>
 *   </iq>
 *
 * </stream:stream>
 *
 * Stanza Types:
 * - <message> - Send messages between users
 * - <presence> - Advertise availability status
 * - <iq> - Info/Query request-response (get, set, result, error)
 *
 * Use Cases:
 * - Federated instant messaging (user@server1.com → user@server2.com)
 * - Multi-server XMPP networks
 * - Corporate XMPP federation with public servers
 * - IoT device communication via XMPP
 */

import { connect } from 'cloudflare:sockets';

interface XmppS2SRequest {
  host: string;
  port?: number;
  fromDomain: string;
  toDomain?: string;
  useTLS?: boolean;
  timeout?: number;
}

interface XmppS2SResponse {
  success: boolean;
  host: string;
  port: number;
  streamId?: string;
  features?: string[];
  stanzas?: string[];
  error?: string;
  rtt?: number;
}

/**
 * Generate a random stream ID.
 */
// function generateStreamId(): string {
//   const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
//   let id = '';
//   for (let i = 0; i < 16; i++) {
//     id += chars[Math.floor(Math.random() * chars.length)];
//   }
//   return id;
// }

/**
 * Generate a random stanza ID.
 */
function generateStanzaId(): string {
  return `id${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Encode XMPP stream opening element.
 */
function encodeStreamOpen(params: {
  fromDomain: string;
  toDomain: string;
}): string {
  const { fromDomain, toDomain } = params;

  return `<?xml version='1.0'?>` +
    `<stream:stream ` +
    `xmlns='jabber:server' ` +
    `xmlns:stream='http://etherx.jabber.org/streams' ` +
    `from='${escapeXml(fromDomain)}' ` +
    `to='${escapeXml(toDomain)}' ` +
    `version='1.0'>`;
}

/**
 * Encode XMPP stream closing element.
 */
function encodeStreamClose(): string {
  return '</stream:stream>';
}

/**
 * Encode XMPP IQ ping stanza.
 */
function encodeIqPing(params: {
  id: string;
  to: string;
  from: string;
}): string {
  const { id, to, from } = params;

  return `<iq type='get' id='${escapeXml(id)}' to='${escapeXml(to)}' from='${escapeXml(from)}'>` +
    `<ping xmlns='urn:xmpp:ping'/>` +
    `</iq>`;
}

/**
 * Escape XML special characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Parse stream:stream opening tag to extract stream ID.
 */
function parseStreamOpen(xml: string): string | null {
  const match = xml.match(/<stream:stream[^>]+id=['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

/**
 * Extract stream features from XML.
 */
function parseStreamFeatures(xml: string): string[] {
  const features: string[] = [];

  // Check for STARTTLS
  if (xml.includes('<starttls') || xml.includes('urn:ietf:params:xml:ns:xmpp-tls')) {
    features.push('STARTTLS');
  }

  // Check for SASL mechanisms
  if (xml.includes('<mechanisms')) {
    const mechanismsMatch = xml.match(/<mechanism>([^<]+)<\/mechanism>/g);
    if (mechanismsMatch) {
      mechanismsMatch.forEach((m) => {
        const mechanism = m.match(/<mechanism>([^<]+)<\/mechanism>/);
        if (mechanism) {
          features.push(`SASL-${mechanism[1]}`);
        }
      });
    }
  }

  // Check for Dialback
  if (xml.includes('dialback') || xml.includes('urn:xmpp:features:dialback')) {
    features.push('DIALBACK');
  }

  // Check for session
  if (xml.includes('<session')) {
    features.push('SESSION');
  }

  // Check for bind
  if (xml.includes('<bind')) {
    features.push('BIND');
  }

  return features;
}

/**
 * Extract XML stanzas from stream (simple extraction).
 */
function extractStanzas(xml: string): string[] {
  const stanzas: string[] = [];

  // Match IQ stanzas
  const iqMatches = xml.match(/<iq[^>]*>.*?<\/iq>/gs);
  if (iqMatches) {
    stanzas.push(...iqMatches);
  }

  // Match message stanzas
  const messageMatches = xml.match(/<message[^>]*>.*?<\/message>/gs);
  if (messageMatches) {
    stanzas.push(...messageMatches);
  }

  // Match presence stanzas
  const presenceMatches = xml.match(/<presence[^>]*>.*?<\/presence>/gs);
  if (presenceMatches) {
    stanzas.push(...presenceMatches);
  }

  // Match stream errors
  const errorMatches = xml.match(/<stream:error>.*?<\/stream:error>/gs);
  if (errorMatches) {
    stanzas.push(...errorMatches);
  }

  return stanzas;
}

/**
 * Test XMPP S2S connection by opening stream.
 */
export async function handleXmppS2SConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as XmppS2SRequest;
    const {
      host,
      port = 5269,
      fromDomain,
      toDomain,
      useTLS = true,
      timeout = 15000,
    } = body;

    // Validation
    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies XmppS2SResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!fromDomain) {
      return new Response(JSON.stringify({
        success: false,
        host,
        port,
        error: 'fromDomain is required (e.g., "example.com")',
      } satisfies XmppS2SResponse), {
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
      } satisfies XmppS2SResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const finalToDomain = toDomain || host;

    // Connect to XMPP server
    const socket = connect(`${host}:${port}`, {
      secureTransport: useTLS ? 'on' : 'off',
      allowHalfOpen: false,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send stream opening
      const streamOpen = encodeStreamOpen({
        fromDomain,
        toDomain: finalToDomain,
      });

      const streamBytes = new TextEncoder().encode(streamOpen);
      await writer.write(streamBytes);
      writer.releaseLock();

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 16384; // 16KB

      const readTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Response timeout')), timeout);
      });

      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            readTimeout,
          ]);

          if (done) break;

          if (value) {
            chunks.push(value);
            totalBytes += value.length;

            if (totalBytes > maxResponseSize) {
              break;
            }

            // Check if we have stream:features (indicates complete response)
            const responseText = new TextDecoder().decode(
              new Uint8Array(chunks.flatMap((c) => Array.from(c)))
            );

            if (responseText.includes('</stream:features>') ||
                responseText.includes('</stream:error>')) {
              break;
            }

            // Also break if we get stream opening and some content
            if (responseText.includes('<stream:stream') && totalBytes > 200) {
              // Wait a bit more for features to arrive
              const extraTimeout = new Promise<{ value: undefined; done: boolean }>((resolve) =>
                setTimeout(() => resolve({ value: undefined, done: false }), 500)
              );
              const extraResult = await Promise.race([reader.read(), extraTimeout]);
              if (extraResult.value) {
                chunks.push(extraResult.value);
                totalBytes += extraResult.value.length;
              }
              break;
            }
          }
        }
      } catch (error) {
        // Socket might close after response
        if (chunks.length === 0) {
          throw error;
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

      const responseText = new TextDecoder().decode(combined);

      // Try to close stream gracefully
      try {
        const closeWriter = socket.writable.getWriter();
        const closeBytes = new TextEncoder().encode(encodeStreamClose());
        await closeWriter.write(closeBytes);
        closeWriter.releaseLock();
      } catch {
        // Ignore close errors
      }

      reader.releaseLock();
      socket.close();

      if (!responseText) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'Empty response from server',
        } satisfies XmppS2SResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Parse stream ID
      const streamId = parseStreamOpen(responseText);

      // Parse features
      const features = parseStreamFeatures(responseText);

      // Extract any stanzas
      const stanzas = extractStanzas(responseText);

      // Check for stream errors
      const hasError = responseText.includes('<stream:error>');

      return new Response(JSON.stringify({
        success: !hasError && streamId !== null,
        host,
        port,
        streamId: streamId || undefined,
        features: features.length > 0 ? features : undefined,
        stanzas: stanzas.length > 0 ? stanzas : undefined,
        rtt,
        error: hasError ? 'Server sent stream error' : undefined,
      } satisfies XmppS2SResponse), {
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
    } satisfies XmppS2SResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Send XMPP S2S IQ ping.
 */
export async function handleXmppS2SPing(request: Request): Promise<Response> {
  try {
    const body = await request.json() as XmppS2SRequest;
    const {
      host,
      port = 5269,
      fromDomain,
      toDomain,
      useTLS = true,
      timeout = 15000,
    } = body;

    // Validation
    if (!host || !fromDomain) {
      return new Response(JSON.stringify({
        success: false,
        host: host || '',
        port,
        error: 'host and fromDomain are required',
      } satisfies XmppS2SResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const finalToDomain = toDomain || host;

    // Connect to XMPP server
    const socket = connect(`${host}:${port}`, {
      secureTransport: useTLS ? 'on' : 'off',
      allowHalfOpen: false,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send stream opening
      const streamOpen = encodeStreamOpen({
        fromDomain,
        toDomain: finalToDomain,
      });

      await writer.write(new TextEncoder().encode(streamOpen));

      // Wait for stream response
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send IQ ping
      const pingId = generateStanzaId();
      const iqPing = encodeIqPing({
        id: pingId,
        to: finalToDomain,
        from: fromDomain,
      });

      await writer.write(new TextEncoder().encode(iqPing));
      writer.releaseLock();

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 16384;

      const readTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Response timeout')), timeout);
      });

      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            readTimeout,
          ]);

          if (done) break;

          if (value) {
            chunks.push(value);
            totalBytes += value.length;

            if (totalBytes > maxResponseSize) {
              break;
            }

            const responseText = new TextDecoder().decode(
              new Uint8Array(chunks.flatMap((c) => Array.from(c)))
            );

            // Check if we have IQ response
            if (responseText.includes(`id='${pingId}'`) ||
                responseText.includes(`id="${pingId}"`)) {
              // Got ping response
              await new Promise((resolve) => setTimeout(resolve, 100));
              break;
            }

            // Or stream error
            if (responseText.includes('</stream:error>')) {
              break;
            }
          }
        }
      } catch (error) {
        if (chunks.length === 0) {
          throw error;
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

      const responseText = new TextDecoder().decode(combined);

      // Try to close stream
      try {
        const closeWriter = socket.writable.getWriter();
        await closeWriter.write(new TextEncoder().encode(encodeStreamClose()));
        closeWriter.releaseLock();
      } catch {
        // Ignore
      }

      reader.releaseLock();
      socket.close();

      const streamId = parseStreamOpen(responseText);
      const features = parseStreamFeatures(responseText);
      const stanzas = extractStanzas(responseText);

      // Check if we got ping response
      const hasPingResponse = responseText.includes(`id='${pingId}'`) ||
                              responseText.includes(`id="${pingId}"`);
      const hasError = responseText.includes('<stream:error>') ||
                       (responseText.includes('<error') && responseText.includes('type=\'error\''));

      return new Response(JSON.stringify({
        success: hasPingResponse && !hasError,
        host,
        port,
        streamId: streamId || undefined,
        features: features.length > 0 ? features : undefined,
        stanzas: stanzas.length > 0 ? stanzas : undefined,
        rtt,
        error: hasError ? 'Server sent error response' : undefined,
      } satisfies XmppS2SResponse), {
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
    } satisfies XmppS2SResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── S2S DIALBACK (XEP-0220) ─────────────────────────────────────────────────

function generateDialbackKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readS2SUntil(
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
    const result = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: boolean }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: false }), remaining)),
    ]);
    if (result.done || !result.value) break;
    chunks.push(result.value);
    total += result.value.length;
    if (total > maxBytes) break;
    // Combine chunks efficiently
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    const text = dec.decode(combined);
    if (text.includes(sentinel)) return text;
  }
  if (chunks.length === 0) return '';
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return dec.decode(combined);
}

/**
 * XMPP S2S stream negotiation — open stream and parse features.
 * Request body: { host, port=5269, fromDomain, toDomain?, timeout=10000 }
 */
export async function handleXMPPS2SConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; fromDomain: string; toDomain?: string; timeout?: number;
    };
    const { host, port = 5269, fromDomain, timeout = 10000 } = body;
    const toDomain = body.toDomain ?? host;

    if (!host || !fromDomain) {
      return new Response(JSON.stringify({ success: false, error: 'host and fromDomain required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const work = (async () => {
      const start = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        // RFC 6120 Section 4.7: Stream opening with proper namespace declarations
        const header = `<?xml version='1.0'?><stream:stream xmlns='jabber:server' xmlns:stream='http://etherx.jabber.org/streams' to='${escapeXml(toDomain)}' from='${escapeXml(fromDomain)}' version='1.0'>`;
        await writer.write(new TextEncoder().encode(header));
        writer.releaseLock();

        const raw = await readS2SUntil(reader, '</stream:features>', 32768, timeout);
        const latencyMs = Date.now() - start;
        reader.releaseLock();
        try { socket.close(); } catch { /* ignore */ }

        const streamId = parseStreamOpen(raw);
        const features = parseStreamFeatures(raw);
        const domainMatch = raw.match(/<stream:stream[^>]+from=['"]([\w.\-]+)['"]/);
        const versionMatch = raw.match(/<stream:stream[^>]+version=['"]([\d.]+)['"]/);

        return {
          success: !!streamId,
          streamId: streamId ?? undefined,
          serverDomain: domainMatch?.[1] ?? toDomain,
          features,
          version: versionMatch?.[1] ?? '1.0',
          latencyMs,
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([work, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * XMPP S2S Dialback (XEP-0220) — send dialback key and parse result.
 * Request body: { host, port=5269, fromDomain, toDomain?, timeout=10000 }
 */
export async function handleXMPPS2SDialback(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; fromDomain: string; toDomain?: string; timeout?: number;
    };
    const { host, port = 5269, fromDomain, timeout = 10000 } = body;
    const toDomain = body.toDomain ?? host;

    if (!host || !fromDomain) {
      return new Response(JSON.stringify({ success: false, error: 'host and fromDomain required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    const work = (async () => {
      const start = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();
      try {
        // Step 1: Send stream header with proper namespaces (RFC 6120 Section 4.7)
        // XEP-0220 dialback namespace is declared when sending db:result, not in stream header
        const header = `<?xml version='1.0'?><stream:stream xmlns='jabber:server' xmlns:stream='http://etherx.jabber.org/streams' to='${escapeXml(toDomain)}' from='${escapeXml(fromDomain)}' version='1.0'>`;
        await writer.write(new TextEncoder().encode(header));

        // Step 2: Read stream features
        let raw = await readS2SUntil(reader, '</stream:features>', 32768, timeout);
        const streamId = parseStreamOpen(raw);
        const features = parseStreamFeatures(raw);
        const tlsOffered = features.includes('STARTTLS');

        // Step 3: Send dialback key (XEP-0220 Section 2.1)
        const key = generateDialbackKey();
        const dbResult = `<db:result xmlns:db='jabber:server:dialback' from='${escapeXml(fromDomain)}' to='${escapeXml(toDomain)}'>${key}</db:result>`;
        await writer.write(new TextEncoder().encode(dbResult));
        writer.releaseLock();

        // Step 4: Read dialback response
        const resp = await readS2SUntil(reader, 'db:result', 32768, Math.min(timeout, 5000)).catch(() => '');
        raw += resp;
        const latencyMs = Date.now() - start;
        reader.releaseLock();
        try { socket.close(); } catch { /* ignore */ }

        let dialbackResult: 'valid' | 'invalid' | 'error' | 'pending' = 'pending';
        if (raw.match(/<db:result[^>]+type=['"]valid['"]/)) dialbackResult = 'valid';
        else if (raw.match(/<db:result[^>]+type=['"]invalid['"]/)) dialbackResult = 'invalid';
        else if (raw.includes('<stream:error')) dialbackResult = 'error';

        return {
          success: dialbackResult === 'valid',
          streamId: streamId ?? undefined,
          features,
          dialbackResult,
          tlsOffered,
          latencyMs,
          raw: raw.slice(0, 4096),
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([work, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
