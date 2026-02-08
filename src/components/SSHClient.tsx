import { useState, useRef, useEffect } from 'react';

interface SSHClientProps {
  onBack: () => void;
}

export default function SSHClient({ onBack }: SSHClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);
  const [command, setCommand] = useState('');
  const [terminal, setTerminal] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll terminal to bottom
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminal]);

  const addToTerminal = (text: string, type: 'input' | 'output' | 'error' | 'info' = 'output') => {
    const prefix = {
      input: '$ ',
      output: '',
      error: '❌ ',
      info: '💡 ',
    }[type];

    setTerminal(prev => [...prev, `${prefix}${text}`]);
  };

  const handleConnect = async () => {
    if (!host || !username || !password) {
      addToTerminal('Error: Host, username, and password are required', 'error');
      return;
    }

    setLoading(true);
    addToTerminal(`Connecting to ${username}@${host}:${port}...`, 'info');

    try {
      // Call Cloudflare Worker API
      const response = await fetch('/api/ssh/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          username,
          password,
        }),
      });

      const data = await response.json() as { hostname?: string; error?: string };

      if (response.ok) {
        setConnected(true);
        addToTerminal(`Connected to ${host}`, 'info');
        addToTerminal(`Welcome to ${data.hostname || host}!`, 'output');
        addToTerminal('Type commands below. Use Ctrl+C to cancel running commands.', 'info');
      } else {
        addToTerminal(`Connection failed: ${data.error}`, 'error');
      }
    } catch (error) {
      addToTerminal(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteCommand = async () => {
    if (!command.trim()) return;

    const cmd = command.trim();
    addToTerminal(cmd, 'input');
    setCommand('');
    setLoading(true);

    try {
      const response = await fetch('/api/ssh/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });

      const data = await response.json() as { stdout?: string; stderr?: string; error?: string };

      if (response.ok) {
        if (data.stdout) {
          data.stdout.split('\n').forEach((line: string) => {
            if (line.trim()) addToTerminal(line, 'output');
          });
        }
        if (data.stderr) {
          data.stderr.split('\n').forEach((line: string) => {
            if (line.trim()) addToTerminal(line, 'error');
          });
        }
        if (!data.stdout && !data.stderr) {
          addToTerminal('(command executed successfully)', 'info');
        }
      } else {
        addToTerminal(`Error: ${data.error}`, 'error');
      }
    } catch (error) {
      addToTerminal(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/ssh/disconnect', { method: 'POST' });
    } catch (error) {
      // Ignore errors on disconnect
    }
    setConnected(false);
    setTerminal([]);
    addToTerminal('Disconnected from server', 'info');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleExecuteCommand();
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-white hover:text-blue-400 transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-3xl font-bold text-white">SSH Client</h1>
        </div>
        {connected && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-green-400 text-sm">
              Connected to {host}
            </span>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        {/* Connection Panel */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Connection</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Host
                </label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="ssh.example.com"
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Port
                </label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="password"
                  disabled={connected}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>

              {!connected ? (
                <button
                  onClick={handleConnect}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Connecting...' : 'Connect'}
                </button>
              ) : (
                <button
                  onClick={handleDisconnect}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>

            {connected && (
              <div className="mt-6 pt-6 border-t border-slate-600">
                <h3 className="text-sm font-semibold text-slate-300 mb-2">
                  Quick Commands
                </h3>
                <div className="space-y-2">
                  {['pwd', 'ls -la', 'whoami', 'uname -a'].map((cmd) => (
                    <button
                      key={cmd}
                      onClick={() => {
                        setCommand(cmd);
                        setTimeout(() => {
                          handleExecuteCommand();
                        }, 100);
                      }}
                      className="w-full text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Terminal */}
        <div className="lg:col-span-3">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Terminal</h2>
              {connected && (
                <button
                  onClick={() => setTerminal([])}
                  className="text-sm text-slate-400 hover:text-white transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Terminal Output */}
            <div
              ref={terminalRef}
              className="bg-black rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm mb-4"
            >
              {terminal.length === 0 ? (
                <div className="text-green-400">
                  {connected
                    ? 'Ready. Type a command below.'
                    : 'Connect to start a session...'}
                </div>
              ) : (
                terminal.map((line, idx) => {
                  const isInput = line.startsWith('$ ');
                  const isError = line.startsWith('❌');
                  const isInfo = line.startsWith('💡');

                  return (
                    <div
                      key={idx}
                      className={`mb-1 ${
                        isInput
                          ? 'text-green-400 font-bold'
                          : isError
                          ? 'text-red-400'
                          : isInfo
                          ? 'text-blue-400'
                          : 'text-gray-300'
                      }`}
                    >
                      {line}
                    </div>
                  );
                })
              )}
            </div>

            {/* Command Input */}
            {connected && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Enter command..."
                  disabled={loading}
                  className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono disabled:opacity-50"
                />
                <button
                  onClick={handleExecuteCommand}
                  disabled={loading || !command.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Running...' : 'Execute'}
                </button>
              </div>
            )}

            {!connected && (
              <div className="text-center py-8 text-slate-500">
                Connect to an SSH server to execute commands
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
