# IRC Protocol Implementation Plan

## Overview

**Protocol:** IRC (Internet Relay Chat)
**Port:** 6667 (plaintext), 6697 (SSL)
**RFC:** [RFC 1459](https://tools.ietf.org/html/rfc1459), [RFC 2812](https://tools.ietf.org/html/rfc2812)
**Complexity:** Low-Medium
**Purpose:** Real-time text chat

IRC is a **classic internet protocol** still actively used. A browser-based client brings IRC to modern web users without installing dedicated software.

### Use Cases
- Connect to IRC communities from anywhere
- Developer chat rooms (Freenode, Libera.Chat)
- Open source project channels
- Tech support channels
- Retro computing enthusiasts
- Educational - learn IRC commands

## Protocol Specification

### IRC Message Format

Simple line-based protocol:

```
[: <prefix> ] <command> <params> \r\n
```

### Example Commands

```
NICK username               - Set nickname
USER user 0 * :realname    - Identify user
JOIN #channel              - Join channel
PRIVMSG #channel :message  - Send message
PART #channel              - Leave channel
QUIT :message              - Disconnect
PING :server               - Keepalive
PONG :server               - Respond to ping
```

### Example Session

```
Client → Server: NICK alice
Client → Server: USER alice 0 * :Alice Smith

Server → Client: :server 001 alice :Welcome to IRC
Server → Client: :server 376 alice :End of /MOTD

Client → Server: JOIN #test

Server → Client: :alice!~alice@host JOIN #test
Server → Client: :server 332 alice #test :Welcome to #test
Server → Client: :server 353 alice = #test :alice bob charlie

Client → Server: PRIVMSG #test :Hello everyone!

Server → Client: :alice!~alice@host PRIVMSG #test :Hello everyone!

Client → Server: QUIT :Goodbye
```

### Numeric Replies

| Code | Name | Meaning |
|------|------|---------|
| 001 | RPL_WELCOME | Welcome message |
| 332 | RPL_TOPIC | Channel topic |
| 353 | RPL_NAMREPLY | Channel user list |
| 433 | ERR_NICKNAMEINUSE | Nickname taken |
| 461 | ERR_NEEDMOREPARAMS | Missing parameters |

## Worker Implementation

### IRC Client

```typescript
// src/worker/protocols/irc/client.ts

import { connect } from 'cloudflare:sockets';

export interface IRCConfig {
  server: string;
  port: number;
  nickname: string;
  username?: string;
  realname?: string;
  password?: string; // Server password
  channels?: string[];
}

export interface IRCMessage {
  prefix?: string;
  command: string;
  params: string[];
  timestamp: number;
}

export class IRCClient {
  private socket: Socket;
  private messages: IRCMessage[] = [];
  private connected = false;

  constructor(private config: IRCConfig) {}

  async connect(): Promise<void> {
    this.socket = connect(`${this.config.server}:${this.config.port}`);
    await this.socket.opened;

    // Start reading messages
    this.readMessages();

    // Send registration
    if (this.config.password) {
      await this.send(`PASS ${this.config.password}`);
    }

    await this.send(`NICK ${this.config.nickname}`);
    await this.send(
      `USER ${this.config.username || this.config.nickname} 0 * :${
        this.config.realname || this.config.nickname
      }`
    );

    this.connected = true;
  }

  private async readMessages(): Promise<void> {
    const reader = this.socket.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\r\n')) !== -1) {
          const line = buffer.substring(0, newlineIndex);
          buffer = buffer.substring(newlineIndex + 2);

          const msg = this.parseLine(line);
          this.messages.push(msg);

          // Auto-respond to PING
          if (msg.command === 'PING') {
            await this.send(`PONG ${msg.params[0]}`);
          }
        }
      }
    } catch (error) {
      console.error('IRC read error:', error);
    }
  }

  private parseLine(line: string): IRCMessage {
    let prefix: string | undefined;
    let command: string;
    const params: string[] = [];

    let pos = 0;

    // Parse prefix
    if (line[0] === ':') {
      const spacePos = line.indexOf(' ', 1);
      prefix = line.substring(1, spacePos);
      pos = spacePos + 1;
    }

    // Parse command
    const spacePos = line.indexOf(' ', pos);
    if (spacePos === -1) {
      command = line.substring(pos);
    } else {
      command = line.substring(pos, spacePos);
      pos = spacePos + 1;
    }

    // Parse params
    while (pos < line.length) {
      if (line[pos] === ':') {
        // Trailing param (rest of line)
        params.push(line.substring(pos + 1));
        break;
      }

      const nextSpace = line.indexOf(' ', pos);
      if (nextSpace === -1) {
        params.push(line.substring(pos));
        break;
      }

      params.push(line.substring(pos, nextSpace));
      pos = nextSpace + 1;
    }

    return {
      prefix,
      command,
      params,
      timestamp: Date.now(),
    };
  }

  private async send(message: string): Promise<void> {
    const writer = this.socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(message + '\r\n'));
    writer.releaseLock();
  }

  async join(channel: string): Promise<void> {
    await this.send(`JOIN ${channel}`);
  }

  async part(channel: string, message?: string): Promise<void> {
    await this.send(`PART ${channel}${message ? ' :' + message : ''}`);
  }

  async sendMessage(target: string, message: string): Promise<void> {
    await this.send(`PRIVMSG ${target} :${message}`);
  }

  async setNick(nickname: string): Promise<void> {
    await this.send(`NICK ${nickname}`);
  }

  getMessages(): IRCMessage[] {
    return this.messages;
  }

  clearMessages(): void {
    this.messages = [];
  }

  async quit(message: string = 'Goodbye'): Promise<void> {
    await this.send(`QUIT :${message}`);
    await this.socket.close();
    this.connected = false;
  }
}
```

### WebSocket Tunnel

```typescript
// src/worker/protocols/irc/tunnel.ts

export async function ircTunnel(
  request: Request,
  config: IRCConfig
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  (async () => {
    try {
      const irc = new IRCClient(config);
      await irc.connect();

      server.send(JSON.stringify({ type: 'connected' }));

      // Auto-join channels
      if (config.channels) {
        for (const channel of config.channels) {
          await irc.join(channel);
        }
      }

      // Handle commands from browser
      server.addEventListener('message', async (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'join':
              await irc.join(msg.channel);
              break;

            case 'part':
              await irc.part(msg.channel, msg.message);
              break;

            case 'message':
              await irc.sendMessage(msg.target, msg.message);
              break;

            case 'nick':
              await irc.setNick(msg.nickname);
              break;

            case 'getMessages':
              const messages = irc.getMessages();
              server.send(JSON.stringify({
                type: 'messages',
                messages,
              }));
              irc.clearMessages();
              break;
          }
        } catch (error) {
          server.send(JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          }));
        }
      });

      // Poll for new messages
      const interval = setInterval(() => {
        const messages = irc.getMessages();
        if (messages.length > 0) {
          server.send(JSON.stringify({
            type: 'messages',
            messages,
          }));
          irc.clearMessages();
        }
      }, 500);

      server.addEventListener('close', () => {
        clearInterval(interval);
        irc.quit('Connection closed');
      });

    } catch (error) {
      server.send(JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'Connection failed',
      }));
      server.close();
    }
  })();

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
```

## Web UI Design

### IRC Chat Interface

```typescript
// src/components/IRCClient.tsx

export function IRCClient() {
  const [server, setServer] = useState('irc.libera.chat');
  const [port, setPort] = useState(6667);
  const [nickname, setNickname] = useState('');
  const [connected, setConnected] = useState(false);

  const [channels, setChannels] = useState<string[]>([]);
  const [activeChannel, setActiveChannel] = useState<string>('');
  const [messages, setMessages] = useState<Map<string, IRCMessage[]>>(new Map());
  const [input, setInput] = useState('');

  const ws = useRef<WebSocket | null>(null);

  const connect = () => {
    ws.current = new WebSocket('/api/irc/connect');

    ws.current.onopen = () => {
      ws.current?.send(JSON.stringify({
        server,
        port,
        nickname,
        channels: ['#port-of-call'], // Auto-join
      }));
    };

    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'connected') {
        setConnected(true);
      } else if (msg.type === 'messages') {
        // Process IRC messages
        for (const ircMsg of msg.messages) {
          processIRCMessage(ircMsg);
        }
      }
    };
  };

  const processIRCMessage = (msg: IRCMessage) => {
    // Extract channel/user from message
    const target = msg.params[0];

    if (msg.command === 'JOIN' && msg.prefix?.startsWith(nickname)) {
      setChannels(prev => [...prev, target]);
      if (!activeChannel) setActiveChannel(target);
    } else if (msg.command === 'PRIVMSG') {
      addMessage(target, msg);
    }

    // Handle numeric replies
    if (/^\d{3}$/.test(msg.command)) {
      addMessage('server', msg);
    }
  };

  const addMessage = (channel: string, msg: IRCMessage) => {
    setMessages(prev => {
      const updated = new Map(prev);
      const channelMsgs = updated.get(channel) || [];
      updated.set(channel, [...channelMsgs, msg]);
      return updated;
    });
  };

  const sendMessage = () => {
    if (input.startsWith('/')) {
      // Handle IRC commands
      const [cmd, ...args] = input.substring(1).split(' ');

      if (cmd === 'join') {
        ws.current?.send(JSON.stringify({
          type: 'join',
          channel: args[0],
        }));
      } else if (cmd === 'part') {
        ws.current?.send(JSON.stringify({
          type: 'part',
          channel: activeChannel,
        }));
      }
    } else {
      // Regular message
      ws.current?.send(JSON.stringify({
        type: 'message',
        target: activeChannel,
        message: input,
      }));

      // Show own message
      addMessage(activeChannel, {
        prefix: `${nickname}!~user@host`,
        command: 'PRIVMSG',
        params: [activeChannel, input],
        timestamp: Date.now(),
      });
    }

    setInput('');
  };

  return (
    <div className="irc-client">
      {!connected ? (
        <div className="connection-form">
          <h2>Connect to IRC</h2>
          <input
            type="text"
            placeholder="Server"
            value={server}
            onChange={(e) => setServer(e.target.value)}
          />
          <input
            type="number"
            placeholder="Port"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
          <input
            type="text"
            placeholder="Nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <button onClick={connect}>Connect</button>
        </div>
      ) : (
        <div className="chat-interface">
          <div className="channel-list">
            <h3>Channels</h3>
            {channels.map(ch => (
              <div
                key={ch}
                className={ch === activeChannel ? 'active' : ''}
                onClick={() => setActiveChannel(ch)}
              >
                {ch}
              </div>
            ))}
          </div>

          <div className="chat-area">
            <div className="messages">
              {(messages.get(activeChannel) || []).map((msg, i) => (
                <div key={i} className="message">
                  <span className="timestamp">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="sender">
                    {msg.prefix?.split('!')[0] || 'server'}
                  </span>
                  <span className="content">
                    {msg.params[msg.params.length - 1]}
                  </span>
                </div>
              ))}
            </div>

            <div className="input-area">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type message or /command"
              />
              <button onClick={sendMessage}>Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

## Security

### Nickname Validation

```typescript
function validateNickname(nick: string): boolean {
  // IRC nicknames: 1-9 chars, alphanumeric + special chars
  return /^[a-zA-Z\[\]\\`_^{|}][a-zA-Z0-9\[\]\\`_^{|}-]{0,8}$/.test(nick);
}
```

### Rate Limiting

```typescript
// IRC servers typically rate limit (flood protection)
const MESSAGE_DELAY = 500; // ms between messages
```

## Testing

### Public IRC Servers

```
irc.libera.chat:6667
irc.libera.chat:6697 (SSL)
irc.freenode.net:6667
```

## Resources

- **RFC 2812**: [IRC Protocol](https://tools.ietf.org/html/rfc2812)
- **Libera.Chat**: [IRC Network](https://libera.chat/)
- **IRC Command Reference**: [Modern IRC](https://modern.ircdocs.horse/)

## Next Steps

1. Implement IRC client with message parsing
2. Build chat UI with channels
3. Add user list display
4. Implement IRC commands (/join, /part, /nick, etc.)
5. Add color/formatting support (mIRC colors)
6. Create channel search/discovery
7. Add private message (DM) support

## Notes

- IRC is **line-based** and relatively simple
- Perfect for demonstrating **real-time messaging**
- Still actively used by open source communities
- Consider SSL/TLS support (port 6697)
- Retro appeal for older internet users
