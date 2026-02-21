import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface HAProxyClientProps {
  onBack: () => void;
}

const COMMON_COMMANDS = [
  { label: 'Show Info', cmd: 'show info' },
  { label: 'Show Stat', cmd: 'show stat' },
  { label: 'Show Servers State', cmd: 'show servers state' },
  { label: 'Show Pools', cmd: 'show pools' },
  { label: 'Show Sess', cmd: 'show sess' },
  { label: 'Help', cmd: 'help' },
];

export default function HAProxyClient({ onBack }: HAProxyClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9999');
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleInfo = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/haproxy/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        info?: Record<string, string>;
        rtt?: number;
      };

      if (response.ok && data.success && data.info) {
        const keyFields = ['Name', 'Version', 'Release_date', 'Uptime', 'Nbproc', 'Nbthread',
          'CurrConns', 'CumConns', 'MaxConn', 'Hard_maxconn', 'Pid', 'Node', 'Description'];
        let output = `HAProxy Server Info\n\n`;
        for (const key of keyFields) {
          if (data.info[key] !== undefined) {
            output += `${key.padEnd(20)} ${data.info[key]}\n`;
          }
        }
        const remaining = Object.entries(data.info).filter(([k]) => !keyFields.includes(k));
        if (remaining.length > 0) {
          output += `\n--- Additional Fields (${remaining.length}) ---\n`;
          for (const [key, value] of remaining.slice(0, 30)) {
            output += `${key.padEnd(20)} ${value}\n`;
          }
          if (remaining.length > 30) {
            output += `... and ${remaining.length - 30} more fields`;
          }
        }
        output += `\nRTT: ${data.rtt}ms`;
        setResult(output);
      } else {
        setError(data.error || 'Info request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleStat = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/haproxy/stat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        stats?: Record<string, string>[];
        count?: number;
        rtt?: number;
      };

      if (response.ok && data.success && data.stats) {
        let output = `HAProxy Statistics (${data.count} entries)\n\n`;
        output += `${'Proxy'.padEnd(20)} ${'Server'.padEnd(18)} ${'Status'.padEnd(8)} ${'Sessions'.padEnd(10)} ${'Bytes In'.padEnd(12)} Bytes Out\n`;
        output += `${'─'.repeat(20)} ${'─'.repeat(17)} ${'─'.repeat(7)} ${'─'.repeat(9)} ${'─'.repeat(11)} ${'─'.repeat(11)}\n`;
        for (const row of data.stats.slice(0, 50)) {
          const pxname = (row.pxname || '').substring(0, 19);
          const svname = (row.svname || '').substring(0, 17);
          const status = (row.status || '').substring(0, 7);
          const scur = row.scur || '0';
          const bin = row.bin || '0';
          const bout = row.bout || '0';
          output += `${pxname.padEnd(20)} ${svname.padEnd(18)} ${status.padEnd(8)} ${scur.padEnd(10)} ${bin.padEnd(12)} ${bout}\n`;
        }
        if ((data.count || 0) > 50) {
          output += `\n... and ${(data.count || 0) - 50} more entries`;
        }
        output += `\nRTT: ${data.rtt}ms`;
        setResult(output);
      } else {
        setError(data.error || 'Stat request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCommand = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!command.trim()) {
      setError('Command is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/haproxy/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
          command: command.trim(),
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        command?: string;
        response?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `Command: ${data.command}\n\n` +
          `${data.response || '(empty response)'}\n\n` +
          `RTT: ${data.rtt}ms`
        );
      } else {
        setError(data.error || 'Command failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleInfo();
    }
  };

  return (
    <ProtocolClientLayout title="HAProxy Runtime API Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="haproxy-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="haproxy.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="haproxy-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 9999 (HAProxy stats socket TCP)"
            error={errors.port}
          />
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handleInfo}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Get HAProxy server info"
          >
            Info
          </ActionButton>

          <button
            onClick={handleStat}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="Get HAProxy statistics"
          >
            Stats
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={2} title="Custom Command" />

          <div className="mb-4">
            <label htmlFor="haproxy-command" className="block text-sm font-medium text-slate-300 mb-2">
              Command (read-only only)
            </label>
            <input
              id="haproxy-command"
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading && host && port && command.trim()) {
                  handleCommand();
                }
              }}
              placeholder="show servers state"
              className="w-full bg-slate-700 border border-slate-500 rounded-lg px-4 py-3 text-white font-mono text-sm placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {COMMON_COMMANDS.map((c) => (
              <button
                key={c.cmd}
                onClick={() => setCommand(c.cmd)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors border border-slate-600"
              >
                {c.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleCommand}
            disabled={loading || !host || !port || !command.trim()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="Execute HAProxy command"
          >
            Execute
          </button>
        </div>

        <HelpSection
          title="About HAProxy Runtime API"
          description="HAProxy's Runtime API provides a text-based command interface for real-time monitoring and administration. Connect to the stats socket (typically TCP port 9999 or a Unix socket) to query process info, statistics, server states, and more. Commands are sent as text lines; only read-only 'show' commands are permitted here for safety."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Protocol Details</h3>
          <div className="grid gap-2 text-xs text-slate-400">
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Command Format</p>
              <pre className="font-mono text-[11px] leading-relaxed">
{`<command>\\n
Response: text lines until connection closes
Optional prompt mode: "> " between commands`}
              </pre>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Key Read-Only Commands</p>
              <p>show info, show stat, show servers state, show backend, show pools, show sess, help</p>
            </div>
            <p className="mt-2">
              The Runtime API is typically exposed via a Unix socket or TCP bind in the HAProxy
              configuration. The "show stat" command returns CSV data compatible with monitoring
              tools like Datadog, Prometheus (via haproxy_exporter), and Grafana.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
