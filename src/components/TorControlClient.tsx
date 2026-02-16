import { useState } from 'react';

interface TorControlClientProps {
  onBack: () => void;
}

export default function TorControlClient({ onBack }: TorControlClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9051');
  const [password, setPassword] = useState('');
  const [infoKeys, setInfoKeys] = useState('version,config-file,traffic/read,traffic/written,uptime');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleProbe = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/torcontrol/probe', {
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
        isTor?: boolean;
        torVersion?: string;
        protocolInfoVersion?: string;
        authMethods?: string[];
        cookieFile?: string;
        connectTime?: number;
        rtt?: number;
        statusCode?: number;
      };

      if (response.ok && data.success) {
        let output = `Tor Control Port at ${host}:${port}\n\n`;
        output += `Detected: ${data.isTor ? 'Yes - Tor Control Protocol' : 'Unknown'}\n`;
        output += `Tor Version: ${data.torVersion || 'unknown'}\n`;
        output += `Protocol Info: v${data.protocolInfoVersion || '?'}\n`;
        output += `RTT: ${data.rtt}ms (connect: ${data.connectTime}ms)\n\n`;

        if (data.authMethods && data.authMethods.length > 0) {
          output += `Authentication Methods:\n`;
          for (const method of data.authMethods) {
            let desc = '';
            switch (method) {
              case 'NULL': desc = '(no authentication required)'; break;
              case 'HASHEDPASSWORD': desc = '(password-based)'; break;
              case 'COOKIE': desc = '(cookie file)'; break;
              case 'SAFECOOKIE': desc = '(safe cookie)'; break;
              default: desc = '';
            }
            output += `  - ${method} ${desc}\n`;
          }
        }

        if (data.cookieFile) {
          output += `\nCookie File: ${data.cookieFile}\n`;
        }

        setResult(output);
      } else {
        setError(data.error || 'Probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Probe failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGetInfo = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const keys = infoKeys.split(',').map(k => k.trim()).filter(k => k);
      if (keys.length === 0) {
        setError('At least one info key is required');
        setLoading(false);
        return;
      }

      const response = await fetch('/api/torcontrol/getinfo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          password: password || undefined,
          keys,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        authenticated?: boolean;
        connectTime?: number;
        rtt?: number;
        info?: Record<string, string>;
        keys?: string[];
      };

      if (response.ok && data.success) {
        let output = `Tor GETINFO from ${host}:${port}\n`;
        output += `Authenticated: ${data.authenticated ? 'Yes' : 'No'}\n`;
        output += `RTT: ${data.rtt}ms (connect: ${data.connectTime}ms)\n\n`;

        if (data.info && Object.keys(data.info).length > 0) {
          const maxKeyLen = Math.max(...Object.keys(data.info).map(k => k.length), 3);
          output += `${'KEY'.padEnd(maxKeyLen)}  VALUE\n`;
          output += `${'─'.repeat(maxKeyLen)}  ${'─'.repeat(40)}\n`;
          for (const [key, val] of Object.entries(data.info)) {
            output += `${key.padEnd(maxKeyLen)}  ${val}\n`;
          }
        } else {
          output += '(no info returned)\n';
        }

        setResult(output);
      } else {
        setError(data.error || 'GETINFO failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GETINFO failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleProbe();
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
        <h1 className="text-3xl font-bold text-white">Tor Control Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection & Probe */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Probe Control Port</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="tor-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="tor-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="tor-relay.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="tor-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="tor-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 9051</p>
          </div>
        </div>

        <button
          onClick={handleProbe}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 mb-6"
          aria-label="Send PROTOCOLINFO to detect Tor and discover auth methods"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Probing...
            </span>
          ) : (
            'PROTOCOLINFO Probe'
          )}
        </button>

        {/* Step 2: Authenticated GETINFO */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">GETINFO Query</h2>
          </div>

          <div className="space-y-4 mb-4">
            <div>
              <label htmlFor="tor-password" className="block text-sm font-medium text-slate-300 mb-1">
                Password (if HASHEDPASSWORD auth)
              </label>
              <input
                id="tor-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave empty for NULL auth"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">Leave empty if Tor is configured for NULL authentication</p>
            </div>

            <div>
              <label htmlFor="tor-keys" className="block text-sm font-medium text-slate-300 mb-1">
                Info Keys (comma-separated)
              </label>
              <input
                id="tor-keys"
                type="text"
                value={infoKeys}
                onChange={(e) => setInfoKeys(e.target.value)}
                placeholder="version,config-file,traffic/read"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 mt-1">
                Common keys: version, config-file, traffic/read, traffic/written, uptime, process/pid
              </p>
            </div>
          </div>

          <button
            onClick={handleGetInfo}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Authenticate and send GETINFO query"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Querying...
              </span>
            ) : (
              'Authenticate & GETINFO'
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Tor Control Protocol</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            The Tor Control Protocol provides a text-based interface for controlling a running
            Tor process on TCP port 9051. The <code className="text-slate-300">PROTOCOLINFO</code> command
            can be sent without authentication to discover the Tor version and available auth methods
            (NULL, HASHEDPASSWORD, COOKIE, SAFECOOKIE). After authenticating, you can use
            <code className="text-slate-300"> GETINFO</code> to query version, traffic stats, uptime,
            and configuration. The protocol uses CRLF-delimited lines with 3-digit status codes
            (250 = OK, 5xx = error).
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
