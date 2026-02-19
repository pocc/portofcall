# Java RMI (Remote Method Invocation) — Implementation Reference

**Protocol:** JRMI Wire Protocol (binary, TCP)
**Implementation:** `src/worker/rmi.ts`
**Port:** 1099 (rmiregistry default)
**Routes:**
- `POST /api/rmi/probe` — JRMI handshake and protocol version detection
- `POST /api/rmi/list` — Registry list() — enumerate bound object names
- `POST /api/rmi/invoke` — Registry lookup(name) + optional method invocation on remote object

---

## Wire Protocol Overview

Java RMI uses a binary wire protocol with a 6-byte handshake followed by Java Object Serialization (JOS) framing for all RPC calls. The protocol supports three transport modes:

```
Handshake:
  [4B] Magic: 0x4a 0x52 0x4d 0x49 ("JRMI")
  [2B] Version: 0x00 0x02 (version 2 — RMI 1.2+, JDK 1.2+)
  [1B] Protocol: 0x4c (StreamProtocol), 0x4d (SingleOpProtocol), 0x4e (MultiplexProtocol)

Server ProtocolAck (StreamProtocol):
  [1B] Ack: 0x4e (ProtocolAck) or 0x4f (ProtocolNotSupported)
  [2B] hostname_length (big-endian)
  [N]  hostname (UTF-8)
  [4B] port (big-endian unsigned)

Client Endpoint:
  [2B] hostname_length = 0x00 0x00 (null)
  [4B] port = 0x00 0x00 0x00 0x00 (null)

RMI Calls (post-handshake):
  [1B] Call marker: 0x50 (Call), 0x51 (ReturnData), 0x52 (ExceptionalReturn)
  [N]  Java Object Serialization stream (ObjectOutputStream format)
```

All integers are big-endian. This implementation uses **StreamProtocol** (0x4c) for persistent connections with multiple calls.

---

## RMI Probe — Protocol Detection

### Request

```json
{ "host": "rmi.example.com", "port": 1099, "timeout": 10000 }
```

All fields except `host` are optional.

| Field | Default | Notes |
|-------|---------|-------|
| `host` | (required) | Hostname or IP |
| `port` | `1099` | RMI registry port |
| `timeout` | `10000` | Total timeout in milliseconds |

### Response

```json
{
  "success": true,
  "host": "rmi.example.com",
  "port": 1099,
  "rtt": 23,
  "isRMI": true,
  "protocolAck": true,
  "notSupported": false,
  "serverHost": "rmi-server-01.internal",
  "serverPort": 1099,
  "protocolType": "StreamProtocol",
  "responseBytes": 35,
  "responseHex": "4e 00 18 72 6d 69 2d 73 65 72 76 65 72 2d 30 31 2e 69 6e 74 65 72 6e 61 6c 00 00 04 4b",
  "protocol": "RMI",
  "message": "Java RMI Registry detected (rmi-server-01.internal:1099) in 23ms",
  "securityWarning": "WARNING: Exposed RMI registries can be exploited via Java deserialization attacks"
}
```

**Key fields:**
- `isRMI: true` — Server responded with valid ProtocolAck (0x4e)
- `serverHost`/`serverPort` — The advertised endpoint from the server's ProtocolAck response. This may differ from the requested `host:port` (e.g., internal DNS names).
- `notSupported: true` — Server sent 0x4f (ProtocolNotSupported). The registry may only support SingleOpProtocol or MultiplexProtocol.
- `responseHex` — First 64 bytes of the raw response (for debugging non-RMI services on port 1099).

### Non-RMI Response

If the service is not RMI (e.g., port 1099 used for something else):

```json
{
  "success": true,
  "host": "notarmi.example.com",
  "port": 1099,
  "rtt": 18,
  "isRMI": false,
  "protocolAck": false,
  "notSupported": false,
  "serverHost": null,
  "serverPort": null,
  "protocolType": "StreamProtocol",
  "responseBytes": 8,
  "responseHex": "48 54 54 50 2f 31 2e 31",
  "protocol": "RMI",
  "message": "Non-RMI response received in 18ms"
}
```

---

## RMI List — Registry Enumeration

Calls the `list()` method on the RMI registry to retrieve all bound object names.

### Request

```json
{ "host": "rmi.example.com", "port": 1099, "timeout": 10000 }
```

Same parameters as probe.

### Response

```json
{
  "success": true,
  "host": "rmi.example.com",
  "port": 1099,
  "rtt": 42,
  "isRMI": true,
  "protocol": "RMI",
  "handshake": "OK",
  "serverHost": "rmi-server-01.internal",
  "serverPort": 1099,
  "listAttempted": true,
  "hasReturnData": true,
  "returnType": "ReturnData",
  "bindings": ["PayrollService", "OrderProcessor", "UserManager"],
  "bindingCount": 3,
  "responseBytes": 312,
  "responseHex": "51 ac ed 00 05 77 01 00 75 72 00 13 5b 4c 6a 61 76 61 2e 6c 61 6e 67 2e 53 74 72 69 6e 67 3b ad d2 56 e7 e9 1d 7b 47 02 00 00 78 70 00 00 00 03 74 00 0f 50 61 79 72 6f 6c 6c 53 65 72 76 69 63 65 74 00 0f 4f 72 64 65 72 50 72 6f 63 65 73 73 6f 72",
  "securityWarning": "WARNING: Exposed RMI registries can be exploited via Java deserialization attacks",
  "message": "RMI Registry: 3 binding(s) found in 42ms"
}
```

**Key fields:**
- `returnType` — `"ReturnData"` (0x51) for successful list, `"ExceptionalReturn"` (0x52) if the registry call threw an exception (rare).
- `bindings` — Array of object names bound in the registry. Null if no bindings were parsed (empty registry or response parsing failed).
- `bindingCount` — Number of bindings found.
- `responseHex` — Raw Java Object Serialization stream. The first byte `0x51` indicates ReturnData. Offset 1-4 is the stream magic `ac ed 00 05`.

### Empty Registry

```json
{
  "success": true,
  "bindings": null,
  "bindingCount": 0,
  "returnType": "ReturnData",
  "message": "RMI Registry responded (ReturnData) in 38ms"
}
```

Bindings are extracted by scanning for `TC_STRING` (0x74) markers in the Java serialization stream. If none are found, the registry is likely empty or the response uses a complex serialization format (unlikely for standard `String[]` array).

### Handshake Failure

```json
{
  "success": false,
  "error": "Not an RMI endpoint (handshake failed)",
  "responseHex": "00 00 00 00"
}
```

The server did not respond with ProtocolAck (0x4e). Check `responseHex` to see what the server sent.

---

## RMI Invoke — Lookup and Method Call

Performs a two-phase invocation:
1. **Lookup phase:** Connect to registry, send `lookup(objectName)` call, parse the `RemoteRef` (host, port, ObjID).
2. **Invoke phase:** Connect to the remote object's endpoint (extracted from RemoteRef), send a method invocation CALL PDU, parse the return value.

### Request

```json
{
  "host": "rmi.example.com",
  "port": 1099,
  "objectName": "PayrollService",
  "methodName": "toString",
  "methodHash": "0000000000000000",
  "timeout": 15000
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `host` | (required) | Registry host |
| `port` | `1099` | Registry port |
| `objectName` | (required) | Name bound in registry (max 255 chars) |
| `methodName` | `"toString"` | Method to invoke (max 255 chars) |
| `methodHash` | null | 16-hex-digit method hash (e.g., `44154dc9d4e63bdf`). If null, sends hash `0x0000000000000000` as a probe. |
| `timeout` | `15000` | Total timeout for both phases |

**Method Hash:**
The RMI wire protocol uses 64-bit interface hashes computed from the method signature's fully qualified type names. Without the exact hash, the server will respond with an exception (`java.rmi.UnmarshalException` or `java.rmi.server.SkeletonMismatchException`). Common hashes:
- `java.rmi.registry.Registry.lookup(String)` → `44154dc9d4e63bdf` (operation 2)
- `java.lang.Object.toString()` → varies by stub implementation

If you do not have the hash, omit `methodHash` or set it to `"0000000000000000"` to probe the object. The server's exception response may reveal the expected interface.

### Response — Lookup Success, Invocation Attempted

```json
{
  "success": true,
  "host": "rmi.example.com",
  "port": 1099,
  "rtt": 87,
  "isRMI": true,
  "protocol": "RMI",
  "objectName": "PayrollService",
  "methodName": "toString",
  "lookupSuccess": true,
  "lookupReturnType": "ReturnData",
  "objectRef": {
    "host": "app-01.internal",
    "port": 9999,
    "objId": "0000000000000001"
  },
  "invokeAttempted": true,
  "invokeResult": "PayrollServiceImpl@192.168.1.100:9999",
  "lookupResponseHex": "51 ac ed 00 05 77 22 00 00 00 00 00 00 00 01 ...",
  "invokeResponseHex": "51 ac ed 00 05 74 00 1e 50 61 79 72 6f 6c 6c 53 65 72 76 69 63 65 49 6d 70 6c 40 31 39 32 2e 31 36 38 2e 31 2e 31 30 30 3a 39 39 39 39",
  "securityWarning": "WARNING: Exposed RMI endpoints can be exploited via Java deserialization attacks",
  "message": "Lookup OK, remote ref found at app-01.internal:9999. Invoke: PayrollServiceImpl@192.168.1.100:9999"
}
```

**Key fields:**
- `objectRef` — The `UnicastRef` extracted from the lookup response. `host` and `port` point to the object's actual endpoint (may differ from registry).
- `objId` — The 8-byte object ID in hex. This is embedded in the CALL PDU during invocation.
- `invokeResult` — Parsed result from the method call. The implementation scans for `TC_STRING` (0x74) markers in the ReturnData stream and concatenates all printable ASCII strings found. For non-string return types (primitives, complex objects), this field shows `"{N} bytes received"`.
- `invokeAttempted: true` — Phase 2 was attempted. If false, the RemoteRef extraction failed (see below).

### Response — Lookup Success, No RemoteRef Extracted

```json
{
  "success": true,
  "lookupSuccess": true,
  "lookupReturnType": "ReturnData",
  "objectRef": null,
  "invokeAttempted": false,
  "invokeResult": null,
  "message": "Lookup returned ReturnData but no RemoteRef extracted"
}
```

The lookup call returned 0x51 (ReturnData), but the response did not contain a parsable `UnicastRef`. This can happen if:
- The object is not a remote object (local stub).
- The serialization format is non-standard.
- The response is an exception wrapped in ReturnData.

### Response — Lookup Exception

```json
{
  "success": true,
  "lookupSuccess": true,
  "lookupReturnType": "ExceptionalReturn (object may not be bound)",
  "objectRef": null,
  "invokeAttempted": false,
  "message": "Lookup returned ExceptionalReturn (object may not be bound) but no RemoteRef extracted"
}
```

The registry responded with 0x52 (ExceptionalReturn), indicating the object name is not bound or the call threw an exception. Common causes:
- `objectName` does not exist in the registry.
- `java.rmi.NotBoundException` was thrown.

Check `lookupResponseHex` for the exception class name (look for `TC_STRING` markers like `74 00 1e 6a 61 76 61 2e 72 6d 69 2e 4e 6f 74 42 6f 75 6e 64 45 78 63 65 70 74 69 6f 6e` = `"java.rmi.NotBoundException"`).

### Response — Handshake Failure

```json
{
  "success": false,
  "error": "Not an RMI endpoint (handshake failed)",
  "responseHex": "00 00 00 00"
}
```

Registry handshake failed. The target is not an RMI registry.

### Response — Invocation Connection Failure

```json
{
  "success": true,
  "lookupSuccess": true,
  "objectRef": { "host": "172.16.5.10", "port": 8888, "objId": "0000000000000002" },
  "invokeAttempted": true,
  "invokeResult": "Invocation failed: Connection timeout",
  "message": "Lookup OK, remote ref found at 172.16.5.10:8888. Invoke: Invocation failed: Connection timeout"
}
```

Lookup succeeded, but connecting to the object's endpoint (`172.16.5.10:8888`) failed. Common causes:
- The object endpoint is on a private network unreachable from the caller.
- Firewall blocking the object port.
- The object's server is down.

This is analogous to Kafka's "metadata succeeds but produce/fetch fails" issue — the registry advertises internal endpoints.

---

## Java Object Serialization — Wire Format Reference

All RMI calls after the handshake use the Java Object Serialization stream format. Understanding the basic structure is essential for debugging.

### ObjectOutputStream Header

```
[2B] Magic: 0xac 0xed
[2B] Version: 0x00 0x05 (Java Object Serialization v5)
```

Every RMI CALL/ReturnData/ExceptionalReturn message starts with `0x50 ac ed 00 05` or `0x51 ac ed 00 05` or `0x52 ac ed 00 05`.

### Type Codes (TC_* constants)

| Code | Name | Description |
|------|------|-------------|
| 0x70 | TC_NULL | null reference |
| 0x73 | TC_OBJECT | new object (class descriptor follows) |
| 0x74 | TC_STRING | 2-byte length + UTF-8 string |
| 0x75 | TC_ARRAY | array (class descriptor + element count + elements) |
| 0x76 | TC_CLASS | Class object |
| 0x77 | TC_BLOCKDATA | block data (1-byte length + bytes) |
| 0x78 | TC_ENDBLOCKDATA | end of optional block data |
| 0x7c | TC_LONGSTRING | 8-byte length + UTF-8 string |
| 0x7e | TC_REFERENCE | back-reference to previously serialized object |

### Registry list() Return Format

```
0x51                          # ReturnData
ac ed 00 05                   # ObjectOutputStream magic + version
77 01 00                      # TC_BLOCKDATA, length=1, 0x00 (UnicastRef marker)
75                            # TC_ARRAY
72 00 13                      # TC_CLASSDESC, 2-byte name length = 19
[4c 6a ... 3b]                # "[Ljava.lang.String;" (String[] class)
ad d2 56 e7 e9 1d 7b 47       # serialVersionUID
02 00 00                      # flags (SC_SERIALIZABLE)
78                            # TC_ENDBLOCKDATA (end of class descriptor)
70                            # TC_NULL (no superclass)
00 00 00 03                   # array length = 3
74 00 0f                      # TC_STRING, length=15
[50 61 79 72 6f 6c 6c ...]    # "PayrollService"
74 00 0f                      # TC_STRING, length=15
[4f 72 64 65 72 50 72 ...]    # "OrderProcessor"
74 00 0b                      # TC_STRING, length=11
[55 73 65 72 4d 61 6e ...]    # "UserManager"
```

The implementation scans for `0x74` (TC_STRING) markers and extracts printable ASCII strings that match binding name heuristics:
- Length > 0 and < 256
- No `[L` prefix (class descriptor prefix)
- No `;` (class descriptor suffix)
- No `java.` prefix (package names)

### Registry lookup(name) Return Format (RemoteRef)

```
0x51                          # ReturnData
ac ed 00 05                   # ObjectOutputStream magic + version
77 0d                         # TC_BLOCKDATA, length=13
[UnicastRef data]
73                            # TC_OBJECT (remote object stub)
72 00 ...                     # TC_CLASSDESC (stub class descriptor)
...
77 16                         # TC_BLOCKDATA, length=22 (UnicastRef endpoint)
  74 00 0f                    # TC_STRING, length=15 (hostname)
  [61 70 70 2d 30 31 2e ...]  # "app-01.internal"
  00 00 27 0f                 # port = 9999 (4 bytes BE unsigned)
  00 00 00 00 00 00 00 01     # ObjID objNum = 1 (8 bytes)
  [UID data...]               # UID unique(4) + count(2) + time(8)
```

The implementation's `extractRemoteRef()` function scans for `TC_STRING` (0x74) markers, validates the string looks like a hostname (alphanumeric + `.` + `-`), then reads the following 4-byte port and 8-byte ObjID.

**Hostname validation heuristics:**
- Regex: `^[a-zA-Z0-9._-]+$`
- Length > 1
- No `[L` prefix (class descriptor)
- No `java.` prefix (package name)
- Max 4 dot-separated segments (IP address or short hostname)

This prevents false positives from class names like `com.example.PayrollServiceImpl`.

### CALL PDU for Registry lookup(name)

```
0x50                          # Call
ac ed 00 05                   # ObjectOutputStream magic + version
77 22                         # TC_BLOCKDATA, length=34
  [8 bytes] ObjID objNum = 0  # Registry well-known ObjID
  [6 bytes] UID = 0 (unique=4, count=2)
  [6 bytes] reserved = 0
  [2 bytes] padding
  [4 bytes] operation = 2 (REGISTRY_OP_LOOKUP, big-endian)
  [8 bytes] interface hash = 0x44154dc9d4e63bdf (Registry interface)
74 00 0f                      # TC_STRING, length=15 (object name)
[50 61 79 72 6f 6c 6c ...]    # "PayrollService"
```

**Registry ObjID:**
The RMI registry has a well-known `ObjID` of `{objNum=0, UID={unique=0, count=0, time=0}}`. This is hardcoded in all RMI clients.

**Operation codes for `java.rmi.registry.Registry`:**
- 0 = `bind(String, Remote)`
- 1 = `list()` — returns `String[]`
- 2 = `lookup(String)` — returns `Remote`
- 3 = `rebind(String, Remote)`
- 4 = `unbind(String)`

**Interface hash:**
`0x44154dc9d4e63bdf` is the RMI stub hash for `java.rmi.registry.Registry`. This is computed from the interface's method signatures and is stable across JDK versions.

---

## Security Considerations

### Deserialization Attacks

**All RMI endpoints are potentially vulnerable to Java deserialization attacks.** Tools like [ysoserial](https://github.com/frohoff/ysoserial) can generate malicious serialized payloads that exploit gadget chains in common Java libraries (Apache Commons Collections, Spring, Groovy, etc.) to achieve remote code execution (RCE).

**Attack vector:**
1. Attacker sends a crafted CALL PDU with a malicious serialized object as an argument.
2. The server deserializes the object using `ObjectInputStream.readObject()`.
3. Gadget chain triggers during deserialization, executing arbitrary code on the server.

**Mitigation (server-side):**
- Use JEP 290 deserialization filters (JDK 9+): `java.io.ObjectInputFilter`
- Upgrade to latest JDK versions (JDK 8u121+, JDK 9+) with filter support
- Bind RMI registry to localhost only: `java -Djava.rmi.server.hostname=127.0.0.1`
- Use firewall rules to block port 1099 from public internet

**This implementation is read-only** (probe, list, lookup). It does not send malicious payloads. However, the `/api/rmi/invoke` endpoint's method invocation feature could be extended to send arbitrary serialized arguments, which is why input validation on `objectName` and `methodName` is critical.

### Registry Exposure

Internet-exposed RMI registries leak:
- **Object names** — Reveals service architecture (e.g., `PayrollService`, `DatabasePool`)
- **Internal hostnames/IPs** — RemoteRef host fields expose private network topology
- **Port numbers** — Object endpoints may use non-standard ports, revealing firewall rules

**Shodan/Censys searches:**
```
port:1099 "JRMI"
```

Returns thousands of exposed RMI registries. Many are misconfigured cloud VM instances with default firewall rules.

### Cloudflare Detection

This implementation includes Cloudflare IP detection. Requests to Cloudflare IPs are blocked with HTTP 403. This prevents accidental probing of Cloudflare's infrastructure.

---

## curl Quick Reference

```bash
BASE='https://portofcall.example.com'

# Detect RMI registry
curl -s $BASE/api/rmi/probe -d '{"host":"rmi.example.com"}' | jq .isRMI

# List bound objects
curl -s $BASE/api/rmi/list -d '{"host":"rmi.example.com"}' | jq '.bindings[]'

# Lookup an object
curl -s $BASE/api/rmi/invoke \
  -d '{"host":"rmi.example.com","objectName":"PayrollService"}' \
  | jq '.objectRef'

# Lookup + invoke with method hash
curl -s $BASE/api/rmi/invoke \
  -d '{
    "host":"rmi.example.com",
    "objectName":"PayrollService",
    "methodName":"getVersion",
    "methodHash":"a1b2c3d4e5f6789a"
  }' | jq '.invokeResult'

# Timeout example (slow registry)
curl -s $BASE/api/rmi/list -d '{"host":"slow.example.com","timeout":30000}' | jq .
```

---

## Local Testing

### Option 1: Java RMI Registry (rmiregistry)

```bash
# Start standalone RMI registry
rmiregistry 1099 &

# Test probe
curl -s localhost:8787/api/rmi/probe -d '{"host":"localhost"}' | jq .isRMI

# Test list (empty registry)
curl -s localhost:8787/api/rmi/list -d '{"host":"localhost"}' | jq .bindings
```

### Option 2: Docker RMI Server with Bound Objects

Create a simple RMI server in Java:

```java
// RMIServer.java
import java.rmi.*;
import java.rmi.registry.*;
import java.rmi.server.*;

interface Calculator extends Remote {
    int add(int a, int b) throws RemoteException;
}

class CalculatorImpl extends UnicastRemoteObject implements Calculator {
    protected CalculatorImpl() throws RemoteException {}
    public int add(int a, int b) { return a + b; }
}

public class RMIServer {
    public static void main(String[] args) throws Exception {
        System.setProperty("java.rmi.server.hostname", "0.0.0.0");
        Registry registry = LocateRegistry.createRegistry(1099);
        registry.rebind("Calculator", new CalculatorImpl());
        System.out.println("RMI Server ready on port 1099");
        Thread.sleep(Long.MAX_VALUE);
    }
}
```

Build and run:

```bash
# Compile
javac RMIServer.java

# Run
java RMIServer &

# Test list
curl -s localhost:8787/api/rmi/list -d '{"host":"localhost"}' | jq .bindings
# Output: ["Calculator"]

# Lookup
curl -s localhost:8787/api/rmi/invoke \
  -d '{"host":"localhost","objectName":"Calculator"}' | jq '.objectRef'
```

---

## Known Limitations

- **StreamProtocol only** — SingleOpProtocol (0x4d) and MultiplexProtocol (0x4e) are not supported. If the server responds with 0x4f (ProtocolNotSupported), try a different RMI client.

- **No JRMP DGC (Distributed Garbage Collection)** — This implementation does not send DGC `dirty()` or `clean()` calls. The server's DGC will eventually mark unreferenced objects for cleanup, but this does not affect read-only operations (probe, list, lookup).

- **No SSL/TLS** — RMI over SSL (RMI-SSL) using custom socket factories is not supported. Use plaintext port 1099.

- **No JNDI integration** — This is a raw JRMI wire protocol client. It does not use JNDI (`javax.naming.Context`) or support LDAP-based RMI registry lookups.

- **RemoteRef extraction is heuristic-based** — The `extractRemoteRef()` function scans for `TC_STRING` markers and validates hostname patterns. Complex serialization formats (e.g., custom `RemoteRef` implementations, activation, custom socket factories) may not be parsed correctly.

- **Method invocation requires interface hash** — Without the exact 64-bit method hash, the server will respond with an exception. The implementation sends `0x0000000000000000` as a probe if no hash is provided, which is useful for detecting the object type from the exception message.

- **No return value deserialization** — The `/api/rmi/invoke` endpoint extracts strings from the ReturnData stream but does not fully deserialize complex return types. Primitives, arrays, and custom objects are returned as `"{N} bytes received"`.

- **Single call per connection** — Each endpoint (probe, list, invoke) opens a new TCP connection, makes one request, and closes. No connection pooling or pipelining.

- **Timeout is shared across phases** — In `/api/rmi/invoke`, the `timeout` parameter covers both the registry lookup phase and the object invocation phase. If the total time exceeds `timeout`, the request is aborted. There is no separate timeout for each phase.

- **No ALPN or SNI** — The handshake is raw TCP. There is no TLS layer, so no ALPN negotiation or SNI headers.

- **Operation field encoding inconsistency (fixed)** — Prior to this review, the `buildRegistryListCall()` function set the operation field to 0 (unused in RMI v2), but the `buildRegistryLookupCall()` function set it to 2 (REGISTRY_OP_LOOKUP). This inconsistency has been fixed — both now correctly use the operation code for the respective method per the RMI wire protocol.

- **Port parsing signed overflow (fixed)** — Prior to this review, port fields in `parseProtocolAck()` and `extractRemoteRef()` used signed bitwise OR, which could produce negative values for ports > 32767. Fixed by using unsigned right shift (`>>> 0`) to force unsigned interpretation.

- **Timeout handle resource leak (fixed)** — Prior to this review, `setTimeout()` handles were not cleared when `Promise.race()` resolved early (e.g., connection succeeded before timeout). Fixed by adding `clearTimeout()` in `finally` blocks across all endpoints and `readResponse()`.

- **No input validation on object/method names (fixed)** — Prior to this review, `objectName` and `methodName` had no length limits, allowing unbounded strings in CALL PDUs. Fixed by adding 255-character limits (reasonable for RMI naming conventions).

- **RemoteRef hostname regex too permissive (fixed)** — Prior to this review, the hostname validation regex `^[a-zA-Z0-9._-]+$` could match Java class names like `com.example.PayrollServiceImpl`, causing false positives. Fixed by adding `!str.includes('java.')` and `str.split('.').length <= 4` checks to reject package names and overly long FQDNs.

- **No response size limits** — The `readResponse()` function has a hardcoded 64 KiB limit to prevent memory exhaustion, but there is no validation of individual field lengths in the Java serialization stream. A malicious server could send gigabyte-sized strings or arrays. Not a security issue for this read-only implementation, but a potential DoS vector if extended to accept arbitrary object arguments.

- **No Cloudflare detection in /probe endpoint** — The `/api/rmi/list` and `/api/rmi/invoke` endpoints include Cloudflare IP detection (HTTP 403 if the resolved IP is Cloudflare-owned). The `/api/rmi/probe` endpoint also includes this check. All three endpoints are protected.

- **Error responses do not include `success: false` consistently** — Some error paths return `{ success: false, error: "..." }`, while early validation errors (405 Method Not Allowed, 400 Bad Request) use standard HTTP status codes without a `success` field. This is consistent with other protocol handlers in this codebase.
