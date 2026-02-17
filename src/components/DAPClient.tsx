import { useState, useRef, useEffect } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface DAPClientProps {
  onBack: () => void;
}

interface DAPMessage {
  seq?: number;
  type?: string;
  command?: string;
  event?: string;
  success?: boolean;
  body?: unknown;
  arguments?: unknown;
  message?: string;
}

export default function DAPClient({ onBack }: DAPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5678');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  // WebSocket session state
  const [wsConnected, setWsConnected] = useState(false);
  const [wsOutput, setWsOutput] = useState<string[]>([]);
  const [dapCommand, setDapCommand] = useState('initialize');
  const [dapArgs, setDapArgs] = useState(
    '{"clientID":"portofcall","clientName":"Port of Call","adapterID":"generic","linesStartAt1":true,"columnsStartAt1":true}',
  );
  const [seqCounter, setSeqCounter] = useState(1);

  const wsRef = useRef<WebSocket | null>(null);
  const outputEndRef = useRef<HTMLDivElement | null>(null);

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [wsOutput]);

  const addWsOutput = (message: string) => {
    setWsOutput((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const handleHealthCheck = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/dap/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: parseInt(port) }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        latencyMs?: number;
        isCloudflare?: boolean;
        parsed?: {
          capabilities?: Record<string, unknown>;
          events?: string[];
          messageCount?: number;
          allMessages?: DAPMessage[];
        };
      };

      if (data.success && data.parsed) {
        const { capabilities, events, messageCount, allMessages } = data.parsed;

        let output = `DAP Adapter Connected (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;
        output += `Messages received: ${messageCount}\n`;

        if (events && events.length > 0) {
          output += `Events: ${events.join(', ')}\n`;
        }
        output += `\n`;

        if (capabilities && Object.keys(capabilities).length > 0) {
          output += `Adapter Capabilities\n`;
          output += `${'-'.repeat(30)}\n`;
          const caps = capabilities as Record<string, unknown>;
          for (const [key, val] of Object.entries(caps)) {
            if (val === true) {
              output += `  ✓ ${key}\n`;
            } else if (val !== false && val !== undefined && val !== null) {
              output += `  ${key}: ${JSON.stringify(val)}\n`;
            }
          }
          output += `\n`;
        } else {
          output += `No capabilities reported\n\n`;
        }

        if (allMessages && allMessages.length > 0) {
          output += `Raw Messages\n`;
          output += `${'-'.repeat(30)}\n`;
          for (const msg of allMessages) {
            output += `[${msg.type}] ${msg.command || msg.event || ''}\n`;
            if (msg.body) {
              output += `  ${JSON.stringify(msg.body, null, 2).replace(/\n/g, '\n  ')}\n`;
            }
          }
        }

        setResult(output);
      } else {
        setError(data.error || 'No response from DAP adapter');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setWsOutput([]);
    setError('');

    const wsUrl = `ws://${window.location.host}/api/dap/tunnel?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      addWsOutput('WebSocket connection opened');
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as DAPMessage & { error?: string };
        if (msg.type === 'connected') {
          addWsOutput(`Connected: ${(msg as { message?: string }).message || 'DAP tunnel established'}`);
        } else if (msg.type === 'error') {
          addWsOutput(`Error: ${msg.error || 'Unknown error'}`);
        } else if (msg.type === 'response') {
          const status = msg.success ? 'OK' : 'FAILED';
          addWsOutput(
            `<- Response [${msg.command}] ${status}${msg.message ? `: ${msg.message}` : ''}\n${msg.body ? JSON.stringify(msg.body, null, 2) : ''}`,
          );
        } else if (msg.type === 'event') {
          addWsOutput(
            `<- Event [${msg.event}]${msg.body ? `\n${JSON.stringify(msg.body, null, 2)}` : ''}`,
          );
        } else {
          addWsOutput(`<- ${event.data}`);
        }
      } catch {
        addWsOutput(`<- ${event.data}`);
      }
    };

    ws.onerror = () => {
      addWsOutput('WebSocket error');
      setError('WebSocket connection error');
    };

    ws.onclose = () => {
      addWsOutput('WebSocket connection closed');
      setWsConnected(false);
      wsRef.current = null;
    };
  };

  const handleDisconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setWsConnected(false);
  };

  const handleSendRequest = () => {
    if (!wsRef.current || !wsConnected) {
      setError('Not connected');
      return;
    }

    try {
      let args = {};
      if (dapArgs.trim()) {
        args = JSON.parse(dapArgs);
      }

      const message = {
        seq: seqCounter,
        type: 'request',
        command: dapCommand,
        arguments: args,
      };

      wsRef.current.send(JSON.stringify(message));
      addWsOutput(`-> Request [${dapCommand}] seq=${seqCounter}\n${JSON.stringify(args, null, 2)}`);
      setSeqCounter((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send request');
    }
  };

  const setQuickCommand = (command: string, args: string) => {
    setDapCommand(command);
    setDapArgs(args);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleHealthCheck();
    }
  };

  const quickCommands = [
    {
      label: 'initialize',
      command: 'initialize',
      args: '{"clientID":"portofcall","clientName":"Port of Call","adapterID":"generic","linesStartAt1":true,"columnsStartAt1":true}',
    },
    {
      label: 'configurationDone',
      command: 'configurationDone',
      args: '{}',
    },
    {
      label: 'threads',
      command: 'threads',
      args: '{}',
    },
    {
      label: 'stackTrace',
      command: 'stackTrace',
      args: '{"threadId":1}',
    },
    {
      label: 'scopes',
      command: 'scopes',
      args: '{"frameId":0}',
    },
    {
      label: 'variables',
      command: 'variables',
      args: '{"variablesReference":1}',
    },
    {
      label: 'evaluate',
      command: 'evaluate',
      args: '{"expression":"1+1","context":"repl"}',
    },
    {
      label: 'disconnect',
      command: 'disconnect',
      args: '{"restart":false}',
    },
  ];

  return (
    <ProtocolClientLayout title="Debug Adapter Protocol (DAP)" onBack={onBack}>
      {/* Step 1: Connection + Health Check */}
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="dap-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="localhost"
            required
            helpText="Debug adapter hostname (e.g. debugpy, netcoredbg, dlv)"
            error={errors.host}
          />

          <FormField
            id="dap-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="debugpy: 5678 | netcoredbg: 4711 | dlv: 38697"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleHealthCheck}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Check DAP adapter connection"
          variant="success"
        >
          Probe Adapter
        </ActionButton>
      </div>

      <ResultDisplay result={result} error={error} />

      {/* Step 2: Live Session */}
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="Live DAP Session" color="purple" />

        <div className="flex gap-3 mb-6">
          {!wsConnected ? (
            <ActionButton
              onClick={handleConnect}
              disabled={!host}
              ariaLabel="Open DAP WebSocket tunnel"
              variant="primary"
            >
              Connect
            </ActionButton>
          ) : (
            <ActionButton
              onClick={handleDisconnect}
              ariaLabel="Close DAP WebSocket tunnel"
              variant="secondary"
            >
              Disconnect
            </ActionButton>
          )}
        </div>

        {/* Request builder */}
        <div className="mb-4">
          <FormField
            id="dap-command"
            label="Command"
            type="text"
            value={dapCommand}
            onChange={setDapCommand}
            placeholder="initialize"
            helpText="DAP request command name"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Arguments (JSON)
          </label>
          <textarea
            value={dapArgs}
            onChange={(e) => setDapArgs(e.target.value)}
            rows={3}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 font-mono text-sm focus:outline-none focus:border-blue-500"
            placeholder="{}"
          />
        </div>

        {/* Quick commands */}
        <div className="mb-4">
          <p className="text-xs text-slate-400 mb-2">Quick commands:</p>
          <div className="flex flex-wrap gap-2">
            {quickCommands.map((qc) => (
              <button
                key={qc.command}
                onClick={() => setQuickCommand(qc.command, qc.args)}
                className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded border border-slate-600 transition-colors"
              >
                {qc.label}
              </button>
            ))}
          </div>
        </div>

        <ActionButton
          onClick={handleSendRequest}
          disabled={!wsConnected}
          ariaLabel="Send DAP request"
          variant="primary"
        >
          Send Request
        </ActionButton>

        {/* Output log */}
        {wsOutput.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">Session output:</p>
              <button
                onClick={() => setWsOutput([])}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 h-64 overflow-y-auto font-mono text-xs text-slate-300">
              {wsOutput.map((line, i) => {
                const isError = line.includes('Error') || line.includes('FAILED');
                const isEvent = line.includes('<- Event');
                const isResponse = line.includes('<- Response');
                const isSent = line.includes('->');
                let colorClass = 'text-slate-300';
                if (isError) colorClass = 'text-red-400';
                else if (isEvent) colorClass = 'text-yellow-400';
                else if (isResponse) colorClass = 'text-green-400';
                else if (isSent) colorClass = 'text-blue-400';
                return (
                  <div key={i} className={`mb-1 whitespace-pre-wrap ${colorClass}`}>
                    {line}
                  </div>
                );
              })}
              <div ref={outputEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Help */}
      <HelpSection
        title="About Debug Adapter Protocol"
        description="DAP is an open standard used by IDEs to communicate with language-specific debug adapters. Common adapters: debugpy (Python, port 5678), netcoredbg (.NET Core, port 4711), delve/dlv (Go, port 38697). Message types: request (client → adapter), response (adapter → client), event (adapter → client notification)."
        showKeyboardShortcut={false}
      />
    </ProtocolClientLayout>
  );
}
