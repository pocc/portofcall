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

interface ZooKeeperClientProps {
  onBack: () => void;
}

const FOUR_LETTER_COMMANDS = [
  { cmd: 'ruok', desc: 'Health check - responds "imok" if healthy' },
  { cmd: 'srvr', desc: 'Server details (version, mode, connections)' },
  { cmd: 'stat', desc: 'Server statistics and connected clients' },
  { cmd: 'conf', desc: 'Server configuration' },
  { cmd: 'envi', desc: 'Server environment variables' },
  { cmd: 'mntr', desc: 'Monitoring data (key=value format)' },
  { cmd: 'cons', desc: 'Connected client information' },
  { cmd: 'isro', desc: 'Check if server is in read-only mode' },
];

export default function ZooKeeperClient({ onBack }: ZooKeeperClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2181');
  const [command, setCommand] = useState('ruok');
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
      const response = await fetch('/api/zookeeper/connect', {
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
        rtt?: number;
        healthy?: boolean;
        ruokResponse?: string;
        serverInfo?: {
          version?: string;
          mode?: string;
          connections?: string;
          outstanding?: string;
          nodeCount?: string;
          latencyMin?: string;
          received?: string;
          sent?: string;
        };
      };

      if (response.ok && data.success) {
        const info = data.serverInfo;
        let resultText = `${data.healthy ? 'ZooKeeper is healthy!' : 'ZooKeeper responded but may not be healthy'}\n`;
        resultText += `Response: "${data.ruokResponse}"\n`;
        resultText += `RTT: ${data.rtt}ms\n\n`;

        if (info?.version || info?.mode) {
          resultText += `--- Server Details ---\n`;
          if (info.version) resultText += `Version:      ${info.version}\n`;
          if (info.mode) resultText += `Mode:         ${info.mode}\n`;
          if (info.connections) resultText += `Connections:  ${info.connections}\n`;
          if (info.outstanding) resultText += `Outstanding:  ${info.outstanding}\n`;
          if (info.nodeCount) resultText += `Node Count:   ${info.nodeCount}\n`;
          if (info.latencyMin) resultText += `Latency:      ${info.latencyMin}\n`;
          if (info.received) resultText += `Received:     ${info.received}\n`;
          if (info.sent) resultText += `Sent:         ${info.sent}\n`;
        } else {
          resultText += `(srvr command may be disabled - enable 4lw.commands.whitelist in zoo.cfg)`;
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

  const handleCommand = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/zookeeper/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          command,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        command?: string;
        rtt?: number;
        response?: string;
        parsed?: Record<string, string>;
      };

      if (response.ok && data.success) {
        let resultText = `Command: ${data.command}\n`;
        resultText += `RTT: ${data.rtt}ms\n\n`;
        resultText += `--- Response ---\n`;
        resultText += data.response || '(empty response)';

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
    <ProtocolClientLayout title="ZooKeeper Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.ZooKeeper || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="zk-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="zookeeper.example.com"
            required
            helpText="ZooKeeper server hostname or IP"
            error={errors.host}
          />

          <FormField
            id="zk-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2181 (standard ZooKeeper port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test ZooKeeper connection"
        >
          Test Connection (ruok + srvr)
        </ActionButton>

        <ResultDisplay result={result} error={error} />
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="Four-Letter Word Commands" color="green" />

        <div className="mb-4">
          <label htmlFor="zk-command" className="block text-sm font-medium text-slate-300 mb-2">
            Command
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {FOUR_LETTER_COMMANDS.map(({ cmd, desc }) => (
              <button
                key={cmd}
                onClick={() => setCommand(cmd)}
                className={`text-left text-sm py-2 px-3 rounded transition-colors ${
                  command === cmd
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                }`}
                title={desc}
              >
                <span className="font-mono font-bold">{cmd}</span>
                <span className="block text-xs opacity-70 mt-0.5">{desc.split(' - ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        <ActionButton
          onClick={handleCommand}
          disabled={loading || !host || !port || !command}
          loading={loading}
          variant="success"
          ariaLabel={`Send ${command} command`}
        >
          Send "{command}"
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <HelpSection
          title="About ZooKeeper Protocol"
          description="Apache ZooKeeper is a distributed coordination service used by Kafka, Hadoop, and HBase. This client uses 'Four-Letter Word' (4LW) commands - simple text-based health check and monitoring commands sent over TCP port 2181."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Connect</h3>
          <div className="grid gap-2">
            <button
              onClick={() => {
                setHost('localhost');
                setPort('2181');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:2181</span>
              <span className="ml-2 text-slate-400">- Local ZooKeeper</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              Start with Docker:
              <code className="bg-slate-700 px-2 py-1 rounded mx-1">docker run -d -p 2181:2181 zookeeper:latest</code>
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Four-Letter Words Reference</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Command</th>
                  <th className="text-left py-2 px-2 text-slate-300">Description</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                {FOUR_LETTER_COMMANDS.map(({ cmd, desc }) => (
                  <tr key={cmd} className="border-b border-slate-700">
                    <td className="py-2 px-2 font-mono text-blue-400">{cmd}</td>
                    <td className="py-2 px-2">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              <strong>Note:</strong> ZooKeeper 3.5.3+ disables most 4LW commands by default.
              Add <code className="bg-slate-700 px-1 rounded">4lw.commands.whitelist=*</code> to
              <code className="bg-slate-700 px-1 rounded">zoo.cfg</code> to enable all commands,
              or whitelist specific ones like <code className="bg-slate-700 px-1 rounded">4lw.commands.whitelist=ruok,srvr,stat</code>.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
