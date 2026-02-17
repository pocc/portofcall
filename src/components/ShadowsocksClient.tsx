import { useState } from 'react';
import ProtocolClientLayout, {
  SectionHeader,
  FormField,
  ActionButton,
  ResultDisplay,
  HelpSection,
} from './ProtocolClientLayout';
import { useFormValidation, validationRules } from '../hooks/useFormValidation';

interface ShadowsocksClientProps {
  onBack: () => void;
}

export default function ShadowsocksClient({ onBack }: ShadowsocksClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8388');
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
      const response = await fetch('/api/shadowsocks/probe', {
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
        portOpen?: boolean;
        silentOnConnect?: boolean;
        isShadowsocks?: boolean;
        bannerHex?: string;
        note?: string;
        isCloudflare?: boolean;
      };

      if (data.success) {
        let output = `Shadowsocks Probe\n`;
        output += `=================\n`;
        output += `Host: ${data.host}:${data.port}\n`;
        output += `TCP Connect: ${data.portOpen ? '✓ Open' : '✗ Closed'}\n`;
        output += `RTT: ${data.rtt}ms\n`;
        output += `Silent on connect: ${data.silentOnConnect ? '✓ Yes' : '✗ No (server sent data)'}\n`;
        output += `Likely Shadowsocks: ${data.isShadowsocks ? '✓ Yes' : '✗ No'}\n`;
        if (data.bannerHex) {
          output += `\nUnexpected banner (hex): ${data.bannerHex}\n`;
        }
        output += `\n${data.note}\n`;
        output += `\nNote: Full authentication requires the Shadowsocks password and cipher.\n`;
        output += `This probe only confirms TCP reachability and silent-on-connect behavior.`;
        setResult(output);
      } else {
        setError(data.error || 'Probe failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Probe failed');
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
    <ProtocolClientLayout title="Shadowsocks Client" onBack={onBack}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Server Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="ss-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="ss.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="ss-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 8388"
            error={errors.port}
          />
        </div>

        <ActionButton
          onClick={handleProbe}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Test Shadowsocks connectivity"
        >
          Test TCP Connectivity
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About Shadowsocks"
          description="Shadowsocks is an encrypted proxy protocol originally developed for censorship circumvention. It uses AEAD ciphers (AES-256-GCM or ChaCha20-Poly1305) to encrypt all traffic. Unlike most protocols, a Shadowsocks server sends no banner on connect — it silently waits for the encrypted client header containing the target address and port. This tool tests TCP connectivity and checks whether the server behaves silently on connect, which is characteristic of Shadowsocks. Full proxy functionality requires the shared password and cipher negotiation."
        />
      </div>
    </ProtocolClientLayout>
  );
}
