/**
 * Router-level guards for blocking requests to Cloudflare-proxied targets.
 *
 * Before any protocol handler runs, the main router calls
 * `maybeBlockCloudflareTarget` to prevent loop-back attacks through the CDN.
 * All /api/ protocols are checked by default; only CLOUDFLARE_GUARD_EXCLUSIONS are skipped.
 */

import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

/**
 * Protocols that are EXCLUDED from the router-level Cloudflare guard
 * because they do their own Cloudflare check internally (or don't connect
 * to user-supplied hosts at all).
 *
 * All other /api/ protocols are checked by default.
 */
const CLOUDFLARE_GUARD_EXCLUSIONS = new Set([
  'checklist', // Internal KV endpoint, no external connection
]);

function getProtocolFromApiPath(pathname: string): string | null {
  if (!pathname.startsWith('/api/')) {
    return null;
  }

  const parts = pathname.split('/');
  if (parts.length < 3 || !parts[2]) {
    return null;
  }

  return parts[2];
}

function shouldRunRouterCloudflareGuard(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) {
    return false;
  }

  if (pathname === '/api/connect') {
    return true;
  }

  const protocol = getProtocolFromApiPath(pathname);
  if (!protocol) {
    return false;
  }

  // Check all protocols by default, except explicitly excluded ones
  return !CLOUDFLARE_GUARD_EXCLUSIONS.has(protocol);
}

export function normalizeHost(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const host = value.trim();
  return host.length > 0 ? host : null;
}

function isValidPort(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

export async function parseGuardBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.clone().json<Record<string, unknown>>();
    if (body && typeof body === 'object') {
      return body;
    }
  } catch {
    // No JSON body; skip.
  }

  return null;
}

function shouldDeferCloudflareGuard(protocol: string | null, body: Record<string, unknown> | null): boolean {
  if (!body) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'port') && !isValidPort(body.port)) {
    return true;
  }

  if (protocol === 'ident') {
    if (!isValidPort(body.serverPort) || !isValidPort(body.clientPort)) {
      return true;
    }
  }

  return false;
}

/**
 * Per-target global rate limit using KV.
 *
 * Caps aggregate requests to any single host across ALL users to prevent the
 * tool from being used as a DDoS amplifier. Unlike per-user rate limiting,
 * this counts every user's requests to the same target together.
 *
 * Uses a 1-minute sliding bucket. KV is not atomic, so there is a small race
 * window between read and write — this is acceptable for abuse prevention.
 */
const TARGET_RATE_LIMIT = 60; // requests per minute to any single host, across all users
const TARGET_RATE_BUCKET_MS = 60_000;
const TARGET_RATE_KEY_TTL = 120; // 2 minutes — covers current + previous bucket

export async function maybeBlockByTargetRateLimit(
  kv: KVNamespace,
  host: string,
): Promise<Response | null> {
  const normalized = host.toLowerCase().trim();
  const bucket = Math.floor(Date.now() / TARGET_RATE_BUCKET_MS);
  const key = `target_rate:${normalized}:${bucket}`;

  const current = await kv.get(key);
  const count = current !== null ? parseInt(current, 10) : 0;

  if (count >= TARGET_RATE_LIMIT) {
    return new Response(JSON.stringify({
      success: false,
      error: `Rate limit exceeded: too many requests to ${host} from all users. Try again in a minute.`,
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Best-effort increment. The race window is milliseconds; acceptable here.
  await kv.put(key, String(count + 1), { expirationTtl: TARGET_RATE_KEY_TTL });
  return null;
}

export async function maybeBlockCloudflareTarget(request: Request, url: URL): Promise<Response | null> {
  if (!shouldRunRouterCloudflareGuard(url.pathname)) {
    return null;
  }

  const protocol = getProtocolFromApiPath(url.pathname);
  const body = await parseGuardBody(request);

  if (shouldDeferCloudflareGuard(protocol, body)) {
    return null;
  }

  // Check all host field names that protocol handlers use — must match the SSRF guard in index.ts
  const host = normalizeHost(url.searchParams.get('host') ?? url.searchParams.get('hostname'))
    ?? normalizeHost(body?.host)
    ?? normalizeHost(body?.hostname)
    ?? normalizeHost(body?.server)
    ?? normalizeHost(body?.target)
    ?? normalizeHost(body?.address)
    ?? normalizeHost(body?.destHost)
    ?? normalizeHost(body?.targetHost)
    ?? normalizeHost(body?.proxyHost);

  if (!host) {
    return null;
  }

  const cfCheck = await checkIfCloudflare(host);
  if (!cfCheck.isCloudflare || !cfCheck.ip) {
    return null;
  }

  const status = protocol === 'etcd' ? 503 : 403;

  return new Response(JSON.stringify({
    success: false,
    error: getCloudflareErrorMessage(host, cfCheck.ip),
    isCloudflare: true,
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
