# MK Livestatus Protocol — Power User Guide

**Protocol:** MK Livestatus (Livestatus Query Language)
**Default Port:** 6557 (TCP), Unix socket at `~/tmp/run/live`
**Transport:** TCP or Unix socket
**Encryption:** Optional TLS/SSL when TCP-enabled
**Use Case:** Real-time monitoring data queries for Nagios, Checkmk, Naemon, Icinga 2, Shinken
**RFC/Spec:** [Checkmk Documentation](https://docs.checkmk.com/latest/en/livestatus.html)

---

## What is Livestatus?

MK Livestatus is a text-based query protocol for monitoring systems, originally developed by Mathias Kettner for Nagios (now part of Checkmk). It provides a SQL-like query language to retrieve real-time monitoring data without requiring direct database access or parsing status files.

**Supported Systems:**
- Checkmk (native)
- Naemon
- Icinga 2
- Shinken
- OP5 Monitor
- Thruk monitoring dashboards

**Key Advantages:**
- Fast: Direct access to in-memory monitoring state
- Efficient: No file I/O or database overhead
- Flexible: SQL-like filtering and column selection
- Live: Real-time data (no polling lag)

---

## Protocol Basics

### Request Format

Livestatus uses a line-based protocol where commands and headers are separated by newlines (`\n`). All inputs are **case-sensitive**.

```
GET <table>
<Header>: <value>
<Header>: <value>

```

**Critical:** The query MUST end with exactly one blank line (`\n\n`). This signals the end of the request.

### Response Format (with `ResponseHeader: fixed16`)

When `ResponseHeader: fixed16` is set, the server returns a 16-byte status header followed by the response body:

```
<3-digit status> <11-char padded length>\n<body>
```

Example:
```
200          123
[123 bytes of JSON data]
```

**Status Header Breakdown:**
- Bytes 0-2: Three-digit status code (e.g., `200`)
- Byte 3: Space
- Bytes 4-14: Content length (right-padded with spaces to 11 chars)
- Byte 15: Newline (`\n`)
- Bytes 16+: Response body (exactly `contentLength` bytes)

---

## Core Commands

### GET — Query Data

Retrieves data from a Livestatus table.

**Syntax:**
```
GET <table>
Columns: col1 col2 col3
Filter: column operator value
Limit: N
OutputFormat: json
ResponseHeader: fixed16

```

**Available Tables:**
- `status` — Global monitoring engine status (version, uptime, connections)
- `hosts` — All monitored hosts with state, address, check output
- `services` — All monitored services with state, output, performance data
- `contacts` — Notification contacts
- `contactgroups` — Contact groups
- `commands` — Available check/notification commands
- `columns` — Meta-table listing all available columns per table
- `timeperiods` — Configured time periods
- `hostgroups` — Host groups
- `servicegroups` — Service groups
- `downtimes` — Scheduled downtimes
- `comments` — Host/service comments
- `log` — Historical monitoring log entries
- `statehist` — State history (requires Checkmk or compatible system)

**Example: Query monitoring engine status**
```
GET status
Columns: program_version livestatus_version num_hosts num_services
OutputFormat: json
ResponseHeader: fixed16

```

**Response (with fixed16):**
```
200          234
[["Check_MK 2.3.0", "1.5.0", 42, 156]]
```

### COMMAND — Execute Monitoring Commands

Sends external commands to the monitoring core (e.g., acknowledge problems, schedule downtimes, submit check results).

**Syntax:**
```
COMMAND [<unix_timestamp>] COMMAND_NAME;arg1;arg2;...
```

**Critical:** Commands with a missing timestamp will be discarded silently (no error).

**Common Commands:**
- `ACKNOWLEDGE_HOST_PROBLEM;hostname;sticky;notify;author;comment`
- `ACKNOWLEDGE_SVC_PROBLEM;hostname;service;sticky;notify;persistent;author;comment`
- `SCHEDULE_HOST_DOWNTIME;hostname;start_time;end_time;fixed;trigger_id;duration;author;comment`
- `SCHEDULE_SVC_DOWNTIME;hostname;service;start_time;end_time;fixed;trigger_id;duration;author;comment`
- `PROCESS_SERVICE_CHECK_RESULT;hostname;service;status;output`
- `SCHEDULE_HOST_CHECK;hostname;check_time`
- `ENABLE_HOST_NOTIFICATIONS;hostname`
- `DISABLE_SVC_NOTIFICATIONS;hostname;service`

**Example: Acknowledge a service problem**
```
COMMAND [1709582400] ACKNOWLEDGE_SVC_PROBLEM;web01;HTTP;1;1;0;admin;Investigating 502 errors
```

**Arguments Explained:**
- `web01` — hostname
- `HTTP` — service description
- `1` — sticky (1 = ack persists across state changes)
- `1` — notify (1 = send notification)
- `0` — persistent (0 = ack removed on OK)
- `admin` — author
- `Investigating 502 errors` — comment

**Note:** COMMAND writes do not return a response. The connection is closed immediately after sending.

---

## Headers (Query Modifiers)

### Columns

Select specific columns to return (like SQL `SELECT`).

**Syntax:**
```
Columns: col1 col2 col3
```

**Example:**
```
GET hosts
Columns: name state address plugin_output
```

**Default:** If omitted, all columns are returned.

### Filter

Restrict results to rows matching specific conditions (like SQL `WHERE`).

**Syntax:**
```
Filter: column operator value
```

**Operators:**
- `=` — Exact match
- `!=` — Not equal
- `<`, `>`, `<=`, `>=` — Numeric/string comparison
- `~` — Regex match (case-sensitive)
- `~~` — Regex match (case-insensitive)
- `>=` — List contains element (for list columns)
- `=` — List is empty (when value is empty)

**Logical Operators:**
- Multiple `Filter:` lines default to AND
- `Or: N` — Combine last N filters with OR
- `And: N` — Combine last N filters with AND (explicit)
- `Negate:` — Invert the next filter

**Example: Find all DOWN hosts**
```
GET hosts
Columns: name state plugin_output
Filter: state = 1
```

**Example: Find hosts starting with "web" or "app"**
```
GET hosts
Columns: name
Filter: name ~ ^web
Filter: name ~ ^app
Or: 2
```

**Example: Find services in WARNING or CRITICAL state**
```
GET services
Filter: state = 1
Filter: state = 2
Or: 2
```

### Stats

Retrieve aggregated statistics instead of individual rows (like SQL `GROUP BY` + `COUNT`).

**Syntax:**
```
Stats: operation column
```

**Operations:**
- `sum`, `min`, `max`, `avg`, `std` — Numeric aggregation
- `count` — Count matching rows

**Example: Count hosts by state**
```
GET hosts
Stats: state = 0
Stats: state = 1
Stats: state = 2
```

**Response:**
```json
[[120, 3, 1]]
```
(120 UP, 3 DOWN, 1 UNREACHABLE)

### Limit

Restrict number of output rows (like SQL `LIMIT`).

**Syntax:**
```
Limit: N
```

**Example:**
```
GET services
Columns: host_name description state
Limit: 50
```

### OrderBy

Sort results by one or more columns.

**Syntax:**
```
OrderBy: column asc
OrderBy: column desc
```

**Example: Sort services by state (critical first)**
```
GET services
Columns: host_name description state
OrderBy: state desc
Limit: 10
```

### OutputFormat

Specify response format.

**Syntax:**
```
OutputFormat: format
```

**Formats:**
- `json` — JSON array (recommended for programmatic access)
- `python` — Python literal (deprecated, use `python3`)
- `python3` — Python 3 literal
- `csv` — CSV with configurable separators
- Default: CSV with semicolon separators

**Example:**
```
GET hosts
OutputFormat: json
```

### ResponseHeader

Include status code and content length in response.

**Syntax:**
```
ResponseHeader: fixed16
```

**Format:**
```
<3-digit status> <11-char padded length>\n
```

**Status Codes:**
- `200` — OK
- `400` — Bad request (invalid query syntax)
- `404` — Table not found
- `413` — Response too large
- `451` — Incomplete request
- `452` — Completely invalid request

**Critical:** Without `ResponseHeader: fixed16`, the server may not return a status code, making error handling difficult.

### KeepAlive

Keep connection open for multiple sequential queries (reduces connection overhead).

**Syntax:**
```
KeepAlive: on
```

**Usage:**
1. Send first query with `KeepAlive: on`
2. Server keeps socket open after response
3. Send next query (must also include `KeepAlive: on`)
4. Send final query with `KeepAlive: off` to close connection

**Example:**
```
GET hosts
Columns: name
KeepAlive: on
ResponseHeader: fixed16

GET services
Columns: host_name description
KeepAlive: off
ResponseHeader: fixed16

```

### AuthUser

Filter results by user authorization (requires contact-based authorization in monitoring system).

**Syntax:**
```
AuthUser: username
```

**Effect:** Returns only hosts/services the specified user is authorized to see.

**Example:**
```
GET services
AuthUser: john
```

**Not Supported On:** `columns`, `commands`, `contacts`, `contactgroups`, `status`, `timeperiods`, `eventconsolerules`, `eventconsolestatus`

### ColumnHeaders

Include column names in CSV output.

**Syntax:**
```
ColumnHeaders: on
```

**Example:**
```
GET hosts
Columns: name state
OutputFormat: csv
ColumnHeaders: on

```

**Response:**
```
name;state
web01;0
db01;0
```

### Localtime

Adjust for timezone differences in time-based columns.

**Syntax:**
```
Localtime: <unix_timestamp>
```

**Example:**
```
GET services
Localtime: 1709582400
```

### Timelimit

Set maximum query execution time (in seconds).

**Syntax:**
```
Timelimit: N
```

**Example:**
```
GET log
Filter: time >= 1709500000
Timelimit: 30
```

### Separators

Customize CSV separators (for `OutputFormat: csv`).

**Syntax:**
```
Separators: <line> <column> <list> <host/service>
```

**Values:** ASCII decimal codes (e.g., `10` = newline, `59` = semicolon)

**Default:** `10 59 44 124` (newline, semicolon, comma, pipe)

**Example (use tabs):**
```
GET hosts
OutputFormat: csv
Separators: 10 9 44 124
```

---

## Common Tables and Columns

### status Table

Global monitoring engine status (single row).

**Key Columns:**
- `program_version` — Monitoring core version
- `program_start` — Unix timestamp of core start
- `nagios_pid` — Process ID of monitoring daemon
- `num_hosts` — Total hosts configured
- `num_services` — Total services configured
- `connections` — Total Livestatus connections since start
- `requests` — Total Livestatus queries since start
- `livestatus_version` — Livestatus module version
- `accept_passive_host_checks` — Whether passive checks are enabled
- `enable_notifications` — Global notification status

**Example:**
```
GET status
Columns: program_version livestatus_version num_hosts num_services
OutputFormat: json
ResponseHeader: fixed16

```

### hosts Table

All monitored hosts.

**Key Columns:**
- `name` — Hostname (unique identifier)
- `state` — Host state (0=UP, 1=DOWN, 2=UNREACHABLE)
- `state_type` — State type (0=SOFT, 1=HARD)
- `address` — IP address or FQDN
- `plugin_output` — Last check output (e.g., "PING OK")
- `last_check` — Unix timestamp of last check
- `next_check` — Unix timestamp of next scheduled check
- `acknowledged` — Whether problem is acknowledged (0/1)
- `notifications_enabled` — Whether notifications are enabled (0/1)
- `num_services` — Number of services on this host
- `num_services_ok`, `num_services_warn`, `num_services_crit`, `num_services_unknown`

**Example: Find all DOWN hosts**
```
GET hosts
Columns: name state plugin_output last_check
Filter: state = 1
OutputFormat: json
ResponseHeader: fixed16

```

### services Table

All monitored services.

**Key Columns:**
- `host_name` — Hostname (foreign key to hosts)
- `description` — Service description (e.g., "HTTP", "Disk /var")
- `state` — Service state (0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN)
- `state_type` — State type (0=SOFT, 1=HARD)
- `plugin_output` — Last check output (e.g., "HTTP OK - 200ms")
- `long_plugin_output` — Extended check output (multi-line)
- `perf_data` — Performance data (e.g., "time=200ms;;;0")
- `last_check` — Unix timestamp of last check
- `next_check` — Unix timestamp of next scheduled check
- `acknowledged` — Whether problem is acknowledged (0/1)
- `notifications_enabled` — Whether notifications are enabled (0/1)
- `current_attempt` — Current check attempt number
- `max_check_attempts` — Max attempts before HARD state

**Example: Find all CRITICAL services**
```
GET services
Columns: host_name description state plugin_output
Filter: state = 2
OutputFormat: json
ResponseHeader: fixed16

```

### log Table

Historical monitoring events (host/service state changes, notifications, downtimes).

**Key Columns:**
- `time` — Unix timestamp of event
- `class` — Event class (0=alert, 1=state change, 2=notification, 3=downtime, etc.)
- `type` — Event type string (e.g., "HOST ALERT", "SERVICE NOTIFICATION")
- `message` — Full log message
- `host_name` — Affected hostname (if applicable)
- `service_description` — Affected service (if applicable)
- `state` — State after event (0/1/2/3)
- `contact_name` — Contact notified (for notifications)

**Example: Find all host DOWN alerts in last hour**
```
GET log
Columns: time host_name type message
Filter: time >= 1709582400
Filter: class = 0
Filter: type ~ HOST ALERT
Filter: message ~ DOWN
OutputFormat: json
ResponseHeader: fixed16

```

### columns Table

Meta-table listing all available columns for each table (useful for discovery).

**Key Columns:**
- `table` — Table name (e.g., "hosts", "services")
- `name` — Column name
- `type` — Data type (int, float, string, list, time)
- `description` — Human-readable description

**Example: List all host table columns**
```
GET columns
Columns: name type description
Filter: table = hosts
OutputFormat: json
ResponseHeader: fixed16

```

---

## Advanced Query Patterns

### Complex Filters with Logical Operators

**Find hosts in DOWN or UNREACHABLE state:**
```
GET hosts
Columns: name state plugin_output
Filter: state = 1
Filter: state = 2
Or: 2
OutputFormat: json
ResponseHeader: fixed16

```

**Find acknowledged CRITICAL services:**
```
GET services
Columns: host_name description state acknowledged
Filter: state = 2
Filter: acknowledged = 1
OutputFormat: json
ResponseHeader: fixed16

```

**Find services NOT in OK state:**
```
GET services
Columns: host_name description state
Filter: state = 0
Negate:
OutputFormat: json
ResponseHeader: fixed16

```

### Aggregation Queries (Stats)

**Count services by state:**
```
GET services
Stats: state = 0
Stats: state = 1
Stats: state = 2
Stats: state = 3
OutputFormat: json
ResponseHeader: fixed16

```

**Response:**
```json
[[1234, 56, 12, 3]]
```
(1234 OK, 56 WARNING, 12 CRITICAL, 3 UNKNOWN)

**Average check execution time:**
```
GET services
Stats: avg execution_time
OutputFormat: json
ResponseHeader: fixed16

```

### Time-Based Queries

**Find services checked in last 5 minutes:**
```
GET services
Columns: host_name description last_check
Filter: last_check >= 1709582100
OutputFormat: json
ResponseHeader: fixed16

```

**Find downtimes starting in next hour:**
```
GET downtimes
Columns: host_name service_description start_time end_time author comment
Filter: start_time >= 1709582400
Filter: start_time < 1709586000
OutputFormat: json
ResponseHeader: fixed16

```

### Sorting and Pagination

**Top 10 slowest checks:**
```
GET services
Columns: host_name description execution_time
OrderBy: execution_time desc
Limit: 10
OutputFormat: json
ResponseHeader: fixed16

```

**Next 10 results (pagination workaround):**
Livestatus doesn't have native `OFFSET` support. Workaround:
1. Use `OrderBy` with a unique column (e.g., `host_name description`)
2. Add filter for last seen value: `Filter: host_name > last_hostname`

---

## Performance Best Practices

1. **Always specify `Columns:`** — Reduces payload size and parsing overhead
2. **Use `Limit:`** — Prevents massive responses that can timeout
3. **Add `ResponseHeader: fixed16`** — Enables proper error handling
4. **Use specific filters** — `Filter: host_name = web01` is faster than `Filter: host_name ~ web`
5. **Leverage `Stats` for counts** — Faster than fetching all rows and counting client-side
6. **Use `KeepAlive: on`** — For multiple sequential queries (reduces connection overhead)
7. **Set `Timelimit:`** — Prevents runaway queries from blocking the server
8. **Use `AuthUser:`** — Only when necessary (adds authorization overhead)

---

## Security Considerations

### Network Exposure

**Default:** Unix socket at `~/tmp/run/live` (local access only)

**TCP Access:** Typically port 6557 with optional TLS/SSL encryption.

**Recommendation:**
- Use Unix socket for local queries
- Enable TLS/SSL for TCP access
- Firewall port 6557 to trusted IPs only
- Consider SSH tunneling: `ssh -L 6557:localhost:6557 monitoring-server`

### Authentication

Livestatus itself has no built-in authentication. Access control options:

1. **Unix socket permissions** — Restrict filesystem access (e.g., `chmod 660 /var/lib/nagios/rw/live`)
2. **Firewall rules** — Limit TCP access by IP
3. **TLS client certificates** — Require valid cert for TCP connections
4. **xinetd/stunnel wrapper** — Add authentication layer
5. **AuthUser header** — Filter results by contact authorization (requires configured contacts in monitoring system)

### Command Injection

**Risk:** Malicious users can inject Nagios external commands if Livestatus socket is writable.

**Mitigation:**
- Restrict Unix socket write permissions
- Validate command arguments server-side (if building a web interface)
- Log all COMMAND writes for auditing

---

## Troubleshooting

### Empty Response

**Symptom:** No data returned, connection closes immediately

**Causes:**
1. Missing blank line terminator (`\n\n`)
2. Wrong port (check `6557` vs Unix socket)
3. Firewall blocking connection
4. Livestatus module not loaded

**Solution:**
```bash
# Check if Livestatus is listening
netstat -tln | grep 6557

# Test basic query
echo -e "GET status\nOutputFormat: json\nResponseHeader: fixed16\n" | nc localhost 6557
```

### Status 404 (Table Not Found)

**Symptom:** `404` status code with error message

**Cause:** Invalid table name (case-sensitive!)

**Valid Tables:**
- `status`, `hosts`, `services`, `contacts`, `contactgroups`, `commands`, `columns`, `timeperiods`, `hostgroups`, `servicegroups`, `downtimes`, `comments`, `log`, `statehist`

### Status 400 (Bad Request)

**Symptom:** `400` status code with error message

**Causes:**
1. Invalid filter syntax: `Filter: state > abc` (use numeric value)
2. Invalid column name: `Columns: invalid_column`
3. Malformed header: `Filter state = 0` (missing colon)

**Solution:**
```
GET columns
Columns: name
Filter: table = hosts
OutputFormat: json
ResponseHeader: fixed16

```
(Lists all valid host columns)

### Status 451 (Incomplete Request)

**Symptom:** `451` status code

**Cause:** Missing blank line terminator

**Fix:**
```
GET status\n
OutputFormat: json\n
ResponseHeader: fixed16\n
\n   <-- This blank line is REQUIRED
```

### Timeout on Large Queries

**Symptom:** Connection hangs, no response

**Causes:**
1. No `Limit:` on large table (e.g., `log`)
2. Complex regex filters on millions of rows
3. No `Timelimit:` set

**Solution:**
```
GET log
Columns: time message
Filter: time >= 1709500000
Limit: 1000
Timelimit: 30
OutputFormat: json
ResponseHeader: fixed16

```

### Connection Refused

**Symptom:** `ECONNREFUSED` error

**Causes:**
1. Livestatus not enabled in monitoring core
2. Wrong port (default is `6557`)
3. Firewall blocking access
4. Using TCP when only Unix socket is enabled

**Solution (Checkmk):**
```bash
# Check if Livestatus is enabled
omd config show LIVESTATUS_TCP

# Enable TCP access
omd config set LIVESTATUS_TCP on
omd restart
```

### Invalid fixed16 Header

**Symptom:** `status: 0` with raw text response

**Causes:**
1. Server doesn't support `ResponseHeader: fixed16` (old Livestatus version)
2. Wrong protocol/port (e.g., connected to SSH instead of Livestatus)

**Solution:**
- Upgrade Livestatus module
- Verify correct port: `netstat -tln | grep 6557`
- Test without `ResponseHeader:` (fallback to raw output)

---

## Implementation Notes (Port of Call Worker)

### Endpoints

**POST /api/livestatus/status**
- Query monitoring engine status
- Returns: `program_version`, `livestatus_version`, `num_hosts`, `num_services`, etc.

**POST /api/livestatus/hosts**
- List monitored hosts (limit 50)
- Returns: `name`, `state`, `address`, `plugin_output`, `last_check`, `num_services`

**POST /api/livestatus/services**
- Query services table with optional filters
- Returns: `host_name`, `description`, `state`, `plugin_output`, etc.

**POST /api/livestatus/query**
- Send arbitrary LQL query
- Automatically adds `OutputFormat: json` and `ResponseHeader: fixed16` if missing

**POST /api/livestatus/command**
- Execute Nagios external command
- Sends `COMMAND [timestamp] COMMAND_NAME;args`

### Request Body

```json
{
  "host": "monitoring.example.com",
  "port": 6557,
  "timeout": 10000,
  "query": "GET hosts\nColumns: name state\n",
  "command": "ACKNOWLEDGE_SVC_PROBLEM",
  "args": ["web01", "HTTP", "1", "1", "0", "admin", "ack"]
}
```

### Response Body

**Success:**
```json
{
  "success": true,
  "host": "monitoring.example.com",
  "port": 6557,
  "statusCode": 200,
  "data": [["web01", 0], ["db01", 0]],
  "rtt": 45
}
```

**Error:**
```json
{
  "success": false,
  "host": "monitoring.example.com",
  "port": 6557,
  "statusCode": 404,
  "error": "Table 'invalid' does not exist",
  "rtt": 12
}
```

### Fixed16 Header Parsing

The implementation uses a `BufferedReader` to read exactly 16 bytes for the status header, then reads exactly `contentLength` bytes for the body. This prevents:
- Premature connection close (waiting for more data)
- Buffer overrun (reading too much)
- Data corruption (mixing header and body)

**Header Format:**
```
Byte 0-2:   Status code (e.g., "200")
Byte 3:     Space
Byte 4-14:  Content length, right-padded with spaces (e.g., "        123")
Byte 15:    Newline (\n)
```

**Example:**
```
"200          123\n"
 ^^^          ^^^
 status       length
```

### Error Handling

**Status 0:** Server did not return a valid `fixed16` header (protocol mismatch or old Livestatus version)

**Status 200:** Success

**Status 400-599:** Livestatus error (check `error` field for details)

---

## References

- [Checkmk Livestatus Documentation](https://docs.checkmk.com/latest/en/livestatus.html) — Official protocol specification
- [Nagios External Commands](https://assets.nagios.com/downloads/nagioscore/docs/nagioscore/3/en/extcommands.html) — COMMAND syntax reference
- [Naemon Livestatus](https://www.naemon.io/documentation/usersguide/livestatus.html) — Naemon implementation notes
- [Thruk Monitoring](https://www.thruk.org/) — Web dashboard using Livestatus

---

## Quick Reference

### Query Template
```
GET <table>
Columns: col1 col2
Filter: column operator value
Limit: N
OutputFormat: json
ResponseHeader: fixed16

```

### Command Template
```
COMMAND [<timestamp>] COMMAND_NAME;arg1;arg2
```

### Common Queries

**Check Livestatus version:**
```
GET status
Columns: livestatus_version
OutputFormat: json
ResponseHeader: fixed16

```

**Count hosts by state:**
```
GET hosts
Stats: state = 0
Stats: state = 1
Stats: state = 2
OutputFormat: json
ResponseHeader: fixed16

```

**Find unacknowledged CRITICAL services:**
```
GET services
Columns: host_name description plugin_output
Filter: state = 2
Filter: acknowledged = 0
OutputFormat: json
ResponseHeader: fixed16

```

**List recent alerts:**
```
GET log
Columns: time host_name service_description message
Filter: time >= 1709582400
Filter: class = 0
Limit: 100
OrderBy: time desc
OutputFormat: json
ResponseHeader: fixed16

```

**Acknowledge host problem:**
```
COMMAND [1709582400] ACKNOWLEDGE_HOST_PROBLEM;web01;1;1;0;admin;Investigating
```

**Schedule service downtime (1 hour):**
```
COMMAND [1709582400] SCHEDULE_SVC_DOWNTIME;web01;HTTP;1709582400;1709586000;1;0;3600;admin;Maintenance window
```
