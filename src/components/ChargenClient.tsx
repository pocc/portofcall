import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface ChargenClientProps {
  onBack: () => void;
}

export default function ChargenClient({ onBack }: ChargenClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('19');
  const [maxBytes, setMaxBytes] = useState('10240');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [stats, setStats] = useState<{
    bytes: number;
    lines: number;
    duration: number;
    bandwidth: string;
  } | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleReceiveStream = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setStats(null);

    try {
      const response = await fetch('/api/chargen/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          maxBytes: parseInt(maxBytes),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        data?: string;
        bytes?: number;
        lines?: number;
        duration?: number;
        bandwidth?: string;
      };

      if (response.ok && data.success) {
        setResult(data.data || '(No data received)');

        if (data.bytes !== undefined && data.lines !== undefined &&
            data.duration !== undefined && data.bandwidth) {
          setStats({
            bytes: data.bytes,
            lines: data.lines,
            duration: data.duration,
            bandwidth: data.bandwidth,
          });
        }
      } else {
        setError(data.error || 'Failed to receive CHARGEN stream');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to receive CHARGEN stream');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleReceiveStream();
    }
  };

  const handleExampleServer = (serverHost: string, bytes: string) => {
    setHost(serverHost);
    setPort('19');
    setMaxBytes(bytes);
  };

  const examplePattern = `!"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefgh
"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghi
#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghij
$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghijk
%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghijkl`;

  return (
    <ProtocolClientLayout title="CHARGEN Protocol Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="CHARGEN Server Configuration" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="chargen-host"
            label="CHARGEN Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="chargen.example.com"
            required
            helpText="Server running CHARGEN on port 19"
            error={errors.host}
          />

          <FormField
            id="chargen-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 19 (standard CHARGEN port)"
            error={errors.port}
          />

          <FormField
            id="chargen-maxbytes"
            label="Max Bytes"
            type="number"
            value={maxBytes}
            onChange={setMaxBytes}
            onKeyDown={handleKeyDown}
            min="100"
            max="1048576"
            helpText="Limit stream size (10KB default)"
          />
        </div>

        <ActionButton
          onClick={handleReceiveStream}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Receive character stream from CHARGEN server"
        >
          Receive Stream
        </ActionButton>

        {stats && (
          <div className="mt-6 bg-slate-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Statistics</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-slate-400">Bytes Received</div>
                <div className="text-lg font-bold text-blue-400">{stats.bytes.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Lines</div>
                <div className="text-lg font-bold text-green-400">{stats.lines.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Duration</div>
                <div className="text-lg font-bold text-yellow-400">{(stats.duration / 1000).toFixed(2)}s</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Bandwidth</div>
                <div className="text-lg font-bold text-purple-400">{stats.bandwidth}</div>
              </div>
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About CHARGEN Protocol"
          description="CHARGEN (RFC 864, 1983) sends continuous ASCII character streams for network testing. Server sends 72-character rotating pattern lines until client disconnects. Used for bandwidth testing and buffer handling. Now obsolete and often disabled due to amplification attack risks."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Configurations</h3>
          <div className="grid gap-2">
            <button
              onClick={() => handleExampleServer('localhost', '5120')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:19</span>
              <span className="ml-2 text-slate-400">- 5KB stream (local testing)</span>
            </button>
            <button
              onClick={() => handleExampleServer('localhost', '10240')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:19</span>
              <span className="ml-2 text-slate-400">- 10KB stream (default)</span>
            </button>
            <button
              onClick={() => handleExampleServer('localhost', '102400')}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:19</span>
              <span className="ml-2 text-slate-400">- 100KB stream (bandwidth test)</span>
            </button>
          </div>
          <div className="mt-4 bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              ⚠️ <strong>Note:</strong> Most public CHARGEN servers have been disabled due to
              amplification attack risks. This protocol is obsolete but useful for educational purposes
              and local network testing.
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Standard Pattern (First 5 Lines)</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs overflow-x-auto">
            <pre className="text-slate-200 whitespace-pre">{examplePattern}</pre>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Each line contains 72 printable ASCII characters (ASCII 33-126) plus \r\n.
            The pattern rotates by 1 character per line, cycling through all 94 printable characters.
          </p>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Technical Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Character Set:</td>
                  <td className="py-2 px-2">ASCII 33 (!) to 126 (~) = 94 printable characters</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Line Format:</td>
                  <td className="py-2 px-2">72 characters + \r\n = 74 bytes per line</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Pattern:</td>
                  <td className="py-2 px-2">Rotates by 1 character each line, repeats after 94 lines</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Stream Type:</td>
                  <td className="py-2 px-2">Continuous (infinite until disconnect)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Use Case:</td>
                  <td className="py-2 px-2">Network testing, bandwidth measurement, buffer testing</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">⚠️ Security Warning</h3>
          <div className="bg-red-900/20 border border-red-600/30 rounded-lg p-3">
            <p className="text-xs text-red-200 mb-2">
              <strong>CHARGEN is a security risk</strong> and has been disabled on most modern systems.
            </p>
            <ul className="text-xs text-red-200 list-disc list-inside space-y-1">
              <li>No authentication or encryption</li>
              <li>Can be used for DDoS amplification attacks</li>
              <li>Small UDP request → large TCP response (attack vector)</li>
              <li>Port 19 is typically filtered by firewalls</li>
              <li>Listed in CERT/CC vulnerability notes (VU#800113)</li>
              <li><strong>Do not expose CHARGEN servers to the public internet</strong></li>
            </ul>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Historical Context</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p>
              📜 <strong>1983:</strong> CHARGEN protocol created (RFC 864)
            </p>
            <p>
              🌐 <strong>1980s-1990s:</strong> Widely used for network testing
            </p>
            <p>
              ⚠️ <strong>2000s:</strong> Identified as DDoS amplification vector
            </p>
            <p>
              🔒 <strong>2010s:</strong> Disabled by default on modern systems
            </p>
            <p>
              📚 <strong>Today:</strong> Educational value, protocol archaeology
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
