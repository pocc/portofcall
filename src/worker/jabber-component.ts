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
  return `<?xml version='1.0'?>
<stream:stream
  xmlns='jabber:component:accept'
  xmlns:stream='http://etherx.jabber.org/streams'
  to='${componentName}'>`;
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

  // Check for handshake success (empty <handshake/> element)
  if (data.includes('<handshake/>') || data.includes('<handshake />')) {
    result.hasHandshakeSuccess = true;
  }

  // Check for stream errors
  if (data.includes('<stream:error>') || data.includes('</error>')) {
    result.hasError = true;

    // Identify error type
    if (data.includes('<not-authorized')) {
      result.errorType = 'not-authorized';
    } else if (data.includes('<host-unknown')) {
      result.errorType = 'host-unknown';
    } else if (data.includes('<invalid-namespace')) {
      result.errorType = 'invalid-namespace';
    } else if (data.includes('<invalid-xml')) {
      result.errorType = 'invalid-xml';
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
