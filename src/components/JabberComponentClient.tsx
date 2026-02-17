import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface JabberComponentClientProps {
  onBack: () => void;
}

export default function JabberComponentClient({ onBack }: JabberComponentClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5275');
  const [componentDomain, setComponentDomain] = useState('');
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
      const response = await fetch('/api/jabber-component/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          componentDomain: componentDomain || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        streamId?: string;
        serverDomain?: string;
        version?: string;
        rtt?: number;
      };

      if (data.success) {
        let msg = `Jabber Component server detected at ${host}:${port}\n`;
        if (data.serverDomain) msg += `Server Domain: ${data.serverDomain}\n`;
        if (data.streamId) msg += `Stream ID: ${data.streamId}\n`;
        if (data.version) msg += `Version: ${data.version}\n`;
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
    <ProtocolClientLayout title="Jabber Component (XEP-0114) Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="jabber-host"
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
            id="jabber-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            error={errors.port}
          />

          <div className="md:col-span-2">
            <FormField
              id="jabber-domain"
              label="Component Domain"
              type="text"
              value={componentDomain}
              onChange={setComponentDomain}
              onKeyDown={handleKeyDown}
              placeholder="component.example.com"
              optional
            />
          </div>
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe Jabber Component server"
        >
          Probe Server
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Jabber Component Protocol"
          description="XEP-0114 defines the Jabber Component Protocol, used to connect external components (bots, gateways, services) to XMPP servers. The component authenticates via a SHA-1 handshake. Default port is 5275."
        />
      </div>
    </ProtocolClientLayout>
  );
}
