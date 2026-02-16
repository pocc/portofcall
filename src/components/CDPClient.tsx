import { useState, useRef, useEffect } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface CDPClientProps {
  onBack: () => void;
}

interface CDPMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export default function CDPClient({ onBack }: CDPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('9222');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Query mode state
  const [endpoint, setEndpoint] = useState('/json/version');

  // WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [cdpMethod, setCdpMethod] = useState('Runtime.evaluate');
  const [cdpParams, setCdpParams] = useState('{"expression": "document.title"}');
  const [commandId, setCommandId] = useState(1);
  const [wsOutput, setWsOutput] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleHealthCheck = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/cdp/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        parsed?: {
          version?: {
            Browser?: string;
            'Protocol-Version'?: string;
            'User-Agent'?: string;
            'V8-Version'?: string;
            'WebKit-Version'?: string;
            webSocketDebuggerUrl?: string;
          };
          targets?: Array<{
            description?: string;
            devtoolsFrontendUrl?: string;
            id?: string;
            title?: string;
            type?: string;
            url?: string;
            webSocketDebuggerUrl?: string;
          }>;
          targetCount?: number;
        };
      };

      if (data.success && data.parsed) {
        const { version, targets, targetCount } = data.parsed;

        let output = `Chrome DevTools Protocol Discovery (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;

        if (version) {
          output += `Browser Information\n`;
          output += `${'-'.repeat(30)}\n`;
          output += `Browser: ${version.Browser || 'unknown'}\n`;
          output += `User-Agent: ${version['User-Agent'] || 'unknown'}\n`;
          output += `Protocol Version: ${version['Protocol-Version'] || 'unknown'}\n`;
          output += `V8 Version: ${version['V8-Version'] || 'unknown'}\n`;
          output += `WebKit Version: ${version['WebKit-Version'] || 'unknown'}\n`;
          if (version.webSocketDebuggerUrl) {
            output += `\nWebSocket URL:\n${version.webSocketDebuggerUrl}\n`;
          }
          output += `\n`;
        }

        if (targets && Array.isArray(targets) && targets.length > 0) {
          output += `Available Targets (${targetCount || targets.length})\n`;
          output += `${'-'.repeat(30)}\n`;
          targets.slice(0, 5).forEach((target) => {
            output += `\nType: ${target.type || 'unknown'}\n`;
            output += `Title: ${target.title || 'untitled'}\n`;
            output += `URL: ${target.url || 'N/A'}\n`;
            output += `ID: ${target.id || 'N/A'}\n`;
            if (target.webSocketDebuggerUrl) {
              output += `WS: ${target.webSocketDebuggerUrl}\n`;
            }
          });
          if (targets.length > 5) {
            output += `\n... and ${targets.length - 5} more targets\n`;
          }

          // Auto-fill first target ID if available
          if (targets[0]?.id && !targetId) {
            setTargetId(targets[0].id);
          }
        } else {
          output += `No targets available\n`;
        }

        setResult(output);
      } else {
        setError(data.error || 'Health check failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuery = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/cdp/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          endpoint,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        parsed?: unknown;
        body?: string;
      };

      if (data.success) {
        let output = `GET ${endpoint} -> ${data.statusCode} (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;

        if (data.parsed) {
          output += JSON.stringify(data.parsed, null, 2);
        } else {
          output += data.body || '(empty response)';
        }

        setResult(output);
      } else {
        let errMsg = data.error || 'Query failed';
        if (data.statusCode) errMsg += ` (HTTP ${data.statusCode})`;
        if (data.parsed) errMsg += `\n${JSON.stringify(data.parsed, null, 2)}`;
        setError(errMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectWebSocket = () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setWsOutput([]);
    setError('');

    try {
      const wsUrl = `ws://${window.location.host}/api/cdp/tunnel?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&targetId=${encodeURIComponent(targetId)}`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        addWsOutput('✅ WebSocket connection opened');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as CDPMessage;
          
          if (msg.result !== undefined) {
            addWsOutput(`← Response (id=${msg.id}):\n${JSON.stringify(msg.result, null, 2)}`);
          } else if (msg.error) {
            addWsOutput(`← Error (id=${msg.id}): ${msg.error.message} (code ${msg.error.code})`);
          } else if (msg.method) {
            addWsOutput(`← Event: ${msg.method}\n${JSON.stringify(msg.params, null, 2)}`);
          } else {
            addWsOutput(`← ${event.data}`);
          }
        } catch {
          addWsOutput(`← ${event.data}`);
        }
      };

      ws.onerror = () => {
        addWsOutput('❌ WebSocket error');
        setError('WebSocket connection error');
      };

      ws.onclose = () => {
        addWsOutput('🔌 WebSocket connection closed');
        setWsConnected(false);
        wsRef.current = null;
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WebSocket connection failed');
    }
  };

  const handleDisconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsConnected(false);
  };

  const handleSendCommand = () => {
    if (!wsRef.current || !wsConnected) {
      setError('Not connected to WebSocket');
      return;
    }

    try {
      let params = {};
      if (cdpParams.trim()) {
        params = JSON.parse(cdpParams);
      }

      const command = {
        id: commandId,
        method: cdpMethod,
        params,
      };

      wsRef.current.send(JSON.stringify(command));
      addWsOutput(`→ Sent (id=${commandId}): ${cdpMethod}\n${JSON.stringify(params, null, 2)}`);
      setCommandId(commandId + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send command');
    }
  };

  const handleQuickCommand = (method: string, params: string) => {
    setCdpMethod(method);
    setCdpParams(params);
  };

  const addWsOutput = (message: string) => {
    setWsOutput((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleHealthCheck();
    }
  };

  const handleQuickQuery = (qEndpoint: string) => {
    setEndpoint(qEndpoint);
  };

  return (
    <ProtocolClientLayout title="Chrome DevTools Protocol" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="cdp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="localhost"
            required
            helpText="Chrome instance hostname (launched with --remote-debugging-port)"
            error={errors.host}
          />

          <FormField
            id="cdp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 9222 (remote debugging port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleHealthCheck}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Check Chrome DevTools Protocol connection"
          variant="success"
        >
          Browser Discovery
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="CDP API Query" color="purple" />

        <div className="mb-4">
          <FormField
            id="cdp-endpoint"
            label="Endpoint"
            type="text"
            value={endpoint}
            onChange={setEndpoint}
            placeholder="/json/version"
            helpText="CDP HTTP endpoint path"
          />
        </div>

        <ActionButton
          onClick={handleQuery}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Execute CDP API query"
          variant="primary"
        >
          Execute Query
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Queries</h3>
          <div className="grid gap-2">
            {[
              { label: 'GET /json/version (browser version)', endpoint: '/json/version' },
              { label: 'GET /json/list (all targets)', endpoint: '/json/list' },
              { label: 'GET /json (short list)', endpoint: '/json' },
              { label: 'GET /json/protocol (full CDP spec)', endpoint: '/json/protocol' },
              { label: 'GET /json/new (open new tab)', endpoint: '/json/new' },
            ].map(({ label, endpoint: qEndpoint }) => (
              <button
                key={label}
                onClick={() => handleQuickQuery(qEndpoint)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-purple-400">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={3} title="WebSocket Tunnel (Commands)" color="blue" />

        <div className="mb-4">
          <FormField
            id="cdp-target-id"
            label="Target ID"
            type="text"
            value={targetId}
            onChange={setTargetId}
            placeholder="Leave empty for browser target"
            optional
            helpText="Target ID from /json/list (auto-filled from discovery)"
          />
        </div>

        <div className="flex gap-2 mb-4">
          {!wsConnected ? (
            <ActionButton
              onClick={handleConnectWebSocket}
              disabled={!host}
              ariaLabel="Connect WebSocket tunnel"
              variant="success"
            >
              Connect WebSocket
            </ActionButton>
          ) : (
            <ActionButton
              onClick={handleDisconnectWebSocket}
              ariaLabel="Disconnect WebSocket tunnel"
              variant="secondary"
            >
              Disconnect
            </ActionButton>
          )}
          <span className={`px-3 py-2 rounded ${wsConnected ? 'bg-green-900 text-green-200' : 'bg-slate-700 text-slate-400'}`}>
            {wsConnected ? '🟢 Connected' : '⚫ Disconnected'}
          </span>
        </div>

        {wsConnected && (
          <>
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <FormField
                id="cdp-method"
                label="CDP Method"
                type="text"
                value={cdpMethod}
                onChange={setCdpMethod}
                placeholder="Runtime.evaluate"
                helpText="CDP domain.method"
              />

              <div>
                <label htmlFor="cdp-params" className="block text-sm font-medium text-slate-300 mb-1">
                  Params <span className="text-xs text-slate-400">(JSON)</span>
                </label>
                <textarea
                  id="cdp-params"
                  value={cdpParams}
                  onChange={(e) => setCdpParams(e.target.value)}
                  placeholder='{"expression": "1+1"}'
                  rows={3}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono text-sm"
                />
              </div>
            </div>

            <ActionButton
              onClick={handleSendCommand}
              disabled={!wsConnected}
              ariaLabel="Send CDP command"
              variant="primary"
            >
              Send Command
            </ActionButton>

            <div className="mt-6 pt-6 border-t border-slate-600">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Commands</h3>
              <div className="grid gap-2">
                {[
                  { label: 'Runtime.evaluate (execute JS)', method: 'Runtime.evaluate', params: '{"expression": "document.title"}' },
                  { label: 'Page.navigate (go to URL)', method: 'Page.navigate', params: '{"url": "https://example.com"}' },
                  { label: 'Page.captureScreenshot', method: 'Page.captureScreenshot', params: '{"format": "png"}' },
                  { label: 'DOM.getDocument (get DOM)', method: 'DOM.getDocument', params: '{}' },
                  { label: 'Network.enable', method: 'Network.enable', params: '{}' },
                  { label: 'Page.printToPDF', method: 'Page.printToPDF', params: '{}' },
                ].map(({ label, method, params }) => (
                  <button
                    key={label}
                    onClick={() => handleQuickCommand(method, params)}
                    className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
                  >
                    <span className="font-mono text-cyan-400">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-600">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">WebSocket Output</h3>
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 max-h-96 overflow-y-auto">
                <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono">
                  {wsOutput.length > 0 ? wsOutput.join('\n\n') : 'Waiting for messages...'}
                </pre>
              </div>
            </div>
          </>
        )}

        <HelpSection
          title="About Chrome DevTools Protocol"
          description="CDP is the protocol used by Chrome/Chromium for remote debugging. Launch Chrome with --remote-debugging-port=9222 to enable it. CDP provides access to browser internals: DOM manipulation, JavaScript execution, network monitoring, performance profiling, screenshots, and more. Used by Puppeteer, Playwright, Selenium 4+, and other automation tools. Protocol uses HTTP JSON endpoints for discovery and WebSocket JSON-RPC 2.0 for commands."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
