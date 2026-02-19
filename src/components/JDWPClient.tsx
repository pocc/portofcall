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

interface JDWPClientProps {
  onBack: () => void;
}

export default function JDWPClient({ onBack }: JDWPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5005');
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
      const response = await fetch('/api/jdwp/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        isJDWP?: boolean;
        handshakeResponse?: string;
        responseBytes?: number;
        responseHex?: string;
        message?: string;
        securityWarning?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `JDWP Probe Result\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `JDWP Detected: ${data.isJDWP ? 'Yes' : 'No'}\n`;

        if (data.isJDWP) {
          resultText += `Handshake: ${data.handshakeResponse}\n`;
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

  const handleVersion = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/jdwp/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        isJDWP?: boolean;
        version?: {
          description?: string;
          jdwpMajor?: number;
          jdwpMinor?: number;
          vmVersion?: string;
          vmName?: string;
        };
        versionError?: string;
        idSizes?: {
          fieldIDSize?: number;
          methodIDSize?: number;
          objectIDSize?: number;
          referenceTypeIDSize?: number;
          frameIDSize?: number;
        };
        versionReplyHex?: string;
        message?: string;
        securityWarning?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `JDWP Version Query\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `Handshake: OK\n\n`;

        if (data.version) {
          resultText += `JVM Information:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += `  VM Name: ${data.version.vmName}\n`;
          resultText += `  VM Version: ${data.version.vmVersion}\n`;
          resultText += `  JDWP Version: ${data.version.jdwpMajor}.${data.version.jdwpMinor}\n`;
          if (data.version.description) {
            resultText += `  Description: ${data.version.description}\n`;
          }
        } else if (data.versionError) {
          resultText += `Version Error: ${data.versionError}\n`;
        }

        if (data.idSizes) {
          resultText += `\nID Sizes:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += `  Field ID: ${data.idSizes.fieldIDSize} bytes\n`;
          resultText += `  Method ID: ${data.idSizes.methodIDSize} bytes\n`;
          resultText += `  Object ID: ${data.idSizes.objectIDSize} bytes\n`;
          resultText += `  Reference Type ID: ${data.idSizes.referenceTypeIDSize} bytes\n`;
          resultText += `  Frame ID: ${data.idSizes.frameIDSize} bytes\n`;
        }

        if (data.securityWarning) {
          resultText += `\n[!] ${data.securityWarning}\n`;
        }

        if (data.versionReplyHex) {
          resultText += `\nVersion Reply Hex:\n${data.versionReplyHex}\n`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Version query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Version query failed');
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
    <ProtocolClientLayout title="JDWP Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.JDWP || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Java Debug Endpoint" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="jdwp-host"
            label="Debug Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="jvm.example.com"
            required
            helpText="Hostname or IP of the JDWP endpoint"
            error={errors.host}
          />

          <FormField
            id="jdwp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5005 (also common: 8000, 9000)"
            error={errors.port}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Probe JDWP endpoint with handshake"
          >
            Probe (Handshake)
          </ActionButton>

          <button
            onClick={handleVersion}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Query JVM version via JDWP"
          >
            {loading ? 'Connecting...' : 'Get VM Version'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About JDWP"
          description="JDWP (Java Debug Wire Protocol) is the protocol used for remote debugging of Java applications. It's part of JPDA (Java Platform Debugger Architecture). The handshake is a simple ASCII exchange of 'JDWP-Handshake'. After handshake, binary commands can query VM version, class info, and thread state. SECURITY NOTE: Exposed JDWP ports allow arbitrary code execution on the JVM — they should never be accessible from untrusted networks."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
