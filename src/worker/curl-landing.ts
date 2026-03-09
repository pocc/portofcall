/**
 * ASCII art landing page for curl users.
 * Shown when `curl l4.fyi` (or any host) is detected.
 */

function buildLanding(host: string): string {
  return `
  ⚓ Port of Call — Browser-to-TCP bridge via Cloudflare Workers

  USAGE
    curl ${host}/:protocol/:target

  EXAMPLES
    curl ${host}/synping/example.com:22
    curl ${host}/dns/example.com/MX
    curl ${host}/http/example.com/robots.txt
    curl ${host}/https/example.com
    curl ${host}/ssh/github.com
    curl ${host}/whois/example.com
    curl ${host}/redis/cache.example.com:6379
    curl ${host}/tls/example.com
    curl ${host}/ntp/pool.ntp.org

  PROTOCOLS
    synping    TCP ping (port required)      /synping/host:port
    tcp        Raw TCP send/receive          /tcp/host:port
    http       HTTP request                  /http/host[/path]
    https      HTTPS request                 /https/host[/path]
    dns        DNS lookup                    /dns/domain[/type]
    ssh        SSH key exchange              /ssh/host[:port]
    ftp        FTP connect                   /ftp/host[:port]
    redis      Redis connect                 /redis/host[:port]
    mysql      MySQL connect                 /mysql/host[:port]
    postgres   PostgreSQL connect            /postgres/host[:port]
    smtp       SMTP connect                  /smtp/host[:port]
    whois      WHOIS lookup                  /whois/domain
    ntp        NTP time query                /ntp/host[:port]
    tls        TLS certificate check         /tls/host[:port]
    ws         WebSocket probe               /ws/host[:port][/path]

  OPTIONS
    ?timeout=5000      Override timeout (10–30000ms, clamped)
    ?format=json       Force JSON output
    Accept: application/json   Also returns JSON

  CLI
    curl -sL ${host}/cli > /usr/local/bin/poc && chmod +x $_
    poc example.com:22
    poc dns example.com MX
    poc --json ssh github.com

  MORE INFO
    https://${host}        Web UI (open in browser)
    https://github.com/rjbs/portofcall

`;
}

export function serveCurlLandingPage(requestUrl: string): Response {
  const host = new URL(requestUrl).host;
  return new Response(buildLanding(host), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
