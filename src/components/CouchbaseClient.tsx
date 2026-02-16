import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface CouchbaseClientProps {
  onBack: () => void;
}

export default function CouchbaseClient({ onBack }: CouchbaseClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('11210');
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
      const response = await fetch('/api/couchbase/ping', {
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
        opaque?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `Couchbase NOOP Ping: OK\n\n` +
          `Response: ${data.message}\n` +
          `Opaque:   ${data.opaque}\n` +
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

  const handleVersion = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/couchbase/version', {
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
        version?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `Couchbase Server Version\n\n` +
          `Version:  ${data.version || 'Unknown'}\n` +
          `RTT:      ${data.rtt}ms`
        );
      } else {
        setError(data.error || 'Version request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleStats = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/couchbase/stats', {
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
        stats?: Record<string, string>;
        statCount?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let statsOutput = `Couchbase Server Statistics (${data.statCount} items)\n\n`;
        if (data.stats) {
          const entries = Object.entries(data.stats);
          const keyWidth = Math.min(30, Math.max(...entries.map(([k]) => k.length)));
          for (const [key, value] of entries.slice(0, 50)) {
            statsOutput += `${key.padEnd(keyWidth)}  ${value}\n`;
          }
          if (entries.length > 50) {
            statsOutput += `\n... and ${entries.length - 50} more statistics`;
          }
        }
        statsOutput += `\nRTT: ${data.rtt}ms`;
        setResult(statsOutput);
      } else {
        setError(data.error || 'Stats request failed');
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
    <ProtocolClientLayout title="Couchbase Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="couchbase-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="couchbase-node.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="couchbase-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 11210 (Couchbase KV port)"
            error={errors.port}
          />
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handlePing}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Ping Couchbase node"
          >
            Ping
          </ActionButton>

          <button
            onClick={handleVersion}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="Get Couchbase server version"
          >
            Version
          </button>

          <button
            onClick={handleStats}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
            aria-label="Get Couchbase server statistics"
          >
            Stats
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Couchbase / Memcached Binary Protocol"
          description="Couchbase Server uses the memcached binary protocol over TCP port 11210 for key-value data operations. This protocol uses fixed 24-byte request/response headers with magic bytes (0x80 request, 0x81 response), opcodes, and optional key/value/extras bodies. NOOP tests connectivity, VERSION returns the server version string, and STAT retrieves server statistics as key-value pairs."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Protocol Details</h3>
          <div className="grid gap-2 text-xs text-slate-400">
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Binary Header Format (24 bytes)</p>
              <pre className="font-mono text-[11px] leading-relaxed">
{`[0x80/0x81 magic][opcode][key-len (2)][extras-len][data-type]
[status/vbucket (2)][body-len (4)][opaque (4)][CAS (8)]`}
              </pre>
            </div>
            <div className="bg-slate-700 rounded p-3">
              <p className="font-semibold text-slate-300 mb-1">Key Opcodes</p>
              <p>0x0a = NOOP (ping), 0x0b = VERSION, 0x10 = STAT, 0x00 = GET, 0x01 = SET</p>
            </div>
            <p className="mt-2">
              Port 11210 is the Couchbase KV Engine (memcached binary) port, distinct from port 8091
              (management REST API) and 8092/8093 (views/N1QL query). Standard memcached also supports
              this binary protocol on port 11211 alongside its text protocol.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
