import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SybaseClientProps {
  onBack: () => void;
}

export default function SybaseClient({ onBack }: SybaseClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5000');
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
      const response = await fetch('/api/sybase/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 15000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        packetType?: number;
        packetTypeName?: string;
        status?: number;
        length?: number;
        isSybase?: boolean;
        rtt?: number;
      };

      if (data.success) {
        let msg = `Sybase ASE server detected at ${host}:${port}\n`;
        if (data.packetTypeName) msg += `Packet Type: ${data.packetTypeName} (${data.packetType})\n`;
        else if (data.packetType !== undefined) msg += `Packet Type: ${data.packetType}\n`;
        if (data.length !== undefined) msg += `Response length: ${data.length} bytes\n`;
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
    <ProtocolClientLayout title="Sybase ASE Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="sybase-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="sybase.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="sybase-port"
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
          ariaLabel="Probe Sybase server"
        >
          Probe Server
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Sybase ASE"
          description="Sybase Adaptive Server Enterprise (ASE) uses the TDS (Tabular Data Stream) protocol, shared with Microsoft SQL Server. This probes the TDS Prelogin packet to detect server presence and version. Default port is 5000."
        />
      </div>
    </ProtocolClientLayout>
  );
}
