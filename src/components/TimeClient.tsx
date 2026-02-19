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

interface TimeClientProps {
  onBack: () => void;
}

const TIME_EPOCH_OFFSET = 2208988800;

export default function TimeClient({ onBack }: TimeClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('37');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleGetTime = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/time/get', {
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
        raw?: number;
        unixTimestamp?: number;
        date?: string;
        localTime?: string;
        offsetMs?: number;
      };

      if (response.ok && data.success) {
        let resultText = `🔢 Raw Time Value (32-bit):\n${data.raw?.toLocaleString()}\n\n`;
        resultText += `⏱️ Unix Timestamp:\n${data.unixTimestamp?.toLocaleString()} seconds\n\n`;
        resultText += `📡 Remote Time:\n${data.date}\n\n`;
        resultText += `🕐 Local Time:\n${data.localTime}\n`;

        if (data.offsetMs !== undefined && data.offsetMs !== null) {
          const offsetAbs = Math.abs(data.offsetMs);
          const offsetSign = data.offsetMs >= 0 ? '+' : '-';

          let offsetStr: string;
          if (offsetAbs < 1000) {
            offsetStr = `${offsetSign}${offsetAbs.toFixed(0)}ms`;
          } else {
            offsetStr = `${offsetSign}${(offsetAbs / 1000).toFixed(2)}s`;
          }

          resultText += `\n⏱️ Time Difference: ${offsetStr}\n`;

          if (Math.abs(data.offsetMs) < 500) {
            resultText += `✅ Clocks are synchronized (within 0.5s)`;
          } else {
            const direction = data.offsetMs > 0 ? 'behind' : 'ahead';
            resultText += `⚠️ Your clock is ${direction} by ${offsetStr}`;
          }
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Failed to get time from Time server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get time from Time server');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleGetTime();
    }
  };

  const handleExampleServer = (serverHost: string) => {
    setHost(serverHost);
    setPort('37');
  };

  return (
    <ProtocolClientLayout title="Time Protocol Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Time || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Time Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="time-host"
            label="Time Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="time.nist.gov"
            required
            helpText="Server that provides Time service on port 37"
            error={errors.host}
          />

          <FormField
            id="time-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 37 (standard Time port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleGetTime}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Get time from Time server"
        >
          Get Binary Time
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Time Protocol"
          description="Time (RFC 868, 1983) returns time as a 32-bit binary value representing seconds since 1900-01-01 00:00:00 UTC. Format: big-endian unsigned integer. Server sends 4 bytes immediately upon connection. Obsolete - use NTP for modern time sync."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Public Time Servers</h3>
          <div className="grid gap-2">
            <button
              onClick={() => handleExampleServer('time.nist.gov')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">time.nist.gov</span>
              <span className="ml-2 text-slate-400">- NIST (may be disabled)</span>
            </button>
            <button
              onClick={() => handleExampleServer('time-a.nist.gov')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">time-a.nist.gov</span>
              <span className="ml-2 text-slate-400">- NIST Server A</span>
            </button>
            <button
              onClick={() => handleExampleServer('time-b.nist.gov')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">time-b.nist.gov</span>
              <span className="ml-2 text-slate-400">- NIST Server B</span>
            </button>
          </div>
          <div className="mt-4 bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              ⚠️ <strong>Note:</strong> Many public time servers have disabled port 37 (Time Protocol)
              in favor of NTP (port 123). This protocol is obsolete but useful for educational purposes.
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Technical Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol Epoch:</td>
                  <td className="py-2 px-2">1900-01-01 00:00:00 UTC</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Unix Epoch:</td>
                  <td className="py-2 px-2">1970-01-01 00:00:00 UTC</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Offset:</td>
                  <td className="py-2 px-2 font-mono">{TIME_EPOCH_OFFSET.toLocaleString()} seconds (70 years)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Format:</td>
                  <td className="py-2 px-2">32-bit big-endian unsigned integer</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Precision:</td>
                  <td className="py-2 px-2">1 second (no subsecond resolution)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Max Date (Y2K36):</td>
                  <td className="py-2 px-2 text-red-400">2036-02-07 06:28:15 UTC (32-bit overflow!)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Binary Format Example</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs">
            <div className="text-slate-400 mb-2">Response (4 bytes, big-endian):</div>
            <pre className="text-slate-200">
{`Hex:     0xE9 0xA7 0xC6 0x40
Decimal: 3,920,873,024
- Offset: 2,208,988,800
= Unix:   1,711,884,224
= Date:   2024-03-31 12:30:24 UTC`}
            </pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">⚠️ Y2K36 Problem</h3>
          <div className="bg-red-900/20 border border-red-600/30 rounded-lg p-3">
            <p className="text-xs text-red-200 mb-2">
              <strong>32-bit Overflow Issue:</strong>
            </p>
            <ul className="text-xs text-red-200 list-disc list-inside space-y-1">
              <li>Max value: 4,294,967,295</li>
              <li>Overflow date: <strong>2036-02-07 06:28:15 UTC</strong></li>
              <li>After this date, Time Protocol wraps back to 1900!</li>
              <li>Similar to Y2K but for 32-bit timestamps</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Protocol</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Format</th>
                  <th className="text-left py-2 px-2 text-slate-300">Accuracy</th>
                  <th className="text-left py-2 px-2 text-slate-300">Status</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Time</td>
                  <td className="py-2 px-2 font-mono">37</td>
                  <td className="py-2 px-2">Binary (32-bit)</td>
                  <td className="py-2 px-2">~1 second</td>
                  <td className="py-2 px-2 text-yellow-400">Obsolete</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Daytime</td>
                  <td className="py-2 px-2 font-mono">13</td>
                  <td className="py-2 px-2">ASCII text</td>
                  <td className="py-2 px-2">~1 second</td>
                  <td className="py-2 px-2 text-yellow-400">Obsolete</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">NTP</td>
                  <td className="py-2 px-2 font-mono">123</td>
                  <td className="py-2 px-2">Binary (64-bit)</td>
                  <td className="py-2 px-2">Microseconds</td>
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
