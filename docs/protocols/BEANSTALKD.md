# Beanstalkd -- Power User Reference

**Port:** 11300 (default) | **Protocol:** Text-based TCP | **Transport:** Plain TCP (no TLS)

Port of Call provides four Beanstalkd endpoints: a stats probe, a whitelisted command executor, a job producer (put), and a job consumer (reserve). Each opens a fresh TCP connection from the Cloudflare Worker to your Beanstalkd instance.

---

## API Endpoints

### `POST /api/beanstalkd/connect` -- Stats probe

Connects, sends `stats`, parses the YAML response, and returns key server metrics.

**POST body:**

| Field     | Type   | Default  | Notes |
|-----------|--------|----------|-------|
| `host`    | string | --       | Required |
| `port`    | number | `11300`  | |
| `timeout` | number | `10000`  | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "beanstalkd.example.com",
  "port": 11300,
  "rtt": 42,
  "status": "OK",
  "version": "1.12",
  "currentJobsReady": "5",
  "currentJobsReserved": "2",
  "currentJobsDelayed": "0",
  "currentJobsBuried": "0",
  "totalJobs": "1842",
  "currentTubes": "3",
  "currentConnections": "7",
  "uptime": "86400",
  "pid": "12345",
  "rawStats": "---\ncurrent-jobs-urgent: 0\n...",
  "protocol": "Beanstalkd",
  "message": "Beanstalkd connected in 42ms"
}
```

**Notes:**
- The `rawStats` field contains the full YAML body from the `stats` command.
- Stats values are returned as strings (matching YAML output). Parse to integers as needed.
- `version` maps to the `version` field in beanstalkd stats output.

---

### `POST /api/beanstalkd/command` -- Command executor

Sends a single whitelisted command and returns the parsed response.

**POST body:**

| Field     | Type   | Default  | Notes |
|-----------|--------|----------|-------|
| `host`    | string | --       | Required |
| `port`    | number | `11300`  | |
| `command` | string | --       | Required. Beanstalkd command string |
| `timeout` | number | `10000`  | Total timeout in ms |

**Allowed commands:**

| Command | Protocol response | Description |
|---------|-------------------|-------------|
| `stats` | `OK <bytes>\r\n<yaml>\r\n` | Server-wide statistics |
| `list-tubes` | `OK <bytes>\r\n<yaml>\r\n` | List all tube names |
| `list-tubes-watched` | `OK <bytes>\r\n<yaml>\r\n` | Tubes being watched on this connection |
| `list-tube-used` | `USING <tube>\r\n` | Current tube for `put` |
| `stats-tube <name>` | `OK <bytes>\r\n<yaml>\r\n` | Statistics for a specific tube |
| `stats-job <id>` | `OK <bytes>\r\n<yaml>\r\n` | Statistics for a specific job |
| `peek <id>` | `FOUND <id> <bytes>\r\n<data>\r\n` | Peek at job by ID |
| `peek-ready` | `FOUND <id> <bytes>\r\n<data>\r\n` | Peek at next ready job |
| `peek-delayed` | `FOUND <id> <bytes>\r\n<data>\r\n` | Peek at next delayed job |
| `peek-buried` | `FOUND <id> <bytes>\r\n<data>\r\n` | Peek at next buried job |
| `use <tube>` | `USING <tube>\r\n` | Select tube (per-connection state) |
| `watch <tube>` | `WATCHING <count>\r\n` | Watch a tube (per-connection state) |
| `ignore <tube>` | `WATCHING <count>\r\n` | Stop watching a tube |

**Blocked commands:** `put`, `reserve`, `reserve-with-timeout`, `delete`, `release`, `bury`, `kick`, `kick-job`, `touch`, `pause-tube`, `quit`.

**Success (200):**
```json
{
  "success": true,
  "host": "beanstalkd.example.com",
  "port": 11300,
  "command": "peek-ready",
  "rtt": 15,
  "status": "FOUND",
  "jobId": 42,
  "response": "{\"task\":\"send-email\",\"to\":\"user@example.com\"}",
  "message": "Command executed in 15ms"
}
```

**Protocol error (200 with `success: false`):**
```json
{
  "success": false,
  "command": "peek-ready",
  "status": "NOT_FOUND",
  "response": "NOT_FOUND",
  "message": "Server returned: NOT_FOUND"
}
```

**Notes:**
- `use`, `watch`, and `ignore` only affect per-connection state. Since the connection is closed immediately after the response, they are harmless.
- For peek commands, the `jobId` field is extracted from the FOUND response.
- Protocol-level errors (`NOT_FOUND`, `BAD_FORMAT`, `UNKNOWN_COMMAND`, etc.) return HTTP 200 with `success: false` and the error in the `status` field.

---

### `POST /api/beanstalkd/put` -- Enqueue a job

Connects, optionally switches tube with `use`, then sends a `put` command.

**POST body:**

| Field      | Type   | Default   | Notes |
|------------|--------|-----------|-------|
| `host`     | string | --        | Required |
| `port`     | number | `11300`   | |
| `tube`     | string | `default` | Tube name. Sends `use <tube>` if not "default" |
| `payload`  | string | --        | Required. Job body (UTF-8 text) |
| `priority` | number | `1024`    | 0 = most urgent, 4294967295 = least urgent |
| `delay`    | number | `0`       | Seconds before job becomes ready |
| `ttr`      | number | `60`      | Time-to-run in seconds (min: 1) |
| `timeout`  | number | `8000`    | Connection timeout in ms |

**Wire format sent:**
```
use <tube>\r\n                          (only if tube != "default")
put <priority> <delay> <ttr> <bytes>\r\n
<payload data>\r\n
```

**Success (200):**
```json
{
  "success": true,
  "host": "beanstalkd.example.com",
  "port": 11300,
  "tube": "emails",
  "rtt": 23,
  "jobId": 42,
  "status": "INSERTED 42",
  "message": "Job 42 inserted into tube 'emails'"
}
```

**BURIED response (200 with `success: false`):**
```json
{
  "success": false,
  "jobId": 42,
  "status": "BURIED 42",
  "message": "Job 42 buried -- server out of memory (use 'kick' to recover)"
}
```

**Notes:**
- `BURIED` from `put` means the server ran out of memory trying to grow the priority queue. The job exists but will not be processed until explicitly kicked. This is reported as a failure.
- The payload is sent as raw UTF-8 bytes. The byte count in the `put` command is the encoded byte length (not the string length), which matters for multi-byte characters.
- Priority 0 is the most urgent. The default 1024 is a reasonable middle value.
- TTR (time-to-run) is the number of seconds a worker has to finish the job once reserved. If the worker does not delete/release/bury the job within TTR seconds, the server automatically releases it back to the ready queue. Minimum is 1 second.

---

### `POST /api/beanstalkd/reserve` -- Dequeue a job

Connects, optionally watches a non-default tube (and ignores the default), then sends `reserve-with-timeout`.

**POST body:**

| Field            | Type   | Default   | Notes |
|------------------|--------|-----------|-------|
| `host`           | string | --        | Required |
| `port`           | number | `11300`   | |
| `tube`           | string | `default` | Tube to reserve from |
| `reserveTimeout` | number | `2`       | Beanstalkd-level wait in seconds |
| `timeout`        | number | `12000`   | Connection timeout in ms |

**Wire format sent:**
```
watch <tube>\r\n           (only if tube != "default")
ignore default\r\n         (only if tube != "default")
reserve-with-timeout <n>\r\n
```

**Success -- job reserved (200):**
```json
{
  "success": true,
  "host": "beanstalkd.example.com",
  "port": 11300,
  "tube": "emails",
  "rtt": 45,
  "status": "RESERVED",
  "jobId": 42,
  "jobBytes": 128,
  "payload": "{\"task\":\"send-email\",\"to\":\"user@example.com\"}",
  "message": "Reserved job 42 (128 bytes) from tube 'emails'"
}
```

**No jobs available (200):**
```json
{
  "success": true,
  "tube": "emails",
  "status": "TIMED_OUT",
  "message": "No jobs ready in tube within timeout"
}
```

**Notes:**
- When reserving from a non-default tube, the handler sends both `watch <tube>` and `ignore default` to ensure jobs come only from the requested tube. Without `ignore default`, beanstalkd would return jobs from both "default" and the requested tube.
- The reserved job has a TTR countdown. Since Port of Call closes the connection immediately after returning the response, the server will automatically release the job back to the ready queue after TTR seconds. To actually process and delete the job, use a persistent client.
- `TIMED_OUT` with `success: true` means the command executed correctly but no jobs were available within the `reserveTimeout` window. This is normal for empty tubes.

---

## Beanstalkd Protocol Reference

### Connection

Beanstalkd uses a plain-text TCP protocol. Connect to port 11300 (or a custom port) and begin sending commands immediately -- there is no handshake, banner, or authentication.

Every command is terminated by `\r\n`. Every response is terminated by `\r\n`. Commands and responses are ASCII.

### Job Lifecycle

```
   put with delay=0            reserve              delete
  ----------------> [READY] -----------> [RESERVED] -------> *deleted*
                       ^                     |
                       |                     | release (delay=0)
                       +---------------------+
                       |                     |
                       |                     | release (delay>0)
                       |   (delay expires)   v
                       +---------------- [DELAYED]
                       |
  put with delay>0     |
  -------------------> |
                       |
                       |                     | bury
                       |                     v
                       +<--- kick -------- [BURIED]
```

**States:**

| State | Description |
|-------|-------------|
| `ready` | Job is waiting to be reserved by a worker |
| `reserved` | Job has been claimed by a worker (TTR countdown active) |
| `delayed` | Job is waiting for its delay to expire before becoming ready |
| `buried` | Job has been set aside (failed processing or server OOM on put) |

### Tube Management

Tubes are named queues. Every connection starts with:
- **use** tube: `default` (for producing via `put`)
- **watch** list: `[default]` (for consuming via `reserve`)

Producer commands (`put`) go to the tube selected by `use`. Consumer commands (`reserve`) draw from any tube in the watch list.

```
use <tube>\r\n             -> USING <tube>\r\n
watch <tube>\r\n           -> WATCHING <count>\r\n
ignore <tube>\r\n          -> WATCHING <count>\r\n  |  NOT_IGNORED\r\n
```

`NOT_IGNORED` is returned if you try to ignore the last tube in the watch list (you must always watch at least one tube).

### Command Reference (Full Protocol)

#### Producer Commands

**put** -- insert a new job
```
put <priority> <delay> <ttr> <bytes>\r\n
<data>\r\n
```
Response: `INSERTED <id>\r\n` | `BURIED <id>\r\n` | `EXPECTED_CRLF\r\n` | `JOB_TOO_BIG\r\n` | `DRAINING\r\n`

- `priority`: 0 (most urgent) to 4294967295 (least urgent)
- `delay`: seconds to wait before the job becomes ready (0 = immediate)
- `ttr`: time-to-run in seconds. Minimum 1. If a worker does not delete/release/bury within TTR, the job is auto-released
- `bytes`: exact byte length of `<data>` (not including the trailing `\r\n`)
- `JOB_TOO_BIG`: job body exceeds the server's `max-job-size` (default 65535 bytes)
- `DRAINING`: server is in drain mode (shutting down) and not accepting new jobs

#### Consumer Commands

**reserve** -- block until a job is available
```
reserve\r\n
```
Response: `RESERVED <id> <bytes>\r\n<data>\r\n` | `DEADLINE_SOON\r\n`

**reserve-with-timeout** -- block with a timeout
```
reserve-with-timeout <seconds>\r\n
```
Response: `RESERVED <id> <bytes>\r\n<data>\r\n` | `TIMED_OUT\r\n` | `DEADLINE_SOON\r\n`

`DEADLINE_SOON` means a reserved job's TTR is about to expire (within 1 second). The client should delete, release, or bury it before the server auto-releases.

**delete** -- permanently remove a job
```
delete <id>\r\n
```
Response: `DELETED\r\n` | `NOT_FOUND\r\n`

**release** -- return a reserved job to the ready queue
```
release <id> <priority> <delay>\r\n
```
Response: `RELEASED\r\n` | `BURIED\r\n` | `NOT_FOUND\r\n`

**bury** -- put a reserved job into the buried state
```
bury <id> <priority>\r\n
```
Response: `BURIED\r\n` | `NOT_FOUND\r\n`

**touch** -- reset the TTR countdown for a reserved job
```
touch <id>\r\n
```
Response: `TOUCHED\r\n` | `NOT_FOUND\r\n`

#### Inspection Commands

**peek** -- look at a job without reserving it
```
peek <id>\r\n
```
Response: `FOUND <id> <bytes>\r\n<data>\r\n` | `NOT_FOUND\r\n`

**peek-ready** / **peek-delayed** / **peek-buried**
```
peek-ready\r\n
peek-delayed\r\n
peek-buried\r\n
```
Response: `FOUND <id> <bytes>\r\n<data>\r\n` | `NOT_FOUND\r\n`

**kick** -- move buried/delayed jobs to ready
```
kick <bound>\r\n
```
Response: `KICKED <count>\r\n`

Kicks up to `<bound>` jobs. Buried jobs are kicked first, then delayed jobs.

**kick-job** -- kick a specific job
```
kick-job <id>\r\n
```
Response: `KICKED\r\n` | `NOT_FOUND\r\n`

#### Statistics Commands

**stats** -- server-wide statistics
```
stats\r\n
```
Response: `OK <bytes>\r\n<yaml>\r\n`

Key fields: `version`, `current-jobs-urgent`, `current-jobs-ready`, `current-jobs-reserved`, `current-jobs-delayed`, `current-jobs-buried`, `total-jobs`, `current-tubes`, `current-connections`, `uptime`, `pid`, `max-job-size`.

**stats-tube** -- per-tube statistics
```
stats-tube <name>\r\n
```
Response: `OK <bytes>\r\n<yaml>\r\n` | `NOT_FOUND\r\n`

Key fields: `name`, `current-jobs-urgent`, `current-jobs-ready`, `current-jobs-reserved`, `current-jobs-delayed`, `current-jobs-buried`, `total-jobs`, `current-using`, `current-watching`, `current-waiting`, `pause`, `pause-time-left`.

**stats-job** -- per-job statistics
```
stats-job <id>\r\n
```
Response: `OK <bytes>\r\n<yaml>\r\n` | `NOT_FOUND\r\n`

Key fields: `id`, `tube`, `state`, `pri`, `age`, `delay`, `ttr`, `time-left`, `file`, `reserves`, `timeouts`, `releases`, `buries`, `kicks`.

**list-tubes** -- all tube names
```
list-tubes\r\n
```
Response: `OK <bytes>\r\n<yaml>\r\n`

YAML format: `---\n- tube1\n- tube2\n`

**list-tube-used** -- current tube for `put`
```
list-tube-used\r\n
```
Response: `USING <tube>\r\n`

**list-tubes-watched** -- tubes in the watch list
```
list-tubes-watched\r\n
```
Response: `OK <bytes>\r\n<yaml>\r\n`

#### Other Commands

**pause-tube** -- temporarily prevent reserving from a tube
```
pause-tube <name> <delay>\r\n
```
Response: `PAUSED\r\n` | `NOT_FOUND\r\n`

**quit** -- close the connection
```
quit\r\n
```
The server closes the connection immediately.

### Response Formats

Beanstalkd has three response shapes:

| Pattern | Example | Used by |
|---------|---------|---------|
| `<STATUS>\r\n` | `DELETED\r\n`, `NOT_FOUND\r\n` | delete, bury, touch, kick, release |
| `<STATUS> <value>\r\n` | `INSERTED 42\r\n`, `USING default\r\n` | put, use, watch, ignore, kick |
| `<STATUS> [<id>] <bytes>\r\n<data>\r\n` | `OK 256\r\n<yaml>\r\n`, `FOUND 42 128\r\n<data>\r\n` | stats, list-*, peek-*, reserve |

### Error Responses

| Error | Meaning |
|-------|---------|
| `OUT_OF_MEMORY\r\n` | Server cannot allocate memory for the job |
| `INTERNAL_ERROR\r\n` | Bug in the server; should be reported |
| `BAD_FORMAT\r\n` | Malformed command |
| `UNKNOWN_COMMAND\r\n` | Command not recognized |
| `EXPECTED_CRLF\r\n` | Job body was not followed by \r\n |
| `JOB_TOO_BIG\r\n` | Job body exceeds max-job-size |
| `DRAINING\r\n` | Server is shutting down; not accepting new jobs |
| `NOT_FOUND\r\n` | Job or tube does not exist |
| `NOT_IGNORED\r\n` | Cannot ignore the last watched tube |

---

## Known Limitations

**No TLS:** Beanstalkd does not support TLS natively. The worker uses `connect()` (plain TCP). For encrypted connections, use a TLS-terminating proxy (stunnel, HAProxy) in front and connect to its plaintext port.

**No authentication:** Beanstalkd has no built-in authentication. Rely on network-level access control (firewall rules, VPNs, private networks).

**Reserve does not delete:** The `/api/beanstalkd/reserve` endpoint reserves a job and returns its payload, but immediately closes the TCP connection. The server then auto-releases the job back to the ready queue after TTR seconds. To fully process a job (reserve -> process -> delete), use a persistent beanstalkd client.

**UTF-8 only:** Job payloads are decoded as UTF-8 via `TextDecoder`. Binary payloads (protobuf, msgpack, etc.) will be corrupted. Base64-encode binary data before putting.

**Max job size:** Beanstalkd defaults to `max-job-size` of 65,535 bytes. The server rejects larger jobs with `JOB_TOO_BIG`. Increase with the `-z` flag on the beanstalkd server.

**Single-command connections:** Each API call opens a fresh TCP connection. For sequential operations (use + put, watch + ignore + reserve), the handler chains commands within a single connection. But between API calls, connection state is lost.

**YAML parsing is minimal:** Stats YAML is parsed with a simple `key: value` regex. Nested YAML structures or non-standard formatting may not parse correctly.

---

## Practical Examples

### curl

```bash
# Stats probe
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"beanstalkd.example.com","port":11300}' | jq

# List all tubes
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"beanstalkd.example.com","command":"list-tubes"}' | jq .response

# Tube statistics
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"beanstalkd.example.com","command":"stats-tube emails"}' | jq .response

# Peek at next ready job
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"beanstalkd.example.com","command":"peek-ready"}' | jq

# Peek at a specific job by ID
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"beanstalkd.example.com","command":"peek 42"}' | jq

# Put a job into the "emails" tube (priority 1024, no delay, 120s TTR)
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/put \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"beanstalkd.example.com",
    "tube":"emails",
    "payload":"{\"to\":\"user@example.com\",\"subject\":\"Welcome\"}",
    "priority":1024,
    "delay":0,
    "ttr":120
  }' | jq

# Put a delayed job (30 second delay)
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/put \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"beanstalkd.example.com",
    "tube":"scheduled",
    "payload":"retry-webhook",
    "delay":30
  }' | jq

# Put a high-priority job (priority 0 = most urgent)
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/put \
  -H 'Content-Type: application/json' \
  -d '{
    "host":"beanstalkd.example.com",
    "tube":"alerts",
    "payload":"critical-notification",
    "priority":0
  }' | jq

# Reserve (dequeue) a job from "emails" tube
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/reserve \
  -H 'Content-Type: application/json' \
  -d '{"host":"beanstalkd.example.com","tube":"emails","reserveTimeout":5}' | jq

# Reserve from default tube
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/reserve \
  -H 'Content-Type: application/json' \
  -d '{"host":"beanstalkd.example.com"}' | jq
```

---

## Power User Tips

### Priority values

| Priority | Use case |
|----------|----------|
| 0 | Critical alerts, circuit breakers |
| 100 | High-priority user-facing tasks |
| 1024 | Default -- general purpose |
| 10000 | Background maintenance |
| 4294967295 | Lowest priority, "whenever" tasks |

### TTR strategy

- Set TTR to 2-3x the expected processing time.
- If a worker dies mid-processing, the job auto-releases after TTR.
- Workers should call `touch` periodically for long-running jobs (not available via Port of Call since connections are ephemeral).
- TTR minimum is 1 second. Setting it lower causes `BAD_FORMAT`.

### Tube naming conventions

Common patterns:
```
emails              -- task type
emails.high         -- with priority suffix
worker.resize.images -- dotted hierarchy
region.us-east.jobs  -- regional routing
```

Tube names are limited to 200 bytes and cannot contain whitespace.

### Inspecting buried jobs

```bash
# Check how many jobs are buried in a tube
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"beanstalkd.example.com","command":"stats-tube emails"}' \
  | jq -r '.response' | grep buried

# Peek at the next buried job
curl -s -X POST https://portofcall.ross.gg/api/beanstalkd/command \
  -H 'Content-Type: application/json' \
  -d '{"host":"beanstalkd.example.com","command":"peek-buried"}'
```

To actually kick buried jobs, use a persistent beanstalkd client (not available via Port of Call's whitelisted commands).

### Monitoring key stats fields

| Stat | Healthy value | Concern |
|------|--------------|---------|
| `current-jobs-ready` | Low, draining | Climbing = workers too slow |
| `current-jobs-buried` | 0 | >0 = failed jobs accumulating |
| `current-jobs-delayed` | Expected count | Unexpectedly high = backlog |
| `current-waiting` | >0 | 0 = no workers connected |
| `cmd-reserve` vs `cmd-delete` | Roughly equal | Big gap = workers failing |
| `job-timeouts` | Low | High = TTR too short or workers crashing |

---

## Resources

- [Beanstalkd protocol specification](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt)
- [Beanstalkd GitHub repository](https://github.com/beanstalkd/beanstalkd)
- [Beanstalkd FAQ](https://github.com/beanstalkd/beanstalkd/wiki/FAQ)
- [Beanstalk client libraries](https://github.com/beanstalkd/beanstalkd/wiki/Client-Libraries)
