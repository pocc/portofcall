# Syslog — Power-User Reference

**Port:** 514 (TCP)
**Implementation:** `src/worker/syslog.ts`
**Route:** `POST /api/syslog/send`
**RFCs:** 5424 (modern), 3164 (BSD legacy), 6587 (TCP transport)

Single fire-and-forget endpoint. Formats a syslog message in either RFC 5424 or RFC 3164 format, sends it over a plain TCP socket, and closes. No response is read from the server.

---

## Endpoint

### `POST /api/syslog/send`

**Request body:**

| Field      | Type   | Default        | Notes |
|------------|--------|----------------|-------|
| `host`     | string | *(required)*   | Target syslog server hostname/IP |
| `port`     | number | `514`          | Must be 1–65535 |
| `severity` | number | *(required)*   | 0–7 (see table below) |
| `facility` | number | `16` (Local0)  | 0–23 (see table below) |
| `message`  | string | *(required)*   | Message body |
| `hostname` | string | `"portofcall"` | HOSTNAME field in the syslog header |
| `appName`  | string | `"webapp"`     | APP-NAME (RFC 5424) or TAG (RFC 3164) |
| `format`   | string | `"rfc5424"`    | `"rfc5424"` or `"rfc3164"` |
| `timeout`  | number | `10000`        | Connection timeout in ms |

**Success response (200):**

```json
{
  "success": true,
  "message": "Syslog message sent successfully",
  "formatted": "<134>1 2026-02-17T12:00:00.000Z portofcall webapp - - - Hello world"
}
```

The `formatted` field is the exact wire message sent (minus the trailing `\n`).

**Error responses:**

| HTTP | Condition |
|------|-----------|
| 400  | Missing `host`, missing `message`, severity outside 0–7, facility outside 0–23, port outside 1–65535 |
| 500  | TCP connection failure, timeout |

---

## Wire Format

### RFC 5424 (default)

```
<PRI>1 TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG\n
```

Concrete example with facility=16, severity=6 (priority = 16×8+6 = 134):

```
<134>1 2026-02-17T14:30:45.123Z portofcall webapp - - - Test message\n
```

Fixed values:
- **VERSION**: always `1`
- **PROCID**: always `-` (NILVALUE)
- **MSGID**: always `-` (NILVALUE)
- **STRUCTURED-DATA**: always `-` (NILVALUE)
- **TIMESTAMP**: `new Date().toISOString()` — always UTC, millisecond precision

### RFC 3164 (BSD legacy)

```
<PRI>TIMESTAMP HOSTNAME TAG: MSG\n
```

Concrete example:

```
<134>Feb 17 14:30:45 portofcall webapp: Test message\n
```

Timestamp format: `Mmm DD HH:MM:SS` — uses `getMonth()`/`getDate()`/`getHours()` etc., which in Cloudflare Workers return **UTC** values (Workers run in UTC). Day is space-padded to 2 chars per the RFC.

---

## Priority Calculation

```
priority = (facility × 8) + severity
```

### Severity Codes

| Value | Name          |
|-------|---------------|
| 0     | Emergency     |
| 1     | Alert         |
| 2     | Critical      |
| 3     | Error         |
| 4     | Warning       |
| 5     | Notice        |
| 6     | Informational |
| 7     | Debug         |

### Facility Codes

| Value | Name     | Value | Name   |
|-------|----------|-------|--------|
| 0     | Kernel   | 12    | NTP    |
| 1     | User     | 13    | Security |
| 2     | Mail     | 14    | Console |
| 3     | Daemon   | 15    | Clock  |
| 4     | Auth     | 16    | Local0 |
| 5     | Syslog   | 17    | Local1 |
| 6     | Lpr      | 18    | Local2 |
| 7     | News     | 19    | Local3 |
| 8     | UUCP     | 20    | Local4 |
| 9     | Cron     | 21    | Local5 |
| 10    | Authpriv | 22    | Local6 |
| 11    | FTP      | 23    | Local7 |

---

## Curl Examples

```bash
# RFC 5424 informational message (default format)
curl -X POST https://portofcall.ross.gg/api/syslog/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"syslog.example.com","severity":6,"message":"App started"}'

# RFC 3164 error with custom facility
curl -X POST https://portofcall.ross.gg/api/syslog/send \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"10.0.0.1",
    "port":1514,
    "severity":3,
    "facility":4,
    "message":"auth failure for user root",
    "hostname":"webserver01",
    "appName":"sshd",
    "format":"rfc3164"
  }'

# Emergency to kernel facility
curl -X POST https://portofcall.ross.gg/api/syslog/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"syslog.example.com","severity":0,"facility":0,"message":"kernel panic"}'
```

---

## Known Limitations and Gotchas

### No Structured Data (RFC 5424 SD-ELEMENTs)

Despite the POWER_USERS_HAPPY.md description mentioning "structured-data," the handler hardcodes STRUCTURED-DATA to `-` (NILVALUE). There is no way to send SD-ELEMENTs like `[exampleSDID@32473 iut="3" eventSource="Application"]`. The planning doc's fictional `SyslogClient` class supported them; the actual handler does not.

### No PROCID or MSGID

Both are hardcoded to `-`. You cannot set a process ID or message ID. If your log aggregator keys on these fields, every message from Port of Call will show `"-"`.

### No TCP Octet-Counting Framing

The handler uses **non-transparent framing** (newline-terminated). RFC 6587 §3.4 defines octet-counting (`MSG-LEN SP SYSLOG-MSG`) as the more reliable option. If your message body contains a bare `\n`, the receiving syslog server using non-transparent framing will split it into two malformed messages. There is no escaping or length-prefixing.

### No TLS (RFC 5425)

Plain TCP only. No support for TLS transport on port 6514. The `connect()` call from `cloudflare:sockets` is unencrypted. Traffic between the Cloudflare Worker and the syslog server is in cleartext.

### No Cloudflare Detection

Unlike most other protocol handlers, `checkIfCloudflare()` is **not** called before connecting. If the target resolves to a Cloudflare IP, the connection attempt proceeds anyway (and will likely fail or behave unexpectedly).

### No Message Size Limit

No cap on message length. RFC 5424 §6.1 says implementations SHOULD support messages up to 2048 bytes, and many servers truncate at 1024 (BSD syslog) or 8192 bytes. Oversized messages may be silently truncated by the receiving server.

### Fire-and-Forget

The handler never reads from the socket after sending. If the syslog server rejects the message or sends an error, you won't know. `success: true` means "the TCP write completed without throwing," not "the server accepted the message."

### No HTTP Method Check

The route in `index.ts` matches any method on `/api/syslog/send`. A GET request will reach `handleSyslogSend`, which calls `request.json()` — this will throw on a GET with no body, returning a 500 error (not a 405).

### Timestamp Behavior

- **RFC 5424**: Uses `new Date().toISOString()` — always UTC, ISO 8601, millisecond precision. Correct per RFC 5424 §6.2.3 which recommends UTC with `Z` suffix.
- **RFC 3164**: Uses `getHours()`/`getMinutes()`/`getSeconds()` — in Workers these return UTC values. RFC 3164 timestamps are traditionally local time, but since Workers run in UTC, the timestamp is technically UTC presented in BSD format without any timezone indicator (which is what RFC 3164 specifies — no TZ field).

### `severity` is Required but Has No Default

Unlike `facility` (defaults to 16) and most other fields, `severity` has no default. Omitting it will pass the undefined-to-number comparison `severity < 0 || severity > 7` — since `undefined < 0` is `false` and `undefined > 7` is `false`, the validation passes. The priority calculation becomes `(facility * 8) + undefined` = `NaN`, producing a malformed `<NaN>` in the wire message.

---

## Testing Locally

```bash
# Start a TCP syslog listener
nc -lk 1514

# In another terminal, send via the API
curl -X POST http://localhost:8787/api/syslog/send \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","port":1514,"severity":6,"message":"hello from portofcall"}'

# The nc terminal will show:
# <134>1 2026-02-17T... portofcall webapp - - - hello from portofcall
```

Or use rsyslog in Docker:

```bash
docker run -d -p 514:514/tcp --name rsyslog rsyslog/syslog_appliance_alpine
docker logs -f rsyslog
```
