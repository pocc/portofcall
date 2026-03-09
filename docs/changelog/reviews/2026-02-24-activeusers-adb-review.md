# ACTIVEUSERS + ADB Protocol Review — 2026-02-24

## ACTIVEUSERS (`src/worker/activeusers.ts`)

### Pass 1 Findings

| # | ID | Severity | Description | Status |
|---|-----|----------|-------------|--------|
| 1 | BUG-AU-1 | Medium | `checkIfCloudflare` missing from all 3 handlers (`handleActiveUsersTest`, `handleActiveUsersQuery`, `handleActiveUsersRaw`). All three use `connect()` but the `cloudflare-detector` import was absent. | ✅ Fixed |

**Fix:** Added `import { checkIfCloudflare, getCloudflareErrorMessage }` and `checkIfCloudflare(host)` guard before each `connect()` call in all three handlers. Same pattern as ECHO, DAYTIME, DISCARD fixed in the database security pass.

### Pass 2 Result

**0 issues found. ACTIVEUSERS review complete.**

---

## ADB (`src/worker/adb.ts`)

### Pass 1 Result

**0 issues found.**

- `checkIfCloudflare` present in all 4 handlers ✓
- `readAll` soft cap at 65536 bytes ✓ (max allocation ~131 KB, not a problem)
- Shell output capped at 4 MiB (`MAX_SHELL_OUTPUT`) ✓
- `readAtLeast` bounded by protocol field widths (4-byte status + 4-byte length + max 65535-byte reason) ✓
- Port validation with `typeof port !== 'number' || isNaN(port)` ✓
- Serial injection guard: `[\r\n\0]` rejection ✓
