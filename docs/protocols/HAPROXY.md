# HAProxy Runtime API Protocol Reference

## Overview

HAProxy is the world's most widely deployed open-source load balancer and reverse proxy. Its **Runtime API** (historically called the **Stats Socket** or **Management Socket**) exposes a text-based command interface over a Unix socket or a TCP socket for real-time monitoring and live configuration changes without reloading the process.

| Property | Value |
|---|---|
| **Transport** | TCP or Unix domain socket |
| **Default TCP Port** | 9999 (convention; user-configurable) |
| **Default Unix Socket** | `/var/run/haproxy/admin.sock` |
| **Framing** | Line-oriented; commands terminated with `\n` |
| **Encoding** | ASCII/UTF-8 |
| **Authentication** | OS-level (Unix socket permissions) or bind-level ACLs; no in-band password auth |
| **HAProxy Versions** | Runtime API available since HAProxy 1.4; significantly expanded in 1.5+ and 2.x |

## Protocol Mechanics

### Connection Modes

HAProxy's Runtime API operates in two modes:

#### One-Shot Mode (Default)

The client connects, sends exactly **one command** terminated by `\n`, reads the response until the server closes the connection, and disconnects. This is the default behavior when connecting to the stats socket.

```
Client                        HAProxy
  |--- "show info\n" ---------->|
  |<--- response lines ---------|
  |<--- [connection close] -----|
```

#### Interactive (Prompt) Mode

If the client sends `prompt` as the first command, HAProxy enters interactive mode. After each command's output, HAProxy writes a `\n> ` prompt and waits for the next command. The client sends `quit\n` to end the session.

```
Client                        HAProxy
  |--- "prompt\n" ------------->|
  |<--- "\n> " -----------------|
  |--- "show info\n" ---------->|
  |<--- response lines ---------|
  |<--- "\n> " -----------------|
  |--- "show stat\n" ---------->|
  |<--- response lines ---------|
  |<--- "\n> " -----------------|
  |--- "quit\n" --------------->|
  |<--- [connection close] -----|
```

**Important:** In prompt mode, the response delimiter is `\n> ` (newline + greater-than + space). Responses from a single command may contain blank lines, so you cannot use blank lines as a response terminator.

### Command Format

- Commands are single lines of ASCII text terminated by `\n` (LF, not CRLF).
- Leading and trailing whitespace is ignored.
- Commands are case-sensitive (lowercase).
- Unknown commands return an error string and, in one-shot mode, close the connection.
- Successful write commands typically return an empty response (zero bytes before the close or prompt).
- Error responses from write commands start with a descriptive error message string.

### Authentication and Access Control

The Runtime API does **not** use in-band password authentication. Access is controlled through:

1. **Unix socket permissions**: File ownership and mode bits on the socket file.
2. **Bind ACLs**: The `stats socket` directive supports `level` (user/operator/admin) and IP-based restrictions when exposed over TCP.
3. **Admin level**: Write commands (`set server`, `enable`, `disable`, etc.) require admin-level access.

HAProxy configuration example:
```
global
    stats socket /var/run/haproxy/admin.sock mode 660 level admin
    stats socket ipv4@0.0.0.0:9999 level admin
```

## Read Commands

### `show info`

Returns global process information as key-value pairs, one per line, in `Key: value` format.

**Example output:**
```
Name: HAProxy
Version: 2.8.3
Release_date: 2023/09/08
Nbthread: 4
Nbproc: 1
Process_num: 1
Pid: 12345
Uptime: 3d 12h45m32s
Uptime_sec: 304532
CurrConns: 42
CumConns: 1523894
MaxConn: 4096
Hard_maxconn: 4096
Node: lb-prod-01
Description:
```

Key fields:
- `Name` / `Version` / `Release_date`: HAProxy build info
- `Uptime` / `Uptime_sec`: Process uptime (human-readable and seconds)
- `Nbthread` / `Nbproc`: Thread and process counts
- `CurrConns` / `CumConns` / `MaxConn`: Connection counters
- `Pid` / `Node`: Process ID and node name
- `SslFrontendSessionReuse_pct`: TLS session reuse rate (when TLS is active)

### `show stat`

Returns CSV-formatted statistics for all frontends, backends, and servers.

**CSV format details:**
- The **first line** is a header starting with `# ` followed by comma-separated field names.
- Every line (including the header) ends with a **trailing comma** before the newline.
- Empty fields are represented as empty strings between commas.

**Example output:**
```
# pxname,svname,qcur,qmax,scur,smax,slim,stot,bin,bout,dreq,dresp,ereq,econ,eresp,wretr,wredis,status,weight,act,bck,chkfail,chkdown,lastchg,downtime,qlimit,pid,iid,sid,throttle,lbtot,tracked,type,rate,rate_lim,rate_max,check_status,check_code,check_duration,hrsp_1xx,hrsp_2xx,hrsp_3xx,hrsp_4xx,hrsp_5xx,hrsp_other,hanafail,req_rate,req_rate_max,req_tot,cli_abrt,srv_abrt,comp_in,comp_out,comp_byp,comp_rsp,lastsess,last_chk,last_agt,qtime,ctime,rtime,ttime,agent_status,agent_code,agent_duration,check_desc,agent_desc,check_rise,check_fall,check_health,agent_rise,agent_fall,agent_health,addr,cookie,mode,algo,conn_rate,conn_rate_max,conn_tot,intercepted,dcon,dses,wrew,connect,reuse,cache_lookups,cache_hits,srv_icur,src_ilim,qtime_max,ctime_max,rtime_max,ttime_max,eint,idle_conn_cur,safe_conn_cur,used_conn_cur,need_conn_est,uweight,agg_server_check_status,-,
http-frontend,FRONTEND,,,,1,2000,5432,1234567,9876543,,0,3,,,,,,OPEN,,,,,,,,,1,1,0,,,,0,0,0,2,,,,0,5400,20,12,0,0,,1,3,5432,,,0,0,0,0,,,,0,0,0,0,,,,,,,,,,,,http,,1,3,5432,0,0,0,0,,,0,0,,,,0,0,0,0,0,,,,,,,-,
```

**Important CSV fields:**

| Field | Description |
|---|---|
| `pxname` | Proxy name (frontend or backend name) |
| `svname` | Server name, or `FRONTEND`/`BACKEND` for aggregate rows |
| `status` | `UP`, `DOWN`, `MAINT`, `DRAIN`, `NOLB`, `OPEN` (frontends) |
| `scur` | Current sessions |
| `smax` | Max observed sessions |
| `stot` | Total cumulative sessions |
| `bin` | Bytes in |
| `bout` | Bytes out |
| `weight` | Server weight (backends/servers only) |
| `act` | Number of active servers (backend row) or 1/0 (server row) |
| `bck` | Number of backup servers |
| `chkfail` | Health check failures |
| `chkdown` | Number of UP->DOWN transitions |
| `lastchg` | Seconds since last status change |
| `downtime` | Total downtime in seconds |
| `type` | 0=frontend, 1=backend, 2=server, 3=listen |
| `rate` | Sessions per second |
| `check_status` | Last health check result (e.g., `L7OK`, `L4CON`, `L7STS`) |
| `check_code` | HTTP response code from health check |
| `hrsp_2xx` through `hrsp_5xx` | Response counts by HTTP status class |
| `lastsess` | Seconds since last session (-1 if never) |

### `show servers state`

Returns the state of all servers in all backends. The output has a version header and a column header, followed by one line per server.

**Example output:**
```
1
# be_id be_name srv_id srv_name srv_addr srv_op_state srv_admin_state srv_uweight srv_iweight srv_time_since_last_change srv_check_status srv_check_result srv_check_health srv_check_state srv_agent_state bk_f_forced_id srv_f_forced_id srv_fqdn srv_port srvrecord srv_use_ssl srv_check_port srv_check_addr srv_agent_addr srv_agent_port
4 web-backend 1 web1 10.0.0.1 2 0 100 100 304532 6 3 7 6 0 0 0 web1.example.com 8080 - 0 0 - - 0
4 web-backend 2 web2 10.0.0.2 2 0 100 100 304532 6 3 7 6 0 0 0 web2.example.com 8080 - 0 0 - - 0
```

**Server operational states** (`srv_op_state`):
- `0` = SRV_ST_STOPPED
- `1` = SRV_ST_STARTING
- `2` = SRV_ST_RUNNING
- `3` = SRV_ST_STOPPING

**Server admin states** (`srv_admin_state`, bitmask):
- `0x00` = normal
- `0x01` = FMAINT (forced maintenance via Runtime API)
- `0x02` = IMAINT (maintenance inherited from tracked server)
- `0x04` = CMAINT (maintenance from configuration)
- `0x08` = FDRAIN (forced drain)
- `0x10` = IDRAIN (inherited drain)

### `show backend`

Lists all backend proxy names, one per line. Useful for discovering available backends before querying specific server states.

**Example output:**
```
# name
web-backend
api-backend
static-backend
```

### `show sess`

Shows current active sessions. Can produce large output on busy systems.

**Example output:**
```
0x7f1234567890: proto=tcpv4 src=10.0.0.50:49832 fe=http-frontend be=web-backend srv=web1 ts=08 age=0s calls=3 ...
```

### `show pools`

Displays memory pool statistics including allocation counts and sizes. Useful for diagnosing memory issues.

### `help`

Lists all available commands on the connected HAProxy instance. The exact list depends on the HAProxy version and compiled features.

## Write Commands

Write commands require admin-level access on the stats socket. They return an empty response on success or an error message string on failure.

### `set server <backend>/<server> state <ready|drain|maint>`

Changes the administrative state of a server:
- `ready`: Normal operation; server accepts new connections.
- `drain`: Soft stop; existing sessions continue but no new connections are routed.
- `maint`: Maintenance mode; server is marked DOWN and removed from load balancing.

```
set server web-backend/web1 state maint
```

### `set server <backend>/<server> weight <value>`

Changes the server's weight for load balancing. The value can be:
- An absolute integer (0-256)
- A percentage of the initial weight, e.g., `50%`

A weight of `0` effectively removes the server from load balancing without marking it DOWN.

```
set server web-backend/web1 weight 150
set server web-backend/web1 weight 50%
```

**Note:** The older `set weight <backend>/<server> <value>` syntax is deprecated but still accepted by most HAProxy versions.

### `set server <backend>/<server> addr <ip> port <port>`

Changes the server's destination IP address and port at runtime. This is useful for DNS-based service discovery or blue-green deployments.

```
set server web-backend/web1 addr 10.0.0.3 port 8080
```

### `enable server <backend>/<server>`

Resumes a server from maintenance mode. Equivalent to `set server ... state ready` but also clears forced-maintenance flags.

```
enable server web-backend/web1
```

### `disable server <backend>/<server>`

Puts a server into forced maintenance mode. Equivalent to `set server ... state maint`.

```
disable server web-backend/web1
```

## Port of Call API Endpoints

The following HTTP API endpoints proxy commands to a remote HAProxy Runtime API over TCP.

### Read-Only Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `POST /api/haproxy/info` | POST | Sends `show info`, returns parsed key-value pairs |
| `POST /api/haproxy/stat` | POST | Sends `show stat`, returns parsed CSV rows as JSON |
| `POST /api/haproxy/command` | POST | Sends any allowlisted read-only command |

### Write Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `POST /api/haproxy/weight` | POST | `set server <bk>/<sv> weight <value>` |
| `POST /api/haproxy/state` | POST | `set server <bk>/<sv> state <ready\|drain\|maint>` |
| `POST /api/haproxy/addr` | POST | `set server <bk>/<sv> addr <ip> port <port>` |
| `POST /api/haproxy/enable` | POST | `enable server <bk>/<sv>` |
| `POST /api/haproxy/disable` | POST | `disable server <bk>/<sv>` |

### Common Request Body

All endpoints accept JSON with these fields:

```json
{
  "host": "haproxy.example.com",
  "port": 9999,
  "timeout": 10000
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `host` | string | (required) | HAProxy server hostname or IP |
| `port` | number | 9999 | TCP port of the stats socket |
| `timeout` | number | 10000 | Connection timeout in milliseconds |

Write endpoints add backend/server targeting:

```json
{
  "host": "haproxy.example.com",
  "port": 9999,
  "backend": "web-backend",
  "server": "web1",
  "weight": 100
}
```

### Read-Only Command Allowlist

The `/api/haproxy/command` endpoint only permits commands starting with:
- `show` (with or without subcommand)
- `help`
- `quit`

Embedded newlines in the command string are stripped to prevent command injection. All other commands are rejected with HTTP 403.

## Security Considerations

1. **No wire-level auth**: The HAProxy Runtime API has no built-in password-based authentication. Access control relies on OS-level socket permissions (for Unix sockets) or IP-based ACLs in the `stats socket bind` directive (for TCP sockets).

2. **Admin vs. read-only access**: HAProxy supports three access levels (`user`, `operator`, `admin`) configured on the stats socket. Only `admin` level can execute write commands.

3. **Command injection**: Since HAProxy processes one command per line, embedded newlines could theoretically smuggle additional commands. Port of Call sanitizes command input by stripping `\r` and `\n` characters.

4. **Network exposure**: Exposing the Runtime API over TCP (rather than Unix socket) should be done with caution. Use firewall rules or HAProxy's own bind ACLs to restrict access.

## HAProxy Configuration for Runtime API

### Minimal TCP socket setup

```
global
    stats socket ipv4@0.0.0.0:9999 level admin
    stats timeout 30s
```

### Unix socket with admin access

```
global
    stats socket /var/run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
```

### TCP socket with restricted access

```
global
    stats socket ipv4@127.0.0.1:9999 level operator
    stats timeout 10s
```

## Troubleshooting

| Symptom | Likely Cause |
|---|---|
| Empty response | Stats socket not configured, or port blocked by firewall |
| `Unknown command` error | Typo in command name, or command not available in this HAProxy version |
| Connection timeout | Host unreachable, wrong port, or firewall dropping packets |
| Write command returns error | Insufficient access level (need admin), or server/backend name wrong |
| CSV parsing returns empty rows | Version mismatch in CSV field count; check HAProxy version |
| Prompt (`> `) appears in output | HAProxy is in interactive mode; this is handled by the parser |

## References

- [HAProxy Management Guide](https://www.haproxy.org/download/2.9/doc/management.txt) -- Canonical protocol documentation
- [HAProxy Configuration Manual](https://www.haproxy.org/download/2.9/doc/configuration.txt) -- Stats socket configuration
- [HAProxy Runtime API](https://www.haproxy.com/blog/dynamic-configuration-haproxy-runtime-api) -- Overview of Runtime API capabilities
- [HAProxy CSV Stats Fields](https://www.haproxy.org/download/2.9/doc/management.txt#9.1) -- Complete list of CSV stat columns
