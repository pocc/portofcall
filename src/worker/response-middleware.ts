/**
 * Response middleware — security headers and error sanitization.
 *
 * Applied after every request handler in the main fetch pipeline:
 *   executeRequest() → sanitizeErrors() → addSecurityHeaders()
 */

export function addSecurityHeaders(request: Request, response: Response): Response {
  // WebSocket 101 responses don't support custom headers in Workers
  if (response.status === 101) return response;
  const wrapped = new Response(response.body, response);
  wrapped.headers.set('X-Frame-Options', 'DENY');
  wrapped.headers.set('X-Content-Type-Options', 'nosniff');
  wrapped.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  wrapped.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  wrapped.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // API responses: no-store (connections carry credentials / are unique)
  if (new URL(request.url).pathname.startsWith('/api/')) {
    wrapped.headers.set('Cache-Control', 'no-store');
  }
  return wrapped;
}

export async function sanitizeErrors(request: Request, response: Response): Promise<Response> {
  // Only sanitize 500 errors on portofcall's own API routes.
  // SSH and protocol errors are passed through — users own their target servers
  // and need to see the real error messages for debugging.
  const pathname = new URL(request.url).pathname;
  if (response.status !== 500 || !pathname.startsWith('/api/')) return response;

  // Pass through protocol endpoint errors as-is — users own their target
  // servers and need to see real error messages for debugging.
  // Only sanitize internal/infrastructure routes (checklist, config, etc.).
  const INTERNAL_PREFIXES = ['/api/checklist'];
  const isInternal = INTERNAL_PREFIXES.some(p => pathname.startsWith(p));
  if (!isInternal) return response;

  // Sanitize portofcall internal errors (checklist, config, etc.)
  // Clone first so the original response body is available on parse failure
  try {
    const body = await response.clone().json() as Record<string, unknown>;
    if (body && body.error) {
      console.error(`[${pathname}]`, body.error);
      body.error = 'Internal server error';
    }
    return new Response(JSON.stringify(body), {
      status: 500,
      headers: response.headers,
    });
  } catch {
    return response;
  }
}
