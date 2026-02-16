import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { SectionHeader, FormField, ActionButton, StatusMessage, ConnectionInfo, ResultDisplay } from './SharedComponents';

interface LokiHealthResult {
  success: boolean;
  host: string;
  port: number;
  results: {
    ready?: { statusCode?: number; healthy?: boolean; body?: string; error?: string };
    buildInfo?: { data?: { version?: string; revision?: string; branch?: string; goVersion?: string }; status?: string; error?: string; raw?: string };
    labels?: { status?: string; data?: string[]; count?: number; error?: string };
  };
  responseTime: number;
  error?: string;
}

interface LokiQueryResult {
  success: boolean;
  host: string;
  port: number;
  query: string;
  statusCode: number;
  result: {
    status?: string;
    data?: {
      resultType?: string;
      result?: Array<{
        stream?: Record<string, string>;
        values?: Array<[string, string]>;
        metric?: Record<string, string>;
        value?: [number, string];
      }>;
      stats?: Record<string, unknown>;
    };
    raw?: string;
    error?: string;
  };
  responseTime: number;
  error?: string;
}

interface LokiMetricsResult {
  success: boolean;
  host: string;
  port: number;
  totalMetrics: number;
  totalSamples: number;
  typeDistribution: Record<string, number>;
  metrics: Array<{ name: string; type: string; help: string; samples: number }>;
  responseTime: number;
  error?: string;
}

export default function LokiClient({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';

  const [host, setHost] = useState('');
  const [port, setPort] = useState('3100');
  const [activeTab, setActiveTab] = useState<'health' | 'query' | 'metrics'>('health');

  // Health state
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<LokiHealthResult | null>(null);
  const [healthError, setHealthError] = useState('');

  // Query state
  const [query, setQuery] = useState('{job="varlogs"}');
  const [queryLimit, setQueryLimit] = useState('100');
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryResult, setQueryResult] = useState<LokiQueryResult | null>(null);
  const [queryError, setQueryError] = useState('');

  // Metrics state
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsResult, setMetricsResult] = useState<LokiMetricsResult | null>(null);
  const [metricsError, setMetricsError] = useState('');

  const handleHealthCheck = async () => {
    setHealthLoading(true);
    setHealthError('');
    setHealthResult(null);
    try {
      const resp = await fetch('/api/loki/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port) }),
      });
      const data = await resp.json() as LokiHealthResult;
      if (data.error) { setHealthError(data.error); }
      else { setHealthResult(data); }
    } catch (e: unknown) {
      setHealthError(e instanceof Error ? e.message : String(e));
    } finally {
      setHealthLoading(false);
    }
  };

  const handleQuery = async () => {
    setQueryLoading(true);
    setQueryError('');
    setQueryResult(null);
    try {
      const resp = await fetch('/api/loki/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), query, limit: parseInt(queryLimit) }),
      });
      const data = await resp.json() as LokiQueryResult;
      if (data.error) { setQueryError(data.error); }
      else { setQueryResult(data); }
    } catch (e: unknown) {
      setQueryError(e instanceof Error ? e.message : String(e));
    } finally {
      setQueryLoading(false);
    }
  };

  const handleMetrics = async () => {
    setMetricsLoading(true);
    setMetricsError('');
    setMetricsResult(null);
    try {
      const resp = await fetch('/api/loki/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port) }),
      });
      const data = await resp.json() as LokiMetricsResult;
      if (data.error) { setMetricsError(data.error); }
      else { setMetricsResult(data); }
    } catch (e: unknown) {
      setMetricsError(e instanceof Error ? e.message : String(e));
    } finally {
      setMetricsLoading(false);
    }
  };

  const quickQueries = [
    { label: '{job="varlogs"}', query: '{job="varlogs"}' },
    { label: '{level="error"}', query: '{level="error"}' },
    { label: 'Rate query', query: 'rate({job="varlogs"}[5m])' },
    { label: 'Top labels', query: 'topk(10, count_over_time({job=~".+"}[1h]))' },
    { label: 'Line filter', query: '{job="varlogs"} |= "error"' },
    { label: 'JSON parse', query: '{job="varlogs"} | json' },
  ];

  const tabs = [
    { id: 'health' as const, label: isRetro ? '[HEALTH]' : 'Health & Info' },
    { id: 'query' as const, label: isRetro ? '[LOGQL]' : 'LogQL Query' },
    { id: 'metrics' as const, label: isRetro ? '[METRICS]' : 'Metrics' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className={isRetro ? 'retro-button' : 'text-slate-400 hover:text-slate-200 transition-colors'}>
          {isRetro ? '← BACK' : '← Back'}
        </button>
        <h2 className={isRetro ? 'retro-title' : 'text-2xl font-bold text-white'}>
          {isRetro ? '>>> GRAFANA LOKI CLIENT <<<' : '🪵 Grafana Loki Client'}
        </h2>
      </div>

      <ConnectionInfo
        items={[
          { label: isRetro ? 'PORT' : 'Default Port', value: '3100' },
          { label: isRetro ? 'TYPE' : 'Protocol', value: 'HTTP REST API' },
          { label: isRetro ? 'SPEC' : 'Query Language', value: 'LogQL' },
        ]}
      />

      <SectionHeader stepNumber={1} title="Connection" />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <FormField id="loki-host" label="Host" value={host} onChange={setHost} placeholder="loki.example.com" />
        <FormField id="loki-port" label="Port" value={port} onChange={setPort} placeholder="3100" />
      </div>

      {/* Tab selector */}
      <div className={`flex gap-2 ${isRetro ? 'font-mono' : ''}`}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={isRetro
              ? `px-3 py-1 border ${activeTab === tab.id ? 'bg-green-900 text-green-400 border-green-500' : 'border-green-800 text-green-700 hover:text-green-500'}`
              : `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Health Tab */}
      {activeTab === 'health' && (
        <div className="space-y-4">
          <SectionHeader stepNumber={2} title="Health & Info Probe" />
          <ActionButton
            onClick={handleHealthCheck}
            disabled={healthLoading || !host}
            loading={healthLoading}
            variant="primary"
            ariaLabel="Check Loki health"
          >
            {isRetro ? 'PROBE LOKI' : 'Check Health'}
          </ActionButton>

          {healthError && <StatusMessage type="error" message={healthError} />}

          {healthResult && (
            <div className="space-y-4">
              <StatusMessage type="success" message={`Connected to ${healthResult.host}:${healthResult.port} in ${healthResult.responseTime}ms`} />

              {/* Readiness */}
              {healthResult.results.ready && (
                <ResultDisplay title="Readiness" data={{
                  'Status': healthResult.results.ready.healthy ? '✅ Ready' : `❌ Not Ready (${healthResult.results.ready.statusCode})`,
                  'Response': healthResult.results.ready.body || healthResult.results.ready.error || 'N/A',
                }} />
              )}

              {/* Build Info */}
              {healthResult.results.buildInfo && (
                <ResultDisplay title="Build Info" data={
                  healthResult.results.buildInfo.data ? {
                    'Version': healthResult.results.buildInfo.data.version || 'N/A',
                    'Revision': healthResult.results.buildInfo.data.revision?.substring(0, 12) || 'N/A',
                    'Branch': healthResult.results.buildInfo.data.branch || 'N/A',
                    'Go Version': healthResult.results.buildInfo.data.goVersion || 'N/A',
                  } : {
                    'Status': healthResult.results.buildInfo.error || healthResult.results.buildInfo.raw || 'N/A',
                  }
                } />
              )}

              {/* Labels */}
              {healthResult.results.labels && (
                <ResultDisplay title="Labels" data={{
                  'Count': String(healthResult.results.labels.count ?? 0),
                  'Labels': healthResult.results.labels.data?.join(', ') || healthResult.results.labels.error || 'None',
                }} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Query Tab */}
      {activeTab === 'query' && (
        <div className="space-y-4">
          <SectionHeader stepNumber={2} title="LogQL Query" />

          <div className="mb-4">
            <FormField id="loki-query" label="LogQL Expression" value={query} onChange={setQuery} placeholder='{job="varlogs"}' />
          </div>

          <div className="mb-4">
            <FormField id="loki-limit" label="Result Limit" value={queryLimit} onChange={setQueryLimit} placeholder="100" />
          </div>

          {/* Quick queries */}
          <div className={`flex flex-wrap gap-2 mb-4 ${isRetro ? 'font-mono text-xs' : ''}`}>
            {quickQueries.map(q => (
              <button
                key={q.label}
                onClick={() => setQuery(q.query)}
                className={isRetro
                  ? 'px-2 py-0.5 border border-green-800 text-green-600 hover:text-green-400 hover:border-green-500'
                  : 'px-3 py-1 text-xs bg-slate-700 text-amber-400 rounded hover:bg-slate-600 transition-colors'
                }
              >
                {q.label}
              </button>
            ))}
          </div>

          <ActionButton
            onClick={handleQuery}
            disabled={queryLoading || !host || !query}
            loading={queryLoading}
            variant="primary"
            ariaLabel="Execute LogQL query"
          >
            {isRetro ? 'EXECUTE QUERY' : 'Run Query'}
          </ActionButton>

          {queryError && <StatusMessage type="error" message={queryError} />}

          {queryResult && (
            <div className="space-y-4">
              <StatusMessage
                type={queryResult.success ? 'success' : 'error'}
                message={queryResult.success
                  ? `Query returned in ${queryResult.responseTime}ms`
                  : `Query failed (HTTP ${queryResult.statusCode})`
                }
              />

              {queryResult.result?.data?.resultType && (
                <ResultDisplay title="Query Info" data={{
                  'Result Type': queryResult.result.data.resultType,
                  'Results': String(queryResult.result.data.result?.length ?? 0),
                  'Query': queryResult.query,
                }} />
              )}

              {/* Log stream results */}
              {queryResult.result?.data?.result && queryResult.result.data.result.length > 0 && (
                <div className={isRetro
                  ? 'border border-green-800 p-3 font-mono text-xs'
                  : 'bg-slate-800 rounded-lg p-4 border border-slate-700'
                }>
                  <h4 className={isRetro ? 'text-green-500 mb-2' : 'text-white font-semibold mb-3'}>
                    {isRetro ? '--- LOG ENTRIES ---' : 'Results'}
                  </h4>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {queryResult.result.data.result.slice(0, 20).map((entry, i) => (
                      <div key={i} className={isRetro
                        ? 'border-b border-green-900 pb-2'
                        : 'border-b border-slate-700 pb-2'
                      }>
                        {/* Stream labels */}
                        {entry.stream && (
                          <div className={isRetro ? 'text-green-600 mb-1' : 'text-amber-400 text-xs mb-1'}>
                            {Object.entries(entry.stream).map(([k, v]) => `${k}="${v}"`).join(' ')}
                          </div>
                        )}
                        {/* Metric labels */}
                        {entry.metric && (
                          <div className={isRetro ? 'text-green-600 mb-1' : 'text-amber-400 text-xs mb-1'}>
                            {Object.entries(entry.metric).map(([k, v]) => `${k}="${v}"`).join(' ')}
                          </div>
                        )}
                        {/* Log values */}
                        {entry.values && entry.values.slice(0, 5).map(([ts, line], j) => (
                          <div key={j} className={isRetro ? 'text-green-400 pl-2' : 'text-slate-300 text-sm pl-2'}>
                            <span className={isRetro ? 'text-green-700' : 'text-slate-500 text-xs'}>
                              {new Date(parseInt(ts) / 1000000).toISOString().substring(11, 23)}
                            </span>
                            {' '}{line.substring(0, 200)}
                          </div>
                        ))}
                        {/* Instant value */}
                        {entry.value && (
                          <div className={isRetro ? 'text-green-400 pl-2' : 'text-slate-300 text-sm pl-2'}>
                            Value: {entry.value[1]}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Metrics Tab */}
      {activeTab === 'metrics' && (
        <div className="space-y-4">
          <SectionHeader stepNumber={2} title="Metrics Scrape" />

          <ActionButton
            onClick={handleMetrics}
            disabled={metricsLoading || !host}
            loading={metricsLoading}
            variant="primary"
            ariaLabel="Scrape Loki metrics"
          >
            {isRetro ? 'SCRAPE METRICS' : 'Scrape Metrics'}
          </ActionButton>

          {metricsError && <StatusMessage type="error" message={metricsError} />}

          {metricsResult && metricsResult.success && (
            <div className="space-y-4">
              <StatusMessage type="success" message={`Scraped ${metricsResult.totalMetrics} metrics (${metricsResult.totalSamples} samples) in ${metricsResult.responseTime}ms`} />

              <ResultDisplay title="Type Distribution" data={
                Object.fromEntries(Object.entries(metricsResult.typeDistribution).map(([k, v]) => [k, String(v)]))
              } />

              {/* Metrics preview */}
              <div className={isRetro
                ? 'border border-green-800 p-3 font-mono text-xs'
                : 'bg-slate-800 rounded-lg p-4 border border-slate-700'
              }>
                <h4 className={isRetro ? 'text-green-500 mb-2' : 'text-white font-semibold mb-3'}>
                  {isRetro ? '--- METRICS PREVIEW ---' : `Metrics (showing ${Math.min(metricsResult.metrics.length, 30)} of ${metricsResult.totalMetrics})`}
                </h4>
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {metricsResult.metrics.slice(0, 30).map((m, i) => (
                    <div key={i} className={isRetro ? 'text-green-400' : 'text-sm'}>
                      <span className={isRetro ? 'text-green-500' : 'text-amber-400 font-mono'}>{m.name}</span>
                      <span className={isRetro ? 'text-green-700' : 'text-slate-500'}> [{m.type}]</span>
                      <span className={isRetro ? 'text-green-800' : 'text-slate-600'}> {m.samples} samples</span>
                      {m.help && (
                        <div className={isRetro ? 'text-green-900 pl-4' : 'text-slate-500 text-xs pl-4'}>{m.help.substring(0, 120)}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
