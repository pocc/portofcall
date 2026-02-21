import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface MumbleClientProps {
  onBack: () => void;
}

export default function MumbleClient({ onBack }: MumbleClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('64738');
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
      const response = await fetch('/api/mumble/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 15000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        serverVersion?: string;
        serverRelease?: string;
        serverOS?: string;
        messageType?: number;
        messageTypeName?: string;
        rtt?: number;
      };

      if (data.success) {
        let msg = `Mumble server detected at ${host}:${port}\n`;
        if (data.serverVersion) msg += `Version: ${data.serverVersion}\n`;
        if (data.serverRelease) msg += `Release: ${data.serverRelease}\n`;
        if (data.serverOS) msg += `OS: ${data.serverOS}\n`;
        if (data.messageTypeName) msg += `Message Type: ${data.messageTypeName}\n`;
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
    <ProtocolClientLayout title="Mumble VoIP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="mumble-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="mumble.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="mumble-port"
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
          ariaLabel="Probe Mumble server"
        >
          Get Server Version
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Mumble"
          description="Mumble is an open-source, low-latency VoIP application popular in gaming communities. It uses Protocol Buffers (protobuf) for its binary message format. This probes the version handshake to retrieve server version and OS information. Default port is 64738."
        />
      </div>
    </ProtocolClientLayout>
  );
}
