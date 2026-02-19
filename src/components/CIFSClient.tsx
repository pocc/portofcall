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

interface CIFSClientProps {
  onBack: () => void;
}

type Tab = 'negotiate' | 'auth' | 'ls' | 'read' | 'stat';

export default function CIFSClient({ onBack }: CIFSClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>('negotiate');

  // ── Shared fields ─────────────────────────────────────────────────────────
  const [host, setHost] = useState('');
  const [port, setPort] = useState('445');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [domain, setDomain] = useState('');

  // ── Negotiate ─────────────────────────────────────────────────────────────
  const [negLoading, setNegLoading] = useState(false);
  const [negResult, setNegResult] = useState('');
  const [negError, setNegError] = useState('');

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [authLoading, setAuthLoading] = useState(false);
  const [authResult, setAuthResult] = useState('');
  const [authError, setAuthError] = useState('');

  // ── List ──────────────────────────────────────────────────────────────────
  const [lsShare, setLsShare] = useState('C$');
  const [lsPath, setLsPath] = useState('');
  const [lsLoading, setLsLoading] = useState(false);
  const [lsResult, setLsResult] = useState('');
  const [lsError, setLsError] = useState('');

  // ── Read ──────────────────────────────────────────────────────────────────
  const [readShare, setReadShare] = useState('C$');
  const [readPath, setReadPath] = useState('Windows\\win.ini');
  const [readLoading, setReadLoading] = useState(false);
  const [readResult, setReadResult] = useState('');
  const [readError, setReadError] = useState('');

  // ── Stat ──────────────────────────────────────────────────────────────────
  const [statShare, setStatShare] = useState('C$');
  const [statPath, setStatPath] = useState('Windows');
  const [statLoading, setStatLoading] = useState(false);
  const [statResult, setStatResult] = useState('');
  const [statError, setStatError] = useState('');

  // ── Validation ────────────────────────────────────────────────────────────
  const { errors: negErrors, validateAll: validateNeg } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });
  const { errors: authErrors, validateAll: validateAuth } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    username: [validationRules.required('Username is required')],
    password: [validationRules.required('Password is required')],
  });
  const { errors: lsErrors, validateAll: validateLs } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    username: [validationRules.required('Username is required')],
    password: [validationRules.required('Password is required')],
    share: [validationRules.required('Share name is required')],
  });
  const { errors: readErrors, validateAll: validateRead } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    username: [validationRules.required('Username is required')],
    password: [validationRules.required('Password is required')],
    share: [validationRules.required('Share name is required')],
    filePath: [validationRules.required('File path is required')],
  });
  const { errors: statErrors, validateAll: validateStat } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
    username: [validationRules.required('Username is required')],
    password: [validationRules.required('Password is required')],
    share: [validationRules.required('Share name is required')],
    targetPath: [validationRules.required('Path is required')],
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleNegotiate = async () => {
    if (!validateNeg({ host, port })) return;
    setNegLoading(true); setNegError(''); setNegResult('');
    try {
      const res = await fetch('/api/cifs/negotiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), timeout: 10000 }),
      });
      const data = await res.json() as {
        success?: boolean; error?: string;
        dialect?: string; serverGuid?: string; capabilities?: string[];
        maxTransactSize?: number; maxReadSize?: number; maxWriteSize?: number;
        systemTime?: string; bootTime?: string; tcpLatency?: number;
        isCloudflare?: boolean;
      };
      if (data.isCloudflare) { setNegError(data.error ?? 'Target is behind Cloudflare'); return; }
      if (data.success) {
        const lines = [
          `SMB2 Negotiate — ${host}:${port}`,
          '='.repeat(50),
          `Dialect:          ${data.dialect ?? 'unknown'}`,
          `Server GUID:      ${data.serverGuid ?? 'n/a'}`,
          `TCP Latency:      ${data.tcpLatency ?? '?'}ms`,
        ];
        if (data.capabilities?.length) lines.push(`Capabilities:     ${data.capabilities.join(', ')}`);
        if (data.maxTransactSize) lines.push(`Max Transact:     ${(data.maxTransactSize / 1024).toFixed(0)} KB`);
        if (data.maxReadSize)     lines.push(`Max Read:         ${(data.maxReadSize / 1024).toFixed(0)} KB`);
        if (data.maxWriteSize)    lines.push(`Max Write:        ${(data.maxWriteSize / 1024).toFixed(0)} KB`);
        if (data.systemTime)      lines.push(`System Time:      ${data.systemTime}`);
        if (data.bootTime)        lines.push(`Boot Time:        ${data.bootTime}`);
        setNegResult(lines.join('\n'));
      } else {
        setNegError(data.error ?? 'Negotiate failed');
      }
    } catch (e) {
      setNegError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setNegLoading(false);
    }
  };

  const handleAuth = async () => {
    if (!validateAuth({ host, port, username, password })) return;
    setAuthLoading(true); setAuthError(''); setAuthResult('');
    try {
      const res = await fetch('/api/cifs/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), username, password, domain, timeout: 15000 }),
      });
      const data = await res.json() as {
        success?: boolean; error?: string;
        sessionId?: string; dialect?: string; serverGuid?: string;
        guestLogon?: boolean; anonymousLogon?: boolean;
        isCloudflare?: boolean;
      };
      if (data.isCloudflare) { setAuthError(data.error ?? 'Target is behind Cloudflare'); return; }
      if (data.success) {
        const lines = [
          `NTLMv2 Authentication — ${host}:${port}`,
          '='.repeat(50),
          `Status:    ✓ Authenticated`,
          `User:      ${domain ? domain + '\\' : ''}${username}`,
          `Dialect:   ${data.dialect ?? 'unknown'}`,
        ];
        if (data.sessionId) lines.push(`Session ID: ${data.sessionId}`);
        if (data.guestLogon)    lines.push('⚠  Guest logon — credentials not validated');
        if (data.anonymousLogon) lines.push('⚠  Anonymous logon');
        setAuthResult(lines.join('\n'));
      } else {
        setAuthError(data.error ?? 'Authentication failed');
      }
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleList = async () => {
    if (!validateLs({ host, port, username, password, share: lsShare })) return;
    setLsLoading(true); setLsError(''); setLsResult('');
    try {
      const res = await fetch('/api/cifs/ls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), username, password, domain, share: lsShare, path: lsPath || undefined, timeout: 20000 }),
      });
      const data = await res.json() as {
        success?: boolean; error?: string;
        entries?: Array<{ name: string; isDirectory: boolean; size: number; created?: string; modified?: string }>;
        count?: number; path?: string; isCloudflare?: boolean;
      };
      if (data.isCloudflare) { setLsError(data.error ?? 'Target is behind Cloudflare'); return; }
      if (data.success) {
        const header = `Directory of \\\\${host}\\${lsShare}${data.path ? '\\' + data.path : ''}`;
        const lines = [header, '='.repeat(header.length)];
        if (data.entries?.length) {
          const maxName = Math.max(4, ...data.entries.map(e => e.name.length));
          lines.push(`${'Name'.padEnd(maxName)}  Type       Size`);
          lines.push('-'.repeat(maxName + 22));
          for (const e of data.entries) {
            const type = e.isDirectory ? '<DIR>     ' : '          ';
            const size = e.isDirectory ? '         -' : e.size.toString().padStart(10);
            lines.push(`${e.name.padEnd(maxName)}  ${type} ${size}`);
          }
          lines.push('', `${data.count ?? data.entries.length} item(s)`);
        } else {
          lines.push('(empty directory)');
        }
        setLsResult(lines.join('\n'));
      } else {
        setLsError(data.error ?? 'List failed');
      }
    } catch (e) {
      setLsError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setLsLoading(false);
    }
  };

  const handleRead = async () => {
    if (!validateRead({ host, port, username, password, share: readShare, filePath: readPath })) return;
    setReadLoading(true); setReadError(''); setReadResult('');
    try {
      const res = await fetch('/api/cifs/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), username, password, domain, share: readShare, path: readPath, timeout: 20000 }),
      });
      const data = await res.json() as {
        success?: boolean; error?: string;
        content?: string; size?: number; bytesRead?: number;
        isCloudflare?: boolean;
      };
      if (data.isCloudflare) { setReadError(data.error ?? 'Target is behind Cloudflare'); return; }
      if (data.success) {
        const header = `\\\\${host}\\${readShare}\\${readPath}  (${data.bytesRead ?? 0} bytes read${data.size !== undefined ? ` / ${data.size} total` : ''})`;
        setReadResult(header + '\n' + '─'.repeat(50) + '\n' + (data.content ?? ''));
      } else {
        setReadError(data.error ?? 'Read failed');
      }
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setReadLoading(false);
    }
  };

  const handleStat = async () => {
    if (!validateStat({ host, port, username, password, share: statShare, targetPath: statPath })) return;
    setStatLoading(true); setStatError(''); setStatResult('');
    try {
      const res = await fetch('/api/cifs/stat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port), username, password, domain, share: statShare, path: statPath, timeout: 15000 }),
      });
      const data = await res.json() as {
        success?: boolean; error?: string;
        name?: string; isDirectory?: boolean; size?: number;
        created?: string; modified?: string; accessed?: string; changed?: string;
        attributes?: string[];
        isCloudflare?: boolean;
      };
      if (data.isCloudflare) { setStatError(data.error ?? 'Target is behind Cloudflare'); return; }
      if (data.success) {
        const lines = [
          `Stat: \\\\${host}\\${statShare}\\${statPath}`,
          '='.repeat(50),
          `Name:       ${data.name ?? statPath}`,
          `Type:       ${data.isDirectory ? 'Directory' : 'File'}`,
        ];
        if (!data.isDirectory && data.size !== undefined) lines.push(`Size:       ${data.size.toLocaleString()} bytes`);
        if (data.created)  lines.push(`Created:    ${data.created}`);
        if (data.modified) lines.push(`Modified:   ${data.modified}`);
        if (data.accessed) lines.push(`Accessed:   ${data.accessed}`);
        if (data.changed)  lines.push(`Changed:    ${data.changed}`);
        if (data.attributes?.length) lines.push(`Attributes: ${data.attributes.join(', ')}`);
        setStatResult(lines.join('\n'));
      } else {
        setStatError(data.error ?? 'Stat failed');
      }
    } catch (e) {
      setStatError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setStatLoading(false);
    }
  };

  // ── Tab definitions ───────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string }[] = [
    { id: 'negotiate', label: 'Negotiate' },
    { id: 'auth',      label: 'Auth' },
    { id: 'ls',        label: 'List Dir' },
    { id: 'read',      label: 'Read File' },
    { id: 'stat',      label: 'Stat' },
  ];

  // ── Shared connection block ────────────────────────────────────────────────
  const ConnectionFields = ({ showCreds = false }: { showCreds?: boolean }) => (
    <>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <FormField id="cifs-host" label="Host" type="text" value={host} onChange={setHost}
          placeholder="fileserver.example.com" required
          error={negErrors.host ?? authErrors.host ?? lsErrors.host ?? readErrors.host ?? statErrors.host} />
        <FormField id="cifs-port" label="Port" type="number" value={port} onChange={setPort}
          min="1" max="65535" helpText="Default: 445"
          error={negErrors.port ?? authErrors.port ?? lsErrors.port ?? readErrors.port ?? statErrors.port} />
      </div>
      {showCreds && (
        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <FormField id="cifs-username" label="Username" type="text" value={username} onChange={setUsername}
            placeholder="Administrator"
            error={authErrors.username ?? lsErrors.username ?? readErrors.username ?? statErrors.username} />
          <FormField id="cifs-password" label="Password" type="password" value={password} onChange={setPassword}
            placeholder="••••••••"
            error={authErrors.password ?? lsErrors.password ?? readErrors.password ?? statErrors.password} />
          <FormField id="cifs-domain" label="Domain (optional)" type="text" value={domain} onChange={setDomain}
            placeholder="WORKGROUP or AD domain" />
        </div>
      )}
    </>
  );

  return (
    <ProtocolClientLayout title="CIFS / SMB2 Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.CIFS || []} />
      {/* Tab bar */}
      <div className="flex gap-1 mb-4 bg-slate-900 rounded-lg p-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              activeTab === t.id
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Negotiate tab */}
      {activeTab === 'negotiate' && (
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <SectionHeader stepNumber={1} title="SMB2 Negotiate" />
          <p className="text-sm text-slate-400 mb-4">
            Performs an SMB2 NEGOTIATE handshake to discover the server dialect, capabilities, and identity — no credentials required.
          </p>
          <ConnectionFields />
          <ActionButton onClick={handleNegotiate} disabled={negLoading || !host} loading={negLoading} ariaLabel="Negotiate">
            Negotiate
          </ActionButton>
          <ResultDisplay result={negResult} error={negError} />
          <HelpSection
            title="About SMB2 Negotiate"
            description="The NEGOTIATE request is the first message in any SMB2 session. The server responds with its preferred dialect (2.0.2 / 2.1 / 3.0 / 3.0.2 / 3.1.1), a unique GUID, and capability flags. No authentication is required for this step."
          />
        </div>
      )}

      {/* Auth tab */}
      {activeTab === 'auth' && (
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <SectionHeader stepNumber={1} title="NTLMv2 Authentication" />
          <p className="text-sm text-slate-400 mb-4">
            Tests credentials against the SMB2 server using full NTLMv2 (negotiate → challenge → authenticate). Does not mount any share.
          </p>
          <ConnectionFields showCreds />
          <ActionButton onClick={handleAuth} disabled={authLoading || !host || !username || !password} loading={authLoading} ariaLabel="Authenticate">
            Authenticate
          </ActionButton>
          <ResultDisplay result={authResult} error={authError} />
          <HelpSection
            title="About NTLMv2"
            description="NTLMv2 is the authentication protocol used by Windows file sharing. It's a 3-message challenge-response exchange: the client sends a Negotiate message, the server responds with a Challenge, and the client replies with an Authenticate message containing an HMAC-MD5 response derived from the user's password hash and the server challenge."
          />
        </div>
      )}

      {/* List tab */}
      {activeTab === 'ls' && (
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <SectionHeader stepNumber={1} title="List Directory" />
          <p className="text-sm text-slate-400 mb-4">
            Authenticates and lists files in a share directory. Administrative shares (C$, IPC$, ADMIN$) require administrator credentials.
          </p>
          <ConnectionFields showCreds />
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <FormField id="cifs-ls-share" label="Share Name" type="text" value={lsShare} onChange={setLsShare}
              placeholder="C$" helpText="e.g. C$, share, Documents"
              error={lsErrors.share} />
            <FormField id="cifs-ls-path" label="Path (optional)" type="text" value={lsPath} onChange={setLsPath}
              placeholder="Windows\System32" helpText="Leave empty for share root" />
          </div>
          <ActionButton onClick={handleList} disabled={lsLoading || !host || !username || !password || !lsShare} loading={lsLoading} ariaLabel="List directory">
            List Directory
          </ActionButton>
          <ResultDisplay result={lsResult} error={lsError} />
          <HelpSection
            title="Common Shares"
            description="C$ — default administrative share for the C: drive. ADMIN$ — Windows directory. IPC$ — inter-process communication (no files). Named shares configured by administrators (e.g. 'share', 'public', 'data')."
          />
        </div>
      )}

      {/* Read tab */}
      {activeTab === 'read' && (
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <SectionHeader stepNumber={1} title="Read File" />
          <p className="text-sm text-slate-400 mb-4">
            Reads the first 64 KB of a file from a share. Use backslash-separated paths.
          </p>
          <ConnectionFields showCreds />
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <FormField id="cifs-read-share" label="Share Name" type="text" value={readShare} onChange={setReadShare}
              placeholder="C$"
              error={readErrors.share} />
            <FormField id="cifs-read-path" label="File Path" type="text" value={readPath} onChange={setReadPath}
              placeholder="Windows\win.ini" helpText="Path relative to share root"
              error={readErrors.filePath} />
          </div>
          <ActionButton onClick={handleRead} disabled={readLoading || !host || !username || !password || !readShare || !readPath} loading={readLoading} ariaLabel="Read file">
            Read File
          </ActionButton>
          <ResultDisplay result={readResult} error={readError} />
          <HelpSection
            title="Tips"
            description="Try C$\Windows\win.ini (usually world-readable on Windows). Non-text files will show as UTF-8 decoded content (may include binary artifacts). Max 64 KB is read per request."
          />
        </div>
      )}

      {/* Stat tab */}
      {activeTab === 'stat' && (
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
          <SectionHeader stepNumber={1} title="File / Directory Metadata" />
          <p className="text-sm text-slate-400 mb-4">
            Retrieves metadata (size, timestamps, attributes) for a file or directory without transferring its contents.
          </p>
          <ConnectionFields showCreds />
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <FormField id="cifs-stat-share" label="Share Name" type="text" value={statShare} onChange={setStatShare}
              placeholder="C$"
              error={statErrors.share} />
            <FormField id="cifs-stat-path" label="Path" type="text" value={statPath} onChange={setStatPath}
              placeholder="Windows" helpText="File or directory path"
              error={statErrors.targetPath} />
          </div>
          <ActionButton onClick={handleStat} disabled={statLoading || !host || !username || !password || !statShare || !statPath} loading={statLoading} ariaLabel="Get metadata">
            Get Metadata
          </ActionButton>
          <ResultDisplay result={statResult} error={statError} />
          <HelpSection
            title="About File Metadata"
            description="Uses the SMB2 QUERY_INFO command with FileAllInformation to retrieve size, creation time, last write time, last access time, change time, and file attributes (Read-Only, Hidden, System, Archive, Directory, etc.)."
          />
        </div>
      )}

      {/* Port reference */}
      <div className="mt-4 bg-slate-800 border border-slate-600 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Quick Connect Targets</h3>
        <div className="grid gap-2">
          {[
            { h: 'localhost', s: 'C$',   p: 'C:\\',    desc: 'Local Windows C$ admin share' },
            { h: 'nas.local', s: 'share', p: '',        desc: 'Typical NAS public share' },
          ].map(({ h, s, p, desc }) => (
            <button
              key={h + s}
              onClick={() => {
                setHost(h);
                setLsShare(s); setReadShare(s); setStatShare(s);
                if (p) { setReadPath(p); setStatPath(p); }
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">\\{h}\{s}</span>
              <span className="ml-2 text-slate-400">— {desc}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 text-xs text-slate-500">
          Port 445 = SMB2 direct TCP (modern) · Port 139 = NetBIOS session service (legacy)
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
