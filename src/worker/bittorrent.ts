/**
 * BitTorrent Peer Wire Protocol Implementation
 *
 * TCP-based peer-to-peer file sharing protocol (BEP 3).
 * Default port range: 6881-6889.
 *
 * Endpoints implemented:
 * - Handshake — Perform BitTorrent protocol handshake to detect peers
 *
 * The handshake format (68 bytes total):
 *   1 byte:  pstrlen (19)
 *   19 bytes: pstr ("BitTorrent protocol")
 *   8 bytes:  reserved (extension flags)
 *   20 bytes: info_hash (SHA1 of torrent info dict)
 *   20 bytes: peer_id (client identifier)
 *
 * Use Cases:
 * - BitTorrent peer/seed detection and fingerprinting
 * - Client identification via peer_id encoding
 * - Protocol extension discovery (DHT, PEX, encryption)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface BitTorrentRequest {
  host: string;
  port?: number;
  timeout?: number;
  infoHash?: string; // 40-char hex string (20 bytes)
}

/**
 * Generate a random 20-byte hex string
 */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert a hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decode peer_id to identify the client software.
 * Uses Azureus-style (-XX1234-) or Shadow-style encoding.
 */
function decodePeerId(peerId: Uint8Array): string {
  // Try Azureus-style: -XX1234-xxxxxxxxxxxx
  if (peerId[0] === 0x2d && peerId[7] === 0x2d) {
    const clientCode = String.fromCharCode(peerId[1], peerId[2]);
    const version = String.fromCharCode(peerId[3], peerId[4], peerId[5], peerId[6]);

    const clients: Record<string, string> = {
      'AZ': 'Vuze (Azureus)',
      'BC': 'BitComet',
      'BT': 'mainline BitTorrent',
      'DE': 'Deluge',
      'KT': 'KTorrent',
      'LT': 'libtorrent',
      'QD': 'QQDownload',
      'qB': 'qBittorrent',
      'TR': 'Transmission',
      'UT': '\u00B5Torrent',
      'WB': 'WebTorrent',
      'lt': 'libtorrent (rasterbar)',
      'SD': 'Thunder',
      'FD': 'Free Download Manager',
      'XL': 'Xunlei',
      'BF': 'Bitflu',
      'LP': 'Lphant',
      'ML': 'MLdonkey',
      'MO': 'MonoTorrent',
      'PI': 'PicoTorrent',
      'RT': 'rTorrent',
      'SB': 'Swiftbit',
      'TN': 'TorrentDotNET',
      'WW': 'WebTorrent Desktop',
    };

    const clientName = clients[clientCode] || `Unknown (${clientCode})`;
    const versionStr = version.replace(/^0+/, '').split('').join('.');
    return `${clientName} ${versionStr}`;
  }

  // Try to extract printable ASCII
  const ascii = Array.from(peerId)
    .map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.')
    .join('');

  return `Unknown client: ${ascii}`;
}

/**
 * Parse BitTorrent extension bits from the 8 reserved bytes
 */
function parseExtensions(reserved: Uint8Array): string[] {
  const extensions: string[] = [];

  // Byte 5, bit 4: Extension Protocol (BEP 10)
  if (reserved[5] & 0x10) extensions.push('Extension Protocol (BEP 10)');

  // Byte 7, bit 0: DHT (BEP 5)
  if (reserved[7] & 0x01) extensions.push('DHT (BEP 5)');

  // Byte 7, bit 2: Fast Extension (BEP 6)
  if (reserved[7] & 0x04) extensions.push('Fast Extension (BEP 6)');

  // Byte 5, bit 0: LTEP (libtorrent Extension Protocol)
  if (reserved[5] & 0x01) extensions.push('LTEP');

  // Byte 0, bit 7: Azureus Messaging Protocol
  if (reserved[0] & 0x80) extensions.push('Azureus Messaging Protocol');

  // Byte 2, bit 3: NAT Traversal
  if (reserved[2] & 0x08) extensions.push('NAT Traversal');

  return extensions;
}

/**
 * Handle BitTorrent Handshake - Connect and perform protocol handshake
 */
export async function handleBitTorrentHandshake(request: Request): Promise<Response> {
  try {
    const body = await request.json() as BitTorrentRequest;
    const { host, port = 6881, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate info_hash if provided
    let infoHashBytes: Uint8Array;
    if (body.infoHash) {
      const cleaned = body.infoHash.replace(/[^0-9a-fA-F]/g, '');
      if (cleaned.length !== 40) {
        return new Response(JSON.stringify({
          success: false,
          error: 'info_hash must be 40 hex characters (20 bytes SHA1)',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      infoHashBytes = hexToBytes(cleaned);
    } else {
      // Use a random info_hash for probing
      infoHashBytes = hexToBytes(randomHex(20));
    }

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

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const handshakePromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Build handshake: pstrlen(1) + pstr(19) + reserved(8) + info_hash(20) + peer_id(20) = 68 bytes
        const handshake = new Uint8Array(68);
        const encoder = new TextEncoder();

        // pstrlen = 19
        handshake[0] = 19;

        // pstr = "BitTorrent protocol"
        const pstr = encoder.encode('BitTorrent protocol');
        handshake.set(pstr, 1);

        // reserved bytes (8): enable DHT + Extension Protocol
        handshake[25] = 0x10; // byte 5: Extension Protocol
        handshake[27] = 0x01; // byte 7: DHT

        // info_hash (20 bytes)
        handshake.set(infoHashBytes, 28);

        // peer_id (20 bytes) - Azureus-style with PortOfCall identifier
        const peerId = encoder.encode('-PC0100-');
        handshake.set(peerId, 48);
        // Fill remaining 12 bytes with random
        const randomPart = new Uint8Array(12);
        crypto.getRandomValues(randomPart);
        handshake.set(randomPart, 56);

        await writer.write(handshake);

        // Read response handshake (68 bytes)
        let responseData = new Uint8Array(0);
        while (responseData.length < 68) {
          const { value, done } = await reader.read();
          if (done) break;
          const newData = new Uint8Array(responseData.length + value.length);
          newData.set(responseData);
          newData.set(value, responseData.length);
          responseData = newData;
        }

        const rtt = Date.now() - startTime;
        await socket.close();

        if (responseData.length < 68) {
          return {
            success: false,
            host,
            port,
            rtt,
            error: `Incomplete handshake response: received ${responseData.length} of 68 bytes`,
            isBitTorrent: false,
          };
        }

        // Parse response handshake
        const respPstrLen = responseData[0];
        if (respPstrLen !== 19) {
          return {
            success: false,
            host,
            port,
            rtt,
            error: `Not a BitTorrent peer: protocol string length = ${respPstrLen} (expected 19)`,
            isBitTorrent: false,
          };
        }

        const decoder = new TextDecoder();
        const respPstr = decoder.decode(responseData.slice(1, 20));
        if (respPstr !== 'BitTorrent protocol') {
          return {
            success: false,
            host,
            port,
            rtt,
            error: `Not a BitTorrent peer: protocol = "${respPstr}"`,
            isBitTorrent: false,
          };
        }

        const reserved = responseData.slice(20, 28);
        const respInfoHash = responseData.slice(28, 48);
        const respPeerId = responseData.slice(48, 68);

        // Validate info_hash matches what we sent
        for (let i = 0; i < 20; i++) {
          if (respInfoHash[i] !== infoHashBytes[i]) {
            return {
              success: false,
              host,
              port,
              rtt,
              error: `BitTorrent info_hash mismatch: peer sent different hash`,
              isBitTorrent: false,
            };
          }
        }

        const extensions = parseExtensions(reserved);
        const clientInfo = decodePeerId(respPeerId);

        return {
          success: true,
          host,
          port,
          rtt,
          isBitTorrent: true,
          protocol: respPstr,
          infoHash: bytesToHex(respInfoHash),
          peerId: bytesToHex(respPeerId),
          peerIdDecoded: clientInfo,
          reservedHex: bytesToHex(reserved),
          extensions,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([handshakePromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Connection timeout') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Connection timeout',
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}


// ─── BitTorrent Peer Wire: Piece Exchange ────────────────────────────────────

/**
 * Perform a BitTorrent piece exchange with a remote peer.
 *
 * Peer wire message format (after handshake):
 *   length(4 bytes, big-endian) | id(1 byte) | payload(variable)
 *   Keep-alive: length=0, no id
 *
 * Message IDs:
 *   0 = choke        1 = unchoke       2 = interested    3 = not_interested
 *   4 = have         5 = bitfield      6 = request       7 = piece
 *   8 = cancel       9 = port (DHT)
 *
 * REQUEST payload: piece_index(4) begin(4) length(4)
 * PIECE payload:   index(4) begin(4) data(variable)
 *
 * Flow: handshake → optionally read BITFIELD → send INTERESTED →
 *       wait for UNCHOKE → send REQUEST → receive PIECE data
 *
 * POST /api/bittorrent/piece
 * Body: { host, port?, infoHash, pieceIndex?, pieceOffset?, pieceLength?, timeout? }
 */
export async function handleBitTorrentPiece(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host?: string;
      port?: number;
      infoHash?: string;
      pieceIndex?: number;
      pieceOffset?: number;
      pieceLength?: number;
      timeout?: number;
    };

    const {
      host,
      port = 6881,
      pieceIndex = 0,
      pieceOffset = 0,
      pieceLength = 16384, // standard 16 KiB block
      timeout = 15000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const cleanHash = body.infoHash?.replace(/[^0-9a-fA-F]/g, '') ?? '';
    if (cleanHash.length !== 40) {
      return new Response(JSON.stringify({
        success: false, error: 'infoHash must be a 40-character hex string (20 bytes)',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const infoHashBytes = hexToBytes(cleanHash);

    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const startTime = Date.now();
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout),
    );

    /** Read exactly `n` bytes from reader with per-read timeout */
    async function readExact(
      reader: ReadableStreamDefaultReader<Uint8Array>,
      n: number,
      waitMs: number,
    ): Promise<Uint8Array> {
      const buf = new Uint8Array(n);
      let off = 0;
      while (off < n) {
        const dl = new Promise<{ value: undefined; done: true }>((r) =>
          setTimeout(() => r({ value: undefined, done: true as const }), waitMs),
        );
        const { value, done } = await Promise.race([reader.read(), dl]);
        if (done || !value) throw new Error(`Stream ended after ${off}/${n} bytes`);
        const copy = Math.min(value.length, n - off);
        buf.set(value.slice(0, copy), off);
        off += copy;
        // If the chunk had more bytes, we discard the excess (shouldn't happen in practice)
      }
      return buf;
    }

    /** Read one peer-wire message: [length(4)] [id(1)] [payload] */
    async function readPeerMessage(
      reader: ReadableStreamDefaultReader<Uint8Array>,
      waitMs: number,
    ): Promise<{ id: number; payload: Uint8Array } | null> {
      const lenBuf = await readExact(reader, 4, waitMs);
      const length = new DataView(lenBuf.buffer).getUint32(0, false);
      if (length === 0) return null; // keep-alive
      const msgBuf = await readExact(reader, length, waitMs);
      return { id: msgBuf[0], payload: msgBuf.slice(1) };
    }

    const work = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      let bitfieldReceived: boolean | undefined;
      let unchokeReceived = false;
      let pieceData: Uint8Array | undefined;
      const peerMessages: string[] = [];

      try {
        // ── 1. Send handshake ─────────────────────────────────────────────
        const handshake = new Uint8Array(68);
        const enc = new TextEncoder();
        handshake[0] = 19;
        handshake.set(enc.encode('BitTorrent protocol'), 1);
        handshake[25] = 0x10; // Extension Protocol
        handshake[27] = 0x01; // DHT
        handshake.set(infoHashBytes, 28);
        const peerId = enc.encode('-PC0100-');
        handshake.set(peerId, 48);
        const rndPart = new Uint8Array(12);
        crypto.getRandomValues(rndPart);
        handshake.set(rndPart, 56);
        await writer.write(handshake);

        // ── 2. Read peer handshake ────────────────────────────────────────
        let hsBuf = new Uint8Array(0);
        while (hsBuf.length < 68) {
          const dl = new Promise<{ value: undefined; done: true }>((r) =>
            setTimeout(() => r({ value: undefined, done: true as const }), 5000),
          );
          const { value, done } = await Promise.race([reader.read(), dl]);
          if (done || !value) break;
          const merged = new Uint8Array(hsBuf.length + value.length);
          merged.set(hsBuf);
          merged.set(value, hsBuf.length);
          hsBuf = merged;
        }

        if (hsBuf.length < 68 || hsBuf[0] !== 19) {
          writer.releaseLock(); reader.releaseLock(); socket.close();
          return {
            success: false,
            error: 'Incomplete or invalid BitTorrent handshake from peer',
          };
        }

        const dec = new TextDecoder();
        const respPstr = dec.decode(hsBuf.slice(1, 20));
        if (respPstr !== 'BitTorrent protocol') {
          writer.releaseLock(); reader.releaseLock(); socket.close();
          return { success: false, error: `Not a BitTorrent peer: protocol "${respPstr}"` };
        }

        // ── 3. Read post-handshake messages (BITFIELD/HAVE/UNCHOKE) ──────
        //    Peer may send BITFIELD before anything else.
        let waitMs = 3000;
        for (let i = 0; i < 8; i++) {
          let msg: { id: number; payload: Uint8Array } | null;
          try {
            msg = await readPeerMessage(reader, waitMs);
          } catch {
            break; // timeout or stream end — proceed to INTERESTED
          }
          if (msg === null) continue; // keep-alive
          const msgName = ['choke','unchoke','interested','not_interested','have','bitfield','request','piece','cancel','port'][msg.id] ?? `msg_${msg.id}`;
          peerMessages.push(msgName);
          if (msg.id === 5) { // BITFIELD
            bitfieldReceived = true;
            waitMs = 1000;
          }
          if (msg.id === 1) { // UNCHOKE (immediately)
            unchokeReceived = true;
            break;
          }
          if (msg.id === 0) break; // CHOKE — peer won't unchoke right away
        }

        // ── 4. Send INTERESTED ────────────────────────────────────────────
        const interested = new Uint8Array([0, 0, 0, 1, 2]); // length=1, id=2
        await writer.write(interested);

        // ── 5. Wait for UNCHOKE ───────────────────────────────────────────
        if (!unchokeReceived) {
          for (let i = 0; i < 6; i++) {
            let msg: { id: number; payload: Uint8Array } | null;
            try {
              msg = await readPeerMessage(reader, 3000);
            } catch {
              break;
            }
            if (msg === null) continue;
            const msgName = ['choke','unchoke','interested','not_interested','have','bitfield','request','piece','cancel','port'][msg.id] ?? `msg_${msg.id}`;
            if (!peerMessages.includes(msgName)) peerMessages.push(msgName);
            if (msg.id === 1) { unchokeReceived = true; break; }
            if (msg.id === 0) break; // choke
          }
        }

        if (unchokeReceived) {
          // ── 6. Send REQUEST ─────────────────────────────────────────────
          // REQUEST: length=13, id=6, index(4), begin(4), length(4)
          const req = new Uint8Array(4 + 13);
          const rv = new DataView(req.buffer);
          rv.setUint32(0, 13, false);
          req[4] = 6;
          rv.setUint32(5,  pieceIndex,  false);
          rv.setUint32(9,  pieceOffset, false);
          rv.setUint32(13, Math.min(pieceLength, 16384), false);
          await writer.write(req);

          // ── 7. Wait for PIECE ───────────────────────────────────────────
          try {
            const msg = await readPeerMessage(reader, 8000);
            if (msg && msg.id === 7 && msg.payload.length >= 8) {
              // PIECE payload: index(4) begin(4) data(variable)
              const pv = new DataView(msg.payload.buffer, msg.payload.byteOffset);
              const respIndex  = pv.getUint32(0, false);
              const respBegin  = pv.getUint32(4, false);
              const dataBytes  = msg.payload.slice(8);
              pieceData = dataBytes;
              peerMessages.push(`piece(index=${respIndex},begin=${respBegin},bytes=${dataBytes.length})`);
            } else if (msg) {
              const msgName = ['choke','unchoke','interested','not_interested','have','bitfield','request','piece','cancel','port'][msg.id] ?? `msg_${msg.id}`;
              peerMessages.push(`unexpected:${msgName}`);
            }
          } catch { /* timeout reading piece — not fatal */ }
        }

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: true,
          host,
          port,
          infoHash: cleanHash,
          pieceIndex,
          pieceOffset,
          requestedLength: Math.min(pieceLength, 16384),
          bitfieldReceived: bitfieldReceived ?? false,
          unchokeReceived,
          pieceDataReceived: pieceData !== undefined,
          pieceDataBytes: pieceData?.length,
          pieceDataHex: pieceData ? bytesToHex(pieceData.slice(0, 32)) + (pieceData.length > 32 ? '...' : '') : undefined,
          peerMessages,
          latencyMs: Date.now() - startTime,
          note: unchokeReceived
            ? (pieceData
              ? 'Piece data received successfully.'
              : 'Peer unchoked but did not send PIECE (may not have the piece).')
            : 'Peer did not send UNCHOKE — peer may be choking, or does not have requested piece.',
        };
      } catch (err) {
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { reader.releaseLock(); } catch { /* ignore */ }
        socket.close();
        throw err;
      }
    })();

    const result = await Promise.race([work, deadline]);
    return new Response(JSON.stringify(result), {
      status: (result as { success: boolean }).success ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Connection timeout') {
      return new Response(JSON.stringify({ success: false, error: 'Connection timeout' }), {
        status: 504, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}


// ─── BitTorrent HTTP Tracker (Scrape & Announce) ────────────────────────────

interface BitTorrentTrackerRequest {
  host: string;
  port?: number;
  infoHash: string;
  peerId?: string;
  timeout?: number;
}

/**
 * Convert a 40-char hex string to a URL-percent-encoded byte string.
 * Each byte is encoded as %XX regardless of printability.
 */
function hexToUrlEncoded(hex: string): string {
  let encoded = '';
  for (let i = 0; i < hex.length; i += 2) {
    encoded += '%' + hex.substring(i, i + 2).toLowerCase();
  }
  return encoded;
}

/**
 * Minimal bencode parser supporting scrape/announce response structures.
 */
type BencodeValue = number | Uint8Array | BencodeValue[] | BencodeDict;

/**
 * Bencode dictionary that stores keys as hex-encoded byte strings.
 * This avoids corruption when keys contain arbitrary binary data
 * (e.g., 20-byte SHA1 info_hash keys in scrape responses).
 */
class BencodeDict {
  private map = new Map<string, BencodeValue>();

  /** Set a value using the raw key bytes (stored internally as hex). */
  setRaw(keyBytes: Uint8Array, value: BencodeValue): void {
    this.map.set(bytesToHex(keyBytes), value);
  }

  /** Get a value using an ASCII string key. */
  get(asciiKey: string): BencodeValue | undefined {
    const hexKey = Array.from(new TextEncoder().encode(asciiKey))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return this.map.get(hexKey);
  }

  /** Get a value using a hex-encoded key (for binary keys like info_hash). */
  getHex(hexKey: string): BencodeValue | undefined {
    return this.map.get(hexKey.toLowerCase());
  }

  /** Iterate over entries (keys are hex-encoded). */
  [Symbol.iterator](): IterableIterator<[string, BencodeValue]> {
    return this.map[Symbol.iterator]();
  }
}

function parseBencode(data: Uint8Array, offset = 0): [BencodeValue, number] {
  if (offset >= data.length) throw new Error('Unexpected end of bencode data');
  const ch = data[offset];

  if (ch === 0x69 /* 'i' */) {
    let end = offset + 1;
    while (end < data.length && data[end] !== 0x65 /* 'e' */) end++;
    return [parseInt(new TextDecoder().decode(data.slice(offset + 1, end)), 10), end + 1];
  }

  if (ch >= 0x30 && ch <= 0x39 /* '0'-'9' */) {
    let colonPos = offset;
    while (colonPos < data.length && data[colonPos] !== 0x3a /* ':' */) colonPos++;
    const length = parseInt(new TextDecoder().decode(data.slice(offset, colonPos)), 10);
    const start = colonPos + 1;
    return [data.slice(start, start + length), start + length];
  }

  if (ch === 0x6c /* 'l' */) {
    const list: BencodeValue[] = [];
    let pos = offset + 1;
    while (pos < data.length && data[pos] !== 0x65 /* 'e' */) {
      const [val, next] = parseBencode(data, pos);
      list.push(val);
      pos = next;
    }
    return [list, pos + 1];
  }

  if (ch === 0x64 /* 'd' */) {
    const dict = new BencodeDict();
    let pos = offset + 1;
    while (pos < data.length && data[pos] !== 0x65 /* 'e' */) {
      const [keyBytes, afterKey] = parseBencode(data, pos);
      const [val, afterVal] = parseBencode(data, afterKey);
      dict.setRaw(keyBytes as Uint8Array, val);
      pos = afterVal;
    }
    return [dict, pos + 1];
  }

  throw new Error(`Unknown bencode type byte: 0x${ch.toString(16)} at offset ${offset}`);
}

function bencodeGetInt(dict: BencodeDict, key: string): number | undefined {
  const val = dict.get(key);
  return typeof val === 'number' ? val : undefined;
}

/**
 * Handle BitTorrent HTTP Tracker Scrape — retrieve seeder/leecher/completed counts.
 *
 * POST /api/bittorrent/scrape
 * Body: { host, port?, infoHash, timeout? }
 */
export async function handleBitTorrentScrape(request: Request): Promise<Response> {
  try {
    const body = await request.json() as BitTorrentTrackerRequest;
    const { host, port = 6969, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cleanHash = body.infoHash?.replace(/[^0-9a-fA-F]/g, '') ?? '';
    if (cleanHash.length !== 40) {
      return new Response(JSON.stringify({
        success: false,
        error: 'infoHash must be a 40-character hex string (20 bytes)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const encodedHash = hexToUrlEncoded(cleanHash);
    const url = `http://${host}:${port}/scrape?info_hash=${encodedHash}`;

    const startTime = Date.now();
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });

    if (!response.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: `Tracker returned HTTP ${response.status}: ${response.statusText}`,
        latencyMs: Date.now() - startTime,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rawBytes = new Uint8Array(await response.arrayBuffer());
    const latencyMs = Date.now() - startTime;

    const [parsed] = parseBencode(rawBytes);
    if (!(parsed instanceof BencodeDict)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Unexpected bencode response structure',
        latencyMs,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const failureReason = parsed.get('failure reason');
    if (failureReason instanceof Uint8Array) {
      return new Response(JSON.stringify({
        success: false,
        error: new TextDecoder().decode(failureReason),
        latencyMs,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const files = parsed.get('files');
    if (!(files instanceof BencodeDict)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No "files" key in scrape response',
        latencyMs,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Look up stats for our specific info_hash (binary 20-byte key, matched via hex)
    const torrentStatsVal = files.getHex(cleanHash);
    if (!(torrentStatsVal instanceof BencodeDict)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No torrent data in scrape response for the requested info_hash',
        latencyMs,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const torrentStats = torrentStatsVal;

    const seeders = bencodeGetInt(torrentStats, 'complete') ?? 0;
    const completed = bencodeGetInt(torrentStats, 'downloaded') ?? 0;
    const leechers = bencodeGetInt(torrentStats, 'incomplete') ?? 0;

    return new Response(JSON.stringify({ success: true, seeders, leechers, completed, latencyMs }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const isTimeout = error instanceof Error &&
      (error.message.includes('timeout') || (error as Error & { name: string }).name === 'TimeoutError');
    return new Response(JSON.stringify({
      success: false,
      error: isTimeout ? 'Request timeout' : (error instanceof Error ? error.message : 'Unknown error'),
    }), {
      status: isTimeout ? 504 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle BitTorrent HTTP Tracker Announce — announce peer presence and receive peer list.
 *
 * POST /api/bittorrent/announce
 * Body: { host, port?, infoHash, peerId?, timeout? }
 */
export async function handleBitTorrentAnnounce(request: Request): Promise<Response> {
  try {
    const body = await request.json() as BitTorrentTrackerRequest;
    const { host, port = 6969, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cleanHash = body.infoHash?.replace(/[^0-9a-fA-F]/g, '') ?? '';
    if (cleanHash.length !== 40) {
      return new Response(JSON.stringify({
        success: false,
        error: 'infoHash must be a 40-character hex string (20 bytes)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const peerIdHex = body.peerId?.replace(/[^0-9a-fA-F]/g, '') ?? randomHex(20);
    if (peerIdHex.length !== 40) {
      return new Response(JSON.stringify({
        success: false,
        error: 'peerId must be a 40-character hex string (20 bytes)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const encodedHash = hexToUrlEncoded(cleanHash);
    const encodedPeerId = hexToUrlEncoded(peerIdHex);

    const params = new URLSearchParams({
      uploaded: '0',
      downloaded: '0',
      left: '0',
      event: 'started',
      compact: '1',
      numwant: '10',
      port: '6881',
    });

    const url = `http://${host}:${port}/announce?info_hash=${encodedHash}&peer_id=${encodedPeerId}&${params.toString()}`;

    const startTime = Date.now();
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });

    if (!response.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: `Tracker returned HTTP ${response.status}: ${response.statusText}`,
        latencyMs: Date.now() - startTime,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rawBytes = new Uint8Array(await response.arrayBuffer());
    const latencyMs = Date.now() - startTime;

    const [parsed] = parseBencode(rawBytes);
    if (!(parsed instanceof BencodeDict)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Unexpected bencode response structure',
        latencyMs,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const failureReason = parsed.get('failure reason');
    if (failureReason instanceof Uint8Array) {
      return new Response(JSON.stringify({
        success: false,
        error: new TextDecoder().decode(failureReason),
        latencyMs,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const interval = bencodeGetInt(parsed, 'interval') ?? 0;
    const seeders = bencodeGetInt(parsed, 'complete');
    const leechers = bencodeGetInt(parsed, 'incomplete');

    // Parse compact peer list: 6 bytes per peer (4 IP + 2 port, big-endian)
    const peersRaw = parsed.get('peers');
    const peers: string[] = [];

    if (peersRaw instanceof Uint8Array) {
      for (let i = 0; i + 6 <= peersRaw.length; i += 6) {
        const ip = `${peersRaw[i]}.${peersRaw[i + 1]}.${peersRaw[i + 2]}.${peersRaw[i + 3]}`;
        const p = (peersRaw[i + 4] << 8) | peersRaw[i + 5];
        peers.push(`${ip}:${p}`);
      }
    } else if (Array.isArray(peersRaw)) {
      // Non-compact dict format
      for (const peer of peersRaw) {
        if (peer instanceof BencodeDict) {
          const ipBytes = peer.get('ip');
          const portVal = peer.get('port');
          if (ipBytes instanceof Uint8Array && typeof portVal === 'number') {
            peers.push(`${new TextDecoder().decode(ipBytes)}:${portVal}`);
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      interval,
      peers,
      ...(seeders !== undefined && { seeders }),
      ...(leechers !== undefined && { leechers }),
      latencyMs,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const isTimeout = error instanceof Error &&
      (error.message.includes('timeout') || (error as Error & { name: string }).name === 'TimeoutError');
    return new Response(JSON.stringify({
      success: false,
      error: isTimeout ? 'Request timeout' : (error instanceof Error ? error.message : 'Unknown error'),
    }), {
      status: isTimeout ? 504 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
