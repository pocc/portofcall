# Kubernetes API Server — Port of Call Reference

**Spec:** [Kubernetes API Reference](https://kubernetes.io/docs/reference/using-api/)
**Default port:** 6443/TCP (TLS — the API server requires HTTPS)
**Source:** `src/worker/kubernetes.ts`

---

## Transport

All four endpoints use raw TLS via `cloudflare:sockets connect()` with `secureTransport: 'on'`. A new TLS connection is opened per request. HTTP/1.1 is used throughout (Connection: close).

The Kubernetes API server is one of the few services in Port of Call that **requires TLS** by spec — there is no plaintext fallback. The server certificate is validated by the Cloudflare Workers runtime TLS stack. Self-signed certificates (common in on-prem clusters) will cause the TLS handshake to fail; there is no `insecureSkipVerify` option available in Workers.

**Authentication note:** Most Kubernetes clusters require authentication for everything except `/healthz`, `/livez`, and `/readyz`. Supply a `bearerToken` / `token` field to use `Authorization: Bearer <token>` on the request. Client certificate auth and OIDC are not supported — only Bearer tokens.

---

## API Endpoints

### `POST /api/kubernetes/probe` — Health check

Sends `GET /healthz HTTP/1.1` over TLS and reports whether the API server is reachable and healthy.

**Request:**

```json
{
  "host": "k8s.example.com",
  "port": 6443,
  "bearerToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "timeout": 15000
}
```

| Field | Default | Notes |
|---|---|---|
| `host` | required | Hostname or IP of the Kubernetes API server |
| `port` | `6443` | Standard API server port |
| `bearerToken` | — | Optional. Adds `Authorization: Bearer <token>` header. Required on hardened clusters even for `/healthz`. |
| `timeout` | `15000` | Wall-clock budget in ms for the entire connection + read cycle |

**Response (healthy, no auth required):**

```json
{
  "success": true,
  "host": "k8s.example.com",
  "port": 6443,
  "tcpLatency": 12,
  "isKubernetes": true,
  "isHealthy": true,
  "healthStatus": "ok",
  "httpStatus": 200,
  "httpStatusText": "OK",
  "serverHeader": "kube-apiserver/v1.28.2",
  "versionInfo": null,
  "endpoint": "/healthz",
  "note": "Kubernetes API server probed via HTTPS (TLS). Most endpoints require Bearer token authentication.",
  "authRequired": false
}
```

**Response (auth required on /healthz):**

```json
{
  "success": true,
  "host": "k8s.example.com",
  "port": 6443,
  "tcpLatency": 15,
  "isKubernetes": true,
  "isHealthy": false,
  "healthStatus": "{\"kind\":\"Status\",\"apiVersion\":\"v1\",...}",
  "httpStatus": 401,
  "httpStatusText": "Unauthorized",
  "serverHeader": "kube-apiserver/v1.28.2",
  "authRequired": true
}
```

**`isKubernetes` detection logic:**

The probe detects Kubernetes by looking for specific signals (not just any HTTP response):
- `Server` header contains `kube-apiserver`
- Response body is exactly `ok` (the canonical `/healthz` response)
- `WWW-Authenticate` header contains `Bearer realm="kubernetes`
- JSON body contains both `"apiVersion"` and `"kind"` fields (Status objects)

**`isHealthy` semantics:** `true` only when HTTP 200 AND body equals `ok`. A 401 on `/healthz` sets `isHealthy: false` but `isKubernetes: true`.

**`success` semantics:** Always `true` when the TCP+TLS connection succeeds and a response is received. `false` only on connection failure or timeout.

---

### `POST /api/kubernetes/query` — Arbitrary API path

Sends a `GET` request to any path on the Kubernetes API server. Use this for all read operations: listing resources, getting version info, fetching API discovery, etc.

**Request:**

```json
{
  "host": "k8s.example.com",
  "port": 6443,
  "path": "/api/v1/namespaces",
  "bearerToken": "eyJ...",
  "timeout": 15000
}
```

| Field | Default | Notes |
|---|---|---|
| `host` | required | |
| `port` | `6443` | |
| `path` | required | Must start with `/`. Include query string in `path`. |
| `bearerToken` | — | Adds `Authorization: Bearer` header |
| `timeout` | `15000` | |

**Path sanitization:** Characters not in `[a-zA-Z0-9/_\-.=?&:,%+()~]` are stripped. Standard label selector chars (`=`, `,`, `!`) are preserved.

**Response:**

```json
{
  "success": true,
  "host": "k8s.example.com",
  "port": 6443,
  "tcpLatency": 18,
  "path": "/api/v1/namespaces",
  "httpStatus": 200,
  "httpStatusText": "OK",
  "contentType": "application/json",
  "body": {
    "kind": "NamespaceList",
    "apiVersion": "v1",
    "items": [
      {"metadata": {"name": "default"}, "status": {"phase": "Active"}},
      {"metadata": {"name": "kube-system"}, "status": {"phase": "Active"}}
    ]
  },
  "authRequired": false
}
```

| Field | Notes |
|---|---|
| `success` | `true` for HTTP 200–299 |
| `body` | Parsed JSON object/array if response is JSON; otherwise raw string truncated at 2048 chars |
| `authRequired` | `true` when HTTP 401 or 403 |

**Common paths:**

| Path | Notes |
|---|---|
| `/healthz` | Health check — often unauthenticated |
| `/livez` | Liveness probe (K8s 1.16+) |
| `/readyz` | Readiness probe (K8s 1.16+) |
| `/version` | Server version info (may require auth) |
| `/apis` | API group discovery |
| `/api/v1` | Core API resource list |
| `/api/v1/namespaces` | List all namespaces |
| `/api/v1/nodes` | List all nodes |
| `/api/v1/pods` | List all pods (cluster-wide) |
| `/api/v1/namespaces/{ns}/pods` | List pods in namespace |
| `/api/v1/namespaces/{ns}/services` | List services |
| `/api/v1/namespaces/{ns}/configmaps` | List ConfigMaps |
| `/api/v1/namespaces/{ns}/secrets` | List Secrets (values redacted in RBAC-restricted clusters) |
| `/api/v1/namespaces/{ns}/events` | Recent events |
| `/apis/apps/v1/namespaces/{ns}/deployments` | List Deployments |
| `/apis/apps/v1/namespaces/{ns}/replicasets` | List ReplicaSets |
| `/apis/apps/v1/namespaces/{ns}/daemonsets` | List DaemonSets |
| `/apis/apps/v1/namespaces/{ns}/statefulsets` | List StatefulSets |
| `/apis/batch/v1/namespaces/{ns}/jobs` | List Jobs |
| `/apis/batch/v1/namespaces/{ns}/cronjobs` | List CronJobs |
| `/apis/rbac.authorization.k8s.io/v1/clusterroles` | List ClusterRoles |
| `/metrics` | Prometheus-format metrics (may require auth) |
| `/openapi/v2` | OpenAPI v2 schema |
| `/openapi/v3` | OpenAPI v3 schema (K8s 1.24+) |

**Query parameters of note:**

| Parameter | Example | Effect |
|---|---|---|
| `labelSelector` | `app=nginx,tier=frontend` | Filter by labels |
| `fieldSelector` | `status.phase=Running` | Filter by field values |
| `limit` | `500` | Page size for list operations |
| `continue` | `<token>` | Pagination continuation token |
| `resourceVersion` | `0` | Return cached data (faster, possibly stale) |
| `watch` | `true` | Long-poll watch stream (not supported — connection closes after first read) |
| `timeout` | `30s` | Server-side timeout for watch/list |

---

### `POST /api/kubernetes/logs` — Fetch pod logs

Fetches log lines from a container within a running pod. Maps to:
```
GET /api/v1/namespaces/{namespace}/pods/{pod}/log?tailLines={N}&timestamps=true[&container={c}]
```

**Request:**

```json
{
  "host": "k8s.example.com",
  "port": 6443,
  "token": "eyJ...",
  "namespace": "production",
  "pod": "web-7d4b9c8f6-xr2jk",
  "container": "nginx",
  "tailLines": 100,
  "timeout": 20000
}
```

| Field | Default | Notes |
|---|---|---|
| `host` | required | |
| `port` | `6443` | |
| `token` | — | Bearer token |
| `namespace` | required | Namespace where the pod runs |
| `pod` | required | Full pod name (not Deployment name) |
| `container` | — | Optional. Required when pod has more than one container. |
| `tailLines` | `100` | Number of lines from the end. No upper-bound validation — very large values may produce large responses. |
| `timeout` | `20000` | |

**Response:**

```json
{
  "success": true,
  "host": "k8s.example.com",
  "port": 6443,
  "namespace": "production",
  "pod": "web-7d4b9c8f6-xr2jk",
  "container": "nginx",
  "tailLines": 100,
  "httpStatus": 200,
  "lines": [
    "2024-01-15T10:23:45.123456789Z 10.0.0.1 - - [15/Jan/2024:10:23:45 +0000] \"GET / HTTP/1.1\" 200 612",
    "2024-01-15T10:23:46.987654321Z 10.0.0.2 - - [15/Jan/2024:10:23:46 +0000] \"GET /health HTTP/1.1\" 200 2"
  ],
  "lineCount": 2,
  "latencyMs": 85,
  "authRequired": false
}
```

**Notes:**
- Timestamps are always included (`timestamps=true` is hardcoded). Each line starts with an RFC3339Nano timestamp.
- `success` is `true` for HTTP 200–299. A 404 means the pod does not exist or has been evicted. A 400 with `message: "container X is not valid for pod Y"` means the `container` field is wrong or missing when required.
- Empty log lines are filtered out before returning.
- The response body is not truncated at a fixed size but is bounded by the connection read budget and the `timeout`.

**Multi-container pods:** Omitting `container` when a pod has multiple containers returns HTTP 400 from the API server: `"a container name must be specified for pod X, choose one of: [app sidecar init-container]"`.

**Previous container logs:** The Kubernetes API provides `?previous=true` to fetch logs from a terminated container — not directly exposed, but usable via the query endpoint: `/api/v1/namespaces/{ns}/pods/{pod}/log?previous=true&tailLines=50`.

---

### `POST /api/kubernetes/pod-list` — List pods

Lists pods in a namespace (or cluster-wide) with optional label filtering. Extracts a normalized summary from each pod item.

**Request:**

```json
{
  "host": "k8s.example.com",
  "port": 6443,
  "token": "eyJ...",
  "namespace": "production",
  "labelSelector": "app=nginx,tier=frontend",
  "timeout": 20000
}
```

| Field | Default | Notes |
|---|---|---|
| `host` | required | |
| `port` | `6443` | |
| `token` | — | Bearer token |
| `namespace` | — | Omit for cluster-wide pod list (requires `list pods` at cluster scope) |
| `labelSelector` | — | Kubernetes label selector expression |
| `timeout` | `20000` | |

**Response:**

```json
{
  "success": true,
  "host": "k8s.example.com",
  "port": 6443,
  "namespace": "production",
  "labelSelector": "app=nginx",
  "httpStatus": 200,
  "pods": [
    {
      "name": "web-7d4b9c8f6-xr2jk",
      "namespace": "production",
      "phase": "Running",
      "ip": "10.244.1.5",
      "node": "worker-node-1",
      "labels": {"app": "nginx", "tier": "frontend", "pod-template-hash": "7d4b9c8f6"}
    }
  ],
  "podCount": 1,
  "latencyMs": 42,
  "authRequired": false
}
```

**Pod `phase` values:** `Pending`, `Running`, `Succeeded`, `Failed`, `Unknown`.

**`namespace` in response:** When omitted in request, shows `"(all)"` in response.

**Cluster-wide listing:** Omitting `namespace` sends `GET /api/v1/pods`. This requires `list` permission on `pods` at the cluster scope (ClusterRole), not just within a namespace.

**Error body:** If `httpStatus >= 300`, `body` contains the raw Kubernetes Status object (JSON) or truncated text.

---

### `POST /api/kubernetes/apply` — Server-side apply

Applies a resource manifest using [Kubernetes Server-Side Apply](https://kubernetes.io/docs/reference/using-api/server-side-apply/). Uses:
```
PATCH {apiPath} HTTP/1.1
Content-Type: application/apply-patch+json
```
with `?fieldManager=portofcall&force=true`.

**Request:**

```json
{
  "host": "k8s.example.com",
  "port": 6443,
  "token": "eyJ...",
  "namespace": "production",
  "manifest": {
    "apiVersion": "apps/v1",
    "kind": "Deployment",
    "metadata": {
      "name": "web",
      "namespace": "production"
    },
    "spec": {
      "replicas": 3,
      "selector": {"matchLabels": {"app": "web"}},
      "template": {
        "metadata": {"labels": {"app": "web"}},
        "spec": {"containers": [{"name": "nginx", "image": "nginx:1.25"}]}
      }
    }
  },
  "timeout": 20000
}
```

| Field | Default | Notes |
|---|---|---|
| `host` | required | |
| `port` | `6443` | |
| `token` | — | Bearer token. Write operations almost always require auth. |
| `namespace` | required (for namespaced resources) | Ignored for cluster-scoped resources (Node, Namespace, ClusterRole, etc.) |
| `manifest` | required | Full Kubernetes manifest as a JSON object |
| `timeout` | `20000` | |

**Required manifest fields:**
- `manifest.apiVersion` — used to derive the API path (`v1` → `/api/v1`, `apps/v1` → `/apis/apps/v1`)
- `manifest.kind` — used to derive the REST resource name
- `manifest.metadata.name` — resource name in the URL path

**Response (success):**

```json
{
  "success": true,
  "host": "k8s.example.com",
  "port": 6443,
  "namespace": "production",
  "kind": "Deployment",
  "name": "web",
  "clusterScoped": false,
  "httpStatus": 200,
  "httpStatusText": "OK",
  "body": {
    "kind": "Deployment",
    "apiVersion": "apps/v1",
    "metadata": {"name": "web", "namespace": "production", "resourceVersion": "12345"}
  },
  "latencyMs": 120,
  "authRequired": false
}
```

**HTTP status semantics for server-side apply:**

| HTTP status | Meaning |
|---|---|
| 200 | Resource existed and was updated |
| 201 | Resource was newly created |
| 422 | Manifest validation failed (schema error, immutable field change) |
| 401 | No valid token |
| 403 | Token lacks permission |
| 404 | API group/version not available (CRD not installed) |
| 409 | Conflict (field manager conflict — force=true is set but may not resolve all conflicts) |

**`clusterScoped` in response:** `true` for cluster-scoped kinds (Node, Namespace, ClusterRole, etc.), with `namespace: null`. `false` for namespaced resources.

---

## Kind → REST Resource Path Mapping

The apply endpoint auto-derives the REST resource name from the `manifest.kind` field.

### Pluralization rules

1. Check `KIND_PLURALS` table (irregular/special cases)
2. If kind ends in consonant+y: replace `y` with `ies` (e.g. `NetworkPolicy` → `networkpolicies`)
3. Otherwise: append `s` (e.g. `Deployment` → `deployments`)

**KIND_PLURALS table (irregular forms handled explicitly):**

| Kind | REST resource |
|---|---|
| `Endpoints` | `endpoints` |
| `Ingress` | `ingresses` |
| `NetworkPolicy` | `networkpolicies` |
| `ResourceQuota` | `resourcequotas` |
| `LimitRange` | `limitranges` |
| `StorageClass` | `storageclasses` |
| `IngressClass` | `ingressclasses` |
| `RuntimeClass` | `runtimeclasses` |
| `PriorityClass` | `priorityclasses` |

### Cluster-scoped vs. namespaced resources

Cluster-scoped resources use paths without `/namespaces/{ns}/`:

| Kind | Path pattern |
|---|---|
| `Namespace` | `/api/v1/namespaces/{name}` |
| `Node` | `/api/v1/nodes/{name}` |
| `PersistentVolume` | `/api/v1/persistentvolumes/{name}` |
| `ClusterRole` | `/apis/rbac.authorization.k8s.io/v1/clusterroles/{name}` |
| `ClusterRoleBinding` | `/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/{name}` |
| `StorageClass` | `/apis/storage.k8s.io/v1/storageclasses/{name}` |
| `CustomResourceDefinition` | `/apis/apiextensions.k8s.io/v1/customresourcedefinitions/{name}` |
| `MutatingWebhookConfiguration` | `/apis/admissionregistration.k8s.io/v1/mutatingwebhookconfigurations/{name}` |
| `ValidatingWebhookConfiguration` | `/apis/admissionregistration.k8s.io/v1/validatingwebhookconfigurations/{name}` |
| `CertificateSigningRequest` | `/apis/certificates.k8s.io/v1/certificatesigningrequests/{name}` |
| `FlowSchema` | `/apis/flowcontrol.apiserver.k8s.io/v1/flowschemas/{name}` |
| `PriorityLevelConfiguration` | `/apis/flowcontrol.apiserver.k8s.io/v1/prioritylevelconfigurations/{name}` |
| `VolumeAttachment` | `/apis/storage.k8s.io/v1/volumeattachments/{name}` |

Namespaced resources use `/namespaces/{ns}/` in the path:

| Kind | Path pattern |
|---|---|
| `Pod` | `/api/v1/namespaces/{ns}/pods/{name}` |
| `Service` | `/api/v1/namespaces/{ns}/services/{name}` |
| `ConfigMap` | `/api/v1/namespaces/{ns}/configmaps/{name}` |
| `Secret` | `/api/v1/namespaces/{ns}/secrets/{name}` |
| `Deployment` | `/apis/apps/v1/namespaces/{ns}/deployments/{name}` |
| `StatefulSet` | `/apis/apps/v1/namespaces/{ns}/statefulsets/{name}` |
| `DaemonSet` | `/apis/apps/v1/namespaces/{ns}/daemonsets/{name}` |
| `Job` | `/apis/batch/v1/namespaces/{ns}/jobs/{name}` |
| `CronJob` | `/apis/batch/v1/namespaces/{ns}/cronjobs/{name}` |
| `Ingress` | `/apis/networking.k8s.io/v1/namespaces/{ns}/ingresses/{name}` |
| `NetworkPolicy` | `/apis/networking.k8s.io/v1/namespaces/{ns}/networkpolicies/{name}` |
| `ServiceAccount` | `/api/v1/namespaces/{ns}/serviceaccounts/{name}` |
| `Role` | `/apis/rbac.authorization.k8s.io/v1/namespaces/{ns}/roles/{name}` |
| `RoleBinding` | `/apis/rbac.authorization.k8s.io/v1/namespaces/{ns}/rolebindings/{name}` |
| `HorizontalPodAutoscaler` | `/apis/autoscaling/v2/namespaces/{ns}/horizontalpodautoscalers/{name}` |
| `PodDisruptionBudget` | `/apis/policy/v1/namespaces/{ns}/poddisruptionbudgets/{name}` |

---

## Authentication Methods

### Bearer token (ServiceAccount)

The most common method for in-cluster or scripted access.

```bash
# Get a short-lived token for a ServiceAccount (K8s 1.24+)
kubectl create token <service-account-name> -n <namespace>

# Extract long-lived token from legacy SA secret (K8s <1.24)
kubectl get secret <sa-name>-token -n <ns> -o jsonpath='{.data.token}' | base64 -d
```

Pass as `"bearerToken"` (probe/query endpoints) or `"token"` (logs/pod-list/apply endpoints).

### kubeconfig token

```bash
# Extract current context token
kubectl config view --raw --minify -o jsonpath='{.users[0].user.token}'
```

### OIDC tokens

OIDC tokens from your identity provider work as Bearer tokens if the cluster is configured for OIDC auth. They expire (typically 1 hour) and must be refreshed externally.

### What is NOT supported

- **Client certificate auth** — requires sending a TLS client certificate during the TLS handshake, which is not possible via the `cloudflare:sockets` API
- **Basic auth** — deprecated and disabled by default since Kubernetes 1.19
- **Token from kubeconfig exec plugin** — `aws eks get-token`, `gke-gcloud-auth-plugin`, etc. must be run externally to obtain the raw token string, which can then be passed as `bearerToken`

---

## Kubernetes API Version Reference

| Resource type | `apiVersion` | API path prefix |
|---|---|---|
| Core (Pod, Service, ConfigMap, etc.) | `v1` | `/api/v1` |
| Deployments, DaemonSets, StatefulSets | `apps/v1` | `/apis/apps/v1` |
| Jobs, CronJobs | `batch/v1` | `/apis/batch/v1` |
| HorizontalPodAutoscaler | `autoscaling/v2` | `/apis/autoscaling/v2` |
| Ingress, NetworkPolicy | `networking.k8s.io/v1` | `/apis/networking.k8s.io/v1` |
| Role, RoleBinding, ClusterRole, ClusterRoleBinding | `rbac.authorization.k8s.io/v1` | `/apis/rbac.authorization.k8s.io/v1` |
| StorageClass, VolumeAttachment | `storage.k8s.io/v1` | `/apis/storage.k8s.io/v1` |
| CustomResourceDefinition | `apiextensions.k8s.io/v1` | `/apis/apiextensions.k8s.io/v1` |
| PodDisruptionBudget | `policy/v1` | `/apis/policy/v1` |
| CertificateSigningRequest | `certificates.k8s.io/v1` | `/apis/certificates.k8s.io/v1` |
| FlowSchema, PriorityLevelConfiguration | `flowcontrol.apiserver.k8s.io/v1` | `/apis/flowcontrol.apiserver.k8s.io/v1` |
| MutatingWebhookConfiguration, ValidatingWebhookConfiguration | `admissionregistration.k8s.io/v1` | `/apis/admissionregistration.k8s.io/v1` |

---

## curl Examples

```bash
BASE=https://portofcall.ross.gg
TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
HOST="k8s.example.com"

# Health check (no auth — works on most clusters)
curl -s -X POST $BASE/api/kubernetes/probe \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\"}" | jq '{isKubernetes,isHealthy,httpStatus,serverHeader}'

# Health check with auth (for hardened clusters)
curl -s -X POST $BASE/api/kubernetes/probe \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"bearerToken\":\"$TOKEN\"}" | jq '{isHealthy,httpStatus}'

# Get server version
curl -s -X POST $BASE/api/kubernetes/query \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"path\":\"/version\",\"bearerToken\":\"$TOKEN\"}" \
  | jq '.body | {gitVersion,platform}'

# List all namespaces
curl -s -X POST $BASE/api/kubernetes/query \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"path\":\"/api/v1/namespaces\",\"bearerToken\":\"$TOKEN\"}" \
  | jq '.body.items[].metadata.name'

# List running pods in a namespace
curl -s -X POST $BASE/api/kubernetes/query \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"path\":\"/api/v1/namespaces/production/pods?fieldSelector=status.phase%3DRunning\",\"bearerToken\":\"$TOKEN\"}" \
  | jq '.body.items[] | {name:.metadata.name,node:.spec.nodeName,ip:.status.podIP}'

# List pods using pod-list endpoint (structured output)
curl -s -X POST $BASE/api/kubernetes/pod-list \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"token\":\"$TOKEN\",\"namespace\":\"production\",\"labelSelector\":\"app=nginx\"}" \
  | jq '.pods[] | {name,phase,ip,node}'

# Get pod logs (last 50 lines with timestamps)
curl -s -X POST $BASE/api/kubernetes/logs \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"token\":\"$TOKEN\",\"namespace\":\"production\",\"pod\":\"web-7d4b9c8f6-xr2jk\",\"tailLines\":50}" \
  | jq '.lines[]'

# Get logs from a specific container in a multi-container pod
curl -s -X POST $BASE/api/kubernetes/logs \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"token\":\"$TOKEN\",\"namespace\":\"production\",\"pod\":\"web-abc123\",\"container\":\"nginx\",\"tailLines\":100}" \
  | jq '.lines[-10:]'

# List all Deployments across all namespaces
curl -s -X POST $BASE/api/kubernetes/query \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"path\":\"/apis/apps/v1/deployments\",\"bearerToken\":\"$TOKEN\"}" \
  | jq '.body.items[] | {name:.metadata.name,ns:.metadata.namespace,replicas:.spec.replicas,ready:.status.readyReplicas}'

# Get events in a namespace (sorted by time)
curl -s -X POST $BASE/api/kubernetes/query \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"path\":\"/api/v1/namespaces/production/events?limit=50\",\"bearerToken\":\"$TOKEN\"}" \
  | jq '.body.items | sort_by(.lastTimestamp) | .[] | {type,reason,message:.message[:80],regarding:.regarding.name}'

# Apply a ConfigMap (namespaced resource)
curl -s -X POST $BASE/api/kubernetes/apply \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "'"$HOST"'",
    "token": "'"$TOKEN"'",
    "namespace": "production",
    "manifest": {
      "apiVersion": "v1",
      "kind": "ConfigMap",
      "metadata": {"name": "app-config", "namespace": "production"},
      "data": {"DATABASE_URL": "postgres://db.example.com/mydb"}
    }
  }' | jq '{success,httpStatus,name,clusterScoped}'

# Apply a ClusterRole (cluster-scoped — namespace field is ignored for path)
curl -s -X POST $BASE/api/kubernetes/apply \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "'"$HOST"'",
    "token": "'"$TOKEN"'",
    "namespace": "any-value-ignored",
    "manifest": {
      "apiVersion": "rbac.authorization.k8s.io/v1",
      "kind": "ClusterRole",
      "metadata": {"name": "pod-reader"},
      "rules": [{"apiGroups": [""], "resources": ["pods"], "verbs": ["get","list","watch"]}]
    }
  }' | jq '{success,httpStatus,clusterScoped,namespace}'

# API discovery: what resources does this cluster support?
curl -s -X POST $BASE/api/kubernetes/query \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"path\":\"/apis\",\"bearerToken\":\"$TOKEN\"}" \
  | jq '.body.groups[].name'

# Check node status and capacity
curl -s -X POST $BASE/api/kubernetes/query \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"path\":\"/api/v1/nodes\",\"bearerToken\":\"$TOKEN\"}" \
  | jq '.body.items[] | {name:.metadata.name,ready:(.status.conditions[]|select(.type=="Ready")|.status),cpu:.status.capacity.cpu,mem:.status.capacity.memory}'

# Paginate a large list (limit + continue)
curl -s -X POST $BASE/api/kubernetes/query \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"path\":\"/api/v1/pods?limit=100\",\"bearerToken\":\"$TOKEN\"}" \
  | jq '{count:.body.items|length,continueToken:.body.metadata.continue}'
```

---

## Edge Cases and Known Limitations

### TLS certificate validation

Workers validates the TLS certificate presented by the API server. Self-signed certificates (the default in `kubeadm` clusters, `minikube`, `k3s`, `kind`, `k0s`, etc.) will fail the TLS handshake. Options:
- Configure the API server with a CA-signed certificate
- Use a load balancer or ingress with a real TLS cert in front of the API server
- Use a managed cluster with a public API endpoint (EKS, GKE, AKS all use trusted certs)

There is no `insecureSkipVerify` — this is a hard constraint of the Workers runtime.

### Watch streams not supported

The `?watch=true` parameter opens a long-lived chunked response where each chunk is a JSON event object. The `readHTTPResponse` function reads until the connection closes or a 500ms inter-chunk gap occurs. In practice, the watch response begins immediately with an empty keepalive, then the connection sits open indefinitely — the 500ms timer fires and returns a partial or empty body. Do not use `?watch=true` via this implementation.

### Large list responses

API responses are not truncated at a fixed size — they are bounded by the socket read timeout and Workers CPU time. Lists of resources in large clusters (hundreds of namespaces, thousands of pods) can produce multi-megabyte JSON responses. Use `?limit=100` and paginate with the `continue` token from `metadata.continue` in the response.

### Server-side apply with Custom Resources

For Custom Resources, the `kind` and `apiVersion` in the manifest must exactly match the CRD spec. If the CRD is not installed, the API server returns 404 (`"the server could not find the requested resource"`). There is no auto-discovery of CRD resource names — the `pluralizeKind` function uses standard English rules which may not match a CRD's `spec.names.plural`. If the auto-derived plural is wrong, use the query endpoint with the correct path instead.

### `fieldManager=portofcall` and `force=true`

The apply endpoint always sends `?fieldManager=portofcall&force=true`. `force=true` means Port of Call will take ownership of any fields previously owned by another manager (e.g. Helm). This is intentional for the server-side apply workflow but will steal field ownership from other tools managing the same resource.

### Cluster-scoped CRDs not in CLUSTER_SCOPED_KINDS

The `CLUSTER_SCOPED_KINDS` set covers all standard built-in Kubernetes resources. Custom Resource Definitions can be either cluster-scoped or namespaced — this is determined by `spec.scope` in the CRD definition. If you need to apply a cluster-scoped CRD instance, and it is not in the built-in list, the apply endpoint will route it to the namespaced path and receive a 404. Use the query endpoint (GET) to verify the correct path, or add the kind to `CLUSTER_SCOPED_KINDS` in the source.

### No subresource support in apply

The apply endpoint targets the main resource only, not subresources (`/status`, `/scale`, `/exec`, `/log`, `/proxy`). Use the query endpoint (GET only) for subresource reads.

### HTTP/1.1 only — no HTTP/2

The Kubernetes API server supports HTTP/1.1 and HTTP/2. This implementation uses HTTP/1.1 only (`cloudflare:sockets` does not negotiate HTTP/2). For most read and write operations this is fine. The one exception is `kubectl exec` / `kubectl port-forward`, which uses SPDY over HTTP/1.1 or HTTP/2 streaming framing — not supported by this implementation.

### Impersonation headers not supported

Kubernetes supports `Impersonate-User`, `Impersonate-Group`, and `Impersonate-Extra-*` headers for acting on behalf of another principal. None of the Port of Call endpoints expose these headers.

### `tailLines` for logs has no upper bound

The logs endpoint accepts any integer for `tailLines` with no upper-bound validation. Requesting 100,000 lines from a verbose pod may produce a multi-megabyte response. The practical limit is the Workers CPU/memory budget and the `timeout` setting.
