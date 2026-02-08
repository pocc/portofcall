/**
 * Cloudflare Detection Utility
 *
 * Checks if a target host is behind Cloudflare.
 * This is important because Cloudflare Workers cannot connect to Cloudflare-proxied domains
 * due to Cloudflare's security model (prevents Workers from being used as proxies).
 */

// Cloudflare's IPv4 ranges (updated from https://www.cloudflare.com/ips-v4)
const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

// Cloudflare's IPv6 ranges (updated from https://www.cloudflare.com/ips-v6)
const CLOUDFLARE_IPV6_RANGES = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/**
 * Parse IPv4 address to 32-bit integer
 */
function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  return (
    (parseInt(parts[0]) << 24) +
    (parseInt(parts[1]) << 16) +
    (parseInt(parts[2]) << 8) +
    parseInt(parts[3])
  );
}

/**
 * Check if an IPv4 address is in a CIDR range
 */
function isIpv4InRange(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split('/');
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  const mask = -1 << (32 - parseInt(bits));
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Check if an IPv6 address is in a CIDR range (simplified check)
 */
function isIpv6InRange(ip: string, cidr: string): boolean {
  const [range] = cidr.split('/');
  // Simplified: just check if IP starts with the range prefix
  // This is approximate but sufficient for Cloudflare's large ranges
  const prefix = range.split(':').slice(0, 2).join(':');
  return ip.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * Check if an IP address belongs to Cloudflare
 */
function isCloudflareIP(ip: string): boolean {
  // Check if it's IPv4 or IPv6
  if (ip.includes(':')) {
    // IPv6
    return CLOUDFLARE_IPV6_RANGES.some(range => isIpv6InRange(ip, range));
  } else {
    // IPv4
    return CLOUDFLARE_IPV4_RANGES.some(range => isIpv4InRange(ip, range));
  }
}

/**
 * Resolve a hostname to an IP address and check if it's behind Cloudflare
 *
 * Returns { isCloudflare: boolean, ip: string | null, error: string | null }
 */
export async function checkIfCloudflare(host: string): Promise<{
  isCloudflare: boolean;
  ip: string | null;
  error: string | null;
}> {
  try {
    // If the host is already an IP address, check it directly
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || host.includes(':')) {
      const isCloudflare = isCloudflareIP(host);
      return {
        isCloudflare,
        ip: host,
        error: null,
      };
    }

    // For hostnames, we need to make a DNS query
    // In a Cloudflare Worker, we can use DNS over HTTPS (DoH)
    const dohResponse = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
      {
        headers: {
          'Accept': 'application/dns-json',
        },
      }
    );

    if (!dohResponse.ok) {
      return {
        isCloudflare: false,
        ip: null,
        error: 'DNS resolution failed',
      };
    }

    const dnsData = await dohResponse.json() as {
      Answer?: Array<{ data: string }>;
    };

    if (!dnsData.Answer || dnsData.Answer.length === 0) {
      return {
        isCloudflare: false,
        ip: null,
        error: 'No DNS records found',
      };
    }

    // Get the first A record
    const ip = dnsData.Answer[0].data;
    const isCloudflare = isCloudflareIP(ip);

    return {
      isCloudflare,
      ip,
      error: null,
    };
  } catch (error) {
    return {
      isCloudflare: false,
      ip: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get a user-friendly error message for Cloudflare-protected hosts
 */
export function getCloudflareErrorMessage(host: string, ip: string): string {
  return `Cannot connect to ${host} (${ip}): This domain is protected by Cloudflare. ` +
    `Cloudflare Workers cannot connect to Cloudflare-proxied domains due to security restrictions. ` +
    `Please try connecting to a non-Cloudflare-protected server, or use the origin IP directly if available.`;
}
