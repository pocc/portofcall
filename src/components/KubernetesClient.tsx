import { useState, useEffect } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface KubernetesClientProps {
  onBack: () => void;
}

export default function KubernetesClient({ onBack }: KubernetesClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6443');
  const [bearerToken, setBearerToken] = useState('');
  const [queryPath, setQueryPath] = useState('/version');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Clear sensitive state on unmount
  useEffect(() => {
    return () => {
      setBearerToken('');
    };
  }, []);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleProbe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/kubernetes/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          bearerToken: bearerToken || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        tcpLatency?: number;
        isKubernetes?: boolean;
        isHealthy?: boolean;
        healthStatus?: string;
        httpStatus?: number;
        httpStatusText?: string;
        serverHeader?: string;
        authRequired?: boolean;
        note?: string;
      };

      if (data.success) {
        const lines = [
          `Kubernetes API Server — ${host}:${port}`,
          '='.repeat(60),
          `TCP Latency:  ${data.tcpLatency}ms`,
          `HTTP Status:  ${data.httpStatus} ${data.httpStatusText}`,
          `Health:       ${data.isHealthy ? '✓ ok' : data.healthStatus || 'unknown'}`,
        ];
        if (data.serverHeader) lines.push(`Server:       ${data.serverHeader}`);
        if (data.authRequired) lines.push(`Auth:         Required (401/403)`);
        if (data.note) lines.push('', data.note);
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Probe failed');
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

    const targetPath = path ?? queryPath;
    if (!targetPath || !targetPath.startsWith('/')) {
      setError('Path must start with /');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/kubernetes/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          path: targetPath,
          bearerToken: bearerToken || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        tcpLatency?: number;
        path?: string;
        httpStatus?: number;
        httpStatusText?: string;
        contentType?: string;
        body?: unknown;
        authRequired?: boolean;
      };

      if (response.ok) {
        const lines = [
          `GET ${data.path} — ${host}:${port}`,
          '='.repeat(60),
          `HTTP:         ${data.httpStatus} ${data.httpStatusText}`,
          `TCP Latency:  ${data.tcpLatency}ms`,
        ];
        if (data.contentType) lines.push(`Content-Type: ${data.contentType}`);
        if (data.authRequired) lines.push(`Auth:         Required (${data.httpStatus})`);
        if (data.body !== undefined) {
          lines.push('', '--- Response ---');
          lines.push(typeof data.body === 'string'
            ? data.body
            : JSON.stringify(data.body, null, 2));
        }
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleProbe();
    }
  };

  const quickPaths = [
    { path: '/version', label: 'Version' },
    { path: '/healthz', label: 'Health' },
    { path: '/readyz', label: 'Ready' },
    { path: '/api', label: 'API groups' },
    { path: '/apis', label: 'All APIs' },
    { path: '/api/v1/namespaces', label: 'Namespaces' },
    { path: '/api/v1/nodes', label: 'Nodes' },
    { path: '/api/v1/pods', label: 'Pods' },
  ];

  return (
    <ProtocolClientLayout title="Kubernetes Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="API Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="k8s-host"
            label="API Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="k8s.example.com or 10.0.0.1"
            required
            helpText="Kubernetes API server hostname or IP"
            error={errors.host}
          />
          <FormField
            id="k8s-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 6443 (HTTPS/TLS)"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <FormField
            id="k8s-token"
            label="Bearer Token"
            type="text"
            value={bearerToken}
            onChange={setBearerToken}
            onKeyDown={handleKeyDown}
            placeholder="eyJhbGciOiJ... (optional)"
            optional
            helpText="Service account or kubeconfig token — required for most endpoints"
          />
        </div>

        <SectionHeader stepNumber={2} title="Health Probe" color="green" />

        <div className="mb-6">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host}
            loading={loading}
            ariaLabel="Probe Kubernetes API server health"
          >
            Probe /healthz
          </ActionButton>
          <p className="text-xs text-slate-400 mt-2">
            Connects to the API server and checks <code className="text-slate-300">/healthz</code>.
            No token needed on most clusters.
          </p>
        </div>

        <SectionHeader stepNumber={3} title="API Query" color="blue" />

        <div className="mb-3">
          <FormField
            id="k8s-path"
            label="API Path"
            type="text"
            value={queryPath}
            onChange={setQueryPath}
            placeholder="/version"
            helpText="Any Kubernetes API path — requires Bearer token for most paths"
          />
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {quickPaths.map(({ path, label }) => (
            <button
              key={path}
              onClick={() => { setQueryPath(path); handleQuery(path); }}
              disabled={loading || !host}
              className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors disabled:opacity-50 font-mono"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mb-6">
          <button
            onClick={() => handleQuery()}
            disabled={loading || !host || !queryPath}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            Query
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Kubernetes API (port 6443)"
          description="The Kubernetes API server is the control plane gateway — all kubectl commands, controllers, and operators communicate through it. It exposes a REST/HTTPS API on port 6443. Health endpoints (/healthz, /livez, /readyz) are often unauthenticated. Everything else requires a Bearer token from a ServiceAccount or kubeconfig. Tokens can be obtained via: kubectl create token default"
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Common Endpoints</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-400">
            <div><code className="text-slate-300">/version</code> — Server version (usually needs token)</div>
            <div><code className="text-slate-300">/api/v1/namespaces</code> — List namespaces</div>
            <div><code className="text-slate-300">/api/v1/nodes</code> — Cluster nodes</div>
            <div><code className="text-slate-300">/api/v1/pods</code> — All pods (all namespaces)</div>
            <div><code className="text-slate-300">/apis/apps/v1/deployments</code> — Deployments</div>
            <div><code className="text-slate-300">/apis</code> — All API groups & versions</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
