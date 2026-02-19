# Protocol Review Changelog

This directory contains the historical record of all protocol reviews, bugs found, and fixes applied during the February 2026 comprehensive protocol audit.

## Quick Navigation

- [Critical Fixes Summary](critical-fixes.md) - All high-severity bugs by protocol
- [Medium Fixes Summary](medium-fixes.md) - All medium-severity bugs by protocol
- [2026-02-18 Protocol Review Project](2026-02-18-protocol-review.md) - Overview of batch review process

## By Protocol

All 86 reviewed protocols have individual changelog entries in `by-protocol/`:

### Currently Documented
- [SSH](by-protocol/ssh.md) - 2 critical window flow control bugs
- [Shadowsocks](by-protocol/shadowsocks.md) - 4 bugs (2 medium, 2 low)
- [TURN](by-protocol/turn.md) - 4 bugs including crypto.random() vulnerability

### Complete Index

See [by-protocol/README.md](by-protocol/README.md) for the complete alphabetical index of all 86 protocols.

## Changelog Organization

Each protocol changelog file follows a consistent format:
- **Summary** - Brief overview of the protocol and review scope
- **Bugs Found and Fixed** - Table of all bugs with severity, location, and fixes
- **Detailed Bug Descriptions** - In-depth explanation of each bug with code examples
- **Documentation Improvements** - Summary of new protocol documentation created
- **Verification** - Build status and testing notes
- **See Also** - Links to protocol specifications and related docs

## Historical Context

This changelog documents work completed on **February 18, 2026** during a comprehensive review of 86 protocol implementations in the Port of Call project. The review identified and fixed hundreds of bugs across categories including:

- **Resource leaks** (timeout handles, socket cleanup, stream locks)
- **Security vulnerabilities** (SSRF, injection, path traversal, memory exhaustion)
- **Data corruption** (encoding issues, parsing errors, byte order problems)
- **Protocol violations** (RFC non-compliance, missing validation)

All fixes have been applied to the source code and verified with TypeScript compilation and testing.
