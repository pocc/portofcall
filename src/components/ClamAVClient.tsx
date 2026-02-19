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

interface ClamAVClientProps {
  onBack: () => void;
}

export default function ClamAVClient({ onBack }: ClamAVClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3310');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const sendCommand = async (endpoint: string, label: string) => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch(`/api/clamav/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as Record<string, unknown>;

      if (response.ok && data.success) {
        let resultText = `ClamAV ${label}\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;

        if (endpoint === 'ping') {
          resultText += `Status: ${(data as { alive?: boolean }).alive ? 'ALIVE (PONG received)' : 'No PONG response'}\n`;
          resultText += `Response: ${data.response}\n`;
          resultText += `Connect Time: ${data.connectTimeMs}ms\n`;
          resultText += `Total Time: ${data.totalTimeMs}ms\n`;
        } else if (endpoint === 'version') {
          const vData = data as { version?: string; databaseVersion?: string; databaseDate?: string; raw?: string; totalTimeMs?: number };
          resultText += `Version: ${vData.version || 'unknown'}\n`;
          if (vData.databaseVersion) {
            resultText += `DB Version: ${vData.databaseVersion}\n`;
          }
          if (vData.databaseDate) {
            resultText += `DB Date: ${vData.databaseDate}\n`;
          }
          resultText += `Total Time: ${vData.totalTimeMs}ms\n`;
          resultText += `\nRaw Response:\n${'-'.repeat(40)}\n${vData.raw}`;
        } else if (endpoint === 'stats') {
          const sData = data as { stats?: string; parsed?: { pools?: number; threads?: string; queueLength?: number; memoryUsed?: string }; totalTimeMs?: number; responseBytes?: number };
          resultText += `Total Time: ${sData.totalTimeMs}ms\n`;
          resultText += `Response Size: ${sData.responseBytes} bytes\n`;

          if (sData.parsed) {
            resultText += `\nParsed Stats:\n`;
            if (sData.parsed.pools !== undefined) resultText += `  Thread Pools: ${sData.parsed.pools}\n`;
            if (sData.parsed.threads) resultText += `  Threads: ${sData.parsed.threads}\n`;
            if (sData.parsed.queueLength !== undefined) resultText += `  Queue Length: ${sData.parsed.queueLength}\n`;
            if (sData.parsed.memoryUsed) resultText += `  Memory Used: ${sData.parsed.memoryUsed}\n`;
          }

          resultText += `\nRaw Output:\n${'-'.repeat(40)}\n${sData.stats}`;
        }

        setResult(resultText);
      } else {
        setError((data.error as string) || `Failed to ${label.toLowerCase()}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${label.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      sendCommand('ping', 'Ping');
    }
  };

  return (
    <ProtocolClientLayout title="ClamAV Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.ClamAV || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="ClamAV Daemon Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="clamav-host"
            label="ClamAV Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="clamav-server.local"
            required
            helpText="Hostname or IP of the ClamAV daemon (clamd)"
            error={errors.host}
          />

          <FormField
            id="clamav-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 3310 (standard clamd port)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Commands" color="green" />

        <div className="flex flex-wrap gap-3 mb-6">
          <ActionButton
            onClick={() => sendCommand('ping', 'Ping')}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Send PING to ClamAV daemon"
          >
            PING
          </ActionButton>

          <button
            onClick={() => sendCommand('version', 'Version')}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Get ClamAV version information"
          >
            {loading ? 'Loading...' : 'VERSION'}
          </button>

          <button
            onClick={() => sendCommand('stats', 'Stats')}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500"
            aria-label="Get ClamAV scanning statistics"
          >
            {loading ? 'Loading...' : 'STATS'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About ClamAV Protocol"
          description="ClamAV is an open-source antivirus engine. The clamd daemon listens on TCP port 3310 and accepts simple text commands for virus scanning, version checking, and statistics. Commands use newline-terminated variants (nPING, nVERSION, nSTATS) with null-byte terminated responses."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">ClamAV Command Reference</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Command</th>
                  <th className="text-left py-2 px-2 text-slate-300">Response</th>
                  <th className="text-left py-2 px-2 text-slate-300">Description</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono">PING</td>
                  <td className="py-2 px-2 font-mono">PONG</td>
                  <td className="py-2 px-2">Check if daemon is alive</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono">VERSION</td>
                  <td className="py-2 px-2 font-mono">ClamAV x.y.z/db/date</td>
                  <td className="py-2 px-2">Get version and database info</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono">STATS</td>
                  <td className="py-2 px-2">(multi-line)</td>
                  <td className="py-2 px-2">Thread pool and queue statistics</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono">RELOAD</td>
                  <td className="py-2 px-2 font-mono">RELOADING</td>
                  <td className="py-2 px-2">Reload virus definitions</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono">INSTREAM</td>
                  <td className="py-2 px-2">(scan result)</td>
                  <td className="py-2 px-2">Stream data for scanning</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Version String Format</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs">
            <div className="text-slate-400 mb-1">Typical response:</div>
            <div className="text-slate-200">ClamAV 1.3.0/27168/Thu Jan 18 09:30:45 2024</div>
          </div>
          <div className="mt-2 text-xs text-slate-400 space-y-1">
            <div><span className="text-blue-400">ClamAV 1.3.0</span> - Engine version</div>
            <div><span className="text-blue-400">27168</span> - Virus database version</div>
            <div><span className="text-blue-400">Thu Jan 18 09:30:45 2024</span> - Database publish date</div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              <strong>Note:</strong> ClamAV daemons are typically only accessible on internal networks.
              Public-facing clamd instances are rare and may reject connections from untrusted IPs.
              This client performs read-only operations (PING, VERSION, STATS) only.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
