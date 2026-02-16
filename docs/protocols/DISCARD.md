# DISCARD Protocol (RFC 863)

## Overview
The DISCARD protocol is one of the original "simple services" defined in 1983. It accepts TCP connections, reads all incoming data, and silently discards everything — never sending any response back to the client.

- **RFC:** [863](https://datatracker.ietf.org/doc/html/rfc863)
- **Default Port:** 9
- **Transport:** TCP (also defined for UDP)
- **Status:** Historical/Deprecated — rarely deployed, but useful for testing

## Protocol Flow
```
Client                          Server (Port 9)
  |                                  |
  |  -------- TCP SYN ----------->  |
  |  <------- TCP SYN-ACK -------  |
  |  -------- TCP ACK ----------->  |  Connection established
  |                                  |
  |  -------- Data 1 ------------>  |  Server reads & discards
  |  -------- Data 2 ------------>  |  Server reads & discards
  |  -------- Data N ------------>  |  Server reads & discards
  |                                  |
  |  -------- FIN --------------->  |  Client closes
  |  <------- FIN-ACK -----------  |
```

The server NEVER sends application data. The only packets from the server are TCP-level acknowledgments.

## Implementation Details

### Worker Endpoints

#### `POST /api/discard/test`
Send data to a Discard server and measure throughput.

**Request Body:**
```json
{
  "host": "tcpbin.com",
  "port": 9,
  "message": "Hello, Discard!",
  "repeatCount": 10,
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "host": "tcpbin.com",
  "port": 9,
  "bytesSent": 150,
  "sendCount": 10,
  "elapsed": 45,
  "throughputBps": 3333,
  "noResponse": true
}
```

| Field | Description |
|-------|-------------|
| `bytesSent` | Total bytes written to the socket |
| `sendCount` | Number of times the message was sent |
| `elapsed` | Total time from connect to finish (ms) |
| `throughputBps` | Bytes per second throughput |
| `noResponse` | `true` if the server correctly sent nothing back |

#### `WebSocket /api/discard/connect?host=...&port=...`
Interactive WebSocket tunnel for continuous discard testing. Data sent through the WebSocket is forwarded to the Discard server. The tunnel reports byte counts back:

```json
{ "discarded": 15, "totalSent": 150 }
```

### Authentication
None. The Discard protocol has no authentication mechanism.

### Timeouts / Keep-Alives
- Default timeout: 10 seconds
- The connection stays open until the client closes it
- Workers have a maximum execution time, so long-lived connections will eventually be terminated

### Binary vs. Text Encoding
- Supports both text and binary data
- Messages are UTF-8 encoded when sent as text
- WebSocket tunnel supports both string and ArrayBuffer messages

## Relationship to Other Simple Services

| Protocol | RFC | Port | Behavior |
|----------|-----|------|----------|
| Echo     | 862 | 7    | Echoes data back |
| **Discard** | **863** | **9** | **Discards data silently** |
| Daytime  | 867 | 13   | Returns human-readable time |
| QOTD     | 865 | 17   | Returns a quote |
| Chargen  | 864 | 19   | Generates character stream |
| Time     | 868 | 37   | Returns binary time |

## Testing
Most cloud providers and ISPs block port 9. For testing:
- Use `tcpbin.com:9` (public TCP testing service)
- Set up your own Discard server: `ncat -l -k 9 > /dev/null`
- Use socat: `socat TCP-LISTEN:9,reuseaddr,fork /dev/null`
