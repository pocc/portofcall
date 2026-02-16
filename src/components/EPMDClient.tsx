import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface EPMDClientProps {
  onBack: () => void;
}

export default function EPMDClient({ onBack }: EPMDClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4369');
  const [nodeName, setNodeName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'names' | 'port'>('names');

  const namesValidation = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const portValidation = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    nodeName: [validationRules.required('Node name is required')],
  });

  const handleNames = async () => {
    const isValid = namesValidation.validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/epmd/names', {
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
        epmdPort?: number;
        nodes?: { name: string; port: number }[];
        rawResponse?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const nodeList =
          data.nodes && data.nodes.length > 0
            ? data.nodes
                .map((n) => `  ${n.name} → port ${n.port}`)
                .join('\n')
            : '  (no nodes registered)';

        setResult(
          `EPMD Server Detected\n\n` +
            `EPMD Port: ${data.epmdPort}\n` +
            `RTT:       ${data.rtt}ms\n\n` +
            `Registered Erlang Nodes:\n${nodeList}\n\n` +
            (data.rawResponse
              ? `Raw Response:\n${data.rawResponse}`
              : ''),
        );
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePort = async () => {
    const isValid = portValidation.validateAll({ host, port, nodeName });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/epmd/port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          nodeName,
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        nodeName?: string;
        found?: boolean;
        nodePort?: number;
        nodeType?: string;
        protocol?: number;
        highestVersion?: number;
        lowestVersion?: number;
        extra?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        if (data.found) {
          setResult(
            `Node Found: "${data.nodeName}"\n\n` +
              `Distribution Port: ${data.nodePort}\n` +
              `Node Type:         ${data.nodeType}\n` +
              `Protocol:          ${data.protocol}\n` +
              `Version Range:     ${data.lowestVersion} - ${data.highestVersion}\n` +
              (data.extra ? `Extra:             ${data.extra}\n` : '') +
              `RTT:               ${data.rtt}ms`,
          );
        } else {
          setResult(
            `Node "${nodeName}" Not Found\n\n` +
              `The node is not registered with EPMD on ${host}.\n` +
              `RTT: ${data.rtt}ms\n\n` +
              `Try the "List Nodes" tab to see what nodes are registered.`,
          );
        }
      } else {
        setError(data.error || 'Lookup failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      if (activeTab === 'names' && host && port) {
        handleNames();
      } else if (activeTab === 'port' && host && port && nodeName) {
        handlePort();
      }
    }
  };

  const errors =
    activeTab === 'names' ? namesValidation.errors : portValidation.errors;

  return (
    <ProtocolClientLayout title="EPMD Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Tab Selector */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => {
              setActiveTab('names');
              setResult('');
              setError('');
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'names'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            List Nodes
          </button>
          <button
            onClick={() => {
              setActiveTab('port');
              setResult('');
              setError('');
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'port'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Lookup Node
          </button>
        </div>

        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="epmd-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="rabbitmq.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="epmd-port"
            label="EPMD Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 4369 (standard EPMD port)"
            error={errors.port}
          />
        </div>

        {activeTab === 'port' && (
          <>
            <SectionHeader stepNumber={2} title="Node Lookup" />

            <div className="grid md:grid-cols-1 gap-4 mb-6">
              <FormField
                id="epmd-node"
                label="Erlang Node Name"
                type="text"
                value={nodeName}
                onChange={setNodeName}
                onKeyDown={handleKeyDown}
                placeholder="rabbit"
                required
                helpText="The short name of the Erlang node (e.g. 'rabbit' for rabbit@hostname)"
                error={errors.nodeName}
              />
            </div>
          </>
        )}

        <ActionButton
          onClick={activeTab === 'names' ? handleNames : handlePort}
          disabled={
            loading ||
            !host ||
            !port ||
            (activeTab === 'port' && !nodeName)
          }
          loading={loading}
          ariaLabel={
            activeTab === 'names'
              ? 'List registered Erlang nodes'
              : 'Look up Erlang node port'
          }
        >
          {activeTab === 'names' ? 'List Nodes' : 'Lookup Node'}
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About EPMD"
          description="EPMD (Erlang Port Mapper Daemon) runs on port 4369 and maps Erlang/OTP node names to their TCP distribution ports. It's essential for RabbitMQ clustering, CouchDB replication, and Elixir distributed systems. The 'List Nodes' tab shows all registered Erlang nodes, while 'Lookup Node' finds a specific node's distribution port."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">
            Common Erlang Services Using EPMD
          </h3>
          <div className="grid gap-2 text-sm">
            <div className="bg-slate-700 py-2 px-3 rounded text-slate-300">
              <span className="font-mono text-blue-400">rabbit</span>
              <span className="ml-2 text-slate-400">
                — RabbitMQ message broker
              </span>
            </div>
            <div className="bg-slate-700 py-2 px-3 rounded text-slate-300">
              <span className="font-mono text-blue-400">couchdb</span>
              <span className="ml-2 text-slate-400">
                — Apache CouchDB database
              </span>
            </div>
            <div className="bg-slate-700 py-2 px-3 rounded text-slate-300">
              <span className="font-mono text-blue-400">ejabberd</span>
              <span className="ml-2 text-slate-400">
                — ejabberd XMPP server
              </span>
            </div>
            <div className="bg-slate-700 py-2 px-3 rounded text-slate-300">
              <span className="font-mono text-blue-400">emqx</span>
              <span className="ml-2 text-slate-400">
                — EMQX MQTT broker
              </span>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Node names are the short name part of the full Erlang node name
            (e.g., "rabbit" from "rabbit@hostname").
          </p>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
