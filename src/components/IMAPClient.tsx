import { useState, useRef, useEffect, useCallback } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface IMAPClientProps {
  onBack: () => void;
}

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected';

interface HistoryEntry {
  type: 'command' | 'response' | 'error' | 'info';
  text: string;
}

export default function IMAPClient({ onBack }: IMAPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('143');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdHistoryIdx, setCmdHistoryIdx] = useState(-1);

  const wsRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const addEntry = useCallback((type: HistoryEntry['type'], text: string) => {
    setHistory(prev => {
      const next = [...prev, { type, text }];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  const handleConnect = () => {
    if (!host || !username || !password) {
      setStatusMsg('Host, username, and password are required.');
      return;
    }
    setStatus('connecting');
    setStatusMsg('');
    setHistory([]);

    const params = new URLSearchParams({ host, port, username, password });
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/imap/session?${params}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          greeting?: string;
          capabilities?: string;
          response?: string;
          tag?: string;
          command?: string;
          message?: string;
        };

        if (msg.type === 'connected') {
          setStatus('connected');
          addEntry('info', `Connected to ${host}:${port} as ${username}`);
          if (msg.capabilities) {
            addEntry('info', `Capabilities: ${msg.capabilities}`);
          }
          addEntry('info', 'Enter raw IMAP commands (without tag). Example: LIST "" *');
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
      addEntry('info', `[closed: ${e.reason || e.code}]`);
      setStatus('disconnected');
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

    addEntry('command', trimmed);
    wsRef.current.send(JSON.stringify({ type: 'command', command: trimmed }));

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

  const insertCommand = (cmd: string) => {
    setInput(cmd);
    inputRef.current?.focus();
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
          <h1 className="text-3xl font-bold text-white">IMAP Client</h1>
        </div>

      <ApiExamples examples={apiExamples.IMAP || []} />
        {status !== 'idle' && (
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusDot}`} />
            <span className="text-sm text-slate-300">
              {status === 'connected'
                ? `${username}@${host}:${port}`
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
                <label className="block text-sm font-medium text-slate-300 mb-1">Host</label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="imap.example.com"
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Port</label>
                <select
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="143">143 (IMAP)</option>
                  <option value="993">993 (IMAPS)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="user@example.com"
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              {statusMsg && <p className="text-sm text-red-400">{statusMsg}</p>}

              {status !== 'connected' ? (
                <button
                  onClick={handleConnect}
                  disabled={status === 'connecting' || !host || !username || !password}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

              {/* Quick command buttons */}
              <div className="pt-4 border-t border-slate-600">
                <p className="text-xs text-slate-400 mb-2">Quick commands:</p>
                <div className="space-y-1">
                  {['LIST "" *', 'SELECT INBOX', 'STATUS INBOX (MESSAGES UNSEEN)', 'FETCH 1 ENVELOPE', 'FETCH 1:5 FLAGS', 'LOGOUT'].map(cmd => (
                    <button
                      key={cmd}
                      onClick={() => insertCommand(cmd)}
                      disabled={status !== 'connected'}
                      className="w-full text-left text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded font-mono disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Session output */}
        <div className="lg:col-span-3">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-4 flex flex-col h-[560px]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-white">Session</h2>
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
                <p className="text-slate-500 italic">Connect to an IMAP server to start. Tags are assigned automatically.</p>
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
                placeholder={status === 'connected' ? 'LIST "" *' : 'Connect first…'}
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
