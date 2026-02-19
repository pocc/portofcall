/**
 * DICOM Protocol Implementation (NEMA PS3 / ISO 12052)
 *
 * DICOM (Digital Imaging and Communications in Medicine) is the standard
 * for medical imaging communication. This implements the Upper Layer
 * Protocol for association testing and C-ECHO verification.
 *
 * Protocol Flow:
 * 1. Client connects to server port 104
 * 2. Client sends A-ASSOCIATE-RQ with Verification SOP Class
 * 3. Server responds with A-ASSOCIATE-AC (accept) or A-ASSOCIATE-RJ (reject)
 * 4. If accepted, client sends C-ECHO-RQ (DICOM ping)
 * 5. Server responds with C-ECHO-RSP
 * 6. Client sends A-RELEASE-RQ, server responds with A-RELEASE-RP
 *
 * Use Cases:
 * - DICOM server connectivity testing
 * - PACS reachability verification
 * - C-ECHO (DICOM ping) verification
 * - Server capability detection
 */

import { connect } from 'cloudflare:sockets';

// PDU Types
const PDU_A_ASSOCIATE_RQ = 0x01;
const PDU_A_ASSOCIATE_AC = 0x02;
const PDU_A_ASSOCIATE_RJ = 0x03;
const PDU_P_DATA_TF = 0x04;
const PDU_A_RELEASE_RQ = 0x05;
const PDU_A_ABORT = 0x07;

// Well-known UIDs
const DICOM_APP_CONTEXT = '1.2.840.10008.3.1.1.1';
const VERIFICATION_SOP_CLASS = '1.2.840.10008.1.1';
const IMPLICIT_VR_LE = '1.2.840.10008.1.2';
const EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';
const IMPLEMENTATION_CLASS_UID = '1.2.826.0.1.3680043.8.498.1';
const IMPLEMENTATION_VERSION = 'PORTOFCALL_001';

// Association rejection reasons
const REJECT_RESULTS: Record<number, string> = {
  1: 'Permanent rejection',
  2: 'Transient rejection',
};

const REJECT_SOURCES: Record<number, string> = {
  1: 'DICOM UL service-user',
  2: 'DICOM UL service-provider (ACSE)',
  3: 'DICOM UL service-provider (Presentation)',
};

const REJECT_REASONS_USER: Record<number, string> = {
  1: 'No reason given',
  2: 'Application context name not supported',
  3: 'Calling AE title not recognized',
  7: 'Called AE title not recognized',
};

const REJECT_REASONS_ACSE: Record<number, string> = {
  1: 'No reason given',
  2: 'Protocol version not supported',
};

const REJECT_REASONS_PRESENTATION: Record<number, string> = {
  0: 'No reason given',
  1: 'Temporary congestion',
  2: 'Local limit exceeded',
};

interface DICOMConnectRequest {
  host: string;
  port?: number;
  callingAE?: string;
  calledAE?: string;
  timeout?: number;
}

interface DICOMEchoRequest {
  host: string;
  port?: number;
  callingAE?: string;
  calledAE?: string;
  timeout?: number;
}

/**
 * Pad an AE title to 16 bytes with spaces
 */
function padAETitle(ae: string): Uint8Array {
  const padded = new Uint8Array(16);
  padded.fill(0x20); // Space padding
  const encoder = new TextEncoder();
  const bytes = encoder.encode(ae.substring(0, 16).toUpperCase());
  padded.set(bytes, 0);
  return padded;
}

/**
 * Write a UID item (Application Context, Abstract Syntax, Transfer Syntax)
 */
function writeUIDItem(itemType: number, uid: string): Uint8Array {
  const uidBytes = new TextEncoder().encode(uid);
  // Pad to even length
  const paddedLength = uidBytes.length % 2 === 0 ? uidBytes.length : uidBytes.length + 1;
  const buffer = new Uint8Array(4 + paddedLength);
  buffer[0] = itemType;
  buffer[1] = 0x00; // Reserved
  new DataView(buffer.buffer).setUint16(2, paddedLength, false);
  buffer.set(uidBytes, 4);
  return buffer;
}

/**
 * Build an A-ASSOCIATE-RQ PDU for Verification SOP Class
 */
function buildAssociateRequest(callingAE: string, calledAE: string): Uint8Array {
  const parts: Uint8Array[] = [];

  // Application Context item
  parts.push(writeUIDItem(0x10, DICOM_APP_CONTEXT));

  // Presentation Context item (Verification SOP Class)
  const abstractSyntax = writeUIDItem(0x30, VERIFICATION_SOP_CLASS);
  const transferSyntax1 = writeUIDItem(0x40, IMPLICIT_VR_LE);
  const transferSyntax2 = writeUIDItem(0x40, EXPLICIT_VR_LE);

  const pcContentLength = 4 + abstractSyntax.length + transferSyntax1.length + transferSyntax2.length;
  const pcItem = new Uint8Array(4 + pcContentLength);
  pcItem[0] = 0x20; // Presentation Context item type
  pcItem[1] = 0x00;
  new DataView(pcItem.buffer).setUint16(2, pcContentLength, false);
  pcItem[4] = 0x01; // Presentation Context ID
  pcItem[5] = 0x00; // Reserved
  pcItem[6] = 0x00; // Reserved
  pcItem[7] = 0x00; // Reserved
  let pcOffset = 8;
  pcItem.set(abstractSyntax, pcOffset); pcOffset += abstractSyntax.length;
  pcItem.set(transferSyntax1, pcOffset); pcOffset += transferSyntax1.length;
  pcItem.set(transferSyntax2, pcOffset);
  parts.push(pcItem);

  // User Information item
  // Max PDU Length sub-item
  const maxPDU = new Uint8Array(8);
  maxPDU[0] = 0x51; maxPDU[1] = 0x00;
  new DataView(maxPDU.buffer).setUint16(2, 4, false);
  new DataView(maxPDU.buffer).setUint32(4, 16384, false);

  // Implementation Class UID sub-item
  const implClassUID = writeUIDItem(0x52, IMPLEMENTATION_CLASS_UID);

  // Implementation Version Name sub-item
  const implVersionBytes = new TextEncoder().encode(IMPLEMENTATION_VERSION);
  const paddedImplLen = implVersionBytes.length % 2 === 0 ? implVersionBytes.length : implVersionBytes.length + 1;
  const implVersion = new Uint8Array(4 + paddedImplLen);
  implVersion[0] = 0x55; implVersion[1] = 0x00;
  new DataView(implVersion.buffer).setUint16(2, paddedImplLen, false);
  implVersion.set(implVersionBytes, 4);

  const uiContentLength = maxPDU.length + implClassUID.length + implVersion.length;
  const uiItem = new Uint8Array(4 + uiContentLength);
  uiItem[0] = 0x50; uiItem[1] = 0x00;
  new DataView(uiItem.buffer).setUint16(2, uiContentLength, false);
  let uiOffset = 4;
  uiItem.set(maxPDU, uiOffset); uiOffset += maxPDU.length;
  uiItem.set(implClassUID, uiOffset); uiOffset += implClassUID.length;
  uiItem.set(implVersion, uiOffset);
  parts.push(uiItem);

  // Calculate variable items total length
  const variableLength = parts.reduce((sum, p) => sum + p.length, 0);

  // Fixed fields: protocol version (2) + reserved (2) + called AE (16) + calling AE (16) + reserved (32) = 68
  const pduDataLength = 68 + variableLength;

  // Build PDU: type (1) + reserved (1) + length (4) + data
  const pdu = new Uint8Array(6 + pduDataLength);
  const view = new DataView(pdu.buffer);

  pdu[0] = PDU_A_ASSOCIATE_RQ;
  pdu[1] = 0x00;
  view.setUint32(2, pduDataLength, false);

  // Protocol version
  view.setUint16(6, 0x0001, false);

  // Reserved (2 bytes at offset 8)
  // Called AE Title (16 bytes at offset 10)
  pdu.set(padAETitle(calledAE), 10);

  // Calling AE Title (16 bytes at offset 26)
  pdu.set(padAETitle(callingAE), 26);

  // Reserved (32 bytes at offset 42) - already zeros

  // Variable items starting at offset 74
  let offset = 74;
  for (const part of parts) {
    pdu.set(part, offset);
    offset += part.length;
  }

  return pdu;
}

/**
 * Build a C-ECHO-RQ wrapped in P-DATA-TF PDU
 */
function buildCEchoRequest(messageId: number): Uint8Array {
  // Build DICOM Command Set in Implicit VR Little Endian
  const elements: Uint8Array[] = [];

  // Affected SOP Class UID (0000,0002)
  const sopUID = new TextEncoder().encode(VERIFICATION_SOP_CLASS);
  const paddedSopLen = sopUID.length % 2 === 0 ? sopUID.length : sopUID.length + 1;
  const elem1 = new Uint8Array(8 + paddedSopLen);
  new DataView(elem1.buffer).setUint16(0, 0x0000, true); // group
  new DataView(elem1.buffer).setUint16(2, 0x0002, true); // element
  new DataView(elem1.buffer).setUint32(4, paddedSopLen, true); // length
  elem1.set(sopUID, 8);
  elements.push(elem1);

  // Command Field (0000,0100) = C-ECHO-RQ = 0x0030
  const elem2 = new Uint8Array(12);
  new DataView(elem2.buffer).setUint16(0, 0x0000, true);
  new DataView(elem2.buffer).setUint16(2, 0x0100, true);
  new DataView(elem2.buffer).setUint32(4, 2, true);
  new DataView(elem2.buffer).setUint16(8, 0x0030, true);
  elements.push(elem2);

  // Message ID (0000,0110)
  const elem3 = new Uint8Array(12);
  new DataView(elem3.buffer).setUint16(0, 0x0000, true);
  new DataView(elem3.buffer).setUint16(2, 0x0110, true);
  new DataView(elem3.buffer).setUint32(4, 2, true);
  new DataView(elem3.buffer).setUint16(8, messageId, true);
  elements.push(elem3);

  // Command Data Set Type (0000,0800) = 0x0101 (no dataset)
  const elem4 = new Uint8Array(12);
  new DataView(elem4.buffer).setUint16(0, 0x0000, true);
  new DataView(elem4.buffer).setUint16(2, 0x0800, true);
  new DataView(elem4.buffer).setUint32(4, 2, true);
  new DataView(elem4.buffer).setUint16(8, 0x0101, true);
  elements.push(elem4);

  // Compute Command Group Length (0000,0000)
  const commandDataLength = elements.reduce((sum, e) => sum + e.length, 0);
  const groupLengthElem = new Uint8Array(12);
  new DataView(groupLengthElem.buffer).setUint16(0, 0x0000, true);
  new DataView(groupLengthElem.buffer).setUint16(2, 0x0000, true);
  new DataView(groupLengthElem.buffer).setUint32(4, 4, true);
  new DataView(groupLengthElem.buffer).setUint32(8, commandDataLength, true);

  // Combine all command elements
  const totalCommandLength = groupLengthElem.length + commandDataLength;
  const commandSet = new Uint8Array(totalCommandLength);
  let cmdOffset = 0;
  commandSet.set(groupLengthElem, cmdOffset); cmdOffset += groupLengthElem.length;
  for (const elem of elements) {
    commandSet.set(elem, cmdOffset); cmdOffset += elem.length;
  }

  // Wrap in Presentation Data Value Item
  // PDV Item: length(4) + context-id(1) + control-header(1) + data
  const pdvItemLength = 2 + commandSet.length;
  const pdvItem = new Uint8Array(4 + pdvItemLength);
  new DataView(pdvItem.buffer).setUint32(0, pdvItemLength, false);
  pdvItem[4] = 0x01; // Presentation Context ID
  pdvItem[5] = 0x03; // Command + Last Fragment
  pdvItem.set(commandSet, 6);

  // Wrap in P-DATA-TF PDU
  const pdu = new Uint8Array(6 + pdvItem.length);
  pdu[0] = PDU_P_DATA_TF;
  pdu[1] = 0x00;
  new DataView(pdu.buffer).setUint32(2, pdvItem.length, false);
  pdu.set(pdvItem, 6);

  return pdu;
}

/**
 * Build an A-RELEASE-RQ PDU
 */
function buildReleaseRequest(): Uint8Array {
  const pdu = new Uint8Array(10);
  pdu[0] = PDU_A_RELEASE_RQ;
  pdu[1] = 0x00;
  new DataView(pdu.buffer).setUint32(2, 4, false);
  // 4 bytes reserved (zeros)
  return pdu;
}

/**
 * Read exactly N bytes from a socket reader
 */
async function readExact(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  length: number,
  timeoutPromise: Promise<never>,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let offset = 0;

  while (offset < length) {
    const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
    if (done || !value) throw new Error('Connection closed unexpectedly');

    const toCopy = Math.min(length - offset, value.length);
    buffer.set(value.subarray(0, toCopy), offset);
    offset += toCopy;
  }

  return buffer;
}

/**
 * Read a full DICOM PDU (header + data)
 */
async function readPDU(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutPromise: Promise<never>,
): Promise<{ type: number; data: Uint8Array }> {
  // Read PDU header: type(1) + reserved(1) + length(4) = 6 bytes
  const header = await readExact(reader, 6, timeoutPromise);
  const type = header[0];
  const length = new DataView(header.buffer).getUint32(2, false);

  if (length > 1048576) {
    throw new Error(`PDU too large: ${length} bytes`);
  }

  const data = length > 0 ? await readExact(reader, length, timeoutPromise) : new Uint8Array(0);
  return { type, data };
}

/**
 * Parse an A-ASSOCIATE-AC response
 */
function parseAssociateAccept(data: Uint8Array): {
  protocolVersion: number;
  calledAE: string;
  callingAE: string;
  acceptedContexts: Array<{ id: number; result: number; transferSyntax: string }>;
  maxPDULength: number;
  implementationClassUID: string;
  implementationVersion: string;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();

  const protocolVersion = view.getUint16(0, false);
  const calledAE = decoder.decode(data.subarray(4, 20)).trim();
  const callingAE = decoder.decode(data.subarray(20, 36)).trim();

  const acceptedContexts: Array<{ id: number; result: number; transferSyntax: string }> = [];
  let maxPDULength = 0;
  let implementationClassUID = '';
  let implementationVersion = '';

  // Parse variable items starting at offset 68
  let offset = 68;
  while (offset < data.length) {
    const itemType = data[offset];
    // reserved byte at offset+1
    const itemLength = view.getUint16(offset + 2, false);
    const itemData = data.subarray(offset + 4, offset + 4 + itemLength);

    if (itemType === 0x21) {
      // Presentation Context (accepted)
      const pcId = itemData[0];
      const pcResult = itemData[2]; // 0 = acceptance
      // Find transfer syntax sub-item
      let tsOffset = 4;
      let transferSyntax = '';
      while (tsOffset < itemData.length) {
        const subType = itemData[tsOffset];
        const subLength = new DataView(itemData.buffer, itemData.byteOffset + tsOffset + 2).getUint16(0, false);
        if (subType === 0x40) {
          transferSyntax = decoder.decode(itemData.subarray(tsOffset + 4, tsOffset + 4 + subLength)).replace(/\0/g, '');
        }
        tsOffset += 4 + subLength;
      }
      acceptedContexts.push({ id: pcId, result: pcResult, transferSyntax });
    } else if (itemType === 0x50) {
      // User Information
      let uiOffset = 0;
      while (uiOffset < itemData.length) {
        const subType = itemData[uiOffset];
        const subLength = new DataView(itemData.buffer, itemData.byteOffset + uiOffset + 2).getUint16(0, false);
        const subData = itemData.subarray(uiOffset + 4, uiOffset + 4 + subLength);

        if (subType === 0x51) {
          maxPDULength = new DataView(subData.buffer, subData.byteOffset).getUint32(0, false);
        } else if (subType === 0x52) {
          implementationClassUID = decoder.decode(subData).replace(/\0/g, '').trim();
        } else if (subType === 0x55) {
          implementationVersion = decoder.decode(subData).replace(/\0/g, '').trim();
        }
        uiOffset += 4 + subLength;
      }
    }

    offset += 4 + itemLength;
  }

  return {
    protocolVersion,
    calledAE,
    callingAE,
    acceptedContexts,
    maxPDULength,
    implementationClassUID,
    implementationVersion,
  };
}

/**
 * Parse an A-ASSOCIATE-RJ response
 */
function parseAssociateReject(data: Uint8Array): {
  result: string;
  source: string;
  reason: string;
} {
  const resultCode = data[1];
  const sourceCode = data[2];
  const reasonCode = data[3];

  let reasonText = 'Unknown';
  if (sourceCode === 1) {
    reasonText = REJECT_REASONS_USER[reasonCode] || `Unknown (${reasonCode})`;
  } else if (sourceCode === 2) {
    reasonText = REJECT_REASONS_ACSE[reasonCode] || `Unknown (${reasonCode})`;
  } else if (sourceCode === 3) {
    reasonText = REJECT_REASONS_PRESENTATION[reasonCode] || `Unknown (${reasonCode})`;
  }

  return {
    result: REJECT_RESULTS[resultCode] || `Unknown (${resultCode})`,
    source: REJECT_SOURCES[sourceCode] || `Unknown (${sourceCode})`,
    reason: reasonText,
  };
}

/**
 * Parse a C-ECHO-RSP from P-DATA-TF
 */
function parseCEchoResponse(data: Uint8Array): { status: number; statusText: string } {
  // P-DATA-TF data contains PDV items
  // PDV item: length(4) + context-id(1) + control(1) + command-set
  // Skip to command set (offset 6 within the PDV data)
  const commandSet = data.subarray(6);

  // Parse implicit VR LE elements looking for Status (0000,0900)
  let offset = 0;
  const view = new DataView(commandSet.buffer, commandSet.byteOffset, commandSet.byteLength);
  let status = -1;

  while (offset + 8 <= commandSet.length) {
    const group = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);
    const length = view.getUint32(offset + 4, true);
    offset += 8;

    if (group === 0x0000 && element === 0x0900 && length === 2) {
      status = view.getUint16(offset, true);
    }

    offset += length;
  }

  let statusText = 'Unknown';
  if (status === 0x0000) statusText = 'Success';
  else if (status === 0x0112) statusText = 'SOP Class Not Supported';
  else if (status === 0x0110) statusText = 'Processing Failure';
  else if (status === 0x0211) statusText = 'Unrecognized Operation';

  return { status, statusText };
}

/**
 * Handle DICOM association test (connect + optional C-ECHO)
 */
export async function handleDICOMConnect(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as DICOMConnectRequest;
    const { host, port = 104, callingAE = 'PORTOFCALL', calledAE = 'ANY-SCP', timeout = 10000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate AE titles (1-16 chars, printable ASCII)
    if (callingAE && (callingAE.length > 16 || !/^[\x20-\x7E]+$/.test(callingAE))) {
      return new Response(JSON.stringify({ success: false, error: 'Calling AE title must be 1-16 printable ASCII characters' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (calledAE && (calledAE.length > 16 || !/^[\x20-\x7E]+$/.test(calledAE))) {
      return new Response(JSON.stringify({ success: false, error: 'Called AE title must be 1-16 printable ASCII characters' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);
      const connectTime = Date.now() - startTime;

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      // Send A-ASSOCIATE-RQ
      const associateRQ = buildAssociateRequest(callingAE, calledAE);
      await writer.write(associateRQ);

      // Read response PDU
      const response = await readPDU(reader, timeoutPromise);
      const rtt = Date.now() - startTime;

      if (response.type === PDU_A_ASSOCIATE_AC) {
        const parsed = parseAssociateAccept(response.data);

        // Clean up
        try {
          await writer.write(buildReleaseRequest());
          await readPDU(reader, timeoutPromise);
        } catch { /* ignore release errors */ }

        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        const verificationAccepted = parsed.acceptedContexts.some(
          ctx => ctx.result === 0
        );

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          connectTime,
          rtt,
          associationAccepted: true,
          calledAE: parsed.calledAE,
          callingAE: parsed.callingAE,
          protocolVersion: parsed.protocolVersion,
          maxPDULength: parsed.maxPDULength,
          implementationClassUID: parsed.implementationClassUID,
          implementationVersion: parsed.implementationVersion,
          verificationAccepted,
          acceptedContexts: parsed.acceptedContexts.map(ctx => ({
            id: ctx.id,
            accepted: ctx.result === 0,
            resultText: ctx.result === 0 ? 'Acceptance' :
                        ctx.result === 1 ? 'User rejection' :
                        ctx.result === 2 ? 'No reason (provider rejection)' :
                        ctx.result === 3 ? 'Abstract syntax not supported' :
                        ctx.result === 4 ? 'Transfer syntaxes not supported' :
                        `Unknown (${ctx.result})`,
            transferSyntax: ctx.transferSyntax,
          })),
        }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      } else if (response.type === PDU_A_ASSOCIATE_RJ) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        const rejection = parseAssociateReject(response.data);

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          connectTime,
          rtt,
          associationAccepted: false,
          rejectionResult: rejection.result,
          rejectionSource: rejection.source,
          rejectionReason: rejection.reason,
        }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      } else if (response.type === PDU_A_ABORT) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        return new Response(JSON.stringify({
          success: true,
          host,
          port,
          connectTime,
          rtt,
          associationAccepted: false,
          aborted: true,
          abortSource: response.data[0] === 0 ? 'Service user' : 'Service provider',
        }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      } else {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        return new Response(JSON.stringify({
          success: false,
          error: `Unexpected PDU type: 0x${response.type.toString(16).padStart(2, '0')}`,
        }), {
          status: 502, headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle DICOM C-ECHO (verification/ping) test
 */
export async function handleDICOMEcho(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as DICOMEchoRequest;
    const { host, port = 104, callingAE = 'PORTOFCALL', calledAE = 'ANY-SCP', timeout = 15000 } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (callingAE && (callingAE.length > 16 || !/^[\x20-\x7E]+$/.test(callingAE))) {
      return new Response(JSON.stringify({ success: false, error: 'Calling AE title must be 1-16 printable ASCII characters' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (calledAE && (calledAE.length > 16 || !/^[\x20-\x7E]+$/.test(calledAE))) {
      return new Response(JSON.stringify({ success: false, error: 'Called AE title must be 1-16 printable ASCII characters' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      // Step 1: Association
      await writer.write(buildAssociateRequest(callingAE, calledAE));
      const assocResponse = await readPDU(reader, timeoutPromise);

      if (assocResponse.type !== PDU_A_ASSOCIATE_AC) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        if (assocResponse.type === PDU_A_ASSOCIATE_RJ) {
          const rejection = parseAssociateReject(assocResponse.data);
          return new Response(JSON.stringify({
            success: false,
            error: `Association rejected: ${rejection.reason} (${rejection.source})`,
          }), {
            status: 502, headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({
          success: false,
          error: `Association failed with PDU type: 0x${assocResponse.type.toString(16)}`,
        }), {
          status: 502, headers: { 'Content-Type': 'application/json' },
        });
      }

      const assocInfo = parseAssociateAccept(assocResponse.data);
      const associateTime = Date.now() - startTime;

      // Check if Verification SOP Class was accepted
      const verificationContext = assocInfo.acceptedContexts.find(ctx => ctx.result === 0);
      if (!verificationContext) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();

        return new Response(JSON.stringify({
          success: false,
          error: 'Verification SOP Class not accepted by server',
        }), {
          status: 502, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 2: C-ECHO
      const echoStartTime = Date.now();
      await writer.write(buildCEchoRequest(1));
      const echoResponse = await readPDU(reader, timeoutPromise);
      const echoTime = Date.now() - echoStartTime;

      let echoStatus = { status: -1, statusText: 'No response' };
      if (echoResponse.type === PDU_P_DATA_TF) {
        echoStatus = parseCEchoResponse(echoResponse.data);
      }

      // Step 3: Release
      try {
        await writer.write(buildReleaseRequest());
        await readPDU(reader, timeoutPromise);
      } catch { /* ignore */ }

      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      const totalTime = Date.now() - startTime;

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        callingAE,
        calledAE: assocInfo.calledAE,
        associateTime,
        echoTime,
        totalTime,
        echoSuccess: echoStatus.status === 0,
        echoStatus: echoStatus.status,
        echoStatusText: echoStatus.statusText,
        implementationClassUID: assocInfo.implementationClassUID,
        implementationVersion: assocInfo.implementationVersion,
        maxPDULength: assocInfo.maxPDULength,
        transferSyntax: verificationContext.transferSyntax,
      }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Study Root Query/Retrieve Information Model - FIND SOP Class
const STUDY_ROOT_FIND_SOP_CLASS = '1.2.840.10008.5.1.4.1.2.2.1';

/**
 * Build an A-ASSOCIATE-RQ for Study Root C-FIND.
 */
function buildAssociateRequestFind(callingAE: string, calledAE: string): Uint8Array {
  const parts: Uint8Array[] = [];

  // Application Context item
  parts.push(writeUIDItem(0x10, DICOM_APP_CONTEXT));

  // Presentation Context for Study Root Find (ID=1)
  const abstractSyntax = writeUIDItem(0x30, STUDY_ROOT_FIND_SOP_CLASS);
  const transferSyntax1 = writeUIDItem(0x40, IMPLICIT_VR_LE);
  const transferSyntax2 = writeUIDItem(0x40, EXPLICIT_VR_LE);
  const pcContentLength = 4 + abstractSyntax.length + transferSyntax1.length + transferSyntax2.length;
  const pcItem = new Uint8Array(4 + pcContentLength);
  pcItem[0] = 0x20; pcItem[1] = 0x00;
  new DataView(pcItem.buffer).setUint16(2, pcContentLength, false);
  pcItem[4] = 0x01; // Presentation Context ID
  pcItem[5] = 0x00; pcItem[6] = 0x00; pcItem[7] = 0x00;
  let pcOffset = 8;
  pcItem.set(abstractSyntax, pcOffset); pcOffset += abstractSyntax.length;
  pcItem.set(transferSyntax1, pcOffset); pcOffset += transferSyntax1.length;
  pcItem.set(transferSyntax2, pcOffset);
  parts.push(pcItem);

  // User Information
  const maxPDU = new Uint8Array(8);
  maxPDU[0] = 0x51; maxPDU[1] = 0x00;
  new DataView(maxPDU.buffer).setUint16(2, 4, false);
  new DataView(maxPDU.buffer).setUint32(4, 16384, false);
  const implClassUID = writeUIDItem(0x52, IMPLEMENTATION_CLASS_UID);
  const implVersionBytes = new TextEncoder().encode(IMPLEMENTATION_VERSION);
  const paddedImplLen = implVersionBytes.length % 2 === 0 ? implVersionBytes.length : implVersionBytes.length + 1;
  const implVersion = new Uint8Array(4 + paddedImplLen);
  implVersion[0] = 0x55; implVersion[1] = 0x00;
  new DataView(implVersion.buffer).setUint16(2, paddedImplLen, false);
  implVersion.set(implVersionBytes, 4);
  const uiContentLength = maxPDU.length + implClassUID.length + implVersion.length;
  const uiItem = new Uint8Array(4 + uiContentLength);
  uiItem[0] = 0x50; uiItem[1] = 0x00;
  new DataView(uiItem.buffer).setUint16(2, uiContentLength, false);
  let uiOffset = 4;
  uiItem.set(maxPDU, uiOffset); uiOffset += maxPDU.length;
  uiItem.set(implClassUID, uiOffset); uiOffset += implClassUID.length;
  uiItem.set(implVersion, uiOffset);
  parts.push(uiItem);

  const variableLength = parts.reduce((sum, p) => sum + p.length, 0);
  const pduDataLength = 68 + variableLength;
  const pdu = new Uint8Array(6 + pduDataLength);
  const view = new DataView(pdu.buffer);
  pdu[0] = PDU_A_ASSOCIATE_RQ;
  pdu[1] = 0x00;
  view.setUint32(2, pduDataLength, false);
  view.setUint16(6, 0x0001, false);
  pdu.set(padAETitle(calledAE), 10);
  pdu.set(padAETitle(callingAE), 26);
  let offset = 74;
  for (const part of parts) {
    pdu.set(part, offset);
    offset += part.length;
  }
  return pdu;
}

/**
 * Encode a DICOM string attribute in Implicit VR Little Endian.
 * (group, element, value)
 */
function dicomStringElement(group: number, element: number, value: string): Uint8Array {
  const enc = new TextEncoder().encode(value);
  // Pad to even length
  const paddedLen = enc.length % 2 === 0 ? enc.length : enc.length + 1;
  const buf = new Uint8Array(8 + paddedLen);
  const view = new DataView(buf.buffer);
  view.setUint16(0, group, true);
  view.setUint16(2, element, true);
  view.setUint32(4, paddedLen, true);
  buf.set(enc, 8);
  return buf;
}

/**
 * Build a C-FIND-RQ dataset wrapped in P-DATA-TF.
 *
 * DIMSE header fields:
 *   (0000,0000) CommandGroupLength
 *   (0000,0002) AffectedSOPClassUID = StudyRootFindSOP
 *   (0000,0100) CommandField = 0x0020 (C-FIND-RQ)
 *   (0000,0110) MessageID
 *   (0000,0700) Priority = 0x0000 (MEDIUM)
 *   (0000,0800) CommandDataSetType = 0x0102 (dataset present)
 *
 * Dataset (search keys):
 *   (0008,0052) QueryRetrieveLevel
 *   (0008,0020) StudyDate
 *   (0010,0010) PatientName
 *   (0010,0020) PatientID
 *   (0020,000D) StudyInstanceUID
 */
function buildCFindRequest(
  messageId: number,
  queryLevel: string,
  patientId: string,
  studyDate: string,
): Uint8Array {
  // --- Build the DIMSE command set (Implicit VR LE, group 0000) ---
  const sopUIDBytes = new TextEncoder().encode(STUDY_ROOT_FIND_SOP_CLASS);
  const paddedSOPLen = sopUIDBytes.length % 2 === 0 ? sopUIDBytes.length : sopUIDBytes.length + 1;

  // AffectedSOPClassUID (0000,0002)
  const elemSOP = new Uint8Array(8 + paddedSOPLen);
  {
    const v = new DataView(elemSOP.buffer);
    v.setUint16(0, 0x0000, true); v.setUint16(2, 0x0002, true); v.setUint32(4, paddedSOPLen, true);
    elemSOP.set(sopUIDBytes, 8);
  }

  // CommandField (0000,0100) = 0x0020 C-FIND-RQ
  const elemCmd = new Uint8Array(10);
  { const v = new DataView(elemCmd.buffer); v.setUint16(0,0,true); v.setUint16(2,0x0100,true); v.setUint32(4,2,true); v.setUint16(8,0x0020,true); }

  // MessageID (0000,0110)
  const elemMsgId = new Uint8Array(10);
  { const v = new DataView(elemMsgId.buffer); v.setUint16(0,0,true); v.setUint16(2,0x0110,true); v.setUint32(4,2,true); v.setUint16(8,messageId,true); }

  // Priority (0000,0700) = 0x0000 MEDIUM
  const elemPri = new Uint8Array(10);
  { const v = new DataView(elemPri.buffer); v.setUint16(0,0,true); v.setUint16(2,0x0700,true); v.setUint32(4,2,true); v.setUint16(8,0x0000,true); }

  // CommandDataSetType (0000,0800) = 0x0102 (dataset present)
  const elemDST = new Uint8Array(10);
  { const v = new DataView(elemDST.buffer); v.setUint16(0,0,true); v.setUint16(2,0x0800,true); v.setUint32(4,2,true); v.setUint16(8,0x0102,true); }

  // CommandGroupLength (0000,0000) — value = total length of remaining command elements
  const remainingLen = elemSOP.length + elemCmd.length + elemMsgId.length + elemPri.length + elemDST.length;
  const elemGL = new Uint8Array(12);
  { const v = new DataView(elemGL.buffer); v.setUint16(0,0,true); v.setUint16(2,0,true); v.setUint32(4,4,true); v.setUint32(8,remainingLen,true); }

  const commandSet = new Uint8Array(elemGL.length + remainingLen);
  let cmdOff = 0;
  commandSet.set(elemGL, cmdOff); cmdOff += elemGL.length;
  commandSet.set(elemSOP, cmdOff); cmdOff += elemSOP.length;
  commandSet.set(elemCmd, cmdOff); cmdOff += elemCmd.length;
  commandSet.set(elemMsgId, cmdOff); cmdOff += elemMsgId.length;
  commandSet.set(elemPri, cmdOff); cmdOff += elemPri.length;
  commandSet.set(elemDST, cmdOff);

  // --- Build the dataset ---
  const levelElem = dicomStringElement(0x0008, 0x0052, queryLevel);
  const dateElem  = dicomStringElement(0x0008, 0x0020, studyDate);
  const nameElem  = dicomStringElement(0x0010, 0x0010, '');
  const pidElem   = dicomStringElement(0x0010, 0x0020, patientId);
  const suidElem  = dicomStringElement(0x0020, 0x000D, '');

  const datasetLength = levelElem.length + dateElem.length + nameElem.length + pidElem.length + suidElem.length;
  const dataset = new Uint8Array(datasetLength);
  let dsOff = 0;
  dataset.set(levelElem, dsOff); dsOff += levelElem.length;
  dataset.set(dateElem,  dsOff); dsOff += dateElem.length;
  dataset.set(nameElem,  dsOff); dsOff += nameElem.length;
  dataset.set(pidElem,   dsOff); dsOff += pidElem.length;
  dataset.set(suidElem,  dsOff);

  // --- Build the two PDVs: command (context 1, flags 0x03) + dataset (context 1, flags 0x02) ---
  function makePDV(contextId: number, flags: number, data: Uint8Array): Uint8Array {
    const pdvLen = 2 + data.length;
    const item = new Uint8Array(4 + pdvLen);
    new DataView(item.buffer).setUint32(0, pdvLen, false);
    item[4] = contextId;
    item[5] = flags;
    item.set(data, 6);
    return item;
  }

  const cmdPDV     = makePDV(0x01, 0x03, commandSet); // command + last fragment
  const datasetPDV = makePDV(0x01, 0x02, dataset);    // dataset + last fragment

  // Wrap both PDVs in a single P-DATA-TF PDU
  const totalPDVLen = cmdPDV.length + datasetPDV.length;
  const pdu = new Uint8Array(6 + totalPDVLen);
  pdu[0] = PDU_P_DATA_TF;
  pdu[1] = 0x00;
  new DataView(pdu.buffer).setUint32(2, totalPDVLen, false);
  pdu.set(cmdPDV, 6);
  pdu.set(datasetPDV, 6 + cmdPDV.length);

  return pdu;
}

// VRs that use the long form in Explicit VR: 2 reserved bytes + 4-byte length
const LONG_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);

/**
 * Parse DICOM data elements from a byte buffer.
 * Supports both Implicit VR Little Endian and Explicit VR Little Endian.
 *
 * Implicit VR LE: tag(4) + length(4)
 * Explicit VR LE: tag(4) + VR(2) + length(2)          — for short-form VRs
 *                 tag(4) + VR(2) + reserved(2) + length(4) — for long-form VRs
 *
 * @param data Raw byte buffer containing DICOM data elements
 * @param transferSyntax Transfer syntax UID (defaults to Implicit VR LE)
 * Returns a map of "GGGG,EEEE" tag keys to string values.
 */
function parseDICOMDataset(
  data: Uint8Array,
  transferSyntax: string = IMPLICIT_VR_LE,
): Record<string, string> {
  const decoder = new TextDecoder();
  const result: Record<string, string> = {};
  let offset = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const explicit = transferSyntax === EXPLICIT_VR_LE;

  while (offset + 4 <= data.length) {
    const group   = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);

    let length: number;

    if (explicit) {
      // Explicit VR LE: tag(4) + VR(2 ASCII bytes) + ...
      if (offset + 8 > data.length) break;

      const vr = String.fromCharCode(data[offset + 4], data[offset + 5]);

      if (LONG_VRS.has(vr)) {
        // Long form: VR(2) + reserved(2) + length(4) = 8 bytes after tag
        if (offset + 12 > data.length) break;
        length = view.getUint32(offset + 8, true);
        offset += 12;
      } else {
        // Short form: VR(2) + length(2) = 4 bytes after tag
        length = view.getUint16(offset + 6, true);
        offset += 8;
      }
    } else {
      // Implicit VR LE: tag(4) + length(4) = 8 bytes
      if (offset + 8 > data.length) break;
      length = view.getUint32(offset + 4, true);
      offset += 8;
    }

    if (length === 0xFFFFFFFF) break; // sequence / undefined length — stop
    if (offset + length > data.length) break;

    const tag = `${group.toString(16).padStart(4,'0')},${element.toString(16).padStart(4,'0')}`;
    const valueBytes = data.subarray(offset, offset + length);
    result[tag] = decoder.decode(valueBytes).replace(/\0/g, '').trim();
    offset += length;
  }

  return result;
}

/**
 * Parse a C-FIND-RSP from a P-DATA-TF PDU.
 * Returns { status, dataset } where status is 0=pending, 0xFF00=pending with dataset,
 * 0x0000=success, or an error code.
 *
 * @param data Raw P-DATA-TF payload
 * @param transferSyntax Transfer syntax negotiated for the dataset (not the command set,
 *   which is always Implicit VR LE per the DICOM standard)
 */
function parseCFindResponse(
  data: Uint8Array,
  transferSyntax: string = IMPLICIT_VR_LE,
): { status: number; dataset: Record<string, string> } {
  // Data format: PDV item = length(4BE) + context-id(1) + control(1) + payload
  // There may be two PDV items: command + dataset
  let status = -1;
  let dataset: Record<string, string> = {};
  let offset = 0;

  while (offset + 6 <= data.length) {
    const pdvLen = new DataView(data.buffer, data.byteOffset + offset).getUint32(0, false);
    const control = data[offset + 5];
    const payload = data.subarray(offset + 6, offset + 4 + pdvLen);
    offset += 4 + pdvLen;

    const isCommand = (control & 0x01) !== 0;

    if (isCommand) {
      // Command sets are ALWAYS Implicit VR LE — parse inline
      let cmdOff = 0;
      const cmdView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      while (cmdOff + 8 <= payload.length) {
        const g = cmdView.getUint16(cmdOff, true);
        const e = cmdView.getUint16(cmdOff + 2, true);
        const l = cmdView.getUint32(cmdOff + 4, true);
        cmdOff += 8;
        if (g === 0x0000 && e === 0x0900 && l === 2) {
          status = cmdView.getUint16(cmdOff, true);
        }
        cmdOff += l;
      }
    } else {
      // Dataset — uses the negotiated transfer syntax
      dataset = parseDICOMDataset(payload, transferSyntax);
    }
  }

  return { status, dataset };
}

interface DICOMFindRequest {
  host: string;
  port?: number;
  callingAE?: string;
  calledAE?: string;
  queryLevel?: string;
  patientId?: string;
  studyDate?: string;
  timeout?: number;
}

/**
 * Handle DICOM C-FIND-RQ for Study Root Query.
 *
 * POST /api/dicom/find
 * Body: { host, port?, callingAE?, calledAE?, queryLevel?, patientId?, studyDate?, timeout? }
 *
 * Returns: { success, studies: [{ patientId, patientName, studyDate, studyInstanceUID, ... }] }
 */
export async function handleDICOMFind(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as DICOMFindRequest;
    const {
      host,
      port = 104,
      callingAE = 'PORTOFCALL',
      calledAE = 'ANY-SCP',
      queryLevel = 'STUDY',
      patientId = '',
      studyDate = '',
      timeout = 20000,
    } = body;

    if (!host) {
      return new Response(JSON.stringify({ success: false, error: 'Host is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (port < 1 || port > 65535) {
      return new Response(JSON.stringify({ success: false, error: 'Port must be between 1 and 65535' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (callingAE && (callingAE.length > 16 || !/^[\x20-\x7E]+$/.test(callingAE))) {
      return new Response(JSON.stringify({ success: false, error: 'Calling AE title must be 1-16 printable ASCII characters' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (calledAE && (calledAE.length > 16 || !/^[\x20-\x7E]+$/.test(calledAE))) {
      return new Response(JSON.stringify({ success: false, error: 'Called AE title must be 1-16 printable ASCII characters' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    const socket = connect(`${host}:${port}`);

    try {
      const startTime = Date.now();
      await Promise.race([socket.opened, timeoutPromise]);

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      // Step 1: A-ASSOCIATE with Study Root Find SOP
      await writer.write(buildAssociateRequestFind(callingAE, calledAE));
      const assocResponse = await readPDU(reader, timeoutPromise);

      if (assocResponse.type === PDU_A_ASSOCIATE_RJ) {
        const rejection = parseAssociateReject(assocResponse.data);
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: `Association rejected: ${rejection.reason} (${rejection.source})`,
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }

      if (assocResponse.type !== PDU_A_ASSOCIATE_AC) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: `Association failed with PDU type: 0x${assocResponse.type.toString(16)}`,
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }

      const assocInfo = parseAssociateAccept(assocResponse.data);
      const findContext = assocInfo.acceptedContexts.find(ctx => ctx.result === 0);
      if (!findContext) {
        reader.releaseLock();
        writer.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: 'Study Root Find SOP Class not accepted by server',
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }

      // Determine the transfer syntax the server selected for datasets
      const selectedTransferSyntax = findContext.transferSyntax || IMPLICIT_VR_LE;

      // Step 2: C-FIND-RQ
      await writer.write(buildCFindRequest(1, queryLevel, patientId, studyDate));

      // Step 3: Read C-FIND-RSP messages until status 0x0000 (Success)
      const studies: Array<Record<string, string>> = [];

      while (true) {
        const pdu = await readPDU(reader, timeoutPromise);
        if (pdu.type === PDU_A_ABORT || pdu.type === PDU_A_ASSOCIATE_RJ) {
          break;
        }
        if (pdu.type !== PDU_P_DATA_TF) continue;

        const rsp = parseCFindResponse(pdu.data, selectedTransferSyntax);

        // Pending responses (0xFF00 or 0xFF01) have datasets
        if (rsp.status === 0xFF00 || rsp.status === 0xFF01) {
          studies.push(rsp.dataset);
          continue;
        }

        // Success (0x0000) means no more results
        if (rsp.status === 0x0000) {
          break;
        }

        // Any other non-pending status is an error
        if (rsp.status !== -1) {
          break;
        }
      }

      // Step 4: Release
      try {
        await writer.write(buildReleaseRequest());
        await readPDU(reader, timeoutPromise);
      } catch { /* ignore */ }

      reader.releaseLock();
      writer.releaseLock();
      socket.close();

      const rtt = Date.now() - startTime;

      return new Response(JSON.stringify({
        success: true,
        host,
        port,
        callingAE,
        calledAE: assocInfo.calledAE,
        queryLevel,
        patientId: patientId || undefined,
        studyDate: studyDate || undefined,
        rtt,
        studyCount: studies.length,
        studies,
        implementationClassUID: assocInfo.implementationClassUID,
        implementationVersion: assocInfo.implementationVersion,
      }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
