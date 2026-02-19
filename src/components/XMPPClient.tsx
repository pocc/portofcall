import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface XMPPClientProps {
  onBack: () => void;
}

export default function XMPPClient({ onBack }: XMPPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5222');
  const [domain, setDomain] = useState('');
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
      const response = await fetch('/api/xmpp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          domain: domain || undefined,
          timeout: 10000,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        domain?: string;
        streamId?: string;
        serverFrom?: string;
        xmppVersion?: string;
        tls?: { available: boolean; required: boolean };
        saslMechanisms?: string[];
        compressionMethods?: string[];
        features?: string[];
        raw?: string;
      };

      if (response.ok && data.success) {
        let output = `Connected to XMPP server at ${data.host}:${data.port}\n`;
        output += `Domain: ${data.domain || data.host}\n`;
        if (data.serverFrom) output += `Server Identity: ${data.serverFrom}\n`;
        if (data.streamId) output += `Stream ID: ${data.streamId}\n`;
        if (data.xmppVersion) output += `XMPP Version: ${data.xmppVersion}\n`;
        output += '\n';

        if (data.tls) {
          output += `TLS (STARTTLS): ${data.tls.available ? 'Available' : 'Not available'}`;
          if (data.tls.required) output += ' (Required)';
          output += '\n';
        }

        if (data.saslMechanisms && data.saslMechanisms.length > 0) {
          output += `\nSASL Authentication Mechanisms:\n`;
          data.saslMechanisms.forEach((m) => {
            output += `  - ${m}\n`;
          });
        }

        if (data.compressionMethods && data.compressionMethods.length > 0) {
          output += `\nCompression Methods:\n`;
          data.compressionMethods.forEach((m) => {
            output += `  - ${m}\n`;
          });
        }

        if (data.features && data.features.length > 0) {
          output += `\nServer Features:\n`;
          data.features.forEach((f) => {
            output += `  - ${f}\n`;
          });
        }

        setResult(output);
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
        <h1 className="text-3xl font-bold text-white">XMPP Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>


          <h2 className="text-xl font-semibold text-white">Server Probe</h2>
        </div>

      <ApiExamples examples={apiExamples.XMPP || []} />
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div>
            <label htmlFor="xmpp-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="xmpp-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="xmpp.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="xmpp-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="xmpp-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 5222</p>
          </div>

          <div>
            <label htmlFor="xmpp-domain" className="block text-sm font-medium text-slate-300 mb-1">
              Domain <span className="text-xs text-slate-400">(optional)</span>
            </label>
            <input
              id="xmpp-domain"
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">XMPP domain (defaults to host)</p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Probe XMPP server"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span
                className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
                aria-hidden="true"
              ></span>
              Connecting...
            </span>
          ) : (
            'Probe Server'
          )}
        </button>

        {/* Results */}
        {(result || error) && (
          <div
            className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600"
            role="region"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 mb-2">
              {error ? (
                <span className="text-red-400 text-xl" aria-hidden="true">
                  ✕
                </span>
              ) : (
                <span className="text-green-400 text-xl" aria-hidden="true">
                  ✓
                </span>
              )}
              <h3 className="text-sm font-semibold text-slate-300">{error ? 'Error' : 'Success'}</h3>
            </div>
            <pre
              className={`text-sm whitespace-pre-wrap font-mono ${error ? 'text-red-400' : 'text-green-400'}`}
            >
              {error || result}
            </pre>
          </div>
        )}

        {/* Help Section */}
        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About XMPP</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            XMPP (Extensible Messaging and Presence Protocol), formerly Jabber, is the open standard for
            instant messaging and presence. It uses XML streams over TCP on port 5222. This probe opens an
            XML stream to discover server features: TLS support, SASL authentication mechanisms (PLAIN,
            SCRAM-SHA-1, etc.), compression, and extensions. Used by WhatsApp, Google Talk (formerly), and
            many open-source chat systems like ejabberd, Prosody, and Openfire.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit
          </p>
        </div>
      </div>
    </div>
  );
}
