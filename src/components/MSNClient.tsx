import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface MSNClientProps {
  onBack: () => void;
}

export default function MSNClient({ onBack }: MSNClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1863');
  const [protocolVersion, setProtocolVersion] = useState('MSNP18');
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
      const response = await fetch('/api/msn/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          protocolVersion: protocolVersion || 'MSNP18',
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        supportedVersions?: string[];
        serverResponse?: string;
        protocolVersion?: string;
        rtt?: number;
      };

      if (data.success) {
        let msg = `MSN/MSNP server detected at ${host}:${port}\n`;
        if (data.protocolVersion) msg += `Negotiated Version: ${data.protocolVersion}\n`;
        if (data.supportedVersions?.length) msg += `Supported: ${data.supportedVersions.join(', ')}\n`;
        if (data.serverResponse) msg += `Server Response: ${data.serverResponse}\n`;
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
    <ProtocolClientLayout title="MSN Messenger (MSNP) Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Details" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-1">
            <FormField
              id="msn-host"
              label="Host"
              type="text"
              value={host}
              onChange={setHost}
              onKeyDown={handleKeyDown}
              placeholder="messenger.hotmail.com"
              required
              error={errors.host}
            />
          </div>

          <FormField
            id="msn-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            error={errors.port}
          />

          <FormField
            id="msn-version"
            label="Protocol Version"
            type="text"
            value={protocolVersion}
            onChange={setProtocolVersion}
            onKeyDown={handleKeyDown}
            placeholder="MSNP18"
            optional
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe MSN server"
        >
          Probe Server
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About MSN/MSNP"
          description="MSNP (Microsoft Notification Protocol) is the text-based protocol used by MSN Messenger / Windows Live Messenger. It negotiates protocol versions via VER/CVR commands. Default port is 1863."
        />
      </div>
    </ProtocolClientLayout>
  );
}
