# SSH Protocol Review — 2026-02-23

## Scope

Files reviewed:
- `src/worker/ssh.ts` (1111 lines) — HTTP connectivity probes, KEXINIT/auth method discovery, raw TCP WebSocket tunnel
- `src/worker/ssh2-impl.ts` (1264 lines) — Full SSH-2 client (curve25519 kex, aes128-ctr, hmac-sha2-256, Ed25519 auth, PTY/shell, SFTP subsystem)
- `src/components/SSHClient.tsx` (395 lines) — React UI with xterm.js terminal

## Findings — Pass 1

### Security (3 issues, all fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 1 | MAC comparison timing attack — early-exit byte comparison allows theoretical timing oracle | LOW | ssh2-impl.ts:211 | Changed to constant-time XOR accumulation |
| 2 | TCP socket leak on credential validation failure — socket never closed when username/authMethod invalid | MEDIUM | ssh.ts:221-229 | Added `socket.close()` in both error paths |
| 3 | No banner size limit in version exchange — malicious server can send unlimited pre-banner data causing OOM | MEDIUM | ssh2-impl.ts:462, 960 | Added 8 KiB guard per RFC 4253 §4.2 |

### Protocol Compliance (4 issues, all fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 4 | Extended data (stderr) not counted against local window in terminal session — breaks RFC 4254 §5.2 window accounting, causes server to stall when window appears exhausted | HIGH | ssh2-impl.ts:842 | Added `localWindowRemaining` decrement + refill for extended data |
| 4b | Extended data (stderr) silently dropped in subsystem/exec `readChannelData` without window accounting — same bug as #4 in the subsystem path, also loses stderr output for exec channels | HIGH | ssh2-impl.ts:1176 | Added MSG_CHANNEL_EXTENDED_DATA handler that returns data + decrements window |
| 5 | `pipeWebSocketToSocket` has no write serialization — concurrent WS messages can interleave TCP writes | MEDIUM | ssh.ts:506-531 | Replaced with promise-chain (writeChain) FIFO serialization matching index.ts pattern |
| 6 | `pipeSocketToWebSocket` has no backpressure — slow WebSocket client causes unbounded buffering | MEDIUM | ssh.ts:546-566 | Added 1 MiB HWM bufferedAmount gating matching index.ts pattern |

### Usability (1 issue, fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 7 | PTY size hardcoded to 220×50 — no way for client to specify dimensions, no resize notification | MEDIUM | ssh2-impl.ts:696, SSHClient.tsx | Added cols/rows to credentials message, added `window-change` (RFC 4254 §6.7) on resize, wired xterm.js `onResize` to send resize events |

### Accessibility (3 issues, all fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 8 | Status dot has no text alternative for screen readers | LOW | SSHClient.tsx:211 | Added `aria-hidden="true"` (adjacent text label provides info) |
| 9 | File input for private key has no accessible label | LOW | SSHClient.tsx:311 | Added `aria-label="Upload private key file"` |
| 10 | Terminal div lacks role/label for screen readers | LOW | SSHClient.tsx:391 | Added `role="application" aria-label="SSH terminal"` |

## Known Limitations (not addressed — by design)

- **No host key verification**: SSH2 client skips server host key verification. Documented in SSH.md.
- **Ed25519 only**: Public key auth only supports Ed25519 keys. RSA/ECDSA not supported.
- **No re-keying**: Long-lived sessions (>1 GB transferred) may fail if server enforces re-keying.
- **Credentials in query params for `/api/ssh/connect` WebSocket mode**: Host/port in URL, credentials in first WS message. Documented.

## Previously Fixed (from 2026-02-18 review)

- BUG #1 (window exhaustion drops terminal input) — Fixed with drain loop + inputQueue
- BUG #2 (subsystem sendChannelData throws on window exhaustion) — Fixed with while-loop waiting for WINDOW_ADJUST

## Findings — Pass 2

### Security (1 issue, fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 12 | Terminal input JSON injection — any user-typed text starting with `{` and containing `"type"` was silently swallowed as a control message, never sent to SSH channel. E.g. `echo '{"type":"x"}'` would vanish. | MEDIUM | ssh2-impl.ts:808 | Tightened prefix check to `'{"type":"'`; moved `return` inside recognized-type branch so unrecognized JSON falls through to terminal input |

### Protocol Compliance (2 issues, both fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 13 | No CHANNEL_CLOSE response to server's CHANNEL_CLOSE — RFC 4254 §5.3 requires party to send CHANNEL_CLOSE back unless already sent | MEDIUM | ssh2-impl.ts:903 | Added `sendPayload(CHANNEL_CLOSE)` before setting channelOpen=false |
| 14 | MSG_CHANNEL_REQUEST (type 98) silently dropped in subsystem `readChannelData` — exit-status/exit-signal lost, want_reply goes unanswered | MEDIUM | ssh2-impl.ts:1180-1216 | Added `handleChannelRequest()` that captures exit-status (RFC 4254 §6.10) and responds to want_reply with CHANNEL_SUCCESS; also added handler in `sendChannelData` window-wait loop |

### Usability (2 issues, both fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 15 | No credential timeout on `/api/ssh/connect` WebSocket — TCP socket leaks if client never sends credentials message | MEDIUM | ssh.ts:199 | Added 30-second setTimeout that closes WS + TCP socket if credentials not received |
| 16 | `/api/ssh/exec` doesn't report command exit status code | LOW | ssh.ts:469, ssh2-impl.ts | Added `exitStatus` to SSHSubsystemIO interface + response JSON `exitCode` field |

## Findings — Pass 3

### Protocol Compliance (1 issue, fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 17 | MSG_CHANNEL_REQUEST also unhandled in terminal session `runSSHSession` — same class as #14 but in the interactive PTY code path; server's exit-status/exit-signal requests with want_reply=true go unanswered | LOW | ssh2-impl.ts:901 | Added `case MSG_CHANNEL_REQUEST` handler that reads want_reply and responds with CHANNEL_SUCCESS |

### Reviewed and confirmed correct

- Credential timeout (#15) correctly uses `clearTimeout` on happy path
- CHANNEL_CLOSE response (#13) is safely wrapped in try/catch (races with drain loop are handled)
- JSON control message fix (#12) correctly falls through for unrecognized JSON
- Exit status flow (#16) correctly captures status before CHANNEL_EOF arrives
- Subsystem `close()` properly sends CHANNEL_CLOSE + releases reader/writer locks
- Constant-time MAC comparison still intact
- 8 KiB banner guard still in place in both `runSSHSession` and `openSSHSubsystem`

### Noted but not addressed (acceptable)

- `runSSHSession` doesn't explicitly release tcpReader/tcpWriter on exit — acceptable because the Worker terminates when the WebSocket closes, freeing all resources.
- `handleSSHAuth` sends SERVICE_REQUEST without completing DH key exchange — intentional lightweight probe endpoint; failures handled gracefully.

## Findings — Pass 5 (fresh deep review)

### Protocol Compliance (2 issues, both fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 18 | Subsystem `readChannelData` doesn't send CHANNEL_CLOSE back when server sends CHANNEL_CLOSE — RFC 4254 §5.3 violation. Also conflates EOF with CLOSE (sets `chClosed=true` on EOF, preventing `close()` from sending CHANNEL_CLOSE) | MEDIUM | ssh2-impl.ts:1241 | Split EOF and CLOSE handling: EOF returns null without setting chClosed (caller's `close()` sends CHANNEL_CLOSE); CLOSE sends CHANNEL_CLOSE response before setting chClosed |
| 23 | Same CHANNEL_CLOSE non-response in subsystem `sendChannelData` window-wait loop — server's CHANNEL_CLOSE during window exhaustion goes unanswered | MEDIUM | ssh2-impl.ts:1196 | Added `sendPayload2(CHANNEL_CLOSE)` before setting chClosed in the window-wait CHANNEL_CLOSE handler |

### Security (1 issue, fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 19 | No credential timeout in `handleSSHTerminal` — client can connect via WebSocket and never send credentials, wasting resources indefinitely (unlike `handleSSHConnect` which has a 30s timeout) | MEDIUM | ssh2-impl.ts:1301 | Added 30-second credential timeout matching `handleSSHConnect` pattern |

### Usability (2 issues, both fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 20 | Cloudflare check happens after WebSocket accept in `handleSSHTerminal` — user sends credentials then finds out target is blocked. Host is known from URL params so check can happen before WS accept | LOW | ssh2-impl.ts:1300-1337 | Moved CF check before `new WebSocketPair()` so client gets clean HTTP 403 instead |
| 21 | SSHClient form fields not inside `<form>` element — Enter key doesn't trigger connection | LOW | SSHClient.tsx | Wrapped fields in `<form>` with `onSubmit`, set Connect to `type="submit"`, Disconnect to `type="button"` |

### Accessibility (1 issue, fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 22 | Status/error messages not announced to screen readers | LOW | SSHClient.tsx:349 | Wrapped statusMsg in `<div aria-live="polite" aria-atomic="true">` |

## Findings — Pass 7 (fresh deep review by Claude Opus 4.6)

### Protocol Compliance (3 issues, all fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 24 | `pipeSocketToWebSocket` in ssh.ts missing 1 MiB WebSocket payload chunking — websocket-pipe.ts canonical version splits >1 MiB reads into subarray slices; ssh.ts copy sent oversized payloads directly | MEDIUM | ssh.ts:576 | Added chunking loop matching websocket-pipe.ts pattern: split payloads >1 MiB via zero-copy `subarray()` |
| 25 | `openSSHSubsystem` doesn't read server's `maximum_packet_size` from CHANNEL_OPEN_CONFIRMATION — uses hardcoded `localMax` (32 KB) for send chunking instead of respecting server's advertised limit | MEDIUM | ssh2-impl.ts:1133 | Read `remoteMaxPkt` from offset 13; `sendChannelData` now uses `Math.min(localMax, remoteMaxPkt)` |
| 26 | Auth loops in both `runSSHSession` and `openSSHSubsystem` don't handle MSG_GLOBAL_REQUEST — server's `want_reply=true` global requests (e.g. `hostkeys-00@openssh.com`) during authentication go unanswered | LOW | ssh2-impl.ts:637,1113 | Added MSG_GLOBAL_REQUEST case in both auth loops that responds with MSG_REQUEST_FAILURE when want_reply is set |

### Usability (2 issues, both fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 27 | File input `accept=".pem,.key"` too restrictive — most OpenSSH keys (e.g. `id_ed25519`) have no file extension, so they're hidden in the file picker by default | LOW | SSHClient.tsx:312 | Removed `accept` attribute entirely so all files are shown by default |
| 28 | Duplicate resize messages sent on window resize — both `handleResize` (window listener) and `onResize` (xterm listener) send resize JSON when connected | LOW | SSHClient.tsx:71-77 | Removed resize send from `handleResize`; it now only calls `fit.fit()`, relying on xterm's `onResize` listener to notify the server |

## Findings — Pass 8

### Reviewed and confirmed correct

- Payload chunking in ssh.ts now matches websocket-pipe.ts canonical pattern
- `remoteMaxPkt` correctly read and used in `sendChannelData`
- MSG_GLOBAL_REQUEST handling in auth loops responds correctly with MSG_REQUEST_FAILURE
- File input shows all files by default
- Resize events now sent once per resize (via onResize only)
- Constant-time MAC comparison still intact
- 8 KiB banner guards still in place
- Credential timeouts in both handleSSHConnect and handleSSHTerminal
- CHANNEL_CLOSE responses in all code paths
- Window accounting for both DATA and EXTENDED_DATA
- Exit status capture in handleChannelRequest

**0 issues found — clean pass.**

## Findings — Pass 9 (fresh deep review by Claude Opus 4.6)

### Security (1 issue, fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 29 | Concurrent `sendPayload` in `runSSHSession` — the drain loop and SSH read loop both call `sendPayload()` concurrently. Since `buildEncPacket()` is async (crypto.subtle.sign/encrypt), two in-flight calls use the same `c2sSeqno` and `c2sCounter`, causing AES-CTR keystream reuse (catastrophic for encryption) and duplicate sequence numbers (server rejects with MAC failure, crashing the session) | HIGH | ssh2-impl.ts:440 | Serialized `sendPayload` via a promise chain (`sendChain`): each call chains off the previous, ensuring exclusive access to seqno/counter. Matches `writeChain` pattern used in `pipeWebSocketToSocket` |

### Protocol Compliance (1 issue, fixed)

| # | Issue | Severity | File | Fix |
|---|-------|----------|------|-----|
| 30 | Channel open wait loops in both `runSSHSession` and `openSSHSubsystem` silently ignore `MSG_GLOBAL_REQUEST` with `want_reply=true` — server's global requests (e.g. `hostkeys-00@openssh.com`) during channel setup go unanswered. Other setup loops (auth, PTY, shell) already handle this. | LOW | ssh2-impl.ts:705, 1173 | Added `MSG_GLOBAL_REQUEST` handler in both channel open loops, responding with `MSG_REQUEST_FAILURE` when `want_reply` is set |

## Findings — Pass 10

### Reviewed and confirmed correct

- sendPayload serialization chain correctly prevents concurrent access to c2sSeqno/c2sCounter
- MSG_GLOBAL_REQUEST now handled in all setup loops (auth, channel open, PTY, shell, subsystem)
- All previously fixed issues remain intact (constant-time MAC, banner guards, credential timeouts, CHANNEL_CLOSE responses, window accounting, exit status capture, payload chunking, remoteMaxPkt)

**0 issues found — clean pass.**

## Summary

**Pass 1**: 11 issues found and fixed (3 security, 4 protocol compliance, 1 usability, 3 accessibility).
**Pass 2**: 5 issues found and fixed (1 security, 2 protocol compliance, 2 usability).
**Pass 3**: 1 issue found and fixed (1 protocol compliance). 0 remaining issues.
**Pass 4**: 0 issues found — clean pass.
**Pass 5**: 6 issues found and fixed (1 security, 2 protocol compliance, 2 usability, 1 accessibility).
**Pass 6**: 0 issues found — clean pass.
**Pass 7**: 5 issues found and fixed (3 protocol compliance, 2 usability).
**Pass 8**: 0 issues found — clean pass.
**Pass 9**: 2 issues found and fixed (1 security, 1 protocol compliance).
**Pass 10**: 0 issues found — clean pass. Review complete.
**Total**: 30 issues found and fixed across 10 passes.
