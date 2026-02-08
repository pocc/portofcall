# BGP Protocol Implementation Plan

## Overview

**Protocol:** BGP (Border Gateway Protocol)
**Port:** 179 (TCP)
**RFC:** [RFC 4271](https://tools.ietf.org/html/rfc4271)
**Complexity:** Very High
**Purpose:** Internet routing protocol

BGP provides **path-vector routing** - the protocol that makes the Internet work, exchanging routing information between autonomous systems (AS), with policy-based routing and path selection.

### Use Cases
- Internet backbone routing
- ISP peering
- Multi-homed networks
- Route filtering and policy
- Traffic engineering
- Network monitoring and analysis

## Protocol Specification

### Connection Establishment

```
1. TCP connection to port 179
2. OPEN message exchange
3. KEEPALIVE message exchange
4. UPDATE messages (route advertisements)
5. Periodic KEEPALIVE
6. NOTIFICATION (on error)
```

### Message Types

```
1 - OPEN
2 - UPDATE
3 - NOTIFICATION
4 - KEEPALIVE
```

### Message Format

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                          Marker (16 bytes)                    +
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Length               |      Type     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### OPEN Message

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    Version    |     My AS     |           Hold Time           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         BGP Identifier                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Opt Parm Len  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|             Optional Parameters (variable)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### UPDATE Message

```
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Unfeasible Routes Length (2 octets)                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Withdrawn Routes (variable)                                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Total Path Attribute Length (2 octets)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Path Attributes (variable)                                  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   Network Layer Reachability Information (variable)           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Path Attributes

```
1 - ORIGIN
2 - AS_PATH
3 - NEXT_HOP
4 - MULTI_EXIT_DISC
5 - LOCAL_PREF
6 - ATOMIC_AGGREGATE
7 - AGGREGATOR
8 - COMMUNITY
9 - ORIGINATOR_ID
10 - CLUSTER_LIST
14 - MP_REACH_NLRI (Multiprotocol)
15 - MP_UNREACH_NLRI (Multiprotocol)
```

## Worker Implementation

```typescript
// src/worker/protocols/bgp/client.ts

import { connect } from 'cloudflare:sockets';

export interface BGPConfig {
  host: string;
  port?: number;
  localAS: number;
  remoteAS: number;
  routerId: string; // IP address format
  holdTime?: number;
}

// Message Types
export enum MessageType {
  OPEN = 1,
  UPDATE = 2,
  NOTIFICATION = 3,
  KEEPALIVE = 4,
}

// BGP States
export enum BGPState {
  Idle = 0,
  Connect = 1,
  Active = 2,
  OpenSent = 3,
  OpenConfirm = 4,
  Established = 5,
}

// Path Attribute Types
export enum PathAttributeType {
  ORIGIN = 1,
  AS_PATH = 2,
  NEXT_HOP = 3,
  MULTI_EXIT_DISC = 4,
  LOCAL_PREF = 5,
  ATOMIC_AGGREGATE = 6,
  AGGREGATOR = 7,
  COMMUNITY = 8,
}

export interface BGPRoute {
  prefix: string;
  prefixLength: number;
  asPath: number[];
  nextHop: string;
  origin?: number;
  localPref?: number;
  med?: number;
  communities?: number[];
}

export class BGPClient {
  private socket: any;
  private state: BGPState = BGPState.Idle;
  private routes: BGPRoute[] = [];
  private keepaliveTimer?: any;

  constructor(private config: BGPConfig) {
    if (!config.port) config.port = 179;
    if (!config.holdTime) config.holdTime = 180;
  }

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;

    this.state = BGPState.Connect;

    // Send OPEN message
    await this.sendOpen();
    this.state = BGPState.OpenSent;

    // Start message loop
    this.messageLoop();
  }

  private async sendOpen(): Promise<void> {
    const buffer = new ArrayBuffer(29); // Minimum OPEN size
    const view = new DataView(buffer);
    let offset = 0;

    // Marker (16 bytes of 0xFF)
    for (let i = 0; i < 16; i++) {
      view.setUint8(offset++, 0xFF);
    }

    // Length
    view.setUint16(offset, 29, false);
    offset += 2;

    // Type (OPEN)
    view.setUint8(offset++, MessageType.OPEN);

    // Version
    view.setUint8(offset++, 4); // BGP-4

    // My Autonomous System
    view.setUint16(offset, this.config.localAS, false);
    offset += 2;

    // Hold Time
    view.setUint16(offset, this.config.holdTime!, false);
    offset += 2;

    // BGP Identifier (Router ID as IP)
    const routerIdParts = this.config.routerId.split('.').map(Number);
    for (const part of routerIdParts) {
      view.setUint8(offset++, part);
    }

    // Optional Parameters Length
    view.setUint8(offset++, 0);

    await this.send(new Uint8Array(buffer));
  }

  private async sendKeepalive(): Promise<void> {
    const buffer = new ArrayBuffer(19);
    const view = new DataView(buffer);
    let offset = 0;

    // Marker
    for (let i = 0; i < 16; i++) {
      view.setUint8(offset++, 0xFF);
    }

    // Length
    view.setUint16(offset, 19, false);
    offset += 2;

    // Type (KEEPALIVE)
    view.setUint8(offset++, MessageType.KEEPALIVE);

    await this.send(new Uint8Array(buffer));
  }

  private async messageLoop(): Promise<void> {
    while (true) {
      try {
        const message = await this.receiveMessage();
        await this.handleMessage(message);
      } catch (error) {
        console.error('BGP error:', error);
        break;
      }
    }
  }

  private async handleMessage(message: Uint8Array): Promise<void> {
    const type = message[18] as MessageType;

    switch (type) {
      case MessageType.OPEN:
        await this.handleOpen(message);
        break;

      case MessageType.UPDATE:
        await this.handleUpdate(message);
        break;

      case MessageType.KEEPALIVE:
        await this.handleKeepalive();
        break;

      case MessageType.NOTIFICATION:
        await this.handleNotification(message);
        break;
    }
  }

  private async handleOpen(message: Uint8Array): Promise<void> {
    const view = new DataView(message.buffer);

    const version = view.getUint8(19);
    const remoteAS = view.getUint16(20, false);
    const holdTime = view.getUint16(22, false);

    // Extract Router ID
    const routerId = `${view.getUint8(24)}.${view.getUint8(25)}.${view.getUint8(26)}.${view.getUint8(27)}`;

    console.log(`BGP OPEN from AS${remoteAS}, Router ID: ${routerId}`);

    if (this.state === BGPState.OpenSent) {
      // Send KEEPALIVE to confirm
      await this.sendKeepalive();
      this.state = BGPState.OpenConfirm;
    } else if (this.state === BGPState.OpenConfirm) {
      this.state = BGPState.Established;
      this.startKeepaliveTimer();
      console.log('BGP session established');
    }
  }

  private async handleUpdate(message: Uint8Array): Promise<void> {
    const view = new DataView(message.buffer);
    let offset = 19; // Skip header

    // Withdrawn Routes Length
    const withdrawnLength = view.getUint16(offset, false);
    offset += 2;

    // Skip withdrawn routes
    offset += withdrawnLength;

    // Total Path Attribute Length
    const pathAttrLength = view.getUint16(offset, false);
    offset += 2;

    // Parse Path Attributes
    const attributes = this.parsePathAttributes(message.slice(offset, offset + pathAttrLength));
    offset += pathAttrLength;

    // Parse NLRI (Network Layer Reachability Information)
    const nlri = this.parseNLRI(message.slice(offset));

    // Add routes
    for (const prefix of nlri) {
      this.routes.push({
        prefix: prefix.prefix,
        prefixLength: prefix.length,
        asPath: attributes.asPath || [],
        nextHop: attributes.nextHop || '',
        origin: attributes.origin,
        localPref: attributes.localPref,
        med: attributes.med,
        communities: attributes.communities,
      });
    }

    console.log(`Received ${nlri.length} route(s)`);
  }

  private parsePathAttributes(data: Uint8Array): {
    origin?: number;
    asPath?: number[];
    nextHop?: string;
    med?: number;
    localPref?: number;
    communities?: number[];
  } {
    const attributes: any = {};
    const view = new DataView(data.buffer);
    let offset = 0;

    while (offset < data.length) {
      const flags = view.getUint8(offset++);
      const typeCode = view.getUint8(offset++) as PathAttributeType;

      let length: number;
      if (flags & 0x10) { // Extended Length
        length = view.getUint16(offset, false);
        offset += 2;
      } else {
        length = view.getUint8(offset++);
      }

      const value = data.slice(offset, offset + length);
      offset += length;

      switch (typeCode) {
        case PathAttributeType.ORIGIN:
          attributes.origin = value[0];
          break;

        case PathAttributeType.AS_PATH:
          attributes.asPath = this.parseASPath(value);
          break;

        case PathAttributeType.NEXT_HOP:
          attributes.nextHop = `${value[0]}.${value[1]}.${value[2]}.${value[3]}`;
          break;

        case PathAttributeType.MULTI_EXIT_DISC:
          attributes.med = new DataView(value.buffer).getUint32(0, false);
          break;

        case PathAttributeType.LOCAL_PREF:
          attributes.localPref = new DataView(value.buffer).getUint32(0, false);
          break;

        case PathAttributeType.COMMUNITY:
          attributes.communities = this.parseCommunities(value);
          break;
      }
    }

    return attributes;
  }

  private parseASPath(data: Uint8Array): number[] {
    const asPath: number[] = [];
    const view = new DataView(data.buffer);
    let offset = 0;

    while (offset < data.length) {
      const segmentType = view.getUint8(offset++);
      const segmentLength = view.getUint8(offset++);

      for (let i = 0; i < segmentLength; i++) {
        const asn = view.getUint16(offset, false);
        offset += 2;
        asPath.push(asn);
      }
    }

    return asPath;
  }

  private parseCommunities(data: Uint8Array): number[] {
    const communities: number[] = [];
    const view = new DataView(data.buffer);

    for (let i = 0; i < data.length; i += 4) {
      const community = view.getUint32(i, false);
      communities.push(community);
    }

    return communities;
  }

  private parseNLRI(data: Uint8Array): Array<{ prefix: string; length: number }> {
    const nlri: Array<{ prefix: string; length: number }> = [];
    let offset = 0;

    while (offset < data.length) {
      const prefixLength = data[offset++];
      const byteLength = Math.ceil(prefixLength / 8);

      const prefixBytes = new Uint8Array(4);
      prefixBytes.set(data.slice(offset, offset + byteLength), 0);
      offset += byteLength;

      const prefix = `${prefixBytes[0]}.${prefixBytes[1]}.${prefixBytes[2]}.${prefixBytes[3]}`;

      nlri.push({ prefix, length: prefixLength });
    }

    return nlri;
  }

  private async handleKeepalive(): Promise<void> {
    if (this.state === BGPState.OpenConfirm) {
      this.state = BGPState.Established;
      this.startKeepaliveTimer();
      console.log('BGP session established');
    }

    // Reset keepalive timer
    this.resetKeepaliveTimer();
  }

  private async handleNotification(message: Uint8Array): Promise<void> {
    const view = new DataView(message.buffer);
    const errorCode = view.getUint8(19);
    const errorSubcode = view.getUint8(20);

    console.error(`BGP NOTIFICATION: Error ${errorCode}.${errorSubcode}`);

    this.state = BGPState.Idle;
  }

  private startKeepaliveTimer(): void {
    const interval = (this.config.holdTime! / 3) * 1000;

    this.keepaliveTimer = setInterval(async () => {
      if (this.state === BGPState.Established) {
        await this.sendKeepalive();
      }
    }, interval);
  }

  private resetKeepaliveTimer(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.startKeepaliveTimer();
    }
  }

  getRoutes(): BGPRoute[] {
    return this.routes;
  }

  getState(): BGPState {
    return this.state;
  }

  private async receiveMessage(): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();

    // Read marker + length (18 bytes)
    const headerBuf = new Uint8Array(18);
    let offset = 0;

    while (offset < 18) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');

      const remaining = 18 - offset;
      const toCopy = Math.min(remaining, value.length);
      headerBuf.set(value.slice(0, toCopy), offset);
      offset += toCopy;
    }

    // Parse length
    const view = new DataView(headerBuf.buffer);
    const length = view.getUint16(16, false);

    // Read rest of message
    const messageBuf = new Uint8Array(length);
    messageBuf.set(headerBuf, 0);
    offset = 18;

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

  private async send(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  async close(): Promise<void> {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
    }

    await this.socket.close();
    this.state = BGPState.Idle;
  }
}
```

## Web UI Design

```typescript
// src/components/BGPClient.tsx

export function BGPClient() {
  const [host, setHost] = useState('');
  const [localAS, setLocalAS] = useState(65000);
  const [remoteAS, setRemoteAS] = useState(65001);
  const [routerId, setRouterId] = useState('192.168.1.1');
  const [state, setState] = useState('Idle');
  const [routes, setRoutes] = useState<any[]>([]);

  const connect = async () => {
    const ws = new WebSocket('/api/bgp/connect');

    ws.onopen = () => {
      ws.send(JSON.stringify({
        host,
        localAS,
        remoteAS,
        routerId,
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'state') {
        setState(data.state);
      } else if (data.type === 'routes') {
        setRoutes(data.routes);
      }
    };
  };

  return (
    <div className="bgp-client">
      <h2>BGP Client</h2>

      <div className="config">
        <input placeholder="BGP Peer Host" value={host} onChange={(e) => setHost(e.target.value)} />
        <input type="number" placeholder="Local AS" value={localAS} onChange={(e) => setLocalAS(Number(e.target.value))} />
        <input type="number" placeholder="Remote AS" value={remoteAS} onChange={(e) => setRemoteAS(Number(e.target.value))} />
        <input placeholder="Router ID" value={routerId} onChange={(e) => setRouterId(e.target.value)} />
        <button onClick={connect}>Connect</button>
      </div>

      <div className="status">
        <h3>BGP State: <span className={state === 'Established' ? 'established' : ''}>{state}</span></h3>
      </div>

      <div className="routes">
        <h3>Received Routes ({routes.length})</h3>
        <table>
          <thead>
            <tr>
              <th>Prefix</th>
              <th>AS Path</th>
              <th>Next Hop</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route, i) => (
              <tr key={i}>
                <td>{route.prefix}/{route.prefixLength}</td>
                <td>{route.asPath.join(' ')}</td>
                <td>{route.nextHop}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="info">
        <h3>About BGP</h3>
        <ul>
          <li>Border Gateway Protocol (RFC 4271)</li>
          <li>Makes the Internet work</li>
          <li>Path-vector routing protocol</li>
          <li>Policy-based routing</li>
          <li>Autonomous System (AS) path</li>
          <li>TCP port 179</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### MD5 Authentication

```typescript
// BGP supports MD5 authentication
// Configured on both peers
```

### Route Filtering

```typescript
// Apply prefix filters, AS path filters, community filters
```

## Testing

```bash
# Test with BIRD or GoBGP

# BIRD configuration
protocol bgp peer1 {
  local as 65000;
  neighbor 192.168.1.2 as 65001;
  ipv4 {
    import all;
    export all;
  };
}

# GoBGP
gobgpd -f gobgpd.conf

# View routes
gobgp global rib
```

## Resources

- **RFC 4271**: [BGP-4](https://tools.ietf.org/html/rfc4271)
- **BIRD**: [BIRD Internet Routing Daemon](https://bird.network.cz/)
- **GoBGP**: [Go BGP implementation](https://osrg.github.io/gobgp/)

## Notes

- **Very complex** - production implementation requires careful design
- **TCP-based** - reliable transport
- **Path-vector** - uses AS path for loop prevention
- **Policy-based** - route filtering, preference
- **Scalability** - handles 800k+ routes
- **Slow convergence** - designed for stability over speed
- **Security** - Route hijacking, prefix filtering critical
- **Used by ISPs** - Internet backbone routing
- **AS numbers** - 16-bit (1-65535) or 32-bit
- **BGP communities** - route tagging for policy
