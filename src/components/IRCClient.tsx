import { useState, useRef, useEffect, useCallback } from 'react';

interface IRCClientProps {
  onBack: () => void;
}

interface IRCParsedMessage {
  prefix?: string;
  command: string;
  params: string[];
  timestamp: number;
}

interface DisplayMessage {
  type: 'chat' | 'action' | 'join' | 'part' | 'quit' | 'notice' | 'server' | 'error' | 'info';
  channel: string;
  sender: string;
  text: string;
  timestamp: number;
}

export default function IRCClient({ onBack }: IRCClientProps) {
  const [host, setHost] = useState('irc.libera.chat');
  const [port, setPort] = useState('6667');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [autoJoinChannels, setAutoJoinChannels] = useState('#portofcall');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  const [channels, setChannels] = useState<string[]>(['server']);
  const [activeChannel, setActiveChannel] = useState('server');
  const [messages, setMessages] = useState<Map<string, DisplayMessage[]>>(
    new Map([['server', []]])
  );
  const [users, setUsers] = useState<Map<string, string[]>>(new Map());
  const [input, setInput] = useState('');
  const [currentNick, setCurrentNick] = useState('');

  const ws = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeChannel]);

  useEffect(() => {
    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, []);

  const addMessage = useCallback((channel: string, msg: DisplayMessage) => {
    setMessages((prev) => {
      const updated = new Map(prev);
      const channelMsgs = updated.get(channel) || [];
      const next = [...channelMsgs, msg];
      updated.set(channel, next.length > 500 ? next.slice(-500) : next);
      return updated;
    });
  }, []);

  const addServerMessage = useCallback(
    (text: string, type: DisplayMessage['type'] = 'server') => {
      addMessage('server', {
        type,
        channel: 'server',
        sender: '',
        text,
        timestamp: Date.now(),
      });
    },
    [addMessage]
  );

  const extractNick = (prefix: string | undefined): string => {
    if (!prefix) return 'server';
    const bangIdx = prefix.indexOf('!');
    return bangIdx !== -1 ? prefix.substring(0, bangIdx) : prefix;
  };

  const processIRCMessage = useCallback(
    (parsed: IRCParsedMessage) => {
      const sender = extractNick(parsed.prefix);
      const lastParam = parsed.params[parsed.params.length - 1] || '';

      switch (parsed.command) {
        // Welcome
        case '001':
          addServerMessage(lastParam, 'info');
          break;

        // Server info / MOTD lines
        case '002':
        case '003':
        case '004':
        case '005':
        case '250':
        case '251':
        case '252':
        case '253':
        case '254':
        case '255':
        case '265':
        case '266':
          addServerMessage(lastParam);
          break;

        // MOTD
        case '372':
        case '375':
          addServerMessage(lastParam);
          break;

        // End of MOTD
        case '376':
        case '422':
          addServerMessage(lastParam);
          break;

        // Channel topic
        case '332': {
          const topicChannel = parsed.params[1];
          addMessage(topicChannel || 'server', {
            type: 'info',
            channel: topicChannel || 'server',
            sender: '',
            text: `Topic: ${lastParam}`,
            timestamp: Date.now(),
          });
          break;
        }

        // Names list
        case '353': {
          const namesChannel = parsed.params[2];
          const namesList = lastParam.split(' ').filter(Boolean);
          setUsers((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(namesChannel) || [];
            const merged = [...new Set([...existing, ...namesList])];
            updated.set(namesChannel, merged);
            return updated;
          });
          break;
        }

        // End of names
        case '366': {
          const endNamesChannel = parsed.params[1];
          const channelUsers = users.get(endNamesChannel) || [];
          addMessage(endNamesChannel || 'server', {
            type: 'info',
            channel: endNamesChannel || 'server',
            sender: '',
            text: `Users (${channelUsers.length}): ${channelUsers.join(', ')}`,
            timestamp: Date.now(),
          });
          break;
        }

        // Nick in use
        case '433':
          addServerMessage(`Nickname "${parsed.params[1]}" is already in use`, 'error');
          break;

        // JOIN
        case 'JOIN': {
          const joinChannel = parsed.params[0]?.replace(/^:/, '') || lastParam;
          if (sender === currentNick) {
            // We joined a channel
            setChannels((prev) =>
              prev.includes(joinChannel) ? prev : [...prev, joinChannel]
            );
            setMessages((prev) => {
              const updated = new Map(prev);
              if (!updated.has(joinChannel)) {
                updated.set(joinChannel, []);
              }
              return updated;
            });
            setActiveChannel(joinChannel);
          }
          setUsers((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(joinChannel) || [];
            if (!existing.includes(sender)) {
              updated.set(joinChannel, [...existing, sender]);
            }
            return updated;
          });
          addMessage(joinChannel, {
            type: 'join',
            channel: joinChannel,
            sender,
            text: `${sender} has joined ${joinChannel}`,
            timestamp: Date.now(),
          });
          break;
        }

        // PART
        case 'PART': {
          const partChannel = parsed.params[0];
          if (sender === currentNick) {
            setChannels((prev) => prev.filter((c) => c !== partChannel));
            setUsers((prev) => {
              const updated = new Map(prev);
              updated.delete(partChannel);
              return updated;
            });
            if (activeChannel === partChannel) {
              setActiveChannel('server');
            }
          } else {
            setUsers((prev) => {
              const updated = new Map(prev);
              const existing = updated.get(partChannel) || [];
              updated.set(
                partChannel,
                existing.filter((u) => u !== sender)
              );
              return updated;
            });
          }
          addMessage(partChannel, {
            type: 'part',
            channel: partChannel,
            sender,
            text: `${sender} has left ${partChannel}${lastParam !== partChannel ? ': ' + lastParam : ''}`,
            timestamp: Date.now(),
          });
          break;
        }

        // QUIT
        case 'QUIT': {
          // Remove user from all channels
          setUsers((prev) => {
            const updated = new Map(prev);
            for (const [ch, userList] of updated) {
              updated.set(
                ch,
                userList.filter((u) => u !== sender)
              );
            }
            return updated;
          });
          // Add quit message to all channels the user was in
          for (const ch of channels) {
            if (ch !== 'server') {
              addMessage(ch, {
                type: 'quit',
                channel: ch,
                sender,
                text: `${sender} has quit (${lastParam})`,
                timestamp: Date.now(),
              });
            }
          }
          break;
        }

        // PRIVMSG
        case 'PRIVMSG': {
          const target = parsed.params[0];
          const isAction = lastParam.startsWith('\x01ACTION ') && lastParam.endsWith('\x01');
          const msgChannel = target === currentNick ? sender : target;

          // Ensure DM channel exists
          if (target === currentNick && !channels.includes(sender)) {
            setChannels((prev) => (prev.includes(sender) ? prev : [...prev, sender]));
            setMessages((prev) => {
              const updated = new Map(prev);
              if (!updated.has(sender)) {
                updated.set(sender, []);
              }
              return updated;
            });
          }

          if (isAction) {
            const actionText = lastParam.substring(8, lastParam.length - 1);
            addMessage(msgChannel, {
              type: 'action',
              channel: msgChannel,
              sender,
              text: `${sender} ${actionText}`,
              timestamp: Date.now(),
            });
          } else {
            addMessage(msgChannel, {
              type: 'chat',
              channel: msgChannel,
              sender,
              text: lastParam,
              timestamp: Date.now(),
            });
          }
          break;
        }

        // NOTICE
        case 'NOTICE': {
          const noticeTarget = parsed.params[0];
          const noticeChannel =
            noticeTarget === currentNick || noticeTarget === '*' ? 'server' : noticeTarget;
          addMessage(noticeChannel, {
            type: 'notice',
            channel: noticeChannel,
            sender,
            text: lastParam,
            timestamp: Date.now(),
          });
          break;
        }

        // NICK change
        case 'NICK': {
          const newNick = lastParam || parsed.params[0];
          if (sender === currentNick) {
            setCurrentNick(newNick);
          }
          // Update user lists
          setUsers((prev) => {
            const updated = new Map(prev);
            for (const [ch, userList] of updated) {
              updated.set(
                ch,
                userList.map((u) => (u === sender ? newNick : u))
              );
            }
            return updated;
          });
          for (const ch of channels) {
            if (ch !== 'server') {
              addMessage(ch, {
                type: 'info',
                channel: ch,
                sender: '',
                text: `${sender} is now known as ${newNick}`,
                timestamp: Date.now(),
              });
            }
          }
          break;
        }

        // KICK
        case 'KICK': {
          const kickChannel = parsed.params[0];
          const kickedUser = parsed.params[1];
          const kickReason = lastParam;

          if (kickedUser === currentNick) {
            setChannels((prev) => prev.filter((c) => c !== kickChannel));
            if (activeChannel === kickChannel) {
              setActiveChannel('server');
            }
          }
          setUsers((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(kickChannel) || [];
            updated.set(
              kickChannel,
              existing.filter((u) => u !== kickedUser)
            );
            return updated;
          });
          addMessage(kickChannel, {
            type: 'info',
            channel: kickChannel,
            sender: '',
            text: `${kickedUser} was kicked by ${sender} (${kickReason})`,
            timestamp: Date.now(),
          });
          break;
        }

        // TOPIC change
        case 'TOPIC': {
          const topicCh = parsed.params[0];
          addMessage(topicCh, {
            type: 'info',
            channel: topicCh,
            sender: '',
            text: `${sender} changed the topic to: ${lastParam}`,
            timestamp: Date.now(),
          });
          break;
        }

        // Other numeric replies - show in server tab
        default:
          if (/^\d{3}$/.test(parsed.command)) {
            addServerMessage(`[${parsed.command}] ${parsed.params.slice(1).join(' ')}`);
          }
          break;
      }
    },
    [activeChannel, addMessage, addServerMessage, channels, currentNick, users]
  );

  const handleConnect = () => {
    if (!host || !nickname) {
      addServerMessage('Error: Host and nickname are required', 'error');
      return;
    }

    setLoading(true);
    setCurrentNick(nickname);
    addServerMessage(`Connecting to ${host}:${port}...`, 'info');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({
      host,
      port,
      nickname,
      ...(password && { password }),
      ...(autoJoinChannels && { channels: autoJoinChannels }),
    });

    const wsUrl = `${protocol}//${window.location.host}/api/irc/connect?${params}`;
    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      ws.current = websocket;
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'irc-connected':
            setConnected(true);
            setLoading(false);
            addServerMessage(data.message, 'info');
            break;

          case 'irc-message':
            if (data.parsed) {
              processIRCMessage(data.parsed);
            }
            break;

          case 'irc-disconnected':
            setConnected(false);
            setLoading(false);
            addServerMessage(data.message || 'Disconnected', 'info');
            break;

          case 'error':
            addServerMessage(`Error: ${data.error}`, 'error');
            setLoading(false);
            break;
        }
      } catch {
        // Non-JSON data
      }
    };

    websocket.onerror = () => {
      addServerMessage('WebSocket error occurred', 'error');
      setLoading(false);
    };

    websocket.onclose = () => {
      setConnected(false);
      setLoading(false);
      ws.current = null;
      addServerMessage('Connection closed', 'info');
    };
  };

  const handleDisconnect = () => {
    if (ws.current) {
      ws.current.send(JSON.stringify({ type: 'quit', message: 'Leaving' }));
      ws.current.close();
    }
    setConnected(false);
    ws.current = null;
  };

  const handleSend = () => {
    if (!ws.current || !input.trim()) return;

    const trimmed = input.trim();

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const parts = trimmed.substring(1).split(' ');
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      switch (cmd) {
        case 'join':
          if (args[0]) {
            ws.current.send(JSON.stringify({ type: 'join', channel: args[0] }));
          }
          break;
        case 'part':
        case 'leave': {
          const partCh = args[0] || activeChannel;
          ws.current.send(
            JSON.stringify({ type: 'part', channel: partCh, message: args.slice(1).join(' ') })
          );
          break;
        }
        case 'nick':
          if (args[0]) {
            ws.current.send(JSON.stringify({ type: 'nick', nickname: args[0] }));
          }
          break;
        case 'msg':
        case 'pm':
        case 'privmsg':
          if (args[0] && args[1]) {
            ws.current.send(
              JSON.stringify({ type: 'privmsg', target: args[0], message: args.slice(1).join(' ') })
            );
            // Show own PM
            addMessage(args[0], {
              type: 'chat',
              channel: args[0],
              sender: currentNick,
              text: args.slice(1).join(' '),
              timestamp: Date.now(),
            });
          }
          break;
        case 'me':
          if (activeChannel !== 'server') {
            const actionText = args.join(' ');
            ws.current.send(
              JSON.stringify({
                type: 'privmsg',
                target: activeChannel,
                message: `\x01ACTION ${actionText}\x01`,
              })
            );
            addMessage(activeChannel, {
              type: 'action',
              channel: activeChannel,
              sender: currentNick,
              text: `${currentNick} ${actionText}`,
              timestamp: Date.now(),
            });
          }
          break;
        case 'topic':
          if (activeChannel !== 'server') {
            ws.current.send(
              JSON.stringify({ type: 'topic', channel: activeChannel, topic: args.join(' ') || undefined })
            );
          }
          break;
        case 'names':
          ws.current.send(
            JSON.stringify({ type: 'names', channel: args[0] || activeChannel })
          );
          break;
        case 'list':
          ws.current.send(JSON.stringify({ type: 'list' }));
          break;
        case 'whois':
          if (args[0]) {
            ws.current.send(JSON.stringify({ type: 'whois', nickname: args[0] }));
          }
          break;
        case 'raw':
        case 'quote':
          ws.current.send(JSON.stringify({ type: 'raw', command: args.join(' ') }));
          break;
        case 'quit':
          handleDisconnect();
          break;
        default:
          // Send as raw command
          ws.current.send(JSON.stringify({ type: 'raw', command: trimmed.substring(1) }));
          break;
      }
    } else {
      // Regular message to active channel
      if (activeChannel !== 'server') {
        ws.current.send(
          JSON.stringify({ type: 'privmsg', target: activeChannel, message: trimmed })
        );
        // Show own message
        addMessage(activeChannel, {
          type: 'chat',
          channel: activeChannel,
          sender: currentNick,
          text: trimmed,
          timestamp: Date.now(),
        });
      }
    }

    setInput('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const activeMessages = messages.get(activeChannel) || [];
  const activeUsers = users.get(activeChannel) || [];

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-white hover:text-blue-400 transition-colors">
            &larr; Back
          </button>
          <h1 className="text-3xl font-bold text-white">IRC Client</h1>
        </div>
        {connected && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-green-400 text-sm">
              {currentNick}@{host}:{port}
            </span>
          </div>
        )}
      </div>

      {!connected ? (
        /* Connection Form */
        <div className="max-w-lg mx-auto">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Connect to IRC Server</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-1">Server</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="irc.libera.chat"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Nickname</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="MyNickname"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Server Password <span className="text-slate-500">(optional)</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Optional server password"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Auto-join Channels <span className="text-slate-500">(comma-separated)</span>
                </label>
                <input
                  type="text"
                  value={autoJoinChannels}
                  onChange={(e) => setAutoJoinChannels(e.target.value)}
                  placeholder="#channel1,#channel2"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button
                onClick={handleConnect}
                disabled={loading || !host || !nickname}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Connecting...' : 'Connect'}
              </button>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-600">
              <h3 className="text-sm font-semibold text-slate-300 mb-2">About IRC</h3>
              <p className="text-xs text-slate-400">
                Internet Relay Chat (RFC 2812) is a real-time text messaging protocol. Default port is
                6667 (plaintext). Popular networks: Libera.Chat, OFTC, EFnet.
              </p>
              <h3 className="text-sm font-semibold text-slate-300 mb-2 mt-3">Commands</h3>
              <div className="text-xs text-slate-400 space-y-1 font-mono">
                <div>/join #channel - Join a channel</div>
                <div>/part [#channel] - Leave a channel</div>
                <div>/nick newname - Change nickname</div>
                <div>/msg user message - Private message</div>
                <div>/me action - Send action</div>
                <div>/topic [text] - View/set topic</div>
                <div>/whois nick - User info</div>
                <div>/quit - Disconnect</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Chat Interface */
        <div className="grid grid-cols-6 gap-4 h-[calc(100vh-12rem)]">
          {/* Channel List */}
          <div className="col-span-1 bg-slate-800 border border-slate-600 rounded-xl p-3 overflow-y-auto">
            <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Channels</h3>
            <div className="space-y-1">
              {channels.map((ch) => (
                <button
                  key={ch}
                  onClick={() => setActiveChannel(ch)}
                  className={`w-full text-left text-sm px-2 py-1.5 rounded transition-colors truncate ${
                    ch === activeChannel
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>

            <div className="mt-4">
              <button
                onClick={handleDisconnect}
                className="w-full text-sm bg-red-600/20 hover:bg-red-600/40 text-red-400 py-1.5 px-2 rounded transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="col-span-4 bg-slate-800 border border-slate-600 rounded-xl flex flex-col">
            {/* Channel header */}
            <div className="px-4 py-2 border-b border-slate-600 flex items-center justify-between">
              <span className="font-semibold text-white">{activeChannel}</span>
              {activeChannel !== 'server' && activeUsers.length > 0 && (
                <span className="text-xs text-slate-400">{activeUsers.length} users</span>
              )}
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-0.5">
              {activeMessages.length === 0 ? (
                <div className="text-slate-500 text-center py-8">
                  {activeChannel === 'server'
                    ? 'Server messages will appear here'
                    : 'No messages yet'}
                </div>
              ) : (
                activeMessages.map((msg, idx) => (
                  <div key={idx} className="flex gap-2 leading-relaxed">
                    <span className="text-slate-500 text-xs flex-shrink-0 w-12 text-right pt-0.5">
                      {formatTime(msg.timestamp)}
                    </span>
                    {msg.type === 'chat' ? (
                      <>
                        <span
                          className={`flex-shrink-0 font-bold ${
                            msg.sender === currentNick ? 'text-green-400' : 'text-blue-400'
                          }`}
                        >
                          &lt;{msg.sender}&gt;
                        </span>
                        <span className="text-gray-200 break-all">{msg.text}</span>
                      </>
                    ) : msg.type === 'action' ? (
                      <span className="text-purple-400 italic">* {msg.text}</span>
                    ) : msg.type === 'join' ? (
                      <span className="text-green-600">--&gt; {msg.text}</span>
                    ) : msg.type === 'part' || msg.type === 'quit' ? (
                      <span className="text-red-400/70">&lt;-- {msg.text}</span>
                    ) : msg.type === 'notice' ? (
                      <span className="text-yellow-400">
                        -{msg.sender}- {msg.text}
                      </span>
                    ) : msg.type === 'error' ? (
                      <span className="text-red-400">{msg.text}</span>
                    ) : msg.type === 'info' ? (
                      <span className="text-cyan-400">{msg.text}</span>
                    ) : (
                      <span className="text-slate-400">{msg.text}</span>
                    )}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-slate-600">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={
                    activeChannel === 'server'
                      ? 'Type /join #channel or /command...'
                      : 'Type a message or /command...'
                  }
                  className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  Send
                </button>
              </div>
            </div>
          </div>

          {/* User List */}
          <div className="col-span-1 bg-slate-800 border border-slate-600 rounded-xl p-3 overflow-y-auto">
            <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">
              {activeChannel !== 'server' ? 'Users' : 'Info'}
            </h3>
            {activeChannel !== 'server' && activeUsers.length > 0 ? (
              <div className="space-y-0.5">
                {activeUsers.sort().map((user) => (
                  <div
                    key={user}
                    className={`text-xs px-2 py-1 rounded truncate ${
                      user.replace(/^[@+]/, '') === currentNick
                        ? 'text-green-400 font-bold'
                        : 'text-slate-300'
                    }`}
                  >
                    {user}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                {activeChannel === 'server'
                  ? 'Join a channel to see users'
                  : 'No user list available'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
