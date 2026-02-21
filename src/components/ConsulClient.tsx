import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface ConsulClientProps {
  onBack: () => void;
}

export default function ConsulClient({ onBack }: ConsulClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8500');
  const [token, setToken] = useState('');
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
      const response = await fetch('/api/consul/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          token: token || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        version?: string;
        datacenter?: string;
        nodeName?: string;
        server?: boolean | null;
        services?: string[];
        serviceCount?: number;
        latencyMs?: number;
        statusCode?: number;
        isCloudflare?: boolean;
        host?: string;
        port?: number;
      };

      if (response.ok && data.success) {
        let text = `Connected to Consul at ${host}:${port}\n\n`;
        if (data.version) text += `Version:      ${data.version}\n`;
        if (data.datacenter) text += `Datacenter:   ${data.datacenter}\n`;
        if (data.nodeName) text += `Node:         ${data.nodeName}\n`;
        if (data.server !== null && data.server !== undefined) {
          text += `Role:         ${data.server ? 'Server' : 'Client'}\n`;
        }
        if (data.latencyMs !== undefined) text += `Latency:      ${data.latencyMs}ms\n`;
        if (data.statusCode) text += `HTTP Status:  ${data.statusCode}\n`;
        if (data.serviceCount !== undefined) {
          text += `\nRegistered Services: ${data.serviceCount}\n`;
          if (data.services && data.services.length > 0) {
            for (const svc of data.services) {
              text += `  • ${svc}\n`;
            }
          }
        }
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
        <h1 className="text-3xl font-bold text-white">Consul Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-pink-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>


          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

      <ApiExamples examples={apiExamples.Consul || []} />
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div>
            <label htmlFor="consul-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="consul-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="consul.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="consul-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="consul-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 8500</p>
          </div>

          <div>
            <label htmlFor="consul-token" className="block text-sm font-medium text-slate-300 mb-1">
              ACL Token
            </label>
            <input
              id="consul-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Optional"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-pink-600 hover:bg-pink-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Test Consul connection"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Connecting...
            </span>
          ) : (
            'Check Health'
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
                {error ? 'Error' : 'Connected'}
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Consul</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Consul by HashiCorp provides service discovery, health checking, and key-value
            configuration via an HTTP API. This tool connects to the Consul agent API to retrieve
            server version, datacenter, node info, and registered services.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>Port 8500: HTTP API</div>
            <div>Port 8600: DNS interface</div>
            <div>Service discovery & mesh</div>
            <div>KV config store</div>
          </div>
          <p className="text-xs text-slate-500 italic mt-3">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit
          </p>
        </div>
      </div>
    </div>
  );
}
