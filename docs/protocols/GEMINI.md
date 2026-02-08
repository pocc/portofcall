# Gemini Protocol

## Overview

**Gemini** is a modern internet protocol, heavier than Gopher but lighter than the Web. It emphasizes privacy, simplicity, and user agency. Uses a simplified markup language (Gemtext) similar to Markdown.

**Port:** 1965
**Transport:** TCP over TLS
**Type:** Text-based

## Protocol Specification

### Request Format

```
gemini://example.com/path/to/resource\r\n
```

Single line URL, no headers, no request body.

### Response Format

```
<STATUS><SPACE><META><CR><LF>
[RESPONSE BODY]
```

**Status Codes:**
- `1x` - INPUT (prompt user)
- `2x` - SUCCESS
- `3x` - REDIRECT
- `4x` - TEMPORARY FAILURE
- `5x` - PERMANENT FAILURE
- `6x` - CLIENT CERTIFICATE REQUIRED

## Resources

- [Gemini Protocol Specification](https://gemini.circumlunar.space/docs/specification.html)
- [Awesome Gemini](https://github.com/kr1sp1n/awesome-gemini)

## Notes

- **TLS Mandatory**: All connections use TLS
- **No JavaScript**: Focus on content
- **Simple Markup**: Gemtext format
- **Privacy**: No tracking, no cookies
- **Lightweight**: Minimal protocol overhead
- **Alt-Web**: Alternative to HTTP/HTML
