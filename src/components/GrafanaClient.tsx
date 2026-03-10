import { useState } from 'react';
import { SectionHeader, FormField, ActionButton, StatusMessage, ConnectionInfo } from './SharedComponents';
import { usePersistedState } from '../hooks/usePersistedState';

interface GrafanaClientProps {
  onBack: () => void;
}

interface GrafanaResponse {
  error?: string;
  details?: string;
  [key: string]: unknown;
}

type TabType = 'health' | 'datasources' | 'dashboards';

export default function GrafanaClient({ onBack }: GrafanaClientProps) {

  const [activeTab, setActiveTab] = useState<TabType>('health');
  const [host, setHost] = usePersistedState('grafana-host', '');
  const [port, setPort] = usePersistedState('grafana-port', '3000');

  // Health state
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<Record<string, unknown> | null>(null);
  const [healthError, setHealthError] = useState('');

  // Datasources state
  const [datasourcesLoading, setDatasourcesLoading] = useState(false);
  const [datasourcesResult, setDatasourcesResult] = useState<Record<string, unknown> | null>(null);
  const [datasourcesError, setDatasourcesError] = useState('');

  // Dashboards state
  const [query, setQuery] = usePersistedState('grafana-query', '');
  const [limit, setLimit] = usePersistedState('grafana-limit', '50');
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [dashboardsResult, setDashboardsResult] = useState<Record<string, unknown> | null>(null);
  const [dashboardsError, setDashboardsError] = useState('');

  const handleHealthCheck = async () => {
    setHealthLoading(true);
    setHealthError('');
    setHealthResult(null);

    try {
      const response = await fetch(
        `/api/grafana/health?hostname=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}`
      );
      const data = await response.json() as GrafanaResponse;

      if (data.error) {
        setHealthError(data.error + (data.details ? ': ' + data.details : ''));
      } else {
        setHealthResult(data);
      }
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setHealthLoading(false);
    }
  };

  const handleFetchDatasources = async () => {
    setDatasourcesLoading(true);
    setDatasourcesError('');
    setDatasourcesResult(null);

    try {
      const response = await fetch(
        `/api/grafana/datasources?hostname=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}`
      );
      const data = await response.json() as GrafanaResponse;

      if (data.error) {
        setDatasourcesError(data.error + (data.details ? ': ' + data.details : ''));
      } else {
        setDatasourcesResult(data);
      }
    } catch (err) {
      setDatasourcesError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setDatasourcesLoading(false);
    }
  };

  const handleSearchDashboards = async () => {
    setDashboardsLoading(true);
    setDashboardsError('');
    setDashboardsResult(null);

    try {
      const response = await fetch(
        `/api/grafana/dashboards?hostname=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`
      );
      const data = await response.json() as GrafanaResponse;

      if (data.error) {
        setDashboardsError(data.error + (data.details ? ': ' + data.details : ''));
      } else {
        setDashboardsResult(data);
      }
    } catch (err) {
      setDashboardsError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setDashboardsLoading(false);
    }
  };

  const tabs = [
    { id: 'health' as const, label: 'Health & Info' },
    { id: 'datasources' as const, label: 'Datasources' },
    { id: 'dashboards' as const, label: 'Dashboards' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="text-slate-400 hover:text-slate-200 transition-colors">
          ← Back
        </button>
        <h2 className="text-2xl font-bold text-white">
          📈 Grafana Client
        </h2>
      </div>

      <ConnectionInfo
        items={[
          { label: 'Default Port', value: '3000' },
          { label: 'Protocol', value: 'HTTP REST API' },
          { label: 'Purpose', value: 'Observability & Monitoring' },
        ]}
      />

      <SectionHeader stepNumber={1} title="Connection" />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <FormField id="grafana-host" label="Host" value={host} onChange={setHost} placeholder="grafana.example.com" />
        <FormField id="grafana-port" label="Port" value={port} onChange={setPort} placeholder="3000" />
      </div>

      {/* Tab selector */}
      <div className="flex gap-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Health Tab */}
      {activeTab === 'health' && (
        <div className="space-y-4">
          <SectionHeader stepNumber={2} title="Health & Server Info" />
          <ActionButton
            onClick={handleHealthCheck}
            loading={healthLoading}
          >
            Check Health & Get Info
          </ActionButton>

          {healthError && <StatusMessage type="error" message={healthError} />}
          {healthResult && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <pre className="text-sm text-slate-300 overflow-x-auto">{JSON.stringify(healthResult, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Datasources Tab */}
      {activeTab === 'datasources' && (
        <div className="space-y-4">
          <SectionHeader stepNumber={2} title="Datasources" />
          <p className={`text-sm $text-slate-400`}>
            List all configured data sources (Prometheus, Loki, InfluxDB, etc.).
          </p>
          <ActionButton
            onClick={handleFetchDatasources}
            loading={datasourcesLoading}
          >
            Fetch Datasources
          </ActionButton>

          {datasourcesError && <StatusMessage type="error" message={datasourcesError} />}
          {datasourcesResult && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <pre className="text-sm text-slate-300 overflow-x-auto">{JSON.stringify(datasourcesResult, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Dashboards Tab */}
      {activeTab === 'dashboards' && (
        <div className="space-y-4">
          <SectionHeader stepNumber={2} title="Dashboard Search" />
          <p className={`text-sm $text-slate-400`}>
            Search for dashboards by name or tag.
          </p>

          <FormField
            id="grafana-query"
            label="Search Query (optional)"
            value={query}
            onChange={setQuery}
            placeholder="e.g., kubernetes, metrics, logs"
          />

          <FormField
            id="grafana-limit"
            label="Limit"
            value={limit}
            onChange={setLimit}
            placeholder="50"
          />

          <div className="mb-4">
            <div className="flex gap-2 flex-wrap">
              {['', 'kubernetes', 'metrics', 'logs', 'node-exporter'].map((q) => (
                <button
                  key={q || 'all'}
                  onClick={() => setQuery(q)}
                  className={
                    'bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1 rounded text-xs transition-colors'
                  }
                >
                  {q || 'All Dashboards'}
                </button>
              ))}
            </div>
          </div>

          <ActionButton
            onClick={handleSearchDashboards}
            loading={dashboardsLoading}
          >
            Search Dashboards
          </ActionButton>

          {dashboardsError && <StatusMessage type="error" message={dashboardsError} />}
          {dashboardsResult && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <pre className="text-sm text-slate-300 overflow-x-auto">{JSON.stringify(dashboardsResult, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
