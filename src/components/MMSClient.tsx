import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface MMSClientProps {
  onBack: () => void;
}

export default function MMSClient({ onBack }: MMSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1755');
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
      const response = await fetch('/api/mms/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), timeout: 15000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        serverVersion?: string;
        serverInfo?: string;
        commandCode?: number;
        commandName?: string;
        dataLength?: number;
        rtt?: number;
      };

      if (data.success) {
        let msg = `Microsoft Media Server detected at ${host}:${port}\n`;
        if (data.serverVersion) msg += `Server Version: ${data.serverVersion}\n`;
        if (data.serverInfo) msg += `Server Info: ${data.serverInfo}\n`;
        if (data.commandName) msg += `Command: ${data.commandName} (0x${data.commandCode?.toString(16).toUpperCase()})\n`;
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
    <ProtocolClientLayout title="MMS (Microsoft Media Server) Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="mms-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="media.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="mms-port"
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
          ariaLabel="Probe MMS server"
        >
          Probe Server
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About MMS"
          description="Microsoft Media Services (MMS) is a proprietary streaming protocol used by Windows Media Player and Windows Media Services. It uses a binary command structure over TCP. Default port is 1755."
        />
      </div>
    </ProtocolClientLayout>
  );
}
