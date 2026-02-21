import { useState } from 'react';

interface UWSGIClientProps {
  onBack: () => void;
}

export default function UWSGIClient({ onBack }: UWSGIClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3031');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
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
      const response = await fetch('/api/uwsgi/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        isUwsgi?: boolean;
        connectTime?: number;
        rtt?: number;
        responseSize?: number;
        statusCode?: number;
        statusText?: string;
        serverHeader?: string;
        contentType?: string;
      };

      if (response.ok && data.success) {
        let output = `uWSGI Probe: ${host}:${port}\n\n`;
        output += `Detected: ${data.isUwsgi ? 'Yes - uWSGI server' : 'Unknown (may not be uWSGI)'}\n`;
        output += `Status: ${data.statusCode} ${data.statusText}\n`;
        if (data.serverHeader) output += `Server: ${data.serverHeader}\n`;
        if (data.contentType) output += `Content-Type: ${data.contentType}\n`;
        output += `Response: ${data.responseSize} bytes\n`;
        output += `RTT: ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;
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

  const handleRequest = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/uwsgi/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          method,
          path,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        method?: string;
        path?: string;
        connectTime?: number;
        rtt?: number;
        statusCode?: number;
        statusText?: string;
        headers?: Record<string, string>;
        body?: string;
        bodySize?: number;
        responseSize?: number;
      };

      if (response.ok && data.success) {
        let output = `uWSGI Request: ${data.method} ${data.path} @ ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms (connect: ${data.connectTime}ms)\n\n`;
        output += `Status: ${data.statusCode} ${data.statusText}\n\n`;

        if (data.headers && Object.keys(data.headers).length > 0) {
          output += `Headers:\n`;
          const maxKeyLen = Math.max(...Object.keys(data.headers).map(k => k.length), 4);
          for (const [key, val] of Object.entries(data.headers)) {
            output += `  ${key.padEnd(maxKeyLen)}  ${val}\n`;
          }
          output += '\n';
        }

        if (data.body) {
          output += `Body (${data.bodySize} bytes):\n`;
          output += `${'─'.repeat(60)}\n`;
          output += data.body;
          if (data.bodySize && data.bodySize > 8192) {
            output += '\n... (truncated)';
          }
        }

        setResult(output);
      } else {
        setError(data.error || 'Request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
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
        <h1 className="text-3xl font-bold text-white">uWSGI Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="uwsgi-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="uwsgi-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="uwsgi.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="uwsgi-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="uwsgi-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 3031</p>
          </div>
        </div>

        <button
          onClick={handleProbe}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800 mb-6"
          aria-label="Send a probe request to detect uWSGI server"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Probing...
            </span>
          ) : (
            'Probe Server'
          )}
        </button>

        {/* Step 2: Custom Request */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Send Request</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div>
              <label htmlFor="uwsgi-method" className="block text-sm font-medium text-slate-300 mb-1">
                Method
              </label>
              <select
                id="uwsgi-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="HEAD">HEAD</option>
                <option value="OPTIONS">OPTIONS</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="uwsgi-path" className="block text-sm font-medium text-slate-300 mb-1">
                Path
              </label>
              <input
                id="uwsgi-path"
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <button
            onClick={handleRequest}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Send a custom WSGI request via the uWSGI binary protocol"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Sending...
              </span>
            ) : (
              `Send ${method} ${path}`
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About uWSGI</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            uWSGI is a full-featured application server and binary wire protocol for deploying
            Python WSGI/ASGI applications. The uwsgi protocol (lowercase) is a compact binary
            format used between web servers like <code className="text-slate-300">nginx</code> and
            the uWSGI application server. Each request is a 4-byte header (modifier, size, modifier)
            followed by WSGI environment variables encoded as length-prefixed key-value pairs.
            The server responds with raw HTTP data. Default port is 3031.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
