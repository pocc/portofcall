# WHOIS Protocol Implementation Plan

## Overview

**Protocol:** WHOIS
**Port:** 43
**RFC:** [RFC 3912](https://tools.ietf.org/html/rfc3912)
**Complexity:** Low (Simplest request/response protocol)
**Purpose:** Domain registration information lookup

WHOIS is the **simplest** real-world protocol - send domain name, receive text response. Perfect for quick implementation.

### Use Cases
- Domain availability checking
- Domain registration details
- Contact information lookup
- Expiration date monitoring
- Name server information

## Protocol Specification

### Wire Format

Extremely simple - even simpler than Echo:

```
Client → Server: example.com\r\n
Server → Client: [registration details as text]
Server closes connection
```

That's it! No commands, no protocol negotiation, no encoding.

### Example Session

```
Client connects to whois.verisign-grs.com:43
Client sends: "google.com\r\n"

Server responds:
   Domain Name: GOOGLE.COM
   Registry Domain ID: 2138514_DOMAIN_COM-VRSN
   Registrar WHOIS Server: whois.markmonitor.com
   Registrar URL: http://www.markmonitor.com
   Updated Date: 2019-09-09T15:39:04Z
   Creation Date: 1997-09-15T04:00:00Z
   Registry Expiry Date: 2028-09-14T04:00:00Z
   ... [more details]

Server closes connection
```

### WHOIS Hierarchy

Different TLDs have different WHOIS servers:

| TLD | WHOIS Server |
|-----|-------------|
| .com, .net | whois.verisign-grs.com |
| .org | whois.pir.org |
| .uk | whois.nic.uk |
| .de | whois.denic.de |
| IP addresses | whois.arin.net (ARIN) |

## Worker Implementation

### WHOIS Client

```typescript
// src/worker/protocols/whois.ts

import { connect } from 'cloudflare:sockets';

export interface WhoisResult {
  query: string;
  server: string;
  response: string;
  parsed?: ParsedWhoisData;
  error?: string;
}

export interface ParsedWhoisData {
  domainName?: string;
  registrar?: string;
  creationDate?: string;
  expiryDate?: string;
  nameServers?: string[];
  status?: string[];
}

/**
 * WHOIS server mapping by TLD
 */
const WHOIS_SERVERS: Record<string, string> = {
  com: 'whois.verisign-grs.com',
  net: 'whois.verisign-grs.com',
  org: 'whois.pir.org',
  info: 'whois.afilias.net',
  biz: 'whois.biz',
  us: 'whois.nic.us',
  uk: 'whois.nic.uk',
  de: 'whois.denic.de',
  fr: 'whois.afnic.fr',
  ca: 'whois.cira.ca',
  au: 'whois.auda.org.au',
  jp: 'whois.jprs.jp',
  cn: 'whois.cnnic.cn',
  ru: 'whois.tcinet.ru',
  // Add more as needed
};

/**
 * Get WHOIS server for a domain
 */
function getWhoisServer(domain: string): string {
  const parts = domain.toLowerCase().split('.');
  const tld = parts[parts.length - 1];

  return WHOIS_SERVERS[tld] || 'whois.iana.org';
}

/**
 * Perform WHOIS lookup
 */
export async function whoisLookup(domain: string): Promise<WhoisResult> {
  const server = getWhoisServer(domain);

  try {
    const socket = connect(`${server}:43`);
    await socket.opened;

    // Send query
    const writer = socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(`${domain}\r\n`));
    writer.releaseLock();

    // Read response
    const reader = socket.readable.getReader();
    const decoder = new TextDecoder();
    let response = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      response += decoder.decode(value, { stream: true });
    }

    // Server closes connection when done
    await socket.close();

    // Parse response
    const parsed = parseWhoisResponse(response);

    return {
      query: domain,
      server,
      response,
      parsed,
    };

  } catch (error) {
    return {
      query: domain,
      server,
      response: '',
      error: error instanceof Error ? error.message : 'Lookup failed',
    };
  }
}

/**
 * Parse WHOIS response into structured data
 */
function parseWhoisResponse(response: string): ParsedWhoisData {
  const lines = response.split('\n');
  const data: ParsedWhoisData = {
    nameServers: [],
    status: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%') || trimmed.startsWith('#')) {
      continue; // Skip comments
    }

    // Extract key-value pairs
    const match = trimmed.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;

    const [, key, value] = match;
    const normalizedKey = key.toLowerCase().replace(/\s+/g, '');

    switch (normalizedKey) {
      case 'domainname':
        data.domainName = value;
        break;
      case 'registrar':
        data.registrar = value;
        break;
      case 'creationdate':
      case 'createdon':
        data.creationDate = value;
        break;
      case 'registryexpirydate':
      case 'expirationdate':
      case 'expires':
        data.expiryDate = value;
        break;
      case 'nameserver':
        data.nameServers?.push(value);
        break;
      case 'domainstatus':
      case 'status':
        data.status?.push(value);
        break;
    }
  }

  return data;
}

/**
 * Check if domain is available (not registered)
 */
export async function checkDomainAvailability(domain: string): Promise<{
  available: boolean;
  domain: string;
}> {
  const result = await whoisLookup(domain);

  // Common patterns indicating domain is not registered
  const notFoundPatterns = [
    'no match for',
    'not found',
    'no entries found',
    'domain not found',
    'no data found',
  ];

  const available = notFoundPatterns.some(pattern =>
    result.response.toLowerCase().includes(pattern)
  );

  return { available, domain };
}
```

### API Endpoints

```typescript
// Add to src/worker/index.ts

// WHOIS lookup
if (url.pathname === '/api/whois' && request.method === 'POST') {
  const { domain } = await request.json();

  // Validate domain
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) {
    return Response.json(
      { error: 'Invalid domain format' },
      { status: 400 }
    );
  }

  const result = await whoisLookup(domain);
  return Response.json(result);
}

// Batch availability check
if (url.pathname === '/api/whois/availability' && request.method === 'POST') {
  const { domains } = await request.json();

  const results = await Promise.all(
    domains.map(checkDomainAvailability)
  );

  return Response.json(results);
}
```

## Web UI Design

### WHOIS Lookup Component

```typescript
// src/components/WhoisLookup.tsx

import { useState } from 'react';

interface WhoisResult {
  query: string;
  server: string;
  response: string;
  parsed?: {
    domainName?: string;
    registrar?: string;
    creationDate?: string;
    expiryDate?: string;
    nameServers?: string[];
    status?: string[];
  };
  error?: string;
}

export function WhoisLookup() {
  const [domain, setDomain] = useState('');
  const [result, setResult] = useState<WhoisResult | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = async (domainToLookup: string) => {
    setLoading(true);
    try {
      const response = await fetch('/api/whois', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainToLookup }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        query: domainToLookup,
        server: '',
        response: '',
        error: error instanceof Error ? error.message : 'Lookup failed',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="whois-lookup">
      <h2>WHOIS Lookup</h2>

      <div className="search-box">
        <input
          type="text"
          placeholder="Enter domain (e.g., google.com)"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter' && domain) {
              lookup(domain);
            }
          }}
        />
        <button onClick={() => lookup(domain)} disabled={loading || !domain}>
          {loading ? 'Looking up...' : 'Lookup'}
        </button>
      </div>

      {result && (
        <div className="results">
          {result.error ? (
            <div className="error">
              <h3>Error</h3>
              <p>{result.error}</p>
            </div>
          ) : (
            <>
              <div className="parsed-data">
                <h3>Domain Information</h3>
                <dl>
                  {result.parsed?.domainName && (
                    <>
                      <dt>Domain Name</dt>
                      <dd>{result.parsed.domainName}</dd>
                    </>
                  )}
                  {result.parsed?.registrar && (
                    <>
                      <dt>Registrar</dt>
                      <dd>{result.parsed.registrar}</dd>
                    </>
                  )}
                  {result.parsed?.creationDate && (
                    <>
                      <dt>Created</dt>
                      <dd>{new Date(result.parsed.creationDate).toLocaleDateString()}</dd>
                    </>
                  )}
                  {result.parsed?.expiryDate && (
                    <>
                      <dt>Expires</dt>
                      <dd>{new Date(result.parsed.expiryDate).toLocaleDateString()}</dd>
                    </>
                  )}
                  {result.parsed?.nameServers && result.parsed.nameServers.length > 0 && (
                    <>
                      <dt>Name Servers</dt>
                      <dd>
                        <ul>
                          {result.parsed.nameServers.map((ns, i) => (
                            <li key={i}>{ns}</li>
                          ))}
                        </ul>
                      </dd>
                    </>
                  )}
                  {result.parsed?.status && result.parsed.status.length > 0 && (
                    <>
                      <dt>Status</dt>
                      <dd>
                        <ul>
                          {result.parsed.status.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </dd>
                    </>
                  )}
                </dl>
              </div>

              <details className="raw-response">
                <summary>Raw WHOIS Response</summary>
                <pre>{result.response}</pre>
              </details>

              <div className="metadata">
                <small>Queried server: {result.server}</small>
              </div>
            </>
          )}
        </div>
      )}

      <PopularDomains onSelect={lookup} />
    </div>
  );
}

function PopularDomains({ onSelect }: { onSelect: (domain: string) => void }) {
  const domains = [
    'google.com',
    'github.com',
    'cloudflare.com',
    'wikipedia.org',
    'example.com',
  ];

  return (
    <div className="popular-domains">
      <h3>Try these:</h3>
      {domains.map(domain => (
        <button key={domain} onClick={() => onSelect(domain)}>
          {domain}
        </button>
      ))}
    </div>
  );
}
```

### Domain Availability Checker

```typescript
// src/components/DomainAvailability.tsx

export function DomainAvailability() {
  const [baseName, setBaseName] = useState('');
  const [extensions] = useState(['.com', '.net', '.org', '.io', '.dev']);
  const [results, setResults] = useState<Array<{ domain: string; available: boolean }>>([]);
  const [loading, setLoading] = useState(false);

  const checkAvailability = async () => {
    setLoading(true);

    const domains = extensions.map(ext => `${baseName}${ext}`);

    const response = await fetch('/api/whois/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains }),
    });

    const data = await response.json();
    setResults(data);
    setLoading(false);
  };

  return (
    <div className="domain-availability">
      <h2>Check Domain Availability</h2>

      <div className="search-box">
        <input
          type="text"
          placeholder="Enter domain name (without extension)"
          value={baseName}
          onChange={(e) => setBaseName(e.target.value.replace(/\./g, ''))}
        />
        <button onClick={checkAvailability} disabled={loading || !baseName}>
          Check Availability
        </button>
      </div>

      {results.length > 0 && (
        <div className="results-grid">
          {results.map(({ domain, available }) => (
            <div key={domain} className={`domain-result ${available ? 'available' : 'taken'}`}>
              <span className="domain-name">{domain}</span>
              <span className={`status ${available ? 'available' : 'taken'}`}>
                {available ? '✓ Available' : '✗ Taken'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

## Data Flow

```
┌─────────┐         ┌──────────┐         ┌──────────────┐
│ Browser │         │  Worker  │         │ WHOIS Server │
└────┬────┘         └────┬─────┘         └──────┬───────┘
     │                   │                       │
     │ POST /api/whois   │                       │
     │ {domain: "x.com"} │                       │
     ├──────────────────>│                       │
     │                   │ connect(whois.server:43)
     │                   ├──────────────────────>│
     │                   │ "x.com\r\n"           │
     │                   ├──────────────────────>│
     │                   │                       │
     │                   │ [registration data]   │
     │                   │<──────────────────────┤
     │                   │ [more data...]        │
     │                   │<──────────────────────┤
     │                   │ [connection closed]   │
     │                   │                       │
     │ {response, parsed}│                       │
     │<──────────────────┤                       │
     │                   │                       │
```

## Security

### Input Validation

```typescript
function validateDomain(domain: string): boolean {
  // Only allow valid domain characters
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) {
    return false;
  }

  // No IP addresses
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
    return false;
  }

  // Reasonable length
  if (domain.length > 253) {
    return false;
  }

  return true;
}
```

### Rate Limiting

```typescript
// WHOIS servers often rate limit
// Implement caching and rate limiting

const WHOIS_CACHE_TTL = 3600; // 1 hour
const WHOIS_RATE_LIMIT = 10; // queries per minute per IP
```

### Caching

```typescript
// Cache WHOIS results (domains don't change often)
async function cachedWhoisLookup(domain: string, env: Env): Promise<WhoisResult> {
  const cacheKey = `whois:${domain}`;

  // Check cache
  const cached = await env.KV.get(cacheKey, 'json');
  if (cached) return cached;

  // Perform lookup
  const result = await whoisLookup(domain);

  // Cache for 1 hour
  await env.KV.put(cacheKey, JSON.stringify(result), {
    expirationTtl: 3600,
  });

  return result;
}
```

## Testing

### Test Domains

```typescript
const TEST_DOMAINS = {
  registered: 'google.com',
  expired: 'example-expired-domain-12345.com',
  available: 'this-is-definitely-not-registered-123456789.com',
};
```

### Unit Tests

```typescript
// tests/whois.test.ts

describe('WHOIS', () => {
  it('should lookup registered domain', async () => {
    const result = await whoisLookup('google.com');

    expect(result.error).toBeUndefined();
    expect(result.response).toContain('google.com');
    expect(result.parsed?.domainName).toBeTruthy();
  });

  it('should detect available domain', async () => {
    const result = await checkDomainAvailability('this-is-not-a-real-domain-xyz123.com');
    expect(result.available).toBe(true);
  });

  it('should parse response correctly', async () => {
    const result = await whoisLookup('cloudflare.com');

    expect(result.parsed?.domainName).toBe('CLOUDFLARE.COM');
    expect(result.parsed?.registrar).toBeTruthy();
    expect(result.parsed?.nameServers).toBeArray();
  });
});
```

## Resources

- **RFC 3912**: [WHOIS Protocol Specification](https://tools.ietf.org/html/rfc3912)
- **IANA WHOIS**: [Root WHOIS Server](https://www.iana.org/whois)
- **WHOIS Servers List**: [Public WHOIS Servers](https://github.com/rfc1036/whois)

## Next Steps

1. Implement basic WHOIS lookup
2. Add parsing for common registrars
3. Build domain availability checker UI
4. Add caching layer
5. Support IP address lookups (ARIN, RIPE, APNIC)
6. Create domain monitoring dashboard

## Notes

- WHOIS is perfect as a **second protocol** after Echo
- Demonstrates real-world utility immediately
- Parsing is the only complex part (response format varies)
- Great for building confidence before tackling harder protocols
- Consider batch lookups for domain availability checking
