import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface PerforceClientProps {
  onBack: () => void;
}

export default function PerforceClient({ onBack }: PerforceClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1666');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

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
      const response = await fetch('/api/perforce/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 10000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        tcpLatency?: number;
        isPerforceServer?: boolean;
        serverVersion?: string;
        serverInfo?: Record<string, string>;
        note?: string;
      };

      if (data.success) {
        const lines = [
          `Perforce Probe — ${host}:${port}`,
          '='.repeat(60),
          `TCP Latency:     ${data.tcpLatency}ms`,
          `Perforce Server: ${data.isPerforceServer ? '✓ Yes' : '✗ Not detected'}`,
        ];
        if (data.serverVersion) lines.push(`Version:         ${data.serverVersion}`);
        if (data.serverInfo && Object.keys(data.serverInfo).length > 0) {
          lines.push('', '--- Server Info ---');
          for (const [k, v] of Object.entries(data.serverInfo)) {
            lines.push(`  ${k}: ${v}`);
          }
        }
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

  const handleInfo = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/perforce/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 10000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        tcpLatency?: number;
        isPerforceServer?: boolean;
        serverVersion?: string;
        serverAddress?: string;
        serverDate?: string;
        serverLicense?: string;
        serverRoot?: string;
        caseHandling?: string;
        rawInfo?: Record<string, string>;
      };

      if (data.success) {
        const lines = [
          `Perforce Info — ${host}:${port}`,
          '='.repeat(60),
          `TCP Latency:     ${data.tcpLatency}ms`,
          `Perforce Server: ${data.isPerforceServer ? '✓ Yes' : '✗ Not detected'}`,
        ];
        if (data.serverVersion) lines.push(`Version:         ${data.serverVersion}`);
        if (data.serverAddress) lines.push(`Address:         ${data.serverAddress}`);
        if (data.serverDate) lines.push(`Server Date:     ${data.serverDate}`);
        if (data.serverRoot) lines.push(`Server Root:     ${data.serverRoot}`);
        if (data.caseHandling) lines.push(`Case Handling:   ${data.caseHandling}`);
        if (data.serverLicense) lines.push(`License:         ${data.serverLicense}`);
        if (data.rawInfo && Object.keys(data.rawInfo).length > 0) {
          lines.push('', '--- Raw Fields ---');
          for (const [k, v] of Object.entries(data.rawInfo)) {
            lines.push(`  ${k}: ${v}`);
          }
        }
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Info query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) handleProbe();
  };

  return (
    <ProtocolClientLayout title="Perforce Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Perforce Server (p4d)" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="p4-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="perforce.example.com"
            required
            error={errors.host}
          />
          <FormField
            id="p4-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 1666 (p4d standard)"
            error={errors.port}
          />
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host}
            loading={loading}
            ariaLabel="Probe Perforce server"
          >
            Probe (Protocol)
          </ActionButton>
          <button
            onClick={handleInfo}
            disabled={loading || !host}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            Server Info
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Perforce Helix Core (port 1666)"
          description="Perforce Helix Core is a proprietary version control system widely used in game development (EA, Activision, Epic Games) and large enterprises. The p4d server listens on port 1666 by default and uses a binary tagged wire protocol. This probe sends a protocol negotiation message to detect the server and retrieve version information. Full operations require authentication and a licensed p4 client."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
