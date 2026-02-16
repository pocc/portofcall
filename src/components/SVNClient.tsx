import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SVNClientProps {
  onBack: () => void;
}

export default function SVNClient({ onBack }: SVNClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3690');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [serverInfo, setServerInfo] = useState<{
    minVersion?: number;
    maxVersion?: number;
    capabilities?: string[];
    authMechanisms?: string[];
    rtt?: number;
  } | null>(null);

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
    setServerInfo(null);

    try {
      const response = await fetch('/api/svn/connect', {
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
        greeting?: string;
        minVersion?: number;
        maxVersion?: number;
        capabilities?: string[];
        authMechanisms?: string[];
        rtt?: number;
      };

      if (response.ok && data.success) {
        setResult(data.greeting || 'Connected successfully');
        setServerInfo({
          minVersion: data.minVersion,
          maxVersion: data.maxVersion,
          capabilities: data.capabilities,
          authMechanisms: data.authMechanisms,
          rtt: data.rtt,
        });
      } else {
        setError(data.error || 'Failed to connect to SVN server');
        if (data.greeting) {
          setResult(data.greeting);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to SVN server');
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
    <ProtocolClientLayout title="SVN Protocol Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="SVN Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="svn-host"
            label="SVN Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="svn.example.com"
            required
            helpText="Host running svnserve on port 3690"
            error={errors.host}
          />

          <FormField
            id="svn-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 3690 (svnserve)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe SVN server for greeting and capabilities"
        >
          Probe Server
        </ActionButton>

        {serverInfo && (
          <div className="mt-6 bg-slate-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Server Information</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              {serverInfo.minVersion !== undefined && serverInfo.maxVersion !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Protocol Version</div>
                  <div className="text-lg font-bold text-blue-400">
                    {serverInfo.minVersion} - {serverInfo.maxVersion}
                  </div>
                </div>
              )}
              {serverInfo.rtt !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Round-Trip Time</div>
                  <div className="text-lg font-bold text-yellow-400">{serverInfo.rtt}ms</div>
                </div>
              )}
              {serverInfo.capabilities && (
                <div>
                  <div className="text-xs text-slate-400">Capabilities</div>
                  <div className="text-lg font-bold text-green-400">{serverInfo.capabilities.length}</div>
                </div>
              )}
            </div>

            {serverInfo.capabilities && serverInfo.capabilities.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-slate-400 mb-1 font-semibold">Capabilities</div>
                <div className="flex flex-wrap gap-1">
                  {serverInfo.capabilities.map((cap, idx) => (
                    <span
                      key={idx}
                      className="bg-blue-900/40 text-blue-300 border border-blue-700/30 px-2 py-0.5 rounded text-xs font-mono"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {serverInfo.authMechanisms && serverInfo.authMechanisms.length > 0 && (
              <div>
                <div className="text-xs text-slate-400 mb-1 font-semibold">Auth Mechanisms</div>
                <div className="flex flex-wrap gap-1">
                  {serverInfo.authMechanisms.map((mech, idx) => (
                    <span
                      key={idx}
                      className="bg-green-900/40 text-green-300 border border-green-700/30 px-2 py-0.5 rounded text-xs font-mono"
                    >
                      {mech}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SVN Protocol"
          description="Subversion (svnserve) uses a custom wire protocol on port 3690 with S-expression encoding. The server sends a greeting with version range, capabilities (edit-pipeline, svndiff1, etc.), and supported auth mechanisms (ANONYMOUS, CRAM-MD5, EXTERNAL). This probe reads the server greeting without authentication."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Technical Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Encoding:</td>
                  <td className="py-2 px-2">S-expression (parenthesized lists)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Port:</td>
                  <td className="py-2 px-2">3690 (svnserve)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Greeting:</td>
                  <td className="py-2 px-2 font-mono">( success ( min max ( caps... ) ( mechs... ) ) )</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Common Capabilities:</td>
                  <td className="py-2 px-2">edit-pipeline, svndiff1, absent-entries, depth, mergeinfo</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Auth Mechanisms:</td>
                  <td className="py-2 px-2">ANONYMOUS, CRAM-MD5, EXTERNAL</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">URL Scheme:</td>
                  <td className="py-2 px-2">svn://host:port/path</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Handshake</h3>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto">
            <pre>{`Client                          Server
  │                                │
  │──── TCP Connect ──────────────>│
  │                                │
  │<── Greeting (S-expression) ────│
  │    ( success ( 2 2             │
  │      ( edit-pipeline           │
  │        svndiff1 ... )          │
  │      ( ANONYMOUS               │
  │        CRAM-MD5 ) ) )          │
  │                                │
  │──── Client Response ──────────>│
  │    ( version url ... )         │
  │                                │
  │<── Auth Challenge / Success ───│
  │                                │`}</pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Configurations</h3>
          <div className="grid gap-2">
            <button
              onClick={() => { setHost('svn.apache.org'); setPort('3690'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">svn.apache.org:3690</span>
              <span className="ml-2 text-slate-400">- Apache Software Foundation SVN</span>
            </button>
            <button
              onClick={() => { setHost('localhost'); setPort('3690'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:3690</span>
              <span className="ml-2 text-slate-400">- Local svnserve instance</span>
            </button>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Common Capabilities</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <div><span className="font-mono text-blue-300">edit-pipeline</span> — Streaming edit operations</div>
            <div><span className="font-mono text-blue-300">svndiff1</span> — Compressed delta encoding</div>
            <div><span className="font-mono text-blue-300">absent-entries</span> — Sparse checkout support</div>
            <div><span className="font-mono text-blue-300">depth</span> — Checkout depth (empty, files, immediates, infinity)</div>
            <div><span className="font-mono text-blue-300">mergeinfo</span> — Merge tracking support</div>
            <div><span className="font-mono text-blue-300">log-revprops</span> — Revision property retrieval in log</div>
            <div><span className="font-mono text-blue-300">atomic-revprops</span> — Atomic revision property changes</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
