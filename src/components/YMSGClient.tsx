import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface YMSGClientProps {
  onBack: () => void;
}

export default function YMSGClient({ onBack }: YMSGClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5050');
  const [version, setVersion] = useState('16');
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
      const response = await fetch('/api/ymsg/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          version: parseInt(version) || 16,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        version?: number;
        service?: number;
        serviceName?: string;
        status?: number;
        sessionId?: number;
        payloadLength?: number;
        rtt?: number;
      };

      if (data.success) {
        let msg = `Yahoo Messenger server detected at ${host}:${port}\n`;
        if (data.version !== undefined) msg += `YMSG Version: ${data.version}\n`;
        if (data.serviceName) msg += `Service: ${data.serviceName} (${data.service})\n`;
        else if (data.service !== undefined) msg += `Service: ${data.service}\n`;
        if (data.sessionId !== undefined) msg += `Session ID: ${data.sessionId}\n`;
        if (data.payloadLength !== undefined) msg += `Payload: ${data.payloadLength} bytes\n`;
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
    <ProtocolClientLayout title="Yahoo Messenger (YMSG) Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Details" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-1">
            <FormField
              id="ymsg-host"
              label="Host"
              type="text"
              value={host}
              onChange={setHost}
              onKeyDown={handleKeyDown}
              placeholder="scs.msg.yahoo.com"
              required
              error={errors.host}
            />
          </div>

          <FormField
            id="ymsg-port"
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
            id="ymsg-version"
            label="YMSG Version"
            type="number"
            value={version}
            onChange={setVersion}
            onKeyDown={handleKeyDown}
            placeholder="16"
            optional
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe Yahoo Messenger server"
        >
          Probe Server
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About YMSG"
          description="YMSG is Yahoo Messenger's proprietary binary protocol (versions 9–16). It uses a 20-byte header with key-value pair payloads. This probes the server for protocol handshake information. Default port is 5050."
        />
      </div>
    </ProtocolClientLayout>
  );
}
