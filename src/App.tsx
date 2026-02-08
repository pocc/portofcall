import { useState } from 'react';
import './App.css';

function App() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const handleTcpPing = async () => {
    setLoading(true);
    setResult('');

    try {
      const response = await fetch('/api/ping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
        }),
      });

      const data = await response.json() as { success: boolean; rtt?: number; error?: string };

      if (data.success) {
        setResult(`✅ Connection successful! Round-trip time: ${data.rtt}ms`);
      } else {
        setResult(`❌ Connection failed: ${data.error}`);
      }
    } catch (error) {
      setResult(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>⚓ Port of Call</h1>
        <p className="subtitle">
          Browser-to-TCP Bridge via Cloudflare Workers Sockets API
        </p>
      </header>

      <main className="main">
        <div className="card">
          <h2>TCP Connection Tester</h2>
          <p className="description">
            Test TCP connectivity to any host and port using Cloudflare's Sockets API.
            This performs a TCP handshake (not an ICMP ping) and measures round-trip time.
          </p>

          <div className="form">
            <div className="input-group">
              <label htmlFor="host">Host</label>
              <input
                id="host"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="example.com"
                disabled={loading}
              />
            </div>

            <div className="input-group">
              <label htmlFor="port">Port</label>
              <input
                id="port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
                disabled={loading}
              />
            </div>

            <button
              onClick={handleTcpPing}
              disabled={loading || !host || !port}
              className="button"
            >
              {loading ? 'Testing...' : 'Test Connection'}
            </button>
          </div>

          {result && (
            <div className={`result ${result.startsWith('✅') ? 'success' : 'error'}`}>
              {result}
            </div>
          )}
        </div>

        <div className="info">
          <h3>About Port of Call</h3>
          <p>
            Port of Call leverages Cloudflare Workers' Sockets API (released May 16, 2023)
            to enable browser-based access to TCP protocols like SSH, databases, and more.
          </p>
          <ul>
            <li><strong>Smart Placement:</strong> Workers automatically migrate closer to your backend</li>
            <li><strong>TCP Access:</strong> Connect to any TCP service from the browser</li>
            <li><strong>Low Latency:</strong> Cloudflare's global network minimizes round-trip time</li>
          </ul>
        </div>
      </main>
    </div>
  );
}

export default App;
