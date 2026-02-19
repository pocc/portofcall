# Portmapper / rpcbind — Power User Reference

**Port:** 111 (default) | **Protocol:** ONC RPC (RFC 1831/1833) | **Tests:** TBD

Port of Call provides three Portmapper/rpcbind endpoints: a NULL procedure probe, a DUMP endpoint to list all registered RPC services, and a GETPORT endpoint to look up the port for a specific RPC program. All three open a direct TCP connection from the Cloudflare Worker to your rpcbind/portmapper instance.

The Portmapper service is the central registry for ONC RPC services. When an NFS server, NIS server, or other RPC service starts, it registers its program number → port mapping with the portmapper. Clients contact port 111 first to discover where a service lives, then connect to the returned port.

---

## API Endpoints

### `POST /api/portmapper/probe` — NULL procedure probe

Sends a PMAPPROC_NULL call (procedure 0) to verify the portmapper is running and responsive. NULL is a no-op procedure that returns success if the service is alive.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `111`   | Portmapper port |
| `timeout` | number | `10000` | Total timeout in ms (0-300000) |

**Success (200):**
```json
{
  "success": true,
  "host": "nfs.example.com",
  "port": 111,
  "rtt": 42
}
```

**Error (500):** `{ "success": false, "error": "Connection timeout" }`

**Notes:**
- NULL procedure has no arguments and no return value — success is indicated by an RPC ACCEPTED reply with status SUCCESS
- Useful for checking if rpcbind is running before attempting service discovery
- The XID (transaction ID) is randomly generated for each call

**curl example:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/portmapper/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com","port":111}' | jq
```

---

### `POST /api/portmapper/dump` — List all registered services

Calls PMAPPROC_DUMP (procedure 4) to retrieve all program → port mappings registered with the portmapper. This is the primary service discovery mechanism.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `111`   | Portmapper port |
| `timeout` | number | `10000` | Total timeout in ms (0-300000) |

**Success (200):**
```json
{
  "success": true,
  "host": "nfs.example.com",
  "port": 111,
  "mappings": [
    {
      "program": 100000,
      "programName": "portmapper",
      "version": 2,
      "protocol": "TCP",
      "protocolNumber": 6,
      "port": 111
    },
    {
      "program": 100003,
      "programName": "nfs",
      "version": 3,
      "protocol": "TCP",
      "protocolNumber": 6,
      "port": 2049
    },
    {
      "program": 100005,
      "programName": "mountd",
      "version": 3,
      "protocol": "TCP",
      "protocolNumber": 6,
      "port": 20048
    }
  ],
  "totalServices": 3,
  "rtt": 38
}
```

**Notes:**
- DUMP returns a linked list of mapping entries — each entry contains program number, version, protocol (TCP/UDP), and port
- The portmapper itself (100000) is always present
- Common programs: `100003` (nfs), `100005` (mountd), `100021` (nlockmgr), `100024` (status/NSM), `100227` (nfs_acl)
- The `programName` field uses a built-in lookup table with 30+ well-known RPC programs — unknown programs show as `"unknown (N)"`
- Each unique (program, version, protocol) tuple gets a separate entry — NFS v3 and v4 on both TCP and UDP = 4 entries
- Response parsing stops at the first "value follows = 0" marker (end of list)
- Maximum response size: 128KB (safety limit to prevent memory exhaustion)

**curl example:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/portmapper/dump \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com"}' | jq '.mappings[] | select(.programName == "nfs")'
```

---

### `POST /api/portmapper/getport` — Look up port for specific RPC program

Calls PMAPPROC_GETPORT (procedure 3) to query the port number for a specific RPC program + version + protocol combination. Returns 0 if the program is not registered.

**POST body:**

| Field      | Type   | Default | Notes |
|------------|--------|---------|-------|
| `host`     | string | —       | Required |
| `port`     | number | `111`   | Portmapper port |
| `program`  | number | —       | Required (e.g., 100003 for NFS) |
| `version`  | number | `1`     | RPC program version |
| `protocol` | string | `"tcp"` | `"tcp"` or `"udp"` |
| `timeout`  | number | `10000` | Total timeout in ms (0-300000) |

**Success (200):**
```json
{
  "success": true,
  "host": "nfs.example.com",
  "port": 111,
  "program": 100003,
  "programName": "nfs",
  "version": 3,
  "protocol": "TCP",
  "servicePort": 2049,
  "registered": true,
  "rtt": 35,
  "message": "Program 100003 (nfs) v3 is registered at TCP port 2049"
}
```

**Program not registered (200):**
```json
{
  "success": true,
  "host": "nfs.example.com",
  "port": 111,
  "program": 100003,
  "programName": "nfs",
  "version": 4,
  "protocol": "UDP",
  "servicePort": 0,
  "registered": false,
  "rtt": 32,
  "message": "Program 100003 (nfs) v4 is not registered via UDP"
}
```

**Notes:**
- The `protocol` parameter is case-insensitive and defaults to `"tcp"` if not specified
- A `servicePort` of `0` means the (program, version, protocol) tuple is not registered
- This is the most efficient way to check if a specific service is available — DUMP returns all mappings, GETPORT returns just one
- The portmapper does **not** verify that the returned port is actually accepting connections — it only returns what the service registered
- Some NFS servers register multiple versions on the same port (e.g., NFS v3 and v4 both on 2049)

**curl examples:**
```bash
# Check if NFS v3 over TCP is available
curl -s -X POST https://portofcall.ross.gg/api/portmapper/getport \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com","program":100003,"version":3,"protocol":"tcp"}' | jq

# Check if mountd (required for NFS mounts) is registered
curl -s -X POST https://portofcall.ross.gg/api/portmapper/getport \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com","program":100005,"version":3}' | jq

# Check UDP protocol (legacy NFS)
curl -s -X POST https://portofcall.ross.gg/api/portmapper/getport \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com","program":100003,"version":2,"protocol":"udp"}' | jq
```

---

## ONC RPC Wire Format Reference

### TCP Record Marking (RFC 1057 §10)

Each RPC message on TCP is prefixed with a 4-byte record mark:

```
Bit 31:    Last Fragment flag (1 = last, 0 = more fragments)
Bits 0-30: Fragment length in bytes
```

Example: `0x80000028` = last fragment, 40 bytes

Port of Call always sends single-fragment messages (bit 31 = 1). Multi-fragment responses are supported but not expected for portmapper queries.

### ONC RPC Call Format (RFC 1831 §8-9)

All calls are XDR-encoded (big-endian uint32):

```
Field               Bytes  Notes
-----------------------------------
XID                 4      Random transaction ID
Message Type        4      0 = CALL
RPC Version         4      2
Program             4      100000 (portmapper)
Program Version     4      2
Procedure           4      0=NULL, 3=GETPORT, 4=DUMP
Credential Flavor   4      0 = AUTH_NONE
Credential Length   4      0
Verifier Flavor     4      0 = AUTH_NONE
Verifier Length     4      0
[Procedure args]    N      Procedure-specific
```

### ONC RPC Reply Format (RFC 1831 §9)

```
Field               Bytes  Notes
-----------------------------------
XID                 4      Echoes call XID
Message Type        4      1 = REPLY
Reply Status        4      0 = MSG_ACCEPTED
Verifier Flavor     4      Usually 0 (AUTH_NONE)
Verifier Length     4      Length of verifier data
Verifier Data       N      Padded to 4-byte boundary
Accept Status       4      0=SUCCESS, 1=PROG_UNAVAIL, 2=PROG_MISMATCH, ...
[Procedure results] N      Procedure-specific
```

### PMAPPROC_GETPORT Arguments (RFC 1833 §3)

```
Field         Bytes  Notes
----------------------------
Program       4      RPC program number
Version       4      Program version
Protocol      4      6=TCP, 17=UDP (IPPROTO_*)
Port          4      0 (reserved, must be 0)
```

### PMAPPROC_GETPORT Reply

```
Field         Bytes  Notes
----------------------------
Port          4      Service port (0 = not registered)
```

### PMAPPROC_DUMP Reply

Linked list of mapping entries:

```
Value Follows  4      1=TRUE (entry present), 0=FALSE (end of list)
  Program      4      RPC program number
  Version      4      Program version
  Protocol     4      6=TCP, 17=UDP
  Port         4      Service port
... repeats until Value Follows = 0
```

Example raw dump response (NFS and mountd):
```
Value Follows: 1
  Program:  100003 (nfs)
  Version:  3
  Protocol: 6 (TCP)
  Port:     2049
Value Follows: 1
  Program:  100005 (mountd)
  Version:  3
  Protocol: 6 (TCP)
  Port:     20048
Value Follows: 0
```

---

## XDR Encoding Notes

- All integers are **big-endian** 32-bit unsigned (network byte order)
- Variable-length data (strings, opaque data, arrays) is prefixed with a 4-byte length
- All data is **padded to 4-byte boundaries** — e.g., a 5-byte string becomes 8 bytes (5 data + 3 padding)
- Verifier data in RPC replies is padded per XDR rules — a 6-byte verifier requires 8 bytes (6 + 2 padding)
- Port of Call correctly handles verifier padding when parsing replies (fixed in 2026-02-18 review)

---

## Well-Known RPC Program Numbers

Port of Call recognizes 30+ RPC programs in the `RPC_PROGRAMS` lookup table:

| Program | Name | Common Port | Notes |
|---------|------|-------------|-------|
| 100000 | portmapper | 111 | Always present |
| 100003 | nfs | 2049 | Network File System |
| 100005 | mountd | varies | NFS mount daemon |
| 100021 | nlockmgr | varies | NFS lock manager (NLM) |
| 100024 | status (NSM) | varies | NFS status monitor |
| 100227 | nfs_acl | varies | NFS ACL extensions |
| 100004 | ypserv (NIS) | varies | Yellow Pages / NIS server |
| 100007 | ypbind (NIS) | varies | NIS binder |
| 150001 | pcnfsd | varies | PC-NFS daemon |
| 100011 | rquotad | varies | Remote quota daemon |
| 100001 | rstatd | varies | Remote stats |
| 100002 | rusersd | varies | Remote users |

See the `RPC_PROGRAMS` constant in `/Users/rj/gd/code/portofcall/src/worker/portmapper.ts` for the full list.

---

## Common Use Cases

### Discover NFS services

```bash
# Step 1: Verify portmapper is running
curl -s -X POST https://portofcall.ross.gg/api/portmapper/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com"}' | jq

# Step 2: Dump all services
curl -s -X POST https://portofcall.ross.gg/api/portmapper/dump \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com"}' | jq '.mappings[] | select(.programName | contains("nfs"))'

# Step 3: Get specific port for NFS v3
curl -s -X POST https://portofcall.ross.gg/api/portmapper/getport \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com","program":100003,"version":3}' | jq
```

### Check if mountd is registered

Before mounting an NFS share, verify mountd (program 100005) is registered:

```bash
curl -s -X POST https://portofcall.ross.gg/api/portmapper/getport \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com","program":100005,"version":3}' | jq '.registered'
```

Returns `true` if mountd v3 is registered, `false` otherwise.

### Enumerate all TCP services

```bash
curl -s -X POST https://portofcall.ross.gg/api/portmapper/dump \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com"}' | jq '.mappings[] | select(.protocol == "TCP")'
```

### Find NFS lock manager (NLM)

NFS locking requires the lock manager (nlockmgr, program 100021):

```bash
curl -s -X POST https://portofcall.ross.gg/api/portmapper/getport \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com","program":100021,"version":4}' | jq
```

---

## Security Considerations

### No authentication

The portmapper protocol uses `AUTH_NONE` (flavor 0) for both credentials and verifiers. There is no access control — anyone who can reach port 111 can query the service registry.

**Mitigation:** Restrict access to port 111 via firewall rules. Only allow trusted clients to reach rpcbind.

### Information disclosure

DUMP reveals all registered RPC services, including internal-only services that should not be exposed. Attackers use this for reconnaissance.

**Mitigation:**
- Use `rpcbind -h <ip>` to bind only to specific IPs (e.g., loopback for local-only services)
- Use `rpcbind -i` (warmstart mode) to restrict which hosts can query
- Newer rpcbind supports `/etc/rpcbind.conf` for ACLs

### Service hijacking (historical)

Old portmapper implementations allowed **SET** and **UNSET** procedures (2 and 1) without authentication, letting unprivileged users overwrite legitimate service registrations.

**Modern behavior:**
- `rpcbind` (modern) only allows SET/UNSET from `localhost` (`127.0.0.1` / `::1`)
- Port of Call does not implement SET/UNSET — read-only queries only

### DOS via large responses

A malicious server could return a huge DUMP response (e.g., claim 10 million mappings) to exhaust memory.

**Port of Call protection:**
- 128KB max fragment size enforced in `readRpcResponse()`
- Verifier length capped at 400 bytes to prevent memory exhaustion
- Connection timeout enforced (0-300000ms, default 10s)

---

## Known Limitations

**No rpcbind v4 / getaddrinfo support:** Port of Call implements portmapper v2 (RFC 1833). rpcbind v3/v4 (RFC 1833 §A, not widely used) adds IPv6 and UADDR support. GETPORT works for IPv4 services only.

**No UDP support:** All queries use TCP (port 111). Some legacy services only register UDP mappings. The `protocol` parameter in GETPORT accepts `"udp"` but the query itself is sent over TCP.

**No SET/UNSET procedures:** Port of Call is read-only. You cannot register or unregister services via these endpoints (by design — SET/UNSET are privileged operations restricted to localhost).

**No support for indirect RPC calls:** The portmapper protocol defines CALLIT (procedure 5) for forwarding RPC calls through the portmapper. Not implemented. Use GETPORT to discover the service port, then connect directly.

**No broadcast/multicast discovery:** rpcbind v3 supports `RPCB_GETADDR` and `RPCB_GETADDRLIST` for broadcast discovery of services on the local network. Not supported.

**Program number lookup table is incomplete:** The `RPC_PROGRAMS` table contains 30+ well-known programs but is not exhaustive. Proprietary or uncommon RPC services show as `"unknown (N)"`.

---

## Troubleshooting

### "Connection timeout"

- Port 111 is firewalled or rpcbind is not running
- Check: `telnet nfs.example.com 111`
- Check: `rpcinfo -p nfs.example.com` (from a Linux/macOS client)

### "RPC call rejected (status=N)"

The server rejected the call at the RPC layer (before the procedure executed). Rare for portmapper — usually indicates protocol mismatch.

**Common causes:**
- Old portmapper v1 (pre-RFC 1833) — try legacy `pmap_dump` tool
- Firewall mangling RPC packets

### "RPC error: PROG_UNAVAIL" (accept status 1)

The requested program (100000) is not registered. This should never happen for the portmapper itself (it's always present).

### "RPC error: PROG_MISMATCH" (accept status 2)

The program version (2) is not supported. Modern rpcbind supports v2, v3, and v4. Port of Call always sends v2.

### "RPC error: PROC_UNAVAIL" (accept status 3)

The procedure (0=NULL, 3=GETPORT, 4=DUMP) is not implemented. Should not happen with standard rpcbind.

### "Fragment too large: N bytes"

The server sent a response larger than 128KB. This is a safety limit to prevent memory exhaustion.

**Workaround:** Use GETPORT instead of DUMP if you only need one service's port.

### "Verifier length too large: N bytes"

The server sent a verifier longer than 400 bytes (unusual — portmapper typically uses AUTH_NONE with 0-byte verifiers).

**This may indicate:**
- Malicious server attempting memory exhaustion
- Protocol mismatch (not actually rpcbind on port 111)

---

## Power User Tips

### Combine with NFS probes

After discovering NFS ports via DUMP, use the NFS probe endpoint to test actual connectivity:

```bash
# Get NFS v3 port
NFS_PORT=$(curl -s -X POST https://portofcall.ross.gg/api/portmapper/getport \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com","program":100003,"version":3}' | jq -r '.servicePort')

# Test NFS connectivity (assumes you have an NFS probe endpoint)
curl -s -X POST https://portofcall.ross.gg/api/nfs/probe \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"nfs.example.com\",\"port\":$NFS_PORT}"
```

### Use jq to filter DUMP results

```bash
# Show only NFS-related services
curl -s -X POST https://portofcall.ross.gg/api/portmapper/dump \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com"}' | \
  jq '.mappings[] | select(.programName | test("nfs|mount|lock|status"))'

# Group by program name
curl -s -X POST https://portofcall.ross.gg/api/portmapper/dump \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com"}' | \
  jq '.mappings | group_by(.programName) | map({program: .[0].programName, versions: map(.version) | unique})'

# Find all UDP services (rare on modern systems)
curl -s -X POST https://portofcall.ross.gg/api/portmapper/dump \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs.example.com"}' | \
  jq '.mappings[] | select(.protocol == "UDP")'
```

### Check for required NFS services

A working NFS v3 setup typically requires:
- `100003` (nfs) — the file server
- `100005` (mountd) — mount protocol
- `100021` (nlockmgr) — lock manager (optional but recommended)
- `100024` (status/NSM) — status monitor (for lock recovery)

```bash
for prog in 100003 100005 100021 100024; do
  curl -s -X POST https://portofcall.ross.gg/api/portmapper/getport \
    -H 'Content-Type: application/json' \
    -d "{\"host\":\"nfs.example.com\",\"program\":$prog,\"version\":3}" | \
    jq -r '"\(.programName): \(.registered)"'
done
```

### Compare rpcbind instances

Run DUMP on multiple hosts and diff the results:

```bash
curl -s -X POST https://portofcall.ross.gg/api/portmapper/dump \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs1.example.com"}' > /tmp/nfs1.json

curl -s -X POST https://portofcall.ross.gg/api/portmapper/dump \
  -H 'Content-Type: application/json' \
  -d '{"host":"nfs2.example.com"}' > /tmp/nfs2.json

diff <(jq -S '.mappings[] | {program, version, protocol}' /tmp/nfs1.json) \
     <(jq -S '.mappings[] | {program, version, protocol}' /tmp/nfs2.json)
```

---

## Resources

- [RFC 1831 — ONC RPC Version 2](https://www.rfc-editor.org/rfc/rfc1831.html)
- [RFC 1833 — Binding Protocols for ONC RPC Version 2](https://www.rfc-editor.org/rfc/rfc1833.html)
- [RFC 1057 — RPC: Remote Procedure Call Protocol Specification Version 2](https://www.rfc-editor.org/rfc/rfc1057.html) (obsoleted by 1831, but describes TCP record marking)
- [RFC 5531 — RPC: Remote Procedure Call Protocol Specification Version 2](https://www.rfc-editor.org/rfc/rfc5531.html) (updates 1831)
- [RFC 5665 — IANA Considerations for RPC](https://www.rfc-editor.org/rfc/rfc5665.html)
- [rpcbind man page](https://linux.die.net/man/8/rpcbind)
- [rpcinfo man page](https://linux.die.net/man/8/rpcinfo) — command-line portmapper query tool

---

## Practical Examples

### JavaScript (browser)

```js
async function checkNFS(host) {
  // Probe portmapper
  const probe = await fetch('/api/portmapper/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host })
  }).then(r => r.json());

  if (!probe.success) {
    console.error('Portmapper not reachable:', probe.error);
    return;
  }

  // Get NFS v3 port
  const getport = await fetch('/api/portmapper/getport', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host,
      program: 100003, // nfs
      version: 3,
      protocol: 'tcp'
    })
  }).then(r => r.json());

  if (getport.registered) {
    console.log(`NFS v3 is running on port ${getport.servicePort}`);
  } else {
    console.log('NFS v3 is not registered');
  }
}

checkNFS('nfs.example.com');
```

### Python

```python
import requests
import json

def dump_rpc_services(host):
    resp = requests.post('https://portofcall.ross.gg/api/portmapper/dump',
                         headers={'Content-Type': 'application/json'},
                         json={'host': host})
    data = resp.json()
    if not data['success']:
        print(f"Error: {data['error']}")
        return

    print(f"Found {data['totalServices']} services on {host}:")
    for m in data['mappings']:
        print(f"  {m['programName']:20} v{m['version']} {m['protocol']:3} port {m['port']}")

dump_rpc_services('nfs.example.com')
```

### Bash script — Full NFS check

```bash
#!/bin/bash
HOST="${1:-nfs.example.com}"
API="https://portofcall.ross.gg/api/portmapper"

echo "=== Checking $HOST ==="

# Probe
echo -n "Portmapper: "
curl -sf -X POST "$API/probe" \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\"}" > /dev/null && echo "OK" || echo "FAIL"

# Check NFS
echo -n "NFS v3: "
PORT=$(curl -sf -X POST "$API/getport" \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"program\":100003,\"version\":3}" | jq -r '.servicePort')
[[ "$PORT" != "0" ]] && echo "port $PORT" || echo "NOT REGISTERED"

# Check mountd
echo -n "mountd v3: "
PORT=$(curl -sf -X POST "$API/getport" \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\",\"program\":100005,\"version\":3}" | jq -r '.servicePort')
[[ "$PORT" != "0" ]] && echo "port $PORT" || echo "NOT REGISTERED"

# Dump all services
echo -e "\nAll registered services:"
curl -sf -X POST "$API/dump" \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"$HOST\"}" | jq -r '.mappings[] | "\(.programName) v\(.version) \(.protocol) port \(.port)"'
```

Usage: `./check-nfs.sh nfs.example.com`
