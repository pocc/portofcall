/**
 * STOMP Protocol Implementation (STOMP 1.2)
 *
 * STOMP (Simple Text Oriented Messaging Protocol) enables communication with
 * message brokers like RabbitMQ, ActiveMQ, and Apollo using a simple
 * text-based frame format.
 *
 * Frame Format:
 *   COMMAND\n
 *   header1:value1\n
 *   header2:value2\n
 *   \n
 *   Body\0
 *
 * Client Commands: CONNECT, SEND, SUBSCRIBE, UNSUBSCRIBE, DISCONNECT, ACK, NACK
 * Server Frames: CONNECTED, MESSAGE, RECEIPT, ERROR
 */

import { connect } from 'cloudflare:sockets';

interface StompConnectRequest {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  vhost?: string;
  timeout?: number;
}

interface StompSendRequest {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  vhost?: string;
  destination: string;
  body: string;
  contentType?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

interface StompFrame {
  command: string;
  headers: Record<string, string>;
  body: string;
}

const NULL_BYTE = '\x00';

/**
 * Build a STOMP frame string
 */
function buildFrame(command: string, headers: Record<string, string>, body: string = ''): string {
  let frame = command + '\n';
  for (const [key, value] of Object.entries(headers)) {
    frame += `${key}:${value}\n`;
  }
  frame += '\n';
  frame += body;
  frame += NULL_BYTE;
  return frame;
}

/**
 * Parse a STOMP frame from text
 */
function parseFrame(text: string): StompFrame {
  // Remove trailing NULL byte if present
  const cleaned = text.replace(/\x00$/, '');
  const lines = cleaned.split('\n');

  const command = lines[0] || '';
  const headers: Record<string, string> = {};
  let bodyStartIndex = 1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') {
      bodyStartIndex = i + 1;
      break;
    }
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      headers[line.substring(0, colonIndex)] = line.substring(colonIndex + 1);
    }
  }

  const body = lines.slice(bodyStartIndex).join('\n');

  return { command, headers, body };
}

/**
 * Validate STOMP request inputs
 */
function validateStompInput(host: string, port: number): string | null {
  if (!host || host.trim().length === 0) {
    return 'Host is required';
  }

  if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
    return 'Host contains invalid characters';
  }

  if (port < 1 || port > 65535) {
    return 'Port must be between 1 and 65535';
  }

  return null;
}

/**
 * Perform a TCP connection to a STOMP broker, send CONNECT frame,
 * and return the CONNECTED response.
 *
 * POST /api/stomp/connect
 */
export async function handleStompConnect(request: Request): Promise<Response> {
  try {
    const body = await request.json() as StompConnectRequest;
    const {
      host,
      port = 61613,
      username,
      password,
      vhost,
      timeout = 10000,
    } = body;

    const validationError = validateStompInput(host, port);
    if (validationError) {
      return new Response(JSON.stringify({
        success: false,
        error: validationError,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Build CONNECT frame
      const connectHeaders: Record<string, string> = {
        'accept-version': '1.0,1.1,1.2',
        'host': vhost || host,
        'heart-beat': '0,0',
      };

      if (username) {
        connectHeaders['login'] = username;
      }
      if (password) {
        connectHeaders['passcode'] = password;
      }

      const connectFrame = buildFrame('CONNECT', connectHeaders);
      await writer.write(new TextEncoder().encode(connectFrame));
      writer.releaseLock();

      // Read response (CONNECTED or ERROR frame)
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maxSize = 16384; // 16KB max for handshake response

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

            if (totalBytes > maxSize) {
              throw new Error('Response too large');
            }

            // Check if we have a complete frame (contains NULL byte)
            const partial = new TextDecoder().decode(value);
            if (partial.includes(NULL_BYTE)) {
              break;
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Connection timeout') {
          throw error;
        }
      }

      // Combine chunks
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const responseText = new TextDecoder().decode(combined);

      // Send DISCONNECT
      try {
        const disconnWriter = socket.writable.getWriter();
        await disconnWriter.write(new TextEncoder().encode(buildFrame('DISCONNECT', { receipt: 'disconnect-receipt' })));
        disconnWriter.releaseLock();
      } catch {
        // Ignore disconnect errors
      }

      reader.releaseLock();
      socket.close();

      // Parse the response frame
      const frameText = responseText.split(NULL_BYTE)[0];
      const frame = parseFrame(frameText);

      if (frame.command === 'CONNECTED') {
        return new Response(JSON.stringify({
          success: true,
          version: frame.headers['version'] || '1.0',
          server: frame.headers['server'] || 'Unknown',
          heartBeat: frame.headers['heart-beat'] || '0,0',
          sessionId: frame.headers['session'] || '',
          headers: frame.headers,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (frame.command === 'ERROR') {
        return new Response(JSON.stringify({
          success: false,
          error: frame.body || frame.headers['message'] || 'STOMP ERROR received',
          headers: frame.headers,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({
          success: false,
          error: `Unexpected response: ${frame.command}`,
          rawResponse: responseText.substring(0, 500),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Connect to a STOMP broker, send a message, and disconnect.
 *
 * POST /api/stomp/send
 */
export async function handleStompSend(request: Request): Promise<Response> {
  try {
    const body = await request.json() as StompSendRequest;
    const {
      host,
      port = 61613,
      username,
      password,
      vhost,
      destination,
      body: messageBody,
      contentType = 'text/plain',
      headers: customHeaders = {},
      timeout = 10000,
    } = body;

    const validationError = validateStompInput(host, port);
    if (validationError) {
      return new Response(JSON.stringify({
        success: false,
        error: validationError,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!destination) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Destination is required (e.g., /queue/test or /topic/test)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!messageBody && messageBody !== '') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Message body is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate destination format
    if (!/^\/[a-zA-Z0-9/_.-]+$/.test(destination)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid destination format (must start with / e.g., /queue/test)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeout);
    });

    try {
      await Promise.race([socket.opened, timeoutPromise]);

      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // Step 1: CONNECT
      const connectHeaders: Record<string, string> = {
        'accept-version': '1.0,1.1,1.2',
        'host': vhost || host,
        'heart-beat': '0,0',
      };

      if (username) connectHeaders['login'] = username;
      if (password) connectHeaders['passcode'] = password;

      await writer.write(new TextEncoder().encode(buildFrame('CONNECT', connectHeaders)));

      // Read CONNECTED response
      let responseBuffer = '';
      try {
        while (!responseBuffer.includes(NULL_BYTE)) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);
          if (done) break;
          if (value) {
            responseBuffer += new TextDecoder().decode(value, { stream: true });
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Connection timeout') {
          throw error;
        }
      }

      const connFrame = parseFrame(responseBuffer.split(NULL_BYTE)[0]);
      if (connFrame.command !== 'CONNECTED') {
        writer.releaseLock();
        reader.releaseLock();
        socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: connFrame.command === 'ERROR'
            ? (connFrame.body || connFrame.headers['message'] || 'Connection rejected')
            : `Unexpected response: ${connFrame.command}`,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Step 2: SEND message
      const bodyByteLength = new TextEncoder().encode(messageBody).length;
      const sendHeaders: Record<string, string> = {
        destination,
        'content-type': contentType,
        'content-length': String(bodyByteLength),
        receipt: 'send-receipt',
        ...customHeaders,
      };

      await writer.write(new TextEncoder().encode(buildFrame('SEND', sendHeaders, messageBody)));

      // Read RECEIPT or ERROR
      let receiptBuffer = '';
      try {
        while (!receiptBuffer.includes(NULL_BYTE)) {
          const { value, done } = await Promise.race([
            reader.read(),
            timeoutPromise,
          ]);
          if (done) break;
          if (value) {
            receiptBuffer += new TextDecoder().decode(value, { stream: true });
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Connection timeout') {
          // Receipt may not arrive before timeout - message might still have been sent
        }
      }

      // Step 3: DISCONNECT
      await writer.write(new TextEncoder().encode(buildFrame('DISCONNECT', {})));

      writer.releaseLock();
      reader.releaseLock();
      socket.close();

      // Parse receipt if received
      let receiptReceived = false;
      if (receiptBuffer.includes(NULL_BYTE)) {
        const receiptFrame = parseFrame(receiptBuffer.split(NULL_BYTE)[0]);
        if (receiptFrame.command === 'RECEIPT') {
          receiptReceived = true;
        } else if (receiptFrame.command === 'ERROR') {
          return new Response(JSON.stringify({
            success: false,
            error: receiptFrame.body || receiptFrame.headers['message'] || 'Send failed',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        destination,
        bodyLength: bodyByteLength,
        receiptReceived,
        brokerVersion: connFrame.headers['version'] || '1.0',
        brokerServer: connFrame.headers['server'] || 'Unknown',
      }), {
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
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Connect to a STOMP broker, subscribe to a destination, collect messages, then disconnect.
 * POST /api/stomp/subscribe
 */
export async function handleStompSubscribe(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      host: string; port?: number;
      username?: string; password?: string; vhost?: string;
      destination: string;
      maxMessages?: number;
      timeout?: number;
    };
    const {
      host, port = 61613, username, password, vhost, destination,
      maxMessages = 10, timeout = 10000,
    } = body;

    const validationError = validateStompInput(host, port);
    if (validationError) {
      return new Response(JSON.stringify({ success: false, error: validationError }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!destination) {
      return new Response(JSON.stringify({ success: false, error: 'Destination is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const socket = connect(`${host}:${port}`);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), timeout)
    );

    try {
      await Promise.race([socket.opened, timeoutPromise]);
      const writer = socket.writable.getWriter();
      const reader = socket.readable.getReader();

      // CONNECT
      const connectHeaders: Record<string, string> = {
        'accept-version': '1.0,1.1,1.2',
        'host': vhost || host,
        'heart-beat': '0,0',
      };
      if (username) connectHeaders['login'] = username;
      if (password) connectHeaders['passcode'] = password;
      await writer.write(new TextEncoder().encode(buildFrame('CONNECT', connectHeaders)));

      // Read CONNECTED frame
      let buf = '';
      try {
        while (!buf.includes(NULL_BYTE)) {
          const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
          if (done) break;
          if (value) buf += new TextDecoder().decode(value, { stream: true });
        }
      } catch { /* timeout */ }

      const connFrame = parseFrame(buf.split(NULL_BYTE)[0]);
      if (connFrame.command !== 'CONNECTED') {
        writer.releaseLock(); reader.releaseLock(); socket.close();
        return new Response(JSON.stringify({
          success: false,
          error: connFrame.command === 'ERROR'
            ? (connFrame.body || connFrame.headers['message'] || 'Connection rejected')
            : `Unexpected response: ${connFrame.command}`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // SUBSCRIBE
      const subId = 'sub-0';
      await writer.write(new TextEncoder().encode(buildFrame('SUBSCRIBE', {
        id: subId, destination, ack: 'auto',
      })));

      // Collect MESSAGE frames up to maxMessages or collectDeadline
      const messages: Array<{ destination: string; body: string; headers: Record<string, string> }> = [];
      const collectDeadline = Date.now() + Math.min(timeout - 500, 8000);
      // Remaining buffer after CONNECTED frame
      buf = buf.split(NULL_BYTE).slice(1).join(NULL_BYTE);
      const safeMax = Math.min(maxMessages, 50);

      while (messages.length < safeMax) {
        if (Date.now() > collectDeadline) break;

        const nullIdx = buf.indexOf(NULL_BYTE);
        if (nullIdx >= 0) {
          const rawFrame = buf.substring(0, nullIdx);
          buf = buf.substring(nullIdx + 1);
          const frame = parseFrame(rawFrame);
          if (frame.command === 'MESSAGE') {
            messages.push({
              destination: frame.headers['destination'] || destination,
              body: frame.body,
              headers: frame.headers,
            });
          }
          continue;
        }

        try {
          const remaining = collectDeadline - Date.now();
          if (remaining <= 0) break;
          const shortTimeout = new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('collect timeout')), remaining)
          );
          const { value, done } = await Promise.race([reader.read(), shortTimeout]);
          if (done) break;
          if (value) buf += new TextDecoder().decode(value, { stream: true });
        } catch { break; }
      }

      // UNSUBSCRIBE + DISCONNECT
      try {
        await writer.write(new TextEncoder().encode(buildFrame('UNSUBSCRIBE', { id: subId })));
        await writer.write(new TextEncoder().encode(buildFrame('DISCONNECT', { receipt: 'disc-1' })));
      } catch { /* ignore */ }

      writer.releaseLock(); reader.releaseLock(); socket.close();

      return new Response(JSON.stringify({
        success: true,
        destination,
        messageCount: messages.length,
        messages,
        brokerVersion: connFrame.headers['version'] || '1.0',
        brokerServer: connFrame.headers['server'] || 'Unknown',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
      socket.close();
      throw error;
    }
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
