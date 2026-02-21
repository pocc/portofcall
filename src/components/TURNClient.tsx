import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface TURNClientProps {
  onBack: () => void;
}

export default function TURNClient({ onBack }: TURNClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3478');
  const [username, setUsername] = useState('');
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
      const response = await fetch('/api/turn/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: parseInt(port, 10),
          username: username || undefined,
          password: password || undefined,
          timeout: 15000,
        }),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        relayAddress?: string;
        relayPort?: number;
        lifetime?: number;
        responseType?: string;
        realm?: string;
        nonce?: string;
        rtt?: number;
        errorCode?: number;
      };

      if (data.success) {
        let msg = `TURN server detected at ${host}:${port}\n`;
        if (data.responseType) msg += `Response: ${data.responseType}\n`;
        if (data.relayAddress) msg += `Relay Address: ${data.relayAddress}:${data.relayPort}\n`;
        if (data.lifetime !== undefined) msg += `Lifetime: ${data.lifetime}s\n`;
        if (data.realm) msg += `Realm: ${data.realm}\n`;
        if (data.rtt !== undefined) msg += `RTT: ${data.rtt}ms`;
        setResult(msg);
      } else {
        if (data.errorCode === 401 && data.realm) {
          setResult(`TURN server at ${host}:${port} requires authentication\nRealm: ${data.realm}${data.nonce ? `\nNonce: ${data.nonce}` : ''}`);
        } else {
          setError(data.error || 'Probe failed');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
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
    <ProtocolClientLayout title="TURN Relay Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="TURN Server Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="turn-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="turn.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="turn-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            error={errors.port}
          />

          <FormField
            id="turn-username"
            label="Username"
            type="text"
            value={username}
            onChange={setUsername}
            onKeyDown={handleKeyDown}
            placeholder="turnuser"
            optional
          />

          <FormField
            id="turn-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            onKeyDown={handleKeyDown}
            placeholder="turnpass"
            optional
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Probe TURN server"
        >
          Probe TURN Server
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About TURN"
          description="TURN (Traversal Using Relays around NAT, RFC 8656) is a relay protocol used in WebRTC and VoIP to traverse NAT/firewalls. It extends STUN with relay allocation. Credentials are optional — without them, the server will return a 401 with realm info. Default port is 3478."
        />
      </div>
    </ProtocolClientLayout>
  );
}
