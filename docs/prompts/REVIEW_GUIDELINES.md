# Code Review Guidelines — Preventing Finding Inflation

Use these rules when reviewing protocol handlers in Port of Call. The goal is to find bugs that actually matter, not to generate a long list of theoretical concerns.

## What Port of Call Is

Port of Call is a **browser-based protocol testing and exploration tool** running on Cloudflare Workers. Users connect to servers **they specify** to inspect protocol behavior. It is NOT:
- Production infrastructure handling untrusted traffic at scale
- Industrial control software operating physical equipment
- A long-running server process that accumulates state across requests

## The Reachability Test

Before filing a finding, answer: **"Can I describe a realistic sequence of user actions that triggers this bug?"**

- If the answer requires a malicious server, a malicious user attacking themselves, or a scenario that contradicts how the tool is used — it's not a real finding.
- If the answer is "a user types normal input and gets wrong results" — that's a real finding.

## DO Report

1. **Data corruption in normal use** — dot-stuffing bugs, encoding errors, protocol desync from dropped bytes, wrong byte-vs-character length calculations
2. **Real injection where user A can harm user B** — open relays, unauthenticated endpoints that perform destructive actions (SMTP send without auth, Docker exec without restriction)
3. **Protocol violations that cause silent wrong results** — Cassandra readExact discarding bytes, SSH window exhaustion dropping input, missing response validation that tells the user "success" when the server said "failure"
4. **Genuine logic errors** — wrong regex, off-by-one, inverted conditions, dead code that was supposed to run
5. **Security issues on the control plane** — anything that lets one user affect another user, or lets a request escape the intended scope (real SSRF, real path traversal that changes which endpoint is hit)

## DO NOT Report

1. **"Missing input validation" on values the user controls** — The user chose to type that port/host/query. Validating their own input against themselves is not a security fix. Exception: validation that prevents confusing errors (e.g., NaN port → opaque socket error is worth a clean 400, but file it as UX, not security).

2. **Resource leaks in Cloudflare Workers** — Workers are per-request isolates with a 30-second CPU limit and 128MB memory ceiling. `setTimeout` handles, unreleased reader locks, and unclosed sockets are cleaned up when the isolate dies. Do not file these as "CRITICAL" or "HIGH". If cleanup is genuinely missing, file it as LOW with a note that the platform provides a backstop.

3. **"Malicious server" attacks** — The user chose which server to connect to. Findings like "a malicious server could send a 4GB length field" assume the user is attacking themselves. Do not file these unless the tool advertises safety guarantees it doesn't deliver.

4. **Protocol features that don't exist by spec** — "Modbus has NO AUTHENTICATION" is not a bug. That's the Modbus protocol. "SSH host key verification is skipped" is by design in a testing tool. Do not report protocol limitations as implementation defects.

5. **Theoretical SSRF variants** — Decimal IPs (2130706433), hex IPs (0x7f000001), IPv6 6to4 embeddings — these depend on platform resolver behavior that you haven't tested. Do not file theoretical bypasses without a proof-of-concept showing `connect()` actually resolves them.

6. **Consistency-only fixes** — Missing `success: false` on one error path when others have it, different timeout defaults across handlers, slightly different error message formats. These are not bugs.

7. **Bulk mechanical fixes** — If your finding is "apply X pattern to 173 files," stop. That's a linter rule, not a code review finding. File one finding with the pattern and a recommendation to add a lint rule or shared helper.

8. **Certifying code that already works** — Do not spend a review pass verifying that previously-fixed code is still fixed. If it compiled and the tests pass, it's fine.

## Severity Calibration

| Severity | Criteria | Example |
|----------|----------|---------|
| CRITICAL | Active data loss or security breach in normal use | SMTPS open relay, SQL injection on a public endpoint |
| HIGH | Bug that produces wrong results under common conditions | Dot-stuffing regex misses first line, readExact drops bytes |
| MEDIUM | Bug that produces wrong results under uncommon but realistic conditions | TCP fragmentation causes partial echo response on large payloads |
| LOW | Cosmetic, consistency, or defense-in-depth with platform backstop | Missing clearTimeout in a Worker, NaN port produces ugly error |
| NOT A FINDING | Theoretical, requires adversarial self-attack, or is the protocol spec | Malicious server OOM, Modbus lacks auth, SSH skips host key check |

## Review Process Rules

1. **One pass is enough.** If your first pass found 0 issues, you're done. Do not run 26 passes hoping to find something.
2. **Findings require reproduction.** Describe the exact input that triggers the bug and the exact wrong output. "Could potentially" is not a finding.
3. **Fixes must be proportional.** A 3-line bug does not need a 200-line remediation with a new abstraction layer.
4. **Stop when you're generating busywork.** If your findings are all LOW severity consistency fixes, the review is done.
5. **Never count bulk-applied mechanical changes as separate findings.** One pattern = one finding, regardless of how many files it touches.
