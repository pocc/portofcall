/**
 * Content negotiation for curl-friendly interface.
 * Detects whether the request comes from curl, a browser, or wants JSON.
 *
 * Detection strategy:
 *   1. Explicit ?format=json query param → JSON
 *   2. Accept: application/json header → JSON
 *   3. Accept: text/html header → browser
 *   4. User-Agent sniffing for known terminal clients → curl
 *   5. User-Agent sniffing for known browsers → browser
 *   6. Default (Accept: any with no UA match) → curl (terminal)
 */

export type ClientType = 'curl' | 'browser' | 'json';

/** Terminal/CLI user agents (case-insensitive substring match) */
const TERMINAL_UA_PATTERNS = [
  'curl/',
  'wget/',
  'httpie/',
  'python-requests/',
  'python-urllib/',
  'powershell/',
  'libwww-perl/',
  'lwp-request/',
  'go-http-client/',
  'node-fetch/',
  'undici/',
  'axios/',
  'insomnia/',
  'postmanruntime/',
  'http_request',
  'okhttp/',
  'java/',
  'apache-httpclient/',
  'ruby/',
  'rust/',
  'aiohttp/',
  'got/',
  'superagent/',
];

export function detectClient(request: Request): ClientType {
  const url = new URL(request.url);

  // Explicit format override
  if (url.searchParams.get('format') === 'json') return 'json';

  const accept = request.headers.get('Accept') || '*/*';

  // Explicit JSON request
  if (accept.includes('application/json')) return 'json';

  // Accept: text/html is the strongest browser signal
  if (accept.includes('text/html')) return 'browser';

  const ua = (request.headers.get('User-Agent') || '').toLowerCase();

  // Known terminal clients
  for (const pattern of TERMINAL_UA_PATTERNS) {
    if (ua.includes(pattern)) return 'curl';
  }

  // Browser UA signatures
  if (ua.includes('mozilla/') || ua.includes('chrome/') || ua.includes('safari/') || ua.includes('edge/') || ua.includes('opera/')) {
    return 'browser';
  }

  // Default: treat as terminal (curl sends Accept: */* with no specific UA match)
  return 'curl';
}
