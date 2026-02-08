# Neo4j Protocol Implementation Plan

## Overview

**Protocol:** Bolt Protocol (Neo4j)
**Port:** 7687 (Bolt), 7474 (HTTP)
**Specification:** [Bolt Protocol Specification](https://neo4j.com/docs/bolt/current/)
**Complexity:** High
**Purpose:** Graph database queries

Neo4j enables **querying graph databases** via the Bolt protocol - execute Cypher queries, traverse relationships, and visualize connected data from the browser.

### Use Cases
- Social network analysis
- Recommendation engines
- Fraud detection
- Knowledge graphs
- Network topology
- Dependency analysis

## Protocol Specification

### Bolt Protocol

```
Client → Server: Handshake (4 versions)
Server → Client: Selected version
Client → Server: HELLO {auth, user_agent}
Server → Client: SUCCESS
Client ↔ Server: Messages (QUERY, PULL, etc.)
```

### Handshake

```
0x6060B017  (magic number)
[version4] [version3] [version2] [version1]

Each version is uint32 (e.g., 0x00000504 = v5.4)
```

### Message Structure

```
┌────────────┬────────────┬────────────┐
│  Chunk     │  Chunk     │  End       │
│  Header    │  Data      │  Marker    │
├────────────┼────────────┼────────────┤
│ uint16 len │ ... data   │ 0x00 0x00  │
└────────────┴────────────┴────────────┘
```

### Message Types

| Tag | Name | Description |
|-----|------|-------------|
| 0x01 | HELLO | Initialize connection |
| 0x10 | RUN | Execute Cypher query |
| 0x3F | PULL | Fetch query results |
| 0x11 | BEGIN | Begin transaction |
| 0x12 | COMMIT | Commit transaction |
| 0x13 | ROLLBACK | Rollback transaction |
| 0x70 | SUCCESS | Operation succeeded |
| 0x7F | FAILURE | Operation failed |
| 0x71 | RECORD | Result record |

### PackStream Encoding

Bolt uses PackStream (similar to MessagePack):

```
Integers:   0x00-0x7F (tiny int)
Strings:    0x80-0x8F (tiny string)
Lists:      0x90-0x9F (tiny list)
Maps:       0xA0-0xAF (tiny map)
Structures: 0xB0-0xBF (tiny struct)
```

## Worker Implementation

```typescript
// src/worker/protocols/neo4j/client.ts

import { connect } from 'cloudflare:sockets';

export interface Neo4jConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string;
}

export interface QueryResult {
  records: Record[];
  summary: ResultSummary;
}

export interface Record {
  keys: string[];
  values: any[];
  get(key: string): any;
}

export interface ResultSummary {
  query: string;
  queryType: string;
  counters: StatementStatistics;
}

export interface StatementStatistics {
  nodesCreated: number;
  nodesDeleted: number;
  relationshipsCreated: number;
  relationshipsDeleted: number;
  propertiesSet: number;
}

export class Neo4jClient {
  private socket: any;
  private version: number = 0;

  constructor(private config: Neo4jConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    // Perform handshake
    await this.handshake();

    // Send HELLO
    await this.hello();
  }

  private async handshake(): Promise<void> {
    const handshake = new Uint8Array(20);
    const view = new DataView(handshake.buffer);

    // Magic number
    view.setUint32(0, 0x6060B017);

    // Supported versions (4.4, 4.3, 4.2, 4.1)
    view.setUint32(4, 0x00000404);
    view.setUint32(8, 0x00000403);
    view.setUint32(12, 0x00000402);
    view.setUint32(16, 0x00000401);

    const writer = this.socket.writable.getWriter();
    await writer.write(handshake);
    writer.releaseLock();

    // Read server's chosen version
    const reader = this.socket.readable.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    const versionView = new DataView(value.buffer);
    this.version = versionView.getUint32(0);

    if (this.version === 0) {
      throw new Error('Server does not support any offered protocol versions');
    }
  }

  private async hello(): Promise<void> {
    const auth = {
      scheme: 'basic',
      principal: this.config.username,
      credentials: this.config.password,
    };

    const message = {
      user_agent: 'PortOfCall/1.0',
      ...auth,
    };

    if (this.config.database) {
      Object.assign(message, { routing: { db: this.config.database } });
    }

    await this.sendMessage(0x01, message); // HELLO
    const response = await this.receiveMessage();

    if (response.tag !== 0x70) { // SUCCESS
      throw new Error('Authentication failed');
    }
  }

  async run(query: string, parameters: Record<string, any> = {}): Promise<QueryResult> {
    // Send RUN message
    await this.sendMessage(0x10, {
      query,
      parameters,
      metadata: {},
    });

    const runResponse = await this.receiveMessage();
    if (runResponse.tag !== 0x70) {
      throw new Error('Query failed');
    }

    // Send PULL message
    await this.sendMessage(0x3F, { n: -1 }); // Pull all

    // Collect records
    const records: Record[] = [];
    const keys: string[] = runResponse.data.fields || [];

    while (true) {
      const message = await this.receiveMessage();

      if (message.tag === 0x71) { // RECORD
        const values = message.data;
        records.push(this.createRecord(keys, values));
      } else if (message.tag === 0x70) { // SUCCESS
        const summary = this.createSummary(query, message.data);
        return { records, summary };
      } else if (message.tag === 0x7F) { // FAILURE
        throw new Error(message.data.message);
      }
    }
  }

  async beginTransaction(): Promise<void> {
    await this.sendMessage(0x11, {}); // BEGIN
    await this.receiveMessage();
  }

  async commit(): Promise<void> {
    await this.sendMessage(0x12, {}); // COMMIT
    await this.receiveMessage();
  }

  async rollback(): Promise<void> {
    await this.sendMessage(0x13, {}); // ROLLBACK
    await this.receiveMessage();
  }

  private async sendMessage(tag: number, data: any): Promise<void> {
    // Encode message with PackStream
    const encoded = this.packStruct(tag, data);

    // Chunk the message
    const chunks: Uint8Array[] = [];
    const chunkSize = 8192;

    for (let i = 0; i < encoded.length; i += chunkSize) {
      const chunk = encoded.slice(i, i + chunkSize);
      const header = new Uint8Array(2);
      new DataView(header.buffer).setUint16(0, chunk.length);

      const chunkWithHeader = new Uint8Array(header.length + chunk.length);
      chunkWithHeader.set(header);
      chunkWithHeader.set(chunk, header.length);

      chunks.push(chunkWithHeader);
    }

    // End marker
    const endMarker = new Uint8Array([0x00, 0x00]);
    chunks.push(endMarker);

    // Send all chunks
    const writer = this.socket.writable.getWriter();
    for (const chunk of chunks) {
      await writer.write(chunk);
    }
    writer.releaseLock();
  }

  private async receiveMessage(): Promise<{ tag: number; data: any }> {
    const reader = this.socket.readable.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { value } = await reader.read();

      // Read chunk header
      const view = new DataView(value.buffer);
      const chunkSize = view.getUint16(0);

      if (chunkSize === 0) break; // End marker

      // Read chunk data
      const chunk = value.slice(2, 2 + chunkSize);
      chunks.push(chunk);
    }

    reader.releaseLock();

    // Combine chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Unpack message
    return this.unpackStruct(combined);
  }

  private packStruct(tag: number, data: any): Uint8Array {
    const fields = this.packValue(data);
    const result = new Uint8Array(2 + fields.length);

    result[0] = 0xB1; // Tiny struct with 1 field
    result[1] = tag;
    result.set(fields, 2);

    return result;
  }

  private packValue(value: any): Uint8Array {
    if (value === null) {
      return new Uint8Array([0xC0]);
    }

    if (typeof value === 'boolean') {
      return new Uint8Array([value ? 0xC3 : 0xC2]);
    }

    if (typeof value === 'number') {
      return this.packNumber(value);
    }

    if (typeof value === 'string') {
      return this.packString(value);
    }

    if (Array.isArray(value)) {
      return this.packList(value);
    }

    if (typeof value === 'object') {
      return this.packMap(value);
    }

    throw new Error(`Cannot pack value of type ${typeof value}`);
  }

  private packNumber(n: number): Uint8Array {
    if (Number.isInteger(n)) {
      if (n >= -16 && n <= 127) {
        return new Uint8Array([n & 0xFF]);
      } else if (n >= -128 && n <= 127) {
        return new Uint8Array([0xC8, n & 0xFF]);
      } else if (n >= -32768 && n <= 32767) {
        const buffer = new Uint8Array(3);
        buffer[0] = 0xC9;
        new DataView(buffer.buffer).setInt16(1, n);
        return buffer;
      } else {
        const buffer = new Uint8Array(5);
        buffer[0] = 0xCA;
        new DataView(buffer.buffer).setInt32(1, n);
        return buffer;
      }
    } else {
      const buffer = new Uint8Array(9);
      buffer[0] = 0xC1;
      new DataView(buffer.buffer).setFloat64(1, n);
      return buffer;
    }
  }

  private packString(str: string): Uint8Array {
    const bytes = new TextEncoder().encode(str);
    const length = bytes.length;

    if (length < 16) {
      const result = new Uint8Array(1 + length);
      result[0] = 0x80 | length;
      result.set(bytes, 1);
      return result;
    } else {
      const result = new Uint8Array(2 + length);
      result[0] = 0xD0;
      result[1] = length;
      result.set(bytes, 2);
      return result;
    }
  }

  private packList(list: any[]): Uint8Array {
    const packed = list.map(item => this.packValue(item));
    const totalLength = packed.reduce((sum, p) => sum + p.length, 0);

    const result = new Uint8Array(1 + totalLength);
    result[0] = 0x90 | list.length;

    let offset = 1;
    for (const p of packed) {
      result.set(p, offset);
      offset += p.length;
    }

    return result;
  }

  private packMap(map: Record<string, any>): Uint8Array {
    const entries = Object.entries(map);
    const packed = entries.flatMap(([k, v]) => [
      this.packString(k),
      this.packValue(v),
    ]);

    const totalLength = packed.reduce((sum, p) => sum + p.length, 0);

    const result = new Uint8Array(1 + totalLength);
    result[0] = 0xA0 | entries.length;

    let offset = 1;
    for (const p of packed) {
      result.set(p, offset);
      offset += p.length;
    }

    return result;
  }

  private unpackStruct(data: Uint8Array): { tag: number; data: any } {
    const marker = data[0];
    const size = marker & 0x0F;
    const tag = data[1];

    const [value, _] = this.unpackValue(data, 2);

    return { tag, data: value };
  }

  private unpackValue(data: Uint8Array, offset: number): [any, number] {
    const marker = data[offset];

    if (marker >= 0x00 && marker <= 0x7F) {
      return [marker, offset + 1]; // Tiny int
    }

    if (marker >= 0x80 && marker <= 0x8F) {
      const length = marker & 0x0F;
      const str = new TextDecoder().decode(data.slice(offset + 1, offset + 1 + length));
      return [str, offset + 1 + length];
    }

    if (marker >= 0xA0 && marker <= 0xAF) {
      const size = marker & 0x0F;
      const map: Record<string, any> = {};
      let pos = offset + 1;

      for (let i = 0; i < size; i++) {
        const [key, newPos] = this.unpackValue(data, pos);
        pos = newPos;
        const [value, newPos2] = this.unpackValue(data, pos);
        pos = newPos2;
        map[key] = value;
      }

      return [map, pos];
    }

    if (marker === 0xC0) {
      return [null, offset + 1];
    }

    // Add more unpacking as needed
    return [null, offset + 1];
  }

  private createRecord(keys: string[], values: any[]): Record {
    const record: Record = {
      keys,
      values,
      get(key: string) {
        const index = keys.indexOf(key);
        return index >= 0 ? values[index] : undefined;
      },
    };
    return record;
  }

  private createSummary(query: string, data: any): ResultSummary {
    return {
      query,
      queryType: data.type || 'r',
      counters: data.stats || {
        nodesCreated: 0,
        nodesDeleted: 0,
        relationshipsCreated: 0,
        relationshipsDeleted: 0,
        propertiesSet: 0,
      },
    };
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/Neo4jClient.tsx

export function Neo4jClient() {
  const [connected, setConnected] = useState(false);
  const [query, setQuery] = useState('MATCH (n) RETURN n LIMIT 25');
  const [result, setResult] = useState<QueryResult | null>(null);

  const executeQuery = async () => {
    const response = await fetch('/api/neo4j/query', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    setResult(data);
  };

  const quickQueries = [
    { label: 'All Nodes', query: 'MATCH (n) RETURN n LIMIT 25' },
    { label: 'All Relationships', query: 'MATCH ()-[r]->() RETURN r LIMIT 25' },
    { label: 'Node Count', query: 'MATCH (n) RETURN count(n)' },
    { label: 'Relationship Count', query: 'MATCH ()-[r]->() RETURN count(r)' },
  ];

  return (
    <div className="neo4j-client">
      <h2>Neo4j Cypher Client</h2>

      <div className="query-editor">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={5}
          placeholder="Enter Cypher query..."
        />
        <button onClick={executeQuery}>Execute</button>

        <div className="quick-queries">
          {quickQueries.map(q => (
            <button
              key={q.label}
              onClick={() => setQuery(q.query)}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {result && (
        <div className="results">
          <h3>Results ({result.records.length} records)</h3>

          {result.summary.counters && (
            <div className="stats">
              <span>Nodes Created: {result.summary.counters.nodesCreated}</span>
              <span>Relationships Created: {result.summary.counters.relationshipsCreated}</span>
            </div>
          )}

          <table>
            <thead>
              <tr>
                {result.records[0]?.keys.map(key => (
                  <th key={key}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.records.map((record, i) => (
                <tr key={i}>
                  {record.keys.map(key => (
                    <td key={key}>
                      <pre>{JSON.stringify(record.get(key), null, 2)}</pre>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

## Security

### Authentication

```typescript
// Basic auth (default)
const config = {
  username: 'neo4j',
  password: 'password',
};

// Kerberos
const config = {
  scheme: 'kerberos',
  principal: 'user@REALM',
  credentials: 'ticket',
};
```

## Testing

```bash
# Docker Neo4j
docker run -d \
  -p 7474:7474 \
  -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/testpassword \
  neo4j:latest

# Web UI
open http://localhost:7474

# Create test data
CYPHER:
CREATE (a:Person {name: 'Alice'})
CREATE (b:Person {name: 'Bob'})
CREATE (a)-[:KNOWS]->(b)
```

## Resources

- **Bolt Protocol**: [Specification](https://neo4j.com/docs/bolt/current/)
- **Cypher**: [Query Language Guide](https://neo4j.com/docs/cypher-manual/current/)
- **Neo4j Drivers**: [Official drivers](https://neo4j.com/developer/language-guides/)

## Common Cypher Patterns

### Create Nodes
```cypher
CREATE (p:Person {name: 'Alice', age: 30})
```

### Create Relationships
```cypher
MATCH (a:Person {name: 'Alice'})
MATCH (b:Person {name: 'Bob'})
CREATE (a)-[:KNOWS {since: 2020}]->(b)
```

### Find Paths
```cypher
MATCH path = (a:Person)-[:KNOWS*1..3]-(b:Person)
WHERE a.name = 'Alice' AND b.name = 'Charlie'
RETURN path
```

## Notes

- **Bolt protocol** uses PackStream encoding (similar to MessagePack)
- **Graph database** - optimized for relationships
- **Cypher** is declarative graph query language
- **ACID** transactions
- **Chunked** message transfer for streaming large results
- Very efficient for **connected data** queries
