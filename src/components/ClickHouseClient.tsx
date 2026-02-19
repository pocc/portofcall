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

interface ClickHouseClientProps {
  onBack: () => void;
}

export default function ClickHouseClient({ onBack }: ClickHouseClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8123');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [query, setQuery] = useState('SELECT 1');
  const [database, setDatabase] = useState('');
  const [format, setFormat] = useState('JSONCompact');
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
      const response = await fetch('/api/clickhouse/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          user: user || undefined,
          password: password || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        statusCode?: number;
        version?: string;
        serverInfo?: Record<string, string>;
        databases?: string[];
        latencyMs?: number;
        error?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `ClickHouse Server: ${host}:${port}`,
          `Status: ${data.statusCode}`,
          `Version: ${data.version || 'Unknown'}`,
        ];
        if (data.serverInfo) {
          const info = data.serverInfo;
          if (info.hostname) lines.push(`Hostname: ${info.hostname}`);
          if (info.uptime) lines.push(`Uptime: ${info.uptime}s`);
          if (info.current_db) lines.push(`Default DB: ${info.current_db}`);
        }
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
        setError(data.error || 'Failed to connect to ClickHouse');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async (sql?: string) => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    const targetQuery = sql || query;
    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/clickhouse/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          query: targetQuery,
          database: database || undefined,
          format,
          user: user || undefined,
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
        format?: string;
        error?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `Query: ${targetQuery}`,
          `Status: ${data.statusCode} | Format: ${data.format} | Latency: ${data.latencyMs}ms`,
          '',
        ];
        if (data.parsed) {
          lines.push(JSON.stringify(data.parsed, null, 2));
        } else if (data.body) {
          lines.push(data.body);
        }
        setResult(lines.join('\n'));
      } else {
        setError(data.error || `Query failed (${data.statusCode})`);
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
    <ProtocolClientLayout title="ClickHouse Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.ClickHouse || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="ch-host"
            label="ClickHouse Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="clickhouse.example.com"
            required
            helpText="ClickHouse server address"
            error={errors.host}
          />

          <FormField
            id="ch-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 8123"
            error={errors.port}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ch-user"
            label="Username"
            type="text"
            value={user}
            onChange={setUser}
            onKeyDown={handleKeyDown}
            placeholder="default (optional)"
            helpText="ClickHouse user"
          />

          <FormField
            id="ch-pass"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="password (optional)"
            helpText="ClickHouse password"
          />
        </div>

        <ActionButton
          onClick={handleHealth}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect and check ClickHouse health"
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
                  onClick={() => {
                    setDatabase(db);
                    handleQuery(`SHOW TABLES FROM ${db}`);
                  }}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
                >
                  {db}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-6">
          <SectionHeader stepNumber={databases.length > 0 ? 3 : 2} title="SQL Query" color="blue" />

          <div className="mb-4">
            <FormField
              id="ch-database"
              label="Database"
              type="text"
              value={database}
              onChange={setDatabase}
              placeholder="default (optional)"
              helpText="Target database"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="ch-query" className="block text-sm font-medium text-slate-300 mb-1">
              SQL Query
            </label>
            <textarea
              id="ch-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={3}
              className="w-full bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="SELECT 1"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="ch-format" className="block text-sm font-medium text-slate-300 mb-1">
              Output Format
            </label>
            <select
              id="ch-format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="bg-slate-900 border border-slate-600 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="JSONCompact">JSONCompact</option>
              <option value="JSON">JSON</option>
              <option value="Pretty">Pretty</option>
              <option value="TabSeparated">TabSeparated</option>
              <option value="CSV">CSV</option>
              <option value="Vertical">Vertical</option>
            </select>
          </div>

          <ActionButton
            onClick={() => handleQuery()}
            disabled={loading || !host || !port || !query}
            loading={loading}
            variant="success"
            ariaLabel="Execute ClickHouse query"
          >
            Execute Query
          </ActionButton>

          <div className="flex flex-wrap gap-2 mt-4">
            {[
              { sql: 'SELECT version()', label: 'Version' },
              { sql: 'SELECT uptime()', label: 'Uptime' },
              { sql: 'SHOW DATABASES', label: 'Databases' },
              { sql: 'SHOW PROCESSLIST', label: 'Processes' },
              { sql: 'SELECT name, value FROM system.settings LIMIT 20', label: 'Settings' },
              { sql: 'SELECT name, engine FROM system.tables WHERE database = currentDatabase() LIMIT 20', label: 'Tables' },
            ].map(({ sql, label }) => (
              <button
                key={sql}
                onClick={() => { setQuery(sql); handleQuery(sql); }}
                className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About ClickHouse"
          description="ClickHouse is an open-source columnar OLAP database designed for real-time analytics. It uses an HTTP interface on port 8123 for queries, supporting SQL with extensions for aggregation, time-series, and parallel processing. ClickHouse is known for extremely fast analytical queries over billions of rows."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 8123 (HTTP), 9000 (Native TCP)</p>
            <p><strong className="text-slate-300">Transport:</strong> HTTP/1.1 over TCP</p>
            <p><strong className="text-slate-300">Query:</strong> SQL with ClickHouse extensions</p>
            <p><strong className="text-slate-300">Auth:</strong> User/password via query params or headers</p>
            <p><strong className="text-slate-300">Formats:</strong> JSON, JSONCompact, TabSeparated, CSV, Pretty, and 60+ more</p>
            <p><strong className="text-slate-300">Health:</strong> GET /ping returns "Ok.\n"</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
