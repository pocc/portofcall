import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface OSCARClientProps {
  onBack: () => void;
}

export default function OSCARClient({ onBack }: OSCARClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5190');
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
      const response = await fetch('/api/oscar/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), timeout: 15000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        channel?: number;
        channelName?: string;
        sequence?: number;
        dataLength?: number;
        rtt?: number;
      };

      if (data.success) {
        let msg = `OSCAR server detected at ${host}:${port}\n`;
        if (data.channelName) msg += `Channel: ${data.channelName} (${data.channel})\n`;
        if (data.sequence !== undefined) msg += `Sequence: ${data.sequence}\n`;
        if (data.dataLength !== undefined) msg += `Frame size: ${data.dataLength} bytes\n`;
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
    <ProtocolClientLayout title="OSCAR (AIM/ICQ) Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="oscar-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="login.oscar.aol.com"
            required
            error={errors.host}
          />

          <FormField
            id="oscar-port"
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
          ariaLabel="Probe OSCAR server"
        >
          Probe Server
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About OSCAR"
          description="OSCAR (Open System for CommunicAtion in Realtime) is the binary protocol used by AOL Instant Messenger (AIM) and ICQ. It uses FLAP frames and SNAC messages. This probes the login server FLAP handshake. Default port is 5190."
        />
      </div>
    </ProtocolClientLayout>
  );
}
