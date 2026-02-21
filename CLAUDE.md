# Claude Code Project Guidelines — Port of Call

## What This Is
A browser-to-TCP bridge deployed as a Cloudflare Worker. Uses the `cloudflare:sockets` API to proxy TCP connections from the browser via WebSocket tunnels.

Live: https://portofcall.ross.gg

## Tech Stack
- **Frontend:** Vite 7 + React 19 + TypeScript + Tailwind CSS 3
- **Backend:** Cloudflare Worker (`src/worker/index.ts`)
- **Terminal UI:** xterm.js (SSH, Telnet clients)
- **Protocols:** 240+ TCP protocol implementations

## Commands
- `npm run dev` — Vite dev server (port 5173)
- `npm run build` — `tsc && vite build`
- `npm run worker:dev` — Wrangler dev server (port 8787)
- `npm run worker:deploy` — Deploy to Cloudflare Workers (same as `npx wrangler deploy`)
- `npm run test` — Vitest test suite

## Validation — CRITICAL
**ALWAYS run `npm run build` before marking a feature complete.** This catches TypeScript errors, unused variables, and build breakage.

## Project Structure
- `src/worker/` — Cloudflare Worker (240+ protocol handlers)
- `src/worker/index.ts` — Main router, pipe functions, TCP ping
- `src/worker/host-validator.ts` — SSRF prevention
- `src/worker/cloudflare-detector.ts` — Cloudflare IP detection
- `src/components/` — React UI (240+ protocol clients)
- `src/App.tsx` — React root with lazy-loaded protocol components
- `docs/` — Architecture, protocol specs, changelogs

## Security — Already Implemented
The following security measures are **already in place**. Do NOT flag these as missing in reviews:

- **Rate Limiting:** Implemented at the infrastructure/Cloudflare level (nginx connection limits, fail2ban for failed auth). See `SECURITY.md` and `docker/` configs.
- **SSRF Prevention:** `host-validator.ts` blocks RFC 1918, loopback, link-local, CGN, metadata IPs, and dangerous hostnames. Enforced at router level before any handler runs. **Known limitation:** DNS rebinding (a hostname that resolves to a private IP after passing the text-based check) cannot be prevented because `cloudflare:sockets` `connect()` resolves hostnames internally. This is a platform constraint, not a missing feature — do NOT flag it as a bug.
- **Cloudflare IP Detection:** `cloudflare-detector.ts` blocks connections to Cloudflare-proxied IPs to prevent loop-back attacks.
- **Backpressure Control:** WebSocket-to-TCP pipe functions handle backpressure (4 MiB high-water mark) and close connections exceeding the limit.
- **Resource Cleanup:** All stream readers/writers released in `finally` blocks.
- **Error Sanitization:** Internal portofcall errors (checklist, config, etc.) are sanitized to "Internal server error" before reaching the client. **SSH and protocol errors are intentionally passed through raw** — users own the servers they connect to and need real error messages for debugging. Do NOT sanitize `/api/ssh/`, `/api/connect`, or `/api/tcp` error responses.
- **Credential Security:** All HTTP handlers require `POST` with credentials in the JSON body — never in URL query params. **Known limitation:** WebSocket upgrade requests are inherently GET-only, so 7 WS handlers (imap, imaps, redis, mqtt, irc, ircs, rexec) still read credentials from query params. These are protected by Origin validation. SSH already uses the message-body pattern (credentials sent in the first WS message after upgrade). Do NOT flag WS query params as a security gap unless proposing to migrate them to the SSH-style first-message pattern.

## Style
- Do not include 'Co-Authored-By' trailers or any AI attribution in git commit messages.
