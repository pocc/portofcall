import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface RelpClientProps {
  onBack: () => void;
}

const FACILITY_OPTIONS = [
  { value: '0', label: 'kern (0)' },
  { value: '1', label: 'user (1)' },
  { value: '2', label: 'mail (2)' },
  { value: '3', label: 'daemon (3)' },
  { value: '4', label: 'auth (4)' },
  { value: '5', label: 'syslog (5)' },
  { value: '6', label: 'lpr (6)' },
  { value: '7', label: 'news (7)' },
  { value: '16', label: 'local0 (16)' },
  { value: '17', label: 'local1 (17)' },
  { value: '18', label: 'local2 (18)' },
  { value: '19', label: 'local3 (19)' },
  { value: '20', label: 'local4 (20)' },
  { value: '21', label: 'local5 (21)' },
  { value: '22', label: 'local6 (22)' },
  { value: '23', label: 'local7 (23)' },
];

const SEVERITY_OPTIONS = [
  { value: '0', label: 'emerg (0)' },
  { value: '1', label: 'alert (1)' },
  { value: '2', label: 'crit (2)' },
  { value: '3', label: 'err (3)' },
  { value: '4', label: 'warning (4)' },
  { value: '5', label: 'notice (5)' },
  { value: '6', label: 'info (6)' },
  { value: '7', label: 'debug (7)' },
];

export default function RelpClient({ onBack }: RelpClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('20514');
  const [message, setMessage] = useState('Test message from Port of Call RELP client');
  const [facility, setFacility] = useState('1');
  const [severity, setSeverity] = useState('6');
  const [hostname, setHostname] = useState('portofcall');
  const [appName, setAppName] = useState('test');
  const [connectLoading, setConnectLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleConnect = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setConnectLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/relp/connect', {
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
        statusCode?: number;
        statusMessage?: string;
        serverVersion?: string;
        serverSoftware?: string;
        supportedCommands?: string;
        rawResponse?: string;
      };

      if (response.ok && data.success) {
        setResult(
          `RELP Server Connected\n\n` +
          `Host:               ${data.host}:${data.port}\n` +
          `RTT:                ${data.rtt}ms\n` +
          `Status:             ${data.statusCode} ${data.statusMessage || ''}\n` +
          `Server Version:     RELP v${data.serverVersion}\n` +
          `Server Software:    ${data.serverSoftware}\n` +
          `Supported Commands: ${data.supportedCommands}\n\n` +
          `Raw Response:\n${data.rawResponse}`
        );
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnectLoading(false);
    }
  };

  const handleSend = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    if (!message) {
      setError('Message is required');
      return;
    }

    setSendLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/relp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          message,
          facility: parseInt(facility),
          severity: parseInt(severity),
          hostname,
          appName,
          timeout: 10000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        acknowledged?: boolean;
        statusCode?: number;
        statusMessage?: string;
        sentMessage?: string;
        facilityName?: string;
        severityName?: string;
      };

      if (response.ok && data.success) {
        const ackIcon = data.acknowledged ? 'ACK' : 'NACK';
        setResult(
          `RELP Message ${ackIcon}\n\n` +
          `Status:    ${data.statusCode} ${data.statusMessage || ''}\n` +
          `Acked:     ${data.acknowledged ? 'Yes (guaranteed delivery)' : 'No (may be lost)'}\n` +
          `Facility:  ${data.facilityName} (${facility})\n` +
          `Severity:  ${data.severityName} (${severity})\n\n` +
          `Sent Syslog Message:\n${data.sentMessage}`
        );
      } else {
        setError(data.error || 'Send failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSendLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !connectLoading && !sendLoading && host && port) {
      handleConnect();
    }
  };

  return (
    <ProtocolClientLayout title="RELP Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="relp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="rsyslog.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="relp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 20514 (standard RELP port)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={connectLoading || sendLoading || !host || !port}
          loading={connectLoading}
          ariaLabel="Test RELP connection"
        >
          Test Connection
        </ActionButton>

        <SectionHeader stepNumber={2} title="Send Syslog Message" color="green" />

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <FormField
            id="relp-hostname"
            label="Hostname"
            type="text"
            value={hostname}
            onChange={setHostname}
            placeholder="portofcall"
            helpText="Hostname field in syslog header"
          />

          <FormField
            id="relp-appname"
            label="App Name"
            type="text"
            value={appName}
            onChange={setAppName}
            placeholder="test"
            helpText="Application name in syslog header"
          />

          <div>
            <label htmlFor="relp-facility" className="block text-sm font-medium text-slate-300 mb-2">
              Facility
            </label>
            <select
              id="relp-facility"
              value={facility}
              onChange={(e) => setFacility(e.target.value)}
              className="w-full bg-slate-700 border border-slate-500 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {FACILITY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="relp-severity" className="block text-sm font-medium text-slate-300 mb-2">
              Severity
            </label>
            <select
              id="relp-severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-full bg-slate-700 border border-slate-500 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {SEVERITY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <FormField
              id="relp-message"
              label="Log Message"
              type="text"
              value={message}
              onChange={setMessage}
              placeholder="Enter your syslog message..."
              helpText="The message to send via RELP with guaranteed delivery"
            />
          </div>
        </div>

        <ActionButton
          onClick={handleSend}
          disabled={connectLoading || sendLoading || !host || !port || !message}
          loading={sendLoading}
          variant="success"
          ariaLabel="Send syslog message via RELP"
        >
          Send Message
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About RELP"
          description="RELP (Reliable Event Logging Protocol) provides guaranteed syslog delivery over TCP. Unlike plain syslog, RELP uses application-level acknowledgments ensuring no log messages are lost during transmission. It's the standard for reliable log forwarding between rsyslog instances, commonly used in compliance and audit logging pipelines. Default port is 20514."
          showKeyboardShortcut={true}
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">RELP vs Plain Syslog</h3>
          <div className="grid gap-2 text-sm">
            <div className="bg-slate-700 rounded-lg p-3">
              <span className="text-green-400 font-mono">RELP</span>
              <span className="text-slate-400 ml-2">- Application-level ACKs, guaranteed delivery, session management</span>
            </div>
            <div className="bg-slate-700 rounded-lg p-3">
              <span className="text-yellow-400 font-mono">TCP Syslog</span>
              <span className="text-slate-400 ml-2">- TCP reliability only, messages can be lost on receiver crash</span>
            </div>
            <div className="bg-slate-700 rounded-lg p-3">
              <span className="text-red-400 font-mono">UDP Syslog</span>
              <span className="text-slate-400 ml-2">- Fire-and-forget, messages can be lost anywhere</span>
            </div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
