# Todo
Items that need to be done

## Other
* [x] Make it more obvious that the protocol name is a link in https://l4.fyi/ , RFCs section — Added blue underline styling to protocol names
* [x] Each tab should have a different path (i.e. /rfc, /about) — Tabs now sync with URL hash (#about, #rfcs, #checklist)
* [x] Complete UI rearchitecture so it looks cool and is easier to navigate protocols. — Added 3 view modes (Cards/Rows/Grid) with toggle, persisted in localStorage
* [x] Make it more obvious on the main page that you should set this up with docker on your VPS (and that you can't) — Added Docker deployment target section in About tab
* [x] Review docs/. If it doesn't have a tree list of protocols and their available commands per spec, please create this. — Created docs/PROTOCOL_COMMANDS.md and docs/PROTOCOL_CURL_TESTS.md
* [x] Review the manual checklist. Is it really 3 items per protocol? — Yes: 222/227 protocols have 3 features, 5 have 4
* [x] In the checklist, it can't save. It says "Failed to save — change was reverted" — Implemented /api/checklist GET/POST endpoints backed by CHECKLIST KV namespace
* [x] Categories are two lines when they should all be on one line — Changed flex-wrap to flex-nowrap with horizontal scroll
* [x] docs/protocols has weird duplicates like 'ECHO' and 'ECHO (1)'. Please consolidate all of the protocols to be just capitalized(.md) — Deleted 70 duplicate "(1)" files, renamed lowercase files to UPPERCASE

## Plan: curl-Friendly Interface for Port of Call
Context
Port of Call has 180+ protocol endpoints accessible via POST /api/{protocol}/{action} with JSON bodies. This works for the React SPA but is verbose from the command line. The goal: make portofcall as curl-friendly as wttr.in or cheat.sh — memorable URLs, plain text output, and a downloadable CLI wrapper. Two features shipping together.

Feature 1: Short URL Routes
URL scheme

curl l4.fyi/synping/example.com:22
curl l4.fyi/dns/example.com/MX
curl l4.fyi/http/example.com/robots.txt
curl l4.fyi/ssh/github.com
curl l4.fyi/whois/example.com
curl l4.fyi/redis/cache.example.com:6379
Pattern: /:protocol/:host[:port][/extra]

15 protocols with short routes:

Route	Default Port	Extra path	Maps to
/synping/:target	(required)	—	handleTcpPing
/tcp/:target	(required)	—	handleTcpSend
/http/:target[/path]	80	request path	handleHTTPRequest
/https/:target[/path]	443	request path	handleHTTPRequest (tls:true)
/dns/:domain[/:type]	53	record type (A, MX, etc.)	handleDNSQuery
/ssh/:target	22	—	handleSSHConnect
/ftp/:target	21	—	handleFTPConnect
/redis/:target	6379	—	handleRedisConnect
/mysql/:target	3306	—	handleMySQLConnect
/postgres/:target	5432	—	handlePostgresConnect
/smtp/:target	25	—	handleSMTPConnect
/whois/:domain	43	—	handleWhoisLookup
/ntp/:target	123	—	handleNTPQuery
/tls/:target	443	—	handleHTTPRequest (tls:true, HEAD)
/ws/:target[/path]	80	WS path	handleWebSocketProbe
Query param override: ?timeout=5000

Content negotiation
Accept: application/json or explicit --json → JSON (current format)
Accept: text/html (browsers) → 302 redirect to /
Everything else (curl default */*) → plain text
Plain text output format

PORTOFCALL synping example.com:22

  Host        example.com
  Port        22
  Status      OPEN
  RTT         42.17 ms

  Probed at   2026-02-20T23:14:00Z via l4.fyi
Error case:


PORTOFCALL synping badhost.example:22

  ERROR  Connection timeout after 10000ms
  Host   badhost.example
  Port   22
Dispatch mechanism
Short routes construct a synthetic Request with JSON body and call the existing handler function directly (e.g., handleTcpPing(syntheticRequest)). No router re-entry, no double guard checks. The SSRF/Cloudflare guards are applied explicitly to the parsed host before dispatch.

Feature 2: poc CLI Script
Served at GET /cli. A ~120-line bash script with:

Protocol auto-detection from port (poc example.com:6379 → redis, poc example.com:22 → ssh)
--json flag for raw JSON output
ANSI colors when connected to a TTY (respects NO_COLOR)
--timeout=N override
Zero dependencies beyond curl
Install: curl -sL l4.fyi/cli > /usr/local/bin/poc && chmod +x $_
Feature 3: curl Landing Page
curl l4.fyi shows ASCII art + usage examples (only when detected as curl, browsers get the SPA).

New Files
File	Purpose
src/worker/cli-routes.ts	parseTarget(), matchShortRoute(), dispatchShortRoute(), protocol config map
src/worker/formatters.ts	formatResponse() + per-protocol plain text formatters, kv()/header()/footer() helpers
src/worker/content-negotiation.ts	detectClient() → `'curl'
src/worker/cli-script.ts	serveCLIScript() — returns the bash script as text/plain
src/worker/curl-landing.ts	serveCurlLandingPage() — ASCII art + usage
Modified Files
File	Change
src/worker/index.ts	Insert short route handling after SSRF/CF guards (~line 612), before /api/ping. Add /cli route. Add curl landing page check before env.ASSETS.fetch() fallthrough.
Integration Point in index.ts

[line 611] } // end SSRF guard

// NEW: Short URL routes + CLI
if (url.pathname === '/cli') return serveCLIScript();

const shortRoute = matchShortRoute(url.pathname);
if (shortRoute) {
  // Apply SSRF guard to parsed host
  if (shortRoute.host && isBlockedHost(shortRoute.host)) {
    return ssrfBlockedResponse(shortRoute.host);
  }
  // Apply Cloudflare guard
  const cfCheck = await checkIfCloudflare(shortRoute.host);
  if (cfCheck.isCloudflare && cfCheck.ip) {
    return cloudflareBlockedResponse(shortRoute.host, cfCheck.ip);
  }

  const clientType = detectClient(request);
  if (clientType === 'browser') return Response.redirect('/', 302);

  const jsonResponse = await dispatchShortRoute(shortRoute, url.searchParams);
  if (clientType === 'json') return jsonResponse;

  const json = await jsonResponse.json();
  const text = formatResponse(shortRoute.protocol, json, shortRoute.rawTarget);
  return new Response(text, {
    status: jsonResponse.status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// NEW: curl landing page (before SPA fallthrough)
if (url.pathname === '/' && detectClient(request) === 'curl') {
  return serveCurlLandingPage();
}

[line 613] // API endpoint for TCP ping
Implementation Order
content-negotiation.ts — smallest, no deps
cli-routes.ts — parseTarget() + route matching + dispatch
formatters.ts — start with ping/dns/http, add rest
curl-landing.ts — ASCII art landing page
cli-script.ts — bash script
index.ts — wire everything together
Tests for parseTarget(), detectClient(), and integration tests for short routes
Verification
npm run build — TypeScript compiles
npx wrangler dev then manual curl tests:
curl localhost:8787/synping/example.com:22 → plain text
curl -H 'Accept: application/json' localhost:8787/synping/example.com:22 → JSON
curl localhost:8787/dns/example.com/MX → dig-style output
curl localhost:8787/cli → bash script
curl localhost:8787/ → landing page
Browser visit → SPA loads normally
Run existing test suite to confirm no regressions

## Protocol Reviews Remaining

### Implemented but Not Reviewed (81 protocols)

These protocols are implemented in `src/worker/` but lack code reviews. See `docs/changelog/by-protocol/` for review template.

**Review Priority:**
1. High-traffic: HTTP, WEBSOCKET, PROMETHEUS, GRAFANA
2. Legacy/Simple RFCs: CHARGEN, DAYTIME, DISCARD, TIME, IDENT, DICT, ACTIVEUSERS (quick wins)
3. Security-critical TLS variants: FTPS, IMAPS, SMTPS, NNTPS, SIPS
4. Industrial: MODBUS, DNP3, S7COMM, IEC104
5. Modern databases: CLICKHOUSE, COUCHBASE, MEILISEARCH, TARANTOOL

### Cannot Be Implemented (2 protocols with spec files)

- `docs/protocols/GRPC.md` → move to `docs/protocols/non-tcp/` (requires HTTP/2 ALPN)
- `docs/protocols/HTTP2.md` → move to `docs/protocols/non-tcp/` (requires TLS ALPN)

See `docs/reference/IMPOSSIBLE.md` for details.