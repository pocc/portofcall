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
  const [message, setMessage] = useState('Hello, Discard!');
  const [repeatCount, setRepeatCount] = useState('1');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    message: [validationRules.required('Message is required')],
  });

  const handleTest = async () => {
    const isValid = validateAll({ host, port, message });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/discard/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          message,
          repeatCount: parseInt(repeatCount) || 1,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        bytesSent?: number;
        sendCount?: number;
        elapsed?: number;
        throughputBps?: number;
        noResponse?: boolean;
      };

      if (response.ok && data.success) {
        const statusIcon = data.noResponse ? '✅' : '⚠️';
        const statusText = data.noResponse
          ? 'DISCARDED (no response — correct behavior)'
          : 'WARNING: Server sent data back';

        const throughput = data.throughputBps && data.throughputBps > 0
          ? formatThroughput(data.throughputBps)
          : 'N/A';

        setResult(
          `${statusIcon} ${statusText}\n\n` +
          `Bytes Sent:  ${data.bytesSent?.toLocaleString()} bytes\n` +
          `Send Count:  ${data.sendCount}x\n` +
          `Elapsed:     ${data.elapsed}ms\n` +
          `Throughput:  ${throughput}\n\n` +
          (data.noResponse
            ? 'The server accepted and silently discarded all data.'
            : 'The server unexpectedly sent data back — it may not be a compliant Discard service.')
        );
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
    if (e.key === 'Enter' && !loading && host && port && message) {
      handleTest();
    }
  };

  return (
    <ProtocolClientLayout title="DISCARD Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="discard-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="discard.example.com"
            required
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
            helpText="Default: 9 (standard DISCARD port)"
            error={errors.port}
          />

          <div className="md:col-span-2">
            <FormField
              id="discard-message"
              label="Data to Discard"
              type="text"
              value={message}
              onChange={setMessage}
              onKeyDown={handleKeyDown}
              placeholder="Type any data to send into the void..."
              required
              helpText="This data will be sent and silently discarded by the server"
              error={errors.message}
            />
          </div>

          <FormField
            id="discard-repeat"
            label="Repeat Count"
            type="number"
            value={repeatCount}
            onChange={setRepeatCount}
            onKeyDown={handleKeyDown}
            min="1"
            max="1000"
            helpText="Send the message this many times (1-1000)"
          />
        </div>

        <ActionButton
          onClick={handleTest}
          disabled={loading || !host || !port || !message}
          loading={loading}
          ariaLabel="Test DISCARD connection"
        >
          Send to Void
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About DISCARD Protocol"
          description="DISCARD (RFC 863) is a simple TCP protocol where the server accepts any data and silently discards it. No response is ever sent back. It's useful for bandwidth testing, connection verification, and as a network data sink. Standard port is 9."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Common DISCARD Servers</h3>
          <div className="grid gap-2">
            <button
              onClick={() => {
                setHost('tcpbin.com');
                setPort('9');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">tcpbin.com:9</span>
              <span className="ml-2 text-slate-400">- TCP testing service</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              Note: Many ISPs and cloud providers block port 9 for security.
              Set up your own Discard server or use an alternative port for testing.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}

function formatThroughput(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} MB/s`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(2)} KB/s`;
  return `${bps} B/s`;
}
