# Finger Protocol Implementation Plan

## Overview

**Protocol:** Finger
**Port:** 79
**RFC:** [RFC 1288](https://tools.ietf.org/html/rfc1288)
**Complexity:** Low
**Purpose:** User information lookup

Finger is a **simple legacy protocol** for getting user information. While rarely used today, it's perfect for educational purposes and demonstrates the simplest possible TCP protocol.

### Use Cases
- Educational - learn simple protocols
- Retro computing
- User information lookup (legacy systems)
- Network service enumeration
- Historical internet exploration

## Protocol Specification

### Simplest Protocol

```
Client connects → sends query → server responds → closes
```

### Query Format

```
[username][@hostname]\r\n
```

Examples:
- `alice\r\n` - Get info for user "alice"
- `@hostname\r\n` - List all users on hostname
- `\r\n` - List all logged-in users (local)

### Response Format

Plain text, no structure:
```
Login: alice        Name: Alice Smith
Directory: /home/alice      Shell: /bin/bash
Last login Fri Jan 15 10:23 from client.example.com
No mail.
No Plan.
```

## Worker Implementation

```typescript
// src/worker/protocols/finger/client.ts

import { connect } from 'cloudflare:sockets';

export interface FingerQuery {
  username?: string;
  host?: string;
}

export interface FingerResult {
  query: string;
  response: string;
  error?: string;
}

export async function fingerQuery(
  host: string,
  port: number = 79,
  query: FingerQuery
): Promise<FingerResult> {
  try {
    const socket = connect(`${host}:${port}`);
    await socket.opened;

    // Build query
    let queryString = '';
    if (query.username) {
      queryString += query.username;
    }
    if (query.host) {
      queryString += `@${query.host}`;
    }
    queryString += '\r\n';

    // Send query
    const writer = socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(queryString));
    writer.releaseLock();

    // Read response
    const reader = socket.readable.getReader();
    const decoder = new TextDecoder();
    let response = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      response += decoder.decode(value, { stream: true });
    }

    await socket.close();

    return {
      query: queryString.trim(),
      response: response.trim(),
    };
  } catch (error) {
    return {
      query: '',
      response: '',
      error: error instanceof Error ? error.message : 'Query failed',
    };
  }
}
```

## Web UI Design

```typescript
// src/components/FingerClient.tsx

export function FingerClient() {
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [result, setResult] = useState<FingerResult | null>(null);
  const [loading, setLoading] = useState(false);

  const query = async () => {
    setLoading(true);

    const response = await fetch('/api/finger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, username }),
    });

    const data = await response.json();
    setResult(data);
    setLoading(false);
  };

  return (
    <div className="finger-client">
      <h2>Finger Protocol</h2>

      <div className="retro-container">
        <div className="query-form">
          <input
            type="text"
            placeholder="Username (optional)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <span>@</span>
          <input
            type="text"
            placeholder="Hostname"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
          <button onClick={query} disabled={loading || !host}>
            Finger
          </button>
        </div>

        {result && (
          <div className="result">
            {result.error ? (
              <div className="error">Error: {result.error}</div>
            ) : (
              <pre>{result.response || 'No information available'}</pre>
            )}
          </div>
        )}
      </div>

      <div className="info">
        <h3>About Finger</h3>
        <p>
          Finger is a legacy Internet protocol from 1977 for getting user
          information. Most servers have disabled it for security reasons.
        </p>
        <p>Examples:</p>
        <ul>
          <li><code>finger alice@example.com</code> - Get info for user "alice"</li>
          <li><code>finger @example.com</code> - List all users</li>
        </ul>
      </div>
    </div>
  );
}
```

## Security

### Major Security Issue

```typescript
// WARNING: Finger exposes user information
// Most servers have it disabled
// Only use on trusted networks
```

### Input Validation

```typescript
function validateFingerQuery(host: string, username?: string): boolean {
  // No special characters in username
  if (username && !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return false;
  }

  // Valid hostname
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
    return false;
  }

  return true;
}
```

## Testing

### Test Servers

Very few public finger servers exist today:

```bash
# Test locally with netcat
nc -l 79
# When client connects, type some text and close
```

### Create Test Server

```python
# Simple finger server (Python)
import socket

s = socket.socket()
s.bind(('', 79))
s.listen(1)

while True:
    conn, addr = s.accept()
    query = conn.recv(1024).decode()
    response = f"User info for: {query}\n"
    conn.send(response.encode())
    conn.close()
```

## Resources

- **RFC 1288**: [Finger Protocol](https://tools.ietf.org/html/rfc1288)
- **RFC 742**: [Original Finger Spec](https://tools.ietf.org/html/rfc742) (1977)

## Next Steps

1. Implement simple finger client
2. Build retro-style UI
3. Add response parsing (if structured)
4. Create "Finger Facts" educational section
5. Show protocol evolution timeline

## Notes

- **Simplest TCP protocol** after Echo
- Perfect for **educational purposes**
- **Security risk** - exposes user info
- Most modern systems have it **disabled**
- Good example of **legacy internet** protocols
- Part of **Internet archaeology**
