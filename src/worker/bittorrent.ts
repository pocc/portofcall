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
