/**
 * Ethereum Protocol Support for Cloudflare Workers
 *
 * Ethereum nodes expose two interfaces:
 *   1. P2P DevP2P/RLPx -- TCP port 30303 (encrypted binary, secp256k1 ECDH)
 *   2. JSON-RPC API    -- HTTP port 8545  (standard HTTP POST)
 *
 * This module implements:
 *   - handleEthereumProbe     -- TCP/RLPx fingerprinting on port 30303
 *   - handleEthereumRPC       -- single JSON-RPC method call on port 8545
 *   - handleEthereumInfo      -- multi-method node overview query
 *   - handleEthereumP2PProbe  -- raw TCP byte inspection on P2P port
 *
 * RLPx Handshake (port 30303/TCP):
 *   1. Initiator sends Auth message (ECIES-encrypted, ~307 bytes pre-EIP-8)
 *   2. Recipient sends AuthAck (ECIES-encrypted)
 *   3. Both derive shared secrets, exchange RLP Hello frames
 *   Full handshake requires secp256k1 ECDH/ECIES -- not available in Workers.
 *
 * Ethereum JSON-RPC methods:
 *   eth_blockNumber     -- current block number (hex string)
 *   eth_syncing         -- sync status object or false
 *   net_version         -- network ID string ("1"=mainnet, "11155111"=sepolia)
 *   eth_chainId         -- chain ID as hex quantity (EIP-695, preferred over net_version)
 *   web3_clientVersion  -- e.g. "Geth/v1.12.0-stable/linux-amd64/go1.20.6"
 *   eth_gasPrice        -- current gas price in wei (hex string)
 *   eth_getBlockByNumber -- full block details
 *
 * References:
 *   https://github.com/ethereum/devp2p/blob/master/rlpx.md
 *   https://eips.ethereum.org/EIPS/eip-8
 *   https://eth.wiki/json-rpc/API
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// =============================================================================
// Shared helpers
// =============================================================================

function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._:\-\[\]]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  return null;
}

function toHex(data: Uint8Array, maxBytes = data.length): string {
  return Array.from(data.slice(0, maxBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// =============================================================================
// RLPx fingerprinting (P2P port 30303)
// =============================================================================

/**
 * Fingerprint incoming bytes as a potential RLPx message.
 *
 * RLPx auth messages are ECIES-encrypted (fully opaque binary). Heuristics:
 *   - EIP-8: first 2 bytes are a big-endian length prefix equal to rest of packet
 *   - Legacy: exactly 307 bytes, no length prefix
 *   - Generally: very low proportion of printable ASCII
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

  const view = new DataView(data.buffer, data.byteOffset);
  const prefixedLength = view.getUint16(0, false);

  if (prefixedLength > 0 && prefixedLength === data.length - 2) {
    return {
      isRLPx: true,
      isPrefixed: true,
      packetLength: prefixedLength,
      note: 'EIP-8 length-prefixed RLPx packet (encrypted handshake)',
    };
  }

  if (data.length === 307) {
    return {
      isRLPx: true,
      isPrefixed: false,
      packetLength: 307,
      note: 'Legacy RLPx auth message (307 bytes, pre-EIP-8)',
    };
  }

  let printableCount = 0;
  for (let i = 0; i < Math.min(data.length, 32); i++) {
    if (data[i] >= 0x20 && data[i] <= 0x7e) printableCount++;
  }
  const printableRatio = printableCount / Math.min(data.length, 32);

  if (printableRatio < 0.1) {
    return {
      isRLPx: true,
      isPrefixed: false,
      packetLength: data.length,
      note: `Opaque binary (${(printableRatio * 100).toFixed(0)}% printable) -- consistent with RLPx encrypted handshake`,
    };
  }

  return {
    isRLPx: false,
    isPrefixed: false,
    note: `Unexpected response (${(printableRatio * 100).toFixed(0)}% printable ASCII) -- may not be Ethereum`,
  };
}

// =============================================================================
// JSON-RPC helpers
// =============================================================================

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Auto-incrementing request ID for JSON-RPC call correlation */
let nextRpcId = 1;

/**
 * Execute a single Ethereum JSON-RPC call via HTTP POST.
 *
 * Validates the response against JSON-RPC 2.0 requirements:
 *   - Response MUST contain "jsonrpc": "2.0"
 *   - Response "id" MUST match the request "id"
 *   - Error object MUST contain "code" (integer) and "message" (string)
 */
async function callRPC(
  host: string,
  port: number,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<{ result?: unknown; error?: string; errorData?: unknown; latencyMs: number }> {
  const requestId = nextRpcId++;
  const url = `http://${host}:${port}/`;
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: requestId });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startTime = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startTime;
    clearTimeout(timer);

    if (!response.ok) {
      return { error: `HTTP ${response.status} ${response.statusText}`, latencyMs };
    }

    const json = await response.json() as JsonRpcResponse;

    // Validate JSON-RPC 2.0 envelope
    if (json.jsonrpc !== '2.0') {
      return {
        error: `Invalid JSON-RPC response: expected jsonrpc "2.0", got "${json.jsonrpc}"`,
        latencyMs,
      };
    }

    if (json.id !== requestId) {
      return {
        error: `JSON-RPC id mismatch: sent ${requestId}, received ${json.id}`,
        latencyMs,
      };
    }

    if (json.error) {
      return {
        error: `RPC error ${json.error.code}: ${json.error.message}`,
        ...(json.error.data !== undefined && { errorData: json.error.data }),
        latencyMs,
      };
    }
    return { result: json.result, latencyMs };
  } catch (e) {
    clearTimeout(timer);
    return {
      error: e instanceof Error ? e.message : 'Request failed',
      latencyMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// Exported handlers
// =============================================================================

/**
 * Probe an Ethereum P2P node on port 30303/TCP.
 *
 * Attempts TCP connection and reads any data sent by the peer.
 * Because the initiator normally speaks first in RLPx, the server
 * typically sends nothing until it receives a valid Auth message.
 * A full handshake requires secp256k1 ECIES not available in Workers.
 *
 * POST /api/ethereum/probe
 * Body: { host, port?, timeout? }
 */
export async function handleEthereumProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { host, port = 30303, timeout = 10000 } =
      await request.json<{ host: string; port?: number; timeout?: number }>();

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
        // Server is waiting for our Auth message -- normal RLPx behavior
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
            note: 'Server silent -- waiting for client Auth message. Normal RLPx behavior. ' +
              'Full handshake requires secp256k1 ECIES crypto.',
          },
          protocol: 'Ethereum DevP2P / RLPx',
          limitations: [
            'Full RLPx handshake requires secp256k1 ECDH + ECIES encryption',
            'secp256k1 is not available as a built-in in the Workers runtime',
            'Use Ethereum JSON-RPC API (port 8545) for programmatic node interaction',
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

/**
 * Execute a single Ethereum JSON-RPC method call.
 *
 * Connects to an Ethereum node's HTTP JSON-RPC endpoint (default port 8545)
 * and calls the specified method with optional parameters.
 *
 * Common methods:
 *   eth_blockNumber     -- returns current block number as hex string
 *   eth_syncing         -- returns sync status object or false
 *   net_version         -- returns network ID string (e.g. "1" for mainnet)
 *   web3_clientVersion  -- returns client version string
 *   eth_gasPrice        -- returns current gas price in wei as hex string
 *
 * POST /api/ethereum/rpc
 * Body: { host, port?, method?, params?, timeout? }
 *
 * Returns: { success, result, error?, latencyMs }
 */
export async function handleEthereumRPC(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 8545,
      method = 'eth_blockNumber',
      params = [] as unknown[],
      timeout = 10000,
    } = await request.json<{
      host: string;
      port?: number;
      method?: string;
      params?: unknown[];
      timeout?: number;
    }>();

    const validationError = validateInput(host, port);
    if (validationError) {
      return new Response(
        JSON.stringify({ success: false, error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!method) {
      return new Response(
        JSON.stringify({ success: false, error: 'method is required' }),
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

    const { result, error, errorData, latencyMs } = await callRPC(host, port, method, params, timeout);

    return new Response(
      JSON.stringify({
        success: !error,
        ...(result !== undefined && { result }),
        ...(error !== undefined && { error }),
        ...(errorData !== undefined && { errorData }),
        latencyMs,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'RPC call failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Query multiple Ethereum JSON-RPC methods to produce a node overview.
 *
 * Calls in parallel:
 *   web3_clientVersion  -- node software version string
 *   net_version         -- network ID string (e.g. "1" for mainnet)
 *   eth_chainId         -- chain ID as hex (EIP-695, e.g. "0x1" for mainnet)
 *   eth_blockNumber     -- current head block (hex)
 *   eth_syncing         -- sync progress object or false
 *
 * POST /api/ethereum/info
 * Body: { host, port?, timeout? }
 *
 * Returns: {
 *   success,
 *   clientVersion,        -- e.g. "Geth/v1.12.0-stable/linux-amd64/go1.20.6"
 *   networkId,            -- e.g. "1" (mainnet), "11155111" (sepolia)
 *   chainId,              -- hex chain ID, e.g. "0x1" (mainnet)
 *   chainIdDecimal,       -- decimal equivalent
 *   blockNumber,          -- hex string, e.g. "0x12ab34"
 *   blockNumberDecimal,   -- decimal equivalent
 *   syncing,              -- sync status object or false
 *   latencyMs
 * }
 */
export async function handleEthereumInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 8545,
      timeout = 10000,
    } = await request.json<{ host: string; port?: number; timeout?: number }>();

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

    const startTime = Date.now();

    // Query all five methods in parallel
    const [clientVersionRes, networkIdRes, chainIdRes, blockNumberRes, syncingRes] = await Promise.all([
      callRPC(host, port, 'web3_clientVersion', [], timeout),
      callRPC(host, port, 'net_version', [], timeout),
      callRPC(host, port, 'eth_chainId', [], timeout),
      callRPC(host, port, 'eth_blockNumber', [], timeout),
      callRPC(host, port, 'eth_syncing', [], timeout),
    ]);

    const totalLatencyMs = Date.now() - startTime;

    const anySuccess = !clientVersionRes.error || !blockNumberRes.error || !networkIdRes.error || !chainIdRes.error;

    let blockNumberDecimal: number | null = null;
    if (typeof blockNumberRes.result === 'string' && blockNumberRes.result.startsWith('0x')) {
      blockNumberDecimal = parseInt(blockNumberRes.result, 16);
    }

    let chainIdDecimal: number | null = null;
    if (typeof chainIdRes.result === 'string' && chainIdRes.result.startsWith('0x')) {
      chainIdDecimal = parseInt(chainIdRes.result, 16);
    }

    return new Response(
      JSON.stringify({
        success: anySuccess,
        host,
        port,
        clientVersion: clientVersionRes.result ?? null,
        clientVersionError: clientVersionRes.error ?? null,
        networkId: networkIdRes.result ?? null,
        networkIdError: networkIdRes.error ?? null,
        chainId: chainIdRes.result ?? null,
        chainIdDecimal,
        chainIdError: chainIdRes.error ?? null,
        blockNumber: blockNumberRes.result ?? null,
        blockNumberDecimal,
        blockNumberError: blockNumberRes.error ?? null,
        syncing: syncingRes.result ?? null,
        syncingError: syncingRes.error ?? null,
        latencyMs: totalLatencyMs,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Info query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Probe an Ethereum P2P port with raw TCP and inspect the first bytes received.
 *
 * Unlike handleEthereumProbe (RLPx fingerprinting), this handler sends no data
 * and reads whatever bytes the peer transmits first -- useful for detecting
 * non-standard node implementations or inspecting raw responses.
 *
 * In standard RLPx, the initiator (client) speaks first, so a passive read will
 * typically receive nothing from a well-behaved Ethereum node.
 *
 * POST /api/ethereum/p2p-probe
 * Body: { host, port?, timeout? }
 *
 * Returns: {
 *   success,
 *   host, port,
 *   responseBytes,   -- lowercase hex string of first bytes received (up to 512)
 *   responseLength,  -- total bytes received
 *   latencyMs,
 *   note
 * }
 */
export async function handleEthereumP2PProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 30303,
      timeout = 10000,
    } = await request.json<{ host: string; port?: number; timeout?: number }>();

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

    const startTime = Date.now();
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    let responseBytes = '';
    let responseLength = 0;

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();

      try {
        const readTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('read_timeout')), Math.min(timeout, 4000)),
        );
        const { value, done } = await Promise.race([reader.read(), readTimeout]);
        if (!done && value && value.length > 0) {
          responseLength = value.length;
          responseBytes = toHex(value, Math.min(value.length, 512));
        }
      } catch {
        // Server waiting for initiator -- normal for RLPx where client speaks first
      }

      reader.releaseLock();
      socket.close();
    } catch (e) {
      socket.close();
      throw e;
    }

    const latencyMs = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        responseBytes,
        responseLength,
        latencyMs,
        note: responseLength === 0
          ? 'Server sent no data. In RLPx the initiator (client) speaks first by sending an Auth message.'
          : `Received ${responseLength} bytes. Standard RLPx Auth is ~307 bytes (pre-EIP-8) or length-prefixed (EIP-8).`,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'P2P probe failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
