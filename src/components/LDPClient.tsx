import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface LDPMessage {
  type: number;
  typeName: string;
  length: number;
  messageId: number;
}

interface LDPSessionParams {
  protocolVersion: number;
  keepaliveTime: number;
  maxPduLength: number;
  receiverLsrId: string;
  receiverLabelSpace: number;
}

interface LDPResult {
  success: boolean;
  host?: string;
  port?: number;
  rtt?: number;
  connectTime?: number;
  isLDP?: boolean;
  version?: number;
  lsrId?: string;
  labelSpace?: number;
  messages?: LDPMessage[] | string[];
  sessionParams?: LDPSessionParams;
  rawBytesReceived?: number;
  message?: string;
  error?: string;
  isCloudflare?: boolean;
}

export default function LDPClient({ onBack }: { onBack: () => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('646');
  const [timeout, setTimeout_] = useState('10000');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LDPResult | null>(null);
  const [action, setAction] = useState<'connect' | 'probe'>('connect');

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);

    try {
      const endpoint = action === 'connect' ? '/api/ldp/connect' : '/api/ldp/probe';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port, 10),
          timeout: parseInt(timeout, 10),
        }),
      });

      const data = await response.json() as LDPResult;
      setResult(data);
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">      <button
        onClick={onBack}
        className="mb-6 text-slate-400 hover:text-slate-200 flex items-center gap-2"
      >
        <span>←</span> Back to protocols
      </button>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">🏷️</span>
          <div>
            <h2 className="text-xl font-bold text-white">LDP — Label Distribution Protocol</h2>
            <p className="text-slate-400 text-sm">Port 646 · RFC 5036 · MPLS Label Distribution</p>
          </div>

        </div>

      <ApiExamples examples={apiExamples.LDP || []} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-slate-400 text-sm mb-1">Host</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="lsr.example.com"
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
            className="bg-violet-600 hover:bg-violet-700 disabled:bg-slate-600 text-white px-4 py-2 rounded font-medium"
          >
            {loading && action === 'connect' ? 'Connecting...' : 'Init Handshake'}
          </button>
          <button
            onClick={() => { setAction('probe'); handleSubmit(); }}
            disabled={loading || !host.trim()}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white px-4 py-2 rounded font-medium"
          >
            {loading && action === 'probe' ? 'Probing...' : 'Probe Peer'}
          </button>
        </div>
      </div>

      {result && (
        <div className={`bg-slate-800 border rounded-xl p-6 ${result.success ? 'border-violet-500' : 'border-red-500'}`}>
          <h3 className={`text-lg font-bold mb-4 ${result.success ? 'text-violet-400' : 'text-red-400'}`}>
            {result.success ? 'LDP Peer Response' : 'Connection Failed'}
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
              {result.isLDP !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">LDP Detected</p>
                  <p className={`font-mono font-bold ${result.isLDP ? 'text-violet-400' : 'text-red-400'}`}>
                    {result.isLDP ? 'Yes' : 'No'}
                  </p>
                </div>
              )}
              {result.lsrId && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">LSR ID</p>
                  <p className="text-white font-mono">{result.lsrId}:{result.labelSpace}</p>
                </div>
              )}
              {result.version !== undefined && (
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Version</p>
                  <p className="text-white font-mono">v{result.version}</p>
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

          {result.sessionParams && (
            <div className="mt-4">
              <h4 className="text-slate-400 text-sm font-medium mb-2">Session Parameters</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Protocol Version</p>
                  <p className="text-white font-mono">{result.sessionParams.protocolVersion}</p>
                </div>
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Keepalive</p>
                  <p className="text-white font-mono">{result.sessionParams.keepaliveTime}s</p>
                </div>
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Max PDU</p>
                  <p className="text-white font-mono">{result.sessionParams.maxPduLength} bytes</p>
                </div>
                <div className="bg-slate-900/50 rounded p-3">
                  <p className="text-slate-500 text-xs uppercase">Receiver LSR</p>
                  <p className="text-white font-mono">{result.sessionParams.receiverLsrId}:{result.sessionParams.receiverLabelSpace}</p>
                </div>
              </div>
            </div>
          )}

          {result.messages && Array.isArray(result.messages) && result.messages.length > 0 && (
            <div className="mt-4">
              <h4 className="text-slate-400 text-sm font-medium mb-2">Messages ({result.messages.length})</h4>
              <div className="bg-slate-900 rounded p-3">
                {result.messages.map((msg, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b border-slate-800 last:border-0">
                    <span className="text-violet-400 font-mono text-sm">
                      {typeof msg === 'string' ? msg : msg.typeName}
                    </span>
                    {typeof msg !== 'string' && (
                      <span className="text-slate-500 text-xs">id={msg.messageId}, {msg.length}B</span>
                    )}
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
