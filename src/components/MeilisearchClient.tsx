import { useState } from 'react';

interface MeilisearchClientProps {
  onBack: () => void;
}

export default function MeilisearchClient({ onBack }: MeilisearchClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('7700');
  const [apiKey, setApiKey] = useState('');
  const [index, setIndex] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleHealth = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/meilisearch/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          apiKey: apiKey || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        health?: { status?: string };
        version?: { pkgVersion?: string; commitSha?: string; commitDate?: string };
        stats?: { databaseSize?: number; indexes?: Record<string, { numberOfDocuments?: number; isIndexing?: boolean }> };
        indexes?: { results?: Array<{ uid?: string; primaryKey?: string; createdAt?: string; updatedAt?: string }> };
        latencyMs?: number;
        host?: string;
        port?: number;
      };

      if (response.ok && data.success) {
        let text = `Meilisearch at ${data.host}:${data.port}\n`;
        text += `Status: ${data.statusCode} (${data.latencyMs}ms)\n\n`;

        if (data.health) {
          text += `Health: ${typeof data.health === 'object' ? JSON.stringify(data.health) : data.health}\n`;
        }

        if (data.version) {
          const v = data.version;
          text += `\nVersion: ${v.pkgVersion || 'unknown'}`;
          if (v.commitSha) text += `\nCommit:  ${v.commitSha}`;
          if (v.commitDate) text += `\nDate:    ${v.commitDate}`;
          text += '\n';
        }

        if (data.stats) {
          const s = data.stats;
          if (s.databaseSize !== undefined) {
            const sizeMB = (s.databaseSize / (1024 * 1024)).toFixed(2);
            text += `\nDatabase Size: ${sizeMB} MB`;
          }
          if (s.indexes) {
            const indexNames = Object.keys(s.indexes);
            text += `\nIndexes (${indexNames.length}):`;
            for (const name of indexNames) {
              const idx = s.indexes[name];
              text += `\n  ${name}: ${idx.numberOfDocuments ?? '?'} docs${idx.isIndexing ? ' (indexing...)' : ''}`;
            }
          }
        }

        if (data.indexes && data.indexes.results) {
          text += `\n\nIndex Details:`;
          for (const idx of data.indexes.results) {
            text += `\n  ${idx.uid} (pk: ${idx.primaryKey || 'auto'})`;
            if (idx.createdAt) text += `\n    Created: ${idx.createdAt}`;
          }
        }

        setResult(text);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }
    if (!index) {
      setError('Index name is required for search');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/meilisearch/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          apiKey: apiKey || undefined,
          index,
          query,
          limit: 20,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        results?: {
          hits?: Array<Record<string, unknown>>;
          query?: string;
          processingTimeMs?: number;
          limit?: number;
          offset?: number;
          estimatedTotalHits?: number;
        };
        latencyMs?: number;
        index?: string;
        query?: string;
      };

      if (response.ok && data.success) {
        const r = data.results;
        let text = `Search "${data.query || ''}" in index "${data.index}"\n`;
        text += `Status: ${data.statusCode} (${data.latencyMs}ms)\n`;

        if (r) {
          if (r.processingTimeMs !== undefined) {
            text += `Processing: ${r.processingTimeMs}ms\n`;
          }
          text += `Estimated Total: ${r.estimatedTotalHits ?? '?'}\n`;
          text += `Showing: ${r.hits?.length ?? 0} results\n`;

          if (r.hits && r.hits.length > 0) {
            text += '\n--- Results ---\n';
            for (let i = 0; i < r.hits.length; i++) {
              text += `\n[${i + 1}] ${JSON.stringify(r.hits[i], null, 2)}\n`;
            }
          } else {
            text += '\nNo results found.';
          }
        }

        setResult(text);
      } else {
        setError(data.error || 'Search failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleHealth();
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
        <h1 className="text-3xl font-bold text-white">Meilisearch Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="meili-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="meili-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="search.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="meili-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="meili-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 7700</p>
          </div>
        </div>

        <div className="mb-6">
          <label htmlFor="meili-apikey" className="block text-sm font-medium text-slate-300 mb-1">
            API Key
          </label>
          <input
            id="meili-apikey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Optional master or search API key"
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-slate-400 mt-1">Leave empty if no authentication is configured</p>
        </div>

        <button
          onClick={handleHealth}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Check Meilisearch health"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Connecting...
            </span>
          ) : (
            'Check Health & Info'
          )}
        </button>

        {/* Step 2: Search */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Search</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="meili-index" className="block text-sm font-medium text-slate-300 mb-1">
                Index <span className="text-red-400" aria-label="required">*</span>
              </label>
              <input
                id="meili-index"
                type="text"
                value={index}
                onChange={(e) => setIndex(e.target.value)}
                placeholder="movies"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="meili-query" className="block text-sm font-medium text-slate-300 mb-1">
                Query
              </label>
              <input
                id="meili-query"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search terms..."
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <button
            onClick={handleSearch}
            disabled={loading || !host || !index}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Search Meilisearch index"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Searching...
              </span>
            ) : (
              'Search'
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Meilisearch</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Meilisearch is a lightning-fast, typo-tolerant full-text search engine. It uses an HTTP REST API
            on port 7700 by default. Authentication uses Bearer token API keys. Indexes contain documents
            that are searchable via the POST search endpoint.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs mt-3">
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">GET /health</span>
              <span className="text-slate-300 ml-2">Server health status</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">GET /version</span>
              <span className="text-slate-300 ml-2">Version & build info</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">GET /stats</span>
              <span className="text-slate-300 ml-2">Database statistics</span>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded">
              <span className="text-blue-400 font-mono">POST /search</span>
              <span className="text-slate-300 ml-2">Full-text search</span>
            </div>
          </div>
          <p className="text-xs text-slate-500 italic mt-3">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
