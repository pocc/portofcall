# Aerospike -- Power User Reference

**Port:** 3000 (default) | **Protocols:** Info (type 1) + AS_MSG (type 3) | Deployed

Port of Call provides three Aerospike endpoints: an HTTP connection probe, an info command executor, and KV get/put operations. All open a direct TCP connection from the Cloudflare Worker to your Aerospike node.

---

## API Endpoints

### `POST /api/aerospike/connect` -- Connection probe

Connects and runs a series of info commands (`build`, `status`, `node`, `edition`, `cluster-name`, `namespaces`) to gather server metadata. Each command opens and closes its own TCP connection.

**POST body:**

| Field     | Type   | Default | Notes    |
|-----------|--------|---------|----------|
| `host`    | string | --      | Required |
| `port`    | number | `3000`  |          |
| `timeout` | number | `10000` | ms       |

**Success (200):**
```json
{
  "success": true,
  "host": "aerospike.example.com",
  "port": 3000,
  "rtt": 42,
  "serverInfo": {
    "build": "6.4.0.2",
    "status": "ok",
    "nodeId": "BB9050011AC4202",
    "edition": "Aerospike Enterprise Edition",
    "clusterName": "my-cluster",
    "namespaces": ["test", "production"]
  }
}
```

**Error (500):** `{ "success": false, "error": "Connection timeout" }`

**Cloudflare-protected host (403):** `{ "success": false, "error": "...", "isCloudflare": true }`

**Notes:**
- The `rtt` value is the total wall-clock time across all six sequential info queries, not a single round trip.
- Each info query opens a new TCP connection. On high-latency networks this compounds -- expect 6x the single-query RTT.
- The `build` query is mandatory; if it fails the entire probe returns an error. The remaining five queries are optional and default to `"unknown"` on failure.

---

### `POST /api/aerospike/info` -- Info command executor

Sends a single info protocol command and returns the raw response plus a parsed key-value interpretation.

**POST body:**

| Field     | Type   | Default | Notes                                    |
|-----------|--------|---------|------------------------------------------|
| `host`    | string | --      | Required                                 |
| `port`    | number | `3000`  |                                          |
| `command` | string | --      | Required. Must be in the allowlist below. |
| `timeout` | number | `10000` | ms                                       |

**Allowed commands:**

```
build  node  status  namespaces  statistics  cluster-name  features
edition  service  services  services-alumni  peers-generation
partition-generation  logs  sets  bins  sindex  udf-list
jobs:module=query  jobs:module=scan  namespace/<name>
```

The `namespace/<name>` pattern is dynamically validated (alphanumeric, hyphens, underscores).

**Success (200):**
```json
{
  "success": true,
  "host": "aerospike.example.com",
  "port": 3000,
  "command": "namespaces",
  "rtt": 8,
  "response": "namespaces\ttest;production",
  "parsed": {
    "_value": "test;production"
  }
}
```

**Response parsing rules:**

1. If the response contains a tab character, everything before the first tab is treated as a command echo and stripped.
2. The remaining text is split on `;`. Each segment containing `=` is parsed as `key=value`. Segments without `=` are stored under the `_value` key.
3. Whitespace is trimmed from keys and values.

**curl example:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/aerospike/info \
  -H 'Content-Type: application/json' \
  -d '{"host":"aerospike.example.com","command":"statistics"}' \
  | jq '.parsed'
```

---

### `POST /api/aerospike/kv-get` -- Record read

Reads an Aerospike record by namespace, set, and string key. Returns all bins (or specific bins if requested).

**POST body:**

| Field       | Type     | Default | Notes                                 |
|-------------|----------|---------|---------------------------------------|
| `host`      | string   | --      | Required                              |
| `port`      | number   | `3000`  |                                       |
| `timeout`   | number   | `10000` | ms                                    |
| `namespace` | string   | --      | Required                              |
| `set`       | string   | --      | Set name (can be empty string)        |
| `key`       | string   | --      | Required. String keys only.           |
| `bins`      | string[] | --      | Optional. If omitted, returns all bins|

**Success (200):**
```json
{
  "success": true,
  "key": "user:42",
  "namespace": "test",
  "set": "users",
  "generation": 3,
  "ttl": 0,
  "bins": {
    "name": "Alice",
    "age": 30,
    "tags": ["admin", "active"]
  },
  "rtt": 12
}
```

**Record not found (200):**
```json
{
  "success": false,
  "resultCode": 2,
  "error": "Record not found",
  "rtt": 8
}
```

**Notes:**
- The `generation` field is the record's write generation counter (incremented on each update).
- The `ttl` field is the record's remaining time-to-live in seconds. `0` means the record does not expire (or uses the namespace default).
- The record is located using a RIPEMD-160 digest of `set_name + key_bytes`. The digest is computed client-side and sent as a 20-byte digest field in the AS_MSG.
- Only string keys are supported. Integer or byte keys require protocol changes.
- When `bins` is omitted, the `GET_ALL` flag is set and all bins are returned. When `bins` is specified, individual read ops are generated per bin name.

**Result codes:**

| Code | Meaning              |
|------|----------------------|
| 0    | OK                   |
| 2    | Record not found     |
| 3    | Record too large     |
| 4    | Record expired       |
| 12   | Access denied        |

---

### `POST /api/aerospike/kv-put` -- Record write

Writes (creates or updates) an Aerospike record.

**POST body:**

| Field       | Type                      | Default | Notes           |
|-------------|---------------------------|---------|-----------------|
| `host`      | string                    | --      | Required        |
| `port`      | number                    | `3000`  |                 |
| `timeout`   | number                    | `10000` | ms              |
| `namespace` | string                    | --      | Required        |
| `set`       | string                    | --      | Set name        |
| `key`       | string                    | --      | Required        |
| `bins`      | `Record<string, unknown>` | --      | Required, non-empty |

**Success (200):**
```json
{
  "success": true,
  "key": "user:42",
  "namespace": "test",
  "set": "users",
  "generation": 4,
  "binsWritten": 3,
  "rtt": 15
}
```

**Bin type mapping:**

| JavaScript type       | Aerospike particle type | Wire encoding            |
|-----------------------|------------------------|--------------------------|
| `number` (integer)    | INTEGER (1)            | 8-byte big-endian        |
| `string`              | STRING (3)             | UTF-8 bytes              |
| everything else       | BLOB (4)               | `JSON.stringify()` bytes |

**Notes:**
- Bin names are truncated to 15 bytes (the Aerospike maximum). Names exceeding this are silently truncated.
- Floating-point numbers are serialized as JSON blobs, not Aerospike doubles. Read them back as parsed JSON objects.
- The write uses default policies: no generation check, no create-only constraint, default TTL from the namespace configuration.

---

## Aerospike Wire Protocol Reference

### Proto Header (8 bytes)

Every Aerospike message -- info or AS_MSG -- is prefixed with the same 8-byte header:

```
Offset  Size  Field
  0       1   version  (always 2)
  1       1   type     (1 = INFO, 3 = AS_MSG)
  2       6   length   (big-endian 48-bit body length, excludes this 8-byte header)
```

The server also frames responses with this header, so the client can determine the response body length from the first 8 bytes.

### Info Protocol (type 1)

The info protocol is a simple text-based request/response protocol layered on top of the proto header framing.

**Request:**
```
[8-byte proto header: version=2, type=1, length=N]
[N bytes: "command\n"]
```

**Response:**
```
[8-byte proto header: version=2, type=1, length=M]
[M bytes: "command\tresponse_data\n"]
```

The response echoes the command name before a tab, followed by the response data and a trailing newline. Response data formats vary by command:

| Command         | Response format                                    |
|-----------------|----------------------------------------------------|
| `build`         | Single value: `"6.4.0.2"`                          |
| `status`        | Single value: `"ok"`                                |
| `node`          | Single value: hex node ID                           |
| `namespaces`    | Semicolon-separated list: `"test;production"`       |
| `namespace/X`   | Semicolon-separated key=value pairs                 |
| `statistics`    | Semicolon-separated key=value pairs                 |
| `features`      | Semicolon-separated feature names                   |
| `service`       | `host:port` pairs (access addresses)                |
| `services`      | Same as `service`, includes all known peers         |

Multiple commands can be sent in a single request by separating them with newlines. Each command in the response is separated by a newline, with the command name echoed before a tab.

### AS_MSG Protocol (type 3)

Used for data operations (read, write, delete, scan, query).

**Message layout:**
```
[8-byte proto header: version=2, type=3, body_length]
[22-byte AS_MSG header]
[fields...]
[ops...]
```

**AS_MSG header (22 bytes):**
```
Offset  Size  Field
  0       1   header_sz      (always 22)
  1       1   info1          (read flags)
  2       1   info2          (write flags)
  3       1   info3          (misc flags)
  4       1   unused         (0)
  5       1   result_code    (0 on request; set in response)
  6       4   generation     (big-endian; record write generation)
 10       4   expiration     (big-endian; TTL in seconds or void-time)
 14       4   transaction_ttl(big-endian; client transaction timeout)
 18       2   n_fields       (big-endian; number of fields)
 20       2   n_ops          (big-endian; number of operations)
```

**info1 flags (read operations):**

| Bit  | Value | Name                     | Description                        |
|------|-------|--------------------------|------------------------------------|
| 0    | 0x01  | READ                     | Read operation                     |
| 1    | 0x02  | GET_ALL                  | Return all bins (when n_ops=0)     |
| 2    | 0x04  | SHORT_QUERY              | Short query optimization           |
| 3    | 0x08  | BATCH                    | Batch request                      |
| 4    | 0x10  | XDR                      | Cross-datacenter replication       |
| 5    | 0x20  | GET_NOBINDATA            | Return metadata only, no bin data  |
| 6    | 0x40  | READ_MODE_AP_ALL         | Read from all AP replicas          |
| 7    | 0x80  | COMPRESS_RESPONSE        | Server may compress response       |

**info2 flags (write operations):**

| Bit  | Value | Name                     | Description                        |
|------|-------|--------------------------|------------------------------------|
| 0    | 0x01  | WRITE                    | Write operation                    |
| 1    | 0x02  | DELETE                   | Delete operation                   |
| 2    | 0x04  | GENERATION               | Verify generation on write         |
| 3    | 0x08  | GENERATION_GT            | Verify generation > current        |
| 4    | 0x10  | DURABLE_DELETE           | Durable delete (tombstone)         |
| 5    | 0x20  | CREATE_ONLY              | Fail if record already exists      |
| 7    | 0x80  | RESPOND_ALL_OPS          | Return bins after all ops          |

**Field format:**
```
[field_size(4 BE)]  -- size of type + data (excludes this 4-byte prefix)
[field_type(1)]
[data...]
```

**Field type codes:**

| Code | Name      | Data                                          |
|------|-----------|-----------------------------------------------|
| 0    | NAMESPACE | UTF-8 namespace name                          |
| 1    | SET       | UTF-8 set name                                |
| 2    | KEY       | [particle_type(1)][key_bytes] -- user key     |
| 4    | DIGEST    | 20-byte RIPEMD-160 digest (partition routing) |

**Op format:**
```
[op_size(4 BE)]      -- size of everything after this 4-byte prefix
[op_type(1)]
[particle_type(1)]   -- bin data type
[version(1)]         -- always 0
[name_len(1)]        -- bin name length in bytes
[name...]            -- bin name (UTF-8, max 15 bytes)
[value...]           -- bin value (encoding depends on particle_type)
```

**Op type codes:**

| Code | Name          |
|------|---------------|
| 1    | READ          |
| 2    | WRITE         |
| 3    | CDT_READ      |
| 4    | CDT_MODIFY    |
| 5    | MAP_READ (deprecated, use CDT_READ) |
| 6    | MAP_MODIFY (deprecated, use CDT_MODIFY) |
| 9    | INCR          |
| 10   | APPEND        |
| 11   | PREPEND       |
| 12   | TOUCH         |
| 13   | BIT_READ      |
| 14   | BIT_MODIFY    |
| 15   | DELETE        |
| 16   | HLL_READ      |
| 17   | HLL_MODIFY    |
| 18   | EXP_READ      |
| 19   | EXP_MODIFY    |

**Particle type codes (bin value types):**

| Code | Name       | Wire encoding                          |
|------|------------|----------------------------------------|
| 0    | NULL       | 0 bytes                                |
| 1    | INTEGER    | 8 bytes big-endian signed              |
| 2    | DOUBLE     | 8 bytes IEEE 754                       |
| 3    | STRING     | UTF-8 bytes                            |
| 4    | BLOB       | Raw bytes                              |
| 5    | JBLOB      | Serialized Java object (legacy)        |
| 6    | CSHARP     | Serialized C# object (legacy)          |
| 7    | PYTHON     | Pickled Python object (legacy)         |
| 8    | RUBY       | Serialized Ruby object (legacy)        |
| 9    | PHP        | Serialized PHP object (legacy)         |
| 10   | ERLANG     | Serialized Erlang term (legacy)        |
| 17   | BOOL       | 1 byte (0 or 1)                        |
| 18   | HLL        | HyperLogLog                            |
| 19   | MAP        | MessagePack-encoded map                |
| 20   | LIST       | MessagePack-encoded list               |
| 23   | GEOJSON    | GeoJSON string                         |

### Key Digest Computation

Records are addressed by a 20-byte RIPEMD-160 digest, not by the raw user key. The digest is computed as:

```
digest = RIPEMD-160(set_name_bytes + key_particle_bytes)
```

Where:
- `set_name_bytes` is the UTF-8 encoding of the set name (empty if no set)
- `key_particle_bytes` depends on the key type:
  - String key: raw UTF-8 bytes of the string
  - Integer key: 8-byte big-endian encoding
  - Bytes key: raw bytes

The digest determines which partition (and therefore which node) owns the record. Aerospike uses 4096 partitions, and the partition ID is derived from the first 12 bits of the digest:

```
partition_id = (digest[0] | (digest[1] << 8) | (digest[2] << 16) | (digest[3] << 24)) & 0xFFF
```

Port of Call computes the digest client-side using a pure-JavaScript RIPEMD-160 implementation and sends it in the DIGEST field (type 4) of the AS_MSG.

### Result Codes

| Code | Name                    | Meaning                                    |
|------|-------------------------|--------------------------------------------|
| 0    | OK                      | Success                                    |
| 1    | SERVER_ERROR            | Generic server error                       |
| 2    | KEY_NOT_FOUND_ERROR     | Record does not exist                      |
| 3    | GENERATION_ERROR        | Generation mismatch on write               |
| 4    | PARAMETER_ERROR         | Invalid request parameters                 |
| 5    | KEY_EXISTS_ERROR        | Record exists (CREATE_ONLY policy)         |
| 6    | BIN_EXISTS_ERROR        | Bin exists (CREATE_ONLY bin policy)        |
| 7    | CLUSTER_KEY_MISMATCH    | Cluster key mismatch                       |
| 8    | SERVER_MEM_ERROR        | Server out of memory                       |
| 9    | TIMEOUT                 | Server-side timeout                        |
| 10   | ALWAYS_FORBIDDEN        | Operation not allowed                      |
| 11   | PARTITION_UNAVAILABLE   | Partition not available                    |
| 12   | BIN_TYPE_ERROR          | Bin type mismatch                          |
| 13   | RECORD_TOO_BIG          | Record exceeds write-block-size            |
| 14   | KEY_BUSY                | Hot key under update                       |
| 16   | SCAN_ABORT              | Scan aborted by user                       |
| 17   | UNSUPPORTED_FEATURE     | Feature not supported in this edition      |
| 18   | BIN_NOT_FOUND           | Bin does not exist                         |
| 19   | DEVICE_OVERLOAD         | Storage device overloaded                  |
| 20   | KEY_MISMATCH            | Key type mismatch                          |
| 21   | NAMESPACE_NOT_FOUND     | Namespace does not exist                   |
| 22   | BIN_NAME_TOO_LONG       | Bin name exceeds maximum length            |
| 23   | FAIL_FORBIDDEN          | Operation forbidden (security)             |
| 24   | FAIL_ELEMENT_NOT_FOUND  | Element not found in CDT                   |
| 25   | FAIL_ELEMENT_EXISTS     | Element already exists in CDT              |
| 26   | ENTERPRISE_ONLY         | Feature requires Enterprise edition        |

---

## Authentication

Aerospike Enterprise supports authentication. The flow uses the AS_MSG protocol with a special `AUTHENTICATE` info message. Port of Call does not currently implement authentication -- connections are unauthenticated.

For secured clusters, the authentication handshake is:

1. Client sends an info protocol message requesting cluster seeds
2. Client sends an `AUTHENTICATE` command (field type 50) with credential bytes
3. Server responds with result code 0 (success) or non-zero (failure)

This requires either internal authentication (username/password hashed with bcrypt) or external LDAP authentication, depending on the cluster's security configuration.

---

## Cluster Discovery

Aerospike clusters are discovered through a seed node. The process:

1. Connect to a seed node and issue the `node` info command to get the node ID
2. Issue the `service` command to get the node's access address
3. Issue the `services` command to get all known peer addresses
4. Issue the `partition-generation` command to detect partition map changes
5. Connect to each peer and repeat to build the full cluster view

Port of Call connects to a single node only. It does not perform cluster discovery, automatic failover, or partition-aware routing. All requests go to the specified host.

For multi-node clusters, you can use the `services` info command to discover peer addresses and then target specific nodes.

---

## Known Limitations

**No authentication:** Connections are unauthenticated. Aerospike Enterprise clusters with security enabled will reject operations with result code 12 (access denied) or close the connection.

**String keys only:** The KV endpoints only support string-type user keys. Integer keys and byte keys require different key particle encoding that is not implemented.

**No cluster awareness:** All requests go to the single specified host. There is no automatic partition routing, retry on different nodes, or cluster topology tracking. If the target node does not own the partition for a given key, the server will proxy the request to the correct node (in Aerospike 4.0+), but this adds latency.

**No TLS:** Connections use plain TCP. Aerospike nodes configured for TLS-only will reject the connection.

**No compression:** The `COMPRESS_RESPONSE` flag is not set. Large responses (e.g., full `statistics` output) are sent uncompressed.

**No batch operations:** Each KV get/put is a single-record operation. Batch reads and batch writes are not supported.

**No CDT operations:** Complex Data Type operations (list, map, bitwise, HLL) are not supported. Only simple read/write of scalar bin values.

**Floating-point numbers:** JavaScript floats are serialized as JSON blobs (BLOB particle type), not as Aerospike DOUBLE particles. Other Aerospike clients will see these as opaque byte arrays rather than native doubles.

**Bin name truncation:** Bin names longer than 15 bytes are silently truncated. No warning is returned.

**Single connection per request:** Each API call opens and closes a TCP connection. There is no connection pooling. For the connect probe, this means six sequential TCP connections.

---

## Practical Examples

### curl

```bash
# Connection probe
curl -s -X POST https://portofcall.ross.gg/api/aerospike/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"aerospike.example.com"}' | jq .

# Check server version
curl -s -X POST https://portofcall.ross.gg/api/aerospike/info \
  -H 'Content-Type: application/json' \
  -d '{"host":"aerospike.example.com","command":"build"}' | jq -r '.parsed._value'

# List namespaces
curl -s -X POST https://portofcall.ross.gg/api/aerospike/info \
  -H 'Content-Type: application/json' \
  -d '{"host":"aerospike.example.com","command":"namespaces"}' | jq -r '.response'

# Get namespace details
curl -s -X POST https://portofcall.ross.gg/api/aerospike/info \
  -H 'Content-Type: application/json' \
  -d '{"host":"aerospike.example.com","command":"namespace/test"}' | jq '.parsed'

# Full server statistics
curl -s -X POST https://portofcall.ross.gg/api/aerospike/info \
  -H 'Content-Type: application/json' \
  -d '{"host":"aerospike.example.com","command":"statistics"}' | jq '.parsed'

# Discover cluster peers
curl -s -X POST https://portofcall.ross.gg/api/aerospike/info \
  -H 'Content-Type: application/json' \
  -d '{"host":"aerospike.example.com","command":"services"}' | jq -r '.response'

# Write a record
curl -s -X POST https://portofcall.ross.gg/api/aerospike/kv-put \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "aerospike.example.com",
    "namespace": "test",
    "set": "users",
    "key": "user:42",
    "bins": {"name": "Alice", "age": 30, "active": true}
  }' | jq .

# Read a record (all bins)
curl -s -X POST https://portofcall.ross.gg/api/aerospike/kv-get \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "aerospike.example.com",
    "namespace": "test",
    "set": "users",
    "key": "user:42"
  }' | jq .

# Read specific bins only
curl -s -X POST https://portofcall.ross.gg/api/aerospike/kv-get \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "aerospike.example.com",
    "namespace": "test",
    "set": "users",
    "key": "user:42",
    "bins": ["name", "age"]
  }' | jq .
```

---

## Useful Info Commands

| Command              | Purpose                                      | Response format          |
|----------------------|----------------------------------------------|--------------------------|
| `build`              | Server version                               | Single value             |
| `status`             | Health check (`ok` or error)                 | Single value             |
| `node`               | Hex node identifier                          | Single value             |
| `edition`            | Enterprise or Community                      | Single value             |
| `cluster-name`       | Cluster name from config                     | Single value             |
| `features`           | Enabled feature flags                        | Semicolon-separated list |
| `namespaces`         | Namespace names                              | Semicolon-separated list |
| `namespace/test`     | Full namespace config and stats              | Key=value pairs          |
| `statistics`         | Server-wide stats (100+ metrics)             | Key=value pairs          |
| `sets`               | All sets across namespaces                   | Key=value pairs          |
| `bins`               | All bin names per namespace                  | Key=value pairs          |
| `sindex`             | Secondary indexes                            | Key=value pairs          |
| `udf-list`           | Registered UDF modules                       | Key=value pairs          |
| `service`            | Node's own access address                    | host:port                |
| `services`           | All known peer access addresses              | Semicolon-separated      |
| `services-alumni`    | Historical peer addresses                    | Semicolon-separated      |
| `peers-generation`   | Peer list generation counter                 | Integer                  |
| `partition-generation`| Partition map generation counter            | Integer                  |
| `logs`               | Log sink configuration                       | Key=value pairs          |
| `jobs:module=query`  | Active query jobs                            | Key=value pairs          |
| `jobs:module=scan`   | Active scan jobs                             | Key=value pairs          |

---

## Resources

- [Aerospike Info Command Reference](https://aerospike.com/docs/tools/asinfo/index.html)
- [Aerospike Wire Protocol (client-server)](https://aerospike.com/docs/server/guide/wire-protocol)
- [Aerospike Result Codes](https://aerospike.com/docs/server/guide/error-codes)
- [RIPEMD-160 specification](https://homes.esat.kuleuven.be/~bosMDCSr/ripemd160.html)
- [Aerospike Architecture Overview](https://aerospike.com/docs/architecture/overview.html)
- [Aerospike C Client Source](https://github.com/aerospike/aerospike-client-c) (canonical protocol implementation)
