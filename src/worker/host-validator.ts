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
    (parseInt(parts[0], 10) * 16777216 +   // 256^3
     parseInt(parts[1], 10) * 65536 +       // 256^2
     parseInt(parts[2], 10) * 256 +         // 256^1
     parseInt(parts[3], 10)) >>> 0
  );
}

function isBlockedIPv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip) >>> 0;
  return BLOCKED_IPV4_CIDRS.some(
    ({ addr, mask }) => (ipInt & (mask >>> 0)) === (addr >>> 0),
  );
}

/**
 * Expand an IPv6 address to its full 8-group form for reliable matching.
 * Handles :: shorthand and mixed IPv4-mapped notation.
 */
function expandIPv6(ip: string): string {
  let addr = ip.toLowerCase().replace(/\s/g, '');

  // Handle IPv4-mapped/compatible suffix (e.g. ::ffff:127.0.0.1 → ::ffff:7f00:0001)
  const v4Suffix = addr.match(/:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4Suffix) {
    const a = parseInt(v4Suffix[1], 10), b = parseInt(v4Suffix[2], 10);
    const c = parseInt(v4Suffix[3], 10), d = parseInt(v4Suffix[4], 10);
    const hi = ((a << 8) | b).toString(16);
    const lo = ((c << 8) | d).toString(16);
    addr = addr.replace(v4Suffix[0], `:${hi}:${lo}`);
  }

  // Expand :: shorthand
  const halves = addr.split('::');
  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const fill = 8 - left.length - right.length;
    const mid = Array(fill).fill('0');
    addr = [...left, ...mid, ...right].join(':');
  }

  // Pad each group to 4 hex digits
  return addr.split(':').map(g => g.padStart(4, '0')).join(':');
}

function isBlockedIPv6(ip: string): boolean {
  const expanded = expandIPv6(ip);
  const groups = expanded.split(':');
  const first = parseInt(groups[0], 16);

  // ::1 (loopback)
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
  // :: (unspecified)
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0000') return true;
  // fc00::/7 ULA (fc00::–fdff::)
  if ((first & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfe80) return true;

  // IPv4-mapped (::ffff:x.x.x.x) and IPv4-compatible (::x.x.x.x)
  // Check if first 5 groups are zero and 6th is ffff (mapped) or all zeros (compatible)
  const first5Zero = groups.slice(0, 5).every(g => g === '0000');
  if (first5Zero) {
    const sixth = groups[5];
    if (sixth === 'ffff' || sixth === '0000') {
      // Extract embedded IPv4 from last two groups
      const hi = parseInt(groups[6], 16);
      const lo = parseInt(groups[7], 16);
      const embeddedIPv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isBlockedIPv4(embeddedIPv4);
    }
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
