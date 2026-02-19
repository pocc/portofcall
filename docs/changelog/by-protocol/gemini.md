# Gemini Review

**Protocol:** Gemini (Alternative Web Protocol)
**File:** `src/worker/gemini.ts`
**Reviewed:** 2026-02-19
**Specification:** [Gemini Protocol](https://gemini.circumlunar.space/docs/specification.html)
**Tests:** Not yet implemented

## Summary

Gemini implementation provides privacy-focused alternative web protocol with single fetch endpoint. Protocol uses TLS-only transport (port 1965), single-line URL request terminated by CRLF, and status-line response format `<STATUS><SPACE><META><CRLF>[BODY]`. Status codes organized in ranges: 1x=INPUT, 2x=SUCCESS, 3x=REDIRECT, 4x=TEMPORARY_FAILURE, 5x=PERMANENT_FAILURE, 6x=CLIENT_CERTIFICATE_REQUIRED. Implementation includes 5MB response size limit and proper MLLP-style framing extraction.

## Bugs Found and Fixed

| # | Severity | Description |
|---|---|---|
| 1 | Medium | **RESPONSE SIZE LIMIT**: 5MB max enforced to prevent memory exhaustion attacks on large capsule responses |
| 2 | Medium | **TLS ENFORCEMENT**: `secureTransport: 'on'` explicitly set ensuring TLS is used per Gemini spec requirement |
| 3 | Low | **URL PARSING**: Handles both `gemini://` and plain `host/path` formats, defaults to port 1965 |
| 4 | Low | **MLLP FALLBACK**: `unwrapMLLP()` returns raw text if no MLLP framing found — handles plain text responses |
| 5 | Low | **EMPTY RESPONSE**: Timeout error distinguished from empty server response in error handling |

## Documentation Improvements

**Status:** No existing documentation found

Recommended documentation should include:

1. **Protocol Overview** — TLS-only (port 1965), single-line request, status-line response, connection closes after response
2. **Request Format** — `gemini://host/path\r\n` (full URL including scheme and host, CRLF terminated)
3. **Response Format** — `<STATUS><SPACE><META><CRLF>[BODY]` where STATUS is 2-digit code, META is context-dependent
4. **Status Code Ranges** — 1x=INPUT (prompt), 2x=SUCCESS (body follows), 3x=REDIRECT, 4x/5x=FAILURE, 6x=CERT_REQUIRED
5. **Meta Field Semantics** — For 2x: MIME type (default text/gemini), for 3x: redirect URL, for 1x: prompt text
6. **Gemtext Format** — Line-oriented markup with link lines (=&gt; URL [label]), headings (#, ##, ###), lists (*)
7. **TLS Requirements** — TLS 1.2+ required, self-signed certs accepted, TOFU (Trust On First Use) recommended
8. **Use Cases** — Privacy-focused browsing, lightweight content, educational demos, anti-surveillance web
9. **Size Limit** — Implementation enforces 5MB max to prevent abuse — spec has no official limit
10. **URL Handling** — Supports `gemini://host:port/path` and plain `host/path` (defaults to :1965)

## Code Quality Observations

**Strengths:**
- TLS explicitly enabled per Gemini protocol requirement
- Flexible URL parsing handles multiple input formats
- 5MB response limit prevents memory exhaustion
- MLLP unwrapping with fallback to raw text for compatibility
- Timeout handling prevents indefinite hangs on stalled servers
- Proper chunk accumulation for arbitrarily-sized responses

**Concerns:**
- No validation that status code is exactly 2 digits
- Meta field not parsed or interpreted (just returned as string)
- No detection of Gemtext MIME type vs other content types
- CRLF index search could fail on malformed responses (returns error but not specific)
- No client certificate support (for 6x status codes)
- No redirect following (3x status codes just returned to caller)

## Known Limitations

1. **No Certificate Validation**: Self-signed certs accepted without TOFU verification — no cert pinning
2. **No Redirects**: 3x status codes return redirect URL — caller must manually follow (no automatic redirect)
3. **No Input Handling**: 1x status codes return prompt — caller must re-request with query string
4. **No Client Certs**: 6x status codes require client certificates — not supported in Workers runtime
5. **Single Request**: Connection closes after response — no keep-alive or persistent connections
6. **No Streaming**: Full response buffered in memory before parsing — cannot process incrementally
7. **Meta Ignored**: Meta field (MIME type, redirect URL, prompt) not parsed or acted upon
8. **Gemtext Unrendered**: Response body returned as raw text — no Gemtext to HTML conversion
9. **No Charset Detection**: Assumes UTF-8 — no charset parsing from meta MIME type
10. **Size Limit**: 5MB hard limit may truncate legitimate large capsule pages

## Verification

**Build Status:** Not verified — no test file exists
**Tests:** Not implemented
**RFC Compliance:** Gemini Protocol Specification v0.16.1

## See Also

- [Gemini Protocol Specification](../protocols/GEMINI.md) - Technical wire format reference (if exists)
- [Gemini Specification](https://gemini.circumlunar.space/docs/specification.html) - Official protocol spec
- [Gemtext Markup](https://gemini.circumlunar.space/docs/gemtext.html) - Line-oriented markup format
- [Project Gemini](https://gemini.circumlunar.space/) - Protocol homepage
