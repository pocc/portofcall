import { useState } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface Socks5ClientProps {
  onBack: () => void;
}

interface Socks5Result {
  success: boolean;
  granted?: boolean;
  proxyHost?: string;
  proxyPort?: number;
  destHost?: string;
  destPort?: number;
  authMethod?: string;
  authSuccess?: boolean | null;
  replyCode?: number;
  replyMessage?: string;
  boundAddress?: string;
  boundPort?: number;
  connectTimeMs?: number;
  totalTimeMs?: number;
  error?: string;
  isCloudflare?: boolean;
}

export default function Socks5Client({ onBack }: Socks5ClientProps) {
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState('1080');
  const [destHost, setDestHost] = useState('example.com');
  const [destPort, setDestPort] = useState('80');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Socks5Result[]>([]);

  const handleTest = async () => {
    if (!proxyHost.trim()) return;

    setLoading(true);

    try {
      const response = await fetch('/api/socks5/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyHost: proxyHost.trim(),
          proxyPort: parseInt(proxyPort, 10),
          destHost: destHost.trim(),
          destPort: parseInt(destPort, 10),
          ...(username && { username }),
          ...(password && { password }),
        }),
      });

      const data = (await response.json()) as Socks5Result;
      setResults((prev) => [data, ...prev]);
    } catch (err) {
      setResults((prev) => [
        { success: false, error: err instanceof Error ? err.message : 'Network error' },
        ...prev,
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleTest();
  };

  return (
    <div className="max-w-6xl mx-auto">      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <button onClick={onBack} className="text-white hover:text-blue-400 transition-colors">
          &larr; Back
        </button>
        <h1 className="text-3xl font-bold text-white">SOCKS5 Client</h1>
      </div>


      <ApiExamples examples={apiExamples.SOCKS5 || []} />
      <div className="grid lg:grid-cols-4 gap-6">
        {/* Config Panel */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Proxy Settings</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Proxy Host
                </label>
                <input
                  type="text"
                  value={proxyHost}
                  onChange={(e) => setProxyHost(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="proxy.example.com"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Proxy Port
                </label>
                <input
                  type="number"
                  value={proxyPort}
                  onChange={(e) => setProxyPort(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="border-t border-slate-600 pt-4">
                <h3 className="text-sm font-semibold text-slate-300 mb-3">Destination</h3>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Dest Host
                    </label>
                    <input
                      type="text"
                      value={destHost}
                      onChange={(e) => setDestHost(e.target.value)}
                      placeholder="example.com"
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      Dest Port
                    </label>
                    <input
                      type="number"
                      value={destPort}
                      onChange={(e) => setDestPort(e.target.value)}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-600 pt-4">
                <h3 className="text-sm font-semibold text-slate-300 mb-3">
                  Authentication <span className="text-slate-500">(optional)</span>
                </h3>

                <div className="space-y-3">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <button
                onClick={handleTest}
                disabled={loading || !proxyHost.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-600">
              <h3 className="text-sm font-semibold text-slate-300 mb-2">About SOCKS5</h3>
              <p className="text-xs text-slate-400">
                SOCKS5 (RFC 1928) is a protocol-agnostic proxy that can tunnel any TCP connection.
                Improvements over SOCKS4: username/password auth, domain resolution by proxy, IPv6.
              </p>
              <h3 className="text-sm font-semibold text-slate-300 mb-2 mt-3">Test Setup</h3>
              <p className="text-xs text-slate-400 font-mono">
                ssh -D 1080 user@server
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Creates a local SOCKS5 proxy on port 1080
              </p>
            </div>
          </div>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-3">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Results</h2>
              {results.length > 0 && (
                <button
                  onClick={() => setResults([])}
                  className="text-sm text-slate-400 hover:text-white transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {results.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                Enter a SOCKS5 proxy address and click Test Connection
              </div>
            ) : (
              <div className="space-y-4">
                {results.map((result, idx) => (
                  <div
                    key={idx}
                    className={`rounded-lg border p-4 ${
                      result.success && result.granted
                        ? 'bg-green-900/20 border-green-600/50'
                        : result.success && !result.granted
                        ? 'bg-yellow-900/20 border-yellow-600/50'
                        : 'bg-red-900/20 border-red-600/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-lg ${
                            result.granted ? 'text-green-400' : 'text-red-400'
                          }`}
                        >
                          {result.granted ? 'GRANTED' : result.error ? 'ERROR' : 'REJECTED'}
                        </span>
                        {result.proxyHost && (
                          <span className="text-sm text-slate-400">
                            via {result.proxyHost}:{result.proxyPort}
                          </span>
                        )}
                      </div>
                      {result.totalTimeMs !== undefined && (
                        <span className="text-xs text-slate-400">{result.totalTimeMs}ms</span>
                      )}
                    </div>

                    {result.error ? (
                      <p className="text-red-400 text-sm">{result.error}</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        <div>
                          <span className="text-slate-400">Destination:</span>{' '}
                          <span className="text-white font-mono">
                            {result.destHost}:{result.destPort}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400">Auth Method:</span>{' '}
                          <span className="text-white">{result.authMethod}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Reply:</span>{' '}
                          <span
                            className={
                              result.replyCode === 0 ? 'text-green-400' : 'text-red-400'
                            }
                          >
                            {result.replyMessage} (0x{result.replyCode?.toString(16).padStart(2, '0')})
                          </span>
                        </div>
                        {result.authSuccess !== null && result.authSuccess !== undefined && (
                          <div>
                            <span className="text-slate-400">Auth:</span>{' '}
                            <span
                              className={result.authSuccess ? 'text-green-400' : 'text-red-400'}
                            >
                              {result.authSuccess ? 'Authenticated' : 'Failed'}
                            </span>
                          </div>
                        )}
                        {result.boundAddress && (
                          <div>
                            <span className="text-slate-400">Bound:</span>{' '}
                            <span className="text-white font-mono">
                              {result.boundAddress}:{result.boundPort}
                            </span>
                          </div>
                        )}
                        {result.connectTimeMs !== undefined && (
                          <div>
                            <span className="text-slate-400">Connect:</span>{' '}
                            <span className="text-white">{result.connectTimeMs}ms</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
