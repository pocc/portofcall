import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  HelpSection,
} from './ProtocolClientLayout';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';
import { usePersistedState } from '../hooks/usePersistedState';

interface SFTPClientProps {
  onBack: () => void;
}

export default function SFTPClient({ onBack }: SFTPClientProps) {
  const [host, setHost] = usePersistedState('sftp-host', '');
  const [port, setPort] = usePersistedState('sftp-port', '22');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string[]>([]);

  const addOutput = (text: string, type: 'info' | 'error' | 'success' = 'info') => {
    const prefix = {
      info: '\u{1f4a1} ',
      error: '\u{274c} ',
      success: '\u{2705} ',
    }[type];
    setOutput(prev => {
      const next = [...prev, `${prefix}${text}`];
      return next.length > 500 ? next.slice(-500) : next;
    });
  };

  const handleConnect = async () => {
    if (!host) {
      addOutput('Error: Host is required', 'error');
      return;
    }

    setLoading(true);
    addOutput(`Testing SFTP connectivity to ${host}:${port}...`, 'info');

    try {
      const testResponse = await fetch('/api/sftp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
        }),
      });

      const testData = await testResponse.json() as { success?: boolean; error?: string; sshBanner?: string; software?: string; sshVersion?: string };

      if (!testResponse.ok || !testData.success) {
        addOutput(`Connection test failed: ${testData.error}`, 'error');
        setLoading(false);
        return;
      }

      addOutput(`SSH banner: ${testData.sshBanner || 'Unknown'}`, 'success');
      if (testData.software) {
        addOutput(`Software: ${testData.software}`, 'info');
      }
      if (testData.sshVersion) {
        addOutput(`SSH version: ${testData.sshVersion}`, 'info');
      }
      addOutput('SFTP subsystem is available on this server', 'success');
      addOutput('File operations (list, upload, download, etc.) are not yet implemented — they require a WebSocket-based SFTP session', 'info');
    } catch (error) {
      addOutput(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="SFTP Client" onBack={onBack}>
      <p className="text-slate-400 text-sm mb-6">Port 22 &mdash; SSH File Transfer Protocol</p>

      <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-4 mb-6 flex items-start gap-3">
        <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <p className="text-sm text-amber-200/80 leading-relaxed">
          <strong className="text-amber-200">Connectivity test only.</strong> Tests TCP reachability and reads the SSH banner to verify SFTP availability. File operations (list, upload, download, delete, mkdir, rename) are not yet implemented — they require a WebSocket-based SFTP session.
        </p>
      </div>

      <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/40 rounded-2xl p-6 shadow-lg shadow-black/10">
        <SectionHeader stepNumber={1} title="Test SFTP Server Connectivity" />

        <div className="grid md:grid-cols-4 gap-4 mb-6">
          <div className="md:col-span-3">
            <FormField
              id="sftp-host"
              label="Host"
              type="text"
              value={host}
              onChange={setHost}
              onKeyDown={handleKeyDown}
              placeholder="test.rebex.net"
              required
            />
          </div>
          <FormField
            id="sftp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Test SFTP connection"
        >
          Test Connection
        </ActionButton>

        <HelpSection
          title="About SFTP"
          description="Tests whether an SSH server is reachable and reports the SSH banner. Try test.rebex.net:22 for a public test server."
        />
      </div>

      {output.length > 0 && (
        <div className="mt-6 bg-slate-900/60 backdrop-blur-sm border border-slate-700/40 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-slate-300">Connection Log</h4>
            <button
              onClick={() => setOutput([])}
              className="text-xs text-slate-500 hover:text-slate-300 px-2.5 py-1 rounded-lg hover:bg-slate-800/50 transition-all duration-200"
            >
              Clear
            </button>
          </div>
          <div className="output-content space-y-1.5 max-h-64 overflow-y-auto pr-2">
            {output.map((line, i) => (
              <div key={i} className="text-sm text-slate-300 font-mono leading-relaxed">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      <ApiExamples examples={apiExamples.SFTP || []} protocolId="sftp" />

    </ProtocolClientLayout>
  );
}
