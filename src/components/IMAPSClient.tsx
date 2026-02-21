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

interface IMAPSClientProps {
  onBack: () => void;
}

export default function IMAPSClient({ onBack }: IMAPSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('993');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mailbox, setMailbox] = useState('INBOX');
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
      const response = await fetch('/api/imaps/connect', {
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
        greeting?: string;
        capabilities?: string;
        authenticated?: boolean;
        tls?: boolean;
        rtt?: number;
        note?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `IMAPS Connection ${data.tls ? '(TLS)' : ''} Successful`,
          '',
          `Greeting:       ${data.greeting || 'N/A'}`,
          `Authenticated:  ${data.authenticated ? 'Yes' : 'No'}`,
          `RTT:            ${data.rtt}ms`,
        ];

        if (data.capabilities) {
          lines.push('', 'Capabilities:');
          const caps = data.capabilities.split(' ');
          for (const cap of caps) {
            lines.push(`  ${cap}`);
          }
        }

        lines.push('');
        if (data.note) lines.push(data.note);

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

  const handleList = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!username || !password) {
      setError('Username and password are required to list mailboxes');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/imaps/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username,
          password,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        mailboxes?: string[];
        count?: number;
      };

      if (response.ok && data.success) {
        const lines = [
          `IMAPS Mailbox List (${data.count || 0} found)`,
          '',
        ];

        if (data.mailboxes?.length) {
          for (const mb of data.mailboxes) {
            lines.push(`  ${mb}`);
          }
        } else {
          lines.push('  (no mailboxes found)');
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to list mailboxes');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list mailboxes');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!username || !password) {
      setError('Username and password are required to select a mailbox');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/imaps/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username,
          password,
          mailbox,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        mailbox?: string;
        exists?: number;
        recent?: number;
        message?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `IMAPS SELECT "${data.mailbox}"`,
          '',
          `Total Messages: ${data.exists || 0}`,
          `Recent:         ${data.recent || 0}`,
        ];

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to select mailbox');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select mailbox');
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
    <ProtocolClientLayout title="IMAPS Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.IMAPS || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="IMAPS Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="imaps-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="imap.gmail.com"
            required
            error={errors.host}
          />

          <FormField
            id="imaps-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 993 (IMAP over TLS)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Credentials (Optional)" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="imaps-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="user@example.com"
            helpText="Required for login, list, and select"
          />

          <FormField
            id="imaps-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="password"
            helpText="Sent via IMAP LOGIN command over TLS"
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test IMAPS connection"
        >
          Test Connection
        </ActionButton>

        <div className="mt-8 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={3} title="Mailbox Operations" />

          <div className="mb-4">
            <FormField
              id="imaps-mailbox"
              label="Mailbox Name"
              type="text"
              value={mailbox}
              onChange={setMailbox}
              placeholder="INBOX"
              helpText="Mailbox to SELECT (e.g., INBOX, Sent, Drafts)"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleList}
              disabled={loading || !host || !port || !username || !password}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              List Mailboxes
            </button>

            <button
              onClick={handleSelect}
              disabled={loading || !host || !port || !username || !password}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Select Mailbox
            </button>
          </div>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About IMAPS (IMAP over TLS)"
          description="IMAPS (RFC 8314) wraps IMAP4rev1 in TLS from the first byte, unlike STARTTLS which upgrades a plaintext connection. Port 993 is the standard IMAPS port. All major email providers (Gmail, Outlook, Yahoo, iCloud) support IMAPS. The TLS layer provides confidentiality and integrity for credentials and email data."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">IMAP vs IMAPS</h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><strong className="text-slate-300">IMAP (Port 143):</strong> Plaintext connection, optionally upgraded via STARTTLS</p>
            <p><strong className="text-slate-300">IMAPS (Port 993):</strong> TLS from connection start, recommended by RFC 8314</p>
            <p><strong className="text-slate-300">POP3S (Port 995):</strong> POP3 over TLS, simpler download-only model</p>
            <p><strong className="text-slate-300">SMTPS (Port 465):</strong> SMTP submission over TLS</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
