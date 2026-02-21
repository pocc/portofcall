import { useState } from 'react';

interface STUNClientProps {
  onBack: () => void;
}

export default function STUNClient({ onBack }: STUNClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3478');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleBinding = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/stun/binding', {
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
        message?: string;
        host?: string;
        port?: number;
        rtt?: number;
        connectTime?: number;
        protocol?: {
          messageType: string;
          messageTypeName: string;
          validMagicCookie: boolean;
          transactionIdMatch: boolean;
        };
        publicAddress?: {
          ip: string;
          port: number;
          family: string;
        } | null;
        serverSoftware?: string | null;
        responseOrigin?: { ip: string; port: number } | null;
        otherAddress?: { ip: string; port: number } | null;
        errorCode?: { code: number; reason: string } | null;
        attributes?: { type: string; value: string }[];
      };

      if (response.ok && data.success) {
        let output = `STUN Binding Response from ${host}:${port}\n\n`;
        output += `Response: ${data.protocol?.messageTypeName || 'Unknown'}\n`;
        output += `RTT: ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;
        output += `Magic Cookie: ${data.protocol?.validMagicCookie ? 'Valid' : 'INVALID'}\n`;
        output += `Transaction ID: ${data.protocol?.transactionIdMatch ? 'Matched' : 'MISMATCH'}\n`;

        if (data.publicAddress) {
          output += `\nPublic Address (reflexive):\n`;
          output += `  IP: ${data.publicAddress.ip}\n`;
          output += `  Port: ${data.publicAddress.port}\n`;
          output += `  Family: ${data.publicAddress.family}\n`;
        }

        if (data.serverSoftware) {
          output += `\nServer Software: ${data.serverSoftware}\n`;
        }

        if (data.responseOrigin) {
          output += `\nResponse Origin: ${data.responseOrigin.ip}:${data.responseOrigin.port}\n`;
        }

        if (data.otherAddress) {
          output += `Other Address: ${data.otherAddress.ip}:${data.otherAddress.port}\n`;
        }

        if (data.errorCode) {
          output += `\nError: ${data.errorCode.code} ${data.errorCode.reason}\n`;
        }

        if (data.attributes && data.attributes.length > 0) {
          output += `\nAll Attributes (${data.attributes.length}):\n`;
          for (const attr of data.attributes) {
            output += `  ${attr.type}: ${attr.value}\n`;
          }
        }

        setResult(output);
      } else {
        setError(data.error || 'Binding request failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Binding request failed');
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
      const response = await fetch('/api/stun/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 8000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        alive?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        connectTime?: number;
        validStun?: boolean;
        responseType?: string;
        software?: string | null;
        hasXorMappedAddress?: boolean;
        hasMappedAddress?: boolean;
        attributeCount?: number;
      };

      if (response.ok && data.success) {
        let output = `STUN Probe Result for ${host}:${port}\n\n`;
        output += `Status: ${data.alive ? 'ALIVE - Valid STUN server' : 'Responded but not a valid STUN server'}\n`;
        output += `RTT: ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;
        output += `Response Type: ${data.responseType || 'Unknown'}\n`;
        output += `Valid STUN: ${data.validStun ? 'Yes' : 'No'}\n`;
        output += `XOR-MAPPED-ADDRESS: ${data.hasXorMappedAddress ? 'Present' : 'Not present'}\n`;
        output += `MAPPED-ADDRESS: ${data.hasMappedAddress ? 'Present' : 'Not present'}\n`;
        output += `Attributes: ${data.attributeCount}\n`;

        if (data.software) {
          output += `Software: ${data.software}\n`;
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
      handleBinding();
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
        <h1 className="text-3xl font-bold text-white">STUN Client</h1>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        {/* Step 1: Connection */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-sm">1</span>
          </div>
          <h2 className="text-xl font-semibold text-white">STUN Server</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <label htmlFor="stun-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="stun-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="stun.l.google.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="stun-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="stun-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Default: 3478 (STUNS: 5349)</p>
          </div>
        </div>

        {/* Step 2: Actions */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Actions</h2>
          </div>

          <div className="flex gap-4 mb-6">
            <button
              onClick={handleBinding}
              disabled={loading || !host}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
              aria-label="Send STUN Binding Request to discover public address"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                  Testing...
                </span>
              ) : (
                'Binding Request'
              )}
            </button>

            <button
              onClick={handleProbe}
              disabled={loading || !host}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
              aria-label="Probe STUN server to check if it is alive"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                  Probing...
                </span>
              ) : (
                'Server Probe'
              )}
            </button>
          </div>
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About STUN</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            STUN (RFC 5389/8489) is a protocol for NAT traversal used by WebRTC, VoIP, and
            other real-time communication systems. A Binding Request discovers the public IP
            address and port as seen by the STUN server (the "reflexive address"). This is
            essential for establishing peer-to-peer connections through NATs and firewalls.
            STUN uses TCP port 3478 (or 5349 for STUN over TLS). The protocol uses a binary
            format with a 20-byte header containing a magic cookie (0x2112A442) and 12-byte
            transaction ID.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
