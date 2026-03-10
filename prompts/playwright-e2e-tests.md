# Task: Playwright E2E Tests for L4.FYI

## Objective
Create a Playwright E2E test suite that tests the UI at the app's base URL for every protocol that has a running Docker test service on the VPS. Each protocol's UI has subcommands (actions like Connect, Query, Send, etc.) — test every one.

## Environment Setup

All secrets, hosts, and ports are stored in `.env.e2e` at the repo root. Read that file first to understand all available config values.

VPS connectivity check:
```bash
ssh -o StrictHostKeyChecking=no -i $VPS_SSH_KEY $VPS_SSH_USER@$VPS_HOST 'docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"'
```

## Install Steps

1. Install Playwright in the repo:
   ```bash
   npm install -D @playwright/test
   npx playwright install chromium
   ```

2. Create `playwright.config.ts`:
   - Load `.env.e2e` using `dotenv` or Playwright's built-in env support
   - `baseURL`: from `E2E_BASE_URL`
   - `timeout`: 60000 (protocols can be slow)
   - `expect.timeout`: 15000
   - `workers`: 1 (sequential to avoid overwhelming VPS)
   - `reporter`: html to `e2e-results/`
   - `trace`: on-first-retry
   - `screenshot`: only-on-failure

3. Add to `package.json` scripts:
   ```json
   "e2e": "playwright test",
   "e2e:headed": "playwright test --headed",
   "e2e:ui": "playwright test --ui",
   "e2e:report": "playwright show-report e2e-results"
   ```

## File Structure
```
e2e/
  fixtures/test-config.ts       # Reads .env.e2e, exports typed config object
  helpers/
    protocol-nav.ts             # Navigate to protocol via ProtocolSelector
    form-helpers.ts             # fillField(), clickAction(), expectSuccess(), expectError()
    ws-helpers.ts               # waitForWsConnected(), sendReplCommand(), waitForReplOutput()
  protocols/
    echo.spec.ts
    discard.spec.ts
    daytime.spec.ts
    chargen.spec.ts
    time.spec.ts
    finger.spec.ts
    postgresql.spec.ts
    mysql.spec.ts
    mongodb.spec.ts
    mqtt.spec.ts
    redis.spec.ts
    memcached.spec.ts
    ssh.spec.ts
    ftp.spec.ts
    irc.spec.ts
    telnet.spec.ts
  smoke.spec.ts
```

## Test Config (`e2e/fixtures/test-config.ts`)

This file must read all values from environment variables (loaded from `.env.e2e`). Example structure:

```typescript
import 'dotenv/config'; // or use Playwright's env loading

const HOST = process.env.VPS_HOST!;

export const services = {
  redis:      { host: HOST, port: process.env.REDIS_PORT! },
  postgresql: { host: HOST, port: process.env.POSTGRES_PORT!, username: process.env.TEST_USERNAME!, password: process.env.POSTGRES_PASSWORD!, database: process.env.POSTGRES_DATABASE! },
  mysql:      { host: HOST, port: process.env.MYSQL_PORT!, username: process.env.TEST_USERNAME!, password: process.env.TEST_PASSWORD!, database: process.env.MYSQL_DATABASE! },
  mongodb:    { host: HOST, port: process.env.MONGODB_PORT! },
  memcached:  { host: HOST, port: process.env.MEMCACHED_PORT! },
  mqtt:       { host: HOST, port: process.env.MQTT_PORT! },
  ssh:        { host: HOST, port: process.env.SSH_PORT!, username: process.env.TEST_USERNAME!, password: process.env.TEST_PASSWORD! },
  ftp:        { host: HOST, port: process.env.FTP_PORT!, username: process.env.TEST_USERNAME!, password: process.env.TEST_PASSWORD! },
  irc:        { host: HOST, port: process.env.IRC_PORT! },
  telnet:     { host: HOST, port: process.env.TELNET_PORT!, username: process.env.TEST_USERNAME!, password: process.env.TEST_PASSWORD! },
  echo:       { host: HOST, port: process.env.ECHO_PORT! },
  discard:    { host: HOST, port: process.env.DISCARD_PORT! },
  daytime:    { host: HOST, port: process.env.DAYTIME_PORT! },
  chargen:    { host: HOST, port: process.env.CHARGEN_PORT! },
  time:       { host: HOST, port: process.env.TIME_PORT! },
  finger:     { host: HOST, port: process.env.FINGER_PORT! },
} as const;
```

**No hardcoded IPs, passwords, or paths anywhere in test files.** Everything comes from `services.*`.

## Two UI Patterns

### Pattern A — HTTP Request/Response
**Protocols**: Echo, Discard, Daytime, Chargen, Time, Finger, PostgreSQL, MySQL, MongoDB, MQTT

These use the `ProtocolClientLayout` shared components:
- **Form fields**: `<input id="{protocol}-{field}">` (e.g., `echo-host`, `postgres-username`)
- **Action button**: `<button>` with text like "Test Echo", "Test Connection", "Get Time"
- **Result display**: `[role="region"][aria-live="polite"]` — green `.text-green-400` for success, red `.text-red-400` for error

Test pattern: fill fields → click button → assert result region contains expected text.

### Pattern B — WebSocket Session
**Protocols**: Redis, Memcached, SSH, Telnet, IRC, FTP

These use WebSocket connections with stateful sessions:
- **Connection form**: same `<input id="{protocol}-{field}">` pattern
- **Connected indicator**: green dot `.bg-green-400.animate-pulse`
- **Redis/Memcached**: REPL with DOM-rendered output (text IS readable via selectors)
- **SSH**: xterm.js canvas terminal (text is NOT readable — assert connection status text instead)
- **Telnet**: DOM-rendered terminal lines (text IS readable)
- **IRC**: DOM-rendered message list with channel tabs (text IS readable)
- **FTP**: File browser + log panel, modals for operations (text IS readable)

Test pattern: fill fields → click Connect → wait for green status dot → interact → assert output.

## Protocol Navigation Helper

The app is a single-page app. All protocols are accessed via the `ProtocolSelector` component on the homepage:
1. Go to the base URL
2. Find the search input: `page.getByLabel('Search protocols')` or similar
3. Type the protocol name to filter
4. Click the protocol card/button (has aria-label like `"Connect to Redis on port 6379"`)
5. Wait for lazy-loaded component to render (Suspense boundary)

Build a `navigateToProtocol(page, protocolName)` helper for this.

## Subcommands to Test Per Protocol

### Simple Protocols (Pattern A)

**Echo** (`echo.spec.ts`):
- Fields: `echo-host`, `echo-port` (from `services.echo`), `echo-message` (default "Hello, ECHO!")
- Action: "Test Echo"
- Assert: text contains "MATCHED"

**Discard** (`discard.spec.ts`):
- Fields: `discard-host`, `discard-port` (from `services.discard`), textarea for data
- Action: "Send Data"
- Assert: text contains "sent successfully", shows bytes/duration stats

**Daytime** (`daytime.spec.ts`):
- Fields: `daytime-host`, `daytime-port` (from `services.daytime`)
- Action: "Get Time"
- Assert: text contains "Remote Time"

**Chargen** (`chargen.spec.ts`):
- Fields: `chargen-host`, `chargen-port` (from `services.chargen`), `chargen-maxbytes` (default 10240)
- Action: "Receive Stream"
- Assert: shows bytes received, line count, bandwidth stats

**Time** (`time.spec.ts`):
- Fields: `time-host`, `time-port` (from `services.time`)
- Action: "Get Binary Time" or "Get Time"
- Assert: text contains "Raw Time Value"

**Finger** (`finger.spec.ts`):
- Fields: `finger-host`, `finger-port` (from `services.finger`), `finger-username` (optional)
- Action: "Finger Query" or "Query"
- Assert: response text appears in result region

### Database Protocols (Pattern A)

**PostgreSQL** (`postgresql.spec.ts`):
- Fields: `postgres-host`, `postgres-port`, `postgres-username`, `postgres-password`, `postgres-database` (all from `services.postgresql`)
- Action: "Test Connection"
- Assert: "Connected to PostgreSQL"

**MySQL** (`mysql.spec.ts`):
- Fields: `mysql-host`, `mysql-port`, `mysql-username`, `mysql-password`, `mysql-database` (all from `services.mysql`)
- Action: "Test Connection"
- Assert: "Connected to MySQL", shows server version

**MongoDB** (`mongodb.spec.ts`):
- Fields: `mongodb-host`, `mongodb-port` (from `services.mongodb`)
- Actions: "Test Connection", "Ping"
- Assert connection: "Connected to MongoDB", shows version
- Assert ping: response with RTT

**MQTT** (`mqtt.spec.ts`):
- Fields: `mqtt-host`, `mqtt-port` (from `services.mqtt`), `mqtt-clientId` (optional), `mqtt-username`, `mqtt-password`
- Action: "Test Connection"
- Assert: "Connected to MQTT"

### WebSocket REPL Protocols (Pattern B)

**Redis** (`redis.spec.ts`) — 5 tests:
- Fields: `redis-host`, `redis-port` (from `services.redis`), `redis-password` (optional), `redis-database` (0)
- **Connect**: Click "Connect" → wait for green dot + "Connected to" in output
- **PING**: type `PING` in REPL input, press Enter → assert "PONG" in output
- **SET/GET**: `SET e2e_key "testval"` → assert "OK"; `GET e2e_key` → assert "testval"; `DEL e2e_key` cleanup
- **INFO**: `INFO server` → assert "redis_version" in output
- **KEYS**: `KEYS *` → assert response appears

REPL input: look for input near a "Send" button, or `input[placeholder*="PING"]`
REPL output: scrollable div with `.font-mono` containing colored entries

**Memcached** (`memcached.spec.ts`) — 4 tests:
- Fields: `memcached-host`, `memcached-port` (from `services.memcached`)
- **Connect**: Click "Connect" → wait for green dot
- **version**: type `version` → assert "VERSION" in output
- **stats**: type `stats` → assert "STAT" in output
- **set/get**: `set e2ekey 0 60 testval` → assert "STORED"; `get e2ekey` → assert "testval"

### Complex WebSocket Protocols (Pattern B)

**SSH** (`ssh.spec.ts`) — 2 tests:
- Fields: `ssh-host`, `ssh-port` (from `services.ssh` — NOTE: port is 2222 not the default 22), `ssh-username`, auth method select (Password), `ssh-password`
- **Connect**: Fill form → click "Connect" → assert username appears in status area (xterm.js canvas is not DOM-readable, so check status text)
- **Disconnect**: Click "Disconnect" → assert disconnected state

**Telnet** (`telnet.spec.ts`) — 2 tests:
- Fields: `telnet-host`, `telnet-port` (from `services.telnet`)
- **Connect**: Click "Connect" → assert "Connected" or "WebSocket connected" in terminal div
- **Send command**: Type in input → click "Send" or press Enter → assert output appears
- Terminal output IS DOM-readable (not canvas). Look for quick command buttons: help, ls, pwd, exit

**IRC** (`irc.spec.ts`) — 3 tests:
- Fields accessed by label (no IDs): "Server", "Port", "Nickname", "Auto-join Channels"
- **Connect**: Fill server + port from `services.irc`, nickname=`e2e_tester`, channels=`#test` → click "Connect" → assert connected state
- **Join channel**: Verify `#test` appears in channel list sidebar
- **Send message**: Type in message input → press Enter → assert message appears in chat area

**FTP** (`ftp.spec.ts`) — 8 tests:
- Fields: `ftp-host`, `ftp-port`, `ftp-username`, `ftp-password` (all from `services.ftp`)
- **Connect**: Click "Connect" → assert "Connected to" in log panel
- **List directory**: Assert file browser shows items after connect
- **Mkdir**: Open "Commands" dropdown → "Create Directory" → fill modal input with `e2e_testdir` → submit → assert success in logs
- **Upload**: Commands → "Upload File" → attach file in modal → submit → assert success
- **Download**: Commands → "Download Files" → select file checkbox → submit → assert success
- **Rename**: Commands → "Rename" → select file → enter new name → submit → assert success
- **Delete**: Commands → "Delete Files" → select file checkbox → confirm → assert success
- **Rmdir**: Commands → "Remove Directory" → select dir checkbox → confirm → assert success

FTP modals use `[role="dialog"][aria-modal="true"]`. Log panel auto-scrolls with timestamped entries.

## Helper Functions to Build

### `e2e/helpers/protocol-nav.ts`
```typescript
navigateToProtocol(page: Page, protocolName: string): Promise<void>
// 1. Go to base URL if not there
// 2. Click back button if on a protocol page
// 3. Search for protocol name
// 4. Click the matching protocol card
// 5. Wait for component to load
```

### `e2e/helpers/form-helpers.ts`
```typescript
fillField(page: Page, id: string, value: string): Promise<void>
// page.locator(`#${id}`).clear() then .fill(value)

clickAction(page: Page, buttonText: string): Promise<void>
// page.getByRole('button', { name: buttonText }).click()

expectSuccess(page: Page, text: string | RegExp, timeout?: number): Promise<void>
// Wait for [role="region"][aria-live="polite"] to contain text with green indicator

expectError(page: Page, text: string | RegExp): Promise<void>
// Same but red indicator
```

### `e2e/helpers/ws-helpers.ts`
```typescript
waitForWsConnected(page: Page, timeout?: number): Promise<void>
// Wait for .bg-green-400.animate-pulse to be visible

sendReplCommand(page: Page, command: string): Promise<void>
// Find REPL input, fill it, press Enter

waitForReplOutput(page: Page, text: string | RegExp, timeout?: number): Promise<void>
// Wait for REPL output area to contain text
```

## Verification
1. Run `npx playwright test` — all tests should pass
2. Run `npx playwright test --headed` to visually confirm UI interactions
3. Run `npx playwright show-report e2e-results` to review the HTML report
4. On failure, check screenshots in `e2e-results/` for visual debugging

## Notes
- Use unique keys per test run (e.g., `e2e_${Date.now()}`) for Redis/Memcached to avoid collisions
- Clean up created resources in `test.afterEach` or `test.afterAll` (Redis keys, FTP files/dirs)
- SSH port from env is 2222, not the default 22 — explicitly set it in the port field
- MongoDB may reject auth-less connections — if Test Connection fails, try adding credentials or check if the UI has auth fields
- MQTT Mosquitto may require credentials from its config file — if connection fails without auth, SSH into VPS and check the mosquitto config
- The FTP test sequence should be ordered: connect → mkdir → upload → list → download → rename → delete → rmdir (each step depends on the prior)
