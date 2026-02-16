import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface RserveClientProps {
  onBack: () => void;
}

export default function RserveClient({ onBack }: RserveClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6311');
  const [expression, setExpression] = useState('R.version.string');
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
      const response = await fetch('/api/rserve/probe', {
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
        isRserve?: boolean;
        magic?: string;
        version?: string;
        protocolType?: string;
        attributes?: string;
        extra?: string;
        requiresAuth?: boolean;
        supportsTLS?: boolean;
        bannerBytes?: number;
        bannerHex?: string;
        message?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Rserve Probe Result\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `Rserve Detected: ${data.isRserve ? 'Yes' : 'No'}\n\n`;

        if (data.isRserve) {
          resultText += `Server Info:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += `  Version: ${data.version}\n`;
          resultText += `  Protocol: ${data.protocolType}\n`;
          resultText += `  Attributes: ${data.attributes}\n`;
          if (data.extra) resultText += `  Extra: ${data.extra}\n`;
          resultText += `  Auth Required: ${data.requiresAuth ? 'Yes' : 'No'}\n`;
          resultText += `  TLS Support: ${data.supportsTLS ? 'Yes' : 'No'}\n`;
        }

        if (data.bannerHex) {
          resultText += `\nBanner Hex:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += data.bannerHex;
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

  const handleEval = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/rserve/eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          expression,
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        isRserve?: boolean;
        version?: string;
        protocolType?: string;
        expression?: string;
        evalSuccess?: boolean;
        evalError?: string;
        result?: string;
        requiresAuth?: boolean;
        responseBytes?: number;
        responseHex?: string;
        message?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Rserve Eval Result\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `Version: ${data.version}\n\n`;

        if (data.requiresAuth) {
          resultText += `[!] Server requires authentication\n`;
          resultText += `Cannot evaluate expressions without credentials.\n`;
        } else {
          resultText += `Expression: ${data.expression}\n`;
          resultText += `Eval OK: ${data.evalSuccess ? 'Yes' : 'No'}\n\n`;

          if (data.result) {
            resultText += `Result:\n`;
            resultText += `${'-'.repeat(30)}\n`;
            resultText += `  ${data.result}\n`;
          } else if (data.evalError) {
            resultText += `Error: ${data.evalError}\n`;
          }
        }

        if (data.responseHex) {
          resultText += `\nResponse Hex:\n${data.responseHex}\n`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Eval failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eval failed');
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
    <ProtocolClientLayout title="Rserve Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Rserve Endpoint" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rserve-host"
            label="Rserve Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="r-server.example.com"
            required
            helpText="Hostname or IP of the Rserve instance"
            error={errors.host}
          />

          <FormField
            id="rserve-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 6311"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <FormField
            id="rserve-expression"
            label="R Expression (for eval)"
            type="text"
            value={expression}
            onChange={setExpression}
            onKeyDown={handleKeyDown}
            placeholder="R.version.string"
            helpText="R expression to evaluate (e.g., R.version.string, Sys.info()['nodename'])"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Probe Rserve endpoint for banner"
          >
            Probe (Banner)
          </ActionButton>

          <button
            onClick={handleEval}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Evaluate R expression"
          >
            {loading ? 'Connecting...' : 'Eval Expression'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Rserve"
          description="Rserve is a TCP/IP server for the R statistical computing environment, allowing remote access to R from any language. It uses the QAP1 binary protocol. The server sends a 32-byte identification string on connect containing 'Rsrv' magic, version, protocol type, and capability flags. If authentication is not required, clients can evaluate R expressions remotely."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
