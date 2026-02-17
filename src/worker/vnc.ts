/**
 * VNC (RFB) Protocol Implementation
 *
 * Implements connectivity testing for VNC servers using the
 * Remote Framebuffer (RFB) Protocol (RFC 6143).
 *
 * Protocol Flow:
 * 1. Server sends protocol version string: "RFB 003.008\n" (12 bytes)
 * 2. Client sends matching version string: "RFB 003.008\n"
 * 3. Server sends security types (count + type list)
 * 4. We report version and available security types
 *
 * Security Types:
 *   0 = Invalid (connection failed)
 *   1 = None (no authentication)
 *   2 = VNC Authentication (DES challenge-response)
 *   5-16 = RealVNC extensions
 *   18 = TLS
 *   19 = VeNCrypt
 *   30-35 = Apple Remote Desktop
 *
 * Use Cases:
 * - VNC server connectivity testing
 * - RFB protocol version detection
 * - Security type enumeration
 * - Remote desktop server discovery
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Human-readable names for VNC security types
 */
function getSecurityTypeName(type: number): string {
  const names: Record<number, string> = {
    0: 'Invalid',
    1: 'None',
    2: 'VNC Authentication',
    5: 'RA2',
    6: 'RA2ne',
    16: 'Tight',
    17: 'Ultra',
    18: 'TLS',
    19: 'VeNCrypt',
    20: 'GTK-VNC SASL',
    21: 'MD5 hash',
    22: 'Colin Dean xvp',
    30: 'Apple Remote Desktop (ARD30)',
    35: 'Apple Remote Desktop (ARD35)',
  };
  return names[type] || `Unknown(${type})`;
}

/**
 * Read exactly `length` bytes from a reader, accumulating chunks
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let offset = 0;

  while (offset < length) {
    const { value, done } = await reader.read();
    if (done || !value) throw new Error('Connection closed while reading');

    const toCopy = Math.min(length - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }

  return buffer;
}

/**
 * DES S-boxes and permutation tables for manual DES implementation.
 * VNC uses DES with LSB-first key bits (bit order is reversed compared to standard DES).
 *
 * Since crypto.subtle does not support DES in modern Workers/browsers, we implement
 * the relevant subset manually: single-key DES ECB mode for 8-byte blocks.
 */

// Initial Permutation (IP) table — 1-indexed bit positions
const IP_TABLE = [
  58, 50, 42, 34, 26, 18, 10, 2,
  60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6,
  64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17,  9, 1,
  59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5,
  63, 55, 47, 39, 31, 23, 15, 7,
];

// Final Permutation (IP^-1) table
const FP_TABLE = [
  40, 8, 48, 16, 56, 24, 64, 32,
  39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30,
  37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28,
  35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26,
  33, 1, 41,  9, 49, 17, 57, 25,
];

// PC-1 permutation (key schedule step 1) — selects 56 bits from 64-bit key
const PC1 = [
  57, 49, 41, 33, 25, 17, 9,
   1, 58, 50, 42, 34, 26, 18,
  10,  2, 59, 51, 43, 35, 27,
  19, 11,  3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15,
   7, 62, 54, 46, 38, 30, 22,
  14,  6, 61, 53, 45, 37, 29,
  21, 13,  5, 28, 20, 12,  4,
];

// PC-2 permutation (key schedule step 2) — selects 48 bits from 56
const PC2 = [
  14, 17, 11, 24,  1,  5,
   3, 28, 15,  6, 21, 10,
  23, 19, 12,  4, 26,  8,
  16,  7, 27, 20, 13,  2,
  41, 52, 31, 37, 47, 55,
  30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53,
  46, 42, 50, 36, 29, 32,
];

// Number of left-rotations per round
const SHIFT_SCHEDULE = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

// Expansion (E) permutation for 32→48 bits
const E_TABLE = [
  32,  1,  2,  3,  4,  5,
   4,  5,  6,  7,  8,  9,
   8,  9, 10, 11, 12, 13,
  12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21,
  20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29,
  28, 29, 30, 31, 32,  1,
];

// S-boxes (8 boxes, each 4×16)
const S_BOXES: number[][][] = [
  [
    [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7],
    [0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8],
    [4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0],
    [15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  ],
  [
    [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10],
    [3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5],
    [0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15],
    [13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  ],
  [
    [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8],
    [13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1],
    [13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7],
    [1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  ],
  [
    [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15],
    [13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9],
    [10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4],
    [3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  ],
  [
    [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9],
    [14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6],
    [4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14],
    [11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  ],
  [
    [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11],
    [10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8],
    [9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6],
    [4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  ],
  [
    [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1],
    [13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6],
    [1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2],
    [6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  ],
  [
    [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7],
    [1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2],
    [7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8],
    [2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
  ],
];

// P permutation (after S-box substitution)
const P_TABLE = [
  16,  7, 20, 21,
  29, 12, 28, 17,
   1, 15, 23, 26,
   5, 18, 31, 10,
   2,  8, 24, 14,
  32, 27,  3,  9,
  19, 13, 30,  6,
  22, 11,  4, 25,
];

/**
 * Get a specific bit from a byte array (1-indexed, MSB first)
 */
function getBit(data: Uint8Array, bitPos: number): number {
  const byteIdx = Math.floor((bitPos - 1) / 8);
  const bitIdx = 7 - ((bitPos - 1) % 8);
  return (data[byteIdx] >> bitIdx) & 1;
}

/**
 * Set a specific bit in a byte array (1-indexed, MSB first)
 */
function setBit(data: Uint8Array, bitPos: number, val: number): void {
  const byteIdx = Math.floor((bitPos - 1) / 8);
  const bitIdx = 7 - ((bitPos - 1) % 8);
  if (val) {
    data[byteIdx] |= (1 << bitIdx);
  } else {
    data[byteIdx] &= ~(1 << bitIdx);
  }
}

/**
 * Apply a permutation table to a bit array
 */
function permute(data: Uint8Array, table: number[], outputBytes: number): Uint8Array {
  const result = new Uint8Array(outputBytes);
  for (let i = 0; i < table.length; i++) {
    setBit(result, i + 1, getBit(data, table[i]));
  }
  return result;
}

/**
 * Left-rotate a 28-bit half-key
 */
function leftRotate28(half: number, shifts: number): number {
  return ((half << shifts) | (half >>> (28 - shifts))) & 0x0fffffff;
}

/**
 * Generate 16 48-bit subkeys from 64-bit key
 */
function generateSubkeys(key: Uint8Array): Uint8Array[] {
  // Apply PC-1 to get 56-bit key
  const permKey = permute(key, PC1, 7);

  // Split into two 28-bit halves
  let C = 0;
  let D = 0;

  for (let i = 0; i < 28; i++) {
    C = (C << 1) | getBit(permKey, i + 1);
    D = (D << 1) | getBit(permKey, i + 29);
  }

  const subkeys: Uint8Array[] = [];

  for (let round = 0; round < 16; round++) {
    C = leftRotate28(C, SHIFT_SCHEDULE[round]);
    D = leftRotate28(D, SHIFT_SCHEDULE[round]);

    // Combine C and D into 56 bits
    const CD = new Uint8Array(7);
    for (let i = 0; i < 28; i++) {
      setBit(CD, i + 1, (C >>> (27 - i)) & 1);
      setBit(CD, i + 29, (D >>> (27 - i)) & 1);
    }

    // Apply PC-2 to get 48-bit subkey
    subkeys.push(permute(CD, PC2, 6));
  }

  return subkeys;
}

/**
 * DES f-function (Feistel function)
 */
function feistel(R: Uint8Array, subkey: Uint8Array): Uint8Array {
  // Expand R from 32 to 48 bits using E table
  const expanded = permute(R, E_TABLE, 6);

  // XOR with subkey
  const xored = new Uint8Array(6);
  for (let i = 0; i < 6; i++) {
    xored[i] = expanded[i] ^ subkey[i];
  }

  // S-box substitution: 48→32 bits
  const sBoxOutput = new Uint8Array(4);
  for (let i = 0; i < 8; i++) {
    const bitStart = i * 6 + 1;
    const b1 = getBit(xored, bitStart);
    const b2 = getBit(xored, bitStart + 1);
    const b3 = getBit(xored, bitStart + 2);
    const b4 = getBit(xored, bitStart + 3);
    const b5 = getBit(xored, bitStart + 4);
    const b6 = getBit(xored, bitStart + 5);

    const row = (b1 << 1) | b6;
    const col = (b2 << 3) | (b3 << 2) | (b4 << 1) | b5;
    const sVal = S_BOXES[i][row][col];

    const outBitStart = i * 4 + 1;
    setBit(sBoxOutput, outBitStart,     (sVal >> 3) & 1);
    setBit(sBoxOutput, outBitStart + 1, (sVal >> 2) & 1);
    setBit(sBoxOutput, outBitStart + 2, (sVal >> 1) & 1);
    setBit(sBoxOutput, outBitStart + 3,  sVal       & 1);
  }

  // Apply P permutation
  return permute(sBoxOutput, P_TABLE, 4);
}

/**
 * Encrypt a single 8-byte block with DES ECB
 */
function desEncryptBlock(block: Uint8Array, subkeys: Uint8Array[]): Uint8Array {
  // Apply IP
  const permuted = permute(block, IP_TABLE, 8);

  // Split into L (left 32 bits) and R (right 32 bits)
  let L = permuted.slice(0, 4);
  let R = permuted.slice(4, 8);

  // 16 Feistel rounds
  for (let round = 0; round < 16; round++) {
    const f = feistel(R, subkeys[round]);
    const newR = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      newR[i] = L[i] ^ f[i];
    }
    L = R;
    R = newR;
  }

  // Combine R + L (note swap) and apply FP
  const preOutput = new Uint8Array(8);
  preOutput.set(R, 0);
  preOutput.set(L, 4);

  return permute(preOutput, FP_TABLE, 8);
}

/**
 * Reverse the bit order of each byte in the VNC password key.
 * VNC DES uses LSB-first bit ordering for the key, unlike standard DES (MSB-first).
 * This is achieved by reversing each byte's bits before using it as the DES key.
 */
function vncReverseBits(b: number): number {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    result = (result << 1) | (b & 1);
    b >>= 1;
  }
  return result;
}

/**
 * Encrypt the 16-byte VNC challenge using DES with bit-reversed key.
 * The 8-byte password (padded/truncated) has each byte's bits reversed,
 * then DES ECB is applied to the two 8-byte challenge blocks.
 */
function vncDesEncrypt(password: string, challenge: Uint8Array): Uint8Array {
  // Build 8-byte key from password (pad with zeros or truncate)
  const keyBytes = new Uint8Array(8);
  const pwBytes = new TextEncoder().encode(password);
  for (let i = 0; i < 8; i++) {
    keyBytes[i] = i < pwBytes.length ? pwBytes[i] : 0;
  }

  // Reverse bits in each key byte (VNC LSB-first convention)
  const vncKey = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    vncKey[i] = vncReverseBits(keyBytes[i]);
  }

  // Generate DES subkeys
  const subkeys = generateSubkeys(vncKey);

  // Encrypt two 8-byte blocks of the 16-byte challenge
  const response = new Uint8Array(16);
  response.set(desEncryptBlock(challenge.slice(0, 8), subkeys), 0);
  response.set(desEncryptBlock(challenge.slice(8, 16), subkeys), 8);

  return response;
}

/**
 * Handle VNC authentication (DES challenge-response)
 * Performs RFB handshake, selects security type 2, reads 16-byte challenge,
 * encrypts it with DES (VNC bit-reversed key), and reports the SecurityResult.
 *
 * POST /api/vnc/auth
 */
export async function handleVNCAuth(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
      password: string;
    };

    const { host, port = 5900, timeout = 10000, password } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (password === undefined || password === null) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Password is required (use empty string for no password)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const authPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Read server RFB version (12 bytes)
        const serverVersionBytes = await Promise.race([readExact(reader, 12), timeoutPromise]);
        const serverVersionStr = new TextDecoder().decode(serverVersionBytes).trim();

        if (!serverVersionStr.startsWith('RFB ')) {
          throw new Error(`Not a VNC server: "${serverVersionStr}"`);
        }

        const versionMatch = serverVersionStr.match(/RFB (\d{3})\.(\d{3})/);
        if (!versionMatch) {
          throw new Error(`Invalid RFB version: "${serverVersionStr}"`);
        }

        const serverMajor = parseInt(versionMatch[1], 10);
        const serverMinor = parseInt(versionMatch[2], 10);

        // Step 2: Send our version (3.8 or server's version if lower)
        const clientMajor = Math.min(serverMajor, 3);
        const clientMinor = serverMajor >= 3 ? Math.min(serverMinor, 8) : serverMinor;
        const clientVersion = `RFB ${String(clientMajor).padStart(3, '0')}.${String(clientMinor).padStart(3, '0')}\n`;
        await writer.write(new TextEncoder().encode(clientVersion));

        // Step 3: Read security types
        let securityTypes: number[] = [];

        if (serverMajor >= 3 && serverMinor >= 7) {
          const countBytes = await Promise.race([readExact(reader, 1), timeoutPromise]);
          const count = countBytes[0];

          if (count === 0) {
            // Server is rejecting — read error reason
            const reasonLenBytes = await Promise.race([readExact(reader, 4), timeoutPromise]);
            const reasonLen = new DataView(reasonLenBytes.buffer).getUint32(0, false);
            const reasonBytes = await Promise.race([readExact(reader, Math.min(reasonLen, 256)), timeoutPromise]);
            const reason = new TextDecoder().decode(reasonBytes);
            throw new Error(`Server rejected connection: ${reason}`);
          }

          const typesBytes = await Promise.race([readExact(reader, count), timeoutPromise]);
          securityTypes = Array.from(typesBytes);
        } else {
          // RFB 3.3: server decides security type
          const typeBytes = await Promise.race([readExact(reader, 4), timeoutPromise]);
          const type = new DataView(typeBytes.buffer).getUint32(0, false);
          if (type === 0) {
            throw new Error('Server chose no security type (connection failure)');
          }
          securityTypes = [type];
        }

        // Check if VNC Authentication (type 2) is available
        if (!securityTypes.includes(2)) {
          throw new Error(`VNC Authentication (type 2) not offered. Available types: ${securityTypes.join(', ')}`);
        }

        // Step 4: Select security type 2
        if (serverMajor >= 3 && serverMinor >= 7) {
          await writer.write(new Uint8Array([2]));
        }
        // For RFB 3.3 the server already chose it — no client selection needed

        // Step 5: Read 16-byte DES challenge
        const challenge = await Promise.race([readExact(reader, 16), timeoutPromise]);
        const challengeHex = Array.from(challenge).map(b => b.toString(16).padStart(2, '0')).join('');

        // Step 6: Encrypt challenge with DES (VNC bit-reversed key)
        const response = vncDesEncrypt(password, challenge);
        await writer.write(response);

        // Step 7: Read SecurityResult (4 bytes, big-endian uint32)
        const resultBytes = await Promise.race([readExact(reader, 4), timeoutPromise]);
        const resultCode = new DataView(resultBytes.buffer).getUint32(0, false);

        let authResult: 'ok' | 'failed' | 'tooMany';
        let reason: string | undefined;

        if (resultCode === 0) {
          authResult = 'ok';
        } else if (resultCode === 1) {
          authResult = 'failed';
          // RFB 3.8+: read failure reason string
          if (serverMajor >= 3 && serverMinor >= 8) {
            try {
              const reasonLenBytes = await Promise.race([readExact(reader, 4), timeoutPromise]);
              const reasonLen = new DataView(reasonLenBytes.buffer).getUint32(0, false);
              if (reasonLen > 0 && reasonLen < 1024) {
                const reasonBytes = await Promise.race([readExact(reader, reasonLen), timeoutPromise]);
                reason = new TextDecoder().decode(reasonBytes);
              }
            } catch {
              // Reason string is optional — ignore read failures
            }
          }
        } else if (resultCode === 2) {
          authResult = 'tooMany';
        } else {
          authResult = 'failed';
          reason = `Unknown result code: ${resultCode}`;
        }

        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        return {
          success: authResult === 'ok',
          host,
          port,
          serverVersion: serverVersionStr,
          negotiatedVersion: clientVersion.trim(),
          securityTypes: securityTypes.map(t => ({
            id: t,
            name: getSecurityTypeName(t),
          })),
          challenge: challengeHex,
          authResult,
          reason,
          desAvailable: true,
          rtt,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([authPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

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

/**
 * Handle VNC connection test
 * Performs RFB version exchange and security type discovery
 */
export async function handleVNCConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string;
      port?: number;
      timeout?: number;
    };

    const { host, port = 5900, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Port must be between 1 and 65535',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Step 1: Read server's RFB version string (12 bytes: "RFB XXX.YYY\n")
        const serverVersionBytes = await readExact(reader, 12);
        const serverVersionStr = new TextDecoder().decode(serverVersionBytes).trim();

        // Validate it looks like an RFB version string
        if (!serverVersionStr.startsWith('RFB ')) {
          throw new Error(`Not a VNC server: received "${serverVersionStr}"`);
        }

        // Parse version numbers
        const versionMatch = serverVersionStr.match(/RFB (\d{3})\.(\d{3})/);
        if (!versionMatch) {
          throw new Error(`Invalid RFB version format: "${serverVersionStr}"`);
        }

        const serverMajor = parseInt(versionMatch[1], 10);
        const serverMinor = parseInt(versionMatch[2], 10);

        // Step 2: Send our version string (we support up to 3.8)
        const clientMajor = Math.min(serverMajor, 3);
        const clientMinor = serverMajor >= 3 ? Math.min(serverMinor, 8) : serverMinor;
        const clientVersion = `RFB ${String(clientMajor).padStart(3, '0')}.${String(clientMinor).padStart(3, '0')}\n`;
        await writer.write(new TextEncoder().encode(clientVersion));

        // Step 3: Read security types
        let securityTypes: number[] = [];
        let securityError = '';

        if (serverMajor >= 3 && serverMinor >= 7) {
          // RFB 3.7+: server sends count(1 byte) + type list
          const countBytes = await readExact(reader, 1);
          const count = countBytes[0];

          if (count === 0) {
            // Server is refusing connection - read error message
            const reasonLenBytes = await readExact(reader, 4);
            const reasonLen = new DataView(reasonLenBytes.buffer).getUint32(0, false);
            const reasonBytes = await readExact(reader, Math.min(reasonLen, 256));
            securityError = new TextDecoder().decode(reasonBytes);
          } else {
            const typesBytes = await readExact(reader, count);
            securityTypes = Array.from(typesBytes);
          }
        } else {
          // RFB 3.3: server sends a single uint32 security type
          const typeBytes = await readExact(reader, 4);
          const type = new DataView(typeBytes.buffer).getUint32(0, false);
          if (type === 0) {
            // Connection failed - read error message
            const reasonLenBytes = await readExact(reader, 4);
            const reasonLen = new DataView(reasonLenBytes.buffer).getUint32(0, false);
            const reasonBytes = await readExact(reader, Math.min(reasonLen, 256));
            securityError = new TextDecoder().decode(reasonBytes);
          } else {
            securityTypes = [type];
          }
        }

        const rtt = Date.now() - startTime;

        writer.releaseLock();
        reader.releaseLock();
        socket.close();

        const authRequired = !securityTypes.includes(1); // Type 1 = None

        return {
          success: true,
          host,
          port,
          connectTime,
          rtt,
          serverVersion: serverVersionStr,
          serverMajor,
          serverMinor,
          negotiatedVersion: clientVersion.trim(),
          securityTypes: securityTypes.map(t => ({
            id: t,
            name: getSecurityTypeName(t),
          })),
          authRequired,
          securityError: securityError || undefined,
        };
      } catch (error) {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        throw error;
      }
    })();

    const result = await Promise.race([connectionPromise, timeoutPromise]);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

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
