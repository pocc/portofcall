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

interface ManageSieveClientProps {
  onBack: () => void;
}

interface Capability {
  key: string;
  value: string;
}

interface Script {
  name: string;
  active: boolean;
}

export default function ManageSieveClient({ onBack }: ManageSieveClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4190');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [connected, setConnected] = useState(false);

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
    setCapabilities([]);

    try {
      const response = await fetch('/api/managesieve/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        capabilities?: Capability[];
        sieveExtensions?: string;
        implementation?: string;
        saslMethods?: string;
        starttls?: boolean;
        banner?: string;
        error?: string;
      };

      if (response.ok && data.success) {
        setConnected(true);
        setCapabilities(data.capabilities || []);

        const lines = [
          `Connected to ${host}:${port}`,
          '',
          `Implementation: ${data.implementation || 'Unknown'}`,
          `Sieve Extensions: ${data.sieveExtensions || 'None'}`,
          `SASL Methods: ${data.saslMethods || 'None'}`,
          `STARTTLS: ${data.starttls ? 'Supported' : 'Not advertised'}`,
          '',
          'Raw Banner:',
          data.banner || '(empty)',
        ];
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleListScripts = async () => {
    if (!username || !password) {
      setError('Username and password are required to list scripts');
      return;
    }

    setLoading(true);
    setError('');
    setScripts([]);

    try {
      const response = await fetch('/api/managesieve/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username,
          password,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        authenticated?: boolean;
        scripts?: Script[];
        error?: string;
      };

      if (response.ok && data.success) {
        setScripts(data.scripts || []);
        if (data.scripts && data.scripts.length > 0) {
          const lines = [
            '',
            '--- Sieve Scripts ---',
            ...data.scripts.map((s) =>
              `  ${s.active ? '[ACTIVE] ' : '         '}${s.name}`
            ),
          ];
          setResult((prev) => prev + '\n' + lines.join('\n'));
        } else {
          setResult((prev) => prev + '\n\nNo Sieve scripts found on server.');
        }
      } else {
        setError(data.error || 'Failed to list scripts');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list scripts');
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
    <ProtocolClientLayout title="ManageSieve Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.ManageSieve || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="sieve-host"
            label="Mail Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="mail.example.com"
            required
            helpText="Mail server with ManageSieve enabled"
            error={errors.host}
          />

          <FormField
            id="sieve-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 4190"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect and read capabilities"
        >
          Probe Capabilities
        </ActionButton>

        {connected && (
          <>
            <SectionHeader stepNumber={2} title="Authentication & Scripts" color="green" />

            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <FormField
                id="sieve-username"
                label="Username"
                type="text"
                value={username}
                onChange={setUsername}
                placeholder="user@example.com"
                helpText="SASL PLAIN username"
              />

              <FormField
                id="sieve-password"
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="Enter password"
                helpText="SASL PLAIN password"
              />
            </div>

            <ActionButton
              onClick={handleListScripts}
              disabled={loading || !username || !password}
              loading={loading}
              variant="success"
              ariaLabel="Authenticate and list Sieve scripts"
            >
              List Scripts
            </ActionButton>

            {scripts.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-slate-300 mb-2">Sieve Scripts</h3>
                <div className="bg-slate-700 rounded-lg p-3 space-y-1">
                  {scripts.map((script) => (
                    <div key={script.name} className="flex items-center gap-2">
                      {script.active && (
                        <span className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded">ACTIVE</span>
                      )}
                      <span className="text-sm font-mono text-slate-200">{script.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {capabilities.length > 0 && (
          <div className="mt-6 pt-6 border-t border-slate-600">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Server Capabilities</h3>
            <div className="bg-slate-700 rounded-lg p-3 space-y-1">
              {capabilities.map((cap, i) => (
                <div key={i} className="text-xs font-mono">
                  <span className="text-blue-400">{cap.key}</span>
                  {cap.value && <span className="text-slate-300"> = {cap.value}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About ManageSieve"
          description="ManageSieve (RFC 5804) is a protocol for managing Sieve email filtering scripts on mail servers like Dovecot and Cyrus IMAP. It allows remote management of server-side mail filtering rules on port 4190. It uses SASL PLAIN authentication and supports STARTTLS."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 4190 (IANA assigned)</p>
            <p><strong className="text-slate-300">Transport:</strong> TCP (text-based)</p>
            <p><strong className="text-slate-300">Auth:</strong> SASL PLAIN/LOGIN (STARTTLS recommended)</p>
            <p><strong className="text-slate-300">Commands:</strong> AUTHENTICATE, LISTSCRIPTS, GETSCRIPT, PUTSCRIPT, SETACTIVE, CAPABILITY, LOGOUT</p>
            <p><strong className="text-slate-300">RFC:</strong> 5804 (ManageSieve), 5228 (Sieve language)</p>
            <p><strong className="text-slate-300">Servers:</strong> Dovecot Pigeonhole, Cyrus IMAP, Zimbra</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
