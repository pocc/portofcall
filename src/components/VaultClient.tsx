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

interface VaultClientProps {
  onBack: () => void;
}

export default function VaultClient({ onBack }: VaultClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8200');
  const [token, setToken] = useState('');
  const [queryPath, setQueryPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/vault/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          token: token || undefined,
          timeout: 15000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        statusCode?: number;
        version?: string;
        initialized?: boolean;
        sealed?: boolean;
        standby?: boolean;
        clusterName?: string;
        clusterId?: string;
        performanceStandby?: boolean;
        replicationPerfMode?: string;
        replicationDrMode?: string;
        sealType?: string;
        sealThreshold?: number;
        sealShares?: number;
        sealProgress?: number;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Vault Server Info\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `HTTP Status: ${data.statusCode}\n`;
        if (data.version) resultText += `Version: ${data.version}\n`;
        resultText += `\nStatus:\n`;
        resultText += `${'-'.repeat(30)}\n`;
        if (data.initialized !== null) resultText += `  Initialized: ${data.initialized}\n`;
        if (data.sealed !== null) resultText += `  Sealed:      ${data.sealed}\n`;
        if (data.standby !== null) resultText += `  Standby:     ${data.standby}\n`;
        if (data.performanceStandby !== null) resultText += `  Perf Standby: ${data.performanceStandby}\n`;
        if (data.clusterName) {
          resultText += `\nCluster:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += `  Name: ${data.clusterName}\n`;
          if (data.clusterId) resultText += `  ID:   ${data.clusterId}\n`;
        }
        if (data.sealType) {
          resultText += `\nSeal Configuration:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += `  Type:      ${data.sealType}\n`;
          if (data.sealThreshold !== null) resultText += `  Threshold: ${data.sealThreshold}\n`;
          if (data.sealShares !== null) resultText += `  Shares:    ${data.sealShares}\n`;
          if (data.sealProgress !== null) resultText += `  Progress:  ${data.sealProgress}\n`;
        }
        if (data.replicationPerfMode) resultText += `\nReplication Perf Mode: ${data.replicationPerfMode}\n`;
        if (data.replicationDrMode) resultText += `Replication DR Mode: ${data.replicationDrMode}\n`;

        setResult(resultText);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async (path?: string) => {
    const pathToQuery = path || queryPath;
    if (!pathToQuery) return;

    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/vault/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          path: pathToQuery,
          token: token || undefined,
          timeout: 15000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        path?: string;
        rtt?: number;
        statusCode?: number;
        response?: unknown;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Path: ${data.path}\n`;
        resultText += `HTTP Status: ${data.statusCode}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += typeof data.response === 'string'
          ? data.response
          : JSON.stringify(data.response, null, 2);

        setResult(resultText);
      } else {
        setError(data.error || 'Query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="Vault Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Vault || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="vault-host"
            label="Vault Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="vault.example.com"
            required
            helpText="Hostname or IP of the Vault server"
            error={errors.host}
          />

          <FormField
            id="vault-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 8200"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <FormField
            id="vault-token"
            label="Vault Token"
            type="password"
            value={token}
            onChange={setToken}
            onKeyDown={handleKeyDown}
            placeholder="hvs.XXXXXXXXXXXXXXXX"
            optional
            helpText="Optional. Required for authenticated endpoints."
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test Vault connection and retrieve health status"
        >
          Connect & Health Check
        </ActionButton>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={2} title="Query API" />

          <div className="mb-4">
            <FormField
              id="vault-path"
              label="API Path"
              type="text"
              value={queryPath}
              onChange={setQueryPath}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter' && !loading && host && port && queryPath) {
                  handleQuery();
                }
              }}
              placeholder="/v1/sys/health"
              helpText="Read-only: only /v1/sys/* paths are allowed"
            />
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {[
              '/v1/sys/health',
              '/v1/sys/seal-status',
              '/v1/sys/leader',
              '/v1/sys/host-info',
              '/v1/sys/mounts',
              '/v1/sys/auth',
            ].map((path) => (
              <button
                key={path}
                onClick={() => {
                  setQueryPath(path);
                  handleQuery(path);
                }}
                disabled={loading || !host || !port}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm rounded transition-colors font-mono"
              >
                {path.replace('/v1/sys/', '')}
              </button>
            ))}
          </div>

          <button
            onClick={() => handleQuery()}
            disabled={loading || !host || !port || !queryPath}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Execute Vault API query"
          >
            {loading ? 'Querying...' : 'Query'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About HashiCorp Vault"
          description="Vault is a secrets management tool that provides a unified interface for managing secrets, encryption keys, and access control. Its HTTP API on port 8200 exposes system endpoints (/v1/sys/*) for health checks, seal status, leader info, and mount configuration. The health endpoint is typically unauthenticated."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
