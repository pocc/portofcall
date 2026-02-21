/**
 * Host Validation — SSRF Prevention
 *
 * Blocks connections to private, loopback, link-local, and cloud metadata IPs.
 * Enforced at the router level before any protocol handler runs.
 *
 * Limitation: Cannot prevent DNS rebinding (hostname that resolves to a private
 * IP) because cloudflare:sockets connect() resolves hostnames internally.
 * Known-dangerous hostnames are blocked by name as a partial mitigation.
 */

const BLOCKED_IPV4_CIDRS: Array<{ addr: number; mask: number }> = [
  { addr: 0x7F000000, mask: 0xFF000000 },  // 127.0.0.0/8    (loopback)
  { addr: 0x0A000000, mask: 0xFF000000 },  // 10.0.0.0/8     (RFC 1918)
  { addr: 0xAC100000, mask: 0xFFF00000 },  // 172.16.0.0/12  (RFC 1918)
  { addr: 0xC0A80000, mask: 0xFFFF0000 },  // 192.168.0.0/16 (RFC 1918)
  { addr: 0xA9FE0000, mask: 0xFFFF0000 },  // 169.254.0.0/16 (link-local, incl. cloud metadata)
  { addr: 0x00000000, mask: 0xFFFFFFFF },  // 0.0.0.0/32     (unspecified)
  { addr: 0xFFFFFFFF, mask: 0xFFFFFFFF },  // 255.255.255.255/32 (broadcast)
  { addr: 0xC0000000, mask: 0xFFFFFFF8 },  // 192.0.0.0/29   (IANA special)
  { addr: 0x64400000, mask: 0xFFC00000 },  // 100.64.0.0/10  (CGN / shared address space)
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  return (
    ((parseInt(parts[0]) << 24) >>> 0) +
    (parseInt(parts[1]) << 16) +
    (parseInt(parts[2]) << 8) +
    parseInt(parts[3])
  );
}

function isBlockedIPv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip) >>> 0;
  return BLOCKED_IPV4_CIDRS.some(
    ({ addr, mask }) => (ipInt & (mask >>> 0)) === (addr >>> 0),
  );
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/\s/g, '');
  if (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') ||   // fc00::/7 ULA (fc00::–fdff::)
    lower.startsWith('fd') ||   // fc00::/7 ULA
    lower.startsWith('fe80')    // fe80::/10 link-local
  ) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — extract the IPv4 part and validate
  const v4MappedMatch = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MappedMatch) {
    return isBlockedIPv4(v4MappedMatch[1]);
  }

  return false;
}

/**
 * Returns true if the host is a private/internal address that must be blocked.
 * Handles raw IPs and known-dangerous hostnames.
 */
export function isBlockedHost(host: string): boolean {
  const trimmed = host.trim();
  if (!trimmed) return true;

  // IPv6 (contains colon)
  if (trimmed.includes(':')) {
    // Strip brackets from [::1] notation
    const bare = trimmed.startsWith('[') ? trimmed.slice(1, -1) : trimmed;
    return isBlockedIPv6(bare);
  }

  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)) {
    return isBlockedIPv4(trimmed);
  }

  // Hostname — block known internal names
  const lower = trimmed.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === 'metadata.google.internal' ||
    lower.endsWith('.internal') ||
    lower.endsWith('.local') ||
    lower.endsWith('.localhost')
  );
}
