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
import { usePersistedState } from '../hooks/usePersistedState';

type Action = 'connect' | 'stat' | 'read' | 'ls';

interface NinePClientProps {
  onBack: () => void;
}

function describeQidType(t: number): string {
  const flags: string[] = [];
  if (t & 0x80) flags.push('directory');
  if (t & 0x40) flags.push('append-only');
  if (t & 0x20) flags.push('exclusive');
  if (t & 0x10) flags.push('mounted channel');
  if (t & 0x08) flags.push('auth file');
  if (t & 0x04) flags.push('temp');
  return flags.length > 0 ? flags.join(', ') : 'file';
}

function formatMode(mode: number): string {
  const isDir = (mode & 0x80000000) !== 0;
  const isAppend = (mode & 0x40000000) !== 0;
  const isExcl = (mode & 0x20000000) !== 0;
  const isMount = (mode & 0x10000000) !== 0;
  const isAuth = (mode & 0x08000000) !== 0;
  const isTmp = (mode & 0x04000000) !== 0;
  const typeChar = isDir ? 'd' : isMount ? 'M' : isAuth ? 'A' : '-';
  const perms = mode & 0x1ff;
  const rwx = (p: number) =>
    `${p & 4 ? 'r' : '-'}${p & 2 ? 'w' : '-'}${p & 1 ? 'x' : '-'}`;
  const flags = [isAppend ? 'a' : '', isExcl ? 'l' : '', isTmp ? 't' : ''].filter(Boolean).join('');
  return `${typeChar}${rwx(perms >> 6)}${rwx((perms >> 3) & 7)}${rwx(perms & 7)}${flags ? ' [' + flags + ']' : ''}`;
}

function formatTimestamp(unix: number): string {
  // Returns "YYYY-MM-DD HH:MM:SS" — exactly 19 chars for column alignment
  return new Date(unix * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

export default function NinePClient({ onBack }: NinePClientProps) {
  const [action, setAction] = useState<Action>('connect');
  const [host, setHost] = usePersistedState('ninep-host', '');
  const [port, setPort] = usePersistedState('ninep-port', '564');
  const [path, setPath] = usePersistedState('ninep-path', '');
  const [offset, setOffset] = usePersistedState('ninep-offset', '0');
  const [count, setCount] = usePersistedState('ninep-count', '4096');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const reset = () => {
    setError('');
    setResult('');
  };

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    reset();

    try {
      const response = await fetch('/api/9p/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port, 10), timeout: 10000 }),
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
          resultText += `  Type: ${data.rootQid.type} (${describeQidType(data.rootQid.type)})\n`;
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

  const handleStat = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    reset();

    try {
      const response = await fetch('/api/9p/stat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          path: path || '',
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        path?: string;
        stat?: {
          type: number; dev: number;
          qid: { type: number; version: number; path: string };
          mode: number; atime: number; mtime: number;
          length: string; name: string; uid: string; gid: string; muid: string;
        };
        error?: string;
      };

      if (response.ok && data.success && data.stat) {
        const s = data.stat;
        let t = `Stat: ${data.path}\n${'='.repeat(40)}\n\n`;
        t += `Name:     ${s.name}\n`;
        t += `Mode:     ${formatMode(s.mode)} (0x${s.mode.toString(16)})\n`;
        t += `Size:     ${s.length} bytes\n`;
        t += `UID:      ${s.uid}\n`;
        t += `GID:      ${s.gid}\n`;
        t += `Modified: ${s.muid} at ${formatTimestamp(s.mtime)}\n`;
        t += `Accessed: ${formatTimestamp(s.atime)}\n`;
        t += `\nQID:\n`;
        t += `  Type:    ${s.qid.type} (${describeQidType(s.qid.type)})\n`;
        t += `  Version: ${s.qid.version}\n`;
        t += `  Path:    ${s.qid.path}\n`;
        t += `\nDev: ${s.dev}  Type: ${s.type}\n`;
        setResult(t);
      } else {
        setError(data.error || 'Stat failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stat failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRead = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;
    if (!path.trim()) {
      setError('Path is required for read');
      return;
    }

    setLoading(true);
    reset();

    try {
      const response = await fetch('/api/9p/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          path: path.trim(),
          offset: parseInt(offset, 10) || 0,
          count: parseInt(count, 10) || 4096,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        path?: string;
        offset?: number;
        bytesRead?: number;
        data?: string;
        encoding?: string;
        error?: string;
      };

      if (response.ok && data.success) {
        let t = `Read: ${data.path}\n${'='.repeat(40)}\n\n`;
        t += `Offset:     ${data.offset ?? 0}\n`;
        t += `Bytes Read: ${data.bytesRead ?? 0}\n\n`;
        if (data.data && data.bytesRead && data.bytesRead > 0) {
          try {
            const decoded = atob(data.data);
            const isPrintable = [...decoded].every(c => {
              const code = c.charCodeAt(0);
              return code >= 32 || code === 9 || code === 10 || code === 13;
            });
            if (isPrintable) {
              t += `Content:\n${'─'.repeat(40)}\n${decoded}`;
            } else {
              t += `Content (base64, binary data):\n${data.data}`;
            }
          } catch {
            t += `Content (base64):\n${data.data}`;
          }
        } else {
          t += '(empty — EOF or zero bytes read)';
        }
        setResult(t);
      } else {
        setError(data.error || 'Read failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Read failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLs = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    reset();

    try {
      const response = await fetch('/api/9p/ls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          path: path || '',
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        path?: string;
        count?: number;
        truncated?: boolean;
        entries?: Array<{
          type: number; dev: number;
          qid: { type: number; version: number; path: string };
          mode: number; atime: number; mtime: number;
          length: string; name: string; uid: string; gid: string; muid: string;
        }>;
        error?: string;
      };

      if (response.ok && data.success) {
        let t = `Directory: ${data.path}\n${'='.repeat(40)}\n`;
        t += `${data.count ?? 0} entries`;
        if (data.truncated) {
          t += ` (listing may be incomplete — did not reach end of directory)`;
        }
        t += `\n\n`;
        if (data.entries && data.entries.length > 0) {
          // Column header (Mode=11, Size=12, Modified=19, Name=variable)
          t += `${'Mode'.padEnd(11)} ${'Size'.padStart(12)} ${'Modified'.padEnd(19)} Name\n`;
          t += `${'─'.repeat(11)} ${'─'.repeat(12)} ${'─'.repeat(19)} ${'─'.repeat(20)}\n`;
          for (const e of data.entries) {
            const modeStr = formatMode(e.mode).padEnd(11);
            const sizeStr = e.length.padStart(12);
            const modStr = formatTimestamp(e.mtime).padEnd(19);
            t += `${modeStr} ${sizeStr} ${modStr} ${e.name}\n`;
          }
        } else {
          t += '(empty directory)';
        }
        setResult(t);
      } else {
        setError(data.error || 'Directory listing failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Directory listing failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    switch (action) {
      case 'connect': return handleConnect();
      case 'stat': return handleStat();
      case 'read': return handleRead();
      case 'ls': return handleLs();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleSubmit();
    }
  };

  const actionLabels: Record<Action, string> = {
    connect: 'Connect',
    stat: 'Stat',
    read: 'Read',
    ls: 'ls',
  };

  const buttonLabels: Record<Action, string> = {
    connect: 'Connect & Probe',
    stat: 'Stat Path',
    read: 'Read File',
    ls: 'List Directory',
  };

  const ariaLabels: Record<Action, string> = {
    connect: 'Connect to 9P server',
    stat: 'Stat path on 9P server',
    read: 'Read file from 9P server',
    ls: 'List directory on 9P server',
  };

  return (
    <ProtocolClientLayout title="9P Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="9P Server Connection" />

        {/* Action tabs */}
        <div className="flex gap-2 mb-6 flex-wrap" role="tablist" aria-label="9P operation">
          {(Object.keys(actionLabels) as Action[]).map(a => (
            <button
              key={a}
              id={`9p-tab-${a}`}
              role="tab"
              tabIndex={action === a ? 0 : -1}
              aria-selected={action === a}
              aria-controls="9p-tabpanel"
              onClick={() => { setAction(a); reset(); }}
              onKeyDown={(e) => {
                const tabs = Object.keys(actionLabels) as Action[];
                const idx = tabs.indexOf(a);
                let next: Action | undefined;
                if (e.key === 'ArrowRight') next = tabs[(idx + 1) % tabs.length];
                else if (e.key === 'ArrowLeft') next = tabs[(idx - 1 + tabs.length) % tabs.length];
                else if (e.key === 'Home') next = tabs[0];
                else if (e.key === 'End') next = tabs[tabs.length - 1];
                if (next) {
                  e.preventDefault();
                  setAction(next);
                  reset();
                  document.getElementById(`9p-tab-${next}`)?.focus();
                }
              }}
              className={`px-3 py-1.5 rounded text-sm font-mono transition-colors ${
                action === a
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {actionLabels[a]}
            </button>
          ))}
        </div>

        <div id="9p-tabpanel" role="tabpanel" aria-labelledby={`9p-tab-${action}`}>
        <div className="grid md:grid-cols-2 gap-4 mb-4">
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

        {/* Path field for stat/read/ls */}
        {(action === 'stat' || action === 'read' || action === 'ls') && (
          <div className="mb-4">
            <FormField
              id="9p-path"
              label={`Path${action === 'read' ? '' : ' (optional, default: root)'}`}
              type="text"
              value={path}
              onChange={setPath}
              onKeyDown={handleKeyDown}
              placeholder={action === 'read' ? 'etc/motd' : 'usr/local/bin'}
              required={action === 'read'}
              helpText="Slash-separated path. Leave empty for root."
            />
          </div>
        )}

        {/* Offset/Count for read */}
        {action === 'read' && (
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <FormField
              id="9p-offset"
              label="Offset (bytes)"
              type="number"
              value={offset}
              onChange={setOffset}
              onKeyDown={handleKeyDown}
              min="0"
              helpText="Byte offset to start reading (default: 0)"
            />
            <FormField
              id="9p-count"
              label="Count (bytes)"
              type="number"
              value={count}
              onChange={setCount}
              onKeyDown={handleKeyDown}
              min="1"
              max="65536"
              helpText="Max bytes to read (1-65536, default: 4096)"
            />
          </div>
        )}

        <ActionButton
          onClick={handleSubmit}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel={ariaLabels[action]}
        >
          {buttonLabels[action]}
        </ActionButton>

        <ResultDisplay result={result} error={error} />
        </div>

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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Operations</h3>
          <div className="space-y-2 text-xs text-slate-400">
            <p><strong className="text-slate-300">connect</strong> — Tversion + Tattach handshake, returns server version and root QID</p>
            <p><strong className="text-slate-300">stat</strong> — Walk to path and retrieve file metadata (size, mode, uid, mtime)</p>
            <p><strong className="text-slate-300">read</strong> — Walk, open, and read file contents (returned as decoded text or base64)</p>
            <p><strong className="text-slate-300">ls</strong> — Walk to directory, open and read its entries (concatenated stat records)</p>
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
      <ApiExamples examples={apiExamples.NineP || []} protocolId="ninep" />

    </ProtocolClientLayout>
  );
}
