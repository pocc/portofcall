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

interface SANEClientProps {
  onBack: () => void;
}

export default function SANEClient({ onBack }: SANEClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6566');
  const [username, setUsername] = useState('anonymous');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [daemonInfo, setDaemonInfo] = useState<{
    version?: string;
    versionCode?: number;
    statusCode?: number;
    statusMessage?: string;
    rtt?: number;
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
    setDaemonInfo(null);

    try {
      const response = await fetch('/api/sane/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username: username || 'anonymous',
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        isCloudflare?: boolean;
        host?: string;
        port?: number;
        rtt?: number;
        version?: string;
        versionCode?: number;
        statusCode?: number;
        statusMessage?: string;
      };

      if (response.ok && data.success) {
        setDaemonInfo({
          version: data.version,
          versionCode: data.versionCode,
          statusCode: data.statusCode,
          statusMessage: data.statusMessage,
          rtt: data.rtt,
        });

        const lines = [
          `SANE Daemon: ${data.host}:${data.port}`,
          `RTT: ${data.rtt}ms`,
          '',
          `Status: ${data.statusMessage} (code ${data.statusCode})`,
          `Version: ${data.version}`,
        ];

        if (data.versionCode !== undefined) {
          lines.push(`Version Code: 0x${data.versionCode.toString(16).padStart(8, '0')}`);
        }

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="SANE Network Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.SANE || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="SANE Daemon Connection" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="sane-host"
            label="Scanner Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="scanner.local"
            required
            helpText="Host running saned"
            error={errors.host}
          />

          <FormField
            id="sane-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 6566"
            error={errors.port}
          />

          <FormField
            id="sane-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="anonymous"
            helpText="SANE client username"
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe SANE daemon"
        >
          Probe Scanner Daemon
        </ActionButton>

        {daemonInfo && (
          <div className="mt-6">
            <SectionHeader stepNumber={2} title="Daemon Information" color="green" />

            <div className="bg-slate-700 rounded-lg p-4 space-y-3">
              {/* Status */}
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${daemonInfo.statusCode === 0 ? 'bg-green-500' : 'bg-red-500'}`} />
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Status</span>
                  <p className={`text-sm font-mono ${daemonInfo.statusCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {daemonInfo.statusMessage}
                  </p>
                </div>
              </div>

              {/* Version */}
              {daemonInfo.version && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">SANE Version</span>
                  <p className="text-sm text-blue-400 font-mono">{daemonInfo.version}</p>
                </div>
              )}

              {daemonInfo.versionCode !== undefined && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Version Code</span>
                  <p className="text-sm text-slate-200 font-mono">
                    0x{daemonInfo.versionCode.toString(16).padStart(8, '0')}
                  </p>
                </div>
              )}

              {daemonInfo.rtt !== undefined && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase">Round Trip Time</span>
                  <p className="text-sm text-slate-200 font-mono">{daemonInfo.rtt}ms</p>
                </div>
              )}
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SANE Network Protocol"
          description="SANE (Scanner Access Now Easy) is the standard scanner framework on Linux/Unix. The network daemon (saned) listens on port 6566 and allows remote scanner access. The protocol uses 4-byte big-endian words and length-prefixed strings. SANE_NET_INIT exchanges version information and authenticates the client. Configure saned access via /etc/sane.d/saned.conf."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 6566 (TCP)</p>
            <p><strong className="text-slate-300">Encoding:</strong> Big-endian binary (4-byte words)</p>
            <p><strong className="text-slate-300">Auth:</strong> Username-based (saned.conf ACL)</p>
            <p><strong className="text-slate-300">Config:</strong> /etc/sane.d/saned.conf</p>
            <p><strong className="text-slate-300">Backends:</strong> CUPS, EPSON, HP, Brother, etc.</p>
            <p><strong className="text-slate-300">Project:</strong> sane-project.org</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
