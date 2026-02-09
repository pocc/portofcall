import { useState } from 'react';

interface IMAPClientProps {
  onBack: () => void;
}

export default function IMAPClient({ onBack }: IMAPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('143');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleConnect = async () => {
    if (!host || !username || !password) {
      setError('Host, username, and password are required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/imap/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username,
          password,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        greeting?: string;
        authenticated?: boolean;
      };

      if (response.ok && data.success && data.authenticated) {
        setConnected(true);
        setResult(`Connected to ${host}:${port}\n\nGreeting: ${data.greeting || 'N/A'}`);
        loadMailboxes();
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const loadMailboxes = async () => {
    if (!host || !username || !password) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/imap/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username,
          password,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        mailboxes?: string[];
        count?: number;
      };

      if (response.ok && data.success) {
        setMailboxes(data.mailboxes || []);
        setResult(`Found ${data.count || 0} mailbox(es)`);
      } else {
        setError(data.error || 'Failed to list mailboxes');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list mailboxes');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMailbox = async (mailbox: string) => {
    if (!host || !username || !password) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/imap/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username,
          password,
          mailbox,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        exists?: number;
        recent?: number;
        message?: string;
      };

      if (response.ok && data.success) {
        setResult(`Selected: ${mailbox}\n\nTotal messages: ${data.exists || 0}\nRecent: ${data.recent || 0}`);
      } else {
        setError(data.error || 'Failed to select mailbox');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select mailbox');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    setConnected(false);
    setMailboxes([]);
    setResult('');
    setError('');
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-white hover:text-blue-400 transition-colors">
            ← Back
          </button>
          <h1 className="text-3xl font-bold text-white">IMAP Client</h1>
        </div>
        {connected && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-green-400 text-sm">Connected to {host}:{port}</span>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Server</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Host</label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="imap.example.com"
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Port</label>
                <select
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={connected}
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
                  placeholder="username"
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="password"
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
              {!connected ? (
                <button
                  onClick={handleConnect}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Connecting...' : 'Connect'}
                </button>
              ) : (
                <>
                  <button
                    onClick={loadMailboxes}
                    disabled={loading}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-2"
                  >
                    {loading ? 'Loading...' : 'Refresh Mailboxes'}
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
            <div className="mt-6 pt-6 border-t border-slate-600">
              <h3 className="text-sm font-semibold text-slate-300 mb-2">About IMAP</h3>
              <p className="text-xs text-slate-400">
                Internet Message Access Protocol for advanced email management.
                Port 143 (plain) or 993 (SSL/TLS). Supports multiple folders and server-side organization.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Mailboxes</h2>
            {!connected ? (
              <div className="text-center py-12 text-slate-500">
                Connect to an IMAP server to view mailboxes
              </div>
            ) : (
              <div>
                {mailboxes.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    {loading ? 'Loading mailboxes...' : 'No mailboxes found'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mailboxes.map((mailbox) => (
                      <button
                        key={mailbox}
                        onClick={() => handleSelectMailbox(mailbox)}
                        disabled={loading}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg p-4 hover:bg-slate-600 transition-colors text-left disabled:opacity-50"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">📁</span>
                          <span className="text-slate-300">{mailbox}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(result || error) && (
              <div className="mt-4 bg-slate-900 rounded-lg p-4 border border-slate-600">
                <pre className={`text-sm whitespace-pre-wrap font-mono ${
                  error ? 'text-red-400' : 'text-green-400'
                }`}>
                  {error || result}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
