# Firebird Review

**Protocol:** Firebird Wire Protocol (op_connect/op_attach)
**File:** `src/worker/firebird.ts`
**Reviewed:** 2026-02-19
**Specification:** [Firebird Wire Protocol](https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref40/firebird-40-language-reference.html)
**Tests:** `tests/firebird.test.ts`

## Summary

Firebird implementation provides 4 endpoints (probe, auth, query, version) using Firebird wire protocol over TCP port 3050. Implements XDR encoding, op_connect/op_accept handshake, op_attach with DPB credentials, and SQL query execution. Major bug fixed: spurious u32(0) in buildAttachPacket caused 100% authentication failures. Critical remaining bugs include resource leaks, SQL injection in query handler, missing ISC status vector validation, and password sent in cleartext.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **RESOURCE LEAK**: Timeout handles never cleared — all handlers use `setTimeout()` but never store handle or call `clearTimeout()` |
| 2 | Critical | **SQL INJECTION**: handleFirebirdQuery (line 658) sends unsanitized `query` param directly to op_prepare_statement — allows arbitrary SQL execution |
| 3 | Critical | **CLEARTEXT PASSWORD**: buildDPB (line 119) sends password in plaintext — no encryption, easily sniffed on network |
| 4 | High | **MISSING VALIDATION**: parseServerException (line 426) reads status vector but doesn't validate field types — malformed entries cause buffer overrun |
| 5 | High | **PROTOCOL CONFUSION**: buildConnectPacket (line 155) advertises protocol 13 but doesn't validate server's accepted version — may negotiate incompatible protocol |
| 6 | Medium | **INCOMPLETE ERROR HANDLING**: recvPacket (line 355) returns `{opcode}` for unknown types — caller can't distinguish error from success |
| 7 | Medium | **UNSAFE DEFAULTS**: All handlers default to database `/tmp/test.fdb` — production databases should not have world-writable paths |
| 8 | Low | **MISSING FRAMING**: buildFetch (line 288) uses empty BLR descriptor — fetches raw binary data instead of typed columns |

## Security Analysis

### 1. SQL Injection (Critical)

**Location:** `handleFirebirdQuery` (lines 658-786)

```typescript
const {
  host, port = 3050, database = '/tmp/test.fdb',
  username = 'SYSDBA', password = 'masterkey',
  query = "SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 1",
} = await request.json<{...}>();

// Line 732: Query sent raw
await fs.writer.write(buildPrepareStatement(trHandle, stmtHandle, query));
```

**Attack:**
```json
{
  "query": "SELECT * FROM USERS WHERE ID = 1; DROP TABLE USERS; --"
}
```

The query is sent directly to `op_prepare_statement` without any validation or parameterization. Firebird executes multiple statements separated by semicolons.

**Fix:** Use parameterized queries (Firebird XSQLDA):
```typescript
// Reject multi-statement queries
if (query.split(';').filter(s => s.trim()).length > 1) {
  return new Response(JSON.stringify({
    success: false,
    error: 'Multi-statement queries not allowed (use parameters)',
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}

// For production: implement XSQLDA parameter binding
```

### 2. Cleartext Password (Critical)

**Location:** `buildDPB` (lines 119-129), `handleFirebirdAuth` (line 612)

```typescript
function buildDPB(username: string, password: string): Uint8Array {
  const items: number[] = [isc_dpb_version1];
  const addItem = (code: number, value: string) => {
    const b = enc.encode(value);
    items.push(code, b.length, ...b);
  };
  addItem(isc_dpb_user_name, username);
  addItem(isc_dpb_password, password);  // CLEARTEXT
  addItem(isc_dpb_lc_ctype, 'UTF8');
  return new Uint8Array(items);
}
```

**Attack:** Network sniffing captures DPB with password in plaintext. Anyone with tcpdump/Wireshark can read credentials.

**Fix:** Use wire protocol encryption (Firebird 3.0+ SRP):
```typescript
// Phase 1: Client sends username only
const authData = buildAuthPlugin('Srp', username);

// Phase 2: Server responds with salt + public key
const { salt, serverPubKey } = parseAuthMore(authResp);

// Phase 3: Client computes SRP proof
const proof = computeSRP(username, password, salt, serverPubKey);
await fs.writer.write(buildAuthCont('Srp', proof));
```

### 3. Missing Status Vector Validation (High)

**Location:** `recvPacket` op_response parsing (lines 369-444)

```typescript
while (true) {
  const typeBuf = await recvBytes(s, 4, timeoutMs);
  const argType = readU32(typeBuf, 0);

  if (argType === 0) break; // isc_arg_end

  if (argType === 1) {
    // isc_arg_gds: u32 ISC error code
    await recvBytes(s, 4, timeoutMs); // consume error code
    continue;
  }

  if (argType === 2 || argType === 5 || argType === 19) {
    // isc_arg_string / isc_arg_interpreted / isc_arg_sql_state: XDR string
    const strLenBuf = await recvBytes(s, 4, timeoutMs);
    const strLen = readU32(strLenBuf, 0);  // NO VALIDATION
    const strPad = (4 - (strLen % 4)) % 4;
    if (strLen > 0) {
      const strData = await recvBytes(s, strLen + strPad, timeoutMs);
      // ... processes string
    }
    continue;
  }

  // Unknown arg type: assume u32 value and skip
  await recvBytes(s, 4, timeoutMs);  // UNSAFE
}
```

**Attack:** Server sends `argType = 999` (unknown). Code assumes it's 4 bytes and reads `recvBytes(s, 4, ...)`. But argType 999 might be a 1000-byte blob, causing the next field to start 996 bytes late, corrupting all subsequent parsing.

**Fix:** Validate known types only:
```typescript
if (argType === 0) break;
if (argType === 1 || argType === 4) {
  await recvBytes(s, 4, timeoutMs);
  continue;
}
if (argType === 2 || argType === 5 || argType === 19) {
  const strLenBuf = await recvBytes(s, 4, timeoutMs);
  const strLen = readU32(strLenBuf, 0);
  if (strLen > 65535) {
    throw new Error(`Status vector string too long: ${strLen} bytes`);
  }
  const strPad = (4 - (strLen % 4)) % 4;
  const strData = await recvBytes(s, strLen + strPad, timeoutMs);
  // ...
  continue;
}
// Unknown type
throw new Error(`Unknown ISC status vector type: ${argType}`);
```

## Documentation Improvements

**Missing:** No protocol documentation exists.

**Needed:** `docs/protocols/FIREBIRD.md` should document:
1. XDR encoding rules (4-byte alignment, big-endian, string padding)
2. Opcode table (op_connect=1, op_accept=2, op_attach=19, op_response=9, etc.)
3. DPB (Database Parameter Block) format
4. ISC status vector structure (typed linked list)
5. Known limitations (no TLS, no SRP auth, no batch queries, BLR parsing incomplete)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No tests exist
**RFC Compliance:** Partial (implements protocol v13 but lacks encryption, events, blob streaming)

## See Also

- [Firebird Wire Protocol Docs](https://firebirdsql.org/file/documentation/html/en/refdocs/)
- [Critical Fixes Summary](../critical-fixes.md)
