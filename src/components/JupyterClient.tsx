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

interface JupyterClientProps {
  onBack: () => void;
}

export default function JupyterClient({ onBack }: JupyterClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8888');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Query mode state
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/api');
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
      const response = await fetch('/api/jupyter/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          token: token || undefined,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        isCloudflare?: boolean;
        statusCode?: number;
        latencyMs?: number;
        parsed?: {
          api?: { version?: string };
          status?: {
            kernel_connections?: number;
            last_activity?: string;
            msg_rate?: number;
            started?: string;
          };
          kernelspecs?: {
            default?: string;
            kernelNames?: string[];
          };
          requiresAuth?: boolean;
        };
      };

      if (data.success && data.parsed) {
        const { api, status, kernelspecs, requiresAuth } = data.parsed;

        let output = `Jupyter Health Check (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;
        output += `Status: Connected (HTTP ${data.statusCode})\n`;

        if (requiresAuth) {
          output += `Auth: Token required\n`;
        } else {
          output += `Auth: No token required\n`;
        }

        if (api?.version) {
          output += `\nJupyter API\n`;
          output += `${'-'.repeat(30)}\n`;
          output += `Version: ${api.version}\n`;
        }

        if (status) {
          output += `\nServer Status\n`;
          output += `${'-'.repeat(30)}\n`;
          if (status.kernel_connections !== undefined) {
            output += `Kernel connections: ${status.kernel_connections}\n`;
          }
          if (status.msg_rate !== undefined) {
            output += `Message rate: ${status.msg_rate}/s\n`;
          }
          if (status.started) {
            output += `Started: ${status.started}\n`;
          }
          if (status.last_activity) {
            output += `Last activity: ${status.last_activity}\n`;
          }
        }

        if (kernelspecs) {
          output += `\nKernel Specifications\n`;
          output += `${'-'.repeat(30)}\n`;
          if (kernelspecs.default) {
            output += `Default kernel: ${kernelspecs.default}\n`;
          }
          if (kernelspecs.kernelNames && kernelspecs.kernelNames.length > 0) {
            output += `Available kernels: ${kernelspecs.kernelNames.join(', ')}\n`;
          }
        }

        setResult(output);
      } else if (data.statusCode === 401 || data.statusCode === 403) {
        setError(`Authentication required — provide a token in the Token field.\nHTTP ${data.statusCode}`);
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
      const response = await fetch('/api/jupyter/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          token: token || undefined,
          method,
          path,
          body: queryBody || undefined,
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
        let output = `${method} ${path} → ${data.statusCode} (${data.latencyMs}ms)\n`;
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
        if (data.statusCode === 401 || data.statusCode === 403) {
          errMsg += '\nHint: provide a token to authenticate';
        }
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

  const handleQuickQuery = (qMethod: string, qPath: string) => {
    setMethod(qMethod);
    setPath(qPath);
    setQueryBody('');
  };

  return (
    <ProtocolClientLayout title="Jupyter Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Jupyter || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="jupyter-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="localhost"
            required
            helpText="Jupyter server hostname or IP"
            error={errors.host}
          />

          <FormField
            id="jupyter-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 8888"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <FormField
            id="jupyter-token"
            label="Token"
            type="text"
            value={token}
            onChange={setToken}
            onKeyDown={handleKeyDown}
            placeholder="(optional — leave blank for unauthenticated servers)"
            helpText="Authorization token from jupyter server output or --NotebookApp.token"
          />
        </div>

        <ActionButton
          onClick={handleHealthCheck}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Check Jupyter server health"
          variant="success"
        >
          Health Check
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="API Query" color="purple" />

        <div className="grid md:grid-cols-4 gap-4 mb-4">
          <div>
            <label htmlFor="jupyter-method" className="block text-sm font-medium text-slate-300 mb-1">
              Method
            </label>
            <select
              id="jupyter-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="DELETE">DELETE</option>
              <option value="PATCH">PATCH</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <FormField
              id="jupyter-path"
              label="Path"
              type="text"
              value={path}
              onChange={setPath}
              placeholder="/api"
              helpText="Jupyter REST API endpoint"
            />
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="jupyter-body" className="block text-sm font-medium text-slate-300 mb-1">
            Request Body <span className="text-xs text-slate-400">(optional, JSON)</span>
          </label>
          <textarea
            id="jupyter-body"
            value={queryBody}
            onChange={(e) => setQueryBody(e.target.value)}
            placeholder='{"kernel": {"name": "python3"}}'
            rows={3}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
          />
        </div>

        <ActionButton
          onClick={handleQuery}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Execute Jupyter API query"
          variant="primary"
        >
          Execute Query
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Queries</h3>
          <div className="grid gap-2">
            {[
              { label: 'GET /api (version)', method: 'GET', path: '/api' },
              { label: 'GET /api/status', method: 'GET', path: '/api/status' },
              { label: 'GET /api/kernelspecs', method: 'GET', path: '/api/kernelspecs' },
              { label: 'GET /api/kernels (running)', method: 'GET', path: '/api/kernels' },
              { label: 'GET /api/sessions', method: 'GET', path: '/api/sessions' },
              { label: 'GET /api/contents (root)', method: 'GET', path: '/api/contents' },
              { label: 'GET /api/terminals', method: 'GET', path: '/api/terminals' },
              { label: 'GET /api/nbformat', method: 'GET', path: '/api/nbformat' },
            ].map(({ label, method: qMethod, path: qPath }) => (
              <button
                key={label}
                onClick={() => handleQuickQuery(qMethod, qPath)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-purple-400">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <HelpSection
          title="About Jupyter REST API"
          description="Jupyter Notebook and JupyterLab expose a REST API on port 8888 for managing kernels, sessions, notebooks, and terminals. This client sends raw HTTP/1.1 requests over TCP. Authentication uses a token passed via the Authorization header. Start Jupyter with jupyter notebook --no-browser or jupyter lab to get the token from server startup output."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
