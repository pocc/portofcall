# Cassandra Protocol Implementation Plan

## Overview

**Protocol:** Cassandra CQL Binary Protocol (Native Protocol)
**Port:** 9042 (native), 9160 (Thrift - deprecated)
**Specification:** [DataStax CQL Binary Protocol](https://github.com/apache/cassandra/blob/trunk/doc/native_protocol_v5.spec)
**Complexity:** High
**Purpose:** Distributed NoSQL database queries

Cassandra enables **querying distributed NoSQL data** - execute CQL queries, manage keyspaces, and access wide-column data from the browser.

### Use Cases
- IoT time-series data storage
- Event logging and analytics
- User profile management
- Product catalogs
- Distributed data access
- Multi-datacenter replication

## Protocol Specification

### Frame Format

```
 0         8        16        24        32         40
 +---------+---------+---------+---------+---------+
 | version |  flags  | stream  | opcode  |
 +---------+---------+---------+---------+---------+
 |                length                 |
 +---------+---------+---------+---------+
 |                                       |
 .            ...  body ...              .
 .                                       .
 +----------------------------------------
```

### Frame Header
- **Version**: Protocol version (0x04 = v4, 0x05 = v5)
- **Flags**: Compression, tracing, etc.
- **Stream**: Request/response correlation (0-32767)
- **Opcode**: Message type
- **Length**: Body length in bytes

### Opcodes (Client → Server)

| Opcode | Name | Description |
|--------|------|-------------|
| 0x01 | STARTUP | Initialize connection |
| 0x05 | OPTIONS | Get supported options |
| 0x07 | QUERY | Execute CQL query |
| 0x09 | PREPARE | Prepare statement |
| 0x0A | EXECUTE | Execute prepared statement |
| 0x0B | REGISTER | Register for events |
| 0x0D | BATCH | Batch operations |

### Opcodes (Server → Client)

| Opcode | Name | Description |
|--------|------|-------------|
| 0x00 | ERROR | Error response |
| 0x02 | READY | Connection ready |
| 0x06 | SUPPORTED | Supported options |
| 0x08 | RESULT | Query result |
| 0x0C | EVENT | Server event |

## Worker Implementation

```typescript
// src/worker/protocols/cassandra/client.ts

import { connect } from 'cloudflare:sockets';

export interface CassandraConfig {
  host: string;
  port: number;
  keyspace?: string;
  username?: string;
  password?: string;
}

export interface QueryResult {
  rows: any[];
  columns: ColumnMetadata[];
  rowCount: number;
}

export interface ColumnMetadata {
  keyspace: string;
  table: string;
  name: string;
  type: string;
}

export class CassandraClient {
  private socket: any;
  private streamId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }>();

  constructor(private config: CassandraConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Start reading responses
    this.readLoop();

    // Send STARTUP
    await this.sendStartup();

    // Authenticate if needed
    if (this.config.username && this.config.password) {
      await this.authenticate();
    }
  }

  private async sendStartup(): Promise<void> {
    const body = this.encodeStringMap({
      CQL_VERSION: '3.0.0',
    });

    await this.sendFrame(0x01, body); // STARTUP opcode
    await this.waitForReady();
  }

  private async authenticate(): Promise<void> {
    // SASL authentication
    const credentials = `\0${this.config.username}\0${this.config.password}`;
    const body = this.encodeBytes(new TextEncoder().encode(credentials));

    await this.sendFrame(0x0B, body); // AUTH_RESPONSE
  }

  async query(cql: string, consistency: number = 0x0001): Promise<QueryResult> {
    const body = new Uint8Array(1024);
    const view = new DataView(body.buffer);
    let offset = 0;

    // Write long string (CQL)
    view.setUint32(offset, cql.length);
    offset += 4;
    new TextEncoder().encodeInto(cql, new Uint8Array(body.buffer, offset));
    offset += cql.length;

    // Write consistency
    view.setUint16(offset, consistency);
    offset += 2;

    // Write flags (no values)
    view.setUint8(offset, 0x00);
    offset += 1;

    const frame = body.slice(0, offset);
    const response = await this.sendFrame(0x07, frame); // QUERY opcode

    return this.parseResult(response);
  }

  async prepare(cql: string): Promise<string> {
    const body = this.encodeLongString(cql);
    const response = await this.sendFrame(0x09, body); // PREPARE

    // Extract prepared statement ID
    return this.parseShortBytes(response, 0);
  }

  async execute(
    statementId: string,
    values: any[],
    consistency: number = 0x0001
  ): Promise<QueryResult> {
    const body = new Uint8Array(1024);
    const view = new DataView(body.buffer);
    let offset = 0;

    // Write statement ID
    const idBytes = this.hexToBytes(statementId);
    view.setUint16(offset, idBytes.length);
    offset += 2;
    body.set(idBytes, offset);
    offset += idBytes.length;

    // Write consistency
    view.setUint16(offset, consistency);
    offset += 2;

    // Write flags (with values)
    view.setUint8(offset, 0x01);
    offset += 1;

    // Write values count
    view.setUint16(offset, values.length);
    offset += 2;

    // Write each value
    for (const value of values) {
      const encoded = this.encodeValue(value);
      view.setUint32(offset, encoded.length);
      offset += 4;
      body.set(encoded, offset);
      offset += encoded.length;
    }

    const frame = body.slice(0, offset);
    const response = await this.sendFrame(0x0A, frame); // EXECUTE

    return this.parseResult(response);
  }

  private async sendFrame(opcode: number, body: Uint8Array): Promise<Uint8Array> {
    const streamId = this.streamId++;
    if (this.streamId > 32767) this.streamId = 0;

    const header = new Uint8Array(9);
    const view = new DataView(header.buffer);

    view.setUint8(0, 0x04); // Version 4
    view.setUint8(1, 0x00); // Flags
    view.setUint16(2, streamId); // Stream
    view.setUint8(4, opcode);
    view.setUint32(5, body.length);

    const frame = new Uint8Array(header.length + body.length);
    frame.set(header);
    frame.set(body, header.length);

    const writer = this.socket.writable.getWriter();
    await writer.write(frame);
    writer.releaseLock();

    // Return promise that resolves when response arrives
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(streamId, { resolve, reject });
    });
  }

  private async readLoop(): Promise<void> {
    const reader = this.socket.readable.getReader();

    while (true) {
      // Read header (9 bytes)
      const headerData = await this.readExact(reader, 9);
      const header = new DataView(headerData.buffer);

      const version = header.getUint8(0);
      const flags = header.getUint8(1);
      const stream = header.getUint16(2);
      const opcode = header.getUint8(4);
      const length = header.getUint32(5);

      // Read body
      const body = await this.readExact(reader, length);

      // Resolve pending request
      const pending = this.pendingRequests.get(stream);
      if (pending) {
        this.pendingRequests.delete(stream);
        pending.resolve(body);
      }
    }
  }

  private async readExact(reader: any, length: number): Promise<Uint8Array> {
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

    return buffer;
  }

  private parseResult(body: Uint8Array): QueryResult {
    const view = new DataView(body.buffer);
    const resultKind = view.getUint32(0);

    if (resultKind === 0x0002) { // ROWS
      return this.parseRows(body, 4);
    }

    return { rows: [], columns: [], rowCount: 0 };
  }

  private parseRows(body: Uint8Array, offset: number): QueryResult {
    const view = new DataView(body.buffer);

    // Read metadata
    const flags = view.getUint32(offset);
    offset += 4;

    const columnCount = view.getUint32(offset);
    offset += 4;

    const rowCount = view.getUint32(offset);
    offset += 4;

    // Parse column metadata
    const columns: ColumnMetadata[] = [];
    for (let i = 0; i < columnCount; i++) {
      // Parse keyspace, table, name, type
      const keyspace = this.parseString(body, offset);
      offset += 2 + keyspace.length;

      const table = this.parseString(body, offset);
      offset += 2 + table.length;

      const name = this.parseString(body, offset);
      offset += 2 + name.length;

      const type = view.getUint16(offset);
      offset += 2;

      columns.push({
        keyspace,
        table,
        name,
        type: this.getTypeName(type),
      });
    }

    // Parse rows
    const rows: any[] = [];
    for (let i = 0; i < rowCount; i++) {
      const row: any = {};

      for (let j = 0; j < columnCount; j++) {
        const valueLength = view.getInt32(offset);
        offset += 4;

        if (valueLength >= 0) {
          const value = body.slice(offset, offset + valueLength);
          row[columns[j].name] = this.decodeValue(value, columns[j].type);
          offset += valueLength;
        } else {
          row[columns[j].name] = null;
        }
      }

      rows.push(row);
    }

    return { rows, columns, rowCount };
  }

  private encodeValue(value: any): Uint8Array {
    if (value === null) return new Uint8Array(0);
    if (typeof value === 'string') {
      return new TextEncoder().encode(value);
    }
    // Add more type encodings as needed
    return new Uint8Array(0);
  }

  private decodeValue(bytes: Uint8Array, type: string): any {
    if (bytes.length === 0) return null;

    switch (type) {
      case 'varchar':
      case 'text':
        return new TextDecoder().decode(bytes);
      case 'int':
        return new DataView(bytes.buffer).getInt32(0);
      case 'bigint':
        return new DataView(bytes.buffer).getBigInt64(0);
      default:
        return bytes;
    }
  }

  private getTypeName(typeId: number): string {
    const types: Record<number, string> = {
      0x0001: 'ascii',
      0x0002: 'bigint',
      0x0003: 'blob',
      0x0004: 'boolean',
      0x0009: 'int',
      0x000D: 'varchar',
      0x000E: 'timestamp',
      0x0020: 'list',
    };
    return types[typeId] || 'unknown';
  }

  private encodeStringMap(map: Record<string, string>): Uint8Array {
    const entries = Object.entries(map);
    const encoder = new TextEncoder();

    let totalLength = 2; // count
    const encoded: Array<{ key: Uint8Array; value: Uint8Array }> = [];

    for (const [key, value] of entries) {
      const keyBytes = encoder.encode(key);
      const valueBytes = encoder.encode(value);
      encoded.push({ key: keyBytes, value: valueBytes });
      totalLength += 2 + keyBytes.length + 2 + valueBytes.length;
    }

    const buffer = new Uint8Array(totalLength);
    const view = new DataView(buffer.buffer);
    let offset = 0;

    view.setUint16(offset, entries.length);
    offset += 2;

    for (const { key, value } of encoded) {
      view.setUint16(offset, key.length);
      offset += 2;
      buffer.set(key, offset);
      offset += key.length;

      view.setUint16(offset, value.length);
      offset += 2;
      buffer.set(value, offset);
      offset += value.length;
    }

    return buffer;
  }

  private encodeLongString(str: string): Uint8Array {
    const bytes = new TextEncoder().encode(str);
    const buffer = new Uint8Array(4 + bytes.length);
    new DataView(buffer.buffer).setUint32(0, bytes.length);
    buffer.set(bytes, 4);
    return buffer;
  }

  private parseString(data: Uint8Array, offset: number): string {
    const view = new DataView(data.buffer);
    const length = view.getUint16(offset);
    const bytes = data.slice(offset + 2, offset + 2 + length);
    return new TextDecoder().decode(bytes);
  }

  private parseShortBytes(data: Uint8Array, offset: number): string {
    const view = new DataView(data.buffer);
    const length = view.getUint16(offset);
    const bytes = data.slice(offset + 2, offset + 2 + length);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      // Wait for READY opcode (0x02)
      setTimeout(resolve, 100);
    });
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/CassandraClient.tsx

export function CassandraClient() {
  const [connected, setConnected] = useState(false);
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(9042);
  const [keyspace, setKeyspace] = useState('');
  const [query, setQuery] = useState('SELECT * FROM users LIMIT 10');
  const [result, setResult] = useState<QueryResult | null>(null);

  const connect = async () => {
    const response = await fetch('/api/cassandra/connect', {
      method: 'POST',
      body: JSON.stringify({ host, port, keyspace }),
    });

    if (response.ok) {
      setConnected(true);
    }
  };

  const executeQuery = async () => {
    const response = await fetch('/api/cassandra/query', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    setResult(data);
  };

  return (
    <div className="cassandra-client">
      <h2>Cassandra CQL Client</h2>

      {!connected ? (
        <div className="connection-form">
          <input
            type="text"
            placeholder="Host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
          <input
            type="number"
            placeholder="Port"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
          <input
            type="text"
            placeholder="Keyspace (optional)"
            value={keyspace}
            onChange={(e) => setKeyspace(e.target.value)}
          />
          <button onClick={connect}>Connect</button>
        </div>
      ) : (
        <>
          <div className="query-editor">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={5}
              placeholder="Enter CQL query..."
            />
            <button onClick={executeQuery}>Execute</button>
          </div>

          {result && (
            <div className="results">
              <h3>Results ({result.rowCount} rows)</h3>
              <table>
                <thead>
                  <tr>
                    {result.columns.map(col => (
                      <th key={col.name}>
                        {col.name}
                        <span className="type">({col.type})</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {result.columns.map(col => (
                        <td key={col.name}>
                          {JSON.stringify(row[col.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

## Security

### Authentication

```typescript
// SASL PLAIN authentication
const credentials = `\0${username}\0${password}`;

// Or use certificate-based auth
```

### Client Encryption

```typescript
// Enable client-to-node encryption
// Requires SSL/TLS configuration on Cassandra cluster
```

## Testing

```bash
# Docker Cassandra
docker run -d \
  -p 9042:9042 \
  --name cassandra \
  cassandra:latest

# Wait for startup
docker exec -it cassandra cqlsh

# Create test keyspace
CREATE KEYSPACE test WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
USE test;

# Create test table
CREATE TABLE users (
  id UUID PRIMARY KEY,
  name TEXT,
  email TEXT,
  created_at TIMESTAMP
);

# Insert data
INSERT INTO users (id, name, email, created_at)
VALUES (uuid(), 'Alice', 'alice@example.com', toTimestamp(now()));
```

## Resources

- **Cassandra Protocol**: [Binary Protocol Spec](https://github.com/apache/cassandra/blob/trunk/doc/native_protocol_v5.spec)
- **CQL**: [Cassandra Query Language](https://cassandra.apache.org/doc/latest/cql/)
- **DataStax Drivers**: [Official drivers](https://docs.datastax.com/en/developer/nodejs-driver/)

## Common CQL Patterns

### Create Keyspace
```cql
CREATE KEYSPACE myapp
WITH replication = {
  'class': 'SimpleStrategy',
  'replication_factor': 3
};
```

### Time-Series Data
```cql
CREATE TABLE events (
  device_id UUID,
  timestamp TIMESTAMP,
  value DOUBLE,
  PRIMARY KEY (device_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC);
```

### Collections
```cql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  emails SET<TEXT>,
  phone_numbers LIST<TEXT>,
  metadata MAP<TEXT, TEXT>
);
```

## Notes

- **Binary protocol** - complex framing and encoding
- **Distributed** - partition keys determine data location
- **Eventually consistent** - tunable consistency levels
- **Wide-column** store - flexible schema
- **CQL** is SQL-like but with NoSQL semantics
- **Prepared statements** improve performance significantly
- **Batch operations** for atomic mutations
