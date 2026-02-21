import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface AJPClientProps {
  onBack: () => void;
}

export default function AJPClient({ onBack }: AJPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8009');
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
      const response = await fetch('/api/ajp/connect', {
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
        protocol?: string;
        rtt?: number;
        cpong?: boolean;
        message?: string;
        rawHex?: string;
        host?: string;
        port?: number;
      };

      if (response.ok && data.success) {
        let text = `Connected to AJP connector at ${host}:${port}\n\n`;
        if (data.protocol) text += `Protocol:    ${data.protocol}\n`;
        if (data.rtt !== undefined) text += `RTT:         ${data.rtt}ms\n`;
        if (data.cpong) text += `CPong:       Valid ✓\n`;
        if (data.message) text += `\n${data.message}`;
        setResult(text);
      } else {
        let errText = data.error || 'Connection failed';
        if (data.rawHex) errText += `\nRaw response: ${data.rawHex}`;
        setError(errText);
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
        <h1 className="text-3xl font-bold text-white">AJP Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-orange-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>


          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

      <ApiExamples examples={apiExamples.AJP || []} />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="ajp-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="ajp-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="tomcat.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="ajp-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="ajp-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 8009</p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Test AJP connection"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Pinging...
            </span>
          ) : (
            'Send CPing'
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
                {error ? 'Error' : 'CPong Received'}
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About AJP</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            AJP (Apache JServ Protocol) is a binary protocol used to proxy requests from web servers
            (Apache, Nginx) to application servers (Tomcat, Jetty). This tool sends a CPing packet
            to test whether an AJP connector is listening and responsive. A valid CPong reply confirms
            the connector is active.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>Port 8009: Default AJP port</div>
            <div>Protocol: AJP/1.3 (binary)</div>
            <div>CPing/CPong: Health check</div>
            <div>CVE-2020-1938: Ghostcat vuln</div>
          </div>
          <p className="text-xs text-slate-500 italic mt-3">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit
          </p>
        </div>
      </div>
    </div>
  );
}
