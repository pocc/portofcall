# HL7 Protocol Implementation Plan

## Overview

**Protocol:** HL7 v2.x (Health Level Seven)
**Port:** Varies (commonly 2575, 2576, or custom)
**Standard:** [HL7 v2.x](https://www.hl7.org/)
**Complexity:** Medium-High
**Purpose:** Healthcare data exchange

HL7 provides **healthcare messaging** - standardized format for exchanging clinical and administrative data between hospital information systems, including patient demographics, orders, results, and billing.

### Use Cases
- ADT (Admission, Discharge, Transfer) messages
- Laboratory results transmission
- Pharmacy orders
- Radiology orders and reports
- Billing and claims
- Electronic Health Records (EHR) integration

## Protocol Specification

### MLLP (Minimal Lower Layer Protocol)

HL7 v2.x uses MLLP over TCP for message framing:

```
<VT>HL7 Message<FS><CR>

Where:
  <VT> = 0x0B (Vertical Tab) - Start of Block
  <FS> = 0x1C (File Separator) - End of Block
  <CR> = 0x0D (Carriage Return) - End of Data
```

### Message Structure

```
MSH|^~\&|SendingApp|SendingFac|ReceivingApp|ReceivingFac|20240115120000||ADT^A01|MSG00001|P|2.5
EVN|A01|20240115120000
PID|1||123456^^^Hospital^MR||Doe^John^A||19800101|M|||123 Main St^^City^ST^12345^USA|||||||1234567890
PV1|1|I|Ward^Room^Bed|E|||Attending^Doctor^MD
```

### Segment Structure

```
Segment ID | Field 1 | Field 2 | Field 3 | ... | Field N

Components (within field): Component1^Component2^Component3
Subcomponents (within component): Sub1&Sub2&Sub3
Repetitions (within field): Rep1~Rep2~Rep3
```

### Delimiters

```
| - Field Separator
^ - Component Separator
~ - Repetition Separator
\ - Escape Character
& - Subcomponent Separator
```

### Message Types

```
ADT - Admission, Discharge, Transfer
ORM - Order Message
ORU - Observation Result (Unsolicited)
SIU - Scheduling Information Unsolicited
DFT - Detailed Financial Transaction
BAR - Billing Account Record
MDM - Medical Document Management
ACK - General Acknowledgement
```

### Common Segments

```
MSH - Message Header
EVN - Event Type
PID - Patient Identification
PV1 - Patient Visit
OBR - Observation Request
OBX - Observation/Result
AL1 - Allergy Information
DG1 - Diagnosis
PR1 - Procedures
```

## Worker Implementation

```typescript
// src/worker/protocols/hl7/client.ts

import { connect } from 'cloudflare:sockets';

export interface HL7Config {
  host: string;
  port?: number;
  sendingApplication: string;
  sendingFacility: string;
  receivingApplication?: string;
  receivingFacility?: string;
}

// MLLP Constants
const START_OF_BLOCK = 0x0B; // <VT>
const END_OF_BLOCK = 0x1C;   // <FS>
const CARRIAGE_RETURN = 0x0D; // <CR>

export interface HL7Segment {
  id: string;
  fields: string[];
}

export interface HL7Message {
  messageType: string;
  triggerEvent: string;
  messageControlId: string;
  segments: HL7Segment[];
}

export class HL7Client {
  private socket: any;
  private messageCounter: number = 1;

  constructor(private config: HL7Config) {
    if (!config.port) config.port = 2575;
  }

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;
  }

  async sendMessage(message: HL7Message): Promise<HL7Message> {
    // Encode message
    const encoded = this.encodeMessage(message);

    // Wrap with MLLP
    const mllp = this.wrapMLLP(encoded);

    // Send
    await this.send(mllp);

    // Receive ACK
    const response = await this.receiveMLLP();
    return this.parseMessage(response);
  }

  async sendADT_A01(patient: {
    patientId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: string;
    address?: string;
  }): Promise<HL7Message> {
    const message: HL7Message = {
      messageType: 'ADT',
      triggerEvent: 'A01',
      messageControlId: `MSG${String(this.messageCounter++).padStart(6, '0')}`,
      segments: [],
    };

    // MSH Segment
    message.segments.push({
      id: 'MSH',
      fields: [
        '|',
        '^~\\&',
        this.config.sendingApplication,
        this.config.sendingFacility,
        this.config.receivingApplication || '',
        this.config.receivingFacility || '',
        this.formatDateTime(new Date()),
        '',
        'ADT^A01',
        message.messageControlId,
        'P',
        '2.5',
      ],
    });

    // EVN Segment
    message.segments.push({
      id: 'EVN',
      fields: ['A01', this.formatDateTime(new Date())],
    });

    // PID Segment
    message.segments.push({
      id: 'PID',
      fields: [
        '1',
        '',
        `${patient.patientId}^^^Hospital^MR`,
        '',
        `${patient.lastName}^${patient.firstName}`,
        '',
        patient.dateOfBirth,
        patient.gender,
        '',
        '',
        patient.address || '',
      ],
    });

    return await this.sendMessage(message);
  }

  async sendORU_R01(results: {
    patientId: string;
    orderNumber: string;
    observations: Array<{
      identifier: string;
      value: string;
      units?: string;
      referenceRange?: string;
    }>;
  }): Promise<HL7Message> {
    const message: HL7Message = {
      messageType: 'ORU',
      triggerEvent: 'R01',
      messageControlId: `MSG${String(this.messageCounter++).padStart(6, '0')}`,
      segments: [],
    };

    // MSH
    message.segments.push({
      id: 'MSH',
      fields: [
        '|',
        '^~\\&',
        this.config.sendingApplication,
        this.config.sendingFacility,
        this.config.receivingApplication || '',
        this.config.receivingFacility || '',
        this.formatDateTime(new Date()),
        '',
        'ORU^R01',
        message.messageControlId,
        'P',
        '2.5',
      ],
    });

    // PID
    message.segments.push({
      id: 'PID',
      fields: ['1', '', `${results.patientId}^^^Hospital^MR`],
    });

    // OBR
    message.segments.push({
      id: 'OBR',
      fields: ['1', results.orderNumber, '', '', '', this.formatDateTime(new Date())],
    });

    // OBX segments (one per observation)
    results.observations.forEach((obs, index) => {
      message.segments.push({
        id: 'OBX',
        fields: [
          String(index + 1),
          'NM', // Numeric
          obs.identifier,
          '',
          obs.value,
          obs.units || '',
          obs.referenceRange || '',
          '',
          '',
          'F', // Final
        ],
      });
    });

    return await this.sendMessage(message);
  }

  private encodeMessage(message: HL7Message): string {
    const lines: string[] = [];

    for (const segment of message.segments) {
      const line = [segment.id, ...segment.fields].join('|');
      lines.push(line);
    }

    return lines.join('\r');
  }

  parseMessage(text: string): HL7Message {
    const lines = text.split('\r').filter(line => line.length > 0);
    const segments: HL7Segment[] = [];

    for (const line of lines) {
      const parts = line.split('|');
      const id = parts[0];
      const fields = parts.slice(1);

      segments.push({ id, fields });
    }

    // Extract message type from MSH
    const msh = segments.find(s => s.id === 'MSH');
    if (!msh) {
      throw new Error('Invalid HL7 message: Missing MSH segment');
    }

    const messageTypeField = msh.fields[7]; // MSH-9
    const [messageType, triggerEvent] = messageTypeField.split('^');

    const messageControlId = msh.fields[8]; // MSH-10

    return {
      messageType,
      triggerEvent,
      messageControlId,
      segments,
    };
  }

  getField(message: HL7Message, segmentId: string, fieldIndex: number): string | undefined {
    const segment = message.segments.find(s => s.id === segmentId);
    return segment?.fields[fieldIndex];
  }

  getComponent(field: string, componentIndex: number): string {
    const components = field.split('^');
    return components[componentIndex] || '';
  }

  private wrapMLLP(message: string): Uint8Array {
    const messageBytes = new TextEncoder().encode(message);
    const buffer = new Uint8Array(messageBytes.length + 3);

    buffer[0] = START_OF_BLOCK;
    buffer.set(messageBytes, 1);
    buffer[messageBytes.length + 1] = END_OF_BLOCK;
    buffer[messageBytes.length + 2] = CARRIAGE_RETURN;

    return buffer;
  }

  private async receiveMLLP(): Promise<string> {
    const reader = this.socket.readable.getReader();
    const chunks: Uint8Array[] = [];
    let inMessage = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      for (let i = 0; i < value.length; i++) {
        if (value[i] === START_OF_BLOCK) {
          inMessage = true;
        } else if (value[i] === END_OF_BLOCK) {
          inMessage = false;
          reader.releaseLock();

          // Combine chunks
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const combined = new Uint8Array(totalLength);
          let offset = 0;

          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }

          return new TextDecoder().decode(combined);
        } else if (inMessage && value[i] !== CARRIAGE_RETURN) {
          chunks.push(new Uint8Array([value[i]]));
        }
      }
    }

    reader.releaseLock();
    throw new Error('Incomplete MLLP message');
  }

  private formatDateTime(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  private async send(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}

// HL7 ACK Generator

export function generateACK(originalMessage: HL7Message, status: 'AA' | 'AE' | 'AR'): HL7Message {
  // AA = Application Accept
  // AE = Application Error
  // AR = Application Reject

  return {
    messageType: 'ACK',
    triggerEvent: originalMessage.triggerEvent,
    messageControlId: `ACK${originalMessage.messageControlId}`,
    segments: [
      {
        id: 'MSH',
        fields: [
          '|',
          '^~\\&',
          originalMessage.segments[0].fields[3], // Swap sending/receiving
          originalMessage.segments[0].fields[4],
          originalMessage.segments[0].fields[1],
          originalMessage.segments[0].fields[2],
          new Date().toISOString(),
          '',
          'ACK',
          `ACK${originalMessage.messageControlId}`,
          'P',
          '2.5',
        ],
      },
      {
        id: 'MSA',
        fields: [status, originalMessage.messageControlId],
      },
    ],
  };
}
```

## Web UI Design

```typescript
// src/components/HL7Client.tsx

export function HL7Client() {
  const [host, setHost] = useState('');
  const [sendingApp, setSendingApp] = useState('PortOfCall');
  const [sendingFac, setSendingFac] = useState('Facility');
  const [messages, setMessages] = useState<any[]>([]);

  const sendADT = async () => {
    const patient = {
      patientId: '123456',
      firstName: 'John',
      lastName: 'Doe',
      dateOfBirth: '19800101',
      gender: 'M',
      address: '123 Main St^^City^ST^12345^USA',
    };

    const response = await fetch('/api/hl7/send-adt', {
      method: 'POST',
      body: JSON.stringify({
        host,
        sendingApp,
        sendingFac,
        patient,
      }),
    });

    const data = await response.json();
    setMessages([...messages, data]);
  };

  const sendORU = async () => {
    const results = {
      patientId: '123456',
      orderNumber: 'ORD001',
      observations: [
        { identifier: 'GLU', value: '95', units: 'mg/dL', referenceRange: '70-100' },
        { identifier: 'NA', value: '140', units: 'mmol/L', referenceRange: '135-145' },
      ],
    };

    const response = await fetch('/api/hl7/send-oru', {
      method: 'POST',
      body: JSON.stringify({
        host,
        sendingApp,
        sendingFac,
        results,
      }),
    });

    const data = await response.json();
    setMessages([...messages, data]);
  };

  return (
    <div className="hl7-client">
      <h2>HL7 v2.x Client</h2>

      <div className="config">
        <input placeholder="HL7 Server" value={host} onChange={(e) => setHost(e.target.value)} />
        <input placeholder="Sending Application" value={sendingApp} onChange={(e) => setSendingApp(e.target.value)} />
        <input placeholder="Sending Facility" value={sendingFac} onChange={(e) => setSendingFac(e.target.value)} />
      </div>

      <div className="actions">
        <button onClick={sendADT}>Send ADT^A01 (Patient Admission)</button>
        <button onClick={sendORU}>Send ORU^R01 (Lab Results)</button>
      </div>

      <div className="messages">
        <h3>Messages</h3>
        {messages.map((msg, i) => (
          <div key={i} className="message">
            <strong>{msg.messageType}^{msg.triggerEvent}</strong>
            <pre>{JSON.stringify(msg, null, 2)}</pre>
          </div>
        ))}
      </div>

      <div className="info">
        <h3>About HL7 v2.x</h3>
        <ul>
          <li>Health Level Seven</li>
          <li>Healthcare data exchange standard</li>
          <li>Pipe-delimited messages</li>
          <li>MLLP transport (TCP)</li>
          <li>ADT, ORM, ORU, SIU, etc.</li>
          <li>Used in hospitals worldwide</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### Network Security

```typescript
// HL7 v2.x traditionally has no encryption
// Use VPN or SSH tunnel for secure transmission
```

### HIPAA Compliance

```bash
# Ensure encrypted transmission for PHI
# Audit logging
# Access controls
```

## Testing

```bash
# Test with hl7simulator or hapi
npm install -g hl7-simulator

# Start HL7 server
hl7-simulator --port 2575

# Send test message
echo -e "\x0BMSH|^~\\&|App|Fac|App2|Fac2|20240115120000||ADT^A01|1|P|2.5\rEVN|A01|20240115120000\rPID|1||123||Doe^John\x1C\x0D" | nc localhost 2575
```

## Resources

- **HL7 Standard**: [hl7.org](https://www.hl7.org/)
- **HAPI**: [Java HL7 library](https://hapifhir.github.io/hapi-hl7v2/)
- **hl7apy**: [Python HL7 library](https://github.com/crs4/hl7apy)

## Common Message Types

| Type | Description |
|------|-------------|
| ADT^A01 | Patient Admission |
| ADT^A03 | Patient Discharge |
| ADT^A08 | Update Patient Info |
| ORM^O01 | General Order |
| ORU^R01 | Unsolicited Lab Result |
| SIU^S12 | Appointment Notification |
| DFT^P03 | Post Detail Financial Trans |

## Notes

- **Pipe-delimited** - Easy to parse text format
- **MLLP transport** - Message framing over TCP
- **Segment-based** - MSH, PID, OBR, OBX, etc.
- **Versions** - 2.1 through 2.9 (2.5 most common)
- **HL7 v3** - XML-based (different from v2.x)
- **FHIR** - Modern successor (RESTful JSON/XML)
- **Widely used** - Hospital systems, EHRs, labs
- **No encryption** - Requires secure network
- **HIPAA** - Protected Health Information (PHI)
- **Interoperability** - Different systems communicate
