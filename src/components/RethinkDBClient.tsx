import { useState } from 'react';

interface RethinkDBClientProps {
  onBack: () => void;
}

export default function RethinkDBClient({ onBack }: RethinkDBClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('28015');
  const [authKey, setAuthKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleConnect = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/rethinkdb/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          authKey,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        connectTime?: number;
        protocolVersion?: string;
        isRethinkDB?: boolean;
        authenticated?: boolean;
        serverVersion?: string;
        rawResponse?: string;
        message?: string;
      };

      if (response.ok && data.success) {
        let text = `RethinkDB Connection Test — ${host}:${port}\n\n`;
        text += `RethinkDB Server:  ${data.isRethinkDB ? 'DETECTED' : 'NOT DETECTED'}\n`;
        text += `Protocol Version:  ${data.protocolVersion || 'V0.4'}\n`;
        text += `Server Version:    ${data.serverVersion || 'Unknown'}\n`;
        text += `Authenticated:     ${data.authenticated ? 'YES' : 'NO'}\n`;
        if (data.connectTime) text += `Connect Time:      ${data.connectTime}ms\n`;
        if (data.rtt) text += `Round Trip Time:   ${data.rtt}ms\n`;
        if (data.rawResponse) text += `\nRaw Response:      ${data.rawResponse}\n`;
        text += `\n${data.message}`;
        setResult(text);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleProbe = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setProbing(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/rethinkdb/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        isRethinkDB?: boolean;
        serverVersion?: string;
        rawResponse?: string;
        message?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let text = `RethinkDB Probe — ${host}:${port}\n\n`;
        text += `RethinkDB Server:  ${data.isRethinkDB ? 'DETECTED' : 'NOT DETECTED'}\n`;
        text += `Server Version:    ${data.serverVersion || 'Unknown'}\n`;
        if (data.rtt) text += `Round Trip Time:   ${data.rtt}ms\n`;
        if (data.rawResponse) text += `\nRaw Response:      ${data.rawResponse}\n`;
        text += `\n${data.message}`;
        setResult(text);
      } else {
        setError(data.error || 'Probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Probe failed');
    } finally {
      setProbing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && !probing && host) {
      handleConnect();
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-white hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
          aria-label="Go back to protocol selector"
        >
          ← Back
        </button>
        <h1 className="text-3xl font-bold text-white">RethinkDB Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="rethink-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="rethink-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="rethinkdb.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="rethink-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="rethink-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 28015</p>
          </div>
        </div>

        {/* Step 2: Authentication */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">2</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Authentication (Optional)</h2>
        </div>

        <div className="mb-6">
          <div>
            <label htmlFor="rethink-auth-key" className="block text-sm font-medium text-slate-300 mb-1">
              Auth Key
            </label>
            <input
              id="rethink-auth-key"
              type="password"
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="(optional — empty for no auth)"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-slate-400 mt-1">V0.4 auth key. Leave empty if authentication is disabled.</p>
          </div>
        </div>

        {/* Step 3: Actions */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">3</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Action</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <button
            onClick={handleConnect}
            disabled={loading || probing || !host}
            className="bg-teal-600 hover:bg-teal-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Attempt RethinkDB V0.4 handshake with auth key"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Connecting...
              </span>
            ) : (
              'Connect (V0.4)'
            )}
          </button>

          <button
            onClick={handleProbe}
            disabled={loading || probing || !host}
            className="bg-slate-600 hover:bg-slate-500 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Quick probe for RethinkDB server using V1.0 SCRAM"
          >
            {probing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Probing...
              </span>
            ) : (
              'Probe Server (V1.0)'
            )}
          </button>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600" role="region" aria-live="polite">
            <div className="flex items-center gap-2 mb-2">
              {error ? (
                <span className="text-red-400 text-xl" aria-hidden="true">✕</span>
              ) : (
                <span className="text-green-400 text-xl" aria-hidden="true">✓</span>
              )}
              <h3 className="text-sm font-semibold text-slate-300">
                {error ? 'Error' : 'Success'}
              </h3>
            </div>
            <pre className={`text-sm whitespace-pre-wrap font-mono ${
              error ? 'text-red-400' : 'text-green-400'
            }`}>
              {error || result}
            </pre>
          </div>
        )}

        {/* Help Section */}
        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About RethinkDB</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            RethinkDB is an open-source distributed document database designed for real-time
            applications. It uses the ReQL query language and supports real-time changefeeds
            that push updated query results to applications in real-time. The wire protocol
            uses a binary handshake followed by JSON-encoded ReQL queries.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>Port 28015: Client driver port</div>
            <div>Port 29015: Cluster port</div>
            <div>Port 8080: Web admin UI</div>
            <div>V0.4: Legacy auth key protocol</div>
            <div>V1.0: SCRAM-SHA-256 auth</div>
            <div>Protocol: JSON over TCP</div>
          </div>
          <p className="text-xs text-slate-500 italic mt-3">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit
            — <strong>Connect</strong> uses V0.4 handshake with auth key, <strong>Probe</strong> uses V1.0 SCRAM detection
          </p>
        </div>
      </div>
    </div>
  );
}
