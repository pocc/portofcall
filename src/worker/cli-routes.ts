/**
 * Short URL routes for curl-friendly interface.
 * Maps /:protocol/:target to existing handler functions.
 */

import { handleTcpPing } from './websocket-pipe';
import { handleTcpSend } from './tcp';
import { handleHTTPRequest } from './http';
import { handleDNSQuery } from './dns';
import { handleSSHKeyExchange } from './ssh';
import { handleFTPConnect } from './ftp';
import { handleRedisConnect } from './redis';
import { handleMySQLConnect } from './mysql';
import { handlePostgreSQLConnect } from './postgres';
import { handleSMTPConnect } from './smtp';
import { handleWhoisLookup } from './whois';
import { handleNTPQuery } from './ntp';
import { handleWebSocketProbe } from './websocket';

export interface ShortRouteMatch {
  protocol: string;
  host: string;
  port: number;
  extra?: string;
  rawTarget: string;
}

interface ProtocolConfig {
  defaultPort: number | null; // null = port required in target
  dispatch: (match: ShortRouteMatch, params: URLSearchParams) => Promise<Response>;
  hasExtra?: boolean; // protocol accepts extra path segments
}

function syntheticPost(body: Record<string, unknown>): Request {
  return new Request('http://internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Parse timeout query param without treating 0 as falsy (Class 7C). */
function parseTimeout(params: URLSearchParams): number | undefined {
  const raw = params.get('timeout');
  if (raw === null) return undefined;
  const n = Number(raw);
  // Allow 10ms–30s; clamp rather than silently dropping out-of-range values
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.max(10, Math.min(n, 30_000));
}

const PROTOCOLS: Record<string, ProtocolConfig> = {
  synping: {
    defaultPort: null,
    dispatch: (m, params) =>
      handleTcpPing(syntheticPost({
        host: m.host,
        port: m.port,
        timeout: parseTimeout(params),
      })),
  },
  tcp: {
    defaultPort: null,
    dispatch: (m, params) =>
      handleTcpSend(syntheticPost({
        host: m.host,
        port: m.port,
        timeout: parseTimeout(params),
      })),
  },
  http: {
    defaultPort: 80,
    hasExtra: true,
    dispatch: (m, params) =>
      handleHTTPRequest(syntheticPost({
        host: m.host,
        port: m.port,
        tls: false,
        method: 'GET',
        path: m.extra ? `/${m.extra}` : '/',
        timeout: parseTimeout(params),
      })),
  },
  https: {
    defaultPort: 443,
    hasExtra: true,
    dispatch: (m, params) =>
      handleHTTPRequest(syntheticPost({
        host: m.host,
        port: m.port,
        tls: true,
        method: 'GET',
        path: m.extra ? `/${m.extra}` : '/',
        timeout: parseTimeout(params),
      })),
  },
  dns: {
    defaultPort: 53,
    hasExtra: true,
    dispatch: (m, params) =>
      handleDNSQuery(syntheticPost({
        domain: m.host,
        type: m.extra || 'A',
        timeout: parseTimeout(params),
      })),
  },
  ssh: {
    defaultPort: 22,
    dispatch: (m, params) =>
      handleSSHKeyExchange(syntheticPost({
        host: m.host,
        port: m.port,
        timeout: parseTimeout(params),
      })),
  },
  ftp: {
    defaultPort: 21,
    dispatch: (m, params) =>
      handleFTPConnect(syntheticPost({
        host: m.host,
        port: m.port,
        timeout: parseTimeout(params),
      })),
  },
  redis: {
    defaultPort: 6379,
    dispatch: (m, params) =>
      handleRedisConnect(syntheticPost({
        host: m.host,
        port: m.port,
        timeout: parseTimeout(params),
      })),
  },
  mysql: {
    defaultPort: 3306,
    dispatch: (m, params) =>
      handleMySQLConnect(syntheticPost({
        host: m.host,
        port: m.port,
        timeout: parseTimeout(params),
      })),
  },
  postgres: {
    defaultPort: 5432,
    dispatch: (m, params) =>
      handlePostgreSQLConnect(syntheticPost({
        host: m.host,
        port: m.port,
        timeout: parseTimeout(params),
      })),
  },
  smtp: {
    defaultPort: 25,
    dispatch: (m, params) =>
      handleSMTPConnect(syntheticPost({
        host: m.host,
        port: m.port,
        timeout: parseTimeout(params),
      })),
  },
  whois: {
    defaultPort: 43,
    dispatch: (m, params) =>
      handleWhoisLookup(syntheticPost({
        domain: m.host,
        timeout: parseTimeout(params),
      })),
  },
  ntp: {
    defaultPort: 123,
    dispatch: (m, params) =>
      handleNTPQuery(syntheticPost({
        host: m.host,
        port: m.port,
        timeout: parseTimeout(params),
      })),
  },
  tls: {
    defaultPort: 443,
    dispatch: (m, params) =>
      handleHTTPRequest(syntheticPost({
        host: m.host,
        port: m.port,
        tls: true,
        method: 'HEAD',
        path: '/',
        timeout: parseTimeout(params),
      })),
  },
  ws: {
    defaultPort: 80,
    hasExtra: true,
    dispatch: (m, params) =>
      handleWebSocketProbe(syntheticPost({
        host: m.host,
        port: m.port,
        path: m.extra ? `/${m.extra}` : '/',
        timeout: parseTimeout(params),
      })),
  },
};

/**
 * Parse a target string like "example.com:22" into host and port.
 */
export function parseTarget(target: string): { host: string; port?: number } {
  // Handle IPv6 addresses like [::1]:22
  if (target.startsWith('[')) {
    const closeBracket = target.indexOf(']');
    if (closeBracket === -1) return { host: target };
    const host = target.slice(1, closeBracket);
    const rest = target.slice(closeBracket + 1);
    if (rest.startsWith(':')) {
      const port = parseInt(rest.slice(1), 10);
      if (!isNaN(port) && port >= 1 && port <= 65535) return { host, port };
    }
    return { host };
  }

  // Count colons — if more than one, it's an IPv6 address without brackets
  const colons = target.split(':').length - 1;
  if (colons > 1) return { host: target };

  // Standard host:port
  const lastColon = target.lastIndexOf(':');
  if (lastColon === -1) return { host: target };

  const host = target.slice(0, lastColon);
  const port = parseInt(target.slice(lastColon + 1), 10);
  if (isNaN(port) || port < 1 || port > 65535) return { host };
  return { host, port };
}

/**
 * Match a URL pathname to a short route.
 * Returns null if no match.
 */
export function matchShortRoute(pathname: string): ShortRouteMatch | null {
  // Strip leading slash and split: /protocol/target/extra...
  const parts = pathname.slice(1).split('/');
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;

  const protocolName = parts[0].toLowerCase();
  const config = PROTOCOLS[protocolName];
  if (!config) return null;

  const targetStr = parts[1];
  const extra = config.hasExtra && parts.length > 2 ? parts.slice(2).join('/') : undefined;

  const parsed = parseTarget(targetStr);

  // Use default port if not specified in target
  let port: number;
  if (parsed.port !== undefined) {
    port = parsed.port;
  } else if (config.defaultPort !== null) {
    port = config.defaultPort;
  } else {
    // Port required but not provided
    return null;
  }

  return {
    protocol: protocolName,
    host: parsed.host,
    port,
    extra,
    rawTarget: extra ? `${targetStr}/${extra}` : targetStr,
  };
}

/**
 * Check if a pathname matches a known protocol but is missing a required port.
 * Used to return a helpful error instead of falling through to the SPA.
 */
export function isKnownProtocolMissingPort(pathname: string): { protocol: string; target: string } | null {
  const parts = pathname.slice(1).split('/');
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;

  const protocolName = parts[0].toLowerCase();
  const config = PROTOCOLS[protocolName];
  if (!config) return null;

  // Only relevant when defaultPort is null (port required)
  if (config.defaultPort !== null) return null;

  const parsed = parseTarget(parts[1]);
  if (parsed.port !== undefined) return null;

  return { protocol: protocolName, target: parts[1] };
}

/**
 * Dispatch a matched short route to the appropriate handler.
 */
export function dispatchShortRoute(match: ShortRouteMatch, searchParams: URLSearchParams): Promise<Response> {
  const config = PROTOCOLS[match.protocol];
  if (!config) {
    return Promise.resolve(new Response(JSON.stringify({
      success: false, error: `Unknown protocol: ${match.protocol}`,
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  }
  return config.dispatch(match, searchParams);
}
