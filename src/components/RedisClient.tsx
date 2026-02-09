import { useState } from 'react';

interface RedisClientProps {
  onBack: () => void;
}

export default function RedisClient({ onBack }: RedisClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6379');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('0');
  const [command, setCommand] = useState('');
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
      const response = await fetch('/api/redis/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          password: password || undefined,
          database: database ? parseInt(database) : undefined,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        serverInfo?: string;
        version?: string;
      };

      if (response.ok && data.success) {
        setResult(`Connected to Redis server at ${host}:${port}\n\nVersion: ${data.version || 'Unknown'}\n${data.serverInfo || ''}`);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteCommand = async () => {
    if (!host) {
      setError('Host is required');
      return;
    }

    if (!command.trim()) {
      setError('Command is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      // Parse command into arguments
      const args = command.trim().split(/\s+/);

      const response = await fetch('/api/redis/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          password: password || undefined,
          database: database ? parseInt(database) : undefined,
          command: args,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        response?: string;
        command?: string[];
      };

      if (response.ok && data.success) {
        setResult(`Command: ${data.command?.join(' ')}\n\nResponse:\n${data.response || ''}`);
      } else {
        setError(data.error || 'Command failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Command failed');
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
          ← Back
        </button>
        <h1 className="text-3xl font-bold text-white">Redis Client</h1>
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
            <label htmlFor="redis-host" className="block text-sm font-medium text-slate-300 mb-1">
              Host <span className="text-red-400" aria-label="required">*</span>
            </label>
            <input
              id="redis-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDownConnect}
              placeholder="redis.example.com"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-required="true"
              aria-describedby="redis-host-help"
            />
          </div>

          <div>
            <label htmlFor="redis-port" className="block text-sm font-medium text-slate-300 mb-1">
              Port
            </label>
            <input
              id="redis-port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDownConnect}
              min="1"
              max="65535"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-describedby="redis-port-help"
            />
            <p id="redis-port-help" className="text-xs text-slate-400 mt-1">Default: 6379</p>
          </div>

          <div>
            <label htmlFor="redis-password" className="block text-sm font-medium text-slate-300 mb-1">
              Password <span className="text-xs text-slate-400">(optional)</span>
            </label>
            <input
              id="redis-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDownConnect}
              placeholder="password"
              autoComplete="off"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="redis-database" className="block text-sm font-medium text-slate-300 mb-1">
              Database <span className="text-xs text-slate-400">(0-15)</span>
            </label>
            <input
              id="redis-database"
              type="number"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              onKeyDown={handleKeyDownConnect}
              min="0"
              max="15"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={loading || !host}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-800"
          aria-label="Test Redis connection"
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

        {/* Step 2: Execute Command */}
        <div className="pt-6 border-t border-slate-600">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">2</span>
            </div>
            <h2 className="text-xl font-semibold text-white">Execute Command</h2>
          </div>

          <div className="mb-4">
            <label htmlFor="redis-command" className="block text-sm font-medium text-slate-300 mb-1">
              Redis Command
            </label>
            <input
              id="redis-command"
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="PING"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) {
                  handleExecuteCommand();
                }
              }}
              aria-describedby="redis-command-help"
            />
            <p id="redis-command-help" className="text-xs text-slate-400 mt-1">
              Examples: PING, SET mykey myvalue, GET mykey, DEL mykey, KEYS *
            </p>
          </div>

          <button
            onClick={handleExecuteCommand}
            disabled={loading || !host}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Execute Redis command"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                Executing...
              </span>
            ) : (
              'Execute Command'
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
          <h3 className="text-sm font-semibold text-slate-300 mb-2">About Redis</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            Redis is an in-memory data structure store used as a database, cache, and message broker.
            This interface uses RESP (Redis Serialization Protocol) to communicate with Redis servers.
            Port 6379 is the default. Common commands: PING, SET, GET, DEL, EXISTS, KEYS, INCR, EXPIRE.
          </p>
          <p className="text-xs text-slate-500 italic">
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit forms
          </p>
        </div>
      </div>
    </div>
  );
}
