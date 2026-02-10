/**
 * Modbus TCP Protocol Support for Cloudflare Workers
 * Implements Modbus TCP (port 502) for industrial device communication
 *
 * Frame: MBAP Header (7 bytes) + Function Code (1 byte) + Data (variable)
 * MBAP: Transaction ID (2) + Protocol ID (2, always 0) + Length (2) + Unit ID (1)
 *
 * WARNING: Modbus has NO authentication or encryption.
 * Write operations can cause physical damage to equipment.
 * This implementation defaults to READ-ONLY operations.
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/** Modbus function codes */
const FUNCTION_CODES: Record<string, number> = {
  READ_COILS: 0x01,
  READ_DISCRETE_INPUTS: 0x02,
  READ_HOLDING_REGISTERS: 0x03,
  READ_INPUT_REGISTERS: 0x04,
  WRITE_SINGLE_COIL: 0x05,
  WRITE_SINGLE_REGISTER: 0x06,
};

/** Modbus exception code descriptions */
const EXCEPTION_CODES: Record<number, string> = {
  0x01: 'Illegal Function',
  0x02: 'Illegal Data Address',
  0x03: 'Illegal Data Value',
  0x04: 'Server Device Failure',
  0x05: 'Acknowledge',
  0x06: 'Server Device Busy',
};

let transactionCounter = 0;

/**
 * Build a Modbus TCP request frame
 */
function buildModbusFrame(unitId: number, functionCode: number, data: number[]): Uint8Array {
  const txId = ++transactionCounter & 0xFFFF;
  const pduLength = 1 + data.length; // function code + data
  const totalLength = 7 + pduLength; // MBAP header + PDU

  const frame = new Uint8Array(totalLength);

  // MBAP Header
  frame[0] = (txId >> 8) & 0xFF;     // Transaction ID high
  frame[1] = txId & 0xFF;             // Transaction ID low
  frame[2] = 0x00;                     // Protocol ID high (always 0)
  frame[3] = 0x00;                     // Protocol ID low
  frame[4] = (pduLength >> 8) & 0xFF; // Length high
  frame[5] = pduLength & 0xFF;        // Length low
  frame[6] = unitId;                   // Unit ID

  // PDU
  frame[7] = functionCode;
  for (let i = 0; i < data.length; i++) {
    frame[8 + i] = data[i];
  }

  return frame;
}

/**
 * Read a complete Modbus TCP response from the socket
 */
async function readModbusResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<Uint8Array> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
  );

  const readPromise = (async () => {
    let buffer = new Uint8Array(0);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      // Append to buffer
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;

      // Need at least 9 bytes (MBAP header 7 + function code 1 + at least 1 byte data)
      if (buffer.length >= 9) {
        const expectedLength = ((buffer[4] << 8) | buffer[5]) + 6; // Length field + header prefix
        if (buffer.length >= expectedLength) {
          return buffer;
        }
      }
    }
    return buffer;
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

/**
 * Parse a Modbus response, checking for exceptions
 */
function parseModbusResponse(response: Uint8Array): {
  transactionId: number;
  unitId: number;
  functionCode: number;
  data: Uint8Array;
  isException: boolean;
  exceptionCode?: number;
  exceptionMessage?: string;
} {
  if (response.length < 9) {
    throw new Error('Invalid Modbus response: too short');
  }

  const transactionId = (response[0] << 8) | response[1];
  const unitId = response[6];
  const functionCode = response[7];

  // Check for exception (high bit set on function code)
  if (functionCode & 0x80) {
    const exceptionCode = response[8];
    return {
      transactionId,
      unitId,
      functionCode: functionCode & 0x7F,
      data: new Uint8Array(0),
      isException: true,
      exceptionCode,
      exceptionMessage: EXCEPTION_CODES[exceptionCode] || `Unknown exception: 0x${exceptionCode.toString(16)}`,
    };
  }

  return {
    transactionId,
    unitId,
    functionCode,
    data: response.slice(8),
    isException: false,
  };
}

/**
 * Parse coils/discrete inputs response into boolean array
 */
function parseCoilsResponse(data: Uint8Array, quantity: number): boolean[] {
  const coils: boolean[] = [];

  for (let i = 0; i < quantity; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    if (byteIndex + 1 < data.length) {
      coils.push(Boolean((data[1 + byteIndex] >> bitIndex) & 1));
    }
  }

  return coils;
}

/**
 * Parse register response into number array (16-bit values)
 */
function parseRegistersResponse(data: Uint8Array): number[] {
  const byteCount = data[0];
  const registers: number[] = [];

  for (let i = 0; i < byteCount; i += 2) {
    const value = (data[1 + i] << 8) | data[2 + i];
    registers.push(value);
  }

  return registers;
}

/**
 * Handle Modbus TCP read operations
 * POST /api/modbus/read
 *
 * Supports: Read Coils (0x01), Read Discrete Inputs (0x02),
 *           Read Holding Registers (0x03), Read Input Registers (0x04)
 */
export async function handleModbusRead(request: Request): Promise<Response> {
  try {
    const { host, port = 502, unitId = 1, functionCode, address, quantity = 1, timeout = 10000 } =
      await request.json<{
        host: string;
        port?: number;
        unitId?: number;
        functionCode: number;
        address: number;
        quantity?: number;
        timeout?: number;
      }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (functionCode === undefined || address === undefined) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: functionCode and address',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Only allow read function codes
    const readFunctions = [0x01, 0x02, 0x03, 0x04];
    if (!readFunctions.includes(functionCode)) {
      return new Response(JSON.stringify({
        error: `Invalid read function code: 0x${functionCode.toString(16)}. Allowed: 0x01 (Read Coils), 0x02 (Read Discrete Inputs), 0x03 (Read Holding Registers), 0x04 (Read Input Registers)`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate quantity (1-125 for registers, 1-2000 for coils)
    const maxQuantity = (functionCode <= 0x02) ? 2000 : 125;
    if (quantity < 1 || quantity > maxQuantity) {
      return new Response(JSON.stringify({
        error: `Quantity must be between 1 and ${maxQuantity}`,
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Build read request: address (2 bytes) + quantity (2 bytes)
        const data = [
          (address >> 8) & 0xFF,
          address & 0xFF,
          (quantity >> 8) & 0xFF,
          quantity & 0xFF,
        ];

        const frame = buildModbusFrame(unitId, functionCode, data);
        await writer.write(frame);

        const responseBytes = await readModbusResponse(reader, 5000);
        const parsed = parseModbusResponse(responseBytes);

        await socket.close();

        if (parsed.isException) {
          return {
            success: false,
            error: `Modbus exception: ${parsed.exceptionMessage} (code 0x${parsed.exceptionCode?.toString(16)})`,
            functionCode,
            address,
            quantity,
          };
        }

        // Parse based on function code
        let values: boolean[] | number[];
        let format: string;

        if (functionCode <= 0x02) {
          // Coils / Discrete Inputs
          values = parseCoilsResponse(parsed.data, quantity);
          format = 'coils';
        } else {
          // Holding / Input Registers
          values = parseRegistersResponse(parsed.data);
          format = 'registers';
        }

        return {
          success: true,
          host,
          port,
          unitId,
          functionCode,
          functionName: Object.keys(FUNCTION_CODES).find(k => FUNCTION_CODES[k] === functionCode),
          address,
          quantity,
          format,
          values,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Modbus read failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle Modbus TCP connection test
 * POST /api/modbus/connect
 *
 * Tests connectivity by reading holding register 0
 */
export async function handleModbusConnect(request: Request): Promise<Response> {
  try {
    const { host, port = 502, unitId = 1, timeout = 10000 } = await request.json<{
      host: string;
      port?: number;
      unitId?: number;
      timeout?: number;
    }>();

    if (!host) {
      return new Response(JSON.stringify({ error: 'Missing required parameter: host' }), {
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

    const connectionPromise = (async () => {
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      try {
        // Read holding register 0 as a connectivity test
        const data = [0x00, 0x00, 0x00, 0x01]; // Address 0, Quantity 1
        const frame = buildModbusFrame(unitId, 0x03, data);
        await writer.write(frame);

        const responseBytes = await readModbusResponse(reader, 5000);
        const parsed = parseModbusResponse(responseBytes);

        await socket.close();

        if (parsed.isException) {
          // Even an exception means the server responded - it's reachable
          return {
            success: true,
            message: 'Modbus server reachable (responded with exception)',
            host,
            port,
            unitId,
            exception: parsed.exceptionMessage,
          };
        }

        const registers = parseRegistersResponse(parsed.data);
        return {
          success: true,
          message: 'Modbus server reachable',
          host,
          port,
          unitId,
          testRegister: registers[0],
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
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
