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

interface NinePClientProps {
  onBack: () => void;
}

export default function NinePClient({ onBack }: NinePClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('564');
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
      const response = await fetch('/api/9p/connect', {
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
        version?: string;
        msize?: number;
        serverVersion?: string;
        rootQid?: { type: number; version: number; path: string };
        error?: string;
      };

      if (response.ok && data.success) {
        let resultText = `9P Server Detected\n${'='.repeat(40)}\n\n`;
        resultText += `Server Version: ${data.serverVersion || 'unknown'}\n`;
        resultText += `Max Message Size: ${data.msize || 'unknown'} bytes\n`;
        resultText += `Client Version: ${data.version || '9P2000'}\n`;

        if (data.rootQid) {
          resultText += `\nRoot QID:\n`;
          resultText += `  Type: ${data.rootQid.type} (${data.rootQid.type === 0x80 ? 'directory' : data.rootQid.type === 0 ? 'file' : `0x${data.rootQid.type.toString(16)}`})\n`;
          resultText += `  Version: ${data.rootQid.version}\n`;
          resultText += `  Path: ${data.rootQid.path}\n`;
        }

        if (data.error) {
          resultText += `\nNote: ${data.error}`;
        }

        setResult(resultText);
      } else {
        setError(data.error || '9P connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '9P connection failed');
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
    <ProtocolClientLayout title="9P Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.NineP || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="9P Server Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="9p-host"
            label="Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="plan9.example.com"
            required
            helpText="9P server address"
            error={errors.host}
          />

          <FormField
            id="9p-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 564 (standard 9P port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect to 9P server"
        >
          Connect & Probe
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About 9P Protocol"
          description="9P is a network filesystem protocol from Plan 9 (Bell Labs, 1990s). Its philosophy is 'everything is a file' - processes, devices, and network resources are all accessible through a unified filesystem interface. Used today by QEMU (virtio-9p), WSL2, and other virtualization platforms."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 564 (default)</p>
            <p><strong className="text-slate-300">Transport:</strong> TCP</p>
            <p><strong className="text-slate-300">Version:</strong> 9P2000</p>
            <p><strong className="text-slate-300">Encoding:</strong> Little-endian binary</p>
            <p><strong className="text-slate-300">Message:</strong> [size:u32][type:u8][tag:u16][body...]</p>
            <p><strong className="text-slate-300">Origin:</strong> Plan 9 from Bell Labs</p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Message Types</h3>
          <div className="bg-slate-700 rounded-lg p-3">
            <div className="grid grid-cols-2 gap-1 font-mono text-xs text-slate-300">
              <span>Tversion/Rversion</span><span className="text-slate-400">Version negotiation</span>
              <span>Tauth/Rauth</span><span className="text-slate-400">Authentication</span>
              <span>Tattach/Rattach</span><span className="text-slate-400">Mount filesystem</span>
              <span>Twalk/Rwalk</span><span className="text-slate-400">Navigate path</span>
              <span>Topen/Ropen</span><span className="text-slate-400">Open file</span>
              <span>Tread/Rread</span><span className="text-slate-400">Read data</span>
              <span>Twrite/Rwrite</span><span className="text-slate-400">Write data</span>
              <span>Tstat/Rstat</span><span className="text-slate-400">File metadata</span>
              <span>Tclunk/Rclunk</span><span className="text-slate-400">Close handle</span>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Modern Usage</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">QEMU:</strong> virtio-9p for host-guest filesystem sharing</p>
            <p><strong className="text-slate-300">WSL2:</strong> 9P used for Windows-Linux filesystem bridge</p>
            <p><strong className="text-slate-300">Inferno OS:</strong> 9P-based distributed operating system</p>
            <p><strong className="text-slate-300">v9fs:</strong> Linux kernel 9P filesystem client</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
