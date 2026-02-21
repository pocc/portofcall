/**
 * Node Inspector Protocol Client (Port 9229)
 * V8 Inspector Protocol for Node.js debugging
 */

import { useState } from 'react';

interface NodeInspectorClientProps {
  onBack: () => void;
}

interface Session {
  id: string;
  title: string;
  description: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

interface OutputMessage {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'sent' | 'received';
  message: string;
  data?: unknown;
}

export default function NodeInspectorClient({ onBack }: NodeInspectorClientProps) {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(9229);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [output, setOutput] = useState<OutputMessage[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [method, setMethod] = useState('Runtime.evaluate');
  const [params, setParams] = useState('{"expression": "1 + 1"}');

  const apiBase = import.meta.env.DEV ? 'http://localhost:8787' : '';

  const addOutput = (type: OutputMessage['type'], message: string, data?: unknown) => {
    setOutput((prev) => [
      ...prev,
      { timestamp: new Date().toLocaleTimeString(), type, message, data },
    ]);
  };

  const handleHealthCheck = async () => {
    setLoading(true);
    setSessions([]);
    setOutput([]);
    setSelectedSession(null);

    try {
      const response = await fetch(`${apiBase}/api/node-inspector/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port }),
      });

      const result = await response.json() as {
        success: boolean;
        error?: string;
        parsed?: {
          sessions?: Array<{ id: string; title: string; description: string; type: string; webSocketDebuggerUrl?: string }>;
          version?: { 'Node.js': string; 'V8-Version': string };
        };
      };

      if (result.success) {
        addOutput('success', 'Connected to Node Inspector', result);
        if (result.parsed?.sessions) {
          setSessions(result.parsed.sessions);
          addOutput('info', `Found ${result.parsed.sessions.length} debugging session(s)`);
        }
        if (result.parsed?.version) {
          addOutput('info', `Node.js ${result.parsed.version['Node.js']} / V8 ${result.parsed.version['V8-Version']}`);
        }
      } else {
        addOutput('error', result.error || 'Health check failed', result);
      }
    } catch (error) {
      addOutput('error', error instanceof Error ? error.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedSession?.webSocketDebuggerUrl) {
      addOutput('error', 'No WebSocket URL available for selected session');
      return;
    }

    setLoading(true);

    try {
      const wsUrl = selectedSession.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, '');
      const fullUrl = `${apiBase}/api/node-inspector/tunnel?host=${host}&port=${port}&path=${encodeURIComponent(wsUrl)}`;

      const ws = new WebSocket(fullUrl.replace(/^http/, 'ws'));

      ws.onopen = () => {
        setWsConnected(true);
        setConnected(true);
        addOutput('success', 'WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.method) {
            addOutput('received', `Event: ${data.method}`, data);
          } else if (data.result !== undefined) {
            addOutput('received', 'Response received', data);
          } else if (data.error) {
            addOutput('error', `Error: ${data.error.message}`, data);
          } else {
            addOutput('received', 'Message received', data);
          }
        } catch {
          addOutput('received', event.data);
        }
      };

      ws.onerror = () => {
        addOutput('error', 'WebSocket error');
        setWsConnected(false);
        setConnected(false);
      };

      ws.onclose = () => {
        addOutput('info', 'WebSocket disconnected');
        setWsConnected(false);
        setConnected(false);
      };

      (window as unknown as { inspectorWs?: WebSocket }).inspectorWs = ws;
    } catch (error) {
      addOutput('error', error instanceof Error ? error.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    const ws = (window as unknown as { inspectorWs?: WebSocket }).inspectorWs;
    if (ws) {
      ws.close();
      delete (window as unknown as { inspectorWs?: WebSocket }).inspectorWs;
    }
    setWsConnected(false);
    setConnected(false);
    addOutput('info', 'Disconnected');
  };

  const sendCommand = (cmdMethod: string, cmdParams: unknown) => {
    const ws = (window as unknown as { inspectorWs?: WebSocket }).inspectorWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addOutput('error', 'WebSocket not connected');
      return;
    }

    const message = {
      id: Date.now(),
      method: cmdMethod,
      params: cmdParams,
    };

    ws.send(JSON.stringify(message));
    addOutput('sent', `Command: ${cmdMethod}`, message);
  };

  const handleSendCommand = () => {
    try {
      const parsedParams = params ? JSON.parse(params) : {};
      sendCommand(method, parsedParams);
    } catch (error) {
      addOutput('error', `Invalid JSON params: ${error instanceof Error ? error.message : 'parse error'}`);
    }
  };

  const quickCommands = [
    { label: 'Evaluate 1+1', method: 'Runtime.evaluate', params: { expression: '1 + 1' } },
    { label: 'Get Heap Usage', method: 'Runtime.getHeapUsage', params: {} },
    { label: 'Enable Debugger', method: 'Debugger.enable', params: {} },
    { label: 'Pause Execution', method: 'Debugger.pause', params: {} },
    { label: 'Resume Execution', method: 'Debugger.resume', params: {} },
    { label: 'Enable Profiler', method: 'Profiler.enable', params: {} },
    { label: 'Start Profiling', method: 'Profiler.start', params: {} },
    { label: 'Stop Profiling', method: 'Profiler.stop', params: {} },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto">
        <button
          onClick={onBack}
          className="mb-4 px-4 py-2 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          ← Back
        </button>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            🐛 Node Inspector Client
          </h1>
          <p className="text-gray-600 mb-6">
            V8 Inspector Protocol for Node.js debugging (Port 9229)
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Host
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="localhost"
                disabled={connected}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min={1}
                max={65535}
                disabled={connected}
              />
            </div>

            <div className="flex items-end">
              <button
                onClick={handleHealthCheck}
                disabled={loading || connected}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
              >
                {loading ? 'Connecting...' : 'Discover Sessions'}
              </button>
            </div>
          </div>

          {sessions.length > 0 && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Debugging Session
              </label>
              <div className="space-y-2">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedSession?.id === session.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:border-blue-300'
                    }`}
                  >
                    <div className="font-medium">{session.title}</div>
                    <div className="text-sm text-gray-600">{session.description}</div>
                    <div className="text-xs text-gray-500 mt-1">Type: {session.type}</div>
                  </div>
                ))}
              </div>

              {selectedSession && !wsConnected && (
                <button
                  onClick={handleConnect}
                  disabled={loading}
                  className="mt-4 w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Connect to Session
                </button>
              )}

              {wsConnected && (
                <button
                  onClick={handleDisconnect}
                  className="mt-4 w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>
          )}
        </div>

        {wsConnected && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Send Command</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Method
                </label>
                <input
                  type="text"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Runtime.evaluate"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Params (JSON)
                </label>
                <input
                  type="text"
                  value={params}
                  onChange={(e) => setParams(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder='{"expression": "1 + 1"}'
                />
              </div>
            </div>

            <button
              onClick={handleSendCommand}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors mb-4"
            >
              Send Command
            </button>

            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Quick Commands</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {quickCommands.map((cmd) => (
                  <button
                    key={cmd.label}
                    onClick={() => sendCommand(cmd.method, cmd.params)}
                    className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    {cmd.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-800">Output</h2>
            <button
              onClick={() => setOutput([])}
              className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Clear
            </button>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm">
            {output.length === 0 ? (
              <div className="text-gray-500 text-center py-8">
                No output yet. Connect to a Node.js debugging session to begin.
              </div>
            ) : (
              <div className="space-y-2">
                {output.map((msg, idx) => (
                  <div key={idx} className="border-b border-gray-200 pb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-gray-500">[{msg.timestamp}]</span>
                      <span
                        className={`px-2 py-0.5 text-xs rounded ${
                          msg.type === 'success'
                            ? 'bg-green-100 text-green-800'
                            : msg.type === 'error'
                              ? 'bg-red-100 text-red-800'
                              : msg.type === 'sent'
                                ? 'bg-blue-100 text-blue-800'
                                : msg.type === 'received'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {msg.type.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-gray-800">{msg.message}</div>
                    {msg.data !== undefined && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-blue-600 hover:text-blue-800 text-xs">
                          Show details
                        </summary>
                        <pre className="mt-2 text-xs bg-white p-2 rounded overflow-x-auto">
                          {JSON.stringify(msg.data, null, 2)}
                        </pre>
                      </details>
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
