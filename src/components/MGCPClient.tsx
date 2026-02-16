import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface MGCPClientProps {
  onBack: () => void;
}

const MGCP_COMMANDS = [
  { value: 'AUEP', label: 'AUEP - Audit Endpoint' },
  { value: 'AUCX', label: 'AUCX - Audit Connection' },
  { value: 'CRCX', label: 'CRCX - Create Connection' },
  { value: 'MDCX', label: 'MDCX - Modify Connection' },
  { value: 'DLCX', label: 'DLCX - Delete Connection' },
  { value: 'RQNT', label: 'RQNT - Request Notification' },
  { value: 'EPCF', label: 'EPCF - Endpoint Configuration' },
  { value: 'RSIP', label: 'RSIP - Restart In Progress' },
];

export default function MGCPClient({ onBack }: MGCPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2427');
  const [endpoint, setEndpoint] = useState('aaln/1');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Command mode
  const [command, setCommand] = useState('AUEP');
  const [paramText, setParamText] = useState('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleAudit = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/mgcp/audit', {
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
        command?: string;
        endpoint?: string;
        responseCode?: number;
        statusText?: string;
        transactionId?: string;
        comment?: string;
        params?: Record<string, string>;
        raw?: string;
        latencyMs?: number;
      };

      if (data.success) {
        let output = `MGCP Audit Endpoint (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;
        output += `Endpoint: ${data.endpoint}\n`;
        output += `Response: ${data.responseCode} ${data.statusText}\n`;
        output += `Transaction: ${data.transactionId}\n`;
        if (data.comment) output += `Comment: ${data.comment}\n`;

        if (data.params && Object.keys(data.params).length > 0) {
          output += `\nParameters\n${'-'.repeat(30)}\n`;
          for (const [key, value] of Object.entries(data.params)) {
            output += `  ${key}: ${value}\n`;
          }
        }

        if (data.raw) {
          output += `\nRaw Response\n${'-'.repeat(30)}\n${data.raw}\n`;
        }

        setResult(output);
      } else {
        setError(data.error || 'MGCP audit failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MGCP audit failed');
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
      // Parse params from text (format: "K: V" per line)
      let params: Record<string, string> | undefined;
      if (paramText.trim()) {
        params = {};
        for (const line of paramText.split('\n')) {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const key = line.substring(0, colonIdx).trim();
            const value = line.substring(colonIdx + 1).trim();
            params[key] = value;
          }
        }
      }

      const response = await fetch('/api/mgcp/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          endpoint,
          command,
          params,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        command?: string;
        endpoint?: string;
        responseCode?: number;
        statusText?: string;
        transactionId?: string;
        comment?: string;
        params?: Record<string, string>;
        raw?: string;
        sentCommand?: string;
        latencyMs?: number;
      };

      if (data.success) {
        let output = `MGCP ${data.command} Response (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;
        output += `Endpoint: ${data.endpoint}\n`;
        output += `Response: ${data.responseCode} ${data.statusText}\n`;
        output += `Transaction: ${data.transactionId}\n`;
        if (data.comment) output += `Comment: ${data.comment}\n`;

        if (data.params && Object.keys(data.params).length > 0) {
          output += `\nResponse Parameters\n${'-'.repeat(30)}\n`;
          for (const [key, value] of Object.entries(data.params)) {
            output += `  ${key}: ${value}\n`;
          }
        }

        if (data.sentCommand) {
          output += `\nSent Command\n${'-'.repeat(30)}\n${data.sentCommand}`;
        }

        if (data.raw) {
          output += `\nRaw Response\n${'-'.repeat(30)}\n${data.raw}\n`;
        }

        setResult(output);
      } else {
        setError(data.error || 'MGCP command failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MGCP command failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleAudit();
    }
  };

  const handleQuickCommand = (verb: string, params: string) => {
    setCommand(verb);
    setParamText(params);
  };

  return (
    <ProtocolClientLayout title="MGCP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <FormField
            id="mgcp-host"
            label="Media Gateway"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="mgw.example.com"
            required
            helpText="MGCP Media Gateway hostname or IP"
            error={errors.host}
          />

          <FormField
            id="mgcp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2427 (gateway)"
            error={errors.port}
          />

          <FormField
            id="mgcp-endpoint"
            label="Endpoint"
            type="text"
            value={endpoint}
            onChange={setEndpoint}
            onKeyDown={handleKeyDown}
            placeholder="aaln/1"
            helpText="e.g., aaln/1, ds/ds1-1/1"
          />
        </div>

        <ActionButton
          onClick={handleAudit}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Audit MGCP endpoint"
          variant="success"
        >
          Audit Endpoint (AUEP)
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="Command" color="purple" />

        <div className="mb-4">
          <label htmlFor="mgcp-command" className="block text-sm font-medium text-slate-300 mb-1">
            MGCP Verb
          </label>
          <select
            id="mgcp-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {MGCP_COMMANDS.map((cmd) => (
              <option key={cmd.value} value={cmd.value}>
                {cmd.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label htmlFor="mgcp-params" className="block text-sm font-medium text-slate-300 mb-1">
            Parameters <span className="text-xs text-slate-400">(optional, one per line: Key: Value)</span>
          </label>
          <textarea
            id="mgcp-params"
            value={paramText}
            onChange={(e) => setParamText(e.target.value)}
            placeholder={'L: p:20, a:PCMU\nM: sendrecv'}
            rows={3}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
          />
        </div>

        <ActionButton
          onClick={handleCommand}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Send MGCP command"
          variant="primary"
        >
          Send Command
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Quick Commands</h3>
          <div className="grid gap-2">
            {[
              { label: 'AUEP - Audit Endpoint', verb: 'AUEP', params: '' },
              { label: 'CRCX - Create Connection (sendrecv)', verb: 'CRCX', params: 'L: p:20, a:PCMU\nM: sendrecv' },
              { label: 'RQNT - Request Notification (off-hook)', verb: 'RQNT', params: 'R: L/hd, L/hu\nS: L/dl' },
              { label: 'RSIP - Restart In Progress', verb: 'RSIP', params: 'RM: graceful' },
            ].map(({ label, verb, params }) => (
              <button
                key={label}
                onClick={() => handleQuickCommand(verb, params)}
                className="text-left text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 px-3 rounded transition-colors"
              >
                <span className="font-mono text-purple-400">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <HelpSection
          title="About MGCP"
          description="MGCP (Media Gateway Control Protocol, RFC 3435) implements centralized VoIP call control where a Call Agent controls 'dumb' Media Gateways. AUEP (Audit Endpoint) queries a gateway's capabilities, CRCX creates media connections, and RQNT requests event notifications. Common in carrier-grade VoIP, PacketCable, and residential gateways. Port 2427 is the gateway port, 2727 is the Call Agent port."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
