import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface MSRPClientProps {
  onBack: () => void;
}

export default function MSRPClient({ onBack }: MSRPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2855');
  const [toPath, setToPath] = useState('');
  const [fromPath, setFromPath] = useState('');
  const [content, setContent] = useState('Hello from Port of Call');
  const [contentType, setContentType] = useState('text/plain');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleSend = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/msrp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          toPath: toPath || `msrp://${host}:${port}/session;tcp`,
          fromPath: fromPath || 'msrp://portofcall.example.com/client;tcp',
          content,
          contentType,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        statusText?: string;
        transactionId?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `MSRP SEND — ${host}:${port}\n\n` +
          `Status:         ${data.statusCode} ${data.statusText}\n` +
          `Transaction ID: ${data.transactionId}\n` +
          `RTT:            ${data.rtt}ms\n`
        );
      } else {
        setError(data.error || 'Send failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleSend();
    }
  };

  return (
    <ProtocolClientLayout title="MSRP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="MSRP Relay / Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="msrp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="msrp-relay.example.com"
            required
            error={errors.host}
          />
          <FormField
            id="msrp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2855 (MSRP)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Message" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="msrp-to-path"
            label="To-Path"
            type="text"
            value={toPath}
            onChange={setToPath}
            onKeyDown={handleKeyDown}
            placeholder={`msrp://${host || 'host'}:${port}/session;tcp`}
            helpText="MSRP URI of the destination (auto-generated if empty)"
          />
          <FormField
            id="msrp-from-path"
            label="From-Path"
            type="text"
            value={fromPath}
            onChange={setFromPath}
            onKeyDown={handleKeyDown}
            placeholder="msrp://portofcall.example.com/client;tcp"
            helpText="MSRP URI of the sender (auto-generated if empty)"
          />
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-2">
            <FormField
              id="msrp-content"
              label="Message Content"
              type="text"
              value={content}
              onChange={setContent}
              onKeyDown={handleKeyDown}
              placeholder="Hello from Port of Call"
            />
          </div>
          <FormField
            id="msrp-content-type"
            label="Content-Type"
            type="text"
            value={contentType}
            onChange={setContentType}
            onKeyDown={handleKeyDown}
            placeholder="text/plain"
          />
        </div>

        <ActionButton
          onClick={handleSend}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Send MSRP message"
        >
          Send MSRP Message
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About MSRP (Message Session Relay Protocol)"
          description="MSRP (RFC 4975) is a text-based protocol used in SIP sessions for instant messaging and file transfer. Each message is a SEND request with To-Path, From-Path, Message-ID, Byte-Range, and Content-Type headers. Large messages are chunked using the Byte-Range header. The server responds with a transaction-matched 200 OK. MSRP is commonly used in IMS/VoLTE deployments and WebRTC applications."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
