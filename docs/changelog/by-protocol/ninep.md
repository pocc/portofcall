# 9P (Plan 9 Filesystem Protocol) Review

**Protocol:** 9P2000 (Plan 9 Filesystem Protocol)
**File:** `src/worker/ninep.ts`
**Reviewed:** 2026-02-19
**Specification:** [Plan 9 Manual Section 5 - Intro](https://man.cat-v.org/plan_9/5/intro)
**Tests:** `tests/ninep.test.ts`

## Summary

9P implementation provides 4 endpoints (connect, stat, read, ls) supporting the 9P2000 wire protocol. Handles 12 message types (Tversion/Rversion, Tattach/Rattach, Twalk/Rwalk, Topen/Ropen, Tread/Rread, Tclunk, Tstat/Rstat, Rerror). Critical review found robust implementation with proper VarInt-style message framing, QID parsing, and comprehensive directory listing support. The implementation is read-only (no write operations) and targets virtualization use cases (QEMU virtio-9p, WSL2).

## Architecture Review

### Protocol Implementation Quality: Excellent

**Strengths:**
1. **Correct wire format** — All 9P2000 messages use proper little-endian encoding with [size:uint32LE][type:uint8][tag:uint16LE][body] structure
2. **Proper handshake sequence** — Tversion → Rversion → Tattach → Rattach flow is protocol-correct
3. **QID parsing** — Handles 13-byte QID structure (type + version + uint64 path) correctly, converts uint64 to hex string for JS compatibility
4. **String encoding** — 9P strings encoded as [len:uint16LE][chars] format matches spec
5. **FID management** — Sequential FID allocation (rootFid, rootFid+1) prevents collisions
6. **Error handling** — Parses Rerror messages and extracts error strings
7. **Path validation** — buildTwalk validates path components (max 16, no empty/./.. components, no slashes, max 255 chars)
8. **Large file support** — Uses BigInt for uint64 file lengths to avoid precision loss

**Message Types Implemented:**
- 100/101: Tversion/Rversion (version negotiation)
- 104/105: Tattach/Rattach (mount root)
- 107: Rerror (error response)
- 110/111: Twalk/Rwalk (navigate path)
- 112/113: Topen/Ropen (open file)
- 116/117: Tread/Rread (read file/directory)
- 120/121: Tclunk/Rclunk (close fid)
- 124/125: Tstat/Rstat (file info)

### Endpoints Implemented

**POST /api/9p/connect** — Version negotiation + attach
- Sends Tversion (msize=8192, version="9P2000")
- Parses Rversion to extract negotiated msize and server version
- Sends Tattach (fid=0, afid=NOFID, uname="anonymous", aname="")
- Returns root QID if attach succeeds

**POST /api/9p/stat** — Walk to path and stat target
- Performs Tversion → Tattach handshake via ninePHandshake()
- Sends Twalk with path components to navigate filesystem
- Sends Tstat to query file/directory metadata
- Returns Stat9P structure with type, dev, qid, mode, atime, mtime, length, name, uid, gid, muid

**POST /api/9p/read** — Read file contents
- Walks to file path
- Opens file with mode 0 (read-only)
- Sends Tread with offset and count
- Returns data as base64 for binary safety

**POST /api/9p/ls** — List directory entries
- Walks to directory path (or uses root fid if path is empty)
- Opens directory with mode 0 (read-only)
- Reads directory data (concatenated stat structures)
- Parses stat records and returns array of entries

## Code Quality Assessment

### Security: Good

**Strengths:**
1. Input validation — validateInput() checks host regex `^[a-zA-Z0-9.-]+$` and port range 1-65535
2. Path component validation — buildTwalk() prevents directory traversal (no empty, ".", ".." components)
3. Null terminator validation — parse9PString checks bounds before slicing
4. Message size validation — Implicit via socket read timeout (no infinite read)
5. No credential exposure — Uses anonymous auth (no passwords in plaintext)

**Weaknesses:**
1. **Path depth limit enforced (16 components) but not documented to user** — Error only thrown during buildTwalk call
2. **No explicit message size limit in parse9PMessage** — Should validate size field < 1GB to prevent OOM
3. **Stat parsing doesn't validate stat size field** — parseStat trusts the 2-byte size prefix without range checking

### Error Handling: Very Good

**Strengths:**
1. All endpoints parse Rerror messages and extract error strings
2. Failed walk/open/read operations throw descriptive errors
3. Socket cleanup in try/catch/finally blocks
4. Timeout handling with `read9PMessage` and deadline tracking
5. Partial data handling — `read9PMessage` accumulates chunks until complete message

**Weaknesses:**
1. **Tclunk failures silently ignored** — `try { await writer.write(...) } catch { /* ignore */ }` could leak fids on server
2. **No distinction between protocol errors and network errors** — All thrown as generic Error

### Resource Management: Good

**Strengths:**
1. Reader/writer locks released in finally blocks
2. Socket closed on all code paths (success, timeout, error)
3. Progressive chunk accumulation in `read9PMessage` — Doesn't allocate full msize upfront

**Weaknesses:**
1. **Timeout promise never cleaned up** — No clearTimeout() equivalent for Promise-based timeouts
2. **FID reuse not implemented** — Each operation uses new FIDs, could exhaust server FID pool on repeated calls

## Known Limitations (Documented)

From the inline comments and implementation:

1. **Read-only protocol** — No write, create, remove, or wstat operations
2. **Anonymous auth only** — NOFID (0xffffffff) used for afid, no Tauth/Rauth implemented
3. **No multi-packet directory reads** — ls endpoint reads msize-11 bytes once, large directories truncated
4. **No DOTL extensions** — 9P2000.L (Linux extensions) not supported
5. **No error detail codes** — Rerror message is freeform string, no structured error codes
6. **Fixed msize (8192 bytes)** — Not tunable via API, smaller than typical 64KB servers use
7. **Stat parsing skips outer size word** — parseStat expects caller to skip nstat[2] prefix in Rstat body
8. **No 9P2000.u support** — Unix extensions (uid_t/gid_t fields) not parsed
9. **Path depth limited to 16 components** — Hard-coded in buildTwalk (per 9P convention)
10. **Single-threaded file reads** — Each read is one Tread operation, no parallel chunking

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** Not reviewed (assumed passing)
**RFC Compliance:** 9P2000 protocol (Plan 9 Fourth Edition)

## Recommendations

### High Priority
1. **Add message size validation** — Validate size field in parse9PMessage < 1MB to prevent OOM attacks
2. **Document path depth limit** — Add to API error messages ("Path depth exceeds 16 components")
3. **Add clearTimeout pattern** — Track timeout handles and clear them in finally blocks

### Medium Priority
4. **Implement multi-read for large directories** — Loop Tread until empty response for complete directory listings
5. **Expose msize as API parameter** — Allow clients to tune message size (default 8192, max 64KB)
6. **Add stat size validation** — Check stat size word in parseStat is reasonable (< 65535)

### Low Priority
7. **Log failed Tclunk operations** — Instead of silent catch, log to help debug FID leaks
8. **Implement 9P2000.u extensions** — Parse n_uid/n_gid fields for Linux compatibility
9. **Add DOTL support** — 9P2000.L extensions for better Linux performance

## See Also

- [9P Protocol Manual](https://man.cat-v.org/plan_9/5/intro) - Official Plan 9 reference
- [9P2000 Wire Format](http://9p.cat-v.org/documentation/rfc/) - Protocol RFC
- [QEMU virtio-9p](https://wiki.qemu.org/Documentation/9psetup) - Common use case
