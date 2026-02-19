# Daytime Protocol (RFC 867)

## Overview

| Field | Value |
|-------|-------|
| **Protocol** | Daytime |
| **RFC** | [RFC 867](https://tools.ietf.org/html/rfc867) (May 1983) |
| **Default Port** | 13 (TCP and UDP) |
| **Transport** | TCP (implemented), UDP (defined in RFC, not implemented) |
| **Complexity** | Trivial |
| **Status** | Obsolete (superseded by NTP) |
| **IANA Assignment** | [Port 13](https://www.iana.org/assignments/service-names-port-numbers/) |

Daytime is the simplest human-readable time protocol. A client connects, the server immediately sends the current date/time as an ASCII string, and closes the connection. No request data is sent by the client. The response format is not standardized -- each server implementation may format the string differently.

## RFC 867 Specification

RFC 867 is one of the shortest RFCs ever published. The entire protocol is:

### TCP Variant

1. Client opens a TCP connection to port 13 on the server.
2. Server sends the current date and time as an ASCII string.
3. Server closes the connection.
4. Client reads the data and closes its end.

No data is sent from client to server. The server may discard any data received.

```
Client                          Server
  |                                |
  |  ---- TCP SYN --------------> |
  |  <--- TCP SYN-ACK ----------- |
  |  ---- TCP ACK --------------> |  (connection established)
  |                                |
  |  <--- "Tuesday, February..." - |  (server sends time string)
  |  <--- FIN -------------------- |  (server closes connection)
  |  ---- FIN-ACK --------------> |
  |                                |
```

### UDP Variant

1. Client sends an empty UDP datagram to port 13 on the server.
2. Server responds with a single UDP datagram containing the date/time string.

The UDP variant is not implemented in Port of Call (Cloudflare Workers only support TCP sockets).

### Response Format

RFC 867 does **not** mandate a specific format. It only states the response should be an ASCII string representing the current date and time. Common formats seen in the wild:

| Server | Example Response |
|--------|-----------------|
| NIST (time.nist.gov) | `60336 24-01-15 22:30:45 50 0 0 895.5 UTC(NIST) *` |
| Traditional Unix | `Sun Jan 15 14:30:45 PST 2024` |
| Verbose | `Sunday, January 15, 2024 14:30:45-PST` |
| ISO-like | `2024-01-15 14:30:45` |

### NIST Daytime Format Breakdown

NIST servers use a specific format worth understanding:

```
JJJJJ YY-MM-DD HH:MM:SS TT L H msADV UTC(NIST) OTM
```

| Field | Meaning |
|-------|---------|
| JJJJJ | Modified Julian Date |
| YY-MM-DD | Date (2-digit year) |
| HH:MM:SS | Time (UTC) |
| TT | Indicates whether standard or daylight saving time (00=ST, 50=DST) |
| L | Leap second indicator (0=none, 1=add, 2=subtract) |
| H | Health indicator (0=healthy) |
| msADV | Advance in milliseconds the server sends the time |
| UTC(NIST) | Source identifier |
| OTM | On-Time Marker (`*` = good, `#` = not locked) |

## Port of Call Implementation

**File:** `src/worker/daytime.ts`
**API Endpoint:** `POST /api/daytime/get`
**Handler:** `handleDaytimeGet(request: Request)`

### Request

```json
{
  "host": "time.nist.gov",
  "port": 13,
  "timeout": 10000
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `host` | string | (required) | Hostname or IP of the Daytime server |
| `port` | number | `13` | TCP port number (1-65535) |
| `timeout` | number | `10000` | Connection timeout in milliseconds |

### Response (Success)

```json
{
  "success": true,
  "host": "time.nist.gov",
  "port": 13,
  "time": "60736 25-02-17 14:30:45 00 0 0 50.0 UTC(NIST) *",
  "localTime": "2025-02-17T14:30:45.123Z",
  "remoteTimestamp": 1739802645000,
  "localTimestamp": 1739802645123,
  "offsetMs": -73,
  "rtt": 145
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the query succeeded |
| `host` | string | The queried host |
| `port` | number | The queried port |
| `time` | string | Raw ASCII time string from the server |
| `localTime` | string | Local time (ISO 8601) when response was received |
| `remoteTimestamp` | number? | Parsed remote time as Unix epoch ms (if parseable) |
| `localTimestamp` | number | Local Unix epoch ms when response was received |
| `offsetMs` | number? | Clock offset in ms, adjusted for network delay (if parseable) |
| `rtt` | number | Round-trip time in milliseconds |

The `remoteTimestamp` and `offsetMs` fields are only populated when the server's response can be parsed by JavaScript's `Date()` constructor. Many Daytime servers (including NIST) use custom formats that cannot be automatically parsed, so these fields will be absent.

### Response (Error)

```json
{
  "success": false,
  "host": "",
  "port": 13,
  "error": "Connection timeout"
}
```

### Clock Offset Calculation

When the server's time string is parseable, the implementation estimates clock offset using:

```
networkDelay = (localTimeAfter - localTimeBefore) / 2
offsetMs = remoteTimestamp - (localTimeBefore + networkDelay)
```

This is a simplified version of the NTP offset formula. For Daytime protocol, accuracy is limited to roughly +/- the RTT, since there is no way to know the actual one-way delay.

## Implementation Details

### Read Strategy

The server is expected to send data and then close the connection. The implementation reads in a loop until:
- The server closes the connection (`done` flag from readable stream)
- The response exceeds 1000 bytes (safety limit; typical responses are under 100 bytes)
- The connection timeout fires

All received chunks are concatenated, decoded as UTF-8, and trimmed of whitespace.

### Error Handling

| Condition | Behavior |
|-----------|----------|
| Missing host | 400 Bad Request |
| Invalid port (outside 1-65535) | 400 Bad Request |
| Connection timeout | 500 with "Connection timeout" |
| Server closes without sending data | 500 with "Server closed connection without sending time" |
| Empty response after trimming | 500 with "Empty response from server" |

### Defense Against Misbehaving Servers

- **Size limit:** Response capped at 1000 bytes to prevent memory abuse from a rogue server.
- **Timeout:** Configurable (default 10s) applied to both connection and read phases.
- **No client-to-server data:** The implementation never writes to the socket, consistent with RFC 867.

## Testing

### Command-Line Testing

```bash
# Basic test with netcat
nc time.nist.gov 13

# With timeout (5 seconds)
nc -w 5 time.nist.gov 13

# Test via the API
curl -X POST https://your-worker.dev/api/daytime/get \
  -H 'Content-Type: application/json' \
  -d '{"host": "time.nist.gov"}'

# Test with custom port
curl -X POST https://your-worker.dev/api/daytime/get \
  -H 'Content-Type: application/json' \
  -d '{"host": "time.nist.gov", "port": 13, "timeout": 5000}'
```

### Local Test Server

```bash
# Simple Daytime server using netcat (single connection)
while true; do echo "$(date)" | nc -l 13; done

# Python Daytime server (multi-connection)
python3 -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', 13))
s.listen(1)
print('Daytime server on port 13')
while True:
    conn, addr = s.accept()
    conn.send((time.strftime('%A, %B %d, %Y %H:%M:%S-%Z') + '\r\n').encode())
    conn.close()
"

# Docker test server
docker run -d -p 13:13 --name daytime \
  alpine sh -c 'while true; do echo "$(date)" | nc -l -p 13; done'
```

### Verifying RFC Compliance

To verify a Daytime server is RFC 867 compliant:

1. Connect to port 13 via TCP. Send nothing.
2. Receive an ASCII string. It should be human-readable date/time.
3. The server should close the connection after sending.
4. Any data you send should be ignored (or never read).

```bash
# Verify server sends data unprompted and closes
echo "" | nc -w 5 time.nist.gov 13
```

## Public Daytime Servers

Most Daytime servers have been decommissioned. The NIST servers are among the few still running:

| Host | Operator | Notes |
|------|----------|-------|
| `time.nist.gov` | NIST | Round-robin to NIST time servers |
| `time-a-g.nist.gov` | NIST | Individual servers (a through g) |
| `time-a-wwv.nist.gov` | NIST (WWV) | Colorado facility |
| `time-b-wwv.nist.gov` | NIST (WWV) | Colorado facility |
| `time-a-b.nist.gov` | NIST (Boulder) | Boulder facility |

Port 13 is frequently blocked by corporate firewalls and ISPs. If connections fail, this is the most likely cause.

## Security Considerations

The Daytime protocol has **no security features whatsoever**:

- No authentication
- No encryption
- No integrity verification
- Susceptible to spoofing and man-in-the-middle attacks
- A rogue server can return any string

**Never rely on Daytime for security-sensitive time synchronization.** Use NTP with authentication, or better yet, NTS (Network Time Security, RFC 8915).

## Comparison with Other Time Protocols

| Protocol | Port | Format | Precision | Auth | Status |
|----------|------|--------|-----------|------|--------|
| **Daytime** | **13** | **ASCII text** | **~seconds** | **None** | **Obsolete** |
| Time (RFC 868) | 37 | 32-bit binary | ~seconds | None | Obsolete |
| NTP (RFC 5905) | 123 | 64-bit binary | microseconds | Symmetric key | Active |
| NTS (RFC 8915) | 4460 | NTP + TLS | microseconds | TLS/AEAD | Active |
| PTP (IEEE 1588) | 319/320 | Binary | nanoseconds | Optional | Active |

## Historical Context

RFC 867 was published in May 1983 by Jon Postel. It is part of a family of "simple services" defined in the early 1980s:

| RFC | Protocol | Port | Purpose |
|-----|----------|------|---------|
| RFC 862 | Echo | 7 | Echo back received data |
| RFC 863 | Discard | 9 | Discard all received data |
| RFC 864 | Chargen | 19 | Generate character stream |
| RFC 865 | QOTD | 17 | Quote of the Day |
| **RFC 867** | **Daytime** | **13** | **Human-readable time** |
| RFC 868 | Time | 37 | Binary time value |

These protocols were designed as building blocks for testing and as minimal examples of TCP and UDP usage. Today they serve primarily educational purposes.
