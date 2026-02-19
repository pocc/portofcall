# Kibana Protocol — Power-User Reference

**Protocol:** Kibana HTTP REST API over TCP
**Default Port:** 5601
**Transport:** HTTP/1.1 over TCP (no TLS support in this implementation)
**RFCs:** None (Elastic proprietary API)
**Docs:** https://www.elastic.co/guide/en/kibana/current/api.html
**Implementation:** `/Users/rj/gd/code/portofcall/src/worker/kibana.ts`

## Overview

Kibana is the visualization and dashboarding layer for Elasticsearch and OpenSearch. This implementation provides HTTP/1.1 REST API access over raw TCP sockets to query server status, list saved objects (dashboards, visualizations), manage data views, check alerting rules, and proxy queries to Elasticsearch.

### Key Characteristics

- **Unauthenticated health endpoint:** `/api/status` returns version and plugin status without auth
- **XSRF protection:** All mutating requests (POST/PUT/DELETE) require `kbn-xsrf: true` header
- **Spaces support:** Multi-tenancy via `/s/{space}` URL prefix (Kibana 7.0+)
- **Version detection:** API endpoints differ between v7 (`/api/index_patterns`, `/api/alerts/_find`) and v8+ (`/api/data_views`, `/api/alerting/rules/_find`)
- **Auth methods:** Basic auth, API key, or none (for public endpoints)

## Endpoints

### 1. Status & Health (`POST /api/kibana/status`)

Get server health, version, and plugin status. This endpoint is **unauthenticated** by default.

**Request Body:**
```json
{
  "host": "kibana.example.com",  // required
  "port": 5601                    // optional, default 5601
}
```

**Response:**
```json
{
  "success": true,
  "host": "kibana.example.com",
  "port": 5601,
  "statusCode": 200,
  "version": {
    "number": "8.12.0",
    "buildHash": "a1b2c3d4e5f6",
    "buildNumber": 72345,
    "buildSnapshot": false
  },
  "health": {
    "state": "green",
    "title": "Green",
    "nickname": "Looking good"
  },
  "pluginCount": 127,
  "responseTime": 234  // milliseconds
}
```

**Error Response (Cloudflare detected):**
```json
{
  "error": "Cannot connect to Cloudflare IPs (103.21.244.0/22). Use curl/nslookup on your machine instead."
}
```

**HTTP Mapping:**
`GET /api/status` → Kibana server

**Fields:**
- `version.number`: Kibana version (e.g., "8.12.0", "7.17.18")
- `version.buildHash`: Git commit hash (truncated to 12 chars)
- `health.state`: Overall status ("green", "yellow", "red")
- `health.nickname`: Human-friendly status message
- `pluginCount`: Number of installed plugins with status data

**When to use:** Initial connectivity test, version discovery, pre-flight health check.

---

### 2. Saved Objects Search (`POST /api/kibana/saved-objects`)

List dashboards, visualizations, index patterns, searches, or other saved objects.

**Request Body:**
```json
{
  "host": "kibana.example.com",
  "port": 5601,
  "type": "dashboard",           // default: "dashboard"
  "perPage": 20,                  // default: 20
  "username": "elastic",          // optional
  "password": "changeme",         // optional
  "api_key": "base64Key",         // optional (use instead of user/pass)
  "space": "marketing",           // optional (Kibana spaces)
  "timeout": 15000                // optional, default 15000ms
}
```

**Supported types:**
- `dashboard` — Dashboards
- `visualization` — Visualizations (charts, graphs)
- `index-pattern` — Index patterns (v7)
- `search` — Saved searches
- `lens` — Lens visualizations (v7.10+)
- `map` — Maps (v7.6+)
- `canvas-workpad` — Canvas workpads

**Response:**
```json
{
  "success": true,
  "host": "kibana.example.com",
  "port": 5601,
  "type": "dashboard",
  "statusCode": 200,
  "total": 47,
  "perPage": 20,
  "objects": [
    {
      "id": "722b74f0-b882-11e8-a6d9-e546fe2bba5f",
      "type": "dashboard",
      "title": "Web Traffic Overview",
      "description": "HTTP logs dashboard",
      "updated": "2024-12-15T18:32:10.945Z"
    }
  ],
  "responseTime": 189
}
```

**Error Response (401 Unauthorized):**
```json
{
  "success": false,
  "statusCode": 401,
  "total": 0,
  "perPage": 20,
  "objects": [],
  "responseTime": 87,
  "error": "{\"statusCode\":401,\"error\":\"Unauthorized\",\"message\":\"[security_exception] missing authentication credentials\"}"
}
```

**HTTP Mapping:**
`GET /api/saved_objects/_find?type={type}&per_page={perPage}` → Kibana
(with optional `/s/{space}` prefix)

**Auth:** Required on secured Kibana instances. Use `username`/`password` (Basic auth) or `api_key`.

**When to use:** Dashboard inventory, finding visualizations by type, auditing saved objects.

---

### 3. Data Views / Index Patterns (`POST /api/kibana/index-patterns`)

List data views (Kibana 8+) or index patterns (Kibana 7).

**Request Body:**
```json
{
  "host": "kibana.example.com",
  "port": 5601,
  "username": "elastic",
  "password": "changeme",
  "space": "default",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "kibana.example.com",
  "port": 5601,
  "statusCode": 200,
  "responseTime": 156,
  "total": 3,
  "dataViews": [
    {
      "id": "logs-*",
      "name": "logs-*",
      "title": "logs-*",
      "timeFieldName": "@timestamp",
      "namespaces": ["default"]
    },
    {
      "id": "metrics-system-*",
      "name": "System Metrics",
      "title": "metrics-system-*",
      "timeFieldName": "timestamp",
      "namespaces": ["default", "monitoring"]
    }
  ]
}
```

**HTTP Mapping:**
1. Try `GET /api/data_views` (Kibana 8+)
2. Fallback to `GET /api/index_patterns` (Kibana 7) if 404

**Version Compatibility:**
- Kibana 8.0+: Uses Data Views API
- Kibana 7.x: Uses Index Patterns API
- Both return similar structure (implementation normalizes)

**Fields:**
- `id`: Data view identifier (often matches title)
- `name`: Human-readable name (v8) or title (v7)
- `title`: Index pattern (wildcards allowed: `logs-*`)
- `timeFieldName`: Primary time field for time-series data
- `namespaces`: Which Kibana spaces include this data view

**When to use:** Discovering available indices, validating time field configuration, multi-space audits.

---

### 4. Alerting Rules (`POST /api/kibana/alerts`)

List alerting rules (Kibana 8+) or legacy alerts (Kibana 7).

**Request Body:**
```json
{
  "host": "kibana.example.com",
  "port": 5601,
  "username": "elastic",
  "password": "changeme",
  "space": "security",
  "timeout": 15000
}
```

**Response:**
```json
{
  "success": true,
  "host": "kibana.example.com",
  "port": 5601,
  "statusCode": 200,
  "responseTime": 203,
  "total": 12,
  "rules": [
    {
      "id": "8f3e7a10-5c9b-11ed-bdc3-0242ac120002",
      "name": "High CPU Usage",
      "enabled": true,
      "ruleTypeId": "metrics.alert.threshold",
      "schedule": {
        "interval": "1m"
      },
      "tags": ["performance", "system"],
      "executionStatus": {
        "status": "ok",
        "lastExecutionDate": "2024-12-20T14:32:15.234Z"
      },
      "lastRun": {
        "outcome": "succeeded",
        "alertsCount": {
          "active": 0,
          "new": 0,
          "recovered": 2
        }
      },
      "nextRun": "2024-12-20T14:33:15.234Z"
    }
  ]
}
```

**HTTP Mapping:**
1. Try `GET /api/alerting/rules/_find?per_page=50` (Kibana 8+)
2. Fallback to `GET /api/alerts/_find?per_page=50` (Kibana 7) if 404

**Fields:**
- `ruleTypeId`: Type of alert (e.g., `metrics.alert.threshold`, `xpack.ml.anomaly_detection`)
- `schedule.interval`: Execution frequency (cron or interval syntax)
- `executionStatus.status`: Current state ("ok", "error", "pending", "unknown")
- `lastRun.outcome`: Result of last execution ("succeeded", "failed", "warning")
- `lastRun.alertsCount`: Count of active/new/recovered alerts

**When to use:** Alert inventory, checking execution status, finding disabled/failing rules.

---

### 5. Elasticsearch Proxy (`POST /api/kibana/query`)

Send raw Elasticsearch queries via Kibana's console proxy API.

**Request Body:**
```json
{
  "host": "kibana.example.com",
  "port": 5601,
  "query": "_cat/indices?v",     // Elasticsearch path (default)
  "body": "{\"query\":{\"match_all\":{}}}",  // optional POST body
  "username": "elastic",
  "password": "changeme",
  "space": "default",
  "timeout": 15000
}
```

**Response (text query):**
```json
{
  "success": true,
  "host": "kibana.example.com",
  "port": 5601,
  "statusCode": 200,
  "responseTime": 145,
  "esPath": "_cat/indices?v",
  "result": "health status index     pri rep docs.count docs.deleted store.size pri.store.size\ngreen  open   logs-001  1   1    1234567            0      2.1gb          1gb\n"
}
```

**Response (JSON query):**
```json
{
  "success": true,
  "host": "kibana.example.com",
  "port": 5601,
  "statusCode": 200,
  "responseTime": 98,
  "esPath": "_search",
  "result": {
    "took": 23,
    "hits": {
      "total": {"value": 10000, "relation": "gte"},
      "max_score": 1.0,
      "hits": [...]
    }
  }
}
```

**Error Response (403 Forbidden):**
```json
{
  "success": false,
  "statusCode": 403,
  "responseTime": 56,
  "esPath": "_cluster/settings",
  "result": null,
  "error": "{\"statusCode\":403,\"error\":\"Forbidden\",\"message\":\"action [cluster:monitor/settings/get] is unauthorized\"}"
}
```

**HTTP Mapping:**
`POST /api/console/proxy?path={esPath}&method={GET|POST}` → Kibana → Elasticsearch

**Path Handling:**
- Leading slash added if missing: `_cat/indices` → `/_cat/indices`
- Query parameters preserved: `_cat/indices?v&h=index,docs.count`
- Spaces encoded to `%20`, but slashes remain literal (Kibana console proxy requirement)

**Method Selection:**
- If `body` provided: `POST` to Elasticsearch
- If no `body`: `GET` to Elasticsearch

**Common Queries:**
- `_cat/indices?v` — List all indices
- `_cat/nodes?v` — Cluster nodes
- `_cluster/health` — Cluster health
- `logs-*/_search` — Search logs index
- `_cluster/settings?include_defaults=true` — All cluster settings

**When to use:** Ad-hoc Elasticsearch queries without direct ES access, debugging index issues, checking cluster state.

---

## Authentication

### Basic Auth

```json
{
  "username": "elastic",
  "password": "changeme"
}
```

**HTTP Header:** `Authorization: Basic ZWxhc3RpYzpjaGFuZ2VtZQ==`
**Encoding:** Base64 of `username:password`

### API Key

```json
{
  "api_key": "VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw=="
}
```

**HTTP Header:** `Authorization: ApiKey {api_key}`
**Format:** Base64-encoded API key (generated in Kibana Security UI)

### No Auth

- `/api/status` is unauthenticated by default
- Secured Kibana instances may require auth for all endpoints

**Priority:** If both `api_key` and `username`/`password` are provided, API key takes precedence.

---

## Protocol Details

### HTTP Request Flow

```
Client → Worker → Kibana
         │
         └──> TCP socket to kibana.example.com:5601
              │
              ├─> GET /api/status HTTP/1.1
              │   Host: kibana.example.com:5601
              │   Accept: application/json
              │   Connection: close
              │   User-Agent: PortOfCall/1.0
              │
              └─< HTTP/1.1 200 OK
                  Content-Type: application/json
                  Transfer-Encoding: chunked

                  {"name":"kibana-instance",...}
```

### XSRF Protection

Kibana requires `kbn-xsrf` header on **all mutating requests** (POST, PUT, DELETE) to prevent cross-site request forgery.

**Implementation:**
```javascript
if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
  req += `kbn-xsrf: true\r\n`;
}
```

**Not required for:**
- GET requests
- HEAD requests
- OPTIONS requests

### Chunked Transfer Encoding

Kibana frequently responds with `Transfer-Encoding: chunked`. The implementation decodes:

```
5\r\n
Hello\r\n
6\r\n
 World\r\n
0\r\n
\r\n
```

Decodes to: `Hello World`

**RFC 7230 §4.1 Compliance:**
- Chunk size parsed as hexadecimal
- Chunk extensions (`;name=value`) are stripped before parsing size
- Final `0` chunk stops decoding (trailer headers ignored)
- Maximum body size: 512,000 bytes (prevents memory exhaustion)

**Bug Fixed (2026-02-18):**
Now correctly strips chunk extensions and handles final chunk terminator per RFC 7230 §4.1.

---

## Spaces (Multi-Tenancy)

Kibana Spaces provide isolated environments within a single instance.

**URL Prefix:** `/s/{space_id}/api/...`

**Examples:**
- Default space: `/api/saved_objects/_find`
- Marketing space: `/s/marketing/api/saved_objects/_find`
- Security space: `/s/security/api/alerting/rules/_find`

**Space isolation:**
- Saved objects (dashboards, visualizations) are space-scoped
- Data views can span multiple spaces (see `namespaces` field)
- Index patterns are globally visible in v7, space-scoped in v8

**Request:**
```json
{
  "host": "kibana.example.com",
  "space": "marketing"
}
```

**No space parameter:** Queries the default space.

---

## Version Compatibility

### Kibana 8.x

- Data Views API: `/api/data_views`
- Alerting API: `/api/alerting/rules/_find`
- Saved Objects API: `/api/saved_objects/_find` (unchanged)
- Console Proxy: `/api/console/proxy` (unchanged)

### Kibana 7.x

- Index Patterns API: `/api/index_patterns`
- Alerts API: `/api/alerts/_find` (legacy alerting)
- Saved Objects API: `/api/saved_objects/_find`
- Console Proxy: `/api/console/proxy`

### OpenSearch / OpenSearch Dashboards

This implementation **may** work with OpenSearch Dashboards (forked from Kibana 7.10.2) but is untested. Expect:
- `/api/status` to work
- `/api/saved_objects/_find` to work
- `/api/index_patterns` to work
- `/api/console/proxy` may have different behavior

---

## Quirks & Limitations

### 1. No TLS Support

**Impact:** Cannot connect to HTTPS endpoints.
**Workaround:** Use a TLS-terminating proxy (nginx, HAProxy) on localhost, then connect to the proxy.

**Example nginx config:**
```nginx
server {
  listen 5601;
  location / {
    proxy_pass https://kibana.example.com:5601;
    proxy_ssl_verify off;  # for self-signed certs
  }
}
```

Then query `localhost:5601` via this implementation.

### 2. No Connection Reuse

**What happens:** Every API call opens a new TCP connection.
**HTTP header sent:** `Connection: close`
**Impact:** Higher latency for repeated queries (3-way handshake per request).
**Best practice:** Kibana API is designed for persistent connections, but this implementation doesn't support it.

### 3. Shared Timeout for Connect + Response

**Behavior:** The `timeout` parameter applies to:
1. TCP connection establishment
2. Full HTTP response (headers + body)

**Example:** 15-second timeout means:
- If connection takes 10s, only 5s remain for the response
- If response is slow, connection may succeed but timeout during body read

**No separate timeouts** for connect vs. read phases.

### 4. Maximum Response Size: 512KB

**What happens:** If the response body exceeds 512,000 bytes, reading stops.
**Failure mode:** Truncated JSON (parse error likely).
**Why:** Memory protection in Cloudflare Workers environment.

**Workaround:** Use pagination:
- Saved objects: reduce `perPage` (default 20, max 10000)
- Alerting rules: hardcoded `per_page=50`
- Console proxy queries: add `size=10` to ES queries

### 5. Cloudflare Detection on `/status` Only

**What's checked:** Only `handleKibanaStatus` calls `checkIfCloudflare(host)`.
**What's not checked:** All other endpoints (saved objects, alerts, data views, console proxy).

**Why:** Health checks are most likely to accidentally target public Cloudflare IPs. Other endpoints require explicit auth, so accidental queries are less likely.

**Blocked ranges:**
- 103.21.244.0/22
- 103.22.200.0/22
- 103.31.4.0/22
- 104.16.0.0/13
- (and ~100 other Cloudflare ranges)

### 6. No Input Validation for `host`

**What's missing:** No regex to validate hostname format.
**Risk:** Invalid hostnames fail at socket connection (error caught, 500 response).
**Examples that fail gracefully:**
- `http://kibana.example.com` (URL instead of hostname)
- `kibana:5601` (port in hostname)
- `192.168.1.256` (invalid IP)

**Socket layer rejects invalid input**, so no injection risk.

### 7. API Key Priority Over Basic Auth

**Behavior:** If both `api_key` and `username`/`password` are provided, only API key is sent.

```javascript
if (apiKey) {
  req += `Authorization: ApiKey ${apiKey}\r\n`;
} else if (username && password) {
  req += `Authorization: Basic ${btoa(`${username}:${password}`)}\r\n`;
}
```

**No error if both are present** — API key silently wins.

### 8. Version Fallback Assumes v7 on 404

**Logic:**
1. Try v8 endpoint (`/api/data_views`, `/api/alerting/rules/_find`)
2. If 404, retry with v7 endpoint (`/api/index_patterns`, `/api/alerts/_find`)

**Problem:** A 404 on the v8 endpoint could mean:
- Kibana v7 (expected)
- Kibana v8 with endpoint disabled
- Typo in URL
- Auth failure returning 404 instead of 401

**No version detection before query** — fallback is based on response code only.

### 9. Console Proxy Path Encoding

**Literal slashes preserved:** The `path` parameter in `/api/console/proxy?path=...` expects **unencoded slashes**.

**Implementation:**
```javascript
const encodedPath = esPath.replace(/ /g, '%20');
const proxyPath = `/api/console/proxy?path=${encodedPath}&method=${esMethod}`;
```

**Only spaces are encoded.** All other special characters (including `/`, `?`, `=`) are passed through.

**Why:** Kibana console proxy interprets the path parameter as a literal Elasticsearch path, not a URL-encoded string.

**Example:**
- Query: `_cat/indices?v&h=index,docs.count`
- Proxy URL: `/api/console/proxy?path=/_cat/indices?v&h=index,docs.count&method=GET`
- Elasticsearch sees: `GET /_cat/indices?v&h=index,docs.count`

### 10. No Pagination for Large Result Sets

**Hardcoded limits:**
- Saved objects: `per_page` from request (default 20, max 10000)
- Alerting rules: `per_page=50` (hardcoded)
- Data views: No pagination (returns all)

**No automatic follow-up requests** to fetch additional pages.

**Workaround:** Call multiple times with `page` parameter:
```bash
# Page 1
curl -X POST http://localhost:8787/api/kibana/saved-objects \
  -d '{"host":"kibana","perPage":100}'

# Page 2 (not implemented — would need `page` param support)
```

**Missing feature:** No `page` or `search_after` parameter in request body.

### 11. Error Messages Truncated to 500 Chars

**Code:**
```javascript
error: resp.statusCode !== 200 ? resp.body.substring(0, 500) : undefined
```

**Impact:** Elasticsearch error stack traces are often >500 chars. Full error context may be lost.

**Example truncated error:**
```json
{
  "error": "{\"error\":{\"root_cause\":[{\"type\":\"security_exception\",\"reason\":\"action [indices:data/read/search] is unauthorized for user [viewer] on indices [logs-sensitive-2024], this action is granted by the index privileges [read,all]\"}],\"type\":\"security_exception\",\"reason\":\"action [indices:data/read/search] is unauthorized for user [viewer] on indices [logs-sensitive-2024"
}
```

**Full error requires increasing truncation limit** (hardcoded).

### 12. No Support for POST/PUT/DELETE on Saved Objects

**Implemented methods:**
- `GET /api/status`
- `GET /api/saved_objects/_find`
- `GET /api/data_views` / `GET /api/index_patterns`
- `GET /api/alerting/rules/_find`
- `POST /api/console/proxy` (read-only queries to ES)

**Missing:**
- `POST /api/saved_objects/{type}` — Create dashboard/visualization
- `PUT /api/saved_objects/{type}/{id}` — Update saved object
- `DELETE /api/saved_objects/{type}/{id}` — Delete saved object
- `POST /api/alerting/rules` — Create alerting rule

**Read-only implementation** — no mutations except via console proxy to Elasticsearch.

### 13. Console Proxy Body Must Be JSON String

**Request field:** `body` (optional)
**Type:** `string` (not object)

**Correct:**
```json
{
  "query": "_search",
  "body": "{\"query\":{\"match_all\":{}}}"
}
```

**Incorrect:**
```json
{
  "query": "_search",
  "body": {"query": {"match_all": {}}}
}
```

**Why:** The implementation sends `body` as-is to Elasticsearch. If it's a JSON object, it becomes `[object Object]`.

**No automatic JSON.stringify** of object bodies.

### 14. User-Agent Header

**Value:** `User-Agent: PortOfCall/1.0`
**Visibility:** Appears in Kibana access logs and audit logs.
**Not configurable** — hardcoded in implementation.

**Kibana audit log example:**
```
{"@timestamp":"2024-12-20T14:32:15.234Z","http.request.headers.user-agent":"PortOfCall/1.0","event.action":"saved_object_find","user":{"name":"elastic"},"kibana.saved_object":{"type":"dashboard"}}
```

### 15. No Response Header Parsing for Auth Challenges

**Missing:** `WWW-Authenticate` header parsing on 401 responses.
**Impact:** Cannot detect auth scheme required by server.

**Example 401 response:**
```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="Kibana"
Content-Type: application/json

{"statusCode":401,"error":"Unauthorized","message":"missing authentication credentials"}
```

**Implementation returns:** Full response body in `error` field, but headers are not exposed.

**Workaround:** Check `statusCode === 401` and assume Basic/API key based on deployment knowledge.

---

## curl Examples

### 1. Health Check (No Auth)

```bash
curl -X POST http://localhost:8787/api/kibana/status \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "kibana.example.com",
    "port": 5601
  }'
```

**Response:**
```json
{
  "success": true,
  "version": {
    "number": "8.12.0",
    "buildHash": "a1b2c3d4e5f6"
  },
  "health": {
    "state": "green"
  },
  "pluginCount": 127,
  "responseTime": 234
}
```

---

### 2. List Dashboards (Basic Auth)

```bash
curl -X POST http://localhost:8787/api/kibana/saved-objects \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "kibana.example.com",
    "port": 5601,
    "type": "dashboard",
    "perPage": 50,
    "username": "elastic",
    "password": "changeme"
  }'
```

**Response:**
```json
{
  "success": true,
  "total": 47,
  "objects": [
    {
      "id": "722b74f0-b882-11e8-a6d9-e546fe2bba5f",
      "type": "dashboard",
      "title": "Web Traffic Overview",
      "description": "HTTP logs dashboard",
      "updated": "2024-12-15T18:32:10.945Z"
    }
  ]
}
```

---

### 3. List Data Views (API Key Auth)

```bash
curl -X POST http://localhost:8787/api/kibana/index-patterns \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "kibana.example.com",
    "api_key": "VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==",
    "space": "marketing"
  }'
```

**Response:**
```json
{
  "success": true,
  "total": 3,
  "dataViews": [
    {
      "id": "logs-*",
      "name": "logs-*",
      "title": "logs-*",
      "timeFieldName": "@timestamp",
      "namespaces": ["default", "marketing"]
    }
  ]
}
```

---

### 4. Check Alerting Rules

```bash
curl -X POST http://localhost:8787/api/kibana/alerts \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "kibana.example.com",
    "username": "elastic",
    "password": "changeme",
    "space": "security"
  }'
```

**Response:**
```json
{
  "success": true,
  "total": 12,
  "rules": [
    {
      "id": "8f3e7a10-5c9b-11ed-bdc3-0242ac120002",
      "name": "High CPU Usage",
      "enabled": true,
      "ruleTypeId": "metrics.alert.threshold",
      "schedule": {"interval": "1m"},
      "executionStatus": {"status": "ok"}
    }
  ]
}
```

---

### 5. Proxy Query to Elasticsearch (List Indices)

```bash
curl -X POST http://localhost:8787/api/kibana/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "kibana.example.com",
    "query": "_cat/indices?v",
    "username": "elastic",
    "password": "changeme"
  }'
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "esPath": "_cat/indices?v",
  "result": "health status index     pri rep docs.count docs.deleted store.size pri.store.size\ngreen  open   logs-001  1   1    1234567            0      2.1gb          1gb\n",
  "responseTime": 145
}
```

---

### 6. Proxy Query to Elasticsearch (Search with Body)

```bash
curl -X POST http://localhost:8787/api/kibana/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "kibana.example.com",
    "query": "logs-*/_search",
    "body": "{\"query\":{\"match\":{\"message\":\"error\"}},\"size\":10}",
    "username": "elastic",
    "password": "changeme"
  }'
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "esPath": "logs-*/_search",
  "result": {
    "took": 23,
    "hits": {
      "total": {"value": 1532, "relation": "eq"},
      "hits": [
        {
          "_index": "logs-2024.12.20",
          "_id": "abc123",
          "_source": {
            "timestamp": "2024-12-20T14:32:15.234Z",
            "message": "Connection error: timeout"
          }
        }
      ]
    }
  }
}
```

---

### 7. Cluster Health via Console Proxy

```bash
curl -X POST http://localhost:8787/api/kibana/query \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "kibana.example.com",
    "query": "_cluster/health",
    "username": "elastic",
    "password": "changeme"
  }'
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "result": {
    "cluster_name": "production-es",
    "status": "green",
    "number_of_nodes": 5,
    "active_primary_shards": 234,
    "active_shards": 468,
    "relocating_shards": 0,
    "initializing_shards": 0,
    "unassigned_shards": 0
  }
}
```

---

### 8. Find Visualizations in Specific Space

```bash
curl -X POST http://localhost:8787/api/kibana/saved-objects \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "kibana.example.com",
    "type": "visualization",
    "perPage": 100,
    "space": "analytics",
    "username": "elastic",
    "password": "changeme"
  }'
```

---

### 9. Test with Custom Timeout

```bash
curl -X POST http://localhost:8787/api/kibana/status \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "slow-kibana.example.com",
    "port": 5601,
    "timeout": 30000
  }'
```

**Timeout:** 30 seconds (default is 15 seconds)

---

### 10. Error Handling — Invalid Host

```bash
curl -X POST http://localhost:8787/api/kibana/status \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "nonexistent.example.com"
  }'
```

**Response:**
```json
{
  "error": "Connection timeout"
}
```

**HTTP Status:** 500

---

## Response Status Codes

| Code | Meaning | When | Example |
|------|---------|------|---------|
| 200 | Success | All successful queries | Health check green, dashboards listed |
| 400 | Bad Request | Missing `host` parameter | `{"error": "Host is required"}` |
| 401 | Unauthorized | Invalid credentials or missing auth | Kibana requires auth but none provided |
| 403 | Forbidden | Cloudflare IP detected or insufficient permissions | `{"error": "Cannot connect to Cloudflare IPs..."}` |
| 404 | Not Found | Endpoint doesn't exist | Triggers version fallback for data views/alerts |
| 405 | Method Not Allowed | Invalid HTTP method | (Not currently returned by implementation) |
| 500 | Internal Server Error | Connection timeout, socket error, parse error | `{"error": "Connection timeout"}` |

**Note:** Status codes 401-500 come from **Kibana server**, not the implementation. Implementation only returns 400 (missing host), 403 (Cloudflare), or 500 (connection error).

---

## Security Considerations

### 1. Credentials in Request Body

**Risk:** Username/password/API key sent as JSON in POST body.
**Mitigation:** Use HTTPS between client and Worker (enforced by Cloudflare Workers).
**No plaintext logging** of request bodies in default configuration.

### 2. No Certificate Validation

**Impact:** Cannot use TLS, so no MITM protection on Worker→Kibana connection.
**Recommendation:** Only use on trusted networks or via localhost TLS proxy.

### 3. Cloudflare IP Blocking

**Purpose:** Prevent accidental DDoS of Cloudflare-fronted services.
**Bypass:** Use `curl` or `nslookup` on your local machine if you need to query a Cloudflare-protected Kibana instance.

### 4. XSRF Protection

**Kibana requirement:** `kbn-xsrf: true` header on all mutating requests.
**Implementation:** Correctly adds header for POST/PUT/DELETE per Kibana API spec.

### 5. Read-Only Design

**No mutations implemented** except via console proxy (which can modify ES if user has permissions).
**Safer than write-enabled API** for exploratory use cases.

---

## Performance Tips

### 1. Reduce `perPage` for Large Datasets

**Default:** 20 results per query
**Maximum:** 10,000 (Kibana limit)
**Recommendation:** Keep ≤100 for sub-second response times.

### 2. Use Specific Saved Object Types

**Faster:**
```json
{"type": "dashboard"}
```

**Slower:**
```json
{"type": "visualization"}  // May have hundreds of objects
```

### 3. Increase Timeout for Slow Queries

**Example:** Large Elasticsearch aggregations via console proxy:
```json
{
  "query": "logs-*/_search",
  "body": "{\"size\":0,\"aggs\":{...}}",
  "timeout": 30000
}
```

### 4. Reuse Elasticsearch Direct Connection for High Volume

**This implementation:** Opens new TCP connection per query.
**Better for bulk queries:** Use the Elasticsearch protocol handler with connection reuse (if available).

---

## Comparison to Direct Elasticsearch Access

| Feature | Kibana API | Elasticsearch API |
|---------|------------|-------------------|
| **Health check** | `/api/status` (unauthenticated) | `/_cluster/health` (auth usually required) |
| **Saved objects** | Full CRUD via Kibana | Not available (Kibana-specific) |
| **Index search** | Via `/api/console/proxy` | Direct `/{index}/_search` |
| **Authentication** | Basic, API key, or none | Basic, API key, bearer token |
| **TLS** | Not supported (this impl) | Supported via `tls.connect()` |
| **Connection reuse** | No | Yes (if implemented) |
| **XSRF protection** | Required for mutations | Not required |
| **Version detection** | Via `/api/status` | Via `GET /` |
| **Dashboard metadata** | Native support | Requires `.kibana` index query |

**When to use Kibana API:**
- Querying dashboards, visualizations, or saved searches
- Checking alerting rule status
- Need unauthenticated health check
- Working with Kibana spaces

**When to use Elasticsearch API:**
- High-volume index queries
- Need TLS encryption
- Bulk operations
- Direct cluster management

---

## Troubleshooting

### Problem: `"error": "Connection timeout"`

**Causes:**
1. Kibana server is down
2. Firewall blocking port 5601
3. Host unreachable (DNS failure, network issue)
4. Timeout too short for slow server

**Solutions:**
- Verify Kibana is running: `curl http://kibana:5601/api/status`
- Check DNS: `nslookup kibana.example.com`
- Increase timeout: `"timeout": 30000`
- Check network path: `traceroute kibana.example.com`

---

### Problem: `"statusCode": 401, "error": "Unauthorized"`

**Causes:**
1. Missing credentials on secured Kibana
2. Invalid username/password
3. Expired API key
4. User lacks required permissions

**Solutions:**
- Add Basic auth: `"username": "elastic", "password": "..."`
- Or use API key: `"api_key": "..."`
- Regenerate API key in Kibana UI: Stack Management → API Keys
- Check user role: Kibana → Stack Management → Roles

---

### Problem: `"statusCode": 403, "error": "Forbidden"`

**Causes:**
1. Cloudflare IP detected (for `/status` endpoint)
2. User lacks space access (for space-specific queries)
3. Elasticsearch security denies action

**Solutions:**
- If Cloudflare: Use `curl` on local machine instead
- Check space membership: Kibana → Stack Management → Spaces
- Check role privileges: Kibana → Stack Management → Roles → Elasticsearch → Indices

---

### Problem: `"statusCode": 404`

**Causes:**
1. Wrong Kibana version (v7 vs v8 endpoint)
2. Typo in `query` parameter
3. Space doesn't exist

**Solutions:**
- Implementation auto-retries v7 endpoints on 404 (for data views/alerts)
- Verify endpoint exists: `curl http://kibana:5601/api/status | jq .version.number`
- Check space name: Kibana → Stack Management → Spaces

---

### Problem: Truncated JSON in `result` field

**Cause:** Response body >512KB.

**Solution:** Reduce result size:
- Saved objects: Lower `perPage` (default 20)
- Alerting rules: Hardcoded to 50 (edit source to reduce)
- Console proxy: Add `size=10` to Elasticsearch query

---

### Problem: Console proxy returns `"statusCode": 400, "error": "path is required"`

**Cause:** Missing or empty `query` parameter.

**Solution:**
```json
{
  "host": "kibana.example.com",
  "query": "_cat/indices?v"  // Must be present and non-empty
}
```

---

### Problem: `"error": "Cannot connect to Cloudflare IPs..."`

**Cause:** Host resolves to a Cloudflare range (e.g., 104.16.x.x).

**Solution:**
1. Use `curl` on your local machine instead of this API
2. Or create a local TLS proxy to the Cloudflare-fronted Kibana, then query `localhost:5601`

---

## Implementation Notes

**File:** `/Users/rj/gd/code/portofcall/src/worker/kibana.ts`
**Lines of Code:** 565
**Functions:** 7 (5 handlers + 2 HTTP helpers)
**Dependencies:**
- `cloudflare:sockets` — TCP socket API
- `./cloudflare-detector` — IP range blocking

**Memory usage:** ~2-10 MB per request (depends on response size, capped at 512KB body + headers).

**Request flow:**
1. Parse JSON request body
2. Validate `host` parameter
3. Check if host is Cloudflare IP (status endpoint only)
4. Open TCP socket to `host:port`
5. Send HTTP/1.1 request (with auth headers if provided)
6. Read response with timeout
7. Parse status line and headers
8. Decode chunked transfer encoding if present
9. Parse JSON body (if applicable)
10. Close socket
11. Return normalized JSON response

**Error handling:**
- Connection errors → 500 with `error` field
- Missing `host` → 400
- Cloudflare IP → 403
- Kibana errors → Pass through status code + truncated body

---

## Changelog

### 2026-02-18 — Bug Fix

**Fixed:** Chunked transfer encoding decoder now correctly:
1. Strips chunk extensions (`;name=value`) per RFC 7230 §4.1
2. Stops decoding at `0\r\n` chunk (was continuing to read trailer)
3. Prevents garbage data in decoded body

**Impact:** Responses with chunk extensions no longer fail to parse. Trailer headers no longer corrupt JSON body.

**Files changed:** `kibana.ts` (lines 112-125, 357-369)

---

## References

- **Kibana API Docs:** https://www.elastic.co/guide/en/kibana/current/api.html
- **Saved Objects API:** https://www.elastic.co/guide/en/kibana/current/saved-objects-api.html
- **Alerting API:** https://www.elastic.co/guide/en/kibana/current/alerting-apis.html
- **Data Views API:** https://www.elastic.co/guide/en/kibana/current/data-views-api.html
- **Console Proxy:** https://github.com/elastic/kibana/blob/main/src/plugins/console/server/routes/api/console/proxy/proxy_request.ts
- **RFC 7230 (HTTP/1.1):** https://tools.ietf.org/html/rfc7230
- **RFC 2617 (HTTP Authentication):** https://tools.ietf.org/html/rfc2617

---

**Document version:** 1.0
**Last updated:** 2026-02-18
**Protocol version:** Kibana 7.x - 8.x
**Implementation status:** Production
