import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SIPClientProps {
  onBack: () => void;
}

interface SipHeader {
  name: string;
  value: string;
}

export default function SIPClient({ onBack }: SIPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5060');
  const [uri, setUri] = useState('');
  const [username, setUsername] = useState('probe');
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required'), validationRules.hostname()],
    port: [validationRules.port()],
  });

  const handleOptions = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/sip/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          uri: uri || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        server?: string;
        statusCode?: number;
        statusText?: string;
        allowedMethods?: string[];
        supportedExtensions?: string[];
        serverAgent?: string;
        contentTypes?: string[];
        headers?: SipHeader[];
        raw?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `SIP OPTIONS Probe`,
          `Server: ${data.server}`,
          `${'='.repeat(60)}`,
          `Response: ${data.statusCode} ${data.statusText}`,
          '',
        ];

        if (data.serverAgent) {
          lines.push(`Server Agent: ${data.serverAgent}`);
        }
        if (data.allowedMethods && data.allowedMethods.length > 0) {
          lines.push(`Allowed Methods: ${data.allowedMethods.join(', ')}`);
        }
        if (data.supportedExtensions && data.supportedExtensions.length > 0) {
          lines.push(`Supported Extensions: ${data.supportedExtensions.join(', ')}`);
        }
        if (data.contentTypes && data.contentTypes.length > 0) {
          lines.push(`Accept: ${data.contentTypes.join(', ')}`);
        }

        if (data.headers && data.headers.length > 0) {
          lines.push('', '--- Response Headers ---');
          for (const h of data.headers) {
            lines.push(`  ${h.name}: ${h.value}`);
          }
        }

        if (data.raw) {
          lines.push('', '--- Raw Response ---', data.raw);
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'SIP OPTIONS probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SIP OPTIONS probe failed');
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
      const response = await fetch('/api/sip/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          uri: uri || undefined,
          username: username || 'probe',
          domain: domain || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        server?: string;
        statusCode?: number;
        statusText?: string;
        requiresAuth?: boolean;
        authScheme?: string;
        authRealm?: string;
        serverAgent?: string;
        contactExpires?: number;
        headers?: SipHeader[];
        raw?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `SIP REGISTER Probe`,
          `Server: ${data.server}`,
          `${'='.repeat(60)}`,
          `Response: ${data.statusCode} ${data.statusText}`,
          '',
        ];

        if (data.serverAgent) {
          lines.push(`Server Agent: ${data.serverAgent}`);
        }

        lines.push(`Requires Authentication: ${data.requiresAuth ? 'YES' : 'NO'}`);

        if (data.requiresAuth) {
          if (data.authScheme) lines.push(`Auth Scheme: ${data.authScheme}`);
          if (data.authRealm) lines.push(`Auth Realm: ${data.authRealm}`);
        }

        if (data.contactExpires !== undefined) {
          lines.push(`Contact Expires: ${data.contactExpires}s`);
        }

        if (data.headers && data.headers.length > 0) {
          lines.push('', '--- Response Headers ---');
          for (const h of data.headers) {
            lines.push(`  ${h.name}: ${h.value}`);
          }
        }

        if (data.raw) {
          lines.push('', '--- Raw Response ---', data.raw);
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'SIP REGISTER probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SIP REGISTER probe failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleOptions();
    }
  };

  return (
    <ProtocolClientLayout title="SIP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="SIP Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="sip-host"
            label="SIP Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="sip.example.com"
            required
            helpText="SIP server hostname or IP address"
            error={errors.host}
          />

          <FormField
            id="sip-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5060 (standard SIP over TCP)"
            error={errors.port}
          />

          <FormField
            id="sip-uri"
            label="SIP URI"
            type="text"
            value={uri}
            onChange={setUri}
            onKeyDown={handleKeyDown}
            placeholder="sip:host (auto-generated)"
            optional
            helpText="Override Request-URI (auto-generated from host if empty)"
          />

          <FormField
            id="sip-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="probe"
            optional
            helpText="SIP username for REGISTER probe"
          />

          <FormField
            id="sip-domain"
            label="SIP Domain"
            type="text"
            value={domain}
            onChange={setDomain}
            onKeyDown={handleKeyDown}
            placeholder="(same as host)"
            optional
            helpText="SIP domain / realm (defaults to host)"
          />
        </div>

        <SectionHeader stepNumber={2} title="Probe" color="green" />

        <div className="grid md:grid-cols-2 gap-3 mb-2">
          <ActionButton
            onClick={handleOptions}
            disabled={loading || !host}
            loading={loading}
            ariaLabel="Send SIP OPTIONS probe"
          >
            OPTIONS Probe
          </ActionButton>

          <ActionButton
            onClick={handleRegister}
            disabled={loading || !host}
            loading={loading}
            variant="secondary"
            ariaLabel="Send SIP REGISTER probe"
          >
            REGISTER Probe
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SIP Protocol"
          description="SIP (RFC 3261) is the signaling protocol for VoIP, video calls, and multimedia sessions. It uses an HTTP-like text format over TCP (port 5060) or UDP. OPTIONS probes discover server capabilities and supported methods. REGISTER probes test authentication requirements. SIP is used by virtually all modern telephony: Twilio, Asterisk, FreeSWITCH, Ooma, Vonage, and every mobile carrier's VoLTE."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">SIP Methods Reference</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              { method: 'OPTIONS', desc: 'Query capabilities' },
              { method: 'REGISTER', desc: 'Register SIP URI' },
              { method: 'INVITE', desc: 'Start a session' },
              { method: 'ACK', desc: 'Confirm INVITE' },
              { method: 'BYE', desc: 'End a session' },
              { method: 'CANCEL', desc: 'Cancel pending request' },
              { method: 'SUBSCRIBE', desc: 'Request notifications' },
              { method: 'NOTIFY', desc: 'Send notification' },
              { method: 'MESSAGE', desc: 'Instant message' },
            ].map(({ method, desc }) => (
              <div
                key={method}
                className="text-sm bg-slate-700 text-slate-300 py-2 px-3 rounded"
              >
                <span className="font-mono text-blue-400">{method}</span>
                <span className="block text-xs text-slate-400">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
