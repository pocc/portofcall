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

interface MongoDBClientProps {
  onBack: () => void;
}

export default function MongoDBClient({ onBack }: MongoDBClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('27017');
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
      const response = await fetch('/api/mongodb/connect', {
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
        host?: string;
        port?: number;
        connectTime?: number;
        rtt?: number;
        serverInfo?: {
          version?: string;
          gitVersion?: string;
          isWritablePrimary?: boolean;
          maxBsonObjectSize?: number;
          maxMessageSizeBytes?: number;
          maxWriteBatchSize?: number;
          minWireVersion?: number;
          maxWireVersion?: number;
          readOnly?: boolean;
          localTime?: string;
          ok?: number;
        };
      };

      if (response.ok && data.success) {
        const info = data.serverInfo;
        let resultText = `Connected to MongoDB server!\n\n`;
        resultText += `Host:      ${data.host}:${data.port}\n`;
        resultText += `RTT:       ${data.rtt}ms (connect: ${data.connectTime}ms)\n\n`;

        resultText += `--- Server Info ---\n`;
        resultText += `Version:           ${info?.version || 'Unknown'}\n`;

        if (info?.gitVersion) {
          resultText += `Git Version:       ${info.gitVersion.substring(0, 12)}...\n`;
        }

        resultText += `Writable Primary:  ${info?.isWritablePrimary ?? 'N/A'}\n`;
        resultText += `Read Only:         ${info?.readOnly ?? 'N/A'}\n`;
        resultText += `Wire Version:      ${info?.minWireVersion ?? '?'} - ${info?.maxWireVersion ?? '?'}\n`;

        if (info?.maxBsonObjectSize) {
          resultText += `Max BSON Size:     ${(info.maxBsonObjectSize / 1024 / 1024).toFixed(0)} MB\n`;
        }
        if (info?.maxMessageSizeBytes) {
          resultText += `Max Message Size:  ${(info.maxMessageSizeBytes / 1024 / 1024).toFixed(0)} MB\n`;
        }
        if (info?.maxWriteBatchSize) {
          resultText += `Max Write Batch:   ${info.maxWriteBatchSize.toLocaleString()}\n`;
        }

        if (info?.localTime) {
          resultText += `\nServer Time:       ${info.localTime}\n`;
        }

        resultText += `\nStatus: ${info?.ok === 1 ? 'OK' : 'Error'}`;

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

  const handlePing = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/mongodb/ping', {
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
        rtt?: number;
        ok?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `PONG! MongoDB server responded in ${data.rtt}ms\n\n` +
          `Status: ${data.ok === 1 ? 'OK' : 'Error'}`
        );
      } else {
        setError(data.error || 'Ping failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ping failed');
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
    <ProtocolClientLayout title="MongoDB Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.MongoDB || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="mongodb-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="mongodb.example.com"
            required
            helpText="MongoDB server hostname or IP address"
            error={errors.host}
          />

          <FormField
            id="mongodb-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 27017 (standard MongoDB port)"
            error={errors.port}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <ActionButton
            onClick={handleConnect}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Test MongoDB connection"
          >
            Test Connection
          </ActionButton>

          <ActionButton
            onClick={handlePing}
            disabled={loading || !host || !port}
            loading={loading}
            variant="secondary"
            ariaLabel="Ping MongoDB server"
          >
            Ping
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About MongoDB Wire Protocol"
          description="MongoDB uses a binary wire protocol with BSON (Binary JSON) encoding over TCP port 27017. This client sends the 'hello' command via OP_MSG (opcode 2013) to verify connectivity and retrieve server information including version, wire protocol range, and replica set status."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Connect</h3>
          <div className="grid gap-2">
            <button
              onClick={() => {
                setHost('localhost');
                setPort('27017');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:27017</span>
              <span className="ml-2 text-slate-400">- Local MongoDB instance</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              Start a local MongoDB with Docker:
              <code className="bg-slate-700 px-2 py-1 rounded mx-1">docker run -d -p 27017:27017 mongo:7</code>
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Technical Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">MongoDB Wire Protocol (OP_MSG)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Encoding:</td>
                  <td className="py-2 px-2">BSON (Binary JSON)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Port:</td>
                  <td className="py-2 px-2 font-mono">27017</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">OpCode Used:</td>
                  <td className="py-2 px-2 font-mono">OP_MSG (2013)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Commands Sent:</td>
                  <td className="py-2 px-2">hello, buildInfo, ping</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Min Version:</td>
                  <td className="py-2 px-2">MongoDB 3.6+ (OP_MSG support)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Database Protocols Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Database</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Protocol</th>
                  <th className="text-left py-2 px-2 text-slate-300">Type</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 text-green-400">MongoDB</td>
                  <td className="py-2 px-2 font-mono">27017</td>
                  <td className="py-2 px-2">Wire Protocol (BSON)</td>
                  <td className="py-2 px-2">Document (NoSQL)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">MySQL</td>
                  <td className="py-2 px-2 font-mono">3306</td>
                  <td className="py-2 px-2">MySQL Protocol</td>
                  <td className="py-2 px-2">Relational (SQL)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">PostgreSQL</td>
                  <td className="py-2 px-2 font-mono">5432</td>
                  <td className="py-2 px-2">Frontend/Backend Protocol</td>
                  <td className="py-2 px-2">Relational (SQL)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Redis</td>
                  <td className="py-2 px-2 font-mono">6379</td>
                  <td className="py-2 px-2">RESP</td>
                  <td className="py-2 px-2">Key-Value (Cache)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2">Memcached</td>
                  <td className="py-2 px-2 font-mono">11211</td>
                  <td className="py-2 px-2">Text/Binary</td>
                  <td className="py-2 px-2">Key-Value (Cache)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
