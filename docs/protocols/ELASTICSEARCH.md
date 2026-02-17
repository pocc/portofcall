# Elasticsearch — Power User Reference

**Port:** 9200 (HTTP/TCP) | **Protocol:** HTTP/1.1 REST API | **Tests:** ✅ Deployed

Port of Call provides six Elasticsearch endpoints across two transport modes: a raw TCP HTTP/1.1 transport for plain clusters (port 9200), and a native TLS `fetch()` path for Elastic Cloud and TLS-enabled clusters. All endpoints accept Basic Auth (`username`/`password`).

**No API key auth.** The `ElasticsearchClient` class in the planning docs is not implemented. Only HTTP Basic Auth is supported.

---

## Transport Modes

| Mode | How it works | When to use |
|---|---|---|
| **TCP** (default) | Raw `connect()` socket → hand-built HTTP/1.1 request | Self-hosted ES, port 9200, no TLS |
| **HTTPS** (`https: true` or `/api/elasticsearch/https`) | Workers `fetch()` → native TLS | Elastic Cloud, port 443, TLS clusters |

The `/api/elasticsearch/query` endpoint always uses TCP. The `/api/elasticsearch/https` endpoint always uses TLS. The index, delete, and create-index endpoints switch between the two via an `https: boolean` field in the request body.

**TCP response cap: 512 KB.** Responses larger than 512,000 bytes are silently truncated at the read loop. Use the HTTPS path for large scroll/search responses.

**Chunked Transfer-Encoding is handled.** The TCP reader decodes chunked responses before returning the body.

---

## API Endpoints

### `POST /api/elasticsearch/health` — Cluster info + health

Makes two sequential TCP requests: `GET /` (server info) and `GET /_cluster/health`.

**Request body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `9200` | |
| `username` / `password` | string | — | Basic Auth |
| `timeout` | number (ms) | `15000` | Applies to each request |

**Success (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "parsed": {
    "serverInfo": {
      "name": "node-1",
      "cluster_name": "my-cluster",
      "version": { "number": "8.11.0", "lucene_version": "9.7.0" },
      "tagline": "You Know, for Search"
    },
    "clusterHealth": {
      "cluster_name": "my-cluster",
      "status": "green",
      "number_of_nodes": 3,
      "number_of_data_nodes": 3,
      "active_primary_shards": 12,
      "active_shards": 24,
      "unassigned_shards": 0,
      "initializing_shards": 0,
      "relocating_shards": 0
    }
  },
  "latencyMs": 48
}
```

`success` is based on the `GET /` status code. If `/_cluster/health` fails, `clusterHealth` is `null` (not an error).

**Cluster health status values:** `"green"` (all shards assigned), `"yellow"` (all primaries assigned, some replicas unassigned), `"red"` (some primary shards unassigned — data loss risk).

---

### `POST /api/elasticsearch/query` — Arbitrary HTTP/1.1 query (TCP)

Send any ES REST API call over raw TCP. Useful for operations not covered by the dedicated endpoints.

**Request body:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `9200` | |
| `path` | string | `"/"` | Leading `/` added automatically if missing |
| `method` | string | `"GET"` | GET, POST, PUT, DELETE, HEAD |
| `body` | string | — | Request body as a raw JSON string |
| `username` / `password` | string | — | Basic Auth |
| `timeout` | number (ms) | `15000` | |

**Note:** `body` is a **string**, not an object. You must `JSON.stringify()` your query DSL before sending it as the `body` field.

**Success (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "headers": { "content-type": "application/json", "x-elastic-product": "Elasticsearch" },
  "body": "{\"took\":5,\"hits\":{...}}",
  "parsed": { "took": 5, "hits": { "total": { "value": 42 }, "hits": [...] } },
  "latencyMs": 62
}
```

`success: false` when `statusCode >= 400`. The `parsed` field is `null` if the body is not valid JSON.

**Error (400):** `{ "success": false, "error": "Invalid HTTP method: PATCH. Allowed: GET, POST, PUT, DELETE, HEAD" }`

---

### `POST /api/elasticsearch/https` — Arbitrary HTTPS query (TLS)

Identical interface to `/api/elasticsearch/query` but uses native `fetch()` with TLS. No 512 KB cap; response size is limited by the Workers runtime.

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | Elastic Cloud hostname (e.g. `my-cluster.es.us-east-1.aws.elastic.cloud`) |
| `port` | number | `9200` | Use `443` for Elastic Cloud |
| `path` | string | `"/"` | |
| `method` | string | `"GET"` | GET, POST, PUT, DELETE, HEAD |
| `body` | string | — | Raw JSON string |
| `username` / `password` | string | — | Basic Auth |
| `timeout` | number (ms) | `15000` | |

---

### `POST /api/elasticsearch/index` — Index a document

`PUT /{index}/_doc/{id}` (with `id`) or `POST /{index}/_doc` (without `id`, auto-generates `_id`).

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `9200` | |
| `index` | string | required | Target index name |
| `id` | string | — | Omit for auto-generated `_id` |
| `doc` | object | required | Document body (not pre-serialized — send a JSON object) |
| `username` / `password` | string | — | |
| `https` | boolean | `false` | Use TLS `fetch()` instead of TCP |
| `timeout` | number (ms) | `15000` | |

**Success (200/201):**
```json
{
  "success": true,
  "statusCode": 201,
  "parsed": {
    "_index": "logs-2024.01",
    "_id": "abc123",
    "_version": 1,
    "result": "created",
    "_shards": { "total": 2, "successful": 1, "failed": 0 }
  },
  "latencyMs": 34
}
```

`result` is `"created"` for new documents, `"updated"` if an existing document was replaced.

---

### `DELETE /api/elasticsearch/document` — Delete a document

`DELETE /{index}/_doc/{id}`

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `9200` | |
| `index` | string | required | |
| `id` | string | required | |
| `username` / `password` | string | — | |
| `https` | boolean | `false` | |
| `timeout` | number (ms) | `15000` | |

**Success:**
```json
{
  "success": true,
  "statusCode": 200,
  "parsed": { "_index": "logs-2024.01", "_id": "abc123", "result": "deleted", "_version": 2 },
  "latencyMs": 28
}
```

`statusCode: 404` with `"result": "not_found"` if the document doesn't exist. `success` is `false` for 404.

---

### `PUT /api/elasticsearch/create-index` — Create an index

`PUT /{index}` with `settings.number_of_shards` and `settings.number_of_replicas`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | |
| `port` | number | `9200` | |
| `index` | string | required | Index name |
| `shards` | number | `1` | `number_of_shards` |
| `replicas` | number | `1` | `number_of_replicas` — set to `0` for single-node clusters |
| `username` / `password` | string | — | |
| `https` | boolean | `false` | |
| `timeout` | number (ms) | `15000` | |

**Success:**
```json
{
  "success": true,
  "statusCode": 200,
  "index": "my-index",
  "shards": 1,
  "replicas": 0,
  "parsed": { "acknowledged": true, "shards_acknowledged": true, "index": "my-index" },
  "latencyMs": 120
}
```

`statusCode: 400` with `"type": "resource_already_exists_exception"` if the index already exists. Use `DELETE` on the index via `/api/elasticsearch/query` or alias if needed.

---

## Common Query DSL Patterns

All DSL is sent as the `body` string to `/api/elasticsearch/query`.

### Full-text search
```json
{
  "path": "/logs-*/_search",
  "method": "POST",
  "body": "{\"query\":{\"match\":{\"message\":\"NullPointerException\"}},\"size\":20,\"sort\":[{\"@timestamp\":{\"order\":\"desc\"}}]}"
}
```

### Time-range filter (log analysis)
```json
{
  "path": "/logs-*/_search",
  "method": "POST",
  "body": "{\"query\":{\"range\":{\"@timestamp\":{\"gte\":\"now-1h\",\"lte\":\"now\"}}},\"size\":100}"
}
```

### Aggregation — top 10 hosts by error count
```json
{
  "path": "/logs-*/_search",
  "method": "POST",
  "body": "{\"size\":0,\"query\":{\"term\":{\"level\":\"error\"}},\"aggs\":{\"by_host\":{\"terms\":{\"field\":\"host.keyword\",\"size\":10}}}}"
}
```

### bool query — must/filter/should/must_not
```json
{
  "path": "/logs-*/_search",
  "method": "POST",
  "body": "{\"query\":{\"bool\":{\"must\":[{\"match\":{\"service\":\"auth\"}}],\"filter\":[{\"range\":{\"@timestamp\":{\"gte\":\"now-24h\"}}}],\"must_not\":[{\"term\":{\"level\":\"debug\"}}]}}}"
}
```

### Get index mapping
```json
{ "path": "/my-index/_mapping", "method": "GET" }
```

### List all indices with stats
```json
{ "path": "/_cat/indices?v&s=store.size:desc&format=json", "method": "GET" }
```

### Get cluster stats
```json
{ "path": "/_cluster/stats", "method": "GET" }
```

### Node stats
```json
{ "path": "/_nodes/stats/jvm,os,fs", "method": "GET" }
```

### Explain why a query doesn't match
```json
{
  "path": "/my-index/_explain/doc123",
  "method": "POST",
  "body": "{\"query\":{\"term\":{\"user.id\":\"kimchy\"}}}"
}
```

---

## curl Examples

```bash
# Health check
curl -s -X POST https://portofcall.ross.gg/api/elasticsearch/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"es.example.com","port":9200}' | jq '{status: .parsed.clusterHealth.status, nodes: .parsed.clusterHealth.number_of_nodes}'

# Health with Basic Auth
curl -s -X POST https://portofcall.ross.gg/api/elasticsearch/health \
  -H 'Content-Type: application/json' \
  -d '{"host":"es.example.com","username":"elastic","password":"changeme"}' | jq .

# List all indices (sorted by size)
curl -s -X POST https://portofcall.ross.gg/api/elasticsearch/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"es.example.com","path":"/_cat/indices?v&s=store.size:desc&format=json"}' | jq '.parsed'

# Search with Query DSL
curl -s -X POST https://portofcall.ross.gg/api/elasticsearch/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"es.example.com","path":"/logs-*/_search","method":"POST","body":"{\"query\":{\"match\":{\"message\":\"error\"}},\"size\":5}"}' \
  | jq '.parsed.hits.hits[]._source'

# Index a document
curl -s -X POST https://portofcall.ross.gg/api/elasticsearch/index \
  -H 'Content-Type: application/json' \
  -d '{"host":"es.example.com","index":"events","id":"evt-001","doc":{"event":"login","user":"alice","ts":"2024-01-15T12:00:00Z"}}' | jq .

# Delete a document
curl -s -X DELETE https://portofcall.ross.gg/api/elasticsearch/document \
  -H 'Content-Type: application/json' \
  -d '{"host":"es.example.com","index":"events","id":"evt-001"}' | jq .

# Create an index (single-node: replicas=0)
curl -s -X PUT https://portofcall.ross.gg/api/elasticsearch/create-index \
  -H 'Content-Type: application/json' \
  -d '{"host":"es.example.com","index":"my-logs","shards":1,"replicas":0}' | jq .

# Elastic Cloud (TLS, port 443)
curl -s -X POST https://portofcall.ross.gg/api/elasticsearch/https \
  -H 'Content-Type: application/json' \
  -d '{"host":"my-cluster.es.us-east-1.aws.elastic.cloud","port":443,"username":"elastic","password":"<password>","path":"/_cluster/health"}' | jq .

# Delete an index (via generic query)
curl -s -X POST https://portofcall.ross.gg/api/elasticsearch/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"es.example.com","path":"/my-index","method":"DELETE"}' | jq .

# Flush and force-merge for log indices before ILM delete
curl -s -X POST https://portofcall.ross.gg/api/elasticsearch/query \
  -H 'Content-Type: application/json' \
  -d '{"host":"es.example.com","path":"/logs-2024.01.*/_forcemerge?max_num_segments=1","method":"POST"}' | jq .
```

---

## Operational Quick Reference

Power users typically need these ES API paths via `/api/elasticsearch/query`:

| Task | Method | Path |
|---|---|---|
| Cluster health | GET | `/_cluster/health` |
| Cluster health (wait for green, 30s) | GET | `/_cluster/health?wait_for_status=green&timeout=30s` |
| Node info | GET | `/_nodes?pretty` |
| Node stats (JVM/heap) | GET | `/_nodes/stats/jvm` |
| Hot threads | GET | `/_nodes/hot_threads` |
| All indices (cat API) | GET | `/_cat/indices?v&s=store.size:desc&format=json` |
| Index mapping | GET | `/{index}/_mapping` |
| Index settings | GET | `/{index}/_settings` |
| Index stats | GET | `/{index}/_stats` |
| Shard allocation | GET | `/_cat/shards?v&format=json` |
| Unassigned shards | GET | `/_cat/shards?v&h=index,shard,prirep,state,unassigned.reason&format=json` |
| Cluster allocation explain | POST | `/_cluster/allocation/explain` |
| Pending tasks | GET | `/_cluster/pending_tasks` |
| ILM explain for index | GET | `/{index}/_ilm/explain` |
| Snapshot repositories | GET | `/_snapshot` |
| List snapshots | GET | `/_snapshot/{repo}/_all` |
| Reindex | POST | `/_reindex` |
| Update by query | POST | `/{index}/_update_by_query` |
| Delete by query | POST | `/{index}/_delete_by_query` |
| Index aliases | GET | `/_aliases` |
| Add alias | POST | `/_aliases` (body: `{"actions":[{"add":{"index":"...","alias":"..."}}]}`) |
| Task management | GET | `/_tasks` |
| Cancel task | DELETE | `/_tasks/{task_id}` |

---

## Known Limitations

**No API key auth:** Only HTTP Basic Auth is supported. The `ElasticsearchClient.apiKey` field in the planning document is not implemented. For clusters using `ApiKey` authentication, you cannot use the TCP or HTTPS endpoints directly — you would need to add the `Authorization: ApiKey <key>` header, which is not currently exposed.

**512 KB TCP cap:** The raw TCP response reader stops accumulating at 512,000 bytes. Large `_search` responses (e.g., `size: 1000` on large documents, `_source` includes all fields) will be truncated. Use `https: true` or `/api/elasticsearch/https` for large responses.

**No streaming / scroll API:** The TCP reader reads until the connection closes or the 512 KB cap. Scroll sessions (`_search?scroll=1m` → `_search/scroll`) can be initiated but the scroll ID response must fit within 512 KB. Subsequent `_search/scroll` calls are supported via `/api/elasticsearch/query`.

**No `PATCH` method:** Partial document updates (`POST /{index}/_update/{id}` with `{"doc":{...}}`) use `POST`, not `PATCH`, and are supported via `/api/elasticsearch/query`.

**No API key injection for `index` / `delete` / `create-index`:** These dedicated endpoints only support Basic Auth. Use `/api/elasticsearch/query` or `/api/elasticsearch/https` for API key auth scenarios (add the key in a wrapper).

**Elastic Cloud requires HTTPS path:** Elastic Cloud clusters are TLS-only (port 443). Use `/api/elasticsearch/https` or the `https: true` field on index/delete/create-index. The TCP `/api/elasticsearch/query` endpoint will fail to connect to TLS endpoints.

**`body` must be a pre-serialized string:** The `/api/elasticsearch/query` and `/api/elasticsearch/https` endpoints accept `body` as a `string`, not a JSON object. You must serialize the Query DSL yourself before placing it in the request body.

---

## Local Testing

```bash
# Single-node Elasticsearch (no auth, no TLS)
docker run -d \
  --name elasticsearch \
  -p 9200:9200 \
  -e "discovery.type=single-node" \
  -e "xpack.security.enabled=false" \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0

# With Basic Auth enabled
docker run -d \
  --name elasticsearch-auth \
  -p 9200:9200 \
  -e "discovery.type=single-node" \
  -e "ELASTIC_PASSWORD=changeme" \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0
# Username: elastic, Password: changeme

# Verify
curl http://localhost:9200/_cluster/health | jq .status
```

---

## Resources

- [Elasticsearch REST API Reference](https://www.elastic.co/guide/en/elasticsearch/reference/current/rest-apis.html)
- [Query DSL](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl.html)
- [Aggregations Reference](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations.html)
- [ILM (Index Lifecycle Management)](https://www.elastic.co/guide/en/elasticsearch/reference/current/index-lifecycle-management.html)
- [cat APIs](https://www.elastic.co/guide/en/elasticsearch/reference/current/cat.html)
