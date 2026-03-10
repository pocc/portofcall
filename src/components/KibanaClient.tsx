import { useState } from 'react';
import { SectionHeader, FormField, ActionButton, StatusMessage, ConnectionInfo, ResultDisplay } from './SharedComponents';
import { usePersistedState } from '../hooks/usePersistedState';

interface KibanaStatusResult {
  success: boolean;
  host: string;
  port: number;
  statusCode: number;
  version: { number: string; buildHash: string; buildNumber: string; buildSnapshot: string } | null;
  health: { state: string; title: string; nickname: string } | null;
  pluginCount: number;
  responseTime: number;
  error?: string;
}

interface KibanaSavedObjectsResult {
  success: boolean;
  host: string;
  port: number;
  type: string;
  statusCode: number;
  total: number;
  perPage: number;
  objects: Array<{ id: string; type: string; title: string; description: string; updated: string }>;
  responseTime: number;
  error?: string;
}

export default function KibanaClient({ onBack }: { onBack: () => void }) {

  const [host, setHost] = usePersistedState('kibana-host', '');
  const [port, setPort] = usePersistedState('kibana-port', '5601');
  const [activeTab, setActiveTab] = useState<'status' | 'objects'>('status');

  // Status state
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusResult, setStatusResult] = useState<KibanaStatusResult | null>(null);
  const [statusError, setStatusError] = useState('');

  // Saved objects state
  const [objectType, setObjectType] = useState('dashboard');
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsResult, setObjectsResult] = useState<KibanaSavedObjectsResult | null>(null);
  const [objectsError, setObjectsError] = useState('');

  const handleStatusCheck = async () => {
    setStatusLoading(true);
    setStatusError('');
    setStatusResult(null);
    try {
      const resp = await fetch('/api/kibana/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10) }),
      });
      const data = await resp.json() as KibanaStatusResult;
      if (data.error) { setStatusError(data.error); }
      else { setStatusResult(data); }
    } catch (e: unknown) {
      setStatusError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusLoading(false);
    }
  };

  const handleSavedObjects = async () => {
    setObjectsLoading(true);
    setObjectsError('');
    setObjectsResult(null);
    try {
      const resp = await fetch('/api/kibana/saved-objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), type: objectType }),
      });
      const data = await resp.json() as KibanaSavedObjectsResult;
      if (data.error) { setObjectsError(data.error); }
      else { setObjectsResult(data); }
    } catch (e: unknown) {
      setObjectsError(e instanceof Error ? e.message : String(e));
    } finally {
      setObjectsLoading(false);
    }
  };

  const objectTypes = [
    { label: 'Dashboards', value: 'dashboard' },
    { label: 'Visualizations', value: 'visualization' },
    { label: 'Index Patterns', value: 'index-pattern' },
    { label: 'Searches', value: 'search' },
    { label: 'Lenses', value: 'lens' },
    { label: 'Maps', value: 'map' },
  ];

  const tabs = [
    { id: 'status' as const, label: 'Server Status' },
    { id: 'objects' as const, label: 'Saved Objects' },
  ];

  const healthColor = (state: string) => {
    switch (state?.toLowerCase()) {
      case 'green': case 'available': return 'text-green-400';
      case 'yellow': case 'degraded': return 'text-yellow-400';
      case 'red': case 'unavailable': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="text-slate-400 hover:text-slate-200 transition-colors">
          ← Back
        </button>
        <h2 className="text-2xl font-bold text-white">
          📊 Kibana Client
        </h2>
      </div>

      <ConnectionInfo
        items={[
          { label: 'Default Port', value: '5601' },
          { label: 'Protocol', value: 'HTTP REST API' },
          { label: 'Platform', value: 'Elastic Stack' },
        ]}
      />

      <SectionHeader stepNumber={1} title="Connection" />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <FormField id="kibana-host" label="Host" value={host} onChange={setHost} placeholder="kibana.example.com" />
        <FormField id="kibana-port" label="Port" value={port} onChange={setPort} placeholder="5601" />
      </div>

      {/* Tab selector */}
      <div className="flex gap-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Status Tab */}
      {activeTab === 'status' && (
        <div className="space-y-4">
          <SectionHeader stepNumber={2} title="Server Status" />
          <ActionButton
            onClick={handleStatusCheck}
            disabled={statusLoading || !host}
            loading={statusLoading}
            variant="primary"
            ariaLabel="Check Kibana status"
          >
            Check Status
          </ActionButton>

          {statusError && <StatusMessage type="error" message={statusError} />}

          {statusResult && (
            <div className="space-y-4">
              <StatusMessage
                type={statusResult.success ? 'success' : 'error'}
                message={statusResult.success
                  ? `Kibana is running at ${statusResult.host}:${statusResult.port} (${statusResult.responseTime}ms)`
                  : `Failed to connect (HTTP ${statusResult.statusCode})`
                }
              />

              {statusResult.version && (
                <ResultDisplay title="Version" data={{
                  'Kibana Version': statusResult.version.number,
                  'Build Hash': statusResult.version.buildHash || 'N/A',
                  'Build Number': statusResult.version.buildNumber || 'N/A',
                  'Snapshot': statusResult.version.buildSnapshot || 'N/A',
                }} />
              )}

              {statusResult.health && (
                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <h4 className="text-white font-semibold mb-3">
                    Health Status
                  </h4>
                  <div className="space-y-1">
                    <div>
                      <span className="text-slate-400">State: </span>
                      <span className={healthColor(statusResult.health.state)}>
                        {statusResult.health.state?.toUpperCase() || 'UNKNOWN'}
                      </span>
                    </div>
                    {statusResult.health.title && (
                      <div>
                        <span className="text-slate-400">Title: </span>
                        <span className="text-white">{statusResult.health.title}</span>
                      </div>
                    )}
                    {statusResult.health.nickname && (
                      <div>
                        <span className="text-slate-400">Nickname: </span>
                        <span className="text-white">{statusResult.health.nickname}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {statusResult.pluginCount > 0 && (
                <ResultDisplay title="Plugins" data={{
                  'Loaded Plugins': String(statusResult.pluginCount),
                }} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Saved Objects Tab */}
      {activeTab === 'objects' && (
        <div className="space-y-4">
          <SectionHeader stepNumber={2} title="Saved Objects" />

          {/* Object type selector */}
          <div className="flex flex-wrap gap-2 mb-4">
            {objectTypes.map(t => (
              <button
                key={t.value}
                onClick={() => setObjectType(t.value)}
                className={`px-3 py-1 text-xs rounded transition-colors ${objectType === t.value ? 'bg-purple-600 text-white' : 'bg-slate-700 text-purple-400 hover:bg-slate-600'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <ActionButton
            onClick={handleSavedObjects}
            disabled={objectsLoading || !host}
            loading={objectsLoading}
            variant="primary"
            ariaLabel="Search saved objects"
          >
            Search Objects
          </ActionButton>

          {objectsError && <StatusMessage type="error" message={objectsError} />}

          {objectsResult && (
            <div className="space-y-4">
              <StatusMessage
                type={objectsResult.success ? 'success' : 'error'}
                message={objectsResult.success
                  ? `Found ${objectsResult.total} ${objectsResult.type}(s) in ${objectsResult.responseTime}ms`
                  : `Search failed (HTTP ${objectsResult.statusCode})`
                }
              />

              {objectsResult.objects.length > 0 && (
                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <h4 className="text-white font-semibold mb-3">
                    {`${objectsResult.type} Results`}
                  </h4>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {objectsResult.objects.map((obj, i) => (
                      <div key={i} className="border-b border-slate-700 pb-2">
                        <div className="text-white font-medium">
                          {obj.title}
                        </div>
                        {obj.description && (
                          <div className="text-slate-400 text-sm pl-2">
                            {obj.description.substring(0, 150)}
                          </div>
                        )}
                        <div className="text-slate-500 text-xs">
                          ID: {obj.id?.substring(0, 20)} | Updated: {obj.updated ? new Date(obj.updated).toLocaleDateString() : 'N/A'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
