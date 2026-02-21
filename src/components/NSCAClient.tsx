import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface NSCAClientProps {
  onBack: () => void;
}

export default function NSCAClient({ onBack }: NSCAClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5667');
  const [hostName, setHostName] = useState('');
  const [service, setService] = useState('');
  const [returnCode, setReturnCode] = useState('0');
  const [output, setOutput] = useState('');
  const [encryption, setEncryption] = useState('1');
  const [password, setPassword] = useState('');
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
      const response = await fetch('/api/nsca/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        ivHex?: string;
        timestamp?: number;
        timestampDate?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        let out = `NSCA server detected!\n\n`;
        out += `Host:       ${data.host}\n`;
        out += `Port:       ${data.port}\n`;
        out += `RTT:        ${data.rtt}ms\n\n`;
        out += `--- Initialization Packet (132 bytes) ---\n`;
        out += `IV (first 32B): ${data.ivHex}\n`;
        out += `Timestamp:      ${data.timestamp}\n`;
        out += `Date:           ${data.timestampDate}\n\n`;
        out += `The server sent its initialization vector and timestamp.\n`;
        out += `This confirms NSCA is listening and ready for passive check results.\n`;
        out += `Use "Send Check" to submit a passive service check.`;

        setResult(out);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!hostName) {
      setError('Nagios host name is required');
      return;
    }
    if (!output) {
      setError('Plugin output is required');
      return;
    }

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/nsca/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          hostName,
          service,
          returnCode: parseInt(returnCode, 10),
          output,
          encryption: parseInt(encryption, 10),
          password: password || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        hostName?: string;
        service?: string;
        returnCode?: number;
        encryption?: string;
        rtt?: number;
      };

      if (response.ok && data.success) {
        const codeNames: Record<number, string> = {
          0: 'OK', 1: 'WARNING', 2: 'CRITICAL', 3: 'UNKNOWN',
        };
        let out = `Passive check submitted!\n\n`;
        out += `Host:        ${data.host}:${data.port}\n`;
        out += `Nagios Host: ${data.hostName}\n`;
        out += `Service:     ${data.service || '(host check)'}\n`;
        out += `Return Code: ${data.returnCode} (${codeNames[data.returnCode ?? 0] || 'UNKNOWN'})\n`;
        out += `Encryption:  ${data.encryption}\n`;
        out += `RTT:         ${data.rtt}ms\n\n`;
        out += `The check result was sent to the NSCA server.\n`;
        out += `Verify in Nagios that the passive check was received.`;

        setResult(out);
      } else {
        setError(data.error || 'Send failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
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
    <ProtocolClientLayout title="Nagios NSCA Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="NSCA Server" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="nsca-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="nagios.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="nsca-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 5667 (NSCA)"
            error={errors.port}
          />
        </div>

        <SectionHeader stepNumber={2} title="Check Result" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="nsca-hostname"
            label="Nagios Host Name"
            type="text"
            value={hostName}
            onChange={setHostName}
            placeholder="webserver01"
            helpText="Host as defined in Nagios"
          />

          <FormField
            id="nsca-service"
            label="Service Description"
            type="text"
            value={service}
            onChange={setService}
            placeholder="HTTP"
            helpText="Leave empty for host check"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="nsca-returncode" className="block text-sm font-medium text-slate-300 mb-2">
              Return Code
            </label>
            <select
              id="nsca-returncode"
              value={returnCode}
              onChange={(e) => setReturnCode(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="0">0 - OK</option>
              <option value="1">1 - WARNING</option>
              <option value="2">2 - CRITICAL</option>
              <option value="3">3 - UNKNOWN</option>
            </select>
          </div>

          <div>
            <label htmlFor="nsca-encryption" className="block text-sm font-medium text-slate-300 mb-2">
              Encryption
            </label>
            <select
              id="nsca-encryption"
              value={encryption}
              onChange={(e) => setEncryption(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="0">0 - None</option>
              <option value="1">1 - Simple XOR</option>
            </select>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="nsca-output"
            label="Plugin Output"
            type="text"
            value={output}
            onChange={setOutput}
            placeholder="OK - Service is running"
            helpText="Check result message"
          />

          <FormField
            id="nsca-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="Shared encryption password"
            helpText="Must match nsca.cfg password"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <ActionButton
            onClick={handleProbe}
            disabled={loading || !host || !port}
            loading={loading}
            ariaLabel="Probe NSCA server"
            variant="secondary"
          >
            Probe (Detect)
          </ActionButton>

          <ActionButton
            onClick={handleSend}
            disabled={loading || !host || !port || !hostName || !output}
            loading={loading}
            ariaLabel="Send passive check to NSCA"
          >
            Send Check
          </ActionButton>
        </div>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Nagios NSCA"
          description="NSCA (Nagios Service Check Acceptor) receives passive check results from external sources. Unlike NRPE (port 5666) which executes checks on demand, NSCA accepts results pushed from clients. The server sends a 132-byte initialization packet (128-byte IV + 4-byte timestamp) which the client uses to encrypt the check result before sending."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Return Codes</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-400">
            <div><span className="text-green-400 font-mono">0</span> OK</div>
            <div><span className="text-yellow-400 font-mono">1</span> WARNING</div>
            <div><span className="text-red-400 font-mono">2</span> CRITICAL</div>
            <div><span className="text-slate-400 font-mono">3</span> UNKNOWN</div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Complements NRPE (port 5666). NSCA is for passive checks; NRPE is for active checks.
            The encryption password must match the server's nsca.cfg configuration.
          </p>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
