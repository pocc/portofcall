import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface AMIClientProps {
  onBack: () => void;
}

export default function AMIClient({ onBack }: AMIClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5038');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required'), validationRules.hostname()],
    port: [validationRules.port()],
  });

  const handleProbe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/ami/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        banner?: string;
        version?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const lines = [
          `Asterisk Manager Interface`,
          `${'='.repeat(60)}`,
          '',
          `Banner:  ${data.banner}`,
          `Version: ${data.version || 'Unknown'}`,
          `RTT:     ${data.rtt}ms`,
        ];
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to probe AMI server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to probe AMI server');
    } finally {
      setLoading(false);
    }
  };

  const handleCommand = async (selectedAction?: string) => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    const actionToRun = selectedAction || action;
    if (!actionToRun.trim()) return;
    if (!username.trim() || !secret.trim()) {
      setError('Username and secret are required for actions');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/ami/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username: username.trim(),
          secret: secret.trim(),
          action: actionToRun.trim(),
          timeout: 15000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        action?: string;
        response?: Record<string, string>;
        events?: Record<string, string>[];
        transcript?: string[];
        rtt?: number;
      };

      if (response.ok && data.success) {
        const lines = [
          `AMI Action: ${data.action}`,
          `${'='.repeat(60)}`,
          '',
        ];

        if (data.response) {
          lines.push('--- Response ---');
          for (const [key, value] of Object.entries(data.response)) {
            lines.push(`  ${key}: ${value}`);
          }
          lines.push('');
        }

        if (data.events && data.events.length > 0) {
          lines.push(`--- Events (${data.events.length}) ---`);
          data.events.forEach((event, idx) => {
            lines.push(`  [${idx + 1}] ${event['Event'] || 'data'}`);
            for (const [key, value] of Object.entries(event)) {
              if (key !== 'Event') {
                lines.push(`      ${key}: ${value}`);
              }
            }
          });
          lines.push('');
        }

        if (data.rtt !== undefined) {
          lines.push(`RTT: ${data.rtt}ms`);
        }

        if (data.transcript && data.transcript.length > 0) {
          lines.push('', '--- Transcript ---');
          for (const line of data.transcript) {
            lines.push(line);
          }
        }

        setResult(lines.join('\n'));
      } else {
        const lines = [data.error || 'Action failed'];
        if (data.transcript && data.transcript.length > 0) {
          lines.push('', '--- Transcript ---');
          for (const line of data.transcript) {
            lines.push(line);
          }
        }
        setError(lines.join('\n'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AMI action failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="Asterisk AMI Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="AMI Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ami-host"
            label="Asterisk Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="pbx.example.com"
            required
            helpText="Asterisk PBX server with AMI enabled"
            error={errors.host}
          />

          <FormField
            id="ami-port"
            label="AMI Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5038"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Actions" color="green" />

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Probe AMI server"
        >
          Probe Server
        </ActionButton>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={3} title="Run Action (Requires Login)" color="purple" />

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <FormField
              id="ami-username"
              label="Username"
              type="text"
              value={username}
              onChange={setUsername}
              placeholder="admin"
              helpText="AMI manager username"
            />

            <FormField
              id="ami-secret"
              label="Secret"
              type="password"
              value={secret}
              onChange={setSecret}
              placeholder="password"
              helpText="AMI manager secret/password"
            />
          </div>

          <div className="flex gap-2 mb-4">
            <div className="flex-1">
              <input
                type="text"
                value={action}
                onChange={(e) => setAction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading && host && username && secret && action.trim()) {
                    handleCommand();
                  }
                }}
                placeholder="e.g. Ping, CoreSettings, SIPpeers"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <ActionButton
              onClick={() => handleCommand()}
              disabled={loading || !host || !username || !secret || !action.trim()}
              loading={loading}
              variant="secondary"
              ariaLabel="Run AMI action"
            >
              Run
            </ActionButton>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              { action: 'Ping', desc: 'Keepalive check' },
              { action: 'CoreSettings', desc: 'Server configuration' },
              { action: 'CoreStatus', desc: 'System status' },
              { action: 'CoreShowChannels', desc: 'Active channels' },
              { action: 'SIPpeers', desc: 'SIP endpoints' },
              { action: 'QueueStatus', desc: 'Queue statistics' },
              { action: 'QueueSummary', desc: 'Queue summary' },
              { action: 'ListCommands', desc: 'Available actions' },
              { action: 'Status', desc: 'Channel status' },
            ].map(({ action: act, desc }) => (
              <button
                key={act}
                onClick={() => {
                  setAction(act);
                  if (host && username && secret) handleCommand(act);
                }}
                className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded text-left transition-colors"
              >
                <span className="font-mono text-blue-400">{act}</span>
                <span className="block text-xs text-slate-400">{desc}</span>
              </button>
            ))}
          </div>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Asterisk AMI"
          description="Asterisk Manager Interface (AMI) is a text-based TCP protocol for monitoring and controlling Asterisk PBX systems. It uses HTTP-like key-value pairs for actions and responses. AMI is used by call center dashboards, monitoring tools, and VoIP management applications. Authentication is required for most actions."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">AMI Protocol Example</h3>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 space-y-1">
            <div><span className="text-blue-400">S:</span> Asterisk Call Manager/6.0.0</div>
            <div><span className="text-green-400">C:</span> Action: Login</div>
            <div><span className="text-green-400">C:</span> Username: admin</div>
            <div><span className="text-green-400">C:</span> Secret: ****</div>
            <div className="text-slate-500">{'   (blank line)'}</div>
            <div><span className="text-blue-400">S:</span> Response: Success</div>
            <div><span className="text-blue-400">S:</span> Message: Authentication accepted</div>
            <div className="text-slate-500">{'   (blank line)'}</div>
            <div><span className="text-green-400">C:</span> Action: Ping</div>
            <div className="text-slate-500">{'   (blank line)'}</div>
            <div><span className="text-blue-400">S:</span> Response: Success</div>
            <div><span className="text-blue-400">S:</span> Ping: Pong</div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              <strong>Note:</strong> AMI access requires credentials configured in{' '}
              <code className="bg-slate-700 px-1 rounded">manager.conf</code> on the Asterisk server.
              Only read-only actions are allowed through this interface for safety.
              Ensure your AMI user has appropriate permissions (read-only recommended).
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
