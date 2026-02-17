/**
 * Ethereum P2P / DevP2P / RLPx Protocol (Port 30303/TCP)
 *
 * Ethereum nodes communicate using the DevP2P networking stack:
 * - Discovery: UDP port 30303 (node discovery via Kademlia DHT)
 * - Transport: TCP port 30303 (RLPx encrypted sessions)
 *
 * RLPx Handshake (TCP, port 30303):
 * 1. Initiator sends an Auth message (ECIES-encrypted):
 *    - 65-byte initiator ephemeral public key
 *    - 64-byte signature (ECDSA on secp256k1)
 *    - 32-byte initiator nonce
 *    - 1-byte version flag
 *    Total: ~307 bytes (ECIES overhead + payload)
 *
 * 2. Recipient sends AuthAck (ECIES-encrypted):
 *    - 64-byte recipient ephemeral public key
 *    - 32-byte recipient nonce
 *    - 1-byte version flag
 *
 * 3. Both derive shared secrets and exchange RLP-encoded Hello frames.
 *
 * Hello Message (RLP-encoded):
 *   [p2pVersion, clientId, capabilities, listenPort, nodeId]
 *
 * Capabilities examples: [["eth", 68], ["snap", 1]]
 *
 * Implementation Note:
 * A full RLPx handshake requires secp256k1 ECDH and ECIES, which are not
 * available as built-ins in the Workers runtime. This implementation performs
 * a TCP connection probe and attempts to read/fingerprint the RLPx AuthAck,
 * which is useful for detecting active Ethereum nodes and measuring RTT.
 *
 * For full node interaction, use the Ethereum JSON-RPC API (port 8545, HTTP).
 *
 * Default Port: 30303/TCP
 *
 * Reference: https://github.com/ethereum/devp2p/blob/master/rlpx.md
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface EthereumProbeRequest {
  host: string;
  port?: number;
  timeout?: number;
}

function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  return null;
}

/**
 * Attempt to fingerprint a response as RLPx.
 * RLPx auth messages are ECIES-encrypted; we can detect them by:
 * - Length: 307 bytes for v4 auth, or a 2-byte length-prefixed packet
 * - No printable ASCII header (fully encrypted/opaque binary)
 */
function fingerprintRLPx(data: Uint8Array): {
  isRLPx: boolean;
  packetLength?: number;
  isPrefixed: boolean;
  note: string;
} {
  if (data.length < 2) {
    return { isRLPx: false, isPrefixed: false, note: 'Insufficient data to fingerprint' };
  }

  // Check for 2-byte big-endian length prefix (EIP-8 format)
  const view = new DataView(data.buffer, data.byteOffset);
  const prefixedLength = view.getUint16(0, false);

  if (prefixedLength > 0 && prefixedLength === data.length - 2) {
    return {
      isRLPx: true,
      isPrefixed: true,
      packetLength: prefixedLength,
      note: 'EIP-8 length-prefixed RLPx packet detected (EIP-8 encrypted handshake)',
    };
  }

  // Legacy RLPx auth: exactly 307 bytes (no length prefix)
  if (data.length === 307) {
    return {
      isRLPx: true,
      isPrefixed: false,
      packetLength: 307,
      note: 'Legacy RLPx auth message detected (307 bytes, pre-EIP-8)',
    };
  }

  // Check if data is fully non-printable (as expected for encrypted content)
  let printableCount = 0;
  for (let i = 0; i < Math.min(data.length, 32); i++) {
    if (data[i] >= 0x20 && data[i] <= 0x7E) printableCount++;
  }
  const printableRatio = printableCount / Math.min(data.length, 32);

  if (printableRatio < 0.1) {
    return {
      isRLPx: true,
      isPrefixed: false,
      packetLength: data.length,
      note: `Opaque binary data (${(printableRatio * 100).toFixed(0)}% printable) — consistent with RLPx encrypted handshake`,
    };
  }

  return {
    isRLPx: false,
    isPrefixed: false,
    note: `Unexpected response format (${(printableRatio * 100).toFixed(0)}% printable ASCII) — may not be an Ethereum node`,
  };
}

/**
 * Probe an Ethereum P2P node — connect to port 30303 and attempt
 * to detect an active RLPx listener.
 *
 * POST /api/ethereum/probe
 * Body: { host, port?, timeout? }
 *
 * Returns connection status and RLPx fingerprinting results.
 * Note: A full authenticated session requires secp256k1 crypto
 * not available in the Workers runtime. Use Ethereum JSON-RPC
 * (port 8545) for programmatic node interaction.
 */
export async function handleEthereumProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as EthereumProbeRequest;
    const {
      host,
      port = 30303,
      timeout = 10000,
    } = body;

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const tcpLatency = Date.now() - startTime;

      const reader = socket.readable.getReader();

      // Ethereum nodes initiate the handshake as the client; the server (recipient)
      // waits for the initiator's Auth message. Since we can't generate a valid
      // ECIES-encrypted auth without secp256k1, we instead try to read any data
      // the peer may send (e.g., if the remote connects to us as initiator).
      let receivedBytes = 0;
      let fingerprint: ReturnType<typeof fingerprintRLPx> | undefined;

      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), 3000),
        );
        const { value, done } = await Promise.race([reader.read(), readTimeout]);
        if (!done && value && value.length > 0) {
          receivedBytes = value.length;
          fingerprint = fingerprintRLPx(value);
        }
      } catch {
        // No data — server is waiting for us to send first (normal for RLPx)
      }

      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          portOpen: true,
          receivedBytes,
          rlpxFingerprint: fingerprint ?? {
            isRLPx: null,
            note: 'Server waiting for client Auth message (normal RLPx behavior). ' +
              'Full handshake requires secp256k1 ECIES crypto.',
          },
          protocol: 'Ethereum DevP2P / RLPx',
          limitations: [
            'Full RLPx handshake requires secp256k1 ECDH + ECIES encryption',
            'secp256k1 is not available as a built-in in the Workers runtime',
            'Use Ethereum JSON-RPC API (port 8545/HTTP) for programmatic access',
          ],
          references: [
            'https://github.com/ethereum/devp2p/blob/master/rlpx.md',
            'https://eips.ethereum.org/EIPS/eip-8',
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
