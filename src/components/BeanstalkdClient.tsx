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

interface BeanstalkdClientProps {
  onBack: () => void;
}

export default function BeanstalkdClient({ onBack }: BeanstalkdClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('11300');
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
      const response = await fetch('/api/beanstalkd/connect', {
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
        currentJobsReady?: string;
        currentJobsReserved?: string;
        currentJobsDelayed?: string;
        currentJobsBuried?: string;
        totalJobs?: string;
        currentTubes?: string;
        currentConnections?: string;
        uptime?: string;
        pid?: string;
        rawStats?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Beanstalkd Server Info\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        if (data.version) resultText += `Version: ${data.version}\n`;
        if (data.pid) resultText += `PID: ${data.pid}\n`;
        if (data.uptime) resultText += `Uptime: ${data.uptime}s\n`;
        resultText += `\nJob Statistics:\n`;
        resultText += `${'-'.repeat(30)}\n`;
        if (data.currentJobsReady) resultText += `  Ready:    ${data.currentJobsReady}\n`;
        if (data.currentJobsReserved) resultText += `  Reserved: ${data.currentJobsReserved}\n`;
        if (data.currentJobsDelayed) resultText += `  Delayed:  ${data.currentJobsDelayed}\n`;
        if (data.currentJobsBuried) resultText += `  Buried:   ${data.currentJobsBuried}\n`;
        if (data.totalJobs) resultText += `  Total:    ${data.totalJobs}\n`;
        resultText += `\nServer:\n`;
        resultText += `${'-'.repeat(30)}\n`;
        if (data.currentTubes) resultText += `  Tubes:       ${data.currentTubes}\n`;
        if (data.currentConnections) resultText += `  Connections: ${data.currentConnections}\n`;

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
      const response = await fetch('/api/beanstalkd/command', {
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
        status?: string;
        response?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Command: ${data.command}\n`;
        resultText += `Status: ${data.status}\n`;
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
    <ProtocolClientLayout title="Beanstalkd Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Beanstalkd || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="beanstalkd-host"
            label="Beanstalkd Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="beanstalkd.example.com"
            required
            helpText="Hostname or IP of the Beanstalkd server"
            error={errors.host}
          />

          <FormField
            id="beanstalkd-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 11300"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test Beanstalkd connection and retrieve stats"
        >
          Connect & Stats
        </ActionButton>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={2} title="Execute Command" />

          <div className="mb-4">
            <FormField
              id="beanstalkd-command"
              label="Command"
              type="text"
              value={command}
              onChange={setCommand}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter' && !loading && host && port && command) {
                  handleCommand();
                }
              }}
              placeholder="list-tubes"
              helpText="Read-only commands: stats, list-tubes, stats-tube <name>, peek-ready, peek-delayed, peek-buried"
            />
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {['stats', 'list-tubes', 'list-tubes-watched', 'list-tube-used', 'peek-ready', 'peek-delayed', 'peek-buried'].map(
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
            aria-label="Execute beanstalkd command"
          >
            {loading ? 'Executing...' : 'Execute'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Beanstalkd"
          description="Beanstalkd is a simple, fast work queue for distributing time-consuming tasks. It uses a text-based TCP protocol on port 11300 with YAML-formatted responses. Jobs flow through tubes (named queues) with states: ready, reserved, delayed, and buried."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
