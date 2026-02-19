# Ganglia gmond/gmetad -- Port of Call Reference

**Protocol:** Ganglia XML Dump (gmond/gmetad)
**Default Ports:** 8649 (gmond), 8651 (gmetad)
**Transport:** TCP (server pushes XML immediately on connect)
**Implementation:** `src/worker/ganglia.ts`
**Frontend:** `src/components/GangliaClient.tsx`
**Endpoints:** 2

---

## Protocol Overview

Ganglia is a scalable distributed monitoring system designed for high-performance computing environments (clusters, grids, cloud). The architecture consists of three components:

| Component | Port  | Role |
|-----------|-------|------|
| **gmond** | 8649  | Per-node monitoring daemon. Collects local metrics and shares them with peers. |
| **gmetad** | 8651 | Meta daemon. Aggregates data from multiple gmond sources, stores to RRD. |
| **gweb** | 80/443 | PHP web frontend (not a wire protocol). |

### Two Protocols, One Port Number

Ganglia gmond uses **two distinct protocols on the same port number** (8649):

1. **XDR binary protocol** (UDP and multicast on port 8649): Used for metric announcements between gmond peers. Encodes metric metadata and values using XDR (RFC 4506, External Data Representation). This is how gmond daemons share metrics with each other in a cluster.

2. **XML dump protocol** (TCP on port 8649): Used by monitoring tools, gmetad, and this implementation. On TCP connect, gmond immediately pushes the entire cluster state as an XML document, then closes the connection. No request is sent by the client.

**This implementation uses only the TCP XML dump protocol.** The XDR binary protocol is used for inter-gmond communication and is not relevant for read-only monitoring.

### XML Dump Behavior

```
Client                                     gmond (TCP 8649)
  |                                           |
  |  -------- TCP SYN/SYN-ACK/ACK -------->  |
  |                                           |
  |  <-------- XML document (complete) -----  |
  |                                           |
  |  <-------- TCP FIN -------------------   |
  |                                           |
```

- No banner, no handshake, no commands
- Server writes the full XML document immediately upon accepting the connection
- Document ends with `</GANGLIA_XML>`
- Connection closes after the dump is complete
- Read-only; no authentication; no encryption

The same behavior applies to gmetad on port 8651, except gmetad aggregates data from multiple gmond sources and may include a GRID element wrapping multiple CLUSTERs.

---

## XML Schema

### Root Element

```xml
<GANGLIA_XML VERSION="3.7.2" SOURCE="gmond">
  <CLUSTER ...>
    <HOST ...>
      <METRIC ... />
      <!-- or in Ganglia 3.1+: -->
      <METRIC ...>
        <EXTRA_DATA>
          <EXTRA_ELEMENT NAME="GROUP" VAL="cpu"/>
          <EXTRA_ELEMENT NAME="DESC" VAL="Percentage of CPU utilization"/>
          <EXTRA_ELEMENT NAME="TITLE" VAL="CPU User"/>
        </EXTRA_DATA>
      </METRIC>
    </HOST>
  </CLUSTER>
</GANGLIA_XML>
```

### GANGLIA_XML Attributes

| Attribute | Example | Description |
|-----------|---------|-------------|
| `VERSION` | `3.7.2` | Ganglia protocol/software version |
| `SOURCE` | `gmond` | Data source (`gmond` or `gmetad`) |

### CLUSTER Attributes

| Attribute   | Example | Description |
|-------------|---------|-------------|
| `NAME`      | `my-cluster` | Cluster name from gmond.conf |
| `LOCALTIME` | `1708123456` | Unix timestamp of cluster local time |
| `OWNER`     | `admin` | Cluster owner string |
| `LATLONG`   | `N32.87 W117.21` | Geographic coordinates |
| `URL`       | `http://cluster.example.com` | Cluster info URL |

### HOST Attributes

| Attribute       | Example | Description |
|-----------------|---------|-------------|
| `NAME`          | `node01.example.com` | Hostname |
| `IP`            | `10.0.0.1` | IP address |
| `REPORTED`      | `1708123450` | Last metric report time (Unix) |
| `TN`            | `12` | Seconds since last metric report |
| `TMAX`          | `20` | Maximum expected reporting interval |
| `DMAX`          | `0` | Delete host after this many seconds of silence (0 = never) |
| `LOCATION`      | `rack1,u12` | Physical location string |
| `GMOND_STARTED` | `1708100000` | When gmond was started (Unix) |
| `TAGS`          | `compute,gpu` | Comma-separated tags |
| `OS_NAME`       | `Linux` | Operating system name |
| `OS_RELEASE`    | `5.15.0-91-generic` | OS kernel/release version |
| `MACHINE`       | `x86_64` | Hardware architecture |

**Host liveness:** A host is considered alive if `TN < TMAX`. If `TN >= TMAX`, the host may be down or gmond has stopped reporting.

### METRIC Attributes

| Attribute | Example | Description |
|-----------|---------|-------------|
| `NAME`    | `cpu_user` | Metric name |
| `VAL`     | `23.4` | Current value (always a string) |
| `TYPE`    | `float` | Data type: `string`, `uint8`, `uint16`, `uint32`, `int8`, `int16`, `int32`, `float`, `double` |
| `UNITS`   | `%` | Unit of measurement |
| `TN`      | `5` | Seconds since this metric was last updated |
| `TMAX`    | `60` | Maximum expected update interval |
| `DMAX`    | `0` | Delete metric after this many seconds without updates |
| `SLOPE`   | `both` | RRD slope: `zero`, `positive`, `negative`, `both`, `unspecified` |
| `SOURCE`  | `gmond` | Who reported this metric |

### EXTRA_DATA (Ganglia 3.1+)

Metrics on Ganglia 3.1+ include `<EXTRA_DATA>` with `<EXTRA_ELEMENT>` children:

| NAME | Description |
|------|-------------|
| `GROUP` | Metric group: `cpu`, `memory`, `disk`, `network`, `system`, `process`, etc. |
| `DESC` | Human-readable description |
| `TITLE` | Short title for display |
| `SOURCE` | Source of the metric |
| `CLUSTER` | Cluster association |

### Common Metrics

| Metric | Type | Units | Group | Description |
|--------|------|-------|-------|-------------|
| `cpu_user` | float | % | cpu | User CPU percentage |
| `cpu_system` | float | % | cpu | System CPU percentage |
| `cpu_idle` | float | % | cpu | Idle CPU percentage |
| `cpu_wio` | float | % | cpu | Wait I/O CPU percentage |
| `cpu_nice` | float | % | cpu | Nice CPU percentage |
| `cpu_num` | uint32 | CPUs | cpu | Number of CPUs |
| `cpu_speed` | uint32 | MHz | cpu | CPU clock speed |
| `load_one` | float | | load | 1-minute load average |
| `load_five` | float | | load | 5-minute load average |
| `load_fifteen` | float | | load | 15-minute load average |
| `mem_total` | float | KB | memory | Total memory |
| `mem_free` | float | KB | memory | Free memory |
| `mem_cached` | float | KB | memory | Cached memory |
| `mem_buffers` | float | KB | memory | Buffer memory |
| `mem_shared` | float | KB | memory | Shared memory |
| `swap_total` | float | KB | memory | Total swap |
| `swap_free` | float | KB | memory | Free swap |
| `disk_total` | double | GB | disk | Total disk space |
| `disk_free` | double | GB | disk | Free disk space |
| `bytes_in` | float | bytes/sec | network | Network bytes received/sec |
| `bytes_out` | float | bytes/sec | network | Network bytes sent/sec |
| `pkts_in` | float | packets/sec | network | Packets received/sec |
| `pkts_out` | float | packets/sec | network | Packets sent/sec |
| `proc_total` | uint32 | | process | Total processes |
| `proc_run` | uint32 | | process | Running processes |
| `boottime` | uint32 | s | system | Boot time (Unix timestamp) |
| `sys_clock` | uint32 | s | system | System clock (Unix timestamp) |
| `machine_type` | string | | system | Architecture (x86_64, etc.) |
| `os_name` | string | | system | OS name |
| `os_release` | string | | system | OS release/version |
| `gexec` | string | | core | gexec availability |
| `heartbeat` | uint32 | | core | Heartbeat counter |

---

## Implementation Details

### Parsing Strategy

The implementation uses regex-based XML parsing (no DOM parser) suitable for the constrained Cloudflare Workers environment:

1. **GANGLIA_XML root** -- extracted with `/<GANGLIA_XML\s+([^>]+)>/` for VERSION and SOURCE attributes
2. **CLUSTER elements** -- matched with `/<CLUSTER\s+([^>]+)>([\s\S]*?)<\/CLUSTER>/g`
3. **HOST elements** -- matched within each cluster with `/<HOST\s+([^>]+)>([\s\S]*?)<\/HOST>/g`
4. **METRIC elements** -- matched with `/<METRIC\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/METRIC>)/g` which handles both:
   - Self-closing form: `<METRIC NAME="cpu_user" VAL="23.4" ... />`
   - Body form (3.1+): `<METRIC NAME="cpu_user" VAL="23.4" ...><EXTRA_DATA>...</EXTRA_DATA></METRIC>`
5. **EXTRA_ELEMENT** -- parsed from metric body with `/<EXTRA_ELEMENT\s+([^>]*)\/?>/g`

### Response Truncation

To keep response sizes reasonable, metrics are capped at **50 per host**. The response includes a `metricsTruncated: true` flag when a host has more than 50 metrics. Large Ganglia clusters can have 100+ metrics per host.

---

## Endpoints

### POST /api/ganglia/connect

Connects to gmond/gmetad, reads the full XML dump, and parses it into structured JSON.

**Request**
```json
{
  "host": "ganglia.example.com",
  "port": 8649,
  "timeout": 15000
}
```

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `host` | Yes | -- | Target hostname or IP |
| `port` | No | 8649 | TCP port (use 8651 for gmetad) |
| `timeout` | No | 15000 | Total timeout in milliseconds |

**Response**
```json
{
  "success": true,
  "message": "Ganglia gmond connected: 1 cluster(s), 5 host(s), 450 metric(s)",
  "host": "ganglia.example.com",
  "port": 8649,
  "connectTime": 42,
  "rtt": 310,
  "gangliaVersion": "3.7.2",
  "source": "gmond",
  "clusterCount": 1,
  "hostCount": 5,
  "metricCount": 450,
  "xmlSize": 98234,
  "clusters": [
    {
      "name": "my-cluster",
      "owner": "admin",
      "url": "http://cluster.example.com",
      "hostCount": 5,
      "hosts": [
        {
          "name": "node01.example.com",
          "ip": "10.0.0.1",
          "os": "Linux 5.15.0-91-generic",
          "reported": "1708123450",
          "metricCount": 90,
          "metricsTruncated": true,
          "metrics": [
            {
              "name": "cpu_user",
              "val": "23.4",
              "type": "float",
              "units": "%",
              "tn": "5",
              "tmax": "60",
              "group": "cpu",
              "desc": "Percentage of CPU utilization at the user level",
              "title": "CPU User"
            }
          ]
        }
      ]
    }
  ]
}
```

### POST /api/ganglia/probe

Lightweight detection: connects, reads the first TCP chunk, checks for the `<GANGLIA_XML` tag. Does not parse the full document.

**Request**
```json
{
  "host": "ganglia.example.com",
  "port": 8649,
  "timeout": 5000
}
```

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `host` | Yes | -- | Target hostname or IP |
| `port` | No | 8649 | TCP port |
| `timeout` | No | 5000 | Timeout in milliseconds |

**Response**
```json
{
  "success": true,
  "message": "Ganglia gmond detected",
  "host": "ganglia.example.com",
  "port": 8649,
  "connectTime": 42,
  "rtt": 15,
  "isGanglia": true,
  "gangliaVersion": "3.7.2",
  "source": "gmond",
  "previewSize": 4096
}
```

The probe specifically looks for the `<GANGLIA_XML` tag in the first chunk. A generic `<?xml` declaration alone is not sufficient to identify Ganglia.

---

## XDR Binary Protocol (Background)

While this implementation does not use it, the XDR protocol is fundamental to how Ganglia works internally:

- **Transport:** UDP unicast or multicast on port 8649
- **Encoding:** XDR (RFC 4506) -- 4-byte aligned, big-endian, with length-prefixed strings
- **Message types:**
  - Metadata message (type 128+): Declares a metric's name, type, units, slope, tmax, dmax
  - Value message (type 128+ with different sub-format): Carries the current value for a named metric
  - Request message: Used to ask a gmond for its state

### XDR Metric Metadata Format

```
+--------+--------+--------+--------+
| format (uint32, big-endian)       |  0x80 = metadata
+--------+--------+--------+--------+
| hostname (XDR string)             |
+--------+--------+--------+--------+
| metric name (XDR string)          |
+--------+--------+--------+--------+
| spoof (uint32)                    |
+--------+--------+--------+--------+
| metric type (XDR string)          |
+--------+--------+--------+--------+
| metric name again (XDR string)    |
+--------+--------+--------+--------+
| units (XDR string)                |
+--------+--------+--------+--------+
| slope (uint32)                    |
+--------+--------+--------+--------+
| tmax (uint32)                     |
+--------+--------+--------+--------+
| dmax (uint32)                     |
+--------+--------+--------+--------+
| num extra elements (uint32)       |
+--------+--------+--------+--------+
| extra element name (XDR string)   |
| extra element value (XDR string)  |
| ... repeated N times              |
+--------+--------+--------+--------+
```

### XDR Metric Value Format

```
+--------+--------+--------+--------+
| format (uint32, big-endian)       |  0x85 = string, 0x84 = float, etc.
+--------+--------+--------+--------+
| hostname (XDR string)             |
+--------+--------+--------+--------+
| metric name (XDR string)          |
+--------+--------+--------+--------+
| spoof (uint32)                    |
+--------+--------+--------+--------+
| format string (XDR string)        |  e.g., "%s", "%.2f"
+--------+--------+--------+--------+
| value (type-dependent encoding)   |
+--------+--------+--------+--------+
```

XDR strings are length-prefixed (4-byte uint32 length, then bytes padded to 4-byte boundary).

---

## gmond vs gmetad

| Feature | gmond (8649) | gmetad (8651) |
|---------|-------------|---------------|
| Scope | Single cluster | Multiple clusters |
| XML root | `SOURCE="gmond"` | `SOURCE="gmetad"` |
| Extra wrapper | No GRID element | May include `<GRID>` element |
| Data freshness | Real-time | Polled (15-60 sec intervals) |
| RRD storage | No | Yes (writes RRD files) |
| Use case | Local node monitoring | Aggregated dashboard |

Both use the exact same XML format for CLUSTER/HOST/METRIC elements. The parser in this implementation works with either.

---

## Testing

### Verify with netcat

```bash
# gmond XML dump (reads until connection closes)
nc ganglia.example.com 8649

# gmetad XML dump
nc ganglia.example.com 8651

# With timeout
nc -w 5 ganglia.example.com 8649
```

### Docker test server

```bash
# Run a gmond instance
docker run -d \
  --name gmond \
  -p 8649:8649 \
  ganglia/gmond:latest

# Verify XML dump
nc localhost 8649 | head -50
```

### Quick XML validation

```bash
# Dump and validate XML
nc ganglia.example.com 8649 | xmllint --format -

# Count hosts
nc ganglia.example.com 8649 | grep -c '<HOST '

# Count metrics for a specific host
nc ganglia.example.com 8649 | grep -A 1000 'NAME="node01"' | grep -c '<METRIC '
```

### Python client

```python
import socket

def ganglia_dump(host, port=8649, timeout=10):
    """Read the gmond XML dump."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect((host, port))

    data = b''
    while True:
        try:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
            if b'</GANGLIA_XML>' in data:
                break
        except socket.timeout:
            break

    s.close()
    return data.decode('utf-8', errors='replace')

xml = ganglia_dump('ganglia.example.com')
print(f"Received {len(xml)} bytes")
```

---

## Example XML Output

### Ganglia 3.0 (self-closing metrics)

```xml
<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?>
<!DOCTYPE GANGLIA_XML [
  <!ELEMENT GANGLIA_XML (CLUSTER)*>
  <!ELEMENT CLUSTER (HOST)*>
  <!ELEMENT HOST (METRIC)*>
  <!ELEMENT METRIC EMPTY>
]>
<GANGLIA_XML VERSION="3.0.7" SOURCE="gmond">
  <CLUSTER NAME="my-cluster" LOCALTIME="1708123456" OWNER="admin"
           LATLONG="N32.87 W117.21" URL="http://cluster.example.com">
    <HOST NAME="node01.example.com" IP="10.0.0.1"
          REPORTED="1708123450" TN="6" TMAX="20" DMAX="0"
          LOCATION="rack1" GMOND_STARTED="1708100000"
          OS_NAME="Linux" OS_RELEASE="5.15.0" MACHINE="x86_64">
      <METRIC NAME="cpu_user" VAL="23.4" TYPE="float" UNITS="%" TN="5" TMAX="60" DMAX="0" SLOPE="both" SOURCE="gmond"/>
      <METRIC NAME="cpu_system" VAL="3.1" TYPE="float" UNITS="%" TN="5" TMAX="60" DMAX="0" SLOPE="both" SOURCE="gmond"/>
      <METRIC NAME="mem_total" VAL="16384000" TYPE="float" UNITS="KB" TN="120" TMAX="1200" DMAX="0" SLOPE="zero" SOURCE="gmond"/>
    </HOST>
  </CLUSTER>
</GANGLIA_XML>
```

### Ganglia 3.1+ (with EXTRA_DATA)

```xml
<GANGLIA_XML VERSION="3.7.2" SOURCE="gmond">
  <CLUSTER NAME="my-cluster" LOCALTIME="1708123456" OWNER="admin" URL="">
    <HOST NAME="node01.example.com" IP="10.0.0.1"
          REPORTED="1708123450" TN="6" TMAX="20" DMAX="0"
          GMOND_STARTED="1708100000" TAGS=""
          OS_NAME="Linux" OS_RELEASE="5.15.0-91-generic" MACHINE="x86_64">
      <METRIC NAME="cpu_user" VAL="23.4" TYPE="float" UNITS="%" TN="5" TMAX="90" DMAX="0" SLOPE="both" SOURCE="gmond">
        <EXTRA_DATA>
          <EXTRA_ELEMENT NAME="GROUP" VAL="cpu"/>
          <EXTRA_ELEMENT NAME="DESC" VAL="Percentage of CPU utilization at the user level"/>
          <EXTRA_ELEMENT NAME="TITLE" VAL="CPU User"/>
        </EXTRA_DATA>
      </METRIC>
      <METRIC NAME="load_one" VAL="0.42" TYPE="float" UNITS=" " TN="12" TMAX="70" DMAX="0" SLOPE="both" SOURCE="gmond">
        <EXTRA_DATA>
          <EXTRA_ELEMENT NAME="GROUP" VAL="load"/>
          <EXTRA_ELEMENT NAME="DESC" VAL="One minute load average"/>
          <EXTRA_ELEMENT NAME="TITLE" VAL="One Minute Load Average"/>
        </EXTRA_DATA>
      </METRIC>
    </HOST>
  </CLUSTER>
</GANGLIA_XML>
```

---

## Security

- **No authentication.** Anyone who can reach the TCP port gets the full cluster state.
- **No encryption.** All data is transmitted in plaintext XML.
- **Information disclosure.** The XML dump reveals hostnames, IPs, OS versions, CPU counts, memory sizes, and disk capacity -- valuable for reconnaissance.
- **Firewall recommendation.** Restrict ports 8649 and 8651 to trusted monitoring networks only.
- **Ganglia 3.6+** added optional ACL support in gmond.conf (`acl { ... }`) to restrict which IPs can connect.

---

## Configuration Reference

### gmond.conf (relevant sections)

```
/* Cluster identity */
cluster {
  name = "my-cluster"
  owner = "admin"
  latlong = "N32.87 W117.21"
  url = "http://cluster.example.com"
}

/* TCP XML dump listener */
tcp_accept_channel {
  port = 8649
  /* Optional ACL (Ganglia 3.6+) */
  /* acl {
    default = "deny"
    access {
      ip = 10.0.0.0
      mask = 24
      action = "allow"
    }
  } */
}

/* UDP for XDR metric sharing (multicast) */
udp_send_channel {
  mcast_join = 239.2.11.71
  port = 8649
  ttl = 1
}

udp_recv_channel {
  mcast_join = 239.2.11.71
  port = 8649
}
```

---

## Resources

- **Ganglia Monitoring System:** http://ganglia.info/
- **Source Code:** https://github.com/ganglia/monitor-core
- **gmond.conf manual:** `man gmond.conf` or https://github.com/ganglia/monitor-core/blob/master/gmond/gmond.conf.5
- **XDR specification:** RFC 4506 (External Data Representation Standard)
- **Ganglia XML DTD:** Embedded in the XML output's DOCTYPE declaration
- **IANA port 8649:** Not officially registered; de facto standard for Ganglia
