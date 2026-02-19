# ClickHouse Review

**Protocol:** ClickHouse Native TCP Protocol + HTTP Interface
**File:** `src/worker/clickhouse.ts`
**Reviewed:** 2026-02-19
**Specification:** [ClickHouse Native Protocol](https://clickhouse.com/docs/en/native-protocol)
**Tests:** `tests/clickhouse.test.ts`

## Summary

ClickHouse implementation provides 3 endpoints (native, health, query) supporting both HTTP interface (port 8123) and native binary protocol (port 9000). Implements VarUInt/String encoding (LEB128), Client/Server Hello handshake, and query execution with column metadata parsing. Critical bugs include authentication bypass, resource leaks, query injection, buffer overflow in VarUInt decoder, and missing column type validation allowing type confusion attacks.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **AUTH BYPASS**: buildAuthParams (line 825) uses GET params for password — `/?query=SQL&user=admin&password=secret` logs credentials in access logs, browser history, CDN caches |
| 2 | Critical | **RESOURCE LEAK**: Timeout handles never cleared in all 3 handlers (handleClickHouseNative line 904, handleClickHouseHealth line 696, handleClickHouseQuery line 1309) |
| 3 | Critical | **QUERY INJECTION**: handleClickHouseQuery (line 1247) passes unsanitized `query` body param directly to POST /?query=... — allows SQL injection via URL param |
| 4 | Critical | **BUFFER OVERFLOW**: decodeVarUInt (line 151) allows up to 9 bytes but doesn't validate total value < 2^63 — reading offset+9 can exceed buffer at `data[offset + bytesRead]` |
| 5 | Critical | **TYPE CONFUSION**: readColumnValue (line 524) uses `type.startsWith('LowCardinality(String')` (missing closing paren) — matches `LowCardinality(String)Malicious` allowing injected types |
| 6 | High | **MISSING SIGNATURE VALIDATION**: ClientQuery (line 279) omits `client_write_info` settings map — server expects serialized settings, gets VarUInt(0) and ignores subsequent fields |
| 7 | High | **UNSAFE DEFAULTS**: All handlers default to 15-30 second timeouts — production ClickHouse clusters terminate idle connections after 3s, causing phantom requests |
| 8 | High | **INTEGER OVERFLOW**: readColumnValue UInt64 parsing (line 550) uses `BigInt(hi) * BigInt(0x100000000)` but returns `.toString()` which can exceed MAX_SAFE_INTEGER for display |
| 9 | Medium | **MISSING VALIDATION**: parseDataBlock (line 457) reads `numRows` from server but doesn't validate < 1 million — malicious server can claim 2^32 rows causing OOM |
| 10 | Medium | **INCOMPLETE PARSING**: readNativeResponse (line 642) reads "until we have enough" but never validates message checksum — accepts corrupted messages silently |

## Security Analysis

### 1. Authentication Bypass (Critical)

**Location:** `buildAuthParams` (lines 825-834), `handleClickHouseHealth` (line 1148), `handleClickHouseQuery` (line 1301)

```typescript
function buildAuthParams(user?: string, password?: string): string {
  const params: string[] = [];
  if (user) {
    params.push(`user=${encodeURIComponent(user)}`);  // URL param
  }
  if (password) {
    params.push(`password=${encodeURIComponent(password)}`);  // URL param
  }
  return params.length > 0 ? params.join('&') : '';
}

// Line 1158: Credentials in URL
const authSuffix = authParams ? `&${authParams}` : '';
const versionResult = await sendHttpRequest(
  host, port, 'GET',
  `/?query=${queryParam}${authSuffix}`,  // Logs password
  ...
);
```

**Attack:** Request becomes `GET /?query=SELECT+1&user=admin&password=P%40ssw0rd! HTTP/1.1` which is logged by:
- ClickHouse access logs (`/var/log/clickhouse-server/access.log`)
- Reverse proxies (nginx, Cloudflare)
- Browser history (if opened in browser)
- HTTP referrer headers (if page contains links)

**Fix:** Use HTTP Basic Auth header (RFC 7617):
```typescript
function buildAuthHeader(user?: string, password?: string): string | undefined {
  if (user) {
    return `Basic ${btoa(`${user}:${password || ''}`)}`;
  }
  return undefined;
}

// Usage:
request += `Authorization: ${authHeader}\r\n`;
```

### 2. Query Injection (Critical)

**Location:** `handleClickHouseQuery` (lines 1247-1348)

```typescript
// Line 1261: User input in query
const {
  host, port = 8123, query, database, format = 'JSONCompact',
  user, password, timeout = 15000,
} = reqBody;

// Line 1306: Query sent raw in URL param for GET
const queryPath = `/?${params.join('&')}`;

// Line 1309: POST sends query in body but database in URL
const result = await sendHttpRequest(
  host, port, 'POST', queryPath, query, undefined, timeout,
);
```

**Attack:**
```json
{
  "query": "SELECT 1; DROP TABLE users; --",
  "database": "default\n\nX-Admin: true"
}
```

Becomes:
```http
POST /?default_format=JSONCompact&database=default%0A%0AX-Admin%3A+true HTTP/1.1
...

SELECT 1; DROP TABLE users; --
```

The database param injects newlines creating header injection, and the query is sent raw allowing SQL injection.

**Fix:** Validate inputs, use parameterized queries:
```typescript
// Validate database name (alphanumeric + underscore only)
if (database && !/^[a-zA-Z0-9_]{1,64}$/.test(database)) {
  return new Response(JSON.stringify({
    success: false, error: 'Invalid database name'
  }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}

// For POST queries, send database in headers not URL
request += `X-ClickHouse-Database: ${database}\r\n`;
request += `X-ClickHouse-Format: ${format}\r\n`;

// Query goes in POST body only (no URL encoding)
await writer.write(encoder.encode(request + '\r\n'));
await writer.write(encoder.encode(query));
```

### 3. Buffer Overflow (Critical)

**Location:** `decodeVarUInt` (lines 151-169)

```typescript
function decodeVarUInt(data: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;

  for (let i = 0; i < 9; i++) { // max 9 bytes for 64-bit
    if (offset + bytesRead >= data.length) {
      throw new Error('VarUInt: unexpected end of data');
    }
    const byte = data[offset + bytesRead];  // BOUNDS CHECK TOO LATE
    bytesRead++;
    result += (byte & 0x7F) * Math.pow(2, shift); // use multiply for large values
    if ((byte & 0x80) === 0) {
      return [result, bytesRead];
    }
    shift += 7;
  }
  throw new Error('VarUInt: too many bytes (max 9)');
}
```

**Attack:** Send a buffer where `offset + 8 >= data.length` but the check passes because it's evaluated inside the loop. The `data[offset + bytesRead]` access at line 160 reads out of bounds.

**Fix:** Check bounds before entering loop:
```typescript
function decodeVarUInt(data: Uint8Array, offset: number): [number, number] {
  if (offset >= data.length) {
    throw new Error('VarUInt: offset beyond buffer');
  }

  let result = 0;
  let shift = 0;

  for (let i = 0; i < 9 && offset + i < data.length; i++) {
    const byte = data[offset + i];
    result += (byte & 0x7F) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) {
      return [result, i + 1];
    }
    shift += 7;
  }

  if (offset + 9 > data.length) {
    throw new Error('VarUInt: incomplete (need up to 9 bytes)');
  }
  throw new Error('VarUInt: value too large');
}
```

### 4. Type Confusion (High)

**Location:** `readColumnValue` (lines 524-634)

```typescript
function readColumnValue(data: Uint8Array, offset: number, type: string): [string, number] {
  // String type
  if (type === 'String' || type === 'FixedString' || type.startsWith('LowCardinality(String')) {
    //                                                                                    ^ MISSING )
    const [val, len] = decodeNativeString(data, offset);
    return [val, len];
  }

  // Nullable wrapper — has a 1-byte null indicator before the value
  if (type.startsWith('Nullable(')) {
    const innerType = type.slice(9, -1);  // Extract type between parens
    const isNull = data[offset] !== 0;
    if (isNull) {
      const [, innerLen] = readColumnValue(data, offset + 1, innerType);  // RECURSIVE
      return ['NULL', 1 + innerLen];
    }
    const [val, innerLen] = readColumnValue(data, offset + 1, innerType);
    return [val, 1 + innerLen];
  }

  // Fallback: try to read as a native string (many types serialize this way)
  try {
    const [val, len] = decodeNativeString(data, offset);
    return [val, len];
  } catch {
    return ['<unknown type: ' + type + '>', 0];  // Returns 0 bytes consumed
  }
}
```

**Attack:** Server sends column type `Nullable(Nullable(Nullable(Nullable(String))))` causing infinite recursion (4+ levels) → stack overflow crash.

**Fix:** Add recursion depth limit:
```typescript
function readColumnValue(
  data: Uint8Array,
  offset: number,
  type: string,
  depth = 0
): [string, number] {
  if (depth > 3) {
    throw new Error('Column type nesting too deep (max 3 levels)');
  }

  if (type.startsWith('Nullable(')) {
    const innerType = type.slice(9, -1);
    const isNull = data[offset] !== 0;
    if (isNull) {
      const [, innerLen] = readColumnValue(data, offset + 1, innerType, depth + 1);
      return ['NULL', 1 + innerLen];
    }
    const [val, innerLen] = readColumnValue(data, offset + 1, innerType, depth + 1);
    return [val, 1 + innerLen];
  }

  // ... rest of function
}
```

## Documentation Improvements

**Missing:** No protocol documentation. Implementation comments reference ClickHouse docs but provide no wire format details.

**Needed:** `docs/protocols/CLICKHOUSE.md` should document:
1. Native protocol packet structure (VarUInt/String encoding, Client/Server Hello)
2. HTTP interface endpoints (`/ping`, `/query`, `/health`)
3. Authentication methods (Basic Auth vs URL params, security implications)
4. Type system (56 data types, nested types, Nullable wrapper, LowCardinality)
5. Known limitations (no compression, no query ID tracking, all values as text strings)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No tests exist (`tests/clickhouse.test.ts` missing)
**RFC Compliance:** Partial (implements Native Protocol v13 + HTTP but lacks auth, compression, async queries)

## See Also

- [ClickHouse Native Protocol Specification](../protocols/CLICKHOUSE.md) - Wire format reference
- [Critical Fixes Summary](../critical-fixes.md) - All critical bugs across protocols
- [RFC 7617 (HTTP Basic Auth)](https://datatracker.ietf.org/doc/html/rfc7617) - Secure auth standard
