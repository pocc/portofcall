# LDAP Protocol Implementation Plan

## Overview

**Protocol:** LDAP (Lightweight Directory Access Protocol)
**Port:** 389 (plain), 636 (LDAPS)
**RFC:** [RFC 4511](https://tools.ietf.org/html/rfc4511)
**Complexity:** High
**Purpose:** Directory services (Active Directory, user management)

LDAP enables **browsing organizational directories**, Active Directory queries, and user/group management from the browser.

### Use Cases
- Active Directory browsing
- User and group management
- Corporate directory search
- Authentication testing
- LDAP schema exploration
- Educational - learn directory services

## Protocol Specification

### LDAP Message Format (ASN.1/BER)

```
LDAPMessage ::= SEQUENCE {
    messageID       MessageID,
    protocolOp      CHOICE {
        bindRequest           BindRequest,
        bindResponse          BindResponse,
        searchRequest         SearchRequest,
        searchResultEntry     SearchResultEntry,
        searchResultDone      SearchResultDone,
        ...
    }
}
```

### Common Operations

| Operation | Code | Description |
|-----------|------|-------------|
| BindRequest | 0 | Authenticate |
| SearchRequest | 3 | Query directory |
| AddRequest | 8 | Add entry |
| DelRequest | 10 | Delete entry |
| ModifyRequest | 6 | Modify entry |

### Distinguished Names (DN)

```
cn=John Doe,ou=Users,dc=example,dc=com
```

### Search Filters

```
(objectClass=person)
(&(objectClass=user)(cn=John*))
(|(mail=*@example.com)(telephoneNumber=555*))
```

## Worker Implementation

### Use ldapjs Library

```bash
npm install ldapjs
```

```typescript
// src/worker/protocols/ldap/client.ts

import ldap from 'ldapjs';
import { connect as tcpConnect } from 'cloudflare:sockets';

export interface LDAPConfig {
  url: string; // ldap://host:port
  bindDN?: string;
  password?: string;
  baseDN: string;
}

export interface LDAPEntry {
  dn: string;
  attributes: Record<string, string | string[]>;
}

export class LDAPClient {
  private client: ldap.Client;

  constructor(private config: LDAPConfig) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = ldap.createClient({
        url: this.config.url,
      });

      this.client.on('error', reject);

      if (this.config.bindDN && this.config.password) {
        this.client.bind(this.config.bindDN, this.config.password, (err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        // Anonymous bind
        this.client.bind('', '', (err) => {
          if (err) reject(err);
          else resolve();
        });
      }
    });
  }

  async search(
    filter: string,
    attributes?: string[]
  ): Promise<LDAPEntry[]> {
    return new Promise((resolve, reject) => {
      const opts = {
        filter,
        scope: 'sub' as const,
        attributes: attributes || [],
      };

      const entries: LDAPEntry[] = [];

      this.client.search(this.config.baseDN, opts, (err, res) => {
        if (err) {
          reject(err);
          return;
        }

        res.on('searchEntry', (entry) => {
          const ldapEntry: LDAPEntry = {
            dn: entry.objectName,
            attributes: {},
          };

          entry.attributes.forEach((attr: any) => {
            const values = attr.values || attr.vals || [];
            ldapEntry.attributes[attr.type] = values.length === 1 ? values[0] : values;
          });

          entries.push(ldapEntry);
        });

        res.on('error', reject);

        res.on('end', () => {
          resolve(entries);
        });
      });
    });
  }

  async getEntry(dn: string): Promise<LDAPEntry | null> {
    const results = await this.search(`(objectClass=*)`, undefined);
    return results.find(e => e.dn === dn) || null;
  }

  async add(dn: string, entry: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.add(dn, entry, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async modify(dn: string, changes: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.modify(dn, changes, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async delete(dn: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.del(dn, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.client.unbind(() => {
        resolve();
      });
    });
  }
}
```

## Web UI Design

```typescript
// src/components/LDAPBrowser.tsx

export function LDAPBrowser() {
  const [connected, setConnected] = useState(false);
  const [searchFilter, setSearchFilter] = useState('(objectClass=person)');
  const [results, setResults] = useState<LDAPEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<LDAPEntry | null>(null);

  const search = async () => {
    const response = await fetch('/api/ldap/search', {
      method: 'POST',
      body: JSON.stringify({
        url: 'ldap://ldap.example.com:389',
        baseDN: 'dc=example,dc=com',
        filter: searchFilter,
      }),
    });

    const data = await response.json();
    setResults(data.entries);
  };

  return (
    <div className="ldap-browser">
      <h2>LDAP Directory Browser</h2>

      <div className="search-panel">
        <input
          type="text"
          placeholder="Search filter"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
        />
        <button onClick={search}>Search</button>
      </div>

      <div className="results-panel">
        <div className="entry-list">
          {results.map(entry => (
            <div
              key={entry.dn}
              className="entry-item"
              onClick={() => setSelectedEntry(entry)}
            >
              <strong>{entry.attributes.cn}</strong>
              <div className="dn">{entry.dn}</div>
            </div>
          ))}
        </div>

        {selectedEntry && (
          <div className="entry-details">
            <h3>Entry Details</h3>
            <dl>
              {Object.entries(selectedEntry.attributes).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{Array.isArray(value) ? value.join(', ') : value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
```

## Security

### Bind Authentication

```typescript
// Always use authenticated bind for write operations
const config = {
  url: 'ldap://ldap.example.com:389',
  bindDN: 'cn=admin,dc=example,dc=com',
  password: 'secret',
};
```

### LDAPS (LDAP over SSL)

```typescript
// Use port 636 for encrypted connection
const config = {
  url: 'ldaps://ldap.example.com:636',
};
```

## Testing

```bash
# Docker OpenLDAP
docker run -d \
  -p 389:389 \
  -p 636:636 \
  -e LDAP_ORGANISATION="Example" \
  -e LDAP_DOMAIN="example.com" \
  -e LDAP_ADMIN_PASSWORD=admin \
  osixia/openldap
```

## Resources

- **RFC 4511**: [LDAP Protocol](https://tools.ietf.org/html/rfc4511)
- **ldapjs**: [Node.js LDAP client](http://ldapjs.org/)
- **Active Directory**: [Microsoft Docs](https://docs.microsoft.com/en-us/windows/win32/ad/active-directory-ldap)

## Notes

- LDAP uses **ASN.1/BER encoding** (binary)
- Active Directory is **LDAP-based**
- Distinguished Names (DN) are hierarchical
- Search filters use **RFC 4515** syntax
- LDAPS (port 636) for encrypted connections
