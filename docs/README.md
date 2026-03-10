# Documentation Index

## AI Agent Fast Path

1. `/CLAUDE.md` — Project rules, commands, structure, security constraints
2. `docs/ARCHITECTURE.md` — Data plane design, scaling limits, security architecture

## Guides

- [ADD_PROTOCOL.md](guides/ADD_PROTOCOL.md) — Step-by-step protocol implementation workflow
- [IMPLEMENTATION_GUIDE.md](guides/IMPLEMENTATION_GUIDE.md) — Patterns, best practices, common pitfalls
- [LOCAL_TESTING.md](guides/LOCAL_TESTING.md) — Local dev setup, Docker testing, troubleshooting FAQ
- [CROSS_PLATFORM.md](guides/CROSS_PLATFORM.md) — Platform compatibility notes
- [API_EXAMPLES_VALIDATION.md](guides/API_EXAMPLES_VALIDATION.md) — API testing and validation
- [API_TESTING.md](guides/API_TESTING.md) — API endpoint testing guide

## Reference

- [IMPLEMENTED.md](reference/IMPLEMENTED.md) — List of 234 implemented protocols with test status
- [TCP_PROTOCOLS.md](reference/TCP_PROTOCOLS.md) — Comprehensive list of implementable TCP protocols
- [IMPOSSIBLE.md](reference/IMPOSSIBLE.md) — Protocols that can't run on Workers (UDP, raw sockets, ALPN)
- [SOCKETS_API.md](reference/SOCKETS_API.md) — Cloudflare Workers Sockets API guide
- [CLOUDFLARE_DETECTION.md](reference/CLOUDFLARE_DETECTION.md) — Cloudflare IP detection and connection restrictions
- [SSH_AUTHENTICATION.md](reference/SSH_AUTHENTICATION.md) — Password and private key auth deep dive
- [RFC_COMPLIANCE_AUDIT.md](reference/RFC_COMPLIANCE_AUDIT.md) — Protocol standards compliance review
- [INTERNET_STANDARDS.md](reference/INTERNET_STANDARDS.md) — RFC Internet Standards feasibility analysis
- [POWER_USERS_HAPPY.md](reference/POWER_USERS_HAPPY.md) — Advanced features and usage patterns
- [WEBSERVER.md](reference/WEBSERVER.md) — Web server configuration reference

## Top-Level Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — System design, data plane, security, scaling limits
- [PROTOCOL_REGISTRY.md](PROTOCOL_REGISTRY.md) — Protocol coverage, known gaps, certification status
- [BUG_CLASSES.md](BUG_CLASSES.md) — Bug taxonomy from the February 2026 audit
- [PROTOCOL_COMMANDS.md](PROTOCOL_COMMANDS.md) — All API endpoints by protocol (234 protocols)
- [PROTOCOL_CURL_TESTS.md](PROTOCOL_CURL_TESTS.md) — curl test commands for every endpoint

## Protocol Specs

- [protocols/](protocols/) — Individual protocol specifications (269 files)
- [protocols/QUICK_REFERENCE.md](protocols/QUICK_REFERENCE.md) — One-page protocol implementation cheat sheet
- [protocols/non-tcp/](protocols/non-tcp/) — Non-TCP protocol specs (27 files)

## Changelog

- [critical-fixes.md](changelog/critical-fixes.md) — All high-severity bugs found/fixed (24 protocols)
- [medium-fixes.md](changelog/medium-fixes.md) — All medium-severity bugs found/fixed (31 protocols)
- Full audit history: see `archive/` at repo root

## Project Status

- **234 protocols** implemented across `src/worker/*.ts`
- **27-pass audit** completed February 2026 — 200+ critical bugs fixed
- **Data plane certified** — backpressure, chunking, serialization, resource safety
- Outstanding TODOs: see `/TODO.md`
