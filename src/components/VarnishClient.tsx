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

interface VarnishClientProps {
  onBack: () => void;
}

export default function VarnishClient({ onBack }: VarnishClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6082');
  const [secret, setSecret] = useState('');
  const [command, setCommand] = useState('status');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleProbe = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/varnish/probe', {
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
        authRequired?: boolean;
        banner?: string;
        challenge?: string;
        statusCode?: number;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let output = `Varnish CLI detected!\n\n`;
        output += `Host:     ${data.host}\n`;
        output += `Port:     ${data.port}\n`;
        output += `Status:   ${data.statusCode}\n`;
        output += `RTT:      ${data.rtt}ms\n`;
        output += `Auth:     ${data.authRequired ? 'Required' : 'Not required'}\n`;

        if (data.banner) {
          output += `\n--- Banner ---\n${data.banner}\n`;
        }

        if (data.authRequired) {
          output += `\nAuthentication is required. Provide the shared secret\n`;
          output += `(from /etc/varnish/secret) to execute commands.`;
        } else {
          output += `\nNo authentication required. You can execute commands directly.`;
        }

        setResult(output);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCommand = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/varnish/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          command,
          secret: secret || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        authRequired?: boolean;
        host?: string;
        port?: number;
        command?: string;
        statusCode?: number;
        body?: string;
        authenticated?: boolean;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let output = `Command: ${data.command}\n`;
        output += `Status:  ${data.statusCode} ${data.statusCode === 200 ? '(OK)' : ''}\n`;
        output += `Auth:    ${data.authenticated ? 'Yes' : 'No'}\n`;
        output += `RTT:     ${data.rtt}ms\n`;
        output += `\n--- Response ---\n${data.body || '(empty)'}`;

        setResult(output);
      } else {
        if (data.authRequired) {
          setError('Authentication required. Please provide the Varnish shared secret.');
        } else {
          setError(data.error || 'Command failed');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="Varnish CLI Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.Varnish || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="varnish-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="cache.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="varnish-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 6082 (Varnish CLI)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Authentication (Optional)" />

        <div className="mb-6">
          <FormField
            id="varnish-secret"
            label="Shared Secret"
            type="password"
            value={secret}
            onChange={setSecret}
            onKeyDown={handleKeyDown}
            placeholder="Contents of /etc/varnish/secret"
            helpText="Required if Varnish CLI has authentication enabled"
          />
        </div>

        <SectionHeader stepNumber={3} title="Command" />

        <div className="mb-6">
          <label htmlFor="varnish-command" className="block text-sm font-medium text-slate-300 mb-2">
            CLI Command
          </label>
          <select
            id="varnish-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="status">status - Child process state</option>
            <option value="ping">ping - Connectivity test (PONG)</option>
            <option value="banner">banner - Version banner</option>
            <option value="backend.list">backend.list - Backend pool health</option>
            <option value="vcl.list">vcl.list - Loaded VCL configs</option>
            <option value="param.show">param.show - Runtime parameters</option>
            <option value="storage.list">storage.list - Storage backends</option>
            <option value="panic.show">panic.show - Last panic info</option>
            <option value="help">help - Available commands</option>
          </select>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Probe Varnish CLI"
            variant="secondary"
          >
            Probe (Detect)
          </ActionButton>

          <ActionButton
            onClick={handleCommand}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Execute Varnish CLI command"
          >
            Execute Command
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Varnish CLI"
          description="The Varnish Cache administration CLI (VCLI) provides a text-based interface for monitoring and managing Varnish reverse proxy servers. It exposes server status, backend health, VCL configuration, and runtime parameters. Authentication uses a SHA-256 challenge-response with a shared secret file."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">VCLI Status Codes</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-slate-400">
            <div><span className="text-green-400 font-mono">200</span> OK</div>
            <div><span className="text-yellow-400 font-mono">107</span> Auth Required</div>
            <div><span className="text-yellow-400 font-mono">300</span> Truncated</div>
            <div><span className="text-red-400 font-mono">100</span> Syntax Error</div>
            <div><span className="text-red-400 font-mono">101</span> Unknown Request</div>
            <div><span className="text-red-400 font-mono">400</span> Comm Error</div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            The secret file is typically at /etc/varnish/secret. Only read-only commands are allowed for safety.
          </p>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
