import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface RadiusProps {
  onBack: () => void;
}

interface ProbeResult {
  success: boolean;
  error?: string;
  host?: string;
  port?: number;
  responseCode?: number;
  responseCodeName?: string;
  identifier?: number;
  authenticator?: string;
  attributes?: Array<{
    type: number;
    typeName: string;
    length: number;
    stringValue: string | null;
    intValue: number | null;
    hex?: string;
  }>;
  replyMessages?: string[];
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
  responseCode?: number;
  responseCodeName?: string;
  replyMessages?: string[];
  hasChallenge?: boolean;
  hasState?: boolean;
  attributes?: Array<{
    type: number;
    typeName: string;
    length: number;
    stringValue: string | null;
    intValue: number | null;
  }>;
  connectTimeMs?: number;
  totalTimeMs?: number;
}

type TabType = 'probe' | 'authenticate';

export default function RadiusClient({ onBack }: RadiusProps) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';

  // Connection settings
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1812');
  const [secret, setSecret] = useState('');

  // Auth fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nasIdentifier, setNasIdentifier] = useState('portofcall');

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
      const response = await fetch('/api/radius/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10) || 1812,
          secret: secret || 'testing123',
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
      const response = await fetch('/api/radius/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10) || 1812,
          secret: secret || 'testing123',
          username,
          password,
          nasIdentifier: nasIdentifier || 'portofcall',
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

  const codeColor = (code?: number) => {
    switch (code) {
      case 2: // Access-Accept
        return 'text-green-400';
      case 3: // Access-Reject
        return 'text-red-400';
      case 11: // Access-Challenge
        return 'text-yellow-400';
      default:
        return isRetro ? 'retro-text' : 'text-blue-400';
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
          <div className={`w-12 h-12 ${isRetro ? 'retro-card' : 'bg-gradient-to-br from-orange-500 to-orange-700'} rounded-xl flex items-center justify-center`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-white" />
              <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-white" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" className="text-white" />
              <path d="M12 3v2M12 19v2M3 12h2M19 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-white/60" />
              <path d="M5.64 5.64l1.41 1.41M16.95 16.95l1.41 1.41M5.64 18.36l1.41-1.41M16.95 7.05l1.41-1.41" stroke="currentColor" strokeWidth="1" strokeLinecap="round" className="text-white/40" />
            </svg>
          </div>
          <div>
            <h1 className={`text-2xl font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>RADIUS Client</h1>
            <p className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>
              Remote Authentication Dial-In User Service · Port 1812 · RFC 2865
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
                  : 'bg-orange-600 text-white'
                : isRetro
                ? 'retro-button'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {tab === 'probe' ? 'Status-Server Probe' : 'Access-Request Auth'}
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
              RADIUS Server
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="radius.example.com"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro
                  ? 'retro-input'
                  : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-orange-500`}
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
              placeholder="1812"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro
                  ? 'retro-input'
                  : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-orange-500`}
            />
          </div>
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
              Shared Secret
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="testing123"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro
                  ? 'retro-input'
                  : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-orange-500`}
            />
          </div>
        </div>

        {/* Auth-specific fields */}
        {activeTab === 'authenticate' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="testuser"
                className={`w-full px-3 py-2 rounded-lg ${
                  isRetro
                    ? 'retro-input'
                    : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
                } focus:outline-none focus:ring-2 focus:ring-orange-500`}
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
                } focus:outline-none focus:ring-2 focus:ring-orange-500`}
              />
            </div>
            <div>
              <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                NAS-Identifier
              </label>
              <input
                type="text"
                value={nasIdentifier}
                onChange={(e) => setNasIdentifier(e.target.value)}
                placeholder="portofcall"
                className={`w-full px-3 py-2 rounded-lg ${
                  isRetro
                    ? 'retro-input'
                    : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
                } focus:outline-none focus:ring-2 focus:ring-orange-500`}
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
              : 'bg-orange-600 hover:bg-orange-500 text-white'
          }`}
        >
          {loading
            ? activeTab === 'probe'
              ? 'Probing...'
              : 'Authenticating...'
            : activeTab === 'probe'
            ? 'Send Status-Server'
            : 'Send Access-Request'}
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
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Response</p>
                  <p className={`text-lg font-bold ${codeColor(probeResult.responseCode)}`}>
                    {probeResult.responseCodeName}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Code</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {probeResult.responseCode}
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

              {/* Reply Messages */}
              {probeResult.replyMessages && probeResult.replyMessages.length > 0 && (
                <div className={`mb-4 p-4 rounded-lg ${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'}`}>
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Reply Messages
                  </h3>
                  {probeResult.replyMessages.map((msg, i) => (
                    <p key={i} className={isRetro ? 'retro-text' : 'text-white'}>{msg}</p>
                  ))}
                </div>
              )}

              {/* Attributes */}
              {probeResult.attributes && probeResult.attributes.length > 0 && (
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg overflow-hidden`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <th className={`px-4 py-2 text-left ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Attribute</th>
                        <th className={`px-4 py-2 text-left ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {probeResult.attributes.map((attr, i) => (
                        <tr key={i} className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                          <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                            {attr.typeName}
                          </td>
                          <td className={`px-4 py-2 font-mono text-xs ${isRetro ? 'retro-text' : 'text-white'}`}>
                            {attr.stringValue || attr.hex || `${attr.intValue}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Authenticator */}
              <div className={`mt-4 ${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3`}>
                <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Response Authenticator</p>
                <p className={`font-mono text-xs mt-1 ${isRetro ? 'retro-text' : 'text-white'} break-all`}>
                  {probeResult.authenticator}
                </p>
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
              {/* Auth Status Banner */}
              <div className={`p-4 rounded-lg mb-4 ${
                authResult.authenticated
                  ? isRetro ? 'border border-green-500/30' : 'bg-green-500/10 border border-green-500/20'
                  : authResult.hasChallenge
                  ? isRetro ? 'border border-yellow-500/30' : 'bg-yellow-500/10 border border-yellow-500/20'
                  : isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'
              }`}>
                <div className="flex items-center gap-3">
                  <span className={`text-2xl font-bold ${codeColor(authResult.responseCode)}`}>
                    {authResult.responseCodeName}
                  </span>
                  <span className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>
                    User: {authResult.username} @ {authResult.host}:{authResult.port}
                  </span>
                </div>
                {authResult.hasChallenge && (
                  <p className={`mt-2 text-sm ${isRetro ? 'retro-text-dim' : 'text-yellow-300'}`}>
                    Server sent an Access-Challenge (multi-factor or additional step required)
                  </p>
                )}
              </div>

              {/* Reply Messages */}
              {authResult.replyMessages && authResult.replyMessages.length > 0 && (
                <div className={`mb-4 p-4 rounded-lg ${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'}`}>
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Server Reply
                  </h3>
                  {authResult.replyMessages.map((msg, i) => (
                    <p key={i} className={isRetro ? 'retro-text' : 'text-white'}>{msg}</p>
                  ))}
                </div>
              )}

              {/* Response Attributes */}
              {authResult.attributes && authResult.attributes.length > 0 && (
                <div className={`mb-4 ${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg overflow-hidden`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <th className={`px-4 py-2 text-left ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Attribute</th>
                        <th className={`px-4 py-2 text-left ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {authResult.attributes.map((attr, i) => (
                        <tr key={i} className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                          <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                            {attr.typeName}
                          </td>
                          <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>
                            {attr.stringValue || (attr.intValue !== null ? attr.intValue : `(${attr.length - 2} bytes)`)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                  <span className={`ml-3 text-sm ${codeColor(item.responseCode)}`}>
                    {item.responseCodeName}
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
          About RADIUS
        </h2>
        <div className={`space-y-3 text-sm ${isRetro ? 'retro-text-dim' : 'text-slate-300'}`}>
          <p>
            RADIUS (Remote Authentication Dial-In User Service) is the dominant protocol for
            <strong className={isRetro ? 'retro-text' : 'text-white'}> network access AAA (Authentication, Authorization, Accounting)</strong>.
            Defined in RFC 2865, it authenticates users connecting via ISPs, enterprise Wi-Fi (802.1X),
            VPNs, and network devices.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Key Features</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>MD5-based password encryption</li>
                <li>Message-Authenticator (HMAC-MD5)</li>
                <li>Vendor-Specific Attributes (VSA)</li>
                <li>Access-Challenge for MFA flows</li>
                <li>Accounting for usage tracking</li>
              </ul>
            </div>
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Common Uses</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>ISP subscriber authentication</li>
                <li>WPA2/WPA3-Enterprise (802.1X)</li>
                <li>VPN gateway authentication</li>
                <li>Network device access control</li>
                <li>Usage metering & billing</li>
              </ul>
            </div>
          </div>
          <div className={`mt-3 p-3 rounded-lg ${isRetro ? 'border border-yellow-500/30' : 'bg-yellow-500/10 border border-yellow-500/20'}`}>
            <p className="text-yellow-300 text-xs">
              <strong>Note:</strong> This client uses RADIUS over TCP (RFC 6613). Traditional RADIUS uses UDP,
              but RFC 6613 defines TCP transport for reliability. Your RADIUS server must support TCP connections
              (e.g., FreeRADIUS with <code>proto = tcp</code>). The shared secret must match the server configuration.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
