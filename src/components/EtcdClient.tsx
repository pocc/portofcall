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

interface EtcdClientProps {
  onBack: () => void;
}

export default function EtcdClient({ onBack }: EtcdClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2379');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Query state
  const [path, setPath] = useState('/v3/kv/range');
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
      const response = await fetch('/api/etcd/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
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
          version?: {
            etcdserver?: string;
            etcdcluster?: string;
          };
          status?: {
            header?: {
              cluster_id?: string;
              member_id?: string;
              raft_term?: string;
              revision?: string;
            };
            leader?: string;
            dbSize?: string;
            dbSizeInUse?: string;
            version?: string;
            raftIndex?: string;
            raftTerm?: string;
          };
          health?: {
            health?: string;
            reason?: string;
          };
        };
      };

      if (data.success && data.parsed) {
        const ver = data.parsed.version;
        const status = data.parsed.status;
        const health = data.parsed.health;

        let output = `etcd Health Check (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;

        if (ver) {
          output += `Server Version: ${ver.etcdserver || 'unknown'}\n`;
          output += `Cluster Version: ${ver.etcdcluster || 'unknown'}\n`;
        }

        if (health) {
          output += `Health: ${health.health || 'unknown'}\n`;
          if (health.reason) output += `Reason: ${health.reason}\n`;
        }

        if (status) {
          output += `\nCluster Status\n`;
          output += `${'-'.repeat(30)}\n`;
          if (status.header) {
            output += `Cluster ID: ${status.header.cluster_id || 'unknown'}\n`;
            output += `Member ID: ${status.header.member_id || 'unknown'}\n`;
            output += `Revision: ${status.header.revision || 'unknown'}\n`;
            output += `Raft Term: ${status.header.raft_term || 'unknown'}\n`;
          }
          if (status.leader) output += `Leader: ${status.leader}\n`;
          if (status.dbSize) {
            const dbSizeMB = (parseInt(status.dbSize) / (1024 * 1024)).toFixed(2);
            output += `DB Size: ${dbSizeMB} MB\n`;
          }
          if (status.dbSizeInUse) {
            const inUseMB = (parseInt(status.dbSizeInUse) / (1024 * 1024)).toFixed(2);
            output += `DB In Use: ${inUseMB} MB\n`;
          }
          if (status.version) output += `Version: ${status.version}\n`;
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
      const response = await fetch('/api/etcd/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
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
        let output = `POST ${path} -> ${data.statusCode} (${data.latencyMs}ms)\n`;
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

  const handleQuickQuery = (qPath: string, qBody: string) => {
    setPath(qPath);
    setQueryBody(qBody);
  };

  return (
    <ProtocolClientLayout title="etcd Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Etcd || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="etcd-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="etcd.example.com"
            required
            helpText="etcd server hostname or IP"
            error={errors.host}
          />

          <FormField
            id="etcd-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2379"
            error={errors.port}
          />

          <FormField
            id="etcd-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="root"
            optional
            helpText="For Basic Auth (leave blank if not required)"
          />

          <FormField
            id="etcd-password"
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
          ariaLabel="Check etcd cluster health"
          variant="success"
        >
          Health Check
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="Query" color="purple" />

        <div className="mb-4">
          <FormField
            id="etcd-path"
            label="API Path"
            type="text"
            value={path}
            onChange={setPath}
            placeholder="/v3/kv/range"
            helpText="etcd v3 HTTP/JSON API endpoint"
          />
        </div>

        <div className="mb-4">
          <label htmlFor="etcd-body" className="block text-sm font-medium text-slate-300 mb-1">
            Request Body <span className="text-xs text-slate-400">(JSON, base64-encoded keys/values)</span>
          </label>
          <textarea
            id="etcd-body"
            value={queryBody}
            onChange={(e) => setQueryBody(e.target.value)}
            placeholder='{"key": "Zm9v"}'
            rows={4}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
          />
          <p className="text-xs text-slate-400 mt-1">
            Keys/values must be base64-encoded. Example: &quot;foo&quot; = &quot;Zm9v&quot;, &quot;bar&quot; = &quot;YmFy&quot;
          </p>
        </div>

        <ActionButton
          onClick={handleQuery}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Execute etcd query"
          variant="primary"
        >
          Execute Query
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Queries</h3>
          <div className="grid gap-2">
            {[
              {
                label: 'Get all keys (range \x00 to \xff)',
                path: '/v3/kv/range',
                body: JSON.stringify({ key: 'AA==', range_end: '/w==' }, null, 2),
              },
              {
                label: 'Get key "foo"',
                path: '/v3/kv/range',
                body: JSON.stringify({ key: btoa('foo') }, null, 2),
              },
              {
                label: 'Put key "foo" = "bar"',
                path: '/v3/kv/put',
                body: JSON.stringify({ key: btoa('foo'), value: btoa('bar') }, null, 2),
              },
              {
                label: 'Delete key "foo"',
                path: '/v3/kv/deleterange',
                body: JSON.stringify({ key: btoa('foo') }, null, 2),
              },
              {
                label: 'Server status',
                path: '/v3/maintenance/status',
                body: '{}',
              },
              {
                label: 'Grant lease (60s TTL)',
                path: '/v3/lease/grant',
                body: JSON.stringify({ TTL: 60 }, null, 2),
              },
            ].map(({ label, path: qPath, body: qBody }) => (
              <button
                key={label}
                onClick={() => handleQuickQuery(qPath, qBody)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-purple-400">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <HelpSection
          title="About etcd"
          description="etcd is a distributed, reliable key-value store used for distributed system configuration and service discovery. It powers Kubernetes cluster coordination. This client sends raw HTTP/1.1 requests over TCP to the v3 HTTP/JSON gateway on port 2379. Keys and values are base64-encoded in the API. Supports Basic Auth for secured clusters."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
