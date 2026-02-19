# LPD (Line Printer Daemon) Protocol -- Power-User Reference

**Port:** 515 (default)
**Transport:** TCP
**RFC:** [RFC 1179](https://tools.ietf.org/html/rfc1179) (1990)
**Implementation:** `src/worker/lpd.ts` (662 lines)
**Routes:** `src/worker/index.ts` lines 1883--1896

## Endpoints

| # | Method | Path | Purpose | Default port | Default timeout | CF detection | Port validation |
|---|--------|------|---------|-------------|----------------|-------------|-----------------|
| 1 | POST | `/api/lpd/probe` | Short queue state (command 0x03) | 515 | 10 000 ms | Yes | Yes (1--65535) |
| 2 | POST | `/api/lpd/queue` | Long queue state (command 0x04) | 515 | 10 000 ms | Yes | Yes (1--65535) |
| 3 | POST | `/api/lpd/print` | Submit print job (command 0x02) | 515 | 15 000 ms | Yes | Yes (1--65535) |
| 4 | POST | `/api/lpd/remove` | Remove jobs (command 0x05) | 515 | 10 000 ms | Yes | Yes (1--65535) |

All four endpoints enforce POST-only (return 405 for other methods).

---

## RFC 1179 Command Summary

LPD commands are a single opcode byte followed by an operand string and a LF (`\x0A`) terminator. There is no CRLF -- LPD uses bare LF throughout.

| Opcode | Name | Wire format | Implemented |
|--------|------|------------|-------------|
| `\x01` | Print any waiting jobs | `\x01<queue>\n` | No |
| `\x02` | Receive a printer job | `\x02<queue>\n` | Yes (print endpoint) |
| `\x03` | Send queue state (short) | `\x03<queue> [list]\n` | Yes (probe endpoint) |
| `\x04` | Send queue state (long) | `\x04<queue> [list]\n` | Yes (queue endpoint) |
| `\x05` | Remove jobs | `\x05<queue> <agent> [list]\n` | Yes (remove endpoint) |

### Receive Job Subcommands (within a 0x02 session)

| Opcode | Name | Wire format |
|--------|------|------------|
| `\x01` | Abort job | `\x01\n` |
| `\x02` | Receive control file | `\x02<count> <name>\n` |
| `\x03` | Receive data file | `\x03<count> <name>\n` |

After each subcommand, the server responds with a single acknowledgement byte: `\x00` for success, any non-zero value for failure.

---

## Endpoint 1: `POST /api/lpd/probe`

Connects to an LPD server and sends the short queue state command (0x03). This is the lightest-weight LPD interaction -- useful for checking if a printer daemon is alive.

### Request

```json
{
  "host": "printer.local",
  "port": 515,
  "printer": "lp",
  "timeout": 10000
}
```

| Field | Type | Default | Required | Validation |
|-------|------|---------|----------|------------|
| `host` | string | -- | Yes | Non-empty (HTTP 400) |
| `port` | number | `515` | No | 1--65535 (HTTP 400) |
| `printer` | string | `"lp"` | No | No regex validation |
| `timeout` | number | `10000` | No | Read timeout capped at `min(timeout, 5000)` |

### Wire command sent

```
\x03lp\n
```

Command 0x03 = "Send queue state (short)", followed by the printer/queue name, terminated by LF.

### Response (success -- HTTP 200)

```json
{
  "success": true,
  "host": "printer.local",
  "port": 515,
  "printer": "lp",
  "connectTimeMs": 12,
  "totalTimeMs": 45,
  "queueState": "lp is ready\nno entries",
  "responseBytes": 25,
  "protocol": "LPD",
  "rfc": "RFC 1179"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `connectTimeMs` | number | TCP handshake time only |
| `totalTimeMs` | number | Wall clock from connect to socket close |
| `queueState` | string | Server response text, trimmed. Falls back to `"(empty response - server accepted connection)"` if server sends nothing |
| `responseBytes` | number | Raw byte count before trim |

### Read behavior

- Read cap: 4096 bytes (breaks read loop if exceeded)
- Read timeout: `min(timeout, 5000)` ms
- Errors during read are silently swallowed (server closing connection is normal for LPD)

---

## Endpoint 2: `POST /api/lpd/queue`

Connects and sends the long queue state command (0x04). Returns more detailed per-job information than the probe endpoint. Optionally filters by username(s).

### Request

```json
{
  "host": "printer.local",
  "port": 515,
  "printer": "lp",
  "users": ["alice", "bob"],
  "timeout": 10000
}
```

| Field | Type | Default | Required | Validation |
|-------|------|---------|----------|------------|
| `host` | string | -- | Yes | Non-empty (HTTP 400) |
| `port` | number | `515` | No | 1--65535 (HTTP 400) |
| `printer` | string | `"lp"` | No | No regex validation |
| `users` | string[] | `[]` | No | No validation on individual entries |
| `timeout` | number | `10000` | No | Read timeout capped at `min(timeout, 10000)` |

### Wire command sent

```
\x04lp alice bob\n
```

Command 0x04 = "Send queue state (long)", followed by the printer name. If `users` is non-empty, they are appended space-separated after the printer name. Per RFC 1179, the list items can be either usernames or job numbers to filter by.

### Response (success -- HTTP 200)

```json
{
  "success": true,
  "host": "printer.local",
  "port": 515,
  "printer": "lp",
  "totalTimeMs": 67,
  "queueListing": "lp is ready and printing\nRank   Owner  Job  Files          Total Size\n1st    root   42   report.pdf     102400 bytes",
  "jobs": [
    { "raw": "lp is ready and printing" },
    { "raw": "Rank   Owner  Job  Files          Total Size" },
    { "rank": "1st", "owner": "root", "jobId": "42", "files": "report.pdf", "size": "102400 bytes", "raw": "1st    root   42   report.pdf     102400 bytes" }
  ],
  "jobCount": 1,
  "responseBytes": 142,
  "format": "long"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `queueListing` | string | Full server response text, trimmed |
| `jobs` | array | Parsed job entries. Each entry always has `raw`. Entries matching the regex also have `rank`, `owner`, `jobId`, `files`, `size`. |
| `jobCount` | number | Count of entries that have a `jobId` (i.e. successfully parsed job lines, not headers) |
| `format` | string | Always `"long"` |

### Job line parsing regex

```regex
/^\s*(\d+\w+|\w+)\s+(\S+)\s+(\d+)\s+(.+?)\s+(\d+\s*bytes?)\s*$/i
```

This matches lines like `1st  root  123  myfile.txt  1024 bytes`. Lines that do not match (headers, status lines, etc.) are included as `{ raw: "..." }` without parsed fields.

### Read behavior

- Read cap: 16 384 bytes
- Read timeout: `min(timeout, 10000)` ms

---

## Endpoint 3: `POST /api/lpd/print`

Submits a print job using the RFC 1179 "Receive Job" flow (command 0x02). Sends a data file followed by a control file, with acknowledgement checks at each step.

### Request

```json
{
  "host": "printer.local",
  "port": 515,
  "queue": "lp",
  "content": "Hello, World!\n",
  "jobName": "test-page",
  "user": "alice",
  "timeout": 15000
}
```

| Field | Type | Default | Required | Validation |
|-------|------|---------|----------|------------|
| `host` | string | -- | Yes | Non-empty (HTTP 400) |
| `port` | number | `515` | No | 1--65535 (HTTP 400) |
| `queue` | string | -- | Yes | Non-empty (HTTP 400) |
| `content` | string | -- | Yes | Not null/undefined (HTTP 400). Empty string `""` is accepted. |
| `jobName` | string | `"portofcall-job"` | No | No validation (used in control file `N` line) |
| `user` | string | `"portofcall"` | No | No validation (used in control file `P` line) |
| `timeout` | number | `15000` | No | Applied to TCP connect phase only |

### Print job submission flow (wire protocol)

The implementation follows the RFC 1179 "Receive Job" sequence:

```
Client                              Server (port 515)
  |                                    |
  |------- TCP SYN ------------------->|
  |<------ TCP SYN-ACK ---------------|
  |------- TCP ACK ------------------->|
  |                                    |
  | Step 1: Receive Job command        |
  |--- "\x02lp\n" ------------------->|   (command 0x02 + queue + LF)
  |<-- 0x00 ack ----------------------|   (single byte: 0 = accepted)
  |                                    |
  | Step 2: Send data file header      |
  |--- "\x0314 dfA042portofcall\n" -->|   (subcommand 0x03 + size + SP + name + LF)
  |<-- 0x00 ack ----------------------|
  |                                    |
  | Step 3: Send data file content     |
  |--- "Hello, World!\n" ------------>|   (raw bytes, exactly `size` bytes)
  |--- 0x00 ------------------------->|   (null byte = end of data)
  |<-- 0x00 ack ----------------------|
  |                                    |
  | Step 4: Send control file header   |
  |--- "\x0252 cfA042portofcall\n" -->|   (subcommand 0x02 + size + SP + name + LF)
  |<-- 0x00 ack ----------------------|
  |                                    |
  | Step 5: Send control file content  |
  |--- "Hportofcall\n..." ----------->|   (control file lines)
  |--- 0x00 ------------------------->|   (null byte = end of control data)
  |<-- 0x00 ack ----------------------|
  |                                    |
  |------- TCP FIN ------------------->|
```

### Control file format

The control file is built with these lines (LF-terminated):

```
Hportofcall
Palice
Ntest-page
ldfA042portofcall
```

| Line | RFC 1179 meaning |
|------|-----------------|
| `H<hostname>` | Originating host name |
| `P<user>` | User identification / job owner |
| `N<name>` | Name of source file (used for banner/display) |
| `l<datafile>` | Print file with control characters passed through ("raw" or "literal" mode) |

The `l` (lowercase L) format code means "print with control characters" -- essentially raw pass-through with no filtering. Other format codes like `f` (formatted print), `p` (PR-formatted), and `o` (PostScript) are not used.

### Data and control file naming

Per RFC 1179 Section 7.2, file names follow the pattern:

- Data file: `dfA<NNN><hostname>` (e.g. `dfA042portofcall`)
- Control file: `cfA<NNN><hostname>` (e.g. `cfA042portofcall`)

Where `<NNN>` is a three-digit job number (000--999) and `<hostname>` is the originating host (hardcoded to `portofcall`, max 31 chars per RFC).

The `A` is the "sequence letter" -- RFC 1179 allows A--Z for multiple files within one job. This implementation always uses `A` since it sends exactly one data file per job.

### Response (success -- HTTP 200)

```json
{
  "success": true,
  "queue": "lp",
  "jobId": "042",
  "accepted": true,
  "controlFileAck": 0,
  "dataFileAck": 0,
  "rtt": 234
}
```

| Field | Type | Notes |
|-------|------|-------|
| `queue` | string | The queue name as sent |
| `jobId` | string | Three-digit job number (000--999) |
| `accepted` | boolean | `true` if the initial Receive Job command was acked with 0x00 |
| `controlFileAck` | number | Ack byte for control file transfer. `0` = success, `-1` = no response/timeout, other = error |
| `dataFileAck` | number | Ack byte for data file transfer. Same semantics. |
| `rtt` | number | Total wall-clock time in ms |

### Response (job rejected -- HTTP 200)

If the server rejects the Receive Job command (non-zero ack or no response):

```json
{
  "success": true,
  "queue": "lp",
  "jobId": "042",
  "accepted": false,
  "controlFileAck": -1,
  "dataFileAck": -1,
  "rtt": 5012
}
```

Note: `success: true` means the TCP connection succeeded and the protocol exchange completed. `accepted: false` means the LPD server refused the job. The ack values remain `-1` because the data/control file phases were skipped.

### Ack timeout

Each `readAck()` call has a 5-second timeout. If the server does not respond within 5 seconds, the ack is treated as `-1` (failure).

---

## Endpoint 4: `POST /api/lpd/remove`

Sends the Remove Jobs command (0x05) to delete print jobs from a queue.

### Request

```json
{
  "host": "printer.local",
  "port": 515,
  "queue": "lp",
  "agent": "alice",
  "jobIds": [42, 43],
  "timeout": 10000
}
```

| Field | Type | Default | Required | Validation |
|-------|------|---------|----------|------------|
| `host` | string | -- | Yes | Non-empty (HTTP 400) |
| `port` | number | `515` | No | 1--65535 (HTTP 400) |
| `queue` | string | -- | Yes | Non-empty (HTTP 400) |
| `agent` | string | `"root"` | No | No validation. Per RFC 1179, this is the username authorized to remove jobs. Using `root` removes any user's jobs on most LPD servers. |
| `jobIds` | (string\|number)[] | `[]` | No | Converted to strings. If empty, removes all jobs for the agent. |
| `timeout` | number | `10000` | No | Read timeout capped at `min(timeout, 5000)` |

### Wire command sent

```
\x05lp alice 42 43\n
```

Command 0x05 = "Remove jobs", followed by queue name, agent (user), and optional space-separated job IDs. If no job IDs are given, all jobs for the agent are targeted.

### Response (success -- HTTP 200)

```json
{
  "success": true,
  "host": "printer.local",
  "port": 515,
  "queue": "lp",
  "agent": "alice",
  "jobIds": ["42", "43"],
  "ackByte": 0,
  "accepted": true,
  "response": "",
  "rtt": 23
}
```

| Field | Type | Notes |
|-------|------|-------|
| `ackByte` | number | First byte of server response. `0` = success. `-1` = no response. |
| `accepted` | boolean | `true` if `ackByte === 0` |
| `response` | string\|undefined | Full decoded server response text (trimmed). `undefined` if empty. |

### Read behavior

- Read cap: 1024 bytes
- Read timeout: `min(timeout, 5000)` ms
- Per RFC 1179, the Remove Jobs command may not receive any acknowledgement -- the server may simply close the connection.

---

## Error responses (all endpoints)

| Condition | HTTP status | Response |
|-----------|-------------|----------|
| Missing `host` | 400 | `{ "success": false, "error": "Host is required" }` |
| Missing `queue` (print/remove) | 400 | `{ "success": false, "error": "Queue is required" }` |
| Missing `content` (print) | 400 | `{ "success": false, "error": "Content is required" }` |
| Port out of range | 400 | `{ "success": false, "error": "Port must be between 1 and 65535" }` |
| Non-POST method | 405 | `{ "error": "Method not allowed" }` |
| Cloudflare detected | 403 | `{ "success": false, "error": "...", "isCloudflare": true }` |
| Connection failed / timeout | 500 | `{ "success": false, "error": "..." }` |

---

## curl Examples

```bash
# Short queue state (probe)
curl -s -X POST https://portofcall.example/api/lpd/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"printer.local"}' | jq .

# Short queue state on non-default port
curl -s -X POST https://portofcall.example/api/lpd/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"printer.local","port":1515,"printer":"raw"}' | jq .

# Long queue state listing
curl -s -X POST https://portofcall.example/api/lpd/queue \
  -H 'Content-Type: application/json' \
  -d '{"host":"printer.local","printer":"lp"}' | jq .

# Long queue state filtered by user
curl -s -X POST https://portofcall.example/api/lpd/queue \
  -H 'Content-Type: application/json' \
  -d '{"host":"printer.local","printer":"lp","users":["alice"]}' | jq .

# Submit a print job
curl -s -X POST https://portofcall.example/api/lpd/print \
  -H 'Content-Type: application/json' \
  -d '{"host":"printer.local","queue":"lp","content":"Hello from Port of Call!\n","user":"alice","jobName":"test"}' | jq .

# Remove a specific job
curl -s -X POST https://portofcall.example/api/lpd/remove \
  -H 'Content-Type: application/json' \
  -d '{"host":"printer.local","queue":"lp","agent":"alice","jobIds":["042"]}' | jq .

# Remove all jobs for a user
curl -s -X POST https://portofcall.example/api/lpd/remove \
  -H 'Content-Type: application/json' \
  -d '{"host":"printer.local","queue":"lp","agent":"alice"}' | jq .
```

---

## Quirks and Limitations

### 1. Data file sent before control file

The print endpoint sends the data file first, then the control file. RFC 1179 does not mandate an ordering between data and control files within a "Receive Job" session, but the traditional BSD `lpr` implementation (and many LPD servers) send the **control file first**. Some LPD server implementations may begin printing before receiving the control file if the data file arrives first, which can result in missing job metadata (no banner page, no username attribution). Most modern LPD servers handle either ordering, but legacy systems may behave unexpectedly.

### 2. Command 0x01 (Print Waiting Jobs) not implemented

RFC 1179 defines command `\x01<queue>\n` to tell the daemon to start printing any waiting jobs. This is typically sent by `lpc start` on BSD systems. The implementation does not expose this command. It is rarely needed since most LPD servers process jobs immediately.

### 3. No source port restriction

RFC 1179 Section 3.1 specifies that the sending host "MUST" use a source port in the range 721--731. This was a security mechanism: only root can bind to ports below 1024 on Unix, so the source port served as a rudimentary authentication. Cloudflare Workers sockets do not allow control over the source port, so this requirement is inherently unmet. In practice, most modern LPD servers do not enforce source port restrictions.

### 4. No multi-file job support

RFC 1179 allows multiple data files per job (each with its own subcommand 0x03). The control file can reference multiple data files with multiple format lines (`l`, `f`, `p`, etc.). This implementation sends exactly one data file per job.

### 5. Only raw/literal print mode (`l`)

The control file always uses the `l` (lowercase L) format code, meaning "print file with control characters" (raw pass-through). RFC 1179 defines many format codes:

| Code | Meaning |
|------|---------|
| `f` | Print file, interpreting first column as FORTRAN carriage control |
| `l` | Print file with control characters passed through (raw) |
| `o` | Print file as PostScript |
| `p` | Print with `pr` formatting (header, page numbers) |
| `r` | Print file as raw (similar to `l`) |
| `d` | Print DVI file |
| `g` | Print ditroff file |
| `n` | Print nroff file |
| `t` | Print troff file |
| `v` | Print raster file |
| `c` | CIF file |

None of these alternatives are exposed in the API.

### 6. `printer` vs `queue` naming inconsistency

The probe and queue endpoints use `printer` as the parameter name. The print and remove endpoints use `queue`. Both refer to the same LPD concept (the printer queue name). Default for `printer` is `"lp"`; there is no default for `queue` (required).

### 7. No input sanitization on queue/printer names

RFC 1179 does not restrict queue name characters, but most LPD servers expect alphanumeric names (possibly with hyphens/underscores). The implementation performs no regex validation on `printer`, `queue`, `user`, `agent`, or `jobName` fields. Newlines or control characters in these fields would corrupt the wire protocol.

### 8. `readAck()` may read more than one byte

The `readAck()` helper reads from the stream and returns only the first byte (`result.value[0]`). However, `reader.read()` may return multiple bytes in one chunk. Any bytes beyond the first are silently discarded. In practice, LPD ack responses are exactly one byte, so this is unlikely to cause issues.

### 9. Print endpoint returns `success: true` even when job is rejected

If the server sends a non-zero ack (rejecting the job), the HTTP response is still `200 OK` with `success: true`. The `accepted: false` flag indicates the LPD-level rejection. Callers must check `accepted`, not just `success`, to determine if the job was actually queued.

### 10. Probe/queue responses are `.trim()`ed

The raw server response text is trimmed of leading and trailing whitespace. If the response has significant leading/trailing newlines (e.g. a banner line), those are silently stripped. The `responseBytes` field reflects the pre-trim size.

### 11. Queue job parser is best-effort

The regex that parses long-format queue lines (`/^\s*(\d+\w+|\w+)\s+(\S+)\s+(\d+)\s+(.+?)\s+(\d+\s*bytes?)\s*$/i`) is designed for the common BSD-style output format. Different LPD implementations may use different column layouts. Unparsed lines are still returned in the `jobs` array with a `raw` field.

### 12. `content` accepts empty string

The print endpoint checks `body.content === undefined || body.content === null` but does not reject `""`. Sending an empty string results in a valid LPD job submission with a 0-byte data file. Some LPD servers may reject this; others will silently produce an empty page or nothing.

### 13. Timeout on `handleLPDPrint` only covers TCP connect

The `timeoutPromise` in the print handler wraps only `socket.opened`. The subsequent ack reads each have their own 5-second deadlines, but there is no overall deadline for the entire job submission flow. A pathological server that acks each step slowly but within the 5-second per-ack deadline could keep the handler running for up to ~30 seconds (connect + 5 ack reads x 5 seconds each).

### 14. No Abort Job subcommand

If a data file transfer fails (non-zero ack from server), the implementation does not send the Abort Job subcommand (`\x01\n`). Instead, it proceeds to attempt the control file transfer anyway. Per RFC 1179 Section 7.1, the abort subcommand is meant to let the receiving server "clean up" after a failed transfer.

---

## Local Testing

```bash
# Simple LPD server with Python (listens on 1515, prints received data):
python3 -c "
import socket
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', 1515))
s.listen(1)
print('Listening on :1515')
while True:
    c, a = s.accept()
    print(f'Connection from {a}')
    data = c.recv(4096)
    print(f'Received: {data!r}')
    # Ack with 0x00 for any command
    c.send(b'\x00')
    # Read more data (for print jobs)
    while True:
        more = c.recv(4096)
        if not more: break
        print(f'Data: {more!r}')
        c.send(b'\x00')
    c.close()
"

# Then probe it:
curl -s -X POST http://localhost:8787/api/lpd/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","port":1515}' | jq .

# Or with CUPS (which includes an LPD server):
# Enable LPD in CUPS:
# cupsctl --remote-any
# lpd listens on port 515
```

Or with `netcat` for a one-shot test:

```bash
# Accept one connection, send ack, dump data
{ echo -ne '\x00'; cat; } | nc -l 1515 | xxd
```

---

## Cross-Endpoint Comparison

| | `/probe` | `/queue` | `/print` | `/remove` |
|---|---|---|---|---|
| LPD command | 0x03 (short queue) | 0x04 (long queue) | 0x02 (receive job) | 0x05 (remove jobs) |
| Default timeout | 10 000 ms | 10 000 ms | 15 000 ms | 10 000 ms |
| Read timeout cap | 5 000 ms | 10 000 ms | 5 000 ms per ack | 5 000 ms |
| Read size cap | 4 KB | 16 KB | 1 byte per ack | 1 KB |
| Queue/printer name param | `printer` | `printer` | `queue` | `queue` |
| Queue/printer default | `"lp"` | `"lp"` | -- (required) | -- (required) |
| Port validation | Yes | Yes | Yes | Yes |
| CF detection | Yes | Yes | Yes | Yes |
| Method restriction | POST only | POST only | POST only | POST only |
| Returns `connectTimeMs` | Yes | No | No | No |
| Returns `rtt` | No (`totalTimeMs`) | No (`totalTimeMs`) | Yes (`rtt`) | Yes (`rtt`) |
