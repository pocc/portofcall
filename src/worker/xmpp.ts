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

  // TLS
  const tlsAvailable = xml.includes('urn:ietf:params:xml:ns:xmpp-tls') || xml.includes('<starttls');
  const tlsRequired = xml.includes('<required') && tlsAvailable;

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
  if (xml.includes('rosterver') || xml.includes('roster-versioning')) {
    features.push('roster-versioning');
  }
  if (xml.includes('urn:xmpp:csi:')) {
    features.push('client-state-indication');
  }
  if (xml.includes('urn:xmpp:carbons:')) {
    features.push('message-carbons');
  }
  if (xml.includes('ver=') || xml.includes('urn:xmpp:features:rosterver')) {
    features.push('roster-versioning');
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
      const socket = connect(`${host}:${port}`);
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
          `to='${targetDomain}' ` +
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
