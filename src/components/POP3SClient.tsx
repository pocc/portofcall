import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface POP3SClientProps {
  onBack: () => void;
}

export default function POP3SClient({ onBack }: POP3SClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('995');
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
      const response = await fetch('/api/pop3s/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username: username || undefined,
          password: password || undefined,
          timeout: 30000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        greeting?: string;
        authenticated?: boolean;
        messageCount?: number;
        mailboxSize?: number;
        tls?: boolean;
        note?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `POP3S Server Info\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `TLS: ${data.tls ? 'Yes (implicit)' : 'No'}\n`;
        resultText += `Greeting: ${data.greeting}\n`;
        resultText += `Authenticated: ${data.authenticated ? 'Yes' : 'No'}\n`;
        if (data.messageCount !== null && data.messageCount !== undefined) {
          resultText += `\nMailbox:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += `  Messages: ${data.messageCount}\n`;
          resultText += `  Size:     ${data.mailboxSize} bytes\n`;
        }
        if (data.note) {
          resultText += `\n${data.note}\n`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleList = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!username || !password) {
      setError('Username and password are required to list messages');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/pop3s/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username,
          password,
          timeout: 30000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        messages?: Array<{ id: number; size: number }>;
        totalMessages?: number;
        totalSize?: number;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `POP3S Message List\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Total: ${data.totalMessages} message(s), ${data.totalSize} bytes\n\n`;

        if (data.messages && data.messages.length > 0) {
          resultText += `  ${'ID'.padEnd(8)} Size (bytes)\n`;
          resultText += `  ${''.padEnd(8, '-')} ${''.padEnd(12, '-')}\n`;
          for (const msg of data.messages) {
            resultText += `  ${String(msg.id).padEnd(8)} ${msg.size}\n`;
          }
        } else {
          resultText += `(no messages)\n`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'List failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'List failed');
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
    <ProtocolClientLayout title="POP3S Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="pop3s-host"
            label="POP3S Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="pop.gmail.com"
            required
            helpText="Hostname of the POP3S mail server"
            error={errors.host}
          />

          <FormField
            id="pop3s-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 995"
            error={errors.port}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="pop3s-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="user@example.com"
            helpText="Optional — needed for auth and listing"
          />

          <FormField
            id="pop3s-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="Password"
            helpText="Optional — sent encrypted over TLS"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <ActionButton
            onClick={handleConnect}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Test POP3S connection over TLS"
          >
            Connect
          </ActionButton>

          <button
            onClick={handleList}
            disabled={loading || !host || !port || !username || !password}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="List messages via POP3S"
          >
            {loading ? 'Loading...' : 'List Messages'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About POP3S"
          description="POP3S (POP3 over TLS) provides encrypted access to email mailboxes on port 995. Unlike STARTTLS which upgrades a plain connection, POP3S uses implicit TLS — the entire session is encrypted from the start. Common POP3S servers include pop.gmail.com:995, outlook.office365.com:995, and pop.mail.yahoo.com:995."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
