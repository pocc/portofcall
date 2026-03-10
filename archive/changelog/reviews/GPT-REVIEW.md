# GPT Protocol Review Plan

Last updated: 2026-02-19

## Goal
Run an expert-level review of every protocol module in `src/worker/*.ts` against protocol documentation in `docs/`, with focus on:
1. Bugs and behavioral regressions
2. Implementation quality and maintainability
3. Security hardening and abuse resistance
4. Feature completeness versus documented expectations

## Scope
- Code: all protocol modules in `src/worker/*.ts`
- Routing: `src/worker/index.ts`
- Documentation: `docs/protocols/*.md`, plus supporting docs under `docs/reference/`, `docs/guides/`, `docs/changelog/`
- Tracking artifacts: `README.md` (`GPT-TODO` section) and `docs/gpt/*`

## Review Workflow (Per Protocol)
1. Inventory and mapping
- Map protocol file -> route paths in `src/worker/index.ts`.
- Map protocol file -> protocol doc file(s) in `docs/protocols/`.

2. Expected feature set from docs
- Extract documented endpoints and key feature claims.
- Mark unsupported, partially supported, and implemented features.

3. Code quality and bug review
- Validate request parsing and input constraints (host/port/auth payloads).
- Validate protocol framing/parsing correctness and error handling.
- Check timeout behavior, cancellation, and deterministic cleanup.
- Check stream/socket lifecycle (reader/writer lock release, close semantics, `finally` coverage).

4. Security review
- Verify SSRF/target validation and Cloudflare-protection checks.
- Verify credential handling and no accidental sensitive-data leakage in responses/errors.
- Verify unsafe parsing patterns, injection surfaces, and auth edge cases.

5. Documentation parity
- Confirm docs and routes match actual implementation names.
- Record drift (docs overstate/understate capabilities).

6. Testability and confidence
- Identify missing tests for high-risk paths (auth, parsing, timeouts, cleanup).
- Prioritize findings by severity: Critical / High / Medium / Low.

## Severity Rubric
- Critical: exploitable security issue, silent data corruption, auth bypass, or systemic resource leak.
- High: protocol breakage in common scenarios, severe feature mismatch, unsafe default behavior.
- Medium: edge-case reliability issues, weaker validation, inconsistent docs/routes.
- Low: polish, naming/docs quality, non-impactful refactor opportunities.

## Deliverables
- `README.md` -> `GPT-TODO` section with protocol set being reviewed.
- `docs/gpt/PROTOCOL-REVIEW-TRACKER.md` -> per-protocol status matrix.
- `docs/gpt/FINDINGS-2026-02-19.md` -> consolidated findings and priority queue.
- `docs/gpt/README.md` -> index for GPT review artifacts.

## Operating Rules
- Keep `GPT-TODO` synchronized as protocols move from in-progress to reviewed.
- Preserve source-of-truth links to protocol docs and route handlers.
- Prefer concrete file/route references over broad statements.
- Flag low-confidence findings explicitly as needing manual confirmation.
