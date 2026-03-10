# bitcoin.ts — Buffer Under-Allocation in buildVersionPayload

**Date:** 2026-02-23
**Severity:** HIGH
**Status:** FIXED

## Description

`buildVersionPayload()` allocates `new ArrayBuffer(86 + 14)` = 100 bytes, but the user agent string `/PortOfCall:1.0/` is 16 bytes, not 14. The actual payload requires 102 bytes.

This causes `DataView.setInt32(97, 0, true)` to throw a `RangeError` (writes bytes 97-100 on a 100-byte buffer), making all three Bitcoin handlers (`handleBitcoinConnect`, `handleBitcoinGetAddr`, `handleBitcoinMempool`) completely non-functional.

## Fix Applied

Changed `new ArrayBuffer(86 + 14)` to `new ArrayBuffer(86 + 16)`.
