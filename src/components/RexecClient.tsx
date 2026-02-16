import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface RexecClientProps {
  onBack: () => void;
}

export default function RexecClient({ onBack }: RexecClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('512');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [command, setCommand] = useState('id');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleExecute = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/rexec/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username: username || 'guest',
          password,
          command: command || 'id',
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        serverAccepted?: boolean;
        username?: string;
        command?: string;
        output?: string;
        serverMessage?: string;
        rtt?: number;
        note?: string;
        security?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `Rexec ${data.serverAccepted ? 'Command Accepted' : 'Rejected'}`,
          '',
          `User:    ${data.username}`,
          `Command: ${data.command}`,
          `RTT:     ${data.rtt}ms`,
          '',
        ];

        if (data.serverAccepted && data.output) {
          lines.push('--- Command Output ---', data.output, '');
        }

        if (!data.serverAccepted && data.serverMessage) {
          lines.push(`Server Error: ${data.serverMessage}`, '');
        }

        if (data.note) lines.push(data.note);

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Execution failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleExecute();
    }
  };

  return (
    <ProtocolClientLayout title="Rexec Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rexec-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="bsd-server.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="rexec-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 512 (standard rexec port)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Credentials" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rexec-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="guest"
            helpText="Default: guest"
          />

          <FormField
            id="rexec-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="(sent in cleartext!)"
          />
        </div>

        <SectionHeader stepNumber={3} title="Command" />

        <div className="mb-6">
          <FormField
            id="rexec-command"
            label="Command to Execute"
            type="text"
            value={command}
            onChange={setCommand}
            onKeyDown={handleKeyDown}
            placeholder="id"
            helpText="Command executed on the remote host"
          />
        </div>

        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
          <p className="text-xs text-red-300">
            <strong>Security Warning:</strong> Rexec transmits username and password in cleartext over the network.
            This protocol should only be used for testing legacy systems. Use SSH for production access.
          </p>
        </div>

        <ActionButton
          onClick={handleExecute}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Execute remote command via Rexec"
        >
          Execute Command
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Rexec Protocol"
          description="Rexec (port 512) is a BSD remote execution protocol that sends username/password/command to a remote host and returns the output. Unlike Rlogin (port 513) which uses .rhosts trust for interactive sessions, Rexec requires explicit credentials for one-shot command execution. Both are superseded by SSH. Standard port is 512."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">BSD Remote Services Family</h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><strong className="text-slate-300">Rexec (Port 512):</strong> Single command execution with password auth</p>
            <p><strong className="text-slate-300">Rlogin (Port 513):</strong> Interactive shell via .rhosts trust</p>
            <p><strong className="text-slate-300">RSH (Port 514/tcp):</strong> Single command execution via .rhosts trust</p>
            <p><strong className="text-slate-300">Comparison:</strong> Rexec = password + command, RSH = .rhosts + command, Rlogin = .rhosts + shell</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
