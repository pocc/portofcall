import { useState, useRef, useEffect } from 'react';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface TelnetClientProps {
  onBack: () => void;
}

export default function TelnetClient({ onBack }: TelnetClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('23');
  const [connected, setConnected] = useState(false);
  const [terminal, setTerminal] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll terminal to bottom
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminal]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const addToTerminal = (text: string, type: 'input' | 'output' | 'error' | 'info' = 'output') => {
    const prefix = {
      input: '> ',
      output: '',
      error: '❌ ',
      info: '💡 ',
    }[type];

    setTerminal(prev => {
      const next = [...prev, `${prefix}${text}`];
      return next.length > 500 ? next.slice(-500) : next;
    });
  };

  const handleConnect = async () => {
    if (!host) {
      addToTerminal('Error: Host is required', 'error');
      return;
    }

    setLoading(true);
    addToTerminal(`Connecting to ${host}:${port}...`, 'info');

    try {
      // First, test HTTP connection
      const testResponse = await fetch('/api/telnet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
        }),
      });

      const testData = await testResponse.json() as { error?: string; banner?: string };

      if (!testResponse.ok) {
        addToTerminal(`Connection test failed: ${testData.error || 'Unknown error'}`, 'error');
        setLoading(false);
        return;
      }

      // Show banner if available
      if (testData.banner) {
        addToTerminal(testData.banner, 'output');
      }

      // Now create WebSocket connection for interactive session
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/telnet/connect?host=${encodeURIComponent(host)}&port=${port}`;

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        setConnected(true);
        wsRef.current = websocket;
        addToTerminal('WebSocket connected. Interactive session ready.', 'info');
      };

      websocket.onmessage = (event) => {
        try {
          // Try to parse as JSON first (for control messages)
          const data = JSON.parse(event.data);
          if (data.type === 'telnet-connected') {
            addToTerminal(data.message, 'info');
          }
        } catch {
          // Raw data from Telnet server
          const text = event.data;
          if (text) {
            // Split by lines and add each
            text.split('\n').forEach((line: string) => {
              if (line) addToTerminal(line, 'output');
            });
          }
        }
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        addToTerminal('WebSocket error occurred', 'error');
      };

      websocket.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        addToTerminal('Connection closed', 'info');
      };

    } catch (error) {
      addToTerminal(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSendCommand = () => {
    if (!wsRef.current || !command.trim()) return;

    const cmd = command.trim();
    addToTerminal(cmd, 'input');

    // Send command with newline
    wsRef.current.send(cmd + '\r\n');
    setCommand('');
  };

  const handleDisconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setConnected(false);
    wsRef.current = null;
    addToTerminal('Disconnected from server', 'info');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendCommand();
    }
  };

  return (
    <div className="max-w-6xl mx-auto">      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-white hover:text-blue-400 transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-3xl font-bold text-white">Telnet Client</h1>
        </div>

        {connected && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-green-400 text-sm">
              Connected to {host}:{port}
            </span>
          </div>
        )}
      </div>

      <ApiExamples examples={apiExamples.Telnet || []} />
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
                  placeholder="telnet.example.com"
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

            {/* Info */}
            <div className="mt-6 pt-6 border-t border-slate-600">
              <h3 className="text-sm font-semibold text-slate-300 mb-2">
                About Telnet
              </h3>
              <p className="text-xs text-slate-400">
                Telnet is an unencrypted text-based protocol. Use SSH for secure connections.
                Common ports: 23 (default), 992 (TelnetS).
              </p>
            </div>

            {connected && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-slate-300 mb-2">
                  Quick Commands
                </h3>
                <div className="space-y-2">
                  {['help', 'ls', 'pwd', 'exit'].map((cmd) => (
                    <button
                      key={cmd}
                      onClick={() => {
                        setCommand(cmd);
                        setTimeout(() => {
                          handleSendCommand();
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
                    ? 'Ready. Type commands below.'
                    : 'Connect to a Telnet server to start...'}
                </div>
              ) : (
                terminal.map((line, idx) => {
                  const isInput = line.startsWith('> ');
                  const isError = line.startsWith('❌');
                  const isInfo = line.startsWith('💡');

                  return (
                    <div
                      key={idx}
                      className={`mb-1 whitespace-pre-wrap ${
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
                  disabled={!connected}
                  className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono disabled:opacity-50"
                />
                <button
                  onClick={handleSendCommand}
                  disabled={!connected || !command.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </div>
            )}

            {!connected && (
              <div className="text-center py-8 text-slate-500">
                Connect to a Telnet server to start an interactive session
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
