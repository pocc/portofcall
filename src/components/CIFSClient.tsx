import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface CIFSClientProps {
  onBack: () => void;
}

export default function CIFSClient({ onBack }: CIFSClientProps) {
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
      const response = await fetch('/api/cifs/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        dialect?: string;
        smb2Redirect?: boolean;
        serverInfo?: string;
        isCloudflare?: boolean;
      };

      if (data.isCloudflare) {
        setError(data.error || 'Target is behind Cloudflare');
        return;
      }

      if (data.success) {
        let output = `Connected to CIFS/SMB server at ${host}:${port}\n\n`;
        if (data.smb2Redirect) {
          output += `Status: SMB1/CIFS disabled — server responded with SMB2/SMB3\n`;
        } else {
          output += `Status: CIFS/SMB1 active\n`;
          if (data.dialect) output += `Dialect: ${data.dialect}\n`;
        }
        if (data.serverInfo) output += `\n${data.serverInfo}`;
        setResult(output);
      } else {
        setError(data.error || data.message || 'Connection failed');
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
    <ProtocolClientLayout title="CIFS Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="cifs-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="fileserver.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="cifs-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 445 (direct TCP), 139 (NetBIOS)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test CIFS connection"
        >
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About CIFS"
          description="CIFS (Common Internet File System) is Microsoft's original file sharing protocol — essentially SMB 1.0. It has been deprecated since Windows Vista and is disabled by default in modern Windows and Linux (Samba). This test sends an SMB1 Negotiate Protocol Request on port 445. Most modern servers will reject SMB1 and respond with an SMB2/SMB3 redirect, while legacy systems will complete the SMB1 handshake."
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Common Test Targets</h3>
          <div className="grid gap-2">
            {[
              { host: 'localhost', desc: 'Local Samba or Windows share' },
              { host: 'nas.local', desc: 'NAS device on local network' },
            ].map(({ host: h, desc }) => (
              <button
                key={h}
                onClick={() => { setHost(h); setPort('445'); }}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-blue-400">{h}</span>
                <span className="ml-2 text-slate-400">— {desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
