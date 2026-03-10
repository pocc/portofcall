import { useState, useRef, useEffect } from 'react';
import type { IDisposable } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';
import { usePersistedState } from '../hooks/usePersistedState';

interface SSHClientProps {
  onBack: () => void;
}

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected';

export default function SSHClient({ onBack }: SSHClientProps) {
  const [host, setHost] = usePersistedState('ssh-host', '');
  const [port, setPort] = usePersistedState('ssh-port', '22');
  const [username, setUsername] = usePersistedState('ssh-username', '');
  const [authMethod, setAuthMethod] = usePersistedState('ssh-authMethod', 'password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState('');

  const termDivRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onDataRef = useRef<IDisposable | null>(null);
  const onResizeRef = useRef<IDisposable | null>(null);

  // Close WebSocket and clear sensitive state on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
        wsRef.current.close(1000, 'component unmount');
      }
      wsRef.current = null;
      setPassword('');
      setPrivateKey('');
      setPassphrase('');
    };
  }, []);

  // Initialise xterm when component mounts
  useEffect(() => {
    if (!termDivRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#000000',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termDivRef.current);
    fit.fit();

    term.writeln('\x1b[1;32mSSH Terminal\x1b[0m — connect to a server to start a session.');

    termRef.current = term;
    fitRef.current = fit;

    const handleResize = () => {
      fit.fit();
      // Resize event is sent to server via term.onResize listener (registered on connect)
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  const handleConnect = () => {
    if (!host || !username) {
      setStatusMsg('Host and username are required.');
      return;
    }
    if (authMethod === 'password' && !password) {
      setStatusMsg('Password is required.');
      return;
    }
    if (authMethod === 'privateKey' && !privateKey) {
      setStatusMsg('Private key is required.');
      return;
    }

    setStatus('connecting');
    setStatusMsg('');

    // Only non-sensitive params in the URL; credentials sent via WS message
    const params = new URLSearchParams({ host, port });

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/ssh/terminal?${params}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    const term = termRef.current!;

    // Connection timeout — abort if not connected within 15s
    const connectTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        setStatus('disconnected');
        setStatusMsg('Connection timed out after 15 seconds.');
        term.writeln('\x1b[1;31m✗ Connection timed out.\x1b[0m');
      }
    }, 15_000);

    ws.onopen = () => {
      // Send credentials + terminal dimensions as the first message (never in the URL)
      ws.send(JSON.stringify({
        username,
        authMethod,
        ...(authMethod === 'password' ? { password } : { privateKey }),
        ...(passphrase ? { passphrase } : {}),
        cols: term.cols,
        rows: term.rows,
      }));
      term.writeln('\x1b[90mWebSocket open — performing SSH handshake…\x1b[0m');
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        // Control message (JSON)
        try {
          const msg = JSON.parse(event.data) as { type: string; message?: string };
          if (msg.type === 'info') {
            term.writeln(`\x1b[90m${msg.message}\x1b[0m`);
          } else if (msg.type === 'error') {
            term.writeln(`\x1b[1;31m✗ ${msg.message}\x1b[0m`);
            setStatus('disconnected');
            setStatusMsg(msg.message ?? 'Error');
          } else if (msg.type === 'connected') {
            clearTimeout(connectTimeout);
            setStatus('connected');
            setStatusMsg('');
            term.writeln('\x1b[1;32m✓ Connected\x1b[0m\r\n');
            // Focus terminal — delay slightly so xterm's internal textarea is ready
            requestAnimationFrame(() => {
              term.focus();
              // Also directly focus xterm's hidden textarea as a fallback
              const textarea = termDivRef.current?.querySelector('textarea');
              if (textarea) textarea.focus();
            });
            // Wire up user input after connection (dispose previous listener to avoid duplicates)
            onDataRef.current?.dispose();
            onDataRef.current = term.onData((data) => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(data);
              }
            });
            // Wire up terminal resize → server notification
            onResizeRef.current?.dispose();
            onResizeRef.current = term.onResize(({ cols, rows }) => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
              }
            });
          } else if (msg.type === 'disconnected') {
            setStatus('disconnected');
            term.writeln('\r\n\x1b[90m[session closed]\x1b[0m');
          }
        } catch {
          // Not JSON — treat as terminal output
          term.write(event.data);
        }
      } else {
        // Binary — raw terminal bytes (ANSI sequences etc.)
        term.write(new Uint8Array(event.data as ArrayBuffer));
      }
    };

    ws.onerror = () => {
      clearTimeout(connectTimeout);
      term.writeln('\x1b[1;31m✗ WebSocket error\x1b[0m');
      setStatus('disconnected');
    };

    ws.onclose = (event) => {
      clearTimeout(connectTimeout);
      setStatus(prev => {
        if (prev !== 'disconnected') {
          term.writeln(`\r\n\x1b[90m[closed: ${event.reason || event.code}]\x1b[0m`);
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
          <h1 className="text-3xl font-bold text-white">SSH Client</h1>
        </div>
        {status !== 'idle' && (
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusDot}`} aria-hidden="true" />
            <span className="text-sm text-slate-300">
              {status === 'connected'
                ? `${username}@${host}`
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

            <form onSubmit={(e) => { e.preventDefault(); if (status !== 'connected' && status !== 'connecting') handleConnect(); }} className="space-y-4">
              <div>
                <label htmlFor="ssh-host" className="block text-sm font-medium text-slate-300 mb-1">Host</label>
                <input
                  id="ssh-host"
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.1.1"
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label htmlFor="ssh-port" className="block text-sm font-medium text-slate-300 mb-1">Port</label>
                <input
                  id="ssh-port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label htmlFor="ssh-username" className="block text-sm font-medium text-slate-300 mb-1">Username</label>
                <input
                  id="ssh-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="root"
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label htmlFor="ssh-auth-method" className="block text-sm font-medium text-slate-300 mb-1">Auth method</label>
                <select
                  id="ssh-auth-method"
                  value={authMethod}
                  onChange={(e) => setAuthMethod(e.target.value)}
                  disabled={status === 'connected' || status === 'connecting'}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="password">Password</option>
                  <option value="privateKey">Private key (Ed25519)</option>
                </select>
              </div>

              {authMethod === 'password' ? (
                <div>
                  <label htmlFor="ssh-password" className="block text-sm font-medium text-slate-300 mb-1">Password</label>
                  <input
                    id="ssh-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={status === 'connected' || status === 'connecting'}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="ssh-private-key" className="block text-sm font-medium text-slate-300 mb-1">
                      Private key
                      <span className="text-xs text-slate-400 ml-1">(OpenSSH Ed25519)</span>
                    </label>
                    <p className="text-xs text-slate-400 mb-1">Ed25519 only. Passphrase-protected keys are supported — enter the passphrase below.</p>
                    <textarea
                      id="ssh-private-key"
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
                      disabled={status === 'connected' || status === 'connecting'}
                      rows={6}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 font-mono text-xs resize-none"
                    />
                    <input
                      type="file"
                      aria-label="Upload private key file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 65536) {
                            setStatusMsg('Key file too large (max 64 KB)');
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = (ev) => setPrivateKey(ev.target?.result as string);
                          reader.onerror = () => setStatusMsg('Failed to read key file');
                          reader.readAsText(file);
                        }
                      }}
                      disabled={status === 'connected' || status === 'connecting'}
                      className="mt-2 text-xs text-slate-400 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-600 file:text-white hover:file:bg-slate-500 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="ssh-passphrase" className="block text-sm font-medium text-slate-300 mb-1">
                      Passphrase <span className="text-xs text-slate-400">(if encrypted)</span>
                    </label>
                    <input
                      id="ssh-passphrase"
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="optional"
                      disabled={status === 'connected' || status === 'connecting'}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>
                </>
              )}

              <div aria-live="polite" aria-atomic="true">
                {statusMsg && (
                  <p className="text-sm text-red-400">{statusMsg}</p>
                )}
              </div>

              {status !== 'connected' ? (
                <button
                  type="submit"
                  disabled={status === 'connecting'}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {status === 'connecting' ? 'Connecting…' : 'Connect'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Disconnect
                </button>
              )}

              <div className="pt-4 border-t border-slate-600 space-y-1 text-xs text-slate-400">
                <p>Supports Ed25519 private keys.</p>
                <p>RSA/ECDSA keys: convert with <code className="font-mono">ssh-keygen -t ed25519</code>.</p>
              </div>
            </form>
          </div>
        </div>

        {/* Terminal */}
        <div className="lg:col-span-3">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-white">Terminal</h2>
              <button
                onClick={() => termRef.current?.clear()}
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                Clear
              </button>
            </div>
            {/* xterm.js mounts here — give it a fixed height */}
            <div
              ref={termDivRef}
              role="application"
              aria-label="SSH terminal"
              className="h-[480px] rounded overflow-hidden"
              tabIndex={0}
              onClick={() => termRef.current?.focus()}
            />
          </div>
        </div>
      </div>
      <ApiExamples examples={apiExamples.SSH || []} protocolId="ssh" />
    </div>
  );
}
