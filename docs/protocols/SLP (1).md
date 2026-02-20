# SLP Protocol Implementation Plan

## Overview

**Protocol:** SLP (Service Location Protocol)
**Port:** 427 (UDP/TCP)
**RFC:** [RFC 2608](https://tools.ietf.org/html/rfc2608)
**Complexity:** Medium
**Purpose:** Service discovery

SLP provides **automatic service discovery** - enables clients to discover services on a network without prior configuration, with support for service attributes, scopes, and multicast discovery.

### Use Cases
- Network service discovery
- Printer discovery
- Zero-configuration networking
- Device discovery (cameras, sensors, appliances)
- Dynamic service location
- Enterprise network automation

## Protocol Specification

### SLP Architecture

```
Three Agent Types:
1. User Agent (UA) - Client seeking services
2. Service Agent (SA) - Advertises services
3. Directory Agent (DA) - Optional service directory
```

### Message Types

```
1  - Service Request (SrvRqst)
2  - Service Reply (SrvRply)
3  - Service Registration (SrvReg)
4  - Service Deregister (SrvDeReg)
5  - Service Acknowledge (SrvAck)
6  - Attribute Request (AttrRqst)
7  - Attribute Reply (AttrRply)
8  - DA Advertisement (DAAdvert)
9  - Service Type Request (SrvTypeRqst)
10 - Service Type Reply (SrvTypeRply)
11 - SA Advertisement (SAAdvert)
```

### Message Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    Version    |  Function-ID  |            Length             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Length, contd.|O|F|R|       reserved          |Next Ext Offset|
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Next Extension Offset, contd.|              XID              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|      Language Tag Length      |         Language Tag          \
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Message-specific data                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Service URL Format

```
service:<service-type>://<addrspec>

Examples:
service:printer:lpr://printer.example.com/queue1
service:http://www.example.com:8080
service:ftp://ftp.example.com
```

### Service Request

```
<Previous Responder List Length>
<Previous Responder List>
<Service Type Length>
<Service Type>
<Scope List Length>
<Scope List>
<Predicate Length>
<Predicate>
<SLP SPI Length>
<SLP SPI>
```

### Service Reply

```
<Error Code>
<URL Entry Count>
For each URL Entry:
  <Reserved>
  <Lifetime>
  <URL Length>
  <URL>
  <# of URL auths>
  <URL authentication blocks>
```

## Worker Implementation

```typescript
// src/worker/protocols/slp/client.ts

import { connect } from 'cloudflare:sockets';

export interface SLPConfig {
  host?: string;
  port?: number;
  multicast?: boolean;
  scope?: string;
  language?: string;
}

// SLP Message Types
export enum SLPFunction {
  SrvRqst = 1,
  SrvRply = 2,
  SrvReg = 3,
  SrvDeReg = 4,
  SrvAck = 5,
  AttrRqst = 6,
  AttrRply = 7,
  DAAdvert = 8,
  SrvTypeRqst = 9,
  SrvTypeRply = 10,
  SAAdvert = 11,
}

// Error Codes
export enum SLPError {
  OK = 0,
  LanguageNotSupported = 1,
  ParseError = 2,
  InvalidRegistration = 3,
  ScopeNotSupported = 4,
  AuthenticationUnknown = 5,
  AuthenticationAbsent = 6,
  AuthenticationFailed = 7,
  VersionNotSupported = 9,
  InternalError = 10,
  DABusy = 11,
  OptionNotUnderstood = 12,
  InvalidUpdate = 13,
  RefreshRejected = 15,
}

export interface SLPService {
  url: string;
  lifetime: number;
  attributes?: Record<string, string>;
}

export class SLPClient {
  private socket: any;
  private xid: number = 1;
  private version: number = 2; // SLP version 2

  constructor(private config: SLPConfig) {
    if (!config.port) config.port = 427;
    if (!config.scope) config.scope = 'DEFAULT';
    if (!config.language) config.language = 'en';
  }

  async connect(): Promise<void> {
    if (!this.config.host) {
      throw new Error('Host required for TCP SLP');
    }

    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;
  }

  async findServices(serviceType: string, predicate?: string): Promise<SLPService[]> {
    // Build Service Request
    const request = this.buildServiceRequest(serviceType, predicate);

    // Send request
    await this.send(request);

    // Receive Service Reply
    const response = await this.receive();

    return this.parseServiceReply(response);
  }

  async findServiceTypes(namingAuthority: string = '*'): Promise<string[]> {
    // Build Service Type Request
    const request = this.buildServiceTypeRequest(namingAuthority);

    // Send request
    await this.send(request);

    // Receive Service Type Reply
    const response = await this.receive();

    return this.parseServiceTypeReply(response);
  }

  async getAttributes(url: string, attributeTags?: string[]): Promise<Record<string, string>> {
    // Build Attribute Request
    const request = this.buildAttributeRequest(url, attributeTags);

    // Send request
    await this.send(request);

    // Receive Attribute Reply
    const response = await this.receive();

    return this.parseAttributeReply(response);
  }

  private buildServiceRequest(serviceType: string, predicate?: string): Uint8Array {
    const buffer: number[] = [];

    // Header
    this.writeHeader(buffer, SLPFunction.SrvRqst);

    // Previous Responder List (empty)
    this.writeString(buffer, '');

    // Service Type
    this.writeString(buffer, serviceType);

    // Scope List
    this.writeString(buffer, this.config.scope!);

    // Predicate (LDAP filter)
    this.writeString(buffer, predicate || '');

    // SLP SPI (empty)
    this.writeString(buffer, '');

    return this.finalizeMessage(buffer);
  }

  private parseServiceReply(data: Uint8Array): SLPService[] {
    let offset = this.skipHeader(data);

    // Error code
    const errorCode = new DataView(data.buffer).getUint16(offset, false);
    offset += 2;

    if (errorCode !== SLPError.OK) {
      throw new Error(`SLP error: ${errorCode}`);
    }

    // URL Entry Count
    const count = new DataView(data.buffer).getUint16(offset, false);
    offset += 2;

    const services: SLPService[] = [];

    for (let i = 0; i < count; i++) {
      // Reserved
      offset += 1;

      // Lifetime
      const lifetime = new DataView(data.buffer).getUint16(offset, false);
      offset += 2;

      // URL Length
      const urlLength = new DataView(data.buffer).getUint16(offset, false);
      offset += 2;

      // URL
      const url = new TextDecoder().decode(data.slice(offset, offset + urlLength));
      offset += urlLength;

      // # of URL auths
      const authCount = data[offset++];

      // Skip authentication blocks
      for (let j = 0; j < authCount; j++) {
        const authLength = new DataView(data.buffer).getUint16(offset, false);
        offset += 2 + authLength;
      }

      services.push({ url, lifetime });
    }

    return services;
  }

  private buildServiceTypeRequest(namingAuthority: string): Uint8Array {
    const buffer: number[] = [];

    // Header
    this.writeHeader(buffer, SLPFunction.SrvTypeRqst);

    // Previous Responder List (empty)
    this.writeString(buffer, '');

    // Naming Authority (* for all)
    this.writeString(buffer, namingAuthority);

    // Scope List
    this.writeString(buffer, this.config.scope!);

    return this.finalizeMessage(buffer);
  }

  private parseServiceTypeReply(data: Uint8Array): string[] {
    let offset = this.skipHeader(data);

    // Error code
    const errorCode = new DataView(data.buffer).getUint16(offset, false);
    offset += 2;

    if (errorCode !== SLPError.OK) {
      throw new Error(`SLP error: ${errorCode}`);
    }

    // Service Type List Length
    const listLength = new DataView(data.buffer).getUint16(offset, false);
    offset += 2;

    // Service Type List (comma-separated)
    const listStr = new TextDecoder().decode(data.slice(offset, offset + listLength));

    return listStr.split(',').filter(s => s.length > 0);
  }

  private buildAttributeRequest(url: string, tags?: string[]): Uint8Array {
    const buffer: number[] = [];

    // Header
    this.writeHeader(buffer, SLPFunction.AttrRqst);

    // Previous Responder List (empty)
    this.writeString(buffer, '');

    // URL
    this.writeString(buffer, url);

    // Scope List
    this.writeString(buffer, this.config.scope!);

    // Tag List
    this.writeString(buffer, tags ? tags.join(',') : '');

    // SLP SPI
    this.writeString(buffer, '');

    return this.finalizeMessage(buffer);
  }

  private parseAttributeReply(data: Uint8Array): Record<string, string> {
    let offset = this.skipHeader(data);

    // Error code
    const errorCode = new DataView(data.buffer).getUint16(offset, false);
    offset += 2;

    if (errorCode !== SLPError.OK) {
      throw new Error(`SLP error: ${errorCode}`);
    }

    // Attribute List Length
    const listLength = new DataView(data.buffer).getUint16(offset, false);
    offset += 2;

    // Attribute List
    const listStr = new TextDecoder().decode(data.slice(offset, offset + listLength));

    // Parse attributes (tag=value, tag=value)
    const attributes: Record<string, string> = {};

    const pairs = listStr.split(',');
    for (const pair of pairs) {
      const [tag, value] = pair.split('=');
      if (tag && value) {
        attributes[tag.trim()] = value.trim();
      }
    }

    return attributes;
  }

  private writeHeader(buffer: number[], functionId: SLPFunction): void {
    // Version
    buffer.push(this.version);

    // Function ID
    buffer.push(functionId);

    // Length (placeholder, will update)
    buffer.push(0, 0, 0);

    // Flags (O=0, F=0, R=0)
    buffer.push(0, 0, 0);

    // Next Extension Offset
    buffer.push(0, 0, 0);

    // XID
    buffer.push((this.xid >> 8) & 0xFF, this.xid & 0xFF);
    this.xid++;

    // Language Tag
    const lang = this.config.language!;
    buffer.push(0, lang.length);
    for (let i = 0; i < lang.length; i++) {
      buffer.push(lang.charCodeAt(i));
    }
  }

  private writeString(buffer: number[], str: string): void {
    const bytes = new TextEncoder().encode(str);
    buffer.push((bytes.length >> 8) & 0xFF, bytes.length & 0xFF);
    for (const byte of bytes) {
      buffer.push(byte);
    }
  }

  private finalizeMessage(buffer: number[]): Uint8Array {
    // Update length field
    const length = buffer.length;
    buffer[2] = (length >> 16) & 0xFF;
    buffer[3] = (length >> 8) & 0xFF;
    buffer[4] = length & 0xFF;

    return new Uint8Array(buffer);
  }

  private skipHeader(data: Uint8Array): number {
    // Skip version, function, length, flags, offset, XID
    let offset = 14;

    // Skip language tag
    const langLength = new DataView(data.buffer).getUint16(offset, false);
    offset += 2 + langLength;

    return offset;
  }

  private async send(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async receive(): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();

    // Read header to get length
    const headerBuf = new Uint8Array(5);
    let offset = 0;

    while (offset < 5) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = 5 - offset;
      const toCopy = Math.min(remaining, value.length);
      headerBuf.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    // Parse length
    const length = (headerBuf[2] << 16) | (headerBuf[3] << 8) | headerBuf[4];

    // Read rest of message
    const messageBuf = new Uint8Array(length);
    messageBuf.set(headerBuf, 0);
    offset = 5;

    while (offset < length) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = length - offset;
      const toCopy = Math.min(remaining, value.length);
      messageBuf.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    reader.releaseLock();
    return messageBuf;
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/SLPClient.tsx

export function SLPClient() {
  const [host, setHost] = useState('');
  const [serviceType, setServiceType] = useState('service:printer:lpr');
  const [services, setServices] = useState<any[]>([]);
  const [serviceTypes, setServiceTypes] = useState<string[]>([]);

  const findServices = async () => {
    const response = await fetch('/api/slp/find', {
      method: 'POST',
      body: JSON.stringify({ host, serviceType }),
    });

    const data = await response.json();
    setServices(data.services);
  };

  const findServiceTypes = async () => {
    const response = await fetch('/api/slp/types', {
      method: 'POST',
      body: JSON.stringify({ host }),
    });

    const data = await response.json();
    setServiceTypes(data.types);
  };

  return (
    <div className="slp-client">
      <h2>SLP (Service Location Protocol)</h2>

      <div className="config">
        <input
          placeholder="SLP Server (or DA)"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
      </div>

      <div className="discovery">
        <h3>Service Discovery</h3>
        <button onClick={findServiceTypes}>Find Service Types</button>

        {serviceTypes.length > 0 && (
          <ul>
            {serviceTypes.map((type, i) => (
              <li key={i} onClick={() => setServiceType(type)}>
                {type}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="search">
        <h3>Find Services</h3>
        <input
          placeholder="Service Type"
          value={serviceType}
          onChange={(e) => setServiceType(e.target.value)}
        />
        <button onClick={findServices}>Find</button>

        {services.length > 0 && (
          <div className="services">
            {services.map((service, i) => (
              <div key={i} className="service">
                <strong>{service.url}</strong>
                <div>Lifetime: {service.lifetime}s</div>
                {service.attributes && (
                  <pre>{JSON.stringify(service.attributes, null, 2)}</pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="info">
        <h3>About SLP</h3>
        <ul>
          <li>Service Location Protocol (RFC 2608)</li>
          <li>Automatic service discovery</li>
          <li>Zero-configuration networking</li>
          <li>Port 427 (UDP/TCP)</li>
          <li>Multicast and unicast</li>
          <li>Service attributes and scopes</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### No Built-in Encryption

```bash
# SLP has no encryption
# Use VPN or secure network
```

### Service Authentication

```bash
# SLP supports digital signatures for service advertisements
# Prevents rogue services
```

## Testing

```bash
# Install OpenSLP
apt-get install openslp-server slptool

# Start SLP daemon
slpd

# Register a service
slptool register service:printer:lpr://192.168.1.100/queue1

# Find services
slptool findsrvs service:printer

# Find service types
slptool findsrvtypes

# Get attributes
slptool findattrs service:printer:lpr://192.168.1.100/queue1
```

## Resources

- **RFC 2608**: [SLP Protocol](https://tools.ietf.org/html/rfc2608)
- **OpenSLP**: [Open source implementation](http://www.openslp.org/)
- **Apple Bonjour**: [Alternative (mDNS/DNS-SD)](https://developer.apple.com/bonjour/)

## Common Service Types

```
service:printer:lpr - LPR printers
service:http - HTTP servers
service:ftp - FTP servers
service:tftp - TFTP servers
service:nfs - NFS file systems
service:smb - SMB/CIFS file shares
service:ipp - Internet Printing Protocol
```

## Notes

- **Service discovery** - Automatic, no manual configuration
- **Port 427** - UDP for multicast, TCP for unicast
- **Scopes** - Logical grouping of services
- **Attributes** - Key-value pairs describing services
- **Directory Agent** - Optional centralized directory
- **Multicast** - 239.255.255.253 for service discovery
- **Lifetime** - Services advertise with TTL
- **Predicate** - LDAP filter for service queries
- **Zero-config** - Plug and play networking
- **Replaced by** - mDNS/DNS-SD (Bonjour) in many cases
- **Still used** - Enterprise networks, embedded devices
