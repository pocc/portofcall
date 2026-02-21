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

interface BitTorrentClientProps {
  onBack: () => void;
}

export default function BitTorrentClient({ onBack }: BitTorrentClientProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6881');
  const [infoHash, setInfoHash] = useState('');
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
      const payload: Record<string, unknown> = {
        host,
        port: parseInt(port, 10),
        timeout: 10000,
      };

      if (infoHash.trim()) {
        payload.infoHash = infoHash.trim();
      }

      const response = await fetch('/api/bittorrent/handshake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        host?: string;
        port?: number;
        rtt?: number;
        isBitTorrent?: boolean;
        protocol?: string;
        infoHash?: string;
        peerId?: string;
        peerIdDecoded?: string;
        reservedHex?: string;
        extensions?: string[];
        isCloudflare?: boolean;
      };

      if (data.success) {
        let output = `BitTorrent Handshake\n`;
        output += `=====================\n`;
        output += `Host: ${data.host}:${data.port}\n`;
        output += `RTT: ${data.rtt}ms\n`;
        output += `Protocol: ${data.protocol}\n\n`;
        output += `Peer ID (hex): ${data.peerId}\n`;
        output += `Client: ${data.peerIdDecoded}\n`;
        output += `Info Hash: ${data.infoHash}\n`;
        output += `Reserved Bytes: ${data.reservedHex}\n`;

        if (data.extensions && data.extensions.length > 0) {
          output += `\nExtensions:\n`;
          data.extensions.forEach((ext) => {
            output += `  ✓ ${ext}\n`;
          });
        } else {
          output += `\nNo extensions advertised\n`;
        }

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
    <ProtocolClientLayout title="BitTorrent Client" onBack={onBack}>
      <ApiExamples examples={apiExamples.BitTorrent || []} />
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-6">
        <SectionHeader stepNumber={1} title="Connection Details" />

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <FormField
            id="bt-host"
            label="Host"
            type="text"
            value={host}
            onChange={setHost}
            onKeyDown={handleKeyDown}
            placeholder="peer.example.com"
            required
            error={errors.host}
          />

          <FormField
            id="bt-port"
            label="Port"
            type="number"
            value={port}
            onChange={setPort}
            onKeyDown={handleKeyDown}
            min="1"
            max="65535"
            helpText="Default: 6881-6889"
            error={errors.port}
          />
        </div>

        <div className="mb-6">
          <FormField
            id="bt-infohash"
            label="Info Hash (optional)"
            type="text"
            value={infoHash}
            onChange={setInfoHash}
            onKeyDown={handleKeyDown}
            placeholder="40-character hex SHA1 hash (random if empty)"
            helpText="SHA1 hash of torrent info dictionary. Leave empty for peer detection probe."
          />
        </div>

        <ActionButton
          onClick={handleHandshake}
          disabled={loading || !host || !port}
          loading={loading}
          ariaLabel="Perform BitTorrent handshake"
        >
          Handshake
        </ActionButton>

        <ResultDisplay result={result} error={error} />

        <HelpSection
          title="About BitTorrent Protocol"
          description="BitTorrent (BEP 3) is a peer-to-peer file sharing protocol. The handshake is the first message exchanged between peers, containing the protocol identifier, extension flags, torrent info_hash, and peer_id. The peer_id encodes the client software and version using Azureus-style (-XX1234-) encoding. Extension flags in the reserved bytes indicate support for DHT (BEP 5), Extension Protocol (BEP 10), and Fast Extension (BEP 6). A random info_hash can be used to probe whether a host is running a BitTorrent client."
        />
      </div>
    </ProtocolClientLayout>
  );
}
