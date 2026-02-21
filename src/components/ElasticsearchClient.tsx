import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface ElasticsearchClientProps {
  onBack: () => void;
}

export default function ElasticsearchClient({ onBack }: ElasticsearchClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9200');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Query mode state
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
  const [queryBody, setQueryBody] = useState('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleHealthCheck = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/elasticsearch/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username: username || undefined,
          password: password || undefined,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        parsed?: {
          serverInfo?: {
            name?: string;
            cluster_name?: string;
            cluster_uuid?: string;
            version?: { number?: string; build_flavor?: string; lucene_version?: string };
            tagline?: string;
          };
          clusterHealth?: {
            status?: string;
            cluster_name?: string;
            number_of_nodes?: number;
            number_of_data_nodes?: number;
            active_primary_shards?: number;
            active_shards?: number;
          };
        };
      };

      if (data.success && data.parsed) {
        const info = data.parsed.serverInfo;
        const health = data.parsed.clusterHealth;

        let output = `Elasticsearch Health Check (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;

        if (info) {
          output += `Cluster: ${info.cluster_name || 'unknown'}\n`;
          output += `Node: ${info.name || 'unknown'}\n`;
          if (info.version) {
            output += `Version: ${info.version.number || 'unknown'}`;
            if (info.version.build_flavor) output += ` (${info.version.build_flavor})`;
            output += `\n`;
            if (info.version.lucene_version) {
              output += `Lucene: ${info.version.lucene_version}\n`;
            }
          }
          if (info.tagline) output += `Tagline: ${info.tagline}\n`;
        }

        if (health) {
          output += `\nCluster Health\n`;
          output += `${'-'.repeat(30)}\n`;
          output += `Status: ${health.status || 'unknown'}\n`;
          output += `Nodes: ${health.number_of_nodes ?? 'unknown'}\n`;
          output += `Data Nodes: ${health.number_of_data_nodes ?? 'unknown'}\n`;
          output += `Active Shards: ${health.active_shards ?? 'unknown'}\n`;
          output += `Primary Shards: ${health.active_primary_shards ?? 'unknown'}\n`;
        }

        setResult(output);
      } else {
        setError(data.error || 'Health check failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/elasticsearch/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          method,
          path,
          body: queryBody || undefined,
          username: username || undefined,
          password: password || undefined,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        parsed?: unknown;
        body?: string;
      };

      if (data.success) {
        let output = `${method} ${path} -> ${data.statusCode} (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;

        if (data.parsed) {
          output += JSON.stringify(data.parsed, null, 2);
        } else {
          output += data.body || '(empty response)';
        }

        setResult(output);
      } else {
        let errMsg = data.error || 'Query failed';
        if (data.statusCode) errMsg += ` (HTTP ${data.statusCode})`;
        if (data.parsed) errMsg += `\n${JSON.stringify(data.parsed, null, 2)}`;
        setError(errMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleHealthCheck();
    }
  };

  const handleQuickQuery = (qMethod: string, qPath: string, qBody?: string) => {
    setMethod(qMethod);
    setPath(qPath);
    setQueryBody(qBody || '');
  };

  return (
    <ProtocolClientLayout title="Elasticsearch Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="es-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="elasticsearch.example.com"
            required
            helpText="Elasticsearch server hostname or IP"
            error={errors.host}
          />

          <FormField
            id="es-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 9200"
            error={errors.port}
          />

          <FormField
            id="es-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="elastic"
            optional
            helpText="For Basic Auth (leave blank if not required)"
          />

          <FormField
            id="es-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="password"
            optional
            helpText="For Basic Auth"
          />
        </div>

        <ActionButton
          onClick={handleHealthCheck}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Check Elasticsearch cluster health"
          variant="success"
        >
          Health Check
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="Query" color="purple" />

        <div className="grid md:grid-cols-4 gap-4 mb-4">
          <div>
            <label htmlFor="es-method" className="block text-sm font-medium text-slate-300 mb-1">
              Method
            </label>
            <select
              id="es-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <FormField
              id="es-path"
              label="Path"
              type="text"
              value={path}
              onChange={setPath}
              placeholder="/_cat/indices?format=json"
              helpText="API endpoint path (e.g., /_cluster/health, /myindex/_search)"
            />
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="es-body" className="block text-sm font-medium text-slate-300 mb-1">
            Request Body <span className="text-xs text-slate-400">(optional, JSON)</span>
          </label>
          <textarea
            id="es-body"
            value={queryBody}
            onChange={(e) => setQueryBody(e.target.value)}
            placeholder='{"query": {"match_all": {}}}'
            rows={4}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
          />
        </div>

        <ActionButton
          onClick={handleQuery}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Execute Elasticsearch query"
          variant="primary"
        >
          Execute Query
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Queries</h3>
          <div className="grid gap-2">
            {[
              { label: 'GET / (Server Info)', method: 'GET', path: '/', body: '' },
              { label: 'GET /_cluster/health', method: 'GET', path: '/_cluster/health', body: '' },
              { label: 'GET /_cat/indices?format=json', method: 'GET', path: '/_cat/indices?format=json', body: '' },
              { label: 'GET /_cat/nodes?format=json', method: 'GET', path: '/_cat/nodes?format=json', body: '' },
              { label: 'POST /_search (match_all)', method: 'POST', path: '/_search', body: JSON.stringify({ query: { match_all: {} }, size: 5 }, null, 2) },
            ].map(({ label, method: qMethod, path: qPath, body: qBody }) => (
              <button
                key={label}
                onClick={() => handleQuickQuery(qMethod, qPath, qBody)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-purple-400">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <HelpSection
          title="About Elasticsearch"
          description="Elasticsearch is a distributed search and analytics engine built on Apache Lucene. It exposes a REST API on port 9200 for indexing, searching, and managing data. This client sends raw HTTP/1.1 requests over TCP sockets. Supports Basic Auth (username/password) for secured clusters."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
