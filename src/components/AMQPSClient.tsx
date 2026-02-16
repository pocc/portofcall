import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface AMQPSClientProps {
  onBack: () => void;
}

export default function AMQPSClient({ onBack }: AMQPSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5671');
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
      const response = await fetch('/api/amqps/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        secure?: boolean;
        protocol?: string;
        serverProperties?: Record<string, string>;
        mechanisms?: string;
        locales?: string;
        message?: string;
        error?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `🔒 Secure AMQPS Connection Established\n\n`;

        if (data.protocol) {
          resultText += `Protocol: ${data.protocol}\n`;
        }

        if (data.serverProperties) {
          resultText += `\n${'='.repeat(40)}\n`;
          resultText += `Server Properties:\n`;
          resultText += `${'-'.repeat(40)}\n`;

          const props = data.serverProperties;
          if (props.product) resultText += `  Product:  ${props.product}\n`;
          if (props.version) resultText += `  Version:  ${props.version}\n`;
          if (props.platform) resultText += `  Platform: ${props.platform}\n`;
          if (props.copyright) resultText += `  Copyright: ${props.copyright}\n`;
          if (props.information) resultText += `  Info: ${props.information}\n`;

          // Show capabilities if present
          if (props.capabilities) {
            try {
              const caps = JSON.parse(props.capabilities);
              resultText += `\n  Capabilities:\n`;
              for (const [key, value] of Object.entries(caps)) {
                resultText += `    - ${key}: ${value}\n`;
              }
            } catch {
              resultText += `  Capabilities: ${props.capabilities}\n`;
            }
          }
        }

        if (data.mechanisms) {
          resultText += `\n${'='.repeat(40)}\n`;
          resultText += `Authentication Mechanisms:\n`;
          resultText += `${'-'.repeat(40)}\n`;
          resultText += `  ${data.mechanisms}\n`;
        }

        if (data.locales) {
          resultText += `\nSupported Locales: ${data.locales}\n`;
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
    <ProtocolClientLayout title="AMQPS Client (Secure AMQP)" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Secure Broker Connection" />

        <div className="bg-blue-900/20 border border-blue-600/30 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-2">
            <span className="text-blue-400 text-xl">🔒</span>
            <div>
              <p className="text-blue-200 text-sm font-semibold mb-1">TLS/SSL Encryption</p>
              <p className="text-blue-100/80 text-xs">
                AMQPS provides implicit TLS encryption from the first byte. All AMQP 0-9-1 protocol
                communication is encrypted for security.
              </p>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="amqps-host"
            label="Broker Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="localhost"
            error={errors.host}
          />
          <FormField
            id="amqps-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            placeholder="5671"
            error={errors.port}
          />
        </div>

        <ActionButton onClick={handleConnect} loading={loading} disabled={loading || !host || !port}>
          🔒 Secure Connect
        </ActionButton>
      </div>

      <ResultDisplay result={result} error={error} />

      <HelpSection
        title="About AMQPS"
        description="AMQPS is AMQP 0-9-1 protocol with implicit TLS/SSL encryption (RFC 5672). It uses port 5671 instead of AMQP's standard port 5672. AMQPS is used by RabbitMQ, Azure Service Bus, and Amazon MQ for secure message broker connections. The TLS handshake occurs before any AMQP protocol data is exchanged, ensuring all communication is encrypted. Common authentication mechanisms include PLAIN, AMQPLAIN, and EXTERNAL."
        showKeyboardShortcut={true}
      />
    </ProtocolClientLayout>
  );
}
