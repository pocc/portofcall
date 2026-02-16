import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface ZMTPClientProps {
  onBack: () => void;
}

export default function ZMTPClient({ onBack }: ZMTPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5555');
  const [socketType, setSocketType] = useState('DEALER');
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
      const response = await fetch('/api/zmtp/probe', {
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
        isZMTP?: boolean;
        signatureValid?: boolean;
        version?: string;
        mechanism?: string;
        asServer?: boolean;
        greetingBytes?: number;
        greetingHex?: string;
        message?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `ZMTP Probe Result\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `ZeroMQ Detected: ${data.isZMTP ? 'Yes' : 'No'}\n\n`;

        if (data.isZMTP) {
          resultText += `ZMTP Version: ${data.version}\n`;
          resultText += `Security Mechanism: ${data.mechanism}\n`;
          resultText += `As-Server: ${data.asServer ? 'Yes' : 'No'}\n`;
          resultText += `Greeting Size: ${data.greetingBytes} bytes\n`;
        }

        if (data.greetingHex) {
          resultText += `\nGreeting Hex:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          resultText += data.greetingHex;
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

  const handleHandshake = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/zmtp/handshake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          socketType,
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        isZMTP?: boolean;
        version?: string;
        mechanism?: string;
        asServer?: boolean;
        handshakeComplete?: boolean;
        serverCommand?: string;
        serverSocketType?: string;
        serverIdentity?: string;
        clientSocketType?: string;
        peerMetadata?: Record<string, string>;
        greetingHex?: string;
        commandHex?: string;
        message?: string;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `ZMTP Full Handshake\n`;
        resultText += `${'='.repeat(40)}\n\n`;
        resultText += `Host: ${data.host}:${data.port}\n`;
        resultText += `RTT: ${data.rtt}ms\n`;
        resultText += `ZMTP Version: ${data.version}\n`;
        resultText += `Security: ${data.mechanism}\n`;
        resultText += `Handshake: ${data.handshakeComplete ? 'Complete' : 'Incomplete'}\n\n`;

        resultText += `Socket Types:\n`;
        resultText += `${'-'.repeat(30)}\n`;
        resultText += `  Client: ${data.clientSocketType}\n`;
        resultText += `  Server: ${data.serverSocketType || 'unknown'}\n`;
        if (data.serverIdentity) resultText += `  Identity: ${data.serverIdentity}\n`;

        if (data.peerMetadata && Object.keys(data.peerMetadata).length > 0) {
          resultText += `\nPeer Metadata:\n`;
          resultText += `${'-'.repeat(30)}\n`;
          for (const [key, val] of Object.entries(data.peerMetadata)) {
            resultText += `  ${key}: ${val}\n`;
          }
        }

        if (data.greetingHex) {
          resultText += `\nGreeting Hex:\n${data.greetingHex}\n`;
        }
        if (data.commandHex) {
          resultText += `\nCommand Hex:\n${data.commandHex}\n`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Handshake failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Handshake failed');
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
    <ProtocolClientLayout title="ZMTP / ZeroMQ Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="ZeroMQ Endpoint" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="zmtp-host"
            label="ZeroMQ Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="zmq.example.com"
            required
            helpText="Hostname or IP of the ZeroMQ endpoint"
            error={errors.host}
          />

          <FormField
            id="zmtp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5555"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <label htmlFor="zmtp-sockettype" className="block text-sm font-medium text-slate-300 mb-1">
            Socket Type (for handshake)
          </label>
          <select
            id="zmtp-sockettype"
            value={socketType}
            onChange={(e) => setSocketType(e.target.value)}
            className="w-full md:w-64 px-3 py-2 bg-slate-700 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="DEALER">DEALER</option>
            <option value="ROUTER">ROUTER</option>
            <option value="REQ">REQ</option>
            <option value="REP">REP</option>
            <option value="PUB">PUB</option>
            <option value="SUB">SUB</option>
            <option value="PUSH">PUSH</option>
            <option value="PULL">PULL</option>
            <option value="PAIR">PAIR</option>
            <option value="XPUB">XPUB</option>
            <option value="XSUB">XSUB</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">ZeroMQ socket pattern for the handshake</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Probe ZMTP endpoint with greeting"
          >
            Probe (Greeting)
          </ActionButton>

          <button
            onClick={handleHandshake}
            disabled={loading || !host || !port}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
            aria-label="Full ZMTP handshake"
          >
            {loading ? 'Connecting...' : 'Full Handshake'}
          </button>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About ZMTP / ZeroMQ"
          description="ZMTP (ZeroMQ Message Transport Protocol) is the binary wire protocol for ZeroMQ, a high-performance messaging library used in distributed systems. The greeting handshake negotiates protocol version (3.x), security mechanism (NULL, PLAIN, CURVE), and socket type (REQ/REP, PUB/SUB, PUSH/PULL, DEALER/ROUTER). The probe sends a 64-byte greeting and reads the server's response."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
