# ZMTP — ZeroMQ Message Transport Protocol

**Spec:** [RFC 37 — ZMTP 3.1](https://rfc.zeromq.org/spec/37/)
**Port:** 5555 (conventional; not IANA-assigned)
**Transport:** TCP (ZMTP 3.x), UNIX domain sockets, PGM, EPGM, IPC
**Probed by:** `/api/zmtp/probe`, `/api/zmtp/handshake`, `/api/zmtp/send`, `/api/zmtp/recv`

---

## Overview

ZMTP is the binary wire protocol underneath all ZeroMQ socket types. It handles:

1. **Connection greeting** — version negotiation and security mechanism selection
2. **Security handshake** — NULL (no auth), PLAIN (username/password), CURVE (Curve25519 ECDH)
3. **Metadata exchange** — socket type, identity, and custom properties via READY commands
4. **Framing** — multi-part messages with MORE flag, short (≤255 bytes) and long (up to 2⁶⁴−1 bytes) frames

ZMTP is purely connection-oriented and full-duplex. There is no request/response lock-step at the transport level; higher-level semantics (REQ/REP, PUB/SUB, etc.) are enforced by the socket type metadata.

---

## Greeting Handshake

Both peers send a 64-byte greeting simultaneously on connect (no one speaks first; greetings are interleaved at the TCP level).

```
Offset  Size  Field
──────  ────  ─────────────────────────────────────────────────────────
0       1     Signature high byte: 0xFF
1       8     Padding (all 0x00) — exists for ZMTP 1.0 backwards compat
9       1     Signature low byte: 0x7F
10      1     Major version (3 for ZMTP 3.x)
11      1     Minor version (0 = ZMTP 3.0, 1 = ZMTP 3.1)
12      20    Security mechanism, ASCII, NUL-padded ("NULL", "PLAIN", "CURVE")
32      1     as-server flag (1 if this peer is the CURVE server role, else 0)
33      31    Filler (all 0x00)
```

**Total: 64 bytes.**

### Signature validation

A valid ZMTP greeting satisfies:

- `data[0] == 0xFF`
- `data[9] == 0x7F`
- `data[10] >= 3` (major version)

The padding bytes (1–8) are always zero in ZMTP 3.x. Their pattern (`0xFF <8 zero bytes> 0x7F`) was deliberately chosen to be incompatible with ZMTP 1.x's length-based framing, allowing either party to detect an old peer and close gracefully.

### Version negotiation

Each peer uses the **lower** of the two advertised versions. If the peer sends major version < 3, the connection must be closed — ZMTP 3.x is not backwards compatible with ZMTP 1.x or 2.x at the protocol level.

### Mechanism selection

After the greeting exchange each peer knows the other's proposed mechanism. Both peers **must agree** on the same mechanism; a mismatch is an error. The three standard mechanisms:

| Mechanism | Bytes 12–15 | Auth | Encryption |
|-----------|-------------|------|------------|
| NULL      | `4e 55 4c 4c` ("NULL") | None | None |
| PLAIN     | `50 4c 41 49 4e` ("PLAIN") | Username/password | None |
| CURVE     | `43 55 52 56 45` ("CURVE") | Curve25519 | Curve25519 |

This implementation probes with **NULL** only. PLAIN and CURVE require additional handshake frames not implemented here.

---

## Frame Format

After the greeting, all data is exchanged as frames.

### Short frame (body ≤ 255 bytes)

```
Byte 0:  flags
Byte 1:  body length (0–255)
Bytes 2+: body
```

### Long frame (body > 255 bytes)

```
Byte 0:    flags | 0x02
Bytes 1–8: body length as 64-bit big-endian unsigned integer
Bytes 9+:  body
```

### Flags byte

```
Bit 0 (0x01): MORE — more message parts follow (multi-part message)
Bit 1 (0x02): LONG — 8-byte size field instead of 1-byte
Bit 2 (0x04): COMMAND — this frame is a command frame, not a message frame
Bits 3–7:     Reserved (must be 0)
```

Combined flag values:

| Value | Meaning                         |
|-------|---------------------------------|
| 0x00  | Short message frame, last part  |
| 0x01  | Short message frame, more parts |
| 0x02  | Long message frame, last part   |
| 0x03  | Long message frame, more parts  |
| 0x04  | Short command frame             |
| 0x06  | Long command frame              |

---

## Command Frames

Commands have the COMMAND flag (0x04) set. The body layout is:

```
Byte 0:      command-name length (1 byte, 1–255)
Bytes 1–N:   command-name (ASCII, e.g. "READY", "ERROR", "SUBSCRIBE")
Bytes N+1+:  command-specific data
```

### READY command (NULL and PLAIN mechanisms)

Sent by both peers after greeting (and after PLAIN auth, if applicable). Contains metadata as property pairs:

```
Command name: "READY" (5 bytes)
Metadata pairs (repeating):
  1 byte:    property-name length
  N bytes:   property-name (case-insensitive)
  4 bytes BE: property-value length (unsigned)
  M bytes:   property-value
```

**Critical:** The property-name length is **1 byte** (not 4). A common implementation bug is using 4-byte big-endian encoding for both key and value lengths — this is wrong. Only the *value* uses a 4-byte length.

Standard metadata properties:

| Property     | Description                                | Example           |
|--------------|--------------------------------------------|-------------------|
| Socket-Type  | ZeroMQ socket type string                  | `REP`, `PUB`      |
| Identity     | Socket identity (DEALER/ROUTER sockets)    | `""` or `"worker-1"` |
| Resource     | Application-specific resource identifier   | (rarely used)     |

### ERROR command

Sent when a peer detects a protocol error before or during the handshake:

```
Command name: "ERROR" (5 bytes)
Body:
  1 byte:  reason length
  N bytes: reason string (human-readable)
```

After sending ERROR, the peer must close the connection.

### SUBSCRIBE / CANCEL commands (PUB/SUB)

Used by SUB/XSUB sockets to manage topic subscriptions:

```
Command name: "SUBSCRIBE" or "CANCEL"
Body (after command name): raw topic bytes (prefix filter)
```

The topic bytes immediately follow the command name (no property encoding). An empty topic subscribes to all messages.

---

## Socket Types and Compatibility

ZMTP enforces socket-type compatibility via the Socket-Type metadata property. Incompatible socket pairs must send an ERROR and close.

| Socket Type | Compatible Peer Types            | Pattern        |
|-------------|----------------------------------|----------------|
| REQ         | REP, ROUTER                      | Request/reply  |
| REP         | REQ, DEALER                      | Request/reply  |
| DEALER      | REP, DEALER, ROUTER              | Async request  |
| ROUTER      | REQ, DEALER, ROUTER              | Async routing  |
| PUB         | SUB, XSUB                        | Publish        |
| SUB         | PUB, XPUB                        | Subscribe      |
| XPUB        | SUB, XSUB                        | Extended pub   |
| XSUB        | PUB, XPUB                        | Extended sub   |
| PUSH        | PULL                             | Pipeline       |
| PULL        | PUSH                             | Pipeline       |
| PAIR        | PAIR                             | Exclusive pair |

### REQ/REP envelope convention

REQ sockets **prepend an empty delimiter frame** (flags=0x00, size=0x00) before the message body. This empty frame acts as an address separator that ROUTER sockets use to reconstruct the reply path. REP automatically strips and re-adds this delimiter. If you implement a REQ socket manually and omit the delimiter, the peer will discard or misparse your message.

---

## Security Mechanisms

### NULL (no authentication)

1. Both peers send 64-byte greeting with mechanism = `"NULL\x00..."`
2. Both peers send READY command with metadata
3. Both peers may begin sending message frames immediately after their own READY is sent

The NULL mechanism provides no authentication or confidentiality.

### PLAIN (username/password)

PLAIN adds two commands after the greeting:

- **Client** sends `HELLO` command: `username-length (1 byte) + username + password-length (1 byte) + password`
- **Server** responds with `WELCOME` (success) or `ERROR` (failure)
- After welcome, both sides exchange READY

PLAIN is cleartext — do not use over untrusted networks without TLS wrapping.

### CURVE (Curve25519 elliptic-curve cryptography)

CURVE provides mutual authentication and forward-secret encryption. It uses:

- Long-term keypairs (server public key is pre-shared out-of-band)
- Short-term session keypairs (generated per connection)
- NaCl `crypto_box` for authenticated encryption

CURVE handshake sequence:

1. Client sends `HELLO` (client ephemeral public key + antiamplification padding)
2. Server sends `WELCOME` (encrypted server ephemeral key + cookie)
3. Client sends `INITIATE` (verifies server; sends vouch + client metadata encrypted)
4. Server sends `READY` (server metadata encrypted)

After READY, all subsequent frames are encrypted with NaCl `crypto_secretbox`.

**This implementation does not support CURVE.** If the server advertises CURVE, the probe will complete the greeting but the handshake will fail or produce an ERROR from the server.

---

## Full Handshake Flow (NULL mechanism)

```
Client                              Server
  |                                    |
  |──── 64-byte greeting ─────────────>|
  |<─── 64-byte greeting ──────────────|
  |                                    |  (greetings sent simultaneously)
  |──── READY {Socket-Type: DEALER} ──>|
  |<─── READY {Socket-Type: ROUTER} ───|
  |                                    |
  |──── message frame(s) ─────────────>|
  |<─── message frame(s) ──────────────|
```

After the READY exchange both sides can send message frames freely. Commands (SUBSCRIBE, CANCEL, PING, PONG) can also be interspersed.

---

## PING / PONG (ZMTP 3.1 only)

ZMTP 3.1 adds heartbeat commands to detect dead connections without application-level keepalives:

```
PING command body:
  2 bytes BE: TTL in tenths of a second
  N bytes:    context (arbitrary, echoed in PONG)

PONG command body:
  N bytes: context (copied from PING)
```

A peer that receives PING must respond with PONG within the TTL period. If no PONG is received, the sender may close the connection.

This implementation does not send PING frames, but correctly ignores PING/PONG command frames during message collection (they have the COMMAND flag set and are filtered out).

---

## API Endpoints

### `POST /api/zmtp/probe`

Sends a 64-byte greeting and reads the server greeting. No READY command is exchanged. Minimal disruption to the server.

**Request:**
```json
{
  "host": "zmq.example.com",
  "port": 5555,
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "isZMTP": true,
  "signatureValid": true,
  "version": "3.1",
  "majorVersion": 3,
  "minorVersion": 1,
  "mechanism": "NULL",
  "asServer": true,
  "greetingBytes": 64,
  "greetingHex": "ff 00 00 00 00 00 00 00 00 7f 03 01 4e 55 4c 4c ...",
  "rtt": 12,
  "protocol": "ZMTP",
  "message": "ZeroMQ ZMTP 3.1 detected (NULL mechanism) in 12ms"
}
```

### `POST /api/zmtp/handshake`

Completes the full NULL-mechanism handshake (greeting + READY exchange) and extracts server metadata.

**Request:**
```json
{
  "host": "zmq.example.com",
  "port": 5555,
  "socketType": "DEALER",
  "timeout": 10000
}
```

**Response:**
```json
{
  "success": true,
  "isZMTP": true,
  "version": "3.1",
  "mechanism": "NULL",
  "asServer": true,
  "handshakeComplete": true,
  "serverCommand": "READY",
  "serverSocketType": "ROUTER",
  "serverIdentity": null,
  "clientSocketType": "DEALER",
  "peerMetadata": { "Socket-Type": "ROUTER" },
  "rtt": 18,
  "protocol": "ZMTP"
}
```

Valid `socketType` values: `REQ`, `REP`, `DEALER`, `ROUTER`, `PUB`, `SUB`, `XPUB`, `XSUB`, `PUSH`, `PULL`, `PAIR`.

### `POST /api/zmtp/send`

Performs handshake and sends a message frame (or multi-part for PUB). For REQ/DEALER sockets, waits for and returns the reply.

**Request:**
```json
{
  "host": "zmq.example.com",
  "port": 5555,
  "socketType": "PUSH",
  "message": "hello",
  "timeout": 10000
}
```

For PUB with topic:
```json
{
  "socketType": "PUB",
  "topic": "sensor.temperature",
  "message": "23.4"
}
```

### `POST /api/zmtp/recv`

Performs handshake, optionally subscribes (SUB sockets), and collects incoming message frames for `timeoutMs` milliseconds.

**Request:**
```json
{
  "host": "zmq.example.com",
  "port": 5555,
  "socketType": "SUB",
  "topic": "sensor.",
  "timeoutMs": 2000
}
```

**Response:**
```json
{
  "success": true,
  "messages": ["sensor.temperature 23.4", "sensor.humidity 65"],
  "count": 2
}
```

---

## netcat / Manual Protocol Examples

### Probe with netcat (read server greeting)

```bash
# Send 64-byte greeting and capture 64-byte response
python3 -c "
import sys
g = bytearray(64)
g[0] = 0xff; g[9] = 0x7f
g[10] = 3;  g[11] = 1       # version 3.1
g[12:16] = b'NULL'           # mechanism
sys.stdout.buffer.write(bytes(g))
" | nc zmq.example.com 5555 | xxd | head -4
```

Expected output (first 16 bytes):
```
00000000: ff00 0000 0000 0000 7f03 014e 554c 4c00  ...........NULL.
```

### Decode a greeting hex dump

```
ff 00 00 00 00 00 00 00 00 7f  — signature (bytes 0,9)
03 01                           — version 3.1
4e 55 4c 4c 00 00 00 00 ...    — "NULL" mechanism (20 bytes)
01                              — as-server = true
00 00 00 ... (31 bytes)        — filler
```

### Construct and send a READY command (NULL mechanism)

The READY command for a DEALER socket with Socket-Type property:

```
04        flags: command, short frame
1a        body length = 26 bytes
05        command-name-length = 5
52 45 41 44 59   "READY"
0b        key-name-length = 11  (1 byte, NOT 4!)
53 6f 63 6b 65 74 2d 54 79 70 65   "Socket-Type"
00 00 00 06  value-length = 6
44 45 41 4c 45 52  "DEALER"
```

Hex: `04 1a 05 52 45 41 44 59 0b 53 6f 63 6b 65 74 2d 54 79 70 65 00 00 00 06 44 45 41 4c 45 52`

### Python test client

```python
import socket, struct

def make_greeting():
    g = bytearray(64)
    g[0] = 0xff; g[9] = 0x7f; g[10] = 3; g[11] = 1
    g[12:16] = b'NULL'
    return bytes(g)

def make_ready(socket_type: str) -> bytes:
    key = b'Socket-Type'
    val = socket_type.encode()
    # body = cmd-name-len(1) + "READY"(5) + key-len(1) + key + val-len(4) + val
    body = bytes([5]) + b'READY' + bytes([len(key)]) + key + struct.pack('>I', len(val)) + val
    return bytes([0x04, len(body)]) + body

host, port = 'zmq.example.com', 5555
with socket.create_connection((host, port), timeout=5) as s:
    s.sendall(make_greeting())
    greeting = s.recv(64)
    assert greeting[0] == 0xff and greeting[9] == 0x7f, "Not ZMTP"
    print(f"ZMTP {greeting[10]}.{greeting[11]}, mechanism: {greeting[12:32].rstrip(b'\\x00').decode()}")
    s.sendall(make_ready('DEALER'))
    ready = s.recv(256)
    print(f"Server READY: {ready.hex()}")
```

---

## Known Limitations

1. **NULL mechanism only** — PLAIN and CURVE handshakes are not implemented. If a server requires PLAIN or CURVE, the probe will succeed but the handshake will fail (the server will send ERROR or close the connection).

2. **No ZMTP 2.0 / 1.0 compatibility** — The code does not detect or handle ZMTP 1.x framing (which uses a 1-byte length prefix rather than the 64-byte greeting). ZMTP 1.x servers will not send the 0xFF/0x7F signature so they will be correctly identified as non-ZMTP.

3. **Partial greeting detection** — If fewer than 64 bytes arrive before timeout, `parseZMTPGreeting` attempts to parse what it has (requires at least 12 bytes to extract version). `signatureValid` will be false, and `valid` will also be false. The `greetingBytes` field in the response indicates how many bytes were actually received.

4. **No multi-frame message assembly** — The recv endpoint collects individual message frames and decodes each as a UTF-8 string. Multi-part messages (MORE flag set) are not reassembled; each part appears as a separate entry in the `messages` array.

5. **No streaming / long-poll** — All endpoints are request/response HTTP. The recv endpoint collects messages for at most `timeoutMs` milliseconds (max 2 seconds by default, 10 seconds max per the connection timeout). For high-throughput topics this window may miss messages.

6. **PING/PONG not sent** — The implementation does not send PING heartbeats. Long-lived connections (longer than the server's heartbeat TTL) may be silently dropped. The typical probe/recv window is short enough that this is not a practical problem.

7. **Large message frames** — Message bodies larger than ~64 KB are truncated by `readResponse`'s `maxBytes = 64 * 1024` guard. The frame length field is still parsed correctly for long frames, but the payload copy may be incomplete.

---

## Edge Cases

### Server sends greeting before client

ZMTP allows either side to begin sending its greeting immediately on TCP connect. The implementation sends its greeting first and then reads the server's, but in practice both are pipelined over TCP and arrive almost simultaneously.

### Incomplete greeting (< 64 bytes)

Some load balancers or firewalls will echo back only a partial response. `parseZMTPGreeting` handles this gracefully:
- < 10 bytes: returns `signatureValid: false`
- 10–63 bytes: returns partial version info; `signatureValid` depends on bytes 0 and 9
- `valid` is always false for partial greetings

### Non-ZeroMQ service on port 5555

Common services also found on 5555: Android Debug Bridge (ADB), some game servers. The probe will return `isZMTP: false` with `greetingHex` for manual inspection.

### CURVE server responding to NULL client

A CURVE-only server will respond with a valid ZMTP greeting (mechanism = "CURVE") but will then immediately send an ERROR command after receiving our READY (since we claimed NULL). The probe endpoint will see the greeting and report `isZMTP: true, mechanism: "CURVE"`. The handshake endpoint will see `handshakeComplete: false` and `serverCommand: "ERROR"`.

### as-server flag interpretation

The `as-server` bit in the greeting (byte 32) has no semantic meaning for the NULL mechanism — it is only meaningful for CURVE (where it determines which side performs the server role in the ECDH exchange). With NULL, both peers should set it to 0, but this is not enforced. Some older libzmq builds incorrectly set it to 1 on all connections regardless of mechanism.

---

## Wireshark Dissection

Wireshark has a built-in ZMTP dissector. To use it:

1. Capture on the target port
2. Right-click a TCP stream → **Decode As** → **ZMTP**
3. Or set in preferences: **Analyze → Enabled Protocols → ZMTP**

The dissector recognises the 0xFF/0x7F signature and will label greeting fields, command frames, and message frames correctly.

---

## References

- [RFC 37 — ZMTP 3.1](https://rfc.zeromq.org/spec/37/)
- [RFC 23 — ZMTP 2.0](https://rfc.zeromq.org/spec/23/)
- [RFC 27 — ZMTP PLAIN](https://rfc.zeromq.org/spec/27/)
- [RFC 26 — ZMTP CURVE](https://rfc.zeromq.org/spec/26/)
- [ZeroMQ Guide](https://zguide.zeromq.org/)
- [libzmq source](https://github.com/zeromq/libzmq)
