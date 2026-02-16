import { useState } from 'react';

interface PCEPResult {
  success: boolean;
  host?: string;
  port?: number;
  rtt?: number;
  connectTime?: number;
  isPCEP?: boolean;
  responseType?: string;
  protocolVersion?: number;
  messageFlags?: number;
  peerKeepalive?: number;
  peerDeadtimer?: number;
  peerSessionId?: number;
  peerVersion?: number;
  capabilities?: Array<{ type: number; name: string; length: number }>;
  rawBytesReceived?: number;
  message?: string;
  error?: string;
  isCloudflare?: boolean;
}

export default function PCEPClient({ onBack }: { onBack: () => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4189');
  const [timeout, setTimeout_] = useState('10000');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PCEPResult | null>(null);
  const [action, setAction] = useState<'connect' | 'probe'>('connect');

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);

    try {
      const endpoint = action === 'connect' ? '/api/pcep/connect' : '/api/pcep/probe';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port, 10),
          timeout: parseInt(timeout, 10),
        }),
      });

      const data = await response.json() as PCEPResult;
      setResult(data);
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <button
        onClick={onBack}
        className="mb-6 text-slate-400 hover:text-slate-200 flex items-center gap-2"
      >
        <span>←</span> Back to protocols
      </button>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">🛤️</span>
          <div>
            <h2 className="text-xl font-bold text-white">PCEP — Path Computation Element Protocol</h2>
            <p className="text-slate-400 text-sm">Port 4189 · RFC 5440 · SDN/MPLS Path Computation</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-slate-400 text-sm mb-1">Host</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="pce.example.com"
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-sm mb-1">Port</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-slate-400 text-sm mb-1">Timeout (ms)</label>
            <input
              type="number"
              value={timeout}
              onChange={(e) => setTimeout_(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => { setAction('connect'); handleSubmit(); }}
            disabled={loading || !host.trim()}
            className="bg-orange-600 hover:bg-orange-700 disabled:bg-slate-600 text-white px-4 py-2 rounded font-medium"
          >
            {loading && action === 'connect' ? 'Connecting...' : 'OPEN Handshake'}
          </button>
          <button
            onClick={() => { setAction('probe'); handleSubmit(); }}
            disabled={loading || !host.trim()}
            className="bg-amber-600 hover:bg-amber-700 disabled:bg-slate-600 text-white px-4 py-2 rounded font-medium"
          >
            {loading && action === 'probe' ? 'Probing...' : 'Probe Server'}
          </button>
        </div>
      </div>

      {result && (
        <div className={`bg-slate-800 border rounded-xl p-6 ${result.success ? 'border-orange-500' : 'border-red-500'}`}>
          <h3 className={`text-lg font-bold mb-4 ${result.success ? 'text-orange-400' : 'text-red-400'}`}>
            {result.success ? 'PCEP Server Response' : 'Connection Failed'}
          </h3>

          {result.error && (
            <div className="bg-red-900/30 border border-red-700 rounded p-3 mb-4">
              <p className="text-red-300 font-mono text-sm">{result.error}</p>
            </div>
          )}

          {result.message && (
            <div className="bg-slate-900/50 rounded p-3 mb-4">
              <p className="text-slate-300">{result.message}</p>
            </div>
          )}

          {result.success && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              {result.isPCEP !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">PCEP Detected</p>
                  <p className={`font-mono font-bold ${result.isPCEP ? 'text-orange-400' : 'text-red-400'}`}>
                    {result.isPCEP ? 'Yes' : 'No'}
                  </p>
                </div>
              )}
              {result.responseType && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Response Type</p>
                  <p className="text-white font-mono">{result.responseType}</p>
                </div>
              )}
              {result.protocolVersion !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Protocol Version</p>
                  <p className="text-white font-mono">v{result.protocolVersion}</p>
                </div>
              )}
              {result.peerKeepalive !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Keepalive</p>
                  <p className="text-white font-mono">{result.peerKeepalive}s</p>
                </div>
              )}
              {result.peerDeadtimer !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Dead Timer</p>
                  <p className="text-white font-mono">{result.peerDeadtimer}s</p>
                </div>
              )}
              {result.peerSessionId !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Session ID</p>
                  <p className="text-white font-mono">{result.peerSessionId}</p>
                </div>
              )}
              {result.rtt !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">RTT</p>
                  <p className="text-white font-mono">{result.rtt} ms</p>
                </div>
              )}
              {result.connectTime !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Connect Time</p>
                  <p className="text-white font-mono">{result.connectTime} ms</p>
                </div>
              )}
              {result.rawBytesReceived !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Bytes Received</p>
                  <p className="text-white font-mono">{result.rawBytesReceived}</p>
                </div>
              )}
            </div>
          )}

          {result.capabilities && result.capabilities.length > 0 && (
            <div className="mt-4">
              <h4 className="text-slate-400 text-sm font-medium mb-2">Capabilities ({result.capabilities.length} TLVs)</h4>
              <div className="bg-slate-900 rounded p-3">
                {result.capabilities.map((cap, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-slate-800 last:border-0">
                    <span className="text-orange-400 font-mono text-sm">{cap.name}</span>
                    <span className="text-slate-500 text-xs">type={cap.type}, {cap.length}B</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
