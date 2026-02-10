import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface DaytimeClientProps {
  onBack: () => void;
}

export default function DaytimeClient({ onBack }: DaytimeClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('13');
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
      const response = await fetch('/api/daytime/get', {
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
        time?: string;
        localTime?: string;
        offsetMs?: number;
        remoteTimestamp?: number;
        localTimestamp?: number;
      };

      if (response.ok && data.success) {
        let resultText = `📡 Remote Time:\n${data.time}\n\n`;
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
        } else {
          resultText += `\n⚠️ Unable to parse time format for comparison`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Failed to get time from Daytime server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get time from Daytime server');
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
    setPort('13');
  };

  return (
    <ProtocolClientLayout title="Daytime Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Daytime Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="daytime-host"
            label="Daytime Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="time.nist.gov"
            required
            helpText="Server that provides Daytime service on port 13"
            error={errors.host}
          />

          <FormField
            id="daytime-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 13 (standard Daytime port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleGetTime}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Get time from Daytime server"
        >
          Get Time
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Daytime Protocol"
          description="Daytime (RFC 867, 1983) is the simplest network protocol. Server sends current date/time as ASCII text immediately upon connection. No commands needed! Format varies by server. Largely obsolete - use NTP for accurate time synchronization."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Public Daytime Servers</h3>
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
              ⚠️ <strong>Note:</strong> Many public time servers have disabled port 13 (Daytime)
              in favor of NTP (port 123). This protocol is largely obsolete but useful for
              educational purposes and testing legacy systems.
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Common Time Formats</h3>
          <div className="space-y-2 text-xs">
            <div className="bg-slate-700 px-3 py-2 rounded font-mono">
              <div className="text-slate-400 mb-1">NIST Format:</div>
              <div className="text-slate-200">60336 24-01-15 22:30:45 50 0 0 895.5 UTC(NIST) *</div>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded font-mono">
              <div className="text-slate-400 mb-1">Standard Format:</div>
              <div className="text-slate-200">Sunday, January 15, 2024 14:30:45-PST</div>
            </div>
            <div className="bg-slate-700 px-3 py-2 rounded font-mono">
              <div className="text-slate-400 mb-1">ISO Format:</div>
              <div className="text-slate-200">2024-01-15 14:30:45</div>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Time Protocol Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Protocol</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Accuracy</th>
                  <th className="text-left py-2 px-2 text-slate-300">Status</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Daytime</td>
                  <td className="py-2 px-2 font-mono">13</td>
                  <td className="py-2 px-2">~1 second</td>
                  <td className="py-2 px-2 text-yellow-400">Obsolete</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Time</td>
                  <td className="py-2 px-2 font-mono">37</td>
                  <td className="py-2 px-2">~1 second</td>
                  <td className="py-2 px-2 text-yellow-400">Obsolete</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">NTP</td>
                  <td className="py-2 px-2 font-mono">123</td>
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
