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

interface FingerClientProps {
  onBack: () => void;
}

export default function FingerClient({ onBack }: FingerClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('79');
  const [username, setUsername] = useState('');
  const [remoteHost, setRemoteHost] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleQuery = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/finger/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username: username || undefined,
          remoteHost: remoteHost || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        query?: string;
        response?: string;
      };

      if (response.ok && data.success) {
        let resultText = `📝 Query: ${data.query || '(empty)'}\n`;
        resultText += `${'='.repeat(60)}\n\n`;
        resultText += data.response || '(No information available)';

        setResult(resultText);
      } else {
        setError(data.error || 'Finger query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finger query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleQuery();
    }
  };

  const handleExampleQuery = (exampleHost: string, exampleUser?: string, exampleRemote?: string) => {
    setHost(exampleHost);
    setUsername(exampleUser || '');
    setRemoteHost(exampleRemote || '');
  };

  return (
    <ProtocolClientLayout title="Finger Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Finger || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Finger Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="finger-host"
            label="Finger Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="finger.example.com"
            required
            helpText="Server running Finger daemon on port 79"
            error={errors.host}
          />

          <FormField
            id="finger-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 79 (standard Finger port)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Query Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="finger-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="(optional - leave empty for all users)"
            optional
            helpText="Username to query (empty = list all users)"
          />

          <FormField
            id="finger-remote"
            label="Remote Host"
            type="text"
            value={remoteHost}
            onChange={setRemoteHost}
            onKeyDown={handleKeyDown}
            placeholder="(optional)"
            optional
            helpText="Remote hostname for forwarding query"
          />
        </div>

        <div className="mb-6 bg-slate-700 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Query Preview</h3>
          <div className="font-mono text-xs text-blue-400">
            {username || '(all users)'}
            {remoteHost && `@${remoteHost}`}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Empty username lists all logged-in users. Add @remote_host to forward the query.
          </p>
        </div>

        <ActionButton
          onClick={handleQuery}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Perform Finger query"
        >
          Finger Query
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Finger Protocol"
          description="Finger (RFC 1288, 1977) is a legacy protocol for user information lookup. Queries user details like login name, full name, last login time, and plan. Most modern systems have disabled Finger for security reasons. Educational use only."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Queries</h3>
          <div className="grid gap-2">
            <button
              onClick={() => handleExampleQuery('localhost')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">finger @localhost</span>
              <span className="ml-2 text-slate-400">- List all users on localhost</span>
            </button>
            <button
              onClick={() => handleExampleQuery('localhost', 'root')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">finger root@localhost</span>
              <span className="ml-2 text-slate-400">- Get info for user "root"</span>
            </button>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">⚠️ Security Warning</h3>
          <div className="bg-red-900/20 border border-red-600/30 rounded-lg p-3">
            <p className="text-xs text-red-200 mb-2">
              <strong>Finger exposes user information</strong> and is considered a security risk.
              Most modern systems have Finger disabled by default.
            </p>
            <ul className="text-xs text-red-200 list-disc list-inside space-y-1">
              <li>Reveals usernames, login times, directories</li>
              <li>Can be used for enumeration attacks</li>
              <li>No authentication or encryption</li>
              <li>Replaced by directory services (LDAP, Active Directory)</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Example Response</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs">
            <div className="text-slate-400 mb-2">Typical Finger response:</div>
            <pre className="text-slate-200 whitespace-pre-wrap">
{`Login: alice        Name: Alice Smith
Directory: /home/alice      Shell: /bin/bash
Last login Fri Jan 15 10:23 from client.example.com
No mail.
No Plan.`}
            </pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Historical Context</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p>
              📜 <strong>1977:</strong> Finger protocol created (RFC 742)
            </p>
            <p>
              🌐 <strong>1988:</strong> Standardized as RFC 1288
            </p>
            <p>
              🐛 <strong>1988:</strong> Morris Worm exploited Finger vulnerability
            </p>
            <p>
              🔒 <strong>1990s-2000s:</strong> Gradually disabled for security reasons
            </p>
            <p>
              📚 <strong>Today:</strong> Educational value, Internet archaeology
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
