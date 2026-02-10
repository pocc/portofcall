/**
 * WHOIS Protocol Implementation (RFC 3912)
 *
 * The WHOIS protocol provides domain registration information.
 * It's a simple text-based query-response protocol.
 *
 * Protocol Flow:
 * 1. Client connects to WHOIS server port 43
 * 2. Client sends domain name followed by CRLF
 * 3. Server responds with registration information
 * 4. Server closes connection
 *
 * Use Cases:
 * - Domain registration lookup
 * - IP address allocation information
 * - Autonomous system number queries
 * - Contact information for domain owners
 */

import { connect } from 'cloudflare:sockets';

interface WhoisRequest {
  domain: string;
  server?: string;
  port?: number;
  timeout?: number;
}

interface WhoisResponse {
  success: boolean;
  domain: string;
  server: string;
  response: string;
  error?: string;
}

/**
 * WHOIS server mapping for different TLDs
 */
const WHOIS_SERVERS: Record<string, string> = {
  'com': 'whois.verisign-grs.com',
  'net': 'whois.verisign-grs.com',
  'org': 'whois.pir.org',
  'edu': 'whois.educause.edu',
  'gov': 'whois.dotgov.gov',
  'mil': 'whois.nic.mil',
  'int': 'whois.iana.org',
  'info': 'whois.afilias.net',
  'biz': 'whois.biz',
  'us': 'whois.nic.us',
  'uk': 'whois.nic.uk',
  'ca': 'whois.cira.ca',
  'au': 'whois.auda.org.au',
  'de': 'whois.denic.de',
  'fr': 'whois.nic.fr',
  'jp': 'whois.jprs.jp',
  'cn': 'whois.cnnic.cn',
  'ru': 'whois.tcinet.ru',
  'br': 'whois.registro.br',
  'in': 'whois.registry.in',
};

/**
 * Get appropriate WHOIS server for a domain
 */
function getWhoisServer(domain: string): string {
  const parts = domain.toLowerCase().split('.');
  const tld = parts[parts.length - 1];
  return WHOIS_SERVERS[tld] || 'whois.iana.org';
}

/**
 * Perform WHOIS lookup for a domain
 */
export async function handleWhoisLookup(request: Request): Promise<Response> {
  try {
    const body = await request.json() as WhoisRequest;
    const { domain, timeout = 10000 } = body;
    let { server, port = 43 } = body;

    // Validation
    if (!domain) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Domain is required',
        domain: '',
        server: '',
        response: '',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Basic domain validation
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(domain)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid domain format',
        domain,
        server: '',
        response: '',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Auto-select WHOIS server if not specified
    if (!server) {
      server = getWhoisServer(domain);
    }

    // Validate port
    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
        domain,
        server: server || '',
        response: '',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Connect to WHOIS server
    const socket = connect(`${server}:${port}`);

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      // Wait for connection with timeout
      await Promise.race([
        socket.opened,
        timeoutPromise,
      ]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send WHOIS query (domain + CRLF)
      const query = `${domain}\r\n`;
      const queryBytes = new TextEncoder().encode(query);
      await writer.write(queryBytes);

      // Read response (may be multiple chunks)
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 100000; // 100KB limit

      while (true) {
        const { value, done } = await Promise.race([
          reader.read(),
          timeoutPromise,
        ]);

        if (done) break;

        if (value) {
          chunks.push(value);
          totalBytes += value.length;

          // Prevent excessive data
          if (totalBytes > maxResponseSize) {
            throw new Error('Response too large (max 100KB)');
          }
        }
      }

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Decode response
      const responseText = new TextDecoder().decode(combined);

      // Clean up
      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      const result: WhoisResponse = {
        success: true,
        domain,
        server,
        response: responseText,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      // Connection or read error
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      domain: '',
      server: '',
      response: '',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
