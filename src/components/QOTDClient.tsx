import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface QOTDClientProps {
  onBack: () => void;
}

export default function QOTDClient({ onBack }: QOTDClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('17');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleGetQuote = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/qotd/fetch', {
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
        quote?: string;
        byteLength?: number;
        rtt?: number;
      };

      if (response.ok && data.success && data.quote) {
        const lines = [
          `Quote of the Day`,
          `Server: ${data.host}:${data.port}`,
          `${'='.repeat(60)}`,
          '',
          data.quote,
          '',
          `${'='.repeat(60)}`,
          `Response: ${data.byteLength} bytes in ${data.rtt}ms`,
        ];
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to get quote');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get quote');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleGetQuote();
    }
  };

  return (
    <ProtocolClientLayout title="QOTD Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="QOTD Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="qotd-host"
            label="QOTD Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="djxmmx.net"
            required
            helpText="Server running QOTD service on port 17"
            error={errors.host}
          />

          <FormField
            id="qotd-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 17 (standard QOTD port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleGetQuote}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Get Quote of the Day"
        >
          Get Quote
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About QOTD Protocol"
          description="Quote of the Day (RFC 865, 1983) is one of the original 'simple service' protocols. Upon TCP connection, the server immediately sends a short quote (max 512 chars) and closes the connection. No commands needed. This completes the classic RFC simple services: Echo (862), Discard (863), Chargen (864), QOTD (865), Daytime (867), Time (868)."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Classic Simple Service RFCs</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Protocol</th>
                  <th className="text-left py-2 px-2 text-slate-300">RFC</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Function</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Echo</td>
                  <td className="py-2 px-2 font-mono">862</td>
                  <td className="py-2 px-2 font-mono">7</td>
                  <td className="py-2 px-2">Returns what you send</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Chargen</td>
                  <td className="py-2 px-2 font-mono">864</td>
                  <td className="py-2 px-2 font-mono">19</td>
                  <td className="py-2 px-2">Generates character stream</td>
                </tr>
                <tr className="border-b border-slate-700 bg-blue-900/20">
                  <td className="py-2 px-2 text-blue-400 font-semibold">QOTD</td>
                  <td className="py-2 px-2 font-mono text-blue-400">865</td>
                  <td className="py-2 px-2 font-mono text-blue-400">17</td>
                  <td className="py-2 px-2 text-blue-400">Random quote (this one)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Daytime</td>
                  <td className="py-2 px-2 font-mono">867</td>
                  <td className="py-2 px-2 font-mono">13</td>
                  <td className="py-2 px-2">Human-readable time</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Time</td>
                  <td className="py-2 px-2 font-mono">868</td>
                  <td className="py-2 px-2 font-mono">37</td>
                  <td className="py-2 px-2">Binary 32-bit time</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              <strong>Note:</strong> QOTD servers are rare today. Most ISPs block port 17.
              This protocol is primarily useful for educational purposes, testing legacy
              systems, and internet archaeology. Some hobbyist servers still run QOTD.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
