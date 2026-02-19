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

interface VentriloClientProps {
  onBack: () => void;
}

export default function VentriloClient({ onBack }: VentriloClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3784');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleStatus = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/ventrilo/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), timeout: 15000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        serverName?: string;
        version?: string;
        platform?: string;
        users?: number;
        maxUsers?: number;
        channels?: number;
        uptime?: number;
        rtt?: number;
      };

      if (data.success) {
        let msg = `Ventrilo server at ${host}:${port}\n`;
        if (data.serverName) msg += `Name: ${data.serverName}\n`;
        if (data.version) msg += `Version: ${data.version}\n`;
        if (data.platform) msg += `Platform: ${data.platform}\n`;
        if (data.users !== undefined) msg += `Users: ${data.users}`;
        if (data.maxUsers !== undefined) msg += `/${data.maxUsers}`;
        if (data.users !== undefined) msg += '\n';
        if (data.channels !== undefined) msg += `Channels: ${data.channels}\n`;
        if (data.uptime !== undefined) msg += `Uptime: ${Math.floor(data.uptime / 3600)}h ${Math.floor((data.uptime % 3600) / 60)}m\n`;
        if (data.rtt !== undefined) msg += `RTT: ${data.rtt}ms`;
        setResult(msg);
      } else {
        setError(data.error || 'Status request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleStatus();
    }
  };

  return (
    <ProtocolClientLayout title="Ventrilo Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Ventrilo || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ventrilo-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="ventrilo.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="ventrilo-port"
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
          onClick={handleStatus}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Get Ventrilo server status"
        >
          Get Status
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Ventrilo"
          description="Ventrilo is a proprietary VoIP application popular in online gaming communities. This client queries the TCP status endpoint to retrieve server name, version, user count, and channel information. Default port is 3784."
        />
      </div>
    </ProtocolClientLayout>
  );
}
