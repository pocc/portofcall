import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface Quake3ClientProps {
  onBack: () => void;
}

interface Player {
  score: number;
  ping: number;
  name: string;
}

export default function Quake3Client({ onBack }: Quake3ClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('27960');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const formatResult = (data: {
    success?: boolean;
    host?: string;
    port?: number;
    tcpLatency?: number;
    command?: string;
    serverVars?: Record<string, string>;
    players?: Player[];
    playerCount?: number;
    maxPlayers?: number;
    mapName?: string;
    gameName?: string;
    note?: string;
  }, label: string) => {
    const lines = [
      `${label} — ${host}:${port}`,
      '='.repeat(60),
      `UDP Latency:  ${data.tcpLatency}ms`,
    ];
    if (data.mapName) lines.push(`Map:          ${data.mapName}`);
    if (data.gameName) lines.push(`Game:         ${data.gameName}`);
    if (data.playerCount !== undefined) {
      lines.push(`Players:      ${data.playerCount}/${data.maxPlayers ?? '?'}`);
    }

    if (data.serverVars && Object.keys(data.serverVars).length > 0) {
      lines.push('', '--- Server Variables ---');
      for (const [k, v] of Object.entries(data.serverVars)) {
        lines.push(`  ${k}: ${v}`);
      }
    }

    if (data.players && data.players.length > 0) {
      lines.push('', '--- Players ---');
      lines.push('  Score  Ping  Name');
      for (const p of data.players) {
        lines.push(`  ${String(p.score).padEnd(6)} ${String(p.ping).padEnd(5)} ${p.name}`);
      }
    } else if (data.playerCount === 0) {
      lines.push('', 'No players online.');
    }

    if (data.note) lines.push('', data.note);
    return lines.join('\n');
  };

  const handleStatus = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/quake3/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), command: 'getstatus', timeout: 10000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        tcpLatency?: number;
        command?: string;
        serverVars?: Record<string, string>;
        players?: Player[];
        playerCount?: number;
        maxPlayers?: number;
        mapName?: string;
        gameName?: string;
        note?: string;
      };

      if (data.success) {
        setResult(formatResult(data, 'Quake 3 getstatus'));
      } else {
        setError(data.error || 'Status query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleInfo = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/quake3/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), command: 'getinfo', timeout: 10000 }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        tcpLatency?: number;
        command?: string;
        serverVars?: Record<string, string>;
        players?: Player[];
        playerCount?: number;
        maxPlayers?: number;
        mapName?: string;
        gameName?: string;
        note?: string;
      };

      if (data.success) {
        setResult(formatResult(data, 'Quake 3 getinfo'));
      } else {
        setError(data.error || 'Info query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) handleStatus();
  };

  return (
    <ProtocolClientLayout title="Quake 3 Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Game Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="q3-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="q3.example.com or 192.168.1.1"
            required
            error={errors.host}
          />
          <FormField
            id="q3-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 27960 (Quake 3 standard)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Query" color="green" />

        <div className="flex gap-3 mb-6">
          <ActionButton
            onClick={handleStatus}
            disabled={loading || !host}
            loading={loading}
            ariaLabel="Query Quake 3 server status"
          >
            getstatus
          </ActionButton>
          <button
            onClick={handleInfo}
            disabled={loading || !host}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            getinfo
          </button>
        </div>

        <p className="text-xs text-slate-400 mb-6">
          <strong>getstatus</strong> — full server variables + player list.{' '}
          <strong>getinfo</strong> — summary only (no player details).
        </p>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Quake 3 Arena (port 27960)"
          description="Quake 3 Arena (1999) uses a UDP-based Out-of-Band (OOB) packet protocol for server discovery and status queries. Packets begin with 0xFF 0xFF 0xFF 0xFF followed by a command string. The server responds with key\value pairs for configuration and one line per connected player. This protocol influenced many later games: Quake 4, Enemy Territory, CoD, Wolfenstein, and hundreds of Quake engine derivatives. Port 27960 is the standard default for Quake 3, Urban Terror, OpenArena, and many mods."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Common Server Variables</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-400">
            <div><code className="text-slate-300">sv_hostname</code> — Server display name</div>
            <div><code className="text-slate-300">mapname</code> — Current map</div>
            <div><code className="text-slate-300">sv_maxclients</code> — Max player slots</div>
            <div><code className="text-slate-300">g_gametype</code> — Game mode (0=FFA, 3=TDM)</div>
            <div><code className="text-slate-300">version</code> — Engine/mod version</div>
            <div><code className="text-slate-300">g_needpass</code> — Password required (1=yes)</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
