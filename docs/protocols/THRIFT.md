# Apache Thrift Protocol Implementation Plan

## Overview

**Protocol:** Apache Thrift RPC
**Port:** Varies (typically 9090 or custom)
**Specification:** [Apache Thrift](https://thrift.apache.org/)
**Complexity:** High
**Purpose:** Cross-language RPC framework

Thrift provides **efficient RPC** - Interface Definition Language (IDL) for defining services, multiple serialization formats (Binary, Compact, JSON), and cross-language support.

### Use Cases
- Microservices communication
- Cross-language RPC
- High-performance APIs
- Data serialization
- Service-oriented architecture
- Big data systems (Cassandra, HBase use Thrift)

## Protocol Specification

### Thrift IDL Example

```thrift
namespace java com.example
namespace py example

struct User {
  1: required i32 id,
  2: required string name,
  3: optional string email
}

exception UserNotFoundException {
  1: string message
}

service UserService {
  User getUser(1: i32 userId) throws (1: UserNotFoundException notFound),
  void createUser(1: User user),
  list<User> listUsers()
}
```

### Transport Layers

```
TSocket - TCP socket
TServerSocket - Server TCP socket
TFramedTransport - Framed message transport
TBufferedTransport - Buffered transport
THttpTransport - HTTP transport
```

### Protocol Layers

```
TBinaryProtocol - Binary encoding (efficient)
TCompactProtocol - Compact binary (smaller)
TJSONProtocol - JSON encoding (human-readable)
```

### Binary Protocol Format

```
Message:
  Protocol ID: 0x80010000 (version 1, strict)
  Message type: 1 byte (Call=1, Reply=2, Exception=3, Oneway=4)
  Method name length: 4 bytes
  Method name: string
  Sequence ID: 4 bytes
  Arguments/Result: struct

Struct:
  Field:
    Field type: 1 byte
    Field ID: 2 bytes (i16)
    Field value: varies by type
  Stop field: 0x00
```

### Type Codes

```
T_STOP   = 0
T_VOID   = 1
T_BOOL   = 2
T_BYTE   = 3
T_I08    = 3
T_DOUBLE = 4
T_I16    = 6
T_I32    = 8
T_I64    = 10
T_STRING = 11
T_UTF7   = 11
T_STRUCT = 12
T_MAP    = 13
T_SET    = 14
T_LIST   = 15
```

## Worker Implementation

```typescript
// src/worker/protocols/thrift/client.ts

import { connect } from 'cloudflare:sockets';

export interface ThriftConfig {
  host: string;
  port?: number;
  protocol?: 'binary' | 'compact' | 'json';
  transport?: 'framed' | 'buffered';
}

// Message Types
export enum MessageType {
  Call = 1,
  Reply = 2,
  Exception = 3,
  Oneway = 4,
}

// Thrift Types
export enum TType {
  STOP = 0,
  VOID = 1,
  BOOL = 2,
  BYTE = 3,
  DOUBLE = 4,
  I16 = 6,
  I32 = 8,
  I64 = 10,
  STRING = 11,
  STRUCT = 12,
  MAP = 13,
  SET = 14,
  LIST = 15,
}

export interface ThriftField {
  type: TType;
  id: number;
  value: any;
}

export interface ThriftStruct {
  fields: Map<number, ThriftField>;
}

export class ThriftClient {
  private socket: any;
  private seqId: number = 0;
  private useFramed: boolean;

  constructor(private config: ThriftConfig) {
    if (!config.port) config.port = 9090;
    if (!config.protocol) config.protocol = 'binary';
    if (!config.transport) config.transport = 'framed';
    this.useFramed = config.transport === 'framed';
  }

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;
  }

  async call(method: string, args: ThriftStruct): Promise<ThriftStruct> {
    const seqId = this.seqId++;

    // Encode message
    const message = this.encodeMessage(MessageType.Call, method, seqId, args);

    // Send with framing if needed
    if (this.useFramed) {
      const framed = this.frameMessage(message);
      await this.send(framed);
    } else {
      await this.send(message);
    }

    // Receive response
    const response = this.useFramed
      ? await this.receiveFramed()
      : await this.receive();

    // Decode response
    return this.decodeMessage(response);
  }

  private encodeMessage(
    type: MessageType,
    method: string,
    seqId: number,
    args: ThriftStruct
  ): Uint8Array {
    const chunks: Uint8Array[] = [];

    // Protocol version + type
    const version = 0x80010000 | type;
    chunks.push(this.writeI32(version));

    // Method name
    chunks.push(this.writeString(method));

    // Sequence ID
    chunks.push(this.writeI32(seqId));

    // Arguments (struct)
    chunks.push(this.writeStruct(args));

    // Combine chunks
    return this.combineChunks(chunks);
  }

  private decodeMessage(data: Uint8Array): ThriftStruct {
    let offset = 0;

    // Protocol version + type
    const versionAndType = this.readI32(data, offset);
    offset += 4;

    const version = versionAndType & 0xFFFF0000;
    const type = versionAndType & 0x000000FF;

    if (version !== 0x80010000) {
      throw new Error('Invalid protocol version');
    }

    // Method name
    const { value: method, offset: newOffset } = this.readString(data, offset);
    offset = newOffset;

    // Sequence ID
    const seqId = this.readI32(data, offset);
    offset += 4;

    // Result struct
    return this.readStruct(data, offset);
  }

  private writeStruct(struct: ThriftStruct): Uint8Array {
    const chunks: Uint8Array[] = [];

    for (const [fieldId, field] of struct.fields) {
      // Field type
      chunks.push(new Uint8Array([field.type]));

      // Field ID
      chunks.push(this.writeI16(fieldId));

      // Field value
      chunks.push(this.writeValue(field.type, field.value));
    }

    // Stop field
    chunks.push(new Uint8Array([TType.STOP]));

    return this.combineChunks(chunks);
  }

  private readStruct(data: Uint8Array, offset: number): ThriftStruct {
    const fields = new Map<number, ThriftField>();

    while (offset < data.length) {
      const fieldType = data[offset++] as TType;

      if (fieldType === TType.STOP) {
        break;
      }

      const fieldId = this.readI16(data, offset);
      offset += 2;

      const { value, offset: newOffset } = this.readValue(data, offset, fieldType);
      offset = newOffset;

      fields.set(fieldId, { type: fieldType, id: fieldId, value });
    }

    return { fields };
  }

  private writeValue(type: TType, value: any): Uint8Array {
    switch (type) {
      case TType.BOOL:
        return new Uint8Array([value ? 1 : 0]);

      case TType.BYTE:
        return new Uint8Array([value]);

      case TType.I16:
        return this.writeI16(value);

      case TType.I32:
        return this.writeI32(value);

      case TType.I64:
        return this.writeI64(value);

      case TType.DOUBLE:
        return this.writeDouble(value);

      case TType.STRING:
        return this.writeString(value);

      case TType.STRUCT:
        return this.writeStruct(value);

      case TType.LIST:
        return this.writeList(value);

      case TType.MAP:
        return this.writeMap(value);

      case TType.SET:
        return this.writeSet(value);

      default:
        throw new Error(`Unsupported type: ${type}`);
    }
  }

  private readValue(data: Uint8Array, offset: number, type: TType): { value: any; offset: number } {
    switch (type) {
      case TType.BOOL:
        return { value: data[offset] !== 0, offset: offset + 1 };

      case TType.BYTE:
        return { value: data[offset], offset: offset + 1 };

      case TType.I16: {
        const value = this.readI16(data, offset);
        return { value, offset: offset + 2 };
      }

      case TType.I32: {
        const value = this.readI32(data, offset);
        return { value, offset: offset + 4 };
      }

      case TType.I64: {
        const value = this.readI64(data, offset);
        return { value, offset: offset + 8 };
      }

      case TType.DOUBLE: {
        const value = this.readDouble(data, offset);
        return { value, offset: offset + 8 };
      }

      case TType.STRING:
        return this.readString(data, offset);

      case TType.STRUCT: {
        const value = this.readStruct(data, offset);
        return { value, offset: offset + 100 }; // Simplified
      }

      case TType.LIST:
        return this.readList(data, offset);

      default:
        throw new Error(`Unsupported type: ${type}`);
    }
  }

  private writeI16(value: number): Uint8Array {
    const buffer = new ArrayBuffer(2);
    new DataView(buffer).setInt16(0, value, false); // Big-endian
    return new Uint8Array(buffer);
  }

  private readI16(data: Uint8Array, offset: number): number {
    return new DataView(data.buffer, data.byteOffset).getInt16(offset, false);
  }

  private writeI32(value: number): Uint8Array {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, value, false);
    return new Uint8Array(buffer);
  }

  private readI32(data: Uint8Array, offset: number): number {
    return new DataView(data.buffer, data.byteOffset).getInt32(offset, false);
  }

  private writeI64(value: bigint): Uint8Array {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setBigInt64(0, value, false);
    return new Uint8Array(buffer);
  }

  private readI64(data: Uint8Array, offset: number): bigint {
    return new DataView(data.buffer, data.byteOffset).getBigInt64(offset, false);
  }

  private writeDouble(value: number): Uint8Array {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, false);
    return new Uint8Array(buffer);
  }

  private readDouble(data: Uint8Array, offset: number): number {
    return new DataView(data.buffer, data.byteOffset).getFloat64(offset, false);
  }

  private writeString(value: string): Uint8Array {
    const bytes = new TextEncoder().encode(value);
    const length = this.writeI32(bytes.length);
    return this.combineChunks([length, bytes]);
  }

  private readString(data: Uint8Array, offset: number): { value: string; offset: number } {
    const length = this.readI32(data, offset);
    offset += 4;

    const bytes = data.slice(offset, offset + length);
    const value = new TextDecoder().decode(bytes);

    return { value, offset: offset + length };
  }

  private writeList(value: any[]): Uint8Array {
    const chunks: Uint8Array[] = [];

    // Element type (assume I32 for simplicity)
    chunks.push(new Uint8Array([TType.I32]));

    // Size
    chunks.push(this.writeI32(value.length));

    // Elements
    for (const item of value) {
      chunks.push(this.writeI32(item));
    }

    return this.combineChunks(chunks);
  }

  private readList(data: Uint8Array, offset: number): { value: any[]; offset: number } {
    const elementType = data[offset++] as TType;
    const size = this.readI32(data, offset);
    offset += 4;

    const list: any[] = [];

    for (let i = 0; i < size; i++) {
      const { value, offset: newOffset } = this.readValue(data, offset, elementType);
      list.push(value);
      offset = newOffset;
    }

    return { value: list, offset };
  }

  private writeMap(value: Map<any, any>): Uint8Array {
    const chunks: Uint8Array[] = [];

    // Key type
    chunks.push(new Uint8Array([TType.STRING]));

    // Value type
    chunks.push(new Uint8Array([TType.I32]));

    // Size
    chunks.push(this.writeI32(value.size));

    // Entries
    for (const [key, val] of value) {
      chunks.push(this.writeString(key));
      chunks.push(this.writeI32(val));
    }

    return this.combineChunks(chunks);
  }

  private writeSet(value: Set<any>): Uint8Array {
    const chunks: Uint8Array[] = [];

    // Element type
    chunks.push(new Uint8Array([TType.STRING]));

    // Size
    chunks.push(this.writeI32(value.size));

    // Elements
    for (const item of value) {
      chunks.push(this.writeString(item));
    }

    return this.combineChunks(chunks);
  }

  private frameMessage(message: Uint8Array): Uint8Array {
    // Framed transport: [4-byte length][message]
    const length = this.writeI32(message.length);
    return this.combineChunks([length, message]);
  }

  private async receiveFramed(): Promise<Uint8Array> {
    // Read frame length
    const lengthBuf = await this.receiveExact(4);
    const length = this.readI32(lengthBuf, 0);

    // Read frame data
    return await this.receiveExact(length);
  }

  private async receiveExact(length: number): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();
    const buffer = new Uint8Array(length);
    let offset = 0;

    while (offset < length) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = length - offset;
      const toCopy = Math.min(remaining, value.length);
      buffer.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    reader.releaseLock();
    return buffer;
  }

  private async receive(): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();
    const { value, done } = await reader.read();
    reader.releaseLock();

    if (done || !value) {
      throw new Error('No response');
    }

    return value;
  }

  private combineChunks(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
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
```

## Web UI Design

```typescript
// src/components/ThriftClient.tsx

export function ThriftClient() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(9090);
  const [method, setMethod] = useState('getUser');
  const [userId, setUserId] = useState(1);
  const [result, setResult] = useState<any>(null);

  const callMethod = async () => {
    const response = await fetch('/api/thrift/call', {
      method: 'POST',
      body: JSON.stringify({
        host,
        port,
        method,
        args: { userId },
      }),
    });

    const data = await response.json();
    setResult(data);
  };

  return (
    <div className="thrift-client">
      <h2>Apache Thrift Client</h2>

      <div className="config">
        <input placeholder="Thrift Server" value={host} onChange={(e) => setHost(e.target.value)} />
        <input type="number" placeholder="Port" value={port} onChange={(e) => setPort(Number(e.target.value))} />
      </div>

      <div className="rpc">
        <h3>RPC Call</h3>
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="getUser">getUser</option>
          <option value="createUser">createUser</option>
          <option value="listUsers">listUsers</option>
        </select>
        <input type="number" placeholder="User ID" value={userId} onChange={(e) => setUserId(Number(e.target.value))} />
        <button onClick={callMethod}>Call</button>
      </div>

      {result && (
        <div className="result">
          <h3>Result:</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}

      <div className="info">
        <h3>About Apache Thrift</h3>
        <ul>
          <li>Cross-language RPC framework</li>
          <li>Interface Definition Language (IDL)</li>
          <li>Multiple protocols (Binary, Compact, JSON)</li>
          <li>Multiple transports (Socket, HTTP, Framed)</li>
          <li>Efficient serialization</li>
          <li>Used by Facebook, Cassandra, HBase</li>
        </ul>
      </div>
    </div>
  );
}
```

## Testing

```bash
# Install Thrift compiler
brew install thrift

# Compile IDL
thrift --gen js user.thrift

# Start Thrift server (Python)
python thrift_server.py

# Test client
node thrift_client.js
```

## Resources

- **Apache Thrift**: [Official site](https://thrift.apache.org/)
- **Tutorial**: [Thrift tutorial](https://thrift.apache.org/tutorial/)
- **IDL Guide**: [Interface Definition](https://thrift.apache.org/docs/idl)

## Notes

- **Cross-language** - Java, Python, C++, JavaScript, etc.
- **IDL-based** - Define services once, generate code
- **Multiple protocols** - Binary (fast), Compact (small), JSON (readable)
- **Multiple transports** - Socket, HTTP, Framed, Memory
- **Efficient** - Faster than JSON/XML RPC
- **Type-safe** - Strong typing via code generation
- **Versioning** - Field IDs allow backward compatibility
- **Used widely** - Facebook, Twitter, Evernote
- **Similar to gRPC** - But older and more mature
- **Cassandra** - Uses Thrift for client protocol
