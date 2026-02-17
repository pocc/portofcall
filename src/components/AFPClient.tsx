import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface AFPClientProps {
  onBack: () => void;
}

interface AFPVolume {
  name: string;
  hasPassword: boolean;
}

interface AFPDirEntry {
  name: string;
  isDir: boolean;
  nodeId?: number;
  modDate?: number;
  size?: number;
  attributes?: number;
}

type Tab = 'probe' | 'auth';

export default function AFPClient({ onBack }: AFPClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>('probe');

  // Connection fields (shared)
  const [host, setHost] = useState('');
  const [port, setPort] = useState('548');

  // Probe state
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeResult, setProbeResult] = useState<string>('');
  const [probeError, setProbeError] = useState<string>('');
  const [probeServerInfo, setProbeServerInfo] = useState<{
    status: string;
    serverName?: string;
    machineType?: string;
    afpVersions?: string[];
    uams?: string[];
    flags?: number;
    flagDescriptions?: string[];
    connectTime?: number;
    rtt?: number;
  } | null>(null);

  // Auth / session state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [uam, setUam] = useState('No User Authent');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [volumes, setVolumes] = useState<AFPVolume[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // File browser state
  const [selectedVolume, setSelectedVolume] = useState('');
  const [dirId, setDirId] = useState(2);
  const [dirPath, setDirPath] = useState<Array<{ name: string; id: number }>>([{ name: '/', id: 2 }]);
  const [entries, setEntries] = useState<AFPDirEntry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  // File operation state
  const [opLoading, setOpLoading] = useState(false);
  const [opResult, setOpResult] = useState('');
  const [opError, setOpError] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [renameTarget, setRenameTarget] = useState<AFPDirEntry | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [fileContent, setFileContent] = useState<{ name: string; content: string } | null>(null);

  const { errors: probeErrors, validateAll: validateProbe } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const { errors: authErrors, validateAll: validateAuth } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  // ── Credentials helper ─────────────────────────────────────────────────────

  function getCredentials() {
    return {
      host,
      port: parseInt(port),
      username: uam === 'No User Authent' ? '' : username,
      password: uam === 'No User Authent' ? '' : password,
      uam,
    };
  }

  // ── Probe ──────────────────────────────────────────────────────────────────

  const handleProbe = async () => {
    if (!validateProbe({ host, port })) return;
    setProbeLoading(true);
    setProbeError('');
    setProbeResult('');
    setProbeServerInfo(null);

    try {
      const resp = await fetch('/api/afp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), timeout: 10000 }),
      });
      const data = await resp.json() as {
        success?: boolean; error?: string; host?: string; port?: number;
        status?: string; serverName?: string; machineType?: string;
        afpVersions?: string[]; uams?: string[]; flags?: number;
        flagDescriptions?: string[]; connectTime?: number; rtt?: number;
      };

      if (resp.ok && data.success) {
        let text = `AFP Server Status\n${'═'.repeat(50)}\n\n`;
        text += `Server: ${data.host}:${data.port}\n`;
        if (data.serverName) text += `Name: ${data.serverName}\n`;
        if (data.machineType) text += `Machine: ${data.machineType}\n`;
        text += `Status: ${data.status}\n`;
        text += `Connect: ${data.connectTime}ms  |  Total: ${data.rtt}ms\n`;
        if (data.afpVersions?.length) text += `\nAFP Versions: ${data.afpVersions.join(', ')}\n`;
        if (data.uams?.length) text += `UAMs: ${data.uams.join(', ')}\n`;
        if (data.flagDescriptions?.length) text += `Capabilities: ${data.flagDescriptions.join(', ')}\n`;

        setProbeResult(text);
        setProbeServerInfo({
          status: data.status ?? 'unknown',
          serverName: data.serverName,
          machineType: data.machineType,
          afpVersions: data.afpVersions,
          uams: data.uams,
          flags: data.flags,
          flagDescriptions: data.flagDescriptions,
          connectTime: data.connectTime,
          rtt: data.rtt,
        });

        // Pre-populate UAM if server advertises its list
        if (data.uams?.includes('No User Authent')) setUam('No User Authent');
        else if (data.uams?.length) setUam(data.uams[0]);
      } else {
        setProbeError(data.error ?? 'AFP probe failed');
      }
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : 'AFP probe failed');
    } finally {
      setProbeLoading(false);
    }
  };

  // ── Login ──────────────────────────────────────────────────────────────────

  const handleLogin = async () => {
    if (!validateAuth({ host, port })) return;
    setAuthLoading(true);
    setAuthError('');
    setVolumes([]);
    setIsLoggedIn(false);
    setEntries([]);
    setSelectedVolume('');

    try {
      const resp = await fetch('/api/afp/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...getCredentials(), timeout: 15000 }),
      });
      const data = await resp.json() as {
        success?: boolean; error?: string;
        volumes?: AFPVolume[];
      };

      if (resp.ok && data.success) {
        setVolumes(data.volumes ?? []);
        setIsLoggedIn(true);
      } else {
        setAuthError(data.error ?? 'Login failed');
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setAuthLoading(false);
    }
  };

  // ── Directory listing ──────────────────────────────────────────────────────

  const loadDir = async (volName: string, id: number) => {
    setListLoading(true);
    setListError('');
    setOpResult('');
    setOpError('');

    try {
      const resp = await fetch('/api/afp/list-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...getCredentials(), volumeName: volName, dirId: id, timeout: 15000 }),
      });
      const data = await resp.json() as {
        success?: boolean; error?: string; entries?: AFPDirEntry[];
      };

      if (resp.ok && data.success) {
        setEntries(data.entries ?? []);
      } else {
        setListError(data.error ?? 'Failed to list directory');
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to list directory');
    } finally {
      setListLoading(false);
    }
  };

  const openVolume = async (vol: AFPVolume) => {
    setSelectedVolume(vol.name);
    setDirId(2);
    setDirPath([{ name: vol.name, id: 2 }]);
    await loadDir(vol.name, 2);
  };

  const openDir = async (entry: AFPDirEntry) => {
    if (!entry.isDir || !entry.nodeId) return;
    const newId = entry.nodeId;
    setDirId(newId);
    setDirPath(prev => [...prev, { name: entry.name, id: newId }]);
    await loadDir(selectedVolume, newId);
  };

  const navigateTo = async (idx: number) => {
    const target = dirPath[idx];
    setDirPath(prev => prev.slice(0, idx + 1));
    setDirId(target.id);
    await loadDir(selectedVolume, target.id);
  };

  // ── File operations ────────────────────────────────────────────────────────

  const doOperation = async (endpoint: string, extra: Record<string, unknown>) => {
    setOpLoading(true);
    setOpResult('');
    setOpError('');
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...getCredentials(),
          volumeName: selectedVolume,
          dirId,
          timeout: 15000,
          ...extra,
        }),
      });
      const data = await resp.json() as { success?: boolean; error?: string; [key: string]: unknown };
      if (resp.ok && data.success) {
        return data;
      } else {
        throw new Error(data.error ?? 'Operation failed');
      }
    } catch (err) {
      throw err;
    } finally {
      setOpLoading(false);
    }
  };

  const handleCreateDir = async () => {
    if (!newItemName.trim()) return;
    try {
      await doOperation('/api/afp/create-dir', { name: newItemName.trim(), parentDirId: dirId });
      setOpResult(`Directory "${newItemName.trim()}" created`);
      setNewItemName('');
      await loadDir(selectedVolume, dirId);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : 'Create dir failed');
    }
  };

  const handleCreateFile = async () => {
    if (!newItemName.trim()) return;
    try {
      await doOperation('/api/afp/create-file', { name: newItemName.trim(), parentDirId: dirId });
      setOpResult(`File "${newItemName.trim()}" created`);
      setNewItemName('');
      await loadDir(selectedVolume, dirId);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : 'Create file failed');
    }
  };

  const handleDelete = async (entry: AFPDirEntry) => {
    if (!confirm(`Delete "${entry.name}"?`)) return;
    try {
      await doOperation('/api/afp/delete', { name: entry.name });
      setOpResult(`Deleted "${entry.name}"`);
      await loadDir(selectedVolume, dirId);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameTo.trim()) return;
    try {
      await doOperation('/api/afp/rename', { oldName: renameTarget.name, newName: renameTo.trim() });
      setOpResult(`Renamed "${renameTarget.name}" → "${renameTo.trim()}"`);
      setRenameTarget(null);
      setRenameTo('');
      await loadDir(selectedVolume, dirId);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : 'Rename failed');
    }
  };

  const handleReadFile = async (entry: AFPDirEntry) => {
    setOpLoading(true);
    setOpError('');
    try {
      const resp = await fetch('/api/afp/read-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...getCredentials(),
          volumeName: selectedVolume,
          dirId,
          name: entry.name,
          timeout: 15000,
        }),
      });
      const data = await resp.json() as { success?: boolean; error?: string; data?: string; size?: number };
      if (resp.ok && data.success && data.data) {
        try {
          const decoded = atob(data.data);
          setFileContent({ name: entry.name, content: decoded });
        } catch {
          setFileContent({ name: entry.name, content: `[Binary data, ${data.size} bytes]` });
        }
      } else {
        setOpError(data.error ?? 'Failed to read file');
      }
    } catch (err) {
      setOpError(err instanceof Error ? err.message : 'Read failed');
    } finally {
      setOpLoading(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !probeLoading && host && port) {
      if (activeTab === 'probe') handleProbe();
      else handleLogin();
    }
  };

  function formatDate(ts?: number) {
    if (!ts) return '';
    // AFP timestamps are seconds since Jan 1, 2000 (Mac epoch)
    const MAC_EPOCH_OFFSET = 946684800; // seconds between Unix epoch and Mac epoch
    return new Date((ts + MAC_EPOCH_OFFSET) * 1000).toLocaleDateString();
  }

  function formatSize(bytes?: number, isDir?: boolean) {
    if (isDir) return bytes !== undefined ? `${bytes} items` : '';
    if (bytes === undefined) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  const sortedEntries = [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ProtocolClientLayout title="AFP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 p-1 bg-slate-900 rounded-lg w-fit">
          {(['probe', 'auth'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'probe' ? 'Server Probe' : 'Authenticate & Browse'}
            </button>
          ))}
        </div>

        {/* ── Connection fields (shared) ────────────────────────────────── */}
        <SectionHeader stepNumber={1} title="AFP Server" />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField id="afp-host" label="Host" type="text" value={host}
            onChange={setHost} onKeyDown={handleKeyDown} placeholder="fileserver.local"
            required helpText="AFP/Netatalk server hostname or IP"
            error={activeTab === 'probe' ? probeErrors.host : authErrors.host} />
          <FormField id="afp-port" label="Port" type="number" value={port}
            onChange={setPort} onKeyDown={handleKeyDown} min="1" max="65535"
            helpText="Default: 548 (AFP over TCP)"
            error={activeTab === 'probe' ? probeErrors.port : authErrors.port} />
        </div>

        {/* ── Probe tab ─────────────────────────────────────────────────── */}
        {activeTab === 'probe' && (
          <>
            <ActionButton onClick={handleProbe} disabled={probeLoading || !host || !port}
              loading={probeLoading} ariaLabel="Probe AFP server">
              Get Server Info
            </ActionButton>

            <ResultDisplay result={probeResult} error={probeError} />

            {probeServerInfo?.status === 'connected' && (
              <div className="mt-4 space-y-4">
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-green-400 text-xl">✓</span>
                    <h3 className="text-sm font-semibold text-slate-300">Server Identity</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs text-slate-400">
                    {probeServerInfo.serverName && (
                      <div><span className="font-semibold text-slate-300">Name:</span> {probeServerInfo.serverName}</div>
                    )}
                    {probeServerInfo.machineType && (
                      <div><span className="font-semibold text-slate-300">Machine:</span> {probeServerInfo.machineType}</div>
                    )}
                    <div><span className="font-semibold text-slate-300">Connect:</span> {probeServerInfo.connectTime}ms</div>
                    <div><span className="font-semibold text-slate-300">Total RTT:</span> {probeServerInfo.rtt}ms</div>
                  </div>
                </div>

                {probeServerInfo.afpVersions?.length && (
                  <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                    <h3 className="text-sm font-semibold text-slate-300 mb-2">AFP Versions</h3>
                    <div className="flex flex-wrap gap-2">
                      {probeServerInfo.afpVersions.map((v, i) => (
                        <span key={i} className="bg-blue-900/40 text-blue-300 px-2 py-1 rounded text-xs font-mono">{v}</span>
                      ))}
                    </div>
                  </div>
                )}

                {probeServerInfo.uams?.length && (
                  <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                    <h3 className="text-sm font-semibold text-slate-300 mb-2">Authentication Methods (UAMs)</h3>
                    <div className="space-y-1">
                      {probeServerInfo.uams.map((u, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="text-green-400">✓</span>
                          <span className="text-slate-300 font-mono">{u}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {probeServerInfo.flagDescriptions?.length && (
                  <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                    <h3 className="text-sm font-semibold text-slate-300 mb-2">
                      Capabilities
                      {probeServerInfo.flags !== undefined && (
                        <span className="text-slate-500 font-mono ml-2">(0x{probeServerInfo.flags.toString(16).padStart(4, '0')})</span>
                      )}
                    </h3>
                    <div className="grid grid-cols-2 gap-1">
                      {probeServerInfo.flagDescriptions.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="text-yellow-400">●</span>
                          <span className="text-slate-400">{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Auth & Browse tab ─────────────────────────────────────────── */}
        {activeTab === 'auth' && (
          <>
            {/* Auth form */}
            <SectionHeader stepNumber={2} title="Authentication" />
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  UAM (User Auth Method)
                </label>
                <select
                  value={uam}
                  onChange={e => setUam(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-500 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="No User Authent">No User Authent (guest)</option>
                  <option value="Cleartxt Passwrd">Cleartxt Passwrd (password)</option>
                </select>
              </div>

              {uam === 'Cleartxt Passwrd' && (
                <div className="grid md:grid-cols-2 gap-4">
                  <FormField id="afp-user" label="Username" type="text" value={username}
                    onChange={setUsername} onKeyDown={handleKeyDown}
                    placeholder="admin" required helpText="AFP account (max 8 chars for Cleartxt)" />
                  <FormField id="afp-pass" label="Password" type="password" value={password}
                    onChange={setPassword} onKeyDown={handleKeyDown}
                    placeholder="••••••••" helpText="Max 8 chars for Cleartxt Passwrd UAM" />
                </div>
              )}
            </div>

            <ActionButton onClick={handleLogin} disabled={authLoading || !host || !port}
              loading={authLoading} ariaLabel="Login to AFP server">
              {isLoggedIn ? 'Re-Login' : 'Login & List Volumes'}
            </ActionButton>

            {authError && <ResultDisplay error={authError} />}

            {/* Volume list */}
            {isLoggedIn && !selectedVolume && (
              <div className="mt-6">
                <SectionHeader stepNumber={3} title="Volumes" />
                {volumes.length === 0 ? (
                  <p className="text-sm text-slate-400">No volumes found on this server.</p>
                ) : (
                  <div className="space-y-2">
                    {volumes.map((vol, i) => (
                      <button
                        key={i}
                        onClick={() => openVolume(vol)}
                        className="w-full flex items-center gap-3 p-3 bg-slate-900 hover:bg-slate-700 border border-slate-600 rounded-lg transition-colors text-left"
                      >
                        <span className="text-2xl" aria-hidden>💾</span>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-slate-200">{vol.name}</div>
                          {vol.hasPassword && (
                            <div className="text-xs text-amber-400">Password required</div>
                          )}
                        </div>
                        <span className="text-slate-500 text-xs">Open →</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* File browser */}
            {isLoggedIn && selectedVolume && (
              <div className="mt-6">
                <SectionHeader stepNumber={3} title="File Browser" />

                {/* Breadcrumb */}
                <div className="flex items-center gap-1 flex-wrap mb-3 text-sm">
                  {dirPath.map((crumb, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-slate-600">/</span>}
                      <button
                        onClick={() => navigateTo(i)}
                        className={`px-1.5 py-0.5 rounded text-xs ${
                          i === dirPath.length - 1
                            ? 'text-slate-200 font-medium cursor-default'
                            : 'text-blue-400 hover:text-blue-300 hover:underline'
                        }`}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={() => { setSelectedVolume(''); setEntries([]); setDirPath([{ name: '/', id: 2 }]); }}
                    className="ml-auto text-xs text-slate-500 hover:text-slate-300"
                  >
                    ← Volumes
                  </button>
                </div>

                {/* Directory listing */}
                {listLoading && (
                  <div className="text-sm text-slate-400 animate-pulse py-4 text-center">Loading…</div>
                )}
                {listError && <ResultDisplay error={listError} />}

                {!listLoading && !listError && (
                  <div className="bg-slate-900 rounded-lg border border-slate-700 overflow-hidden">
                    {sortedEntries.length === 0 ? (
                      <div className="text-sm text-slate-500 text-center py-6">Empty directory</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-700 text-slate-400">
                            <th className="text-left px-3 py-2 font-medium">Name</th>
                            <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Size</th>
                            <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Modified</th>
                            <th className="px-3 py-2 font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedEntries.map((entry, i) => (
                            <tr
                              key={i}
                              className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors"
                            >
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span aria-hidden>{entry.isDir ? '📁' : '📄'}</span>
                                  {entry.isDir ? (
                                    <button
                                      onClick={() => openDir(entry)}
                                      className="text-blue-400 hover:text-blue-300 hover:underline text-left font-medium"
                                    >
                                      {entry.name}
                                    </button>
                                  ) : (
                                    <span className="text-slate-300">{entry.name}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right text-slate-500 hidden sm:table-cell">
                                {formatSize(entry.size, entry.isDir)}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-500 hidden md:table-cell">
                                {formatDate(entry.modDate)}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center justify-end gap-1">
                                  {!entry.isDir && (
                                    <button
                                      onClick={() => handleReadFile(entry)}
                                      disabled={opLoading}
                                      title="Read file"
                                      className="px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 hover:bg-blue-800/60 hover:text-blue-300 text-xs transition-colors disabled:opacity-50"
                                    >
                                      Read
                                    </button>
                                  )}
                                  <button
                                    onClick={() => { setRenameTarget(entry); setRenameTo(entry.name); }}
                                    disabled={opLoading}
                                    title="Rename"
                                    className="px-1.5 py-0.5 rounded bg-yellow-900/40 text-yellow-400 hover:bg-yellow-800/60 text-xs transition-colors disabled:opacity-50"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    onClick={() => handleDelete(entry)}
                                    disabled={opLoading}
                                    title="Delete"
                                    className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 hover:bg-red-800/60 text-xs transition-colors disabled:opacity-50"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* Rename inline form */}
                {renameTarget && (
                  <div className="mt-3 p-3 bg-slate-900 border border-yellow-700/40 rounded-lg">
                    <div className="text-xs text-yellow-400 mb-2">Rename "{renameTarget.name}"</div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={renameTo}
                        onChange={e => setRenameTo(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleRename()}
                        className="flex-1 bg-slate-700 border border-slate-500 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                        placeholder="New name"
                        autoFocus
                      />
                      <button onClick={handleRename} disabled={opLoading || !renameTo.trim()}
                        className="px-3 py-1 bg-yellow-700 hover:bg-yellow-600 text-white text-xs rounded transition-colors disabled:opacity-50">
                        Rename
                      </button>
                      <button onClick={() => { setRenameTarget(null); setRenameTo(''); }}
                        className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-400 text-xs rounded transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Create new item */}
                <div className="mt-4 p-3 bg-slate-900 border border-slate-700 rounded-lg">
                  <div className="text-xs text-slate-400 mb-2 font-medium">Create New</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newItemName}
                      onChange={e => setNewItemName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCreateFile()}
                      placeholder="filename.txt or dirname"
                      className="flex-1 bg-slate-700 border border-slate-500 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button onClick={handleCreateFile} disabled={opLoading || !newItemName.trim()}
                      title="Create file"
                      className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded transition-colors disabled:opacity-50">
                      + File
                    </button>
                    <button onClick={handleCreateDir} disabled={opLoading || !newItemName.trim()}
                      title="Create directory"
                      className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white text-xs rounded transition-colors disabled:opacity-50">
                      + Dir
                    </button>
                  </div>
                </div>

                {/* Operation feedback */}
                {opResult && (
                  <div className="mt-2 text-xs text-green-400 px-1">{opResult}</div>
                )}
                {opError && <ResultDisplay error={opError} />}

                {/* File content viewer */}
                {fileContent && (
                  <div className="mt-4 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
                      <span className="text-xs font-medium text-slate-300">📄 {fileContent.name}</span>
                      <button
                        onClick={() => setFileContent(null)}
                        className="text-slate-500 hover:text-slate-300 text-xs"
                      >
                        ✕ Close
                      </button>
                    </div>
                    <pre className="p-3 text-xs text-slate-300 overflow-auto max-h-64 font-mono whitespace-pre-wrap break-all">
                      {fileContent.content}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Protocol info ─────────────────────────────────────────────── */}
        <HelpSection title="About AFP Protocol"
          description="AFP (Apple Filing Protocol) is Apple's file sharing protocol. It runs over DSI (Data Stream Interface) on TCP port 548. While still supported in modern macOS, Apple now recommends SMB for new deployments. AFP provides file sharing, Time Machine backups, resource forks, and Spotlight search."
          showKeyboardShortcut={true} />

        <div className="mt-6 pt-6 border-t border-slate-600 grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">DSI/AFP Session Flow</h3>
            <div className="bg-slate-700 px-3 py-2 rounded font-mono text-xs space-y-1">
              <div><span className="text-green-400">1. TCP Connect</span> <span className="text-slate-400">→ port 548</span></div>
              <div><span className="text-green-400">2. DSIOpenSession</span> <span className="text-slate-400">→ negotiate options</span></div>
              <div><span className="text-green-400">3. FPLogin</span> <span className="text-slate-400">→ authenticate (UAM)</span></div>
              <div><span className="text-green-400">4. FPGetSrvrParms</span> <span className="text-slate-400">→ list volumes</span></div>
              <div><span className="text-green-400">5. FPOpenVol</span> <span className="text-slate-400">→ mount volume</span></div>
              <div><span className="text-yellow-400">6. FPEnumerateExt2</span> <span className="text-slate-400">→ list directory</span></div>
              <div><span className="text-yellow-400">7. FP* commands</span> <span className="text-slate-400">→ file operations</span></div>
              <div><span className="text-red-400">8. FPLogout + DSIClose</span> <span className="text-slate-400">→ disconnect</span></div>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Supported UAMs</h3>
            <div className="space-y-1 text-xs text-slate-400">
              <div><span className="font-mono text-blue-400">No User Authent</span> — Guest access, no credentials</div>
              <div><span className="font-mono text-blue-400">Cleartxt Passwrd</span> — Cleartext (max 8 chars)</div>
              <div className="text-slate-600 pt-1">DHX / DHX2 / Kerberos — not yet supported</div>
            </div>
            <h3 className="text-sm font-semibold text-slate-300 mt-4 mb-2">AFP Versions</h3>
            <div className="space-y-1 text-xs text-slate-400">
              <div><span className="text-green-400">AFP 3.4</span> — macOS 10.7+ (latest)</div>
              <div><span className="text-green-400">AFP 3.3</span> — macOS 10.5+</div>
              <div><span className="text-green-400">AFP 3.2</span> — macOS 10.4+</div>
              <div><span className="text-yellow-400">AFP 2.2</span> — Mac OS 9 (legacy)</div>
            </div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
