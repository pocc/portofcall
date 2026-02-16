/**
 * ⚠️ TFTP-over-TCP Implementation (NON-STANDARD / EXPERIMENTAL)
 *
 * RFC 1350 TFTP is a UDP-only protocol. This implementation uses TCP because
 * Cloudflare Workers Sockets API does not support UDP connections.
 *
 * ⚠️ IMPORTANT LIMITATIONS:
 * - Will NOT work with standard TFTP servers (tftpd, atftpd, etc.)
 * - NOT RFC 1350 compliant (requires UDP)
 * - Requires a custom TCP-based TFTP server or UDP-to-TCP proxy
 *
 * Standard TFTP (RFC 1350):
 * - Port: 69/UDP
 * - Used for: Network booting (PXE), firmware updates, config transfers
 *
 * This Implementation:
 * - Port: 69/TCP (non-standard)
 * - Uses TFTP packet structure over TCP stream
 * - For demonstration/testing with compatible TCP-TFTP servers only
 */

import { connect } from 'cloudflare:sockets';

// TFTP Opcodes
const TFTP_OPCODE = {
  RRQ: 1,   // Read Request
  WRQ: 2,   // Write Request
  DATA: 3,  // Data packet
  ACK: 4,   // Acknowledgment
  ERROR: 5, // Error packet
} as const;

// TFTP Error Codes (for reference)
// const TFTP_ERROR = {
//   NOT_DEFINED: 0,
//   FILE_NOT_FOUND: 1,
//   ACCESS_VIOLATION: 2,
//   DISK_FULL: 3,
//   ILLEGAL_OPERATION: 4,
//   UNKNOWN_TID: 5,
//   FILE_EXISTS: 6,
//   NO_SUCH_USER: 7,
// } as const;

// TFTP Mode
type TFTPMode = 'netascii' | 'octet' | 'mail';

// Default block size (512 bytes is standard)
const TFTP_BLOCK_SIZE = 512;

// Timeout for TFTP operations (30 seconds)
const TFTP_TIMEOUT = 30000;

interface TFTPConnectRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface TFTPReadRequest extends TFTPConnectRequest {
  filename: string;
  mode?: TFTPMode;
}

interface TFTPWriteRequest extends TFTPConnectRequest {
  filename: string;
  data: string; // base64 encoded
  mode?: TFTPMode;
}

/**
 * Create a TFTP Read Request (RRQ) packet
 */
function createRRQPacket(filename: string, mode: TFTPMode = 'octet'): Uint8Array {
  const opcode = new Uint8Array([0, TFTP_OPCODE.RRQ]);
  const filenameBytes = new TextEncoder().encode(filename);
  const modeBytes = new TextEncoder().encode(mode);

  const packet = new Uint8Array(
    opcode.length + filenameBytes.length + 1 + modeBytes.length + 1
  );

  let offset = 0;
  packet.set(opcode, offset);
  offset += opcode.length;
  packet.set(filenameBytes, offset);
  offset += filenameBytes.length;
  packet[offset++] = 0; // null terminator
  packet.set(modeBytes, offset);
  offset += modeBytes.length;
  packet[offset] = 0; // null terminator

  return packet;
}

/**
 * Create a TFTP Write Request (WRQ) packet
 */
function createWRQPacket(filename: string, mode: TFTPMode = 'octet'): Uint8Array {
  const opcode = new Uint8Array([0, TFTP_OPCODE.WRQ]);
  const filenameBytes = new TextEncoder().encode(filename);
  const modeBytes = new TextEncoder().encode(mode);

  const packet = new Uint8Array(
    opcode.length + filenameBytes.length + 1 + modeBytes.length + 1
  );

  let offset = 0;
  packet.set(opcode, offset);
  offset += opcode.length;
  packet.set(filenameBytes, offset);
  offset += filenameBytes.length;
  packet[offset++] = 0;
  packet.set(modeBytes, offset);
  offset += modeBytes.length;
  packet[offset] = 0;

  return packet;
}

/**
 * Create a TFTP ACK packet
 */
function createACKPacket(blockNumber: number): Uint8Array {
  const packet = new Uint8Array(4);
  packet[0] = 0;
  packet[1] = TFTP_OPCODE.ACK;
  packet[2] = (blockNumber >> 8) & 0xFF;
  packet[3] = blockNumber & 0xFF;
  return packet;
}

/**
 * Create a TFTP DATA packet
 */
function createDATAPacket(blockNumber: number, data: Uint8Array): Uint8Array {
  const packet = new Uint8Array(4 + data.length);
  packet[0] = 0;
  packet[1] = TFTP_OPCODE.DATA;
  packet[2] = (blockNumber >> 8) & 0xFF;
  packet[3] = blockNumber & 0xFF;
  packet.set(data, 4);
  return packet;
}

/**
 * Parse TFTP packet opcode
 */
function parseOpcode(data: Uint8Array): number {
  if (data.length < 2) return 0;
  return (data[0] << 8) | data[1];
}

/**
 * Parse TFTP DATA packet
 */
function parseDataPacket(data: Uint8Array): { blockNumber: number; data: Uint8Array } | null {
  if (data.length < 4) return null;
  const opcode = parseOpcode(data);
  if (opcode !== TFTP_OPCODE.DATA) return null;

  const blockNumber = (data[2] << 8) | data[3];
  const payload = data.slice(4);

  return { blockNumber, data: payload };
}

/**
 * Parse TFTP ACK packet
 */
function parseACKPacket(data: Uint8Array): number | null {
  if (data.length < 4) return null;
  const opcode = parseOpcode(data);
  if (opcode !== TFTP_OPCODE.ACK) return null;

  return (data[2] << 8) | data[3];
}

/**
 * Parse TFTP ERROR packet
 */
function parseErrorPacket(data: Uint8Array): { code: number; message: string } | null {
  if (data.length < 4) return null;
  const opcode = parseOpcode(data);
  if (opcode !== TFTP_OPCODE.ERROR) return null;

  const code = (data[2] << 8) | data[3];
  const messageBytes = data.slice(4);
  const nullIndex = messageBytes.indexOf(0);
  const message = new TextDecoder().decode(
    nullIndex >= 0 ? messageBytes.slice(0, nullIndex) : messageBytes
  );

  return { code, message };
}

/**
 * Handle TFTP Connect - Test connection to TFTP server
 */
export async function handleTFTPConnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { host, port = 69, timeout = TFTP_TIMEOUT }: TFTPConnectRequest =
      await request.json();

    if (!host) {
      return new Response('Missing host parameter', { status: 400 });
    }

    // Test connection by attempting to connect
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    await Promise.race([socket.opened, timeoutPromise]);
    await socket.close();

    return new Response(
      JSON.stringify({
        success: true,
        host,
        port,
        protocol: 'TFTP',
        message: 'Connection successful',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Handle TFTP Read - Download file from TFTP server
 */
export async function handleTFTPRead(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 69,
      filename,
      mode = 'octet',
      timeout = TFTP_TIMEOUT,
    }: TFTPReadRequest = await request.json();

    if (!host || !filename) {
      return new Response('Missing host or filename parameter', { status: 400 });
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Operation timeout')), timeout)
    );

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Send RRQ (Read Request)
    const rrqPacket = createRRQPacket(filename, mode);
    await writer.write(rrqPacket);

    // Receive data blocks
    const fileData: Uint8Array[] = [];
    let expectedBlock = 1;
    let done = false;

    while (!done) {
      const readPromise = reader.read();
      const result = await Promise.race([readPromise, timeoutPromise]) as ReadableStreamReadResult<Uint8Array>;

      if (result.done) {
        break;
      }

      const opcode = parseOpcode(result.value);

      if (opcode === TFTP_OPCODE.DATA) {
        const parsed = parseDataPacket(result.value);
        if (!parsed) {
          throw new Error('Invalid DATA packet');
        }

        if (parsed.blockNumber === expectedBlock) {
          fileData.push(parsed.data);

          // Send ACK
          const ackPacket = createACKPacket(parsed.blockNumber);
          await writer.write(ackPacket);

          expectedBlock++;

          // Last packet is less than 512 bytes
          if (parsed.data.length < TFTP_BLOCK_SIZE) {
            done = true;
          }
        }
      } else if (opcode === TFTP_OPCODE.ERROR) {
        const error = parseErrorPacket(result.value);
        throw new Error(`TFTP Error ${error?.code}: ${error?.message}`);
      }
    }

    await writer.close();
    await socket.close();

    // Concatenate all data blocks
    const totalLength = fileData.reduce((sum, block) => sum + block.length, 0);
    const completeData = new Uint8Array(totalLength);
    let offset = 0;
    for (const block of fileData) {
      completeData.set(block, offset);
      offset += block.length;
    }

    // Convert to base64 for JSON transport
    const base64Data = btoa(String.fromCharCode(...completeData));

    return new Response(
      JSON.stringify({
        success: true,
        filename,
        size: totalLength,
        data: base64Data,
        blocks: fileData.length,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Read operation failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Handle TFTP Write - Upload file to TFTP server
 */
export async function handleTFTPWrite(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const {
      host,
      port = 69,
      filename,
      data,
      mode = 'octet',
      timeout = TFTP_TIMEOUT,
    }: TFTPWriteRequest = await request.json();

    if (!host || !filename || !data) {
      return new Response('Missing host, filename, or data parameter', { status: 400 });
    }

    // Decode base64 data
    const binaryString = atob(data);
    const fileData = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      fileData[i] = binaryString.charCodeAt(i);
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Operation timeout')), timeout)
    );

    await Promise.race([socket.opened, timeoutPromise]);

    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // Send WRQ (Write Request)
    const wrqPacket = createWRQPacket(filename, mode);
    await writer.write(wrqPacket);

    // Wait for ACK 0
    const ackResult = await Promise.race([reader.read(), timeoutPromise]) as ReadableStreamReadResult<Uint8Array>;
    if (ackResult.done) {
      throw new Error('Connection closed by server');
    }

    const opcode = parseOpcode(ackResult.value);
    if (opcode === TFTP_OPCODE.ERROR) {
      const error = parseErrorPacket(ackResult.value);
      throw new Error(`TFTP Error ${error?.code}: ${error?.message}`);
    }

    if (opcode !== TFTP_OPCODE.ACK) {
      throw new Error('Expected ACK packet');
    }

    const ackBlock = parseACKPacket(ackResult.value);
    if (ackBlock !== 0) {
      throw new Error('Expected ACK for block 0');
    }

    // Send data blocks
    let blockNumber = 1;
    let offset = 0;

    while (offset < fileData.length) {
      const blockSize = Math.min(TFTP_BLOCK_SIZE, fileData.length - offset);
      const blockData = fileData.slice(offset, offset + blockSize);

      const dataPacket = createDATAPacket(blockNumber, blockData);
      await writer.write(dataPacket);

      // Wait for ACK
      const ackResult = await Promise.race([reader.read(), timeoutPromise]) as ReadableStreamReadResult<Uint8Array>;
      if (ackResult.done) {
        throw new Error('Connection closed by server');
      }

      const ackOpcode = parseOpcode(ackResult.value);
      if (ackOpcode === TFTP_OPCODE.ERROR) {
        const error = parseErrorPacket(ackResult.value);
        throw new Error(`TFTP Error ${error?.code}: ${error?.message}`);
      }

      if (ackOpcode !== TFTP_OPCODE.ACK) {
        throw new Error('Expected ACK packet');
      }

      const receivedAck = parseACKPacket(ackResult.value);
      if (receivedAck !== blockNumber) {
        throw new Error(`Expected ACK for block ${blockNumber}, got ${receivedAck}`);
      }

      offset += blockSize;
      blockNumber++;
    }

    await writer.close();
    await socket.close();

    return new Response(
      JSON.stringify({
        success: true,
        filename,
        size: fileData.length,
        blocks: blockNumber - 1,
        message: 'File uploaded successfully',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Write operation failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
