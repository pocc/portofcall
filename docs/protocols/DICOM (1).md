# DICOM Protocol Implementation Plan

## Overview

**Protocol:** DICOM (Digital Imaging and Communications in Medicine)
**Port:** 104 (TCP)
**Standard:** [NEMA PS3 / ISO 12052](https://www.dicomstandard.org/)
**Complexity:** Very High
**Purpose:** Medical imaging communication

DICOM provides **medical image exchange** - standardized protocol for storing, transmitting, and displaying medical images (CT, MRI, X-ray, ultrasound) with patient metadata.

### Use Cases
- Hospital PACS (Picture Archiving and Communication System)
- Medical imaging workstations
- CT/MRI/X-ray scanner integration
- Radiology information systems (RIS)
- Telemedicine and remote diagnostics
- Medical image archiving

## Protocol Specification

### DICOM Upper Layer Protocol

DICOM uses a custom application layer protocol over TCP:

```
1. A-ASSOCIATE-RQ (Association Request)
2. A-ASSOCIATE-AC (Association Accept)
3. P-DATA-TF (Presentation Data Transfer)
4. A-RELEASE-RQ (Release Request)
5. A-RELEASE-RP (Release Response)
6. A-ABORT (Abort)
```

### A-ASSOCIATE Request

```
Protocol Data Unit (PDU):
  PDU-type: 01 (A-ASSOCIATE-RQ)
  Reserved: 00
  PDU-length: 4 bytes
  Protocol-version: 0001
  Reserved: 0000
  Called-AE-title: 16 bytes (Application Entity)
  Calling-AE-title: 16 bytes
  Reserved: 32 bytes
  Variable items:
    - Application Context
    - Presentation Contexts
    - User Information
```

### P-DATA-TF (Data Transfer)

```
PDU-type: 04
Reserved: 00
PDU-length: 4 bytes
Presentation-data-value items:
  Presentation-context-ID: 1 byte
  Message Control Header: 1 byte
  DICOM Command or Data Set
```

### DICOM Message Structure

```
DICOM Message:
  Command Set (Group 0000)
    - Command Field (0000,0100)
    - Affected SOP Class UID (0000,0002)
    - Message ID (0000,0110)
    - Priority (0000,0700)
    - Command Data Set Type (0000,0800)

  Data Set (if present)
    - Patient Name (0010,0010)
    - Patient ID (0010,0020)
    - Study Date (0008,0020)
    - Modality (0008,0060)
    - Image data...
```

### DIMSE Services

```
C-STORE - Store image
C-FIND - Query for studies/series/images
C-MOVE - Retrieve images
C-GET - Get images
C-ECHO - Verify connectivity
N-EVENT-REPORT - Event notification
```

## Worker Implementation

```typescript
// src/worker/protocols/dicom/client.ts

import { connect } from 'cloudflare:sockets';

export interface DICOMConfig {
  host: string;
  port?: number;
  callingAE: string; // Application Entity Title (max 16 chars)
  calledAE: string;
}

// PDU Types
export enum PDUType {
  A_ASSOCIATE_RQ = 0x01,
  A_ASSOCIATE_AC = 0x02,
  A_ASSOCIATE_RJ = 0x03,
  P_DATA_TF = 0x04,
  A_RELEASE_RQ = 0x05,
  A_RELEASE_RP = 0x06,
  A_ABORT = 0x07,
}

// DIMSE Command Field
export enum DIMSECommand {
  C_STORE_RQ = 0x0001,
  C_STORE_RSP = 0x8001,
  C_FIND_RQ = 0x0020,
  C_FIND_RSP = 0x8020,
  C_GET_RQ = 0x0010,
  C_GET_RSP = 0x8010,
  C_MOVE_RQ = 0x0021,
  C_MOVE_RSP = 0x8021,
  C_ECHO_RQ = 0x0030,
  C_ECHO_RSP = 0x8030,
}

// Transfer Syntax UIDs
export const TransferSyntax = {
  ImplicitVRLittleEndian: '1.2.840.10008.1.2',
  ExplicitVRLittleEndian: '1.2.840.10008.1.2.1',
  ExplicitVRBigEndian: '1.2.840.10008.1.2.2',
  JPEGBaseline: '1.2.840.10008.1.2.4.50',
  JPEG2000: '1.2.840.10008.1.2.4.90',
};

// SOP Class UIDs
export const SOPClass = {
  Verification: '1.2.840.10008.1.1',
  CTImageStorage: '1.2.840.10008.5.1.4.1.1.2',
  MRImageStorage: '1.2.840.10008.5.1.4.1.1.4',
  StudyRootQueryRetrieve: '1.2.840.10008.5.1.4.1.2.2.1',
};

export interface DICOMDataElement {
  tag: number;      // (gggg,eeee) as single number
  vr: string;       // Value Representation
  value: any;
}

export class DICOMClient {
  private socket: any;
  private associated: boolean = false;
  private messageId: number = 1;

  constructor(private config: DICOMConfig) {
    if (!config.port) config.port = 104;
  }

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Send A-ASSOCIATE-RQ
    await this.sendAssociateRequest();

    // Receive A-ASSOCIATE-AC
    const response = await this.receivePDU();

    if (response.type === PDUType.A_ASSOCIATE_AC) {
      this.associated = true;
      console.log('DICOM Association established');
    } else if (response.type === PDUType.A_ASSOCIATE_RJ) {
      throw new Error('Association rejected');
    }
  }

  async echo(): Promise<boolean> {
    if (!this.associated) {
      throw new Error('Not associated');
    }

    // Send C-ECHO-RQ
    const command = this.buildCommandSet(DIMSECommand.C_ECHO_RQ, {
      affectedSOPClassUID: SOPClass.Verification,
      messageID: this.messageId++,
    });

    await this.sendPData(command);

    // Receive C-ECHO-RSP
    const response = await this.receivePData();

    return response.status === 0x0000; // Success
  }

  async find(queryLevel: 'STUDY' | 'SERIES' | 'IMAGE', criteria: any): Promise<any[]> {
    const results: any[] = [];

    // Build C-FIND-RQ command
    const command = this.buildCommandSet(DIMSECommand.C_FIND_RQ, {
      affectedSOPClassUID: SOPClass.StudyRootQueryRetrieve,
      messageID: this.messageId++,
      priority: 0, // MEDIUM
    });

    // Build query dataset
    const dataset = this.buildQueryDataset(queryLevel, criteria);

    await this.sendPData(command, dataset);

    // Receive C-FIND-RSP (multiple)
    while (true) {
      const response = await this.receivePData();

      if (response.dataset) {
        results.push(this.parseDataset(response.dataset));
      }

      // Status: 0xFF00 = Pending, 0x0000 = Success
      if (response.status === 0x0000) {
        break;
      }
    }

    return results;
  }

  async store(sopClassUID: string, sopInstanceUID: string, dataset: Uint8Array): Promise<boolean> {
    // Send C-STORE-RQ
    const command = this.buildCommandSet(DIMSECommand.C_STORE_RQ, {
      affectedSOPClassUID: sopClassUID,
      affectedSOPInstanceUID: sopInstanceUID,
      messageID: this.messageId++,
      priority: 0,
    });

    await this.sendPData(command, dataset);

    // Receive C-STORE-RSP
    const response = await this.receivePData();

    return response.status === 0x0000;
  }

  private async sendAssociateRequest(): Promise<void> {
    const buffer = new ArrayBuffer(1000); // Simplified
    const view = new DataView(buffer);
    let offset = 0;

    // PDU Type
    view.setUint8(offset++, PDUType.A_ASSOCIATE_RQ);

    // Reserved
    view.setUint8(offset++, 0x00);

    // PDU Length (will update later)
    const lengthOffset = offset;
    offset += 4;

    // Protocol Version
    view.setUint16(offset, 0x0001, false);
    offset += 2;

    // Reserved
    view.setUint16(offset, 0x0000, false);
    offset += 2;

    // Called AE Title (16 bytes, space-padded)
    const calledAE = this.padAETitle(this.config.calledAE);
    new Uint8Array(buffer).set(calledAE, offset);
    offset += 16;

    // Calling AE Title (16 bytes, space-padded)
    const callingAE = this.padAETitle(this.config.callingAE);
    new Uint8Array(buffer).set(callingAE, offset);
    offset += 16;

    // Reserved (32 bytes)
    offset += 32;

    // Application Context Item
    offset = this.writeApplicationContext(buffer, offset);

    // Presentation Context Items
    offset = this.writePresentationContexts(buffer, offset);

    // User Information Item
    offset = this.writeUserInformation(buffer, offset);

    // Update PDU Length
    view.setUint32(lengthOffset, offset - 6, false);

    await this.send(new Uint8Array(buffer.slice(0, offset)));
  }

  private padAETitle(ae: string): Uint8Array {
    const padded = new Uint8Array(16);
    padded.fill(0x20); // Space
    const bytes = new TextEncoder().encode(ae.substring(0, 16));
    padded.set(bytes, 0);
    return padded;
  }

  private writeApplicationContext(buffer: ArrayBuffer, offset: number): number {
    const view = new DataView(buffer);

    // Item Type: Application Context
    view.setUint8(offset++, 0x10);

    // Reserved
    view.setUint8(offset++, 0x00);

    // Item Length
    const uid = '1.2.840.10008.3.1.1.1'; // DICOM Application Context
    view.setUint16(offset, uid.length, false);
    offset += 2;

    // Application Context Name
    const uidBytes = new TextEncoder().encode(uid);
    new Uint8Array(buffer).set(uidBytes, offset);
    offset += uidBytes.length;

    return offset;
  }

  private writePresentationContexts(buffer: ArrayBuffer, offset: number): number {
    const view = new DataView(buffer);

    // Presentation Context: Verification SOP Class
    view.setUint8(offset++, 0x20); // Item Type
    view.setUint8(offset++, 0x00); // Reserved

    const pcStart = offset;
    offset += 2; // Length placeholder

    // Presentation Context ID
    view.setUint8(offset++, 0x01);

    // Reserved
    view.setUint8(offset++, 0x00);
    view.setUint8(offset++, 0x00);
    view.setUint8(offset++, 0x00);

    // Abstract Syntax Sub-Item
    offset = this.writeAbstractSyntax(buffer, offset, SOPClass.Verification);

    // Transfer Syntax Sub-Items
    offset = this.writeTransferSyntax(buffer, offset, TransferSyntax.ImplicitVRLittleEndian);

    // Update PC length
    view.setUint16(pcStart, offset - pcStart - 2, false);

    return offset;
  }

  private writeAbstractSyntax(buffer: ArrayBuffer, offset: number, uid: string): number {
    const view = new DataView(buffer);

    view.setUint8(offset++, 0x30); // Abstract Syntax
    view.setUint8(offset++, 0x00); // Reserved

    view.setUint16(offset, uid.length, false);
    offset += 2;

    const uidBytes = new TextEncoder().encode(uid);
    new Uint8Array(buffer).set(uidBytes, offset);
    offset += uidBytes.length;

    return offset;
  }

  private writeTransferSyntax(buffer: ArrayBuffer, offset: number, uid: string): number {
    const view = new DataView(buffer);

    view.setUint8(offset++, 0x40); // Transfer Syntax
    view.setUint8(offset++, 0x00); // Reserved

    view.setUint16(offset, uid.length, false);
    offset += 2;

    const uidBytes = new TextEncoder().encode(uid);
    new Uint8Array(buffer).set(uidBytes, offset);
    offset += uidBytes.length;

    return offset;
  }

  private writeUserInformation(buffer: ArrayBuffer, offset: number): number {
    const view = new DataView(buffer);

    view.setUint8(offset++, 0x50); // User Information
    view.setUint8(offset++, 0x00); // Reserved

    const uiStart = offset;
    offset += 2; // Length placeholder

    // Maximum Length Sub-Item
    view.setUint8(offset++, 0x51);
    view.setUint8(offset++, 0x00);
    view.setUint16(offset, 4, false);
    offset += 2;
    view.setUint32(offset, 16384, false); // Max PDU size
    offset += 4;

    // Implementation Class UID
    const implUID = '1.2.840.10008.3.1.2.1.1';
    view.setUint8(offset++, 0x52);
    view.setUint8(offset++, 0x00);
    view.setUint16(offset, implUID.length, false);
    offset += 2;
    new Uint8Array(buffer).set(new TextEncoder().encode(implUID), offset);
    offset += implUID.length;

    // Update UI length
    view.setUint16(uiStart, offset - uiStart - 2, false);

    return offset;
  }

  private buildCommandSet(command: DIMSECommand, params: any): Uint8Array {
    // Build DICOM Command Set (Group 0000)
    const elements: DICOMDataElement[] = [
      { tag: 0x00000002, vr: 'UI', value: params.affectedSOPClassUID },
      { tag: 0x00000100, vr: 'US', value: command },
      { tag: 0x00000110, vr: 'US', value: params.messageID },
      { tag: 0x00000700, vr: 'US', value: params.priority || 0 },
      { tag: 0x00000800, vr: 'US', value: 0x0101 }, // No dataset
    ];

    return this.encodeDataset(elements);
  }

  private buildQueryDataset(level: string, criteria: any): Uint8Array {
    const elements: DICOMDataElement[] = [
      { tag: 0x00080052, vr: 'CS', value: level }, // Query/Retrieve Level
    ];

    // Add query criteria
    if (criteria.patientName) {
      elements.push({ tag: 0x00100010, vr: 'PN', value: criteria.patientName });
    }
    if (criteria.patientID) {
      elements.push({ tag: 0x00100020, vr: 'LO', value: criteria.patientID });
    }
    if (criteria.studyDate) {
      elements.push({ tag: 0x00080020, vr: 'DA', value: criteria.studyDate });
    }

    return this.encodeDataset(elements);
  }

  private encodeDataset(elements: DICOMDataElement[]): Uint8Array {
    // Simplified DICOM encoding (Implicit VR Little Endian)
    const chunks: Uint8Array[] = [];

    for (const element of elements) {
      const buffer = new ArrayBuffer(8 + 100); // Simplified
      const view = new DataView(buffer);
      let offset = 0;

      // Tag
      view.setUint16(offset, element.tag >> 16, true); // Group
      offset += 2;
      view.setUint16(offset, element.tag & 0xFFFF, true); // Element
      offset += 2;

      // Value
      const valueBytes = this.encodeValue(element.value, element.vr);

      // Length
      view.setUint32(offset, valueBytes.length, true);
      offset += 4;

      // Combine tag + length + value
      const chunk = new Uint8Array(offset + valueBytes.length);
      chunk.set(new Uint8Array(buffer.slice(0, offset)), 0);
      chunk.set(valueBytes, offset);

      chunks.push(chunk);
    }

    // Combine all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  private encodeValue(value: any, vr: string): Uint8Array {
    // Simplified value encoding
    if (vr === 'US') {
      // Unsigned Short
      const buffer = new ArrayBuffer(2);
      new DataView(buffer).setUint16(0, value, true);
      return new Uint8Array(buffer);
    } else {
      // String types
      return new TextEncoder().encode(String(value));
    }
  }

  private parseDataset(data: Uint8Array): any {
    // Simplified dataset parsing
    const result: any = {};

    // Parse DICOM elements
    // ... complex parsing logic ...

    return result;
  }

  private async sendPData(command: Uint8Array, dataset?: Uint8Array): Promise<void> {
    const totalLength = command.length + (dataset ? dataset.length : 0);

    const buffer = new ArrayBuffer(6 + totalLength + 100); // Simplified
    const view = new DataView(buffer);
    let offset = 0;

    // PDU Type: P-DATA-TF
    view.setUint8(offset++, PDUType.P_DATA_TF);

    // Reserved
    view.setUint8(offset++, 0x00);

    // PDU Length
    view.setUint32(offset, totalLength + 6, false);
    offset += 4;

    // Presentation-data-value Item Length
    view.setUint32(offset, totalLength + 2, false);
    offset += 4;

    // Presentation Context ID
    view.setUint8(offset++, 0x01);

    // Message Control Header (Command, last fragment)
    view.setUint8(offset++, 0x03);

    // Command
    new Uint8Array(buffer).set(command, offset);
    offset += command.length;

    // Dataset (if present)
    if (dataset) {
      new Uint8Array(buffer).set(dataset, offset);
      offset += dataset.length;
    }

    await this.send(new Uint8Array(buffer.slice(0, offset)));
  }

  private async receivePData(): Promise<{ status: number; dataset?: Uint8Array }> {
    const pdu = await this.receivePDU();

    // Parse P-DATA-TF
    // ... complex parsing ...

    return { status: 0x0000 }; // Simplified
  }

  private async receivePDU(): Promise<{ type: PDUType; data: Uint8Array }> {
    const reader = this.socket.readable.getReader();

    // Read PDU header (6 bytes)
    const headerBuf = new Uint8Array(6);
    let offset = 0;

    while (offset < 6) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = 6 - offset;
      const toCopy = Math.min(remaining, value.length);
      headerBuf.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    const view = new DataView(headerBuf.buffer);
    const type = view.getUint8(0) as PDUType;
    const length = view.getUint32(2, false);

    // Read PDU data
    const dataBuf = new Uint8Array(length);
    offset = 0;

    while (offset < length) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = length - offset;
      const toCopy = Math.min(remaining, value.length);
      dataBuf.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    reader.releaseLock();

    return { type, data: dataBuf };
  }

  private async send(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  async release(): Promise<void> {
    // Send A-RELEASE-RQ
    const buffer = new ArrayBuffer(6);
    const view = new DataView(buffer);

    view.setUint8(0, PDUType.A_RELEASE_RQ);
    view.setUint8(1, 0x00);
    view.setUint32(2, 4, false);

    await this.send(new Uint8Array(buffer));

    // Receive A-RELEASE-RP
    await this.receivePDU();

    this.associated = false;
  }

  async close(): Promise<void> {
    if (this.associated) {
      await this.release();
    }

    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/DICOMClient.tsx

export function DICOMClient() {
  const [host, setHost] = useState('');
  const [callingAE, setCallingAE] = useState('PORTOFCALL');
  const [calledAE, setCalledAE] = useState('PACS');
  const [connected, setConnected] = useState(false);
  const [studies, setStudies] = useState<any[]>([]);

  const connect = async () => {
    const response = await fetch('/api/dicom/connect', {
      method: 'POST',
      body: JSON.stringify({ host, callingAE, calledAE }),
    });

    if (response.ok) {
      setConnected(true);
    }
  };

  const findStudies = async (patientName: string) => {
    const response = await fetch('/api/dicom/find', {
      method: 'POST',
      body: JSON.stringify({
        level: 'STUDY',
        criteria: { patientName },
      }),
    });

    const data = await response.json();
    setStudies(data.results);
  };

  return (
    <div className="dicom-client">
      <h2>DICOM Client (Medical Imaging)</h2>

      <div className="config">
        <input placeholder="PACS Server" value={host} onChange={(e) => setHost(e.target.value)} />
        <input placeholder="Calling AE" value={callingAE} onChange={(e) => setCallingAE(e.target.value)} />
        <input placeholder="Called AE" value={calledAE} onChange={(e) => setCalledAE(e.target.value)} />
        <button onClick={connect}>Connect</button>
      </div>

      {connected && (
        <div className="studies">
          <h3>Find Studies</h3>
          <button onClick={() => findStudies('*')}>Query All</button>

          <div className="results">
            {studies.map((study, i) => (
              <div key={i} className="study">
                <strong>{study.patientName}</strong>
                <div>{study.studyDate}</div>
                <div>{study.modality}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="info">
        <h3>About DICOM</h3>
        <ul>
          <li>Digital Imaging and Communications in Medicine</li>
          <li>Medical imaging standard</li>
          <li>TCP port 104</li>
          <li>Used in hospitals worldwide</li>
          <li>CT, MRI, X-ray, Ultrasound</li>
          <li>PACS integration</li>
        </ul>
      </div>
    </div>
  );
}
```

## Resources

- **DICOM Standard**: [dicomstandard.org](https://www.dicomstandard.org/)
- **dcm4che**: [Java DICOM toolkit](https://www.dcm4che.org/)
- **pydicom**: [Python DICOM library](https://pydicom.github.io/)

## Notes

- **Very complex** - medical imaging standard
- **TCP port 104** - standard DICOM port
- **Application Entities** - Logical endpoints (AE titles)
- **SOP Classes** - Service-Object Pair classes
- **Transfer Syntaxes** - Encoding formats (JPEG, JPEG2000, etc.)
- **DIMSE** - DICOM Message Service Element
- **PACS** - Picture Archiving and Communication System
- **Modalities** - CT, MRI, CR, DX, US, etc.
- **HIPAA compliant** - Protected Health Information (PHI)
- **Widely used** - Global healthcare standard
