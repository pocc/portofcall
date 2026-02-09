import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface LDAPClientProps {
  onBack: () => void;
}

export default function LDAPClient({ onBack }: LDAPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('389');
  const [bindDN, setBindDN] = useState('');
  const [password, setPassword] = useState('');
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
      const response = await fetch('/api/ldap/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          bindDN: bindDN || undefined,
          password: password || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        bindDN?: string;
        resultCode?: number;
        serverResponse?: string;
      };

      if (data.success) {
        setResult(`Connected to LDAP server at ${host}:${port}\n\nBind DN: ${data.bindDN || '(anonymous)'}\nServer Response: ${data.serverResponse || 'N/A'}\n\n${data.message || ''}`);
      } else {
        setError(data.error || data.serverResponse || 'Connection failed');
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
    <ProtocolClientLayout title="LDAP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ldap-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="ldap.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="ldap-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 389 (LDAP), 636 (LDAPS)"
            error={errors.port}
          />

          <div className="md:col-span-2">
            <FormField
              id="ldap-bindDN"
              label="Bind DN"
              type="text"
              value={bindDN}
              onChange={setBindDN}
              onKeyDown={handleKeyDown}
              placeholder="cn=admin,dc=example,dc=com"
              optional
              helpText="Distinguished Name for authentication (e.g., cn=user,ou=people,dc=example,dc=com). Leave empty for anonymous bind."
            />
          </div>

          <div className="md:col-span-2">
            <FormField
              id="ldap-password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              onKeyDown={handleKeyDown}
              placeholder="password"
              optional
            />
          </div>
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test LDAP connection"
        >
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About LDAP"
          description="LDAP (Lightweight Directory Access Protocol) is a protocol for accessing and maintaining distributed directory information services. This interface tests connectivity by sending a BIND request. Port 389 is the default for unencrypted LDAP, while 636 is used for LDAPS (LDAP over TLS/SSL). Leave Bind DN empty for anonymous bind, or provide credentials for authenticated access."
        />
      </div>
    </ProtocolClientLayout>
  );
}
