import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface TeamSpeakClientProps {
  onBack: () => void;
}

interface TSKeyValue {
  key: string;
  value: string;
}

export default function TeamSpeakClient({ onBack }: TeamSpeakClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('10011');
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required'), validationRules.hostname()],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/teamspeak/connect', {
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
        server?: string;
        banner?: string;
        version?: TSKeyValue[];
        whoami?: TSKeyValue[];
      };

      if (response.ok && data.success) {
        const lines = [
          `TeamSpeak ServerQuery`,
          `Server: ${data.server}`,
          `${'='.repeat(60)}`,
          '',
        ];

        if (data.banner) {
          lines.push('--- Banner ---', data.banner, '');
        }

        if (data.version && data.version.length > 0) {
          lines.push('--- Version ---');
          for (const kv of data.version) {
            lines.push(`  ${kv.key}: ${kv.value}`);
          }
          lines.push('');
        }

        if (data.whoami && data.whoami.length > 0) {
          lines.push('--- Connection Info (whoami) ---');
          for (const kv of data.whoami) {
            lines.push(`  ${kv.key}: ${kv.value}`);
          }
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to connect to TeamSpeak server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to TeamSpeak server');
    } finally {
      setLoading(false);
    }
  };

  const handleCommand = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid || !command.trim()) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/teamspeak/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          command: command.trim(),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        server?: string;
        command?: string;
        items?: TSKeyValue[][];
        errorId?: number;
        errorMsg?: string;
        raw?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `TeamSpeak Command: ${data.command}`,
          `Server: ${data.server}`,
          `${'='.repeat(60)}`,
          '',
        ];

        if (data.items && data.items.length > 0) {
          data.items.forEach((item, idx) => {
            if (data.items && data.items.length > 1) {
              lines.push(`--- Item ${idx + 1} ---`);
            }
            for (const kv of item) {
              lines.push(`  ${kv.key}: ${kv.value}`);
            }
            if (data.items && data.items.length > 1) {
              lines.push('');
            }
          });
        } else {
          lines.push('(empty response)');
        }

        if (data.errorId !== undefined) {
          lines.push('', `Status: error id=${data.errorId} msg=${data.errorMsg}`);
        }

        if (data.raw) {
          lines.push('', '--- Raw Response ---', data.raw);
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'TeamSpeak command failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'TeamSpeak command failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="TeamSpeak Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="TeamSpeak Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ts-host"
            label="TeamSpeak Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="ts.example.com"
            required
            helpText="TeamSpeak 3 server with ServerQuery enabled"
            error={errors.host}
          />

          <FormField
            id="ts-port"
            label="ServerQuery Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 10011 (ServerQuery port)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Actions" color="green" />

        <div className="grid md:grid-cols-2 gap-3 mb-4">
          <ActionButton
            onClick={handleConnect}
            disabled={loading || !host}
            loading={loading}
            ariaLabel="Connect and get server info"
          >
            Connect & Info
          </ActionButton>

          <div className="flex gap-2">
            <div className="flex-1">
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading && host && command.trim()) {
                    handleCommand();
                  }
                }}
                placeholder="e.g. serverinfo, clientlist, channellist"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <ActionButton
              onClick={handleCommand}
              disabled={loading || !host || !command.trim()}
              loading={loading}
              variant="secondary"
              ariaLabel="Run ServerQuery command"
            >
              Run
            </ActionButton>
          </div>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About TeamSpeak ServerQuery"
          description="TeamSpeak ServerQuery is a text-based administration protocol for TeamSpeak 3 servers (port 10011). It provides full server management capabilities through simple text commands. Responses use key=value pairs with pipe-delimited items. ServerQuery is used by monitoring bots, admin tools, and server management panels."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Available Read-Only Commands</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              { cmd: 'version', desc: 'Server version info' },
              { cmd: 'whoami', desc: 'Connection identity' },
              { cmd: 'serverinfo', desc: 'Virtual server details' },
              { cmd: 'clientlist', desc: 'Connected users' },
              { cmd: 'channellist', desc: 'Channel hierarchy' },
              { cmd: 'hostinfo', desc: 'Host machine stats' },
              { cmd: 'instanceinfo', desc: 'Instance configuration' },
              { cmd: 'serverlist', desc: 'Virtual servers' },
              { cmd: 'help', desc: 'Command reference' },
            ].map(({ cmd, desc }) => (
              <button
                key={cmd}
                onClick={() => setCommand(cmd)}
                className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded text-left transition-colors"
              >
                <span className="font-mono text-blue-400">{cmd}</span>
                <span className="block text-xs text-slate-400">{desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">ServerQuery Escaping</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Escape</th>
                  <th className="text-left py-2 px-2 text-slate-300">Character</th>
                </tr>
              </thead>
              <tbody className="text-slate-400 font-mono">
                {[
                  ['\\s', 'Space'],
                  ['\\p', 'Pipe (|)'],
                  ['\\/', 'Forward slash'],
                  ['\\\\', 'Backslash'],
                  ['\\n', 'Newline'],
                  ['\\r', 'Carriage return'],
                  ['\\t', 'Tab'],
                ].map(([esc, char]) => (
                  <tr key={esc} className="border-b border-slate-700">
                    <td className="py-1.5 px-2 text-blue-400">{esc}</td>
                    <td className="py-1.5 px-2">{char}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              <strong>Note:</strong> ServerQuery access is often restricted by IP whitelist.
              Some commands require authentication via <code className="bg-slate-700 px-1 rounded">login</code>.
              Without login, only basic commands like <code className="bg-slate-700 px-1 rounded">version</code> and
              <code className="bg-slate-700 px-1 rounded">whoami</code> typically work.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
