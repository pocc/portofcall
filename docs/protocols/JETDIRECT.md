# JetDirect / AppSocket (9100) — Power-User Reference

> HP JetDirect raw printing protocol. Two endpoints: `/api/jetdirect/connect` (PJL probe for printer model + status) and `/api/jetdirect/print` (send print jobs in text/PCL/PostScript/raw format). Implementation: `src/worker/jetdirect.ts` (377 lines).

## Endpoints

| # | Method | Path | Purpose | Default port | Default timeout | CF detection | Port validation |
|---|--------|------|---------|-------------|----------------|-------------|-----------------|
| 1 | Any | `/api/jetdirect/connect` | PJL probe — query printer model + status | 9100 | 10 000 ms | Yes | Yes (1–65535) |
| 2 | POST only | `/api/jetdirect/print` | Send print job (text/PCL/PS/raw) | 9100 | 30 000 ms | Yes | Yes (1–65535) |

**Method restriction asymmetry:** `/connect` accepts any HTTP method (no restriction in `index.ts`). `/print` enforces POST-only (returns 405 for other methods). Both parse `request.json()`, so a GET with no body will fail at JSON parsing on either endpoint.

---

## Endpoint 1: `POST /api/jetdirect/connect`

Connects to the printer, sends PJL `INFO ID` and `INFO STATUS` queries, reads whatever comes back, parses PJL response fields.

### Request

```json
{ "host": "printer.local", "port": 9100, "timeout": 10000 }
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | Yes | — | HTTP 400 if missing |
| `port` | No | 9100 | Validated 1–65535 (HTTP 400 if out of range) |
| `timeout` | No | 10000 | Outer `Promise.race` deadline (ms) |

### PJL query sent

```
\x1B%-12345X@PJL\r\n@PJL INFO ID\r\n@PJL INFO STATUS\r\n\x1B%-12345X
```

Breakdown:
1. `\x1B%-12345X` — UEL (Universal Exit Language), resets the printer's language state
2. `@PJL\r\n` — enters PJL mode
3. `@PJL INFO ID\r\n` — requests printer model identification
4. `@PJL INFO STATUS\r\n` — requests current printer status
5. `\x1B%-12345X` — UEL again (exit PJL)

### Response (success — HTTP 200)

```json
{
  "success": true,
  "host": "printer.local",
  "port": 9100,
  "rtt": 47,
  "connectTime": 12,
  "portOpen": true,
  "pjlSupported": true,
  "rawResponse": "@PJL INFO ID\r\n\"HP LaserJet Pro M404dn\"\r\n@PJL INFO STATUS\r\nCODE=10001\r\nDISPLAY=\"Ready\"\r\n",
  "printerInfo": {
    "model": "HP LaserJet Pro M404dn",
    "status": "Ready",
    "statusCode": "10001"
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `rtt` | number | Total wall-clock time from `connect()` to socket close (includes PJL query + response) |
| `connectTime` | number | TCP handshake time only (from `connect()` to `socket.opened`) |
| `portOpen` | boolean | Always `true` in success response — if TCP connect failed, you get HTTP 500 |
| `pjlSupported` | boolean | `responseText.length > 0` — may be `true` for non-PJL responses (any data = "supported") |
| `rawResponse` | string | First 2000 characters of raw response. `undefined` if empty response |
| `printerInfo.model` | string? | Parsed from `@PJL INFO ID` response. `undefined` if not found |
| `printerInfo.status` | string? | Parsed from `DISPLAY=` line. `undefined` if not found |
| `printerInfo.statusCode` | string? | Parsed from `CODE=` line. `undefined` if not found |

### PJL response parsing

`parsePJLResponse()` scans lines looking for:

1. **`@PJL INFO ID`** — takes the *next* line, strips leading/trailing `"` quotes. This is the printer model string.
2. **`@PJL INFO STATUS`** — scans up to 4 lines after this header for:
   - `CODE=xxxxx` → `statusCode`
   - `DISPLAY="message"` → `status` (quotes stripped)

### Read behavior

- **Read timeout:** `Math.min(timeout, 3000)` — capped at 3 seconds regardless of the outer timeout. Many printers don't respond to PJL at all, so this prevents long waits.
- **Read cap:** 16 KB (`maxSize = 16 * 1024`). Stops reading after 16 KB even if more data is available.
- **Errors swallowed:** Any read error (including timeout) is caught and silently ignored — the handler proceeds with whatever data was collected.

### HTTP status mapping

| Condition | Status |
|-----------|--------|
| PJL query sent, response read (even if empty) | 200 |
| Missing `host` | 400 |
| Port out of range | 400 |
| Cloudflare detected | 403 |
| Connection timeout, socket error, DNS failure | 500 |

---

## Endpoint 2: `POST /api/jetdirect/print`

Sends a print job to the printer. Supports 4 formats with automatic PJL/PCL wrapping for text, PCL, and PostScript. Raw format sends data as-is.

### Request

```json
{
  "host": "printer.local",
  "port": 9100,
  "data": "Hello, World!",
  "format": "text",
  "timeout": 30000
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `host` | Yes | — | HTTP 400 if missing |
| `port` | No | 9100 | Validated 1–65535 |
| `data` | Yes | — | HTTP 400 if missing. The actual print content. |
| `format` | No | `"text"` | One of: `text`, `pcl`, `postscript`, `raw` |
| `timeout` | No | 30000 | Note: **3x** the `/connect` default |

### Print payload wrapping

The `data` field is wrapped differently depending on `format`:

**`text` (default):**
```
\x1B%-12345X          UEL (reset)
@PJL\r\n              PJL mode
@PJL JOB NAME="portofcall"\r\n
@PJL ENTER LANGUAGE=PCL\r\n
\x1BE                  PCL printer reset
{data}                 Your text content
\x0C                   Form feed (eject page)
\x1BE                  PCL printer reset
\x1B%-12345X          UEL
@PJL EOJ\r\n          End of Job
\x1B%-12345X          UEL
```

**`pcl`:**
```
\x1B%-12345X          UEL
@PJL\r\n
@PJL JOB NAME="portofcall"\r\n
@PJL ENTER LANGUAGE=PCL\r\n
{data}                 Your PCL data
\x1B%-12345X          UEL
@PJL EOJ\r\n
\x1B%-12345X          UEL
```

**`postscript`:**
```
\x1B%-12345X          UEL
@PJL\r\n
@PJL JOB NAME="portofcall"\r\n
@PJL ENTER LANGUAGE=POSTSCRIPT\r\n
{data}                 Your PostScript
\r\n                   Extra newline before UEL
\x1B%-12345X          UEL
@PJL EOJ\r\n
\x1B%-12345X          UEL
```

**`raw`:**
```
{data}                 Sent exactly as provided
```

### Response (success — HTTP 200)

```json
{
  "success": true,
  "host": "printer.local",
  "port": 9100,
  "rtt": 523,
  "connectTime": 15,
  "bytesSent": 147,
  "format": "text",
  "printerResponse": "@PJL\r\n",
  "message": "Print job sent (text format, 13 bytes of data)"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `bytesSent` | number | Byte length of the **wrapped** payload (includes UEL/PJL overhead), not the raw `data` |
| `printerResponse` | string? | Any data the printer sent back (up to 4 KB, 2 s read). `undefined` if nothing received |
| `message` | string | Human-readable summary. Reports byte length of the **raw `data`** (before wrapping) |

### Read behavior after sending

- **Read timeout:** 2 seconds (hardcoded, not derived from `timeout`)
- **Read cap:** 4096 bytes
- **Errors swallowed:** Same as `/connect` — read failures are silently ignored

---

## Quirks and Limitations

### 1. `pjlSupported` is unreliable

The `/connect` endpoint sets `pjlSupported: true` whenever any response data is received (`responseText.length > 0`). A non-printer service on port 9100 that sends any TCP data will be reported as "PJL supported."

### 2. Read timeout cap in `/connect`

The read timeout is `Math.min(timeout, 3000)`, so even with `timeout: 60000` the handler only waits 3 seconds for PJL response data. The outer `timeout` controls the TCP connect phase; the 3-second cap controls the PJL read phase.

### 3. `rawResponse` truncation

Only the first 2000 characters of the raw response are returned. For printers that dump verbose configuration data, this may truncate the STATUS response after the ID response. The `parsePJLResponse` function operates on the full response before truncation, so `printerInfo` fields are correct even when `rawResponse` is truncated.

### 4. PJL INFO CONFIG not queried

The implementation sends `INFO ID` and `INFO STATUS` but not `INFO CONFIG`. There's no way to retrieve printer configuration (installed trays, memory, duplex capability, installed languages) via the API.

### 5. ZPL format not supported

The doc planning document mentions ZPL (Zebra label format), but the actual implementation only supports `text`, `pcl`, `postscript`, and `raw`. ZPL data can be sent via `format: "raw"` (it doesn't need PJL wrapping).

### 6. No print data size limit

The `data` field has no size validation. Arbitrarily large payloads are accepted and sent to the printer. The only limit is Cloudflare Workers' request body size limit.

### 7. `bytesSent` vs `message` byte counts differ

`bytesSent` counts the full wrapped payload (PJL headers + data + PJL footer). `message` reports the byte length of just the raw `data` field. This can be confusing:
```json
{
  "bytesSent": 147,
  "message": "Print job sent (text format, 13 bytes of data)"
}
```

### 8. `connectTime` vs `rtt`

Both endpoints report both values:
- `connectTime` = TCP handshake only (`socket.opened` minus start)
- `rtt` = total wall-clock from start to socket close

These are not labeled consistently with other protocol handlers in the project which often use `rtt` for a single round-trip.

### 9. No bidirectional/status channel

JetDirect supports bidirectional communication on ports 9101/9102 for some printers. This implementation only uses port 9100 (configurable, but the PJL query is always the same unidirectional probe).

### 10. PJL INFO ID parser assumes response is on next line

The `parsePJLResponse` function looks for `@PJL INFO ID` and takes the *next* line as the model name. If the printer includes the model on the same line (non-standard but seen on some devices), it will be missed. Also, if there are blank lines between the header and the value, parsing fails.

### 11. Job name hardcoded to "portofcall"

All wrapped print jobs use `@PJL JOB NAME="portofcall"`. This is visible in the printer's job queue and cannot be customized via the API.

### 12. Text format always adds form feed

The `text` format wrapper always appends `\x0C` (form feed) after the data. If your data already ends with a form feed, the printer will eject an extra blank page.

---

## Cross-Endpoint Comparison

| | `/connect` | `/print` |
|---|---|---|
| Default timeout | 10 000 ms | 30 000 ms |
| Read timeout | min(timeout, 3000) ms | 2000 ms (hardcoded) |
| Read cap | 16 KB | 4 KB |
| Method restriction | None | POST only (405) |
| Port validation | Yes (1–65535) | Yes (1–65535) |
| CF detection | Yes | Yes |
| `host` required | Yes (400) | Yes (400) |
| `data` required | No | Yes (400) |
| `rawResponse` truncation | 2000 chars | 4096 bytes |

---

## curl Examples

**Probe a network printer:**
```bash
curl -s http://localhost:8787/api/jetdirect/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100"}' | jq .
```

**Print plain text:**
```bash
curl -s -X POST http://localhost:8787/api/jetdirect/print \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","data":"Hello from Port of Call!\f"}' | jq .
```

**Print raw PCL:**
```bash
curl -s -X POST http://localhost:8787/api/jetdirect/print \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","data":"\u001BE\u001B&l0OTest Page\f","format":"pcl"}' | jq .
```

**Print PostScript:**
```bash
curl -s -X POST http://localhost:8787/api/jetdirect/print \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.100","data":"%!PS\n/Helvetica findfont 24 scalefont setfont\n100 700 moveto\n(Hello PostScript) show\nshowpage","format":"postscript"}' | jq .
```

**Send raw ZPL to a Zebra label printer:**
```bash
curl -s -X POST http://localhost:8787/api/jetdirect/print \
  -H 'Content-Type: application/json' \
  -d '{"host":"192.168.1.50","data":"^XA^FO50,50^ADN,36,20^FDShipping Label^FS^XZ","format":"raw"}' | jq .
```

**Non-default port with longer timeout:**
```bash
curl -s http://localhost:8787/api/jetdirect/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"printer.local","port":9101,"timeout":20000}' | jq .
```

---

## Local Testing

```bash
# Netcat as a fake printer (listens on 9100, dumps received data):
nc -l 9100 | tee print_output.txt

# In another terminal, test the connect probe:
curl -s http://localhost:8787/api/jetdirect/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1"}' | jq .
# → pjlSupported: false (netcat won't respond to PJL)
# → portOpen: true, connectTime, rtt

# For PJL-aware testing, use a real printer or CUPS with raw queue:
lpadmin -p test-raw -v socket://127.0.0.1:9100 -E
```

---

## PJL Status Codes Reference

Common HP PJL status codes returned in `statusCode`:

| Code | Meaning |
|------|---------|
| 10001 | Ready |
| 10002 | Ready (warming up) |
| 10003 | Ready (self test) |
| 10004 | Ready (reset) |
| 10005 | Sleep mode |
| 10006 | Powersave |
| 10023 | Ready (printing) |
| 30011 | Paper out |
| 30016 | Output bin full |
| 40021 | Door open |
| 40022 | Paper jam |
| 40038 | Toner low |
| 40600 | Replace toner |
