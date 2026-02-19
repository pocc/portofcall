import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface SMPPClientProps {
  onBack: () => void;
}

export default function SMPPClient({ onBack }: SMPPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2775');
  const [systemId, setSystemId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
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
      const response = await fetch('/api/smpp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          systemId: systemId || 'probe',
          password,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        smppDetected?: boolean;
        commandName?: string;
        commandStatus?: number;
        statusName?: string;
        bound?: boolean;
        serverSystemId?: string;
        interfaceVersion?: number;
        interfaceVersionName?: string;
        message?: string;
      };

      if (response.ok && data.success) {
        let text = `SMPP Connection Test — ${host}:${port}\n\n`;
        text += `SMPP Server:       ${data.smppDetected ? 'DETECTED' : 'NOT DETECTED'}\n`;
        text += `Bind Status:       ${data.bound ? 'BOUND (authenticated)' : 'REFUSED'}\n`;
        text += `Response:          ${data.commandName}\n`;
        text += `Status:            ${data.statusName}\n`;
        if (data.serverSystemId) text += `Server System ID:  ${data.serverSystemId}\n`;
        if (data.interfaceVersionName) text += `Interface Version: ${data.interfaceVersionName}\n`;
        text += `\n${data.message}`;
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

  const handleProbe = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setProbing(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/smpp/probe', {
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
        isSmpp?: boolean;
        commandName?: string;
        statusName?: string;
        message?: string;
      };

      if (response.ok && data.success) {
        let text = `SMPP Probe — ${host}:${port}\n\n`;
        text += `SMPP Server:  ${data.isSmpp ? 'DETECTED' : 'NOT DETECTED'}\n`;
        text += `Response:     ${data.commandName}\n`;
        text += `Status:       ${data.statusName}\n`;
        text += `\n${data.message}`;
        setResult(text);
      } else {
        setError(data.error || 'Probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Probe failed');
    } finally {
      setProbing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && !probing && host) {
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
        <h1 className="text-3xl font-bold text-white">SMPP Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>


          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

      <ApiExamples examples={apiExamples.SMPP || []} />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="smpp-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="smpp-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="smsc.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="smpp-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="smpp-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 2775</p>
          </div>
        </div>

        {/* Step 2: Authentication */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">2</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Authentication (Optional)</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="smpp-system-id" className="block text-sm font-medium text-slate-300 mb-1">
              System ID
            </label>
            <input
              id="smpp-system-id"
              type="text"
              value={systemId}
              onChange={(e) => setSystemId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="probe"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-slate-400 mt-1">ESME identifier (max 15 chars)</p>
          </div>

          <div>
            <label htmlFor="smpp-password" className="block text-sm font-medium text-slate-300 mb-1">
              Password
            </label>
            <input
              id="smpp-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="(optional)"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-slate-400 mt-1">ESME password (max 8 chars)</p>
          </div>
        </div>

        {/* Step 3: Actions */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">3</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Action</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <button
            onClick={handleConnect}
            disabled={loading || probing || !host}
            className="bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Attempt SMPP bind with credentials"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Binding...
              </span>
            ) : (
              'Bind Transceiver'
            )}
          </button>

          <button
            onClick={handleProbe}
            disabled={loading || probing || !host}
            className="bg-slate-600 hover:bg-slate-500 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Quick probe for SMPP server"
          >
            {probing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Probing...
              </span>
            ) : (
              'Probe Server'
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About SMPP</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            SMPP (Short Message Peer-to-Peer) v3.4 is the industry-standard protocol for
            exchanging SMS messages between Short Message Service Centers (SMSCs) and application
            platforms (ESMEs). Used by telecom carriers, SMS gateways (Twilio, Vonage, etc.),
            and bulk messaging providers. This tool performs a bind_transceiver handshake to
            detect SMPP servers and test authentication credentials.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>Port 2775: Standard SMPP port</div>
            <div>Port 2776: SMPP over TLS</div>
            <div>SMPP v3.4: Most common version</div>
            <div>SMPP v5.0: Extended features</div>
          </div>
          <p className="text-xs text-slate-500 italic mt-3">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit
            — <strong>Bind</strong> tests authentication, <strong>Probe</strong> just detects the server
          </p>
        </div>
      </div>
    </div>
  );
}
