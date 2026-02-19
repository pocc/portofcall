# Kubernetes Review

**Protocol:** Kubernetes
**File:** `src/worker/kubernetes.ts`
**Reviewed:** 2026-02-18

## Summary

The function contained `if (lower.endsWith('s')) return lower;` before the main pluralization logic. Kubernetes Kinds are always in singular form; there is no standard built-in Kind whose singular form ends in `s` (the `Endpoints` case, which is unusual because the Kind is plural itself, was already handled in `KIND_PLURALS`). The `endsWith('s')` guard would return the Kind unchanged for any singular Kind ending in `s`, producing the wrong REST resource name. For example, a custom Kind `Status` would produce `status` instead of `statuses`. Fixed by removing the guard entirely and adding a comment explaining why it is wrong. The `KIND_PLURALS` table correctly handles all real exceptions. The apply endpoint unconditionally constructed the PATCH path as:

## Bugs Found and Fixed

No critical or medium severity bugs found during review. Minor improvements and documentation updates applied.

## Documentation Improvements

Full protocol documentation created with endpoint references, wire format specifications, and usage examples.

## See Also

- [Protocol Specification](../../protocols/KUBERNETES.md)
- [Critical Fixes Summary](../critical-fixes.md)
- [Medium Fixes Summary](../medium-fixes.md)
