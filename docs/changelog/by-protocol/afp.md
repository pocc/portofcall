# AFP Review

**Protocol:** AFP
**File:** `src/worker/afp.ts`
**Reviewed:** 2026-02-18

## Summary

A 43-line overview document with a generic protocol description ("File and directory services, Resource forks, File locking, Access control, Unicode filenames, Spotlight search"), a 6-step connection flow summary, links to Apple developer docs and Netatalk, and notes about deprecation. No API endpoints documented. No actual code details. Replaced with an accurate power-user reference. Key additions: 1. **All 13 endpoints documented** — full request/response schemas, field defaults, and validation rules for both unauthenticated (`/connect`, `/server-info`, `/open-session`) and authenticated (`/login`, `/list-dir`, `/get-info`, `/create-dir`, `/create-file`, `/delete`, `/rename`, `/read-file`, `/write-file`, `/resource-fork`) endpoints.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | Fixed error code table to use computed property keys `[-5019]` instead of string keys `'-5019'` for `Record<number, string>` lookup |

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/AFP.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
