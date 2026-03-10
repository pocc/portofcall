# B Protocols Review — 2026-02-24

## BATTLENET (`src/worker/battlenet.ts`)

### Pass 1 Findings

| # | ID | Severity | Description | Status |
|---|-----|----------|-------------|--------|
| 1 | BUG-BNET-1 | Medium | `checkIfCloudflare` missing from `handleBattlenetConnect` and `handleBattlenetAuthInfo`. Both call `connect(${host}:${port})` where `host` is user-supplied, without the SSRF guard. The database security pass listed BATTLENET as "safe" but this guard was absent from the import list and all handler code. `handleBattlenetStatus` connects to hardcoded realm hosts from `BATTLENET_REALMS` constant — no user-controlled host — so no guard needed there. | ✅ Fixed |

**Fix:** Added `import { checkIfCloudflare, getCloudflareErrorMessage }` and:
- `handleBattlenetConnect`: returns 403 before `connect()` if CF host detected
- `handleBattlenetAuthInfo`: returns 403 before `connect()` if CF host detected

### Pass 2 Result

**0 issues found. BATTLENET review complete.**

---

## BEANSTALKD (`src/worker/beanstalkd.ts`)

### Pass 1 Result

**0 issues found.**

- `checkIfCloudflare` present in all handlers ✓
- 64 KB cap in `readBeanstalkdResponse` ✓
- `parseBodyByteCount`: NaN case falls through to single-line handler (safe) ✓
- Multi-line response reads: waits for `headerEnd + 2 + byteCount + 2` bytes, bounded by 64KB cap ✓
- CRLF check on commands (database security pass confirmed) ✓
- Command allowlist present ✓

---

## BEATS (`src/worker/beats.ts`)

### Pass 1 Result

**0 issues found.**

- `checkIfCloudflare` present in all 3 handlers ✓
- `parseAckFrame`: bounds check (data.length < 6 → null) ✓
- `encodeJsonFrame`: builds fixed-size frame correctly (version 1B + type 1B + seqnum 4B + len 4B + payload) ✓
- ACK response: single `reader.read()` (Beats ACK is 6 bytes, always fits in one chunk) ✓
- Binary protocol, no text injection risk ✓

---

## BGP (`src/worker/bgp.ts`)

### Pass 1 Result

**0 issues found.**

- `checkIfCloudflare` present in 3 handlers ✓
- BGP message length bounded by 16-bit field (max 65535) ✓
- Buffer accumulation loop for split packets in OPEN handler ✓
- Router ID validated as IPv4 dotted-decimal ✓
- maxRoutes and collectMs capped ✓

---

## BITCOIN (`src/worker/bitcoin.ts`)

### Pass 1 Result

**0 issues found.**

- `checkIfCloudflare` present in 3 handlers ✓
- `readMessage` uses `BufferedReader` for correct byte accumulation ✓
- 10 MiB cap on `payloadLen` in `readMessage` (database security pass fix) ✓
- Port validation in all handlers ✓

---

## BITTORRENT (`src/worker/bittorrent.ts`)

### Pass 1 Result

**0 issues found.**

- `checkIfCloudflare` present in 5 handlers ✓
- `readPeerMessage` uses `BufferedReader`; 1 MiB cap on message length ✓
- Strict hex validation for `infoHash` ✓
- Tracker handlers use `fetch()` with AbortSignal (not TCP sockets) ✓

---

## Summary

| Protocol | Status | Notes |
|----------|--------|-------|
| BATTLENET | ✅ Fixed | BUG-BNET-1: added checkIfCloudflare to Connect and AuthInfo handlers |
| BEANSTALKD | ✅ Clean | 0 findings |
| BEATS | ✅ Clean | 0 findings |
| BGP | ✅ Clean | 0 findings |
| BITCOIN | ✅ Clean | 0 findings |
| BITTORRENT | ✅ Clean | 0 findings |
