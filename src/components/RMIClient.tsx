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

interface RMIClientProps {
  onBack: () => void;
}

export default function RMIClient({ onBack }: RMIClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1099');
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
      const response = await fetch('/api/rmi/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        isRMI?: boolean;
        protocolAck?: boolean;
        notSupported?: boolean;
        serverHost?: string;
        serverPort?: number;
        protocolType?: string;
        responseBytes?: number;
        responseHex?: string;
        message?: string;
        securityWarning?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `RMI Probe Result\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `RMI Detected: ${data.isRMI ? 'Yes' : 'No'}\n`;
        resultText += `Protocol: ${data.protocolType}\n\n`;

        if (data.isRMI) {
          resultText += `Server Endpoint:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += `  Host: ${data.serverHost || 'unknown'}\n`;
          resultText += `  Port: ${data.serverPort || 'unknown'}\n`;
        }

        if (data.securityWarning) {
          resultText += `\n[!] ${data.securityWarning}\n`;
        }

        if (data.responseHex) {
          resultText += `\nResponse Hex:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += data.responseHex;
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

  const handleList = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/rmi/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        isRMI?: boolean;
        serverHost?: string;
        serverPort?: number;
        bindings?: string[];
        bindingCount?: number;
        hasReturnData?: boolean;
        returnType?: string;
        responseBytes?: number;
        responseHex?: string;
        message?: string;
        securityWarning?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `RMI Registry List\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `Handshake: OK\n`;
        resultText += `Server: ${data.serverHost || 'unknown'}:${data.serverPort || 'unknown'}\n\n`;

        if (data.bindings && data.bindings.length > 0) {
          resultText += `Registry Bindings (${data.bindingCount}):\n`;
          resultText += `${'-'.repeat(30)}\n`;
          for (const binding of data.bindings) {
            resultText += `  - ${binding}\n`;
          }
        } else {
          resultText += `Return Type: ${data.returnType || 'none'}\n`;
          resultText += `Response Size: ${data.responseBytes} bytes\n`;
          if (!data.hasReturnData) {
            resultText += `No bindings data returned.\n`;
          }
        }

        if (data.securityWarning) {
          resultText += `\n[!] ${data.securityWarning}\n`;
        }

        if (data.responseHex) {
          resultText += `\nResponse Hex:\n${data.responseHex}\n`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'List failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'List failed');
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
    <ProtocolClientLayout title="Java RMI Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.RMI || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="RMI Registry Endpoint" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rmi-host"
            label="RMI Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="rmi.example.com"
            required
            helpText="Hostname or IP of the RMI registry"
            error={errors.host}
          />

          <FormField
            id="rmi-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 1099 (rmiregistry)"
            error={errors.port}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Probe RMI registry with JRMI handshake"
          >
            Probe (Handshake)
          </ActionButton>

          <button
            onClick={handleList}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="List RMI registry bindings"
          >
            {loading ? 'Connecting...' : 'List Bindings'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Java RMI"
          description="Java RMI (Remote Method Invocation) allows Java objects to invoke methods on remote JVMs. The JRMI wire protocol uses a 'JRMI' magic header handshake followed by Java Object Serialization. The registry (default port 1099) provides name-to-stub lookup. SECURITY NOTE: Exposed RMI registries are a critical vulnerability — they can be exploited via Java deserialization attacks (e.g., ysoserial) for remote code execution."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
