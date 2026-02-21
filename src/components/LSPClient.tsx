import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface LSPClientProps {
  onBack: () => void;
}

interface LspCapabilities {
  [key: string]: unknown;
}

interface LspServerInfo {
  name?: string;
  version?: string;
}

interface LspResult {
  success: boolean;
  serverInfo?: LspServerInfo;
  capabilities?: LspCapabilities;
  capabilityList?: string[];
  protocolVersion?: string;
  error?: string;
  latencyMs?: number;
  cloudflare?: boolean;
}

// Common language server presets
const SERVER_PRESETS = [
  { label: 'clangd (C/C++)', port: '6008', rootUri: null },
  { label: 'Rust Analyzer', port: '2087', rootUri: null },
  { label: 'Eclipse JDT (Java)', port: '2088', rootUri: null },
  { label: 'Pylsp (Python)', port: '2087', rootUri: null },
  { label: 'gopls (Go)', port: '2087', rootUri: null },
  { label: 'TypeScript (tsserver)', port: '2087', rootUri: null },
];

export default function LSPClient({ onBack }: LSPClientProps) {
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('2087');
  const [rootUri, setRootUri] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LspResult | null>(null);
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch('/api/lsp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          rootUri: rootUri.trim() || undefined,
        }),
      });

      const data = await response.json() as LspResult;

      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || 'LSP connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LSP connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleConnect();
    }
  };

  const handlePreset = (preset: typeof SERVER_PRESETS[0]) => {
    setPort(preset.port);
  };

  return (
    <ProtocolClientLayout title="LSP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="lsp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="localhost"
            required
            helpText="Language server hostname or IP"
            error={errors.host}
          />

          <FormField
            id="lsp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="TCP port (common: 2087, 6008, 2088)"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <FormField
            id="lsp-root-uri"
            label="Root URI"
            type="text"
            value={rootUri}
            onChange={setRootUri}
            onKeyDown={handleKeyDown}
            placeholder="file:///workspace"
            optional
            helpText="Workspace root URI sent in initialize request"
          />
        </div>

        <div className="mb-6">
          <p className="text-xs text-slate-400 uppercase font-semibold mb-2">Quick Presets</p>
          <div className="flex flex-wrap gap-2">
            {SERVER_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => handlePreset(preset)}
                className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 py-1.5 px-3 rounded transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Connect to LSP server"
          variant="primary"
        >
          Initialize
        </ActionButton>

        {error && (
          <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-400 text-sm font-medium">Error</p>
            <p className="text-red-300 text-sm mt-1">{error}</p>
          </div>
        )}
      </div>

      {result && (
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
          <SectionHeader stepNumber={2} title="Server Response" color="green" />

          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span className="text-green-400 font-medium">Connected successfully</span>
            {result.latencyMs !== undefined && (
              <span className="text-slate-400 text-sm ml-auto">{result.latencyMs}ms</span>
            )}
          </div>

          {result.serverInfo && (
            <div className="bg-slate-700/50 rounded-lg p-4 mb-4">
              <p className="text-xs text-slate-400 uppercase font-semibold mb-2">Server Info</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {result.serverInfo.name && (
                  <>
                    <span className="text-slate-400">Name</span>
                    <span className="text-white font-mono">{result.serverInfo.name}</span>
                  </>
                )}
                {result.serverInfo.version && (
                  <>
                    <span className="text-slate-400">Version</span>
                    <span className="text-white font-mono">{result.serverInfo.version}</span>
                  </>
                )}
                {result.protocolVersion && (
                  <>
                    <span className="text-slate-400">LSP Version</span>
                    <span className="text-white font-mono">{result.protocolVersion}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {result.capabilityList && result.capabilityList.length > 0 && (
            <div className="bg-slate-700/50 rounded-lg p-4 mb-4">
              <p className="text-xs text-slate-400 uppercase font-semibold mb-3">
                Capabilities ({result.capabilityList.length})
              </p>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                {result.capabilityList.map((cap) => (
                  <div key={cap} className="flex items-center gap-2 text-sm">
                    <span className="text-green-400 text-xs">✓</span>
                    <span className="text-slate-300">{cap}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-slate-900 rounded-lg p-4">
            <p className="text-xs text-slate-400 uppercase font-semibold mb-2">Raw Capabilities</p>
            <pre className="text-xs text-slate-300 overflow-auto max-h-64 font-mono">
              {JSON.stringify(result.capabilities, null, 2)}
            </pre>
          </div>
        </div>
      )}

      <HelpSection
        title="About LSP"
        description="The Language Server Protocol (LSP) enables editors and IDEs to communicate with language servers for features like auto-complete, go-to-definition, find references, and diagnostics. LSP uses JSON-RPC 2.0 with Content-Length header framing over TCP (or stdio). This client sends an initialize request and displays the server's capabilities. Common servers: clangd (C/C++, port 6008), Rust Analyzer, Eclipse JDT (Java), pylsp (Python), gopls (Go). LSP 3.17 is the current specification."
        showKeyboardShortcut={true}
      />
    </ProtocolClientLayout>
  );
}
