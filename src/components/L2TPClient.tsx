import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface L2TPClientProps {
  onBack: () => void;
}

export default function L2TPClient({ onBack }: L2TPClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1701');
  const [hostname, setHostname] = useState('');
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
      const response = await fetch('/api/l2tp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port),
          hostname: hostname || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        tunnelId?: number;
        assignedTunnelId?: number;
        peerHostname?: string;
        vendorName?: string;
        protocolVersion?: string;
        rtt?: number;
      };

      if (data.success) {
        let msg = `L2TP service detected at ${host}:${port}\n`;
        if (data.protocolVersion) msg += `Protocol Version: ${data.protocolVersion}\n`;
        if (data.tunnelId !== undefined) msg += `Tunnel ID: ${data.tunnelId}\n`;
        if (data.assignedTunnelId !== undefined) msg += `Assigned Tunnel ID: ${data.assignedTunnelId}\n`;
        if (data.peerHostname) msg += `Peer Hostname: ${data.peerHostname}\n`;
        if (data.vendorName) msg += `Vendor: ${data.vendorName}\n`;
        if (data.rtt !== undefined) msg += `RTT: ${data.rtt}ms`;
        setResult(msg);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
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
    <ProtocolClientLayout title="L2TP (Layer 2 Tunneling) Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Tunnel Endpoint Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="l2tp-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="vpn.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="l2tp-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            error={errors.port}
          />

          <div className="md:col-span-2">
            <FormField
              id="l2tp-hostname"
              label="Client Hostname"
              type="text"
              value={hostname}
              onChange={setHostname}
              onKeyDown={handleKeyDown}
              placeholder="portofcall-worker"
              optional
            />
          </div>
        </div>

        <ActionButton
          onClick={handleConnect}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Connect to L2TP service"
        >
          Test L2TP Connection
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About L2TP"
          description="L2TP (Layer 2 Tunneling Protocol, RFC 2661) is used to tunnel PPP sessions over IP networks, commonly paired with IPsec for VPNs. This initiates an SCCRQ control message handshake to detect L2TP servers and identify their properties. Default port is 1701."
        />
      </div>
    </ProtocolClientLayout>
  );
}
