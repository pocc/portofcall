import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

interface DRDAResult {
  success: boolean;
  host?: string;
  port?: number;
  rtt?: number;
  connectTime?: number;
  isDRDA?: boolean;
  serverName?: string | null;
  serverClass?: string | null;
  serverRelease?: string | null;
  externalName?: string | null;
  managers?: Array<{ name: string; level: number }>;
  rawBytesReceived?: number;
  message?: string;
  error?: string;
  isCloudflare?: boolean;
}

export default function DRDAClient({ onBack }: { onBack: () => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('50000');
  const [timeout, setTimeout_] = useState('10000');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DRDAResult | null>(null);
  const [action, setAction] = useState<'connect' | 'probe'>('connect');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const endpoint = action === 'connect' ? 'connect' : 'probe';
      const response = await fetch(`${API_BASE}/drda/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port) || 50000,
          timeout: parseInt(timeout) || 10000,
        }),
      });

      const data = await response.json() as DRDAResult;
      setResult(data);
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-white transition-colors"
        >
          &larr; Back
        </button>
        <div className="flex items-center gap-3">
          <span className="text-4xl">🗄️</span>
          <div>
            <h1 className="text-2xl font-bold text-white">DRDA / IBM DB2</h1>
            <p className="text-slate-400 text-sm">Distributed Relational Database Architecture — Port 50000</p>
          </div>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mb-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-slate-300 mb-1">Host</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="db2.example.com"
                className="w-full bg-slate-700 border border-slate-500 rounded-lg px-4 py-2 text-white placeholder-slate-400"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full bg-slate-700 border border-slate-500 rounded-lg px-4 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Timeout (ms)</label>
              <input
                type="number"
                value={timeout}
                onChange={(e) => setTimeout_(e.target.value)}
                className="w-full bg-slate-700 border border-slate-500 rounded-lg px-4 py-2 text-white"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              onClick={() => setAction('connect')}
              disabled={loading || !host}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-medium py-2 px-6 rounded-lg transition-colors"
            >
              {loading && action === 'connect' ? 'Connecting...' : 'EXCSAT Handshake'}
            </button>
            <button
              type="submit"
              onClick={() => setAction('probe')}
              disabled={loading || !host}
              className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-600 text-white font-medium py-2 px-6 rounded-lg transition-colors"
            >
              {loading && action === 'probe' ? 'Probing...' : 'Probe Server'}
            </button>
          </div>
        </form>
      </div>

      {result && (
        <div className={`bg-slate-800 border rounded-xl p-6 ${
          result.success ? 'border-blue-500' : 'border-red-500'
        }`}>
          <div className="flex items-center gap-2 mb-4">
            <span className={`text-lg ${result.success ? 'text-green-400' : 'text-red-400'}`}>
              {result.success ? '✓' : '✗'}
            </span>
            <h3 className="text-lg font-semibold text-white">
              {result.success ? 'Connection Successful' : 'Connection Failed'}
            </h3>
          </div>

          {result.error && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 mb-4">
              <p className="text-red-300 text-sm">{result.error}</p>
            </div>
          )}

          {result.isCloudflare && (
            <div className="bg-orange-900/30 border border-orange-700 rounded-lg p-3 mb-4">
              <p className="text-orange-300 text-sm">Target is behind Cloudflare protection.</p>
            </div>
          )}

          {result.success && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase">DRDA Detected</p>
                  <p className={`text-lg font-bold ${result.isDRDA ? 'text-green-400' : 'text-red-400'}`}>
                    {result.isDRDA ? 'Yes' : 'No'}
                  </p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase">RTT</p>
                  <p className="text-lg font-bold text-blue-400">{result.rtt}ms</p>
                </div>
                {result.connectTime !== undefined && (
                  <div className="bg-slate-700/50 rounded-lg p-3">
                    <p className="text-slate-400 text-xs uppercase">Connect Time</p>
                    <p className="text-lg font-bold text-cyan-400">{result.connectTime}ms</p>
                  </div>
                )}
                {result.rawBytesReceived !== undefined && (
                  <div className="bg-slate-700/50 rounded-lg p-3">
                    <p className="text-slate-400 text-xs uppercase">Bytes Received</p>
                    <p className="text-lg font-bold text-slate-300">{result.rawBytesReceived}</p>
                  </div>
                )}
              </div>

              {result.serverClass && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-1">Server Class</p>
                  <p className="text-white font-mono">{result.serverClass}</p>
                </div>
              )}

              {result.serverRelease && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-1">Server Release</p>
                  <p className="text-white font-mono">{result.serverRelease}</p>
                </div>
              )}

              {result.serverName && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-1">Server Name</p>
                  <p className="text-white font-mono">{result.serverName}</p>
                </div>
              )}

              {result.externalName && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-1">External Name</p>
                  <p className="text-white font-mono">{result.externalName}</p>
                </div>
              )}

              {result.managers && result.managers.length > 0 && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-2">Manager Level List</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {result.managers.map((mgr, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <span className="text-blue-400 font-mono">{mgr.name}</span>
                        <span className="text-slate-400">Level</span>
                        <span className="text-white font-bold">{mgr.level}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.message && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-1">Message</p>
                  <p className="text-slate-200 text-sm">{result.message}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-3">About DRDA Protocol</h3>
        <div className="text-slate-300 text-sm space-y-2">
          <p>
            <strong>DRDA</strong> (Distributed Relational Database Architecture) is IBM's open
            standard for accessing relational databases over a network. It defines the wire
            format and message exchange for database operations.
          </p>
          <p>
            DRDA is the native protocol for <strong>IBM DB2</strong>, <strong>Apache Derby</strong> (JavaDB),
            and <strong>IBM Informix</strong>. The protocol uses DDM (Distributed Data Management)
            objects with binary-encoded code points for commands and parameters.
          </p>
          <p>
            The <strong>EXCSAT</strong> (Exchange Server Attributes) handshake is the first
            message exchanged, revealing the server's class, version, name, and supported
            manager levels.
          </p>
          <p className="text-slate-400">
            Default port: <code className="bg-slate-700 px-2 py-0.5 rounded">50000</code> (DB2),
            <code className="bg-slate-700 px-2 py-0.5 rounded ml-1">1527</code> (Derby)
          </p>
        </div>
      </div>
    </div>
  );
}
