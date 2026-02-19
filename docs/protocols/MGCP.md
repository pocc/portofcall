# MGCP (Media Gateway Control Protocol)

## Quick Reference

| Property | Value |
|---|---|
| **RFC** | 3435 (MGCP 1.0) |
| **Transport** | UDP (primary), TCP (alternative) |
| **Gateway Port** | 2427/udp |
| **Call Agent Port** | 2727/udp |
| **Message Format** | Text-based, CRLF-delimited |
| **Architecture** | Master/slave (Call Agent controls Media Gateway) |
| **SDP** | Used for media description in CRCX/MDCX responses |

## Overview

MGCP implements a centralized call-control architecture where a Call Agent (softswitch) sends commands to "dumb" Media Gateways. Unlike SIP (peer-to-peer) or H.323 (distributed intelligence), all call logic resides in the Call Agent. The gateways simply execute instructions.

```
+---------------+              +------------------+
|  Call Agent   |  <--MGCP-->  | Media Gateway    |
|  (Softswitch) |              | (Dumb endpoint)  |
+---------------+              +------------------+
        |                               |
    (Controls)                      (Executes)
```

**Components:**
- **Call Agent (CA)**: Intelligent call controller (softswitch). Sends commands, receives notifications.
- **Media Gateway (MG)**: Executes commands from CA. Contains endpoints (lines, trunks).
- **Endpoints**: Physical or virtual terminations on the gateway (e.g., analog line ports, DS0 channels).

## RFC 3435 Protocol Specification

### Transport

RFC 3435 Section 1.3 specifies UDP as the primary transport. Gateways listen on port **2427/udp**; Call Agents listen on port **2727/udp**. TCP is mentioned as an alternative transport in Appendix A but is not the default.

> **Implementation note**: This project uses TCP because Cloudflare Workers' `connect()` API only supports TCP sockets. Most production MGCP gateways accept TCP connections alongside UDP.

### Message Structure

MGCP has two message types:

**Commands** (CA -> GW, or GW -> CA for NTFY/RSIP):
```
VERB transaction-id endpoint@domain MGCP 1.0\r\n
Parameter: value\r\n
Parameter: value\r\n
\r\n
[optional SDP body]
```

**Responses** (echo the transaction-id from the command):
```
response-code transaction-id comment\r\n
Parameter: value\r\n
\r\n
[optional SDP body]
```

A blank line (`\r\n\r\n`) terminates both commands and responses. SDP bodies, when present, follow the blank line.

### Transaction IDs

Per RFC 3435 Section 3.2, transaction identifiers are integers in the range **1 to 999999999**. Each new command must use a unique transaction ID. The response echoes back the same transaction ID from the command.

### Commands (Verbs)

**Call Agent -> Gateway (CA-to-GW):**

| Verb | Name | RFC Section | Purpose |
|------|------|-------------|---------|
| `EPCF` | EndpointConfiguration | 2.3.2 | Configure endpoint properties (encoding, bearer) |
| `CRCX` | CreateConnection | 2.3.5 | Create a new media connection on an endpoint |
| `MDCX` | ModifyConnection | 2.3.3 | Modify an existing connection (codec, mode, remote SDP) |
| `DLCX` | DeleteConnection | 2.3.4 | Delete a connection |
| `RQNT` | RequestNotification | 2.3.1 | Request that the gateway watch for specific events |
| `AUEP` | AuditEndpoint | 2.3.9 | Query endpoint state and capabilities |
| `AUCX` | AuditConnection | 2.3.10 | Query an existing connection's parameters |

**Gateway -> Call Agent (GW-to-CA):**

| Verb | Name | RFC Section | Purpose |
|------|------|-------------|---------|
| `NTFY` | Notify | 2.3.6 | Report detected events (off-hook, digits, etc.) |
| `RSIP` | RestartInProgress | 2.3.7 | Report gateway restart or endpoint going in/out of service |
| `DLCX` | DeleteConnection | 2.3.4 | Gateway may also initiate DLCX |

### Key Parameters

| Parameter | Name | Used In | Description |
|-----------|------|---------|-------------|
| `C:` | CallId | CRCX, MDCX, DLCX, AUCX | Hex call identifier, groups connections |
| `I:` | ConnectionId | MDCX, DLCX, AUCX (response: CRCX) | Identifies a specific connection |
| `L:` | LocalConnectionOptions | CRCX, MDCX | Codec, packetization, bandwidth |
| `M:` | Mode | CRCX, MDCX | Connection mode (sendrecv, recvonly, etc.) |
| `X:` | RequestIdentifier | RQNT, NTFY | Correlates requests with notifications |
| `R:` | RequestedEvents | RQNT | Events to watch for |
| `S:` | SignalRequests | RQNT | Signals to apply (dial tone, ringback, etc.) |
| `N:` | NotifiedEntity | RQNT, CRCX | Where to send NTFY (CA address) |
| `F:` | RequestedInfo | AUEP, AUCX | What info to return in audit response |
| `D:` | DigitMap | RQNT, EPCF | Digit collection pattern |
| `O:` | ObservedEvents | NTFY | Events being reported |
| `T:` | DetectEvents | RQNT | Events gateway should auto-detect |
| `E:` | ReasonCode | DLCX (response) | Reason for connection deletion |
| `B:` | BearerInformation | EPCF | Encoding law (A-law/mu-law) |
| `Z:` | SpecificEndpointId | CRCX (response) | Wildcard endpoint resolution |

### Connection Modes

Per RFC 3435 Section 2.3.5:

| Mode | Description |
|------|-------------|
| `sendrecv` | Full duplex audio |
| `sendonly` | Transmit only |
| `recvonly` | Receive only |
| `confrnce` | Conference mode |
| `inactive` | No media flow |
| `loopback` | Echo audio back to sender |
| `netwloop` | Network loopback |
| `netwtest` | Network continuity test |
| `conttest` | Continuity test |

### Response Codes (RFC 3435 Section 2.4)

**Provisional (1xx):**

| Code | Meaning |
|------|---------|
| 100 | Transaction being executed (provisional) |
| 101 | Transaction has been queued |

**Success (2xx):**

| Code | Meaning |
|------|---------|
| 200 | Transaction executed normally |
| 250 | Connection was deleted |

**Transient Errors (4xx):**

| Code | Meaning |
|------|---------|
| 400 | Transient error, unspecified |
| 401 | Phone is already off-hook |
| 402 | Phone is already on-hook |
| 403 | Transaction could not be executed (endpoint not ready) |
| 404 | Insufficient bandwidth |
| 405 | Endpoint is restarting |
| 406 | Transaction timed out |
| 407 | Aborted transaction |
| 409 | Overlapping transaction |
| 410 | No such transaction |

**Permanent Errors (5xx):**

| Code | Meaning |
|------|---------|
| 500 | Endpoint unknown |
| 501 | Endpoint is not ready |
| 502 | Endpoint has insufficient resources |
| 503 | Wildcard too complicated |
| 504 | Unknown or unsupported command |
| 505 | Unsupported RemoteConnectionDescriptor |
| 506 | Unable to satisfy local and remote connection options |
| 507 | Unsupported functionality |
| 508 | Unknown or unsupported quarantine handling |
| 509 | Error in RemoteConnectionDescriptor |
| 510 | Protocol error |
| 511 | Unrecognized extension |
| 512 | Cannot detect requested event |
| 513 | Cannot generate requested signal |
| 514 | Cannot send announcement |
| 515 | Incorrect connection ID |
| 516 | Unknown call ID |
| 517 | Unsupported or invalid mode |
| 518 | Unsupported or unknown package |
| 519 | Endpoint does not have a digit map |
| 520 | Endpoint is restarting |
| 521 | Endpoint redirected |
| 522 | No such event or signal |
| 523 | Unknown action |
| 524 | Internal inconsistency in LocalConnectionOptions |
| 525 | Unknown extension in LocalConnectionOptions |
| 526 | Insufficient bandwidth |
| 527 | Missing RemoteConnectionDescriptor |
| 528 | Incompatible protocol version |
| 529 | Internal hardware failure |
| 530 | CAS signaling protocol error |
| 531 | Failure of a grouping of trunks |
| 532 | Unsupported value(s) in LocalConnectionOptions |
| 533 | Response too large |
| 534 | Codec negotiation failure |
| 535 | Packetization period not supported |
| 536 | Unknown or unsupported RestartMethod |
| 537 | Unknown or unsupported digit map extension |
| 538 | Event/signal parameter error |

### Endpoint Naming Convention

Endpoints follow a hierarchical naming scheme:

| Pattern | Description | Example |
|---------|-------------|---------|
| `aaln/<port>` | Analog Access Line | `aaln/1` (port 1) |
| `ds/ds1-<span>/<channel>` | T1/E1 digital trunk | `ds/ds1-1/1` (span 1, ch 1) |
| `an/<id>` | Announcement server | `an/0` |
| `conf/<id>` | Conference bridge | `conf/1` |

Fully qualified: `aaln/1@gw.example.com`

Wildcard: `aaln/*@gw.example.com` (all analog lines)

### Event Packages

| Package | Letter | Events |
|---------|--------|--------|
| Line | `L` | `hd` (off-hook), `hu` (on-hook), `hf` (flash-hook) |
| DTMF | `D` | `0`-`9`, `*`, `#`, `A`-`D`, `T` (inter-digit timer) |
| Trunk | `T` | T1/E1 signaling events |
| Generic | `G` | Generic media events |
| RTP | `R` | RTP statistics, packet loss |
| Announcement | `A` | `oc` (completed), `of` (failure) |

Event notation: `package/event`. Example: `L/hd` = Line package, hook-down (off-hook).

## Protocol Examples

### AUEP (Audit Endpoint)

```
AUEP 1209431 aaln/1@gw.example.com MGCP 1.0
F: A, R, D, S, X, N, I, T, O, ES

```

Response:
```
200 1209431 OK
A: a:PCMU;PCMA, p:10-40, e:on, s:off
R: L/hd, L/hu
D: [0-9#*T]
X: 0000000001
N: ca.example.com:2727

```

The `F:` parameter requests: capabilities (A), requested events (R), digit map (D), signal requests (S), request ID (X), notified entity (N), connection IDs (I), detect events (T), observed events (O), event states (ES).

### CRCX (Create Connection)

```
CRCX 1234 aaln/1@gw.example.com MGCP 1.0
C: A3C47F21456789F0
L: p:20, a:PCMU
M: recvonly

```

Response (200 OK with SDP):
```
200 1234 OK
I: FDE234C8

v=0
o=- 25678 753849 IN IP4 192.168.1.100
s=-
c=IN IP4 192.168.1.100
t=0 0
m=audio 49152 RTP/AVP 0
```

**LocalConnectionOptions (L:) parameters:**
- `p:20` -- packetization period in milliseconds
- `a:PCMU` -- codec (PCMU = G.711 mu-law, PCMA = G.711 A-law)
- `b:64` -- bandwidth in kbit/s
- `e:on` -- echo cancellation on/off
- `s:off` -- silence suppression on/off

### MDCX (Modify Connection)

```
MDCX 5678 aaln/1@gw.example.com MGCP 1.0
C: A3C47F21456789F0
I: FDE234C8
M: sendrecv

v=0
o=- 12345 67890 IN IP4 10.0.0.1
s=-
c=IN IP4 10.0.0.1
t=0 0
m=audio 5004 RTP/AVP 0
```

### DLCX (Delete Connection)

```
DLCX 9012 aaln/1@gw.example.com MGCP 1.0
C: A3C47F21456789F0
I: FDE234C8

```

Response:
```
250 9012 OK
P: PS=1245, OS=62location, PR=780, OR=location, PL=10, JI=27, LA=48

```

The `P:` parameter returns connection statistics:
- `PS` = packets sent, `OS` = octets sent
- `PR` = packets received, `OR` = octets received
- `PL` = packets lost, `JI` = jitter, `LA` = latency

### RQNT (Request Notification)

```
RQNT 3456 aaln/1@gw.example.com MGCP 1.0
X: 0123456789AB
R: L/hd(N), L/hu(N), D/[0-9#*](N)
S: L/dl

```

- `X:` -- Request identifier (correlates with future NTFY)
- `R:` -- Events to watch: off-hook, on-hook, digits. `(N)` means notify the CA.
- `S:` -- Apply dial tone (`L/dl`)

### NTFY (Notify, GW -> CA)

```
NTFY 7890 aaln/1@gw.example.com MGCP 1.0
X: 0123456789AB
O: L/hd

```

Gateway reports that endpoint went off-hook.

### RSIP (Restart In Progress, GW -> CA)

```
RSIP 100 *@gw.example.com MGCP 1.0
RM: restart

```

- `RM: restart` -- Gateway is restarting
- `RM: graceful` -- Graceful restart (finish current calls first)
- `RM: forced` -- Forced restart (drop all calls)

## Implementation Details

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mgcp/audit` | POST | Send AUEP to probe endpoint |
| `/api/mgcp/command` | POST | Send any CA-to-GW command |
| `/api/mgcp/call-setup` | POST | CRCX + DLCX roundtrip test |

### `/api/mgcp/audit`

Sends an AUEP with `F: A, R, D, S, X, N, I, T, O, ES` to request full endpoint state.

```bash
curl -X POST https://portofcall.example.com/api/mgcp/audit \
  -H "Content-Type: application/json" \
  -d '{
    "host": "gw.example.com",
    "port": 2427,
    "endpoint": "aaln/1",
    "timeout": 10000
  }'
```

Response:
```json
{
  "success": true,
  "command": "AUEP",
  "endpoint": "aaln/1@gw.example.com",
  "responseCode": 200,
  "statusText": "Transaction executed normally",
  "transactionId": "482719305",
  "comment": "OK",
  "params": {
    "A": "a:PCMU;PCMA, p:10-40",
    "R": "L/hd, L/hu"
  },
  "raw": "200 482719305 OK\r\nA: a:PCMU;PCMA, p:10-40\r\nR: L/hd, L/hu\r\n\r\n",
  "latencyMs": 23
}
```

### `/api/mgcp/command`

Send any valid CA-to-GW command. Valid verbs: `AUEP`, `AUCX`, `CRCX`, `MDCX`, `DLCX`, `RQNT`, `EPCF`.

```bash
curl -X POST https://portofcall.example.com/api/mgcp/command \
  -H "Content-Type: application/json" \
  -d '{
    "host": "gw.example.com",
    "port": 2427,
    "endpoint": "aaln/1",
    "command": "RQNT",
    "params": {
      "X": "0000000001",
      "R": "L/hd(N), L/hu(N)",
      "S": "L/dl"
    }
  }'
```

The `params` object maps directly to MGCP parameter lines. For commands that require a Call ID (`CRCX`, `MDCX`, `DLCX`), one is auto-generated if `C` is not in `params`.

### `/api/mgcp/call-setup`

Performs a CRCX followed by a DLCX to test full connection lifecycle. Parses SDP from the CRCX 200 response.

```bash
curl -X POST https://portofcall.example.com/api/mgcp/call-setup \
  -H "Content-Type: application/json" \
  -d '{
    "host": "gw.example.com",
    "endpoint": "aaln/1",
    "connectionMode": "recvonly"
  }'
```

Response:
```json
{
  "success": true,
  "crcxCode": 200,
  "connectionId": "FDE234C8",
  "localSdp": {
    "ip": "192.168.1.100",
    "port": 49152,
    "codec": "PCMU"
  },
  "dlcxCode": 250,
  "rtt": 45
}
```

## Known Deviations from RFC 3435

1. **TCP transport**: RFC 3435 specifies UDP as the primary transport. This implementation uses TCP because Cloudflare Workers' `connect()` API only supports TCP sockets. Most gateways accept both.

2. **No retransmission**: RFC 3435 Section 3.3 defines a retransmission mechanism for UDP reliability. Since we use TCP, this is handled by the transport layer.

3. **No piggybacking**: RFC 3435 Section 3.5 allows piggybacking a response with a new command. This implementation uses separate transactions.

4. **Single-shot connections**: Each command opens a new TCP connection. A production implementation would reuse connections.

## Security Considerations

1. **No built-in security**: MGCP has no native encryption or authentication.
2. **IPsec**: Typically secured with IPsec at the network layer.
3. **Access control**: Restrict MGCP ports (2427, 2727) at the firewall.
4. **SRTP**: Use Secure RTP for media encryption (negotiated via SDP `a=crypto`).
5. **Network isolation**: Keep MGCP traffic on a management VLAN.
6. **Rate limiting**: Protect against command floods.

## Testing

```bash
# Capture MGCP traffic (production uses UDP)
sudo tcpdump -i any port 2427 -A

# Wireshark display filter
mgcp

# Test with portofcall
curl -X POST http://localhost:8787/api/mgcp/audit \
  -H "Content-Type: application/json" \
  -d '{"host": "gw.example.com"}'

# Common test gateways: Cisco IOS, AudioCodes Mediant,
# Ribbon (Sonus), Metaswitch, FreeSWITCH (mod_mgcp)
```

## Related Protocols

- **Megaco/H.248** (RFC 3525): IETF/ITU-T successor, more flexible but more complex.
- **SIP** (RFC 3261): Peer-to-peer signaling, dominant in enterprise VoIP.
- **H.323** (ITU-T H.323): Older VoIP standard with distributed intelligence.
- **PacketCable**: CableLabs specification that mandates MGCP for residential cable VoIP (NCS variant).

## Resources

- [RFC 3435](https://www.rfc-editor.org/rfc/rfc3435) -- MGCP 1.0
- [RFC 2705](https://www.rfc-editor.org/rfc/rfc2705) -- MGCP 0.1 (historical)
- [RFC 3660](https://www.rfc-editor.org/rfc/rfc3660) -- Basic MGCP Packages
- [RFC 3661](https://www.rfc-editor.org/rfc/rfc3661) -- MGCP Return Code Usage
- [IANA MGCP Packages](https://www.iana.org/assignments/mgcp-packages/) -- Registered event packages
- [RFC 3525](https://www.rfc-editor.org/rfc/rfc3525) -- Megaco/H.248
