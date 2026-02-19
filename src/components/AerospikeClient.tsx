import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface AerospikeClientProps {
  onBack: () => void;
}

const QUICK_COMMANDS = [
  { label: 'build', cmd: 'build', desc: 'Server version' },
  { label: 'status', cmd: 'status', desc: 'Health check' },
  { label: 'node', cmd: 'node', desc: 'Node ID' },
  { label: 'namespaces', cmd: 'namespaces', desc: 'List namespaces' },
  { label: 'statistics', cmd: 'statistics', desc: 'Server stats' },
  { label: 'features', cmd: 'features', desc: 'Feature flags' },
  { label: 'edition', cmd: 'edition', desc: 'CE or EE' },
  { label: 'cluster-name', cmd: 'cluster-name', desc: 'Cluster name' },
  { label: 'service', cmd: 'service', desc: 'Access endpoints' },
  { label: 'sets', cmd: 'sets', desc: 'List sets' },
  { label: 'bins', cmd: 'bins', desc: 'List bins' },
  { label: 'sindex', cmd: 'sindex', desc: 'Secondary indexes' },
];

export default function AerospikeClient({ onBack }: AerospikeClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3000');
  const [command, setCommand] = useState('build');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleConnect = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/aerospike/connect', {
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
        serverInfo?: {
          build?: string;
          status?: string;
          nodeId?: string;
          edition?: string;
          clusterName?: string;
          namespaces?: string[];
        };
      };

      if (response.ok && data.success) {
        const info = data.serverInfo;
        let output = `Connected to Aerospike at ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms\n\n`;
        output += `Build:        ${info?.build || 'Unknown'}\n`;
        output += `Status:       ${info?.status || 'Unknown'}\n`;
        output += `Node ID:      ${info?.nodeId || 'Unknown'}\n`;
        output += `Edition:      ${info?.edition || 'Unknown'}\n`;
        output += `Cluster:      ${info?.clusterName || 'Unknown'}\n`;
        output += `Namespaces:   ${info?.namespaces?.length ? info.namespaces.join(', ') : 'None'}\n`;
        setResult(output);
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
    const execCmd = cmd || command;
    if (!host) {
      setError('Host is required');
      return;
    }
    if (!execCmd.trim()) {
      setError('Command is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/aerospike/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          command: execCmd.trim(),
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
        let output = `Command: ${data.command}\n`;
        output += `RTT: ${data.rtt}ms\n\n`;

        if (data.parsed && Object.keys(data.parsed).length > 0) {
          output += `--- Parsed Response ---\n`;
          for (const [key, value] of Object.entries(data.parsed)) {
            if (key === '_value') {
              output += `${value}\n`;
            } else {
              output += `${key} = ${value}\n`;
            }
          }
          output += `\n--- Raw Response ---\n`;
        }

        output += data.response || '(empty response)';
        setResult(output);
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
    if (e.key === 'Enter' && !loading && host) {
      handleConnect();
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-white hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
          aria-label="Go back to protocol selector"
        >
          &larr; Back
        </button>
        <h1 className="text-3xl font-bold text-white">Aerospike Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>


          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

      <ApiExamples examples={apiExamples.Aerospike || []} />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="as-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="as-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="aerospike.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="as-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="as-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 3000</p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Test Aerospike connection"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Connecting...
            </span>
          ) : (
            'Test Connection'
          )}
        </button>

        {/* Step 2: Info Commands */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Info Command</h2>
          </div>

          <div className="mb-4">
            <label htmlFor="as-command" className="block text-sm font-medium text-slate-300 mb-1">
              Command
            </label>
            <input
              id="as-command"
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading && host) handleCommand();
              }}
              placeholder="build"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-describedby="as-command-help"
            />
            <p id="as-command-help" className="text-xs text-slate-400 mt-1">
              Use namespace/&lt;name&gt; to query a specific namespace
            </p>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {QUICK_COMMANDS.map((qc) => (
              <button
                key={qc.cmd}
                onClick={() => {
                  setCommand(qc.cmd);
                  handleCommand(qc.cmd);
                }}
                disabled={loading || !host}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-slate-600"
                title={qc.desc}
              >
                {qc.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => handleCommand()}
            disabled={loading || !host || !command.trim()}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Execute Aerospike info command"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Executing...
              </span>
            ) : (
              'Execute Command'
            )}
          </button>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600" role="region" aria-live="polite">
            <div className="flex items-center gap-2 mb-2">
              {error ? (
                <span className="text-red-400 text-xl" aria-hidden="true">&#x2715;</span>
              ) : (
                <span className="text-green-400 text-xl" aria-hidden="true">&#x2713;</span>
              )}
              <h3 className="text-sm font-semibold text-slate-300">
                {error ? 'Error' : 'Success'}
              </h3>
            </div>
            <pre className={`text-sm whitespace-pre-wrap font-mono ${
              error ? 'text-red-400' : 'text-green-400'
            }`}>
              {error || result}
            </pre>
          </div>
        )}

        {/* Help Section */}
        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Aerospike</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Aerospike is a high-performance, distributed NoSQL database optimized for
            real-time applications. It supports hybrid memory (RAM + SSD) architecture and is
            used by companies like PayPal, Adobe, and Snap for low-latency workloads.
            Port 3000 is the default client/info port.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            The info protocol is a lightweight text-based interface for querying cluster
            metadata, health status, and configuration. Commands like{' '}
            <code className="bg-slate-700 px-1 rounded">build</code>,{' '}
            <code className="bg-slate-700 px-1 rounded">status</code>, and{' '}
            <code className="bg-slate-700 px-1 rounded">namespaces</code> return server
            diagnostics. Use{' '}
            <code className="bg-slate-700 px-1 rounded">namespace/&lt;name&gt;</code> to
            inspect a specific namespace.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
