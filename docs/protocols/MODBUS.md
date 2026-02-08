# Modbus TCP Protocol Implementation Plan

## Overview

**Protocol:** Modbus TCP
**Port:** 502
**Specification:** [Modbus Application Protocol](http://www.modbus.org/docs/Modbus_Application_Protocol_V1_1b3.pdf)
**Complexity:** Medium
**Purpose:** Industrial automation and SCADA systems

Modbus TCP enables **remote monitoring and control** of industrial equipment - PLCs, sensors, and SCADA systems from the browser.

### Use Cases
- Industrial equipment monitoring
- SCADA system debugging
- PLC register inspection
- Sensor data visualization
- Building automation
- Educational - industrial protocols

## Protocol Specification

### Modbus TCP Frame

```
┌──────────────────────────────────┐
│ MBAP Header (7 bytes)            │
│  - Transaction ID (2 bytes)      │
│  - Protocol ID (2 bytes) = 0     │
│  - Length (2 bytes)               │
│  - Unit ID (1 byte)               │
├──────────────────────────────────┤
│ Function Code (1 byte)           │
├──────────────────────────────────┤
│ Data (n bytes)                   │
└──────────────────────────────────┘
```

### Function Codes

| Code | Name | Description |
|------|------|-------------|
| 0x01 | Read Coils | Read discrete outputs |
| 0x02 | Read Discrete Inputs | Read discrete inputs |
| 0x03 | Read Holding Registers | Read 16-bit registers |
| 0x04 | Read Input Registers | Read 16-bit input registers |
| 0x05 | Write Single Coil | Write single output |
| 0x06 | Write Single Register | Write single register |
| 0x0F | Write Multiple Coils | Write multiple outputs |
| 0x10 | Write Multiple Registers | Write multiple registers |

## Worker Implementation

```typescript
// src/worker/protocols/modbus/client.ts

import { connect } from 'cloudflare:sockets';

export interface ModbusConfig {
  host: string;
  port: number;
  unitId?: number;
}

export class ModbusTCPClient {
  private socket: Socket;
  private transactionId = 0;

  constructor(private config: ModbusConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;
  }

  async readCoils(address: number, quantity: number): Promise<boolean[]> {
    const request = this.buildRequest(0x01, [
      (address >> 8) & 0xff,
      address & 0xff,
      (quantity >> 8) & 0xff,
      quantity & 0xff,
    ]);

    const response = await this.sendRequest(request);
    return this.parseCoilsResponse(response, quantity);
  }

  async readHoldingRegisters(address: number, quantity: number): Promise<number[]> {
    const request = this.buildRequest(0x03, [
      (address >> 8) & 0xff,
      address & 0xff,
      (quantity >> 8) & 0xff,
      quantity & 0xff,
    ]);

    const response = await this.sendRequest(request);
    return this.parseRegistersResponse(response);
  }

  async writeSingleCoil(address: number, value: boolean): Promise<void> {
    const request = this.buildRequest(0x05, [
      (address >> 8) & 0xff,
      address & 0xff,
      value ? 0xff : 0x00,
      0x00,
    ]);

    await this.sendRequest(request);
  }

  async writeSingleRegister(address: number, value: number): Promise<void> {
    const request = this.buildRequest(0x06, [
      (address >> 8) & 0xff,
      address & 0xff,
      (value >> 8) & 0xff,
      value & 0xff,
    ]);

    await this.sendRequest(request);
  }

  private buildRequest(functionCode: number, data: number[]): Uint8Array {
    const transactionId = ++this.transactionId;
    const unitId = this.config.unitId || 1;
    const length = data.length + 2; // Function code + data

    const frame = new Uint8Array(7 + 1 + data.length);

    // MBAP Header
    frame[0] = (transactionId >> 8) & 0xff;
    frame[1] = transactionId & 0xff;
    frame[2] = 0x00; // Protocol ID
    frame[3] = 0x00;
    frame[4] = (length >> 8) & 0xff;
    frame[5] = length & 0xff;
    frame[6] = unitId;

    // Function code
    frame[7] = functionCode;

    // Data
    frame.set(data, 8);

    return frame;
  }

  private async sendRequest(request: Uint8Array): Promise<Uint8Array> {
    const writer = this.socket.writable.getWriter();
    await writer.write(request);
    writer.releaseLock();

    // Read response
    const reader = this.socket.readable.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    // Check for exception
    if (value[7] & 0x80) {
      throw new Error(`Modbus exception: ${value[8]}`);
    }

    return value;
  }

  private parseCoilsResponse(response: Uint8Array, quantity: number): boolean[] {
    const byteCount = response[8];
    const coils: boolean[] = [];

    for (let i = 0; i < quantity; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = i % 8;
      const byte = response[9 + byteIndex];
      coils.push(Boolean((byte >> bitIndex) & 1));
    }

    return coils;
  }

  private parseRegistersResponse(response: Uint8Array): number[] {
    const byteCount = response[8];
    const registers: number[] = [];

    for (let i = 0; i < byteCount; i += 2) {
      const value = (response[9 + i] << 8) | response[10 + i];
      registers.push(value);
    }

    return registers;
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/ModbusDashboard.tsx

export function ModbusDashboard() {
  const [registers, setRegisters] = useState<number[]>([]);
  const [coils, setCoils] = useState<boolean[]>([]);

  const readRegisters = async () => {
    const response = await fetch('/api/modbus/read-holding-registers', {
      method: 'POST',
      body: JSON.stringify({
        host: 'plc.example.com',
        port: 502,
        address: 0,
        quantity: 10,
      }),
    });

    const data = await response.json();
    setRegisters(data.values);
  };

  return (
    <div className="modbus-dashboard">
      <h2>Modbus TCP Monitor</h2>

      <div className="registers-panel">
        <h3>Holding Registers</h3>
        <button onClick={readRegisters}>Read</button>

        <table>
          <thead>
            <tr>
              <th>Address</th>
              <th>Value (Dec)</th>
              <th>Value (Hex)</th>
              <th>Value (Bin)</th>
            </tr>
          </thead>
          <tbody>
            {registers.map((value, i) => (
              <tr key={i}>
                <td>{i}</td>
                <td>{value}</td>
                <td>{value.toString(16).padStart(4, '0')}</td>
                <td>{value.toString(2).padStart(16, '0')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

## Security

### Critical Warning

```typescript
// ⚠️ DANGER: Modbus has NO authentication or encryption
// Writing wrong values to PLCs can cause physical damage
// Only use on isolated networks or read-only mode

// Recommend READ-ONLY mode by default
const READ_ONLY_FUNCTIONS = [0x01, 0x02, 0x03, 0x04];
```

## Testing

```bash
# Modbus simulator
docker run -d -p 502:502 oitc/modbus-server
```

## Resources

- **Modbus.org**: [Official Specification](http://www.modbus.org/)
- **pymodbus**: [Python library](https://github.com/riptideio/pymodbus)

## Notes

- **NO security** - no auth, no encryption
- Used in **industrial environments**
- **Safety critical** - errors can cause physical harm
- Always use **read-only mode** unless authorized
