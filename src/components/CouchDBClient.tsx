import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface CouchDBClientProps {
  onBack: () => void;
}

export default function CouchDBClient({ onBack }: CouchDBClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5984');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [queryPath, setQueryPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [databases, setDatabases] = useState<string[]>([]);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleHealth = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setDatabases([]);

    try {
      const response = await fetch('/api/couchdb/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username: username || undefined,
          password: password || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        statusCode?: number;
        serverInfo?: Record<string, unknown>;
        databases?: string[];
        latencyMs?: number;
        error?: string;
      };

      if (response.ok && data.success) {
        const info = data.serverInfo || {};
        const lines = [
          `CouchDB Server: ${host}:${port}`,
          `Status: ${data.statusCode}`,
          `Version: ${(info as Record<string, unknown>).version || 'Unknown'}`,
          `Vendor: ${JSON.stringify((info as Record<string, unknown>).vendor) || 'Unknown'}`,
          `UUID: ${(info as Record<string, unknown>).uuid || 'N/A'}`,
        ];
        if (data.latencyMs !== undefined) {
          lines.push(`Latency: ${data.latencyMs}ms`);
        }
        if (data.databases) {
          lines.push('', `Databases (${data.databases.length}):`);
          for (const db of data.databases) {
            lines.push(`  - ${db}`);
          }
          setDatabases(data.databases);
        }
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to connect to CouchDB');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async (path?: string) => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    const targetPath = path || queryPath;
    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/couchdb/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          path: targetPath,
          method: 'GET',
          username: username || undefined,
          password: password || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        statusCode?: number;
        body?: string;
        parsed?: unknown;
        latencyMs?: number;
        error?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `GET ${targetPath} → ${data.statusCode}`,
          `Latency: ${data.latencyMs}ms`,
          '',
        ];
        if (data.parsed) {
          lines.push(JSON.stringify(data.parsed, null, 2));
        } else if (data.body) {
          lines.push(data.body);
        }
        setResult(lines.join('\n'));
      } else {
        setError(data.error || `Request failed (${data.statusCode})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleHealth();
    }
  };

  return (
    <ProtocolClientLayout title="Apache CouchDB Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.CouchDB || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="couch-host"
            label="CouchDB Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="couchdb.example.com"
            required
            helpText="CouchDB server address"
            error={errors.host}
          />

          <FormField
            id="couch-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5984"
            error={errors.port}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="couch-user"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="admin (optional)"
            helpText="Basic Auth username"
          />

          <FormField
            id="couch-pass"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="password (optional)"
            helpText="Basic Auth password"
          />
        </div>

        <ActionButton
          onClick={handleHealth}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect and check CouchDB health"
        >
          Check Server Health
        </ActionButton>

        {databases.length > 0 && (
          <>
            <SectionHeader stepNumber={2} title="Browse Databases" color="green" />

            <div className="flex flex-wrap gap-2 mb-4">
              {databases.map((db) => (
                <button
                  key={db}
                  onClick={() => handleQuery(`/${db}`)}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
                >
                  {db}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-6">
          <SectionHeader stepNumber={databases.length > 0 ? 3 : 2} title="Custom Query" color="blue" />

          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <FormField
                id="couch-path"
                label="API Path"
                type="text"
                value={queryPath}
                onChange={setQueryPath}
                placeholder="/_all_dbs"
                helpText="CouchDB REST API path"
              />
            </div>
            <div className="flex items-end">
              <ActionButton
                onClick={() => handleQuery()}
                disabled={loading || !host || !port}
                loading={loading}
                variant="success"
                ariaLabel="Execute CouchDB query"
              >
                Query
              </ActionButton>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { path: '/', label: 'Server Info' },
              { path: '/_all_dbs', label: 'All Databases' },
              { path: '/_active_tasks', label: 'Active Tasks' },
              { path: '/_membership', label: 'Cluster Nodes' },
              { path: '/_up', label: 'Health Check' },
              { path: '/_node/_local/_stats', label: 'Node Stats' },
            ].map(({ path, label }) => (
              <button
                key={path}
                onClick={() => { setQueryPath(path); handleQuery(path); }}
                className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Apache CouchDB"
          description="CouchDB is a NoSQL document database that uses HTTP as its native protocol. All operations are performed via REST API (GET/PUT/POST/DELETE) with JSON documents. It supports multi-version concurrency control (MVCC), MapReduce views, and built-in replication."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 5984 (default)</p>
            <p><strong className="text-slate-300">Transport:</strong> HTTP/1.1 over TCP</p>
            <p><strong className="text-slate-300">Encoding:</strong> JSON documents</p>
            <p><strong className="text-slate-300">Auth:</strong> Basic Auth or Cookie sessions</p>
            <p><strong className="text-slate-300">API:</strong> RESTful (GET/PUT/POST/DELETE)</p>
            <p><strong className="text-slate-300">Replication:</strong> Built-in via /_replicate endpoint</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
