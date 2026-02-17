/**
 * Bitcoin P2P Wire Protocol Implementation (Port 8333)
 *
 * The Bitcoin peer-to-peer network protocol used by all Bitcoin nodes
 * (full nodes, miners, SPV wallets) to communicate.
 *
 * Message Format (every message):
 *   4 bytes: network magic (mainnet: 0xf9beb4d9, testnet3: 0x0b110907)
 *  12 bytes: command name (ASCII, null-padded)
 *   4 bytes: payload length (little-endian uint32)
 *   4 bytes: checksum (first 4 bytes of double-SHA256 of payload)
 *   N bytes: payload
 *
 * Handshake:
 * 1. Client sends "version" message
 * 2. Server responds with its "version" message
 * 3. Both send "verack" to acknowledge
 *
 * After handshake, nodes can exchange blocks, transactions, addresses, etc.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// Network magic bytes
const NETWORK_MAGIC: Record<string, Uint8Array> = {
  mainnet: new Uint8Array([0xf9, 0xbe, 0xb4, 0xd9]),
  testnet3: new Uint8Array([0x0b, 0x11, 0x09, 0x07]),
  testnet4: new Uint8Array([0x1c, 0x16, 0x3f, 0x28]),
  signet: new Uint8Array([0x0a, 0x03, 0xcf, 0x40]),
};

// Bitcoin protocol version (70016 = 0x11170 — current as of Bitcoin Core 25.x)
const PROTOCOL_VERSION = 70016;

// Service flags
const NODE_NONE = 0n;
const NODE_NETWORK = 1n;
const NODE_BLOOM = 4n;
const NODE_WITNESS = 8n;
const NODE_NETWORK_LIMITED = 1024n;

function decodeServices(flags: bigint): string[] {
  const services: string[] = [];
  if (flags & NODE_NETWORK) services.push('NODE_NETWORK');
  if (flags & NODE_BLOOM) services.push('NODE_BLOOM');
  if (flags & NODE_WITNESS) services.push('NODE_WITNESS');
  if (flags & NODE_NETWORK_LIMITED) services.push('NODE_NETWORK_LIMITED');
  if (services.length === 0) services.push('NONE');
  return services;
}

/**
 * Build a Bitcoin protocol message with header
 */
function buildMessage(network: string, command: string, payload: Uint8Array): Uint8Array {
  const magic = NETWORK_MAGIC[network] || NETWORK_MAGIC.mainnet;

  // Command name: 12 bytes, ASCII, null-padded
  const commandBytes = new Uint8Array(12);
  const cmdEncoded = new TextEncoder().encode(command);
  commandBytes.set(cmdEncoded.slice(0, 12));

  // Payload length: 4 bytes, little-endian
  const lengthBytes = new Uint8Array(4);
  new DataView(lengthBytes.buffer).setUint32(0, payload.length, true);

  // Checksum: first 4 bytes of double-SHA256
  // Since we can't do SHA256 synchronously in Workers easily,
  // we'll compute it with the Web Crypto API at call time
  // For now, build everything except checksum
  const message = new Uint8Array(24 + payload.length);
  message.set(magic, 0);
  message.set(commandBytes, 4);
  message.set(lengthBytes, 16);
  // Checksum will be filled at bytes 20-23
  message.set(payload, 24);

  return message;
}

/**
 * Compute double-SHA256 checksum (first 4 bytes)
 */
async function computeChecksum(payload: Uint8Array): Promise<Uint8Array> {
  const hash1 = await crypto.subtle.digest('SHA-256', new Uint8Array(payload));
  const hash2 = await crypto.subtle.digest('SHA-256', hash1);
  return new Uint8Array(hash2).slice(0, 4);
}

/**
 * Build the "version" message payload
 */
function buildVersionPayload(): Uint8Array {
  const buf = new ArrayBuffer(86 + 14); // base + user agent varint + user agent + relay
  const view = new DataView(buf);
  let offset = 0;

  // Protocol version (int32_le)
  view.setInt32(offset, PROTOCOL_VERSION, true);
  offset += 4;

  // Services (uint64_le) — we claim NODE_NONE
  view.setBigUint64(offset, NODE_NONE, true);
  offset += 8;

  // Timestamp (int64_le) — current Unix timestamp
  const now = BigInt(Math.floor(Date.now() / 1000));
  view.setBigInt64(offset, now, true);
  offset += 8;

  // Receiver address (26 bytes: services + IPv6-mapped IPv4 + port)
  // Services
  view.setBigUint64(offset, NODE_NONE, true);
  offset += 8;
  // IPv4-mapped-to-IPv6: 10 bytes 0x00, 2 bytes 0xff, 4 bytes IPv4
  const addrRecv = new Uint8Array(buf, offset, 16);
  addrRecv[10] = 0xff;
  addrRecv[11] = 0xff;
  addrRecv[12] = 127; addrRecv[13] = 0; addrRecv[14] = 0; addrRecv[15] = 1;
  offset += 16;
  // Port (big-endian)
  view.setUint16(offset, 8333, false);
  offset += 2;

  // Sender address (26 bytes — same format)
  view.setBigUint64(offset, NODE_NONE, true);
  offset += 8;
  const addrFrom = new Uint8Array(buf, offset, 16);
  addrFrom[10] = 0xff;
  addrFrom[11] = 0xff;
  addrFrom[12] = 127; addrFrom[13] = 0; addrFrom[14] = 0; addrFrom[15] = 1;
  offset += 16;
  view.setUint16(offset, 0, false);
  offset += 2;

  // Nonce (uint64_le — random)
  const nonce = crypto.getRandomValues(new Uint8Array(8));
  new Uint8Array(buf, offset, 8).set(nonce);
  offset += 8;

  // User agent (varint length + string)
  const userAgent = '/PortOfCall:1.0/';
  const uaBytes = new TextEncoder().encode(userAgent);
  // Varint for length (assuming < 253)
  view.setUint8(offset, uaBytes.length);
  offset += 1;
  new Uint8Array(buf, offset, uaBytes.length).set(uaBytes);
  offset += uaBytes.length;

  // Start height (int32_le) — 0 (we don't know the chain height)
  view.setInt32(offset, 0, true);
  offset += 4;

  // Relay (bool) — false (don't relay transactions to us)
  view.setUint8(offset, 0);
  offset += 1;

  return new Uint8Array(buf, 0, offset);
}

/**
 * Parse a received "version" message payload
 */
function parseVersionPayload(data: Uint8Array): {
  version: number;
  services: bigint;
  timestamp: bigint;
  userAgent: string;
  startHeight: number;
  relay: boolean;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const version = view.getInt32(offset, true);
  offset += 4;

  const services = view.getBigUint64(offset, true);
  offset += 8;

  const timestamp = view.getBigInt64(offset, true);
  offset += 8;

  // Skip receiver address (26 bytes) + sender address (26 bytes) + nonce (8 bytes)
  offset += 26 + 26 + 8;

  // User agent (varint + string)
  let userAgentLen = data[offset];
  offset += 1;
  if (userAgentLen === 0xfd) {
    userAgentLen = view.getUint16(offset, true);
    offset += 2;
  }
  const userAgent = new TextDecoder().decode(data.slice(offset, offset + userAgentLen));
  offset += userAgentLen;

  // Start height
  const startHeight = view.getInt32(offset, true);
  offset += 4;

  // Relay (optional — may not be present in older versions)
  let relay = true;
  if (offset < data.length) {
    relay = data[offset] !== 0;
  }

  return { version, services, timestamp, userAgent, startHeight, relay };
}

/**
 * Read a complete Bitcoin message from the reader
 * Returns { command, payload } or null on connection close
 */
async function readMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedMagic: Uint8Array,
  timeoutMs: number = 10000
): Promise<{ command: string; payload: Uint8Array } | null> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  // We need to accumulate data since TCP may fragment
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  const appendData = (existing: Uint8Array<ArrayBufferLike>, newData: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> => {
    const combined = new Uint8Array(existing.length + newData.length);
    combined.set(existing);
    combined.set(newData, existing.length);
    return combined;
  };

  // Read until we have at least 24 bytes (header)
  while (buffer.length < 24) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) return null;
    buffer = appendData(buffer, new Uint8Array(value));
  }

  // Verify magic bytes
  const magic = buffer.slice(0, 4);
  let magicMatch = true;
  for (let i = 0; i < 4; i++) {
    if (magic[i] !== expectedMagic[i]) {
      magicMatch = false;
      break;
    }
  }
  if (!magicMatch) {
    throw new Error(`Invalid network magic: 0x${Array.from(magic).map(b => b.toString(16).padStart(2, '0')).join('')}`);
  }

  // Parse command
  const commandBytes = buffer.slice(4, 16);
  const command = new TextDecoder().decode(commandBytes).replace(/\0+$/, '');

  // Parse payload length
  const payloadLen = new DataView(buffer.buffer, buffer.byteOffset + 16, 4).getUint32(0, true);

  // Read remaining payload
  const totalLen = 24 + payloadLen;
  while (buffer.length < totalLen) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) return null;
    buffer = appendData(buffer, new Uint8Array(value));
  }

  const payload = buffer.slice(24, 24 + payloadLen);
  return { command, payload };
}

interface BitcoinConnectRequest {
  host: string;
  port?: number;
  network?: string;
  timeout?: number;
}

/**
 * Handle Bitcoin node connection probe
 * Performs the version handshake and reports node information
 */
export async function handleBitcoinConnect(request: Request): Promise<Response> {
  try {
    let options: Partial<BitcoinConnectRequest>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<BitcoinConnectRequest>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '8333'),
        network: url.searchParams.get('network') || 'mainnet',
        timeout: parseInt(url.searchParams.get('timeout') || '10000'),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 8333;
    const network = options.network || 'mainnet';
    const timeoutMs = options.timeout || 10000;

    if (!NETWORK_MAGIC[network]) {
      return new Response(JSON.stringify({
        success: false,
        error: `Unknown network: ${network}. Valid networks: ${Object.keys(NETWORK_MAGIC).join(', ')}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check Cloudflare
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

    const magic = NETWORK_MAGIC[network];

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Build and send version message
        const versionPayload = buildVersionPayload();
        const checksum = await computeChecksum(versionPayload);
        const versionMsg = buildMessage(network, 'version', versionPayload);
        // Fill in checksum
        versionMsg[20] = checksum[0];
        versionMsg[21] = checksum[1];
        versionMsg[22] = checksum[2];
        versionMsg[23] = checksum[3];

        await writer.write(versionMsg);

        // Read server's version message
        const serverVersion = await readMessage(reader, magic, 10000);
        const rtt = Date.now() - startTime;

        if (!serverVersion || serverVersion.command !== 'version') {
          throw new Error(
            serverVersion
              ? `Expected 'version', got '${serverVersion.command}'`
              : 'Connection closed before version received'
          );
        }

        const versionInfo = parseVersionPayload(serverVersion.payload);

        // Send verack
        const verackPayload = new Uint8Array(0);
        const verackChecksum = await computeChecksum(verackPayload);
        const verackMsg = buildMessage(network, 'verack', verackPayload);
        verackMsg[20] = verackChecksum[0];
        verackMsg[21] = verackChecksum[1];
        verackMsg[22] = verackChecksum[2];
        verackMsg[23] = verackChecksum[3];
        await writer.write(verackMsg);

        // Try to read verack from server (but don't fail if timeout)
        let receivedVerack = false;
        try {
          const verackResponse = await readMessage(reader, magic, 3000);
          if (verackResponse?.command === 'verack') {
            receivedVerack = true;
          }
        } catch {
          // Timeout reading verack — that's ok, handshake still succeeded
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const serviceFlags = decodeServices(versionInfo.services);
        const nodeTimestamp = new Date(Number(versionInfo.timestamp) * 1000).toISOString();

        return {
          success: true,
          host,
          port,
          protocol: 'Bitcoin',
          network,
          rtt,
          handshakeComplete: receivedVerack,
          node: {
            version: versionInfo.version,
            userAgent: versionInfo.userAgent,
            services: serviceFlags,
            servicesRaw: `0x${versionInfo.services.toString(16)}`,
            startHeight: versionInfo.startHeight,
            timestamp: nodeTimestamp,
            relay: versionInfo.relay,
          },
          note: `Bitcoin P2P protocol (port ${port}). Connected to ${network} node running ${versionInfo.userAgent} at block height ${versionInfo.startHeight}. Services: ${serviceFlags.join(', ')}.`,
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Varint helpers ───────────────────────────────────────────────────────

/**
 * Read a Bitcoin variable-length integer from a DataView at the given offset.
 * Returns { value, bytesRead }.
 */
function readVarint(view: DataView, offset: number): { value: number; bytesRead: number } {
  const first = view.getUint8(offset);
  if (first < 0xfd) {
    return { value: first, bytesRead: 1 };
  } else if (first === 0xfd) {
    return { value: view.getUint16(offset + 1, true), bytesRead: 3 };
  } else if (first === 0xfe) {
    return { value: view.getUint32(offset + 1, true), bytesRead: 5 };
  } else {
    // 0xff — 8-byte varint; we read only the low 32 bits (enough for mempool counts)
    return { value: view.getUint32(offset + 1, true), bytesRead: 9 };
  }
}

/**
 * Return the display-order hex txid (reversed bytes) for a 32-byte hash.
 */
function hashToHex(bytes: Uint8Array): string {
  const reversed = new Uint8Array(bytes).reverse();
  return Array.from(reversed).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build a Bitcoin ping message with an 8-byte random nonce payload.
 */
async function buildPingMessage(network: string): Promise<{ msg: Uint8Array; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(8));
  const checksum = await computeChecksum(nonce);
  const msg = buildMessage(network, 'ping', nonce);
  msg[20] = checksum[0];
  msg[21] = checksum[1];
  msg[22] = checksum[2];
  msg[23] = checksum[3];
  return { msg, nonce };
}

/**
 * Parse a Bitcoin inv message payload.
 * Each inventory item: 4-byte type (LE) + 32-byte hash.
 * Returns array of { type, hash } where hash is the display-order hex txid.
 */
function parseInvPayload(payload: Uint8Array): Array<{ type: number; hash: string }> {
  if (payload.length < 1) return [];
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const { value: count, bytesRead } = readVarint(view, 0);
  const items: Array<{ type: number; hash: string }> = [];
  let offset = bytesRead;
  for (let i = 0; i < count; i++) {
    if (offset + 36 > payload.length) break;
    const type = view.getUint32(offset, true);
    const hash = payload.slice(offset + 4, offset + 36);
    items.push({ type, hash: hashToHex(hash) });
    offset += 36;
  }
  return items;
}

/**
 * Handle Bitcoin getaddr request — connect and request peer addresses
 */
export async function handleBitcoinGetAddr(request: Request): Promise<Response> {
  try {
    let options: Partial<BitcoinConnectRequest>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<BitcoinConnectRequest>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '8333'),
        network: url.searchParams.get('network') || 'mainnet',
        timeout: parseInt(url.searchParams.get('timeout') || '15000'),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 8333;
    const network = options.network || 'mainnet';
    const timeoutMs = options.timeout || 15000;
    const magic = NETWORK_MAGIC[network] || NETWORK_MAGIC.mainnet;

    // Check Cloudflare
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

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Complete handshake first
        const versionPayload = buildVersionPayload();
        const checksum = await computeChecksum(versionPayload);
        const versionMsg = buildMessage(network, 'version', versionPayload);
        versionMsg[20] = checksum[0];
        versionMsg[21] = checksum[1];
        versionMsg[22] = checksum[2];
        versionMsg[23] = checksum[3];
        await writer.write(versionMsg);

        // Read server version
        const serverVersion = await readMessage(reader, magic, 10000);
        if (!serverVersion || serverVersion.command !== 'version') {
          throw new Error('Version handshake failed');
        }

        const versionInfo = parseVersionPayload(serverVersion.payload);

        // Send verack
        const verackPayload = new Uint8Array(0);
        const verackChecksum = await computeChecksum(verackPayload);
        const verackMsg = buildMessage(network, 'verack', verackPayload);
        verackMsg[20] = verackChecksum[0];
        verackMsg[21] = verackChecksum[1];
        verackMsg[22] = verackChecksum[2];
        verackMsg[23] = verackChecksum[3];
        await writer.write(verackMsg);

        // Wait for verack
        try {
          await readMessage(reader, magic, 3000);
        } catch {
          // Continue anyway
        }

        // Send getaddr
        const getaddrPayload = new Uint8Array(0);
        const getaddrChecksum = await computeChecksum(getaddrPayload);
        const getaddrMsg = buildMessage(network, 'getaddr', getaddrPayload);
        getaddrMsg[20] = getaddrChecksum[0];
        getaddrMsg[21] = getaddrChecksum[1];
        getaddrMsg[22] = getaddrChecksum[2];
        getaddrMsg[23] = getaddrChecksum[3];
        await writer.write(getaddrMsg);

        // Read responses (addr message or others)
        const messages: Array<{ command: string; payloadSize: number }> = [];
        try {
          for (let i = 0; i < 5; i++) {
            const msg = await readMessage(reader, magic, 5000);
            if (!msg) break;
            messages.push({ command: msg.command, payloadSize: msg.payload.length });
            if (msg.command === 'addr') break;
          }
        } catch {
          // Timeout or error reading — use what we have
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          protocol: 'Bitcoin',
          network,
          nodeVersion: versionInfo.userAgent,
          blockHeight: versionInfo.startHeight,
          messagesReceived: messages,
          note: 'Sent getaddr request after handshake. Nodes may not respond immediately with addresses.',
        };
      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection timeout',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Mempool types ────────────────────────────────────────────────────────

interface BitcoinMempoolRequest {
  host: string;
  port?: number;
  network?: string;
  timeout?: number;
}

interface BitcoinMempoolResponse {
  success: boolean;
  host?: string;
  port?: number;
  network?: string;
  mempoolTxCount?: number;
  txIds?: string[];
  pingRtt?: number;
  rtt?: number;
  error?: string;
}

/**
 * Handle Bitcoin mempool query — perform the version handshake then request
 * mempool inventory and measure ping latency.
 *
 * Steps after handshake:
 *  1. Send `mempool` message (empty payload) — asks the peer to advertise
 *     its mempool contents as `inv` messages.
 *  2. Collect `inv` messages for up to 5 seconds, extracting MSG_TX (type 1)
 *     entries; keep up to 20 txids.
 *  3. Send a `ping` message with a random 8-byte nonce and measure how long
 *     the peer takes to reply with a matching `pong`.
 *
 * Note: Many nodes ignore `mempool` requests unless the peer has negotiated
 * the bloom filter service (BIP 37 / NODE_BLOOM).  We still attempt it and
 * report whatever inventory we receive.
 */
export async function handleBitcoinMempool(request: Request): Promise<Response> {
  try {
    let options: Partial<BitcoinMempoolRequest>;

    if (request.method === 'POST') {
      options = await request.json() as Partial<BitcoinMempoolRequest>;
    } else {
      const url = new URL(request.url);
      options = {
        host: url.searchParams.get('host') || '',
        port: parseInt(url.searchParams.get('port') || '8333'),
        network: url.searchParams.get('network') || 'mainnet',
        timeout: parseInt(url.searchParams.get('timeout') || '20000'),
      };
    }

    if (!options.host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      } satisfies Partial<BitcoinMempoolResponse>), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const host = options.host;
    const port = options.port || 8333;
    const network = options.network || 'mainnet';
    const timeoutMs = options.timeout || 20000;

    if (!NETWORK_MAGIC[network]) {
      return new Response(JSON.stringify({
        success: false,
        error: `Unknown network: ${network}. Valid networks: ${Object.keys(NETWORK_MAGIC).join(', ')}`,
      } satisfies Partial<BitcoinMempoolResponse>), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check Cloudflare
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

    const magic = NETWORK_MAGIC[network];

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // ── Handshake ──────────────────────────────────────────────────────
        const versionPayload = buildVersionPayload();
        const versionChecksum = await computeChecksum(versionPayload);
        const versionMsg = buildMessage(network, 'version', versionPayload);
        versionMsg[20] = versionChecksum[0];
        versionMsg[21] = versionChecksum[1];
        versionMsg[22] = versionChecksum[2];
        versionMsg[23] = versionChecksum[3];
        await writer.write(versionMsg);

        // Read server version
        const serverVersionMsg = await readMessage(reader, magic, 10000);
        if (!serverVersionMsg || serverVersionMsg.command !== 'version') {
          throw new Error('Version handshake failed');
        }

        // Send verack
        const verackPayload = new Uint8Array(0);
        const verackChecksum = await computeChecksum(verackPayload);
        const verackMsg = buildMessage(network, 'verack', verackPayload);
        verackMsg[20] = verackChecksum[0];
        verackMsg[21] = verackChecksum[1];
        verackMsg[22] = verackChecksum[2];
        verackMsg[23] = verackChecksum[3];
        await writer.write(verackMsg);

        // Drain until we see verack or another message from the peer
        try {
          await readMessage(reader, magic, 3000);
        } catch {
          // Timeout or no verack — proceed anyway
        }

        // ── Send mempool request ───────────────────────────────────────────
        const mempoolPayload = new Uint8Array(0);
        const mempoolChecksum = await computeChecksum(mempoolPayload);
        const mempoolMsg = buildMessage(network, 'mempool', mempoolPayload);
        mempoolMsg[20] = mempoolChecksum[0];
        mempoolMsg[21] = mempoolChecksum[1];
        mempoolMsg[22] = mempoolChecksum[2];
        mempoolMsg[23] = mempoolChecksum[3];
        await writer.write(mempoolMsg);

        // ── Collect inv messages (MSG_TX = 1) ──────────────────────────────
        const MSG_TX = 1;
        const txIds: string[] = [];
        let totalInvTxCount = 0;
        const invDeadline = Date.now() + 5000;

        while (txIds.length < 20) {
          const remaining = invDeadline - Date.now();
          if (remaining <= 0) break;

          let invMsg: { command: string; payload: Uint8Array } | null;
          try {
            invMsg = await readMessage(reader, magic, remaining);
          } catch {
            break;
          }

          if (!invMsg) break;

          if (invMsg.command === 'inv') {
            const items = parseInvPayload(invMsg.payload);
            for (const item of items) {
              if (item.type === MSG_TX) {
                totalInvTxCount++;
                if (txIds.length < 20) {
                  txIds.push(item.hash);
                }
              }
            }
          }
          // Skip non-inv messages silently (ping, addr, etc.)
        }

        // ── Ping/pong RTT measurement ──────────────────────────────────────
        const { msg: pingMsg, nonce: pingNonce } = await buildPingMessage(network);
        const pingStart = Date.now();
        await writer.write(pingMsg);

        let pingRtt: number | undefined;
        try {
          const pongTimeoutMs = 5000;
          while (true) {
            const pongMsg = await readMessage(reader, magic, pongTimeoutMs);
            if (!pongMsg) break;
            if (pongMsg.command === 'pong' && pongMsg.payload.length === 8) {
              let nonceMatch = true;
              for (let i = 0; i < 8; i++) {
                if (pongMsg.payload[i] !== pingNonce[i]) {
                  nonceMatch = false;
                  break;
                }
              }
              if (nonceMatch) {
                pingRtt = Date.now() - pingStart;
                break;
              }
            }
          }
        } catch {
          // Pong timeout — not fatal
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const rtt = Date.now() - startTime;

        return {
          success: true,
          host,
          port,
          network,
          mempoolTxCount: totalInvTxCount,
          txIds,
          pingRtt,
          rtt,
        } satisfies BitcoinMempoolResponse;

      } catch (error) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const mempoolTimeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    );

    try {
      const result = await Promise.race([connectionPromise, mempoolTimeoutPromise]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection timeout',
      } satisfies Partial<BitcoinMempoolResponse>), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    } satisfies Partial<BitcoinMempoolResponse>), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
