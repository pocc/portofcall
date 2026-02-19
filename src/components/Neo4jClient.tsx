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

interface Neo4jClientProps {
  onBack: () => void;
}

export default function Neo4jClient({ onBack }: Neo4jClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('7687');
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
      const response = await fetch('/api/neo4j/connect', {
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
        host?: string;
        port?: number;
        rtt?: number;
        connectTime?: number;
        boltVersion?: string;
        selectedVersion?: number;
        helloSuccess?: boolean;
        authRequired?: boolean;
        errorMessage?: string;
        serverInfo?: {
          server?: string;
          connection_id?: string;
          hints?: unknown;
        };
      };

      if (response.ok && data.success) {
        let resultText = `Connected to Neo4j server!\n\n`;
        resultText += `Host:            ${data.host}:${data.port}\n`;
        resultText += `RTT:             ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;
        resultText += `Bolt Version:    ${data.boltVersion}\n\n`;

        resultText += `--- Handshake ---\n`;
        resultText += `Selected Version: 0x${data.selectedVersion?.toString(16).padStart(8, '0').toUpperCase()}\n`;

        if (data.helloSuccess) {
          resultText += `HELLO Status:    SUCCESS (no auth required)\n`;
        } else if (data.authRequired) {
          resultText += `HELLO Status:    Auth required\n`;
          if (data.errorMessage) {
            resultText += `Message:         ${data.errorMessage}\n`;
          }
        }

        if (data.serverInfo?.server) {
          resultText += `\n--- Server Info ---\n`;
          resultText += `Server:          ${data.serverInfo.server}\n`;
          if (data.serverInfo.connection_id) {
            resultText += `Connection ID:   ${data.serverInfo.connection_id}\n`;
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="Neo4j Bolt Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Neo4j || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="neo4j-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="neo4j.example.com"
            required
            helpText="Neo4j server hostname or IP address"
            error={errors.host}
          />

          <FormField
            id="neo4j-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 7687 (standard Bolt port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test Neo4j Bolt connection"
        >
          Test Connection (Bolt Handshake + HELLO)
        </ActionButton>

        <ResultDisplay result={result} error={error} />
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <HelpSection
          title="About Neo4j Bolt Protocol"
          description="Neo4j uses the Bolt protocol for binary communication over TCP port 7687. The protocol starts with a 4-version handshake, followed by PackStream-encoded messages. This client performs the handshake to detect the server's Bolt version and sends a HELLO message to discover server capabilities."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Connect</h3>
          <div className="grid gap-2">
            <button
              onClick={() => {
                setHost('localhost');
                setPort('7687');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:7687</span>
              <span className="ml-2 text-slate-400">- Local Neo4j instance</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              Start with Docker:
              <code className="bg-slate-700 px-2 py-1 rounded mx-1">docker run -d -p 7687:7687 -p 7474:7474 -e NEO4J_AUTH=none neo4j:latest</code>
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">Bolt (binary, PackStream encoding)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Port:</td>
                  <td className="py-2 px-2 font-mono">7687</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Magic Number:</td>
                  <td className="py-2 px-2 font-mono">0x6060B017</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Encoding:</td>
                  <td className="py-2 px-2">PackStream (similar to MessagePack)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Query Language:</td>
                  <td className="py-2 px-2">Cypher</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Database Type:</td>
                  <td className="py-2 px-2">Graph (nodes + relationships)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Bolt Message Types</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Tag</th>
                  <th className="text-left py-2 px-2 text-slate-300">Name</th>
                  <th className="text-left py-2 px-2 text-slate-300">Description</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">0x01</td>
                  <td className="py-2 px-2">HELLO</td>
                  <td className="py-2 px-2">Initialize connection with auth</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">0x10</td>
                  <td className="py-2 px-2">RUN</td>
                  <td className="py-2 px-2">Execute Cypher query</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">0x3F</td>
                  <td className="py-2 px-2">PULL</td>
                  <td className="py-2 px-2">Fetch query results</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-green-400">0x70</td>
                  <td className="py-2 px-2">SUCCESS</td>
                  <td className="py-2 px-2">Operation succeeded</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-red-400">0x7F</td>
                  <td className="py-2 px-2">FAILURE</td>
                  <td className="py-2 px-2">Operation failed</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-mono text-blue-400">0x71</td>
                  <td className="py-2 px-2">RECORD</td>
                  <td className="py-2 px-2">Result record row</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Graph Database Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Database</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Protocol</th>
                  <th className="text-left py-2 px-2 text-slate-300">Query Language</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 text-green-400">Neo4j</td>
                  <td className="py-2 px-2 font-mono">7687</td>
                  <td className="py-2 px-2">Bolt (PackStream)</td>
                  <td className="py-2 px-2">Cypher</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">MongoDB</td>
                  <td className="py-2 px-2 font-mono">27017</td>
                  <td className="py-2 px-2">Wire Protocol (BSON)</td>
                  <td className="py-2 px-2">MQL</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Redis</td>
                  <td className="py-2 px-2 font-mono">6379</td>
                  <td className="py-2 px-2">RESP</td>
                  <td className="py-2 px-2">Redis commands</td>
                </tr>
                <tr>
                  <td className="py-2 px-2">Cassandra</td>
                  <td className="py-2 px-2 font-mono">9042</td>
                  <td className="py-2 px-2">CQL Binary</td>
                  <td className="py-2 px-2">CQL</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
