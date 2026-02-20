# Gopher Protocol Implementation Plan

## Overview

**Protocol:** Gopher
**Port:** 70
**RFC:** [RFC 1436](https://tools.ietf.org/html/rfc1436)
**Complexity:** Low
**Purpose:** Pre-Web hypertext browsing

Gopher is a **1991 internet protocol** that predates the World Wide Web. It provides document retrieval with a hierarchical menu structure - a fascinating piece of internet history.

### Use Cases
- Retro internet exploration
- Educational - learn pre-Web protocols
- Access Gopherspace (still active!)
- Internet archaeology
- Historical document browsing

## Protocol Specification

### Request Format

```
selector\r\n
```

That's it! Just send the selector string followed by CRLF.

### Response Format

Menu items (one per line):
```
Type Display_Name TAB Selector TAB Host TAB Port
```

### Item Types

| Type | Meaning |
|------|---------|
| 0 | Text file |
| 1 | Directory (menu) |
| 2 | CCSO name server |
| 3 | Error |
| 4 | BinHex file |
| 5 | DOS binary |
| 6 | uuencoded file |
| 7 | Search server |
| 8 | Telnet session |
| 9 | Binary file |
| g | GIF image |
| I | Image file |
| h | HTML file |
| i | Inline text (non-selectable) |

### Example Session

```
Client connects to gopher.example.com:70
Client sends: "\r\n" (root menu)

Server responds:
i Welcome to Gopher!      (none)  (none)  0
1 About                   /about   gopher.example.com  70
0 README.txt              /readme  gopher.example.com  70
9 archive.zip             /files/archive.zip  gopher.example.com  70
.
(period on its own line = end)
```

## Worker Implementation

```typescript
// src/worker/protocols/gopher/client.ts

import { connect } from 'cloudflare:sockets';

export interface GopherItem {
  type: string;
  display: string;
  selector: string;
  host: string;
  port: number;
}

export class GopherClient {
  constructor(
    private host: string,
    private port: number = 70
  ) {}

  async fetch(selector: string = ''): Promise<GopherItem[] | string> {
    const socket = connect(`${this.host}:${this.port}`);
    await socket.opened;

    // Send selector
    const writer = socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(selector + '\r\n'));
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

    // Check if it's a menu or file content
    if (this.isMenu(response)) {
      return this.parseMenu(response);
    } else {
      return response;
    }
  }

  private isMenu(content: string): boolean {
    // Menus have lines starting with type character
    const lines = content.split('\n');
    return lines.some(line =>
      line.length > 0 && /^[0-9giI+T]/.test(line)
    );
  }

  private parseMenu(content: string): GopherItem[] {
    const items: GopherItem[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      if (line === '.' || line.trim() === '') continue;
      if (line.length === 0) continue;

      const type = line[0];
      const parts = line.substring(1).split('\t');

      if (parts.length >= 4) {
        items.push({
          type,
          display: parts[0],
          selector: parts[1],
          host: parts[2],
          port: parseInt(parts[3]) || 70,
        });
      } else if (type === 'i') {
        // Inline text (no tabs)
        items.push({
          type,
          display: line.substring(1),
          selector: '',
          host: '',
          port: 0,
        });
      }
    }

    return items;
  }

  async search(searchServer: string, query: string): Promise<GopherItem[]> {
    // Type 7 search servers append query with TAB
    const result = await this.fetch(`${searchServer}\t${query}`);
    return Array.isArray(result) ? result : [];
  }
}
```

## Web UI Design

```typescript
// src/components/GopherBrowser.tsx

export function GopherBrowser() {
  const [host, setHost] = useState('gopher.floodgap.com');
  const [port, setPort] = useState(70);
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState<GopherItem[]>([]);
  const [content, setContent] = useState<string>('');
  const [history, setHistory] = useState<string[]>(['/']);

  const navigate = async (selector: string = '', itemHost?: string, itemPort?: number) => {
    const response = await fetch('/api/gopher/fetch', {
      method: 'POST',
      body: JSON.stringify({
        host: itemHost || host,
        port: itemPort || port,
        selector,
      }),
    });

    const data = await response.json();

    if (data.isMenu) {
      setItems(data.items);
      setContent('');
      setHistory([...history, selector]);
    } else {
      setContent(data.content);
      setItems([]);
    }

    setCurrentPath(selector);
  };

  const back = () => {
    if (history.length > 1) {
      const newHistory = history.slice(0, -1);
      setHistory(newHistory);
      navigate(newHistory[newHistory.length - 1]);
    }
  };

  const getIcon = (type: string) => {
    const icons: Record<string, string> = {
      '0': '📄',
      '1': '📁',
      '7': '🔍',
      '9': '📦',
      'g': '🖼️',
      'I': '🖼️',
      'h': '🌐',
      'i': '💬',
    };
    return icons[type] || '📎';
  };

  return (
    <div className="gopher-browser retro-ui">
      <div className="toolbar">
        <button onClick={back} disabled={history.length <= 1}>
          ← Back
        </button>
        <input
          type="text"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
        />
        <button onClick={() => navigate()}>Go</button>
      </div>

      <div className="location-bar">
        gopher://{host}:{port}{currentPath}
      </div>

      {items.length > 0 ? (
        <div className="menu-list">
          {items.map((item, i) => (
            <div key={i} className="menu-item">
              {item.type === 'i' ? (
                <div className="info-text">{item.display}</div>
              ) : (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(item.selector, item.host, item.port);
                  }}
                >
                  {getIcon(item.type)} {item.display}
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="content-viewer">
          <pre>{content}</pre>
        </div>
      )}

      <div className="info-box">
        <h3>Gopherspace</h3>
        <p>
          You're browsing the pre-Web internet! Gopher was created in 1991
          at the University of Minnesota, three years before the Web.
        </p>
      </div>
    </div>
  );
}
```

## Testing

### Public Gopher Servers

```
gopher://gopher.floodgap.com/
gopher://gopher.club/
gopher://sdf.org/
gopher://gopher.quux.org/
```

### Test with Command Line

```bash
# Using netcat
echo "" | nc gopher.floodgap.com 70

# Using lynx browser
lynx gopher://gopher.floodgap.com/
```

## Resources

- **RFC 1436**: [Gopher Protocol](https://tools.ietf.org/html/rfc1436)
- **Floodgap**: [Gopher Archive](gopher://gopher.floodgap.com/)
- **Gopher Wikipedia**: [History](https://en.wikipedia.org/wiki/Gopher_(protocol))

## Notes

- **Pre-dates the Web** by 3 years (1991 vs 1994)
- **Still active!** Small but enthusiastic community
- **Simpler than HTTP** - no headers, cookies, etc.
- **Text-focused** with basic binary file support
- Great for **retro computing** enthusiasts
- Perfect **educational example** of early internet protocols
