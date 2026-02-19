# Tarantool Review

**Protocol:** Tarantool IPROTO (MessagePack Binary Protocol)
**File:** `src/worker/tarantool.ts`
**Reviewed:** 2026-02-19
**Specification:** [Tarantool IPROTO Protocol](https://www.tarantool.io/en/doc/latest/dev_guide/internals/iproto/)
**Tests:** `tests/tarantool.test.ts`

## Summary

Tarantool implementation provides 5 endpoints (connect, probe, eval, sql) using IPROTO binary protocol over TCP port 3301. Implements MessagePack encoding/decoding, 128-byte greeting banner, IPROTO_PING/EVAL/EXECUTE requests, and column metadata parsing. Critical bugs include resource leaks, Lua code injection in eval handler, missing MessagePack bomb protection, and SQL injection in execute handler.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **LUA INJECTION**: handleTarantoolEval (line 963) sends unsanitized `expression` directly to IPROTO_EVAL — allows arbitrary Lua code execution |
| 2 | Critical | **SQL INJECTION**: handleTarantoolSQL (line 1040) sends unsanitized `sql` directly to IPROTO_EXECUTE — standard SQL injection vulnerability |
| 3 | Critical | **RESOURCE LEAK**: All handlers use setTimeout without clearing — handleTarantoolConnect (line 434), handleTarantoolEval (line 984), handleTarantoolSQL (line 1060) |
| 4 | High | **MSGPACK BOMB**: mpDecode (line 764) recursively parses nested arrays/maps with no depth limit — `[[[[...]]]]` causes stack overflow |
| 5 | High | **BUFFER OVERREAD**: readExact (line 47) assumes chunks arrive in order but doesn't validate total — can read past buffer if chunks overlap |
| 6 | High | **MISSING AUTH**: No authentication implementation despite Tarantool supporting user/password — all requests are guest-level |
| 7 | Medium | **TYPE CONFUSION**: mpDecode (line 764) returns `unknown` type — callers assume structure without validation causing runtime errors |
| 8 | Medium | **INCOMPLETE IPROTO**: Only implements PING/EVAL/EXECUTE — missing INSERT/UPDATE/DELETE/CALL/AUTH |

## Security Analysis

### 1. Lua Injection (Critical)

**Location:** `handleTarantoolEval` (lines 963-1032)

```typescript
export async function handleTarantoolEval(request: Request, _env: unknown): Promise<Response> {
  // ...
  const { host, port = 3301, timeout = 15000, expression, args = [] } = body;

  if (!expression) return new Response(JSON.stringify({
    success: false, error: 'Lua expression is required'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // ... connects to Tarantool
  // Line 1004: Sends expression raw
  const evalPacket = buildEvalPacket(expression, args, 1);
  await writer.write(evalPacket);
  // ...
}
```

**Attack:**
```json
{
  "expression": "require('ffi').C.system('rm -rf /')"
}
```

Tarantool's Lua runtime has FFI (Foreign Function Interface) enabled by default, allowing direct system calls. The injected code deletes all files on the server.

**Fix:** Sandbox Lua execution or reject dangerous patterns:
```typescript
// Reject expressions containing dangerous patterns
const forbidden = ['require', 'ffi', 'io.', 'os.execute', 'os.remove', 'loadstring', 'dofile'];
for (const pattern of forbidden) {
  if (expression.toLowerCase().includes(pattern)) {
    return new Response(JSON.stringify({
      success: false,
      error: `Lua expression contains forbidden pattern: ${pattern}`
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

// For production: use Tarantool's built-in sandboxing via box.session.su()
```

### 2. SQL Injection (Critical)

**Location:** `handleTarantoolSQL` (lines 1040-1137)

```typescript
export async function handleTarantoolSQL(request: Request, _env: unknown): Promise<Response> {
  // ...
  const { host, port = 3301, timeout = 15000, sql } = body;

  if (!sql) return new Response(JSON.stringify({
    success: false, error: 'SQL statement is required'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Line 1080: SQL sent raw
  const execPacket = buildExecutePacket(sql, 2);
  await writer.write(execPacket);
  // ...
}
```

**Attack:**
```json
{
  "sql": "SELECT * FROM users WHERE id = 1; DROP TABLE users; --"
}
```

Tarantool executes both statements: returns user data, then drops the table.

**Fix:** Implement parameterized queries:
```typescript
// Reject multi-statement SQL
if (sql.split(';').filter(s => s.trim()).length > 1) {
  return new Response(JSON.stringify({
    success: false,
    error: 'Multi-statement SQL not allowed (use parameters)'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}

// For production: use IPROTO_SQL_BIND parameter binding
function buildExecutePacket(sql: string, params: unknown[], syncId: number): Uint8Array {
  // ... encode SQL_TEXT
  // ... encode SQL_BIND: params array (MessagePack)
}
```

### 3. MessagePack Bomb (High)

**Location:** `mpDecode` (lines 764-862)

```typescript
function mpDecode(data: Uint8Array, off: number): [unknown, number] {
  // ...
  // fixarray
  if ((b & 0xF0) === 0x90) {
    const len = b & 0x0F;
    const arr: unknown[] = [];
    let cur = off + 1;
    for (let i = 0; i < len; i++) {
      const [v, next] = mpDecode(data, cur);  // RECURSIVE, NO DEPTH LIMIT
      arr.push(v); cur = next;
    }
    return [arr, cur];
  }

  // fixmap
  if ((b & 0xF0) === 0x80) {
    const len = b & 0x0F;
    const obj: Record<string, unknown> = {};
    let cur = off + 1;
    for (let i = 0; i < len; i++) {
      const [k, kEnd] = mpDecode(data, cur);  // RECURSIVE
      const [v, vEnd] = mpDecode(data, kEnd);  // RECURSIVE
      obj[String(k)] = v; cur = vEnd;
    }
    return [obj, cur];
  }
  // ...
}
```

**Attack:** Malicious server sends MessagePack:
```
[[[[[[[[[[[[[[[[[[[...100 levels deep...]]]]]]]]]]]]]]]]]]]
```

Each level adds a stack frame. At depth 100, JavaScript stack exhausted → crash.

**Fix:** Add recursion depth limit:
```typescript
function mpDecode(data: Uint8Array, off: number, depth = 0): [unknown, number] {
  if (depth > 20) {
    throw new Error('MessagePack nesting too deep (max 20 levels)');
  }

  if (off >= data.length) return [null, off];
  const b = data[off];

  // fixarray
  if ((b & 0xF0) === 0x90) {
    const len = b & 0x0F;
    const arr: unknown[] = [];
    let cur = off + 1;
    for (let i = 0; i < len; i++) {
      const [v, next] = mpDecode(data, cur, depth + 1);  // Pass depth
      arr.push(v); cur = next;
    }
    return [arr, cur];
  }

  // fixmap
  if ((b & 0xF0) === 0x80) {
    const len = b & 0x0F;
    const obj: Record<string, unknown> = {};
    let cur = off + 1;
    for (let i = 0; i < len; i++) {
      const [k, kEnd] = mpDecode(data, cur, depth + 1);
      const [v, vEnd] = mpDecode(data, kEnd, depth + 1);
      obj[String(k)] = v; cur = vEnd;
    }
    return [obj, cur];
  }
  // ...
}
```

## Documentation Improvements

**Missing:** No protocol documentation.

**Needed:** `docs/protocols/TARANTOOL.md` should document:
1. IPROTO message structure (5-byte size + header map + body map)
2. MessagePack encoding (VarUInt, fixstr, fixarray, fixmap)
3. Request types (PING=0x40, EVAL=0x29, EXECUTE=0x0b)
4. Greeting banner format (64 bytes version + 44 bytes salt)
5. Known limitations (no auth, no replication, no streams, Lua FFI unsafe)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No tests exist
**RFC Compliance:** Partial (implements IPROTO but lacks AUTH, INSERT/UPDATE/DELETE, streams)

## See Also

- [Tarantool IPROTO Protocol](https://www.tarantool.io/en/doc/latest/dev_guide/internals/iproto/)
- [MessagePack Specification](https://msgpack.org/index.html)
- [Critical Fixes Summary](../critical-fixes.md)
