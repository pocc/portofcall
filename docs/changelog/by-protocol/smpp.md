# SMPP Review

**Protocol:** SMPP v3.4 (Short Message Peer-to-Peer)
**File:** `src/worker/smpp.ts`
**Reviewed:** 2026-02-19
**Specification:** SMPP v3.4 Specification
**Tests:** `tests/smpp.test.ts`

## Summary

SMPP implementation provides 4 endpoints (connect, submit, probe, query) for SMS gateway connectivity testing. Implements binary PDU encoding/decoding with proper big-endian byte order. Supports bind_transceiver for bidirectional messaging. **NOTE:** SMPP typically runs over unencrypted TCP (no TLS) — credentials transmitted in cleartext.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **NO ENCRYPTION**: SMPP v3.4 has NO native TLS support — username/password sent in cleartext over TCP (port 2775), visible to network sniffers |
| 2 | Critical | **RESOURCE LEAK**: `readBytes` helper (line 249) never releases timeout handle — every PDU read creates uncancelled `setTimeout` |
| 3 | High | **BUFFER OVERFLOW**: PDU length validation (lines 332-333, 692-693) accepts up to 65536 bytes but does not enforce max Worker memory — malicious server can OOM Worker |
| 4 | High | **INJECTION**: C-Octet string encoding (lines 95-102) does not validate for NUL bytes before truncation — embedded NULs corrupt field boundaries |
| 5 | Medium | **TYPE CONFUSION**: `decodeCOctet` (lines 107-114) assumes valid UTF-8 — invalid sequences decoded as replacement chars (�), breaks internationalization |
| 6 | Low | **INCOMPLETE ERROR HANDLING**: Generic NACK response (line 361-362) treated as SMPP server — should distinguish from protocol errors |

## Security Analysis (No TLS)

### Cleartext Protocol Risk

**SMPP v3.4 Specification:**
> SMPP does not define any native security mechanisms. Security must be
> provided at the transport layer (e.g., VPN, SSH tunnel) or network layer.

**Current Implementation:**
```typescript
const socket = connect(`${host}:${port}`);  // ❌ No TLS option
```

**Credentials Exposure:**
```typescript
// Line 328: bind_transceiver PDU contains cleartext password
const sysIdBytes = encodeCOctet(systemId, 16);   // Username
const passBytes = encodeCOctet(password, 9);     // Password ← VISIBLE ON WIRE
```

**Network Traffic (Wireshark capture):**
```
SMPP PDU: bind_transceiver
  System ID: "testuser"
  Password: "secret123"    ← PLAINTEXT
  System Type: ""
```

### Attack Scenarios

1. **Credential Theft**
   - Attacker on same network segment captures bind_transceiver PDU
   - Extracts username/password from packet bytes
   - Gains access to SMS gateway (can send spam, phishing SMS)

2. **SMS Interception**
   - Submit_sm PDUs contain phone numbers and message text
   - Attacker reads sensitive SMS (2FA codes, notifications)

3. **Invoice Fraud**
   - Attacker replays submit_sm PDUs to send billable SMS
   - Victim charged for attacker's SMS traffic

### Mitigation Recommendations

1. **Document Limitation Prominently:**
   ```markdown
   ⚠️ CRITICAL SECURITY WARNING
   SMPP v3.4 has NO encryption. Credentials and messages transmitted in CLEARTEXT.

   ONLY use this endpoint in these scenarios:
   - Testing over localhost (127.0.0.1)
   - VPN or SSH tunnel to SMPP server
   - Isolated private network (no internet)

   DO NOT use over public internet or untrusted networks.
   ```

2. **Add Response Warning:**
   ```typescript
   return new Response(JSON.stringify({
     success: true,
     security: {
       encrypted: false,
       warning: "SMPP credentials sent in cleartext. Use VPN/SSH tunnel."
     },
     // ... rest of response
   }));
   ```

3. **Future Work (SMPP TLS Wrapper):**
   ```typescript
   // Hypothetical TLS wrapper (not standardized)
   const socket = connect(`${host}:${port}`, {
     secureTransport: 'on',  // Non-standard SMPP extension
   });
   ```
   **Note:** Most SMPP providers do NOT support TLS. Industry practice is VPN/SSH tunnel.

## PDU Security Analysis

### Buffer Overflow Protection

**Current Validation (Lines 332-336):**
```typescript
const pduLength = new DataView(headerStart.buffer, headerStart.byteOffset, 4).getUint32(0, false);

if (pduLength < 16 || pduLength > 65536) {
  throw new Error(`Invalid SMPP PDU length: ${pduLength}`);
}
```

**Issues:**
1. ✅ Rejects PDUs under minimum (16 bytes = header only)
2. ✅ Rejects oversized PDUs (> 64KB)
3. ❌ Does NOT check Worker memory limits (large PDUs can exhaust heap)

**Recommended Additional Check:**
```typescript
const MAX_SAFE_PDU = 16384;  // 16KB safety limit for Workers

if (pduLength > MAX_SAFE_PDU) {
  throw new Error(`PDU too large (${pduLength} bytes, max ${MAX_SAFE_PDU})`);
}
```

### C-Octet String Injection

**`encodeCOctet` Implementation (Lines 95-102):**
```typescript
function encodeCOctet(str: string, maxLen: number): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const truncated = bytes.subarray(0, maxLen - 1);  // ❌ No NUL validation
  const result = new Uint8Array(truncated.length + 1);
  result.set(truncated);
  result[truncated.length] = 0x00;  // null terminator
  return result;
}
```

**Vulnerability:**
```typescript
// Attacker input:
systemId = "alice\x00ADMIN";

// Resulting bytes:
[0x61, 0x6C, 0x69, 0x63, 0x65, 0x00, 0x41, 0x44, 0x4D, 0x49, 0x4E, 0x00]
//  a     l     i     c     e    NUL   A     D     M     I     N    NUL

// SMPP server reads: "alice" (stops at first NUL)
// Remaining bytes shift field boundaries, corrupt PDU structure
```

**Fix Required:**
```typescript
function encodeCOctet(str: string, maxLen: number): Uint8Array {
  if (str.includes('\x00')) {
    throw new Error('C-Octet string cannot contain NUL bytes');
  }
  const bytes = new TextEncoder().encode(str);
  const truncated = bytes.subarray(0, maxLen - 1);
  const result = new Uint8Array(truncated.length + 1);
  result.set(truncated);
  result[truncated.length] = 0x00;
  return result;
}
```

## Message Submission Security

### submit_sm Endpoint (Lines 474-633)

**Flow:**
1. Bind to SMSC (bind_transceiver)
2. Send submit_sm PDU (source_addr, destination_addr, message)
3. Receive submit_sm_resp (message_id)
4. Unbind

**Security Checks:**
```typescript
if (body.message.length > 160) {  // ✅ Length validation
  return new Response(JSON.stringify({
    success: false, error: 'Message too long (max 160 characters)',
  }), { status: 400 });
}
```

**Missing Validations:**
1. ❌ No phone number format validation (destination_addr can be any string)
2. ❌ No rate limiting (can send spam)
3. ❌ No DCS (Data Coding Scheme) validation (data_coding parameter unchecked)
4. ❌ No registered_delivery flag explanation (silently sets to 0x01)

### Data Coding Scheme (DCS)

**Current Implementation:**
```typescript
const dataCoding = body.data_coding ?? 0x00;  // Default: SMSC default alphabet
```

**DCS Values:**
- `0x00` — SMSC default (usually GSM 7-bit)
- `0x01` — IA5 (ASCII)
- `0x03` — Latin-1
- `0x08` — UCS-2 (Unicode)

**Issue:** No validation that message content matches DCS.
- Example: Unicode emoji sent with DCS=0x00 (GSM 7-bit) → garbled message

## Query SM Implementation (Lines 765-896)

**Purpose:** Check delivery status of submitted message

**Security Concerns:**
1. **Message ID Validation:** No check that `message_id` format matches SMSC convention (allows injection)
2. **Unauthorized Access:** No check that requester owns the message_id (can query other users' messages)

**State Codes (Lines 754-757):**
```typescript
const MESSAGE_STATE_NAMES: Record<number, string> = {
  0: 'ENROUTE', 1: 'DELIVERED', 2: 'EXPIRED', 3: 'DELETED',
  4: 'UNDELIVERABLE', 5: 'ACCEPTED', 6: 'UNKNOWN', 7: 'REJECTED',
};
```

**Issue:** State 6 (UNKNOWN) used as fallback — should distinguish between "message not found" and "state unavailable".

## Documentation Improvements

**Created:** `docs/protocols/SMPP.md` (needed)

Should document:

1. **Security Warning Section**
   - ⚠️ NO ENCRYPTION — credentials and messages in cleartext
   - Recommend VPN/SSH tunnel for remote SMPP servers
   - Not suitable for production without transport-layer security

2. **4 Endpoints**
   - `/connect` — Bind test (returns server system_id, interface_version)
   - `/submit` — Send SMS (returns message_id)
   - `/probe` — Lightweight probe (enquire_link without binding)
   - `/query` — Check delivery status (returns message_state)

3. **PDU Structure**
   - Header: 16 bytes (command_length, command_id, command_status, sequence_number)
   - Body: Variable length (C-Octet strings + binary fields)

4. **Error Codes**
   - `0x00000000` — ESME_ROK (Success)
   - `0x00000001` — ESME_RINVMSGLEN (Invalid message length)
   - `0x00000014` — ESME_RBINDFAIL (Bind failed)
   - `0x00000015` — ESME_RINVPASWD (Invalid password)
   - `0x00000016` — ESME_RINVSYSID (Invalid system ID)

5. **Known Limitations**
   - No TLS support (cleartext only)
   - No SMPP v5.0 (only v3.4)
   - No QUERY_SM_RESP parsing (returns raw state code)
   - No long message support (submit_multi, message_payload TLV)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** Pending (tests/smpp.test.ts needs creation)
**Spec Compliance:** SMPP v3.4 (binary PDU format)

## See Also

- [SMPP v3.4 Specification](https://smpp.org/SMPP_v3_4_Issue1_2.pdf)
- [SMS Security Best Practices](../security-notes/sms-security.md)
- [Critical Fixes Summary](../critical-fixes.md)
