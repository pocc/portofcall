import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface NRPEClientProps {
  onBack: () => void;
}

const COMMON_COMMANDS = [
  { label: '_NRPE_CHECK', description: 'NRPE version (built-in)' },
  { label: 'check_disk', description: 'Disk usage' },
  { label: 'check_load', description: 'System load' },
  { label: 'check_users', description: 'Logged-in users' },
  { label: 'check_procs', description: 'Running processes' },
  { label: 'check_swap', description: 'Swap usage' },
];

export default function NRPEClient({ onBack }: NRPEClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5666');
  const [command, setCommand] = useState('_NRPE_CHECK');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    command: [validationRules.required('Command is required')],
  });

  const handleQuery = async () => {
    const isValid = validateAll({ host, port, command });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nrpe/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          command,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        command?: string;
        protocolVersion?: number;
        resultCode?: number;
        resultCodeName?: string;
        output?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const statusIcon = data.resultCode === 0 ? '✅' :
                           data.resultCode === 1 ? '⚠️' :
                           data.resultCode === 2 ? '❌' : '❓';

        setResult(
          `${statusIcon} NRPE Response: ${data.resultCodeName}\n\n` +
          `Command:   ${data.command}\n` +
          `Output:    ${data.output}\n` +
          `Status:    ${data.resultCodeName} (code ${data.resultCode})\n` +
          `Protocol:  NRPE v${data.protocolVersion}\n` +
          `RTT:       ${data.rtt}ms\n\n` +
          (data.error ? `⚠️ ${data.error}\n` : '')
        );
      } else {
        setError(data.error || 'Query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVersion = async () => {
    const isValid = validateAll({ host, port, command: '_NRPE_CHECK' });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nrpe/version', {
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
        nrpeVersion?: string;
        output?: string;
        protocolVersion?: number;
        resultCode?: number;
        resultCodeName?: string;
        valid?: boolean;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `✅ NRPE Daemon Detected\n\n` +
          `Version:   ${data.nrpeVersion || 'Unknown'}\n` +
          `Output:    ${data.output}\n` +
          `Protocol:  NRPE v${data.protocolVersion}\n` +
          `Status:    ${data.resultCodeName}\n` +
          `CRC Valid: ${data.valid ? 'Yes' : 'No'}\n` +
          `RTT:       ${data.rtt}ms`
        );
      } else {
        setError(data.error || 'Version check failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port && command) {
      handleQuery();
    }
  };

  return (
    <ProtocolClientLayout title="NRPE Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="nrpe-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="nagios-agent.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="nrpe-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5666 (standard NRPE port)"
            error={errors.port}
          />

          <div className="md:col-span-2">
            <FormField
              id="nrpe-command"
              label="Check Command"
              type="text"
              value={command}
              onChange={setCommand}
              onKeyDown={handleKeyDown}
              placeholder="_NRPE_CHECK"
              required
              helpText="NRPE command to execute on the remote host"
              error={errors.command}
            />
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Common Commands
          </label>
          <div className="flex flex-wrap gap-2">
            {COMMON_COMMANDS.map((cmd) => (
              <button
                key={cmd.label}
                onClick={() => setCommand(cmd.label)}
                className={`text-xs px-3 py-1.5 rounded transition-colors ${
                  command === cmd.label
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                }`}
                title={cmd.description}
              >
                {cmd.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handleQuery}
            disabled={loading || !host || !port || !command}
            loading={loading}
            ariaLabel="Execute NRPE check"
          >
            Execute Check
          </ActionButton>

          <button
            onClick={handleVersion}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="Check NRPE version"
          >
            Version Check
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About NRPE Protocol"
          description="NRPE (Nagios Remote Plugin Executor) is a binary protocol for executing monitoring checks on remote hosts. It uses a fixed 1036-byte packet with CRC32 integrity checking. The _NRPE_CHECK command is always available and returns the NRPE daemon version. Standard port is 5666."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Protocol Details</h3>
          <div className="grid gap-2 text-xs text-slate-400">
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Packet Format (1036 bytes)</p>
              <pre className="font-mono text-[11px] leading-relaxed">
{`Version (2B) | Type (2B) | CRC32 (4B) | Result (2B) | Buffer (1024B) | Pad (2B)`}
              </pre>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Result Codes</p>
              <p>0 = OK, 1 = WARNING, 2 = CRITICAL, 3 = UNKNOWN</p>
            </div>
            <p className="mt-2">
              Note: Many NRPE daemons require TLS connections by default. If you get no
              response, the daemon may need to be configured with <code className="bg-slate-700 px-1 rounded">dont_blame_nrpe=1</code> and
              started with the <code className="bg-slate-700 px-1 rounded">-n</code> flag for non-TLS testing.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
