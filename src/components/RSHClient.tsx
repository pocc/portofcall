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

interface RSHClientProps {
  onBack: () => void;
}

export default function RSHClient({ onBack }: RSHClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('514');
  const [localUser, setLocalUser] = useState('');
  const [remoteUser, setRemoteUser] = useState('');
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
      const response = await fetch('/api/rsh/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          localUser: localUser || 'guest',
          remoteUser: remoteUser || 'guest',
          command: command || 'id',
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        serverAccepted?: boolean;
        localUser?: string;
        remoteUser?: string;
        command?: string;
        output?: string;
        serverMessage?: string;
        privilegedPortRejection?: boolean;
        rtt?: number;
        note?: string;
        security?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `RSH ${data.serverAccepted ? 'Command Accepted' : data.privilegedPortRejection ? 'Server Active (privileged port required)' : 'Rejected'}`,
          '',
          `Local User:  ${data.localUser}`,
          `Remote User: ${data.remoteUser}`,
          `Command:     ${data.command}`,
          `RTT:         ${data.rtt}ms`,
          '',
        ];

        if (data.serverAccepted && data.output) {
          lines.push('--- Command Output ---', data.output, '');
        }

        if (!data.serverAccepted && data.serverMessage) {
          lines.push(`Server Response: ${data.serverMessage}`, '');
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
    <ProtocolClientLayout title="RSH Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.RSH || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rsh-host"
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
            id="rsh-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 514 (standard rsh port)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Identity" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rsh-local-user"
            label="Local Username"
            type="text"
            value={localUser}
            onChange={setLocalUser}
            onKeyDown={handleKeyDown}
            placeholder="guest"
            helpText="Your client-side username (sent to server)"
          />

          <FormField
            id="rsh-remote-user"
            label="Remote Username"
            type="text"
            value={remoteUser}
            onChange={setRemoteUser}
            onKeyDown={handleKeyDown}
            placeholder="guest"
            helpText="Username to run the command as on the server"
          />
        </div>

        <SectionHeader stepNumber={3} title="Command" />

        <div className="mb-6">
          <FormField
            id="rsh-command"
            label="Command to Execute"
            type="text"
            value={command}
            onChange={setCommand}
            onKeyDown={handleKeyDown}
            placeholder="id"
            helpText="Shell command to execute on the remote host"
          />
        </div>

        <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded-lg">
          <p className="text-xs text-yellow-200">
            <strong>Note:</strong> RSH uses <code className="bg-slate-700 px-1 rounded">.rhosts</code> trust instead of passwords — no credentials are sent. Most servers require the client to connect from a privileged source port (&lt; 1024), which Cloudflare Workers cannot do. A &ldquo;permission denied&rdquo; response still confirms the server is active and running RSH.
          </p>
        </div>

        <ActionButton
          onClick={handleExecute}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Execute remote command via RSH"
        >
          Execute Command
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About RSH (Remote Shell, RFC 1282)"
          description="RSH (port 514/tcp) is a BSD remote command execution protocol that uses .rhosts trust instead of passwords. The server grants access based on /etc/hosts.equiv and ~/.rhosts entries — if the client's host+username pair is listed, the command runs without prompting. RSH is the stateless sibling of Rlogin (513, interactive shell) and Rexec (512, password auth). All three are superseded by SSH."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">BSD Remote Services Family</h3>
          <div className="text-xs text-slate-400 space-y-1">
            <p><strong className="text-slate-300">Rexec (Port 512):</strong> Single command execution — username + password sent explicitly</p>
            <p><strong className="text-slate-300">Rlogin (Port 513):</strong> Interactive shell — .rhosts trust, sends terminal type/speed</p>
            <p><strong className="text-slate-300">RSH (Port 514/tcp):</strong> Single command execution — .rhosts trust, no password</p>
            <p><strong className="text-slate-300">Privileged ports:</strong> RSH requires client to connect from port &lt; 1024 (root-only on Unix). Workers connect from unprivileged ports, so strict servers reject with &ldquo;permission denied&rdquo;.</p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">RSH Protocol Handshake</h3>
          <div className="font-mono text-xs text-slate-400 bg-slate-900 rounded p-3 space-y-1">
            <p><span className="text-blue-400">Client →</span> \0 <span className="text-slate-500">(no stderr port)</span></p>
            <p><span className="text-blue-400">Client →</span> localUser\0</p>
            <p><span className="text-blue-400">Client →</span> remoteUser\0</p>
            <p><span className="text-blue-400">Client →</span> command\0</p>
            <p><span className="text-green-400">Server →</span> \0 <span className="text-slate-500">(accepted)</span> or error text</p>
            <p><span className="text-green-400">Server →</span> command output...</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
