import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface DiscardClientProps {
  onBack: () => void;
}

export default function DiscardClient({ onBack }: DiscardClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9');
  const [data, setData] = useState('Hello from Port of Call!\n');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [stats, setStats] = useState<{
    bytesSent: number;
    duration: number;
    throughput: string;
  } | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    data: [validationRules.required('Data is required')],
  });

  const handleSendData = async () => {
    const isValid = validateAll({ host, port, data });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setStats(null);

    try {
      const response = await fetch('/api/discard/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          data,
          timeout: 10000,
        }),
      });

      const responseData = await response.json() as {
        success?: boolean;
        error?: string;
        bytesSent?: number;
        duration?: number;
        throughput?: string;
      };

      if (response.ok && responseData.success) {
        setResult('✓ Data sent successfully! Server accepted and discarded the data.');

        if (responseData.bytesSent !== undefined && 
            responseData.duration !== undefined && 
            responseData.throughput) {
          setStats({
            bytesSent: responseData.bytesSent,
            duration: responseData.duration,
            throughput: responseData.throughput,
          });
        }
      } else {
        setError(responseData.error || 'Failed to send data to Discard server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send data to Discard server');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey && !loading && host && port && data) {
      handleSendData();
    }
  };

  const handleExampleServer = (serverHost: string, exampleData: string) => {
    setHost(serverHost);
    setPort('9');
    setData(exampleData);
  };

  return (
    <ProtocolClientLayout title="Discard Protocol Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Discard Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="discard-host"
            label="Discard Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="discard.example.com"
            required
            helpText="Server running Discard on port 9"
            error={errors.host}
          />

          <FormField
            id="discard-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 9 (standard Discard port)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Data to Send" />

        <div className="mb-6">
          <label htmlFor="discard-data" className="block text-sm font-medium text-slate-300 mb-2">
            Data <span className="text-red-400">*</span>
          </label>
          <textarea
            id="discard-data"
            value={data}
            onChange={(e) => setData(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={6}
            placeholder="Enter data to send..."
            required
          />
          <div className="flex justify-between items-center mt-2">
            <p className="text-xs text-slate-400">
              Server will silently discard this data (no response)
            </p>
            <p className="text-xs text-slate-400">
              {data.length.toLocaleString()} characters ({new Blob([data]).size.toLocaleString()} bytes)
            </p>
          </div>
          {errors.data && (
            <p className="mt-1 text-xs text-red-400">{errors.data}</p>
          )}
        </div>

        <ActionButton
          onClick={handleSendData}
          disabled={loading || !host || !port || !data}
          loading={loading}
          ariaLabel="Send data to Discard server"
        >
          Send Data (Ctrl+Enter)
        </ActionButton>

        {stats && (
          <div className="mt-6 bg-slate-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Statistics</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-slate-400">Bytes Sent</div>
                <div className="text-lg font-bold text-blue-400">{stats.bytesSent.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Duration</div>
                <div className="text-lg font-bold text-green-400">{(stats.duration / 1000).toFixed(2)}s</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Throughput</div>
                <div className="text-lg font-bold text-purple-400">{stats.throughput}</div>
              </div>
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Discard Protocol"
          description="Discard (RFC 863, 1983) accepts TCP data and silently discards it without any response. Used for network connectivity testing, throughput measurement, and fire-and-forget data sinks. Now obsolete and often disabled due to security risks."
          showKeyboardShortcut={false}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Configurations</h3>
          <div className="grid gap-2">
            <button
              onClick={() => handleExampleServer('localhost', 'Hello from Port of Call!\n')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:9</span>
              <span className="ml-2 text-slate-400">- Simple greeting (28 bytes)</span>
            </button>
            <button
              onClick={() => handleExampleServer('localhost', 'A'.repeat(1024))}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:9</span>
              <span className="ml-2 text-slate-400">- 1KB of data (throughput test)</span>
            </button>
            <button
              onClick={() => handleExampleServer('localhost', 'A'.repeat(10240))}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:9</span>
              <span className="ml-2 text-slate-400">- 10KB of data (bandwidth test)</span>
            </button>
          </div>
          <div className="mt-4 bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              ⚠️ <strong>Note:</strong> Most public Discard servers have been disabled due to
              security risks. This protocol is obsolete but useful for educational purposes
              and local network testing.
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Technical Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol Type:</td>
                  <td className="py-2 px-2">Fire-and-forget (no server response)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Data Format:</td>
                  <td className="py-2 px-2">Any data (binary or text)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Server Behavior:</td>
                  <td className="py-2 px-2">Silently discards all received data</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Connection:</td>
                  <td className="py-2 px-2">TCP (reliable delivery to /dev/null)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Use Cases:</td>
                  <td className="py-2 px-2">Connectivity testing, throughput measurement, debugging</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">⚠️ Security Warning</h3>
          <div className="bg-red-900/20 border border-red-600/30 rounded-lg p-3">
            <p className="text-xs text-red-200 mb-2">
              <strong>Discard is a security risk</strong> and has been disabled on most modern systems.
            </p>
            <ul className="text-xs text-red-200 list-disc list-inside space-y-1">
              <li>No authentication or encryption</li>
              <li>Can be used for connection exhaustion attacks</li>
              <li>Wastes server resources processing discarded data</li>
              <li>Port 9 is typically filtered by firewalls</li>
              <li>Part of the "insecure services" group (Echo, Discard, Chargen, Daytime)</li>
              <li><strong>Do not expose Discard servers to the public internet</strong></li>
            </ul>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Historical Context</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p>
              📜 <strong>1983:</strong> Discard protocol created (RFC 863)
            </p>
            <p>
              🌐 <strong>1980s-1990s:</strong> Used for basic network testing
            </p>
            <p>
              🔧 <strong>Purpose:</strong> Test TCP connectivity without needing to process responses
            </p>
            <p>
              ⚠️ <strong>2000s:</strong> Identified as resource waste and attack vector
            </p>
            <p>
              🔒 <strong>2010s:</strong> Disabled by default on modern systems
            </p>
            <p>
              📚 <strong>Today:</strong> Educational value, protocol archaeology, replaced by better tools
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Modern Alternatives</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p>
              Instead of Discard, modern systems use:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong>/dev/null</strong> - Local data sink on Unix systems</li>
              <li><strong>nc -l</strong> (netcat) - Temporary TCP listeners for testing</li>
              <li><strong>tcpdump/Wireshark</strong> - Packet capture for network analysis</li>
              <li><strong>iperf</strong> - Modern bandwidth measurement tool</li>
              <li><strong>curl/wget</strong> - HTTP-based connectivity testing</li>
            </ul>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
