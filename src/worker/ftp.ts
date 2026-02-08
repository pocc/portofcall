/**
 * FTP Protocol Implementation for Cloudflare Workers
 * Supports passive mode FTP connections via Sockets API
 */

import { connect } from 'cloudflare:sockets';

interface FTPConnectionParams {
  host: string;
  port: number;
  username: string;
  password: string;
}

interface FTPFile {
  name: string;
  size: number;
  type: 'file' | 'directory';
  modified: string;
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
    const port = parseInt(p1) * 256 + parseInt(p2);

    return { host, port };
  }

  /**
   * List directory contents
   */
  async list(path: string = '/'): Promise<FTPFile[]> {
    // Change to directory if not root
    if (path !== '/') {
      await this.sendCommand(`CWD ${path}`);
      const cwdResponse = await this.readResponse();
      if (!cwdResponse.startsWith('250')) {
        throw new Error(`Failed to change directory: ${cwdResponse}`);
      }
    }

    // Enter passive mode
    const { host, port } = await this.enterPassiveMode();

    // Send LIST command
    await this.sendCommand('LIST');
    const listResponse = await this.readResponse();

    if (!listResponse.startsWith('150') && !listResponse.startsWith('125')) {
      throw new Error(`LIST command failed: ${listResponse}`);
    }

    // Connect to data port
    const dataSocket = connect(`${host}:${port}`);
    await dataSocket.opened;

    // Read directory listing
    const dataReader = dataSocket.readable.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await dataReader.read();
      if (done) break;
      chunks.push(value);
    }

    await dataSocket.close();

    // Wait for transfer complete response
    await this.readResponse();

    // Parse listing
    const listing = this.decoder.decode(this.concatenateChunks(chunks));
    return this.parseListingResponse(listing);
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
   * Close connection
   */
  async close(): Promise<void> {
    if (this.controlSocket) {
      await this.sendCommand('QUIT');
      await this.controlSocket.close();
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
   * Read FTP response
   */
  private async readResponse(): Promise<string> {
    if (!this.reader) throw new Error('Not connected');

    let response = '';
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await this.reader.read();
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
   * Parse directory listing into structured format
   */
  private parseListingResponse(listing: string): FTPFile[] {
    const lines = listing.split('\n').filter(l => l.trim().length > 0);
    const files: FTPFile[] = [];

    for (const line of lines) {
      // Skip total line
      if (line.startsWith('total')) continue;

      // Parse Unix-style listing (most common)
      // Example: drwxr-xr-x 2 user group 4096 Jan 01 12:00 dirname
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const permissions = parts[0];
      const size = parseInt(parts[4]) || 0;
      const name = parts.slice(8).join(' ');
      const type = permissions.startsWith('d') ? 'directory' : 'file';
      const modified = `${parts[5]} ${parts[6]} ${parts[7]}`;

      files.push({ name, size, type, modified });
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

    const client = new FTPClient({ host, port, username, password });
    await client.connect();

    const pwd = await client.pwd();

    await client.close();

    return new Response(JSON.stringify({
      success: true,
      message: 'Connected successfully',
      currentDirectory: pwd,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
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
 * Handle FTP list directory request
 */
export async function handleFTPList(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    // Get connection params
    let host: string, port: number, username: string, password: string, path: string;

    if (request.method === 'POST') {
      const body = await request.json() as { host?: string; port?: number; username?: string; password?: string; path?: string };
      host = body.host || '';
      port = body.port || 21;
      username = body.username || '';
      password = body.password || '';
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

    const files = await client.list(path);

    await client.close();

    return new Response(JSON.stringify({
      success: true,
      path,
      files,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
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
