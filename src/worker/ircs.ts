/**
 * IRCS Protocol Support for Cloudflare Workers
 * IRC over TLS (RFC 7194) - Encrypted real-time text chat
 * Port: 6697 (implicit TLS)
 */

import { connect } from 'cloudflare:sockets';
import { checkIfCloudflare, getCloudflareErrorMessage } from './cloudflare-detector';
import { parseIRCMessage, validateNickname } from './irc';
import type { IRCConnectionOptions } from './irc';

/**
 * Handle IRCS connection test (HTTP mode)
 * Tests TLS connectivity and reads server welcome/MOTD
 */
export async function handleIRCSConnect(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const options = (await request.json()) as Partial<IRCConnectionOptions>;

    if (!options.host) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: host' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!options.nickname) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: nickname' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!validateNickname(options.nickname)) {
      return new Response(
        JSON.stringify({ error: 'Invalid nickname. Must start with a letter and contain only alphanumeric characters.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const host = options.host;
    const port = options.port || 6697;
    const nickname = options.nickname;
    const username = options.username || nickname;
    const realname = options.realname || nickname;

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Connect with implicit TLS and perform IRC registration
    const connectionPromise = (async () => {
      const startTime = Date.now();
      const socket = connect(`${host}:${port}`, {
        secureTransport: 'on',
        allowHalfOpen: false,
      });
      await socket.opened;
      const rtt = Date.now() - startTime;

      const writer = socket.writable.getWriter();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      // Send registration commands
      if (options.password) {
        await writer.write(encoder.encode(`PASS ${options.password}\r\n`));
      }
      await writer.write(encoder.encode(`NICK ${nickname}\r\n`));
      await writer.write(encoder.encode(`USER ${username} 0 * :${realname}\r\n`));
      writer.releaseLock();

      // Read server responses (welcome, MOTD, etc.)
      const reader = socket.readable.getReader();
      const messages: Array<{ prefix?: string; command: string; params: string[]; timestamp: number }> = [];
      let buffer = '';
      const maxReadTime = 10000;

      try {
        while (Date.now() - startTime < maxReadTime) {
          const readPromise = reader.read();
          const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
            setTimeout(() => resolve({ done: true, value: undefined }), 5000)
          );

          const { done, value } = await Promise.race([readPromise, timeoutPromise]);
          if (done || !value) break;

          buffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf('\r\n')) !== -1) {
            const line = buffer.substring(0, newlineIndex);
            buffer = buffer.substring(newlineIndex + 2);

            if (line.trim()) {
              const msg = parseIRCMessage(line);
              messages.push(msg);

              // Auto-respond to PING during registration
              if (msg.command === 'PING') {
                const pongWriter = socket.writable.getWriter();
                await pongWriter.write(encoder.encode(`PONG :${msg.params[0] || ''}\r\n`));
                pongWriter.releaseLock();
              }

              // Stop after MOTD end (376) or MOTD missing (422)
              if (msg.command === '376' || msg.command === '422') {
                break;
              }
            }
          }

          if (messages.some((m) => m.command === '376' || m.command === '422')) {
            break;
          }
        }
      } catch {
        // Read timeout or error, continue with what we have
      }

      // Send QUIT
      try {
        const quitWriter = socket.writable.getWriter();
        await quitWriter.write(encoder.encode('QUIT :Port of Call TLS test\r\n'));
        quitWriter.releaseLock();
      } catch {
        // Socket may already be closed
      }

      try {
        await socket.close();
      } catch {
        // Ignore close errors
      }

      // Extract useful info from messages
      const welcome = messages.find((m) => m.command === '001');
      const serverInfo = messages.find((m) => m.command === '004');
      const motdLines = messages
        .filter((m) => m.command === '372')
        .map((m) => m.params[m.params.length - 1]);

      return {
        success: true,
        host,
        port,
        tls: true,
        rtt,
        nickname,
        welcome: welcome ? welcome.params[welcome.params.length - 1] : undefined,
        serverInfo: serverInfo ? serverInfo.params.slice(1).join(' ') : undefined,
        motd: motdLines.length > 0 ? motdLines.join('\n') : undefined,
        messagesReceived: messages.length,
        messages: messages.slice(0, 50),
      };
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 30000)
    );

    const result = await Promise.race([connectionPromise, timeoutPromise]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle IRCS WebSocket connection (interactive mode)
 * Bridges browser WebSocket to IRC-over-TLS TCP connection
 */
export async function handleIRCSWebSocket(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '6697');
    const nickname = url.searchParams.get('nickname');
    const username = url.searchParams.get('username') || nickname || '';
    const realname = url.searchParams.get('realname') || nickname || '';
    const password = url.searchParams.get('password') || '';
    const channels = url.searchParams.get('channels')?.split(',').filter(Boolean) || [];
    const saslUsername = url.searchParams.get('saslUsername') || '';
    const saslPassword = url.searchParams.get('saslPassword') || '';

    if (!host) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: host' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!nickname) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: nickname' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!validateNickname(nickname)) {
      return new Response(
        JSON.stringify({ error: 'Invalid nickname' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if the target is behind Cloudflare
    const cfCheck = await checkIfCloudflare(host);
    if (cfCheck.isCloudflare && cfCheck.ip) {
      return new Response(
        JSON.stringify({
          success: false,
          error: getCloudflareErrorMessage(host, cfCheck.ip),
          isCloudflare: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    // Connect to IRC server with TLS in background
    (async () => {
      try {
        const socket = connect(`${host}:${port}`, {
          secureTransport: 'on',
          allowHalfOpen: false,
        });
        await socket.opened;

        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        // Send connection success
        server.send(
          JSON.stringify({
            type: 'irc-connected',
            host,
            port,
            tls: true,
            message: `Connected to ${host}:${port} (TLS)`,
          })
        );

        // Send IRC registration — CAP LS first for IRCv3 negotiation
        const regWriter = socket.writable.getWriter();
        if (password) {
          await regWriter.write(encoder.encode(`PASS ${password}\r\n`));
        }
        await regWriter.write(encoder.encode('CAP LS 302\r\n'));
        await regWriter.write(encoder.encode(`NICK ${nickname}\r\n`));
        await regWriter.write(encoder.encode(`USER ${username} 0 * :${realname}\r\n`));
        regWriter.releaseLock();

        // Track registration state
        let registered = false;
        let saslState: 'idle' | 'cap_req' | 'authenticate' | 'credentials' | 'done' | 'no_sasl' = 'idle';

        // Handle WebSocket messages from browser -> IRC server
        server.addEventListener('message', async (event) => {
          try {
            const data = typeof event.data === 'string' ? event.data : '';

            try {
              const cmd = JSON.parse(data);
              const cmdWriter = socket.writable.getWriter();

              switch (cmd.type) {
                case 'raw':
                  await cmdWriter.write(encoder.encode(`${cmd.command}\r\n`));
                  break;
                case 'join':
                  await cmdWriter.write(encoder.encode(`JOIN ${cmd.channel}\r\n`));
                  break;
                case 'part':
                  await cmdWriter.write(
                    encoder.encode(
                      `PART ${cmd.channel}${cmd.message ? ' :' + cmd.message : ''}\r\n`
                    )
                  );
                  break;
                case 'privmsg':
                  await cmdWriter.write(
                    encoder.encode(`PRIVMSG ${cmd.target} :${cmd.message}\r\n`)
                  );
                  break;
                case 'nick':
                  await cmdWriter.write(encoder.encode(`NICK ${cmd.nickname}\r\n`));
                  break;
                case 'quit':
                  await cmdWriter.write(
                    encoder.encode(`QUIT :${cmd.message || 'Leaving'}\r\n`)
                  );
                  break;
                case 'topic':
                  if (cmd.topic) {
                    await cmdWriter.write(
                      encoder.encode(`TOPIC ${cmd.channel} :${cmd.topic}\r\n`)
                    );
                  } else {
                    await cmdWriter.write(encoder.encode(`TOPIC ${cmd.channel}\r\n`));
                  }
                  break;
                case 'names':
                  await cmdWriter.write(encoder.encode(`NAMES ${cmd.channel}\r\n`));
                  break;
                case 'list':
                  await cmdWriter.write(encoder.encode('LIST\r\n'));
                  break;
                case 'whois':
                  await cmdWriter.write(encoder.encode(`WHOIS ${cmd.nickname}\r\n`));
                  break;
                case 'notice':
                  await cmdWriter.write(encoder.encode(`NOTICE ${cmd.target} :${cmd.message}\r\n`));
                  break;
                case 'kick':
                  await cmdWriter.write(encoder.encode(`KICK ${cmd.channel} ${cmd.user}${cmd.reason ? ' :' + cmd.reason : ''}\r\n`));
                  break;
                case 'mode':
                  await cmdWriter.write(encoder.encode(`MODE ${cmd.target} ${cmd.mode}${cmd.params ? ' ' + cmd.params : ''}\r\n`));
                  break;
                case 'invite':
                  await cmdWriter.write(encoder.encode(`INVITE ${cmd.nick} ${cmd.channel}\r\n`));
                  break;
                case 'away':
                  await cmdWriter.write(encoder.encode(cmd.message ? `AWAY :${cmd.message}\r\n` : `AWAY\r\n`));
                  break;
                case 'ctcp':
                  await cmdWriter.write(encoder.encode(`PRIVMSG ${cmd.target} :\x01${cmd.ctcp}${cmd.args ? ' ' + cmd.args : ''}\x01\r\n`));
                  break;
                case 'ctcp-reply':
                  await cmdWriter.write(encoder.encode(`NOTICE ${cmd.target} :\x01${cmd.ctcp}${cmd.args ? ' ' + cmd.args : ''}\x01\r\n`));
                  break;
                case 'cap':
                  await cmdWriter.write(encoder.encode(`CAP ${cmd.subcommand}${cmd.params ? ' :' + cmd.params : ''}\r\n`));
                  break;
                case 'userhost':
                  await cmdWriter.write(encoder.encode(`USERHOST ${(cmd.nicks as string[]).slice(0, 5).join(' ')}\r\n`));
                  break;
              }

              cmdWriter.releaseLock();
            } catch {
              // Not JSON - send as raw IRC command
              const rawWriter = socket.writable.getWriter();
              await rawWriter.write(encoder.encode(`${data}\r\n`));
              rawWriter.releaseLock();
            }
          } catch (error) {
            server.send(
              JSON.stringify({
                type: 'error',
                error: error instanceof Error ? error.message : 'Failed to send command',
              })
            );
          }
        });

        // Handle WebSocket close -> IRC quit
        server.addEventListener('close', async () => {
          try {
            const quitWriter = socket.writable.getWriter();
            await quitWriter.write(encoder.encode('QUIT :Connection closed\r\n'));
            quitWriter.releaseLock();
          } catch {
            // Socket may already be closed
          }
          try {
            await socket.close();
          } catch {
            // Ignore close errors
          }
        });

        // Read from IRC server -> WebSocket
        const reader = socket.readable.getReader();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let newlineIndex: number;
            while ((newlineIndex = buffer.indexOf('\r\n')) !== -1) {
              const line = buffer.substring(0, newlineIndex);
              buffer = buffer.substring(newlineIndex + 2);

              if (!line.trim()) continue;

              const msg = parseIRCMessage(line);

              // Auto-respond to PING
              if (msg.command === 'PING') {
                const pongWriter = socket.writable.getWriter();
                await pongWriter.write(
                  encoder.encode(`PONG :${msg.params[0] || ''}\r\n`)
                );
                pongWriter.releaseLock();
              }

              // IRCv3 CAP negotiation
              if (msg.command === 'CAP') {
                const subCmd = msg.params[1];
                if (subCmd === 'LS') {
                  const capsStr = msg.params[msg.params.length - 1];
                  const availCaps = capsStr.split(' ').filter(Boolean);
                  server.send(JSON.stringify({ type: 'irc-caps', caps: availCaps }));
                  const hasSasl = availCaps.some(c => c === 'sasl' || c.startsWith('sasl='));
                  if (saslUsername && saslPassword && hasSasl) {
                    const w = socket.writable.getWriter();
                    await w.write(encoder.encode('CAP REQ :sasl\r\n'));
                    w.releaseLock();
                    saslState = 'cap_req';
                  } else {
                    const w = socket.writable.getWriter();
                    await w.write(encoder.encode('CAP END\r\n'));
                    w.releaseLock();
                    saslState = 'no_sasl';
                  }
                } else if (subCmd === 'ACK') {
                  const ackedCaps = msg.params[msg.params.length - 1].trim().split(' ').filter(Boolean);
                  server.send(JSON.stringify({ type: 'irc-cap-ack', caps: ackedCaps }));
                  if (ackedCaps.some(c => c === 'sasl') && saslState === 'cap_req') {
                    const w = socket.writable.getWriter();
                    await w.write(encoder.encode('AUTHENTICATE PLAIN\r\n'));
                    w.releaseLock();
                    saslState = 'authenticate';
                  } else {
                    const w = socket.writable.getWriter();
                    await w.write(encoder.encode('CAP END\r\n'));
                    w.releaseLock();
                    saslState = 'no_sasl';
                  }
                } else if (subCmd === 'NAK') {
                  server.send(JSON.stringify({ type: 'irc-cap-nak', caps: msg.params[msg.params.length - 1] }));
                  const w = socket.writable.getWriter();
                  await w.write(encoder.encode('CAP END\r\n'));
                  w.releaseLock();
                  saslState = 'no_sasl';
                }
              }

              // SASL PLAIN authentication
              if (msg.command === 'AUTHENTICATE' && msg.params[0] === '+' && saslState === 'authenticate') {
                const saslBytes = new TextEncoder().encode(`${saslUsername}\0${saslUsername}\0${saslPassword}`);
                let saslBin = '';
                for (let i = 0; i < saslBytes.length; i++) saslBin += String.fromCharCode(saslBytes[i]);
                const creds = btoa(saslBin);
                const w = socket.writable.getWriter();
                await w.write(encoder.encode(`AUTHENTICATE ${creds}\r\n`));
                w.releaseLock();
                saslState = 'credentials';
              }
              if (msg.command === '903') {
                server.send(JSON.stringify({ type: 'irc-sasl-success', message: msg.params[msg.params.length - 1] }));
                const w = socket.writable.getWriter();
                await w.write(encoder.encode('CAP END\r\n'));
                w.releaseLock();
                saslState = 'done';
              }
              if (['904', '905', '906', '907'].includes(msg.command)) {
                server.send(JSON.stringify({ type: 'irc-sasl-failed', code: msg.command, message: msg.params[msg.params.length - 1] }));
                server.close();
              }

              // Auto-join channels after registration
              if (!registered && (msg.command === '376' || msg.command === '422')) {
                registered = true;
                if (channels.length > 0) {
                  const joinWriter = socket.writable.getWriter();
                  for (const channel of channels) {
                    await joinWriter.write(encoder.encode(`JOIN ${channel}\r\n`));
                  }
                  joinWriter.releaseLock();
                }
              }

              // Forward message to browser
              server.send(
                JSON.stringify({
                  type: 'irc-message',
                  raw: line,
                  parsed: msg,
                })
              );
            }
          }
        } catch (error) {
          console.error('IRCS read error:', error);
        }

        // Socket closed
        server.send(JSON.stringify({ type: 'irc-disconnected', message: 'Server closed connection' }));
        server.close();
      } catch (error) {
        server.send(
          JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'TLS connection failed',
          })
        );
        server.close();
      }
    })();

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
