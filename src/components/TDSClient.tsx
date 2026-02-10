import { useState } from 'react';

interface TDSClientProps {
  onBack: () => void;
}

export default function TDSClient({ onBack }: TDSClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1433');
  const [loading, setLoading] = useState(false);
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
      const response = await fetch('/api/tds/connect', {
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
        version?: string;
        tdsVersion?: string;
        encryption?: string;
        instanceName?: string;
        mars?: boolean;
        threadId?: number;
        message?: string;
        host?: string;
        port?: number;
      };

      if (response.ok && data.success) {
        let text = `Connected to SQL Server at ${host}:${port}\n\n`;
        if (data.version) text += `Server Version:  ${data.version}\n`;
        if (data.tdsVersion) text += `TDS Version:     ${data.tdsVersion}\n`;
        if (data.encryption) text += `Encryption:      ${data.encryption}\n`;
        if (data.instanceName) text += `Instance:        ${data.instanceName}\n`;
        if (data.mars !== undefined) text += `MARS:            ${data.mars ? 'Enabled' : 'Disabled'}\n`;
        if (data.threadId !== undefined && data.threadId !== 0) text += `Thread ID:       ${data.threadId}\n`;
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
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
        <h1 className="text-3xl font-bold text-white">TDS / SQL Server Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="tds-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="tds-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="sql-server.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="tds-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="tds-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 1433 (SQL Server), 5000 (Sybase)</p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Test SQL Server connection"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Connecting...
            </span>
          ) : (
            'Test Connection'
          )}
        </button>

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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About TDS / SQL Server</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            TDS (Tabular Data Stream) is the protocol used by Microsoft SQL Server and Sybase ASE for
            client-server database communication. This tool performs the TDS Pre-Login handshake to detect
            the server version, TDS protocol level, encryption support, and MARS (Multiple Active Result Sets)
            capability without requiring authentication.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>Port 1433: SQL Server default</div>
            <div>Port 5000: Sybase ASE default</div>
            <div>TDS 7.4: SQL Server 2012-2019</div>
            <div>TDS 8.0: SQL Server 2022+</div>
          </div>
          <p className="text-xs text-slate-500 italic mt-3">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit
          </p>
        </div>
      </div>
    </div>
  );
}
