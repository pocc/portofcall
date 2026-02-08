# Git Protocol Implementation Plan

## Overview

**Protocol:** Git Protocol (git://)
**Port:** 9418
**Specification:** [Git Protocol](https://git-scm.com/book/en/v2/Git-Internals-Transfer-Protocols)
**Complexity:** High
**Purpose:** Git repository access

The Git protocol enables **fast read-only access** to Git repositories. A browser-based client allows repository browsing, commit history viewing, and code exploration.

### Use Cases
- Browse Git repositories in browser
- View commit history and diffs
- Clone repositories to browser storage
- Code search across commits
- Educational - learn Git internals
- Repository exploration tool

## Protocol Specification

### Git Protocol Handshake

```
1. Client connects to port 9418

2. Client sends request:
   git-upload-pack /path/to/repo\0host=example.com\0

3. Server sends ref advertisement:
   0098sha1 refs/heads/master\0 capabilities...
   0042sha1 refs/heads/develop
   0000

4. Client sends want/have negotiation:
   want sha1
   want sha1
   have sha1
   done

5. Server sends packfile:
   [binary packfile data]
```

### Pkt-line Format

All communication uses "pkt-line" format:
- 4-byte hex length + data
- `0000` = flush packet
- Example: `0006a\n` = length 0006, data "a\n"

### Capabilities

| Capability | Description |
|-----------|-------------|
| multi_ack | Multiple acknowledgments |
| side-band-64k | Progress messages |
| ofs-delta | Offset deltas |
| thin-pack | Thin pack format |
| no-progress | Suppress progress |

## Worker Implementation

### Git Client

```typescript
// src/worker/protocols/git/client.ts

import { connect } from 'cloudflare:sockets';

export interface GitConfig {
  host: string;
  port: number;
  repo: string; // /path/to/repo.git
}

export interface GitRef {
  name: string;
  sha: string;
}

export class GitClient {
  private socket: Socket;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(private config: GitConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.host}:${this.config.port}`);
    await this.socket.opened;
  }

  async getRefs(): Promise<GitRef[]> {
    // Send git-upload-pack request
    const request = `git-upload-pack ${this.config.repo}\0host=${this.config.host}\0`;
    await this.sendPktLine(request);

    // Read ref advertisement
    const refs: GitRef[] = [];

    while (true) {
      const line = await this.readPktLine();

      if (line === null) break; // 0000 flush

      // Parse: "sha1 ref\0capabilities" or "sha1 ref"
      const parts = line.split(' ');
      if (parts.length >= 2) {
        const sha = parts[0];
        const ref = parts[1].split('\0')[0]; // Remove capabilities

        refs.push({ sha, name: ref });
      }
    }

    return refs;
  }

  async fetchObjects(wants: string[], haves: string[] = []): Promise<Uint8Array> {
    // Send wants
    for (const sha of wants) {
      await this.sendPktLine(`want ${sha} side-band-64k ofs-delta\n`);
    }

    await this.sendPktLine(null); // Flush

    // Send haves (if any)
    for (const sha of haves) {
      await this.sendPktLine(`have ${sha}\n`);
    }

    await this.sendPktLine('done\n');

    // Read packfile
    return this.readPackfile();
  }

  private async sendPktLine(data: string | null): Promise<void> {
    const writer = this.socket.writable.getWriter();

    if (data === null) {
      // Flush packet
      await writer.write(this.encoder.encode('0000'));
    } else {
      // Data packet
      const bytes = this.encoder.encode(data);
      const length = bytes.length + 4;
      const lengthHex = length.toString(16).padStart(4, '0');

      await writer.write(this.encoder.encode(lengthHex));
      await writer.write(bytes);
    }

    writer.releaseLock();
  }

  private async readPktLine(): Promise<string | null> {
    const reader = this.socket.readable.getReader();

    // Read 4-byte length
    const { value: lengthBytes } = await reader.read();
    const lengthStr = this.decoder.decode(lengthBytes.slice(0, 4));
    const length = parseInt(lengthStr, 16);

    if (length === 0) {
      // Flush packet
      reader.releaseLock();
      return null;
    }

    // Read data
    const dataLength = length - 4;
    const { value: dataBytes } = await reader.read();

    reader.releaseLock();

    return this.decoder.decode(dataBytes.slice(0, dataLength));
  }

  private async readPackfile(): Promise<Uint8Array> {
    const reader = this.socket.readable.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      chunks.push(value);
    }

    reader.releaseLock();

    // Concatenate chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  async close(): Promise<void> {
    await this.socket.close();
  }
}
```

## Web UI Design

### Git Repository Browser

```typescript
// src/components/GitBrowser.tsx

export function GitBrowser() {
  const [host, setHost] = useState('git.kernel.org');
  const [repo, setRepo] = useState('/pub/scm/git/git.git');
  const [refs, setRefs] = useState<GitRef[]>([]);
  const [loading, setLoading] = useState(false);

  const loadRefs = async () => {
    setLoading(true);

    const response = await fetch('/api/git/refs', {
      method: 'POST',
      body: JSON.stringify({ host, port: 9418, repo }),
    });

    const data = await response.json();
    setRefs(data.refs);
    setLoading(false);
  };

  return (
    <div className="git-browser">
      <h2>Git Repository Browser</h2>

      <div className="repo-input">
        <input
          type="text"
          placeholder="Git server"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          type="text"
          placeholder="Repository path"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        />
        <button onClick={loadRefs} disabled={loading}>
          {loading ? 'Loading...' : 'Browse'}
        </button>
      </div>

      <div className="refs-list">
        <h3>Branches & Tags</h3>

        <div className="refs-group">
          <h4>Branches</h4>
          {refs
            .filter(ref => ref.name.startsWith('refs/heads/'))
            .map(ref => (
              <div key={ref.name} className="ref-item">
                <span className="ref-name">
                  {ref.name.replace('refs/heads/', '')}
                </span>
                <span className="ref-sha">{ref.sha.substring(0, 7)}</span>
              </div>
            ))}
        </div>

        <div className="refs-group">
          <h4>Tags</h4>
          {refs
            .filter(ref => ref.name.startsWith('refs/tags/'))
            .map(ref => (
              <div key={ref.name} className="ref-item">
                <span className="ref-name">
                  {ref.name.replace('refs/tags/', '')}
                </span>
                <span className="ref-sha">{ref.sha.substring(0, 7)}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
```

## Security

### Read-Only Protocol

```typescript
// Git protocol (port 9418) is READ-ONLY by default
// No push capabilities - safe for public access
```

### Git over SSH

```typescript
// For write access, use Git over SSH instead
// This would use the SSH protocol implementation
```

## Testing

### Test with Public Git Servers

```bash
# Clone over git://
git clone git://git.kernel.org/pub/scm/git/git.git

# List refs manually
nc git.kernel.org 9418
git-upload-pack /pub/scm/git/git.git\0host=git.kernel.org\0
```

### Local Git Daemon

```bash
# Start git daemon
git daemon --reuseaddr --base-path=. --export-all --verbose

# Test
git clone git://localhost/myrepo.git
```

## Resources

- **Git Internals**: [Git Book - Transfer Protocols](https://git-scm.com/book/en/v2/Git-Internals-Transfer-Protocols)
- **Pack Format**: [Git Pack Format](https://git-scm.com/docs/pack-format)
- **Packfile**: [Understanding Git Packfiles](https://codewords.recurse.com/issues/three/unpacking-git-packfiles)

## Next Steps

1. Implement Git client for ref listing
2. Parse packfile format
3. Build commit history viewer
4. Add file tree browser
5. Support diff visualization
6. Create code search
7. Add clone to IndexedDB

## Notes

- Git protocol is **read-only**
- Good for **public repositories**
- Most Git servers also support **HTTP(S)** which may be easier
- Consider implementing **HTTP Smart Protocol** instead
- Parsing packfiles is **complex** - consider using existing library
- WebAssembly `libgit2` port might be useful
