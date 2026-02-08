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
   * Fixed: Data connection must be opened BEFORE sending LIST command
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
      await dataSocket.close();
    }

    // CRITICAL: Read the 226 Transfer Complete response
    const completeResponse = await this.readResponse();
    if (!completeResponse.startsWith('226')) {
      console.warn(`Expected 226 Transfer Complete, got: ${completeResponse}`);
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
    } finally {
      await dataWriter.close();
      await dataSocket.close();
    }

    // Read transfer complete response
    const completeResponse = await this.readResponse();
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
      await dataSocket.close();
    }

    // Read transfer complete response
    const completeResponse = await this.readResponse();
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

    await client.upload(remotePath, fileData);

    await client.close();

    return new Response(JSON.stringify({
      success: true,
      message: `Uploaded ${file.name} to ${remotePath}`,
      size: fileData.length,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
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

    const fileData = await client.download(remotePath);

    await client.close();

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

    await client.delete(remotePath);

    await client.close();

    return new Response(JSON.stringify({
      success: true,
      message: `Deleted ${remotePath}`,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
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

    await client.mkdir(dirPath);

    await client.close();

    return new Response(JSON.stringify({
      success: true,
      message: `Created directory ${dirPath}`,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
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

    await client.rename(fromPath, toPath);

    await client.close();

    return new Response(JSON.stringify({
      success: true,
      message: `Renamed ${fromPath} to ${toPath}`,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
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
