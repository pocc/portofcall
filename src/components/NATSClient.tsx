import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface NATSClientProps {
  onBack: () => void;
}

export default function NATSClient({ onBack }: NATSClientProps) {
  const [host, setHost] = useState('demo.nats.io');
  const [port, setPort] = useState('4222');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [token, setToken] = useState('');
  const [subject, setSubject] = useState('test.portofcall');
  const [payload, setPayload] = useState('Hello from Port of Call!');
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
      const response = await fetch('/api/nats/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          user: user || undefined,
          pass: pass || undefined,
          token: token || undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        serverInfo?: {
          server_id?: string;
          version?: string;
          go?: string;
          max_payload?: number;
          auth_required?: boolean;
          tls_required?: boolean;
          jetstream?: boolean;
        };
      };

      if (response.ok && data.success) {
        const info = data.serverInfo;
        let output = `Connected to NATS server at ${host}:${port}\n\n`;
        output += `Server ID:     ${info?.server_id || 'Unknown'}\n`;
        output += `Version:       ${info?.version || 'Unknown'}\n`;
        output += `Go Version:    ${info?.go || 'Unknown'}\n`;
        output += `Max Payload:   ${info?.max_payload ? `${(info.max_payload / 1024 / 1024).toFixed(1)} MB` : 'Unknown'}\n`;
        output += `Auth Required: ${info?.auth_required ? 'Yes' : 'No'}\n`;
        output += `TLS Required:  ${info?.tls_required ? 'Yes' : 'No'}\n`;
        output += `JetStream:     ${info?.jetstream ? 'Enabled' : 'Disabled'}\n`;
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

  const handlePublish = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }
    if (!subject.trim()) {
      setError('Subject is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nats/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          user: user || undefined,
          pass: pass || undefined,
          token: token || undefined,
          subject: subject.trim(),
          payload,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        subject?: string;
        payloadSize?: number;
      };

      if (response.ok && data.success) {
        setResult(`Published to "${data.subject}"\nPayload size: ${data.payloadSize} bytes`);
      } else {
        setError(data.error || 'Publish failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDownConnect = (e: React.KeyboardEvent) => {
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
          &larr; Back
        </button>
        <h1 className="text-3xl font-bold text-white">NATS Client</h1>
      </div>      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>


          <h2 className="text-xl font-semibold text-white">Connection</h2>
        </div>

      <ApiExamples examples={apiExamples.NATS || []} />
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="nats-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="nats-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDownConnect}
              placeholder="demo.nats.io"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="nats-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="nats-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDownConnect}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 4222</p>
          </div>

          <div>
            <label htmlFor="nats-user" className="block text-sm font-medium text-slate-300 mb-1">
              Username <span className="text-xs text-slate-400">(optional)</span>
            </label>
            <input
              id="nats-user"
              type="text"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              onKeyDown={handleKeyDownConnect}
              placeholder="username"
              autoComplete="off"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="nats-pass" className="block text-sm font-medium text-slate-300 mb-1">
              Password <span className="text-xs text-slate-400">(optional)</span>
            </label>
            <input
              id="nats-pass"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={handleKeyDownConnect}
              placeholder="password"
              autoComplete="off"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="nats-token" className="block text-sm font-medium text-slate-300 mb-1">
              Auth Token <span className="text-xs text-slate-400">(optional, alternative to user/pass)</span>
            </label>
            <input
              id="nats-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={handleKeyDownConnect}
              placeholder="auth-token"
              autoComplete="off"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Test NATS connection"
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

        {/* Step 2: Publish */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Publish Message</h2>
          </div>

          <div className="grid md:grid-cols-1 gap-4 mb-4">
            <div>
              <label htmlFor="nats-subject" className="block text-sm font-medium text-slate-300 mb-1">
                Subject <span className="text-red-400" aria-label="required">*</span>
              </label>
              <input
                id="nats-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="test.subject"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-describedby="nats-subject-help"
              />
              <p id="nats-subject-help" className="text-xs text-slate-400 mt-1">
                Dot-separated subject hierarchy. Wildcards: * (one token), &gt; (all remaining)
              </p>
            </div>

            <div>
              <label htmlFor="nats-payload" className="block text-sm font-medium text-slate-300 mb-1">
                Payload
              </label>
              <textarea
                id="nats-payload"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder="Message payload"
                rows={3}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>
          </div>

          <button
            onClick={handlePublish}
            disabled={loading || !host || !subject.trim()}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Publish NATS message"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Publishing...
              </span>
            ) : (
              'Publish Message'
            )}
          </button>
        </div>

        {/* Results */}
        {(result || error) && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600" role="region" aria-live="polite">
            <div className="flex items-center gap-2 mb-2">
              {error ? (
                <span className="text-red-400 text-xl" aria-hidden="true">&#x2715;</span>
              ) : (
                <span className="text-green-400 text-xl" aria-hidden="true">&#x2713;</span>
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About NATS</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            NATS is a lightweight, high-performance messaging system for cloud-native applications,
            IoT, and microservices. It uses a simple text-based protocol with pub/sub, request/reply,
            and queue group patterns. Port 4222 is the default client port. The public demo server
            at demo.nats.io is available for testing.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Subject hierarchy uses dots (e.g., <code className="bg-slate-700 px-1 rounded">sensors.temperature.room1</code>).
            Wildcards: <code className="bg-slate-700 px-1 rounded">*</code> matches one token,
            <code className="bg-slate-700 px-1 rounded">&gt;</code> matches all remaining tokens.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
