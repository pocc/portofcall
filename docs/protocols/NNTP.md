# NNTP Protocol Implementation Plan

## Overview

**Protocol:** NNTP (Network News Transfer Protocol)
**Port:** 119 (TCP), 563 (NNTPS/TLS)
**RFC:** [RFC 3977](https://tools.ietf.org/html/rfc3977), [RFC 4642](https://tools.ietf.org/html/rfc4642) (TLS)
**Complexity:** Medium
**Purpose:** Usenet newsgroup access and distribution

NNTP enables **Usenet newsgroup access** - read and post articles to discussion groups, browse news hierarchies, and participate in distributed forums from the browser.

### Use Cases
- Usenet newsgroup reading
- Discussion forum access
- Binary file downloads (alt.binaries.*)
- News server administration
- Distributed forum systems
- Text-based communities

## Protocol Specification

### Text-Based Protocol

```
Client → Server: CAPABILITIES
Server → Client: 101 Capability list follows
                  VERSION 2
                  READER
                  POST
                  .

Client → Server: GROUP comp.lang.python
Server → Client: 211 12345 1000 13000 comp.lang.python

Client → Server: ARTICLE 12345
Server → Client: 220 12345 <article-id@host>
                  [article headers and body]
                  .
```

### Response Codes

| Code | Meaning |
|------|---------|
| 1xx | Informational |
| 2xx | Success |
| 3xx | Continuation needed |
| 4xx | Temporary failure |
| 5xx | Permanent failure |

### Common Commands

| Command | Description |
|---------|-------------|
| CAPABILITIES | List server capabilities |
| MODE READER | Switch to reader mode |
| LIST | List newsgroups |
| GROUP | Select newsgroup |
| LISTGROUP | List article numbers |
| ARTICLE | Retrieve article |
| HEAD | Retrieve article headers |
| BODY | Retrieve article body |
| STAT | Check article exists |
| POST | Post new article |
| NEXT | Move to next article |
| LAST | Move to previous article |
| QUIT | Close connection |

### Article Format

```
Path: news.example.com!news.server.com!not-for-mail
From: user@example.com (John Doe)
Newsgroups: comp.lang.python
Subject: How to parse XML?
Date: Mon, 15 Jan 2024 12:00:00 +0000
Message-ID: <abc123@example.com>
Content-Type: text/plain; charset=UTF-8

Article body text here.
Multiple lines supported.
```

## Worker Implementation

```typescript
// src/worker/protocols/nntp/client.ts

import { connect } from 'cloudflare:sockets';

export interface NNTPConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface Newsgroup {
  name: string;
  count: number;
  first: number;
  last: number;
  flags: string;
}

export interface Article {
  number: number;
  messageId: string;
  headers: Record<string, string>;
  body: string;
}

export class NNTPClient {
  private socket: any;
  private currentGroup?: string;
  private currentArticle?: number;

  constructor(private config: NNTPConfig) {}

  async connect(): Promise<void> {
    const port = this.config.port || 119;
    this.socket = connect(`${this.config.host}:${port}`);
    await this.socket.opened;

    // Read welcome message
    const welcome = await this.readResponse();
    console.log('NNTP:', welcome);

    // Authenticate if needed
    if (this.config.username && this.config.password) {
      await this.authenticate();
    }

    // Switch to reader mode
    await this.sendCommand('MODE READER');
  }

  async authenticate(): Promise<void> {
    await this.sendCommand(`AUTHINFO USER ${this.config.username}`);
    const userResp = await this.readResponse();

    if (userResp.startsWith('381')) {
      await this.sendCommand(`AUTHINFO PASS ${this.config.password}`);
      const passResp = await this.readResponse();

      if (!passResp.startsWith('281')) {
        throw new Error('Authentication failed');
      }
    }
  }

  async capabilities(): Promise<string[]> {
    await this.sendCommand('CAPABILITIES');
    const response = await this.readMultilineResponse();

    return response
      .split('\r\n')
      .filter(line => line && line !== '.');
  }

  async listNewsgroups(): Promise<Newsgroup[]> {
    await this.sendCommand('LIST');
    const response = await this.readMultilineResponse();

    const groups: Newsgroup[] = [];

    for (const line of response.split('\r\n')) {
      if (!line || line === '.') continue;

      const [name, last, first, flags] = line.split(' ');
      groups.push({
        name,
        count: parseInt(last) - parseInt(first) + 1,
        first: parseInt(first),
        last: parseInt(last),
        flags,
      });
    }

    return groups;
  }

  async selectGroup(name: string): Promise<{ count: number; first: number; last: number }> {
    await this.sendCommand(`GROUP ${name}`);
    const response = await this.readResponse();

    // 211 count first last group
    const match = response.match(/211 (\d+) (\d+) (\d+)/);
    if (!match) {
      throw new Error('Invalid GROUP response');
    }

    this.currentGroup = name;

    return {
      count: parseInt(match[1]),
      first: parseInt(match[2]),
      last: parseInt(match[3]),
    };
  }

  async listArticles(start?: number, end?: number): Promise<number[]> {
    let command = 'LISTGROUP';
    if (start && end) {
      command += ` ${start}-${end}`;
    } else if (start) {
      command += ` ${start}-`;
    }

    await this.sendCommand(command);
    const response = await this.readMultilineResponse();

    return response
      .split('\r\n')
      .filter(line => line && line !== '.')
      .map(line => parseInt(line));
  }

  async getArticle(identifier: number | string): Promise<Article> {
    await this.sendCommand(`ARTICLE ${identifier}`);
    const statusLine = await this.readResponse();

    if (!statusLine.startsWith('220')) {
      throw new Error('Article not found');
    }

    // Parse: 220 number message-id
    const match = statusLine.match(/220 (\d+) <([^>]+)>/);
    const number = match ? parseInt(match[1]) : 0;
    const messageId = match ? match[2] : '';

    const content = await this.readMultilineResponse();

    // Split headers and body
    const [headerSection, ...bodyParts] = content.split('\r\n\r\n');
    const body = bodyParts.join('\r\n\r\n');

    // Parse headers
    const headers: Record<string, string> = {};
    for (const line of headerSection.split('\r\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    return {
      number,
      messageId,
      headers,
      body,
    };
  }

  async getHeaders(identifier: number | string): Promise<Record<string, string>> {
    await this.sendCommand(`HEAD ${identifier}`);
    const statusLine = await this.readResponse();

    if (!statusLine.startsWith('221')) {
      throw new Error('Article not found');
    }

    const content = await this.readMultilineResponse();

    const headers: Record<string, string> = {};
    for (const line of content.split('\r\n')) {
      if (!line || line === '.') continue;

      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    return headers;
  }

  async getBody(identifier: number | string): Promise<string> {
    await this.sendCommand(`BODY ${identifier}`);
    const statusLine = await this.readResponse();

    if (!statusLine.startsWith('222')) {
      throw new Error('Article not found');
    }

    return await this.readMultilineResponse();
  }

  async post(article: { from: string; newsgroups: string; subject: string; body: string }): Promise<void> {
    await this.sendCommand('POST');
    const response = await this.readResponse();

    if (!response.startsWith('340')) {
      throw new Error('POST not allowed');
    }

    // Build article
    const headers = [
      `From: ${article.from}`,
      `Newsgroups: ${article.newsgroups}`,
      `Subject: ${article.subject}`,
      `Date: ${new Date().toUTCString()}`,
      '',
      article.body,
      '.',
    ].join('\r\n');

    await this.send(headers);

    const postResponse = await this.readResponse();
    if (!postResponse.startsWith('240')) {
      throw new Error('POST failed');
    }
  }

  async next(): Promise<number> {
    await this.sendCommand('NEXT');
    const response = await this.readResponse();

    // 223 number message-id
    const match = response.match(/223 (\d+)/);
    if (!match) {
      throw new Error('No next article');
    }

    this.currentArticle = parseInt(match[1]);
    return this.currentArticle;
  }

  async last(): Promise<number> {
    await this.sendCommand('LAST');
    const response = await this.readResponse();

    // 223 number message-id
    const match = response.match(/223 (\d+)/);
    if (!match) {
      throw new Error('No previous article');
    }

    this.currentArticle = parseInt(match[1]);
    return this.currentArticle;
  }

  private async sendCommand(command: string): Promise<void> {
    await this.send(command + '\r\n');
  }

  private async send(data: string): Promise<void> {
    const writer = this.socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(data));
    writer.releaseLock();
  }

  private async readResponse(): Promise<string> {
    const reader = this.socket.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!buffer.includes('\r\n')) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Connection closed');
      buffer += decoder.decode(value, { stream: true });
    }

    reader.releaseLock();

    const line = buffer.split('\r\n')[0];
    return line;
  }

  private async readMultilineResponse(): Promise<string> {
    const reader = this.socket.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Read until we see "\r\n.\r\n" (end marker)
    while (!buffer.includes('\r\n.\r\n')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }

    reader.releaseLock();

    // Remove the status line (first line)
    const lines = buffer.split('\r\n');
    lines.shift(); // Remove first line

    // Remove trailing "."
    const content = lines.slice(0, -1).join('\r\n');

    return content;
  }

  async close(): Promise<void> {
    await this.sendCommand('QUIT');
    await this.socket.close();
  }
}
```

## Web UI Design

```typescript
// src/components/NNTPClient.tsx

export function NNTPClient() {
  const [connected, setConnected] = useState(false);
  const [newsgroups, setNewsgroups] = useState<Newsgroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [articles, setArticles] = useState<number[]>([]);
  const [currentArticle, setCurrentArticle] = useState<Article | null>(null);

  const connect = async () => {
    await fetch('/api/nntp/connect', {
      method: 'POST',
      body: JSON.stringify({
        host: 'news.example.com',
        port: 119,
      }),
    });

    setConnected(true);
    loadNewsgroups();
  };

  const loadNewsgroups = async () => {
    const response = await fetch('/api/nntp/list');
    const data = await response.json();
    setNewsgroups(data.slice(0, 100)); // Limit display
  };

  const selectGroup = async (name: string) => {
    const response = await fetch('/api/nntp/group', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    const data = await response.json();
    setSelectedGroup(name);

    // Load recent articles
    loadArticles(data.last - 50, data.last);
  };

  const loadArticles = async (start: number, end: number) => {
    const response = await fetch('/api/nntp/listgroup', {
      method: 'POST',
      body: JSON.stringify({ start, end }),
    });

    const data = await response.json();
    setArticles(data);
  };

  const viewArticle = async (number: number) => {
    const response = await fetch('/api/nntp/article', {
      method: 'POST',
      body: JSON.stringify({ number }),
    });

    const article = await response.json();
    setCurrentArticle(article);
  };

  const postArticle = async (subject: string, body: string) => {
    await fetch('/api/nntp/post', {
      method: 'POST',
      body: JSON.stringify({
        from: 'user@example.com',
        newsgroups: selectedGroup,
        subject,
        body,
      }),
    });

    alert('Article posted');
  };

  return (
    <div className="nntp-client">
      <h2>Usenet News Reader</h2>

      {!connected ? (
        <button onClick={connect}>Connect to News Server</button>
      ) : (
        <>
          <div className="newsgroups">
            <h3>Newsgroups</h3>
            <input
              type="text"
              placeholder="Filter newsgroups..."
              onChange={(e) => {
                const filter = e.target.value.toLowerCase();
                // Filter logic
              }}
            />
            <ul>
              {newsgroups.map(group => (
                <li
                  key={group.name}
                  onClick={() => selectGroup(group.name)}
                  className={selectedGroup === group.name ? 'selected' : ''}
                >
                  📰 {group.name} ({group.count})
                </li>
              ))}
            </ul>
          </div>

          {selectedGroup && (
            <div className="articles">
              <h3>{selectedGroup}</h3>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Subject</th>
                    <th>From</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map(num => (
                    <tr key={num} onClick={() => viewArticle(num)}>
                      <td>{num}</td>
                      <td>Loading...</td>
                      <td>-</td>
                      <td>-</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {currentArticle && (
            <div className="article-view">
              <h3>{currentArticle.headers['Subject']}</h3>
              <div className="article-headers">
                <div><strong>From:</strong> {currentArticle.headers['From']}</div>
                <div><strong>Date:</strong> {currentArticle.headers['Date']}</div>
                <div><strong>Newsgroups:</strong> {currentArticle.headers['Newsgroups']}</div>
              </div>
              <div className="article-body">
                <pre>{currentArticle.body}</pre>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

## Security

### Authentication

```
AUTHINFO USER username
AUTHINFO PASS password
```

### TLS/SSL (NNTPS)

```
Port: 563
Use STARTTLS or direct TLS connection
```

## Testing

### Public News Servers

- `news.eternal-september.org` (free, registration required)
- `news.aioe.org` (free, no registration)

### INN (InterNetNews) Server

```bash
# Install INN server
apt-get install inn2

# Configure /etc/news/inn.conf
# Start server
service inn2 start
```

### Test with Telnet

```bash
# Connect to news server
telnet news.aioe.org 119

# Commands
CAPABILITIES
LIST
GROUP comp.lang.python
ARTICLE 12345
QUIT
```

## Resources

- **RFC 3977**: [NNTP Protocol](https://tools.ietf.org/html/rfc3977)
- **RFC 5536**: [Netnews Article Format](https://tools.ietf.org/html/rfc5536)
- **INN**: [InterNetNews server](https://www.eyrie.org/~eagle/software/inn/)

## Common Newsgroup Hierarchies

| Hierarchy | Description |
|-----------|-------------|
| comp.* | Computing topics |
| sci.* | Science topics |
| rec.* | Recreation topics |
| soc.* | Social issues |
| news.* | Usenet administration |
| alt.* | Alternative topics (anything goes) |
| misc.* | Miscellaneous topics |
| talk.* | Debates |

## Article Headers

| Header | Description |
|--------|-------------|
| From | Sender email/name |
| Newsgroups | Target newsgroups (comma-separated) |
| Subject | Article subject |
| Date | Publication date |
| Message-ID | Unique identifier |
| References | Reply thread |
| Organization | Sender's organization |
| Lines | Body line count |
| X-Newsreader | Client software |

## Notes

- **Text-based** protocol like SMTP
- **Distributed** - servers exchange articles
- **Historical** - Usenet since 1980
- **Still active** - niche communities
- **Binary files** via alt.binaries.* (uuencode/yenc)
- **Threading** via References header
- **Moderated groups** require approval
- **Retention** varies by server
- **No central authority** - decentralized
- **Spam filtering** important for binary groups
