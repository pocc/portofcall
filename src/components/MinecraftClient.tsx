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

interface MinecraftClientProps {
  onBack: () => void;
}

interface ServerStatus {
  version?: { name: string; protocol: number };
  players?: { max: number; online: number; sample?: Array<{ name: string; id: string }> };
  description?: string;
  favicon?: string;
  latency?: number;
}

export default function MinecraftClient({ onBack }: MinecraftClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('25565');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [pinging, setPinging] = useState(false);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleStatus = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');
    setServerStatus(null);

    try {
      const response = await fetch('/api/minecraft/status', {
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
        version?: { name: string; protocol: number };
        players?: { max: number; online: number; sample?: Array<{ name: string; id: string }> };
        description?: string;
        favicon?: string;
        latency?: number;
        rawJson?: string;
        error?: string;
      };

      if (response.ok && data.success) {
        setServerStatus({
          version: data.version,
          players: data.players,
          description: data.description,
          favicon: data.favicon,
          latency: data.latency,
        });

        const lines = [
          `Server: ${host}:${port}`,
          `Version: ${data.version?.name || 'Unknown'} (protocol ${data.version?.protocol || '?'})`,
          `Players: ${data.players?.online || 0}/${data.players?.max || 0}`,
          `MOTD: ${data.description || '(none)'}`,
        ];
        if (data.latency !== undefined) {
          lines.push(`Latency: ${data.latency}ms`);
        }
        if (data.players?.sample && data.players.sample.length > 0) {
          lines.push('', 'Online Players:');
          for (const p of data.players.sample) {
            lines.push(`  - ${p.name}`);
          }
        }
        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to query server status');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePing = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setPinging(true);
    setError('');

    try {
      const response = await fetch('/api/minecraft/ping', {
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
        tcpLatency?: number;
        pingLatency?: number;
        pongValid?: boolean;
        error?: string;
      };

      if (response.ok && data.success) {
        setResult((prev) => {
          const pingInfo = [
            '',
            '--- Ping Results ---',
            `TCP Handshake: ${data.tcpLatency}ms`,
            `Protocol Ping: ${data.pingLatency}ms`,
            `Pong Valid: ${data.pongValid ? 'Yes' : 'No'}`,
          ].join('\n');
          return prev ? prev + pingInfo : pingInfo;
        });
      } else {
        setError(data.error || 'Ping failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ping failed');
    } finally {
      setPinging(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleStatus();
    }
  };

  return (
    <ProtocolClientLayout title="Minecraft Server List Ping" onBack={onBack}>
      <ApiExamples examples={apiExamples.Minecraft || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Address" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="mc-host"
            label="Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="play.example.com"
            required
            helpText="Minecraft server address"
            error={errors.host}
          />

          <FormField
            id="mc-port"
            label="Server Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 25565"
            error={errors.port}
          />
        </div>

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handleStatus}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Query server status"
          >
            Query Status
          </ActionButton>

          <ActionButton
            onClick={handlePing}
            disabled={pinging || !host || !port}
            loading={pinging}
            variant="success"
            ariaLabel="Ping server for latency"
          >
            Ping
          </ActionButton>
        </div>

        {serverStatus && (
          <div className="mb-6">
            <SectionHeader stepNumber={2} title="Server Info" color="green" />

            <div className="bg-slate-700 rounded-lg p-4 space-y-3">
              {/* Favicon + MOTD */}
              <div className="flex items-start gap-4">
                {serverStatus.favicon && (
                  <img
                    src={serverStatus.favicon}
                    alt="Server icon"
                    className="w-16 h-16 rounded image-pixelated"
                    style={{ imageRendering: 'pixelated' }}
                  />
                )}
                <div className="flex-1">
                  <p className="text-lg font-semibold text-white">
                    {serverStatus.description || '(No MOTD)'}
                  </p>
                  <p className="text-sm text-slate-400">
                    {host}:{port}
                  </p>
                </div>
              </div>

              {/* Version */}
              {serverStatus.version && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase">Version</span>
                  <span className="text-sm text-green-400">{serverStatus.version.name}</span>
                  <span className="text-xs text-slate-500">(protocol {serverStatus.version.protocol})</span>
                </div>
              )}

              {/* Players */}
              {serverStatus.players && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase">Players</span>
                    <span className="text-sm text-blue-400">
                      {serverStatus.players.online}/{serverStatus.players.max}
                    </span>
                  </div>

                  {/* Player bar */}
                  <div className="w-full h-2 bg-slate-600 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all"
                      style={{
                        width: `${serverStatus.players.max > 0
                          ? (serverStatus.players.online / serverStatus.players.max) * 100
                          : 0}%`,
                      }}
                    />
                  </div>

                  {/* Player list */}
                  {serverStatus.players.sample && serverStatus.players.sample.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {serverStatus.players.sample.map((p) => (
                        <span
                          key={p.id}
                          className="text-xs bg-slate-600 text-slate-200 px-2 py-0.5 rounded"
                        >
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Latency */}
              {serverStatus.latency !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase">Latency</span>
                  <span className={`text-sm ${
                    serverStatus.latency < 100
                      ? 'text-green-400'
                      : serverStatus.latency < 200
                        ? 'text-yellow-400'
                        : 'text-red-400'
                  }`}>
                    {serverStatus.latency}ms
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Minecraft Server List Ping"
          description="The Server List Ping (SLP) protocol is used by Minecraft clients to query server status before connecting. It returns the server's version, MOTD (Message of the Day), player count, online players, and server icon. This is different from RCON (port 25575) which is for server administration."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Well-Known Servers</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { host: 'mc.hypixel.net', label: 'Hypixel' },
              { host: 'play.cubecraft.net', label: 'CubeCraft' },
              { host: 'mc.mineplex.com', label: 'Mineplex' },
              { host: 'play.hivemc.com', label: 'The Hive' },
            ].map(({ host: h, label }) => (
              <button
                key={h}
                onClick={() => setHost(h)}
                className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1 px-3 rounded transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">Port:</strong> 25565 (default game port)</p>
            <p><strong className="text-slate-300">Transport:</strong> TCP</p>
            <p><strong className="text-slate-300">Encoding:</strong> VarInt-framed binary packets</p>
            <p><strong className="text-slate-300">Flow:</strong> Handshake → Status Request → JSON Response → Ping → Pong</p>
            <p><strong className="text-slate-300">Auth:</strong> None (public status query)</p>
            <p><strong className="text-slate-300">Spec:</strong> wiki.vg/Server_List_Ping</p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
