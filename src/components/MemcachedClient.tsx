import { useState } from 'react';

interface MemcachedClientProps {
  onBack: () => void;
}

export default function MemcachedClient({ onBack }: MemcachedClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('11211');
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleConnect = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/memcached/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        version?: string;
        host?: string;
        port?: number;
      };

      if (response.ok && data.success) {
        setResult(`Connected to Memcached at ${host}:${port}\n\nVersion: ${data.version || 'Unknown'}`);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteCommand = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    if (!command.trim()) {
      setError('Command is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/memcached/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          command: command.trim(),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        response?: string;
        command?: string;
      };

      if (response.ok && data.success) {
        setResult(`Command: ${data.command}\n\nResponse:\n${data.response || ''}`);
      } else {
        setError(data.error || 'Command failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Command failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGetStats = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/memcached/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        stats?: Record<string, string>;
        raw?: string;
      };

      if (response.ok && data.success) {
        let statsText = `Memcached Stats for ${host}:${port}\n\n`;
        if (data.stats) {
          for (const [key, value] of Object.entries(data.stats)) {
            statsText += `${key}: ${value}\n`;
          }
        }
        setResult(statsText);
      } else {
        setError(data.error || 'Stats retrieval failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stats retrieval failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDownConnect = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleConnect();
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-white hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
          aria-label="Go back to protocol selector"
        >
          ← Back
        </button>
        <h1 className="text-3xl font-bold text-white">Memcached Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="memcached-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="memcached-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDownConnect}
              placeholder="memcached.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="memcached-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="memcached-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDownConnect}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 11211</p>
          </div>
        </div>

        <div className="flex gap-3 mb-6">
          <button
            onClick={handleConnect}
            disabled={loading || !host}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Test Memcached connection"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Connecting...
              </span>
            ) : (
              'Test Connection'
            )}
          </button>

          <button
            onClick={handleGetStats}
            disabled={loading || !host}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Get Memcached stats"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Loading...
              </span>
            ) : (
              'Get Stats'
            )}
          </button>
        </div>

        {/* Step 2: Execute Command */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Execute Command</h2>
          </div>

          <div className="mb-4">
            <label htmlFor="memcached-command" className="block text-sm font-medium text-slate-300 mb-1">
              Memcached Command
            </label>
            <input
              id="memcached-command"
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="get mykey"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) {
                  handleExecuteCommand();
                }
              }}
              aria-describedby="memcached-command-help"
            />
            <p id="memcached-command-help" className="text-xs text-slate-400 mt-1">
              Examples: get mykey, set mykey 0 3600 hello world, delete mykey, stats, version, flush_all
            </p>
          </div>

          <button
            onClick={handleExecuteCommand}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Execute Memcached command"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Executing...
              </span>
            ) : (
              'Execute Command'
            )}
          </button>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600" role="region" aria-live="polite">
            <div className="flex items-center gap-2 mb-2">
              {error ? (
                <span className="text-red-400 text-xl" aria-hidden="true">✕</span>
              ) : (
                <span className="text-green-400 text-xl" aria-hidden="true">✓</span>
              )}
              <h3 className="text-sm font-semibold text-slate-300">
                {error ? 'Error' : 'Success'}
              </h3>
            </div>
            <pre className={`text-sm whitespace-pre-wrap font-mono ${
              error ? 'text-red-400' : 'text-green-400'
            }`}>
              {error || result}
            </pre>
          </div>
        )}

        {/* Help Section */}
        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Memcached</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Memcached is a high-performance distributed memory caching system used to speed up web applications
            by caching data in RAM. It uses a simple text protocol on port 11211. For storage commands
            (set, add, replace), use the format: set &lt;key&gt; &lt;flags&gt; &lt;exptime&gt; &lt;value&gt;.
            The byte count is calculated automatically.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
