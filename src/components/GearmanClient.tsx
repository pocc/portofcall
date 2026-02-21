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

interface GearmanClientProps {
  onBack: () => void;
}

export default function GearmanClient({ onBack }: GearmanClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4730');
  const [command, setCommand] = useState('');
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
      const response = await fetch('/api/gearman/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        version?: string;
        functions?: Array<{
          name: string;
          total: number;
          running: number;
          availableWorkers: number;
        }>;
        totalFunctions?: number;
        totalQueuedJobs?: number;
        totalRunningJobs?: number;
        totalWorkers?: number;
        rawStatus?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Gearman Server Info\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        if (data.version) resultText += `Version: ${data.version}\n`;
        resultText += `\nJob Queue Summary:\n`;
        resultText += `${'-'.repeat(30)}\n`;
        resultText += `  Registered Functions: ${data.totalFunctions}\n`;
        resultText += `  Queued Jobs:          ${data.totalQueuedJobs}\n`;
        resultText += `  Running Jobs:         ${data.totalRunningJobs}\n`;
        resultText += `  Available Workers:    ${data.totalWorkers}\n`;

        if (data.functions && data.functions.length > 0) {
          resultText += `\nFunction Details:\n`;
          resultText += `${'-'.repeat(50)}\n`;
          resultText += `  ${'Function'.padEnd(25)} Total  Run  Workers\n`;
          resultText += `  ${''.padEnd(25, '-')} -----  ---  -------\n`;
          for (const fn of data.functions) {
            resultText += `  ${fn.name.padEnd(25)} ${String(fn.total).padStart(5)}  ${String(fn.running).padStart(3)}  ${String(fn.availableWorkers).padStart(7)}\n`;
          }
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

  const handleCommand = async (cmd?: string) => {
    const cmdToSend = cmd || command;
    if (!cmdToSend) return;

    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/gearman/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          command: cmdToSend,
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        command?: string;
        rtt?: number;
        response?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Command: ${data.command}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += data.response || '(no data)';

        setResult(resultText);
      } else {
        setError(data.error || 'Command failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Command failed');
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
    <ProtocolClientLayout title="Gearman Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Gearman || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="gearman-host"
            label="Gearman Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="gearman.example.com"
            required
            helpText="Hostname or IP of the Gearman job server"
            error={errors.host}
          />

          <FormField
            id="gearman-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 4730"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test Gearman connection and retrieve status"
        >
          Connect & Status
        </ActionButton>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={2} title="Execute Command" />

          <div className="mb-4">
            <FormField
              id="gearman-command"
              label="Command"
              type="text"
              value={command}
              onChange={setCommand}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter' && !loading && host && port && command) {
                  handleCommand();
                }
              }}
              placeholder="status"
              helpText="Read-only commands: version, status, workers, maxqueue <function>"
            />
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {['version', 'status', 'workers'].map(
              (cmd) => (
                <button
                  key={cmd}
                  onClick={() => {
                    setCommand(cmd);
                    handleCommand(cmd);
                  }}
                  disabled={loading || !host || !port}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm rounded transition-colors font-mono"
                >
                  {cmd}
                </button>
              )
            )}
          </div>

          <button
            onClick={() => handleCommand()}
            disabled={loading || !host || !port || !command}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Execute Gearman admin command"
          >
            {loading ? 'Executing...' : 'Execute'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Gearman"
          description="Gearman is a distributed job queue system that farms out work to multiple machines. It uses a text-based admin protocol on port 4730. The 'status' command shows registered functions with queued/running job counts and available workers. The 'workers' command lists all connected worker processes."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
