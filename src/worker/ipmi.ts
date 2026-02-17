/**
 * IPMI (Intelligent Platform Management Interface) Protocol Support
 * Implements RMCP ASF Presence Ping over TCP for BMC connectivity testing
 *
 * IPMI v2.0 / RMCP+ uses UDP port 623. This worker attempts a TCP connection
 * to port 623 and sends an RMCP ASF Presence Ping. Some BMC implementations
 * also listen on TCP 623. Full RMCP/IPMI session establishment requires UDP,
 * which is not available in Cloudflare Workers.
 *
 * Port: 623 (TCP/UDP)
 * Spec: IPMI v2.0, RMCP RFC, ASF 2.0
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

export interface IPMIConnectionOptions {
  host: string;
  port?: number;
  timeout?: number;
}

/**
 * Build an RMCP ASF Presence Ping packet (8 bytes)
 *
 * RMCP Header (4 bytes):
 *   Version  = 0x06 (RMCP v1.0)
 *   Reserved = 0x00
 *   SeqNum   = 0xFF (no ACK)
 *   MsgClass = 0x06 (ASF)
 *
 * ASF Body (8 bytes):
 *   IANA = 0x00 0x00 0x11 0xBE  (ASF = 4542 decimal)
 *   Type = 0x80 (Presence Ping)
 *   Tag  = 0xFF
 *   Rsv  = 0x00
 *   Len  = 0x00
 */
function buildRMCPPresencePing(): Uint8Array {
  return new Uint8Array([
    // RMCP Header
    0x06, // Version: RMCP 1.0
    0x00, // Reserved
    0xFF, // Sequence Number (no ACK)
    0x06, // Message Class: ASF
    // ASF Presence Ping body
    0x00, 0x00, 0x11, 0xBE, // IANA Enterprise: 4542 (ASF)
    0x80, // Message Type: Presence Ping
    0xFF, // Message Tag
    0x00, // Reserved
    0x00, // Data Length: 0
  ]);
}

/**
 * Parse an RMCP ASF Presence Pong response
 */
function parseRMCPResponse(data: Uint8Array): {
  isPresencePong: boolean;
  supportsIPMI: boolean;
  entityType: number;
  entityId: number;
  message: string;
} {
  if (data.length < 12) {
    return { isPresencePong: false, supportsIPMI: false, entityType: 0, entityId: 0, message: 'Response too short for RMCP' };
  }

  // Check RMCP header
  if (data[0] !== 0x06) {
    return { isPresencePong: false, supportsIPMI: false, entityType: 0, entityId: 0, message: 'Not an RMCP packet (bad version byte)' };
  }

  if (data[3] !== 0x06) {
    return { isPresencePong: false, supportsIPMI: false, entityType: 0, entityId: 0, message: `Unexpected RMCP message class: 0x${data[3].toString(16)}` };
  }

  // IANA check (bytes 4–7)
  if (data[4] !== 0x00 || data[5] !== 0x00 || data[6] !== 0x11 || data[7] !== 0xBE) {
    return { isPresencePong: false, supportsIPMI: false, entityType: 0, entityId: 0, message: 'Unexpected IANA in RMCP response' };
  }

  const msgType = data[8];
  if (msgType !== 0x40) {
    return {
      isPresencePong: false,
      supportsIPMI: false,
      entityType: 0,
      entityId: 0,
      message: `Unexpected ASF message type: 0x${msgType.toString(16)} (expected 0x40 Presence Pong)`,
    };
  }

  // Presence Pong — parse supported entities (16 bytes of data starting at offset 12)
  const supportsIPMI = data.length >= 20 && (data[16] & 0x80) !== 0;
  const entityType = data.length >= 14 ? data[12] : 0;
  const entityId = data.length >= 15 ? data[13] : 0;

  return {
    isPresencePong: true,
    supportsIPMI,
    entityType,
    entityId,
    message: `RMCP Presence Pong received — IPMI supported: ${supportsIPMI}`,
  };
}

/**
 * Handle IPMI/RMCP connectivity probe
 */
export async function handleIPMIConnect(request: Request): Promise<Response> {
  try {
    let options: Partial<IPMIConnectionOptions>;
    if (request.method === 'POST') {
      options = await request.json() as Partial<IPMIConnectionOptions>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '623'),
        timeout: parseInt(url.searchParams.get('timeout') || '10000'),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 623;
    const timeoutMs = options.timeout || 10000;

    // Check if behind Cloudflare
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
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Send RMCP ASF Presence Ping
        const ping = buildRMCPPresencePing();
        await writer.write(ping);

        // Read response with a short inner timeout
        const { value } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((_, reject) =>
            setTimeout(() => reject(new Error('No response from BMC (TCP may not be supported — IPMI typically uses UDP)')), 5000),
          ),
        ]);

        await socket.close();

        if (!value) {
          throw new Error('No response from BMC');
        }

        const parsed = parseRMCPResponse(value);

        return {
          success: true,
          host,
          port,
          tcpReachable: true,
          rmcpResponse: parsed.isPresencePong,
          supportsIPMI: parsed.supportsIPMI,
          entityType: parsed.entityType,
          entityId: parsed.entityId,
          message: parsed.message,
          note: 'RMCP/IPMI typically uses UDP port 623. This test used TCP — full protocol interaction requires UDP.',
        };
      } catch (err) {
        // If we connected (socket.opened succeeded) but got no response, report partial success
        try { await socket.close(); } catch (_) { /* ignore */ }
        return {
          success: true,
          host,
          port,
          tcpReachable: true,
          rmcpResponse: false,
          supportsIPMI: false,
          entityType: 0,
          entityId: 0,
          message: err instanceof Error ? err.message : 'TCP connection established but no RMCP response',
          note: 'TCP port 623 is open. RMCP/IPMI typically uses UDP — this TCP probe cannot perform full RMCP negotiation.',
        };
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        tcpReachable: false,
        error: err instanceof Error ? err.message : 'Connection failed',
        note: 'RMCP/IPMI typically uses UDP port 623. TCP probing may not work if the BMC only listens on UDP.',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unexpected error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
