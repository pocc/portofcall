import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface FastCGIProps {
  onBack: () => void;
}

interface ProbeResult {
  success: boolean;
  error?: string;
  host?: string;
  port?: number;
  protocolVersion?: number;
  serverValues?: Record<string, string>;
  maxConns?: number | null;
  maxReqs?: number | null;
  multiplexing?: boolean;
  records?: Array<{
    type: string;
    typeCode: number;
    requestId: number;
    contentLength: number;
    pairs?: Array<{ name: string; value: string }>;
  }>;
  connectTimeMs?: number;
  totalTimeMs?: number;
  isCloudflare?: boolean;
}

interface RequestResult {
  success: boolean;
  error?: string;
  host?: string;
  port?: number;
  scriptFilename?: string;
  requestUri?: string;
  exitStatus?: number;
  protocolStatus?: string | null;
  headers?: Record<string, string>;
  body?: string;
  stderr?: string | null;
  records?: Array<{ type: string; contentLength: number }>;
  connectTimeMs?: number;
  totalTimeMs?: number;
}

type TabType = 'probe' | 'request';

export default function FastCGIClient({ onBack }: FastCGIProps) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';

  const [host, setHost] = useState('');
  const [port, setPort] = useState('9000');
  const [activeTab, setActiveTab] = useState<TabType>('probe');
  const [loading, setLoading] = useState(false);

  // Request-specific fields
  const [scriptFilename, setScriptFilename] = useState('/index.php');
  const [requestUri, setRequestUri] = useState('/');

  // Results
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [requestResult, setRequestResult] = useState<RequestResult | null>(null);

  const handleProbe = async () => {
    if (!host) return;
    setLoading(true);
    setProbeResult(null);

    try {
      const response = await fetch('/api/fastcgi/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10) || 9000,
          timeout: 10000,
        }),
      });
      setProbeResult(await response.json());
    } catch (err) {
      setProbeResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleRequest = async () => {
    if (!host) return;
    setLoading(true);
    setRequestResult(null);

    try {
      const response = await fetch('/api/fastcgi/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10) || 9000,
          scriptFilename,
          requestUri,
          timeout: 15000,
        }),
      });
      setRequestResult(await response.json());
    } catch (err) {
      setRequestResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">      {/* Header */}
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
              <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" className="text-white" />
              <path d="M3 9h18" stroke="currentColor" strokeWidth="1.5" className="text-white" />
              <circle cx="6" cy="6.5" r="1" fill="currentColor" className="text-red-300" />
              <circle cx="9" cy="6.5" r="1" fill="currentColor" className="text-yellow-300" />
              <circle cx="12" cy="6.5" r="1" fill="currentColor" className="text-green-300" />
              <path d="M7 13l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white" />
              <path d="M13 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-white/60" />
            </svg>
          </div>

          <div>
            <h1 className={`text-2xl font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>FastCGI Client</h1>
            <p className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>
              Binary Application Server Protocol · Port 9000 · PHP-FPM / WSGI
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(['probe', 'request'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === tab
                ? isRetro ? 'retro-button-active' : 'bg-orange-600 text-white'
                : isRetro ? 'retro-button' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {tab === 'probe' ? 'Server Probe' : 'Send Request'}
          </button>
        ))}
      </div>

      {/* Connection Form */}
      <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
        <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
          Connection Settings
        </h2>
      <ApiExamples examples={apiExamples.FastCGI || []} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Host</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="php-fpm.example.com"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-orange-500`}
            />
          </div>
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Port</label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="9000"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-orange-500`}
            />
          </div>
        </div>

        {activeTab === 'request' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                SCRIPT_FILENAME
              </label>
              <input
                type="text"
                value={scriptFilename}
                onChange={(e) => setScriptFilename(e.target.value)}
                placeholder="/index.php"
                className={`w-full px-3 py-2 rounded-lg ${
                  isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
                } focus:outline-none focus:ring-2 focus:ring-orange-500`}
              />
            </div>
            <div>
              <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                REQUEST_URI
              </label>
              <input
                type="text"
                value={requestUri}
                onChange={(e) => setRequestUri(e.target.value)}
                placeholder="/"
                className={`w-full px-3 py-2 rounded-lg ${
                  isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
                } focus:outline-none focus:ring-2 focus:ring-orange-500`}
              />
            </div>
          </div>
        )}

        <button
          onClick={activeTab === 'probe' ? handleProbe : handleRequest}
          disabled={loading || !host}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            loading || !host
              ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
              : isRetro ? 'retro-button' : 'bg-orange-600 hover:bg-orange-500 text-white'
          }`}
        >
          {loading ? 'Connecting...' : activeTab === 'probe' ? 'Probe Server' : 'Send Request'}
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
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Max Conns</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {probeResult.maxConns ?? 'N/A'}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Max Requests</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {probeResult.maxReqs ?? 'N/A'}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Multiplexing</p>
                  <p className={`text-lg font-bold ${probeResult.multiplexing ? 'text-green-400' : isRetro ? 'retro-text' : 'text-slate-400'}`}>
                    {probeResult.multiplexing ? 'Yes' : 'No'}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Response Time</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>
                    {probeResult.totalTimeMs}ms
                  </p>
                </div>
              </div>

              {/* Server Values */}
              {probeResult.serverValues && Object.keys(probeResult.serverValues).length > 0 && (
                <div className="mb-4">
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Server Values
                  </h3>
                  <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg overflow-hidden`}>
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(probeResult.serverValues).map(([key, value]) => (
                          <tr key={key} className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                            <td className={`px-4 py-2 font-mono ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>{key}</td>
                            <td className={`px-4 py-2 font-mono ${isRetro ? 'retro-text' : 'text-white'}`}>{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Records */}
              {probeResult.records && probeResult.records.length > 0 && (
                <div>
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Response Records
                  </h3>
                  <div className="space-y-2">
                    {probeResult.records.map((record, i) => (
                      <div key={i} className={`p-2 rounded-lg ${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'}`}>
                        <span className={`font-mono text-sm ${isRetro ? 'retro-text' : 'text-orange-400'}`}>
                          {record.type}
                        </span>
                        <span className={`ml-2 text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                          {record.contentLength} bytes
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Request Result */}
      {activeTab === 'request' && requestResult && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Response
          </h2>

          {!requestResult.success ? (
            <div className={`p-4 rounded-lg ${isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'}`}>
              <p className="text-red-400">{requestResult.error}</p>
            </div>
          ) : (
            <>
              {/* Status */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Exit Status</p>
                  <p className={`text-lg font-bold ${requestResult.exitStatus === 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {requestResult.exitStatus}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Protocol Status</p>
                  <p className={`text-sm font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {requestResult.protocolStatus || 'N/A'}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Total Time</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>
                    {requestResult.totalTimeMs}ms
                  </p>
                </div>
              </div>

              {/* Response Headers */}
              {requestResult.headers && Object.keys(requestResult.headers).length > 0 && (
                <div className="mb-4">
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Response Headers
                  </h3>
                  <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg overflow-hidden`}>
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(requestResult.headers).map(([key, value]) => (
                          <tr key={key} className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                            <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>{key}</td>
                            <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Response Body */}
              {requestResult.body && (
                <div className="mb-4">
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Response Body
                  </h3>
                  <pre className={`p-4 rounded-lg text-sm overflow-auto max-h-64 ${
                    isRetro ? 'retro-card font-mono' : 'bg-slate-900/50 border border-slate-700 text-slate-300'
                  }`}>
                    {requestResult.body}
                  </pre>
                </div>
              )}

              {/* Stderr */}
              {requestResult.stderr && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium mb-2 text-red-400">Stderr</h3>
                  <pre className={`p-4 rounded-lg text-sm overflow-auto max-h-40 ${
                    isRetro ? 'retro-card' : 'bg-red-500/10 border border-red-500/20'
                  } text-red-300`}>
                    {requestResult.stderr}
                  </pre>
                </div>
              )}

              {/* Records */}
              {requestResult.records && requestResult.records.length > 0 && (
                <div>
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Protocol Records
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {requestResult.records.map((record, i) => (
                      <span key={i} className={`px-2 py-1 rounded text-xs font-mono ${
                        isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700 text-orange-400'
                      }`}>
                        {record.type} ({record.contentLength}B)
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Protocol Info */}
      <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6`}>
        <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
          About FastCGI
        </h2>
        <div className={`space-y-3 text-sm ${isRetro ? 'retro-text-dim' : 'text-slate-300'}`}>
          <p>
            FastCGI is a <strong className={isRetro ? 'retro-text' : 'text-white'}>binary protocol</strong> for
            communication between web servers and application servers. It keeps processes alive between
            requests for better performance than traditional CGI.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Key Features</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Persistent process pools</li>
                <li>Binary record format (8-byte header)</li>
                <li>Optional connection multiplexing</li>
                <li>Language-agnostic</li>
                <li>STDOUT/STDERR separation</li>
              </ul>
            </div>
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Common Stacks</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Nginx + PHP-FPM</li>
                <li>Apache mod_fcgid</li>
                <li>Lighttpd + spawn-fcgi</li>
                <li>Python (flup, wfastcgi)</li>
                <li>Ruby (fcgi gem)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
