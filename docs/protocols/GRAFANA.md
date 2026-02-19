# Grafana HTTP API — Power User Reference

**Port:** 3000 | **Protocol:** HTTP/1.1 REST API over TCP | **Auth:** Bearer token / API key / Basic auth

Port of Call connects to Grafana over raw TCP (HTTP/1.1). No TLS path exists.

---
## Authentication

Priority order when multiple credential types are provided:

| Priority | Field(s) | Header sent |
|---|---|---|
| 1 | `token` | `Authorization: Bearer <token>` |
| 2 | `apiKey` | `Authorization: Bearer <apiKey>` |
| 3 | `username` + `password` | `Authorization: Basic base64(user:pass)` |

Service account tokens (Grafana 9+) and legacy API keys both use Bearer scheme on the wire.
Use `token` for service account tokens and `apiKey` for legacy API keys.

---

## Common Request Fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `host` | string | required | IP or hostname |
| `port` | number | `3000` | |
| `timeout` | number (ms) | `10000` | Connection + HTTP exchange timeout |
| `token` | string | — | Service account token (Bearer) |
| `apiKey` | string | — | Legacy API key (Bearer) |
| `username` | string | — | Basic auth |
| `password` | string | — | Basic auth |

---
## API Endpoints

### `POST /api/grafana/health` — Server health + auth probe

Calls `/api/health`, `/api/frontend/settings` (both unauthenticated), and probes `/api/org` to determine auth state.
All three requests run in parallel via `Promise.all`.

**Request:** base fields only

**Success (200):**
```json
{
  "success": true,
  "endpoint": "grafana.example.com:3000",
  "statusCode": 200,
  "authenticated": true,
  "authRequired": true,
  "health": {
    "commit": "d7e4c9e8be",
    "database": "ok",
    "version": "10.2.3"
  }
}
```

| Field | Meaning |
|---|---|
| `authenticated` | true if `/api/org` returned 200 |
| `authRequired` | true if `/api/org` returned 401 or 403 |
| `health.database` | `"ok"` or `"failing"` |

Also supports GET: `GET /api/grafana/health?hostname=<host>&port=<port>`

---
### `POST /api/grafana/datasources` — List all datasources

Calls `GET /api/datasources`. Requires Viewer role or higher.

**Success (200):**
```json
{
  "success": true,
  "datasources": [
    {
      "id": 1, "uid": "P1809F7CD0C75ACF3",
      "name": "Prometheus", "type": "prometheus",
      "url": "http://prometheus:9090",
      "isDefault": true
    }
  ],
  "count": 1
}
```

Common `type` values: `prometheus`, `loki`, `elasticsearch`, `influxdb`, `graphite`, `mysql`, `postgres`, `cloudwatch`, `tempo`, `jaeger`.

Also supports GET: `GET /api/grafana/datasources?hostname=<host>&port=<port>`

---
### `POST /api/grafana/dashboards` — Search dashboards

Calls `GET /api/search?type=dash-db&query=<q>&limit=<n>`. Returns dashboard metadata only.

**Additional request fields:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `query` | string | `""` | Title substring match |
| `limit` | number | `50` | Max results |

**Success (200):**
```json
{
  "success": true,
  "dashboards": [
    {
      "id": 14, "uid": "cdp3Ysick",
      "title": "Node Exporter Full",
      "url": "/d/cdp3Ysick/node-exporter-full",
      "tags": ["prometheus", "linux"],
      "folderTitle": "General"
    }
  ],
  "count": 1, "query": "node"
}
```

**Note:** Use the `uid` value with the `dashboard` endpoint to fetch full JSON. Search does not return panel data.

Also supports GET: `GET /api/grafana/dashboards?hostname=<host>&query=<q>&limit=<n>`

---
### `POST /api/grafana/dashboard` — Fetch full dashboard by UID

Calls `GET /api/dashboards/uid/:uid`. Returns the complete dashboard JSON model.

**Additional required field:**

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Dashboard UID from search results or Grafana URL `/d/<uid>/...` |

**Success (200):**
```json
{
  "success": true,
  "dashboard": {
    "dashboard": {
      "id": 14, "uid": "cdp3Ysick",
      "title": "Node Exporter Full",
      "schemaVersion": 36, "version": 8,
      "panels": [ ... ], "tags": ["prometheus"]
    },
    "meta": {
      "folderId": 0, "folderTitle": "General",
      "created": "2024-01-10T14:00:00Z",
      "updated": "2024-01-15T09:30:00Z"
    }
  }
}
```

**Not found:** `{ "success": false, "statusCode": 404, "error": "Dashboard UID not found: baduid" }`

---
### `POST /api/grafana/folders` — List folders

Calls `GET /api/folders`.

**Success (200):**
```json
{
  "success": true,
  "folders": [
    {
      "id": 3, "uid": "abcDEF123",
      "title": "Infrastructure",
      "url": "/dashboards/f/abcDEF123/infrastructure",
      "canSave": true, "canEdit": true, "canAdmin": true
    }
  ],
  "count": 1
}
```

**Note:** Grafana 9+ uses `folderUid` as the canonical folder identifier. When creating dashboards in a folder, pass the folder's `uid` as `folderUid` in the create request.

---

### `POST /api/grafana/alert-rules` — List provisioned alert rules (Grafana 9+)

Calls `GET /api/v1/provisioning/alert-rules`. Only returns rules from the Grafana Unified Alerting engine.

**Success (200):**
```json
{
  "success": true,
  "alertRules": [
    {
      "uid": "alert-uid-1", "title": "High CPU Usage",
      "condition": "C", "for": "5m",
      "labels": { "severity": "critical" },
      "isPaused": false
    }
  ],
  "count": 1
}
```

**Grafana < 9:** returns `{ "success": false, "statusCode": 404, "error": "Provisioning API not available" }`

---
### `POST /api/grafana/org` — Current organisation + user list

Calls `GET /api/org` and `GET /api/org/users` in parallel.
Note: `/api/org/users` requires Org Admin role. If credentials have only Viewer/Editor, `users` is empty.

**Success (200):**
```json
{
  "success": true,
  "org": { "id": 1, "name": "Main Org." },
  "users": [
    {
      "login": "admin", "name": "Admin",
      "email": "admin@example.com",
      "role": "Admin",
      "lastSeenAt": "2024-01-15T10:00:00Z"
    }
  ],
  "userCount": 1
}
```

Role values: `"Admin"`, `"Editor"`, `"Viewer"`, `"None"`

---
### `POST /api/grafana/dashboard/create` — Create a dashboard

Calls `POST /api/dashboards/db`. Requires Editor role or higher.

**Additional request fields:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `title` | string | `"PortOfCall Test Dashboard"` | Dashboard title |
| `tags` | string[] | `["portofcall"]` | Tags |
| `folderId` | number | `0` | Grafana <9: numeric folder ID (deprecated) |
| `folderUid` | string | — | Grafana 9+: folder UID (preferred over folderId) |

**Payload sent to Grafana:**
```json
{
  "dashboard": {
    "title": "<title>", "tags": ["<tags>"],
    "timezone": "browser", "schemaVersion": 36,
    "version": 0, "panels": []
  },
  "folderId": 0,
  "folderUid": "<uid if provided>",
  "overwrite": false
}
```

**Success (200):**
```json
{
  "success": true,
  "dashboard": {
    "id": 42, "uid": "AbCdEfGh",
    "url": "/d/AbCdEfGh/portofcall-test-dashboard",
    "status": "success", "version": 1
  }
}
```

**Notes:** `overwrite: false` — creating with an existing title returns HTTP 412. Creates an empty dashboard; add panels via the full Grafana API.

---
### `POST /api/grafana/annotation/create` — Create an annotation

Calls `POST /api/annotations`. Requires Editor role.

**Additional request fields:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `text` | string | `"PortOfCall annotation"` | Description (HTML ok) |
| `tags` | string[] | `["portofcall"]` | Filter tags |
| `time` | number | `Date.now()` | Start time (epoch ms) |
| `timeEnd` | number | — | End time (omit for point annotation) |
| `dashboardId` | number | — | Pin to dashboard |
| `panelId` | number | — | Pin to panel (requires dashboardId) |

**Annotation types:**
- **Point** (no `timeEnd`): vertical line at `time`
- **Region** (`time` + `timeEnd`): shaded region
- **Global** (no `dashboardId`): shown on all dashboards
- **Panel** (`dashboardId` + `panelId`): shown only on that panel

**Success (200):** `{ "success": true, "annotation": { "id": 17, "message": "Annotation added" } }`

---
## Transport Details

### HTTP/1.1 over Raw TCP

All requests are hand-built HTTP/1.1 over raw TCP via the Cloudflare Workers `connect()` API.
The `Host` header includes the port unless the port is 80 (the HTTP scheme default).

Example GET request:
```
GET /api/health HTTP/1.1
Host: grafana.example.com:3000
Connection: close
Accept: application/json
User-Agent: PortOfCall/1.0
Authorization: Bearer glsa_xxxx
```

### Chunked Transfer-Encoding

Grafana may respond with `Transfer-Encoding: chunked`. The implementation decodes chunked responses before parsing JSON.

### Response size cap

The TCP reader accumulates up to **10 MB**. Grafana API responses are typically well under this limit.

### Timeout behaviour

Two-phase timeout:
1. **Connection timeout:** `openSocket()` races against full `timeout` budget
2. **HTTP-exchange timeout:** remaining budget after connection (minimum 1 s)

Total wall-clock time is bounded by `timeout`, not `2 × timeout`.

### Concurrent requests

- `/api/grafana/health` fires 3 parallel requests (`Promise.all`)
- `/api/grafana/org` fires 2 parallel requests
- Each parallel request uses a separate TCP socket

---
## Grafana Version Compatibility

| Feature | Minimum version |
|---|---|
| Service account tokens | 9.0 |
| Provisioning API (`/api/v1/provisioning/`) | 9.0 |
| `folderUid` in dashboard API | 9.0 |
| Unified Alerting alert rules | 9.0 |
| Legacy API keys (Bearer) | All versions |
| Basic auth | All versions |
| `/api/health` | 5.0+ |
| `/api/frontend/settings` | 5.0+ |
| `/api/datasources` | 4.0+ |
| `/api/search?type=dash-db` | 5.0+ |
| `/api/dashboards/uid/:uid` | 5.0+ |
| `/api/folders` | 5.0+ |

---
## curl Examples

```bash
# Health check (no auth)
curl -s -X POST https://portofcall.ross.gg/api/grafana/health \n  -H 'Content-Type: application/json' \n  -d '{"host":"grafana.example.com","port":3000}' | jq '{v:.health.version,db:.health.database}'

# With service account token
curl -s -X POST https://portofcall.ross.gg/api/grafana/health \n  -H 'Content-Type: application/json' \n  -d '{"host":"grafana.example.com","token":"glsa_xxxx"}' | jq '{auth:.authenticated,req:.authRequired}'

# List datasources
curl -s -X POST https://portofcall.ross.gg/api/grafana/datasources \n  -H 'Content-Type: application/json' \n  -d '{"host":"grafana.example.com","token":"glsa_xxxx"}' \n  | jq '.datasources[] | {name,type,url,default:.isDefault}'
# Search dashboards
curl -s -X POST https://portofcall.ross.gg/api/grafana/dashboards \n  -H 'Content-Type: application/json' \n  -d '{"host":"grafana.example.com","token":"glsa_xxxx","query":"node","limit":10}' \n  | jq '.dashboards[] | {title,uid,folder:.folderTitle}'

# Fetch full dashboard JSON by UID
curl -s -X POST https://portofcall.ross.gg/api/grafana/dashboard \n  -H 'Content-Type: application/json' \n  -d '{"host":"grafana.example.com","token":"glsa_xxxx","uid":"cdp3Ysick"}' \n  | jq '.dashboard.dashboard | {title,panels:(.panels|length),ver:.version}'

# List folders
curl -s -X POST https://portofcall.ross.gg/api/grafana/folders \n  -H 'Content-Type: application/json' \n  -d '{"host":"grafana.example.com","token":"glsa_xxxx"}' \n  | jq '.folders[] | {title,uid,canEdit}'
# Alert rules (Grafana 9+)
curl -s -X POST https://portofcall.ross.gg/api/grafana/alert-rules \n  -H 'Content-Type: application/json' \n  -d '{"host":"grafana.example.com","token":"glsa_xxxx"}' \n  | jq '.alertRules[] | {title,for:.for,severity:.labels.severity}'

# Org info + users (requires Org Admin)
curl -s -X POST https://portofcall.ross.gg/api/grafana/org \n  -H 'Content-Type: application/json' \n  -d '{"host":"grafana.example.com","token":"glsa_xxxx"}' \n  | jq '{org:.org.name,users:[.users[]|{login,role}]}'

# Create a dashboard (Grafana 9+: folderUid)
curl -s -X POST https://portofcall.ross.gg/api/grafana/dashboard/create \n  -H 'Content-Type: application/json' \n  -d '{"host":"grafana.example.com","token":"glsa_xxxx","title":"My Dashboard","tags":["test"],"folderUid":"abcDEF123"}' \n  | jq '{uid:.dashboard.uid,url:.dashboard.url}'
# Create a point annotation on a specific panel
curl -s -X POST https://portofcall.ross.gg/api/grafana/annotation/create \n  -H 'Content-Type: application/json' \n  -d '{"host":"grafana.example.com","token":"glsa_xxxx","text":"Deploy v2.3.1","tags":["deploy"],"dashboardId":14,"panelId":3}' \n  | jq .
```

---
## Operational Quick Reference

Grafana API paths accessible via your Grafana instance directly:

| Task | Method | Path |
|---|---|---|
| Server health | GET | `/api/health` |
| Version / build info | GET | `/api/frontend/settings` |
| Current user | GET | `/api/user` |
| All users (Admin) | GET | `/api/users` |
| All organisations (Admin) | GET | `/api/orgs` |
| Switch org | POST | `/api/user/using/:orgId` |
| Datasource health | GET | `/api/datasources/:id/health` |
| All dashboards | GET | `/api/search?type=dash-db` |
| Dashboard by UID | GET | `/api/dashboards/uid/:uid` |
| Create/update dashboard | POST | `/api/dashboards/db` |
| Delete dashboard | DELETE | `/api/dashboards/uid/:uid` |
| Create folder | POST | `/api/folders` |
| List annotations | GET | `/api/annotations` |
| Delete annotation | DELETE | `/api/annotations/:id` |
| Alert rule by UID | GET | `/api/v1/provisioning/alert-rules/:uid` |
| Contact points | GET | `/api/v1/provisioning/contact-points` |
| Notification policies | GET | `/api/v1/provisioning/policies` |
| Active alerts | GET | `/api/alertmanager/grafana/api/v2/alerts` |
| Silences | GET | `/api/alertmanager/grafana/api/v2/silences` |
| Plugins | GET | `/api/plugins` |
| Grafana stats (Admin) | GET | `/api/admin/stats` |
| API keys | GET | `/api/auth/keys` |
| Service accounts | GET | `/api/serviceaccounts/search` |
| Teams | GET | `/api/teams/search` |

---
## Known Limitations

**No TLS support.** Raw TCP only. Grafana instances running behind TLS (HTTPS) cannot be reached. For TLS deployments, connect to the upstream Grafana process on port 3000 directly, or use port forwarding.

**No connection reuse.** Each HTTP request opens a fresh TCP socket. The health endpoint opens 3 sockets in parallel; org opens 2.

**10 MB response cap.** Responses larger than 10 MB are truncated. Grafana responses are typically well under this limit.

**`overwrite: false` on dashboard create.** Creating a dashboard with a title that already exists in the target folder returns HTTP 412. There is no `overwrite` field exposed; use the full Grafana API for idempotent upserts.

**No panel creation.** The dashboard create endpoint creates an empty dashboard only. Copy dashboard JSON from `/api/dashboards/uid/:uid` response, modify, and POST to `/api/dashboards/db` directly for dashboards with content.

**Classic alerts not supported.** Pre-Grafana-9 alerting (`/api/alerts`) is not implemented. Only Grafana 9+ Unified Alerting provisioning API.

**`/api/org/users` requires Org Admin.** Viewer/Editor credentials will get an empty user list without error.

**No multi-org support.** All requests use the org associated with the credentials.

**No pagination.** Dashboard search is capped by the `limit` parameter (default 50). No cursor or page offset is exposed.

**No HTTP/2.** The hand-built client speaks HTTP/1.1 only.

---
## Local Testing

```bash
# Anonymous access (no login required)
docker run -d --name grafana -p 3000:3000 \n  -e GF_AUTH_ANONYMOUS_ENABLED=true \n  -e GF_AUTH_ANONYMOUS_ORG_ROLE=Admin \n  grafana/grafana:latest

# Admin credentials
docker run -d --name grafana -p 3000:3000 \n  -e GF_SECURITY_ADMIN_USER=admin \n  -e GF_SECURITY_ADMIN_PASSWORD=grafana \n  grafana/grafana:latest

# Create a service account token (after Grafana is running)
# 1. Create service account:
curl -s -X POST http://admin:grafana@localhost:3000/api/serviceaccounts \n  -H 'Content-Type: application/json' \n  -d '{"name":"portofcall","role":"Viewer"}' | jq .id
# 2. Create token (replace :id):
curl -s -X POST http://admin:grafana@localhost:3000/api/serviceaccounts/:id/tokens \n  -H 'Content-Type: application/json' \n  -d '{"name":"poc-token"}' | jq .key
```

---

## Resources

- [Grafana HTTP API Reference](https://grafana.com/docs/grafana/latest/developers/http_api/)
- [Service Accounts](https://grafana.com/docs/grafana/latest/administration/service-accounts/)
- [Alerting Provisioning API](https://grafana.com/docs/grafana/latest/developers/http_api/alerting_provisioning/)
- [Dashboard API](https://grafana.com/docs/grafana/latest/developers/http_api/dashboard/)
- [Annotations API](https://grafana.com/docs/grafana/latest/developers/http_api/annotations/)
- [Dashboard JSON Model](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/view-dashboard-json-model/)
