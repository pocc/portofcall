import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface TacacsProps {
  onBack: () => void;
}

interface ProbeResult {
  success: boolean;
  error?: string;
  host?: string;
  port?: number;
  serverVersion?: { major: number; minor: number };
  responseType?: string;
  seqNo?: number;
  flags?: { encrypted: boolean; singleConnect: boolean };
  sessionId?: string;
  encrypted?: boolean;
  reply?: {
    status: string;
    statusCode: number;
    serverMsg: string | null;
    data: string | null;
  } | null;
  connectTimeMs?: number;
  totalTimeMs?: number;
  isCloudflare?: boolean;
}

interface AuthResult {
  success: boolean;
  error?: string;
  authenticated?: boolean;
  host?: string;
  port?: number;
  username?: string;
  encrypted?: boolean;
  finalStatus?: string;
  finalMessage?: string | null;
  steps?: Array<{ step: string; status: string; message?: string }>;
  connectTimeMs?: number;
  totalTimeMs?: number;
}

type TabType = 'probe' | 'authenticate';

export default function TacacsClient({ onBack }: TacacsProps) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';

  // Connection settings
  const [host, setHost] = useState('');
  const [port, setPort] = useState('49');
  const [secret, setSecret] = useState('');

  // Auth fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // State
  const [activeTab, setActiveTab] = useState<TabType>('probe');
  const [loading, setLoading] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [authResult, setAuthResult] = useState<AuthResult | null>(null);
  const [probeHistory, setProbeHistory] = useState<ProbeResult[]>([]);

  const handleProbe = async () => {
    if (!host) return;
    setLoading(true);
    setProbeResult(null);

    try {
      const response = await fetch('/api/tacacs/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port) || 49,
          secret: secret || undefined,
          timeout: 10000,
        }),
      });

      const data: ProbeResult = await response.json();
      setProbeResult(data);
      if (data.success) {
        setProbeHistory((prev) => [data, ...prev.slice(0, 9)]);
      }
    } catch (err) {
      setProbeResult({
        success: false,
        error: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAuthenticate = async () => {
    if (!host || !username) return;
    setLoading(true);
    setAuthResult(null);

    try {
      const response = await fetch('/api/tacacs/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port) || 49,
          secret: secret || undefined,
          username,
          password,
          timeout: 15000,
        }),
      });

      const data: AuthResult = await response.json();
      setAuthResult(data);
    } catch (err) {
      setAuthResult({
        success: false,
        error: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'PASS':
        return isRetro ? 'text-green-400' : 'text-green-400';
      case 'FAIL':
      case 'ERROR':
        return isRetro ? 'text-red-400' : 'text-red-400';
      case 'GETPASS':
      case 'GETUSER':
      case 'GETDATA':
        return isRetro ? 'text-yellow-400' : 'text-yellow-400';
      default:
        return isRetro ? 'text-gray-400' : 'text-slate-400';
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className={`${isRetro ? 'retro-button' : 'bg-slate-700 hover:bg-slate-600'} text-white px-3 py-2 rounded-lg transition-colors`}
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 ${isRetro ? 'retro-card' : 'bg-gradient-to-br from-purple-500 to-purple-700'} rounded-xl flex items-center justify-center`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-white" />
              <path d="M12 6v2M12 16v2M6 12h2M16 12h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white" />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-white" />
              <path d="M9 9l-1.5-1.5M15 9l1.5-1.5M9 15l-1.5 1.5M15 15l1.5 1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" className="text-white/60" />
            </svg>
          </div>
          <div>
            <h1 className={`text-2xl font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>TACACS+ Client</h1>
            <p className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>
              Terminal Access Controller Access-Control System Plus · Port 49 · RFC 8907
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(['probe', 'authenticate'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === tab
                ? isRetro
                  ? 'retro-button-active'
                  : 'bg-purple-600 text-white'
                : isRetro
                ? 'retro-button'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {tab === 'probe' ? 'Server Probe' : 'Authenticate'}
          </button>
        ))}
      </div>

      {/* Connection Form */}
      <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
        <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
          Connection Settings
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
              Host
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="tacacs-server.example.com"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro
                  ? 'retro-input'
                  : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-purple-500`}
            />
          </div>
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
              Port
            </label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="49"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro
                  ? 'retro-input'
                  : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-purple-500`}
            />
          </div>
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
              Shared Secret (optional)
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Leave empty for unencrypted"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro
                  ? 'retro-input'
                  : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-purple-500`}
            />
          </div>
        </div>

        {/* Auth-specific fields */}
        {activeTab === 'authenticate' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className={`w-full px-3 py-2 rounded-lg ${
                  isRetro
                    ? 'retro-input'
                    : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
                } focus:outline-none focus:ring-2 focus:ring-purple-500`}
              />
            </div>
            <div>
              <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                className={`w-full px-3 py-2 rounded-lg ${
                  isRetro
                    ? 'retro-input'
                    : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
                } focus:outline-none focus:ring-2 focus:ring-purple-500`}
              />
            </div>
          </div>
        )}

        <button
          onClick={activeTab === 'probe' ? handleProbe : handleAuthenticate}
          disabled={loading || !host || (activeTab === 'authenticate' && !username)}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            loading || !host || (activeTab === 'authenticate' && !username)
              ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
              : isRetro
              ? 'retro-button'
              : 'bg-purple-600 hover:bg-purple-500 text-white'
          }`}
        >
          {loading
            ? activeTab === 'probe'
              ? 'Probing...'
              : 'Authenticating...'
            : activeTab === 'probe'
            ? 'Probe Server'
            : 'Authenticate'}
        </button>
      </div>

      {/* Probe Result */}
      {activeTab === 'probe' && probeResult && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Probe Result
          </h2>

          {!probeResult.success ? (
            <div className={`p-4 rounded-lg ${isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'}`}>
              <p className="text-red-400">{probeResult.error}</p>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Version</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {probeResult.serverVersion?.major}.{probeResult.serverVersion?.minor}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Reply Status</p>
                  <p className={`text-lg font-bold ${statusColor(probeResult.reply?.status || '')}`}>
                    {probeResult.reply?.status || 'N/A'}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Connect</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>
                    {probeResult.connectTimeMs}ms
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Total</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>
                    {probeResult.totalTimeMs}ms
                  </p>
                </div>
              </div>

              {/* Detail Table */}
              <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg overflow-hidden`}>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                      <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Host</td>
                      <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>{probeResult.host}:{probeResult.port}</td>
                    </tr>
                    <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                      <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Response Type</td>
                      <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>{probeResult.responseType}</td>
                    </tr>
                    <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                      <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Encrypted</td>
                      <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>
                        {probeResult.flags?.encrypted ? 'Yes' : 'No (unencrypted mode)'}
                      </td>
                    </tr>
                    <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                      <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Single Connect</td>
                      <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>
                        {probeResult.flags?.singleConnect ? 'Supported' : 'Not supported'}
                      </td>
                    </tr>
                    <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                      <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Session ID</td>
                      <td className={`px-4 py-2 font-mono ${isRetro ? 'retro-text' : 'text-white'}`}>{probeResult.sessionId}</td>
                    </tr>
                    {probeResult.reply?.serverMsg && (
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Server Message</td>
                        <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>{probeResult.reply.serverMsg}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Auth Result */}
      {activeTab === 'authenticate' && authResult && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Authentication Result
          </h2>

          {!authResult.success ? (
            <div className={`p-4 rounded-lg ${isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'}`}>
              <p className="text-red-400">{authResult.error}</p>
            </div>
          ) : (
            <>
              {/* Auth Status */}
              <div className={`p-4 rounded-lg mb-4 ${
                authResult.authenticated
                  ? isRetro ? 'border border-green-500/30' : 'bg-green-500/10 border border-green-500/20'
                  : isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'
              }`}>
                <div className="flex items-center gap-3">
                  <span className={`text-2xl font-bold ${authResult.authenticated ? 'text-green-400' : 'text-red-400'}`}>
                    {authResult.authenticated ? 'PASS' : authResult.finalStatus}
                  </span>
                  <span className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>
                    User: {authResult.username} @ {authResult.host}:{authResult.port}
                  </span>
                </div>
                {authResult.finalMessage && (
                  <p className={`mt-2 ${isRetro ? 'retro-text-dim' : 'text-slate-300'}`}>{authResult.finalMessage}</p>
                )}
              </div>

              {/* Steps */}
              {authResult.steps && authResult.steps.length > 0 && (
                <div className="mb-4">
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Authentication Flow
                  </h3>
                  <div className="space-y-2">
                    {authResult.steps.map((step, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-3 p-2 rounded-lg ${
                          isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'
                        }`}
                      >
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          isRetro ? 'bg-green-900/50 text-green-400' : 'bg-purple-500/20 text-purple-400'
                        }`}>
                          {i + 1}
                        </span>
                        <span className={isRetro ? 'retro-text' : 'text-white'}>{step.step}</span>
                        <span className={`ml-auto font-mono text-sm ${statusColor(step.status)}`}>
                          {step.status}
                        </span>
                        {step.message && (
                          <span className={`text-sm ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                            {step.message}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timing */}
              <div className="grid grid-cols-2 gap-4">
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Connect</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>
                    {authResult.connectTimeMs}ms
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Total</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>
                    {authResult.totalTimeMs}ms
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Probe History */}
      {probeHistory.length > 0 && activeTab === 'probe' && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Probe History
          </h2>
          <div className="space-y-2">
            {probeHistory.map((item, i) => (
              <div
                key={i}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'
                }`}
              >
                <div>
                  <span className={`font-mono ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {item.host}:{item.port}
                  </span>
                  <span className={`ml-3 text-sm ${statusColor(item.reply?.status || '')}`}>
                    {item.reply?.status || 'OK'}
                  </span>
                </div>
                <span className={`text-sm ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                  {item.totalTimeMs}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Protocol Info */}
      <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6`}>
        <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
          About TACACS+
        </h2>
        <div className={`space-y-3 text-sm ${isRetro ? 'retro-text-dim' : 'text-slate-300'}`}>
          <p>
            TACACS+ (Terminal Access Controller Access-Control System Plus) is a protocol for
            <strong className={isRetro ? 'retro-text' : 'text-white'}> AAA (Authentication, Authorization, Accounting)</strong> used
            primarily for network device administration.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Key Features</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Full packet body encryption (MD5-based)</li>
                <li>Separate AAA functions</li>
                <li>Per-command authorization</li>
                <li>TCP-based (reliable delivery)</li>
                <li>Privilege levels 0-15</li>
              </ul>
            </div>
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Common Uses</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Cisco router/switch access control</li>
                <li>Network device administration</li>
                <li>Command-level authorization</li>
                <li>Configuration change auditing</li>
                <li>Centralized network AAA</li>
              </ul>
            </div>
          </div>
          <div className={`mt-3 p-3 rounded-lg ${isRetro ? 'border border-yellow-500/30' : 'bg-yellow-500/10 border border-yellow-500/20'}`}>
            <p className="text-yellow-300 text-xs">
              <strong>Note:</strong> Without a shared secret, probes are sent in unencrypted mode
              (TAC_PLUS_UNENCRYPTED_FLAG). Most production servers require encrypted connections.
              This tool is for connectivity testing and server discovery.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
