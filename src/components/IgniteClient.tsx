import { useState } from 'react';

interface IgniteClientProps {
  onBack: () => void;
}

export default function IgniteClient({ onBack }: IgniteClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('10800');
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
      const response = await fetch('/api/ignite/connect', {
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
        rtt?: number;
        handshake?: string;
        requestedVersion?: string;
        nodeId?: string;
        serverVersion?: string;
        errorMessage?: string;
        featuresPresent?: boolean;
      };

      if (response.ok && data.success) {
        let output = `Apache Ignite at ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms\n\n`;
        output += `Handshake:  ${data.handshake === 'accepted' ? 'ACCEPTED' : 'REJECTED'}\n`;
        output += `Requested:  v${data.requestedVersion || '1.7.0'}\n`;
        if (data.nodeId) output += `Node ID:    ${data.nodeId}\n`;
        if (data.serverVersion) output += `Server Ver: v${data.serverVersion}\n`;
        if (data.featuresPresent) output += `Features:   Present\n`;
        if (data.errorMessage) output += `Error:      ${data.errorMessage}\n`;
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

  const handleProbe = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/ignite/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        rtt?: number;
        acceptedVersions?: number;
        totalProbed?: number;
        highestAccepted?: string | null;
        nodeId?: string;
        versions?: Array<{
          version: string;
          accepted: boolean;
          nodeId?: string;
          serverVersion?: string;
          error?: string;
        }>;
      };

      if (response.ok && data.success) {
        let output = `Apache Ignite Version Probe: ${host}:${port}\n`;
        output += `RTT: ${data.rtt}ms\n`;
        output += `Accepted: ${data.acceptedVersions}/${data.totalProbed} versions\n`;
        if (data.highestAccepted) output += `Highest:  v${data.highestAccepted}\n`;
        if (data.nodeId) output += `Node ID:  ${data.nodeId}\n`;
        output += `\n`;

        if (data.versions) {
          for (const ver of data.versions) {
            const status = ver.accepted ? '\u2713' : '\u2717';
            let line = `${status} v${ver.version.padEnd(8)} ${ver.accepted ? 'Accepted' : 'Rejected'}`;
            if (ver.serverVersion) line += ` (server: v${ver.serverVersion})`;
            if (ver.error) line += ` (${ver.error})`;
            output += `${line}\n`;
          }
        }
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
          &larr; Back
        </button>
        <h1 className="text-3xl font-bold text-white">Apache Ignite Client</h1>
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
            <label htmlFor="ignite-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="ignite-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ignite.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="ignite-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="ignite-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 10800 (Thin Client)</p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Test Ignite connection"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
              Connecting...
            </span>
          ) : (
            'Test Connection (v1.7.0 Handshake)'
          )}
        </button>

        {/* Step 2: Version Probe */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Version Probe</h2>
          </div>

          <p className="text-sm text-slate-400 mb-4">
            Tests multiple protocol versions (1.0 through 1.7) to determine server compatibility.
          </p>

          <button
            onClick={handleProbe}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Probe Ignite versions"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Probing...
              </span>
            ) : (
              'Probe Protocol Versions'
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Apache Ignite</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Apache Ignite is a distributed in-memory computing platform for transactional,
            analytical, and streaming workloads. It provides key-value storage, SQL queries,
            compute grids, and machine learning capabilities across a cluster of nodes.
          </p>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            The thin client protocol (port 10800) provides lightweight binary access using
            a version-negotiated handshake. The client sends its desired protocol version,
            and the server responds with acceptance or rejection (including its own supported
            version). Each connected node is identified by a UUID.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
