import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface InformixClientProps {
  onBack: () => void;
}

export default function InformixClient({ onBack }: InformixClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9088');
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
      const response = await fetch('/api/informix/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), timeout: 15000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        serverInfo?: string;
        version?: string;
        isInformix?: boolean;
        dataLength?: number;
        rtt?: number;
      };

      if (data.success) {
        let msg = `IBM Informix server detected at ${host}:${port}\n`;
        if (data.version) msg += `Version: ${data.version}\n`;
        if (data.serverInfo) msg += `Server Info: ${data.serverInfo}\n`;
        if (data.dataLength !== undefined) msg += `Response size: ${data.dataLength} bytes\n`;
        if (data.rtt !== undefined) msg += `RTT: ${data.rtt}ms`;
        setResult(msg);
      } else {
        setError(data.error || 'Probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
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
    <ProtocolClientLayout title="IBM Informix Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="informix-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="informix.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="informix-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe Informix server"
        >
          Probe Server
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About IBM Informix"
          description="IBM Informix Dynamic Server is a relational database system. This tests connectivity by sending an SQLI protocol probe to detect the Informix binary protocol handshake and extract server version information. Default port is 9088 (onsoctcp). Legacy port 1526 (sqlexec) is also supported."
        />
      </div>
    </ProtocolClientLayout>
  );
}
