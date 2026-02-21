import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface UUCPClientProps {
  onBack: () => void;
}

export default function UUCPClient({ onBack }: UUCPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('540');
  const [systemName, setSystemName] = useState('probe');
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
      const response = await fetch('/api/uucp/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          systemName: systemName || 'probe',
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        tcpLatency?: number;
        isUUCPServer?: boolean;
        serverSystem?: string;
        serverGreeting?: string;
        handshakeResult?: string;
        note?: string;
        security?: string;
      };

      if (data.success) {
        const lines = [
          `UUCP Probe — ${host}:${port}`,
          '='.repeat(60),
          `TCP Latency:  ${data.tcpLatency}ms`,
          `UUCP Server:  ${data.isUUCPServer ? '✓ Yes' : '✗ Not detected'}`,
        ];
        if (data.serverSystem) lines.push(`Remote Name:  ${data.serverSystem}`);
        if (data.serverGreeting) lines.push(`Greeting:     ${data.serverGreeting}`);
        if (data.handshakeResult) lines.push(`Handshake:    ${data.handshakeResult}`);
        if (data.note) lines.push('', data.note);
        if (data.security) lines.push('', `⚠ Security: ${data.security}`);
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
    if (e.key === 'Enter' && !loading && host) handleProbe();
  };

  return (
    <ProtocolClientLayout title="UUCP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="UUCP Daemon" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="uucp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="uucp.example.com"
            required
            error={errors.host}
          />
          <FormField
            id="uucp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 540 (uucpd)"
            error={errors.port}
          />
          <FormField
            id="uucp-sysname"
            label="System Name"
            type="text"
            value={systemName}
            onChange={setSystemName}
            onKeyDown={handleKeyDown}
            placeholder="probe"
            optional
            helpText="Client system name sent during handshake"
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Probe UUCP daemon"
        >
          Probe UUCP
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About UUCP (port 540)"
          description="UUCP (Unix-to-Unix Copy) is a store-and-forward protocol from the pre-internet era (1970s–1990s). It was used to transfer files and email between systems over serial or dial-up connections. The daemon (uucpd) listens on port 540/TCP. The handshake starts with a wakeup (\r\0), the server responds with its system name, and the client identifies itself. Virtually obsolete — replaced entirely by SSH/SFTP."
          showKeyboardShortcut={true}
        />

        <div className="mt-4 p-3 bg-amber-900/20 border border-amber-700/40 rounded-lg">
          <p className="text-xs text-amber-400">
            ⚠ UUCP transmits in plaintext with trust-based authentication. Use SSH or SFTP for all file transfers.
          </p>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
