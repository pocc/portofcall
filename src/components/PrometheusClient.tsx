import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface PrometheusProps {
  onBack: () => void;
}

interface HealthResult {
  success: boolean;
  error?: string;
  host?: string;
  port?: number;
  healthy?: boolean;
  ready?: boolean;
  healthMessage?: string;
  statusCode?: number;
  latencyMs?: number;
  version?: string | null;
  revision?: string | null;
  goVersion?: string | null;
  branch?: string | null;
  activeTargets?: number | null;
  isCloudflare?: boolean;
}

interface QueryResult {
  success: boolean;
  error?: string;
  host?: string;
  port?: number;
  query?: string;
  statusCode?: number;
  latencyMs?: number;
  status?: string;
  resultType?: string | null;
  resultCount?: number;
  results?: Array<{
    metric: Record<string, string>;
    value?: { timestamp: number; value: string } | null;
    values?: Array<{ timestamp: number; value: string }> | null;
  }>;
  warnings?: string[] | null;
  errorType?: string | null;
}

interface MetricsResult {
  success: boolean;
  error?: string;
  host?: string;
  port?: number;
  statusCode?: number;
  latencyMs?: number;
  metricFamilyCount?: number;
  sampleCount?: number;
  typeCounts?: Record<string, number>;
  preview?: Array<{ name: string; value: string | null; raw: string }>;
  contentType?: string | null;
}

type TabType = 'health' | 'query' | 'metrics';

export default function PrometheusClient({ onBack }: PrometheusProps) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';

  const [host, setHost] = useState('');
  const [port, setPort] = useState('9090');
  const [query, setQuery] = useState('up');

  const [activeTab, setActiveTab] = useState<TabType>('health');
  const [loading, setLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<HealthResult | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [metricsResult, setMetricsResult] = useState<MetricsResult | null>(null);

  const handleHealth = async () => {
    if (!host) return;
    setLoading(true);
    setHealthResult(null);

    try {
      const response = await fetch('/api/prometheus/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port) || 9090, timeout: 15000 }),
      });
      setHealthResult(await response.json());
    } catch (err) {
      setHealthResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async () => {
    if (!host || !query) return;
    setLoading(true);
    setQueryResult(null);

    try {
      const response = await fetch('/api/prometheus/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port) || 9090, query, timeout: 15000 }),
      });
      setQueryResult(await response.json());
    } catch (err) {
      setQueryResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleMetrics = async () => {
    if (!host) return;
    setLoading(true);
    setMetricsResult(null);

    try {
      const response = await fetch('/api/prometheus/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port) || 9090, timeout: 15000 }),
      });
      setMetricsResult(await response.json());
    } catch (err) {
      setMetricsResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleAction = () => {
    if (activeTab === 'health') handleHealth();
    else if (activeTab === 'query') handleQuery();
    else handleMetrics();
  };

  const formatMetricLabels = (metric: Record<string, string>) => {
    const entries = Object.entries(metric).filter(([k]) => k !== '__name__');
    if (entries.length === 0) return '';
    return '{' + entries.map(([k, v]) => `${k}="${v}"`).join(', ') + '}';
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className={`${isRetro ? 'retro-button' : 'bg-slate-700 hover:bg-slate-600'} text-white px-3 py-2 rounded-lg transition-colors`}
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 ${isRetro ? 'retro-card' : 'bg-gradient-to-br from-red-500 to-orange-600'} rounded-xl flex items-center justify-center`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-white" />
              <path d="M4 15l4-2 4 3 4-4 4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white" />
              <circle cx="8" cy="13" r="1.5" fill="currentColor" className="text-white" />
              <circle cx="12" cy="16" r="1.5" fill="currentColor" className="text-white" />
              <circle cx="16" cy="11" r="1.5" fill="currentColor" className="text-white" />
            </svg>
          </div>
          <div>
            <h1 className={`text-2xl font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>Prometheus Client</h1>
            <p className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>
              Time-Series Monitoring & Alerting · Port 9090 · PromQL
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(['health', 'query', 'metrics'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === tab
                ? isRetro ? 'retro-button-active' : 'bg-red-600 text-white'
                : isRetro ? 'retro-button' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {tab === 'health' ? 'Health & Info' : tab === 'query' ? 'PromQL Query' : 'Metrics Scrape'}
          </button>
        ))}
      </div>

      {/* Connection Form */}
      <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
        <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
          Connection Settings
        </h2>
        <div className={`grid grid-cols-1 ${activeTab === 'query' ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4 mb-4`}>
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
              Prometheus Server
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="prometheus.example.com"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-red-500`}
            />
          </div>
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
              Port
            </label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="9090"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-red-500`}
            />
          </div>
          {activeTab === 'query' && (
            <div>
              <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                PromQL Query
              </label>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="up"
                className={`w-full px-3 py-2 rounded-lg font-mono ${
                  isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
                } focus:outline-none focus:ring-2 focus:ring-red-500`}
              />
            </div>
          )}
        </div>

        {/* Quick query buttons */}
        {activeTab === 'query' && (
          <div className="flex flex-wrap gap-2 mb-4">
            {['up', 'scrape_duration_seconds', 'prometheus_build_info', 'process_cpu_seconds_total', 'go_goroutines'].map((q) => (
              <button
                key={q}
                onClick={() => setQuery(q)}
                className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                  query === q
                    ? isRetro ? 'retro-button-active' : 'bg-red-600/30 text-red-300 border border-red-500/30'
                    : isRetro ? 'retro-button' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={handleAction}
          disabled={loading || !host || (activeTab === 'query' && !query)}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            loading || !host || (activeTab === 'query' && !query)
              ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
              : isRetro ? 'retro-button' : 'bg-red-600 hover:bg-red-500 text-white'
          }`}
        >
          {loading
            ? activeTab === 'health' ? 'Checking...' : activeTab === 'query' ? 'Querying...' : 'Scraping...'
            : activeTab === 'health' ? 'Check Health' : activeTab === 'query' ? 'Execute Query' : 'Scrape Metrics'}
        </button>
      </div>

      {/* Health Result */}
      {activeTab === 'health' && healthResult && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Server Status
          </h2>
          {!healthResult.success ? (
            <div className={`p-4 rounded-lg ${isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'}`}>
              <p className="text-red-400">{healthResult.error}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Health</p>
                  <p className={`text-lg font-bold ${healthResult.healthy ? 'text-green-400' : 'text-red-400'}`}>
                    {healthResult.healthy ? 'Healthy' : 'Unhealthy'}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Ready</p>
                  <p className={`text-lg font-bold ${healthResult.ready ? 'text-green-400' : 'text-yellow-400'}`}>
                    {healthResult.ready ? 'Ready' : 'Not Ready'}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Version</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {healthResult.version || 'N/A'}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Latency</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>
                    {healthResult.latencyMs}ms
                  </p>
                </div>
              </div>

              <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg overflow-hidden`}>
                <table className="w-full text-sm">
                  <tbody>
                    {healthResult.version && (
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Version</td>
                        <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>{healthResult.version}</td>
                      </tr>
                    )}
                    {healthResult.revision && (
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Revision</td>
                        <td className={`px-4 py-2 font-mono ${isRetro ? 'retro-text' : 'text-white'}`}>{healthResult.revision}</td>
                      </tr>
                    )}
                    {healthResult.goVersion && (
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Go Version</td>
                        <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>{healthResult.goVersion}</td>
                      </tr>
                    )}
                    {healthResult.branch && (
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Branch</td>
                        <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>{healthResult.branch}</td>
                      </tr>
                    )}
                    {healthResult.activeTargets !== null && healthResult.activeTargets !== undefined && (
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Active Targets</td>
                        <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>{healthResult.activeTargets}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Query Result */}
      {activeTab === 'query' && queryResult && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Query Result
          </h2>
          {!queryResult.success ? (
            <div className={`p-4 rounded-lg ${isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'}`}>
              <p className="text-red-400">{queryResult.error || queryResult.errorType}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Status</p>
                  <p className={`text-lg font-bold ${queryResult.status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                    {queryResult.status}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Type</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {queryResult.resultType || 'N/A'}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Results</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {queryResult.resultCount}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Latency</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>
                    {queryResult.latencyMs}ms
                  </p>
                </div>
              </div>

              {/* Query expression */}
              <div className={`mb-4 p-3 rounded-lg ${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'}`}>
                <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Query</p>
                <p className={`font-mono ${isRetro ? 'retro-text' : 'text-red-300'}`}>{queryResult.query}</p>
              </div>

              {/* Results table */}
              {queryResult.results && queryResult.results.length > 0 && (
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg overflow-hidden`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <th className={`px-4 py-2 text-left ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Metric</th>
                        <th className={`px-4 py-2 text-right ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.results.map((r, i) => (
                        <tr key={i} className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                          <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>
                            <span className="font-mono text-xs">
                              <span className={isRetro ? 'retro-text' : 'text-red-300'}>{r.metric.__name__ || 'unnamed'}</span>
                              <span className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>{formatMetricLabels(r.metric)}</span>
                            </span>
                          </td>
                          <td className={`px-4 py-2 text-right font-mono ${isRetro ? 'retro-text' : 'text-green-400'}`}>
                            {r.value?.value || 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {queryResult.warnings && queryResult.warnings.length > 0 && (
                <div className={`mt-4 p-3 rounded-lg ${isRetro ? 'border border-yellow-500/30' : 'bg-yellow-500/10 border border-yellow-500/20'}`}>
                  <p className="text-yellow-300 text-sm">
                    {queryResult.warnings.join('; ')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Metrics Result */}
      {activeTab === 'metrics' && metricsResult && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Metrics Scrape
          </h2>
          {!metricsResult.success ? (
            <div className={`p-4 rounded-lg ${isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'}`}>
              <p className="text-red-400">{metricsResult.error}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Metric Families</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {metricsResult.metricFamilyCount}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Samples</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {metricsResult.sampleCount}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Latency</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>
                    {metricsResult.latencyMs}ms
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Content-Type</p>
                  <p className={`text-xs font-mono ${isRetro ? 'retro-text' : 'text-white'} truncate`}>
                    {metricsResult.contentType?.split(';')[0] || 'N/A'}
                  </p>
                </div>
              </div>

              {/* Type distribution */}
              {metricsResult.typeCounts && Object.keys(metricsResult.typeCounts).length > 0 && (
                <div className="mb-4">
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Metric Types
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(metricsResult.typeCounts).map(([type, count]) => (
                      <span
                        key={type}
                        className={`px-3 py-1 rounded-full text-sm ${
                          isRetro ? 'retro-card retro-text' : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {type}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Metrics preview */}
              {metricsResult.preview && metricsResult.preview.length > 0 && (
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-4 overflow-x-auto`}>
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Sample Metrics (first {metricsResult.preview.length})
                  </h3>
                  <div className="space-y-1">
                    {metricsResult.preview.map((m, i) => (
                      <div key={i} className="flex justify-between gap-4 font-mono text-xs">
                        <span className={`${isRetro ? 'retro-text' : 'text-slate-300'} truncate`}>{m.name}</span>
                        <span className={`${isRetro ? 'retro-text' : 'text-green-400'} whitespace-nowrap`}>{m.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Protocol Info */}
      <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6`}>
        <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
          About Prometheus
        </h2>
        <div className={`space-y-3 text-sm ${isRetro ? 'retro-text-dim' : 'text-slate-300'}`}>
          <p>
            Prometheus is the leading open-source
            <strong className={isRetro ? 'retro-text' : 'text-white'}> monitoring and alerting toolkit</strong> for
            cloud-native environments. A CNCF graduated project, it scrapes time-series metrics from
            instrumented targets and stores them for querying via PromQL.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Key Features</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>PromQL query language</li>
                <li>Pull-based metric scraping</li>
                <li>OpenMetrics exposition format</li>
                <li>Multi-dimensional data model</li>
                <li>Alertmanager integration</li>
              </ul>
            </div>
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Common Queries</h3>
              <ul className="list-disc list-inside space-y-1">
                <li><code className="text-xs">up</code> - Target reachability</li>
                <li><code className="text-xs">rate(http_requests_total[5m])</code></li>
                <li><code className="text-xs">histogram_quantile(0.95, ...)</code></li>
                <li><code className="text-xs">process_cpu_seconds_total</code></li>
                <li><code className="text-xs">go_goroutines</code></li>
              </ul>
            </div>
          </div>
          <div className={`mt-3 p-3 rounded-lg ${isRetro ? 'border border-yellow-500/30' : 'bg-yellow-500/10 border border-yellow-500/20'}`}>
            <p className="text-yellow-300 text-xs">
              <strong>Note:</strong> This client connects to the Prometheus HTTP API over TCP. By default,
              Prometheus does not require authentication. If your server uses basic auth or bearer tokens,
              those features are not yet supported in this client.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
