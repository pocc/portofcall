import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';
import ApiExamples from './ApiExamples';
import apiExamples from '../data/api-examples';

interface JsonRpcClientProps {
  onBack: () => void;
}

export default function JsonRpcClient({ onBack }: JsonRpcClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8545');
  const [path, setPath] = useState('/');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  // RPC call state
  const [method, setMethod] = useState('');
  const [params, setParams] = useState('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleCall = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!method.trim()) {
      setError('Method is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      let parsedParams: unknown;
      if (params.trim()) {
        try {
          parsedParams = JSON.parse(params);
        } catch {
          setError('Invalid JSON params. Use array [] or object {} format.');
          setLoading(false);
          return;
        }
      }

      const response = await fetch('/api/jsonrpc/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          path,
          method: method.trim(),
          params: parsedParams,
          username: username || undefined,
          password: password || undefined,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        statusCode?: number;
        latencyMs?: number;
        jsonrpc?: {
          jsonrpc?: string;
          result?: unknown;
          error?: {
            code?: number;
            message?: string;
            data?: unknown;
          };
          id?: number | string | null;
        };
      };

      if (data.success && data.jsonrpc) {
        let output = `JSON-RPC Response (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;

        if (data.jsonrpc.error) {
          output += `Error Code: ${data.jsonrpc.error.code}\n`;
          output += `Message: ${data.jsonrpc.error.message}\n`;
          if (data.jsonrpc.error.data) {
            output += `\nError Data:\n${JSON.stringify(data.jsonrpc.error.data, null, 2)}\n`;
          }
        } else {
          output += `Method: ${method}\n`;
          output += `ID: ${data.jsonrpc.id}\n\n`;
          output += `Result:\n${JSON.stringify(data.jsonrpc.result, null, 2)}\n`;
        }

        setResult(output);
      } else {
        setError(data.error || 'JSON-RPC call failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JSON-RPC call failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && method) {
      handleCall();
    }
  };

  const handleQuickCall = (qMethod: string, qParams: string, qPort?: string) => {
    setMethod(qMethod);
    setParams(qParams);
    if (qPort) setPort(qPort);
  };

  return (
    <ProtocolClientLayout title="JSON-RPC Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.JsonRPC || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="jsonrpc-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="localhost"
            required
            helpText="JSON-RPC server hostname or IP"
            error={errors.host}
          />

          <FormField
            id="jsonrpc-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 8545 (Ethereum)"
            error={errors.port}
          />

          <FormField
            id="jsonrpc-path"
            label="Path"
            type="text"
            value={path}
            onChange={setPath}
            onKeyDown={handleKeyDown}
            placeholder="/"
            helpText="HTTP path (default: /)"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="jsonrpc-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="rpcuser"
            optional
            helpText="For Basic Auth (Bitcoin RPC, etc.)"
          />

          <FormField
            id="jsonrpc-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="rpcpassword"
            optional
            helpText="For Basic Auth"
          />
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="RPC Call" color="purple" />

        <div className="mb-4">
          <FormField
            id="jsonrpc-method"
            label="Method"
            type="text"
            value={method}
            onChange={setMethod}
            onKeyDown={handleKeyDown}
            placeholder="eth_blockNumber"
            required
            helpText="JSON-RPC method name"
          />
        </div>

        <div className="mb-4">
          <label htmlFor="jsonrpc-params" className="block text-sm font-medium text-slate-300 mb-1">
            Params <span className="text-xs text-slate-400">(optional, JSON array or object)</span>
          </label>
          <textarea
            id="jsonrpc-params"
            value={params}
            onChange={(e) => setParams(e.target.value)}
            placeholder='["0x1", true]'
            rows={3}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
          />
        </div>

        <ActionButton
          onClick={handleCall}
          disabled={loading || !host || !method}
          loading={loading}
          ariaLabel="Execute JSON-RPC call"
          variant="primary"
        >
          Call Method
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Calls</h3>

          <div className="mb-2">
            <span className="text-xs text-slate-400 uppercase font-semibold">Ethereum (port 8545)</span>
          </div>
          <div className="grid gap-2 mb-4">
            {[
              { label: 'eth_blockNumber', method: 'eth_blockNumber', params: '[]', port: '8545' },
              { label: 'eth_chainId', method: 'eth_chainId', params: '[]', port: '8545' },
              { label: 'net_version', method: 'net_version', params: '[]', port: '8545' },
              { label: 'web3_clientVersion', method: 'web3_clientVersion', params: '[]', port: '8545' },
              { label: 'eth_gasPrice', method: 'eth_gasPrice', params: '[]', port: '8545' },
              { label: 'net_peerCount', method: 'net_peerCount', params: '[]', port: '8545' },
            ].map(({ label, method: qMethod, params: qParams, port: qPort }) => (
              <button
                key={label}
                onClick={() => handleQuickCall(qMethod, qParams, qPort)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-purple-400">{label}</span>
              </button>
            ))}
          </div>

          <div className="mb-2">
            <span className="text-xs text-slate-400 uppercase font-semibold">Bitcoin (port 8332)</span>
          </div>
          <div className="grid gap-2">
            {[
              { label: 'getblockchaininfo', method: 'getblockchaininfo', params: '[]', port: '8332' },
              { label: 'getblockcount', method: 'getblockcount', params: '[]', port: '8332' },
              { label: 'getnetworkinfo', method: 'getnetworkinfo', params: '[]', port: '8332' },
              { label: 'getmininginfo', method: 'getmininginfo', params: '[]', port: '8332' },
            ].map(({ label, method: qMethod, params: qParams, port: qPort }) => (
              <button
                key={label}
                onClick={() => handleQuickCall(qMethod, qParams, qPort)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-purple-400">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <HelpSection
          title="About JSON-RPC"
          description="JSON-RPC 2.0 is a lightweight remote procedure call protocol using JSON encoding. It's the standard API for Ethereum nodes (port 8545), Bitcoin nodes (port 8332), and many other services. This client sends raw HTTP/1.1 POST requests over TCP sockets with JSON-RPC formatted bodies. Supports Basic Auth for secured endpoints (common with Bitcoin RPC). Batch requests send multiple method calls in a single HTTP request."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
