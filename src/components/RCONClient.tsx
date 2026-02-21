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

interface RCONClientProps {
  onBack: () => void;
}

export default function RCONClient({ onBack }: RCONClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('25575');
  const [password, setPassword] = useState('');
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [authenticated, setAuthenticated] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    password: [validationRules.required('RCON password is required')],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port, password });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/rcon/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          password,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        authenticated?: boolean;
        error?: string;
      };

      if (response.ok && data.success && data.authenticated) {
        setAuthenticated(true);
        setResult('Successfully authenticated to RCON server');
      } else {
        setError(data.error || 'RCON authentication failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'RCON connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCommand = async () => {
    if (!command.trim()) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/rcon/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          password,
          command: command.trim(),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        authenticated?: boolean;
        response?: string;
        error?: string;
      };

      if (response.ok && data.success) {
        const resultText = `> ${command}\n${data.response || '(No output)'}`;
        setResult(resultText);
        setCommandHistory((prev) => [...prev, command]);
        setCommand('');
      } else {
        setError(data.error || 'Command execution failed');
        if (data.authenticated === false) {
          setAuthenticated(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Command execution failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      if (authenticated && command.trim()) {
        handleCommand();
      } else if (!authenticated && host && port && password) {
        handleConnect();
      }
    }
  };

  return (
    <ProtocolClientLayout title="Minecraft RCON Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.RCON || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="rcon-host"
            label="Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="minecraft.example.com"
            required
            helpText="Minecraft server address"
            error={errors.host}
          />

          <FormField
            id="rcon-port"
            label="RCON Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 25575"
            error={errors.port}
          />

          <FormField
            id="rcon-password"
            label="RCON Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="Enter RCON password"
            required
            helpText="Set in server.properties"
            error={errors.password}
          />
        </div>

        {!authenticated && (
          <ActionButton
            onClick={handleConnect}
            disabled={loading || !host || !port || !password}
            loading={loading}
            ariaLabel="Connect and authenticate to RCON server"
          >
            Connect & Authenticate
          </ActionButton>
        )}

        {authenticated && (
          <>
            <SectionHeader stepNumber={2} title="Execute Command" color="green" />

            <div className="mb-4">
              <FormField
                id="rcon-command"
                label="Server Command"
                type="text"
                value={command}
                onChange={setCommand}
                onKeyDown={handleKeyDown}
                placeholder="e.g., list, help, time set day"
                helpText="Enter a Minecraft server command (without /)"
              />
            </div>

            <ActionButton
              onClick={handleCommand}
              disabled={loading || !command.trim()}
              loading={loading}
              variant="success"
              ariaLabel="Execute RCON command"
            >
              Execute Command
            </ActionButton>

            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-2">Quick Commands</h3>
              <div className="flex flex-wrap gap-2">
                {[
                  { cmd: 'list', label: 'List Players' },
                  { cmd: 'help', label: 'Help' },
                  { cmd: 'time set day', label: 'Set Day' },
                  { cmd: 'weather clear', label: 'Clear Weather' },
                  { cmd: 'seed', label: 'Show Seed' },
                  { cmd: 'difficulty', label: 'Difficulty' },
                ].map(({ cmd, label }) => (
                  <button
                    key={cmd}
                    onClick={() => setCommand(cmd)}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <ResultDisplay result={result} error={error} />

        {commandHistory.length > 0 && (
          <div className="mt-6 pt-6 border-t border-slate-600">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Command History</h3>
            <div className="bg-slate-700 rounded-lg p-3 max-h-40 overflow-y-auto">
              {commandHistory.map((cmd, i) => (
                <button
                  key={i}
                  onClick={() => setCommand(cmd)}
                  className="block w-full text-left font-mono text-xs text-slate-300 hover:text-blue-400 py-1 transition-colors"
                >
                  &gt; {cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        <HelpSection
          title="About Minecraft RCON"
          description="RCON (Remote Console) is a binary protocol from Valve's Source engine, adopted by Minecraft for remote server administration. It uses password authentication and allows executing server commands remotely on port 25575."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Server Setup</h3>
          <div className="bg-slate-700 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-2">Enable RCON in <code className="text-blue-400">server.properties</code>:</p>
            <pre className="text-xs font-mono text-slate-200 whitespace-pre-wrap">
{`enable-rcon=true
rcon.port=25575
rcon.password=your_password_here`}
            </pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 25575 (default)</p>
            <p><strong className="text-slate-300">Transport:</strong> TCP</p>
            <p><strong className="text-slate-300">Encoding:</strong> Little-endian binary</p>
            <p><strong className="text-slate-300">Packet:</strong> [Size:int32][ID:int32][Type:int32][Body\0][\0]</p>
            <p><strong className="text-slate-300">Auth:</strong> Password-based (SERVERDATA_AUTH = 3)</p>
            <p><strong className="text-slate-300">Max Body:</strong> 1446 bytes</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
