/**
 * Gopher Protocol Implementation (RFC 1436)
 *
 * Gopher is a 1991 pre-Web hypertext browsing protocol from the University
 * of Minnesota. It provides document retrieval with a hierarchical menu
 * structure — a fascinating piece of internet history.
 *
 * Protocol Flow:
 * 1. Client connects to server port 70
 * 2. Client sends selector string followed by CRLF
 * 3. Server responds with menu items or file content
 * 4. Server closes connection
 *
 * Menu Item Format:
 *   TypeDisplayName\tSelector\tHost\tPort\r\n
 *
 * Item Types:
 *   0 = Text file, 1 = Directory, 3 = Error, 7 = Search,
 *   9 = Binary, g = GIF, I = Image, h = HTML, i = Info text
 */

import { connect } from 'cloudflare:sockets';

export interface GopherItem {
  type: string;
  display: string;
  selector: string;
  host: string;
  port: number;
}

interface GopherFetchRequest {
  host: string;
  port?: number;
  selector?: string;
  query?: string;
  timeout?: number;
}

interface GopherFetchResponse {
  success: boolean;
  isMenu: boolean;
  items?: GopherItem[];
  content?: string;
  selector?: string;
  error?: string;
}

/**
 * Validate Gopher request inputs
 */
function validateGopherInput(host: string, port: number, selector: string): string | null {
  if (!host || host.trim().length === 0) {
    return 'Host is required';
  }

  if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
    return 'Host contains invalid characters';
  }

  if (port < 1 || port > 65535) {
    return 'Port must be between 1 and 65535';
  }

  // Selector should not contain control characters except tab (used in search queries)
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(selector)) {
    return 'Selector contains invalid control characters';
  }

  // Limit selector length
  if (selector.length > 1024) {
    return 'Selector too long (max 1024 characters)';
  }

  return null;
}

/**
 * Parse a Gopher menu response into structured items
 */
function parseGopherMenu(content: string): GopherItem[] {
  const items: GopherItem[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // End of menu marker
    if (line === '.' || line === '.\r') break;
    if (line.trim().length === 0) continue;

    const type = line[0];
    const rest = line.substring(1);
    const parts = rest.split('\t');

    if (parts.length >= 4) {
      items.push({
        type,
        display: parts[0],
        selector: parts[1],
        host: parts[2],
        port: parseInt(parts[3].replace(/\r$/, '')) || 70,
      });
    } else if (type === 'i') {
      // Info text lines may have fewer fields
      items.push({
        type: 'i',
        display: parts[0] || '',
        selector: '',
        host: '',
        port: 0,
      });
    }
  }

  return items;
}

/**
 * Determine if a response looks like a Gopher menu vs plain text/binary
 */
function looksLikeMenu(content: string): boolean {
  const lines = content.split('\n');
  let menuLineCount = 0;
  let totalNonEmpty = 0;

  for (const line of lines) {
    if (line === '.' || line === '.\r') continue;
    if (line.trim().length === 0) continue;
    totalNonEmpty++;

    // Check if line starts with a valid Gopher type character and has tab-separated fields
    if (line.length > 1 && /^[0-9giIhsTpw+]/.test(line) && line.includes('\t')) {
      menuLineCount++;
    }
  }

  // If more than half of non-empty lines look like menu items, treat as menu
  return totalNonEmpty > 0 && menuLineCount / totalNonEmpty > 0.5;
}

/**
 * Handle Gopher fetch request - retrieves a selector from a Gopher server
 *
 * POST /api/gopher/fetch
 * Body: { host, port?, selector?, query?, timeout? }
 */
export async function handleGopherFetch(request: Request): Promise<Response> {
  try {
    const body = await request.json() as GopherFetchRequest;
    const {
      host,
      port = 70,
      selector = '',
      query,
      timeout = 10000,
    } = body;

    // Validate inputs
    const validationError = validateGopherInput(host, port, selector);
    if (validationError) {
      return new Response(JSON.stringify({
        success: false,
        isMenu: false,
        error: validationError,
      } satisfies GopherFetchResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build the request string
    // For search queries (type 7), append query with tab separator
    let requestString = selector;
    if (query) {
      requestString += `\t${query}`;
    }
    requestString += '\r\n';

    // Connect to Gopher server
    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Send selector
      await writer.write(new TextEncoder().encode(requestString));
      writer.releaseLock();

      // Read response
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxResponseSize = 512000; // 512KB limit

      try {
        while (true) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);

          if (done) break;

          if (value) {
            chunks.push(value);
            totalBytes += value.length;

            if (totalBytes > maxResponseSize) {
              throw new Error('Response too large (max 512KB)');
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Connection timeout') {
          throw error;
        }
        // Server closed connection - normal for Gopher
      }

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const responseText = new TextDecoder().decode(combined);

      reader.releaseLock();
      socket.close();

      // Determine if this is a menu or content
      const isMenu = looksLikeMenu(responseText);

      const result: GopherFetchResponse = {
        success: true,
        isMenu,
        selector,
      };

      if (isMenu) {
        result.items = parseGopherMenu(responseText);
      } else {
        result.content = responseText;
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      socket.close();
      throw error;
    }

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      isMenu: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    } satisfies GopherFetchResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
