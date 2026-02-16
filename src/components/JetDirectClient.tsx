import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface JetDirectClientProps {
  onBack: () => void;
}

export default function JetDirectClient({ onBack }: JetDirectClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9100');
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
      const response = await fetch('/api/jetdirect/connect', {
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
        rtt?: number;
        connectTime?: number;
        portOpen?: boolean;
        pjlSupported?: boolean;
        rawResponse?: string;
        printerInfo?: {
          model?: string;
          status?: string;
          statusCode?: string;
        };
      };

      if (response.ok && data.success) {
        let resultText = `Connected to JetDirect port!\n\n`;
        resultText += `Host:           ${data.host}:${data.port}\n`;
        resultText += `RTT:            ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;
        resultText += `Port Open:      ${data.portOpen ? 'Yes' : 'No'}\n`;
        resultText += `PJL Response:   ${data.pjlSupported ? 'Yes' : 'No (printer may not support PJL)'}\n`;

        if (data.printerInfo?.model) {
          resultText += `\n--- Printer Info ---\n`;
          resultText += `Model:          ${data.printerInfo.model}\n`;
          if (data.printerInfo.status) {
            resultText += `Status:         ${data.printerInfo.status}\n`;
          }
          if (data.printerInfo.statusCode) {
            resultText += `Status Code:    ${data.printerInfo.statusCode}\n`;
          }
        }

        if (data.rawResponse) {
          resultText += `\n--- Raw PJL Response ---\n`;
          resultText += data.rawResponse;
        }

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="JetDirect / Raw Print Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Printer Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="jetdirect-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="printer.local"
            required
            helpText="Network printer hostname or IP address"
            error={errors.host}
          />

          <FormField
            id="jetdirect-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 9100 (JetDirect), 9101/9102 for aux"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test JetDirect printer connection"
        >
          Test Connection (PJL Query)
        </ActionButton>

        <ResultDisplay result={result} error={error} />
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <HelpSection
          title="About JetDirect Protocol"
          description="HP JetDirect (port 9100) is the simplest network printing protocol — just connect and send raw print data. This client also sends PJL (Printer Job Language) queries to identify the printer model and status. Most network printers from HP, Zebra, Brother, and others support this protocol."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Connect</h3>
          <div className="grid gap-2">
            <button
              onClick={() => {
                setHost('localhost');
                setPort('9100');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:9100</span>
              <span className="ml-2 text-slate-400">- Local printer / virtual printer</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              Test with netcat as virtual printer:
              <code className="bg-slate-700 px-2 py-1 rounded mx-1">nc -l 9100</code>
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">Raw TCP (send data, close)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Port:</td>
                  <td className="py-2 px-2 font-mono">9100</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Status Query:</td>
                  <td className="py-2 px-2">PJL (Printer Job Language)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Print Formats:</td>
                  <td className="py-2 px-2">PCL, PostScript, ZPL, ESC/P, Plain Text</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Authentication:</td>
                  <td className="py-2 px-2">None (open port)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Feedback:</td>
                  <td className="py-2 px-2">PJL status (optional, not all printers)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Common JetDirect Ports</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Description</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">9100</td>
                  <td className="py-2 px-2">Primary JetDirect port (raw printing)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">9101</td>
                  <td className="py-2 px-2">Secondary / bidirectional channel</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">9102</td>
                  <td className="py-2 px-2">Tertiary channel</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-mono text-blue-400">515</td>
                  <td className="py-2 px-2">LPR/LPD (alternative print protocol)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              <strong>Note:</strong> JetDirect has no authentication. Any device that can reach port 9100
              can send print jobs. Network printers should be on isolated networks or behind firewalls.
              This tool only sends PJL status queries — it does <strong>not</strong> send print jobs.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
