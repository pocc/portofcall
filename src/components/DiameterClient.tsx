import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface DiameterClientProps {
  onBack: () => void;
}

export default function DiameterClient({ onBack }: DiameterClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3868');
  const [originHost, setOriginHost] = useState('portofcall.ross.gg');
  const [originRealm, setOriginRealm] = useState('ross.gg');
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
      const response = await fetch('/api/diameter/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          originHost,
          originRealm,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        protocol?: {
          version: number;
          commandName: string;
          resultCode: number;
          resultCodeName: string;
          applicationId: number;
        };
        peerInfo?: Record<string, string>;
        rawAvpCount?: number;
      };

      if (response.ok && data.success) {
        let output = `Connected to Diameter peer at ${host}:${port}\n\n`;
        output += `Response: ${data.protocol?.commandName || 'Unknown'}\n`;
        output += `Result: ${data.protocol?.resultCodeName || 'Unknown'} (${data.protocol?.resultCode})\n`;
        output += `Version: ${data.protocol?.version}\n`;
        output += `Application-ID: ${data.protocol?.applicationId}\n`;
        output += `AVP Count: ${data.rawAvpCount}\n`;

        if (data.peerInfo && Object.keys(data.peerInfo).length > 0) {
          output += '\nPeer Information:\n';
          for (const [key, value] of Object.entries(data.peerInfo)) {
            output += `  ${key}: ${value}\n`;
          }
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

  const handleWatchdog = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/diameter/watchdog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          originHost,
          originRealm,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
        rtt?: number;
        commandName?: string;
        peerInfo?: Record<string, string>;
      };

      if (response.ok && data.success) {
        let output = `Watchdog response from ${host}:${port}\n\n`;
        output += `Response: ${data.commandName || 'Unknown'}\n`;
        output += `RTT: ${data.rtt}ms\n`;

        if (data.peerInfo && Object.keys(data.peerInfo).length > 0) {
          output += '\nPeer Information:\n';
          for (const [key, value] of Object.entries(data.peerInfo)) {
            output += `  ${key}: ${value}\n`;
          }
        }

        setResult(output);
      } else {
        setError(data.error || 'Watchdog failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Watchdog failed');
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
        <h1 className="text-3xl font-bold text-white">Diameter Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>


          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

      <ApiExamples examples={apiExamples.Diameter || []} />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="diameter-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="diameter-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="diameter.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="diameter-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="diameter-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 3868</p>
          </div>

          <div>
            <label htmlFor="diameter-origin-host" className="block text-sm font-medium text-slate-300 mb-1">
              Origin-Host
            </label>
            <input
              id="diameter-origin-host"
              type="text"
              value={originHost}
              onChange={(e) => setOriginHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="client.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="diameter-origin-realm" className="block text-sm font-medium text-slate-300 mb-1">
              Origin-Realm
            </label>
            <input
              id="diameter-origin-realm"
              type="text"
              value={originRealm}
              onChange={(e) => setOriginRealm(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex gap-4 mb-6">
          <button
            onClick={handleConnect}
            disabled={loading || !host}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Test Diameter connection with CER/CEA exchange"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Connecting...
              </span>
            ) : (
              'Capabilities Exchange (CER/CEA)'
            )}
          </button>
        </div>

        {/* Step 2: Watchdog */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Device Watchdog</h2>
          </div>

          <button
            onClick={handleWatchdog}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Send Device Watchdog Request"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Sending...
              </span>
            ) : (
              'Send Watchdog (DWR/DWA)'
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Diameter</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Diameter (RFC 6733) is a modern AAA protocol and successor to RADIUS. It uses TCP port 3868
            for reliable transport and is widely used in 4G LTE and 5G mobile networks for authentication,
            authorization, accounting, and policy control. The protocol uses binary framing with
            Attribute-Value Pairs (AVPs) and supports capabilities exchange (CER/CEA) and device
            watchdog (DWR/DWA) for peer health monitoring.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
