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

interface CassandraClientProps {
  onBack: () => void;
}

export default function CassandraClient({ onBack }: CassandraClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9042');
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
      const response = await fetch('/api/cassandra/connect', {
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
        connectTime?: number;
        rtt?: number;
        protocolVersion?: number;
        cqlVersions?: string[];
        compression?: string[];
        authRequired?: boolean;
        authenticator?: string;
        startupResponse?: string;
        startupError?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Connected to Cassandra at ${data.host}:${data.port}\n\n`;
        resultText += `Protocol Version: CQL v${data.protocolVersion}\n`;
        resultText += `Connect Time: ${data.connectTime}ms\n`;
        resultText += `Round Trip Time: ${data.rtt}ms\n\n`;

        if (data.cqlVersions && data.cqlVersions.length > 0) {
          resultText += `Supported CQL Versions: ${data.cqlVersions.join(', ')}\n`;
        }

        if (data.compression && data.compression.length > 0) {
          resultText += `Supported Compression: ${data.compression.join(', ')}\n`;
        } else {
          resultText += `Supported Compression: none\n`;
        }

        resultText += `\nStartup Response: ${data.startupResponse}\n`;

        if (data.authRequired) {
          resultText += `\nAuthentication Required\n`;
          if (data.authenticator) {
            resultText += `Authenticator: ${data.authenticator}\n`;
          }
        } else if (data.startupResponse === 'READY') {
          resultText += `\nServer is ready (no authentication required)`;
        }

        if (data.startupError) {
          resultText += `\nStartup Error: ${data.startupError}`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Failed to connect to Cassandra server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to Cassandra server');
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
    <ProtocolClientLayout title="Cassandra CQL Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Cassandra || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Cassandra Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="cassandra-host"
            label="Cassandra Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="cassandra.example.com"
            required
            helpText="Cassandra node address (port 9042)"
            error={errors.host}
          />

          <FormField
            id="cassandra-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 9042 (CQL native transport)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect to Cassandra server"
        >
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Cassandra CQL Protocol"
          description="Apache Cassandra uses the CQL Binary Protocol (v4) for client-server communication. This tool sends OPTIONS and STARTUP frames to test connectivity, detect supported CQL versions, available compression algorithms, and authentication requirements."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">CQL Binary Protocol Frame</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs">
            <pre className="text-slate-200">
{`Header (9 bytes):
+----------+-------+--------+--------+-----------+
| version  | flags | stream | opcode |  length   |
| (1 byte) | (1)   | (2)    | (1)    | (4 bytes) |
+----------+-------+--------+--------+-----------+

Client opcodes: OPTIONS(0x05), STARTUP(0x01), QUERY(0x07)
Server opcodes: SUPPORTED(0x06), READY(0x02), ERROR(0x00)`}
            </pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Cassandra Architecture</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">CQL Binary Protocol v4/v5</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Port:</td>
                  <td className="py-2 px-2 font-mono">9042</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Data Model:</td>
                  <td className="py-2 px-2">Wide-column / NoSQL</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Consistency:</td>
                  <td className="py-2 px-2">Tunable (ONE, QUORUM, ALL, etc.)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Compression:</td>
                  <td className="py-2 px-2">LZ4, Snappy (negotiated at startup)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Auth:</td>
                  <td className="py-2 px-2">PasswordAuthenticator (SASL PLAIN)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Database Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Database</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Type</th>
                  <th className="text-left py-2 px-2 text-slate-300">Protocol</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Cassandra</td>
                  <td className="py-2 px-2 font-mono">9042</td>
                  <td className="py-2 px-2">Wide-column</td>
                  <td className="py-2 px-2">CQL Binary</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">MongoDB</td>
                  <td className="py-2 px-2 font-mono">27017</td>
                  <td className="py-2 px-2">Document</td>
                  <td className="py-2 px-2">BSON Wire</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">MySQL</td>
                  <td className="py-2 px-2 font-mono">3306</td>
                  <td className="py-2 px-2">Relational</td>
                  <td className="py-2 px-2">MySQL Protocol</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">PostgreSQL</td>
                  <td className="py-2 px-2 font-mono">5432</td>
                  <td className="py-2 px-2">Relational</td>
                  <td className="py-2 px-2">PG Wire</td>
                </tr>
                <tr>
                  <td className="py-2 px-2">Redis</td>
                  <td className="py-2 px-2 font-mono">6379</td>
                  <td className="py-2 px-2">Key-Value</td>
                  <td className="py-2 px-2">RESP</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
