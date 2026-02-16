import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface SCCPClientProps {
  onBack: () => void;
}

const DEVICE_TYPES = [
  { value: '7', label: 'Cisco 7910' },
  { value: '8', label: 'Cisco 7960' },
  { value: '9', label: 'Cisco 7940' },
  { value: '12', label: 'Cisco 7935' },
  { value: '20', label: 'Cisco 7920' },
  { value: '30007', label: 'Cisco 7961' },
  { value: '30008', label: 'Cisco 7941' },
];

export default function SCCPClient({ onBack }: SCCPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('2000');
  const [deviceName, setDeviceName] = useState('SEP001122334455');
  const [deviceType, setDeviceType] = useState('8');
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
      const response = await fetch('/api/sccp/probe', {
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
        probe?: string;
        connected?: boolean;
        keepAliveAck?: boolean;
        connectMs?: number;
        latencyMs?: number;
        responseBytes?: number;
        messages?: Array<{ id: string; name: string; dataLength: number }>;
      };

      if (data.success) {
        let output = `SCCP KeepAlive Probe (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;
        output += `Connected: ${data.connected ? 'Yes' : 'No'}\n`;
        output += `Connect Time: ${data.connectMs}ms\n`;
        output += `KeepAlive ACK: ${data.keepAliveAck ? 'Yes (SCCP server confirmed)' : 'No ACK received'}\n`;
        output += `Response Bytes: ${data.responseBytes}\n`;

        if (data.messages && data.messages.length > 0) {
          output += `\nServer Messages\n`;
          output += `${'-'.repeat(30)}\n`;
          for (const msg of data.messages) {
            output += `  ${msg.id} ${msg.name} (${msg.dataLength} bytes)\n`;
          }
        }

        setResult(output);
      } else {
        setError(data.error || 'SCCP probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SCCP probe failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/sccp/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          deviceName,
          deviceType: parseInt(deviceType),
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        registration?: {
          status?: string;
          deviceName?: string;
          deviceType?: number;
          deviceTypeName?: string;
          registered?: boolean;
          rejected?: boolean;
          capabilitiesRequested?: boolean;
        };
        connectMs?: number;
        latencyMs?: number;
        responseBytes?: number;
        messages?: Array<{ id: string; name: string; dataLength: number }>;
      };

      if (data.success && data.registration) {
        const reg = data.registration;
        let output = `SCCP Registration Attempt (${data.latencyMs}ms)\n`;
        output += `${'='.repeat(50)}\n\n`;

        output += `Status: ${reg.status?.toUpperCase()}\n`;
        output += `Device: ${reg.deviceName} (${reg.deviceTypeName})\n`;
        output += `Connect Time: ${data.connectMs}ms\n\n`;

        if (reg.registered) {
          output += `Registration: ACCEPTED\n`;
          if (reg.capabilitiesRequested) {
            output += `Capabilities Request: Server requested capabilities\n`;
          }
        } else if (reg.rejected) {
          output += `Registration: REJECTED by server\n`;
        } else {
          output += `Registration: No definitive response\n`;
        }

        if (data.messages && data.messages.length > 0) {
          output += `\nServer Messages\n`;
          output += `${'-'.repeat(30)}\n`;
          for (const msg of data.messages) {
            output += `  ${msg.id} ${msg.name} (${msg.dataLength} bytes)\n`;
          }
        }

        output += `\nResponse Bytes: ${data.responseBytes}\n`;

        setResult(output);
      } else {
        setError(data.error || 'SCCP registration failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SCCP registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host) {
      handleProbe();
    }
  };

  return (
    <ProtocolClientLayout title="SCCP (Skinny) Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="sccp-host"
            label="CUCM Server"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="cucm.example.com"
            required
            helpText="Cisco Unified Communications Manager hostname or IP"
            error={errors.host}
          />

          <FormField
            id="sccp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 2000 (SCCP), 2443 (Secure SCCP)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Send SCCP KeepAlive probe"
          variant="success"
        >
          KeepAlive Probe
        </ActionButton>
      </div>

      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 mt-6">
        <SectionHeader stepNumber={2} title="Device Registration" color="purple" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="sccp-device-name"
            label="Device Name"
            type="text"
            value={deviceName}
            onChange={setDeviceName}
            onKeyDown={handleKeyDown}
            placeholder="SEP001122334455"
            helpText="Format: SEP + MAC address (12 hex digits)"
          />

          <div>
            <label htmlFor="sccp-device-type" className="block text-sm font-medium text-slate-300 mb-1">
              Device Type
            </label>
            <select
              id="sccp-device-type"
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {DEVICE_TYPES.map((dt) => (
                <option key={dt.value} value={dt.value}>
                  {dt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">Cisco IP phone model to emulate</p>
          </div>
        </div>

        <ActionButton
          onClick={handleRegister}
          disabled={loading || !host}
          loading={loading}
          ariaLabel="Attempt SCCP device registration"
          variant="primary"
        >
          Register Device
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About SCCP (Skinny)"
          description="SCCP (Skinny Client Control Protocol) is Cisco's proprietary VoIP signaling protocol used by Cisco IP phones to communicate with Cisco Unified Communications Manager (CUCM). The KeepAlive probe sends a lightweight heartbeat to detect SCCP servers. Device registration attempts to register a virtual phone with the call manager. SCCP uses a simple binary format with 12-byte headers (length + reserved + message ID) over TCP port 2000."
          showKeyboardShortcut={true}
        />
      </div>
    </ProtocolClientLayout>
  );
}
