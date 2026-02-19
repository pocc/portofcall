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

interface XMPPS2SClientProps {
  onBack: () => void;
}

export default function XMPPS2SClient({ onBack }: XMPPS2SClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5269');
  const [fromDomain, setFromDomain] = useState('');
  const [toDomain, setToDomain] = useState('');
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
      const response = await fetch('/api/xmpps2s/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          fromDomain: fromDomain || 'probe.example.com',
          toDomain: toDomain || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        serverDomain?: string;
        features?: {
          starttls?: boolean;
          dialback?: boolean;
          sasl?: string[];
        };
        streamId?: string;
        version?: string;
        rtt?: number;
      };

      if (data.success) {
        let msg = `XMPP S2S server detected at ${host}:${port}\n`;
        if (data.serverDomain) msg += `Server Domain: ${data.serverDomain}\n`;
        if (data.streamId) msg += `Stream ID: ${data.streamId}\n`;
        if (data.version) msg += `Version: ${data.version}\n`;
        if (data.features) {
          const feats: string[] = [];
          if (data.features.starttls) feats.push('STARTTLS');
          if (data.features.dialback) feats.push('Dialback');
          if (data.features.sasl?.length) feats.push(`SASL: ${data.features.sasl.join(', ')}`);
          if (feats.length) msg += `Features: ${feats.join(', ')}\n`;
        }
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
    <ProtocolClientLayout title="XMPP S2S (Server Federation) Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.XmppS2S || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="xmpps2s-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="xmpp.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="xmpps2s-port"
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
            id="xmpps2s-from"
            label="From Domain"
            type="text"
            value={fromDomain}
            onChange={setFromDomain}
            onKeyDown={handleKeyDown}
            placeholder="probe.example.com"
            optional
          />

          <FormField
            id="xmpps2s-to"
            label="To Domain"
            type="text"
            value={toDomain}
            onChange={setToDomain}
            onKeyDown={handleKeyDown}
            placeholder="target.example.com"
            optional
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe XMPP S2S server"
        >
          Probe Federation
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About XMPP S2S"
          description="XMPP Server-to-Server (S2S) federation (RFC 6120) allows XMPP servers to exchange messages between different domains. This probes the S2S stream opening and detects advertised features like STARTTLS and Dialback. Default port is 5269."
        />
      </div>
    </ProtocolClientLayout>
  );
}
