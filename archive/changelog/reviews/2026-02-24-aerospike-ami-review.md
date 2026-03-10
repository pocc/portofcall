# AEROSPIKE, AJP, AMI, AMQP, AMQPS Protocol Review — 2026-02-24

## AEROSPIKE (`src/worker/aerospike.ts`)

### Pass 1 Result

**0 issues found.**

- `checkIfCloudflare` present in all 4 handlers (`handleAerospikeConnect`, `handleAerospikeKVGet`, `handleAerospikeKVPut`, `handleAerospikeInfo`) ✓
- 10 MiB cap on `bodyLen` in `sendFramedRequest` proto header (48-bit field) ✓
- Port validation with `typeof port !== 'number' || isNaN(port)` in `handleAerospikeConnect` and `handleAerospikeInfo` ✓
- `parseAsResponse` has per-field bounds guards (`if (offset + 4 > data.length) break`) ✓
- `VALID_COMMANDS` allowlist in `handleAerospikeInfo` ✓
- RIPEMD-160 is a protocol requirement for Aerospike key digests (not a bug) ✓

---

## AJP (`src/worker/ajp.ts`)

### Pass 1 Result

**0 issues found.**

- `checkIfCloudflare` present in both handlers (`handleAJPConnect`, `handleAJPRequest`) ✓
- Port validation with `typeof port !== 'number' || isNaN(port)` in both handlers ✓
- `readExact` correctly accumulates bytes with deadline timeout ✓
- `readAJPResponse` uses 16-bit `packetLength` field (max 65535 per AJP spec) to bound each packet ✓
- Response body capped at 4000 chars before return ✓
- Method code lookup uses `??` fallback (unknown methods → GET code 2) ✓

---

## AMI (`src/worker/ami.ts`)

### Pass 1 Findings

| # | ID | Severity | Description | Status |
|---|-----|----------|-------------|--------|
| 1 | BUG-AMI-1 | Medium | `checkIfCloudflare` missing from all 3 TCP connection points: `handleAMIProbe` (line 480), `handleAMICommand` (line 652), and shared `withAMISession` helper (line 884). The database security pass (2026-02-23) fixed the unbounded buffer read (1 MiB cap) but did not add the SSRF guard. | ✅ Fixed |

**Fix:** Added `import { checkIfCloudflare, getCloudflareErrorMessage }` and three guards:
- `handleAMIProbe`: returns 403 before `connect()` if CF host detected
- `handleAMICommand`: returns 403 before `connect()` if CF host detected
- `withAMISession`: throws error before `connect()` if CF host detected (callers' catch blocks propagate the message)

### Pass 2 Result

**0 issues found. AMI review complete.**

---

## AMQP (`src/worker/amqp.ts`)

### Pass 1 Result (continuation of 2026-02-23-amqp-declareok-review.md)

The DeclareOk fix (skip queue-name short string before reading message/consumer counts) is correctly applied at line 1577. No additional issues found.

- `checkIfCloudflare` present in 6 handlers ✓
- 1 MiB cap on `frameSize` in `readFrame` (2 locations) ✓
- `BufferedReader` class used for correct byte accumulation ✓
- Field table parser bails on unknown types ✓
- DeclareOk offset fix: `readShortString(declareOkArgs, 0)` → `dv.getUint32(0)` now at correct offset ✓

**0 new issues found. AMQP review complete.**

---

## AMQPS (`src/worker/amqps.ts`)

### Pass 1 Result

**0 issues found.**

- `checkIfCloudflare` present in 3 handlers (`handleAMQPSConnect`, `handleAMQPSPublish`, `handleAMQPSConsume`) ✓
- 1 MiB cap on `frameSize` ✓
- `BufferedReader` class used ✓
- Delegates publish/consume to shared `doAMQPPublish`/`doAMQPConsume` from amqp.ts (inherits all amqp.ts fixes) ✓

---

## Summary

| Protocol | Status | Notes |
|----------|--------|-------|
| AEROSPIKE | ✅ Clean | 0 findings |
| AJP | ✅ Clean | 0 findings |
| AMI | ✅ Fixed | BUG-AMI-1: added checkIfCloudflare to all 3 connect() sites |
| AMQP | ✅ Clean | DeclareOk fix verified correct, 0 new findings |
| AMQPS | ✅ Clean | 0 findings |
