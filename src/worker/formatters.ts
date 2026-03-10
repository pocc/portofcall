/**
 * Plain text formatters for curl-friendly interface.
 * Converts JSON responses from protocol handlers into readable plain text.
 */

const PAD = 14;

function header(protocol: string, target: string): string {
  return `\nPORTOFCALL ${protocol} ${target}\n\n`;
}

function kv(key: string, value: unknown): string {
  const k = String(key).padEnd(PAD);
  return `  ${k}${value}\n`;
}

function footer(host: string): string {
  return `\n  Probed at   ${new Date().toISOString()} via ${host}\n`;
}

function errorBlock(message: string): string {
  return `  ERROR  ${message}\n`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Formatter = (json: any, target: string, host: string) => string;

const formatSynping: Formatter = (json, target, host) => {
  let out = header('synping', target);
  if (!json.success) {
    out += errorBlock(json.error || json.message || 'Connection failed');
    out += kv('Host', json.host || target);
    return out + footer(host);
  }
  out += kv('Host', json.host);
  out += kv('Port', json.port);
  out += kv('Status', 'OPEN');
  out += kv('RTT', `${json.rtt}ms`);
  return out + footer(host);
};

const formatTcp: Formatter = (json, target, host) => {
  let out = header('tcp', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Connection failed');
    return out + footer(host);
  }
  out += kv('Host', json.host);
  out += kv('Port', json.port);
  out += kv('Connect', `${json.connectMs}ms`);
  out += kv('RTT', `${json.rtt}ms`);
  if (json.sent) out += kv('Sent', `${json.sent} bytes`);
  if (json.received) out += kv('Received', `${json.received} bytes`);
  return out + footer(host);
};

const formatHttp: Formatter = (json, target, host) => {
  let out = header('http', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Request failed');
    return out + footer(host);
  }
  out += kv('Status', `${json.statusCode} ${json.statusText || ''}`);
  out += kv('Host', json.host);
  out += kv('Method', json.method || 'GET');
  out += kv('Path', json.path || '/');
  if (json.tls) out += kv('TLS', 'true');
  out += kv('Latency', `${json.latencyMs}ms`);
  out += kv('Body Size', `${json.bodySize ?? json.body?.length ?? 0} bytes`);
  if (json.headers) {
    out += '\n  Headers:\n';
    for (const [k, v] of Object.entries(json.headers)) {
      out += `    ${k}: ${v}\n`;
    }
  }
  return out + footer(host);
};

const formatDns: Formatter = (json, target, host) => {
  let out = header('dns', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Query failed');
    return out + footer(host);
  }
  out += kv('Domain', json.domain);
  out += kv('Server', json.server);
  out += kv('Query Type', json.queryType);
  out += kv('Status', json.rcode || 'NOERROR');
  out += kv('Query Time', `${json.queryTimeMs}ms`);
  if (json.answers && json.answers.length > 0) {
    out += '\n  Answers:\n';
    for (const a of json.answers) {
      const ttl = a.ttl !== undefined ? ` (TTL ${a.ttl})` : '';
      out += `    ${a.name || json.domain}  ${a.type || json.queryType}  ${a.data || a.value || JSON.stringify(a)}${ttl}\n`;
    }
  }
  if (json.authority && json.authority.length > 0) {
    out += '\n  Authority:\n';
    for (const a of json.authority) {
      out += `    ${a.name || ''}  ${a.type || ''}  ${a.data || a.value || ''}\n`;
    }
  }
  return out + footer(host);
};

const formatSsh: Formatter = (json, target, host) => {
  let out = header('ssh', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Key exchange failed');
    return out + footer(host);
  }
  out += kv('Host', json.host || target);
  out += kv('Port', json.port || 22);
  if (json.serverBanner) out += kv('Banner', json.serverBanner);
  if (json.latencyMs) out += kv('Latency', `${json.latencyMs}ms`);
  if (json.kexAlgorithms?.length) {
    out += '\n  Key Exchange Algorithms:\n';
    for (const alg of json.kexAlgorithms) {
      out += `    ${alg}\n`;
    }
  }
  if (json.hostKeyAlgorithms?.length) {
    out += '\n  Host Key Algorithms:\n';
    for (const alg of json.hostKeyAlgorithms) {
      out += `    ${alg}\n`;
    }
  }
  return out + footer(host);
};

const formatFtp: Formatter = (json, target, host) => {
  let out = header('ftp', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Connection failed');
    return out + footer(host);
  }
  out += kv('Host', json.host || target);
  out += kv('Status', 'Connected');
  if (json.message) out += kv('Banner', json.message);
  if (json.currentDirectory) out += kv('Directory', json.currentDirectory);
  return out + footer(host);
};

const formatRedis: Formatter = (json, target, host) => {
  let out = header('redis', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Connection failed');
    return out + footer(host);
  }
  out += kv('Host', json.host || target);
  out += kv('Port', json.port || 6379);
  out += kv('Status', 'Connected');
  if (json.version) out += kv('Version', json.version);
  if (json.serverInfo) {
    out += '\n  Server Info:\n';
    const info = typeof json.serverInfo === 'string' ? json.serverInfo : JSON.stringify(json.serverInfo, null, 2);
    for (const line of info.split('\n').slice(0, 20)) {
      if (line.trim()) out += `    ${line.trim()}\n`;
    }
  }
  return out + footer(host);
};

const formatMysql: Formatter = (json, target, host) => {
  let out = header('mysql', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Connection failed');
    return out + footer(host);
  }
  out += kv('Host', json.host || target);
  out += kv('Port', json.port || 3306);
  out += kv('Status', 'Connected');
  if (json.version) out += kv('Version', json.version);
  if (json.serverGreeting) out += kv('Greeting', json.serverGreeting);
  return out + footer(host);
};

const formatPostgres: Formatter = (json, target, host) => {
  let out = header('postgres', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Connection failed');
    return out + footer(host);
  }
  out += kv('Host', json.host || target);
  out += kv('Port', json.port || 5432);
  out += kv('Status', 'Connected');
  if (json.version) out += kv('Version', json.version);
  if (json.parameters) {
    out += '\n  Parameters:\n';
    for (const [k, v] of Object.entries(json.parameters)) {
      out += `    ${k}: ${v}\n`;
    }
  }
  return out + footer(host);
};

const formatSmtp: Formatter = (json, target, host) => {
  let out = header('smtp', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Connection failed');
    return out + footer(host);
  }
  out += kv('Host', json.host || target);
  out += kv('Port', json.port || 25);
  out += kv('Status', 'Connected');
  if (json.banner) out += kv('Banner', json.banner);
  if (json.ehloResponse) {
    out += '\n  EHLO Extensions:\n';
    const lines = Array.isArray(json.ehloResponse) ? json.ehloResponse : String(json.ehloResponse).split('\n');
    for (const line of lines) {
      if (String(line).trim()) out += `    ${String(line).trim()}\n`;
    }
  }
  return out + footer(host);
};

const formatWhois: Formatter = (json, target, host) => {
  let out = header('whois', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Lookup failed');
    return out + footer(host);
  }
  out += kv('Domain', json.domain || target);
  out += kv('Server', json.server || 'whois.iana.org');
  out += kv('Query Time', `${json.queryTimeMs}ms`);
  if (json.parsed) {
    out += '\n';
    for (const [k, v] of Object.entries(json.parsed)) {
      out += kv(String(k), v);
    }
  } else if (json.response) {
    out += '\n  Raw Response:\n';
    const lines = String(json.response).split('\n').slice(0, 30);
    for (const line of lines) {
      out += `    ${line}\n`;
    }
  }
  return out + footer(host);
};

const formatNtp: Formatter = (json, target, host) => {
  let out = header('ntp', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Query failed');
    return out + footer(host);
  }
  out += kv('Host', json.host || target);
  out += kv('Port', json.port || 123);
  if (json.time) out += kv('Time', json.time);
  if (json.offset !== undefined) out += kv('Offset', `${json.offset}ms`);
  if (json.delay !== undefined) out += kv('Delay', `${json.delay}ms`);
  if (json.stratum !== undefined) out += kv('Stratum', json.stratum);
  if (json.referenceId) out += kv('Reference', json.referenceId);
  return out + footer(host);
};

const formatTls: Formatter = (json, target, host) => {
  let out = header('tls', target);
  if (!json.success) {
    out += errorBlock(json.error || 'TLS handshake failed');
    return out + footer(host);
  }
  out += kv('Host', json.host || target);
  out += kv('Status', `${json.statusCode} ${json.statusText || ''}`);
  out += kv('TLS', 'true');
  if (json.latencyMs) out += kv('Latency', `${json.latencyMs}ms`);
  if (json.headers) {
    out += '\n  Headers:\n';
    for (const [k, v] of Object.entries(json.headers)) {
      out += `    ${k}: ${v}\n`;
    }
  }
  return out + footer(host);
};

const formatWs: Formatter = (json, target, host) => {
  let out = header('ws', target);
  if (!json.success) {
    out += errorBlock(json.error || 'WebSocket probe failed');
    return out + footer(host);
  }
  out += kv('Host', json.host || target);
  out += kv('Port', json.port || 80);
  out += kv('Status', 'Connected');
  if (json.latencyMs) out += kv('Latency', `${json.latencyMs}ms`);
  if (json.subprotocol) out += kv('Subprotocol', json.subprotocol);
  return out + footer(host);
};

const formatGeneric: Formatter = (json, target, host) => {
  let out = header('result', target);
  if (!json.success) {
    out += errorBlock(json.error || 'Failed');
    return out + footer(host);
  }
  // Scalar fields first
  for (const [k, v] of Object.entries(json)) {
    if (k === 'success') continue;
    if (typeof v === 'object' && v !== null) continue;
    out += kv(k, v);
  }
  // Then shallow object fields (arrays of strings, simple nested objects)
  for (const [k, v] of Object.entries(json)) {
    if (k === 'success') continue;
    if (typeof v !== 'object' || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      if (v.length <= 5 && v.every(i => typeof i === 'string' || typeof i === 'number')) {
        out += kv(k, v.join(', '));
      } else {
        out += `\n  ${k}:\n`;
        for (const item of v.slice(0, 10)) {
          out += `    ${typeof item === 'object' ? JSON.stringify(item) : item}\n`;
        }
        if (v.length > 10) out += `    ... (${v.length - 10} more)\n`;
      }
    } else {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length === 0) continue;
      out += `\n  ${k}:\n`;
      for (const [sk, sv] of entries.slice(0, 15)) {
        out += `    ${sk}: ${typeof sv === 'object' ? JSON.stringify(sv) : sv}\n`;
      }
      if (entries.length > 15) out += `    ... (${entries.length - 15} more)\n`;
    }
  }
  return out + footer(host);
};

const FORMATTERS: Record<string, Formatter> = {
  synping: formatSynping,
  tcp: formatTcp,
  http: formatHttp,
  https: formatHttp,
  dns: formatDns,
  ssh: formatSsh,
  ftp: formatFtp,
  redis: formatRedis,
  mysql: formatMysql,
  postgres: formatPostgres,
  smtp: formatSmtp,
  whois: formatWhois,
  ntp: formatNtp,
  tls: formatTls,
  ws: formatWs,
};

import type { ProtocolManpage } from './manpages';

export function formatManpage(proto: string, manpage: ProtocolManpage, host?: string): string {
  const h = host || 'l4.fyi';
  const label = `PORTOFCALL ${manpage.name}(1)`;
  const width = 72;
  const headerLine = label + ' '.repeat(Math.max(1, width - label.length * 2)) + label;

  let out = `\n${headerLine}\n\n`;
  out += `NAME\n`;
  out += `  ${proto} — ${manpage.fullName}`;
  if (manpage.defaultPort !== null) out += ` (port ${manpage.defaultPort})`;
  out += `\n\n`;

  out += `SYNOPSIS\n`;
  if (manpage.shortRoute) {
    if (manpage.defaultPort !== null) {
      out += `  curl ${h}/${proto}/<host>\n`;
      out += `  curl ${h}/${proto}/<host>:<port>\n`;
    } else {
      out += `  curl ${h}/${proto}/<host>:<port>\n`;
    }
  }
  const firstEndpoint = manpage.endpoints[0] || 'connect';
  out += `  curl -X POST ${h}/api/${proto}/${firstEndpoint} -d '{"host":"..."}'\n`;
  out += `\n`;

  out += `ENDPOINTS\n`;
  const maxPath = Math.max(...manpage.endpoints.map(e => `/api/${proto}/${e}`.length));
  for (const ep of manpage.endpoints) {
    const path = `/api/${proto}/${ep}`;
    out += `  POST ${path.padEnd(maxPath + 2)}${ep}\n`;
  }
  out += `\n`;

  if (manpage.shortRoute && manpage.defaultPort !== null) {
    out += `SEE ALSO\n`;
    out += `  curl ${h}/${proto}/example.com\n`;
    out += `  curl ${h}/${proto}/example.com:${manpage.defaultPort}\n`;
    out += `\n`;
  }

  const footerLine = ' '.repeat(Math.max(0, (width - h.length) / 2)) + h + ' '.repeat(Math.max(0, (width - h.length) / 2 - label.length)) + label;
  out += `${footerLine}\n`;
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatResponse(protocol: string, json: any, rawTarget: string, host?: string): string {
  const resolvedHost = host || 'l4.fyi';
  const formatter = FORMATTERS[protocol] || formatGeneric;
  return formatter(json, rawTarget, resolvedHost);
}

export function formatManpageHTML(proto: string, manpage: ProtocolManpage, host?: string): string {
  const h = host || 'l4.fyi';
  const title = `${proto}(1) — ${manpage.fullName}`;
  const port = manpage.defaultPort !== null ? ` (port ${manpage.defaultPort})` : '';

  let synopsisHTML = '';
  if (manpage.shortRoute) {
    if (manpage.defaultPort !== null) {
      synopsisHTML += `<span class="cmd">curl</span> ${h}/${proto}/&lt;host&gt;\n`;
      synopsisHTML += `<span class="cmd">curl</span> ${h}/${proto}/&lt;host&gt;:&lt;port&gt;\n`;
    } else {
      synopsisHTML += `<span class="cmd">curl</span> ${h}/${proto}/&lt;host&gt;:&lt;port&gt;\n`;
    }
  }
  const firstEndpoint = manpage.endpoints[0] || 'connect';
  synopsisHTML += `<span class="cmd">curl</span> -X POST ${h}/api/${proto}/${firstEndpoint} -d '{"host":"..."}'`;

  const maxPath = Math.max(...manpage.endpoints.map(e => `/api/${proto}/${e}`.length));
  const endpointsHTML = manpage.endpoints.map(ep => {
    const path = `/api/${proto}/${ep}`;
    return `  POST <a href="https://${h}${path}">${path}</a>${' '.repeat(Math.max(1, maxPath - path.length + 2))}${ep}`;
  }).join('\n');

  let seeAlsoHTML = '';
  if (manpage.shortRoute && manpage.defaultPort !== null) {
    seeAlsoHTML = `
<h2>SEE ALSO</h2>
<pre>  <a href="https://${h}/${proto}/example.com">curl ${h}/${proto}/example.com</a>
  <a href="https://${h}/${proto}/example.com:${manpage.defaultPort}">curl ${h}/${proto}/example.com:${manpage.defaultPort}</a></pre>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — L4.FYI</title>
<style>
  :root { --bg: #1a1a2e; --fg: #e0e0e0; --accent: #00d4aa; --dim: #888; --link: #5eead4; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--fg); font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: 15px; line-height: 1.6; padding: 2rem; max-width: 76ch; margin: 0 auto; }
  h1 { color: var(--accent); font-size: 1rem; font-weight: normal; border-bottom: 1px solid #333; padding-bottom: 0.5rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; }
  h2 { color: var(--accent); font-size: 0.9rem; font-weight: bold; margin: 1.5rem 0 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
  pre { white-space: pre-wrap; word-break: break-all; }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .cmd { color: var(--accent); }
  .port { color: var(--dim); }
  footer { margin-top: 2rem; padding-top: 0.5rem; border-top: 1px solid #333; color: var(--dim); font-size: 0.85rem; display: flex; justify-content: space-between; }
  footer a { color: var(--link); }
</style>
</head>
<body>
<h1><span>PORTOFCALL ${manpage.name}(1)</span><span>PORTOFCALL ${manpage.name}(1)</span></h1>

<h2>NAME</h2>
<pre>  ${proto} — ${manpage.fullName}<span class="port">${port}</span></pre>

<h2>SYNOPSIS</h2>
<pre>${synopsisHTML}</pre>

<h2>ENDPOINTS</h2>
<pre>${endpointsHTML}</pre>
${seeAlsoHTML}

<h2>TRY IT</h2>
<pre>  <span class="cmd">curl</span> ${h}/${proto}    <span class="port"># this page, as plain text</span></pre>

<footer>
  <span><a href="https://${h}">⚓ L4.FYI</a></span>
  <span>${h}</span>
</footer>
</body>
</html>`;
}
