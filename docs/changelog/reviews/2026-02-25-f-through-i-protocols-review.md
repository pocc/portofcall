# F through I Protocols Review — 2026-02-25

## Batch Verification

All F–I protocols verified clean via grep-based SSRF guard audit:
`checkIfCloudflare|guardCloudflare|cfBlock` count ≥ `= connect(` count for every file.

Special cases confirmed:
- **H323**: Uses `connect({ hostname: host, port })` object syntax — grep for `connect(\`` would miss these, but `connect(` pattern confirmed guards present.
- **HAZELCAST**: Uses `cfBlock()` shared helper — all 8 TCP connect paths covered via callers.
- **RETHINKDB**: Uses `cfBlock()` shared helper — all 7 TCP connect paths covered via callers.
- **SANE**: Uses `guardCloudflare()` shared helper — line 920 `dataSocket = connect(`${host}:${dataPort}`)` is within the same handler that called `guardCloudflare(host)` at line 804; `dataPort` is server-returned, `host` already verified.

## Protocols Reviewed (all clean, 0 findings)

| Protocol | File | Notes |
|----------|------|-------|
| FASTCGI | fastcgi.ts | checkIfCloudflare present |
| FINGER | finger.ts | checkIfCloudflare present |
| FIX | fix.ts | checkIfCloudflare present |
| FLUENTD | fluentd.ts | checkIfCloudflare present |
| FTP | ftp.ts | checkIfCloudflare present |
| FTPS | ftps.ts | checkIfCloudflare present |
| GIT | git.ts | checkIfCloudflare present |
| GOPHER | gopher.ts | checkIfCloudflare present |
| GRPC | grpc.ts | checkIfCloudflare present |
| GRAPHITE | graphite.ts | checkIfCloudflare present |
| H323 | h323.ts | checkIfCloudflare present (object-style connect) |
| HAZELCAST | hazelcast.ts | cfBlock() helper covers all connects |
| HTTP | http.ts | checkIfCloudflare present |
| HTTPS | https.ts | checkIfCloudflare present |
| IMAP | imap.ts | checkIfCloudflare present |
| IMAPS | imaps.ts | checkIfCloudflare present |
| IRC | irc.ts | checkIfCloudflare present |
| IRCS | ircs.ts | checkIfCloudflare present |
| ISCSI | iscsi.ts | checkIfCloudflare present |

**0 findings across all F–I protocols.**
