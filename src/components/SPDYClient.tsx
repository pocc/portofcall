import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SPDYClientProps {
  onBack: () => void;
}

export default function SPDYClient({ onBack }: SPDYClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('443');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/spdy/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        tlsConnected?: boolean;
        spdyDetected?: boolean;
        protocol?: string;
        note?: string;
        isCloudflare?: boolean;
      };

      if (data.isCloudflare) {
        setError(data.error || 'Target is behind Cloudflare');
        return;
      }

      if (data.success || data.tlsConnected) {
        const protocolLabel: Record<string, string> = {
          spdy3: 'SPDY/3',
          http2: 'HTTP/2',
          http1: 'HTTP/1.x',
          'tls-alert': 'TLS Alert',
          unknown: 'Unknown',
        };

        let output = `SPDY Probe — ${host}:${port}\n\n`;
        output += `TLS Connected: ${data.tlsConnected ? 'Yes' : 'No'}\n`;
        output += `SPDY Detected: ${data.spdyDetected ? 'Yes ✓' : 'No'}\n`;
        if (data.protocol) output += `Detected Protocol: ${protocolLabel[data.protocol] ?? data.protocol}\n`;
        output += `\nResponse: ${data.message}\n`;
        if (data.note) output += `\nNote: ${data.note}`;
        setResult(output);
      } else {
        setError(data.error || data.message || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="SPDY Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <div className="mb-4 p-3 bg-orange-900/30 border border-orange-700/50 rounded-lg">
          <p className="text-xs text-orange-300">
            <strong>Deprecated Protocol:</strong> SPDY was discontinued in 2016 and superseded
            by HTTP/2. Most servers no longer support it. This probe establishes a TLS connection
            and sends a SPDY/3 SETTINGS frame to detect server support.
          </p>
        </div>

        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="spdy-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="www.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="spdy-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 443 (HTTPS/SPDY)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe SPDY server"
        >
          Probe Server
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SPDY"
          description="SPDY (pronounced 'speedy') was a Google-developed experimental protocol (2009–2015) that introduced request multiplexing, header compression, and server push over TLS. These concepts were standardized in HTTP/2 (RFC 7540) in 2015. Chrome removed SPDY support in May 2016. Today, virtually all traffic that would have used SPDY uses HTTP/2 or HTTP/3 instead. SPDY used ALPN negotiation with the token 'spdy/3.1' during TLS handshake."
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">SPDY Timeline</h3>
          <div className="text-xs text-slate-400 space-y-1">
            <div><span className="text-slate-500">2009</span> — Google announces SPDY internally</div>
            <div><span className="text-slate-500">2012</span> — SPDY/3 deployed in Chrome and major Google services</div>
            <div><span className="text-slate-500">2015</span> — HTTP/2 (RFC 7540) standardized, based on SPDY</div>
            <div><span className="text-slate-500">2016</span> — Chrome removes SPDY support</div>
            <div><span className="text-slate-500">2016+</span> — All SPDY traffic migrated to HTTP/2 or HTTP/3</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
