import { useState } from 'react';

interface NBDResult {
  success: boolean;
  host?: string;
  port?: number;
  rtt?: number;
  connectTime?: number;
  isNBD?: boolean;
  isNewstyle?: boolean;
  fixedNewstyle?: boolean;
  noZeroes?: boolean;
  handshakeFlags?: number;
  exports?: string[];
  listError?: string;
  rawBytesReceived?: number;
  message?: string;
  error?: string;
  isCloudflare?: boolean;
}

export default function NBDClient({ onBack }: { onBack: () => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('10809');
  const [timeout, setTimeout_] = useState('10000');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NBDResult | null>(null);
  const [action, setAction] = useState<'connect' | 'probe'>('connect');

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);

    try {
      const endpoint = action === 'connect' ? '/api/nbd/connect' : '/api/nbd/probe';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port, 10),
          timeout: parseInt(timeout, 10),
        }),
      });

      const data = await response.json() as NBDResult;
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
          <span className="text-3xl">💾</span>
          <div>
            <h2 className="text-xl font-bold text-white">NBD — Network Block Device</h2>
            <p className="text-slate-400 text-sm">Port 10809 · Linux block device over TCP</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-slate-400 text-sm mb-1">Host</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="nbd-server.example.com"
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
            className="bg-teal-600 hover:bg-teal-700 disabled:bg-slate-600 text-white px-4 py-2 rounded font-medium"
          >
            {loading && action === 'connect' ? 'Connecting...' : 'Handshake + List Exports'}
          </button>
          <button
            onClick={() => { setAction('probe'); handleSubmit(); }}
            disabled={loading || !host.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 text-white px-4 py-2 rounded font-medium"
          >
            {loading && action === 'probe' ? 'Probing...' : 'Probe Magic'}
          </button>
        </div>
      </div>

      {result && (
        <div className={`bg-slate-800 border rounded-xl p-6 ${result.success ? 'border-teal-500' : 'border-red-500'}`}>
          <h3 className={`text-lg font-bold mb-4 ${result.success ? 'text-teal-400' : 'text-red-400'}`}>
            {result.success ? 'NBD Server Response' : 'Connection Failed'}
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
              {result.isNBD !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">NBD Detected</p>
                  <p className={`font-mono font-bold ${result.isNBD ? 'text-teal-400' : 'text-red-400'}`}>
                    {result.isNBD ? 'Yes' : 'No'}
                  </p>
                </div>
              )}
              {result.isNewstyle !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Newstyle</p>
                  <p className="text-white font-mono">{result.isNewstyle ? 'Yes' : 'No (oldstyle)'}</p>
                </div>
              )}
              {result.fixedNewstyle !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Fixed Newstyle</p>
                  <p className="text-white font-mono">{result.fixedNewstyle ? 'Yes' : 'No'}</p>
                </div>
              )}
              {result.noZeroes !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">No Zeroes</p>
                  <p className="text-white font-mono">{result.noZeroes ? 'Yes' : 'No'}</p>
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
              {result.handshakeFlags !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Flags</p>
                  <p className="text-white font-mono">0x{result.handshakeFlags.toString(16).padStart(4, '0')}</p>
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

          {result.exports && result.exports.length > 0 && (
            <div className="mt-4">
              <h4 className="text-slate-400 text-sm font-medium mb-2">Exports ({result.exports.length})</h4>
              <div className="bg-slate-900 rounded p-3">
                {result.exports.map((name, i) => (
                  <div key={i} className="flex items-center gap-2 py-1 border-b border-slate-800 last:border-0">
                    <span className="text-teal-400">💾</span>
                    <span className="text-white font-mono text-sm">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.listError && (
            <div className="mt-4 bg-yellow-900/30 border border-yellow-700 rounded p-3">
              <p className="text-yellow-300 text-sm">{result.listError}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
