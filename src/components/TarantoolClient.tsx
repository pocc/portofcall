import { useState } from 'react';

interface TarantoolClientProps {
  onBack: () => void;
}

export default function TarantoolClient({ onBack }: TarantoolClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3301');
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
      const response = await fetch('/api/tarantool/connect', {
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
        host?: string;
        port?: number;
        rtt?: number;
        connectTime?: number;
        isTarantool?: boolean;
        version?: string;
        instanceInfo?: string;
        salt?: string;
        pingSuccess?: boolean;
        pingStatus?: number;
        schemaVersion?: number;
        pingError?: string;
        greetingLine1?: string;
        message?: string;
      };

      if (response.ok && data.success) {
        let text = `Tarantool Connection Test — ${host}:${port}\n\n`;
        text += `Tarantool Server: ${data.isTarantool ? 'DETECTED' : 'NOT DETECTED'}\n`;
        text += `Version:          ${data.version || 'Unknown'}\n`;
        if (data.instanceInfo) text += `Instance:         ${data.instanceInfo}\n`;
        text += `PING Status:      ${data.pingSuccess ? 'OK (responsive)' : 'FAILED'}\n`;
        if (data.schemaVersion) text += `Schema Version:   ${data.schemaVersion}\n`;
        if (data.connectTime) text += `Connect Time:     ${data.connectTime}ms\n`;
        if (data.rtt) text += `Round Trip Time:  ${data.rtt}ms\n`;
        if (data.greetingLine1) text += `\nGreeting:         ${data.greetingLine1}\n`;
        if (data.salt) text += `Salt:             ${data.salt}\n`;
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
      const response = await fetch('/api/tarantool/probe', {
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
        isTarantool?: boolean;
        version?: string;
        instanceInfo?: string;
        greetingLine1?: string;
        message?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let text = `Tarantool Probe — ${host}:${port}\n\n`;
        text += `Tarantool Server: ${data.isTarantool ? 'DETECTED' : 'NOT DETECTED'}\n`;
        text += `Version:          ${data.version || 'Unknown'}\n`;
        if (data.instanceInfo) text += `Instance:         ${data.instanceInfo}\n`;
        if (data.rtt) text += `Round Trip Time:  ${data.rtt}ms\n`;
        if (data.greetingLine1) text += `\nGreeting:         ${data.greetingLine1}\n`;
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
        <h1 className="text-3xl font-bold text-white">Tarantool Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="tarantool-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="tarantool-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="tarantool.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="tarantool-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="tarantool-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 3301</p>
          </div>
        </div>

        {/* Step 2: Actions */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">2</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Action</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <button
            onClick={handleConnect}
            disabled={loading || probing || !host}
            className="bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Connect and send IPROTO_PING"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Connecting...
              </span>
            ) : (
              'Connect + PING'
            )}
          </button>

          <button
            onClick={handleProbe}
            disabled={loading || probing || !host}
            className="bg-slate-600 hover:bg-slate-500 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Quick probe to read server greeting"
          >
            {probing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Probing...
              </span>
            ) : (
              'Probe Greeting'
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Tarantool</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Tarantool is a high-performance in-memory computing platform combining a database
            and application server. It uses the IPROTO binary protocol with MessagePack encoding
            for all data. On connection, the server sends a 128-byte greeting containing version
            info and a salt for CHAP-SHA1 authentication.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>Port 3301: Default client port</div>
            <div>Port 3302+: Replica/additional instances</div>
            <div>IPROTO: MessagePack-encoded binary</div>
            <div>Auth: CHAP-SHA1 with greeting salt</div>
            <div>128-byte greeting on connect</div>
            <div>Lua/SQL query support</div>
          </div>
          <p className="text-xs text-slate-500 italic mt-3">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit
            — <strong>Connect</strong> reads greeting + sends PING, <strong>Probe</strong> reads greeting only
          </p>
        </div>
      </div>
    </div>
  );
}
