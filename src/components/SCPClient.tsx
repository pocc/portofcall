import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SCPClientProps {
  onBack: () => void;
}

export default function SCPClient({ onBack }: SCPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
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
      const response = await fetch('/api/scp/connect', {
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
        banner?: string;
        protoVersion?: string;
        softwareVersion?: string;
        comments?: string;
        note?: string;
        isCloudflare?: boolean;
      };

      if (data.isCloudflare) {
        setError(data.error || 'Target is behind Cloudflare');
        return;
      }

      if (data.success) {
        let output = `SCP/SSH Server — ${host}:${port}\n\n`;
        output += `Banner:       ${data.banner || '(none)'}\n`;
        if (data.protoVersion) output += `SSH Version:  ${data.protoVersion}\n`;
        if (data.softwareVersion) output += `Software:     ${data.softwareVersion}\n`;
        if (data.comments) output += `Comments:     ${data.comments}\n`;
        output += `\nStatus: ${data.message || 'Connected'}\n`;
        if (data.note) output += `\nNote: ${data.note}`;
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
    <ProtocolClientLayout title="SCP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <div className="mb-4 p-3 bg-blue-900/30 border border-blue-700/50 rounded-lg">
          <p className="text-xs text-blue-300">
            <strong>SSH Subsystem:</strong> SCP runs entirely inside an SSH session — it has no
            dedicated port or separate handshake. This probe connects to the SSH port and reads
            the server banner to confirm SCP availability. Use the{' '}
            <strong>SSH Client</strong> for interactive sessions.
          </p>
        </div>

        <SectionHeader stepNumber={1} title="Server Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="scp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="files.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="scp-port"
            label="SSH Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 22 (SSH/SCP)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Check SCP server"
        >
          Check Server
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SCP"
          description="SCP (Secure Copy Protocol) transfers files over an SSH-encrypted channel. The SCP wire protocol (C/D/E messages for copy, directory, and end) is negotiated after SSH authentication — there is no separate network port. Port 22 is the standard SSH/SCP port, though servers may listen on custom ports. SCP is considered legacy; SFTP is the recommended modern alternative for automated file transfers."
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">SCP Usage Examples</h3>
          <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-slate-400 space-y-1">
            <div><span className="text-green-400">$</span> scp file.txt user@host:/remote/path/</div>
            <div><span className="text-green-400">$</span> scp -P 2222 user@host:/remote/file.txt ./local/</div>
            <div><span className="text-green-400">$</span> scp -r ./localdir/ user@host:/remote/dir/</div>
            <div className="text-slate-500 mt-1"># Modern alternative (SFTP):</div>
            <div><span className="text-green-400">$</span> sftp -P 22 user@host</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
