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

interface IPPClientProps {
  onBack: () => void;
}

export default function IPPClient({ onBack }: IPPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('631');
  const [printerUri, setPrinterUri] = useState('');
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
      const response = await fetch('/api/ipp/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          printerUri: printerUri || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        version?: string;
        statusCode?: number;
        statusMessage?: string;
        rawHttpStatus?: string;
        attributes?: Array<{ name: string; value: string }>;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let output = `IPP Server Detected\n\n`;
        output += `HTTP Status: ${data.rawHttpStatus}\n`;

        if (data.version) {
          output += `IPP Version: ${data.version}\n`;
        }
        if (data.statusMessage) {
          output += `IPP Status:  ${data.statusMessage}\n`;
        }
        output += `RTT:         ${data.rtt}ms\n`;

        if (data.attributes && data.attributes.length > 0) {
          output += `\nPrinter Attributes (${data.attributes.length}):\n`;
          output += '─'.repeat(50) + '\n';
          for (const attr of data.attributes) {
            const value = attr.value.length > 80 ? attr.value.substring(0, 77) + '...' : attr.value;
            output += `  ${attr.name}: ${value}\n`;
          }
        }

        setResult(output);
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
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="IPP Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.IPP || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ipp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="printer.local or 192.168.1.100"
            required
            error={errors.host}
          />

          <FormField
            id="ipp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 631 (standard IPP/CUPS port)"
            error={errors.port}
          />

          <div className="md:col-span-2">
            <FormField
              id="ipp-uri"
              label="Printer URI (optional)"
              type="text"
              value={printerUri}
              onChange={setPrinterUri}
              onKeyDown={handleKeyDown}
              placeholder="ipp://host:631/ipp/print (auto-generated if empty)"
              helpText="Custom printer URI. Leave empty for default /ipp/print path"
            />
          </div>
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe IPP printer"
        >
          Probe Printer
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About IPP (Internet Printing Protocol)"
          description="IPP (RFC 8011) is the Internet Printing Protocol used by CUPS on macOS and Linux. It runs over HTTP on port 631 and enables discovering printer capabilities, submitting print jobs, and monitoring print queues. Every Mac and most Linux systems run a CUPS server on localhost:631."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Common IPP Targets</h3>
          <div className="grid gap-2">
            <button
              onClick={() => {
                setHost('localhost');
                setPort('631');
                setPrinterUri('');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:631</span>
              <span className="ml-2 text-slate-400">- Local CUPS server (macOS/Linux)</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              <strong>Note:</strong> IPP servers are typically on local networks. Network printers
              often expose IPP on port 631. CUPS admin interface is at http://localhost:631 in a browser.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
