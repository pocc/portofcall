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

interface SMBClientProps {
  onBack: () => void;
}

export default function SMBClient({ onBack }: SMBClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('445');
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
      const response = await fetch('/api/smb/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        dialect?: string;
        serverResponse?: string;
      };

      if (data.success) {
        setResult(`Connected to SMB server at ${host}:${port}\n\nDialect: ${data.dialect || 'Unknown'}\nServer Response: ${data.serverResponse || 'N/A'}\n\n${data.message || ''}`);
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
    <ProtocolClientLayout title="SMB Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.SMB || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="smb-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="smb.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="smb-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 445 (SMB), 139 (NetBIOS)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test SMB connection"
        >
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SMB"
          description="SMB (Server Message Block), also known as CIFS, is a network file sharing protocol used primarily in Windows environments. This interface tests connectivity by performing an SMB2/SMB3 protocol negotiation. Port 445 is the standard SMB port. The server will respond with the negotiated dialect (SMB 2.0.2, 2.1, 3.0, 3.0.2, or 3.1.1)."
        />
      </div>
    </ProtocolClientLayout>
  );
}
