import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface CVSClientProps {
  onBack: () => void;
}

export default function CVSClient({ onBack }: CVSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2401');
  const [repository, setRepository] = useState('/cvs');
  const [username, setUsername] = useState('anonymous');
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
      const response = await fetch('/api/cvs/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        greeting?: string;
        lines?: string[];
        message?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `✅ Successfully connected to CVS pserver\n\n`;
        if (data.message) resultText += `${data.message}\n\n`;
        if (data.greeting) {
          resultText += `Server Greeting:\n`;
          resultText += `${'-'.repeat(40)}\n`;
          resultText += `${data.greeting}\n`;
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

  const handleLogin = async () => {
    if (!repository || !username || !password) {
      setError('Repository, username, and password are required for login');
      return;
    }

    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/cvs/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          repository,
          username,
          password,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        authenticated?: boolean;
        error?: string;
        message?: string;
        response?: string;
        lines?: string[];
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = '';
        if (data.authenticated) {
          resultText += `✅ Authentication Successful!\n\n`;
          resultText += `Repository: ${repository}\n`;
          resultText += `Username:   ${username}\n\n`;
          resultText += `Server Response: "I LOVE YOU"\n`;
        } else {
          resultText += `❌ Authentication Failed\n\n`;
          resultText += `Repository: ${repository}\n`;
          resultText += `Username:   ${username}\n\n`;
          resultText += `Server Response: "I HATE YOU"\n`;
        }
        if (data.response) {
          resultText += `\nFull Response:\n${'-'.repeat(40)}\n${data.response}\n`;
        }
        setResult(resultText);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
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
    <ProtocolClientLayout title="CVS pserver Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="cvs-host"
            label="CVS Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="cvs.example.com"
            error={errors.host}
          />
          <FormField
            id="cvs-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            placeholder="2401"
            error={errors.port}
          />
        </div>

        <ActionButton onClick={handleConnect} loading={loading} disabled={loading || !host || !port}>
          🔌 Connect & Probe
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={2} title="Repository & Authentication" />

        <div className="grid gap-4 mb-4">
          <FormField
            id="cvs-repository"
            label="Repository Path"
            type="text"
            value={repository}
            onChange={setRepository}
            placeholder="/cvs"
          />
          <div className="grid md:grid-cols-2 gap-4">
            <FormField
              id="cvs-username"
              label="Username"
              type="text"
              value={username}
              onChange={setUsername}
              placeholder="anonymous"
            />
            <FormField
              id="cvs-password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="Enter password"
            />
          </div>
        </div>

        <ActionButton onClick={handleLogin} loading={loading} disabled={loading || !host || !port || !repository || !username || !password}>
          🔐 Login Test
        </ActionButton>
      </div>

      <ResultDisplay result={result} error={error} />

      <HelpSection
        title="About CVS pserver"
        description="CVS (Concurrent Versions System) pserver is a legacy version control protocol from the 1990s. It uses a text-based protocol with password authentication. CVS servers respond with 'I LOVE YOU' on successful authentication and 'I HATE YOU' on failure. Passwords are 'scrambled' using a simple substitution cipher that provides no real security."
        showKeyboardShortcut={true}
      />
    </ProtocolClientLayout>
  );
}
