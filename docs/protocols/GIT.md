# Git Protocol (git://) -- Power User Reference

**Port:** 9418 (default) | **Protocol:** Git pack protocol v1 | **Transport:** TCP | **Source:** `src/worker/git.ts`

Port of Call provides two Git endpoints: a ref-listing probe (equivalent to `git ls-remote`) and a fetch endpoint that performs pack negotiation and parses the PACK header. Both open a direct TCP connection from the Cloudflare Worker to the target git daemon.

---

## API Endpoints

### `POST /api/git/refs` -- Reference discovery (ls-remote equivalent)

Connects to a git daemon, sends the `git-upload-pack` request, reads the full ref advertisement, then sends a flush packet to gracefully abort. Equivalent to `git ls-remote git://host/repo.git`.

**POST body:**

| Field     | Type   | Default | Notes                          |
|-----------|--------|---------|--------------------------------|
| `host`    | string | --      | Required. Hostname or IP.      |
| `port`    | number | `9418`  | Git daemon port (1--65535).     |
| `repo`    | string | --      | Required. Repository path (e.g. `/pub/scm/git/git.git`). Leading `/` added if missing. |
| `timeout` | number | `15000` | Total timeout in ms.           |

**Success (200):**
```json
{
  "success": true,
  "host": "git.kernel.org",
  "port": 9418,
  "repo": "/pub/scm/git/git.git",
  "refs": [
    { "sha": "abc123...", "name": "HEAD" },
    { "sha": "abc123...", "name": "refs/heads/main" },
    { "sha": "def456...", "name": "refs/tags/v2.47.0" }
  ],
  "capabilities": [
    "multi_ack_detailed", "side-band-64k", "ofs-delta",
    "shallow", "no-progress", "include-tag",
    "symref=HEAD:refs/heads/main", "agent=git/2.45.0"
  ],
  "headSha": "abc123...",
  "branchCount": 5,
  "tagCount": 620,
  "connectTimeMs": 42,
  "totalTimeMs": 187
}
```

**Cloudflare-protected host (403):** `{ "success": false, "error": "Cannot connect to ... Cloudflare ...", "isCloudflare": true }`

**Notes:**
- The server's ref advertisement is terminated by a flush packet (`0000`). After reading it, the client sends its own flush packet to signal a graceful abort (per the spec: "the client can decide to terminate the connection by sending a flush-pkt, telling the server it can now gracefully terminate").
- `headSha` is extracted from the ref named `HEAD` in the advertisement.
- `capabilities` are parsed from the NUL-delimited portion of the first ref line (per the pack protocol spec).
- A `version 1` pkt-line sent by some servers before the ref advertisement is detected and skipped.
- SHA values are validated against `[0-9a-f]{40}` (SHA-1) or `[0-9a-f]{64}` (SHA-256 object-format).

---

### `POST /api/git/fetch` -- Pack fetch with object metadata

Connects, reads refs, resolves a target ref, performs the want/flush/done negotiation, and parses the PACK response header to report object count and type of the first object. Does **not** download or inflate the full pack data.

**POST body:**

| Field        | Type   | Default  | Notes                                |
|--------------|--------|----------|--------------------------------------|
| `host`       | string | --       | Required.                            |
| `port`       | number | `9418`   | Git daemon port.                     |
| `repository` | string | --       | Required. Repository path.           |
| `wantRef`    | string | `"HEAD"` | Ref to fetch. Can be `HEAD`, a branch name (`main`), full refname (`refs/heads/main`), or tag (`refs/tags/v1.0`). |
| `timeout`    | number | `20000`  | Total timeout in ms.                 |

**Success (200):**
```json
{
  "success": true,
  "host": "git.kernel.org",
  "port": 9418,
  "repository": "/pub/scm/git/git.git",
  "wantedRef": "refs/heads/main",
  "sha": "abc123...",
  "packVersion": 2,
  "objectCount": 1,
  "objects": [
    { "type": "commit", "size": 274 }
  ],
  "rtt": 312
}
```

**Ref resolution logic:**
1. If `wantRef` is `HEAD`: look for a ref named `HEAD` in the advertisement. If not found, check the `symref=HEAD:refs/heads/...` capability and resolve through it.
2. Otherwise: try exact match on `name`, then `refs/heads/${wantRef}`, then `refs/tags/${wantRef}`.
3. If no match found, returns `{ "success": false, "error": "Ref not found: ...", "availableRefs": [...] }`.

**Want/have negotiation:**
- The first `want` line includes capabilities the client selects from the server's advertisement: `ofs-delta`, `side-band-64k` (or `side-band`), `no-progress`.
- A flush packet terminates the want list.
- `done` signals the end of negotiation (no `have` lines sent since this is a fresh clone scenario).
- Server responds with NAK + PACK data.

**Pack header parsing:**
- Scans for the `PACK` magic bytes (`0x50 0x41 0x43 0x4B`), which may be preceded by side-band pkt-line framing or NAK lines.
- Reads the 12-byte PACK header: 4-byte magic, 4-byte version (network byte order), 4-byte object count.
- Parses the first object header using the variable-length encoding (type in bits [6:4] of first byte, size across continuation bytes).

---

## Protocol Deep Dive

### pkt-line Format

All communication in the Git pack protocol uses the **pkt-line** framing format.

```
pkt-line     = data-pkt / flush-pkt
data-pkt     = pkt-len pkt-payload
pkt-len      = 4*(HEXDIG)          ; 4 ASCII hex digits
pkt-payload  = (pkt-len - 4)*(OCTET)
flush-pkt    = "0000"
```

**Rules:**
- `pkt-len` is the total length of the line **including the 4 length bytes themselves**.
- Minimum data-pkt length: `0005` (4 length bytes + 1 payload byte). `0004` is an empty packet (allowed but discouraged).
- Maximum pkt-line length: **65520** bytes (`0xFFF0`). That is 65516 bytes of payload + 4 bytes of length.
- Non-binary lines SHOULD be terminated with `\n`, which is included in the length.
- `0000` is the **flush packet** -- it terminates sections and signals end-of-data.
- Parsers MUST be 8-bit clean (binary-safe).

**Examples:**

| Hex on wire               | Meaning                |
|---------------------------|------------------------|
| `30 30 30 30`             | Flush packet (`0000`)  |
| `30 30 30 36 61 0A`       | `0006a\n` (1 byte payload + LF) |
| `30 30 30 35 61`          | `0005a` (1 byte payload, no LF) |
| `30 30 31 32 48 65 6C 6C 6F 20 77 6F 72 6C 64 21 0A 00` | `0012Hello world!\n\0` |

### git:// Transport Initial Handshake

The client's first message is a pkt-line containing the service request:

```
git-proto-request = request-command SP pathname NUL
                    [ host-parameter NUL ]
                    [ NUL extra-parameters ]

request-command   = "git-upload-pack" / "git-receive-pack"
pathname          = *( %x01-ff )
host-parameter    = "host=" hostname [ ":" port ]
```

**Example (pkt-line encoded):**
```
0033git-upload-pack /project.git\0host=myserver.com\0
```

The 4-byte prefix `0033` = 51 decimal = 4 (length field) + 47 (payload).

For protocol version negotiation, extra parameters follow a double-NUL:
```
003egit-upload-pack /project.git\0host=myserver.com\0\0version=1\0
```

### Reference Advertisement

After the initial request, the server immediately sends its ref advertisement:

```
Server:  [optional: PKT-LINE("version 1" LF)]
Server:  PKT-LINE(obj-id SP refname NUL capability-list LF)   ; first ref
Server:  PKT-LINE(obj-id SP refname LF)                        ; subsequent refs
Server:  ...
Server:  flush-pkt
```

**Key details:**
- The first ref line carries all server capabilities after a NUL byte.
- `HEAD` is typically the first advertised ref (if valid).
- Peeled tag refs appear immediately after the tag ref with `^{}` appended: `sha refs/tags/v1.0^{}`.
- Refs are sorted in C locale order.
- An empty repository sends a special "no refs" line: `PKT-LINE("0" * 40 SP "capabilities^{}" NUL capability-list)`.

### Capabilities (v1)

Capabilities appear after the NUL byte on the first ref line, space-separated.

| Capability            | Description                                                 |
|-----------------------|-------------------------------------------------------------|
| `multi_ack`           | Server can send multiple ACKs during negotiation            |
| `multi_ack_detailed`  | Extended ACK with `continue`, `common`, `ready` statuses    |
| `side-band`           | Multiplexed output (up to 1000 bytes per pkt-line)          |
| `side-band-64k`       | Multiplexed output (up to 65520 bytes per pkt-line)         |
| `ofs-delta`           | Pack can use offset-based delta encoding                    |
| `thin-pack`           | Pack may omit base objects the client has                   |
| `shallow`             | Server supports shallow clone operations                    |
| `no-progress`         | Client requests no progress info on side-band channel 2     |
| `include-tag`         | Server will send annotated tag objects if related commit sent|
| `no-done`             | Client need not send `done` if server sends `ready`         |
| `symref=X:Y`          | Symbolic ref `X` points to `Y` (e.g. `symref=HEAD:refs/heads/main`) |
| `agent=X`             | Software version (e.g. `agent=git/2.45.0`)                  |
| `object-format=X`     | Hash algorithm (`sha1` or `sha256`)                          |
| `filter`              | Server supports partial clone filters                       |

### ls-remote Flow (what `/api/git/refs` does)

```
Client:  TCP connect to host:9418
Client:  PKT-LINE("git-upload-pack /repo.git\0host=server\0")
Server:  PKT-LINE("sha HEAD\0multi_ack side-band-64k ofs-delta ...\n")
Server:  PKT-LINE("sha refs/heads/main\n")
Server:  PKT-LINE("sha refs/tags/v1.0\n")
Server:  "0000"   (flush)
Client:  "0000"   (flush -- graceful abort, no fetch needed)
Client:  close TCP
```

### Want/Have/Done Negotiation (what `/api/git/fetch` does)

```
Client:  TCP connect + git-upload-pack request
Server:  ref advertisement + flush
Client:  PKT-LINE("want <sha> ofs-delta side-band-64k no-progress\n")  ; first want has capabilities
Client:  "0000"   (flush -- end of want list)
Client:  PKT-LINE("done\n")   ; no haves in a fresh clone
Server:  PKT-LINE("NAK\n")    ; no common objects
Server:  PACK data (may be side-band multiplexed)
```

**First want line format (per spec):**
```
first-want = PKT-LINE("want" SP obj-id SP capability-list LF)
```

The capability list on the first `want` tells the server which features the client supports. Only capabilities that the server advertised may be selected.

### Side-Band Multiplexing

When `side-band` or `side-band-64k` is negotiated, the server wraps all output in pkt-lines with a single-byte channel prefix:

| Channel | Meaning                  |
|---------|--------------------------|
| `0x01`  | Pack data                |
| `0x02`  | Progress / status (stderr) |
| `0x03`  | Fatal error              |

Pack data format (after stripping side-band framing):
```
"PACK" (4 bytes magic)
version (4 bytes, network order, usually 2)
object-count (4 bytes, network order)
[compressed object entries...]
20-byte SHA-1 checksum
```

### Pack Object Header Encoding

Each object in the pack has a variable-length header:

```
First byte:   [MSB] [type:3] [size:4]
Next bytes:   [MSB] [size:7]

MSB = 1 means more bytes follow
type: 1=commit, 2=tree, 3=blob, 4=tag, 6=ofs_delta, 7=ref_delta
size: built from 4 bits of first byte, then 7 bits per continuation byte
```

After the header, the object data is zlib-compressed. Delta objects (types 6 and 7) have additional base-object references before the compressed delta instructions.

---

## Implementation Details

### Source: `src/worker/git.ts`

**Exported functions:**
- `handleGitRefs(request: Request): Promise<Response>` -- ref listing
- `handleGitFetch(request: Request): Promise<Response>` -- pack fetch probe

**Internal helpers:**
- `readExactBytes(reader, count, buffer, offset)` -- reads exactly N bytes from a `ReadableStreamDefaultReader`, buffering across TCP segments.
- `readPktLines(reader, maxLines)` -- reads a sequence of pkt-lines until a flush packet, returning decoded strings.
- `buildPktLine(data)` -- encodes a string as a pkt-line (4-hex-digit length + payload).
- `buildFlushPkt()` -- returns `Uint8Array` for `"0000"`.
- `parseRefAdvertisement(rawLines)` -- shared ref parser that handles `version 1` lines, SHA validation, and capability extraction.
- `parsePackObjectHeader(data, offset)` -- decodes the variable-length type+size header of a pack object.

### Ref Advertisement Parsing

The `parseRefAdvertisement` function:
1. Skips any `version N` pkt-line (regex: `/^version \d+$/`).
2. On the first ref line, splits on `\0` to separate `sha refname` from the capability list.
3. Validates the SHA against `/^[0-9a-f]{40}([0-9a-f]{24})?$/` (accepts SHA-1 or SHA-256).
4. On subsequent lines, parses `sha refname` format with SHA validation.
5. Tracks `headSha` if a ref named `HEAD` is found.

### Error Handling

- **Cloudflare detection:** Before connecting, the host IP is resolved via DoH and checked against Cloudflare's IP ranges. Cloudflare-proxied hosts are rejected with HTTP 403 (Workers cannot connect to Cloudflare-proxied destinations).
- **Timeout:** A `Promise.race` between the connection logic and a timeout promise. Default: 15s for refs, 20s for fetch.
- **Stream errors:** `readExactBytes` throws if the stream ends before the expected byte count is reached.
- **Malformed pkt-lines:** Lengths outside [4, 65520] throw with the raw hex string in the error message.

---

## Testing

### Test with Public Git Servers

```bash
# List refs (ls-remote equivalent)
curl -X POST https://portofcall.example.com/api/git/refs \
  -H 'Content-Type: application/json' \
  -d '{"host":"git.kernel.org","repo":"/pub/scm/git/git.git"}'

# Fetch HEAD pack metadata
curl -X POST https://portofcall.example.com/api/git/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"git.kernel.org","repository":"/pub/scm/git/git.git","wantRef":"HEAD"}'

# Fetch a specific branch
curl -X POST https://portofcall.example.com/api/git/fetch \
  -H 'Content-Type: application/json' \
  -d '{"host":"git.kernel.org","repository":"/pub/scm/git/git.git","wantRef":"next"}'
```

### Manual Protocol Testing with netcat

```bash
# Compute pkt-line for git-upload-pack request:
#   "git-upload-pack /pub/scm/git/git.git\0host=git.kernel.org\0"
#   = 52 bytes payload, total = 56 = 0x0038
printf '0038git-upload-pack /pub/scm/git/git.git\0host=git.kernel.org\0' | \
  nc git.kernel.org 9418 | head -20

# Decode pkt-line output:
#   First 4 chars of each line are the hex length.
#   "0000" is the flush packet.
```

### Local Git Daemon

```bash
# Create a test repo
mkdir /tmp/test-repo && cd /tmp/test-repo
git init && git commit --allow-empty -m "init"

# Start git daemon (foreground, verbose)
git daemon --reuseaddr --base-path=/tmp --export-all --verbose --port=9418

# Test: should list the ref
curl -X POST http://localhost:8787/api/git/refs \
  -d '{"host":"127.0.0.1","repo":"/test-repo"}'
```

---

## Known Limitations

1. **Read-only.** The git:// protocol is inherently read-only (`git-upload-pack` only). Push requires `git-receive-pack` over SSH or HTTPS.
2. **No authentication.** The git:// protocol has no built-in auth. Repositories must be configured for anonymous read access (`git daemon --export-all`).
3. **Pack data not fully downloaded.** The fetch endpoint reads only enough data to parse the PACK header (version + object count + first object type/size). Full pack download and inflation would require zlib decompression, which is beyond the current scope.
4. **Single object header.** Only the first pack object header is parsed; subsequent objects require skipping compressed data (zlib inflate) which is not implemented.
5. **No `multi_ack` negotiation.** The client sends `want` + `done` with no `have` lines, behaving like a fresh clone. Multi-round negotiation is not supported.
6. **No protocol v2.** Only pack protocol v1 is implemented. Protocol v2 uses a different capability advertisement and command-based request format.
7. **Side-band framing not stripped.** When `side-band-64k` is negotiated, the PACK data is wrapped in pkt-lines with a channel prefix byte. The implementation scans for the raw `PACK` magic bytes, which works but ignores progress/error messages on channels 2 and 3.

---

## Resources

- **Git Pack Protocol:** [gitprotocol-pack(5)](https://git-scm.com/docs/gitprotocol-pack)
- **Protocol Common (pkt-line):** [gitprotocol-common(5)](https://git-scm.com/docs/protocol-common)
- **Protocol v2:** [gitprotocol-v2(5)](https://git-scm.com/docs/protocol-v2)
- **Pack Format:** [gitformat-pack(5)](https://git-scm.com/docs/gitformat-pack)
- **Git Book - Transfer Protocols:** [Chapter 10.6](https://git-scm.com/book/en/v2/Git-Internals-Transfer-Protocols)
- **Understanding Git Packfiles:** [Recurse Center](https://codewords.recurse.com/issues/three/unpacking-git-packfiles)
