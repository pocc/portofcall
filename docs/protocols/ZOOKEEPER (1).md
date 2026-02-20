# ZooKeeper Protocol Implementation Plan

## Overview

**Protocol:** Apache ZooKeeper Client Protocol
**Port:** 2181 (client), 2888 (peer), 3888 (leader election)
**Documentation:** [ZooKeeper Protocol](https://zookeeper.apache.org/doc/current/zookeeperProgrammers.html)
**Complexity:** High
**Purpose:** Distributed coordination and configuration

ZooKeeper provides **distributed coordination** - hierarchical namespace (znodes), watches, distributed locks, leader election, and strong consistency guarantees.

### Use Cases
- Configuration management
- Distributed synchronization
- Leader election
- Service discovery
- Distributed locking
- Queue implementation
- Barrier synchronization

## Protocol Specification

### Binary Protocol

ZooKeeper uses a **binary protocol** with request/response pairs:

```
[Length: 4 bytes] [Xid: 4 bytes] [Type: 4 bytes] [Data: variable]
```

### Connection Flow

```
Client → Server: ConnectRequest
Server → Client: ConnectResponse
Client ↔ Server: Requests/Responses
Client → Server: CloseRequest (or disconnect)
```

### ConnectRequest

```
int32  protocolVersion (0)
int64  lastZxidSeen
int32  timeOut
int64  sessionId (0 for new)
int32  passwd_len
bytes  passwd
```

### ConnectResponse

```
int32  protocolVersion
int32  timeOut
int64  sessionId
int32  passwd_len
bytes  passwd
```

### Request Types

```
OpCode.create      = 1
OpCode.delete      = 2
OpCode.exists      = 3
OpCode.getData     = 4
OpCode.setData     = 5
OpCode.getACL      = 6
OpCode.setACL      = 7
OpCode.getChildren = 8
OpCode.sync        = 9
OpCode.ping        = 11
OpCode.getChildren2= 12
OpCode.multi       = 14
```

### ZNode Hierarchy

```
/                           # Root
/app                        # Application namespace
/app/config                 # Configuration
/app/config/database        # Database config
/app/workers                # Worker nodes
/app/workers/worker-1       # Ephemeral node (session-bound)
/app/locks                  # Locks
/app/locks/resource-1       # Lock node
```

## Worker Implementation

```typescript
// src/worker/protocols/zookeeper/client.ts

import { connect } from 'cloudflare:sockets';

export interface ZooKeeperConfig {
  host: string;
  port?: number;
  sessionTimeout?: number;
}

export interface Stat {
  czxid: bigint;          // Created zxid
  mzxid: bigint;          // Last modified zxid
  ctime: bigint;          // Created time
  mtime: bigint;          // Last modified time
  version: number;        // Data version
  cversion: number;       // Children version
  aversion: number;       // ACL version
  ephemeralOwner: bigint; // Session ID if ephemeral
  dataLength: number;     // Data length
  numChildren: number;    // Number of children
  pzxid: bigint;          // Last modified children zxid
}

export interface ZNode {
  path: string;
  data: Uint8Array;
  stat: Stat;
}

export enum CreateMode {
  PERSISTENT = 0,           // /path
  EPHEMERAL = 1,            // /path (deleted on session end)
  PERSISTENT_SEQUENTIAL = 2, // /path0000000001
  EPHEMERAL_SEQUENTIAL = 3,  // /path0000000001 (deleted on session end)
}

export enum EventType {
  NodeCreated = 1,
  NodeDeleted = 2,
  NodeDataChanged = 3,
  NodeChildrenChanged = 4,
}

export interface WatchEvent {
  type: EventType;
  state: number;
  path: string;
}

export class ZooKeeperClient {
  private socket: any;
  private sessionId: bigint = 0n;
  private password: Uint8Array = new Uint8Array(16);
  private xid: number = 1;
  private watches = new Map<string, ((event: WatchEvent) => void)[]>();
  private pendingRequests = new Map<number, any>();

  constructor(private config: ZooKeeperConfig) {}

  async connect(): Promise<void> {
    const port = this.config.port || 2181;
    this.socket = connect(`${this.config.host}:${port}`);
    await this.socket.opened;

    // Send ConnectRequest
    await this.sendConnect();

    // Start reading responses
    this.readLoop();
  }

  private async sendConnect(): Promise<void> {
    const timeout = this.config.sessionTimeout || 10000;

    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    let offset = 0;

    // Length (will set at end)
    offset += 4;

    // Protocol version
    view.setInt32(offset, 0, false);
    offset += 4;

    // Last zxid seen
    view.setBigInt64(offset, 0n, false);
    offset += 8;

    // Timeout
    view.setInt32(offset, timeout, false);
    offset += 4;

    // Session ID
    view.setBigInt64(offset, this.sessionId, false);
    offset += 8;

    // Password length
    view.setInt32(offset, 16, false);
    offset += 4;

    // Password (16 bytes)
    const data = new Uint8Array(buffer);
    data.set(this.password, offset);

    // Set length (excluding length field itself)
    view.setInt32(0, offset + 16 - 4, false);

    await this.send(new Uint8Array(buffer.slice(0, offset + 16)));

    // Read ConnectResponse
    await this.readConnect();
  }

  private async readConnect(): Promise<void> {
    const reader = this.socket.readable.getReader();

    // Read length
    const lengthData = await this.readExact(reader, 4);
    const length = new DataView(lengthData.buffer).getInt32(0, false);

    // Read response
    const response = await this.readExact(reader, length);
    const view = new DataView(response.buffer);

    let offset = 0;

    // Protocol version
    const version = view.getInt32(offset, false);
    offset += 4;

    // Timeout
    const timeout = view.getInt32(offset, false);
    offset += 4;

    // Session ID
    this.sessionId = view.getBigInt64(offset, false);
    offset += 8;

    // Password length
    const passwdLen = view.getInt32(offset, false);
    offset += 4;

    // Password
    this.password = response.slice(offset, offset + passwdLen);

    reader.releaseLock();
  }

  // Create ZNode

  async create(
    path: string,
    data: Uint8Array = new Uint8Array(0),
    mode: CreateMode = CreateMode.PERSISTENT
  ): Promise<string> {
    const xid = this.xid++;

    // Build CreateRequest
    const pathBytes = new TextEncoder().encode(path);
    const bufferSize = 4 + 4 + 4 + pathBytes.length + 4 + data.length + 4 + 4;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Xid
    view.setInt32(offset, xid, false);
    offset += 4;

    // OpCode (create = 1)
    view.setInt32(offset, 1, false);
    offset += 4;

    // Path length and data
    view.setInt32(offset, pathBytes.length, false);
    offset += 4;
    new Uint8Array(buffer).set(pathBytes, offset);
    offset += pathBytes.length;

    // Data length and data
    view.setInt32(offset, data.length, false);
    offset += 4;
    new Uint8Array(buffer).set(data, offset);
    offset += data.length;

    // ACL (open ACL for simplicity)
    view.setInt32(offset, 0, false); // ACL count
    offset += 4;

    // Flags (CreateMode)
    view.setInt32(offset, mode, false);

    const response = await this.sendRequest(xid, new Uint8Array(buffer));
    return new TextDecoder().decode(response);
  }

  // Get ZNode data

  async getData(path: string, watch: boolean = false): Promise<ZNode> {
    const xid = this.xid++;

    const pathBytes = new TextEncoder().encode(path);
    const bufferSize = 4 + 4 + 4 + pathBytes.length + 1;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Xid
    view.setInt32(offset, xid, false);
    offset += 4;

    // OpCode (getData = 4)
    view.setInt32(offset, 4, false);
    offset += 4;

    // Path
    view.setInt32(offset, pathBytes.length, false);
    offset += 4;
    new Uint8Array(buffer).set(pathBytes, offset);
    offset += pathBytes.length;

    // Watch
    view.setUint8(offset, watch ? 1 : 0);

    const response = await this.sendRequest(xid, new Uint8Array(buffer));
    return this.parseGetDataResponse(path, response);
  }

  private parseGetDataResponse(path: string, response: Uint8Array): ZNode {
    const view = new DataView(response.buffer);
    let offset = 0;

    // Data length
    const dataLen = view.getInt32(offset, false);
    offset += 4;

    // Data
    const data = response.slice(offset, offset + dataLen);
    offset += dataLen;

    // Stat
    const stat = this.parseStat(view, offset);

    return { path, data, stat };
  }

  // Set ZNode data

  async setData(path: string, data: Uint8Array, version: number = -1): Promise<Stat> {
    const xid = this.xid++;

    const pathBytes = new TextEncoder().encode(path);
    const bufferSize = 4 + 4 + 4 + pathBytes.length + 4 + data.length + 4;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Xid
    view.setInt32(offset, xid, false);
    offset += 4;

    // OpCode (setData = 5)
    view.setInt32(offset, 5, false);
    offset += 4;

    // Path
    view.setInt32(offset, pathBytes.length, false);
    offset += 4;
    new Uint8Array(buffer).set(pathBytes, offset);
    offset += pathBytes.length;

    // Data
    view.setInt32(offset, data.length, false);
    offset += 4;
    new Uint8Array(buffer).set(data, offset);
    offset += data.length;

    // Version
    view.setInt32(offset, version, false);

    const response = await this.sendRequest(xid, new Uint8Array(buffer));
    return this.parseStat(new DataView(response.buffer), 0);
  }

  // Delete ZNode

  async delete(path: string, version: number = -1): Promise<void> {
    const xid = this.xid++;

    const pathBytes = new TextEncoder().encode(path);
    const bufferSize = 4 + 4 + 4 + pathBytes.length + 4;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Xid
    view.setInt32(offset, xid, false);
    offset += 4;

    // OpCode (delete = 2)
    view.setInt32(offset, 2, false);
    offset += 4;

    // Path
    view.setInt32(offset, pathBytes.length, false);
    offset += 4;
    new Uint8Array(buffer).set(pathBytes, offset);
    offset += pathBytes.length;

    // Version
    view.setInt32(offset, version, false);

    await this.sendRequest(xid, new Uint8Array(buffer));
  }

  // Get children

  async getChildren(path: string, watch: boolean = false): Promise<string[]> {
    const xid = this.xid++;

    const pathBytes = new TextEncoder().encode(path);
    const bufferSize = 4 + 4 + 4 + pathBytes.length + 1;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Xid
    view.setInt32(offset, xid, false);
    offset += 4;

    // OpCode (getChildren = 8)
    view.setInt32(offset, 8, false);
    offset += 4;

    // Path
    view.setInt32(offset, pathBytes.length, false);
    offset += 4;
    new Uint8Array(buffer).set(pathBytes, offset);
    offset += pathBytes.length;

    // Watch
    view.setUint8(offset, watch ? 1 : 0);

    const response = await this.sendRequest(xid, new Uint8Array(buffer));
    return this.parseGetChildrenResponse(response);
  }

  private parseGetChildrenResponse(response: Uint8Array): string[] {
    const view = new DataView(response.buffer);
    let offset = 0;

    // Count
    const count = view.getInt32(offset, false);
    offset += 4;

    const children: string[] = [];

    for (let i = 0; i < count; i++) {
      // Child name length
      const len = view.getInt32(offset, false);
      offset += 4;

      // Child name
      const name = new TextDecoder().decode(response.slice(offset, offset + len));
      children.push(name);
      offset += len;
    }

    return children;
  }

  // Exists (check if node exists)

  async exists(path: string, watch: boolean = false): Promise<Stat | null> {
    const xid = this.xid++;

    const pathBytes = new TextEncoder().encode(path);
    const bufferSize = 4 + 4 + 4 + pathBytes.length + 1;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Xid
    view.setInt32(offset, xid, false);
    offset += 4;

    // OpCode (exists = 3)
    view.setInt32(offset, 3, false);
    offset += 4;

    // Path
    view.setInt32(offset, pathBytes.length, false);
    offset += 4;
    new Uint8Array(buffer).set(pathBytes, offset);
    offset += pathBytes.length;

    // Watch
    view.setUint8(offset, watch ? 1 : 0);

    try {
      const response = await this.sendRequest(xid, new Uint8Array(buffer));
      return this.parseStat(new DataView(response.buffer), 0);
    } catch (error) {
      // Node doesn't exist
      return null;
    }
  }

  private parseStat(view: DataView, offset: number): Stat {
    return {
      czxid: view.getBigInt64(offset, false),
      mzxid: view.getBigInt64(offset + 8, false),
      ctime: view.getBigInt64(offset + 16, false),
      mtime: view.getBigInt64(offset + 24, false),
      version: view.getInt32(offset + 32, false),
      cversion: view.getInt32(offset + 36, false),
      aversion: view.getInt32(offset + 40, false),
      ephemeralOwner: view.getBigInt64(offset + 44, false),
      dataLength: view.getInt32(offset + 52, false),
      numChildren: view.getInt32(offset + 56, false),
      pzxid: view.getBigInt64(offset + 60, false),
    };
  }

  private async sendRequest(xid: number, data: Uint8Array): Promise<Uint8Array> {
    return new Promise(async (resolve, reject) => {
      this.pendingRequests.set(xid, { resolve, reject });

      // Prepend length
      const buffer = new ArrayBuffer(4 + data.length);
      const view = new DataView(buffer);
      view.setInt32(0, data.length, false);
      new Uint8Array(buffer).set(data, 4);

      await this.send(new Uint8Array(buffer));
    });
  }

  private async send(data: Uint8Array): Promise<void> {
    const writer = this.socket.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  }

  private async readLoop(): Promise<void> {
    const reader = this.socket.readable.getReader();

    while (true) {
      try {
        // Read length
        const lengthData = await this.readExact(reader, 4);
        const length = new DataView(lengthData.buffer).getInt32(0, false);

        // Read message
        const message = await this.readExact(reader, length);
        await this.handleMessage(message);
      } catch (error) {
        console.error('Read error:', error);
        break;
      }
    }
  }

  private async handleMessage(message: Uint8Array): Promise<void> {
    const view = new DataView(message.buffer);

    // Xid
    const xid = view.getInt32(0, false);

    // Zxid
    const zxid = view.getBigInt64(4, false);

    // Error code
    const err = view.getInt32(12, false);

    if (xid === -1) {
      // Watch event
      this.handleWatchEvent(message.slice(16));
      return;
    }

    const pending = this.pendingRequests.get(xid);
    if (!pending) return;

    this.pendingRequests.delete(xid);

    if (err !== 0) {
      pending.reject(new Error(`ZooKeeper error: ${err}`));
    } else {
      pending.resolve(message.slice(16));
    }
  }

  private handleWatchEvent(data: Uint8Array): void {
    const view = new DataView(data.buffer);
    let offset = 0;

    // Event type
    const type = view.getInt32(offset, false) as EventType;
    offset += 4;

    // State
    const state = view.getInt32(offset, false);
    offset += 4;

    // Path length
    const pathLen = view.getInt32(offset, false);
    offset += 4;

    // Path
    const path = new TextDecoder().decode(data.slice(offset, offset + pathLen));

    const event: WatchEvent = { type, state, path };

    // Call registered watchers
    const watchers = this.watches.get(path);
    if (watchers) {
      watchers.forEach(watcher => watcher(event));
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

  async close(): Promise<void> {
    await this.socket.close();
  }
}

// Distributed Lock using ZooKeeper

export class ZooKeeperLock {
  private lockPath?: string;

  constructor(
    private client: ZooKeeperClient,
    private basePath: string,
    private prefix: string = 'lock-'
  ) {}

  async acquire(): Promise<void> {
    // Create sequential ephemeral node
    this.lockPath = await this.client.create(
      `${this.basePath}/${this.prefix}`,
      new Uint8Array(0),
      CreateMode.EPHEMERAL_SEQUENTIAL
    );

    while (true) {
      // Get all children
      const children = await this.client.getChildren(this.basePath);

      // Sort children
      children.sort();

      // Get our sequence number
      const ourSeq = this.lockPath.split('/').pop()!;

      // Are we the first?
      if (children[0] === ourSeq) {
        // We have the lock!
        return;
      }

      // Wait for the node before us to be deleted
      const ourIndex = children.indexOf(ourSeq);
      const prevNode = children[ourIndex - 1];

      // Set watch on previous node
      await this.client.exists(`${this.basePath}/${prevNode}`, true);

      // Wait for watch event (simplified - should listen for deletion)
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async release(): Promise<void> {
    if (this.lockPath) {
      await this.client.delete(this.lockPath);
      this.lockPath = undefined;
    }
  }
}
```

## Web UI Design

```typescript
// src/components/ZooKeeperClient.tsx

export function ZooKeeperClient() {
  const [host, setHost] = useState('localhost');
  const [connected, setConnected] = useState(false);
  const [currentPath, setCurrentPath] = useState('/');
  const [children, setChildren] = useState<string[]>([]);
  const [nodeData, setNodeData] = useState<string>('');
  const [newPath, setNewPath] = useState('');
  const [newData, setNewData] = useState('');

  const connect = async () => {
    const response = await fetch('/api/zookeeper/connect', {
      method: 'POST',
      body: JSON.stringify({ host }),
    });

    if (response.ok) {
      setConnected(true);
      await browse('/');
    }
  };

  const browse = async (path: string) => {
    const response = await fetch(`/api/zookeeper/children?path=${encodeURIComponent(path)}`);
    const data = await response.json();
    setChildren(data.children);
    setCurrentPath(path);
  };

  const getNodeData = async (path: string) => {
    const response = await fetch(`/api/zookeeper/data?path=${encodeURIComponent(path)}`);
    const data = await response.json();
    setNodeData(data.data);
  };

  const createNode = async () => {
    await fetch('/api/zookeeper/create', {
      method: 'POST',
      body: JSON.stringify({
        path: newPath,
        data: newData,
        mode: 'PERSISTENT',
      }),
    });

    setNewPath('');
    setNewData('');
    await browse(currentPath);
  };

  const deleteNode = async (path: string) => {
    await fetch('/api/zookeeper/delete', {
      method: 'DELETE',
      body: JSON.stringify({ path }),
    });

    await browse(currentPath);
  };

  return (
    <div className="zookeeper-client">
      <h2>ZooKeeper Browser</h2>

      {!connected ? (
        <div className="connection">
          <input
            type="text"
            placeholder="ZooKeeper Host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
          <button onClick={connect}>Connect</button>
        </div>
      ) : (
        <>
          <div className="browser">
            <div className="path">
              Current: <strong>{currentPath}</strong>
              {currentPath !== '/' && (
                <button onClick={() => browse(currentPath.split('/').slice(0, -1).join('/') || '/')}>
                  ↑ Parent
                </button>
              )}
            </div>

            <ul className="children">
              {children.map(child => (
                <li key={child}>
                  <span onClick={() => browse(`${currentPath}/${child}`)}>{child}</span>
                  <button onClick={() => getNodeData(`${currentPath}/${child}`)}>View</button>
                  <button onClick={() => deleteNode(`${currentPath}/${child}`)}>Delete</button>
                </li>
              ))}
            </ul>
          </div>

          <div className="create">
            <h3>Create ZNode</h3>
            <input
              type="text"
              placeholder="Path"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
            />
            <input
              type="text"
              placeholder="Data"
              value={newData}
              onChange={(e) => setNewData(e.target.value)}
            />
            <button onClick={createNode}>Create</button>
          </div>

          {nodeData && (
            <div className="data">
              <h3>Node Data</h3>
              <pre>{nodeData}</pre>
            </div>
          )}
        </>
      )}

      <div className="info">
        <h3>About ZooKeeper</h3>
        <ul>
          <li>Distributed coordination service</li>
          <li>Hierarchical namespace (like filesystem)</li>
          <li>Strong consistency guarantees</li>
          <li>Ephemeral nodes (session-bound)</li>
          <li>Sequential nodes for locks/queues</li>
          <li>Watches for change notifications</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### ACL (Access Control Lists)

```typescript
// ZooKeeper supports ACLs but implementation is complex
// For simplicity, using world:anyone:cdrwa (open ACL)
```

### TLS

```bash
# Enable TLS in ZooKeeper
secureClientPort=2281
ssl.keyStore.location=/path/to/keystore.jks
ssl.trustStore.location=/path/to/truststore.jks
```

## Testing

```bash
# Docker ZooKeeper
docker run -d \
  -p 2181:2181 \
  --name zookeeper \
  zookeeper:latest

# CLI
zkCli.sh -server localhost:2181

# Commands
ls /
create /test "data"
get /test
set /test "new data"
delete /test
```

## Resources

- **ZooKeeper Docs**: [Documentation](https://zookeeper.apache.org/doc/current/)
- **Programmer's Guide**: [Guide](https://zookeeper.apache.org/doc/current/zookeeperProgrammers.html)
- **Recipes**: [Common patterns](https://zookeeper.apache.org/doc/current/recipes.html)

## Notes

- **Binary protocol** - More complex than HTTP/JSON APIs
- **Strong consistency** - CP in CAP theorem
- **Watches** - One-time triggers for changes
- **Ephemeral nodes** - Deleted when session ends
- **Sequential nodes** - Auto-incrementing suffixes
- **Zxid** - ZooKeeper transaction ID (version)
- **Session-based** - Client must maintain heartbeat
- Used by **Kafka**, **Hadoop**, **HBase**
- **Curator** library simplifies recipes (locks, leader election)
- Not meant for **large data** storage (max 1MB per znode)
