# Submission Review

**Protocol:** Message Submission (SMTP Submission, RFC 6409)
**File:** `src/worker/submission.ts`
**Reviewed:** 2026-02-19

## Summary

Implementation covers the expected submission flow on port 587 with `STARTTLS` upgrade, capability parsing, optional authentication (`AUTH PLAIN` and `AUTH LOGIN`), envelope commands (`MAIL FROM`, `RCPT TO`), `DATA`, and `QUIT`. It is a pragmatic submission client rather than a full MTA implementation.

## Expected Feature Set vs Implementation

- `POST/GET /api/submission/connect` implemented for capability and STARTTLS probe.
- `POST /api/submission/send` implemented for message submission.
- STARTTLS upgrade uses `socket.startTls()` correctly after `220` response.
- Dot-stuffing is implemented for message body lines beginning with `.`.

## Bugs Found and Fixed

No critical or medium-severity bugs were fixed in this documentation pass.

## Notable Limitations

- Single-recipient `to` field in current endpoint contract.
- No multipart attachments.
- No OAuth2 auth mechanism.

## Documentation Improvements

Created canonical review/spec document for Submission and mapped all implemented routes.

## See Also

- [Protocol Stub](../../protocols/SUBMISSION.md)
- [Worker Implementation](../../../src/worker/submission.ts)
