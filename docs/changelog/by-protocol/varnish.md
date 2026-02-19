# Varnish Review

**Protocol:** Varnish CLI (VCLI)
**File:** `src/worker/varnish.ts`
**Reviewed:** 2026-02-19

## Summary

Implementation supports VCLI handshake parsing, optional challenge-response authentication, safe read-only command execution, and selected authenticated write actions (`ban`, `param.set`). It provides practical admin-plane access with command-level safety controls.

## Expected Feature Set vs Implementation

Implemented endpoints:
- `POST /api/varnish/probe`
- `POST /api/varnish/command`
- `POST /api/varnish/ban`
- `POST /api/varnish/param`

Read command path is allowlisted; write commands validate newline/whitespace injection patterns.

## Bugs Found and Fixed

No critical or medium-severity bugs were fixed in this documentation pass.

## Notable Limitations

- No protocol-local Cloudflare detector guard in this module.
- Focus is control-plane admin commands, not cache object data path operations.

## Documentation Improvements

Created canonical review/spec document for VCLI auth flow, safe command model, and write-operation constraints.

## See Also

- [Protocol Stub](../../protocols/VARNISH.md)
- [Worker Implementation](../../../src/worker/varnish.ts)
