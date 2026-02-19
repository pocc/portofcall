import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface WebSocketProps {
  onBack: () => void;
}

interface ProbeResult {
  success: boolean;
  error?: string;
  host?: string;
  port?: number;
  path?: string;
  statusCode?: number;
  statusText?: string;
  websocketUpgrade?: boolean;
  acceptKeyValid?: boolean;
  serverHeaders?: Record<string, string>;
  negotiatedProtocol?: string | null;
  negotiatedExtensions?: string | null;
  server?: string | null;
  rawResponse?: string;
  pingResponse?: {
    received: boolean;
    opcode?: number;
    opcodeName?: string;
    fin?: boolean;
    payloadLength?: number;
    isPong?: boolean;
    error?: string;
    parseError?: string;
  };
  connectTimeMs?: number;
  totalTimeMs?: number;
  isCloudflare?: boolean;
}

export default function WebSocketClient({ onBack }: WebSocketProps) {
  const { theme } = useTheme();
  const isRetro = theme === 'retro';

  const [host, setHost] = useState('');
  const [port, setPort] = useState('80');
  const [path, setPath] = useState('/');
  const [protocols, setProtocols] = useState('');
  const [sendPing, setSendPing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [history, setHistory] = useState<ProbeResult[]>([]);

  const handleProbe = async () => {
    if (!host) return;
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/websocket/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port) || 80,
          path: path || '/',
          protocols: protocols || undefined,
          sendPing,
          timeout: 10000,
        }),
      });
      const data: ProbeResult = await response.json();
      setResult(data);
      if (data.success) {
        setHistory((prev) => [data, ...prev.slice(0, 9)]);
      }
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
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
          <div className={`w-12 h-12 ${isRetro ? 'retro-card' : 'bg-gradient-to-br from-indigo-500 to-indigo-700'} rounded-xl flex items-center justify-center`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 12h4l2-8 4 16 2-8h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white" />
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-white/40" />
            </svg>
          </div>

          <div>
            <h1 className={`text-2xl font-bold ${isRetro ? 'retro-text' : 'text-white'}`}>WebSocket Client</h1>
            <p className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>
              WebSocket Protocol · Port 80/443 · RFC 6455
            </p>
          </div>
        </div>
      </div>

      {/* Connection Form */}
      <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
        <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
          WebSocket Handshake Probe
        </h2>
      <ApiExamples examples={apiExamples.WebSocket || []} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Host</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="echo.websocket.org"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-indigo-500`}
            />
          </div>
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Port</label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="80"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-indigo-500`}
            />
          </div>
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Path</label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-indigo-500`}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className={`block text-sm mb-1 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
              Sub-Protocols (optional, comma-separated)
            </label>
            <input
              type="text"
              value={protocols}
              onChange={(e) => setProtocols(e.target.value)}
              placeholder="chat, superchat"
              className={`w-full px-3 py-2 rounded-lg ${
                isRetro ? 'retro-input' : 'bg-slate-900 border border-slate-600 text-white placeholder-slate-500'
              } focus:outline-none focus:ring-2 focus:ring-indigo-500`}
            />
          </div>
          <div className="flex items-end">
            <label className={`flex items-center gap-2 cursor-pointer ${isRetro ? 'retro-text' : 'text-white'}`}>
              <input
                type="checkbox"
                checked={sendPing}
                onChange={(e) => setSendPing(e.target.checked)}
                className="w-4 h-4"
              />
              Send Ping after handshake
            </label>
          </div>
        </div>
        <button
          onClick={handleProbe}
          disabled={loading || !host}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            loading || !host
              ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
              : isRetro
              ? 'retro-button'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          }`}
        >
          {loading ? 'Probing...' : 'Probe WebSocket'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Probe Result
          </h2>

          {!result.success ? (
            <div className={`p-4 rounded-lg ${isRetro ? 'border border-red-500/30' : 'bg-red-500/10 border border-red-500/20'}`}>
              <p className="text-red-400">{result.error}</p>
              {result.rawResponse && (
                <pre className={`mt-2 text-xs overflow-x-auto ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                  {result.rawResponse}
                </pre>
              )}
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Status</p>
                  <p className={`text-lg font-bold ${result.statusCode === 101 ? 'text-green-400' : 'text-red-400'}`}>
                    {result.statusCode}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Upgrade</p>
                  <p className={`text-lg font-bold ${result.websocketUpgrade ? 'text-green-400' : 'text-red-400'}`}>
                    {result.websocketUpgrade ? 'OK' : 'FAIL'}
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Connect</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>
                    {result.connectTimeMs}ms
                  </p>
                </div>
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-3 text-center`}>
                  <p className={`text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Total</p>
                  <p className={`text-lg font-bold ${isRetro ? 'retro-text' : 'text-blue-400'}`}>
                    {result.totalTimeMs}ms
                  </p>
                </div>
              </div>

              {/* Handshake Details */}
              <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg overflow-hidden mb-4`}>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                      <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Host</td>
                      <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>
                        {result.host}:{result.port}{result.path}
                      </td>
                    </tr>
                    <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                      <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Response</td>
                      <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>
                        {result.statusCode} {result.statusText}
                      </td>
                    </tr>
                    <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                      <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Accept Key</td>
                      <td className={`px-4 py-2 ${result.acceptKeyValid ? 'text-green-400' : 'text-red-400'}`}>
                        {result.acceptKeyValid ? 'Valid (SHA-1 verified)' : 'Invalid'}
                      </td>
                    </tr>
                    {result.server && (
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Server</td>
                        <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-white'}`}>{result.server}</td>
                      </tr>
                    )}
                    {result.negotiatedProtocol && (
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Protocol</td>
                        <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-indigo-300'}`}>{result.negotiatedProtocol}</td>
                      </tr>
                    )}
                    {result.negotiatedExtensions && (
                      <tr className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                        <td className={`px-4 py-2 font-medium ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>Extensions</td>
                        <td className={`px-4 py-2 ${isRetro ? 'retro-text' : 'text-indigo-300'}`}>{result.negotiatedExtensions}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Ping/Pong Result */}
              {result.pingResponse && (
                <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg p-4 mb-4`}>
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>
                    Ping/Pong Test
                  </h3>
                  {result.pingResponse.received ? (
                    <div className="flex items-center gap-3">
                      <span className={result.pingResponse.isPong ? 'text-green-400' : 'text-yellow-400'}>
                        {result.pingResponse.isPong ? 'Pong received' : `Response: ${result.pingResponse.opcodeName}`}
                      </span>
                      {result.pingResponse.payloadLength !== undefined && (
                        <span className={isRetro ? 'retro-text-dim' : 'text-slate-400'}>
                          ({result.pingResponse.payloadLength} bytes)
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-red-400">{result.pingResponse.error}</span>
                  )}
                </div>
              )}

              {/* Response Headers */}
              {result.serverHeaders && Object.keys(result.serverHeaders).length > 0 && (
                <div className="mt-4">
                  <h3 className={`text-sm font-medium mb-2 ${isRetro ? 'retro-text-dim' : 'text-slate-400'}`}>
                    Response Headers
                  </h3>
                  <div className={`${isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'} rounded-lg overflow-hidden`}>
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(result.serverHeaders).map(([key, value], i) => (
                          <tr key={i} className={isRetro ? 'border-b border-green-900/30' : 'border-b border-slate-700'}>
                            <td className={`px-4 py-1 font-mono text-xs ${isRetro ? 'retro-text' : 'text-indigo-300'}`}>{key}</td>
                            <td className={`px-4 py-1 font-mono text-xs ${isRetro ? 'retro-text-dim' : 'text-slate-300'}`}>{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className={`${isRetro ? 'retro-card' : 'bg-slate-800 border border-slate-700'} rounded-xl p-6 mb-6`}>
          <h2 className={`text-lg font-semibold mb-4 ${isRetro ? 'retro-text' : 'text-white'}`}>
            Probe History
          </h2>
          <div className="space-y-2">
            {history.map((item, i) => (
              <div
                key={i}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  isRetro ? 'retro-card' : 'bg-slate-900/50 border border-slate-700'
                }`}
              >
                <div>
                  <span className={`font-mono ${isRetro ? 'retro-text' : 'text-white'}`}>
                    {item.host}:{item.port}{item.path}
                  </span>
                  <span className={`ml-3 text-sm ${item.websocketUpgrade ? 'text-green-400' : 'text-red-400'}`}>
                    {item.statusCode} {item.websocketUpgrade ? 'Upgraded' : 'Failed'}
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
          About WebSocket
        </h2>
        <div className={`space-y-3 text-sm ${isRetro ? 'retro-text-dim' : 'text-slate-300'}`}>
          <p>
            WebSocket provides
            <strong className={isRetro ? 'retro-text' : 'text-white'}> full-duplex, bidirectional communication</strong> over
            a single TCP connection. It starts as an HTTP/1.1 upgrade request, then switches to the WebSocket framing protocol.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Key Features</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Full-duplex bidirectional comms</li>
                <li>Low overhead framing (2-14 bytes)</li>
                <li>Text and binary data support</li>
                <li>Ping/pong keep-alive frames</li>
                <li>Sub-protocol negotiation</li>
              </ul>
            </div>
            <div>
              <h3 className={`font-medium mb-2 ${isRetro ? 'retro-text' : 'text-white'}`}>Common Uses</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Chat applications</li>
                <li>Live data feeds / dashboards</li>
                <li>Multiplayer games</li>
                <li>Real-time notifications</li>
                <li>IoT device communication</li>
              </ul>
            </div>
          </div>
          <div className={`mt-3 p-3 rounded-lg ${isRetro ? 'border border-yellow-500/30' : 'bg-yellow-500/10 border border-yellow-500/20'}`}>
            <p className="text-yellow-300 text-xs">
              <strong>Note:</strong> This tool performs a raw TCP-level WebSocket handshake probe.
              It sends an HTTP Upgrade request, verifies the 101 response and Sec-WebSocket-Accept hash,
              and optionally tests ping/pong frames. Use port 80 for ws:// and port 443 for wss://.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
