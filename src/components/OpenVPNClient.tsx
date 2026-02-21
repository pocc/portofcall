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

interface OpenVPNClientProps {
  onBack: () => void;
}

export default function OpenVPNClient({ onBack }: OpenVPNClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1194');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const { errors, validateAll } = useFormValidation({
    host: [validationRules.required('Host is required')],
    port: [validationRules.port()],
  });

  const handleHandshake = async () => {
    const isValid = validateAll({ host, port });
    if (!isValid) return;

    setLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch('/api/openvpn/handshake', {
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
        rtt?: number;
        isOpenVPN?: boolean;
        opcode?: string;
        keyId?: number;
        serverSessionId?: string;
        clientSessionId?: string;
        ackCount?: number;
        remoteSessionId?: string;
        packetId?: number;
        protocolVersion?: number;
        rawHex?: string;
        isCloudflare?: boolean;
      };

      if (data.success) {
        let output = `OpenVPN Handshake\n`;
        output += `===================\n`;
        output += `Host: ${data.host}:${data.port}\n`;
        output += `RTT: ${data.rtt}ms\n`;
        output += `Protocol Version: ${data.protocolVersion}\n`;
        output += `Response: ${data.opcode}\n`;
        output += `Key ID: ${data.keyId}\n\n`;
        output += `Server Session ID: ${data.serverSessionId}\n`;
        output += `Client Session ID: ${data.clientSessionId}\n`;
        if (data.remoteSessionId) output += `Remote Session ID: ${data.remoteSessionId}\n`;
        if (data.ackCount !== undefined) output += `ACK Count: ${data.ackCount}\n`;
        if (data.packetId !== undefined) output += `Packet ID: ${data.packetId}\n`;
        output += `\nServer is running OpenVPN in TCP mode and responded to handshake.\n`;
        output += `Full TLS negotiation and authentication would follow.\n`;
        setResult(output);
      } else {
        setError(data.error || 'Handshake failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Handshake failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading && host && port) {
      handleHandshake();
    }
  };

  return (
    <ProtocolClientLayout title="OpenVPN Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.OpenVPN || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ovpn-host"
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
            id="ovpn-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 1194 (TCP mode)"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleHandshake}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test OpenVPN handshake"
        >
          Test Handshake (TCP)
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About OpenVPN"
          description="OpenVPN is an open-source SSL/TLS VPN protocol. In TCP mode, packets are prefixed with a 2-byte length header. The handshake begins with a P_CONTROL_HARD_RESET_CLIENT_V2 message containing a random session ID. The server responds with P_CONTROL_HARD_RESET_SERVER_V2 and its own session ID. This tool tests TCP mode connectivity only — UDP mode is not supported by Cloudflare Workers. Full VPN establishment requires TLS negotiation and certificate/key authentication."
        />
      </div>
    </ProtocolClientLayout>
  );
}
