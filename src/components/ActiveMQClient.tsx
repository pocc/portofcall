import { useState } from 'react';

interface ActiveMQClientProps {
  onBack: () => void;
}

export default function ActiveMQClient({ onBack }: ActiveMQClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('61616');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');

  const handleConnect = async () => {
    if (!host.trim()) {
      setResult('❌ Error: Please enter a host');
      return;
    }

    setLoading(true);
    setResult('');

    try {
      const response = await fetch('/api/activemq/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port) || 61616,
          timeout: 15000,
        }),
      });

      const data = await response.json();

      if (data.isCloudflare) {
        setResult(`🔒 Cloudflare Protection Detected\n\n${data.error}`);
      } else if (data.success) {
        let output = `✅ ${data.message}\n\n`;

        if (data.wireFormat) {
          output += `📋 WireFormat Info:\n`;
          output += `  Version: ${data.wireFormat.version}\n`;
        }

        if (data.broker) {
          output += `\n🏢 Broker Info:\n`;
          if (data.broker.brokerName) {
            output += `  Name: ${data.broker.brokerName}\n`;
          }
          if (data.broker.brokerURL) {
            output += `  URL: ${data.broker.brokerURL}\n`;
          }
          if (data.broker.brokerId) {
            output += `  ID: ${data.broker.brokerId}\n`;
          }
        }

        setResult(output.trim());
      } else {
        setResult(`❌ Connection Failed\n\n${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      setResult(`❌ Error: ${error instanceof Error ? error.message : 'Request failed'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleProbe = async () => {
    if (!host.trim()) {
      setResult('❌ Error: Please enter a host');
      return;
    }

    setLoading(true);
    setResult('');

    try {
      const response = await fetch('/api/activemq/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: host.trim(),
          port: parseInt(port) || 61616,
          timeout: 15000,
        }),
      });

      const data = await response.json();

      if (data.isCloudflare) {
        setResult(`🔒 Cloudflare Protection Detected\n\n${data.error}`);
      } else if (data.success) {
        let output = `✅ Broker Probe Successful\n\n`;

        if (data.wireFormat) {
          output += `📋 OpenWire Protocol:\n`;
          output += `  Version: ${data.wireFormat.version}\n`;
        }

        if (data.broker) {
          output += `\n🏢 Broker Details:\n`;
          if (data.broker.brokerName) {
            output += `  Name: ${data.broker.brokerName}\n`;
          }
          if (data.broker.brokerURL) {
            output += `  URL: ${data.broker.brokerURL}\n`;
          }
          if (data.broker.brokerId) {
            output += `  Broker ID: ${data.broker.brokerId}\n`;
          }
          if (data.broker.networkConnection !== undefined) {
            output += `  Network Connection: ${data.broker.networkConnection}\n`;
          }
          if (data.broker.duplex !== undefined) {
            output += `  Duplex: ${data.broker.duplex}\n`;
          }
        }

        setResult(output.trim());
      } else {
        setResult(`❌ Probe Failed\n\n${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      setResult(`❌ Error: ${error instanceof Error ? error.message : 'Request failed'}`);
    } finally {
      setLoading(false);
    }
  };

  const quickConnect = (quickHost: string, quickPort: string, label: string) => {
    setHost(quickHost);
    setPort(quickPort);
    setResult(`💡 Preset loaded: ${label}\nClick "Test Connection" to connect.`);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="text-4xl">🔄</div>
            <div>
              <h2 className="text-2xl font-bold text-white">Apache ActiveMQ</h2>
              <p className="text-slate-400 text-sm">OpenWire Binary Protocol (Port 61616)</p>
            </div>
          </div>
          <button
            onClick={onBack}
            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors duration-200"
          >
            ← Back
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Broker Host
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="localhost"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="61616"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleConnect}
              disabled={loading || !host.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium py-3 px-6 rounded-lg transition-colors duration-200"
            >
              {loading ? '⏳ Connecting...' : '🔌 Test Connection'}
            </button>
            <button
              onClick={handleProbe}
              disabled={loading || !host.trim()}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium py-3 px-6 rounded-lg transition-colors duration-200"
            >
              {loading ? '⏳ Probing...' : '🔍 Probe Broker'}
            </button>
          </div>

          {/* Quick Connect Presets */}
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
            <p className="text-sm font-medium text-slate-300 mb-3">Quick Connect:</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => quickConnect('localhost', '61616', 'Local ActiveMQ')}
                className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-3 py-1.5 rounded transition-colors"
                disabled={loading}
              >
                🏠 localhost:61616
              </button>
              <button
                onClick={() => quickConnect('activemq.example.com', '61616', 'Example Broker')}
                className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-3 py-1.5 rounded transition-colors"
                disabled={loading}
              >
                🌐 activemq.example.com
              </button>
            </div>
          </div>
        </div>
      </div>

      {result && (
        <div className="bg-slate-900 border border-slate-600 rounded-xl p-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-3">Response:</h3>
          <pre className="text-slate-300 whitespace-pre-wrap font-mono text-sm bg-slate-950 p-4 rounded-lg overflow-x-auto">
            {result}
          </pre>
        </div>
      )}

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-3">About Apache ActiveMQ</h3>
        <div className="text-slate-300 space-y-2 text-sm">
          <p>
            <strong className="text-white">Apache ActiveMQ</strong> is a popular open-source message
            broker written in Java, supporting multiple protocols including OpenWire (its native binary
            protocol), STOMP, AMQP, and MQTT.
          </p>
          <p>
            <strong className="text-white">OpenWire Protocol:</strong> The native binary protocol used
            by ActiveMQ for high-performance messaging. It uses command-based marshalling and supports
            advanced features like message persistence, transactions, and clustering.
          </p>
          <p>
            <strong className="text-white">Connection Flow:</strong> Client sends WIREFORMAT_INFO
            command with protocol version and capabilities. Server responds with its WireFormat
            configuration and optionally BROKER_INFO containing broker name, URL, and cluster details.
          </p>
          <p>
            <strong className="text-white">Common Uses:</strong> Enterprise messaging, microservices
            communication, event-driven architectures, and integration with Java EE applications.
          </p>
          <div className="bg-blue-900/20 border border-blue-600/30 rounded p-3 mt-4">
            <p className="text-blue-200">
              <strong>💡 Tip:</strong> This client performs a protocol handshake to detect ActiveMQ
              brokers and retrieve broker information. For full messaging operations, use a dedicated
              ActiveMQ client library.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
