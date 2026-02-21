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

interface RadsecClientProps {
  onBack: () => void;
}

export default function RadsecClient({ onBack }: RadsecClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2083');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nasIdentifier, setNasIdentifier] = useState('portofcall');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    username: [validationRules.required('Username is required')],
  });

  const handleAuth = async () => {
    const isValid = validateAll({ host, port, username });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/radsec/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username,
          password,
          nasIdentifier,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        authenticated?: boolean;
        responseCode?: number;
        responseMessage?: string;
        attributes?: Record<string, string>;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const lines = [
          `RadSec Authentication — ${host}:${port}`,
          '',
          `Result:  ${data.authenticated ? 'Access-Accept' : 'Access-Reject'}`,
          `Code:    ${data.responseCode}`,
          `RTT:     ${data.rtt}ms`,
        ];
        if (data.responseMessage) lines.push(`Message: ${data.responseMessage}`);
        if (data.attributes && Object.keys(data.attributes).length > 0) {
          lines.push('', 'Attributes:');
          Object.entries(data.attributes).forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
        }
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Authentication failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port && username) {
      handleAuth();
    }
  };

  return (
    <ProtocolClientLayout title="RadSec Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Radsec || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="RadSec Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="radsec-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="radius.example.com"
            required
            error={errors.host}
          />
          <FormField
            id="radsec-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2083 (RadSec / RADIUS over TLS)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Credentials" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="radsec-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="user@example.com"
            required
            error={errors.username}
          />
          <FormField
            id="radsec-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="(encrypted via TLS)"
          />
        </div>

        <div className="mb-6">
          <FormField
            id="radsec-nas"
            label="NAS Identifier"
            type="text"
            value={nasIdentifier}
            onChange={setNasIdentifier}
            onKeyDown={handleKeyDown}
            placeholder="portofcall"
            helpText="Network Access Server identifier sent in the RADIUS request"
          />
        </div>

        <ActionButton
          onClick={handleAuth}
          disabled={loading || !host || !port || !username}
          loading={loading}
          ariaLabel="Send RadSec authentication request"
        >
          Authenticate
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About RadSec (RADIUS over TLS — RFC 6614)"
          description="RadSec transports standard RADIUS packets (RFC 2865) over a TLS connection, eliminating the need for shared secrets and providing strong encryption for AAA traffic. It is widely used for WPA2-Enterprise (eduroam), 802.1X port-based access control, and VPN authentication. The RADIUS packet format (code, identifier, length, authenticator, attributes) is unchanged — only the transport layer is secured by TLS."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">RADIUS vs RadSec</h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><strong className="text-slate-300">RADIUS (port 1812):</strong> UDP transport, MD5-protected passwords, shared secret required</p>
            <p><strong className="text-slate-300">RadSec (port 2083):</strong> TLS transport, fully encrypted, no shared secret, mutual cert auth</p>
            <p><strong className="text-slate-300">Use cases:</strong> eduroam (university Wi-Fi), WPA2-Enterprise, 802.1X, enterprise VPNs</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
