# EPMD (Erlang Port Mapper Daemon) -- Port of Call Reference

**Spec:** [Erlang EPMD Protocol](https://www.erlang.org/doc/apps/erts/erl_epmd) (part of Erlang/OTP ERTS)
**Default port:** 4369
**Source:** `src/worker/epmd.ts`

---

## Overview

EPMD is a name server for Erlang/OTP distributed systems. Every Erlang VM that
participates in distributed computing registers itself with the local EPMD
instance, which maps the node's "alive name" to the TCP port the node uses for
inter-node communication (the "distribution port").

Port of Call implements two EPMD client operations:

1. **NAMES_REQ (tag 110)** -- List all registered Erlang nodes on a host
2. **PORT_PLEASE2_REQ (tag 122)** -- Look up a specific node's distribution port

Both operations open a TCP connection, send the request, read the full response,
and close the connection. EPMD closes the connection from its side after
responding.

---

## Endpoints

### `POST /api/epmd/names` -- List registered nodes

Sends a NAMES_REQ and returns every Erlang node currently registered with EPMD
on the target host.

**Request:**
```json
{ "host": "rabbitmq.example.com", "port": 4369, "timeout": 10000 }
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | Hostname or IP of the target EPMD instance |
| `port` | `4369` | EPMD listen port; almost always 4369 |
| `timeout` | `10000` | ms; covers both TCP connect and read |

**Wire sequence:**
```
TCP connect to host:4369
--> [0x00, 0x01, 0x6E]           (Length=1, Tag=110/NAMES_REQ)
<-- [EPMDPort:32be, NodeInfo...]  (no length prefix; EPMD closes after sending)
TCP close (by EPMD)
```

**Response:**
```json
{
  "success": true,
  "host": "rabbitmq.example.com",
  "port": 4369,
  "epmdPort": 4369,
  "nodes": [
    { "name": "rabbit", "port": 25672 },
    { "name": "couchdb", "port": 29345 }
  ],
  "rawResponse": "name rabbit at port 25672\nname couchdb at port 29345",
  "rtt": 14
}
```

| Field | Notes |
|-------|-------|
| `epmdPort` | The 32-bit port number EPMD reports for itself (first 4 bytes of the response). Almost always 4369. |
| `nodes` | Array of `{name, port}` pairs parsed from the text portion of the response. Empty array if no nodes are registered. |
| `rawResponse` | The raw text lines from EPMD, trimmed. Format per line: `name <name> at port <port>` |
| `rtt` | Round-trip time covering TCP connect + request + full response read, in ms |

The NAMES response has no length framing. EPMD writes the 4-byte port number
followed by one line per registered node (`name <name> at port <port>\n`), then
closes the TCP connection. The implementation reads until the stream ends.

Response cap: 64 KB (safety limit on total bytes read).

---

### `POST /api/epmd/port` -- Look up a specific node

Sends a PORT_PLEASE2_REQ for a named Erlang node and returns its distribution
port and metadata.

**Request:**
```json
{
  "host": "rabbitmq.example.com",
  "port": 4369,
  "nodeName": "rabbit",
  "timeout": 10000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | **required** | |
| `nodeName` | **required** | The "alive name" -- the short name before the `@` (e.g., `rabbit` from `rabbit@hostname`) |
| `port` | `4369` | |
| `timeout` | `10000` | ms |

**Wire sequence:**
```
TCP connect to host:4369
--> [Length:16be, 0x7A, NodeName...]   (Tag=122/PORT_PLEASE2_REQ)
<-- PORT2_RESP                          (no length prefix; EPMD closes after)
TCP close (by EPMD)
```

**Response (node found):**
```json
{
  "success": true,
  "host": "rabbitmq.example.com",
  "port": 4369,
  "nodeName": "rabbit",
  "found": true,
  "nodePort": 25672,
  "nodeType": "normal",
  "protocol": 0,
  "highestVersion": 6,
  "lowestVersion": 5,
  "extra": "",
  "rtt": 11
}
```

**Response (node not found):**
```json
{
  "success": true,
  "host": "rabbitmq.example.com",
  "port": 4369,
  "nodeName": "nonexistent",
  "found": false,
  "rtt": 9
}
```

| Field | Notes |
|-------|-------|
| `found` | `true` if the node is registered, `false` otherwise |
| `nodePort` | The TCP port the Erlang node listens on for distribution traffic |
| `nodeType` | `"normal"` (77/0x4D) for standard Erlang nodes, `"hidden"` (72/0x48) for hidden nodes. Hidden nodes do not appear in `nodes()` on other Erlang nodes |
| `protocol` | Always `0` (TCP/IPv4) in practice |
| `highestVersion` | Highest distribution protocol version the node supports. `5` = R6B through OTP 22, `6` = OTP 23+ |
| `lowestVersion` | Lowest distribution protocol version the node accepts |
| `extra` | Opaque data registered by the node (usually empty) |

Response cap: 4 KB (safety limit).

---

## EPMD Binary Protocol Reference

All values are big-endian unless stated otherwise. There is no TLS variant of EPMD.

### Request framing

Every request sent to EPMD is prefixed with a 2-byte big-endian length field
that counts the remaining bytes (tag + data):

```
[Length:16be] [Tag:8] [Data...]
```

### Response framing

EPMD responses have **no length prefix**. EPMD writes the response bytes and
then closes the TCP connection. The client must read until EOF.

### NAMES_REQ (tag 110 / 0x6E / 'n')

**Request:** 3 bytes total
```
Offset  Size  Field
0       2     Length = 0x0001
2       1     Tag = 110
```

**Response:** variable length, no framing
```
Offset  Size    Field
0       4       EPMDPortNo (32-bit BE unsigned) -- the port EPMD itself is bound to
4       varies  Text lines: "name <Name> at port <Port>\n" repeated, one per node
```

If no nodes are registered, the text portion is empty (response is just the
4-byte EPMD port).

### PORT_PLEASE2_REQ (tag 122 / 0x7A / 'z')

**Request:** variable length
```
Offset  Size    Field
0       2       Length = 1 + len(NodeName)
2       1       Tag = 122
3       varies  NodeName (UTF-8, the "alive name" only -- part before @)
```

**Response (PORT2_RESP, success):** tag 119 / 0x77 / 'w'
```
Offset  Size    Field
0       1       Tag = 119
1       1       Result = 0 (success)
2       2       PortNo (16-bit BE) -- the node's distribution port
4       1       NodeType: 77 = normal, 72 = hidden
5       1       Protocol: 0 = tcp/ip-v4
6       2       HighestVersion (16-bit BE)
8       2       LowestVersion (16-bit BE)
10      2       Nlen (16-bit BE) -- length of the node name that follows
12      Nlen    NodeName (UTF-8)
12+Nlen 2       Elen (16-bit BE) -- length of extra data
14+Nlen Elen    Extra (opaque bytes)
```

**Response (PORT2_RESP, failure):**
```
Offset  Size  Field
0       1     Tag = 119
1       1     Result = 1 (not found)
```

### ALIVE2_REQ (tag 120 / 0x78 / 'x') -- NOT IMPLEMENTED

Used by Erlang nodes to register themselves with EPMD. Not implemented because
Port of Call is a client querying EPMD, not an Erlang node registering itself.

**Request:**
```
[Length:16be, 120, PortNo:16be, NodeType:8, Protocol:8,
 HighestVersion:16be, LowestVersion:16be,
 Nlen:16be, NodeName:Nlen, Elen:16be, Extra:Elen]
```

**Response (ALIVE2_RESP):**
```
[121, Result:8, Creation:16be]
```

Result=0 means success; Creation is a 16-bit value assigned by EPMD.

### ALIVE2_X_REQ (tag 118 / 0x76 / 'v') -- NOT IMPLEMENTED

Extended version of ALIVE2_REQ introduced in OTP 23. Identical format to
ALIVE2_REQ but the response (ALIVE2_X_RESP, tag 118) returns a 32-bit Creation
value instead of 16-bit:

```
[118, Result:8, Creation:32be]
```

### STOP_REQ (tag 115 / 0x73 / 's') -- NOT IMPLEMENTED

Requests EPMD to stop a named node. Only works for nodes started via the `-relaxed_command_check` flag.

### DUMP_REQ (tag 100 / 0x64 / 'd') -- NOT IMPLEMENTED

Returns internal EPMD state including both active and killed connections. Rarely
used; similar to NAMES_REQ but includes more detail.

### KILL_REQ (tag 107 / 0x6B / 'k') -- NOT IMPLEMENTED

Kills the EPMD daemon (only works if the client connects from localhost and no
nodes are currently registered in some implementations).

---

## Node Type Values

| Value | Constant | Meaning |
|-------|----------|---------|
| 77 (0x4D) | `NORMAL` | Standard Erlang node; visible in `erlang:nodes()` on all connected nodes |
| 72 (0x48) | `HIDDEN` | Hidden node; not visible in `erlang:nodes()` unless `erlang:nodes(hidden)` is used. RabbitMQ uses hidden nodes for inter-cluster management traffic |

---

## Distribution Protocol Versions

The `highestVersion` and `lowestVersion` fields in PORT2_RESP indicate which
Erlang distribution protocol versions the node supports:

| Version | OTP Release | Notes |
|---------|------------|-------|
| 5 | R6B -- OTP 22 | Standard distribution, used by most production systems |
| 6 | OTP 23+ | Adds improved handshake (5/6 mixed clusters work; both ends negotiate down to 5 if needed) |

A node advertising `lowestVersion=5, highestVersion=6` supports both protocol
versions and can interoperate with older and newer Erlang releases.

---

## Node Name Format

Erlang node names have two forms:

- **Short name:** `rabbit@hostname` (started with `-sname`)
- **Long name:** `rabbit@hostname.example.com` (started with `-name`)

EPMD only stores the "alive name" -- the part before `@`. When querying
PORT_PLEASE2_REQ, pass only the alive name:

```
# Correct -- pass the alive name only:
{ "nodeName": "rabbit" }

# Wrong -- do not pass the full node name:
{ "nodeName": "rabbit@myhost.example.com" }
```

The NAMES_REQ response also returns only alive names.

---

## Patterns and Gotchas

**EPMD is per-host, not per-cluster.** Each machine running Erlang nodes has its
own EPMD instance. To discover all nodes in a RabbitMQ cluster, you need to
query EPMD on every machine in the cluster.

**EPMD starts automatically.** The first `erl` or `elixir` process with
distribution enabled (`-sname` or `-name`) automatically spawns EPMD if it is
not already running. It persists until explicitly killed.

**One connection per query.** EPMD closes the TCP connection after each NAMES or
PORT_PLEASE2 response. There is no connection reuse or pipelining.

**Alive names can repeat across hosts.** Two machines can each have a node named
`rabbit`. EPMD is local to each host, so there is no conflict.

**Empty response = no nodes.** If EPMD is running but no Erlang nodes have
registered, the NAMES_REQ response contains only the 4-byte EPMD port with no
text lines. The `nodes` array will be empty.

**EPMD without nodes does not mean the service is down.** EPMD may be running
(port 4369 open) even if the application (RabbitMQ, CouchDB) has crashed. Check
the `nodes` array to confirm the application is actually registered.

**Security: EPMD has no authentication.** EPMD accepts connections from any IP
address and reveals all registered node names and ports. In production, EPMD
should be firewalled to allow only trusted hosts. The distribution ports returned
by EPMD do have their own authentication (Erlang cookie), but the EPMD directory
itself is unauthenticated.

**Port 4369 is IANA-assigned to EPMD.** The port number is hardcoded in Erlang
and cannot be changed without recompiling (or using the `ERL_EPMD_PORT`
environment variable on newer releases).

---

## curl Quick Reference

```bash
BASE="https://portofcall.ross.gg"
HOST="rabbitmq.example.com"

# List all registered Erlang nodes
curl -s -X POST $BASE/api/epmd/names \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$HOST'"}' | jq '{epmdPort, nodes, rtt}'

# Look up a specific node
curl -s -X POST $BASE/api/epmd/port \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$HOST'","nodeName":"rabbit"}' | jq '{found, nodePort, nodeType, highestVersion, lowestVersion}'

# Quick health check: is EPMD running and are any nodes registered?
curl -s -X POST $BASE/api/epmd/names \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$HOST'"}' | jq 'if .success then "EPMD up, \(.nodes | length) nodes" else "EPMD down: \(.error)" end' -r

# Custom EPMD port (rare)
curl -s -X POST $BASE/api/epmd/names \
  -H 'Content-Type: application/json' \
  -d '{"host":"'$HOST'","port":14369}' | jq .

# RabbitMQ cluster audit: check each node individually
for NODE in rabbit rabbit2 rabbit3; do
  echo "--- $NODE ---"
  curl -s -X POST $BASE/api/epmd/port \
    -H 'Content-Type: application/json' \
    -d '{"host":"'$HOST'","nodeName":"'$NODE'"}' | jq '{found, nodePort, nodeType}'
done
```

---

## Local Test Server

```bash
# Start a minimal Erlang node (EPMD auto-starts on 4369)
erl -sname test -noshell -eval 'timer:sleep(infinity).'

# Or with Docker (RabbitMQ includes EPMD)
docker run -d -p 4369:4369 -p 5672:5672 --name rabbitmq rabbitmq:3-management

# Verify EPMD is listening
echo -ne '\x00\x01\x6e' | nc localhost 4369 | xxd

# Manual NAMES_REQ test with netcat
printf '\x00\x01\x6e' | nc -q1 localhost 4369 | tail -c +5

# Check EPMD with Erlang's built-in tool
epmd -names
```

---

## What Is NOT Implemented

| Feature | Notes |
|---------|-------|
| ALIVE2_REQ (tag 120) | Node registration -- Port of Call is a client, not an Erlang node |
| ALIVE2_X_REQ (tag 118) | Extended registration (OTP 23+) |
| DUMP_REQ (tag 100) | Internal EPMD state dump |
| KILL_REQ (tag 107) | Kill EPMD daemon |
| STOP_REQ (tag 115) | Stop a named node |
| TLS/SSL | EPMD has no TLS support in the Erlang specification |
| Custom EPMD modules | OTP supports replacing EPMD with a custom module; not relevant to protocol clients |
