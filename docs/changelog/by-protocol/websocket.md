# WebSocket Review

**Protocol:** WebSocket (RFC 6455)
**File:** `src/worker/websocket.ts`
**Reviewed:** 2026-02-19
**Specification:** [RFC 6455 - The WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455)
**Tests:** `tests/websocket.test.ts`

## Summary

WebSocket implementation provides handshake probe endpoint that validates RFC 6455 Upgrade mechanism. Generates cryptographically random Sec-WebSocket-Key, verifies SHA-1 based Sec-WebSocket-Accept hash. Optionally sends ping frame and validates pong response. **NOTE:** Runs over unencrypted TCP (port 80) — no TLS option for wss:// (secure WebSocket) testing.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Critical | **NO TLS SUPPORT**: WebSocket endpoint hardcoded to port 80 (line 244) — cannot test wss:// (secure WebSocket), all traffic cleartext |
| 2 | High | **INCOMPLETE HANDSHAKE**: Sec-WebSocket-Accept validation (line 304) checks hash equality but does not validate it was computed with correct GUID (attacker can send pre-computed hash) |
| 3 | Medium | **WEAK RANDOMNESS**: `generateWebSocketKey` uses `crypto.getRandomValues()` (✅ good) but manual base64 encoding (lines 22-41) may introduce bias |
| 4 | Medium | **FRAME PARSING**: `parseFrameHeader` (lines 145-178) handles basic frames but does not validate reserved bits (RSV1/RSV2/RSV3 must be 0 unless extension negotiated) |
| 5 | Low | **PONG TIMEOUT**: Ping sent (line 332) with 5s timeout for pong — should be configurable, 5s may be too long for high-latency networks |
| 6 | Low | **NO CLOSE FRAME**: After handshake/ping, connection abandoned — should send Close frame per RFC 6455 §5.5.1 |

## Security Analysis (No TLS)

### Unencrypted WebSocket (ws://)

**Current Implementation:**
```typescript
const socket = connect(`${body.host}:${port}`);  // ❌ No TLS option
```

**WebSocket Upgrade Request (Lines 257-267):**
```http
GET /chat HTTP/1.1
Host: example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Origin: http://example.com
```

**Cleartext Exposure:**
1. **Handshake Headers:** Origin, cookies, authentication tokens visible
2. **Frame Payload:** All WebSocket messages (text/binary) sent in cleartext
3. **Session Hijacking:** Attacker intercepts Sec-WebSocket-Key, computes valid Accept hash, hijacks connection

### Impact on Real-World WebSockets

**Common WebSocket Use Cases:**
- Chat applications (messages in plaintext)
- Live sports scores (data interception)
- Trading platforms (order data exposure)
- Gaming (player actions visible)
- IoT dashboards (sensor data leakage)

**All production WebSockets use wss:// (TLS) but Worker cannot test encrypted WebSocket.**

### Recommended Fix

**Add TLS Support:**
```typescript
export async function handleWebSocketProbe(request: Request): Promise<Response> {
  const body = await request.json<{
    host?: string;
    port?: number;
    tls?: boolean;  // ← Add TLS flag
    // ...
  }>();

  const tls = body.tls ?? false;
  const port = body.port || (tls ? 443 : 80);

  const socketOptions = tls ? { secureTransport: 'on' as const } : undefined;
  const socket = connect(`${body.host}:${port}`, socketOptions);
  // ...
}
```

**Update Response Schema:**
```typescript
{
  success: true,
  protocol: tls ? 'wss://' : 'ws://',
  tls,
  tlsVerified: tls ? false : undefined,  // Document cert not validated
  // ...
}
```

## WebSocket Handshake Validation

### Sec-WebSocket-Key Generation (Lines 18-42)

```typescript
function generateWebSocketKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);  // ✅ Cryptographically secure

  // Manual base64 encoding
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += chars[(b0 >> 2) & 0x3f];
    result += chars[((b0 << 4) | (b1 >> 4)) & 0x3f];
    if (i + 1 < bytes.length) {
      result += chars[((b1 << 2) | (b2 >> 6)) & 0x3f];
    } else {
      result += '=';
    }
    if (i + 2 < bytes.length) {
      result += chars[b2 & 0x3f];
    } else {
      result += '=';
    }
  }
  return result;
}
```

**RFC 6455 §1.3 Requirement:**
> The value of the Sec-WebSocket-Key header field MUST be a nonce consisting
> of a randomly selected 16-byte value that has been base64-encoded.

**Compliance:**
- ✅ 16 bytes of random data (`crypto.getRandomValues`)
- ✅ Base64-encoded
- ⚠️ Manual base64 encoding (could use `btoa(String.fromCharCode(...bytes))` for simplicity)

**Potential Issue:**
Manual base64 may have bugs (wrong padding, off-by-one errors).

**Simpler Implementation:**
```typescript
function generateWebSocketKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Convert to binary string for btoa
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
```

### Sec-WebSocket-Accept Validation (Lines 48-76, 301-304)

```typescript
async function computeAcceptKey(wsKey: string): Promise<string> {
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';  // ✅ RFC 6455 magic string
  const combined = wsKey + GUID;
  const encoded = new TextEncoder().encode(combined);
  const hash = await crypto.subtle.digest('SHA-1', encoded);  // ✅ SHA-1 hash
  const hashBytes = new Uint8Array(hash);

  // Base64 encode hash (manual implementation)
  // ...
}

// Validation (lines 301-304)
const expectedAccept = await computeAcceptKey(wsKey);
const actualAccept = httpResponse.headers['sec-websocket-accept'] || '';
const acceptValid = actualAccept === expectedAccept;  // ❌ Simple equality check
```

**RFC 6455 §1.3 Requirement:**
> To prove that the handshake was received, the server has to take two pieces
> of information and combine them to form a response. The first piece is the
> Sec-WebSocket-Key header field value. The second piece is a fixed string:
> "258EAFA5-E914-47DA-95CA-C5AB0DC85B11" (a UUID unlikely to be used by
> network endpoints that do not understand the WebSocket Protocol).

**Security Issue:**
Current code only checks equality. Malicious server could:
1. Ignore Sec-WebSocket-Key from client
2. Send hardcoded Accept: `s3pPLMBiTxaQ9kYGzzhZRbK+xOo=` (valid for some key)
3. Worker accepts handshake even though server didn't compute hash correctly

**Proper Validation:**
```typescript
// After computing expected hash, also log for debugging
const acceptValid = actualAccept === expectedAccept;

// Additionally verify server used correct GUID
const recomputedFromServer = await computeAcceptKey(wsKey);  // Same as expectedAccept
if (acceptValid && actualAccept === recomputedFromServer) {
  // Valid handshake
} else if (actualAccept && !acceptValid) {
  // Server sent Accept but it's wrong — protocol violation
  console.warn('Server Sec-WebSocket-Accept does not match expected hash');
}
```

## WebSocket Frame Parsing

### Frame Header Parsing (Lines 145-178)

```typescript
function parseFrameHeader(data: Uint8Array): {
  fin: boolean;
  opcode: number;
  masked: boolean;
  payloadLength: number;
  headerLength: number;
} | null {
  if (data.length < 2) return null;

  const fin = (data[0] & 0x80) !== 0;  // ✅ FIN bit
  const opcode = data[0] & 0x0f;       // ✅ Opcode

  // ❌ Missing RSV bit validation
  const rsv1 = (data[0] & 0x40) !== 0;
  const rsv2 = (data[0] & 0x20) !== 0;
  const rsv3 = (data[0] & 0x10) !== 0;
  // Should check: if (rsv1 || rsv2 || rsv3) throw new Error('Reserved bits must be 0');

  const masked = (data[1] & 0x80) !== 0;
  let payloadLength = data[1] & 0x7f;
  let headerLength = 2;

  if (payloadLength === 126) {
    if (data.length < 4) return null;
    payloadLength = (data[2] << 8) | data[3];
    headerLength = 4;
  } else if (payloadLength === 127) {
    if (data.length < 10) return null;
    // Only handle up to 32-bit lengths
    payloadLength = (data[6] << 24) | (data[7] << 16) | (data[8] << 8) | data[9];
    headerLength = 10;
  }

  if (masked) {
    headerLength += 4;  // masking key
  }

  return { fin, opcode, masked, payloadLength, headerLength };
}
```

**RFC 6455 §5.2 Requirements:**

1. **RSV Bits:** Must be 0 unless extension negotiated
   ```typescript
   if ((rsv1 || rsv2 || rsv3) && !extensionsNegotiated) {
     throw new Error('Protocol error: RSV bits set without extension');
   }
   ```

2. **Server-to-Client Masking:** Server MUST NOT mask frames
   ```typescript
   if (masked && isServerFrame) {
     throw new Error('Protocol error: Server sent masked frame');
   }
   ```

3. **Control Frame Length:** Control frames (opcode >= 0x8) MUST have payload ≤ 125 bytes
   ```typescript
   if (opcode >= 0x8 && payloadLength > 125) {
     throw new Error('Protocol error: Control frame payload too large');
   }
   ```

4. **Control Frame Fragmentation:** Control frames MUST NOT be fragmented
   ```typescript
   if (opcode >= 0x8 && !fin) {
     throw new Error('Protocol error: Control frame fragmented');
   }
   ```

### Ping/Pong Implementation (Lines 328-356)

```typescript
if (upgradeOk && body.sendPing) {
  try {
    const pingPayload = 'portofcall-ping';
    const pingFrame = buildPingFrame(pingPayload);  // ✅ Masked ping (client-to-server)
    await writer.write(pingFrame);

    const pongData = await readWithTimeout(reader, 5000);  // ❌ Fixed 5s timeout

    if (pongData) {
      const frameHeader = parseFrameHeader(pongData);
      if (frameHeader) {
        result.pingResponse = {
          received: true,
          opcode: frameHeader.opcode,
          opcodeName: OPCODE_NAMES[frameHeader.opcode] || `Unknown (0x${frameHeader.opcode.toString(16)})`,
          fin: frameHeader.fin,
          payloadLength: frameHeader.payloadLength,
          isPong: frameHeader.opcode === 0xa,  // ✅ Verify opcode 0x0A (pong)
        };
      }
    } else {
      result.pingResponse = { received: false, error: 'No pong response (timeout)' };
    }
  } catch {
    result.pingResponse = { received: false, error: 'Ping failed' };
  }
}
```

**RFC 6455 §5.5.2 Ping:**
> Upon receipt of a Ping frame, an endpoint MUST send a Pong frame in response,
> unless it already received a Close frame. It SHOULD respond with Pong frame
> as soon as is practical.

**RFC 6455 §5.5.3 Pong:**
> A Pong frame MUST have the same payload data as the Ping frame being replied to.

**Missing Validation:**
```typescript
// Should verify pong payload matches ping payload
const pongPayload = extractPayload(pongData, frameHeader);
if (pongPayload !== pingPayload) {
  result.pingResponse.warning = 'Pong payload does not match ping payload';
}
```

## Connection Cleanup

**Current Behavior (Lines 359-363):**
```typescript
return Response.json(result);
} finally {
  reader.releaseLock();
  writer.releaseLock();
}
} finally {
  await socket.close().catch(() => {});  // ✅ Socket closed
}
```

**RFC 6455 §5.5.1 Close Handshake:**
> An endpoint SHOULD use a method that cleanly closes the TCP connection, as well
> as the TLS session, if applicable, discarding any trailing bytes that may have
> been received.

**Issue:** Worker abruptly closes TCP socket without sending Close frame (opcode 0x8).

**Proper Cleanup:**
```typescript
try {
  // ... ping/pong
} finally {
  // Send Close frame before socket.close()
  try {
    const closeFrame = buildCloseFrame(1000, 'Normal closure');  // Status 1000
    await writer.write(closeFrame);
  } catch {
    // Ignore — best effort
  }
  await socket.close();
}
```

## Opcode Reference (Lines 180-187)

```typescript
const OPCODE_NAMES: Record<number, string> = {
  0x0: 'Continuation',
  0x1: 'Text',
  0x2: 'Binary',
  0x8: 'Close',
  0x9: 'Ping',
  0xa: 'Pong',
};
```

**RFC 6455 Opcodes:**
- `0x0` — Continuation frame (for fragmentation)
- `0x1` — Text frame (UTF-8 payload)
- `0x2` — Binary frame
- `0x3-0x7` — Reserved for future data frames
- `0x8` — Close frame
- `0x9` — Ping frame
- `0xA` — Pong frame
- `0xB-0xF` — Reserved for future control frames

**Missing Opcodes:**
- `0x3-0x7` (reserved data) — should reject
- `0xB-0xF` (reserved control) — should reject

## Documentation Improvements

**Created:** `docs/protocols/WEBSOCKET.md` (needed)

Should document:

1. **Security Warnings**
   - ⚠️ NO TLS SUPPORT — only ws:// (port 80), cannot test wss://
   - ⚠️ Handshake in cleartext (Sec-WebSocket-Key visible)
   - Add `tls` parameter for wss:// testing

2. **Endpoint Features**
   - `/probe` — WebSocket handshake validation
   - Sec-WebSocket-Accept hash verification (SHA-1 + GUID)
   - Optional ping/pong test (`sendPing: true`)

3. **Handshake Steps**
   1. Send HTTP Upgrade request
   2. Validate 101 Switching Protocols
   3. Verify Sec-WebSocket-Accept = base64(SHA-1(Key + GUID))
   4. Optionally send ping frame, check for pong

4. **Frame Types**
   - 0x1 — Text (UTF-8 string)
   - 0x2 — Binary (arbitrary bytes)
   - 0x8 — Close (connection termination)
   - 0x9 — Ping (heartbeat request)
   - 0xA — Pong (heartbeat response)

5. **Known Limitations**
   - No TLS support (ws:// only)
   - No extension support (compression, multiplexing)
   - No subprotocol negotiation
   - Ping/pong only (no full message exchange)
   - No fragmentation support
   - Close frame not sent (abrupt disconnect)

6. **Response Fields**
   - `websocketUpgrade` — True if 101 + correct headers
   - `acceptKeyValid` — True if hash matches
   - `negotiatedProtocol` — Subprotocol from Sec-WebSocket-Protocol header
   - `pingResponse` — Pong frame details (if `sendPing: true`)

## Verification

**Build Status:** ✅ Passes TypeScript compilation
**Tests:** Pending (tests/websocket.test.ts needs creation)
**RFC Compliance:**
- ✅ RFC 6455 (WebSocket) - Partial (handshake only)
- ❌ RFC 7692 (Compression) - Not implemented
- ❌ RFC 8441 (WebSocket over HTTP/2) - Not implemented

## See Also

- [RFC 6455 - WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455)
- [WebSocket Frame Format](https://datatracker.ietf.org/doc/html/rfc6455#section-5.2)
- [Critical Fixes Summary](../critical-fixes.md)
