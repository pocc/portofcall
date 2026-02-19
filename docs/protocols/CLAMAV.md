# ClamAV — Power User Reference

**Port:** 3310 (default) | **Protocol:** clamd TCP | **Transport:** Plain TCP

Port of Call provides four ClamAV endpoints: PING (liveness check), VERSION (version query), STATS (daemon statistics), and SCAN (virus scanning via INSTREAM). All four open a direct TCP connection from the Cloudflare Worker to your clamd instance.

---

## Protocol Overview

ClamAV's daemon (`clamd`) listens on TCP port 3310 and accepts text commands. Commands can be sent in three formats:

| Format | Command | Terminator | Response terminator | Session support |
|--------|---------|------------|---------------------|-----------------|
| Plain | `COMMAND\n` | Newline | Newline | No (one command per connection) |
| n-prefix | `nCOMMAND\n` | Newline | Newline | Yes (keep-alive) |
| z-prefix | `zCOMMAND\0` | Null byte | Null byte | Yes (keep-alive) |

The n-prefix and z-prefix formats support issuing multiple commands over a single TCP connection. Port of Call uses **n-prefix** for simple commands (PING, VERSION, STATS) and **z-prefix** for INSTREAM scanning.

### Available clamd Commands

| Command | Description | Response |
|---------|-------------|----------|
| `PING` | Liveness check | `PONG` |
| `VERSION` | Engine version, signature DB version and date | `ClamAV 1.3.1/27207/Wed Jan 10 09:27:02 2024` |
| `STATS` | Thread pool, queue, and memory statistics | Multi-line text ending with `END` |
| `RELOAD` | Reload virus signature database | `RELOADING` |
| `SHUTDOWN` | Shut down the daemon | No response (connection closes) |
| `INSTREAM` | Scan streamed data for viruses | `stream: OK` or `stream: <name> FOUND` |
| `SCAN <path>` | Scan a file path on the server | `<path>: OK` or `<path>: <name> FOUND` |
| `CONTSCAN <path>` | Scan directory, continue on virus found | One line per file |
| `MULTISCAN <path>` | Scan directory with multiple threads | One line per file |
| `ALLMATCHSCAN <path>` | Scan reporting all matches, not just first | One line per match |
| `FILDES` | Scan file descriptor passed over Unix socket | `stream: OK` or `stream: <name> FOUND` |
| `VERSIONCOMMANDS` | List supported commands | Space-separated command list |

Port of Call implements PING, VERSION, STATS, and INSTREAM. The path-based scan commands (SCAN, CONTSCAN, MULTISCAN) require server filesystem access and are not applicable for remote scanning.

---

## INSTREAM Chunked Protocol

The INSTREAM command allows scanning data streamed over the TCP connection without writing to disk on the server. This is the only scanning method usable from a remote client without server filesystem access.

### Wire Format

```
Client → Server:  zINSTREAM\0
Client → Server:  [4-byte big-endian chunk length][chunk data bytes]
Client → Server:  [4-byte big-endian chunk length][chunk data bytes]
  ...repeat...
Client → Server:  \x00\x00\x00\x00          (zero-length chunk = end of stream)
Server → Client:  stream: OK\0              (or "stream: <name> FOUND\0")
```

### Chunk Format Detail

Each data chunk is preceded by a 4-byte unsigned integer in **network byte order** (big-endian) specifying the length of the data that follows:

```
Byte 0   Byte 1   Byte 2   Byte 3   Byte 4..N
[-------- chunk length --------]  [-- chunk data --]
```

- **Length field:** 4 bytes, unsigned 32-bit integer, big-endian (network order)
- **Data bytes:** Exactly `length` bytes of payload
- **Terminator:** A chunk with length 0 (`\x00\x00\x00\x00`) signals end of data
- **Maximum chunk size:** clamd defaults to `StreamMaxLength` (25 MB total); individual chunks have no hard limit but 64 KB is conventional
- **Maximum total size:** Controlled by `StreamMaxLength` in `clamd.conf` (default: 25 MB, 0 = unlimited)

### zINSTREAM vs INSTREAM

| Variant | Command bytes | Response terminator | Notes |
|---------|--------------|---------------------|-------|
| `INSTREAM\n` | `INSTREAM` + `0x0A` | Newline (`0x0A`) | Plain format |
| `nINSTREAM\n` | `nINSTREAM` + `0x0A` | Newline (`0x0A`) | n-prefix format |
| `zINSTREAM\0` | `zINSTREAM` + `0x00` | Null byte (`0x00`) | z-prefix format |

All three variants use the same chunk framing protocol. The only difference is the command/response terminator character. Port of Call uses `zINSTREAM\0` (z-prefix) because null-terminated responses are unambiguous and cannot collide with response text content.

### Scan Response Format

| Response | Meaning |
|----------|---------|
| `stream: OK` | No virus detected |
| `stream: <VirusName> FOUND` | Virus signature matched |
| `stream: <message> ERROR` | Scan error (e.g., exceeded `StreamMaxLength`) |
| `INSTREAM size limit exceeded. ERROR` | Data exceeded `StreamMaxLength` |

---

## API Endpoints

### `POST /api/clamav/ping` -- Liveness check

Connects, sends `nPING\n`, expects `PONG\n` response.

**POST body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | -- | Required |
| `port` | number | `3310` | |
| `timeout` | number | `10000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "clamav.example.com",
  "port": 3310,
  "alive": true,
  "response": "PONG",
  "connectTimeMs": 45,
  "totalTimeMs": 52,
  "protocol": "ClamAV"
}
```

**Error (400/500):** `{ "success": false, "error": "Host is required" }`

---

### `POST /api/clamav/version` -- Version information

Connects, sends `nVERSION\n`, parses the three-part version string.

**POST body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | -- | Required |
| `port` | number | `3310` | |
| `timeout` | number | `10000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "clamav.example.com",
  "port": 3310,
  "raw": "ClamAV 1.3.1/27207/Wed Jan 10 09:27:02 2024",
  "version": "ClamAV 1.3.1",
  "databaseVersion": "27207",
  "databaseDate": "Wed Jan 10 09:27:02 2024",
  "totalTimeMs": 58,
  "protocol": "ClamAV"
}
```

The version string format is `<engine>/<db-revision>/<db-date>`. The parser splits on `/` and reassembles slashes in the date portion.

---

### `POST /api/clamav/stats` -- Daemon statistics

Connects, sends `nSTATS\n`, reads the multi-line response until `END` appears on its own line.

**POST body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | -- | Required |
| `port` | number | `3310` | |
| `timeout` | number | `10000` | Total timeout in ms |

**Success (200):**
```json
{
  "success": true,
  "host": "clamav.example.com",
  "port": 3310,
  "stats": "POOLS: 1\n\nSTATE: VALID PRIMARY\nTHREADS: live 1 idle 0 max 12 idle-timeout 30\nQUEUE: 0 items\n\t...\nEND",
  "parsed": {
    "pools": 1,
    "threads": "live 1 idle 0 max 12 idle-timeout 30",
    "queueLength": 0,
    "memoryUsed": "356K"
  },
  "totalTimeMs": 63,
  "responseBytes": 512,
  "protocol": "ClamAV"
}
```

**Parsed fields** are best-effort regex extractions from the raw stats text. The `stats` field always contains the complete raw output.

**Typical STATS output structure:**
```
POOLS: 1

STATE: VALID PRIMARY
THREADS: live 1  idle 0 max 12 idle-timeout 30
QUEUE: 0 items
    STATS 0.000019

MEMSTATS: heap N/A mmap N/A used 356K free N/A releasable N/A pools 1 pools_used 1234.567M pools_total 1234.567M
END
```

---

### `POST /api/clamav/scan` -- Virus scan via INSTREAM

Connects, sends `zINSTREAM\0`, streams base64-decoded data using the chunked protocol, reads the scan result.

**POST body:**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `host` | string | -- | Required |
| `port` | number | `3310` | |
| `data` | string | -- | Required. Base64-encoded data to scan |
| `timeout` | number | `15000` | Total timeout in ms |

**Success -- clean (200):**
```json
{
  "success": true,
  "host": "clamav.example.com",
  "port": 3310,
  "rtt": 245,
  "clean": true,
  "virusFound": false,
  "response": "stream: OK",
  "dataSize": 1048576,
  "message": "No threats found"
}
```

**Success -- virus detected (200):**
```json
{
  "success": true,
  "host": "clamav.example.com",
  "port": 3310,
  "rtt": 180,
  "clean": false,
  "virusFound": true,
  "virusName": "Win.Test.EICAR_HDB-1",
  "response": "stream: Win.Test.EICAR_HDB-1 FOUND",
  "dataSize": 68,
  "message": "Virus detected: Win.Test.EICAR_HDB-1"
}
```

**Scan error (200 with `success: false`):**
```json
{
  "success": false,
  "host": "clamav.example.com",
  "port": 3310,
  "rtt": 50,
  "clean": false,
  "virusFound": false,
  "response": "INSTREAM size limit exceeded. ERROR",
  "dataSize": 26214400,
  "message": "Scan error: INSTREAM size limit exceeded. ERROR"
}
```

**Size limit:** The implementation enforces a client-side maximum of 10 MB. The server's `StreamMaxLength` setting (default 25 MB) may impose a lower limit.

---

## Implementation Details

### Command Format Choices

| Handler | Command sent | Why |
|---------|-------------|-----|
| PING | `nPING\n` | n-prefix: newline-terminated, simple single-line response |
| VERSION | `nVERSION\n` | n-prefix: single-line response, easy to parse |
| STATS | `nSTATS\n` | n-prefix: multi-line response terminated by `END` line |
| SCAN | `zINSTREAM\0` | z-prefix: null-terminated to avoid ambiguity in binary scan responses |

### Response Reading

**Single-line commands** (PING, VERSION, INSTREAM response) use `readClamdResponse()`, which reads chunks until it encounters a null byte (`0x00`) or newline (`0x0A`), then strips terminators and trims whitespace.

**Multi-line commands** (STATS) use a custom reader that accumulates chunks until `END` appears on its own line (matched with `/^END\s*$/m` to avoid false positives on words like "PENDING" or "BACKEND") or a null byte is found.

Both readers enforce:
- A 64 KB safety limit on total response size
- A timeout (capped at 10 seconds) using `Promise.race`

### Socket Lifecycle

Each request opens a new TCP connection via `cloudflare:sockets`. The connection is closed in a `finally` block (scan endpoint) or explicit `try/catch` (other endpoints). No connection pooling or keep-alive is used across requests.

---

## Known Limitations

**No TLS:** clamd does not natively support TLS. The worker connects via plain TCP. If your clamd is behind a TLS-terminating proxy, connect to the proxy's plaintext backend port.

**No IDSESSION/END:** The n-prefix and z-prefix commands support session mode (`IDSESSION` / `END` framing for multiplexed scanning). Port of Call does not use session mode; each request is a single command on a dedicated connection.

**No FILDES:** File descriptor passing (`FILDES`) requires a Unix domain socket, which is not available from Cloudflare Workers.

**No server-side SCAN:** Path-based commands (`SCAN`, `CONTSCAN`, `MULTISCAN`, `ALLMATCHSCAN`) require the file to exist on the clamd server's filesystem. Use INSTREAM for remote scanning.

**StreamMaxLength:** If the data exceeds the server's `StreamMaxLength` (default 25 MB), clamd returns `INSTREAM size limit exceeded. ERROR` and closes the connection. The client-side limit is 10 MB.

**Base64 overhead:** Data must be base64-encoded in the JSON request body. This adds ~33% overhead to the payload size. A 10 MB scan limit means ~7.5 MB of original data after base64 encoding overhead.

**Binary response content:** The response parser uses `TextDecoder` (UTF-8). This is fine for clamd responses, which are always ASCII text.

**STATS "END" detection:** The STATS reader looks for `END` on its own line using the regex `/^END\s*$/m`. This is checked against accumulated text to handle the rare case where "END" is split across TCP segments.

---

## clamd Configuration Reference

Key `clamd.conf` settings that affect remote scanning behavior:

| Setting | Default | Notes |
|---------|---------|-------|
| `TCPSocket` | `3310` | TCP port to listen on |
| `TCPAddr` | `localhost` | Bind address; set to `0.0.0.0` for remote access |
| `MaxConnectionQueueLength` | `15` | Maximum pending connections |
| `MaxThreads` | `12` | Maximum simultaneous scan threads |
| `StreamMaxLength` | `25M` | Maximum data size for INSTREAM (0 = unlimited) |
| `StreamMinPort` / `StreamMaxPort` | -- | Legacy; not used with INSTREAM |
| `ReadTimeout` | `120` | Seconds before dropping idle connection |
| `CommandReadTimeout` | `30` | Seconds to wait for command after connect |
| `IdleTimeout` | `30` | Seconds before closing idle session |
| `ExcludePath` | -- | Regex for paths to skip (SCAN/CONTSCAN only) |
| `DisableCert` | `no` | Disable PE certificate chain checks |
| `MaxScanSize` | `400M` | Maximum data scanned per file (archives extracted) |
| `MaxFileSize` | `100M` | Maximum file size for extraction (archives) |
| `MaxRecursion` | `17` | Maximum archive nesting depth |
| `MaxFiles` | `10000` | Maximum files extracted from archive |

---

## Testing with EICAR

The EICAR test string is an industry-standard antivirus test file. It is detected as a virus by all compliant AV engines but is completely harmless.

```
X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
```

Base64-encoded for use with the scan endpoint:
```
WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=
```

**curl example -- scan EICAR test string:**
```bash
curl -s -X POST https://portofcall.ross.gg/api/clamav/scan \
  -H 'Content-Type: application/json' \
  -d '{
    "host": "clamav.example.com",
    "port": 3310,
    "data": "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo="
  }'
```

Expected response: `"virusName": "Win.Test.EICAR_HDB-1"` (exact name may vary by ClamAV version and signature database).

---

## Practical Examples

### curl

```bash
# Liveness check
curl -s -X POST https://portofcall.ross.gg/api/clamav/ping \
  -H 'Content-Type: application/json' \
  -d '{"host":"clamav.example.com","port":3310}' | jq .

# Version query
curl -s -X POST https://portofcall.ross.gg/api/clamav/version \
  -H 'Content-Type: application/json' \
  -d '{"host":"clamav.example.com"}' | jq .

# Daemon statistics
curl -s -X POST https://portofcall.ross.gg/api/clamav/stats \
  -H 'Content-Type: application/json' \
  -d '{"host":"clamav.example.com"}' | jq .stats

# Scan a local file (pipe through base64)
DATA=$(base64 < /path/to/suspicious-file.bin)
curl -s -X POST https://portofcall.ross.gg/api/clamav/scan \
  -H 'Content-Type: application/json' \
  -d "{\"host\":\"clamav.example.com\",\"data\":\"$DATA\"}" | jq .

# Scan a clean file (should return clean: true)
echo "Hello, world" | base64 | xargs -I{} \
  curl -s -X POST https://portofcall.ross.gg/api/clamav/scan \
  -H 'Content-Type: application/json' \
  -d '{"host":"clamav.example.com","data":"{}"}' | jq .clean
```

### JavaScript

```js
// Scan data using the API
async function scanForViruses(host, data) {
  // Convert ArrayBuffer/Uint8Array to base64
  const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));

  const response = await fetch('/api/clamav/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, data: base64 }),
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || result.message);
  }

  return {
    clean: result.clean,
    virusName: result.virusName,
    scanTimeMs: result.rtt,
  };
}

// Usage
const fileBuffer = await file.arrayBuffer();
const result = await scanForViruses('clamav.internal', fileBuffer);
if (!result.clean) {
  console.error(`Virus detected: ${result.virusName}`);
}
```

---

## Resources

- [ClamAV Documentation](https://docs.clamav.net/)
- [clamd man page](https://docs.clamav.net/manual/Usage/Scanning.html#clamd)
- [clamd.conf reference](https://docs.clamav.net/manual/Usage/Configuration.html#clamdconf)
- [EICAR test file](https://www.eicar.org/download-anti-malware-testfile/)
- [ClamAV source: clamd/session.c](https://github.com/Cisco-Talos/clamav/blob/main/clamd/session.c) -- command parsing implementation
- [ClamAV source: clamd/scanner.c](https://github.com/Cisco-Talos/clamav/blob/main/clamd/scanner.c) -- INSTREAM implementation
