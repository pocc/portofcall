import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface RiakClientProps {
  onBack: () => void;
}

export default function RiakClient({ onBack }: RiakClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8087');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handlePing = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/riak/ping', {
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
        message?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `Riak Ping: OK\n\n` +
          `Response: ${data.message}\n` +
          `RTT:      ${data.rtt}ms`
        );
      } else {
        setError(data.error || 'Ping failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleInfo = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/riak/info', {
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
        node?: string;
        serverVersion?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `Riak Server Info\n\n` +
          `Node:     ${data.node || 'Unknown'}\n` +
          `Version:  ${data.serverVersion || 'Unknown'}\n` +
          `RTT:      ${data.rtt}ms`
        );
      } else {
        setError(data.error || 'Server info request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handlePing();
    }
  };

  return (
    <ProtocolClientLayout title="Riak Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="riak-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="riak-node.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="riak-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 8087 (Riak PBC port)"
            error={errors.port}
          />
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handlePing}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Ping Riak node"
          >
            Ping
          </ActionButton>

          <button
            onClick={handleInfo}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="Get Riak server info"
          >
            Server Info
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Riak Protocol"
          description="Riak KV is a distributed NoSQL key-value database that uses a Protocol Buffers-based binary protocol over TCP port 8087. Messages are length-prefixed with a 1-byte message code. The Ping operation (code 1/2) verifies node health, while GetServerInfo (code 7/8) returns the node name and version."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Protocol Details</h3>
          <div className="grid gap-2 text-xs text-slate-400">
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Message Format</p>
              <pre className="font-mono text-[11px] leading-relaxed">
{`[4-byte length (big-endian)][1-byte msg code][optional protobuf payload]
Length = sizeof(msg code) + sizeof(payload)`}
              </pre>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Key Message Codes</p>
              <p>1 = PingReq, 2 = PingResp, 7 = GetServerInfoReq, 8 = GetServerInfoResp, 0 = ErrorResp</p>
            </div>
            <p className="mt-2">
              Riak's PBC port (8087) is the Protocol Buffers Client interface, distinct from the HTTP
              API port (8098). The PBC interface is faster for programmatic access but uses a binary format.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
