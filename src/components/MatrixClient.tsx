import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface MatrixClientProps {
  onBack: () => void;
}

export default function MatrixClient({ onBack }: MatrixClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8448');
  const [accessToken, setAccessToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Query mode state
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/_matrix/client/versions');
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
      const response = await fetch('/api/matrix/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        parsed?: {
          versions?: {
            versions?: string[];
            unstable_features?: Record<string, boolean>;
          };
          loginFlows?: {
            flows?: Array<{ type: string }>;
          };
          federation?: {
            server?: { name?: string; version?: string };
          };
        };
      };

      if (data.success && data.parsed) {
        const { versions, loginFlows, federation } = data.parsed;

        let output = `Matrix Homeserver Discovery (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;

        if (federation?.server) {
          output += `Server Software\n`;
          output += `${'-'.repeat(30)}\n`;
          output += `Name: ${federation.server.name || 'unknown'}\n`;
          output += `Version: ${federation.server.version || 'unknown'}\n\n`;
        }

        if (versions?.versions) {
          output += `Supported Spec Versions\n`;
          output += `${'-'.repeat(30)}\n`;
          versions.versions.forEach((v: string) => {
            output += `  ${v}\n`;
          });
          output += `\n`;
        }

        if (versions?.unstable_features) {
          const features = Object.entries(versions.unstable_features);
          if (features.length > 0) {
            output += `Unstable Features (${features.length} total)\n`;
            output += `${'-'.repeat(30)}\n`;
            features.slice(0, 10).forEach(([key, enabled]) => {
              output += `  ${enabled ? '✓' : '✕'} ${key}\n`;
            });
            if (features.length > 10) {
              output += `  ... and ${features.length - 10} more\n`;
            }
            output += `\n`;
          }
        }

        if (loginFlows?.flows) {
          output += `Login Methods\n`;
          output += `${'-'.repeat(30)}\n`;
          loginFlows.flows.forEach((flow: { type: string }) => {
            output += `  ${flow.type}\n`;
          });
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
      const response = await fetch('/api/matrix/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          method,
          path,
          body: queryBody || undefined,
          accessToken: accessToken || undefined,
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

  const handleQuickQuery = (qMethod: string, qPath: string) => {
    setMethod(qMethod);
    setPath(qPath);
    setQueryBody('');
  };

  return (
    <ProtocolClientLayout title="Matrix Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="matrix-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="matrix.org"
            required
            helpText="Matrix homeserver hostname"
            error={errors.host}
          />

          <FormField
            id="matrix-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 8448 (federation), 443 (client)"
            error={errors.port}
          />

          <FormField
            id="matrix-token"
            label="Access Token"
            type="password"
            value={accessToken}
            onChange={setAccessToken}
            onKeyDown={handleKeyDown}
            placeholder="syt_..."
            optional
            helpText="Bearer token for authenticated API calls"
          />
        </div>

        <ActionButton
          onClick={handleHealthCheck}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Check Matrix homeserver"
          variant="success"
        >
          Server Discovery
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="API Query" color="purple" />

        <div className="grid md:grid-cols-4 gap-4 mb-4">
          <div>
            <label htmlFor="matrix-method" className="block text-sm font-medium text-slate-300 mb-1">
              Method
            </label>
            <select
              id="matrix-method"
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
              id="matrix-path"
              label="Path"
              type="text"
              value={path}
              onChange={setPath}
              placeholder="/_matrix/client/versions"
              helpText="Matrix API endpoint path"
            />
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="matrix-body" className="block text-sm font-medium text-slate-300 mb-1">
            Request Body <span className="text-xs text-slate-400">(optional, JSON)</span>
          </label>
          <textarea
            id="matrix-body"
            value={queryBody}
            onChange={(e) => setQueryBody(e.target.value)}
            placeholder='{"limit": 10}'
            rows={3}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
          />
        </div>

        <ActionButton
          onClick={handleQuery}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Execute Matrix API query"
          variant="primary"
        >
          Execute Query
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Queries</h3>
          <div className="grid gap-2">
            {[
              { label: 'GET /_matrix/client/versions', method: 'GET', path: '/_matrix/client/versions' },
              { label: 'GET /_matrix/client/v3/login (flows)', method: 'GET', path: '/_matrix/client/v3/login' },
              { label: 'GET /_matrix/federation/v1/version', method: 'GET', path: '/_matrix/federation/v1/version' },
              { label: 'GET /.well-known/matrix/server', method: 'GET', path: '/.well-known/matrix/server' },
              { label: 'GET /.well-known/matrix/client', method: 'GET', path: '/.well-known/matrix/client' },
              { label: 'GET /_matrix/client/v3/publicRooms?limit=5', method: 'GET', path: '/_matrix/client/v3/publicRooms?limit=5' },
              { label: 'GET /_matrix/client/v3/capabilities', method: 'GET', path: '/_matrix/client/v3/capabilities' },
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
          title="About Matrix Protocol"
          description="Matrix is an open standard for decentralized, real-time communication. Homeservers communicate via federation (port 8448) using HTTP JSON APIs. This client sends raw HTTP/1.1 requests over TCP sockets. Features include end-to-end encryption, room-based messaging, VoIP, and bridges to other platforms. Popular implementations include Synapse, Dendrite, and Conduit."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
