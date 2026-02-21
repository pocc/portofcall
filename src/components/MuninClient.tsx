import { useState } from 'react';

interface MuninClientProps {
  onBack: () => void;
}

export default function MuninClient({ onBack }: MuninClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4949');
  const [plugin, setPlugin] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [plugins, setPlugins] = useState<string[]>([]);

  const handleConnect = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/munin/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        banner?: string;
        nodeName?: string;
        version?: string;
        capabilities?: string[];
        pluginCount?: number;
        plugins?: string[];
        connectTime?: number;
      };

      if (response.ok && data.success) {
        let output = `Munin Node at ${host}:${port}\n\n`;
        output += `Banner: ${data.banner}\n`;
        output += `Node: ${data.nodeName}\n`;
        output += `Version: ${data.version}\n`;
        output += `Connect: ${data.connectTime}ms\n`;

        if (data.capabilities && data.capabilities.length > 0) {
          output += `Capabilities: ${data.capabilities.join(', ')}\n`;
        }

        output += `\nPlugins (${data.pluginCount}):\n`;
        if (data.plugins && data.plugins.length > 0) {
          // Display in columns
          const cols = 3;
          const maxLen = Math.max(...data.plugins.map(p => p.length), 10);
          for (let i = 0; i < data.plugins.length; i += cols) {
            const row = data.plugins.slice(i, i + cols);
            output += '  ' + row.map(p => p.padEnd(maxLen + 2)).join('') + '\n';
          }
          setPlugins(data.plugins);
        } else {
          output += '  (none)\n';
          setPlugins([]);
        }

        setResult(output);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFetch = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }
    if (!plugin) {
      setError('Plugin name is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/munin/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          plugin,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        plugin?: string;
        rtt?: number;
        connectTime?: number;
        valueCount?: number;
        values?: { field: string; value: string }[];
        raw?: string;
      };

      if (response.ok && data.success) {
        let output = `Munin Fetch: ${data.plugin} @ ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms (connect: ${data.connectTime}ms)\n\n`;

        if (data.values && data.values.length > 0) {
          const maxFieldLen = Math.max(...data.values.map(v => v.field.length), 5);
          output += `${'FIELD'.padEnd(maxFieldLen)}  VALUE\n`;
          output += `${'─'.repeat(maxFieldLen)}  ${'─'.repeat(20)}\n`;
          for (const v of data.values) {
            output += `${v.field.padEnd(maxFieldLen)}  ${v.value}\n`;
          }
        } else {
          output += '(no values returned)\n';
        }

        setResult(output);
      } else {
        setError(data.error || data.message || 'Fetch failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
        <h1 className="text-3xl font-bold text-white">Munin Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Node Connection</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="munin-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="munin-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="munin-node.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="munin-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="munin-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 4949</p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 mb-6"
          aria-label="Connect to Munin node and list plugins"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Connecting...
            </span>
          ) : (
            'Connect & List Plugins'
          )}
        </button>

        {/* Step 2: Fetch Plugin */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Fetch Plugin Data</h2>
          </div>

          <div className="mb-4">
            <label htmlFor="munin-plugin" className="block text-sm font-medium text-slate-300 mb-1">
              Plugin Name <span className="text-red-400" aria-label="required">*</span>
            </label>
            <div className="flex gap-2">
              <input
                id="munin-plugin"
                type="text"
                value={plugin}
                onChange={(e) => setPlugin(e.target.value)}
                placeholder="cpu, memory, df, etc."
                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-required="true"
                list="munin-plugins-list"
              />
              <button
                onClick={handleFetch}
                disabled={loading || !host || !plugin}
                className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
                aria-label="Fetch current values from the specified plugin"
              >
                {loading ? 'Fetching...' : 'Fetch'}
              </button>
            </div>
            {plugins.length > 0 && (
              <datalist id="munin-plugins-list">
                {plugins.map(p => <option key={p} value={p} />)}
              </datalist>
            )}
            <p className="text-xs text-slate-400 mt-1">Connect first to discover available plugins</p>
          </div>
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Munin</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Munin is a networked resource monitoring tool that uses a simple text protocol on TCP
            port 4949. The munin-node daemon runs on monitored hosts and exposes system metrics
            through plugins. Common plugins include <code className="text-slate-300">cpu</code>,
            <code className="text-slate-300"> memory</code>, <code className="text-slate-300">df</code>,
            <code className="text-slate-300"> if_eth0</code>, <code className="text-slate-300">load</code>,
            and <code className="text-slate-300">processes</code>. The protocol uses plain text
            commands with dot-terminated multi-line responses, making it easy to probe and inspect.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
