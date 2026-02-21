import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface IcecastClientProps {
  onBack: () => void;
}

interface MountPoint {
  name: string;
  listeners: number;
  peakListeners?: number;
  genre?: string;
  title?: string;
  description?: string;
  contentType?: string;
  bitrate?: number;
}

export default function IcecastClient({ onBack }: IcecastClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8000');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [serverInfo, setServerInfo] = useState<{
    rtt?: number;
    server?: string;
    isIcecast?: boolean;
    totalListeners?: number;
    mountCount?: number;
    serverStart?: string;
  } | null>(null);
  const [mountPoints, setMountPoints] = useState<MountPoint[]>([]);

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
    setMountPoints([]);

    try {
      const response = await fetch('/api/icecast/status', {
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
        rtt?: number;
        server?: string;
        isIcecast?: boolean;
        serverInfo?: {
          admin?: string;
          host?: string;
          location?: string;
          serverId?: string;
          serverStart?: string;
        };
        mountPoints?: MountPoint[];
        totalListeners?: number;
        mountCount?: number;
      };

      if (response.ok && data.success) {
        setResult(data.message || 'Connected successfully');
        setServerInfo({
          rtt: data.rtt,
          server: data.server || undefined,
          isIcecast: data.isIcecast,
          totalListeners: data.totalListeners,
          mountCount: data.mountCount,
          serverStart: data.serverInfo?.serverStart,
        });
        setMountPoints(data.mountPoints || []);
      } else {
        setError(data.error || 'Failed to connect to Icecast server');
        if (data.rtt) {
          setServerInfo({
            rtt: data.rtt,
            server: data.server || undefined,
            isIcecast: data.isIcecast,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to Icecast server');
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
    <ProtocolClientLayout title="Icecast Streaming Server Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Icecast Server Configuration" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="icecast-host"
            label="Icecast Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="icecast.example.com"
            required
            helpText="Icecast or Shoutcast streaming server address"
            error={errors.host}
          />

          <FormField
            id="icecast-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 8000 (Icecast), 8080 (alt)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe Icecast server"
        >
          Probe Server
        </ActionButton>

        {serverInfo && (
          <div className="mt-6 bg-slate-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Server Info</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {serverInfo.rtt !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Round-Trip Time</div>
                  <div className="text-lg font-bold text-yellow-400">{serverInfo.rtt}ms</div>
                </div>
              )}
              {serverInfo.isIcecast !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Icecast Server</div>
                  <div className={`text-lg font-bold ${serverInfo.isIcecast ? 'text-green-400' : 'text-orange-400'}`}>
                    {serverInfo.isIcecast ? 'Yes' : 'Unknown'}
                  </div>
                </div>
              )}
              {serverInfo.totalListeners !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Total Listeners</div>
                  <div className="text-lg font-bold text-blue-400">{serverInfo.totalListeners}</div>
                </div>
              )}
              {serverInfo.mountCount !== undefined && (
                <div>
                  <div className="text-xs text-slate-400">Mount Points</div>
                  <div className="text-lg font-bold text-purple-400">{serverInfo.mountCount}</div>
                </div>
              )}
            </div>
            {serverInfo.server && (
              <div className="mt-3 pt-3 border-t border-slate-600">
                <div className="text-xs text-slate-400">Server</div>
                <div className="text-sm font-mono text-slate-300">{serverInfo.server}</div>
              </div>
            )}
            {serverInfo.serverStart && (
              <div className="mt-2">
                <div className="text-xs text-slate-400">Server Start</div>
                <div className="text-sm font-mono text-slate-300">{serverInfo.serverStart}</div>
              </div>
            )}
          </div>
        )}

        {mountPoints.length > 0 && (
          <div className="mt-6 bg-slate-700 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Mount Points ({mountPoints.length})</h3>
            <div className="space-y-3">
              {mountPoints.map((mp, idx) => (
                <div key={idx} className="bg-slate-800 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-blue-400 text-sm">{mp.name}</span>
                    <span className="text-xs bg-green-600/30 text-green-300 px-2 py-0.5 rounded">
                      {mp.listeners} listener{mp.listeners !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-slate-400">
                    {mp.title && (
                      <div>
                        <span className="text-slate-500">Title:</span>{' '}
                        <span className="text-slate-300">{mp.title}</span>
                      </div>
                    )}
                    {mp.genre && (
                      <div>
                        <span className="text-slate-500">Genre:</span>{' '}
                        <span className="text-slate-300">{mp.genre}</span>
                      </div>
                    )}
                    {mp.contentType && (
                      <div>
                        <span className="text-slate-500">Format:</span>{' '}
                        <span className="text-slate-300">{mp.contentType}</span>
                      </div>
                    )}
                    {mp.bitrate && (
                      <div>
                        <span className="text-slate-500">Bitrate:</span>{' '}
                        <span className="text-slate-300">{mp.bitrate} kbps</span>
                      </div>
                    )}
                    {mp.peakListeners !== undefined && (
                      <div>
                        <span className="text-slate-500">Peak:</span>{' '}
                        <span className="text-slate-300">{mp.peakListeners}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Icecast Protocol"
          description="Icecast is an open-source streaming media server supporting Ogg Vorbis, MP3, Opus, and other formats. It uses HTTP for both streaming and status queries. The /status-json.xsl endpoint provides JSON status data including active mount points, listener counts, and stream metadata. Admin stats require HTTP Basic authentication."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Technical Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">HTTP/1.1 over TCP</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Port:</td>
                  <td className="py-2 px-2">8000</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Status Endpoint:</td>
                  <td className="py-2 px-2 font-mono">/status-json.xsl</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Admin Endpoint:</td>
                  <td className="py-2 px-2 font-mono">/admin/stats</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Formats:</td>
                  <td className="py-2 px-2">Ogg Vorbis, MP3, Opus, FLAC, AAC+</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Authentication:</td>
                  <td className="py-2 px-2">HTTP Basic Auth (admin endpoints only)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Architecture</h3>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto">
            <pre>{`┌─────────────┐                    ┌─────────────┐
│   Source    │ ── Audio Stream ─> │   Icecast   │
│  (encoder)  │                    │   Server    │
└─────────────┘                    │  (:8000)    │
                                   └──────┬──────┘
                    ┌──────────┬──────────┼──────────┐
                    │          │          │          │
               ┌────▼───┐ ┌───▼────┐ ┌───▼────┐ ┌──▼─────┐
               │Listener│ │Listener│ │Listener│ │ Status │
               │  (MP3) │ │ (Ogg)  │ │ (Opus) │ │  JSON  │
               └────────┘ └────────┘ └────────┘ └────────┘`}</pre>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Example Configurations</h3>
          <div className="grid gap-2">
            <button
              onClick={() => { setHost('localhost'); setPort('8000'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:8000</span>
              <span className="ml-2 text-slate-400">- Local Icecast server</span>
            </button>
            <button
              onClick={() => { setHost('localhost'); setPort('8080'); }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:8080</span>
              <span className="ml-2 text-slate-400">- Alternate port</span>
            </button>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
