# Pass 2 Protocol Review — 2026-02-23

Protocols: DOCKER, ETHEREUM, FASTCGI, ELASTICSEARCH, KIBANA, KUBERNETES
Criteria: power-user feature parity, spec completeness, security, accessibility, usability

---

## DOCKER (`src/worker/docker.ts`)

### BUG-DOCKER-1 — `handleDockerExec` corrupts binary log frame headers on non-HTTPS path (CRITICAL)
**Lines:** 1124–1127
**Issue:** The Docker exec/start response uses a binary multiplexed stream (8-byte frame header per log line when `Tty: false`). On the non-HTTPS TCP path, `sendHttpRequest` decodes the response body as UTF-8 (`TextDecoder`), then `new TextEncoder().encode(r2.body)` re-encodes it. If the raw response bytes contain invalid UTF-8 sequences (common in binary frame headers with values > 0x7F), the replacement character U+FFFD (3 bytes: 0xEF 0xBF 0xBD) is substituted, corrupting the binary frame-size fields and causing `parseDockerLogs` to fail or return garbage. The HTTPS path correctly uses `arrayBuffer()` → `Uint8Array`.
**Fix:** Replace the non-HTTPS exec-start body collection with a direct raw-bytes read (mirroring `handleDockerContainerLogs`) to avoid the string codec roundtrip.

### BUG-DOCKER-2 — `handleDockerQuery` path allowlist does not block `..` traversal (HIGH)
**Lines:** 366–371
**Issue:** The allowlist check uses `normalizedPath.startsWith(prefix)` — a path like `/containers/../../etc/passwd` passes since it starts with `/containers/`. Subsequent `..` normalization by an HTTP server or intermediary could route the request to an unintended endpoint.
**Fix:** Reject any path containing `..` segments before the allowlist check.

### BUG-DOCKER-3 — `handleDockerContainerLogs` `tail` parameter unbounded (LOW)
**Line:** 799, 828
**Issue:** `tail` defaults to 100 but accepts any user-provided value including negative numbers or values in the millions. A `tail=-1` would be sent verbatim to Docker (which interprets it as "all logs"), potentially returning enormous payloads.
**Fix:** Clamp `tail` to a valid range (1–10 000). Document that `-1` = all logs is not supported.

---

## ETHEREUM (`src/worker/ethereum.ts`)

### IMPROVEMENT-ETH-1 — `handleEthereumInfo` omits gas-price and EIP-1559 fields (LOW)
**Lines:** 467–473
**Issue:** The node overview queries `web3_clientVersion`, `net_version`, `eth_chainId`, `eth_blockNumber`, and `eth_syncing` in parallel. A power user diagnosing a node would expect `eth_gasPrice` and `eth_feeHistory` to assess mempool health and EIP-1559 baseFee. These are missing.
**Fix:** Add `eth_gasPrice` to the parallel call set; include the decoded wei value in the response.

### IMPROVEMENT-ETH-2 — `callRPC` hardcodes HTTP only; no HTTPS JSON-RPC support (LOW)
**Line:** 147
**Issue:** `const url = \`http://${host}:${port}/\`` — nodes behind TLS (e.g. Infura, Alchemy, self-hosted with Nginx) are on HTTPS. Users cannot query HTTPS JSON-RPC endpoints.
**Note:** This is a general limitation documented elsewhere; noting here for completeness.

---

## FASTCGI (`src/worker/fastcgi.ts`)

### BUG-FCGI-1 — `SCRIPT_NAME` set to filesystem path instead of URL path (MEDIUM)
**Line:** 481
**Issue:** The FastCGI spec (and CGI/1.1 spec) defines `SCRIPT_NAME` as the URL path component identifying the script (e.g. `/index.php`), distinct from `SCRIPT_FILENAME` which is the filesystem path (e.g. `/var/www/html/index.php`). The code sets both to `scriptFilename`. Some PHP-FPM configurations use `SCRIPT_NAME` for URL routing; passing a filesystem path here is a protocol violation that can cause 404 errors or path-disclosure behavior in misconfigured servers.
**Fix:** Set `SCRIPT_NAME` to `requestUri` (the URL path) rather than `scriptFilename`.

### IMPROVEMENT-FCGI-2 — `SCRIPT_FILENAME` with arbitrary path enables file disclosure on connected server (LOW/SECURITY)
**Line:** 479
**Issue:** `scriptFilename` is user-controlled with no path validation. On a PHP-FPM server accessible from L4.FYI, setting `SCRIPT_FILENAME=/etc/passwd` causes PHP-FPM to attempt to parse `/etc/passwd` as PHP, potentially exposing its content in the error output. This is the well-known "Nginx + FastCGI injection" attack. Since L4.FYI already requires the user to supply the target host (implying authorization), this is a documentation note rather than a code fix, but should be called out in the UI.
**Fix (documentation):** Add a comment in the request handler and API docs noting that `scriptFilename` must be within the server's document root.

---

## ELASTICSEARCH (`src/worker/elasticsearch.ts`)

### BUG-ES-1 — `handleElasticsearchHealth` missing Cloudflare check (CRITICAL/SECURITY)
**Lines:** 200–272
**Issue:** Every other handler in `elasticsearch.ts` (query, https, index, delete, create-index) calls `checkIfCloudflare(host)` before opening a connection. `handleElasticsearchHealth` does **not**. This means the health endpoint can be used to probe any host including Cloudflare-protected targets, bypassing the SSRF guardrail that all other handlers enforce.
**Fix:** Import `checkIfCloudflare` and `getCloudflareErrorMessage` from `./cloudflare-detector` and add the standard Cloudflare check after the `!host` validation.

### IMPROVEMENT-ES-2 — `decodeChunked` silently loses data on truncated responses (LOW)
**Lines:** 155–180
**Issue:** Unlike the equivalent function in `docker.ts` (which tracks `lastChunkSize` and emits a `console.warn` when the zero-length terminator is missing), the Elasticsearch version breaks silently. Truncated Elasticsearch responses (e.g. when the 512 KB cap is hit mid-chunk) are returned without any indication.
**Fix:** Add `lastChunkSize` tracking and `console.warn` on incomplete terminator, matching `docker.ts`.

---

## KIBANA (`src/worker/kibana.ts`)

### BUG-KIB-1 — `sendHttpGet` and `sendHttpWithAuth` missing CRLF sanitization (HIGH/SECURITY)
**Lines:** 55–59 (`sendHttpGet`), 306–326 (`sendHttpWithAuth`)
**Issue:** Neither function sanitizes `host`, `path`, or `apiKey` for `\r\n` sequences before embedding them into raw HTTP headers. A crafted host like `"evil.com\r\nX-Injected: value"` would inject arbitrary headers. Note: the `checkIfCloudflare` DNS check may incidentally catch many such values (DNS resolution fails for hostnames with `\r\n`), but the sanitization should be explicit and not rely on side effects.
**Fix:** Apply `.replace(/[\r\n]/g, '')` to `host`, `path`, and `apiKey` before use in header construction. (Pattern already used in `docker.ts` and `elasticsearch.ts`.)

### BUG-KIB-2 — `handleKibanaStatus` ignores user-provided `timeout` field (MEDIUM)
**Line:** 144
**Issue:** The request body accepts only `{host, port}` and ignores `timeout`. All other Kibana handlers accept a `timeout` parameter. `sendHttpGet` defaults to 15 000 ms; users cannot reduce it for faster failure detection or increase it for slow clusters.
**Fix:** Destructure `timeout` from the request body and pass it to `sendHttpGet`.

### BUG-KIB-3 — Error response shape inconsistent: missing `success: false` field (LOW)
**Lines:** 153, 228–229, 416–417, 475–476, 545–546, 199, 274, 445, 514, 578
**Issue:** On Cloudflare-blocked and internal error responses, handlers return `{ error: "..." }` without the `success: false` field that the rest of the API always includes. Client code checking `data.success` would silently treat these as truthy (undefined ≠ false). The successful-path response includes `success` but the error paths do not.
**Fix:** Add `success: false` to all error response objects.

---

## KUBERNETES (`src/worker/kubernetes.ts`)

### BUG-K8S-1 — Bearer token not sanitized for CRLF injection (HIGH/SECURITY)
**Lines:** 305–307 (`handleKubernetesProbe`), 451–453 (`handleKubernetesQuery`), 619 (`handleKubernetesLogs`), 765 (`handleKubernetesPodList`), 988 (`handleKubernetesApply`)
**Issue:** All five handlers build the `Authorization: Bearer {token}` header by direct string interpolation with no CRLF sanitization. A `token` value containing `\r\n` (e.g. `"valid_token\r\nX-Evil: injected"`) would inject extra HTTP headers into the request sent to the Kubernetes API server.
**Fix:** Apply `.replace(/[\r\n]/g, '')` to `bearerToken`/`token` before constructing the auth header.

### BUG-K8S-2 — `handleKubernetesApply` `namespace` and `name` not validated (HIGH)
**Lines:** 950, 960–970
**Issue:** `handleKubernetesLogs` and `handleKubernetesPodList` already validate `namespace` (and in logs, `pod`) against `K8S_NAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/`. `handleKubernetesApply` does not. The `namespace` value from the request body and `name` from `manifest.metadata.name` are inserted directly into the API path. The `safePath` sanitization allows `.` and `/`, so a namespace of `"default/../kube-system"` or a name of `"pod/../clusterroles/admin"` would survive path cleanup and reach the API server as a traversal attempt.
**Fix:** Apply `K8S_NAME_RE` validation to both `namespace` (when required) and `name` before constructing the apply path.

### BUG-K8S-3 — `parseHTTPResponse` does not decode chunked transfer encoding (MEDIUM)
**Lines:** 188–217
**Issue:** `readHTTPResponse` correctly detects `transfer-encoding: chunked` and keeps buffering until data is complete, but `parseHTTPResponse` does not strip chunk-size lines from the body. A chunked Kubernetes API response produces a body like `"1a\n{\"apiVersion\":\"v1\",...}\n0\n"` which fails `JSON.parse`. Large list responses from busy clusters (many pods, many events) are most likely to use chunked encoding.
**Fix:** Add chunked-body decoding to `parseHTTPResponse`, using the raw `\r\n` delimiters preserved in the input string.

---

## Fix Status

| ID | Protocol | Severity | Fixed |
|----|----------|----------|-------|
| BUG-DOCKER-1 | Docker | CRITICAL | ✅ |
| BUG-DOCKER-2 | Docker | HIGH | ✅ |
| BUG-DOCKER-3 | Docker | LOW | ✅ |
| IMPROVEMENT-ETH-1 | Ethereum | LOW | — |
| IMPROVEMENT-ETH-2 | Ethereum | LOW | — |
| BUG-FCGI-1 | FastCGI | MEDIUM | ✅ |
| IMPROVEMENT-FCGI-2 | FastCGI | LOW | — |
| BUG-ES-1 | Elasticsearch | CRITICAL | ✅ |
| IMPROVEMENT-ES-2 | Elasticsearch | LOW | ✅ |
| BUG-KIB-1 | Kibana | HIGH | ✅ |
| BUG-KIB-2 | Kibana | MEDIUM | ✅ |
| BUG-KIB-3 | Kibana | LOW | ✅ |
| BUG-K8S-1 | Kubernetes | HIGH | ✅ |
| BUG-K8S-2 | Kubernetes | HIGH | ✅ |
| BUG-K8S-3 | Kubernetes | MEDIUM | ✅ |
