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

interface LPDClientProps {
  onBack: () => void;
}

export default function LPDClient({ onBack }: LPDClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('515');
  const [printer, setPrinter] = useState('lp');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleProbe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/lpd/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          printer: printer || 'lp',
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        printer?: string;
        connectTimeMs?: number;
        totalTimeMs?: number;
        queueState?: string;
        responseBytes?: number;
        protocol?: string;
        rfc?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `LPD Server Probe Results\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `Printer: ${data.printer}\n`;
        resultText += `Protocol: ${data.protocol} (${data.rfc})\n`;
        resultText += `Connect Time: ${data.connectTimeMs}ms\n`;
        resultText += `Total Time: ${data.totalTimeMs}ms\n`;
        resultText += `Response Size: ${data.responseBytes} bytes\n\n`;
        resultText += `Queue State (short format):\n`;
        resultText += `${'-'.repeat(40)}\n`;
        resultText += data.queueState || '(no data)';

        setResult(resultText);
      } else {
        setError(data.error || 'Failed to probe LPD server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to probe LPD server');
    } finally {
      setLoading(false);
    }
  };

  const handleQueue = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/lpd/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          printer: printer || 'lp',
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        printer?: string;
        totalTimeMs?: number;
        queueListing?: string;
        jobs?: Array<{ rank?: string; owner?: string; jobId?: string; files?: string; size?: string; raw: string }>;
        jobCount?: number;
        responseBytes?: number;
        format?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `LPD Queue Listing (Long Format)\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Printer: ${data.printer} @ ${data.host}:${data.port}\n`;
        resultText += `Total Time: ${data.totalTimeMs}ms\n`;
        resultText += `Response Size: ${data.responseBytes} bytes\n`;
        resultText += `Jobs Found: ${data.jobCount}\n\n`;
        resultText += `Queue Output:\n`;
        resultText += `${'-'.repeat(40)}\n`;
        resultText += data.queueListing || '(empty queue)';

        setResult(resultText);
      } else {
        setError(data.error || 'Failed to list LPD queue');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list LPD queue');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="LPD Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.LPD || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="LPD Server Configuration" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="lpd-host"
            label="LPD Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="print-server.local"
            required
            helpText="Hostname or IP of the LPD print server"
            error={errors.host}
          />

          <FormField
            id="lpd-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 515 (standard LPD port)"
            error={errors.port}
          />

          <FormField
            id="lpd-printer"
            label="Printer Queue Name"
            type="text"
            value={printer}
            onChange={setPrinter}
            onKeyDown={handleKeyDown}
            placeholder="lp"
            helpText="Printer queue name (default: lp)"
          />
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Probe LPD server for short queue state"
          >
            Probe Server
          </ActionButton>

          <button
            onClick={handleQueue}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="List full queue state from LPD server"
          >
            {loading ? 'Loading...' : 'List Queue'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About LPD Protocol"
          description="LPD (Line Printer Daemon, RFC 1179, 1990) is the original Unix network printing protocol. It uses simple single-byte commands over TCP port 515 to submit print jobs and query queue status. While largely superseded by IPP/CUPS, LPD is still found on many network printers and legacy systems."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Common Printer Queue Names</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {['lp', 'raw', 'printer', 'laser', 'ps', 'pcl'].map((name) => (
              <button
                key={name}
                onClick={() => setPrinter(name)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-blue-400">{name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">LPD Command Reference</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Command</th>
                  <th className="text-left py-2 px-2 text-slate-300">Byte</th>
                  <th className="text-left py-2 px-2 text-slate-300">Description</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Print Jobs</td>
                  <td className="py-2 px-2 font-mono">0x01</td>
                  <td className="py-2 px-2">Start printing any waiting jobs</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Receive Job</td>
                  <td className="py-2 px-2 font-mono">0x02</td>
                  <td className="py-2 px-2">Submit a new print job</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Short Queue</td>
                  <td className="py-2 px-2 font-mono">0x03</td>
                  <td className="py-2 px-2">Get queue state (short format)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Long Queue</td>
                  <td className="py-2 px-2 font-mono">0x04</td>
                  <td className="py-2 px-2">Get queue state (long/verbose format)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Remove Jobs</td>
                  <td className="py-2 px-2 font-mono">0x05</td>
                  <td className="py-2 px-2">Remove print jobs from queue</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Network Printing Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Protocol</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Type</th>
                  <th className="text-left py-2 px-2 text-slate-300">Status</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">LPD/LPR</td>
                  <td className="py-2 px-2 font-mono">515</td>
                  <td className="py-2 px-2">Queue-based</td>
                  <td className="py-2 px-2 text-yellow-400">Legacy</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">IPP/CUPS</td>
                  <td className="py-2 px-2 font-mono">631</td>
                  <td className="py-2 px-2">HTTP-based</td>
                  <td className="py-2 px-2 text-green-400">Active</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">JetDirect</td>
                  <td className="py-2 px-2 font-mono">9100</td>
                  <td className="py-2 px-2">Raw/PJL</td>
                  <td className="py-2 px-2 text-green-400">Active</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">SMB Print</td>
                  <td className="py-2 px-2 font-mono">445</td>
                  <td className="py-2 px-2">Windows sharing</td>
                  <td className="py-2 px-2 text-green-400">Active</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
