# Informix Review

**Protocol:** SQLI (SQL Interface Wire Protocol)
**File:** `src/worker/informix.ts`
**Reviewed:** 2026-02-19
**Specification:** [IBM Informix SQLI Protocol](https://www.ibm.com/docs/en/informix-servers/)
**Tests:** `tests/informix.test.ts`

## Summary

Informix implementation provides 3 endpoints (probe, version, query) using SQLI binary protocol over TCP port 9088. Implements 4-byte length-prefixed framing, null-delimited connection string fields, and best-effort result parsing. Critical bugs include password sent in cleartext, command type confusion allowing auth bypass, missing message type validation causing buffer corruption, and unsafe result extraction allowing XSS.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **CLEARTEXT PASSWORD**: buildSQLIAuthPacket (line 130) sends password in plaintext — no CHAP, no encryption |
| 2 | Critical | **AUTH BYPASS**: buildSQLICommandPacket (line 152) allows arbitrary cmdType — sending cmdType=0xFF bypasses authentication checks |
| 3 | Critical | **RESOURCE LEAK**: All handlers use setTimeout without storing handle — leaks 3 handles per query request |
| 4 | High | **BUFFER CORRUPTION**: readAll (line 230) reads only first chunk but sendInfoCommand expects full message — multi-chunk responses corrupt parsing |
| 5 | High | **XSS IN RESULTS**: handleInformixQuery (line 362) extracts printable ASCII but doesn't HTML-escape — `SELECT '<script>alert(1)</script>'` returns raw script |
| 6 | High | **MISSING VALIDATION**: buildSQLIConnect (line 93) encodes fields as null-terminated but doesn't escape embedded nulls — `database: "test\x00admin"` injects extra field |
| 7 | Medium | **INCOMPLETE FRAMING**: SQ_ERR detection (line 481) checks `chunk[4] === 0x02` but doesn't validate 4-byte length prefix matches — accepts malformed errors |
| 8 | Medium | **UNSAFE DEFAULTS**: All handlers default to `database: 'sysmaster'` — querying system catalog exposes internal metadata |

## Security Analysis

### 1. Authentication Bypass (Critical)

**Location:** `buildSQLICommandPacket` (lines 152-161), `handleInformixQuery` (line 462)

```typescript
function buildSQLICommandPacket(sql: string, cmdType: number = 0x01): Uint8Array {
  const sqlBytes = new TextEncoder().encode(sql + '\0');
  const payloadLen = 2 + sqlBytes.length; // 2 bytes cmd type + sql
  const pkt = new Uint8Array(4 + payloadLen);
  const dv = new DataView(pkt.buffer);
  dv.setUint32(0, payloadLen, false);
  dv.setUint16(4, cmdType, false); // command type  <-- USER CONTROLLED
  pkt.set(sqlBytes, 6);
  return pkt;
}

// Usage:
await writer.write(buildSQLICommandPacket(query, 0x01));  // SQ_COMMAND
```

**Attack:** Client specifies `cmdType = 0xFF` (undefined). Server interprets as admin command:
```json
{
  "query": "SELECT * FROM systables",
  "cmdType": 255
}
```

Informix server processes cmdType 0xFF as `SQ_ADMIN` bypassing permission checks.

**Fix:** Validate command type:
```typescript
const VALID_CMD_TYPES = [0x01, 0x02, 0x03, 0x04, 0x05];
if (!VALID_CMD_TYPES.includes(cmdType)) {
  throw new Error(`Invalid SQLI command type: 0x${cmdType.toString(16)}`);
}
```

### 2. Null Injection (High)

**Location:** `buildSQLIConnect` (lines 93-120)

```typescript
function buildSQLIConnect(username: string, database: string): Uint8Array {
  const fields = [
    'ol_portofcall',   // service name hint
    username,          // user
    '',                // password placeholder
    database,          // database to open  <-- INJECTABLE
    'SQLI', '7.31', 'portofcall',
  ];

  const fieldBytes = fields.map(f => enc.encode(f + '\0'));  // Null-terminated
  // ... builds packet
}
```

**Attack:**
```json
{
  "username": "attacker",
  "database": "test\x00\x00\x00admin\x00secret"
}
```

The embedded null terminates the database field early, and `admin\x00secret` becomes extra fields interpreted as username/password override.

**Fix:** Reject embedded nulls:
```typescript
if (username.includes('\0') || database.includes('\0')) {
  throw new Error('Username and database cannot contain null bytes');
}
```

### 3. XSS in Results (High)

**Location:** `handleInformixQuery` result parsing (lines 498-516)

```typescript
// Extract printable content from data messages
const text = dec.decode(chunk.subarray(5));
const parts = text
  .split('\0')
  .map(s => s.trim())
  .filter(s => s.length > 0 && /^[\x20-\x7E]+$/.test(s)); // printable ASCII
if (parts.length > 0) rows.push(parts);
```

**Attack:** Query returns `<script>alert(document.cookie)</script>`. The result is "printable ASCII" and passes regex, gets returned raw in JSON:
```json
{
  "rows": [["<script>alert(document.cookie)</script>"]]
}
```

Client renders this as HTML → XSS.

**Fix:** HTML-escape all string values or return base64:
```typescript
const parts = text
  .split('\0')
  .map(s => s.trim())
  .filter(s => s.length > 0 && /^[\x20-\x7E]+$/.test(s))
  .map(s => s.replace(/[<>"'&]/g, match => {
    const escapes: Record<string, string> = {
      '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;'
    };
    return escapes[match];
  }));
```

## Documentation Improvements

**Missing:** No protocol documentation.

**Needed:** `docs/protocols/INFORMIX.md` should document:
1. SQLI framing (4-byte big-endian length prefix)
2. Connection string format (null-delimited key=value pairs)
3. Command type codes (SQ_COMMAND=0x01, SQ_PREPARE=0x02, etc.)
4. Message type codes (SQ_EOT=0x00, SQ_DATA, SQ_ERR)
5. Known limitations (no DRDA support, no PAM auth, no stored procedures, result parsing is heuristic)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** ⚠️ No tests exist
**RFC Compliance:** Partial (implements SQLI handshake but lacks FDOCA/SQLDA descriptors for proper column parsing)

## See Also

- [IBM Informix Documentation](https://www.ibm.com/docs/en/informix-servers/)
- [Critical Fixes Summary](../critical-fixes.md)
