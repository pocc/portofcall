import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

interface CephResult {
  success: boolean;
  host?: string;
  port?: number;
  rtt?: number;
  connectTime?: number;
  isCeph?: boolean;
  msgrVersion?: string;
  banner?: string;
  entityInfo?: {
    entityType: string;
    nonce: number;
    port: number | null;
    ipAddress: string | null;
  } | null;
  v2Features?: {
    supportedFeatures: string | null;
    requiredFeatures: string | null;
    payloadLength: number;
  } | null;
  rawBytesReceived?: number;
  message?: string;
  error?: string;
  isCloudflare?: boolean;
}

export default function CephClient({ onBack }: { onBack: () => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6789');
  const [timeout, setTimeout_] = useState('10000');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CephResult | null>(null);
  const [action, setAction] = useState<'connect' | 'probe'>('connect');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const endpoint = action === 'connect' ? 'connect' : 'probe';
      const response = await fetch(`${API_BASE}/ceph/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port) || 6789,
          timeout: parseInt(timeout) || 10000,
        }),
      });

      const data = await response.json() as CephResult;
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
          <span className="text-4xl">🐙</span>
          <div>
            <h1 className="text-2xl font-bold text-white">Ceph Monitor</h1>
            <p className="text-slate-400 text-sm">MSGR Protocol — Port 6789</p>
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
                placeholder="ceph-mon1.example.com"
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
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white font-medium py-2 px-6 rounded-lg transition-colors"
            >
              {loading && action === 'connect' ? 'Connecting...' : 'Connect + Detect'}
            </button>
            <button
              type="submit"
              onClick={() => setAction('probe')}
              disabled={loading || !host}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-600 text-white font-medium py-2 px-6 rounded-lg transition-colors"
            >
              {loading && action === 'probe' ? 'Probing...' : 'Probe Banner'}
            </button>
          </div>
        </form>
      </div>

      {result && (
        <div className={`bg-slate-800 border rounded-xl p-6 ${
          result.success ? 'border-purple-500' : 'border-red-500'
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
                  <p className="text-slate-400 text-xs uppercase">Ceph Detected</p>
                  <p className={`text-lg font-bold ${result.isCeph ? 'text-green-400' : 'text-red-400'}`}>
                    {result.isCeph ? 'Yes' : 'No'}
                  </p>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase">MSGR Version</p>
                  <p className="text-lg font-bold text-purple-400">{result.msgrVersion}</p>
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
              </div>

              {result.banner && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-1">Banner</p>
                  <p className="text-green-300 font-mono text-sm">{result.banner}</p>
                </div>
              )}

              {result.entityInfo && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-2">Entity Address (MSGR v1)</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-slate-400">Type: </span>
                      <span className="text-white">{result.entityInfo.entityType}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Nonce: </span>
                      <span className="text-white">{result.entityInfo.nonce}</span>
                    </div>
                    {result.entityInfo.ipAddress && (
                      <div>
                        <span className="text-slate-400">IP: </span>
                        <span className="text-white">{result.entityInfo.ipAddress}</span>
                      </div>
                    )}
                    {result.entityInfo.port !== null && (
                      <div>
                        <span className="text-slate-400">Port: </span>
                        <span className="text-white">{result.entityInfo.port}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {result.v2Features && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-2">MSGR v2 Features</p>
                  <div className="space-y-1 text-sm">
                    {result.v2Features.supportedFeatures && (
                      <div>
                        <span className="text-slate-400">Supported: </span>
                        <span className="text-white font-mono">0x{BigInt(result.v2Features.supportedFeatures).toString(16)}</span>
                      </div>
                    )}
                    {result.v2Features.requiredFeatures && (
                      <div>
                        <span className="text-slate-400">Required: </span>
                        <span className="text-white font-mono">0x{BigInt(result.v2Features.requiredFeatures).toString(16)}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400">Payload Length: </span>
                      <span className="text-white">{result.v2Features.payloadLength} bytes</span>
                    </div>
                  </div>
                </div>
              )}

              {result.message && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-1">Message</p>
                  <p className="text-slate-200 text-sm">{result.message}</p>
                </div>
              )}

              {result.rawBytesReceived !== undefined && (
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs uppercase mb-1">Raw Bytes Received</p>
                  <p className="text-slate-200 text-sm">{result.rawBytesReceived} bytes</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-3">About Ceph Monitor Protocol</h3>
        <div className="text-slate-300 text-sm space-y-2">
          <p>
            Ceph is an open-source distributed storage system providing object, block, and
            file storage. The Monitor (MON) daemon maintains the cluster map and consensus
            using the Paxos algorithm.
          </p>
          <p>
            The <strong>MSGR</strong> (Messenger) protocol is Ceph's internal communication
            protocol. MSGR v1 uses a text banner ("ceph v027") while MSGR v2 (introduced in
            Nautilus) uses a modernized frame-based protocol with better encryption support.
          </p>
          <p className="text-slate-400">
            Default port: <code className="bg-slate-700 px-2 py-0.5 rounded">6789</code> (mon v1)
            or <code className="bg-slate-700 px-2 py-0.5 rounded">3300</code> (mon v2)
          </p>
        </div>
      </div>
    </div>
  );
}
