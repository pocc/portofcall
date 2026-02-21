import { useState, useRef, useEffect, useCallback } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface RedisClientProps {
  onBack: () => void;
}

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected';

interface HistoryEntry {
  type: 'command' | 'response' | 'error' | 'info';
  text: string;
}

export default function RedisClient({ onBack }: RedisClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6379');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('0');
  const [status, setStatus] = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [version, setVersion] = useState('');
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdHistoryIdx, setCmdHistoryIdx] = useState(-1);

  const wsRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear sensitive state and close WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
        wsRef.current.close(1000, 'component unmount');
      }
      wsRef.current = null;
      setPassword('');
    };
  }, []);

  // Scroll output to bottom whenever history changes
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const addEntry = useCallback((type: HistoryEntry['type'], text: string) => {
    setHistory(prev => [...prev, { type, text }]);
  }, []);

  const handleConnect = () => {
    if (!host) {
      setStatusMsg('Host is required.');
      return;
    }
    setStatus('connecting');
    setStatusMsg('');
    setHistory([]);

    const params = new URLSearchParams({ host, port });

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/redis/session?${params}`);
    wsRef.current = ws;

    ws.onopen = () => {
      // Send credentials as the first message (never in query params)
      ws.send(JSON.stringify({
        type: 'auth',
        ...(password ? { password } : {}),
        ...(database && database !== '0' ? { database: parseInt(database, 10) } : {}),
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          version?: string;
          response?: string;
          command?: string[];
          message?: string;
        };

        if (msg.type === 'connected') {
          setStatus('connected');
          setVersion(msg.version ?? '');
          addEntry('info', `Connected to ${host}:${port} — Redis ${msg.version ?? 'unknown'}`);
          addEntry('info', 'Type commands below. Example: GET mykey');
          inputRef.current?.focus();
        } else if (msg.type === 'response') {
          addEntry('response', msg.response ?? '');
        } else if (msg.type === 'error') {
          setStatus('disconnected');
          addEntry('error', msg.message ?? 'Error');
          setStatusMsg(msg.message ?? 'Error');
        }
      } catch {
        addEntry('info', event.data as string);
      }
    };

    ws.onerror = () => {
      addEntry('error', 'WebSocket error');
      setStatus('disconnected');
    };

    ws.onclose = (e) => {
      setStatus(prev => {
        if (prev !== 'disconnected') {
          addEntry('info', `[closed: ${e.reason || e.code}]`);
        }
        return 'disconnected';
      });
      wsRef.current = null;
    };
  };

  const handleDisconnect = () => {
    wsRef.current?.close(1000, 'user disconnect');
    wsRef.current = null;
    setStatus('disconnected');
    addEntry('info', '[disconnected]');
  };

  const sendCommand = () => {
    const trimmed = input.trim();
    if (!trimmed || wsRef.current?.readyState !== WebSocket.OPEN) return;

    const args = trimmed.split(/\s+/);
    addEntry('command', trimmed);
    wsRef.current.send(JSON.stringify({ type: 'command', command: args }));

    setCmdHistory(prev => [trimmed, ...prev.slice(0, 99)]);
    setCmdHistoryIdx(-1);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      sendCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIdx = Math.min(cmdHistoryIdx + 1, cmdHistory.length - 1);
      setCmdHistoryIdx(nextIdx);
      setInput(cmdHistory[nextIdx] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = Math.max(cmdHistoryIdx - 1, -1);
      setCmdHistoryIdx(nextIdx);
      setInput(nextIdx === -1 ? '' : (cmdHistory[nextIdx] ?? ''));
    }
  };

  const statusDot =
    status === 'connected'
      ? 'bg-green-400 animate-pulse'
      : status === 'connecting'
      ? 'bg-yellow-400 animate-pulse'
      : 'bg-slate-500';

  return (
    <div className="max-w-6xl mx-auto">      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-white hover:text-blue-400 transition-colors">
            ← Back
          </button>
          <h1 className="text-3xl font-bold text-white">Redis Client</h1>
        </div>

      <ApiExamples examples={apiExamples.Redis || []} />
        {status !== 'idle' && (
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusDot}`} />
            <span className="text-sm text-slate-300">
              {status === 'connected'
                ? `${host}:${port}${version ? ` (${version})` : ''}`
                : status === 'connecting'
                ? 'Connecting…'
                : 'Disconnected'}
            </span>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        {/* Connection panel */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Connection</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="redis-host" className="block text-sm font-medium text-slate-300 mb-1">Host</label>
                <input
                  id="redis-host"
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="redis.example.com"
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label htmlFor="redis-port" className="block text-sm font-medium text-slate-300 mb-1">Port</label>
                <input
                  id="redis-port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label htmlFor="redis-password" className="block text-sm font-medium text-slate-300 mb-1">
                  Password <span className="text-xs text-slate-400">(optional)</span>
                </label>
                <input
                  id="redis-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label htmlFor="redis-database" className="block text-sm font-medium text-slate-300 mb-1">
                  Database <span className="text-xs text-slate-400">(0–15)</span>
                </label>
                <input
                  id="redis-database"
                  type="number"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  min="0"
                  max="15"
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              {statusMsg && <p className="text-sm text-red-400">{statusMsg}</p>}

              {status !== 'connected' ? (
                <button
                  onClick={handleConnect}
                  disabled={status === 'connecting' || !host}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {status === 'connecting' ? 'Connecting…' : 'Connect'}
                </button>
              ) : (
                <button
                  onClick={handleDisconnect}
                  className="w-full bg-slate-600 hover:bg-slate-500 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Disconnect
                </button>
              )}

              <div className="pt-4 border-t border-slate-600 space-y-1 text-xs text-slate-400">
                <p>Persistent WebSocket connection.</p>
                <p>↑↓ arrow keys for command history.</p>
                <p>Examples: PING · SET k v · GET k · KEYS * · INFO server</p>
              </div>
            </div>
          </div>
        </div>

        {/* REPL */}
        <div className="lg:col-span-3">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-4 flex flex-col h-[560px]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-white">REPL</h2>
              <button
                onClick={() => setHistory([])}
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                Clear
              </button>
            </div>

            {/* Output */}
            <div
              ref={outputRef}
              className="flex-1 overflow-y-auto font-mono text-sm bg-black rounded p-3 mb-3 space-y-0.5"
            >
              {history.length === 0 && (
                <p className="text-slate-500 italic">Connect to a Redis server to start.</p>
              )}
              {history.map((entry, i) => (
                <div key={i} className={
                  entry.type === 'command'
                    ? 'text-yellow-300'
                    : entry.type === 'response'
                    ? 'text-green-400 whitespace-pre-wrap'
                    : entry.type === 'error'
                    ? 'text-red-400'
                    : 'text-slate-400'
                }>
                  {entry.type === 'command' ? `> ${entry.text}` : entry.text}
                </div>
              ))}
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <span className="text-yellow-300 font-mono text-sm self-center">{'>'}</span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={status === 'connected' ? 'PING' : 'Connect first…'}
                disabled={status !== 'connected'}
                className="flex-1 bg-black border border-slate-600 rounded px-3 py-2 text-white font-mono text-sm placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-yellow-500 disabled:opacity-40"
              />
              <button
                onClick={sendCommand}
                disabled={status !== 'connected' || !input.trim()}
                className="bg-yellow-600 hover:bg-yellow-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
