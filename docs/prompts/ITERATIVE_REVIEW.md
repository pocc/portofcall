Read docs/prompts/REVIEW_GUIDELINES.md first. Follow those rules strictly throughout this review.

Please iterate through each and every protocol in /Users/rj/gd/code/portofcall alphabetically.
Read docs/ in portofcall. Do not use subagents for this task.

Until you have a pass that returns 0 real findings (per REVIEW_GUIDELINES.md), please follow this loop for the protocol. If you have found 0 ways to improve, document it in docs/changelog/reviews and move on to the next item in the list.

Please review and fix the identified protocol for:
- Data corruption or silent wrong results in normal use
- Real security issues where one user can affect another or escape intended scope
- Feature completeness gaps that a power user would notice
- Genuine logic errors (wrong regex, off-by-one, inverted conditions)

Do NOT file findings for:
- Theoretical attacks requiring a malicious server or self-attacking user
- Resource cleanup in Cloudflare Workers (platform handles it)
- Protocol spec limitations (e.g., "Modbus has no auth")
- Consistency-only fixes (missing success:false, different error formats)
- Bulk mechanical patterns — file once with a lint rule recommendation, not per-file

If you find any real issue, document it in docs/changelog/reviews (already exists), fix it, and restart this loop. One pass with 0 findings means you're done. At this point, run additional passes to verify previous fixes and then exit 1 to exit the Ralph Wiggum loop.
