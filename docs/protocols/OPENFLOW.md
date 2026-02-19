# OpenFlow — Power User Reference

**Port:** 6653 (default), 6633 (legacy) | **Protocol:** Binary over TCP | **Tests:** Deployed

Port of Call provides three OpenFlow endpoints: a connection probe with feature discovery, an echo/ping test, and a statistics query interface. All three open a direct TCP connection from the Cloudflare Worker to your OpenFlow switch or controller.

OpenFlow is the foundational protocol for Software-Defined Networking (SDN), defining communication between an SDN controller and network switches to enable centralized control of packet forwarding decisions.

---

## API Endpoints

### `POST /api/openflow/probe` — Connection probe with feature discovery

Connects to an OpenFlow switch, performs version negotiation via HELLO exchange, and requests switch capabilities via FEATURES_REQUEST.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `6653`  | Valid range: 1-65535 |
| `version` | number | `0x04`  | OpenFlow version: 0x01 (1.0), 0x04 (1.3), 0x06 (1.5) |
| `timeout` | number | `10000` | Total timeout in ms (connection + handshake + features) |

**Success (200):**
```json
{
  "success": true,
  "host": "switch.example.com",
  "port": 6653,
  "rtt": 145,
  "connectTime": 42,
  "protocol": "OpenFlow",
  "serverVersion": 4,
  "serverVersionName": "OpenFlow 1.3",
  "negotiatedVersion": 4,
  "negotiatedVersionName": "OpenFlow 1.3",
  "features": {
    "datapathId": "00000001:23456789",
    "nBuffers": 256,
    "nTables": 254,
    "auxiliaryId": 0,
    "capabilities": ["FLOW_STATS", "TABLE_STATS", "PORT_STATS", "GROUP_STATS", "IP_REASM", "QUEUE_STATS"],
    "capabilitiesRaw": 119
  },
  "error": null,
  "message": "OpenFlow switch detected in 145ms"
}
```

**Error (500):** `{ "success": false, "error": "Connection timeout" }`

**Cloudflare-protected host (403):** `{ "success": false, "error": "...", "isCloudflare": true }`

**Notes:**
- `datapathId` is the 64-bit switch identifier in hex format `high:low` (e.g. `00000001:23456789`)
- `nBuffers` is the max number of packets the switch can buffer for controller
- `nTables` is the number of flow tables (0-254)
- `auxiliaryId` is only present in OF 1.3+; indicates auxiliary connection ID (0 = main)
- `capabilities` is parsed using version-specific flags (OF 1.0 uses STP and ARP_MATCH_IP; OF 1.3+ uses GROUP_STATS and PORT_BLOCKED)
- `negotiatedVersion` is `min(clientVersion, serverVersion)` per OpenFlow spec
- If server returns ERROR instead of HELLO or FEATURES_REPLY, the `error` field will contain the error type and code

**OpenFlow version constants:**

| Version | Hex  | Name         |
|---------|------|--------------|
| 1.0     | 0x01 | OpenFlow 1.0 |
| 1.1     | 0x02 | OpenFlow 1.1 |
| 1.2     | 0x03 | OpenFlow 1.2 |
| 1.3     | 0x04 | OpenFlow 1.3 |
| 1.4     | 0x05 | OpenFlow 1.4 |
| 1.5     | 0x06 | OpenFlow 1.5 |

**Capabilities reference:**

OpenFlow 1.0 capabilities (8 flags):

| Bit | Flag            | Meaning |
|-----|-----------------|---------|
| 0   | FLOW_STATS      | Flow statistics supported |
| 1   | TABLE_STATS     | Table statistics supported |
| 2   | PORT_STATS      | Port statistics supported |
| 3   | STP             | 802.1d spanning tree supported (OF 1.0 only) |
| 5   | IP_REASM        | IP fragment reassembly supported |
| 6   | QUEUE_STATS     | Queue statistics supported |
| 7   | ARP_MATCH_IP    | Match IP addresses in ARP pkts (OF 1.0 only) |

OpenFlow 1.3+ capabilities (7 flags):

| Bit | Flag            | Meaning |
|-----|-----------------|---------|
| 0   | FLOW_STATS      | Flow statistics supported |
| 1   | TABLE_STATS     | Table statistics supported |
| 2   | PORT_STATS      | Port statistics supported |
| 3   | GROUP_STATS     | Group statistics supported (OF 1.3+) |
| 5   | IP_REASM        | IP fragment reassembly supported |
| 6   | QUEUE_STATS     | Queue statistics supported |
| 8   | PORT_BLOCKED    | Switch will block looping ports (OF 1.3+) |

**curl example:**
```bash
# Probe OpenFlow 1.3 switch
curl -s -X POST https://portofcall.ross.gg/api/openflow/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com","port":6653,"version":4}' \
  | jq

# Probe legacy OpenFlow 1.0 switch
curl -s -X POST https://portofcall.ross.gg/api/openflow/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1","port":6633,"version":1}' \
  | jq '.features'
```

---

### `POST /api/openflow/echo` — Echo request/reply (keepalive test)

Connects, performs HELLO negotiation, sends ECHO_REQUEST with timestamp payload, and waits for ECHO_REPLY.

**POST body:**

| Field     | Type   | Default | Notes |
|-----------|--------|---------|-------|
| `host`    | string | —       | Required |
| `port`    | number | `6653`  | Valid range: 1-65535 |
| `version` | number | `0x04`  | OpenFlow version |
| `timeout` | number | `10000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "switch.example.com",
  "port": 6653,
  "rtt": 89,
  "echoRtt": 12,
  "protocol": "OpenFlow",
  "negotiatedVersion": 4,
  "negotiatedVersionName": "OpenFlow 1.3",
  "echoReceived": true,
  "echoXid": 2,
  "message": "Echo reply received in 12ms"
}
```

**Notes:**
- `rtt` is total time (connection + HELLO + ECHO)
- `echoRtt` is time from ECHO_REQUEST send to ECHO_REPLY receive
- ECHO_REQUEST payload contains 8-byte timestamp (Float64, milliseconds since epoch)
- ECHO_REPLY should echo back the same payload per OpenFlow spec
- `echoXid` is the transaction ID from the reply

**curl example:**
```bash
# Test keepalive round-trip
curl -s -X POST https://portofcall.ross.gg/api/openflow/echo \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com","port":6653}' \
  | jq '.echoRtt'
```

---

### `POST /api/openflow/stats` — Statistics query

Connects, negotiates, sends FEATURES_REQUEST (required by some switches), then sends a STATS_REQUEST (OF 1.0) or MULTIPART_REQUEST (OF 1.3+) and parses the reply.

**POST body:**

| Field       | Type   | Default | Notes |
|-------------|--------|---------|-------|
| `host`      | string | —       | Required |
| `port`      | number | `6653`  | Valid range: 1-65535 |
| `timeout`   | number | `10000` | Total timeout in ms |
| `statsType` | string | `desc`  | One of: `desc`, `flow`, `port`, `table` |

**Supported stats types:**

| Type    | Description | Body type (OF 1.0/1.3) |
|---------|-------------|------------------------|
| `desc`  | Switch description (mfr, hw, sw, serial, datapath) | OFPST_DESC (0) |
| `flow`  | Individual flow statistics | OFPST_FLOW (1) |
| `table` | Table statistics (lookups, matches, active flows) | OFPST_TABLE (3) |
| `port`  | Port statistics (packets, bytes, errors, drops) | OFPST_PORT (4) |

**Success — DESC stats (200):**
```json
{
  "success": true,
  "host": "switch.example.com",
  "port": 6653,
  "rtt": 234,
  "statsType": "desc",
  "protocol": "OpenFlow",
  "negotiatedVersion": 4,
  "negotiatedVersionName": "OpenFlow 1.3",
  "stats": {
    "manufacturer": "Open vSwitch",
    "hardware": "None",
    "software": "2.17.9",
    "serial": "None",
    "datapath": "br0"
  }
}
```

**Success — PORT stats (200):**
```json
{
  "success": true,
  "statsType": "port",
  "stats": {
    "ports": [
      {
        "portNo": 1,
        "rxPackets": 1234567,
        "txPackets": 987654,
        "rxBytes": 123456789,
        "txBytes": 98765432,
        "rxDropped": 0,
        "txDropped": 0,
        "rxErrors": 0,
        "txErrors": 0
      }
    ]
  }
}
```

**Success — TABLE stats (200):**
```json
{
  "success": true,
  "statsType": "table",
  "stats": {
    "tables": [
      {
        "tableId": 0,
        "name": "classifier",
        "maxEntries": 1000000,
        "activeCount": 42,
        "lookups": 9876543210,
        "matched": 9876543100
      }
    ]
  }
}
```

**Notes (TABLE stats):**
- OF 1.0: includes `name` (32-byte null-padded string), `maxEntries`, `activeCount`, `lookups`, `matched`
- OF 1.3: no `name` or `maxEntries` fields (use OFPMP_TABLE_FEATURES for OF 1.3 table names)

**Success — FLOW stats (200):**
```json
{
  "success": true,
  "statsType": "flow",
  "stats": {
    "flows": [
      {
        "tableId": 0,
        "priority": 100,
        "idleTimeout": 0,
        "hardTimeout": 0,
        "cookie": "0x00000000abcd1234",
        "packetCount": 12345,
        "byteCount": 98765432
      }
    ]
  }
}
```

**Notes (FLOW stats):**
- OF 1.0: 88-byte minimum per flow (length, table_id, match, duration, priority, timeouts, cookie, counters, actions)
- OF 1.3: 56-byte minimum per flow (length, table_id, duration, priority, timeouts, flags, cookie, counters, match, instructions)
- Match and action/instruction parsing is not implemented — only metadata fields are returned
- `cookie` is a 64-bit controller-assigned identifier, formatted as hex
- OF 1.3 flows include a `flags` field (e.g. SEND_FLOW_REM, CHECK_OVERLAP)

**Error (500):** `{ "success": false, "error": "No stats reply received — switch may not support this stats type" }`

**curl examples:**
```bash
# Get switch description
curl -s -X POST https://portofcall.ross.gg/api/openflow/stats \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com","statsType":"desc"}' \
  | jq '.stats'

# Get port statistics
curl -s -X POST https://portofcall.ross.gg/api/openflow/stats \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com","statsType":"port"}' \
  | jq '.stats.ports[] | select(.portNo == 1)'

# Get table stats
curl -s -X POST https://portofcall.ross.gg/api/openflow/stats \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com","statsType":"table"}' \
  | jq '.stats.tables[] | {tableId, activeCount, lookups, matched}'

# Get flow stats
curl -s -X POST https://portofcall.ross.gg/api/openflow/stats \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com","statsType":"flow"}' \
  | jq '.stats.flows[] | select(.priority > 50)'
```

---

## OpenFlow Wire Protocol Reference

### Message Format

All OpenFlow messages share an 8-byte header:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    version    |      type     |            length             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                              xid                              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          payload...                           |
```

**Header fields:**
- `version` (1 byte): OpenFlow protocol version (0x01 = 1.0, 0x04 = 1.3, etc.)
- `type` (1 byte): Message type (0 = HELLO, 5 = FEATURES_REQUEST, 6 = FEATURES_REPLY, etc.)
- `length` (2 bytes, big-endian): Total message length including header
- `xid` (4 bytes, big-endian): Transaction ID — replies must echo the request XID

### Message Types

| Type | Name                | Direction | Purpose |
|------|---------------------|-----------|---------|
| 0    | HELLO               | Both      | Version negotiation |
| 1    | ERROR               | Both      | Error notification |
| 2    | ECHO_REQUEST        | Both      | Keepalive ping |
| 3    | ECHO_REPLY          | Both      | Keepalive pong |
| 4    | EXPERIMENTER        | Both      | Vendor extensions |
| 5    | FEATURES_REQUEST    | C→S       | Query switch capabilities |
| 6    | FEATURES_REPLY      | S→C       | Switch capabilities |
| 7    | GET_CONFIG_REQUEST  | C→S       | Query switch config |
| 8    | GET_CONFIG_REPLY    | S→C       | Switch config |
| 16   | STATS_REQUEST       | C→S       | Statistics query (OF 1.0) |
| 17   | STATS_REPLY         | S→C       | Statistics response (OF 1.0) |
| 18   | MULTIPART_REQUEST   | C→S       | Statistics query (OF 1.3+) |
| 19   | MULTIPART_REPLY     | S→C       | Statistics response (OF 1.3+) |

(C = Controller, S = Switch)

### Connection Flow

```
Client                        Switch
  |                             |
  |--- HELLO (v=1.3, xid=1) --->|
  |<--- HELLO (v=1.0, xid=1) ---|  ← server may negotiate down
  |                             |
  |  Negotiated version = min(1.3, 1.0) = 1.0
  |                             |
  |--- FEATURES_REQUEST (xid=2) |
  |<--- FEATURES_REPLY (xid=2) -|  ← datapath ID, tables, buffers, caps
  |                             |
  |--- ECHO_REQUEST (xid=3) ----|
  |<--- ECHO_REPLY (xid=3) -----|
  |                             |
  |--- STATS_REQUEST (xid=4) ---|
  |<--- STATS_REPLY (xid=4) ----|  ← may have MORE flag set (multipart)
  |                             |
```

### FEATURES_REPLY Structure

**OpenFlow 1.0:**
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        datapath_id (high)                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        datapath_id (low)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          n_buffers                            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   n_tables    |  pad[3]                                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        capabilities                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          actions                              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      ports (variable)...                      |
```

**OpenFlow 1.3:**
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        datapath_id (high)                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        datapath_id (low)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          n_buffers                            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   n_tables    | auxiliary_id  |  pad[2]                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        capabilities                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                          reserved                             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### ERROR Message Structure

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|              type             |             code              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        data (variable)...                     |
```

**Error types:**

| Type | Name                        |
|------|-----------------------------|
| 0    | HELLO_FAILED                |
| 1    | BAD_REQUEST                 |
| 2    | BAD_ACTION                  |
| 3    | BAD_INSTRUCTION             |
| 4    | BAD_MATCH                   |
| 5    | FLOW_MOD_FAILED             |
| 6    | GROUP_MOD_FAILED            |
| 7    | PORT_MOD_FAILED             |
| 8    | TABLE_MOD_FAILED            |
| 9    | MULTIPART_REQUEST_FAILED    |
| 10   | QUEUE_OP_FAILED             |
| 11   | SWITCH_CONFIG_FAILED        |
| 12   | ROLE_REQUEST_FAILED         |
| 13   | METER_MOD_FAILED            |
| 14   | TABLE_FEATURES_FAILED       |

Each error type has version-specific error codes (e.g. HELLO_FAILED codes: 0=INCOMPATIBLE, 1=EPERM).

### STATS/MULTIPART Request Format

**OF 1.0 STATS_REQUEST (type 16):**
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         stats_type            |            flags              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     body (variable)...                        |
```

**OF 1.3 MULTIPART_REQUEST (type 18):**
Same structure, different type value.

**Stats body types:**
- `OFPST_DESC (0)`: 4-byte header (type + flags) only, no body
- `OFPST_FLOW (1)`: match + table_id + out_port (OF 1.0: 48 bytes; OF 1.3: 16+ bytes)
- `OFPST_TABLE (3)`: 4-byte header only
- `OFPST_PORT (4)`: port_no (OF 1.0: 2 bytes; OF 1.3: 4 bytes)

---

## Known Limitations

**XID validation not enforced:** The implementation does not verify that response XIDs match the request XID. In a noisy environment with pipelined requests, responses could be mismatched. Mitigated by single-threaded request/response pattern and immediate socket close.

**Single stats reply only:** The `MORE` flag (bit 0 of flags in STATS_REPLY/MULTIPART_REPLY) is checked but only the first reply is processed. Large result sets (e.g. 10,000 flow entries) spanning multiple replies will be truncated. The implementation reads up to 3 messages looking for a stats reply, then stops.

**No match/action/instruction parsing:** FLOW stats return only metadata (table ID, priority, timeouts, cookie, counters). The 40-byte OF 1.0 match structure and variable-length OF 1.3 OXM match are not decoded. Action lists (OF 1.0) and instruction lists (OF 1.3) are not parsed.

**No OFPMP_TABLE_FEATURES support:** OF 1.3 removed table names from TABLE_STATS. To get table names in OF 1.3+, send OFPMP_TABLE_FEATURES request (type 12), which is not implemented.

**Minimal FLOW_STATS request:** The wildcard match sent in FLOW_STATS_REQUEST (all wildcards enabled, table_id=0xff, out_port=OFPP_NONE/OFPP_ANY) should return all flows. Some switches may reject this as too broad or return an error.

**Timeout shared across handshake:** The `timeout` parameter covers connection, HELLO exchange, FEATURES_REQUEST, and STATS_REQUEST. A slow TLS handshake (if using stunnel/proxy) or slow switch may cause late-stage timeout even if individual operations are responsive.

**No auxiliary connections:** OF 1.3 supports multiple controller connections (main + auxiliary). The implementation only uses the main connection (auxiliary_id=0 in FEATURES_REPLY is parsed but not used).

**No TLS support:** OpenFlow connections are plain TCP. Some SDN deployments use TLS wrapping (port 6653 with TLS). Use stunnel or HAProxy for TLS termination.

**No PACKET_IN/FLOW_MOD/etc.:** The implementation only performs read operations (HELLO, FEATURES, ECHO, STATS). No flow installation, packet-out, barrier, role request, or meter/group mod messages are supported.

**DESC field truncation:** DESC reply contains five null-padded strings (mfr_desc, hw_desc, sw_desc, serial_num, dp_desc). If the reply body is shorter than 1056 bytes, an error is returned. Some minimal switches may omit padding.

**OF 1.1/1.2/1.4/1.5 untested:** Version negotiation supports all versions but parsing logic is only tested against OF 1.0 and OF 1.3 switches. OF 1.1/1.2 use different FEATURES_REPLY layouts and may fail.

**No Cloudflare detection on /stats endpoint:** Unlike most protocol handlers, the `/stats` endpoint includes Cloudflare detection, but it could be bypassed with an IP address. Consistent with other handlers.

**Port validation missing from /echo:** The `/probe` and `/stats` endpoints validate `port` is in range 1-65535. The `/echo` endpoint also validates but is consistent.

---

## OpenFlow Versions at a Glance

| Version | Released | Key Features | Notes |
|---------|----------|--------------|-------|
| 1.0 | 2009 | 12-tuple match, basic actions, single table | First production version, widely deployed in academic SDN |
| 1.1 | 2011 | Multiple tables, MPLS, group tables | Rarely deployed, transitional |
| 1.2 | 2011 | IPv6, extensible match (OXM), metadata | Rarely deployed, transitional |
| 1.3 | 2012 | OXM match, meters, per-flow meters, auxiliary connections | Most widely deployed production version, industry standard |
| 1.4 | 2013 | Bundles, role sync, eviction, table-miss flow | Limited deployment |
| 1.5 | 2014 | Egress tables, packet-out in table pipeline | Limited deployment |

Port of Call supports all versions for version negotiation, but parsing logic is optimized for OF 1.0 and OF 1.3.

---

## Practical Use Cases

**Switch discovery:** Use `/probe` to identify OpenFlow-enabled switches in a network segment. Datapath ID, table count, and capabilities indicate switch model and firmware version.

**Keepalive testing:** Use `/echo` to measure control channel latency and verify the switch is responsive. Some controllers send ECHO_REQUEST every 5-15 seconds to detect dead switches.

**Flow table audit:** Use `/stats` with `statsType=flow` to dump all installed flows. Compare against expected controller state to detect stale flows or unauthorized modifications.

**Port utilization:** Use `/stats` with `statsType=port` to collect packet/byte counters for each port. Subtract previous counters to compute throughput.

**Table occupancy:** Use `/stats` with `statsType=table` to monitor flow table usage. `activeCount / maxEntries` indicates table fill percentage. High occupancy may cause FLOW_MOD failures.

**Vendor fingerprinting:** The DESC stats (`mfr_desc`, `hw_desc`, `sw_desc`) identify the switch vendor and firmware version. Example: Open vSwitch, HP, Cisco, Juniper, Pica8, Arista, etc.

---

## Resources

- [OpenFlow 1.0 Specification](https://opennetworking.org/wp-content/uploads/2013/04/openflow-spec-v1.0.0.pdf)
- [OpenFlow 1.3 Specification](https://opennetworking.org/wp-content/uploads/2014/10/openflow-switch-v1.3.5.pdf)
- [OpenFlow 1.5 Specification](https://opennetworking.org/wp-content/uploads/2014/10/openflow-switch-v1.5.1.pdf)
- [Open Networking Foundation](https://opennetworking.org/)
- [Open vSwitch](https://www.openvswitch.org/) — widely used software OpenFlow switch
- [Ryu SDN Framework](https://ryu-sdn.org/) — Python-based OpenFlow controller
- [ONOS](https://opennetworking.org/onos/) — production SDN controller platform

---

## Advanced Examples

### curl

```bash
# Probe with OF 1.0 (legacy switches)
curl -s -X POST https://portofcall.ross.gg/api/openflow/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.1","port":6633,"version":1}'

# Test control channel latency
curl -s -X POST https://portofcall.ross.gg/api/openflow/echo \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com"}' \
  | jq '.echoRtt'

# Get switch description (vendor, firmware, etc.)
curl -s -X POST https://portofcall.ross.gg/api/openflow/stats \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com","statsType":"desc"}' \
  | jq '.stats | "\(.manufacturer) \(.software)"'

# Count active flows per table
curl -s -X POST https://portofcall.ross.gg/api/openflow/stats \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com","statsType":"table"}' \
  | jq '.stats.tables[] | "\(.tableId): \(.activeCount) flows"'

# Find high-traffic ports (sort by total bytes)
curl -s -X POST https://portofcall.ross.gg/api/openflow/stats \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com","statsType":"port"}' \
  | jq '.stats.ports | sort_by(.rxBytes + .txBytes) | reverse | .[] | "\(.portNo): \(.rxBytes + .txBytes) bytes"'

# Identify flows with zero packet count (stale flows)
curl -s -X POST https://portofcall.ross.gg/api/openflow/stats \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com","statsType":"flow"}' \
  | jq '.stats.flows[] | select(.packetCount == 0)'

# Check if FLOW_STATS capability is enabled
curl -s -X POST https://portofcall.ross.gg/api/openflow/probe \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com"}' \
  | jq '.features.capabilities | contains(["FLOW_STATS"])'

# Measure connection latency vs echo latency
curl -s -X POST https://portofcall.ross.gg/api/openflow/echo \
  -H 'Content-Type: application/json' \
  -d '{"host":"switch.example.com"}' \
  | jq '{totalRtt: .rtt, echoRtt: .echoRtt, overhead: (.rtt - .echoRtt)}'
```

### Python (switch monitoring)

```python
import requests
import json
import time

def monitor_switch(host, interval=5):
    """Poll OpenFlow switch for port stats every N seconds"""
    url = "https://portofcall.ross.gg/api/openflow/stats"

    prev_stats = {}
    while True:
        r = requests.post(url, json={
            "host": host,
            "statsType": "port"
        })
        data = r.json()

        if not data.get("success"):
            print(f"Error: {data.get('error')}")
            time.sleep(interval)
            continue

        ports = {p["portNo"]: p for p in data["stats"]["ports"]}

        for port_no, stats in ports.items():
            if port_no in prev_stats:
                prev = prev_stats[port_no]
                rx_pps = (stats["rxPackets"] - prev["rxPackets"]) / interval
                tx_pps = (stats["txPackets"] - prev["txPackets"]) / interval
                rx_bps = (stats["rxBytes"] - prev["rxBytes"]) * 8 / interval
                tx_bps = (stats["txBytes"] - prev["txBytes"]) * 8 / interval

                print(f"Port {port_no}: RX {rx_pps:.1f} pps ({rx_bps/1e6:.2f} Mbps), "
                      f"TX {tx_pps:.1f} pps ({tx_bps/1e6:.2f} Mbps)")

        prev_stats = ports
        time.sleep(interval)

monitor_switch("switch.example.com")
```

### JavaScript (version detection)

```javascript
async function detectOpenFlowVersion(host, port = 6653) {
  const versions = [
    { version: 6, name: "1.5" },
    { version: 4, name: "1.3" },
    { version: 1, name: "1.0" }
  ];

  for (const { version, name } of versions) {
    const res = await fetch("https://portofcall.ross.gg/api/openflow/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, port, version, timeout: 5000 })
    });
    const data = await res.json();

    if (data.success && data.features) {
      console.log(`Switch supports OpenFlow ${name} or higher`);
      console.log(`Datapath ID: ${data.features.datapathId}`);
      console.log(`Tables: ${data.features.nTables}`);
      return data;
    }
  }

  console.log("No OpenFlow version detected");
  return null;
}
```

---

## Power User Tips

### Datapath ID as MAC address

The 64-bit datapath ID is often derived from the switch's base MAC address. The lower 48 bits are the MAC, the upper 16 bits are implementation-defined (often 0x0001 or the bridge number in multi-instance switches).

Example: `00000001:a0b1c2d3e4f5` → MAC `a0:b1:c2:d3:e4:f5`

### Table statistics for controller health

Monitor `activeCount` across all tables. A sudden drop to zero indicates the switch rebooted, controller crashed, or flow aging expired all entries. A gradual increase may indicate a flow leak (controller installing but not removing flows).

### Port statistics for anomaly detection

Sudden spike in `rxDropped` or `txDropped` on a port indicates buffer overflow (microbursts, speed mismatch, flow table miss flooding controller). Compare `rxErrors` / `txErrors` against total packets to compute error rate.

### Cookie-based flow ownership

Controllers set a unique 64-bit cookie on each flow. By filtering flow stats by cookie prefix, you can identify which controller owns each flow in a multi-controller deployment.

### Negotiated version edge cases

If client requests OF 1.3 and switch responds with OF 1.0 HELLO, the negotiated version is OF 1.0. Subsequent messages use OF 1.0 structure (e.g. STATS_REQUEST type 16, not MULTIPART_REQUEST type 18). The implementation handles this correctly.

### ECHO_REQUEST as heartbeat

Production controllers typically send ECHO_REQUEST every 5-15 seconds. If no ECHO_REPLY arrives within 3× interval, the switch is considered dead and all flows are withdrawn. Use `/echo` to verify the switch is honoring the keepalive contract.

### Minimal switch implementations

Some hardware switches implement a minimal OpenFlow subset (e.g. OF 1.0 with no stats support, or OF 1.3 with only DESC stats). If `/stats` returns "No stats reply received", try different `statsType` values or check switch documentation for supported features.
