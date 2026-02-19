# Gearman — Power User Reference

**Port:** 4730 (default) | **Protocol:** Text admin + Binary job | **Transport:** TCP

Port of Call provides three Gearman endpoints: a connectivity probe (version + status), a text admin command executor, and a binary protocol job submitter. All three open a direct TCP connection from the Cloudflare Worker to the target Gearman job server.

---

## Protocol Overview

Gearman uses two distinct protocols on the same TCP port (4730):

### Text Admin Protocol

ASCII text commands terminated by `\n`. Used for monitoring and management. No framing -- one command per line, responses are either single-line or multi-line (terminated by `.\n`).

### Binary Protocol

Used for actual job submission, worker registration, and job lifecycle management. Every packet has a 12-byte header:

```
Offset  Length  Field
0       4       Magic code: \0REQ (client→server) or \0RES (server→client)
4       4       Packet type (uint32, big-endian)
8       4       Data length (uint32, big-endian, does NOT include the 12-byte header)
12      N       Data (fields separated by NULL bytes \0)
```

**Magic bytes (hex):**

| Direction       | Magic        | Hex bytes         |
|-----------------|--------------|-------------------|
| Client → Server | `\0REQ`      | `00 52 45 51`     |
| Server → Client | `\0RES`      | `00 52 45 53`     |

---

## API Endpoints

### `POST /api/gearman/connect` — Connection probe

Connects to a Gearman server, sends `version\n` and `status\n` via the text admin protocol, parses the function queue, and returns a summary.

**POST body:**

| Field     | Type   | Default | Notes                      |
|-----------|--------|---------|----------------------------|
| `host`    | string | --      | Required                   |
| `port`    | number | `4730`  |                            |
| `timeout` | number | `10000` | Total timeout in ms        |

**Success (200):**
```json
{
  "success": true,
  "host": "gearman.example.com",
  "port": 4730,
  "rtt": 42,
  "version": "1.1.21",
  "functions": [
    { "name": "reverse", "total": 0, "running": 0, "availableWorkers": 3 },
    { "name": "resize_image", "total": 5, "running": 2, "availableWorkers": 4 }
  ],
  "totalFunctions": 2,
  "totalQueuedJobs": 5,
  "totalRunningJobs": 2,
  "totalWorkers": 7,
  "rawStatus": "reverse\t0\t0\t3\nresize_image\t5\t2\t4",
  "protocol": "Gearman",
  "message": "Gearman connected in 42ms"
}
```

**Error (500):** `{ "success": false, "error": "Connection timeout" }`

**Cloudflare-protected host (403):** `{ "success": false, "error": "...", "isCloudflare": true }`

---

### `POST /api/gearman/command` — Text admin command execution

Sends a single text admin command and returns the raw response.

**POST body:**

| Field     | Type   | Default | Notes                              |
|-----------|--------|---------|------------------------------------|
| `host`    | string | --      | Required                           |
| `port`    | number | `4730`  |                                    |
| `command` | string | --      | Required. Text admin command       |
| `timeout` | number | `10000` | Total timeout in ms                |

**Allowed commands (whitelist):**

| Command              | Response type | Description                              |
|----------------------|---------------|------------------------------------------|
| `version`            | Single-line   | Server version string                    |
| `status`             | Multi-line    | Function queue stats (tab-delimited)     |
| `workers`            | Multi-line    | Connected worker info                    |
| `maxqueue <func>`    | Single-line   | Query max queue size for a function      |

**Blocked:**
- `maxqueue <func> <max>` -- Setting max queue size is rejected (read-only mode)
- `shutdown` / `shutdown graceful` -- Not in allowed list
- Any binary protocol commands -- Not in allowed list

**Success (200):**
```json
{
  "success": true,
  "host": "gearman.example.com",
  "port": 4730,
  "command": "status",
  "rtt": 15,
  "response": "reverse\t0\t0\t3\nresize_image\t5\t2\t4",
  "message": "Command executed in 15ms"
}
```

---

### `POST /api/gearman/submit` — Binary protocol job submission

Submits a job using the Gearman binary protocol. Supports both foreground (wait for result) and background (fire-and-forget) modes, with normal/high/low priority.

**POST body:**

| Field          | Type    | Default    | Notes                                         |
|----------------|---------|------------|-----------------------------------------------|
| `host`         | string  | --         | Required                                      |
| `port`         | number  | `4730`     |                                               |
| `functionName` | string  | --         | Required. Gearman function to invoke          |
| `payload`      | string  | `""`       | Job data (workload) sent to the worker        |
| `uniqueId`     | string  | `""`       | Optional deduplication key                    |
| `priority`     | string  | `"normal"` | `"normal"`, `"high"`, or `"low"`              |
| `background`   | boolean | `false`    | `true` for fire-and-forget background jobs    |
| `timeout`      | number  | `8000`     | Total timeout in ms                           |

**Priority and background flag map to these binary packet types:**

| Priority | Foreground          | Background               |
|----------|---------------------|--------------------------|
| normal   | `SUBMIT_JOB` (7)    | `SUBMIT_JOB_BG` (18)    |
| high     | `SUBMIT_JOB_HIGH` (21) | `SUBMIT_JOB_HIGH_BG` (32) |
| low      | `SUBMIT_JOB_LOW` (33) | `SUBMIT_JOB_LOW_BG` (34) |

**Background job success (200):**
```json
{
  "success": true,
  "host": "gearman.example.com",
  "port": 4730,
  "rtt": 23,
  "functionName": "resize_image",
  "background": true,
  "priority": "normal",
  "responseType": 8,
  "responseTypeName": "JOB_CREATED",
  "jobHandle": "H:hostname:42",
  "message": "Background job submitted, handle: H:hostname:42"
}
```

**Foreground job success (200):**
```json
{
  "success": true,
  "host": "gearman.example.com",
  "port": 4730,
  "rtt": 150,
  "functionName": "reverse",
  "background": false,
  "priority": "normal",
  "responseType": 13,
  "responseTypeName": "WORK_COMPLETE",
  "jobHandle": "H:hostname:43",
  "result": "dlrow olleh",
  "workData": "intermediate chunk data (if any)",
  "workWarnings": ["optional warning messages"],
  "lastStatus": { "numerator": "100", "denominator": "100" },
  "message": "Job completed, handle: H:hostname:43"
}
```

**Foreground job failure:**
```json
{
  "success": false,
  "responseType": 14,
  "responseTypeName": "WORK_FAIL",
  "jobHandle": "H:hostname:43",
  "error": "Job failed (WORK_FAIL), handle: H:hostname:43"
}
```

---

## Binary Protocol Packet Types

### Client → Server (Request)

| Type | Name                 | Data format                              |
|------|----------------------|------------------------------------------|
| 1    | CAN_DO               | `functionName`                           |
| 2    | CANT_DO              | `functionName`                           |
| 3    | RESET_ABILITIES      | (none)                                   |
| 4    | PRE_SLEEP            | (none)                                   |
| 6    | NOOP                 | (none)                                   |
| 7    | SUBMIT_JOB           | `functionName\0uniqueId\0payload`        |
| 9    | GRAB_JOB             | (none)                                   |
| 12   | WORK_STATUS          | `jobHandle\0numerator\0denominator`      |
| 13   | WORK_COMPLETE        | `jobHandle\0result`                      |
| 14   | WORK_FAIL            | `jobHandle`                              |
| 15   | GET_STATUS           | `jobHandle`                              |
| 17   | ECHO_REQ             | `data`                                   |
| 18   | SUBMIT_JOB_BG        | `functionName\0uniqueId\0payload`        |
| 21   | SUBMIT_JOB_HIGH      | `functionName\0uniqueId\0payload`        |
| 22   | SET_CLIENT_ID        | `clientId`                               |
| 23   | CAN_DO_TIMEOUT       | `functionName\0timeout`                  |
| 24   | ALL_YOURS            | (none)                                   |
| 25   | WORK_EXCEPTION       | `jobHandle\0data`                        |
| 26   | OPTION_REQ           | `option`                                 |
| 28   | WORK_DATA            | `jobHandle\0data`                        |
| 29   | WORK_WARNING         | `jobHandle\0warning`                     |
| 32   | SUBMIT_JOB_HIGH_BG   | `functionName\0uniqueId\0payload`        |
| 33   | SUBMIT_JOB_LOW       | `functionName\0uniqueId\0payload`        |
| 34   | SUBMIT_JOB_LOW_BG    | `functionName\0uniqueId\0payload`        |
| 35   | SUBMIT_JOB_SCHED     | `functionName\0uniqueId\0min\0hour\0mday\0month\0wday\0payload` |
| 36   | SUBMIT_JOB_EPOCH     | `functionName\0uniqueId\0epoch\0payload` |
| 37   | SUBMIT_REDUCE_JOB    | `functionName\0uniqueId\0reducer\0payload` |
| 38   | SUBMIT_REDUCE_JOB_BG | `functionName\0uniqueId\0reducer\0payload` |
| 39   | GRAB_JOB_UNIQ        | (none)                                   |
| 40   | GRAB_JOB_ALL         | (none)                                   |

### Server → Client (Response)

| Type | Name              | Data format                              |
|------|-------------------|------------------------------------------|
| 6    | NOOP              | (none)                                   |
| 8    | JOB_CREATED       | `jobHandle`                              |
| 10   | NO_JOB            | (none)                                   |
| 11   | JOB_ASSIGN        | `jobHandle\0functionName\0payload`       |
| 12   | WORK_STATUS       | `jobHandle\0numerator\0denominator`      |
| 13   | WORK_COMPLETE     | `jobHandle\0result`                      |
| 14   | WORK_FAIL         | `jobHandle`                              |
| 18   | ECHO_RES          | `data`                                   |
| 19   | ERROR             | `errorCode\0errorText`                   |
| 20   | STATUS_RES        | `jobHandle\0knownStatus\0runningStatus\0numerator\0denominator` |
| 25   | WORK_EXCEPTION    | `jobHandle\0data`                        |
| 27   | OPTION_RES        | `option`                                 |
| 28   | WORK_DATA         | `jobHandle\0data`                        |
| 29   | WORK_WARNING      | `jobHandle\0warning`                     |
| 31   | JOB_ASSIGN_UNIQ   | `jobHandle\0functionName\0uniqueId\0payload` |
| 41   | JOB_ASSIGN_ALL    | `jobHandle\0functionName\0uniqueId\0reducer\0payload` |

---

## Text Admin Protocol Detail

### `status` Response Format

Each line is tab-delimited:

```
FUNCTION_NAME\tTOTAL_QUEUED\tJOBS_RUNNING\tAVAILABLE_WORKERS\n
```

Terminated by a line containing only `.\n`. An empty server returns just `.\n`.

**Example:**
```
reverse	0	0	3
resize_image	5	2	4
email_send	12	1	2
.
```

### `workers` Response Format

Each line describes a connected worker:

```
FD IP-ADDRESS CLIENT-ID : FUNCTION_1 FUNCTION_2 ...\n
```

Terminated by `.\n`.

**Example:**
```
42 10.0.0.5 worker-1 : reverse resize_image
43 10.0.0.6 - : email_send
.
```

A `-` for CLIENT-ID means the worker has not called `SET_CLIENT_ID`.

### `version` Response

Single line: the server version string followed by `\n`.

```
1.1.21\n
```

### `maxqueue` Response

When querying (one argument): returns `OK\n` (the current max is not exposed in all server versions).

When setting (two arguments): returns `OK\n` after applying the new max. **This endpoint blocks the set form for safety.**

---

## Foreground Job Lifecycle

When a client submits a foreground job (`SUBMIT_JOB`), the full packet exchange is:

```
Client                          Server                         Worker
  |                               |                               |
  |-- SUBMIT_JOB (7) ----------->|                               |
  |                               |-- JOB_ASSIGN (11) ---------->|
  |<-- JOB_CREATED (8) ----------|                               |
  |                               |                               |
  |                               |<-- WORK_STATUS (12) ---------|  (optional, repeatable)
  |<-- WORK_STATUS (12) ---------|                               |
  |                               |                               |
  |                               |<-- WORK_DATA (28) -----------|  (optional, repeatable)
  |<-- WORK_DATA (28) -----------|                               |
  |                               |                               |
  |                               |<-- WORK_WARNING (29) --------|  (optional, repeatable)
  |<-- WORK_WARNING (29) --------|                               |
  |                               |                               |
  |                               |<-- WORK_COMPLETE (13) -------|  (terminal)
  |<-- WORK_COMPLETE (13) -------|                               |
  |                               |                               |
```

Terminal responses (exactly one will be sent):

| Packet          | Meaning                        |
|-----------------|--------------------------------|
| WORK_COMPLETE   | Job finished successfully      |
| WORK_FAIL       | Job failed (no data returned)  |
| WORK_EXCEPTION  | Job threw an exception (opt-in via OPTION_REQ "exceptions") |

The Port of Call implementation correctly waits for the terminal response on foreground jobs, collecting any intermediate WORK_DATA, WORK_WARNING, and WORK_STATUS packets along the way.

---

## Background Job Lifecycle

For background jobs (`SUBMIT_JOB_BG`, `SUBMIT_JOB_HIGH_BG`, `SUBMIT_JOB_LOW_BG`):

```
Client                          Server
  |                               |
  |-- SUBMIT_JOB_BG (18) ------->|
  |<-- JOB_CREATED (8) ----------|
  |                               |
  (client disconnects)
```

The client receives `JOB_CREATED` with the job handle and disconnects. The server queues the job and assigns it to a worker when one is available. The client can later check job status via `GET_STATUS` (binary type 15), which returns `STATUS_RES` (type 20).

---

## Unique ID and Deduplication

The `uniqueId` field in SUBMIT_JOB packets serves as a deduplication key. If a non-empty `uniqueId` is provided and a job with the same unique ID is already queued or running for the same function, the server coalesces the submissions -- the new client receives the same job handle and result as the original.

An empty `uniqueId` (empty string before the second NULL separator) disables deduplication; each submission creates a new job.

---

## Known Limitations

**No TLS:** the worker uses `connect()` (plain TCP) only. Gearman servers behind TLS are not reachable.

**No worker registration:** this implementation is client-only. It cannot register as a Gearman worker (`CAN_DO`, `GRAB_JOB`, etc.).

**No persistent connections:** each API call opens and closes a new TCP connection. There is no connection pooling or WebSocket session mode.

**Text encoding only:** payloads are encoded/decoded as UTF-8 strings. Binary payloads (protobuf, MessagePack, raw bytes) will be corrupted by `TextEncoder`/`TextDecoder`.

**maxqueue query:** the `maxqueue FUNC` command returns `OK\n` on most server versions but does not include the actual current max value in the response text. This is a limitation of the Gearman admin protocol itself.

**Timeout on long-running foreground jobs:** the default timeout is 8 seconds. Foreground jobs that take longer will be reported as timeouts, even though the job continues running on the server. Increase the `timeout` parameter for long-running functions.

**No SUBMIT_JOB_SCHED or SUBMIT_JOB_EPOCH:** scheduled job submission is not exposed through the API.

---

## Security Model

The text admin endpoint enforces a strict read-only whitelist:
- `version` -- safe, returns server version
- `status` -- safe, returns queue statistics
- `workers` -- safe, returns connected worker info
- `maxqueue <func>` -- safe, queries max queue size (the two-argument set form is blocked)

The following are **not** in the allowed command list and will be rejected:
- `shutdown` / `shutdown graceful` -- would stop the server
- Any unrecognized commands

The binary protocol job submission endpoint (`/api/gearman/submit`) is a separate endpoint with its own input validation. It validates the response magic bytes (`\0RES`) to ensure it is talking to a real Gearman server, and rejects responses with invalid magic.

---

## Practical Examples

### curl

```bash
# Connection probe (version + status)
curl -s -X POST https://portofcall.ross.gg/api/gearman/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"gearman.example.com","port":4730}' | jq .

# Get server version
curl -s -X POST https://portofcall.ross.gg/api/gearman/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"gearman.example.com","command":"version"}' | jq -r '.response'

# List registered functions and queue depth
curl -s -X POST https://portofcall.ross.gg/api/gearman/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"gearman.example.com","command":"status"}' | jq -r '.response'

# List connected workers
curl -s -X POST https://portofcall.ross.gg/api/gearman/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"gearman.example.com","command":"workers"}' | jq -r '.response'

# Submit a background job (fire-and-forget)
curl -s -X POST https://portofcall.ross.gg/api/gearman/submit \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "gearman.example.com",
    "functionName": "email_send",
    "payload": "{\"to\":\"user@example.com\",\"subject\":\"Hello\"}",
    "background": true
  }' | jq .

# Submit a foreground job and wait for result
curl -s -X POST https://portofcall.ross.gg/api/gearman/submit \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "gearman.example.com",
    "functionName": "reverse",
    "payload": "hello world",
    "timeout": 15000
  }' | jq .

# Submit a high-priority background job
curl -s -X POST https://portofcall.ross.gg/api/gearman/submit \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "gearman.example.com",
    "functionName": "urgent_task",
    "payload": "critical data",
    "priority": "high",
    "background": true
  }' | jq .

# Submit with deduplication key
curl -s -X POST https://portofcall.ross.gg/api/gearman/submit \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "gearman.example.com",
    "functionName": "process_order",
    "payload": "{\"orderId\":12345}",
    "uniqueId": "order-12345",
    "background": true
  }' | jq .
```

---

## Resources

- [Gearman Protocol Specification](http://gearman.org/protocol/)
- [gearmand PROTOCOL document (GitHub)](https://github.com/gearman/gearmand/blob/master/PROTOCOL)
- [Gearman documentation](http://gearman.org/)
- [libgearman C library](https://github.com/gearman/gearmand)
- [GearmanManager (PHP)](https://github.com/brianlmoon/GearmanManager)
