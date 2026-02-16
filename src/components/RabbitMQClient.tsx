import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface RabbitMQClientProps {
  onBack: () => void;
}

export default function RabbitMQClient({ onBack }: RabbitMQClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('15672');
  const [username, setUsername] = useState('guest');
  const [password, setPassword] = useState('guest');
  const [queryPath, setQueryPath] = useState('');
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
      const response = await fetch('/api/rabbitmq/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username: username || 'guest',
          password: password || 'guest',
          timeout: 15000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        version?: string;
        erlangVersion?: string;
        clusterName?: string;
        managementVersion?: string;
        objectTotals?: { queues?: number; exchanges?: number; connections?: number; channels?: number; consumers?: number };
        queueTotals?: { messages?: number; messages_ready?: number; messages_unacknowledged?: number };
        node?: {
          name?: string;
          type?: string;
          running?: boolean;
          memUsed?: number;
          memLimit?: number;
          diskFree?: number;
          fdUsed?: number;
          fdTotal?: number;
          socketsUsed?: number;
          socketsTotal?: number;
          procUsed?: number;
          procTotal?: number;
          uptime?: number;
        };
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `RabbitMQ Server Info\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        if (data.version) resultText += `Version: ${data.version}\n`;
        if (data.erlangVersion) resultText += `Erlang: ${data.erlangVersion}\n`;
        if (data.clusterName) resultText += `Cluster: ${data.clusterName}\n`;
        if (data.managementVersion) resultText += `Management: ${data.managementVersion}\n`;

        if (data.objectTotals) {
          resultText += `\nObject Totals:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          if (data.objectTotals.queues !== undefined) resultText += `  Queues:      ${data.objectTotals.queues}\n`;
          if (data.objectTotals.exchanges !== undefined) resultText += `  Exchanges:   ${data.objectTotals.exchanges}\n`;
          if (data.objectTotals.connections !== undefined) resultText += `  Connections: ${data.objectTotals.connections}\n`;
          if (data.objectTotals.channels !== undefined) resultText += `  Channels:    ${data.objectTotals.channels}\n`;
          if (data.objectTotals.consumers !== undefined) resultText += `  Consumers:   ${data.objectTotals.consumers}\n`;
        }

        if (data.queueTotals) {
          resultText += `\nQueue Totals:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          if (data.queueTotals.messages !== undefined) resultText += `  Total Messages: ${data.queueTotals.messages}\n`;
          if (data.queueTotals.messages_ready !== undefined) resultText += `  Ready:          ${data.queueTotals.messages_ready}\n`;
          if (data.queueTotals.messages_unacknowledged !== undefined) resultText += `  Unacked:        ${data.queueTotals.messages_unacknowledged}\n`;
        }

        if (data.node) {
          resultText += `\nNode Info:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          if (data.node.name) resultText += `  Name:    ${data.node.name}\n`;
          if (data.node.type) resultText += `  Type:    ${data.node.type}\n`;
          if (data.node.running !== undefined) resultText += `  Running: ${data.node.running}\n`;
          if (data.node.memUsed) resultText += `  Memory:  ${(data.node.memUsed / 1048576).toFixed(1)} MB\n`;
          if (data.node.diskFree) resultText += `  Disk:    ${(data.node.diskFree / 1073741824).toFixed(2)} GB free\n`;
          if (data.node.fdUsed !== undefined && data.node.fdTotal) resultText += `  FDs:     ${data.node.fdUsed}/${data.node.fdTotal}\n`;
          if (data.node.socketsUsed !== undefined && data.node.socketsTotal) resultText += `  Sockets: ${data.node.socketsUsed}/${data.node.socketsTotal}\n`;
          if (data.node.uptime) resultText += `  Uptime:  ${Math.floor(data.node.uptime / 1000 / 60)} minutes\n`;
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

  const handleQuery = async (path?: string) => {
    const pathToQuery = path || queryPath;
    if (!pathToQuery) return;

    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/rabbitmq/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          path: pathToQuery,
          username: username || 'guest',
          password: password || 'guest',
          timeout: 15000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        path?: string;
        rtt?: number;
        statusCode?: number;
        response?: unknown;
      };

      if (response.ok && data.success) {
        let resultText = `Path: ${data.path}\n`;
        resultText += `HTTP Status: ${data.statusCode}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += typeof data.response === 'string'
          ? data.response
          : JSON.stringify(data.response, null, 2);

        setResult(resultText);
      } else {
        setError(data.error || 'Query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
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
    <ProtocolClientLayout title="RabbitMQ Management Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="rabbitmq-host"
            label="RabbitMQ Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="rabbitmq.example.com"
            required
            helpText="Hostname or IP of the RabbitMQ server"
            error={errors.host}
          />

          <FormField
            id="rabbitmq-port"
            label="Management Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 15672"
            error={errors.port}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rabbitmq-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="guest"
            optional
            helpText="Default: guest"
          />

          <FormField
            id="rabbitmq-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="guest"
            optional
            helpText="Default: guest"
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect to RabbitMQ and retrieve cluster overview"
        >
          Connect & Overview
        </ActionButton>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <SectionHeader stepNumber={2} title="Query API" />

          <div className="mb-4">
            <FormField
              id="rabbitmq-path"
              label="API Path"
              type="text"
              value={queryPath}
              onChange={setQueryPath}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter' && !loading && host && port && queryPath) {
                  handleQuery();
                }
              }}
              placeholder="/api/queues"
              helpText="Read-only: only /api/* paths are allowed"
            />
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {[
              '/api/overview',
              '/api/nodes',
              '/api/queues',
              '/api/exchanges',
              '/api/connections',
              '/api/channels',
            ].map((path) => (
              <button
                key={path}
                onClick={() => {
                  setQueryPath(path);
                  handleQuery(path);
                }}
                disabled={loading || !host || !port}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm rounded transition-colors font-mono"
              >
                {path.replace('/api/', '')}
              </button>
            ))}
          </div>

          <button
            onClick={() => handleQuery()}
            disabled={loading || !host || !port || !queryPath}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Execute RabbitMQ API query"
          >
            {loading ? 'Querying...' : 'Query'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About RabbitMQ Management"
          description="RabbitMQ is an open-source message broker supporting AMQP, MQTT, and STOMP. Its Management Plugin exposes an HTTP API on port 15672 for monitoring queues, exchanges, connections, and cluster health. Default credentials are guest/guest (localhost only). The /api/overview endpoint provides version info, Erlang version, cluster name, and aggregate statistics."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
