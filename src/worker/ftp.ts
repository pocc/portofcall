/**
 * FTP Protocol Implementation for Cloudflare Workers
 * Supports passive mode FTP connections via Sockets API
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';

interface FTPConnectionParams {
  host: string;
  port: number;
  username: string;
  password: string;
}

interface FTPFile {
  name: string;
  size: number;
  type: 'file' | 'directory' | 'link' | 'other';
  modified: string;      // ISO 8601 when from MLSD/MDTM, otherwise raw LIST mtime
  permissions?: string;  // e.g. "rwxr-xr-x"
  links?: number;        // hard link count
  owner?: string;        // unix owner name
  group?: string;        // unix group name
  target?: string;       // symlink target if type === 'link'
  facts?: Record<string, string>;  // raw MLSD facts
}

interface FTPFeatures {
  raw: string[];
  mlsd: boolean;
  mdtm: boolean;
  size: boolean;
  utf8: boolean;
  tvfs: boolean;
  rest: boolean;  // restart transfers
}

/**
 * FTP Client using Cloudflare Workers Sockets API
 */
export class FTPClient {
  private host: string;
  private port: number;
  private username: string;
  private password: string;
  private controlSocket: Socket | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(params: FTPConnectionParams) {
    this.host = params.host;
    this.port = params.port;
    this.username = params.username;
    this.password = params.password;
  }

  /**
   * Connect and authenticate to FTP server
   */
  async connect(): Promise<void> {
    // Connect to control port
    this.controlSocket = connect(`${this.host}:${this.port}`);
    await this.controlSocket.opened;

    this.reader = this.controlSocket.readable.getReader();
    this.writer = this.controlSocket.writable.getWriter();

    // Read welcome message
    const welcome = await this.readResponse();
    if (!welcome.startsWith('220')) {
      throw new Error(`FTP connection failed: ${welcome}`);
    }

    // Send username
    await this.sendCommand(`USER ${this.username}`);
    const userResponse = await this.readResponse();

    if (!userResponse.startsWith('331')) {
      throw new Error(`Username rejected: ${userResponse}`);
    }

    // Send password
    await this.sendCommand(`PASS ${this.password}`);
    const passResponse = await this.readResponse();

    if (!passResponse.startsWith('230')) {
      throw new Error(`Authentication failed: ${passResponse}`);
    }

    // Set binary mode
    await this.sendCommand('TYPE I');
    await this.readResponse();
  }

  /**
   * Negotiate server capabilities via FEAT (RFC 2389)
   * Returns parsed feature set; throws if server does not support FEAT.
   */
  async feat(): Promise<FTPFeatures> {
    await this.sendCommand('FEAT');
    const response = await this.readResponse();

    // 211 is the FEAT response code; 500/502 means not supported
    if (response.startsWith('500') || response.startsWith('502')) {
      throw new Error(`FEAT not supported: ${response}`);
    }
    if (!response.startsWith('211')) {
      throw new Error(`FEAT failed: ${response}`);
    }

    // Parse feature list: lines between "211-Features:" and "211 End"
    const raw: string[] = [];
    for (const line of response.split('\n')) {
      const trimmed = line.trim();
      // Skip the opening and closing 211 lines
      if (trimmed.startsWith('211')) continue;
      if (trimmed.length > 0) raw.push(trimmed);
    }

    const upperRaw = raw.map(f => f.toUpperCase());
    return {
      raw,
      mlsd: upperRaw.some(f => f === 'MLSD' || f.startsWith('MLSD ')),
      mdtm: upperRaw.some(f => f === 'MDTM' || f.startsWith('MDTM ')),
      size: upperRaw.some(f => f === 'SIZE' || f.startsWith('SIZE ')),
      utf8: upperRaw.some(f => f === 'UTF8' || f.startsWith('UTF8 ')),
      tvfs: upperRaw.some(f => f === 'TVFS'),
      rest: upperRaw.some(f => f === 'REST STREAM' || f.startsWith('REST ')),
    };
  }

  /**
   * Get modification time of a remote file (RFC 3659 MDTM).
   * Returns ISO 8601 timestamp string.
   */
  async mdtm(remotePath: string): Promise<string> {
    await this.sendCommand(`MDTM ${remotePath}`);
    const response = await this.readResponse();

    if (!response.startsWith('213')) {
      throw new Error(`MDTM failed: ${response}`);
    }

    // Response: 213 YYYYMMDDHHmmss[.fraction]
    const match = response.match(/^213\s+(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (!match) {
      throw new Error(`Failed to parse MDTM response: ${response}`);
    }

    const [, yr, mo, dy, hh, mm, ss] = match;
    return `${yr}-${mo}-${dy}T${hh}:${mm}:${ss}Z`;
  }

  /**
   * Get file metadata without transferring the file: SIZE + MDTM combined.
   * Returns size in bytes and modification time as ISO 8601.
   */
  async stat(remotePath: string): Promise<{ size: number; modified: string }> {
    const [size, modified] = await Promise.all([
      this.size(remotePath),
      this.mdtm(remotePath),
    ]);
    return { size, modified };
  }

  /**
   * MLSD directory listing (RFC 3659) — machine-readable, structured facts.
   * Each entry has facts like type, size, modify, perm, unix.mode, unix.owner, unix.group.
   * Falls back gracefully: caller should catch and use list() instead.
   */
  async mlsd(path: string = '/'): Promise<FTPFile[]> {
    if (path !== '/') {
      await this.sendCommand(`CWD ${path}`);
      const cwdResponse = await this.readResponse();
      if (!cwdResponse.startsWith('250')) {
        throw new Error(`Failed to change directory: ${cwdResponse}`);
      }
    }

    const { host, port } = await this.enterPassiveMode();

    const dataSocket = connect(`${host}:${port}`);
    const dataOpened = dataSocket.opened;

    await this.sendCommand('MLSD');

    const [mlsdResponse] = await Promise.all([
      this.readResponse(),
      dataOpened,
    ]);

    if (!mlsdResponse.startsWith('150') && !mlsdResponse.startsWith('125')) {
      await dataSocket.close();
      throw new Error(`MLSD command failed: ${mlsdResponse}`);
    }

    const dataReader = dataSocket.readable.getReader();
    const chunks: Uint8Array[] = [];

    try {
      const timeout = 30000;
      while (true) {
        const readPromise = dataReader.read();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`MLSD data timeout after ${timeout}ms`)), timeout)
        );
        const { done, value } = await Promise.race([readPromise, timeoutPromise]);
        if (done) break;
        chunks.push(value);
      }
    } finally {
      try { dataReader.releaseLock(); } catch {}
      try { await dataSocket.close(); } catch {}
    }

    const transferCompleteMs = 10000;
    const mlsdComplete = await Promise.race([
      this.readResponse(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('FTP transfer complete response timeout')), transferCompleteMs)
      ),
    ]); // 226 Transfer Complete
    if (!mlsdComplete.startsWith('226')) {
      throw new Error(`MLSD transfer failed: ${mlsdComplete}`);
    }

    const listing = this.decoder.decode(this.concatenateChunks(chunks));
    return this.parseMlsdResponse(listing);
  }

  /**
   * NLST — returns bare filename list (no metadata).
   * Useful for scripted enumeration where you just need names.
   */
  async nlst(path: string = '/'): Promise<string[]> {
    const { host, port } = await this.enterPassiveMode();

    const dataSocket = connect(`${host}:${port}`);
    const dataOpened = dataSocket.opened;

    const cmd = path !== '/' ? `NLST ${path}` : 'NLST';
    await this.sendCommand(cmd);

    const [nlstResponse] = await Promise.all([
      this.readResponse(),
      dataOpened,
    ]);

    if (!nlstResponse.startsWith('150') && !nlstResponse.startsWith('125')) {
      await dataSocket.close();
      throw new Error(`NLST command failed: ${nlstResponse}`);
    }

    const dataReader = dataSocket.readable.getReader();
    const chunks: Uint8Array[] = [];

    try {
      const timeout = 30000;
      while (true) {
        const readPromise = dataReader.read();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`NLST data timeout after ${timeout}ms`)), timeout)
        );
        const { done, value } = await Promise.race([readPromise, timeoutPromise]);
        if (done) break;
        chunks.push(value);
      }
    } finally {
      try { dataReader.releaseLock(); } catch {}
      try { await dataSocket.close(); } catch {}
    }

    const transferCompleteMs = 10000;
    const nlstComplete = await Promise.race([
      this.readResponse(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('FTP transfer complete response timeout')), transferCompleteMs)
      ),
    ]); // 226
    if (!nlstComplete.startsWith('226')) {
      throw new Error(`NLST transfer failed: ${nlstComplete}`);
    }

    const listing = this.decoder.decode(this.concatenateChunks(chunks));
    return listing
      .split('\n')
      .map(l => l.trim().replace(/\r$/, ''))
      .filter(l => l.length > 0);
  }

  /**
   * Send a SITE command and return the raw server response text.
   * Power-user escape hatch for SITE CHMOD, SITE CHOWN, SITE EXEC, etc.
   */
  async site(command: string): Promise<string> {
    await this.sendCommand(`SITE ${command}`);
    return await this.readResponse();
  }

  /**
   * Enter passive mode and get data connection info
   */
  private async enterPassiveMode(): Promise<{ host: string; port: number }> {
    await this.sendCommand('PASV');
    const response = await this.readResponse();

    if (!response.startsWith('227')) {
      throw new Error(`Passive mode failed: ${response}`);
    }

    // Parse PASV response: 227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)
    const match = response.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
    if (!match) {
      throw new Error('Failed to parse PASV response');
    }

    const [, h1, h2, h3, h4, p1, p2] = match;
    const host = `${h1}.${h2}.${h3}.${h4}`;
    const p1Num = parseInt(p1);
    const p2Num = parseInt(p2);
    if (isNaN(p1Num) || isNaN(p2Num) || p1Num < 0 || p1Num > 255 || p2Num < 0 || p2Num > 255) {
      throw new Error('Invalid PASV response: port octets out of range');
    }
    const port = p1Num * 256 + p2Num;

    return { host, port };
  }

  /**
   * List directory contents.
   * When useMlsd=true (default false), attempts MLSD first and falls back to LIST.
   * Fixed: Data connection must be opened BEFORE sending LIST command
   */
  async list(path: string = '/', useMlsd = false): Promise<FTPFile[]> {
    if (useMlsd) {
      try {
        return await this.mlsd(path);
      } catch {
        // Fall through to LIST
      }
    }

    // Change to directory if not root
    if (path !== '/') {
      await this.sendCommand(`CWD ${path}`);
      const cwdResponse = await this.readResponse();
      if (!cwdResponse.startsWith('250')) {
        throw new Error(`Failed to change directory: ${cwdResponse}`);
      }
    }

    // Enter passive mode and get data connection info
    const { host, port } = await this.enterPassiveMode();

    // CRITICAL FIX: Open data socket BEFORE sending LIST command
    const dataSocket = connect(`${host}:${port}`);
    const dataOpened = dataSocket.opened;

    // Send LIST command while data socket is connecting
    await this.sendCommand('LIST');

    // Wait for BOTH data socket ready AND server response
    const [listResponse] = await Promise.all([
      this.readResponse(),
      dataOpened,
    ]);

    if (!listResponse.startsWith('150') && !listResponse.startsWith('125')) {
      await dataSocket.close();
      throw new Error(`LIST command failed: ${listResponse}`);
    }

    // Read directory listing from data socket with timeout
    const dataReader = dataSocket.readable.getReader();
    const chunks: Uint8Array[] = [];

    try {
      const dataTimeout = 30000; // 30 seconds for data transfer
      while (true) {
        const readPromise = dataReader.read();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Data transfer timeout after ${dataTimeout}ms`)), dataTimeout)
        );

        const { done, value } = await Promise.race([readPromise, timeoutPromise]);
        if (done) break;
        chunks.push(value);
      }
    } finally {
      try { dataReader.releaseLock(); } catch {}
      try { await dataSocket.close(); } catch {}
    }

    // CRITICAL: Read the 226 Transfer Complete response
    const transferCompleteMs = 10000;
    const completeResponse = await Promise.race([
      this.readResponse(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('FTP transfer complete response timeout')), transferCompleteMs)
      ),
    ]);
    if (!completeResponse.startsWith('226')) {
      throw new Error(`LIST transfer failed: ${completeResponse}`);
    }

    // Parse listing
    const listing = this.decoder.decode(this.concatenateChunks(chunks));
    return this.parseListingResponse(listing);
  }

  /**
   * Upload file to server
   */
  async upload(remotePath: string, fileData: Uint8Array): Promise<void> {
    // Enter passive mode
    const { host, port } = await this.enterPassiveMode();

    // Open data socket BEFORE sending STOR command
    const dataSocket = connect(`${host}:${port}`);
    const dataOpened = dataSocket.opened;

    // Send STOR command
    await this.sendCommand(`STOR ${remotePath}`);

    // Wait for both data socket ready and server response
    const [storResponse] = await Promise.all([
      this.readResponse(),
      dataOpened,
    ]);

    if (!storResponse.startsWith('150') && !storResponse.startsWith('125')) {
      await dataSocket.close();
      throw new Error(`STOR command failed: ${storResponse}`);
    }

    // Write file data to data socket
    const dataWriter = dataSocket.writable.getWriter();
    try {
      await dataWriter.write(fileData);
      await dataWriter.close();
    } finally {
      try { dataWriter.releaseLock(); } catch {}
      try { await dataSocket.close(); } catch {}
    }

    // Read transfer complete response
    const transferCompleteMs = 10000;
    const completeResponse = await Promise.race([
      this.readResponse(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('FTP transfer complete response timeout')), transferCompleteMs)
      ),
    ]);
    if (!completeResponse.startsWith('226')) {
      throw new Error(`Upload failed: ${completeResponse}`);
    }
  }

  /**
   * Download file from server
   */
  async download(remotePath: string): Promise<Uint8Array> {
    // Enter passive mode
    const { host, port } = await this.enterPassiveMode();

    // Open data socket BEFORE sending RETR command
    const dataSocket = connect(`${host}:${port}`);
    const dataOpened = dataSocket.opened;

    // Send RETR command
    await this.sendCommand(`RETR ${remotePath}`);

    // Wait for both data socket ready and server response
    const [retrResponse] = await Promise.all([
      this.readResponse(),
      dataOpened,
    ]);

    if (!retrResponse.startsWith('150') && !retrResponse.startsWith('125')) {
      await dataSocket.close();
      throw new Error(`RETR command failed: ${retrResponse}`);
    }

    // Read file data from data socket
    const dataReader = dataSocket.readable.getReader();
    const chunks: Uint8Array[] = [];

    try {
      const dataTimeout = 60000; // 60 seconds for file download
      while (true) {
        const readPromise = dataReader.read();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Download timeout after ${dataTimeout}ms`)), dataTimeout)
        );

        const { done, value } = await Promise.race([readPromise, timeoutPromise]);
        if (done) break;
        chunks.push(value);
      }
    } finally {
      try { dataReader.releaseLock(); } catch {}
      try { await dataSocket.close(); } catch {}
    }

    // Read transfer complete response
    const transferCompleteMs = 10000;
    const completeResponse = await Promise.race([
      this.readResponse(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('FTP transfer complete response timeout')), transferCompleteMs)
      ),
    ]);
    if (!completeResponse.startsWith('226')) {
      throw new Error(`Download incomplete: ${completeResponse}`);
    }

    return this.concatenateChunks(chunks);
  }

  /**
   * Delete file from server
   */
  async delete(remotePath: string): Promise<void> {
    await this.sendCommand(`DELE ${remotePath}`);
    const response = await this.readResponse();

    if (!response.startsWith('250')) {
      throw new Error(`Delete failed: ${response}`);
    }
  }

  /**
   * Create directory
   */
  async mkdir(dirPath: string): Promise<void> {
    await this.sendCommand(`MKD ${dirPath}`);
    const response = await this.readResponse();

    if (!response.startsWith('257')) {
      throw new Error(`Create directory failed: ${response}`);
    }
  }

  /**
   * Remove directory
   */
  async rmdir(dirPath: string): Promise<void> {
    await this.sendCommand(`RMD ${dirPath}`);
    const response = await this.readResponse();

    if (!response.startsWith('250')) {
      throw new Error(`Remove directory failed: ${response}`);
    }
  }

  /**
   * Rename file or directory
   */
  async rename(fromPath: string, toPath: string): Promise<void> {
    // Send RNFR (rename from)
    await this.sendCommand(`RNFR ${fromPath}`);
    const rnfrResponse = await this.readResponse();

    if (!rnfrResponse.startsWith('350')) {
      throw new Error(`Rename failed: ${rnfrResponse}`);
    }

    // Send RNTO (rename to)
    await this.sendCommand(`RNTO ${toPath}`);
    const rntoResponse = await this.readResponse();

    if (!rntoResponse.startsWith('250')) {
      throw new Error(`Rename failed: ${rntoResponse}`);
    }
  }

  /**
   * Get file size
   */
  async size(remotePath: string): Promise<number> {
    await this.sendCommand(`SIZE ${remotePath}`);
    const response = await this.readResponse();

    if (!response.startsWith('213')) {
      throw new Error(`SIZE command failed: ${response}`);
    }

    // Extract size from response: 213 1234567
    const match = response.match(/^213\s+(\d+)/);
    if (!match) {
      throw new Error('Failed to parse SIZE response');
    }

    return parseInt(match[1]);
  }

  /**
   * Get current working directory
   */
  async pwd(): Promise<string> {
    await this.sendCommand('PWD');
    const response = await this.readResponse();

    if (!response.startsWith('257')) {
      throw new Error(`PWD failed: ${response}`);
    }

    // Extract path from response: 257 "/path" is current directory
    const match = response.match(/"([^"]+)"/);
    return match ? match[1] : '/';
  }

  /**
   * Close connection, releasing reader/writer locks before closing the socket.
   * Safe to call multiple times or after an error.
   */
  async close(): Promise<void> {
    if (this.controlSocket) {
      try { await this.sendCommand('QUIT'); } catch { /* ignore if already closed */ }
      try { this.writer?.releaseLock(); } catch { /* already released */ }
      try { this.reader?.releaseLock(); } catch { /* already released */ }
      try { await this.controlSocket.close(); } catch { /* ignore close errors */ }
      this.controlSocket = null;
      this.reader = null;
      this.writer = null;
    }
  }

  /**
   * Send FTP command
   */
  private async sendCommand(command: string): Promise<void> {
    if (!this.writer) throw new Error('Not connected');
    await this.writer.write(this.encoder.encode(`${command}\r\n`));
  }

  /**
   * Read FTP response with timeout protection
   */
  private async readResponse(timeoutMs: number = 10000): Promise<string> {
    if (!this.reader) throw new Error('Not connected');

    let response = '';
    const chunks: Uint8Array[] = [];

    while (true) {
      // Add timeout to prevent infinite hanging
      const readPromise = this.reader.read();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`FTP response timeout after ${timeoutMs}ms`)), timeoutMs)
      );

      const { done, value } = await Promise.race([readPromise, timeoutPromise]);
      if (done) break;

      chunks.push(value);
      response = this.decoder.decode(this.concatenateChunks(chunks));

      // Check if we have a complete response (ends with \r\n)
      if (response.endsWith('\r\n')) {
        // Check for multi-line responses
        const lines = response.split('\r\n').filter(l => l.length > 0);
        const lastLine = lines[lines.length - 1];

        // Single line or last line of multi-line response
        if (lastLine.length >= 4 && lastLine[3] === ' ') {
          break;
        }
      }
    }

    return response.trim();
  }

  /**
   * Parse MLSD response (RFC 3659) into structured FTPFile entries.
   * Each line: "fact1=val1;fact2=val2; filename"
   */
  private parseMlsdResponse(listing: string): FTPFile[] {
    const files: FTPFile[] = [];

    for (const rawLine of listing.split('\n')) {
      const line = rawLine.trim().replace(/\r$/, '');
      if (!line) continue;

      // Split at first space that separates facts from name
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) continue;

      const factStr = line.slice(0, spaceIdx);
      const name = line.slice(spaceIdx + 1);

      const facts: Record<string, string> = {};
      for (const pair of factStr.split(';')) {
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        facts[pair.slice(0, eq).toLowerCase()] = pair.slice(eq + 1);
      }

      // Map MLSD type fact to our type
      const mlsdType = (facts['type'] || '').toLowerCase();
      let type: FTPFile['type'] = 'file';
      if (mlsdType === 'dir' || mlsdType === 'cdir' || mlsdType === 'pdir') {
        type = 'directory';
      } else if (mlsdType === 'os.unix=symlink' || mlsdType.includes('link')) {
        type = 'link';
      }

      // Parse modify fact: YYYYMMDDHHmmss[.fraction] → ISO 8601
      let modified = facts['modify'] || '';
      if (modified.length >= 14) {
        const yr = modified.slice(0, 4);
        const mo = modified.slice(4, 6);
        const dy = modified.slice(6, 8);
        const hh = modified.slice(8, 10);
        const mm = modified.slice(10, 12);
        const ss = modified.slice(12, 14);
        modified = `${yr}-${mo}-${dy}T${hh}:${mm}:${ss}Z`;
      }

      files.push({
        name,
        size: parseInt(facts['size'] || '0') || 0,
        type,
        modified,
        permissions: facts['unix.mode'] || facts['perm'] || undefined,
        owner: facts['unix.owner'] || facts['unix.uid'] || undefined,
        group: facts['unix.group'] || facts['unix.gid'] || undefined,
        facts,
      });
    }

    return files;
  }

  /**
   * Parse directory listing into structured format.
   * Handles Unix-style LIST output with full metadata extraction
   * (permissions, links, owner, group, size, mtime, symlink target).
   */
  private parseListingResponse(listing: string): FTPFile[] {
    const lines = listing.split('\n').filter(l => l.trim().length > 0);
    const files: FTPFile[] = [];

    for (const line of lines) {
      // Skip total line
      if (line.startsWith('total')) continue;

      const trimmed = line.trim();

      // DOS/Windows-style listing: "01-01-23  12:00AM  <DIR>  dirname"
      const dosMatch = trimmed.match(/^(\d{2}-\d{2}-\d{2,4})\s+(\d{2}:\d{2}(?:AM|PM))\s+(<DIR>|\d+)\s+(.+)$/i);
      if (dosMatch) {
        const [, date, time, sizeOrDir, name] = dosMatch;
        const isDir = sizeOrDir.toUpperCase() === '<DIR>';
        files.push({
          name,
          size: isDir ? 0 : parseInt(sizeOrDir) || 0,
          type: isDir ? 'directory' : 'file',
          modified: `${date} ${time}`,
        });
        continue;
      }

      // Unix-style listing (most common):
      // drwxr-xr-x 2 user group 4096 Jan 01 12:00 dirname
      // lrwxrwxrwx 1 user group   12 Jan 01 12:00 link -> target
      const parts = trimmed.split(/\s+/);
      if (parts.length < 9) continue;

      const permissions = parts[0];
      const links = parseInt(parts[1]) || undefined;
      const owner = parts[2];
      const group = parts[3];
      const size = parseInt(parts[4]) || 0;
      // Modified time: e.g. "Jan 01 12:00" or "Jan 01 2023"
      const modified = `${parts[5]} ${parts[6]} ${parts[7]}`;

      // Name may include symlink target "link -> target"
      const namePart = parts.slice(8).join(' ');
      let name = namePart;
      let target: string | undefined;

      const firstChar = permissions[0];
      let type: FTPFile['type'] = 'file';
      if (firstChar === 'd') {
        type = 'directory';
      } else if (firstChar === 'l') {
        type = 'link';
        const arrowIdx = namePart.indexOf(' -> ');
        if (arrowIdx !== -1) {
          name = namePart.slice(0, arrowIdx);
          target = namePart.slice(arrowIdx + 4);
        }
      } else if (firstChar !== '-') {
        type = 'other'; // block/char device, socket, pipe, etc.
      }

      // Strip leading permission character, expose as "rwxr-xr-x"
      const permStr = permissions.slice(1);

      files.push({
        name,
        size,
        type,
        modified,
        permissions: permStr,
        links,
        owner,
        group,
        target,
      });
    }

    return files;
  }

  /**
   * Concatenate Uint8Array chunks
   */
  private concatenateChunks(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }
}

/**
 * Handle FTP connection request
 */
export async function handleFTPConnect(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    // Support both POST (with JSON body) and GET (with query params)
    let host: string, port: number, username: string, password: string;

    if (request.method === 'POST') {
      const body = await request.json() as { host: string; port: number; username: string; password: string };
      ({ host, port, username, password } = body);
    } else {
      host = url.searchParams.get('host') || '';
      port = parseInt(url.searchParams.get('port') || '21');
      username = url.searchParams.get('username') || '';
      password = url.searchParams.get('password') || '';
    }

    if (!host || !username || !password) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(JSON.stringify({
        success: false,
        error: getCloudflareErrorMessage(host, cfCheck.ip),
        isCloudflare: true,
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = new FTPClient({ host, port, username, password });
    await client.connect();
    try {

      const pwd = await client.pwd();


      return new Response(JSON.stringify({
        success: true,
        message: 'Connected successfully',
        currentDirectory: pwd,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle FTP list directory request.
 * Accepts optional `mlsd=true` param to attempt MLSD before falling back to LIST.
 */
export async function handleFTPList(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    // Get connection params
    let host: string, port: number, username: string, password: string, path: string, useMlsd: boolean;

    if (request.method === 'POST') {
      const body = await request.json() as { host?: string; port?: number; username?: string; password?: string; path?: string; mlsd?: boolean };
      host = body.host || '';
      port = body.port || 21;
      username = body.username || '';
      password = body.password || '';
      path = body.path || '/';
      useMlsd = body.mlsd ?? false;
    } else {
      host = url.searchParams.get('host') || '';
      port = parseInt(url.searchParams.get('port') || '21');
      username = url.searchParams.get('username') || '';
      password = url.searchParams.get('password') || '';
      path = url.searchParams.get('path') || '/';
      useMlsd = url.searchParams.get('mlsd') === 'true';
    }

    if (!host || !username || !password) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = new FTPClient({ host, port, username, password });
    await client.connect();
    try {

      const files = await client.list(path, useMlsd);


      return new Response(JSON.stringify({
        success: true,
        path,
        mode: useMlsd ? 'mlsd' : 'list',
        files,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'List failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle FTP FEAT negotiation.
 * POST/GET /api/ftp/feat — returns parsed server capability set.
 */
export async function handleFTPFeat(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    let host: string, port: number, username: string, password: string;

    if (request.method === 'POST') {
      const body = await request.json() as { host: string; port?: number; username: string; password: string };
      host = body.host;
      port = body.port || 21;
      username = body.username;
      password = body.password;
    } else {
      host = url.searchParams.get('host') || '';
      port = parseInt(url.searchParams.get('port') || '21');
      username = url.searchParams.get('username') || '';
      password = url.searchParams.get('password') || '';
    }

    if (!host || !username || !password) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = new FTPClient({ host, port, username, password });
    await client.connect();
    try {

      const features = await client.feat();


      return new Response(JSON.stringify({
        success: true,
        features,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'FEAT failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle FTP file stat (SIZE + MDTM) without transferring the file.
 * POST/GET /api/ftp/stat — returns size and ISO 8601 modification time.
 */
export async function handleFTPStat(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    let host: string, port: number, username: string, password: string, remotePath: string;

    if (request.method === 'POST') {
      const body = await request.json() as { host: string; port?: number; username: string; password: string; remotePath: string };
      host = body.host;
      port = body.port || 21;
      username = body.username;
      password = body.password;
      remotePath = body.remotePath;
    } else {
      host = url.searchParams.get('host') || '';
      port = parseInt(url.searchParams.get('port') || '21');
      username = url.searchParams.get('username') || '';
      password = url.searchParams.get('password') || '';
      remotePath = url.searchParams.get('remotePath') || '';
    }

    if (!host || !username || !password || !remotePath) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password, remotePath',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = new FTPClient({ host, port, username, password });
    await client.connect();
    try {

      const fileStat = await client.stat(remotePath);


      return new Response(JSON.stringify({
        success: true,
        path: remotePath,
        ...fileStat,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Stat failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle FTP NLST (name list) request.
 * POST/GET /api/ftp/nlst — returns bare filename array.
 */
export async function handleFTPNlst(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    let host: string, port: number, username: string, password: string, path: string;

    if (request.method === 'POST') {
      const body = await request.json() as { host: string; port?: number; username: string; password: string; path?: string };
      host = body.host;
      port = body.port || 21;
      username = body.username;
      password = body.password;
      path = body.path || '/';
    } else {
      host = url.searchParams.get('host') || '';
      port = parseInt(url.searchParams.get('port') || '21');
      username = url.searchParams.get('username') || '';
      password = url.searchParams.get('password') || '';
      path = url.searchParams.get('path') || '/';
    }

    if (!host || !username || !password) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = new FTPClient({ host, port, username, password });
    await client.connect();
    try {

      const names = await client.nlst(path);


      return new Response(JSON.stringify({
        success: true,
        path,
        names,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'NLST failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle FTP SITE command passthrough.
 * POST /api/ftp/site — power-user escape hatch for SITE CHMOD, SITE CHOWN, etc.
 * Body: { host, port, username, password, command: "CHMOD 755 /path/to/file" }
 */
export async function handleFTPSite(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await request.json() as { host: string; port?: number; username: string; password: string; command: string };
    const { host, port = 21, username, password, command } = body;

    if (!host || !username || !password || !command) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password, command',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = new FTPClient({ host, port, username, password });
    await client.connect();
    try {
      const response = await client.site(command);

      // SITE responses: 200 OK, 202 Not implemented, 500 error
      const success = response.startsWith('200') || response.startsWith('250');

      return new Response(JSON.stringify({
        success,
        response,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'SITE command failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle FTP file upload request
 */
export async function handleFTPUpload(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const formData = await request.formData();
    const host = formData.get('host') as string;
    const port = parseInt(formData.get('port') as string || '21');
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;
    const remotePath = formData.get('remotePath') as string;
    const file = formData.get('file') as File;

    if (!host || !username || !password || !remotePath || !file) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password, remotePath, file',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const fileData = new Uint8Array(await file.arrayBuffer());

    const client = new FTPClient({ host, port, username, password });
    await client.connect();
    try {

      await client.upload(remotePath, fileData);


      return new Response(JSON.stringify({
        success: true,
        message: `Uploaded ${file.name} to ${remotePath}`,
        size: fileData.length,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle FTP file download request
 */
export async function handleFTPDownload(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    let host: string, port: number, username: string, password: string, remotePath: string;

    if (request.method === 'POST') {
      const body = await request.json() as { host: string; port?: number; username: string; password: string; remotePath: string };
      host = body.host;
      port = body.port || 21;
      username = body.username;
      password = body.password;
      remotePath = body.remotePath;
    } else {
      host = url.searchParams.get('host') || '';
      port = parseInt(url.searchParams.get('port') || '21');
      username = url.searchParams.get('username') || '';
      password = url.searchParams.get('password') || '';
      remotePath = url.searchParams.get('remotePath') || '';
    }

    if (!host || !username || !password || !remotePath) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password, remotePath',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = new FTPClient({ host, port, username, password });
    await client.connect();
    try {
      const fileData = await client.download(remotePath);

      // Extract filename from path
      const filename = remotePath.split('/').pop() || 'download';

      // Create a proper ArrayBuffer for Response
      const buffer = new ArrayBuffer(fileData.length);
      const view = new Uint8Array(buffer);
      view.set(fileData);

      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': fileData.length.toString(),
        },
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Download failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle FTP file delete request
 */
export async function handleFTPDelete(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await request.json() as { host: string; port?: number; username: string; password: string; remotePath: string };
    const { host, port = 21, username, password, remotePath } = body;

    if (!host || !username || !password || !remotePath) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password, remotePath',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = new FTPClient({ host, port, username, password });
    await client.connect();
    try {

      await client.delete(remotePath);


      return new Response(JSON.stringify({
        success: true,
        message: `Deleted ${remotePath}`,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Delete failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle FTP create directory request
 */
export async function handleFTPMkdir(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await request.json() as { host: string; port?: number; username: string; password: string; dirPath: string };
    const { host, port = 21, username, password, dirPath } = body;

    if (!host || !username || !password || !dirPath) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password, dirPath',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = new FTPClient({ host, port, username, password });
    await client.connect();
    try {

      await client.mkdir(dirPath);


      return new Response(JSON.stringify({
        success: true,
        message: `Created directory ${dirPath}`,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Create directory failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handle FTP rename request
 */
export async function handleFTPRename(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await request.json() as { host: string; port?: number; username: string; password: string; fromPath: string; toPath: string };
    const { host, port = 21, username, password, fromPath, toPath } = body;

    if (!host || !username || !password || !fromPath || !toPath) {
      return new Response(JSON.stringify({
        error: 'Missing required parameters: host, username, password, fromPath, toPath',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const client = new FTPClient({ host, port, username, password });
    await client.connect();
    try {

      await client.rename(fromPath, toPath);


      return new Response(JSON.stringify({
        success: true,
        message: `Renamed ${fromPath} to ${toPath}`,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Rename failed',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
