/**
 * Jabber Component Protocol (XEP-0114)
 *
 * The Jabber Component Protocol allows external components to connect to an
 * XMPP server. Components act as sub-domains and can provide services like
 * gateways (IRC, MSN), bots, or specialized functionality.
 *
 * Protocol Overview:
 * - Port: 5275 (standard component port, configurable)
 * - Transport: TCP
 * - Format: XML streaming protocol
 * - Namespace: jabber:component:accept
 * - Authentication: SHA-1 hash handshake
 *
 * Connection Flow:
 * 1. Client → Server: <stream:stream xmlns='jabber:component:accept' to='component.domain'>
 * 2. Server → Client: <stream:stream id='streamID' from='component.domain'>
 * 3. Client → Server: <handshake>SHA1(streamID + secret)</handshake>
 * 4. Server → Client: <handshake/> (success) or <stream:error> (failure)
 *
 * Handshake Calculation:
 * - Concatenate: streamID + sharedSecret
 * - Hash: SHA-1(streamID + secret)
 * - Encode: Lowercase hexadecimal
 * - Send: <handshake>hexhash</handshake>
 *
 * Example:
 * - Stream ID: "abc123"
 * - Secret: "mysecret"
 * - Input: "abc123mysecret"
 * - Hash: SHA1("abc123mysecret") = "3c5b..."
 * - Send: <handshake>3c5b...</handshake>
 *
 * Success Response:
 * - <handshake/> (empty element)
 *
 * Error Responses:
 * - <stream:error><not-authorized/></stream:error>
 * - <stream:error><host-unknown/></stream:error>
 * - <stream:error><invalid-namespace/></stream:error>
 *
 * Use Cases:
 * - IRC gateway (component bridges XMPP ↔ IRC)
 * - Transport services (MSN, Yahoo, AIM gateways)
 * - Bots and automation
 * - Custom XMPP services
 * - Multi-user chat (MUC) components
 *
 * Reference:
 * - XEP-0114: Jabber Component Protocol
 * - https://xmpp.org/extensions/xep-0114.html
 */

import { connect } from 'cloudflare:sockets';

interface JabberComponentRequest {
  host: string;
  port?: number;
  timeout?: number;
  componentName?: string;
  secret?: string;
}

interface JabberComponentResponse {
  success: boolean;
  host: string;
  port: number;
  streamId?: string;
  authenticated?: boolean;
  serverResponse?: string;
  features?: string[];
  rtt?: number;
  error?: string;
}

/**
 * Build Jabber Component stream initialization
 */
function buildComponentStreamInit(componentName: string): string {
  return `<?xml version='1.0'?>` +
    `<stream:stream ` +
    `xmlns='jabber:component:accept' ` +
    `xmlns:stream='http://etherx.jabber.org/streams' ` +
    `to='${xmlEscape(componentName)}'>`;
}

/**
 * Build handshake element with SHA-1 hash
 */
async function buildHandshake(streamId: string, secret: string): Promise<string> {
  const input = streamId + secret;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  // SHA-1 hash
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return `<handshake>${hashHex}</handshake>`;
}

/**
 * Parse XMPP/Jabber stream response
 */
function parseStreamResponse(data: string): {
  streamId?: string;
  from?: string;
  hasHandshakeSuccess?: boolean;
  hasError?: boolean;
  errorType?: string;
} {
  const result: {
    streamId?: string;
    from?: string;
    hasHandshakeSuccess?: boolean;
    hasError?: boolean;
    errorType?: string;
  } = {};

  // Extract stream id
  const streamIdMatch = data.match(/id=['"]([^'"]+)['"]/);
  if (streamIdMatch) {
    result.streamId = streamIdMatch[1];
  }

  // Extract from attribute
  const fromMatch = data.match(/from=['"]([^'"]+)['"]/);
  if (fromMatch) {
    result.from = fromMatch[1];
  }

  // Check for handshake success (empty <handshake/> element or <handshake></handshake>)
  if (data.includes('<handshake/>') || data.includes('<handshake />') || data.includes('<handshake></handshake>')) {
    result.hasHandshakeSuccess = true;
  }

  // Check for stream errors
  if (data.includes('<stream:error>') || data.includes('</error>')) {
    result.hasError = true;

    // Identify error type (RFC 6120 section 4.9.3 stream error conditions)
    if (data.includes('<not-authorized')) {
      result.errorType = 'not-authorized';
    } else if (data.includes('<host-unknown')) {
      result.errorType = 'host-unknown';
    } else if (data.includes('<invalid-namespace')) {
      result.errorType = 'invalid-namespace';
    } else if (data.includes('<invalid-xml')) {
      result.errorType = 'invalid-xml';
    } else if (data.includes('<connection-timeout')) {
      result.errorType = 'connection-timeout';
    } else if (data.includes('<system-shutdown')) {
      result.errorType = 'system-shutdown';
    } else if (data.includes('<conflict')) {
      result.errorType = 'conflict';
    } else {
      result.errorType = 'unknown';
    }
  }

  return result;
}

/**
 * Probe Jabber Component server.
 * Opens connection and performs stream initialization to detect component support.
 */
export async function handleJabberComponentProbe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as JabberComponentRequest;
    const {
      host,
      port = 5275,
      timeout = 15000,
      componentName = 'component.localhost',
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        host: '',
        port,
        error: 'Host is required',
      } satisfies JabberComponentResponse), {
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
      } satisfies JabberComponentResponse), {
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

      // Send component stream initialization
      const streamInit = buildComponentStreamInit(componentName);

      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(streamInit));
      writer.releaseLock();

      // Read server response
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
          error: 'No response from Jabber Component server',
        } satisfies JabberComponentResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const responseText = new TextDecoder().decode(value);
      const parsed = parseStreamResponse(responseText);

      const rtt = Date.now() - start;

      reader.releaseLock();
      socket.close();

      // Check if stream was successfully opened
      if (parsed.streamId) {
        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          streamId: parsed.streamId,
          serverResponse: responseText.trim(),
          rtt,
        } satisfies JabberComponentResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (parsed.hasError) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          serverResponse: responseText.trim(),
          error: `Stream error: ${parsed.errorType || 'unknown'}`,
          rtt,
        } satisfies JabberComponentResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          serverResponse: responseText.trim(),
          error: 'Invalid component stream response',
          rtt,
        } satisfies JabberComponentResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      host: '',
      port: 5275,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies JabberComponentResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Perform full Jabber Component handshake with authentication.
 * Requires shared secret for SHA-1 handshake.
 */
export async function handleJabberComponentHandshake(request: Request): Promise<Response> {
  try {
    const body = await request.json() as JabberComponentRequest;
    const {
      host,
      port = 5275,
      timeout = 15000,
      componentName = 'component.localhost',
      secret,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!secret) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Secret is required for handshake',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      // Send stream init
      const streamInit = buildComponentStreamInit(componentName);

      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(streamInit));

      // Read stream response to get stream ID
      const reader = socket.readable.getReader();

      const { value: streamValue, done: streamDone } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (streamDone || !streamValue) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No stream response',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const streamResponse = new TextDecoder().decode(streamValue);
      const parsed = parseStreamResponse(streamResponse);

      if (!parsed.streamId) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          serverResponse: streamResponse.trim(),
          error: 'No stream ID received',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Build and send handshake
      const handshake = await buildHandshake(parsed.streamId, secret);
      await writer.write(new TextEncoder().encode(handshake));
      writer.releaseLock();

      // Read handshake response
      const { value: handshakeValue, done: handshakeDone } = await Promise.race([
        reader.read(),
        timeoutPromise,
      ]);

      if (handshakeDone || !handshakeValue) {
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          error: 'No handshake response',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const handshakeResponse = new TextDecoder().decode(handshakeValue);
      const handshakeParsed = parseStreamResponse(handshakeResponse);

      reader.releaseLock();
      socket.close();

      // Check for success
      if (handshakeParsed.hasHandshakeSuccess) {
        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          authenticated: true,
          streamId: parsed.streamId,
          serverResponse: handshakeResponse.trim(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (handshakeParsed.hasError) {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          authenticated: false,
          streamId: parsed.streamId,
          serverResponse: handshakeResponse.trim(),
          error: `Authentication failed: ${handshakeParsed.errorType || 'unknown'}`,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({
          success: false,
          host,
          port,
          authenticated: false,
          streamId: parsed.streamId,
          serverResponse: handshakeResponse.trim(),
          error: 'Unexpected handshake response',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

    } catch (error) {
      socket.close();
      throw error;
    }

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

interface JabberComponentSendRequest {
  host: string;
  port?: number;
  timeout?: number;
  componentDomain: string;
  secret: string;
  from: string;
  to: string;
  body?: string;
}

interface JabberComponentSendResponse {
  handshake: 'ok' | 'failed' | 'error';
  streamId?: string;
  messageSent?: boolean;
  iqPong?: boolean;
  serverResponse?: string;
  rtt?: number;
  error?: string;
}

/**
 * Escape a string for safe inclusion as XML text content or attribute value.
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Read accumulated data from socket with a short deadline.
 * Returns everything received within `ms` milliseconds.
 */
async function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';

  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

  while (true) {
    const result = await Promise.race([
      reader.read().then(r => r),
      deadline.then(() => ({ done: true as const, value: undefined })),
    ]);

    if (result.done || !result.value) break;
    text += decoder.decode(result.value, { stream: true });
  }

  return text;
}

/**
 * Perform a full Jabber Component connection, authenticate, then send a
 * message stanza (if body is provided) or an IQ ping stanza.
 *
 * Connection flow:
 *   1. Send stream open to componentDomain
 *   2. Read server stream tag, extract id attribute
 *   3. Send SHA-1 handshake: SHA1(streamId + secret)
 *   4. Read <handshake/> confirmation
 *   5a. If body is provided: send <message from to><body>...</body></message>
 *   5b. Otherwise: send IQ ping and wait for pong
 *
 * Returns: { handshake, streamId, messageSent, iqPong, rtt }
 */
export async function handleJabberComponentSend(request: Request): Promise<Response> {
  try {
    const body = await request.json() as JabberComponentSendRequest;
    const {
      host,
      port = 5275,
      timeout = 15000,
      componentDomain,
      secret,
      from,
      to,
      body: messageBody,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        handshake: 'error',
        error: 'Host is required',
      } satisfies JabberComponentSendResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!componentDomain || !secret) {
      return new Response(JSON.stringify({
        handshake: 'error',
        error: 'componentDomain and secret are required',
      } satisfies JabberComponentSendResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!from || !to) {
      return new Response(JSON.stringify({
        handshake: 'error',
        error: 'from and to JID fields are required',
      } satisfies JabberComponentSendResponse), {
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

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Send component stream opening
      const streamOpen =
        `<?xml version='1.0'?>` +
        `<stream:stream ` +
        `xmlns='jabber:component:accept' ` +
        `xmlns:stream='http://etherx.jabber.org/streams' ` +
        `to='${xmlEscape(componentDomain)}'>`;

      await writer.write(new TextEncoder().encode(streamOpen));

      // Step 2: Read server stream response (contains stream id)
      const streamResponseRaw = await Promise.race([
        readWithDeadline(reader, Math.min(timeout, 5000)),
        timeoutPromise,
      ]);

      const streamParsed = parseStreamResponse(streamResponseRaw);

      if (!streamParsed.streamId) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          handshake: 'error',
          serverResponse: streamResponseRaw.substring(0, 500),
          error: streamParsed.hasError
            ? `Stream error: ${streamParsed.errorType}`
            : 'No stream ID in server response',
          rtt: Date.now() - start,
        } satisfies JabberComponentSendResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const streamId = streamParsed.streamId;

      // Step 3: Compute and send SHA-1 handshake
      const handshakeXml = await buildHandshake(streamId, secret);
      await writer.write(new TextEncoder().encode(handshakeXml));

      // Step 4: Read handshake response
      const handshakeResponseRaw = await Promise.race([
        readWithDeadline(reader, Math.min(timeout, 5000)),
        timeoutPromise,
      ]);

      const handshakeParsed = parseStreamResponse(handshakeResponseRaw);

      if (!handshakeParsed.hasHandshakeSuccess) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          handshake: 'failed',
          streamId,
          serverResponse: handshakeResponseRaw.substring(0, 500),
          error: handshakeParsed.hasError
            ? `Authentication failed: ${handshakeParsed.errorType}`
            : 'Handshake not confirmed by server',
          rtt: Date.now() - start,
        } satisfies JabberComponentSendResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 5: Send stanza
      let messageSent = false;
      let iqPong = false;
      let stanzaResponseRaw = '';

      if (messageBody) {
        // Send message stanza (no explicit xmlns — inherits jabber:component:accept from stream)
        const messageStanza =
          `<message from='${xmlEscape(from)}' to='${xmlEscape(to)}'>` +
          `<body>${xmlEscape(messageBody)}</body>` +
          `</message>`;
        await writer.write(new TextEncoder().encode(messageStanza));
        messageSent = true;

        // Read any immediate response (routing acknowledgement or error)
        stanzaResponseRaw = await readWithDeadline(reader, Math.min(timeout, 3000));
      } else {
        // Send IQ ping (no explicit xmlns on <iq> — inherits from stream)
        const pingStanza =
          `<iq type='get' from='${xmlEscape(from)}' to='${xmlEscape(to)}' id='ping1'>` +
          `<ping xmlns='urn:ietf:params:xml:ns:xmpp-ping'/>` +
          `</iq>`;
        await writer.write(new TextEncoder().encode(pingStanza));

        // Read pong (IQ result)
        stanzaResponseRaw = await readWithDeadline(reader, Math.min(timeout, 5000));

        // A pong is an <iq type='result'> with matching id
        if (
          stanzaResponseRaw.includes("type='result'") ||
          stanzaResponseRaw.includes('type="result"')
        ) {
          iqPong = true;
        }
      }

      const rtt = Date.now() - start;

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(JSON.stringify({
        handshake: 'ok',
        streamId,
        messageSent,
        iqPong,
        serverResponse: stanzaResponseRaw.trim() || undefined,
        rtt,
      } satisfies JabberComponentSendResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      handshake: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies JabberComponentSendResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Jabber Component Roster Handler
 * POST /api/jabber-component/roster
 * Body: { host, port=5275, componentDomain, secret, serverDomain?, timeout=15000 }
 *
 * Authenticates as a component (XEP-0114 SHA-1 handshake) then sends an
 * IQ roster get to the server, returning the list of contacts.
 *
 * This is useful for gateway components that need to enumerate the contact
 * list for a user or inspect what roster items are known to the server.
 */
export async function handleJabberComponentRoster(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number; timeout?: number;
      componentDomain: string; secret: string; serverDomain?: string;
    };
    const {
      host,
      port = 5275,
      timeout = 15000,
      componentDomain,
      secret,
    } = body;
    const serverDomain = body.serverDomain ?? host;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!componentDomain || !secret) {
      return new Response(JSON.stringify({ success: false, error: 'componentDomain and secret are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout));

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Open stream
      const streamOpen =
        `<?xml version='1.0'?>` +
        `<stream:stream ` +
        `xmlns='jabber:component:accept' ` +
        `xmlns:stream='http://etherx.jabber.org/streams' ` +
        `to='${xmlEscape(componentDomain)}'>`;
      await writer.write(new TextEncoder().encode(streamOpen));

      // Step 2: Read server stream header (contains stream id)
      const streamRaw = await Promise.race([
        readWithDeadline(reader, Math.min(timeout, 5000)),
        timeoutPromise,
      ]);
      const streamParsed = parseStreamResponse(streamRaw);

      if (!streamParsed.streamId) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return new Response(JSON.stringify({
          success: false, error: 'No stream ID in server response', serverResponse: streamRaw,
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      // Step 3: Send SHA-1 handshake
      const handshake = await buildHandshake(streamParsed.streamId, secret);
      await writer.write(new TextEncoder().encode(handshake));

      // Step 4: Read handshake result
      const handshakeRaw = await Promise.race([
        readWithDeadline(reader, Math.min(timeout, 5000)),
        timeoutPromise,
      ]);
      const handshakeParsed = parseStreamResponse(handshakeRaw);

      if (!handshakeParsed.hasHandshakeSuccess) {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return new Response(JSON.stringify({
          success: false,
          authenticated: false,
          error: handshakeParsed.hasError
            ? `Authentication failed: ${handshakeParsed.errorType}`
            : 'No handshake acknowledgement received',
          serverResponse: handshakeRaw,
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      // Step 5: Send IQ roster get
      // Components query the server's roster on behalf of a bare JID
      const iqId = `roster${Date.now()}`;
      const rosterGet =
        `<iq type='get' id='${iqId}' ` +
        `from='${xmlEscape(componentDomain)}' ` +
        `to='${xmlEscape(serverDomain)}'>`+
        `<query xmlns='jabber:iq:roster'/></iq>`;
      await writer.write(new TextEncoder().encode(rosterGet));

      // Step 6: Collect response
      const rosterRaw = await Promise.race([
        readWithDeadline(reader, Math.min(timeout - (Date.now() - start), 6000)),
        timeoutPromise,
      ]);

      writer.releaseLock(); reader.releaseLock(); socket.close();

      // Parse roster items from the IQ result
      const items: Array<{ jid: string; name?: string; subscription?: string; groups: string[] }> = [];
      const itemRegex = /<item\s([^>]*)\/>/g;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(rosterRaw)) !== null) {
        const attrs = itemMatch[1];
        const jid  = (attrs.match(/jid=['"]([^'"]+)['"]/))?.[1] ?? '';
        const name = (attrs.match(/name=['"]([^'"]+)['"]/))?.[1];
        const sub  = (attrs.match(/subscription=['"]([^'"]+)['"]/))?.[1];
        if (jid) items.push({ jid, name, subscription: sub, groups: [] });
      }

      // Also handle multi-line <item> elements with child <group> elements
      const fullItemRegex = /<item\s([^>]*)>([\s\S]*?)<\/item>/g;
      let fullItemMatch: RegExpExecArray | null;
      while ((fullItemMatch = fullItemRegex.exec(rosterRaw)) !== null) {
        const attrs = fullItemMatch[1];
        const inner = fullItemMatch[2];
        const jid   = (attrs.match(/jid=['"]([^'"]+)['"]/))?.[1] ?? '';
        const name  = (attrs.match(/name=['"]([^'"]+)['"]/))?.[1];
        const sub   = (attrs.match(/subscription=['"]([^'"]+)['"]/))?.[1];
        const groups: string[] = [];
        const groupRegex = /<group>([^<]+)<\/group>/g;
        let gm: RegExpExecArray | null;
        while ((gm = groupRegex.exec(inner)) !== null) groups.push(gm[1]);
        if (jid && !items.find(i => i.jid === jid)) {
          items.push({ jid, name, subscription: sub, groups });
        }
      }

      const iqType = rosterRaw.includes("type='result'") || rosterRaw.includes('type="result"')
        ? 'result' : rosterRaw.includes("type='error'") ? 'error' : 'unknown';

      return new Response(JSON.stringify({
        success: true,
        authenticated: true,
        streamId: streamParsed.streamId,
        iqType,
        items,
        itemCount: items.length,
        rtt: Date.now() - start,
        rawResponse: rosterRaw,
      }), { headers: { 'Content-Type': 'application/json' } });

    } finally {
      try { socket.close(); } catch { /* ignore */ }
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Jabber component roster query failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
