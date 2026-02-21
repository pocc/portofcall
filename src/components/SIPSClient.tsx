import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SIPSClientProps {
  onBack: () => void;
}

export default function SIPSClient({ onBack }: SIPSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5061');
  const [domain, setDomain] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleOptions = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/sips/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          domain: domain || host,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        statusText?: string;
        server?: string;
        allow?: string;
        supported?: string;
        contact?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const lines = [
          `SIPS OPTIONS — ${host}:${port}`,
          '',
          `Status: ${data.statusCode} ${data.statusText}`,
          `RTT:    ${data.rtt}ms`,
        ];
        if (data.server) lines.push(`Server: ${data.server}`);
        if (data.allow) lines.push(`Allow:  ${data.allow}`);
        if (data.supported) lines.push(`Supported: ${data.supported}`);
        if (data.contact) lines.push(`Contact: ${data.contact}`);
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'OPTIONS failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/sips/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          domain: domain || host,
          username: username || 'probe',
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        statusText?: string;
        authRequired?: boolean;
        server?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `SIPS REGISTER — ${host}:${port}\n\n` +
          `Status: ${data.statusCode} ${data.statusText}\n` +
          `RTT:    ${data.rtt}ms\n` +
          (data.authRequired ? 'Auth:   Required (401 Unauthorized)\n' : '') +
          (data.server ? `Server: ${data.server}\n` : '')
        );
      } else {
        setError(data.error || 'REGISTER failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleOptions();
    }
  };

  return (
    <ProtocolClientLayout title="SIPS Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="SIP Server (TLS)" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="sips-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="sip.example.com"
            required
            error={errors.host}
          />
          <FormField
            id="sips-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5061 (SIPS / SIP over TLS)"
            error={errors.port}
          />
          <FormField
            id="sips-domain"
            label="SIP Domain"
            type="text"
            value={domain}
            onChange={setDomain}
            onKeyDown={handleKeyDown}
            placeholder={host || 'example.com'}
            helpText="SIP domain (defaults to host if empty)"
          />
          <FormField
            id="sips-username"
            label="Username (for REGISTER)"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="alice"
            helpText="SIP user for REGISTER probe"
          />
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handleOptions}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Send SIPS OPTIONS request"
          >
            OPTIONS (Probe)
          </ActionButton>
          <button
            onClick={handleRegister}
            disabled={loading || !host || !port}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            REGISTER (Auth Probe)
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SIPS (SIP over TLS — RFC 3261)"
          description="SIPS is SIP (Session Initiation Protocol) transported over TLS on port 5061, providing privacy and integrity for VoIP signaling. OPTIONS is used to probe server capabilities (allowed methods, supported extensions). REGISTER registers a UA with its home server. A 401 Unauthorized response to REGISTER indicates the server is active and requires authentication."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">SIP vs SIPS</h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><strong className="text-slate-300">SIP (port 5060):</strong> Plain-text signaling — headers and SDPs visible in transit</p>
            <p><strong className="text-slate-300">SIPS (port 5061):</strong> TLS-encrypted — signaling headers and body are encrypted</p>
            <p><strong className="text-slate-300">Note:</strong> Media (RTP/SRTP) is negotiated separately regardless of signaling security</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
