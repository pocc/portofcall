# Playwright E2E Tests

End-to-end tests using Playwright against the live app at `https://l4.fyi`, targeting real Docker test services on the VPS.

## Setup

```bash
npm install -D @playwright/test dotenv
npx playwright install chromium
```

## Running

```bash
npm run e2e              # headless
npm run e2e:headed       # with browser visible
npm run e2e:ui           # interactive Playwright UI
npm run e2e:report       # view HTML report
```

## Configuration

- **`.env.e2e`** — VPS host, ports, credentials (not committed)
- **`playwright.config.ts`** — loads `.env.e2e`, 60s timeout, 1 worker, html reporter to `e2e-results/`

## File Structure

```
e2e/
  fixtures/test-config.ts       # Typed config from .env.e2e
  helpers/
    protocol-nav.ts             # navigateToProtocol() — search + click card
    form-helpers.ts             # fillField(), clickAction(), expectSuccess()
    ws-helpers.ts               # waitForWsConnected(), sendReplCommand(), waitForReplOutput()
  protocols/
    echo.spec.ts                # Pattern A — HTTP request/response
    discard.spec.ts
    daytime.spec.ts
    chargen.spec.ts
    time.spec.ts
    finger.spec.ts
    postgresql.spec.ts
    mysql.spec.ts
    mongodb.spec.ts
    mqtt.spec.ts
    redis.spec.ts               # Pattern B — WebSocket REPL
    memcached.spec.ts
    ssh.spec.ts                 # Pattern B — WebSocket session
    telnet.spec.ts
    irc.spec.ts
    ftp.spec.ts
  smoke.spec.ts                 # App load, search, navigation
```

## Two UI Patterns

### Pattern A — HTTP Request/Response
Echo, Discard, Daytime, Chargen, Time, Finger, PostgreSQL, MySQL, MongoDB, MQTT

Fill `<input id="{protocol}-{field}">` → click action button → assert `[role="region"]` contains expected text.

### Pattern B — WebSocket Session
Redis, Memcached, SSH, Telnet, IRC, FTP

Fill fields → click Connect → wait for green dot (`.bg-green-400.animate-pulse`) → interact → assert output.

## Key Findings During Implementation

### Selector Issues
- **Protocol names are case-sensitive**: `ECHO`, `CHARGEN`, `TIME` (uppercase) vs `Daytime`, `Discard`, `Finger` (title case). The `navigateToProtocol()` helper maps search terms to exact names.
- **Retro mode** uses different layout. Tests force modern theme + cards view via localStorage.
- **IRC inputs** lack `htmlFor` on labels — use placeholder-based selectors instead of `getByLabel()`.
- **Action buttons** have `aria-label` different from visible text — use `hasText` matching, not `getByRole({ name })`.
- **CHARGEN** uses custom result display, not the shared `ResultDisplay` component.

### Known Test Limitations
- **PostgreSQL**: SCRAM auth fails through the Cloudflare Worker proxy despite correct credentials (works directly on VPS). Likely a worker-level issue.
- **IRC channel join**: Auto-join channels and manual `/join` don't produce a channel tab. The IRC server receives the connection but the JOIN response may not propagate through the WebSocket. Test gracefully skips if channel doesn't appear.
- **FTP serial tests**: Each FTP test reconnects independently (Playwright isolates pages). The mkdir→upload→download→rename→delete→rmdir chain doesn't share state across tests.

### Tips
- Use `test.setTimeout(90_000)` for slow protocols (Time, Chargen, SSH)
- Use unique keys per run (`e2e_${Date.now()}`) for Redis/Memcached to avoid collisions
- The `waitForWsConnected()` helper checks for `.bg-green-400.animate-pulse`
- Force theme/view in `navigateToProtocol()` to avoid localStorage-persisted UI state interfering with selectors
