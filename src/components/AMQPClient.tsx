import { useState } from 'react';

interface AMQPClientProps {
  onBack: () => void;
}

export default function AMQPClient({ onBack }: AMQPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5672');
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
      const response = await fetch('/api/amqp/connect', {
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
        protocol?: string;
        product?: string;
        version?: string;
        platform?: string;
        mechanisms?: string[];
        locales?: string[];
        serverProperties?: Record<string, string>;
        host?: string;
        port?: number;
      };

      if (response.ok && data.success) {
        let text = `Connected to AMQP broker at ${host}:${port}\n\n`;
        text += `Protocol: ${data.protocol || 'Unknown'}\n`;
        text += `Product:  ${data.product || 'Unknown'}\n`;
        text += `Version:  ${data.version || 'Unknown'}\n`;
        text += `Platform: ${data.platform || 'Unknown'}\n`;

        if (data.mechanisms && data.mechanisms.length > 0) {
          text += `\nAuth Mechanisms: ${data.mechanisms.join(', ')}`;
        }

        if (data.locales && data.locales.length > 0) {
          text += `\nLocales: ${data.locales.join(', ')}`;
        }

        if (data.serverProperties) {
          text += '\n\nServer Properties:';
          for (const [key, value] of Object.entries(data.serverProperties)) {
            if (key !== 'product' && key !== 'version' && key !== 'platform') {
              text += `\n  ${key}: ${value}`;
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
        <h1 className="text-3xl font-bold text-white">AMQP Client</h1>
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
            <label htmlFor="amqp-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="amqp-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="rabbitmq.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="amqp-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="amqp-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 5672 (AMQP), 5671 (AMQPS)</p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Test AMQP connection"
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About AMQP</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            AMQP (Advanced Message Queuing Protocol) is an open standard for message-oriented middleware.
            It's the protocol behind RabbitMQ and other message brokers, providing reliable message delivery
            with routing, queuing, and pub/sub patterns. This tool performs the AMQP 0-9-1 handshake to
            detect the broker product, version, platform, and supported authentication mechanisms.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>Port 5672: AMQP (plain)</div>
            <div>Port 5671: AMQPS (TLS)</div>
            <div>Exchange types: direct, fanout, topic, headers</div>
            <div>Common broker: RabbitMQ</div>
          </div>
          <p className="text-xs text-slate-500 italic mt-3">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit
          </p>
        </div>
      </div>
    </div>
  );
}
