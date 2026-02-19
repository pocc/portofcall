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

interface SonicClientProps {
  onBack: () => void;
}

export default function SonicClient({ onBack }: SonicClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1491');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [serverInfo, setServerInfo] = useState<{
    instanceId?: string;
    protocol?: number;
    bufferSize?: number;
    stats?: Record<string, string>;
  } | null>(null);

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
    setServerInfo(null);

    try {
      const response = await fetch('/api/sonic/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          password: password || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        instanceId?: string;
        protocol?: number;
        bufferSize?: number;
        rtt?: number;
        stats?: Record<string, string>;
        error?: string;
      };

      if (response.ok && data.success) {
        setServerInfo({
          instanceId: data.instanceId,
          protocol: data.protocol,
          bufferSize: data.bufferSize,
          stats: data.stats,
        });

        const lines = [
          `Sonic: ${host}:${port}`,
          '',
          `RTT: ${data.rtt}ms`,
        ];
        if (data.instanceId) lines.push(`Instance: ${data.instanceId}`);
        if (data.protocol) lines.push(`Protocol Version: ${data.protocol}`);
        if (data.bufferSize) lines.push(`Buffer Size: ${data.bufferSize}`);
        if (data.stats) {
          lines.push('');
          lines.push('Server Statistics:');
          for (const [key, value] of Object.entries(data.stats)) {
            lines.push(`  ${key}: ${value}`);
          }
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="Sonic Search Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Sonic || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="sonic-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="localhost"
            required
            helpText="Sonic server address"
            error={errors.host}
          />

          <FormField
            id="sonic-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 1491"
            error={errors.port}
          />

          <FormField
            id="sonic-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="Optional"
            helpText="Auth password (if configured)"
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe Sonic search backend"
        >
          Probe Server
        </ActionButton>

        {serverInfo && (
          <div className="mt-6">
            <SectionHeader stepNumber={2} title="Server Information" color="green" />

            <div className="bg-slate-700 rounded-lg p-4 space-y-3">
              {/* Instance & Protocol */}
              <div className="flex gap-6">
                {serverInfo.instanceId && (
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Instance ID</span>
                    <p className="text-sm text-blue-400 font-mono">{serverInfo.instanceId}</p>
                  </div>
                )}
                {serverInfo.protocol !== undefined && (
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Protocol</span>
                    <p className="text-sm text-green-400 font-mono">v{serverInfo.protocol}</p>
                  </div>
                )}
                {serverInfo.bufferSize !== undefined && (
                  <div>
                    <span className="text-xs font-semibold text-slate-400 uppercase">Buffer Size</span>
                    <p className="text-sm text-yellow-400 font-mono">{serverInfo.bufferSize.toLocaleString()} bytes</p>
                  </div>
                )}
              </div>

              {/* Server Stats */}
              {serverInfo.stats && Object.keys(serverInfo.stats).length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase block mb-2">Statistics</span>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {Object.entries(serverInfo.stats).map(([key, value]) => (
                      <div key={key} className="bg-slate-600/50 rounded px-2 py-1">
                        <span className="text-xs text-slate-400">{key}</span>
                        <p className="text-sm text-slate-200 font-mono">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Sonic"
          description="Sonic is a fast, lightweight search backend designed as an alternative to heavier solutions like Elasticsearch. It uses a simple text-based TCP protocol on port 1491 with three operating modes: search (query), ingest (index), and control (admin). This client probes the server in control mode to retrieve instance info and statistics."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 1491 (default)</p>
            <p><strong className="text-slate-300">Transport:</strong> TCP (text-based)</p>
            <p><strong className="text-slate-300">Framing:</strong> Line-oriented (\r\n terminated)</p>
            <p><strong className="text-slate-300">Auth:</strong> Optional password on START command</p>
            <p><strong className="text-slate-300">Modes:</strong> search, ingest, control</p>
            <p><strong className="text-slate-300">Commands:</strong> START, PING, QUIT, INFO, QUERY, PUSH</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
