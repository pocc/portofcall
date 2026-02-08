# ⚠️ NON-TCP PROTOCOL - NOT COMPATIBLE WITH CLOUDFLARE WORKERS

> **Note:** This protocol does not use TCP as its primary transport mechanism. It cannot be implemented using Cloudflare Workers' Sockets API (`connect()`), which only supports TCP connections. This protocol is documented here for reference but requires alternative implementation approaches (native UDP/IP sockets, specialized gateways, or protocol translation).


## Overview

**Protocol:** SNMP (Simple Network Management Protocol)
**Port:** 161 (agent), 162 (trap)
**RFC:** [RFC 3416](https://tools.ietf.org/html/rfc3416) (SNMPv2), [RFC 3411-3418](https://tools.ietf.org/html/rfc3411) (SNMPv3)
**Complexity:** High
**Purpose:** Network device management and monitoring

SNMP enables **network device monitoring** - query routers, switches, servers, and IoT devices for statistics, configuration, and status from the browser.

### Use Cases
- Network device monitoring
- Server performance metrics
- Bandwidth utilization tracking
- Temperature and power monitoring
- Printer status and supplies
- UPS battery levels
- Infrastructure alerting

## Protocol Specification

### SNMP Architecture

```
Manager → Agent: GET, GETNEXT, GETBULK, SET
Agent → Manager: RESPONSE
Agent → Manager: TRAP (asynchronous notification)
```

### PDU Types

| Type | Value | Description |
|------|-------|-------------|
| GetRequest | 0 | Request MIB variable |
| GetNextRequest | 1 | Request next MIB variable |
| Response | 2 | Response to request |
| SetRequest | 3 | Set MIB variable |
| Trap | 4 | Asynchronous notification (v1) |
| GetBulkRequest | 5 | Bulk retrieval (v2c/v3) |
| InformRequest | 6 | Acknowledged trap (v2c/v3) |
| SNMPv2-Trap | 7 | Trap (v2c/v3) |
| Report | 8 | Engine info (v3) |

### ASN.1/BER Encoding

SNMP uses ASN.1 with BER (Basic Encoding Rules):

```
Message ::= SEQUENCE {
  version INTEGER,
  community OCTET STRING,
  pdu PDU
}

PDU ::= SEQUENCE {
  request-id INTEGER,
  error-status INTEGER,
  error-index INTEGER,
  variable-bindings VarBindList
}

VarBind ::= SEQUENCE {
  name ObjectName,
  value ObjectSyntax
}
```

### OID (Object Identifier)

```
1.3.6.1.2.1.1.1.0  (sysDescr)
1.3.6.1.2.1.1.3.0  (sysUpTime)
1.3.6.1.2.1.2.2.1.10.1 (ifInOctets.1)
```

### Common MIB-II OIDs

| OID | Name | Description |
|-----|------|-------------|
| 1.3.6.1.2.1.1.1 | sysDescr | System description |
| 1.3.6.1.2.1.1.3 | sysUpTime | System uptime |
| 1.3.6.1.2.1.1.4 | sysContact | System contact |
| 1.3.6.1.2.1.1.5 | sysName | System name |
| 1.3.6.1.2.1.1.6 | sysLocation | System location |
| 1.3.6.1.2.1.2.2.1.10 | ifInOctets | Interface input bytes |
| 1.3.6.1.2.1.2.2.1.16 | ifOutOctets | Interface output bytes |

## Worker Implementation

```typescript
// src/worker/protocols/snmp/client.ts

// Note: SNMP uses UDP, requires proxy for Workers

export interface SNMPConfig {
  host: string;
  port?: number;
  community?: string;
  version?: 1 | 2 | 3;
  timeout?: number;
}

export interface SNMPVarBind {
  oid: string;
  type: SNMPType;
  value: any;
}

export enum SNMPType {
  Integer = 0x02,
  OctetString = 0x04,
  Null = 0x05,
  ObjectIdentifier = 0x06,
  Sequence = 0x30,
  IpAddress = 0x40,
  Counter32 = 0x41,
  Gauge32 = 0x42,
  TimeTicks = 0x43,
  Opaque = 0x44,
  Counter64 = 0x46,
}

export enum SNMPError {
  NoError = 0,
  TooBig = 1,
  NoSuchName = 2,
  BadValue = 3,
  ReadOnly = 4,
  GenErr = 5,
}

export class SNMPClient {
  private requestId = 1;

  constructor(private config: SNMPConfig) {}

  async get(oid: string): Promise<SNMPVarBind> {
    const pdu = this.buildGetRequest([oid]);
    const response = await this.sendRequest(pdu);
    return response.varbinds[0];
  }

  async getMultiple(oids: string[]): Promise<SNMPVarBind[]> {
    const pdu = this.buildGetRequest(oids);
    const response = await this.sendRequest(pdu);
    return response.varbinds;
  }

  async getNext(oid: string): Promise<SNMPVarBind> {
    const pdu = this.buildGetNextRequest([oid]);
    const response = await this.sendRequest(pdu);
    return response.varbinds[0];
  }

  async getBulk(
    oid: string,
    options: { maxRepetitions?: number; nonRepeaters?: number } = {}
  ): Promise<SNMPVarBind[]> {
    const pdu = this.buildGetBulkRequest(
      [oid],
      options.nonRepeaters ?? 0,
      options.maxRepetitions ?? 10
    );
    const response = await this.sendRequest(pdu);
    return response.varbinds;
  }

  async walk(oid: string): Promise<SNMPVarBind[]> {
    const results: SNMPVarBind[] = [];
    let currentOid = oid;

    while (true) {
      const varbind = await this.getNext(currentOid);

      if (!varbind.oid.startsWith(oid)) {
        break; // Walked past our subtree
      }

      results.push(varbind);
      currentOid = varbind.oid;

      if (results.length > 1000) {
        throw new Error('Walk limit exceeded');
      }
    }

    return results;
  }

  async set(oid: string, type: SNMPType, value: any): Promise<void> {
    const varbind = { oid, type, value };
    const pdu = this.buildSetRequest([varbind]);
    await this.sendRequest(pdu);
  }

  private buildGetRequest(oids: string[]): Uint8Array {
    const varbinds = oids.map(oid => ({
      oid,
      type: SNMPType.Null,
      value: null,
    }));

    return this.buildPDU(0, varbinds); // GetRequest = 0
  }

  private buildGetNextRequest(oids: string[]): Uint8Array {
    const varbinds = oids.map(oid => ({
      oid,
      type: SNMPType.Null,
      value: null,
    }));

    return this.buildPDU(1, varbinds); // GetNextRequest = 1
  }

  private buildGetBulkRequest(
    oids: string[],
    nonRepeaters: number,
    maxRepetitions: number
  ): Uint8Array {
    const varbinds = oids.map(oid => ({
      oid,
      type: SNMPType.Null,
      value: null,
    }));

    return this.buildBulkPDU(nonRepeaters, maxRepetitions, varbinds);
  }

  private buildSetRequest(varbinds: SNMPVarBind[]): Uint8Array {
    return this.buildPDU(3, varbinds); // SetRequest = 3
  }

  private buildPDU(type: number, varbinds: SNMPVarBind[]): Uint8Array {
    const requestId = this.requestId++;

    // Encode varbinds
    const encodedVarbinds = varbinds.map(vb => this.encodeVarBind(vb));
    const varbindList = this.encodeSequence(this.concatenate(encodedVarbinds));

    // Encode PDU
    const pdu = this.concatenate([
      this.encodeInteger(requestId),
      this.encodeInteger(0), // error-status
      this.encodeInteger(0), // error-index
      varbindList,
    ]);

    const pduEncoded = this.encodeTLV(0xa0 + type, pdu);

    // Encode message
    const version = (this.config.version ?? 2) - 1; // 0 = v1, 1 = v2c
    const community = this.config.community ?? 'public';

    const message = this.encodeSequence(
      this.concatenate([
        this.encodeInteger(version),
        this.encodeOctetString(community),
        pduEncoded,
      ])
    );

    return message;
  }

  private buildBulkPDU(
    nonRepeaters: number,
    maxRepetitions: number,
    varbinds: SNMPVarBind[]
  ): Uint8Array {
    const requestId = this.requestId++;

    const encodedVarbinds = varbinds.map(vb => this.encodeVarBind(vb));
    const varbindList = this.encodeSequence(this.concatenate(encodedVarbinds));

    const pdu = this.concatenate([
      this.encodeInteger(requestId),
      this.encodeInteger(nonRepeaters),
      this.encodeInteger(maxRepetitions),
      varbindList,
    ]);

    const pduEncoded = this.encodeTLV(0xa5, pdu); // GetBulkRequest = 0xa5

    const version = 1; // SNMPv2c
    const community = this.config.community ?? 'public';

    const message = this.encodeSequence(
      this.concatenate([
        this.encodeInteger(version),
        this.encodeOctetString(community),
        pduEncoded,
      ])
    );

    return message;
  }

  private encodeVarBind(vb: SNMPVarBind): Uint8Array {
    return this.encodeSequence(
      this.concatenate([
        this.encodeOID(vb.oid),
        this.encodeValue(vb.type, vb.value),
      ])
    );
  }

  private encodeValue(type: SNMPType, value: any): Uint8Array {
    switch (type) {
      case SNMPType.Integer:
      case SNMPType.Counter32:
      case SNMPType.Gauge32:
      case SNMPType.TimeTicks:
        return this.encodeInteger(value);
      case SNMPType.OctetString:
        return this.encodeOctetString(value);
      case SNMPType.ObjectIdentifier:
        return this.encodeOID(value);
      case SNMPType.IpAddress:
        return this.encodeIpAddress(value);
      case SNMPType.Null:
        return this.encodeNull();
      default:
        return this.encodeNull();
    }
  }

  private encodeInteger(value: number): Uint8Array {
    const bytes: number[] = [];
    let v = value;

    if (v === 0) {
      bytes.push(0);
    } else {
      while (v > 0) {
        bytes.unshift(v & 0xff);
        v >>= 8;
      }
    }

    return this.encodeTLV(0x02, new Uint8Array(bytes));
  }

  private encodeOctetString(value: string): Uint8Array {
    const encoder = new TextEncoder();
    return this.encodeTLV(0x04, encoder.encode(value));
  }

  private encodeNull(): Uint8Array {
    return new Uint8Array([0x05, 0x00]);
  }

  private encodeOID(oid: string): Uint8Array {
    const parts = oid.split('.').map(Number);
    const bytes: number[] = [];

    // First two parts are encoded as (first * 40 + second)
    if (parts.length >= 2) {
      bytes.push(parts[0] * 40 + parts[1]);
    }

    // Remaining parts use base-128 encoding
    for (let i = 2; i < parts.length; i++) {
      let value = parts[i];
      const encoded: number[] = [];

      if (value === 0) {
        encoded.push(0);
      } else {
        while (value > 0) {
          encoded.unshift((value & 0x7f) | (encoded.length > 0 ? 0x80 : 0));
          value >>= 7;
        }
      }

      bytes.push(...encoded);
    }

    return this.encodeTLV(0x06, new Uint8Array(bytes));
  }

  private encodeIpAddress(ip: string): Uint8Array {
    const parts = ip.split('.').map(Number);
    return this.encodeTLV(0x40, new Uint8Array(parts));
  }

  private encodeSequence(data: Uint8Array): Uint8Array {
    return this.encodeTLV(0x30, data);
  }

  private encodeTLV(tag: number, value: Uint8Array): Uint8Array {
    const length = value.length;
    let lengthBytes: number[];

    if (length < 128) {
      lengthBytes = [length];
    } else {
      lengthBytes = [];
      let l = length;
      while (l > 0) {
        lengthBytes.unshift(l & 0xff);
        l >>= 8;
      }
      lengthBytes.unshift(0x80 | lengthBytes.length);
    }

    const result = new Uint8Array(1 + lengthBytes.length + length);
    result[0] = tag;
    result.set(lengthBytes, 1);
    result.set(value, 1 + lengthBytes.length);

    return result;
  }

  private concatenate(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }

    return result;
  }

  private async sendRequest(pdu: Uint8Array): Promise<{ varbinds: SNMPVarBind[] }> {
    // This would require UDP proxy in real implementation
    throw new Error('SNMP requires UDP proxy');
  }

  private parseResponse(data: Uint8Array): { varbinds: SNMPVarBind[] } {
    // Parse ASN.1/BER response
    // Implementation would decode message → PDU → varbinds
    return { varbinds: [] };
  }

  // Utility: Format OID with name
  static formatOID(oid: string): string {
    const names: Record<string, string> = {
      '1.3.6.1.2.1.1.1.0': 'sysDescr',
      '1.3.6.1.2.1.1.3.0': 'sysUpTime',
      '1.3.6.1.2.1.1.4.0': 'sysContact',
      '1.3.6.1.2.1.1.5.0': 'sysName',
      '1.3.6.1.2.1.1.6.0': 'sysLocation',
    };

    return names[oid] || oid;
  }
}

// Common MIB queries

export const CommonOIDs = {
  system: {
    sysDescr: '1.3.6.1.2.1.1.1.0',
    sysUpTime: '1.3.6.1.2.1.1.3.0',
    sysContact: '1.3.6.1.2.1.1.4.0',
    sysName: '1.3.6.1.2.1.1.5.0',
    sysLocation: '1.3.6.1.2.1.1.6.0',
  },
  interfaces: {
    ifNumber: '1.3.6.1.2.1.2.1.0',
    ifTable: '1.3.6.1.2.1.2.2',
    ifDescr: '1.3.6.1.2.1.2.2.1.2',
    ifSpeed: '1.3.6.1.2.1.2.2.1.5',
    ifInOctets: '1.3.6.1.2.1.2.2.1.10',
    ifOutOctets: '1.3.6.1.2.1.2.2.1.16',
  },
  tcp: {
    tcpCurrEstab: '1.3.6.1.2.1.6.9.0',
    tcpConnTable: '1.3.6.1.2.1.6.13',
  },
  udp: {
    udpInDatagrams: '1.3.6.1.2.1.7.1.0',
    udpOutDatagrams: '1.3.6.1.2.1.7.4.0',
  },
};
```

## Web UI Design

```typescript
// src/components/SNMPClient.tsx

export function SNMPClient() {
  const [host, setHost] = useState('192.168.1.1');
  const [port, setPort] = useState(161);
  const [community, setCommunity] = useState('public');
  const [oid, setOid] = useState('1.3.6.1.2.1.1.1.0');
  const [result, setResult] = useState<SNMPVarBind | null>(null);
  const [walkResults, setWalkResults] = useState<SNMPVarBind[]>([]);

  const queryOID = async () => {
    const response = await fetch('/api/snmp/get', {
      method: 'POST',
      body: JSON.stringify({ host, port, community, oid }),
    });

    const data = await response.json();
    setResult(data);
  };

  const walkOID = async () => {
    const response = await fetch('/api/snmp/walk', {
      method: 'POST',
      body: JSON.stringify({ host, port, community, oid }),
    });

    const data = await response.json();
    setWalkResults(data);
  };

  const quickQueries = [
    { label: 'System Description', oid: CommonOIDs.system.sysDescr },
    { label: 'System Uptime', oid: CommonOIDs.system.sysUpTime },
    { label: 'System Name', oid: CommonOIDs.system.sysName },
    { label: 'Interface Table', oid: CommonOIDs.interfaces.ifTable },
  ];

  return (
    <div className="snmp-client">
      <h2>SNMP Network Manager</h2>

      <div className="config">
        <input
          type="text"
          placeholder="Device IP/Host"
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
          placeholder="Community String"
          value={community}
          onChange={(e) => setCommunity(e.target.value)}
        />
      </div>

      <div className="query">
        <input
          type="text"
          placeholder="OID (e.g., 1.3.6.1.2.1.1.1.0)"
          value={oid}
          onChange={(e) => setOid(e.target.value)}
        />
        <button onClick={queryOID}>GET</button>
        <button onClick={walkOID}>WALK</button>
      </div>

      <div className="quick-queries">
        <h3>Quick Queries</h3>
        {quickQueries.map(q => (
          <button
            key={q.oid}
            onClick={() => {
              setOid(q.oid);
              queryOID();
            }}
          >
            {q.label}
          </button>
        ))}
      </div>

      {result && (
        <div className="result">
          <h3>Result</h3>
          <table>
            <tbody>
              <tr>
                <td>OID:</td>
                <td>{result.oid}</td>
              </tr>
              <tr>
                <td>Type:</td>
                <td>{SNMPType[result.type]}</td>
              </tr>
              <tr>
                <td>Value:</td>
                <td>{result.value}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {walkResults.length > 0 && (
        <div className="walk-results">
          <h3>Walk Results ({walkResults.length})</h3>
          <table>
            <thead>
              <tr>
                <th>OID</th>
                <th>Type</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {walkResults.map((vb, i) => (
                <tr key={i}>
                  <td>{vb.oid}</td>
                  <td>{SNMPType[vb.type]}</td>
                  <td>{vb.value}</td>
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

### SNMPv3 Authentication

```typescript
// SNMPv3 adds authentication and encryption
const config = {
  host: '192.168.1.1',
  port: 161,
  version: 3,
  username: 'admin',
  authProtocol: 'SHA',
  authPassword: 'authpass',
  privProtocol: 'AES',
  privPassword: 'privpass',
};
```

### Community Strings

```bash
# Use strong community strings
read_community: "complex-read-string-123"
write_community: "complex-write-string-456"

# Restrict by IP
access read public 192.168.1.0/24
```

## Testing

### snmpget

```bash
# Get single OID
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# Get multiple OIDs
snmpget -v2c -c public 192.168.1.1 \
  1.3.6.1.2.1.1.1.0 \
  1.3.6.1.2.1.1.5.0
```

### snmpwalk

```bash
# Walk entire MIB tree
snmpwalk -v2c -c public 192.168.1.1

# Walk system subtree
snmpwalk -v2c -c public 192.168.1.1 1.3.6.1.2.1.1
```

### snmpset

```bash
# Set system contact
snmpset -v2c -c private 192.168.1.1 \
  1.3.6.1.2.1.1.4.0 s "admin@example.com"
```

### Docker SNMP Simulator

```bash
# SNMP simulator
docker run -d \
  -p 161:161/udp \
  --name snmp-simulator \
  tandrup/snmpsim

# Query simulator
snmpwalk -v2c -c public localhost
```

## Resources

- **RFC 3411-3418**: [SNMPv3](https://tools.ietf.org/html/rfc3411)
- **Net-SNMP**: [Command-line tools](http://www.net-snmp.org/)
- **MIB Browser**: [iReasoning MIB Browser](https://www.ireasoning.com/)

## Common Use Cases

### Monitor Network Bandwidth

```typescript
const ifInOctets1 = await client.get('1.3.6.1.2.1.2.2.1.10.1');
await sleep(1000);
const ifInOctets2 = await client.get('1.3.6.1.2.1.2.2.1.10.1');

const bytesPerSecond = (ifInOctets2.value - ifInOctets1.value) / 1;
const mbps = (bytesPerSecond * 8) / 1_000_000;
```

### Monitor Server Uptime

```typescript
const uptime = await client.get('1.3.6.1.2.1.1.3.0');
const seconds = uptime.value / 100; // TimeTicks to seconds
const days = Math.floor(seconds / 86400);
```

### Inventory Network Devices

```typescript
const devices = await client.walk('1.3.6.1.2.1.1');
// Collect sysDescr, sysName, sysLocation for all devices
```

## Notes

- **UDP-based** - requires proxy for Workers
- **ASN.1/BER encoding** - complex binary format
- **MIB files** define OID structure and meaning
- **SNMPv1/v2c** use community strings (insecure)
- **SNMPv3** adds authentication and encryption
- **Widely supported** by network devices
- **Polling-based** - agent doesn't push updates (except traps)
- **WALK** operation retrieves entire subtrees
- Use **GetBulk** for efficient bulk retrieval
