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

interface MQTTClientProps {
  onBack: () => void;
}

export default function MQTTClient({ onBack }: MQTTClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1883');
  const [clientId, setClientId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
      const response = await fetch('/api/mqtt/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          clientId: clientId || undefined,
          username: username || undefined,
          password: password || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        clientId?: string;
        returnCode?: number;
        serverResponse?: string;
      };

      if (data.success) {
        setResult(`Connected to MQTT broker at ${host}:${port}\n\nClient ID: ${data.clientId || 'N/A'}\nServer Response: ${data.serverResponse || 'N/A'}\n\n${data.message || ''}`);
      } else {
        setError(data.error || data.serverResponse || 'Connection failed');
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
    <ProtocolClientLayout title="MQTT Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.MQTT || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="mqtt-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="mqtt.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="mqtt-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 1883 (unencrypted), 8883 (TLS)"
            error={errors.port}
          />

          <FormField
            id="mqtt-clientId"
            label="Client ID"
            type="text"
            value={clientId}
            onChange={setClientId}
            onKeyDown={handleKeyDown}
            placeholder="my-mqtt-client"
            optional
            helpText="Auto-generated if empty"
          />

          <FormField
            id="mqtt-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="username"
            optional
          />

          <div className="md:col-span-2">
            <FormField
              id="mqtt-password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              onKeyDown={handleKeyDown}
              placeholder="password"
              optional
            />
          </div>
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test MQTT connection"
        >
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About MQTT"
          description="MQTT (Message Queuing Telemetry Transport) is a lightweight publish-subscribe messaging protocol designed for IoT devices and constrained networks. This interface tests connectivity by sending a CONNECT packet and parsing the CONNACK response. Port 1883 is the default for unencrypted connections, while 8883 is used for TLS/SSL."
        />
      </div>
    </ProtocolClientLayout>
  );
}
