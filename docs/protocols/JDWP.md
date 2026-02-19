# JDWP (Java Debug Wire Protocol) Reference

## Overview

JDWP is the wire protocol for communication between a debugger and the Java Virtual Machine (JVM) being debugged. It is part of the **JPDA** (Java Platform Debugger Architecture) stack, sitting between the JDI (Java Debug Interface) front-end and the JVMTI (JVM Tool Interface) back-end.

| Property | Value |
|---|---|
| **Protocol type** | Binary (big-endian) with ASCII handshake |
| **Transport** | TCP (dt_socket) or shared memory (dt_shmem) |
| **Default port** | **5005** (de facto standard for `dt_socket`) |
| **Spec author** | Oracle / Sun Microsystems |
| **First release** | JDK 1.3 (2000), part of JPDA |
| **RFC/Spec** | [Oracle JDWP Specification](https://docs.oracle.com/en/java/javase/21/docs/specs/jdwp/jdwp-spec.html) |

### Common ports in the wild

| Port | Usage |
|---|---|
| 5005 | Standard IDE debugging (IntelliJ, Eclipse, VS Code) |
| 8000 | Legacy/alternative (older tutorials, Tomcat debug) |
| 9000 | Some application servers |
| 5050 | Alternative when 5005 is taken |

### Security warning

**Exposed JDWP ports allow unauthenticated arbitrary code execution on the JVM.** JDWP has no authentication mechanism. Any client that can complete the handshake can load classes, invoke methods, and fully control the JVM. Never expose JDWP to untrusted networks.

---

## Handshake

Before any binary packets are exchanged, both sides perform a plain ASCII handshake:

1. **Debugger sends:** `JDWP-Handshake` (exactly 14 bytes, ASCII)
2. **VM replies:** `JDWP-Handshake` (exactly 14 bytes, ASCII)

```
Hex: 4a 44 57 50 2d 48 61 6e 64 73 68 61 6b 65
```

If the server does not reply with the exact same 14 bytes, it is not a JDWP endpoint. The handshake must complete before any command/reply packets are sent.

---

## Packet Format

After the handshake, all communication uses binary packets. All multi-byte integers are **big-endian** (network byte order).

### Command Packet (11-byte header + data)

```
Offset  Size  Field        Description
------  ----  -----------  -------------------------------------------
0       4     length       Total packet length (header + data), unsigned
4       4     id           Unique command identifier (monotonic counter)
8       1     flags        0x00 for command packets
9       1     commandSet   Command set number (see below)
10      1     command      Command number within the set
11      var   data         Command-specific payload
```

### Reply Packet (11-byte header + data)

```
Offset  Size  Field        Description
------  ----  -----------  -------------------------------------------
0       4     length       Total packet length (header + data), unsigned
4       4     id           Matches the id of the command being replied to
8       1     flags        0x80 for reply packets
9       2     errorCode    0 = success, non-zero = error (see Error Codes)
11      var   data         Reply-specific payload
```

**Key notes:**
- Both headers are 11 bytes. The minimum packet size is 11 (header only, no data).
- The `length` field includes the header itself. A header-only packet has `length = 11`.
- The `id` field in a reply matches the `id` of the corresponding command. IDs must be unique among all outstanding (unacknowledged) commands from a given source.
- The protocol is **asynchronous**: multiple commands can be sent before any replies are received. Replies may arrive out of order.
- The `flags` byte determines how to interpret bytes 9-10: as commandSet+command (0x00) or as errorCode (0x80).

---

## Data Types

All data within packet payloads uses these types:

| Type | Size | Description |
|---|---|---|
| `byte` | 1 | Unsigned 8-bit integer |
| `boolean` | 1 | 0 = false, non-zero = true |
| `int` | 4 | Signed 32-bit big-endian |
| `long` | 8 | Signed 64-bit big-endian |
| `string` | 4 + N | 4-byte length prefix (big-endian) + N bytes of modified UTF-8 |
| `objectID` | variable | Size determined by `IDSizes` reply (typically 8 bytes) |
| `threadID` | variable | Same size as `objectID` |
| `referenceTypeID` | variable | Size determined by `IDSizes` reply |
| `fieldID` | variable | Size determined by `IDSizes` reply |
| `methodID` | variable | Size determined by `IDSizes` reply |
| `frameID` | variable | Size determined by `IDSizes` reply |

**You must call `VirtualMachine.IDSizes` (command set 1, command 7) before interpreting any variable-sized ID fields.** Without knowing the ID sizes, you cannot correctly parse replies that contain IDs.

---

## Command Set Ranges

| Range | Direction | Description |
|---|---|---|
| 0 - 63 | Debugger -> VM | Commands sent to the target VM |
| 64 - 127 | VM -> Debugger | Event notifications from VM to debugger |
| 128 - 256 | | Vendor-defined commands and extensions |

---

## VirtualMachine Command Set (ID: 1)

This is the most important command set for probing and identification.

| Command | ID | Description |
|---|---|---|
| **Version** | 1 | Returns VM description, JDWP version, VM version, VM name |
| ClassesBySignature | 2 | Find classes by JNI signature |
| AllClasses | 3 | Returns all loaded classes |
| **AllThreads** | 4 | Returns all live thread IDs |
| TopLevelThreadGroups | 5 | Returns top-level thread groups |
| Dispose | 6 | Gracefully close the debug session |
| **IDSizes** | 7 | Returns sizes of all ID types (MUST call early) |
| Suspend | 8 | Suspend all threads |
| Resume | 9 | Resume all threads |
| Exit | 10 | Terminate the VM |
| CreateString | 11 | Create a string in the VM |
| Capabilities | 12 | Query VM debugging capabilities |
| ClassPaths | 13 | Get boot/class path info |
| DisposeObjects | 14 | Release object references |
| HoldEvents | 15 | Hold events until released |
| ReleaseEvents | 16 | Release held events |
| CapabilitiesNew | 17 | Extended capabilities (JDK 1.4+) |
| RedefineClasses | 18 | Hot-swap class definitions |
| SetDefaultStratum | 19 | Set default stratum for source mapping |
| AllClassesWithGeneric | 20 | AllClasses with generic signatures |
| InstanceCounts | 21 | Count instances of types |
| AllModules | 22 | List all modules (JDK 9+) |

### Version Reply (CommandSet=1, Command=1)

No request data. Reply format:

```
Field          Type      Description
-------------- --------- ----------------------------------------
description    string    Human-readable VM version text
jdwpMajor      int       JDWP major version number
jdwpMinor      int       JDWP minor version number
vmVersion      string    java.version property value
vmName         string    java.vm.name property value
```

Example reply values:
- description: `"Java Debug Wire Protocol (Reference Implementation) version 21.0\nJVM Debug Interface version 21.0\nJVM version 21.0.1 (OpenJDK 64-Bit Server VM, mixed mode, sharing)"`
- jdwpMajor: `21`, jdwpMinor: `0`
- vmVersion: `"21.0.1"`
- vmName: `"OpenJDK 64-Bit Server VM"`

### IDSizes Reply (CommandSet=1, Command=7)

No request data. Reply format:

```
Field                Type    Description
-------------------- ------- ----------------------------------------
fieldIDSize          int     Size of fieldID in bytes
methodIDSize         int     Size of methodID in bytes
objectIDSize         int     Size of objectID in bytes
referenceTypeIDSize  int     Size of referenceTypeID in bytes
frameIDSize          int     Size of frameID in bytes
```

Typical values: all 8 bytes each on 64-bit JVMs.

**This command must be issued before any command whose reply contains variable-sized IDs** (AllThreads, ClassesBySignature, etc.). The spec states all five sizes are at most 8 bytes.

### AllThreads Reply (CommandSet=1, Command=4)

No request data. Reply format:

```
Field      Type         Description
---------- ------------ ----------------------------------------
threads    int          Number of thread entries
[repeated threads times]:
  thread   threadID     Thread object ID (size = objectIDSize)
```

---

## ThreadReference Command Set (ID: 11)

| Command | ID | Description |
|---|---|---|
| **Name** | 1 | Get thread name |
| Suspend | 2 | Suspend thread |
| Resume | 3 | Resume thread |
| Status | 4 | Get thread status |
| ThreadGroup | 5 | Get thread's group |
| Frames | 6 | Get thread's stack frames |
| FrameCount | 7 | Get frame count |
| OwnedMonitors | 8 | Get monitors owned by thread |
| CurrentContendedMonitor | 9 | Get monitor thread is waiting for |
| Stop | 10 | Stop thread with exception |
| Interrupt | 11 | Interrupt thread |
| SuspendCount | 12 | Get suspend count |
| OwnedMonitorsStackDepthInfo | 13 | Monitors with stack depth |
| ForceEarlyReturn | 14 | Force method return |
| IsVirtual | 15 | Check if virtual thread (JDK 21+) |

### ThreadReference.Name (CommandSet=11, Command=1)

Request: `threadID` (variable size, determined by `IDSizes.objectIDSize`)

Reply:
```
Field       Type     Description
----------- -------- ----------------------------------------
threadName  string   Thread name (4-byte length + UTF-8)
```

---

## Other Key Command Sets

| Set ID | Name | Description |
|---|---|---|
| 2 | ReferenceType | Query class/interface metadata |
| 3 | ClassType | Class-specific operations (superclass, invoke) |
| 4 | ArrayType | Create new arrays |
| 5 | InterfaceType | Interface-specific queries |
| 6 | Method | Method metadata (line table, variable table) |
| 8 | Field | (Reserved) |
| 9 | ObjectReference | Object operations (get/set fields, invoke) |
| 10 | StringReference | Get string value |
| 12 | ClassLoaderReference | Query class loaders |
| 13 | EventRequest | Set/clear/modify event requests |
| 14 | StackFrame | Inspect/modify stack frames |
| 15 | ClassObjectReference | Query class object |
| 16 | ModuleReference | Module queries (JDK 9+) |
| 64 | Event | Composite event delivery (VM -> debugger) |

---

## Error Codes

| Code | Name | Description |
|---|---|---|
| 0 | NONE | No error (success) |
| 10 | INVALID_THREAD | Invalid thread reference |
| 11 | INVALID_THREAD_GROUP | Invalid thread group |
| 12 | INVALID_PRIORITY | Invalid priority value |
| 13 | THREAD_NOT_SUSPENDED | Thread not suspended |
| 14 | THREAD_NOT_ALIVE | Thread not alive |
| 20 | INVALID_OBJECT | Invalid object ID |
| 21 | INVALID_CLASS | Invalid class ID |
| 22 | CLASS_NOT_PREPARED | Class not yet prepared |
| 23 | INVALID_METHODID | Invalid method ID |
| 24 | INVALID_LOCATION | Invalid location |
| 25 | INVALID_FIELDID | Invalid field ID |
| 30 | INVALID_FRAMEID | Invalid frame ID |
| 31 | NO_MORE_FRAMES | No more frames on call stack |
| 32 | OPAQUE_FRAME | Information not available for frame |
| 33 | NOT_CURRENT_FRAME | Not the current frame |
| 34 | TYPE_MISMATCH | Type mismatch |
| 35 | INVALID_SLOT | Invalid slot number |
| 40 | DUPLICATE | Item already set |
| 41 | NOT_FOUND | Item not found |
| 50 | INVALID_MONITOR | Invalid monitor |
| 51 | NOT_MONITOR_OWNER | Not monitor owner |
| 52 | INTERRUPT | Thread interrupted |
| 60 | INVALID_CLASS_FORMAT | Bad class format |
| 61 | CIRCULAR_CLASS_DEFINITION | Circular class definition |
| 62 | FAILS_VERIFICATION | Class verification failed |
| 63 | ADD_METHOD_NOT_IMPLEMENTED | Adding method not supported |
| 64 | SCHEMA_CHANGE_NOT_IMPLEMENTED | Schema change not supported |
| 65 | INVALID_TYPESTATE | Invalid type state |
| 66 | HIERARCHY_CHANGE_NOT_IMPLEMENTED | Hierarchy change not supported |
| 67 | DELETE_METHOD_NOT_IMPLEMENTED | Deleting method not supported |
| 68 | UNSUPPORTED_VERSION | Unsupported class version |
| 69 | NAMES_DONT_MATCH | Class names don't match |
| 70 | CLASS_MODIFIERS_CHANGE_NOT_IMPLEMENTED | Class modifier change not supported |
| 71 | METHOD_MODIFIERS_CHANGE_NOT_IMPLEMENTED | Method modifier change not supported |
| 99 | NOT_IMPLEMENTED | Command not implemented |
| 100 | NULL_POINTER | Null pointer |
| 101 | ABSENT_INFORMATION | Information not available |
| 102 | INVALID_EVENT_TYPE | Invalid event type |
| 110 | ILLEGAL_ARGUMENT | Illegal argument |
| 111 | OUT_OF_MEMORY | Out of memory |
| 112 | ACCESS_DENIED | Access denied |
| 113 | VM_DEAD | VM has terminated |
| 500 | INTERNAL | Internal error |
| 502 | UNATTACHED_THREAD | Unattached thread |
| 503 | INVALID_TAG | Invalid tag |
| 504 | ALREADY_INVOKING | Already invoking |
| 506 | INVALID_INDEX | Invalid index |
| 507 | INVALID_LENGTH | Invalid length |
| 508 | INVALID_STRING | Invalid string |
| 509 | INVALID_CLASS_LOADER | Invalid class loader |
| 510 | INVALID_ARRAY | Invalid array |
| 511 | TRANSPORT_LOAD | Transport load error |
| 512 | TRANSPORT_INIT | Transport init error |
| 514 | NATIVE_METHOD | Native method |
| 515 | INVALID_COUNT | Invalid count |

---

## Typical Session Flow

A read-only JDWP probe follows this sequence:

```
Client                              Server (JVM)
  |                                    |
  |--- "JDWP-Handshake" (14 bytes) -->|
  |<-- "JDWP-Handshake" (14 bytes) ---|  Handshake complete
  |                                    |
  |--- IDSizes (CS=1, Cmd=7, id=1) -->|
  |<-- IDSizes reply (id=1) ----------|  Now we know ID sizes
  |                                    |
  |--- Version (CS=1, Cmd=1, id=2) -->|
  |<-- Version reply (id=2) ----------|  VM name, version, JDWP version
  |                                    |
  |--- AllThreads (CS=1, Cmd=4, id=3)->|
  |<-- AllThreads reply (id=3) -------|  Thread ID list
  |                                    |
  |  For each thread ID:               |
  |--- ThreadRef.Name (CS=11, Cmd=1)->|
  |<-- Name reply --------------------|  Thread name string
  |                                    |
  |--- Dispose (CS=1, Cmd=6) -------->|  Graceful disconnect
  |                                    |
  [close TCP connection]
```

**Important ordering:** `IDSizes` must be called before any command whose reply contains variable-sized IDs. In practice, it should be the first command after the handshake.

---

## Starting a JVM with JDWP

### Modern (JDK 9+)
```bash
java -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005 -jar app.jar
```

### Legacy (JDK 5-8)
```bash
java -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005 -jar app.jar
```

### Very old (JDK 1.3-1.4)
```bash
java -Xdebug -Xrunjdwp:transport=dt_socket,server=y,suspend=n,address=5005 -jar app.jar
```

Key parameters:
- `transport=dt_socket` -- Use TCP sockets
- `server=y` -- JVM listens for debugger connections (vs. connecting out)
- `suspend=n` -- Don't pause VM on startup waiting for debugger (`y` to pause)
- `address=*:5005` -- Listen on all interfaces, port 5005 (use `address=5005` for localhost-only on JDK 9+, or `address=localhost:5005`)

---

## Implementation Notes (portofcall)

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/jdwp/probe` | POST | Handshake-only probe (detect JDWP) |
| `/api/jdwp/version` | POST | Handshake + Version + IDSizes query |
| `/api/jdwp/threads` | POST | Handshake + IDSizes + AllThreads + thread names |

### Request body (all endpoints)

```json
{
  "host": "jvm.example.com",
  "port": 5005,
  "timeout": 10000
}
```

The `/api/jdwp/threads` endpoint also accepts `"limit": 20` (max 50) to cap the number of thread names retrieved.

### Bitwise parsing note

All 4-byte big-endian integer reads use `>>> 0` (unsigned right shift) to ensure correct unsigned interpretation. Without this, JavaScript's `<<` operator on signed 32-bit integers would produce negative values when the high bit is set (e.g., packet lengths or IDs above 0x7FFFFFFF).

### Source file

`src/worker/jdwp.ts` -- Contains `buildCommand()`, `parseReplyHeader()`, `parseVersionReply()`, `parseIDSizesReply()`, `readJDWPString()`, and the three exported handler functions.
