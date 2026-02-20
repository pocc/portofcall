/**
 * HL7 v2.x Protocol Implementation
 *
 * Health Level Seven - standardized healthcare data exchange format.
 * Uses MLLP (Minimal Lower Layer Protocol) for TCP message framing.
 *
 * MLLP Framing:
 *   <VT> HL7 Message <FS><CR>
 *   0x0B            0x1C 0x0D
 *
 * HL7 v2.x messages are pipe-delimited, segment-based text:
 *   MSH|^~\&|SendApp|SendFac|RecvApp|RecvFac|timestamp||ADT^A01|ID|P|2.5
 *   PID|1||12345^^^Hosp^MR||Doe^John||19800101|M
 *
 * Use Cases:
 * - Hospital information system integration testing
 * - EHR/EMR connectivity verification
 * - Lab result interface testing (ORU^R01)
 * - Patient admission workflow testing (ADT^A01)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

// MLLP framing constants
const START_OF_BLOCK = 0x0B; // <VT> Vertical Tab
const END_OF_BLOCK = 0x1C;   // <FS> File Separator
const CARRIAGE_RETURN = 0x0D; // <CR>

interface HL7ConnectRequest {
  host: string;
  port?: number;
  timeout?: number;
}

interface HL7QueryRequest {
  host: string;
  port?: number;
  timeout?: number;
  queryId?: string;
  patientId?: string;
  dateRange?: string;
}

interface HL7ADT_A08Request {
  host: string;
  port?: number;
  timeout?: number;
  patientId: string;
  lastName: string;
  firstName: string;
  dob?: string;
  sex?: string;
  diagnosis?: string;
}

interface HL7SendRequest {
  host: string;
  port?: number;
  timeout?: number;
  messageType?: string;
  sendingApplication?: string;
  sendingFacility?: string;
  receivingApplication?: string;
  receivingFacility?: string;
  rawMessage?: string;
}

/**
 * Wrap an HL7 message in MLLP framing
 */
function wrapMLLP(message: string): Uint8Array {
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(message);
  const buffer = new Uint8Array(messageBytes.length + 3);
  buffer[0] = START_OF_BLOCK;
  buffer.set(messageBytes, 1);
  buffer[messageBytes.length + 1] = END_OF_BLOCK;
  buffer[messageBytes.length + 2] = CARRIAGE_RETURN;
  return buffer;
}

/**
 * Extract HL7 message from MLLP framing.
 * Per the MLLP spec, the START_OF_BLOCK (0x0B) must be the very first byte.
 * The END_OF_BLOCK (0x1C) followed by CARRIAGE_RETURN (0x0D) marks the end.
 * This avoids false matches on payload bytes that happen to equal 0x0B or 0x1C.
 */
function unwrapMLLP(data: Uint8Array): string {
  const decoder = new TextDecoder();
  if (data.length === 0) return decoder.decode(data);
  if (data[0] !== START_OF_BLOCK) {
    // If no MLLP framing found, return raw text
    return decoder.decode(data);
  }
  // Find END_OF_BLOCK (0x1C) followed by CR (0x0D)
  for (let i = 1; i < data.length - 1; i++) {
    if (data[i] === END_OF_BLOCK && data[i + 1] === CARRIAGE_RETURN) {
      return decoder.decode(data.slice(1, i)); // Content between SB and EB
    }
  }
  // Incomplete frame — return what we have after the start byte
  return decoder.decode(data.slice(1));
}

/**
 * Format current date/time as HL7 timestamp: YYYYMMDDHHmmss
 */
function hl7Timestamp(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}${h}${mi}${s}`;
}

/**
 * Build a sample ADT^A01 (Patient Admission) message
 */
function buildADT_A01(
  sendingApp: string,
  sendingFac: string,
  receivingApp: string,
  receivingFac: string,
  controlId: string,
): string {
  const ts = hl7Timestamp();
  const segments = [
    `MSH|^~\\&|${sendingApp}|${sendingFac}|${receivingApp}|${receivingFac}|${ts}||ADT^A01|${controlId}|P|2.5`,
    `EVN|A01|${ts}`,
    `PID|1||TESTPID001^^^TestHosp^MR||TEST^PATIENT^A||19800101|M|||123 Test St^^TestCity^TS^12345^USA`,
    `PV1|1|I|TestWard^101^A|E|||TestDoc^Test^MD`,
  ];
  return segments.join('\r');
}

/**
 * Build an ORU^R01 (Lab Results) message
 */
function buildORU_R01(
  sendingApp: string,
  sendingFac: string,
  receivingApp: string,
  receivingFac: string,
  controlId: string,
): string {
  const ts = hl7Timestamp();
  const segments = [
    `MSH|^~\\&|${sendingApp}|${sendingFac}|${receivingApp}|${receivingFac}|${ts}||ORU^R01|${controlId}|P|2.5`,
    `PID|1||TESTPID001^^^TestHosp^MR||TEST^PATIENT^A||19800101|M`,
    `OBR|1|ORD001||CBC^Complete Blood Count|||${ts}`,
    `OBX|1|NM|WBC^White Blood Cell Count||7.5|10*3/uL|4.5-11.0|N|||F`,
    `OBX|2|NM|RBC^Red Blood Cell Count||4.8|10*6/uL|4.2-5.9|N|||F`,
    `OBX|3|NM|HGB^Hemoglobin||14.2|g/dL|12.0-17.5|N|||F`,
  ];
  return segments.join('\r');
}

/**
 * Parse an HL7 message into segments
 */
function parseHL7Message(raw: string): {
  messageType: string;
  triggerEvent: string;
  controlId: string;
  version: string;
  sendingApp: string;
  sendingFac: string;
  receivingApp: string;
  receivingFac: string;
  timestamp: string;
  segments: Array<{ id: string; fields: string[] }>;
  ackCode?: string;
  ackText?: string;
} {
  const lines = raw.split('\r').filter(l => l.length > 0);
  const segments: Array<{ id: string; fields: string[] }> = [];

  for (const line of lines) {
    const parts = line.split('|');
    segments.push({ id: parts[0], fields: parts.slice(1) });
  }

  const msh = segments.find(s => s.id === 'MSH');
  const msa = segments.find(s => s.id === 'MSA');

  // MSH fields (0-indexed after MSH|):
  // 0: encoding chars (^~\&)
  // 1: sending app
  // 2: sending facility
  // 3: receiving app
  // 4: receiving facility
  // 5: timestamp
  // 6: security
  // 7: message type (e.g. ADT^A01)
  // 8: control ID
  // 9: processing ID
  // 10: version

  const messageTypeField = msh?.fields[7] || '';
  const [messageType, triggerEvent] = messageTypeField.split('^');

  return {
    messageType: messageType || 'UNKNOWN',
    triggerEvent: triggerEvent || '',
    controlId: msh?.fields[8] || '',
    version: msh?.fields[10] || '',
    sendingApp: msh?.fields[1] || '',
    sendingFac: msh?.fields[2] || '',
    receivingApp: msh?.fields[3] || '',
    receivingFac: msh?.fields[4] || '',
    timestamp: msh?.fields[5] || '',
    segments,
    ackCode: msa?.fields[0],
    ackText: msa && msa.fields.length > 2 ? msa.fields[2] : undefined,
  };
}

/**
 * Build a QRY^Q01 (Patient Query) message
 */
function buildQRY_Q01(
  sendingApp: string,
  sendingFac: string,
  receivingApp: string,
  receivingFac: string,
  controlId: string,
  queryId: string,
  patientId: string,
  dateRange: string,
): string {
  const ts = hl7Timestamp();
  const segments = [
    `MSH|^~\\&|${sendingApp}|${sendingFac}|${receivingApp}|${receivingFac}|${ts}||QRY^Q01|${controlId}|P|2.5`,
    // QRD fields:
    // 1: query date/time
    // 2: query format code (R=record-oriented)
    // 3: query priority (I=immediate)
    // 4: query ID
    // 5: deferred response type (blank)
    // 6: deferred response date/time
    // 7: quantity limited request (99^RD = 99 records)
    // 8: who subject filter (patient ID)
    // 9: what subject filter (@PID)
    // 10: what department data code (blank)
    // 11: what data code value qualifier (blank)
    // 12: query results level (blank)
    `QRD|${ts}|R|I|${queryId}|||99^RD|${patientId}^^^TestHosp^MR|@PID|||${dateRange}`,
  ];
  return segments.join('\r');
}

/**
 * Build an ADT^A08 (Update Patient Information) message
 */
function buildADT_A08(
  sendingApp: string,
  sendingFac: string,
  receivingApp: string,
  receivingFac: string,
  controlId: string,
  patientId: string,
  lastName: string,
  firstName: string,
  dob: string,
  sex: string,
  diagnosis: string,
): string {
  const ts = hl7Timestamp();
  const segments = [
    `MSH|^~\\&|${sendingApp}|${sendingFac}|${receivingApp}|${receivingFac}|${ts}||ADT^A08|${controlId}|P|2.5`,
    `EVN|A08|${ts}`,
    `PID|1||${patientId}^^^TestHosp^MR||${lastName}^${firstName}||${dob}|${sex}|||123 Test St^^TestCity^TS^12345^USA`,
    `PV1|1|O|TestWard^101^A|E|||TestDoc^Test^MD||||${diagnosis ? '1' : ''}`,
    ...(diagnosis ? [`DG1|1||${diagnosis}^${diagnosis}^ICD10|${diagnosis} Diagnosis||F`] : []),
  ];
  return segments.join('\r');
}

/**
 * Handle HL7 Connect - Test MLLP connectivity to an HL7 endpoint
 */
export async function handleHL7Connect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as HL7ConnectRequest;
    const { host, port = 2575, timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;
      const rtt = Date.now() - startTime;

      await socket.close();

      return {
        success: true,
        host,
        port,
        rtt,
        message: `MLLP connection established in ${rtt}ms`,
        protocol: 'HL7 v2.x / MLLP',
      };
    })();

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 504,
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

/**
 * Handle HL7 Send - Send an HL7 message via MLLP and read the ACK
 */
export async function handleHL7Send(request: Request): Promise<Response> {
  try {
    const body = await request.json() as HL7SendRequest;
    const {
      host,
      port = 2575,
      timeout = 10000,
      messageType = 'ADT^A01',
      sendingApplication = 'PortOfCall',
      sendingFacility = 'TestFacility',
      receivingApplication = '',
      receivingFacility = '',
      rawMessage,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        // Build or use raw message
        const controlId = `MSG${Date.now()}`;
        let hl7Message: string;

        if (rawMessage) {
          hl7Message = rawMessage;
        } else {
          const [type, trigger] = messageType.split('^');
          if (type === 'ORU' && trigger === 'R01') {
            hl7Message = buildORU_R01(
              sendingApplication,
              sendingFacility,
              receivingApplication,
              receivingFacility,
              controlId,
            );
          } else {
            // Default to ADT^A01
            hl7Message = buildADT_A01(
              sendingApplication,
              sendingFacility,
              receivingApplication,
              receivingFacility,
              controlId,
            );
          }
        }

        // Wrap in MLLP and send
        const mllpData = wrapMLLP(hl7Message);
        await writer.write(mllpData);

        // Read MLLP response (ACK)
        const chunks: Uint8Array[] = [];
        let totalLength = 0;
        let receivedEndBlock = false;

        while (!receivedEndBlock) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalLength += value.length;

          // Check for end-of-block marker in accumulated data
          for (let i = 0; i < value.length; i++) {
            if (value[i] === END_OF_BLOCK) {
              receivedEndBlock = true;
              break;
            }
          }
        }

        const rtt = Date.now() - startTime;

        // Combine chunks
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        // Parse response
        const responseText = unwrapMLLP(combined);
        const parsedSent = parseHL7Message(hl7Message);
        const parsedResponse = responseText.length > 0 ? parseHL7Message(responseText) : null;

        await socket.close();

        return {
          success: true,
          host,
          port,
          rtt,
          sent: {
            messageType: parsedSent.messageType,
            triggerEvent: parsedSent.triggerEvent,
            controlId: parsedSent.controlId,
            version: parsedSent.version,
            segmentCount: parsedSent.segments.length,
            rawMessage: hl7Message.substring(0, 2000),
          },
          response: parsedResponse ? {
            messageType: parsedResponse.messageType,
            triggerEvent: parsedResponse.triggerEvent,
            controlId: parsedResponse.controlId,
            ackCode: parsedResponse.ackCode,
            ackText: parsedResponse.ackText,
            rawMessage: responseText.substring(0, 2000),
          } : null,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 502,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 504,
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

/**
 * Handle HL7 Query - Send QRY^Q01 (Patient Query) and parse response
 */
export async function handleHL7Query(request: Request): Promise<Response> {
  try {
    const body = await request.json() as HL7QueryRequest;
    const {
      host,
      port = 2575,
      timeout = 10000,
      queryId,
      patientId = 'TESTPID001',
      dateRange = '',
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        const controlId = `QRY${Date.now()}`;
        const resolvedQueryId = queryId || `QID${Date.now()}`;

        const hl7Message = buildQRY_Q01(
          'PortOfCall',
          'TestFacility',
          '',
          '',
          controlId,
          resolvedQueryId,
          patientId,
          dateRange,
        );

        // Wrap in MLLP and send
        const mllpData = wrapMLLP(hl7Message);
        await writer.write(mllpData);

        // Read MLLP response (ACK, QCK, or data)
        const chunks: Uint8Array[] = [];
        let totalLength = 0;
        let receivedEndBlock = false;

        while (!receivedEndBlock) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalLength += value.length;

          for (let i = 0; i < value.length; i++) {
            if (value[i] === END_OF_BLOCK) {
              receivedEndBlock = true;
              break;
            }
          }
        }

        const rtt = Date.now() - startTime;

        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        const responseText = unwrapMLLP(combined);
        const parsedResponse = responseText.length > 0 ? parseHL7Message(responseText) : null;

        await socket.close();

        // Count non-header/non-control segments as data rows
        const dataSegments = parsedResponse
          ? parsedResponse.segments.filter(s => s.id !== 'MSH' && s.id !== 'MSA' && s.id !== 'QAK' && s.id !== 'QRD')
          : [];

        return {
          success: true,
          host,
          port,
          rtt,
          queryId: resolvedQueryId,
          ackCode: parsedResponse?.ackCode ?? null,
          messageCount: dataSegments.length,
          segments: parsedResponse
            ? parsedResponse.segments.map(s => ({ id: s.id, fieldCount: s.fields.length }))
            : [],
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Query failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle HL7 ADT^A08 - Send Update Patient Information message and parse ACK
 */
export async function handleHL7ADT_A08(request: Request): Promise<Response> {
  try {
    const body = await request.json() as HL7ADT_A08Request;
    const {
      host,
      port = 2575,
      timeout = 10000,
      patientId,
      lastName,
      firstName,
      dob = '',
      sex = '',
      diagnosis = '',
    } = body;

    if (!host) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Host is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!patientId || !lastName || !firstName) {
      return new Response(JSON.stringify({
        success: false,
        error: 'patientId, lastName, and firstName are required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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

    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`);
      await socket.opened;

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      try {
        const controlId = `A08${Date.now()}`;

        const hl7Message = buildADT_A08(
          'PortOfCall',
          'TestFacility',
          '',
          '',
          controlId,
          patientId,
          lastName,
          firstName,
          dob,
          sex,
          diagnosis,
        );

        // Wrap in MLLP and send
        const mllpData = wrapMLLP(hl7Message);
        await writer.write(mllpData);

        // Read MLLP ACK response
        const chunks: Uint8Array[] = [];
        let totalLength = 0;
        let receivedEndBlock = false;

        while (!receivedEndBlock) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalLength += value.length;

          for (let i = 0; i < value.length; i++) {
            if (value[i] === END_OF_BLOCK) {
              receivedEndBlock = true;
              break;
            }
          }
        }

        const rtt = Date.now() - startTime;

        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        const responseText = unwrapMLLP(combined);
        const parsedResponse = responseText.length > 0 ? parseHL7Message(responseText) : null;

        await socket.close();

        return {
          success: true,
          host,
          port,
          rtt,
          messageControlId: controlId,
          ackCode: parsedResponse?.ackCode ?? null,
          ackText: parsedResponse?.ackText ?? null,
        };
      } catch (error) {
        await socket.close();
        throw error;
      }
    })();

    try {
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (timeoutError) {
      return new Response(JSON.stringify({
        success: false,
        error: timeoutError instanceof Error ? timeoutError.message : 'Connection timeout',
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'ADT^A08 failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
