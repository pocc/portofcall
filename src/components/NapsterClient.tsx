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

interface NapsterClientProps {
  onBack: () => void;
}

export default function NapsterClient({ onBack }: NapsterClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6699');
  const [username, setUsername] = useState('');
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
      const endpoint = username && password ? '/api/napster/login' : '/api/napster/connect';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username: username || undefined,
          password: password || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        motd?: string;
        serverVersion?: string;
        users?: number;
        files?: number;
        gigabytes?: number;
        rtt?: number;
      };

      if (data.success) {
        let msg = `Connected to Napster server at ${host}:${port}\n`;
        if (data.message) msg += `Message: ${data.message}\n`;
        if (data.motd) msg += `MOTD: ${data.motd}\n`;
        if (data.serverVersion) msg += `Server: ${data.serverVersion}\n`;
        if (data.users !== undefined) msg += `Users: ${data.users.toLocaleString()}\n`;
        if (data.files !== undefined) msg += `Files: ${data.files.toLocaleString()}\n`;
        if (data.gigabytes !== undefined) msg += `Data: ${data.gigabytes} GB\n`;
        if (data.rtt !== undefined) msg += `RTT: ${data.rtt}ms`;
        setResult(msg);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleStats = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/napster/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 15000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        users?: number;
        files?: number;
        gigabytes?: number;
        rtt?: number;
      };

      if (data.success) {
        let msg = `Stats from Napster server at ${host}:${port}\n`;
        if (data.message) msg += `Message: ${data.message}\n`;
        if (data.users !== undefined) msg += `Users: ${data.users.toLocaleString()}\n`;
        if (data.files !== undefined) msg += `Files: ${data.files.toLocaleString()}\n`;
        if (data.gigabytes !== undefined) msg += `Data: ${data.gigabytes} GB\n`;
        if (data.rtt !== undefined) msg += `RTT: ${data.rtt}ms`;
        setResult(msg);
      } else {
        setError(data.error || 'Stats request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stats request failed');
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
    <ProtocolClientLayout title="Napster Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Napster || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="napster-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="napster.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="napster-port"
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
            id="napster-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="user123"
            optional
          />

          <FormField
            id="napster-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="password"
            optional
          />
        </div>

        <div className="flex gap-3 mb-4">
          <ActionButton
            onClick={handleConnect}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Connect to Napster server"
          >
            {username && password ? 'Login' : 'Connect'}
          </ActionButton>

          <ActionButton
            onClick={handleStats}
            disabled={loading || !host || !port}
            loading={loading}
            variant="secondary"
            ariaLabel="Get server stats"
          >
            Get Stats
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Napster"
          description="Napster was a pioneering P2P file sharing service (1999-2001). The protocol lives on in OpenNap servers. Connect without credentials to test TCP connectivity, or provide a username/password to attempt login. Port 6699 is the default."
        />
      </div>
    </ProtocolClientLayout>
  );
}
