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

interface MPDClientProps {
  onBack: () => void;
}

interface MpdKeyValue {
  key: string;
  value: string;
}

export default function MPDClient({ onBack }: MPDClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6600');
  const [password, setPassword] = useState('');
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required'), validationRules.hostname()],
    port: [validationRules.port()],
  });

  const handleStatus = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/mpd/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          password: password || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        server?: string;
        version?: string;
        status?: MpdKeyValue[];
        stats?: MpdKeyValue[];
        currentSong?: MpdKeyValue[];
      };

      if (response.ok && data.success) {
        const lines = [
          `MPD Server Status`,
          `Server: ${data.server}`,
          `MPD Version: ${data.version}`,
          `${'='.repeat(60)}`,
          '',
        ];

        if (data.status && data.status.length > 0) {
          lines.push('--- Player Status ---');
          for (const kv of data.status) {
            lines.push(`  ${kv.key}: ${kv.value}`);
          }
          lines.push('');
        }

        if (data.stats && data.stats.length > 0) {
          lines.push('--- Database Stats ---');
          for (const kv of data.stats) {
            lines.push(`  ${kv.key}: ${kv.value}`);
          }
          lines.push('');
        }

        if (data.currentSong && data.currentSong.length > 0) {
          lines.push('--- Current Song ---');
          for (const kv of data.currentSong) {
            lines.push(`  ${kv.key}: ${kv.value}`);
          }
        } else {
          lines.push('No song currently playing.');
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'Failed to get MPD status');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get MPD status');
    } finally {
      setLoading(false);
    }
  };

  const handleCommand = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid || !command.trim()) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/mpd/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          password: password || undefined,
          command: command.trim(),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        server?: string;
        version?: string;
        command?: string;
        response?: MpdKeyValue[];
        raw?: string;
      };

      if (response.ok && data.success) {
        const lines = [
          `MPD Command: ${data.command}`,
          `Server: ${data.server} (MPD ${data.version})`,
          `${'='.repeat(60)}`,
          '',
        ];

        if (data.response && data.response.length > 0) {
          for (const kv of data.response) {
            lines.push(`${kv.key}: ${kv.value}`);
          }
        } else {
          lines.push('(empty response)');
        }

        if (data.raw) {
          lines.push('', '--- Raw Response ---', data.raw);
        }

        setResult(lines.join('\n'));
      } else {
        setError(data.error || 'MPD command failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MPD command failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleStatus();
    }
  };

  return (
    <ProtocolClientLayout title="MPD Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.MPD || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="MPD Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="mpd-host"
            label="MPD Server Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="music.example.com"
            required
            helpText="MPD server hostname or IP address"
            error={errors.host}
          />

          <FormField
            id="mpd-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 6600 (standard MPD port)"
            error={errors.port}
          />

          <FormField
            id="mpd-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="(optional)"
            optional
            helpText="MPD server password if required"
          />
        </div>

        <SectionHeader stepNumber={2} title="Actions" color="green" />

        <div className="grid md:grid-cols-2 gap-3 mb-4">
          <ActionButton
            onClick={handleStatus}
            disabled={loading || !host}
            loading={loading}
            ariaLabel="Get MPD server status"
          >
            Get Status
          </ActionButton>

          <div className="flex gap-2">
            <div className="flex-1">
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading && host && command.trim()) {
                    handleCommand();
                  }
                }}
                placeholder="e.g. outputs, listplaylists, stats"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <ActionButton
              onClick={handleCommand}
              disabled={loading || !host || !command.trim()}
              loading={loading}
              variant="secondary"
              ariaLabel="Run MPD command"
            >
              Run
            </ActionButton>
          </div>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About MPD Protocol"
          description="MPD (Music Player Daemon) is a flexible, server-side music player. It plays audio files, organizes playlists, and maintains a music database — all controlled via a simple text protocol over TCP (port 6600). MPD separates the player from the interface: dozens of clients exist (ncmpcpp, mpc, Cantata, etc.). Status queries show playback state, volume, current song, database stats, and audio outputs."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Available Read-Only Commands</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              { cmd: 'status', desc: 'Player state & volume' },
              { cmd: 'stats', desc: 'Database statistics' },
              { cmd: 'currentsong', desc: 'Now playing metadata' },
              { cmd: 'outputs', desc: 'Audio output devices' },
              { cmd: 'listplaylists', desc: 'Saved playlists' },
              { cmd: 'commands', desc: 'Available commands' },
              { cmd: 'tagtypes', desc: 'Supported tag types' },
              { cmd: 'decoders', desc: 'Audio codec support' },
              { cmd: 'urlhandlers', desc: 'Stream URL protocols' },
            ].map(({ cmd, desc }) => (
              <button
                key={cmd}
                onClick={() => setCommand(cmd)}
                className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded text-left transition-colors"
              >
                <span className="font-mono text-blue-400">{cmd}</span>
                <span className="block text-xs text-slate-400">{desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Popular MPD Clients</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {[
              { name: 'ncmpcpp', type: 'TUI (C++)' },
              { name: 'mpc', type: 'CLI' },
              { name: 'Cantata', type: 'Desktop GUI' },
              { name: 'MALP', type: 'Android' },
              { name: 'Aurern', type: 'Android' },
              { name: 'Ympd', type: 'Web UI' },
              { name: 'Rompr', type: 'Web UI' },
              { name: 'MPDroid', type: 'Android' },
            ].map(({ name, type }) => (
              <div key={name} className="bg-slate-700/50 rounded px-2 py-1.5">
                <span className="text-slate-200 font-medium">{name}</span>
                <span className="block text-slate-500">{type}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
