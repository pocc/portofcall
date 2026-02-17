import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface ActiveUsersClientProps {
  onBack: () => void;
}

export default function ActiveUsersClient({ onBack }: ActiveUsersClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('11');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleTest = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/activeusers/test', {
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
        response?: string;
        userCount?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const userCountDisplay = data.userCount !== undefined
          ? `👤 ${data.userCount} active ${data.userCount === 1 ? 'user' : 'users'}\n\n`
          : '';

        setResult(
          `✅ Active Users Query Successful\n\n` +
          userCountDisplay +
          `Server Response:\n"${data.response}"\n\n` +
          `Response Time: ${data.rtt}ms`
        );
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleTest();
    }
  };

  return (
    <ProtocolClientLayout title="Active Users Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="activeusers-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="example.com"
            required
            error={errors.host}
          />

          <FormField
            id="activeusers-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 11 (standard Active Users port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleTest}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Query active users"
        >
          Query Active Users
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Active Users Protocol"
          description="Active Users (RFC 866) is a simple protocol from 1983 that returns the number of users currently logged into a system. The server immediately responds with a single line containing the user count and closes the connection. Standard port is 11."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Protocol Notes</h3>
          <div className="text-sm text-slate-400 space-y-2">
            <p>
              ⚠️ <strong>Availability:</strong> This protocol is largely obsolete. Most modern systems do not run
              this service for security reasons. It was common on Unix systems in the 1980s-90s.
            </p>
            <p>
              📖 <strong>Response Format:</strong> The server response format varies by implementation.
              It may be a simple number ("42"), a sentence ("There are 42 users"), or other text
              containing the user count.
            </p>
            <p>
              🔒 <strong>Security:</strong> Many administrators disable this service as it reveals
              information about system usage that could be useful to attackers.
            </p>
            <p>
              📚 <strong>Historical Significance:</strong> Despite being obsolete, Active Users remains
              an official Internet Standard (IS) and serves as an example of early network services.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
