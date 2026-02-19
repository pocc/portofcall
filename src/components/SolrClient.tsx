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

interface SolrClientProps {
  onBack: () => void;
}

export default function SolrClient({ onBack }: SolrClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8983');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [core, setCore] = useState('');
  const [query, setQuery] = useState('*:*');
  const [handler, setHandler] = useState('/select');
  const [rows, setRows] = useState('10');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [cores, setCores] = useState<string[]>([]);

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
    setCores([]);

    try {
      const response = await fetch('/api/solr/health', {
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
        version?: string;
        systemInfo?: Record<string, unknown>;
        cores?: string[];
        latencyMs?: number;
        error?: string;
      };

      if (response.ok && data.success) {
        const sysInfo = data.systemInfo || {};
        const jvm = sysInfo.jvm as Record<string, unknown> | undefined;
        const system = sysInfo.system as Record<string, unknown> | undefined;

        const lines = [
          `Solr Server: ${host}:${port}`,
          `Status: ${data.statusCode}`,
          `Solr Version: ${data.version || 'Unknown'}`,
        ];
        if (jvm?.version) {
          lines.push(`JVM: ${jvm.version}`);
        }
        if (system?.name) {
          lines.push(`OS: ${system.name} ${system.version || ''}`);
        }
        if (data.latencyMs !== undefined) {
          lines.push(`Latency: ${data.latencyMs}ms`);
        }
        if (data.cores) {
          lines.push('', `Cores (${data.cores.length}):`);
          for (const c of data.cores) {
            lines.push(`  - ${c}`);
          }
          setCores(data.cores);
          if (data.cores.length > 0 && !core) {
            setCore(data.cores[0]);
          }
        }
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to connect to Solr');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!core) {
      setError('Core name is required for queries');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/solr/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          core,
          query,
          handler,
          params: { rows },
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
          `Core: ${core} | Handler: ${handler}`,
          `Query: ${query} | Rows: ${rows}`,
          `Status: ${data.statusCode} | Latency: ${data.latencyMs}ms`,
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
    <ProtocolClientLayout title="Apache Solr Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Solr || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="solr-host"
            label="Solr Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="solr.example.com"
            required
            helpText="Solr server address"
            error={errors.host}
          />

          <FormField
            id="solr-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 8983"
            error={errors.port}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="solr-user"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="admin (optional)"
            helpText="Basic Auth username"
          />

          <FormField
            id="solr-pass"
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
          ariaLabel="Connect and check Solr health"
        >
          Check Server Health
        </ActionButton>

        {cores.length > 0 && (
          <>
            <SectionHeader stepNumber={2} title="Select Core" color="green" />

            <div className="flex flex-wrap gap-2 mb-4">
              {cores.map((c) => (
                <button
                  key={c}
                  onClick={() => setCore(c)}
                  className={`text-xs py-1 px-3 rounded transition-colors ${
                    core === c
                      ? 'bg-green-600 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-6">
          <SectionHeader stepNumber={cores.length > 0 ? 3 : 2} title="Search Query" color="blue" />

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <FormField
              id="solr-core"
              label="Core Name"
              type="text"
              value={core}
              onChange={setCore}
              placeholder="my_core"
              required
              helpText="Solr core/collection name"
            />

            <FormField
              id="solr-handler"
              label="Request Handler"
              type="text"
              value={handler}
              onChange={setHandler}
              placeholder="/select"
              helpText="Solr request handler path"
            />
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <FormField
                id="solr-query"
                label="Query (q)"
                type="text"
                value={query}
                onChange={setQuery}
                placeholder="*:*"
                helpText="Solr query string (Lucene syntax)"
              />
            </div>

            <FormField
              id="solr-rows"
              label="Rows"
              type="number"
              value={rows}
              onChange={setRows}
              min="0"
              max="1000"
              helpText="Max results to return"
            />
          </div>

          <ActionButton
            onClick={handleQuery}
            disabled={loading || !host || !port || !core}
            loading={loading}
            variant="success"
            ariaLabel="Execute Solr query"
          >
            Search
          </ActionButton>

          <div className="flex flex-wrap gap-2 mt-4">
            {[
              { q: '*:*', label: 'All Docs' },
              { q: 'id:1', label: 'ID Lookup' },
              { q: '*:*&fl=id,score&sort=score desc', label: 'Scored' },
              { q: '*:*&facet=true&facet.field=id', label: 'Faceted' },
            ].map(({ q, label }) => (
              <button
                key={q}
                onClick={() => { setQuery(q); }}
                className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Apache Solr"
          description="Apache Solr is an open-source enterprise search platform built on Apache Lucene. It provides full-text search, faceted navigation, real-time indexing, and rich document handling through an HTTP REST API. Solr supports distributed searching (SolrCloud) and is widely used for e-commerce, content management, and log analytics."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 8983 (default)</p>
            <p><strong className="text-slate-300">Transport:</strong> HTTP/1.1 over TCP</p>
            <p><strong className="text-slate-300">Encoding:</strong> JSON, XML, CSV, PHP serialized</p>
            <p><strong className="text-slate-300">Auth:</strong> Basic Auth or Kerberos</p>
            <p><strong className="text-slate-300">Query:</strong> Lucene query syntax + Solr extensions</p>
            <p><strong className="text-slate-300">Admin:</strong> /solr/admin/* endpoints for management</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
