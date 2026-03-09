# beats.ts — Missing Cloudflare SSRF Check

**Date:** 2026-02-23
**Severity:** MEDIUM
**Status:** FIXED

## Description

All three Beats protocol handlers (`handleBeatsSend`, `handleBeatsTLS`, `handleBeatsConnect`) were missing the `checkIfCloudflare()` SSRF prevention check that all other protocol handlers include before making outbound TCP connections.

## Fix Applied

Added `import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector'` and the standard Cloudflare IP check block to all three handlers, returning 403 with an appropriate error message when the target host resolves to a Cloudflare IP.
