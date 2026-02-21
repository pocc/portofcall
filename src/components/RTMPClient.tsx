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

interface RTMPClientProps {
  onBack: () => void;
}

export default function RTMPClient({ onBack }: RTMPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1935');
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
      const response = await fetch('/api/rtmp/connect', {
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
        host?: string;
        port?: number;
        connectTime?: number;
        rtt?: number;
        serverVersion?: number;
        serverTime?: number;
        handshakeValid?: boolean;
        handshakeComplete?: boolean;
        isCloudflare?: boolean;
      };

      if (response.ok && data.success) {
        let resultText = `Connected to RTMP server at ${data.host}:${data.port}\n\n`;
        resultText += `RTMP Version: ${data.serverVersion} (0x${data.serverVersion?.toString(16).padStart(2, '0')})\n`;
        resultText += `Connect Time: ${data.connectTime}ms\n`;
        resultText += `Round Trip Time: ${data.rtt}ms\n\n`;
        resultText += `Server Timestamp: ${data.serverTime}\n`;
        resultText += `Handshake Complete: ${data.handshakeComplete ? 'Yes' : 'No'}\n`;
        resultText += `Handshake Valid: ${data.handshakeValid ? 'Yes (C1 echo verified)' : 'No (C1 echo mismatch)'}\n`;

        if (data.serverVersion === 3) {
          resultText += `\nProtocol: Standard RTMP (version 3)`;
        } else if (data.serverVersion === 6) {
          resultText += `\nProtocol: RTMPE (encrypted, version 6)`;
        } else {
          resultText += `\nProtocol: Non-standard version ${data.serverVersion}`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Failed to connect to RTMP server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to RTMP server');
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
    <ProtocolClientLayout title="RTMP Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.RTMP || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="RTMP Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rtmp-host"
            label="RTMP Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="live.twitch.tv"
            required
            helpText="RTMP streaming server address"
            error={errors.host}
          />

          <FormField
            id="rtmp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 1935 (RTMP), 443 (RTMPS)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect to RTMP server"
        >
          Test Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About RTMP Protocol"
          description="RTMP (Real-Time Messaging Protocol) is used for live video streaming to platforms like Twitch, YouTube Live, and Facebook Live. This tool performs the RTMP handshake to verify server connectivity, detect the protocol version, and validate the handshake echo."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">RTMP Handshake</h3>
          <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs">
            <pre className="text-slate-200">
{`C0 (1 byte):   Version (0x03 = RTMP, 0x06 = RTMPE)
C1 (1536 bytes): timestamp(4) + zero(4) + random(1528)
S0 (1 byte):   Server version
S1 (1536 bytes): timestamp(4) + zero(4) + random(1528)
S2 (1536 bytes): echo of C1 (timestamp + time2 + random)
C2 (1536 bytes): echo of S1 (timestamp + time2 + random)

Total handshake: 6146 bytes exchanged`}
            </pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Common RTMP Servers</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Platform</th>
                  <th className="text-left py-2 px-2 text-slate-300">Server URL</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Twitch</td>
                  <td className="py-2 px-2 font-mono">live.twitch.tv/app</td>
                  <td className="py-2 px-2 font-mono">1935</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">YouTube</td>
                  <td className="py-2 px-2 font-mono">a.rtmp.youtube.com/live2</td>
                  <td className="py-2 px-2 font-mono">1935</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">Facebook</td>
                  <td className="py-2 px-2 font-mono">live-api-s.facebook.com/rtmp</td>
                  <td className="py-2 px-2 font-mono">443</td>
                </tr>
                <tr>
                  <td className="py-2 px-2">NGINX-RTMP</td>
                  <td className="py-2 px-2 font-mono">your-server/live</td>
                  <td className="py-2 px-2 font-mono">1935</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Streaming Protocol Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Protocol</th>
                  <th className="text-left py-2 px-2 text-slate-300">Port</th>
                  <th className="text-left py-2 px-2 text-slate-300">Latency</th>
                  <th className="text-left py-2 px-2 text-slate-300">Use Case</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">RTMP</td>
                  <td className="py-2 px-2 font-mono">1935</td>
                  <td className="py-2 px-2">2-5s</td>
                  <td className="py-2 px-2">Live ingest (publish)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">RTSP</td>
                  <td className="py-2 px-2 font-mono">554</td>
                  <td className="py-2 px-2">&lt;1s</td>
                  <td className="py-2 px-2">IP cameras, surveillance</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2">HLS</td>
                  <td className="py-2 px-2 font-mono">443</td>
                  <td className="py-2 px-2">10-30s</td>
                  <td className="py-2 px-2">Playback (adaptive)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2">WebRTC</td>
                  <td className="py-2 px-2 font-mono">various</td>
                  <td className="py-2 px-2">&lt;500ms</td>
                  <td className="py-2 px-2">Real-time P2P</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
