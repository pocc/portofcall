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

interface EchoClientProps {
  onBack: () => void;
}

export default function EchoClient({ onBack }: EchoClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('7');
  const [message, setMessage] = useState('Hello, ECHO!');
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
      const response = await fetch('/api/echo/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          message,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        sent?: string;
        received?: string;
        match?: boolean;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const matchIcon = data.match ? '✅' : '❌';
        const matchStatus = data.match ? 'MATCHED' : 'MISMATCH';

        setResult(
          `${matchIcon} Echo ${matchStatus}\n\n` +
          `Sent:     "${data.sent}"\n` +
          `Received: "${data.received}"\n` +
          `RTT:      ${data.rtt}ms\n\n` +
          (data.match ?
            'The server correctly echoed back your message!' :
            'Warning: Received data does not match sent data')
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
    <ProtocolClientLayout title="ECHO Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Echo || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="echo-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="echo.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="echo-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 7 (standard ECHO port)"
            error={errors.port}
          />

          <div className="md:col-span-2">
            <FormField
              id="echo-message"
              label="Message to Echo"
              type="text"
              value={message}
              onChange={setMessage}
              onKeyDown={handleKeyDown}
              placeholder="Type any message to send..."
              required
              helpText="The server should echo this exact message back"
              error={errors.message}
            />
          </div>
        </div>

        <ActionButton
          onClick={handleTest}
          disabled={loading || !host || !port || !message}
          loading={loading}
          ariaLabel="Test ECHO connection"
        >
          Test Echo
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About ECHO Protocol"
          description="ECHO (RFC 862) is the simplest TCP protocol. The server echoes back any data it receives, making it perfect for network connectivity testing, latency measurement, and firewall verification. Standard port is 7."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Common ECHO Servers</h3>
          <div className="grid gap-2">
            <button
              onClick={() => {
                setHost('tcpbin.com');
                setPort('4242');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">tcpbin.com:4242</span>
              <span className="ml-2 text-slate-400">- TCP testing service</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              💡 <strong>Note:</strong> Many ISPs and cloud providers block port 7 for security.
              Use tcpbin.com:4242 or set up your own ECHO server for testing.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
