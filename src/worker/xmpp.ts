/**
 * XMPP Protocol Implementation (RFC 6120)
 *
 * XMPP (Extensible Messaging and Presence Protocol) is the standard for
 * instant messaging, presence, and real-time communication. Formerly known
 * as Jabber, it uses XML streams over TCP on port 5222.
 *
 * Protocol Flow:
 * 1. Client opens XML stream to server
 * 2. Server responds with stream features (TLS, SASL mechanisms)
 * 3. Client can negotiate STARTTLS, then authenticate via SASL
 * 4. After auth, client binds a resource and starts a session
 *
 * This implementation provides:
 * - Connection testing (stream opening + feature discovery)
 * - Server feature detection (TLS, auth mechanisms)
 * - Server identity probing
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Escape special XML characters in user-supplied values to prevent XML injection.
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
 * Read data from socket with timeout
 */
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs),
  );

  const readPromise = (async () => {
    let buffer = '';
    // Read chunks until we have enough XML to parse
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Check if we have a complete stream:features or stream:error block
      if (
        buffer.includes('</stream:features>') ||
        buffer.includes('</stream:error>') ||
        buffer.includes('<stream:error') ||
        buffer.includes('</features>') ||
        // Some servers send features immediately after stream header
        (buffer.includes('<stream:stream') && buffer.includes('</stream:features>'))
      ) {
        return buffer;
      }

      // If we've read a lot without finding features, return what we have
      if (buffer.length > 8192) {
        return buffer;
      }
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Parse XMPP stream features from XML response using regex
 * (avoids needing a full XML parser in Workers)
 */
function parseStreamFeatures(xml: string): {
  streamId: string | null;
  serverFrom: string | null;
  version: string | null;
  tlsRequired: boolean;
  tlsAvailable: boolean;
  saslMechanisms: string[];
  compressionMethods: string[];
  features: string[];
} {
  const streamId = xml.match(/id=['"]([^'"]+)['"]/)?.[1] || null;
  const serverFrom = xml.match(/from=['"]([^'"]+)['"]/)?.[1] || null;
  const version = xml.match(/version=['"]([^'"]+)['"]/)?.[1] || null;

  // TLS — scope the <required> check to the <starttls> block to avoid
  // false positives from <bind><required/></bind> (RFC 6120 §7.4).
  const tlsAvailable = xml.includes('urn:ietf:params:xml:ns:xmpp-tls') || xml.includes('<starttls');
  let tlsRequired = false;
  if (tlsAvailable) {
    const starttlsMatch = xml.match(/<starttls[\s\S]*?<\/starttls>/);
    if (starttlsMatch) {
      tlsRequired = starttlsMatch[0].includes('<required');
    }
  }

  // SASL mechanisms
  const saslMechanisms: string[] = [];
  const mechanismRegex = /<mechanism>([^<]+)<\/mechanism>/g;
  let match;
  while ((match = mechanismRegex.exec(xml)) !== null) {
    saslMechanisms.push(match[1]);
  }

  // Compression methods
  const compressionMethods: string[] = [];
  const compressionRegex = /<method>([^<]+)<\/method>/g;
  while ((match = compressionRegex.exec(xml)) !== null) {
    compressionMethods.push(match[1]);
  }

  // Other features
  const features: string[] = [];
  if (xml.includes('urn:ietf:params:xml:ns:xmpp-bind') || xml.includes('<bind')) {
    features.push('resource-binding');
  }
  if (xml.includes('urn:ietf:params:xml:ns:xmpp-session') || xml.includes('<session')) {
    features.push('session');
  }
  if (xml.includes('urn:xmpp:sm:') || xml.includes('stream-management')) {
    features.push('stream-management');
  }
  if (xml.includes('urn:xmpp:features:rosterver')) {
    features.push('roster-versioning');
  }
  if (xml.includes('urn:xmpp:csi:')) {
    features.push('client-state-indication');
  }
  if (xml.includes('urn:xmpp:carbons:')) {
    features.push('message-carbons');
  }
  if (tlsAvailable) {
    features.push('starttls');
  }

  return {
    streamId,
    serverFrom,
    version,
    tlsRequired,
    tlsAvailable,
    saslMechanisms,
    compressionMethods,
    features: [...new Set(features)],
  };
}

/**
 * Handle XMPP connection test
 * POST /api/xmpp/connect
 *
 * Opens an XML stream to the XMPP server, reads stream features,
 * and reports server capabilities (TLS, SASL mechanisms, etc.)
 */
export async function handleXMPPConnect(request: Request): Promise<Response> {
  try {
    const { host, port = 5222, domain, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      domain?: string;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const connectionPromise = (async () => {
      // Use 'starttls' transport so the probe accurately reflects TLS capability
      const socket = connect(`${host}:${port}`, { secureTransport: 'starttls', allowHalfOpen: false });
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // The domain to use in the 'to' attribute - defaults to host
        const targetDomain = domain || host;

        // Send XMPP stream opening
        const streamOpen =
          `<?xml version='1.0'?>` +
          `<stream:stream ` +
          `to='${escapeXml(targetDomain)}' ` +
          `xmlns='jabber:client' ` +
          `xmlns:stream='http://etherx.jabber.org/streams' ` +
          `version='1.0'>`;

        await writer.write(encoder.encode(streamOpen));

        // Read server response (stream header + features)
        const response = await readWithTimeout(reader, 5000);

        // Check for stream errors
        if (response.includes('<stream:error') || response.includes('<not-authorized')) {
          const errorMatch = response.match(/<([a-z-]+)\s*xmlns='urn:ietf:params:xml:ns:xmpp-streams'/);
          const errorType = errorMatch?.[1] || 'unknown-error';

          // Try to close cleanly
          try {
            await writer.write(encoder.encode('</stream:stream>'));
          } catch {
            // Ignore close errors
          }
          await socket.close();

          return {
            success: false,
            error: `XMPP stream error: ${errorType}`,
            host,
            port,
            raw: response.substring(0, 2000),
          };
        }

        // Parse the features
        const features = parseStreamFeatures(response);

        // Send stream close
        try {
          await writer.write(encoder.encode('</stream:stream>'));
        } catch {
          // Ignore close errors
        }

        await socket.close();

        return {
          success: true,
          message: 'XMPP server reachable',
          host,
          port,
          domain: targetDomain,
          streamId: features.streamId,
          serverFrom: features.serverFrom,
          xmppVersion: features.version,
          tls: {
            available: features.tlsAvailable,
            required: features.tlsRequired,
          },
          saslMechanisms: features.saslMechanisms,
          compressionMethods: features.compressionMethods,
          features: features.features,
          raw: response.substring(0, 2000),
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Read XMPP stream until one of the given patterns appears or timeout.
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  patterns: string[],
  timeoutMs: number,
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs),
  );

  const readPromise = (async () => {
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (patterns.some(p => buffer.includes(p))) return buffer;
      if (buffer.length > 65536) return buffer;
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Open an XMPP stream and wait for stream features.
 */
async function openXMPPStream(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  domain: string,
): Promise<string> {
  const streamOpen =
    `<?xml version='1.0'?>` +
    `<stream:stream to='${escapeXml(domain)}' xmlns='jabber:client' ` +
    `xmlns:stream='http://etherx.jabber.org/streams' version='1.0'>`;
  await writer.write(encoder.encode(streamOpen));
  return readUntil(reader, ['</stream:features>', '<stream:error', '</features>'], 5000);
}

/**
 * Attempt STARTTLS upgrade on an open XMPP stream (RFC 6120 §5).
 *
 * Protocol exchange:
 *   Client → <starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>
 *   Server ← <proceed xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>
 *   [TLS handshake via socket.startTls()]
 *   Client → new XML stream header
 *   Server ← new stream:features (with SASL mechanisms)
 *
 * The Cloudflare Workers `socket.startTls()` API requires:
 *  1. The socket was opened with `secureTransport: 'starttls'`.
 *  2. All reader/writer locks are released before calling startTls().
 *
 * Returns a tuple of [newReader, newWriter, newFeaturesXml] after the upgrade,
 * or throws if TLS is unavailable or the server rejects the upgrade.
 *
 * NOTE: If the socket does not expose `startTls` (older type stubs), we throw
 * a descriptive error so the caller can fall back gracefully.
 */
async function performStartTLS(
  socket: ReturnType<typeof connect>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  domain: string,
): Promise<{
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  featuresXml: string;
}> {
  // Send STARTTLS request
  await writer.write(encoder.encode(
    `<starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>`,
  ));

  // Wait for <proceed/> or <failure/>
  const resp = await readUntil(reader, ['<proceed', '<failure'], 5000);
  if (!resp.includes('<proceed')) {
    throw new Error('STARTTLS rejected by server (received <failure/>)');
  }

  // Release locks before TLS upgrade — required by the Cloudflare Workers API
  reader.releaseLock();
  writer.releaseLock();

  // Upgrade socket to TLS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const socketAny = socket as any;
  if (typeof socketAny.startTls !== 'function') {
    throw new Error(
      'STARTTLS: socket.startTls() is not available in this Workers runtime. ' +
      'Ensure the socket was created with secureTransport: "starttls". ' +
      'STARTTLS upgrade cannot proceed.',
    );
  }

  const tlsSocket = socketAny.startTls() as ReturnType<typeof connect>;
  const newReader = tlsSocket.readable.getReader();
  const newWriter = tlsSocket.writable.getWriter();

  // Re-open XML stream over the now-encrypted channel
  const featuresXml = await openXMPPStream(newWriter, newReader, domain);

  if (!featuresXml.includes('urn:ietf:params:xml:ns:xmpp-sasl') && !featuresXml.includes('<mechanisms')) {
    throw new Error('Server did not advertise SASL mechanisms after STARTTLS');
  }

  return { reader: newReader, writer: newWriter, featuresXml };
}

/**
 * Handle XMPP SASL PLAIN login, resource binding, and session establishment.
 * POST /api/xmpp/login
 *
 * Accept JSON: {host, port?, username, password, timeout?}
 */
export async function handleXMPPLogin(request: Request): Promise<Response> {
  try {
    const { host, port = 5222, username, password, timeout = 15000 } = await request.json() as {
      host: string; port?: number; username: string; password: string; timeout?: number;
    };

    if (!host || !username || !password) {
      return new Response(JSON.stringify({
        success: false, error: 'host, username, and password are required',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const domain = host;
    const phases: string[] = [];

    const connectionPromise = (async () => {
      // Use 'starttls' transport so socket.startTls() is available for STARTTLS upgrade
      const socket = connect(`${host}:${port}`, { secureTransport: 'starttls', allowHalfOpen: false });
      await socket.opened;
      let reader = socket.readable.getReader();
      let writer = socket.writable.getWriter();

      try {
        let featuresXml = await openXMPPStream(writer, reader, domain);
        phases.push('stream_opened');
        let features = parseStreamFeatures(featuresXml);

        // RFC 6120 §5 — attempt STARTTLS if offered before SASL auth
        if (features.tlsAvailable) {
          try {
            const tls = await performStartTLS(socket, reader, writer, domain);
            reader = tls.reader;
            writer = tls.writer;
            featuresXml = tls.featuresXml;
            features = parseStreamFeatures(featuresXml);
            phases.push('starttls_upgraded');
          } catch (tlsErr) {
            // If TLS upgrade fails but not required, continue on plaintext
            if (features.tlsRequired) {
              throw tlsErr;
            }
            phases.push(`starttls_skipped: ${tlsErr instanceof Error ? tlsErr.message : String(tlsErr)}`);
          }
        }

        if (!features.saslMechanisms.includes('PLAIN')) {
          try { await socket.close(); } catch { /* ignore */ }
          return {
            success: false, host, port, phases,
            error: `SASL PLAIN not supported. Available: ${features.saslMechanisms.join(', ')}`,
          };
        }

        // SASL PLAIN: base64(\0username\0password)
        // Use TextEncoder for UTF-8 support (btoa alone fails on non-Latin chars)
        const saslBytes = new TextEncoder().encode(`\0${username}\0${password}`);
        let saslBinary = '';
        for (let i = 0; i < saslBytes.length; i++) saslBinary += String.fromCharCode(saslBytes[i]);
        const authStr = btoa(saslBinary);
        await writer.write(encoder.encode(
          `<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='PLAIN'>${escapeXml(authStr)}</auth>`,
        ));
        phases.push('sasl_plain_sent');

        const authResp = await readUntil(reader, ['<success', '<failure'], 5000);
        if (!authResp.includes('<success')) {
          const failureMatch = authResp.match(/<([a-z-]+)\s*\/>/);
          try { await socket.close(); } catch { /* ignore */ }
          return {
            success: false, host, port, phases,
            error: `SASL authentication failed: ${failureMatch?.[1] || 'unknown failure'}`,
          };
        }
        phases.push('authenticated');

        // Restart stream after auth
        const newFeaturesXml = await openXMPPStream(writer, reader, domain);
        phases.push('stream_restarted');
        const newFeat = parseStreamFeatures(newFeaturesXml);

        // Bind resource
        await writer.write(encoder.encode(
          `<iq type='set' id='bind1'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>portofcall</resource></bind></iq>`,
        ));
        const bindResp = await readUntil(reader, ['</iq>', '<iq '], 5000);
        phases.push('resource_bound');
        const jidMatch = bindResp.match(/<jid>([^<]+)<\/jid>/);
        const jid = jidMatch?.[1] || `${username}@${domain}/portofcall`;

        // Establish session (optional but commonly required)
        if (newFeat.features.includes('session')) {
          await writer.write(encoder.encode(
            `<iq type='set' id='sess1'><session xmlns='urn:ietf:params:xml:ns:xmpp-session'/></iq>`,
          ));
          await readUntil(reader, ['</iq>'], 5000).catch(() => '');
          phases.push('session_established');
        }

        try { await writer.write(encoder.encode('</stream:stream>')); } catch { /* ignore */ }
        await socket.close();

        return {
          success: true, host, port, phases, jid, domain,
          features: newFeat.features, saslMechanisms: features.saslMechanisms,
          message: 'XMPP login successful',
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore */ }
        return {
          success: false, host, port, phases,
          error: error instanceof Error ? error.message : 'XMPP login failed',
        };
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'XMPP login failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle XMPP roster (contact list) retrieval.
 * POST /api/xmpp/roster
 *
 * Accept JSON: {host, port?, username, password, timeout?}
 */
export async function handleXMPPRoster(request: Request): Promise<Response> {
  try {
    const { host, port = 5222, username, password, timeout = 20000 } = await request.json() as {
      host: string; port?: number; username: string; password: string; timeout?: number;
    };

    if (!host || !username || !password) {
      return new Response(JSON.stringify({
        success: false, error: 'host, username, and password are required',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const domain = host;
    const phases: string[] = [];

    const connectionPromise = (async () => {
      // Use 'starttls' transport so socket.startTls() is available for STARTTLS upgrade
      const socket = connect(`${host}:${port}`, { secureTransport: 'starttls', allowHalfOpen: false });
      await socket.opened;
      let reader = socket.readable.getReader();
      let writer = socket.writable.getWriter();

      try {
        let featuresXml = await openXMPPStream(writer, reader, domain);
        phases.push('stream_opened');
        let features = parseStreamFeatures(featuresXml);

        // RFC 6120 §5 — attempt STARTTLS if offered before SASL auth
        if (features.tlsAvailable) {
          try {
            const tls = await performStartTLS(socket, reader, writer, domain);
            reader = tls.reader;
            writer = tls.writer;
            featuresXml = tls.featuresXml;
            features = parseStreamFeatures(featuresXml);
            phases.push('starttls_upgraded');
          } catch (tlsErr) {
            if (features.tlsRequired) throw tlsErr;
            phases.push(`starttls_skipped: ${tlsErr instanceof Error ? tlsErr.message : String(tlsErr)}`);
          }
        }

        if (!features.saslMechanisms.includes('PLAIN')) {
          try { await socket.close(); } catch { /* ignore */ }
          return { success: false, host, port, phases, error: 'SASL PLAIN not available' };
        }

        const saslAuthBytes = new TextEncoder().encode(`\0${username}\0${password}`);
        let saslAuthBinary = '';
        for (let i = 0; i < saslAuthBytes.length; i++) saslAuthBinary += String.fromCharCode(saslAuthBytes[i]);
        const authStr = btoa(saslAuthBinary);
        await writer.write(encoder.encode(
          `<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='PLAIN'>${escapeXml(authStr)}</auth>`,
        ));
        const authResp = await readUntil(reader, ['<success', '<failure'], 5000);
        if (!authResp.includes('<success')) {
          try { await socket.close(); } catch { /* ignore */ }
          return { success: false, host, port, phases, error: 'Authentication failed' };
        }
        phases.push('authenticated');

        const newFeatXml = await openXMPPStream(writer, reader, domain);
        const newFeat = parseStreamFeatures(newFeatXml);
        phases.push('stream_restarted');

        await writer.write(encoder.encode(
          `<iq type='set' id='bind1'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>portofcall</resource></bind></iq>`,
        ));
        const bindResp = await readUntil(reader, ['</iq>'], 5000);
        const jidMatch = bindResp.match(/<jid>([^<]+)<\/jid>/);
        const jid = jidMatch?.[1] || `${username}@${domain}/portofcall`;
        phases.push('resource_bound');

        if (newFeat.features.includes('session')) {
          await writer.write(encoder.encode(
            `<iq type='set' id='sess1'><session xmlns='urn:ietf:params:xml:ns:xmpp-session'/></iq>`,
          ));
          await readUntil(reader, ['</iq>'], 5000).catch(() => '');
          phases.push('session_established');
        }

        // Request roster
        await writer.write(encoder.encode(
          `<iq type='get' id='roster1'><query xmlns='jabber:iq:roster'/></iq>`,
        ));
        const rosterResp = await readUntil(reader, ['</iq>', '<iq '], 8000);
        phases.push('roster_received');

        // Parse roster contacts
        const contacts: Array<{ jid: string; name: string | null; subscription: string; groups: string[] }> = [];
        const itemRegex = /<item\s+([^>]+)>/g;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(rosterResp)) !== null) {
          const attrs = itemMatch[1];
          const getAttr = (name: string) => attrs.match(new RegExp(`${name}=['"]([^'"]+)['"]`))?.[1] || null;
          const jidAttr = getAttr('jid');
          if (!jidAttr) continue;
          const groups: string[] = [];
          const groupRegex = /<group>([^<]+)<\/group>/g;
          let gm;
          const ctx = rosterResp.substring(itemMatch.index, itemMatch.index + 500);
          while ((gm = groupRegex.exec(ctx)) !== null) groups.push(gm[1]);
          contacts.push({ jid: jidAttr, name: getAttr('name'), subscription: getAttr('subscription') || 'none', groups });
        }

        try { await writer.write(encoder.encode('</stream:stream>')); } catch { /* ignore */ }
        await socket.close();

        return { success: true, host, port, phases, jid, roster: { total: contacts.length, contacts } };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore */ }
        return { success: false, host, port, phases, error: error instanceof Error ? error.message : 'Roster fetch failed' };
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'XMPP roster failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Handle XMPP message send.
 * POST /api/xmpp/message
 *
 * Accept JSON: {host, port?, username, password, recipient, message?, timeout?}
 */
export async function handleXMPPMessage(request: Request): Promise<Response> {
  try {
    const {
      host, port = 5222, username, password, recipient,
      message = 'Hello from PortOfCall', timeout = 20000,
    } = await request.json() as {
      host: string; port?: number; username: string; password: string;
      recipient?: string; message?: string; timeout?: number;
    };

    if (!host || !username || !password) {
      return new Response(JSON.stringify({
        success: false, error: 'host, username, and password are required',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (!recipient) {
      return new Response(JSON.stringify({ success: false, error: 'recipient is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false, error: getCloudflareErrorMessage(host, cfCheck.ip), isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const domain = host;
    const phases: string[] = [];

    const connectionPromise = (async () => {
      // Use 'starttls' transport so socket.startTls() is available for STARTTLS upgrade
      const socket = connect(`${host}:${port}`, { secureTransport: 'starttls', allowHalfOpen: false });
      await socket.opened;
      let reader = socket.readable.getReader();
      let writer = socket.writable.getWriter();

      try {
        let featuresXml = await openXMPPStream(writer, reader, domain);
        phases.push('stream_opened');
        let features = parseStreamFeatures(featuresXml);

        // RFC 6120 §5 — attempt STARTTLS if offered before SASL auth
        if (features.tlsAvailable) {
          try {
            const tls = await performStartTLS(socket, reader, writer, domain);
            reader = tls.reader;
            writer = tls.writer;
            featuresXml = tls.featuresXml;
            features = parseStreamFeatures(featuresXml);
            phases.push('starttls_upgraded');
          } catch (tlsErr) {
            if (features.tlsRequired) throw tlsErr;
            phases.push(`starttls_skipped: ${tlsErr instanceof Error ? tlsErr.message : String(tlsErr)}`);
          }
        }

        if (!features.saslMechanisms.includes('PLAIN')) {
          try { await socket.close(); } catch { /* ignore */ }
          return { success: false, host, port, phases, error: 'SASL PLAIN not available' };
        }

        const saslAuthBytes = new TextEncoder().encode(`\0${username}\0${password}`);
        let saslAuthBinary = '';
        for (let i = 0; i < saslAuthBytes.length; i++) saslAuthBinary += String.fromCharCode(saslAuthBytes[i]);
        const authStr = btoa(saslAuthBinary);
        await writer.write(encoder.encode(
          `<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='PLAIN'>${escapeXml(authStr)}</auth>`,
        ));
        const authResp = await readUntil(reader, ['<success', '<failure'], 5000);
        if (!authResp.includes('<success')) {
          try { await socket.close(); } catch { /* ignore */ }
          return { success: false, host, port, phases, error: 'Authentication failed' };
        }
        phases.push('authenticated');

        const newFeatXml = await openXMPPStream(writer, reader, domain);
        const newFeat = parseStreamFeatures(newFeatXml);
        phases.push('stream_restarted');

        await writer.write(encoder.encode(
          `<iq type='set' id='bind1'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>portofcall</resource></bind></iq>`,
        ));
        const bindResp = await readUntil(reader, ['</iq>'], 5000);
        const jidMatch = bindResp.match(/<jid>([^<]+)<\/jid>/);
        const jid = jidMatch?.[1] || `${username}@${domain}/portofcall`;
        phases.push('resource_bound');

        if (newFeat.features.includes('session')) {
          await writer.write(encoder.encode(
            `<iq type='set' id='sess1'><session xmlns='urn:ietf:params:xml:ns:xmpp-session'/></iq>`,
          ));
          await readUntil(reader, ['</iq>'], 5000).catch(() => '');
          phases.push('session_established');
        }

        const msgId = `poc_${Date.now()}`;
        await writer.write(encoder.encode(
          `<message to='${escapeXml(recipient)}' type='chat' id='${escapeXml(msgId)}'><body>${escapeXml(message)}</body></message>`,
        ));
        phases.push('message_sent');

        // Brief pause to detect delivery error
        const echoOrError = await readUntil(reader, ['<message ', '<presence ', '<iq '], 2000).catch(() => '');
        const deliveryError = echoOrError.includes('<error') ? echoOrError.match(/<error[^>]*>([\s\S]*?)<\/error>/)?.[1] || null : null;

        try { await writer.write(encoder.encode('</stream:stream>')); } catch { /* ignore */ }
        await socket.close();

        return {
          success: true, host, port, phases, jid,
          message: { to: recipient, body: message, id: msgId },
          deliveryError,
        };
      } catch (error) {
        try { await socket.close(); } catch { /* ignore */ }
        return { success: false, host, port, phases, error: error instanceof Error ? error.message : 'Message send failed' };
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : 'XMPP message send failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
