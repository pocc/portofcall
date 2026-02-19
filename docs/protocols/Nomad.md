# HashiCorp Nomad Protocol Documentation

## Protocol Overview

**Protocol**: HashiCorp Nomad HTTP API
**Default Port**: 4646 (TCP)
**Transport**: HTTP/1.1 over TCP
**RFC/Spec**: [Nomad HTTP API Documentation](https://developer.hashicorp.com/nomad/api-docs)
**Authentication**: Optional ACL token via `X-Nomad-Token` header or `Authorization: Bearer <token>`

HashiCorp Nomad is a workload orchestrator that provides a RESTful HTTP API for job scheduling, cluster management, and resource allocation. The implementation in Port of Call uses raw TCP sockets to construct HTTP/1.1 requests to interact with Nomad clusters.

## Implementation Architecture

### Core Functions

1. **`sendHttpGet()`** - Constructs and sends HTTP GET requests over raw TCP
2. **`sendHttpPost()`** - Constructs and sends HTTP POST requests over raw TCP
3. **`decodeChunked()`** - Decodes HTTP chunked transfer encoding per RFC 9112 §7.1
4. **`base64Encode()`** - Base64 encodes payload data (Workers-compatible, no `btoa()`)

### API Endpoints Implemented

| Endpoint | Method | Handler Function | Description |
|----------|--------|------------------|-------------|
| `/api/nomad/health` | POST | `handleNomadHealth()` | Agent info, version, leader status |
| `/api/nomad/jobs` | POST | `handleNomadJobs()` | List all jobs in cluster |
| `/api/nomad/nodes` | POST | `handleNomadNodes()` | List all nodes in cluster |
| `/api/nomad/allocations` | POST | `handleNomadAllocations()` | List allocations (all or by job) |
| `/api/nomad/deployments` | POST | `handleNomadDeployments()` | List deployments (all or by job) |
| `/api/nomad/dispatch` | POST | `handleNomadJobDispatch()` | Dispatch parameterized job instance |

## Protocol Compliance

### HTTP/1.1 Request Format

All requests follow HTTP/1.1 specification (RFC 9112):

```
GET /v1/agent/self HTTP/1.1\r\n
Host: nomad.example.com:4646\r\n
Accept: application/json\r\n
Connection: close\r\n
User-Agent: PortOfCall/1.0\r\n
X-Nomad-Token: <acl-token>\r\n
\r\n
```

**Key Headers**:
- `Host`: Required per HTTP/1.1 (includes port if non-standard)
- `Accept: application/json`: Nomad API returns JSON
- `Connection: close`: Single request per TCP connection
- `User-Agent: PortOfCall/1.0`: Identifies client
- `X-Nomad-Token`: ACL authentication token (optional, required if ACLs enabled)
- `Content-Type: application/json`: For POST requests
- `Content-Length`: Byte length of POST body

### HTTP/1.1 Response Parsing

Responses are parsed with full HTTP/1.1 compliance:

1. **Status Line**: `HTTP/1.1 200 OK`
2. **Headers**: Parsed case-insensitively, multi-valued headers concatenated with `, `
3. **Body**: Separated from headers by `\r\n\r\n`
4. **Chunked Transfer Encoding**: Decoded per RFC 9112 §7.1 if `Transfer-Encoding: chunked` present

**Chunked Encoding Handling**:
- Chunk format: `chunk-size [; chunk-ext] CRLF chunk-data CRLF`
- Chunk extensions (e.g., `1a;name=value`) are stripped before parsing hex size
- Zero-sized chunk (`0\r\n\r\n`) terminates the body
- Trailer headers after final chunk are ignored (not required for Nomad API)

### Nomad-Specific Protocol Details

**API Version**: All endpoints prefixed with `/v1/`

**Authentication**:
- Token passed via `X-Nomad-Token` header
- Alternative: `Authorization: Bearer <token>` (RFC 6750)
- Required when ACL system is enabled on cluster

**Namespaces**:
- Query parameter: `?namespace=<name>`
- Default namespace: `default`
- Wildcard: `?namespace=*` queries across all namespaces

**Pagination**:
- Query parameter: `?per_page=<count>`
- Next token in response header: `X-Nomad-Nexttoken`
- Use `?next_token=<value>` for subsequent pages

**Consistency Modes**:
- Default: Strong consistency from leader
- Stale reads: `?stale=true` (allows any server to respond)

**Blocking Queries**:
- Use `?index=<value>` with `X-Nomad-Index` from previous response
- Long-polling for resource changes

## API Endpoint Details

### 1. Health Check (`/api/nomad/health`)

**Purpose**: Verify Nomad agent connectivity and retrieve cluster metadata

**Request Body**:
```json
{
  "host": "nomad.example.com",
  "port": 4646,
  "token": "acl-token-here",
  "timeout": 15000
}
```

**Nomad Endpoints Called**:
- `GET /v1/agent/self` - Agent configuration and stats
- `GET /v1/status/leader` - Current Raft leader address

**Response**:
```json
{
  "success": true,
  "host": "nomad.example.com",
  "port": 4646,
  "rtt": 123,
  "statusCode": 200,
  "version": "1.7.5",
  "region": "global",
  "datacenter": "dc1",
  "nodeName": "nomad-server-1",
  "server": true,
  "leader": "10.0.1.5:4647",
  "raftPeers": "3",
  "protocol": "Nomad",
  "message": "Nomad connected in 123ms"
}
```

**Field Extraction**:
- `version`: From `config.Version` or `stats.nomad.version`
- `region`: From `config.Region`
- `datacenter`: From `config.Datacenter`
- `nodeName`: From `member.Name` or `config.NodeName`
- `server`: From `config.Server.Enabled` or `stats.nomad.server === "true"`
- `raftPeers`: From `stats.raft.num_peers`

**Error Handling**:
- Cloudflare IP detection: Returns 403 with `isCloudflare: true`
- Connection timeout: 15 seconds default (configurable)
- Leader endpoint failure: Continues without leader info (optional data)

### 2. List Jobs (`/api/nomad/jobs`)

**Purpose**: Retrieve all jobs registered with the Nomad cluster

**Request Body**:
```json
{
  "host": "nomad.example.com",
  "port": 4646,
  "token": "acl-token-here",
  "timeout": 15000
}
```

**Nomad Endpoint**: `GET /v1/jobs`

**Response**:
```json
{
  "success": true,
  "host": "nomad.example.com",
  "port": 4646,
  "rtt": 45,
  "statusCode": 200,
  "jobs": [
    {
      "id": "example",
      "name": "example",
      "type": "service",
      "status": "running",
      "priority": 50
    }
  ],
  "jobCount": 1,
  "message": "Found 1 job(s)"
}
```

**Job Summary Fields**:
- `id`: Unique job identifier
- `name`: Human-readable job name
- `type`: Job type (`service`, `batch`, `system`)
- `status`: Current job status (`running`, `dead`, `pending`)
- `priority`: Integer priority (0-100, default 50)

### 3. List Nodes (`/api/nomad/nodes`)

**Purpose**: Retrieve all nodes (clients and servers) in the Nomad cluster

**Request Body**:
```json
{
  "host": "nomad.example.com",
  "port": 4646,
  "token": "acl-token-here",
  "timeout": 15000
}
```

**Nomad Endpoint**: `GET /v1/nodes`

**Response**:
```json
{
  "success": true,
  "host": "nomad.example.com",
  "port": 4646,
  "rtt": 38,
  "statusCode": 200,
  "nodes": [
    {
      "id": "a1b2c3d4...",
      "name": "nomad-client-1",
      "datacenter": "dc1",
      "status": "ready",
      "schedulingEligibility": "eligible",
      "nodeClass": "",
      "drain": false
    }
  ],
  "nodeCount": 1,
  "message": "Found 1 node(s)"
}
```

**Node Summary Fields**:
- `id`: Full node ID (truncated to first 8 chars + `...` in response)
- `name`: Node hostname or configured name
- `datacenter`: Datacenter assignment
- `status`: Node status (`ready`, `down`, `initializing`)
- `schedulingEligibility`: Whether node can receive allocations (`eligible`, `ineligible`)
- `nodeClass`: Optional node class constraint
- `drain`: Whether node is draining (evacuating allocations)

### 4. List Allocations (`/api/nomad/allocations`)

**Purpose**: List allocations (running job instances) cluster-wide or per-job

**Request Body**:
```json
{
  "host": "nomad.example.com",
  "port": 4646,
  "token": "acl-token-here",
  "jobId": "example",
  "namespace": "default",
  "timeout": 10000
}
```

**Nomad Endpoints**:
- All allocations: `GET /v1/allocations`
- Job-specific: `GET /v1/job/{jobId}/allocations`
- With namespace: `?namespace={namespace}`

**Response**:
```json
{
  "success": true,
  "host": "nomad.example.com",
  "port": 4646,
  "rtt": 29,
  "allocationCount": 2,
  "allocations": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "jobId": "example",
      "taskGroup": "web",
      "clientStatus": "running",
      "desiredStatus": "run",
      "createTime": 1708275600000000000,
      "modifyTime": 1708275605000000000
    }
  ]
}
```

**Allocation Fields**:
- `id`: Allocation UUID
- `jobId`: Parent job ID
- `taskGroup`: Task group name from job specification
- `clientStatus`: Actual status on node (`running`, `failed`, `complete`, `lost`)
- `desiredStatus`: Scheduler's desired state (`run`, `stop`, `evict`)
- `createTime`: Nanosecond timestamp of allocation creation
- `modifyTime`: Nanosecond timestamp of last modification

### 5. List Deployments (`/api/nomad/deployments`)

**Purpose**: List deployments (rolling updates) cluster-wide or per-job

**Request Body**:
```json
{
  "host": "nomad.example.com",
  "port": 4646,
  "token": "acl-token-here",
  "jobId": "example",
  "namespace": "default",
  "timeout": 10000
}
```

**Nomad Endpoints**:
- All deployments: `GET /v1/deployments`
- Job-specific: `GET /v1/job/{jobId}/deployments`
- With namespace: `?namespace={namespace}`

**Response**:
```json
{
  "success": true,
  "host": "nomad.example.com",
  "port": 4646,
  "rtt": 31,
  "deploymentCount": 1,
  "deployments": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "jobId": "example",
      "namespace": "default",
      "status": "successful",
      "statusDescription": "Deployment completed successfully",
      "taskGroups": {
        "web": {
          "Promoted": true,
          "DesiredTotal": 3,
          "PlacedAllocs": 3,
          "HealthyAllocs": 3
        }
      }
    }
  ]
}
```

**Deployment Fields**:
- `id`: Deployment UUID
- `jobId`: Parent job ID
- `namespace`: Job namespace
- `status`: Deployment status (`running`, `successful`, `failed`, `cancelled`, `blocked`)
- `statusDescription`: Human-readable status message
- `taskGroups`: Per-group deployment progress (desired, placed, healthy counts)

### 6. Job Dispatch (`/api/nomad/dispatch`)

**Purpose**: Dispatch a parameterized job instance (batch job from template)

**Request Body**:
```json
{
  "host": "nomad.example.com",
  "port": 4646,
  "token": "acl-token-here",
  "jobId": "batch-template",
  "payload": "input data here",
  "meta": {
    "key1": "value1",
    "key2": "value2"
  },
  "namespace": "default",
  "timeout": 10000
}
```

**Nomad Endpoint**: `POST /v1/job/{jobId}/dispatch[?namespace={namespace}]`

**Request to Nomad**:
```json
{
  "Payload": "aW5wdXQgZGF0YSBoZXJl",
  "Meta": {
    "key1": "value1",
    "key2": "value2"
  }
}
```

**Notes**:
- `Payload`: Base64-encoded string (binary-safe)
- `Meta`: Key-value metadata passed to dispatched job
- Job must be parameterized (`Type = "batch"`, `ParameterizedJob` block defined)

**Response**:
```json
{
  "success": true,
  "host": "nomad.example.com",
  "port": 4646,
  "rtt": 42,
  "dispatchedJobId": "batch-template/dispatch-1708275600-a1b2c3d4",
  "evalId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Response Fields**:
- `dispatchedJobId`: Full ID of created job instance
- `evalId`: Evaluation UUID (scheduler assigns resources based on this)

## Error Handling

### HTTP Status Codes

| Status Code | Meaning | Handler Behavior |
|-------------|---------|------------------|
| 200 | Success | `success: true` |
| 403 | Forbidden (ACL) | `success: false`, check token |
| 404 | Not Found | Job/node/allocation doesn't exist |
| 500 | Internal Server Error | Nomad server error |

### Cloudflare IP Detection

Port of Call includes built-in Cloudflare IP detection to prevent accidental exposure:

```json
{
  "success": false,
  "error": "Cloudflare IPs (1.1.1.1) are blocked to prevent exposure",
  "isCloudflare": true
}
```

**HTTP Status**: 403 Forbidden

### Connection Errors

**Timeout**: Default 15 seconds for health/jobs/nodes, 10 seconds for allocations/deployments/dispatch

```json
{
  "success": false,
  "error": "Connection timeout"
}
```

**HTTP Status**: 500 Internal Server Error

### JSON Parse Errors

If Nomad returns invalid JSON or non-JSON response:
- Arrays default to `[]`
- Objects default to `null`
- No exception thrown (graceful degradation)

## Security Considerations

### ACL Tokens

- Tokens are transmitted in plaintext HTTP headers
- **Recommendation**: Use TLS (HTTPS) in production
- Port of Call uses raw TCP (no TLS) - suitable for internal/development clusters only
- For production: Use Nomad's TLS mode and terminate TLS at reverse proxy

### Token Storage

- Tokens are not stored by Port of Call
- Passed in POST body per-request
- Client (browser/app) responsible for secure token storage

### Cloudflare Protection

- Prevents accidental querying of Cloudflare IPs (1.1.1.1, 1.0.0.1, etc.)
- Reduces risk of exposing internal Nomad cluster to public DNS resolvers
- Can be bypassed by using direct IP addresses

### Input Validation

- Port range: 1-65535
- Host: Required, no validation (allows IPs, hostnames, localhost)
- Timeout: Capped at configured value (15s or 10s)
- JobId, namespace: URL-encoded to prevent path traversal

## Performance Characteristics

### RTT (Round-Trip Time)

All endpoints measure and return `rtt` in milliseconds:
- Includes TCP handshake, HTTP request, server processing, HTTP response
- Does not include DNS resolution (host resolved by Cloudflare Workers)

### Timeout Behavior

- Health/jobs/nodes: 15 seconds default
- Allocations/deployments/dispatch: 10 seconds default
- Shorter timeout for frequent queries to prevent worker timeout

### Response Size Limits

- Maximum response size: 512 KB per request
- Prevents memory exhaustion on Workers
- Large clusters may need pagination (not currently implemented)

## Testing & Debugging

### Minimal Health Check

```bash
curl -X POST https://portofcall.example.com/api/nomad/health \
  -H "Content-Type: application/json" \
  -d '{
    "host": "nomad.example.com",
    "port": 4646
  }'
```

### With ACL Token

```bash
curl -X POST https://portofcall.example.com/api/nomad/health \
  -H "Content-Type: application/json" \
  -d '{
    "host": "nomad.example.com",
    "port": 4646,
    "token": "your-acl-token-here"
  }'
```

### List Jobs in Specific Namespace

```bash
curl -X POST https://portofcall.example.com/api/nomad/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "host": "nomad.example.com",
    "port": 4646,
    "token": "your-acl-token-here"
  }'
```

**Note**: Namespace is not supported in `/jobs` endpoint (returns all namespaces). For namespace filtering, use `/allocations` or `/deployments` with `namespace` parameter.

### Dispatch Parameterized Job

```bash
curl -X POST https://portofcall.example.com/api/nomad/dispatch \
  -H "Content-Type: application/json" \
  -d '{
    "host": "nomad.example.com",
    "port": 4646,
    "token": "your-acl-token-here",
    "jobId": "batch-template",
    "payload": "process this data",
    "meta": {
      "user": "admin",
      "priority": "high"
    }
  }'
```

### Common Issues

**Issue**: `success: false, error: "Host is required"`
**Solution**: Include `"host"` in POST body

**Issue**: `success: false, error: "Port must be between 1 and 65535"`
**Solution**: Use valid port number (default: 4646)

**Issue**: `statusCode: 403` (ACL disabled cluster)
**Solution**: Remove `token` parameter or enable ACLs on Nomad

**Issue**: `statusCode: 403` (ACL enabled cluster, no token)
**Solution**: Provide valid ACL token

**Issue**: Empty `jobs`, `nodes`, `allocations` arrays
**Solution**: Check namespace, verify jobs/nodes exist in cluster

**Issue**: `isCloudflare: true` error
**Solution**: Use actual Nomad cluster IP/hostname, not public DNS resolver

## Implementation Notes

### Why Raw TCP Instead of `fetch()`?

1. **Protocol Learning**: Port of Call demonstrates low-level HTTP protocol construction
2. **Header Control**: Full control over HTTP headers and connection lifecycle
3. **Binary Safety**: Direct byte access for chunked encoding, base64, etc.
4. **Educational**: Shows HTTP/1.1 wire format explicitly

### Chunked Transfer Encoding Edge Cases

- **Chunk extensions**: Properly stripped per RFC 9112 (e.g., `1a;name=value`)
- **Trailers**: Ignored (not needed for Nomad JSON responses)
- **Large chunks**: Size field can be arbitrarily large hex (no integer overflow)
- **Incomplete chunks**: Gracefully handle truncated responses

### Base64 Encoding (Workers-Compatible)

- **No `btoa()`**: Cloudflare Workers don't have browser APIs
- **Custom implementation**: RFC 4648 base64 encoding from scratch
- **UTF-8 safe**: Uses `TextEncoder` to convert string to bytes first
- **Padding**: Proper `=` padding for non-multiple-of-3 byte lengths

### Case-Insensitive Header Handling

- All header keys lowercased for lookup
- Per RFC 9110 §5.1, header field names are case-insensitive
- Multi-valued headers concatenated with `, ` per RFC 9110 §5.3

## Future Enhancements

### Not Currently Implemented

1. **Pagination**: No `X-Nomad-Nexttoken` handling (returns first page only)
2. **Blocking Queries**: No long-polling with `?index=` parameter
3. **TLS Support**: Raw TCP only (no encrypted connections)
4. **Regions**: Multi-region clusters not supported (queries default region)
5. **HTTP/2**: Nomad supports HTTP/2, but implementation uses HTTP/1.1 only
6. **Job Submission**: Can dispatch parameterized jobs, but not submit new job specs
7. **Evaluations**: No `/v1/evaluations` endpoint (created by dispatch, not queryable)
8. **Logs/Exec**: No streaming endpoints (`/v1/client/fs/*`, `/v1/client/allocation/{id}/exec`)

### Potential Improvements

1. **Streaming Responses**: Handle `Transfer-Encoding: chunked` in real-time (currently buffers full response)
2. **Connection Pooling**: Reuse TCP connections for multiple requests (currently `Connection: close`)
3. **Compression**: Request `Accept-Encoding: gzip` (requires deflate implementation)
4. **Pretty Print**: Add `?pretty=true` query parameter to Nomad requests for debugging
5. **Error Details**: Parse Nomad JSON error responses (e.g., `{"errors": [...]}`)

## References

- [Nomad HTTP API Documentation](https://developer.hashicorp.com/nomad/api-docs)
- [RFC 9112: HTTP/1.1](https://datatracker.ietf.org/doc/html/rfc9112)
- [RFC 9110: HTTP Semantics](https://datatracker.ietf.org/doc/html/rfc9110)
- [RFC 6750: OAuth 2.0 Bearer Token](https://datatracker.ietf.org/doc/html/rfc6750)
- [RFC 4648: Base64 Encoding](https://datatracker.ietf.org/doc/html/rfc4648)
- [Nomad ACL System](https://developer.hashicorp.com/nomad/tutorials/access-control)
- [Nomad Parameterized Jobs](https://developer.hashicorp.com/nomad/docs/job-specification/parameterized)

---

**Last Updated**: 2026-02-18
**Implementation File**: `/Users/rj/gd/code/portofcall/src/worker/nomad.ts`
**API Version**: Nomad API v1 (tested with Nomad 1.6+)
