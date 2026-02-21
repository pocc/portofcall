/**
 * Router-level guards for blocking requests to Cloudflare-proxied targets.
 *
 * Before any protocol handler runs, the main router calls
 * `maybeBlockCloudflareTarget` to prevent loop-back attacks through the CDN.
 * Only protocols in ROUTER_CLOUDFLARE_GUARD_PROTOCOLS are checked.
 */

import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

const ROUTER_CLOUDFLARE_GUARD_PROTOCOLS = new Set([
  'activeusers',
  'afp',
  'ami',
  'battlenet',
  'beats',
  'chargen',
  'daytime',
  'dicom',
  'discard',
  'dot',
  'echo',
  'elasticsearch',
  'epmd',
  'epp',
  'etcd',
  'finger',
  'gemini',
  'gopher',
  'h323',
  'hsrp',
  'ident',
  'ike',
  'influxdb',
  'informix',
  'ipp',
  'jabber-component',
  'jsonrpc',
  'l2tp',
  'matrix',
  'mdns',
  'mgcp',
  'mpd',
  'msn',
  'msrp',
  'napster',
  'ninep',
  'nntp',
  'nsca',
  'oscar',
  'portmapper',
  'qotd',
  'radsec',
  'rcon',
  'realaudio',
  'rip',
  'sccp',
  'sentinel',
  'shoutcast',
  'sip',
  'sips',
  'snpp',
  'soap',
  'socks4',
  'spamd',
  'stomp',
  'svn',
  'sybase',
  'syslog',
  'teamspeak',
  'tftp',
  'time',
  'turn',
  'varnish',
  'ventrilo',
  'x11',
  'xmpp-s2s',
  'xmpps2s',
  'ymsg',
  'zabbix',
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
  if (pathname === '/api/connect') {
    return true;
  }

  const protocol = getProtocolFromApiPath(pathname);
  return protocol !== null && ROUTER_CLOUDFLARE_GUARD_PROTOCOLS.has(protocol);
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

export async function maybeBlockCloudflareTarget(request: Request, url: URL): Promise<Response | null> {
  if (!shouldRunRouterCloudflareGuard(url.pathname)) {
    return null;
  }

  const protocol = getProtocolFromApiPath(url.pathname);
  const body = await parseGuardBody(request);

  if (shouldDeferCloudflareGuard(protocol, body)) {
    return null;
  }

  const host = normalizeHost(url.searchParams.get('host') ?? url.searchParams.get('hostname'))
    ?? normalizeHost(body?.host)
    ?? normalizeHost(body?.hostname)
    ?? normalizeHost(body?.server);

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
