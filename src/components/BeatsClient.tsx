import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface BeatsClientProps {
  onBack: () => void;
}

export default function BeatsClient({ onBack }: BeatsClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5044');
  const [tag, setTag] = useState('test');
  const [message, setMessage] = useState('Hello from Port of Call');
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
      const response = await fetch('/api/beats/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          events: [{ message, tags: [tag], '@timestamp': new Date().toISOString() }],
          windowSize: 10,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        acknowledged?: number;
        eventsSent?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(
          `Beats/Lumberjack v2 — ${data.host}:${data.port}\n\n` +
          `Events sent:  ${data.eventsSent}\n` +
          `Acknowledged: ${data.acknowledged}\n` +
          `RTT:          ${data.rtt}ms\n`
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
    <ProtocolClientLayout title="Beats Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Logstash / Elasticsearch Target" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="beats-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="logstash.example.com"
            required
            error={errors.host}
          />
          <FormField
            id="beats-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5044 (Beats input)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Event" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="beats-message"
            label="Message"
            type="text"
            value={message}
            onChange={setMessage}
            onKeyDown={handleKeyDown}
            placeholder="Log event message"
          />
          <FormField
            id="beats-tag"
            label="Tag"
            type="text"
            value={tag}
            onChange={setTag}
            onKeyDown={handleKeyDown}
            placeholder="test"
            helpText="Event tag label"
          />
        </div>

        <ActionButton
          onClick={handleSend}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Send Beats event"
        >
          Send Event
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Elastic Beats (Lumberjack v2)"
          description="The Beats protocol (Lumberjack v2) is a binary framing protocol used by Elastic Beats (Filebeat, Metricbeat, Winlogbeat) to ship logs and metrics to Logstash or Elasticsearch. Each batch starts with a WINDOW frame announcing the window size, followed by compressed JSON DATA frames. The server acknowledges with an ACK frame containing the highest sequence number processed. Port 5044 is the standard Logstash Beats input port."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
