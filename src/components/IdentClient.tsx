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

interface IdentClientProps {
  onBack: () => void;
}

export default function IdentClient({ onBack }: IdentClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('113');
  const [serverPort, setServerPort] = useState('22');
  const [clientPort, setClientPort] = useState('12345');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    serverPort: [validationRules.port()],
    clientPort: [validationRules.port()],
  });

  const handleQuery = async () => {
    const isValid = validateAll({ host, port, serverPort, clientPort });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/ident/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          serverPort: parseInt(serverPort, 10),
          clientPort: parseInt(clientPort, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        responseType?: string;
        operatingSystem?: string;
        userId?: string;
        errorType?: string;
        rawResponse?: string;
        rtt?: number;
        serverPort?: number;
        clientPort?: number;
      };

      if (response.ok && data.success) {
        let output = '';

        if (data.responseType === 'USERID') {
          output =
            `IDENT Response: USERID\n\n` +
            `Query:    ${data.serverPort}, ${data.clientPort}\n` +
            `OS:       ${data.operatingSystem}\n` +
            `User ID:  ${data.userId}\n` +
            `RTT:      ${data.rtt}ms\n\n` +
            `Raw: ${data.rawResponse}`;
        } else if (data.responseType === 'ERROR') {
          output =
            `IDENT Response: ERROR\n\n` +
            `Query:      ${data.serverPort}, ${data.clientPort}\n` +
            `Error Type: ${data.errorType}\n` +
            `RTT:        ${data.rtt}ms\n\n` +
            `Raw: ${data.rawResponse}\n\n` +
            `Note: This means the IDENT server is running but no user\n` +
            `was found for this port pair. This is expected when querying\n` +
            `arbitrary port numbers.`;
        } else {
          output =
            `IDENT server responded\n\n` +
            `RTT: ${data.rtt}ms\n` +
            `Raw: ${data.rawResponse}`;
        }

        setResult(output);
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
    if (e.key === 'Enter' && !loading && host && port && serverPort && clientPort) {
      handleQuery();
    }
  };

  return (
    <ProtocolClientLayout title="IDENT Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Ident || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="IDENT Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ident-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="ident.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="ident-port"
            label="IDENT Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 113 (standard IDENT port)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Port Pair to Query" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ident-server-port"
            label="Server Port"
            type="number"
            value={serverPort}
            onChange={setServerPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Port on the server side of the connection"
            error={errors.serverPort}
          />

          <FormField
            id="ident-client-port"
            label="Client Port"
            type="number"
            value={clientPort}
            onChange={setClientPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Port on the client side of the connection"
            error={errors.clientPort}
          />
        </div>

        <ActionButton
          onClick={handleQuery}
          disabled={loading || !host || !port || !serverPort || !clientPort}
          loading={loading}
          ariaLabel="Query IDENT server"
        >
          Query IDENT
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About IDENT Protocol"
          description="IDENT (RFC 1413) is the Identification Protocol running on port 113. It allows a server to determine the identity (username) of the owner of a TCP connection. Historically used by IRC servers and mail servers to verify connecting users. You query a port pair (server-port, client-port) and the server responds with the username or an error."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Common Queries</h3>
          <div className="grid gap-2">
            <button
              onClick={() => {
                setServerPort('22');
                setClientPort('12345');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">22, 12345</span>
              <span className="ml-2 text-slate-400">- SSH connection query</span>
            </button>
            <button
              onClick={() => {
                setServerPort('25');
                setClientPort('54321');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">25, 54321</span>
              <span className="ml-2 text-slate-400">- SMTP connection query</span>
            </button>
            <button
              onClick={() => {
                setServerPort('6667');
                setClientPort('45000');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">6667, 45000</span>
              <span className="ml-2 text-slate-400">- IRC connection query</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              <strong>Note:</strong> Most modern systems disable IDENT (port 113) for security.
              An ERROR response like NO-USER still confirms the IDENT daemon is running.
              Try querying servers that run oidentd, pidentd, or similar IDENT daemons.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
