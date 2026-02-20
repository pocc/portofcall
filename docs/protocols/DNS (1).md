# DNS Protocol Implementation Plan

## Overview

**Protocol:** DNS over TCP
**Port:** 53
**RFC:** [RFC 1035](https://tools.ietf.org/html/rfc1035)
**Complexity:** Medium
**Purpose:** Domain name resolution (debugging tool)

DNS over TCP enables **debugging DNS issues**, viewing raw responses, and testing DNS configurations. While most DNS uses UDP, TCP is used for large responses and zone transfers.

### Use Cases
- DNS troubleshooting and debugging
- View raw DNS responses
- Test DNS server configuration
- Query specific DNS record types
- Educational - learn DNS structure

## Protocol Specification

### DNS Message Format

```
┌────────────────────────────────┐
│  Header (12 bytes)              │
├────────────────────────────────┤
│  Question Section               │
├────────────────────────────────┤
│  Answer Section                 │
├────────────────────────────────┤
│  Authority Section              │
├────────────────────────────────┤
│  Additional Section             │
└────────────────────────────────┘
```

### DNS Header

```
 0  1  2  3  4  5  6  7  8  9  0  1  2  3  4  5
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                      ID                       |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|QR|   Opcode  |AA|TC|RD|RA|   Z    |   RCODE   |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    QDCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    ANCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    NSCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                    ARCOUNT                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
```

### Record Types

| Type | Code | Description |
|------|------|-------------|
| A | 1 | IPv4 address |
| NS | 2 | Name server |
| CNAME | 5 | Canonical name |
| MX | 15 | Mail exchange |
| TXT | 16 | Text record |
| AAAA | 28 | IPv6 address |
| SRV | 33 | Service locator |

## Worker Implementation

### DNS Client

```typescript
// src/worker/protocols/dns/client.ts

import { connect } from 'cloudflare:sockets';

export enum DNSRecordType {
  A = 1,
  NS = 2,
  CNAME = 5,
  MX = 15,
  TXT = 16,
  AAAA = 28,
  SRV = 33,
}

export interface DNSQuery {
  name: string;
  type: DNSRecordType;
  class?: number; // Default: 1 (IN - Internet)
}

export interface DNSRecord {
  name: string;
  type: number;
  class: number;
  ttl: number;
  data: string;
}

export class DNSClient {
  private socket: Socket;

  constructor(
    private server: string = '8.8.8.8',
    private port: number = 53
  ) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.server}:${this.port}`);
    await this.socket.opened;
  }

  async query(query: DNSQuery): Promise<DNSRecord[]> {
    const queryPacket = this.buildQuery(query);

    // DNS over TCP: 2-byte length prefix
    const lengthPrefix = new Uint8Array(2);
    lengthPrefix[0] = (queryPacket.length >> 8) & 0xff;
    lengthPrefix[1] = queryPacket.length & 0xff;

    const writer = this.socket.writable.getWriter();
    await writer.write(lengthPrefix);
    await writer.write(queryPacket);
    writer.releaseLock();

    // Read response
    const reader = this.socket.readable.getReader();

    // Read length
    const { value: lengthBytes } = await reader.read();
    const responseLength = (lengthBytes[0] << 8) | lengthBytes[1];

    // Read response
    const { value: responseBytes } = await reader.read();
    reader.releaseLock();

    return this.parseResponse(responseBytes);
  }

  private buildQuery(query: DNSQuery): Uint8Array {
    const buffer: number[] = [];

    // Header
    const id = Math.floor(Math.random() * 65536);
    buffer.push((id >> 8) & 0xff, id & 0xff); // ID

    // Flags: standard query, recursion desired
    buffer.push(0x01, 0x00);

    // Counts
    buffer.push(0x00, 0x01); // QDCOUNT = 1
    buffer.push(0x00, 0x00); // ANCOUNT = 0
    buffer.push(0x00, 0x00); // NSCOUNT = 0
    buffer.push(0x00, 0x00); // ARCOUNT = 0

    // Question
    const labels = query.name.split('.');
    for (const label of labels) {
      buffer.push(label.length);
      for (let i = 0; i < label.length; i++) {
        buffer.push(label.charCodeAt(i));
      }
    }
    buffer.push(0x00); // Null terminator

    // Type
    buffer.push((query.type >> 8) & 0xff, query.type & 0xff);

    // Class (IN = 1)
    const cls = query.class || 1;
    buffer.push((cls >> 8) & 0xff, cls & 0xff);

    return new Uint8Array(buffer);
  }

  private parseResponse(data: Uint8Array): DNSRecord[] {
    // Skip header (12 bytes)
    let offset = 12;

    // Skip question section
    while (data[offset] !== 0) {
      offset += data[offset] + 1;
    }
    offset += 5; // Null + type + class

    // Parse answer section
    const ancount = (data[6] << 8) | data[7];
    const records: DNSRecord[] = [];

    for (let i = 0; i < ancount; i++) {
      const record = this.parseRecord(data, offset);
      records.push(record.record);
      offset = record.newOffset;
    }

    return records;
  }

  private parseRecord(data: Uint8Array, offset: number): {
    record: DNSRecord;
    newOffset: number;
  } {
    // Parse name (with compression)
    const nameResult = this.parseName(data, offset);
    offset = nameResult.offset;

    // Type, class, TTL, data length
    const type = (data[offset] << 8) | data[offset + 1];
    const cls = (data[offset + 2] << 8) | data[offset + 3];
    const ttl = (data[offset + 4] << 24) | (data[offset + 5] << 16) |
                (data[offset + 6] << 8) | data[offset + 7];
    const dataLength = (data[offset + 8] << 8) | data[offset + 9];
    offset += 10;

    // Parse data based on type
    let dataStr = '';
    if (type === DNSRecordType.A) {
      // IPv4
      dataStr = `${data[offset]}.${data[offset + 1]}.${data[offset + 2]}.${data[offset + 3]}`;
    } else if (type === DNSRecordType.AAAA) {
      // IPv6
      const parts: string[] = [];
      for (let i = 0; i < 8; i++) {
        const value = (data[offset + i * 2] << 8) | data[offset + i * 2 + 1];
        parts.push(value.toString(16));
      }
      dataStr = parts.join(':');
    } else if (type === DNSRecordType.CNAME || type === DNSRecordType.NS) {
      // Domain name
      const nameResult = this.parseName(data, offset);
      dataStr = nameResult.name;
    } else {
      // Raw bytes
      dataStr = Array.from(data.slice(offset, offset + dataLength))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');
    }

    offset += dataLength;

    return {
      record: {
        name: nameResult.name,
        type,
        class: cls,
        ttl,
        data: dataStr,
      },
      newOffset: offset,
    };
  }

  private parseName(data: Uint8Array, offset: number): {
    name: string;
    offset: number;
  } {
    const labels: string[] = [];
    let jumped = false;
    let jumpOffset = -1;

    while (true) {
      const length = data[offset];

      if (length === 0) {
        offset++;
        break;
      }

      // Check for compression (pointer)
      if ((length & 0xc0) === 0xc0) {
        if (!jumped) {
          jumpOffset = offset + 2;
        }
        const pointer = ((length & 0x3f) << 8) | data[offset + 1];
        offset = pointer;
        jumped = true;
        continue;
      }

      offset++;
      const label = String.fromCharCode(...data.slice(offset, offset + length));
      labels.push(label);
      offset += length;
    }

    return {
      name: labels.join('.'),
      offset: jumped ? jumpOffset : offset,
    };
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

### DNS Lookup Tool

```typescript
// src/components/DNSLookup.tsx

export function DNSLookup() {
  const [domain, setDomain] = useState('example.com');
  const [recordType, setRecordType] = useState<DNSRecordType>(DNSRecordType.A);
  const [server, setServer] = useState('8.8.8.8');
  const [results, setResults] = useState<DNSRecord[]>([]);

  const lookup = async () => {
    const response = await fetch('/api/dns/query', {
      method: 'POST',
      body: JSON.stringify({ domain, recordType, server }),
    });

    const data = await response.json();
    setResults(data.records);
  };

  return (
    <div className="dns-lookup">
      <h2>DNS Lookup</h2>

      <div className="query-form">
        <input
          type="text"
          placeholder="Domain name"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        />

        <select
          value={recordType}
          onChange={(e) => setRecordType(Number(e.target.value))}
        >
          <option value={DNSRecordType.A}>A (IPv4)</option>
          <option value={DNSRecordType.AAAA}>AAAA (IPv6)</option>
          <option value={DNSRecordType.MX}>MX (Mail)</option>
          <option value={DNSRecordType.TXT}>TXT</option>
          <option value={DNSRecordType.CNAME}>CNAME</option>
          <option value={DNSRecordType.NS}>NS</option>
        </select>

        <input
          type="text"
          placeholder="DNS Server"
          value={server}
          onChange={(e) => setServer(e.target.value)}
        />

        <button onClick={lookup}>Lookup</button>
      </div>

      <div className="results">
        {results.map((record, i) => (
          <div key={i} className="dns-record">
            <span className="name">{record.name}</span>
            <span className="type">{record.type}</span>
            <span className="ttl">{record.ttl}s</span>
            <span className="data">{record.data}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Testing

```bash
# Test with dig
dig @8.8.8.8 +tcp example.com
```

## Resources

- **RFC 1035**: [DNS Protocol](https://tools.ietf.org/html/rfc1035)
- **DNS Record Types**: [IANA Registry](https://www.iana.org/assignments/dns-parameters/)

## Next Steps

1. Implement DNS query builder
2. Parse all record types
3. Add DNSSEC support
4. Build multi-server comparison
5. Add DNS trace visualization

## Notes

- TCP DNS is less common than UDP DNS
- Useful for debugging and large responses
- Zone transfers (AXFR) use TCP
