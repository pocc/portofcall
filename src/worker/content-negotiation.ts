/**
 * Content negotiation for curl-friendly interface.
 * Detects whether the request comes from curl, a browser, or wants JSON.
 */

export type ClientType = 'curl' | 'browser' | 'json';

export function detectClient(request: Request): ClientType {
  const url = new URL(request.url);

  // Explicit format override
  if (url.searchParams.get('format') === 'json') return 'json';

  const accept = request.headers.get('Accept') || '*/*';

  // Explicit JSON request
  if (accept.includes('application/json')) return 'json';

  // Browser: accepts text/html
  if (accept.includes('text/html')) return 'browser';

  // Everything else (curl default sends */*) → plain text
  return 'curl';
}
