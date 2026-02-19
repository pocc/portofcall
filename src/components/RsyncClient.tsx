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

interface RsyncClientProps {
  onBack: () => void;
}

export default function RsyncClient({ onBack }: RsyncClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('873');
  const [moduleName, setModuleName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
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
    setResult('');

    try {
      const response = await fetch('/api/rsync/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        connectTime?: number;
        serverVersion?: string;
        clientVersion?: string;
        greeting?: string;
        motd?: string;
        modules?: Array<{ name: string; description: string }>;
        moduleCount?: number;
      };

      if (response.ok && data.success) {
        let resultText = `Connected to rsync daemon!\n\n`;
        resultText += `Host:            ${data.host}:${data.port}\n`;
        resultText += `RTT:             ${data.rtt}ms (connect: ${data.connectTime}ms)\n`;
        resultText += `Server Version:  ${data.serverVersion}\n`;
        resultText += `Client Version:  ${data.clientVersion}\n`;
        resultText += `Greeting:        ${data.greeting}\n`;

        if (data.motd) {
          resultText += `\n--- MOTD ---\n${data.motd}\n`;
        }

        resultText += `\n--- Available Modules (${data.moduleCount}) ---\n`;
        if (data.modules && data.modules.length > 0) {
          for (const mod of data.modules) {
            resultText += `  ${mod.name.padEnd(20)} ${mod.description}\n`;
          }
        } else {
          resultText += `  (no modules listed - server may require authentication)\n`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleModuleCheck = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!moduleName.trim()) {
      setError('Module name is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/rsync/module', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          module: moduleName.trim(),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        module?: string;
        rtt?: number;
        serverVersion?: string;
        moduleOk?: boolean;
        authRequired?: boolean;
        response?: string;
      };

      if (response.ok && data.success) {
        let resultText = `Module Check: "${data.module}"\n\n`;
        resultText += `Host:            ${data.host}:${data.port}\n`;
        resultText += `RTT:             ${data.rtt}ms\n`;
        resultText += `Server Version:  ${data.serverVersion}\n\n`;

        if (data.moduleOk) {
          resultText += `Status: Module accessible (no auth required)\n`;
        } else if (data.authRequired) {
          resultText += `Status: Module exists but requires authentication\n`;
        } else if (data.error) {
          resultText += `Status: Error - ${data.error}\n`;
        } else {
          resultText += `Status: Unknown response\n`;
        }

        if (data.response) {
          resultText += `\n--- Server Response ---\n${data.response}\n`;
        }

        setResult(resultText);
      } else {
        setError(data.error || 'Module check failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Module check failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="Rsync Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Rsync || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="rsync-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="rsync.example.com"
            required
            helpText="Rsync daemon hostname or IP address"
            error={errors.host}
          />

          <FormField
            id="rsync-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 873 (standard rsync daemon port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test rsync daemon connection and list modules"
        >
          Connect & List Modules
        </ActionButton>

        <ResultDisplay result={result} error={error} />
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="Module Check" color="green" />

        <div className="mb-4">
          <FormField
            id="rsync-module"
            label="Module Name"
            type="text"
            value={moduleName}
            onChange={setModuleName}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter' && !loading && host && port && moduleName) {
                handleModuleCheck();
              }
            }}
            placeholder="backup"
            helpText="Check if a specific module is accessible"
          />
        </div>

        <ActionButton
          onClick={handleModuleCheck}
          disabled={loading || !host || !port || !moduleName.trim()}
          loading={loading}
          variant="success"
          ariaLabel="Check rsync module accessibility"
        >
          Check Module "{moduleName || '...'}"
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <HelpSection
          title="About Rsync Protocol"
          description="Rsync is a fast, versatile file synchronization tool that uses a delta-transfer algorithm to minimize data transfer. In daemon mode (port 873), it exposes modules — named directory shares that clients can list and connect to. This client tests daemon connectivity and discovers available modules."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Connect</h3>
          <div className="grid gap-2">
            <button
              onClick={() => {
                setHost('localhost');
                setPort('873');
              }}
              className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
            >
              <span className="font-mono text-blue-400">localhost:873</span>
              <span className="ml-2 text-slate-400">- Local rsync daemon</span>
            </button>
            <p className="text-xs text-slate-400 mt-2">
              Start with Docker:
              <code className="bg-slate-700 px-2 py-1 rounded mx-1">docker run -d -p 873:873 axiom/rsync-server</code>
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Protocol Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Protocol:</td>
                  <td className="py-2 px-2">Rsync daemon (text-based handshake)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Default Port:</td>
                  <td className="py-2 px-2 font-mono">873</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Handshake:</td>
                  <td className="py-2 px-2">@RSYNCD: &lt;version&gt; exchange</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Module Listing:</td>
                  <td className="py-2 px-2">Send empty line after handshake</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-semibold text-slate-300">Transfer:</td>
                  <td className="py-2 px-2">Delta-transfer algorithm (rolling + MD4 checksums)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-semibold text-slate-300">Auth:</td>
                  <td className="py-2 px-2">MD4-based challenge-response (optional)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Common Rsync Options</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="text-left py-2 px-2 text-slate-300">Option</th>
                  <th className="text-left py-2 px-2 text-slate-300">Description</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">-a</td>
                  <td className="py-2 px-2">Archive mode (recursive, preserve all)</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">-v</td>
                  <td className="py-2 px-2">Verbose output</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">-z</td>
                  <td className="py-2 px-2">Compress during transfer</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">--delete</td>
                  <td className="py-2 px-2">Delete extraneous files from dest</td>
                </tr>
                <tr className="border-b border-slate-700">
                  <td className="py-2 px-2 font-mono text-blue-400">-e ssh</td>
                  <td className="py-2 px-2">Use SSH transport (more secure)</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 font-mono text-blue-400">-n</td>
                  <td className="py-2 px-2">Dry run (show what would be done)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-600">
          <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3">
            <p className="text-xs text-yellow-200">
              <strong>Note:</strong> This client tests the rsync <em>daemon</em> protocol (port 873),
              not rsync-over-SSH. Daemon mode requires an <code className="bg-slate-700 px-1 rounded">rsyncd.conf</code>
              configuration on the server. For secure transfers, rsync over SSH (port 22) is recommended.
            </p>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
