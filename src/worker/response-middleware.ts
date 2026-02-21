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
  wrapped.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // API responses: no-store (connections carry credentials / are unique)
  if (request.url.includes('/api/')) {
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

  // Pass through SSH/protocol endpoint errors as-is
  if (pathname.startsWith('/api/ssh/') || pathname.startsWith('/api/connect') || pathname.startsWith('/api/tcp')) return response;

  // Sanitize portofcall internal errors (checklist, config, etc.)
  try {
    const body = await response.json() as Record<string, unknown>;
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
