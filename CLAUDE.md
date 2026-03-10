# Claude Code Project Guidelines — Port of Call

## What This Is
A browser-to-TCP bridge deployed as a Cloudflare Worker. Uses the `cloudflare:sockets` API to proxy TCP connections from the browser via WebSocket tunnels.

Live: https://l4.fyi

## Tech Stack
- **Frontend:** Vite 7 + React 19 + TypeScript + Tailwind CSS 3
- **Backend:** Cloudflare Worker (`src/worker/index.ts`)
- **Terminal UI:** xterm.js (SSH, Telnet clients)
- **Protocols:** 234 TCP protocol implementations

## Commands
- `npm run dev` — Vite dev server (port 5173)
- `npm run build` — `tsc && vite build`
- `npm run worker:dev` — Wrangler dev server (port 8787)
- `npm run worker:deploy` — Deploy to Cloudflare Workers (same as `npx wrangler deploy`)
- `npm run test` — Vitest test suite

## Validation — CRITICAL
**ALWAYS run `npm run build` before marking a feature complete.** This catches TypeScript errors, unused variables, and build breakage.

## Project Structure
- `src/worker/` — Cloudflare Worker (234 protocol handlers)
- `src/worker/index.ts` — Main router (SSRF guard, Cloudflare detection, API dispatch)
- `src/worker/host-validator.ts` — SSRF prevention
- `src/worker/cloudflare-detector.ts` — Cloudflare IP detection
- `src/worker/websocket-pipe.ts` — WebSocket↔TCP pipe, backpressure, TCP ping
- `src/components/` — React UI (234 protocol clients)
- `src/App.tsx` — React root with lazy-loaded protocol components
- `docs/` — Architecture, protocol specs, changelogs
- `docs/ARCHITECTURE.md` — Detailed data plane design, scaling limits, security architecture

## Security — Already Implemented
The following security measures are **already in place**. Do NOT flag these as missing in reviews:

- **Rate Limiting:** Implemented at the infrastructure/Cloudflare level (nginx connection limits, fail2ban for failed auth). See `SECURITY.md` and `docker/` configs.
- **SSRF Prevention:** `host-validator.ts` blocks RFC 1918, loopback, link-local, CGN, metadata IPs, and dangerous hostnames. Enforced at router level before any handler runs. **Known limitation:** DNS rebinding (a hostname that resolves to a private IP after passing the text-based check) cannot be prevented because `cloudflare:sockets` `connect()` resolves hostnames internally. This is a platform constraint, not a missing feature — do NOT flag it as a bug.
- **Cloudflare IP Detection:** `cloudflare-detector.ts` blocks connections to Cloudflare-proxied IPs to prevent loop-back attacks.
- **Backpressure Control:** WebSocket-to-TCP pipe functions handle backpressure with two thresholds: 1 MiB outbound HWM (pauses TCP reads when `ws.bufferedAmount` exceeds it) and 4 MiB inbound HWM (hard-closes the connection if the TCP write queue exceeds it). See `websocket-pipe.ts`.
- **Resource Cleanup:** All stream readers/writers released in `finally` blocks.
- **Error Sanitization:** Internal portofcall errors (checklist, config, etc.) are sanitized to "Internal server error" before reaching the client. **SSH and protocol errors are intentionally passed through raw** — users own the servers they connect to and need real error messages for debugging. Do NOT sanitize `/api/ssh/`, `/api/connect`, or `/api/tcp` error responses.
- **Credential Security:** All HTTP handlers require `POST` with credentials in the JSON body — never in URL query params. WebSocket upgrade requests are inherently GET-only, so all WS handlers use the first-message pattern (credentials sent in the first WS message after upgrade, not in URL query params). Do NOT flag WS credential handling as a security gap.

## Docker Testing — IMPORTANT
All compose files have `mem_limit` set to prevent runaway memory usage (host has 36GB RAM).

**Key rules:**
- **Never run all compose files at once.** Only start the stacks you need for a specific test.
- **Always stop containers when done:** `docker compose -f <file> down`
- **Total memory budget: ~8GB.** Docker Desktop is configured for ~7.6GB. Don't exceed this.
- **MongoDB, MySQL, PostgreSQL, Kafka, Elasticsearch** are the heaviest services (512m–1g each). Avoid running more than 2–3 simultaneously.
- **Clean up regularly:** `docker system prune` to reclaim disk/volumes.
- **Use `docker stats`** to monitor real-time memory usage during tests.

## Style
- Do not include 'Co-Authored-By' trailers or any AI attribution in git commit messages.
