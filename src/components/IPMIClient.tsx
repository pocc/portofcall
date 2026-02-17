import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface IPMIClientProps {
  onBack: () => void;
}

export default function IPMIClient({ onBack }: IPMIClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('623');
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
      const response = await fetch('/api/ipmi/connect', {
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
        message?: string;
        tcpReachable?: boolean;
        rmcpResponse?: boolean;
        supportsIPMI?: boolean;
        entityType?: number;
        entityId?: number;
        note?: string;
        isCloudflare?: boolean;
      };

      if (data.isCloudflare) {
        setError(data.error || 'Target is behind Cloudflare');
        return;
      }

      if (data.success || data.tcpReachable) {
        let output = `IPMI Probe — ${host}:${port}\n\n`;
        output += `TCP Port Open: ${data.tcpReachable ? 'Yes' : 'No'}\n`;
        output += `RMCP Response: ${data.rmcpResponse ? 'Yes' : 'No'}\n`;

        if (data.rmcpResponse) {
          output += `IPMI Supported: ${data.supportsIPMI ? 'Yes' : 'Unknown'}\n`;
          if (data.entityType) output += `Entity Type: 0x${data.entityType.toString(16).padStart(2, '0')}\n`;
          if (data.entityId) output += `Entity ID: 0x${data.entityId.toString(16).padStart(2, '0')}\n`;
        }

        output += `\nStatus: ${data.message || 'Connection attempted'}\n`;
        if (data.note) output += `\nNote: ${data.note}`;
        setResult(output);
      } else {
        const msg = data.error || data.message || 'Connection failed';
        const note = data.note ? `\n\nNote: ${data.note}` : '';
        setError(msg + note);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
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
    <ProtocolClientLayout title="IPMI Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded-lg">
          <p className="text-xs text-yellow-300">
            <strong>UDP Limitation:</strong> IPMI/RMCP typically uses <strong>UDP port 623</strong>.
            Cloudflare Workers only support TCP, so this probe tests TCP connectivity and sends
            an RMCP ASF Presence Ping. Full IPMI session management (power control, sensor
            readings, SOL) requires a dedicated tool like <code className="font-mono">ipmitool</code>.
          </p>
        </div>

        <SectionHeader stepNumber={1} title="BMC Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ipmi-host"
            label="BMC Host / IP"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="192.168.1.100"
            required
            error={errors.host}
          />

          <FormField
            id="ipmi-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 623 (RMCP/IPMI)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe IPMI BMC"
        >
          Probe BMC
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About IPMI"
          description="IPMI (Intelligent Platform Management Interface) provides out-of-band server management via a dedicated Baseboard Management Controller (BMC). It allows hardware monitoring, power control, and remote console access even when the OS is not running. IPMI v2.0 (RMCP+) runs on UDP port 623. This probe checks TCP reachability and attempts an RMCP ASF Presence Ping to detect BMC presence."
        />

        <div className="mt-6 pt-6 border-t border-slate-600">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">IPMI Commands (via ipmitool)</h3>
          <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-slate-400 space-y-1">
            <div><span className="text-green-400">$</span> ipmitool -I lanplus -H &lt;bmc-ip&gt; -U admin -P pass chassis power status</div>
            <div><span className="text-green-400">$</span> ipmitool -I lanplus -H &lt;bmc-ip&gt; -U admin -P pass sdr list</div>
            <div><span className="text-green-400">$</span> ipmitool -I lanplus -H &lt;bmc-ip&gt; -U admin -P pass sol activate</div>
          </div>
        </div>
      </div>
    </ProtocolClientLayout>
  );
}
