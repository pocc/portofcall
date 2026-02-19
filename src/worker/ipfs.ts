/**
 * IPFS / libp2p Multistream Protocol (Port 4001/TCP)
 *
 * IPFS (InterPlanetary File System) uses libp2p for peer-to-peer networking.
 * Nodes listen on port 4001 for incoming TCP connections from other IPFS peers.
 *
 * libp2p Multistream-Select Protocol:
 * Negotiates which application-level protocol to use over the TCP connection.
 *
 * Protocol Flow:
 * 1. Both sides exchange the multistream header:
 *    "/multistream/1.0.0\n" (length-prefixed with a varint)
 * 2. The dialer proposes a protocol: "/ipfs/0.1.0\n" or "/p2p/0.1.0\n"
 * 3. The listener responds:
 *    - Protocol name (agreed) — if supported
 *    - "na\n" — if not supported
 * 4. After negotiation, the chosen protocol takes over the stream.
 *
 * Varint Encoding (unsigned LEB128):
 *   7 bits per byte, LSB first. MSB of each byte is a continuation bit.
 *   Used for length-prefixing each message.
 *
 * Common libp2p Protocol IDs:
 *   /multistream/1.0.0   — protocol negotiation
 *   /p2p/0.1.0           — IPFS peer exchange (modern)
 *   /ipfs/0.1.0          — IPFS peer exchange (legacy)
 *   /ipfs/kad/1.0.0      — Kademlia DHT
 *   /ipfs/bitswap/1.2.0  — block exchange
 *   /libp2p/identify/1.0.0 — peer identity
 *   /secio/1.0.0         — SECIO encryption (deprecated)
 *   /noise               — Noise protocol encryption (current)
 *   /tls/1.0.0           — TLS encryption
 *
 * Default Port: 4001/TCP
 *
 * Reference: https://github.com/multiformats/multistream-select
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface IPFSProbeRequest {
  host: string;
  port?: number;
  protocols?: string[];
  timeout?: number;
}

function validateInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) return 'Host is required';
  if (!/^[a-zA-Z0-9._:-]+$/.test(host)) return 'Host contains invalid characters';
  if (port < 1 || port > 65535) return 'Port must be between 1 and 65535';
  return null;
}

/** Encode a string as a length-prefixed multistream message (varint + string + newline) */
function encodeMultistreamMessage(protocol: string): Uint8Array {
  const message = protocol + '\n';
  const msgBytes = new TextEncoder().encode(message);
  const length = msgBytes.length;

  // Encode length as unsigned varint (LEB128)
  const varintBytes: number[] = [];
  let val = length;
  do {
    let byte = val & 0x7F;
    val >>>= 7;
    if (val !== 0) byte |= 0x80;
    varintBytes.push(byte);
  } while (val !== 0);

  const result = new Uint8Array(varintBytes.length + msgBytes.length);
  result.set(varintBytes, 0);
  result.set(msgBytes, varintBytes.length);
  return result;
}

/** Decode a varint from a buffer at offset, returns [value, bytesRead] */
function decodeVarint(data: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < data.length) {
    const byte = data[offset + bytesRead];
    result |= (byte & 0x7F) << shift;
    bytesRead++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift >= 35) throw new Error('Varint too large');
  }
  return [result, bytesRead];
}

/** Parse a multistream response message: strip length prefix and trailing newline */
function parseMultistreamResponse(data: Uint8Array): string[] {
  const messages: string[] = [];
  let offset = 0;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  while (offset < data.length) {
    try {
      const [length, varintLen] = decodeVarint(data, offset);
      offset += varintLen;
      if (offset + length > data.length) break;
      const msgBytes = data.slice(offset, offset + length);
      const msg = decoder.decode(msgBytes).replace(/\n$/, '');
      messages.push(msg);
      offset += length;
    } catch {
      break;
    }
  }
  return messages;
}

/**
 * Probe an IPFS node using libp2p multistream-select protocol negotiation.
 *
 * POST /api/ipfs/probe
 * Body: { host, port?, protocols?, timeout? }
 *
 * Returns the node's supported libp2p protocols and peer information.
 */
export async function handleIPFSProbe(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as IPFSProbeRequest;
    const {
      host,
      port = 4001,
      protocols = ['/multistream/1.0.0', '/p2p/0.1.0', '/ipfs/0.1.0', '/ipfs/kad/1.0.0'],
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

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: Send the multistream/1.0.0 header
      await writer.write(encodeMultistreamMessage('/multistream/1.0.0'));

      // Read server's multistream header
      let isMultistream = false;
      let serverHeader = '';
      const negotiatedProtocols: string[] = [];
      const unsupportedProtocols: string[] = [];
      let rawMessages: string[] = [];

      const readChunk = async (waitMs: number): Promise<Uint8Array> => {
        try {
          const t = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), waitMs),
          );
          const { value, done } = await Promise.race([reader.read(), t]);
          return (!done && value) ? value : new Uint8Array(0);
        } catch {
          return new Uint8Array(0);
        }
      };

      // Read server's multistream header response
      const headerData = await readChunk(5000);
      if (headerData.length > 0) {
        rawMessages = parseMultistreamResponse(headerData);
        if (rawMessages.length > 0) {
          serverHeader = rawMessages[0];
          isMultistream = serverHeader === '/multistream/1.0.0';
        }
      }

      if (isMultistream) {
        // Step 2: Request list of available protocols via "ls"
        await writer.write(encodeMultistreamMessage('ls'));

        const lsData = await readChunk(3000);
        if (lsData.length > 0) {
          const lsMessages = parseMultistreamResponse(lsData);
          // The "ls" response is typically a list of protocol IDs
          rawMessages.push(...lsMessages);
        }

        // Step 3: Try to negotiate specific protocols
        for (const proto of protocols.slice(1)) { // skip multistream/1.0.0 itself
          await writer.write(encodeMultistreamMessage(proto));
          const protoData = await readChunk(2000);
          if (protoData.length > 0) {
            const resp = parseMultistreamResponse(protoData);
            for (const r of resp) {
              if (r === proto) {
                negotiatedProtocols.push(proto);
              } else if (r === 'na') {
                unsupportedProtocols.push(proto);
              }
            }
          }
        }
      }

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      return new Response(
        JSON.stringify({
          success: true,
          host,
          port,
          tcpLatency,
          isIPFSNode: isMultistream,
          serverHeader: serverHeader || undefined,
          negotiatedProtocols: negotiatedProtocols.length > 0 ? negotiatedProtocols : undefined,
          unsupportedProtocols: unsupportedProtocols.length > 0 ? unsupportedProtocols : undefined,
          allMessages: rawMessages.length > 0 ? rawMessages : undefined,
          note: 'libp2p multistream-select protocol negotiation. ' +
            'Modern IPFS nodes use Noise or TLS for transport encryption ' +
            'after initial multistream negotiation.',
          references: [
            'https://docs.ipfs.tech/concepts/libp2p/',
            'https://github.com/multiformats/multistream-select',
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


// ─── IPFS HTTP API (Add, Cat, Node Info) ─────────────────────────────────────

interface IPFSAddRequest {
  host: string;
  port?: number;
  content?: string;
  filename?: string;
  timeout?: number;
}

interface IPFSCatRequest {
  host: string;
  port?: number;
  cid: string;
  timeout?: number;
}

interface IPFSNodeInfoRequest {
  host: string;
  port?: number;
  timeout?: number;
}

/**
 * Add content to IPFS via the HTTP API POST /api/v0/add.
 *
 * POST /api/ipfs/add
 * Body: { host, port?, content?, filename?, timeout? }
 *
 * Sends content as multipart/form-data and returns the resulting CID.
 */
export async function handleIPFSAdd(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as IPFSAddRequest;
    const {
      host,
      port = 5001,
      content = 'Hello IPFS',
      filename = 'test.txt',
      timeout = 10000,
    } = body;

    const addValidationError = validateInput(host, port);
    if (addValidationError) {
      return new Response(
        JSON.stringify({ success: false, error: addValidationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/plain' }), filename);

    const startTime = Date.now();
    const response = await fetch(`http://${host}:${port}/api/v0/add`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `IPFS API returned HTTP ${response.status}: ${response.statusText}`,
          latencyMs: Date.now() - startTime,
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const latencyMs = Date.now() - startTime;
    const json = await response.json() as { Name?: string; Hash?: string; Size?: string };

    return new Response(
      JSON.stringify({
        success: true,
        cid: json.Hash,
        size: json.Size,
        name: json.Name,
        latencyMs,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const isTimeout = error instanceof Error &&
      (error.message.includes('timeout') || (error as Error & { name: string }).name === 'TimeoutError');
    return new Response(
      JSON.stringify({
        success: false,
        error: isTimeout ? 'Request timeout' : (error instanceof Error ? error.message : 'Unknown error'),
      }),
      { status: isTimeout ? 504 : 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Retrieve content from IPFS by CID via the HTTP API POST /api/v0/cat.
 *
 * POST /api/ipfs/cat
 * Body: { host, port?, cid, timeout? }
 */
export async function handleIPFSCat(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as IPFSCatRequest;
    const { host, port = 5001, cid, timeout = 10000 } = body;

    const catValidationError = validateInput(host, port);
    if (catValidationError) {
      return new Response(
        JSON.stringify({ success: false, error: catValidationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!cid || cid.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'CID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const startTime = Date.now();
    const response = await fetch(
      `http://${host}:${port}/api/v0/cat?arg=${encodeURIComponent(cid)}`,
      { method: 'POST', signal: AbortSignal.timeout(timeout) },
    );

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `IPFS API returned HTTP ${response.status}: ${response.statusText}`,
          latencyMs: Date.now() - startTime,
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const rawBytes = await response.arrayBuffer();
    const latencyMs = Date.now() - startTime;
    const content = new TextDecoder('utf-8', { fatal: false }).decode(rawBytes);

    return new Response(
      JSON.stringify({ success: true, content, size: rawBytes.byteLength, latencyMs }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const isTimeout = error instanceof Error &&
      (error.message.includes('timeout') || (error as Error & { name: string }).name === 'TimeoutError');
    return new Response(
      JSON.stringify({
        success: false,
        error: isTimeout ? 'Request timeout' : (error instanceof Error ? error.message : 'Unknown error'),
      }),
      { status: isTimeout ? 504 : 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ─── Pin operations ───────────────────────────────────────────────────────────

/**
 * POST /api/ipfs/pin-add
 * Body: { host, port?, cid, timeout? }
 * Pins a CID to the local IPFS node (prevents garbage collection).
 */
export async function handleIPFSPinAdd(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const body = await request.json() as { host: string; port?: number; cid: string; timeout?: number };
    const { host, port = 5001, cid, timeout = 15000 } = body;
    const pinAddValErr = validateInput(host, port);
    if (pinAddValErr) return new Response(JSON.stringify({ success: false, error: pinAddValErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!cid || !cid.trim()) return new Response(JSON.stringify({ success: false, error: 'CID is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const startTime = Date.now();
    const resp = await fetch(`http://${host}:${port}/api/v0/pin/add?arg=${encodeURIComponent(cid)}`, { method: 'POST', signal: AbortSignal.timeout(timeout) });
    const latencyMs = Date.now() - startTime;
    if (!resp.ok) return new Response(JSON.stringify({ success: false, error: `HTTP ${resp.status}: ${resp.statusText}`, latencyMs }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    const json = await resp.json() as { Pins?: string[] };
    return new Response(JSON.stringify({ success: true, cid, pinned: json.Pins ?? [cid], latencyMs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * POST /api/ipfs/pin-ls
 * Body: { host, port?, cid?, type?, timeout? }
 * Lists pinned CIDs. type = 'all' | 'direct' | 'indirect' | 'recursive' (default 'all').
 */
export async function handleIPFSPinList(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const body = await request.json() as { host: string; port?: number; cid?: string; type?: string; timeout?: number };
    const { host, port = 5001, cid, type = 'all', timeout = 10000 } = body;
    const pinLsValErr = validateInput(host, port);
    if (pinLsValErr) return new Response(JSON.stringify({ success: false, error: pinLsValErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const startTime = Date.now();
    let url = `http://${host}:${port}/api/v0/pin/ls?type=${encodeURIComponent(type)}`;
    if (cid) url += `&arg=${encodeURIComponent(cid)}`;
    const resp = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(timeout) });
    const latencyMs = Date.now() - startTime;
    if (!resp.ok) return new Response(JSON.stringify({ success: false, error: `HTTP ${resp.status}: ${resp.statusText}`, latencyMs }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    const json = await resp.json() as { Keys?: Record<string, { Type: string }> };
    const pins = Object.entries(json.Keys ?? {}).map(([k, v]) => ({ cid: k, type: v.Type }));
    return new Response(JSON.stringify({ success: true, pinCount: pins.length, pins, latencyMs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * Remove a pin from the IPFS node — allows GC to collect the block.
 *
 * POST /api/ipfs/pin-rm
 * Body: { host, port?, cid, recursive?, timeout? }
 *
 * Calls POST /api/v0/pin/rm?arg=CID&recursive=true
 */
export async function handleIPFSPinRm(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const body = await request.json() as { host: string; port?: number; cid: string; recursive?: boolean; timeout?: number };
    const { host, port = 5001, cid, recursive = true, timeout = 15000 } = body;
    const pinRmValErr = validateInput(host, port);
    if (pinRmValErr) return new Response(JSON.stringify({ success: false, error: pinRmValErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!cid || !cid.trim()) return new Response(JSON.stringify({ success: false, error: 'CID is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const startTime = Date.now();
    const resp = await fetch(
      `http://${host}:${port}/api/v0/pin/rm?arg=${encodeURIComponent(cid)}&recursive=${recursive}`,
      { method: 'POST', signal: AbortSignal.timeout(timeout) },
    );
    const latencyMs = Date.now() - startTime;
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return new Response(JSON.stringify({ success: false, error: `HTTP ${resp.status}: ${text}`, latencyMs }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const json = await resp.json() as { Pins?: string[] };
    return new Response(JSON.stringify({ success: true, cid, removed: json.Pins ?? [cid], latencyMs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── PubSub ───────────────────────────────────────────────────────────────────

/**
 * Publish a message to an IPFS pubsub topic.
 *
 * POST /api/ipfs/pubsub-pub
 * Body: { host, port?, topic, data, timeout? }
 *
 * Calls POST /api/v0/pubsub/pub?arg=TOPIC with data as multipart/form-data file.
 * Note: pubsub requires --enable-pubsub-experiment on go-ipfs / kubo ≥ 0.11.
 *
 * The Kubo RPC API expects the message payload as a file upload in multipart/form-data,
 * not as a raw octet-stream body.
 */
export async function handleIPFSPubsubPub(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const body = await request.json() as { host: string; port?: number; topic: string; data?: string; timeout?: number };
    const { host, port = 5001, topic, data = '', timeout = 10000 } = body;
    const pubValErr = validateInput(host, port);
    if (pubValErr) return new Response(JSON.stringify({ success: false, error: pubValErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (!topic || !topic.trim()) return new Response(JSON.stringify({ success: false, error: 'Topic is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const startTime = Date.now();
    // Kubo RPC API expects data as a file in multipart/form-data
    const form = new FormData();
    form.append('file', new Blob([data], { type: 'application/octet-stream' }), 'data');
    const resp = await fetch(
      `http://${host}:${port}/api/v0/pubsub/pub?arg=${encodeURIComponent(topic)}`,
      {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeout),
      },
    );
    const latencyMs = Date.now() - startTime;
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return new Response(JSON.stringify({ success: false, error: `HTTP ${resp.status}: ${text}`, latencyMs }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: true, topic, dataLength: data.length, latencyMs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/**
 * List all pubsub topics this node is currently subscribed to.
 *
 * POST /api/ipfs/pubsub-ls
 * Body: { host, port?, timeout? }
 *
 * Calls POST /api/v0/pubsub/ls
 */
export async function handleIPFSPubsubLs(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const body = await request.json() as { host: string; port?: number; timeout?: number };
    const { host, port = 5001, timeout = 10000 } = body;
    const lsValErr = validateInput(host, port);
    if (lsValErr) return new Response(JSON.stringify({ success: false, error: lsValErr }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const startTime = Date.now();
    const resp = await fetch(`http://${host}:${port}/api/v0/pubsub/ls`, { method: 'POST', signal: AbortSignal.timeout(timeout) });
    const latencyMs = Date.now() - startTime;
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return new Response(JSON.stringify({ success: false, error: `HTTP ${resp.status}: ${text}`, latencyMs }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const json = await resp.json() as { Strings?: string[] };
    const topics = json.Strings ?? [];
    return new Response(JSON.stringify({ success: true, topicCount: topics.length, topics, latencyMs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── Node info ────────────────────────────────────────────────────────────────

/**
 * Get IPFS node identity information via the HTTP API POST /api/v0/id.
 *
 * POST /api/ipfs/node-info
 * Body: { host, port?, timeout? }
 */
export async function handleIPFSNodeInfo(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = (await request.json()) as IPFSNodeInfoRequest;
    const { host, port = 5001, timeout = 10000 } = body;

    const infoValidationError = validateInput(host, port);
    if (infoValidationError) {
      return new Response(
        JSON.stringify({ success: false, error: infoValidationError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const startTime = Date.now();
    const response = await fetch(`http://${host}:${port}/api/v0/id`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `IPFS API returned HTTP ${response.status}: ${response.statusText}`,
          latencyMs: Date.now() - startTime,
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const latencyMs = Date.now() - startTime;
    const json = await response.json() as {
      ID?: string;
      PublicKey?: string;
      Addresses?: string[];
      AgentVersion?: string;
      ProtocolVersion?: string;
      Protocols?: string[];
    };

    return new Response(
      JSON.stringify({
        success: true,
        id: json.ID,
        publicKey: json.PublicKey,
        addresses: json.Addresses,
        agentVersion: json.AgentVersion,
        protocolVersion: json.ProtocolVersion,
        protocols: json.Protocols,
        latencyMs,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const isTimeout = error instanceof Error &&
      (error.message.includes('timeout') || (error as Error & { name: string }).name === 'TimeoutError');
    return new Response(
      JSON.stringify({
        success: false,
        error: isTimeout ? 'Request timeout' : (error instanceof Error ? error.message : 'Unknown error'),
      }),
      { status: isTimeout ? 504 : 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
