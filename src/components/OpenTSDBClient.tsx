import { useState } from 'react';

interface OpenTSDBClientProps {
  onBack: () => void;
}

export default function OpenTSDBClient({ onBack }: OpenTSDBClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4242');
  const [suggestType, setSuggestType] = useState<'metrics' | 'tagk' | 'tagv'>('metrics');
  const [suggestQuery, setSuggestQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleVersion = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/opentsdb/version', {
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
        version?: string;
        rtt?: number;
        connectTime?: number;
      };

      if (response.ok && data.success) {
        let output = `OpenTSDB Server at ${host}:${port}\n\n`;
        output += `Version: ${data.version}\n`;
        output += `RTT: ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;
        setResult(output);
      } else {
        setError(data.error || 'Version request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Version request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleStats = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/opentsdb/stats', {
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
        statCount?: number;
        stats?: { metric: string; value: string; tags: string }[];
        rtt?: number;
        connectTime?: number;
        raw?: string;
      };

      if (response.ok && data.success) {
        let output = `OpenTSDB Stats from ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;
        output += `Statistics: ${data.statCount}\n\n`;

        if (data.stats && data.stats.length > 0) {
          const maxMetricLen = Math.max(...data.stats.map(s => s.metric.length), 6);
          output += `${'METRIC'.padEnd(maxMetricLen)}  VALUE\n`;
          output += `${'─'.repeat(maxMetricLen)}  ${'─'.repeat(20)}\n`;
          for (const stat of data.stats) {
            output += `${stat.metric.padEnd(maxMetricLen)}  ${stat.value}`;
            if (stat.tags) output += `  ${stat.tags}`;
            output += '\n';
          }
        } else {
          output += '(no statistics returned)\n';
        }

        setResult(output);
      } else {
        setError(data.error || 'Stats request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stats request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSuggest = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/opentsdb/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          type: suggestType,
          query: suggestQuery || undefined,
          max: 25,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        type?: string;
        query?: string;
        count?: number;
        suggestions?: string[];
        rtt?: number;
        connectTime?: number;
      };

      if (response.ok && data.success) {
        let output = `OpenTSDB Suggest from ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;
        output += `Type: ${data.type}\n`;
        output += `Query: ${data.query}\n`;
        output += `Results: ${data.count}\n\n`;

        if (data.suggestions && data.suggestions.length > 0) {
          for (const s of data.suggestions) {
            output += `  ${s}\n`;
          }
        } else {
          output += '(no suggestions returned)\n';
        }

        setResult(output);
      } else {
        setError(data.error || 'Suggest request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suggest request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleVersion();
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
        <h1 className="text-3xl font-bold text-white">OpenTSDB Client</h1>
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
            <label htmlFor="opentsdb-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="opentsdb-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="opentsdb.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="opentsdb-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="opentsdb-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 4242</p>
          </div>
        </div>

        {/* Step 2: Actions */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Commands</h2>
          </div>

          <div className="flex gap-4 mb-4">
            <button
              onClick={handleVersion}
              disabled={loading || !host}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
              aria-label="Get OpenTSDB server version"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                  Querying...
                </span>
              ) : (
                'Version'
              )}
            </button>

            <button
              onClick={handleStats}
              disabled={loading || !host}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
              aria-label="Get OpenTSDB server statistics"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                  Querying...
                </span>
              ) : (
                'Stats'
              )}
            </button>
          </div>

          {/* Suggest section */}
          <div className="mt-4 p-4 bg-slate-700/50 rounded-lg">
            <h3 className="text-sm font-medium text-slate-300 mb-3">Suggest</h3>
            <div className="grid md:grid-cols-3 gap-3 mb-3">
              <div>
                <label htmlFor="suggest-type" className="block text-xs text-slate-400 mb-1">Type</label>
                <select
                  id="suggest-type"
                  value={suggestType}
                  onChange={(e) => setSuggestType(e.target.value as 'metrics' | 'tagk' | 'tagv')}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="metrics">Metrics</option>
                  <option value="tagk">Tag Keys</option>
                  <option value="tagv">Tag Values</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label htmlFor="suggest-query" className="block text-xs text-slate-400 mb-1">Prefix (optional)</label>
                <input
                  id="suggest-query"
                  type="text"
                  value={suggestQuery}
                  onChange={(e) => setSuggestQuery(e.target.value)}
                  placeholder="sys.cpu"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <button
              onClick={handleSuggest}
              disabled={loading || !host}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-800 text-sm"
              aria-label="Suggest metric names, tag keys, or tag values"
            >
              {loading ? 'Querying...' : 'Suggest'}
            </button>
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About OpenTSDB</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            OpenTSDB is a distributed, scalable Time Series Database built on HBase. It provides
            a telnet-style text interface on TCP port 4242 for data ingestion and queries.
            Commands include <code className="text-slate-300">version</code> (server version),
            <code className="text-slate-300"> stats</code> (internal statistics),
            <code className="text-slate-300"> suggest</code> (metric/tag autocomplete), and
            <code className="text-slate-300"> put</code> (data point ingestion). OpenTSDB is
            widely deployed in monitoring and observability stacks alongside tools like Grafana,
            Collectd, and Bosun.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
