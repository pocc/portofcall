# Hazelcast IMDG Protocol

## Overview
Hazelcast is an in-memory data grid (IMDG) platform providing distributed data structures, caching, and compute capabilities. It uses a binary client protocol over TCP for communication between clients and cluster members.

## Protocol Details
- **Default Port:** 5701 (first member), 5702-5799 (additional members)
- **Transport:** Binary TCP with length-prefixed message frames
- **Clustering:** Auto-discovery via multicast or TCP/IP seed lists
- **Authentication:** Username/password, token, or anonymous

## Key Features

| Feature | Description |
|---------|-------------|
| Distributed Maps | Thread-safe, partitioned hash maps across cluster |
| Distributed Queues | FIFO queues with blocking operations |
| Distributed Locks | Cluster-wide locking primitives |
| Pub/Sub Topics | Publish/subscribe messaging |
| Distributed Executors | Run code on any cluster member |
| Event Listeners | Subscribe to data structure events |

## Client Protocol (5.x)

### Message Frame Format
```
┌─────────────────┬──────────────────────┬─────────────────┐
│ Version (1 byte)│ Message Type (1 byte)│ Frame Length (4)│
├─────────────────┼──────────────────────┼─────────────────┤
│ Correlation ID (8 bytes, little-endian)                  │
├─────────────────────────────────────────────────────────┤
│ Flags (2 bytes) │ Payload (variable length)             │
└─────────────────┴───────────────────────────────────────┘
```

### Protocol Versions
- **0x03:** Hazelcast 3.x
- **0x04:** Hazelcast 4.x
- **0x05:** Hazelcast 5.x (current)

### Authentication Message (Type 0xC8)
```
Payload:
- Cluster name (length-prefixed string)
- Client type (length-prefixed string, e.g., "Java", "NodeJS")
- Serialization version (byte)
- Client version (string)
- Credentials (username, password, or token)
- Optional: UUID, labels, etc.
```

### Authentication Response (Type 0xC9)
```
Payload:
- Status (0 = success, non-zero = error)
- Server version (string)
- Cluster name (string)
- Partition count (int32)
- Cluster UUID (UUID)
- Member list (array of addresses)
```

## Implementation Details

### Worker (`src/worker/hazelcast.ts`)
- `handleHazelcastProbe()` - Sends authentication request, parses cluster info
- Builds minimal 5.x authentication frame with cluster name
- Parses response for server version, cluster name, member count
- Uses raw TCP sockets (Cloudflare Workers `connect()`)

### Client (`src/components/HazelcastClient.tsx`)
- Server probe with cluster info display
- Version and member count badges
- RTT measurement
- Architecture diagram

### API Endpoints
- `POST /api/hazelcast/probe` - Probe Hazelcast member and retrieve cluster info

## Edge Cases
- **Authentication:** Probe uses anonymous auth with default cluster name
- **Timeouts:** 10s connection timeout, 3s read timeout
- **Binary Protocol:** Little-endian multi-byte integers, length-prefixed strings
- **Version Detection:** Supports 3.x, 4.x, 5.x protocol versions
- **Cluster Members:** First member typically on 5701, additional members on 5702+

## Common Use Cases
- **Distributed Caching:** Replace centralized Redis/Memcached with partitioned cache
- **Session Storage:** HTTP session replication across web servers
- **Data Grid:** In-memory SQL queries with predicates and indexes
- **Event Sourcing:** Distributed event log with listeners
- **Job Scheduling:** Distributed executors for background tasks

## Configuring Hazelcast
```java
// Java client example
Config config = new Config();
config.getNetworkConfig().setPort(5701);
config.setClusterName("dev");

HazelcastInstance hz = Hazelcast.newHazelcastInstance(config);
IMap<String, String> map = hz.getMap("my-distributed-map");
map.put("key", "value");
```

## Security Considerations
- **Authentication Required:** Production clusters should require credentials
- **Network Isolation:** Expose only to trusted networks (VPN/private subnet)
- **TLS/SSL:** Enable for encrypted client-member communication
- **Token-Based Auth:** Preferred over username/password for cloud deployments
- **Member-to-Member:** Cluster communication uses separate authentication
