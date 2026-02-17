import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface ActiveMQClientProps {
  onBack: () => void;
}

export default function ActiveMQClient({ onBack }: ActiveMQClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('61616');
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
      const response = await fetch('/api/activemq/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), timeout: 10000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        tcpLatency?: number;
        isActiveMQ?: boolean;
        openWireVersion?: number;
        stackTraceEnabled?: boolean;
        cacheEnabled?: boolean;
        tightEncodingEnabled?: boolean;
        hasBrokerInfo?: boolean;
        brokerName?: string;
        receivedBytes?: number;
        note?: string;
      };

      if (data.success) {
        const lines = [
          `ActiveMQ Probe — ${host}:${port}`,
          '='.repeat(60),
          `TCP Latency:      ${data.tcpLatency}ms`,
          `ActiveMQ:         ${data.isActiveMQ
            ? '✓ Yes — OpenWire broker detected'
            : '✗ Not detected'}`,
        ];

        if (data.openWireVersion !== undefined) {
          lines.push(`OpenWire Version: ${data.openWireVersion}`);
        }
        if (data.brokerName) {
          lines.push(`Broker Name:      ${data.brokerName}`);
        }

        if (data.isActiveMQ) {
          lines.push('', '--- Broker Capabilities ---');
          if (data.stackTraceEnabled !== undefined) {
            lines.push(`  Stack Traces:   ${data.stackTraceEnabled ? 'enabled' : 'disabled'}`);
          }
          if (data.cacheEnabled !== undefined) {
            lines.push(`  Cache:          ${data.cacheEnabled ? 'enabled' : 'disabled'}`);
          }
          if (data.tightEncodingEnabled !== undefined) {
            lines.push(`  Tight Encoding: ${data.tightEncodingEnabled ? 'enabled' : 'disabled'}`);
          }
          lines.push(`  BrokerInfo:     ${data.hasBrokerInfo ? '✓ received' : 'not received'}`);
        }

        lines.push(`Bytes Received:   ${data.receivedBytes ?? 0}`);
        if (data.note) lines.push('', data.note);
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) handleProbe();
  };

  return (
    <ProtocolClientLayout title="ActiveMQ Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="ActiveMQ Broker" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="activemq-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="activemq.example.com"
            required
            error={errors.host}
          />
          <FormField
            id="activemq-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 61616 (OpenWire TCP)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Probe ActiveMQ broker"
        >
          Probe Broker
        </ActionButton>
        <p className="text-xs text-slate-400 mt-2 mb-6">
          Sends an OpenWire <code className="text-slate-300">WireFormatInfo</code> handshake
          and parses the broker's response for version and capability flags.
        </p>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Apache ActiveMQ (port 61616)"
          description="Apache ActiveMQ is a popular open-source message broker supporting multiple wire protocols. Port 61616 is its native OpenWire binary protocol — a custom marshalled command-based format. On connect, both sides exchange a WireFormatInfo command to negotiate protocol version and capabilities (tight encoding, stack traces, caching). The broker then sends a BrokerInfo frame with its name and URL. ActiveMQ is widely used in Java enterprise systems and supports JMS (Java Message Service)."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">ActiveMQ Default Ports</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-400">
            <div><code className="text-slate-300">61616</code> — OpenWire (native binary)</div>
            <div><code className="text-slate-300">61613</code> — STOMP (text protocol)</div>
            <div><code className="text-slate-300">5672</code> — AMQP 0-9-1</div>
            <div><code className="text-slate-300">1883</code> — MQTT</div>
            <div><code className="text-slate-300">61614</code> — WebSocket / STOMP over WS</div>
            <div><code className="text-slate-300">8161</code> — Web Admin Console (HTTP)</div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Port of Call also supports STOMP (:61613), AMQP (:5672), and MQTT (:1883) natively —
            use those clients for messaging protocol tests.
          </p>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
